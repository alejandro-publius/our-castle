// Finding a purchase that fits the family:
// - the planning price ceiling for the goal's date;
// - whether one catalog item meets the must-haves the family chose.
// Pure and deterministic, shared by the server (the authoritative check) and the page (a labelled preview of the ceiling).
// Nothing here pays, reserves, holds or approves money. It never reads a fact from a title, and it never scores items.
import { MAX_WEEKS, OFFER_LIMITS, RESERVE_LIMITS, daysBetween, isIsoDate, weeklyCapacity } from './family-choices.js';

export const CEILING_LIMITS = Object.freeze({ minCents: 100, maxCents: 10_000_000 }); // the goal amount and budget bounds
export const MAX_MUST_HAVES = 2;
const wholeCents = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * The highest item price the family's plan can cover by the goal's date. With:
 * - P: progress already recorded;
 * - N: the weeks up to the date, at most 52;
 * - C: the lower of the household's weekly amount and the active adults' offers;
 * - R: a one-off amount, taken once from the earliest weeks;
 * the ceiling is P + max(0, N × C − R). It is never above an explicitly typed lower price limit (`budgetCents`).
 * It is planning capacity, not money: progress is a record and offers are ceilings the adults chose, not funds held.
 * `outcome` is 'ok', or why there is no usable ceiling: 'no_offers', 'no_capacity', 'date_passed' or 'below_minimum'.
 */
export function fitCeiling({ today, targetDate, progressCents, householdLimitCents, offers, reserveCents = 0, budgetCents = null }) {
  if (!isIsoDate(today) || !isIsoDate(targetDate)) throw new RangeError('Dates must be calendar dates.');
  if (!Number.isSafeInteger(progressCents) || !wholeCents(householdLimitCents)) throw new RangeError('Amounts must be whole cents.');
  if (!wholeCents(reserveCents) || reserveCents > RESERVE_LIMITS.maxCents) throw new RangeError('The one-off amount is out of range.');
  if (budgetCents !== null && (!Number.isSafeInteger(budgetCents) || budgetCents < CEILING_LIMITS.minCents || budgetCents > CEILING_LIMITS.maxCents)) {
    throw new RangeError('The price limit is out of range.');
  }
  if (!Array.isArray(offers) || offers.some((o) => !Number.isSafeInteger(o?.weeklyCents) || o.weeklyCents < OFFER_LIMITS.minCents || o.weeklyCents > OFFER_LIMITS.maxCents)) {
    throw new RangeError('Each offer needs whole cents.');
  }
  const days = daysBetween(today, targetDate);
  const weeks = days < 0 ? 0 : Math.min(MAX_WEEKS, Math.floor(days / 7));
  // The same weekly arithmetic as the comparison and the saved schedule: R comes out of the first weeks, once.
  const capacity = weeklyCapacity({ householdLimitCents, offers, reserveCents, weeks });
  const addableCents = capacity.available.reduce((sum, cents) => sum + cents, 0);
  const reservedByDateCents = capacity.reserved.reduce((sum, cents) => sum + cents, 0);
  const progress = Math.max(0, progressCents);
  const familyCeilingCents = Math.min(CEILING_LIMITS.maxCents, progress + addableCents);
  const ceilingCents = budgetCents !== null ? Math.min(familyCeilingCents, budgetCents) : familyCeilingCents;
  let outcome = 'ok';
  if (capacity.offeredCents === 0) outcome = 'no_offers';
  else if (capacity.capacityCents === 0) outcome = 'no_capacity';
  else if (weeks < 1) outcome = 'date_passed';
  else if (ceilingCents < CEILING_LIMITS.minCents) outcome = 'below_minimum';
  return {
    outcome, today, targetDate, weeks,
    offeredCents: capacity.offeredCents, capacityCents: capacity.capacityCents,
    reserveCents, reservedByDateCents, addableCents, progressCents: progress,
    familyCeilingCents, budgetCents, ceilingCents,
    limitedBy: budgetCents !== null && budgetCents < familyCeilingCents ? 'budget' : 'family',
  };
}

