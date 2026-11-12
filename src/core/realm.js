import { WOODLAND_CAMP, WOODLAND_GLADE } from './woodland-discoveries.js';
// One connected world. District access is a presentation of existing earned achievements, never a payment decision.
export const REALM_INTERIOR = Object.freeze({ width: 228, depth: 132, centerX: 32, centerZ: 0 });
// A further half-square of breathing room beyond the complete mountain feet.
export const REALM_BORDER = 112;
export const REALM_SIZE = Object.freeze({ width: REALM_INTERIOR.width + REALM_BORDER * 2, depth: REALM_INTERIOR.depth + REALM_BORDER * 2, centerX: 32, centerZ: 0 });
export const REALM_BOUNDS = Object.freeze({
  minX: REALM_SIZE.centerX - REALM_SIZE.width / 2, maxX: REALM_SIZE.centerX + REALM_SIZE.width / 2,
  minZ: REALM_SIZE.centerZ - REALM_SIZE.depth / 2, maxZ: REALM_SIZE.centerZ + REALM_SIZE.depth / 2,
});
export const REALM_DISTRICTS = Object.freeze([
  { id: 'cottage', name: 'Hearth Village', x: -60, z: 26, width: 34, depth: 32, height: 6, homeTier: 0, percent: 0, scale: 1 },
  { id: 'manor', name: 'Manor Gardens', x: -10, z: 26, width: 40, depth: 36, height: 10, homeTier: 1, percent: 25, scale: 1.2 },
  { id: 'market', name: 'Market Town', x: 44, z: 26, width: 32, depth: 30, height: 9, homeTier: null, percent: 40, scale: 1 },
  { id: 'garden', name: 'Woodland Garden', x: -60, z: -28, width: 34, depth: 38, height: 9, homeTier: null, percent: null, scale: 1 },
  { id: 'keep', name: 'Stone Keep', x: -10, z: -28, width: 42, depth: 38, height: 13, homeTier: 2, percent: 60, scale: 1.35 },
  { id: 'wizard', name: 'Starfall Observatory', x: 94, z: 28, width: 26, depth: 30, height: 27, homeTier: null, percent: 60, scale: 1 },
  { id: 'castle', name: 'Royal Citadel', x: 47, z: -28, width: 50, depth: 46, height: 22, homeTier: 3, percent: 100, scale: 1.65 },
  { id: 'palace', name: 'Rosewind Palace', x: 112, z: -26, width: 50, depth: 46, height: 27, homeTier: null, percent: 100, scale: 1 },
  { id: 'rapunzel', name: 'Rapunzel’s Tower', x: 128, z: 30, width: 24, depth: 30, height: 28, homeTier: null, percent: 100, scale: 1 },
].map(Object.freeze));
export const homeDistrict = (tier) => REALM_DISTRICTS.find((d) => d.homeTier === tier) ?? REALM_DISTRICTS[0];
export const districtById = (id) => REALM_DISTRICTS.find((d) => d.id === id);
// Discoveries are scenery, never reward entries or payment gates.
export const REALM_LEGENDS = Object.freeze([
  Object.freeze({ ...WOODLAND_CAMP, id: 'knights-rest', name: 'The Knights’ Rest' }),
  Object.freeze({ ...WOODLAND_GLADE, id: 'lantern-glade', name: 'The Lantern Glade' }),
  Object.freeze({ id: 'sword-stone', name: 'The Sword in the Stone', x: -35, z: -51, width: 14, depth: 14, height: 8 }),
]);
export const legendById = (id) => REALM_LEGENDS.find((d) => d.id === id);
export const viewLocation = (id) => districtById(id) ?? legendById(id);
export const REALM_BRIDGES = Object.freeze([
  { id: 'manor-bridge', from: 'cottage', to: 'manor', a: [-43, 26], b: [-30, 26] },
  { id: 'keep-bridge', from: 'manor', to: 'keep', a: [-10, 8], b: [-10, -9] },
  { id: 'citadel-bridge', from: 'keep', to: 'castle', a: [11, -28], b: [22, -28] },
  { id: 'market-bridge', from: 'manor', to: 'market', a: [10, 26], b: [28, 26] },
  { id: 'garden-bridge', from: 'cottage', to: 'garden', a: [-60, 10], b: [-60, -9] },
  { id: 'palace-bridge', from: 'castle', to: 'palace', a: [74, -28], b: [90, -28] },
  { id: 'wizard-bridge', from: 'market', to: 'wizard', a: [62, 28], b: [81, 28] },
  { id: 'rapunzel-bridge', from: 'wizard', to: 'rapunzel', a: [107, 30], b: [116, 30] },
  { id: 'royal-procession', from: 'market', to: 'castle', a: [44, 11], b: [44, -5] },
].map((b) => Object.freeze({ ...b, a: Object.freeze(b.a), b: Object.freeze(b.b) })));

