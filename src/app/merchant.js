// Market Town merchant: one small dialog that searches Channel3 through this app's server, only when asked.
// The browser never holds a Channel3 key. Browsing never changes the goal, credits money or opens an area: "Use as goal"
// only hands the chosen result to the Plan form as an unsaved draft the family reviews and confirms there.
import { api } from './api.js';
import { formatCents, parseAmountToCents } from '../core/rules.js';
import { ceilingText, needLines, problemText } from '../core/family-fit.js';

const $ = (selector, root = document) => root.querySelector(selector);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el; // Provider text is only ever added as text nodes, never as HTML.
}

const AVAILABILITY = { InStock: 'In stock', OutOfStock: 'Out of stock' };
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const price = (r) => (r.priceCents === null ? 'No price returned' : `${formatCents(r.priceCents, r.currency)} ${r.currency}`);
const sourceNote = (checkedAt) => `Channel3 catalog checked ${clock(checkedAt)}; retailer price and stock may differ. Tax/shipping extra. We may earn a commission from these links.`;
const day = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const money = (cents) => formatCents(cents);

/** Facts that stay next to a result wherever it is shown: price and currency, merchant, returned availability. */
export function resultFacts(r) {
  return [price(r), r.merchant, AVAILABILITY[r.availability] ?? 'Availability not returned', r.condition === 'used' && 'Used'].filter(Boolean);
}

/**
 * @param options.getState () => current app state (for the connection mode)
 * @param options.onUse (result) => void — receives the chosen usable result; must not save anything by itself
 * @param options.onShortlist ({ draftId, expectedGoalId, replaceId }) => Promise — saves a shown result as a family choice
 * @param options.canShortlist () => boolean — whether the member acting here may change the family choices (adults)
 * @param options.fitSource () => { reserveCents, reserveInvalid, preview, memberId } | null — the family-fit inputs on
 *   this page: the one-off amount being tried and a preview of the planning price ceiling (the server derives its own)
 */
