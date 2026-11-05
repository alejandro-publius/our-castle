// Treasury: a read-only view of where the household stands against the next area, from the server's own state.
// District access comes from the server-built realm (earned achievements, the existing rules); thresholds use the same
// milestoneCents rule that awards milestones. Nothing here credits, opens or closes anything, and nothing is sent anywhere.

import { milestoneCents } from '../src/core/rules.js';
import { REALM_DISTRICTS } from '../src/core/realm.js';

const ORDER = new Map(REALM_DISTRICTS.map((d, i) => [d.id, i]));

/**
 * @param state the server-built state (goal, progress, rewards.realm.districts)
 * @returns {{ areas: object[], nextArea: object | null }} areas: one row per milestone district, in milestone order;
 *   nextArea: the lowest locked milestone and every district that opens with it, or null when all are open.
 */
export function treasuryFor(state) {
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
  return { areas, nextArea };
}
