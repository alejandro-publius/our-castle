// Captures of the Snow sleigh over Rosewind Palace by day and at night, for the README and the art direction page.
// A disposable in-memory example on an unused loopback port; requests leaving the page's origin are refused.
// Reduced motion keeps the sleigh at the start of its flight, so both captures frame the same moment.
// Run from the repository root: node docs/screenshots/winter-sleigh-capture.mjs
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from '../../test/e2e/support/deeds.mjs';
import { openMenu, closeMenu, chooseDistrict } from '../../test/e2e/support/game-controls.mjs';

const dir = fileURLToPath(new URL('./', import.meta.url));
const demo = await startDemo({ familyTrip: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  const outside = [], errors = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== demo.url) { outside.push(url.href); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await closeDeedsWhenTheyAppear(page);
  await page.goto(demo.url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  if (await page.locator('#journey').isVisible()) await page.locator('#journal-toggle').click();
  await openMenu(page, 'world-settings');
  await page.selectOption('#weather-mode', 'snow');
  await closeMenu(page, 'world-settings');
  await chooseDistrict(page, 'palace');
  await closeMenu(page, 'district-menu');
  for (const [period, name] of [['day', 'winter-sleigh.png'], ['night', 'winter-sleigh-night.png']]) {
    await openMenu(page, 'world-settings');
    await page.selectOption('#time-mode', period);
    await closeMenu(page, 'world-settings');
    await page.waitForTimeout(1500); // let the still scene finish drawing
    // Only the map: every element that neither is the canvas nor contains it is hidden for the capture.
    const hide = await page.addStyleTag({ content: 'body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; }' });
    await page.locator('canvas').first().screenshot({ path: `${dir}${name}` });
    await hide.evaluate((style) => style.remove());
  }
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
  console.log(JSON.stringify({ snow: await page.evaluate(() => window.__ourCastle.scene().atmosphere.snow), pageErrors: errors.length, requestsLeavingTheOrigin: outside.length }));
} finally { await browser.close(); await demo.close(); }
