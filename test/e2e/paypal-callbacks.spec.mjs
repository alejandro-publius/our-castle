import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Actual checkout wrapper + HTTP routes + stateful fake sandbox. The SDK loader is a scripted stand-in; this is
// callback-race evidence, never evidence of a PayPal popup, browser approval or new live payment.
const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
let s;
test.afterEach(async ({ page }) => {
  await page.close();
  if (s) { s.server.closeAllConnections(); await new Promise(r => s.server.close(r)); s.env.db.close(); s = null; }
});
async function mount(page, pending = false) {
  const env = setupDomain({ mode: 'sandbox', paypalOptions: pending ? { captureStatus: 'PENDING' } : {} });
  const app = createApp({ root, db: env.db, clock: env.clock, paypal: env.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  s = { env, app, server, base, outside: [], errors: [], writes: [] };
  page.on('pageerror', e => s.errors.push(e.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base && url.pathname === '/__checkout_diagnostic__') return route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><style>paypal-button{display:inline-block;width:190px;height:44px}</style><div id="checkout"></div>' });
    if (request.url() === 'https://www.sandbox.paypal.com/web-sdk/v6/core') return route.fulfill({ contentType: 'text/javascript', body: `
      window.paypal = { async createInstance() { return {
        async findEligibleMethods() { return { isEligible: () => true }; },
        createPayPalOneTimePaymentSession(callbacks) {
          window.sdkCallbacks = callbacks;
          return { async start(_options, order) { window.sdkOrder = await order; } };
        }
      }; } };` });
    if (url.origin !== base) { s.outside.push(request.url()); return route.abort(); }
    if (request.method() !== 'GET') s.writes.push(`${request.method()} ${url.pathname}`);
    return route.continue();
  });
  await page.goto(`${base}/__checkout_diagnostic__`);
  await page.evaluate(async ({ input, owner }) => {
    window.callbacksObserved = { results: [], statuses: [] };
    const { mountPayPalButton } = await import('/src/app/paypal-checkout.js');
    const control = await mountPayPalButton(document.getElementById('checkout'), { getOrderInput: () => input, getOwnership: () => owner,
      onResult: result => window.callbacksObserved.results.push(result),
      onStatus: status => window.callbacksObserved.statuses.push(status) });
    control.setEnabled(true); // the fixture's amount-specific adult approval, as in the actual app
  }, { input: contribution(), owner: { householdId: env.householdId, goalId: env.goalId } });
  await page.locator('paypal-button').click();
  await expect.poll(() => page.evaluate(() => window.sdkOrder?.orderId)).toBeTruthy();
  await page.evaluate(() => window.sdkCallbacks.onApprove({ orderId: window.sdkOrder.orderId }));
}
const observed = page => page.evaluate(() => window.callbacksObserved);
const captureCalls = () => s.env.fake.requests.filter(r => r.pathname.endsWith('/capture')).length;

for (const pending of [false, true]) test(`a late SDK cancel preserves the ${pending ? 'pending' : 'completed'} server receipt without an uncharged claim`, async ({ page }) => {
  await mount(page, pending);
  const before = snapshot(s.env.db), previous = await observed(page), calls = s.env.fake.requests.length;
  await page.evaluate(() => window.sdkCallbacks.onCancel());
  const current = await observed(page), last = current.results.at(-1);
  expect(last.outcome).toBe(pending ? 'pending' : 'already_completed');
  expect(last.contribution.status).toBe(pending ? 'pending' : 'completed');
  expect(last.progress.progressCents).toBe(pending ? 6000 : 7500);
  expect(current.statuses).toEqual(previous.statuses); // the wrapper leaves the canonical receipt result in charge
  expect(snapshot(s.env.db)).toBe(before); expect(s.env.fake.requests).toHaveLength(calls);
  expect(captureCalls()).toBe(1); expect(s.errors).toEqual([]); expect(s.outside).toEqual([]);
});

test('an SDK error after a server-confirmed capture cannot claim that no progress was recorded', async ({ page }) => {
  await mount(page);
  const before = snapshot(s.env.db), calls = s.env.fake.requests.length, writes = s.writes.length;
  await page.evaluate(() => window.sdkCallbacks.onError(new Error('Fixture: SDK closes after capture')));
  const current = await observed(page);
  expect(current.statuses.at(-1).message).toMatch(/check.*(record|status|receipt)/i);
  expect(current.statuses.at(-1).message).not.toMatch(/no progress|nothing was charged|not charged/i);
  expect(current.results.at(-1).progress.progressCents).toBe(7500);
  expect(snapshot(s.env.db)).toBe(before); expect(s.env.fake.requests).toHaveLength(calls);
  expect(s.writes).toHaveLength(writes); expect(captureCalls()).toBe(1);
  expect(s.errors).toEqual([]); expect(s.outside).toEqual([]);
});
