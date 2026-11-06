import * as THREE from 'three';
import { districtById } from '../core/realm.js';

// Earned courtyard ornaments. Access comes from the existing realm, never an amount,
// browser click, provider callback or new reward rule. Coordinates are district-local.
const SITES = Object.freeze([
  { district: 'manor', x: -13, z: 1 },
  { district: 'market', x: 10, z: 9 },
  { district: 'keep', x: 12, z: 9 },
  { district: 'castle', x: -12, z: 12 },
].map((site) => Object.freeze(site)));

export function createGoldFountains({ builder, colours: C, reducedMotion = false }) {
  const group = new THREE.Group(), stone = new THREE.Group();
  group.name = 'milestone-fountains'; group.add(stone);
  const transform = new THREE.Object3D(), total = 48;
  const coinGeo = new THREE.CylinderGeometry(.23, .23, .09, 8);
  const coinMat = new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: .1, roughness: .46, flatShading: true });
  const coinEdge = new THREE.MeshStandardMaterial({ color: C.wood, roughness: .6, flatShading: true });
  const coins = new THREE.InstancedMesh(coinGeo, [coinEdge, coinMat, coinMat], total);
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage); coins.frustumCulled = false; coins.visible = false;
  group.add(coins);
  let sites = [], signature = '', active = null, bursts = 0, phase = 0, sample = null, disposed = false;
  const history = [];
  const part = (kind, x, y, z, w, h, d, colour, ry = 0, rz = 0) => builder.part(stone, kind, x, y, z, w, h, d, colour, ry, rz);
  const round = (x, y, z, w, h, d, c) => part('round', x, y, z, w, h, d, c);
  const box = (x, y, z, w, h, d, c, ry = 0, rz = 0) => part('box', x, y, z, w, h, d, c, ry, rz);

  function build(site) {
    const { x, z } = site;
    // A stepped ivory basin, eight carved buttresses and a small crowned spout.
    round(x, .34, z, 4.45, .18, 4.45, C.stone);
    round(x, .47, z, 4.08, .16, 4.08, C.cream);
    round(x, .7, z, 3.76, .4, 3.76, C.stone);
    round(x, .9, z, 3.92, .13, 3.92, C.cream);
    round(x, .98, z, 3.98, .065, 3.98, C.gold);
    round(x, 1.0, z, 3.38, .035, 3.38, C.water);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
      box(x + dx * 1.83, .69, z + dz * 1.83, .25, .42, .25, C.cream, -a);
      part('rock', x + dx * 1.91, .8, z + dz * 1.91, .19, .23, .12, C.gold, -a);
      box(x + dx * 1.83, .48, z + dz * 1.83, .28, .055, .28, C.soil);
    }
    round(x, 1.39, z, .52, 1.0, .52, C.stone);
    for (const y of [1.0, 1.63]) round(x, y, z, .7, .09, .7, C.gold);
    round(x, 1.93, z, 1.65, .22, 1.65, C.cream);
    round(x, 2.08, z, 1.83, .09, 1.83, C.gold);
    round(x, 2.14, z, 1.44, .04, 1.44, C.water);
    round(x, 2.38, z, .2, .47, .2, C.cream);
    round(x, 2.61, z, .47, .11, .47, C.gold);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      box(x + Math.cos(a) * .18, 2.76, z + Math.sin(a) * .18, .1, .24, .1, C.gold);
      part('rock', x + Math.cos(a) * .18, 2.92, z + Math.sin(a) * .18, .14, .14, .14, C.cream);
    }
    // A permanent little spill, restored from earned access on reload. It is not a balance.
    for (let i = 0; i < 30; i++) {
      const a = i * 2.399963, r = i < 9 ? .35 + i * .11 : 1.82 + (i % 7) * .08;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      const y = i < 9 ? 1.04 + (i % 3) * .065 : r < 2.02 ? 1.02 + (i % 3) * .055 : r < 2.23 ? .49 + (i % 3) * .05 : .29 + (i % 3) * .045;
      round(cx, y, cz, .34, .09, .34, C.wood);
      round(cx, y + .052, cz, .31, .045, .31, C.gold);
      box(cx, y + .079, cz, .12, .022, .07, C.cream, a);
    }
    // Four small streams descend into the lower pool. Static in reduced motion.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
      const a = i * Math.PI / 2 + Math.PI / 4, t = j / 4, r = .75 + t * .55;
      round(x + Math.cos(a) * r, 2.04 - t * t * .97, z + Math.sin(a) * r, .11, .18, .11, C.water);
    }
  }

  function clearStone() {
    // Static instance batches borrow the builder's geometry/materials.
    stone.traverse((mesh) => { if (mesh.isInstancedMesh) mesh.dispose(); });
    stone.clear();
  }
  return {
    group,
    sync(districts) {
      const open = new Set(districts.filter((d) => d.open).map((d) => d.id));
      const next = SITES.filter((s) => open.has(s.district));
      const key = next.map((s) => s.district).join(',');
      if (key === signature) return;
      signature = key; sites = next.map((s) => { const d = districtById(s.district); return { ...s, x: d.x + s.x, z: d.z + s.z }; });
      clearStone(); sites.forEach(build); builder.flush();
      if (active && !open.has(active.district)) { active = null; coins.visible = false; }
    },
    begin(district) {
      const site = sites.find((s) => s.district === district);
      if (!site) return false;
      active = site; bursts++; phase = 0;
      history.push(district); if (history.length > 12) history.shift();
      // A resize between this event and the first animation frame must not show
      // old instance positions at the previous courtyard or at the world origin.
      transform.position.set(site.x, 2.22, site.z); transform.scale.setScalar(0); transform.updateMatrix();
      for (let i = 0; i < total; i++) coins.setMatrixAt(i, transform.matrix);
      coins.instanceMatrix.needsUpdate = true;
      coins.visible = !reducedMotion;
      return true;
    },
    step(t) {
      if (!active) return;
      phase = t;
      if (reducedMotion) return;
      for (let i = 0; i < total; i++) {
        const delay = (i % 8) * .045, u = Math.max(0, Math.min(1, (t - delay) / (1 - delay)));
        const a = i * 2.399963, r = .22 + u * (1.78 + (i % 5) * .18);
        const x = active.x + Math.cos(a) * r, z = active.z + Math.sin(a) * r;
        const landingRadius = 2 + (i % 5) * .18, landingY = landingRadius < 2.02 ? 1.1 : landingRadius < 2.23 ? .56 : .34;
        const y = 2.22 + Math.sin(u * Math.PI) * (1.55 + (i % 4) * .25) + u * (landingY - 2.22);
        transform.position.set(x, y, z); transform.rotation.set(u * 5 + i, a + u * 3, u * 7);
        transform.scale.setScalar(t < delay || u >= 1 ? 0 : .9 + .15 * Math.sin(u * Math.PI));
        transform.updateMatrix(); coins.setMatrixAt(i, transform.matrix);
        if (i === 0) sample = { x, y, z };
      }
      coins.instanceMatrix.needsUpdate = true;
    },
    end() { active = null; coins.visible = false; phase = 1; },
    debug: () => ({ sites: sites.map((s) => ({ ...s })), bursts, history: [...history], active: active?.district ?? null, phase, sample: sample && { ...sample }, flyingCoins: coins.visible ? total : 0, settledCoins: sites.length * 30, reducedMotion, disposed }),
    dispose() { clearStone(); coins.dispose(); coinGeo.dispose(); coinMat.dispose(); coinEdge.dispose(); group.clear(); disposed = true; },
  };
}
