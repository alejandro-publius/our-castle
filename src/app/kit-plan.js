// Complete kits, in the Plan journal's Kit list. A family:
// - adds up to three catalog listings for each item still to get (Market Town, opened for that item), saying how many
//   items one listing gives: the adult's own count, never inferred from a title;
// - compares complete kits against its own weekly offers, the household's weekly amount, the goal's date and the one-off
//   amount being tried in Family choices: up to three distinct kits that fit, or what is missing or short;
// - chooses a kit and keeps the lines it has agreed on; later comparisons hold kept lines and show the smallest change;
// - may order the kits that fit by a preference, with Cohere, when this server has that set up;
// - reviews the chosen kit into the Plan form as an unsaved goal draft with its family schedule.
// Only "Choose this kit", "Keep" and the listing buttons save anything, and only planning records. Comparing, ordering
// and reviewing save nothing. Every figure shown comes from the server's answer or the same arithmetic it uses.
import { api } from './api.js';
import { formatCents } from '../core/rules.js';
import { compareChoices } from '../core/family-choices.js';
import { ceilingText, fitCeiling } from '../core/family-fit.js';
import { lineCost, weightText } from '../core/kit-plan.js';

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
  return el; // catalog and family text is only ever added as text
}

const LABELS = { smallest_change: 'Smallest change', lowest_total: 'Lowest listed total', lower_weight: 'Lower listed weight', fewest_retailers: 'Fewest shops',
  preference: 'Closest to your preference' };
const ISSUES = { outdated: 'the item changed on the list since this was added', price_unusable: 'not priced in the goal’s currency', out_of_stock: 'out of stock at its last check',
  stock_unknown: 'stock not reported', need_misses: 'no longer meets the must-haves it was found for', need_unknown: 'its must-haves can no longer be confirmed', removed: 'removed' };
