import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, createClock, ensureDemoHousehold, progressFor, setupHousehold } from '../../server/household.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { createFakePayPal, fakeSdkControllers, webhookHeaders } from '../helpers/fake-paypal.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';

// Seeded payment sequences, checked after every action against an independent reference model. The method follows
// TigerBeetle's VOPR at a much smaller scale: a seed fixes every choice, faults (lost answers; late, repeated and
// reordered webhooks) are injected on purpose, and separate checks compare the outcome with the model. It is not a
// deterministic simulator of the whole app.
//
// What runs: the real contribution service on a disposable SQLite file, with the existing stateful fake PayPal, which
// answers every request in memory. Two client paths are covered:
// - rest: the production REST client (OAuth, PayPal-Request-Id, JSON and error mapping) over an in-memory fetch;
// - sdk: the production SDK adapter (server/payments/paypal-sdk-client.mjs) over fakeSdkControllers. Those stand in for
//   the Server SDK's controllers, so the SDK's own serialization, OAuth and HTTP transport are NOT exercised here;
//   paypal-sdk-transport.test.mjs and payment-restart.test.mjs cover them. Webhook verification uses the REST client.
// Closing and reopening the database is not process death or power loss; payment-restart.test.mjs covers SIGKILL.
//
// The model is plain integers and sets, written from what each action did and from the evidence the app has actually
// been shown; it never calls production code to predict anything (progressFor only observes). After every action the
// app's progress, credits, reversals and per-capture refund totals must match it and stay within what PayPal verified.
// After a final explicit check of every order, the app must agree with PayPal's own record.
//
// Replay one seed: PAYMENT_MODEL_SEED=<1-4294967295> [PAYMENT_MODEL_ADAPTER=rest|sdk] node --test test/unit/payment-model.test.mjs
// PAYMENT_MODEL_REFUNDS=any also lets dashboard refunds reach captures this server has not credited yet. That wider
// space is outside the supported subset CI runs (the default, credited); docs/VALIDATION.md records what it shows.
const root = fileURLToPath(new URL('../../', import.meta.url));
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const STARTING_CENTS = 6000; // the example house's reported starting savings
const TARGET_CENTS = 30000; // and its goal
const MAX_ORDERS = 6;
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025];
const SENSITIVITY_SEED = 2;

function parseSeed(value) {
  const text = String(value);
  if (!/^[1-9]\d{0,9}$/.test(text) || Number(text) > 0xffffffff) throw new Error(`PAYMENT_MODEL_SEED must be a whole number from 1 to 4294967295, not ${JSON.stringify(value)}`);
  return Number(text);
}
function parseChoice(name, value, choices) {
  if (!choices.includes(value)) throw new Error(`${name} must be ${choices.join(' or ')}, not ${JSON.stringify(value)}`);
  return value;
}
const seeds = process.env.PAYMENT_MODEL_SEED === undefined ? SEEDS : [parseSeed(process.env.PAYMENT_MODEL_SEED)];
const adapters = process.env.PAYMENT_MODEL_ADAPTER === undefined ? ['rest', 'sdk'] : [parseChoice('PAYMENT_MODEL_ADAPTER', process.env.PAYMENT_MODEL_ADAPTER, ['rest', 'sdk'])];
const refundScope = parseChoice('PAYMENT_MODEL_REFUNDS', process.env.PAYMENT_MODEL_REFUNDS ?? 'credited', ['credited', 'any']);

function sourceCommit() {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const head = git('rev-parse', '--short', 'HEAD');
    return git('status', '--porcelain', '--untracked-files=no') ? `${head} with uncommitted changes` : head;
  } catch { return 'an unknown commit'; }
}
const commit = sourceCommit();

// Nothing here may reach a network: PayPal is answered in memory, and any other fetch is refused.
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (url) => { throw new Error(`Refused a network call to ${url}`); }; });
after(() => { globalThis.fetch = realFetch; });

// mulberry32: a small, well-known 32-bit generator, so one seed always makes the same choices.
function generator(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (items) => items[Math.floor(next() * items.length)] };
}
const sum = (values) => [...values].reduce((total, cents) => total + cents, 0);
const dollars = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = (items) => items.join(',') || 'none';

