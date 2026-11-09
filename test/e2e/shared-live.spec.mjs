import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createMerchant } from '../../server/merchant/channel3.mjs';
import { createFakeChannel3 } from '../helpers/fake-channel3.mjs';
import { accept, createFamily, csrfFetch, familyRunner, familyServer, freePort, invite, isLive, liveState, mutableClock, openTab, person } from './support/family.mjs';

// Reliable collaboration across devices for shared families: every person is a separate browser context with its own
// virtual passkey, on an in-process family-mode server (or the real runner process) with in-memory or temporary data,
// no provider keys, simulated payments and a FAKE Channel3 transport (invented products). Every request that leaves
// the server's origin is refused and recorded. The browsers' live streams are real; nothing here is a real device,
// real network loss, real provider answer or real family.
const evidence = fileURLToPath(new URL('../../test-results/shared-live/', import.meta.url));
mkdirSync(evidence, { recursive: true });
test.use({ reducedMotion: 'reduce' });
const TENT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#fff"/><path d="M6 52 32 12l26 40Z" fill="#527557"/><path d="M32 12v40" stroke="#2c3b2e" stroke-width="2"/><path d="M26 52l6-14 6 14Z" fill="#2c3b2e"/></svg>';

const stateOf = (p, pick) => p.page.evaluate((pick) => { const s = window.__ourCastle.state; return new Function('s', `return ${pick}`)(s); }, pick);
const family = (p) => p.page.evaluate(() => window.__ourCastle.family());
// Every live-update stream request the page makes (an EventSource reconnect included).
function streamAttempts(p) {
  const attempts = [];
  p.page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/events') attempts.push(r.url()); });
  return attempts;
}
// Another adult's Build choice, saved through the same route and revision check as the Plan form uses.
const saveBuild = (p, projectKind) => p.page.evaluate(async (projectKind) => {
  const s = await (await fetch('/api/state')).json();
  const { csrfToken } = await (await fetch('/api/session')).json();
  const body = { name: s.goal.name, targetCents: s.goal.targetCents, startingCents: s.progress.startingCents, weeklyBudgetCents: s.goal.weeklyBudgetCents, targetDate: s.goal.targetDate, projectKind, expectedGoalRevision: s.merchantGoalRevision };
  return (await fetch('/api/goal', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) })).status;
}, projectKind);
async function foundHouse(owner) {
  await openTab(owner.page, 'house');
  await owner.page.locator('#house-name').fill('House of Alder');
  await owner.page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(owner.page.locator('#house-status')).toContainText('House of Alder is founded');
}
async function saveGoal(p, fields) {
  await openTab(p.page, 'plan');
  for (const [id, value] of Object.entries(fields)) {
    if (id === 'build') await p.page.getByRole('combobox', { name: 'Build', exact: true }).selectOption(value);
    else await p.page.locator(`#${id}`).fill(value);
  }
  await p.page.locator('#ask-planner').click();
  await expect(p.page.locator('#plan-status')).toContainText('Plan ready.');
}
async function closeDeed(p, name) {
  await expect(p.page.locator('#deed-dialog[open] #deed-name')).toHaveText(name);
  await p.page.locator('#deed-close').click();
  await expect(p.page.locator('#deed-dialog')).not.toHaveAttribute('open', '');
}

