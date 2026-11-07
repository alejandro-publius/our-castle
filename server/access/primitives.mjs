// Small building blocks for family access: random opaque tokens stored only as hashes, cookies and a bounded rate limit.
// No password or signature cryptography lives here; passkey verification is the pinned @simplewebauthn/server library.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random opaque token (base64url, 256 bits by default). Sent to the browser once; the server keeps only its hash. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!/^[\w.-]+$/.test(name) || Object.hasOwn(out, name)) continue; // the first value of a name wins
    out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** An HttpOnly, SameSite=Strict, path-wide cookie; Secure (with the __Host- prefix) on https origins. */
export function cookieName(base, secure) { return secure ? `__Host-${base}` : base; }
export function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Fixed-window request budget per key (for example an address and a ceremony). Memory is bounded. */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      let entry = hits.get(key);
      if (!entry || t - entry.start >= windowMs) entry = { start: t, count: 0 };
      entry.count += 1;
      hits.set(key, entry);
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return entry.count <= max;
    },
  };
}

/** A person's name as shown to the family: 1–40 printable characters, single spaces. */
export function cleanDisplayName(value) {
  const text = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  // No control or format characters (they could disguise one name as another).
  if (!text || text.length > 40 || /[\p{Cc}\p{Cf}]/u.test(text)) return null;
  return text;
}
