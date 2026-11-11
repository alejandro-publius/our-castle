import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { familyServer, person, createFamily, isLive, mutableClock, settled } from './support/family.mjs';

// Two fresh families and one shared project, through visible controls only.
// - A disposable family-mode server with its real handlers. Each family has its own browser context and its own virtual
//   authenticator (not a real device).
// - Nothing is seeded: no neighborhood, fund, share or receipt exists before the families make them here.
// - No response is mocked. Requests that leave the server's origin are refused and counted.
// These are automated interaction checks, not a playtest with people.
const SENTENCE = 'We need $400 for the class trip by December 12, 2026.';
const read = (page) => page.evaluate(async () => {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`State read failed: ${res.status}`);
  const s = await res.json();
  return { goal: s.goal.name, progress: s.progress, contributions: s.contributions, exchange: s.exchange, village: s.village };
});
const fundOf = (state) => state.village.funds.find((f) => f.id === state.village.selectedFundId) ?? null;
const scene = (page) => page.evaluate(() => { const v = window.__ourCastle.scene().village; return { active: v.active, stage: v.stage ?? null, homes: v.homes?.length ?? 0 }; });
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const touchSized = async (locator) => expect((await locator.boundingBox()).height).toBeGreaterThanOrEqual(44);

test('two fresh families start a neighborhood, describe one project, choose their own shares and see one simulated contribution together', { tag: '@village-fund' }, async ({ browser }, info) => {
  test.setTimeout(240_000);
  // The sentence names December 12, 2026: the server's day is pinned before it, so this journey does not expire.
  const clock = mutableClock(); clock.advance(Date.parse('2026-11-10T18:00:00Z') - Date.now());
  const s = await familyServer({ clock });
  const a = await person(browser, info, 'Rowan', { origin: s.origin }), b = await person(browser, info, 'Willow', { origin: s.origin });
  const consoleErrors = [], writes = { a: [], b: [] };
  for (const [key, p] of [['a', a], ['b', b]]) {
    p.page.setDefaultTimeout(15_000);
    p.page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.name}: ${m.text()}`); });
    p.page.on('request', (r) => { if (!['GET', 'HEAD'].includes(r.method())) writes[key].push(new URL(r.url()).pathname); });
  }
  const evidence = `test-results/village-first-use/${info.project.name}`;
  mkdirSync(evidence, { recursive: true });
  const ui = (p) => ({
    chip: p.page.locator('#open-village'), fund: p.page.locator('#village-fund-dialog'), exchange: p.page.locator('#exchange-dialog'),
    back: p.page.locator('#exchange-return-fund'), status: p.page.locator('#village-status'), total: p.page.locator('.village-progress-copy'),
    tab: (name) => p.page.locator(`[data-village-tab="${name}"]`), section: (name) => p.page.locator(`[data-exchange-section="${name}"]`),
  });
  const A = ui(a), B = ui(b);
  const saveShare = async (p, U, dollars) => {
    await U.tab('project').click();
    await U.fund.getByText('Our family’s share', { exact: true }).click();
    await p.page.locator('#village-share-form [name=committed]').fill(dollars);
    await p.page.locator('#village-share-form [name=confirmed]').check();
    await p.page.getByRole('button', { name: 'Save our share', exact: true }).click();
    await expect(U.status).toHaveText('Saved.');
  };
  try {
    // ---- Family A: an empty fund, and the way to a neighborhood ----
    await createFamily(a, s.origin, 'Rowan');
    const beforeA = await read(a.page);
    expect(beforeA.village).toMatchObject({ available: true, neighborhood: null, funds: [], members: [] }); // nothing is seeded
    expect(beforeA.exchange.neighborhood).toBeFalsy();
    await A.chip.click();
    await expect(A.fund).toBeVisible();
    await expect(a.page.locator('#village-fund-dialog .exchange-eyebrow')).toHaveText('No neighborhood yet');
    await expect(a.page.locator('#village-empty')).toContainText('Start or join an invited neighborhood');
    for (const id of ['#village-start', '#village-join']) { await expect(a.page.locator(id)).toBeVisible(); await touchSized(a.page.locator(id)); }
    await expect(a.page.locator('#village-create')).toBeHidden(); // no project without a neighborhood
    await a.page.screenshot({ path: `${evidence}/1-empty-fund.png` });

    // The existing Exchange form opens over the fund, already expanded, and offers the way back.
    await a.page.locator('#village-start').click();
    await expect(A.exchange).toHaveAttribute('open', '');
    await expect(A.fund).toHaveAttribute('open', '');
    await expect(A.section('start')).toHaveAttribute('open', '');
    await expect(A.section('start').locator('summary')).toBeFocused();
    await expect(A.back).toBeVisible(); await touchSized(A.back);
    await a.page.screenshot({ path: `${evidence}/2-start-a-neighborhood.png` });
    expect(writes.a.filter((w) => w === '/api/exchange')).toEqual([]); // opening it created nothing
    await A.section('start').getByLabel('Neighborhood name', { exact: true }).fill('Maple Lane families');
    await A.section('start').getByLabel('Your shared family name', { exact: true }).fill('Alder');
    await a.page.getByRole('button', { name: 'Create neighborhood', exact: true }).click();
    await expect(a.page.locator('#exchange-status')).toHaveText('Saved. Go back to the village fund to continue.');
    await expect(A.back).toBeFocused();
    await A.back.click();
    await expect(A.exchange).not.toHaveAttribute('open', '');
    await expect(A.fund).toHaveAttribute('open', '');

    // ---- Back at the fund task: describe, review, accept ----
    await expect(a.page.locator('#village-fund-dialog .exchange-eyebrow')).toHaveText('Maple Lane families');
    await expect(a.page.locator('#village-start')).toBeHidden();
    const describe = A.fund.locator('details').filter({ has: a.page.getByLabel('Describe a shared project', { exact: true }) });
    await expect(describe).toHaveAttribute('open', '');
    await expect(describe.locator('summary')).toBeFocused();
    await expect(a.page.locator('#village-create > summary')).toBeVisible(); // creating by hand is still there
    await a.page.getByLabel('Describe a shared project', { exact: true }).fill(SENTENCE);
    await a.page.getByRole('button', { name: 'Draft a project', exact: true }).click();
    const draft = a.page.locator('#village-draft-result'), accept = draft.getByRole('button', { name: 'I reviewed this — create project', exact: true });
    await expect(draft).toContainText('Draft from built-in rules; no AI');
    await expect(draft).toContainText('$400.00 · by 2026-12-12');
    await expect(draft).toContainText('Simulated contribution · no money moves');
    await expect(draft).toContainText('Alder: proposed $400.00');
    await expect(draft).toContainText('No payment or recurring charge is scheduled.');
    await expect(A.status).toHaveText('Draft ready to review. Nothing is created until you accept it.');
    await touchSized(accept);
    expect((await read(a.page)).village.funds).toEqual([]); // a draft is not a project
    await a.page.screenshot({ path: `${evidence}/3-reviewed-draft.png` });
    await accept.click();
    await expect(a.page.locator('#village-project-title')).toHaveText('the class trip');
    await expect(a.page.locator('.village-rail')).toHaveText('Simulated contribution · no money moves');
    await expect(A.total).toHaveText('$0.00 of $400.00 recorded');
    await expect(describe).not.toHaveAttribute('open', '');
    await expect(a.page.getByLabel('Describe a shared project', { exact: true })).toHaveValue('');
    const created = fundOf(await read(a.page));
    expect(created).toMatchObject({ title: 'the class trip', rail: 'simulated', targetMinor: 40000, deadline: '2026-12-12', canManage: true, receipts: [] });
    expect(created.shares.every((x) => x.committedMinor === 0 && x.paidMinor === 0)).toBe(true); // proposed shares are not commitments

    // ---- The invitation handoff from Families ----
    await A.tab('families').click();
    await expect(a.page.locator('.village-family-list > li')).toHaveCount(1);
    const invite = a.page.locator('#village-invite');
    await expect(invite).toBeVisible(); await touchSized(invite);
    await invite.click();
    await expect(A.exchange).toHaveAttribute('open', '');
    await expect(A.section('invite')).toHaveAttribute('open', '');
    await expect(A.section('invite').locator('summary')).toBeFocused();
    expect((await read(a.page)).exchange.invites).toEqual([]); // opening the form made no invitation
    await A.exchange.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const code = await a.page.getByLabel('Invitation code to share', { exact: true }).inputValue();
    expect(code).toMatch(/^[0-9a-f]{40,48}$/);
    await expect(a.page.getByLabel('Invitation code to share', { exact: true })).toBeInViewport({ ratio: 1 }); // also on the narrow screen
    await a.page.screenshot({ path: `${evidence}/4-invitation.png` });
    await A.back.click();
    await expect(A.exchange).not.toHaveAttribute('open', '');
    await expect(invite).toBeFocused();

    // ---- Family B: joins with the code and finds the same project ----
    await createFamily(b, s.origin, 'Willow');
    const beforeB = await read(b.page);
    expect(beforeB.village).toMatchObject({ neighborhood: null, funds: [] });
    await isLive(a.page); await isLive(b.page);
    await B.chip.click();
    await expect(b.page.locator('#village-join')).toBeVisible();
    await b.page.locator('#village-join').click();
    await expect(B.section('join')).toHaveAttribute('open', '');
    await expect(B.section('join').locator('summary')).toBeFocused();
    await B.section('join').getByLabel('Invitation code', { exact: true }).fill(code);
    await B.section('join').getByLabel('Your shared family name', { exact: true }).fill('Birch');
    // The invitation check is held for a moment and then let through unchanged: a slow check says what it is doing,
    // where B is looking, and marks its own window busy.
    let letThrough, checking; const held = new Promise(resolve => { letThrough = resolve; }), arrived = new Promise(resolve => { checking = resolve; });
    await b.page.route('**/api/exchange', async route => { if (route.request().postDataJSON()?.action === 'preview') { checking(); await held; } return route.fallback(); });
    await b.page.getByRole('button', { name: 'Review invitation', exact: true }).click();
    await arrived;
    await expect(b.page.locator('#exchange-status')).toHaveText('Checking the invitation…');
    await expect(b.page.locator('#exchange-status')).toBeInViewport({ ratio: 1 });
    await expect(B.exchange).toHaveAttribute('aria-busy', 'true');
    letThrough();
    await expect(B.section('join')).toContainText('Join Maple Lane families?');
    await expect(b.page.locator('#exchange-status')).toHaveText('Review the invitation below. Nothing is joined yet.');
    await expect(B.exchange).not.toHaveAttribute('aria-busy', 'true');
    await expect(b.page.getByRole('button', { name: 'Join this neighborhood', exact: true })).toBeInViewport({ ratio: 1 }); // also on the narrow screen
    expect((await read(b.page)).village.neighborhood).toBe(null); // reviewing joined nothing
    await touchSized(b.page.getByRole('button', { name: 'Join this neighborhood', exact: true }));
    await b.page.screenshot({ path: `${evidence}/4b-join-review.png` });
    await b.page.getByRole('button', { name: 'Join this neighborhood', exact: true }).click();
    await expect(b.page.locator('#exchange-status')).toHaveText('Saved. Go back to the village fund to continue.');
    await B.back.click();
    await expect(B.exchange).not.toHaveAttribute('open', '');
    await expect(b.page.locator('#village-project-title')).toHaveText('the class trip');
    await expect(b.page.locator('#village-project-title')).toBeFocused();
    await expect(B.total).toHaveText('$0.00 of $400.00 recorded');
    // The founding family organizes: B gets neither the create forms nor the invitation.
    await expect(b.page.locator('#village-create')).toBeHidden();
    await B.tab('families').click();
    await expect(b.page.locator('.village-family-list > li')).toHaveCount(2);
    await expect(b.page.locator('#village-invite')).toBeHidden();
    // A's open Families view shows the new family without a reload.
    await expect(a.page.locator('.village-family-list > li')).toHaveCount(2);
    await expect(a.page.locator('.village-family-list')).toContainText('Birch');

    // ---- Each family's own voluntary share; a promise is not progress ----
    await saveShare(a, A, '200');
    await saveShare(b, B, '150');
    for (const [p, U] of [[a, A], [b, B]]) {
      await U.tab('families').click();
      const rows = p.page.locator('.village-family-list > li');
      await expect(rows.filter({ hasText: 'Alder' })).toContainText('$200.00 voluntary share');
      await expect(rows.filter({ hasText: 'Birch' })).toContainText('$150.00 voluntary share');
      await expect(rows.filter({ hasText: 'No contribution recorded' })).toHaveCount(0);
      await expect(rows.filter({ hasText: '$0.00 contributed' })).toHaveCount(2);
      await U.tab('project').click();
      await expect(U.total).toHaveText('$0.00 of $400.00 recorded');
    }
    const promised = fundOf(await read(b.page));
    expect(promised.progress).toMatchObject({ netMinor: 0, stage: 0 });
    expect(promised.receipts).toEqual([]);
    expect(promised.shares.map((x) => [x.alias, x.committedMinor, x.paidMinor]).sort()).toEqual([['Alder', 20000, 0], ['Birch', 15000, 0]]);

    // ---- One approved simulated contribution from B, seen by both open pages ----
    // A stands in the shared square at the first stage while B contributes.
    await a.page.locator('#village-visit').click();
    await expect(a.page.locator('body')).toHaveAttribute('data-village-square', 'true');
    await expect.poll(() => scene(a.page)).toEqual({ active: true, stage: 0, homes: 2 });
    await expect(a.page.locator('#goal-name')).toHaveText('the class trip');
    await expect(a.page.locator('#progress-amount')).toHaveText('$0.00');
    const amount = b.page.locator('#village-amount'), approval = b.page.locator('#village-approve'), contribute = b.page.locator('#village-contribute');
    await amount.fill('100.00');
    await expect(contribute).toBeDisabled();
    await approval.check();
    await expect(b.page.locator('#village-payment-form .check')).toContainText('I approve $100.00 toward the class trip (simulated).');
    await amount.fill('101.00');
    await expect(approval).not.toBeChecked(); // approval belongs to one exact amount
    await amount.fill('100.00'); await approval.check();
    await expect(contribute).toBeEnabled();
    const posted = b.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/village/payments' && r.request().method() === 'POST');
    await contribute.click();
    expect((await posted).status()).toBe(200);
    await expect(B.total).toHaveText('$100.00 of $400.00 recorded');
    await expect(B.status).toContainText('Simulated contribution recorded');
    // A's page was not reloaded: its square and ribbon follow.
    await expect.poll(() => scene(a.page), { timeout: 20_000 }).toEqual({ active: true, stage: 1, homes: 2 });
    await expect(a.page.locator('#progress-amount')).toHaveText('$100.00');
    await a.page.screenshot({ path: `${evidence}/5-shared-square-after-neighbor-contribution.png` });
    expect(await fits(a.page)).toBe(true);
    await a.page.getByRole('button', { name: 'Project & records', exact: true }).click();
    await expect(A.total).toHaveText('$100.00 of $400.00 recorded');
    const afterA = await read(a.page), afterB = await read(b.page), paidA = fundOf(afterA), paidB = fundOf(afterB);
    expect(paidB.receipts).toHaveLength(1);
    expect(paidA.receipts).toEqual(paidB.receipts); // one receipt, the same for both families
    expect(paidB.receipts[0]).toMatchObject({ kind: 'capture', amountMinor: 10000, source: 'simulated', alias: 'Birch' });
    expect(paidA.progress).toEqual(paidB.progress);
    expect(paidB.progress).toMatchObject({ netMinor: 10000, stage: 1 });
    expect(paidB.shares.map((x) => [x.alias, x.committedMinor, x.paidMinor]).sort()).toEqual([['Alder', 20000, 0], ['Birch', 15000, 10000]]);
    for (const [p, U] of [[a, A], [b, B]]) {
      await U.tab('records').click();
      const records = p.page.locator('#village-records .village-records > li');
      await expect(records).toHaveCount(1);
      await expect(records).toContainText('+$100.00');
      await expect(records).toContainText('Birch');
      await expect(records).toContainText(paidB.receipts[0].reference);
      await expect(records).toContainText('no money moves');
    }
    await b.page.screenshot({ path: `${evidence}/6-contribution-record.png` });
    // Neither family's private savings or private contribution ledger moved.
    expect(afterA.progress).toEqual(beforeA.progress); expect(afterA.contributions).toEqual(beforeA.contributions);
    expect(afterB.progress).toEqual(beforeB.progress); expect(afterB.contributions).toEqual(beforeB.contributions);
    expect(afterA.contributions).toEqual([]); expect(afterB.contributions).toEqual([]);

    // ---- Closing, Escape and the way back to My realm keep useful focus ----
    await a.page.keyboard.press('Escape'); // the fund was opened from the square's own button
    await expect(A.fund).not.toHaveAttribute('open', '');
    await expect(a.page.getByRole('button', { name: 'Project & records', exact: true })).toBeFocused();
    await a.page.locator('#village-back').click();
    await expect(a.page.locator('body')).not.toHaveAttribute('data-village-square', 'true');
    await expect(A.chip).toBeFocused();
    await expect(a.page.locator('#goal-name')).toHaveText(beforeA.goal);
    await expect(a.page.locator('#progress-amount')).toHaveText('$0.00');
    expect((await scene(a.page)).active).toBe(false);
    // Escape steps back one window at a time: the Exchange, then the fund.
    await A.chip.click(); await A.tab('families').click(); await invite.click();
    await expect(A.exchange).toHaveAttribute('open', '');
    await a.page.keyboard.press('Escape');
    await expect(A.exchange).not.toHaveAttribute('open', '');
    await expect(A.fund).toHaveAttribute('open', '');
    await expect(invite).toBeFocused();
    await a.page.keyboard.press('Escape');
    await expect(A.fund).not.toHaveAttribute('open', '');
    await expect(A.chip).toBeFocused();

    // ---- A reload keeps exactly the one receipt; nothing was sent twice ----
    await b.page.reload(); await settled(b.page);
    const reloaded = await read(b.page);
    expect(fundOf(reloaded).receipts).toEqual(paidB.receipts);
    expect(fundOf(reloaded).progress).toEqual(paidB.progress);
    expect(reloaded.progress).toEqual(beforeB.progress);
    expect(writes.b.filter((w) => w === '/api/village/payments')).toHaveLength(1);
    expect(writes.a.filter((w) => w.startsWith('/api/village/payments'))).toEqual([]);
    expect((await read(a.page)).exchange.invites.filter((i) => !i.usedAt && !i.revokedAt)).toEqual([]); // the second Invite visit made none
    expect(await fits(a.page)).toBe(true); expect(await fits(b.page)).toBe(true);
    expect([...a.errors, ...b.errors]).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect([...a.outside, ...b.outside]).toEqual([]);
    writeFileSync(`${evidence}/checks.json`, `${JSON.stringify({ project: info.project.name, viewport: info.project.use.viewport,
      seeded: { neighborhood: null, funds: 0, receipts: 0 }, shares: paidB.shares.map((x) => [x.alias, x.committedMinor, x.paidMinor]),
      shared: paidB.progress, receipts: paidB.receipts.length, sameReceiptBothFamilies: true, privateUnchanged: true,
      paymentPosts: { a: writes.a.filter((w) => w.startsWith('/api/village/payments')).length, b: writes.b.filter((w) => w === '/api/village/payments').length },
      pageErrors: [], consoleErrors, outside: [] }, null, 2)}\n`);
  } finally { await a.context.close(); await b.context.close(); await s.close(); }
});
