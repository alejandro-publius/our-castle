// The kit list in the Plan journal: a short checklist of things to bring for the family's goal.
// - An adult types or pastes the list ("Check this list" parses it here, with no server call), or chooses a photo and
//   asks for it to be read ("Read the photo with OpenAI", the one explicit call that sends the photo).
// - Either way the result is a DRAFT the adult checks and corrects: names, what each needs, how many, and how many the
//   family already has. Unknown counts stay blank until the adult fills them in.
// - Only "Save this list" writes, and only the kit list. Every member, children included, then reads the saved list.
// The chosen photo lives only in this page's memory while it is shown: it is resized and re-encoded here (which drops
// camera metadata), never stored, and cleared on Remove, Cancel, Save or when the goal or person changes.
import { api } from './api.js';
import { KIT_LIMITS, checkKit, cleanKitText, kitProblemText, kitRemaining, parseKitText } from '../core/kit-list.js';

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el; // read or typed text is only ever added as text
}

// A photo is read at no more than 1600 pixels a side and 1.4 MB, as a fresh JPEG made on this page.
const PHOTO = Object.freeze({ maxFileBytes: 20 * 1024 * 1024, maxSide: 1600, maxBytes: 1_400_000, minSide: 32 });
const base64Bytes = (dataUrl) => { const data = dataUrl.slice(dataUrl.indexOf(',') + 1); return Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0); };

