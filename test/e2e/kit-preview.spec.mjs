import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { createKitSolver } from '../../server/kit/solver.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/kit-preview/', import.meta.url));
const clock = { now: () => new Date('2026-11-08T18:00:00Z'), iso() { return this.now().toISOString(); }, today: () => '2026-11-08' };
const state = (page) => page.evaluate(async () => (await fetch('/api/state')).json());
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const saved = (s) => [s.progress, s.ledger, s.contributions, s.goal, s.goalKit, s.plan, s.acceptedPlanId,
  s.kit, s.kitPlan.revision, s.kitPlan.selection, s.familyChoices.offers];
const cards = (page) => page.locator('#kit-plan-kits > li');
const preview = (page, i = 1) => cards(page).nth(i).getByRole('button', { name: /Preview on map|Shown on map/ }).click();
const shot = async (page, name, info) => {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: evidence + info.project.name + '-' + name + '.png' });
};
async function withDemo(browser, info, run) {
  const solver = createKitSolver({ root, engine: process.env.KIT_SOLVER_REQUIRED === '1' ? 'native' : 'auto' });
  const demo = await startDemo({ familyTrip: true, clock, kitSolver: solver });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const outside = [], errors = [], requests = [];
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === demo.url) return route.continue();
    outside.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (r) => { if (r.method() !== 'GET') requests.push(new URL(r.url()).pathname); });
  mkdirSync(evidence, { recursive: true });
  try {
    await page.goto(demo.url);
    // The realm starts on an emulated GPU: like the other first waits in this suite, readiness gets 30 seconds.
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Try a one-off expense' }).click();
    await page.getByLabel('One-off amount').fill('90');
    await page.getByRole('button', { name: 'Compare complete kits' }).click();
    await expect(cards(page)).toHaveCount(2);
    await run({ page, requests, demo });
    expect(errors).toEqual([]); expect(outside).toEqual([]);
    if (process.env.KIT_SOLVER_REQUIRED === '1') expect(solver.stats.native).toBeGreaterThan(0);
  } finally { await context.close(); await demo.close(); }
}

