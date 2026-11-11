import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { startDemo } from '../../scripts/demo.mjs';
import { closeDeedsWhenTheyAppear } from './support/deeds.mjs';

// The actual authored server, actual routes and one actual scene. No mocked API response or provider credentials.
test('five families contribute to the shared class trip, visit its square and keep private savings unchanged', { tag: '@village-fund' }, async ({ browser }, info) => {
  test.setTimeout(150_000);
  const demo = await startDemo({ villageFund: true });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const outside = [], errors = [], writes = [], apiFailures = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { outside.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), path: url.pathname });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === demo.url && url.pathname.startsWith('/api/') && response.status() >= 400) apiFailures.push({ path: url.pathname, status: response.status() });
  });
  const read = () => page.evaluate(async () => {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`State read failed: ${res.status}`);
    return res.json();
  });
  const scene = () => page.evaluate(() => window.__ourCastle.scene().village);
  const evidence = `test-results/village-fund-journey/${info.project.name}`;
  mkdirSync(evidence, { recursive: true });
  try {
    await closeDeedsWhenTheyAppear(page);
    await page.goto(demo.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(page.locator('#village-fund-dialog')).toBeVisible();
    await expect(page.locator('#village-project-title')).toHaveText('Class trip together');
    await expect(page.locator('.village-progress-copy')).toHaveText('$200.00 of $400.00 recorded');
    const before = await read(), fundId = before.village.selectedFundId;
    const initial = before.village.funds.find(f => f.id === fundId);
    expect(before.example.id).toBe('village-fund');
    expect(before.progress.progressCents).toBe(6000);
    expect(before.village.members.map(m => m.alias).sort()).toEqual(['Alder', 'Birch', 'Maple', 'Oak', 'Willow']);
    expect(initial.progress.netMinor).toBe(20000);
    expect(initial.progress.stage).toBe(1);
    expect(initial.receipts).toHaveLength(4);
    expect(initial.shares.every(s => s.committedMinor === 8000)).toBe(true);
    expect(writes).toEqual([]);

    await page.locator('[data-village-tab="families"]').click();
    await expect(page.locator('#village-families .village-family-list > li')).toHaveCount(5);
    await page.locator('[data-village-tab="project"]').click();
    await expect(page.locator('#village-visit')).toHaveText('Visit the shared square'); // the names the shot list gives these controls
    await page.locator('#village-visit').click();
    await expect(page.locator('body')).toHaveAttribute('data-village-square', 'true');
    await expect.poll(async () => (await scene()).stage).toBe(1);
    expect((await scene()).homes).toHaveLength(5);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('#village-back')).toHaveText('My realm');
    await page.getByRole('button', { name: 'Project & records', exact: true }).click();

    const amount = page.locator('#village-amount'), approval = page.locator('#village-approve'), contribute = page.locator('#village-contribute');
    await amount.fill('40.00');
    await expect(approval).not.toBeChecked();
    await expect(contribute).toBeDisabled();
    await approval.check();
    await amount.fill('41.00');
    await expect(approval).not.toBeChecked();
    await expect(contribute).toBeDisabled();
    await amount.fill('40.00');
    await approval.check();
    await expect(contribute).toBeEnabled();
    const posted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/village/payments' && r.request().method() === 'POST');
    await contribute.click();
    expect((await posted).status()).toBe(200);
    await expect(page.locator('.village-progress-copy')).toHaveText('$240.00 of $400.00 recorded');
    await expect(page.locator('#village-status')).toContainText('Simulated contribution recorded');
    await expect(approval).not.toBeChecked();
    const after = await read(), paid = after.village.funds.find(f => f.id === fundId);
    expect(paid.progress.netMinor).toBe(24000);
    expect(paid.progress.stage).toBe(2);
    expect(paid.receipts).toHaveLength(5);
    expect(after.progress).toEqual(before.progress);
    expect(after.contributions).toEqual(before.contributions);
    const receipt = paid.receipts.find(r => !initial.receipts.some(old => old.id === r.id));
    expect(receipt).toMatchObject({ kind: 'capture', amountMinor: 4000, source: 'simulated', alias: 'Alder' });
    await page.locator('[data-village-tab="records"]').click();
    // Records lists every receipt of the fund: the four $50.00 ones the example starts with, then this one, last.
    await expect(page.locator('ol.village-records > li')).toHaveCount(5);
    await expect(page.locator('ol.village-records > li').last()).toContainText('+$40.00');
    await expect(page.locator('#village-records')).toContainText('+$40.00');
    await expect(page.locator('#village-records')).toContainText(receipt.reference);
    await expect(page.locator('#village-records')).toContainText('no money moves');
    await page.screenshot({ path: `${evidence}/contribution-record.png` });

    await page.locator('[data-village-tab="project"]').click();
    await page.locator('#village-visit').click();
    await expect.poll(async () => (await scene()).stage).toBe(2);
    await expect(page.locator('#goal-name')).toHaveText('Class trip together');
    await expect(page.locator('#progress-amount')).toHaveText('$240.00');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.screenshot({ path: `${evidence}/shared-square.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#village-back').click();
    await expect(page.locator('body')).not.toHaveAttribute('data-village-square', 'true');
    await expect(page.locator('#goal-name')).toHaveText(before.goal.name);
    await expect(page.locator('#progress-amount')).toHaveText('$60.00');
    await expect(page.locator('#target-amount')).toHaveText('$300.00');
    expect((await scene()).active).toBe(false);

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(page.locator('#village-fund-dialog')).toBeVisible();
    await expect(page.locator('.village-progress-copy')).toHaveText('$240.00 of $400.00 recorded');
    const reloaded = await read(), retained = reloaded.village.funds.find(f => f.id === fundId);
    expect(retained.receipts).toHaveLength(5);
    expect(retained.progress.netMinor).toBe(24000);
    expect(reloaded.progress).toEqual(before.progress);
    expect(writes.filter(w => w.path === '/api/village/payments')).toHaveLength(1);
    expect(writes.every(w => w.path === '/api/village/payments')).toBe(true);
    expect(errors).toEqual([]);
    expect(apiFailures).toEqual([]);
    expect(outside).toEqual([]);
    writeFileSync(`${evidence}/checks.json`, `${JSON.stringify({ project: info.project.name, viewport, initial: { sharedMinor: 20000, stage: 1, privateCents: 6000, families: 5 },
      after: { sharedMinor: paid.progress.netMinor, stage: paid.progress.stage, privateCents: after.progress.progressCents, receipts: paid.receipts.length },
      reloaded: { sharedMinor: retained.progress.netMinor, privateCents: reloaded.progress.progressCents, receipts: retained.receipts.length },
      writes, errors, apiFailures, outside, oneRenderer: true }, null, 2)}\n`);
  } finally { await context.close(); await demo.close(); }
});

// The example's member selector redraws the page from the state it already holds: no new state arrives. The same
// actual server and page as above, with the real selector.
test('the example member selector keeps the shared fund in reach for adult, child and adult again; only an adult can approve', { tag: '@village-fund' }, async ({ browser }, info) => {
  test.setTimeout(120_000);
  const demo = await startDemo({ villageFund: true });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const outside = [], errors = [], writes = [], stateReads = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { outside.push(request.url()); return route.abort(); }
    if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), path: url.pathname });
    if (url.pathname === '/api/state') stateReads.push(request.method());
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const dialog = page.locator('#village-fund-dialog'), opener = page.locator('#open-village'), member = page.locator('#persona');
  const amount = page.locator('#village-amount'), approval = page.locator('#village-approve'), contribute = page.locator('#village-contribute');
  const closeFund = () => page.getByRole('button', { name: 'Close village fund', exact: true }).click();
  // The page's own state object, held from before the first change: every check below is made against that one projection.
  const unchanged = async () => ({ sameProjection: await page.evaluate(() => window.__ourCastle.state.village === window.__villageDrawn), stateReads: stateReads.length });
  try {
    await closeDeedsWhenTheyAppear(page);
    await page.goto(demo.url);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    await expect(dialog).toBeVisible();
    await closeFund();
    await expect(dialog).toBeHidden();
    const people = await page.evaluate(() => window.__ourCastle.state.members.map(({ id, role }) => ({ id, role })));
    const adult = people.find(m => m.role === 'adult'), child = people.find(m => m.role === 'child');
    expect(adult).toBeTruthy(); expect(child).toBeTruthy();
    await expect(member).toHaveValue(adult.id);
    expect(await opener.isVisible()).toBe(true);
    await page.evaluate(() => { window.__villageDrawn = window.__ourCastle.state.village; });
    expect(stateReads).toHaveLength(1);

    // Adult to child. The selector's own redraw has finished when the choice returns, so this is read once, not awaited.
    await member.selectOption(child.id);
    expect(await opener.isVisible()).toBe(true);
    expect(await unchanged()).toEqual({ sameProjection: true, stateReads: 1 });
    await opener.click();
    await expect(page.locator('#village-project-title')).toHaveText('Class trip together');
    await expect(page.locator('.village-progress-copy')).toHaveText('$200.00 of $400.00 recorded');
    await expect(page.locator('#village-payment-form')).toBeHidden();
    await expect(contribute).toBeDisabled();
    await expect(page.locator('#village-share-form')).toBeHidden();
    await expect(page.locator('#village-create')).toBeHidden();
    // A child gets no approval even past the hidden form: fill and submit it directly.
    await page.evaluate(() => {
      const form = document.getElementById('village-payment-form'), value = document.getElementById('village-amount'), ok = document.getElementById('village-approve');
      value.value = '40.00'; value.dispatchEvent(new Event('input', { bubbles: true }));
      ok.checked = true; ok.dispatchEvent(new Event('change', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(contribute).toBeDisabled();
    await closeFund();

    // Child to adult. What the child typed and ticked is not carried over; the adult approves their own amount.
    await member.selectOption(adult.id);
    expect(await opener.isVisible()).toBe(true);
    expect(await unchanged()).toEqual({ sameProjection: true, stateReads: 1 });
    await opener.click();
    await expect(page.locator('#village-payment-form')).toBeVisible();
    await expect(amount).toHaveValue('');
    await expect(approval).not.toBeChecked();
    await expect(contribute).toBeDisabled();
    await amount.fill('40.00');
    await expect(contribute).toBeDisabled();
    await approval.check();
    await expect(contribute).toBeEnabled();
    await closeFund();

    // Nothing was written by any of it, the child's forced submit included.
    const kept = await page.evaluate(async () => { const s = await (await fetch('/api/state')).json(), f = s.village.funds.find(x => x.id === s.village.selectedFundId); return { receipts: f.receipts.length, netMinor: f.progress.netMinor, privateCents: s.progress.progressCents }; });
    expect(kept).toEqual({ receipts: 4, netMinor: 20000, privateCents: 6000 });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});
