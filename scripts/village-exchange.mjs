// Optional, authored example only. Two invented households; all stock and catalogue facts are samples.
import { createFamilyTrip } from './family-trip.mjs';
import { DEMO_HOUSEHOLD_ID, getActiveGoal } from '../server/household.mjs';
import { kitView } from '../server/kit/list.mjs';
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
    };
  }};
}
