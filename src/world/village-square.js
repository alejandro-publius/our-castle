import * as THREE from 'three';
import { addMemberModel } from './member-models.js';
import { createFamilyProject } from './family-project.js';
import { CREST_FIELDS } from '../core/rules.js';

// A shared place, drawn with the realm's original models and builder. This group is a view of
// server records: it owns no money, milestones, neighbors or made-up online visitors.
export const VILLAGE_FRAME = Object.freeze({ id: 'village-square', x: 32, z: 0, width: 78, depth: 72, height: 14 });
const POSITIONS = [[-25, -19], [0, -28], [25, -19], [-26, 18], [0, 28], [26, 18]];
const flagOf = crest => Number.parseInt((CREST_FIELDS[crest?.field]?.hex ?? '#355F93').slice(1), 16);

export function createVillageSquare({ part, models, tree, colours: C, reducedMotion }) {
  const school = createFamilyProject({ part, models, colours: C });
  let current = null, actors = new Map(), shown = [], seconds = null;
  function build(group, data) {
    school.reset(); actors = new Map(); seconds = null;
    const root = new THREE.Group(); root.name = 'village-square'; root.position.set(VILLAGE_FRAME.x, 0, VILLAGE_FRAME.z); group.add(root);
    part(root, 'box', 0, -1.0, 0, 82, 2, 78, C.soil);
    part(root, 'box', 0, .05, 0, 82, .4, 78, C.grass);
    part(root, 'round', 0, .3, 0, 32, .14, 32, C.path);
    part(root, 'round', 0, .38, 0, 29, .1, 29, C.dust);
    // Six places around the common green. The full family list remains available in the paper.
    const members = (data.members ?? []).slice(0, POSITIONS.length);
    members.forEach((m, i) => {
      const [x, z] = POSITIONS[i], home = new THREE.Group(); home.position.set(x, .2, z);
      home.rotation.y = x < 0 ? .35 : x > 0 ? -.35 : 0; home.scale.setScalar(1.2); root.add(home);
      const tier = Number.isInteger(m.tier) ? Math.max(0, Math.min(3, m.tier)) : 0;
      models.home(home, tier, flagOf(m.crest), 0);
      part(root, 'box', x / 2, .45, z / 2, Math.hypot(x, z), .07, 2.4, C.dust, -Math.atan2(z, x));
      models.lantern(root, x - 4, z + 6);
    });
    // Boundary trees and a well make this a small inhabited square, not an analytics diagram.
    const edgeTrees = [[-37,-31],[-37,-19],[-36,-5],[-38,8],[-37,32],[35,-33],[37,-19],[37,-3],[38,8],[37,32],[-19,-36],[-9,-36],[12,-36],[21,-35],[-16,35],[14,35]];
    edgeTrees.forEach(([x,z], i) => tree(root, x, z, 2.5 + i % 3 * .25, i % 3 === 0));
    for (const [x,z] of [[-14,-17],[15,15],[-14,16],[16,-16]]) {
      part(root, 'rock', x, .55, z, 1.2, .6, .9, C.stone);
      for (let i=0;i<3;i++) part(root, 'rock', x+1.3+i*.5, .6, z-.5, .5, .7, .5, i%2?C.leaf:C.pine);
    }
    models.well(root, 12, 9);
    const stage = Math.max(0, Math.min(3, Number(data.stage) || 0));
    const building = school.build(root, { kind: 'schoolhouse', index: stage, key: String(stage), detail: false }, C.blue);
    building.position.set(-3, .4, -2); building.scale.setScalar(1.4);
    const people = new THREE.Group(); people.name = 'village-presence'; people.userData.live = true; root.add(people);
    current = { group: root, people, fundId: data.fundId, stage, homes: members.map((m, i) => ({ familyReference: m.familyReference, tier: Number.isInteger(m.tier) ? Math.max(0, Math.min(3, m.tier)) : 0, x: POSITIONS[i][0], z: POSITIONS[i][1] })) };
    shown = [];
  }
  function presence(rows) {
    if (!current) return;
    const safe = (rows ?? []).filter(p => typeof p.id === 'string' && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= 16 && Math.abs(p.z) <= 16).slice(0, 30);
    const ids = new Set(safe.map(p => p.id));
    const remove = actor => { actor.group.traverse(o => { if (o.isInstancedMesh) o.dispose?.(); }); actor.group.removeFromParent(); };
    for (const [id, actor] of actors) if (!ids.has(id)) { remove(actor); actors.delete(id); }
    for (const row of safe) {
      let actor = actors.get(row.id);
      if (!actor || actor.avatarId !== row.avatarId) {
        if (actor) remove(actor);
        const group = new THREE.Group(); group.userData.live = true; group.position.set(row.x, .4, row.z); group.scale.setScalar(1.6); current.people.add(group);
        addMemberModel(part, group, { avatarId: row.avatarId ?? 'ranger' });
        actor = { group, avatarId: row.avatarId, x: row.x, z: row.z }; actors.set(row.id, actor);
      }
      actor.x = row.x; actor.z = row.z;
      if (reducedMotion) actor.group.position.set(row.x, .4, row.z);
    }
    shown = safe.map(({ id, familyReference, x, z }) => ({ id, familyReference, x, z }));
  }
  return {
    build, presence,
    tick(now) {
      const delta = seconds === null ? 0 : Math.max(0, Math.min(.25, now - seconds)); seconds = now;
      school.tick(now);
      for (const actor of actors.values()) {
        const dx = actor.x - actor.group.position.x, dz = actor.z - actor.group.position.z;
        if (Math.abs(dx) + Math.abs(dz) > .02) actor.group.rotation.y = Math.atan2(dx, dz);
        const mix = reducedMotion ? 1 : Math.min(1, delta * 7);
        actor.group.position.x += dx * mix; actor.group.position.z += dz * mix;
      }
    },
    reset() { current = null; actors = new Map(); shown = []; school.reset(); },
    debug: () => current ? { fundId: current.fundId, stage: current.stage, homes: current.homes, presence: shown } : null,
  };
}
