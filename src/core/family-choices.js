// Family choices: up to three items compared against the family's own weekly offers, the household's weekly amount and
// the goal's date. Pure whole-cent and calendar arithmetic, shared by the server (the canonical comparison and its checks)
// and the page (an unsaved one-off trial).
// - An offer is a weekly ceiling an adult chose to show the family, not income or a promise.
// - Tracked progress is not money to spend.
// - Nothing here saves, pays or grants anything.

export const MAX_CHOICES = 3;
export const MAX_WEEKS = 52; // the existing planning limit
export const OFFER_LIMITS = Object.freeze({ minCents: 100, maxCents: 10_000_000 });
export const RESERVE_LIMITS = Object.freeze({ maxCents: 10_000_000 });

// The same UTC calendar arithmetic the server's planner uses (server/household.mjs).
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function daysBetween(fromIso, toIso) {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(toIso) - parse(fromIso)) / 86400000);
}
const wholeCents = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Split one week's goal amount among the adults who offered, in proportion to their offers.
 * 1. Each adult first gets the whole-cent floor of their exact share.
 * 2. Any cents left go one each to the largest remainders, ties to the earlier adult in the list.
 * Nobody is given more than their offer. This is a rounding rule, not a judgement of what is fair.
 */
export function splitWeek(totalCents, offers) {
  const offered = offers.reduce((sum, o) => sum + o.weeklyCents, 0);
  if (!wholeCents(totalCents) || totalCents > offered) throw new RangeError('A week cannot go beyond what the adults offered.');
  if (totalCents === 0) return offers.map((o) => ({ memberId: o.memberId, cents: 0 }));
  const shares = offers.map((o, index) => {
    const exact = totalCents * o.weeklyCents; // the share is exact / offered
    return { memberId: o.memberId, cents: Math.floor(exact / offered), remainder: exact % offered, index };
  });
  let left = totalCents - shares.reduce((sum, s) => sum + s.cents, 0);
  for (const s of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left === 0) break;
    s.cents += 1;
    left -= 1;
  }
  return shares.map(({ memberId, cents }) => ({ memberId, cents }));
}

/**
 * The weekly amounts open to the goal. Each week it is the lower of the household's weekly amount and the adults'
 * offers. A one-off expense is first set aside from the earliest weeks, once, until it is covered.
 */
export function weeklyCapacity({ householdLimitCents, offers, reserveCents = 0, weeks = MAX_WEEKS }) {
  const offeredCents = offers.reduce((sum, o) => sum + o.weeklyCents, 0);
  const capacityCents = Math.min(householdLimitCents, offeredCents);
  let left = reserveCents;
  const available = [], reserved = [];
  for (let w = 0; w < weeks; w++) {
    const set = Math.min(left, capacityCents);
    left -= set;
    reserved.push(set);
    available.push(capacityCents - set);
  }
  return { offeredCents, capacityCents, available, reserved, reserveLeftCents: left };
}

function checkInputs({ today, deadline, progressCents, householdLimitCents, currency, offers, options, reserveCents }) {
  if (!isIsoDate(today) || !isIsoDate(deadline)) throw new RangeError('Dates must be calendar dates.');
  if (!Number.isSafeInteger(progressCents) || !wholeCents(householdLimitCents) || typeof currency !== 'string') throw new RangeError('Amounts must be whole cents.');
  if (!wholeCents(reserveCents) || reserveCents > RESERVE_LIMITS.maxCents) throw new RangeError('The one-off amount is out of range.');
  if (!Array.isArray(offers) || !Array.isArray(options) || options.length > MAX_CHOICES + 1) throw new RangeError('Too many options.');
  const ids = new Set();
  for (const o of offers) {
    if (typeof o?.memberId !== 'string' || ids.has(o.memberId) || !Number.isSafeInteger(o.weeklyCents)
      || o.weeklyCents < OFFER_LIMITS.minCents || o.weeklyCents > OFFER_LIMITS.maxCents) throw new RangeError('Each offer needs one member and whole cents.');
    ids.add(o.memberId);
  }
}

/**
 * The whole comparison, at the earliest finish each option can reach with these weekly ceilings. Every week puts its
 * full open amount toward the option until the last week, which takes exactly what remains.
 * @param input.today the server's date; week 1 is seven days later
 * @param input.deadline the goal's target date
 * @param input.progressCents tracked goal progress, which lowers what remains but is not money to spend
 * @param input.householdLimitCents the goal's chosen weekly amount
 * @param input.offers [{ memberId, name, weeklyCents }] for the adults with an offer, in member order
 * @param input.options [{ id, priceCents, currency }] the current goal and up to three items
 * @param input.reserveCents a one-off expense to try (0 for none)
 */
