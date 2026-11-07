import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { ConfigError, accessConfig, loadConfig } from '../../server/config.mjs';
import { MIGRATIONS, databaseFile, openDatabase } from '../../server/db.mjs';
import { ROUTE_POLICIES, policyFor, routeKey } from '../../server/access/policy.mjs';
import { hashToken } from '../../server/access/primitives.mjs';
import { browser, familyWith, mutableClock, startServer, tokenOf } from '../helpers/family-http.mjs';

// Family access over real HTTP (helpers in test/helpers/family-http.mjs). No provider is configured.

// ---------------------------------------------------------------------------------------------------------------------

test('family mode is chosen only by server configuration, with an exact usable origin', () => {
  assert.deepEqual(accessConfig(undefined, undefined), { mode: 'example' });
  assert.equal(accessConfig('family', 'http://localhost:3200').rpId, 'localhost');
  assert.equal(accessConfig('family', 'https://castle.example').secure, true);
  for (const [mode, origin] of [['family', ''], ['family', 'http://127.0.0.1:3200'], ['family', 'http://castle.example'], ['family', 'http://localhost:3200/app'], ['family', 'http://u:p@localhost:3200'], ['root', 'http://localhost:3200']]) {
    assert.throws(() => accessConfig(mode, origin), ConfigError, `${mode} ${origin}`);
  }
  assert.equal(loadConfig({}).access.mode, 'example', 'nothing in a request or default selects family mode');
  assert.match(databaseFile('/d', 'example', 'family'), /our-castle-family-example\.sqlite$/);
  assert.match(databaseFile('/d', 'example'), /our-castle-example\.sqlite$/);
});

test('every route has exactly one access rule, and every rule is a real route (fail closed for new ones)', async () => {
  const s = await startServer();
  try {
    const sample = (p) => (typeof p === 'string' ? p : p.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace(/\(\[\\w-\]\+\)/g, 'x'));
    const routes = s.app.routes.map(({ method, pattern }) => routeKey(method, pattern));
    const rules = ROUTE_POLICIES.map(({ method, pattern }) => routeKey(method, pattern));
    assert.deepEqual([...routes].sort(), [...rules].sort());
    for (const { method, pattern } of s.app.routes) assert.ok(policyFor(method, sample(pattern)), `${method} ${sample(pattern)}`);
    // An unlisted route is refused, even before a session is checked.
    const r = await browser(s.origin).call('GET', '/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(policyFor('POST', '/api/new-sponsor-route'), null);
  } finally { await s.close(); }
});

test('create a family: one owner, zero progress, no example data; session cookie is opaque, HttpOnly and SameSite', async () => {
  const s = await startServer();
  try {
    const owner = browser(s.origin);
    assert.deepEqual((await owner.call('GET', '/api/session')).json, { mode: 'family', signedIn: false });
    assert.equal((await owner.call('GET', '/api/state')).status, 401, 'nothing is readable before sign-in');
    const { done } = await owner.createFamily('Rowan');
    assert.equal(done.status, 200);
    const cookie = done.headers.getSetCookie().find((c) => c.startsWith('oc_session='));
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Secure/, 'http://localhost');
    const token = owner.jar.get('oc_session');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(hashToken(token)).n, 1, 'stored only as a hash');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
    const { json: state } = await owner.call('GET', '/api/state');
    assert.equal(state.household.isExample, false);
    assert.equal(state.members.length, 1);
    assert.deepEqual(state.access.me, { memberId: state.members[0].id, role: 'adult', owner: true });
    assert.equal(state.progress.progressCents, 0);
    assert.equal(state.contributions.length, 0);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM households WHERE id = 'hh_demo'").get().n, 0, 'no example household in family mode');
    // Founding the house names it without replacing members.
    const founded = await owner.call('POST', '/api/setup', { name: 'House of Alder', crest: { field: 'violet', charge: 'stag' }, playMode: 'solo' });
    assert.equal(founded.status, 200);
    assert.equal(founded.json.state.household.name, 'House of Alder');
    assert.deepEqual(founded.json.state.members.map((m) => m.name), ['Rowan']);
  } finally { await s.close(); }
});

