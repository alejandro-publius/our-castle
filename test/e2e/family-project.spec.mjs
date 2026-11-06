import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { chooseDistrict, openMenu } from './support/game-controls.mjs';

// The family campsite in the west meadow follows the server's current progress through the existing milestone rules.
// Real app in example mode on its own port with a fresh in-memory household: simulated payments only, no provider.
const evidence = fileURLToPath(new URL('../../test-results/family-project/', import.meta.url));
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const owner = { householdId: 'hh_demo', goalId: 'goal_demo', approverId: 'm_rowan', approvalConfirmed: true };
let n = 0;
const api = async (request, method, path, data) => {
  const res = await request.fetch(path, { method, data });
  const body = await res.json();
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${JSON.stringify(body)}`);
  return body;
};
const pay = (request, amountCents) => api(request, 'POST', '/api/example/contributions', { ...owner, amountCents, requestId: `project-request-${String(++n).padStart(6, '0')}` });
test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ request }) => {
  await api(request, 'POST', '/api/demo/reset', {});
  // A named house is the existing precondition for any contribution; the example household starts at $60 of $300.
  await api(request, 'POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } });
  mkdirSync(evidence, { recursive: true });
});

async function load(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (!await page.locator('#journey').isHidden()) await page.locator('#close-journal').click();
  // Captures are compared in daylight. The time mode is a remembered preference, so this runs once per browser context.
  if (await page.locator('#time-mode').inputValue() !== 'day') {
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day'); await page.keyboard.press('Escape');
    await expect.poll(async () => (await scene(page)).atmosphere.period).toBe('day');
  }
}
async function visitCampsite(page, info) {
  const marker = page.getByRole('button', { name: 'Visit the family campsite' });
  if (await marker.isHidden()) await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  await expect(marker).toBeVisible();
  // Map markers follow the camera, so activate the control the way the sword glint test does: touch on the phone, keyboard on the desktop.
  if (info.project.name === 'phone') await marker.tap(); else { await marker.focus(); await page.keyboard.press('Enter'); }
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect((await scene(page)).view.focus).toBe('family-project');
}

test('the campsite develops with progress, steps back on a refund or a bigger goal, survives reload and never writes', async ({ page, request }, info) => {
  const errors = [], writes = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const shot = (name) => page.locator('.realm-map').screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  const before = await (await request.get('/api/state')).json();

  // $60 of $300: survey stakes, with the 10% path and signpost already cleared.
  await load(page);
  await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Survey stakes');
  await expect(page.locator('#view-deed')).toBeHidden();
  await expect(page.locator('#open-merchant')).toBeHidden();
  let map = await scene(page);
  expect(map.project).toMatchObject({ site: { id: 'family-project', x: -98, z: 26 }, stage: { index: 0, key: 'survey', detail: true }, lit: false });
  expect(map.districts).toHaveLength(9); expect(map.bridges).toHaveLength(9); expect(map.legends).toEqual([{ id: 'sword-stone', x: -35, z: -51 }]);
  await shot('survey');

  // The marker also keeps the village company when the meadow is on screen (the phone's close view is narrower), and
  // the Areas menu lists districts only.
  await chooseDistrict(page, 'cottage');
  if (info.project.name === 'desktop') await expect(page.getByRole('button', { name: 'Visit the family campsite' })).toBeVisible();
  expect(await page.locator('#realm-districts [data-district="family-project"]').count()).toBe(0);
  await expect(page.locator('#realm-districts button')).toHaveCount(9);

  // 25%: construction. The stage is read back after a reload from server state alone.
  const first = await pay(request, 1500);
  expect(first.progress.progressCents).toBe(7500);
  await load(page); await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Under construction');
  expect((await scene(page)).project).toMatchObject({ stage: { index: 1, key: 'construction', detail: false }, lit: false });
  await shot('construction');

  // 40%: rafters, half walls and a first tent. 60%: the furnished campsite with its fire lit.
  await pay(request, 4500);
  await load(page); await visitCampsite(page, info);
  expect((await scene(page)).project).toMatchObject({ stage: { index: 1, detail: true } });
  await shot('construction-detail');
  await pay(request, 6000);
  await load(page); await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Furnished campsite');
  map = await scene(page);
  expect(map.project).toMatchObject({ stage: { index: 2, key: 'furnished', detail: false }, lit: true });
  expect(map.project.ticks).toBe(0); expect(map.ambient).toBe(false); // reduced motion: the fire is still
  await shot('furnished');

  // 100%: the gathering place. Home tier and campsite agree.
  const last = await pay(request, 12000);
  expect(last.progress.progressCents).toBe(30000);
  await load(page); await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Gathering place');
  map = await scene(page);
  expect(map.project).toMatchObject({ stage: { index: 3, key: 'gathering', detail: false }, lit: true });
  expect(map.tier).toBe(3);
  await shot('gathering');

  // A refund of the last $120 sets the campsite back to furnished while the earned castle stays as a keepsake.
  const captureId = last.contribution.captures[0].captureId;
  const refund = await api(request, 'POST', `/api/example/captures/${captureId}/refund`, owner);
  expect(refund.outcome).toBe('refunded');
  await load(page); await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Furnished campsite');
  map = await scene(page);
  expect(map.project).toMatchObject({ stage: { index: 2, detail: false } });
  expect(map.tier).toBe(3);

  // The same $180 toward a $1,000 goal is a survey again, with the 10% path still cleared.
  const { name, targetDate } = (await api(request, 'GET', '/api/state')).goal;
  await api(request, 'PUT', '/api/goal', { name, targetCents: 100000, startingCents: 6000, weeklyBudgetCents: 3000, targetDate });
  await load(page); await visitCampsite(page, info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Survey stakes');
  expect((await scene(page)).project).toMatchObject({ stage: { index: 0, key: 'survey', detail: true }, lit: false });

  // Visiting the campsite changes nothing on the server and the page never writes.
  const after = await (await request.get('/api/state')).json();
  expect(after.progress.progressCents).toBe(18000);
  expect(after.achievements.length).toBeGreaterThanOrEqual(before.achievements.length);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('normal motion', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('the finished campsite at night: windows and lanterns glow, and the campfire moves on the existing ambient clock', async ({ page, request }, info) => {
    for (const cents of [1500, 4500, 6000, 12000]) await pay(request, cents);
    await load(page); await visitCampsite(page, info);
    await expect(page.locator('#realm-focus-status')).toHaveText('Family Campsite · Gathering place');
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'night'); await page.keyboard.press('Escape');
    await expect.poll(async () => (await scene(page)).atmosphere.period).toBe('night');
    const first = (await scene(page)).project;
    expect(first).toMatchObject({ stage: { index: 3, key: 'gathering' }, lit: true });
    await expect.poll(async () => (await scene(page)).project.ticks, { timeout: 15000 }).toBeGreaterThan(first.ticks + 6);
    const later = await scene(page);
    expect(later.ambient).toBe(true);
    expect(later.project.flameScaleY).not.toBe(first.flameScaleY);
    expect(later.project.puffs).not.toEqual(first.puffs);
    expect(later.project.puffs.every((y) => y > 1 && y < 5.2)).toBe(true);
    expect(later.atmosphere).toMatchObject({ period: 'night' });
    expect(later.atmosphere.glassGlow).toBeGreaterThan(0);
    // A redraw into the same-size canvas does not reach this headless compositor's capture until the canvas is resized
    // (checked against the whole-realm night look); a one-pixel nudge only affects what the screenshot shows.
    const settle = async () => { const size = page.viewportSize(); await page.setViewportSize({ width: size.width + 1, height: size.height }); await page.waitForTimeout(300); await page.setViewportSize(size); await page.waitForTimeout(600); };
    await settle();
    await page.locator('.realm-map').screenshot({ path: `${evidence}${info.project.name}-gathering-night.png` });
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day'); await page.keyboard.press('Escape');
    await expect.poll(async () => (await scene(page)).atmosphere.period).toBe('day');
    await settle();
    await page.locator('.realm-map').screenshot({ path: `${evidence}${info.project.name}-gathering-motion.png` });
    // A gathering place is scenery: the goal, achievements and contributions are exactly what the payments made them.
    const state = await api(request, 'GET', '/api/state');
    expect(state.progress.progressCents).toBe(30000);
    expect(state.contributions).toHaveLength(4);
  });
});
