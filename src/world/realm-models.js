import * as THREE from 'three';
import { REALM_SIZE, REALM_DISTRICTS, REALM_BRIDGES, REALM_ROUTE, journeyLeg, realmAccess, bridgeAccess } from '../core/realm.js';

export function createRealmModels({ builder, part, models, colours: C }) {
  const outline = new THREE.Shape();
  const points = [[-.39,-.5],[.39,-.5],[.5,-.39],[.5,.39],[.39,.5],[-.39,.5],[-.5,.39],[-.5,-.39]];
  points.forEach(([x,z],i)=>i?outline.lineTo(x,z):outline.moveTo(x,z));outline.closePath();
  builder.geo.shore = new THREE.ExtrudeGeometry(outline,{depth:1,bevelEnabled:false,steps:1});
  builder.geo.shore.rotateX(-Math.PI/2);builder.geo.shore.translate(0,-.5,0);
  const box=(g,x,y,z,w,h,d,c,ry=0,rz=0)=>part(g,'box',x,y,z,w,h,d,c,ry,rz);
  const rock=(g,x,y,z,w,h,d,c)=>part(g,'rock',x,y,z,w,h,d,c);
  const round=(g,x,y,z,w,h,d,c)=>part(g,'round',x,y,z,w,h,d,c);

  // Collapse static sub-models into shared instance batches while preserving articulated animals and windmills.
  function finish(group, locked = false) {
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
    if(locked)group.traverse((mesh)=>{
      if(!mesh.isMesh)return;
      const material=mesh.material.clone(),hsl={};material.color.getHSL(hsl);
      const grey=.055+hsl.l*.27;material.color.setRGB(grey,grey,grey);
      material.roughness=1;mesh.material=material;mesh.userData.ownedMaterial=true;
    });
  }
  function nearJourney(x,z){
    for(let n=0;n<20;n++){
      const path=journeyLeg(n);
      for(let j=1;j<path.length;j++){
        const a=path[j-1],b=path[j],dx=b.x-a.x,dz=b.z-a.z;
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
        if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<2.1)return true;
      }
    }
    return REALM_BRIDGES.some(b=>Math.abs(x-b.a[0])<2.6&&Math.abs(z-b.a[1])<4||Math.abs(x-b.b[0])<2.6&&Math.abs(z-b.b[1])<4);
  }
  function terrain(group,d,helpers){
    part(group,'shore',0,-1.05,0,d.width,2.3,d.depth,C.soil);
    part(group,'shore',0,.13,0,d.width+.1,.24,d.depth+.1,C.grass);
    for(let side=0;side<4;side++)for(let i=0;i<12;i++){
      const f=(i+.5)/12-.5;
      const x=side%2? (side===1?1:-1)*(d.width/2-.5):f*(d.width-5);
      const z=side%2?f*(d.depth-5):(side===0?-1:1)*(d.depth/2-.5);
      rock(group,x,-.55,z,1.9,1.2,1.6,i%3?C.stone:C.wood);
      if(i%3===0&&!nearJourney(d.x+x,d.z+z))helpers.tree(group,x,z,1.25+(i%4)*.18,true);
    }
    // Each shore has its own copses rather than a single square tree border.
    for(let i=0;i<24;i++){
      const x=Math.sin(i*2.37)*(d.width/2-3),z=Math.cos(i*3.73)*(d.depth/2-3);
      if(Math.abs(x)<12*d.scale&&Math.abs(z)<11*d.scale||nearJourney(d.x+x,d.z+z))continue;
      helpers.tree(group,x,z,1.1+(i%5)*.16,i%3!==0);
    }
    for(let i=0;i<20;i++){
      const x=Math.sin(i*3.9)*(d.width*.41),z=Math.cos(i*2.7)*(d.depth*.4);
      if(Math.abs(x)<7&&Math.abs(z)<6||nearJourney(d.x+x,d.z+z))continue;
      rock(group,x,.34,z,.5,.32,.4,C.leaf);rock(group,x,.57,z,.2,.23,.2,i%2?C.gold:C.red);
    }
  }
  function home(group,d,state,flag){
    const g=new THREE.Group();g.scale.setScalar(d.scale);group.add(g);
    models.home(g,d.homeTier,flag,d.homeTier===0?Math.min(1,state.estateLevel):0);
    return g;
  }
  function decor(group,d,state,flag,helpers){
    if(d.id==='cottage'){
      for(const[x,z]of[[-10,11],[8,11]])models.cottage(group,x,z,{w:2.7,h:1.8,d:2.2,roofColor:z>0?C.red:C.blue});
      helpers.deer(group,-10,-6,.4);helpers.deer(group,-9,-3,-.4,.7);helpers.deer(group,9,2,2.2);helpers.deer(group,8,-8,1.5);
      helpers.butterflies(group);
      models.well(group,7,-6);
    }
    if(d.id==='manor'){
      models.cottage(group,12,-7,{w:4,h:3,d:4,roofColor:C.blue});
      for(const x of[-13,-8,8])for(const z of[-11,12]){
        box(group,x,.4,z,3.2,.25,1.4,C.cream);
        for(let i=0;i<5;i++){rock(group,x-1.1+i*.55,.8,z,.5,.55,.5,C.leaf);rock(group,x-1.1+i*.55,1.05,z,.2,.2,.2,i%2?C.red:C.gold);}
      }
      models.banner(group,12,2,-4.9,flag,1,1.5);
    }
    if(d.id==='keep'){
      for(const x of[-15,15])models.tower(group,x,-9,6.5,flag,false);
      models.cottage(group,-14,3,{w:3,h:2.5,d:4,roofColor:C.blue,timber:false,color:C.stone});
      if(state.estateLevel>=3){const ramparts=new THREE.Group();ramparts.scale.setScalar(d.scale);group.add(ramparts);models.extras(ramparts,3,flag,null,{market:false});}
    }
    if(d.id==='castle'){
      // A separate, substantially larger palace district with side halls and its own outer curtain wall.
      for(const x of[-15,15]){
        models.cottage(group,x,-7,{w:4.5,h:5.2,d:6,roofColor:C.blue,color:C.stone,timber:false});
        models.tower(group,x,-12,10,flag,true);
      }
      const walls=new THREE.Group();walls.scale.setScalar(d.scale);group.add(walls);models.extras(walls,3,flag,null,{market:false});
      for(const x of[-17,17])for(const z of[3,9,15]){
        round(group,x,.4,z,3,.3,3,C.cream);round(group,x,.7,z,2.5,.35,2.5,C.pine);rock(group,x,1.15,z,1.3,1,1.3,C.leaf);
      }
    }
    if(d.id==='market'){
      models.extras(group,2,flag,null,{ramparts:false});
      models.cottage(group,-6,-1,{w:6,h:4,d:5,roofColor:C.red});models.banner(group,-6,3,1.6,flag,1,1.3);
      for(const[x,z]of[[-9,-9],[3,-9],[-7,9]])models.cottage(group,x,z,{w:3,h:2.2,d:2.7,roofColor:C.blue});
      models.well(group,-3,6);
      round(group,9,3,-8,1.8,5.5,1.8,C.cream);part(group,'cone',9,6.3,-8,2.4,1.5,2.4,C.blue);
      const sails=new THREE.Group();sails.userData.live=true;sails.position.set(9,4.7,-6.9);group.add(sails);
      for(let i=0;i<4;i++){const a=i*Math.PI/2;box(sails,Math.sin(a)*1.7,Math.cos(a)*1.7,0,.6,3.2,.15,C.cream,0,-a);}
      helpers.rotators.push({group:sails,axis:'z',speed:.1});
    }
    if(d.id==='garden'){
      models.cottage(group,7,-8,{w:4,h:2.6,d:3.4,roofColor:C.blue});
      round(group,-4,.28,1,10,.15,8,C.water);
      for(let i=0;i<16;i++){const a=i*Math.PI/8;rock(group,-4+Math.cos(a)*5,.43,1+Math.sin(a)*4,.8,.5,.8,C.stone);}
      models.well(group,8,4);
      for(let i=0;i<4;i++)models.vegetables(group,7,-1+i*2,4,1.6);
      for(let i=0;i<8;i++)helpers.tree(group,-11+(i%4)*3.4,-12+Math.floor(i/4)*3.5,1.8,i%2===0);
      if(state.previewFeature==='water')models.extras(group,0,flag,'water');
    }
    if(state.previewFeature==='electricity'&&d.open)for(const[x,z]of[[-10,7],[10,7],[-10,-7],[10,-7]])models.lantern(group,x,z,.2,true);
  }
  function bridge(group,definition,open){
    const g=new THREE.Group(),[ax,az]=definition.a,[bx,bz]=definition.b;
    const length=Math.hypot(bx-ax,bz-az),angle=-Math.atan2(bz-az,bx-ax);g.position.set(ax,0,az);g.rotation.y=angle;group.add(g);
    for(const x of[0,length/2,length]){
      box(g,x,-.8,0,1.6,2.2,4.8,C.stone);
      for(const z of[-2,2]){box(g,x,1.2,z,.5,2.5,.5,C.stone);part(g,'cone',x,2.7,z,.8,.5,.8,C.gold);}
    }
    const panels=[];
    for(const sign of[1,-1]){
      const panel=new THREE.Group();panel.userData.live=true;panel.position.x=sign===1?0:length;panel.rotation.z=open?0:sign*1.03;g.add(panel);panels.push({group:panel,sign});
      for(let i=0;i<9;i++)box(panel,sign*(i+.5)*length/18,.32,0,length/18-.035,.28,3.8,C.wood);
      for(const z of[-1.85,1.85]){box(panel,sign*length/4,.85,z,length/2,.14,.12,C.cream);for(let i=0;i<5;i++)box(panel,sign*(i+.3)*length/10,.62,z,.12,.7,.12,C.soil);}
    }
    if(!open){
      box(g,length+.7,1.25,0,.3,2.4,4.1,C.dark);
      for(const z of[-1.3,0,1.3])box(g,length+.85,1.3,z,.08,2.4,.08,C.stone);
      box(g,length+.9,1.25,0,.25,1.15,.95,C.stone);part(g,'arch',length+.93,2.1,0,.85,.9,.12,C.gold,Math.PI/2);
    }
    builder.flush();finish(g,!open);return {...definition,open,panels};
  }
  function build(group,state,helpers,flag){
    const districts=realmAccess(state),bridges=[];
    // Water stays blue around grey locked districts; unlit paint avoids the high-key sun washing it into grey.
    const water=new THREE.Mesh(new THREE.BoxGeometry(REALM_SIZE.width,.3,REALM_SIZE.depth),new THREE.MeshBasicMaterial({color:0x245c89}));
    water.position.y=-2.05;water.userData.ownedGeometry=true;water.userData.ownedMaterial=true;group.add(water);
    // Pale ripples read as channels and moat water, not empty spaces between unrelated plots.
    for(let i=0;i<100;i++){
      const x=Math.sin(i*2.143)*79,z=Math.cos(i*3.219)*54;
      if(REALM_DISTRICTS.some(d=>Math.abs(x-d.x)<d.width/2+1&&Math.abs(z-d.z)<d.depth/2+1))continue;
      box(group,x,-1.87,z,1.5+(i%4),.035,.1,i%3?C.water:0x9abfc1);
    }
    for(const d of districts){
      const region=new THREE.Group();region.position.set(d.x,0,d.z);group.add(region);
      terrain(region,d,helpers);
      if(d.homeTier!==null&&d.homeTier!==state.builtTier)home(region,d,state,flag);
      decor(region,d,state,flag,helpers);builder.flush();finish(region,!d.open);
      let meshes=0,grey=0;region.traverse(mesh=>{if(mesh.isMesh){meshes++;const c=mesh.material.color;if(Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b)<.002)grey++;}});
      d.drawMeshes=meshes;d.greyPaint=meshes>0&&grey===meshes;
    }
    for(const entry of bridgeAccess(state))bridges.push(bridge(group,entry,entry.open));
    builder.flush();return {districts,bridges};
  }
  return {build,home,finish};
}
