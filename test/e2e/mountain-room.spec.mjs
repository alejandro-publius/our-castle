import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';

// The expanded scenery runs against Playwright's separate, keyless example database.
test.use({ reducedMotion: 'reduce' });
test('complete mountain slopes fit the wider realm while close views, clouds and weather remain usable', async ({ page, request }, info) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBe(true);
  const errors = [], writes = [], outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = new URL(info.project.use.baseURL ?? 'http://localhost:3111').origin;
  await page.route('**/*', (route) => {
    const r = route.request();
    if (new URL(r.url()).origin !== origin) { outside.push(r.url()); return route.abort(); }
    if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    return route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const before = await (await request.get('/api/state')).json();
  const scene = () => page.evaluate(() => window.__ourCastle.scene());
  const initial = await scene();
  expect(initial.region).toEqual({ width: 420, depth: 324, centerX: 32, centerZ: 0 });
  expect(initial.view.focus).toBe('cottage');
  if (await page.locator('#journey').isVisible()) await page.locator('#journal-toggle').click();
  await openMenu(page, 'world-settings');
  await page.selectOption('#time-mode', 'day');
  await page.selectOption('#weather-mode', 'clear');
  await closeMenu(page, 'world-settings');
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  const dir = `test-results/mountain-room/evidence`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${info.project.name}-day.png` });
  await clickView(page, 'Turn the estate right');
  await page.screenshot({ path: `${dir}/${info.project.name}-turned.png` });
  await chooseDistrict(page, 'cottage');
  expect((await scene()).view.focus).toBe('cottage');
  await page.screenshot({ path: `${dir}/${info.project.name}-home.png` });
  await openMenu(page, 'world-settings');
  await page.selectOption('#time-mode', 'night');
  await page.selectOption('#weather-mode', 'rain');
  await closeMenu(page, 'world-settings');
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  await page.screenshot({ path: `${dir}/${info.project.name}-night.png` });
  const final = await scene();
  expect(final.districts.map((d) => [d.id, d.open])).toEqual(initial.districts.map((d) => [d.id, d.open]));
  expect(final.bridges.map((b) => [b.id, b.open, b.raised])).toEqual(initial.bridges.map((b) => [b.id, b.open, b.raised]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await (await request.get('/api/state')).json()).toEqual(before);
  expect(writes).toEqual([]); expect(outside).toEqual([]); expect(errors).toEqual([]);
});