// ---- The reference model ----------------------------------------------------------------------------------------
// provider: what PayPal holds per order: the amount; its capture (status null until PayPal captures; a refunded capture
// stays COMPLETED here, with its refunds listed); and the capture status in PayPal's first answer, which PayPal repeats
// for the same PayPal-Request-Id. completed and shown: the evidence the app has been shown, by capture and refund id.
// firstSeenRefunded: captures whose completion the app first saw on an order already listing refunds (wider space only).
// events: the verified webhooks PayPal has sent, each deliverable late, again or never.
function createModel() {
  return { provider: new Map(), completed: new Set(), shown: new Map(), firstSeenRefunded: new Set(), events: [] };
}
const orderOf = (m, captureId) => [...m.provider.values()].find((o) => o.captureId === captureId);
// The app counts each capture it has been shown PayPal completed, once, less each completed refund of it, once.
const reversed = (m) => [...m.shown].filter(([, r]) => m.completed.has(r.captureId));
function expected(m) {
  const credited = [...m.completed].sort();
  const creditedCents = sum(credited.map((c) => orderOf(m, c).amount));
  const reversedCents = sum(reversed(m).map(([, r]) => r.amount));
  return { credited, reversals: reversed(m).map(([id]) => id).sort(), creditedCents, reversedCents, progressCents: STARTING_CENTS + creditedCents - reversedCents };
}
const refundedHere = (m, captureId) => sum(reversed(m).filter(([, r]) => r.captureId === captureId).map(([, r]) => r.amount));
const paypalProgress = (m) => STARTING_CENTS + sum([...m.provider.values()].filter((o) => o.status === 'COMPLETED').map((o) => o.amount - sum(o.refunds.values())));
function showCompleted(m, captureId) { m.completed.add(captureId); }
function showRefund(m, refundId, captureId, amount) { if (!m.shown.has(refundId)) m.shown.set(refundId, { captureId, amount }); }
function showOrder(m, order) { // the app read PayPal's current order
  if (order.status !== 'COMPLETED') return;
  if (!m.completed.has(order.captureId) && order.refunds.size) m.firstSeenRefunded.add(order.captureId);
  showCompleted(m, order.captureId);
  for (const [refundId, amount] of order.refunds) showRefund(m, refundId, order.captureId, amount);
}

