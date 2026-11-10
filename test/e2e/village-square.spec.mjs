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
    await expect(page.locator('#goal-name')).toHaveText('Class trip'); await expect(page.locator('#progress-amount')).toHaveText('$240.00');
    await expect(page.locator('#next-step')).toBeHidden();
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
    await expect(page.locator('#goal-name')).toHaveText('Village library'); await expect(page.locator('#progress-amount')).toHaveText('$150.00');
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

test('local assistant access is explicitly granted, copied and revoked without persisting its token', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'This token lifecycle uses the same native controls on both layouts.');
  const demo = await startDemo({ villageStory: true });
  const context = await browser.newContext(), page = await context.newPage(), writes = [], outside = [];
  const fund = { id: 'fund_local', title: 'Local test project', rail: 'simulated', decimals: 2, targetMinor: 10000, revision: 1, status: 'open', progress: { netMinor: 0, remainingMinor: 10000, basisPoints: 0, stage: 0 }, shares: [], receipts: [] };
  const village = { available: true, neighborhood: { id: 'test_circle', name: 'Invented families' }, funds: [fund], members: [], selectedFundId: fund.id, capabilities: { mcp: true } };
  const fixture = `<!doctype html><meta charset="utf-8"><title>Local assistant UI fixture</title><button id="open-village">Village fund</button><dialog id="village-fund-dialog"></dialog><section id="village-square-controls" hidden></section><script type="module">
    import { createVillageFund } from '/src/app/village-fund.js';
    const state={household:{id:'fixture-house'},access:{me:{memberId:'fixture-adult',role:'adult'}},village:${JSON.stringify(village)}};
    window.controller=createVillageFund({getState:()=>state,actor:()=>({id:'fixture-adult',role:'adult'}),applyState:()=>{},getScene:()=>null});window.controller.render();
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedConfig=JSON.parse(text)}}});
  </script>`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { outside.push(url.href); return route.abort(); }
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/__assistant_fixture') return route.fulfill({ contentType: 'text/html', body: fixture });
    if (url.pathname === '/api/village') return json({ village });
    if (url.pathname.startsWith('/api/mcp/')) {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname.endsWith('/revoke')) return json({ revoked: true });
      return json({ grantId: 'grant_fixture', fundId: fund.id, token: 'ocm_fixture_only_not_a_real_token', expiresAt: '2026-11-10T22:15:00Z' });
    }
    return route.continue();
  });
  try {
    await page.goto(`${demo.url}/__assistant_fixture`); await page.locator('#open-village').click(); await page.locator('[data-village-tab=records]').click();
    await page.locator('#village-assistant summary').click(); expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Create a temporary connection' }).click();
    await expect(page.locator('[name=assistant-token]')).toHaveValue('ocm_fixture_only_not_a_real_token');
    await page.getByRole('button', { name: 'Copy local assistant configuration' }).click();
    const copied = await page.evaluate(() => window.copiedConfig.mcpServers['our-castle']);
    expect(copied.command).toBe('node'); expect(copied.env.OUR_CASTLE_MCP_URL).toBe(demo.url); expect(copied.args[0]).toBe('/absolute/path/to/our-castle/scripts/mcp.mjs');
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.getByRole('button', { name: 'Close village fund' }).click(); await expect(page.locator('[name=assistant-token]')).toHaveValue('');
    await page.locator('#open-village').click(); await expect(page.getByRole('button', { name: 'Copy local assistant configuration' })).toBeHidden();
    await page.getByRole('button', { name: 'Revoke this connection' }).click();
    await expect(page.getByRole('button', { name: 'Create a temporary connection' })).toBeEnabled();
    expect(writes.map(w => w.path)).toEqual(['/api/mcp/grants', '/api/mcp/grants/revoke']); expect(writes[1].body.grantId).toBe('grant_fixture'); expect(outside).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});

