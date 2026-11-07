import { transaction } from '../db.mjs';
import { DomainError, getGoal, newId, progressFor } from '../household.mjs';
import { buildPlanText, cleanCommitments, computeBasis, rulesAmounts } from './basis.mjs';
import { finalizePlan, validateAiPlan, validateEditedAmounts } from './validate.mjs';
import { PlannerProviderError } from './anthropic-provider.mjs';
import { describeFactChanges, factsFromBasis, factsRevision, planFacts } from './facts.mjs';
import { previewRemainingPlan } from './remaining.mjs';

const STALE_MESSAGE = 'This plan was made from earlier figures, so it can’t be used or edited as it is. Make a fresh plan from the latest progress and goal.';
const CHANGED_IN_FLIGHT_MESSAGE = 'The goal or its progress changed while this plan was being prepared, so it was not saved. Ask for a new plan with the latest figures.';

const SOURCE_LABELS = {
  ai: 'AI plan',
  rules: 'Example plan (built-in rules, no AI)',
  'household-edited': 'Edited by your household',
};

function rowToPlan(row) {
  if (!row) return null;
  const plan = JSON.parse(row.plan_json);
  return { ...plan, id: row.id, status: row.status, createdAt: row.created_at, parentId: row.parent_id, inputs: JSON.parse(row.inputs_json) };
}

/**
 * Plans are proposals. Nothing here moves money, schedules a payment or changes a confirmed amount;
 * the household reviews, may edit, and approves each contribution separately in PayPal.
 */
