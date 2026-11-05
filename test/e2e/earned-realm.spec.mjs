import { test, expect } from '@playwright/test';

async function start(page, { motion = 'reduce' } = {}) {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto('/'); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.locator('#house-name').fill('House of Rivergate');
  await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded');
}
async function pay(page, pending = false) {
  await page.getByRole('tab', { name: /Contribute/ }).click();
  await page.locator('#give-amount').fill('15.00'); await page.locator('#give-approve').check();
  if (pending) {
    await page.locator('#give-action summary').click();
    await page.getByRole('button', { name: 'Simulate pending', exact: true }).click();
    await expect(page.locator('#give-status')).toContainText('Pending');
  } else await page.getByRole('button', { name: 'Simulate approved payment', exact: true }).click();
}
const state = async (request) => (await request.get('/api/state')).json();
test.beforeEach(async ({ request }) => { expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy(); });

test('a grid record opens one receipt and its earned district; search and keyboard preserve the real total', async ({ page, request }) => {
  await start(page); await pay(page);
  await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  await page.locator('#deed-close').click();
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'ag-grid');
  const s = await state(request), c = s.contributions[0];
  const capture = s.ledger.goalEntries.find((e) => e.kind === 'simulated_contribution');
  const beginning = s.ledger.goalEntries.find((e) => e.kind === 'starting_progress');
  await page.locator(`.ag-row[row-id="${capture.id}"] [col-id="record"]`).click();
  await expect(page.locator('#ledger-contributions > li')).toHaveCount(1);
  await expect(page.locator('#ledger-contributions > li')).toHaveAttribute('data-contribution', c.id);
  await expect(page.locator('#ledger-contributions')).toContainText('After record: $75.00 tracked');
  await page.locator('#ledger-search').fill(c.captures[0].captureId);
  await expect(page.locator('.ag-grid-scrolling-container .ag-row')).toHaveCount(1);
  await expect(page.locator('.ag-row[row-id="total"]')).toContainText('$75.00');
  await page.locator('#ledger-search').fill('');
  const initial = page.locator(`.ag-row[row-id="${beginning.id}"] [col-id="entry"]`);
  await initial.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#ledger-contributions')).toContainText('After record: $60.00 tracked');
  await page.locator(`.ag-row[row-id="${capture.id}"] [col-id="entry"]`).click();
  const before = await state(request), writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(r.method()); });
  await page.getByRole('button', { name: 'Visit Manor Gardens', exact: true }).click();
  expect((await page.evaluate(() => window.__ourCastle.scene())).view.focus).toBe('manor');
  expect(await state(request)).toEqual(before); expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pending records never claim credit; completing and refunding remain explicit actions', async ({ page, request }) => {
  await start(page); await pay(page, true);
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.locator('#ledger-contributions')).toContainText('Pending');
  await expect(page.locator('#ledger-contributions .ledger-impact')).toHaveCount(0);
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  await expect(page.locator('#deed-dialog')).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Simulate PayPal completing it' }).click();
  await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  await page.locator('#deed-close').click();
  await page.getByRole('button', { name: 'Simulate refund', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm refund of $15.00', exact: true }).click();
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  const s = await state(request), refund = s.ledger.goalEntries.find((e) => e.kind === 'simulated_refund');
  await page.locator(`.ag-row[row-id="${refund.id}"] [col-id="entry"]`).click();
  await expect(page.locator('#ledger-contributions')).toContainText('After record: $60.00 tracked');
  await expect(page.locator('#ledger-contributions [data-record-district]')).toHaveCount(0);
});

test('the plain-table fallback supports record search and selection', async ({ page }) => {
  await page.route('**/vendor/ag-grid/**', (route) => route.abort());
  await start(page); await pay(page); await page.locator('#deed-close').click();
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await expect(page.locator('#ledger-goal')).toHaveAttribute('data-grid', 'fallback');
  await page.locator('#ledger-search').fill('Starting');
  await expect(page.locator('#ledger-goal tbody tr')).toHaveCount(2);
  await page.locator('.ledger-record-button').click();
  await expect(page.locator('#ledger-contributions')).toContainText('After record: $60.00 tracked');
  await page.locator('#ledger-search').fill('Simulated');
  await page.locator('.ledger-record-button').click();
  await expect(page.locator('#ledger-contributions')).toContainText('After record: $75.00 tracked');
});

