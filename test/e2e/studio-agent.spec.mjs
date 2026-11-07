import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Actual AG Studio 3.1 harness/custom server runner. Anthropic is a scripted fake transport;
// example data only, no real AI/PayPal/Channel3 requests. There is still one existing steward UI.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = fileURLToPath(new URL('../../test-results/studio-agent/', import.meta.url));
let s;
test.use({ reducedMotion: 'reduce' });
test.afterEach(async () => { await s?.close(); s = null; });

const message = (content, stop_reason = 'end_turn') => ({ id: 'msg_fake_studio', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, content, usage: { input_tokens: 5, output_tokens: 5 } });
async function start(page, { studio = true, hold = false, sandbox = false, failUpdate = false, stall = false } = {}) {
  const domain = sandbox ? setupDomain({ mode: 'sandbox' }) : null;
  const db = domain?.db ?? openDatabase(':memory:');
  let orderId = null;
  if (domain) {
    ({ orderId } = await domain.service.createPayPalOrder(contribution({ amountCents: 1500 })));
    await domain.service.capturePayPalOrder({ providerOrderId: orderId, householdId: domain.householdId, goalId: domain.goalId });
  }
  let release, releaseStudio;
  const gate = new Promise((resolve) => { release = resolve; });
  const studioGate = new Promise((resolve) => { releaseStudio = resolve; }); // `stall`: the Studio script goes unanswered
  const aiRequests = [], writes = [], issues = [];
  const stewardFetch = async (url, init) => {
    expect(new URL(url).origin).toBe('https://api.anthropic.com');
    const request = JSON.parse(init.body); aiRequests.push(request);
    if (hold && aiRequests.length === 1) await gate;
    const result = request.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'))
      ? message([{ type: 'text', text: domain ? 'PayPal confirms the $15.00 contribution.' : 'Your house has $60.00 tracked. The Manor needs $15.00 more.' }])
      : message([{ type: 'tool_use', id: 'toolu_fake_ledger', name: domain ? 'get_order' : 'read_household_ledger', input: domain ? { order_id: orderId } : {} }], 'tool_use');
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const app = createApp({ config: loadConfig(domain ? { PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret' } : {}, { root }), db, clock: domain?.clock ?? createClock(), root,
    paypal: domain?.paypal,
    paypalTools: domain ? { getOrder: async (id) => (await domain.paypal.getOrder(id)).data, listTransactions: async () => ({ transaction_details: [] }) } : null,
    stewardAi: { apiKey: 'fake-test-key', model: 'claude-opus-5-5' }, stewardFetch });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}`;
  const post = async (path, data) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(data) });
    expect(res.ok).toBe(true); return res.json();
  };
  s = { base, db, writes, issues, aiRequests, release, releaseStudio, orderId,
    finance: () => JSON.stringify(['payment_orders', 'ledger_entries', 'plans'].map((t) => db.prepare(`SELECT * FROM ${t}`).all())),
    close: () => { release(); releaseStudio(); return new Promise((r) => { server.close(() => { db.close(); r(); }); server.closeAllConnections(); }); } };
  await post('/api/setup', { playMode: 'family', name: 'House of Alder', crest: { field: 'cobalt', charge: 'stag' } });
  await post('/api/entries', { kind: 'gift_sent', label: 'Test fixture gift', amountCents: 500, memberId: 'm_rowan' });
  page.on('pageerror', (e) => issues.push(e.message));
  await page.route('**/*', async (route) => {
    const r = route.request(), url = new URL(r.url());
    // This case seeds a fake server order. It does not exercise or claim buyer approval.
    if (domain && url.hostname === 'www.sandbox.paypal.com' && url.pathname === '/web-sdk/v6/core') return route.fulfill({ status: 503, body: 'Test fixture: checkout disabled' });
    if (url.origin !== base) { issues.push(`${r.method()} ${r.url()}`); return route.abort(); }
    if (stall && url.pathname === '/vendor/ag-studio/ag-studio.min.js') { await studioGate; return route.continue().catch(() => {}); }
    if (!studio && url.pathname === '/vendor/ag-studio/ag-studio.min.js') return route.fulfill({ status: 503, body: 'unavailable' });
    if (failUpdate && url.pathname === '/vendor/ag-studio/ag-studio.min.js') {
      const response = await route.fetch();
      // Keep the real framework/widget, but make its live-data update fail once mounted.
      const inject = `;(() => { const original = window.agStudio; window.agStudio = { ...original, createStudio: (...args) => {
        window.__testUpdateFailure = { mounted: true, attempts: 0 };
        const api = original.createStudio(...args);
        return new Proxy(api, { get(target, key) {
          if (key === 'getDataEngine') return () => new Proxy(target.getDataEngine(), { get(engine, method) {
            if (method === 'applyTransaction') return async () => { window.__testUpdateFailure.attempts++; throw new Error('Fixture: live data unavailable'); };
            const value = engine[method]; return typeof value === 'function' ? value.bind(engine) : value;
          } });
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } });
      } }; })();`;
      return route.fulfill({ response, body: await response.text() + inject });
    }
    if (r.method() !== 'GET') writes.push(`${r.method()} ${url.pathname}`);
    return route.continue();
  });
  await page.goto(base);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  if (stall) { await page.clock.install(); s.ledgerAt = await page.evaluate(() => performance.now()); }
  await page.locator('#tab-ledger').click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.treasury().source)).toBe(stall ? 'pending' : studio ? 'ag-studio' : 'fallback');
  await page.locator('#steward-block > summary').click();
}
// With the fake clock installed: move it to eight seconds after `t0`, the page's time when the Ledger was requested.
const eightSecondsAfter = async (page, t0) => page.clock.fastForward(Math.max(0, Math.floor(t0 + 8000 - await page.evaluate(() => performance.now()))));
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const agent = (page) => page.evaluate(() => window.__ourCastle.treasury().agent);
const ask = async (page) => {
  await page.locator('#steward-form input[name="question"]').fill('How close are we to the next area?');
  await page.locator('#steward-ask').click();
};

test('the real Studio framework runs the existing steward once and discards its temporary thread', async ({ page }, info) => {
  await start(page);
  // The one existing boundary note is visible beside the selected record even when the question panel is closed.
  await page.locator('#steward-block > summary').click();
  await expect(page.locator('#steward-note')).toBeVisible();
  await expect(page.locator('#steward-note')).toContainText('Cannot make payments.');
  await expect(page.locator('#steward-note')).toHaveCount(1);
  expect(s.aiRequests).toHaveLength(0);
  expect(s.writes).toEqual([]);
  await page.locator('#steward-block > summary').click();
  await page.locator('#ledger-goal').getByText(/starting progress/i).first().click();
  const before = s.finance();
  await ask(page);
  await expect(page.locator('#steward-answer')).toContainText('The Manor needs $15.00 more.');
  await expect.poll(() => agent(page)).toMatchObject({ source: 'ag-studio-agent-framework', state: 'idle', completed: 1, threads: 0 });
  expect(s.aiRequests).toHaveLength(2); // one fake model conversation, with a ledger tool round
  expect(s.writes).toEqual(['POST /api/steward']);
  expect(s.finance()).toBe(before);
  expect(s.issues).toEqual([]);
  // The framework is headless; it adds no visible second chat or roster.
  await expect(page.locator('#panel-ledger h3')).toHaveText('Treasury');
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}${info.project.name}-existing-steward.png` });
  // A completed answer also clears when the selected record changes.
  await page.locator('#ledger-goal').getByText('Test fixture gift', { exact: false }).first().click();
  await expect(page.locator('#steward-answer')).toBeHidden();
  expect(s.writes).toEqual(['POST /api/steward']);
});

