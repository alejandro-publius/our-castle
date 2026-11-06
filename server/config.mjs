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

  // Market Town merchant: Channel3 product search. Server-side only; absent means a plain "not connected" state.
  const channel3Key = trimmed('CHANNEL3_API_KEY');
  const merchant = channel3Key ? { mode: 'live', apiKey: channel3Key } : { mode: 'off' };

  // Treasury: an optional AG Studio evaluation licence. Browser licences are client-side by design; only this one value
  // is ever handed to the page (GET /api/treasury/studio), never the rest of the environment.
  const studioLicence = trimmed('AG_STUDIO_LICENSE_KEY');
  const studio = studioLicence ? { licenseKey: studioLicence } : null;

  const dataDir = path.resolve(root, trimmed('OUR_CASTLE_DATA_DIR') || 'data');
  const access = accessConfig(trimmed('OUR_CASTLE_ACCESS'), trimmed('OUR_CASTLE_ORIGIN'));
  return { port: Number.isFinite(port) ? port : 3010, host, payments, ai, merchant, studio, dataDir, access, warnings };
}

export class ConfigError extends Error {}

// Family access timings. Short ceremonies and invitations; a session lasts a family evening, not forever.
export const ACCESS_DEFAULTS = Object.freeze({
  challengeMs: 5 * 60_000,       // one passkey ceremony
  flowMs: 10 * 60_000,           // the browser binding for a sign-in, family creation or invitation ceremony
  inviteMs: 48 * 3_600_000,      // an invitation link
  sessionIdleMs: 30 * 60_000,    // inactivity
  sessionAbsoluteMs: 12 * 3_600_000,
  recentAuthMs: 10 * 60_000,     // adding a passkey needs a passkey check this recent
});

/**
 * The server's access mode. "example" (default) is the single local example household with no accounts. "family" is
 * real shared households with passkey accounts; it needs the exact browser origin (and so the WebAuthn relying party).
 * Only server configuration selects it; no request can. An unusable origin stops the server instead of weakening checks.
 */
export function accessConfig(mode, origin) {
  const chosen = (mode || 'example').toLowerCase();
  if (chosen === 'example') return { mode: 'example' };
  if (chosen !== 'family') throw new ConfigError(`OUR_CASTLE_ACCESS must be "example" or "family", not "${mode}".`);
  let url;
  try { url = new URL(origin); } catch { throw new ConfigError('Family access needs OUR_CASTLE_ORIGIN, the exact address families open, like http://localhost:3200.'); }
  const local = url.hostname === 'localhost';
  if (url.origin !== origin.replace(/\/$/, '') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new ConfigError('OUR_CASTLE_ORIGIN must be a bare origin such as http://localhost:3200 (no path, query or credentials).');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new ConfigError('Family access needs https, except on http://localhost.');
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || url.hostname.startsWith('[')) {
    throw new ConfigError('Passkeys need a host name for OUR_CASTLE_ORIGIN (localhost or a domain), not an IP address.');
  }
  return {
    mode: 'family', origin: url.origin, host: url.host, rpId: url.hostname, rpName: 'Our Castle', secure: url.protocol === 'https:',
    ...ACCESS_DEFAULTS,
  };
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
    access: config.access?.mode === 'family' ? 'family' : 'example',
    warnings: config.warnings,
  };
}
