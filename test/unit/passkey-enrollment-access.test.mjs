import test from 'node:test';
import assert from 'node:assert/strict';
import { familyWith, startServer } from '../helpers/family-http.mjs';

// Gate the real verifier's asynchronous RP-ID hash, retaining all actual WebAuthn validation. Separate node:test
// files have separate processes; within this file these cases run sequentially and restore the crypto method.
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
for (const reason of ['revocation', 'idle expiry', 'sign-out', 'renewed sign-in', 'active']) {
  test(`${reason} during passkey verification controls whether a credential is stored`, { timeout: 10_000 }, async () => {
    const s = await startServer(), entered = gate(), finish = gate();
    const subtle = globalThis.crypto.subtle, digest = subtle.digest;
    let pending, gated = false;
    try {
      const { owner, Ash: adult } = await familyWith(s, [['Ash', 'adult']]);
      const before = (await adult.call('GET', '/api/state')).json;
      const count = () => s.db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n;
      const oldCount = count();
      const originalKey = [...adult.auth.credentials.keys()][0];
      const options = await adult.call('POST', '/api/auth/passkeys/options', {});
      assert.equal(options.status, 200, JSON.stringify(options.json));
      const response = adult.auth.register(options.json.options, { origin: s.origin });
      subtle.digest = async function (...args) {
        const result = await digest.apply(this, args);
        if (!gated) { gated = true; entered.release(); await finish.promise; }
        return result;
      };
      pending = adult.call('POST', '/api/auth/passkeys/verify', { ceremonyId: options.json.ceremonyId, response });
      await entered.promise;
      if (reason === 'revocation') assert.equal((await owner.call('POST', `/api/family/members/${before.access.me.memberId}/revoke`, {})).status, 200);
      else if (reason === 'idle expiry') s.clock.advance(31 * 60_000);
      else if (reason === 'sign-out') assert.equal((await adult.call('POST', '/api/auth/signout', {})).status, 200);
      // Renew with the registered original key, while enrollment of the new key is still waiting.
      else if (reason === 'renewed sign-in') assert.equal((await adult.signIn({ credentialId: originalKey })).done.status, 200);
      finish.release();
      const result = await pending;
      assert.equal(result.status, reason === 'active' ? 200 : 401);
      assert.equal(count(), oldCount + (reason === 'active' ? 1 : 0), 'an ended request cannot add a passkey');
      if (reason === 'renewed sign-in') assert.equal((await adult.call('GET', '/api/state')).status, 200, 'the newer sign-in stays usable');
    } finally { finish.release(); if (pending) await pending; subtle.digest = digest; await s.close(); }
  });
}
