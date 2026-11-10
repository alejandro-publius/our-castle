import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { exchangeAction } from '../../server/exchange/index.mjs';
import { assertVillageLeaveAllowed, clearExampleVillage, publicVillageFund, recordVillageReceipt, villageAction, villageFund, villagePaymentContext, villageReview, villageView } from '../../server/village/index.mjs';

const clock = createClock('2026-11-10T12:00:00.000Z');
function fixture(file = ':memory:') {
  const db = openDatabase(file);
  const people = ['alder', 'birch', 'cedar', 'outsider'].map(name => {
    const householdId = `hh_${name}`, memberId = `adult_${name}`, goalId = `goal_${name}`;
    db.prepare('INSERT INTO households(id,name,play_mode,crest_field,crest_charge,setup_complete,created_at) VALUES(?,?,?,?,?,1,?)').run(householdId, `PRIVATE ${name}`, 'family', 'cobalt', 'stag', clock.iso());
    db.prepare('INSERT INTO members(id,household_id,display_name,role,sort) VALUES(?,?,?,?,0)').run(memberId, householdId, name, 'adult');
    db.prepare('INSERT INTO goals(id,household_id,name,target_cents,currency,target_date,created_at) VALUES(?,?,?,?,?,?,?)').run(goalId, householdId, 'PRIVATE GOAL', 10000, 'USD', '2026-12-12', clock.iso());
    db.prepare("INSERT INTO ledger_entries(household_id,goal_id,kind,effect,amount_cents,currency,source,source_ref,created_at) VALUES(?,?,'starting_progress',1,7500,'USD','user-reported',?,?)").run(householdId, goalId, `private_${name}`, clock.iso());
    return { householdId, memberId, goalId, role: 'adult' };
  });
  const [a, b, c, stranger] = people;
  const exchange = (scope, action, input = {}) => exchangeAction(db, { scope, actor: scope, action, input }, clock);
  exchange(a, 'create', { name: 'Woodland neighbors', alias: 'Alder' });
  for (const [scope, alias] of [[b, 'Birch'], [c, 'Cedar']]) exchange(scope, 'join', { token: exchange(a, 'invite').invitation.token, alias, confirmed: true });
  db.prepare('INSERT INTO members(id,household_id,display_name,role,sort) VALUES(?,?,?,?,1)').run('child_alder', a.householdId, 'Child', 'child');
  const act = (scope, action, input = {}) => villageAction(db, { scope, actor: scope, action, input }, clock);
  const create = (overrides = {}) => act(a, 'create', { title: 'Class trip', targetMinor: 10000, deadline: '2026-12-12', rail: 'simulated', confirmed: true, ...overrides }).fundId;
  const event = (fundId, overrides = {}) => recordVillageReceipt(db, { fundId, source: 'simulated', eventRef: 'capture_one', kind: 'capture', amountMinor: 1000, familyHouseholdId: a.householdId, recipient: null, ...overrides }, clock);
  return { db, a, b, c, stranger, exchange, act, create, event };
}
const rejects = (fn, status, code) => assert.throws(fn, e => e.status === status && (!code || e.code === code), code);

