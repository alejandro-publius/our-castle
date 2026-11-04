import { test, expect } from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// The wider estate, reward view, previews and estate announcements, in example mode through the real server.
// These prove presentation and honesty rules; they do not prove any bill-provider integration (none exists).

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
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
    '.board-heading > div:first-child', '.board-tools', '.world-navigation', '#board-status', '#tier-track',
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
  expect(await scene(page)).toMatchObject({ region: { width: 164, depth: 114 }, estateLevel: 1, tier: 0, position: 4 });
  await expectRouteClear(page);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Turn the estate right' }).click();
  await expectRouteClear(page);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expectRouteClear(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await scene(page)).view.zoom).toBeGreaterThan(1.1);
  await page.getByRole('button', { name: 'Reset view' }).click();
  expect((await scene(page)).view).toMatchObject({ zoom: 1, panX: 0, panY: 0 });
  await expectRouteClear(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('the Rewards tab shows each addition with its condition, exact progress and evidence source, and an honest bill boundary', async ({ page }) => {
  await ready(page);
  await page.getByRole('tab', { name: /Rewards/ }).click();
  const card = (id) => page.locator(`[data-reward="${id}"]`);
  await expect(card('home:cottage')).toHaveAttribute('data-status', 'unlocked');
  await expect(card('estate:porch')).toHaveAttribute('data-status', 'unlocked');
  await expect(card('home:manor')).toHaveAttribute('data-status', 'locked');
  await expect(card('home:manor')).toContainText('Unlocks when: Reach 25% of the shared goal ($75.00 tracked)');
  await expect(card('home:manor')).toContainText('Progress: $60.00 of $75.00 · $15.00 to go');
  await expect(card('home:manor')).toContainText('Evidence: Goal ledger: $60.00 reported by you');
  await expect(card('habit:garden')).toContainText('Recorded by you · not verified by any provider');
  for (const id of ['bill:electricity', 'bill:water']) {
    await expect(card(id)).toHaveAttribute('data-status', 'connection_required');
    await expect(card(id)).toContainText('Needs a provider connection');
  }
  // Example mode says payments are simulated; no bill provider is claimed.
  await expect(page.locator('#reward-evidence-note')).toContainText('Example-mode payments are simulated.');
  await expect(page.locator('#reward-evidence-note')).toContainText('no bill provider is connected');
  // No pretend verification control exists anywhere in the rewards view.
  await expect(page.locator('#panel-rewards').getByRole('button', { name: /verify|connect|mark .*paid/i })).toHaveCount(0);
});

test('reward exploration only redraws the board: no server write, no announcement, and returning restores the earned estate', async ({ page, request }) => {
  await ready(page);
  const before = await (await request.get('/api/state')).json();
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`); });
  await startLog(page);
  await page.getByRole('tab', { name: /Rewards/ }).click();
  await page.locator('[data-reward="home:castle"] .reward-preview').click();
  await expect(page.locator('#world-preview')).toBeVisible();
  await expect(page.locator('#world-preview')).toContainText('Locked · Reach 100% of the shared goal ($300.00 tracked) · $240.00 to go.');
  await expect.poll(async () => (await scene(page)).tier).toBe(3);
  expect((await scene(page)).estateLevel).toBe(3);
  await page.locator('[data-reward="bill:electricity"] .reward-preview').click();
  await expect.poll(async () => (await scene(page)).previewFeature).toBe('electricity');
  await expect(page.locator('#celebration')).toBeHidden();
  expect(writes).toEqual([]);
  expect(await appliedAdds(page)).toEqual([]);

  const after = await (await request.get('/api/state')).json();
  expect(after.achievements).toEqual(before.achievements);
  expect(after.progress).toEqual(before.progress);
  expect(after.rewards.entries.map((r) => [r.id, r.status])).toEqual(before.rewards.entries.map((r) => [r.id, r.status]));

  await page.getByRole('button', { name: 'Return to your realm' }).click();
  await expect.poll(async () => (await scene(page)).tier).toBe(0);
  expect(await scene(page)).toMatchObject({ estateLevel: 1, previewFeature: null });
  await expect(page.locator('#world-preview')).toBeHidden();
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
  await page.getByRole('tab', { name: /Rewards/ }).click();
  await expect(page.locator('[data-reward="estate:market"]')).toHaveAttribute('data-status', 'unlocked');

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
  await page.getByRole('tab', { name: /Rewards/ }).click();
  await expect(page.locator('[data-reward="estate:market"]')).toHaveAttribute('data-status', 'keepsake');
  await expect(page.locator('[data-reward="estate:market"]')).toContainText('kept after a refund');
});