export function compareChoices(input) {
  const { today, deadline, progressCents, householdLimitCents, currency, offers, options, reserveCents = 0 } = input;
  checkInputs({ ...input, reserveCents });
  const capacity = weeklyCapacity({ householdLimitCents, offers, reserveCents });
  const days = daysBetween(today, deadline);
  const deadlineWeek = days < 0 ? 0 : Math.min(MAX_WEEKS, Math.floor(days / 7));
  const dates = Array.from({ length: MAX_WEEKS }, (_, i) => addDays(today, 7 * (i + 1)));
  const reserveWeeks = capacity.reserved.filter((c) => c > 0).length;
  const limitedBy = capacity.capacityCents === 0 ? (capacity.offeredCents === 0 ? 'no_offers' : 'household')
    : householdLimitCents < capacity.offeredCents ? 'household' : householdLimitCents > capacity.offeredCents ? 'offers' : 'both';
  return {
    today, deadline, deadlineWeek, deadlinePassed: days < 0, currency,
    householdLimitCents, offeredCents: capacity.offeredCents, capacityCents: capacity.capacityCents, limitedBy,
    reserve: {
      cents: reserveCents,
      weeks: reserveWeeks,
      // The week the one-off amount is fully covered, or null if it is not covered within the planning limit.
      coveredWeek: reserveCents > 0 && capacity.reserveLeftCents === 0 ? reserveWeeks : null,
      uncoveredCents: capacity.reserveLeftCents,
    },
    offers: offers.map(({ memberId, name, weeklyCents }) => ({ memberId, name: name ?? null, weeklyCents })),
    options: options.map((option) => forecastOption(option, { progressCents, capacity, offers, dates, deadlineWeek, currency })),
  };
}

function forecastOption(option, { progressCents, capacity, offers, dates, deadlineWeek, currency }) {
  const base = { id: option.id, priceCents: option.priceCents ?? null };
  if (option.currency !== currency || !Number.isSafeInteger(option.priceCents) || option.priceCents <= 0) {
    return { ...base, status: 'not_comparable', remainingCents: null, finishWeek: null, finishDate: null, fits: false, shortfallCents: null, weeksLate: null, segments: [] };
  }
  const remainingCents = Math.max(0, option.priceCents - progressCents);
  if (remainingCents === 0) return { ...base, status: 'covered', remainingCents, finishWeek: 0, finishDate: null, fits: true, shortfallCents: 0, weeksLate: 0, segments: [] };
  if (capacity.capacityCents === 0) {
    return { ...base, status: 'no_capacity', remainingCents, finishWeek: null, finishDate: null, fits: false, shortfallCents: remainingCents, weeksLate: null, segments: [] };
  }
  const weeks = [];
  let total = 0, byDeadline = 0, finishWeek = null;
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const cents = Math.min(capacity.available[w - 1], remainingCents - total);
    total += cents;
    if (w <= deadlineWeek) byDeadline += cents;
    weeks.push({ week: w, cents, reservedCents: capacity.reserved[w - 1] });
    if (total === remainingCents) { finishWeek = w; break; }
  }
  const shortfallCents = remainingCents - byDeadline;
  const status = finishWeek === null ? 'beyond_limit' : finishWeek <= deadlineWeek ? 'fits' : 'late';
  return {
    ...base, status, remainingCents, finishWeek, finishDate: finishWeek ? dates[finishWeek - 1] : null,
    fits: shortfallCents === 0, shortfallCents, weeksLate: finishWeek !== null && finishWeek > deadlineWeek ? finishWeek - deadlineWeek : 0,
    segments: segmentsOf(weeks, offers, dates),
  };
}

// Consecutive weeks with the same amounts read as one line: "weeks 4–6", then the last week's exact remainder.
function segmentsOf(weeks, offers, dates) {
  const segments = [];
  for (const w of weeks) {
    const last = segments.at(-1);
    if (last && last.goalCents === w.cents && last.reservedCents === w.reservedCents) { last.toWeek = w.week; last.toDate = dates[w.week - 1]; continue; }
    segments.push({ fromWeek: w.week, toWeek: w.week, fromDate: dates[w.week - 1], toDate: dates[w.week - 1], goalCents: w.cents, reservedCents: w.reservedCents,
      perMember: splitWeek(w.cents, offers) });
  }
  return segments;
}