test('funds have one immutable rail and voluntary own-family commitments; no private cash moves', () => {
  const f = fixture(); try {
    const before = f.db.prepare('SELECT * FROM ledger_entries').all(), id = f.create();
    let v = villageFund(f.db, f.a, id);
    assert.equal(v.progress.netMinor, 0); assert.equal(v.progress.stage, 0); assert.equal(v.currency, 'USD'); assert.equal(v.decimals, 2);
    f.act(f.b, 'share', { fundId: id, committedMinor: 4000, expectedRevision: v.revision, confirmed: true });
    v = villageFund(f.db, f.a, id);
    assert.equal(v.shares.find(s => s.alias === 'Birch').committedMinor, 4000); assert.equal(v.progress.netMinor, 0);
    rejects(() => f.act(f.b, 'share', { fundId: id, householdId: f.c.householdId, committedMinor: 4000, expectedRevision: v.revision, confirmed: true }), 400, 'village_own_share');
    rejects(() => f.act(f.b, 'share', { fundId: id, committedMinor: 5000, expectedRevision: v.revision - 1, confirmed: true }), 409, 'village_changed');
    rejects(() => f.act(f.b, 'create', { title: 'No', targetMinor: 1, deadline: '2026-12-12', rail: 'simulated', confirmed: true }), 403);
    rejects(() => f.act({ ...f.a, memberId: 'child_alder', role: 'adult' }, 'create', {}), 403);
    rejects(() => villageFund(f.db, f.stranger, id), 403);
    rejects(() => f.act(f.a, 'create', { title: 'No', targetMinor: 100, deadline: '2026-12-12', rail: 'simulated' }), 400, 'village_confirm');
    assert.deepEqual(f.db.prepare('SELECT * FROM ledger_entries').all(), before);
    assert.deepEqual(f.db.prepare('SELECT * FROM payment_orders').all(), []);
  } finally { f.db.close(); }
});

test('confirmed receipts net refunds before stage; replays are idempotent and conflicting global event reuse fails', () => {
  const f = fixture(); try {
    const id = f.create(), other = f.create({ title: 'Another class' });
    f.event(id, { kind: 'refund', eventRef: 'refund_early', parentRef: 'capture_one', amountMinor: 5000 });
    assert.equal(villageFund(f.db, f.a, id).progress.netMinor, 0);
    f.event(id, { amountMinor: 6000 });
    const v = villageFund(f.db, f.a, id);
    assert.deepEqual(v.progress, { netMinor: 1000, capturedMinor: 6000, refundedMinor: 5000, remainingMinor: 9000, basisPoints: 1000, unmatchedMinor: 0, unmatchedCount: 0, stage: 0 });
    assert.equal(v.shares.find(s => s.alias === 'Alder').paidMinor, 1000);
    assert.equal(f.event(id, { amountMinor: 6000 }).duplicate, true);
    assert.equal(villageFund(f.db, f.a, id).revision, v.revision);
    rejects(() => f.event(id, { amountMinor: 5999 }), 409, 'village_receipt_conflict');
    rejects(() => f.event(other, { amountMinor: 6000 }), 409, 'village_receipt_conflict');
    rejects(() => f.event(other, { kind: 'refund', eventRef: 'refund_wrong', parentRef: 'capture_one', amountMinor: 500 }), 409);
    f.event(id, { kind: 'reversal', eventRef: 'reversal_overlap', parentRef: 'capture_one', amountMinor: 6000 });
    assert.equal(villageFund(f.db, f.a, id).progress.netMinor, 0);
    assert.equal(villageFund(f.db, f.a, id).progress.refundedMinor, 6000);
  } finally { f.db.close(); }
});

test('unmatched deposits remain unattributed and reverse correctly, never assigned by an unproven wallet', () => {
  const f = fixture(); try {
    const id = f.create();
    f.event(id, { eventRef: 'guest', familyHouseholdId: null, amountMinor: 3000 });
    let v = villageFund(f.db, f.a, id);
    assert.equal(v.progress.unmatchedMinor, 3000); assert.equal(v.progress.unmatchedCount, 1);
    assert.equal(v.receipts[0].familyReference, null); assert.ok(v.shares.every(s => s.paidMinor === 0));
    f.event(id, { kind: 'refund', eventRef: 'guest_refund', parentRef: 'guest', familyHouseholdId: null, amountMinor: 1000 });
    v = villageFund(f.db, f.a, id); assert.equal(v.progress.unmatchedMinor, 2000);
    rejects(() => f.event(id, { kind: 'refund', eventRef: 'misattributed', parentRef: 'guest', amountMinor: 1000 }), 409, 'village_family');
    f.event(id, { kind: 'refund', eventRef: 'guest_rest', parentRef: 'guest', familyHouseholdId: null, amountMinor: 2000 });
    v = villageFund(f.db, f.a, id); assert.equal(v.progress.unmatchedMinor, 0); assert.equal(v.progress.unmatchedCount, 0);
  } finally { f.db.close(); }
});

