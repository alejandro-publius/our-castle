import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createFakeChannel3 } from '../helpers/fake-channel3.mjs';
import { createFakePayPal, webhookHeaders } from '../helpers/fake-paypal.mjs';
import { browser, familyWith, mutableClock, openStream, startServer } from '../helpers/family-http.mjs';

// Live updates for shared families over real HTTP: real server-sent-event streams read like a browser's EventSource,
// several families on one server, a controllable clock, and fake Channel3 and PayPal transports. No provider is called.
const root = fileURLToPath(new URL('../../', import.meta.url));
const REVISION = /^[A-Za-z0-9_-]{8}\.\d+$/;
const goalBody = (st, extra = {}) => ({ name: st.goal.name, targetCents: st.goal.targetCents, startingCents: st.progress.startingCents, weeklyBudgetCents: st.goal.weeklyBudgetCents, targetDate: st.goal.targetDate, ...extra });
const count = (revision) => Number(revision.split('.')[1]);
const until = async (check, ms = 2000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };

test('a change reaches only that household\'s open pages, as a bare revision; every state answer is ordered by it', async () => {
  const s = await startServer({ merchant: createMerchant({ apiKey: 'test-channel3-key', fetch: createFakeChannel3().fetch }) });
  const open = [];
  try {
    const { owner, Ash: adult, Wren: child } = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
    const { owner: other } = await familyWith(s); // an unrelated family on the same server
    // Not signed in: refused before any stream starts. Example mode has no stream at all.
    const stranger = await openStream(browser(s.origin));
    assert.equal(stranger.status, 401); assert.equal(stranger.json.error.code, 'session_required');
    for (const b of [owner, adult, child, other]) open.push(await openStream(b));
    const [ownerStream, adultStream, childStream, otherStream] = open;
    const readies = [];
    for (const st of open) {
      assert.equal(st.status, 200);
      assert.match(st.headers.get('content-type'), /^text\/event-stream/);
      assert.equal(st.headers.get('cache-control'), 'no-store');
      const ready = await st.next('ready');
      assert.deepEqual(Object.keys(ready.data), ['revision']); assert.match(ready.data.revision, REVISION);
      readies.push(ready.data.revision);
    }
    const seen = (await adult.call('GET', '/api/state')).json;
    assert.equal(seen.revision, readies[1], 'the stream opens at the revision the state shows');

    // An adult saves the goal: the write's own answer is newer than the read before it, and every member of this family,
    // and nobody else, is told the next revision. The event carries nothing else.
    const saved = await adult.call('PUT', '/api/goal', { ...goalBody(seen, { targetCents: 42000 }), expectedGoalRevision: seen.merchantGoalRevision });
    assert.equal(saved.status, 200);
    assert.ok(count(saved.json.state.revision) > count(seen.revision));
    const told = await Promise.all([ownerStream, adultStream, childStream].map((st) => st.next('invalidate')));
    for (const e of told) { assert.deepEqual(Object.keys(e.data), ['revision']); assert.ok(count(e.data.revision) > count(saved.json.state.revision)); }
    assert.deepEqual((await otherStream.quiet()).filter((e) => e.event === 'invalidate'), [], 'no cross-family notice');
    for (const st of open) assert.equal(/42000|420\.00|Ash|Wren|Rowan|hh_|goal_/.test(st.raw), false, 'no record, name or id travels on the stream');
    const childView = (await child.call('GET', '/api/state')).json;
    assert.equal(childView.goal.targetCents, 42000);
    assert.equal(childView.revision, told[2].data.revision, 'a read after the notice is at least that new');
    assert.equal((await other.call('GET', '/api/state')).json.goal.targetCents === 42000, false);

    // Reads, calculations, provider look-ups and refused writes change nothing and announce nothing.
    const quietFrom = ownerStream.events.length;
    assert.equal((await child.call('POST', '/api/plans/preview', { weeklyBudgetCents: 2000, targetDate: childView.goal.targetDate })).status, 200);
    assert.equal((await child.call('PUT', '/api/goal', { ...goalBody(childView), expectedGoalRevision: childView.merchantGoalRevision })).status, 403);
    const found = await adult.call('POST', '/api/merchant/search', { query: 'four person tent' });
    assert.equal(found.status, 200);
    await ownerStream.quiet(150);
    assert.deepEqual(ownerStream.events.slice(quietFrom), []);
    assert.equal((await child.call('GET', '/api/state')).json.revision, childView.revision);

    // A reviewed market goal (fake Channel3 product) is a change like any other.
    const item = found.json.results[0];
    const current = (await adult.call('GET', '/api/state')).json;
    const marketGoal = await adult.call('POST', '/api/merchant/goal', { draftId: item.draftId, goalId: found.json.goalId, expectedGoalRevision: found.json.goalRevision,
      goal: goalBody(current, { name: 'Family tent', targetCents: item.priceCents }) });
    assert.equal(marketGoal.status, 200, JSON.stringify(marketGoal.json));
    await childStream.next('invalidate');
    const after = (await child.call('GET', '/api/state')).json;
    assert.equal(after.goal.name, 'Family tent'); assert.equal(after.goalItem.title, item.title);
    assert.deepEqual((await otherStream.quiet()).filter((e) => e.event === 'invalidate'), []);
  } finally { for (const st of open) await st.close(); await s.close(); }
});

