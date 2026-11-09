// Running the complete-kit solver for the server. One request in, one checked answer out.
// - The native solver is the Rust program built from solver/ (cargo build --release --locked). Its path is fixed here, from
//   the app's root: nothing a request says can choose the program, its arguments, its working folder or its environment.
// - It runs with shell: false, an empty environment, a fixed working folder, bounded input and output, a hard time limit,
//   abort support and at most a few at once. It has no network, file or identity access of its own.
// - Every answer, native or reference, is checked against its request (verifySolverAnswer) before anything uses it.
// - Without a native build (a checkout without Rust), the in-process reference solver (src/core/kit-plan.js) answers
//   instead. When the native solver is present but fails, that failure is reported: the reference is not substituted.
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '../household.mjs';
import { KitPlanError, checkSolverRequest, referenceSolve, verifySolverAnswer } from '../../src/core/kit-plan.js';

export const SOLVER_LIMITS = Object.freeze({ timeoutMs: 2000, maxConcurrent: 2, maxInputBytes: 64 * 1024, maxOutputBytes: 64 * 1024, maxErrorBytes: 4 * 1024 });

/** Where the native solver is built: solver/target/release/kit-solver under the app's root. */
export const nativeSolverPath = (root) => path.join(root, 'solver', 'target', 'release', 'kit-solver');

function executable(file) {
  try { return statSync(file).isFile() && (accessSync(file, constants.X_OK), true); } catch { return false; }
}

const fail = (status, code, message) => new DomainError(status, code, message);
const FAILED = 'The kit comparison could not be completed this time. Nothing was changed; try again.';

/**
 * @param options.root the app's root; the native solver is looked for only at nativeSolverPath(root)
 * @param options.engine 'auto' (native when built, else reference), 'native' (required; throws now if it is missing) or
 *   'reference' (never runs a program)
 * @param options.program tests only: a fixed program to run instead of the built solver (still never from a request)
 */
export function createKitSolver({ root, engine = 'auto', program = null, timeoutMs = SOLVER_LIMITS.timeoutMs, maxConcurrent = SOLVER_LIMITS.maxConcurrent } = {}) {
  const file = program ?? nativeSolverPath(root);
  const native = engine !== 'reference' && executable(file);
  if (engine === 'native' && !native) throw new Error(`The native kit solver is required but ${file} is not built. Run: cd solver && cargo build --release --locked`);
  const cwd = path.dirname(file);
  let running = 0;
  const stats = { native: 0, reference: 0, refused: 0 };

  function runNative(request, signal) {
    if (running >= maxConcurrent) return Promise.reject(fail(503, 'kit_solver_busy', 'Several kit comparisons are running. Try again in a moment.'));
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > SOLVER_LIMITS.maxInputBytes) return Promise.reject(fail(400, 'kit_too_large', 'This kit is too large to compare.'));
    running += 1;
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(file, [], { cwd, env: {}, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch {
        reject(fail(502, 'kit_solver_failed', FAILED));
        return;
      }
      const out = [];
      let outBytes = 0, errBytes = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      };
      // Stopping settles at once: the answer never waits for a killed program's streams to drain.
      const stop = (error) => {
        if (settled) return;
        child.kill('SIGKILL');
        child.stdout.destroy(); child.stderr.destroy();
        finish(error);
      };
      const timer = setTimeout(() => stop(fail(504, 'kit_solver_timeout', 'The kit comparison took too long, so it was stopped. Nothing was changed.')), timeoutMs);
      const onAbort = () => stop(Object.assign(new Error('The comparison was cancelled.'), { name: 'AbortError' }));
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk) => { outBytes += chunk.length; if (outBytes > SOLVER_LIMITS.maxOutputBytes) stop(fail(502, 'kit_solver_failed', FAILED)); else out.push(chunk); });
      // Standard error is counted and discarded, never kept or logged; past its bound the program is stopped and its answer,
      // even a valid one written afterwards, is not used.
      child.stderr.on('data', (chunk) => { errBytes += chunk.length; if (errBytes > SOLVER_LIMITS.maxErrorBytes) stop(fail(502, 'kit_solver_failed', FAILED)); });
      child.stdin.on('error', () => {}); // a solver that exits early closes its input; its exit says what happened
      child.on('error', () => finish(fail(502, 'kit_solver_failed', FAILED)));
      child.on('close', (code) => {
        if (settled) return;
        let answer;
        try { answer = JSON.parse(Buffer.concat(out).toString('utf8')); } catch { return finish(fail(502, 'kit_solver_failed', FAILED)); }
        // Exit 2 is a refused request (its error is in the answer); anything else but 0 is a failure.
        if (code === 2 && answer?.error) return finish(null, answer);
        if (code !== 0) return finish(fail(502, 'kit_solver_failed', FAILED));
        finish(null, answer);
      });
      child.stdin.end(input);
    }).finally(() => { running -= 1; });
  }

  /** A checked answer to one request. Throws a DomainError for a refused, failed, timed-out or mismatched solve. */
  async function solve(request, { signal } = {}) {
    try {
      checkSolverRequest(request);
      const answer = native ? await runNative(request, signal) : referenceSolve(request);
      const checked = verifySolverAnswer(request, answer);
      stats[native ? 'native' : 'reference'] += 1;
      return checked;
    } catch (error) {
      if (error instanceof KitPlanError) {
        stats.refused += 1;
        // The server's own request check refused it (too many lines or options, or a malformed figure), or the solver's
        // answer did not check out (refused, mismatched or overflowing): either way no kit is shown from it.
        if (['invalid_request', 'too_large'].includes(error.code)) throw fail(400, 'kit_not_comparable', 'This kit cannot be compared as it is.');
        throw fail(502, 'kit_solver_failed', FAILED);
      }
      throw error;
    }
  }

  return { engine: native ? 'native' : 'reference', solve, stats, get running() { return running; } };
}