test('sandbox recipient snapshot and token units are enforced, including two transfers in one transaction', () => {
  const f = fixture(); try {
    const recipient = { kind: 'paypal', merchantId: 'SANDBOXMERCHANT', revision: 1 };
    const p = f.create({ rail: 'paypal-sandbox', recipient });
    rejects(() => f.event(p), 409, 'village_rail');
    rejects(() => f.event(p, { source: 'paypal-sandbox', recipient: { ...recipient, merchantId: 'OTHERACCOUNT' } }), 409, 'village_recipient_changed');
    rejects(() => f.event(p, { source: 'paypal-sandbox', recipient: { ...recipient, revision: 2 } }), 409, 'village_recipient_changed');
    f.event(p, { source: 'paypal-sandbox', recipient });
    const wallet = { kind: 'solana-devnet', address: '11111111111111111111111111111111', revision: 1 };
    const d = f.create({ rail: 'pyusd-devnet', targetMinor: 5000000, recipient: wallet });
    f.event(d, { source: 'pyusd-devnet', kind: 'transfer', eventRef: 'same_signature', eventIndex: '3.0', amountMinor: 1000000, recipient: wallet });
    f.event(d, { source: 'pyusd-devnet', kind: 'transfer', eventRef: 'same_signature', eventIndex: '3.1', amountMinor: 2000000, recipient: wallet });
    const v = villageFund(f.db, f.a, d);
    assert.equal(v.progress.netMinor, 3000000); assert.equal(v.currency, 'PYUSD'); assert.equal(v.decimals, 6);
    assert.equal(villageFund(f.db, f.a, p).progress.netMinor, 1000);
    rejects(() => f.create({ rail: 'pyusd-devnet', recipient: { kind: 'solana-devnet', address: '123' } }), 400);
  } finally { f.db.close(); }
});

test('only explicit publication exposes a small fund view; castle presentation is private by default', () => {
  const f = fixture(); try {
    const id = f.create(), before = villageView(f.db, f.a);
    assert.ok(before.members.every(m => m.tier === 0 && m.crest === null));
    assert.doesNotMatch(JSON.stringify(before), /PRIVATE GOAL|7500|hh_alder|adult_alder/);
    rejects(() => publicVillageFund(f.db, id), 404);
    f.act(f.a, 'share-castle', { shared: true, confirmed: true });
    const after = villageView(f.db, f.b), alder = after.members.find(m => m.alias === 'Alder');
    assert.equal(alder.tier, 2); assert.deepEqual(alder.crest, { field: 'cobalt', charge: 'stag' });
    let fund = villageFund(f.db, f.a, id);
    rejects(() => f.act(f.b, 'publish', { fundId: id, expectedRevision: fund.revision, published: true, confirmed: true }), 403);
    f.act(f.a, 'publish', { fundId: id, expectedRevision: fund.revision, published: true, confirmed: true });
    const publicView = publicVillageFund(f.db, id);
    assert.equal(publicView.title, 'Class trip');
    for (const field of ['shares', 'receipts', 'members', 'familyReference', 'recipient']) assert.ok(!(field in publicView));
    fund = villageFund(f.db, f.a, id);
    f.act(f.a, 'publish', { fundId: id, expectedRevision: fund.revision, published: false, confirmed: true });
    rejects(() => publicVillageFund(f.db, id), 404);
  } finally { f.db.close(); }
});

