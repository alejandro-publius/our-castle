import { formatCents } from '../../src/core/rules.js';
import { allowedAmounts, projectMilestones } from './basis.mjs';

const MILESTONE_KEYS = new Set(['manor', 'keep', 'castle']);
const DOLLARS = /\$\s?((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{2}))?(?!\d)/g;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Dollar figures mentioned in prose, as integer cents. */
export function dollarFigures(text) {
  const found = [];
  for (const match of text.matchAll(DOLLARS)) {
    found.push(Number(match[1].replaceAll(',', '')) * 100 + Number(match[2] ?? 0));
  }
  return found;
}

/**
 * Validate a structured plan proposed by an AI provider against the server's own arithmetic.
 * Returns { ok, issues[] }. Nothing from the provider is trusted until this passes.
 */
export function validateAiPlan(output, basis) {
  const issues = [];
  const issue = (code, message) => issues.push({ code, message });
  if (!isPlainObject(output)) {
    issue('shape', 'The planner did not return a plan object.');
    return { ok: false, issues };
  }
  if (!isText(output.headline, 140)) issue('shape', 'The plan needs a short headline.');
  if (!isText(output.summary, 800)) issue('shape', 'The plan needs a summary under 800 characters.');
  const textLists = { explanation: [1, 10], cautions: [0, 6] };
  for (const [key, [min, max]] of Object.entries(textLists)) {
    const list = output[key];
    if (!Array.isArray(list) || list.length < min || list.length > max || !list.every((s) => isText(s, 300))) {
      issue('shape', `“${key}” must be a list of ${min}–${max} short sentences.`);
    }
  }
  if (!Array.isArray(output.milestoneNotes) || output.milestoneNotes.length > 3
    || !output.milestoneNotes.every((n) => isPlainObject(n) && MILESTONE_KEYS.has(n.milestone) && isText(n.note, 300))) {
    issue('shape', 'Milestone notes must name manor, keep or castle with a short note.');
  }

  const list = output.contributions;
  let sum = 0;
  if (!Array.isArray(list) || list.length !== basis.weeks) {
    issue('schedule', `The schedule must have exactly ${basis.weeks} weekly entries (it had ${Array.isArray(list) ? list.length : 'none'}).`);
  } else {
    list.forEach((entry, i) => {
      const week = i + 1;
      if (!isPlainObject(entry)) { issue('schedule', `Week ${week} is not a valid entry.`); return; }
      if (entry.week !== week) issue('schedule', `Entry ${week} is labeled week ${entry.week}.`);
      if (entry.date !== basis.dates[i]) issue('dates', `Week ${week} must be dated ${basis.dates[i]}, not ${entry.date}.`);
      if (!Number.isSafeInteger(entry.amountCents)) issue('cents', `Week ${week} must use whole cents.`);
      else if (entry.amountCents < 0) issue('cents', `Week ${week} has a negative amount.`);
      else if (entry.amountCents > basis.weeklyBudgetCents) {
        issue('budget', `Week ${week} plans ${formatCents(entry.amountCents)}, above the ${formatCents(basis.weeklyBudgetCents)} the household chose.`);
      } else sum += entry.amountCents;
      if (entry.note !== undefined && typeof entry.note !== 'string') issue('shape', `Week ${week} has an invalid note.`);
      else if (typeof entry.note === 'string' && entry.note.length > 160) issue('shape', `Week ${week}'s note is too long.`);
    });
    if (!issues.some((i) => ['cents', 'budget'].includes(i.code)) && sum !== basis.plannedCents) {
      issue('totals', `The schedule adds up to ${formatCents(sum)}, but it should total ${formatCents(basis.plannedCents)}`
        + (basis.feasible ? ' to reach the goal.' : ' (every week at the chosen amount).'));
    }
  }

  const claimed = output.claimedTotals;
  if (!isPlainObject(claimed)) issue('totals', 'The plan did not state its totals.');
  else {
    const expectedShortfall = basis.remainingCents - basis.plannedCents;
    if (claimed.plannedCents !== sum) issue('totals', `The plan claims ${formatCents(Number(claimed.plannedCents) || 0)} planned, but its weeks add up to ${formatCents(sum)}.`);
    if (claimed.shortfallCents !== expectedShortfall) issue('totals', `The plan claims a ${formatCents(Number(claimed.shortfallCents) || 0)} shortfall; the arithmetic gives ${formatCents(expectedShortfall)}.`);
    if (claimed.feasible !== basis.feasible) issue('totals', basis.feasible ? 'The plan says the goal is out of reach, but the inputs can reach it.' : 'The plan says the goal is reachable, but the chosen weekly amount falls short.');
  }

  if (!issues.some((i) => i.code === 'shape')) {
    const amounts = Array.isArray(list) ? list.map((e) => (Number.isSafeInteger(e?.amountCents) ? e.amountCents : 0)) : [];
    const allowed = allowedAmounts(basis, amounts);
    const prose = [output.headline, output.summary, ...output.explanation, ...output.cautions,
      ...output.milestoneNotes.map((n) => n.note), ...(Array.isArray(list) ? list.map((e) => e?.note ?? '') : [])];
    const unknown = [...new Set(prose.flatMap(dollarFigures).filter((c) => !allowed.has(c)))];
    if (unknown.length) {
      issue('fabricated_amount', `The plan mentions ${unknown.map((c) => formatCents(c)).join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not derived from your inputs.`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Household edits: whole nonnegative cents, one per week, never past the remaining amount. */
export function validateEditedAmounts(amounts, basis) {
  const issues = [];
  const warnings = [];
  if (!Array.isArray(amounts) || amounts.length !== basis.weeks) {
    issues.push({ code: 'schedule', message: `Provide one amount for each of the ${basis.weeks} weeks.` });
    return { ok: false, issues, warnings };
  }
  let sum = 0;
  amounts.forEach((a, i) => {
    if (!Number.isSafeInteger(a) || a < 0 || a > 10_000_000) issues.push({ code: 'cents', message: `Week ${i + 1} needs an amount between $0.00 and $100,000.00.` });
    else {
      sum += a;
      if (a > basis.weeklyBudgetCents) warnings.push(`Week ${i + 1} is above the ${formatCents(basis.weeklyBudgetCents)} you chose to set aside each week.`);
    }
  });
  if (!issues.length && sum > basis.remainingCents) {
    issues.push({ code: 'totals', message: `These weeks add up to ${formatCents(sum)}, more than the ${formatCents(basis.remainingCents)} still needed.` });
  }
  return { ok: issues.length === 0, issues, warnings };
}

/** Attach server-computed projections and totals to a validated plan body. */
export function finalizePlan(body, basis, meta) {
  const amounts = body.contributions.map((c) => c.amountCents);
  const plannedCents = amounts.reduce((a, b) => a + b, 0);
  const shortfallCents = basis.remainingCents - plannedCents;
  return {
    ...meta,
    headline: body.headline,
    summary: body.summary,
    explanation: body.explanation,
    cautions: body.cautions,
    milestoneNotes: body.milestoneNotes,
    contributions: body.contributions.map((c) => ({ week: c.week, date: c.date, amountCents: c.amountCents, note: typeof c.note === 'string' ? c.note : '' })),
    totals: { plannedCents, shortfallCents, feasible: shortfallCents === 0, remainingCents: basis.remainingCents },
    projections: projectMilestones(basis, amounts),
    warnings: meta.warnings ?? [],
  };
}
