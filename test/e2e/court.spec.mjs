import { test, expect } from '@playwright/test';

const court = (page) => page.evaluate(() => window.__ourCastle.scene().court);
const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
};
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});


test('reduced motion keeps the earned court visible and still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect.poll(async () => (await court(page)).capacity).toBe(2);
  const before = await court(page);
  expect(before.princesses).toEqual([]);
  await page.waitForTimeout(700);
  expect((await court(page)).guests).toEqual(before.guests);
  expect(await page.evaluate(() => window.__ourCastle.scene().ambient)).toBe(false);
});
