import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
export const PAYPAL_SANDBOX_SDK = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
const SUPPORTED_AI_PROVIDERS = new Set(['anthropic']);

/**
 * Read the local, server-only `.env` file without copying its secrets into process.env.
 * Values already in the process environment win, so a test or shell can override them.
 */
export function readEnvironment({ root, envFile = process.env.OUR_CASTLE_ENV_FILE, processEnv = process.env } = {}) {
  const file = envFile === 'none' ? null : path.resolve(root, envFile || '.env');
  const fromFile = file && existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const merged = { ...fromFile };
  for (const [key, value] of Object.entries(processEnv)) if (value !== undefined && value !== '') merged[key] = value;
  return { env: merged, envFileLoaded: Boolean(file && existsSync(file)) };
}

/**
 * Turn environment values into an explicit runtime configuration. Missing credentials select
 * clearly labeled example modes; they never fall back to another credential source.
 * Deliberately ignored: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN and any coding-assistant session.
 */
export function loadConfig(env = {}, { root = process.cwd() } = {}) {
  const warnings = [];
  const trimmed = (name) => (typeof env[name] === 'string' ? env[name].trim() : '');

  const port = Number.parseInt(trimmed('PORT') || '3010', 10);
  const host = trimmed('HOST') || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    warnings.push(`HOST=${host} exposes this local prototype beyond this computer; it is intended for 127.0.0.1.`);
  }

  let payments = { mode: 'example' };
  const clientId = trimmed('PAYPAL_CLIENT_ID');
  const clientSecret = trimmed('PAYPAL_CLIENT_SECRET');
  const paypalEnv = (trimmed('PAYPAL_ENV') || 'sandbox').toLowerCase();
  if (clientId && clientSecret) {
    if (paypalEnv !== 'sandbox') {
      warnings.push('PAYPAL_ENV must be "sandbox". Live PayPal endpoints are not supported, so payments stay in example mode.');
    } else {
      payments = {
        mode: 'sandbox',
        clientId,
        clientSecret,
        webhookId: trimmed('PAYPAL_WEBHOOK_ID') || null,
        apiBase: PAYPAL_SANDBOX_API,
        sdkUrl: PAYPAL_SANDBOX_SDK,
      };
    }
  } else if (clientId || clientSecret) {
    warnings.push('PayPal sandbox mode needs both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Payments stay in example mode.');
  }

  let ai = { mode: 'example' };
  const apiKey = trimmed('AI_API_KEY');
  const provider = (trimmed('AI_PROVIDER') || (apiKey ? 'anthropic' : '')).toLowerCase();
  if (apiKey) {
    if (!SUPPORTED_AI_PROVIDERS.has(provider)) {
      warnings.push(`AI_PROVIDER "${provider}" is not supported (supported: anthropic). Plans use the labeled example planner.`);
    } else {
      ai = { mode: 'live', provider, model: trimmed('AI_MODEL') || DEFAULT_AI_MODEL, apiKey };
    }
  }

  const dataDir = path.resolve(root, trimmed('OUR_CASTLE_DATA_DIR') || 'data');
  return { port: Number.isFinite(port) ? port : 3010, host, payments, ai, dataDir, warnings };
}

/** Public, secret-free description of the active modes, safe to send to the browser. */
export function publicModes(config) {
  return {
    payments: config.payments.mode === 'sandbox'
      ? { mode: 'sandbox', label: 'PayPal sandbox', webhooks: Boolean(config.payments.webhookId) }
      : { mode: 'example', label: 'Example payments (simulated)' },
    ai: config.ai.mode === 'live'
      ? { mode: 'live', label: 'AI planner', provider: config.ai.provider, model: config.ai.model }
      : { mode: 'example', label: 'Example planner (built-in rules, no AI)' },
    warnings: config.warnings,
  };
}