/**
 * The comparison's inputs from a goal, its progress, the shortlist and the offers, built the same way on the server and
 * the page. The current goal is a reference line beside the items, so the comparison also works without the merchant.
 */
export function choicesInput({ goal, progress, today, choices, offers, reserveCents = 0 }) {
  return {
    today, deadline: goal.targetDate, progressCents: progress.progressCents, householdLimitCents: goal.weeklyBudgetCents, currency: goal.currency,
    offers: offers.map(({ memberId, name, weeklyCents }) => ({ memberId, name, weeklyCents })),
    options: [{ id: 'goal', priceCents: goal.targetCents, currency: goal.currency }, ...choices.map((c) => ({ id: c.id, priceCents: c.priceCents, currency: c.currency }))],
    reserveCents,
  };
}

/**
 * Plain sentences for the comparison, from its numbers only. `money(cents)` and `date(iso)` are the page's formatters;
 * `titles` maps option ids to names.
 */
export function describeComparison(comparison, { money, date, titles = {} }) {
  const c = comparison;
  const name = (id) => titles[id] ?? 'This choice';
  let capacity;
  if (c.limitedBy === 'no_offers') capacity = 'No adult has offered a weekly amount yet, so there is no finish date to show.';
  else if (c.capacityCents === 0) capacity = `The household’s weekly amount is ${money(0)}, so nothing more can be planned.`;
  else capacity = `Up to ${money(c.capacityCents)} a week can go to the goal: the lower of the household’s weekly amount (${money(c.householdLimitCents)}) and the adults’ offers (${money(c.offeredCents)}).`;
  let reserve = null;
  if (c.reserve.cents > 0) {
    if (c.capacityCents === 0) reserve = `A one-off ${money(c.reserve.cents)} would need weekly offers to cover it.`;
    else if (c.reserve.coveredWeek === null) reserve = `A one-off ${money(c.reserve.cents)} is not covered within ${MAX_WEEKS} weeks at these offers.`;
    else {
      const whole = c.reserve.cents % c.capacityCents === 0;
      reserve = `Trying a one-off ${money(c.reserve.cents)}: it comes out of the ${c.reserve.weeks === 1 ? 'first week' : `first ${c.reserve.weeks} weeks`}${whole ? '' : ' (the last of them partly)'}, once, before more goes to the goal. Recorded progress is not touched.`;
    }
  }
  const lines = Object.fromEntries(c.options.map((o) => [o.id, optionLine(o, c, { money, date })]));
  const onTime = c.options.filter((o) => o.status === 'fits' || o.status === 'covered');
  const later = c.options.filter((o) => o.status === 'late' || o.status === 'beyond_limit');
  let choices = null;
  if (later.length && onTime.length && !c.deadlinePassed) {
    choices = `Still on time for ${date(c.deadline)}: ${onTime.map((o) => `${name(o.id)} (${money(o.priceCents)})`).join(', ')}. `
      + `Later: ${later.map((o) => (o.finishDate ? `${name(o.id)}, finishing ${date(o.finishDate)}` : `${name(o.id)}, beyond ${MAX_WEEKS} weeks`)).join('; ')}.`;
  }
  return { capacity, reserve, lines, choices };
}

function optionLine(o, c, { money, date }) {
  switch (o.status) {
    case 'covered': return 'Tracked progress already covers this price. That progress is a record, not money in hand.';
    case 'fits': return `Finishes ${date(o.finishDate)} (week ${o.finishWeek}), on time for ${date(c.deadline)}.`;
    case 'late': return c.deadlinePassed
      ? `Finishes ${date(o.finishDate)} (week ${o.finishWeek}). The goal’s date (${date(c.deadline)}) has passed.`
      : `Finishes ${date(o.finishDate)} (week ${o.finishWeek}): ${o.weeksLate === 1 ? '1 week' : `${o.weeksLate} weeks`} after ${date(c.deadline)}, ${money(o.shortfallCents)} short by then.`;
    case 'beyond_limit': return `Needs more than ${MAX_WEEKS} weeks at these offers; ${money(o.shortfallCents)} short by ${date(c.deadline)}.`;
    case 'no_capacity': return c.limitedBy === 'no_offers' ? 'No finish date until an adult offers a weekly amount.' : `No finish date while the household’s weekly amount is ${money(0)}.`;
    default: return 'This price is not in the goal’s currency, so it is not compared.';
  }
}
