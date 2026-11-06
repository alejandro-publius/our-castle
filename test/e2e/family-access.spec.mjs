import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';

// Shared families with real passkeys: Chromium's virtual authenticator (WebAuthn over CDP) creates and uses credentials
// that the server verifies with the pinned @simplewebauthn/server. Each person is an independent browser context with its
// own authenticator. Servers run in family mode on their own ports with in-memory or temporary data; no provider keys.
// The virtual authenticator is not a real device, platform biometric or Face ID test.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/family-access/', import.meta.url));
mkdirSync(evidence, { recursive: true });
test.use({ reducedMotion: 'reduce' });

function mutableClock() {
  let offset = 0;
  const base = createClock();
  return { now: () => new Date(Date.now() + offset), iso() { return this.now().toISOString(); }, today() { const d = this.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, advance(ms) { offset += ms; }, base };
}
async function familyServer({ clock = createClock() } = {}) {
  const db = openDatabase(':memory:');
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  app = createApp({ config: loadConfig({ OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: origin }, { root }), db, clock, root });
  return { origin, db, clock, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => { db.close(); resolve(); }); }) };
}
async function person(browser, info, name) {
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { name, context, page, cdp, authenticatorId, errors };
}
const settled = (page, expected = true) => expect.poll(async () => {
  try { return await page.evaluate(() => document.body.dataset.ready === 'true' && Boolean(window.__ourCastle?.state?.access)); } catch { return false; }
}, { timeout: 30_000 }).toBe(expected);
async function openTab(page, tab) {
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator(`#tab-${tab}`).click();
  await expect(page.locator(`#panel-${tab}`)).toBeVisible();
}
async function createFamily(p, origin, name) {
  await p.page.goto(origin + '/');
  await expect(p.page.locator('#access-dialog')).toBeVisible();
  await p.page.getByRole('button', { name: 'Start a new family' }).click();
  await p.page.getByLabel('Your name').fill(name);
  await p.page.getByRole('button', { name: 'Create passkey and family' }).click();
  await settled(p.page);
}
async function invite(owner, name, role) {
  await openTab(owner.page, 'house');
  await owner.page.locator('#invite-name').fill(name);
  await owner.page.locator('#invite-role').selectOption(role);
  await owner.page.getByRole('button', { name: 'Create invitation' }).click();
  // Wait for this invitation's own link (a previous one stays on screen until the new one arrives).
  await expect(owner.page.locator('#invite-result')).toContainText(`Send this link to ${name} yourself.`);
  const link = owner.page.locator('#invite-link');
  await expect(link).toHaveAttribute('aria-label', `Invitation link for ${name}`);
  await expect(link).toHaveValue(/#invite=[A-Za-z0-9_-]{43}$/);
  return link.inputValue();
}
async function accept(p, link) {
  await p.page.goto(link);
  await expect(p.page.getByRole('button', { name: 'Create passkey and join' })).toBeVisible();
  expect(new URL(p.page.url()).hash).toBe(''); // the token left the address bar at once
  await p.page.getByRole('button', { name: 'Create passkey and join' }).click();
  await settled(p.page);
}
// Collaborators' pages read fresh state on focus or visibility (at most every 5 s), never by reloading.
async function refresh(page) {
  await page.waitForTimeout(5_200);
  const before = await page.evaluate(() => window.__ourCastle.family().refreshes);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => window.__ourCastle.family().refreshes)).toBeGreaterThan(before);
}
// The same nudge when the read is expected to fail (an ended session): no success to wait for.
async function poke(page) { await page.waitForTimeout(5_200); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }
const csrfFetch = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const { csrfToken } = await (await fetch('/api/session')).json();
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}, { method, url, body });