test('passkey ceremonies refuse another origin or relying party, no user verification, replays, expiry and other windows', async () => {
  const s = await startServer();
  try {
    const accounts = () => s.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    for (const [label, fault] of [
      ['origin', { origin: 'https://evil.example' }], ['relying party', { rpId: 'evil.example' }], ['no user verification', { userVerified: false }],
      ['wrong type', { type: 'webauthn.get' }], ['other challenge', { challenge: 'bm90LXRoZS1jaGFsbGVuZ2U' }],
    ]) {
      const b = browser(s.origin);
      const { done } = await b.createFamily('Mallory', fault);
      assert.equal(done.status, 400, label); assert.equal(done.json.error.code, 'passkey_rejected', label);
    }
    assert.equal(accounts(), 0, 'nothing saved');

    // A challenge is single use: replaying the same registration fails even though it was valid once.
    const a = browser(s.origin);
    const first = await a.createFamily('Rowan');
    assert.equal(first.done.status, 200);
    const replay = await a.call('POST', '/api/auth/family/verify', { ceremonyId: first.start.ceremonyId, response: first.response });
    assert.equal(replay.status, 400); assert.equal(replay.json.error.code, 'ceremony_expired');
    // A ceremony started in one browser cannot be finished from another.
    const b = browser(s.origin);
    const start = await b.call('POST', '/api/auth/family/options', { displayName: 'Ash' });
    const thief = browser(s.origin);
    const stolen = await thief.call('POST', '/api/auth/family/verify', { ceremonyId: start.json.ceremonyId, response: b.auth.register(start.json.options, { origin: s.origin }) });
    assert.equal(stolen.status, 400); assert.equal(stolen.json.error.code, 'ceremony_expired');
    // An expired challenge is refused.
    const late = browser(s.origin);
    const lateStart = await late.call('POST', '/api/auth/family/options', { displayName: 'Ash' });
    s.clock.advance(6 * 60_000);
    const expired = await late.call('POST', '/api/auth/family/verify', { ceremonyId: lateStart.json.ceremonyId, response: late.auth.register(lateStart.json.options, { origin: s.origin }) });
    assert.equal(expired.status, 400); assert.equal(expired.json.error.code, 'ceremony_expired');
    assert.equal(accounts(), 1);

    // Sign-in: wrong origin, no UV and a cloned (non-increasing) counter are refused; a good assertion rotates the session.
    const before = a.jar.get('oc_session');
    for (const [label, fault] of [['origin', { origin: 'https://evil.example' }], ['rp', { rpId: 'evil.example' }], ['uv', { userVerified: false }]]) {
      const r = await a.signIn(fault);
      assert.equal(r.done.status, 400, label);
    }
    const ok = await a.signIn();
    assert.equal(ok.done.status, 200);
    assert.notEqual(a.jar.get('oc_session'), before, 'a new session identifier after sign-in');
    const stale = browser(s.origin); stale.jar.set('oc_session', before);
    assert.equal((await stale.call('GET', '/api/state')).status, 401, 'the previous session was revoked');
    const cloned = await a.signIn({ counter: 1 });
    assert.equal(cloned.done.status, 400, 'counter did not increase');
    // An unknown credential and a missing ceremony are refused.
    const stranger = browser(s.origin);
    stranger.auth.register({ rp: { id: 'localhost' }, user: { id: 'eA' }, challenge: 'eA' }, { origin: s.origin });
    assert.equal((await stranger.signIn()).done.status, 400);
    assert.equal((await stranger.call('POST', '/api/auth/signin/verify', { ceremonyId: 'chl_none', response: {} })).status, 400);
  } finally { await s.close(); }
});

