// Family choices on the server, for the active goal:
// - the shared shortlist (up to three items an adult saved from this server's own shown merchant results);
// - each adult's own weekly planning offer;
// - each member's own preference;
// - the canonical comparison of them (src/core/family-choices.js).
// Planning records only. Nothing here pays, approves, reserves a price, changes the goal or the ledger, or calls a
// provider; the one explicit price check is passed in as `refresh`.

import { createHash, randomBytes } from 'node:crypto';
import { transaction } from './db.mjs';
import { DomainError, getGoal, getMembers } from './household.mjs';
import { MAX_CHOICES, OFFER_LIMITS, RESERVE_LIMITS, choicesInput, compareChoices, familySchedule } from '../src/core/family-choices.js';
import { fitCeiling, matchNeed } from '../src/core/family-fit.js';
import { formatCents } from '../src/core/rules.js';

const CHOICE_ID = /^fc_[0-9a-f]{24}$/;
// The merchant's own draft lifetime (server/merchant/channel3.mjs). Older observations need an explicit check before adoption.
export const FRESH_MS = 30 * 60_000;
const fail = (status, code, message) => new DomainError(status, code, message);

/** Members who still count: everyone in example mode; in a shared family, members whose access is active. */
function activeMembers(db, householdId, family) {
  const members = getMembers(db, householdId);
  if (!family) return members;
  const active = new Set(db.prepare("SELECT member_id FROM memberships WHERE household_id = ? AND access = 'active'").all(householdId).map((r) => r.member_id));
  return members.filter((m) => active.has(m.id));
}

const selectionOf = (value) => (Array.isArray(value) ? value : []).map((v) => ({ name: v.name, label: v.label }));
// The public identity of an offer: another retailer, condition or variant is a different choice.
const identityOf = (x) => JSON.stringify([x.productId, x.merchant, x.condition ?? null, selectionOf(x.selection)]);
const rowItem = (r) => ({ productId: r.product_id, merchant: r.merchant, condition: r.condition, selection: JSON.parse(r.selection_json), priceCents: r.price_cents, currency: r.currency, availability: r.availability });
// The stored "why this was chosen", if the choice came from a family-fit search (see needSnapshot).
function rowNeed(r) {
  if (!r?.need_json) return null;
  try { return JSON.parse(r.need_json); } catch { return null; }
}

/**
 * What a family-fit result carries into a family choice. It comes only from this server's draft of a judged search
 * result, never from the page:
 * - category and mustHaves: the need the adult set, as the catalog listed it;
 * - check: what the catalog reported for this item;
 * - search: the planning price ceiling, date and one-off amount it was found under.
 */
function needSnapshot(fit, checkedAt) {
  const spec = fit.needSpec;
  return {
    category: spec.category ? { slug: spec.category.slug, title: spec.category.title, path: [...spec.category.path] } : null,
    mustHaves: spec.mustHaves.map(({ key, name, accepted, allowed }) => ({ key, name, accepted: [...accepted], allowed: [...allowed] })),
    check: checkOf(fit.check, checkedAt),
    search: { ceilingCents: fit.context.ceilingCents, targetDate: fit.context.targetDate, reserveCents: fit.context.reserveCents, on: fit.context.on },
  };
}
const checkOf = (result, checkedAt) => ({
  status: result.status, category: result.category.status,
  mustHaves: result.mustHaves.map(({ key, found, status }) => ({ key, found: [...found], status })), checkedAt,
});
// The same need checked against newer catalog facts (an explicit price check, or the item seen again).
const recheckNeed = (need, catalog, checkedAt) => ({ ...need, check: checkOf(matchNeed(catalog, need), checkedAt) });
const choiceRows = (db, goalId) => db.prepare('SELECT * FROM family_choices WHERE goal_id = ? ORDER BY added_at, rowid').all(goalId);
const goalOf = (db, householdId, goalId) => {
  const goal = getGoal(db, goalId);
  if (!goal || goal.householdId !== householdId) throw fail(404, 'not_found', 'Goal not found.');
  return goal;
};
const needAdult = (actor) => { if (actor.role !== 'adult') throw fail(403, 'adult_required', 'Only an adult in the family can do this.'); };
function needChoiceId(value) {
  if (typeof value !== 'string' || !CHOICE_ID.test(value)) throw fail(400, 'invalid_choice', 'Choose one of the family choices.');
  return value;
}

