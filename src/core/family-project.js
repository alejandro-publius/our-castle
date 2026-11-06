import { TIERS, milestoneCents, tierForProgress } from './rules.js';
import { ESTATE_MILESTONES } from './rewards.js';

// The family project: one small place in the west meadow that represents the current shared goal and develops as
// tracked progress rises. The family chooses what it builds (a campsite, a garden or a schoolhouse); the choice only
// changes the picture. Its stages are the existing home milestones (0/25/60/100%) and its extra details inside a stage
// are the existing estate milestones (10/40/80%). Nothing here is a balance, a reward entry, a payment threshold or a
// separate counter: it is a reading of the server's progress and goal through the rules the server already uses.
// It follows current progress, so a refund or a larger goal visibly sets the project back; the earned home tiers are
// the keepsakes, this is the truthful picture of where the goal stands right now.

export const FAMILY_PROJECT_SITE = Object.freeze({ id: 'family-project', name: 'Family Campsite', x: -98, z: 26, width: 24, depth: 24, height: 7 });

export const PROJECT_STAGES = Object.freeze([
  { key: 'survey', name: 'Survey stakes', tier: 0 },
  { key: 'construction', name: 'Under construction', tier: 1 },
  { key: 'furnished', name: 'Furnished campsite', tier: 2 },
  { key: 'gathering', name: 'Gathering place', tier: 3 },
].map((stage) => Object.freeze({ ...stage, percent: TIERS[stage.tier].percent })));

// What the family chose to build. The stage keys and thresholds are shared; only the place's name, the short stage
// names that mention it and the height the camera frames differ: the schoolhouse's bell tower is the tallest part, and the
// garden's glasshouse stands at the back of its plot, so its marker floats a little higher to stay clear of the ridge.
export const PROJECT_KINDS = Object.freeze([
  { key: 'campsite', label: 'Campsite', name: 'Family Campsite', stageNames: PROJECT_STAGES.map((s) => s.name), height: 7 },
  { key: 'garden', label: 'Garden', name: 'Family Garden', stageNames: ['Survey stakes', 'Under construction', 'Planted garden', 'Garden in bloom'], height: 8.5 },
  { key: 'schoolhouse', label: 'Schoolhouse', name: 'Family Schoolhouse', stageNames: ['Survey stakes', 'Under construction', 'Finished schoolhouse', 'Gathering place'], height: 10 },
].map((kind) => Object.freeze({ ...kind, stageNames: Object.freeze([...kind.stageNames]) })));

export const DEFAULT_PROJECT_KIND = 'campsite';

/** True only for one of the listed choices. Free text, merchant results or model output are never read as a choice. */
export const isProjectKind = (value) => typeof value === 'string' && PROJECT_KINDS.some((k) => k.key === value);

/** The listed choice, or the campsite every existing goal starts with. */
export const projectKind = (value) => PROJECT_KINDS.find((k) => k.key === value) ?? PROJECT_KINDS[0];

/** The meadow site as the camera and map marker see it for one choice: same place, the chosen name and height. */
export function projectSite(kind) {
  const chosen = projectKind(kind);
  return Object.freeze({ ...FAMILY_PROJECT_SITE, name: chosen.name, height: chosen.height });
}

// The estate milestone that adds detail within each stage. The last stage is complete and has none.
const DETAIL_KEY = Object.freeze({ 0: 'porch', 1: 'market', 2: 'ramparts' });

/**
 * @returns {{ index: number, key: string, kind: string, name: string, percent: number, detail: boolean, detailKey: string|null,
 *   detailPercent: number|null, nextPercent: number|null, complete: boolean }}
 */
export function projectStage(progressCents, targetCents, kind = DEFAULT_PROJECT_KIND) {
  const target = Number.isSafeInteger(targetCents) && targetCents > 0 ? targetCents : 0;
  const progress = Number.isSafeInteger(progressCents) ? Math.max(0, progressCents) : 0;
  const tier = target ? tierForProgress(progress, target) : 0;
  const stage = PROJECT_STAGES[tier];
  const chosen = projectKind(kind);
  const milestone = ESTATE_MILESTONES.find((m) => m.key === DETAIL_KEY[tier]) ?? null;
  const detail = Boolean(target && milestone && progress >= milestoneCents(target, milestone.percent));
  const next = tier === 3 ? null : detail || !milestone ? PROJECT_STAGES[tier + 1] : milestone;
  return {
    index: tier, key: stage.key, kind: chosen.key, name: chosen.stageNames[tier], percent: stage.percent,
    detail, detailKey: detail ? milestone.key : null, detailPercent: milestone?.percent ?? null,
    nextPercent: next?.percent ?? null, complete: tier === 3,
  };
}

/** The short line shown when the project is selected on the map. */
export const projectLabel = (stage) => `${projectKind(stage?.kind).name} · ${stage.name}`;