test('a family with passkeys: owner, adult and child in their own browsers; a separate family stays apart', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'The full journey runs on desktop; the phone fit has its own case.');
  test.setTimeout(240_000);
  const s = await familyServer();
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan'); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    await expect(owner.page.locator('#signed-in')).toHaveText('Rowan · Adult');
    await expect(owner.page.locator('#persona')).toBeHidden();
    await openTab(owner.page, 'house');
    await owner.page.locator('#house-name').fill('House of Alder');
    await owner.page.getByRole('button', { name: 'Raise our banner' }).click();
    await expect(owner.page.locator('#house-status')).toContainText('House of Alder is founded');
    const ashLink = await invite(owner, 'Ash', 'adult');
    const wrenLink = await invite(owner, 'Wren', 'child');
    await owner.page.locator('#panel-house').screenshot({ path: `${evidence}desktop-owner-invitations.png` });

    const ash = await person(browser, info, 'Ash'); people.push(ash);
    await accept(ash, ashLink);
    const wren = await person(browser, info, 'Wren'); people.push(wren);
    await wren.page.goto(wrenLink);
    await expect(wren.page.locator('#access-title')).toHaveText('Join House of Alder');
    await expect(wren.page.locator('#access-body')).toContainText('You are invited as Wren · Child.');
    await wren.page.locator('#access-dialog').screenshot({ path: `${evidence}desktop-child-invitation.png` });
    await wren.page.getByRole('button', { name: 'Create passkey and join' }).click();
    await settled(wren.page);
    await expect(ash.page.locator('#signed-in')).toHaveText('Ash · Adult');
    await expect(wren.page.locator('#signed-in')).toHaveText('Wren · Child');
    for (const p of [ash, wren]) expect(await p.page.evaluate(() => window.__ourCastle.state.household.name)).toBe('House of Alder');

    // The owner chooses the goal and what it builds; Ash's open page picks it up on focus, without a reload.
    await openTab(owner.page, 'plan');
    await owner.page.locator('#goal-name-input').fill('Garden shed');
    await owner.page.locator('#goal-target').fill('300.00');
    await owner.page.locator('#goal-weekly').fill('30.00');
    await owner.page.getByRole('combobox', { name: 'Build', exact: true }).selectOption('garden');
    await owner.page.locator('#ask-planner').click();
    await expect(owner.page.locator('#plan-status')).toContainText('Plan ready.');
    await refresh(ash.page);
    await expect(ash.page.locator('#goal-name')).toHaveText('Garden shed');
    expect((await ash.page.evaluate(() => window.__ourCastle.scene())).project.stage.kind).toBe('garden');

    // Ash edits a weekly amount while the owner saves a larger goal: Ash's save is refused, nothing is overwritten,
    // "Load latest goal" brings the owner's figure and keeps Ash's own edit.
    await openTab(ash.page, 'plan');
    await ash.page.locator('#goal-weekly').fill('25.00');
    await owner.page.locator('#goal-target').fill('320.00');
    await owner.page.locator('#ask-planner').click();
    await expect(owner.page.locator('#plan-status')).toContainText('Plan ready.');
    await ash.page.locator('#ask-planner').click();
    await expect(ash.page.locator('#plan-status')).toContainText('Someone saved a newer goal.');
    await ash.page.locator('#plan-status').getByRole('button', { name: 'Load latest goal' }).click();
    await expect(ash.page.locator('#goal-target')).toHaveValue('320.00');
    await expect(ash.page.locator('#goal-weekly')).toHaveValue('25.00');
    await ash.page.locator('#ask-planner').click();
    await expect(ash.page.locator('#plan-status')).toContainText('Plan ready.');
    const goal = s.db.prepare('SELECT target_cents, weekly_budget_cents, project_kind FROM goals WHERE name = ?').get('Garden shed');
    expect({ ...goal }).toEqual({ target_cents: 32000, weekly_budget_cents: 2500, project_kind: 'garden' });

    // The owner approves one simulated contribution; Ash and Wren see it once.
    await openTab(owner.page, 'give');
    await owner.page.locator('#give-amount').fill('15.00');
    await owner.page.locator('#give-approve').check();
    await owner.page.locator('#simulate-pay').click();
    await expect(owner.page.locator('#receipt')).toBeVisible();
    for (const p of [ash, wren]) {
      await refresh(p.page);
      await expect.poll(() => p.page.evaluate(() => [window.__ourCastle.state.contributions.length, window.__ourCastle.state.progress.progressCents])).toEqual([1, 1500]);
    }

    // Wren explores and changes only their own avatar; plans and payments are refused, in the page and over HTTP.
    await openTab(wren.page, 'plan');
    await expect(wren.page.locator('#planner-lede')).toHaveText('Adults in the family change the goal and the plan.');
    await expect(wren.page.locator('#ask-planner')).toBeDisabled();
    await wren.page.locator('#panel-plan').screenshot({ path: `${evidence}desktop-child-plan.png` });
    await openTab(wren.page, 'give');
    await expect(wren.page.locator('#simulate-pay')).toBeDisabled();
    for (const [method, url, body] of [['POST', '/api/example/contributions', { amountCents: 1500, approvalConfirmed: true, requestId: 'wren-bypass-000001' }], ['POST', '/api/plans', { commitments: [] }], ['POST', '/api/family/invitations', { name: 'Eve', role: 'adult' }]]) {
      const r = await csrfFetch(wren.page, method, url, body);
      expect(r.status, url).toBe(403);
    }
    await openTab(wren.page, 'house');
    await expect(wren.page.locator('#family-avatars button[data-member]').filter({ hasText: 'Rowan' })).toBeDisabled();
    await wren.page.locator('#family-avatars button[data-member]').filter({ hasText: 'Wren' }).click();
    await wren.page.getByRole('radio', { name: 'Knight' }).check();
    await wren.page.getByRole('button', { name: 'Save avatar' }).click();
    await expect(wren.page.locator('.avatar-status')).toContainText('Wren’s avatar saved.');

    // A separate family sees only itself and cannot name the first household.
    const fern = await person(browser, info, 'Fern'); people.push(fern);
    await createFamily(fern, s.origin, 'Fern');
    expect(await fern.page.evaluate(() => window.__ourCastle.state.members.map((m) => m.name))).toEqual(['Fern']);
    const firstHousehold = await owner.page.evaluate(() => window.__ourCastle.state.household.id);
    const spoof = await csrfFetch(fern.page, 'POST', '/api/example/contributions', { householdId: firstHousehold, amountCents: 1500, approvalConfirmed: true, requestId: 'fern-spoof-0000001' });
    expect(spoof.status).toBe(403); expect(spoof.body.error.code).toBe('scope_mismatch');

    // The owner removes Wren's access: Wren's next read ends the session, and the passkey no longer signs in.
    await openTab(owner.page, 'house');
    await owner.page.getByRole('button', { name: 'Remove Wren\'s access' }).click();
    await expect(owner.page.locator('#family-access li[data-member]').filter({ hasText: 'Wren' })).toContainText('no access');
    await expect(owner.page.locator('#invite-result')).toBeHidden(); // both invitations used: no link (or token) on screen
    await owner.page.locator('#panel-house').screenshot({ path: `${evidence}desktop-owner-access.png` });
    await poke(wren.page);
    await expect(wren.page.locator('#access-dialog')).toBeVisible();
    await expect(wren.page.locator('#access-status')).toContainText('Your session ended');
    await wren.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(wren.page.locator('#access-status')).toContainText('no longer has access');
    await wren.page.locator('#access-dialog').screenshot({ path: `${evidence}desktop-revoked-child.png` });

    // Ash signs out and back in with the same passkey.
    await openTab(ash.page, 'house');
    await ash.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(ash.page.locator('#access-dialog')).toBeVisible();
    await ash.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await settled(ash.page);
    await expect(ash.page.locator('#signed-in')).toHaveText('Ash · Adult');

    const audit = s.db.prepare('SELECT action FROM audit_events').all().map((r) => r.action);
    for (const action of ['family.created', 'invitation.created', 'invitation.accepted', 'member.access_revoked', 'session.signed_out', 'session.refused_revoked']) expect(audit).toContain(action);
    for (const p of people) expect(p.errors, p.name).toEqual([]);
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});

