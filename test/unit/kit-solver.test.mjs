// The complete-kit solver: the JavaScript reference (src/core/kit-plan.js), the compiled Rust solver (solver/) and the
// server's bridge to it (server/kit/solver.mjs). Invented whole-cent figures only; nothing here is a price or a family.
// - The reference reproduces the task's literal examples: the eight-combination camping kit, the retailer-set trap and
//   the $160 -> $140 smallest change.
// - The compiled Rust solver agrees with the reference on seeded random kits. Set KIT_SOLVER_REQUIRED=1 (CI does) to fail,
//   rather than skip, when the Rust build is missing.
// - The bridge refuses whatever does not check out, and runs the program with no shell, no environment and bounded I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KitPlanError, checkSolverRequest, evaluateKit, referenceSolve, verifySolverAnswer } from '../../src/core/kit-plan.js';
import { createKitSolver, nativeSolverPath } from '../../server/kit/solver.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const required = process.env.KIT_SOLVER_REQUIRED === '1';
const nativeBuilt = existsSync(nativeSolverPath(root));
if (required && !nativeBuilt) throw new Error(`KIT_SOLVER_REQUIRED=1 but ${nativeSolverPath(root)} is not built: cd solver && cargo build --release --locked`);

const opt = (listingCents, grams, retailer, perListing = 1) => ({ listingCents, perListing, weightMg: grams === null ? null : grams * 1000, retailer });
const line = (need, options, current = null, pinned = false) => ({ need, options, current, pinned });
// kit-planning-acceptance-20261109.json: tent 1, sleeping bags 2, stove 1 still to get (the torches are owned).
const acceptance = (ceilingCents) => ({ version: 1, ceilingCents, sampleSize: 8, lines: [
  line(1, [opt(8000, 3000, 0), opt(11000, 1800, 1)]), line(2, [opt(2000, 800, 0), opt(3000, 500, 1)]), line(1, [opt(3000, 600, 0), opt(3500, 300, 1)])] });

test('the reference reproduces the literal eight-combination camping example', () => {
  const a = verifySolverAnswer(acceptance(18_000), referenceSolve(acceptance(18_000)));
  assert.equal(a.combinations, 8);
  assert.equal(a.feasible, 5);
  assert.deepEqual([a.lowestTotal.choice, a.lowestTotal.totalCents, a.lowestTotal.weightMg, a.lowestTotal.retailers], [[0, 0, 0], 15_000, 5_200_000, 1]);
  assert.deepEqual([a.lowerWeight.choice, a.lowerWeight.totalCents, a.lowerWeight.weightMg], [[1, 0, 0], 18_000, 4_000_000]);
  assert.deepEqual(a.fewestRetailers.choice, [0, 0, 0], 'the one-retailer winner is the lowest-total kit again');
  const literal = [[[0, 0, 0], 15_000, 5200, 1, true], [[0, 0, 1], 15_500, 4900, 2, true], [[0, 1, 0], 17_000, 4600, 2, true], [[0, 1, 1], 17_500, 4300, 2, true],
    [[1, 0, 0], 18_000, 4000, 2, true], [[1, 0, 1], 18_500, 3700, 2, false], [[1, 1, 0], 20_000, 3400, 2, false], [[1, 1, 1], 20_500, 3100, 1, false]];
  for (const [choice, total, grams, retailers, fits] of literal) {
    const k = evaluateKit(acceptance(18_000), choice);
    assert.deepEqual([k.totalCents, k.weightMg, k.retailers, k.fits], [total, grams * 1000, retailers, fits], JSON.stringify(choice));
  }
  const tight = referenceSolve(acceptance(15_000));
  assert.deepEqual([tight.feasible, tight.lowestTotal.choice], [1, [0, 0, 0]]);
});

test('the reference tracks actual retailer sets (the literal pruning trap)', () => {
  const request = { version: 1, ceilingCents: 10_000, sampleSize: 0, lines: [line(1, [opt(8000, 1000, 0), opt(8000, 1000, 1)]), line(1, [opt(2000, 500, 1)])] };
  const a = referenceSolve(request);
  assert.deepEqual([a.fewestRetailers.choice, a.fewestRetailers.retailers], [[1, 0], 1]);
});

test('the reference repairs the $160 kit for $140 by switching one line while the tent is kept', () => {
  const request = { version: 1, ceilingCents: 14_000, sampleSize: 0, lines: [
    line(1, [opt(9000, null, 0), opt(7000, null, 1)], 0, true), line(2, [opt(2000, null, 0), opt(1000, null, 2)], 0), line(1, [opt(3000, null, 0), opt(2000, null, 1)], 0)] };
  const a = verifySolverAnswer(request, referenceSolve(request));
  assert.deepEqual([a.current.totalCents, a.current.fits], [16_000, false]);
  assert.deepEqual([a.smallestChange.choice, a.smallestChange.totalCents, a.smallestChange.changes], [[0, 1, 0], 14_000, 1]);
  assert.deepEqual([a.lowestTotal.choice, a.lowestTotal.totalCents, a.lowestTotal.changes], [[0, 1, 1], 13_000, 2]);
  assert.equal(a.combinations, 4, 'the cheaper $70 tent is never tried while the $90 tent is kept');
});

