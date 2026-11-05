import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupDomain } from '../helpers/setup.mjs';
import { openDatabase } from '../../server/db.mjs';
import { getMembers, setupHousehold, updateMemberAvatar } from '../../server/household.mjs';

const financialSnapshot = (db) => Object.fromEntries(
  ['households','goals','ledger_entries','payment_orders','payment_captures','payment_refunds','webhook_events','plans','achievements']
    .map((table) => [table, db.prepare('SELECT * FROM ' + table).all()]));
const people = (db) => db.prepare('SELECT id, household_id, display_name, role, is_example, sort FROM members ORDER BY id').all();

test('a member avatar persists independently, without changing roles, identities or financial records', () => {
  const folder = mkdtempSync(join(tmpdir(), 'castle-avatar-')), file = join(folder, 'example.sqlite');
  const s = setupDomain({ file }); let db = s.db;
  try {
    const financial = financialSnapshot(db), members = people(db);
    updateMemberAvatar(db, s.householdId, 'm_rowan', 'wizard');
    updateMemberAvatar(db, s.householdId, 'm_wren', 'knight');
    assert.deepEqual(people(db), members);
    assert.deepEqual(financialSnapshot(db), financial);
    assert.equal(getMembers(db,s.householdId)[0].avatarId,'wizard');
    assert.equal(getMembers(db,s.householdId)[1].role,'child');
    db.close(); db = openDatabase(file);
    assert.deepEqual(getMembers(db,s.householdId).map(m=>m.avatarId),['wizard','knight']);
    setupHousehold(db,s.householdId,{playMode:'family',name:'House of Alder',crest:{field:'violet',charge:'stag'}});
    assert.deepEqual(getMembers(db,s.householdId).map(m=>m.avatarId),['wizard','knight'], 'saving the house preserves portraits');
    assert.deepEqual(financialSnapshot(db), financial);
  } finally { db.close(); rmSync(folder,{recursive:true,force:true}); }
});

test('avatar writes reject unknown or foreign members and unlisted values without mutation', () => {
  const s = setupDomain();
  try {
    const before = getMembers(s.db,s.householdId), financial = financialSnapshot(s.db);
    for(const avatar of ['missing','__proto__','../knight',null,{},42]) {
      assert.throws(()=>updateMemberAvatar(s.db,s.householdId,'m_rowan',avatar),e=>e.status===400&&e.code==='invalid_avatar');
    }
    assert.throws(()=>updateMemberAvatar(s.db,s.householdId,'foreign-member','wizard'),e=>e.status===404);
    assert.throws(()=>updateMemberAvatar(s.db,'another-house','m_rowan','wizard'),e=>e.status===404);
    assert.deepEqual(getMembers(s.db,s.householdId),before);
    assert.deepEqual(financialSnapshot(s.db),financial);
  } finally { s.db.close(); }
});

test('the additive avatar migration preserves an existing version-one household and every financial table', () => {
  const folder=mkdtempSync(join(tmpdir(),'castle-avatar-migration-')),file=join(folder,'example.sqlite');
  const s=setupDomain({file});let db=s.db;
  try {
    // Model the real prior schema in a synthetic fixture, never the owner's file.
    db.exec('ALTER TABLE members DROP COLUMN avatar_id; DROP TABLE goal_items; PRAGMA user_version = 1;');
    const financial=financialSnapshot(db),members=people(db);
    db.close();db=openDatabase(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,3); // avatar column, then the merchant's goal_items table
    assert.deepEqual(people(db),members);
    assert.deepEqual(financialSnapshot(db),financial);
    assert.deepEqual(getMembers(db,s.householdId).map(m=>m.avatarId),['ranger','bard']);
    db.close();db=openDatabase(file);
    assert.deepEqual(financialSnapshot(db),financial,'migration is not reapplied');
  } finally {db.close();rmSync(folder,{recursive:true,force:true});}
});
