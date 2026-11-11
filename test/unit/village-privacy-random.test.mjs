import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../server/db.mjs';
import { createClock, progressFor } from '../../server/household.mjs';
import { exchangeAction } from '../../server/exchange/index.mjs';
import { publicVillageFund, recordVillageReceipt, villageAction, villageFund, villageReview, villageView } from '../../server/village/index.mjs';

// Seeded random histories of one neighborhood's shared funds: two to five families, a family outside it and a family in
// another neighborhood. Every family carries private facts that appear nowhere else (its household and member ids and
// names, its own goal, and what it has saved). After every step, everything each viewer can be shown is searched for
// every other family's private facts; shared totals are checked against the receipts; and each family's own savings
// are checked to be untouched. This is evidence about the server's views, not about the page or a real provider.
// A failure names its seed and the steps so far. VILLAGE_SEED=<n> reruns one seed; VILLAGE_SEEDS=<count> runs more.
const clock = createClock('2026-11-10T12:00:00.000Z');
const STEPS = 30;

/** mulberry32: a small seeded generator, so every history can be replayed exactly. */
function random(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (low, high) => low + Math.floor(next() * (high - low + 1)), pick: (list) => list[Math.floor(next() * list.length)], chance: (p) => next() < p };
}

/** A family whose private facts are all unmistakable: none can turn up in a view by coincidence. */
function family(db, k) {
  const f = { householdId: `hh_private${k}q`, memberId: `adult_private${k}q`, goalId: `goal_private${k}q`, role: 'adult', alias: `Neighbor ${'ABCDEFG'[k]}`,
    householdName: `Hearthname${k}q`, memberName: `Firstname${k}q`, goalName: `Owngoal${k}q`, targetCents: 5_000_011 + k * 100_003, savedCents: 3_234_567 + k * 11_113 }; // well past the first castle tiers, so a castle shown without consent would differ
  db.prepare('INSERT INTO households(id,name,play_mode,crest_field,crest_charge,setup_complete,created_at) VALUES(?,?,?,?,?,1,?)').run(f.householdId, f.householdName, 'family', 'cobalt', 'stag', clock.iso());
  db.prepare('INSERT INTO members(id,household_id,display_name,role,sort) VALUES(?,?,?,?,0)').run(f.memberId, f.householdId, f.memberName, 'adult');
  db.prepare('INSERT INTO goals(id,household_id,name,target_cents,currency,target_date,created_at) VALUES(?,?,?,?,?,?,?)').run(f.goalId, f.householdId, f.goalName, f.targetCents, 'USD', '2026-12-12', clock.iso());
  db.prepare("INSERT INTO ledger_entries(household_id,goal_id,kind,effect,amount_cents,currency,source,source_ref,created_at) VALUES(?,?,'starting_progress',1,?,'USD','user-reported',?,?)")
    .run(f.householdId, f.goalId, f.savedCents, `ledgerref_private${k}q`, clock.iso());
  f.secrets = [f.householdId, f.memberId, f.goalId, f.householdName, f.memberName, f.goalName, `ledgerref_private${k}q`, f.targetCents, f.savedCents];
  return f;
}
/** A private fact inside what a viewer was shown. A number counts only as a whole number, not as part of a longer one. */
const shows = (text, secret) => (typeof secret === 'number' ? new RegExp(`(?<!\\d)${secret}(?!\\d)`).test(text) : text.includes(secret));
/** What a call shows its caller: its answer, or the words of its refusal. */
const shown = (call) => { try { return call(); } catch (error) { if (!Number.isInteger(error?.status)) throw error; return { refused: error.code, message: error.message }; } };