// ---- Observing the app (reads only) -----------------------------------------------------------------------------
function observe(db) {
  const ledger = Object.fromEntries(db.prepare('SELECT kind, SUM(amount_cents) AS cents, COUNT(*) AS n FROM ledger_entries WHERE goal_id = ? GROUP BY kind').all(DEMO_GOAL_ID).map((r) => [r.kind, r]));
  const captures = db.prepare('SELECT capture_id, amount_cents, credited, refunded_cents FROM payment_captures ORDER BY capture_id').all();
  return {
    progressCents: progressFor(db, DEMO_GOAL_ID).progressCents, // the app's own projection, read to observe it
    startingCents: ledger.starting_progress?.cents ?? 0,
    credits: ledger.contribution?.n ?? 0,
    creditedCents: ledger.contribution?.cents ?? 0,
    reversals: ledger.refund?.n ?? 0,
    reversedCents: ledger.refund?.cents ?? 0,
    credited: captures.filter((c) => c.credited).map((c) => c.capture_id),
    captures: Object.fromEntries(captures.map((c) => [c.capture_id, c])),
    reversedRefunds: db.prepare('SELECT refund_id FROM payment_refunds WHERE credited = 1 ORDER BY refund_id').all().map((r) => r.refund_id),
    recordedRefunds: Object.fromEntries(db.prepare("SELECT capture_id, SUM(amount_cents) AS cents FROM payment_refunds WHERE status = 'COMPLETED' GROUP BY capture_id").all().map((r) => [r.capture_id, r.cents])),
    orders: db.prepare('SELECT provider_order_id AS id, amount_cents AS cents FROM payment_orders ORDER BY provider_order_id').all().map((r) => `${r.id}:${r.cents}`),
  };
}
// scope credited (the supported subset) compares the record itself as well as the money. In the wider space, a capture
// PayPal refunded before this server saw it complete is a documented choice ("never credit retroactively"): it may be
// recorded without a credit and reversal, so only money is compared there.
function violations(m, o, scope = 'credited') {
  const want = expected(m);
  const found = [];
  if (o.progressCents !== want.progressCents) found.push(`tracked progress ${o.progressCents} cents, model ${want.progressCents}`);
  if (o.startingCents !== STARTING_CENTS) found.push(`starting progress ${o.startingCents} cents, model ${STARTING_CENTS}`);
  const netHere = (c) => (o.captures[c]?.credited ? o.captures[c].amount_cents - o.captures[c].refunded_cents : 0);
  const netModel = (c) => (m.completed.has(c) ? orderOf(m, c).amount - refundedHere(m, c) : 0);
  for (const c of [...new Set([...Object.keys(o.captures), ...m.completed])].sort()) if (netHere(c) !== netModel(c)) found.push(`capture ${c} nets ${netHere(c)} cents here, model ${netModel(c)}`);
  if (scope === 'credited') {
    if (o.credits !== want.credited.length || o.creditedCents !== want.creditedCents) found.push(`${o.credits} contribution credits of ${o.creditedCents} cents, model ${want.credited.length} of ${want.creditedCents}`);
    if (o.reversals !== want.reversals.length || o.reversedCents !== want.reversedCents) found.push(`${o.reversals} refund reversals of ${o.reversedCents} cents, model ${want.reversals.length} of ${want.reversedCents}`);
    if (!sameList(o.credited, want.credited)) found.push(`credited captures ${list(o.credited)}, model ${list(want.credited)}`);
    if (!sameList(o.reversedRefunds, want.reversals)) found.push(`reversed refunds ${list(o.reversedRefunds)}, model ${list(want.reversals)}`);
    for (const c of want.credited) if ((o.captures[c]?.refunded_cents ?? 0) !== refundedHere(m, c)) found.push(`capture ${c} refunded ${o.captures[c]?.refunded_cents ?? 0} cents here, model ${refundedHere(m, c)}`);
  }
  const orders = [...m.provider].map(([id, order]) => `${id}:${order.amount}`).sort();
  if (!sameList(o.orders, orders)) found.push(`local orders ${list(o.orders)}, model ${list(orders)}`);
  // Whatever the app has been shown: a capture's net credit never exceeds what PayPal verified for it (nothing, while it
  // is pending or unknown) less the completed refunds of it that the app has on record.
  for (const capture of Object.values(o.captures)) {
    if (!capture.credited) continue;
    const order = orderOf(m, capture.capture_id);
    const verified = order?.status === 'COMPLETED' ? order.amount : 0;
    const recorded = o.recordedRefunds[capture.capture_id] ?? 0;
    const net = capture.amount_cents - capture.refunded_cents;
    if (net > verified - recorded) found.push(`capture ${capture.capture_id} nets ${net} cents here, above PayPal's verified ${verified} less ${recorded} of completed refunds on record`);
  }
  return found;
}
// After the final sweep, the app must agree with PayPal's own record, computed from the model's provider side only.
function divergence(m, o, scope = 'credited') {
  const found = [];
  if (o.progressCents !== paypalProgress(m)) found.push(`tracked progress ${o.progressCents} cents, PayPal's record ${paypalProgress(m)}`);
  for (const [orderId, order] of m.provider) {
    if (order.status !== 'COMPLETED') continue;
    const here = o.captures[order.captureId];
    const refunded = sum(order.refunds.values());
    const net = here?.credited ? here.amount_cents - here.refunded_cents : 0;
    if (net !== order.amount - refunded) found.push(`capture ${order.captureId} of ${orderId} nets ${net} cents here, ${order.amount - refunded} in PayPal (${order.amount} captured, ${refunded} refunded)`);
    else if (scope === 'credited' && (!here?.credited || here.refunded_cents !== refunded)) found.push(`capture ${order.captureId} of ${orderId} is ${here?.credited ? `credited with ${here.refunded_cents} cents refunded` : 'not credited'} here; PayPal captured ${order.amount} and refunded ${refunded}`);
  }
  return found;
}

