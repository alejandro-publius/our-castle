import * as THREE from 'three';
import { PixelRenderer } from '../graphics/pixel-renderer.js';
import { CREST_FIELDS, ROUTE_LENGTH } from '../core/rules.js';

// The playable woodland board. It extends the original art-preview vocabulary (MiniBuilder,
// layered trees, antlered deer, stone towers) and renders through the original 90-colour
// PixelRenderer: orthographic camera, depth outlines, Bayer dither and palette snapping.
// Everything here is presentation; financial truth comes from the server state passed to update().

const colours = {
  grass: 0x527557, leaf: 0x86a56c, pine: 0x425b47, dark: 0x1d3030, soil: 0x65402e, wood: 0x9e714b, stone: 0xacb7a2,
  cream: 0xeddcb4, gold: 0xddba79, red: 0x9d3e46, blue: 0x355f93, water: 0x6ca8b1, skin: 0xd9a67f, path: 0x8e9a8a,
};
const crestColour = (field) => Number.parseInt((CREST_FIELDS[field]?.hex ?? '#355F93').slice(1), 16);

class MiniBuilder {
  constructor() {
    this.geo = { box: new THREE.BoxGeometry(1, 1, 1), round: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cone: new THREE.ConeGeometry(0.5, 1, 6), rock: new THREE.IcosahedronGeometry(0.5, 0) };
    this.materials = new Map();
    this.groups = new Map();
  }
  material(colour) {
    if (!this.materials.has(colour)) this.materials.set(colour, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.87, flatShading: true }));
    return this.materials.get(colour);
  }
  part(group, kind, x, y, z, w, h, d, colour, ry = 0, rz = 0) {
    let buckets = this.groups.get(group);
    if (!buckets) this.groups.set(group, (buckets = new Map()));
    const key = `${kind}:${colour}`;
    if (!buckets.has(key)) buckets.set(key, { kind, colour, parts: [] });
    buckets.get(key).parts.push([x, y, z, w, h, d, ry, rz]);
  }
  flush() {
    const transform = new THREE.Object3D();
    for (const [group, buckets] of this.groups) {
      for (const { kind, colour, parts } of buckets.values()) {
        const mesh = new THREE.InstancedMesh(this.geo[kind], this.material(colour), parts.length);
        parts.forEach(([x, y, z, w, h, d, ry, rz], i) => {
          transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.rotation.set(0, ry, rz); transform.updateMatrix();
          mesh.setMatrixAt(i, transform.matrix);
        });
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }
    this.groups.clear();
  }
  dispose() {
    Object.values(this.geo).forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

/** World position of a route waypoint (0–19; 20 is home again). Same layout as the art starter. */
export function spacePosition(index) {
  const i = ((index % ROUTE_LENGTH) + ROUTE_LENGTH) % ROUTE_LENGTH;
  const side = Math.floor(i / 5);
  const t = (i % 5) / 5;
  if (side === 0) return { x: -8 + 16 * t, z: -5.3, side };
  if (side === 1) return { x: 8, z: -5.3 + 10.6 * t, side };
  if (side === 2) return { x: 8 - 16 * t, z: 5.3, side };
  return { x: -8, z: 5.3 - 10.6 * t, side };
}

const disposeGroup = (group) => {
  group.traverse((o) => { if (o.userData.ownedGeometry) o.geometry.dispose(); if (o.userData.ownedMaterial) o.material.dispose(); if (o.isInstancedMesh) o.dispose?.(); });
  group.clear();
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

export function createBoardScene(container, { reducedMotion = false, onEvent = () => {} } = {}) {
  let renderer; let pipeline; let scene; let camera; let builder; let observer;
  const part = (...args) => builder.part(...args);
  const groups = {};
  let state = { builtTier: 0, position: 0, crest: { field: 'cobalt', charge: 'stag' }, gardens: 0, playMode: 'family', milestoneSpaces: [5, 12, 20], reached: [] };
  let shownPosition = 0;
  let queue = Promise.resolve();
  let animating = false;
  let frames = 0;
  // Ambient life (Hollybrook-style principle: the world keeps living at a low, cheap frame rate).
  const grazers = [];
  const flutterers = [];
  let flutterGeo = null;
  let ambientFrames = 0;
  let ambientTimer = null;
  const emit = (type, detail) => { try { onEvent(type, detail); } catch (error) { console.error('[board] event listener failed', error); } };

  // ---------- Static woodland ----------
  function tree(group, x, z, size, pine = false) {
    part(group, 'round', x, 0.7 * size, z, 0.3 * size, 1.4 * size, 0.3 * size, colours.soil);
    for (let k = 0; k < 3; k++) {
      part(group, pine ? 'cone' : 'rock', x + (pine ? 0 : Math.sin(k * 3) * 0.35 * size), (1.6 + k * 0.42) * size, z + (pine ? 0 : Math.cos(k * 3) * 0.25 * size),
        (pine ? 1.7 - k * 0.25 : 1.8) * size, 1.5 * size, (pine ? 1.7 - k * 0.25 : 1.8) * size, k % 2 ? colours.leaf : colours.pine);
    }
  }
  function deer(group, x, z, angle = 0, scale = 1) {
    const d = new THREE.Group();
    d.position.set(x, 0.16, z); d.rotation.y = angle; d.scale.setScalar(scale); group.add(d);
    part(d, 'box', 0, 0.68, 0, 0.9, 0.48, 0.36, colours.wood);
    for (const lx of [-0.29, 0.29]) for (const lz of [-0.12, 0.12]) part(d, 'box', lx, 0.28, lz, 0.08, 0.55, 0.08, colours.soil);
    part(d, 'box', -0.47, 0.82, 0, 0.1, 0.16, 0.14, colours.cream);
    // Neck, head, antlers and eye pivot at the shoulder so the deer can lower its head to graze.
    const head = new THREE.Group(); head.position.set(0.36, 0.78, 0); d.add(head);
    part(head, 'box', 0.07, 0.22, 0, 0.25, 0.58, 0.26, colours.wood); part(head, 'box', 0.2, 0.45, 0, 0.38, 0.26, 0.26, colours.wood);
    if (scale >= 1) for (const az of [-0.1, 0.1]) { part(head, 'box', 0.11, 0.72, az, 0.04, 0.4, 0.04, colours.cream, 0, -0.2); part(head, 'box', 0.19, 0.82, az, 0.17, 0.04, 0.04, colours.cream, 0, 0.5); }
    part(head, 'box', 0.35, 0.47, 0.14, 0.045, 0.045, 0.025, colours.dark);
    grazers.push({ head, phase: grazers.length * 2.3 + x });
  }
  // A few butterflies over the wildflowers.
  function butterflies(group) {
    const wingGeo = new THREE.BoxGeometry(0.2, 0.03, 0.16);
    const tints = [colours.cream, colours.gold, colours.cream, colours.red];
    [[-2.6, 3.6], [5.6, 1.6], [-6.2, 0.2], [2.4, -3.4]].forEach(([x, z], i) => {
      const b = new THREE.Group(); b.position.set(x, 1.1, z);
      const material = builder.material(tints[i]);
      const left = new THREE.Mesh(wingGeo, material); left.position.x = -0.1;
      const right = new THREE.Mesh(wingGeo, material); right.position.x = 0.1;
      b.add(left, right); group.add(b);
      flutterers.push({ b, left, right, x, z, phase: i * 1.7 });
    });
    flutterGeo = wingGeo;
  }
  function hut(group, x, z, roof, angle = 0) {
    const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = angle; group.add(h);
    part(h, 'box', 0, 0.55, 0, 1.3, 0.8, 1.0, colours.cream);
    part(h, 'box', 0, 1.1, 0, 1.5, 0.35, 1.15, roof); part(h, 'box', 0, 1.36, 0, 1.1, 0.22, 0.9, roof);
    part(h, 'box', 0.15, 0.42, 0.51, 0.3, 0.55, 0.04, colours.soil);
  }
  function buildLandscape() {
    const land = new THREE.Group(); scene.add(land);
    part(land, 'box', 0, -0.65, 0, 24, 1.4, 18, colours.soil);
    part(land, 'box', 0, 0.08, 0, 24.1, 0.18, 18.1, colours.grass);
    for (let i = 0; i < 26; i++) {
      const angle = (i * Math.PI * 2) / 26; let x = Math.cos(angle) * 10.5; let z = Math.sin(angle) * 7.7;
      if (z > 5.9 && Math.abs(x) < 4.5) continue;
      // The tree ring passes through the route corners; step those trees outward so travelers stay visible.
      if (Math.abs(Math.abs(x) - 8) < 1.9 && Math.abs(Math.abs(z) - 5.3) < 1.9) {
        x = Math.sign(x) * Math.min(Math.abs(x) * 1.27, 10.9); z = Math.sign(z) * Math.min(Math.abs(z) * 1.27, 7.9);
      }
      tree(land, x, z, 0.7 + (i % 4) * 0.12, i % 3 === 0);
    }
    // Pond, a brook to the board edge and the plank bridge the route crosses.
    part(land, 'round', -4.8, 0.2, -2.6, 3.1, 0.09, 2.1, colours.water);
    part(land, 'box', -9.1, 0.2, -2.12, 5.9, 0.08, 0.72, colours.water);
    for (let i = 0; i < 5; i++) part(land, 'rock', -6.0 + i * 0.62, 0.25, -3.4, 0.5, 0.32, 0.45, colours.stone);
    part(land, 'box', -8, 0.3, -2.12, 1.5, 0.12, 1.15, colours.wood);
    for (const dz of [-0.55, 0.55]) { part(land, 'box', -8, 0.55, -2.12 + dz, 1.5, 0.08, 0.08, colours.soil); for (const dx of [-0.65, 0.65]) part(land, 'box', -8 + dx, 0.45, -2.12 + dz, 0.09, 0.32, 0.09, colours.soil); }
    for (let i = 0; i < 3; i++) part(land, 'box', -8.55 + i * 0.55, 0.37, -2.12, 0.06, 0.03, 1.12, colours.soil);
    deer(land, -5.4, 1.4, -0.4); deer(land, -4.6, 2.2, -0.9, 0.7); deer(land, 5.5, -2.6, 2.6); deer(land, 3.2, 6.7, 0.25);
    butterflies(land);
    hut(land, -2.9, 7.1, colours.red, 0.2); hut(land, -0.9, 7.5, colours.blue, -0.15);
    for (let i = 0; i < 22; i++) {
      const x = Math.sin(i * 2.17) * 5.4; const z = Math.cos(i * 3.13) * 3.4;
      if ((Math.abs(x) < 3.7 && Math.abs(z) < 2.8) || (Math.abs(Math.abs(x) - 4.45) < 0.9 && z > -1.4 && z < 3.2)) continue;
      part(land, 'round', x, 0.35, z, 0.055, 0.4, 0.055, colours.pine); part(land, 'rock', x, 0.59, z, 0.23, 0.23, 0.23, i % 2 ? colours.gold : colours.red);
    }
    for (const sign of [-1, 1]) for (let i = 0; i < 9; i++) part(land, 'box', sign * 11.95, -0.25, -7.4 + i * 1.8, 0.2, 0.4, 1.2, i % 2 ? colours.stone : colours.soil);
    builder.flush();
  }

  // ---------- Route, milestones and gardens (rebuilt from state) ----------
  function buildRoute() {
    disposeGroup(groups.route);
    const milestoneSet = new Set(state.milestoneSpaces.map((s) => s % ROUTE_LENGTH));
    const flag = crestColour(state.crest.field);
    for (let i = 0; i < ROUTE_LENGTH; i++) {
      const { x, z, side } = spacePosition(i);
      const visited = i < state.position || state.position >= ROUTE_LENGTH;
      const milestone = milestoneSet.has(i);
      const colour = milestone ? colours.gold : visited ? colours.cream : colours.path;
      part(groups.route, 'box', x, 0.23, z, side % 2 ? 1.7 : 2.5, 0.16, side % 2 ? 1.5 : 1.65, colour);
      if (milestone) {
        const spaceIndex = i === 0 ? ROUTE_LENGTH : i;
        const reached = state.position >= spaceIndex;
        const ox = side % 2 ? 0.55 : -0.85; const oz = side % 2 ? -0.5 : -0.45;
        part(groups.route, 'round', x + ox, 1.0, z + oz, 0.07, 1.6, 0.07, colours.gold);
        part(groups.route, 'rock', x + ox, 1.85, z + oz, 0.16, 0.16, 0.16, colours.gold);
        part(groups.route, 'box', x + ox + 0.28, reached ? 1.55 : 0.75, z + oz, 0.5, 0.36, 0.06, reached ? flag : colours.stone);
      }
    }
    builder.flush();
  }
  function buildGardens() {
    disposeGroup(groups.gardens);
    const spots = [[-4.45, 0.4], [4.45, 0.9], [4.45, 2.6], [-4.45, 2.4]].slice(0, state.gardens);
    for (const [x, z] of spots) {
      part(groups.gardens, 'box', x, 0.26, z, 1.2, 0.2, 1.0, colours.soil);
      for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
        part(groups.gardens, 'rock', x + c * 0.36, 0.48, z + r * 0.3, 0.26, 0.26, 0.26, (r + c) % 2 ? colours.leaf : r === 0 ? colours.red : colours.gold);
      }
    }
    builder.flush();
  }

  // ---------- Home tiers (cottage → manor → keep → castle) ----------
  function tower(group, x, z, height, flag) {
    part(group, 'round', x, height / 2 + 0.16, z, 1.25, height, 1.25, colours.stone);
    part(group, 'round', x, height + 0.15, z, 1.4, 0.3, 1.4, colours.cream);
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; part(group, 'box', x + Math.cos(a) * 0.55, height + 0.43, z + Math.sin(a) * 0.55, 0.3, 0.35, 0.3, colours.cream, a); }
    part(group, 'box', x, height * 0.65, z + 0.62, 0.22, 0.45, 0.05, colours.dark);
    part(group, 'round', x, height + 1, z, 0.055, 1.2, 0.055, colours.gold);
    part(group, 'box', x + 0.32, height + 1.3, z, 0.6, 0.35, 0.06, flag);
  }
  function buildCastle() {
    disposeGroup(groups.castle);
    const tier = state.builtTier; const castle = groups.castle; const flag = crestColour(state.crest.field);
    const w = tier === 0 ? 3.0 : 4.8; const h = tier === 0 ? 1.65 : 2.55;
    part(castle, 'box', 0, 0.14, 0, 6.8, 0.18, 5.0, colours.cream);
    part(castle, 'box', 0, h / 2 + 0.25, 0, w, h, 2.6, colours.stone);
    part(castle, 'box', -0.05, 0.9, 1.32, 0.68, 1.45, 0.08, colours.soil);
    part(castle, 'box', 0.12, 0.93, 1.38, 0.04, 0.06, 0.04, colours.gold);
    for (const x of [-0.96, 0.96]) { part(castle, 'box', x, 1.42, 1.34, 0.47, 0.6, 0.08, colours.dark); part(castle, 'box', x, 1.42, 1.4, 0.05, 0.6, 0.04, colours.gold); }
    if (tier < 2) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshStandardMaterial({ color: colours.red, roughness: 0.9, flatShading: true }));
      roof.position.set(0, h + 0.6, 0); roof.rotation.y = Math.PI / 4; roof.scale.set(w * 0.85, 1.4, 2.3);
      roof.userData.ownedGeometry = true; roof.userData.ownedMaterial = true; castle.add(roof);
      part(castle, 'box', w * 0.28, h + 1.2, -0.4, 0.42, 1.5, 0.42, colours.stone);
    } else {
      part(castle, 'box', 0, h + 0.35, 0, w + 0.2, 0.3, 2.9, colours.cream);
      for (const x of [-2, -1, 0, 1, 2]) part(castle, 'box', x, h + 0.65, 1.35, 0.45, 0.38, 0.3, colours.cream);
      tower(castle, -2.65, -1.5, tier === 3 ? 4.5 : 3.1, flag); tower(castle, 2.65, -1.5, tier === 3 ? 4.5 : 3.1, flag);
      if (tier === 3) {
        tower(castle, -2.65, 1.65, 3.5, flag); tower(castle, 2.65, 1.65, 3.5, flag);
        part(castle, 'box', 0, 1.05, 2.12, 4.2, 1.7, 0.35, colours.stone); part(castle, 'box', 0, 0.9, 2.32, 0.95, 1.4, 0.08, colours.soil);
      }
    }
    if (tier === 0) {
      // A household pennant beside the first cottage.
      part(castle, 'round', -2.1, 1.05, 1.0, 0.06, 1.8, 0.06, colours.gold);
      part(castle, 'box', -1.8, 1.7, 1.0, 0.55, 0.38, 0.06, flag);
    } else if (tier < 3) {
      // House banner on the façade: crest field with a gold charge.
      part(castle, 'box', 0, 2.25, 1.33, 0.62, 0.8, 0.05, flag);
      part(castle, 'box', 0, 2.28, 1.37, 0.22, 0.24, 0.03, colours.gold);
    } else {
      part(castle, 'box', 0, 2.35, 2.32, 0.7, 0.62, 0.05, flag);
      part(castle, 'box', 0, 2.37, 2.36, 0.24, 0.24, 0.03, colours.gold);
    }
    if (tier > 0) { part(castle, 'box', -2.0, 0.3, 2.1, 0.9, 0.3, 0.9, colours.soil); for (const x of [-2.25, -1.8]) part(castle, 'rock', x, 0.7, 2.1, 0.45, 0.6, 0.45, colours.leaf); }
    builder.flush();
  }

  // ---------- Household travelers ----------
  function traveler(group, x, size, cloak) {
    part(group, 'round', x, 0.62 * size, 0, 0.66 * size, 0.95 * size, 0.66 * size, cloak);
    part(group, 'cone', x, 0.5 * size, 0, 0.82 * size, 0.62 * size, 0.82 * size, cloak);
    part(group, 'box', x, 1.02 * size, 0, 0.5 * size, 0.12 * size, 0.5 * size, colours.gold);
    part(group, 'rock', x, 1.28 * size, 0, 0.46 * size, 0.46 * size, 0.46 * size, colours.skin);
    part(group, 'cone', x, 1.62 * size, 0, 0.56 * size, 0.42 * size, 0.56 * size, colours.cream);
  }
  function buildToken() {
    disposeGroup(groups.token);
    const cloak = crestColour(state.crest.field);
    // Gold "you are here" ring under the household travelers.
    part(groups.token, 'round', 0, 0.02, 0, 1.75, 0.08, 1.75, colours.gold);
    part(groups.token, 'round', 0, 0.05, 0, 1.35, 0.08, 1.35, colours.cream);
    if (state.playMode === 'family') { traveler(groups.token, -0.32, 1.2, cloak); traveler(groups.token, 0.42, 0.85, cloak); } else traveler(groups.token, 0, 1.3, cloak);
    // Walking staff with the household pennant.
    part(groups.token, 'round', 0.62, 1.15, 0.2, 0.06, 2.2, 0.06, colours.wood);
    part(groups.token, 'box', 0.9, 2.0, 0.2, 0.52, 0.34, 0.05, cloak);
    part(groups.token, 'rock', 0.62, 2.3, 0.2, 0.14, 0.14, 0.14, colours.gold);
    builder.flush();
    placeToken(shownPosition, 0);
  }
  // When the goal is complete (position 20) the travelers stand at the castle gate, home.
  const GATE = { x: 0.9, z: 3.55 };
  const stop = (p) => (p >= ROUTE_LENGTH ? GATE : spacePosition(p));
  function placeToken(position, lift) {
    const base = Math.min(Math.floor(position), ROUTE_LENGTH);
    const a = stop(base);
    const b = stop(Math.min(base + 1, ROUTE_LENGTH));
    const t = position - Math.floor(position);
    const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
    groups.token.position.set(x, 0.31 + lift, z);
    if (position >= ROUTE_LENGTH) { groups.token.rotation.y = 0.35; return; }
    const ahead = stop(Math.min(Math.round(position) + 1, ROUTE_LENGTH));
    groups.token.rotation.y = Math.atan2(ahead.x - x, ahead.z - z) - Math.PI / 2 + 0.6;
  }

  // ---------- Animation (demand-driven: frames render only while something moves) ----------
  function run(duration, frame) {
    return new Promise((resolve) => {
      if (reducedMotion || !renderer) { frame(1); draw(); resolve(); return; }
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        frame(t); draw();
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }
  async function walk(from, to) {
    const dir = Math.sign(to - from);
    for (let p = from; p !== to; p += dir) {
      // The last step home is a bound over the walls to the castle gate.
      const homeward = Math.max(p, p + dir) === ROUTE_LENGTH;
      await run(homeward ? 750 : dir > 0 ? 300 : 220, (t) => { const e = easeInOut(t); placeToken(p + dir * e, Math.sin(Math.PI * t) * (homeward ? 6.5 : 0.55)); });
      shownPosition = p + dir;
      emit('hop', { position: shownPosition, direction: dir, home: shownPosition === ROUTE_LENGTH });
    }
    placeToken(to, 0);
  }
  async function rise() {
    emit('rise', { tier: state.builtTier });
    const sparkGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const sparkMat = new THREE.MeshStandardMaterial({ color: colours.gold, roughness: 0.5, flatShading: true });
    const sparks = Array.from({ length: 28 }, (_, i) => {
      const m = new THREE.Mesh(sparkGeo, sparkMat); const a = (i / 28) * Math.PI * 2;
      m.userData.v = [Math.cos(a) * (2 + (i % 3)), 3 + (i % 4), Math.sin(a) * (2 + (i % 3))];
      groups.fx.add(m); return m;
    });
    await run(1100, (t) => {
      const s = Math.max(0.05, easeOutBack(Math.min(1, t * 1.3)));
      groups.castle.scale.set(1, s, 1);
      for (const m of sparks) { const [vx, vy, vz] = m.userData.v; m.position.set(vx * t, 3.2 + vy * t - 3 * t * t, vz * t); m.scale.setScalar(Math.max(0.01, 1 - t)); }
    });
    groups.castle.scale.set(1, 1, 1);
    groups.fx.clear(); sparkGeo.dispose(); sparkMat.dispose();
  }

  function draw() { if (renderer && pipeline) { pipeline.render(scene, camera); frames++; } }

  function ambientStep(seconds) {
    for (const g of grazers) {
      const cycle = (seconds * 0.35 + g.phase) % 6; // graze for ~2 of every ~17 seconds
      const down = cycle < 2 ? Math.sin((cycle / 2) * Math.PI) : 0;
      g.head.rotation.z = -1.05 * down;
    }
    for (const f of flutterers) {
      const t = seconds * 0.6 + f.phase;
      f.b.position.set(f.x + Math.sin(t) * 0.9, 1.0 + Math.sin(t * 2.3) * 0.25, f.z + Math.cos(t * 0.8) * 0.7);
      f.b.rotation.y = -t;
      const flap = 0.25 + 0.75 * Math.abs(Math.sin(seconds * 9 + f.phase));
      f.left.rotation.z = flap; f.right.rotation.z = -flap;
    }
  }
  function startAmbient() {
    if (reducedMotion || ambientTimer) return;
    const start = performance.now();
    // About 8 frames per second while idle; the pixel look hides the low rate and it stays cheap.
    ambientTimer = setInterval(() => {
      if (document.hidden) return;
      ambientStep((performance.now() - start) / 1000);
      ambientFrames++;
      if (!animating) draw();
    }, 125);
  }
  function resize() {
    const width = container.clientWidth; const height = container.clientHeight;
    if (!width || !height) return;
    const aspect = width / height; const narrow = width < 640;
    const viewHeight = Math.max(23, (narrow ? 30.5 : 33) / aspect);
    // On phones the heading overlays the top of the board, so frame the board slightly lower.
    const up = narrow ? 0.6 : 0.5;
    camera.left = (-viewHeight * aspect) / 2; camera.right = (viewHeight * aspect) / 2; camera.top = viewHeight * up; camera.bottom = -viewHeight * (1 - up); camera.updateProjectionMatrix();
    renderer.setSize(width, height, false); pipeline.setSize(width, height); draw();
  }

  // ---------- Setup ----------
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Woodland board with deer, a brook and the household home');
  container.append(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x112830);
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x65714f, 2.7));
  const sun = new THREE.DirectionalLight(0xffe9bf, 3.4); sun.position.set(-12, 25, 17); scene.add(sun);
  camera = new THREE.OrthographicCamera(-18, 18, 12, -12, 0.1, 120); camera.position.set(29, 30, 36); camera.lookAt(0, 0.4, 0);
  builder = new MiniBuilder();
  pipeline = new PixelRenderer(renderer);
  pipeline.configure({ pixelSize: 2, pixelMode: true, outlines: true, dither: true, exposure: 1.05 });
  buildLandscape();
  for (const name of ['route', 'gardens', 'token', 'fx']) { groups[name] = new THREE.Group(); scene.add(groups[name]); }
  groups.castle = new THREE.Group(); groups.castle.position.z = 0.15; scene.add(groups.castle);
  buildRoute(); buildGardens(); buildCastle(); buildToken();
  observer = new ResizeObserver(resize); observer.observe(container); resize();
  startAmbient();

  return {
    /** Apply server state. Returns a promise that resolves when movement/upgrade animation ends. */
    update(next, { animate = true } = {}) {
      queue = queue.then(async () => {
        const prev = state;
        state = { ...state, ...next, crest: { ...state.crest, ...(next.crest ?? {}) } };
        const crestChanged = prev.crest.field !== state.crest.field || prev.crest.charge !== state.crest.charge;
        if (crestChanged || prev.playMode !== state.playMode) buildToken();
        if (prev.gardens !== state.gardens) buildGardens();
        const tierUp = state.builtTier > prev.builtTier;
        animating = true;
        try {
          if (shownPosition !== state.position) {
            // Keep the old path/banners while walking; they update when the travelers arrive.
            const target = state.position;
            state = { ...state, position: shownPosition };
            buildRoute();
            if (animate) await walk(shownPosition, target); else placeToken(target, 0);
            shownPosition = target;
            state = { ...state, position: target };
          }
          buildRoute();
          if (crestChanged || prev.builtTier !== state.builtTier) buildCastle();
          if (tierUp && animate) await rise();
        } finally {
          animating = false;
          draw();
        }
      });
      return queue;
    },
    setPixelMode(on) { pipeline.configure({ pixelMode: on }); draw(); },
    debug: () => ({ tier: state.builtTier, position: state.position, shownPosition, gardens: state.gardens, crest: { ...state.crest }, playMode: state.playMode, animating, frames, ambient: Boolean(ambientTimer), ambientFrames, grazers: grazers.length, butterflies: flutterers.length }),
    dispose() { clearInterval(ambientTimer); observer?.disconnect(); for (const g of Object.values(groups)) disposeGroup(g); flutterGeo?.dispose(); builder?.dispose(); pipeline?.dispose(); renderer?.dispose(); },
  };
}
