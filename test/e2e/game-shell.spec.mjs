import { test, expect } from '@playwright/test';
import { openMenu } from './support/game-controls.mjs';

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});
const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
const observe = (page) => {
  const writes = [], errors = [];
  page.on('request', (r) => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return { writes, errors };
};

test('one general notice and closed utilities leave the world and four actions reachable', async ({ page }) => {
  const seen = observe(page);
  await ready(page);
  await expect(page.locator('.game-notice')).toHaveCount(1);
  await expect(page.locator('#honesty')).toContainText('Demo mode · simulated payments.');
  await expect(page.locator('#honesty')).toContainText('not a bank balance');
  await expect(page.locator('.hud-menu[open]')).toHaveCount(0);
  await expect(page.locator('#time-mode')).toBeHidden();
  await expect(page.locator('#realm-districts')).toBeHidden();
  await expect(page.getByRole('tab')).toHaveCount(4);
  const world = await page.locator('#world').boundingBox();
  expect(world.y).toBeLessThan(page.viewportSize().height * .3);
  expect(world.height).toBeGreaterThan(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.__ourCastle.scene().districts.length)).toBe(9);
  expect(seen).toEqual({ writes: [], errors: [] });
});

test('closing and reopening the journal keeps the contribution draft and returns focus; the preference survives refresh', async ({ page }) => {
  const seen = observe(page);
  await ready(page);
  await page.getByRole('tab', { name: 'Contribute', exact: true }).click();
  await page.locator('#give-amount').fill('7.25');
  await page.keyboard.press('Escape');
  await expect(page.locator('#journey')).toBeHidden();
  await expect(page.locator('#journal-toggle')).toBeFocused();
  await expect(page.locator('#journal-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#journal-toggle').click();
  await expect(page.locator('#tab-give')).toBeFocused();
  await expect(page.locator('#give-amount')).toHaveValue('7.25');
  await page.locator('#close-journal').click();
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(page.locator('#journey')).toBeHidden();
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#journey')).toBeVisible();
  await expect(page.locator('#journey')).toBeFocused();
  // Ledger uses a wider page; closing it must also return that space to the realm.
  await page.getByRole('tab', { name: 'Ledger', exact: true }).click();
  await page.locator('#close-journal').click();
  const frame = await page.locator('.layout').boundingBox();
  expect((await page.locator('#world').boundingBox()).width).toBeGreaterThanOrEqual(frame.width - 1);
  expect(seen).toEqual({ writes: [], errors: [] });
});

test('settings and district menus support Escape and visible focus without changing access or records', async ({ page }) => {
  const seen = observe(page);
  await ready(page);
  const before = await page.evaluate(() => window.__ourCastle.state);
  await openMenu(page, 'world-settings');
  await page.locator('#time-mode').selectOption('night');
  await page.locator('#weather-mode').selectOption('rain');
  await page.keyboard.press('Escape');
  await expect(page.locator('#world-settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('#world-settings > summary')).toBeFocused();
  await openMenu(page, 'district-menu');
  const castle = page.locator('#realm-districts [data-district="castle"]');
  await castle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#district-menu')).not.toHaveAttribute('open', '');
  await expect(page.locator('#district-menu > summary')).toBeFocused();
  await expect(page.locator('#realm-focus-status')).toHaveText('Royal Citadel · $240.00 to unlock');
  await expect(page.locator('#view-deed')).toBeHidden();
  const after = await page.evaluate(() => ({ state: window.__ourCastle.state, scene: window.__ourCastle.scene() }));
  expect(after.state).toEqual(before);
  expect(after.scene.atmosphere).toMatchObject({ period: 'night', weather: 'rain' });
  expect(after.scene.districts.find((d) => d.id === 'castle').open).toBe(false);
  expect(seen).toEqual({ writes: [], errors: [] });
});