// Narrow, connected rivers through one continuous forest (presentation geography). Each passes under the middle of its
// bridges: the main river under the garden, keep and royal-procession crossings; a west tributary under the manor
// crossing; an east tributary under the citadel and market crossings. Control points are joined by Catmull-Rom curves.
export const REALM_RIVERS = Object.freeze([
  { id: 'main', halfWidth: 2.4, points: [[-200, 3], [-152, 3], [-120, 3], [-86, 3], [-72, -2.5], [-60, .5], [-49, 4], [-38, 1.5], [-24, -3], [-10, -.5], [3, 2.5], [17, -.5], [30, .5], [44, 3], [57, .5], [70, 3.5], [83, 3], [98, 2], [113, 3.5], [130, 2], [150, 2], [184, 2], [216, 2], [264, 2]] },
  { id: 'west', halfWidth: 1.9, points: [[-38, 1.5], [-35.5, 9], [-37.5, 17], [-36.5, 26], [-34.5, 35], [-37.5, 45], [-36, 72], [-36, 104], [-36, 136], [-36, 184]] },
  { id: 'east', halfWidth: 1.9, points: [[16, -184], [16, -136], [16, -104], [16, -72], [18, -47], [15, -38], [16.5, -28], [18, -18], [15.5, -9], [17, -.5], [20, 8], [17.5, 17], [19, 26], [21.5, 35], [18, 45], [20, 72], [20, 104], [20, 136], [20, 184]] },
  { id: 'rose', halfWidth: 1.9, points: [[82, -184], [82, -136], [82, -104], [82, -72], [80, -58], [81, -45], [82, -28], [79, -15], [81, -6], [83, 3]] },
  { id: 'starfall', halfWidth: 1.45, points: [[70, 3.5], [72.5, 14], [71.5, 28], [70.5, 43], [73, 72], [73, 104], [73, 136], [73, 184]] },
  { id: 'braid', halfWidth: 1.4, points: [[113, 3.5], [112.5, 16], [111.5, 30], [112, 44], [112, 72], [112, 104], [112, 136], [112, 184]] },
].map((r) => Object.freeze({ ...r, points: Object.freeze(r.points.map((p) => Object.freeze(p))) })));
function sampleRiver(points, steps = 10) {
  const out = [], at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push([...points.at(-1)]);
  return out;
}
export const RIVER_PATHS = Object.freeze(REALM_RIVERS.map((r) => Object.freeze({ id: r.id, halfWidth: r.halfWidth, path: Object.freeze(sampleRiver(r.points)) })));
// Every segment of every river, flattened once: start, direction and 1 / length². The ground asks riverAt about each of
// its vertices while the realm opens, so the loop below allocates nothing and takes a square root only for a segment
// that could actually win.
const RIVER_SEGMENTS = RIVER_PATHS.map((river) => {
  const n = river.path.length - 1, data = new Float64Array(n * 5);
  for (let i = 0; i < n; i++) {
    const [ax, az] = river.path[i], [bx, bz] = river.path[i + 1], dx = bx - ax, dz = bz - az;
    data.set([ax, az, dx, dz, dx * dx + dz * dz || 1], i * 5);
  }
  // Runs of sixteen segments with the box that holds them, so a far stretch of river is dismissed in one step.
  const boxes = [];
  for (let start = 0; start < n; start += 16) {
    const end = Math.min(n, start + 16), xs = [], zs = [];
    for (let i = start; i <= end; i++) { xs.push(river.path[i][0]); zs.push(river.path[i][1]); }
    boxes.push(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), start * 5, end * 5);
  }
  return { id: river.id, halfWidth: river.halfWidth, data, boxes: Float64Array.from(boxes) };
});
/** Distance from (x, z) to the nearest river centre line, that river's half width, and how far inside the water the point is. */
export function riverAt(x, z) {
  // First, from the boxes alone: the answer is at least this deep, because some segment lies within its box's far corner.
  let floor = -Infinity;
  for (const river of RIVER_SEGMENTS) {
    const b = river.boxes;
    for (let k = 0; k < b.length; k += 6) {
      const fx = Math.max(Math.abs(x - b[k]), Math.abs(x - b[k + 2])), fz = Math.max(Math.abs(z - b[k + 1]), Math.abs(z - b[k + 3]));
      floor = Math.max(floor, river.halfWidth - Math.sqrt(fx * fx + fz * fz) * 1.000001 - 1e-9);
    }
  }
  let distance = Infinity, halfWidth = 0, id = null, depth = -Infinity;
  for (const river of RIVER_SEGMENTS) {
    const data = river.data, width = river.halfWidth, b = river.boxes;
    for (let k = 0; k < b.length; k += 6) {
      // A box whose nearest edge is already too far cannot hold the answer, nor tie with it.
      const gx = Math.max(b[k] - x, 0, x - b[k + 2]), gz = Math.max(b[k + 1] - z, 0, z - b[k + 3]);
      if (width - Math.sqrt(gx * gx + gz * gz) * .999999 + 1e-9 < floor) continue;
      for (let i = b[k + 4]; i < b[k + 5]; i += 5) {
        const px = x - data[i], pz = z - data[i + 1], dx = data[i + 2], dz = data[i + 3];
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / data[i + 4]));
        const ex = px - dx * t, ez = pz - dz * t, reach = width - depth;
        // A segment wins only if it is nearer than `reach`. The squared test rejects the rest (with a margin far wider
        // than rounding); the exact comparison below is the one that decides.
        if (reach <= 0 || ex * ex + ez * ez > reach * reach * 1.000001) continue;
        const d = Math.hypot(ex, ez);
        // Wider rivers win where channels meet, so confluences stay open water.
        if (width - d > depth) { distance = d; halfWidth = width; id = river.id; depth = width - d; }
      }
    }
  }
  return { distance, halfWidth, river: id, depth };
}
export const inRiver = (x, z, margin = 0) => riverAt(x, z).depth > -margin;