test('three members on their own devices and a separate family: changes arrive as they happen, work in progress survives, one contribution counts once', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'The full journey runs on desktop; the phone has its own case.');
  test.setTimeout(420_000);
  const merchant = createMerchant({ apiKey: 'fake-e2e-key-not-real', fetch: createFakeChannel3().fetch });
  const s = await familyServer({ merchant, live: { recheckMs: 1_000 } });
  const people = [];
  const join = async (name) => { const p = await person(browser, info, name, { origin: s.origin, image: TENT_SVG }); people.push(p); return p; };
  try {
    const owner = await join('Rowan');
    await createFamily(owner, s.origin, 'Rowan');
    await foundHouse(owner);
    const ashLink = await invite(owner, 'Ash', 'adult');
    const wrenLink = await invite(owner, 'Wren', 'child');
    const ash = await join('Ash'); await accept(ash, ashLink);
    const wren = await join('Wren'); await accept(wren, wrenLink);
    const fern = await join('Fern'); await createFamily(fern, s.origin, 'Fern');
    for (const p of people) await isLive(p.page);
    // Markers that a reload would erase: every change below arrives in the same document.
    for (const p of people) await p.page.evaluate(() => { window.__sameDocument = true; });
    // The owner's open page already shows the members who joined after it loaded.
    await expect.poll(() => stateOf(owner, 's.access.members.map((m) => m.name).join()')).toBe('Rowan,Ash,Wren');
    const fernBefore = await family(fern);

    // 1. The owner sets the goal and its Build choice: Ash's and Wren's pages show it without a reload or focus.
    const before = await Promise.all([ash, wren].map(family));
    await saveGoal(owner, { 'goal-name-input': 'Garden shed', 'goal-target': '80.00', 'goal-weekly': '20.00', build: 'garden' });
    for (const p of [ash, wren]) await expect(p.page.locator('#goal-name')).toHaveText('Garden shed');
    const after = await Promise.all([ash, wren].map(family));
    for (const [i, f] of after.entries()) expect(f.refreshes).toBeGreaterThan(before[i].refreshes);
    expect((await ash.page.evaluate(() => window.__ourCastle.scene())).project.stage.kind).toBe('garden');

    // 2. Work in progress: Ash tries a weekly amount, Wren is choosing an avatar, the owner is typing an invitation.
    await openTab(ash.page, 'plan');
    await ash.page.locator('#goal-weekly').fill('20.00');
    await ash.page.locator('#check-schedule').click();
    await expect(ash.page.locator('#plan-check-result')).toContainText('Up to $20.00 a week');
    await openTab(wren.page, 'house');
    await wren.page.locator('#family-avatars button[data-member]').filter({ hasText: 'Wren' }).click();
    await wren.page.getByRole('radio', { name: 'Knight' }).check();
    await openTab(owner.page, 'house');
    await owner.page.locator('#invite-name').fill('Har');
    // An unrelated change (the owner logs a gift) reaches every page; nothing anyone is editing moves.
    const quiet = await family(ash);
    expect((await csrfFetch(owner.page, 'POST', '/api/entries', { kind: 'gift_sent', amountCents: 2500, label: 'Birthday card' })).status).toBe(200);
    await expect.poll(async () => (await family(ash)).refreshes).toBeGreaterThan(quiet.refreshes);
    await expect(ash.page.locator('#goal-target')).toHaveValue('80.00');
    await expect(ash.page.locator('#goal-weekly')).toHaveValue('20.00');
    await expect(ash.page.locator('#plan-check-result')).toContainText('Up to $20.00 a week');
    await expect(wren.page.getByRole('radio', { name: 'Knight' })).toBeChecked();
    await expect(owner.page.locator('#invite-name')).toHaveValue('Har');
    // The owner saves a smaller target while all of that is open on the other devices.
    await saveGoal(owner, { 'goal-target': '60.00' });
    // Ash's unsaved fields are kept; the trial result for the old goal is cleared; nothing was overwritten.
    await expect.poll(() => stateOf(ash, 's.goal.targetCents')).toBe(6000);
    await expect(ash.page.locator('#goal-target')).toHaveValue('80.00');
    await expect(ash.page.locator('#goal-weekly')).toHaveValue('20.00');
    await expect(ash.page.locator('#plan-check-result')).toBeHidden();
    await ash.page.locator('#check-schedule').click();
    await expect(ash.page.locator('#plan-check-result')).toContainText('Load the latest goal before checking again.');
    await ash.page.locator('#plan-check-result').getByRole('button', { name: 'Load latest goal' }).click();
    await expect(ash.page.locator('#goal-target')).toHaveValue('60.00');
    await expect(ash.page.locator('#goal-weekly')).toHaveValue('20.00');
    await ash.page.locator('#check-schedule').click();
    await expect(ash.page.locator('#plan-check-result')).toContainText('Up to $20.00 a week');
    // Wren's half-chosen avatar and the owner's half-typed invitation are still there.
    await expect(wren.page.locator('#avatar-picker')).toBeVisible();
    await expect(wren.page.getByRole('radio', { name: 'Knight' })).toBeChecked();
    await openTab(owner.page, 'house');
    await expect(owner.page.locator('#invite-name')).toHaveValue('Har');
    await wren.page.getByRole('button', { name: 'Cancel' }).click();

    // 3. An approval belongs to the goal it was given for: a goal change on another device clears it, once.
    await openTab(ash.page, 'give');
    await ash.page.locator('#give-amount').fill('15.00');
    await ash.page.locator('#give-approve').check();
    await expect(ash.page.locator('#give-approve-text')).toHaveText('I approve $15.00 USD (simulated).');
    // An unrelated change leaves the approval exactly as given.
    const approved = await family(ash);
    expect((await csrfFetch(owner.page, 'POST', '/api/entries', { kind: 'gift_sent', amountCents: 1000, label: 'Thank-you card' })).status).toBe(200);
    await expect.poll(async () => (await family(ash)).refreshes).toBeGreaterThan(approved.refreshes);
    await expect(ash.page.locator('#give-approve')).toBeChecked();
    await expect(ash.page.locator('#give-amount')).toHaveValue('15.00');
    await expect(ash.page.locator('#give-status')).toHaveText('');
    // A changed goal does not.
    await saveGoal(owner, { 'goal-name-input': 'Garden shed and gate' });
    await expect(ash.page.locator('#goal-name')).toHaveText('Garden shed and gate');
    await expect(ash.page.locator('#give-approve')).not.toBeChecked();
    await expect(ash.page.locator('#give-status')).toHaveText('Approval cleared because the goal or sign-in changed. Check the amount, then approve again.');
    await expect(ash.page.locator('#simulate-pay')).toBeDisabled();
    await expect(ash.page.locator('#give-amount')).toHaveValue('15.00');

    // 4. Ash approves again and pays: one credit, the same receipt and Manor Gardens unlock on every family page.
    await openTab(owner.page, 'ledger');
    await ash.page.locator('#give-approve').check();
    await ash.page.locator('#simulate-pay').click();
    await expect(ash.page.locator('#receipt')).toBeVisible();
    const paid = await stateOf(ash, 's.contributions[0].id');
    await closeDeed(ash, 'Manor Gardens');
    for (const p of [owner, wren]) {
      await expect.poll(() => stateOf(p, '[s.contributions.length, s.contributions[0]?.id, s.progress.progressCents]')).toEqual([1, paid, 1500]);
      await expect(p.page.locator('#deed-dialog[open] #deed-name')).toHaveText('Manor Gardens');
    }
    await owner.page.screenshot({ path: `${evidence}desktop-owner-manor-from-ash.png` });
    await closeDeed(wren, 'Manor Gardens');
    // The owner visits it from the deed: the keyboard lands on its marker and stays there through live updates, both
    // when the map's buttons are untouched (a gift) and when they are rebuilt (another adult changes the Build choice).
    await owner.page.getByRole('button', { name: 'Visit Manor Gardens' }).click();
    const manor = owner.page.locator('#realm-markers [data-district="manor"]');
    await expect(manor).toBeFocused();
    const visited = await family(owner);
    expect((await csrfFetch(ash.page, 'POST', '/api/entries', { kind: 'gift_sent', amountCents: 800, label: 'Garden gloves' })).status).toBe(200);
    await expect.poll(async () => (await family(owner)).refreshes).toBeGreaterThan(visited.refreshes);
    await expect(manor).toBeFocused();
    expect(await saveBuild(ash, 'schoolhouse')).toBe(200);
    await expect(owner.page.locator('#project-marker')).toHaveAttribute('data-kind', 'schoolhouse');
    await expect(manor).toBeFocused();
    await expect(manor).toHaveAttribute('aria-pressed', 'true');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM payment_orders').get().n).toBe(1);

    // 5. The owner's Ledger keeps its filter, search, sort and selected receipt while Ash pays again; the weekly
    //    Treasury moves by live data in the same Studio instance.
    await expect(owner.page.locator('#treasury-next .next-area .next-area-meta')).toHaveText('$15.00 of $24.00 · $9.00 to go');
    await owner.page.locator('#ledger-filter').getByRole('button', { name: 'Goal progress', exact: true }).click();
    await owner.page.locator('#ledger-search').fill('simulated');
    await owner.page.locator('#ledger-goal .ag-header-cell[col-id="amount"]').click();
    await owner.page.locator('#ledger-goal .ag-row[row-id]:not([row-id="total"])').first().click();
    const sort = await owner.page.locator('#ledger-goal .ag-header-cell[col-id="amount"]').getAttribute('aria-sort');
    const selected = await owner.page.locator('#ledger-goal .ag-row-selected').getAttribute('row-id');
    await expect(owner.page.locator('#ledger-contributions')).toContainText('$15.00');
    await owner.page.evaluate(() => { window.__grid = document.querySelector('#ledger-goal .ag-root-wrapper'); window.__studio = document.querySelector('#treasury-next .ag-studio-root'); });
    const transactions = (await owner.page.evaluate(() => window.__ourCastle.treasury())).transactions;
    await ash.page.locator('#give-amount').fill('5.00');
    await ash.page.locator('#give-approve').check();
    await ash.page.locator('#simulate-pay').click();
    await expect(owner.page.locator('#treasury-next .next-area .next-area-meta')).toHaveText('$20.00 of $24.00 · $4.00 to go');
    expect((await owner.page.evaluate(() => window.__ourCastle.treasury())).transactions).toBeGreaterThan(transactions);
    await expect(owner.page.locator('#ledger-search')).toHaveValue('simulated');
    await expect(owner.page.locator('#ledger-filter').getByRole('button', { name: 'Goal progress', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(owner.page.locator('#ledger-goal .ag-header-cell[col-id="amount"]')).toHaveAttribute('aria-sort', sort);
    await expect(owner.page.locator('#ledger-goal .ag-row-selected')).toHaveAttribute('row-id', selected);
    // The keyboard stays on the same record when the new one sorts in above it.
    expect(await owner.page.evaluate(() => document.activeElement.closest('.ag-row')?.getAttribute('row-id'))).toBe(selected);
    await expect(owner.page.locator('#ledger-contributions')).toContainText('$15.00');
    expect(await owner.page.evaluate(() => window.__grid === document.querySelector('#ledger-goal .ag-root-wrapper') && window.__studio === document.querySelector('#treasury-next .ag-studio-root'))).toBe(true);
    await owner.page.locator('#panel-ledger').screenshot({ path: `${evidence}desktop-owner-ledger-live.png` });
    // The Treasury's weekly record link (Studio record selection) opens that receipt in this family's Ledger.
    await owner.page.locator('#treasury-next .treasury-week summary').click();
    await owner.page.locator('#treasury-next .treasury-week-records button', { hasText: 'Contribution · $5.00 · Simulated' }).click();
    await expect(owner.page.locator('#ledger-contributions')).toContainText('$5.00');
    await expect(owner.page.locator('#ledger-goal .ag-row-selected')).not.toHaveAttribute('row-id', selected);

    // 6. A fake Channel3 product becomes the goal only after Ash reviews a goal another adult changed meanwhile.
    await openTab(ash.page, 'plan');
    await ash.page.locator('#find-goal-item').click();
    await ash.page.locator('#merchant-query').fill('four person tent');
    await ash.page.locator('#merchant-query').press('Enter');
    const tent = ash.page.locator('#merchant-results > li').first();
    await expect(tent).toContainText('Four-person dome tent');
    await tent.getByRole('button', { name: 'Use as goal' }).click();
    await expect(ash.page.locator('#goal-draft')).toBeVisible();
    await saveGoal(owner, { 'goal-weekly': '25.00' });
    await expect.poll(() => stateOf(ash, 's.goal.weeklyBudgetCents')).toBe(2500);
    await expect(ash.page.locator('#goal-draft')).toBeVisible(); // the draft and its fields stay
    await expect(ash.page.locator('#goal-target')).toHaveValue('189.50');
    await ash.page.locator('#goal-draft-save').click();
    await expect(ash.page.locator('#plan-status')).toContainText('The household goal changed. Review the latest goal before saving this item.');
    await ash.page.locator('#goal-draft-review').click();
    await expect(ash.page.locator('#plan-status')).toContainText('Latest household goal loaded.');
    await expect(ash.page.locator('#goal-weekly')).toHaveValue('25.00');
    await ash.page.locator('#goal-draft-save').click();
    await expect(ash.page.locator('#plan-status')).toContainText('Goal saved: Test fixture: Four-person dome tent, $189.50.');
    for (const p of [owner, wren]) await expect(p.page.locator('#goal-name')).toHaveText('Test fixture: Four-person dome tent');
    expect(await stateOf(wren, 's.goalItem?.title')).toBe('Test fixture: Four-person dome tent');

    // 7. The child sees no steward or payment actions the server would refuse; the other family heard nothing at all.
    await openTab(wren.page, 'ledger');
    await expect(wren.page.locator('#steward-note')).toHaveText('An adult in the family can ask the steward.');
    await expect(wren.page.locator('#steward-form')).toBeHidden();
    expect((await csrfFetch(wren.page, 'POST', '/api/steward', { question: 'Is anything still pending?' })).status).toBe(403);
    const fernAfter = await family(fern);
    expect([fernAfter.refreshes, fernAfter.revision, fernAfter.discarded]).toEqual([fernBefore.refreshes, fernBefore.revision, 0]);
    expect(await stateOf(fern, '[s.goal.name, s.contributions.length, s.members.map((m) => m.name).join()]')).toEqual(['Our first goal', 0, 'Fern']);

    // 8. Removing Wren's access ends Wren's open page at once; no stream, listener or timer is left once pages close.
    await openTab(owner.page, 'house');
    await owner.page.getByRole('button', { name: 'Remove Wren\'s access' }).click();
    await expect(wren.page.locator('#access-dialog')).toBeVisible();
    await expect(wren.page.locator('#access-status')).toHaveText('Your access to this family was removed.');
    await wren.page.locator('#access-dialog').screenshot({ path: `${evidence}desktop-child-removed-live.png` });
    for (const p of people) {
      expect(await p.page.evaluate(() => window.__sameDocument)).toBe(true);
      await expect(p.page.locator('#live-status')).toBeHidden();
      expect(p.errors, p.name).toEqual([]);
      expect(p.outside, p.name).toEqual([]);
    }
    for (const p of people) await p.context.close();
    await expect.poll(() => s.app.live.stats().streams).toBe(0);
    expect(s.app.live.stats().timer).toBe(false);
  } finally {
    for (const p of people) await p.context.close().catch(() => {});
    await s.close();
  }
});

test('a dropped connection shows one Reconnect control and catches up; an idle session ends during the connection', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'The phone has its own case.');
  test.setTimeout(240_000);
  const clock = mutableClock();
  const s = await familyServer({ clock, live: { recheckMs: 1_000 } });
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan', { origin: s.origin }); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    await foundHouse(owner);
    const ash = await person(browser, info, 'Ash', { origin: s.origin }); people.push(ash);
    await accept(ash, await invite(owner, 'Ash', 'adult'));
    for (const p of people) await isLive(p.page);

    // Ash's device loses the network: its open connections drop and new ones fail. (Chromium's offline emulation stops
    // new requests only, so the server also closes every open connection; the owner's page reconnects by itself.)
    // Brief drops say nothing; after a few seconds one compact control appears.
    await ash.context.setOffline(true);
    s.cut();
    await expect.poll(() => liveState(ash.page)).toBe('down');
    await expect(ash.page.locator('#live-status')).toBeHidden();
    await expect(ash.page.locator('#live-status')).toBeVisible({ timeout: 20_000 });
    await expect(ash.page.locator('#live-retry')).toHaveAccessibleName('Updates paused. Reconnect');
    expect(await ash.page.locator('.live-status:visible').count()).toBe(1);
    await ash.page.locator('.topbar').screenshot({ path: `${evidence}desktop-reconnect.png` });
    // Meanwhile the owner saves a goal; Ash's page cannot know yet.
    await saveGoal(owner, { 'goal-name-input': 'Rope swing', 'goal-target': '40.00' });
    await expect(ash.page.locator('#goal-name')).not.toHaveText('Rope swing');
    // Reconnect tries again at once rather than after the backoff; while the device is still offline, the control stays.
    const attempts = streamAttempts(ash);
    await ash.page.locator('#live-retry').click();
    await expect.poll(() => attempts.length).toBeGreaterThan(0);
    await expect(ash.page.locator('#live-status')).toBeVisible();
    // Back online: the stream returns, and the page reads what changed while it was away.
    await ash.context.setOffline(false);
    await isLive(ash.page);
    await expect(ash.page.locator('#goal-name')).toHaveText('Rope swing');
    await expect(ash.page.locator('#live-status')).toBeHidden();

    // A second, shorter drop recovers by itself (no click): the browser and the page's backoff reconnect.
    await ash.context.setOffline(true);
    s.cut();
    await expect.poll(() => liveState(ash.page)).toBe('down');
    await saveGoal(owner, { 'goal-target': '45.00' });
    await ash.context.setOffline(false);
    await isLive(ash.page);
    await expect.poll(() => stateOf(ash, 's.goal.targetCents')).toBe(4500);

    // 31 idle minutes on the server's clock: both open streams end and both pages ask for the passkey, without a click.
    clock.advance(31 * 60_000);
    for (const p of people) {
      await expect(p.page.locator('#access-dialog')).toBeVisible();
      await expect(p.page.locator('#access-status')).toHaveText('Your session ended. Sign in again with your passkey.');
    }
    await expect.poll(() => s.app.live.stats().streams).toBe(0);
    await ash.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await isLive(ash.page);
    await expect(ash.page.locator('#goal-name')).toHaveText('Rope swing');
    for (const p of people) { expect(p.errors, p.name).toEqual([]); expect(p.outside, p.name).toEqual([]); }
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});