const AVAILABILITY = { InStock: 'in stock', OutOfStock: 'out of stock' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RECOMPARE_MS = 350;

/**
 * @param options.getState () => the app state
 * @param options.actor () => the member acting on this page: the signed-in member, or the example persona
 * @param options.applyState (state) => applies a server state
 * @param options.openMerchant (from, options) => opens Market Town; options.kitLine adds results to one line
 * @param options.reserve () => { cents, invalid }: the one-off amount being tried in Family choices
 * @param options.onReview (answer) => hands the server-checked kit draft to the Plan form; saves nothing
 * @param options.listEditing () => whether the kit list itself is being edited (the planner then stays out of the way)
 */
export function createKitPlan({ getState, actor, applyState, openMerchant, reserve, onReview, listEditing }) {
  const ui = { answer: null, asked: null, seq: 0, busy: false, scope: null, timer: null };
  const currency = () => getState()?.goal?.currency ?? 'USD';
  const money = (cents) => formatCents(cents, currency());
  const date = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const sameYear = y === Number(getState()?.familyChoices?.today?.slice(0, 4));
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
  };
  const time = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const status = $('kit-plan-status');
  function say(kind, text) {
    status.replaceChildren();
    if (text) status.append(h('div', { class: `msg ${kind}` }, text));
  }
  const asActor = (body) => (getState().access ? body : { ...body, memberId: actor()?.id });
  const scopeKey = () => { const s = getState(); return JSON.stringify([s.household.id, s.goal.id, actor()?.id ?? null]); };
  const adult = () => actor()?.role === 'adult';
  // What a comparison is asked for: the kit as the page shows it, the family's figures and the one-off being tried.
  const ask = () => { const s = getState(); return { revision: s.kitPlan.revision, choicesRevision: s.familyChoices.revision, reserveCents: reserve().cents }; };
  const askKey = (a) => JSON.stringify([scopeKey(), a.revision, a.choicesRevision, a.reserveCents]);
  const stale = () => Boolean(ui.answer) && ui.asked !== askKey(ask());

  async function send(call, success, { recompare = false } = {}) {
    if (ui.busy) return false;
    ui.busy = true;
    const key = scopeKey();
    let ok = false;
    try {
      const res = await call();
      applyState(res.state);
      if (scopeKey() === key) { say('ok', success(res)); ok = true; }
    } catch (error) {
      if (scopeKey() === key) say('error', error.message);
    } finally {
      ui.busy = false;
      render();
    }
    if (ok && recompare && ui.answer) compare();
    return ok;
  }

  const remove = (c) => send(() => api.post('/api/kit/listings/remove', asActor({ candidateId: c.id })), () => `${c.title} is no longer a listing for this kit.`, { recompare: true });
  const check = (c) => send(() => api.post('/api/kit/listings/refresh', asActor({ candidateId: c.id })), (res) => (!res.usable ? res.reason
    : res.previousPriceCents !== res.priceCents ? `Price changed: ${money(res.previousPriceCents)} → ${money(res.priceCents)}. Compare the kits again.` : 'Price checked. Prices and stock still change.'));
  const choose = async (kit) => {
    const done = await send(() => api.put('/api/kit/choice', asActor({ revision: getState().kitPlan.revision, lines: kit.lines.map((l) => ({ lineId: l.lineId, candidateId: l.candidateId })) })),
      () => 'This is now the family’s chosen kit. Nothing is bought or paid.', { recompare: true });
    if (done) $('kit-plan-chosen-title')?.focus();
  };
  const keep = (line, kept) => send(() => api.put('/api/kit/keep', asActor({ revision: getState().kitPlan.revision, lineId: line.lineId, kept })),
    () => (kept ? `${line.name} is kept as it is: comparisons will not change it.` : `${line.name} is no longer kept.`), { recompare: true });

  // Compare (or order by a preference). Read-only on the server. A late answer is shown only if the household, member,
  // kit, figures and one-off amount are still the ones it was asked for.
  async function compare({ preference = null, focus = false } = {}) {
    clearTimeout(ui.timer);
    if (!adult()) return;
    if (reserve().invalid) { say('error', 'Fix the one-off amount in Family choices first.'); return; }
    const mine = ++ui.seq, asked = ask(), key = askKey(asked);
    say('working', preference ? 'Asking Cohere to order the kits that fit…' : 'Comparing complete kits…');
    try {
      const res = await api.post(preference ? '/api/kit/prefer' : '/api/kit/compare', asActor({ ...asked, ...(preference ? { preference } : {}) }));
      if (mine !== ui.seq) return;
      if (askKey(ask()) !== key) { say('info', 'The kit or the family’s figures changed while comparing. Compare again with the latest.'); return; }
      ui.answer = res; ui.asked = key;
      say(res.preference?.status === 'failed' ? 'error' : '', res.preference?.status === 'failed' || res.preference?.status === 'not_needed' ? res.preference.message : '');
      render();
      if (focus) $('kit-plan-note').focus();
    } catch (error) {
      if (mine !== ui.seq) return;
      say('error', error.message);
    }
  }
  /** The one-off amount in Family choices changed: recompute a shown comparison (no catalog or model call). */
  function reserveChanged() {
    if (!ui.answer || !adult()) { render(); return; }
    clearTimeout(ui.timer);
    ui.seq++; // an answer for the old amount is no longer wanted
    render();
    ui.timer = setTimeout(() => compare(), RECOMPARE_MS);
  }

  async function review() {
    if (!adult() || reserve().invalid) return;
    const mine = ++ui.seq, asked = ask(), key = askKey(asked);
    say('working', 'Checking the chosen kit with the latest records…');
    try {
      const res = await api.post('/api/kit/review', asActor(asked));
      if (mine !== ui.seq) return;
      if (askKey(ask()) !== key) { say('info', 'The kit or the family’s figures changed while it was checked. Review it again.'); return; }
      say('', '');
      onReview(res);
    } catch (error) {
      if (mine === ui.seq) say('error', error.message);
    }
  }

  // ---- Drawing ----
  function finishText(f) {
    switch (f.status) {
      case 'fits': return `Finishes ${date(f.finishDate)} (week ${f.finishWeek}), on time for ${date(f.deadline)}.`;
      case 'covered': return 'Recorded progress already covers this listed total. That progress is a record, not money in hand.';
      case 'late': return `Keeping this kit: finishes ${date(f.finishDate)}, ${plural(f.weeksLate, 'week')} after ${date(f.deadline)}. Keeping the date: ${money(f.shortfallCents)} short by then.`;
      case 'beyond_limit': return `Needs more than 52 weeks at these offers; ${money(f.shortfallCents)} short by ${date(f.deadline)}.`;
      default: return 'No finish date until an adult offers a weekly amount.';
    }
  }
  const listingLine = (l) => `${l.name}: ${l.title} · ${l.merchant} · ${l.listings} × ${money(l.priceCents)}`
    + `${l.perListing > 1 ? ` (${l.perListing} in each, ${l.bought} in all${l.surplus ? `, ${l.surplus} spare` : ''})` : ''} = ${money(l.lineCents)}`;

  function kitItem(k, a, { closest, isStale, mayChoose }) {
    const chosen = getState().kitPlan.selection?.lines ?? [];
    const isChosen = chosen.length === k.lines.length && k.lines.every((l) => chosen.some((c) => c.lineId === l.lineId && c.candidateId === l.candidateId));
    const labels = closest ? ['Closest complete kit'] : k.labels.map((l) => LABELS[l]);
    const facts = [a.pool?.weightComparable && k.weightMg !== null ? `items to get weigh ${weightText(k.weightMg)} as listed` : null,
      `${k.retailers === 1 ? 'one shop' : `${k.retailers} shops`} (${k.merchants.join(', ')})`,
      k.changes !== null && a.current && !a.current.fits && !closest ? `${plural(k.changes, 'line')} switched from the chosen kit` : null].filter(Boolean);
    const switched = k.lines.filter((l) => l.switched).map((l) => h('li', {}, `Switched ${l.name}: ${l.switched.title} → ${l.title}`
      + `${l.switched.listings !== l.listings ? ` (${l.switched.listings} → ${l.listings} listings)` : ''}, ${money(l.switched.lineCents)} → ${money(l.lineCents)}`));
    const excerpt = k.labels.includes('preference') && a.preference?.excerpt ? h('p', { class: 'fine' }, `Cohere’s match in the listing titles: “${a.preference.excerpt}”`) : null;
    return h('li', { class: 'kit-plan-kit', 'data-kit': k.key, 'data-fits': String(k.fits) },
      h('div', { class: 'kit-plan-kit-head' }, h('strong', {}, labels.join(' · ')), h('span', { class: 'kit-plan-kit-total' }, money(k.totalCents))),
      h('p', { class: 'kit-plan-kit-finish' }, finishText(k.finish)),
      h('ul', { class: 'kit-plan-kit-lines', 'aria-label': 'Listings in this kit' }, ...k.lines.map((l) => h('li', {}, listingLine(l), l.kept ? h('small', {}, ' · kept') : null))),
      switched.length ? h('ul', { class: 'kit-plan-kit-changes', 'aria-label': 'What changes from the chosen kit' }, ...switched) : null,
      h('p', { class: 'fine' }, `${facts.join(' · ').replace(/^./, (c) => c.toUpperCase())}.`), excerpt,
      mayChoose ? h('div', { class: 'actions' }, h('button', { type: 'button', disabled: isStale || ui.busy || isChosen, 'data-focus-key': `choose:${k.key}`, onclick: () => choose(k) },
        isChosen ? 'The chosen kit' : 'Choose this kit')) : null);
  }

  function resultNote(a) {
    switch (a.status) {
      case 'ok': return `${a.kits.length === 1 ? 'One complete kit fits' : `${a.kits.length} different complete kits fit`} by ${date(a.ceiling.targetDate)}${a.reserveCents ? `, after the one-off ${money(a.reserveCents)}` : ''}.`;
      case 'none_fits': return `No complete kit fits ${money(a.ceiling.ceilingCents)} by ${date(a.ceiling.targetDate)}${a.reserveCents ? ` after the one-off ${money(a.reserveCents)}` : ''}. The closest one, and what keeping it or keeping the date would mean:`;
      case 'incomplete': return `A kit is compared only when every item still to get has a listing that can be used. Add one for: ${a.missing.map((m) => m.name).join(', ')}.`;
      case 'kept_unavailable': return `${a.kept.map((k) => `${k.name}: ${k.title ?? 'the kept listing'} is ${ISSUES[k.issue] ?? 'unavailable'}`).join('; ')}. It is kept, so nothing replaces it: stop keeping it or check its price, then compare again.`;
      case 'nothing_to_buy': return 'Everything on this list is already at home: nothing remains to buy on it.';
      default: return a.ceiling ? ceilingText(a.ceiling, { money, date }) : 'There is nothing to compare.';
    }
  }

  function renderResult(s, isAdult) {
    const a = ui.answer, box = $('kit-plan-result');
    box.hidden = !a;
    if (!a) return;
    const isStale = stale();
    $('kit-plan-note').textContent = `${resultNote(a)}${isStale ? ' These were compared before the latest change, so they cannot be chosen as they are. Compare again.' : ''}`;
    const cards = a.status === 'ok' ? a.kits : a.status === 'none_fits' && a.closest ? [a.closest] : [];
    const list = $('kit-plan-kits');
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    list.replaceChildren(...cards.map((k) => kitItem(k, a, { closest: a.status === 'none_fits', isStale, mayChoose: isAdult })));
    if (focusKey) list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    $('kit-plan-pool').textContent = a.pool ? `Compared all ${plural(a.pool.combinations, 'complete kit')} made from the ${plural(a.pool.listings, 'listing')} added (up to three for each item): `
      + 'not every shop online. Listed prices as last checked; tax and shipping are not included, and stock is not reserved. '
      + (a.pool.weightComparable ? 'Every listing reports a weight, so kits are also compared by the listed weight of the items to get.' : 'Not every listing reports a weight, so kits are not compared by weight.') : '';
    const prefer = $('kit-plan-prefer');
    prefer.hidden = !(isAdult && s.kitPlan.preference.mode === 'live' && a.status === 'ok' && a.pool.feasible >= 2 && !isStale);
    if (!prefer.hidden) {
      const select = $('kit-plan-preference'), chosen = select.value || a.preference?.key || 'light';
      if (!select.options.length) select.replaceChildren(...s.kitPlan.preference.options.map((o) => h('option', { value: o.key }, o.label)));
      select.value = chosen;
      $('kit-plan-prefer-note').textContent = a.preference?.status === 'ok'
        ? `Cohere ordered ${a.preference.ordered < a.preference.sent ? `${a.preference.ordered} of ` : ''}the ${plural(a.preference.sent, 'lowest-total kit')} that fit by “${a.preference.label}”, matching the listings’ titles. It is not a check of quality, weight or price.`
        : 'Sends only the listings’ titles and shops, with the preference you pick, to Cohere. Prices, dates and the family stay here.';
    }
  }

  function listingItem(c, line, isAdult, merchantOn) {
    const cost = lineCost(line.remaining, { listingCents: c.priceCents, perListing: c.perListing, weightMg: c.weightMg });
    const facts = [c.merchant, `${money(c.priceCents)} a listing`, `${c.perListing} in each (${c.perListingBy}’s count)`, c.weightMg ? `listed ${weightText(c.weightMg)}` : 'weight not listed',
      AVAILABILITY[c.availability] ?? 'stock not reported', `${c.fresh ? 'checked' : 'last checked'} ${time(c.checkedAt)}`];
    return h('li', { class: 'kit-plan-listing', 'data-listing': c.id, 'data-issue': c.issue },
      h('span', { class: 'kit-plan-listing-name' }, c.title),
      h('span', { class: 'kit-plan-listing-facts' }, facts.join(' · ')),
      h('span', { class: 'kit-plan-listing-buys' }, `For ${line.remaining}: ${plural(cost.listings, 'listing')}${cost.surplus ? ` (${cost.bought} items, ${cost.surplus} spare)` : ''} = ${money(cost.cents)}`),
      c.need ? h('span', { class: 'fine' }, `Found for: ${[c.need.category, ...c.need.mustHaves].filter(Boolean).join(', ')}`) : null,
      c.issue ? h('span', { class: 'kit-plan-issue' }, `Not compared: ${ISSUES[c.issue]}.`) : null,
      isAdult ? h('span', { class: 'actions' },
        merchantOn && (!c.fresh || c.issue) ? h('button', { type: 'button', class: 'link-button', 'data-focus-key': `check:${c.id}`, onclick: () => check(c) }, 'Check price') : null,
        h('button', { type: 'button', class: 'link-button', 'data-focus-key': `remove:${c.id}`, 'aria-label': `Remove ${c.title}`, onclick: () => remove(c) }, 'Remove')) : null);
  }

  function lineItem(line, plan, isAdult, merchantOn) {
    const head = h('div', { class: 'kit-plan-line-head' }, h('strong', {}, line.name), h('span', { class: 'kit-plan-need' }, line.remaining ? `To get: ${line.remaining}` : 'Already at home'));
    if (!line.remaining) return h('li', { class: 'kit-plan-line owned', 'data-line': line.lineId }, head, h('p', { class: 'fine' }, `The family has all ${line.quantity}, so no listing is needed.`));
    const find = isAdult && merchantOn && line.candidates.length < plan.maxPerLine
      ? h('button', { type: 'button', class: 'link-button', 'data-focus-key': `find:${line.lineId}`, 'aria-haspopup': 'dialog', 'aria-controls': 'merchant-dialog',
        onclick: (e) => openMerchant(e.currentTarget, { query: line.name.slice(0, 80), kitLine: { lineId: line.lineId, name: line.name, remaining: line.remaining } }) },
      line.candidates.length ? `Add a listing for ${line.name}` : `Find listings for ${line.name}`) : null;
    return h('li', { class: 'kit-plan-line', 'data-line': line.lineId }, head,
      line.needs ? h('p', { class: 'fine' }, `Details on the list: ${line.needs} (the family’s words; not checked against the catalog)`) : null,
      line.candidates.length ? h('ul', { class: 'kit-plan-listings' }, ...line.candidates.map((c) => listingItem(c, line, isAdult, merchantOn))) : h('p', { class: 'fine' }, 'No listing yet.'),
      find ? h('div', { class: 'actions' }, find) : null);
  }

  function renderChosen(s, isAdult) {
    const plan = s.kitPlan, sel = plan.selection, box = $('kit-plan-chosen');
    box.hidden = !sel;
    if (!sel) return;
    const needed = plan.lines.filter((l) => l.remaining > 0);
    let total = 0, usable = true;
    const items = sel.lines.map((pick) => {
      const line = plan.lines.find((l) => l.lineId === pick.lineId), c = line?.candidates.find((x) => x.id === pick.candidateId);
      if (!c) return null;
      const cost = lineCost(line.remaining, { listingCents: c.priceCents, perListing: c.perListing, weightMg: c.weightMg });
      total += cost.cents;
      if (c.issue) usable = false;
      const keepControl = isAdult
        ? h('button', { type: 'button', class: 'link-button kit-plan-keep', 'aria-pressed': String(pick.kept), 'aria-label': `Keep ${line.name} as it is`, 'data-focus-key': `keep:${line.lineId}`,
          onclick: () => keep(line, !pick.kept) }, pick.kept ? 'Kept' : 'Keep')
        : pick.kept ? h('small', {}, ' · kept') : null;
      return h('li', {}, h('span', {}, `${line.name}: ${c.title} · ${c.merchant} · ${cost.listings} × ${money(c.priceCents)} = ${money(cost.cents)}`),
        c.issue ? h('span', { class: 'kit-plan-issue' }, ` (${ISSUES[c.issue]})`) : null, keepControl);
    }).filter(Boolean);
    const list = $('kit-plan-chosen-lines');
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    list.replaceChildren(...items);
    if (focusKey) list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    const missing = needed.filter((l) => !sel.lines.some((p) => p.lineId === l.lineId));
    const fc = s.familyChoices;
    let finish = null;
    if (!missing.length && total > 0) {
      const tried = reserve().cents;
      const o = compareChoices({ today: fc.today, deadline: s.goal.targetDate, progressCents: s.progress.progressCents, householdLimitCents: s.goal.weeklyBudgetCents, currency: s.goal.currency,
        offers: fc.offers, reserveCents: tried, options: [{ id: 'kit', priceCents: total, currency: s.goal.currency }] }).options[0];
      // The date is this page's own estimate: the family's saved figures with only the one-off tried here (a child tries none,
      // and another member's trial is never shown), so two pages can differ.
      const estimate = ['fits', 'late', 'beyond_limit', 'covered'].includes(o.status)
        ? (tried ? ` This page’s estimate, after the one-off ${money(tried)} tried here.` : ' This page’s estimate, with no one-off tried here.') : '';
      finish = `${finishText({ ...o, deadline: s.goal.targetDate })}${estimate}`;
    }
    const who = [...new Set(sel.lines.map((p) => p.chosenBy))].join(' and ');
    $('kit-plan-chosen-note').textContent = missing.length ? `Chosen by ${who}. No listing is chosen yet for ${missing.map((l) => l.name).join(', ')}.`
      : `Chosen by ${who} · listed total ${money(total)}. ${finish ?? ''} Kept lines stay as they are in every comparison until an adult stops keeping them. Nothing is bought.`;
    $('kit-plan-review-actions').hidden = !(isAdult && !missing.length && usable);
    $('kit-plan-review').disabled = ui.busy || reserve().invalid;
  }

  function render() {
    const s = getState();
    if (!s?.kitPlan || !s.kit) return;
    if (ui.scope !== scopeKey()) { // another person, goal or household: a comparison and its message belonged to the old one
      if (ui.scope !== null) say('', '');
      ui.scope = scopeKey(); ui.answer = null; ui.asked = null; ui.seq++; clearTimeout(ui.timer);
    }
    const plan = s.kitPlan, isAdult = adult(), merchantOn = s.modes?.merchant?.mode === 'live';
    const needed = plan.lines.filter((l) => l.remaining > 0);
    const section = $('kit-plan');
    section.hidden = !s.kit.items.length || listEditing();
    if (section.hidden) return;
    $('kit-plan-intro').textContent = !needed.length ? 'Everything on this list is already at home: nothing remains to buy on it.'
      : !isAdult ? 'Adults add listings for each item still to get and compare complete kits. You can read them here.'
        : merchantOn ? 'For each item still to get, add up to three listings from Market Town, then compare whole kits against the family’s offers and date. Nothing is bought.'
          : 'Market Town is not connected here, so listings cannot be added. Listings already added can still be compared.';
    const lines = $('kit-plan-lines');
    const focusKey = lines.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    lines.replaceChildren(...plan.lines.map((line) => lineItem(line, plan, isAdult, merchantOn)));
    if (focusKey) lines.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    const fc = s.familyChoices;
    let preview = null;
    if (isAdult && needed.length && s.goal.currency === 'USD') {
      try { preview = fitCeiling({ today: fc.today, targetDate: s.goal.targetDate, progressCents: s.progress.progressCents, householdLimitCents: s.goal.weeklyBudgetCents, offers: fc.offers, reserveCents: reserve().cents }); } catch { preview = null; }
    }
    $('kit-plan-ceiling').textContent = preview ? `${ceilingText(preview, { money, date })}${reserve().cents ? ' The one-off amount is the one being tried in Family choices.' : ''}` : '';
    $('kit-plan-compare-actions').hidden = !(isAdult && needed.length);
    $('kit-plan-compare').disabled = ui.busy || reserve().invalid;
    renderResult(s, isAdult);
    renderChosen(s, isAdult);
  }

  $('kit-plan-compare').addEventListener('click', () => compare({ focus: true }));
  $('kit-plan-order').addEventListener('click', () => compare({ preference: $('kit-plan-preference').value, focus: true }));
  $('kit-plan-review').addEventListener('click', review);
  // The one-off amount lives in Family choices; the comparison follows it (its own handlers run first).
  $('family-trial-input').addEventListener('input', reserveChanged);
  $('family-trial-clear').addEventListener('click', reserveChanged);
  return { render };
}