// ---- The app under test ----------------------------------------------------------------------------------------
// Every call to the fake passes through here, so a run can count dispatches and arm one fault per route: the request
// never reaches PayPal, or PayPal acts and its answer is lost. A dropped connection is raised the way each transport
// raises it in the existing unknown-outcome tests: fetch's TypeError, and the socket error under the SDK adapter.
function transportTo(fake) {
  const armed = new Map();
  let calls = 0;
  const via = (dropped) => async (url, init = {}) => {
    calls++;
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const fault = armed.get(route);
    armed.delete(route);
    if (fault === 'request') throw dropped();
    const response = await fake.fetch(url, init);
    if (fault === 'answer') throw dropped();
    return response;
  };
  return {
    armed,
    get calls() { return calls; },
    rest: via(() => new TypeError('fetch failed')),
    sdk: { fetch: via(() => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })) },
  };
}
function openApp(file, transport, adapter, first) {
  const db = openDatabase(file);
  const clock = createClock(FIXED_NOW);
  ensureDemoHousehold(db, clock); // as the app does on every start; once the house exists it changes no record of money
  if (first) setupHousehold(db, DEMO_HOUSEHOLD_ID, { playMode: 'family', name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } });
  const credentials = { clientId: 'model-client', clientSecret: 'model-secret' }; // synthetic; nothing is read from .env
  const paypal = adapter === 'sdk'
    ? createPayPalSdkClient({ ...credentials, controllers: fakeSdkControllers(transport.sdk), restFetch: transport.rest })
    : createPayPalClient({ ...credentials, fetch: transport.rest });
  return { db, service: createContributionService({ db, clock, mode: 'sandbox', paypal, webhookId: 'WH-MODEL' }) };
}
// An answer, or the refusal's code. Failed assertions always propagate.
async function attempt(promise) {
  try { return { value: await promise }; } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    return { code: error.code ?? error.name, message: error.message };
  }
}

