import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Actual server, saved fake-sandbox check and Studio framework. The question is answered locally even when AI and
// PayPal tools are configured. All provider transports are blocked; this is not a new real payment or AI result.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const rows = db => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

test('Last confirmation reads saved history through the existing steward and makes no provider call or write', async ({ page }, info) => {
  const domain = setupDomain({ mode: 'sandbox' });
  const { orderId } = await domain.service.createPayPalOrder(contribution());
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  await domain.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  await domain.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const calls = [], writes = [], issues = [];
  const forbidden = name => async () => { calls.push(name); throw new Error('Unexpected provider call: ' + name); };
  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal: domain.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }),
    stewardAi: { apiKey: 'fake-unused-key', model: 'claude-opus-5-5' },
    paypalTools: { getOrder: forbidden('get_order'), listTransactions: forbidden('list_transactions') },
    stewardFetch: async () => { calls.push('model'); return new Response('{}', { status: 401 }); } });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, before = rows(domain.db), providerReads = domain.fake.requests.length;
  page.on('pageerror', error => issues.push(error.message));
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url());
    if (url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core') return route.fulfill({ status: 503, body: 'Checkout disabled in this fixture.' });
    if (url.origin !== base) { issues.push(r.method() + ' ' + r.url()); return route.abort(); }
    if (r.method() !== 'GET') writes.push(r.method() + ' ' + url.pathname);
    return route.continue();
  });
  async function ask() {
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-ledger').click();
    await page.locator('#ledger-goal').getByText('PayPal sandbox contribution', { exact: false }).first().click();
    await page.locator('#steward-block > summary').click();
    await page.getByRole('button', { name: 'Last confirmation', exact: true }).click();
    await expect(page.locator('#steward-answer')).toContainText('A saved check confirmed this contribution at');
    await expect(page.locator('#steward-answer')).toContainText('UTC. No new PayPal check was made.');
    await expect(page.locator('#steward-answer .verification-title')).toHaveText('Saved confirmation');
    await expect(page.locator('#steward-answer .verification-title')).not.toHaveClass(/verified/);
    await page.locator('#steward-answer summary').click();
    await expect(page.locator('#steward-answer')).toContainText('Saved household record · read-only');
    await expect(page.locator('#steward-answer')).not.toContainText('PayPal Agent Toolkit');
    await expect.poll(() => page.evaluate(() => window.__ourCastle.treasury().agent)).toMatchObject({ source: 'ag-studio-agent-framework', state: 'idle', threads: 0 });
  }
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await ask();
    await page.locator('#steward-answer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('saved-confirmation.png') });
    expect(writes).toEqual(['POST /api/steward']);
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    expect(writes).toEqual(['POST /api/steward'], 'reload never asks the steward');
    await ask();
    expect(writes).toEqual(['POST /api/steward', 'POST /api/steward']);
    expect(calls).toEqual([]);
    expect(domain.fake.requests.length).toBe(providerReads);
    expect(rows(domain.db)).toBe(before);
    expect(issues).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); domain.db.close();
  }
});
