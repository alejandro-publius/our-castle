import { test, expect } from '@playwright/test';

const court = (page) => page.evaluate(() => window.__ourCastle.scene().court);
const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

test('home exploration shows larger roaming courts without earning guests or writing financial state', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  expect((await court(page)).capacity).toBe(2);
  const before = await (await request.get('/api/state')).json();
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(r.url()); });
  await page.getByRole('tab', { name: /Rewards/ }).click();
  for (const [id, count, princesses] of [['manor', 6, 1], ['keep', 12, 2], ['castle', 20, 3]]) {
    await expect(page.locator(`[data-reward="home:${id}"] .reward-court`)).toContainText(`${count} wandering guests`);
    await page.locator(`[data-reward="home:${id}"] .reward-preview`).click();
    await expect.poll(async () => (await court(page)).capacity).toBe(count);
    expect((await court(page)).princesses).toHaveLength(princesses);
    await expect(page.locator('#world-preview')).toContainText('Locked · Reach');
    await expect(page.locator('#preview-title')).toContainText(`${count} guests`);
    await expect(page.locator('#board-status')).toContainText(`${count} wandering guests`);
    await expect(page.locator('#board-status')).toContainText(`${princesses} princess`);
    await expect(page.locator('#world canvas')).toHaveAttribute('aria-label', new RegExp(`${count} wandering guests`));
  }
  const first = await court(page);
  expect(first.guests).toHaveLength(20);
  expect(first.batches).toBeLessThan(70);
  await expect.poll(async () => {
    const now = await court(page);
    return now.guests.some((p, i) => Math.hypot(p.x - first.guests[i].x, p.z - first.guests[i].z) > .08);
  }, { timeout: 8000 }).toBe(true);
  await page.getByRole('button', { name: 'Return to your realm' }).click();
  await expect.poll(async () => (await court(page)).capacity).toBe(2);
  await page.locator('[data-reward="home:castle"] .reward-preview').click();
  await expect.poll(async () => (await court(page)).capacity).toBe(20);
  expect((await court(page)).batches).toBe(first.batches, 'previews do not accumulate guest batches');
  await page.getByRole('button', { name: 'Return to your realm' }).click();
  await expect.poll(async () => (await court(page)).capacity).toBe(2);
  const after = await (await request.get('/api/state')).json();
  expect(after.progress).toEqual(before.progress);
  expect(after.achievements).toEqual(before.achievements);
  expect(after.contributions).toEqual(before.contributions);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('reduced motion keeps the complete royal cast visible and still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.getByRole('tab', { name: /Rewards/ }).click();
  await page.locator('[data-reward="home:castle"] .reward-preview').click();
  await expect.poll(async () => (await court(page)).capacity).toBe(20);
  const before = await court(page);
  expect(before.princesses).toEqual(['Princess Elowen', 'Princess Amara', 'Princess Sorrel']);
  await page.waitForTimeout(700);
  expect((await court(page)).guests).toEqual(before.guests);
  expect(await page.evaluate(() => window.__ourCastle.scene().ambient)).toBe(false);
});
