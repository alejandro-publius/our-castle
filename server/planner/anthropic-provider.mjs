import Anthropic from '@anthropic-ai/sdk';
import { formatCents } from '../../src/core/rules.js';
import { allowedAmounts, formatDate } from './basis.mjs';

export class PlannerProviderError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** JSON schema for structured output. Only keywords the structured-outputs feature supports. */
export const PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'contributions', 'explanation', 'milestoneNotes', 'cautions', 'claimedTotals'],
  properties: {
    headline: { type: 'string', description: 'Under 12 words.' },
    summary: { type: 'string', description: 'Two or three plain sentences for the household.' },
    contributions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['week', 'date', 'amountCents', 'note'],
        properties: {
          week: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          amountCents: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
    explanation: { type: 'array', items: { type: 'string' }, description: 'Arithmetic steps, one sentence each.' },
    milestoneNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['milestone', 'note'],
        properties: { milestone: { type: 'string', enum: ['manor', 'keep', 'castle'] }, note: { type: 'string' } },
      },
    },
    cautions: { type: 'array', items: { type: 'string' } },
    claimedTotals: {
      type: 'object',
      additionalProperties: false,
      required: ['plannedCents', 'shortfallCents', 'feasible'],
      properties: { plannedCents: { type: 'integer' }, shortfallCents: { type: 'integer' }, feasible: { type: 'boolean' } },
    },
  },
});

export const SYSTEM_PROMPT = `You are the planning guide inside "Our House", a cooperative household savings game. A household travels a woodland board and grows a cottage into a manor, keep and castle as it reaches 25%, 60% and 100% of one shared goal.

Turn the household's own inputs into an editable weekly contribution plan with a short, warm, plain-language explanation that shows the arithmetic.

Rules you must follow:
- Use only the numbers provided. Never invent income, account balances, available funds, interest, or whether any bill is paid.
- Amounts are integer cents. Each week's amountCents must be between 0 and the weekly amount the household chose.
- Produce exactly one schedule entry per provided date, in order, with week numbers starting at 1.
- The schedule must total exactly plannedCents. If the goal is out of reach, say so plainly, state the shortfall, and suggest the provided alternatives (a higher weekly amount or a later date).
- When prose mentions money, use only figures from allowedAmounts, written like $1,234.56.
- Recurring commitments are bills the household already pays. They are separate from savings; do not count them toward the goal.
- You only propose. You cannot schedule or authorize payments. Each contribution happens only when an adult approves it in PayPal. Never say anything is automatic.
- This is goal-progress tracking, not a bank or savings account. Do not call it a balance.
- You may shape the schedule (for example, reaching the Manor sooner) as long as every rule holds. Keep notes short and kind, suitable for families with children.`;

export function buildUserPrompt(basis) {
  const f = (c) => formatCents(c, basis.currency);
  const facts = {
    goal: { name: basis.goalName, targetCents: basis.targetCents, targetDate: basis.targetDate },
    trackedProgress: {
      startingCents: basis.startingCents,
      startingSource: 'reported by the household',
      confirmedContributionsCents: basis.confirmedCents,
      progressCents: basis.progressCents,
    },
    remainingCents: basis.remainingCents,
    weeklyAmountChosenCents: basis.weeklyBudgetCents,
    dates: basis.dates,
    plannedCents: basis.plannedCents,
    shortfallCents: basis.shortfallCents,
    feasible: basis.feasible,
    alternativesIfShort: basis.feasible ? null : { requiredWeeklyCents: basis.requiredWeeklyCents, suggestedDate: basis.suggestedDate },
    milestones: basis.milestones.map((m) => ({ key: m.key, percent: m.percent, targetCents: m.targetCents, alreadyReached: m.reached })),
    recurringCommitments: basis.commitments,
    allowedAmounts: [...allowedAmounts(basis)].sort((a, b) => a - b).map(f),
  };
  return `Household inputs and the server's arithmetic (all amounts in integer cents unless written with $):
${JSON.stringify(facts, null, 2)}

Today is ${formatDate(basis.today)}. Write the plan now. Remember: ${basis.weeks} entries, totaling exactly ${basis.plannedCents} cents, each at most ${basis.weeklyBudgetCents} cents.
You may also cite cumulative running totals of your own schedule (tracked progress plus your weeks so far) and your own weekly amounts.`;
}

/**
 * Real runtime provider. Uses only the API key from the server's .env (AI_API_KEY); passing it
 * explicitly stops the SDK from reading any other environment credential or local profile.
 */
export function createAnthropicPlanner({ apiKey, model, fetch, timeoutMs = 120_000, maxRetries = 1 }) {
  if (!apiKey) throw new Error('AI_API_KEY is required for the Anthropic planner');
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', timeout: timeoutMs, maxRetries, ...(fetch ? { fetch } : {}) });
  return {
    provider: 'anthropic',
    model,
    async proposePlan(basis) {
      let response;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(basis) }],
        });
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
          throw new PlannerProviderError('auth', 'The AI provider rejected the API key in the server .env file.', { status: error.status });
        }
        if (error instanceof Anthropic.RateLimitError) throw new PlannerProviderError('rate_limited', 'The AI provider is rate limiting requests. Try again shortly.', { status: 429 });
        if (error instanceof Anthropic.BadRequestError) throw new PlannerProviderError('bad_request', `The AI provider rejected the request: ${error.message}`, { status: 400 });
        if (error instanceof Anthropic.APIConnectionError) throw new PlannerProviderError('network', 'Could not reach the AI provider.', {});
        if (error instanceof Anthropic.APIError) throw new PlannerProviderError('provider_error', `The AI provider returned an error (${error.status ?? 'unknown'}).`, { status: error.status });
        throw error;
      }
      if (response.stop_reason === 'refusal') throw new PlannerProviderError('refusal', 'The AI provider declined to write this plan.');
      if (response.stop_reason === 'max_tokens') throw new PlannerProviderError('truncated', 'The AI plan was cut off before it finished.');
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      let output;
      try {
        output = JSON.parse(text);
      } catch {
        throw new PlannerProviderError('invalid_json', 'The AI provider returned text that is not valid plan JSON.');
      }
      return { output, model: response.model ?? model, requestId: response._request_id ?? null, usage: response.usage ?? null };
    },
  };
}
