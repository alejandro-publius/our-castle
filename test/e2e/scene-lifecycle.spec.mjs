import { test, expect } from '@playwright/test';

// The board scene's lifecycle through its public API, on a standalone render fixture: art states only, never ledger,
// payment or household writes. Playwright's clock drives performance.now, the ambient interval and animation frames,
// so every count is exact. The page counts GL draw and allocation calls, host view callbacks and scene events.
const FIXTURE = `<!doctype html><html><meta charset="utf-8"><title>Scene lifecycle fixture</title><link rel="icon" href="data:,">
<style>body{margin:0}#stage{width:800px;height:600px}</style>
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script>
<div id="stage"></div>
<script type="module">
import { createBoardScene } from "/src/world/board-scene.js";
import { courtResidents, courtWorldPose } from "/src/core/court.js";
window.make = (options = {}) => {
  const log = { views: 0, events: [], draws: 0, allocations: 0 };
  const stage = document.querySelector("#stage");
  const scene = createBoardScene(stage, { reducedMotion: false, ...options, onEvent: (type) => log.events.push(type), onViewChange: () => { log.views++; } });
  const gl = stage.lastElementChild.getContext("webgl2");
  const count = (names, key) => { for (const name of names) { const f = gl[name]; gl[name] = function (...args) { log[key]++; return f.apply(this, args); }; } };
  count(["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"], "draws");
  count(["createBuffer", "createTexture", "createProgram", "createFramebuffer", "createVertexArray"], "allocations");
  return { scene, log };
};
window.counts = ({ log }) => ({ views: log.views, events: log.events.length, draws: log.draws, allocations: log.allocations });
// The ambient clock the court guests were last posed at, recovered from their poses in 1/128 s steps.
window.courtClock = (debug) => {
  const people = courtResidents(debug.tier), guests = new Map(debug.court.guests.map((g) => [g.id, g]));
  let best = { seconds: NaN, residual: Infinity };
  for (let k = 0; k <= 60 * 128; k++) {
    let residual = 0;
    for (const person of people) { const g = guests.get(person.id), q = courtWorldPose(person, k / 128); residual += Math.abs(q.x - g.x) + Math.abs(q.z - g.z); if (residual >= best.residual) break; }
    if (residual < best.residual) best = { seconds: k / 128, residual };
  }
  return best;
};
window.fixtureReady = true;
</script></html>`;

const problems = new WeakMap();
test.beforeEach(async ({ page, baseURL }, info) => {
  test.skip(info.project.name === 'phone', 'The scene lifecycle does not depend on the viewport; checked on desktop.');
  const issues = []; problems.set(page, issues);
  page.on('pageerror', (e) => issues.push(e.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.pathname === '/__scene_lifecycle') return route.fulfill({ contentType: 'text/html', body: FIXTURE });
    if (r.method() !== 'GET' || url.origin !== new URL(baseURL).origin) { issues.push(`${r.method()} ${r.url()}`); return route.abort(); }
    return route.continue();
  });
  await page.clock.install();
  await page.goto('/__scene_lifecycle');
  await page.waitForFunction(() => window.fixtureReady);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
});
test.afterEach(({ page }) => expect(problems.get(page) ?? []).toEqual([]));

test('disposing during an animated unlock stops its frames, callbacks and events at once, and updates still resolve', async ({ page }) => {
  await page.evaluate(async () => {
    window.s = window.make();
    await window.s.scene.update({ builtTier: 0, position: 4 }, { animate: false });
    window.settled = [];
    window.s.scene.update({ builtTier: 1, position: 5 }, { animate: true }).then(() => window.settled.push('unlock'));
  });
  await page.clock.runFor(300); // the first bridge is lowering
  const at = await page.evaluate(() => {
    const { animating } = window.s.scene.debug();
    window.s.scene.dispose();
    window.at = window.counts(window.s);
    // An update for a scene that is already gone.
    window.s.scene.update({ position: 9 }, { animate: true }).then(() => window.settled.push('later'));
    return { animating, events: [...window.s.log.events] };
  });
  expect(at).toEqual({ animating: true, events: ['bridge:start'] });
  // Long enough for the rest of the unlock (crossing, walk, rise and coins) and the later walk to have run.
  await page.clock.runFor(8000);
  const after = await page.evaluate(() => {
    const now = window.counts(window.s), { animating, ambient } = window.s.scene.debug();
    return { added: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v - window.at[k]])), settled: window.settled, animating, ambient };
  });
  expect(after).toEqual({ added: { views: 0, events: 0, draws: 0, allocations: 0 }, settled: ['unlock', 'later'], animating: false, ambient: false });
});

