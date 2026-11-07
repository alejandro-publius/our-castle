import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import { test, expect } from '@playwright/test';

// Keyboard focus must stay visible when an action moves the view to the realm (WCAG 2.4.7 / 2.4.11).
// Example mode only, through the real server; nothing here writes to the server.

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
// The whole element is inside the viewport (not just partly).
const fullyVisible = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
// Wait until smooth scrolling has finished: the final position matters, not a moment before the scroll starts.
async function scrollSettled(page) {
  let last = null;
  await expect.poll(async () => { const y = await page.evaluate(() => scrollY); const same = y === last; last = y; return same; }, { intervals: [300], timeout: 8_000 }).toBe(true);
}
const settle = (page) => expect.poll(() => page.evaluate(() => window.__ourCastle.scene().animating), { timeout: 20_000 }).toBe(false);
function trackWrites(page) {
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  return writes;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

async function inspectCastleByKeyboard(page) {
  await openMenu(page, 'district-menu');
  const castle = page.locator('#realm-districts [data-district="castle"]');
  await castle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · $240.00 to unlock');
  await scrollSettled(page);
  const trigger = page.locator('#district-menu > summary');
  expect(await fullyVisible(trigger), 'the menu trigger is fully on screen').toBe(true);
  await expect(trigger).toBeFocused();
  await expect(page.locator('#district-menu')).not.toHaveAttribute('open', '');
  await expect(castle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('castle');
}

test('keyboard district selection closes the menu and returns focus to its visible trigger', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await inspectCastleByKeyboard(page);
  expect(writes).toEqual([]);
});

test.describe('at 320 by 568', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test('the selected district button stays on screen on the narrowest phone layout', async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await inspectCastleByKeyboard(page);
  });
});


test('the starting home is larger, parchment names stay inside the map, and overview retains all nine districts', async ({ page }) => {
  const writes = trackWrites(page);
  await ready(page);
  await page.evaluate(() => document.fonts.ready);
  const close = await page.evaluate(() => window.__ourCastle.scene());
  expect(close.view.focus).toBe('cottage');
  const marker = page.locator('#realm-markers [data-district="cottage"]');
  await expect(marker).toBeVisible();
  const look = await marker.evaluate((el) => {
    const label = el.querySelector('strong'), style = getComputedStyle(el), text = getComputedStyle(label);
    return { background: style.backgroundColor, ink: style.color, font: text.fontFamily, size: parseFloat(text.fontSize) };
  });
  expect(look.background).toBe('rgb(246, 237, 214)');
  expect(look.ink).toBe('rgb(56, 47, 37)');
  expect(look.font).toContain('Uncial');
  expect(look.size).toBeGreaterThanOrEqual(16);
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  const overview = await page.evaluate(() => window.__ourCastle.scene());
  expect(overview.view.worldPerPixel / close.view.worldPerPixel).toBeGreaterThan(2);
  expect(overview.districts).toHaveLength(9);
  expect(await page.locator('#realm-districts button').count()).toBe(9);
  if(page.viewportSize().width<640) await expect(page.locator('#realm-markers button[data-district]:visible')).toHaveCount(1);
  expect(overview.districts.filter((d) => d.open).map((d) => d.id)).toEqual(['cottage']);
  for (const el of await page.locator('#realm-markers button[data-district]:visible').all()) {
    expect(await el.evaluate((el) => {
      const p = el.closest('.realm-map').getBoundingClientRect(), r = el.getBoundingClientRect();
      return r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom;
    })).toBe(true);
  }
  expect(writes).toEqual([]);
});

// The toolbar (Areas, Whole realm, View, settings) and the area status row are laid over the map, above its names. A
// district name or legend marker (the sword's glint, the family project) that slid under them would be hidden.
const underControls = (page) => page.evaluate(() => {
  const controls = [...document.querySelectorAll('.world-hud > *, .board-foot > *')]
    .map((el) => (el.matches('details') ? el.querySelector(':scope > summary') : el))
    .filter((el) => el && el.getClientRects().length && el.getBoundingClientRect().width && el.getBoundingClientRect().height);
  const hidden = [];
  for (const marker of document.querySelectorAll('#realm-markers button:not([hidden])')) {
    const r = marker.getBoundingClientRect();
    for (const control of controls) {
      const c = control.getBoundingClientRect();
      if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) hidden.push(`${marker.dataset.district ?? marker.dataset.legend} under ${control.closest('details')?.id ?? (control.id || control.textContent.trim())}`);
    }
  }
  return hidden;
});

test.describe('names on the map and the controls laid over it', () => {
  test.use({ reducedMotion: 'reduce' });
  test('no district name or legend marker slides under the map controls at any zoom, and the controls stay on top', async ({ page }, info) => {
    test.setTimeout(240_000);
    const writes = trackWrites(page);
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    if (await page.locator('#journey').isVisible()) await page.locator('#journal-toggle').click();
    const hidden = [];
    const check = async (where) => { for (const found of await underControls(page)) hidden.push(`${where}: ${found}`); };
    await check('start');
    await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
    await settle(page);
    await check('overview');
    for (const district of await page.locator('#realm-districts [data-district]').evaluateAll((els) => els.map((el) => el.dataset.district))) {
      await chooseDistrict(page, district);
      await closeMenu(page, 'district-menu');
      await settle(page);
      await check(district);
      // Each step is 1.2×; the sixth reaches the closest zoom (2.8×).
      for (let zoom = 1; zoom <= 6; zoom++) {
        await clickView(page, 'Zoom in');
        await settle(page);
        await check(`${district} +${zoom}`);
      }
      await clickView(page, 'Reset view');
      await settle(page);
    }
    expect(hidden).toEqual([]);
    // At the closest zoom on the observatory the controls are still the topmost elements, so each stays reachable. On the
    // phone the observatory's name is shown there, now below the toolbar; on desktop its anchor has left the map.
    await chooseDistrict(page, 'wizard');
    await closeMenu(page, 'district-menu');
    for (let zoom = 1; zoom <= 6; zoom++) await clickView(page, 'Zoom in');
    await settle(page);
    if (info.project.name === 'phone') await expect(page.locator('#realm-markers [data-district="wizard"]')).toBeVisible();
    expect(await page.evaluate(() => [...document.querySelectorAll('.world-hud > *')]
      .map((el) => (el.matches('details') ? el.querySelector(':scope > summary') : el))
      .every((el) => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === hit || el.contains(hit); }))).toBe(true);
    expect(writes).toEqual([]);
  });
});
