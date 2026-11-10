// A local assistant gets only a short-lived, adult-issued view of one fund. These capabilities are independent of
// browser session cookies, never persisted, and recheck the original session and village membership on every read.
import { createHash, randomBytes } from 'node:crypto';

export const MCP_VIEWS = Object.freeze(['status', 'contributions', 'review-link']);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const RAILS = Object.freeze({
  simulated: { currency: 'USD', decimals: 2, label: 'Simulated example contributions; no money moved' },
  'paypal-sandbox': { currency: 'USD', decimals: 2, label: 'PayPal sandbox payments; no real money' },
  'pyusd-devnet': { currency: 'PYUSD', decimals: 6, label: 'PYUSD devnet test tokens; no monetary value' },
});
const hash = (token) => createHash('sha256').update(token).digest('hex');
const samePerson = (a, b) => a?.mode === 'family' && a.role === 'adult' && b?.mode === 'family' && b.role === 'adult'
  && ['sessionId', 'householdId', 'memberId'].every((key) => typeof a[key] === 'string' && a[key] && a[key] === b[key]);
const text = (value, length = 160) => typeof value === 'string' ? value.slice(0, length) : null;
const minor = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export class McpAccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const denied = () => new McpAccessError(401, 'mcp_grant_unavailable', 'This assistant connection ended. An adult can connect it again in Our Castle.');
const unavailable = () => new McpAccessError(404, 'mcp_fund_unavailable', 'This fund is not available to this assistant connection.');

/** The projection is deliberately rebuilt rather than spreading an authorized DTO into an assistant's context. */
export function projectMcpFund(fund, view) {
  if (!fund || !ID.test(fund.id ?? '') || !Object.hasOwn(RAILS, fund.rail)) throw unavailable();
  const rail = RAILS[fund.rail];
  if (fund.currency !== rail.currency || fund.decimals !== rail.decimals) throw unavailable();
  const core = {
    id: fund.id, title: text(fund.title), rail: fund.rail, currency: rail.currency, decimals: rail.decimals,
    label: rail.label, status: text(fund.status, 40), revision: minor(fund.revision),
  };
  if (view === 'review-link') return {
    fund: core, path: `/?villageFund=${encodeURIComponent(fund.id)}`,
    action: 'Open this fund in Our Castle. An adult must review and approve any payment in the browser.',
    createsPayment: false,
  };
  if (view === 'status') return {
    fund: { ...core, targetMinor: minor(fund.targetMinor), deadline: text(fund.deadline, 10), progress: {
      netMinor: minor(fund.progress?.netMinor), capturedMinor: minor(fund.progress?.capturedMinor),
      refundedMinor: minor(fund.progress?.refundedMinor), remainingMinor: minor(fund.progress?.remainingMinor),
      basisPoints: minor(fund.progress?.basisPoints), stage: typeof fund.progress?.stage === 'number'
        ? minor(fund.progress.stage) : text(fund.progress?.stage, 40),
    } },
    basis: 'Saved fund records only. This read does not contact PayPal or a blockchain.',
  };
  if (view !== 'contributions') throw new McpAccessError(400, 'mcp_view_invalid', 'Choose a supported assistant view.');
  const shares = Array.isArray(fund.shares) ? fund.shares : [], receipts = Array.isArray(fund.receipts) ? fund.receipts : [];
  return {
    fund: core,
    shares: shares.slice(0, 100).map((share) => ({
      familyReference: text(share.familyReference, 100), alias: text(share.alias, 80),
      committedMinor: minor(share.committedMinor), paidMinor: minor(share.paidMinor),
    })),
    receipts: receipts.slice(0, 100).map((receipt) => ({
      reference: text(receipt.reference, 100), kind: text(receipt.kind, 40), amountMinor: minor(receipt.amountMinor),
      familyReference: text(receipt.familyReference, 100), alias: text(receipt.alias, 80), at: text(receipt.at, 40),
    })),
    totalShares: shares.length, totalReceipts: receipts.length,
    truncated: shares.length > 100 || receipts.length > 100,
    basis: 'Commitments are promises, not payments or debts. Receipts describe saved fund events; no provider is queried.',
  };
}

