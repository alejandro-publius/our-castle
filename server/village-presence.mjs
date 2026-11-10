import { randomBytes } from 'node:crypto';
import { DomainError } from './household.mjs';

const fail = (status, code, message) => new DomainError(status, code, message);
const keyFor = scope => scope?.sessionId || (scope?.mode === 'example' && scope.memberId ? `example:${scope.memberId}` : null);
const coordinate = n => {
  if (!Number.isFinite(n) || n < -16 || n > 16) throw fail(400, 'village_position', 'Choose a position within the village square.');
  return Math.round(n * 100) / 100;
};

/** Optional, ephemeral presence. No money, location history or private household values enter this map. */
export function createVillagePresence({ resolveParticipant, now = Date.now, ttlMs = 30_000, maxEntries = 128 }) {
  if (typeof resolveParticipant !== 'function' || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000)
    throw new TypeError('Presence needs an authorization resolver and a bounded lifetime.');
  const entries = new Map();
  function identity(scope, fundId) {
    if (!keyFor(scope) || typeof fundId !== 'string' || fundId.length > 100)
      throw fail(403, 'village_presence_scope', 'Sign in and choose a village fund first.');
    const person = resolveParticipant(scope, fundId);
    if (!person?.familyReference || typeof person.alias !== 'string')
      throw fail(403, 'village_presence_scope', 'Your family no longer belongs to this village.');
    return { familyReference: person.familyReference, alias: person.alias, avatarId: person.avatarId ?? 'villager' };
  }
  function prune() {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.until <= t) { entries.delete(key); continue; }
      try { entry.person = identity(entry.scope, entry.fundId); } catch { entries.delete(key); }
    }
  }
  function read(scope, fundId) {
    identity(scope, fundId);
    prune();
    const self = entries.get(keyFor(scope));
    return {
      members: [...entries.values()].filter(e => e.fundId === fundId).map(e => ({
        id: e.id, ...e.person, x: e.x, z: e.z,
        updatedAt: new Date(e.at).toISOString(), expiresAt: new Date(e.until).toISOString(),
      })),
      selfId: self?.fundId === fundId ? self.id : null,
    };
  }
  function change(scope, input) {
    const { fundId, action } = input ?? {};
    const person = identity(scope, fundId), key = keyFor(scope), t = now();
    prune();
    if (action === 'leave') {
      if (entries.get(key)?.fundId === fundId) entries.delete(key);
      return read(scope, fundId);
    }
    if (!['join', 'move'].includes(action)) throw fail(400, 'village_presence_action', 'Choose join, move or leave.');
    let entry = entries.get(key);
    if (action === 'join') {
      if (input.confirmed !== true) throw fail(400, 'village_presence_consent', 'Choose to show your avatar to this village.');
      if (!entry && entries.size >= maxEntries) throw fail(429, 'village_presence_full', 'The square is busy. Try again shortly.');
      if (!entry || entry.fundId !== fundId) {
        entry = { id: `visitor_${randomBytes(12).toString('hex')}`, scope: { ...scope }, fundId, x: 0, z: 12 };
        entries.set(key, entry);
      }
    } else {
      if (!entry || entry.fundId !== fundId) throw fail(409, 'village_presence_join', 'Join the square before moving your avatar.');
      const x = coordinate(input.x), z = coordinate(input.z);
      const moving = x !== entry.x || z !== entry.z;
      if (moving && t - entry.at < 150) throw fail(429, 'village_presence_rate', 'Let your avatar reach that step first.');
      if (moving && Math.hypot(x - entry.x, z - entry.z) > Math.max(4.3, Math.min(46, (t - entry.at) / 1000 * 8)))
        throw fail(400, 'village_presence_step', 'Take a smaller step within the square.');
      entry.x = x; entry.z = z;
    }
    entry.person = person; entry.at = t; entry.until = t + ttlMs;
    return read(scope, fundId);
  }
  return { read, change, close: () => entries.clear(), size: () => { prune(); return entries.size; } };
}