function history(seed) {
  const rng = random(seed), db = openDatabase(':memory:'), log = [];
  const label = () => `seed ${seed}: ${log.join(' → ')}`;
  const neighbors = Array.from({ length: rng.int(2, 5) }, (_, k) => family(db, k));
  const outsider = family(db, 5), elsewhere = family(db, 6), everyone = [...neighbors, outsider, elsewhere];
  const exchange = (scope, action, input = {}) => exchangeAction(db, { scope, actor: scope, action, input }, clock);
  const act = (scope, action, input = {}) => villageAction(db, { scope, actor: scope, action, input }, clock);
  const [organizer] = neighbors;
  exchange(organizer, 'create', { name: 'Random neighbors', alias: organizer.alias });
  for (const n of neighbors.slice(1)) exchange(n, 'join', { token: exchange(organizer, 'invite').invitation.token, alias: n.alias, confirmed: true });
  // A second neighborhood with its own fund: nothing of either may cross to the other.
  exchange(elsewhere, 'create', { name: 'Another street', alias: elsewhere.alias });
  const theirFund = act(elsewhere, 'create', { title: 'Their own project', targetMinor: 7000, deadline: '2026-12-12', rail: 'simulated', confirmed: true }).fundId;

  // What the test itself knows to be true, kept apart from the server's records.
  const funds = [], sharing = new Map(neighbors.map((n) => [n.householdId, false]));
  let events = 0;
  const revision = (fund) => db.prepare('SELECT revision FROM village_funds WHERE id = ?').get(fund.id).revision;
  // A refusal by the server's own rules is an ordinary answer; anything else thrown ends the history.
  const attempt = (name, run, then = () => {}) => {
    try { const out = run(); then(out); log.push(name); return true; } catch (error) {
      if (!Number.isInteger(error?.status)) throw new Error(`${label()} → ${name} threw ${error?.stack ?? error}`);
      log.push(`${name}!${error.code}`); return false;
    }
  };

  function check() {
    const about = label();
    for (const viewer of everyone) {
      const member = neighbors.includes(viewer), view = villageView(db, viewer);
      const seen = JSON.stringify([view, ...funds.flatMap((f) => [shown(() => villageFund(db, viewer, f.id)), shown(() => villageReview(db, viewer, f.id))]), shown(() => villageFund(db, viewer, theirFund))]);
      // 1. Nobody is shown another family's private facts, whatever was shared, published, committed or paid.
      for (const other of everyone) if (other !== viewer) for (const secret of other.secrets) assert.ok(!shows(seen, secret), `${viewer.alias} is shown ${other.alias}'s ${secret} — ${about}`);
      if (!member) {
        // 2. A family outside the neighborhood sees none of its funds, families, shares or receipts.
        assert.ok(!view.funds.some((f) => funds.some((mine) => mine.id === f.id)), `an outside family lists this neighborhood's funds — ${about}`);
        for (const f of funds) {
          assert.ok(shown(() => villageFund(db, viewer, f.id)).refused, `an outside family opens a fund — ${about}`);
          const review = shown(() => villageReview(db, viewer, f.id));
          if (!f.published) assert.ok(review.refused, `an unpublished fund is reviewed from outside — ${about}`);
          else assert.deepEqual([review.shares, review.receipts, review.canManage, review.viewerMember], [[], [], false, false], `an outside family is shown a published fund's shares or receipts — ${about}`);
          for (const n of neighbors) if (n !== organizer) assert.ok(!JSON.stringify(review).includes(n.alias), `an outside family is shown a neighbor's alias — ${about}`);
        }
        continue;
      }
      // 3. A neighbor's castle is shown only if that family chose to share it.
      for (const shownNeighbor of view.members) {
        const who = neighbors.find((n) => n.alias === shownNeighbor.alias);
        if (!sharing.get(who.householdId)) assert.deepEqual([shownNeighbor.tier, shownNeighbor.crest, shownNeighbor.shared], [0, null, false], `an unshared castle is shown — ${about}`);
      }
      for (const f of funds) {
        // 4. The shared total is exactly its receipts, and each family's share is what that family itself committed and paid.
        const fund = view.funds.find((candidate) => candidate.id === f.id);
        const net = [...f.captures.values()].reduce((sum, c) => sum + c.amount - Math.min(c.refunded, c.amount), 0);
        assert.equal(fund.progress.netMinor, net, `the shared total is its receipts — ${about}`);
        for (const n of neighbors) {
          const share = fund.shares.find((s) => s.alias === n.alias);
          const paid = [...f.captures.values()].filter((c) => c.family === n).reduce((sum, c) => sum + c.amount - Math.min(c.refunded, c.amount), 0);
          assert.deepEqual([share.committedMinor, share.paidMinor], [f.committed.get(n) ?? 0, paid], `${n.alias}'s share is its own — ${about}`);
        }
        assert.equal(fund.canManage, viewer === organizer, about);
      }
    }
    for (const f of funds) {
      // 5. The view by link exists only while published, and names no family but the organizer's chosen alias.
      const open = shown(() => publicVillageFund(db, f.id));
      if (!f.published) { assert.equal(open.refused, 'village_fund', about); continue; }
      for (const key of ['shares', 'receipts', 'members', 'familyReference', 'recipient']) assert.ok(!(key in open), `the view by link has ${key} — ${about}`);
      for (const other of everyone) for (const secret of other.secrets) assert.ok(!shows(JSON.stringify(open), secret), `the view by link shows ${other.alias}'s ${secret} — ${about}`);
    }
    // 6. No village step ever moves a family's own savings.
    for (const who of everyone) assert.equal(progressFor(db, who.goalId).progressCents, who.savedCents, `${who.alias}'s own savings moved — ${about}`);
  }

  check();
  for (let step = 0; step < STEPS; step++) {
    const who = rng.pick(neighbors), fund = funds.length ? rng.pick(funds) : null;
    const action = !fund || (funds.length < 3 && rng.chance(0.1)) ? 'create' : rng.pick(['share', 'share', 'others-share', 'castle', 'publish', 'publish-by-other', 'capture', 'capture', 'unmatched', 'refund', 'replay', 'close', 'own-savings']);
    if (action === 'create') {
      const targetMinor = rng.int(1, 50) * 1000;
      attempt('create', () => act(organizer, 'create', { title: `Shared project ${funds.length + 1}`, targetMinor, deadline: '2026-12-12', rail: 'simulated', confirmed: true }),
        (out) => funds.push({ id: out.fundId, targetMinor, published: false, committed: new Map(), captures: new Map() }));
    } else if (action === 'share') {
      const committedMinor = rng.int(0, fund.targetMinor);
      attempt(`${who.alias} commits ${committedMinor}`, () => act(who, 'share', { fundId: fund.id, expectedRevision: revision(fund), committedMinor, confirmed: true }), () => fund.committed.set(who, committedMinor));
    } else if (action === 'others-share') {
      // Naming another family's share is refused outright, even by the organizer.
      const other = rng.pick(neighbors.filter((n) => n !== who));
      const done = attempt(`${who.alias} tries to set ${other.alias}'s share`, () => act(who, 'share', { fundId: fund.id, expectedRevision: revision(fund), committedMinor: 1, householdId: other.householdId, confirmed: true }));
      assert.equal(done, false, `another family's share was set — ${label()}`);
    } else if (action === 'castle') {
      const shared = rng.chance(0.5);
      attempt(`${who.alias} ${shared ? 'shares' : 'hides'} its castle`, () => act(who, 'share-castle', { shared, confirmed: true }), () => sharing.set(who.householdId, shared));
    } else if (action === 'publish') {
      const published = rng.chance(0.6);
      attempt(published ? 'publish' : 'unpublish', () => act(organizer, 'publish', { fundId: fund.id, expectedRevision: revision(fund), published, confirmed: true }), () => { fund.published = published; });
    } else if (action === 'publish-by-other' && who !== organizer) {
      const done = attempt(`${who.alias} tries to publish`, () => act(who, 'publish', { fundId: fund.id, expectedRevision: revision(fund), published: true, confirmed: true }));
      assert.equal(done, false, `a fund was published by a family that does not organize it — ${label()}`);
    } else if (action === 'capture' || action === 'unmatched') {
      const amount = rng.int(1, 30) * 100, eventRef = `event_${seed}_${++events}`, from = action === 'capture' ? who : null;
      attempt(`${from?.alias ?? 'nobody known'} pays ${amount}`, () => recordVillageReceipt(db, { fundId: fund.id, source: 'simulated', eventRef, kind: 'capture', amountMinor: amount, familyHouseholdId: from?.householdId ?? null, recipient: null }, clock),
        () => fund.captures.set(eventRef, { amount, family: from, refunded: 0 }));
    } else if (action === 'refund' && fund.captures.size) {
      const [parentRef, capture] = rng.pick([...fund.captures]), amount = rng.int(1, 35) * 100; // sometimes more than was paid
      attempt(`refund ${amount} of ${capture.amount}`, () => recordVillageReceipt(db, { fundId: fund.id, source: 'simulated', eventRef: `event_${seed}_${++events}`, kind: 'refund', amountMinor: amount, parentRef, parentIndex: '0',
        familyHouseholdId: capture.family?.householdId ?? null, recipient: null }, clock), () => { capture.refunded += amount; });
    } else if (action === 'replay' && fund.captures.size) {
      // The same provider event delivered again changes nothing.
      const [eventRef, capture] = rng.pick([...fund.captures]);
      attempt('same receipt again', () => recordVillageReceipt(db, { fundId: fund.id, source: 'simulated', eventRef, kind: 'capture', amountMinor: capture.amount, familyHouseholdId: capture.family?.householdId ?? null, recipient: null }, clock));
    } else if (action === 'close' && rng.chance(0.2)) {
      attempt('close', () => act(organizer, 'close', { fundId: fund.id, expectedRevision: revision(fund), confirmed: true }));
    } else if (action === 'own-savings') {
      // A family's own savings change. Neighbors must still see nothing of it.
      const more = rng.int(1, 9) * 1111;
      db.prepare("INSERT INTO ledger_entries(household_id,goal_id,kind,effect,amount_cents,currency,source,source_ref,created_at) VALUES(?,?,'simulated_contribution',1,?,'USD','simulated',?,?)")
        .run(who.householdId, who.goalId, more, `ledgerref_private_more_${seed}_${step}`, clock.iso());
      who.savedCents += more;
      who.secrets[who.secrets.length - 1] = who.savedCents;
      log.push(`${who.alias} saves more of its own`);
    }
    check();
  }
  if (process.env.VILLAGE_SEED) console.log(label());
  db.close();
}

const seeds = process.env.VILLAGE_SEED ? [Number(process.env.VILLAGE_SEED)] : Array.from({ length: Number(process.env.VILLAGE_SEEDS ?? 60) }, (_, i) => i + 1);

test('random village histories: no family is shown another family’s private facts, shared totals are exactly their receipts, and own savings never move', () => {
  for (const seed of seeds) history(seed);
});
