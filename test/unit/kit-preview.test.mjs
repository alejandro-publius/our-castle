// Pure preview contracts: invented comparison cards, no application server or saved household.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { picksOf, matchPreview, previewScene, layoutPreview, PREVIEW_LOOKS, SAMPLE_LOOKS, PREVIEW_LIMITS, PLAN_GROUND } from '../../src/core/kit-preview.js';
import { SAMPLE_LISTINGS } from '../../scripts/family-trip.mjs';

const line = (lineId, candidateId, extra = {}) => ({
  lineId, candidateId, title: 'An unclassified listing', merchant: 'shop.example',
  bought: 1, kept: false, switched: null, ...extra,
});
const card = (lines, extra = {}) => ({ key: '0.0', lines, fits: true, labels: [], ...extra });
const chosenCard = (extra = {}) => card([line('tent', 'light'), line('stove', 'camp', { kept: true })], extra);
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('preview identity follows line/listing ids despite reordered rows, card indices and changed descriptive facts', () => {
  const original = chosenCard();
  const reordered = card([...original.lines].reverse().map((l) => ({ ...l, title: 'Updated title', bought: 4 })), { key: '9.8', totalCents: 19000 });
  assert.equal(picksOf(original), picksOf(reordered));
  const other = card([line('tent', 'dome'), line('stove', 'camp')], { key: original.key });
  assert.notEqual(picksOf(original), picksOf(other), 'a reused solver index is not the same listing');
  const otherLine = card([line('different-line', 'light'), line('stove', 'camp')]);
  assert.notEqual(picksOf(original), picksOf(otherLine), 'a different checklist line is not the old arrangement');
  const answer = freeze({ status: 'ok', kits: [other, reordered], current: null });
  const result = matchPreview(picksOf(original), answer);
  assert.equal(result.role, 'kit');
  assert.strictEqual(result.card, reordered);
});

test('a chosen fitting kit uses its current comparison card, including labels, and survives omission from winners', () => {
  const current = chosenCard();
  const winner = chosenCard({ labels: ['lower_weight'], totalCents: 18000 });
  const answer = freeze({ status: 'ok', current, kits: [winner] });
  assert.deepEqual(matchPreview(picksOf(current), answer), { role: 'chosen', card: winner });
  assert.deepEqual(matchPreview(picksOf(current), { ...answer, kits: [] }), { role: 'chosen', card: current });
});

test('a chosen kit that stops fitting previews the smallest-change proposal without changing the saved choice', () => {
  const current = chosenCard({ fits: false, totalCents: 18000, finish: { shortfallCents: 3000 } });
  const cheapest = card([line('tent', 'dome'), line('stove', 'compact')], { totalCents: 14000, labels: ['lowest_total'] });
  const repair = card([line('tent', 'dome', { switched: { candidateId: 'light' } }), line('stove', 'camp', { kept: true })],
    { totalCents: 15000, labels: ['smallest_change'] });
  const answer = freeze({ status: 'ok', current, kits: [cheapest, repair] });
  const before = structuredClone(answer);
  const result = matchPreview(picksOf(current), answer);
  assert.equal(result.role, 'proposal');
  assert.strictEqual(result.card, repair);
  assert.strictEqual(result.from, current);
  assert.deepEqual(answer, before);
  assert.equal(matchPreview(picksOf(cheapest), answer).role, 'kit', 'another explicitly previewed kit is not replaced by the repair');
});

test('no-fit answers keep the chosen late kit distinct from the cheaper closest kit and their own shortfalls', () => {
  const current = chosenCard({ fits: false, totalCents: 18000, finish: { shortfallCents: 11000 } });
  const closest = card([line('tent', 'dome'), line('stove', 'camp')],
    { fits: false, totalCents: 15000, finish: { shortfallCents: 8000 } });
  const answer = freeze({ status: 'none_fits', current, closest, kits: [] });
  const late = matchPreview(picksOf(current), answer), near = matchPreview(picksOf(closest), answer);
  assert.equal(late.role, 'chosen-late');
  assert.strictEqual(late.card, current);
  assert.equal(late.card.finish.shortfallCents, 11000);
  assert.equal(near.role, 'closest');
  assert.strictEqual(near.card, closest);
  assert.equal(near.card.finish.shortfallCents, 8000);
});

