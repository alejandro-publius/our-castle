import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_BOUNDS, REALM_DISTRICTS, REALM_LEGENDS, REALM_BRIDGES, REALM_ROUTE, RIVER_PATHS } from '../../src/core/realm.js';
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
