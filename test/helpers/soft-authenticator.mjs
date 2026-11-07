// A software WebAuthn authenticator for server tests only. It produces genuine ES256 (P-256) registration ("none"
// attestation) and authentication responses with node:crypto, so the server's real verification (the pinned
// @simplewebauthn/server) can be exercised with deliberate faults: another origin or relying party, no user
// verification, a replayed challenge or a cloned counter. It is test scaffolding, never product code.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => createHash('sha256').update(data).digest();

// Minimal CBOR (RFC 8949) encoding for the few shapes WebAuthn needs: unsigned/negative integers, byte and text strings, maps.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const t = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, t.length), t]); }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.concat([head(2, value.length), Buffer.from(value)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('unsupported CBOR value');
}

const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 };

export function createSoftAuthenticator() {
  const credentials = new Map(); // id -> { privateKey, cose, rpId, userHandle, counter }
  function authData(rpId, flags, counter, attested = null) {
    const count = Buffer.alloc(4); count.writeUInt32BE(counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  }
  return {
    credentials,
    /** navigator.credentials.create() for `options` (from the server), as this page origin would call it. */
    register(options, { origin, rpId = options.rp.id, userVerified = true, type = 'webauthn.create', challenge = options.challenge } = {}) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const jwk = publicKey.export({ format: 'jwk' });
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const id = randomBytes(16);
      const idLength = Buffer.alloc(2); idLength.writeUInt16BE(id.length);
      const attested = Buffer.concat([Buffer.alloc(16), idLength, id, cose]);
      const data = authData(rpId, FLAGS.UP | (userVerified ? FLAGS.UV : 0) | FLAGS.AT, 0, attested);
      const clientData = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', data]]));
      credentials.set(b64u(id), { privateKey, rpId, userHandle: options.user.id, counter: 0 });
      return {
        id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestationObject), transports: ['internal'] },
      };
    },
    /** navigator.credentials.get() with a discoverable credential. `counter` lets a test imitate a cloned authenticator. */
    authenticate(options, { origin, credentialId = [...credentials.keys()].at(-1), rpId = options.rpId, userVerified = true, counter, challenge = options.challenge } = {}) {
      const cred = credentials.get(credentialId);
      cred.counter = counter ?? cred.counter + 1;
      const data = authData(rpId, FLAGS.UP | (userVerified ? FLAGS.UV : 0), cred.counter);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const signature = sign('sha256', Buffer.concat([data, sha256(clientData)]), cred.privateKey);
      return {
        id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(data), signature: b64u(signature), userHandle: cred.userHandle },
      };
    },
  };
}