test('sessions: CSRF required for writes, idle and absolute expiry, sign-out, and exact host and origin', async () => {
  const s = await startServer();
  try {
    const { owner } = await familyWith(s);
    const body = { name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } };
    assert.equal((await owner.call('PUT', '/api/house', body, { csrf: false })).json.error.code, 'csrf_failed');
    assert.equal((await owner.call('PUT', '/api/house', body, { headers: { 'X-CSRF-Token': 'forged' }, csrf: false })).status, 403);
    assert.equal((await owner.call('PUT', '/api/house', body)).status, 200);
    assert.equal((await owner.call('PUT', '/api/house', body, { headers: { Origin: 'https://evil.example' } })).json.error.code, 'origin_not_allowed');
    assert.equal((await owner.call('PUT', '/api/house', body, { headers: { Origin: '' } })).status, 403, 'a write without Origin');
    assert.equal((await owner.call('GET', '/api/state', undefined, { base: s.origin.replace('localhost', '127.0.0.1') })).json.error.code, 'host_not_allowed');
    const page = await owner.call('GET', '/', undefined, { base: s.origin.replace('localhost', '127.0.0.1') });
    assert.equal(page.status, 302); assert.equal(page.headers.get('location'), `${s.origin}/`);
    // Idle: 31 minutes without a request ends the session; the page is told to sign in again.
    s.clock.advance(31 * 60_000);
    const idle = await owner.call('GET', '/api/state');
    assert.equal(idle.status, 401); assert.equal(idle.json.error.code, 'session_expired');
    assert.equal(owner.jar.has('oc_session'), false, 'the stale cookie is cleared');
    // Absolute: even an active session ends after 12 hours.
    await owner.signIn();
    for (let i = 0; i < 24; i++) { s.clock.advance(29 * 60_000); assert.equal((await owner.call('GET', '/api/state')).status, 200, `active at ${i}`); }
    s.clock.advance(25 * 60_000); // 12 h 1 min after sign-in, 25 min after the last request
    assert.equal((await owner.call('GET', '/api/state')).status, 401);
    // Sign-out revokes the session on the server, not just the cookie.
    await owner.signIn();
    const token = owner.jar.get('oc_session');
    assert.equal((await owner.call('POST', '/api/auth/signout', {})).status, 200);
    const copy = browser(s.origin); copy.jar.set('oc_session', token);
    assert.equal((await copy.call('GET', '/api/state')).status, 401);
    assert.ok(s.db.prepare("SELECT revoke_reason FROM sessions WHERE token_hash = ?").get(hashToken(token)).revoke_reason === 'signed_out');
  } finally { await s.close(); }
});

test('invitations: random, hashed, single use, scoped role; expiry, withdrawal and competing accepts', async () => {
  const s = await startServer();
  try {
    const { owner } = await familyWith(s);
    const inv = await owner.call('POST', '/api/family/invitations', { name: 'Wren', role: 'child' });
    assert.equal(inv.status, 200);
    const token = tokenOf(inv.json.link);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE token_hash = ?').get(hashToken(token)).n, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE token_hash = ?').get(token).n, 0);
    assert.equal(JSON.stringify(inv.json.state).includes(token), false, 'the token is not in state');
    // The preview names the family and role; the role the invitee ends with is the stored one, whatever they send.
    const wren = browser(s.origin);
    const preview = await wren.call('POST', '/api/auth/invitation', { token });
    assert.deepEqual([preview.json.invitation.familyName, preview.json.invitation.name, preview.json.invitation.role], ['House of Alder', 'Wren', 'child']);
    // Two browsers race to accept: exactly one membership results.
    const rival = browser(s.origin);
    const [a, b] = await Promise.all([wren.accept(token, { role: 'adult', owner: true }), rival.accept(token)]);
    const statuses = [a.done.status, b.done.status].sort();
    assert.deepEqual(statuses, [200, 410]);
    const winner = a.done.status === 200 ? wren : rival;
    const { json: state } = await winner.call('GET', '/api/state');
    assert.deepEqual(state.access.me.role, 'child'); assert.equal(state.access.me.owner, false);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM memberships").get().n, 2);
    // Used, withdrawn and expired invitations stay closed; withdrawing is owner-only and only while pending.
    assert.equal((await browser(s.origin).call('POST', '/api/auth/invitation', { token })).status, 410);
    const second = await owner.call('POST', '/api/family/invitations', { name: 'Ash', role: 'adult' });
    assert.equal((await winner.call('POST', `/api/family/invitations/${second.json.invitation.id}/revoke`, {})).status, 403);
    assert.equal((await owner.call('POST', `/api/family/invitations/${second.json.invitation.id}/revoke`, {})).status, 200);
    assert.equal((await browser(s.origin).accept(tokenOf(second.json.link))).done.status, 410);
    const third = await owner.call('POST', '/api/family/invitations', { name: 'Fern', role: 'adult' });
    const late = browser(s.origin);
    const started = await late.call('POST', '/api/auth/invitation/options', { token: tokenOf(third.json.link) });
    assert.equal(started.status, 200);
    s.clock.advance(49 * 3_600_000);
    const finish = await late.call('POST', '/api/auth/invitation/verify', { token: tokenOf(third.json.link), ceremonyId: started.json.ceremonyId, response: late.auth.register(started.json.options, { origin: s.origin }) });
    assert.equal(finish.status, 400, 'its ceremony expired first');
    assert.equal((await browser(s.origin).call('POST', '/api/auth/invitation', { token: tokenOf(third.json.link) })).status, 410, 'and the invitation itself');
    assert.equal((await browser(s.origin).call('POST', '/api/auth/invitation', { token: 'not-a-real-token-at-all-0000' })).status, 410);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM memberships").get().n, 2);
  } finally { await s.close(); }
});

