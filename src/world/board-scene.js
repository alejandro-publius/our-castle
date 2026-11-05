import * as THREE from 'three';
import { memberAvatar } from '../core/avatars.js';
import { addMemberModel } from './member-models.js';
import { PixelRenderer } from '../graphics/pixel-renderer.js';
import { addCloudSurround } from '../graphics/cloud-compositor.js';
import { CREST_FIELDS, ROUTE_LENGTH } from '../core/rules.js';
import { addEstateGeometry, createEstateModels } from './estate-models.js';
import { createEstateCourt } from './court.js';
import { createRealmModels } from './realm-models.js';
import { REALM_SIZE, REALM_BOUNDS, REALM_DISTRICTS, REALM_LEGENDS, REALM_BRIDGES, REALM_ROUTE, homeDistrict, districtById, legendById, viewLocation, journeyLeg, journeyPosition } from '../core/realm.js';

// The playable woodland board. It extends the original art-preview vocabulary (MiniBuilder,
// layered trees, antlered deer, stone towers) and renders through the original 90-colour
// PixelRenderer: orthographic camera, depth outlines, Bayer dither and palette snapping.
// Everything here is presentation; financial truth comes from the server state passed to update().

const colours = {
  grass: 0x527557, leaf: 0x86a56c, pine: 0x425b47, dark: 0x1d3030, soil: 0x65402e, wood: 0x9e714b, stone: 0xacb7a2,
  cream: 0xeddcb4, gold: 0xddba79, red: 0x9d3e46, blue: 0x355f93, water: 0x6ca8b1, skin: 0xd9a67f, path: 0x8e9a8a, road: 0xa48b5f,
  // Not-yet-travelled road and stones: pale dust and weathered stone, warm rather than grey.
  dust: 0xc4b58e, dustStone: 0xa99a7a,
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
  return { ...journeyPosition(index), side: 0 };
}

