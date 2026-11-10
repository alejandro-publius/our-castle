// The page's kit list never carries one household's, goal's or person's list into another's (task 018, review
// correction 001). These tests run the real page module, src/app/kit-list.js, over a minimal DOM built from the page's
// own markup (test/helpers/mini-dom.mjs), with invented states: no browser, server, database or network.
// - F1: another household's or goal's saved list is drawn, even when its revision, save time and saver's name match.
// - F2: typed text that was never saved is dropped, with any draft, when the household, goal or person changes.
// - A message about the previous goal's list (such as "Saved for the family") is not left under the next one, and text
//   left in the hidden box after a save is not reported as a discarded draft.
// The same household, goal and person keep what they had: an unchanged live re-read keeps the drawn list and its focus,
// and typed text or an open draft survives it.
// - F3 (review correction 002): typing or a photo begun in the empty list's box stays open and usable when another adult
//   saves the first list. Their list shows above it, and only this adult's own Check and Save replace it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MiniNode, documentFromPage } from '../helpers/mini-dom.mjs';
import { createKitList } from '../../src/app/kit-list.js';

const realFetch = globalThis.fetch;
globalThis.Node = MiniNode;
after(() => { globalThis.fetch = realFetch; delete globalThis.document; delete globalThis.Node; delete globalThis.createImageBitmap; });

const SAVED_AT = '2026-11-09T10:00:00.000Z';
const DISCARDED = 'The draft was for another person or goal, so it was discarded. Nothing was saved.';
const SAVED = 'Saved for the family. Nothing was bought or paid.';

const adult = (id, name) => ({ id, name, role: 'adult' });
const ROWAN_AND_ASH = [adult('mem_rowan', 'Rowan'), adult('mem_ash', 'Ash')];
const emptyKit = () => ({ maxItems: 8, maxQuantity: 20, revision: 0, items: [], savedBy: null, savedAt: null });
// One saved line. Every household here uses the same line id, revision and time, so only whose list it is tells them apart.
const savedKit = (savedBy, name, { revision = 1, savedAt = SAVED_AT } = {}) => ({
  maxItems: 8, maxQuantity: 20, revision, savedBy, savedAt,
  items: [{ id: 'ki_00000000000000a1', name, needs: null, quantity: 1, ownedQuantity: 0, remaining: 1, source: 'typed' }],
});
const familyState = ({ household = 'hh_first', goal = 'goal_camp', members = ROWAN_AND_ASH, kit = emptyKit() } = {}) =>
  ({ household: { id: household }, goal: { id: goal }, members, modes: { kit: { mode: 'off' } }, kit });

/** The kit list on a fresh page. show(state, memberId) draws it for that person, as the page does after every state. */
function kitPage() {
  const document = documentFromPage('kit-list');
  globalThis.document = document;
  document.getElementById('kit-list').setAttribute('open', ''); // the person opened the Kit list disclosure
  const requests = [];
  let answer = null;
  globalThis.fetch = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (!answer) throw new Error('No request was expected here.');
    return { ok: true, status: 200, json: async () => answer };
  };
  let state = null, memberId = null;
  const kit = createKitList({
    getState: () => state,
    actor: () => state?.members.find((m) => m.id === memberId) ?? null,
    applyState: (next) => { state = next; kit.render(); },
  });
  const $ = (id) => document.getElementById(id);
  return {
    document, $, requests,
    show(next, member) { state = next; memberId = member; kit.render(); },
    type(target, text) { const field = typeof target === 'string' ? $(target) : target; field.value = text; field.dispatchEvent({ type: 'input' }); },
    answerWith(body) { answer = body; },
    savedText: () => $('kit-saved').textContent,
  };
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };

test('another household or goal shows its own saved list, even with the same revision, save time and saver name', async (t) => {
  for (const [what, next, member] of [
    ['another household', familyState({ household: 'hh_second', goal: 'goal_second', members: [adult('mem_second', 'Rowan')], kit: savedKit('mem_second', 'SECOND HOUSE BAG') }), 'mem_second'],
    ['another goal of the same household', familyState({ goal: 'goal_school', kit: savedKit('mem_rowan', 'SECOND HOUSE BAG') }), 'mem_rowan'],
  ]) {
    await t.test(what, () => {
      const page = kitPage();
      page.show(familyState({ kit: savedKit('mem_rowan', 'PRIVATE TEST TENT') }), 'mem_rowan');
      assert.match(page.savedText(), /PRIVATE TEST TENT/);
      page.show(next, member);
      assert.match(page.savedText(), /SECOND HOUSE BAG/);
      assert.doesNotMatch(page.savedText(), /PRIVATE TEST TENT/);
      assert.deepEqual(page.requests, []);
    });
  }
});

