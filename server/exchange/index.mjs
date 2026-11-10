import { createHash, randomBytes } from 'node:crypto';
import { DomainError, getGoal, getMember, isIsoDate, newId } from '../household.mjs';
import { transaction } from '../db.mjs';
import { kitView } from '../kit/list.mjs';

const fail = (status, code, message) => new DomainError(status, code, message);
const hash = token => createHash('sha256').update(token).digest('hex');
const text = (value, max, required = true) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\x00-\x1f\x7f]/.test(value))
    throw fail(400, 'exchange_text', `Use ${required ? '1' : '0'}–${max} characters of plain text.`);
  return value.trim();
};
const count = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw fail(400, 'exchange_quantity', 'Choose a quantity from 1 to 100.'); return value; };
const date = (value, today) => { if (!isIsoDate(value) || value < today) throw fail(400, 'exchange_date', 'Choose today or a later date.'); return value; };
const membership = (db, householdId) => db.prepare('SELECT * FROM exchange_members WHERE household_id = ?').get(householdId);
const circle = (db, id) => db.prepare('SELECT * FROM exchange_circles WHERE id = ?').get(id);
const offered = (db, requestId) => db.prepare("SELECT o.*, COALESCE(m.alias, 'Former neighbor') AS alias FROM exchange_offers o JOIN exchange_requests r ON r.id = o.request_id LEFT JOIN exchange_members m ON m.household_id = o.household_id AND m.circle_id = r.circle_id WHERE o.request_id = ? ORDER BY o.created_at, o.id").all(requestId);
const allMembers = (db, circleId) => db.prepare('SELECT household_id FROM exchange_members WHERE circle_id = ?').all(circleId).map(r => r.household_id);
const kitLine = (db, request) => {
  const goal = getGoal(db, request.goal_id);
  const line = goal && kitView(db, goal).items.find(i => i.id === request.line_id && i.name === request.item_name && (i.needs ?? null) === request.needs);
  if (!line) throw fail(409, 'exchange_kit_changed', 'The family changed this kit item. Close the old request and share the updated need.');
  return line;
};

/** Only explicitly shared need fields leave a household; offers are visible to the two participating families. */
export function exchangeView(db, scope) {
  const member = membership(db, scope.householdId);
  if (!member) return { neighborhood: null, requests: [], invites: [] };
  const group = circle(db, member.circle_id);
  const own = group.owner_household_id === scope.householdId;
  const requests = db.prepare(`SELECT r.*, m.alias FROM exchange_requests r JOIN exchange_members m ON m.household_id = r.household_id
    WHERE r.circle_id = ? ORDER BY r.created_at DESC, r.id`).all(group.id).map(r => {
      const offers = offered(db, r.id), mine = r.household_id === scope.householdId;
      const held = offers.filter(o => ['accepted', 'received'].includes(o.status)).reduce((n, o) => n + o.quantity, 0);
      return { id: r.id, family: r.alias, mine, item: r.item_name, needs: r.needs, quantity: r.quantity,
        neededUntil: r.needed_until, note: r.note, status: r.status, openQuantity: Math.max(0, r.quantity - held),
        offers: offers.filter(o => mine || o.household_id === scope.householdId).map(o => ({ id: o.id, mine: o.household_id === scope.householdId,
          family: o.alias, quantity: o.quantity, kind: o.kind, returnBy: o.return_by, note: o.note, status: o.status })) };
    });
  return { neighborhood: { name: group.name, alias: member.alias, owner: own, households: allMembers(db, group.id).length }, requests,
    invites: own ? db.prepare('SELECT id, expires_at AS expiresAt, used_at AS usedAt, revoked_at AS revokedAt FROM exchange_invites WHERE circle_id = ? ORDER BY rowid DESC LIMIT 12').all(group.id) : [] };
}

