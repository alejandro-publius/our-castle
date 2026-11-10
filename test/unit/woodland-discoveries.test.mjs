import test from 'node:test';
import assert from 'node:assert/strict';
import { REALM_BOUNDS, REALM_DISTRICTS, REALM_BRIDGES, journeyLeg, riverAt } from '../../src/core/realm.js';
import { WATERFALLS, WOODLAND_CAMP, WOODLAND_GLADE, MIST_GROVES, WAYSIDE_SITES } from '../../src/core/woodland-discoveries.js';
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

test('wayside footprints stay on dry level land, clear of traveled paths, bridge approaches and homes',()=>{
  const distance=(x,z,a,b)=>{
    const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
  };
  const routes=Array.from({length:20},(_,i)=>journeyLeg(i));
  const bridges=REALM_BRIDGES.map(b=>[{x:b.a[0],z:b.a[1]},{x:b.b[0],z:b.b[1]}]);
  for(const s of WAYSIDE_SITES){
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6,x=s.x+Math.cos(a)*s.radius,z=s.z+Math.sin(a)*s.radius;
      assert.ok(x>REALM_BOUNDS.minX&&x<REALM_BOUNDS.maxX&&z>REALM_BOUNDS.minZ&&z<REALM_BOUNDS.maxZ,s.id+' stays on the board');
      assert.equal(terrainElevation(x,z),0,s.id+' has a level foundation');
      assert.ok(riverAt(x,z).depth<-1.1,s.id+' clears the river bank');
    }
    for(const path of [...routes,...bridges])for(let i=1;i<path.length;i++)
      assert.ok(distance(s.x,s.z,path[i-1],path[i])>s.radius+1.5,s.id+' leaves the path open');
    for(const d of REALM_DISTRICTS)assert.ok(Math.hypot(s.x-d.x,s.z-d.z)>s.radius+10,s.id+' stays away from the main buildings');
  }
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