/**
 * Whether one item meets the family's need, from the catalog's own structured facts only (never its title or picture).
 * @param facts { category: { slug, title, path: slug[] } | null, attributes: Record<key, string[]> }
 * @param need { category: { slug, title } | null, mustHaves: [{ key, name, accepted: string[], allowed: string[] }] }
 *
 * Category: 'match' when the item's category is the chosen one or below it; otherwise 'mismatch', 'missing' or
 * 'not_chosen'. Each must-have:
 * - 'match': every value the item reports is one the family accepts;
 * - 'mismatch': every value it reports is a listed value the family does not accept;
 * - 'missing': it reports nothing for it;
 * - 'unclear': accepted and unaccepted values together, or a value outside the category's list.
 * Overall: 'misses' if anything is a mismatch, else 'unknown' if anything is missing or unclear, else 'meets'.
 */
export function matchNeed(facts, need) {
  const own = facts?.category ?? null;
  let category;
  if (!need.category) category = { status: 'not_chosen' };
  else if (!own) category = { status: 'missing' };
  else if (own.slug === need.category.slug || (own.path ?? []).includes(need.category.slug)) category = { status: 'match' };
  else category = { status: 'mismatch', found: own.title ?? null };
  const mustHaves = need.mustHaves.map((m) => {
    const found = Array.isArray(facts?.attributes?.[m.key]) ? facts.attributes[m.key] : [];
    let status;
    if (!found.length) status = 'missing';
    else if (found.some((v) => !m.allowed.includes(v))) status = 'unclear';
    else if (found.every((v) => m.accepted.includes(v))) status = 'match';
    else if (found.every((v) => !m.accepted.includes(v))) status = 'mismatch';
    else status = 'unclear';
    return { key: m.key, name: m.name, accepted: [...m.accepted], found: [...found], status };
  });
  const statuses = [category.status, ...mustHaves.map((m) => m.status)];
  const status = statuses.includes('mismatch') ? 'misses' : statuses.some((s) => s === 'missing' || s === 'unclear') ? 'unknown' : 'meets';
  return { status, category, mustHaves };
}

// Why an item is not suggested, first applicable reason first: what is known to be wrong, then what is unknown.
const ORDER = ['category', 'must_have', 'currency', 'over_ceiling', 'out_of_stock', 'unusable', 'no_price', 'category_missing', 'must_have_missing', 'must_have_unclear', 'stock_unknown'];

/**
 * One searched item judged for the family. It is 'suitable' only when all of these hold:
 * - it meets the need;
 * - it has a usable USD price at or below the ceiling;
 * - its retailer reports it in stock.
 * Missing or unclear facts make it 'unknown', and a known mismatch makes it 'not_suitable'; neither is suggested.
 * @param row a merchant result: { priceCents, currency, availability, usable, unusableReason, catalog }
 */
export function evaluateFit(row, need, { ceilingCents }) {
  const result = matchNeed(row.catalog, need);
  const problems = [];
  const add = (kind, code, extra = {}) => problems.push({ kind, code, ...extra });
  if (result.category.status === 'mismatch') add('mismatch', 'category', { found: result.category.found });
  if (result.category.status === 'missing') add('unknown', 'category_missing');
  for (const m of result.mustHaves) {
    if (m.status === 'mismatch') add('mismatch', 'must_have', { key: m.key });
    if (m.status === 'missing') add('unknown', 'must_have_missing', { key: m.key });
    if (m.status === 'unclear') add('unknown', 'must_have_unclear', { key: m.key });
  }
  if (!Number.isSafeInteger(row.priceCents)) add('unknown', 'no_price');
  else if (row.currency !== 'USD') add('mismatch', 'currency', { currency: row.currency });
  else if (row.priceCents > ceilingCents) add('mismatch', 'over_ceiling');
  if (row.availability === 'OutOfStock') add('mismatch', 'out_of_stock');
  else if (row.availability !== 'InStock') add('unknown', 'stock_unknown');
  // Not usable for another reason (a variant no longer offered, a price outside the goal range): a known problem.
  if (!row.usable && !problems.some((p) => ['currency', 'out_of_stock', 'no_price'].includes(p.code))) add('mismatch', 'unusable', { reason: row.unusableReason ?? null });
  problems.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
  const status = problems.some((p) => p.kind === 'mismatch') ? 'not_suitable' : problems.length ? 'unknown' : 'suitable';
  return { status, check: result, problems };
}

/** Suitable items in a stable order: lowest price first, then product id. */
export const bySuitableOrder = (a, b) => a.priceCents - b.priceCents || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);

