import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicPlanner, PLAN_SCHEMA } from '../../server/planner/anthropic-provider.mjs';
import { computeBasis } from '../../server/planner/basis.mjs';
import { loadConfig } from '../../server/config.mjs';

// These tests run the real Anthropic SDK against a fake fetch. They check our request shape and
// error handling; they are not evidence that a live AI call succeeds.
const basis = computeBasis({
  goal: { name: 'Camping trip fund', targetCents: 30000, currency: 'USD', targetDate: '2026-12-29', weeklyBudgetCents: 3000 },
  progress: { startingCents: 6000, confirmedNetCents: 0, progressCents: 6000 },
  commitments: [{ label: 'Internet bill', amountCents: 6000, cadence: 'monthly' }],
  today: '2026-11-03',
});

function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ url: String(url), headers, body: JSON.parse(init.body) });
    const { status = 200, body } = respond(calls.length);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'request-id': 'req_fake_1' } });
  };
  return { fetch, calls };
}

const message = (text, extra = {}) => ({
  id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 20 }, ...extra,
});

test('sends a structured-output request with the explicit .env key, model and server-side fallback', async () => {
  const output = { headline: 'h', summary: 's', contributions: [], explanation: ['e'], milestoneNotes: [], cautions: [], claimedTotals: { plannedCents: 0, shortfallCents: 0, feasible: true } };
  const { fetch, calls } = fakeFetch(() => ({ body: message(JSON.stringify(output)) }));
  const planner = createAnthropicPlanner({ apiKey: 'sk-test-only', model: 'claude-opus-5-5', fetch, maxRetries: 0 });
  const result = await planner.proposePlan(basis);
  assert.deepEqual(result.output, output);
  assert.equal(result.model, 'claude-opus-5-5');

  const [call] = calls;
  assert.equal(new URL(call.url).origin + new URL(call.url).pathname, 'https://api.anthropic.com/v1/messages');
  // SDK 1.4.0 sends an explicit API key as "Authorization: Bearer <key>" (its apiKeyAuth path).
  assert.equal(call.headers.authorization, 'Bearer sk-test-only', 'only the AI_API_KEY value is sent');
  assert.doesNotMatch(call.headers['anthropic-beta'], /oauth/, 'no OAuth session marker');
  assert.match(call.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.ok(call.headers['anthropic-version'], 'API version header is set by the SDK');
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.deepEqual(call.body.output_config.format, { type: 'json_schema', schema: PLAN_SCHEMA });
  assert.equal(call.body.output_config.effort, 'medium');
  assert.equal(call.body.thinking, undefined);
  assert.equal(call.body.temperature, undefined);
  assert.match(call.body.system, /Never invent income/);
  const prompt = call.body.messages[0].content;
  assert.match(prompt, /"plannedCents": 24000/);
  assert.match(prompt, /Internet bill/);
  assert.match(prompt, /"2026-11-10"/);
});

test('refusals, truncation, invalid JSON and auth failures become typed planner errors', async () => {
  const cases = [
    [() => ({ body: message('', { stop_reason: 'refusal' }) }), 'refusal'],
    [() => ({ body: message('{"headline":', { stop_reason: 'max_tokens' }) }), 'truncated'],
    [() => ({ body: message('not json') }), 'invalid_json'],
    [() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }), 'auth'],
    [() => ({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }), 'rate_limited'],
  ];
  for (const [respond, kind] of cases) {
    const { fetch } = fakeFetch(respond);
    const planner = createAnthropicPlanner({ apiKey: 'sk-test-only', model: 'claude-opus-5-5', fetch, maxRetries: 0 });
    await assert.rejects(planner.proposePlan(basis), (error) => error.kind === kind, kind);
  }
});

test('the schema only uses keywords supported by structured outputs', () => {
  const banned = ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf', 'pattern'];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) assert.ok(!banned.includes(key), `unsupported keyword ${key}`);
    if (node.type === 'object') assert.equal(node.additionalProperties, false);
    Object.values(node).forEach(walk);
  };
  walk(PLAN_SCHEMA);
});

test('config: AI runs live only with AI_API_KEY from the server env, never ANTHROPIC_API_KEY', () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'sk-from-claude-code', ANTHROPIC_AUTH_TOKEN: 'oauth' }).ai.mode, 'example');
  const live = loadConfig({ AI_API_KEY: 'sk-app', AI_PROVIDER: 'anthropic' });
  assert.equal(live.ai.mode, 'live');
  assert.equal(live.ai.model, 'claude-opus-5-5');
  const unsupported = loadConfig({ AI_API_KEY: 'sk-app', AI_PROVIDER: 'other' });
  assert.equal(unsupported.ai.mode, 'example');
  assert.match(unsupported.warnings[0], /not supported/);
});

test('config: PayPal runs only against the sandbox and needs both credentials', () => {
  assert.equal(loadConfig({}).payments.mode, 'example');
  assert.equal(loadConfig({ PAYPAL_CLIENT_ID: 'id' }).payments.mode, 'example');
  const live = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_ENV: 'live' });
  assert.equal(live.payments.mode, 'example');
  assert.match(live.warnings.join(' '), /must be "sandbox"/);
  const sandbox = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' });
  assert.equal(sandbox.payments.mode, 'sandbox');
  assert.equal(sandbox.payments.apiBase, 'https://api-m.sandbox.paypal.com');
});
