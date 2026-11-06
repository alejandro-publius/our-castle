import { TIERS, milestoneCents, tierForProgress } from './rules.js';
import { ESTATE_MILESTONES } from './rewards.js';

// The family project: one small campsite in the west meadow that represents the current shared goal and develops as
// tracked progress rises. Its stages are the existing home milestones (0/25/60/100%) and its extra details inside a
// stage are the existing estate milestones (10/40/80%). Nothing here is a balance, a reward entry, a payment threshold
// or a separate counter: it is a reading of the server's progress and goal through the rules the server already uses.
// It follows current progress, so a refund or a larger goal visibly sets the project back; the earned home tiers are
// the keepsakes, this is the truthful picture of where the goal stands right now.

export const FAMILY_PROJECT_SITE = Object.freeze({ id: 'family-project', name: 'Family Campsite', x: -98, z: 26, width: 24, depth: 24, height: 7 });

export const PROJECT_STAGES = Object.freeze([
  { key: 'survey', name: 'Survey stakes', tier: 0 },
  { key: 'construction', name: 'Under construction', tier: 1 },
  { key: 'furnished', name: 'Furnished campsite', tier: 2 },
  { key: 'gathering', name: 'Gathering place', tier: 3 },
].map((stage) => Object.freeze({ ...stage, percent: TIERS[stage.tier].percent })));

// The estate milestone that adds detail within each stage. The last stage is complete and has none.
const DETAIL_KEY = Object.freeze({ 0: 'porch', 1: 'market', 2: 'ramparts' });

/**
 * @returns {{ index: number, key: string, name: string, percent: number, detail: boolean, detailKey: string|null,
 *   detailPercent: number|null, nextPercent: number|null, complete: boolean }}
 */
export function projectStage(progressCents, targetCents) {
  const target = Number.isSafeInteger(targetCents) && targetCents > 0 ? targetCents : 0;
  const progress = Number.isSafeInteger(progressCents) ? Math.max(0, progressCents) : 0;
  const tier = target ? tierForProgress(progress, target) : 0;
  const stage = PROJECT_STAGES[tier];
  const milestone = ESTATE_MILESTONES.find((m) => m.key === DETAIL_KEY[tier]) ?? null;
  const detail = Boolean(target && milestone && progress >= milestoneCents(target, milestone.percent));
  const next = tier === 3 ? null : detail || !milestone ? PROJECT_STAGES[tier + 1] : milestone;
  return {
    index: tier, key: stage.key, name: stage.name, percent: stage.percent,
    detail, detailKey: detail ? milestone.key : null, detailPercent: milestone?.percent ?? null,
    nextPercent: next?.percent ?? null, complete: tier === 3,
  };
}

/** The short line shown when the campsite is selected on the map. */
export const projectLabel = (stage) => `${FAMILY_PROJECT_SITE.name} · ${stage.name}`;
