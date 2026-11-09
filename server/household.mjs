import { randomUUID } from 'node:crypto';
import { avatarById, memberAvatar } from '../src/core/avatars.js';
import { transaction } from './db.mjs';
import { CREST_CHARGES, CREST_FIELDS, CURRENCY, TIERS, formatCents, milestoneCents } from '../src/core/rules.js';
import { ESTATE_MILESTONES } from '../src/core/rewards.js';
import { DEFAULT_PROJECT_KIND, isProjectKind } from '../src/core/family-project.js';

export const DEMO_HOUSEHOLD_ID = 'hh_demo';
export const DEMO_GOAL_ID = 'goal_demo';

// Synthetic, clearly labeled example defaults (editable). Not anyone's real finances.
export const EXAMPLE_DEFAULTS = Object.freeze({
  householdName: 'House of Alder',
  crest: Object.freeze({ field: 'cobalt', charge: 'stag' }),
  goalName: 'Camping trip fund',
  targetCents: 30000,
  startingCents: 6000,
  weeklyBudgetCents: 3000,
  weeks: 8,
  members: Object.freeze({
    solo: Object.freeze([{ id: 'm_rowan', name: 'Rowan', role: 'adult' }]),
    family: Object.freeze([
      { id: 'm_rowan', name: 'Rowan', role: 'adult' },
      { id: 'm_wren', name: 'Wren', role: 'child' },
    ]),
  }),
});

export class DomainError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const newId = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

export function createClock(fixed) {
  return {
    now: () => (fixed ? new Date(fixed) : new Date()),
    iso() { return this.now().toISOString(); },
    /** Local calendar date (YYYY-MM-DD) of the server. */
    today() {
      const d = this.now();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  };
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(toIso) - parse(fromIso)) / 86400000);
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const householdFromRow = (row) => row && ({
  id: row.id,
  name: row.name,
  playMode: row.play_mode,
  crest: { field: row.crest_field, charge: row.crest_charge },
  isExample: Boolean(row.is_example),
  setupComplete: Boolean(row.setup_complete),
  createdAt: row.created_at,
});
const goalFromRow = (row) => row && ({
  id: row.id,
  householdId: row.household_id,
  name: row.name,
  targetCents: row.target_cents,
  currency: row.currency,
  targetDate: row.target_date,
  weeklyBudgetCents: row.weekly_budget_cents,
  projectKind: isProjectKind(row.project_kind) ? row.project_kind : DEFAULT_PROJECT_KIND,
  status: row.status,
  createdAt: row.created_at,
});

export function getHousehold(db, id) {
  return householdFromRow(db.prepare('SELECT * FROM households WHERE id = ?').get(id));
}
export function getMembers(db, householdId) {
  return db.prepare('SELECT * FROM members WHERE household_id = ? ORDER BY sort').all(householdId)
    .map((r) => ({ id: r.id, name: r.display_name, role: r.role, isExample: Boolean(r.is_example), avatarId: memberAvatar({ avatarId: r.avatar_id }, r.sort).id }));
}
export function getMember(db, householdId, memberId) {
  return getMembers(db, householdId).find((m) => m.id === memberId) ?? null;
}
export function getGoal(db, goalId) {
  return goalFromRow(db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId));
}
export function getActiveGoal(db, householdId) {
  return goalFromRow(db.prepare("SELECT * FROM goals WHERE household_id = ? AND status = 'active' ORDER BY created_at LIMIT 1").get(householdId));
}

/**
 * Create the single local example household on first run. Idempotent. `defaults` is EXAMPLE_DEFAULTS unless an authored
 * example (scripts/family-trip.mjs) starts the household from its own invented figures and members.
 */
