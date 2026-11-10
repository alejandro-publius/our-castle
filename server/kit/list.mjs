// The family's confirmed kit checklist for its goal, and the checks on a photo before it may be read.
// Planning facts only: an item's name, what it needs, how many are needed and how many the family says it already has.
// No price, purchase, payment, plan, offer, photo or model answer is stored here, and saving touches no other record.
import { randomBytes } from 'node:crypto';
import { DomainError, getGoal } from '../household.mjs';
import { transaction } from '../db.mjs';
import { sharedItems, sharedQuantity, guardSharedEdits } from '../exchange/stock.mjs';
import { KIT_LIMITS, checkKit, cleanKitText, kitProblemText } from '../../src/core/kit-list.js';

const fail = (status, code, message) => new DomainError(status, code, message);
const isObject = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
const ITEM_ID = /^ki_[0-9a-f]{16}$/;
const SOURCES = new Set(['typed', 'photo']);

function storedItems(row) {
  if (!row) return [];
  try { const items = JSON.parse(row.items_json); return Array.isArray(items) ? items : []; } catch { return []; }
}

/** What every member sees: the confirmed list (empty until an adult saves one), its revision and who saved it. */
export function kitView(db, goal) {
  const row = db.prepare('SELECT * FROM kit_lists WHERE goal_id = ?').get(goal.id);
  const shared = sharedItems(db, goal);
  return {
    maxItems: KIT_LIMITS.maxItems, maxQuantity: KIT_LIMITS.maxQuantity,
    revision: row?.revision ?? 0,
    items: storedItems(row).map(item => {
      const count = sharedQuantity(shared, item);
      return { ...item, sharedQuantity: count, remaining: Math.max(0, item.quantity - item.ownedQuantity - count) };
    }),
    savedBy: row?.saved_by ?? null,
    savedAt: row?.saved_at ?? null,
  };
}

/**
 * Save the list an adult reviewed, replacing the goal's previous one in one transaction. Refused as a whole when the
 * list changed since the adult's draft began (`expectedRevision`), or when any line is incomplete or out of bounds.
 * - Lines that keep a saved line's id keep its id and how it first entered the list.
 * - A new line is "typed", or "photo" only when this adult's own photo reading for this goal is still current.
 * Fields other than the reviewed ones (a price, a role, an amount) are never stored.
 */
