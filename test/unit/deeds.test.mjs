import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';
import { districtDeed, newlyOpenedDistricts, districtResidents, rewardIdFor } from '../../src/core/deeds.js';

// District deeds are derived from real example-mode server states, produced by the same API the browser uses.
const root = fileURLToPath(new URL('../../', import.meta.url));
async function exampleServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock: createClock(FIXED_NOW), paypal: null, aiProvider: null, root });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const json = method === 'GET' ? undefined : JSON.stringify(body ?? {});
    const response = await fetch(base + path, { method, headers: json ? { 'Content-Type': 'application/json' } : {}, body: json });
    const result = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
  return { call, close: () => new Promise((r) => { server.close(r); db.close(); }) };
}
let requests = 0;
const adultOf = (state) => state.members.find((m) => m.role === 'adult');
const pay = (s, state, amountCents, outcome, requestId = `deeds-request-${++requests}`) => s.call('POST', '/api/example/contributions', {
  householdId: state.household.id, goalId: state.goal.id, amountCents, approverId: adultOf(state).id, approvalConfirmed: true, requestId, outcome,
});

test('only districts the server newly opens for the same household and goal produce a deed', async () => {
  const s = await exampleServer();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Rivergate', crest: { field: 'cobalt', charge: 'stag' } })).state;
    // A first load or reload has no previous state; an unchanged state opens nothing.
    assert.deepEqual(newlyOpenedDistricts(null, state), []);
    assert.deepEqual(newlyOpenedDistricts(state, structuredClone(state)), []);

    // Canceled and pending payments open nothing.
    let prev = state;
    state = (await pay(s, state, 1500, 'canceled')).state;
    assert.deepEqual(newlyOpenedDistricts(prev, state), []);
    prev = state;
    const pending = await pay(s, state, 1500, 'pending');
    state = pending.state;
    assert.deepEqual(newlyOpenedDistricts(prev, state), []);

    // The server completing it opens the manor: one deed.
    prev = state;
    state = (await s.call('POST', `/api/example/contributions/${pending.contribution.id}/complete`, { householdId: state.household.id })).state;
    assert.deepEqual(newlyOpenedDistricts(prev, state), ['manor']);

    // A replayed capture (same request) changes nothing.
    prev = state;
    const replay = await pay(s, state, 2000, 'completed', 'deeds-request-replay');
    const again = await pay(s, replay.state, 2000, 'completed', 'deeds-request-replay');
    assert.deepEqual(newlyOpenedDistricts(replay.state, again.state), []);
    state = again.state;

    // A refund keeps the manor as a keepsake (no deed is taken away or re-announced); re-crossing announces nothing.
    const refundOf = async (st, c) => (await s.call('POST', `/api/example/captures/${c.captures[0].captureId}/refund`, { householdId: st.household.id, approverId: adultOf(st).id, approvalConfirmed: true })).state;
    for (const c of state.contributions.filter((x) => x.status === 'completed')) { prev = state; state = await refundOf(state, c); assert.deepEqual(newlyOpenedDistricts(prev, state), []); }
    assert.equal(state.progress.progressCents, 6000);
    assert.equal(districtDeed(state, 'manor').status, 'keepsake');
    prev = state;
    state = (await pay(s, state, 1500, 'completed')).state;
    assert.deepEqual(newlyOpenedDistricts(prev, state), []);
    assert.equal(districtDeed(state, 'manor').status, 'earned');

    // One large contribution opens several districts at once, in realm order.
    prev = state;
    state = (await pay(s, state, 12000, 'completed')).state; // $75 → $195 (65%)
    assert.deepEqual(newlyOpenedDistricts(prev, state), ['market', 'keep']);

    // A self-reported bill habit opens the Woodland Garden.
    prev = state;
    state = (await s.call('POST', '/api/entries', { kind: 'bill_paid', label: 'Water bill', amountCents: 4000, memberId: adultOf(state).id })).state;
    assert.deepEqual(newlyOpenedDistricts(prev, state), ['garden']);

    // A different goal is never compared with the previous one.
    assert.deepEqual(newlyOpenedDistricts({ ...prev, goal: { ...prev.goal, id: 'another-goal' } }, state), []);
  } finally { await s.close(); }
});

test('each deed shows the real buildings, guests, exact condition and honest evidence', async () => {
  const s = await exampleServer();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Rivergate', crest: { field: 'cobalt', charge: 'stag' } })).state;
    state = (await pay(s, state, 1500, 'completed')).state;

    const manor = districtDeed(state, 'manor');
    assert.equal(manor.status, 'earned');
    assert.equal(manor.earned, 'Earned: Reach 25% of the shared goal ($75.00 tracked)');
    assert.equal(manor.evidence, 'Goal ledger: $60.00 reported by you + $15.00 from simulated example payments');
    assert.equal(manor.stamp, 'Realm keepsake · Example mode · simulated payments');
    assert.equal(manor.court.short, '4 guests, including Princess Elowen');
    assert.deepEqual(manor.court.names, ['Princess Elowen', 'Lady Mira', 'Pip', 'Oswin']);
    assert.match(manor.stands[0], /cobalt roof with a crimson-roofed wing/);
    assert.equal(manor.art, 'assets/area-cards/manor.png');

    // The starting village holds the porch addition with its real status; the keep shows the ramparts still locked.
    const village = districtDeed(state, 'cottage');
    assert.equal(village.earned, 'Your starting village');
    assert.deepEqual(village.additions.map((a) => [a.name, a.status]), [['The welcoming porch', 'unlocked']]);
    const keep = districtDeed(state, 'keep');
    assert.equal(keep.status, 'locked');
    assert.equal(keep.earned, 'Locked: Reach 60% of the shared goal ($180.00 tracked)');
    assert.deepEqual(keep.additions.map((a) => [a.name, a.status]), [['The outer ramparts', 'locked']]);

    // The market and garden gain no invented court guests.
    assert.equal(districtResidents('market').length, 0);
    assert.equal(districtDeed(state, 'market').court.text, 'No court guests are assigned here.');
    assert.equal(districtResidents('garden').length, 0);

    // The garden is a self-reported habit; the provider-required water garden stays locked.
    state = (await s.call('POST', '/api/entries', { kind: 'bill_paid', label: 'Water bill', amountCents: 4000, memberId: adultOf(state).id })).state;
    const garden = districtDeed(state, 'garden');
    assert.equal(garden.status, 'earned');
    assert.equal(garden.selfReported, true);
    assert.equal(garden.stamp, 'Realm keepsake · self-reported habit, not verified by any bill provider');
    assert.match(garden.evidence, /Recorded by you · not verified by any provider · never counted as savings/);
    assert.deepEqual(garden.providerLocked, ['The water garden']);
    assert.match(garden.stands.join(' '), /1 of 4 habit garden beds planted/);

    // PayPal sandbox evidence says test money, never more.
    const sandbox = districtDeed({ ...state, modes: { ...state.modes, payments: { mode: 'sandbox' } } }, 'manor');
    assert.equal(sandbox.stamp, 'Realm keepsake · PayPal sandbox · test money');

    // Every district maps to the reward that opens it.
    assert.deepEqual(['cottage', 'manor', 'market', 'garden', 'keep', 'castle'].map(rewardIdFor), ['home:cottage', 'home:manor', 'estate:market', 'habit:garden', 'home:keep', 'home:castle']);
  } finally { await s.close(); }
});