test('an expired session returns to sign-in cleanly; expired, withdrawn and broken invitation links explain themselves', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'Viewport-independent.');
  test.setTimeout(150_000);
  const clock = mutableClock();
  const s = await familyServer({ clock });
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan'); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    const expiring = await invite(owner, 'Ash', 'adult');
    const withdrawn = await invite(owner, 'Fern', 'adult');
    await owner.page.getByRole('button', { name: 'Withdraw the invitation for Fern' }).click();
    await expect(owner.page.locator('#family-access li[data-status="revoked"]')).toContainText('Fern');
    // 31 idle minutes on the server's clock: the next quiet refresh finds the session over and asks for the passkey.
    clock.advance(31 * 60_000);
    await poke(owner.page);
    await expect(owner.page.locator('#access-dialog')).toBeVisible();
    await expect(owner.page.locator('#access-status')).toContainText('Your session ended');
    await owner.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await settled(owner.page);
    await expect(owner.page.locator('#signed-in')).toHaveText('Rowan · Adult');

    const guest = await person(browser, info, 'Guest'); people.push(guest);
    for (const [link, message] of [[withdrawn, 'This invitation was withdrawn.'], [`${s.origin}/#invite=not-a-real-invitation-token`, 'This invitation link is not valid.']]) {
      await guest.page.goto(link);
      await expect(guest.page.locator('#access-status')).toHaveText(message);
      await expect(guest.page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
    }
    clock.advance(49 * 3_600_000);
    await guest.page.goto(expiring);
    await expect(guest.page.locator('#access-status')).toHaveText('This invitation has expired. Ask the family for a new one.');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n).toBe(1);
  } finally {
    for (const p of people) await p.context.close();
    await s.close();
  }
});