export function ensureDemoHousehold(db, clock, defaults = EXAMPLE_DEFAULTS) {
  if (getHousehold(db, DEMO_HOUSEHOLD_ID)) {
    // Backfill cosmetic additions for an existing goal, without changing financial records.
    const goal = getActiveGoal(db, DEMO_HOUSEHOLD_ID);
    if (goal) awardTierMilestones(db, goal, clock.iso());
    return;
  }
  transaction(db, () => {
    const at = clock.iso();
    const d = defaults;
    db.prepare(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at)
      VALUES (?, ?, 'family', ?, ?, 1, 0, ?)`).run(DEMO_HOUSEHOLD_ID, d.householdName, d.crest.field, d.crest.charge, at);
    insertMembers(db, DEMO_HOUSEHOLD_ID, d.members.family);
    db.prepare(`INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, d.goalName, d.targetCents, CURRENCY, addDays(clock.today(), d.weeks * 7), d.weeklyBudgetCents, at);
    setStartingProgress(db, getGoal(db, DEMO_GOAL_ID), d.startingCents, at, 'Example starting progress (user-reported)');
  });
}

// Set the example household's members. A member who stays keeps their row, and with it every planning record that names
// them (weekly offers, the kit list, kit listings and choices all cascade from it): deleting and re-adding everyone erased
// those records on any house or crest save. Only a member who leaves is removed, and their own records with them.
function insertMembers(db, householdId, members) {
  const current = new Map(getMembers(db, householdId).map((m) => [m.id, m.avatarId]));
  const staying = new Set(members.map((m) => m.id));
  const remove = db.prepare('DELETE FROM members WHERE id = ? AND household_id = ?');
  for (const id of current.keys()) if (!staying.has(id)) remove.run(id, householdId);
  const insert = db.prepare('INSERT INTO members (id, household_id, display_name, role, is_example, sort, avatar_id) VALUES (?, ?, ?, ?, 1, ?, NULL)');
  const update = db.prepare('UPDATE members SET display_name = ?, role = ?, is_example = 1, sort = ?, avatar_id = ? WHERE id = ? AND household_id = ?');
  members.forEach((m, i) => (current.has(m.id) ? update.run(m.name, m.role, i, current.get(m.id), m.id, householdId) : insert.run(m.id, householdId, m.name, m.role, i)));
}

/** Change one existing member's appearance; no identity, role or financial mutation. */
export function updateMemberAvatar(db, householdId, memberId, avatarId) {
  if (!getMember(db, householdId, memberId)) throw new DomainError(404, 'not_found', 'Family member not found.');
  if (!avatarById(avatarId)) throw new DomainError(400, 'invalid_avatar', 'Choose one of the listed avatars.');
  db.prepare('UPDATE members SET avatar_id = ? WHERE id = ? AND household_id = ?').run(avatarId, memberId, householdId);
  return getMember(db, householdId, memberId);
}

export function hasPaymentHistory(db, householdId) {
  return Boolean(db.prepare("SELECT 1 FROM payment_orders WHERE household_id = ? AND status NOT IN ('creating', 'failed') LIMIT 1").get(householdId));
}

export function validateCrest(crest) {
  if (!crest || !Object.hasOwn(CREST_FIELDS, crest.field) || !Object.hasOwn(CREST_CHARGES, crest.charge)) {
    throw new DomainError(400, 'invalid_crest', 'Choose one of the listed crest colors and charges.');
  }
  return { field: crest.field, charge: crest.charge };
}

export function validateHouseholdName(name) {
  const value = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (value.length < 2 || value.length > 40) throw new DomainError(400, 'invalid_name', 'House names need 2–40 characters.');
  return value;
}

/** Choose solo or family example members (from `defaults`), name the house and choose a crest. */
export function setupHousehold(db, householdId, { playMode, name, crest }, defaults = EXAMPLE_DEFAULTS) {
  if (!['solo', 'family'].includes(playMode)) throw new DomainError(400, 'invalid_mode', 'Choose solo or family.');
  const cleanName = validateHouseholdName(name);
  const cleanCrest = validateCrest(crest);
  const household = getHousehold(db, householdId);
  if (!household) throw new DomainError(404, 'not_found', 'Household not found.');
  if (household.playMode !== playMode && hasPaymentHistory(db, householdId)) {
    throw new DomainError(409, 'members_locked', 'Members can’t change after a contribution has been recorded.');
  }
  transaction(db, () => {
    db.prepare('UPDATE households SET name = ?, play_mode = ?, crest_field = ?, crest_charge = ?, setup_complete = 1 WHERE id = ?')
      .run(cleanName, playMode, cleanCrest.field, cleanCrest.charge, householdId);
    insertMembers(db, householdId, defaults.members[playMode]);
  });
  return getHousehold(db, householdId);
}