const disposeGroup = (group) => {
  group.traverse((o) => { if (o.userData.ownedGeometry) o.geometry.dispose(); if (o.userData.ownedMaterial) o.material.dispose(); if (o.isInstancedMesh) o.dispose?.(); });
  group.clear();
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

export function createBoardScene(container, { reducedMotion = false, isOccluded = () => false, onEvent = () => {}, onViewChange = () => {}, insets = null } = {}) {
  let renderer; let pipeline; let scene; let camera; let builder; let observer; let models; let court;
  const part = (...args) => builder.part(...args);
  const groups = {};
  let realmModels; let realm = { districts: [], bridges: [], landscape: null };
  const perf = { lastMs: 0, maxMs: 0, totalMs: 0, draws: 0, calls: 0, triangles: 0 };
  let state = { builtTier: 0, position: 0, crest: { field: 'cobalt', charge: 'stag' }, gardens: 0, playMode: 'family', milestoneSpaces: [5, 12, 20], reached: [], estateLevel: 0, previewFeature: null };
  let shownPosition = 0;
  let queue = Promise.resolve();
  let animating = false;
  let frames = 0;
  // Ambient life (Hollybrook-style principle: the world keeps living at a low, cheap frame rate).
  const grazers = [];
  const rotators = [];
  const view = { angle: 0.66, zoom: 1, panX: 0, panY: 0, worldPerPixel: null, focus: null, crossing: null };
  let viewRevision = 0;
  const pointers = new Map();
  const interactions = [];
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
    const head = new THREE.Group(); head.userData.live = true; head.position.set(0.36, 0.78, 0); d.add(head);
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
    disposeGroup(groups.land); grazers.length = 0; rotators.length = 0; flutterers.length = 0;
    flutterGeo?.dispose(); flutterGeo = null;
    realm = realmModels.build(groups.land, state, { tree, deer, butterflies, rotators }, crestColour(state.crest.field));
  }

  // ---------- Route, milestones and gardens (rebuilt from state) ----------
  function buildRoute() {
    disposeGroup(groups.route);
    const milestoneSet = new Set(state.milestoneSpaces);
    const flag = crestColour(state.crest.field);
    // Roads end at the clearing edges. The bridge models, including their raised leaves, carry the crossings.
    for (let i=0;i<ROUTE_LENGTH;i++) {
      const points=journeyLeg(i),locked=(i>=19?3:i>=11?2:i>=4?1:0)>state.builtTier;
      for(let j=1;j<points.length;j++){
        const a=points[j-1],b=points[j],length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.ceil(length/1.1);
        for(let k=0;k<steps;k++){
          const t=(k+.5)/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
          if(!REALM_DISTRICTS.some(d=>Math.abs(x-d.x)<d.width/2-.7&&Math.abs(z-d.z)<d.depth/2-.7))continue;
          part(groups.route,'box',x,.275,z,1.25,.065,length/steps+.05,locked?colours.dust:colours.road,Math.atan2(b.x-a.x,b.z-a.z));
        }
      }
    }
    for (let i = 0; i <= ROUTE_LENGTH; i++) {
      const { x, z, side } = spacePosition(i);
      const visited = i < state.position || state.position >= ROUTE_LENGTH;
      const milestone = milestoneSet.has(i);
      const locked=(i>=20?3:i>=12?2:i>=5?1:0)>state.builtTier;
      const colour = locked ? colours.dustStone : milestone ? colours.gold : visited ? colours.cream : colours.path;
      part(groups.route, 'box', x, 0.34, z, 2.2, 0.16, 2.2, colour);
      if (milestone) {
        const spaceIndex = i;
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
    const garden = districtById('garden');
    const spots = [[1,8],[4,8],[7,8],[10,8]].slice(0, state.gardens).map(([x,z])=>[garden.x+x,garden.z+z]);
    for (const [x, z] of spots) {
      part(groups.gardens, 'box', x, 0.26, z, 1.2, 0.2, 1.0, colours.soil);
      for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
        part(groups.gardens, 'rock', x + c * 0.36, 0.48, z + r * 0.3, 0.26, 0.26, 0.26, (r + c) % 2 ? colours.leaf : r === 0 ? colours.red : colours.gold);
      }
    }
    builder.flush();
  }

  // ---------- Home tiers (cottage → manor → keep → castle) ----------
  function buildCastle() {
    disposeGroup(groups.castle);
    const district = homeDistrict(state.builtTier);
    groups.castle.position.set(district.x,0,district.z); groups.castle.scale.setScalar(district.scale);
    groups.fx.position.set(district.x,0,district.z);
    models.home(groups.castle, state.builtTier, crestColour(state.crest.field), state.builtTier===0?Math.min(1,state.estateLevel):0);
    realmModels.finish(groups.castle);
  }
  function buildEstate() {
    disposeGroup(groups.estate);
  }
  function buildCourt() {
    court.setTier(state.builtTier, crestColour(state.crest.field));
    const profile = court.debug();
    renderer.domElement.setAttribute('aria-label', `Connected woodland realm: ${REALM_DISTRICTS.length} districts in one forest, joined by bridges over winding rivers, with ${profile.capacity} wandering guests. Locked districts keep their colours behind raised bridges and closed gates. ${profile.description}`);
  }

  // ---------- Household travelers ----------
  const householdParty = () => {
    const members = state.members?.length ? state.members : [{ id: 'traveler', role: 'adult', avatarId: 'ranger' }];
    return state.playMode === 'solo' ? members.slice(0, 1) : members;
  };
  function buildToken() {
    disposeGroup(groups.token);
    const cloak = crestColour(state.crest.field);
    // Gold "you are here" ring under the household travelers.
    part(groups.token, 'round', 0, 0.02, 0, 2.3, 0.08, 2.3, colours.gold);
    part(groups.token, 'round', 0, 0.05, 0, 1.95, 0.08, 1.95, colours.cream);
    const party = householdParty(), columns = Math.min(3, party.length);
    party.forEach((member, index) => addMemberModel(part, groups.token, member, {
      x: ((index % columns) - (columns - 1) / 2) * .95,
      z: Math.floor(index / columns) * .85,
      size: member.role === 'child' ? 1.05 : 1.45, index,
    }));
    // Walking staff with the household pennant.
    part(groups.token, 'round', 0.62, 1.15, 0.2, 0.06, 2.2, 0.06, colours.wood);
    part(groups.token, 'box', 0.9, 2.0, 0.2, 0.52, 0.34, 0.05, cloak);
    part(groups.token, 'rock', 0.62, 2.3, 0.2, 0.14, 0.14, 0.14, colours.gold);
    // Keep the marker clear of tall hats, including a solo wizard.
    const markerY = Math.max(3.75, ...party.map((m, i) => (m.role === 'child' ? 1.05 : 1.45) * (memberAvatar(m, i).kind === 'hat' ? 2.4 : 1.9) + 1));
    part(groups.token, 'cone', 0, markerY, 0, 1.0, 1.3, 1.0, colours.gold, 0, Math.PI);
    part(groups.token, 'rock', 0, markerY + .8, 0, 0.62, 0.5, 0.62, colours.gold);
    builder.flush();
    placeToken(shownPosition, 0);
  }
  // When the goal is complete (position 20) the travelers stand at the castle gate, home.
  function placeToken(position, lift) {
    const { x, z } = journeyPosition(position);
    groups.token.position.set(x, 0.31 + lift, z);
    if (position >= ROUTE_LENGTH) { groups.token.rotation.y = 0.35; return; }
    const ahead = journeyPosition(Math.min(position+.02, ROUTE_LENGTH));
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
      // Follow the road and the opened bridges, including the bend around the citadel moat.
      const homeward = Math.max(p,p+dir)===ROUTE_LENGTH;
      await run(homeward?1000:dir>0?440:300,(t)=>{placeToken(p+dir*easeInOut(t),Math.sin(Math.PI*t)*.35);});
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
    const size = homeDistrict(state.builtTier).scale;
    await run(1100, (t) => {
      const s = Math.max(0.05, easeOutBack(Math.min(1, t * 1.3)));
      groups.castle.scale.set(size, s*size, size);
      for (const m of sparks) { const [vx, vy, vz] = m.userData.v; m.position.set(vx * t, 3.2 + vy * t - 3 * t * t, vz * t); m.scale.setScalar(Math.max(0.01, 1 - t)); }
    });
    groups.castle.scale.setScalar(size);
    groups.fx.clear(); sparkGeo.dispose(); sparkMat.dispose();
  }

  function draw() {
    if (!renderer || !pipeline) return;
    // Measured per frame so the forest's cost stays visible in the test hooks.
    const start = performance.now(); renderer.info.reset();
    pipeline.render(scene, camera); frames++;
    const ms = performance.now() - start;
    Object.assign(perf, { lastMs: ms, maxMs: Math.max(perf.maxMs, ms), totalMs: perf.totalMs + ms, draws: perf.draws + 1, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    onViewChange(districtsOnScreen());
  }

  function ambientStep(seconds) {
    realmModels.stepCurrent(seconds);
    realmModels.stepFarm(seconds);
    realmModels.stepTavern(seconds);
    pipeline.stepCloudSurround(seconds);
    court.tick(seconds);
    for (const r of rotators) r.group.rotation[r.axis] = seconds * r.speed;
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
    stepRain(seconds);
  }
  function startAmbient() {
    if (reducedMotion || ambientTimer) return;
    let start = performance.now(), coveredAt = null;
    // About 8 frames per second while idle; the pixel look hides the low rate and it stays cheap.
    ambientTimer = setInterval(() => {
      const now = performance.now();
      if (isOccluded()) { coveredAt ??= now; return; }
      // Keep the same ambient phase after a card closes, rather than jumping through the covered interval.
      if (coveredAt !== null) { start += now - coveredAt; coveredAt = null; }
      if (document.hidden) return;
      ambientStep((now - start) / 1000);
      ambientFrames++;
      if (!animating && (view.focus || view.zoom>1.1 || ambientFrames%2===0)) draw();
    }, 125);
  }
  // ---------- Atmosphere: day, afternoon, night and rain (cosmetic; never progress, access or rewards) ----------
  // Light comes from the world: emissive window and lantern glass, a few distance-limited warm point lights at the
  // district doors, and cheap warm pools on the ground. Rain is two instanced layers of streaks plus re-placed splashes,
  // moved only on the existing ambient tick; reduced motion keeps them still.
  const LOOKS = {
    day: { sky: 0xeaf6ff, ground: 0x65714f, hemi: 2.7, sun: 0xffe9bf, sunI: 3.4, sunAt: [-12, 25, 17], water: 0x2f6f9f, overcast: 0x9fabb6 },
    afternoon: { sky: 0xc8d4ea, ground: 0x6b5a46, hemi: 2.15, sun: 0xffb262, sunI: 4.1, sunAt: [-30, 13, 8], water: 0x2c6690, overcast: 0xa3a3a8 },
    night: { sky: 0x6aa6c8, ground: 0x24424c, hemi: 1.5, sun: 0xa9c1ff, sunI: 0.9, sunAt: [18, 30, -14], water: 0x1b3d62, overcast: 0x5a6f80 },
  };
  const atmosphere = { period: 'day', weather: 'clear' };
  let glow = null; let rain = null;
  function seeded(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
  function buildAtmosphere() {
    const t = new THREE.Object3D(), spots = realmModels.lightSpots();
    // Each pool is five concentric low-opacity discs in one instanced mesh: warm at the centre, falling off at the edge.
    const rings = [1, 0.8, 0.6, 0.42, 0.26];
    const pools = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 18), new THREE.MeshBasicMaterial({ color: 0xffc261, transparent: true, opacity: 0.11, depthWrite: false }), spots.length * rings.length);
    spots.forEach((spot, i) => rings.forEach((ring, k) => {
      const r = (spot.kind === 'door' ? 8 : 4.8) * ring;
      t.position.set(spot.x, 0.36 + k * 0.004, spot.z); t.scale.set(r, 0.02, spot.kind === 'door' ? r * 0.8 : r); t.updateMatrix(); pools.setMatrixAt(i * rings.length + k, t.matrix);
    }));
    pools.renderOrder = 2; pools.visible = false; pools.userData.ownedGeometry = true; pools.userData.ownedMaterial = true; groups.atmosphere.add(pools);
    const lights = spots.filter((spot) => spot.kind === 'door').map((spot) => {
      const light = new THREE.PointLight(0xffb45c, 0, 20, 2); light.position.set(spot.x, 3.4, spot.z); light.visible = false; groups.atmosphere.add(light); return light;
    });
    glow = { pools, lights, glass: builder.material(models.roles.glass), lamp: builder.material(models.roles.lamp) };

    const density = REALM_SIZE.width * REALM_SIZE.depth / (164 * 114);
    const rand = seeded(20261104), height = 14, count = Math.round(540 * density);
    const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xc9deeb, transparent: true, opacity: 0.5, depthWrite: false }), count * 2);
    for (let i = 0; i < count; i++) {
      const x = REALM_BOUNDS.minX + rand() * REALM_SIZE.width, z = REALM_BOUNDS.minZ + rand() * REALM_SIZE.depth, y = rand() * height;
      for (const layer of [0, 1]) { t.position.set(x, y + layer * height, z); t.rotation.set(0, 0, 0.2); t.scale.set(0.13, 1.9, 0.13); t.updateMatrix(); streaks.setMatrixAt(i * 2 + layer, t.matrix); }
    }
    streaks.renderOrder = 3; streaks.userData.ownedGeometry = true; streaks.userData.ownedMaterial = true;
    const splashes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xdcebf3, transparent: true, opacity: 0.75, depthWrite: false }), Math.round(220 * density));
    const placeSplash = (i) => { t.position.set(REALM_BOUNDS.minX + 2 + rand() * (REALM_SIZE.width - 4), 0.33, REALM_BOUNDS.minZ + 2 + rand() * (REALM_SIZE.depth - 4)); t.rotation.set(0, rand() * 3, 0); t.scale.set(0.42, 0.03, 0.42); t.updateMatrix(); splashes.setMatrixAt(i, t.matrix); };
    for (let i = 0; i < splashes.count; i++) placeSplash(i);
    splashes.renderOrder = 3; splashes.userData.ownedGeometry = true; splashes.userData.ownedMaterial = true;
    const group = new THREE.Group(); group.add(streaks, splashes); group.visible = false; groups.atmosphere.add(group);
    rain = { group, streaks, splashes, height, placeSplash, next: 0 };
  }
  function stepRain(seconds) {
    if (!rain?.group.visible || reducedMotion) return;
    rain.streaks.position.y = -((seconds * 9) % rain.height);
    for (let k = 0; k < 40; k++) { rain.placeSplash(rain.next); rain.next = (rain.next + 1) % rain.splashes.count; }
    rain.splashes.instanceMatrix.needsUpdate = true;
  }
  function applyAtmosphere() {
    const look = LOOKS[atmosphere.period] ?? LOOKS.day, wet = atmosphere.weather === 'rain', dull = wet || atmosphere.weather === 'overcast';
    const night = atmosphere.period === 'night';
    pipeline.setCloudSurround({ enabled: true, period: atmosphere.period, weather: atmosphere.weather });
    hemi.color.setHex(look.sky); if (dull) hemi.color.lerp(new THREE.Color(look.overcast), 0.65);
    hemi.groundColor.setHex(look.ground); hemi.intensity = look.hemi * (wet ? (night ? 0.85 : 0.7) : dull ? 0.84 : 1);
    sun.color.setHex(look.sun); sun.intensity = look.sunI * (wet ? 0.3 : dull ? 0.5 : 1); sun.position.set(...look.sunAt);
    rain.streaks.material.color.setHex(night ? 0x9db6cf : 0xd0e2ee);
    const { ground, water, ripples } = realmModels.surfaces();
    water?.material.color.setHex(look.water); if (wet) water?.material.color.multiplyScalar(0.82);
    ripples?.material.color.setHex(look.water).lerp(new THREE.Color(0x9abfc1), night ? .22 : .6);
    if (wet) ripples?.material.color.multiplyScalar(0.82);
    ground?.material.color.setHex(wet ? 0xbcc7c5 : 0xffffff);
    // Wet roofs and walls: a lower roughness gives the standard materials a damp sheen.
    for (const material of builder.materials.values()) material.roughness = wet ? 0.5 : 0.87;
    glow.glass.emissive.setHex(night ? 0xffbd5a : 0x000000); glow.glass.emissiveIntensity = night ? 1.45 : 0;
    glow.lamp.emissive.setHex(night ? 0xffd27a : 0x000000); glow.lamp.emissiveIntensity = night ? 2 : 0;
    glow.pools.visible = night;
    for (const light of glow.lights) { light.visible = night; light.intensity = night ? 60 : 0; }
    rain.group.visible = wet;
    if (!wet) rain.streaks.position.y = 0;
  }
  function atmosphereDebug() {
    let panes = 0, lamps = 0;
    scene.traverse((o) => { if (o.isInstancedMesh && o.material === glow.glass) panes += o.count; if (o.isInstancedMesh && o.material === glow.lamp) lamps += o.count; });
    return {
      ...atmosphere, panes, lamps, glassGlow: glow.glass.emissiveIntensity, lampGlow: glow.lamp.emissiveIntensity,
      pointLights: glow.lights.filter((l) => l.visible).length, pointLightCapacity: glow.lights.length, pools: glow.pools.visible ? glow.pools.count : 0,
      rain: { visible: rain.group.visible, streaks: rain.streaks.count, splashes: rain.splashes.count, animated: rain.group.visible && !reducedMotion && Boolean(ambientTimer) },
      hemi: hemi.intensity, sun: sun.intensity,
    };
  }

  // ---------- Camera: fit the whole island, then let people turn, zoom and pan ----------
  // The default view frames the entire realm (its earth sides, edge trees and the tallest castle tower) at any
  // rotation, in the part of the canvas not covered by the heading, view controls or caption. Zoom in for detail.
  const FRAME_POINTS = [];
  const half = { x: REALM_SIZE.width / 2 + 0.2, z: REALM_SIZE.depth / 2 + 0.2 };
  for (const x of [REALM_SIZE.centerX - half.x, REALM_SIZE.centerX + half.x]) for (const z of [REALM_SIZE.centerZ - half.z, REALM_SIZE.centerZ + half.z]) for (const y of [-2.4, 4.2]) FRAME_POINTS.push(new THREE.Vector3(x, y, z));
  for (const d of REALM_DISTRICTS) FRAME_POINTS.push(new THREE.Vector3(d.x,d.height,d.z));
  const ZOOM = { min: 0.55, max: 2.8 };
  const scratch = new THREE.Vector3();
  function resize() {
    const width = container.clientWidth; const height = container.clientHeight;
    if (!width || !height) return;
    const aspect = width / height; const narrow = width < 640;
    camera.updateMatrixWorld();
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    const focused = viewLocation(view.focus), bridge = REALM_BRIDGES.find((b) => b.id === view.crossing);
    const framed = bridge ? [districtById(bridge.from), districtById(bridge.to)] : focused ? [focused] : [];
    const frame = framed.length ? framed.flatMap((d) => [-1,1].flatMap(x=>[-1,1].flatMap(z=>[-2,d.height].map(y=>new THREE.Vector3(d.x+x*(d.width/2+2),y,d.z+z*(d.depth/2+2)))))) : FRAME_POINTS;
    for (const point of frame) {
      scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, scratch.x); maxX = Math.max(maxX, scratch.x); minY = Math.min(minY, scratch.y); maxY = Math.max(maxY, scratch.y);
    }
    // Fractions of the canvas covered by overlays (heading and controls at the top, caption at the bottom).
    const measured = insets?.() ?? null;
    const topInset = Math.min(0.45, measured?.top ?? (narrow ? 0.27 : 0.15));
    const bottomInset = Math.min(0.3, measured?.bottom ?? (narrow ? 0.03 : 0.11));
    const usable = 1 - topInset - bottomInset;
    const viewHeight = Math.max((maxY - minY) / usable, (maxX - minX) / aspect) * 1.03 / view.zoom;
    const viewWidth = viewHeight * aspect;
    const cx = (minX + maxX) / 2 - view.panX; const cy = (minY + maxY) / 2 - view.panY;
    camera.left = cx - viewWidth / 2; camera.right = cx + viewWidth / 2;
    camera.top = cy + viewHeight * (topInset + usable / 2); camera.bottom = camera.top - viewHeight;
    camera.updateProjectionMatrix();
    view.worldPerPixel = viewHeight / height;
    renderer.setSize(width, height, false); pipeline.setSize(width, height); draw();
  }
  function updateCamera() {
    const focus = viewLocation(view.focus), bridge = REALM_BRIDGES.find((b) => b.id === view.crossing);
    const from = bridge && districtById(bridge.from), to = bridge && districtById(bridge.to);
    const x = bridge ? (from.x + to.x) / 2 : focus?.x ?? REALM_SIZE.centerX, z = bridge ? (from.z + to.z) / 2 : focus?.z ?? REALM_SIZE.centerZ;
    camera.position.set(x+Math.sin(view.angle)*180,150,z+Math.cos(view.angle)*180);
    camera.lookAt(x,1.2,z);camera.updateMatrixWorld();
  }
  const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
  function pan(dxPixels, dyPixels) {
    // Keep at least the middle of the estate in view.
    const limit = view.focus ? 25 : 90;
    view.panX = Math.max(-limit, Math.min(limit, view.panX + dxPixels * (view.worldPerPixel ?? 0.05)));
    view.panY = Math.max(-limit, Math.min(limit, view.panY - dyPixels * (view.worldPerPixel ?? 0.05)));
  }
  function bindView() {
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    const bind = (name, fn, options) => { canvas.addEventListener(name, fn, options); interactions.push([name, fn, options]); };
    bind('contextmenu', (e) => e.preventDefault());
    bind('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, panning: e.shiftKey || e.button === 2 || e.button === 1 });
    });
    bind('pointermove', (e) => {
      const prior = pointers.get(e.pointerId); if (!prior) return;
      const dx = e.clientX - prior.x; const dy = e.clientY - prior.y;
      viewRevision++;
      if (pointers.size === 2) {
        // Two fingers: pinch to zoom, move together to pan.
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
        if (other) {
          const before = Math.hypot(prior.x - other.x, prior.y - other.y); const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (before > 5) view.zoom = clampZoom(view.zoom * (after / before));
          pan(dx / 2, dy / 2);
        }
      } else if (prior.panning) pan(dx, dy);
      else view.angle += dx * 0.006;
      pointers.set(e.pointerId, { ...prior, x: e.clientX, y: e.clientY });
      updateCamera(); resize();
    });
    const release = (e) => pointers.delete(e.pointerId);
    bind('pointerup', release); bind('pointercancel', release); bind('lostpointercapture', release);
    bind('wheel', (e) => { e.preventDefault(); viewRevision++; view.zoom = clampZoom(view.zoom * Math.exp(-e.deltaY * 0.001)); resize(); }, { passive: false });
  }

  // ---------- Setup ----------
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
  // The post-process defines art pixels in CSS pixels. Rendering its output at retina density adds no detail.
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.info.autoReset = false;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Woodland board with deer, a brook and the household home');
  container.append(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0xd4ddd0);
  const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x65714f, 2.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9bf, 3.4); sun.position.set(-12, 25, 17); scene.add(sun);
  camera = new THREE.OrthographicCamera(-90, 90, 60, -60, 0.1, 800); updateCamera();
  builder = new MiniBuilder();
  addEstateGeometry(builder);
  models = createEstateModels({ part, builder, colours });
  realmModels = createRealmModels({part,builder,models,colours});
  pipeline = addCloudSurround(new PixelRenderer(renderer));
  pipeline.setCloudSurround({ enabled: true, bounds: [REALM_SIZE.width / 2, REALM_SIZE.depth / 2], center: [REALM_SIZE.centerX, REALM_SIZE.centerZ] });
  pipeline.configure({ pixelSize: 2, pixelMode: true, outlines: true, dither: true, exposure: 1.05 });
  for (const name of ['woodland', 'land', 'route', 'gardens', 'token', 'fx', 'estate', 'court', 'atmosphere']) { groups[name] = new THREE.Group(); scene.add(groups[name]); }
  court = createEstateCourt(groups.court, builder, colours);
  groups.castle = new THREE.Group(); scene.add(groups.castle);
  realmModels.woodland(groups.woodland);
  buildAtmosphere();
  buildLandscape();buildRoute(); buildGardens(); buildCastle(); buildEstate(); buildToken(); buildCourt();
  observer = new ResizeObserver(resize); observer.observe(container); resize();
  startAmbient();
  bindView();

  return {
    /** Apply server state. Returns a promise that resolves when movement/upgrade animation ends. */
    update(next, { animate = true } = {}) {
      queue = queue.then(async () => {
        const prev = state;
        state = { ...state, ...next, crest: { ...state.crest, ...(next.crest ?? {}) } };
        const crestChanged = prev.crest.field !== state.crest.field || prev.crest.charge !== state.crest.charge;
        if (crestChanged || prev.playMode !== state.playMode || JSON.stringify(prev.members) !== JSON.stringify(state.members)) buildToken();
        if (prev.gardens !== state.gardens) buildGardens();
        const tierUp = state.builtTier > prev.builtTier;
        const cameraRevision = viewRevision;
        let openedBridge = null;
        animating = true;
        try {
          const rebuild = crestChanged || prev.builtTier!==state.builtTier || prev.estateLevel!==state.estateLevel || prev.gardens!==state.gardens || prev.previewFeature!==state.previewFeature;
          if(rebuild){
            const oldOpen = new Set(realm.bridges.filter(b=>b.open).map(b=>b.id));
            buildLandscape();buildCastle();applyAtmosphere(); // new materials take the current light and wetness
            const opening = realm.bridges.filter(b=>b.open&&!oldOpen.has(b.id));
            if (animate && opening.length) {
              openedBridge = opening.find((b) => b.to === homeDistrict(state.builtTier).id) ?? opening[0];
              for (const bridge of opening) for (const panel of bridge.panels) panel.group.rotation.z = panel.sign * 1.03;
              Object.assign(view, { focus: null, crossing: openedBridge.id, zoom: 1, panX: 0, panY: 0 }); updateCamera(); resize();
              emit('bridge:start', { id: openedBridge.id, district: openedBridge.to });
              await run(850, (t) => { for (const bridge of opening) for (const panel of bridge.panels) panel.group.rotation.z = panel.sign * 1.03 * (1 - easeInOut(t)); });
              emit('bridge:open', { id: openedBridge.id, district: openedBridge.to });
            }
          }
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
          if (crestChanged || prev.estateLevel !== state.estateLevel || prev.previewFeature !== state.previewFeature) buildEstate();
          if (crestChanged || prev.builtTier !== state.builtTier) buildCourt();
          if (openedBridge && viewRevision === cameraRevision) {
            Object.assign(view, { crossing: null, focus: openedBridge.to, zoom: 1, panX: 0, panY: 0 }); updateCamera(); resize();
          }
          if (tierUp && animate) await rise();
          if (openedBridge) emit('arrival', { district: openedBridge.to, tier: state.builtTier });
        } finally {
          animating = false;
          draw();
        }
      });
      return queue;
    },
    /** Buttons and keyboard: zoom, turn, pan or reset the view. Presentation only. */
    adjustView(action) {
      viewRevision++;
      if (action === 'in') view.zoom = clampZoom(view.zoom * 1.2);
      if (action === 'out') view.zoom = clampZoom(view.zoom / 1.2);
      if (action === 'left') view.angle -= 0.26;
      if (action === 'right') view.angle += 0.26;
      const step = 90;
      if (action === 'pan-left') pan(step, 0);
      if (action === 'pan-right') pan(-step, 0);
      if (action === 'pan-up') pan(0, step);
      if (action === 'pan-down') pan(0, -step);
      if (action === 'reset' || action === 'overview') Object.assign(view, { angle: 0.66, zoom: 1, panX: 0, panY: 0, focus: null, crossing: null });
      updateCamera(); resize();
      return { ...view };
    },
    focusDistrict(id) {
      if(!districtById(id))return;
      viewRevision++; Object.assign(view,{focus:id,crossing:null,zoom:1,panX:0,panY:0});updateCamera();resize();
    },
    focusLegend(id) {
      if(!legendById(id))return;
      viewRevision++; Object.assign(view,{focus:id,crossing:null,zoom:1,panX:0,panY:0});updateCamera();resize();
    },
    setPixelMode(on) { pipeline.configure({ pixelMode: on }); draw(); },
    /** Cosmetic light and weather: period 'day' | 'afternoon' | 'night', weather 'clear' | 'rain' | 'overcast'. */
    setAtmosphere({ period = atmosphere.period, weather = atmosphere.weather } = {}) {
      atmosphere.period = LOOKS[period] ? period : 'day';
      atmosphere.weather = ['clear', 'rain', 'overcast'].includes(weather) ? weather : 'clear';
      applyAtmosphere(); draw();
      return atmosphereDebug();
    },
    /** Test hook: where each route space and the travelers sit on the canvas, in CSS pixels. */
    routeOnScreen() {
      const rect = container.getBoundingClientRect();
      const toScreen = (x, y, z) => {
        scratch.set(x, y, z).project(camera);
        return { x: rect.left + ((scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - scratch.y) / 2) * rect.height };
      };
      const spaces = Array.from({ length: ROUTE_LENGTH }, (_, i) => { const { x, z } = spacePosition(i); return { index: i, ...toScreen(x, 0.3, z) }; });
      const t = groups.token.position;
      return { spaces, travelers: toScreen(t.x, t.y + 1.5, t.z), canvas: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    },
    debug: () => ({ region: REALM_SIZE, estateLevel: state.estateLevel, view: { ...view }, previewFeature: state.previewFeature, tier: state.builtTier, position: state.position, shownPosition, gardens: state.gardens, crest: { ...state.crest }, playMode: state.playMode, familyAvatars: householdParty().map((m, i) => ({ memberId: m.id, avatarId: memberAvatar(m, i).id, role: m.role })), animating, frames, ambient: Boolean(ambientTimer), ambientFrames, grazers: grazers.length, butterflies: flutterers.length, court: court.debug(), legends: REALM_LEGENDS.map(({id,x,z})=>({id,x,z})), districts: realm.districts.map(({id,open,status,greyPaint,drawMeshes,hues})=>({id,open,status,greyPaint,drawMeshes,hues})), bridges: realm.bridges.map(({id,open,panels,gate,river})=>({id,open,gate,river,raised:panels.some(p=>Math.abs(p.group.rotation.z)>.01)})), landscape: realm.landscape, tavern: realmModels.tavernDebug(), farm: realmModels.farmDebug(), riverCurrent: realmModels.currentDebug(), surround: pipeline.cloudSurroundDebug(), atmosphere: atmosphereDebug(), render: { ...perf, averageMs: perf.draws ? perf.totalMs / perf.draws : 0, geometries: renderer.info.memory.geometries } }),
    dispose() { for (const [name,fn,options] of interactions) renderer.domElement.removeEventListener(name,fn,options); clearInterval(ambientTimer); observer?.disconnect(); court?.dispose(); for (const g of Object.values(groups)) disposeGroup(g); flutterGeo?.dispose(); builder?.dispose(); pipeline?.dispose(); renderer?.dispose(); },
  };

  function districtsOnScreen(){
    const rect=container.getBoundingClientRect();
    return {focus:view.focus,points:[...REALM_DISTRICTS,...REALM_LEGENDS].map(d=>{
      const point=new THREE.Vector3(d.x,d.height+1,d.z).project(camera);
      return {id:d.id,x:(point.x+1)/2*rect.width,y:(1-point.y)/2*rect.height,width:rect.width,height:rect.height};
    })};
  }
}