test('a real restart of the family runner keeps the family and the signed-in session', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'Viewport-independent.');
  test.setTimeout(120_000);
  const port = await new Promise((resolve) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); }); });
  const data = mkdtempSync(path.join(tmpdir(), 'our-castle-family-runner-'));
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/family.mjs', '--port', String(port), '--data', data], { cwd: root, env: { PATH: process.env.PATH, OUR_CASTLE_ENV_FILE: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('Press Ctrl+C')) resolve(child); });
    child.on('exit', (code) => reject(new Error(`family runner exited ${code}: ${out}`)));
  });
  const stop = (child) => new Promise((resolve) => { child.removeAllListeners('exit'); child.once('exit', resolve); child.kill('SIGTERM'); });
  const origin = `http://localhost:${port}`;
  let runner = await start();
  const owner = await person(browser, info, 'Rowan');
  try {
    await createFamily(owner, origin, 'Rowan');
    const before = await owner.page.evaluate(() => ({ household: window.__ourCastle.state.household.id, members: window.__ourCastle.state.access.members }));
    await stop(runner);
    runner = await start();
    await owner.page.reload();
    await settled(owner.page);
    expect(await owner.page.evaluate(() => ({ household: window.__ourCastle.state.household.id, members: window.__ourCastle.state.access.members }))).toEqual(before);
    expect(owner.errors).toEqual([]);
  } finally {
    await owner.context.close();
    await stop(runner);
  }
});

test('sign-in and the family section fit a 390 px phone with full-size touch targets', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone', 'The phone case.');
  test.setTimeout(120_000);
  const s = await familyServer();
  const owner = await person(browser, info, 'Rowan');
  try {
    await owner.page.goto(s.origin + '/');
    await expect(owner.page.locator('#access-dialog')).toBeVisible();
    await owner.page.screenshot({ path: `${evidence}phone-sign-in.png` });
    for (const name of ['Sign in with a passkey', 'Start a new family']) expect((await owner.page.getByRole('button', { name }).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await owner.page.getByRole('button', { name: 'Start a new family' }).tap();
    await expect(owner.page.getByLabel('Your name')).toBeVisible();
    await owner.page.keyboard.press('Escape'); // steps back, never into an empty household
    await expect(owner.page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
    await owner.page.getByRole('button', { name: 'Start a new family' }).tap();
    await owner.page.getByLabel('Your name').fill('Rowan');
    await owner.page.getByRole('button', { name: 'Create passkey and family' }).tap();
    await settled(owner.page);
    await invite(owner, 'Wren', 'child');
    for (const sel of ['#invite-name', '#invite-role', '#copy-invite', '#sign-out', '#add-passkey']) expect((await owner.page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
    await owner.page.getByRole('button', { name: 'Withdraw the invitation for Wren' }).tap();
    await expect(owner.page.locator('#family-access li[data-status="revoked"]')).toContainText('Wren');
    await expect(owner.page.locator('#invite-result')).toBeHidden(); // a withdrawn invitation's link leaves the screen
    await owner.page.locator('#panel-house').screenshot({ path: `${evidence}phone-family-section.png` });
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(owner.errors).toEqual([]);
  } finally {
    await owner.context.close();
    await s.close();
  }
});
