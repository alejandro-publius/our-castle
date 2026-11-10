import test from 'node:test';
import assert from 'node:assert/strict';
import { KIT_LIMITS, checkKit, kitProblemText, kitRemaining, parseKitLine, parseKitText } from '../../src/core/kit-list.js';

// The task's invented camping list. Test text only, not a person's list.
const FIXTURE = '1 x 4-person tent; 2 x sleeping bag; 2 x torch; 1 x stove';
const owned = (lines, have) => lines.map((l) => ({ ...l, ownedQuantity: have[l.name] ?? 0 }));

test('the camping list parses literally; with two torches already at home, 1, 2, 0 and 1 are still to get', () => {
  const { lines, problem } = parseKitText(FIXTURE);
  assert.equal(problem, null);
  assert.deepEqual(lines, [
    { name: '4-person tent', needs: null, quantity: 1 },
    { name: 'sleeping bag', needs: null, quantity: 2 },
    { name: 'torch', needs: null, quantity: 2 },
    { name: 'stove', needs: null, quantity: 1 },
  ]);
  const confirmed = owned(lines, { torch: 2 });
  assert.deepEqual(confirmed.map(kitRemaining), [1, 2, 0, 1]);
  assert.deepEqual(checkKit(confirmed), { ready: true, problems: [], lines: [{ problems: [] }, { problems: [] }, { problems: [] }, { problems: [] }] });
});

test('a count is read only where one is written: capacity wording, sizes and list numbering are not counts', () => {
  const read = (text) => { const { name, needs, quantity } = parseKitLine(text); return [name, needs, quantity]; };
  assert.deepEqual(read('4-person tent'), ['4-person tent', null, null]);
  assert.deepEqual(read('2 person tent'), ['2 person tent', null, null]);
  assert.deepEqual(read('3 season sleeping bag'), ['3 season sleeping bag', null, null]);
  assert.deepEqual(read('1 l water bottle'), ['1 l water bottle', null, null]);
  assert.deepEqual(read('2 torches'), ['torches', null, 2]);
  assert.deepEqual(read('2x torch'), ['torch', null, 2]);
  assert.deepEqual(read('2×torch'), ['torch', null, 2]);
  assert.deepEqual(read('torch x 2'), ['torch', null, 2]);
  assert.deepEqual(read('2 xylophones'), ['xylophones', null, 2], 'an x that starts a word is not "times"');
  assert.deepEqual(read('1. tent'), ['tent', null, null], 'numbering, not one tent');
  assert.deepEqual(read('- 2 x mug'), ['mug', null, 2]);
  assert.deepEqual(read('sleeping bag (rated to 0 °C)'), ['sleeping bag', 'rated to 0 °C', null]);
  assert.deepEqual(read('2 x sleeping bag (rated to 0 °C)'), ['sleeping bag', 'rated to 0 °C', 2]);
  // Literal text only: nothing is evaluated, and invisible or control characters are removed.
  assert.deepEqual(read('2 x ${process.exit(1)}'), ['${process.exit(1)}', null, 2]);
  assert.deepEqual(read('tent\u202e\u0007 pegs'), ['tent pegs', null, null]);
});

test('an unknown quantity needs repair rather than a default, and every problem says what to do', () => {
  const { lines } = parseKitText('4-person tent\n2 x torch');
  const draft = owned(lines, {});
  const checked = checkKit(draft);
  assert.equal(checked.ready, false);
  assert.deepEqual(checked.lines.map((l) => l.problems), [['quantity_missing'], []]);
  assert.equal(kitProblemText('quantity_missing'), 'How many are needed? Enter a number.');
  assert.equal(kitRemaining(draft[0]), null, 'no remaining count without a quantity');
  const fixed = [{ ...draft[0], quantity: 1 }, draft[1]];
  assert.equal(checkKit(fixed).ready, true);
});

