import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_BOUNDS, REALM_DISTRICTS, riverAt } from '../../src/core/realm.js';
import { WATERFALLS, WOODLAND_CAMP, WOODLAND_GLADE, MIST_GROVES } from '../../src/core/woodland-discoveries.js';
import { terrainElevation } from '../../src/core/realm-terrain.js';
test('waterfall landing pools meet their named river and the hidden camp is a dry, level clearing outside every district',()=>{
  for(const f of WATERFALLS){
    const x=f.x+(f.axis==='x'?2.2:0),z=f.z+(f.axis==='z'?2.2:0),channel=riverAt(x,z);
    assert.equal(channel.river,f.river);assert.ok(channel.depth>0);
    assert.ok(x>REALM_BOUNDS.minX&&x<REALM_BOUNDS.maxX&&z>REALM_BOUNDS.minZ&&z<REALM_BOUNDS.maxZ);
  }
  const c=WOODLAND_CAMP;assert.ok(riverAt(c.x,c.z).depth<-c.width/2);assert.equal(terrainElevation(c.x,c.z),0);
  assert.ok(REALM_DISTRICTS.every(d=>Math.abs(c.x-d.x)>(c.width+d.width)/2||Math.abs(c.z-d.z)>(c.depth+d.depth)/2));
});
test('the lantern glade and low mist stay in outer woodland, away from homes, water and the board rim',()=>{
  const c=WOODLAND_GLADE;
  for(const dx of [-8,0,8])for(const dz of [-8,0,8]){
    assert.equal(terrainElevation(c.x+dx,c.z+dz),0,'the arch and ring stand on level land');
    assert.ok(riverAt(c.x+dx,c.z+dz).depth< -2,'the glade stays dry');
  }
  for(const g of MIST_GROVES){
    assert.ok(g.x-g.rx>REALM_BOUNDS.minX&&g.x+g.rx<REALM_BOUNDS.maxX);
    assert.ok(g.z-g.rz>REALM_BOUNDS.minZ&&g.z+g.rz<REALM_BOUNDS.maxZ);
    for(const d of REALM_DISTRICTS)assert.ok(Math.abs(g.x-d.x)>g.rx+d.width/2||Math.abs(g.z-d.z)>g.rz+d.depth/2,'mist never hides a home or its controls');
  }
});