export function createPlanner({ db, clock, provider = null }) {
  function goalFor(householdId, goalId) {
    const goal = getGoal(db, goalId);
    if (!goal || goal.householdId !== householdId) throw new DomainError(404, 'not_found', 'Goal not found.');
    return goal;
  }

  /** Facts the stored plan used versus the facts now, for one verified goal. */
  function reviewRow(goal, row) {
    const was = factsFromBasis(JSON.parse(row.basis_json), goal);
    const now = factsNow(goal.id) ?? { ...was, goalId: null };
    const changes = describeFactChanges(was, now);
    return { factsChanged: changes.length > 0, changes, planFactsRevision: factsRevision(was), factsRevision: factsRevision(now) };
  }

  function factsNow(goalId) {
    const goal = getGoal(db, goalId);
    return goal ? planFacts({ goal, progress: progressFor(db, goal.id), today: clock.today() }) : null;
  }

  function store({ goal, source, provider: providerName = null, model = null, parentId = null, inputs, basis, plan }) {
    const id = newId('plan');
    const at = clock.iso();
    transaction(db, () => {
      // Store only if the facts the basis used still hold now. An AI answer can arrive after a contribution, refund, goal
      // edit or midnight; it is then dropped instead of becoming a proposal the household might accept.
      const was = factsFromBasis(basis, goal);
      const now = factsNow(goal.id);
      const changes = now && now.householdId === goal.householdId ? describeFactChanges(was, now) : [{ code: 'goal', message: 'Goal not found.' }];
      if (changes.length) throw new DomainError(409, 'plan_facts_changed', CHANGED_IN_FLIGHT_MESSAGE, { issues: changes });
      db.prepare("UPDATE plans SET status = 'superseded' WHERE goal_id = ? AND status = 'proposed'").run(goal.id);
      db.prepare(`INSERT INTO plans (id, goal_id, source, provider, model, parent_id, inputs_json, basis_json, plan_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`)
        .run(id, goal.id, source, providerName, model, parentId, JSON.stringify(inputs), JSON.stringify(basis), JSON.stringify(plan), at);
    });
    return getPlan(goal.id, id);
  }

  function getPlan(goalId, planId) {
    return rowToPlan(db.prepare('SELECT * FROM plans WHERE id = ? AND goal_id = ?').get(planId, goalId));
  }

  function basisFor(goal, commitments) {
    return computeBasis({ goal, progress: progressFor(db, goal.id), commitments, today: clock.today() });
  }

  function rulesPlan(goal, inputs, basis, extra = {}) {
    const body = buildPlanText(basis, rulesAmounts(basis));
    const plan = finalizePlan(body, basis, { source: 'rules', sourceLabel: SOURCE_LABELS.rules, provider: null, model: null, ...extra });
    return store({ goal, source: 'rules', inputs, basis, plan });
  }

  return {
    mode: provider ? 'live' : 'example',

    async propose({ householdId, goalId, commitments: rawCommitments, assertAccess = () => {} }) {
      assertAccess();
      const goal = goalFor(householdId, goalId);
      const commitments = cleanCommitments(rawCommitments);
      const inputs = { commitments };
      const basis = basisFor(goal, commitments);
      if (!provider) return { status: 'ok', plan: rulesPlan(goal, inputs, basis) };

      let result;
      try {
        result = await provider.proposePlan(basis);
      } catch (error) {
        if (!(error instanceof PlannerProviderError)) throw error;
        return { status: 'provider_error', provider: provider.provider, model: provider.model, error: { kind: error.kind, message: error.message } };
      } finally {
        // The caller may lose access while the model runs. Check before validating/storing a proposal, or returning
        // a provider failure, rather than saving a late plan and merely hiding its HTTP response afterwards.
        assertAccess();
      }
      const check = validateAiPlan(result.output, basis);
      if (!check.ok) {
        return { status: 'invalid_ai_output', provider: provider.provider, model: result.model, issues: check.issues };
      }
      const plan = finalizePlan(result.output, basis, {
        source: 'ai',
        sourceLabel: SOURCE_LABELS.ai,
        provider: provider.provider,
        model: result.model,
        providerRequestId: result.requestId,
      });
      return { status: 'ok', plan: store({ goal, source: 'ai', provider: provider.provider, model: result.model, inputs, basis, plan }) };
    },

    /** Explicit, labeled fallback the household can choose after an AI failure. */
    proposeRules({ householdId, goalId, commitments: rawCommitments, afterAiFailure = false }) {
      const goal = goalFor(householdId, goalId);
      const commitments = cleanCommitments(rawCommitments);
      const basis = basisFor(goal, commitments);
      return { status: 'ok', plan: rulesPlan(goal, { commitments }, basis, { fallbackFromAi: Boolean(afterAiFailure) }) };
    },

    edit({ householdId, goalId, planId, amounts }) {
      const goal = goalFor(householdId, goalId);
      const row = db.prepare('SELECT * FROM plans WHERE id = ? AND goal_id = ?').get(planId, goal.id);
      if (!row) throw new DomainError(404, 'not_found', 'Plan not found.');
      if (row.status === 'superseded') throw new DomainError(409, 'plan_superseded', 'This plan was replaced. Review the newest plan.');
      // An edit becomes a new proposal from this plan's basis, so that basis must still match the server's facts.
      const review = reviewRow(goal, row);
      if (review.factsChanged) throw new DomainError(409, 'plan_stale', STALE_MESSAGE, { issues: review.changes });
      const basis = JSON.parse(row.basis_json);
      const check = validateEditedAmounts(amounts, basis);
      if (!check.ok) throw new DomainError(422, 'invalid_edit', check.issues.map((i) => i.message).join(' '), { issues: check.issues });
      const body = buildPlanText(basis, amounts, { edited: true });
      const plan = finalizePlan(body, basis, {
        source: 'household-edited',
        sourceLabel: SOURCE_LABELS['household-edited'],
        editedFrom: JSON.parse(row.plan_json).source,
        warnings: check.warnings,
      });
      return store({ goal, source: 'household-edited', parentId: row.id, inputs: JSON.parse(row.inputs_json), basis, plan });
    },

    accept({ householdId, goalId, planId }) {
      const goal = goalFor(householdId, goalId);
      return transaction(db, () => {
        const row = db.prepare('SELECT * FROM plans WHERE id = ? AND goal_id = ?').get(planId, goal.id);
        if (!row) throw new DomainError(404, 'not_found', 'Plan not found.');
        if (row.status === 'superseded') throw new DomainError(409, 'plan_superseded', 'This plan was replaced. Review the newest plan.');
        // Accepting again is a no-op. An accepted schedule is history: later contributions are tracked against it
        // (state.nextStep) and never make it "stale", and a newer proposal is left for the household to review.
        if (row.status === 'accepted') return rowToPlan(row);
        const review = reviewRow(goal, row);
        if (review.factsChanged) throw new DomainError(409, 'plan_stale', STALE_MESSAGE, { issues: review.changes });
        db.prepare("UPDATE plans SET status = 'superseded' WHERE goal_id = ? AND id != ?").run(goal.id, planId);
        db.prepare("UPDATE plans SET status = 'accepted' WHERE id = ? AND goal_id = ?").run(planId, goal.id);
        return getPlan(goal.id, planId);
      });
    },

    /**
     * Whether the household's current plan still matches the server's facts. For a proposal, factsChanged means it must
     * be refreshed before it can be accepted or edited. An accepted plan stays in use either way; factsChanged then only
     * means an edit would need a fresh plan first.
     */
    review(goalId) {
      const goal = getGoal(db, goalId);
      const row = goal && db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status != 'superseded' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goal.id);
      if (!row) return null;
      const review = reviewRow(goal, row);
      return { planId: row.id, status: row.status, needsRefresh: row.status === 'proposed' && review.factsChanged, ...review };
    },

    /** Read-only preview of revising what remains for a chosen weekly amount and/or date. Writes nothing. */
    previewRemaining({ householdId, goalId, weeklyBudgetCents, targetDate }) {
      const goal = goalFor(householdId, goalId);
      const inUse = db.prepare("SELECT id FROM plans WHERE goal_id = ? AND status = 'accepted' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goal.id);
      return previewRemainingPlan({ goal, progress: progressFor(db, goal.id), today: clock.today(), weeklyBudgetCents, targetDate, planInUseId: inUse?.id ?? null });
    },

    current(goalId) {
      return rowToPlan(db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status != 'superseded' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId));
    },

    accepted(goalId) {
      return rowToPlan(db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status = 'accepted' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId));
    },
  };
}
