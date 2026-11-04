import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { AI_DEFAULTS, checkApiKey, maskKey, upsertEnv } from '../../scripts/set-ai-key.mjs';
import { loadConfig } from '../../server/config.mjs';

// Synthetic, obviously fake values. Real keys never appear in tests.
const FAKE_KEY = 'sk-ant-api03-FAKEfakeFAKEfakeFAKEfake_0123456789-abcd';
const PAYPAL_ENV = [
  '# Our Castle local settings',
  'PAYPAL_ENV=sandbox',
  'PAYPAL_CLIENT_ID=public-client-id-123',
  'PAYPAL_CLIENT_SECRET=paypal-secret-456',
  'PAYPAL_WEBHOOK_ID=',
  '',
  'AI_PROVIDER=anthropic',
  'AI_MODEL=claude-opus-5-5',
  'AI_API_KEY=',
  'PORT=3010',
  '',
].join('\n');

test('only Anthropic Console API keys are accepted; Claude subscription/OAuth tokens are refused', () => {
  assert.deepEqual(checkApiKey(FAKE_KEY), { ok: true, key: FAKE_KEY });
  assert.equal(checkApiKey(`  ${FAKE_KEY}\n`).key, FAKE_KEY, 'surrounding whitespace from a paste is dropped');
  assert.equal(checkApiKey(`\x1b[200~${FAKE_KEY}\x1b[201~`).key, FAKE_KEY, 'bracketed-paste markers are dropped');
  const oauth = checkApiKey('sk-ant-oat01-FAKEfakeFAKEfakeFAKEfake_0123456789');
  assert.equal(oauth.ok, false);
  assert.match(oauth.reason, /Claude subscription \(OAuth\) token/);
  for (const bad of ['', '   ', 'hello', 'sk-proj-FAKEfakeFAKEfakeFAKEfake', 'sk-ant-api03-short']) assert.equal(checkApiKey(bad).ok, false, JSON.stringify(bad));
  assert.equal(maskKey(FAKE_KEY), 'sk-ant-api03-…abcd');
  assert.ok(!maskKey(FAKE_KEY).includes('FAKEfake'), 'the mask never shows the secret part');
});

test('setting the AI key keeps every PayPal setting, comment and line order', () => {
  const next = upsertEnv(PAYPAL_ENV, { set: { AI_API_KEY: FAKE_KEY }, defaults: AI_DEFAULTS });
  assert.equal(next, PAYPAL_ENV.replace('AI_API_KEY=\n', `AI_API_KEY=${FAKE_KEY}\n`));
  const env = parseEnv(next);
  assert.equal(env.PAYPAL_CLIENT_SECRET, 'paypal-secret-456');
  assert.equal(env.PAYPAL_ENV, 'sandbox');
  assert.equal(env.PORT, '3010');

  const config = loadConfig(env);
  assert.equal(config.ai.mode, 'live');
  assert.equal(config.ai.model, 'claude-opus-5-5');
  assert.equal(config.payments.mode, 'sandbox', 'PayPal sandbox mode survives the AI key update');
});

test('defaults fill only missing or empty AI settings; a chosen model and duplicates are handled', () => {
  const custom = 'AI_MODEL=claude-sonnet-5-5\nAI_API_KEY=old-one\nAI_API_KEY=older-duplicate\n';
  const next = parseEnv(upsertEnv(custom, { set: { AI_API_KEY: FAKE_KEY }, defaults: AI_DEFAULTS }));
  assert.equal(next.AI_MODEL, 'claude-sonnet-5-5', 'an owner-chosen model is kept');
  assert.equal(next.AI_PROVIDER, 'anthropic', 'a missing provider is added');
  assert.equal(next.AI_API_KEY, FAKE_KEY);
  assert.equal(upsertEnv(custom, { set: { AI_API_KEY: FAKE_KEY } }).match(/AI_API_KEY=/g).length, 1, 'duplicate definitions are removed');

  const fromEmpty = upsertEnv('', { set: { AI_API_KEY: FAKE_KEY }, defaults: AI_DEFAULTS });
  assert.deepEqual({ ...parseEnv(fromEmpty) }, { AI_API_KEY: FAKE_KEY, AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-opus-5-5' });
  assert.ok(fromEmpty.endsWith('\n'));
});

test('the server ignores ANTHROPIC_API_KEY, so only the .env AI_API_KEY can switch AI on', () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: FAKE_KEY }).ai.mode, 'example');
  assert.equal(loadConfig({ AI_API_KEY: FAKE_KEY }).ai.mode, 'live');
});
