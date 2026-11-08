import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';
import { accept, createFamily, csrfFetch, familyServer, invite, isLive, openTab, person } from './support/family.mjs';

// The selected receipt says how much of a contribution still counts. Its existing Payment details disclosure lists
// the amounts and the dated saved records behind that sentence. The real app runs with in-memory data and no keys:
// over the fake PayPal sandbox, or the family runner's simulated payments for the live case. Reading a receipt makes
// no request, provider call or write and stores nothing. This is not evidence of a live PayPal result, or of how well
// anyone understands the receipt.
test.use({ reducedMotion: 'reduce' });
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/receipt-breakdown/', import.meta.url));

// Four stories, made through the real payment service over the fake sandbox:
// - $12.00, checked after it counted;
// - $15.00, checked, then PayPal reports a $5.00 refund (a verified webhook);
// - $18.00, refunded in full from the app;
// - $20.00 that PayPal still holds as pending.
// The fixture's clock is moved on between steps, so each saved record has its own time, as it would in real use.
async function storiesApp() {
  const domain = setupDomain({ mode: 'sandbox' });
  const owner = { householdId: domain.householdId, goalId: domain.goalId };
  const { service } = domain;
  let now = Date.parse('2026-11-03T12:00:00'); // local noon, as the fixture's own clock
  domain.clock.now = () => new Date(now);
  const later = (minutes) => { now += minutes * 60_000; };
  const pay = async (amountCents) => {
    later(1);
    const { orderId } = await service.createPayPalOrder(contribution({ amountCents }));
    later(2); // the adult approves in PayPal; the capture is recorded a little later
    const res = await service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
    return { orderId, captureId: res.contribution.captures[0]?.captureId ?? null };
  };
  const completed = await pay(1200);
  later(5);
  await service.refreshPayPalOrder({ providerOrderId: completed.orderId, ...owner });
  const partial = await pay(1500);
  later(5);
  await service.refreshPayPalOrder({ providerOrderId: partial.orderId, ...owner });
  later(20);
  const refunded = await service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify({ id: 'WH-RECEIPT-PARTIAL', event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: { id: 'REFUNDPARTIAL05TEST', status: 'COMPLETED', amount: { currency_code: 'USD', value: '5.00' },
      links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${partial.captureId}` }] } }) });
  expect(refunded.outcome).toBe('refunded');
  const full = await pay(1800);
  later(10);
  await service.refundPayPalCapture({ captureId: full.captureId, householdId: owner.householdId, approverId: 'm_rowan', approvalConfirmed: true });
  domain.fake.behavior.captureStatus = 'PENDING';
  const pending = await pay(2000);
  domain.fake.behavior.captureStatus = 'COMPLETED';
  later(30);

  const app = createApp({ root, db: domain.db, clock: domain.clock, paypal: domain.paypal, config: loadConfig({ PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' }, { root }) });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    domain, base: `http://127.0.0.1:${server.address().port}`, orders: { completed, partial, full, pending },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

// Every request the page makes, and its errors. Anything outside the app is refused.
async function watch(page, base) {
  const requests = [], outside = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== base) { outside.push(`${r.method()} ${r.url()}`); return route.abort(); }
    requests.push(`${r.method()} ${url.pathname}`);
    return route.continue();
  });
  return { requests, outside, errors, writes: () => requests.filter((r) => !r.startsWith('GET ')) };
}
const storage = (page) => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage).sort()]));
const card = (page) => page.locator('#ledger-contributions [data-contribution]');

async function openLedger(page) {
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator('#tab-ledger').click();
  await expect(page.locator('#panel-ledger')).toBeVisible();
}
// Choose a story's receipt as a family would: search for its PayPal order, then pick its record.
async function selectStory(page, orderId, text) {
  await page.locator('#ledger-search').fill(orderId);
  await page.locator('#ledger-goal').getByText(text, { exact: false }).first().click();
  await expect(card(page)).toBeVisible();
}