export function createMerchantDialog({ getState, onUse, onShortlist = null, canShortlist = () => false, fitSource = () => null }) {
  const dialog = $('#merchant-dialog');
  const form = $('#merchant-form');
  const status = $('#merchant-status');
  const list = $('#merchant-results');
  const source = $('#merchant-source');
  let origin = null;
  let seq = 0; // Only the newest search may change the list; older answers are dropped.
  let controller = null;
  let leaving = false; // "Use as goal" moves focus to the Plan draft instead of back to the map.
  let retailerWindow = null;
  let replacing = null; // { id, title }: a family choice this search may replace (opened from its Replace button)
  // Family-fit mode (opened from Family choices): { kinds, kind, detail, chosen: [{ key, values: Set }] }. Null otherwise.
  let fit = null;
  // The need being refined is kept between openings on this page, for the same household, goal and adult. Results never are.
  let fitMemory = null;
  const fitScope = () => { const s = getState(); return JSON.stringify([s?.household?.id ?? null, s?.goal?.id ?? null, fitSource()?.memberId ?? null]); };
  let kindSeq = 0; // only the newest category look-up may change the choices shown

  const connected = () => getState()?.modes?.merchant?.mode === 'live';
  function say(kind, text) { status.dataset.kind = kind; status.textContent = text; }

  function renderConnection() {
    const on = connected();
    for (const el of form.elements) el.disabled = !on;
    if (!on) {
      say('off', 'The merchant isn’t open yet: product search is not connected.'); // setup steps: docs/CHANNEL3-MERCHANT.md
      list.replaceChildren();
      source.hidden = true;
    } else if (status.dataset.kind === 'off') say('', '');
    renderFit();
  }

  // ---- Family fit: the planning limit line, then the optional kind of item and up to two must-haves ----
  function renderFit() {
    const limit = $('#merchant-fit-limit');
    limit.hidden = !fit;
    $('#merchant-need').hidden = !fit || !connected();
    $('#merchant-search').textContent = fit ? 'Find options that fit' : 'Search';
    $('#merchant-budget').closest('label').querySelector('span').firstChild.textContent = fit ? 'Lower price limit ' : 'Budget ';
    if (!fit) return;
    const src = fitSource();
    const preview = src?.preview ?? null;
    limit.textContent = !preview ? 'The family’s offers are not available here, so options cannot be matched to the date.'
      : `Family fit · ${ceilingText(preview, { money, date: day })}`;
    $('#merchant-search').disabled = !connected() || !preview || preview.outcome !== 'ok' || Boolean(src?.reserveInvalid);
    renderNeed();
  }

  function renderNeed() {
    const kindField = $('#merchant-kind-field'), select = $('#merchant-kind');
    kindField.hidden = !fit.kinds.length;
    select.replaceChildren(h('option', { value: '' }, 'Any kind of item (price and date only)'),
      ...fit.kinds.map((k) => h('option', { value: k.slug, selected: k.slug === fit.kind }, `${k.title}${k.path.length > 1 ? ` — ${k.path.slice(0, -1).join(' › ')}` : ''}`)));
    select.value = fit.kind;
    $('#merchant-show-needs').hidden = !fit.kind || fit.detail?.slug === fit.kind;
    const box = $('#merchant-must-haves');
    const focusKey = box.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const note = $('#merchant-need-note');
    const detail = fit.detail?.slug === fit.kind ? fit.detail : null;
    note.hidden = !detail;
    if (!detail) { box.replaceChildren(); return; }
    if (!detail.attributes.length) {
      box.replaceChildren();
      note.textContent = `The catalog lists no must-haves this app can check for ${detail.title}, so options are matched on the kind of item, price and date only.`;
      return;
    }
    note.textContent = 'Optional. An option is suggested only when the catalog reports an accepted value; missing or unclear facts are not treated as a match.';
    const rows = [];
    for (let i = 0; i < 2; i++) {
      if (i === 1 && !fit.chosen[0]?.key) break; // a second must-have once the first is chosen
      const chosen = fit.chosen[i] ?? { key: '', values: new Set() };
      const others = fit.chosen.filter((c, j) => j !== i && c.key).map((c) => c.key);
      const attribute = detail.attributes.find((a) => a.key === chosen.key);
      const pick = h('select', { 'data-focus-key': `must-${i}`, onchange: (e) => { fit.chosen[i] = { key: e.currentTarget.value, values: new Set() }; if (!e.currentTarget.value) fit.chosen.splice(i); renderNeed(); } },
        h('option', { value: '' }, 'None'), ...detail.attributes.filter((a) => !others.includes(a.key)).map((a) => h('option', { value: a.key, selected: a.key === chosen.key }, a.name)));
      pick.value = chosen.key;
      const values = attribute ? h('fieldset', { class: 'merchant-values' }, h('legend', {}, `Accepted ${attribute.name}`),
        ...attribute.values.map((v) => h('label', { class: 'merchant-value' }, h('input', { type: 'checkbox', value: v, checked: chosen.values.has(v), 'data-focus-key': `must-${i}-${v}`,
          onchange: (e) => { if (e.currentTarget.checked) chosen.values.add(v); else chosen.values.delete(v); fit.chosen[i] = chosen; } }), ` ${v}`))) : null;
      rows.push(h('div', { class: 'merchant-must-have' }, h('label', { class: 'merchant-field' }, h('span', {}, `Must-have ${i + 1} `, h('small', {}, '(optional)')), pick), values));
    }
    box.replaceChildren(...rows);
    if (focusKey) box.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  async function findKinds() {
    if (!fit) return;
    const query = $('#merchant-query').value.trim().replace(/\s+/g, ' ');
    if (query.length < 2) { say('error', 'Describe the item in a few words first, like “tent”.'); $('#merchant-query').focus(); return; }
    const mine = ++kindSeq;
    say('working', 'Looking up kinds of item…');
    try {
      const res = await api.post('/api/merchant/categories', { query });
      if (mine !== kindSeq || !fit) return;
      Object.assign(fit, { kinds: res.categories, kind: '', detail: null, chosen: [] });
      renderNeed();
      say(res.categories.length ? '' : 'empty', res.categories.length ? `Choose a kind of item for “${res.query}”, or search on price and date alone.`
        : `The catalog has no kind of item for “${res.query}”. You can still search on price and date alone.`);
      if (res.categories.length) $('#merchant-kind').focus();
    } catch (error) { if (mine === kindSeq) say('error', error.message); }
  }

  async function showNeeds() {
    const slug = fit?.kind;
    if (!slug) return;
    const mine = ++kindSeq;
    say('working', 'Getting the must-haves the catalog lists…');
    try {
      const res = await api.post('/api/merchant/category', { slug });
      if (mine !== kindSeq || !fit || fit.kind !== slug) return;
      Object.assign(fit, { detail: res.category, chosen: [] });
      renderNeed();
      say('', '');
      ($('#merchant-must-haves select') ?? $('#merchant-kind')).focus();
    } catch (error) {
      if (mine !== kindSeq) return;
      if (error.code === 'category_unknown' && fit) { Object.assign(fit, { kinds: [], kind: '', detail: null, chosen: [] }); renderNeed(); }
      say('error', error.message);
    }
  }

  function fitLines(r) {
    const lines = [];
    if (r.fit.check.category.status === 'match') lines.push(`Kind: ${r.fit.needSpec.category.title}`);
    lines.push(...needLines(r.fit.check));
    const ceiling = r.fit.context?.ceilingCents;
    if (r.fit.status === 'suitable') {
      lines.push(r.covered ? 'Already covered by recorded progress'
        : r.finishDate ? `Finishes ${day(r.finishDate)} at the adults’ offers, within ${money(ceiling)}` : `Within ${money(ceiling)}`);
    } else {
      lines.push(`No longer suggested: ${problemText(r.fit.problems[0], { need: r.fit.needSpec, ceilingCents: ceiling, money })}`);
    }
    return lines;
  }

  function open(from, { query = null, budgetCents = null, replaceChoice = null, fit: wantFit = false } = {}) {
    origin = from ?? document.activeElement;
    leaving = false;
    replacing = replaceChoice;
    if (wantFit && fitMemory?.scope !== fitScope()) fitMemory = { scope: fitScope(), kinds: [], kind: '', detail: null, chosen: [] };
    fit = wantFit ? fitMemory : null;
    kindSeq++;
    seq++; controller?.abort();
    retailerWindow?.close(); retailerWindow = null;
    list.replaceChildren(); source.hidden = true; // old offers are never presented as current on reopening
    say('', '');
    if (query !== null) {
      $('#merchant-query').value = query;
      $('#merchant-budget').value = Number.isSafeInteger(budgetCents) ? (budgetCents / 100).toFixed(2) : '';
      list.replaceChildren(); source.hidden = true;
      say('', 'Search again for a current price.');
    }
    renderConnection();
    if (replacing && connected()) say('', `Search for an item to replace “${replacing.title}” among the family choices.`);
    if (fit && connected()) say('', 'Describe the item, then search. Choosing a kind of item and its must-haves is optional.');
    if (!dialog.open) dialog.showModal();
    (connected() ? $('#merchant-query') : $('#merchant-title')).focus();
  }

  function close() { if (dialog.open) dialog.close(); }

  function row(r, context) {
    const name = h('h3', { class: 'merchant-item-name', id: `merchant-item-${r.productId}` }, r.title);
    const placeholder = () => h('span', { class: 'merchant-item-image empty', 'aria-hidden': 'true' });
    const picture = r.image
      ? h('img', { class: 'merchant-item-image', src: r.image.url, alt: r.image.alt, width: 64, height: 64, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e) => e.currentTarget.replaceWith(placeholder()) })
      : placeholder();
    const facts = resultFacts(r);
    const meta = h('p', { class: 'merchant-item-meta' }, h('strong', {}, facts[0]), ...facts.slice(1).map((f) => ` · ${f}`));
    const notes = [r.overBudget && !r.fit && 'Over your budget', !r.usable && r.priceCents !== null && r.unusableReason].filter(Boolean); // a missing price is already said once
    const ref = { referenceId: r.referenceId ?? r.draftId, goalId: context.goalId };
    // In family-fit mode, "Cheaper options" would search without the family's needs, so it is not offered there.
    const cheaper = !fit && r.currency === 'USD' && Number.isSafeInteger(r.priceCents) && h('button', { type: 'button', class: 'link-button', onclick: () => lookup('alternatives', ref, context) }, 'Cheaper options');
    const suits = !r.fit || r.fit.status === 'suitable';
    const why = r.fit ? h('ul', { class: 'merchant-fit-why', 'data-status': r.fit.status, 'aria-label': 'How this fits the family' }, ...fitLines(r).map((line) => h('li', {}, line))) : null;
    const selection = (r.selection ?? []).map((v) => `${v.name}: ${v.label}`).join(' · ');
    const more = h('details', { class: 'merchant-item-more' }, h('summary', {}, 'Details'),
      h('p', {}, [r.brand, selection, r.otherOffers ? `${r.otherOffers} other ${r.otherOffers === 1 ? 'retailer' : 'retailers'}` : null].filter(Boolean).join(' · ')),
      h('button', { type: 'button', class: 'link-button', onclick: () => lookup('refresh', ref, context) }, 'Check price & stock'),
      r.url && r.usable && h('button', { type: 'button', class: 'link-button', onclick: () => lookup('refresh', ref, context, { visit: r }) }, `Visit ${r.merchant}`, h('span', { class: 'sr-only' }, ' (checks the item and opens a retailer site in a new tab)')));
    const actions = h('div', { class: 'merchant-item-actions' }, cheaper, more, suits ? shortlistButton(r, context) : null);
    const use = h('button', { type: 'button', class: 'merchant-use', disabled: !r.usable || !suits, 'aria-describedby': name.id }, 'Use as goal');
    if (r.usable && suits) use.addEventListener('click', () => { leaving = true; close(); onUse({ ...r, ...context }); });
    return h('li', { class: 'merchant-item', 'data-product': r.productId, 'data-fit': r.fit?.status ?? null },
      picture,
      h('div', { class: 'merchant-item-text' }, name, meta, why, notes.length ? h('p', { class: 'merchant-item-note' }, notes.join(' · ')) : null, actions),
      use);
  }

  // A shown result an adult may save as a family choice. Only references travel: the server copies its own result.
  function shortlistButton(r, context) {
    const fc = getState()?.familyChoices;
    if (!onShortlist || !fc || !r.usable || !r.draftId || !canShortlist()) return null;
    const selection = JSON.stringify(r.selection ?? []);
    const same = fc.choices.find((c) => c.productId === r.productId && c.merchant === r.merchant && (c.condition ?? null) === (r.condition ?? null) && JSON.stringify(c.selection ?? []) === selection);
    const full = fc.choices.length >= fc.maxChoices;
    const label = same ? 'Update this family choice' : replacing ? `Replace “${replacing.title}”` : full ? `Family choices full (${fc.maxChoices})` : 'Add to family choices';
    const button = h('button', { type: 'button', class: 'link-button merchant-shortlist', disabled: !same && !replacing && full, 'aria-describedby': `merchant-item-${r.productId}` }, label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      const replaced = same ? null : replacing;
      try {
        const res = await onShortlist({ draftId: r.draftId, expectedGoalId: context.goalId, replaceId: replaced?.id });
        const count = getState()?.familyChoices?.choices.length ?? 0;
        say('ok', res.outcome === 'replaced' ? `Replaced “${replaced.title}” in the family choices.` : res.outcome === 'updated' ? 'Family choice updated with this price.' : `Added to the family choices (${count} of ${fc.maxChoices}).`);
        if (res.outcome === 'replaced') replacing = null;
        button.textContent = 'In the family choices';
      } catch (error) {
        say('error', error.message);
        button.disabled = false;
      }
    });
    return button;
  }

  function showResults(res, context) {
    list.replaceChildren(...res.results.map(r => row(r, { ...context, goalId: res.goalId, goalRevision: res.goalRevision })));
    source.textContent = sourceNote(res.checkedAt);
    source.hidden = !res.results.length;
  }

  async function lookup(action, reference, context = {}, { visit = null } = {}) {
    const text = $('#merchant-budget').value.trim();
    const budgetCents = text ? parseAmountToCents(text) : null;
    if (action === 'alternatives' && text && budgetCents === null) { say('error', 'Enter a budget in dollars.'); $('#merchant-budget').focus(); return; }
    const mine = ++seq;
    controller?.abort(); controller = new AbortController();
    retailerWindow?.close(); retailerWindow = null;
    // Reserve a user-initiated window before the asynchronous lookup. It never receives an old saved offer URL.
    if (visit) {
      retailerWindow = window.open('about:blank', '_blank');
      if (!retailerWindow) { say('error', 'Allow a new tab to visit the retailer, then try again.'); return; }
      retailerWindow.opener = null;
    }
    list.replaceChildren(); source.hidden = true; list.setAttribute('aria-busy', 'true');
    say('working', action === 'alternatives' ? 'Finding cheaper options…' : 'Checking price & stock…');
    try {
      const res = await api.post(`/api/merchant/${action}`, { ...reference, ...(action === 'alternatives' ? { budgetCents } : {}) }, { signal: controller.signal });
      if (mine !== seq) return;
      showResults(res, context);
      if (action === 'alternatives') {
        say(res.results.length ? 'ok' : 'empty', res.results.length ? `Cheaper options · Up to ${formatCents(res.budgetCents)}` : 'No cheaper in-stock options within this budget.');
      } else {
        const item = res.results[0];
        const changed = Number.isSafeInteger(item.previousPriceCents) && item.previousPriceCents !== item.priceCents;
        say('ok', !item.usable ? (item.unusableReason ?? 'Review this item.') : changed ? `Price changed: ${formatCents(item.previousPriceCents)} → ${price(item)}. Your goal is unchanged.` : 'Channel3 listing checked.');
        if (visit && retailerWindow) {
          if (item.usable && item.url && item.priceCents === visit.priceCents && item.currency === visit.currency && item.availability === visit.availability) {
            retailerWindow.location.replace(item.url);
            retailerWindow = null;
          } else say('info', 'The offer changed. Review it before visiting the retailer.');
        }
      }
      status.tabIndex = -1; status.focus();
    } catch (error) {
      if (mine === seq && error.name !== 'AbortError') say('error', error.message);
    } finally {
      if (mine === seq) { list.removeAttribute('aria-busy'); retailerWindow?.close(); retailerWindow = null; }
    }
  }

  function openSaved(from) {
    const state = getState(), item = state.goalItem;
    if (!item) return;
    open(from, { query: item.title.slice(0, 80), budgetCents: state.goal.targetCents });
    return lookup('refresh', { saved: true, goalId: state.goal.id });
  }

  // Up to three suitable options for the family's date. The page sends the words, the optional kind and must-haves, the
  // one-off amount being tried and the comparison it shows; the server derives the ceiling and judges every item.
  async function fitSearch() {
    const src = fitSource();
    if (!src?.preview || src.preview.outcome !== 'ok' || src.reserveInvalid) { renderFit(); return; }
    const query = $('#merchant-query').value.trim().replace(/\s+/g, ' ');
    const budgetText = $('#merchant-budget').value.trim();
    const budgetCents = budgetText ? parseAmountToCents(budgetText) : null;
    $('#merchant-budget').toggleAttribute('aria-invalid', Boolean(budgetText) && budgetCents === null);
    if (query.length < 2) { say('error', 'Describe what the item is in a few words, like “tent”.'); $('#merchant-query').focus(); return; }
    if (budgetText && budgetCents === null) { say('error', 'Enter the price limit in dollars, like 140.00, or leave it empty.'); $('#merchant-budget').focus(); return; }
    const detail = fit.detail?.slug === fit.kind ? fit.detail : null;
    const mustHaves = detail ? fit.chosen.filter((c) => c.key && c.values.size).map((c) => ({ key: c.key, values: detail.attributes.find((a) => a.key === c.key).values.filter((v) => c.values.has(v)) })) : [];
    if (detail && fit.chosen.some((c) => c.key && !c.values.size)) { say('error', 'Tick at least one accepted value for each must-have, or set it to None.'); return; }
    const state = getState(), revision = state.familyChoices?.revision;
    const mine = ++seq;
    controller?.abort(); controller = new AbortController();
    list.replaceChildren(); source.hidden = true; list.setAttribute('aria-busy', 'true');
    say('working', 'Asking Channel3, then checking each item against the family’s needs…');
    try {
      const res = await api.post('/api/family-choices/fit', { query, budgetCents, category: fit.kind || null, mustHaves, reserveCents: src.reserveCents, revision,
        ...(state.access ? {} : { memberId: src.memberId }) }, { signal: controller.signal });
      if (mine !== seq || !fit) return;
      // Answers about older offers, progress or dates are not shown as current.
      if (getState().familyChoices?.revision !== revision) { say('info', 'The family’s offers, goal or progress changed while searching. Search again with the latest figures.'); return; }
      const context = { goalId: res.goalId, goalRevision: res.goalRevision, searchQuery: res.query, searchBudgetCents: budgetCents };
      list.replaceChildren(...res.results.map((r) => row(r, context)));
      const others = res.others.length ? h('details', { class: 'merchant-fit-others' },
        h('summary', {}, `Why ${res.others.length} other ${res.others.length === 1 ? 'item is' : 'items are'} not suggested`),
        h('ul', {}, ...res.others.map((o) => h('li', {}, `${o.title}: ${problemText(o.reason, { need: res.need, ceilingCents: res.ceiling.ceilingCents, money })}`)))) : null;
      if (others) list.append(h('li', { class: 'merchant-fit-others-row' }, others));
      const by = `by ${day(res.ceiling.targetDate)} within ${money(res.ceiling.ceilingCents)}`;
      say(res.results.length ? 'ok' : 'empty', res.results.length
        ? `${res.results.length} ${res.results.length === 1 ? 'option fits' : 'options fit'} the family’s needs ${by} (${res.inspected} checked).${res.moreSuitable ? ` ${res.moreSuitable} more suitable not shown.` : ''}`
        : `None of the ${res.inspected} items Channel3 returned fit the family’s needs ${by}. Nothing was loosened to fill the list.`);
      source.textContent = sourceNote(res.checkedAt);
      source.hidden = !res.results.length;
    } catch (error) {
      if (mine !== seq || error.name === 'AbortError') return;
      list.replaceChildren(); source.hidden = true;
      // The catalog's must-have list for this kind of item expired on the server: ask for it again before searching.
      if (error.code === 'category_needs_check' && fit) { Object.assign(fit, { detail: null, chosen: [] }); renderNeed(); }
      say('error', error.message);
    } finally {
      if (mine === seq) list.removeAttribute('aria-busy');
    }
  }

  async function search(event) {
    event?.preventDefault();
    if (!connected()) { renderConnection(); return; }
    if (fit) { fitSearch(); return; }
    const mine = ++seq;
    controller?.abort(); controller = null;
    retailerWindow?.close(); retailerWindow = null;
    list.replaceChildren(); source.hidden = true;
    list.removeAttribute('aria-busy');
    const query = $('#merchant-query').value.trim().replace(/\s+/g, ' ');
    const budgetText = $('#merchant-budget').value.trim();
    const budgetCents = budgetText ? parseAmountToCents(budgetText) : null;
    $('#merchant-budget').toggleAttribute('aria-invalid', Boolean(budgetText) && budgetCents === null);
    if (query.length < 2) { say('error', 'Describe what you are looking for in a few words.'); $('#merchant-query').focus(); return; }
    if (budgetText && budgetCents === null) { say('error', 'Enter the budget in dollars, like 200.00, or leave it empty.'); $('#merchant-budget').focus(); return; }
    controller = new AbortController();
    list.setAttribute('aria-busy', 'true');
    say('working', 'Asking Channel3…');
    try {
      const res = await api.post('/api/merchant/search', { query, budgetCents }, { signal: controller.signal });
      if (mine !== seq) return;
      const context = { goalId: res.goalId, goalRevision: res.goalRevision, searchQuery: res.query, searchBudgetCents: res.budgetCents };
      list.replaceChildren(...res.results.map(r => row(r, context)));
      if (!res.results.length) {
        say('empty', `No matches for “${res.query}”${res.budgetCents ? ` under ${formatCents(res.budgetCents)}` : ''}. Try other words${res.budgetCents ? ' or a higher budget' : ''}.`);
        source.hidden = true;
      } else {
        say('ok', `${res.results.length} ${res.results.length === 1 ? 'result' : 'results'} for “${res.query}”${res.budgetCents ? ` · Budget ${formatCents(res.budgetCents)}` : ''}.`);
        // Channel3's required link disclosure sits with the links; the price facts stay with the results.
        source.textContent = sourceNote(res.checkedAt);
        source.hidden = false;
      }
    } catch (error) {
      if (mine !== seq || error.name === 'AbortError') return;
      list.replaceChildren();
      source.hidden = true;
      say('error', error.message);
    } finally {
      if (mine === seq) list.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('submit', search);
  $('#merchant-find-kinds').addEventListener('click', findKinds);
  $('#merchant-show-needs').addEventListener('click', showNeeds);
  $('#merchant-kind').addEventListener('change', (e) => { if (!fit) return; Object.assign(fit, { kind: e.currentTarget.value, detail: null, chosen: [] }); renderNeed(); });
  // Escape closes the merchant from any field (a search box would otherwise only clear its text).
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); close(); } });
  $('#merchant-close').addEventListener('click', close);
  // Closing (button or Escape) stops waiting for any search and returns focus to what opened the merchant.
  // A close event that arrives after the dialog was opened again belongs to the earlier opening and is ignored.
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    seq++; kindSeq++;
    controller?.abort();
    retailerWindow?.close(); retailerWindow = null;
    list.removeAttribute('aria-busy');
    if (status.dataset.kind === 'working') say('', '');
    if (leaving) return;
    const target = origin?.isConnected && !origin.closest('[hidden]') ? origin : $('#district-menu summary');
    target?.focus();
  });
  // A live family update while the dialog is open refreshes the limit line only; it never searches.
  const refreshFit = () => { if (fit && dialog.open) renderFit(); };
  return { open, openSaved, close, renderConnection, refreshFit };
}
