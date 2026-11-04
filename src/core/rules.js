// Shared, dependency-free rules for Our House. Imported by the browser and the Node server,
// so it must not touch Three.js, the DOM or Node APIs. Every amount is an integer number of cents.

export const CURRENCY = 'USD';
export const ROUTE_LENGTH = 20; // waypoints around the woodland board; 20 = back home

/** House tiers. `percent` is the share of the goal that must be reached (editable default). */
export const TIERS = Object.freeze([
  Object.freeze({ index: 0, key: 'cottage', name: 'Cottage', numeral: 'I', percent: 0, title: 'The first cottage' }),
  Object.freeze({ index: 1, key: 'manor', name: 'Manor', numeral: 'II', percent: 25, title: 'A place to grow' }),
  Object.freeze({ index: 2, key: 'keep', name: 'Keep', numeral: 'III', percent: 60, title: 'A house with its own walls' }),
  Object.freeze({ index: 3, key: 'castle', name: 'Castle', numeral: 'IV', percent: 100, title: 'A castle built together' }),
]);

/** Original woodland waypoint names. Index 0 and 20 are the same hearth corner. */
export const SPACES = Object.freeze([
  'Hearth Corner', 'Fernbrook Path', 'Mossy Stile', 'Bramble Hollow', 'Foxglove Glade',
  'Manor Gate', 'Old Oak Rest', 'Stag Meadow', 'Willow Bend', 'Thistle Rise',
  'Lantern Corner', 'Bluebell Bank', 'Keep Wall', 'Hazel Thicket', "Owl's Perch",
  'Heron Corner', 'Juniper Way', "Doe's Crossing", 'Mill Brook', 'Plank Bridge',
  'Home Hearth',
]);

export const CREST_FIELDS = Object.freeze({
  crimson: Object.freeze({ label: 'Crimson', hex: '#9D3E46' }),
  cobalt: Object.freeze({ label: 'Cobalt', hex: '#355F93' }),
  emerald: Object.freeze({ label: 'Emerald', hex: '#527557' }),
  violet: Object.freeze({ label: 'Violet', hex: '#777099' }),
});
export const CREST_CHARGES = Object.freeze({
  crown: 'Crown', leaf: 'Leaf', stag: 'Stag', tower: 'Tower',
});

export function isCents(value) {
  return Number.isSafeInteger(value);
}

/** Smallest whole-cent amount that is at least `percent`% of the target (integer arithmetic). */
export function milestoneCents(targetCents, percent) {
  return Math.floor((targetCents * percent + 99) / 100);
}

export function milestoneTargets(targetCents) {
  return TIERS.map((tier) => ({ ...tier, targetCents: milestoneCents(targetCents, tier.percent) }));
}

/** Highest tier whose threshold the given progress meets. */
export function tierForProgress(progressCents, targetCents) {
  let reached = 0;
  for (const tier of TIERS) if (progressCents >= milestoneCents(targetCents, tier.percent)) reached = tier.index;
  return reached;
}

/** Board position follows the achieved share of the goal, clamped to the route. */
export function positionForProgress(progressCents, targetCents) {
  if (!(targetCents > 0)) return 0;
  const raw = Math.floor((Math.max(0, progressCents) * ROUTE_LENGTH) / targetCents);
  return Math.min(ROUTE_LENGTH, Math.max(0, raw));
}

export function milestoneSpaces(targetCents) {
  return TIERS.slice(1).map((tier) => ({
    tier: tier.index,
    key: tier.key,
    space: positionForProgress(milestoneCents(targetCents, tier.percent), targetCents),
  }));
}

/** Next unreached milestone, or null when the goal is complete. */
export function nextMilestone(progressCents, targetCents) {
  for (const tier of TIERS.slice(1)) {
    const target = milestoneCents(targetCents, tier.percent);
    if (progressCents < target) return { ...tier, targetCents: target, awayCents: target - progressCents };
  }
  return null;
}

/** Whole-number tenths of a percent, computed without floating point drift. */
export function percentTenths(progressCents, targetCents) {
  if (!(targetCents > 0)) return 0;
  return Math.floor((Math.max(0, progressCents) * 1000) / targetCents);
}

export function formatPercent(progressCents, targetCents) {
  const tenths = percentTenths(progressCents, targetCents);
  return `${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ''}%`;
}

const formatters = new Map();
export function formatCents(cents, currency = CURRENCY) {
  if (!formatters.has(currency)) {
    formatters.set(currency, new Intl.NumberFormat('en-US', { style: 'currency', currency }));
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  // Format whole cents through a string so large values never pick up float noise.
  return sign + formatters.get(currency).format(Number(`${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`));
}

/** Strict parser for amounts typed by a person: "15", "15.5", "$1,200.00". Returns cents or null. */
export function parseAmountToCents(input) {
  if (typeof input !== 'string') return null;
  const match = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!match) return null;
  const dollars = Number(match[1].replaceAll(',', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** "1500" cents -> "15.00", the decimal string PayPal's Orders API expects for USD. */
export function centsToDecimalString(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Expected nonnegative integer cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** Strictly parse a provider decimal string ("15.00"). Returns cents or null. */
export function decimalStringToCents(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const total = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(total) ? total : null;
}

export function spaceName(position) {
  return SPACES[Math.min(ROUTE_LENGTH, Math.max(0, position))];
}
