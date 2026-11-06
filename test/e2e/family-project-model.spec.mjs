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
