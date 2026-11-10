import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, openDatabase } from '../../server/db.mjs';

// The integrated build's one migration sequence, from every schema a real database can have: main's 4, the two
// different 5s that the goal-project and sponsor branches wrote, the access branch's 6, the integrated 7, this build's schema, and a newer one.
// Each branch's database is rebuilt here from the same statements that branch ran (checked against each branch's own
// openDatabase when this was written: identical schemas). Every path must reach exactly a fresh database's schema,
// keep its rows, and be safe to open again.
const step = (id) => MIGRATIONS.find((s) => typeof s !== 'string' && s.id === id);
const MAIN = MIGRATIONS.filter((s) => typeof s === 'string');
const BRANCHES = {
  'main (4)': { version: 4, steps: MAIN },
  'goal projects (5: project kind)': { version: 5, steps: [...MAIN, step('goal-project-kind')] },
  'sponsor depth (5: merchant selection)': { version: 5, steps: [...MAIN, step('merchant-selection')] },
  'family access (6: project kind, access tables)': { version: 6, steps: [...MAIN, step('goal-project-kind'), step('family-access')] },
  'integrated (7)': { version: 7, steps: MIGRATIONS.slice(0, 7) },
  'village exchange (13)': { version: 13, steps: MIGRATIONS.slice(0,13) },
  'exchange directory (14)': { version: 14, steps: MIGRATIONS.slice(0,14) },
  'current': { version: MIGRATIONS.length, steps: MIGRATIONS },
};
const schema = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
  .map((r) => `${r.type} ${r.name} ${r.sql}`).join('\n');
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('one sequence: main 4 has four SQL steps, then eleven checked steps, fifteen in all', () => {
  assert.equal(MAIN.length, 4);
  assert.deepEqual(MIGRATIONS.slice(4).map((s) => s.id), ['goal-project-kind', 'merchant-selection', 'family-access', 'deferred-refunds', 'family-choices', 'family-choice-needs', 'kit-lists', 'kit-planner', 'village-exchange', 'exchange-directory', 'village-funds']);
  assert.ok(MIGRATIONS.every(Object.isFrozen));
});

test('every earlier schema, including both branch-only 5s and the 6, upgrades to exactly the fresh schema and keeps its rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-migrations-'));
  const fresh = openDatabase(path.join(dir, 'fresh.sqlite'));
  const want = schema(fresh);
  assert.equal(version(fresh), MIGRATIONS.length);
  fresh.close();
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    for (const [name, { version: v, steps }] of Object.entries(BRANCHES)) {
      const file = path.join(dir, `${name.replace(/\W+/g, '-')}.sqlite`);
      const old = new DatabaseSync(file);
      for (const s of steps) { if (typeof s === 'string') old.exec(s); else s.ensure(old); }
      old.exec(`PRAGMA user_version = ${v}`);
      old.exec("INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at) VALUES ('hh_kept', 'House Kept', 'family', 'cobalt', 'stag', 0, 1, '2026-11-01T00:00:00.000Z')");
      old.close();
      warnings.length = 0;
      const db = openDatabase(file);
      assert.equal(version(db), MIGRATIONS.length, name);
      assert.equal(schema(db), want, `${name}: same schema as a fresh database`);
      assert.equal(db.prepare("SELECT name FROM households WHERE id = 'hh_kept'").get().name, 'House Kept', `${name}: rows kept`);
      // Ambiguous branch-only versions are named, and checked against the actual tables rather than trusted.
      assert.equal(warnings.some((w) => w.includes(`schema ${v} came from a pre-integration branch build`)), v === 5 || v === 6, name);
      db.close();
      const again = openDatabase(file);
      assert.equal(version(again), MIGRATIONS.length); assert.equal(schema(again), want, `${name}: reopening changes nothing`);
      again.close();
    }
  } finally { console.warn = warn; }
});

test('a database from a newer build is refused and left exactly as it was', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'our-castle-migrations-'));
  const file = path.join(dir, 'newer.sqlite');
  const built = openDatabase(file);
  built.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  const before = schema(built);
  built.close();
  assert.throws(() => openDatabase(file), /newer than this build/);
  const after = new DatabaseSync(file);
  assert.equal(version(after), MIGRATIONS.length + 1);
  assert.equal(schema(after), before);
  after.close();
});

test('schema 13 neighborhoods migrate privately with their requests and offers intact; family references survive reopening', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'our-castle-exchange-migration-')),file=path.join(dir,'fixture.sqlite');
  let db=new DatabaseSync(file);
  try {
    for(const s of MIGRATIONS.slice(0,13)){if(typeof s==='string')db.exec(s);else s.ensure(db);}
    db.exec(`PRAGMA user_version=13;
      INSERT INTO households(id,name,play_mode,crest_field,crest_charge,is_example,setup_complete,created_at)
        VALUES('hh_a','House A','family','cobalt','stag',1,1,'2026-11-01'),('hh_b','House B','family','cobalt','stag',1,1,'2026-11-01');
      INSERT INTO goals(id,household_id,name,target_cents,currency,target_date,created_at) VALUES('g_a','hh_a','Kitchen',30000,'USD','2027-01-01','2026-11-01');
      INSERT INTO exchange_circles VALUES('v_a','Neighbors','hh_a','2026-11-01');
      INSERT INTO exchange_members VALUES('hh_a','v_a','Alder','2026-11-01'),('hh_b','v_a','Birch','2026-11-01');
      INSERT INTO exchange_requests VALUES('need_a','v_a','hh_a','g_a','line_a','Stove',NULL,1,'2027-01-01','Private note','open','2026-11-01');
      INSERT INTO exchange_offers VALUES('loan_b','need_a','hh_b',1,'gift',NULL,'Private offer','offered','2026-11-01','2026-11-01');`);
    const tables=['households','goals','exchange_circles','exchange_members','exchange_requests','exchange_offers'];
    const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
    db.close();db=openDatabase(file);
    for(const t of tables){
      const after=db.prepare(`SELECT * FROM ${t}`).all().map(r=>{if(t==='exchange_offers')delete r.shared_alias;return r;});
      assert.deepEqual(after,before[t],`${t}: existing rows kept`);
    }
    const profiles=db.prepare('SELECT * FROM exchange_profiles ORDER BY household_id').all();
    assert.equal(profiles.length,2);
    for(const p of profiles){assert.equal(p.visibility,'neighborhood');assert.equal(p.country,'');assert.match(p.family_ref,/^family_[a-f0-9]{20}$/);}
    assert.notEqual(profiles[0].family_ref,profiles[1].family_ref);
    db.close();db=openDatabase(file);
    assert.deepEqual(db.prepare('SELECT * FROM exchange_profiles ORDER BY household_id').all(),profiles);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
