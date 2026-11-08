// Family choices in the Plan journal. A family:
// - compares up to three items from Market Town against each adult's own weekly offer, the household's weekly amount
//   and the goal's date;
// - says which choice each member prefers;
// - can try a one-off expense on the page alone.
// Only explicit buttons write, and only planning records. "Review this choice" hands a server-checked draft to the
// existing Plan form; nothing here saves a goal, moves money or searches by itself. "Propose this schedule" (the current goal
// only) saves the dated weeks shown here as a plan proposal; "Use this plan" in the Plan journal stays the decision.
import { api } from './api.js';
import { RESERVE_LIMITS, choicesInput, compareChoices, describeComparison, familySchedule } from '../core/family-choices.js';
import { formatCents, parseAmountToCents } from '../core/rules.js';

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
  return el; // provider text is only ever added as text
}
const centsToInput = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const AVAILABILITY = { InStock: 'In stock', OutOfStock: 'Out of stock' };

/**
 * @param options.getState () => the app state
 * @param options.actor () => the member acting on this page ({ id, name, role }): the signed-in member, or the example persona
 * @param options.openMerchant (from, options) => opens Market Town (options.replaceChoice for a replacement)
 * @param options.onReview (answer) => hands the server-checked goal draft to the Plan form; saves nothing
 * @param options.applyState (state) => applies a server state
 * @param options.onProposed (plan) => called after a family schedule was proposed for the current goal
 */
