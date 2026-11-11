import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillagePresence } from '../../server/village-presence.mjs';

function fixture() {
  let t = Date.parse('2026-11-10T12:00:00Z');
  const allowed = new Map([['one', 'fund'], ['two', 'fund'], ['other', 'elsewhere']]);
  const scope = id => ({ sessionId: id, householdId: `private-${id}`, memberId: `private-member-${id}` });
  const p = createVillagePresence({ now: () => t, resolveParticipant(s, fund) {
    if (allowed.get(s.sessionId) !== fund) throw Error('Access ended');
    return { familyReference: `FAM-${s.sessionId}`, alias: s.sessionId, avatarId: 'knight' };
  } });
  return { p, scope, allowed, advance: n => { t += n; } };
}
test('presence requires consent, stays private to fund and follows actual steps', () => {
  const { p, scope, advance } = fixture();
  assert.throws(() => p.change(scope('one'), { action: 'join', fundId: 'fund' }), { code: 'village_presence_consent' });
  assert.equal(p.read(scope('one'), 'fund').members.length, 0);
  const first = p.change(scope('one'), { action: 'join', fundId: 'fund', confirmed: true });
  assert.ok(first.selfId); assert.equal(first.members[0].z, 12);
  assert.equal(p.read(scope('two'), 'fund').members.length, 1);
  assert.equal(p.read(scope('other'), 'elsewhere').members.length, 0);
  assert.doesNotMatch(JSON.stringify(first), /private-|sessionId|householdId|memberId/);
  advance(500);
  p.change(scope('one'), { action: 'move', fundId: 'fund', x: 3, z: 12 });
  assert.equal(p.read(scope('two'), 'fund').members[0].x, 3);
  assert.throws(() => p.change(scope('one'), { action: 'move', fundId: 'fund', x: 90, z: 12 }), { code: 'village_position' });
  assert.throws(() => p.change(scope('two'), { action: 'move', fundId: 'fund', x: 3, z: 12 }), { code: 'village_presence_join' });
});
test('expiry, lost membership and explicit departure immediately remove peers', () => {
  const { p, scope, allowed, advance } = fixture();
  for (const id of ['one', 'two']) p.change(scope(id), { action: 'join', fundId: 'fund', confirmed: true });
  allowed.delete('two');
  assert.equal(p.read(scope('one'), 'fund').members.length, 1);
  advance(30_001);
  assert.deepEqual(p.read(scope('one'), 'fund'), { members: [], selfId: null });
  p.change(scope('one'), { action: 'join', fundId: 'fund', confirmed: true });
  assert.deepEqual(p.change(scope('one'), { action: 'leave', fundId: 'fund' }), { members: [], selfId: null });
});
test('bounds include finite numbers and request rate; duplicate join has one identity', () => {
  const { p, scope, advance } = fixture();
  const s = scope('one'), join = { action: 'join', fundId: 'fund', confirmed: true };
  const id = p.change(s, join).selfId;
  assert.equal(p.change(s, join).selfId, id); assert.equal(p.size(), 1);
  advance(1000);
  for (const x of [NaN, Infinity, '3', null]) assert.throws(() => p.change(s, { action: 'move', fundId: 'fund', x, z: 12 }), { code: 'village_position' });
  p.change(s, { action: 'move', fundId: 'fund', x: 3, z: 12 });
  assert.throws(() => p.change(s, { action: 'move', fundId: 'fund', x: 6, z: 12 }), { code: 'village_presence_rate' });
  p.close(); assert.equal(p.size(), 0);
});
