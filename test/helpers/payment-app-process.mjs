// The app in a process of its own (test/helpers/payment-app-child.mjs), for tests that kill it abruptly or run two of
// them on one disposable database: test/unit/payment-restart.test.mjs and test/unit/payment-two-servers.test.mjs.
// Each process starts with an empty environment. Only a test's own children are ever signalled.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webhookHeaders } from './fake-paypal.mjs';

export const WAIT = 20_000;
const childScript = fileURLToPath(new URL('./payment-app-child.mjs', import.meta.url));
// What a traced child writes before each write transaction asks SQLite for the lock (see payment-app-child.mjs).
const BEGIN_MARK = 'harness: begin immediate\n';

export const within = (promise, ms, what) => Promise.race([promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), ms).unref(); })]);

// SIGKILL ends the process at once, with no shutdown code. Only this test's own children are ever signalled; one that
// has already ended, or is ending, is only waited for.
export async function end(child, exited, wait) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await within(exited, wait, 'the app process to end');
}

// One app process on `file`, with an empty environment. `withheld` names a route whose answer the harness withholds.
// If it does not become ready, its own child is ended before the error is passed on. `script`, `wait` and `onSpawn`
// let the startup-cleanup test use a child that never becomes ready. With `trace`, the child announces each write
// transaction, and `begun(n)` waits until it has announced n of them.
export async function startApp(file, paypalBase, withheld = '', { script = childScript, wait = WAIT, onSpawn, trace = false } = {}) {
  const child = fork(script, [file, paypalBase, withheld, ...(trace ? ['trace-transactions'] : [])], { env: {}, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  onSpawn?.(child);
  // Listened for at once, so no exit is missed, even one before the rest is set up.
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let stderr = '';
  let begins = 0;
  const waiting = [];
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    begins = stderr.split(BEGIN_MARK).length - 1;
    for (const w of waiting.filter((w) => begins >= w.n)) { waiting.splice(waiting.indexOf(w), 1); w.resolve(); }
  });
  const messages = [];
  child.on('message', (message) => messages.push(message));
  let port;
  try {
    port = await within(new Promise((resolve, reject) => {
      child.on('message', (message) => { if (message.ready) resolve(message.ready); });
      exited.then(({ code, signal }) => reject(new Error(`The app process ended (${code ?? signal}) before it was ready: ${stderr.slice(-500)}`)));
    }), wait, 'the app process to start');
  } catch (error) {
    await end(child, exited, wait);
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  const send = async (pathname, body, headers) => {
    const res = await fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    return { status: res.status, json: await res.json() };
  };
  return {
    child,
    get begins() { return begins; },
    begun: (n, ms = WAIT) => within(new Promise((resolve) => { if (begins >= n) resolve(); else waiting.push({ n, resolve }); }), ms, `the app process to reach write transaction ${n}`),
    call: (pathname, body) => send(pathname, JSON.stringify(body), { Origin: base }),
    deliver: (event) => send('/api/paypal/webhook', JSON.stringify(event), webhookHeaders),
    message: (key) => within(new Promise((resolve) => {
      const seen = messages.find((m) => key in m);
      if (seen) resolve(seen); else child.on('message', (m) => { if (key in m) resolve(m); });
    }), WAIT, key),
    kill: () => end(child, exited, WAIT),
  };
}