test('a published outsider review restores an exact unfinished checkout without exposing private families or creating a duplicate', async ({ browser }, info) => {
  test.setTimeout(180000);
  const demo = await startDemo({ villageStory: true });
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], writes = [], outsideRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  const village = { available: true, neighborhood: null, funds: [], members: [], selectedFundId: null, capabilities: { paypal: true, devnet: false } };
  const fund = { id: 'fund_published', title: 'School trip', rail: 'paypal-sandbox', currency: 'USD', decimals: 2, targetMinor: 40000,
    deadline: '2026-12-12', revision: 3, status: 'open', canManage: false, published: true,
    organizer: { alias: 'Willow family' }, recipient: { kind: 'paypal', merchantId: 'MOCKRECIPIENT1', revision: 1 }, shares: [], receipts: [],
    progress: { netMinor: 20000, remainingMinor: 20000, basisPoints: 5000, stage: 1 } };
  const order = { id: 'vpay_restore_1', fundId: fund.id, source: 'paypal-sandbox', amountMinor: 4000, currency: 'USD', recipient: fund.recipient,
    revision: 2, status: 'creating', providerOrderId: null, approveUrl: 'https://untrusted.invalid/approve', createdAt: '2026-11-10T20:00:00Z' };
  let published = true, checks = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { outsideRequests.push(url.href); return route.abort(); }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/state') { const response = await route.fetch(), state = await response.json(); state.village = village; return json(state); }
    if (url.pathname === '/api/village') return json({ village });
    if (url.pathname === `/api/village/review/${fund.id}`) return published ? json({ fund, viewerMember: false }) : json({ error: { message: 'This project is not available.', code: 'fund_not_found' } }, 404);
    if (url.pathname === '/api/village/payments' && request.method() === 'GET') return json({ payments: [order] });
    if (url.pathname.startsWith('/api/village/') && request.method() === 'POST') {
      const body = request.postDataJSON(); writes.push({ path: url.pathname, body });
      if (url.pathname === '/api/village/payments/resume') { expect(body.orderId).toBe(order.id); order.status = 'created'; order.providerOrderId = 'MOCK_ORDER_1'; order.approveUrl = 'https://www.sandbox.paypal.com/checkoutnow?token=MOCK_ORDER_1'; return json({ payment: { contribution: order }, village }); }
      if (url.pathname === '/api/village/payments/capture') { expect(body.orderId).toBe(order.id); checks++; order.status = checks === 1 ? 'pending' : 'completed'; if (checks > 1) fund.progress = { netMinor: 24000, remainingMinor: 16000, basisPoints: 6000, stage: 2 }; return json({ payment: { contribution: order }, village }); }
      return json({ error: { message: 'Unexpected write in UI fixture' } }, 400);
    }
    return route.continue();
  });
  try {
    await page.goto(`${demo.url}/?villageFund=${fund.id}`);
    await expect(page.locator('#village-project-title')).toHaveText('School trip');
    await expect(page.locator('.exchange-eyebrow').filter({ hasText: 'Published project' })).toContainText('Willow family');
    await expect(page.locator('[data-village-tab=families]')).toBeHidden(); await expect(page.locator('[data-village-tab=records]')).toBeHidden();
    await expect(page.locator('#village-visit')).toBeHidden(); await expect(page.locator('.village-family-list > li')).toHaveCount(0);
    await expect(page.locator('.village-payment-followup')).toContainText('$40.00');
    await expect(page.locator('.village-payment-followup')).toContainText(order.id);
    await expect(page.locator('.village-paypal-link')).toHaveCount(0); // an untrusted supplied approval link is never exposed
    await page.locator('#village-amount').fill('80'); await page.locator('#village-approve').check(); await expect(page.locator('#village-contribute')).toBeDisabled();
    expect(writes).toHaveLength(0);
    await page.locator('#village-resume-payment').click();
    await expect(page.locator('.village-paypal-link')).toHaveAttribute('href', order.approveUrl);
    await page.locator('#village-check-payment').click(); await expect(page.locator('.village-payment-followup')).toContainText('pending');
    await expect(page.locator('#village-contribute')).toBeDisabled();
    await page.locator('#village-check-payment').click(); await expect(page.locator('.village-payment-followup')).toBeHidden();
    await expect(page.locator('#village-project')).toContainText('$240.00 of $400.00 recorded');
    expect(writes.filter(w => w.path === '/api/village/payments')).toHaveLength(0);
    // Withdrawing a review link removes public project information, but not this adult's exact pending recovery.
    published = false; order.status = 'pending'; await page.reload();
    await expect(page.locator('#village-empty')).toContainText('no longer available');
    await expect(page.locator('#village-project')).toBeHidden();
    await expect(page.locator('#village-check-payment')).toBeVisible();
    await expect(page.locator('.village-payment-followup')).toContainText(order.id);
    expect(errors).toEqual([]); expect(outsideRequests).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});

