import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { createPayPalClient, PayPalError } from '../../server/payments/paypal-client.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Saved-check status on Treasury records and the selected receipt, the local "Needs a check?" question and the
// placement of the existing "Check with PayPal" action. Real app over the fake sandbox with no AI key: no provider,
// no checkout, no owner data. Nothing here is evidence of a live PayPal result.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/treasury-status/', import.meta.url));

test('records and receipts show their saved-check status; the local question names the receipts; checks run only on request', async ({ page }, info) => {
  const domain = setupDomain({ mode: 'sandbox' });
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  // The same fake sandbox, with order reads that fail while `failing` is set, so a saved failed check is produced the real way.
  let failing = false;
  const fetch = (url, init) => (failing && /\/v2\/checkout\/orders\/[^/]+$/.test(new URL(url).pathname)
    ? new Response(JSON.stringify({ name: 'INTERNAL_SERVICE_ERROR', debug_id: 'dbg-500' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    : domain.fake.fetch(url, init));
  const paypal = createPayPalClient({ clientId: 'test-client-id', clientSecret: 'test-client-secret', fetch });
  const service = createContributionService({ db: domain.db, clock: domain.clock, mode: 'sandbox', paypal, webhookId: 'WH-TEST' });
  const pay = async (amountCents) => {
    const { orderId } = await service.createPayPalOrder(contribution({ amountCents }));
    const res = await service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
    return { orderId, id: res.contribution.id };
  };
  const matched = await pay(1500);
  await service.refreshPayPalOrder({ providerOrderId: matched.orderId, ...owner });
  domain.fake.behavior.captureStatus = 'PENDING';
  const pending = await pay(2000);
  domain.fake.behavior.captureStatus = 'COMPLETED';
  const failed = await pay(2500);
  await service.refreshPayPalOrder({ providerOrderId: failed.orderId, ...owner });
  failing = true;
  await expect(service.refreshPayPalOrder({ providerOrderId: failed.orderId, ...owner })).rejects.toMatchObject({ code: 'paypal_error' });
  failing = false;
  const unchecked = await pay(3000);

  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal, config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, writes = [], issues = [];
  const orderReads = () => domain.fake.requests.filter((r) => r.method === 'GET' && /\/v2\/checkout\/orders\/[^/]+$/.test(r.pathname)).length;
  page.on('pageerror', (error) => issues.push(error.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core') return route.fulfill({ status: 503, body: 'Checkout disabled in this fixture.' });
    if (url.origin !== base) { issues.push(`${r.method()} ${r.url()}`); return route.abort(); }
    if (r.method() !== 'GET') writes.push(`${r.method()} ${url.pathname}`);
    return route.continue();
  });
  const grid = page.locator('#ledger-goal'), receipt = page.locator('#ledger-contributions'), answer = page.locator('#steward-answer');
  const checkButtons = () => receipt.getByRole('button', { name: 'Check with PayPal', exact: true });
  async function openLedger() {
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-ledger').click();
    await expect(grid).toContainText('PayPal sandbox · checked, matches');
  }
  async function selectFailed() {
    await page.locator('#ledger-search').fill('check failed');
    await grid.getByText('check failed', { exact: false }).first().click();
    await expect(receipt.locator('[data-check="failed"]')).toBeVisible();
  }
  mkdirSync(evidence, { recursive: true });
  const readsAtStart = orderReads();
  try {
    await page.goto(base);
    await openLedger();

    // 1. Every PayPal record carries its compact status in the grid; a pending match never reads as completed.
    for (const text of ['PayPal sandbox · checked, matches', 'PayPal sandbox · pending, not checked', 'PayPal sandbox · check failed', 'PayPal sandbox · no saved check']) {
      await expect(grid).toContainText(text);
    }
    await selectFailed();
    const failedLine = receipt.locator('.last-check');
    await expect(failedLine.locator('.verdict')).toHaveText('Check failed · PayPal did not answer');
    await expect(failedLine).toContainText('PayPal did not answer this check. Nothing was changed.');
    // 3. The existing action sits on the status line of an affected receipt, exactly once.
    await expect(failedLine.getByRole('button', { name: 'Check with PayPal', exact: true })).toBeVisible();
    await expect(checkButtons()).toHaveCount(1);
    await page.screenshot({ path: `${evidence}${info.project.name}-receipt-failed.png`, fullPage: false });

    await page.locator('#ledger-search').fill('no saved check');
    await grid.getByText('no saved check', { exact: false }).first().click();
    await expect(receipt.locator('[data-check="unchecked"] .verdict')).toHaveText('No saved check');
    await expect(receipt.locator('.last-check').getByRole('button')).toHaveCount(0, { timeout: 2000 });
    await expect(receipt.locator('.actions').getByRole('button', { name: 'Check with PayPal', exact: true })).toBeVisible();
    await page.locator('#ledger-search').fill('pending, not checked');
    await grid.getByText('pending, not checked', { exact: false }).first().click();
    await expect(receipt.locator('[data-check="pending"] .verdict')).toHaveText('Pending · not checked yet');
    await expect(receipt.locator('[data-check="pending"]').getByRole('button', { name: 'Check with PayPal', exact: true })).toBeVisible();
    await page.locator('#ledger-search').fill('');
    expect(writes).toEqual([]);
    expect(orderReads()).toBe(readsAtStart);

    // 2. The local question lists what needs a check, with a link to each receipt, and asks PayPal nothing.
    await page.locator('#steward-block > summary').click();
    await page.getByRole('button', { name: 'Needs a check?', exact: true }).click();
    await expect(answer.locator('.verification-title')).toHaveText('PayPal checks');
    await expect(answer).toContainText('2 contributions need a PayPal check: $25.00 (the last check did not get an answer from PayPal); $20.00 (pending in PayPal). Open the receipt and use Check with PayPal.');
    await expect(answer).toContainText('1 contribution has no saved check. This reads saved records only; no new PayPal check was made.');
    const links = answer.locator('.receipt-links button');
    await expect(links).toHaveText(['Open receipt · $25.00 · Check failed · PayPal did not answer', 'Open receipt · $20.00 · Pending · not checked yet', 'Open receipt · $30.00 · No saved check']);
    await expect(answer).not.toContainText(/toolkit|get_order|webhook/i);
    await answer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}${info.project.name}-needs-check.png`, fullPage: false });
    expect(writes).toEqual(['POST /api/steward']);
    expect(orderReads()).toBe(readsAtStart);

    await links.first().click();
    await expect(receipt.locator('[data-check="failed"]')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-contribution'))).toBe(failed.id);
    expect(writes).toEqual(['POST /api/steward'], 'opening a receipt checks nothing');

    // Reload: the saved statuses are read back from the server record, with no PayPal call.
    await page.reload();
    await openLedger();
    await expect(grid).toContainText('PayPal sandbox · check failed');
    await selectFailed();
    expect(writes).toEqual(['POST /api/steward']);
    expect(orderReads()).toBe(readsAtStart);

    // Only the button runs the check. The failed record then reads as matched, and the failure stays in its history.
    await failedLine.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
    await expect(receipt.locator('[data-check="match"] .verdict')).toHaveText('Checked · matches PayPal');
    await expect(receipt.locator('.last-check').getByRole('button')).toHaveCount(0, { timeout: 2000 });
    await expect(checkButtons()).toHaveCount(1);
    await receipt.locator('.record-ids summary').click();
    await expect(receipt.locator('.check-history')).toContainText('PayPal did not answer this check');
    expect(writes).toEqual(['POST /api/steward', `POST /api/paypal/orders/${failed.orderId}/refresh`]);
    expect(orderReads()).toBe(readsAtStart + 1);
    expect(domain.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n).toBe(4, 'one starting entry and three credits, unchanged');

    expect(issues).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect([matched.id, pending.id, unchecked.id].every(Boolean)).toBe(true);
  } finally {
    await page.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); domain.db.close();
  }
});

test('a failed saved check on an unpaid order exposes one read-only recovery action', async ({ page }) => {
  const domain = setupDomain({ mode: 'sandbox' });
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  const { orderId } = await domain.service.createPayPalOrder(contribution());
  const getOrder = domain.paypal.getOrder;
  domain.paypal.getOrder = async () => { throw new PayPalError('Fixture offline', { status: 500 }); };
  await expect(domain.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner })).rejects.toMatchObject({ code: 'paypal_error' });
  domain.paypal.getOrder = getOrder;
  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal: domain.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, writes = [], outside = [];
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url());
    if (url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core') return route.fulfill({ status: 503, body: 'No checkout in this fixture.' });
    if (url.origin !== base) { outside.push(r.url()); return route.abort(); }
    if (r.method() !== 'GET') writes.push(`${r.method()} ${url.pathname}`);
    return route.continue();
  });
  const reads = () => domain.fake.requests.filter(r => r.method === 'GET' && r.pathname.endsWith(orderId)).length;
  const before = reads();
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-ledger').click();
    await page.locator('#ledger-goal').getByText('check failed', { exact: false }).first().click();
    const receipt = page.locator('#ledger-contributions');
    const button = receipt.getByRole('button', { name: 'Check with PayPal', exact: true });
    await expect(receipt.locator('[data-check="failed"]')).toBeVisible();
    await expect(button).toHaveCount(1);
    expect(reads()).toBe(before);
    expect(writes).toEqual([]);
    await button.click();
    await expect(receipt.locator('[data-check="uncaptured"]')).toContainText('Checked · not paid yet');
    await expect(button).toHaveCount(0);
    expect(reads()).toBe(before + 1);
    expect(writes).toEqual([`POST /api/paypal/orders/${orderId}/refresh`]);
    expect(domain.fake.requests.filter(r => /\/capture$/.test(r.pathname))).toHaveLength(0);
    expect(domain.db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n).toBe(1);
    expect(await page.evaluate(() => window.__ourCastle.state.progress.progressCents)).toBe(6000);
    expect(outside).toEqual([]);
  } finally {
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); domain.db.close();
  }
});


test('a failed check clears an older saved-confirmation answer without changing financial records', { tag: '@release' }, async ({ page }) => {
  const domain = setupDomain({ mode: 'sandbox' });
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  let now = new Date('2026-11-03T12:00:00Z');
  domain.clock.now = () => now;
  const { orderId } = await domain.service.createPayPalOrder(contribution());
  await domain.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  await domain.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const modelCalls = [];
  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal: domain.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }),
    stewardFetch: async () => { modelCalls.push('model'); throw new Error('No model call allowed'); } });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, outside = [], issues = [], writes = [];
  page.on('pageerror', error => issues.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { outside.push(url.href); return route.abort(); }
    if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
    return route.continue();
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-ledger').click();
    const receipt = page.locator('#ledger-contributions'), answer = page.locator('#steward-answer');
    await expect(receipt.locator('[data-check="match"]')).toBeVisible();
    await page.locator('#steward-block > summary').click();
    await page.getByRole('button', { name: 'Last confirmation', exact: true }).click();
    await expect(answer.locator('.verification-title')).toHaveText('Saved confirmation');
    const ledgerBefore = domain.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all();
    const ordersBefore = domain.db.prepare('SELECT * FROM payment_orders ORDER BY rowid').all();
    now = new Date('2026-11-04T12:00:00Z');
    let failedReads = 0;
    domain.paypal.getOrder = async () => { failedReads++; throw new PayPalError('Fixture read unavailable', { status: 500 }); };
    await receipt.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
    await expect(receipt.locator('[data-check="failed"]')).toBeVisible();
    expect(domain.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all()).toEqual(ledgerBefore);
    expect(domain.db.prepare('SELECT * FROM payment_orders ORDER BY rowid').all()).toEqual(ordersBefore);
    expect(domain.db.prepare('SELECT count(*) AS n FROM order_checks').get().n).toBe(2);
    expect(failedReads).toBe(1);
    expect(writes).toEqual(['POST /api/steward', `POST /api/paypal/orders/${orderId}/refresh`]);
    expect(modelCalls).toEqual([]);
    expect(outside).toEqual([]);
    expect(issues).toEqual([]);
    await expect(answer).toBeHidden();
  } finally {
    await page.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); domain.db.close();
  }
});
