import { test, expect } from '@playwright/test';
import { REALM_DISTRICTS } from '../../src/core/realm.js';
import { closeMenu, chooseDistrict, clickView } from './support/game-controls.mjs';

// The compass ("Explore map"): while it is on, an ordinary drag pans across the realm instead of turning it. Camera
// only. Real browser input: Playwright's mouse on desktop and Chromium touch emulation (CDP) on the phone, which is not
// a physical device. Drags start on clear terrain, since names and controls over the map are buttons. Example mode.

test.use({ reducedMotion: 'reduce' });
test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/demo/reset', { data: {} })).ok()).toBeTruthy();
});

const ready = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('#journey').isVisible()) await page.locator('#journal-toggle').click();
};
const view = (page) => page.evaluate(() => {
  const v = window.__ourCastle.scene().view;
  return { angle: v.angle, zoom: v.zoom, wpp: v.worldPerPixel, focus: v.focus, exploring: v.exploring, free: v.free && { ...v.free } };
});
// Names and markers follow the camera on the next draw.
const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
function trackWrites(page) {
  const writes = [];
  page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  return writes;
}
// A point near the middle of the map where the canvas itself is hit, at every offset of the coming drag, and 24 px
// clear of every name, marker and map control: Chromium adjusts a touch just beside a button onto that button.
async function terrain(page, path) {
  await frames(page);
  return page.evaluate((path) => {
    const c = document.querySelector('#world canvas'), r = c.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#realm-markers button:not([hidden]), .world-hud > *, .board-foot > *')]
      .map((el) => el.getBoundingClientRect()).filter((b) => b.width && b.height);
    const clear = (x, y) => document.elementFromPoint(x, y) === c && buttons.every((b) => x < b.left - 24 || x > b.right + 24 || y < b.top - 24 || y > b.bottom + 24);
    const ok = (x, y) => path.every(([dx, dy]) => x + dx > r.left + 16 && x + dx < r.right - 16 && y + dy > r.top + 16 && y + dy < r.bottom - 16 && clear(x + dx, y + dy));
    const mx = r.left + r.width / 2, my = r.top + r.height / 2;
    for (let d = 0; d < 500; d += 6) for (let k = 0; k <= Math.max(1, d); k += 6) {
      const t = (k / Math.max(1, d)) * Math.PI * 2, x = mx + Math.cos(t) * d, y = my + Math.sin(t) * d;
      if (ok(x, y)) return { x, y };
    }
    return null;
  }, path);
}
function input(page, info) {
  const phone = info.project.name === 'phone';
  let cdp = null, id = 0;
  const touch = async (type, points) => {
    cdp ??= await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, n]) => ({ x, y, id: n, radiusX: 1, radiusY: 1, force: 1 })) });
  };
  return {
    phone,
    press: (locator) => (phone ? locator.tap() : locator.click()),
    // One drag of (dx, dy): the mouse's primary button, or one finger.
    async drag(dx, dy) {
      const p = await terrain(page, [[0, 0], [dx / 2, dy / 2], [dx, dy]]);
      expect(p, 'clear terrain for the drag').not.toBeNull();
      if (phone) {
        const n = id++;
        await touch('touchStart', [[p.x, p.y, n]]);
        for (let i = 1; i <= 8; i++) await touch('touchMove', [[p.x + dx * i / 8, p.y + dy * i / 8, n]]);
        await touch('touchEnd', []);
      } else {
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + dx * i / 8, p.y + dy * i / 8);
        await page.mouse.up();
      }
      await frames(page);
    },
    // Zoom in where the map is clear: the wheel, or two fingers spreading.
    async zoomIn() {
      if (phone) {
        const p = await terrain(page, [[-40, 0], [40, 0], [-80, 0], [80, 0]]), a = id++, b = id++;
        await touch('touchStart', [[p.x - 40, p.y, a], [p.x + 40, p.y, b]]);
        for (let i = 1; i <= 5; i++) await touch('touchMove', [[p.x - 40 - 8 * i, p.y, a], [p.x + 40 + 8 * i, p.y, b]]);
        await touch('touchEnd', []);
      } else {
        const p = await terrain(page, [[0, 0]]);
        await page.mouse.move(p.x, p.y);
        for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
      }
      await frames(page);
    },
  };
}
// Where a place sits on screen relative to the middle of the view (orthographic camera, elevation atan(150/180)).
function offsetOf(v, place) {
  const dx = place.x - v.free.x, dz = place.z - v.free.z, rise = 150 / Math.hypot(150, 180);
  return { x: (dx * Math.cos(v.angle) - dz * Math.sin(v.angle)) / v.wpp, y: (dx * Math.sin(v.angle) + dz * Math.cos(v.angle)) * rise / v.wpp };
}

