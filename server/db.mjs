import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureVillagePaymentsSchema } from './payments/village-payments.mjs';
import { ensureVaultSchema } from './vault/index.mjs';
import { ensureVillageSubscriptionsSchema } from './planner/village-subscriptions.mjs';

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
  Object.freeze({
    id: 'deferred-refunds',
    // Verified completed refunds that arrived before their capture was recorded. References and amounts only,
    // private until a validated capture binds them to an owned order; never household progress by themselves.
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS deferred_refunds (
        refund_id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deferred_refunds_capture ON deferred_refunds (capture_id, received_at, refund_id);
    `); },
  }),
  Object.freeze({
    id: 'family-choices',
    // Shared buying choices for the active goal, planning facts only. Three tables:
    // - family_choices: up to three merchant results an adult saved from this server's own shown results;
    // - family_offers: each adult's own weekly planning offer;
    // - family_preferences: each member's one preference.
    // No amount here is money, a payment, an approval or a reserved price. Removing a choice removes its preferences.
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS family_choices (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        merchant TEXT NOT NULL,
        url TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        availability TEXT,
        condition TEXT,
        selection_json TEXT NOT NULL DEFAULT '[]',
        checked_at TEXT NOT NULL,
        draft_id TEXT,
        added_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS family_choices_goal ON family_choices (goal_id, added_at);
      CREATE TABLE IF NOT EXISTS family_offers (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        weekly_cents INTEGER NOT NULL CHECK (weekly_cents > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS family_preferences (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        choice_id TEXT NOT NULL REFERENCES family_choices(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, member_id)
      );
    `); },
  }),
  Object.freeze({
    id: 'family-choice-needs',
    // Why a family choice was chosen, kept with it:
    // - the catalog category and must-haves the family set;
    // - what the catalog reported for the item when it was found, and at its latest explicit check;
    // - the planning price ceiling and date of that search.
    // Planning facts only, and NULL for an ordinary choice. No row or other column changes.
    ensure(db) { if (!hasColumn(db, 'family_choices', 'need_json')) db.exec('ALTER TABLE family_choices ADD COLUMN need_json TEXT;'); },
  }),
  Object.freeze({
    id: 'kit-lists',
    // The family's confirmed kit checklist for a goal, one row per goal: up to eight things to bring, each with how many
    // are needed, how many the family says it already has and whether it was typed or read from a photo, plus the
    // list's revision and who saved it when. Planning facts only: no price, purchase, money, photo or model answer.
    // A new table only; no existing row or column changes.
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS kit_lists (
        goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        items_json TEXT NOT NULL,
        saved_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL
      );
    `); },
  }),
  Object.freeze({
    id: 'kit-planner',
    // Comparing complete kits for the kit list. Planning facts only: no money moves, nothing is bought or reserved.
    // - kit_candidates: up to three catalog listings an adult added for one line still to get, copied from this server's
    //   own shown result. Each keeps the line it was added for (as named then), and how many items one listing gives:
    //   the adult's own count (per_listing_by), never a catalog fact.
    // - kit_selections: the family's chosen listing per line, and whether an adult kept it (kept lines stay fixed).
    // - goal_kits: the kit a goal was saved from: every line's real listing, quantity and price, and its listed total.
    // New tables only; no existing row or column changes.
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS kit_candidates (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL,
        line_name TEXT NOT NULL,
        line_needs TEXT,
        product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        merchant TEXT NOT NULL,
        url TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        availability TEXT,
        condition TEXT,
        selection_json TEXT NOT NULL DEFAULT '[]',
        weight_mg INTEGER CHECK (weight_mg IS NULL OR weight_mg > 0),
        per_listing INTEGER NOT NULL CHECK (per_listing BETWEEN 1 AND 100),
        per_listing_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        need_json TEXT,
        checked_at TEXT NOT NULL,
        draft_id TEXT,
        added_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        added_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS kit_candidates_goal ON kit_candidates (goal_id, line_id, added_at);
      CREATE TABLE IF NOT EXISTS kit_selections (
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL REFERENCES kit_candidates(id) ON DELETE CASCADE,
        kept INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1)),
        chosen_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        chosen_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, line_id)
      );
      CREATE TABLE IF NOT EXISTS goal_kits (
        goal_id TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        kit_revision INTEGER NOT NULL CHECK (kit_revision > 0),
        total_cents INTEGER NOT NULL CHECK (total_cents > 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        lines_json TEXT NOT NULL,
        goal_name TEXT NOT NULL,
        saved_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        saved_at TEXT NOT NULL
      );
    `); },
  }),
  Object.freeze({
    id: 'village-exchange',
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS exchange_circles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        owner_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS exchange_members (
        household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
        circle_id TEXT NOT NULL REFERENCES exchange_circles(id) ON DELETE CASCADE,
        alias TEXT NOT NULL, joined_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS exchange_circle_members ON exchange_members(circle_id);
      CREATE TABLE IF NOT EXISTS exchange_invites (
        id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES exchange_circles(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS exchange_requests (
        id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES exchange_circles(id) ON DELETE CASCADE,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL, item_name TEXT NOT NULL, needs TEXT, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),
        needed_until TEXT NOT NULL, note TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open', 'closed')), created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS exchange_circle_requests ON exchange_requests(circle_id, created_at);
      CREATE TABLE IF NOT EXISTS exchange_offers (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES exchange_requests(id) ON DELETE CASCADE,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100), kind TEXT NOT NULL CHECK(kind IN ('loan', 'gift')),
        return_by TEXT, note TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('offered','accepted','received','returned','withdrawn','declined')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS exchange_request_offers ON exchange_offers(request_id, status);
    `); },
  }),
  Object.freeze({
    id: 'exchange-directory',
    ensure(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS exchange_profiles (
        household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
        family_ref TEXT NOT NULL UNIQUE, alias TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'neighborhood' CHECK(visibility IN ('neighborhood','worldwide')),
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO exchange_profiles(household_id,family_ref,alias,updated_at)
        SELECT household_id, 'family_' || lower(hex(randomblob(10))), alias, joined_at FROM exchange_members;
      CREATE INDEX IF NOT EXISTS exchange_profile_visibility ON exchange_profiles(visibility);`);
      if (!hasColumn(db, 'exchange_offers', 'shared_alias')) db.exec('ALTER TABLE exchange_offers ADD COLUMN shared_alias TEXT');
    },
  }),
  Object.freeze({
    id: 'village-funds',
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS village_funds (
        id TEXT PRIMARY KEY,
        circle_id TEXT NOT NULL REFERENCES exchange_circles(id) ON DELETE RESTRICT,
        organizer_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        organizer_member_id TEXT NOT NULL,
        organizer_reference TEXT NOT NULL, organizer_alias TEXT NOT NULL,
        title TEXT NOT NULL, project_kind TEXT NOT NULL CHECK(project_kind = 'schoolhouse'),
        rail TEXT NOT NULL CHECK(rail IN ('simulated','paypal-sandbox','pyusd-devnet')),
        currency TEXT NOT NULL, decimals INTEGER NOT NULL,
        target_minor INTEGER NOT NULL CHECK(target_minor BETWEEN 1 AND 1000000000000),
        deadline TEXT NOT NULL, recipient_json TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
        published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK((rail IN ('simulated','paypal-sandbox') AND currency = 'USD' AND decimals = 2)
          OR (rail = 'pyusd-devnet' AND currency = 'PYUSD' AND decimals = 6))
      );
      CREATE INDEX IF NOT EXISTS village_fund_circle ON village_funds(circle_id, created_at);
      CREATE TABLE IF NOT EXISTS village_shares (
        fund_id TEXT NOT NULL REFERENCES village_funds(id) ON DELETE CASCADE,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        family_reference TEXT NOT NULL, alias TEXT NOT NULL,
        committed_minor INTEGER NOT NULL CHECK(committed_minor BETWEEN 0 AND 1000000000000),
        member_id TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(fund_id, household_id)
      );
      CREATE TABLE IF NOT EXISTS village_receipts (
        id TEXT PRIMARY KEY,
        fund_id TEXT NOT NULL REFERENCES village_funds(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('simulated','paypal-sandbox','pyusd-devnet')),
        event_ref TEXT NOT NULL, event_index TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('capture','transfer','refund','reversal')),
        parent_ref TEXT, parent_index TEXT,
        amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
        household_id TEXT, family_reference TEXT, alias TEXT,
        recipient_json TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
        UNIQUE(source,event_ref,event_index),
        CHECK((kind IN ('capture','transfer') AND parent_ref IS NULL AND parent_index IS NULL)
          OR (kind IN ('refund','reversal') AND parent_ref IS NOT NULL AND parent_index IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS village_receipt_fund ON village_receipts(fund_id, recorded_at);
      CREATE INDEX IF NOT EXISTS village_receipt_parent ON village_receipts(source,parent_ref,parent_index);
      CREATE TABLE IF NOT EXISTS village_presentations (
        household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
        shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1)),
        updated_at TEXT NOT NULL
      );
    `); },
  }),
  Object.freeze({
    id: 'village-payment-watchers',
    ensure(db) { ensureVillagePaymentsSchema(db); ensureVaultSchema(db); },
  }),
  Object.freeze({ id: 'village-subscriptions', ensure: ensureVillageSubscriptionsSchema }),
  Object.freeze({
    id: 'payment-holds',
    // A household contribution can be held first: PayPal authorizes the adult-approved amount and nothing is credited.
    // One row per held order. An adult later releases an exact amount of it (one final capture) or returns it (a void);
    // the decision is written here before PayPal is asked, so an unanswered request can be reconciled, never guessed.
    ensure(db) { db.exec(`
      CREATE TABLE IF NOT EXISTS payment_holds (
        order_id TEXT PRIMARY KEY REFERENCES payment_orders(id) ON DELETE CASCADE,
        authorization_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('awaiting', 'held', 'releasing', 'released', 'returning', 'returned', 'lapsed', 'failed')),
        held_cents INTEGER NOT NULL CHECK (held_cents > 0),
        release_cents INTEGER CHECK (release_cents IS NULL OR (release_cents > 0 AND release_cents <= held_cents)),
        decided_by TEXT,
        decision_request_id TEXT UNIQUE,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `); },
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
  const start = version === 5 || version === 6 ? shared : version;
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