async function preparePhoto(file) {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a PNG or JPEG photo of the list.');
  if (file.size > PHOTO.maxFileBytes) throw new Error('Choose a photo under 20 MB, or type the list.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('That file could not be opened as a photo. Choose another, or type the list.'); }
  try {
    if (bitmap.width < PHOTO.minSide || bitmap.height < PHOTO.minSide) throw new Error('That photo is too small to read. Choose a clearer one, or type the list.');
    const scale = Math.min(1, PHOTO.maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(PHOTO.minSide, Math.round(bitmap.width * scale));
    canvas.height = Math.max(PHOTO.minSide, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      for (const quality of [0.85, 0.7, 0.55]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality); // a new file: no location, camera details or original bytes
        if (dataUrl.startsWith('data:image/jpeg;base64,') && base64Bytes(dataUrl) <= PHOTO.maxBytes) return dataUrl;
      }
    } finally { canvas.width = 0; canvas.height = 0; }
    throw new Error('That photo has too much detail to send. Try a closer photo of just the list, or type it.');
  } finally { bitmap.close(); }
}

const readCount = (input) => { const v = input.value.trim(); return v === '' ? null : /^\d{1,3}$/.test(v) ? Number(v) : NaN; };
let nextKey = 1;
const rowOf = (line, from) => ({ key: nextKey++, id: line.id ?? null, source: line.source ?? from, from, name: line.name ?? '', needs: line.needs ?? '', quantity: line.quantity ?? null, ownedQuantity: line.ownedQuantity === undefined ? 0 : line.ownedQuantity });
const textCount = (n) => Number.isSafeInteger(n) ? String(n) : '?';
// Visible annotations keep reviewed counts attached to their item, even when typed lines are reordered.
const asText = (rows) => rows.map((r) => `${textCount(r.quantity)} x ${r.name}${r.needs ? ` (${r.needs})` : ''} [have ${textCount(r.ownedQuantity)}]`).join('\n');

/**
 * @param options.getState () => the app state
 * @param options.actor () => the member acting on this page ({ id, name, role }): the signed-in member, or the example persona
 * @param options.applyState (state) => applies a server state
 * @param options.onRender () => called after every render (the complete-kit planner hides while the list is edited)
 */
export function createKitList({ getState, actor, applyState, onRender = () => {} }) {
  const ui = { mode: 'view', draft: null, photo: null, scope: null, busy: false, readSeq: 0, controller: null, edits: 0 };
  const status = $('kit-status');
  function say(kind, text) {
    status.replaceChildren();
    if (text) status.append(h('div', { class: `msg ${kind}` }, text));
  }
  const adult = () => actor()?.role === 'adult';
  const asActor = (body) => (getState().access ? body : { ...body, memberId: actor()?.id });
  const scopeKey = () => { const s = getState(); return JSON.stringify([s.household.id, s.goal.id, actor()?.id ?? null]); };
  const nameOf = (memberId) => getState().members.find((m) => m.id === memberId)?.name ?? 'A family member';
  const time = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ---- The photo: chosen, shown here, sent only by "Read the photo", and forgotten on Remove/Cancel/Save/scope change ----
  function clearPhoto() {
    ui.readSeq++; ui.controller?.abort(); ui.controller = null;
    ui.photo = null;
    for (const img of [$('kit-photo-preview'), $('kit-draft-photo')]) { img.removeAttribute('src'); img.hidden = true; }
    $('kit-photo-input').value = '';
  }
  async function choosePhoto(e) {
    const file = e.currentTarget.files?.[0];
    clearPhoto(); // a new choice replaces the old photo and drops any reading of it still on its way
    if (!file) { render(); return; }
    const seq = ui.readSeq, scope = scopeKey();
    say('', '');
    try {
      const dataUrl = await preparePhoto(file);
      if (seq !== ui.readSeq || scope !== scopeKey()) return;
      ui.photo = { dataUrl, scope };
      const img = $('kit-photo-preview');
      img.src = dataUrl; img.hidden = false;
    } catch (error) {
      if (seq === ui.readSeq) { $('kit-photo-input').value = ''; say('error', error.message); }
    }
    render();
  }
  async function readPhoto() {
    if (!ui.photo || ui.busy || !adult()) return;
    const seq = ++ui.readSeq, edits = ui.edits, scope = scopeKey();
    ui.controller?.abort();
    const controller = new AbortController();
    ui.controller = controller;
    const button = $('kit-read');
    button.disabled = true;
    say('', 'Reading the photo…');
    try {
      const res = await api.post('/api/kit/read', asActor({ image: ui.photo.dataUrl }), { signal: controller.signal });
      // An answer for an older photo, another person or goal, or a list changed since asking is not used.
      if (seq !== ui.readSeq || scope !== scopeKey()) return;
      if (edits !== ui.edits) { say('info', 'That reading arrived after you changed the list, so it was not used.'); return; }
      const { reading } = res;
      if (!reading.readable) { say('error', 'The photo did not show a list that could be read. Try a clearer photo, or type the list.'); return; }
      startDraft(reading.lines.map((line) => rowOf({ ...line, ownedQuantity: 0 }, 'photo')), { from: 'photo', readId: res.readId, moreLines: reading.moreLines });
      say('', '');
    } catch (error) {
      if (error?.name === 'AbortError' || seq !== ui.readSeq || scope !== scopeKey()) return;
      say('error', error.message);
    } finally {
      if (ui.controller === controller) ui.controller = null;
      button.disabled = false;
      render();
    }
  }

  // ---- The draft: unsaved lines the adult checks, corrects and completes ----
  function startDraft(rows, { from, readId = null, moreLines = false }) {
    const kit = getState().kit;
    ui.draft = { rows, from, readId, moreLines, baseRevision: kit.revision, replaces: kit.items.length > 0 && rows.every((r) => !r.id) };
    ui.mode = 'draft';
    ui.edits++;
    drawRows();
    render();
    const firstProblem = $('kit-rows').querySelector('[aria-invalid="true"]');
    (firstProblem ?? $('kit-draft-title')).focus();
  }
  function checkTyped() {
    const parsed = parseKitText($('kit-text').value);
    if (parsed.problem) { say('error', kitProblemText(parsed.problem.code, { count: parsed.problem.count })); $('kit-text').focus(); return; }
    say('', '');
    startDraft(parsed.lines.map((line) => rowOf(line, 'typed')), { from: 'typed' });
  }
  const linesOf = (rows) => rows.map((r) => ({ name: r.name, needs: r.needs || null, quantity: r.quantity, ownedQuantity: r.ownedQuantity }));
  // Draw every line once; typing then updates the draft and its problems in place, so focus and text are never replaced.
  function drawRows() {
    const list = $('kit-rows');
    list.replaceChildren(...ui.draft.rows.map((row, i) => {
      const id = `kit-row-${row.key}`;
      const field = (cls, label, input) => h('label', { class: `field ${cls}` }, h('span', {}, ...label), input);
      const text = (key, attrs) => h('input', { type: 'text', autocomplete: 'off', value: row[key] ?? '', 'data-key': key, ...attrs,
        oninput: (e) => { row[key] = e.currentTarget.value; ui.edits++; refreshProblems(); } });
      const count = (key, attrs) => h('input', { type: 'number', inputmode: 'numeric', min: key === 'quantity' ? 1 : 0, max: KIT_LIMITS.maxQuantity, step: 1,
        value: row[key] === null || Number.isNaN(row[key]) ? '' : row[key], 'data-key': key, ...attrs,
        oninput: (e) => { row[key] = readCount(e.currentTarget); ui.edits++; refreshProblems(); } });
      return h('li', {}, h('fieldset', { class: 'kit-row', id },
        h('legend', {}, `Line ${i + 1}`),
        field('kit-name', ['Item'], text('name', { 'aria-describedby': `${id}-problem` })),
        field('kit-quantity', ['Need'], count('quantity', { 'aria-describedby': `${id}-problem` })),
        field('kit-owned', ['Have'], count('ownedQuantity', { 'aria-describedby': `${id}-problem` })),
        field('kit-needs', ['Details ', h('small', {}, '(optional)')], text('needs', { placeholder: 'size, rating…' })),
        h('p', { class: 'kit-to-get', 'data-to-get': '' }),
        h('button', { type: 'button', class: 'link-button', 'aria-label': `Remove line ${i + 1}`, onclick: () => removeRow(row.key) }, 'Remove'),
        h('p', { class: 'kit-row-problem', id: `${id}-problem`, hidden: true })));
    }));
    refreshProblems();
  }
  function removeRow(key) {
    const rows = ui.draft.rows;
    const i = rows.findIndex((r) => r.key === key);
    rows.splice(i, 1);
    ui.edits++;
    drawRows();
    const next = $('kit-rows').querySelectorAll('input[data-key="name"]')[Math.min(i, rows.length - 1)];
    (next ?? $('kit-add')).focus();
  }
  function addRow() {
    ui.draft.rows.push(rowOf({}, 'typed'));
    ui.edits++;
    drawRows();
    [...$('kit-rows').querySelectorAll('input[data-key="name"]')].at(-1).focus();
  }
  // Problems for each line and the list, in words; nothing is corrected automatically.
  function refreshProblems() {
    if (!ui.draft) return;
    const checked = checkKit(linesOf(ui.draft.rows));
    ui.draft.rows.forEach((row, i) => {
      const box = $(`kit-row-${row.key}`);
      if (!box) return;
      const problems = checked.lines[i].problems;
      const fieldFor = { name_missing: 'name', name_long: 'name', needs_long: 'needs', quantity_missing: 'quantity', quantity_range: 'quantity', owned_range: 'ownedQuantity', duplicate: 'name' };
      for (const input of box.querySelectorAll('input')) {
        if (problems.some((p) => fieldFor[p] === input.dataset.key)) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      }
      const note = $(`kit-row-${row.key}-problem`);
      note.textContent = problems.map((p) => kitProblemText(p)).join(' ');
      note.hidden = !problems.length;
      const remaining = kitRemaining(linesOf([row])[0]);
      box.querySelector('[data-to-get]').textContent = remaining === null ? 'To get: —' : `To get: ${remaining}`;
    });
    $('kit-problems').replaceChildren(...checked.problems.map((p) => h('li', {}, kitProblemText(p, { count: ui.draft.rows.length }))));
    return checked;
  }
  async function saveDraft() {
    if (!ui.draft || ui.busy || !adult()) return;
    const checked = refreshProblems();
    if (!checked.ready) {
      say('error', 'Some lines need fixing before the list can be saved.');
      ($('kit-rows').querySelector('[aria-invalid="true"]') ?? $('kit-add')).focus();
      return;
    }
    ui.busy = true;
    render();
    const scope = scopeKey(), draft = ui.draft;
    const items = draft.rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, needs: r.needs || null, quantity: r.quantity, ownedQuantity: r.ownedQuantity, from: r.from }));
    let saved = false;
    try {
      const res = await api.put('/api/kit', asActor({ goalId: getState().goal.id, expectedRevision: draft.baseRevision, readId: draft.readId, items }));
      if (scope === scopeKey() && ui.draft === draft) { finish(); saved = true; }
      applyState(res.state);
    } catch (error) {
      if (scope === scopeKey() && ui.draft === draft) {
        say('error', error.message);
        // Someone else saved meanwhile: show their list now, so the choice below is made knowing what it is.
        if (error.code === 'kit_changed') { try { applyState(await api.get('/api/state')); } catch { /* the live update will show it */ } }
      }
    } finally {
      ui.busy = false;
      render();
    }
    if (saved) { say('ok', 'Saved for the family. Nothing was bought or paid.'); $('kit-saved-title')?.focus(); }
    else if (ui.draft === draft && getState().kit.revision !== draft.baseRevision) $('kit-keep').focus();
  }
  // Someone else saved the list meanwhile: the adult decides, deliberately, which list to keep.
  function keepDraft() {
    const kit = getState().kit;
    const ids = new Set(kit.items.map((i) => i.id));
    for (const row of ui.draft.rows) if (row.id && !ids.has(row.id)) { row.id = null; row.from = row.source; }
    ui.draft.baseRevision = kit.revision;
    say('info', 'Your draft is kept. Saving it will replace the list just saved.');
    render();
    $('kit-save').focus();
  }
  function finish() {
    clearPhoto();
    ui.draft = null;
    ui.mode = 'view';
    ui.edits++;
    $('kit-rows').replaceChildren();
    $('kit-problems').replaceChildren();
  }
  function cancel() {
    const had = Boolean(ui.draft) || Boolean(ui.photo);
    finish();
    $('kit-text').value = '';
    render();
    if (had) say('info', 'Discarded. Nothing was saved.');
    ($('kit-edit').offsetParent ? $('kit-edit') : $('kit-text')).focus();
  }
  function toText() {
    const text = ui.draft ? asText(ui.draft.rows) : $('kit-text').value;
    if (ui.draft) {
      const parsed = parseKitText(text);
      const count = (n) => Number.isSafeInteger(n) ? n : null;
      // Literal typed syntax cannot represent every editable name/detail (for example a semicolon in details).
      // Check the result before discarding the photo or draft; never turn punctuation into extra shopping items.
      const same = !parsed.problem && parsed.lines.length === ui.draft.rows.length && parsed.lines.every((line, i) => {
        const row = ui.draft.rows[i];
        return line.name === cleanKitText(row.name) && (line.needs ?? '') === cleanKitText(row.needs)
          && line.quantity === count(row.quantity) && line.ownedQuantity === count(row.ownedQuantity);
      });
      if (!same) {
        say('info', 'This draft cannot be converted to typed text without changing its details. Keep editing the lines here.');
        ($('kit-rows').querySelector('input[data-key="name"]') ?? $('kit-draft-title')).focus();
        return;
      }
    }
    finish();
    ui.mode = 'source';
    $('kit-text').value = text;
    render();
    $('kit-text').focus();
  }

  // ---- What everyone sees: the saved list ----
  function drawSaved(kit) {
    const box = $('kit-saved');
    // Redraw only when what it shows changed, so a live re-read never moves focus or scrolls a list being read. The key
    // names whose list it is (household, goal and person): another one's list is always drawn, whatever it shares.
    const shownKey = JSON.stringify([scopeKey(), kit.revision, kit.savedAt, adult(), nameOf(kit.savedBy)]);
    if (box.dataset.shown === shownKey) return;
    box.dataset.shown = shownKey;
    if (!kit.items.length) {
      box.replaceChildren(h('p', { class: 'fine' }, adult() ? 'No kit list yet.' : 'No kit list yet. Adults in the family make it.'));
      return;
    }
    const sources = new Set(kit.items.map((i) => i.source));
    const how = sources.size > 1 ? 'Typed and read from a photo' : sources.has('photo') ? 'Read from a photo' : 'Typed';
    box.replaceChildren(
      h('p', { class: 'kit-saved-title', id: 'kit-saved-title', tabindex: '-1' }, 'Saved list'),
      h('ul', { class: 'kit-saved-list', 'aria-labelledby': 'kit-saved-title' }, ...kit.items.map((item) => h('li', {},
        h('span', { class: 'kit-item-name' }, item.name, item.needs ? h('span', { class: 'kit-item-needs' }, item.needs) : null),
        h('span', { class: 'kit-item-counts' }, `Need ${item.quantity} · Have ${item.ownedQuantity} · To get `, h('strong', {}, String(item.remaining)))))),
      h('p', { class: 'kit-saved-note' }, `${how}, checked and saved by ${nameOf(kit.savedBy)} · ${time(kit.savedAt)}. “Have” is what the family says it already has; nothing is bought or paid.`));
  }

  function render() { draw(); onRender(); }
  function draw() {
    const state = getState();
    if (!state?.kit) return;
    const key = scopeKey();
    if (ui.scope !== key) {
      // Another person, goal or household: typed text, an open draft or a photo belonged to the old one and is dropped,
      // unsaved, and so is a message about the old one's list. Text is unsaved work only while its box was shown, not
      // what a save or a discard left in the hidden box.
      const typing = !$('kit-source').hidden && $('kit-text').value.trim() !== '';
      const dropped = ui.scope !== null && Boolean(ui.draft || ui.photo || typing);
      ui.scope = key;
      finish();
      $('kit-text').value = '';
      say(dropped ? 'info' : '', dropped ? 'The draft was for another person or goal, so it was discarded. Nothing was saved.' : '');
    }
    const kit = state.kit;
    const toGet = kit.items.filter((i) => i.remaining > 0).length;
    $('kit-count').textContent = kit.items.length ? `${kit.items.length} item${kit.items.length === 1 ? '' : 's'} · ${toGet} still to get` : '';
    drawSaved(kit);
    const canEdit = adult();
    const drafting = canEdit && ui.mode === 'draft' && ui.draft;
    // While drafting, the saved list shows only when someone else saved a newer one, to compare before choosing.
    $('kit-saved').hidden = Boolean(drafting) && kit.revision === ui.draft.baseRevision;
    // Text or a photo this adult began in the empty list's box (still shown from the last render) stays open when
    // another adult saves the first list meanwhile: their list shows above it, and nothing is saved until this adult
    // checks it and saves. With nothing entered, the box closes as before.
    if (canEdit && ui.mode === 'view' && kit.items.length && !$('kit-source').hidden && ($('kit-text').value.trim() || ui.photo)) ui.mode = 'source';
    const sourcing = canEdit && !drafting && (ui.mode === 'source' || !kit.items.length);
    $('kit-saved-actions').hidden = !canEdit || drafting || sourcing || !kit.items.length;
    $('kit-source').hidden = !sourcing;
    $('kit-source-cancel').hidden = !kit.items.length;
    const photoOn = state.modes?.kit?.mode === 'live';
    $('kit-photo').hidden = !photoOn;
    $('kit-photo-off').hidden = photoOn;
    $('kit-read').hidden = $('kit-photo-note').hidden = $('kit-photo-clear').hidden = !ui.photo;
    $('kit-read').disabled = ui.busy || Boolean(ui.controller);
    $('kit-draft').hidden = !drafting;
    if (!drafting) return;
    const d = ui.draft;
    const notes = [];
    if (d.from === 'photo') notes.push('Read from the photo: check every line against it. A count that could not be read is left blank.');
    if (d.moreLines) notes.push('The reading says some lines could not be read, so add any that are missing.');
    if (d.replaces) notes.push('Saving replaces the saved list.');
    $('kit-draft-note').textContent = notes.join(' ');
    $('kit-to-text').hidden = d.from !== 'photo';
    // The photo stays in view while its lines are checked against it.
    const photo = $('kit-draft-photo');
    if (d.from === 'photo' && ui.photo) { if (photo.getAttribute('src') !== ui.photo.dataUrl) photo.src = ui.photo.dataUrl; photo.hidden = false; }
    else { photo.removeAttribute('src'); photo.hidden = true; }
    // A newer list was saved by someone else since this draft began: shown, never silently merged or overwritten.
    const changed = kit.revision !== d.baseRevision;
    $('kit-conflict').hidden = !changed;
    if (changed) $('kit-conflict-text').textContent = `${nameOf(kit.savedBy)} saved the kit list while you were editing. Your draft is not saved.`;
    $('kit-save').disabled = ui.busy || changed;
  }

  $('kit-check').addEventListener('click', checkTyped);
  $('kit-text').addEventListener('input', () => { ui.edits++; });
  $('kit-photo-input').addEventListener('change', choosePhoto);
  $('kit-read').addEventListener('click', readPhoto);
  $('kit-photo-clear').addEventListener('click', () => { clearPhoto(); render(); $('kit-photo-input').focus(); });
  $('kit-add').addEventListener('click', addRow);
  $('kit-save').addEventListener('click', saveDraft);
  $('kit-cancel').addEventListener('click', cancel);
  $('kit-source-cancel').addEventListener('click', cancel);
  $('kit-to-text').addEventListener('click', toText);
  $('kit-keep').addEventListener('click', keepDraft);
  $('kit-use-saved').addEventListener('click', () => { finish(); render(); say('info', 'Your draft was discarded; the saved list is shown.'); $('kit-edit').focus(); });
  $('kit-edit').addEventListener('click', () => startDraft(getState().kit.items.map((item) => rowOf(item, item.source)), { from: 'saved' }));
  $('kit-new').addEventListener('click', () => { finish(); ui.mode = 'source'; $('kit-text').value = ''; render(); $('kit-text').focus(); });

  // Whether the list itself is being edited here (typing, a photo or a draft open), so nothing else competes with it.
  const editing = () => !$('kit-source').hidden || !$('kit-draft').hidden;
  return { render, editing };
}
