// Optional, authored example only. Invented households and international listings; all stock and catalogue facts are samples.
import { createFamilyTrip } from './family-trip.mjs';
import { DEMO_HOUSEHOLD_ID, getActiveGoal } from '../server/household.mjs';
import { kitView, saveKit } from '../server/kit/list.mjs';
import { exchangeAction } from '../server/exchange/index.mjs';
export function createVillageExample({clock}) {
  const trip=createFamilyTrip({clock});
  return {...trip,id:'village-exchange',title:'Example neighborhood',async prepare(){
    const seed=await trip.prepare();
    return ({db})=>{
      seed({db});
      db.prepare(`INSERT OR IGNORE INTO households(id,name,play_mode,crest_field,crest_charge,is_example,setup_complete,created_at)
        VALUES('hh_sample_willow','House of Willow','family','emerald','stag',1,1,?)`).run(clock.iso());
      db.prepare("INSERT OR IGNORE INTO members(id,household_id,display_name,role,is_example,sort) VALUES('m_sample_willow','hh_sample_willow','Willow','adult',1,0)").run();
      const goal=getActiveGoal(db,DEMO_HOUSEHOLD_ID),scope={householdId:DEMO_HOUSEHOLD_ID,goalId:goal.id},actor={memberId:'m_rowan',role:'adult'};
      const act=(action,input)=>exchangeAction(db,{scope,actor,action,input},clock);
      act('create',{name:'Woodland neighbors',alias:'Alder'});
      const inv=act('invite',{}).invitation;
      const neighbor=(action,input)=>exchangeAction(db,{scope:{householdId:'hh_sample_willow'},actor:{memberId:'m_sample_willow',role:'adult'},action,input},clock);
      neighbor('join',{token:inv.token,alias:'Willow',confirmed:true});
      const kit=kitView(db,goal),tent=kit.items.find(i=>i.name.includes('tent'));
      const {requestId}=act('request',{kitRevision:kit.revision,lineId:tent.id,quantity:1,neededUntil:goal.targetDate,note:'A four-person tent for our family weekend.',confirmed:true});
      neighbor('offer',{requestId,quantity:1,kind:'loan',returnBy:goal.targetDate,note:'Our sample four-person tent has pegs and a rain cover.'});
      act('settings',{alias:'Alder',country:'United States',visibility:'worldwide',confirmed:true});
      // Invented international listings demonstrate separate identities, never a real global user base.
      for (const [slug,alias,country,item,quantity,note] of [
        ['cedar','Cedar','Canada','Stove',1,'A freestanding electric stove for our family kitchen.'],
        ['sol','Sol','Portugal','Stove',1,'A compact electric stove for a small kitchen.'],
        ['acacia','Acacia','Kenya','School backpacks',3,'Three backpacks for the new school term.'],
        ['hana','Hana','Japan','Desk',1,'A study desk; a used one would help.'],
        ['birch','Birch','United Kingdom','Bicycle',1,'A small bicycle for trips to school.'],
        ['olive','Olive','Spain','Winter coats',2,'Two warm coats in adult sizes.'],
        ['river','River','New Zealand','Bookshelf',1,'A shelf for shared school books.'],
      ]) {
        const hh=`hh_sample_${slug}`,memberId=`m_sample_${slug}`,goalId=`g_sample_${slug}`;
        db.prepare("INSERT INTO households(id,name,play_mode,crest_field,crest_charge,is_example,setup_complete,created_at) VALUES(?,?,'family','emerald','stag',1,1,?)").run(hh,`House of ${alias}`,clock.iso());
        db.prepare("INSERT INTO members(id,household_id,display_name,role,is_example,sort) VALUES(?,?,?,'adult',1,0)").run(memberId,hh,alias);
        db.prepare("INSERT INTO goals(id,household_id,name,target_cents,currency,target_date,created_at) VALUES(?,?,?,30000,'USD',?,?)").run(goalId,hh,`${item} for our family`,goal.targetDate,clock.iso());
        const actor={memberId,role:'adult'},scope={householdId:hh,goalId};
        const call=(action,input)=>exchangeAction(db,{scope,actor,action,input},clock);
        call('settings',{alias,country,visibility:'worldwide',confirmed:true});
        saveKit(db,{householdId:hh,goalId,actor,expectedRevision:0,items:[{name:item,quantity,ownedQuantity:0,from:'typed'}]},clock);
        const kit=kitView(db,getActiveGoal(db,hh));
        call('request',{kitRevision:kit.revision,lineId:kit.items[0].id,quantity,neededUntil:goal.targetDate,note,confirmed:true});
      }
    };
  }};
}