test('one simulated adult contribution: exactly one credit and one notice per page; a repeated request changes nothing', async () => {
  const s = await startServer();
  const open = [];
  try {
    const { owner, Ash: adult, Wren: child } = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
    for (const b of [owner, adult, child]) { const st = await openStream(b); await st.next('ready'); open.push(st); }
    const body = { amountCents: 1500, approvalConfirmed: true, requestId: 'ash-live-contribution-0001' };
    const paid = await adult.call('POST', '/api/example/contributions', body);
    assert.equal(paid.status, 200); assert.equal(paid.json.outcome, 'completed');
    for (const st of open) await st.next('invalidate');
    const views = await Promise.all([owner, child].map(async (b) => (await b.call('GET', '/api/state')).json));
    for (const v of views) {
      assert.equal(v.contributions.length, 1); assert.equal(v.progress.progressCents, 1500);
      assert.equal(v.contributions[0].id, paid.json.contribution.id, 'the same receipt on every page');
      assert.deepEqual(v.rewards.realm.districts.filter((d) => d.open).map((d) => d.id), paid.json.state.rewards.realm.districts.filter((d) => d.open).map((d) => d.id));
    }
    const again = await adult.call('POST', '/api/example/contributions', body);
    assert.equal(again.json.contribution.id, paid.json.contribution.id);
    assert.equal((await child.call('GET', '/api/state')).json.progress.progressCents, 1500, 'credited once');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE effect > 0 AND source_ref LIKE ?').get('%' + paid.json.contribution.id + '%').n <= 1, true);
    // The child's own attempt is refused before any payment work and announces nothing.
    const before = open[0].events.length;
    assert.equal((await child.call('POST', '/api/example/contributions', { ...body, requestId: 'wren-0001' })).status, 403);
    await open[0].quiet(150);
    assert.equal(open[0].events.filter((e, i) => i >= before && e.event === 'invalidate').length, 0);
  } finally { for (const st of open) await st.close(); await s.close(); }
});

test('sign-out, removed access, renewed and expired sessions end a stream at once; streams and background reads never keep a session alive', async () => {
  const clock = mutableClock();
  const s = await startServer({ clock });
  const open = [];
  try {
    const { owner, Ash: adult, Wren: child } = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
    const ownerStream = await openStream(owner), adultStream = await openStream(adult), childStream = await openStream(child);
    open.push(ownerStream, adultStream, childStream);
    for (const st of open) await st.next('ready');

    // The owner removes the child's access: the child's stream ends with that reason and the child's reads stop.
    const childId = (await owner.call('GET', '/api/state')).json.access.members.find((m) => m.name === 'Wren').id;
    assert.equal((await owner.call('POST', `/api/family/members/${childId}/revoke`, {})).status, 200);
    assert.deepEqual((await childStream.next('end')).data, { reason: 'access_revoked' });
    await childStream.done;
    assert.equal((await child.call('GET', '/api/state')).status, 401);
    assert.equal((await openStream(child)).status, 401, 'and it cannot open another');

    // Signing in again in the same browser renews the session: its old stream ends as "rotated", a new one opens.
    assert.equal((await adult.signIn()).done.status, 200);
    assert.deepEqual((await adultStream.next('end')).data, { reason: 'rotated' });
    const renewed = await openStream(adult); open.push(renewed); await renewed.next('ready');

    // Idle expiry: open streams and background reads are not activity, so 31 quiet minutes end the session.
    clock.advance(20 * 60_000);
    assert.equal((await owner.call('GET', '/api/state', undefined, { headers: { 'X-Our-Castle-Refresh': 'background' } })).status, 200);
    assert.equal((await adult.call('GET', '/api/state')).status, 200, 'a read the person makes is activity');
    clock.advance(11 * 60_000);
    s.app.live.recheck();
    assert.deepEqual((await ownerStream.next('end')).data, { reason: 'expired' });
    assert.equal((await owner.call('GET', '/api/state')).status, 401);
    assert.equal(renewed.ended, false, 'the active member keeps theirs');
    assert.equal((await adult.call('GET', '/api/state')).status, 200);

    // Sign-out ends that browser's stream.
    assert.equal((await adult.call('POST', '/api/auth/signout', {})).status, 200);
    assert.deepEqual((await renewed.next('end')).data, { reason: 'signed_out' });
    await until(() => s.app.live.stats().streams === 0);
    assert.deepEqual({ ...s.app.live.stats(), boot: null }, { streams: 0, households: 0, timer: false, boot: null }, 'no stream, listener or timer is left');
  } finally { for (const st of open) await st.close(); await s.close(); }
});

