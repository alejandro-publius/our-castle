// Store the Anthropic API key for Our Castle's runtime AI in the local, git-ignored .env without showing it.
// Usage, in your own terminal (it needs a keyboard): npm run set-ai-key
//
// - Every other .env line is kept as it is, PayPal settings included. AI_PROVIDER and AI_MODEL are filled in
//   only when missing or empty.
// - Only Anthropic Console API keys (sk-ant-api…) are accepted. Claude subscription/OAuth tokens, such as the one
//   Claude Code signs in with, are refused: the app must never run on a coding assistant's login.
// - The file is written atomically with owner-only permissions (600). The key is never printed, logged or sent anywhere.
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const AI_DEFAULTS = { AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-opus-5-5' };

/** Check that a pasted value is an Anthropic Console API key. Returns { ok, key } or { ok: false, reason }. */
export function checkApiKey(value) {
  const key = String(value ?? '').replace(/\x1b\[20[01]~/g, '').replace(/[\x00-\x20\x7f]/g, '');
  if (!key) return { ok: false, reason: 'No key entered.' };
  if (/^sk-ant-oat/i.test(key)) {
    return { ok: false, reason: 'That is a Claude subscription (OAuth) token, like the one Claude Code signs in with. Our Castle needs an API key created in the Anthropic Console instead.' };
  }
  if (!/^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return { ok: false, reason: 'That does not look like an Anthropic Console API key. They start with "sk-ant-api".' };
  }
  return { ok: true, key };
}

/** A safe label for a key: its prefix and last four characters only. */
export const maskKey = (key) => `${key.slice(0, 13)}…${key.slice(-4)}`;

/**
 * Return new .env text with `set` values replaced (or appended) and `defaults` filled in only where missing or empty.
 * Comments, blank lines, ordering and every other variable are preserved; duplicate definitions of a changed name are removed.
 */
export function upsertEnv(text, { set = {}, defaults = {} } = {}) {
  const current = parseEnv(text);
  const changes = { ...set };
  for (const [name, value] of Object.entries(defaults)) if (!String(current[name] ?? '').trim() && !(name in changes)) changes[name] = value;
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  const written = new Set();
  const out = [];
  for (const line of lines) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !(name in changes)) { out.push(line); continue; }
    if (written.has(name)) continue;
    written.add(name);
    out.push(`${name}=${changes[name]}`);
  }
  for (const [name, value] of Object.entries(changes)) if (!written.has(name)) out.push(`${name}=${value}`);
  return `${out.join('\n')}\n`;
}

/** Read one line from the terminal without echoing it. */
function promptHidden(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.reject(new Error('Run this in an interactive terminal, so the key can be pasted without being shown.'));
  // Turn echo off before the prompt appears, so even an instant paste is never shown.
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdout.write(question);
  let value = '';
  return new Promise((resolve, reject) => {
    const finish = (fn) => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); fn(); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(value));
        if (ch === '\u0003' || ch === '\u0004') return finish(() => reject(new Error('Canceled.')));
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const envPath = path.join(root, '.env');
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: root, stdio: 'ignore' });
  } catch {
    throw new Error('.env is not git-ignored in this repository, so the key was not written.');
  }
  console.log('Our Castle: store an Anthropic Console API key in the local .env (server-side only).');
  console.log('Create one at https://console.anthropic.com/settings/keys. Do not use a Claude Code or Claude.ai login.');
  const check = checkApiKey(await promptHidden('Paste the API key (hidden), then press Enter: '));
  if (!check.ok) throw new Error(check.reason);

  const before = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const kept = Object.keys(parseEnv(before)).filter((name) => name !== 'AI_API_KEY');
  const next = upsertEnv(before, { set: { AI_API_KEY: check.key }, defaults: AI_DEFAULTS });
  const temp = path.join(root, `.env.writing-${process.pid}`);
  writeFileSync(temp, next, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, envPath);
  chmodSync(envPath, 0o600);

  const after = parseEnv(next);
  console.log(`Saved AI_API_KEY (${maskKey(check.key)}) to .env with owner-only permissions.`);
  console.log(`Kept ${kept.length} other setting${kept.length === 1 ? '' : 's'}${kept.length ? `: ${kept.join(', ')}` : ''}. AI_PROVIDER=${after.AI_PROVIDER}, AI_MODEL=${after.AI_MODEL}.`);
  console.log('Next: restart the app (npm start), then run: npm run verify:live -- --ai-only');
}

// import.meta.main exists from Node 24; compare paths on older supported versions (engines: >=22.16).
const isMain = import.meta.main ?? (Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => { console.error(`${error.message} Nothing was changed.`); process.exit(1); });
}
