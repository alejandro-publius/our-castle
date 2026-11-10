import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_SIZE, REALM_BOUNDS, REALM_DISTRICTS, REALM_LEGENDS, REALM_BRIDGES, REALM_ROUTE, RIVER_PATHS, riverAt } from '../../src/core/realm.js';
import { FRONTIER_CLEARINGS, MOUNTAIN_PEAKS, terrainElevation } from '../../src/core/realm-terrain.js';

test('mountain relief never lifts an existing property, discovery, bridge or walking route',()=>{
  for(const d of [...REALM_DISTRICTS,...REALM_LEGENDS])for(const x of [-1,0,1])for(const z of [-1,0,1])
    assert.equal(terrainElevation(d.x+x*d.width/2,d.z+z*d.depth/2),0,d.id);
  for(const b of REALM_BRIDGES)for(const p of [b.a,b.b])assert.equal(terrainElevation(...p),0,b.id);
  for(const p of REALM_ROUTE)assert.equal(terrainElevation(p.x,p.z),0,'original route');
});
test('unbuilt outer clearings fit the expanded land and retain flat centres without becoming reward districts',()=>{
  for(const d of FRONTIER_CLEARINGS){
    assert.ok(d.x-d.width/2>=REALM_BOUNDS.minX&&d.x+d.width/2<=REALM_BOUNDS.maxX);
    assert.ok(d.z-d.depth/2>=REALM_BOUNDS.minZ&&d.z+d.depth/2<=REALM_BOUNDS.maxZ);
    for(const x of [-6,0,6])for(const z of [-6,0,6])assert.equal(terrainElevation(d.x+x,d.z+z),0,d.id);
    assert.equal(REALM_DISTRICTS.some(p=>p.id===d.id),false);
  }
});
test('the rocky perimeter has visible relief, lower foreground peaks and flat river valleys',()=>{
  const heights=MOUNTAIN_PEAKS.map(p=>({z:p.z,h:terrainElevation(p.x,p.z)}));
  assert.ok(heights.some(p=>p.z<0&&p.h>14));
  assert.ok(heights.some(p=>p.z>0&&p.h>4));
  assert.ok(Math.max(...MOUNTAIN_PEAKS.filter(p=>p.z>90).map(p=>p.height))<Math.max(...MOUNTAIN_PEAKS.filter(p=>p.z< -90).map(p=>p.height)));
  for(const river of RIVER_PATHS)for(const [x,z] of river.path)assert.ok(terrainElevation(x,z)<.00001,`${river.id} valley`);
  assert.ok(heights.every(p=>Number.isFinite(p.h)&&p.h>=0&&p.h<=28));
});
test('the extra land row contains complete mountain feet and river mouths on every side',()=>{
  assert.deepEqual([REALM_SIZE.width,REALM_SIZE.depth],[452,356]);
  // The broad foot extends sqrt(2) times each radius, beyond the sharp peak's diamond.
  for(const p of MOUNTAIN_PEAKS){
    assert.ok(p.x-p.rx*Math.SQRT2>=REALM_BOUNDS.minX+2,'west foot');
    assert.ok(p.x+p.rx*Math.SQRT2<=REALM_BOUNDS.maxX-2,'east foot');
    assert.ok(p.z-p.rz*Math.SQRT2>=REALM_BOUNDS.minZ+2,'north foot');
    assert.ok(p.z+p.rz*Math.SQRT2<=REALM_BOUNDS.maxZ-2,'south foot');
  }
  for(const [x,z,id] of [[REALM_BOUNDS.minX,3,'main'],[REALM_BOUNDS.maxX,2,'main'],
    [-36,REALM_BOUNDS.maxZ,'west'],[16,REALM_BOUNDS.minZ,'east'],[20,REALM_BOUNDS.maxZ,'east'],
    [82,REALM_BOUNDS.minZ,'rose'],[73,REALM_BOUNDS.maxZ,'starfall'],[112,REALM_BOUNDS.maxZ,'braid']]){
    const river=riverAt(x,z);
    assert.equal(river.river,id);
    assert.ok(river.depth>0,`${id} reaches the rim`);
    assert.equal(terrainElevation(x,z,river),0,`${id} stays a valley`);
  }
  for(let x=REALM_BOUNDS.minX;x<=REALM_BOUNDS.maxX;x+=2)for(const z of [REALM_BOUNDS.minZ,REALM_BOUNDS.maxZ])assert.equal(terrainElevation(x,z),0,'complete north/south descent');
  for(let z=REALM_BOUNDS.minZ;z<=REALM_BOUNDS.maxZ;z+=2)for(const x of [REALM_BOUNDS.minX,REALM_BOUNDS.maxX])assert.equal(terrainElevation(x,z),0,'complete east/west descent');
});