test('the same household, goal and person keep the drawn list and its focus on an unchanged re-read, and see a newer save', () => {
  const page = kitPage();
  const shown = familyState({ kit: savedKit('mem_rowan', 'Tent') });
  page.show(shown, 'mem_rowan');
  const title = page.$('kit-saved-title');
  title.focus();
  assert.equal(page.document.activeElement, title);
  page.show(structuredClone(shown), 'mem_rowan'); // a live re-read: a new copy of the same records
  assert.equal(page.$('kit-saved-title'), title, 'the saved list was not drawn again');
  assert.equal(page.document.activeElement, title, 'focus stayed where the person was reading');
  page.show(familyState({ kit: savedKit('mem_rowan', 'Larger tent', { revision: 2, savedAt: '2026-11-09T10:05:00.000Z' }) }), 'mem_rowan');
  assert.match(page.savedText(), /Larger tent/);
  assert.deepEqual(page.requests, []);
});

test('typed text that was never saved is dropped, with any draft, when the household, goal or person changes', async (t) => {
  for (const [what, next, member] of [
    ['another household and person', familyState({ household: 'hh_second', goal: 'goal_second', members: [adult('mem_second', 'Sky')] }), 'mem_second'],
    ['another goal of the same household', familyState({ goal: 'goal_school' }), 'mem_rowan'],
    ['another adult of the same household (the example persona switch)', familyState(), 'mem_ash'],
  ]) {
    for (const checked of [false, true]) {
      await t.test(`${what}${checked ? ', with the checked draft open' : ''}`, () => {
        const page = kitPage();
        page.show(familyState(), 'mem_rowan');
        assert.equal(page.$('kit-source').hidden, false);
        page.type('kit-text', 'PRIVATE FIRST FAMILY UNSAVED LIST');
        if (checked) { page.$('kit-check').click(); assert.equal(page.$('kit-draft').hidden, false); }
        page.show(next, member);
        assert.equal(page.$('kit-source').hidden, false, "the empty list's typing box is shown");
        assert.equal(page.$('kit-text').value, '', 'the previous text is gone');
        assert.equal(page.$('kit-draft').hidden, true);
        assert.equal(page.$('kit-rows').textContent, '');
        assert.equal(page.$('kit-status').textContent, DISCARDED);
        assert.deepEqual(page.requests, []);
      });
    }
  }
});

test('the same household, goal and person keep typed text and an open draft through live re-reads', () => {
  const page = kitPage();
  const shown = familyState();
  page.show(shown, 'mem_rowan');
  page.type('kit-text', '2 x torch; 1 x stove');
  page.show(structuredClone(shown), 'mem_rowan');
  assert.equal(page.$('kit-text').value, '2 x torch; 1 x stove');
  assert.equal(page.$('kit-source').hidden, false);
  page.$('kit-check').click();
  assert.equal(page.$('kit-draft').hidden, false);
  const name = page.$('kit-rows').querySelector('input[data-key="name"]');
  page.type(name, 'head torch');
  name.focus();
  page.show(structuredClone(shown), 'mem_rowan');
  assert.equal(page.$('kit-draft').hidden, false, 'the draft is still open');
  assert.equal(page.$('kit-rows').querySelector('input[data-key="name"]'), name, 'its lines were not drawn again');
  assert.equal(name.value, 'head torch');
  assert.equal(page.document.activeElement, name, 'focus stayed in the line being edited');
  assert.equal(page.$('kit-text').value, '2 x torch; 1 x stove');
  assert.equal(page.$('kit-status').textContent, '');
  assert.deepEqual(page.requests, []);
});