test('membership is rechecked, commitments may be withdrawn and fund history cannot be erased by leaving', () => {
  const f = fixture(); try {
    const id = f.create();
    f.act(f.b, 'share', { fundId: id, expectedRevision: 1, committedMinor: 1000, confirmed: true });
    rejects(() => assertVillageLeaveAllowed(f.db, f.b.householdId), 409, 'village_commitment_open');
    f.act(f.b, 'share', { fundId: id, expectedRevision: 2, committedMinor: 0, confirmed: true });
    f.event(id, { eventRef: 'birch_capture', familyHouseholdId: f.b.householdId });
    assertVillageLeaveAllowed(f.db, f.b.householdId); f.exchange(f.b, 'leave');
    rejects(() => villageFund(f.db, f.b, id), 403); rejects(() => villagePaymentContext(f.db, f.b, id), 404);
    f.exchange(f.b, 'create', { name: 'New private neighbors', alias: 'PRIVATE_NEW_ALIAS' });
    f.event(id, { kind: 'refund', eventRef: 'birch_refund', parentRef: 'birch_capture', familyHouseholdId: f.b.householdId });
    assert.doesNotMatch(JSON.stringify(villageFund(f.db, f.a, id)), /PRIVATE_NEW_ALIAS/);
    rejects(() => assertVillageLeaveAllowed(f.db, f.a.householdId), 409, 'village_history_retained');
  } finally { f.db.close(); }
});

test('settled intent retries may read full/closed context without reopening contribution permission', () => {
  const f = fixture(); try {
    const id = f.create(); f.event(id, { amountMinor: 10000 });
    rejects(() => villagePaymentContext(f.db, f.a, id), 409, 'village_complete');
    assert.equal(villagePaymentContext(f.db, f.a, id, { allowSettled: true }).remainingMinor, 0);
    f.act(f.a, 'close', { fundId: id, expectedRevision: 2, confirmed: true });
    rejects(() => villagePaymentContext(f.db, f.a, id), 409, 'village_closed');
    assert.equal(villagePaymentContext(f.db, f.a, id, { allowSettled: true }).status, 'closed');
    f.event(id, { kind: 'refund', eventRef: 'late_refund', parentRef: 'capture_one', amountMinor: 4000 });
    assert.equal(villageFund(f.db, f.a, id).progress.netMinor, 6000);
    rejects(() => villagePaymentContext(f.db, { ...f.a, memberId: 'child_alder' }, id, { allowSettled: true }), 403);
  } finally { f.db.close(); }
});