test('a real restart of the family runner: open pages reconnect by themselves and keep receiving changes', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'Viewport-independent.');
  test.setTimeout(240_000);
  const port = await freePort();
  const runner = familyRunner({ port, data: mkdtempSync(path.join(tmpdir(), 'our-castle-live-runner-')) });
  let child = await runner.start();
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan', { origin: runner.origin }); people.push(owner);
    await createFamily(owner, runner.origin, 'Rowan');
    await foundHouse(owner);
    const ash = await person(browser, info, 'Ash', { origin: runner.origin }); people.push(ash);
    await accept(ash, await invite(owner, 'Ash', 'adult'));
    for (const p of people) await isLive(p.page);
    await saveGoal(owner, { 'goal-name-input': 'Tree house', 'goal-target': '120.00' });
    await expect(ash.page.locator('#goal-name')).toHaveText('Tree house');
    // Ash approves an amount, and the server restarts before Ash pays.
    await openTab(ash.page, 'give');
    await ash.page.locator('#give-amount').fill('30.00');
    await ash.page.locator('#give-approve').check();
    const boot = (await family(ash)).revision.split('.')[0];
    for (const p of people) await p.page.evaluate(() => { window.__sameDocument = true; });

    await runner.stop(child);
    await expect.poll(() => liveState(ash.page)).toBe('down');
    child = await runner.start();
    for (const p of people) await isLive(p.page);
    expect((await family(ash)).revision.split('.')[0]).not.toBe(boot);
    // The same session and goal: reconnecting keeps the approval as given, and nothing was paid or replayed.
    await expect(ash.page.locator('#give-approve')).toBeChecked();
    await expect(ash.page.locator('#give-status')).toHaveText('');
    expect(await stateOf(owner, 's.contributions.length')).toBe(0);
    // After the restart, a change on one device still reaches the other one live; sessions survived the restart.
    await saveGoal(owner, { 'goal-weekly': '30.00' });
    await expect.poll(() => stateOf(ash, 's.goal.weeklyBudgetCents')).toBe(3000);
    await ash.page.locator('#simulate-pay').click();
    await expect(ash.page.locator('#receipt')).toBeVisible();
    await expect.poll(() => stateOf(owner, '[s.contributions.length, s.progress.progressCents]')).toEqual([1, 3000]);
    for (const p of people) {
      expect(await p.page.evaluate(() => window.__sameDocument)).toBe(true);
      expect(p.errors, p.name).toEqual([]); expect(p.outside, p.name).toEqual([]);
    }
  } finally {
    for (const p of people) await p.context.close();
    await runner.stop(child);
  }
});

