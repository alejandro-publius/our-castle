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
  const castle = page.locator('#realm-districts [data-district="castle"]');
  await castle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#realm-focus-status')).toContainText('Royal Citadel · Locked · 100%');
  await scrollSettled(page);
  expect(await fullyVisible(castle), 'the button that was used is still fully on screen').toBe(true);
  await expect(castle).toBeFocused();
  await expect(castle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('castle');
}

test('selecting a district from the keyboard keeps that button focused, pressed and fully visible', async ({ page }) => {
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