const list = (values) => (values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`);

/**
 * Short plain lines about one item and the family's must-haves, from a matchNeed result. A line says what the catalog
 * reports, never more: "Sleeps: 4 person (needed: 4 person or 6 person)".
 */
export function needLines(result) {
  const lines = [];
  for (const m of result.mustHaves) {
    const need = `needed: ${list(m.accepted)}`;
    if (m.status === 'match') lines.push(`${m.name}: ${m.found.join(', ')} (${need})`);
    else if (m.status === 'mismatch') lines.push(`${m.name}: ${m.found.join(', ')}, not ${list(m.accepted)}`);
    else if (m.status === 'missing') lines.push(`${m.name}: not reported, so this need cannot be confirmed`);
    else lines.push(`${m.name}: unclear (${m.found.join(', ')}), so this need cannot be confirmed`);
  }
  return lines;
}

/** One reason an item was not suggested, in plain words. `money(cents)` formats an amount. */
export function problemText(problem, { need, ceilingCents, money }) {
  const name = (key) => need.mustHaves.find((m) => m.key === key)?.name ?? 'A must-have';
  switch (problem.code) {
    case 'category': return `not in ${need.category?.title ?? 'the chosen kind of item'}`;
    case 'category_missing': return 'no catalog category, so the kind of item cannot be confirmed';
    case 'must_have': return `${name(problem.key)} does not match`;
    case 'must_have_missing': return `${name(problem.key)} not reported`;
    case 'must_have_unclear': return `${name(problem.key)} unclear`;
    case 'currency': return `priced in ${problem.currency ?? 'another currency'}`;
    case 'over_ceiling': return `over ${money(ceilingCents)}`;
    case 'out_of_stock': return 'out of stock';
    case 'stock_unknown': return 'stock not reported';
    case 'no_price': return 'no price returned';
    default: return problem.reason ?? 'cannot be used as the goal';
  }
}

/**
 * The ceiling in plain words: what it is made of, and that it is a planning limit, not money in hand.
 * `money(cents)` and `date(iso)` are the page's formatters.
 */
export function ceilingText(c, { money, date }) {
  switch (c.outcome) {
    case 'no_offers': return 'Options can be matched to the family’s date once an adult offers a weekly amount.';
    case 'no_capacity': return `With a household weekly amount of ${money(0)}, no price can be planned by the goal’s date.`;
    case 'date_passed': return 'The goal’s date is less than a week away, so no price can be planned before it.';
    case 'below_minimum': return `Less than ${money(CEILING_LIMITS.minCents)} can be planned by ${date(c.targetDate)} at these offers and this one-off amount.`;
    default: break;
  }
  const parts = `${c.progressCents ? `the ${money(c.progressCents)} already recorded plus ` : ''}${money(c.addableCents)} the adults’ offers can add`
    + (c.reserveCents ? ` after the one-off ${money(c.reserveCents)}` : '');
  const lead = c.limitedBy === 'budget'
    ? `Up to ${money(c.ceilingCents)}, the price limit typed here (the plan could cover ${money(c.familyCeilingCents)} by ${date(c.targetDate)}: ${parts}).`
    : `Up to ${money(c.ceilingCents)} by ${date(c.targetDate)}: ${parts}.`;
  return `${lead} A planning limit, not money in hand.`;
}

/**
 * Why a family choice was chosen, from its stored need: the must-haves, what the catalog reported at the latest check,
 * and the planning limit and date of the search it was found in.
 */
export function needSummary(need, { money, date }) {
  const check = need.check ?? { status: 'unknown', category: 'missing', mustHaves: [] };
  const lead = check.status === 'meets' ? 'Meets the family’s needs' : check.status === 'misses' ? 'No longer meets the family’s needs' : 'Cannot confirm the family’s needs';
  const kind = !need.category ? null
    : check.category === 'match' ? need.category.title
      : check.category === 'mismatch' ? `not in ${need.category.title}` : `${need.category.title} not confirmed`;
  const parts = need.mustHaves.map((m) => {
    const c = check.mustHaves.find((x) => x.key === m.key);
    if (c?.status === 'match') return `${m.name}: ${c.found.join(', ')} (needed: ${list(m.accepted)})`;
    if (c?.status === 'mismatch') return `${m.name}: now ${c.found.join(', ')}, not ${list(m.accepted)}`;
    if (c?.status === 'missing') return `${m.name}: not reported`;
    return `${m.name}: unclear${c?.found?.length ? ` (${c.found.join(', ')})` : ''}`;
  });
  const found = need.search ? ` Found within ${money(need.search.ceilingCents)} for ${date(need.search.targetDate)}.` : '';
  const detail = [kind, ...parts].filter(Boolean).join(' · ');
  return `${lead}${detail ? `: ${detail}` : ''}.${found}`;
}
