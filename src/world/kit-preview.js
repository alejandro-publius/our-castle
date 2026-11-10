import * as THREE from 'three';
import { FAMILY_PROJECT_SITE as SITE } from '../core/family-project.js';
import { PLAN_GROUND, PREVIEW_LOOKS, layoutPreview } from '../core/kit-preview.js';

// A compared kit as a temporary arrangement in the west meadow: a pale plan ground on the strip behind the family
// project's own plot, staked and strung like the survey stage, with one block of simple shapes per line of the kit.
// The arrangement is drawn to fit that strip, so it reads as a laid-out plan, smaller than life.
// - It is a picture of a plan, never of progress: it lives in its own group, beside the funded campsite and never on it,
//   and is removed whole when the preview closes. Nothing here reads or changes the project's stage.
// - It is drawn from the same shared geometry and palette as every district (the scene's `part`), in colours the world
//   already uses, so it adds no geometry or material of its own and nothing accumulates across previews.
// - Shapes say only what the comparison says: the example's invented listings have simple shapes of their own, every
//   other listing is a plain crate. A kit that does not fit is drawn pale with red pennants.
// - It is still: nothing moves, so reduced motion needs no special case.
export function createKitPreview({ part, colours: C }) {
  const G = .25; // the clearing's ground level, as the family project uses
  const SHOP_TAGS = [C.blue, C.gold, C.leaf, C.cream]; // one tag colour per shop, in the order the shops appear in the kit
  let shown = null;

  // One drawn object, standing at (x, z) on the plan ground. `tone` maps a colour to the pale palette when the kit does not fit.
  function at(parent, x, z, scale = 1) { const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale); parent.add(g); return g; }
  const SHAPES = {
    // A dome: one faceted mound in the household colour, a dark door and a cream band.
    'tent-dome': (g, tone, flag) => {
      part(g, 'rock', 0, .1, 0, 3.0, 2.7, 3.0, tone(flag));
      part(g, 'box', 0, .42, 1.34, .8, .82, .12, tone(C.dark)); part(g, 'round', 0, .16, 0, 3.05, .1, 3.05, tone(C.cream));
      part(g, 'rock', 0, 1.5, 0, .2, .2, .2, tone(C.gold));
    },
    // A low ridge tent: a small gable, its ridge line and two pegged guy lines.
    'tent-light': (g, tone, flag) => {
      part(g, 'gable', 0, .58, 0, 2.0, 1.15, 2.8, tone(flag));
      part(g, 'box', 0, .3, 1.42, .6, .6, .08, tone(C.dark)); part(g, 'box', 0, 1.14, 0, .12, .08, 2.9, tone(C.cream));
      for (const s of [-1, 1]) part(g, 'box', s * 1.02, .06, 0, .1, .12, .1, tone(C.wood));
    },
    // A rectangular bag laid flat, with a pillow end.
    'bag-synthetic': (g, tone) => {
      part(g, 'box', 0, .14, .1, .82, .26, 1.7, tone(C.blue)); part(g, 'box', 0, .16, -.84, .7, .3, .3, tone(C.cream));
      part(g, 'box', 0, .28, .1, .84, .03, .08, tone(C.cream));
    },
    // A tapered bag: wide at the shoulders, narrow at the feet, with a hood.
    'bag-down': (g, tone) => {
      part(g, 'box', 0, .16, -.2, .74, .3, .9, tone(C.red)); part(g, 'box', 0, .14, .5, .5, .26, .7, tone(C.red));
      part(g, 'rock', 0, .22, -.76, .5, .34, .36, tone(C.cream));
    },
    // A two-burner stove on legs.
    'stove-camp': (g, tone) => {
      part(g, 'box', 0, .56, 0, 1.24, .22, .84, tone(C.stone));
      for (const sx of [-1, 1]) { for (const sz of [-1, 1]) part(g, 'box', sx * .52, .24, sz * .32, .08, .48, .08, tone(C.dark)); part(g, 'round', sx * .32, .7, 0, .38, .08, .38, tone(C.dark)); }
      part(g, 'box', 0, .52, .44, .5, .1, .05, tone(C.gold));
    },
    // A single burner on a small canister.
    'stove-compact': (g, tone) => {
      part(g, 'round', 0, .2, 0, .5, .4, .5, tone(C.red)); part(g, 'round', 0, .46, 0, .22, .14, .22, tone(C.dark));
      part(g, 'round', 0, .58, 0, .62, .07, .62, tone(C.stone));
    },
    // A plain banded crate: one item whose shape is not known (including items supplied in a pack).
    crate: (g, tone) => {
      part(g, 'box', 0, .45, 0, .9, .9, .9, tone(C.soil));
      for (const y of [.15, .45, .75]) part(g, 'box', 0, y, 0, .96, .1, .96, tone(C.cream));
    },
  };

  // The plan ground: a pale sheet, six stakes with pennants and a string around them, as the survey stage marks a plot.
  function ground(g, fits) {
    const { w, d } = PLAN_GROUND, sheet = fits ? C.cream : C.dust, pennant = fits ? C.gold : C.red;
    part(g, 'box', 0, G + .03, 0, w, .06, d, sheet);
    part(g, 'box', 0, G + .035, 0, w - .24, .065, d - .24, fits ? C.dust : C.dustStone);
    const posts = [[-w / 2, -d / 2], [0, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [0, d / 2], [-w / 2, d / 2]];
    posts.forEach(([x, z], i) => {
      part(g, 'box', x, G + .5, z, .14, 1.0, .14, C.wood); part(g, 'box', x + .2, G + .86, z, .38, .24, .05, pennant);
      const [nx, nz] = posts[(i + 1) % posts.length], dx = nx - x, dz = nz - z;
      part(g, 'box', (x + nx) / 2, G + .8, (z + nz) / 2, Math.hypot(dx, dz), .04, .04, C.cream, -Math.atan2(dz, dx));
    });
  }
  // A kept line is pegged down: four pegs and a string around it. A switched line stands on a gold tile.
  function kept(g, look) {
    const x = look.w / 2 + .14, z = look.d / 2 + .14;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, 'box', sx * x, .2, sz * z, .1, .4, .1, C.wood);
    for (const s of [-1, 1]) { part(g, 'box', 0, .34, s * z, 2 * x, .04, .04, C.cream); part(g, 'box', s * x, .34, 0, .04, .04, 2 * z, C.cream); }
  }
  const switched = (g, look) => part(g, 'box', 0, .035, 0, look.w + .36, .05, look.d + .36, C.gold);
  function tag(g, x, z, shop) {
    part(g, 'box', x, .45, z, .1, .9, .1, C.wood); part(g, 'box', x, .78, z + .04, .4, .28, .06, SHOP_TAGS[shop % SHOP_TAGS.length]);
  }

  return {
    /**
     * Draw one preview scene (core/kit-preview.js previewScene) into `group`, which holds nothing else. `flag` is the
     * household crest colour, as the family's own tents use.
     */
    build(group, scene, flag) {
      const root = new THREE.Group(); root.name = 'kit-preview';
      root.position.set(SITE.x + PLAN_GROUND.x, 0, SITE.z + PLAN_GROUND.z); group.add(root);
      const fits = scene.fits === true;
      // A kit that does not fit keeps its shapes and loses its colours.
      const pale = new Map([[C.dark, C.dustStone], [C.soil, C.dustStone], [C.wood, C.dustStone], [C.stone, C.dustStone]]);
      const tone = fits ? (colour) => colour : (colour) => pale.get(colour) ?? C.dust;
      ground(root, fits);
      const layout = layoutPreview(scene);
      const stage = new THREE.Group(); stage.position.y = G + .06; stage.scale.setScalar(layout.scale); root.add(stage);
      for (const row of layout.rows) {
        const look = PREVIEW_LOOKS[row.item.look] ?? PREVIEW_LOOKS.crate, draw = SHAPES[row.item.look] ?? SHAPES.crate;
        tag(stage, row.tag.x, row.tag.z, row.item.shop);
        for (const place of row.places) {
          const g = at(stage, place.x, place.z);
          if (row.item.switched) switched(g, look);
          draw(g, tone, flag);
          if (row.item.kept) kept(g, look);
        }
      }
      shown = { fits, scale: Number(layout.scale.toFixed(4)), items: scene.items.map(({ look, count, shown: drawn, shop, kept: k, switched: s }) => ({ look, count, shown: drawn, shop, kept: k, switched: s })) };
      return root;
    },
    reset() { shown = null; },
    debug: () => (shown ? { ...shown, items: shown.items.map((i) => ({ ...i })) } : null),
  };
}
