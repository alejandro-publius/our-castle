import Anthropic from '@anthropic-ai/sdk';
import { decimalStringToCents, formatCents, milestoneTargets, nextMilestone } from '../../src/core/rules.js';
import { DomainError, getActiveGoal, getHousehold, getMember, progressFor } from '../household.mjs';
import { PlannerProviderError, mapAnthropicError } from '../planner/anthropic-provider.mjs';
import { dollarFigures } from '../planner/validate.mjs';

// The house steward answers a family's questions about their goal and payments. It is read-only:
// it can read the household ledger and, in sandbox mode, look things up through PayPal's Agent
// Toolkit (get_order, list_transactions). What it checked, and whether PayPal agrees with the
// ledger, is recorded by the server from the actual tool results — not taken from the model's prose.

export const STEWARD_SYSTEM = `You are the house steward in "Our House", a cooperative household savings game where a family grows a cottage into a castle by reaching one shared goal.

Answer the family's question in 2–5 short, warm sentences suitable for parents and children. No tables or markdown headings.

You are read-only. You can read the household ledger and, when the tools are offered, check PayPal sandbox records through PayPal's Agent Toolkit. You cannot create, approve, capture, refund or schedule payments. If asked to, explain that an adult does that in the app with PayPal approval.

Before saying whether a payment went through, check it: use get_order for a specific contribution and report what PayPal says (status, capture id, amount) and whether it matches the ledger. Recent payments can take a while to appear in transaction search, so prefer get_order for one payment.

Only mention money amounts that appear in tool results. Simulated example-mode contributions have no PayPal record; say so if relevant. The ledger tracks progress toward one goal; never call it a bank balance, and PayPal does not see the household's other bills.`;

const ORDER_STATUS_TEXT = { completed: 'completed', refunded: 'refunded', partially_refunded: 'partly refunded', pending: 'pending', created: 'awaiting approval', approval_canceled: 'canceled', declined: 'declined', failed: 'failed', rejected: 'rejected' };