test('children and outsiders are refused at HTTP level before any service or provider work', async () => {
  const s = await startServer();
  try {
    const { owner, Wren: child } = await familyWith(s, [['Wren', 'child']]);
    const other = await familyWith(s); // a separate household
    const mine = (await owner.call('GET', '/api/state')).json, theirs = (await other.owner.call('GET', '/api/state')).json;
    const childId = mine.access.members.find((m) => m.name === 'Wren').id;
    const orders = () => s.db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n;
    // Child: every adult or owner route is refused with the session's own rule, even with a valid CSRF token.
    for (const [method, url, body] of [
      ['POST', '/api/plans', { commitments: [] }], ['PUT', '/api/goal', {}], ['POST', '/api/merchant/search', { query: 'tent' }], ['POST', '/api/steward', { question: 'How are we doing?' }],
      ['POST', '/api/entries', { kind: 'bill_paid', amountCents: 100, label: 'Internet' }], ['POST', '/api/example/contributions', { amountCents: 1500, approvalConfirmed: true, requestId: 'child-attempt-000001' }],
      ['POST', '/api/paypal/client-token', {}], ['POST', '/api/paypal/orders', {}], ['POST', '/api/paypal/captures/x/refund', {}], ['GET', '/api/paypal/config'],
      ['POST', '/api/family/invitations', { name: 'Eve', role: 'adult' }], ['POST', `/api/family/members/${childId}/revoke`, {}], ['PUT', '/api/house', {}], ['POST', '/api/setup', {}],
    ]) {
      const r = await child.call(method, url, body);
      assert.equal(r.status, 403, `${method} ${url}`); assert.match(r.json.error.code, /adult_required|owner_required/);
    }
    assert.equal(orders(), 0);
    // A child changes only their own avatar; reading and the read-only schedule check are allowed.
    assert.equal((await child.call('PUT', `/api/members/${childId}/avatar`, { avatarId: 'knight' })).status, 200);
    assert.equal((await child.call('PUT', `/api/members/${mine.access.me.memberId}/avatar`, { avatarId: 'knight' })).json.error.code, 'self_only');
    assert.equal((await child.call('POST', '/api/plans/preview', { weeklyBudgetCents: 1000 })).status, 200);
    // An adult cannot name another household, goal, approver or member.
    const approve = { amountCents: 1500, approvalConfirmed: true, requestId: 'spoof-attempt-000001' };
    for (const [label, body, code] of [
      ['household', { ...approve, householdId: theirs.household.id }, 'scope_mismatch'], ['goal', { ...approve, goalId: theirs.goal.id }, 'scope_mismatch'],
      ['approver', { ...approve, approverId: childId }, 'member_mismatch'], ['other approver', { ...approve, approverId: theirs.access.me.memberId }, 'member_mismatch'],
    ]) assert.equal((await owner.call('POST', '/api/example/contributions', body)).json.error.code, code, label);
    assert.equal((await owner.call('POST', '/api/entries', { kind: 'gift_sent', amountCents: 100, label: 'Card', memberId: childId })).json.error.code, 'member_mismatch');
    assert.equal(orders(), 0, 'no order for any refused request');
    // Their household's records: its contribution, plan and receipts are invisible and unusable from this one.
    const paid = await other.owner.call('POST', '/api/example/contributions', { ...approve, requestId: 'their-own-000000001' });
    assert.equal(paid.status, 200);
    const plan = await other.owner.call('POST', '/api/plans', { commitments: [], goal: { name: theirs.goal.name, targetCents: theirs.goal.targetCents, startingCents: 0, weeklyBudgetCents: 1000, targetDate: theirs.goal.targetDate }, expectedGoalRevision: theirs.merchantGoalRevision });
    assert.equal(plan.status, 200, JSON.stringify(plan.json));
    const captureId = paid.json.contribution.captures[0].captureId;
    assert.equal((await owner.call('POST', `/api/example/captures/${captureId}/refund`, { approvalConfirmed: true })).status, 409, 'their capture is not ours');
    assert.equal((await owner.call('POST', `/api/example/contributions/${paid.json.contribution.id}/complete`, {})).status, 404);
    assert.equal((await owner.call('POST', `/api/plans/${plan.json.plan.id}/accept`, {})).status, 404);
    assert.equal((await owner.call('POST', '/api/steward', { question: 'Did it go through?', focusOrderId: 'their-order' })).status, 404);
    const view = (await owner.call('GET', '/api/state')).json;
    assert.equal(view.contributions.length, 0); assert.equal(view.plan, null);
    assert.equal(JSON.stringify(view).includes(theirs.household.id), false);
    // The example reset never runs in family mode.
    assert.equal((await owner.call('POST', '/api/demo/reset', {})).json.error.code, 'not_available');
  } finally { await s.close(); }
});