// ---- One seeded run -------------------------------------------------------------------------------------------------
async function runSeed(seed, adapter, scope, { atEnd } = {}) {
  const rand = generator(seed);
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'our-castle-model-')));
  const file = path.join(dir, 'model.sqlite');
  const fake = createFakePayPal(); // PayPal's state survives every reopen
  const transport = transportTo(fake);
  const m = createModel();
  const trace = [];
  const stats = { actions: {}, faults: {} };
  let app = null;
  let serial = 0;
  const ordered = () => [...m.provider.keys()];
  const label = (orderId) => `o${ordered().indexOf(orderId) + 1}`;
  const paypalRecord = () => [...m.provider].map(([id, o]) => `${label(id)}=${id}/${o.captureId ?? '-'} ${o.amount}c ${o.status ?? 'uncaptured'}${o.refunds.size ? ` refunded ${[...o.refunds.values()].join('+')}` : ''}`).join('; ');
  const replay = `PAYMENT_MODEL_SEED=${seed} PAYMENT_MODEL_ADAPTER=${adapter}${scope === 'credited' ? '' : ` PAYMENT_MODEL_REFUNDS=${scope}`} node --test test/unit/payment-model.test.mjs`;
  const fail = (problems) => assert.fail([
    `seed ${seed} (${adapter}, refunds of ${scope} captures) at ${commit}, action ${trace.length} "${trace.at(-1) ?? 'start'}": ${problems.join('; ')}`,
    `replay: ${replay}`,
    `actions: ${trace.join(' | ')}`,
    `paypal: ${paypalRecord() || 'no orders'}`,
  ].join('\n'));
  const check = () => { const found = violations(m, observe(app.db), scope); if (found.length) fail(found); };
  const begin = (text) => { trace.push(text); };
  const fault = (name) => { stats.faults[name] = (stats.faults[name] ?? 0) + 1; };
  const providerCapture = (orderId) => fake.orders.get(orderId).purchase_units[0].payments.captures[0];
  const enqueue = (orderId, type, resource) => m.events.push({ orderId, body: { id: `WH-MODEL-${seed}-${m.events.length + 1}`, event_type: type, resource } });
  const refundable = (id) => {
    const o = m.provider.get(id);
    return o.status === 'COMPLETED' && o.amount > sum(o.refunds.values()) && (scope === 'any' || m.completed.has(o.captureId));
  };

  const actions = {
    // An adult approves a new order for a varied amount. PayPal now holds an order; no money has moved.
    async create() {
      const amount = rand.int(100, 2500);
      begin(`create o${m.provider.size + 1} ${amount}c`);
      const { orderId } = await app.service.createPayPalOrder({ ...owner, amountCents: amount, approverId: 'm_rowan', approvalConfirmed: true, requestId: `model-${seed}-${++serial}` });
      m.provider.set(orderId, { amount, captureId: null, status: null, answer: null, refunds: new Map() });
    },
    // A capture request for an order not settled here: PayPal completes it or holds it, or repeats its first answer for
    // the same request id. The request can be lost on the way, or PayPal can act and its answer be lost; the app then
    // reads the order, and that read can be lost too. An order settled here is answered without asking PayPal.
    async capture() {
      const orderId = rand.pick(ordered());
      const order = m.provider.get(orderId);
      const before = transport.calls;
      if (order.captureId && m.completed.has(order.captureId)) {
        begin(`capture ${label(orderId)}: settled here`);
        const { outcome } = await app.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
        // A capture first seen refunded may stay unsettled here by the documented choice; only money is checked then.
        if (scope === 'any' && m.firstSeenRefunded.has(order.captureId)) return;
        if (outcome !== 'already_completed') fail([`answered ${outcome}, model already_completed`]);
        if (transport.calls !== before) fail(['a capture of an order settled here asked PayPal']);
        return;
      }
      const lost = rand.pick(['none', 'none', 'none', 'request', 'answer']);
      const readLost = lost !== 'none' && rand.next() < 0.5;
      const fresh = order.answer === null && lost !== 'request'; // PayPal captures now, for the first time
      const status = rand.next() < 0.4 ? 'PENDING' : 'COMPLETED';
      if (fresh) fake.behavior.captureStatus = status;
      if (lost !== 'none') { transport.armed.set(`POST /v2/checkout/orders/${orderId}/capture`, lost); fault(`capture ${lost} lost`); }
      if (readLost) { transport.armed.set(`GET /v2/checkout/orders/${orderId}`, 'answer'); fault('read after capture lost'); }
      const what = lost === 'request' ? 'request lost' : fresh ? status : `PayPal repeats ${order.answer}`;
      begin(`capture ${label(orderId)}: ${what}${lost === 'answer' ? ', answer lost' : ''}${readLost ? ', read lost' : ''}`);
      const { outcome } = await app.service.capturePayPalOrder({ providerOrderId: orderId, ...owner });
      if (fresh) {
        const capture = providerCapture(orderId);
        Object.assign(order, { captureId: capture.id, status, answer: status });
        enqueue(orderId, `PAYMENT.CAPTURE.${status}`, { ...structuredClone(capture), supplementary_data: { related_ids: { order_id: orderId } } });
      }
      // What the app has now been shown, and so what it should answer.
      let want = 'unknown';
      if (lost === 'none') {
        if (order.answer === 'COMPLETED') showCompleted(m, order.captureId);
        want = order.answer === 'COMPLETED' ? 'completed' : 'pending';
      } else if (!readLost && order.status) {
        showOrder(m, order);
        want = order.status === 'PENDING' ? 'pending' : order.refunds.size ? 'refunded' : 'completed';
      }
      // Only reachable in the wider space: the answer for a capture first seen refunded is the documented choice above.
      const refundedFirst = scope === 'any' && order.refunds.size > 0 && outcome === 'not_credited';
      if (outcome !== want && !refundedFirst) fail([`answered ${outcome}, model ${want}`]);
    },
    // PayPal completes a held capture and sends a webhook, which may arrive late, more than once or never.
    async complete() {
      const orderId = rand.pick(ordered().filter((id) => m.provider.get(id).status === 'PENDING'));
      begin(`paypal completes ${label(orderId)}`);
      const capture = fake.completePendingCapture(orderId);
      m.provider.get(orderId).status = 'COMPLETED';
      enqueue(orderId, 'PAYMENT.CAPTURE.COMPLETED', { ...capture, supplementary_data: { related_ids: { order_id: orderId } } });
    },
    // A partial or full refund in the PayPal dashboard: the order lists it and a webhook is sent. By default only captures
    // credited here are refunded (see refundScope above).
    async refund() {
      const orderId = rand.pick(ordered().filter(refundable));
      const order = m.provider.get(orderId);
      const left = order.amount - sum(order.refunds.values());
      const amount = rand.next() < 0.4 ? left : rand.int(1, left);
      const refundId = `DASHREFUND${seed}N${++serial}`;
      begin(`dashboard refund ${label(orderId)} ${amount}c${m.completed.has(order.captureId) ? '' : ' (not credited here)'}`);
      const capture = providerCapture(orderId);
      const resource = { id: refundId, status: 'COMPLETED', amount: { currency_code: 'USD', value: dollars(amount) }, links: [{ rel: 'up', href: `${SANDBOX}/v2/payments/captures/${capture.id}` }] };
      const unit = fake.orders.get(orderId).purchase_units[0];
      unit.payments.refunds = [...(unit.payments.refunds ?? []), structuredClone(resource)];
      order.refunds.set(refundId, amount);
      capture.status = sum(order.refunds.values()) === order.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      enqueue(orderId, 'PAYMENT.CAPTURE.REFUNDED', resource);
    },
    // A webhook PayPal sent earlier, delivered now: out of order, late or again, sometimes under a new event id. Rarely
    // its verification fails, or the verification's answer is lost; then nothing may change.
    async deliver() {
      const { orderId, body } = rand.pick(m.events);
      const delivered = rand.next() < 0.15 ? { ...body, id: `${body.id}-again` } : body;
      const trouble = rand.next() < 0.1 ? rand.pick(['unverified', 'verification answer lost']) : null;
      begin(`deliver ${delivered.id.replace(`WH-MODEL-${seed}-`, 'e')} ${body.event_type.split('.').at(-1)} ${label(orderId)}${trouble ? `, ${trouble}` : ''}`);
      if (trouble) fault(`webhook ${trouble}`);
      if (trouble === 'unverified') fake.behavior.webhookVerification = 'FAILURE';
      if (trouble === 'verification answer lost') transport.armed.set('POST /v1/notifications/verify-webhook-signature', 'answer');
      const answer = await attempt(app.service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(delivered) }));
      fake.behavior.webhookVerification = 'SUCCESS';
      if (trouble) {
        const want = trouble === 'unverified' ? 'invalid_signature' : 'paypal_error';
        if (answer.code !== want) fail([`answered ${answer.code ?? answer.value?.outcome}, model ${want}`]);
        return;
      }
      if (answer.code) fail([`a verified webhook was refused: ${answer.code} ${answer.message}`]);
      if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') showCompleted(m, body.resource.id);
      if (body.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
        const captureId = body.resource.links[0].href.split('/').at(-1);
        showRefund(m, body.resource.id, captureId, orderOf(m, captureId).refunds.get(body.resource.id));
      }
    },
    // The existing explicit "Check with PayPal" reads the order, unless that answer is lost.
    async refresh() {
      const orderId = rand.pick(ordered());
      const lost = rand.next() < 0.15;
      begin(`check ${label(orderId)} with PayPal${lost ? ', answer lost' : ''}`);
      if (lost) { transport.armed.set(`GET /v2/checkout/orders/${orderId}`, 'answer'); fault('check answer lost'); }
      const answer = await attempt(app.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner }));
      if (lost) {
        if (answer.code !== 'paypal_error') fail([`answered ${answer.code ?? answer.value?.outcome}, model paypal_error`]);
        return;
      }
      if (answer.code) fail([`the check was refused: ${answer.code} ${answer.message}`]);
      showOrder(m, m.provider.get(orderId));
    },
    // The disposable database and service are closed and opened again, and the journal's contributions are loaded.
    // PayPal's state survives; neither step may ask PayPal anything.
    async reopen() {
      begin('reopen the database and service, load contributions');
      const closing = app;
      app = null;
      closing.db.close();
      const before = transport.calls;
      app = openApp(file, transport, adapter, false);
      const listed = app.service.contributions(DEMO_GOAL_ID);
      if (transport.calls !== before) fail(['reopening or loading asked PayPal']);
      if (listed.length !== m.provider.size) fail([`${listed.length} contributions listed, model ${m.provider.size}`]);
    },
    // Safeguards hold in any state, and each refusal is made before PayPal is asked anything.
    async refuse() {
      const orderId = m.provider.size ? rand.pick(ordered()) : null;
      const variant = rand.pick(['unapproved', 'child', 'amount', 'over goal', 'not ours', ...(orderId ? ['other household', 'access revoked'] : [])]);
      const create = (input) => app.service.createPayPalOrder({ ...owner, amountCents: rand.int(100, 2500), approverId: 'm_rowan', approvalConfirmed: true, requestId: `model-${seed}-${++serial}`, ...input });
      const capture = (input) => app.service.capturePayPalOrder({ providerOrderId: orderId, ...owner, ...input });
      const cases = {
        unapproved: ['approval_required', () => create({ approvalConfirmed: false })],
        child: ['adult_approval_required', () => create({ approverId: 'm_wren' })],
        amount: ['invalid_amount', () => create({ amountCents: rand.pick([0, 99, 50_001, 1250.5]) })],
        'over goal': ['over_goal', () => create({ amountCents: TARGET_CENTS - expected(m).progressCents + 1 })],
        'not ours': ['unknown_order', () => capture({ providerOrderId: 'ORDERNOTFROMHERE1' })],
        'other household': ['order_mismatch', () => capture({ householdId: 'hh_other' })],
        'access revoked': ['access_revoked', () => capture({ assertAccess: () => { throw Object.assign(new Error('Access was revoked.'), { code: 'access_revoked' }); } })],
      };
      const [want, run] = cases[variant];
      begin(`refuse: ${variant}${orderId && ['other household', 'access revoked'].includes(variant) ? ` ${label(orderId)}` : ''}`);
      const before = transport.calls;
      const answer = await attempt(run());
      if (answer.code !== want) fail([`answered ${answer.code ?? 'success'}, model ${want}`]);
      if (transport.calls !== before) fail(['a refused request reached PayPal']);
    },
  };
  const applicable = () => {
    const orders = [...m.provider.values()];
    return [
      ...(m.provider.size < MAX_ORDERS ? ['create', 'create'] : []),
      'refuse',
      ...(orders.length ? ['capture', 'capture', 'capture', 'refresh', 'refresh', 'reopen'] : []),
      ...(orders.some((o) => o.status === 'PENDING') ? ['complete', 'complete'] : []),
      ...(ordered().some(refundable) ? ['refund', 'refund'] : []),
      ...(m.events.length ? ['deliver', 'deliver', 'deliver', 'deliver'] : []),
    ];
  };

  try {
    app = openApp(file, transport, adapter, true);
    const goal = app.db.prepare('SELECT target_cents FROM goals WHERE id = ?').get(DEMO_GOAL_ID);
    if (goal?.target_cents !== TARGET_CENTS) fail([`the example goal is ${goal?.target_cents} cents, model ${TARGET_CENTS}`]);
    check();
    const steps = rand.int(30, 60);
    for (let step = 0; step < steps; step++) {
      const kind = rand.pick(applicable());
      stats.actions[kind] = (stats.actions[kind] ?? 0) + 1;
      try { await actions[kind](); } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        fail([`${kind} threw ${error.code ?? error.name}: ${error.message}`]);
      } finally {
        transport.armed.clear();
        fake.behavior.webhookVerification = 'SUCCESS';
      }
      check();
    }
    // The final sweep: an explicit check of every order. Now the app must agree with PayPal's own record.
    begin('sweep: check every order with PayPal');
    for (const orderId of ordered()) {
      await app.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner });
      showOrder(m, m.provider.get(orderId));
    }
    check();
    const apart = divergence(m, observe(app.db), scope);
    if (apart.length) fail(apart);
    await atEnd?.({ model: m, db: app.db });
    const completed = [...m.provider.values()].filter((o) => o.status === 'COMPLETED');
    return {
      steps, ...stats,
      outcomes: { orders: m.provider.size, completed: completed.length, pending: [...m.provider.values()].filter((o) => o.status === 'PENDING').length, refunds: sum(completed.map((o) => o.refunds.size)), events: m.events.length },
    };
  } finally {
    app?.db.close();
    rmSync(dir, { recursive: true, force: true }); // this run's own temporary folder
  }
}

