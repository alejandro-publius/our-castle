// A family kit checklist: a short list of things to bring, how many of each are needed, and how many the family says
// it already has. Pure and shared by the page and the server. Nothing here is a price, a purchase, money or a plan.
//
// The bounds are deliberately small. A saved list holds at most 8 items; a draft may show up to 20 lines so an over-long
// list is visible and can be trimmed, never silently cut. Quantities are whole numbers from 1 to 20, and "already have"
// goes from 0 up to the quantity. Text is parsed literally: no evaluation, no guessing.

export const KIT_LIMITS = Object.freeze({
  maxItems: 8,        // lines in a saved list
  maxDraftLines: 20,  // lines a typed or photo draft may show before it is refused outright
  maxQuantity: 20,    // how many of one item
  maxName: 60,        // characters in an item's name
  maxNeeds: 120,      // characters in what the item needs (size, rating, capacity), optional
  maxText: 2000,      // characters of typed or pasted text
});

// A number directly followed by one of these words describes the item ("2 person tent", "3 season bag", "1 l bottle");
// it is not a count. A hyphenated number ("4-person tent") never matches a count pattern at all.
const SIZE_WORD = /^(?:person|persons|people|man|men|season|seasons|berth|litres?|liters?|l|ml|kg|g|lbs?|oz|cm|mm|m|in|inch|inches|ft|w|v|mah|gb|tb)\b/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/** Plain text, one line: control and invisible formatting characters removed, spaces collapsed, trimmed. */
export const cleanKitText = (value) => (typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '');

/** The key two lines are compared by: the same name and needs, ignoring case and spacing. */
export const kitLineKey = (line) => `${cleanKitText(line.name).toLowerCase()}\u0000${cleanKitText(line.needs ?? '').toLowerCase()}`;

function splitNeeds(text) {
  // A trailing bracket holds what the item needs: "sleeping bag (rated to 0 °C)".
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(text);
  return m && m[1].trim() ? { name: cleanKitText(m[1]), needs: cleanKitText(m[2]) || null } : { name: cleanKitText(text), needs: null };
}

/**
 * One typed line: an explicit count where one is written, otherwise none (the family fills it in).
 * - "2 x torch", "2x torch", "2×torch" and "torch x 2" give 2;
 * - "2 torches" gives 2, but "2 person tent" and "4-person tent" give no count: the number describes the tent;
 * - "1. tent" or "1) tent" is list numbering, not a count;
 * - a trailing "[have 2]" reports an owned count; "[have ?]" or "? x tent" keeps an explicitly unknown count.
 */
export function parseKitLine(raw) {
  // ASCII list bullets need a space: "-2" is a negative-looking value, never a positive count.
  let text = cleanKitText(raw).replace(/^(?:(?:[-*](?:\s+|$)|[•·]\s*))+/u, '').replace(/^\d{1,2}[.)]\s+/, '');
  const have = /\s+\[have\s+(\d{1,3}|\?)\]$/i.exec(text);
  const owned = have ? { ownedQuantity: have[1] === '?' ? null : Number(have[1]) } : {};
  if (have) text = text.slice(0, have.index);
  let quantity = null;
  let m;
  if ((m = /^(\d{1,3}|\?)\s*(?:[x×]\s+|×)(.+)$/i.exec(text))) { quantity = m[1] === '?' ? null : Number(m[1]); text = m[2]; }
  else if ((m = /^(.+?)\s+[x×]\s*(\d{1,3})$/i.exec(text))) { quantity = Number(m[2]); text = m[1]; }
  else if ((m = /^(\d{1,3})\s+(.+)$/.exec(text)) && !SIZE_WORD.test(m[2])) { quantity = Number(m[1]); text = m[2]; }
  return { ...splitNeeds(text), quantity, ...owned };
}

/**
 * Typed or pasted text into draft lines. Lines are separated by line breaks or semicolons; empty ones are skipped.
 * Too much text or more than 20 lines is refused as a whole (`problem`), never cut short.
 * @returns {{ lines: { name: string, needs: string|null, quantity: number|null }[], problem: null | { code: string, count?: number } }}
 */
export function parseKitText(text) {
  if (typeof text !== 'string' || !text.trim()) return { lines: [], problem: { code: 'empty' } };
  if (text.length > KIT_LIMITS.maxText) return { lines: [], problem: { code: 'text_long' } };
  const parts = text.split(/\r\n|\r|\n|;/).map((p) => cleanKitText(p)).filter(Boolean);
  if (parts.length > KIT_LIMITS.maxDraftLines) return { lines: [], problem: { code: 'too_many_lines', count: parts.length } };
  const lines = parts.map(parseKitLine).filter((l) => l.name || l.quantity !== null || l.needs);
  return lines.length ? { lines, problem: null } : { lines: [], problem: { code: 'empty' } };
}

const isCount = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

/**
 * What still needs fixing before a list can be saved. Each line gets its own problems; the list gets the rest.
 * A line: { name, needs, quantity, ownedQuantity }. Quantities must be written by the family, never assumed.
 * @returns {{ ready: boolean, problems: string[], lines: { problems: string[] }[] }}
 */
export function checkKit(lines) {
  const keys = lines.map(kitLineKey);
  const checked = lines.map((line, i) => {
    const problems = [];
    const name = cleanKitText(line.name);
    if (!name) problems.push('name_missing');
    else if (name.length > KIT_LIMITS.maxName) problems.push('name_long');
    if (cleanKitText(line.needs ?? '').length > KIT_LIMITS.maxNeeds) problems.push('needs_long');
    if (line.quantity === null || line.quantity === undefined || line.quantity === '') problems.push('quantity_missing');
    else if (!isCount(line.quantity, 1, KIT_LIMITS.maxQuantity)) problems.push('quantity_range');
    else if (!isCount(line.ownedQuantity, 0, line.quantity)) problems.push('owned_range');
    if (name && keys.filter((k) => k === keys[i]).length > 1) problems.push('duplicate');
    return { problems };
  });
  const problems = [];
  if (!lines.length) problems.push('empty');
  if (lines.length > KIT_LIMITS.maxItems) problems.push('too_many');
  return { ready: !problems.length && checked.every((l) => !l.problems.length), problems, lines: checked };
}

/** How many are still to get: the quantity less what the family says it already has. */
export const kitRemaining = (line) => (isCount(line.quantity, 1, KIT_LIMITS.maxQuantity) && isCount(line.ownedQuantity, 0, line.quantity) ? line.quantity - line.ownedQuantity : null);

/** Plain words for each problem code, for the family. */
export function kitProblemText(code, { count = 0 } = {}) {
  const L = KIT_LIMITS;
  switch (code) {
    case 'name_missing': return 'Add the item’s name.';
    case 'name_long': return `Shorten the name to ${L.maxName} characters.`;
    case 'needs_long': return `Shorten what it needs to ${L.maxNeeds} characters.`;
    case 'quantity_missing': return 'How many are needed? Enter a number.';
    case 'quantity_range': return `Enter how many are needed, from 1 to ${L.maxQuantity}.`;
    case 'owned_range': return 'Have can be 0 up to the number needed.';
    case 'duplicate': return 'This item is listed twice. Combine the lines or remove one.';
    case 'empty': return 'Add at least one item.';
    case 'too_many': return `A saved list holds up to ${L.maxItems} items. This draft has ${count}: remove ${count - L.maxItems}.`;
    case 'text_long': return `That is more than ${L.maxText} characters. Keep the list short.`;
    case 'too_many_lines': return `That text has ${count} lines; a list here is at most ${L.maxItems} items. Shorten it and check again.`;
    default: return 'Check this line.';
  }
}
