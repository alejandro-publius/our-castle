// Five invented families and one shared project, in the demo runner's disposable in-memory database only.
import { DEMO_HOUSEHOLD_ID, EXAMPLE_DEFAULTS, setupHousehold, getActiveGoal, addDays } from '../server/household.mjs';
import { exchangeAction } from '../server/exchange/index.mjs';
import { villageAction, villageFund, recordVillageReceipt } from '../server/village/index.mjs';

export const VILLAGE_FUND_EXAMPLE = Object.freeze({ id: 'village-fund', title: 'Example village class trip', defaults: EXAMPLE_DEFAULTS });

export function createVillageFundExample({ clock }) {
  return { ...VILLAGE_FUND_EXAMPLE, async prepare() {
    return ({ db }) => {
      const householdId = DEMO_HOUSEHOLD_ID, scope = { mode: 'example', householdId, goalId: getActiveGoal(db, householdId).id, memberId: 'm_rowan', role: 'adult' };
      setupHousehold(db, householdId, { playMode: 'family', name: EXAMPLE_DEFAULTS.householdName, crest: EXAMPLE_DEFAULTS.crest });
      const exchange = (who, action, input) => exchangeAction(db, { scope: who, actor: who, action, input }, clock);
      exchange(scope, 'create', { name: 'Woodland school families', alias: 'Alder' });
      const others = ['Willow', 'Oak', 'Birch', 'Maple'].map((alias, i) => {
        const id = `hh_fund_${alias.toLowerCase()}`, memberId = `m_fund_${alias.toLowerCase()}`, goalId = `goal_fund_${alias.toLowerCase()}`;
        db.prepare(`INSERT INTO households(id,name,play_mode,crest_field,crest_charge,is_example,setup_complete,created_at)
          VALUES(?,?,'family',?,'stag',1,1,?)`).run(id, `House of ${alias}`, ['emerald','crimson','cobalt','violet'][i], clock.iso());
        db.prepare(`INSERT INTO members(id,household_id,display_name,role,is_example,sort) VALUES(?,?,?,'adult',1,0)`).run(memberId, id, alias);
        db.prepare(`INSERT INTO goals(id,household_id,name,target_cents,currency,target_date,created_at) VALUES(?,?,?,10000,'USD',?,?)`)
          .run(goalId, id, 'Private example goal', addDays(clock.today(), 60), clock.iso());
        db.prepare(`INSERT INTO ledger_entries(household_id,goal_id,kind,effect,amount_cents,currency,source,source_ref,created_at)
          VALUES(?,?,'starting_progress',1,?,'USD','user-reported',?,?)`).run(id, goalId, [2500,6000,8500,10000][i], `village-example-private-${id}`, clock.iso());
        const neighbor = { mode: 'example', householdId: id, goalId, memberId, role: 'adult' };
        exchange(neighbor, 'join', { token: exchange(scope, 'invite', {}).invitation.token, alias, confirmed: true });
        villageAction(db, { scope: neighbor, actor: neighbor, action: 'share-castle', input: { shared: true, confirmed: true } }, clock);
        return neighbor;
      });
      const { fundId } = villageAction(db, { scope, actor: scope, action: 'create', input: {
        title: 'Class trip together', targetMinor: 40000, rail: 'simulated', projectKind: 'schoolhouse', deadline: addDays(clock.today(), 32), confirmed: true,
      } }, clock);
      for (const who of [scope, ...others]) villageAction(db, { scope: who, actor: who, action: 'share', input: {
        fundId, committedMinor: 8000, expectedRevision: villageFund(db, who, fundId).revision, confirmed: true,
      } }, clock);
      for (const who of others) recordVillageReceipt(db, { fundId, source: 'simulated', eventRef: `example-${who.householdId}`, eventIndex: '0',
        kind: 'capture', amountMinor: 5000, currency: 'USD', familyHouseholdId: who.householdId, recipient: null, at: clock.iso() }, clock);
    };
  } };
}