export function realmAccess({ builtTier = 0, estateLevel = 0, gardens = 0, previewFeature = null } = {}) {
  return REALM_DISTRICTS.map((district) => {
    const open = district.homeTier !== null ? district.homeTier <= builtTier
      : ['palace', 'rapunzel'].includes(district.id) ? builtTier >= 3
        : district.id === 'wizard' ? builtTier >= 2
        : district.id === 'market' ? estateLevel >= 2
        : gardens > 0 || ['habit-garden', 'water'].includes(previewFeature);
    return { ...district, open, status: open ? 'open' : 'locked', condition: district.percent === null
      ? 'Record an on-time bill habit (reported by you, not provider verified)'
      : district.percent === 0 ? 'Your starting village' : `Reach ${district.percent}% of the shared goal` };
  });
}
export function bridgeAccess(state) {
  const regions = new Map(realmAccess(state).map((d) => [d.id, d.open]));
  return REALM_BRIDGES.map((bridge) => ({ ...bridge, open: regions.get(bridge.from) && regions.get(bridge.to) }));
}

// The same twenty financial steps now cross the world. The village, manor, keep and citadel still arrive at 0/5/12/20.
export const REALM_ROUTE = Object.freeze([
  [-64, 34], [-72, 27], [-67, 17], [-52, 17], [-45, 26], [-26, 26],
  [-24, 34], [-10, 36], [4, 34], [5, 23], [2, 12], [-10, 9], [-10, -11],
  [-23, -15], [-25, -30], [-13, -42], [5, -40], [7, -29], [6, -14], [10, -28], [47, -16.3],
].map((p) => Object.freeze({ x: p[0], z: p[1] })));
export function journeyLeg(index) {
  const n = Math.max(0, Math.min(19, index));
  if (n === 19) return [REALM_ROUTE[19], { x: 25, z: -28 }, { x: 29, z: -14 }, { x: 47, z: -14 }, REALM_ROUTE[20]];
  return [REALM_ROUTE[n], REALM_ROUTE[n + 1]];
}
export function journeyPosition(position) {
  const value = Math.max(0, Math.min(20, Number.isFinite(position) ? position : 0));
  if (value === 20) return { ...REALM_ROUTE[20] };
  const index = Math.floor(value), points = journeyLeg(index);
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
  let distance = (value - index) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (distance > lengths[i]) { distance -= lengths[i]; continue; }
    const t = distance / lengths[i];
    return { x: points[i].x + (points[i + 1].x - points[i].x) * t, z: points[i].z + (points[i + 1].z - points[i].z) * t };
  }
  return { ...points.at(-1) };
}
