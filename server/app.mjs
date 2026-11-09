import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  DEMO_HOUSEHOLD_ID, DomainError, addSelfReportedEntry, ensureDemoHousehold, getActiveGoal, getGoal, getMember, resetHousehold,
  progressFor, setupFamilyHouse, setupHousehold, updateCrest, updateGoal, updateGoalProject, updateMemberAvatar,
} from './household.mjs';
import { createAccess } from './access/index.mjs';
import { policyFor } from './access/policy.mjs';
import { STREAMING, createLive } from './live.mjs';
import { PlanInputError } from './planner/basis.mjs';
import { createPlanner } from './planner/index.mjs';
import { createContributionService } from './payments/contributions.mjs';
import { createSteward } from './steward/index.mjs';
import { buildState } from './view.mjs';
import { publicModes } from './config.mjs';
import { createMerchant } from './merchant/channel3.mjs';
import { goalItemFor, merchantGoalRevision, saveGoalFromItem } from './merchant/goal-item.mjs';
import {
  addChoice, checkChoiceForSave, familyChoicesView, fitContext, fitFinish, refreshChoice, removeChoice, removePreference, reviewChoice, saveOffer, setPreference, withdrawOffer,
} from './family-choices.mjs';
import { treasuryFor } from './treasury.mjs';
import { transaction } from './db.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};
const STATIC_FILES = new Set(['index.html', 'app.css', 'art-preview.html', 'art-preview.css']);
const STATIC_PREFIXES = ['src/', 'assets/', 'vendor/', 'references/'];
// Installed browser libraries served from node_modules by exact path (nothing else there is reachable).
const PACKAGE_FILES = new Map([
  ['vendor/ag-grid/ag-grid-community.min.js', 'node_modules/ag-grid-community/dist/ag-grid-community.min.js'],
  ['vendor/ag-grid/LICENSE.txt', 'node_modules/ag-grid-community/LICENSE.txt'],
  // AG Studio (commercial; local evaluation licence only), loaded on demand by the Ledger's next-area widget.
  ['vendor/ag-studio/ag-studio.min.js', 'node_modules/ag-studio/dist/umd/ag-studio.min.js'],
  ['vendor/ag-studio/LICENSE.html', 'node_modules/ag-studio/LICENSE.html'],
  // SimpleWebAuthn's browser helper (MIT), loaded only by the family sign-in screens.
  ['vendor/simplewebauthn/browser.umd.min.js', 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js'],
  ['vendor/simplewebauthn/LICENSE.md', 'node_modules/@simplewebauthn/browser/LICENSE.md'],
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
    `img-src 'self' data:${paypal} https://*.trychannel3.com`,
    `connect-src 'self'${paypal} https://api.open-meteo.com https://geocoding-api.open-meteo.com`,
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
// Write-method routes that change no household record: calculations, provider look-ups, questions and ceremony steps.
const UNCHANGING_WRITES = new Set(['/api/plans/preview', '/api/merchant/search', '/api/merchant/refresh', '/api/merchant/alternatives', '/api/merchant/categories', '/api/merchant/category',
  '/api/family-choices/review', '/api/family-choices/fit', '/api/steward', '/api/paypal/client-token', '/api/auth/passkeys/options', '/api/auth/signout']);

export function createApp({ config, db, clock, paypal = null, aiProvider = null, stewardAi = null, paypalTools = null, stewardFetch, merchant = null, root, live: liveLimits = {} }) {
  // Example mode is the single local example household. Family mode serves only households whose members enrolled their
  // own passkeys; it never creates, shows or falls back to the example household.
  const family = config.access?.mode === 'family';
  if (!family) ensureDemoHousehold(db, clock);
  // Family mode: live updates tell a household's open pages to re-read their state after any committed change.
  let access = null;
  const live = family ? createLive({ checkSession: (sessionId) => access.sessionEndReason(sessionId), limits: liveLimits }) : null;
  access = family ? createAccess({ db, clock, config: config.access, events: {
    sessionEnded: (sessionId, reason) => live.endSession(sessionId, reason === 'signed_out' ? 'signed_out' : reason === 'access_revoked' ? 'access_revoked' : reason === 'rotated' ? 'rotated' : 'expired'),
    memberRevoked: (memberId) => live.endMember(memberId, 'access_revoked'),
    householdChanged: (householdId) => live.notify(householdId),
  } }) : null;
  const planner = createPlanner({ db, clock, provider: aiProvider, family });
  const contributions = createContributionService({ db, clock, mode: config.payments.mode, paypal, webhookId: config.payments.webhookId });
  // The steward reads one household's records. In family mode every request gets one bound to its own scope.
  const stewardFor = (householdId) => createSteward({ db, contributions, householdId, ai: stewardAi, paypalTools, fetch: stewardFetch, clock });
  const steward = stewardFor(family ? null : DEMO_HOUSEHOLD_ID);
  const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = contentSecurityPolicy(inlineScriptHashes(indexHtml), config.payments.mode);
  const stewardInfo = {
    available: steward.available,
    paypalTools: steward.paypalToolsAvailable,
    localHistory: steward.localHistoryAvailable,
    model: stewardAi?.model ?? null,
    paypalImplementation: paypal?.implementation ?? null,
  };
  // Market Town merchant (Channel3). Tests inject a merchant with a fake transport; otherwise the key decides.
  const shop = merchant ?? createMerchant({ apiKey: config.merchant?.mode === 'live' ? config.merchant.apiKey : null, clock });
  // Which households this server showed each merchant draft. The merchant caches identical searches, so in family mode a
  // draft is saved only by a household that was actually shown it.
  const draftHouseholds = new Map();
  const state = (scope = exampleScope()) => {
    const s = buildState({ db, householdId: scope.householdId, planner, contributions, config, steward: stewardInfo });
    s.modes.merchant = shop.status();
    s.goalItem = goalItemFor(db, s.goal);
    s.merchantGoalRevision = merchantGoalRevision(s.goal, s.progress.startingCents);
    s.treasury = treasuryFor(s, clock.iso(), planner.accepted(s.goal.id));
    s.familyChoices = familyChoicesView(db, choiceScope(scope, s.goal, s.progress));
    if (family) { s.access = access.viewer(scope); s.revision = live.revisionOf(scope.householdId); }
    return s;
  };
  // Example mode's scope is the example household; family mode's comes only from a validated session (see handler).
  const exampleScope = () => Object.freeze({ mode: 'example', householdId: DEMO_HOUSEHOLD_ID, goalId: getActiveGoal(db, DEMO_HOUSEHOLD_ID).id });
  const familyOnly = () => { if (!family) throw new HttpError(404, 'not_found', 'Unknown API route.'); return access; };

  // Each route returns a JSON body. Mutations return the fresh state so the board can update at once.
  const routes = [
    ['GET', '/api/status', () => ({ ...publicModes(config), merchant: shop.status() })],
    ['GET', '/api/session', ({ session }) => (family ? { mode: 'family', ...access.sessionInfo(session) } : { mode: 'example' })],
    // Family mode: one live-update stream per open page; only change notices travel on it, never records.
    ['GET', '/api/events', ({ req, res, scope }) => {
      if (!family) throw new HttpError(404, 'not_found', 'Unknown API route.');
      try { return live.subscribe(req, res, scope); } catch (error) { throw new HttpError(error.status ?? 503, error.code ?? 'live_unavailable', error.message); }
    }],
    ['GET', '/api/state', ({ scope }) => state(scope)],
    ['POST', '/api/setup', ({ body, scope }) => {
      if (family) setupFamilyHouse(db, scope.householdId, { name: body.name, crest: body.crest });
      else setupHousehold(db, scope.householdId, { playMode: body.playMode, name: body.name, crest: body.crest });
      return { state: state(scope) };
    }],
    ['PUT', '/api/house', ({ body, scope }) => {
      updateCrest(db, scope.householdId, { name: body.name, crest: body.crest });
      return { state: state(scope) };
    }],
    ['PUT', /^\/api\/members\/([\w-]+)\/avatar$/, ({ body, params, scope }) => {
      updateMemberAvatar(db, scope.householdId, params[0], body.avatarId);
      return { state: state(scope) };
    }],
    ['PUT', '/api/goal', ({ body, scope }) => {
      checkGoalRevision(body.expectedGoalRevision, scope);
      updateGoal(db, scope.goalId, body, clock);
      return { state: state(scope) };
    }],
    ['POST', '/api/plans', async ({ body, scope, assertAccess }) => {
      if (body.goal) applyGoalIfChanged(body.goal, scope, body.expectedGoalRevision);
      const result = await planner.propose({ householdId: scope.householdId, goalId: scope.goalId, commitments: body.commitments, assertAccess });
      return { ...result, state: state(scope) };
    }],
    ['POST', '/api/plans/rules', ({ body, scope }) => {
      if (body.goal) applyGoalIfChanged(body.goal, scope, body.expectedGoalRevision);
      const result = planner.proposeRules({ householdId: scope.householdId, goalId: scope.goalId, commitments: body.commitments, afterAiFailure: body.afterAiFailure === true });
      return { ...result, state: state(scope) };
    }],
    // Read-only: revising what remains for a weekly amount and/or date the family is considering. Saves nothing. To use
    // the values, the family saves the goal (PUT /api/goal or the plan routes above) and reviews the fresh plan.
    ['POST', '/api/plans/preview', ({ body, scope }) => {
      const preview = planner.previewRemaining({ householdId: scope.householdId, goalId: scope.goalId, weeklyBudgetCents: body.weeklyBudgetCents ?? null, targetDate: body.targetDate ?? null });
      return { status: 'ok', preview };
    }],
    // A family schedule for the goal as it is now, from the comparison the adult saw and the one-off amount they entered.
    // Saved as a proposal only; "Use this plan" (below) is still the separate decision that puts it in use.
    ['POST', '/api/plans/family', ({ body, scope }) => {
      refuseForeign(body, scope);
      const plan = planner.proposeFamily({ householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), reserveCents: body.reserveCents,
        expected: { choicesRevision: str(body.revision) ?? null } });
      return { status: 'ok', plan, state: state(scope) };
    }],
    ['PUT', /^\/api\/plans\/([\w-]+)$/, ({ body, params, scope }) => {
      const plan = planner.edit({ householdId: scope.householdId, goalId: scope.goalId, planId: params[0], amounts: body.amounts });
      return { status: 'ok', plan, state: state(scope) };
    }],
    ['POST', /^\/api\/plans\/([\w-]+)\/accept$/, ({ params, scope }) => {
      const plan = planner.accept({ householdId: scope.householdId, goalId: scope.goalId, planId: params[0] });
      return { status: 'ok', plan, state: state(scope) };
    }],
    // ---- Market Town merchant: explicit product search, and an explicitly confirmed goal draft ----
    ['POST', '/api/merchant/search', async ({ body, scope }) => {
      // Bind the draft to the goal BEFORE the asynchronous search. A cached product response still gets this
      // request's own basis; family edits while Channel3 is answering cannot silently become consent to overwrite them.
      const goal = getActiveGoal(db, scope.householdId);
      const goalRevision = merchantGoalRevision(goal, progressFor(db, goal.id).startingCents);
      const found = await shop.search({ query: body.query, budgetCents: body.budgetCents ?? null });
      if (family) rememberDrafts(found, scope);
      return { ...found, goalId: goal.id, goalRevision };
    }],
    ['POST', '/api/merchant/goal', ({ body, scope }) => {
      if (family && !shownTo(body.draftId, scope)) {
        throw new DomainError(410, 'merchant_draft_expired', 'That merchant result has expired. Search again for a fresh price before saving.');
      }
      const item = shop.draft(str(body.draftId));
      // "Save goal and propose this schedule" (only after "Review this choice"): the same goal save, plus the reviewed family
      // schedule as a proposal, in one transaction. Either both are saved or neither is; nothing is put in use or paid.
      const proposing = body.schedule !== undefined;
      if (proposing && (body.familyChoice === undefined || body.schedule === null || typeof body.schedule !== 'object')) {
        throw new DomainError(400, 'invalid_schedule', 'Review a family choice before proposing its schedule.');
      }
      const actor = proposing ? choiceActor(body, scope) : null;
      const plan = transaction(db, () => {
        // From "Review this choice": the draft must be that family choice's own, and the comparison unchanged since review.
        if (body.familyChoice !== undefined) {
          const goal = getGoal(db, scope.goalId);
          checkChoiceForSave(db, { ...choiceScope(scope, goal, progressFor(db, goal.id)), familyChoice: body.familyChoice, draftId: body.draftId, item });
        }
        saveGoalFromItem(db, { householdId: scope.householdId, goalId: scope.goalId, expectedGoalId: str(body.goalId), expectedGoalRevision: str(body.expectedGoalRevision), item, goal: body.goal }, clock);
        // Recomputed from the saved goal and the server's records; refused (and the goal save undone) unless every figure
        // matches the schedule the adult reviewed.
        return proposing ? planner.proposeFamily({ householdId: scope.householdId, goalId: scope.goalId, actor, reserveCents: body.schedule.reserveCents,
          choiceId: body.familyChoice.choiceId, expected: { scheduleRevision: str(body.schedule.revision) ?? null } }) : null;
      });
      return { status: 'ok', ...(plan ? { plan } : {}), state: state(scope) };
    }],
    ...['refresh', 'alternatives'].map((action) => ['POST', `/api/merchant/${action}`, async ({ body, scope }) => {
      const goal = getActiveGoal(db, scope.householdId);
      const goalRevision = merchantGoalRevision(goal, progressFor(db, goal.id).startingCents);
      // References come from this server's saved goal or a short-lived shown result, never a caller's product/URL/price.
      if (body.goalId !== goal.id) throw new DomainError(409, 'goal_changed', 'The goal changed. Open the merchant again.');
      // In family mode a shown result is usable only by a household this server showed it to, checked before any provider call.
      if (family && body.saved !== true && !shownTo(body.referenceId, scope)) {
        throw new DomainError(410, 'merchant_draft_expired', 'That merchant result has expired. Search again for a fresh price before saving.');
      }
      const item = body.saved === true ? goalItemFor(db, goal) : shop.draft(str(body.referenceId));
      if (!item) throw new DomainError(404, 'merchant_item_missing', 'There is no saved item for this goal.');
      const found = action === 'refresh' ? await shop.refresh(item) : await shop.alternatives(item, body.budgetCents ?? null);
      if (family) rememberDrafts(found, scope);
      return { ...found, goalId: goal.id, goalRevision };
    }]),
    // ---- Family choices: a shared shortlist, each adult's own weekly offer and each member's own preference. Planning
    // only: no route here moves, approves or reserves money, changes the goal or the ledger, or searches by itself. ----
    ['POST', '/api/family-choices', ({ body, scope }) => {
      refuseForeign(body, scope);
      // The item is this server's own copy of a result it showed this household, never product facts from the page.
      if (family && !shownTo(body.draftId, scope)) throw new DomainError(410, 'merchant_draft_expired', 'That merchant result has expired. Search again for a fresh price.');
      const item = shop.draft(str(body.draftId));
      const added = addChoice(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), expectedGoalId: str(body.expectedGoalId), item, draftId: body.draftId, replaceId: body.replaceId }, clock);
      return { ...added, state: state(scope) };
    }],
    ['POST', '/api/family-choices/remove', ({ body, scope }) => {
      refuseForeign(body, scope);
      removeChoice(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), choiceId: body.choiceId });
      return { status: 'ok', state: state(scope) };
    }],
    // The one provider call here: an explicit price check for a choice, through the merchant's existing bounded refresh.
    ['POST', '/api/family-choices/refresh', async ({ body, scope, assertAccess }) => {
      refuseForeign(body, scope);
      const result = await refreshChoice(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), choiceId: body.choiceId,
        refresh: async (reference) => {
          const found = await shop.refresh(reference);
          assertAccess();
          if (family) rememberDrafts(found, scope);
          // The catalog facts stay on the server; the choice's need is checked against them here.
          return { ...found, results: found.results.map((r) => ({ ...r, catalog: catalogOf(r.referenceId) })) };
        } });
      return { ...result, state: state(scope) };
    }],
    // Read-only: re-checks the reviewed comparison against the server's records and returns a goal draft. Saves nothing.
    ['POST', '/api/family-choices/review', ({ body, scope }) => {
      refuseForeign(body, scope);
      const goal = getGoal(db, scope.goalId);
      return reviewChoice(db, { ...choiceScope(scope, goal, progressFor(db, goal.id)), actor: choiceActor(body, scope), choiceId: body.choiceId, revision: body.revision, reserveCents: body.reserveCents,
        draftFor: (draftId) => { if (family && !shownTo(draftId, scope)) throw new DomainError(410, 'merchant_draft_expired', 'Expired.'); return shop.draft(draftId); } });
    }],
    // ---- Family fit: the kind of item and its must-haves come from the catalog's own lists, one explicit look-up at a time.
    // Read-only: nothing is saved, and only the family's words, public taxonomy values and a price ceiling go to Channel3. ----
    ['POST', '/api/merchant/categories', async ({ body, assertAccess }) => {
      const found = await shop.findCategories({ query: body.query });
      assertAccess();
      return found;
    }],
    ['POST', '/api/merchant/category', async ({ body, assertAccess }) => {
      const found = await shop.category(str(body.slug));
      assertAccess();
      return found;
    }],
    // Up to three suitable options for the family's date. The server derives the price ceiling from its own goal, progress,
    // offers and date, plus the one-off amount the adult entered, and judges every inspected item itself. The same
    // family facts must still hold when Channel3 answers, or the options are not shown as current.
    ['POST', '/api/family-choices/fit', async ({ body, scope, assertAccess }) => {
      refuseForeign(body, scope);
      const actor = choiceActor(body, scope);
      if (actor.role !== 'adult') throw new DomainError(403, 'adult_required', 'Only an adult in the family can search for the family’s options.');
      const read = () => {
        const goal = getGoal(db, scope.goalId), progress = progressFor(db, goal.id);
        return { goal, progress, ...fitContext(db, { ...choiceScope(scope, goal, progress), reserveCents: body.reserveCents, revision: str(body.revision) ?? null, budgetCents: body.budgetCents ?? null }) };
      };
      const before = read();
      const need = shop.buildNeed({ category: body.category ?? null, mustHaves: body.mustHaves ?? [] });
      const goalRevision = merchantGoalRevision(before.goal, before.progress.startingCents);
      const found = await shop.fitSearch({ query: body.query, need, ceilingCents: before.ceiling.ceilingCents,
        context: { ceilingCents: before.ceiling.ceilingCents, targetDate: before.goal.targetDate, reserveCents: before.reserveCents, on: before.ceiling.today } });
      assertAccess();
      const after = read(); // refused (409) if the offers, goal, progress or day changed while Channel3 answered
      if (after.ceiling.ceilingCents !== before.ceiling.ceilingCents) throw new DomainError(409, 'choices_changed', 'The family’s figures changed while searching. Search again with the latest figures.');
      if (family) rememberDrafts(found, scope);
      const finish = (cents) => fitFinish({ goal: after.goal, progress: after.progress, today: after.ceiling.today, offers: after.view.offers, reserveCents: after.reserveCents }, cents);
      const { outcome, today, offeredCents, reservedByDateCents, ...ceiling } = after.ceiling;
      return { ...found, goalId: after.goal.id, goalRevision, ceiling, results: found.results.map((r) => ({ ...r, ...finish(r.priceCents) })) };
    }],
    ['PUT', '/api/family-choices/offer', ({ body, scope }) => {
      refuseForeign(body, scope);
      saveOffer(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), weeklyCents: body.weeklyCents }, clock);
      return { status: 'ok', state: state(scope) };
    }],
    ['POST', '/api/family-choices/offer/withdraw', ({ body, scope }) => {
      refuseForeign(body, scope);
      const result = withdrawOffer(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope) });
      return { ...result, state: state(scope) };
    }],
    ['PUT', '/api/family-choices/preference', ({ body, scope }) => {
      refuseForeign(body, scope);
      setPreference(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope), choiceId: body.choiceId }, clock);
      return { status: 'ok', state: state(scope) };
    }],
    ['POST', '/api/family-choices/preference/remove', ({ body, scope }) => {
      refuseForeign(body, scope);
      const result = removePreference(db, { householdId: scope.householdId, goalId: scope.goalId, actor: choiceActor(body, scope) });
      return { ...result, state: state(scope) };
    }],
    // ---- Treasury: read-only. The AG Studio licence (if configured) is the only setting the page may read here. ----
    ['GET', '/api/treasury/studio', () => ({ licenseKey: config.studio?.licenseKey ?? null })],
    ['POST', '/api/steward', async ({ body, scope, assertAccess }) => (family ? stewardFor(scope.householdId) : steward)
      .ask({ question: body.question, memberId: actingMember(body.memberId, scope), focusOrderId: str(body.focusOrderId), assertAccess })],
    ['POST', '/api/entries', ({ body, scope }) => {
      const result = addSelfReportedEntry(db, { householdId: scope.householdId, goalId: scope.goalId, kind: body.kind, amountCents: body.amountCents, label: body.label, memberId: actingMember(body.memberId, scope) }, clock);
      return { ...result, state: state(scope) };
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
    ['POST', '/api/paypal/orders', async ({ body, scope }) => {
      const created = await contributions.createPayPalOrder(contributionInput(body, scope));
      return { orderId: created.orderId, approveUrl: created.approveUrl, contribution: created.contribution };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/capture$/, async ({ body, params, scope, assertAccess }) => {
      const result = await contributions.capturePayPalOrder({ providerOrderId: params[0], ...owner(body, scope), assertAccess });
      return { ...result, state: state(scope) };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/refresh$/, async ({ body, params, scope }) => {
      const result = await contributions.refreshPayPalOrder({ providerOrderId: params[0], ...owner(body, scope) });
      return { ...result, state: state(scope) };
    }],
    ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/cancel$/, ({ body, params, scope }) => {
      const result = contributions.cancelPayPalOrder({ providerOrderId: params[0], ...owner(body, scope) });
      return { ...result, state: state(scope) };
    }],
    ['POST', /^\/api\/paypal\/captures\/([\w-]+)\/refund$/, async ({ body, params, scope, assertAccess }) => {
      const result = await contributions.refundPayPalCapture({ captureId: params[0], householdId: owner(body, scope).householdId, approverId: actingMember(body.approverId, scope), approvalConfirmed: body.approvalConfirmed, assertAccess });
      return { ...result, state: state(scope) };
    }],
    ['POST', '/api/paypal/webhook', async ({ req, rawBody }) => {
      // PayPal's signed events name orders, not households: compare each household's payment records before and after,
      // so only the households whose records changed are told to re-read them.
      const before = family ? paymentFingerprints() : null;
      try { return await contributions.handleWebhook({ headers: req.headers, rawBody }); }
      finally { if (family) for (const [householdId, print] of paymentFingerprints()) if (before.get(householdId) !== print) live.notify(householdId); }
    }],

    // ---- Example mode (explicitly simulated) ----
    ['POST', '/api/example/contributions', ({ body, scope }) => {
      const result = contributions.simulateContribution({ ...contributionInput(body, scope), outcome: str(body.outcome) ?? 'completed' });
      return { ...result, state: state(scope) };
    }],
    ['POST', /^\/api\/example\/contributions\/([\w-]+)\/complete$/, ({ body, params, scope }) => {
      const result = contributions.completeSimulatedPending({ contributionId: params[0], householdId: owner(body, scope).householdId });
      return { ...result, state: state(scope) };
    }],
    ['POST', /^\/api\/example\/captures\/([\w-]+)\/refund$/, ({ body, params, scope }) => {
      const result = contributions.simulateRefund({ captureId: params[0], householdId: owner(body, scope).householdId, approverId: actingMember(body.approverId, scope), approvalConfirmed: body.approvalConfirmed });
      return { ...result, state: state(scope) };
    }],
    ['POST', '/api/demo/reset', ({ scope }) => {
      // Reset erases every household in its database, so it exists only for the example household.
      if (family || config.payments.mode !== 'example') throw new DomainError(403, 'reset_disabled', 'Reset is only available in example mode, so sandbox records are kept.');
      resetHousehold(db, clock);
      return { state: state(scope) };
    }],

    // ---- Family access (family mode only): passkey ceremonies, sign-out, invitations and access ----
    ['POST', '/api/auth/family/options', ({ req, res, body }) => familyOnly().familyOptions(req, res, body)],
    ['POST', '/api/auth/family/verify', ({ req, res, body }) => familyOnly().familyVerify(req, res, body)],
    ['POST', '/api/auth/signin/options', ({ req, res }) => familyOnly().signInOptions(req, res)],
    ['POST', '/api/auth/signin/verify', ({ req, res, body }) => familyOnly().signInVerify(req, res, body)],
    ['POST', '/api/auth/invitation', ({ req, body }) => familyOnly().invitationPreview(req, body)],
    ['POST', '/api/auth/invitation/options', ({ req, res, body }) => familyOnly().invitationOptions(req, res, body)],
    ['POST', '/api/auth/invitation/verify', ({ req, res, body }) => familyOnly().invitationVerify(req, res, body)],
    ['POST', '/api/auth/signout', ({ res, scope }) => familyOnly().signOut(res, scope)],
    ['POST', '/api/auth/passkeys/options', ({ req, scope }) => familyOnly().passkeyOptions(req, scope)],
    ['POST', '/api/auth/passkeys/verify', ({ req, scope, body, assertAccess }) => familyOnly().passkeyVerify(req, scope, body, assertAccess)],
    ['POST', '/api/family/invitations', ({ req, body, scope }) => ({ ...familyOnly().createInvitation(req, scope, body), state: state(scope) })],
    ['POST', /^\/api\/family\/invitations\/([\w-]+)\/revoke$/, ({ params, scope }) => ({ ...familyOnly().revokeInvitation(scope, params[0]), state: state(scope) })],
    ['POST', /^\/api\/family\/members\/([\w-]+)\/revoke$/, ({ params, scope }) => ({ ...familyOnly().revokeMember(scope, params[0]), state: state(scope) })],
  ];

  // In family mode the household, goal and acting member come from the session. A request that names another household,
  // goal, approver or member is refused before any service or provider work; omitted ids take the session's own.
  function owner(body, scope) {
    if (!family) return { householdId: str(body.householdId), goalId: str(body.goalId) };
    if ((body.householdId !== undefined && body.householdId !== scope.householdId) || (body.goalId !== undefined && body.goalId !== scope.goalId)) {
      throw new HttpError(403, 'scope_mismatch', 'That record belongs to another household or goal.');
    }
    return { householdId: scope.householdId, goalId: scope.goalId };
  }
  function actingMember(value, scope) {
    if (!family) return str(value);
    if (value !== undefined && value !== scope.memberId) throw new HttpError(403, 'member_mismatch', 'Only the signed-in family member can act as themselves.');
    return scope.memberId;
  }
  // Family choices act for exactly one member: the session's own in family mode, the chosen example persona otherwise.
  function choiceActor(body, scope) {
    const member = getMember(db, scope.householdId, actingMember(body.memberId, scope));
    if (!member) throw new DomainError(400, 'invalid_member', 'Choose who is taking part.');
    return { memberId: member.id, role: member.role };
  }
  // A family request naming another household or goal is refused before any work (example mode has only one).
  function refuseForeign(body, scope) { if (family) owner(body, scope); }
  const choiceScope = (scope, goal, progress) => ({ householdId: scope.householdId, goal, progress, today: clock.today(), now: clock.now().getTime(), family });
  function contributionInput(body, scope) {
    return {
      ...owner(body, scope),
      amountCents: body.amountCents,
      approverId: actingMember(body.approverId, scope),
      approvalConfirmed: body.approvalConfirmed,
      requestId: str(body.requestId),
    };
  }
  // The catalog facts the server kept for a result it showed (for a family need), or null once it expired.
  const catalogOf = (referenceId) => { try { return shop.draft(referenceId).catalog ?? null; } catch { return null; } };
  // A shown result's ids (its draft and its refresh/similar reference) are usable only by households it was shown to.
  const shownTo = (id, scope) => typeof id === 'string' && Boolean(draftHouseholds.get(id)?.households.has(scope.householdId));
  function rememberDrafts(found, scope) {
    const at = clock.now().getTime();
    for (const row of found?.results ?? []) for (const id of new Set([row?.draftId, row?.referenceId])) {
      if (typeof id !== 'string') continue;
      const entry = draftHouseholds.get(id) ?? { at, households: new Set() };
      entry.households.add(scope.householdId); draftHouseholds.set(id, entry);
    }
    if (draftHouseholds.size > 2000) for (const [id, e] of draftHouseholds) if (at - e.at > 3_600_000) draftHouseholds.delete(id);
  }

  // Optimistic concurrency for goal edits: the revision of the goal the family's form was showing. In family mode it is
  // required, so another member's newer goal is never silently overwritten; elsewhere it is checked whenever it is sent.
  function checkGoalRevision(expected, scope) {
    if (expected === undefined && !family) return;
    const goal = getGoal(db, scope.goalId);
    if (expected !== merchantGoalRevision(goal, progressFor(db, goal.id).startingCents)) {
      throw new DomainError(409, 'goal_changed', 'Someone saved a newer goal. Load the latest goal, then save your change again.');
    }
  }

  function applyGoalIfChanged(input, scope, expectedRevision) {
    const current = getGoal(db, scope.goalId);
    const starting = progressFor(db, current.id).startingCents;
    const changed = input.name !== current.name || input.targetCents !== current.targetCents || input.targetDate !== current.targetDate
      || input.weeklyBudgetCents !== current.weeklyBudgetCents || input.startingCents !== starting;
    // The page sends projectKind only when the family changed the Build choice. With figures, it is saved by the same
    // validated edit (all or nothing); alone, it changes only the picture and leaves every plan and figure as it is.
    if (changed) { checkGoalRevision(expectedRevision, scope); updateGoal(db, current.id, input, clock); }
    else if (input.projectKind !== undefined && input.projectKind !== current.projectKind) updateGoalProject(db, current.id, input.projectKind);
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

  // Family mode answers only at the configured origin: the exact host, and the exact Origin on every browser write.
  function checkFamilyHostAndOrigin(req, { write }) {
    if (req.headers.host !== config.access.host) throw new HttpError(403, 'host_not_allowed', `Open Our Castle at ${config.access.origin}.`);
    if (!write) return;
    if (req.headers.origin !== config.access.origin) throw new HttpError(403, 'origin_not_allowed', 'Cross-site requests are not allowed.');
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
      throw new HttpError(403, 'origin_not_allowed', 'Cross-site requests are not allowed.');
    }
  }

  /**
   * Family mode: the central policy decides, before any route or service runs. Unlisted routes are refused; every
   * non-public route needs a live session whose membership is still active, writes need the session's CSRF token, and
   * the household, goal and member come only from that session.
   */
  function authorize(req, res, url, write, { activity = true, clearCookie = true } = {}) {
    const rule = policyFor(req.method, url.pathname);
    if (!rule) throw new HttpError(403, 'route_not_permitted', 'This action is not available.');
    if (rule.access === 'deny') throw new HttpError(403, 'not_available', 'This is not available for shared families.');
    if (rule.access === 'machine') return { session: null, scope: null };
    // A live-update stream and the page's background re-reads are not activity: they never keep an idle session alive.
    const background = url.pathname === '/api/events' || req.headers['x-our-castle-refresh'] === 'background';
    const { session, reason } = access.readSession(req, { activity: activity && !background });
    if (rule.access === 'public') return { session, scope: null };
    if (!session) {
      if (clearCookie && reason !== 'none') access.clearSessionCookie(res);
      throw reason === 'none'
        ? new HttpError(401, 'session_required', 'Sign in with your passkey to continue.')
        : new HttpError(401, 'session_expired', 'Your session ended. Sign in again with your passkey.');
    }
    if (write && !access.csrfOk(req, session)) throw new HttpError(403, 'csrf_failed', 'This request could not be confirmed. Reload the page and try again.');
    const scope = access.scopeOf(session);
    if (rule.access === 'adult' && scope.role !== 'adult') throw new HttpError(403, 'adult_required', 'Only an adult in the family can do this.');
    if (rule.access === 'owner' && !scope.owner) throw new HttpError(403, 'owner_required', 'Only the family owner can do this.');
    if (rule.access === 'self' && rule.params[0] !== scope.memberId) throw new HttpError(403, 'self_only', 'Members change only their own avatar.');
    return { session, scope };
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let diagnosticRoute = 'unmatched';
    try {
      if (!url.pathname.startsWith('/api/')) {
        diagnosticRoute = 'static';
        if (family && req.headers.host !== config.access.host && ['GET', 'HEAD'].includes(req.method)) {
          // Passkeys belong to one origin; send any other local address to it instead of serving a page that cannot sign in.
          checkHostAndOrigin(req, { write: false });
          res.writeHead(302, { Location: `${config.access.origin}${url.pathname}` });
          return res.end();
        }
        if (family) checkFamilyHostAndOrigin(req, { write: false }); else checkHostAndOrigin(req, { write: false });
        if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        return await serveStatic(req, res, url.pathname);
      }
      const write = req.method !== 'GET';
      const webhook = url.pathname === '/api/paypal/webhook';
      if (webhook) {
        // PayPal calls this from the internet (through a tunnel); it is authenticated by signature, not origin.
      } else if (family) checkFamilyHostAndOrigin(req, { write });
      else checkHostAndOrigin(req, { write });
      let match = null;
      const route = routes.find(([method, pattern]) => {
        if (method !== req.method) return false;
        if (typeof pattern === 'string') return pattern === url.pathname;
        match = pattern.exec(url.pathname);
        return Boolean(match);
      });
      if (!route) throw new HttpError(404, 'not_found', 'Unknown API route.');
      diagnosticRoute = typeof route[1] === 'string' ? route[1] : route[1].source;
      let { session, scope } = family ? authorize(req, res, url, write) : { session: null, scope: exampleScope() };
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
      // Reading a body yields: membership/session may have ended before the action has even begun. Rechecks are not
      // activity and never clear cookies: a response from an old request must not erase a newer passkey sign-in.
      if (family && write) ({ session, scope } = authorize(req, res, url, write, { activity: false, clearCookie: false }));
      const assertAccess = () => {
        if (!family || !scope) return;
        const current = authorize(req, res, url, write, { activity: false, clearCookie: false }).scope;
        if (!current || ['sessionId', 'householdId', 'memberId', 'accountId', 'goalId'].some(key => current[key] !== scope[key]))
          throw new HttpError(409, 'scope_changed', 'Your family or goal changed. Reload and try again.');
      };
      // Sign-out deliberately ends this request's own session. Other private results (including route errors) need
      // access at response time as well: a provider wait is not permission to return household data after revocation.
      const assertResponseAccess = () => {
        if (req.method !== 'POST' || url.pathname !== '/api/auth/signout') assertAccess();
      };
      // Any authorized write (even one that ends in an error after recording a status) may change this household: its
      // revision moves before the write runs and again after it, when its open pages are told to re-read their state.
      // Reads, calculations and provider look-ups change nothing and move nothing.
      const changes = family && write && scope && !UNCHANGING_WRITES.has(url.pathname);
      if (changes) live.touch(scope.householdId);
      let result;
      try { result = await route[2]({ req, res, body, rawBody, params: match ? match.slice(1) : [], session, scope, assertAccess }); }
      catch (error) { assertResponseAccess(); throw error; }
      finally { if (changes) live.notify(scope.householdId); }
      if (result === STREAMING) return;
      // Financial services finish recording an already-dispatched capture/refund before this guard: provider truth
      // must survive lost access even though the requester can no longer receive its receipt or family state.
      assertResponseAccess();
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof DomainError || error instanceof HttpError || error instanceof PlanInputError) {
        // PayPal's debug id is what its support and the AI Toolkit's explain-error need; keep it in the server log too.
        if (error.debugId) console.warn(`[our-castle] ${error.code} (PayPal debug id ${error.debugId})`);
        return sendJson(res, error.status, { error: { code: error.code, message: error.message, issues: error.issues, debugId: error.debugId } });
      }
      // An unexpected failure may happen after a transaction commits. Its HTTP status cannot determine payment truth.
      // Correlate the response without forwarding arbitrary error objects, request URLs, bodies, headers or private ids.
      const requestId = randomUUID();
      const method = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
      console.error('[our-castle] unexpected error', { code: 'server_error', method, requestId, route: diagnosticRoute });
      res.setHeader('X-Request-Id', requestId);
      sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong. Check the latest records before trying again.', requestId } });
    }
  }

  // Family mode refuses unlisted routes at request time; say so at start-up too, so a new route is never silently open.
  if (family) for (const [method, pattern] of routes) {
    const sample = typeof pattern === 'string' ? pattern : pattern.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace(/\(\[\\w-\]\+\)/g, 'x');
    if (!policyFor(method, sample)) console.warn(`[our-castle] family access: ${method} ${sample} has no access rule and is refused`);
  }

  // Each household's latest ledger entry and payment-order change: enough to tell which households a webhook touched.
  function paymentFingerprints() {
    return new Map(db.prepare(`SELECT h.id AS id,
      (SELECT COALESCE(MAX(l.id), 0) FROM ledger_entries l WHERE l.household_id = h.id) || ':' ||
      (SELECT COALESCE(MAX(o.updated_at), '') || COUNT(*) FROM payment_orders o WHERE o.household_id = h.id) AS print
      FROM households h`).all().map((r) => [r.id, r.print]));
  }

  return { handler, planner, contributions, steward, merchant: shop, state, live, routes: routes.map(([method, pattern]) => ({ method, pattern })) };
}