test('packs are bought whole, and an unknown weight is never compared as zero', () => {
  const pack = { version: 1, ceilingCents: 10_000, sampleSize: 0, lines: [line(3, [opt(1500, 250, 0, 2)])] };
  assert.deepEqual([referenceSolve(pack).cheapest.totalCents, referenceSolve(pack).cheapest.weightMg], [3000, 500_000]);
  const partly = acceptance(18_000);
  partly.lines[2].options[1].weightMg = null;
  const a = referenceSolve(partly);
  assert.deepEqual([a.weightComparable, a.lowerWeight], [false, null]);
});

test('the request check matches the Rust bounds', () => {
  assert.doesNotThrow(() => checkSolverRequest(acceptance(18_000)));
  const bad = (edit, code = 'invalid_request') => { const r = structuredClone(acceptance(18_000)); edit(r); assert.throws(() => checkSolverRequest(r), (e) => e instanceof KitPlanError && e.code === code); };
  bad((r) => { r.version = 2; });
  bad((r) => { r.ceilingCents = 1.5; });
  bad((r) => { r.lines[0].need = 0; });
  bad((r) => { r.lines[0].options[0].perListing = 0; });
  bad((r) => { r.lines[0].options[0].priceText = '$80'; });
  bad((r) => { r.lines[0].current = 5; });
  bad((r) => { r.lines[0].pinned = true; });
  bad((r) => { r.lines = Array(9).fill(r.lines[0]); }, 'too_large');
  bad((r) => { r.lines[0].options = Array(4).fill(r.lines[0].options[0]); }, 'too_large');
});

test('an answer that does not check out is refused as a whole', () => {
  const request = acceptance(18_000);
  const good = referenceSolve(request);
  const refused = (edit) => { const a = structuredClone(good); edit(a); assert.throws(() => verifySolverAnswer(request, a), (e) => e.code === 'solver_mismatch' || e.code === 'solver_refused'); };
  refused((a) => { a.lowestTotal.totalCents -= 1; });
  refused((a) => { a.lowestTotal.choice = [0, 0, 2]; }); // a listing the line does not have
  refused((a) => { a.lowestTotal.choice = [1, 1, 1]; a.lowestTotal.totalCents = 20_500; a.lowestTotal.weightMg = 3_100_000; a.lowestTotal.retailers = 1; }); // does not fit
  refused((a) => { a.sample.reverse(); });
  refused((a) => { a.sample.pop(); });
  refused((a) => { a.combinations = 9; });
  refused((a) => { a.weightComparable = false; });
  refused((a) => { a.lowerWeight = null; });
  refused((a) => { a.extra = true; });
  refused((a) => { Object.assign(a, { error: { code: 'invalid_request' } }); });
  const kept = { version: 1, ceilingCents: 20_000, sampleSize: 0, lines: [line(1, [opt(9000, null, 0), opt(7000, null, 1)], 0, true), line(1, [opt(2000, null, 0)], 0)] };
  const k = referenceSolve(kept);
  k.smallestChange = { ...evaluateKit({ ...kept, lines: kept.lines.map((l) => ({ ...l, pinned: false })) }, [1, 0]) };
  assert.throws(() => verifySolverAnswer(kept, k), (e) => e.code === 'solver_mismatch', 'a kept line cannot be switched');
});

// A small deterministic generator: kits with ties, unknown weights, packs, kept lines and every ceiling outcome.
function random(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int };
}
function randomRequest(seed) {
  const r = random(seed);
  const lines = Array.from({ length: r.int(1, 8) }, () => {
    const options = Array.from({ length: r.int(1, 3) }, () => ({ listingCents: r.int(1, 8) * 500 * (r.next() < 0.2 ? 10 : 1), perListing: r.int(1, 3),
      weightMg: r.next() < 0.15 ? null : r.int(1, 6) * 100_000, retailer: r.int(0, 3) }));
    const current = r.next() < 0.6 ? r.int(0, options.length - 1) : null;
    return { need: r.int(1, 4), options, current, pinned: current !== null && r.next() < 0.25 };
  });
  const all = lines.every((l) => l.current !== null);
  if (!all && r.next() < 0.5) for (const l of lines) if (l.current === null) l.current = 0; // half the time, a complete current selection
  const typical = lines.reduce((sum, l) => sum + Math.ceil(l.need / l.options[0].perListing) * l.options[0].listingCents, 0);
  return { version: 1, ceilingCents: Math.min(10_000_000, Math.max(0, Math.round(typical * (0.6 + r.next() * 0.8)))), sampleSize: r.int(0, 8), lines };
}

