import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock, ensureDemoHousehold } from '../../server/household.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { createFakePayPal, fakeSdkControllers } from '../helpers/fake-paypal.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// The owner's two scripts, pressed for real, so every control, label and amount they quote is one the page shows:
// - docs/SANDBOX-HOLD-PROOF.md, on the real page in sandbox mode. PayPal itself is the stateful fake and the buyer's
//   approval is scripted, so this is evidence about the page and this server, never about the PayPal sandbox.
// - docs/SUBMISSION-SHOTLIST.md, session 1 (the family-trip example), in the order the cut records it. Session 2's
//   wording is checked in village-fund-journey.spec.mjs.
// These carry the kit-planner tag only because that hosted job has time to spare; the release shards do not.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const desktopOnly = (info) => test.skip(info.project.name !== 'desktop', 'The wording is the same on both layouts; one is enough.');
const openTab = async (page, name) => {
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator(`#tab-${name}`).click();
  await expect(page.locator(`#panel-${name}`)).toBeVisible();
};
const openDistricts = (page) => page.evaluate(() => window.__ourCastle.state.rewards.realm.districts.filter((d) => d.open).map((d) => d.id));

// A sandbox buyer who approves at once: a stand-in for PayPal's browser SDK, which is never loaded here.
const BUYER = `window.paypal = { async createInstance() { return {
  async findEligibleMethods() { return { isEligible: () => true }; },
  createPayPalOneTimePaymentSession(callbacks) { return { async start(_options, order) { await callbacks.onApprove(await order); } }; },
}; } };`;

/** A new, unfounded household on a sandbox-mode server, as the runbook's step 1 starts one. */
async function sandboxHouse() {
  const db = openDatabase(':memory:'), clock = createClock('2026-11-11T12:00:00');
  ensureDemoHousehold(db, clock);
  const fake = createFakePayPal();
  const paypal = createPayPalSdkClient({ clientId: 'fake-client', clientSecret: 'fake-secret', controllers: fakeSdkControllers(fake), restFetch: fake.fetch });
  const config = loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret', OUR_CASTLE_ACCESS: 'example' }, { root });
  const server = http.createServer(createApp({ root, db, clock, paypal, config }).handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { fake, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); db.close(); } };
}

