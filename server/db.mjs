import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const hasColumn = (db, table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
// The family access tables (step 7). Every statement is IF NOT EXISTS, so it is safe to run again.
const FAMILY_ACCESS_TABLES = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    user_handle TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
    transports TEXT NOT NULL DEFAULT '[]',
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys (account_id);
  CREATE TABLE IF NOT EXISTS memberships (
    member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
    access TEXT NOT NULL DEFAULT 'active' CHECK (access IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS memberships_household ON memberships (household_id);
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('adult', 'child')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    accepted_member_id TEXT,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS invitations_household ON invitations (household_id, created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    household_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_member ON sessions (member_id);
  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('create-family', 'accept-invite', 'sign-in', 'add-passkey')),
    challenge TEXT NOT NULL,
    flow_hash TEXT,
    session_id TEXT,
    invitation_id TEXT,
    display_name TEXT,
    user_handle TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT,
    account_id TEXT,
    member_id TEXT,
    action TEXT NOT NULL,
    subject TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_household ON audit_events (household_id, id);
  `;

// Durable local storage. One file per payment mode so simulated example entries can never mix
// with PayPal-sandbox-confirmed ones. Exported read-only so a test can build an older database and prove an upgrade.
// Steps 1–4 are the SQL main shipped and run once, in order; later steps are { id, ensure(db) } (see below).
export const MIGRATIONS = Object.freeze([
  `
  CREATE TABLE households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'family')),
    crest_field TEXT NOT NULL,
    crest_charge TEXT NOT NULL,
    is_example INTEGER NOT NULL DEFAULT 1,
    setup_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE members (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('adult', 'child')),
    is_example INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    target_date TEXT NOT NULL,
    weekly_budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (weekly_budget_cents >= 0),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  -- Goal-progress ledger. Not a bank balance. "effect" is enforced per kind so bills and gifts
  -- can never inflate saved progress, and refunds always subtract.
  CREATE TABLE ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    effect INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('user-reported', 'paypal-sandbox', 'simulated')),
    source_ref TEXT NOT NULL UNIQUE,
    member_id TEXT,
    label TEXT,
    created_at TEXT NOT NULL,
    CHECK (
      (kind IN ('starting_progress', 'contribution', 'simulated_contribution') AND effect = 1) OR
      (kind IN ('refund', 'simulated_refund') AND effect = -1) OR
      (kind IN ('bill_paid', 'gift_sent') AND effect = 0)
    )
  );
  CREATE INDEX ledger_goal ON ledger_entries(goal_id);
  CREATE TABLE payment_orders (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('paypal-sandbox', 'simulated')),
    provider_order_id TEXT UNIQUE,
    request_id TEXT NOT NULL UNIQUE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    approved_by TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE payment_captures (
    capture_id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    credited INTEGER NOT NULL DEFAULT 0,
    refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE payment_refunds (
    refund_id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL REFERENCES payment_captures(capture_id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    credited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    outcome TEXT NOT NULL
  );
  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('ai', 'rules', 'household-edited')),
    provider TEXT,
    model TEXT,
    parent_id TEXT,
    inputs_json TEXT NOT NULL,
    basis_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'superseded')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT,
    earned_at TEXT NOT NULL,
    UNIQUE (goal_id, key)
  );
  `,
  `ALTER TABLE members ADD COLUMN avatar_id TEXT;`,
  // The Channel3 item a family explicitly saved as its goal: provenance only, never money or progress.
  `
  CREATE TABLE IF NOT EXISTS goal_items (
    goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider = 'channel3'),
    product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    merchant TEXT NOT NULL,
    url TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    currency TEXT NOT NULL,
    availability TEXT,
    checked_at TEXT NOT NULL,
    goal_name TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );
  `,
  // One row per explicit "Check with PayPal" on a household order: when, what PayPal's validated order said and how the
  // server reconciled it. Compact references only; no buyer details, provider payloads or model text.
  `
  CREATE TABLE IF NOT EXISTS order_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    verdict TEXT NOT NULL,
    outcome TEXT NOT NULL,
    note TEXT NOT NULL,
    paypal_order_status TEXT,
    capture_id TEXT,
    capture_status TEXT,
    amount_cents INTEGER,
    currency TEXT,
    refund_ids TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS order_checks_order ON order_checks (order_id, id);
  `,
  // Steps 5–7 were written on three branches at the same time: goal projects and sponsor depth both called theirs 5, and
  // family access called its 6. A database that one of those branch builds opened can therefore say 5 or 6 while holding
  // a different subset of these changes. Each step below inspects the actual schema and adds only what is missing, and
  // openDatabase re-checks all of them for such a version, so every path reaches the same schema: nothing is skipped and
  // nothing is applied twice. Existing rows and columns are never changed.
  Object.freeze({
    id: 'goal-project-kind',
    // What the family chose the current goal to build in the meadow. A picture only: no amount, date, plan or progress.
    // Every existing goal keeps the campsite it has always shown.
    ensure(db) {
      if (!hasColumn(db, 'goals', 'project_kind')) db.exec("ALTER TABLE goals ADD COLUMN project_kind TEXT NOT NULL DEFAULT 'campsite' CHECK (project_kind IN ('campsite', 'garden', 'schoolhouse'));");
    },
  }),
  Object.freeze({
    id: 'merchant-selection',
    // Selected product options survive reloads so an explicit refresh cannot silently switch size/colour or condition.
    ensure(db) {
      if (!hasColumn(db, 'goal_items', 'selection_json')) db.exec("ALTER TABLE goal_items ADD COLUMN selection_json TEXT NOT NULL DEFAULT '[]';");
      if (!hasColumn(db, 'goal_items', 'condition')) db.exec('ALTER TABLE goal_items ADD COLUMN condition TEXT;');
    },
  }),
  Object.freeze({
    id: 'family-access',
    // Shared families (the opt-in family access mode). An account holds passkeys; a membership ties one account to one
    // member of one household. Sessions, invitations and ceremony challenges keep only hashes of their secrets. New
    // tables only, so the example household never has accounts.
    ensure(db) { db.exec(FAMILY_ACCESS_TABLES); },
  }),
]);

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > MIGRATIONS.length) {
    db.close();
    throw new Error(`${file} has database schema ${version}, newer than this build's ${MIGRATIONS.length}. Use the build that wrote it or a fresh data folder.`);
  }
  // Schemas 5 and 6 exist only in databases a pre-integration branch build opened, and mean different things there.
  // Re-check every step from 5 against the actual tables rather than trusting that number.
  const shared = MIGRATIONS.findIndex((step) => typeof step !== 'string');
  const start = version > shared && version < MIGRATIONS.length ? shared : version;
  if (start !== version) console.warn(`[our-castle] database schema ${version} came from a pre-integration branch build; checking steps ${shared + 1}–${MIGRATIONS.length} against its tables.`);
  for (let i = start; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      const step = MIGRATIONS[i];
      if (typeof step === 'string') db.exec(step); else step.ensure(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

/** Run `fn` atomically. Nested calls join the outer transaction. */
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/** One file per payment mode, and a separate one for family access so shared households never mix with the example. */
export function databaseFile(dataDir, paymentsMode, accessMode = 'example') {
  return path.join(dataDir, `our-castle-${accessMode === 'family' ? 'family-' : ''}${paymentsMode === 'sandbox' ? 'sandbox' : 'example'}.sqlite`);
}
