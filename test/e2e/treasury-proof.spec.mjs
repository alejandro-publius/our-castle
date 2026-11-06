import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { PayPalError } from '../../server/payments/paypal-client.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Actual app + HTTP service + isolated in-memory household and stateful fake PayPal. Captures are explicitly labeled
// fixtures. This never opens the real 3021 household, contacts a provider/model or runs a new real order/capture.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/treasury-proof/', import.meta.url));
let s;
const snapshot = () => JSON.stringify(s.env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, s.env.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
test.afterEach(async ({ page }) => { await page.close(); if (s) { s.server.closeAllConnections(); await new Promise(resolve => s.server.close(resolve)); s.env.db.close(); s = null; } });

async function start(page, { fallback = false, saved = false } = {}) {
  const env = setupDomain({ mode: 'sandbox' }), owner = { householdId: env.householdId, goalId: env.goalId };
  let now = new Date('2026-11-03T12:00:00Z'); env.clock.now = () => now;
  const { orderId } = await env.service.createPayPalOrder(contribution());
  const paid = await env.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
  if (saved) await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
  const modelCalls = [];
  const app = createApp({ root, db: env.db, clock: env.clock, paypal: env.paypal,
    config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }),
    stewardFetch: async () => { modelCalls.push('model'); throw new Error('No model call is allowed'); } });
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  s = { env, owner, orderId, contributionId: paid.contribution.id, server, base, writes: [], outside: [], issues: [], modelCalls, setTime: value => { now = new Date(value); } };
  page.on('pageerror', error => s.issues.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) { s.outside.push(url.href); return route.abort(); }
    if (fallback && url.pathname === '/vendor/ag-grid/ag-grid-community.min.js') return route.abort();
    if (request.method() !== 'GET') s.writes.push(`${request.method()} ${url.pathname}`);
    return route.continue();
  });
  await page.goto(base); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(() => scrollTo(0, 0));
  await noticeFits(page);
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-ledger').click();
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', fallback ? 'fallback' : 'ag-grid');
}
const orderReads = () => s.env.fake.requests.filter(request => request.method === 'GET' && request.pathname.endsWith(s.orderId)).length;
const captures = () => s.env.fake.requests.filter(request => request.pathname.endsWith('/capture')).length;
const refreshes = () => s.writes.filter(write => write.endsWith('/refresh')).length;
async function noticeFits(page) {
  await expect.poll(async () => {
    const rect = await page.locator('.footer').boundingBox();
    return Boolean(rect && rect.y >= 0 && rect.y + rect.height <= page.viewportSize().height && rect.height < page.viewportSize().height / 5);
  }).toBe(true);
}

async function capture(page, name) {
  // A clear on-screen provenance label is inserted into screenshots only; it is not a new product banner.
  await page.evaluate(() => {
    let label = document.getElementById('fixture-label');
    if (!label) { label = document.createElement('p'); label.id = 'fixture-label';
      label.textContent = 'ISOLATED FIXTURE · fake PayPal · no real payment';
      Object.assign(label.style, { position: 'fixed', top: '0', right: '0', maxWidth: '100%', margin: '0', padding: '4px 8px',
        background: '#101c22', color: '#f6eddb', font: '12px Arial', zIndex: '20', pointerEvents: 'none' });
      document.body.append(label); }
  });
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: evidence + name + '.png', fullPage: false });
}

