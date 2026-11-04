import * as THREE from 'three';
import { courtForTier, courtWorldPose, courtResidents } from '../core/court.js';

// All articulated guests share instanced geometry/material batches. Twenty guests do not mean twenty model graphs
// or a second animation loop: the board's existing low-rate ambient clock drives this entire court.
export function createEstateCourt(group, builder, colours) {
  const C = { ...colours, rose: 0xc96885, violet: 0x8774b2, teal: 0x3c9293, hair: 0x513c35, silver: 0xbac8cc };
  builder.geo.courtGown = new THREE.CylinderGeometry(.27, .53, .87, 8);
  const transform = new THREE.Object3D();
  const root = new THREE.Object3D();
  const joint = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const skins = [0xd9a67f, 0xa47153, 0xedc4a0, 0x8e5f48];
  const paints = [C.red, C.blue, C.rose, C.violet, C.teal];
  let actors = [], batches = [], tier = -1, flag = null, elapsed = 0;

  function pieces(person, crest) {
    const result = [];
    const royal = person.role === 'princess';
    const armoured = ['knight', 'guard'].includes(person.role);
    const cloth = royal ? [C.rose, C.violet, C.teal][Math.floor(person.index / 6) % 3] : paints[person.index % paints.length];
    const skin = skins[person.index % skins.length];
    const part = (kind, x, y, z, w, h, d, color, bone = 'body', rz = 0) => result.push({ kind, x, y, z, w, h, d, color, bone, rz });
    const box = (x, y, z, w, h, d, color, bone = 'body', rz = 0) => part('box', x, y, z, w, h, d, color, bone, rz);
    part('round', 0, .015, 0, .91, .025, .67, C.dark, 'ground');
    for (const [side, bone] of [[-1, 'leftLeg'], [1, 'rightLeg']]) {
      box(0, -.25, 0, .17, .48, .2, armoured ? C.silver : C.soil, bone);
      box(0, -.5, .075, .22, .13, .35, C.dark, bone);
    }
    if (royal) {
      part('courtGown', 0, .72, 0, 1, 1, 1, cloth);
      part('round', 0, .31, 0, 1.05, .08, 1.05, C.gold);
      box(0, .75, .43, .13, .75, .06, C.cream);
      box(0, 1.24, 0, .55, .43, .36, cloth);
      box(0, 1.08, .205, .6, .08, .05, C.gold);
      part('rock', 0, 1.35, .225, .16, .18, .05, C.gold);
    } else {
      box(0, 1.03, 0, .59, .73, .4, armoured ? C.silver : cloth);
      box(0, .8, .215, .62, .09, .065, C.soil);
      box(.1, .8, .26, .13, .12, .04, C.gold);
      if (armoured) {
        box(0, 1.17, .23, .36, .41, .07, crest);
        box(0, 1.18, .28, .08, .24, .04, C.gold);
        for (const side of [-1, 1]) part('rock', side * .37, 1.36, 0, .35, .29, .46, C.silver);
      }
    }
    // A separate head and shoulder joints keep the silhouette readable while arms and boots move.
    part('rock', 0, .13, 0, .53, .55, .51, skin, 'head');
    box(0, .36, -.035, .55, .21, .49, C.hair, 'head');
    for (const side of [-1, 1]) box(side * .13, .15, .245, .065, .065, .035, C.dark, 'head');
    box(0, .045, .255, .12, .025, .025, C.soil, 'head');
    box(0, .14, .28, .08, .085, .06, skin, 'head');
    if (royal) {
      for (const side of [-1, 1]) box(side * .235, .03, -.095, .16, .61, .37, C.hair, 'head');
      part('round', 0, .41, 0, .64, .1, .59, C.gold, 'head');
      for (const x of [-.23, 0, .23]) box(x, .54, .17, .1, .23, .12, C.gold, 'head');
      part('rock', 0, .46, .31, .12, .15, .07, C.red, 'head');
      box(0, 1.06, -.25, .66, .79, .08, C.cream);
    } else if (armoured) {
      part('round', 0, .31, -.02, .61, .43, .6, C.silver, 'head');
      box(0, .26, .29, .4, .075, .06, C.dark, 'head');
      part('rock', 0, .64, -.11, .19, .48, .3, crest, 'head');
      box(0, 1.01, -.26, .61, .82, .08, crest);
      // A resting shield: these are guests and ceremonial guards, not a battle system.
      part('rock', -.5, 1, .2, .51, .72, .15, crest);
      box(-.5, 1.05, .3, .08, .38, .04, C.gold);
    } else if (['gardener', 'villager'].includes(person.role)) {
      part('round', 0, .4, 0, .95, .07, .86, C.gold, 'head');
      part('cone', 0, .55, -.02, .66, .3, .6, C.wood, 'head');
    } else {
      part('round', 0, .41, 0, .67, .15, .61, cloth, 'head');
      box(.21, .6, -.02, .08, .38, .08, C.cream, 'head', -.3);
      box(0, 1.01, -.25, .62, .78, .07, crest);
    }
    for (const bone of ['leftArm', 'rightArm']) {
      box(0, -.22, 0, .19, .5, .23, armoured ? C.silver : cloth, bone);
      part('rock', 0, -.51, .02, .21, .21, .22, skin, bone);
      box(0, -.39, .01, .22, .07, .25, royal ? C.gold : C.cream, bone);
    }
    if (person.role === 'musician') {
      part('rock', .13, 1.02, .37, .45, .58, .2, C.wood);
      box(.32, 1.4, .37, .1, .63, .09, C.soil, 'body', -.4);
      box(.13, 1.02, .49, .07, .34, .025, C.cream);
    } else if (royal || person.role === 'gardener') {
      box(0, -.58, .07, .045, .35, .045, C.pine, 'rightArm');
      part('rock', 0, -.42, .07, .22, .2, .2, royal ? C.cream : C.rose, 'rightArm');
    } else if (['merchant', 'page', 'steward'].includes(person.role)) {
      box(.31, .83, .21, .27, .37, .19, C.wood);
      box(0, 1.2, .25, .09, .68, .04, C.soil, 'body', -.5);
    }
    return result;
  }

  function clear() {
    for (const { mesh } of batches) { group.remove(mesh); mesh.dispose(); }
    batches = [];
  }
  function setTier(nextTier, crest) {
    if (tier === nextTier && flag === crest) return;
    clear(); tier = nextTier; flag = crest;
    actors = courtResidents(tier).map((person) => ({ person, pose: courtWorldPose(person, elapsed) }));
    const buckets = new Map();
    actors.forEach((actor, index) => {
      for (const piece of pieces(actor.person, crest)) {
        const key = `${piece.kind}:${piece.color}`;
        if (!buckets.has(key)) buckets.set(key, { kind: piece.kind, color: piece.color, pieces: [] });
        buckets.get(key).pieces.push({ ...piece, actor: index });
      }
    });
    for (const bucket of buckets.values()) {
      const mesh = new THREE.InstancedMesh(builder.geo[bucket.kind], builder.material(bucket.color), bucket.pieces.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      group.add(mesh); batches.push({ mesh, pieces: bucket.pieces });
    }
    tick(elapsed);
  }
  function tick(seconds) {
    elapsed = seconds;
    for (const actor of actors) actor.pose = courtWorldPose(actor.person, seconds);
    for (const { mesh, pieces: parts } of batches) {
      parts.forEach((p, i) => {
        const actor = actors[p.actor], { person, pose } = actor;
        const gait = pose.moving ? Math.sin(seconds * 5.1 + person.index) : 0;
        const royal = person.role === 'princess';
        const scale = royal ? 1.1 : 1;
        root.position.set(pose.x, .24 + (p.bone === 'ground' ? 0 : Math.abs(gait) * .035), pose.z);
        root.rotation.set(0, pose.heading, 0); root.scale.setScalar(scale); root.updateMatrix();
        joint.position.set(0, 0, 0); joint.rotation.set(0, 0, 0); joint.scale.setScalar(1);
        if (p.bone === 'head') { joint.position.y = 1.64; joint.rotation.y = pose.moving ? 0 : Math.sin(seconds * .6 + person.index) * .18; }
        if (p.bone.endsWith('Leg')) {
          joint.position.set(p.bone === 'leftLeg' ? -.16 : .16, .62, 0);
          joint.rotation.x = gait * (p.bone === 'leftLeg' ? .38 : -.38);
        }
        if (p.bone.endsWith('Arm')) {
          const left = p.bone === 'leftArm';
          joint.position.set(left ? -.4 : .4, 1.35, 0);
          joint.rotation.x = gait * (left ? -.3 : .3);
          joint.rotation.z = left ? -.1 : .1;
          if (!pose.moving && !left) joint.rotation.x = -.42 + Math.sin(seconds * 2 + person.index) * .15;
          if (person.role === 'musician' && !left) joint.rotation.x = -.75 + Math.sin(seconds * 6) * .12;
        }
        joint.updateMatrix();
        transform.position.set(p.x, p.y, p.z); transform.scale.set(p.w, p.h, p.d); transform.rotation.set(0, 0, p.rz); transform.updateMatrix();
        matrix.multiplyMatrices(root.matrix, joint.matrix).multiply(transform.matrix);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    setTier, tick,
    debug: () => ({ ...courtForTier(tier), batches: batches.length, guests: actors.map(({ person, pose }) => ({ id: person.id, name: person.name, role: person.role, ...pose })) }),
    dispose: clear,
  };
}