test('changing member during a held request cancels the scoped run and never shows the late answer', async ({ page }) => {
  await start(page, { hold: true });
  const before = s.finance();
  await ask(page);
  await expect.poll(() => s.aiRequests.length).toBe(1);
  await page.locator('#persona').selectOption('m_wren');
  await expect(page.locator('#steward-status')).toContainText('records changed');
  await expect.poll(() => agent(page)).toMatchObject({ state: 'idle', cancelled: 1, completed: 0, threads: 0 });
  s.release();
  await expect.poll(() => s.aiRequests.length).toBe(2);
  await expect(page.locator('#steward-answer')).toBeHidden();
  expect(s.writes).toEqual(['POST /api/steward']);
  expect(s.finance()).toBe(before);
  expect(s.issues).toEqual([]);
});

test('a question asked while Studio never answers is refused after a member change; the next runs once without Studio, and a late Studio starts nothing', { tag: '@release' }, async ({ page }) => {
  await start(page, { stall: true });
  const before = s.finance();
  await ask(page);
  await expect(page.locator('#steward-status')).toContainText('reading the ledger');
  await page.locator('#persona').selectOption('m_wren');
  await eightSecondsAfter(page, s.ledgerAt);
  // The milestone falls back within the wait, and the question asked for Rowan is not run for Wren.
  await expect(page.locator('#treasury-next .next-area[data-source="fallback"]')).toBeVisible();
  await expect(page.locator('#steward-status')).toHaveText('The records changed. Check the current record again.');
  expect(s.aiRequests).toHaveLength(0);
  expect(s.writes).toEqual([]);
  // The next explicit question, by the adult, runs once and does not claim the framework.
  await page.locator('#persona').selectOption('m_rowan');
  await ask(page);
  await expect(page.locator('#steward-answer')).toContainText('The Manor needs $15.00 more.');
  expect(await agent(page)).toMatchObject({ source: 'fallback', state: 'idle', completed: 1 });
  expect(s.aiRequests).toHaveLength(2);
  expect(s.writes).toEqual(['POST /api/steward']);
  // Studio arrives late: nothing mounts and nothing is asked.
  s.releaseStudio();
  await page.waitForFunction(() => window.agStudio);
  await frames(page);
  await expect(page.locator('#treasury-next .ag-studio-root')).toHaveCount(0);
  expect((await page.evaluate(() => window.__ourCastle.treasury())).source).toBe('fallback');
  expect(s.aiRequests).toHaveLength(2);
  expect(s.writes).toEqual(['POST /api/steward']);
  expect(s.finance()).toBe(before);
  expect(s.issues).toEqual([]);
});