test('withdrawing a voluntary share allows zero; a delayed old-member grant cannot repopulate the new member UI', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'Focused native-form and identity lifecycle regression.');
  const demo = await startDemo({ villageStory: true }), context = await browser.newContext(), page = await context.newPage();
  const errors = [], shares = []; page.on('pageerror', error => errors.push(error.message));
  const fund = { id: 'fund_share', title: 'Invented class trip', rail: 'simulated', decimals: 2, targetMinor: 10000, revision: 1, status: 'open', progress: { netMinor: 0, remainingMinor: 10000, basisPoints: 0, stage: 0 },
    shares: [{ familyReference: 'FAM_TEST', alias: 'Example family', committedMinor: 6000, paidMinor: 0 }], receipts: [] };
  const village = { available: true, neighborhood: { id: 'fixture_circle', name: 'Invented families' }, funds: [fund], members: [{ familyReference: 'FAM_TEST', alias: 'Example family', mine: true }], selectedFundId: fund.id, capabilities: { mcp: true } };
  const fixture = `<!doctype html><meta charset="utf-8"><title>Share and scope fixture</title><button id="open-village">Village fund</button><dialog id="village-fund-dialog"></dialog><section id="village-square-controls" hidden></section><script type="module">
    import { createVillageFund } from '/src/app/village-fund.js';
    let member={id:'adult-before',role:'adult'};const state={household:{id:'fixture-house'},access:{me:{memberId:member.id,role:'adult'}},village:${JSON.stringify(village)}};
    window.controller=createVillageFund({getState:()=>state,actor:()=>member,applyState:()=>{},getScene:()=>null});window.controller.render();
    window.switchMember=()=>{member={id:'adult-after',role:'adult'};state.access.me.memberId=member.id;state.village={...state.village};window.controller.render()};
  </script>`;
  let releaseRead, awaitingRefresh = false, holdRefresh = null, grantIssued = false;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { errors.push(`Unexpected outside request: ${url.origin}`); return route.abort(); }
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/__share_fixture') return route.fulfill({ contentType: 'text/html', body: fixture });
    if (url.pathname === '/api/village') {
      if (request.method() === 'POST') { const body = request.postDataJSON(); shares.push(body); fund.shares[0].committedMinor = body.committedMinor; fund.revision++; }
      else if (holdRefresh && grantIssued) { awaitingRefresh = true; await holdRefresh; }
      return json({ village });
    }
    if (url.pathname === '/api/mcp/grants') { grantIssued = true; return json({ grantId: 'old_member_grant', fundId: fund.id, token: 'fixture_token_only', expiresAt: '2026-11-10T22:15:00Z' }); }
    return route.continue();
  });
  try {
    await page.goto(`${demo.url}/__share_fixture`); await page.locator('#open-village').click();
    await page.locator('[data-village-tab=families]').click(); await expect(page.locator('.village-family-list')).toContainText('$60.00 voluntary share');
    await page.locator('[data-village-tab=project]').click(); await page.getByText('Our family’s share', { exact: true }).click();
    await page.locator('#village-share-form [name=committed]').fill('0'); await page.locator('#village-share-form [name=confirmed]').check();
    await page.getByRole('button', { name: 'Save our share' }).click();
    await expect.poll(() => shares.length, { timeout: 3000 }).toBe(1);
    expect(shares[0]).toMatchObject({ action: 'share', committedMinor: 0, confirmed: true });
    await page.locator('[data-village-tab=families]').click(); await expect(page.locator('.village-family-list')).toContainText('$0.00 voluntary share');
    await page.locator('[data-village-tab=project]').click(); await page.locator('#village-amount').fill('0'); await page.locator('#village-approve').check(); await expect(page.locator('#village-contribute')).toBeDisabled();
    await expect(page.locator('[name=question]')).toHaveAttribute('maxlength', '300');
    await page.locator('[data-village-tab=records]').click(); await page.locator('#village-assistant summary').click();
    holdRefresh = new Promise(resolve => { releaseRead = resolve; });
    await page.getByRole('button', { name: 'Create a temporary connection' }).click();
    await expect.poll(() => awaitingRefresh).toBe(true); await page.evaluate(() => window.switchMember()); releaseRead(); holdRefresh = null;
    await page.locator('#open-village').click(); await page.locator('[data-village-tab=records]').click();
    await expect(page.getByRole('button', { name: 'Create a temporary connection' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Revoke this connection' })).toBeHidden();
    await expect(page.locator('[name=assistant-token]')).toHaveValue(''); expect(errors).toEqual([]);
  } finally { releaseRead?.(); await context.close(); await demo.close(); }
});

// The example's member choice redraws the fund from the state already held (see the real-selector journey). That
// allowance is for one example household only: every other scope change shows nothing until its own state arrives.
test('a signed-in scope change waits for its own fund projection; only an example member choice in one household redraws the one already held', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'Identity lifecycle of the fund controller; the same code on both layouts.');
  const demo = await startDemo({ villageStory: true }), context = await browser.newContext(), page = await context.newPage();
  const errors = [], writes = []; page.on('pageerror', error => errors.push(error.message));
  const villageOf = name => ({ available: true, neighborhood: { id: `circle_${name}`, name: `Circle ${name}` }, members: [{ familyReference: `FAM_${name}`, alias: `Family ${name}`, mine: true }], selectedFundId: `fund_${name}`,
    funds: [{ id: `fund_${name}`, title: `Project ${name}`, rail: 'simulated', decimals: 2, targetMinor: 10000, revision: 1, status: 'open', progress: { netMinor: 0, remainingMinor: 10000, basisPoints: 0, stage: 0 }, shares: [], receipts: [] }] });
  const fixture = `<!doctype html><meta charset="utf-8"><title>Fund scope fixture</title><button id="open-village">Village fund</button><dialog id="village-fund-dialog"></dialog><section id="village-square-controls" hidden></section><script type="module">
    import { createVillageFund } from '/src/app/village-fund.js';
    let member={id:'adult-a',role:'adult'};const state={household:{id:'house-a'},access:{me:{memberId:'adult-a',role:'adult'}},village:${JSON.stringify(villageOf('A'))}};
    window.controller=createVillageFund({getState:()=>state,actor:()=>member,applyState:()=>{},getScene:()=>null});window.controller.render();
    // Each change redraws at once, as the page does. Only newState brings a new projection object.
    window.memberIs=(id,role='adult')=>{member={id,role};if(state.access)state.access.me.memberId=id;window.controller.render()};
    window.householdIs=id=>{state.household={id};window.controller.render()};
    window.signOutToExample=id=>{delete state.access;member={id,role:'adult'};window.controller.render()};
    window.signIn=id=>{member={id,role:'adult'};state.access={me:{memberId:id,role:'adult'}};window.controller.render()};
    window.newState=village=>{state.village=village;window.controller.render()};
  </script>`;
  let served = villageOf('A');
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== demo.url) { errors.push(`Unexpected outside request: ${url.origin}`); return route.abort(); }
    if (url.pathname === '/__scope_fixture') return route.fulfill({ contentType: 'text/html', body: fixture });
    if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"message":"Unexpected write in UI fixture"}}' }); }
    if (url.pathname === '/api/village') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ village: served }) });
    return route.continue();
  });
  const opener = page.locator('#open-village'), dialog = page.locator('#village-fund-dialog'), title = page.locator('#village-project-title');
  const shown = async name => { await expect(opener).toBeVisible(); await opener.click(); await expect(title).toHaveText(`Project ${name}`); await expect(page.locator('.exchange-eyebrow')).toHaveText(`Circle ${name}`); };
  const withheld = async () => { expect(await opener.isHidden()).toBe(true); expect(await dialog.isHidden()).toBe(true); expect(await page.evaluate(() => window.controller.debug().selected)).toBe(null); };
  const arrives = async name => { served = villageOf(name); await page.evaluate(village => window.newState(village), served); };
  try {
    await page.goto(`${demo.url}/__scope_fixture`); await shown('A');
    // Signed in: another member, then another household, each with the earlier household's projection still in the state.
    await page.evaluate(() => window.memberIs('adult-b')); await withheld();
    await arrives('B'); await shown('B');
    await page.evaluate(() => window.householdIs('house-c')); await withheld();
    await arrives('C'); await shown('C');
    // Leaving a signed-in scope for an example one is not an example member choice either.
    await page.evaluate(() => window.signOutToExample('example-adult')); await withheld();
    await arrives('D'); await shown('D');
    // The example: a member choice in the same household redraws the projection already held, for a child too...
    await page.evaluate(() => window.memberIs('example-child', 'child')); expect(await dialog.isHidden()).toBe(true); await shown('D');
    await expect(page.locator('#village-payment-form')).toBeHidden(); await expect(page.locator('#village-contribute')).toBeDisabled();
    await page.evaluate(() => window.memberIs('example-adult')); expect(await dialog.isHidden()).toBe(true); await shown('D');
    await expect(page.locator('#village-payment-form')).toBeVisible();
    // ...but another example household does not.
    await page.evaluate(() => window.householdIs('house-e')); await withheld();
    await arrives('E'); await shown('E');
    // Nor does signing in from an example scope: the state now names a signed-in member.
    await page.evaluate(() => window.signIn('adult-f')); await withheld();
    await arrives('F'); await shown('F');
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); await demo.close(); }
});
