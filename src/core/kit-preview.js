// The kit preview on the map, as pure data: which compared kit a preview shows, and what the meadow draws for it.
// A preview is a picture of a plan. It reads the server's comparison answer the page already holds (server/kit/planner.mjs)
// and nothing else: it makes no request, saves nothing and changes no figure. Shared and dependency-free, so the page, the
// scene and the tests agree.

/**
 * The shapes the scene can draw, with the ground each one takes (w across, d deep, h tall, in the meadow's own units).
 * - The six example shapes belong to the playable family-trip example's invented listings (scripts/family-trip.mjs), whose
 *   meaning is authored and known. They are simple illustrations, never a product's real form.
 * - Every other listing is a plain crate: a live or typed listing has no known shape, so none is invented for it.
 */
export const PREVIEW_LOOKS = Object.freeze({
  'tent-dome': Object.freeze({ w: 3.1, d: 3.1, h: 1.5 }),
  'tent-light': Object.freeze({ w: 2.1, d: 2.9, h: 1.15 }),
  'bag-synthetic': Object.freeze({ w: .9, d: 2.0, h: .5 }),
  'bag-down': Object.freeze({ w: .78, d: 1.8, h: .45 }),
  'stove-camp': Object.freeze({ w: 1.3, d: .9, h: .8 }),
  'stove-compact': Object.freeze({ w: .7, d: .7, h: .7 }),
  crate: Object.freeze({ w: .95, d: .95, h: .95 }),
});
/** The example catalogue's listings, by their exact titles. A unit test keeps this in step with the example's own list. */
export const SAMPLE_LOOKS = Object.freeze({
  'Sample: Dome tent, four-person': 'tent-dome',
  'Sample: Light tent, four-person': 'tent-light',
  'Sample: Sleeping bag, synthetic': 'bag-synthetic',
  'Sample: Sleeping bag, down': 'bag-down',
  'Sample: Camp stove': 'stove-camp',
  'Sample: Compact stove': 'stove-compact',
});
/**
 * Where the plan ground lies, relative to the family project's site: a strip behind the plot, on its right.
 * - Every stage of every project (campsite, garden, schoolhouse) leaves that strip empty, so the plan is never on the
 *   funded plot.
 * - The meadow's edge trees stand behind it and nothing built stands in front of it from the realm's usual view, so the
 *   plan is not hidden by what is funded. (The meadow's front and sides are hidden by its own edge trees.)
 * `frame` is what the camera shows while a preview is open on the project: the strip and the back of the plot.
 */
export const PLAN_GROUND = Object.freeze({ x: 5.0, z: -8.28, w: 5.6, d: 2.15, margin: .16,
  frame: Object.freeze({ x: 2.6, z: -5.4, width: 10, depth: 8, height: 4 }) });
export const PREVIEW_LIMITS = Object.freeze({ perLine: 6 });

/** A kit's identity: which listing it takes for each line. Two cards with the same picks are the same arrangement. */
export const picksOf = (card) => card.lines.map((l) => `${l.lineId}=${l.candidateId}`).sort().join('|');

/**
 * Which card of the current comparison answer a preview shows, given the kit the family asked to see (`anchor`, a
 * picksOf value). The preview follows that kit:
 * - 'chosen': it is the family's saved chosen kit, and it fits;
 * - 'proposal': it is the chosen kit and it no longer fits, and the planner has a smallest change. That change is shown
 *   instead (`from` is the chosen kit). The saved choice itself is not changed by this;
 * - 'chosen-late': it is the chosen kit, it does not fit and nothing does;
 * - 'kit': another kit that fits;
 * - 'closest': no kit fits, and it is the closest complete kit.
 * Anything else cannot be matched safely: `card` is null and `reason` says why ('unmatched', or the answer's status).
 */
