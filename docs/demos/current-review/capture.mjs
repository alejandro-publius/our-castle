// Record and check a clean public build using ONLY `npm run demo` and a new,
// unauthenticated development browser. No owner profile, .env, disk household,
// provider key, PayPal order, product search, or runtime AI call is used.
// node capture.mjs --app-root /path/to/fresh/clone --out /ignored/output
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--app-root') || !args.includes('--out')) throw Error('Supply --app-root and --out.');
const root = resolve(arg('--app-root')), out = resolve(arg('--out'));
mkdirSync(out, { recursive: true });
const { chromium, expect } = createRequire(join(root, 'package.json'))('@playwright/test');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Use an unchanged source checkout.');
const app = spawn('npm', ['run', 'demo'], { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', stderr = '', base, browser, context, video, start, page;
const phases = [], checks = [], errors = [], writes = [], outside = [];
app.stdout.on('data', (b) => { log += b; base ??= log.match(/Our Castle demo: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]; });
app.stderr.on('data', (b) => { stderr += b; });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (id) => { const phase = { id, seconds: +(performance.now() - start).toFixed(1) / 1000 }; phases.push(phase); console.log('PHASE', id, phase.seconds); return phase; };
const record = (id, value = true) => { checks.push({ id, value }); console.log('PASS', id); };
const state = () => page.evaluate(() => window.__ourCastle.state);
const menu = async (id) => { const m = page.locator('#' + id); if (!await m.evaluate((el) => el.open)) await m.locator(':scope > summary').click(); };
const journal = async () => { if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click(); };
const area = async (id) => { await menu('district-menu'); await page.locator(`#realm-districts [data-district="${id}"]`).click(); };
const shot = (name) => page.screenshot({ path: join(out, name + '.png') });
async function pay(amount, expectedDeeds) {
  await journal(); await page.locator('#tab-give').click();
  await page.locator('#give-amount').fill(amount);
  await expect(page.locator('#give-approve')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Simulate approved payment', exact: true })).toBeDisabled();
  await page.locator('#give-approve').check();
  await page.getByRole('button', { name: 'Simulate approved payment', exact: true }).click();
  for (const [i, name] of expectedDeeds.entries()) {
    await expect(page.locator('#deed-dialog')).toBeVisible({ timeout: 35000 });
    await expect(page.locator('#deed-name')).toHaveText(name);
    mark('deed-' + name.toLowerCase().replaceAll(/[^a-z]+/g, '-'));
    await delay(4800); await shot('deed-' + name.toLowerCase().replaceAll(/[^a-z]+/g, '-'));
    await page.locator(i < expectedDeeds.length - 1 ? '#deed-next' : '#deed-close').click();
    await delay(350);
  }
}
let report;
try {
  for (let i = 0; !base && i < 150; i++) { if (app.exitCode !== null) throw Error('Demo launcher exited.'); await delay(100); }
  assert.ok(base, 'Demo launcher did not print a URL.');
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.payments.mode, 'example'); assert.equal(status.ai.mode, 'example'); assert.equal(status.merchant.mode, 'off');
  record('public-launcher-example-only');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce', recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base && !['data:', 'blob:', 'about:'].includes(url.protocol)) { outside.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
  start = performance.now(); page = await context.newPage(); video = page.video();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (r.method() !== 'GET' && r.url().startsWith(base + '/')) writes.push({ path: new URL(r.url()).pathname, method: r.method(), seconds: (performance.now() - start) / 1000 }); });
  page.setDefaultTimeout(25000);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true' && window.__ourCastle?.scene());
  const initial = await state();
  assert.equal(initial.progress.progressCents, 6000); assert.equal(initial.goal.targetCents, 30000); assert.equal(initial.contributions.length, 0);
  await page.locator('#close-journal').click();
  await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  mark('realm-intro'); await delay(6500); await shot('current-realm');
  await journal(); mark('family');
  await page.locator('input[name="playMode"][value="family"]').check();
  await page.locator('#house-name').fill('House of Alder');
  await page.locator('input[name="crestField"][value="cobalt"]').check({ force: true });
  await page.locator('input[name="crestCharge"][value="stag"]').check({ force: true });
  await delay(1800); await page.getByRole('button', { name: 'Raise our banner' }).click();
  await expect(page.locator('#house-status')).toContainText('is founded'); record('house-and-crest');
  await page.locator('#tab-house').click();
  for (const [member, avatar] of [['m_rowan', 'wizard'], ['m_wren', 'royal']]) {
    await page.locator(`[data-member="${member}"]`).click();
    await page.locator(`input[name="memberAvatar"][value="${avatar}"]`).check();
    await page.getByRole('button', { name: 'Save avatar', exact: true }).click();
  }
  await shot('family'); await delay(1500); record('two-family-avatars');
  await page.locator('#tab-plan').click(); mark('plan');
  await page.locator('#goal-name-input').fill('Camping trip fund');
  await page.locator('#goal-target').fill('300.00'); await page.locator('#goal-starting').fill('60.00');
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 56);
  await page.locator('#goal-date').fill(date.toISOString().slice(0, 10)); await page.locator('#goal-weekly').fill('30.00');
  await delay(2300); await page.getByRole('button', { name: 'Make an example plan', exact: true }).click();
  await expect(page.locator('#plan-source')).toHaveText('Built-in plan');
  await expect(page.locator('#plan-total')).toHaveText('$240.00');
  mark('plan-result'); await delay(7000); await shot('plan');
  await page.getByRole('button', { name: 'Use this plan', exact: true }).click();
  record('reviewed-built-in-plan');
  mark('contribute'); await delay(5800);
  await pay('15.00', ['Manor Gardens']);
  const paid = await state();
  assert.equal(paid.progress.progressCents, 7500);
  assert.equal(paid.contributions.length, 1); assert.equal(paid.contributions[0].amountCents, 1500); assert.equal(paid.contributions[0].simulated, true);
  assert.deepEqual(paid.rewards.realm.districts.filter((d) => d.open).map((d) => d.id), ['cottage', 'manor']);
  record('example-credit-once-manor-with-village'); mark('receipt');
  await expect(page.locator('#receipt')).toBeVisible(); await delay(4500); await shot('receipt');
  await journal(); await page.locator('#tab-ledger').click();
  await expect(page.locator('#ledger-goal')).toContainText('Simulated');
  await expect(page.locator('#ledger-goal')).toContainText('You reported');
  await expect(page.locator('#treasury-next')).toContainText('Market Town');
  await page.locator('#ledger-goal').getByText('Simulated contribution', { exact: false }).first().click();
  mark('treasury'); await delay(7500); await shot('treasury');
  const selected = page.locator('#ledger-contributions');
  await expect(selected).toContainText('$15.00'); await expect(selected).toContainText('Completed — counted');
  record('treasury-source-labels-next-area-receipt');
  await page.reload(); await page.waitForFunction(() => document.body.dataset.ready === 'true' && window.__ourCastle?.scene());
  const persisted = await state();
  assert.equal(persisted.progress.progressCents, 7500); assert.equal(persisted.contributions.length, 1); assert.equal(persisted.acceptedPlanId, paid.acceptedPlanId);
  await expect(page.locator('#deed-dialog')).toBeHidden(); record('refresh-persists-no-duplicate-credit-or-deed');
  // Extra simulated progression only in this disposable example session, for the world tour.
  await pay('45.00', ['Market Town']);
  await pay('60.00', ['Stone Keep', 'Starfall Observatory']);
  await pay('120.00', ['Royal Citadel', 'Rosewind Palace', 'Rapunzel’s Tower']);
  await page.locator('#close-journal').click(); await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  mark('completed-realm'); await delay(6000); await shot('completed-realm');
  await area('palace'); mark('palace'); await delay(5500); await shot('palace');
  await menu('world-settings'); await page.locator('#time-mode').selectOption('night'); await page.locator('#world-settings > summary').click();
  mark('night'); await delay(5500); await shot('night');
  await menu('world-settings'); await page.locator('#weather-mode').selectOption('rain'); await page.locator('#world-settings > summary').click();
  mark('rain'); await delay(5500); await shot('rain');
  const final = await state();
  assert.equal(final.progress.progressCents, 30000); assert.equal(final.contributions.length, 4);
  record('isolated-example-9-district-tour');
  // A separate empty mobile context shares only this disposable demo server.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  const mobile = await phone.newPage(); await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await mobile.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (await mobile.locator('#journey').isHidden()) await mobile.locator('#journal-toggle').click();
  await expect(mobile.locator('#journey')).toBeVisible();
  await mobile.locator('#tab-ledger').click(); await expect(mobile.locator('#ledger-goal')).toContainText('Simulated');
  await mobile.screenshot({ path: join(out, 'phone.png') }); await phone.close(); record('phone-journal-no-overflow');
  assert.deepEqual(errors, []); assert.deepEqual(outside, []); record('no-page-errors-or-outside-requests');
  report = { status: 'passed', checkedAt: new Date().toISOString(), sourceCommit: commit, command: 'npm run demo', viewport: { width: 1920, height: 1080 }, reducedMotion: true, mode: status, initial: { targetCents: 30000, reportedStartingCents: 6000 }, contribution: { amountCents: 1500, simulated: true, creditedOnce: true }, checks, phases, writes, errors, outside, note: 'Actual recorded example interactions. No PayPal popup, live payment, runtime AI, live Channel3 search or human playtest.' };
} catch (error) {
  report = { status: 'failed', checkedAt: new Date().toISOString(), sourceCommit: commit, phases, checks, writes, errors, outside, failure: error.stack };
  try { await shot('failure'); } catch {}
  process.exitCode = 1; console.error(error.stack);
} finally {
  await context?.close();
  if (video) {
    const path = await video.path();
    report.recording = { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), note: 'Continuous original Playwright recording; no edits or inserted outcomes.' };
  }
  await browser?.close();
  if (app.exitCode === null) {
    if (process.platform === 'win32') app.kill('SIGINT');
    else process.kill(-app.pid, 'SIGINT'); // This recording's own detached npm/Node group only.
  }
  await delay(350);
  writeFileSync(join(out, 'launcher.log'), log + stderr);
  writeFileSync(join(out, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('RESULT', report.status, join(out, 'capture-report.json'));
}
