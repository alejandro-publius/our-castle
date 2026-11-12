// Treasury: a read-only view of where the household stands against the next area, from the server's own state.
// District access comes from the server-built realm (earned achievements, the existing rules); thresholds use the same
// milestoneCents rule that awards milestones. Nothing here credits, opens or closes anything, and nothing is sent anywhere.

import { milestoneCents } from '../src/core/rules.js';
import { REALM_DISTRICTS } from '../src/core/realm.js';
import { ledgerTrail } from '../src/core/ledger.js';

const ORDER = new Map(REALM_DISTRICTS.map((d, i) => [d.id, i]));

/**
 * @param state the server-built state (goal, progress, rewards.realm.districts)
 * @returns {{ areas: object[], nextArea: object | null }} areas: one row per milestone district, in milestone order;
 *   nextArea: the lowest locked milestone and every district that opens with it, or null when all are open.
 */
export function treasuryFor(state, now = new Date().toISOString(), acceptedPlan = state.plan?.id === state.acceptedPlanId ? state.plan : null) {
  const { goal, progress } = state;
  const progressCents = Math.max(0, progress.progressCents);
  const districts = state.rewards.realm.districts
    .filter((d) => Number.isInteger(d.percent) && d.percent > 0) // the bill-habit garden is not a savings milestone
    .sort((a, b) => a.percent - b.percent || ORDER.get(a.id) - ORDER.get(b.id));
  const next = districts.find((d) => !d.open)?.percent ?? null;
  const areas = districts.map((d) => {
    const thresholdCents = milestoneCents(goal.targetCents, d.percent);
    return {
      id: d.id, name: d.name, percent: d.percent, thresholdCents,
      progressCents: Math.min(progressCents, thresholdCents),
      remainingCents: d.open ? 0 : Math.max(0, thresholdCents - progressCents),
      open: Boolean(d.open), next: !d.open && d.percent === next,
    };
  });
  // One label per milestone group (e.g. "Stone Keep & Starfall Observatory"), so a widget can show the whole group.
  const joinNames = (names) => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`);
  for (const a of areas) a.groupLabel = joinNames(areas.filter((b) => b.percent === a.percent).map((b) => b.name));
  const group = areas.filter((a) => a.next);
  const nextArea = group.length ? {
    ids: group.map((a) => a.id), names: group.map((a) => a.name), percent: next,
    thresholdCents: group[0].thresholdCents, progressCents: group[0].progressCents, remainingCents: group[0].remainingCents,
    currency: goal.currency,
  } : null;
  return { areas, nextArea, week: treasuryWeek(state, now, acceptedPlan), holds: treasuryHolds(state, now) };
}

const DAY_MS = 86_400_000;
/** Held and not ended: money an adult can still release or return. A hold not placed yet, or one that is over, is not listed. */
const OPEN_HOLD = new Set(['held', 'releasing', 'returning']);
/** The Treasury's rows: each open hold with the Ledger record that opens it. */
export function treasuryHolds(state, now = new Date().toISOString()) {
  const trail = ledgerTrail(state);
  return openHolds(state.contributions, now).map((h) => ({ ...h, recordId: trail.find((r) => r.contribution?.id === h.id)?.id ?? null }));
}

/**
 * One row per open hold, soonest to expire first, from the server's own records of it: what is still held, and where
 * `now` falls between the day it was placed and the day PayPal lets it go. Shares are fractions of that span, for a
 * timeline. Nothing here is counted as progress.
 * @param contributions the contribution views of one goal
 */
export function openHolds(contributions, now = new Date().toISOString()) {
  const at = Date.parse(now);
  const wholeDays = (until) => (Number.isFinite(until) ? Math.max(0, Math.ceil((until - at) / DAY_MS)) : null);
  return contributions.filter((c) => c.hold && OPEN_HOLD.has(c.hold.status)).map((c) => {
    const h = c.hold, placed = Date.parse(c.createdAt), honor = Date.parse(h.honorUntil ?? ''), expires = Date.parse(h.expiresAt ?? '');
    const span = expires - placed, share = (t) => Math.min(1, Math.max(0, (t - placed) / span));
    const timed = Number.isFinite(span) && span > 0;
    return {
      id: c.id, simulated: Boolean(c.simulated),
      heldCents: h.heldCents, releasedCents: h.releasedCents, remainingCents: h.remainingCents, currency: c.currency,
      phase: h.phase, pending: h.pending ?? null, extended: Boolean(h.extendedAt), canExtend: Boolean(h.canExtend),
      honorUntil: h.honorUntil ?? null, expiresAt: h.expiresAt ?? null,
      guaranteedDays: wholeDays(honor), daysLeft: wholeDays(expires),
      // The three-day guarantee as a stretch of the timeline (after an extension, the new one), and how far along today is.
      elapsedShare: timed ? share(at) : null,
      guaranteeFromShare: timed && Number.isFinite(honor) ? share(honor - 3 * DAY_MS) : null,
      guaranteeToShare: timed && Number.isFinite(honor) ? share(honor) : null,
    };
  }).sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999') || a.id.localeCompare(b.id));
}

/** Calendar week, Monday–Sunday UTC, matching the planner's date-only fields. Starting reports are never deposits. */
export function treasuryWeek(state, now, acceptedPlan = null) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  const startDay = start.toISOString().slice(0, 10), endDay = end.toISOString().slice(0, 10);
  const kinds = new Set(['contribution', 'simulated_contribution', 'refund', 'simulated_refund']);
  const records = ledgerTrail(state).filter((r) => kinds.has(r.entry?.kind)
    && Date.parse(r.entry.createdAt) >= start.getTime() && Date.parse(r.entry.createdAt) < end.getTime())
    .map((r) => ({ id: r.id, amountCents: r.entry.effect * r.entry.amountCents, source: r.entry.source, createdAt: r.entry.createdAt, refund: r.entry.effect < 0 }));
  const receivedCents = records.filter((r) => r.amountCents > 0).reduce((sum, r) => sum + r.amountCents, 0);
  const refundedCents = -records.filter((r) => r.amountCents < 0).reduce((sum, r) => sum + r.amountCents, 0);
  const plannedCents = acceptedPlan?.status === 'accepted'
    ? acceptedPlan.contributions.filter((c) => c.date >= startDay && c.date < endDay).reduce((sum, c) => sum + c.amountCents, 0) : null;
  return { id: 'this-week', start: startDay, end: endDay, plannedCents, receivedCents, refundedCents,
    netCents: receivedCents - refundedCents, startingCents: state.progress.startingCents,
    sources: [...new Set(records.map((r) => r.source))], records };
}
