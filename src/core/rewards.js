import { TIERS, formatCents, milestoneCents } from './rules.js';
import { courtForTier } from './court.js';
import { REALM_SIZE, realmAccess, bridgeAccess } from './realm.js';

// Cosmetic world rewards. Shared by the server (which decides what is earned) and the browser (which draws it).
// Nothing here changes money, savings totals or payment state, and nothing here can mark a bill as verified.

/** Intermediate estate additions between the home tiers. Earned once, kept as keepsakes after a refund. */
export const ESTATE_MILESTONES = Object.freeze([
  Object.freeze({ key: 'porch', percent: 10, level: 1, name: 'The welcoming porch', detail: 'A slate porch roof on carved posts, a lit lantern, stone steps and flower boxes at the door.' }),
  Object.freeze({ key: 'market', percent: 40, level: 2, name: 'The village quarter', detail: 'A timber workshop, striped market stalls, a cart and neighbors trading by the road.' }),
  Object.freeze({ key: 'ramparts', percent: 80, level: 3, name: 'The outer ramparts', detail: 'An outer wall around the estate with corner turrets in your crest color.' }),
]);

export const HOME_DETAILS = Object.freeze({
  cottage: 'Timber framing, tiled roof, brick chimney, mullioned windows with flower boxes and the household pennant.',
  manor: 'A two-storey timber hall under a cobalt roof with a crimson-roofed wing, crest banner, fenced courtyard and kitchen garden.',
  keep: 'A stone keep with four towers, battlements, arrow slits and a gatehouse with an iron portcullis.',
  castle: 'Tall spired towers, a great hall, moat and drawbridge, courtyard fountain and planted gardens.',
});

/**
 * Status vocabulary (also used by the UI and tests):
 * - unlocked: current tracked goal progress meets the condition.
 * - keepsake: earned earlier and kept after a refund; current progress is below the condition.
 * - locked: not reached yet.
 * - connection_required: needs an authorized provider that is not connected. Nothing in this app can unlock it.
 *
 * Evidence sources:
 * - goal_progress: this app's goal ledger (reported starting progress plus server-confirmed contributions).
 * - self_reported: recorded by the household; never treated as provider verification.
 * - provider_required: a real, authorized bill provider would have to confirm it. None is connected.
 */
export const REWARD_STATUSES = Object.freeze(['unlocked', 'keepsake', 'locked', 'connection_required']);

/**
 * Estate additions newly earned between two authoritative reward lists: locked before, unlocked now.
 * No previous list (first load or reload), an identical list (a replayed capture), unlocked -> keepsake (a refund)
 * and keepsake -> unlocked (crossing again after a refund) all return nothing, so none can announce a reward.
 */
export function newlyEarnedEstate(previousRewards, nextRewards) {
  if (!previousRewards?.entries || !nextRewards?.entries) return [];
  const before = new Map(previousRewards.entries.map((r) => [r.id, r.status]));
  return nextRewards.entries.filter((r) => r.id.startsWith('estate:') && r.status === 'unlocked' && before.get(r.id) === 'locked');
}

/** Highest estate level earned (kept after refunds) or reached by current progress. */
export function estateLevelFor(achievements = [], progressCents = 0, targetCents = 1) {
  const keys = new Set(achievements.map((a) => a.key));
  return ESTATE_MILESTONES.reduce((level, r) => (keys.has(`estate:${r.key}`) || progressCents >= milestoneCents(targetCents, r.percent) ? Math.max(level, r.level) : level), 0);
}

/** Say exactly what the goal ledger is made of, without calling simulated or reported money "confirmed". */
export function goalEvidenceLabel(progress, currency = 'USD') {
  const parts = [];
  if (progress.startingCents > 0) parts.push(`${formatCents(progress.startingCents, currency)} reported by you`);
  const confirmed = (progress.contributedCents ?? 0) - (progress.refundedCents ?? 0);
  if (confirmed > 0) parts.push(`${formatCents(confirmed, currency)} confirmed by PayPal sandbox captures`);
  const simulated = (progress.simulatedContributedCents ?? 0) - (progress.simulatedRefundedCents ?? 0);
  if (simulated > 0) parts.push(`${formatCents(simulated, currency)} from simulated example payments`);
  return parts.length ? `Goal ledger: ${parts.join(' + ')}` : 'Goal ledger: nothing tracked yet';
}

