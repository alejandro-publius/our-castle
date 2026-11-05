import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3, fakeProduct, fakeSearchResponse } from '../helpers/fake-channel3.mjs';
import { chooseDistrict } from './support/game-controls.mjs';

// The connected family journey on one fresh example household: Market Town merchant (FAKE Channel3 transport) ->
// explicit goal at the item's actual price -> an adult-approved SIMULATED example contribution -> the ordinary world
// unlocks -> the Treasury's milestone and receipt lead back to the area. No PayPal, AI or live Channel3 call; this is
// not live payment evidence.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/connected/', import.meta.url));
const TENT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><path d="M6 52 32 12l26 40Z" fill="#527557"/></svg>';

let s;
test.afterEach(async () => { await s?.close(); s = null; });

async function start(page) {
  const db = openDatabase(':memory:');
  const clock = createClock();
  const fake = createFakeChannel3(() => fakeSearchResponse([fakeProduct(), fakeProduct({ id: 'fakeBag03', title: 'Test fixture: Sleeping bag', images: [], offers: [] })]));
  const app = createApp({ config: loadConfig({}, { root }), db, clock, merchant: createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: fake.fetch, clock }), root });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}`;
  s = { base, fake, issues: [], writes: [], close: () => new Promise((r) => {
    server.close(() => { db.close(); r(); });
    server.closeAllConnections(); // End browser keep-alives before releasing this test's database.
  }) };
  page.on('pageerror', (e) => s.issues.push(e.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.hostname === 'cdn.trychannel3.com') return route.fulfill({ contentType: 'image/svg+xml', body: TENT_SVG });
    if (url.origin !== base) { s.issues.push(`${r.method()} ${r.url()}`); return route.abort(); }
    if (r.method() !== 'GET') s.writes.push(url.pathname);
    return route.continue();
  });
  await page.goto(`${base}/`);
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
}
const state = (page) => page.evaluate(() => window.__ourCastle.state);
const openJournal = async (page) => { if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click(); };
async function closeDeed(page, name) {
  await expect(page.locator('#deed-dialog')).toBeVisible();
  await expect(page.locator('#deed-name')).toHaveText(name);
  await page.locator('#deed-close').click();
  await expect(page.locator('#deed-dialog')).toBeHidden();
}

test('fresh family -> merchant goal -> reviewed plan -> example contribution -> world -> Treasury and reload', async ({ page }, info) => {
  await start(page);
  // Start from the actual House form rather than preparing a household through an API helper.
  await page.locator('input[name="playMode"][value="family"]').check();
  await page.locator('#house-name').fill('House of Alder');
  await page.locator('input[name="crestField"][value="cobalt"]').check({ force: true });
  await page.locator('input[name="crestCharge"][value="stag"]').check({ force: true });
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  // 1. Market Town merchant (keyboard to open), explicit search, a draft that changes nothing.
  await chooseDistrict(page, 'market');
  await page.locator('#open-merchant').focus();
  await page.keyboard.press('Enter');
  await page.locator('#merchant-query').fill('four person tent');
  await page.locator('#merchant-budget').fill('200');
  await page.keyboard.press('Enter');
  await expect(page.locator('#merchant-results > li')).toHaveCount(2);
  await expect(page.locator('#merchant-results > li').nth(1).locator('.merchant-item-meta')).toContainText('No price returned');
  const before = await state(page);
  mkdirSync(evidence, { recursive: true });
  await page.locator('#merchant-dialog').screenshot({ path: `${evidence}${info.project.name}-merchant.png` });
  await page.locator('#merchant-results > li').first().getByRole('button', { name: 'Use as goal' }).click();
  await expect(page.locator('#goal-draft')).toBeVisible();
  expect((await state(page)).goal).toEqual(before.goal);

  // 2. Explicit confirmation at the actual price: the ordinary goal edit. $60 reported is past 25% of $189.50.
  await page.locator('#goal-draft-save').click();
  await expect(page.locator('#plan-status')).toContainText('Goal saved: Test fixture: Four-person dome tent, $189.50.');
  await closeDeed(page, 'Manor Gardens');
  expect((await state(page)).ledger.goalEntries.map((e) => [e.kind, e.amountCents])).toEqual(before.ledger.goalEntries.map((e) => [e.kind, e.amountCents]));

  // 3. Review and accept the built-in plan for the new goal. This test calls no AI provider.
  await page.locator('#goal-weekly').fill('20.00');
  await page.getByRole('button', { name: 'Make an example plan' }).click();
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan');
  await expect(page.locator('#plan-total')).toHaveText('$129.50');
  expect((await state(page)).acceptedPlanId).toBeNull();
  await page.locator('#plan-result').screenshot({ path: `${evidence}${info.project.name}-plan.png` });
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(page.locator('#tab-give')).toHaveAttribute('aria-selected', 'true');
  const planned = await state(page);
  expect(planned.acceptedPlanId).toBe(planned.plan.id);
  expect(planned.plan.totals.plannedCents).toBe(12950);

  // 4. Adult approval of an exact amount, simulated example payment, credited once.
  await openJournal(page);
  await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill('20.00');
  await expect(page.getByRole('button', { name: 'Simulate approved payment' })).toBeDisabled();
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment' }).click();
  await closeDeed(page, 'Market Town'); // $80 of $189.50 passes 40%
  const paid = await state(page);
  expect(paid.progress.progressCents).toBe(8000);
  expect(paid.contributions.map((c) => [c.amountCents, c.status, c.simulated])).toEqual([[2000, 'completed', true]]);

  // 5. Treasury: the next area from the server's own rules for the new goal, the records, and a receipt on tap.
  await openJournal(page);
  await page.locator('#tab-ledger').click();
  await expect.poll(async () => (await page.evaluate(() => window.__ourCastle.treasury()))?.next?.id).toBe('keep');
  const milestone = page.locator('#treasury-next .next-area');
  await expect(milestone.locator('.next-area-name')).toHaveText('Next area Stone Keep & Starfall Observatory 60% milestone');
  await expect(milestone.locator('.next-area-meta')).toHaveText('$80.00 of $113.70 · $33.70 to go');
  // Mixed sources stay distinct: reported starting progress and the simulated contribution.
  const grid = page.locator('#ledger-goal');
  await expect(grid).toContainText('You reported');
  await expect(grid).toContainText('Simulated');
  await page.locator('#ledger-filter').getByRole('button', { name: 'Bills', exact: true }).click();
  await expect(grid).not.toContainText('Simulated contribution');
  await page.locator('#ledger-filter').getByRole('button', { name: 'All', exact: true }).click();
  await expect(milestone.locator('.next-area-meta')).toHaveText('$80.00 of $113.70 · $33.70 to go');
  await grid.getByText('Simulated contribution', { exact: false }).first().click();
  const receipt = page.locator('#ledger-contributions');
  await expect(receipt).toContainText('$20.00');
  await expect(receipt).toContainText('Completed — counted');
  await expect(receipt.getByRole('button', { name: 'Visit Market Town' })).toBeVisible();
  mkdirSync(evidence, { recursive: true });
  await page.locator('#panel-ledger h3').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}${info.project.name}-treasury.png` });
  await receipt.getByRole('button', { name: 'Visit Market Town' }).click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.scene().view.focus)).toBe('market');
  await expect(page.locator('#realm-markers [data-district="market"]')).toBeFocused();

  // 6. Return: reload keeps the confirmed goal and item, accepted plan, records and earned world; no deed repeats.
  await page.reload();
  await page.waitForFunction(() => window.__ourCastle?.state && window.__ourCastle.scene());
  const after = await state(page);
  expect(after.goal).toMatchObject({ name: 'Test fixture: Four-person dome tent', targetCents: 18950 });
  expect(after.goalItem).toMatchObject({ productId: 'fakeTent01', priceCents: 18950 });
  expect(after.rewards.realm.districts.filter((d) => d.open).map((d) => d.id)).toEqual(['cottage', 'manor', 'market']);
  expect(after.progress.progressCents).toBe(8000);
  expect(after.acceptedPlanId).toBe(planned.acceptedPlanId);
  await openJournal(page);
  await page.locator('#tab-ledger').click();
  await expect(page.locator('#treasury-next .next-area-meta')).toHaveText('$80.00 of $113.70 · $33.70 to go');
  await page.waitForTimeout(1200);
  await expect(page.locator('#deed-dialog')).toBeHidden();

  expect(s.fake.calls).toHaveLength(1); // one fake Channel3 search, on request
  expect(s.writes).toEqual(['/api/setup', '/api/merchant/search', '/api/merchant/goal', '/api/plans', `/api/plans/${planned.plan.id}/accept`, '/api/example/contributions']);
  expect(s.issues).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
