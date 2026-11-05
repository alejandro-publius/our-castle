import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { treasuryFor } from '../../server/treasury.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';

// The Treasury's next-area milestone, derived from real example-mode server states produced by the same API the browser
// uses. Simulated example payments only; no provider is involved.
const root = fileURLToPath(new URL('../../', import.meta.url));
const LICENCE = 'test-studio-licence-not-real [v3]_[0102030405]_abcdef';
async function server(env = {}) {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig(env, { root }), db, clock: createClock(FIXED_NOW), root });
  const srv = http.createServer(app.handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* static */ }
    return { status: res.status, json, text, type: res.headers.get('content-type') };
  };
  return { call, close: () => new Promise((r) => { srv.close(r); db.close(); }) };
}
let n = 0;
const pay = async (s, state, amountCents, outcome = 'completed', requestId = `treasury-request-${String(++n).padStart(6, '0')}`) => (await s.call('POST', '/api/example/contributions', {
  householdId: state.household.id, goalId: state.goal.id, amountCents, approverId: 'm_rowan', approvalConfirmed: true, requestId, outcome,
})).json;
const next = (state) => state.treasury.nextArea && { ids: state.treasury.nextArea.ids, progress: state.treasury.nextArea.progressCents, threshold: state.treasury.nextArea.thresholdCents, remaining: state.treasury.nextArea.remainingCents };

test('the next area follows server progress: pending, duplicate and refunded payments, bills and the final milestone', async () => {
  const s = await server();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } })).json.state;
    // $60 reported of $300: the Manor (25%, $75) is next; the bill-habit garden is never a savings milestone.
    assert.deepEqual(next(state), { ids: ['manor'], progress: 6000, threshold: 7500, remaining: 1500 });
    assert.ok(!state.treasury.areas.some((a) => a.id === 'garden' || a.id === 'cottage'));
    assert.deepEqual(state.treasury.areas.map((a) => [a.id, a.thresholdCents]), [['manor', 7500], ['market', 12000], ['keep', 18000], ['wizard', 18000], ['castle', 30000], ['palace', 30000], ['rapunzel', 30000]]);

    // A pending or canceled payment changes nothing.
    const pending = await pay(s, state, 1500, 'pending');
    assert.deepEqual(next(pending.state), next(state));
    state = (await pay(s, pending.state, 1500, 'canceled')).state;
    assert.deepEqual(next(state), { ids: ['manor'], progress: 6000, threshold: 7500, remaining: 1500 });

    // Completing it opens the Manor; the Market is next. A replayed request is credited once.
    state = (await s.call('POST', `/api/example/contributions/${pending.contribution.id}/complete`, { householdId: state.household.id })).json.state;
    assert.deepEqual(next(state), { ids: ['market'], progress: 7500, threshold: 12000, remaining: 4500 });
    const first = await pay(s, state, 1000, 'completed', 'treasury-replay-000001');
    const again = await pay(s, first.state, 1000, 'completed', 'treasury-replay-000001');
    assert.deepEqual(next(again.state), { ids: ['market'], progress: 8500, threshold: 12000, remaining: 3500 });
    state = again.state;

    // A bill is recorded but never counts toward savings or the next area.
    state = (await s.call('POST', '/api/entries', { kind: 'bill_paid', label: 'Water bill', amountCents: 4000, memberId: 'm_rowan' })).json.state;
    assert.deepEqual(next(state), { ids: ['market'], progress: 8500, threshold: 12000, remaining: 3500 });

    // A refund lowers progress; the Manor stays open as a keepsake, so the Market is still next.
    const capture = state.contributions.find((c) => c.id === first.contribution.id).captures[0].captureId;
    state = (await s.call('POST', `/api/example/captures/${capture}/refund`, { householdId: state.household.id, approverId: 'm_rowan', approvalConfirmed: true })).json.state;
    assert.equal(state.rewards.realm.districts.find((d) => d.id === 'manor').open, true);
    assert.deepEqual(next(state), { ids: ['market'], progress: 7500, threshold: 12000, remaining: 4500 });

    // Districts that open together are one milestone: the Keep and the Observatory at 60%.
    state = (await pay(s, state, 4500)).state;
    assert.deepEqual(next(state), { ids: ['keep', 'wizard'], progress: 12000, threshold: 18000, remaining: 6000 });
    assert.equal(state.treasury.areas.find((a) => a.id === 'keep').groupLabel, 'Stone Keep & Starfall Observatory');

    // The final milestone opens the last three; nothing is next.
    state = (await pay(s, state, 18000)).state;
    assert.equal(state.treasury.nextArea, null);
    assert.ok(state.treasury.areas.every((a) => a.open && a.remainingCents === 0));
  } finally { await s.close(); }
});

test('a changed goal uses its own thresholds; the treasury is derived, never a second entitlement policy', async () => {
  const s = await server();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } })).json.state;
    state = (await s.call('PUT', '/api/goal', { name: 'Bigger trip', targetCents: 60000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate: state.goal.targetDate })).json.state;
    assert.deepEqual(next(state), { ids: ['manor'], progress: 6000, threshold: 15000, remaining: 9000 });
    // treasuryFor reads only the built state: open flags come from the server's realm access, not from arithmetic here.
    const forced = structuredClone(state);
    forced.rewards.realm.districts.find((d) => d.id === 'manor').open = true;
    assert.deepEqual(treasuryFor(forced).nextArea.ids, ['market']);
    assert.equal(treasuryFor(forced).areas.find((a) => a.id === 'manor').remainingCents, 0);
  } finally { await s.close(); }
});

test('only the AG Studio licence is readable by the page, only on its own route, and the bundle is served by exact path', async () => {
  const none = await server();
  try {
    assert.deepEqual((await none.call('GET', '/api/treasury/studio')).json, { licenseKey: null });
  } finally { await none.close(); }
  const s = await server({ AG_STUDIO_LICENSE_KEY: ` ${LICENCE} `, CHANNEL3_API_KEY: 'channel3-secret-not-real-77', AI_API_KEY: 'sk-ant-api-secret-not-real-12' });
  try {
    assert.deepEqual((await s.call('GET', '/api/treasury/studio')).json, { licenseKey: LICENCE });
    for (const path of ['/api/state', '/api/status', '/', '/src/app/treasury.js']) {
      const { text } = await s.call('GET', path);
      assert.ok(!text.includes(LICENCE), `${path} carries the licence`);
      for (const secret of ['channel3-secret-not-real-77', 'sk-ant-api-secret-not-real-12']) assert.ok(!text.includes(secret), `${path} leaked a secret`);
    }
    assert.ok(!(await s.call('GET', '/api/treasury/studio')).text.includes('channel3-secret'));
    const bundle = await s.call('GET', '/vendor/ag-studio/ag-studio.min.js');
    assert.equal(bundle.status, 200);
    assert.match(bundle.type, /text\/javascript/);
    assert.match(bundle.text.slice(0, 400), /agStudio/);
    for (const path of ['/node_modules/ag-studio/package.json', '/vendor/ag-studio/main.cjs.js', '/vendor/ag-studio/../ag-grid/x.js']) assert.equal((await s.call('GET', path)).status, 404, path);
  } finally { await s.close(); }
});