test('two 390 px phones: a change arrives live and the Reconnect control fits with a full-size target', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The phone case.');
  test.setTimeout(240_000);
  const s = await familyServer({ live: { recheckMs: 1_000 } });
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan', { origin: s.origin }); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    const ash = await person(browser, info, 'Ash', { origin: s.origin }); people.push(ash);
    await accept(ash, await invite(owner, 'Ash', 'adult'));
    for (const p of people) await isLive(p.page);
    await saveGoal(owner, { 'goal-name-input': 'Bunk beds', 'goal-target': '90.00' });
    await expect(ash.page.locator('#goal-name')).toHaveText('Bunk beds');
    await ash.context.setOffline(true);
    s.cut();
    await expect(ash.page.locator('#live-status')).toBeVisible({ timeout: 20_000 });
    const box = await ash.page.locator('#live-retry').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await ash.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The top bar's own controls stay on screen beside it.
    for (const sel of ['#signed-in', '#journal-toggle', '#sound-toggle']) {
      const b = await ash.page.locator(sel).boundingBox();
      expect(b.x + b.width, sel).toBeLessThanOrEqual(390);
    }
    await ash.page.screenshot({ path: `${evidence}phone-reconnect.png` });
    const attempts = streamAttempts(ash);
    await ash.page.locator('#live-retry').tap();
    await expect.poll(() => attempts.length).toBeGreaterThan(0);
    await ash.context.setOffline(false);
    await isLive(ash.page);
    await expect(ash.page.locator('#live-status')).toBeHidden();
    for (const p of people) { expect(p.errors, p.name).toEqual([]); expect(p.outside, p.name).toEqual([]); }
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});
