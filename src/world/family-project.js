import * as THREE from 'three';
import { FAMILY_PROJECT_SITE as SITE } from '../core/family-project.js';

// The family project in the west meadow (the campsite, the garden or the schoolhouse the family chose), drawn from the
// same shared geometry/material batches as every district. Its stage comes from the pure core module; this file only
// decides what each stage looks like. Every place keeps one footprint from its first stakes to its last stage, so the
// building under construction is the one that is finished later. The campfire's flame and smoke are the only live parts
// and move on the realm's existing ambient clock, so reduced motion keeps them still; the garden and schoolhouse are still.
export function createFamilyProject({ part, models, colours: C }) {
  const G = .25; // the clearing's ground level
  const box = (g, x, y, z, w, h, d, c, ry = 0, rz = 0) => part(g, 'box', x, G + y, z, w, h, d, c, ry, rz);
  const round = (g, x, y, z, w, h, d, c, ry = 0, rz = 0) => part(g, 'round', x, G + y, z, w, h, d, c, ry, rz);
  const rock = (g, x, y, z, w, h, d, c, ry = 0, rz = 0) => part(g, 'rock', x, G + y, z, w, h, d, c, ry, rz);
  const cone = (g, x, y, z, w, h, d, c, ry = 0, rz = 0) => part(g, 'cone', x, G + y, z, w, h, d, c, ry, rz);
  const gable = (g, x, y, z, w, h, d, c, ry = 0) => part(g, 'gable', x, G + y, z, w, h, d, c, ry);
  // A cylinder from a to b (ground-relative y), the same orientation rule the Citadel stag uses.
  const rod = (g, a, b, w, c) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
    part(g, 'round', (a[0] + b[0]) / 2, G + (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, w, len, w, c, Math.atan2(dz, -dx), Math.acos(Math.max(-1, Math.min(1, dy / len))));
  };
  const live = (parent, x, y, z) => { const g = new THREE.Group(); g.userData.live = true; g.position.set(x, G + y, z); parent.add(g); return g; };
  let flame = null, puffs = [], built = null, elapsed = 0, last = null, ticks = 0;
  // The estate models' own colours (estate-models.js), so the new places share their materials and palette family.
  const E = { leaf2: 0xa3b97c, brick: 0x9c5948, roofDark: 0x713c3e, slate: 0x3f6388, slateShade: 0x26405f, stone2: 0x88978d, water2: 0x91c9d0, iron: 0x374d56, flower: 0xd9b0b9, purple: 0x81739c, wheat: 0xcfb46c };
  // Named parts of the current build, for the scene's debug read-out (and its tests); never shown to the family.
  const mark = (name) => built?.features.push(name);

  // ---------- Shared pieces ----------
  function path(g) { for (let i = 0; i < 6; i++) box(g, 5.7 + i * 1.1, .04, .3 + Math.sin(i * 1.3) * .3, 1.15, .07, 1.5, C.dust); }
  function signpost(g, flag) {
    box(g, 6.6, 1.0, 2.7, .16, 2.0, .16, C.wood); box(g, 6.6, 2.0, 2.7, 1.15, .6, .1, C.cream); box(g, 6.6, 2.32, 2.7, 1.25, .08, .14, C.wood);
    models.shield(g, 6.6, G + 1.98, 2.78, flag, .62);
  }
  function stonePile(g, x, z) { rock(g, x, .3, z, .9, .5, .8, C.stone); rock(g, x + .5, .3, z + .3, .6, .4, .6, C.dustStone); rock(g, x + .1, .72, z + .15, .55, .4, .5, C.stone); }
  function crate(g, x, z, ry) { box(g, x, .45, z, .9, .9, .9, C.soil, ry); for (const y of [.15, .45, .75]) box(g, x, y, z, .96, .1, .96, C.cream, ry); }
  function lumber(g, x, z) { for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) box(g, x + (j - (2 - i) / 2) * .46, .2 + i * .36, z, .42, .34, 2.6, C.wood); }
  function sawhorse(g, x, z, ry) {
    const h = new THREE.Group(); h.position.set(x, G, z); h.rotation.y = ry; g.add(h);
    for (const s of [-1, 1]) for (const t of [-1, 1]) part(h, 'box', s * .55, .45, t * .2, .1, .95, .1, C.wood, 0, -s * .28);
    part(h, 'box', 0, .95, 0, 1.6, .14, .14, C.wood);
  }
  function wheelbarrow(g, x, z, ry) {
    const w = new THREE.Group(); w.position.set(x, G, z); w.rotation.y = ry; g.add(w);
    part(w, 'box', 0, .6, 0, .85, .5, 1.3, C.wood, 0, 0); part(w, 'box', 0, .62, 0, .72, .54, 1.12, C.soil);
    part(w, 'round', 0, .3, -.78, .5, .12, .5, C.dark, 0, Math.PI / 2);
    for (const s of [-1, 1]) part(w, 'box', s * .3, .62, .95, .08, .08, .9, C.soil);
    part(w, 'rock', 0, .95, 0, .55, .35, .7, C.stone);
  }
  function tent(g, x, z, ry, colour) {
    const t = new THREE.Group(); t.position.set(x, G, z); t.rotation.y = ry; g.add(t);
    part(t, 'gable', 0, 1.0, 0, 2.9, 2.0, 3.2, colour);
    part(t, 'box', 0, .48, 1.58, .95, .95, .1, C.dark);
    part(t, 'box', 0, 1.98, 0, .18, .12, 3.3, C.cream); part(t, 'rock', 0, 2.1, 1.6, .2, .2, .2, C.gold);
    for (const s of [-1, 1]) { part(t, 'box', s * 1.95, .4, -.3, .05, .9, .05, C.cream, 0, s * .95); part(t, 'box', s * 2.4, .08, -.3, .3, .16, .12, C.wood); }
  }
  function fireRing(g, x, z) {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rock(g, x + Math.cos(a) * 1.35, .28, z + Math.sin(a) * 1.3, .62, .45, .5, i % 2 ? C.stone : C.dustStone); }
    round(g, x, .05, z, 2.3, .08, 2.3, C.soil);
    for (const a of [.3, 1.4, 2.5]) rod(g, [x - Math.cos(a) * .55, .32, z - Math.sin(a) * .55], [x + Math.cos(a) * .55, .34, z + Math.sin(a) * .55], .3, C.soil);
    flame = live(g, x, .5, z);
    part(flame, 'cone', 0, .62, 0, .95, 1.35, .85, models.roles.lamp);
    part(flame, 'cone', .12, .5, .08, .55, .95, .5, C.gold);
    part(flame, 'cone', -.14, .36, -.06, .3, .55, .3, C.red);
    for (let i = 0; i < 3; i++) { const p = live(g, x, 1.4, z); part(p, 'rock', 0, 0, 0, 1, .8, 1, C.cream); puffs.push(p); }
  }
  function benchLog(g, x, z, a) { rod(g, [x - Math.cos(a) * 1.1, .34, z - Math.sin(a) * 1.1], [x + Math.cos(a) * 1.1, .34, z + Math.sin(a) * 1.1], .44, C.wood); }
  function picnicTable(g, x, z, ry) {
    const t = new THREE.Group(); t.position.set(x, G, z); t.rotation.y = ry; g.add(t);
    part(t, 'box', 0, .95, 0, 2.6, .12, 1.1, C.wood);
    for (const s of [-1, 1]) { part(t, 'box', 0, .55, s * .95, 2.4, .1, .4, C.wood); part(t, 'box', s * .95, .5, 0, .12, 1.0, .12, C.soil); part(t, 'box', s * .95, .3, 0, .12, .6, 2.2, C.soil); }
    part(t, 'round', .5, 1.08, .1, .3, .14, .3, C.cream); part(t, 'rock', -.6, 1.1, -.2, .36, .2, .3, C.red);
  }
  function planter(g, x, z) {
    box(g, x, .2, z, 1.2, .36, .6, C.cream); box(g, x, .4, z, 1.05, .05, .48, C.soil);
    for (let k = 0; k < 3; k++) { rock(g, x - .35 + k * .35, .58, z, .34, .3, .34, C.leaf); rock(g, x - .35 + k * .35, .76, z, .17, .17, .17, [C.red, C.gold, C.blue][k]); }
  }
  function woodRack(g, x, z) {
    for (const s of [-1, 1]) box(g, x + s * .95, .5, z, .1, 1.0, .64, C.soil);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) rod(g, [x - .7 + i * .46, .2 + j * .3, z - .3], [x - .7 + i * .46, .2 + j * .3, z + .3], .26, j % 2 ? C.wood : C.soil);
  }
  function lanterns(g) { for (const [x, z] of [[-6.6, -5.8], [6.4, -5.8], [-6.6, 6.4]]) models.lantern(g, x, z, G - .05, true); }
  function flagpole(g, x, z, flag) { round(g, x, 2.4, z, .1, 4.8, .1, C.gold); rock(g, x, 4.85, z, .26, .26, .26, C.gold); box(g, x + .55, 4.35, z, 1.0, .6, .06, flag); rock(g, x, .12, z, .9, .25, .9, C.stone); }
  function pavilion(g, flag) {
    // An open pavilion south of the fire: gold posts, a tiled roof in the household colour and one long table.
    const px = 0.4, pz = 9.2;
    for (const x of [-2.7, 2.7]) for (const z of [-1.9, 1.9]) { round(g, px + x, 1.6, pz + z, .2, 3.2, .2, C.gold); rock(g, px + x, .1, pz + z, .6, .2, .6, C.stone); }
    box(g, px, 3.2, pz, 6.3, .16, 4.7, C.cream);
    models.roof(g, px, G + 3.95, pz, 6.6, 1.5, 5.0, flag, true);
    box(g, px, 1.0, pz, 4.2, .14, 1.2, C.wood);
    for (const s of [-1, 1]) { box(g, px, .52, pz + s * 1.0, 4.0, .1, .4, C.wood); for (const x of [-1.6, 1.6]) box(g, px + x, .42, pz + s * 1.0, .12, .84, .3, C.soil); }
    for (const x of [-1.8, 1.8]) box(g, px + x, .55, pz, .14, 1.0, 1.1, C.soil);
    [C.cream, C.gold, C.red, C.cream, C.blue].forEach((c, i) => round(g, px - 1.6 + i * .8, 1.12, pz, .28, .12, .28, c));
  }

  // Every place starts the same way: eight stakes and string around the plot, a stump with the rolled plan, stones.
  function stakes(g) {
    const pts = [[-5, -4.2], [0, -4.2], [5, -4.2], [5, 0], [5, 4.2], [0, 4.2], [-5, 4.2], [-5, 0]];
    pts.forEach(([x, z], i) => {
      box(g, x, .55, z, .2, 1.1, .2, C.wood); box(g, x, 1.0, z, .44, .18, .06, i % 2 ? C.red : C.cream);
      const [nx, nz] = pts[(i + 1) % pts.length], dx = nx - x, dz = nz - z;
      box(g, (x + nx) / 2, .96, (z + nz) / 2, Math.hypot(dx, dz), .045, .045, C.cream, -Math.atan2(dz, dx));
    });
    round(g, 2.4, .3, -3.2, 1.1, .6, 1.1, C.soil); round(g, 2.4, .62, -3.2, 1.0, .05, 1.0, C.wood);
    box(g, 2.4, .76, -3.2, .9, .2, .32, C.cream, .4); box(g, 2.2, .96, -3.1, .7, .14, .28, C.cream, -.3);
    stonePile(g, -4.6, -5.8);
    mark('stakes');
  }

  // ---------- Campsite stages ----------
  function survey(g, flag, detail) {
    stakes(g);
    if (detail) { signpost(g, flag); for (let i = 0; i < 3; i++) box(g, -1.5 + i * 1.6, .03, .2, 1.4, .06, 1.4, C.dust); }
  }
  function construction(g, flag, detail) {
    signpost(g, flag); mark(detail ? 'cabin:rafters' : 'cabin:frame');
    box(g, 0, .12, -1.2, 6.8, .24, 5.4, C.stone); box(g, 0, .26, -1.2, 6.4, .06, 5.0, C.cream);
    for (const x of [-2.9, 2.9]) for (const z of [-3.5, 1.1]) box(g, x, 1.45, z, .3, 2.7, .3, C.wood);
    for (const z of [-3.5, 1.1]) box(g, 0, 2.85, z, 6.1, .26, .26, C.wood);
    for (const x of [-2.9, 2.9]) box(g, x, 2.85, -1.2, .26, .26, 4.9, C.wood);
    sawhorse(g, -5.3, 3.2, .15); sawhorse(g, -5.3, 6.0, .15); box(g, -5.3, 1.08, 4.6, .55, .08, 3.6, C.cream, .15);
    lumber(g, 5.4, 5.4); crate(g, 4.3, -5.2, .3); crate(g, 5.4, -5.7, -.2); crate(g, 4.9, -5.45, .1, 1); wheelbarrow(g, -3.6, -5.2, .5); stonePile(g, -6.2, -2.2);
    round(g, 3.9, .35, 2.4, .62, .7, .62, C.stone); round(g, 3.9, .72, 2.4, .5, .04, .5, C.water);
    if (detail) {
      // Rafters and the first half walls, and the family pitches a tent while the walls go up.
      const pitch = Math.atan2(1.6, 3.2);
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(g, s * 1.55, 3.55, -3.5 + i * 1.15, 3.6, .16, .16, C.wood, 0, -s * pitch);
      box(g, 0, 4.35, -1.2, .2, .2, 5.0, C.wood);
      box(g, 0, .85, -3.5, 6.0, 1.2, .22, C.cream); for (const x of [-2.9, 2.9]) box(g, x, .85, -1.2, .22, 1.2, 4.6, C.cream); box(g, -1.9, .85, 1.1, 2.2, 1.2, .22, C.cream);
      tent(g, 5.2, 3.3, -.3, flag);
    }
  }
  function furnished(g, flag, detail) {
    signpost(g, flag); mark('cabin'); mark('campfire');
    models.cottage(g, 0, -1.2, { w: 4.2, h: 2.2, d: 3.4, roofColor: C.red, shutters: C.blue });
    tent(g, 5.4, 3.6, -.35, flag); tent(g, -5.8, 2.6, .45, C.cream);
    fireRing(g, 0, 4.3);
    for (const a of [.55, 2.2, 3.9]) benchLog(g, Math.cos(a + Math.PI / 2) * 2.7, 4.3 + Math.sin(a + Math.PI / 2) * 2.6, a);
    picnicTable(g, -5.2, -4.4, .2); woodRack(g, 4.8, -4.9);
    if (detail) { lanterns(g); for (const x of [-1.5, 1.5]) planter(g, x, .95); box(g, 3.4, .03, .9, 2.2, .05, 1.4, C.gold, .2); }
  }
  function gathering(g, flag) {
    furnished(g, flag, true);
    for (const a of [1.0, 3.1, 4.8]) benchLog(g, Math.cos(a + Math.PI / 2) * 2.9, 4.3 + Math.sin(a + Math.PI / 2) * 2.8, a);
    pavilion(g, flag); flagpole(g, -6.8, 9.4, flag); mark('pavilion');
    models.bunting(g, 3.0, 1.2, 3.1, 7.3, [C.red, C.gold, C.blue], 3.0); models.bunting(g, -3.0, 1.2, -2.3, 7.3, [C.blue, C.gold, C.red], 3.0);
    models.lantern(g, 6.4, 6.4, G - .05, true);
  }

  // ---------- Small props shared by the garden and the schoolhouse ----------
  function tree(g, x, z, s = 1, fruit = null) {
    round(g, x, .8 * s, z, .34 * s, 1.6 * s, .34 * s, C.soil);
    rock(g, x, 2.05 * s, z, 2.1 * s, 1.7 * s, 2.0 * s, C.leaf); rock(g, x + .45 * s, 2.55 * s, z - .2 * s, 1.4 * s, 1.2 * s, 1.3 * s, C.pine);
    if (fruit) for (const [dx, dy, dz] of [[.75, 1.85, .55], [-.6, 2.25, .75], [.2, 2.8, .85], [-.85, 1.75, -.2], [.95, 2.35, -.3], [-.2, 1.6, .9]]) rock(g, x + dx * s, dy * s, z + dz * s, .22, .22, .22, fruit);
  }
  function bench(g, x, z, ry) {
    const b = new THREE.Group(); b.position.set(x, G, z); b.rotation.y = ry; g.add(b);
    part(b, 'box', 0, .5, 0, 1.7, .1, .5, C.wood); part(b, 'box', 0, .92, -.22, 1.7, .34, .08, C.wood);
    for (const s of [-1, 1]) { part(b, 'box', s * .7, .25, .14, .1, .5, .1, C.soil); part(b, 'box', s * .7, .56, -.22, .1, 1.12, .1, C.soil); }
  }
  function waterButt(g, x, z) {
    round(g, x, .5, z, .8, 1.0, .8, C.wood); for (const y of [.22, .78]) round(g, x, y, z, .85, .07, .85, C.soil);
    round(g, x, 1.02, z, .68, .04, .68, C.water);
  }
  function wallLamp(g, x, y, z) { box(g, x, y + .2, z - .08, .07, .07, .2, E.iron); box(g, x, y, z, .2, .26, .2, models.roles.lamp); cone(g, x, y + .2, z, .3, .16, .3, E.iron); }

  // ---------- Garden: a timber glasshouse behind four stone-edged beds, a bird bath where the paths cross ----------
  // The glasshouse runs along x north of the main path, its door facing the beds; one footprint for every stage.
  const GH = { x: -1, z: -3.5, l: 6.4, w: 3.4, base: .5, wall: 2.0, roof: 1.3 };
  const BEDS = [[-2.8, 2.6], [.8, 2.6], [-2.8, 6.0], [.8, 6.0]], BED = { w: 2.6, d: 2.2 };
  // Per bed: the row greens and what grows on them (tomatoes, squash, a flower bed, herbs and beans).
  const CROPS = [[C.leaf, C.red], [E.leaf2, C.gold], [C.leaf, E.flower], [C.pine, E.purple]];
  const GLASS = E.water2;
  function greenhouse(g, level) {
    const { x, z, l, w, base, wall, roof } = GH, top = base + wall, front = z + w / 2, back = z - w / 2, left = x - l / 2, right = x + l / 2;
    const run = (x1, x2, zz, h, d, c) => box(g, (x1 + x2) / 2, h / 2, zz, x2 - x1, h, d, c);
    // Fieldstone knee wall with a coping, open where the door will be.
    run(left, right, back, base, .32, C.stone); run(left, x - .62, front, base, .32, C.stone); run(x + .62, right, front, base, .32, C.stone);
    for (const xx of [left, right]) box(g, xx, base / 2, z, .32, base, w, C.stone);
    for (const [x1, x2, zz] of [[left - .06, right + .06, back], [left - .06, x - .62, front], [x + .62, right + .06, front]]) box(g, (x1 + x2) / 2, base + .04, zz, x2 - x1, .08, .42, C.dustStone);
    for (const xx of [left, right]) box(g, xx, base + .04, z, .42, .08, w, C.dustStone);
    mark(`greenhouse:${level}`);
    if (level === 'base') return;
    // Timber frame: posts, eave plates and the door frame.
    for (const xx of [left, left + l / 4, x + l / 4, right]) for (const zz of [back, front]) box(g, xx, base + wall / 2, zz, .18, wall, .18, C.wood);
    box(g, x, base + wall / 2, back, .18, wall, .18, C.wood);
    for (const xx of [left, right]) box(g, xx, base + wall / 2, z, .18, wall, .18, C.wood);
    for (const zz of [back, front]) box(g, x, top, zz, l + .16, .12, .16, C.wood);
    for (const xx of [left, right]) box(g, xx, top, z, .16, .12, w, C.wood);
    for (const s of [-1, 1]) box(g, x + s * .6, top / 2, front, .14, top, .16, C.wood);
    if (level === 'frame') return;
    // Rafters at the roof's own pitch and the ridge. The rafters stand proud of the glass as glazing bars later.
    const half = w / 2 + .1, pitch = Math.atan2(roof, half), slope = Math.hypot(roof, half) + .04;
    for (let i = 0; i <= 6; i++) for (const s of [-1, 1]) box(g, left + i * l / 6, top + roof / 2 + .03, z + s * half / 2, slope, .08, .1, C.wood, Math.PI / 2, s * pitch);
    box(g, x, top + roof + .04, z, l + .3, .12, .16, C.wood);
    if (level === 'rafters') {
      // The first glass: the back wall and the west gable.
      box(g, x, base + wall / 2, back - .02, l - .1, wall - .06, .05, GLASS);
      box(g, left - .02, base + wall / 2, z, .05, wall - .06, w - .1, GLASS); gable(g, left - .02, top + roof / 2, z, w, roof, .05, GLASS, Math.PI / 2);
      return;
    }
    // Glazed: glass walls, gable ends and roof, a cream mid rail, the half-glass door and an opened roof vent.
    box(g, x, base + wall / 2, back - .02, l - .1, wall - .06, .05, GLASS);
    for (const [x1, x2] of [[left, x - .6], [x + .6, right]]) {
      box(g, (x1 + x2) / 2, base + wall / 2, front + .02, x2 - x1 - .08, wall - .06, .05, GLASS);
      box(g, (x1 + x2) / 2, base + wall * .55, front + .06, x2 - x1, .06, .04, C.cream);
    }
    box(g, x, base + wall * .55, back - .06, l, .06, .04, C.cream);
    for (const xx of [left, right]) {
      const out = xx === left ? -.02 : .02;
      box(g, xx + out, base + wall / 2, z, .05, wall - .06, w - .1, GLASS); gable(g, xx + out, top + roof / 2, z, w, roof, .05, GLASS, Math.PI / 2);
      box(g, xx + out * 3, base + wall * .55, z, .04, .06, w, C.cream);
    }
    gable(g, x, top + roof / 2, z, w + .2, roof, l + .1, GLASS, Math.PI / 2);
    box(g, x, top + .03, front + .02, 1.24, .14, .2, C.wood);
    box(g, x, base + 1.0 - base / 2, front + .03, .98, 1.86, .06, C.wood);
    box(g, x, 1.32, front + .07, .7, .76, .03, models.roles.glass); box(g, x, .5, front + .07, .7, .62, .03, C.soil);
    box(g, x, 2.22, front + .02, 1.0, .5, .05, GLASS);
    box(g, x, .06, front + .45, 1.4, .12, .55, C.stone);
    box(g, x + 1.7, top + roof * .62, z + half * .36, 1.0, .05, .9, GLASS, Math.PI / 2, pitch + .45);
  }
  function gardenBed(g, [bx, bz], level, crops) {
    const { w, d } = BED;
    if (level === 'outline') { box(g, bx, .03, bz, w, .06, d, C.dust); return; }
    // Stone edging in alternating weathered stones, filled with soil.
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(g, bx - w / 2 + (i + .5) * w / 5, .17, bz + s * d / 2, w / 5 - .05, .3, .28, (i + (s > 0)) % 2 ? C.stone : C.dustStone);
    for (let j = 0; j < 4; j++) for (const s of [-1, 1]) box(g, bx + s * w / 2, .17, bz - d / 2 + (j + .5) * d / 4, .28, .3, d / 4 - .05, (j + (s < 0)) % 2 ? C.stone : C.dustStone);
    box(g, bx, .2, bz, w - .26, .24, d - .26, C.soil);
    if (level === 'soil') return;
    const [green, crop] = crops;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const px = bx - w / 2 + .52 + c * (w - 1.04) / 3, pz = bz - d / 2 + .5 + r * (d - 1) / 2;
      if (level === 'seedlings') { rock(g, px, .42, pz, .22, .2, .22, C.leaf); continue; }
      rock(g, px, .54, pz, .5, .44, .5, (r + c) % 2 ? green : C.leaf);
      if ((r + c) % 2 === 0 || level === 'bloom') rock(g, px + .14, .74, pz + .12, .17, .17, .17, crop);
      if (level === 'bloom' && c % 2) rock(g, px - .14, .78, pz - .1, .15, .15, .15, [E.flower, C.gold, C.cream][r]);
    }
  }
  function birdBath(g, x, z, bird) {
    round(g, x, .12, z, .9, .24, .9, C.dustStone); round(g, x, .58, z, .3, .7, .3, C.stone);
    round(g, x, .98, z, 1.15, .16, 1.15, C.stone); round(g, x, 1.07, z, .9, .04, .9, C.water);
    if (bird) { rock(g, x + .44, 1.18, z + .12, .2, .18, .28, C.soil); rock(g, x + .48, 1.3, z + .22, .13, .13, .13, C.soil); }
    mark('bird-bath');
  }
  function roseArch(g, x, z) {
    // Two posts either side of the main path and a rounded top, climbing roses in bloom.
    const span = .9, h = 2.0;
    for (const s of [-1, 1]) box(g, x, h / 2, z + s * span, .14, h, .14, C.wood);
    const pts = Array.from({ length: 7 }, (_, i) => { const a = Math.PI * i / 6; return [x, h + Math.sin(a) * .62, z + Math.cos(a) * span]; });
    for (let i = 0; i < 6; i++) rod(g, pts[i], pts[i + 1], .12, C.wood);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) { const y = .4 + i * .2; rock(g, x + .08 * s, y, z + s * span + .06 * Math.sin(i), .26, .24, .26, i % 3 ? C.leaf : E.leaf2); if (i % 2) rock(g, x + .12 * s, y + .06, z + s * span, .15, .15, .15, i % 4 === 1 ? C.red : E.flower); }
    pts.forEach(([px, py, pz], i) => { rock(g, px, py + .08, pz, .3, .22, .3, C.leaf); rock(g, px + .1, py + .2, pz, .15, .15, .15, i % 2 ? C.red : E.flower); });
    mark('rose-arch');
  }
  function seedTray(g, x, z) { box(g, x, .12, z, 1.2, .24, .7, C.wood); for (let i = 0; i < 4; i++) for (const dz of [-.15, .15]) rock(g, x - .42 + i * .28, .3, z + dz, .16, .18, .16, C.leaf); }
  function seedSack(g, x, z) { rock(g, x, .38, z, .72, .74, .62, E.wheat); round(g, x, .76, z, .28, .14, .28, C.cream); box(g, x, .44, z + .3, .3, .22, .03, C.leaf); }
  function spade(g, x, z) { box(g, x, .4, z, .3, .5, .05, E.iron); box(g, x, 1.1, z, .07, 1.0, .07, C.wood); box(g, x, 1.62, z, .32, .08, .08, C.wood); }
  function paneCrate(g, x, z) { crate(g, x, z, .2); for (let k = 0; k < 4; k++) box(g, x - .27 + k * .18, 1.1, z, .04, .64, .7, GLASS, .2); }
  function compostBin(g, x, z) { box(g, x, .38, z, 1.0, .76, 1.0, C.wood); for (const y of [.2, .48, .74]) box(g, x, y, z, 1.06, .12, 1.06, C.soil); rock(g, x, .82, z, .8, .3, .8, C.soil); }
  function pots(g, x, z) { for (const [dx, c] of [[0, E.brick], [.5, C.red], [-.45, E.brick]]) { round(g, x + dx, .2, z + Math.abs(dx) * .3, .36, .4, .36, c); rock(g, x + dx, .52, z + Math.abs(dx) * .3, .4, .36, .4, C.leaf); } }
  function gardenPaths(g, cross) {
    box(g, .25, .03, .2, 10.9, .06, 1.2, C.dust); box(g, GH.x, .03, -1.1, 1.0, .06, 1.4, C.dust);
    if (cross) { box(g, -1.0, .035, 4.3, 1.0, .06, 5.6, C.dust); box(g, -1.0, .035, 4.3, 6.2, .06, 1.2, C.dust); }
  }

  function gardenSurvey(g, flag, detail) {
    stakes(g); seedSack(g, 2.7, -.9); seedSack(g, 3.4, -.4); spade(g, 1.8, -1.3); seedTray(g, 3.1, .9); mark('seed-sack');
    if (detail) { signpost(g, flag); for (const b of BEDS) gardenBed(g, b, 'outline'); box(g, GH.x, .03, GH.z, GH.l, .06, GH.w, C.dust); }
  }
  function gardenConstruction(g, flag, detail) {
    signpost(g, flag);
    greenhouse(g, detail ? 'rafters' : 'frame');
    BEDS.forEach((b, i) => gardenBed(g, b, detail ? (i < 2 ? 'seedlings' : 'soil') : (i < 2 ? 'soil' : 'outline'), CROPS[i]));
    mark(`beds:${detail ? 'seedlings' : 'edged'}`);
    paneCrate(g, 4.4, -4.8); crate(g, 5.4, -5.5, -.2); lumber(g, 5.4, 5.6); sawhorse(g, -5.6, 2.2, .2);
    wheelbarrow(g, 3.4, 2.4, -.5); stonePile(g, -6.2, -2.4); waterButt(g, 2.9, -2.2);
    if (detail) { gardenPaths(g, false); round(g, 2.8, .25, 1.15, .5, .4, .4, E.iron); box(g, 3.15, .36, 1.15, .4, .06, .06, E.iron, 0, .5); }
  }
  function gardenPlanted(g, flag, detail, bloom = false) {
    signpost(g, flag);
    greenhouse(g, 'glazed');
    BEDS.forEach((b, i) => gardenBed(g, b, bloom ? 'bloom' : 'planted', CROPS[i]));
    mark(`beds:${bloom ? 'bloom' : 'planted'}`);
    gardenPaths(g, true); birdBath(g, -1.0, 4.3, bloom);
    waterButt(g, 2.9, -2.2); compostBin(g, 4.6, -4.6); pots(g, -2.3, -1.2);
    if (detail) {
      lanterns(g); mark('lanterns');
      for (const x of [2.9, 6.3]) planter(g, x, -.95); bench(g, 3.6, 2.6, -.5);
    }
  }
  function gardenBloom(g, flag) {
    gardenPlanted(g, flag, true, true);
    roseArch(g, 4.6, .2); tree(g, 4.6, 5.4, .95, C.red); tree(g, -6.4, 3.6, .85, C.gold); mark('fruit-trees');
    flagpole(g, -6.6, -.9, flag); mark('flag');
    models.bunting(g, -4.8, 1.25, 3.4, 1.25, [C.red, C.gold, E.flower], 2.8); mark('bunting');
    models.lantern(g, 6.4, 6.4, G - .05, true);
  }

  // ---------- Schoolhouse: a red clapboard school with a belfry over its door, a porch and a small yard ----------
  // The front gable (door, porch and bell) faces the yard and the default camera; one footprint for every stage.
  const SCHOOL = { x: 0, z: -2.6, w: 4.6, d: 6.0, foot: .3, wall: 2.6, roof: 1.7 };
  function bell(g, x, y, z, where) {
    round(g, x, y, z, .5, .5, .5, C.gold); rock(g, x, y + .3, z, .28, .22, .28, C.gold); round(g, x, y - .26, z, .62, .08, .62, C.gold);
    rock(g, x, y - .34, z, .12, .12, .12, E.iron); mark(`bell:${where}`);
  }
  function belfry(g, roofed) {
    const { x, z, d, foot, wall, roof } = SCHOOL, by = foot + wall + roof, bz = z + d / 2 - .9;
    box(g, x, by - .05, bz, 1.0, 1.1, 1.0, roofed ? C.cream : C.wood); // seated into both roof slopes
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, x + sx * .4, by + 1.0, bz + sz * .4, .13, 1.0, .13, roofed ? C.cream : C.wood);
    box(g, x, by + 1.56, bz, 1.18, .14, 1.18, roofed ? C.cream : C.wood);
    if (!roofed) { mark('belfry:frame'); return; }
    cone(g, x, by + 2.1, bz, 1.6, .96, 1.6, E.slate); round(g, x, by + 2.72, bz, .06, .4, .06, C.gold); rock(g, x, by + 2.95, bz, .2, .2, .2, C.gold);
    bell(g, x, by + 1.02, bz, 'belfry'); mark('belfry');
  }
  function bellCradle(g, x, z) {
    // The bell waits on a timber cradle until the belfry is finished.
    for (const s of [-1, 1]) for (const t of [-1, 1]) rod(g, [x + s * .8, 0, z + t * .45], [x + s * .62, 1.55, z], .12, C.wood);
    box(g, x, 1.55, z, 1.55, .14, .16, C.wood); box(g, x, 1.38, z, .06, .2, .06, E.iron);
    bell(g, x, 1.0, z, 'cradle');
  }
  function sideWindow(g, wx, wy, wz, s) {
    // A tall school window on a long wall (s = 1 east, -1 west): cream frame and sill, glass that lights at night.
    const o = (t) => wx + s * t;
    box(g, o(.04), wy, wz, .08, 1.4, .9, C.cream); box(g, o(.075), wy, wz, .04, 1.16, .66, models.roles.glass);
    box(g, o(.1), wy, wz, .03, 1.16, .05, C.soil); box(g, o(.1), wy + .1, wz, .03, .05, .66, C.soil);
    box(g, o(.12), wy - .74, wz, .22, .1, 1.02, C.cream);
  }
  function slateBoard(g, x, z, ry, s = 1) {
    const b = new THREE.Group(); b.position.set(x, G, z); b.rotation.y = ry; b.scale.setScalar(s); g.add(b);
    for (const sx of [-1, 1]) part(b, 'box', sx * .46, .72, .06, .08, 1.46, .08, C.wood, 0, sx * .12);
    part(b, 'box', 0, .62, -.3, .07, 1.24, .07, C.wood);
    part(b, 'box', 0, 1.02, .12, 1.12, .82, .06, C.wood); part(b, 'box', 0, 1.02, .16, .98, .68, .04, C.dark);
    part(b, 'box', -.12, 1.12, .19, .5, .04, .02, C.cream); part(b, 'box', .04, .96, .19, .62, .04, .02, C.cream); part(b, 'box', .3, 1.2, .19, .05, .16, .02, C.cream);
    mark('slate-board');
  }
  function swings(g, x, z) {
    const span = 2.8, h = 2.3;
    for (const s of [-1, 1]) for (const t of [-1, 1]) rod(g, [x + s * span / 2, 0, z + t * .7], [x + s * span / 2, h, z], .12, C.wood);
    rod(g, [x - span / 2 - .12, h, z], [x + span / 2 + .12, h, z], .16, C.wood);
    for (const sx of [-.62, .62]) { for (const t of [-.2, .2]) box(g, x + sx + t, h / 2 + .38, z, .03, h - .76, .03, C.cream); box(g, x + sx, .64, z, .56, .07, .3, C.wood); }
    mark('swings');
  }
  function schoolhouse(g, level) {
    const { x, z, w, d, foot, wall, roof } = SCHOOL, top = foot + wall, front = z + d / 2, back = z - d / 2;
    const gablePitch = Math.atan2(roof, w / 2), gableSlope = Math.hypot(roof, w / 2);
    box(g, x, foot / 2, z, w + .36, foot, d + .36, E.stone2);
    mark(`school:${level}`);
    if (level !== 'built') {
      // The timber frame of the same building: posts and studs, plates, both gable frames, the door and porch posts.
      for (const xx of [x - w / 2, x + w / 2]) for (let i = 0; i <= 6; i++) box(g, xx, foot + wall / 2, back + i * d / 6, i % 6 ? .22 : .28, wall, i % 6 ? .22 : .28, C.wood);
      for (const zz of [back, front]) for (const xx of [x - w / 4, x + w / 4]) box(g, xx, foot + wall / 2, zz, .22, wall, .22, C.wood);
      for (const xx of [x - w / 2, x + w / 2]) box(g, xx, top, z, .28, .22, d + .2, C.wood);
      for (const zz of [back, front]) box(g, x, top, zz, w + .2, .22, .28, C.wood);
      for (const zz of [back, front]) { for (const s of [-1, 1]) box(g, x + s * w / 4, top + roof / 2, zz, gableSlope, .22, .22, C.wood, 0, -s * gablePitch); box(g, x, top + roof / 2, zz, .2, roof, .2, C.wood); }
      for (const s of [-1, 1]) box(g, x + s * .76, foot + 1.15, front, .22, 2.3, .22, C.wood);
      for (const s of [-1, 1]) box(g, x + s * 1.0, 1.25, front + 1.15, .24, 2.5, .24, C.wood);
      if (level === 'frame') return;
      // Rafters and ridge, red clapboard to sill height, window frames and the belfry's posts on the ridge.
      for (let i = 1; i < 6; i++) for (const s of [-1, 1]) box(g, x + s * w / 4, top + roof / 2, back + i * d / 6, gableSlope, .18, .18, C.wood, 0, -s * gablePitch);
      box(g, x, top + roof, z, .18, .18, d + .3, C.wood);
      for (const s of [-1, 1]) box(g, x + s * w / 2, foot + .6, z, .12, 1.2, d, C.red);
      box(g, x, foot + .6, back, w, 1.2, .12, C.red);
      for (const s of [-1, 1]) box(g, x + s * (w / 4 + .42), foot + .6, front, w / 2 - .84, 1.2, .12, C.red);
      for (let y = foot + .3; y < foot + 1.2; y += .3) for (const s of [-1, 1]) box(g, x + s * (w / 2 + .07), y, z, .02, .05, d, E.roofDark);
      for (const s of [-1, 1]) for (const dz of [-1.8, 0, 1.8]) box(g, x + s * (w / 2 + .02), foot + 1.35, z + dz, .1, 1.4, .9, C.cream);
      belfry(g, false);
      return;
    }
    // Walls: red clapboard with cream corner boards.
    box(g, x, foot + wall / 2, z, w, wall, d, C.red);
    for (let y = foot + .3; y < top - .1; y += .3) {
      for (const s of [-1, 1]) box(g, x + s * (w / 2 + .012), y, z, .025, .05, d - .06, E.roofDark);
      for (const s of [-1, 1]) box(g, x, y, z + s * (d / 2 + .012), w - .06, .05, .025, E.roofDark);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, x + sx * w / 2, foot + wall / 2, z + sz * d / 2, .2, wall, .2, C.cream);
    // The gable walls, a slate roof with shingle courses, cream bargeboards and ridge.
    const half = w / 2 + .32, pitch = Math.atan2(roof, half), slope = Math.hypot(roof, half) + .06;
    for (const zz of [back, front]) gable(g, x, top + roof / 2, zz + (zz === front ? -.05 : .05), w, roof, .1, C.red);
    for (const s of [-1, 1]) {
      box(g, x + s * half / 2, top + roof / 2 + .1, z, slope, .16, d + .7, E.slate, 0, -s * pitch);
      for (let row = 1; row <= 5; row++) box(g, x + s * (row - .5) / 5 * half, top + roof - (row - .5) / 5 * roof + .2, z, half / 4.4, .06, d + .74, row % 2 ? E.slate : E.slateShade, 0, -s * pitch);
      for (const zz of [back - .37, front + .37]) box(g, x + s * half / 2, top + roof / 2 + .12, zz, slope, .16, .1, C.cream, 0, -s * pitch);
      box(g, x + s * half, top + .02, z, .1, .14, d + .74, C.cream);
    }
    box(g, x, top + roof + .2, z, .28, .14, d + .82, C.cream);
    // Chimney at the back, three tall windows a side, a small gable window over the door.
    box(g, x + 1.1, top + .95, back + 1.1, .55, 1.6, .55, E.brick); box(g, x + 1.1, top + 1.8, back + 1.1, .72, .12, .72, E.stone2);
    for (const s of [-1, 1]) for (const dz of [-1.8, 0, 1.8]) sideWindow(g, x + s * w / 2, foot + 1.35, z + dz, s);
    box(g, x, top + .8, front + .04, .76, .66, .06, C.cream); box(g, x, top + .8, front + .08, .54, .44, .04, models.roles.glass);
    box(g, x, top + .8, front + .11, .04, .44, .02, C.soil);
    // The front door: a cream frame, two dark leaves, a lit transom and a lamp; the porch and its steps.
    box(g, x, foot + 1.14, front + .04, 1.56, 2.28, .08, C.cream);
    for (const s of [-1, 1]) box(g, x + s * .34, foot + .96, front + .08, .62, 1.9, .05, C.soil);
    box(g, x, foot + 2.08, front + .08, 1.24, .24, .04, models.roles.glass);
    for (const s of [-1, 1]) round(g, x + s * .1, foot + 1.0, front + .12, .06, .06, .06, C.gold);
    wallLamp(g, x + 1.05, foot + 1.75, front + .14);
    box(g, x, .16, front + .7, 2.4, .32, 1.36, E.stone2); box(g, x, .07, front + 1.62, 1.7, .14, .5, C.stone);
    for (const s of [-1, 1]) box(g, x + s * 1.0, 1.42, front + 1.15, .16, 2.5, .16, C.cream);
    const porchPitch = Math.atan2(.62, 1.35);
    gable(g, x, 2.98, front + .62, 2.7, .62, 1.6, E.slate);
    for (const s of [-1, 1]) box(g, x + s * .66, 2.98, front + 1.43, Math.hypot(.62, 1.35) + .05, .12, .08, C.cream, 0, -s * porchPitch);
    mark('porch');
    belfry(g, true);
  }
  function yardPath(g) {
    const [x1, z1, x2, z2] = [5.7, .3, .9, 2.05], dx = x2 - x1, dz = z2 - z1;
    box(g, (x1 + x2) / 2, .03, (z1 + z2) / 2, Math.hypot(dx, dz), .06, 1.1, C.dust, -Math.atan2(dz, dx));
  }

  function schoolSurvey(g, flag, detail) {
    stakes(g); slateBoard(g, 2.6, -.6, .35);
    if (detail) { signpost(g, flag); box(g, SCHOOL.x, .03, SCHOOL.z, SCHOOL.w + .4, .06, SCHOOL.d + .4, C.dust); box(g, 0, .03, 4.6, 7.0, .06, 4.2, C.dust); }
  }
  function schoolConstruction(g, flag, detail) {
    signpost(g, flag);
    schoolhouse(g, detail ? 'rafters' : 'frame');
    bellCradle(g, 3.9, 3.2);
    lumber(g, 5.4, 5.8); crate(g, 4.3, -5.2, .3); crate(g, 5.4, -5.7, -.2); wheelbarrow(g, -3.8, -6.2, .5);
    sawhorse(g, -5.4, 3.0, .15); sawhorse(g, -5.4, 5.8, .15); box(g, -5.4, 1.08, 4.4, .55, .08, 3.6, C.cream, .15); stonePile(g, -5.6, -1.6);
    if (detail) { yardPath(g); slateBoard(g, -3.4, 2.6, .4, .85); }
  }
  function schoolFinished(g, flag, detail) {
    signpost(g, flag);
    schoolhouse(g, 'built');
    yardPath(g); slateBoard(g, -2.9, 3.4, .45); bench(g, 2.4, 3.9, -.35);
    for (const x of [-1.95, 1.95]) planter(g, x, SCHOOL.z + SCHOOL.d / 2 + .55);
    if (detail) {
      lanterns(g); mark('lanterns');
      tree(g, -6.0, 4.6, .9); bench(g, -1.2, 6.6, .15);
    }
  }
  function schoolGathering(g, flag) {
    schoolFinished(g, flag, true);
    swings(g, 2.9, 6.6); flagpole(g, -4.6, 1.6, flag); mark('flag');
    models.bunting(g, 1.5, 2.4, 5.2, 6.4, [C.red, C.gold, C.blue], 2.8); models.bunting(g, -1.5, 2.4, -1.6, 7.8, [C.blue, C.gold, C.red], 2.8); mark('bunting');
    models.lantern(g, 6.4, 6.4, G - .05, true);
  }

  const STAGES = {
    campsite: [survey, construction, furnished, gathering],
    garden: [gardenSurvey, gardenConstruction, gardenPlanted, gardenBloom],
    schoolhouse: [schoolSurvey, schoolConstruction, schoolFinished, schoolGathering],
  };

  return {
    reset() { flame = null; puffs = []; built = null; last = null; },
    /**
     * Build one stage of the chosen place at the site. `stage` is the pure module's result (its `kind` the family's saved
     * choice; anything unlisted draws the campsite); `flag` the household crest colour.
     */
    build(group, stage, flag) {
      const g = new THREE.Group(); g.name = 'family-project'; g.position.set(SITE.x, 0, SITE.z); group.add(g);
      const kind = Object.hasOwn(STAGES, stage.kind) ? stage.kind : 'campsite', index = Math.min(3, Math.max(0, stage.index | 0));
      built = { kind, index, key: stage.key, detail: Boolean(stage.detail), features: [] };
      path(g);
      STAGES[kind][index](g, flag, Boolean(stage.detail));
      return g;
    },
    tick(seconds) {
      if (last !== null) elapsed += Math.min(.25, Math.max(0, seconds - last));
      last = seconds; ticks++;
      if (flame) {
        flame.scale.set(1 + .08 * Math.sin(elapsed * 13), 1 + .22 * Math.sin(elapsed * 9) + .12 * Math.sin(elapsed * 23), 1);
        flame.rotation.y = Math.sin(elapsed * 5) * .15;
      }
      puffs.forEach((p, i) => {
        const t = (elapsed * .3 + i / 3) % 1;
        p.position.set(flame.position.x + .35 * Math.sin(t * 6 + i), G + 1.4 + t * 3.0, flame.position.z + .25 * Math.cos(t * 5 + i));
        p.scale.setScalar((.22 + t * .5) * (t > .85 ? (1 - t) / .15 : 1));
      });
    },
    debug: () => ({ site: { id: SITE.id, x: SITE.x, z: SITE.z }, stage: built && { ...built }, lit: Boolean(flame), flameScaleY: flame ? Number(flame.scale.y.toFixed(4)) : null, firePosition: flame?.position.toArray() ?? null, smokePositions: puffs.map(p => p.position.toArray()), puffs: puffs.map((p) => Number(p.position.y.toFixed(4))), ticks, seconds: Number(elapsed.toFixed(4)) }),
  };
}