/** Opaque optimistic-concurrency token over every input of the comparison except preferences. Not an authorization. */
export function choicesRevision({ householdId, goal, progressCents, today, choices, offers }) {
  const facts = ['family-choices-v1', householdId, goal.id, goal.name, goal.currency, goal.targetCents, goal.targetDate, goal.weeklyBudgetCents, progressCents, today,
    choices.map((c) => [c.id, c.priceCents, c.currency, c.availability, c.condition, c.checkedAt, c.selection, c.need?.check?.status ?? null]), offers.map((o) => [o.memberId, o.weeklyCents])];
  return `fc1_${createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)}`;
}

// Offers from adults who still have access, in member order; a removed member's offer no longer counts.
function activeOffers(db, goalId, byId) {
  return db.prepare('SELECT member_id, weekly_cents, updated_at FROM family_offers WHERE goal_id = ?').all(goalId)
    .filter((o) => byId.get(o.member_id)?.role === 'adult')
    .sort((a, b) => byId.get(a.member_id).order - byId.get(b.member_id).order)
    .map((o) => ({ memberId: o.member_id, name: byId.get(o.member_id).name, weeklyCents: o.weekly_cents, updatedAt: o.updated_at }));
}
const membersById = (db, householdId, family) => new Map(activeMembers(db, householdId, family).map((m, i) => [m.id, { ...m, order: i }]));

/** What the page shows: the shortlist, the adults' offers, members' preferences and the comparison at no one-off amount. */
export function familyChoicesView(db, { householdId, goal, progress, today, now, family }) {
  const byId = membersById(db, householdId, family);
  const choices = choiceRows(db, goal.id).map((r) => ({
    id: r.id, productId: r.product_id, title: r.title, merchant: r.merchant, priceCents: r.price_cents, currency: r.currency, availability: r.availability,
    condition: r.condition, selection: JSON.parse(r.selection_json), checkedAt: r.checked_at, addedBy: r.added_by,
    fresh: Boolean(r.draft_id) && now - Date.parse(r.checked_at) <= FRESH_MS,
    need: rowNeed(r),
  }));
  const offers = activeOffers(db, goal.id, byId);
  const ids = new Set(choices.map((c) => c.id));
  const preferences = db.prepare('SELECT member_id, choice_id FROM family_preferences WHERE goal_id = ?').all(goal.id)
    .filter((p) => byId.has(p.member_id) && ids.has(p.choice_id))
    .sort((a, b) => byId.get(a.member_id).order - byId.get(b.member_id).order)
    .map((p) => ({ memberId: p.member_id, choiceId: p.choice_id }));
  const input = choicesInput({ goal, progress, today, choices, offers });
  return {
    today, maxChoices: MAX_CHOICES, freshMinutes: FRESH_MS / 60_000,
    revision: choicesRevision({ householdId, goal, progressCents: progress.progressCents, today, choices, offers }),
    choices, offers, preferences,
    comparison: compareChoices(input),
  };
}

/**
 * Save a merchant result the server showed as a family choice. The same offer refreshes its existing line. Otherwise:
 * - with fewer than three choices it is added;
 * - when the shortlist is full, it replaces one named choice, or the request is refused.
 */
