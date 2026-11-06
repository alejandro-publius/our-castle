import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { setupDomain } from '../helpers/setup.mjs';

// Real app/wrapper and HTTP service, isolated in-memory database, scripted SDK and fake PayPal transport.
// No actual PayPal script, eligibility service, payment, popup or model is contacted.
const root = fileURLToPath(new URL('../../', import.meta.url));
test.use({ reducedMotion: 'reduce' }); // same software-WebGL policy as the existing Plan interaction checks
const SDK = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
const sdk = `window.sdkSessions = []; window.sdkInitializations = 0;
window.paypal = { async createInstance() { window.sdkInitializations++; return {
  async findEligibleMethods() { return { isEligible: () => true }; },
  createPayPalOneTimePaymentSession(callbacks) {
    const session = { callbacks, async start(_options, order) { session.order = await order; } };
    window.sdkSessions.push(session); return session;
  }
}; } };`;
let s;
const orders = () => s.env.db.prepare('SELECT * FROM payment_orders ORDER BY rowid').all();
const captures = () => s.env.fake.requests.filter(r => r.pathname.endsWith('/capture'));
const snapshot = () => JSON.stringify(s.env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, s.env.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

test.afterEach(async ({ page }) => {
  await page.close();
  if (s) { s.server.closeAllConnections(); await new Promise(resolve => s.server.close(resolve)); s.env.db.close(); s = null; }
});

async function prepare(page, { full = false, firstScript = 'ok' } = {}) {
  const env = setupDomain({ mode: 'sandbox' });
  const app = createApp({ root, db: env.db, clock: env.clock, paypal: env.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  s = { env, server, base, scripts: 0, configs: 0, outside: [], pageErrors: [], held: null };
  page.on('pageerror', error => s?.pageErrors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.href === SDK) {
      s.scripts++;
      if (s.scripts === 1 && firstScript === 'fail') return route.abort();
      if (s.scripts === 1 && firstScript === 'hold') { s.held = route; return; }
      return route.fulfill({ contentType: 'text/javascript', body: sdk });
    }
    if (url.origin !== base) { s.outside.push(url.href); return route.abort(); }
    if (url.pathname === '/api/paypal/config') s.configs++;
    if (url.pathname === '/__checkout_diagnostic__') return route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><style>paypal-button{display:inline-block;width:190px;height:44px}</style><div id="checkout"></div>' });
    return route.continue();
  });
  await page.goto(base + (full ? '/' : '/__checkout_diagnostic__'));
  if (full) await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

async function mount(page) {
  return page.evaluate(async ({ householdId, goalId }) => {
    window.checkoutEvents ??= { statuses: [], results: [] };
    window.checkoutOwner = { householdId, goalId };
    window.mountPending = true;
    try {
      const { mountPayPalButton } = await import('/src/app/paypal-checkout.js');
      window.checkoutControl = await mountPayPalButton(document.getElementById('checkout'), {
        getOrderInput: () => ({ householdId, goalId, approverId: 'm_rowan', amountCents: 1500,
          approvalConfirmed: true, requestId: crypto.randomUUID() }),
        getOwnership: () => window.checkoutOwner,
        onResult: result => window.checkoutEvents.results.push(result),
        onStatus: status => window.checkoutEvents.statuses.push(status),
      });
      window.checkoutControl.setEnabled(true);
      return { ok: true };
    } catch (error) { window.mountFailure = error.message; return { ok: false, error: error.message }; }
    finally { window.mountPending = false; }
  }, { householdId: s.env.householdId, goalId: s.env.goalId });
}

test('world and planning load without PayPal; failed checkout can retry while keeping the chosen amount', async ({ page }, info) => {
  await prepare(page, { full: true, firstScript: 'fail' });
  const before = snapshot();
  await page.locator('#tab-plan').click();
  expect(s.configs).toBe(0); expect(s.scripts).toBe(0);
  await page.screenshot({ path: info.outputPath('world-before-checkout.png') });
  await page.locator('#tab-give').click();
  const retry = page.getByRole('button', { name: 'Retry checkout' });
  await expect(retry).toBeVisible();
  await page.locator('#give-amount').fill('20.00');
  await page.locator('#give-approve').check();
  expect(s.scripts).toBe(1); // editing the form must not silently retry the failed provider load
  await page.screenshot({ path: info.outputPath('checkout-retry.png') });
  await retry.click();
  await expect(page.locator('paypal-button')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#give-amount')).toHaveValue('20.00');
  await expect(page.locator('#give-approve')).toBeChecked();
  await page.locator('#tab-plan').click(); await page.locator('#tab-give').click();
  expect(s.scripts).toBe(2); expect(s.configs).toBe(2);
  expect(await page.evaluate(() => window.sdkInitializations)).toBe(1);
  expect(snapshot()).toBe(before); expect(orders()).toHaveLength(0);
  expect(s.env.fake.requests).toHaveLength(0); expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('a failed SDK download is retryable rather than cached as a permanent failure', async ({ page }) => {
  await prepare(page, { firstScript: 'fail' });
  const before = snapshot();
  expect((await mount(page)).ok).toBe(false);
  expect((await mount(page)).ok).toBe(true);
  expect(s.scripts).toBe(2); expect(snapshot()).toBe(before);
  expect(s.env.fake.requests).toHaveLength(0); expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('a stalled SDK download times out and permits an explicit fresh attempt', async ({ page }) => {
  await prepare(page, { firstScript: 'hold' });
  await page.clock.install();
  const attempt = mount(page);
  await expect.poll(() => s.scripts).toBe(1);
  await page.clock.fastForward(20_001);
  await expect(attempt).resolves.toMatchObject({ ok: false });
  await s.held.abort();
  expect((await mount(page)).ok).toBe(true);
  expect(s.scripts).toBe(2); expect(orders()).toHaveLength(0); expect(s.env.fake.requests).toHaveLength(0);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('rapid clicks and an early SDK start return create only one approval attempt and one credit', async ({ page }) => {
  await prepare(page); expect((await mount(page)).ok).toBe(true);
  await page.evaluate(() => { const button = document.querySelector('paypal-button'); button.click(); button.click(); });
  await expect.poll(() => orders().length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.sdkSessions[0]?.order?.orderId)).toBeTruthy();
  await expect(page.locator('paypal-button')).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => document.querySelector('paypal-button').click());
  expect(orders()).toHaveLength(1);
  await page.evaluate(() => { const session = window.sdkSessions[0]; return session.callbacks.onApprove({ orderId: session.order.orderId }); });
  expect(orders()).toHaveLength(1); expect(captures()).toHaveLength(1);
  expect(s.env.db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind = 'contribution'").get().n).toBe(1);
  expect(await page.evaluate(() => window.checkoutEvents.results.at(-1).progress.progressCents)).toBe(7500);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('late callbacks for an earlier window cannot cancel or enable the next checkout', async ({ page }) => {
  await prepare(page); expect((await mount(page)).ok).toBe(true);
  await page.locator('paypal-button').click();
  await expect.poll(() => page.evaluate(() => window.sdkSessions[0]?.order?.orderId)).toBeTruthy();
  await page.evaluate(() => window.sdkSessions[0].callbacks.onCancel());
  await page.locator('paypal-button').click();
  await expect.poll(() => orders().length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.sdkSessions[1]?.order?.orderId)).toBeTruthy();
  await page.evaluate(async () => {
    await window.sdkSessions[0].callbacks.onCancel();
    await window.sdkSessions[0].callbacks.onError(new Error('Old checkout closes late'));
  });
  expect(orders().map(order => order.status)).toEqual(['approval_canceled', 'created']);
  await expect(page.locator('paypal-button')).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => document.querySelector('paypal-button').click());
  expect(orders()).toHaveLength(2); expect(captures()).toHaveLength(0);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('an approval naming a different order cannot cause a capture', async ({ page }) => {
  await prepare(page); expect((await mount(page)).ok).toBe(true);
  await page.locator('paypal-button').click();
  await expect.poll(() => page.evaluate(() => window.sdkSessions[0]?.order?.orderId)).toBeTruthy();
  const before = snapshot(), providerCalls = s.env.fake.requests.length;
  await page.evaluate(() => window.sdkSessions[0].callbacks.onApprove({ orderId: 'UNRELATED-ORDER' }));
  expect(captures()).toHaveLength(0); expect(snapshot()).toBe(before);
  expect(s.env.fake.requests).toHaveLength(providerCalls);
  expect(await page.evaluate(() => window.checkoutEvents.results)).toEqual([]);
  expect(await page.evaluate(() => window.checkoutEvents.statuses.at(-1).message)).toMatch(/did not match/);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('the approved attempt keeps its original household scope if the surrounding UI changes', async ({ page }) => {
  await prepare(page); expect((await mount(page)).ok).toBe(true);
  await page.locator('paypal-button').click();
  await expect.poll(() => page.evaluate(() => window.sdkSessions[0]?.order?.orderId)).toBeTruthy();
  await page.evaluate(() => {
    window.checkoutOwner = { householdId: 'another-household', goalId: 'another-goal' };
    const session = window.sdkSessions[0];
    return session.callbacks.onApprove({ orderId: session.order.orderId });
  });
  expect(captures()).toHaveLength(1); expect(orders()).toHaveLength(1);
  expect(await page.evaluate(() => window.checkoutEvents.results.at(-1).progress.progressCents)).toBe(7500);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});

test('cancel during order creation cannot release an approval whose capture is still pending', async ({ page }) => {
  await prepare(page); expect((await mount(page)).ok).toBe(true);
  let createRoute = null, captureRoute = null, cancellations = 0;
  await page.route('**/api/paypal/orders', route => { createRoute = route; });
  await page.route('**/api/paypal/orders/*/capture', route => { captureRoute = route; });
  await page.route('**/api/paypal/orders/*/cancel', route => { cancellations++; return route.continue(); });
  await page.locator('paypal-button').click();
  await expect.poll(() => Boolean(createRoute)).toBe(true);
  await page.evaluate(() => {
    const session = window.sdkSessions[0];
    window.canceling = session.callbacks.onCancel();
    window.approving = session.callbacks.onApprove({});
  });
  await createRoute.continue();
  await expect.poll(() => Boolean(captureRoute)).toBe(true);
  await page.evaluate(() => window.canceling);
  await expect(page.locator('paypal-button')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => document.querySelector('paypal-button').click());
  expect(cancellations).toBe(0); expect(orders()).toHaveLength(1); expect(captures()).toHaveLength(0);
  await captureRoute.continue(); await page.evaluate(() => window.approving);
  expect(captures()).toHaveLength(1); expect(orders()).toHaveLength(1);
  expect(await page.evaluate(() => window.checkoutEvents.results.at(-1).progress.progressCents)).toBe(7500);
  expect(s.outside).toEqual([]); expect(s.pageErrors).toEqual([]);
});
