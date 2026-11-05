import { homeDistrict, districtById } from './realm.js';

// A cosmetic cast unlocked by the home already built. Never a payment, balance or bill-verification source.
const CAST = [
  ['fern', 'Fern', 'gardener', 0], ['kit', 'Kit', 'villager', 0],
  ['elowen', 'Princess Elowen', 'princess', 1], ['mira', 'Lady Mira', 'noble', 1],
  ['pip', 'Pip', 'musician', 1], ['oswin', 'Oswin', 'steward', 1],
  ['amara', 'Princess Amara', 'princess', 2], ['cedar', 'Sir Cedar', 'knight', 2],
  ['nell', 'Nell', 'guard', 2], ['rafe', 'Rafe', 'guard', 2],
  ['tess', 'Tess', 'merchant', 2], ['finn', 'Finn', 'page', 2],
  ['sorrel', 'Princess Sorrel', 'princess', 3], ['hugo', 'Lord Hugo', 'noble', 3],
  ['lyra', 'Lyra', 'musician', 3], ['joss', 'Joss', 'musician', 3],
  ['ivo', 'Sir Ivo', 'knight', 3], ['alma', 'Alma', 'gardener', 3],
  ['bea', 'Bea', 'merchant', 3], ['lark', 'Lark', 'page', 3],
].map(([id, name, role, tier], index) => Object.freeze({ id, name, role, tier, index }));

// Existing final-tier guests take up residence in the new palace; total capacity stays twenty.
const PALACE_GUESTS = new Set(['sorrel', 'lyra', 'alma', 'lark']);
export const courtDistrict = (person) => PALACE_GUESTS.has(person.id) ? districtById('palace') : homeDistrict(person.tier);

export const COURT_CAST = Object.freeze(CAST);
const clampTier = (tier) => Number.isInteger(tier) ? Math.max(0, Math.min(3, tier)) : 0;
export const courtResidents = (tier) => COURT_CAST.filter((person) => person.tier <= clampTier(tier));

export function courtForTier(tier) {
  const residents = courtResidents(tier);
  const princesses = residents.filter((p) => p.role === 'princess').map((p) => p.name);
  const descriptions = [
    'A gardener and a neighbor stroll by the cottage.',
    'Princess Elowen, a noble visitor, a musician and a steward join the cottage guests.',
    'Princess Amara joins the court with knights, guards, a merchant and a page.',
    'Princess Sorrel joins a royal gathering with more musicians, nobles, knights and village guests.',
  ];
  return { capacity: residents.length, princesses, description: descriptions[clampTier(tier)] };
}

// These lanes stay outside every home footprint, moat, wall, market stall and farm enclosure.
// Ping-pong routes plus pauses make guests return along the same safe lane rather than cut through buildings.
export const COURT_PATHS = Object.freeze([
  Object.freeze([[-6.7, 7.9], [-2.4, 7.9], [2.4, 7.9], [6.7, 7.9]]),
  Object.freeze([[11.8, -4.4], [11.8, .1], [11.8, 4.2], [11.8, 7.6]]),
  Object.freeze([[-11.6, -.6], [-11.6, 2.4], [-11.6, 5.1], [-11.6, 7.6]]),
  Object.freeze([[-8, 10.7], [-3.5, 10.7], [1, 10.7], [7.7, 10.7]]),
].map((path) => Object.freeze(path.map((point) => Object.freeze(point)))));

/** Deterministic walk-and-pause sampling. Closed in both position and time, with no teleport at a loop boundary. */
export function courtPose(person, seconds) {
  const route = COURT_PATHS[person.index % COURT_PATHS.length];
  const points = [...route, ...route.slice(1, -1).reverse()];
  const speed = .48 + (person.index % 3) * .055;
  const pause = 2.8 + (person.index % 3) * .4;
  const legs = points.map((from, i) => {
    const to = points[(i + 1) % points.length];
    const walk = Math.hypot(to[0] - from[0], to[1] - from[1]) / speed;
    return { from, to, walk, duration: walk + pause };
  });
  const duration = legs.reduce((n, leg) => n + leg.duration, 0);
  let time = (((Number.isFinite(seconds) ? seconds : 0) + person.index * 6.3) % duration + duration) % duration;
  for (const leg of legs) {
    if (time > leg.duration) { time -= leg.duration; continue; }
    const moving = time < leg.walk;
    const f = Math.min(1, time / leg.walk);
    return {
      x: leg.from[0] + (leg.to[0] - leg.from[0]) * f,
      z: leg.from[1] + (leg.to[1] - leg.from[1]) * f,
      heading: Math.atan2(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]),
      moving,
      activity: moving ? 'strolling' : person.role === 'musician' ? 'playing music' : 'greeting guests',
    };
  }
  throw new Error('Court route has no segment');
}

/** Guests belong to the district that welcomed them; later unlocks keep the village and manor inhabited. */
export function courtWorldPose(person, seconds) {
  const pose = courtPose(person, seconds), district = courtDistrict(person);
  return { ...pose, x: district.x + pose.x * district.scale, z: district.z + pose.z * district.scale, district: district.id };
}
