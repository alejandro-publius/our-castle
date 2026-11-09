// Comparing complete kits for the family's kit list (task 019), on the server. Planning only: nothing here buys, pays,
// reserves a price or stock, credits progress or changes the goal, except the explicit adoption at the end.
// - A line still to get (Need minus Have) gets up to three listings an adult added from this server's own shown results.
//   Each keeps the line it was added for, and how many items one listing gives: the adult's own count, never inferred.
//   Lines the family already has are skipped: no listing, no search, no cost.
// - "Compare complete kits" builds one bounded request from the server's own records (never the page's figures), runs the
//   solver (server/kit/solver.mjs), checks the answer, and recomputes every kit's lines, totals and finish here with the
//   family's own arithmetic (src/core/family-choices.js). It writes nothing and calls no catalog or model.
// - A kit is complete only when every line still to get has a usable listing; otherwise the comparison says which lines
//   are missing and shows no total. Nothing is filled in, and no alternative is invented to make three.
// - The chosen kit and its kept lines are deliberate adult choices. Kept lines stay fixed in every comparison; a kept
//   listing that is no longer usable is reported, never silently replaced.
// - "Review this kit" checks the chosen kit against fresh catalog answers and returns a goal draft. Adoption saves the
//   goal, the kit's provenance and (when asked) its family schedule proposal in one transaction, from these same checks.
import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db.mjs';
import { DomainError, getGoal, getMembers, progressFor, updateGoal } from '../household.mjs';
import { kitView } from './list.mjs';
import { FRESH_MS, familyChoicesView, identityOf, needReserve, needSnapshot, recheckNeed, scheduleFor, unschedulable } from '../family-choices.mjs';
import { compareChoices } from '../../src/core/family-choices.js';
import { CEILING_LIMITS, fitCeiling } from '../../src/core/family-fit.js';
import { lineCost } from '../../src/core/kit-plan.js';
import { merchantGoalRevision } from '../merchant/goal-item.mjs';
import { KIT_PREFERENCES, RERANK_LIMITS } from './rerank.mjs';

export const MAX_PER_LINE = 3;
export const PER_LISTING_MAX = 100;
const SAMPLE_SIZE = 8; // kits that fit, lowest totals first, that a preference may order
const CANDIDATE_ID = /^kc_[0-9a-f]{24}$/;
const LINE_ID = /^ki_[0-9a-f]{16}$/;
const fail = (status, code, message, extra = {}) => Object.assign(new DomainError(status, code, message), extra);
const needAdult = (actor) => { if (actor.role !== 'adult') throw fail(403, 'adult_required', 'Only an adult in the family can do this.'); };
const goalOf = (db, householdId, goalId) => {
  const goal = getGoal(db, goalId);
  if (!goal || goal.householdId !== householdId) throw fail(404, 'not_found', 'Goal not found.');
  return goal;
};
function needId(value, pattern, code, message) {
  if (typeof value !== 'string' || !pattern.test(value)) throw fail(400, code, message);
  return value;
}

const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const rowItem = (r) => ({ productId: r.product_id, merchant: r.merchant, condition: r.condition, selection: parse(r.selection_json, []) });
const candidateRows = (db, goalId) => db.prepare('SELECT * FROM kit_candidates WHERE goal_id = ? ORDER BY added_at, rowid').all(goalId);
const selectionRows = (db, goalId) => db.prepare('SELECT * FROM kit_selections WHERE goal_id = ?').all(goalId);

/**
 * Why a listing cannot be compared for its line right now, first reason first, or null when it can:
 * - 'outdated': the line was renamed or its details changed since the listing was added;
 * - 'price_unusable': not priced in the goal's currency;
 * - 'out_of_stock' / 'stock_unknown': the catalog's stock at the latest check (only "in stock" is used; it is not reserved);
 * - 'need_misses' / 'need_unknown': it was found for must-haves the catalog no longer confirms.
 */
function issueOf(row, line, goal) {
  if (row.line_name !== line.name || (row.line_needs ?? null) !== (line.needs ?? null)) return 'outdated';
  if (row.currency !== goal.currency) return 'price_unusable';
  if (row.availability === 'OutOfStock') return 'out_of_stock';
  if (row.availability !== 'InStock') return 'stock_unknown';
  const need = parse(row.need_json, null);
  if (need?.check?.status === 'misses') return 'need_misses';
  if (need && need.check?.status !== 'meets') return 'need_unknown';
  return null;
}