test('each receipt says how much still counts, Payment details show the amounts and dated records, and reading changes nothing', { tag: '@release' }, async ({ page }, info) => {
  const s = await storiesApp();
  const seen = await watch(page, s.base);
  const providerRequests = s.domain.fake.requests.length;
  const db = s.domain.db;
  const at = (sql, ...args) => db.prepare(sql).get(...args).at;
  mkdirSync(evidence, { recursive: true });
  const shot = async (name) => { await card(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}${info.project.name}-${name}.png` }); };
  try {
    await page.goto(s.base);
    await openLedger(page);
    const stored = await storage(page);
    const requestsBefore = seen.requests.length;
    const counts = card(page).locator('.counts');
    const details = card(page).locator('.record-ids');
    const amounts = () => details.locator('.breakdown dd');

    // 1. $15.00 recorded and $5.00 refunded: $10.00 counts. The match saved before the refund stays an earlier result.
    await selectStory(page, s.orders.partial.orderId, 'PayPal sandbox contribution');
    await expect(counts).toHaveText('$10.00 of this contribution counts toward the goal.');
    await expect(counts).toHaveAttribute('data-counts', 'partial');
    await expect(card(page).locator('.last-check .verdict')).toHaveText('Checked before the refund');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.locator('.breakdown dt')).toHaveText(['Recorded contribution', 'Completed refunds', 'Counts toward the goal']);
    await expect(amounts()).toHaveText(['$15.00', '−$5.00', '$10.00']);
    const lines = details.locator('.story li');
    await expect(lines).toHaveText([/ · Order recorded · approved by Rowan$/, / · \$15\.00 counted toward the goal$/,
      / · Saved PayPal check, before the later refund: PayPal and the ledger agree\.$/, / · \$5\.00 refund recorded and subtracted$/]);
    // Each line carries the time of its own saved record: the order, the two ledger rows and the saved check.
    const order = db.prepare('SELECT id, created_at AS at FROM payment_orders WHERE provider_order_id = ?').get(s.orders.partial.orderId);
    expect(await lines.locator('time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime')))).toEqual([
      order.at,
      at('SELECT created_at AS at FROM ledger_entries WHERE source_ref = ?', `paypal-capture:${s.orders.partial.captureId}`),
      at('SELECT checked_at AS at FROM order_checks WHERE order_id = ? ORDER BY id DESC LIMIT 1', order.id),
      at('SELECT created_at AS at FROM ledger_entries WHERE source_ref = ?', 'paypal-refund:REFUNDPARTIAL05TEST'),
    ]);
    await shot('partial-refund');

    // 2. $18.00 refunded in full: none of it counts.
    await selectStory(page, s.orders.full.orderId, 'PayPal sandbox contribution');
    await expect(counts).toHaveText('All $18.00 was refunded, so none of this contribution counts toward the goal.');
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(amounts()).toHaveText(['$18.00', '−$18.00', '$0.00']);

    // 3. $12.00 completed and checked afterwards: all of it counts; the check is not qualified.
    await selectStory(page, s.orders.completed.orderId, 'PayPal sandbox contribution');
    await expect(counts).toHaveText('$12.00 of this contribution counts toward the goal.');
    await expect(card(page).locator('.last-check .verdict')).toHaveText('Checked · matches PayPal');
    await details.locator('summary').click();
    await expect(amounts()).toHaveText(['$12.00', 'None', '$12.00']);
    await expect(details.locator('.story li')).toHaveText([/Order recorded/, /\$12\.00 counted toward the goal$/, / · Saved PayPal check: PayPal and the ledger agree\.$/]);
    await shot('completed');

    // 4. $20.00 still pending: nothing counts yet, and there is no breakdown or timeline to invent.
    await selectStory(page, s.orders.pending.orderId, 'Pending');
    await expect(counts).toHaveText('No contribution has been counted yet.');
    await expect(counts).toHaveAttribute('data-counts', 'none');
    await details.locator('summary').click();
    await expect(details.locator('.breakdown, .story')).toHaveCount(0);
    await expect(details.locator('.ids')).toContainText(s.orders.pending.orderId);
    await shot('pending');

    // Choosing and opening four receipts made no request, provider call, write or stored preference.
    expect(seen.requests.slice(requestsBefore)).toEqual([]);
    expect(s.domain.fake.requests.length).toBe(providerRequests);
    expect(await storage(page)).toBe(stored);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // After a reload the same records tell the same story, and Payment details start closed.
    await page.reload();
    await openLedger(page);
    await selectStory(page, s.orders.partial.orderId, 'PayPal sandbox contribution');
    await expect(counts).toHaveText('$10.00 of this contribution counts toward the goal.');
    await expect(details).not.toHaveAttribute('open', '');
    expect(seen.writes()).toEqual([]);
    expect(seen.outside).toEqual([]);
    expect(seen.errors).toEqual([]);
    expect(s.domain.fake.requests.length).toBe(providerRequests);
  } finally {
    await s.close();
  }
});

// Both optional scripts go unanswered until `release()`, as a request that never settles would.
async function holdBundles(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  for (const path of ['**/vendor/ag-grid/ag-grid-community.min.js', '**/vendor/ag-studio/ag-studio.min.js'])
    await page.route(path, async (route) => { await gate; await route.continue().catch(() => {}); });
  return release;
}

test('when the Grid and Studio scripts never answer, the plain table opens the same receipt story', { tag: '@release' }, async ({ page }) => {
  const s = await storiesApp();
  const seen = await watch(page, s.base);
  // Held from the start: a founded house with records can open on the Ledger, which asks for the Grid at once.
  const release = await holdBundles(page);
  try {
    await page.goto(s.base);
    await openLedger(page);
    // The existing plain table takes over when the Grid's own load wait (ledger-grid.js) runs out.
    await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback', { timeout: 20_000 });
    await page.locator('#ledger-search').fill(s.orders.partial.orderId);
    await page.locator('#ledger-goal .ledger-record-button', { hasText: 'PayPal sandbox contribution' }).click();
    const details = card(page).locator('.record-ids');
    await expect(card(page).locator('.counts')).toHaveText('$10.00 of this contribution counts toward the goal.');
    await details.locator('summary').click();
    await expect(details.locator('.breakdown dd')).toHaveText(['$15.00', '−$5.00', '$10.00']);
    // The scripts arrive late: nothing is mounted over the table, and the open receipt is left as it was.
    release();
    await page.waitForFunction(() => window.agGrid && window.agStudio);
    await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback');
    await expect(details).toHaveAttribute('open', '');
    await expect(card(page).locator('.counts')).toHaveText('$10.00 of this contribution counts toward the goal.');
    expect(seen.writes()).toEqual([]);
    expect(seen.outside).toEqual([]);
    expect(seen.errors).toEqual([]);
  } finally {
    await s.close();
  }
});

test('the Contribute receipt and the Ledger receipt say the same thing, before and after a refund', { tag: '@release' }, async ({ page }) => {
  // Example mode: a simulated contribution and refund, made with the family's own buttons.
  const domain = setupDomain({ mode: 'example' });
  const app = createApp({ root, db: domain.db, clock: domain.clock, config: loadConfig({}, { root }) });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seen = await watch(page, base);
  await page.addLocatorHandler(page.locator('#deed-dialog[open]'), async () => { await page.locator('#deed-close').click(); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
    await page.locator('#tab-give').click();
    await page.locator('#give-amount').fill('15.00');
    await page.locator('#give-approve').check();
    await page.getByRole('button', { name: 'Simulate approved payment' }).click();
    const contributeReceipt = page.locator('#receipt .counts');
    await expect(contributeReceipt).toHaveText('$15.00 of this contribution counts toward the goal.');
    await page.locator('#tab-ledger').click();
    const counts = card(page).locator('.counts');
    await expect(counts).toHaveText('$15.00 of this contribution counts toward the goal.');
    await card(page).getByRole('button', { name: 'Simulate refund' }).click();
    await card(page).getByRole('button', { name: 'Confirm refund of $15.00' }).click();
    const refunded = 'All $15.00 was refunded, so none of this contribution counts toward the goal.';
    await expect(counts).toHaveText(refunded);
    await card(page).locator('.record-ids summary').click();
    await expect(card(page).locator('.breakdown dd')).toHaveText(['$15.00', '−$15.00', '$0.00']);
    await expect(card(page).locator('.story li').first()).toHaveText(/ · Simulated order recorded · approved by Rowan$/);
    await page.locator('#tab-give').click();
    await expect(contributeReceipt).toHaveText(refunded);
    // The only writes are the two the family asked for.
    expect(seen.writes()).toEqual(['POST /api/example/contributions', expect.stringMatching(/^POST \/api\/example\/captures\/SIM-CAPTURE-[A-Z0-9]+\/refund$/)]);
    expect(seen.outside).toEqual([]);
    expect(seen.errors).toEqual([]);
  } finally {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  }
});

test('a refund made by another adult updates the open receipt live, keeping Payment details open and focused', { tag: '@release' }, async ({ browser }, info) => {
  const s = await familyServer({ live: { recheckMs: 1_000 } });
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan', { origin: s.origin }); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    expect((await csrfFetch(owner.page, 'POST', '/api/setup', { name: 'House of Rowan', crest: { field: 'cobalt', charge: 'stag' } })).status).toBe(200);
    const ash = await person(browser, info, 'Ash', { origin: s.origin }); people.push(ash);
    await accept(ash, await invite(owner, 'Ash', 'adult'));
    for (const p of people) await isLive(p.page);
    const paid = await csrfFetch(owner.page, 'POST', '/api/example/contributions', { amountCents: 1500, approvalConfirmed: true, requestId: 'receipt-live-0001', outcome: 'completed' });
    expect(paid.status).toBe(200);
    const captureId = paid.body.contribution.captures[0].captureId;
    const { page } = owner;
    await expect.poll(() => page.evaluate(() => window.__ourCastle.state.contributions.length)).toBe(1);
    await openTab(page, 'ledger');
    await page.locator('#ledger-goal').getByText('Simulated contribution', { exact: false }).first().click();
    const counts = card(page).locator('.counts');
    const details = card(page).locator('.record-ids');
    await expect(counts).toHaveText('$15.00 of this contribution counts toward the goal.');
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('summary')).toBeFocused();
    await page.evaluate(() => { window.__sameDocument = true; });
    const refreshes = await page.evaluate(() => window.__ourCastle.family().refreshes);
    const writes = [];
    page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });

    // Ash refunds it from another browser. The owner's open receipt follows, in the same document.
    const undo = await csrfFetch(ash.page, 'POST', `/api/example/captures/${captureId}/refund`, { approvalConfirmed: true });
    expect([undo.status, undo.body.outcome]).toEqual([200, 'refunded']);
    await expect(counts).toHaveText('All $15.00 was refunded, so none of this contribution counts toward the goal.');
    expect(await page.evaluate(() => window.__ourCastle.family().refreshes)).toBeGreaterThan(refreshes);
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('summary')).toBeFocused();
    await expect(details.locator('.breakdown dd')).toHaveText(['$15.00', '−$15.00', '$0.00']);
    await expect(details.locator('.story li').last()).toHaveText(/ · \$15\.00 refund recorded and subtracted$/);
    expect(writes).toEqual([]);
    for (const p of people) { expect(p.errors).toEqual([]); expect(p.outside).toEqual([]); }
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
