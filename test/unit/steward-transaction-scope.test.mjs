import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteward } from '../../server/steward/index.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

test('merchant search exposes only this household’s recorded capture and no payer, merchant totals or unrelated records', async () => {
  const env = setupDomain({ mode: 'sandbox' });
  try {
    const { orderId } = await env.service.createPayPalOrder(contribution({ amountCents: 1500 }));
    await env.service.capturePayPalOrder({ providerOrderId: orderId, householdId: env.householdId, goalId: env.goalId });
    const captureId = env.service.contributions(env.goalId)[0].captures[0].captureId;
    const requests = [];
    const result = { total_items: 222, account_number: 'PRIVATE_MERCHANT', transaction_details: [
      { transaction_info: { transaction_id: captureId, transaction_status: 'S', transaction_amount: { currency_code: 'USD', value: '15.00' }, fee_amount: { currency_code: 'USD', value: '-0.74' }, transaction_note: 'PRIVATE_NOTE' }, payer_info: { email_address: 'PRIVATE_EMAIL' } },
      { transaction_info: { transaction_id: 'OTHER_FAMILY_CAPTURE', paypal_reference_id: orderId, transaction_amount: { currency_code: 'USD', value: '987.65' }, custom_field: captureId } },
    ] };
    const steward = createSteward({ db: env.db, contributions: env.service, householdId: env.householdId,
      clock: env.clock, ai: { apiKey: 'synthetic-only', model: 'claude-opus-5-5' },
      paypalTools: { getOrder: async () => assert.fail('unexpected lookup'), listTransactions: async () => result },
      fetch: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        const content = requests.length === 1
          ? [{ type: 'tool_use', id: 'scope_tool', name: 'list_transactions', input: { days: 7, status: 'S' } }]
          : [{ type: 'text', text: 'Your contribution is $15.00.' }];
        return new Response(JSON.stringify({ id: 'msg_scope', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content,
          stop_reason: requests.length === 1 ? 'tool_use' : 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'Content-Type': 'application/json' } });
      } });
    const answer = await steward.ask({ question: 'What payments are listed?', memberId: 'm_rowan' });
    const shown = JSON.parse(requests[1].messages[2].content[0].content);
    assert.equal(shown.transaction_details.length, 1);
    assert.equal(shown.transaction_details[0].transaction_info.transaction_id, captureId);
    assert.equal(shown.transaction_details[0].transaction_info.fee_amount.value, '-0.74');
    assert.doesNotMatch(JSON.stringify(requests[1]), /OTHER_FAMILY|PRIVATE_|987\.65|total_items/);
    assert.match(answer.checks[0].summary, /1 found/);
  } finally { env.db.close(); }
});