export function createMcpCapabilities({ resolveSessionScope, readFund, readFundNow = readFund, now = Date.now, ttlMs = 900_000,
  maxGrants = 128, perSession = 4 } = {}) {
  if (typeof resolveSessionScope !== 'function' || typeof readFund !== 'function' || typeof readFundNow !== 'function') throw new TypeError('Assistant access needs session and fund readers.');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 900_000 || !Number.isSafeInteger(maxGrants) || maxGrants < 1 || maxGrants > 1024
    || !Number.isSafeInteger(perSession) || perSession < 1 || perSession > maxGrants) throw new TypeError('Invalid assistant connection limits.');
  const grants = new Map();
  let closed = false;
  const sweep = () => { const at = now(); for (const [key, grant] of grants) if (grant.expiresAt <= at) grants.delete(key); };
  async function current(scope) {
    if (closed || !scope?.sessionId) throw denied();
    let fresh;
    try { fresh = await resolveSessionScope(scope.sessionId); } catch { throw denied(); }
    if (!samePerson(fresh, scope)) throw denied();
    return fresh;
  }
  async function fundFor(scope, fundId) {
    let fund;
    try { fund = await readFund(scope, fundId); } catch { throw unavailable(); }
    if (fund?.id !== fundId) throw unavailable();
    return fund;
  }
  function finalFund(scope, fundId) {
    let fund;
    try { fund = readFundNow(scope, fundId); } catch { throw unavailable(); }
    // The SQLite-backed app reader is synchronous. An async adapter must supply a separate synchronous authoritative
    // reader: no await may reopen a membership-revocation window between this final check and producing the response.
    if (fund && typeof fund.then === 'function') {
      Promise.resolve(fund).catch(() => {});
      throw unavailable();
    }
    if (fund?.id !== fundId) throw unavailable();
    return fund;
  }
  return {
    async issue(scope, { fundId } = {}) {
      if (!ID.test(fundId ?? '')) throw new McpAccessError(400, 'mcp_fund_invalid', 'Choose a fund to connect.');
      const fresh = await current(scope);
      projectMcpFund(await fundFor(fresh, fundId), 'status');
      // Revalidate after async work: a slow read may overlap sign-out or a restart/close.
      const finalScope = await current(fresh);
      projectMcpFund(finalFund(finalScope, fundId), 'status');
      sweep();
      if (grants.size >= maxGrants || [...grants.values()].filter((g) => g.scope.sessionId === fresh.sessionId).length >= perSession) {
        throw new McpAccessError(429, 'mcp_grants_full', 'Disconnect an assistant connection before making another.');
      }
      const token = randomBytes(32).toString('base64url'), id = `mcp_${randomBytes(16).toString('hex')}`, expiresAt = now() + ttlMs;
      const bound = Object.freeze({ mode: 'family', role: 'adult', sessionId: fresh.sessionId, householdId: fresh.householdId, memberId: fresh.memberId });
      grants.set(hash(token), { id, scope: bound, fundId, expiresAt });
      return { grantId: id, token, fundId, expiresAt: new Date(expiresAt).toISOString() };
    },
    async read(token, view) {
      if (!MCP_VIEWS.includes(view)) throw new McpAccessError(400, 'mcp_view_invalid', 'Choose a supported assistant view.');
      sweep();
      if (closed || typeof token !== 'string' || !TOKEN.test(token)) throw denied();
      const key = hash(token), grant = grants.get(key);
      if (!grant) throw denied();
      let fresh;
      try { fresh = await current(grant.scope); } catch { grants.delete(key); throw denied(); }
      await fundFor(fresh, grant.fundId);
      // Never let an in-flight read return after expiry, revocation, sign-out or service shutdown.
      const finalScope = await current(grant.scope);
      if (grants.get(key) !== grant || grant.expiresAt <= now()) { grants.delete(key); throw denied(); }
      return projectMcpFund(finalFund(finalScope, grant.fundId), view);
    },
    async revoke(scope, { grantId } = {}) {
      const fresh = await current(scope);
      for (const [key, grant] of grants) if (grant.id === grantId && samePerson(grant.scope, fresh)) grants.delete(key);
      return { revoked: true }; // Do not reveal whether another adult's grant exists.
    },
    stats() { sweep(); return { grants: grants.size, closed }; },
    close() { closed = true; grants.clear(); },
  };
}
