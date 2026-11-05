import { openMenu, closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';
import { test, expect } from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// The wider estate and milestone announcements, in example mode through the real server.
// These prove presentation and honesty rules; they do not prove any bill-provider integration (none exists).

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
};
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const settled = (page) => expect.poll(async () => (await scene(page)).animating, { timeout: 20_000 }).toBe(false);
const startLog = (page) => page.evaluate(() => { window.__ourCastle.bus.log = []; });
const appliedAdds = (page) => page.evaluate(() => window.__ourCastle.bus.log.filter((e) => e.type === 'state:applied').map((e) => e.detail.added));

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

async function foundHouse(page) {
  await page.getByRole('tab', { name: /House/ }).click();
  await page.locator('input[name="playMode"][value="family"]').check();
  await page.locator('#house-name').fill('House of Fernhill');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
}

async function contributeAmount(page, amount) {
  await page.getByRole('tab', { name: /Contribute/ }).click();
  await page.locator('#give-amount').fill(amount);
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment' }).click();
}

// Every route space and the travelers must be on the canvas and clear of the heading, view controls and caption.
async function expectRouteClear(page) {
  const { spaces, travelers, canvas } = await page.evaluate(() => window.__ourCastle.route());
  const overlays = await page.evaluate(() => [
    '.world-hud', '#view-deed',
  ].flatMap((sel) => [...document.querySelectorAll(sel)]).filter((el) => el.offsetParent).map((el) => {
    const r = el.getBoundingClientRect(); return { sel: el.className || el.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  for (const point of [...spaces, { index: 'travelers', ...travelers }]) {
    expect(point.x, `space ${point.index} is inside the canvas horizontally`).toBeGreaterThan(canvas.left + 2);
    expect(point.x).toBeLessThan(canvas.left + canvas.width - 2);
    expect(point.y, `space ${point.index} is inside the canvas vertically`).toBeGreaterThan(canvas.top + 2);
    expect(point.y).toBeLessThan(canvas.top + canvas.height - 2);
    for (const o of overlays) {
      const covered = point.x > o.left && point.x < o.right && point.y > o.top && point.y < o.bottom;
      expect(covered, `space ${point.index} is not hidden behind ${o.sel}`).toBe(false);
    }
  }
}

// District deeds are tested in area-cards.spec.mjs; here a deed that opens is closed like a family would.
test.beforeEach(({ page }) => closeDeedsWhenTheyAppear(page));
test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/demo/reset', { data: {} });
  expect(response.ok()).toBeTruthy();
});

test('the wider estate keeps every route space and the travelers visible and clear of the controls at any turn and zoom', async ({ page }) => {
  const errors = trackErrors(page);
  await ready(page);
  expect(await scene(page)).toMatchObject({ region: { width: 228, depth: 132 }, estateLevel: 1, tier: 0, position: 4 });
  await expectRouteClear(page);
  for (let i = 0; i < 3; i++) await clickView(page, 'Turn the estate right');
  await expectRouteClear(page);
  await clickView(page, 'Zoom out');
  await expectRouteClear(page);
  await clickView(page, 'Zoom in');
  await clickView(page, 'Zoom in');
  expect((await scene(page)).view.zoom).toBeGreaterThan(1.1);
  await clickView(page, 'Reset view');
  expect((await scene(page)).view).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
  await expectRouteClear(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});



test('reaching 40% announces the village quarter once; a reload and a refund announce nothing new', async ({ page }) => {
  await ready(page);
  await foundHouse(page);
  await startLog(page);
  await contributeAmount(page, '60.00');
  await expect(page.locator('#progress-amount')).toHaveText('$120.00');
  await settled(page);
  const celebration = page.locator('#celebration');
  await expect(celebration).toContainText('The Manor rises!');
  await expect(celebration.locator('[data-reward="estate:market"]')).toContainText('The village quarter:');
  await expect(celebration.locator('[data-reward="estate:porch"]')).toHaveCount(0); // already earned at the start
  expect(await appliedAdds(page)).toContainEqual(['estate:market']);
  expect((await scene(page)).estateLevel).toBe(2);

  // Reload: the same server state is applied with no previous state, so nothing is announced.
  await ready(page);
  await expect(page.locator('#celebration')).toBeHidden();
  await startLog(page);
  expect(await page.evaluate(() => window.__ourCastle.state.rewards.entries.find((r) => r.id === 'estate:market').status)).toBe('unlocked');

  // Refund: progress falls below 40%; the quarter becomes a keepsake and no new reward is announced.
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Simulate refund' }).click();
  await page.getByRole('button', { name: 'Confirm refund of $60.00' }).click();
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await settled(page);
  const adds = await appliedAdds(page);
  expect(adds.length).toBeGreaterThan(0);
  expect(adds.flat()).toEqual([]);
  await expect(page.locator('#celebration')).toBeHidden();
  expect((await scene(page)).estateLevel).toBe(2);
  expect(await page.evaluate(() => window.__ourCastle.state.rewards.entries.find((r) => r.id === 'estate:market').status)).toBe('keepsake');
});
