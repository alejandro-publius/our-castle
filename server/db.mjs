import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Durable local storage. One file per payment mode so simulated example entries can never mix
// with PayPal-sandbox-confirmed ones. Exported read-only so a test can build an older database and prove an upgrade.
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
  // What the family chose the current goal to build in the meadow. A picture only: no amount, date, plan or progress.
  // Every existing goal keeps the campsite it has always shown.
  `ALTER TABLE goals ADD COLUMN project_kind TEXT NOT NULL DEFAULT 'campsite' CHECK (project_kind IN ('campsite', 'garden', 'schoolhouse'));`,
]);

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
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

export function databaseFile(dataDir, paymentsMode) {
  return path.join(dataDir, `our-castle-${paymentsMode === 'sandbox' ? 'sandbox' : 'example'}.sqlite`);
}