test('the real kit becomes a temporary map plan, repairs coherently and never credits or saves the proposal', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.setTimeout(180_000);
  await withDemo(browser, info, async ({ page, requests, demo }) => {
    await cards(page).nth(1).getByRole('button', { name: 'Choose this kit' }).click();
    await page.getByRole('button', { name: 'Keep stove as it is' }).click();
    await expect(cards(page).nth(1).getByRole('button', { name: 'Preview on map' })).toBeEnabled();
    const before = saved(await state(page)), world = await scene(page), calls = { ...demo.example.merchant.catalogue.calls };
    requests.length = 0;
    await preview(page);
    await expect(page.locator('#kit-preview-title')).toHaveText('Your chosen kit · $180.00');
    await expect(page.locator('#kit-preview-title')).toBeFocused();
    await expect(page.locator('#kit-preview')).toContainText('Plan preview · Not bought');
    expect((await scene(page)).kitPreview.items.map((i) => [i.look, i.count])).toEqual([
      ['tent-light', 1], ['bag-synthetic', 2], ['stove-camp', 1],
    ]);
    await shot(page, 'chosen', info);
    expect(requests).toEqual([]);

    await page.getByLabel('One-off amount').fill('120');
    await expect(page.locator('#kit-preview-title')).toHaveText('Proposal · smallest change · $150.00');
    await expect(page.locator('#kit-preview-changes')).toContainText('Your chosen kit ($180.00) is unchanged.');
    await expect(page.locator('#kit-preview-finish')).toHaveText('Finishes Dec 27 (week 7), on time for Dec 27.');
    const repair = (await scene(page)).kitPreview;
    expect(repair.items.map((i) => [i.look, i.count, i.kept, i.switched])).toEqual([
      ['tent-dome', 1, false, true], ['bag-synthetic', 2, false, false], ['stove-camp', 1, true, false],
    ]);
    // Opening then closing About must return to the automatically framed, grown caption.
    const automaticScale = (await scene(page)).view.worldPerPixel;
    await shot(page, 'repair', info);
    await page.locator('#kit-preview summary').click();
    const bounds = await page.evaluate(() => {
      const p = document.querySelector('#kit-preview').getBoundingClientRect(), b = document.querySelector('.board-shell').getBoundingClientRect();
      return { left: p.left - b.left, right: b.right - p.right, visibleMap: b.bottom - p.bottom, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeGreaterThanOrEqual(0);
    expect(bounds.visibleMap).toBeGreaterThan(180); expect(bounds.overflow).toBe(0);
    await shot(page, 'about', info);
    await page.locator('#kit-preview summary').click();
    await expect.poll(async () => (await scene(page)).view.worldPerPixel).toBeCloseTo(automaticScale, 8);

    await page.getByLabel('One-off amount').fill('200');
    await expect(page.locator('#kit-preview-title')).toHaveText('Your chosen kit · does not fit · $180.00');
    await expect(page.locator('#kit-preview-finish')).toContainText('$110.00 short');
    expect((await scene(page)).kitPreview.fits).toBe(false);
    await shot(page, 'chosen-late', info);
    await preview(page, 0);
    await expect(page.locator('#kit-preview-title')).toHaveText('Does not fit · closest complete kit · $150.00');
    await expect(page.locator('#kit-preview-finish')).toContainText('$80.00 short');
    await shot(page, 'closest', info);
    await page.locator('#kit-preview-close').click();
    await expect(cards(page).nth(0).getByRole('button', { name: 'Preview on map' })).toBeFocused();
    expect((await scene(page)).kitPreview).toMatchObject({ active: false, meshes: 0, instances: 0, objects: 0 });

    // Repeated open/close must remove every temporary object and retain the same renderer resources.
    const settled = await scene(page);
    for (let i = 0; i < 3; i++) {
      await preview(page, 0); await page.keyboard.press('Escape');
      await expect(page.locator('#kit-preview')).toBeHidden();
      const after = await scene(page);
      expect(after.kitPreview).toMatchObject({ active: false, meshes: 0, instances: 0, objects: 0 });
      expect([after.render.geometries, after.render.materials]).toEqual([settled.render.geometries, settled.render.materials]);
    }
    expect(saved(await state(page))).toEqual(before);
    const after = await scene(page);
    expect([after.project, after.districts, after.bridges]).toEqual([world.project, world.districts, world.bridges]);
    expect(requests.every((p) => p === '/api/kit/compare')).toBe(true);
    expect(demo.example.merchant.catalogue.calls).toEqual(calls);
  });
});

test('pending, late, failed and invalid comparisons cannot strand focus or revive a closed or another member’s preview', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.setTimeout(180_000);
  await withDemo(browser, info, async ({ page }) => {
    await preview(page);
    let entered, release;
    const waiting = new Promise((r) => { entered = r; }), held = new Promise((r) => { release = r; });
    await page.route('**/api/kit/compare', async (route) => {
      if (route.request().postDataJSON().reserveCents !== 9500) return route.continue();
      entered(); await held; await route.continue();
    });
    await page.getByLabel('One-off amount').fill('95'); await waiting;
    await expect(page.locator('#kit-preview')).toHaveAttribute('aria-busy', 'true');
    await page.locator('#kit-preview-close').click();
    await expect(page.locator('#kit-plan-compare')).toBeFocused(); // old preview button is disabled while stale
    await expect(page.locator('#kit-preview')).toBeHidden();
    await page.getByLabel('One-off amount').fill('120');
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('#kit-plan-note')).toContainText('$120.00');
    const late = page.waitForResponse((r) => r.url().endsWith('/api/kit/compare') && r.request().postDataJSON().reserveCents === 9500);
    release(); await late;
    await expect(page.locator('#kit-plan-note')).toContainText('$120.00');
    await expect(page.locator('#kit-preview')).toBeHidden();
    await page.unroute('**/api/kit/compare');

    await preview(page, 0);
    await page.getByLabel('One-off amount').fill('-1');
    await expect(page.locator('#kit-preview')).toBeHidden();
    expect((await scene(page)).kitPreview.active).toBe(false);
    await page.getByLabel('One-off amount').fill('90');
    await expect(cards(page)).toHaveCount(2); await preview(page);
    let fail, requested;
    const failHeld = new Promise((r) => { fail = r; }), failWaiting = new Promise((r) => { requested = r; });
    await page.route('**/api/kit/compare', async (r) => {
      requested(); await failHeld;
      await r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Comparison unavailable in this test.' } }) });
    });
    await page.getByLabel('One-off amount').fill('100'); await failWaiting;
    await page.locator('#kit-preview summary').focus(); fail();
    await expect(page.locator('#kit-preview')).toBeHidden();
    await expect(page.locator('#kit-plan-status')).toContainText('Comparison unavailable');
    await expect(page.locator('#kit-plan-compare')).toBeFocused();
    await page.unroute('**/api/kit/compare');
    await page.getByLabel('One-off amount').fill('90');
    await expect(page.locator('#kit-plan-note')).not.toContainText('Compare again.');
    await preview(page);
    await page.locator('#persona').selectOption({ label: 'Wren · Child' });
    await expect(page.locator('#kit-preview')).toBeHidden();
    await expect(page.getByRole('button', { name: /Preview on map|Shown on map/ })).toHaveCount(0);
    expect((await scene(page)).kitPreview).toMatchObject({ active: false, meshes: 0, objects: 0 });
  });
});

