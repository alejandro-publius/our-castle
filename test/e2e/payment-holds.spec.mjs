import { test, expect } from '@playwright/test';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// Example mode, through the real server and page: a simulated hold. This shows the page and the server rules for a held
// contribution. It does not show a PayPal sandbox authorization, capture or void.
const read = async (request) => (await request.get('/api/state')).json();
const holds = (state) => state.contributions.filter((c) => c.hold).map((c) => [c.amountCents, c.status, c.hold.status, c.hold.releaseCents]);

test('a held contribution counts nothing until an adult releases part of it; another is returned; a child decides neither', { tag: '@release' }, async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'The same controls on both layouts; the phone release selection is close to its time budget.');
  test.setTimeout(150_000);
  await request.post('/api/demo/reset', { data: {} });
  expect((await request.post('/api/setup', { data: { playMode: 'family', name: 'House of Fernhill', crest: { field: 'violet', charge: 'tower' } } })).status()).toBe(200);
  const errors = [], writes = [], outside = [], origin = new URL(info.project.use.baseURL).origin;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => {
    const q = route.request(), url = new URL(q.url());
    if (url.origin !== origin) { outside.push(q.url()); return route.abort(); }
    if (q.method() !== 'GET') writes.push(url.pathname.replace(/ctb_[A-Za-z0-9]+/, 'ID'));
    return route.continue();
  });
  await closeDeedsWhenTheyAppear(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // nothing here is about motion; a still realm keeps every press quick
  await page.goto('/'); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const before = await read(request);
  expect(before.progress.progressCents).toBe(6000);
  const tab = async (name) => { if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click(); await page.locator(`#tab-${name}`).click(); await expect(page.locator(`#panel-${name}`)).toBeVisible(); };
  const amount = page.locator('#give-amount'), hold = page.locator('#give-hold'), approve = page.locator('#give-approve'), pay = page.locator('#simulate-pay');
  const record = page.locator('#ledger-contributions'), ledgerStatus = page.locator('#ledger-status');
  const placeHold = async (dollars) => {
    await tab('give');
    await amount.fill(dollars);
    await hold.check();
    await expect(approve).not.toBeChecked(); // holding is a different approval from paying
    await expect(page.locator('#give-approve-text')).toHaveText(`I approve holding $${dollars} USD (simulated).`);
    await expect(pay).toHaveText('Simulate approved hold');
    await expect(pay).toBeDisabled();
    await approve.check();
    await pay.click();
    await expect(page.locator('#give-status')).toContainText('Held. Nothing is counted');
    await expect(page.locator('#receipt-title')).toHaveText('Contribution held');
    await expect(hold).not.toBeChecked(); await expect(approve).not.toBeChecked();
  };

  // ---- A hold is not progress ----
  await placeHold('40.00');
  await expect(page.locator('#receipt')).toContainText('Simulated: $40.00 is held');
  await expect(page.locator('#progress-amount')).toHaveText('$60.00');
  let now = await read(request);
  expect(holds(now)).toEqual([[4000, 'held', 'held', null]]);
  expect(now.progress).toEqual(before.progress);
  expect(now.ledger.goalEntries).toEqual(before.ledger.goalEntries);

  // ---- An adult releases part of it: armed, then confirmed for an exact amount ----
  await tab('ledger');
  await expect(record).toContainText('Held — not counted');
  await record.locator('[data-hold="release"]').click();
  const releaseAmount = record.locator('.hold-amount'), confirmRelease = record.locator('[data-hold="confirm-release"]');
  await expect(releaseAmount).toHaveValue('40.00');
  await expect(confirmRelease).toHaveText('Confirm release of $40.00');
  await releaseAmount.fill('45.00');
  await confirmRelease.click();
  await expect(ledgerStatus).toContainText('Release between $1.00 and the $40.00 that is held.'); // refused here, before the server
  await releaseAmount.fill('25.00');
  await expect(confirmRelease).toHaveText('Confirm release of $25.00');
  await confirmRelease.click();
  await expect(ledgerStatus).toContainText('Released $25.00. It now counts toward the goal.');
  await expect(page.locator('#progress-amount')).toHaveText('$85.00');
  await expect(record).toContainText('Completed — counted');
  await expect(record.locator('[data-hold]')).toHaveCount(0);
  now = await read(request);
  expect(holds(now)).toEqual([[4000, 'completed', 'released', 2500]]);
  expect(now.progress.progressCents).toBe(8500);

  // ---- Another is returned: nothing is counted, and nothing can be released afterwards ----
  await placeHold('15.00');
  await tab('ledger');
  await record.locator('[data-hold="return"]').click();
  await expect(record.locator('[data-hold="confirm-return"]')).toHaveText('Confirm return of $15.00');
  await record.getByRole('button', { name: 'Keep holding', exact: true }).click(); // changing one's mind sends nothing
  await expect(record.locator('[data-hold="release"]')).toBeVisible();
  await record.locator('[data-hold="return"]').click();
  await record.locator('[data-hold="confirm-return"]').click();
  await expect(ledgerStatus).toContainText('Returned. Nothing was charged or counted.');
  await expect(record).toContainText('Hold returned — not counted');
  await expect(record.locator('[data-hold]')).toHaveCount(0);
  await expect(page.locator('#progress-amount')).toHaveText('$85.00');

  // ---- A child is offered neither the hold nor a decision on one ----
  await placeHold('10.00');
  await page.locator('#persona').selectOption('m_wren');
  await tab('give');
  await expect(hold).toBeDisabled();
  await tab('ledger');
  await expect(record).toContainText('Held — not counted');
  await expect(record.locator('[data-hold]')).toHaveCount(0);
  const refused = await request.post(`/api/contributions/${(await read(request)).contributions.find((c) => c.status === 'held').id}/release`,
    { data: { householdId: before.household.id, goalId: before.goal.id, amountCents: 1000, approverId: 'm_wren', approvalConfirmed: true, requestId: 'child-attempt-0001' } });
  expect(refused.status()).toBe(403);

  now = await read(request);
  expect(holds(now).sort()).toEqual([[1000, 'held', 'held', null], [1500, 'returned', 'returned', null], [4000, 'completed', 'released', 2500]]);
  expect(now.progress.progressCents).toBe(8500);
  expect(now.ledger.goalEntries.length).toBe(before.ledger.goalEntries.length + 1); // one credit, for the released $25.00
  expect(writes).toEqual(['/api/example/contributions', '/api/contributions/ID/release', '/api/example/contributions', '/api/contributions/ID/return', '/api/example/contributions']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});
