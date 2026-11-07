import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openDatabase } from '../../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, progressFor } from '../../server/household.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { SnapshotError, snapshotDatabase } from '../../scripts/snapshot.mjs';
import { webhookHeaders } from '../helpers/fake-paypal.mjs';
import { familyWith, startServer, tokenOf } from '../helpers/family-http.mjs';
import { contribution, setupDomain } from '../helpers/setup.mjs';

// Snapshots of real Our Castle databases in fresh temporary folders: example and fake-sandbox data, plus one family
// fixture served in-process. Every snapshot is reopened only as a new, disposable file. No provider or owner data.
const script = fileURLToPath(new URL('../../scripts/snapshot.mjs', import.meta.url));
const run = promisify(execFile);
const owner = { householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };

async function inFolder(body) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'our-castle-snapshot-test-')));
  try { await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const rows = (db, sql) => db.prepare(sql).all().map((row) => ({ ...row }));
// Every row of every table, to show that a source's logical state did not change.
const fingerprint = (db) => JSON.stringify(rows(db, "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map(({ name }) => [name, rows(db, `SELECT * FROM "${name}" ORDER BY rowid`)]));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const partials = (dir) => readdirSync(dir).filter((name) => name.includes('.partial'));
const refused = (pattern) => (error) => error instanceof SnapshotError && pattern.test(error.message);

test('a snapshot taken while the app writes keeps committed WAL content and leaves the source as it was', () => inFolder(async (dir) => {
  const source = path.join(dir, 'our-castle-example.sqlite');
  const env = setupDomain({ file: source, mode: 'example' });
  try {
    // Keep the contribution in the WAL, where a running app's recent commits are. Copying the main file alone misses it.
    env.db.exec('PRAGMA wal_autocheckpoint = 0; PRAGMA wal_checkpoint(TRUNCATE);');
    const paid = contribution();
    assert.equal(env.service.simulateContribution(paid).outcome, 'completed');
    assert.equal(progressFor(env.db, DEMO_GOAL_ID).progressCents, 7500);
    const walBytes = statSync(`${source}-wal`).size;
    assert.ok(walBytes > 0);
    copyFileSync(source, path.join(dir, 'main-file-only.sqlite'));
    const stale = new DatabaseSync(path.join(dir, 'main-file-only.sqlite'), { readOnly: true });
    assert.equal(progressFor(stale, DEMO_GOAL_ID).progressCents, 6000, 'the main file alone lacks the committed contribution');
    stale.close();

    const before = [fingerprint(env.db), sha256(source)];
    const destination = path.join(dir, 'snapshot.sqlite');
    const summary = await snapshotDatabase({ source, destination });
    assert.deepEqual([fingerprint(env.db), sha256(source)], before, 'the source was neither changed nor checkpointed');
    assert.equal(statSync(`${source}-wal`).size, walBytes, 'its WAL is still in place');
    assert.equal(summary.destination, destination);
    assert.equal(summary.schema, 7);
    assert.deepEqual(summary.rows, { households: 1, ledger_entries: 2, payment_orders: 1, payment_captures: 1 });
    assert.equal(statSync(destination).mode & 0o777, 0o600, 'household data is private to its owner');
    assert.deepEqual(partials(dir), []);

    // Recovery: reopened as the app opens a database, the snapshot has exactly the committed, still-simulated records,
    // and the same request is recognised rather than credited twice.
    const recovered = openDatabase(destination);
    try {
      assert.equal(progressFor(recovered, DEMO_GOAL_ID).progressCents, 7500);
      assert.deepEqual(rows(recovered, 'SELECT provider, status, amount_cents FROM payment_orders'), [{ provider: 'simulated', status: 'completed', amount_cents: 1500 }]);
      assert.deepEqual(rows(recovered, 'SELECT kind, source FROM ledger_entries ORDER BY rowid'), [{ kind: 'starting_progress', source: 'user-reported' }, { kind: 'simulated_contribution', source: 'simulated' }]);
      const service = createContributionService({ db: recovered, clock: env.clock, mode: 'example' });
      assert.equal(service.simulateContribution(paid).outcome, 'already_processed');
      assert.equal(progressFor(recovered, DEMO_GOAL_ID).progressCents, 7500);
      assert.equal(rows(recovered, 'SELECT credited FROM payment_captures WHERE credited = 1').length, 1);
    } finally { recovered.close(); }
  } finally { env.db.close(); }
}));

test('a sandbox receipt, its capture and saved check survive, and a repeated delivery after reopening credits nothing more', () => inFolder(async (dir) => {
  const source = path.join(dir, 'our-castle-sandbox.sqlite');
  const env = setupDomain({ file: source, mode: 'sandbox' }); // the stateful fake PayPal; no network
  try {
    const { orderId } = await env.service.createPayPalOrder(contribution());
    assert.equal((await env.service.capturePayPalOrder({ providerOrderId: orderId, ...owner })).outcome, 'completed');
    await env.service.refreshPayPalOrder({ providerOrderId: orderId, ...owner }); // the saved "Check with PayPal"
    const capture = structuredClone(env.fake.orders.get(orderId).purchase_units[0].payments.captures[0]);
    const event = { id: 'WH-SNAPSHOT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { ...capture, supplementary_data: { related_ids: { order_id: orderId } } } };
    const deliver = (service, body) => service.handleWebhook({ headers: webhookHeaders, rawBody: JSON.stringify(body) });
    assert.equal((await deliver(env.service, event)).outcome, 'already_completed');
    const receipt = (db) => ({
      orders: rows(db, 'SELECT provider, status, amount_cents FROM payment_orders'),
      captures: rows(db, 'SELECT capture_id, status, credited, amount_cents FROM payment_captures'),
      credits: rows(db, "SELECT kind, source, amount_cents FROM ledger_entries WHERE kind = 'contribution'"),
      checks: rows(db, 'SELECT checked_at, verdict, outcome, note, capture_id FROM order_checks'),
      events: rows(db, 'SELECT event_id, outcome FROM webhook_events'),
    });
    const expected = receipt(env.db);
    assert.equal(expected.captures.length, 1);
    assert.equal(expected.credits.length, 1);
    assert.equal(expected.checks.length, 1);
    assert.equal(expected.orders[0].provider, 'paypal-sandbox');

    const destination = path.join(dir, 'snapshot.sqlite');
    await snapshotDatabase({ source, destination }); // the writer stays open
    const recovered = openDatabase(destination);
    try {
      assert.deepEqual(receipt(recovered), expected);
      const service = createContributionService({ db: recovered, clock: env.clock, mode: 'sandbox', paypal: env.paypal, webhookId: 'WH-TEST' });
      assert.equal((await deliver(service, event)).outcome, 'duplicate_event');
      assert.equal((await deliver(service, { ...event, id: 'WH-SNAPSHOT-2' })).outcome, 'already_completed');
      assert.equal((await service.capturePayPalOrder({ providerOrderId: orderId, ...owner })).outcome, 'already_completed');
      assert.equal(progressFor(recovered, DEMO_GOAL_ID).progressCents, 7500, 'still credited exactly once');
      assert.deepEqual(receipt(recovered).captures, expected.captures);
      assert.deepEqual(receipt(recovered).credits, expected.credits);
    } finally { recovered.close(); }
    assert.deepEqual(receipt(env.db), expected, 'the original database never saw those replays');
  } finally { env.db.close(); }
}));

test('refuses a newer schema, another database and a missing or non-SQLite source, creating nothing', () => inFolder(async (dir) => {
  const valid = path.join(dir, 'our-castle-example.sqlite');
  setupDomain({ file: valid, mode: 'example' }).db.close();
  const future = path.join(dir, 'future.sqlite');
  copyFileSync(valid, future); // closed cleanly, so the main file is complete
  const upgraded = new DatabaseSync(future); upgraded.exec('PRAGMA user_version = 8'); upgraded.close();
  const other = new DatabaseSync(path.join(dir, 'other.sqlite')); other.exec('CREATE TABLE notes (text)'); other.close();
  writeFileSync(path.join(dir, 'notes.txt'), 'not a database');
  for (const [name, reason] of [['future.sqlite', /schema 8, newer than this build's 7/], ['other.sqlite', /not an Our Castle database/], ['notes.txt', /not a SQLite database/], ['missing.sqlite', /does not exist/]]) {
    const destination = path.join(dir, `snapshot-of-${name}`);
    await assert.rejects(snapshotDatabase({ source: path.join(dir, name), destination }), refused(reason), name);
    assert.equal(existsSync(destination), false);
  }
  assert.equal(existsSync(path.join(dir, 'missing.sqlite')), false, 'a missing source is not created');
  assert.deepEqual(partials(dir), []);
}));

test('never replaces a file: an existing destination, the source or its own files, or a file that appears meanwhile', () => inFolder(async (dir) => {
  const source = path.join(dir, 'our-castle-example.sqlite');
  setupDomain({ file: source, mode: 'example' }).db.close(); // closed: the source has no WAL file now
  writeFileSync(path.join(dir, 'kept.sqlite'), 'caller file');
  writeFileSync(path.join(dir, 'stale.sqlite-wal'), 'another database log');
  for (const [destination, reason] of [
    ['kept.sqlite', /kept\.sqlite already exists/],
    ['our-castle-example.sqlite', /the source database or one of its own files/],
    ['our-castle-example.sqlite-wal', /the source database or one of its own files/],
    ['OUR-CASTLE-EXAMPLE.SQLITE-SHM', /the source database or one of its own files/],
    ['stale.sqlite', /stale\.sqlite-wal already exists/],
    [path.join('no-such-folder', 'snapshot.sqlite'), /folder .* does not exist/],
  ]) {
    await assert.rejects(snapshotDatabase({ source, destination: path.join(dir, destination) }), refused(reason), destination);
  }
  assert.equal(readFileSync(path.join(dir, 'kept.sqlite'), 'utf8'), 'caller file');
  assert.equal(existsSync(`${source}-wal`), false, 'refusals happen before the source is opened');

  const late = path.join(dir, 'late.sqlite');
  await assert.rejects(snapshotDatabase({ source, destination: late, beforePublish: () => writeFileSync(late, 'arrived meanwhile') }),
    refused(/appeared during the snapshot and was left as it is/));
  assert.equal(readFileSync(late, 'utf8'), 'arrived meanwhile');
  assert.deepEqual(partials(dir), []);
}));

test('a locked, interrupted or corrupt snapshot is not published and leaves no partial file', () => inFolder(async (dir) => {
  const source = path.join(dir, 'our-castle-example.sqlite');
  const env = setupDomain({ file: source, mode: 'example' });
  env.service.simulateContribution(contribution());
  // Another connection holds an exclusive lock for longer than the snapshot will wait.
  env.db.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; UPDATE households SET name = name;');
  const started = Date.now();
  await assert.rejects(snapshotDatabase({ source, destination: path.join(dir, 'locked.sqlite'), timeoutMs: 200 }), refused(/locked/));
  assert.ok(Date.now() - started < 5000, 'the wait is bounded');
  env.db.exec('COMMIT');
  const { page_size: pageSize } = env.db.prepare('PRAGMA page_size').get();
  const { rootpage } = env.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'ledger_entries'").get();
  env.db.close();
  assert.equal(existsSync(path.join(dir, 'locked.sqlite')), false);

  const interrupted = path.join(dir, 'interrupted.sqlite');
  await assert.rejects(snapshotDatabase({ source, destination: interrupted, beforePublish: () => { throw new Error('interrupted before publishing'); } }), /interrupted before publishing/);
  assert.equal(existsSync(interrupted), false);

  // A damaged table page is copied faithfully, then fails SQLite's own check.
  const corrupt = path.join(dir, 'corrupt.sqlite');
  copyFileSync(source, corrupt); // the source was closed cleanly
  const fd = openSync(corrupt, 'r+');
  writeSync(fd, Buffer.alloc(16, 0xff), 0, 16, (rootpage - 1) * pageSize);
  closeSync(fd);
  await assert.rejects(snapshotDatabase({ source: corrupt, destination: path.join(dir, 'from-corrupt.sqlite') }), refused(/integrity check/));
  assert.equal(existsSync(path.join(dir, 'from-corrupt.sqlite')), false);
  assert.deepEqual(partials(dir), []);
}));

test('the command snapshots a family database while it is served; the summary shows no names, tokens or keys', () => inFolder(async (dir) => {
  const source = path.join(dir, 'our-castle-family-example.sqlite');
  const s = await startServer({ file: source });
  try {
    const { owner: rowan } = await familyWith(s, [['Wren', 'child']]);
    const pending = await rowan.call('POST', '/api/family/invitations', { name: 'Ash', role: 'adult' });
    assert.ok(pending.json?.link, JSON.stringify(pending.json));
    const access = (db) => Object.fromEntries(['accounts', 'passkeys', 'memberships', 'invitations', 'sessions'].map((t) => [t, rows(db, `SELECT * FROM ${t} ORDER BY rowid`)]));
    const expected = access(s.db);
    const secrets = [tokenOf(pending.json.link), ...rowan.jar.values(), 'House of Alder', 'Rowan', 'Wren', 'Ash',
      ...expected.sessions.flatMap((r) => [r.token_hash, r.csrf_hash]), ...expected.invitations.map((r) => r.token_hash),
      ...expected.passkeys.map((r) => r.id), ...expected.accounts.map((r) => r.user_handle)];

    const destination = path.join(dir, 'family-snapshot.sqlite');
    const { stdout, stderr } = await run(process.execPath, [script, source, destination]);
    assert.match(stdout, /^Snapshot written: /);
    assert.match(stdout, /schema 7 · integrity ok · foreign keys ok/);
    const printed = (stdout + stderr).replaceAll(dir, '<folder>');
    for (const secret of secrets) assert.equal(printed.includes(secret), false, 'the summary shows counts only');

    // The access tables are preserved exactly as they were. Using a restored session or invitation is a separate
    // security decision with its own recovery procedure; see docs/RUNBOOK.md#household-snapshots.
    const recovered = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.deepEqual(access(recovered), expected);
      assert.deepEqual(rows(recovered, 'PRAGMA integrity_check'), [{ integrity_check: 'ok' }]);
    } finally { recovered.close(); }

    // Both paths are required, and nothing is chosen for the caller.
    await assert.rejects(run(process.execPath, [script, source]), (error) => error.code === 2 && /Usage: npm run snapshot/.test(error.stderr));
  } finally { await s.close(); }
}));