/** Opaque optimistic-concurrency token over the kit list and everything added or chosen for it. Not an authorization. */
function planRevision(kit, rows, selections) {
  const facts = ['kit-plan-v1', kit.revision, kit.items.map((i) => [i.id, i.name, i.needs, i.quantity, i.ownedQuantity]),
    rows.map((r) => [r.id, r.line_id, r.line_name, r.line_needs, r.product_id, r.merchant, r.price_cents, r.currency, r.availability, r.condition, r.selection_json,
      r.weight_mg, r.per_listing, r.checked_at, parse(r.need_json, null)?.check?.status ?? null]),
    [...selections].sort((a, b) => (a.line_id < b.line_id ? -1 : 1)).map((s) => [s.line_id, s.candidate_id, s.kept])];
  return `kp1_${createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)}`;
}

/**
 * What every member sees: each saved line, what is still to get, the listings added for it and the chosen kit.
 * Listings carry public catalog facts only, plus the adult's own per-listing count (named as theirs).
 */
export function kitPlanView(db, { householdId, goal, now, rankMode = 'off' }) {
  const kit = kitView(db, goal);
  const rows = candidateRows(db, goal.id);
  const selections = selectionRows(db, goal.id);
  const names = new Map(getMembers(db, householdId).map((m) => [m.id, m.name]));
  const lines = kit.items.map((item) => ({
    lineId: item.id, name: item.name, needs: item.needs, quantity: item.quantity, ownedQuantity: item.ownedQuantity, remaining: item.remaining,
    candidates: rows.filter((r) => r.line_id === item.id).map((r) => {
      const need = parse(r.need_json, null);
      return {
        id: r.id, title: r.title, merchant: r.merchant, priceCents: r.price_cents, currency: r.currency, availability: r.availability, condition: r.condition,
        selection: parse(r.selection_json, []), weightMg: r.weight_mg, perListing: r.per_listing, perListingBy: names.get(r.per_listing_by) ?? 'An adult',
        checkedAt: r.checked_at, fresh: Boolean(r.draft_id) && now - Date.parse(r.checked_at) <= FRESH_MS,
        need: need ? { category: need.category?.title ?? null, mustHaves: need.mustHaves.map((m) => m.name), status: need.check?.status ?? 'unknown' } : null,
        issue: issueOf(r, item, goal),
      };
    }),
  }));
  // In the kit list's own order, for the lines still to get.
  const chosen = lines.filter((l) => l.remaining > 0).map((l) => selections.find((s) => s.line_id === l.lineId)).filter(Boolean);
  return {
    maxPerLine: MAX_PER_LINE, revision: planRevision(kit, rows, selections), kitRevision: kit.revision,
    lines,
    selection: chosen.length ? { lines: chosen.map((s) => ({ lineId: s.line_id, candidateId: s.candidate_id, kept: s.kept === 1, chosenBy: names.get(s.chosen_by) ?? 'An adult', chosenAt: s.chosen_at })) } : null,
    preference: { mode: rankMode, options: Object.entries(KIT_PREFERENCES).map(([key, p]) => ({ key, label: p.label })) },
  };
}

function checkPlanRevision(view, revision) {
  if (revision !== view.revision) throw fail(409, 'kit_plan_changed', 'The kit list, its listings or the chosen kit changed. Review the latest, then try again.');
}