test('the compiled Rust solver agrees with the reference on seeded random kits', { skip: !nativeBuilt && 'the Rust solver is not built (set KIT_SOLVER_REQUIRED=1 to fail instead)' }, async () => {
  const native = createKitSolver({ root, engine: 'native' });
  assert.equal(native.engine, 'native');
  const cases = [acceptance(18_000), acceptance(15_000), acceptance(10_000), ...Array.from({ length: 400 }, (_, i) => randomRequest(20261109 + i))];
  let combinations = 0;
  for (const [i, request] of cases.entries()) {
    const fromRust = await native.solve(request);
    const fromReference = verifySolverAnswer(request, referenceSolve(request));
    assert.deepEqual(fromRust, fromReference, `case ${i} (seed ${20261109 + i - 3})`);
    combinations += fromRust.combinations;
  }
  assert.equal(native.stats.native, cases.length);
  assert.ok(combinations > 10_000, `${combinations} complete kits compared`);
});

// ---- The bridge, with stand-in programs written for this test (never a path from a request) ----
const dir = mkdtempSync(path.join(tmpdir(), 'kit-solver-fixtures-'));
function program(name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const answerText = (request) => JSON.stringify(referenceSolve(request));

test('the bridge runs the program with no shell, no environment and a fixed folder, and checks its answer', async () => {
  const request = acceptance(18_000);
  const seen = path.join(dir, 'seen');
  const file = program('records', `/usr/bin/env > '${seen}.env'\npwd > '${seen}.cwd'\n/bin/cat > '${seen}.in'\nprintf '%s' '${answerText(request)}'`);
  const solver = createKitSolver({ root, engine: 'native', program: file });
  const answer = await solver.solve(request);
  assert.deepEqual(answer.lowestTotal.choice, [0, 0, 0]);
  const env = readFileSync(`${seen}.env`, 'utf8').split('\n').filter((l) => l && !/^(PWD|SHLVL|_|OLDPWD)=/.test(l)); // set by /bin/sh itself
  assert.deepEqual(env, [], 'nothing from the server’s environment reaches the solver');
  assert.equal(realpathSync(readFileSync(`${seen}.cwd`, 'utf8').trim()), realpathSync(path.dirname(file)), 'the solver’s own folder, not the server’s');
  assert.deepEqual(JSON.parse(readFileSync(`${seen}.in`, 'utf8')), request, 'exactly the request, on standard input');
});

test('the bridge refuses timeouts, crashes, malformed, oversized, refused and wrong answers', async () => {
  const request = acceptance(18_000);
  const lying = JSON.parse(answerText(request));
  lying.lowestTotal.totalCents = 14_000;
  const cases = [
    ['slow', 'exec /bin/sleep 5', 'kit_solver_timeout'],
    ['crash', 'exit 9', 'kit_solver_failed'],
    ['garbage', "printf 'not json'", 'kit_solver_failed'],
    ['flood', "/usr/bin/yes '{}' | /usr/bin/head -c 200000", 'kit_solver_failed'],
    ['refuses', `printf '%s' '{"version":1,"error":{"code":"invalid_request","message":"no"}}'; exit 2`, 'kit_solver_failed'],
    ['lies', `printf '%s' '${JSON.stringify(lying)}'`, 'kit_solver_failed'],
  ];
  for (const [name, body, code] of cases) {
    const solver = createKitSolver({ root, engine: 'native', program: program(name, body), timeoutMs: 400 });
    await assert.rejects(solver.solve(request), (e) => e.code === code, name);
    assert.equal(solver.running, 0, `${name}: no solver left running`);
  }
});

test('the bridge limits how many run at once, can be cancelled, and refuses an oversized kit before running anything', async () => {
  const request = acceptance(18_000);
  const solver = createKitSolver({ root, engine: 'native', program: program('waits', `/bin/sleep 0.3\nprintf '%s' '${answerText(request)}'`), maxConcurrent: 2 });
  const first = [solver.solve(request), solver.solve(request)];
  await assert.rejects(solver.solve(request), (e) => e.code === 'kit_solver_busy');
  assert.equal((await Promise.all(first)).length, 2);
  const controller = new AbortController();
  const pending = solver.solve(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.name === 'AbortError');
  const huge = { ...request, lines: Array(9).fill(request.lines[0]) };
  await assert.rejects(solver.solve(huge), (e) => e.code === 'kit_not_comparable');
  assert.throws(() => createKitSolver({ root, engine: 'native', program: path.join(dir, 'missing') }), /not built/);
  assert.equal(createKitSolver({ root, engine: 'reference' }).engine, 'reference');
});
