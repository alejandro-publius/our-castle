import * as THREE from 'three';
import { createFarmLife } from './farm-life.js';
import { FARM_SITES, inFarmPlot } from './farm-locations.js';
import { createWoodlandLegends } from './woodland-legends.js';
import { createPrincessPalace } from './princess-palace.js';
import { createRiverCurrent } from './river-current.js';
import { REALM_SIZE, REALM_BOUNDS, REALM_DISTRICTS, REALM_LEGENDS, REALM_BRIDGES, RIVER_PATHS, journeyLeg, realmAccess, bridgeAccess, riverAt } from '../core/realm.js';

// One continuous woodland. The districts are meadow clearings in a single forest floor; narrow rivers are cut into that
// floor over a shallow water bed and pass under the middle of every bridge. Locked districts keep their colours: the
// named labels, raised bridge leaves and closed gates carry the lock.
export const REALM_LEVELS = Object.freeze({ ground: .25, water: -.8, bed: -1.5, base: -2.4 });
const L = REALM_LEVELS;
const F = {
  floor: 0x476b49, moss: 0x3d5f42, fern: 0x6f9a5a, bank: 0x7a5a3c, bed: 0x4b3a2c, side: 0x56372a,
  deep: 0x2f533b, oak: 0x5f8f4e, birch: 0xe8dcc0, mushroom: 0xb44d46, pink: 0xd9b0b9, violet: 0x81739c, reed: 0x8a7a4a,
  ripple: 0x9abfc1, water: 0x2f6f9f, iron: 0x374d56, course: 0x88978d, pale: 0xf4e4be, leaf2: 0xa3b97c,
};
// Small deterministic noise, so the forest is the same on every load and in every test.
const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
// How far a point lies inside a district's octagonal clearing (negative outside), in world units.
function clearingDepth(x, z, d) {
  const ax = Math.abs(x - d.x), az = Math.abs(z - d.z);
  const corner = (.89 - ax / d.width - az / d.depth) * Math.min(d.width, d.depth) * .7;
  return Math.min(d.width / 2 - ax, d.depth / 2 - az, corner);
}
const deepestClearing = (x, z) => [...REALM_DISTRICTS, ...REALM_LEGENDS].reduce((best, d) => Math.max(best, clearingDepth(x, z, d)), -Infinity);
const nearBridge = (x, z, margin) => REALM_BRIDGES.some(({ a, b }) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(-.15, Math.min(1.15, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < margin;
});

export function createRealmModels({ builder, part: addPart, models, colours: C }) {
  let part = addPart;
  const farm = createFarmLife({ part: addPart, models, colours: C });
  const farmWorldPlots = FARM_SITES.map(s => { const d=REALM_DISTRICTS.find(d=>d.id===s.district);return [d.x+s.bounds[0],d.x+s.bounds[1],d.z+s.bounds[2],d.z+s.bounds[3]]; });
  const palace = createPrincessPalace({ part: addPart, models, colours: C });
  const legends = createWoodlandLegends({ part: addPart, models, colours: C });
  builder.geo.trunk = new THREE.CylinderGeometry(.5, .5, 1, 5);
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const round=(g,x,y,z,w,h,d,c)=>part(g,'round',x,y,z,w,h,d,c);
  const cone=(g,x,y,z,w,h,d,c)=>part(g,'cone',x,y,z,w,h,d,c);

  // Collapse static sub-models into shared instance batches while preserving articulated animals and windmills.
  function finish(group) {
    group.updateWorldMatrix(true,true);
    const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert(), matrix = new THREE.Matrix4(), local = new THREE.Matrix4();
    const buckets=new Map(),remove=[];
    group.traverse((mesh)=>{
      if(!mesh.isInstancedMesh)return;
      for(let ancestor=mesh;ancestor&&ancestor!==group;ancestor=ancestor.parent)if(ancestor.userData.live)return;
      const key=mesh.geometry.uuid+':'+mesh.material.uuid;
      if(!buckets.has(key))buckets.set(key,{geo:mesh.geometry,material:mesh.material,matrices:[]});
      const bucket=buckets.get(key);local.multiplyMatrices(inverse,mesh.matrixWorld);
      for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);bucket.matrices.push(new THREE.Matrix4().multiplyMatrices(local,matrix));}
      remove.push(mesh);
    });
    for(const mesh of remove){mesh.removeFromParent();mesh.dispose();}
    for(const bucket of buckets.values()){
      const mesh=new THREE.InstancedMesh(bucket.geo,bucket.material,bucket.matrices.length);
      bucket.matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.computeBoundingSphere();group.add(mesh);
    }
  }
  function nearJourney(x,z,radius=2.1){
    for(let n=0;n<20;n++){
      const path=journeyLeg(n);
      for(let j=1;j<path.length;j++){
        const a=path[j-1],b=path[j],dx=b.x-a.x,dz=b.z-a.z;
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
        if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<radius)return true;
      }
    }
    return REALM_BRIDGES.some(b=>Math.abs(x-b.a[0])<2.6&&Math.abs(z-b.a[1])<4||Math.abs(x-b.b[0])<2.6&&Math.abs(z-b.b[1])<4);
  }

  // ---------- The ground: one heightfield with river channels, meadow clearings and soil sides at the board edge ----------
  let groundData = null;
  const surfaceMeshes = { ground: null, water: null };
  function ground(group) {
    groundData ??= groundArrays();
    const { positions, colours, index } = groundData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setIndex(index); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    mesh.userData.ownedGeometry = true; mesh.userData.ownedMaterial = true; mesh.userData.ground = true; group.add(mesh);
    surfaceMeshes.ground = mesh;
    // A shallow water bed under the whole board shows only where the ground is cut below it. Unlit, so the bright sun
    // does not wash it out; its sides show at the river mouths on the board edge.
    const water = new THREE.Mesh(new THREE.BoxGeometry(REALM_SIZE.width - .3, L.water - L.base - .1, REALM_SIZE.depth - .3), new THREE.MeshBasicMaterial({ color: F.water }));
    water.position.set(REALM_SIZE.centerX, (L.water + L.base + .1) / 2, REALM_SIZE.centerZ);
    water.userData.ownedGeometry = true; water.userData.ownedMaterial = true; water.userData.water = true; group.add(water);
    surfaceMeshes.water = water;
    return { vertices: positions.length / 3, triangles: index.length / 3 };
  }
  function groundArrays() {
    const W = REALM_SIZE.width, D = REALM_SIZE.depth, cols = W + 1, rows = D + 1;
    const positions = [], colours = [], index = [], colour = new THREE.Color(), mix = new THREE.Color();
    const paint = (hex, other, t = 0) => { colour.setHex(hex); if (other !== undefined) colour.lerp(mix.setHex(other), t); colours.push(colour.r, colour.g, colour.b); };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = REALM_BOUNDS.minX + i, z = REALM_BOUNDS.minZ + j, river = riverAt(x, z), clearing = deepestClearing(x, z);
      // Banks run from 1.1 outside the water line down to the bed just inside it.
      const cut = smooth((river.depth + 1.1) / 1.4), bump = clearing > 0 ? 0 : (noise(x / 5, z / 5) - .5) * .12 * (1 - cut);
      positions.push(x, lerp(L.ground + bump, L.bed, cut), z);
      if (cut > .05) paint(F.bank, F.bed, smooth((cut - .3) / .7));
      else if (clearing > -1.5) paint(F.floor, C.grass, smooth((clearing + 1.5) / 3.5));
      else paint(F.floor, F.moss, noise(x / 9 + 40, z / 9) > .55 ? .8 : 0);
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + cols, c = a + 1, d = b + 1;
      index.push(a, b, c, c, b, d);
    }
    // Soil sides around the board edge follow the ground, so river mouths show water above their bed.
    const edge = [];
    for (let i = 0; i < cols; i++) edge.push(i);
    for (let j = 1; j < rows; j++) edge.push(j * cols + cols - 1);
    for (let i = cols - 2; i >= 0; i--) edge.push((rows - 1) * cols + i);
    for (let j = rows - 2; j >= 0; j--) edge.push(j * cols);
    for (let k = 1; k < edge.length; k++) {
      const top = [edge[k - 1], edge[k]], base = positions.length / 3;
      for (const v of top) { positions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); paint(C.soil); }
      for (const v of top) { positions.push(positions[v * 3], L.base, positions[v * 3 + 2]); paint(k % 9 === 0 ? C.stone : F.side); }
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    return { positions: new Float32Array(positions), colours: new Float32Array(colours), index };
  }

  // ---------- Rivers: ripples along the current, reeds and stones on the banks ----------
  function riverDetails(group) {
    let reeds = 0, stones = 0;
    for (const river of RIVER_PATHS) {
      const path = river.path;
      for (let i = 2; i < path.length - 1; i += 2) {
        const [x0, z0] = path[i - 1], [x1, z1] = path[i + 1], [x, z] = path[i], angle = Math.atan2(x1 - x0, z1 - z0);
        if (x < REALM_BOUNDS.minX + .5 || x > REALM_BOUNDS.maxX - .5 || z < REALM_BOUNDS.minZ + .5 || z > REALM_BOUNDS.maxZ - .5 || nearBridge(x, z, 3)) continue;
        for (const side of [-1, 1]) {
          if (hash(i * side, 7) > .55) continue;
          const reach = river.halfWidth + .15 + hash(i, side) * .5, bx = x + Math.cos(angle) * reach * side, bz = z - Math.sin(angle) * reach * side;
          if (deepestClearing(bx, bz) > -1 || nearBridge(bx, bz, 3)) continue;
          if (hash(i, side + 11) > .45) {
            for (let k = 0; k < 3; k++) { round(group, bx + (k - 1) * .3, L.water + .6, bz + (k % 2) * .25, .16, 1.2 + k * .15, .16, F.fern); round(group, bx + (k - 1) * .3, L.water + 1.25 + k * .08, bz + (k % 2) * .25, .22, .34, .22, F.reed); }
            reeds++;
          } else { rock(group, bx, L.water + .1, bz, .7 + hash(i, 5) * .4, .5, .6, hash(i, 9) > .5 ? C.stone : F.course); stones++; }
        }
      }
    }
    return { reeds, stones };
  }

  // ---------- The forest between the clearings: groves and glades, not a fence ----------
  function forestTree(g, x, z, size, kind, seed) {
    // A low understory mound under every crown hides the trunk: layered woodland, and smaller depth steps for the outline
    // pass at a distance.
    rock(g, x + .2 * size, L.ground + .75 * size, z + .15 * size, 3.3 * size, 1.6 * size, 3.2 * size, kind === 'pine' ? C.grass : F.oak);
    if (kind === 'pine') {
      const shade = [C.pine, C.grass, C.pine][seed % 3];
      for (let k = 0; k < 3; k++) cone(g, x, (1.2 + k * .52) * size, z, (2.4 - k * .55) * size, (1.4 - k * .18) * size, (2.4 - k * .55) * size, k === 1 ? C.grass : shade);
    } else if (kind === 'birch') {
      part(g, 'trunk', x, .9 * size, z, .22 * size, 1.8 * size, .22 * size, F.birch);
      box(g, x, .7 * size, z + .11 * size, .14 * size, .08 * size, .02, C.dark);
      rock(g, x, 2.1 * size, z, 1.35 * size, 1.4 * size, 1.35 * size, C.leaf);
      rock(g, x + .3 * size, 2.55 * size, z - .2 * size, .9 * size, .9 * size, .9 * size, F.leaf2);
    } else {
      const greens = [C.grass, F.oak, C.leaf, F.oak, F.fern];
      for (let k = 0; k < 3; k++) {
        const a = seed * 1.7 + k * 2.1, r = k === 2 ? .1 * size : .48 * size;
        rock(g, x + Math.sin(a) * r, (1.6 + (k === 2 ? .5 : k * .12)) * size, z + Math.cos(a) * r, (k === 2 ? 1.6 : 1.45) * size, 1.35 * size, (k === 2 ? 1.6 : 1.45) * size, greens[(seed + k) % 5]);
      }
    }
  }
  function forest(group) {
    const counts = { trees: 0, pines: 0, broadleaf: 0, birches: 0, shrubs: 0, ferns: 0, details: 0 };
    const step = 3.2;
    // Keep the original grid anchors, extending only the outer bounds: older groves do not shift.
    for (let iz = Math.ceil((REALM_BOUNDS.minZ + 1 + 56) / step); -56 + iz * step <= REALM_BOUNDS.maxZ - 1; iz++)
      for (let ix = Math.ceil((REALM_BOUNDS.minX + 1 + 81) / step); -81 + ix * step <= REALM_BOUNDS.maxX - 1; ix++) {
      const gx = -81 + ix * step, gz = -56 + iz * step;
      const i = Math.round(gx * 10), j = Math.round(gz * 10);
      const x = gx + (hash(i, j) - .5) * step * .9, z = gz + (hash(j, i) - .5) * step * .9;
      if (x < REALM_BOUNDS.minX + .8 || x > REALM_BOUNDS.maxX - .8 || z < REALM_BOUNDS.minZ + .8 || z > REALM_BOUNDS.maxZ - .8) continue;
      const river = riverAt(x, z), clearing = deepestClearing(x, z), density = noise(x / 13, z / 13), species = noise(x / 19 + 20, z / 19 - 7);
      if (river.depth > -1.5 || nearBridge(x, z, 3.6) || nearJourney(x, z, 2.7) || farmWorldPlots.some(([a,b,c,d])=>x>a-1.4&&x<b+1.4&&z>c-1.4&&z<d+1.4)) continue;
      // Trees may step up to about 2.5 units into a clearing edge, so no district has a straight tree line.
      if (clearing > 1.1 + 1.4 * noise(x / 4, z / 4)) continue;
      const roll = hash(i + 3, j - 5), seed = Math.floor(hash(i - 9, j + 2) * 1000);
      if (roll < .3 + .62 * density) {
        const kind = species < .38 ? 'pine' : species > .64 && seed % 7 === 0 ? 'birch' : species < .5 && seed % 2 ? 'pine' : 'oak';
        forestTree(group, x, z, 1.15 + hash(i, j + 1) * .6 + density * .25, kind, seed);
        counts.trees++; counts[kind === 'pine' ? 'pines' : kind === 'birch' ? 'birches' : 'broadleaf']++;
      } else if (roll < .78) {
        // Understory in the glades: shrubs and ferns, with a few flowers.
        const s = .7 + hash(i, 4) * .5;
        rock(group, x, L.ground + .35 * s, z, 1.2 * s, .8 * s, 1.1 * s, seed % 3 ? C.leaf : F.oak);
        rock(group, x + .5 * s, L.ground + .3 * s, z + .35 * s, .8 * s, .6 * s, .8 * s, C.grass);
        counts.shrubs++;
        if (seed % 4 === 0) { rock(group, x + .2, L.ground + .75 * s, z - .3, .22, .22, .22, [C.gold, F.pink, F.violet, C.red][(seed >> 2) % 4]); counts.details++; }
      } else {
        for (let k = 0; k < 3; k++) { const a = seed + k * 2.1; part(group, 'cone', x + Math.sin(a) * .35, L.ground + .18, z + Math.cos(a) * .35, .9, .35, .5, F.fern, a, .5); }
        counts.ferns++;
      }
      // Small natural details on the forest floor.
      const extra = hash(i + 17, j + 23);
      if (extra < .07) { round(group, x + 1.1, L.ground + .12, z + .6, .12, .24, .12, F.birch); cone(group, x + 1.1, L.ground + .32, z + .6, .42, .18, .42, F.mushroom); counts.details++; }
      else if (extra < .12) { rock(group, x - 1, L.ground + .15, z + .7, .9, .55, .7, C.stone); counts.details++; }
      else if (extra < .145) { part(group, 'trunk', x + .8, L.ground + .18, z - .9, .38, 2.2, .38, C.soil, seed, Math.PI / 2); counts.details++; }
    }
    return counts;
  }

  // ---------- Districts: meadow clearings with their own copses and flowers ----------
  function terrain(group,d,helpers){
    // Each clearing has its own copses rather than a single square tree border.
    for(let i=0;i<24;i++){
      const x=Math.sin(i*2.37)*(d.width/2-3),z=Math.cos(i*3.73)*(d.depth/2-3);
      if(inFarmPlot(d.id,x,z,1.2)||d.id==='palace'&&Math.abs(x)<19&&z>-12&&z<22||Math.abs(x)<12*d.scale&&Math.abs(z)<11*d.scale||nearJourney(d.x+x,d.z+z))continue;
      helpers.tree(group,x,z,1.1+(i%5)*.16,i%3!==0);
    }
    for(let i=0;i<26;i++){
      const x=Math.sin(i*3.9)*(d.width*.41),z=Math.cos(i*2.7)*(d.depth*.4);
      if(inFarmPlot(d.id,x,z,.5)||d.id==='palace'&&Math.abs(x)<19&&z>-12&&z<22||Math.abs(x)<7&&Math.abs(z)<6||nearJourney(d.x+x,d.z+z))continue;
      rock(group,x,.34,z,.5,.32,.4,C.leaf);rock(group,x,.57,z,.2,.23,.2,[C.gold,C.red,F.pink,F.violet][i%4]);
    }
  }
  function home(group,d,state,flag){
    const g=new THREE.Group();g.scale.setScalar(d.scale);group.add(g);
    models.home(g,d.homeTier,flag,d.homeTier===0?Math.min(1,state.estateLevel):0);
    return g;
  }
  // Rows of flowering planters: low cream boxes with leaves and blossoms.
  function planters(group,x,z,count,gap=1.6){
    for(let i=0;i<count;i++){
      const px=x+(i-(count-1)/2)*gap;
      box(group,px,.42,z,1.2,.38,.7,C.cream);box(group,px,.62,z,1.05,.06,.55,C.soil);
      for(let k=0;k<3;k++){rock(group,px-.35+k*.35,.82,z,.36,.32,.36,C.leaf);rock(group,px-.35+k*.35,1.0,z+.05,.18,.18,.18,[C.red,C.gold,F.pink][(i+k)%3]);}
    }
  }
  // One ceremonial lawn artwork, kept clear of the Citadel gate and the two horizontal guest lanes.
  function stagMonument(group, x, z, flag) {
    const g = new THREE.Group(); g.name = 'citadel-stag-monument'; g.position.set(x, 0, z); group.add(g);
    const stone = F.pale, shade = C.stone, cut = F.course;
    // Stepped limestone footing, recessed die, carved corner ribs and a narrow gilt cornice.
    box(g,0,.33,0,3.4,.16,3.0,shade); box(g,0,.52,0,3.0,.22,2.6,stone);
    box(g,0,.74,0,2.52,.2,2.2,stone); box(g,0,.88,0,2.2,.1,1.94,cut);
    box(g,0,1.56,0,1.84,1.28,1.6,stone); box(g,0,.98,0,1.96,.08,1.72,C.cream);
    box(g,0,2.22,0,2.16,.14,1.92,shade); box(g,0,2.34,0,2.44,.12,2.14,stone);
    box(g,0,2.42,0,2.46,.04,2.16,C.gold); box(g,0,2.49,0,2.24,.1,2.0,stone);
    for (const sx of [-1,1]) for (const sz of [-1,1]) {
      box(g,sx*.85,1.58,sz*.73,.14,1.16,.14,C.cream);
      rock(g,sx*.85,2.08,sz*.73,.19,.19,.19,C.gold);
    }
    for (const side of [-1,1]) for (let i=-2;i<=2;i++)
      box(g,side*.93,1.56,i*.23,.035,.88,.055,cut);
    for (const y of [1.08,2.02]) box(g,0,y,.81,1.44,.045,.04,shade);
    models.shield(g,0,1.67,.83,flag,.84);
    // Shallow laurel cuts frame the crest without adding another lawn ornament.
    for(const side of [-1,1]) {
      part(g,'box',side*.65,1.53,.818,.045,.59,.035,cut,0,-side*.24);
      for(let i=0;i<3;i++)
        part(g,'rock',side*(.59+i*.055),1.34+i*.17,.846,.22,.12,.06,shade,0,-side*.5);
    }
    // The plinth stays square to the lanes; the sculpted animal turns into a three-quarter profile.
    const stag = new THREE.Group(); stag.rotation.y = -.20; g.add(stag);
    const rod = (a,b,width,colour=stone) => {
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
      part(stag,'round',(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,width,length,width,colour,
        Math.atan2(dz,-dx),Math.acos(Math.max(-1,Math.min(1,dy/length))));
    };
    rock(stag,0,4.22,-.12,1.03,1.04,2.08,stone);
    rock(stag,0,4.3,.62,.95,1.12,1.0,C.cream);
    rock(stag,0,4.18,-.82,.94,.88,.83,stone);
    box(stag,0,4.66,-.13,.16,.09,1.34,C.cream);
    rod([0,4.48,.57],[0,5.19,1.0],.64);
    rod([0,4.4,.89],[0,5.12,1.17],.35,C.cream);
    for(let i=0;i<4;i++) rock(stag,0,4.47+i*.18,1.0+i*.07,.45,.25,.3,i%2?C.cream:stone);
    // A lifted forehoof and bent hocks read as carved anatomy rather than a miniature live deer.
    const legs = [
      [[-.39,4.13,-.68],[-.43,3.59,-.95],[-.4,3.1,-.6],[-.4,2.67,-.82]],
      [[ .39,4.13,-.68],[ .43,3.59,-.95],[ .4,3.1,-.6],[ .4,2.67,-.82]],
      [[ .38,4.17,.59],[ .38,3.62,.59],[ .39,2.67,.79]],
      [[-.38,4.17,.67],[-.42,3.67,.76],[-.42,3.36,1.18]],
    ];
    for(const points of legs) {
      for(let i=1;i<points.length;i++) {
        rod(points[i-1],points[i],i===1?.23:.14);
        rock(stag,...points[i],.23,.23,.25,C.cream);
      }
      const [hx,hy,hz]=points.at(-1);
      box(stag,hx,hy-.035,hz+.04,.26,.18,.36,shade);
      box(stag,hx,hy-.025,hz+.075,.05,.18,.36,cut);
    }
    rock(stag,0,5.42,1.07,.65,.76,.73,stone);
    rock(stag,0,5.2,1.49,.45,.32,.58,C.cream);
    box(stag,0,5.09,1.68,.29,.035,.045,cut);
    for(const side of [-1,1]) {
      box(stag,side*.29,5.48,1.25,.08,.08,.13,C.dark);
      rock(stag,side*.27,5.57,1.23,.18,.09,.19,stone);
      box(stag,side*.13,5.19,1.76,.045,.05,.035,cut);
      part(stag,'rock',side*.39,5.73,.82,.25,.63,.3,stone,0,-side*.58);
      part(stag,'rock',side*.43,5.74,.94,.12,.36,.1,shade,0,-side*.58);
      // Three main antler segments plus brow and crown tines, in restrained old gold.
      const a=[side*.2,5.7,.84],b=[side*.50,6.08,.5],c=[side*.99,6.51,.2],d=[side*1.22,6.89,.12];
      rod(a,b,.22,C.gold);rod(b,c,.18,C.gold);rod(c,d,.14,C.gold);
      rod(b,[side*.27,6.42,.91],.14,C.gold);
      rod([side*.74,6.29,.35],[side*.66,6.72,.74],.13,C.gold);
      rod(c,[side*1.48,6.78,.48],.13,C.gold);
      for(const [yy,zz] of [[4.32,.1],[4.39,.3],[4.43,.5]])
        box(stag,side*.46,yy,zz,.035,.17,.06,shade);
    }
    rod([0,4.95,1.0],[0,5.04,1.06],.75,C.gold);
    rock(stag,0,4.95,1.36,.15,.2,.08,flag);
    rod([0,4.36,-1.02],[0,4.48,-1.37],.16,C.cream);
    rock(stag,0,4.48,-1.35,.2,.29,.28,C.cream);
  }

  function decor(group,d,state,flag,helpers){
    farm.build(group,d.id,flag);
    if(d.id==='cottage'){
      for(const[x,z]of[[-10,11],[8,11]])models.cottage(group,x,z,{w:2.7,h:1.8,d:2.2,roofColor:z>0?C.red:C.blue,shutters:C.blue});
      helpers.deer(group,-10,-6,.4);helpers.deer(group,-9,-3,-.4,.7);helpers.deer(group,9,2,2.2);helpers.deer(group,8,-8,1.5);
      helpers.butterflies(group);
      models.well(group,7,-6);
    }
    if(d.id==='manor'){
      // Timber and cobalt: a gabled outbuilding, gold-edged flower parterres, a fountain and the household banner.
      models.cottage(group,12,-7,{w:4,h:3,d:4,roofColor:C.blue,shutters:C.red});
      for(const x of[-13,-8,8])for(const z of[-11,12]){
        box(group,x,.4,z,3.2,.25,1.4,C.cream);box(group,x,.55,z,3.3,.05,1.5,C.gold);
        for(let i=0;i<5;i++){rock(group,x-1.1+i*.55,.8,z,.5,.55,.5,C.leaf);rock(group,x-1.1+i*.55,1.05,z,.2,.2,.2,[C.red,C.gold,F.pink][i%3]);}
      }
      models.banner(group,12,2,-4.9,flag,1,1.5);
      models.fountain(group,-13,1);
    }
    if(d.id==='keep'){
      // Cool stone with crimson caps and long banners.
      for(const x of[-15,15])models.tower(group,x,-9,6.5,flag,true,{roof:C.red,banner:true});
      models.cottage(group,-14,3,{w:3,h:2.5,d:4,roofColor:C.red,timber:false,color:C.stone,shutters:C.blue});
      planters(group,-14,6.3,2,1.4);
      if(state.estateLevel>=3){const ramparts=new THREE.Group();ramparts.scale.setScalar(d.scale);group.add(ramparts);models.extras(ramparts,3,flag,null,{market:false});}
    }
    if(d.id==='castle'){
      // A separate, substantially larger palace district: warm cream halls, crimson and cobalt spires and its own curtain wall.
      for(const [x,roof] of[[-15,C.red],[15,C.blue]]){
        models.cottage(group,x,-7,{w:4.5,h:5.2,d:6,roofColor:roof,color:F.pale,timber:false,shutters:roof===C.red?C.blue:C.red,quoins:true});
        models.tower(group,x,-12,10,flag,true,{body:F.pale,roof:roof===C.red?C.blue:C.red,banner:true});
      }
      const walls=new THREE.Group();walls.scale.setScalar(d.scale);group.add(walls);models.extras(walls,3,flag,null,{market:false,shields:true});
      for(const x of[-17,17])for(const z of[3,9,15]){
        round(group,x,.4,z,3,.3,3,C.cream);round(group,x,.58,z,3.1,.06,3.1,C.gold);round(group,x,.7,z,2.5,.35,2.5,C.pine);rock(group,x,1.15,z,1.3,1,1.3,C.leaf);
        for(let k=0;k<6;k++){const a=k*Math.PI/3;rock(group,x+Math.cos(a)*.95,1.0,z+Math.sin(a)*.95,.3,.3,.3,[C.red,C.gold,F.pink][k%3]);}
      }
      stagMonument(group,8.5,15.4,flag);
      models.bunting(group,-17,18,17,18,[C.red,C.gold,C.blue]);
    }
    if(d.id==='palace') palace(group,flag);
    if(d.id==='wizard') legends.wizard(group,flag);
    if(d.id==='rapunzel') legends.rapunzel(group,flag);
    if(d.id==='market'){
      models.extras(group,2,flag,null,{ramparts:false});
      models.cottage(group,-6,-1,{w:6,h:4,d:5,roofColor:C.red,shutters:C.blue});models.banner(group,-6,3,1.6,flag,1,1.3);
      for(const[x,z]of[[-9,-9],[3,-9],[-7,9]])models.cottage(group,x,z,{w:3,h:2.2,d:2.7,roofColor:C.blue,shutters:C.red});
      models.well(group,-3,6);
      round(group,9,3,-8,1.8,5.5,1.8,C.cream);part(group,'cone',9,6.3,-8,2.4,1.5,2.4,C.blue);rock(group,9,7.15,-8,.3,.3,.3,C.gold);
      const sails=new THREE.Group();sails.userData.live=true;sails.position.set(9,4.7,-6.9);group.add(sails);
      for(let i=0;i<4;i++){const a=i*Math.PI/2;box(sails,Math.sin(a)*1.7,Math.cos(a)*1.7,0,.6,3.2,.15,C.cream,0,-a);}
      helpers.rotators.push({group:sails,axis:'z',speed:.1});
      models.bunting(group,-11,4.5,4,4.5,[C.red,C.gold,C.blue]);
    }
    if(d.id==='garden'){
      models.cottage(group,7,-8,{w:4,h:2.6,d:3.4,roofColor:C.blue,shutters:C.red});
      round(group,-4,.28,1,10,.15,8,C.water);
      for(let i=0;i<16;i++){const a=i*Math.PI/8;rock(group,-4+Math.cos(a)*5,.43,1+Math.sin(a)*4,.8,.5,.8,C.stone);}
      models.well(group,8,4);
      for(let i=0;i<4;i++)models.vegetables(group,7,-1+i*2,4,1.6);
      for(let i=0;i<8;i++)helpers.tree(group,-11+(i%4)*3.4,-12+Math.floor(i/4)*3.5,1.8,i%2===0);
      if(state.previewFeature==='water')models.extras(group,0,flag,'water');
    }
    if(state.previewFeature==='electricity'&&d.open)for(const[x,z]of[[-10,7],[10,7],[-10,-7],[10,-7]])models.lantern(group,x,z,.2,true);
  }

  // ---------- Bridges: stone approaches on the banks, wooden leaves over the river, a gate on locked crossings ----------
  function bridge(group,definition,open){
    const g=new THREE.Group(),[ax,az]=definition.a,[bx,bz]=definition.b;
    const length=Math.hypot(bx-ax,bz-az),angle=-Math.atan2(bz-az,bx-ax);g.position.set(ax,0,az);g.rotation.y=angle;group.add(g);
    const mid=length/2,river=riverAt((ax+bx)/2,(az+bz)/2),span=river.halfWidth+1.3,deck=.32;
    // Stone approaches on each bank, from the district edge to the bank pier.
    for(const[s,e]of[[0,mid-span],[mid+span,length]]){
      box(g,(s+e)/2,deck-.05,0,e-s,.3,4.2,C.stone);box(g,(s+e)/2,deck+.11,0,e-s,.04,3.4,C.road);
      for(const z of[-1.95,1.95]){box(g,(s+e)/2,deck+.42,z,e-s,.5,.3,C.cream);box(g,(s+e)/2,deck+.7,z,e-s+.1,.08,.38,C.gold);}
    }
    // Bank piers stand on the river bed, clear of the channel; gold-collared posts with crimson caps mark the crossing.
    for(const x of[mid-span,mid+span]){
      box(g,x,(L.bed+deck)/2,0,1.2,deck-L.bed+.1,4.8,C.stone);box(g,x,L.water+.25,0,1.3,.12,4.9,F.course);
      for(const z of[-2.1,2.1]){box(g,x,1.25,z,.6,2.6,.6,C.cream);box(g,x,2.6,z,.72,.14,.72,C.gold);part(g,'cone',x,3.05,z,.8,.75,.8,C.red);}
    }
    // Gate posts carry small lamps: lit glass at night, pale by day.
    for(const x of[0,length])for(const z of[-2.1,2.1]){box(g,x,.9,z,.5,1.6,.5,C.stone);box(g,x,1.86,z,.36,.32,.36,models.roles.lamp);part(g,'cone',x,2.2,z,.7,.5,.7,C.gold);}
    const panels=[];
    for(const sign of[1,-1]){
      // Each leaf hinges on its bank and the two meet over the middle of the river.
      const panel=new THREE.Group();panel.userData.live=true;panel.position.x=sign===1?mid-span:mid+span;panel.rotation.z=open?0:sign*1.03;g.add(panel);panels.push({group:panel,sign});
      for(let i=0;i<6;i++)box(panel,sign*(i+.5)*span/6,deck,0,span/6-.04,.28,3.8,C.wood);
      for(const z of[-1.85,1.85]){box(panel,sign*span/2,deck+.53,z,span,.14,.12,C.cream);for(let i=0;i<4;i++)box(panel,sign*(i+.5)*span/4,deck+.3,z,.12,.6,.12,C.soil);}
      box(panel,sign*(span-.15),deck+.02,0,.12,.3,3.9,F.iron);
    }
    if(!open){
      // The closed gate stands on the far bank, behind the raised leaf.
      const gx=mid+span+.95;
      box(g,gx,1.25,0,.3,2.4,4.1,C.dark);
      for(const z of[-1.3,0,1.3])box(g,gx+.15,1.3,z,.08,2.4,.08,C.stone);
      box(g,gx+.2,1.25,0,.25,1.15,.95,C.stone);part(g,'arch',gx+.23,2.1,0,.85,.9,.12,C.gold,Math.PI/2);
    }
    builder.flush();finish(g);return {...definition,open,panels,gate:!open,river:river.river};
  }

  // Paint statistics for the test hooks: how many meshes in a district carry real colour, and how many hue families.
  function paintOf(group){
    let meshes=0,grey=0;const hues=new Set(),hsl={};
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;meshes++;
      mesh.material.color.getHSL(hsl);
      if(hsl.s<.08){grey++;return;}
      hues.add(Math.round(hsl.h*12)%12);
    });
    return {meshes,greyPaint:meshes>0&&grey===meshes,hues:hues.size};
  }
  // The ground, rivers and forest do not depend on progress. They are built once into their own group and kept, so a
  // milestone or preview rebuilds only the districts and bridges, as before.
  let landscape = null, current = null;
  function woodland(group) {
    const started = performance.now(), land = ground(group), woods = new THREE.Group(); group.add(woods);
    // The forest covers most of the screen, so it is batched with flat Lambert paint, which is far cheaper to shade than
    // the standard material on software renderers. One instanced mesh per shape and colour.
    const buckets = new Map(), materials = new Map(), transform = new THREE.Object3D();
    part = (g, kind, x, y, z, w, h, d, colour, ry = 0, rz = 0) => {
      const key = `${kind}:${colour}`;
      if (!buckets.has(key)) buckets.set(key, { kind, colour, parts: [] });
      buckets.get(key).parts.push([x, y, z, w, h, d, ry, rz]);
    };
    let counts, rivers;
    try { counts = forest(woods); rivers = riverDetails(woods); } finally { part = addPart; }
    for (const { kind, colour, parts } of buckets.values()) {
      if (!materials.has(colour)) materials.set(colour, new THREE.MeshLambertMaterial({ color: colour, flatShading: true }));
      const mesh = new THREE.InstancedMesh(builder.geo[kind], materials.get(colour), parts.length);
      parts.forEach(([x, y, z, w, h, d, ry, rz], i) => { transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.rotation.set(0, ry, rz); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix); });
      mesh.computeBoundingSphere(); mesh.userData.ownedMaterial = true; woods.add(mesh);
    }
    let instances = 0, meshes = 0; woods.traverse((o) => { if (o.isInstancedMesh) { meshes++; instances += o.count; } });
    for(const d of REALM_LEGENDS){const secret=new THREE.Group();secret.position.set(d.x,0,d.z);group.add(secret);legends.sword(secret);builder.flush();finish(secret);}
    current = createRiverCurrent(L.water, F.ripple); group.add(current.mesh);
    landscape = { ground: land, forest: { ...counts, meshes, instances }, rivers: { count: RIVER_PATHS.length, ...rivers }, buildMs: Math.round(performance.now() - started) };
    return landscape;
  }
  function build(group,state,helpers,flag){
    farm.reset();
    const started=performance.now(),districts=realmAccess(state),bridges=[];
    for(const d of districts){
      const region=new THREE.Group();region.position.set(d.x,0,d.z);group.add(region);
      terrain(region,d,helpers);
      if(d.homeTier!==null&&d.homeTier!==state.builtTier)home(region,d,state,flag);
      decor(region,d,state,flag,helpers);builder.flush();finish(region);
      const paint=paintOf(region);
      d.drawMeshes=paint.meshes;d.greyPaint=paint.greyPaint;d.hues=paint.hues;
    }
    for(const entry of bridgeAccess(state))bridges.push(bridge(group,entry,entry.open));
    builder.flush();
    return {districts,bridges,landscape:{...landscape,rebuildMs:Math.round(performance.now()-started)}};
  }
  // Where warm night light falls: in front of each district's main door, and at both gates of every bridge.
  function lightSpots() {
    const spots = REALM_DISTRICTS.map((d) => {
      const [x, z] = d.homeTier !== null ? [0, 4.6 * d.scale] : d.id === 'market' ? [-6, 2.4] : d.id === 'palace' ? [0, 6.5] : d.id === 'wizard' ? [0, 3.4] : d.id === 'rapunzel' ? [0, 5] : [7, -5.6];
      return { kind: 'door', district: d.id, x: d.x + x, z: d.z + z };
    });
    for (const site of FARM_SITES.filter(s=>s.kind==='stable')) {
      const d=REALM_DISTRICTS.find(d=>d.id===site.district);
      spots.push({kind:'stable',district:d.id,x:d.x+site.x,z:d.z+site.z+2.8});
    }
    for (const b of REALM_BRIDGES) for (const [x, z] of [b.a, b.b]) spots.push({ kind: 'gate', bridge: b.id, x, z });
    return spots;
  }
  return {woodland,build,home,finish,lightSpots,
    stepFarm: (seconds) => farm.tick(seconds), farmDebug: () => farm.debug(),
    stepCurrent: (seconds) => current?.tick(seconds), currentDebug: () => current?.debug() ?? null,
    surfaces: () => ({...surfaceMeshes, ripples: current?.mesh}),
  };
}
