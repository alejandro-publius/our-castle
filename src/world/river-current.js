import * as THREE from 'three';
import { REALM_BOUNDS, RIVER_PATHS } from '../core/realm.js';

// Sparse surface glints follow the existing channels. One instance batch, advanced only by the
// scene's ambient clock; the banks, water bed and bridge geometry never move.
export function createRiverCurrent(waterLevel, colour) {
  const paths = RIVER_PATHS.map((river) => {
    const distances = [0];
    for (let i = 1; i < river.path.length; i++) {
      const a = river.path[i - 1], b = river.path[i];
      distances.push(distances.at(-1) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    return { ...river, distances, length: distances.at(-1), direction: river.id === 'west' ? -1 : 1 };
  });
  const ripples = [];
  for (const river of paths) {
    const count = Math.floor(river.length / 6);
    for (let i = 0; i < count; i++) {
      const seed = Math.sin((i + 1) * 127.1 + river.halfWidth * 311.7) * 43758.5453;
      const random = seed - Math.floor(seed);
      ripples.push({
        river, start: (i + .35) * river.length / count, across: (random - .5) * river.halfWidth,
        width: .16 + random * .06, length: .9 + random * .9, sample: i === Math.floor(count / 2),
        x: 0, z: 0, visible: false,
      });
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .55, depthWrite: false }),
    ripples.length,
  );
  mesh.name = 'river-current';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.ownedGeometry = true;
  mesh.userData.ownedMaterial = true;
  // The small batch spans the realm; avoid rebuilding its bounds every ambient tick.
  mesh.frustumCulled = false;
  const transform = new THREE.Object3D(), speed = .6;
  let elapsed = 0, previous = 0;

  function place() {
    for (let i = 0; i < ripples.length; i++) {
      const ripple = ripples[i], river = ripple.river;
      const distance = ((ripple.start + river.direction * elapsed * speed) % river.length + river.length) % river.length;
      let lo = 0, hi = river.distances.length - 1;
      while (hi - lo > 1) {
        const middle = (lo + hi) >> 1;
        if (river.distances[middle] <= distance) lo = middle; else hi = middle;
      }
      const a = river.path[lo], b = river.path[hi], dx = b[0] - a[0], dz = b[1] - a[1];
      const segment = river.distances[hi] - river.distances[lo], t = (distance - river.distances[lo]) / segment;
      const angle = Math.atan2(dx, dz);
      ripple.x = a[0] + dx * t + Math.cos(angle) * ripple.across;
      ripple.z = a[1] + dz * t - Math.sin(angle) * ripple.across;
      ripple.visible = ripple.x > REALM_BOUNDS.minX + .8 && ripple.x < REALM_BOUNDS.maxX - .8 && ripple.z > REALM_BOUNDS.minZ + .8 && ripple.z < REALM_BOUNDS.maxZ - .8;
      // Taper at the channel ends so wrapping glints never pop across the forest.
      const fade = ripple.visible ? Math.min(1, distance / 3, (river.length - distance) / 3) : 0;
      transform.position.set(ripple.x, waterLevel + .04, ripple.z);
      transform.rotation.set(0, angle, 0);
      transform.scale.set(ripple.width * fade, .025, ripple.length * fade);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  place();
  return {
    mesh,
    tick(seconds) {
      // Hidden/slow frames resume without a sudden jump downriver.
      elapsed += Math.min(.25, Math.max(0, seconds - previous));
      previous = seconds;
      place();
    },
    debug: () => ({
      ripples: ripples.length, visible: ripples.filter((r) => r.visible).length, seconds: elapsed, speed,
      samples: ripples.filter((r) => r.sample).map((r) => ({ river: r.river.id, x: r.x, z: r.z })),
    }),
  };
}