test('the temporary scene stays separate at every project stage and removes packed-item markers on replacement', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.setTimeout(180_000);
  await withDemo(browser, info, async ({ page, requests }) => {
    // Visual-only fixture: no progress or household API mutation.
    await page.route('**/__kit_stage', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{margin:0}#stage{width:100vw;height:100vh}</style><script type="importmap">{"imports":{"three":"/vendor/three/three.module.js"}}</script><div id="stage"></div><script type="module">import{createBoardScene}from"/src/world/board-scene.js";import{projectStage}from"/src/core/family-project.js";import{previewScene}from"/src/core/kit-preview.js";window.stage=projectStage;window.picture=previewScene;window.world=createBoardScene(document.querySelector("#stage"),{reducedMotion:true});await window.world.update({builtTier:0,position:0,project:projectStage(6000,30000)},{animate:false});window.fixtureReady=true;</script></html>' }));
    await page.goto(new URL('/__kit_stage', page.url()).href);
    await page.waitForFunction(() => window.fixtureReady);
    requests.length = 0;
    const results = [];
    for (const kind of ['campsite', 'garden', 'schoolhouse']) {
      for (const progress of [6000, 12000, 24000, 30000]) {
        const result = await page.evaluate(async ({ kind, progress }) => {
          await window.world.update({ project: window.stage(progress, 30000, kind) }, { animate: false });
          const before = window.world.debug();
          const example = window.picture({ fits: true, lines: [
            { lineId: 'tent', title: 'Sample: Dome tent, four-person', bought: 1, merchant: 'one', switched: true },
            { lineId: 'bags', title: 'Sample: Sleeping bag, synthetic', bought: 2, merchant: 'two' },
            { lineId: 'stove', title: 'Sample: Camp stove', bought: 1, merchant: 'one', kept: true },
          ] }, { sample: true });
          window.world.setKitPreview(example); window.world.focusLegend('family-project');
          const shown = window.world.debug();
          return { projectBefore: before.project, projectAfter: shown.project, before: [before.tier, before.position, before.districts, before.bridges], after: [shown.tier, shown.position, shown.districts, shown.bridges], active: shown.kitPreview.active };
        }, { kind, progress });
        expect(result.projectAfter).toEqual(result.projectBefore); expect(result.after).toEqual(result.before);
        expect(result.active).toBe(true); results.push(result);
        if (progress === 30000) await shot(page, 'beside-' + kind, info);
        const cleared = await page.evaluate(() => {
          // Real/non-sample titles never acquire the authored example's product shapes.
          window.world.setKitPreview(window.picture({ fits: false, lines: [
            { lineId: 'pack', title: 'Sample: Dome tent, four-person', bought: 12, merchant: 'one', kept: true },
          ] }));
          const packed = window.world.debug().kitPreview;
          window.world.setKitPreview(null);
          return { packed, clear: window.world.debug().kitPreview };
        });
        expect(cleared.packed.items).toEqual([{ look: 'crate', count: 12, shown: 6, shop: 0, kept: true, switched: false }]);
        expect(cleared.clear).toMatchObject({ active: false, meshes: 0, instances: 0, objects: 0 });
      }
    }
    expect(results).toHaveLength(12); expect(requests).toEqual([]);
    await page.evaluate(() => window.world.dispose());
  });
});
