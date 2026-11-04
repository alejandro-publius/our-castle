import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward, reconcileOrder } from '../../server/steward/index.mjs';
import { createPayPalReadTools } from '../../server/steward/paypal-tools.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// The steward loop runs through the real Anthropic SDK against a scripted fake transport, and PayPal
// lookups go to stubs or the fake sandbox. This checks our tool boundaries, not a live AI or PayPal call.

const message = (content, stop_reason = 'end_turn') => ({
  id: `msg_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_details: null, content, usage: { input_tokens: 5, output_tokens: 5 },
});

function scriptedAnthropic(turns) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const next = turns[Math.min(requests.length - 1, turns.length - 1)];
    const body = typeof next === 'function' ? next(requests.at(-1)) : next;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, requests };
}

async function sandboxWithCapture() {
  const env = setupDomain({ mode: 'sandbox' });
  const { orderId } = await env.service.createPayPalOrder(contribution({ amountCents: 1500 }));
  await env.service.capturePayPalOrder({ providerOrderId: orderId, householdId: env.householdId, goalId: env.goalId });
  return { ...env, orderId };
}

const ai = { apiKey: 'sk-test-only', model: 'claude-opus-5-5' };

test('the steward checks a payment with PayPal’s read-only get_order and reports a deterministic reconciliation', async () => {
  const env = await sandboxWithCapture();
  const lookups = [];
  const paypalTools = {
    getOrder: async (id) => { lookups.push(id); return (await env.paypal.getOrder(id)).data; },
    listTransactions: async () => ({ transaction_details: [] }),
  };
  const anthropic = scriptedAnthropic([
    message([{ type: 'tool_use', id: 'toolu_1', name: 'read_household_ledger', input: {} }, { type: 'tool_use', id: 'toolu_2', name: 'get_order', input: { order_id: env.orderId } }], 'tool_use'),
    message([{ type: 'text', text: `Yes — PayPal shows order ${env.orderId} completed for $15.00, and it is counted toward your $300.00 goal. The Keep is next at $180.00, $105.00 away.` }]),
  ]);
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, ai, paypalTools, fetch: anthropic.fetch, clock: env.clock });
  const result = await steward.ask({ question: 'Did PayPal confirm our $15 contribution?', memberId: 'm_wren' });

  assert.equal(result.status, 'ok');
  assert.match(result.answer, /completed for \$15\.00/);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(lookups, [env.orderId]);
  const paypalCheck = result.checks.find((c) => c.tool === 'get_order');
  assert.equal(paypalCheck.source, 'PayPal sandbox via Agent Toolkit');
  assert.equal(paypalCheck.reconciliation.verdict, 'match');
  assert.equal(paypalCheck.reconciliation.paypalAmountCents, 1500);

  const [first, second] = anthropic.requests;
  assert.deepEqual(first.tools.map((t) => t.name), ['read_household_ledger', 'get_order', 'list_transactions']);
  assert.deepEqual(first.tools[1].input_schema.properties.order_id.enum, [env.orderId], 'only this household’s orders can be looked up');
  assert.ok(first.tools.every((t) => t.strict === true));
  for (const forbidden of ['create_order', 'pay_order', 'create_refund', 'create_invoice', 'send_invoice', 'create_subscription']) {
    assert.ok(!first.tools.some((t) => t.name === forbidden), `${forbidden} must never be offered`);
  }
  assert.equal(first.fallbacks, 'default');
  assert.equal(first.output_config.effort, 'low');
  assert.match(first.system, /You are read-only/);
  assert.match(first.messages[0].content, /Wren \(child, example persona\)/);
  assert.equal(second.messages.length, 3, 'assistant tool_use turn is appended unchanged, then tool results');
  assert.equal(second.messages[2].content.length, 2);
});

test('the steward refuses lookups outside the household and flags figures it did not see', async () => {
  const env = await sandboxWithCapture();
  let called = false;
  const paypalTools = { getOrder: async () => { called = true; return {}; }, listTransactions: async () => ({}) };
  const anthropic = scriptedAnthropic([
    message([{ type: 'tool_use', id: 'toolu_1', name: 'get_order', input: { order_id: 'SOMEONEELSESORDER123' } }, { type: 'tool_use', id: 'toolu_2', name: 'create_refund', input: { capture_id: 'X' } }], 'tool_use'),
    message([{ type: 'text', text: 'You have saved $999.00 so far.' }]),
  ]);
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, ai, paypalTools, fetch: anthropic.fetch, clock: env.clock });
  const result = await steward.ask({ question: 'How much have we saved?', memberId: 'm_rowan' });
  assert.equal(called, false);
  const toolResults = anthropic.requests[1].messages[2].content;
  assert.ok(toolResults.every((r) => r.is_error === true));
  assert.match(toolResults[1].content, /not available/);
  assert.match(result.warnings.join(' '), /\$999\.00.*unverified/);
  assert.match(result.warnings.join(' '), /without checking/);
});

test('reconciliation flags a completed PayPal capture the ledger has not counted, without changing anything', () => {
  const ours = { id: 'ctb_1', providerOrderId: 'ORDER000001TEST', amountCents: 1500, currency: 'USD', status: 'pending', captures: [{ captureId: 'CAP', credited: false, refundedCents: 0 }] };
  const paypal = { id: 'ORDER000001TEST', status: 'COMPLETED', purchase_units: [{ reference_id: 'ctb_1', payments: { captures: [{ id: 'CAP', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' } }] } }] };
  assert.equal(reconcileOrder(paypal, ours).verdict, 'action');
  assert.equal(reconcileOrder({ ...paypal, purchase_units: [{ reference_id: 'ctb_1', payments: { captures: [{ id: 'CAP', status: 'COMPLETED', amount: { currency_code: 'USD', value: '50.00' } }] } }] }, { ...ours, status: 'completed', captures: [{ credited: true, refundedCents: 0 }] }).verdict, 'differs');
  assert.equal(reconcileOrder({ error: { message: 'x' } }, ours).verdict, 'unavailable');
});

test('without PayPal credentials the steward reads only the ledger; without an AI key it is unavailable', async () => {
  const env = setupDomain({ mode: 'example' });
  const anthropic = scriptedAnthropic([message([{ type: 'text', text: 'You have $60.00 tracked so far.' }])]);
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, ai, paypalTools: null, fetch: anthropic.fetch, clock: env.clock });
  assert.equal(steward.paypalToolsAvailable, false);
  const result = await steward.ask({ question: 'How are we doing?', memberId: 'm_rowan' });
  assert.deepEqual(anthropic.requests[0].tools.map((t) => t.name), ['read_household_ledger']);
  assert.match(anthropic.requests[0].messages[0].content, /PayPal tools are off/);
  assert.equal(result.status, 'ok');

  const off = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, ai: null, clock: env.clock });
  assert.equal(off.available, false);
  await assert.rejects(off.ask({ question: 'Hello there', memberId: 'm_rowan' }), { code: 'steward_unavailable' });
  await assert.rejects(steward.ask({ question: 'x', memberId: 'm_rowan' }), { code: 'invalid_question' });
});

test('provider failures are reported, not turned into an answer', async () => {
  const env = setupDomain({ mode: 'example' });
  const fetch = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId, ai, fetch, clock: env.clock });
  const result = await steward.ask({ question: 'How are we doing?', memberId: 'm_rowan' });
  assert.equal(result.status, 'provider_error');
  assert.equal(result.error.kind, 'auth');
});

test('PayPal Agent Toolkit wrapper: sandbox only, read-only tools only, server-built arguments', async () => {
  const real = createPayPalReadTools({ clientId: 'id', clientSecret: 'secret' });
  assert.deepEqual(real.tools.sort(), ['get_order', 'list_transactions']);
  assert.match(real.baseUrl, /sandbox\.paypal\.com/);

  const calls = [];
  const stub = (base, names) => ({
    client: { getBaseUrl: () => base },
    getTools: () => names.map((name) => ({ type: 'function', function: { name } })),
    handleToolCall: async (call) => { calls.push({ name: call.function.name, args: JSON.parse(call.function.arguments) }); return { role: 'tool', content: '{"ok":true}' }; },
  });
  assert.throws(() => createPayPalReadTools({ toolkit: stub('https://api.paypal.com', ['get_order']) }), /sandbox/);
  assert.throws(() => createPayPalReadTools({ toolkit: stub('https://api.sandbox.paypal.com', ['get_order', 'create_refund']) }), /not read-only/);

  const tools = createPayPalReadTools({ toolkit: stub('https://api.sandbox.paypal.com', ['get_order', 'list_transactions']), now: () => new Date('2026-11-03T20:00:00Z') });
  await tools.listTransactions({ days: 90, status: 'X' });
  assert.deepEqual(calls[0], { name: 'list_transactions', args: { start_date: '2026-10-03T20:00:00.000Z', end_date: '2026-11-03T20:00:00.000Z', transaction_status: 'S' } });
  await tools.getOrder('5O190127TN364715T');
  assert.deepEqual(calls[1], { name: 'get_order', args: { id: '5O190127TN364715T' } });
  assert.throws(() => tools.getOrder('../../v1/oauth2/token'), /Invalid PayPal order id/);
});