test('counts are small whole numbers; already-have goes from 0 to the quantity; names and needs are bounded', () => {
  const line = (over) => ({ name: 'torch', needs: null, quantity: 2, ownedQuantity: 0, ...over });
  const problems = (over) => checkKit([line(over)]).lines[0].problems;
  assert.deepEqual(problems({ quantity: 0 }), ['quantity_range']);
  assert.deepEqual(problems({ quantity: KIT_LIMITS.maxQuantity + 1 }), ['quantity_range']);
  assert.deepEqual(problems({ quantity: 2.5 }), ['quantity_range']);
  assert.deepEqual(problems({ quantity: '2' }), ['quantity_range'], 'text is not a count');
  assert.deepEqual(problems({ ownedQuantity: 3 }), ['owned_range']);
  assert.deepEqual(problems({ ownedQuantity: -1 }), ['owned_range']);
  assert.deepEqual(problems({ ownedQuantity: undefined }), ['owned_range']);
  assert.deepEqual(problems({ ownedQuantity: 2 }), []);
  assert.deepEqual(problems({ name: '  ' }), ['name_missing']);
  assert.deepEqual(problems({ name: 'x'.repeat(KIT_LIMITS.maxName + 1) }), ['name_long']);
  assert.deepEqual(problems({ needs: 'y'.repeat(KIT_LIMITS.maxNeeds + 1) }), ['needs_long']);
});

test('duplicates are flagged on both lines, never merged; the same item with different needs is two items', () => {
  const lines = [{ name: 'Torch', needs: null, quantity: 1, ownedQuantity: 0 }, { name: ' torch ', needs: null, quantity: 1, ownedQuantity: 0 },
    { name: 'mug', needs: 'enamel', quantity: 1, ownedQuantity: 0 }, { name: 'mug', needs: 'plastic', quantity: 1, ownedQuantity: 0 }];
  assert.deepEqual(checkKit(lines).lines.map((l) => l.problems), [['duplicate'], ['duplicate'], [], []]);
});

test('too many lines is a repairable draft up to 20 and refused beyond; too much text and empty text are refused', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `1 x item ${i + 1}`).join('\n');
  const { lines, problem } = parseKitText(nine);
  assert.equal(problem, null);
  assert.equal(lines.length, 9, 'all nine are shown, none dropped');
  const checked = checkKit(owned(lines, {}));
  assert.deepEqual([checked.ready, checked.problems], [false, ['too_many']]);
  assert.equal(kitProblemText('too_many', { count: 9 }), 'A saved list holds up to 8 items. This draft has 9: remove 1.');
  const many = Array.from({ length: 21 }, (_, i) => `item ${i + 1}`).join(';');
  assert.deepEqual(parseKitText(many), { lines: [], problem: { code: 'too_many_lines', count: 21 } });
  assert.deepEqual(parseKitText('x'.repeat(KIT_LIMITS.maxText + 1)), { lines: [], problem: { code: 'text_long' } });
  assert.deepEqual(parseKitText(' ;\n - ; '), { lines: [], problem: { code: 'empty' } });
  assert.deepEqual(parseKitText(42), { lines: [], problem: { code: 'empty' } });
  assert.deepEqual(checkKit([]).problems, ['empty']);
});


test('explicit Have annotations preserve written or unknown counts without changing ordinary typed lines', () => {
  assert.deepEqual(parseKitLine('2 x torch [have 2]'), { name: 'torch', needs: null, quantity: 2, ownedQuantity: 2 });
  assert.deepEqual(parseKitLine('1 x stove [have ?]'), { name: 'stove', needs: null, quantity: 1, ownedQuantity: null });
  assert.deepEqual(parseKitLine('? x 2 person tent [have 0]'), { name: '2 person tent', needs: null, quantity: null, ownedQuantity: 0 });
  assert.deepEqual(parseKitLine('0 x pegs (steel) [have 0]'), { name: 'pegs', needs: 'steel', quantity: 0, ownedQuantity: 0 });
  assert.deepEqual(parseKitLine('3 x mug [have 4]'), { name: 'mug', needs: null, quantity: 3, ownedQuantity: 4 });
  assert.equal(checkKit(parseKitText('3 x mug [have 4]').lines).ready, false, 'an invalid reported count stays invalid');
  assert.equal(checkKit(parseKitText('1 x stove [have ?]').lines).ready, false, 'unknown Have is not zero');
  assert.deepEqual(parseKitLine('2 x torch'), { name: 'torch', needs: null, quantity: 2 });
});

test('a minus sign is not a bullet that silently turns a negative quantity positive', () => {
  assert.deepEqual(parseKitLine('-2 x torch'), { name: '-2 x torch', needs: null, quantity: null });
  assert.deepEqual(parseKitLine('-1 torch'), { name: '-1 torch', needs: null, quantity: null });
  assert.deepEqual(parseKitLine('- 2 x torch'), { name: 'torch', needs: null, quantity: 2 });
  assert.deepEqual(parseKitLine('•2 x torch'), { name: 'torch', needs: null, quantity: 2 });
});
