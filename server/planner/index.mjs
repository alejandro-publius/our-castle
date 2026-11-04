import { transaction } from '../db.mjs';
import { DomainError, getGoal, newId, progressFor } from '../household.mjs';
import { buildPlanText, cleanCommitments, computeBasis, rulesAmounts } from './basis.mjs';
import { finalizePlan, validateAiPlan, validateEditedAmounts } from './validate.mjs';
import { PlannerProviderError } from './anthropic-provider.mjs';

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

  function store({ goal, source, provider: providerName = null, model = null, parentId = null, inputs, basis, plan }) {
    const id = newId('plan');
    const at = clock.iso();
    transaction(db, () => {
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

    async propose({ householdId, goalId, commitments: rawCommitments }) {
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
      const plan = getPlan(goal.id, planId);
      if (!plan) throw new DomainError(404, 'not_found', 'Plan not found.');
      if (plan.status === 'superseded') throw new DomainError(409, 'plan_superseded', 'This plan was replaced. Review the newest plan.');
      transaction(db, () => {
        db.prepare("UPDATE plans SET status = 'superseded' WHERE goal_id = ? AND id != ?").run(goal.id, planId);
        db.prepare("UPDATE plans SET status = 'accepted' WHERE id = ?").run(planId);
      });
      return getPlan(goal.id, planId);
    },

    current(goalId) {
      return rowToPlan(db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status != 'superseded' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId));
    },

    accepted(goalId) {
      return rowToPlan(db.prepare("SELECT * FROM plans WHERE goal_id = ? AND status = 'accepted' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(goalId));
    },
  };
}