/** Add a listing this server showed the household for one line still to get, with the adult's own per-listing count. */
export function addCandidate(db, { householdId, goalId, actor, revision, lineId, item, draftId, perListing }, clock) {
  needAdult(actor);
  const goal = goalOf(db, householdId, goalId);
  const view = kitPlanView(db, { householdId, goal, now: clock.now().getTime() });
  checkPlanRevision(view, revision);
  const line = view.lines.find((l) => l.lineId === needId(lineId, LINE_ID, 'invalid_kit_line', 'Choose a line of the kit list.'));
  if (!line) throw fail(409, 'kit_line_gone', 'That line is no longer on the kit list.');
  if (line.remaining === 0) throw fail(409, 'kit_line_owned', `The family already has every ${line.name} it needs, so nothing is to get for it.`);
  if (!item?.usable || item.currency !== goal.currency || !Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || typeof item.url !== 'string') {
    throw fail(400, 'merchant_price_unusable', 'This result has no usable price in the goal currency, so it cannot be compared.');
  }
  if (!Number.isSafeInteger(perListing) || perListing < 1 || perListing > PER_LISTING_MAX) {
    throw fail(400, 'invalid_per_listing', `Enter how many ${line.name} one listing gives, from 1 to ${PER_LISTING_MAX}. Check the listing itself: it is your count, not a catalog fact.`);
  }
  const need = item.fit ? needSnapshot(item.fit, item.checkedAt) : null;
  const facts = [item.title, item.merchant, item.url, item.priceCents, item.currency, item.availability ?? null, item.condition ?? null,
    JSON.stringify((item.selection ?? []).map((v) => ({ name: v.name, label: v.label }))), Number.isSafeInteger(item.weightMg) ? item.weightMg : null,
    perListing, actor.memberId, need ? JSON.stringify(need) : null, item.checkedAt, draftId];
  return transaction(db, () => {
    const rows = candidateRows(db, goal.id).filter((r) => r.line_id === line.lineId);
    const same = rows.find((r) => identityOf(rowItem(r)) === identityOf(item));
    if (same) {
      db.prepare(`UPDATE kit_candidates SET line_name = ?, line_needs = ?, title = ?, merchant = ?, url = ?, price_cents = ?, currency = ?, availability = ?, condition = ?,
        selection_json = ?, weight_mg = ?, per_listing = ?, per_listing_by = ?, need_json = ?, checked_at = ?, draft_id = ? WHERE id = ?`).run(line.name, line.needs ?? null, ...facts, same.id);
      return { candidateId: same.id, outcome: 'updated' };
    }
    if (rows.length >= MAX_PER_LINE) throw fail(409, 'kit_line_full', `${line.name} already has ${MAX_PER_LINE} listings. Remove one to add another.`);
    const id = `kc_${randomBytes(12).toString('hex')}`;
    db.prepare(`INSERT INTO kit_candidates (id, household_id, goal_id, line_id, line_name, line_needs, product_id, title, merchant, url, price_cents, currency, availability,
      condition, selection_json, weight_mg, per_listing, per_listing_by, need_json, checked_at, draft_id, added_by, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, householdId, goal.id, line.lineId, line.name, line.needs ?? null, item.productId, ...facts, actor.memberId, clock.iso());
    return { candidateId: id, outcome: 'added' };
  });
}

export function removeCandidate(db, { householdId, goalId, actor, candidateId }) {
  needAdult(actor);
  const id = needId(candidateId, CANDIDATE_ID, 'invalid_kit_listing', 'Choose one of the listings shown.');
  goalOf(db, householdId, goalId);
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM kit_candidates WHERE id = ? AND goal_id = ? AND household_id = ?').get(id, goalId, householdId);
    if (!row) throw fail(404, 'kit_listing_gone', 'That listing was already removed.');
    if (db.prepare('SELECT 1 FROM kit_selections WHERE goal_id = ? AND candidate_id = ? AND kept = 1').get(goalId, id)) {
      throw fail(409, 'kit_listing_kept', `${row.title} is kept in the chosen kit. Stop keeping it first, so the change is deliberate.`);
    }
    db.prepare('DELETE FROM kit_candidates WHERE id = ?').run(id); // a chosen (not kept) line becomes unchosen with it
    return { removed: true };
  });
}

/** The explicit "Check price" for one listing: one bounded catalog look-up, through the merchant's own refresh. */
export async function refreshCandidate(db, { householdId, goalId, actor, candidateId, refresh }) {
  needAdult(actor);
  const id = needId(candidateId, CANDIDATE_ID, 'invalid_kit_listing', 'Choose one of the listings shown.');
  const goal = goalOf(db, householdId, goalId);
  const before = db.prepare('SELECT * FROM kit_candidates WHERE id = ? AND goal_id = ?').get(id, goal.id);
  if (!before) throw fail(404, 'kit_listing_gone', 'That listing was removed.');
  const found = await refresh({ ...rowItem(before), priceCents: before.price_cents, query: before.title });
  const fresh = found.results?.[0] ?? null;
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM kit_candidates WHERE id = ? AND goal_id = ?').get(id, goal.id);
    if (!row) throw fail(409, 'kit_listing_gone', 'That listing was removed while its price was being checked.');
    const same = fresh && identityOf(fresh) === identityOf(rowItem(row));
    const earlier = parse(row.need_json, null);
    const need = earlier && same && fresh.catalog ? recheckNeed(earlier, fresh.catalog, fresh.checkedAt) : earlier;
    if (need !== earlier) db.prepare('UPDATE kit_candidates SET need_json = ? WHERE id = ?').run(JSON.stringify(need), id);
    if (!(same && fresh.usable && fresh.draftId && fresh.currency === goal.currency)) {
      // The last seen facts stay, with their own time; the listing can be used again only after a check finds it usable.
      db.prepare('UPDATE kit_candidates SET draft_id = NULL WHERE id = ?').run(id);
      if (same && fresh.availability === 'OutOfStock') db.prepare("UPDATE kit_candidates SET availability = 'OutOfStock', checked_at = ? WHERE id = ?").run(fresh.checkedAt, id);
      return { candidateId: id, usable: false, reason: fresh?.unusableReason ?? 'This listing could not be checked. Choose another listing.' };
    }
    db.prepare('UPDATE kit_candidates SET title = ?, url = ?, price_cents = ?, availability = ?, weight_mg = ?, checked_at = ?, draft_id = ? WHERE id = ?')
      .run(fresh.title, fresh.url, fresh.priceCents, fresh.availability ?? null, Number.isSafeInteger(fresh.weightMg) ? fresh.weightMg : null, fresh.checkedAt, fresh.draftId, id);
    return { candidateId: id, usable: true, previousPriceCents: row.price_cents, priceCents: fresh.priceCents, previousWeightMg: row.weight_mg, weightMg: fresh.weightMg ?? null };
  });
}

/** Save one listing per line still to get as the family's chosen kit. Kept lines must stay as they are. */
export function chooseKit(db, { householdId, goalId, actor, revision, lines }, clock) {
  needAdult(actor);
  const goal = goalOf(db, householdId, goalId);
  return transaction(db, () => {
    const view = kitPlanView(db, { householdId, goal, now: clock.now().getTime() });
    checkPlanRevision(view, revision);
    const needed = view.lines.filter((l) => l.remaining > 0);
    if (!needed.length) throw fail(409, 'nothing_to_buy', 'Everything on the kit list is already at home, so there is no kit to choose.');
    if (!Array.isArray(lines) || lines.length !== needed.length) throw fail(400, 'invalid_kit_choice', 'Choose one listing for every line still to get.');
    const picked = new Map();
    for (const entry of lines) {
      const line = needed.find((l) => l.lineId === entry?.lineId);
      const candidate = line?.candidates.find((c) => c.id === entry.candidateId);
      if (!line || picked.has(line.lineId) || !candidate) throw fail(400, 'invalid_kit_choice', 'Choose one listing for every line still to get.');
      if (candidate.issue) throw fail(409, 'kit_listing_unusable', `${candidate.title} cannot be chosen right now. Compare the kits again.`);
      picked.set(line.lineId, candidate.id);
    }
    const kept = new Map(selectionRows(db, goal.id).map((s) => [s.line_id, s]));
    for (const line of needed) {
      const before = kept.get(line.lineId);
      if (before?.kept === 1 && before.candidate_id !== picked.get(line.lineId)) {
        throw fail(409, 'kit_line_kept', `${line.name} is kept as it is. Stop keeping it first, so the change is deliberate.`);
      }
    }
    db.prepare(`DELETE FROM kit_selections WHERE goal_id = ? AND line_id NOT IN (${needed.map(() => '?').join(',')})`).run(goal.id, ...needed.map((l) => l.lineId));
    for (const line of needed) {
      const before = kept.get(line.lineId), candidateId = picked.get(line.lineId);
      if (before?.candidate_id === candidateId) continue; // unchanged: it keeps who chose it, when, and whether it is kept
      db.prepare(`INSERT INTO kit_selections (goal_id, line_id, candidate_id, kept, chosen_by, chosen_at) VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(goal_id, line_id) DO UPDATE SET candidate_id = excluded.candidate_id, kept = 0, chosen_by = excluded.chosen_by, chosen_at = excluded.chosen_at`)
        .run(goal.id, line.lineId, candidateId, actor.memberId, clock.iso());
    }
    return { chosen: true };
  });
}

/** Keep (or stop keeping) one line of the chosen kit: a kept line stays fixed in every comparison until an adult unkeeps it. */
export function keepLine(db, { householdId, goalId, actor, revision, lineId, kept }, clock) {
  needAdult(actor);
  if (typeof kept !== 'boolean') throw fail(400, 'invalid_keep', 'Say whether to keep this line.');
  const goal = goalOf(db, householdId, goalId);
  return transaction(db, () => {
    const view = kitPlanView(db, { householdId, goal, now: clock.now().getTime() });
    checkPlanRevision(view, revision);
    const id = needId(lineId, LINE_ID, 'invalid_kit_line', 'Choose a line of the kit list.');
    const chosen = view.selection?.lines.find((s) => s.lineId === id);
    if (!chosen) throw fail(409, 'kit_line_not_chosen', 'Choose a kit before keeping one of its lines.');
    const candidate = view.lines.find((l) => l.lineId === id)?.candidates.find((c) => c.id === chosen.candidateId);
    if (kept && candidate?.issue) throw fail(409, 'kit_listing_unusable', `${candidate.title} cannot be kept right now: check its price or choose another listing.`);
    db.prepare('UPDATE kit_selections SET kept = ? WHERE goal_id = ? AND line_id = ?').run(kept ? 1 : 0, goal.id, id);
    void clock;
    return { kept };
  });
}

// ---- Comparing complete kits ----

/** The facts every comparison, review and adoption reads from the server's own records, checked against what the page saw. */
function planFacts(db, { householdId, goal, progress, today, now, family, revision, choicesRevision, reserveCents, rankMode }) {
  const reserve = needReserve(reserveCents);
  const choices = familyChoicesView(db, { householdId, goal, progress, today, now, family });
  if (choicesRevision !== choices.revision) throw fail(409, 'choices_changed', 'The family’s offers, goal or progress changed. Compare again with the latest figures.');
  const view = kitPlanView(db, { householdId, goal, now, rankMode });
  checkPlanRevision(view, revision);
  return { reserve, choices, view, needed: view.lines.filter((l) => l.remaining > 0) };
}

/** The comparison's line-up: each line still to get with its usable listings, which are missing, and kept lines in trouble. */
function lineUp(view, needed) {
  const chosen = new Map((view.selection?.lines ?? []).map((s) => [s.lineId, s]));
  const missing = [], keptTrouble = [];
  const lines = needed.map((line) => {
    const usable = line.candidates.filter((c) => !c.issue);
    const pick = chosen.get(line.lineId);
    const current = pick ? usable.findIndex((c) => c.id === pick.candidateId) : -1;
    if (pick?.kept && current < 0) {
      const c = line.candidates.find((x) => x.id === pick.candidateId);
      keptTrouble.push({ lineId: line.lineId, name: line.name, title: c?.title ?? null, issue: c?.issue ?? 'removed' });
    }
    if (!usable.length) missing.push({ lineId: line.lineId, name: line.name, listings: line.candidates.length, issues: line.candidates.map((c) => c.issue) });
    return { line, usable, current: current < 0 ? null : current, pinned: Boolean(pick?.kept) && current >= 0 };
  });
  return { lines, missing, keptTrouble };
}

/** The solver request: whole cents, counts, milligrams and indices only. Retailers become indices in order of first use. */
function solverRequest(lines, ceilingCents, sampleSize) {
  const retailers = new Map();
  const index = (merchant) => { if (!retailers.has(merchant)) retailers.set(merchant, retailers.size); return retailers.get(merchant); };
  return {
    version: 1, ceilingCents, sampleSize,
    lines: lines.map(({ line, usable, current, pinned }) => ({
      need: line.remaining,
      options: usable.map((c) => ({ listingCents: c.priceCents, perListing: c.perListing, weightMg: Number.isSafeInteger(c.weightMg) ? c.weightMg : null, retailer: index(c.merchant) })),
      current, pinned,
    })),
  };
}

/** One kit as the family sees it, recomputed here from the records and the family's own arithmetic. */
function kitCard(kit, lines, finishOf) {
  let totalCents = 0, weightMg = 0;
  const merchants = [];
  const shown = lines.map(({ line, usable, current, pinned }, i) => {
    const c = usable[kit.choice[i]];
    const cost = lineCost(line.remaining, { listingCents: c.priceCents, perListing: c.perListing, weightMg: Number.isSafeInteger(c.weightMg) ? c.weightMg : null });
    totalCents += cost.cents;
    weightMg = weightMg === null || cost.weightMg === null ? null : weightMg + cost.weightMg;
    if (!merchants.includes(c.merchant)) merchants.push(c.merchant);
    const was = current !== null && current !== kit.choice[i] ? usable[current] : null;
    const wasCost = was ? lineCost(line.remaining, { listingCents: was.priceCents, perListing: was.perListing, weightMg: null }) : null;
    return {
      lineId: line.lineId, name: line.name, need: line.remaining, candidateId: c.id, title: c.title, merchant: c.merchant, priceCents: c.priceCents,
      perListing: c.perListing, perListingBy: c.perListingBy, listings: cost.listings, bought: cost.bought, surplus: cost.surplus, lineCents: cost.cents,
      weightMg: cost.weightMg, kept: pinned,
      switched: was ? { candidateId: was.id, title: was.title, merchant: was.merchant, listings: wasCost.listings, lineCents: wasCost.cents } : null,
    };
  });
  // The solver's figures must be exactly these, and its "fits" must be the family arithmetic's on-time finish.
  if (totalCents !== kit.totalCents || weightMg !== kit.weightMg || merchants.length !== kit.retailers) throw fail(502, 'kit_solver_failed', 'The kit comparison could not be completed this time. Nothing was changed; try again.');
  const finish = finishOf(totalCents);
  const onTime = finish.status === 'fits' || finish.status === 'covered';
  if (onTime !== kit.fits) throw fail(502, 'kit_solver_failed', 'The kit comparison could not be completed this time. Nothing was changed; try again.');
  return { key: kit.choice.join('.'), choice: kit.choice, labels: [], totalCents, weightMg, retailers: merchants.length, merchants, changes: kit.changes, fits: kit.fits, finish, lines: shown };
}

/** Up to three distinct kits that fit, each with every objective it wins; a repair first when the chosen kit no longer fits. */
function pickKits(answer, makeCard) {
  const wins = [];
  if (answer.current && !answer.current.fits && answer.smallestChange) wins.push(['smallest_change', answer.smallestChange]);
  if (answer.lowestTotal) wins.push(['lowest_total', answer.lowestTotal]);
  if (answer.lowerWeight) wins.push(['lower_weight', answer.lowerWeight]);
  if (answer.fewestRetailers) wins.push(['fewest_retailers', answer.fewestRetailers]);
  const cards = [];
  for (const [label, kit] of wins) {
    const key = kit.choice.join('.');
    const card = cards.find((c) => c.key === key);
    if (card) card.labels.push(label);
    else if (cards.length < 3) cards.push(Object.assign(makeCard(kit), { labels: [label] }));
  }
  return cards;
}

/**
 * Compare complete kits for the kit list as it is now: read-only, no catalog or model call. `solver` answers the bounded
 * request (server/kit/solver.mjs); every kit it returns is recomputed here before it is shown.
 * Status: 'ok' (kits fit), 'none_fits' (the closest kit and its shortfall), 'incomplete' (lines without a usable listing),
 * 'kept_unavailable' (a kept listing can no longer be used), 'nothing_to_buy' or 'no_ceiling'.
 */
export async function compareKits(db, context, { solver, sampleSize = 0, signal } = {}) {
  const { goal, progress, today } = context;
  const { reserve, choices, view, needed } = planFacts(db, context);
  const base = { revision: view.revision, choicesRevision: choices.revision, reserveCents: reserve };
  if (!needed.length) return { ...base, status: 'nothing_to_buy' };
  const ceiling = fitCeiling({ today, targetDate: goal.targetDate, progressCents: progress.progressCents, householdLimitCents: goal.weeklyBudgetCents, offers: choices.offers, reserveCents: reserve });
  const shownCeiling = { outcome: ceiling.outcome, targetDate: ceiling.targetDate, ceilingCents: ceiling.ceilingCents, familyCeilingCents: ceiling.familyCeilingCents, budgetCents: null,
    progressCents: ceiling.progressCents, addableCents: ceiling.addableCents, reserveCents: reserve, limitedBy: ceiling.limitedBy };
  if (goal.currency !== 'USD') return { ...base, status: 'no_ceiling', reason: 'currency', ceiling: shownCeiling };
  if (ceiling.outcome !== 'ok' && ceiling.outcome !== 'below_minimum') return { ...base, status: 'no_ceiling', reason: ceiling.outcome, ceiling: shownCeiling };
  const { lines, missing, keptTrouble } = lineUp(view, needed);
  if (keptTrouble.length) return { ...base, status: 'kept_unavailable', ceiling: shownCeiling, kept: keptTrouble };
  if (missing.length) return { ...base, status: 'incomplete', ceiling: shownCeiling, missing, ready: needed.length - missing.length, needed: needed.length };
  const request = solverRequest(lines, Math.min(ceiling.ceilingCents, CEILING_LIMITS.maxCents), sampleSize);
  const answer = await solver.solve(request, { signal });
  // The family's own arithmetic for a kit's total: the same weeks, one-off amount and offers as Family choices.
  const finishOf = (cents) => {
    const c = compareChoices({ today, deadline: goal.targetDate, progressCents: progress.progressCents, householdLimitCents: goal.weeklyBudgetCents, currency: goal.currency,
      offers: choices.offers, reserveCents: reserve, options: [{ id: 'kit', priceCents: cents, currency: goal.currency }] });
    const o = c.options[0];
    return { status: o.status, finishDate: o.finishDate, finishWeek: o.finishWeek, shortfallCents: o.shortfallCents, weeksLate: o.weeksLate, deadline: goal.targetDate };
  };
  const makeCard = (kit) => kitCard(kit, lines, finishOf);
  const pool = { lines: lines.length, listings: lines.reduce((n, l) => n + l.usable.length, 0), combinations: answer.combinations, feasible: answer.feasible, weightComparable: answer.weightComparable };
  const current = answer.current ? makeCard(answer.current) : null;
  const kits = pickKits(answer, makeCard);
  const result = { ...base, status: kits.length ? 'ok' : 'none_fits', ceiling: shownCeiling, pool, kits, current,
    closest: kits.length ? null : makeCard(answer.cheapest) };
  return Object.assign(result, { sample: answer.sample.map(makeCard) });
}

/**
 * A kit's public description for ordering by preference: each listing's catalog title and shop, nothing else. How many
 * listings the family needs, counts per listing, prices, weights and the list's own words stay on this server, where the
 * solver and the family's page use them.
 */
export const kitDescription = (card) => card.lines.map((l) => `${l.title} (${l.merchant})`).join('; ').slice(0, RERANK_LIMITS.maxDocumentChars);

/**
 * Put a preference's best match among the kits that fit into the shown kits: labelled when it is already shown, otherwise
 * added in place of the least important objective (never the repair or the lowest total), so at most three are shown.
 */
export function withPreference(result, card, label) {
  const kits = result.kits.map((k) => ({ ...k, labels: [...k.labels] }));
  const shown = kits.find((k) => k.key === card.key);
  if (shown) shown.labels.push(label);
  else {
    if (kits.length >= 3) {
      const drop = ['fewest_retailers', 'lower_weight'].map((l) => kits.findIndex((k) => k.labels.length === 1 && k.labels[0] === l)).find((i) => i >= 0);
      kits.splice(drop ?? kits.length - 1, 1);
    }
    kits.push({ ...card, labels: [label] });
  }
  return kits;
}

// ---- Review and adoption ----

// kitCard without a solver kit: the chosen kit's own figures (used by review and adoption, which do not solve anything).
function chosenCard(lines, finishOf) {
  const choice = lines.map((l) => l.current);
  let totalCents = 0, weightMg = 0;
  const merchants = [];
  for (const [i, { line, usable }] of lines.entries()) {
    const c = usable[choice[i]];
    const cost = lineCost(line.remaining, { listingCents: c.priceCents, perListing: c.perListing, weightMg: Number.isSafeInteger(c.weightMg) ? c.weightMg : null });
    totalCents += cost.cents;
    weightMg = weightMg === null || cost.weightMg === null ? null : weightMg + cost.weightMg;
    if (!merchants.includes(c.merchant)) merchants.push(c.merchant);
  }
  const finish = finishOf(totalCents);
  return kitCard({ choice, totalCents, weightMg, retailers: merchants.length, changes: 0, fits: finish.status === 'fits' || finish.status === 'covered' }, lines, finishOf);
}

/**
 * "Review this kit": the chosen kit checked as above, as a goal draft for the Plan form, plus the family schedule "Save goal
 * and propose this schedule" would propose. Writes nothing. The date stays the goal's when the kit is on time; otherwise
 * the draft shows the earliest finish at these offers, for the adult to see and decide.
 */
export function reviewKit(db, context, { draftFor }) {
  needAdult(context.actor);
  const { goal, progress, today } = context;
  const { reserve, choices, view, lines } = chosenKitChecked(db, context, draftFor);
  // The weekly amount open to the goal: the lower of the household's weekly amount and the adults' offers (as reviewChoice).
  const capacityCents = Math.min(goal.weeklyBudgetCents, choices.offers.reduce((sum, o) => sum + o.weeklyCents, 0));
  const finishOf = finishFor(context, choices, reserve);
  const card = chosenCard(lines, finishOf);
  if (card.totalCents < CEILING_LIMITS.minCents || card.totalCents > CEILING_LIMITS.maxCents) throw fail(409, 'kit_total_out_of_range', 'This kit’s listed total is outside the goal range ($1.00 to $100,000.00).');
  const targetDate = card.finish.status === 'late' ? card.finish.finishDate : goal.targetDate;
  const draftGoal = { targetCents: card.totalCents, targetDate, weeklyBudgetCents: Math.min(capacityCents, card.totalCents) };
  const schedule = scheduleFor({ goal: { ...goal, ...draftGoal }, progress, today, offers: choices.offers, reserveCents: reserve });
  const blocked = unschedulable(schedule);
  return {
    status: 'ok', saved: false, revision: view.revision, choicesRevision: choices.revision, reserveCents: reserve,
    kit: card, goal: draftGoal, startingCents: progress.startingCents, deadline: goal.targetDate,
    schedule: { ...schedule, proposable: !blocked, reason: blocked?.message ?? null },
  };
}

function finishFor({ goal, progress, today }, choices, reserve) {
  return (cents) => {
    const c = compareChoices({ today, deadline: goal.targetDate, progressCents: progress.progressCents, householdLimitCents: goal.weeklyBudgetCents, currency: goal.currency,
      offers: choices.offers, reserveCents: reserve, options: [{ id: 'kit', priceCents: cents, currency: goal.currency }] });
    const o = c.options[0];
    return { status: o.status, finishDate: o.finishDate, finishWeek: o.finishWeek, shortfallCents: o.shortfallCents, weeksLate: o.weeksLate, deadline: goal.targetDate };
  };
}

/**
 * The chosen kit as it is now, checked for review and adoption: every line still to get chosen and usable, and every
 * listing confirmed by a live catalog answer (checked within the merchant's draft lifetime and identical to what was
 * compared: price, stock, variant and listed weight).
 */
function chosenKitChecked(db, context, draftFor) {
  const { reserve, choices, view, needed } = planFacts(db, context);
  if (!needed.length) throw fail(409, 'nothing_to_buy', 'Everything on the kit list is already at home: nothing remains to buy on this list, so there is no goal to make from it.');
  const { lines, keptTrouble } = lineUp(view, needed);
  if (keptTrouble.length) throw fail(409, 'kit_kept_unavailable', `${keptTrouble[0].title ?? 'A kept listing'} can no longer be used. Stop keeping it or check its price, then compare again.`);
  const unchosen = lines.filter((l) => l.current === null);
  if (unchosen.length) throw fail(409, 'kit_not_chosen', `Choose a kit with a usable listing for ${unchosen.map((l) => l.line.name).join(', ')} first.`);
  const stale = [];
  for (const { line, usable, current } of lines) {
    const c = usable[current];
    const row = db.prepare('SELECT * FROM kit_candidates WHERE id = ?').get(c.id);
    let live = null;
    try { live = row.draft_id && c.fresh ? draftFor(row.draft_id) : null; } catch { live = null; }
    const same = live && identityOf(live) === identityOf(rowItem(row)) && live.priceCents === row.price_cents && live.currency === row.currency
      && live.availability === row.availability && (Number.isSafeInteger(live.weightMg) ? live.weightMg : null) === row.weight_mg;
    if (!same) stale.push({ lineId: line.lineId, name: line.name, candidateId: c.id, title: c.title });
  }
  if (stale.length) {
    throw fail(409, 'kit_needs_check', `Check the price of ${stale.map((s) => s.title).join(', ')} again before reviewing this kit. Prices and stock change.`, { issues: stale });
  }
  return { reserve, choices, view, lines };
}

/**
 * "Save goal (and propose this schedule)" for a reviewed kit, inside the route's transaction: the same checks as the
 * review, the goal's own revision, then the ordinary goal edit and the kit's provenance. The single item a goal may have
 * been saved from no longer describes it, so that record is cleared. Returns the facts the schedule proposal rests on.
 */
export function adoptKit(db, context, { draftFor, expectedGoalId, expectedGoalRevision, input }, clock) {
  needAdult(context.actor);
  const { goal, progress } = context;
  const { choices, reserve, view, lines } = chosenKitChecked(db, context, draftFor);
  const card = chosenCard(lines, finishFor(context, choices, reserve));
  if (expectedGoalId !== goal.id || expectedGoalRevision !== merchantGoalRevision(goal, progress.startingCents)) {
    throw fail(409, 'goal_changed', 'The household goal changed. Review the latest goal before saving this kit.');
  }
  if (!input || typeof input !== 'object') throw fail(400, 'invalid_goal', 'Review the goal before saving.');
  if (!Number.isSafeInteger(input.targetCents) || input.targetCents < card.totalCents) {
    throw fail(400, 'kit_goal_below_total', `The goal amount cannot be lower than the kit’s listed total (${(card.totalCents / 100).toFixed(2)} ${goal.currency}).`);
  }
  const saved = updateGoal(db, goal.id, input, clock);
  const snapshot = card.lines.map((l) => {
    const row = db.prepare('SELECT * FROM kit_candidates WHERE id = ?').get(l.candidateId);
    return { lineId: l.lineId, name: l.name, need: l.need, candidateId: l.candidateId, productId: row.product_id, title: row.title, merchant: row.merchant, url: row.url,
      priceCents: row.price_cents, currency: row.currency, availability: row.availability, condition: row.condition, selection: parse(row.selection_json, []),
      weightMg: row.weight_mg, perListing: row.per_listing, perListingBy: l.perListingBy, listings: l.listings, bought: l.bought, surplus: l.surplus, lineCents: l.lineCents, checkedAt: row.checked_at };
  });
  db.prepare(`INSERT INTO goal_kits (goal_id, household_id, kit_revision, total_cents, currency, lines_json, goal_name, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(goal_id) DO UPDATE SET kit_revision = excluded.kit_revision, total_cents = excluded.total_cents, currency = excluded.currency, lines_json = excluded.lines_json,
      goal_name = excluded.goal_name, saved_by = excluded.saved_by, saved_at = excluded.saved_at`)
    .run(goal.id, goal.householdId, view.kitRevision, card.totalCents, goal.currency, JSON.stringify(snapshot), saved.name, context.actor.memberId, clock.iso());
  db.prepare('DELETE FROM goal_items WHERE goal_id = ?').run(goal.id);
  return { saved, kit: { totalCents: card.totalCents, lines: snapshot.map((l) => ({ candidateId: l.candidateId, title: l.title })) }, reserveCents: reserve };
}

/** The kit the current goal was saved from, while the goal keeps the name it was saved with. */
export function goalKitFor(db, goal) {
  const row = db.prepare('SELECT * FROM goal_kits WHERE goal_id = ?').get(goal.id);
  if (!row || row.goal_name !== goal.name) return null;
  const lines = parse(row.lines_json, []);
  return { totalCents: row.total_cents, currency: row.currency, savedAt: row.saved_at, lineCount: lines.length,
    lines: lines.map((l) => ({ name: l.name, need: l.need, title: l.title, merchant: l.merchant, listings: l.listings, lineCents: l.lineCents })) };
}