test('one fake $15 receipt visibly rechecks, persists and recovers a missed refund exactly once', async ({ page }, info) => {
  await start(page);
  const grid = page.locator('#ledger-goal'), receipt = page.locator('#ledger-contributions');
  await expect(grid.locator('.record-check')).toHaveCount(0);
  const beforeRead = orderReads(), beforeCapture = captures();
  await expect(receipt).toContainText('$15.00');
  s.setTime('2026-11-04T12:00:00Z');
  await receipt.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
  await expect(receipt.locator('[data-check="match"]')).toBeVisible();
  const line = grid.locator('.record-check');
  await expect(line).toHaveCount(1); await expect(line).toContainText('Last checked with PayPal: Match');
  await expect(line).toContainText('2026');
  expect(orderReads()).toBe(beforeRead + 1); expect(captures()).toBe(beforeCapture);
  expect(await page.evaluate(() => window.__ourCastle.state.progress.progressCents)).toBe(7500);
  await expect(grid.getByRole('columnheader')).toHaveCount(4);
  await grid.scrollIntoViewIfNeeded();
  await noticeFits(page);
  await capture(page, `${info.project.name}-status`);
  // A click on the already-selected row must bring its receipt into view without a new check.
  const writes = s.writes.length; await line.click();
  await expect(receipt.locator('li')).toBeFocused(); expect(s.writes).toHaveLength(writes);
  await noticeFits(page);
  await expect(grid.getByRole('row', { selected: true })).toHaveCount(1);
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-ledger').click();
  await expect(grid.locator('.record-check')).toContainText('Last checked with PayPal: Match');
  expect(orderReads()).toBe(beforeRead + 1); expect(refreshes()).toBe(1);
  await grid.locator('.ag-cell[col-id="entry"]:has(.record-check)').focus();
  await page.keyboard.press('Enter'); await expect(receipt.locator('li')).toBeFocused();
  expect(orderReads()).toBe(beforeRead + 1);
  // PayPal's fake order gains a completed dashboard refund, with no webhook delivered. Only explicit refresh applies it.
  const unit = s.env.fake.orders.get(s.orderId).purchase_units[0], cap = unit.payments.captures[0];
  unit.payments.refunds = [{ id: 'FIXTURE-REFUND', status: 'COMPLETED', amount: { currency_code: 'USD', value: '15.00' },
    links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cap.id}` }] }];
  s.setTime('2026-11-05T12:00:00Z');
  await receipt.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
  await expect(receipt).toContainText('Refunded — progress reversed');
  await expect(grid.locator('.record-check').first()).toContainText('Last checked with PayPal: Refunded');
  expect(await page.evaluate(() => window.__ourCastle.state.progress.progressCents)).toBe(6000);
  expect(s.env.db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind='refund'").get().n).toBe(1);
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.locator('#tab-ledger').click();
  await expect(grid.locator('.record-check').first()).toContainText('Last checked with PayPal: Refunded');
  expect(orderReads()).toBe(beforeRead + 2); expect(refreshes()).toBe(2); expect(captures()).toBe(beforeCapture);
  expect(s.env.db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE kind='refund'").get().n).toBe(1);
  expect(s.outside).toEqual([]); expect(s.modelCalls).toEqual([]); expect(s.issues).toEqual([]);
});

test('a single interaction shows the real local refusal and keeps the one notice visible', async ({ page }, info) => {
  await start(page, { saved: true });
  const before = snapshot(), providerCalls = s.env.fake.requests.length;
  const notice = page.locator('#honesty');
  await expect(notice).toContainText('Adults approve every contribution.');
  await expect(notice).toContainText('The steward only reads; it never spends.');
  await expect(page.locator('.game-notice')).toHaveCount(1);
  await page.locator('#steward-block > summary').click();
  await page.getByRole('button', { name: 'Can you pay or refund?', exact: true }).click();
  const answer = page.locator('#steward-answer');
  await expect(answer).toContainText('I can’t make a payment or refund.');
  await expect(answer).toContainText('PayPal allow-list: get_order, list_transactions only.');
  await expect(answer).not.toContainText('PayPal and ledger match');
  await expect(answer).not.toContainText(/\bnull\b/);
  await answer.locator('summary').click();
  await expect(answer).toContainText('Server policy · no model or PayPal call');
  await answer.scrollIntoViewIfNeeded();
  const rect = await notice.boundingBox(); expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize().height);
  await capture(page, `${info.project.name}-refusal`);
  expect(s.writes).toEqual(['POST /api/steward']); expect(snapshot()).toBe(before);
  expect(s.env.fake.requests).toHaveLength(providerCalls); expect(s.modelCalls).toEqual([]); expect(s.outside).toEqual([]); expect(s.issues).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the fallback table keeps the saved line and one-click keyboard receipt access', async ({ page }) => {
  await start(page, { fallback: true, saved: true });
  const grid = page.locator('#ledger-goal'), receipt = page.locator('#ledger-contributions'), before = snapshot(), providerCalls = s.env.fake.requests.length;
  await expect(grid.locator('.record-check')).toContainText('Last checked with PayPal: Match');
  const open = grid.getByRole('button').filter({ hasText: 'Last checked with PayPal' });
  await open.focus(); await page.keyboard.press('Enter'); await expect(receipt.locator('li')).toBeFocused();
  expect(snapshot()).toBe(before); expect(s.env.fake.requests).toHaveLength(providerCalls); expect(s.writes).toEqual([]);
  expect(s.outside).toEqual([]); expect(s.issues).toEqual([]);
});

test('a failed check clears the prior saved-confirmation answer even when the financial record is unchanged', async ({ page }) => {
  await start(page, { saved: true });
  await page.locator('#steward-block > summary').click();
  await page.getByRole('button', { name: 'Last confirmation', exact: true }).click();
  const answer = page.locator('#steward-answer'), receipt = page.locator('#ledger-contributions');
  await expect(answer.locator('.verification-title')).toHaveText('Saved confirmation');
  const before = s.env.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all();
  const orderBefore = s.env.db.prepare('SELECT * FROM payment_orders').all();
  s.setTime('2026-11-04T12:00:00Z');
  s.env.paypal.getOrder = async () => { throw new PayPalError('Fixture: read unavailable', { status: 500 }); };
  await receipt.getByRole('button', { name: 'Check with PayPal', exact: true }).click();
  await expect(receipt.locator('.last-check[data-check="failed"]')).toBeVisible();
  await expect(page.locator('#ledger-goal .record-check')).toContainText('Last checked with PayPal: Needs check');
  await expect(answer).toBeHidden();
  expect(s.env.db.prepare('SELECT * FROM ledger_entries ORDER BY rowid').all()).toEqual(before);
  expect(s.env.db.prepare('SELECT * FROM payment_orders').all()).toEqual(orderBefore);
  expect(s.env.db.prepare('SELECT count(*) AS n FROM order_checks').get().n).toBe(2);
  expect(s.modelCalls).toEqual([]); expect(s.outside).toEqual([]); expect(s.issues).toEqual([]);
});