export function matchPreview(anchor, answer) {
  const none = (reason) => ({ card: null, role: null, reason });
  if (typeof anchor !== 'string' || !anchor || !answer) return none('gone');
  if (answer.status !== 'ok' && answer.status !== 'none_fits') return none(String(answer.status));
  const kits = Array.isArray(answer.kits) ? answer.kits : [];
  const same = (card) => Boolean(card) && picksOf(card) === anchor;
  if (same(answer.current)) {
    if (answer.current.fits) return { card: kits.find(same) ?? answer.current, role: 'chosen' };
    const repair = kits.find((k) => k.labels.includes('smallest_change'));
    return repair ? { card: repair, role: 'proposal', from: answer.current } : { card: answer.current, role: 'chosen-late' };
  }
  const kit = kits.find(same);
  if (kit) return { card: kit, role: 'kit' };
  if (answer.status === 'none_fits' && same(answer.closest)) return { card: answer.closest, role: 'closest' };
  return none('unmatched');
}

/**
 * What the meadow draws for one card: per line, a shape, how many are bought (and how many of them are drawn), which
 * shop it comes from (the order shops first appear in the kit), and whether the line is kept or switched. `sample` is
 * true only when Market Town answers from the example catalogue: only then may a listing have a shape of its own.
 */
export function previewScene(card, { sample = false } = {}) {
  const shops = [];
  const shopOf = (merchant) => { if (!shops.includes(merchant)) shops.push(merchant); return shops.indexOf(merchant); };
  return {
    fits: card.fits === true,
    items: card.lines.map((l) => {
      const count = Number.isSafeInteger(l.bought) && l.bought > 0 ? l.bought : 1;
      const look = sample && Object.hasOwn(SAMPLE_LOOKS, l.title) ? SAMPLE_LOOKS[l.title] : 'crate';
      return { lineId: l.lineId, look, count, shown: Math.min(count, PREVIEW_LIMITS.perLine), shop: shopOf(l.merchant), kept: l.kept === true, switched: Boolean(l.switched) };
    }),
  };
}

/**
 * Where each drawn item stands on the plan ground, in the ground's own coordinates (its centre is 0,0; x along the
 * strip, z from its back to its front). One block per line, side by side along the strip, taller shapes first so that
 * none hides a smaller one from the realm's usual view; a block stacks its items from back to front and starts another
 * column when the strip is not deep enough. The arrangement is drawn at the largest scale, at most 1, at which every
 * shape fits the strip's depth and all the blocks fit its length. Returns
 * { scale, rows: [{ item, tag: { x, z }, places: [{ x, z }] }] }, in unscaled units (the scene scales the whole stage).
 */
export function layoutPreview(scene, ground = PLAN_GROUND) {
  const gap = .3, blockGap = .46, length = ground.w - 2 * ground.margin, depth = ground.d - 2 * ground.margin;
  const ordered = scene.items.map((item, index) => ({ item, index, look: PREVIEW_LOOKS[item.look] ?? PREVIEW_LOOKS.crate }))
    .sort((a, b) => b.look.h - a.look.h || a.index - b.index);
  const blocksAt = (scale) => ordered.map(({ item, look }) => {
    const perColumn = Math.max(1, Math.min(item.shown, Math.floor((depth / scale + gap) / (look.d + gap))));
    const columns = Math.ceil(item.shown / perColumn);
    return { item, look, perColumn, width: columns * look.w + (columns - 1) * gap };
  });
  const totalOf = (blocks) => blocks.reduce((sum, b) => sum + b.width, 0) + Math.max(0, blocks.length - 1) * blockGap;
  const fits = (scale) => ordered.every(({ look }) => look.d * scale <= depth) && totalOf(blocksAt(scale)) * scale <= length;
  let scale = 1;
  while (scale > .1 && !fits(scale)) scale = Math.round((scale - .01) * 100) / 100;
  const blocks = blocksAt(scale);
  let x = -totalOf(blocks) / 2;
  const rows = blocks.map((b) => {
    const places = [];
    for (let i = 0; i < b.item.shown; i++) {
      const column = Math.floor(i / b.perColumn), inColumn = Math.min(b.perColumn, b.item.shown - column * b.perColumn), k = i % b.perColumn;
      const span = inColumn * b.look.d + (inColumn - 1) * gap;
      places.push({ x: x + column * (b.look.w + gap) + b.look.w / 2, z: -span / 2 + k * (b.look.d + gap) + b.look.d / 2 });
    }
    // The shop tag stands on the strip's front edge, at the start of its block.
    const row = { item: b.item, tag: { x: x + .12, z: ground.d / 2 / scale }, places };
    x += b.width + blockGap;
    return row;
  });
  return { scale, rows };
}