test('gone, invalidated and unmatched previews do not silently substitute a different kit', () => {
  const current = chosenCard(), anchor = picksOf(current);
  for (const invalid of [null, undefined, '', 12, {}]) {
    assert.deepEqual(matchPreview(invalid, { status: 'ok', current, kits: [current] }), { card: null, role: null, reason: 'gone' });
  }
  assert.deepEqual(matchPreview(anchor, null), { card: null, role: null, reason: 'gone' });
  for (const status of ['incomplete', 'kept_unavailable', 'empty', 'unavailable']) {
    assert.deepEqual(matchPreview(anchor, { status, current, kits: [current] }), { card: null, role: null, reason: status });
  }
  assert.deepEqual(matchPreview('gone-line=gone-listing', { status: 'ok', current, kits: [current] }),
    { card: null, role: null, reason: 'unmatched' });
  assert.deepEqual(matchPreview(anchor, { status: 'ok', current: null, closest: current, kits: null }),
    { card: null, role: null, reason: 'unmatched' }, 'closest is eligible only in a no-fit answer');
});

test('only the six exact authored catalogue titles get sample illustrations, and only in explicit sample mode', () => {
  assert.deepEqual(Object.keys(SAMPLE_LOOKS).sort(), SAMPLE_LISTINGS.map((l) => l.title).sort());
  const fixture = card(SAMPLE_LISTINGS.map((l) => line(l.id, l.id, { title: l.title })));
  const expected = ['tent-dome', 'tent-light', 'bag-synthetic', 'bag-down', 'stove-camp', 'stove-compact'];
  assert.deepEqual(previewScene(fixture, { sample: true }).items.map((i) => i.look), expected);
  assert.deepEqual(previewScene(fixture).items.map((i) => i.look), expected.map(() => 'crate'));
  assert.deepEqual(previewScene(fixture, { sample: false }).items.map((i) => i.look), expected.map(() => 'crate'));
  const unknown = card(['A real four-person tent', 'Sample: Dome tent, four-person XL', 'toString', '__proto__']
    .map((title, i) => line(String(i), String(i), { title })));
  assert.deepEqual(previewScene(unknown, { sample: true }).items.map((i) => i.look), ['crate', 'crate', 'crate', 'crate']);
});

test('pack quantities show bought units including surplus, while drawn counts stay bounded and full counts survive', () => {
  const fixture = freeze(card([
    line('bags', 'two-pack', { need: 3, perListing: 2, listings: 2, bought: 4, surplus: 1 }),
    line('torches', 'large-pack', { need: 7, perListing: 10, listings: 1, bought: 10, surplus: 3 }),
    line('stakes', 'hundred-pack', { need: 20, perListing: 100, listings: 1, bought: 100, surplus: 80 }),
  ]));
  const scene = previewScene(fixture);
  assert.deepEqual(scene.items.map((i) => i.count), [4, 10, 100]);
  assert.equal(scene.items[0].shown, 4, 'draw units, not two packs or three needed items');
  assert.equal(PREVIEW_LIMITS.perLine, 6, 'the documented illustration cap');
  assert.deepEqual(scene.items.map((i) => i.shown), [4, 6, 6]);
  assert.deepEqual(fixture.lines.map((l) => l.bought), [4, 10, 100]);
});

test('shop grouping, kept/switched markers and no-fit tone preserve the comparison facts without mutating it', () => {
  const fixture = freeze(card([
    line('tent', 'dome', { merchant: 'one.example', kept: true }),
    line('bag', 'down', { merchant: 'two.example', switched: { candidateId: 'synthetic' } }),
    line('stove', 'camp', { merchant: 'one.example' }),
  ], { fits: false }));
  const before = structuredClone(fixture), scene = previewScene(fixture);
  assert.equal(scene.fits, false);
  assert.deepEqual(scene.items.map(({ shop, kept, switched }) => ({ shop, kept, switched })), [
    { shop: 0, kept: true, switched: false }, { shop: 1, kept: false, switched: true }, { shop: 0, kept: false, switched: false },
  ]);
  assert.deepEqual(fixture, before);
});

