// Shared families in the browser: in-process family-mode servers on their own ports with in-memory (or temporary) data
// and no provider keys, one browser context per person with its own Chromium virtual authenticator (WebAuthn over CDP),
// and the steps a family takes: start a family, invite, accept. The virtual authenticator is not a real device.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createApp } from '../../../server/app.mjs';
import { loadConfig } from '../../../server/config.mjs';
import { openDatabase } from '../../../server/db.mjs';
import { createClock } from '../../../server/household.mjs';

export const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The real clock, plus an offset a test can move forward (sessions and invitations expire by it). */
export function mutableClock() {
  let offset = 0;
  const base = createClock();
  return { now: () => new Date(Date.now() + offset), iso() { return this.now().toISOString(); }, today() { const d = this.now(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, advance(ms) { offset += ms; }, base };
}

export async function familyServer({ clock = createClock(), merchant = null, live = {}, aiProvider = null, kitReader = null } = {}) {
  const db = openDatabase(':memory:');
  let app;
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  app = createApp({ config: loadConfig({ OUR_CASTLE_ACCESS: 'family', OUR_CASTLE_ORIGIN: origin }, { root }), db, clock, root, merchant, live, aiProvider, kitReader });
  let closing = null;
  return {
    origin, db, clock, app,
    /** Drop every open connection at once, as a network loss does (pages then reconnect, or fail to while offline). */
    cut: () => server.closeAllConnections(),
    close: () => (closing ??= new Promise((resolve) => { app.live?.close(); server.closeAllConnections(); server.close(() => { db.close(); resolve(); }); })),
  };
}

/**
 * One person: their own browser context, page and virtual authenticator. With `origin`, every request that leaves that
 * origin is refused and recorded (no weather, provider or CDN request reaches the internet); Channel3's image CDN gets a
 * drawn stand-in, as a real answer's product image would load from there.
 */
export async function person(browser, info, name, { origin = null, image = null } = {}) {
  const { viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  const context = await browser.newContext({ viewport, isMobile, hasTouch, deviceScaleFactor, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (origin) {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (image && url.hostname === 'cdn.trychannel3.com') return route.fulfill({ contentType: 'image/svg+xml', body: image });
      outside.push(url.href);
      return route.abort();
    });
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { name, context, page, cdp, authenticatorId, errors, outside };
}

export const settled = (page, expected = true) => expect.poll(async () => {
  try { return await page.evaluate(() => document.body.dataset.ready === 'true' && Boolean(window.__ourCastle?.state?.access)); } catch { return false; }
}, { timeout: 30_000 }).toBe(expected);

/** The page holds a live-update stream ("live"), or has fallen back ("down", "polling"). */
export const liveState = (page) => page.evaluate(() => window.__ourCastle.family().live);
export const isLive = (page) => expect.poll(() => liveState(page), { timeout: 20_000 }).toBe('live');

export async function openTab(page, tab) {
  if (await page.locator('#journey').isHidden()) await page.locator('#journal-toggle').click();
  await page.locator(`#tab-${tab}`).click();
  await expect(page.locator(`#panel-${tab}`)).toBeVisible();
}

export async function createFamily(p, origin, name) {
  await p.page.goto(origin + '/');
  await expect(p.page.locator('#access-dialog')).toBeVisible();
  await p.page.getByRole('button', { name: 'Start a new family' }).click();
  await p.page.getByLabel('Your name').fill(name);
  await p.page.getByRole('button', { name: 'Create passkey and family' }).click();
  await settled(p.page);
}

export async function invite(owner, name, role) {
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

export async function accept(p, link) {
  await p.page.goto(link);
  await expect(p.page.getByRole('button', { name: 'Create passkey and join' })).toBeVisible();
  expect(new URL(p.page.url()).hash).toBe(''); // the token left the address bar at once
  await p.page.getByRole('button', { name: 'Create passkey and join' }).click();
  await settled(p.page);
}

export const csrfFetch = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const { csrfToken } = await (await fetch('/api/session')).json();
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}, { method, url, body });

export const freePort = () => new Promise((resolve) => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); }); });

/** The real family runner (scripts/family.mjs) as its own process, on a port and data folder, with no .env. */
export function familyRunner({ port, data }) {
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/family.mjs', '--port', String(port), '--data', data], { cwd: root, env: { PATH: process.env.PATH, OUR_CASTLE_ENV_FILE: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('Press Ctrl+C')) resolve(child); });
    child.on('exit', (code) => reject(new Error(`family runner exited ${code}: ${out}`)));
  });
  const stop = (child) => new Promise((resolve) => { child.removeAllListeners('exit'); child.once('exit', resolve); child.kill('SIGTERM'); });
  return { start, stop, origin: `http://localhost:${port}` };
}