/**
 * Build the reward list from trusted server state only: the goal ledger, earned achievements and garden count.
 * User-reported bills can grow the habit garden; they can never supply provider evidence.
 */
export function buildRewards({ progress, targetCents, currency = 'USD', achievements = [], builtTier = 0, gardenCount = 0, paymentsMode = 'example' }) {
  const keys = new Set(achievements.map((a) => a.key));
  const evidence = goalEvidenceLabel(progress, currency);
  const goalReward = ({ id, name, detail, percent, earned, previewTier, previewEstateLevel }) => {
    const requiredCents = milestoneCents(targetCents, percent);
    const reached = progress.progressCents >= requiredCents;
    return {
      id, name, detail, percent,
      status: reached ? 'unlocked' : earned ? 'keepsake' : 'locked',
      source: 'goal_progress',
      sourceLabel: evidence,
      condition: percent ? `Reach ${percent}% of the shared goal (${formatCents(requiredCents, currency)} tracked)` : 'Found your house',
      requiredCents,
      progressCents: Math.min(progress.progressCents, requiredCents),
      remainingCents: Math.max(0, requiredCents - progress.progressCents),
      providerVerified: false,
      previewTier, previewEstateLevel, previewFeature: null,
    };
  };

  const homes = TIERS.map((tier) => goalReward({
    id: `home:${tier.key}`, name: tier.index === 0 ? 'Hearth cottage' : `The ${tier.name.toLowerCase()}`, detail: `${HOME_DETAILS[tier.key]} ${tier.index ? 'Opens its own district and lowers the connecting bridge; earlier districts remain.' : 'Your starting village remains as the realm expands.'}`,
    percent: tier.percent, earned: tier.index <= builtTier,
    previewTier: tier.index, previewEstateLevel: ESTATE_MILESTONES.filter((r) => r.percent <= tier.percent).length,
  })).map((reward, tier) => ({ ...reward, court: courtForTier(tier) }));
  const estate = ESTATE_MILESTONES.map((r) => goalReward({
    id: `estate:${r.key}`, name: r.name, detail: r.detail, percent: r.percent, earned: keys.has(`estate:${r.key}`),
    previewTier: TIERS.filter((t) => t.percent <= r.percent).at(-1).index, previewEstateLevel: r.level,
  }));
  const entries = [...homes, ...estate].sort((a, b) => a.percent - b.percent || a.id.localeCompare(b.id));

  entries.push({
    id: 'habit:garden', name: 'The habit garden',
    detail: 'Raised vegetable beds beside the home, one for each bill habit you record (up to four).',
    status: gardenCount > 0 ? 'unlocked' : 'locked', source: 'self_reported',
    sourceLabel: 'Recorded by you · not verified by any provider · never counted as savings',
    condition: 'Record a bill you paid on time in the Ledger tab', count: gardenCount, providerVerified: false,
    previewTier: null, previewEstateLevel: null, previewFeature: 'habit-garden',
  });
  for (const [kind, name, detail] of [
    ['electricity', 'The lantern festival', 'Lanterns light the paths and gates across the estate.'],
    ['water', 'The water garden', 'A stone fountain and irrigated garden beds by the river.'],
  ]) {
    entries.push({
      id: `bill:${kind}`, name, detail, status: 'connection_required', source: 'provider_required',
      sourceLabel: 'Needs a connected bill provider · none is connected',
      condition: `An authorized provider confirms this household's ${kind} bill for the period is paid`,
      providerVerified: false, previewTier: null, previewEstateLevel: null, previewFeature: kind,
    });
  }

  return {
    entries,
    realm: { size: REALM_SIZE, districts: realmAccess({ builtTier, estateLevel: estateLevelFor(achievements, progress.progressCents, targetCents), gardens: gardenCount }), bridges: bridgeAccess({ builtTier, estateLevel: estateLevelFor(achievements, progress.progressCents, targetCents), gardens: gardenCount }) },
    estateLevel: estateLevelFor(achievements, progress.progressCents, targetCents),
    billVerification: {
      connected: false,
      status: 'not_connected',
      providers: [],
      note: 'PayPal contributions are confirmed by the server. Household bills are recorded by you: no bill provider is connected, so bill-provider rewards stay locked.',
    },
    paymentEvidenceLabel: paymentsMode === 'sandbox' ? 'PayPal sandbox confirmations use test money.' : 'Example-mode payments are simulated.',
  };
}
