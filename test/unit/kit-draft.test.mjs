// "Draft listings" for the kit list (POST /api/kit/draft), over real HTTP on the playable family-trip example: invented
// shops and listings answered on this computer through the real merchant. No provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../../scripts/demo.mjs';
import { SAMPLE_LISTINGS, createFamilyTrip } from '../../scripts/family-trip.mjs';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { draftListings } from '../../server/kit/planner.mjs';
import { DEMO_HOUSEHOLD_ID, DomainError, createClock, getActiveGoal } from '../../server/household.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function trip() {
  const demo = await startDemo({ familyTrip: true });
  const call = async (method, path, body) => {
    const res = await fetch(demo.url + path, { method, headers: body ? { 'Content-Type': 'application/json', Origin: demo.url } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const state = async () => (await call('GET', '/api/state')).json;
  const draft = (memberId = 'm_rowan') => call('POST', '/api/kit/draft', { memberId });
  const clear = async (...names) => {
    for (const line of (await state()).kitPlan.lines.filter((l) => names.includes(l.name))) {
      for (const c of line.candidates) assert.equal((await call('POST', '/api/kit/listings/remove', { memberId: 'm_rowan', candidateId: c.id })).status, 200);
    }
  };
  return { demo, call, state, draft, clear };
}
const planning = (s) => JSON.stringify([s.kit, s.kitPlan, s.goal, s.progress, s.ledger, s.familyChoices]);

test('each line without a listing gets the lowest-priced result of its own search; lines with a listing and owned lines are left alone; nothing is saved', async () => {
  const t = await trip();
  try {
    assert.deepEqual((await t.draft()).json.lines, [], 'the example starts with a listing for every item still to get');
    await t.clear('sleeping bag', 'stove');
    const before = await t.state(), searches = t.demo.example.merchant.catalogue.calls.search;
    const res = await t.draft();
    assert.equal(res.status, 200);
    assert.equal(res.json.revision, before.kitPlan.revision);
    const price = (id) => SAMPLE_LISTINGS.find((l) => l.id === id).dollars * 100;
    assert.deepEqual(res.json.lines.map((l) => [l.name, l.remaining, l.shown, l.result.productId, l.result.priceCents, l.reason]), [
      ['sleeping bag', 2, 2, 'sampleBagSynthetic', price('sampleBagSynthetic'), null], // $20, not the $30 down bag
      ['stove', 1, 2, 'sampleStoveCamp', price('sampleStoveCamp'), null], // $30, not the $35 compact stove
    ]);
    assert.equal(planning(await t.state()), planning(before), 'drafting saves nothing');
    assert.ok(t.demo.example.merchant.catalogue.calls.search - searches <= 2, 'at most one search for each drafted line');

    // A drafted result is one this server showed the household, so an adult can add it with their own count.
    const bag = res.json.lines[0];
    const added = await t.call('POST', '/api/kit/listings', { memberId: 'm_rowan', draftId: bag.result.draftId, lineId: bag.lineId, perListing: 1, revision: before.kitPlan.revision });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.deepEqual(added.json.state.kitPlan.lines.find((l) => l.name === 'sleeping bag').candidates.map((c) => [c.title, c.priceCents, c.perListing, c.issue]),
      [['Sample: Sleeping bag, synthetic', 2000, 1, null]]);
    assert.deepEqual((await t.draft()).json.lines.map((l) => l.name), ['stove'], 'a line that now has a listing is no longer drafted');
  } finally { await t.demo.close(); }
});

test('only an adult may draft', async () => {
  const t = await trip();
  try {
    await t.clear('stove');
    const refused = await t.draft('m_wren');
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error.code, 'adult_required');
  } finally { await t.demo.close(); }
});

test('a line whose search fails, shows nothing or shows nothing usable says so, and the other lines are still answered', async () => {
  // The same seeded example, reached directly so each search can be answered here.
  const db = openDatabase(':memory:'), clock = createClock(), example = createFamilyTrip({ clock });
  const app = createApp({ config: loadConfig({ PORT: '0' }, { root }), db, clock, root, example, merchant: example.merchant });
  try {
    await app.seedExample();
    db.prepare('DELETE FROM kit_candidates').run(); // no line has a listing yet
    const goalId = getActiveGoal(db, DEMO_HOUSEHOLD_ID).id;
    const row = (over) => ({ usable: true, draftId: 'c3d_x', currency: 'USD', priceCents: 500, availability: 'InStock', ...over });
    const answers = {
      '4-person tent': () => { throw new DomainError(429, 'merchant_busy', 'That is a lot of searches in one minute. Wait a moment, then search again.'); },
      'sleeping bag': () => ({ results: [] }),
      // Cheaper results that a comparison could not use are passed over: out of stock, another currency, no price.
      stove: () => ({ results: [row({ priceCents: 100, availability: 'OutOfStock' }), row({ priceCents: 200, currency: 'EUR' }), row({ priceCents: 900, draftId: 'c3d_ok' }), row({ priceCents: 300, usable: false })] }),
    };
    const asked = [];
    const res = await draftListings(db, { householdId: DEMO_HOUSEHOLD_ID, goalId, actor: { memberId: 'm_rowan', role: 'adult' } },
      { now: Date.now(), search: async (query) => { asked.push(query); return answers[query](); } });
    assert.deepEqual(asked, ['4-person tent', 'sleeping bag', 'stove']);
    assert.deepEqual(res.lines.map((l) => [l.name, l.shown, l.result?.draftId ?? null, l.reason]), [
      ['4-person tent', 0, null, 'That is a lot of searches in one minute. Wait a moment, then search again.'],
      ['sleeping bag', 0, null, 'The search showed no results.'],
      ['stove', 4, 'c3d_ok', null],
    ]);
    const none = await draftListings(db, { householdId: DEMO_HOUSEHOLD_ID, goalId, actor: { memberId: 'm_rowan', role: 'adult' } },
      { now: Date.now(), search: async () => ({ results: [row({ availability: 'OutOfStock' })] }) });
    assert.deepEqual(new Set(none.lines.map((l) => l.reason)), new Set(['None of the results shown is in stock with a usable price in the goal currency.']));
    // A failure that is not a refusal is not turned into a line's reason.
    await assert.rejects(draftListings(db, { householdId: DEMO_HOUSEHOLD_ID, goalId, actor: { memberId: 'm_rowan', role: 'adult' } },
      { now: Date.now(), search: async () => { throw new TypeError('bug'); } }), TypeError);
  } finally { app.close(); db.close(); }
});