for (const ending of ['return', 'release']) {
  test(`the sandbox hold runbook: hold $25, release $15 keeping the rest, then ${ending === 'return' ? 'return the last $10' : 'release the last $10 instead'}`, { tag: '@kit-planner' }, async ({ page }, info) => {
    desktopOnly(info);
    test.setTimeout(180_000);
    const house = await sandboxHouse(), outside = [], errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core') return route.fulfill({ contentType: 'text/javascript', body: BUYER });
      if (url.origin !== house.base) { outside.push(url.href); return route.abort(); }
      return route.continue();
    });
    try {
      await closeDeedsWhenTheyAppear(page);
      await page.goto(house.base);
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
      const header = page.locator('#progress-amount'), record = page.locator('#ledger-contributions'), trail = record.locator('.hold-trail');
      const release = record.locator('[data-hold="release"]'), amount = record.locator('.hold-amount'), confirm = record.locator('[data-hold="confirm-release"]');

      // 1. Sandbox mode, where the page shows it.
      await expect(page.locator('#mode-badges')).toContainText('PayPal sandbox');
      await expect(page.locator('#mode-badges')).not.toContainText('Simulated payments');

      // 2. Found the house.
      await openTab(page, 'house');
      await expect(page.locator('#house-heading')).toHaveText('Found your house');
      await page.locator('#house-name').fill('House of Proof');
      await page.getByRole('button', { name: 'Raise our banner' }).click();
      await expect(page.locator('#house-status')).toContainText('is founded');
      await expect(page.locator('#goal-name')).toHaveText('Camping trip fund');
      await expect(header).toHaveText('$60.00');
      await expect(page.locator('#target-amount')).toHaveText('$300.00');
      await expect(page.locator('#quest-next')).toHaveText('Next: Manor · $15.00 to go');
      await expect(page.locator('#persona option:checked')).toContainText('Adult');

      // 3. Hold $25.00.
      await openTab(page, 'give');
      await page.locator('#give-amount').fill('25.00');
      await expect(page.locator('#give-hold-row')).toHaveText('Hold it first. Nothing counts until an adult releases or returns it.');
      await page.locator('#give-hold').check();
      await expect(page.locator('#give-approve-text')).toHaveText('I approve holding $25.00 USD (test money).');
      await expect(page.locator('#maker-give')).toContainText('Contributions go to the PayPal sandbox with test money, through PayPal’s Server SDK, which APIMatic generates.'); // the chapter says who does this work
      await expect(page.locator('#simulate-pay')).toHaveCount(0);
      await page.locator('#give-approve').check();
      await expect(page.locator('#paypal-button')).toHaveAttribute('aria-disabled', 'false');
      await page.locator('#paypal-button').dispatchEvent('click'); // PayPal's own element; without its SDK it has no size to press
      await expect(page.locator('#give-status')).toContainText('Held. Nothing is counted until an adult releases or returns it from its Ledger record.');
      await expect(page.locator('#receipt-title')).toHaveText('Contribution held');
      const receipt = page.locator('#receipt');
      await expect(receipt).toContainText('PayPal sandbox · test money');
      await expect(receipt).toContainText(/Held\s*\$25\.00/);
      await expect(receipt).toContainText(/Released\s*Nothing/);
      await expect(receipt).toContainText([...house.fake.orders.keys()][0]);
      await expect(header).toHaveText('$60.00');

      // 4. Held, and nothing moved.
      await openTab(page, 'ledger');
      await expect(record).toContainText('Held — not counted');
      await expect(record.locator('.tag.sandbox').first()).toHaveText('PayPal sandbox');
      await expect(trail).toHaveText('Held $25.00');
      await expect(record.locator('.hold-note')).toHaveText(/^PayPal’s three-day guarantee lasts until /);
      await expect(header).toHaveText('$60.00');
      expect(await openDistricts(page)).not.toContain('manor');

      // 5. Release $15.00 and keep the rest held.
      await expect(release).toHaveText('Release to the goal…');
      await release.click();
      await expect(amount).toHaveValue('25.00');
      await amount.fill('15.00');
      await record.locator('[data-hold="keep-rest"]').check();
      await expect(record).toContainText('Keep the rest held for a later release (2 more allowed)');
      await expect(confirm).toHaveText('Confirm release of $15.00, keep $10.00 held');
      await confirm.click();
      await expect(page.locator('#ledger-status')).toContainText('Released $15.00. It now counts toward the goal. $10.00 is still held.');
      await expect(record).toContainText('Partly released — part counted');
      await expect(trail).toHaveText('Held $25.00 → Released $15.00 → $10.00 still held');
      await expect(header).toHaveText('$75.00');
      await expect.poll(() => openDistricts(page)).toContain('manor');

      if (ending === 'return') {
        // 6. Return the remaining $10.00.
        const back = record.locator('[data-hold="return"]'), confirmReturn = record.locator('[data-hold="confirm-return"]');
        await expect(back).toHaveText('Return the hold…');
        await back.click();
        await expect(confirmReturn).toHaveText('Confirm return of $10.00');
        await expect(record.getByRole('button', { name: 'Keep holding', exact: true })).toBeVisible();
        await confirmReturn.click();
        await expect(trail).toHaveText('Held $25.00 → Released $15.00 → Returned $10.00');
        await expect(header).toHaveText('$75.00');
      } else {
        // "Instead of returning": a second release, of what is left.
        await release.click();
        await expect(amount).toHaveValue('10.00');
        await expect(confirm).toHaveText('Confirm release of $10.00');
        await confirm.click();
        await expect(trail).toHaveText('Held $25.00 → Released $15.00 → Released $10.00');
        await expect(header).toHaveText('$85.00');
      }
      await expect(record).toContainText('Completed — counted');
      await expect(record.locator('[data-hold]')).toHaveCount(0);

      // 8. Check with PayPal, and what PayPal (here the fake) was asked to do: the three answers the run is for.
      await record.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
      await expect(record.locator('.last-check')).toHaveText(/PayPal and the ledger agree/);
      console.log(`runbook (${ending}) · Check with PayPal answered: ${await record.locator('.last-check').innerText()}`);
      const asked = house.fake.requests.filter((r) => r.method === 'POST' && /\/(authorize|capture|void)$/.test(r.pathname))
        .map((r) => [r.pathname.split('/').pop(), r.body?.amount?.value ?? null, r.body?.final_capture ?? null]);
      expect(asked).toEqual([['authorize', null, null], ['capture', '15.00', false], ending === 'return' ? ['void', null, null] : ['capture', '10.00', true]]);
      expect(errors).toEqual([]);
      expect(outside).toEqual([]);
    } finally { await house.close(); }
  });
}

