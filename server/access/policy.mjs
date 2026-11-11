// Who may call each API route in family access mode. Every route the server answers must appear here; a route without a
// rule is refused (fail closed), and test/unit/family-access-policy.test.mjs checks that the two lists agree. Example mode
// (the single local example household) does not use this table.
//
//   public  — no session needed: status, the session read-out and passkey ceremonies (which bind their own challenges)
//   machine — PayPal's signed webhook: authenticated by signature, never by a browser session
//   member  — any signed-in member of the household, child or adult (read-only views and calculations)
//   self    — a signed-in member acting on their own member record only (their avatar)
//   adult   — a signed-in adult: goal and plan changes, provider work, payments and their records
//   owner   — the family's owner: house settings, invitations and access
//   deny    — never in family mode (for example the reset that erases every household)
export const ROUTE_POLICIES = Object.freeze([
  ['GET', '/api/status', 'public'],
  ['GET', '/api/session', 'public'],
  ['GET', '/api/events', 'member'],
  ['POST', '/api/auth/family/options', 'public'],
  ['POST', '/api/auth/family/verify', 'public'],
  ['POST', '/api/auth/signin/options', 'public'],
  ['POST', '/api/auth/signin/verify', 'public'],
  ['POST', '/api/auth/invitation', 'public'],
  ['POST', '/api/auth/invitation/options', 'public'],
  ['POST', '/api/auth/invitation/verify', 'public'],
  ['POST', '/api/auth/signout', 'member'],
  ['POST', '/api/auth/passkeys/options', 'member'],
  ['POST', '/api/auth/passkeys/verify', 'member'],
  ['GET', '/api/state', 'member'],
  ['GET', '/api/village', 'member'],
  ['GET', /^\/api\/village\/funds\/([\w-]+)$/, 'member'],
  ['GET', /^\/api\/village\/review\/([\w-]+)$/, 'member'],
  ['GET', /^\/api\/village\/public\/([\w-]+)$/, 'public'],
  ['GET', '/api/village/qr', 'member'],
  ['GET', '/api/village/presence', 'member'],
  ['POST', '/api/village/presence', 'member'],
  ['POST', '/api/village', 'adult'],
  ['POST', '/api/village/payments', 'adult'],
  ['GET', '/api/village/payments', 'adult'],
  ['POST', '/api/village/payments/resume', 'adult'],
  ['POST', '/api/village/payments/capture', 'adult'],
  ['POST', '/api/village/payments/check', 'adult'],
  ['POST', '/api/village/vault/enroll', 'adult'],
  ['POST', '/api/village/vault/refresh', 'adult'],
  ['POST', '/api/village/draft', 'adult'],
  ['POST', '/api/village/draft/accept', 'adult'],
  ['POST', '/api/village/treasurer', 'adult'],
  ['POST', '/api/village/subscriptions/propose', 'adult'],
  ['GET', /^\/api\/village\/subscriptions\/([\w-]+)$/, 'adult'],
  ['POST', '/api/village/subscriptions/approve', 'adult'],
  ['POST', '/api/village/subscriptions/check', 'adult'],
  ['POST', '/api/village/subscriptions/revoke', 'adult'],
  ['POST', '/api/mcp/grants', 'adult'],
  ['POST', '/api/mcp/grants/revoke', 'adult'],
  // This one read authenticates its own short-lived, session-bound bearer capability. It has no payment authority.
  ['GET', '/api/mcp/fund', 'machine'],
  ['POST', '/api/plans/preview', 'member'],
  ['GET', '/api/treasury/studio', 'member'],
  ['PUT', /^\/api\/members\/([\w-]+)\/avatar$/, 'self'],
  ['POST', '/api/setup', 'owner'],
  ['PUT', '/api/house', 'owner'],
  ['POST', '/api/family/invitations', 'owner'],
  ['POST', /^\/api\/family\/invitations\/([\w-]+)\/revoke$/, 'owner'],
  ['POST', /^\/api\/family\/members\/([\w-]+)\/revoke$/, 'owner'],
  ['PUT', '/api/goal', 'adult'],
  ['POST', '/api/plans', 'adult'],
  ['POST', '/api/plans/rules', 'adult'],
  ['POST', '/api/plans/family', 'adult'],
  ['PUT', /^\/api\/plans\/([\w-]+)$/, 'adult'],
  ['POST', /^\/api\/plans\/([\w-]+)\/accept$/, 'adult'],
  ['POST', '/api/merchant/search', 'adult'],
  ['POST', '/api/merchant/goal', 'adult'],
  ['POST', '/api/merchant/refresh', 'adult'],
  ['POST', '/api/merchant/alternatives', 'adult'],
  ['POST', '/api/merchant/categories', 'adult'],
  ['POST', '/api/merchant/category', 'adult'],
  // Family choices. Adults change the shortlist, check prices, review a choice and save or withdraw their OWN weekly offer;
  // any member, child or adult, sets or removes their OWN preference. The acting member always comes from the session.
  ['POST', '/api/family-choices', 'adult'],
  ['POST', '/api/family-choices/remove', 'adult'],
  ['POST', '/api/family-choices/refresh', 'adult'],
  ['POST', '/api/family-choices/review', 'adult'],
  ['POST', '/api/family-choices/fit', 'adult'],
  ['PUT', '/api/family-choices/offer', 'adult'],
  ['POST', '/api/family-choices/offer/withdraw', 'adult'],
  ['PUT', '/api/family-choices/preference', 'member'],
  ['POST', '/api/family-choices/preference/remove', 'member'],
  // Kit list: adults read a photo (no record changes) and save the list; every member reads the saved list in the state.
  ['POST', '/api/exchange', 'adult'],
  ['GET', '/api/exchange/requests', 'member'],
  ['GET', /^\/api\/exchange\/requests\/([\w-]+)$/, 'member'],
  ['POST', '/api/kit/read', 'adult'],
  ['PUT', '/api/kit', 'adult'],
  ['POST', '/api/kit/listings', 'adult'],
  ['POST', '/api/kit/listings/remove', 'adult'],
  ['POST', '/api/kit/listings/refresh', 'adult'],
  ['POST', '/api/kit/compare', 'adult'],
  ['POST', '/api/kit/prefer', 'adult'],
  ['PUT', '/api/kit/choice', 'adult'],
  ['PUT', '/api/kit/keep', 'adult'],
  ['POST', '/api/kit/review', 'adult'],
  ['POST', '/api/kit/adopt', 'adult'],
  ['POST', '/api/steward', 'adult'],
  ['POST', '/api/entries', 'adult'],
  ['GET', '/api/paypal/config', 'adult'],
  ['POST', '/api/paypal/client-token', 'adult'],
  ['POST', '/api/paypal/orders', 'adult'],
  ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/capture$/, 'adult'],
  ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/refresh$/, 'adult'],
  ['POST', /^\/api\/paypal\/orders\/([\w-]+)\/cancel$/, 'adult'],
  ['POST', /^\/api\/paypal\/captures\/([\w-]+)\/refund$/, 'adult'],
  // A held contribution: only an adult releases an exact amount of it, returns it, or extends it.
  ['POST', /^\/api\/contributions\/([\w-]+)\/release$/, 'adult'],
  ['POST', /^\/api\/contributions\/([\w-]+)\/return$/, 'adult'],
  ['POST', /^\/api\/contributions\/([\w-]+)\/extend$/, 'adult'],
  ['POST', '/api/paypal/webhook', 'machine'],
  ['POST', '/api/example/contributions', 'adult'],
  ['POST', /^\/api\/example\/contributions\/([\w-]+)\/complete$/, 'adult'],
  ['POST', /^\/api\/example\/captures\/([\w-]+)\/refund$/, 'adult'],
  ['POST', '/api/demo/reset', 'deny'],
].map(([method, pattern, access]) => Object.freeze({ method, pattern, access })));

const ACCESS = new Set(['public', 'machine', 'member', 'self', 'adult', 'owner', 'deny']);
for (const p of ROUTE_POLICIES) if (!ACCESS.has(p.access)) throw new Error(`Unknown access level ${p.access}`);

/** The rule for one request, with any path parameters, or null (refuse). */
export function policyFor(method, pathname) {
  for (const p of ROUTE_POLICIES) {
    if (p.method !== method) continue;
    if (typeof p.pattern === 'string') { if (p.pattern === pathname) return { ...p, params: [] }; continue; }
    const m = p.pattern.exec(pathname);
    if (m) return { ...p, params: m.slice(1) };
  }
  return null;
}

/** The same identity the server's route table uses, for the enumeration check. */
export const routeKey = (method, pattern) => `${method} ${typeof pattern === 'string' ? pattern : pattern.source}`;