export function saveKit(db, { householdId, goalId, actor, expectedRevision, items, photoRead = false }, clock) {
  if (actor.role !== 'adult') throw fail(403, 'adult_required', 'Only an adult in the family can save the kit list.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fail(400, 'invalid_revision', 'Reload the kit list, then save again.');
  if (!Array.isArray(items) || items.some((raw) => !isObject(raw) || typeof raw.name !== 'string' || (raw.needs !== undefined && raw.needs !== null && typeof raw.needs !== 'string'))) {
    throw fail(400, 'invalid_kit', 'Each line needs a name and how many are needed.');
  }
  if (items.length > KIT_LIMITS.maxDraftLines) throw fail(400, 'kit_too_many', kitProblemText('too_many', { count: items.length }));
  const lines = items.map((raw) => ({ id: raw.id ?? null, from: raw.from, name: cleanKitText(raw.name), needs: cleanKitText(raw.needs ?? '') || null, quantity: raw.quantity, ownedQuantity: raw.ownedQuantity }));
  const checked = checkKit(lines);
  if (!checked.ready) {
    const code = checked.problems[0] ?? checked.lines.flatMap((l) => l.problems)[0];
    throw fail(400, `kit_${code}`, kitProblemText(code, { count: lines.length }));
  }
  return transaction(db, () => {
    const goal = getGoal(db, goalId);
    if (!goal || goal.householdId !== householdId) throw fail(404, 'not_found', 'Goal not found.');
    const row = db.prepare('SELECT * FROM kit_lists WHERE goal_id = ?').get(goal.id);
    const current = row?.revision ?? 0;
    if (expectedRevision !== current) throw fail(409, 'kit_changed', 'The kit list was saved by someone else while you were editing. Nothing was saved: choose whether to keep your draft or use the saved list.');
    const stored = new Map(storedItems(row).map((item) => [item.id, item]));
    const used = new Set();
    const saved = lines.map((line) => {
      let id, source;
      if (line.id !== null) {
        if (typeof line.id !== 'string' || !ITEM_ID.test(line.id) || !stored.has(line.id) || used.has(line.id)) throw fail(400, 'kit_item_unknown', 'A line no longer matches the saved list. Reload the kit list, then try again.');
        id = line.id;
        source = stored.get(line.id).source;
      } else {
        if (!SOURCES.has(line.from)) throw fail(400, 'invalid_kit', 'Each new line says whether it was typed or read from a photo.');
        if (line.from === 'photo' && !photoRead) throw fail(409, 'kit_photo_expired', 'This photo reading has expired. Nothing was saved: read the photo again, or type the list.');
        id = `ki_${randomBytes(8).toString('hex')}`;
        source = line.from;
      }
      used.add(id);
      return { id, name: line.name, needs: line.needs, quantity: line.quantity, ownedQuantity: line.ownedQuantity, source };
    });
    guardSharedEdits(db, goal, saved, fail);
    db.prepare(`INSERT INTO kit_lists (goal_id, household_id, revision, items_json, saved_by, saved_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(goal_id) DO UPDATE SET revision = excluded.revision, items_json = excluded.items_json, saved_by = excluded.saved_by, saved_at = excluded.saved_at`)
      .run(goal.id, householdId, current + 1, JSON.stringify(saved), actor.memberId, clock.iso());
    return { revision: current + 1 };
  });
}

// ---- A photo before it is read: only a PNG or JPEG data URL the page made, within explicit byte and pixel bounds ----
export const KIT_IMAGE_LIMITS = Object.freeze({ maxBytes: 1_400_000, maxSide: 1600, minSide: 32 });
const PREFIXES = Object.freeze({ 'image/jpeg': 'data:image/jpeg;base64,', 'image/png': 'data:image/png;base64,' });
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) return null; // no frame header before the image data
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (i + 4 > b.length) return null;
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) return i + 9 <= b.length ? { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) } : null;
    i += 2 + length;
  }
  return null;
}

/**
 * Check a photo before any provider sees it: a base64 data URL of a PNG or JPEG whose bytes really are that type, at
 * most 1.4 MB and 1600 pixels a side. No URL, path, SVG or other file is accepted. Returns its size; keeps nothing.
 */
export function checkKitImage(value) {
  const notPhoto = () => fail(400, 'kit_image_invalid', 'Choose a PNG or JPEG photo of the list.');
  if (typeof value !== 'string') throw notPhoto();
  const type = Object.keys(PREFIXES).find((t) => value.startsWith(PREFIXES[t]));
  if (!type) throw notPhoto();
  const data = value.slice(PREFIXES[type].length);
  const L = KIT_IMAGE_LIMITS;
  if (data.length > 4 * Math.ceil(L.maxBytes / 3)) throw fail(413, 'kit_image_large', 'That photo is too large to read. Choose a smaller photo, or type the list.');
  if (!data.length || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw notPhoto();
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > L.maxBytes) throw fail(413, 'kit_image_large', 'That photo is too large to read. Choose a smaller photo, or type the list.');
  const size = type === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
  if (!size) throw fail(400, 'kit_image_invalid', 'That file is not a readable PNG or JPEG photo.');
  if (size.width > L.maxSide || size.height > L.maxSide) throw fail(413, 'kit_image_large', `Photos are read at up to ${L.maxSide} pixels a side. Choose the photo again so it is resized, or type the list.`);
  if (size.width < L.minSide || size.height < L.minSide) throw fail(400, 'kit_image_invalid', 'That photo is too small to read. Choose a clearer photo, or type the list.');
  return { type, bytes: bytes.length, width: size.width, height: size.height };
}
