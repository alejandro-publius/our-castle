// A focused, disposable example: one organizer household collecting books for a village reading room.
// The people, neighborhood and starting contribution are authored fixtures, not real donors or a shared cash vault.
import { DEMO_HOUSEHOLD_ID, EXAMPLE_DEFAULTS, getActiveGoal, setupHousehold, updateGoalProject } from '../server/household.mjs';
import { createContributionService } from '../server/payments/contributions.mjs';
import { kitView, saveKit } from '../server/kit/list.mjs';
import { exchangeAction } from '../server/exchange/index.mjs';

export const VILLAGE_STORY = Object.freeze({
  id: 'village-story',
  title: 'Example village library',
  defaults: Object.freeze({ ...EXAMPLE_DEFAULTS, goalName: 'Village library', startingCents: 0,
    members: Object.freeze({ ...EXAMPLE_DEFAULTS.members, family: Object.freeze([
      { id: 'm_rowan', name: 'Rowan', role: 'adult' },
      { id: 'm_ash', name: 'Ash', role: 'adult' },
      { id: 'm_wren', name: 'Wren', role: 'child' },
    ]) }),
  }),
});

export function createVillageStory({ clock }) {
  return { ...VILLAGE_STORY, async prepare() {
    return ({ db }) => {
      const householdId = DEMO_HOUSEHOLD_ID, goal = getActiveGoal(db, householdId);
      setupHousehold(db, householdId, { playMode: 'family', name: VILLAGE_STORY.defaults.householdName,
        crest: VILLAGE_STORY.defaults.crest }, VILLAGE_STORY.defaults);
      updateGoalProject(db, goal.id, 'schoolhouse');
      // Seed through the existing simulated-payment service: a labeled receipt, credit-once and milestone rules.
      // This is the example's starting fixture; opening the page never submits another contribution.
      createContributionService({ db, clock, mode: 'example' }).simulateContribution({
        householdId, goalId: goal.id, amountCents: 15000, approverId: 'm_ash', approvalConfirmed: true,
        requestId: 'village_library_start',
      });

      const actor = { memberId: 'm_rowan', role: 'adult' }, scope = { householdId, goalId: goal.id };
      const act = (action, input) => exchangeAction(db, { scope, actor, action, input }, clock);
      act('create', { name: 'Woodland library circle', alias: 'Alder' });
      db.prepare(`INSERT INTO households(id,name,play_mode,crest_field,crest_charge,is_example,setup_complete,created_at)
        VALUES('hh_story_willow','House of Willow','family','emerald','stag',1,1,?)`).run(clock.iso());
      db.prepare(`INSERT INTO members(id,household_id,display_name,role,is_example,sort)
        VALUES('m_story_willow','hh_story_willow','Willow','adult',1,0)`).run();
      const neighbor = (action, input) => exchangeAction(db, {
        scope: { householdId: 'hh_story_willow' }, actor: { memberId: 'm_story_willow', role: 'adult' }, action, input,
      }, clock);
      neighbor('join', { token: act('invite', {}).invitation.token, alias: 'Willow', confirmed: true });
      saveKit(db, { householdId, goalId: goal.id, actor, expectedRevision: 0,
        items: [{ name: 'Books for the reading room', quantity: 10, ownedQuantity: 0, from: 'typed' }] }, clock);
      const kit = kitView(db, goal);
      const { requestId } = act('request', { kitRevision: kit.revision, lineId: kit.items[0].id, quantity: 10,
        neededUntil: goal.targetDate, note: 'Books for our shared village reading room.', confirmed: true });
      neighbor('offer', { requestId, quantity: 5, kind: 'gift', note: 'Five sample books our family can pass on.' });
    };
  } };
}