test('the locked shot list, session 1: a kit is chosen and repaired, the plan is put in use, then a hold is released in part', { tag: '@kit-planner' }, async ({ browser }, info) => {
  desktopOnly(info);
  test.setTimeout(240_000);
  // A recording day. The example's goal date is seven weeks after the day it starts, so its amounts do not depend on it.
  const day = { now: () => new Date('2026-11-11T18:00:00Z'), iso() { return this.now().toISOString(); }, today: () => '2026-11-11' };
  const demo = await startDemo({ familyTrip: true, clock: day });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const outside = [], errors = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === demo.url) return route.continue();
    outside.push(url.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${demo.url}/`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await closeDeedsWhenTheyAppear(page);
    const kits = page.locator('#kit-plan-kits > li'), oneOff = page.getByLabel('One-off amount'), header = page.locator('#progress-amount');

    // Before pressing record.
    await page.getByRole('button', { name: 'Try a one-off expense' }).click();
    await oneOff.fill('90');
    await page.getByRole('button', { name: 'See which complete kits fit' }).click();
    await page.getByRole('button', { name: 'Compare complete kits' }).click();
    await expect(kits).toHaveCount(2);
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toContainText('$150.00');
    await expect(kits.nth(1).locator('.kit-plan-kit-head')).toContainText('$180.00');

    // Beat 1: the lighter kit is chosen, its stove kept, and it is shown on the map.
    await expect(page.locator('#header-example')).toHaveText('Example');
    await kits.nth(1).getByRole('button', { name: 'Choose this kit' }).click();
    await page.getByRole('button', { name: 'Keep stove as it is' }).click();
    await expect(page.getByRole('button', { name: 'Keep stove as it is' })).toHaveAttribute('aria-pressed', 'true');
    await kits.nth(1).getByRole('button', { name: 'Preview on map' }).click();
    await expect(page.locator('#kit-preview-title')).toHaveText('Your chosen kit · $180.00');

    // Beat 2: the expense grows. The map and the list both show the smallest change, and an adult takes it.
    await oneOff.fill('120');
    await expect(page.locator('#kit-preview-title')).toHaveText('Proposal · smallest change · $150.00');
    await expect(page.locator('#kit-plan-chosen-note')).toContainText('$30.00 short by then');
    await expect(kits).toHaveCount(1);
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toContainText('Smallest change');
    await expect(kits.nth(0).locator('.kit-plan-kit-head')).toContainText('$150.00');
    await expect(kits.nth(0).locator('.kit-plan-kit-changes')).toContainText('Switched 4-person tent');
    await expect(kits.nth(0).locator('.kit-plan-kit-lines li', { hasText: 'stove' })).toContainText('kept');
    await kits.nth(0).getByRole('button', { name: 'Choose this kit' }).click();
    await page.getByRole('button', { name: 'Review this kit' }).click();
    await page.getByRole('button', { name: 'Save goal and propose this schedule' }).click();
    await expect(page.locator('#plan-status')).toContainText('Goal saved and the family schedule proposed');
    await expect(page.locator('#accept-plan')).toHaveText('Use this plan');
    await page.locator('#accept-plan').click();
    await expect(page.locator('#accept-plan')).toHaveText('Plan in use ✓');

    // Beat 3: the goal is now the $150 kit with $60.00 reported, so the next area is $30.00 away (not the $15.00 of a
    // new $300 household). A $40.00 hold counts nothing until that $30.00 is released.
    await expect(header).toHaveText('$60.00');
    await expect(page.locator('#target-amount')).toHaveText('$150.00');
    await expect(page.locator('#quest-next')).toHaveText('Next: Keep · $30.00 to go');
    await openTab(page, 'give');
    await page.locator('#give-amount').fill('40.00');
    await page.locator('#give-hold').check();
    await expect(page.locator('#give-approve-text')).toHaveText('I approve holding $40.00 USD (simulated).');
    await page.locator('#give-approve').check();
    await expect(page.locator('#simulate-pay')).toHaveText('Simulate approved hold');
    await page.locator('#simulate-pay').click();
    await expect(page.locator('#give-status')).toContainText('Held. Nothing is counted');
    await expect(header).toHaveText('$60.00');
    await openTab(page, 'ledger');
    const record = page.locator('#ledger-contributions'), before = await openDistricts(page);
    await expect(record).toContainText('Held — not counted');
    await expect(record.locator('[data-hold="release"]')).toHaveText('Simulate release…');
    await record.locator('[data-hold="release"]').click();
    await record.locator('.hold-amount').fill('30.00');
    await record.locator('[data-hold="keep-rest"]').check();
    await expect(record.locator('[data-hold="confirm-release"]')).toHaveText('Confirm release of $30.00, keep $10.00 held');
    await record.locator('[data-hold="confirm-release"]').click();
    await expect(page.locator('#ledger-status')).toContainText('Released $30.00. It now counts toward the goal. $10.00 is still held.');
    await expect(header).toHaveText('$90.00');
    await expect(record.locator('.hold-trail')).toHaveText('Held $40.00 → Released $30.00 → $10.00 still held');
    // "The world changes": the release opens the Stone Keep and the Starfall Observatory, which the hold alone did not.
    await expect.poll(async () => (await openDistricts(page)).filter((id) => !before.includes(id))).toEqual(['keep', 'wizard']);
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});
