import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_BOUNDS, REALM_DISTRICTS, riverAt } from '../../src/core/realm.js';
import { WATERFALLS, WOODLAND_CAMP } from '../../src/core/woodland-discoveries.js';
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
