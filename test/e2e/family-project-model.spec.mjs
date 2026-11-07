import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Exercise the actual campsite model and ambient tick with native Three Groups, without a software WebGL renderer.
// The no-op shared-part/model builders isolate positioning; this is not a rendered-world or performance test.
test('campfire smoke rises above its own fire and survives rebuilding at another stage', async ({ page, baseURL }) => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const imports = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  await page.route('**/__project_model_review__', route => route.fulfill({ contentType: 'text/html', body: `<script type="importmap">${imports}</script>` }));
  await page.goto(`${baseURL}/__project_model_review__`);
  const results = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createFamilyProject } = await import('/src/world/family-project.js');
    const models = new Proxy({ roles: { lamp: 0xffcc88 } }, { get: (obj, key) => obj[key] ?? (() => {}) });
    const colours = new Proxy({}, { get: () => 0x88aa77 });
    const project = createFamilyProject({ part: () => {}, models, colours });
    const samples = [];
    for (const index of [2, 3]) {
      project.reset();
      project.build(new THREE.Group(), { index, key: index === 2 ? 'furnished' : 'gathering', detail: true }, 0xaa6677);
      for (let t = 0; t <= 3; t += .125) { project.tick(t); samples.push(project.debug()); }
    }
    return samples;
  });
  expect(results.some(r => r.stage.index === 2)).toBe(true);
  expect(results.some(r => r.stage.index === 3)).toBe(true);
  for (const r of results) {
    expect(r.lit).toBe(true);
    expect(r.smokePositions).toHaveLength(3);
    for (const smoke of r.smokePositions) {
      expect(Math.abs(smoke[0] - r.firePosition[0])).toBeLessThan(1.35);
      expect(Math.abs(smoke[2] - r.firePosition[2])).toBeLessThan(1.35);
      expect(smoke[1]).toBeGreaterThan(r.firePosition[1]);
    }
  }
  expect(results[2].smokePositions).not.toEqual(results[3].smokePositions);
});

// Every place the family can choose builds every stage from the same footprint, with its own named parts; only the
// campsite has live parts, and rebuilding another place after it leaves none behind (no leaked flame or smoke).
test('campsite, garden and schoolhouse build every stage; live parts belong to the campfire alone', async ({ page, baseURL }) => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const imports = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  await page.route('**/__project_kinds_review__', route => route.fulfill({ contentType: 'text/html', body: `<script type="importmap">${imports}</script>` }));
  await page.goto(`${baseURL}/__project_kinds_review__`);
  const builds = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createFamilyProject } = await import('/src/world/family-project.js');
    const { projectStage } = await import('/src/core/family-project.js');
    const models = new Proxy({ roles: { lamp: 0xffcc88, glass: 0xffeecc } }, { get: (obj, key) => obj[key] ?? (() => {}) });
    const colours = new Proxy({}, { get: () => 0x88aa77 });
    let parts = 0, bad = 0;
    const project = createFamilyProject({ part: (...a) => { parts++; if (a.slice(2).some((v) => typeof v === 'number' && !Number.isFinite(v))) bad++; }, models, colours });
    const out = [];
    for (const kind of ['campsite', 'garden', 'schoolhouse', 'campsite', 'garden']) for (const cents of [0, 3000, 7500, 12000, 18000, 24000, 30000]) {
      parts = 0; bad = 0; project.reset();
      const group = new THREE.Group();
      project.build(group, projectStage(cents, 30000, kind), 0xaa6677);
      let live = 0; group.traverse((o) => { if (o.userData.live) live++; });
      const d = project.debug();
      out.push({ kind, cents, stage: d.stage, parts, bad, live, lit: d.lit, puffs: d.smokePositions.length });
    }
    return out;
  });
  for (const b of builds) {
    expect(b.bad, `${b.kind} at ${b.cents}`).toBe(0);
    expect(b.parts).toBeGreaterThan(30);
    expect(b.stage.kind).toBe(b.kind);
    const fire = b.kind === 'campsite' && b.stage.index >= 2;
    expect(b.lit).toBe(fire); expect(b.live).toBe(fire ? 4 : 0); expect(b.puffs).toBe(fire ? 3 : 0);
  }
  const features = (kind, cents) => builds.find((b) => b.kind === kind && b.cents === cents).stage.features;
  // The building under construction is the one finished later; the details follow the existing 10/40/80% steps.
  expect(features('garden', 7500)).toEqual(expect.arrayContaining(['greenhouse:frame', 'beds:edged']));
  expect(features('garden', 12000)).toEqual(expect.arrayContaining(['greenhouse:rafters', 'beds:seedlings']));
  expect(features('garden', 18000)).toEqual(expect.arrayContaining(['greenhouse:glazed', 'beds:planted', 'bird-bath']));
  expect(features('garden', 24000)).toContain('lanterns');
  expect(features('garden', 30000)).toEqual(expect.arrayContaining(['beds:bloom', 'rose-arch', 'fruit-trees']));
  expect(features('schoolhouse', 7500)).toEqual(expect.arrayContaining(['school:frame', 'bell:cradle']));
  expect(features('schoolhouse', 12000)).toEqual(expect.arrayContaining(['school:rafters', 'belfry:frame']));
  expect(features('schoolhouse', 18000)).toEqual(expect.arrayContaining(['school:built', 'belfry', 'bell:belfry', 'porch']));
  expect(features('schoolhouse', 30000)).toEqual(expect.arrayContaining(['swings', 'flag']));
  expect(features('garden', 0)).toContain('seed-sack'); expect(features('schoolhouse', 0)).toContain('slate-board');
  expect(features('campsite', 18000)).toEqual(['cabin', 'campfire']);
});
