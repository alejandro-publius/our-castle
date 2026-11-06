import * as THREE from 'three';
import { FAMILY_PROJECT_SITE as SITE } from '../core/family-project.js';

// The family campsite in the west meadow, drawn from the same shared geometry/material batches as every district.
// Its stage comes from the pure core module; this file only decides what each stage looks like. The campfire's flame
// and smoke are the only live parts and move on the realm's existing ambient clock, so reduced motion keeps them still.
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

  // ---------- Stages ----------
  function survey(g, flag, detail) {
    const pts = [[-5, -4.2], [0, -4.2], [5, -4.2], [5, 0], [5, 4.2], [0, 4.2], [-5, 4.2], [-5, 0]];
    pts.forEach(([x, z], i) => {
      box(g, x, .55, z, .2, 1.1, .2, C.wood); box(g, x, 1.0, z, .44, .18, .06, i % 2 ? C.red : C.cream);
      const [nx, nz] = pts[(i + 1) % pts.length], dx = nx - x, dz = nz - z;
      box(g, (x + nx) / 2, .96, (z + nz) / 2, Math.hypot(dx, dz), .045, .045, C.cream, -Math.atan2(dz, dx));
    });
    round(g, 2.4, .3, -3.2, 1.1, .6, 1.1, C.soil); round(g, 2.4, .62, -3.2, 1.0, .05, 1.0, C.wood);
    box(g, 2.4, .76, -3.2, .9, .2, .32, C.cream, .4); box(g, 2.2, .96, -3.1, .7, .14, .28, C.cream, -.3);
    stonePile(g, -4.6, -5.8);
    if (detail) { signpost(g, flag); for (let i = 0; i < 3; i++) box(g, -1.5 + i * 1.6, .03, .2, 1.4, .06, 1.4, C.dust); }
  }
  function construction(g, flag, detail) {
    signpost(g, flag);
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
    signpost(g, flag);
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
    pavilion(g, flag); flagpole(g, -6.8, 9.4, flag);
    models.bunting(g, 3.0, 1.2, 3.1, 7.3, [C.red, C.gold, C.blue], 3.0); models.bunting(g, -3.0, 1.2, -2.3, 7.3, [C.blue, C.gold, C.red], 3.0);
    models.lantern(g, 6.4, 6.4, G - .05, true);
  }

  return {
    reset() { flame = null; puffs = []; built = null; last = null; },
    /** Build one stage at the site. `stage` is the pure module's result; `flag` the household crest colour. */
    build(group, stage, flag) {
      const g = new THREE.Group(); g.name = 'family-project'; g.position.set(SITE.x, 0, SITE.z); group.add(g);
      built = { index: stage.index, key: stage.key, detail: Boolean(stage.detail) };
      path(g);
      if (stage.index === 0) survey(g, flag, stage.detail);
      else if (stage.index === 1) construction(g, flag, stage.detail);
      else if (stage.index === 2) furnished(g, flag, stage.detail);
      else gathering(g, flag);
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
        p.position.set(.35 * Math.sin(t * 6 + i), G + 1.4 + t * 3.0, .25 * Math.cos(t * 5 + i));
        p.scale.setScalar((.22 + t * .5) * (t > .85 ? (1 - t) / .15 : 1));
      });
    },
    debug: () => ({ site: { id: SITE.id, x: SITE.x, z: SITE.z }, stage: built && { ...built }, lit: Boolean(flame), flameScaleY: flame ? Number(flame.scale.y.toFixed(4)) : null, puffs: puffs.map((p) => Number(p.position.y.toFixed(4))), ticks, seconds: Number(elapsed.toFixed(4)) }),
  };
}