const add = (into, from) => { for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n; };
for (const adapter of adapters) {
  test(`seeded payment sequences match the reference model and converge to PayPal's record (${adapter})`, { timeout: 120_000 }, async (t) => {
    const totals = { steps: 0, actions: {}, faults: {}, outcomes: {} };
    for (const seed of seeds) {
      const run = await runSeed(seed, adapter, refundScope);
      totals.steps += run.steps;
      add(totals.actions, run.actions);
      add(totals.faults, run.faults);
      add(totals.outcomes, run.outcomes);
    }
    t.diagnostic(`${seeds.length} seed${seeds.length === 1 ? '' : 's'} [${seeds.join(', ')}] at ${commit}, refunds of ${refundScope} captures: ${totals.steps} actions ${JSON.stringify(totals.actions)}; faults ${JSON.stringify(totals.faults)}; final PayPal record ${JSON.stringify(totals.outcomes)}`);
  });
}

test('the checks notice a second credit or a one-cent difference, and replay input is validated', async () => {
  let checked = false;
  await runSeed(SENSITIVITY_SEED, 'rest', 'credited', {
    atEnd: ({ model, db }) => {
      const findings = () => [...violations(model, observe(db)), ...divergence(model, observe(db))].join('\n');
      assert.equal(findings(), '');
      const credit = db.prepare("SELECT id FROM ledger_entries WHERE kind = 'contribution' ORDER BY id LIMIT 1").get();
      const refunded = db.prepare('SELECT capture_id FROM payment_captures WHERE refunded_cents > 0 ORDER BY capture_id LIMIT 1').get();
      assert.ok(credit && refunded, `seed ${SENSITIVITY_SEED} credits a capture and reverses a refund of one`);
      const changed = (sql, ...params) => {
        db.exec('SAVEPOINT sensitivity');
        try { db.prepare(sql).run(...params); return findings(); } finally { db.exec('ROLLBACK TO sensitivity'); db.exec('RELEASE sensitivity'); }
      };
      const copy = `INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, member_id, label, created_at)
        SELECT household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref || ?, member_id, label, created_at FROM ledger_entries WHERE id = ?`;
      // The schema itself refuses a second entry under the same reference, so a double credit would carry another one.
      assert.throws(() => db.prepare(copy).run('', credit.id), /UNIQUE constraint failed: ledger_entries\.source_ref/);
      const twice = changed(copy, '#again', credit.id);
      const counted = /(\d+) contribution credits of \d+ cents, model (\d+) of/.exec(twice);
      assert.ok(counted && Number(counted[1]) === Number(counted[2]) + 1, twice);
      assert.match(twice, /tracked progress \d+ cents, model \d+/);
      assert.match(twice, /tracked progress \d+ cents, PayPal's record \d+/);
      const cent = changed('UPDATE ledger_entries SET amount_cents = amount_cents + 1 WHERE id = ?', credit.id);
      assert.match(cent, /tracked progress \d+ cents, model \d+/);
      assert.match(cent, /tracked progress \d+ cents, PayPal's record \d+/);
      const refundCent = changed('UPDATE payment_captures SET refunded_cents = refunded_cents - 1 WHERE capture_id = ?', refunded.capture_id);
      assert.match(refundCent, new RegExp(`capture ${refunded.capture_id} refunded \\d+ cents here, model \\d+`));
      assert.match(refundCent, new RegExp(`capture ${refunded.capture_id} nets \\d+ cents here, above PayPal's verified`));
      assert.equal(findings(), '', 'every change was rolled back');
      checked = true;
    },
  });
  assert.ok(checked);
  for (const bad of ['', 'abc', '0', '-1', '1.5', ' 7', '07', '1e3', '4294967296']) assert.throws(() => parseSeed(bad), /PAYMENT_MODEL_SEED must be a whole number/, JSON.stringify(bad));
  assert.equal(parseSeed('4294967295'), 4294967295);
  assert.throws(() => parseChoice('PAYMENT_MODEL_ADAPTER', 'soap', ['rest', 'sdk']), /PAYMENT_MODEL_ADAPTER must be rest or sdk, not "soap"/);
});
