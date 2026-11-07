import test from 'node:test';
import assert from 'node:assert/strict';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { familyWith, startServer } from '../helpers/family-http.mjs';

// The sponsor routes (Channel3 Merchant search, refresh, cheaper alternatives and saving; the AI steward) in a shared
// family, over real HTTP with FAKE Channel3 and Anthropic transports that count every call. Nothing reaches a provider.
const message = (text) => ({ id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 5 } });
function fakeAnthropic(text) {
  const requests = [];
  return { requests, fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return new Response(JSON.stringify(message(text)), { status: 200, headers: { 'Content-Type': 'application/json' } }); } };
}
const respond = (url) => (new URL(url).pathname.startsWith('/v1/products/') ? fakeProduct()
  : fakeSearchResponse([fakeProduct(), ...[120, 140].map((p, i) => fakeProduct({ id: `cheaper${i}`, title: `Test fixture: Cheaper tent ${i}`, offers: [{ ...fakeProduct().offers[0], price: { price: p, currency: 'USD' } }] }))]));
const goalBody = (st, extra = {}) => ({ name: st.goal.name, targetCents: st.goal.targetCents, startingCents: st.progress.startingCents, weeklyBudgetCents: st.goal.weeklyBudgetCents, targetDate: st.goal.targetDate, ...extra });

test('a child or another family is refused before the fake Channel3 or model is reached; an adult\'s results stay in their household', async () => {
  const channel3 = createFakeChannel3(respond);
  const anthropic = fakeAnthropic('Your last contribution is recorded in the ledger.');
  const s = await startServer({
    merchant: createMerchant({ apiKey: 'fake-test-key-not-real', fetch: channel3.fetch }),
    extra: { stewardAi: { apiKey: 'sk-test-only', model: 'claude-opus-5-5' }, stewardFetch: anthropic.fetch },
  });
  try {
    const { Ash: adult, Wren: child } = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
    const { owner: outsider } = await familyWith(s);
    const mine = (await adult.call('GET', '/api/state')).json, theirs = (await outsider.call('GET', '/api/state')).json;
    const found = await adult.call('POST', '/api/merchant/search', { query: 'four person tent' });
    assert.equal(found.status, 200);
    const shown = found.json.results[0];
    const provider = () => channel3.calls.length, model = () => anthropic.requests.length;
    const before = [provider(), model()];

    // The child: every Merchant route and the steward are refused by the route's rule, before any provider or model.
    for (const [url, body] of [
      ['/api/merchant/search', { query: 'four person tent' }],
      ['/api/merchant/refresh', { goalId: mine.goal.id, referenceId: shown.draftId }],
      ['/api/merchant/refresh', { goalId: mine.goal.id, saved: true }],
      ['/api/merchant/alternatives', { goalId: mine.goal.id, referenceId: shown.draftId, budgetCents: 15000 }],
      ['/api/merchant/goal', { draftId: shown.draftId, goalId: found.json.goalId, expectedGoalRevision: found.json.goalRevision, goal: goalBody(mine, { targetCents: shown.priceCents }) }],
      ['/api/steward', { question: 'Did PayPal confirm our last contribution?' }],
    ]) {
      const r = await child.call('POST', url, body);
      assert.equal(r.status, 403, url); assert.equal(r.json.error.code, 'adult_required', url);
    }
    // Another family's adult: this family's shown result, goal and saved item are refused before any provider call.
    for (const [url, body, status] of [
      ['/api/merchant/refresh', { goalId: theirs.goal.id, referenceId: shown.draftId }, 410],
      ['/api/merchant/alternatives', { goalId: theirs.goal.id, referenceId: shown.draftId, budgetCents: 15000 }, 410],
      ['/api/merchant/refresh', { goalId: mine.goal.id, saved: true }, 409],
      ['/api/merchant/goal', { draftId: shown.draftId, goalId: theirs.goal.id, expectedGoalRevision: theirs.merchantGoalRevision, goal: goalBody(theirs, { targetCents: shown.priceCents }) }, 410],
    ]) assert.equal((await outsider.call('POST', url, body)).status, status, `${url} ${JSON.stringify(body).slice(0, 40)}`);
    assert.deepEqual([provider(), model()], before, 'no Channel3 or model call for any refused request');
    assert.equal((await outsider.call('GET', '/api/state')).json.goal.name, theirs.goal.name);

    // The adult: refresh and cheaper alternatives reach the fake once each; the shown result saves only here.
    const fresh = await adult.call('POST', '/api/merchant/refresh', { goalId: mine.goal.id, referenceId: shown.draftId });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    const cheaper = await adult.call('POST', '/api/merchant/alternatives', { goalId: mine.goal.id, referenceId: shown.draftId, budgetCents: 15000 });
    assert.equal(cheaper.status, 200, JSON.stringify(cheaper.json));
    assert.equal(provider(), before[0] + 2);
    const pick = cheaper.json.results.find((r) => r.usable);
    const saved = await adult.call('POST', '/api/merchant/goal', { draftId: pick.draftId, goalId: cheaper.json.goalId, expectedGoalRevision: cheaper.json.goalRevision, goal: goalBody(mine, { name: 'Cheaper tent', targetCents: pick.priceCents }) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.state.goalItem.title, pick.title);
    assert.equal((await outsider.call('POST', '/api/merchant/goal', { draftId: pick.draftId, goalId: theirs.goal.id, expectedGoalRevision: theirs.merchantGoalRevision, goal: goalBody(theirs, { targetCents: pick.priceCents }) })).status, 410, 'a result shown to one family never saves for another');

    // The steward answers the adult from this household's records only (fake model): no other family's name or goal.
    const asked = await adult.call('POST', '/api/steward', { question: 'How close are we to the next milestone?' });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    assert.equal(model(), 1);
    const sent = JSON.stringify(anthropic.requests[0]);
    assert.equal(sent.includes(theirs.household.id) || sent.includes(theirs.goal.id), false);
    assert.equal((await outsider.call('POST', '/api/steward', { question: 'Did it go through?', focusOrderId: 'not-their-order' })).status, 404);
    assert.equal(model(), 1, 'an unknown order is refused before the model');
  } finally { await s.close(); }
});