export function addChoice(db, { householdId, goalId, actor, expectedGoalId, item, draftId, replaceId }, clock) {
  needAdult(actor);
  const goal = goalOf(db, householdId, goalId);
  if (expectedGoalId !== goal.id) throw fail(409, 'goal_changed', 'The goal changed since this search. Search again before adding a choice.');
  if (!item?.usable || item.currency !== goal.currency || !Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || typeof item.url !== 'string') {
    throw fail(400, 'merchant_price_unusable', 'This result has no usable price in the goal currency, so it cannot be a family choice.');
  }
  const replacing = replaceId === undefined || replaceId === null ? null : needChoiceId(replaceId);
  const facts = [item.title, item.merchant, item.url, item.priceCents, item.currency, item.availability ?? null, item.condition ?? null,
    JSON.stringify(selectionOf(item.selection)), item.checkedAt, draftId];
  // A family-fit result brings its need and check. An ordinary result for a choice that has a need is checked against it,
  // unless a newer read replaced the facts it was read with: then it carries none, and the choice keeps its latest check.
  const found = item.fit ? needSnapshot(item.fit, item.checkedAt) : null;
  return transaction(db, () => {
    const rows = choiceRows(db, goal.id);
    const same = rows.find((r) => identityOf(rowItem(r)) === identityOf(item));
    if (same) {
      const earlier = rowNeed(same);
      const need = found ?? (earlier && item.catalog ? recheckNeed(earlier, item.catalog, item.checkedAt) : earlier);
      db.prepare(`UPDATE family_choices SET title = ?, merchant = ?, url = ?, price_cents = ?, currency = ?, availability = ?, condition = ?,
        selection_json = ?, checked_at = ?, draft_id = ?, need_json = ? WHERE id = ?`).run(...facts, need ? JSON.stringify(need) : null, same.id);
      return { choiceId: same.id, outcome: 'updated' };
    }
    if (replacing) {
      if (!rows.some((r) => r.id === replacing)) throw fail(409, 'choice_gone', 'That choice was already removed. Review the latest choices.');
      db.prepare('DELETE FROM family_choices WHERE id = ?').run(replacing); // its preferences go with it
    } else if (rows.length >= MAX_CHOICES) {
      throw fail(409, 'choices_full', `The family already has ${MAX_CHOICES} choices. Replace one to add this item.`);
    }
    const id = `fc_${randomBytes(12).toString('hex')}`;
    db.prepare(`INSERT INTO family_choices (id, household_id, goal_id, product_id, title, merchant, url, price_cents, currency, availability, condition,
      selection_json, checked_at, draft_id, added_by, added_at, need_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, householdId, goal.id, item.productId, ...facts, actor.memberId, clock.iso(), found ? JSON.stringify(found) : null);
    return { choiceId: id, outcome: replacing ? 'replaced' : 'added' };
  });
}

export function removeChoice(db, { householdId, goalId, actor, choiceId }) {
  needAdult(actor);
  const id = needChoiceId(choiceId);
  goalOf(db, householdId, goalId);
  const removed = db.prepare('DELETE FROM family_choices WHERE id = ? AND goal_id = ? AND household_id = ?').run(id, goalId, householdId).changes;
  if (removed !== 1) throw fail(404, 'choice_gone', 'That choice was already removed.');
  return { removed: true };
}

/** An adult's own weekly offer: a ceiling they choose to show the family, never someone else's and never money moved. */
export function saveOffer(db, { householdId, goalId, actor, weeklyCents }, clock) {
  needAdult(actor);
  if (!Number.isSafeInteger(weeklyCents) || weeklyCents < OFFER_LIMITS.minCents || weeklyCents > OFFER_LIMITS.maxCents) {
    throw fail(400, 'invalid_offer', 'Offer a weekly amount between $1.00 and $100,000.00.');
  }
  goalOf(db, householdId, goalId);
  db.prepare(`INSERT INTO family_offers (goal_id, member_id, weekly_cents, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(goal_id, member_id) DO UPDATE SET weekly_cents = excluded.weekly_cents, updated_at = excluded.updated_at`).run(goalId, actor.memberId, weeklyCents, clock.iso());
  return { saved: true };
}

export function withdrawOffer(db, { householdId, goalId, actor }) {
  needAdult(actor);
  goalOf(db, householdId, goalId);
  return { withdrawn: db.prepare('DELETE FROM family_offers WHERE goal_id = ? AND member_id = ?').run(goalId, actor.memberId).changes === 1 };
}

/** A member's own preference, child or adult. One at a time; it is a preference, never an approval or a payment. */
export function setPreference(db, { householdId, goalId, actor, choiceId }, clock) {
  const id = needChoiceId(choiceId);
  goalOf(db, householdId, goalId);
  if (!db.prepare('SELECT 1 FROM family_choices WHERE id = ? AND goal_id = ? AND household_id = ?').get(id, goalId, householdId)) {
    throw fail(404, 'choice_gone', 'That choice was removed. Review the latest choices.');
  }
  db.prepare(`INSERT INTO family_preferences (goal_id, member_id, choice_id, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(goal_id, member_id) DO UPDATE SET choice_id = excluded.choice_id, updated_at = excluded.updated_at`).run(goalId, actor.memberId, id, clock.iso());
  return { saved: true };
}

export function removePreference(db, { householdId, goalId, actor }) {
  goalOf(db, householdId, goalId);
  return { removed: db.prepare('DELETE FROM family_preferences WHERE goal_id = ? AND member_id = ?').run(goalId, actor.memberId).changes === 1 };
}

export function needReserve(value) {
  const cents = value ?? 0;
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > RESERVE_LIMITS.maxCents) throw fail(400, 'invalid_one_off', 'Try a one-off amount between $0.00 and $100,000.00.');
  return cents;
}

/**
 * The family schedule for a goal at these offers and one-off amount (familySchedule), with a revision over every figure
 * in it. The page shows this answer; saving it later must reproduce the same revision from the server's own records.
 */
export function scheduleFor({ goal, progress, today, offers, reserveCents }) {
  const schedule = familySchedule({ today, targetDate: goal.targetDate, progressCents: progress.progressCents, targetCents: goal.targetCents,
    householdLimitCents: goal.weeklyBudgetCents, currency: goal.currency, offers, reserveCents });
  const facts = ['family-schedule-v1', today, goal.currency, goal.targetCents, goal.targetDate, goal.weeklyBudgetCents, progress.progressCents, reserveCents,
    offers.map((o) => [o.memberId, o.weeklyCents]), schedule.rows.map((r) => [r.date, r.goalCents, r.reservedCents, r.perMember.map((p) => [p.memberId, p.cents])])];
  return { ...schedule, revision: `fs1_${createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)}` };
}

/** Why a schedule with nothing in it cannot be proposed, in the family's terms ({ code, message }), or null when it can. */
export function unschedulable(schedule) {
  const f = (cents) => formatCents(cents, schedule.currency);
  const why = (code, message) => ({ code, message });
  switch (schedule.outcome) {
    case 'reached': return why('goal_reached', 'Tracked progress already covers this goal, so there is nothing to schedule.');
    case 'no_offers': return why('no_offers', 'An adult needs to offer a weekly amount before a family schedule can be made.');
    case 'no_capacity': return why('no_capacity', `The household’s weekly amount is ${f(0)}, so nothing can be scheduled.`);
    case 'date_passed': return why('date_too_soon', 'The goal’s date is less than a week away, so no weekly schedule fits. Choose a later date first.');
    case 'nothing_planned': return why('nothing_planned', `The one-off ${f(schedule.reserve.cents)} takes every week’s amount up to the goal’s date, so nothing would go to the goal. Choose a later date or a smaller amount first.`);
    default: return null;
  }
}

/**
 * The facts a family schedule rests on beyond the goal's own: the active adults' offers and, when it came from a family
 * choice, that choice's current price. A proposal is usable only while these still hold.
 */
export function familyFacts(db, { householdId, goalId, family, choiceId = null }) {
  const offers = activeOffers(db, goalId, membersById(db, householdId, family)).map((o) => ({ memberId: o.memberId, name: o.name, weeklyCents: o.weeklyCents }));
  if (!choiceId) return { offers, choice: null };
  const row = db.prepare('SELECT * FROM family_choices WHERE id = ? AND goal_id = ?').get(choiceId, goalId);
  return { offers, choice: row ? { id: row.id, title: row.title, identity: identityOf(rowItem(row)), priceCents: row.price_cents, currency: row.currency,
    needStatus: rowNeed(row)?.check?.status ?? null } : { id: choiceId, removed: true } };
}

/** What changed in those facts, in plain words. Empty when nothing did. */
export function describeFamilyChanges(was, now, currency) {
  const f = (cents) => formatCents(cents, currency);
  const changes = [];
  const before = new Map(was.offers.map((o) => [o.memberId, o])), after = new Map(now.offers.map((o) => [o.memberId, o]));
  for (const o of was.offers) {
    const n = after.get(o.memberId);
    if (!n) changes.push({ code: 'offer_ended', message: `${o.name}’s weekly offer of ${f(o.weeklyCents)} no longer counts: it was withdrawn or their access ended.` });
    else if (n.weeklyCents !== o.weeklyCents) changes.push({ code: 'offer_changed', message: `${o.name}’s weekly offer changed from ${f(o.weeklyCents)} to ${f(n.weeklyCents)}.` });
  }
  for (const n of now.offers) if (!before.has(n.memberId)) changes.push({ code: 'offer_added', message: `${n.name} now offers ${f(n.weeklyCents)} a week.` });
  if (was.choice) {
    const c = now.choice;
    if (!c || c.removed || c.identity !== was.choice.identity) changes.push({ code: 'choice_changed', message: `The family choice this schedule came from (${was.choice.title}) was removed or replaced.` });
    else if (c.priceCents !== was.choice.priceCents || c.currency !== was.choice.currency) {
      changes.push({ code: 'price_changed', message: `${was.choice.title} now shows ${formatCents(c.priceCents, c.currency)}; this schedule used ${formatCents(was.choice.priceCents, was.choice.currency)}.` });
    }
    if (c && !c.removed && (c.needStatus ?? null) !== (was.choice.needStatus ?? null)) {
      changes.push({ code: 'need_changed', message: c.needStatus === 'misses' ? `${was.choice.title} no longer meets the family’s must-haves at its latest check.`
        : `What the catalog reports for ${was.choice.title}’s must-haves changed at its latest check.` });
    }
  }
  return changes;
}

const NO_CEILING = {
  no_offers: [409, 'no_offers', 'An adult needs to offer a weekly amount before options can be matched to the family’s date. Ordinary search still works.'],
  no_capacity: [409, 'no_capacity', 'The household’s weekly amount is $0.00, so no price can be planned by the goal’s date. Ordinary search still works.'],
  date_passed: [409, 'date_too_soon', 'The goal’s date is less than a week away, so no weekly amounts fit before it. Choose a later date first.'],
  below_minimum: [409, 'ceiling_too_low', 'At these offers and this one-off amount, less than $1.00 can be planned by the goal’s date, so there is nothing to search for.'],
};

/**
 * The family-fit context for one search: the comparison the adult saw must be the current one, and the planning price
 * ceiling comes from the server's own goal, progress, offers and date (fitCeiling), with the one-off amount the adult
 * entered. The page never supplies the ceiling, the offers or the date. Nothing is written.
 */
export function fitContext(db, { householdId, goal, progress, today, now, family, reserveCents, revision, budgetCents = null }) {
  const reserve = needReserve(reserveCents);
  if (budgetCents !== null && (!Number.isSafeInteger(budgetCents) || budgetCents < 100 || budgetCents > 10_000_000)) {
    throw fail(400, 'invalid_budget', 'A price limit must be between $1.00 and $100,000.00, or left empty.');
  }
  const view = familyChoicesView(db, { householdId, goal, progress, today, now, family });
  if (revision !== view.revision) throw fail(409, 'choices_changed', 'The family’s offers, goal or progress changed. Search again with the latest figures.');
  if (goal.currency !== 'USD') throw fail(409, 'currency_unsupported', 'Market Town searches in USD, and this goal is kept in another currency.');
  const ceiling = fitCeiling({ today, targetDate: goal.targetDate, progressCents: progress.progressCents, householdLimitCents: goal.weeklyBudgetCents,
    offers: view.offers, reserveCents: reserve, budgetCents });
  if (ceiling.outcome !== 'ok') throw fail(...NO_CEILING[ceiling.outcome]);
  return { view, ceiling, reserveCents: reserve };
}

/** When a suitable item would be finished at the same offers, one-off amount and date: the comparison's own arithmetic. */
export function fitFinish({ goal, progress, today, offers, reserveCents }, priceCents) {
  const s = familySchedule({ today, targetDate: goal.targetDate, progressCents: progress.progressCents, targetCents: priceCents,
    householdLimitCents: goal.weeklyBudgetCents, currency: goal.currency, offers, reserveCents });
  return { finishDate: s.outcome === 'reached' ? null : s.finishDate, finishWeek: s.outcome === 'reached' ? 0 : s.finishWeek, covered: s.outcome === 'reached' };
}

/**
 * "Review this choice": check the comparison the adult saw against the server's own records. It writes nothing. The
 * answer is a trusted goal draft for the existing Plan form, which the adult may still change before saving.
 * - The comparison inputs must be unchanged since the adult looked.
 * - The item's draft must still be alive and identical: this server's own copy, not a price from the page.
 * - The one-off amount is the adult's own trial, recomputed here.
 */
export function reviewChoice(db, { householdId, goal, progress, today, now, family, actor, choiceId, revision, reserveCents, draftFor }) {
  needAdult(actor);
  const id = needChoiceId(choiceId);
  const reserve = needReserve(reserveCents);
  const view = familyChoicesView(db, { householdId, goal, progress, today, now, family });
  if (revision !== view.revision) throw fail(409, 'choices_changed', 'The family’s choices or offers changed. Review the latest comparison, then choose again.');
  const choice = view.choices.find((c) => c.id === id);
  if (!choice) throw fail(404, 'choice_gone', 'That choice was removed. Review the latest choices.');
  if (!view.offers.length) throw fail(409, 'no_offers', 'An adult needs to offer a weekly amount before a choice can be reviewed.');
  const row = db.prepare('SELECT * FROM family_choices WHERE id = ?').get(id);
  let item = null;
  try { item = choice.fresh ? draftFor(row.draft_id) : null; } catch { item = null; }
  const stored = rowItem(row);
  if (!item || identityOf(item) !== identityOf(stored) || item.priceCents !== stored.priceCents || item.currency !== stored.currency || item.availability !== stored.availability) {
    throw fail(409, 'choice_needs_check', 'Check this item’s price again before choosing it. Prices and stock change.');
  }
  const comparison = compareChoices(choicesInput({ goal, progress, today, choices: view.choices, offers: view.offers, reserveCents: reserve }));
  const option = comparison.options.find((o) => o.id === id);
  // Keep the goal's date when the choice is on time; otherwise offer the earliest finish these offers reach.
  const targetDate = option.status === 'late' ? option.finishDate : goal.targetDate;
  const draftGoal = { targetCents: item.priceCents, targetDate, weeklyBudgetCents: comparison.capacityCents };
  // The dated weeks "Save goal and propose this schedule" would propose if the adult saves this draft unchanged. A preview:
  // the save recomputes it from the server's records and refuses it unless every figure is still the same.
  const schedule = scheduleFor({ goal: { ...goal, ...draftGoal }, progress, today, offers: view.offers, reserveCents: reserve });
  const blocked = unschedulable(schedule);
  const { catalog, fit, ...shownItem } = item; // the catalog's raw facts stay on the server; the choice's need is shown instead
  return {
    status: 'ok', saved: false, choiceId: id, revision: view.revision, reserveCents: reserve, need: choice.need,
    item: { ...shownItem, draftId: row.draft_id },
    goal: draftGoal, startingCents: progress.startingCents,
    option, deadline: goal.targetDate,
    schedule: { ...schedule, proposable: !blocked, reason: blocked?.message ?? null },
  };
}

/**
 * The existing "Save as our goal" from a family choice: the draft must be that choice's own, and the comparison
 * unchanged since review. Called before the ordinary merchant goal save, which keeps all of its own checks.
 */
export function checkChoiceForSave(db, { householdId, goal, progress, today, now, family, familyChoice, draftId, item }) {
  if (!familyChoice || typeof familyChoice !== 'object') throw fail(400, 'invalid_choice', 'Review the family choice again before saving.');
  const id = needChoiceId(familyChoice.choiceId);
  const view = familyChoicesView(db, { householdId, goal, progress, today, now, family });
  const row = db.prepare('SELECT * FROM family_choices WHERE id = ? AND goal_id = ?').get(id, goal.id);
  if (!row || familyChoice.revision !== view.revision || row.draft_id !== draftId || identityOf(item) !== identityOf(rowItem(row)) || item.priceCents !== row.price_cents) {
    throw fail(409, 'choices_changed', 'The family’s choices, offers or prices changed since this review. Review the choice again before saving.');
  }
}

/** The explicit "Check price" for one choice: a fresh merchant look-up through the existing bounded refresh. */
export async function refreshChoice(db, { householdId, goalId, actor, choiceId, refresh }) {
  needAdult(actor);
  const id = needChoiceId(choiceId);
  const goal = goalOf(db, householdId, goalId);
  const before = db.prepare('SELECT * FROM family_choices WHERE id = ? AND goal_id = ?').get(id, goalId);
  if (!before) throw fail(404, 'choice_gone', 'That choice was removed.');
  const found = await refresh({ ...rowItem(before), query: before.title });
  const fresh = found.results?.[0] ?? null;
  return transaction(db, () => {
    // Read again after the provider wait: the choice may have been removed or replaced meanwhile.
    const row = db.prepare('SELECT * FROM family_choices WHERE id = ? AND goal_id = ?').get(id, goalId);
    if (!row) throw fail(409, 'choice_gone', 'That choice was removed while its price was being checked.');
    const usable = fresh?.usable && fresh.draftId && fresh.currency === goal.currency && identityOf(fresh) === identityOf(rowItem(row));
    // A choice found for the family's need is checked against the catalog's newer facts. If it no longer meets a
    // must-have, that is what it shows, whether or not the price is still usable. An answer without current facts (one
    // older than a newer read that replaced them) leaves the latest check as it is.
    const earlier = rowNeed(row);
    const need = earlier && fresh?.catalog && identityOf(fresh) === identityOf(rowItem(row)) ? recheckNeed(earlier, fresh.catalog, fresh.checkedAt) : earlier;
    if (need !== earlier) db.prepare('UPDATE family_choices SET need_json = ? WHERE id = ?').run(JSON.stringify(need), id);
    const needStatus = need?.check?.status ?? null;
    if (!usable) {
      // The last seen price stays, with its own time; it can be chosen only after a check that finds it usable again.
      db.prepare('UPDATE family_choices SET draft_id = NULL WHERE id = ?').run(id);
      return { choiceId: id, usable: false, reason: fresh?.unusableReason ?? 'This item could not be checked. Choose another item.', needStatus };
    }
    db.prepare('UPDATE family_choices SET title = ?, url = ?, price_cents = ?, availability = ?, checked_at = ?, draft_id = ? WHERE id = ?')
      .run(fresh.title, fresh.url, fresh.priceCents, fresh.availability ?? null, fresh.checkedAt, fresh.draftId, id);
    return { choiceId: id, usable: true, previousPriceCents: row.price_cents, priceCents: fresh.priceCents, needStatus };
  });
}