test('one unlock frames the bridge, moves the family, plays the cue and opens one deed afterwards', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'One desktop animation capture; phone behavior is covered with reduced motion.');
  await start(page, { motion: 'no-preference' });
  await page.locator('#world-settings > summary').click(); await page.locator('#sound-toggle').click(); await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__arrival = [];
    for (const type of ['scene:bridge:start', 'scene:bridge:open', 'scene:hop', 'scene:rise', 'scene:arrival'])
      window.__ourCastle.bus.on(type, (detail) => window.__arrival.push({ type, detail, view: window.__ourCastle.scene().view }));
    new MutationObserver(() => { if (document.querySelector('#deed-dialog').open)
      window.__arrival.push({ type: 'deed', animating: window.__ourCastle.scene().animating }); })
      .observe(document.querySelector('#deed-dialog'), { attributes: true, attributeFilter: ['open'] });
  });
  await pay(page); await expect(page.locator('#deed-dialog')).toHaveAttribute('open', '');
  const result = await page.evaluate(() => ({ events: window.__arrival, sound: window.__ourCastle.sound(), scene: window.__ourCastle.scene() }));
  expect(result.events.map((e) => e.type)).toEqual(['scene:bridge:start', 'scene:bridge:open', 'scene:hop', 'scene:rise', 'scene:arrival', 'deed']);
  expect(result.events[0].view.crossing).toBe('manor-bridge');
  expect(result.events.at(-2).view.focus).toBe('manor');
  expect(result.events.at(-1).animating).toBe(false);
  expect(result.sound.played.filter((s) => s === 'bridge')).toHaveLength(1);
  expect(result.sound.played.filter((s) => s === 'fanfare')).toHaveLength(1);
  expect(result.scene.districts).toHaveLength(6);
  await page.locator('#deed-close').click(); await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await expect(page.locator('#deed-dialog')).not.toHaveAttribute('open', '');
});

test('the verification presenter requires proof for the selected order and clears stale results (mocked AI UI)', async ({ page, request }) => {
  await start(page); await pay(page); await page.locator('#deed-close').click();
  const s = await state(request), c = s.contributions[0], orderId = 'MOCKORDER1';
  s.steward = { ...s.steward, available: true, paypalTools: true, model: 'test-only' };
  c.simulated = false; c.provider = 'paypal'; c.providerOrderId = orderId;
  await page.route('**/api/state', (route) => route.fulfill({ json: s }));
  let answer = 0; const focus = [];
  await page.route('**/api/steward', async (route) => {
    focus.push(route.request().postDataJSON().focusOrderId);
    const checked = answer++ > 0;
    await route.fulfill({ json: { status: 'ok', model: 'test-only', answer: 'The payment is complete.', warnings: [],
      paypalTools: true, verification: { orderId, status: checked ? 'verified' : 'unverified' },
      checks: checked ? [{ tool: 'get_order', orderId, source: 'PayPal sandbox via Agent Toolkit', summary: 'Mocked matching order.',
        reconciliation: { verdict: 'match', note: 'PayPal and the ledger agree.' } }]
        : [{ tool: 'read_household_ledger', source: 'Our Castle ledger', summary: 'Ledger only.' }] } });
  });
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.getByRole('tab', { name: /Ledger/ }).click();
  await page.getByRole('button', { name: 'Ask the steward to verify', exact: true }).click();
  await expect(page.locator('.verification-title')).toHaveText('Payment not yet verified');
  await page.getByRole('button', { name: 'Ask the steward to verify', exact: true }).click();
  await expect(page.locator('.verification-title')).toHaveText('PayPal and ledger match');
  expect(focus).toEqual([orderId, orderId]);
  const beginning = s.ledger.goalEntries.find((e) => e.kind === 'starting_progress');
  await page.locator(`.ag-row[row-id="${beginning.id}"] [col-id="entry"]`).click();
  await expect(page.locator('#steward-answer')).toBeHidden();
});
