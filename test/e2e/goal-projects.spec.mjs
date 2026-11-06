import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { openMenu } from './support/game-controls.mjs';

// What the goal builds in the west meadow: Campsite / Garden / Schoolhouse, an explicit choice in the Plan goal editor,
// saved only with the goal's normal save. Real app in example mode on its own port with a fresh example household:
// simulated payments only, no AI, merchant or payment provider.
const evidence = fileURLToPath(new URL('../../test-results/goal-projects/', import.meta.url));
const scene = (page) => page.evaluate(() => window.__ourCastle.scene());
const owner = { householdId: 'hh_demo', goalId: 'goal_demo', approverId: 'm_rowan', approvalConfirmed: true };
let n = 0;
const api = async (request, method, path, data) => {
  const res = await request.fetch(path, { method, data });
  const body = await res.json();
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${JSON.stringify(body)}`);
  return body;
};
const pay = (request, amountCents) => api(request, 'POST', '/api/example/contributions', { ...owner, amountCents, requestId: `goal-project-${String(++n).padStart(6, '0')}` });
const goalOf = (s, extra = {}) => ({ name: s.goal.name, targetCents: s.goal.targetCents, startingCents: s.progress.startingCents, weeklyBudgetCents: s.goal.weeklyBudgetCents, targetDate: s.goal.targetDate, ...extra });
const figures = (s) => goalOf(s, { id: s.goal.id, currency: s.goal.currency, status: s.goal.status });
test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ request }) => {
  await api(request, 'POST', '/api/demo/reset', {});
  await api(request, 'POST', '/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } });
  mkdirSync(evidence, { recursive: true });
});

async function load(page) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (!await page.locator('#journey').isHidden()) await page.locator('#close-journal').click();
  if (await page.locator('#time-mode').inputValue() !== 'day') {
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day'); await page.keyboard.press('Escape');
    await expect.poll(async () => (await scene(page)).atmosphere.period).toBe('day');
  }
}
async function openPlan(page) {
  if (await page.locator('#journey').isHidden()) await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await page.locator('#tab-plan').click();
  await expect(page.locator('#panel-plan')).toBeVisible();
}
async function visitMarker(page, name, info) {
  const marker = page.getByRole('button', { name });
  if (await marker.isHidden()) await page.getByRole('button', { name: 'Whole realm', exact: true }).click();
  await expect(marker).toBeVisible();
  if (info.project.name === 'phone') await marker.tap(); else { await marker.focus(); await page.keyboard.press('Enter'); }
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect((await scene(page)).view.focus).toBe('family-project');
}
const activate = async (page, locator, info) => { if (info.project.name === 'phone') await locator.tap(); else { await locator.focus(); await page.keyboard.press('Enter'); } };

test('Build in Plan: saved only with the goal, kept across reload, the plan in use and progress untouched, Visit reaches it', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors = [], writes = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
  // A plan already in use; the household's goal has never had a choice saved, so it shows the campsite.
  const fresh = await api(request, 'GET', '/api/state');
  expect(fresh.goal.projectKind).toBe('campsite');
  const made = await api(request, 'POST', '/api/plans', { goal: goalOf(fresh), commitments: [] });
  const before = (await api(request, 'POST', `/api/plans/${made.plan.id}/accept`, {})).state;
  expect(before.acceptedPlanId).toBe(made.plan.id);

  await load(page); await openPlan(page);
  const build = page.getByRole('combobox', { name: 'Build', exact: true });
  await expect(build).toHaveValue('campsite');
  expect(await build.locator('option').allInnerTexts()).toEqual(['Campsite', 'Garden', 'Schoolhouse']);
  await expect(page.locator('#plan-project-stage')).toHaveText('Family Campsite · Survey stakes');
  await expect(page.locator('#visit-campsite')).toHaveText('Visit campsite');
  // The choice sits right after the goal's name in keyboard order and is a full-size touch target.
  await page.locator('#goal-name-input').focus(); await page.keyboard.press('Tab');
  await expect(build).toBeFocused();
  const box = await build.boundingBox(), panel = await page.locator('#panel-plan').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(panel.x); expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);

  // Choosing is not saving: no request, no preview in the world or the stage line.
  await build.selectOption('garden');
  await expect(build).toHaveValue('garden');
  await page.waitForTimeout(300);
  expect(writes).toEqual([]);
  await expect(page.locator('#plan-project-stage')).toHaveText('Family Campsite · Survey stakes');
  expect((await scene(page)).project.stage).toMatchObject({ kind: 'campsite' });
  await page.locator('#panel-plan').screenshot({ path: `${evidence}${info.project.name}-plan-garden-chosen.png` });

  // The normal Plan save carries it with the unchanged figures.
  await activate(page, page.locator('#ask-planner'), info);
  await expect(page.locator('#plan-status')).toContainText('Plan ready.');
  expect(writes.map((w) => w.path)).toEqual(['/api/plans']);
  expect(writes[0].body.goal).toEqual(goalOf(before, { projectKind: 'garden' }));
  await expect(page.locator('#plan-project-stage')).toHaveText('Family Garden · Survey stakes');
  await expect(page.locator('#visit-campsite')).toHaveText('Visit garden');
  await expect.poll(async () => (await scene(page)).project.stage).toMatchObject({ kind: 'garden', index: 0, key: 'survey', detail: true });
  const after = await api(request, 'GET', '/api/state');
  expect(after.goal.projectKind).toBe('garden');
  expect(figures(after)).toEqual(figures(before));
  expect(after.progress).toEqual(before.progress);
  expect(after.achievements).toEqual(before.achievements);
  expect(after.acceptedPlanId).toBe(before.acceptedPlanId);
  expect(after.contributions).toEqual(before.contributions);

  // A reload reads the saved choice back; Visit lands on the garden's own marker and names its stage.
  await load(page); await openPlan(page);
  await expect(build).toHaveValue('garden');
  await expect(page.locator('#plan-project-stage')).toHaveText('Family Garden · Survey stakes');
  expect((await scene(page)).project.stage).toMatchObject({ kind: 'garden', index: 0 });
  await page.locator('#panel-plan').screenshot({ path: `${evidence}${info.project.name}-plan-garden-saved.png` });
  await activate(page, page.getByRole('button', { name: 'Visit garden', exact: true }), info);
  await expect(page.locator('#journey')).toBeHidden();
  const marker = page.getByRole('button', { name: 'Visit the family garden' });
  await expect(marker).toBeFocused();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Garden · Survey stakes');
  expect((await scene(page)).view.focus).toBe('family-project');
  await page.screenshot({ path: `${evidence}${info.project.name}-after-visit-garden.png` });

  expect(writes.map((w) => w.path)).toEqual(['/api/plans']);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('every place keeps the same stages: thresholds, a refund and a larger goal step back; switching rebuilds only the place', async ({ page, request }, info) => {
  test.skip(info.project.name === 'phone', 'Stage and rebuild logic is viewport-independent; the phone fit is covered above.');
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s0 = await api(request, 'GET', '/api/state');
  await api(request, 'POST', '/api/plans', { goal: goalOf(s0, { projectKind: 'schoolhouse' }), commitments: [] });
  const shot = (name) => page.locator('.realm-map').screenshot({ path: `${evidence}${info.project.name}-${name}.png` });
  const at = async (label, stage, features) => {
    await load(page); await visitMarker(page, 'Visit the family schoolhouse', info);
    await expect(page.locator('#realm-focus-status')).toHaveText(`Family Schoolhouse · ${label}`);
    const map = await scene(page);
    expect(map.project.stage).toMatchObject({ kind: 'schoolhouse', ...stage });
    for (const f of features) expect(map.project.stage.features).toContain(f);
    expect(map.project).toMatchObject({ lit: false, smokePositions: [], live: 0 });
    return map;
  };
  // $60 of $300 (20%): stakes, the slate board and the cleared footprint.
  await at('Survey stakes', { index: 0, detail: true }, ['stakes', 'slate-board']);
  // 25%: the timber frame of the same building, the bell waiting on its cradle. 40%: rafters, belfry posts.
  await pay(request, 1500);
  await at('Under construction', { index: 1, detail: false }, ['school:frame', 'bell:cradle']);
  await shot('schoolhouse-construction');
  await pay(request, 4500);
  await at('Under construction', { index: 1, detail: true }, ['school:rafters', 'belfry:frame', 'bell:cradle']);
  // 60%: the finished schoolhouse with its bell hung in the belfry.
  await pay(request, 6000);
  const finished = await at('Finished schoolhouse', { index: 2, detail: false }, ['school:built', 'belfry', 'bell:belfry', 'porch']);
  expect(finished.project.stage.features).not.toContain('bell:cradle');
  // 100%: the gathering place; the home tier and the project agree.
  const last = await pay(request, 12000);
  const done = await at('Gathering place', { index: 3 }, ['swings', 'flag', 'bunting']);
  expect(done.tier).toBe(3);
  await shot('schoolhouse-gathering');
  // A refund of the last $120 sets it back to the finished schoolhouse; the earned castle stays.
  const refund = await api(request, 'POST', `/api/example/captures/${last.contribution.captures[0].captureId}/refund`, owner);
  expect(refund.outcome).toBe('refunded');
  const back = await at('Finished schoolhouse', { index: 2, detail: false }, ['school:built']);
  expect(back.tier).toBe(3);

  // Switching the place in Plan (normal save) at the same progress: same stage, only the project group rebuilt.
  const journey = (m) => ({ tier: m.tier, position: m.position, shownPosition: m.shownPosition, districts: m.districts, bridges: m.bridges, court: m.court, crest: m.crest, gardens: m.gardens, focus: m.view.focus });
  const beforeSwitch = await api(request, 'GET', '/api/state'), gardens = [];
  for (const [kind, label, lit] of [['campsite', 'Family Campsite · Furnished campsite', true], ['garden', 'Family Garden · Planted garden', false], ['campsite', 'Family Campsite · Furnished campsite', true], ['garden', 'Family Garden · Planted garden', false]]) {
    const start = await scene(page);
    await openPlan(page);
    await page.getByRole('combobox', { name: 'Build', exact: true }).selectOption(kind);
    await page.locator('#ask-planner').click();
    await expect(page.locator('#plan-status')).toContainText('Plan ready.');
    await expect(page.locator('#plan-project-stage')).toHaveText(label);
    await expect.poll(async () => (await scene(page)).project.stage.kind).toBe(kind);
    const now = await scene(page);
    expect(now.project.stage).toMatchObject({ index: 2, detail: false });
    expect(now.project.lit).toBe(lit);
    expect(now.project.smokePositions).toHaveLength(lit ? 3 : 0); // no campfire smoke left behind by the campsite
    expect(now.project.live).toBe(lit ? 4 : 0);
    expect(journey(now)).toEqual(journey(start));
    if (kind === 'garden') {
      // Rebuilding replaces the place: the second garden holds exactly what the first one did.
      gardens.push([now.project.meshes, now.project.instances, now.project.objects]);
    }
  }
  expect(gardens).toHaveLength(2);
  expect(gardens[1]).toEqual(gardens[0]);
  const after = await api(request, 'GET', '/api/state');
  expect(after.progress).toEqual(beforeSwitch.progress);
  expect(after.achievements).toEqual(beforeSwitch.achievements);
  expect(figures(after)).toEqual(figures(beforeSwitch));
  expect(after.goal.projectKind).toBe('garden');

  // A larger goal (an edit that does not mention the place) reopens the survey and keeps the garden.
  await api(request, 'PUT', '/api/goal', { ...goalOf(after), targetCents: 100000 });
  await load(page); await visitMarker(page, 'Visit the family garden', info);
  await expect(page.locator('#realm-focus-status')).toHaveText('Family Garden · Survey stakes');
  expect((await scene(page)).project.stage).toMatchObject({ kind: 'garden', index: 0, detail: true });
  expect(errors).toEqual([]);
});

test('night and reduced motion: each finished place stays readable and still', async ({ page, request }, info) => {
  test.skip(info.project.name === 'phone', 'Lighting is viewport-independent; phone captures are in the first case.');
  test.setTimeout(150_000);
  for (const cents of [1500, 4500, 6000]) await pay(request, cents); // 60%
  const panes = {};
  for (const kind of ['garden', 'schoolhouse']) {
    const s = await api(request, 'GET', '/api/state');
    await api(request, 'POST', '/api/plans', { goal: goalOf(s, { projectKind: kind }), commitments: [] });
    await load(page);
    await visitMarker(page, `Visit the family ${kind}`, info);
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'night'); await page.keyboard.press('Escape');
    await expect.poll(async () => (await scene(page)).atmosphere.period).toBe('night');
    const map = await scene(page);
    expect(map.project.stage).toMatchObject({ kind, index: 2 });
    expect(map.atmosphere.glassGlow).toBeGreaterThan(0);
    expect(map.ambient).toBe(false); expect(map.project.ticks).toBe(0); // reduced motion: nothing moves
    panes[kind] = map.atmosphere.panes;
    const size = page.viewportSize(); await page.setViewportSize({ width: size.width + 1, height: size.height }); await page.waitForTimeout(300); await page.setViewportSize(size); await page.waitForTimeout(600);
    await page.locator('.realm-map').screenshot({ path: `${evidence}${info.project.name}-${kind}-night.png` });
    await openMenu(page, 'world-settings'); await page.selectOption('#time-mode', 'day'); await page.keyboard.press('Escape');
  }
  // The schoolhouse's six tall windows, transom and gable window light up; the glasshouse lights its door pane.
  expect(panes.schoolhouse - panes.garden).toBeGreaterThanOrEqual(7);
});

test('an untouched Build choice never reverts a newer saved one, and an unlisted value is refused with nothing changed', async ({ page, request }, info) => {
  test.skip(info.project.name === 'phone', 'Save semantics are viewport-independent.');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page); await openPlan(page);
  const build = page.getByRole('combobox', { name: 'Build', exact: true });
  await expect(build).toHaveValue('campsite');
  // This family tries a weekly amount (the form is now dirty) but leaves Build alone ...
  await page.locator('#goal-weekly').fill('35.00');
  // ... while another member saves the schoolhouse.
  const other = await api(request, 'GET', '/api/state');
  await api(request, 'POST', '/api/plans', { goal: goalOf(other, { projectKind: 'schoolhouse' }), commitments: [] });
  const sent = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/plans');
  await page.locator('#ask-planner').click();
  const body = (await sent).postDataJSON();
  expect(body.goal).not.toHaveProperty('projectKind');
  await expect(page.locator('#plan-status')).toContainText('Plan ready.');
  let saved = await api(request, 'GET', '/api/state');
  expect(saved.goal.projectKind).toBe('schoolhouse');
  expect(saved.goal.weeklyBudgetCents).toBe(3500);
  await expect(build).toHaveValue('schoolhouse');
  await expect(page.locator('#plan-project-stage')).toHaveText('Family Schoolhouse · Survey stakes');

  // A value outside the list (a tampered page) is refused by the server; the goal, plans and picture stay as they are.
  const plans = saved.plan.id;
  await build.evaluate((select) => select.append(new Option('Castle', 'castle')));
  await build.selectOption('castle');
  await page.locator('#ask-planner').click();
  await expect(page.locator('#plan-status')).toContainText('Choose Campsite, Garden or Schoolhouse.');
  saved = await api(request, 'GET', '/api/state');
  expect(saved.goal.projectKind).toBe('schoolhouse');
  expect(saved.plan.id).toBe(plans);
  expect((await scene(page)).project.stage.kind).toBe('schoolhouse');
  expect(errors).toEqual([]);
});