test('the compass explores from a close village view to the next home and hands back to normal navigation', async ({ page }, info) => {
  test.setTimeout(120_000);
  const writes = trackWrites(page), use = input(page, info);
  await ready(page);
  for (let i = 0; i < 3; i++) await clickView(page, 'Zoom in');
  const compass = page.getByRole('button', { name: 'Explore map' }), hint = page.locator('#view-hint');
  const turning = 'Drag to turn. Shift-drag to pan. Scroll to zoom.', exploring = 'Drag to pan. Scroll to zoom.';
  await expect(compass).toHaveAttribute('aria-pressed', 'false');
  await expect(hint).toHaveText(turning);
  const size = await compass.boundingBox();
  expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Turning it on keeps the scale and what is in the middle: the village's name does not move.
  const village = page.locator('#realm-markers [data-district="cottage"]');
  await frames(page);
  const before = { view: await view(page), name: await village.boundingBox() };
  expect(before.view.focus).toBe('cottage');
  await use.press(compass);
  await expect(compass).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toHaveText(exploring); // the View menu's existing hint, updated in place
  await frames(page);
  const on = { view: await view(page), name: await village.boundingBox() };
  expect(on.view).toMatchObject({ exploring: true, focus: null, zoom: before.view.zoom });
  expect(on.view.wpp).toBeCloseTo(before.view.wpp, 6);
  expect(Math.abs(on.name.x - before.name.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(on.name.y - before.name.y)).toBeLessThanOrEqual(1);

  // The first ordinary drag moves the ground exactly with the pointer, although View deed (the area row below the map)
  // hid when exploring began. Measured on a projected ground point, the travelers, rather than on a name that may wrap.
  const ground = () => page.evaluate(() => { const t = window.__ourCastle.route().travelers; return { x: t.x, y: t.y }; });
  const startGround = await ground();
  await use.drag(60, 40);
  const movedGround = await ground();
  expect(Math.abs(movedGround.x - startGround.x - 60)).toBeLessThanOrEqual(1);
  expect(Math.abs(movedGround.y - startGround.y - 40)).toBeLessThanOrEqual(1);

  // Ordinary drags travel until Manor Gardens is in the middle of the view, without Areas: well beyond the old ±25 pan
  // around a focused home, and with no turning.
  const manor = REALM_DISTRICTS.find((d) => d.id === 'manor'), manorName = page.locator('#realm-markers [data-district="manor"]');
  for (let i = 0; i < 14; i++) {
    const v = await view(page), o = offsetOf(v, manor), length = Math.hypot(o.x, o.y);
    if (length < 40) break;
    const step = Math.min(length, use.phone ? 110 : 220);
    await use.drag(-o.x / length * step, -o.y / length * step);
  }
  await expect(manorName).toBeVisible();
  const there = await view(page);
  expect(there).toMatchObject({ angle: on.view.angle, focus: null, exploring: true });
  expect(Math.hypot(there.free.x - on.view.free.x, there.free.z - on.view.free.z)).toBeGreaterThan(25);

  // Zoom still works while exploring.
  await use.zoomIn();
  const zoomed = await view(page);
  expect(zoomed.zoom).toBeGreaterThan(there.zoom);

  // Turning it off keeps this view; an ordinary drag turns again, around the same place.
  await use.press(compass);
  await expect(compass).toHaveAttribute('aria-pressed', 'false');
  await expect(hint).toHaveText(turning);
  const off = await view(page);
  expect(off).toMatchObject({ exploring: false, free: zoomed.free, zoom: zoomed.zoom });
  await use.drag(use.phone ? 80 : 160, 0);
  const turned = await view(page);
  expect(turned.angle).not.toBe(off.angle);
  expect(turned.free).toEqual(off.free);

  // Explicit navigation reframes as before and ends exploring: Areas, then Visit campsite from the keyboard.
  await use.press(compass);
  await chooseDistrict(page, 'market');
  await closeMenu(page, 'district-menu');
  expect(await view(page)).toMatchObject({ focus: 'market', exploring: false, free: null, zoom: 1 });
  await expect(compass).toHaveAttribute('aria-pressed', 'false');
  await expect(hint).toHaveText(turning);
  await use.press(compass);
  await page.locator('#journal-toggle').click();
  await page.locator('#tab-plan').click();
  await page.locator('#visit-campsite').focus();
  await page.keyboard.press('Enter');
  await frames(page);
  expect(await view(page)).toMatchObject({ focus: 'family-project', exploring: false, free: null });
  await expect(compass).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#project-marker')).toBeFocused();
  await expect(page.locator('#project-marker')).toBeVisible();
  expect(writes).toEqual([]);
});

test('the compass toggles from the keyboard and keeps focus', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Keyboard input is checked on desktop.');
  const writes = trackWrites(page);
  await ready(page);
  const compass = page.getByRole('button', { name: 'Explore map' });
  await compass.focus();
  await page.keyboard.press('Space');
  await expect(compass).toHaveAttribute('aria-pressed', 'true');
  expect((await view(page)).exploring).toBe(true);
  await page.keyboard.press('Enter');
  await expect(compass).toHaveAttribute('aria-pressed', 'false');
  expect((await view(page)).exploring).toBe(false);
  await expect(compass).toBeFocused();
  expect(writes).toEqual([]);
});

test('a wheel over a name on the map zooms the map', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'A wheel is desktop input.');
  await ready(page);
  await frames(page);
  // The focused area's name sits over the middle of the map, where people zoom.
  const name = page.locator('#realm-markers [data-district="cottage"]'), box = await name.boundingBox(), before = (await view(page)).zoom;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-district]')?.dataset.district, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe('cottage');
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(before);
});
