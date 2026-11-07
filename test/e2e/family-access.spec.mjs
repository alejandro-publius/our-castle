import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { accept, createFamily, csrfFetch, familyRunner, familyServer, freePort, invite, isLive, mutableClock, openTab, person, settled } from './support/family.mjs';
import { buildPlanText, rulesAmounts } from '../../server/planner/basis.mjs';

// Shared families with real passkeys: Chromium's virtual authenticator (WebAuthn over CDP) creates and uses credentials
// that the server verifies with the pinned @simplewebauthn/server. Each person is an independent browser context with its
// own authenticator. Servers run in family mode on their own ports with in-memory or temporary data; no provider keys.
// The virtual authenticator is not a real device, platform biometric or Face ID test. Open pages receive each other's
// changes through the live-update stream (shared-live.spec.mjs tests that stream in depth).
const evidence = fileURLToPath(new URL('../../test-results/family-access/', import.meta.url));
mkdirSync(evidence, { recursive: true });
test.use({ reducedMotion: 'reduce' });

test('a family with passkeys: owner, adult and child in their own browsers; a separate family stays apart', { tag: '@release' }, async ({ browser }, info) => {
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

    // The owner chooses the goal and what it builds; Ash's open page picks it up as it happens, without a reload.
    for (const p of [owner, ash, wren]) await isLive(p.page);
    await openTab(owner.page, 'plan');
    await owner.page.locator('#goal-name-input').fill('Garden shed');
    await owner.page.locator('#goal-target').fill('300.00');
    await owner.page.locator('#goal-weekly').fill('30.00');
    await owner.page.getByRole('combobox', { name: 'Build', exact: true }).selectOption('garden');
    await owner.page.locator('#ask-planner').click();
    await expect(owner.page.locator('#plan-status')).toContainText('Plan ready.');
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

    // The owner removes Wren's access: Wren's open page ends its session at once, and the passkey no longer signs in.
    await openTab(owner.page, 'house');
    await owner.page.getByRole('button', { name: 'Remove Wren\'s access' }).click();
    await expect(owner.page.locator('#family-access li[data-member]').filter({ hasText: 'Wren' })).toContainText('no access');
    await expect(owner.page.locator('#invite-result')).toBeHidden(); // both invitations used: no link (or token) on screen
    await owner.page.locator('#panel-house').screenshot({ path: `${evidence}desktop-owner-access.png` });
    await expect(wren.page.locator('#access-dialog')).toBeVisible();
    await expect(wren.page.locator('#access-status')).toContainText('Your access to this family was removed.');
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
  const s = await familyServer({ clock, live: { recheckMs: 1_000 } });
  const people = [];
  try {
    const owner = await person(browser, info, 'Rowan'); people.push(owner);
    await createFamily(owner, s.origin, 'Rowan');
    const expiring = await invite(owner, 'Ash', 'adult');
    const withdrawn = await invite(owner, 'Fern', 'adult');
    await owner.page.getByRole('button', { name: 'Withdraw the invitation for Fern' }).click();
    await expect(owner.page.locator('#family-access li[data-status="revoked"]')).toContainText('Fern');
    // 31 idle minutes on the server's clock: the open page's live stream finds the session over and asks for the passkey.
    await isLive(owner.page);
    clock.advance(31 * 60_000);
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

test('an answer refused after this browser signed in again in another tab keeps the page and saves nothing', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'Viewport-independent.');
  test.setTimeout(120_000);
  // A plan request waits on a gated fake planner (no model is called). Meanwhile a second tab of the same browser, opened
  // while signed out, signs in with the owner's own passkey, copied to that tab's virtual authenticator, so the server
  // rotates the session. The old request's answer is refused and its plan is not saved; the first tab keeps the newer
  // session instead of asking for the passkey again.
  const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
  const entered = gate(), finish = gate();
  let asks = 0;
  const aiProvider = {
    provider: 'anthropic', model: 'fake-planner',
    async proposePlan(basis) {
      if (++asks === 1) { entered.release(); await finish.promise; }
      return { output: buildPlanText(basis, rulesAmounts(basis)), model: 'fake-planner', requestId: `fake-plan-${asks}` };
    },
  };
  const s = await familyServer({ aiProvider });
  const owner = await person(browser, info, 'Rowan', { origin: s.origin });
  try {
    const second = await owner.context.newPage();
    const secondErrors = [];
    second.on('pageerror', (e) => secondErrors.push(e.message));
    const cdp = await owner.context.newCDPSession(second);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await second.goto(s.origin + '/');
    await expect(second.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

    await createFamily(owner, s.origin, 'Rowan');
    await openTab(owner.page, 'house');
    await owner.page.locator('#house-name').fill('House of Alder');
    await owner.page.getByRole('button', { name: 'Raise our banner' }).click();
    await expect(owner.page.locator('#house-status')).toContainText('House of Alder is founded');
    await isLive(owner.page);
    const { credentials } = await owner.cdp.send('WebAuthn.getCredentials', { authenticatorId: owner.authenticatorId });
    expect(credentials).toHaveLength(1);
    await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: credentials[0] });

    await openTab(owner.page, 'plan');
    await owner.page.locator('#goal-name-input').fill('Garden shed');
    await owner.page.locator('#goal-target').fill('300.00');
    await owner.page.locator('#goal-weekly').fill('30.00');
    await owner.page.locator('#ask-planner').click();
    await entered.promise;
    await second.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await settled(second);
    await expect(second.locator('#signed-in')).toHaveText('Rowan · Adult');
    finish.release();

    await expect(owner.page.locator('#plan-status')).toContainText('This browser signed in again while this was in progress.');
    await expect(owner.page.locator('#access-dialog')).toBeHidden();
    expect(await owner.page.evaluate(() => document.body.dataset.signedIn)).not.toBe('false');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n).toBe(0);
    // The kept page goes on with the newer session and its CSRF token: the same request now succeeds.
    await owner.page.locator('#ask-planner').click();
    await expect(owner.page.locator('#plan-status')).toContainText('The AI plan passed every server check.');
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM plans').get().n).toBe(1);
    expect(owner.errors).toEqual([]);
    expect(secondErrors).toEqual([]);
    expect(owner.outside).toEqual([]);
  } finally {
    finish.release();
    await owner.context.close();
    await s.close();
  }
});

test('a real restart of the family runner keeps the family and the signed-in session', async ({ browser }, info) => {
  test.skip(info.project.name === 'phone', 'Viewport-independent.');
  test.setTimeout(120_000);
  const port = await freePort();
  const data = mkdtempSync(path.join(tmpdir(), 'our-castle-family-runner-'));
  const { start, stop, origin } = familyRunner({ port, data });
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
