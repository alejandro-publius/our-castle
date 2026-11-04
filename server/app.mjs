import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  DEMO_HOUSEHOLD_ID, DomainError, addSelfReportedEntry, ensureDemoHousehold, getActiveGoal, getGoal, resetHousehold,
  setupHousehold, updateCrest, updateGoal,
} from './household.mjs';
import { PlanInputError } from './planner/basis.mjs';
import { createPlanner } from './planner/index.mjs';
import { createContributionService } from './payments/contributions.mjs';
import { createSteward } from './steward/index.mjs';
import { buildState } from './view.mjs';
import { publicModes } from './config.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8',
};
const STATIC_FILES = new Set(['index.html', 'app.css', 'art-preview.html', 'art-preview.css']);
const STATIC_PREFIXES = ['src/', 'assets/', 'vendor/', 'references/'];
// Installed browser libraries served from node_modules by exact path (nothing else there is reachable).
const PACKAGE_FILES = new Map([
  ['vendor/ag-grid/ag-grid-community.min.js', 'node_modules/ag-grid-community/dist/ag-grid-community.min.js'],
  ['vendor/ag-grid/LICENSE.txt', 'node_modules/ag-grid-community/LICENSE.txt'],
]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_BODY = 64 * 1024;
const PAYPAL_SOURCES = 'https://*.paypal.com https://*.paypalobjects.com https://*.braintreegateway.com https://*.braintree-api.com https://*.venmo.com';

function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
}

function contentSecurityPolicy(hashes, paymentsMode) {
  const paypal = paymentsMode === 'sandbox' ? ` ${PAYPAL_SOURCES}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}${paypal}`,
    `style-src 'self' 'unsafe-inline'${paypal}`,
    `img-src 'self' data:${paypal}`,
    `connect-src 'self'${paypal}`,
    `frame-src${paypal || " 'none'"}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/**
 * Domains for a PayPal v6 client token. PayPal accepts bare domain names only and rejects
 * localhost and IP addresses, so a local prototype sends none (PayPal then issues an unrestricted sandbox token).
 */
export function clientTokenDomains(hostHeader) {
  const hostname = String(hostHeader ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return [];
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) return [];
  return [hostname];
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Same-machine checks: refuse rebinding hosts and cross-site writes. */
function checkHostAndOrigin(req, { write }) {
  const host = req.headers.host ?? '';
  let hostname;
  try { hostname = new URL(`http://${host}`).hostname; } catch { hostname = ''; }
  if (!LOCAL_HOSTS.has(hostname)) throw new HttpError(403, 'host_not_allowed', 'This local prototype only answers on localhost.');
  if (!write) return;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new HttpError(403, 'origin_not_allowed', 'Cross-site requests are not allowed.');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
    throw new HttpError(403, 'origin_not_allowed', 'Cross-site requests are not allowed.');
  }
}

const str = (v) => (typeof v === 'string' ? v : undefined);