export function updateCrest(db, householdId, { name, crest }) {
  const cleanCrest = validateCrest(crest);
  const cleanName = name === undefined ? getHousehold(db, householdId).name : validateHouseholdName(name);
  db.prepare('UPDATE households SET name = ?, crest_field = ?, crest_charge = ? WHERE id = ?').run(cleanName, cleanCrest.field, cleanCrest.charge, householdId);
  return getHousehold(db, householdId);
}

/**
 * Found a shared family's house: its name and crest. Unlike the example setup, members are never replaced or invented;
 * they are the people who enrolled their own passkeys.
 */
export function setupFamilyHouse(db, householdId, { name, crest }) {
  const cleanName = validateHouseholdName(name);
  const cleanCrest = validateCrest(crest);
  const changes = db.prepare('UPDATE households SET name = ?, crest_field = ?, crest_charge = ?, setup_complete = 1 WHERE id = ? AND is_example = 0')
    .run(cleanName, cleanCrest.field, cleanCrest.charge, householdId).changes;
  if (changes !== 1) throw new DomainError(404, 'not_found', 'Household not found.');
  return getHousehold(db, householdId);
}

export function setStartingProgress(db, goal, cents, at, label = 'Starting progress (user-reported)') {
  const ref = `starting:${goal.id}`;
  db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, label, created_at)
    VALUES (?, ?, 'starting_progress', 1, ?, ?, 'user-reported', ?, ?, ?)
    ON CONFLICT(source_ref) DO UPDATE SET amount_cents = excluded.amount_cents, label = excluded.label`)
    .run(goal.householdId, goal.id, cents, goal.currency, ref, label, at);
}

/** One of the listed meadow projects, or a clean refusal before anything is written. */
export function validateProjectKind(kind) {
  if (!isProjectKind(kind)) throw new DomainError(400, 'invalid_project', 'Choose Campsite, Garden or Schoolhouse.');
  return kind;
}

/**
 * Change only what the current goal builds in the meadow. It is a picture: the amount, date, weekly amount, starting
 * report, plans (the accepted one included), milestones and ledger are untouched, and nothing is sent to a provider.
 */
export function updateGoalProject(db, goalId, kind) {
  const goal = getGoal(db, goalId);
  if (!goal) throw new DomainError(404, 'not_found', 'Goal not found.');
  const projectKind = validateProjectKind(kind);
  db.prepare('UPDATE goals SET project_kind = ? WHERE id = ?').run(projectKind, goalId);
  return getGoal(db, goalId);
}

/**
 * Edit the goal. Starting progress is the household's own report and stays labeled as such. `projectKind` is optional:
 * left out, the goal keeps what it builds; given, it must be a listed choice and is saved with the rest or not at all.
 */
export function updateGoal(db, goalId, input, clock) {
  const goal = getGoal(db, goalId);
  if (!goal) throw new DomainError(404, 'not_found', 'Goal not found.');
  const projectKind = input.projectKind === undefined ? goal.projectKind : validateProjectKind(input.projectKind);
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 60) throw new DomainError(400, 'invalid_goal', 'Goal names need 2–60 characters.');
  const { targetCents, startingCents, weeklyBudgetCents, targetDate } = input;
  if (!Number.isSafeInteger(targetCents) || targetCents < 100 || targetCents > 10_000_000) {
    throw new DomainError(400, 'invalid_goal', 'Goal amounts must be between $1.00 and $100,000.00.');
  }
  if (!Number.isSafeInteger(startingCents) || startingCents < 0 || startingCents > targetCents) {
    throw new DomainError(400, 'invalid_goal', 'Starting progress must be between $0.00 and the goal amount.');
  }
  if (!Number.isSafeInteger(weeklyBudgetCents) || weeklyBudgetCents < 0 || weeklyBudgetCents > targetCents) {
    throw new DomainError(400, 'invalid_goal', 'The weekly amount must be between $0.00 and the goal amount.');
  }
  const today = clock.today();
  if (!isIsoDate(targetDate) || daysBetween(today, targetDate) < 7 || daysBetween(today, targetDate) > 366) {
    throw new DomainError(400, 'invalid_goal', 'Choose a target date between one week and one year from today.');
  }
  transaction(db, () => {
    db.prepare('UPDATE goals SET name = ?, target_cents = ?, target_date = ?, weekly_budget_cents = ?, project_kind = ? WHERE id = ?')
      .run(name, targetCents, targetDate, weeklyBudgetCents, projectKind, goalId);
    setStartingProgress(db, goal, startingCents, clock.iso());
    // Changing the goal changes the arithmetic: earlier plans no longer apply.
    db.prepare("UPDATE plans SET status = 'superseded' WHERE goal_id = ? AND status != 'superseded'").run(goalId);
    // A smaller goal can mean milestones are now met by progress the household already has.
    awardTierMilestones(db, getGoal(db, goalId), clock.iso());
  });
  return getGoal(db, goalId);
}

/** Current tracked goal progress from the ledger, with categories kept separate. */
export function progressFor(db, goalId) {
  const rows = db.prepare('SELECT kind, effect, SUM(amount_cents) AS total, COUNT(*) AS count FROM ledger_entries WHERE goal_id = ? GROUP BY kind, effect').all(goalId);
  const by = Object.fromEntries(rows.map((r) => [r.kind, { total: r.total, count: r.count }]));
  const t = (k) => by[k]?.total ?? 0;
  const progressCents = rows.reduce((sum, r) => sum + r.effect * r.total, 0);
  return {
    startingCents: t('starting_progress'),
    contributedCents: t('contribution'),
    refundedCents: t('refund'),
    simulatedContributedCents: t('simulated_contribution'),
    simulatedRefundedCents: t('simulated_refund'),
    confirmedNetCents: t('contribution') - t('refund') + t('simulated_contribution') - t('simulated_refund'),
    progressCents,
    bills: { count: by.bill_paid?.count ?? 0, totalCents: t('bill_paid') },
    gifts: { count: by.gift_sent?.count ?? 0, totalCents: t('gift_sent') },
  };
}

/**
 * Commemorate every tier the current progress reaches. Awards are permanent keepsakes:
 * a later refund lowers current progress (and the token) but does not demolish the house.
 */
export function awardTierMilestones(db, goal, at) {
  const { progressCents } = progressFor(db, goal.id);
  const awarded = [];
  const insert = db.prepare(`INSERT INTO achievements (household_id, goal_id, key, label, detail, earned_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(goal_id, key) DO NOTHING`);
  for (const tier of TIERS.slice(1)) {
    const threshold = milestoneCents(goal.targetCents, tier.percent);
    if (progressCents >= threshold) {
      const result = insert.run(goal.householdId, goal.id, `tier:${tier.index}`, `${tier.name} raised`,
        `${tier.percent}% of ${goal.name} reached (${formatCents(threshold, goal.currency)} tracked).`, at);
      if (result.changes) awarded.push(tier.index);
    }
  }
  for (const reward of ESTATE_MILESTONES) {
    if (progressCents >= milestoneCents(goal.targetCents, reward.percent)) {
      insert.run(goal.householdId, goal.id, `estate:${reward.key}`, reward.name,
        `${reward.percent}% of the tracked goal reached. ${reward.detail} Goal progress may include reported starting savings.`, at);
    }
  }
  return awarded;
}

const SELF_REPORTED = {
  bill_paid: { label: 'Bill paid on time', maxGardens: 4 },
  gift_sent: { label: 'Gift sent' },
};

/** Bills and gifts are recorded for the household's own tracking and never count toward savings. */
export function addSelfReportedEntry(db, { householdId, goalId, kind, amountCents, label, memberId }, clock) {
  if (!Object.hasOwn(SELF_REPORTED, kind)) throw new DomainError(400, 'invalid_kind', 'Choose “bill paid” or “gift sent”.');
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 10_000_000) {
    throw new DomainError(400, 'invalid_amount', 'Amounts must be between $0.00 and $100,000.00.');
  }
  const cleanLabel = typeof label === 'string' ? label.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (cleanLabel.length < 2) throw new DomainError(400, 'invalid_label', 'Add a short description, like “Internet bill”.');
  const goal = getGoal(db, goalId);
  if (!goal || goal.householdId !== householdId) throw new DomainError(404, 'not_found', 'Goal not found.');
  if (memberId && !getMember(db, householdId, memberId)) throw new DomainError(400, 'invalid_member', 'Unknown household member.');
  return transaction(db, () => {
    const at = clock.iso();
    db.prepare(`INSERT INTO ledger_entries (household_id, goal_id, kind, effect, amount_cents, currency, source, source_ref, member_id, label, created_at)
      VALUES (?, ?, ?, 0, ?, ?, 'user-reported', ?, ?, ?, ?)`)
      .run(householdId, goalId, kind, amountCents, goal.currency, newId(kind), memberId ?? null, cleanLabel, at);
    const awarded = [];
    if (kind === 'bill_paid') {
      const { count } = db.prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE goal_id = ? AND kind = 'bill_paid'").get(goalId);
      const insert = db.prepare(`INSERT INTO achievements (household_id, goal_id, key, label, detail, earned_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(goal_id, key) DO NOTHING`);
      for (let n = 1; n <= Math.min(count, SELF_REPORTED.bill_paid.maxGardens); n++) {
        const r = insert.run(householdId, goalId, `garden:${n}`, `Garden bed ${n} planted`,
          'A bill-paying habit you reported. Habits grow gardens; they are not counted as savings.', at);
        if (r.changes) awarded.push(`garden:${n}`);
      }
    }
    return { awarded };
  });
}

export function getAchievements(db, goalId) {
  return db.prepare('SELECT key, label, detail, earned_at FROM achievements WHERE goal_id = ? ORDER BY id').all(goalId)
    .map((r) => ({ key: r.key, label: r.label, detail: r.detail, earnedAt: r.earned_at }));
}

export function builtTier(achievements) {
  return achievements.reduce((max, a) => (a.key.startsWith('tier:') ? Math.max(max, Number(a.key.slice(5))) : max), 0);
}

export function gardenCount(achievements) {
  return achievements.filter((a) => a.key.startsWith('garden:')).length;
}

export function ledgerEntries(db, goalId) {
  return db.prepare('SELECT * FROM ledger_entries WHERE goal_id = ? ORDER BY id').all(goalId).map((r) => ({
    id: r.id,
    kind: r.kind,
    effect: r.effect,
    amountCents: r.amount_cents,
    currency: r.currency,
    source: r.source,
    sourceRef: r.source_ref,
    memberId: r.member_id,
    label: r.label,
    createdAt: r.created_at,
  }));
}

/** Delete local example data and re-seed. Used by the reset script/tests only. */
export function resetHousehold(db, clock, defaults = EXAMPLE_DEFAULTS) {
  transaction(db, () => {
    for (const table of ['deferred_refunds', 'webhook_events', 'payment_refunds', 'payment_captures', 'payment_orders', 'achievements', 'plans', 'ledger_entries', 'goals', 'members', 'households']) {
      db.exec(`DELETE FROM ${table}`);
    }
  });
  ensureDemoHousehold(db, clock, defaults);
}