test('two database handles and reopen cannot credit the same provider event twice', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'castle-village-fund-'));
  const file = path.join(dir, 'fixture.sqlite'), f = fixture(file), second = openDatabase(file);
  let reopened;
  try {
    const id = f.create(), event = { fundId: id, source: 'simulated', eventRef: 'shared_capture', kind: 'capture', amountMinor: 2500, familyHouseholdId: f.a.householdId, recipient: null };
    assert.equal(recordVillageReceipt(f.db, event, clock).duplicate, false);
    assert.equal(recordVillageReceipt(second, event, clock).duplicate, true);
    second.close(); f.db.close(); reopened = openDatabase(file);
    assert.equal(recordVillageReceipt(reopened, event, clock).duplicate, true);
    assert.equal(villageFund(reopened, f.a, id).progress.netMinor, 2500);
    assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM village_receipts').get().n, 1);
  } finally { try { second.close(); } catch {} try { f.db.close(); } catch {} reopened?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('only a completely synthetic in-memory village can discard its fund history', () => {
  const f = fixture(); try {
    const id = f.create(); f.event(id);
    f.db.prepare('UPDATE households SET is_example=0 WHERE id=?').run(f.b.householdId);
    rejects(() => clearExampleVillage(f.db, f.a.householdId), 403, 'village_example_only');
    assert.equal(villageFund(f.db, f.a, id).progress.netMinor, 1000);
    f.db.prepare('UPDATE households SET is_example=1 WHERE id=?').run(f.b.householdId);
    clearExampleVillage(f.db, f.a.householdId);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM village_funds').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM village_receipts').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n, 4);
  } finally { f.db.close(); }
  const dir = mkdtempSync(path.join(tmpdir(), 'castle-village-no-reset-')), saved = fixture(path.join(dir, 'synthetic.sqlite'));
  try { saved.create(); rejects(() => clearExampleVillage(saved.db, saved.a.householdId), 403, 'village_example_only'); }
  finally { saved.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('an outside adult can support a published fund without joining or learning private receipts and shares', () => {
  const f = fixture(); try {
    const id = f.create(); f.event(id, { amountMinor: 2500 });
    rejects(() => villagePaymentContext(f.db, f.stranger, id), 404);
    rejects(() => villagePaymentContext(f.db, f.stranger, id, { allowSettled: true }), 404);
    rejects(() => villageReview(f.db, f.stranger, id), 404);
    f.act(f.a, 'publish', { fundId: id, expectedRevision: 2, published: true, confirmed: true });
    const context = villagePaymentContext(f.db, f.stranger, id);
    assert.equal(context.attributionHouseholdId, null); assert.equal(context.viewerMember, false); assert.equal(context.published, true);
    const review = villageReview(f.db, f.stranger, id);
    assert.equal(review.progress.netMinor, 2500); assert.deepEqual(review.shares, []); assert.deepEqual(review.receipts, []);
    assert.equal(review.viewerMember, false); assert.equal(review.canManage, false);
    assert.doesNotMatch(JSON.stringify(review), /capture_one|VRC-|Birch|Cedar|PRIVATE|householdId/);
    assert.equal(villageReview(f.db, f.a, id).viewerMember, true);
    assert.equal(villagePaymentContext(f.db, f.a, id).attributionHouseholdId, f.a.householdId);
    rejects(() => villageFund(f.db, f.stranger, id), 403);
    f.db.prepare('INSERT INTO members(id,household_id,display_name,role,sort) VALUES(?,?,?,?,1)').run('child_outside', f.stranger.householdId, 'Child', 'child');
    rejects(() => villagePaymentContext(f.db, { ...f.stranger, memberId: 'child_outside' }, id), 403);
    rejects(() => villageReview(f.db, {}, id), 403);
  } finally { f.db.close(); }
});

test('unpublishing blocks new outsider payments; only the actual adult with an existing intent can check it', () => {
  const f = fixture(); try {
    const id = f.create();
    f.act(f.a, 'publish', { fundId: id, expectedRevision: 1, published: true, confirmed: true });
    const published = villagePaymentContext(f.db, f.stranger, id);
    assert.equal(published.published, true);
    // The domain works before or after A's separately owned migration. Populate an actual intent row if schema16 is
    // present, or its minimal ownership columns in this foundation-only test; caller-supplied claims never suffice.
    f.db.exec('CREATE TABLE IF NOT EXISTS village_payment_intents (fund_id TEXT,household_id TEXT,member_id TEXT)');
    const values = { id: 'vpay_fixture', request_id: 'outside_fixture', fund_id: id, household_id: f.stranger.householdId,
      member_id: f.stranger.memberId, source: 'simulated', amount_minor: 100, currency: 'USD', recipient_json: 'null',
      fund_revision: published.revision, target_minor: 10000, status: 'created', attribution_household_id: null,
      created_at: clock.iso(), updated_at: clock.iso() };
    const columns = f.db.prepare('PRAGMA table_info(village_payment_intents)').all().map(c => c.name).filter(c => Object.hasOwn(values, c));
    f.db.prepare(`INSERT INTO village_payment_intents(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(c => values[c]));
    f.act(f.a, 'publish', { fundId: id, expectedRevision: 2, published: false, confirmed: true });
    rejects(() => villagePaymentContext(f.db, f.stranger, id), 404);
    rejects(() => villageReview(f.db, f.stranger, id), 404);
    const check = villagePaymentContext(f.db, f.stranger, id, { allowSettled: true });
    assert.equal(check.published, false); assert.equal(check.viewerMember, false); assert.equal(check.attributionHouseholdId, null);
    f.db.prepare('INSERT INTO members(id,household_id,display_name,role,sort) VALUES(?,?,?,?,1)').run('other_adult', f.stranger.householdId, 'Other', 'adult');
    rejects(() => villagePaymentContext(f.db, { ...f.stranger, memberId: 'other_adult' }, id, { allowSettled: true }), 404);
    const second = f.create();
    rejects(() => villagePaymentContext(f.db, f.stranger, second, { allowSettled: true }), 404);
    f.db.prepare('DELETE FROM village_payment_intents').run();
    rejects(() => villagePaymentContext(f.db, f.stranger, id, { allowSettled: true }), 404);
  } finally { f.db.close(); }
});