export function createApp({ config, db, clock, paypal = null, aiProvider = null, stewardAi = null, paypalTools = null, stewardFetch, root }) {
  ensureDemoHousehold(db, clock);
  const planner = createPlanner({ db, clock, provider: aiProvider });
  const contributions = createContributionService({ db, clock, mode: config.payments.mode, paypal, webhookId: config.payments.webhookId });
  const householdId = DEMO_HOUSEHOLD_ID;
  const steward = createSteward({ db, contributions, householdId, ai: stewardAi, paypalTools, fetch: stewardFetch, clock });
  const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = contentSecurityPolicy(inlineScriptHashes(indexHtml), config.payments.mode);
  const stewardInfo = {
    available: steward.available,
    paypalTools: steward.paypalToolsAvailable,
    model: stewardAi?.model ?? null,
    paypalImplementation: paypal?.implementation ?? null,
  };
  const state = () => buildState({ db, householdId, planner, contributions, config, steward: stewardInfo });
  const goalId = () => getActiveGoal(db, householdId).id;

  // Each route returns a JSON body. Mutations return the fresh state so the board can update at once.
  const routes = [
    ['GET', '/api/status', () => publicModes(config)],
    ['GET', '/api/state', () => state()],
    ['POST', '/api/setup', ({ body }) => {
      setupHousehold(db, householdId, { playMode: body.playMode, name: body.name, crest: body.crest });
      return { state: state() };
    }],
    ['PUT', '/api/house', ({ body }) => {
      updateCrest(db, householdId, { name: body.name, crest: body.crest });
      return { state: state() };
    }],
    ['PUT', '/api/goal', ({ body }) => {
      updateGoal(db, goalId(), body, clock);
      return { state: state() };
    }],
    ['POST', '/api/plans', async ({ body }) => {
      if (body.goal) applyGoalIfChanged(body.goal);
      const result = await planner.propose({ householdId, goalId: goalId(), commitments: body.commitments });
      return { ...result, state: state() };
    }],
    ['POST', '/api/plans/rules', ({ body }) => {
      if (body.goal) applyGoalIfChanged(body.goal);
      const result = planner.proposeRules({ householdId, goalId: goalId(), commitments: body.commitments, afterAiFailure: body.afterAiFailure === true });
      return { ...result, state: state() };
    }],
    ['PUT', /^\/api\/plans\/([\w-]+)$/, ({ body, params }) => {
      const plan = planner.edit({ householdId, goalId: goalId(), planId: params[0], amounts: body.amounts });
      return { status: 'ok', plan, state: state() };
    }],
    ['POST', /^\/api\/plans\/([\w-]+)\/accept$/, ({ params }) => {
      const plan = planner.accept({ householdId, goalId: goalId(), planId: params[0] });
      return { status: 'ok', plan, state: state() };
    }],
    ['POST', '/api/steward', async ({ body }) => steward.ask({ question: body.question, memberId: str(body.memberId), focusOrderId: str(body.focusOrderId) })],
    ['POST', '/api/entries', ({ body }) => {
      const result = addSelfReportedEntry(db, { householdId, goalId: goalId(), kind: body.kind, amountCents: body.amountCents, label: body.label, memberId: str(body.memberId) }, clock);
      return { ...result, state: state() };
    }],

    // ---- PayPal sandbox ----
    ['GET', '/api/paypal/config', () => {
      if (config.payments.mode !== 'sandbox') return { mode: 'example' };
      return { mode: 'sandbox', clientId: config.payments.clientId, sdkUrl: config.payments.sdkUrl, currency: 'USD' };
    }],
    ['POST', '/api/paypal/client-token', async ({ req }) => {
      const token = await contributions.clientToken({ domains: clientTokenDomains(req.headers.host) });
      return { accessToken: token.accessToken, expiresIn: token.expiresIn };
    }],
    ['POST', '/api/paypal/orders', async ({ body }) => {
      const created = await contributions.createPayPalOrder(contributionInput(body));
      return { orderId: created.orderId, approveUrl: created.approveUrl, contribution: created.contribution };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/capture$/, async ({ body, params }) => {
      const result = await contributions.capturePayPalOrder({ providerOrderId: params[0], householdId: str(body.householdId), goalId: str(body.goalId) });
      return { ...result, state: state() };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/refresh$/, async ({ body, params }) => {
      const result = await contributions.refreshPayPalOrder({ providerOrderId: params[0], householdId: str(body.householdId), goalId: str(body.goalId) });
      return { ...result, state: state() };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/cancel$/, ({ body, params }) => {
      const result = contributions.cancelPayPalOrder({ providerOrderId: params[0], householdId: str(body.householdId), goalId: str(body.goalId) });
      return { ...result, state: state() };
    }],
    ['POST', /^\/api\/paypal\/captures\/([\w-]+)\/refund$/, async ({ body, params }) => {
      const result = await contributions.refundPayPalCapture({ captureId: params[0], householdId: str(body.householdId), approverId: str(body.approverId), approvalConfirmed: body.approvalConfirmed });
      return { ...result, state: state() };
    }],
    ['POST', '/api/paypal/webhook', async ({ req, rawBody }) => contributions.handleWebhook({ headers: req.headers, rawBody })],

    // ---- Example mode (explicitly simulated) ----
    ['POST', '/api/example/contributions', ({ body }) => {
      const result = contributions.simulateContribution({ ...contributionInput(body), outcome: str(body.outcome) ?? 'completed' });
      return { ...result, state: state() };
    }],
    ['POST', /^\/api\/example\/contributions\/([\w-]+)\/complete$/, ({ body, params }) => {
      const result = contributions.completeSimulatedPending({ contributionId: params[0], householdId: str(body.householdId) });
      return { ...result, state: state() };
    }],
    ['POST', /^\/api\/example\/captures\/([\w-]+)\/refund$/, ({ body, params }) => {
      const result = contributions.simulateRefund({ captureId: params[0], householdId: str(body.householdId), approverId: str(body.approverId), approvalConfirmed: body.approvalConfirmed });
      return { ...result, state: state() };
    }],
    ['POST', '/api/demo/reset', () => {
      if (config.payments.mode !== 'example') throw new DomainError(403, 'reset_disabled', 'Reset is only available in example mode, so sandbox records are kept.');
      resetHousehold(db, clock);
      return { state: state() };
    }],
  ];

  function contributionInput(body) {
    return {
      householdId: str(body.householdId),
      goalId: str(body.goalId),
      amountCents: body.amountCents,
      approverId: str(body.approverId),
      approvalConfirmed: body.approvalConfirmed,
      requestId: str(body.requestId),
    };
  }

  function applyGoalIfChanged(input) {
    const current = getGoal(db, goalId());
    const starting = state().progress.startingCents;
    const changed = input.name !== current.name || input.targetCents !== current.targetCents || input.targetDate !== current.targetDate
      || input.weeklyBudgetCents !== current.weeklyBudgetCents || input.startingCents !== starting;
    if (changed) updateGoal(db, current.id, input, clock);
  }

  async function serveStatic(req, res, pathname) {
    let relative;
    try { relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname).slice(1); } catch { relative = ''; }
    const packaged = PACKAGE_FILES.get(relative);
    const allowed = Boolean(packaged) || STATIC_FILES.has(relative) || STATIC_PREFIXES.some((p) => relative.startsWith(p));
    const file = path.resolve(root, packaged ?? relative);
    if (!allowed || relative.split('/').some((part) => part.startsWith('.') || part === '') || !file.startsWith(root)) {
      return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
    }
    let info;
    try { info = await stat(file); } catch { info = null; }
    if (!info?.isFile()) return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
    const headers = {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': relative.endsWith('.html') || relative.startsWith('src/') || relative.endsWith('.css') ? 'no-cache' : 'public, max-age=3600',
    };
    if (relative === 'index.html') headers['Content-Security-Policy'] = csp;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        checkHostAndOrigin(req, { write: false });
        if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        return await serveStatic(req, res, url.pathname);
      }
      const write = req.method !== 'GET';
      const webhook = url.pathname === '/api/paypal/webhook';
      if (webhook) {
        // PayPal calls this from the internet (through a tunnel); it is authenticated by signature, not origin.
      } else checkHostAndOrigin(req, { write });
      let match = null;
      const route = routes.find(([method, pattern]) => {
        if (method !== req.method) return false;
        if (typeof pattern === 'string') return pattern === url.pathname;
        match = pattern.exec(url.pathname);
        return Boolean(match);
      });
      if (!route) throw new HttpError(404, 'not_found', 'Unknown API route.');
      let body = {};
      let rawBody = '';
      if (write) {
        rawBody = await readBody(req);
        if (!webhook) {
          if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'json_required', 'Send JSON.');
          try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.'); }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.');
        }
      }
      const result = await route[2]({ req, body, rawBody, params: match ? match.slice(1) : [] });
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpError || error instanceof PlanInputError) {
        return sendJson(res, error.status, { error: { code: error.code, message: error.message, issues: error.issues, debugId: error.debugId } });
      }
      console.error('[our-house] unexpected error', error);
      sendJson(res, 500, { error: { code: 'server_error', message: 'Unexpected server error. No payment was credited.' } });
    }
  }

  return { handler, planner, contributions, steward, state };
}
