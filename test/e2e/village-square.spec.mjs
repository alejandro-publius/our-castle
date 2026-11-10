import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startDemo } from '../../scripts/demo.mjs';

// UI contract test: the production app/renderer with explicitly invented API responses.
// Backend contribution and permission behavior is exercised separately by the village service tests.
test('a reviewed shared contribution grows the original-model square; presence is opt-in and the realm returns unchanged', async ({ browser }, info) => {
  test.setTimeout(180000);
  const demo = await startDemo({ villageStory: true });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], outside = [], payments = [], moves = [];
  page.on('pageerror', e => errors.push(e.message));
  const members = Array.from({ length: 7 }, (_, i) => ({ familyReference: `FAM_${i}`, alias: ['Alder', 'Willow', 'Birch', 'Maple', 'Elm', 'Pine', 'Oak'][i], crest: { field: ['cobalt', 'emerald'][i % 2], charge: 'stag' }, tier: i % 4, mine: i === 0 }));
  const fund = { id: 'fund_class_trip', title: 'Class trip', rail: 'simulated', currency: 'USD', decimals: 2, targetMinor: 40000, deadline: '2026-12-12', revision: 1, status: 'open', canManage: true,
    organizer: { familyReference: 'FAM_0', alias: 'Alder' }, recipient: null, published: false,
    progress: { netMinor: 20000, capturedMinor: 20000, refundedMinor: 0, remainingMinor: 20000, basisPoints: 5000, stage: 1 },
    shares: members.map(m => ({ ...m, committedMinor: 4000, paidMinor: 0 })), receipts: [] };
  const devnet = { ...fund, id: 'fund_test_tokens', title: 'Test-token garden', rail: 'pyusd-devnet', currency: 'PYUSD', decimals: 6, targetMinor: 1000000,
    progress: { netMinor: 1, capturedMinor: 1, refundedMinor: 0, remainingMinor: 999999, basisPoints: 0, stage: 0 }, shares: [], receipts: [], recipient: { kind: 'solana-devnet', address: '11111111111111111111111111111111' } };
  const village = { available: true, neighborhood: { id: 'circle_test', name: 'Woodland families' }, funds: [fund, devnet], members, selectedFundId: fund.id };
  let people = [], selfId = null, holdJoin = null;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { outside.push(url.href); return route.abort(); }
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/state') {
      const response = await route.fetch(), state = await response.json();
      state.village = village; return json(state);
    }
    if (url.pathname === '/api/village') return json({ village });
    if (url.pathname === '/api/village/payments') {
      const body = request.postDataJSON(); payments.push(body);
      expect(body.approvalConfirmed).toBe(true); expect(body.fundId).toBe(fund.id);
      fund.revision++; fund.progress.netMinor += body.amountMinor; fund.progress.capturedMinor += body.amountMinor;
      fund.progress.remainingMinor = fund.targetMinor - fund.progress.netMinor; fund.progress.basisPoints = fund.progress.netMinor / 4;
      fund.progress.stage = fund.progress.netMinor >= 24000 ? 2 : 1;
      fund.shares[0].paidMinor += body.amountMinor;
      fund.receipts.push({ id: 'receipt_1', reference: 'VRC_test_001', eventRef: 'fake_capture_1', eventIndex: 0, kind: 'capture', amountMinor: body.amountMinor, familyReference: 'FAM_0', alias: 'Alder', at: '2026-11-10T20:00:00Z', source: 'simulated' });
      return json({ village, payment: { id: 'payment_1', status: 'completed' } });
    }
    if (url.pathname === '/api/village/presence') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); moves.push(body);
        if (body.action === 'join') { expect(body.confirmed).toBe(true); selfId = 'present_test'; people = [{ id: selfId, familyReference: 'FAM_0', alias: 'Alder', avatarId: 'ranger', x: 0, z: 0 }]; if (holdJoin) await holdJoin; }
        if (body.action === 'move') people[0] = { ...people[0], x: body.x, z: body.z };
        if (body.action === 'leave') { people = []; selfId = null; }
      }
      return json({ members: people, selfId });
    }
    return route.continue();
  });
  try {
    await page.goto(demo.url); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    const sceneBefore = await page.evaluate(() => window.__ourCastle.scene());
    await page.locator('#open-village').click();
    await expect(page.locator('#village-project-title')).toHaveText('Class trip');
    await expect(page.locator('#village-project')).toContainText('$200.00 of $400.00 recorded');
    expect(payments).toHaveLength(0); expect(moves).toHaveLength(0);
    await page.locator('#village-amount').fill('40.00'); await expect(page.locator('#village-contribute')).toBeDisabled();
    await page.locator('#village-approve').check(); await page.locator('#village-amount').fill('50.00');
    await expect(page.locator('#village-approve')).not.toBeChecked(); await expect(page.locator('#village-contribute')).toBeDisabled();
    await page.locator('#village-amount').fill('40.00'); await page.locator('#village-approve').check(); await page.locator('#village-contribute').click();
    await expect(page.locator('#village-project')).toContainText('$240.00 of $400.00 recorded'); expect(payments).toHaveLength(1);
    expect(payments[0].amountMinor).toBe(4000);
    await page.locator('[data-village-tab=records]').click(); await expect(page.locator('#village-records')).toContainText('VRC_test_001');
    await page.locator('[data-village-tab=families]').click(); await expect(page.locator('.village-family-list > li')).toHaveCount(7);
    await page.locator('[data-village-tab=project]').click(); await page.locator('#village-visit').click();
    await expect(page.locator('#village-fund-dialog')).not.toBeVisible(); await expect(page.locator('#world canvas')).toHaveCount(1);
    let square = await page.evaluate(() => window.__ourCastle.scene().village);
    expect(square.active).toBe(true); expect(square.homes).toHaveLength(6); expect(square.stage).toBe(2); expect(square.presence).toHaveLength(0);
    expect(moves).toHaveLength(0);
    const evidence = 'test-results/village-world'; mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${info.project.name}-square.png`, fullPage: false });
    await page.locator('#village-presence-join').click(); await expect(page.locator('#village-presence-status')).toHaveText('1 person here now');
    await page.getByRole('button', { name: 'Walk east', exact: true }).click();
    expect(moves.some(m => m.action === 'move' && m.x === 3 && m.z === 0)).toBe(true);
    square = await page.evaluate(() => window.__ourCastle.scene().village); expect(square.presence[0].x).toBe(3);
    await page.locator('#village-back').click();
    await expect.poll(() => moves.filter(m => m.action === 'leave').length).toBe(1);
    const returned = await page.evaluate(() => window.__ourCastle.scene());
    expect(returned.village.active).toBe(false); expect(returned.tier).toBe(sceneBefore.tier); expect(returned.position).toBe(sceneBefore.position);
    expect(returned.view.focus).toBe(sceneBefore.view.focus);
    // A slow join cannot restore an avatar/heartbeat after the viewer leaves the square.
    let finishJoin; holdJoin = new Promise(resolve => { finishJoin = resolve; });
    await page.locator('#open-village').click(); await page.locator('#village-visit').click();
    await page.locator('#village-presence-join').click();
    await expect.poll(() => moves.filter(m => m.action === 'join').length).toBe(2);
    await page.locator('#village-back').click(); finishJoin(); holdJoin = null;
    await expect.poll(() => moves.filter(m => m.action === 'leave').length).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__ourCastle.village().joined)).toBe(false);
    await page.locator('#open-village').click(); await page.locator('#village-fund-select').selectOption(devnet.id);
    await expect(page.locator('#village-project')).toContainText('0.000001 test PYUSD');
    await expect(page.locator('#village-project')).toContainText('no monetary value'); await expect(page.locator('#village-payment-form')).toBeHidden();
    await page.locator('#village-fund-select').selectOption(fund.id); await expect(page.locator('#village-approve')).not.toBeChecked();
    await page.screenshot({ path: `${evidence}/${info.project.name}-paper.png`, fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(payments).toHaveLength(1); expect(errors).toEqual([]); expect(outside).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});
