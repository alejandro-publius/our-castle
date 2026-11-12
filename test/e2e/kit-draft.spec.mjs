import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// "Draft listings" in the kit plan, on the playable family-trip example: its own server on a free port, invented shops
// and listings answered on this computer. No provider is contacted and nothing outside that server is requested.
test('an adult drafts the lowest-priced listing for each item without one, enters each count, adds them and compares', { tag: '@kit-planner' }, async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'The same controls on both layouts.');
  test.setTimeout(180_000);
  const demo = await startDemo({ familyTrip: true });
  const { viewport } = info.project.use;
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const errors = [], outside = [], writes = [];
  await context.route('**/*', (route) => {
    const q = route.request(), url = new URL(q.url());
    if (url.origin !== demo.url) { outside.push(url.href); return route.abort(); }
    if (q.method() !== 'GET') writes.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(demo.url + '/');
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await closeDeedsWhenTheyAppear(page);
    await page.getByRole('button', { name: 'Try a one-off expense' }).click();
    const box = page.locator('#kit-plan-draft'), status = page.locator('#kit-plan-status');
    await expect(page.locator('#kit-plan-lines > li')).toHaveCount(4);
    await expect(box).toBeHidden(); // every item still to get starts with listings, so there is nothing to draft

    for (const title of ['Sample: Sleeping bag, synthetic', 'Sample: Sleeping bag, down', 'Sample: Camp stove', 'Sample: Compact stove']) {
      await page.getByRole('button', { name: `Remove ${title}`, exact: true }).click();
      await expect(status).toContainText(`${title} is no longer a listing for this kit.`);
    }
    await expect(box).toHaveText('Draft listings for the 2 items without oneOne search of the example catalogue for each of those items, by its name on the list. The lowest-priced result in stock is drafted for each. Nothing is added until you say so.');
    const searches = demo.example.merchant.catalogue.calls.search;
    await page.locator('#kit-plan-draft-start').click();
    await expect(status).toHaveText('Drafted 2 listings. Nothing is added yet: enter how many items each listing gives, then add them.');
    // The cheaper of the two sample listings for each item: the $20 bag, not the $30 one; the $30 stove, not the $35 one.
    await expect(box.locator('li')).toHaveText([
      /^sleeping bag: Sample: Sleeping bag, syntheticsample-shop-one\.example · \$20\.00 a listing · listed 800 g · lowest of 2 results shown/,
      /^stove: Sample: Camp stovesample-shop-one\.example · \$30\.00 a listing · listed 600 g · lowest of 2 results shown/,
    ]);
    expect(demo.example.merchant.catalogue.calls.search - searches).toBeLessThanOrEqual(2);
    const counts = box.locator('[data-draft-count]');
    await expect(counts.first()).toBeFocused();
    await expect(counts).toHaveCount(2);
    for (const i of [0, 1]) await expect(counts.nth(i)).toHaveValue(''); // the count has no default
    expect(writes.filter((p) => p === '/api/kit/listings')).toEqual([]); // drafting added nothing
    await expect(page.locator('#kit-plan-lines > li', { hasText: 'stove' })).toContainText('No listing yet.');

    // Adding needs each count from the adult; without one, nothing is sent.
    await page.locator('#kit-plan-draft-add').click();
    await expect(status).toContainText('Enter how many sleeping bag one listing gives, from 1 to 100.');
    await expect(counts.first()).toHaveAttribute('aria-invalid', 'true');
    expect(writes.filter((p) => p === '/api/kit/listings')).toEqual([]);
    await counts.nth(0).fill('1');
    await expect(status).toBeEmpty();
    await counts.nth(1).fill('1');
    await expect(page.locator('#kit-plan-draft-total')).toHaveText('With these counts: $70.00 for 2 items on the list, at the listed prices. Tax and shipping are not included.'); // 2 bags at $20 and a $30 stove
    await page.locator('#kit-plan-draft-add').click();
    await expect(status).toHaveText('Added 2 listings. Compare complete kits when you are ready.');
    await expect(box).toBeHidden();
    await expect(page.locator('#kit-plan-lines > li', { hasText: 'stove' })).toContainText('Sample: Camp stove');
    await expect(page.locator('#kit-plan-lines > li', { hasText: 'stove' })).toContainText('1 in each (Rowan’s count)');

    // The drafted listings are ordinary listings: the existing comparison uses them.
    await page.locator('#kit-plan-compare').click();
    await expect(page.locator('#kit-plan-note')).toContainText('2 different complete kits fit');
    await expect(page.locator('#kit-plan-kits .kit-plan-kit-total').first()).toHaveText('$150.00'); // the $80 tent, two $20 bags, the $30 stove
    expect(writes).toEqual([...Array(4).fill('/api/kit/listings/remove'), '/api/kit/draft', '/api/kit/listings', '/api/kit/listings', '/api/kit/compare']);
    expect(errors).toEqual([]); expect(outside).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});
