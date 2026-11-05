// District deeds: the collectible card shown when the server's state newly opens a district, and kept in Rewards.
// Shared and dependency-free. Everything comes from the authoritative state the server sends (rewards, realm access,
// court cast); nothing here decides money or access. A deed is a realm keepsake.
import { REALM_DISTRICTS, districtById, homeDistrict } from './realm.js';
import { COURT_CAST, courtDistrict } from './court.js';
import { TIERS } from './rules.js';
import { ESTATE_MILESTONES, HOME_DETAILS } from './rewards.js';

// The scenery each district draws around its home (keep in step with decor() in src/world/realm-models.js).
export const DISTRICT_SCENERY = Object.freeze({
  cottage: 'Two small cottages, a well, grazing deer and butterflies.',
  manor: 'A cobalt-roofed outbuilding, six gold-edged flower parterres, a fountain and the household banner.',
  market: 'A red-roofed market hall, three cottages, a well, a windmill and bunting.',
  garden: 'A blue-roofed cottage, a stone-ringed pond, a well, four vegetable rows and an orchard grove.',
  keep: 'Two crimson-capped watchtowers with long banners, a stone house and flower planters.',
  palace: 'An ivory palace with rose roofs, five gold-tipped spires, illuminated arched windows, a fountain and rose parterres.',
  castle: 'Two cream side halls under crimson and cobalt roofs, two tall spired towers, a curtain wall with crest shields and turrets, flower planters and bunting.',
});
// One short line for the face of the deed; the full description is in the deed's details.
export const DISTRICT_SUMMARY = Object.freeze({
  cottage: 'Timber cottage, well and grazing deer',
  manor: 'Two-storey manor hall, fountain and flower parterres',
  market: 'Market hall, striped stalls, workshop and windmill',
  garden: 'Pond, well, vegetable rows and an orchard',
  keep: 'Stone keep with four towers and two watchtowers',
  palace: 'Ivory towers, rose roofs and a fountain garden',
  castle: 'Spired citadel, two side halls and a curtain wall',
});
// The deed's title band: one existing heraldic token per district (CSS custom properties in app.css).
export const DEED_COLOURS = Object.freeze({ cottage: 'emerald', manor: 'cobalt', market: 'crimson', garden: 'leaf', keep: 'timber', castle: 'violet', palace: 'rose' });

const MARKET = ESTATE_MILESTONES.find((r) => r.key === 'market');
/** The reward entry that opens a district: its home tier, the village quarter, or the habit garden. */
export function rewardIdFor(districtId) {
  const d = districtById(districtId);
  if (!d) return null;
  if (d.id === 'palace') return 'home:castle';
  if (d.homeTier !== null) return `home:${TIERS[d.homeTier].key}`;
  return d.id === 'market' ? `estate:${MARKET.key}` : 'habit:garden';
}
/** The district an estate reward appears in (the same rule the art previews use). */
export const estateDistrict = (reward) => (reward.id === `estate:${MARKET.key}` ? 'market' : homeDistrict(reward.previewTier).id);
/** Court guests welcomed in a district: guests belong to the home district of the tier that welcomed them. */
export const districtResidents = (districtId) => COURT_CAST.filter((p) => courtDistrict(p).id === districtId);

const openIds = (state) => new Set((state?.rewards?.realm?.districts ?? []).filter((d) => d.open).map((d) => d.id));
/**
 * Districts the server newly opened between two authoritative states for the same household and goal. A first load,
 * a reload (no previous state), a replayed or unchanged state, a different goal and anything already open give none.
 */
export function newlyOpenedDistricts(previous, next) {
  if (!previous?.rewards || !next?.rewards) return [];
  if (previous.household?.id !== next.household?.id || previous.goal?.id !== next.goal?.id) return [];
  const before = openIds(previous), after = openIds(next);
  return REALM_DISTRICTS.map((d) => d.id).filter((id) => after.has(id) && !before.has(id));
}

const join = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
/**
 * Everything a deed shows, from the authoritative state. `status` is earned, keepsake (opened earlier and kept after a
 * refund) or locked; the starting village is earned from the start.
 */
export function districtDeed(state, districtId) {
  const district = districtById(districtId);
  const access = state.rewards.realm.districts.find((d) => d.id === districtId);
  const reward = state.rewards.entries.find((r) => r.id === rewardIdFor(districtId));
  if (!district || !access || !reward) return null;
  const open = access.open, selfReported = reward.source === 'self_reported';
  const status = !open ? 'locked' : reward.status === 'keepsake' ? 'keepsake' : 'earned';

  const stands = [];
  if (district.homeTier !== null) stands.push(HOME_DETAILS[TIERS[district.homeTier].key]);
  if (districtId === 'market') stands.push(MARKET.detail);
  stands.push(DISTRICT_SCENERY[districtId]);
  if (districtId === 'garden') stands.push(`${state.board.gardens} of 4 habit garden beds planted, one for each bill habit you recorded.`);
  // Estate additions drawn in this district (the porch at the village, the ramparts at the keep), with their real status.
  const additions = state.rewards.entries
    .filter((r) => r.id.startsWith('estate:') && r.id !== reward.id && estateDistrict(r) === districtId)
    .map((r) => ({ name: r.name, status: r.status, condition: r.condition }));
  const providerLocked = districtId === 'garden'
    ? state.rewards.entries.filter((r) => r.source === 'provider_required' && r.previewFeature === 'water').map((r) => r.name) : [];

  const people = districtResidents(districtId);
  const princesses = people.filter((p) => p.role === 'princess').map((p) => p.name);
  const court = people.length
    ? { count: people.length, names: people.map((p) => p.name), princesses, text: `${people.length} guests ${open ? 'welcomed' : 'welcomed when it opens'}: ${join(people.map((p) => p.name))}.`,
      short: `${people.length} guests${princesses.length ? `, including ${join(princesses)}` : ''}` }
    : { count: 0, names: [], princesses: [], text: 'No court guests are assigned here.', short: 'No court guests live here' };

  const sandbox = state.modes?.payments?.mode === 'sandbox';
  const stamp = `Realm keepsake · ${selfReported ? 'self-reported habit, not verified by any bill provider'
    : sandbox ? 'PayPal sandbox · test money' : 'Example mode · simulated payments'}`;
  return {
    id: districtId, name: district.name, colour: DEED_COLOURS[districtId], status, open,
    rewardName: reward.name,
    condition: reward.condition,
    earned: status === 'earned' ? (district.percent === 0 ? 'Your starting village' : `Earned: ${reward.condition}`)
      : status === 'keepsake' ? `Kept as a keepsake. It opened at: ${reward.condition}. Current progress is below that now.`
        : `Locked: ${reward.condition}`,
    evidence: reward.sourceLabel,
    stamp,
    selfReported,
    summary: DISTRICT_SUMMARY[districtId], stands, additions, providerLocked, court,
    art: `assets/area-cards/${districtId}.png`,
  };
}
