// Market Town merchant: one small dialog that searches Channel3 through this app's server, only when asked.
// The browser never holds a Channel3 key. Browsing never changes the goal, credits money or opens an area: "Use as goal"
// only hands the chosen result to the Plan form as an unsaved draft the family reviews and confirms there.
import { api } from './api.js';
import { formatCents, parseAmountToCents } from '../core/rules.js';

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

/** Facts that stay next to a result wherever it is shown: price and currency, merchant, returned availability. */
export function resultFacts(r) {
  return [price(r), r.merchant, AVAILABILITY[r.availability] ?? 'Availability not returned', r.condition === 'used' && 'Used'].filter(Boolean);
}

/**
 * @param options.getState () => current app state (for the connection mode)
 * @param options.onUse (result) => void — receives the chosen usable result; must not save anything by itself
 */
export function createMerchantDialog({ getState, onUse }) {
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
  }

  function open(from, { query = null, budgetCents = null } = {}) {
    origin = from ?? document.activeElement;
    leaving = false;
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
    if (!dialog.open) dialog.showModal();
    (connected() ? $('#merchant-query') : $('#merchant-title')).focus();
  }

  function close() { if (dialog.open) dialog.close(); }

  function row(r, context) {
    const name = h('h3', { class: 'merchant-item-name', id: `merchant-item-${r.productId}` }, r.title);
    const picture = r.image
      ? h('img', { class: 'merchant-item-image', src: r.image.url, alt: r.image.alt, width: 64, height: 64, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'merchant-item-image empty', 'aria-hidden': 'true' });
    const facts = resultFacts(r);
    const meta = h('p', { class: 'merchant-item-meta' }, h('strong', {}, facts[0]), ...facts.slice(1).map((f) => ` · ${f}`));
    const notes = [r.overBudget && 'Over your budget', !r.usable && r.priceCents !== null && r.unusableReason].filter(Boolean); // a missing price is already said once
    const ref = { referenceId: r.referenceId ?? r.draftId, goalId: context.goalId };
    const cheaper = r.currency === 'USD' && Number.isSafeInteger(r.priceCents) && h('button', { type: 'button', class: 'link-button', onclick: () => lookup('alternatives', ref, context) }, 'Cheaper options');
    const selection = (r.selection ?? []).map((v) => `${v.name}: ${v.label}`).join(' · ');
    const more = h('details', { class: 'merchant-item-more' }, h('summary', {}, 'Details'),
      h('p', {}, [r.brand, selection, r.otherOffers ? `${r.otherOffers} other ${r.otherOffers === 1 ? 'retailer' : 'retailers'}` : null].filter(Boolean).join(' · ')),
      h('button', { type: 'button', class: 'link-button', onclick: () => lookup('refresh', ref, context) }, 'Check price & stock'),
      r.url && r.usable && h('button', { type: 'button', class: 'link-button', onclick: () => lookup('refresh', ref, context, { visit: r }) }, `Visit ${r.merchant}`, h('span', { class: 'sr-only' }, ' (checks the item and opens a retailer site in a new tab)')));
    const actions = h('div', { class: 'merchant-item-actions' }, cheaper, more);
    const use = h('button', { type: 'button', class: 'merchant-use', disabled: !r.usable, 'aria-describedby': name.id }, 'Use as goal');
    if (r.usable) use.addEventListener('click', () => { leaving = true; close(); onUse({ ...r, ...context }); });
    return h('li', { class: 'merchant-item', 'data-product': r.productId },
      picture,
      h('div', { class: 'merchant-item-text' }, name, meta, notes.length ? h('p', { class: 'merchant-item-note' }, notes.join(' · ')) : null, actions),
      use);
  }

  function showResults(res, context) {
    list.replaceChildren(...res.results.map(r => row(r, { ...context, goalId: res.goalId, goalRevision: res.goalRevision })));
    source.textContent = `Channel3 prices and stock, checked ${clock(res.checkedAt)}; tax and shipping not included. We may earn a commission when you buy through links on this page.`;
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
        say('ok', !item.usable ? (item.unusableReason ?? 'Review this item.') : changed ? `Price changed: ${formatCents(item.previousPriceCents)} → ${price(item)}. Your goal is unchanged.` : 'Price & stock checked.');
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

  async function search(event) {
    event?.preventDefault();
    if (!connected()) { renderConnection(); return; }
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
        source.textContent = `Channel3 prices and stock, checked ${clock(res.checkedAt)}; tax and shipping not included. We may earn a commission when you buy through links on this page.`;
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
  // Escape closes the merchant from any field (a search box would otherwise only clear its text).
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); close(); } });
  $('#merchant-close').addEventListener('click', close);
  // Closing (button or Escape) stops waiting for any search and returns focus to what opened the merchant.
  // A close event that arrives after the dialog was opened again belongs to the earlier opening and is ignored.
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    seq++;
    controller?.abort();
    retailerWindow?.close(); retailerWindow = null;
    list.removeAttribute('aria-busy');
    if (status.dataset.kind === 'working') say('', '');
    if (leaving) return;
    const target = origin?.isConnected && !origin.closest('[hidden]') ? origin : $('#district-menu summary');
    target?.focus();
  });
  return { open, openSaved, close, renderConnection };
}