test('a failed request leaves the framework usable for the next explicit check, without automatic retry', async ({ page }) => {
  await start(page);
  await page.route('**/api/steward', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Test fixture: unavailable' } }) }), { times: 1 });
  await ask(page);
  await expect(page.locator('#steward-status')).toContainText('Test fixture: unavailable');
  expect(s.aiRequests).toHaveLength(0);
  await expect.poll(() => agent(page)).toMatchObject({ state: 'idle', completed: 0, threads: 0 });
  await ask(page);
  await expect(page.locator('#steward-answer')).toContainText('The Manor needs $15.00 more.');
  await expect.poll(() => agent(page)).toMatchObject({ state: 'idle', completed: 1, threads: 0 });
  expect(s.aiRequests).toHaveLength(2);
  expect(s.issues).toEqual([]);
});

test('if Studio cannot load, the original steward still works and does not claim framework use', async ({ page }) => {
  await start(page, { studio: false });
  await ask(page);
  await expect(page.locator('#steward-answer')).toContainText('The Manor needs $15.00 more.');
  expect(await agent(page)).toMatchObject({ source: 'fallback', state: 'idle', completed: 1 });
  expect(s.writes).toEqual(['POST /api/steward']);
  expect(s.issues).toEqual([]);
});

test('a failed Studio live update keeps the milestone and next explicit steward request usable', async ({ page }) => {
  await start(page, { failUpdate: true });
  expect(await page.evaluate(() => window.__testUpdateFailure)).toEqual({ mounted: true, attempts: 0 });
  await ask(page);
  await expect.poll(() => agent(page)).toMatchObject({ source: 'ag-studio-agent-framework', completed: 1 });
  const initial = await page.evaluate(() => window.__ourCastle.state);
  const edited = await page.request.put(`${s.base}/api/goal`, { data: {
    name: initial.goal.name, targetCents: 40000, startingCents: 6000,
    weeklyBudgetCents: initial.goal.weeklyBudgetCents, targetDate: initial.goal.targetDate,
  } });
  expect(edited.ok()).toBe(true);
  await page.locator('#bill-form [name="label"]').fill('Fixture water bill');
  await page.locator('#bill-form [name="amount"]').fill('25'); await page.locator('#bill-form button').click();
  await expect(page.locator('#deed-dialog')).toBeVisible();
  await page.locator('#deed-close').click();
  await expect.poll(() => page.evaluate(() => window.__ourCastle.treasury().source)).toBe('fallback');
  expect(await page.evaluate(() => window.__testUpdateFailure.attempts)).toBe(1);
  await expect(page.locator('#treasury-next')).toContainText('$60.00 of $100.00');
  expect(s.aiRequests).toHaveLength(2, 'failed update never starts a model request');
  const before = s.finance();
  await ask(page);
  await expect.poll(() => agent(page)).toMatchObject({ source: 'fallback', state: 'idle', completed: 1 });
  expect(s.aiRequests).toHaveLength(4);
  expect(s.finance()).toBe(before);
  expect(s.issues).toEqual([]);
});

test('the framework preserves exact-order proof from the server and clears it on another record (fake PayPal)', async ({ page }) => {
  await start(page, { sandbox: true });
  const before = s.finance();
  await page.getByRole('button', { name: 'Ask the steward to verify', exact: true }).click();
  await expect(page.locator('#steward-answer')).toContainText('PayPal and ledger match');
  await expect(page.locator('#steward-answer .checks')).toContainText(s.orderId);
  await expect.poll(() => agent(page)).toMatchObject({ source: 'ag-studio-agent-framework', completed: 1, threads: 0 });
  expect(s.aiRequests[0].tool_choice).toEqual({ type: 'auto' });
  expect(s.aiRequests[0].tools.find((t) => t.name === 'get_order').input_schema.properties.order_id.enum).toEqual([s.orderId]);
  expect(s.writes).toEqual(['POST /api/steward']);
  expect(s.finance()).toBe(before);
  await page.locator('#ledger-goal').getByText(/starting progress/i).first().click();
  await expect(page.locator('#steward-answer')).toBeHidden();
  expect(s.issues).toEqual([]);
});
