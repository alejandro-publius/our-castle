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

  function open(from) {
    origin = from ?? document.activeElement;
    leaving = false;
    renderConnection();
    if (!dialog.open) dialog.showModal();
    (connected() ? $('#merchant-query') : $('#merchant-title')).focus();
  }

  function close() { if (dialog.open) dialog.close(); }

  function row(r) {
    const name = h('h3', { class: 'merchant-item-name', id: `merchant-item-${r.productId}` }, r.title);
    const picture = r.image
      ? h('img', { class: 'merchant-item-image', src: r.image.url, alt: r.image.alt, width: 64, height: 64, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
      : h('span', { class: 'merchant-item-image empty', 'aria-hidden': 'true' });
    const facts = resultFacts(r);
    const meta = h('p', { class: 'merchant-item-meta' }, h('strong', {}, facts[0]), ...facts.slice(1).map((f) => ` · ${f}`));
    const notes = [r.overBudget && 'Over your budget', !r.usable && r.priceCents !== null && r.unusableReason].filter(Boolean); // a missing price is already said once
    const more = h('details', { class: 'merchant-item-more' }, h('summary', {}, 'Details'),
      h('p', {}, [r.brand, r.otherOffers ? `${r.otherOffers} other ${r.otherOffers === 1 ? 'retailer' : 'retailers'}` : null, `Channel3 product ${r.productId}`].filter(Boolean).join(' · ')),
      r.url && h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, `View at ${r.merchant}`, h('span', { class: 'sr-only' }, ' (opens a retailer site in a new tab)')));
    const use = h('button', { type: 'button', class: 'merchant-use', disabled: !r.usable, 'aria-describedby': name.id }, 'Use as goal');
    if (r.usable) use.addEventListener('click', () => { leaving = true; close(); onUse(r); });
    return h('li', { class: 'merchant-item', 'data-product': r.productId },
      picture,
      h('div', { class: 'merchant-item-text' }, name, meta, notes.length ? h('p', { class: 'merchant-item-note' }, notes.join(' · ')) : null, more),
      use);
  }

  async function search(event) {
    event?.preventDefault();
    if (!connected()) { renderConnection(); return; }
    const query = $('#merchant-query').value.trim().replace(/\s+/g, ' ');
    const budgetText = $('#merchant-budget').value.trim();
    const budgetCents = budgetText ? parseAmountToCents(budgetText) : null;
    $('#merchant-budget').toggleAttribute('aria-invalid', Boolean(budgetText) && budgetCents === null);
    if (query.length < 2) { say('error', 'Describe what you are looking for in a few words.'); $('#merchant-query').focus(); return; }
    if (budgetText && budgetCents === null) { say('error', 'Enter the budget in dollars, like 200.00, or leave it empty.'); $('#merchant-budget').focus(); return; }
    const mine = ++seq;
    controller?.abort();
    controller = new AbortController();
    list.setAttribute('aria-busy', 'true');
    say('working', 'Asking Channel3…');
    try {
      const res = await api.post('/api/merchant/search', { query, budgetCents }, { signal: controller.signal });
      if (mine !== seq) return;
      list.replaceChildren(...res.results.map(row));
      if (!res.results.length) {
        say('empty', `No matches for “${res.query}”${res.budgetCents ? ` under ${formatCents(res.budgetCents)}` : ''}. Try other words${res.budgetCents ? ' or a higher budget' : ''}.`);
        source.hidden = true;
      } else {
        say('ok', `${res.results.length} ${res.results.length === 1 ? 'result' : 'results'} for “${res.query}”.`);
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
    list.removeAttribute('aria-busy');
    if (status.dataset.kind === 'working') say('', '');
    if (leaving) return;
    const target = origin?.isConnected && !origin.closest('[hidden]') ? origin : $('#district-menu summary');
    target?.focus();
  });
  return { open, close, renderConnection };
}