test('a hidden page and a covering card both resume ambient life where it paused', async ({ page }) => {
  await page.evaluate(async () => {
    window.covered = false;
    window.s = window.make({ isOccluded: () => window.covered });
    await window.s.scene.update({ builtTier: 3, estateLevel: 3, position: 20 }, { animate: false }); // twenty court guests
  });
  const clock = async () => {
    const { seconds, residual } = await page.evaluate(() => window.courtClock(window.s.scene.debug()));
    expect(residual).toBeLessThan(1e-6);
    return seconds;
  };
  await page.clock.runFor(2000);
  expect(await clock()).toBe(2);
  // Ten seconds in a hidden tab, then a quarter second (two ambient ticks) visible again.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(10_000);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(250);
  expect(await clock()).toBe(2.25);
  // The same behind a card (an open dialog), which already kept its phase.
  await page.evaluate(() => { window.covered = true; });
  await page.clock.runFor(10_000);
  await page.evaluate(() => { window.covered = false; });
  await page.clock.runFor(250);
  expect(await clock()).toBe(2.5);
});

test('unchanged scene inputs reuse the rendered realm without GL work', { tag: ['@state-reuse', '@release'] }, async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.s = window.make({ reducedMotion: true });
    const input = {
      builtTier: 0, position: 4, crest: { field: 'cobalt', charge: 'stag' },
      gardens: 0, estateLevel: 0, previewFeature: null, playMode: 'family',
      members: [{ id: 'example-adult', role: 'adult', avatarId: 'ranger' }],
      milestoneSpaces: [5, 12, 20],
      project: { index: 0, key: 'planned', detail: 'A shared campsite', kind: 'campsite' },
    };
    await window.s.scene.update(input, { animate: false });
    window.s.scene.explore(true);
    const before = window.counts(window.s), view = window.s.scene.debug().view;
    for (const animate of [false, true, false]) {
      await window.s.scene.update(structuredClone(input), { animate });
    }
    const after = window.counts(window.s), debug = window.s.scene.debug();
    const added = Object.fromEntries(Object.keys(before).map((k) => [k, after[k] - before[k]]));
    window.s.scene.dispose();
    return { added, viewBefore: view, viewAfter: debug.view, position: debug.shownPosition, animating: debug.animating };
  });
  expect(result.added).toEqual({ views: 0, events: 0, draws: 0, allocations: 0 });
  expect(result.viewAfter).toEqual(result.viewBefore);
  expect(result.position).toBe(4);
  expect(result.animating).toBe(false);
});

test('an unchanged update queued behind a walk waits for that walk without repeating its render', { tag: ['@state-reuse', '@release'] }, async ({ page }) => {
  await page.evaluate(async () => {
    window.s = window.make();
    await window.s.scene.update({ position: 0 }, { animate: false });
    window.finished = [];
    window.s.scene.update({ position: 1 }, { animate: true }).then(() => {
      window.finished.push('walk');
      window.afterWalk = window.counts(window.s);
    });
    window.s.scene.update({ position: 1 }, { animate: true }).then(() => {
      window.finished.push('repeat');
      const now = window.counts(window.s);
      window.repeatWork = Object.fromEntries(Object.keys(now).map((k) => [k, now[k] - window.afterWalk[k]]));
    });
  });
  await page.clock.runFor(700);
  const result = await page.evaluate(() => {
    const debug = window.s.scene.debug();
    const result = { finished: window.finished, position: debug.shownPosition, animating: debug.animating,
      events: window.s.log.events, repeatWork: window.repeatWork };
    window.s.scene.dispose();
    return result;
  });
  expect(result.finished).toEqual(['walk', 'repeat']);
  expect(result.position).toBe(1);
  expect(result.animating).toBe(false);
  expect(result.events).toEqual(['hop']);
  expect(result.repeatWork).toEqual({ views: 0, events: 0, draws: 0, allocations: 0 });
});