test("a message about one goal's list is not left under the next goal's list", async () => {
  const page = kitPage();
  page.show(familyState(), 'mem_rowan');
  page.type('kit-text', '1 x tent');
  page.$('kit-check').click();
  page.answerWith({ state: familyState({ kit: savedKit('mem_rowan', 'tent') }) });
  page.$('kit-save').click();
  await settle();
  assert.equal(page.$('kit-status').textContent, SAVED);
  assert.deepEqual(page.requests, [{ url: '/api/kit', method: 'PUT', body: { goalId: 'goal_camp', expectedRevision: 0, readId: null,
    items: [{ name: 'tent', needs: null, quantity: 1, ownedQuantity: 0, from: 'typed' }], memberId: 'mem_rowan' } }]);
  // The family moves on to another goal, whose kit list is still empty.
  page.show(familyState({ goal: 'goal_school' }), 'mem_rowan');
  assert.equal(page.$('kit-source').hidden, false);
  // Neither the camping list's "saved" message nor a claim that a draft was discarded: that list was saved.
  assert.equal(page.$('kit-status').textContent, '');
  assert.equal(page.$('kit-text').value, '');
});

// Stand-ins for the browser's image decoding and canvas, so a chosen "photo" needs no real image in this test.
function allowPhotos(page) {
  const create = page.document.createElement.bind(page.document);
  page.document.createElement = (tag) => (tag !== 'canvas' ? create(tag)
    : { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/2wBD' });
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
}
const shown = (el) => el.offsetParent !== null;

test("typing or a photo begun in the empty list stays open and usable when another adult saves the first list", async (t) => {
  const ashSaved = (modes) => ({ ...familyState({ kit: savedKit('mem_ash', '4-person tent') }), ...modes });

  await t.test('typed text: kept with its focus, beside the new list, until this adult checks and saves', async () => {
    const page = kitPage();
    page.show(familyState(), 'mem_rowan');
    page.type('kit-text', '2 x torch; 1 x stove');
    page.$('kit-text').focus();
    page.show(ashSaved(), 'mem_rowan'); // Ash's first save arrives by a live re-read: same household, goal and person
    assert.ok(shown(page.$('kit-text')), 'the typing box is still shown');
    assert.equal(page.$('kit-text').value, '2 x torch; 1 x stove');
    assert.equal(page.document.activeElement, page.$('kit-text'), 'focus stayed in the box');
    assert.ok(shown(page.$('kit-saved')));
    assert.match(page.savedText(), /4-person tent.*checked and saved by Ash/, "Ash's list is shown to compare");
    assert.equal(page.$('kit-saved-actions').hidden, true, '"Start a new list" is not offered while the text is open');
    assert.deepEqual(page.requests, [], 'nothing was sent');
    // Only this adult's explicit Check and Save replace Ash's list, against the revision this page has shown.
    page.$('kit-check').click();
    assert.equal(page.$('kit-draft-note').textContent, 'Saving replaces the saved list.');
    assert.deepEqual(page.requests, []);
    const saved = familyState({ kit: savedKit('mem_rowan', 'torch', { revision: 2, savedAt: '2026-11-09T10:05:00.000Z' }) });
    page.answerWith({ state: saved });
    page.$('kit-save').click();
    await settle();
    assert.deepEqual(page.requests.map((r) => [r.method, r.url, r.body.expectedRevision, r.body.items]), [['PUT', '/api/kit', 1, [
      { name: 'torch', needs: null, quantity: 2, ownedQuantity: 0, from: 'typed' }, { name: 'stove', needs: null, quantity: 1, ownedQuantity: 0, from: 'typed' }]]]);
    assert.equal(page.$('kit-status').textContent, SAVED);
    assert.equal(page.$('kit-source').hidden, true, 'after the save the box closes');
    page.show(structuredClone(saved), 'mem_rowan');
    assert.equal(page.$('kit-source').hidden, true, 'and a later re-read does not reopen it with the saved text');
  });

  await t.test('a chosen photo: still shown and still readable, with nothing sent', async () => {
    const page = kitPage();
    allowPhotos(page);
    const photoOn = { modes: { kit: { mode: 'live' } } };
    page.show({ ...familyState(), ...photoOn }, 'mem_rowan');
    const input = page.$('kit-photo-input');
    input.files = [{ type: 'image/png', size: 2048 }];
    input.dispatchEvent({ type: 'change' });
    await settle();
    assert.ok(shown(page.$('kit-photo-preview')));
    page.show(ashSaved(photoOn), 'mem_rowan');
    assert.ok(shown(page.$('kit-photo-preview')), 'the chosen photo is still shown');
    assert.ok(shown(page.$('kit-read')), 'and can still be read, by its own explicit action');
    assert.match(page.savedText(), /4-person tent/);
    assert.deepEqual(page.requests, []);
  });

  await t.test('nothing entered: the empty box closes and the saved list is offered as before', () => {
    const page = kitPage();
    page.show(familyState(), 'mem_rowan');
    page.show(ashSaved(), 'mem_rowan');
    assert.equal(page.$('kit-source').hidden, true);
    assert.equal(page.$('kit-saved-actions').hidden, false);
    assert.deepEqual(page.requests, []);
  });
});

test('Type instead preserves reviewed Have counts, including a deliberately blank count', async () => {
  const page = kitPage();
  allowPhotos(page);
  page.show({ ...familyState(), modes: { kit: { mode: 'live' } } }, 'mem_rowan');
  page.$('kit-photo-input').files = [{ type: 'image/png', size: 2048 }];
  page.$('kit-photo-input').dispatchEvent({ type: 'change' });
  await settle();
  page.answerWith({ readId: 'read_roundtrip', reading: { readable: true, moreLines: false, lines: [
    { name: 'torch', quantity: 2, needs: null },
    { name: 'stove', quantity: 1, needs: null },
    { name: 'bag', quantity: null, needs: null },
  ] } });
  page.$('kit-read').click();
  await settle();
  assert.equal(page.$('kit-draft').hidden, false);
  const ownedFields = () => [...page.$('kit-rows').querySelectorAll('input[data-key="ownedQuantity"]')];
  assert.deepEqual(ownedFields().map((input) => input.value), ['0', '0', '0']);
  page.type(ownedFields()[0], '2');
  page.type(ownedFields()[1], '');
  page.$('kit-to-text').click();
  assert.equal(page.$('kit-source').hidden, false);
  page.$('kit-check').click();
  assert.deepEqual(ownedFields().map((input) => input.value), ['2', '', '0']);
  assert.deepEqual([...page.$('kit-rows').querySelectorAll('input[data-key="quantity"]')].map((input) => input.value), ['2', '1', '']);
  assert.deepEqual([...page.$('kit-rows').querySelectorAll('[data-to-get]')].map((line) => line.textContent),
    ['To get: 0', 'To get: —', 'To get: —']);
  assert.equal(ownedFields()[1].getAttribute('aria-invalid'), 'true');
  assert.deepEqual(page.requests.map(({ method, url }) => [method, url]), [['POST', '/api/kit/read']]);
});

test('Type instead retains a photo draft whose literal details cannot round-trip through typed text', async () => {
  const page = kitPage();
  allowPhotos(page);
  page.show({ ...familyState(), modes: { kit: { mode: 'live' } } }, 'mem_rowan');
  page.$('kit-photo-input').files = [{ type: 'image/png', size: 2048 }];
  page.$('kit-photo-input').dispatchEvent({ type: 'change' });
  await settle();
  page.answerWith({ readId: 'read_literal', reading: { readable: true, moreLines: false, lines: [
    { name: 'torch', quantity: 2, needs: 'rated to 0 °C; warm lining' },
    { name: 'stove', quantity: 1, needs: 'fits (wide) pans' },
  ] } });
  page.$('kit-read').click();
  await settle();
  const photo = page.$('kit-draft-photo').src;
  const fields = [...page.$('kit-rows').querySelectorAll('input')];
  const values = fields.map((input) => input.value);
  page.$('kit-to-text').click();
  assert.equal(page.$('kit-draft').hidden, false, 'the editable draft stays open');
  assert.equal(page.$('kit-source').hidden, true, 'no corrupted text replaces it');
  assert.equal(page.$('kit-draft-photo').src, photo, 'the chosen photo is retained');
  assert.deepEqual([...page.$('kit-rows').querySelectorAll('input')], fields, 'fields are not rebuilt');
  assert.deepEqual(fields.map((input) => input.value), values);
  assert.match(page.$('kit-status').textContent, /Keep editing the lines here/);
  assert.equal(page.document.activeElement, fields[0]);
  assert.deepEqual(page.requests.map(({ method, url }) => [method, url]), [['POST', '/api/kit/read']]);
});
