import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Fresh fake sandbox only. No checkout, real PayPal/AI call, licence or owner records.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));

test('a completed receipt can pick up a dashboard refund without a webhook or AI call', async ({ page }) => {
  const domain = setupDomain({ mode: 'sandbox' });
  const { orderId } = await domain.service.createPayPalOrder(contribution());
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  const paid = await domain.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  const captureId = paid.contribution.captures[0].captureId;
  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal: domain.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, writes = [], issues = [];
  page.on('pageerror', error => issues.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core')
      return route.fulfill({ status: 503, body: 'Checkout disabled in this fake receipt fixture.' });
    if (url.origin !== base) { issues.push(request.method() + ' ' + request.url()); return route.abort(); }
    if (request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname);
    return route.continue();
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-ledger').click();
    await page.locator('#ledger-goal').getByText('PayPal sandbox contribution', { exact: false }).first().click();
    const receipt = page.locator('#ledger-contributions');
    await expect(receipt).toContainText('Completed — counted');
    await expect(receipt.getByRole('button', { name: 'Check with PayPal', exact: true })).toBeVisible();

    // The provider refunded it elsewhere; this server received no webhook.
    const unit = domain.fake.orders.get(orderId).purchase_units[0];
    unit.payments.captures[0].status = 'REFUNDED';
    unit.payments.refunds = [{ id: 'DASHBOARDREFUND001', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' },
      links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] }];
    await receipt.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__ourCastle.state.progress.progressCents)).toBe(6000);
    expect(await page.evaluate(() => window.__ourCastle.state.rewards.realm.districts.find(d => d.id === 'manor').open)).toBe(true);
    expect(domain.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE kind = 'refund'").get().n).toBe(1);
    expect(domain.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n).toBe(0);
    expect(domain.fake.requests.filter(r => r.method === 'POST' && /\/capture$/.test(r.pathname))).toHaveLength(1);
    expect(writes).toEqual([`POST /api/paypal/orders/${orderId}/refresh`]);
    expect(issues).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); domain.db.close();
  }
});