// Check returned world-space rectangles against the public ground, independently of the layout's
// column-count, sorting or scale-search algorithm. Every requested illustration must fit and avoid
// every other illustration; truncating rows or overlapping objects cannot satisfy these assertions.
function checkLayout(items, description) {
  const input = freeze({ fits: true, items }), before = structuredClone(input);
  const result = layoutPreview(input);
  assert.ok(Number.isFinite(result.scale) && result.scale > 0 && result.scale <= 1, description);
  assert.deepEqual(result.rows.map((r) => r.item.lineId).sort(), items.map((i) => i.lineId).sort(), description);
  const rectangles = [];
  const eps = 1e-9, halfW = PLAN_GROUND.w / 2 - PLAN_GROUND.margin, halfD = PLAN_GROUND.d / 2 - PLAN_GROUND.margin;
  for (const row of result.rows) {
    const source = items.find((i) => i.lineId === row.item.lineId);
    assert.equal(row.places.length, source.shown, description + ': missing or extra objects');
    const look = PREVIEW_LOOKS[source.look] ?? PREVIEW_LOOKS.crate;
    for (const p of row.places) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), description);
      const x = p.x * result.scale, z = p.z * result.scale;
      const w = look.w * result.scale / 2, d = look.d * result.scale / 2;
      assert.ok(x - w >= -halfW - eps && x + w <= halfW + eps,
        description + ': object exceeds ground width');
      assert.ok(z - d >= -halfD - eps && z + d <= halfD + eps,
        description + ': object exceeds ground depth');
      rectangles.push({ left: x - w, right: x + w, back: z - d, front: z + d });
    }
    assert.ok(Number.isFinite(row.tag.x) && Number.isFinite(row.tag.z), description);
    assert.ok(Math.abs(row.tag.x * result.scale) <= PLAN_GROUND.w / 2 + eps, description + ': tag outside ground');
    assert.ok(Math.abs(row.tag.z * result.scale) <= PLAN_GROUND.d / 2 + eps, description + ': tag outside ground');
  }
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const a = rectangles[i], b = rectangles[j];
    assert.ok(a.right <= b.left + eps || b.right <= a.left + eps || a.front <= b.back + eps || b.front <= a.back + eps,
      description + ': illustrations overlap');
  }
  assert.deepEqual(input, before, description + ': input changed');
  assert.deepEqual(layoutPreview(input), result, description + ': nondeterministic layout');
}

const item = (look, index, shown) => ({ lineId: 'line-' + index, look, shown, count: shown, shop: index % 2, kept: false, switched: false });
for (const look of Object.keys(PREVIEW_LOOKS)) {
  test('layout contains every ' + look + ' across one to eight lines and all permitted drawn counts', () => {
    for (let lines = 1; lines <= 8; lines++) for (let count = 1; count <= PREVIEW_LIMITS.perLine; count++) {
      checkLayout(Array.from({ length: lines }, (_, i) => item(look, i, count)), look + ': ' + lines + ' lines x ' + count);
    }
  });
}
test('mixed shapes, unknown-shape fallback and an empty arrangement obey the same layout invariants', () => {
  const looks = [...Object.keys(PREVIEW_LOOKS), 'unknown'];
  for (let offset = 0; offset < looks.length; offset++) {
    checkLayout(looks.map((_, i) => item(looks[(i + offset) % looks.length], i, i % PREVIEW_LIMITS.perLine + 1)), 'mixed ' + offset);
    checkLayout(looks.map((_, i) => item(looks[(i + offset) % looks.length], i, PREVIEW_LIMITS.perLine)), 'mixed maximum ' + offset);
  }
  checkLayout([], 'empty');
});