export function createFamilyChoices({ getState, actor, openMerchant, onReview, applyState, onProposed = () => {} }) {
  const ui = { reserveCents: 0, reserveInvalid: false, offerDirty: false, offerActor: null, busy: false, review: 0, scope: null };
  const currency = () => getState()?.goal?.currency ?? 'USD';
  const money = (cents) => formatCents(cents, currency());
  const date = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const sameYear = y === Number(getState()?.familyChoices?.today?.slice(0, 4));
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
  };
  const time = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const status = $('family-status');
  function say(kind, text, action = null) {
    status.replaceChildren();
    if (!text) return;
    status.append(h('div', { class: `msg ${kind}` }, text, action ? h('div', { class: 'actions' }, action) : null));
  }
  // Example mode names its persona; a shared family's server takes the member from the session and refuses any other.
  const asActor = (body) => (getState().access ? body : { ...body, memberId: actor()?.id });
  const scopeKey = () => { const s = getState(); return JSON.stringify([s.household.id, s.goal.id, actor()?.id ?? null]); };

  async function send(call, success) {
    if (ui.busy) return;
    ui.busy = true;
    const key = scopeKey();
    try {
      const res = await call();
      applyState(res.state);
      if (scopeKey() === key) say('ok', success(res));
    } catch (error) {
      if (scopeKey() === key) say('error', error.message);
    } finally {
      ui.busy = false;
      render();
    }
  }

  const prefer = (choiceId) => send(() => api.put('/api/family-choices/preference', asActor({ choiceId })), () => 'Your preference is saved. It is a preference, not an approval.');
  const unprefer = () => send(() => api.post('/api/family-choices/preference/remove', asActor({})), () => 'Your preference is removed.');
  const remove = (choice) => send(() => api.post('/api/family-choices/remove', asActor({ choiceId: choice.id })), () => `${choice.title} is no longer a family choice.`);
  const check = (choice) => send(() => api.post('/api/family-choices/refresh', asActor({ choiceId: choice.id })), (res) => (!res.usable ? res.reason
    : res.previousPriceCents !== res.priceCents ? `Price changed: ${money(res.previousPriceCents)} → ${money(res.priceCents)}. Review the comparison again.` : 'Price checked. Prices and stock still change.'));

  // The current goal's weeks at these offers and this trial, saved as a proposal. The server recomputes them from its own
  // records and refuses if the comparison it was shown has changed; the one-off amount is the only figure sent.
  const propose = () => send(() => api.post('/api/plans/family', asActor({ reserveCents: ui.reserveCents, revision: getState().familyChoices.revision })),
    (res) => { onProposed(res.plan); return `Family schedule proposed for ${getState().goal.name}${ui.reserveCents ? `, with the one-off ${money(ui.reserveCents)} first` : ''}. Check its weeks in the plan below, then choose “Use this plan”. Nothing is paid.`; });

  function saveOffer() {
    const input = $('family-offer-input');
    const cents = parseAmountToCents(input.value);
    input.toggleAttribute('aria-invalid', cents === null);
    if (cents === null) { say('error', 'Enter your weekly offer in dollars and cents, like 20.00.'); input.focus(); return; }
    return send(() => api.put('/api/family-choices/offer', asActor({ weeklyCents: cents })), () => { ui.offerDirty = false; return `Your offer of ${money(cents)} a week is saved. Your family can see it.`; });
  }
  const withdraw = () => send(() => api.post('/api/family-choices/offer/withdraw', asActor({})), () => { ui.offerDirty = false; return 'Your weekly offer is withdrawn.'; });

  // The server checks the comparison this page shows, then returns a goal draft. A late answer is used only if the family,
  // member, comparison and trial are still the ones it was asked for.
  async function review(choice) {
    if (ui.reserveInvalid) return;
    const s = getState(), fc = s.familyChoices;
    const mine = ++ui.review;
    const asked = JSON.stringify([scopeKey(), fc.revision, ui.reserveCents]);
    say('working', 'Checking this choice with the latest records…');
    try {
      const res = await api.post('/api/family-choices/review', asActor({ choiceId: choice.id, revision: fc.revision, reserveCents: ui.reserveCents }));
      if (mine !== ui.review) return;
      if (JSON.stringify([scopeKey(), getState().familyChoices.revision, ui.reserveCents]) !== asked) {
        say('info', 'The choices changed while this was checked. Review the latest comparison, then choose again.');
        return;
      }
      say('', '');
      onReview(res);
    } catch (error) {
      if (mine !== ui.review) return;
      const action = error.code === 'choice_needs_check' && getState().modes?.merchant?.mode === 'live'
        ? h('button', { type: 'button', class: 'link-button', onclick: () => check(choice) }, `Check ${choice.title}’s price`) : null;
      say('error', error.message, action);
    }
  }

  function segmentLines(option, comparison) {
    const names = new Map(comparison.offers.map((o) => [o.memberId, o.name ?? 'An adult']));
    return option.segments.map((seg) => {
      const one = seg.fromWeek === seg.toWeek;
      const weeks = one ? `Week ${seg.fromWeek} (${date(seg.fromDate)})` : `Weeks ${seg.fromWeek}–${seg.toWeek} (${date(seg.fromDate)}–${date(seg.toDate)})`;
      if (seg.goalCents === 0) return `${weeks}: the one-off amount comes first`;
      const each = seg.perMember.filter((p) => p.cents > 0).map((p) => `${names.get(p.memberId)} ${money(p.cents)}`).join(' · ');
      return `${weeks}: ${each}${one ? '' : ' a week'}${seg.reservedCents ? `, after ${money(seg.reservedCents)} toward the one-off` : ''}`;
    });
  }

  function optionItem(option, { s, fc, comparison, text, me, adult, merchantOn }) {
    const result = h('p', { class: 'family-option-result' }, text.lines[option.id]);
    const change = text.changes[option.id] ? h('p', { class: 'family-option-change' }, text.changes[option.id]) : null;
    const split = option.segments.length ? h('ul', { class: 'family-split', 'aria-label': 'Weekly amounts by adult' }, ...segmentLines(option, comparison).map((line) => h('li', {}, line))) : null;
    if (option.id === 'goal') {
      // Only when these offers and this trial put something toward the goal by its date (otherwise there is nothing to propose).
      const own = adult ? familySchedule({ today: fc.today, targetDate: s.goal.targetDate, progressCents: s.progress.progressCents, targetCents: s.goal.targetCents,
        householdLimitCents: s.goal.weeklyBudgetCents, currency: s.goal.currency, offers: fc.offers, reserveCents: comparison.reserve.cents }) : null;
      const proposable = own && ['on_time', 'short'].includes(own.outcome);
      return h('li', { class: 'family-option current', 'data-status': option.status },
        h('div', { class: 'family-option-head' }, h('strong', {}, 'Current goal'), h('span', { class: 'family-option-price' }, money(option.priceCents))),
        h('p', { class: 'family-option-facts' }, s.goal.name), result, change, split,
        proposable ? h('div', { class: 'actions' }, h('button', { type: 'button', disabled: ui.reserveInvalid || ui.busy, 'data-focus-key': 'propose:goal', onclick: propose }, 'Propose this schedule')) : null);
    }
    const c = fc.choices.find((x) => x.id === option.id);
    const prefs = fc.preferences.filter((p) => p.choiceId === c.id);
    const mine = Boolean(me) && prefs.some((p) => p.memberId === me.id);
    const nameOf = (id) => (id === me?.id ? 'you' : s.members.find((m) => m.id === id)?.name ?? 'a member');
    const facts = [c.merchant, c.condition === 'used' ? 'Used' : c.condition === 'new' ? 'New' : null, ...(c.selection ?? []).map((v) => `${v.name}: ${v.label}`),
      AVAILABILITY[c.availability] ?? null, `${c.fresh ? 'checked' : 'last checked'} ${time(c.checkedAt)}`].filter(Boolean);
    return h('li', { class: 'family-option', 'data-choice': c.id, 'data-status': option.status },
      h('div', { class: 'family-option-head' }, h('strong', { class: 'family-option-name' }, c.title), h('span', { class: 'family-option-price' }, money(c.priceCents))),
      h('p', { class: 'family-option-facts' }, facts.join(' · '), c.fresh ? null : h('span', { class: 'family-stale' }, ' · check the price again before choosing it')),
      result, change, split,
      h('p', { class: 'family-prefs' }, prefs.length ? `${prefs.length} ${prefs.length === 1 ? 'prefers' : 'prefer'} this: ${prefs.map((p) => nameOf(p.memberId)).join(', ')}` : 'No one has said they prefer this yet.'),
      h('div', { class: 'actions' },
        me ? h('button', { type: 'button', class: 'family-prefer', 'aria-pressed': String(mine), 'data-focus-key': `prefer:${c.id}`, onclick: () => (mine ? unprefer() : prefer(c.id)) }, 'Prefer this') : null,
        adult ? h('button', { type: 'button', disabled: ui.reserveInvalid, 'data-focus-key': `review:${c.id}`, onclick: () => review(c) }, 'Review this choice') : null,
        adult && merchantOn && !c.fresh ? h('button', { type: 'button', class: 'link-button', 'data-focus-key': `check:${c.id}`, onclick: () => check(c) }, 'Check price') : null,
        adult && merchantOn ? h('button', { type: 'button', class: 'link-button', 'data-focus-key': `replace:${c.id}`, onclick: (e) => openMerchant(e.currentTarget, { query: c.title.replace(/…$/, '').slice(0, 80), replaceChoice: { id: c.id, title: c.title } }) }, 'Replace') : null,
        adult ? h('button', { type: 'button', class: 'link-button', 'data-focus-key': `remove:${c.id}`, onclick: () => remove(c) }, 'Remove') : null));
  }

  function render() {
    const s = getState();
    if (!s?.familyChoices) return;
    const fc = s.familyChoices, me = actor(), adult = me?.role === 'adult', merchantOn = s.modes?.merchant?.mode === 'live';
    if (ui.offerActor !== (me?.id ?? null)) { ui.offerActor = me?.id ?? null; ui.offerDirty = false; }
    // A one-off trial belongs to the member, household and goal it was typed for; it never carries over to another.
    if (ui.scope !== scopeKey()) {
      if (ui.scope !== null) { $('family-trial-input').value = ''; $('family-trial-input').removeAttribute('aria-invalid'); ui.reserveCents = 0; ui.reserveInvalid = false; }
      ui.scope = scopeKey();
    }
    $('family-choices-count').textContent = `${fc.choices.length} of ${fc.maxChoices} · ${fc.offers.length} weekly ${fc.offers.length === 1 ? 'offer' : 'offers'}`;
    const empty = fc.choices.length === 0;
    $('family-choices-empty').hidden = !empty;
    $('family-empty-text').textContent = !merchantOn ? 'Market Town is not connected here, so items cannot be added. Offers and the current goal can still be compared.'
      : adult ? 'No choices yet. Find an item in Market Town and add it here.' : 'No choices yet. An adult adds items from Market Town.';
    $('family-find').hidden = !(merchantOn && adult);

    // The one-off trial is the adult's own, on this page only: the same arithmetic, never sent until a choice is reviewed.
    const reserveCents = adult ? ui.reserveCents : 0;
    const comparison = reserveCents ? compareChoices(choicesInput({ goal: s.goal, progress: s.progress, today: fc.today, choices: fc.choices, offers: fc.offers, reserveCents })) : fc.comparison;
    const titles = Object.fromEntries([['goal', `the current goal (${s.goal.name})`], ...fc.choices.map((c) => [c.id, c.title])]);
    const text = describeComparison(comparison, { money, date, titles });
    $('family-capacity').textContent = text.capacity;
    const list = $('family-options');
    list.dataset.trial = reserveCents ? 'true' : 'false';
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    list.replaceChildren(...comparison.options.map((option) => optionItem(option, { s, fc, comparison, text, me, adult, merchantOn })));
    if (focusKey) list.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    const note = $('family-choice-note');
    note.hidden = !text.choices;
    note.textContent = text.choices ?? '';

    $('family-offer-list').replaceChildren(...(fc.offers.length
      ? fc.offers.map((o) => h('li', {}, `${o.name}${o.memberId === me?.id ? ' (you)' : ''}: ${money(o.weeklyCents)} a week`))
      : [h('li', { class: 'empty' }, 'No weekly offers yet.')]));
    $('family-my-offer').hidden = !adult;
    $('family-offer-note').hidden = adult;
    if (adult) {
      const saved = fc.offers.find((o) => o.memberId === me.id);
      const input = $('family-offer-input');
      if (!ui.offerDirty && document.activeElement !== input) input.value = saved ? centsToInput(saved.weeklyCents) : '';
      $('family-offer-withdraw').hidden = !saved;
    }
    $('family-trial').hidden = !adult;
    $('family-trial-note').textContent = reserveCents ? `${text.reserve} Not saved.` : '';
  }

  $('family-offer-input').addEventListener('input', () => { ui.offerDirty = true; });
  $('family-offer-save').addEventListener('click', saveOffer);
  $('family-offer-withdraw').addEventListener('click', withdraw);
  $('family-trial-input').addEventListener('input', (e) => {
    ++ui.review; // Any edit cancels an in-flight review, even while the last valid amount stays unchanged.
    const value = e.currentTarget.value.trim();
    const cents = value ? parseAmountToCents(value) : 0;
    ui.reserveInvalid = cents === null || cents > RESERVE_LIMITS.maxCents;
    if (ui.reserveInvalid) e.currentTarget.setAttribute('aria-invalid', 'true');
    else { e.currentTarget.removeAttribute('aria-invalid'); ui.reserveCents = cents; }
    say(ui.reserveInvalid ? 'error' : '', ui.reserveInvalid
      ? `Enter a one-off amount between ${money(0)} and ${money(RESERVE_LIMITS.maxCents)}. The comparison keeps your last valid amount.` : '');
    render();
  });
  $('family-trial-clear').addEventListener('click', () => {
    ++ui.review;
    $('family-trial-input').value = '';
    $('family-trial-input').removeAttribute('aria-invalid');
    ui.reserveCents = 0;
    ui.reserveInvalid = false;
    say('', '');
    render();
    $('family-trial-input').focus();
  });
  $('family-find').addEventListener('click', (e) => openMerchant(e.currentTarget, {}));
  return { render, get reserveCents() { return ui.reserveCents; } };
}