test('streams are bounded per session, per household and in total, and released when pages close or the server stops', async () => {
  const s = await startServer({ live: { perSession: 2, perHousehold: 3, total: 4 } });
  const open = [];
  try {
    const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
    const { owner: other } = await familyWith(s);
    const take = async (b) => { const st = await openStream(b); open.push(st); if (st.status === 200) await st.next('ready'); return st; };
    const first = await take(owner); await take(owner); await take(owner);
    assert.deepEqual((await first.next('end')).data, { reason: 'replaced' }, 'a third tab of one sign-in replaces the oldest');
    await take(adult);
    const busy = await take(adult);
    assert.equal(busy.status, 503); assert.equal(busy.json.error.code, 'live_busy', 'the household limit');
    await take(other);
    const full = await take(other);
    assert.equal(full.status, 503); assert.equal(full.json.error.code, 'live_busy', 'the server limit');
    assert.deepEqual({ streams: s.app.live.stats().streams, households: s.app.live.stats().households, timer: s.app.live.stats().timer }, { streams: 4, households: 2, timer: true });
    for (const st of open) await st.close();
    await until(() => s.app.live.stats().streams === 0);
    assert.equal(s.app.live.stats().timer, false);

    const last = await take(owner);
    s.app.live.close();
    assert.deepEqual((await last.next('end')).data, { reason: 'server_closing' });
    const refused = await openStream(owner);
    assert.equal(refused.status, 503); assert.equal(refused.json.error.code, 'live_unavailable');
  } finally { for (const st of open) await st.close(); await s.close(); }
});

test('a verified PayPal webhook tells only the household whose payment it settled (fake sandbox)', async () => {
  const fake = createFakePayPal({ captureStatus: 'PENDING' });
  const paypal = createPayPalClient({ clientId: 'public-sandbox-client-id', clientSecret: 'sandbox-secret-for-tests', fetch: fake.fetch });
  const s = await startServer({ env: { PAYPAL_CLIENT_ID: 'public-sandbox-client-id', PAYPAL_CLIENT_SECRET: 'sandbox-secret-for-tests', PAYPAL_WEBHOOK_ID: 'WH-TEST' }, paypal });
  const open = [];
  try {
    const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
    const { owner: other } = await familyWith(s);
    const created = await adult.call('POST', '/api/paypal/orders', { amountCents: 1500, approvalConfirmed: true, requestId: 'ash-sandbox-0001' });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const pending = await adult.call('POST', `/api/paypal/orders/${created.json.orderId}/capture`, {});
    assert.equal(pending.json.outcome, 'pending');
    const mine = await openStream(owner), theirs = await openStream(other);
    open.push(mine, theirs);
    await mine.next('ready'); await theirs.next('ready');
    const completed = fake.completePendingCapture(created.json.orderId);
    const event = { id: 'WH-LIVE-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { ...completed, supplementary_data: { related_ids: { order_id: created.json.orderId } } } };
    const delivered = await fetch(`${s.origin}/api/paypal/webhook`, { method: 'POST', headers: { ...webhookHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    assert.equal(delivered.status, 200);
    await mine.next('invalidate');
    assert.equal((await owner.call('GET', '/api/state')).json.progress.progressCents, 1500);
    assert.deepEqual((await theirs.quiet()).filter((e) => e.event === 'invalidate'), [], 'the other family hears nothing');
    // The same event again changes nothing, so nobody is told anything.
    await fetch(`${s.origin}/api/paypal/webhook`, { method: 'POST', headers: { ...webhookHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
    assert.deepEqual((await mine.quiet()).filter((e) => e.event === 'invalidate'), []);
  } finally { for (const st of open) await st.close(); await s.close(); }
});

test('a real restart on the same file keeps sessions; the new server start moves the revision so open pages read again', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-live-'));
  const file = path.join(dir, 'family.sqlite'), clock = mutableClock();
  let s = await startServer({ file, clock });
  const port = s.port;
  try {
    const { owner } = await familyWith(s);
    const before = await openStream(owner);
    const { revision } = (await before.next('ready')).data;
    await s.close();
    assert.deepEqual((await before.next('end')).data, { reason: 'server_closing' });
    s = await startServer({ file, clock, port });
    const after = await openStream(owner);
    const next = (await after.next('ready')).data.revision;
    assert.notEqual(next.split('.')[0], revision.split('.')[0], 'a new server start');
    assert.equal((await owner.call('GET', '/api/state')).json.revision, next);
    await after.close();
  } finally { await s.close(); }
});

test('example mode has no live stream and its state carries no revision', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ config: loadConfig({}, { root }), db, clock: mutableClock(), root });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(app.live, null);
    assert.equal((await fetch(`${base}/api/events`)).status, 404);
    assert.equal('revision' in (await (await fetch(`${base}/api/state`)).json()), false);
  } finally { await new Promise((r) => server.close(r)); db.close(); }
});
