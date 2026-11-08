// A family schedule as a plan. Its weeks come from familySchedule (src/core/family-choices.js), using:
// - the family's own weekly offers;
// - the household's weekly amount;
// - one one-off amount an adult entered.
// Its text cites only those figures. No AI is involved. The untrusted AI plan schema (validate.mjs) is neither used nor
// widened: the server makes these plans, and it checks them against its own records when they are proposed and used.
import { formatCents } from '../../src/core/rules.js';
import { formatDate, projectMilestones } from './basis.mjs';

export const FAMILY_SOURCE_LABEL = 'Family schedule (built-in arithmetic from your family’s offers, no AI)';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] ?? String(n);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const weeksOf = (n) => `${word(n)} week${n === 1 ? '' : 's'}`;
const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const span = (rows) => (rows.length === 1 ? `week ${rows[0].week} (${shortDate(rows[0].date)})`
  : `weeks ${rows[0].week}–${rows.at(-1).week} (${shortDate(rows[0].date)}–${shortDate(rows.at(-1).date)})`);

/** What a stored family plan carries for the page and for later checks: every dated week, each adult's share and the inputs. */
export function familyPlanDetails(schedule, { choice = null } = {}) {
  return {
    reserveCents: schedule.reserve.cents,
    householdLimitCents: schedule.capacity.householdLimitCents,
    offeredCents: schedule.capacity.offeredCents,
    capacityCents: schedule.capacity.capacityCents,
    offers: schedule.offers.map(({ memberId, name, weeklyCents }) => ({ memberId, name, weeklyCents })),
    weeks: schedule.rows.map(({ week, date, goalCents, reservedCents, perMember }) => ({ week, date, goalCents, reservedCents, perMember })),
    outcome: schedule.outcome,
    finishWeek: schedule.finishWeek,
    finishDate: schedule.finishDate,
    choice,
    revision: schedule.revision,
  };
}

/** The plan body (finalizePlan's input) for a family schedule, with arithmetic that cites only these figures. */
export function familyPlanBody(basis, schedule) {
  const f = (cents) => formatCents(cents, basis.currency);
  const { rows, reserve, capacity } = schedule;
  const amounts = rows.map((r) => r.goalCents);
  const projections = projectMilestones(basis, amounts);
  const positive = amounts.filter((a) => a > 0);
  const distinct = [...new Set(positive)];
  const steady = distinct.length === 1 ? distinct[0] : null;
  const count = positive.length;
  const reserved = rows.filter((r) => r.reservedCents > 0);
  const partly = reserved.length > 0 && reserved.at(-1).goalCents > 0;
  const first = reserved.length === 1 ? 'the first week' : `the first ${weeksOf(reserved.length)}`;
  const reserveText = reserve.cents ? `${first}${partly ? ` (the last of them partly)` : ''}` : '';
  const lead = reserve.cents ? `After the one-off ${f(reserve.cents)}, ` : '';

  let headline;
  if (schedule.shortfallCents === 0) {
    headline = steady !== null
      ? `${lead}${lead ? weeksOf(count) : capital(weeksOf(count))} of ${f(steady)} reach${count === 1 ? 'es' : ''} the Castle`
      : `${lead}${lead ? 'this' : 'This'} family schedule reaches the Castle by week ${projections.at(-1).week}`;
  } else headline = `${f(schedule.shortfallCents)} short by ${formatDate(basis.planEndDate)}`;

  const summary = `You've tracked ${f(basis.progressCents)} of your ${f(basis.targetCents)} ${basis.goalName}. `
    + (schedule.shortfallCents === 0
      ? `This family schedule covers the remaining ${f(basis.remainingCents)} by ${formatDate(schedule.finishDate)}`
      : `This family schedule covers ${f(schedule.plannedCents)} by ${formatDate(basis.planEndDate)}, leaving ${f(schedule.shortfallCents)} to find`)
    + (reserve.cents ? `, after the one-off ${f(reserve.cents)} you entered takes ${reserveText}.` : '.');

  const offers = schedule.offers;
  const offersText = offers.length === 1 ? `${offers[0].name} ${f(offers[0].weeklyCents)}`
    : `${offers.map((o) => `${o.name} ${f(o.weeklyCents)}`).join(' + ')} = ${f(capacity.offeredCents)}`;
  const explanation = [
    `Goal ${f(basis.targetCents)} − tracked progress ${f(basis.progressCents)} = ${f(basis.remainingCents)} still to save.`,
    `Each week up to ${f(capacity.capacityCents)} can go to the goal: the lower of the household’s weekly amount (${f(capacity.householdLimitCents)}) and the adults’ own offers (${offersText}).`,
  ];
  if (reserve.cents) {
    explanation.push(`The one-off ${f(reserve.cents)} comes out of ${span(reserved)} first, once. It is not taken from tracked progress and not repeated.`);
  }
  explanation.push('Each week’s goal amount is split between the adults in proportion to their offers, in whole cents (leftover cents go to the largest remainders). No one’s share is above their own offer.');
  explanation.push(`The schedule totals ${f(schedule.plannedCents)}, so the shortfall is ${f(schedule.shortfallCents)}.`);

  const milestoneNotes = projections.map((p) => ({
    milestone: p.key,
    note: p.reached ? `${p.name} (${f(p.targetCents)}) is already reached.`
      : p.week ? `${p.name} (${f(p.targetCents)}) is ${f(p.awayCents)} away, reached in week ${p.week}.`
        : `${p.name} (${f(p.targetCents)}) is not reached by this schedule.`,
  }));

  const cautions = [
    `Made by the app’s own arithmetic from your family’s offers${reserve.cents ? ' and the one-off amount you entered' : ''}. Not an AI plan.`,
    'An offer is a weekly ceiling an adult chose to show the family, not a promise or income. Nothing is held or set aside in the app, and nothing is paid automatically: each contribution needs an adult’s approval in PayPal.',
    'This tracks progress toward one goal. It is not a bank balance or savings account.',
  ];
  if (schedule.shortfallCents > 0) {
    cautions.push(schedule.finishDate
      ? `At these offers the earliest finish is ${formatDate(schedule.finishDate)}. A later date is the family’s choice to review; no one’s offer is raised.`
      : `At these offers the goal is not reached within 52 weeks. No one’s offer is raised.`);
  }
  if (reserve.cents) cautions.push('The app does not know whether the one-off expense is paid. If it changes, propose a new family schedule with the amount still needed; this one stays as it is.');

  return {
    headline,
    summary,
    explanation,
    milestoneNotes,
    cautions,
    contributions: rows.map((r) => ({
      week: r.week, date: r.date, amountCents: r.goalCents,
      note: r.reservedCents === 0 ? '' : r.goalCents === 0 ? `This week’s ${f(r.reservedCents)} goes to the one-off expense.` : `${f(r.reservedCents)} goes to the one-off expense first.`,
    })),
  };
}
