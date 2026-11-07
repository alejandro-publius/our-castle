// A consistent, point-in-time snapshot of one Our Castle database file, for local backups and recovery rehearsals:
//
//   npm run snapshot -- <existing-database.sqlite> <new-snapshot.sqlite>
//
// The source is opened read-only, so it is never created, migrated, seeded or checkpointed, and committed changes still
// in its write-ahead log (WAL) are included. A running app keeps working; SQLite's online backup API copies a
// consistent state. The copy goes to a private temporary file beside the destination and is checked (integrity, foreign
// keys, schema). Only then is it published, with a hard link: an existing file, even one that appears during the run, is
// never replaced. Nothing here reads .env or picks a default path. The summary shows counts only, never household rows,
// passkeys, sessions, invitations or provider data. See docs/RUNBOOK.md#household-snapshots for limits.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from '../server/db.mjs';

const SIDECARS = ['-wal', '-shm', '-journal'];
const COUNTED = ['households', 'ledger_entries', 'payment_orders', 'payment_captures'];

export class SnapshotError extends Error {
  constructor(message) { super(message); this.name = 'SnapshotError'; }
}

const present = (file) => {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const schemaOf = (db) => JSON.stringify(db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all());
// Removes only files this run created: its private temporary copy and the files SQLite keeps beside that copy.
const removeOwn = (temporary) => { for (const file of [temporary, ...SIDECARS.map((s) => temporary + s)]) fs.rmSync(file, { force: true }); };

/**
 * Write a new, validated snapshot of `source` at `destination`. Throws SnapshotError, publishing nothing, on refusal or failure.
 * @param {object} options
 * @param {string} options.source an existing Our Castle database file
 * @param {string} options.destination a new file in an existing folder
 * @param {number} [options.timeoutMs] the longest wait for a lock held on the source
 * @param {(file: string) => void} [options.onTemporary] told the private temporary file, so an interrupted CLI can remove it
 * @param {() => void} [options.beforePublish] runs after validation, before publishing (tests simulate interruptions)
 */
export async function snapshotDatabase({ source, destination, timeoutMs = 5000, onTemporary, beforePublish } = {}) {
  if (typeof source !== 'string' || !source || typeof destination !== 'string' || !destination) {
    throw new SnapshotError('Give an existing source database file and a new destination file.');
  }
  let real;
  try { real = fs.realpathSync(source); } catch { throw new SnapshotError(`The source ${source} does not exist.`); }
  if (!fs.statSync(real).isFile()) throw new SnapshotError(`The source ${source} is not a file.`);
  let folder;
  try { folder = fs.realpathSync(path.dirname(path.resolve(destination))); } catch { throw new SnapshotError(`The folder for ${destination} does not exist.`); }
  const target = path.join(folder, path.basename(destination));
  // Compared without case, for file systems that ignore it: the destination must not be the source or one of its files.
  if ([real, ...SIDECARS.map((s) => real + s)].some((file) => file.toLowerCase() === target.toLowerCase())) {
    throw new SnapshotError('The destination is the source database or one of its own files.');
  }
  for (const file of [target, ...SIDECARS.map((s) => target + s)]) {
    if (present(file)) throw new SnapshotError(`${file} already exists. Nothing was overwritten; choose a new destination.`);
  }
  const header = Buffer.alloc(16);
  const fd = fs.openSync(real, 'r');
  try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (header.toString('latin1') !== 'SQLite format 3\u0000') throw new SnapshotError(`The source ${source} is not a SQLite database.`);

  let db;
  try { db = new DatabaseSync(real, { readOnly: true, timeout: timeoutMs }); } catch (error) { throw new SnapshotError(`Could not open ${source} read-only: ${error.message}.`); }
  let temporary = null;
  try {
    let version, schema, households;
    try {
      version = db.prepare('PRAGMA user_version').get().user_version;
      schema = schemaOf(db);
      households = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'households'").get();
    } catch (error) { throw new SnapshotError(`Could not read ${source}: ${error.message}.`); }
    if (version > MIGRATIONS.length) throw new SnapshotError(`${source} has database schema ${version}, newer than this build's ${MIGRATIONS.length}. Use the build that wrote it.`);
    if (version < 1 || !households) throw new SnapshotError(`${source} is not an Our Castle database.`);

    temporary = path.join(folder, `.${path.basename(target)}.${randomBytes(6).toString('hex')}.partial`);
    fs.closeSync(fs.openSync(temporary, 'wx', 0o600)); // private, and created by this run alone
    onTemporary?.(temporary);
    // Every page in one step, so the copy is consistent even while the app writes. 2**31 - 1 is the largest rate each
    // supported Node accepts; newer releases (26.13) refuse -1.
    try { await backup(db, temporary, { rate: 2 ** 31 - 1 }); }
    catch (error) { throw new SnapshotError(`The copy did not complete: ${error.message}. Nothing was published.`); }
    const summary = validate(temporary, version, schema);
    summary.sha256 = createHash('sha256').update(fs.readFileSync(temporary)).digest('hex');
    beforePublish?.();
    for (const file of SIDECARS.map((s) => target + s)) {
      if (present(file)) throw new SnapshotError(`${file} appeared during the snapshot. Nothing was published.`);
    }
    try { fs.linkSync(temporary, target); } catch (error) {
      if (error.code === 'EEXIST') throw new SnapshotError(`${target} appeared during the snapshot and was left as it is. Nothing was published.`);
      throw new SnapshotError(`Could not publish without risking an overwrite (${error.code ?? error.message}). Nothing was published.`);
    }
    return { destination: target, ...summary, node: process.version };
  } finally {
    db.close();
    if (temporary) removeOwn(temporary);
  }
}

// The copy must pass SQLite's own checks and carry the source's exact schema before it is published.
function validate(file, version, schema) {
  let check;
  try {
    check = new DatabaseSync(file, { readOnly: true });
    const integrity = check.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new SnapshotError(`The copy failed SQLite's integrity check (${integrity.slice(0, 3).join('; ')}). Nothing was published.`);
    const violations = check.prepare('PRAGMA foreign_key_check').all().length;
    if (violations) throw new SnapshotError(`The copy has ${violations} foreign-key violation${violations === 1 ? '' : 's'}. Nothing was published.`);
    if (check.prepare('PRAGMA user_version').get().user_version !== version || schemaOf(check) !== schema) {
      throw new SnapshotError("The copy's schema does not match the source. Nothing was published.");
    }
    const tables = check.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
    return {
      schema: version,
      tables: tables.length,
      pages: check.prepare('PRAGMA page_count').get().page_count,
      rows: Object.fromEntries(COUNTED.filter((t) => tables.includes(t)).map((t) => [t, check.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n])),
      sqlite: check.prepare('SELECT sqlite_version() AS version').get().version,
    };
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    throw new SnapshotError(`The copy failed SQLite's integrity check (${error.message}). Nothing was published.`);
  } finally { check?.close(); }
}

async function main(args) {
  if (args.length !== 2 || args.some((arg) => arg.startsWith('-'))) {
    console.error('Usage: npm run snapshot -- <existing-database.sqlite> <new-snapshot.sqlite>');
    console.error('Writes a new, consistent snapshot. It never overwrites a file and never changes the source.');
    return 2;
  }
  let temporary = null;
  const interrupted = () => { if (temporary) removeOwn(temporary); process.exit(130); };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    const s = await snapshotDatabase({ source: args[0], destination: args[1], onTemporary: (file) => { temporary = file; } });
    console.log(`Snapshot written: ${s.destination}`);
    console.log(`  schema ${s.schema} · integrity ok · foreign keys ok · ${s.tables} tables · ${s.pages} pages`);
    console.log(`  rows: ${Object.entries(s.rows).map(([table, n]) => `${table} ${n}`).join(', ')}`);
    console.log(`  SQLite ${s.sqlite}, Node ${s.node}`);
    console.log(`  sha256 ${s.sha256} (identifies this file; it does not replace the checks above)`);
    return 0;
  } catch (error) {
    console.error(`No snapshot was written: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
