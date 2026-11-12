import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { treasuryFor, treasuryHolds, treasuryWeek } from '../../server/treasury.mjs';
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

test('This week compares accepted dated plans with net recorded contributions, never starting reports or pending money', () => {
  const entry = (id, kind, amountCents, effect, createdAt, source = 'paypal-sandbox') => ({ id, kind, amountCents, effect, createdAt, source });
  const state = { goal: { targetCents: 30000 }, progress: { startingCents: 6000 }, contributions: [{ id: 'pending', status: 'pending', captures: [], createdAt: '2026-11-06T12:00:00Z' }], ledger: { bills: [], gifts: [], goalEntries: [
    entry(1, 'starting_progress', 6000, 1, '2026-11-02T00:00:00Z', 'user-reported'),
    entry(2, 'contribution', 1500, 1, '2026-11-02T00:00:00Z'),
    entry(3, 'simulated_contribution', 500, 1, '2026-11-06T12:00:00Z', 'simulated'),
    entry(4, 'refund', 3000, -1, '2026-11-08T23:59:59Z'),
    entry(5, 'contribution', 9900, 1, '2026-11-09T00:00:00Z'),
    entry(6, 'contribution', 7700, 1, '2026-11-01T23:59:59Z'),
  ] } };
  const plan = { status: 'accepted', contributions: [{ date: '2026-11-01', amountCents: 900 }, { date: '2026-11-02', amountCents: 2000 }, { date: '2026-11-08', amountCents: 1000 }, { date: '2026-11-09', amountCents: 7000 }] };
  const week = treasuryWeek(state, '2026-11-08T23:59:59Z', plan);
  assert.equal(week.start, '2026-11-02'); assert.equal(week.end, '2026-11-09');
  assert.equal(week.plannedCents, 3000); assert.equal(week.receivedCents, 2000); assert.equal(week.refundedCents, 3000); assert.equal(week.netCents, -1000);
  assert.equal(week.startingCents, 6000); assert.deepEqual(week.records.map((r) => r.id), ['2', '3', '4']);
  assert.deepEqual(week.sources, ['paypal-sandbox', 'simulated']);
  assert.equal(treasuryWeek(state, '2026-11-06T00:00:00Z', { ...plan, status: 'proposed' }).plannedCents, null);
  assert.equal(treasuryWeek(state, '2026-11-16T00:00:00Z', plan).plannedCents, 0, 'zero due is distinct from no plan');
  assert.equal(treasuryWeek(state, '2026-11-16T00:00:00Z', plan).netCents, 0);
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

test('open holds are listed for the Treasury with their guarantee and their 29 days; a hold that is over is not', async () => {
  const s = await server();
  try {
    let state = (await s.call('POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } })).json.state;
    assert.deepEqual(state.treasury.holds, []);
    const owner = { householdId: state.household.id, goalId: state.goal.id, approverId: 'm_rowan', approvalConfirmed: true };
    const act = async (path, body) => { const res = await s.call('POST', path, { ...owner, requestId: `treasury-hold-${String(++n).padStart(6, '0')}`, ...body }); assert.equal(res.status, 200, res.text); return res.json; };
    const held = await act('/api/example/contributions', { amountCents: 4000, hold: true });
    const id = held.contribution.id;
    state = (await s.call('GET', '/api/state')).json;
    // Placed just now: all of it held, three guaranteed days of twenty-nine, and nothing counted.
    assert.equal(state.treasury.holds.length, 1);
    const [row] = state.treasury.holds;
    assert.deepEqual({ ...row, honorUntil: null, expiresAt: null, recordId: null }, {
      id, recordId: null, simulated: true, heldCents: 4000, releasedCents: 0, remainingCents: 4000, currency: 'USD', phase: 'guaranteed', pending: null,
      extended: false, canExtend: false, honorUntil: null, expiresAt: null, guaranteedDays: 3, daysLeft: 29, elapsedShare: 0, guaranteeFromShare: 0, guaranteeToShare: 3 / 29,
    });
    assert.equal(Date.parse(row.expiresAt) - Date.parse(row.honorUntil), 26 * 86_400_000);
    assert.equal(row.recordId, `order:${id}`, 'the row opens this hold’s own ledger record');
    assert.equal(state.progress.progressCents, 6000);
    assert.equal(state.treasury.week.netCents, 0, 'a hold is not a contribution recorded this week');
    // The same records read on later days: the guarantee runs out, the days count down, and today moves along.
    const placed = Date.parse(row.expiresAt) - 29 * 86_400_000, on = (day) => treasuryHolds(state, new Date(placed + day * 86_400_000).toISOString())[0];
    assert.deepEqual([on(2.5).guaranteedDays, on(2.5).daysLeft, on(2.5).elapsedShare], [1, 27, 2.5 / 29]);
    assert.deepEqual([on(4).guaranteedDays, on(4).daysLeft, on(4).elapsedShare], [0, 25, 4 / 29]);
    assert.deepEqual([on(40).guaranteedDays, on(40).daysLeft, on(40).elapsedShare], [0, 0, 1]);
    // A release that keeps the rest held leaves the row, with less held; the released part alone is progress.
    await act(`/api/contributions/${id}/release`, { amountCents: 1000, keepRest: true });
    state = (await s.call('GET', '/api/state')).json;
    assert.deepEqual(state.treasury.holds.map((h) => [h.id, h.heldCents, h.releasedCents, h.remainingCents]), [[id, 4000, 1000, 3000]]);
    assert.equal(state.progress.progressCents, 7000);
    assert.notEqual(state.treasury.holds[0].recordId, `order:${id}`, 'once part is counted, the row opens that counted record');
    // A second hold is listed after the first, which was placed no later. Returning the first ends its row only.
    const second = (await act('/api/example/contributions', { amountCents: 1500, hold: true })).contribution.id;
    await act(`/api/contributions/${id}/return`, {});
    state = (await s.call('GET', '/api/state')).json;
    assert.deepEqual(state.treasury.holds.map((h) => [h.id, h.remainingCents]), [[second, 1500]]);
    assert.equal(state.progress.progressCents, 7000);
  } finally { await s.close(); }
});