export function exchangeAction(db, { scope, actor, action, input }, clock) {
  for (const key of ['requestId','offerId','inviteId']) if (input[key] !== undefined && typeof input[key] !== 'string') throw fail(400, 'exchange_id', 'Choose an item on this neighborhood board.');
  const actual = getMember(db, scope.householdId, actor.memberId);
  if (!actual || actual.role !== 'adult') throw fail(403, 'adult_required', 'An adult in the family manages neighborhood sharing.');
  return transaction(db, () => {
    let m = membership(db, scope.householdId);
    const now = clock.iso(), today = clock.today();
    const needMember = () => { if (!m) throw fail(403, 'exchange_membership', 'Join a neighborhood first.'); return circle(db, m.circle_id); };
    const requireOwner = () => { const g = needMember(); if (g.owner_household_id !== scope.householdId) throw fail(403, 'exchange_owner', 'Only the neighborhood’s founding family manages its invitations.'); return g; };
    const done = (extra = {}) => ({ ...extra, changedHouseholds: m ? allMembers(db, m.circle_id) : [scope.householdId] });
    const invitation = token => {
      if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw fail(404, 'exchange_invite', 'This invitation is invalid, used or expired.');
      const i = db.prepare('SELECT * FROM exchange_invites WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(hash(token), now);
      if (!i) throw fail(404, 'exchange_invite', 'This invitation is invalid, used or expired.');
      return i;
    };
    if (action === 'create') {
      if (m) throw fail(409, 'exchange_joined', 'Your family already belongs to a neighborhood.');
      const name = text(input.name, 50), alias = text(input.alias, 40), id = newId('village');
      db.prepare('INSERT INTO exchange_circles VALUES (?, ?, ?, ?)').run(id, name, scope.householdId, now);
      db.prepare('INSERT INTO exchange_members VALUES (?, ?, ?, ?)').run(scope.householdId, id, alias, now);
      m = membership(db, scope.householdId); return done();
    }
    if (action === 'preview' || action === 'join') {
      const i = invitation(input.token), g = circle(db, i.circle_id);
      if (action === 'preview') return { preview: { name: g.name, households: allMembers(db, g.id).length }, changedHouseholds: [] };
      if (input.confirmed !== true) throw fail(400, 'exchange_confirm', 'Review what the neighborhood can see, then confirm joining.');
      if (m) throw fail(409, 'exchange_joined', 'Your family already belongs to a neighborhood.');
      if (allMembers(db, g.id).length >= 12) throw fail(409, 'exchange_full', 'This neighborhood has reached its 12-family limit.');
      const alias = text(input.alias, 40);
      if (db.prepare('SELECT 1 FROM exchange_members WHERE circle_id = ? AND lower(alias) = lower(?)').get(g.id, alias)) throw fail(409, 'exchange_alias', 'Choose a different family name for this neighborhood.');
      db.prepare('INSERT INTO exchange_members VALUES (?, ?, ?, ?)').run(scope.householdId, g.id, alias, now);
      db.prepare('UPDATE exchange_invites SET used_at = ? WHERE id = ?').run(now, i.id);
      m = membership(db, scope.householdId); return done();
    }
    if (action === 'invite') {
      const g = requireOwner();
      const n = db.prepare('SELECT COUNT(*) AS n FROM exchange_invites WHERE circle_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(g.id, now).n;
      if (n >= 5) throw fail(429, 'exchange_invite_limit', 'Use or revoke an existing invitation before making another.');
      const token = randomBytes(24).toString('hex'), id = newId('vi'), expires = new Date(clock.now().getTime() + 24 * 3600_000).toISOString();
      db.prepare('INSERT INTO exchange_invites(id,circle_id,token_hash,expires_at) VALUES (?,?,?,?)').run(id, g.id, hash(token), expires);
      return done({ invitation: { id, token, expiresAt: expires } });
    }
    if (action === 'revoke-invite') {
      const g = requireOwner();
      db.prepare('UPDATE exchange_invites SET revoked_at = ? WHERE id = ? AND circle_id = ? AND used_at IS NULL').run(now, input.inviteId ?? '', g.id); return done();
    }
    const g = needMember();
    if (action === 'leave') {
      const held = db.prepare(`SELECT 1 FROM exchange_offers o JOIN exchange_requests r ON r.id = o.request_id
        WHERE (r.household_id = ? AND o.status IN ('accepted','received'))
          OR (o.household_id = ? AND (o.status = 'accepted' OR (o.status = 'received' AND o.kind = 'loan')))`).get(scope.householdId, scope.householdId);
      if (held) throw fail(409, 'exchange_handover_open', 'Resolve accepted items and return or release received items before leaving.');
      const peers = allMembers(db, g.id);
      if (g.owner_household_id === scope.householdId && peers.length > 1) throw fail(409, 'exchange_founder', 'The founding family can leave after the other families have left.');
      db.prepare("UPDATE exchange_offers SET status = 'withdrawn', updated_at = ? WHERE household_id = ? AND status = 'offered'").run(now, scope.householdId);
      db.prepare('DELETE FROM exchange_requests WHERE household_id = ?').run(scope.householdId);
      db.prepare('DELETE FROM exchange_members WHERE household_id = ?').run(scope.householdId);
      if (g.owner_household_id === scope.householdId) db.prepare('DELETE FROM exchange_circles WHERE id = ?').run(g.id);
      return { changedHouseholds: peers };
    }
    if (action === 'request') {
      const goal = getGoal(db, scope.goalId), kit = kitView(db, goal);
      if (input.kitRevision !== kit.revision) throw fail(409, 'exchange_kit_changed', 'The kit changed. Review it before sharing an item.');
      const line = kit.items.find(l => l.id === input.lineId), quantity = count(input.quantity);
      if (!line || quantity > line.remaining) throw fail(400, 'exchange_need', 'Share a quantity your saved kit still needs.');
      if (input.confirmed !== true) throw fail(400, 'exchange_confirm', 'Confirm sharing this item’s name, requirements, quantity, date and note.');
      const needed = date(input.neededUntil, today);
      if (goal.targetDate && needed < goal.targetDate) throw fail(400, 'exchange_date', 'The item must be available through the goal date.');
      if (db.prepare("SELECT 1 FROM exchange_requests WHERE goal_id = ? AND line_id = ? AND status = 'open'").get(goal.id, line.id)) throw fail(409, 'exchange_duplicate', 'This item already has an open request.');
      if (db.prepare("SELECT COUNT(*) AS n FROM exchange_requests WHERE circle_id = ? AND status = 'open'").get(g.id).n >= 24) throw fail(409, 'exchange_full', 'Close a finished request before adding another to this board.');
      if (db.prepare('SELECT COUNT(*) AS n FROM exchange_requests WHERE circle_id = ?').get(g.id).n >= 200) throw fail(409, 'exchange_full', 'This neighborhood has reached its request limit.');
      const id = newId('need');
      db.prepare('INSERT INTO exchange_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,g.id,scope.householdId,goal.id,line.id,line.name,line.needs,quantity,needed,text(input.note ?? '',160,false),'open',now);
      return done({ requestId: id });
    }
    const request = db.prepare('SELECT * FROM exchange_requests WHERE id = ? AND circle_id = ?').get(input.requestId ?? '', g.id);
    if (!request) throw fail(404, 'exchange_request', 'That request is not on your neighborhood board.');
    const mine = request.household_id === scope.householdId;
    if (action === 'close') {
      if (!mine) throw fail(403, 'exchange_owner', 'Only the requesting family closes a request.');
      if (offered(db,request.id).some(o => ['accepted','received'].includes(o.status))) throw fail(409, 'exchange_handover_open', 'Resolve or return the shared items before closing this request.');
      db.prepare("UPDATE exchange_requests SET status = 'closed' WHERE id = ?").run(request.id);
      db.prepare("UPDATE exchange_offers SET status = 'declined', updated_at = ? WHERE request_id = ? AND status = 'offered'").run(now,request.id); return done();
    }
    if (action === 'offer') {
      if (mine || request.status !== 'open') throw fail(403, 'exchange_offer', 'Offer an item to another family’s open request.');
      const quantity = count(input.quantity), kind = input.kind;
      if (!['loan','gift'].includes(kind) || quantity > request.quantity) throw fail(400, 'exchange_offer', 'Choose a loan or gift within the requested quantity.');
      const returnBy = kind === 'loan' ? date(input.returnBy,today) : null;
      if (kind === 'loan' && returnBy < request.needed_until) throw fail(400, 'exchange_return_date', 'A loan must cover the family’s needed-through date.');
      const offers = offered(db,request.id);
      if (offers.length >= 24 || offers.some(o => o.household_id === scope.householdId && ['offered','accepted','received'].includes(o.status))) throw fail(409, 'exchange_duplicate', 'Resolve your existing offer before making another.');
      const id = newId('loan');
      db.prepare('INSERT INTO exchange_offers VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,request.id,scope.householdId,quantity,kind,returnBy,text(input.note ?? '',160,false),'offered',now,now); return done({ offerId:id });
    }
    const offer = db.prepare('SELECT * FROM exchange_offers WHERE id = ? AND request_id = ?').get(input.offerId ?? '',request.id);
    if (!offer || (!mine && offer.household_id !== scope.householdId)) throw fail(404, 'exchange_offer', 'That offer is not available to your family.');
    let next;
    if (action === 'accept' || action === 'receive' || action === 'return') {
      if (!mine) throw fail(403, 'exchange_owner', 'The receiving family confirms this step.');
      next = { accept:'accepted', receive:'received', return:'returned' }[action];
      if (offer.status === next) return done(); // repeating an already confirmed step cannot add stock twice
      const previous = { accept:'offered', receive:'accepted', return:'received' }[action];
      if (offer.status !== previous) throw fail(409, 'exchange_changed', 'This offer changed. Review its latest status before continuing.');
      if (action !== 'return') {
        if (request.status !== 'open') throw fail(409, 'exchange_closed', 'This request has closed.');
        const line = kitLine(db,request), goal = getGoal(db,request.goal_id);
        if (offer.kind === 'loan' && (!goal.targetDate || offer.return_by < goal.targetDate || offer.return_by < today)) throw fail(409, 'exchange_date_changed', 'This loan no longer covers the goal date. Ask for an updated offer.');
        const other = offered(db,request.id).filter(o => o.id !== offer.id && ['accepted','received'].includes(o.status)).reduce((n,o)=>n+o.quantity,0);
        if (other + offer.quantity > request.quantity || offer.quantity > line.remaining) throw fail(409, 'exchange_covered', 'This need is already covered, or the kit quantity changed.');
      }
    } else if (action === 'cancel') {
      if (!['offered','accepted'].includes(offer.status)) throw fail(409, 'exchange_changed', 'A received item must be returned or released, not canceled.');
      next = mine ? 'declined' : 'withdrawn';
    } else throw fail(400, 'exchange_action', 'Choose an available sharing action.');
    db.prepare('UPDATE exchange_offers SET status = ?, updated_at = ? WHERE id = ?').run(next,now,offer.id);
    if (action === 'receive' || action === 'return') db.prepare('UPDATE kit_lists SET revision = revision + 1 WHERE goal_id = ?').run(request.goal_id);
    return done();
  });
}
