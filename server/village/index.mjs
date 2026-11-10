// A neighborhood's agreed project is separate from each home's private savings. Only a trusted payment adapter can
// append receipt events. A promise is not a payment; sandbox dollars and valueless devnet tokens never share a fund.
import { createHash } from 'node:crypto';
import { transaction } from '../db.mjs';
import { DomainError, getActiveGoal, getHousehold, getMember, isIsoDate, newId, progressFor } from '../household.mjs';
import { tierForProgress } from '../../src/core/rules.js';
import { projectStage } from '../../src/core/family-project.js';

const MAX_MINOR = 1_000_000_000_000;
const fail = (status, code, message) => new DomainError(status, code, message);
const ref = (prefix, id) => `${prefix}-${id.slice(id.indexOf('_') + 1).toUpperCase()}`;
const rails = Object.freeze({ simulated: { currency: 'USD', decimals: 2 }, 'paypal-sandbox': { currency: 'USD', decimals: 2 }, 'pyusd-devnet': { currency: 'PYUSD', decimals: 6 } });
const member = (db, householdId) => typeof householdId === 'string' ? db.prepare('SELECT * FROM exchange_members WHERE household_id = ?').get(householdId) : null;
const members = (db, circleId) => db.prepare('SELECT * FROM exchange_members WHERE circle_id = ? ORDER BY joined_at, household_id').all(circleId);
const fundRow = (db, id) => typeof id === 'string' ? db.prepare('SELECT * FROM village_funds WHERE id = ?').get(id) : null;
const rows = (db, id) => db.prepare('SELECT * FROM village_receipts WHERE fund_id = ? ORDER BY recorded_at, id').all(id);
const text = (v, max) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw fail(400, 'village_text', `Use 1–${max} characters of plain text.`);
  return v.trim();
};
const amount = (v, zero = false) => {
  if (!Number.isSafeInteger(v) || v < (zero ? 0 : 1) || v > MAX_MINOR) throw fail(400, 'village_amount', 'Choose a valid whole-number amount in the fund’s smallest unit.');
  return v;
};
const index = v => {
  const value = String(v ?? '0');
  if (!/^\d{1,8}(?:\.\d{1,8})?$/.test(value)) throw fail(400, 'village_event_index', 'The transfer instruction index is invalid.');
  return value.split('.').map(n => String(Number(n))).join('.');
};
function adult(db, scope, actor = scope) {
  const actual = typeof actor?.memberId === 'string' && getMember(db, scope?.householdId ?? '', actor.memberId);
  if (!actual || actual.role !== 'adult') throw fail(403, 'adult_required', 'An adult in this family must review the village action.');
  return actual;
}
function joined(db, scope) {
  const m = member(db, scope?.householdId);
  if (!m) throw fail(403, 'village_membership', 'Join an invited neighborhood before opening its fund.');
  return m;
}
function authorizedFund(db, scope, id) {
  const m = joined(db, scope), f = fundRow(db, id);
  if (!f || f.circle_id !== m.circle_id) throw fail(404, 'village_fund', 'This fund is not shared with your family.');
  return f;
}
function family(db, m) {
  const p = db.prepare('SELECT family_ref FROM exchange_profiles WHERE household_id = ?').get(m.household_id);
  // Exchange creates a profile on joining. Missing fixture/legacy profiles receive an opaque stable reference, never an id.
  const reference = p ? ref('FAM', p.family_ref) : `FAM-${createHash('sha256').update(m.household_id).digest('hex').slice(0, 20).toUpperCase()}`;
  return { familyReference: reference, alias: m.alias };
}
function recipientFor(rail, value) {
  if (rail === 'simulated') {
    if (value != null) throw fail(400, 'village_recipient', 'Simulated funds do not have a payment recipient.');
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'village_recipient', 'Review the fund’s recipient first.');
  if (rail === 'paypal-sandbox' && value.kind === 'paypal' && typeof value.merchantId === 'string' && /^[A-Z0-9]{8,32}$/.test(value.merchantId))
    return { kind: 'paypal', merchantId: value.merchantId, revision: 1 };
  if (rail === 'pyusd-devnet' && value.kind === 'solana-devnet' && typeof value.address === 'string' && validPublicKey(value.address))
    return { kind: 'solana-devnet', address: value.address, revision: 1 };
  throw fail(400, 'village_recipient', 'Use the sandbox merchant id or a 32-byte Solana devnet public address.');
}
// Decode only the public base58 key. A wallet address is not evidence of ownership and supplies no signing authority.
function validPublicKey(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const c of value) number = number * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (number) { bytes++; number >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
function exactRecipient(f, value) {
  const canonical = recipientFor(f.rail, value);
  if (value != null && value.revision !== 1) throw fail(409, 'village_recipient_changed', 'The receipt does not bind the approved recipient revision.');
  if (JSON.stringify(canonical) !== f.recipient_json) throw fail(409, 'village_recipient_changed', 'The receipt names a different recipient.');
  return canonical;
}
const changed = (db, f) => members(db, f.circle_id).map(m => m.household_id);
function bump(db, f, now) { db.prepare('UPDATE village_funds SET revision = revision + 1, updated_at = ? WHERE id = ?').run(now, f.id); }
function expected(f, value) { if (value !== f.revision) throw fail(409, 'village_changed', 'The village fund changed. Review it again before saving.'); }
function confirm(input) { if (input.confirmed !== true) throw fail(400, 'village_confirm', 'Review and explicitly confirm this village action.'); }
function owner(f, scope) { if (f.organizer_household_id !== scope.householdId) throw fail(403, 'village_organizer', 'Only an adult in the organizing family can do this.'); }

function accounting(receipts, target) {
  const captures = receipts.filter(r => r.kind === 'capture' || r.kind === 'transfer');
  let captured = 0n, refunded = 0n, unmatched = 0n, unmatchedCount = 0;
  const paid = new Map(), reversals = new Map();
  const parentKey = (source, reference, eventIndex) => JSON.stringify([source, reference, eventIndex]);
  for (const r of receipts) if (r.kind === 'refund' || r.kind === 'reversal') {
    const key = parentKey(r.source, r.parent_ref, r.parent_index);
    reversals.set(key, (reversals.get(key) ?? 0n) + BigInt(r.amount_minor));
  }
  for (const r of captures) {
    const gross = BigInt(r.amount_minor);
    const reversed = reversals.get(parentKey(r.source, r.event_ref, r.event_index)) ?? 0n;
    const effectiveRefund = reversed > gross ? gross : reversed;
    captured += gross; refunded += effectiveRefund;
    if (r.family_reference) paid.set(r.family_reference, (paid.get(r.family_reference) ?? 0n) + gross - effectiveRefund);
    else if (gross > effectiveRefund) { unmatched += gross - effectiveRefund; unmatchedCount++; }
  }
  const net = captured - refunded;
  for (const n of [captured, refunded, net]) if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw fail(409, 'village_total_limit', 'This fund has reached the supported accounting limit.');
  const netMinor = Number(net), targetBig = BigInt(target);
  const basisPoints = Number((net >= targetBig ? 10_000n : net * 10_000n / targetBig));
  return { progress: { netMinor, capturedMinor: Number(captured), refundedMinor: Number(refunded), remainingMinor: Math.max(0, target - netMinor), basisPoints,
    unmatchedMinor: Number(unmatched), unmatchedCount,
    stage: projectStage(Math.min(netMinor, target), target, 'schoolhouse').index }, paid };
}
function receiptView(r) {
  return { id: r.id, reference: ref('VRC', r.id), eventRef: r.event_ref, eventIndex: r.event_index, kind: r.kind, amountMinor: r.amount_minor,
    familyReference: r.family_reference, alias: r.alias, at: r.occurred_at, source: r.source,
    ...(r.parent_ref ? { parentRef: r.parent_ref, parentIndex: r.parent_index } : {}) };
}
function viewFund(db, f, scope) {
  const receiptRows = rows(db, f.id), { progress, paid } = accounting(receiptRows, f.target_minor);
  const committed = db.prepare('SELECT * FROM village_shares WHERE fund_id = ? ORDER BY family_reference').all(f.id);
  const identities = new Map(members(db, f.circle_id).map(m => { const identity = family(db, m); return [identity.familyReference, identity]; }));
  for (const r of [...committed, ...receiptRows]) if (r.family_reference && !identities.has(r.family_reference)) identities.set(r.family_reference, { familyReference: r.family_reference, alias: r.alias ?? 'Former neighbor' });
  return { id: f.id, title: f.title, rail: f.rail, currency: f.currency, decimals: f.decimals, targetMinor: f.target_minor, deadline: f.deadline,
    projectKind: f.project_kind, revision: f.revision, status: f.status, organizer: { familyReference: f.organizer_reference, alias: f.organizer_alias },
    recipient: JSON.parse(f.recipient_json), progress, published: Boolean(f.published), canManage: f.organizer_household_id === scope.householdId,
    shares: [...identities.values()].map(identity => ({ ...identity, committedMinor: committed.find(c => c.family_reference === identity.familyReference)?.committed_minor ?? 0,
      paidMinor: Number(paid.get(identity.familyReference) ?? 0n) })), receipts: receiptRows.map(receiptView) };
}

/** Always rechecks current membership; callers must also enforce their passkey/session lifetime. */
export function villageFund(db, scope, fundId) { return viewFund(db, authorizedFund(db, scope, fundId), scope); }

export function villageView(db, scope) {
  const m = member(db, scope?.householdId);
  if (!m) return { available: true, neighborhood: null, funds: [], members: [], selectedFundId: null, membershipRevision: null, scene: null };
  const circle = db.prepare('SELECT * FROM exchange_circles WHERE id = ?').get(m.circle_id);
  const neighborRows = members(db, circle.id);
  const neighbors = neighborRows.map(n => {
    const household = getHousehold(db, n.household_id), shared = Boolean(db.prepare('SELECT shared FROM village_presentations WHERE household_id = ?').get(n.household_id)?.shared);
    const goal = shared ? getActiveGoal(db, n.household_id) : null;
    return { ...family(db, n), crest: shared ? household.crest : null, tier: goal ? tierForProgress(progressFor(db, goal.id).progressCents, goal.targetCents) : 0,
      shared, mine: n.household_id === scope.householdId };
  });
  const funds = db.prepare('SELECT * FROM village_funds WHERE circle_id = ? ORDER BY created_at, id').all(circle.id).map(f => viewFund(db, f, scope));
  const selected = funds.find(f => f.status === 'open') ?? funds[0] ?? null;
  const membershipRevision = createHash('sha256').update(JSON.stringify(neighborRows.map(n => [n.household_id, n.alias, n.joined_at]))).digest('hex');
  return { available: true, neighborhood: { id: circle.id, name: circle.name }, funds, members: neighbors, membershipRevision, selectedFundId: selected?.id ?? null,
    scene: selected ? { fundId: selected.id, title: selected.title, projectKind: selected.projectKind, stage: selected.progress.stage, basisPoints: selected.progress.basisPoints,
      neighbors: neighbors.map(n => ({ ...n, banner: selected.shares.some(s => s.familyReference === n.familyReference && s.paidMinor > 0) })) } : null };
}

/** Published metadata is deliberately smaller than the authenticated neighborhood view. */
export function publicVillageFund(db, fundId) {
  const f = fundRow(db, fundId);
  if (!f || !f.published) throw fail(404, 'village_fund', 'This fund is not published.');
  return { id: f.id, title: f.title, projectKind: f.project_kind, rail: f.rail, currency: f.currency, decimals: f.decimals,
    targetMinor: f.target_minor, deadline: f.deadline, status: f.status, revision: f.revision, progress: accounting(rows(db, f.id), f.target_minor).progress,
    organizer: { alias: f.organizer_alias }, recipientKind: JSON.parse(f.recipient_json)?.kind ?? null };
}

export function villageAction(db, { scope, actor, action, input }, clock) {
  adult(db, scope, actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'village_input', 'Review a village action.');
  const m = joined(db, scope), now = clock.iso();
  return transaction(db, () => {
    if (action === 'share-castle') {
      if (typeof input.shared !== 'boolean') throw fail(400, 'village_visibility', 'Choose whether to share your castle.');
      confirm(input);
      db.prepare('INSERT INTO village_presentations(household_id,shared,updated_at) VALUES(?,?,?) ON CONFLICT(household_id) DO UPDATE SET shared=excluded.shared,updated_at=excluded.updated_at').run(scope.householdId, input.shared ? 1 : 0, now);
      return { changedHouseholds: members(db, m.circle_id).map(n => n.household_id) };
    }
    if (action === 'create') {
      const circle = db.prepare('SELECT * FROM exchange_circles WHERE id = ?').get(m.circle_id);
      if (circle.owner_household_id !== scope.householdId) throw fail(403, 'village_organizer', 'The neighborhood’s founding family organizes its funds.');
      const title = text(input.title, 80), target = amount(input.targetMinor), rail = input.rail;
      if (!Object.hasOwn(rails, rail)) throw fail(400, 'village_rail', 'Choose simulated, PayPal sandbox, or PYUSD devnet test tokens.');
      if (input.projectKind !== undefined && input.projectKind !== 'schoolhouse') throw fail(400, 'village_project', 'The shared village project is a schoolhouse.');
      if (!isIsoDate(input.deadline) || input.deadline < clock.today() || input.deadline > `${Number(clock.today().slice(0, 4)) + 2}${clock.today().slice(4)}`) throw fail(400, 'village_deadline', 'Choose a valid date within the next two years.');
      const recipient = recipientFor(rail, input.recipient);
      confirm(input);
      if (db.prepare('SELECT COUNT(*) AS n FROM village_funds WHERE circle_id = ?').get(m.circle_id).n >= 20) throw fail(409, 'village_limit', 'This neighborhood has reached its 20-fund limit.');
      const id = newId('fund'), identity = family(db, m);
      db.prepare(`INSERT INTO village_funds(id,circle_id,organizer_household_id,organizer_member_id,organizer_reference,organizer_alias,title,project_kind,rail,currency,decimals,target_minor,deadline,recipient_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, m.circle_id, scope.householdId, actor.memberId, identity.familyReference, identity.alias, title, 'schoolhouse', rail, rails[rail].currency,
          rails[rail].decimals, target, input.deadline, JSON.stringify(recipient), now, now);
      return { fundId: id, changedHouseholds: changed(db, fundRow(db, id)) };
    }
    const f = authorizedFund(db, scope, input.fundId);
    expected(f, input.expectedRevision); confirm(input);
    if (action === 'share') {
      if (f.status !== 'open') throw fail(409, 'village_closed', 'This fund is closed to new commitments.');
      if (input.householdId !== undefined || input.familyReference !== undefined) throw fail(400, 'village_own_share', 'An adult changes only their own family’s voluntary commitment.');
      const committed = amount(input.committedMinor, true), identity = family(db, m);
      if (committed > f.target_minor) throw fail(400, 'village_share', 'A voluntary share cannot exceed the fund target.');
      db.prepare(`INSERT INTO village_shares(fund_id,household_id,family_reference,alias,committed_minor,member_id,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(fund_id,household_id) DO UPDATE SET committed_minor=excluded.committed_minor,member_id=excluded.member_id,updated_at=excluded.updated_at,alias=excluded.alias`).run(f.id, scope.householdId, identity.familyReference, identity.alias, committed, actor.memberId, now);
    } else if (action === 'publish') {
      owner(f, scope);
      if (typeof input.published !== 'boolean') throw fail(400, 'village_visibility', 'Choose whether this fund may be viewed by link.');
      db.prepare('UPDATE village_funds SET published = ? WHERE id = ?').run(input.published ? 1 : 0, f.id);
    } else if (action === 'close') {
      owner(f, scope);
      db.prepare("UPDATE village_funds SET status = 'closed' WHERE id = ?").run(f.id);
    } else throw fail(400, 'village_action', 'Choose an available fund action.');
    bump(db, f, now);
    return { fundId: f.id, changedHouseholds: changed(db, f) };
  });
}

export function villagePaymentContext(db, scope, fundId, { allowSettled = false } = {}) {
  adult(db, scope);
  const f = authorizedFund(db, scope, fundId), progress = accounting(rows(db, f.id), f.target_minor).progress;
  if (!allowSettled && f.status !== 'open') throw fail(409, 'village_closed', 'This fund is closed to new contributions.');
  if (!allowSettled && !progress.remainingMinor) throw fail(409, 'village_complete', 'This fund has reached its target.');
  return { id: f.id, fundId: f.id, rail: f.rail, targetMinor: f.target_minor, currency: f.currency, decimals: f.decimals,
    remainingMinor: progress.remainingMinor, recipient: JSON.parse(f.recipient_json), revision: f.revision, status: f.status,
    householdId: scope.householdId, memberId: scope.memberId };
}

/** Trusted adapter entry only. Never accept a browser's claim that a transfer happened. */
export function recordVillageReceipt(db, event, clock) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw fail(400, 'village_receipt', 'The confirmed receipt is invalid.');
  return transaction(db, () => {
    const f = fundRow(db, event.fundId);
    if (!f) throw fail(404, 'village_fund', 'The confirmed receipt does not name a fund.');
    if (event.source !== f.rail) throw fail(409, 'village_rail', 'This source cannot be counted in this fund.');
    const eventRef = text(event.eventRef, 180), eventIndex = index(event.eventIndex), value = amount(event.amountMinor), kind = event.kind;
    if (!['capture', 'transfer', 'refund', 'reversal'].includes(kind)) throw fail(400, 'village_receipt_kind', 'The receipt event type is invalid.');
    if ((f.rail === 'pyusd-devnet' && kind === 'capture') || (f.rail !== 'pyusd-devnet' && kind === 'transfer')) throw fail(400, 'village_receipt_kind', 'The receipt event does not match its payment source.');
    const negative = kind === 'refund' || kind === 'reversal';
    const parentRef = negative ? text(event.parentRef, 180) : null, parentIndex = negative ? index(event.parentIndex) : null;
    if (!negative && (event.parentRef != null || event.parentIndex != null)) throw fail(400, 'village_receipt_parent', 'A contribution cannot name a reversal parent.');
    const recipient = exactRecipient(f, event.recipient ?? null), recipientJson = JSON.stringify(recipient);
    const existing = db.prepare('SELECT * FROM village_receipts WHERE source = ? AND event_ref = ? AND event_index = ?').get(event.source, eventRef, eventIndex);
    if (existing) {
      if (existing.fund_id !== f.id || existing.kind !== kind || existing.amount_minor !== value || existing.parent_ref !== parentRef || existing.parent_index !== parentIndex
        || existing.recipient_json !== recipientJson || (event.familyHouseholdId ?? null) !== existing.household_id) throw fail(409, 'village_receipt_conflict', 'This source event already has a different recorded meaning.');
      return { receipt: receiptView(existing), duplicate: true, changedHouseholds: [] };
    }
    if (negative && parentRef === eventRef && parentIndex === eventIndex) throw fail(400, 'village_receipt_parent', 'A reversal cannot refer to itself.');
    const parent = negative ? db.prepare('SELECT * FROM village_receipts WHERE source = ? AND event_ref = ? AND event_index = ?').get(f.rail, parentRef, parentIndex) : null;
    if (parent && (parent.fund_id !== f.id || !['capture', 'transfer'].includes(parent.kind))) throw fail(409, 'village_receipt_conflict', 'This reversal does not belong to this fund’s contribution.');
    if (!negative) {
      const earlier = db.prepare('SELECT * FROM village_receipts WHERE source = ? AND parent_ref = ? AND parent_index = ?').all(f.rail, eventRef, eventIndex);
      if (earlier.some(r => r.fund_id !== f.id)) throw fail(409, 'village_receipt_conflict', 'A reversal already binds this source event to another fund.');
    }
    let householdId = event.familyHouseholdId ?? null, identity = null;
    if (householdId !== null) {
      if (typeof householdId !== 'string') throw fail(400, 'village_family', 'A source event may identify only a server-known family.');
      const m = member(db, householdId);
      if (m?.circle_id === f.circle_id) identity = family(db, m);
      else if (parent?.household_id === householdId) identity = { familyReference: parent.family_reference, alias: parent.alias };
      else throw fail(409, 'village_family', 'That family is not a member of the fund’s neighborhood.');
    }
    if (parent && householdId !== parent.household_id) throw fail(409, 'village_family', 'The reversal must keep its contribution’s family attribution.');
    if (!negative) {
      const earlier = db.prepare('SELECT household_id FROM village_receipts WHERE source = ? AND parent_ref = ? AND parent_index = ?').all(f.rail, eventRef, eventIndex);
      if (earlier.some(r => r.household_id !== householdId)) throw fail(409, 'village_family', 'The contribution must keep its previously recorded reversal attribution.');
    }
    const at = event.at ?? clock.iso();
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(at) || !Number.isFinite(Date.parse(at))) throw fail(400, 'village_receipt_time', 'The confirmed event time is invalid.');
    const id = newId('vrc');
    db.prepare(`INSERT INTO village_receipts(id,fund_id,source,event_ref,event_index,kind,parent_ref,parent_index,amount_minor,household_id,family_reference,alias,recipient_json,occurred_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, f.id, f.rail, eventRef, eventIndex, kind, parentRef, parentIndex, value, householdId, identity?.familyReference ?? null, identity?.alias ?? null, recipientJson, at, clock.iso());
    // Overlapping provider reversals cannot produce negative progress. Retain their distinct facts, cap the effective
    // deduction at the original contribution, and never let a late completion temporarily award unrefunded progress.
    accounting(rows(db, f.id), f.target_minor);
    bump(db, f, clock.iso());
    return { receipt: receiptView(db.prepare('SELECT * FROM village_receipts WHERE id = ?').get(id)), duplicate: false, changedHouseholds: changed(db, f) };
  });
}

export function assertVillageLeaveAllowed(db, householdId) {
  const m = member(db, householdId);
  if (!m) return;
  const circle = db.prepare('SELECT * FROM exchange_circles WHERE id = ?').get(m.circle_id);
  if (circle.owner_household_id === householdId && db.prepare('SELECT 1 FROM village_funds WHERE circle_id = ? LIMIT 1').get(m.circle_id))
    throw fail(409, 'village_history_retained', 'The organizing family keeps this neighborhood while its fund history exists.');
  if (db.prepare(`SELECT 1 FROM village_shares s JOIN village_funds f ON f.id = s.fund_id WHERE s.household_id = ? AND f.circle_id = ? AND f.status = 'open' AND s.committed_minor > 0 LIMIT 1`).get(householdId, m.circle_id))
    throw fail(409, 'village_commitment_open', 'Withdraw your voluntary commitments before leaving this neighborhood.');
}

/** Only the disposable, in-memory authored example may discard its synthetic fund history during Reset. */
export function clearExampleVillage(db, householdId) {
  const m = member(db, householdId);
  if (!m) return;
  if (db.prepare('PRAGMA database_list').all().find(d => d.name === 'main')?.file) throw fail(403, 'village_example_only', 'Only an in-memory example may discard its village history.');
  const households = db.prepare(`SELECT h.id,h.is_example FROM households h JOIN exchange_members m ON m.household_id=h.id WHERE m.circle_id=?`).all(m.circle_id);
  if (!households.length || households.some(h => h.is_example !== 1)) throw fail(403, 'village_example_only', 'This neighborhood includes a real family and cannot be reset as an example.');
  transaction(db, () => {
    db.prepare('DELETE FROM village_funds WHERE circle_id = ?').run(m.circle_id);
    for (const h of households) db.prepare('DELETE FROM village_presentations WHERE household_id = ?').run(h.id);
  });
}