test('a goal edit cannot silently overwrite a newer one; an adult contribution reaches both views; revoking access ends sessions', async () => {
  const s = await startServer();
  try {
    const { owner, Ash: adult, Wren: child } = await familyWith(s, [['Ash', 'adult'], ['Wren', 'child']]);
    const seen = (await adult.call('GET', '/api/state')).json;
    const goal = (st, extra = {}) => ({ name: st.goal.name, targetCents: st.goal.targetCents, startingCents: st.progress.startingCents, weeklyBudgetCents: st.goal.weeklyBudgetCents, targetDate: st.goal.targetDate, ...extra });
    // The owner saves a newer goal; Ash's form still carries the older revision.
    const newer = await owner.call('POST', '/api/plans', { commitments: [], goal: goal(seen, { targetCents: 40000 }), expectedGoalRevision: seen.merchantGoalRevision });
    assert.equal(newer.status, 200);
    const stale = await adult.call('POST', '/api/plans', { commitments: [], goal: goal(seen, { weeklyBudgetCents: 2500 }), expectedGoalRevision: seen.merchantGoalRevision });
    assert.equal(stale.status, 409); assert.equal(stale.json.error.code, 'goal_changed');
    assert.equal((await adult.call('POST', '/api/plans', { commitments: [], goal: goal(seen, { weeklyBudgetCents: 2500 }) })).status, 409, 'a revision is required');
    assert.equal((await adult.call('PUT', '/api/goal', goal(seen, { weeklyBudgetCents: 2500 }))).status, 409);
    const fresh = (await adult.call('GET', '/api/state')).json;
    assert.equal(fresh.goal.targetCents, 40000);
    assert.equal((await adult.call('POST', '/api/plans', { commitments: [], goal: goal(fresh, { weeklyBudgetCents: 2500 }), expectedGoalRevision: fresh.merchantGoalRevision })).status, 200);
    // One adult-approved simulated contribution appears once in every member's view.
    const paid = await adult.call('POST', '/api/example/contributions', { amountCents: 1500, approvalConfirmed: true, requestId: 'ash-contribution-0001' });
    assert.equal(paid.status, 200);
    for (const b of [owner, adult, child]) {
      const st = (await b.call('GET', '/api/state')).json;
      assert.equal(st.contributions.length, 1); assert.equal(st.progress.progressCents, 1500);
    }
    // The owner removes the child's access: the session ends at once and their passkey no longer signs in.
    const childId = fresh.access.members.find((m) => m.name === 'Wren').id;
    assert.equal((await adult.call('POST', `/api/family/members/${childId}/revoke`, {})).json.error.code, 'owner_required');
    assert.equal((await owner.call('POST', `/api/family/members/${fresh.access.members.find((m) => m.owner).id}/revoke`, {})).json.error.code, 'owner_required', 'not the owner');
    assert.equal((await owner.call('POST', `/api/family/members/${childId}/revoke`, {})).status, 200);
    assert.equal((await child.call('GET', '/api/state')).status, 401);
    const again = await child.signIn();
    assert.equal(again.done.status, 403); assert.equal(again.done.json.error.code, 'access_revoked');
    const history = (await owner.call('GET', '/api/state')).json;
    assert.equal(history.access.members.find((m) => m.id === childId).access, 'revoked');
    // Audit: who did what, with ids only; never a token, hash or key.
    const audit = s.db.prepare('SELECT action, subject FROM audit_events ORDER BY id').all().map((r) => r.action);
    for (const action of ['family.created', 'invitation.created', 'invitation.accepted', 'member.access_revoked', 'session.signed_in', 'session.refused_revoked']) assert.ok(audit.includes(action), action);
    const dump = JSON.stringify(s.db.prepare('SELECT * FROM audit_events').all());
    for (const secret of s.db.prepare('SELECT token_hash FROM sessions UNION SELECT token_hash FROM invitations').all()) assert.equal(dump.includes(secret.token_hash), false);
  } finally { await s.close(); }
});