function money(cents) {
  return Number.isSafeInteger(cents) ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` : null;
}

/** Every money amount present in data the steward was shown, as cents. */
function amountsIn(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => amountsIn(v, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => amountsIn(v, into));
  else if (typeof value === 'string') { const c = decimalStringToCents(value.replace(/^-/, '')); if (c !== null && /\.\d{2}$/.test(value)) into.add(c); }
  return into;
}

/** Compare one PayPal order with the server's own record of that contribution. */
export function reconcileOrder(order, contribution) {
  const unit = (order?.purchase_units ?? []).find((u) => u.reference_id === contribution.id) ?? order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const paypalCents = decimalStringToCents(capture?.amount?.value);
  const credited = contribution.captures.some((c) => c.credited);
  const facts = {
    orderId: contribution.providerOrderId,
    paypalOrderStatus: order?.status ?? null,
    paypalCaptureId: capture?.id ?? null,
    paypalCaptureStatus: capture?.status ?? null,
    paypalAmountCents: paypalCents,
    ledgerAmountCents: contribution.amountCents,
    ledgerStatus: contribution.status,
    ledgerCounted: credited,
  };
  if (order?.error || !order?.id) return { ...facts, verdict: 'unavailable', note: 'PayPal did not return this order.' };
  const paypalComplete = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(capture?.status);
  const amountsMatch = paypalCents === contribution.amountCents && capture?.amount?.currency_code === contribution.currency;
  if (paypalComplete && amountsMatch && credited) return { ...facts, verdict: 'match', note: 'PayPal and the ledger agree.' };
  if (!capture && !credited) return { ...facts, verdict: 'match', note: 'Not captured in PayPal, and not counted in the ledger.' };
  if (capture?.status === 'PENDING' && !credited) return { ...facts, verdict: 'match', note: 'Pending in PayPal, and not counted yet.' };
  if (paypalComplete && amountsMatch && !credited) return { ...facts, verdict: 'action', note: 'PayPal shows a completed capture the ledger has not counted. Use “Check with PayPal” to let the server verify and record it.' };
  return { ...facts, verdict: 'differs', note: 'PayPal and the ledger disagree. Nothing was changed; review this contribution.' };
}

export function createSteward({ db, contributions, householdId, ai = null, paypalTools = null, fetch: fetchImpl, clock }) {
  const client = ai ? new Anthropic({ apiKey: ai.apiKey, baseURL: 'https://api.anthropic.com', timeout: 90_000, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) : null;

  function snapshot() {
    const goal = getActiveGoal(db, householdId);
    const progress = progressFor(db, goal.id);
    const list = contributions.contributions(goal.id);
    return {
      goal,
      list,
      ledger: {
        goal: { name: goal.name, target: money(goal.targetCents), currency: goal.currency, target_date: goal.targetDate },
        tracked_progress: money(progress.progressCents),
        milestones: milestoneTargets(goal.targetCents).slice(1).map((m) => ({
          home: m.name, percent: m.percent, target: money(m.targetCents), reached: progress.progressCents >= m.targetCents,
          still_needed: money(Math.max(0, m.targetCents - progress.progressCents)),
        })),
        next_milestone: (() => { const n = nextMilestone(progress.progressCents, goal.targetCents); return n ? { home: n.name, target: money(n.targetCents), still_needed: money(n.awayCents) } : null; })(),
        still_needed_for_goal: money(Math.max(0, goal.targetCents - progress.progressCents)),
        reported_starting_progress: money(progress.startingCents),
        paypal_sandbox_confirmed: money(progress.contributedCents - progress.refundedCents),
        simulated_confirmed: money(progress.simulatedContributedCents - progress.simulatedRefundedCents),
        bills_logged_not_savings: { count: progress.bills.count, total: money(progress.bills.totalCents) },
        gifts_logged_not_savings: { count: progress.gifts.count, total: money(progress.gifts.totalCents) },
        contributions: list.map((c) => ({
          contribution_id: c.id,
          kind: c.simulated ? 'simulated (example mode, no PayPal record)' : 'PayPal sandbox',
          paypal_order_id: c.simulated ? null : c.providerOrderId,
          capture_id: c.captures[0]?.captureId ?? null,
          amount: money(c.amountCents),
          currency: c.currency,
          status: ORDER_STATUS_TEXT[c.status] ?? c.status,
          counted_toward_goal: c.captures.some((x) => x.credited),
          refunded: money(c.captures.reduce((s, x) => s + x.refundedCents, 0)),
          recorded_at: c.updatedAt,
        })),
      },
    };
  }

  function toolsFor(knownOrderIds) {
    const tools = [{
      name: 'read_household_ledger',
      description: 'Read this household\'s goal, tracked progress and every contribution with its PayPal order id, capture id and status. Bills and gifts are listed separately and are not savings.',
      strict: true,
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    }];
    if (paypalTools && knownOrderIds.length) {
      tools.push({
        name: 'get_order',
        description: 'PayPal Agent Toolkit (read-only): fetch one of this household\'s PayPal sandbox orders from PayPal to confirm its status, capture id and amount.',
        strict: true,
        input_schema: { type: 'object', properties: { order_id: { type: 'string', enum: knownOrderIds } }, required: ['order_id'], additionalProperties: false },
      });
    }
    if (paypalTools) {
      tools.push({
        name: 'list_transactions',
        description: 'PayPal Agent Toolkit (read-only): list PayPal sandbox transactions from the last N days (1–31). Status S = successful, P = pending, D = denied, V = reversed. Recent payments may not appear yet.',
        strict: true,
        input_schema: { type: 'object', properties: { days: { type: 'integer' }, status: { type: 'string', enum: ['S', 'P', 'D', 'V'] } }, required: ['days', 'status'], additionalProperties: false },
      });
    }
    return tools;
  }

  return {
    available: Boolean(client),
    paypalToolsAvailable: Boolean(client && paypalTools),

    async ask({ question, memberId, focusOrderId = null }) {
      if (!client) throw new DomainError(409, 'steward_unavailable', 'The house steward needs an AI key (AI_API_KEY) in the server’s .env file.');
      const text = typeof question === 'string' ? question.trim().replace(/\s+/g, ' ') : '';
      if (text.length < 3 || text.length > 300) throw new DomainError(400, 'invalid_question', 'Ask a question of 3–300 characters.');
      const member = getMember(db, householdId, memberId);
      if (!member) throw new DomainError(400, 'invalid_member', 'Choose who is asking.');
      const household = getHousehold(db, householdId);
      const { list, ledger } = snapshot();
      const paypalOrders = list.filter((c) => !c.simulated && c.providerOrderId);
      const knownOrderIds = paypalOrders.map((c) => c.providerOrderId);
      const focus = focusOrderId && knownOrderIds.includes(focusOrderId) ? focusOrderId : null;
      const tools = toolsFor(knownOrderIds);

      const checks = [];
      const shown = [ledger];
      const executeTool = async (name, input) => {
        if (name === 'read_household_ledger') {
          checks.push({ tool: name, source: 'Our House ledger', summary: `Read the ledger: ${formatCents(decimalStringToCents(ledger.tracked_progress))} tracked, ${ledger.contributions.length} contribution${ledger.contributions.length === 1 ? '' : 's'}.` });
          return ledger;
        }
        if (name === 'get_order' && paypalTools) {
          const contribution = paypalOrders.find((c) => c.providerOrderId === input?.order_id);
          if (!contribution) return { error: 'That order is not one of this household\'s PayPal orders.' };
          const order = await paypalTools.getOrder(contribution.providerOrderId);
          const reconciliation = reconcileOrder(order, contribution);
          checks.push({
            tool: name,
            source: 'PayPal sandbox via Agent Toolkit',
            orderId: contribution.providerOrderId,
            contributionId: contribution.id,
            summary: order?.error ? `Asked PayPal for order ${contribution.providerOrderId}: PayPal returned an error.`
              : `Asked PayPal for order ${contribution.providerOrderId}: ${order?.status ?? 'unknown'}${reconciliation.paypalCaptureId ? `, capture ${reconciliation.paypalCaptureId} ${reconciliation.paypalCaptureStatus}` : ''}${reconciliation.paypalAmountCents !== null ? `, ${formatCents(reconciliation.paypalAmountCents)}` : ''}.`,
            reconciliation,
          });
          return order;
        }
        if (name === 'list_transactions' && paypalTools) {
          const result = await paypalTools.listTransactions({ days: input?.days, status: input?.status });
          const count = Array.isArray(result?.transaction_details) ? result.transaction_details.length : null;
          checks.push({ tool: name, source: 'PayPal sandbox via Agent Toolkit', summary: result?.error ? 'Asked PayPal for recent transactions: PayPal returned an error.' : `Listed PayPal sandbox transactions (last ${Math.min(31, Math.max(1, input?.days ?? 7))} days, status ${input?.status ?? 'S'}): ${count ?? 0} found.` });
          return result;
        }
        return { error: `Tool "${name}" is not available to the steward.` };
      };

      const context = [
        `Question from ${member.name} (${member.role}, example persona) in ${household.name}: ${text}`,
        focus ? `They are asking about PayPal order ${focus}.` : null,
        paypalTools ? null : 'PayPal tools are off because this server is in example payment mode; only the ledger is available.',
        `Today is ${clock.today()}.`,
      ].filter(Boolean).join('\n');
      const messages = [{ role: 'user', content: context }];
      let answer = '';
      let model = ai.model;
      try {
        for (let turn = 0; turn < 6; turn++) {
          const response = await client.beta.messages.create({
            model: ai.model,
            max_tokens: 4000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'low' },
            system: STEWARD_SYSTEM,
            tools,
            messages,
          });
          model = response.model ?? model;
          if (response.stop_reason === 'refusal') throw new PlannerProviderError('refusal', 'The AI provider declined to answer this question.');
          messages.push({ role: 'assistant', content: response.content });
          const calls = response.content.filter((b) => b.type === 'tool_use');
          if (response.stop_reason === 'tool_use' && calls.length) {
            const results = [];
            for (const call of calls) {
              let output;
              let isError = false;
              try { output = await executeTool(call.name, call.input); } catch (error) { output = { error: error.message }; isError = true; }
              if (output?.error) isError = true;
              shown.push(output);
              results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output).slice(0, 20_000), ...(isError ? { is_error: true } : {}) });
            }
            messages.push({ role: 'user', content: results });
            continue;
          }
          answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          break;
        }
      } catch (error) {
        const mapped = error instanceof PlannerProviderError ? error : mapAnthropicError(error);
        if (mapped instanceof PlannerProviderError) return { status: 'provider_error', error: { kind: mapped.kind, message: mapped.message }, checks };
        throw mapped;
      }
      if (!answer) return { status: 'provider_error', error: { kind: 'no_answer', message: 'The steward did not finish an answer.' }, checks };

      const allowed = new Set([0]);
      for (const data of shown) amountsIn(data, allowed);
      const counted = ledger.contributions.filter((c) => c.counted_toward_goal).reduce((s, c) => s + decimalStringToCents(c.amount), 0);
      allowed.add(counted);
      const unknown = [...new Set(dollarFigures(answer).filter((c) => !allowed.has(c)))];
      const warnings = unknown.length
        ? [`The steward mentioned ${unknown.map((c) => formatCents(c)).join(', ')}, which does not appear in the ledger or PayPal data it checked. Treat ${unknown.length === 1 ? 'it' : 'them'} as unverified.`]
        : [];
      if (!checks.length) warnings.push('The steward answered without checking the ledger or PayPal.');
      return { status: 'ok', answer, checks, warnings, model, paypalTools: Boolean(paypalTools) };
    },
  };
}
