import QRCode from 'qrcode';
import { DomainError, getMember, getMembers } from './household.mjs';
import { STREAMING } from './live.mjs';
import { villageView, villageFund, villageAction, villagePaymentContext, recordVillageReceipt, publicVillageFund, villageReview } from './village/index.mjs';
import { createVillagePayments } from './payments/village-payments.mjs';
import { createVaultWatcher } from './vault/index.mjs';
import { createVillageDraft, validateReviewedVillageDraft } from './planner/village-draft.mjs';
import { createVillageTreasurer } from './steward/village-treasurer.mjs';
import { createMcpCapabilities, McpAccessError } from './mcp/capabilities.mjs';
import { createVillagePresence } from './village-presence.mjs';
import { PlannerProviderError } from './planner/anthropic-provider.mjs';
import { createVillageSubscriptions } from './planner/village-subscriptions.mjs';

const fail = (status, code, message) => new DomainError(status, code, message);
const query = req => new URL(req.url, 'http://localhost').searchParams;

/** Composition only: the domain owns records, provider adapters own transport, and the app owns session/CSRF checks. */
export function createVillageHttp({ db, clock, config, available, state, actorFor, resolveSessionScope,
  notify = () => {}, paypal = null, vaultRpc = null, draftProvider = null, subscriptionAdapter = null }) {
  const family = config.access?.mode === 'family';
  const view = scope => available ? { ...villageView(db, scope), capabilities: {
    paypal: Boolean(paypal), devnet: Boolean(vaultRpc), draft: draftProvider ? 'ai' : 'rules', mcp: family,
    subscriptions: subscriptions.status(),
  } } : { available: false };
  const proposals = new Map(), requestTimes = new Map();
  const requireAvailable = () => { if (!available) throw fail(409, 'village_off', 'Open a shared family or the village-fund example.'); };
  function actorScope(body, scope) {
    requireAvailable();
    if (body.householdId !== undefined && body.householdId !== scope.householdId)
      throw fail(403, 'scope_mismatch', 'Choose your own family.');
    const actor = actorFor({ ...body, memberId: body.memberId ?? body.approverId }, scope);
    return { ...scope, memberId: actor.memberId, role: actor.role };
  }
  function readScope(req, scope) {
    requireAvailable();
    if (family) return scope;
    const memberId = query(req).get('memberId') || getMembers(db, scope.householdId)[0]?.id;
    return actorScope({ memberId }, scope);
  }
  function changed(ids) { notify([...new Set(ids ?? [])]); }
  const receipt = event => { const result = recordVillageReceipt(db, event, clock); changed(result.changedHouseholds); return result; };
  const contextFor = (scope, id, options) => villagePaymentContext(db, scope, id, options);
  const payments = createVillagePayments({ db, clock, paypal, contextFor, recordReceipt: receipt });
  const vault = createVaultWatcher({ db, clock, rpc: vaultRpc, contextFor, recordReceipt: receipt });
  const treasurer = createVillageTreasurer({ readAuthorizedFund: (scope, id) => villageFund(db, scope, id), clock });
  const subscriptions = createVillageSubscriptions({ db, clock, readAuthorizedFund: (scope, id) => villageFund(db, scope, id),
    adapter: subscriptionAdapter, capabilities: config.villageSubscriptions?.capabilities ?? null });
  const mcp = createMcpCapabilities({ resolveSessionScope, readFund: (scope, id) => villageFund(db, scope, id), now: () => clock.now().getTime() });
  const presence = createVillagePresence({ now: () => clock.now().getTime(), resolveParticipant(scope, id) {
    const current = family ? resolveSessionScope(scope.sessionId) : scope;
    if (!current || current.householdId !== scope.householdId || current.memberId !== scope.memberId)
      throw fail(403, 'village_presence_scope', 'This visit to the square ended.');
    villageFund(db, current, id);
    const own = villageView(db, current).members.find(m => m.mine), member = getMember(db, current.householdId, current.memberId);
    if (!own || !member) throw fail(403, 'village_presence_scope', 'Your family no longer belongs to this square.');
    return { familyReference: own.familyReference, alias: own.alias, avatarId: member.avatarId };
  } });
  function limited(scope, kind, limit = 8) {
    const at = clock.now().getTime(), key = `${scope.householdId}:${kind}`;
    for (const [k, times] of requestTimes) if (!times.some(t => at - t < 60_000)) requestTimes.delete(k);
    const times = (requestTimes.get(key) ?? []).filter(t => at - t < 60_000);
    if (times.length >= limit || (!requestTimes.has(key) && requestTimes.size >= 1000))
      throw fail(429, 'village_rate', 'Wait a moment before making another village request.');
    times.push(at); requestTimes.set(key, times);
  }
  const identity = scope => `${scope.sessionId ?? 'example'}:${scope.householdId}:${scope.memberId}`;
  function sweepDrafts() { const at = clock.now().getTime(); for (const [id, p] of proposals) if (p.until <= at) proposals.delete(id); }
  const result = (scope, extra = {}) => ({ ...extra, village: view(scope), state: state(scope) });
  function reviewOrigin(req) {
    const origin = family ? config.access.origin : `http://${req.headers.host}`;
    const u = new URL(origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.username || u.password || !(u.protocol === 'http:' && loopback || family && u.protocol === 'https:'))
      throw fail(400, 'village_link_origin', 'Use the configured family address to share this fund.');
    return u.origin;
  }
  function vaultAuthority(current, fundId, assertAccess) {
    return () => {
      assertAccess();
      if (!villageFund(db, current, fundId).canManage)
        throw fail(403, 'vault_organizer', 'The organizing family chooses when to watch its devnet address.');
    };
  }
  const routes = [
    ['GET', '/api/village', ({ scope }) => { requireAvailable(); return { village: view(scope) }; }],
    ['GET', /^\/api\/village\/funds\/([\w-]+)$/, ({ scope, params }) => { requireAvailable(); return { fund: villageFund(db, scope, params[0]) }; }],
    ['GET', /^\/api\/village\/review\/([\w-]+)$/, ({ req, scope, params }) => ({ fund: villageReview(db, readScope(req, scope), params[0]) })],
    ['GET', /^\/api\/village\/public\/([\w-]+)$/, ({ params }) => { requireAvailable(); return { fund: publicVillageFund(db, params[0]), localOnly: !family || config.access.origin.startsWith('http://localhost') }; }],
    ['POST', '/api/village', ({ body, scope }) => {
      const current = actorScope(body, scope), outcome = villageAction(db, { scope: current, actor: current, action: body.action, input: body }, clock);
      changed(outcome.changedHouseholds); return result(scope, outcome);
    }],
    ['GET', '/api/village/payments', ({ req, scope }) => ({ payments: payments.list({ scope: readScope(req, scope), fundId: query(req).get('fundId') }) })],
    ['POST', '/api/village/payments', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'payment', 12);
      const payment = await payments.create({ scope: current, fundId: body.fundId, amountMinor: body.amountMinor,
        approvalConfirmed: body.approvalConfirmed, requestId: body.requestId, expectedRevision: body.expectedRevision, assertAccess });
      return result(scope, { payment });
    }],
    ['POST', '/api/village/payments/resume', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'payment', 12);
      const payment = await payments.resume({ scope: current, orderId: body.orderId, assertAccess });
      return result(scope, { payment });
    }],
    ['POST', '/api/village/payments/capture', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'payment', 12);
      const payment = await payments.capture({ scope: current, orderId: body.orderId, assertAccess });
      return result(scope, { payment });
    }],
    ['POST', '/api/village/payments/check', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'check', 6);
      const payment = await payments.check({ scope: current, orderId: body.orderId, assertAccess });
      return result(scope, { payment });
    }],
    ['POST', '/api/village/vault/enroll', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'vault', 6);
      if (body.confirmed !== true) throw fail(400, 'vault_confirm', 'Confirm the devnet address before watching new deposits.');
      if (!vaultRpc) throw fail(503, 'vault_off', 'Devnet watching is not configured yet. No wallet or provider was contacted.');
      const guard = vaultAuthority(current, body.fundId, assertAccess);
      guard(); const observation = await vault.enroll({ scope: current, fundId: body.fundId, assertAccess: guard }); guard();
      return result(scope, { observation });
    }],
    ['POST', '/api/village/vault/refresh', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'vault', 6);
      if (!vaultRpc) throw fail(503, 'vault_off', 'Devnet watching is not configured yet. No wallet or provider was contacted.');
      const guard = vaultAuthority(current, body.fundId, assertAccess);
      guard(); const observation = await vault.scan({ scope: current, fundId: body.fundId, assertAccess: guard }); guard();
      return result(scope, { observation });
    }],
    ['GET', '/api/village/qr', async ({ req, res, scope, assertAccess }) => {
      requireAvailable(); const fund = villageFund(db, scope, query(req).get('fundId'));
      const link = `${reviewOrigin(req)}/?villageFund=${encodeURIComponent(fund.id)}`;
      const svg = await QRCode.toString(link, { type: 'svg', width: 224, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#102027', light: '#f4e6c1' } });
      assertAccess(); villageFund(db, scope, fund.id);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end(svg); return STREAMING;
    }],
    ['POST', '/api/village/draft', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'draft', 4);
      const before = villageView(db, current);
      const proposal = await createVillageDraft({ text: body.text, members: before.members, membershipRevision: before.membershipRevision,
        today: clock.today(), provider: draftProvider, assertAccess });
      if (villageView(db, current).membershipRevision !== before.membershipRevision)
        throw fail(409, 'village_changed', 'The neighborhood changed. Make a fresh proposal.');
      if (proposal.status === 'ready') {
        sweepDrafts();
        if (proposals.size >= 100) throw fail(429, 'village_drafts_full', 'Review an existing proposal before making another.');
        proposals.set(`${identity(current)}:${proposal.draft.revision}`, { scope: identity(current), draft: proposal.draft, until: clock.now().getTime() + 15 * 60_000 });
      }
      return proposal;
    }],
    ['POST', '/api/village/draft/accept', ({ body, scope }) => {
      const current = actorScope(body, scope); sweepDrafts();
      if (body.confirmed !== true) throw fail(400, 'village_confirm', 'Review the fund proposal before creating it.');
      const key = `${identity(current)}:${body.revision}`, stored = proposals.get(key), latest = villageView(db, current);
      const draft = validateReviewedVillageDraft({ storedDraft: stored?.draft, reviewedRevision: body.revision, members: latest.members,
        membershipRevision: latest.membershipRevision, today: clock.today(), actor: current });
      const outcome = villageAction(db, { scope: current, actor: current, action: 'create', input: { ...draft, projectKind: draft.project, confirmed: true } }, clock);
      proposals.delete(key); changed(outcome.changedHouseholds);
      return result(scope, { ...outcome, proposedShares: draft.proposedShares, proposedSchedule: draft.proposedSchedule, paymentScheduled: false });
    }],
    ['POST', '/api/village/treasurer', async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'treasurer', 12);
      const guard = () => { assertAccess(); villageFund(db, current, body.fundId); };
      return treasurer.ask({ scope: current, fundId: body.fundId, question: body.question, assertAccess: guard });
    }],
    ['POST', '/api/village/subscriptions/propose', ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'subscription', 6);
      return { subscription: subscriptions.propose({ scope: current, fundId: body.fundId, input: body, assertAccess }) };
    }],
    ['GET', /^\/api\/village\/subscriptions\/([\w-]+)$/, ({ req, scope, params, assertAccess }) =>
      ({ subscription: subscriptions.get({ scope: readScope(req, scope), proposalId: params[0], assertAccess }) })],
    ...['approve', 'check', 'revoke'].map(action => ['POST', `/api/village/subscriptions/${action}`, async ({ body, scope, assertAccess }) => {
      const current = actorScope(body, scope); limited(current, 'subscription', 6);
      return { subscription: await subscriptions[action]({ scope: current, proposalId: body.proposalId, reviewedRevision: body.reviewedRevision,
        approvalConfirmed: body.approvalConfirmed, requestId: body.requestId, assertAccess }) };
    }]),
    ['GET', '/api/village/presence', ({ req, scope }) => presence.read(readScope(req, scope), query(req).get('fundId'))],
    ['POST', '/api/village/presence', ({ body, scope }) => presence.change(actorScope(body, scope), body)],
    ['POST', '/api/mcp/grants', async ({ body, scope }) => {
      requireAvailable(); if (!family) throw fail(409, 'mcp_family_required', 'Connect an assistant after signing into a shared family.');
      return mcp.issue(scope, { fundId: body.fundId });
    }],
    ['POST', '/api/mcp/grants/revoke', async ({ body, scope }) => {
      requireAvailable(); if (!family) throw fail(409, 'mcp_family_required', 'Assistant connections belong to signed-in families.');
      return mcp.revoke(scope, { grantId: body.grantId });
    }],
    ['GET', '/api/mcp/fund', async ({ req }) => {
      requireAvailable(); if (!family) throw fail(401, 'mcp_family_required', 'A signed-in adult must create an assistant connection.');
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
        throw fail(401, 'mcp_grant_unavailable', 'A current assistant connection is required.');
      return mcp.read(authorization.slice(7), query(req).get('view'));
    }],
  ].map(([method, route, handler]) => [method, route, async context => {
    try { return await handler(context); } catch (error) {
      if (error instanceof McpAccessError) throw fail(error.status, error.code, error.message);
      if (error instanceof PlannerProviderError) throw fail(503, 'village_draft_provider', 'The optional draft provider is unavailable. Your fund has not changed.');
      throw error;
    }
  }]);
  return { routes, view, payments, vault,
    close() { presence.close(); mcp.close(); proposals.clear(); requestTimes.clear(); } };
}