test('a second passkey needs a recent check; data and sessions persist through a real server restart', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-family-'));
  const file = path.join(dir, 'family.sqlite'), clock = mutableClock();
  let s;
  try {
    s = await startServer({ file, clock });
    const { owner } = await familyWith(s);
    const port = s.port;
    const add = async () => {
      const start = await owner.call('POST', '/api/auth/passkeys/options', {});
      if (start.status !== 200) return start;
      return owner.call('POST', '/api/auth/passkeys/verify', { ceremonyId: start.json.ceremonyId, response: owner.auth.register(start.json.options, { origin: s.origin }) });
    };
    assert.equal((await add()).json.passkeys, 2);
    clock.advance(11 * 60_000);
    assert.equal((await add()).json.error.code, 'reauth_required');
    await owner.signIn();
    assert.equal((await add()).json.passkeys, 3);
    const before = (await owner.call('GET', '/api/state')).json;
    await s.close();
    // Same file, same port: a new server process reads the same family, and the browser's session still works.
    s = await startServer({ file, clock, port });
    const after = await owner.call('GET', '/api/state');
    assert.equal(after.status, 200);
    assert.deepEqual([after.json.household, after.json.access.members], [before.household, before.access.members]);
    // Any of the account's passkeys signs in.
    const first = [...owner.auth.credentials.keys()][0];
    assert.equal((await owner.signIn({ credentialId: first })).done.status, 200);
  } finally { await s?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('upgrading a goal-project database adds only the access tables; existing rows are unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-access-migration-'));
  const file = path.join(dir, 'before.sqlite');
  try {
    const old = new DatabaseSync(file);
    const access = MIGRATIONS.findIndex((step) => step.id === 'family-access');
    MIGRATIONS.slice(0, access).forEach((step, i) => { if (typeof step === 'string') old.exec(step); else step.ensure(old); old.exec(`PRAGMA user_version = ${i + 1}`); });
    old.exec(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_old', 'House of Alder', 'family', 'cobalt', 'stag', 1, 1, '2026-11-01T12:00:00.000Z');
      INSERT INTO members (id, household_id, display_name, role, is_example, sort) VALUES ('m_old', 'hh_old', 'Rowan', 'adult', 1, 0);
      INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at, project_kind) VALUES ('goal_old', 'hh_old', 'Garden', 30000, 'USD', '2026-12-29', 3000, '2026-11-01T12:00:00.000Z', 'garden');`);
    const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    const rows = (d, names) => Object.fromEntries(names.map((t) => [t, d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => ({ ...r }))]));
    const beforeTables = tables(old), before = rows(old, beforeTables);
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.deepEqual(rows(db, beforeTables), before, 'every earlier table and row identical');
    assert.deepEqual(tables(db).filter((t) => !beforeTables.includes(t)).sort(), ['accounts', 'audit_events', 'auth_challenges', 'invitations', 'memberships', 'passkeys', 'sessions']);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Independent review: authorization must still be valid when a deferred action actually starts.
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function endAccess(reason, s, owner, adult, adultId) {
  if (reason === 'active') return;
  if (reason === 'expiry') s.clock.advance(13 * 3_600_000);
  else if (reason === 'sign-out') assert.equal((await adult.call('POST', '/api/auth/signout', {})).status, 200);
  else assert.equal((await owner.call('POST', `/api/family/members/${adultId}/revoke`, {})).status, 200);
}

for (const reason of ['revocation', 'expiry', 'sign-out']) {
  test(`${reason} while a request body is delayed prevents its later household write`, { timeout: 10_000 }, async () => {
    const admitted = gate();
    const s = await startServer({ onRequest: req => {
      if (req.headers['x-review-gate'] === 'delayed-body') admitted.release(req);
    } });
    let req;
    try {
      const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
      const before = (await owner.call('GET', '/api/state')).json;
      const adultId = before.access.members.find(m => m.name === 'Ash').id;
      const payload = JSON.stringify({ kind: 'gift_sent', amountCents: 100, label: 'Delayed fixture gift', memberId: adultId });
      const answer = new Promise((resolve, reject) => {
        req = http.request(s.origin + '/api/entries', { method: 'POST', headers: {
          Origin: s.origin, Cookie: [...adult.jar].map(([k,v]) => `${k}=${v}`).join('; '),
          'X-CSRF-Token': adult.csrf, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload), 'X-Review-Gate': 'delayed-body',
        } }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) })); });
        req.on('error', reject); req.write(payload.slice(0, 1));
      });
      const incoming = await admitted.promise;
      assert.ok(incoming.listenerCount('readable') > 0 || incoming.listenerCount('data') > 0, 'handler is waiting for the body');
      await endAccess(reason, s, owner, adult, adultId);
      req.end(payload.slice(1));
      const result = await answer;
      assert.equal(result.status, 401, `a ${reason} request returned ${result.status}`);
      assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE label = 'Delayed fixture gift'").get().n, 0);
      assert.equal((await adult.call('GET', '/api/state')).status, 401);
    } finally { req?.destroy(); await s.close(); }
  });
}

for (const [reason, phase] of [['revocation', 'model'], ['expiry', 'model'], ['sign-out', 'model'], ['revocation', 'tool'], ['active', 'model']]) {
  test(`${reason} membership during a ${phase} wait controls tool/model turns and the private answer`, { timeout: 10_000 }, async () => {
    const entered = gate(), finish = gate(), calls = [], lookups = [];
    const message = content => ({ id: 'msg_review', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_details: null, content,
      usage: { input_tokens: 1, output_tokens: 1 } });
    const s = await startServer({ extra: {
      stewardAi: { apiKey: 'synthetic-review-key', model: 'claude-opus-5-5' },
      paypalTools: {
        getOrder: async () => { throw new Error('No order lookup expected'); },
        listTransactions: async () => {
          lookups.push('list_transactions');
          if (phase === 'tool') { entered.release(); await finish.promise; }
          return { transaction_details: [] };
        },
      },
      stewardFetch: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        if (calls.length === 1 && phase === 'model') { entered.release(); await finish.promise; }
        return new Response(JSON.stringify(message(calls.length === 1
          ? [{ type: 'tool_use', id: 'toolu_review', name: 'list_transactions', input: { days: 1, status: 'S' } }]
          : [{ type: 'text', text: 'I read the household records.' }])), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    } });
    try {
      const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
      const before = (await owner.call('GET', '/api/state')).json;
      const adultId = before.access.members.find(m => m.name === 'Ash').id;
      const request = adult.call('POST', '/api/steward', { question: 'What is our goal?' });
      await entered.promise;
      const seenAtStart = s.db.prepare('SELECT last_seen_at FROM sessions WHERE member_id = ? AND revoked_at IS NULL').get(adultId).last_seen_at;
      if (reason === 'active') s.clock.advance(2 * 60_000);
      await endAccess(reason, s, owner, adult, adultId);
      finish.release();
      const result = await request;
      if (reason === 'active') {
        assert.equal(result.status, 200); assert.equal(result.json.status, 'ok');
        assert.equal(calls.length, 2); assert.equal(lookups.length, 1);
        assert.equal(result.json.answer, 'I read the household records.');
        assert.equal(s.db.prepare('SELECT last_seen_at FROM sessions WHERE member_id = ? AND revoked_at IS NULL').get(adultId).last_seen_at, seenAtStart, 'model/tool rechecks do not extend an idle session');
        return;
      }
      assert.equal(result.status, 401, `${reason} request returned ${result.status}, after ${calls.length} model turns`);
      assert.equal(calls.length, 1, 'no tool output enters another model turn after access ends');
      assert.equal(lookups.length, phase === 'tool' ? 1 : 0, 'already-started lookups may finish; no later lookup begins');
      assert.equal(result.json.answer, undefined); assert.equal(result.json.checks, undefined);
      assert.equal((await adult.call('GET', '/api/state')).status, 401);
    } finally { finish.release(); await s.close(); }
  });
}
