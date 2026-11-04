import { createBoardScene } from '../world/board-scene.js';
import { api, newRequestId } from './api.js';
import { bus } from './bus.js';
import { chargeIcon, crestChoices, crestSvg } from './crest.js';
import { TIERS, formatCents, formatPercent, parseAmountToCents, ROUTE_LENGTH } from '../core/rules.js';
import { mountPayPalButton } from './paypal-checkout.js';
import { createLedgerGrid } from './ledger-grid.js';
import { sound } from './sound.js';
import { newlyEarnedEstate } from '../core/rewards.js';
import { courtForTier } from '../core/court.js';

// ---------- small helpers ----------
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value; // only for our own SVG strings
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}
const money = (cents) => formatCents(cents, state?.goal?.currency ?? 'USD');
const centsToInput = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const dateLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const timeLabel = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pref = {
  get(key) { try { return localStorage.getItem(`our-castle:${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`our-castle:${key}`, value); } catch { /* private mode: fine */ } },
};

function setStatus(target, kind, message, extra = {}) {
  const box = typeof target === 'string' ? $(target) : target;
  box.replaceChildren();
  if (!message) return;
  const msg = h('div', { class: `msg ${kind}` }, message);
  if (extra.issues?.length) msg.append(h('ul', {}, extra.issues.map((i) => h('li', {}, i.message ?? String(i)))));
  if (extra.debugId) msg.append(h('span', { class: 'debug' }, `PayPal debug id: ${extra.debugId}`));
  if (extra.action) msg.append(h('div', { class: 'actions' }, extra.action));
  box.append(msg);
}

// ---------- state ----------
let state = null;
let scene = null;
let paypal = null;
let paypalMount = null;
let ledgerGrid = null;
const ui = {
  tab: 'house',
  personaId: pref.get('persona'),
  houseDraft: null,
  houseDirty: false,
  planFormDirty: false,
  scheduleDirty: false,
  schedulePlanId: null,
  commitments: [{ label: 'Internet bill', amount: '60.00', cadence: 'monthly' }],
  amountTouched: false,
  receipt: null,
  refundArm: null,
  celebrationTimer: null,
  ledgerFilter: 'all',
  stewardBusy: false,
  preview: null,
};
const persona = () => state?.members.find((m) => m.id === ui.personaId) ?? null;
const isSandbox = () => state?.modes.payments.mode === 'sandbox';
const ownership = () => ({ householdId: state.household.id, goalId: state.goal.id });

// How much of the world canvas the overlaid heading, view controls and caption cover, as fractions of its height.
// The board frames the island in the uncovered part, so nothing important hides behind them.
function worldInsets() {
  const world = $('#world').getBoundingClientRect();
  if (!world.height) return null;
  let top = 0; let bottom = 0;
  for (const el of $$('.board-heading, .world-navigation')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > world.top && r.top < world.top + world.height / 2) top = Math.max(top, r.bottom - world.top);
  }
  const foot = $('.board-foot').getBoundingClientRect();
  if (foot.height && foot.top < world.bottom) bottom = world.bottom - foot.top;
  return { top: (top + 8) / world.height, bottom: (bottom + 6) / world.height };
}

// ---------- boot ----------
async function boot() {
  try {
    // The board announces hops and tier rises on the bus; sound (and tests) listen. Nothing calls audio directly.
    scene = createBoardScene($('#world'), {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      onEvent: (type, detail) => bus.emit(`scene:${type}`, detail),
      insets: worldInsets,
    });
  } catch (error) {
    console.warn('[our-castle] 3D board unavailable', error);
    $('#world').hidden = true;
    $('#world-fallback').hidden = false;
    $('#pixel-toggle').hidden = true;
    $('#sound-toggle').hidden = true;
  }
  $('#world').setAttribute('aria-busy', 'false');
  buildCrestPickers();
  bindEvents();
  try {
    applyState(await api.get('/api/state'), { animate: false });
    selectTab(defaultTab(), { focus: false });
  } catch (error) {
    $('#honesty').textContent = `Could not load the household: ${error.message}`;
  }
  document.body.dataset.ready = 'true';
  window.__ourCastle = { get state() { return state; }, scene: () => scene?.debug() ?? null, route: () => scene?.routeOnScreen() ?? null, bus, sound: () => ({ enabled: sound.enabled, played: sound.played() }) };
  window.__booted = true;
}

function defaultTab() {
  if (!state.household.setupComplete) return 'house';
  if (!state.acceptedPlanId) return 'plan';
  return 'give';
}

// Announce only additions earned between two authoritative server states for the same goal (see rewards.js).
const newlyEarned = (previous, next) => (previous?.goal?.id === next?.goal?.id ? newlyEarnedEstate(previous?.rewards, next?.rewards) : []);

function applyState(next, { animate = true, result = null } = {}) {
  const added = newlyEarned(state, next);
  state = next;
  ui.preview = null;
  if (!persona()) ui.personaId = state.members.find((m) => m.role === 'adult')?.id ?? state.members[0]?.id;
  renderHeader();
  renderQuest();
  renderBoard({ animate, result, added });
  renderHouse();
  renderPlan();
  renderGive();
  renderLedger();
  renderRewards();
  renderTabs();
  renderFooter();
  bus.emit('state:applied', { result, added: added.map((r) => r.id) });
}

// ---------- header, quest, board ----------
function renderHeader() {
  const { household, modes, members } = state;
  $('#brand-crest').innerHTML = crestSvg(household.crest, { title: `${household.name} crest` });
  $('#house-eyebrow').textContent = household.setupComplete
    ? `${household.name} · ${household.playMode === 'family' ? 'Family' : 'Solo'} · example household`
    : 'A household adventure · example household';
  $('#mode-badges').replaceChildren(
    h('li', { class: `mode-badge ${modes.payments.mode === 'sandbox' ? 'live' : 'example'}`, title: modes.payments.mode === 'sandbox' ? 'Real PayPal sandbox API calls with test money' : 'No PayPal calls; payments are simulated and labeled' },
      modes.payments.mode === 'sandbox' ? 'PayPal sandbox' : 'Example payments · simulated'),
    h('li', { class: `mode-badge ${modes.ai.mode === 'live' ? 'live' : 'example'}`, title: modes.ai.mode === 'live' ? `Plans are written by ${modes.ai.model} and checked by the server` : 'Plans come from built-in rules; no AI is called' },
      modes.ai.mode === 'live' ? `AI planner · ${modes.ai.model}` : 'Example planner · no AI'),
  );
  const select = $('#persona');
  select.replaceChildren(...members.map((m) => h('option', { value: m.id, selected: m.id === ui.personaId }, `${m.name} (${m.role}, example)`)));
}

function renderQuest() {
  const { goal, progress, board } = state;
  $('#goal-name').textContent = goal.name;
  $('#progress-amount').textContent = money(progress.progressCents);
  $('#target-amount').textContent = money(goal.targetCents);
  const pct = Math.min(100, progress.percentTenths / 10);
  $('#meter-fill').style.width = `${pct}%`;
  const meter = $('#meter');
  meter.setAttribute('aria-valuemax', String(goal.targetCents / 100));
  meter.setAttribute('aria-valuenow', String(Math.min(goal.targetCents, progress.progressCents) / 100));
  meter.setAttribute('aria-valuetext', `${money(progress.progressCents)} of ${money(goal.targetCents)}, ${formatPercent(progress.progressCents, goal.targetCents)}`);
  $('#meter-ticks').replaceChildren(...board.tiers.slice(1).map((t) => h('span', { style: `left:calc(${t.percent}% - 1px)`, 'data-label': t.name })));
  const next = board.nextMilestone;
  $('#quest-next').textContent = next
    ? `Next: the ${next.name} at ${money(next.targetCents)} — ${money(next.awayCents)} to go.`
    : 'Goal reached. The castle stands.';
  const parts = [`${money(progress.startingCents)} reported by you`];
  if (progress.contributedCents) parts.push(`${money(progress.contributedCents)} confirmed in PayPal sandbox`);
  if (progress.simulatedContributedCents) parts.push(`${money(progress.simulatedContributedCents)} simulated`);
  if (progress.refundedCents + progress.simulatedRefundedCents) parts.push(`${money(progress.refundedCents + progress.simulatedRefundedCents)} refunded`);
  $('#progress-breakdown').textContent = `${parts.join(' · ')}. ${progress.note}`;
}

function renderBoard({ animate, result, added = [] }) {
  const { board, household, goal, progress } = state;
  const built = TIERS[board.builtTier];
  $('#board-title').textContent = board.tierTitle;
  $('#world-preview').hidden = true;
  $('#world').dataset.preview = 'false';
  let status = board.position >= ROUTE_LENGTH
    ? `Travelers are home at the castle gate (space ${ROUTE_LENGTH} of ${ROUTE_LENGTH}). `
    : `Travelers on space ${board.position} of ${ROUTE_LENGTH} · ${board.spaceName}. `;
  status += board.builtTierCommemorative
    ? `The ${built.name} commemorates a milestone reached earlier; current progress is ${formatPercent(progress.progressCents, goal.targetCents)}.`
    : `The ${built.name.toLowerCase()} stands at the center.`;
  if (board.gardens) status += ` ${board.gardens} garden bed${board.gardens === 1 ? '' : 's'} for bill habits.`;
  status += ` ${courtForTier(board.builtTier).capacity} guests roam the grounds.`;
  $('#board-status').textContent = status;
  $('#tier-track').replaceChildren(...board.tiers.map((t) => h('li', {
    class: [t.built ? 'built' : '', t.index === board.currentTier ? 'current' : ''].join(' ').trim(),
    'aria-current': t.index === board.currentTier ? 'step' : false,
  }, h('strong', {}, `${t.numeral} · ${t.name}`), t.percent ? money(t.targetCents) : 'Start')));
  if (!scene) return;
  scene.update({
    builtTier: board.builtTier,
    position: board.position,
    crest: household.crest,
    gardens: board.gardens,
    estateLevel: board.estateLevel ?? 0,
    previewFeature: null,
    playMode: household.playMode,
    milestoneSpaces: board.milestoneSpaces.map((m) => m.space),
  }, { animate }).then(() => {
    if (result?.awarded?.length || added.length) celebrate(result?.awarded ?? [], added);
  });
}

// ---------- Rewards and explicit, presentation-only previews ----------
const REWARD_LABELS = { unlocked: 'Unlocked', keepsake: 'Keepsake', locked: 'Locked', connection_required: 'Needs a provider connection' };
function renderRewards() {
  if (!state.rewards) { $('#reward-list').replaceChildren(h('p', { class: 'fine' }, 'Restart the server to load rewards.')); return; }
  $('#reward-evidence-note').textContent = `${state.rewards.billVerification.note} ${state.rewards.paymentEvidenceLabel}`;
  $('#reward-list').replaceChildren(...state.rewards.entries.map((reward) => {
    const card = h('article', { class: `reward-card reward-${reward.status}`, 'data-reward': reward.id, 'data-status': reward.status },
      h('div', { class: 'reward-heading' }, h('h4', {}, reward.name), h('span', { class: 'reward-state' }, REWARD_LABELS[reward.status] ?? reward.status)),
      h('p', { class: 'reward-detail' }, reward.detail),
      h('p', { class: 'reward-condition' }, `Unlocks when: ${reward.condition}`));
    if (reward.court) card.append(h('p', { class: 'reward-court' }, h('strong', {}, `${reward.court.capacity} wandering guests. `), reward.court.description));
    if (reward.source === 'goal_progress' && reward.requiredCents > 0) {
      card.append(h('p', { class: 'reward-progress' }, 'Progress: ', h('strong', {}, money(reward.progressCents)), ` of ${money(reward.requiredCents)}`,
        reward.remainingCents > 0 ? ` · ${money(reward.remainingCents)} to go` : ' · reached'));
    }
    if (reward.source === 'self_reported') card.append(h('p', { class: 'reward-progress' }, `${reward.count} of 4 garden beds planted`));
    card.append(h('p', { class: 'reward-source' }, `Evidence: ${reward.sourceLabel}`));
    if (reward.status === 'keepsake') card.append(h('p', { class: 'fine' }, 'Reached earlier and kept after a refund. Current goal progress is shown above and in the ledger.'));
    card.append(h('button', { type: 'button', class: 'reward-preview', onclick: () => previewReward(reward) },
      reward.status === 'unlocked' ? 'Show it in the world' : 'Preview in the world (art only)'));
    return card;
  }));
}
// A preview only redraws the board. It never calls the server, so it cannot change rewards, achievements or money.
function previewReward(reward) {
  if (!scene) return;
  ui.preview = reward.id;
  $('#world-preview').hidden = false;
  const previewTier = reward.previewTier ?? state.board.builtTier;
  const previewCourt = courtForTier(previewTier);
  $('#preview-title').textContent = `${reward.status === 'unlocked' ? 'Showing' : 'Preview'}: ${reward.name} · ${previewCourt.capacity} guests`;
  const royals = previewCourt.princesses.length;
  $('#board-status').textContent = `Art preview · ${previewCourt.capacity} wandering guests${royals ? `, including ${royals} princess${royals === 1 ? '' : 'es'}` : ''}. Your earned home remains the ${TIERS[state.board.builtTier].name.toLowerCase()}.`;
  $('#world').dataset.preview = 'true';
  $('#board-title').textContent = reward.status === 'unlocked' ? reward.name : 'Previewing a reward';
  scene.update({
    builtTier: previewTier,
    estateLevel: reward.previewEstateLevel ?? state.board.estateLevel,
    gardens: reward.previewFeature === 'habit-garden' ? 4 : state.board.gardens,
    previewFeature: reward.previewFeature ?? null,
  }, { animate: false });
  if (matchMedia('(max-width: 1180px)').matches) $('#world-preview').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
}

function celebrate(awarded, added = []) {
  const tiers = awarded.filter((a) => typeof a === 'number').sort();
  const gardens = awarded.filter((a) => typeof a === 'string' && a.startsWith('garden:'));
  const box = $('#celebration');
  const additions = added.map((r) => h('p', { class: 'celebration-addition', 'data-reward': r.id }, h('strong', {}, `${r.name}: `), r.detail));
  if (tiers.length) {
    const tier = TIERS[tiers.at(-1)];
    box.replaceChildren(h('h3', {}, `The ${tier.name} rises!`), h('p', {}, `${tier.percent}% of ${state.goal.name} reached. A keepsake was added to your ledger.`), ...additions);
  } else if (added.length) {
    const top = added.at(-1);
    box.replaceChildren(h('h3', {}, added.length === 1 ? `${top.name} added to your estate` : 'New additions to your estate'),
      h('p', {}, `${top.percent}% of ${state.goal.name} reached.`), ...additions);
    sound.cue('sprout');
  } else if (gardens.length) {
    box.replaceChildren(h('h3', {}, 'A garden bed is planted'), h('p', {}, 'For the bill habit you logged. Habits grow gardens; they are not savings.'));
  } else return;
  box.hidden = false;
  clearTimeout(ui.celebrationTimer);
  ui.celebrationTimer = setTimeout(() => { box.hidden = true; }, 7000);
}

// ---------- 1. House ----------
function buildCrestPickers() {
  $('#crest-fields').append(...crestChoices.fields.map((f) => h('label', { class: 'swatch' },
    h('input', { type: 'radio', name: 'crestField', value: f.key, 'aria-label': f.label }),
    h('span', { style: `background:${f.hex}` }, f.label))));
  $('#crest-charges').append(...crestChoices.charges.map((c) => h('label', { class: 'charge' },
    h('input', { type: 'radio', name: 'crestCharge', value: c.key, 'aria-label': c.label }),
    h('span', { html: `${chargeIcon(c.key)}<span>${c.label}</span>` }))));
}

function houseDraft() {
  if (!ui.houseDirty || !ui.houseDraft) {
    const { household } = state;
    ui.houseDraft = { playMode: household.playMode, name: household.name, crest: { ...household.crest } };
  }
  return ui.houseDraft;
}

function renderHouse() {
  const draft = houseDraft();
  const setup = state.household.setupComplete;
  const locked = state.contributions.some((c) => !['approval_canceled', 'failed'].includes(c.status));
  $('#house-heading').textContent = setup ? 'Your house' : 'Found your house';
  for (const input of $$('input[name="playMode"]')) {
    input.checked = input.value === draft.playMode;
    input.disabled = locked && input.value !== state.household.playMode;
  }
  const nameInput = $('#house-name');
  if (document.activeElement !== nameInput) nameInput.value = draft.name;
  for (const input of $$('input[name="crestField"]')) input.checked = input.value === draft.crest.field;
  for (const input of $$('input[name="crestCharge"]')) input.checked = input.value === draft.crest.charge;
  $('#crest-preview').innerHTML = crestSvg(draft.crest, { title: `${draft.name || 'Your house'} crest` });
  $('#save-house').textContent = setup ? 'Save house and crest' : 'Raise our banner';
}

async function saveHouse() {
  const draft = houseDraft();
  const name = $('#house-name').value.trim();
  if (name.length < 2) {
    $('#house-name').setAttribute('aria-invalid', 'true');
    setStatus('#house-status', 'error', 'Give your house a name of at least two letters.');
    $('#house-name').focus();
    return;
  }
  $('#house-name').removeAttribute('aria-invalid');
  const firstSetup = !state.household.setupComplete;
  $('#save-house').disabled = true;
  try {
    const res = await api.post('/api/setup', { playMode: draft.playMode, name, crest: draft.crest });
    ui.houseDirty = false;
    applyState(res.state);
    setStatus('#house-status', 'ok', firstSetup ? `${name} is founded. Next, plan the journey.` : 'House and crest saved.');
    if (firstSetup) selectTab('plan');
  } catch (error) {
    setStatus('#house-status', 'error', error.message);
  } finally {
    $('#save-house').disabled = false;
  }
}

// ---------- 2. Plan ----------
function renderPlan() {
  const { goal, progress, modes, plan } = state;
  $('#planner-lede').textContent = modes.ai.mode === 'live'
    ? `The AI planner (${modes.ai.model}) turns your inputs into a weekly plan with its arithmetic shown. The server re-checks every number before you see it, and nothing is paid automatically.`
    : 'Example planner: built-in rules write this plan. No AI is called until an AI key is added to the server’s .env file. Nothing is paid automatically.';
  $('#ask-planner').textContent = modes.ai.mode === 'live' ? 'Ask the AI planner' : 'Make an example plan';
  if (!ui.planFormDirty) {
    $('#goal-name-input').value = goal.name;
    $('#goal-target').value = centsToInput(goal.targetCents);
    $('#goal-starting').value = centsToInput(progress.startingCents);
    $('#goal-date').value = goal.targetDate;
    $('#goal-weekly').value = centsToInput(goal.weeklyBudgetCents);
    if (plan?.inputs?.commitments) ui.commitments = plan.inputs.commitments.map((c) => ({ label: c.label, amount: centsToInput(c.amountCents), cadence: c.cadence }));
    renderCommitments();
  }
  const result = $('#plan-result');
  if (!plan) { result.hidden = true; return; }
  result.hidden = false;
  const badge = $('#plan-source');
  badge.className = `source-badge ${plan.source}`;
  badge.textContent = plan.source === 'ai'
    ? `AI plan · ${plan.model} · checked by the server`
    : plan.source === 'household-edited' ? 'Edited by your household · re-checked by the server' : (plan.fallbackFromAi ? 'Example plan (built-in rules, chosen after the AI plan failed)' : plan.sourceLabel);
  $('#plan-headline').textContent = plan.headline;
  $('#plan-summary').textContent = plan.summary;
  const shortfall = $('#plan-shortfall');
  const notes = [];
  if (!plan.totals.feasible) notes.push(`This schedule is ${money(plan.totals.shortfallCents)} short of the goal. Raise the weekly amount, move the date, or edit the weeks below.`);
  notes.push(...(plan.warnings ?? []));
  shortfall.hidden = notes.length === 0;
  shortfall.replaceChildren(...notes.map((n) => h('p', { style: 'margin:0 0 4px' }, n)));
  $('#plan-explanation').replaceChildren(...plan.explanation.map((s) => h('li', {}, s)));
  $('#plan-milestones').replaceChildren(...plan.projections.map((p) => h('li', { class: p.reached ? 'reached' : '' },
    p.reached ? `${p.name} (${money(p.targetCents)}) — already reached`
      : p.week ? `${p.name} (${money(p.targetCents)}) — week ${p.week}, ${dateLabel(p.date)}` : `${p.name} (${money(p.targetCents)}) — not reached by this schedule`)));
  if (!ui.scheduleDirty || ui.schedulePlanId !== plan.id) {
    ui.scheduleDirty = false;
    ui.schedulePlanId = plan.id;
    const reachWeeks = new Set(plan.projections.map((p) => p.week).filter(Boolean));
    $('#plan-schedule').replaceChildren(...plan.contributions.map((c) => h('tr', { class: reachWeeks.has(c.week) ? 'reaches' : '' },
      h('td', {}, `Week ${c.week}`),
      h('td', {}, dateLabel(c.date)),
      h('td', {}, h('span', { class: 'money' }, h('input', {
        class: 'week-amount', inputmode: 'decimal', value: centsToInput(c.amountCents), 'data-week': c.week, 'aria-label': `Week ${c.week} amount`,
      }))))));
    $('#plan-total').textContent = money(plan.totals.plannedCents);
  }
  $('#plan-cautions').replaceChildren(...plan.cautions.map((c) => h('li', {}, c)));
  $('#save-edits').disabled = !ui.scheduleDirty;
  const accepted = state.acceptedPlanId === plan.id;
  const accept = $('#accept-plan');
  accept.disabled = accepted || ui.scheduleDirty;
  accept.textContent = accepted ? 'Plan in use ✓' : 'Use this plan';
}

function renderCommitments() {
  $('#commitment-rows').replaceChildren(...ui.commitments.map((c, i) => h('div', { class: 'commitment' },
    h('label', { class: 'field commitment-label' }, h('span', {}, 'Bill'), h('input', { value: c.label, maxlength: 40, 'data-i': i, 'data-k': 'label', 'aria-label': `Bill ${i + 1} name` })),
    h('label', { class: 'field' }, h('span', {}, 'Amount'), h('span', { class: 'money' }, h('input', { value: c.amount, inputmode: 'decimal', 'data-i': i, 'data-k': 'amount', 'aria-label': `Bill ${i + 1} amount` }))),
    h('label', { class: 'field' }, h('span', {}, 'Every'), h('select', { 'data-i': i, 'data-k': 'cadence', 'aria-label': `Bill ${i + 1} frequency` },
      h('option', { value: 'monthly', selected: c.cadence === 'monthly' }, 'month'), h('option', { value: 'weekly', selected: c.cadence === 'weekly' }, 'week'))),
    h('button', { type: 'button', 'data-remove': i, 'aria-label': `Remove bill ${i + 1}` }, 'Remove'))));
}

function readPlanForm() {
  const errors = [];
  const fields = [['#goal-target', 'targetCents', 'goal amount'], ['#goal-starting', 'startingCents', 'amount already set aside'], ['#goal-weekly', 'weeklyBudgetCents', 'weekly amount']];
  const goal = { name: $('#goal-name-input').value.trim(), targetDate: $('#goal-date').value };
  for (const [selector, key, label] of fields) {
    const cents = parseAmountToCents($(selector).value);
    $(selector).toggleAttribute('aria-invalid', cents === null);
    if (cents === null) errors.push(`Enter the ${label} in dollars and cents, like 30.00.`); else goal[key] = cents;
  }
  if (goal.name.length < 2) errors.push('Name the goal.');
  if (!goal.targetDate) errors.push('Choose a target date.');
  const commitments = [];
  ui.commitments.forEach((c, i) => {
    if (!c.label.trim() && !c.amount.trim()) return;
    const cents = parseAmountToCents(c.amount);
    if (c.label.trim().length < 2 || cents === null) errors.push(`Bill ${i + 1} needs a name and an amount.`);
    else commitments.push({ label: c.label.trim(), amountCents: cents, cadence: c.cadence });
  });
  return { goal, commitments, errors };
}

async function askPlanner(event) {
  event?.preventDefault();
  const { goal, commitments, errors } = readPlanForm();
  if (errors.length) { setStatus('#plan-status', 'error', 'Please fix these first:', { issues: errors }); return; }
  const button = $('#ask-planner');
  button.disabled = true;
  setStatus('#plan-status', 'working', state.modes.ai.mode === 'live' ? 'The AI planner is writing your plan. This can take up to a minute…' : 'Working out the example plan…');
  try {
    const res = await api.post('/api/plans', { goal, commitments });
    ui.planFormDirty = false;
    if (res.status === 'ok') {
      ui.scheduleDirty = false;
      applyState(res.state);
      setStatus('#plan-status', 'ok', res.plan.source === 'ai' ? 'The AI plan passed every server check. Review it below.' : 'Plan ready. Review it below.');
      $('#plan-headline').focus?.();
    } else {
      applyState(res.state);
      const reason = res.status === 'invalid_ai_output'
        ? `The AI plan from ${res.model} failed the server’s checks, so it was not used:`
        : `The AI planner could not answer: ${res.error.message}`;
      setStatus('#plan-status', 'error', reason, {
        issues: res.issues,
        action: h('button', { type: 'button', onclick: () => useRulesPlan(goal, commitments) }, 'Use the example rules plan instead'),
      });
    }
  } catch (error) {
    setStatus('#plan-status', 'error', error.message, { issues: error.issues });
  } finally {
    button.disabled = false;
  }
}

async function useRulesPlan(goal, commitments) {
  try {
    const res = await api.post('/api/plans/rules', { goal, commitments, afterAiFailure: true });
    applyState(res.state);
    setStatus('#plan-status', 'info', 'Showing the example rules plan, clearly labeled. It was not written by AI.');
  } catch (error) {
    setStatus('#plan-status', 'error', error.message);
  }
}

function scheduleAmounts() {
  return $$('.week-amount').map((input) => {
    const cents = parseAmountToCents(input.value);
    input.toggleAttribute('aria-invalid', cents === null);
    return cents;
  });
}

async function saveEdits() {
  const amounts = scheduleAmounts();
  if (amounts.some((a) => a === null)) { setStatus('#plan-status', 'error', 'Each week needs an amount like 30.00 (use 0.00 to skip a week).'); return; }
  try {
    const res = await api.put(`/api/plans/${state.plan.id}`, { amounts });
    ui.scheduleDirty = false;
    applyState(res.state);
    setStatus('#plan-status', 'ok', 'Your edits were checked and saved as a household-edited plan.');
  } catch (error) {
    setStatus('#plan-status', 'error', error.message, { issues: error.code === 'invalid_edit' ? [] : error.issues });
  }
}

async function acceptPlan() {
  try {
    const res = await api.post(`/api/plans/${state.plan.id}/accept`);
    applyState(res.state);
    setStatus('#plan-status', 'ok', 'Plan in use. Each contribution still needs an adult’s approval.');
    selectTab('give');
  } catch (error) {
    setStatus('#plan-status', 'error', error.message);
  }
}

// ---------- 3. Contribute ----------
function quickPicks() {
  const picks = [];
  const { board, nextStep, progress, contributionLimits: lim } = state;
  const ok = (c) => c >= lim.minCents && c <= lim.maxCents && c <= progress.remainingCents;
  if (board.nextMilestone && ok(board.nextMilestone.awayCents)) picks.push({ cents: board.nextMilestone.awayCents, label: `Raises the ${board.nextMilestone.name}` });
  if (nextStep?.dueCents && ok(nextStep.dueCents)) picks.push({ cents: nextStep.dueCents, label: nextStep.dueCents === nextStep.plannedCents ? `Week ${nextStep.week} in full` : `Rest of week ${nextStep.week}` });
  if (ok(progress.remainingCents)) picks.push({ cents: progress.remainingCents, label: 'Finishes the goal' });
  return picks.filter((p, i) => picks.findIndex((q) => q.cents === p.cents) === i).sort((a, b) => a.cents - b.cents).slice(0, 3);
}

function amountCheck() {
  const cents = parseAmountToCents($('#give-amount').value);
  const { contributionLimits: lim, progress } = state;
  if (cents === null) return { cents: null, error: 'Enter an amount like 15.00.' };
  if (cents < lim.minCents || cents > lim.maxCents) return { cents, error: `Contributions are ${money(lim.minCents)}–${money(lim.maxCents)} in this prototype.` };
  if (cents > progress.remainingCents) return { cents, error: `Only ${money(progress.remainingCents)} is still needed for this goal.` };
  return { cents, error: null };
}

function renderGive() {
  const { household, goal, nextStep, progress, acceptedPlanId } = state;
  const setup = household.setupComplete;
  const done = progress.remainingCents <= 0;
  $('#give-context').textContent = !setup ? 'Found your house first, then add to the journey.'
    : done ? 'The goal is complete. The castle stands.'
      : nextStep?.week ? `Next in your plan: week ${nextStep.week} (${dateLabel(nextStep.date)}) — ${money(nextStep.dueCents)} of ${money(nextStep.plannedCents)} still to add.`
        : acceptedPlanId ? 'Your plan’s weeks are covered. You can still add more.' : 'No plan in use yet. You can still contribute, or make a plan first.';
  const picks = setup && !done ? quickPicks() : [];
  const amountInput = $('#give-amount');
  if (!ui.amountTouched && document.activeElement !== amountInput) amountInput.value = picks[0] ? centsToInput(picks[0].cents) : '';
  const current = parseAmountToCents(amountInput.value);
  $('#quick-picks').replaceChildren(...picks.map((p) => h('button', {
    type: 'button', 'data-cents': p.cents, 'aria-pressed': String(current === p.cents),
  }, h('strong', {}, money(p.cents)), h('span', {}, p.label))));
  const check = amountCheck();
  $('#give-amount-help').textContent = check.error && amountInput.value ? check.error : `${money(state.contributionLimits.minCents)}–${money(state.contributionLimits.maxCents)} per contribution. ${money(progress.remainingCents)} still needed.`;

  const who = persona();
  const approve = $('#give-approve');
  const row = $('#give-approve-row');
  const amountText = check.cents !== null && !check.error ? money(check.cents) : 'this';
  if (!who || who.role !== 'adult') {
    approve.checked = false;
    approve.disabled = true;
    row.classList.add('blocked');
    $('#give-approve-text').textContent = `${who?.name ?? 'This persona'} is a child persona. Switch “Acting as” to an adult to approve a payment.`;
  } else {
    approve.disabled = !setup || done;
    row.classList.remove('blocked');
    $('#give-approve-text').textContent = `I’m ${who.name}, an adult in ${household.name}. I approve a ${amountText} USD ${isSandbox() ? 'PayPal sandbox payment (test money)' : 'simulated payment'} toward ${goal.name}.`;
  }
  const ready = setup && !done && approve.checked && !check.error && who?.role === 'adult';
  renderGiveAction(ready);
  $('#give-mode-note').textContent = isSandbox()
    ? 'PayPal sandbox only. Progress changes after the server captures the payment and checks the amount, currency and goal with PayPal — never from the browser alone.'
    : 'Example mode: no PayPal call is made. The server records a clearly labeled simulated payment through the same checks.';
  renderReceipt();
}

function renderGiveAction(ready) {
  const box = $('#give-action');
  if (isSandbox()) {
    if (!paypalMount && !box.querySelector('paypal-button')) {
      box.replaceChildren(h('p', { class: 'fine' }, 'Loading PayPal sandbox checkout…'));
      paypalMount = mountPayPalButton(box, {
        getOrderInput: () => orderInput(),
        getOwnership: ownership,
        onStatus: ({ kind, message, debugId }) => setStatus('#give-status', kind, message, { debugId }),
        onResult: (res) => handleContributionResult(res),
      }).then((control) => { paypal = control; paypal.setEnabled(readyToPay()); })
        .catch((error) => {
          box.replaceChildren();
          setStatus('#give-status', 'error', `PayPal sandbox checkout could not start: ${error.message}`);
          paypalMount = null;
        });
    }
    paypal?.setEnabled(ready);
    return;
  }
  if (!box.querySelector('#simulate-pay')) {
    box.replaceChildren(
      h('button', { type: 'button', class: 'primary', id: 'simulate-pay', onclick: () => simulate('completed') }, 'Simulate approved payment'),
      h('details', {},
        h('summary', {}, 'Test other outcomes (example mode)'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', onclick: () => simulate('canceled') }, 'Simulate cancel'),
          h('button', { type: 'button', onclick: () => simulate('pending') }, 'Simulate pending'),
          h('button', { type: 'button', onclick: () => simulate('failed') }, 'Simulate decline'))),
    );
  }
  for (const b of $$('button', box)) b.disabled = !ready;
}

function readyToPay() {
  return Boolean(state?.household.setupComplete && $('#give-approve').checked && !amountCheck().error && persona()?.role === 'adult');
}

function orderInput() {
  const check = amountCheck();
  if (persona()?.role !== 'adult') { setStatus('#give-status', 'error', 'An adult must approve payments.'); return null; }
  if (check.error) { setStatus('#give-status', 'error', check.error); $('#give-amount').focus(); return null; }
  if (!$('#give-approve').checked) { setStatus('#give-status', 'error', 'Tick the approval box first.'); $('#give-approve').focus(); return null; }
  return { ...ownership(), amountCents: check.cents, approverId: persona().id, approvalConfirmed: true, requestId: newRequestId() };
}

async function simulate(outcome) {
  const input = orderInput();
  if (!input) return;
  setStatus('#give-status', 'working', 'Recording a simulated payment on the server…');
  for (const b of $$('#give-action button')) b.disabled = true;
  try {
    handleContributionResult(await api.post('/api/example/contributions', { ...input, outcome }));
  } catch (error) {
    setStatus('#give-status', 'error', error.message);
    renderGive();
  }
}

const OUTCOME_TEXT = {
  completed: ['ok', 'Confirmed by the server. The travelers move on.'],
  already_completed: ['info', 'Already recorded. It was not counted twice.'],
  already_processed: ['info', 'Already recorded. It was not counted twice.'],
  pending: ['info', 'Pending: the payment is not complete yet, so progress has not changed.'],
  canceled: ['info', 'Canceled before approval. Nothing was charged and progress is unchanged.'],
  declined: ['error', 'Declined. No progress was recorded.'],
  not_approved: ['error', 'PayPal has not recorded an approval yet. No progress was recorded.'],
  not_captured: ['info', 'Approved but not captured yet. No progress was recorded.'],
  rejected_mismatch: ['error', 'The payment did not match what this server expected, so it was not counted.'],
  not_credited: ['error', 'PayPal reported an unexpected status. No progress was recorded.'],
};

function handleContributionResult(res) {
  const before = state.progress.progressCents;
  const [kind, text] = OUTCOME_TEXT[res.outcome] ?? ['info', `Result: ${res.outcome}`];
  if (['completed', 'pending', 'already_completed'].includes(res.outcome) && res.contribution) {
    ui.receipt = { contribution: res.contribution, outcome: res.outcome, before: res.outcome === 'completed' ? before : res.progress.progressCents, after: res.progress.progressCents, awarded: res.awarded ?? [] };
  }
  if (res.outcome === 'completed') { $('#give-approve').checked = false; ui.amountTouched = false; }
  setStatus('#give-status', kind, text);
  if (res.outcome === 'completed') sound.cue('chime');
  else if (['declined', 'rejected_mismatch', 'not_credited'].includes(res.outcome)) sound.cue('soft');
  bus.emit('contribution:result', res);
  applyState(res.state, { animate: true, result: res });
  if (ui.receipt && ['completed', 'pending'].includes(res.outcome)) $('#receipt').focus({ preventScroll: false });
}

function renderReceipt() {
  const box = $('#receipt');
  const r = ui.receipt;
  if (!r) { box.hidden = true; return; }
  const c = state.contributions.find((x) => x.id === r.contribution.id) ?? r.contribution;
  const capture = c.captures[0];
  const approver = state.members.find((m) => m.id === c.approvedBy);
  const completed = ['completed', 'refunded', 'partially_refunded'].includes(c.status);
  box.hidden = false;
  box.replaceChildren(
    h('span', { class: `stamp ${c.simulated ? 'simulated' : 'sandbox'}` }, c.simulated ? 'Simulated · example mode · no PayPal transaction' : 'PayPal sandbox · test money'),
    h('h4', { id: 'receipt-title' }, completed ? 'Contribution receipt' : 'Contribution pending'),
    h('p', { class: 'big' }, `${money(c.amountCents)} ${c.currency}`),
    h('dl', {},
      h('dt', {}, 'Status'), h('dd', {}, receiptStatus(c)),
      h('dt', {}, 'Toward'), h('dd', {}, state.goal.name),
      h('dt', {}, 'Approved by'), h('dd', {}, approver ? `${approver.name} (adult, example persona)` : c.approvedBy),
      h('dt', {}, c.simulated ? 'Simulated order' : 'PayPal order'), h('dd', {}, c.providerOrderId ?? '—'),
      h('dt', {}, c.simulated ? 'Simulated capture' : 'PayPal capture'), h('dd', {}, capture?.captureId ?? 'none yet'),
      h('dt', {}, 'Recorded'), h('dd', {}, timeLabel(c.updatedAt)),
      ...(completed && r.outcome === 'completed' ? [h('dt', {}, 'Goal progress'), h('dd', {}, `${money(r.before)} → ${money(r.after)} (${formatPercent(r.after, state.goal.targetCents)})`)] : []),
      ...(r.awarded.filter((a) => typeof a === 'number').length ? [h('dt', {}, 'Milestone'), h('dd', {}, r.awarded.filter((a) => typeof a === 'number').map((t) => `${TIERS[t].name} raised`).join(', '))] : []),
    ),
    !c.simulated && c.providerOrderId && state.steward.paypalTools
      ? h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => askSteward(`Did PayPal confirm the ${money(c.amountCents)} contribution?`, c.providerOrderId) }, 'Ask the steward to verify with PayPal'))
      : null,
  );
}

function receiptStatus(c) {
  const sim = c.simulated;
  switch (c.status) {
    case 'completed': return sim ? 'Completed (simulated by this server)' : 'Completed — captured and verified by the server with PayPal sandbox';
    case 'pending': return 'Pending — not counted toward the goal until it completes';
    case 'refunded': return 'Refunded — goal progress reduced by the same amount';
    case 'partially_refunded': return 'Partly refunded — goal progress reduced by the refunded amount';
    default: return c.statusDetail ?? c.status;
  }
}

// ---------- 4. Ledger ----------
const STATUS_LABEL = {
  creating: 'Creating', created: 'Awaiting approval', approval_canceled: 'Canceled — nothing charged', pending: 'Pending — not counted yet',
  completed: 'Completed — counted', declined: 'Declined — not counted', failed: 'Failed — not counted', rejected: 'Rejected (mismatch) — not counted',
  refunded: 'Refunded — progress reversed', partially_refunded: 'Partly refunded',
};
const KIND_LABEL = {
  starting_progress: 'Starting progress', contribution: 'Contribution', refund: 'Refund', simulated_contribution: 'Contribution', simulated_refund: 'Refund',
};

function ledgerRows() {
  const { ledger } = state;
  return [...ledger.goalEntries, ...ledger.bills, ...ledger.gifts].map((e) => {
    const category = e.kind === 'bill_paid' ? 'bill' : e.kind === 'gift_sent' ? 'gift' : 'goal';
    const signed = e.effect * e.amountCents;
    return {
      id: e.id,
      category,
      whenIso: e.createdAt,
      when: timeLabel(e.createdAt),
      record: category === 'goal' ? 'Goal progress' : category === 'bill' ? 'Bill paid (habit)' : 'Gift sent',
      entry: e.label || KIND_LABEL[e.kind],
      source: e.source === 'user-reported' ? 'You reported' : e.source === 'simulated' ? 'Simulated' : 'PayPal sandbox',
      signedCents: category === 'goal' ? signed : e.amountCents,
      amountText: category === 'goal' ? `${signed < 0 ? '−' : '+'}${money(e.amountCents)}` : money(e.amountCents),
      counts: category === 'goal' ? (signed < 0 ? 'Yes (subtracts)' : 'Yes') : 'No — not savings',
    };
  });
}

function renderLedgerGrid() {
  if (ui.tab !== 'ledger') return; // grids are sized while visible
  if (!ledgerGrid) ledgerGrid = createLedgerGrid($('#ledger-goal'), { formatMoney: money });
  ledgerGrid.update(ledgerRows(), state.progress.progressCents).then(() => ledgerGrid.setFilter(ui.ledgerFilter));
}

function renderLedger() {
  const { contributions, achievements, modes } = state;
  renderLedgerGrid();
  renderSteward();

  const adult = persona()?.role === 'adult';
  $('#ledger-contributions').replaceChildren(...(contributions.length ? contributions.map((c) => {
    const capture = c.captures.find((x) => x.credited);
    const refundable = capture && capture.amountCents - capture.refundedCents > 0;
    const actions = [];
    if (c.status === 'pending' && c.simulated) actions.push(h('button', { type: 'button', onclick: () => completePending(c.id) }, 'Simulate PayPal completing it'));
    if (c.status === 'pending' && !c.simulated) actions.push(h('button', { type: 'button', onclick: () => refreshOrder(c.providerOrderId) }, 'Check with PayPal'));
    if (!c.simulated && c.providerOrderId && state.steward.paypalTools) {
      actions.push(h('button', { type: 'button', onclick: () => askSteward(`Did PayPal confirm the ${money(c.amountCents)} contribution?`, c.providerOrderId) }, 'Ask the steward to verify'));
    }
    if (refundable && adult) {
      const left = capture.amountCents - capture.refundedCents;
      actions.push(ui.refundArm === capture.captureId
        ? h('button', { type: 'button', class: 'danger', onclick: () => refund(capture.captureId, c.simulated) }, `Confirm refund of ${money(left)}`)
        : h('button', { type: 'button', onclick: () => { ui.refundArm = capture.captureId; renderLedger(); } }, c.simulated ? 'Simulate refund' : 'Refund in sandbox'));
    }
    return h('li', {},
      h('div', { class: 'row' }, h('span', { class: 'amount' }, money(c.amountCents)), h('span', {}, STATUS_LABEL[c.status] ?? c.status,
        h('span', { class: `tag ${c.simulated ? 'simulated' : 'sandbox'}` }, c.simulated ? 'simulated' : 'PayPal sandbox'))),
      h('div', { class: 'ids' }, `${timeLabel(c.createdAt)} · order ${c.providerOrderId ?? '—'}${capture ? ` · capture ${capture.captureId}` : ''}`),
      c.statusDetail && !['completed'].includes(c.status) ? h('div', { class: 'ids' }, c.statusDetail) : null,
      actions.length ? h('div', { class: 'actions' }, actions) : null);
  }) : [h('li', { class: 'empty' }, 'No contributions yet.')]));

  $('#achievements').replaceChildren(...(achievements.length ? achievements.map((a) => h('li', {}, h('strong', {}, a.label), h('span', {}, a.detail), h('small', {}, timeLabel(a.earnedAt))))
    : [h('li', { class: 'empty' }, 'Keepsakes appear as the house reaches milestones.')]));
  if (state.board.builtTierCommemorative) {
    $('#achievements').append(h('li', {}, h('strong', {}, 'About keepsakes'), h('span', {}, 'Raised buildings stay as keepsakes after a refund. Current progress and the travelers always show the true amount.')));
  }
  $('#reset-row').hidden = modes.payments.mode !== 'example';
}

// ---------- House steward (AI, read-only) ----------
const STEWARD_SUGGESTIONS = ['Did PayPal confirm our last contribution?', 'How close are we to the next milestone?', 'Is anything still pending?'];

function renderSteward() {
  const { steward } = state;
  $('#steward-note').textContent = !steward.available
    ? 'The steward is off. It needs an AI key (AI_API_KEY) in the server’s .env file; with PayPal sandbox credentials it can also check payments through PayPal’s Agent Toolkit.'
    : steward.paypalTools
      ? `Claude (${steward.model}) answers from your ledger and checks PayPal sandbox records with PayPal’s Agent Toolkit. Read-only: it cannot create, pay or refund anything.`
      : `Claude (${steward.model}) answers from your ledger. PayPal checks are off while payments are in example mode.`;
  const suggestions = $('#steward-suggestions');
  if (!suggestions.childElementCount) {
    suggestions.append(...STEWARD_SUGGESTIONS.map((q) => h('button', { type: 'button', 'data-question': q }, h('span', {}, q))));
  }
  const disabled = !steward.available || ui.stewardBusy;
  for (const el of [...$$('#steward-suggestions button'), $('#steward-form input'), $('#steward-ask')]) el.disabled = disabled;
}

async function askSteward(question, focusOrderId = null) {
  if (!state.steward.available || ui.stewardBusy) return;
  if (ui.tab !== 'ledger') selectTab('ledger', { focus: false });
  $('#steward-form').elements.question.value = question;
  ui.stewardBusy = true;
  renderSteward();
  setStatus('#steward-status', 'working', state.steward.paypalTools ? 'The steward is reading the ledger and checking with PayPal…' : 'The steward is reading the ledger…');
  $('#steward-answer').hidden = true;
  try {
    const res = await api.post('/api/steward', { question, memberId: persona()?.id, focusOrderId });
    if (res.status !== 'ok') { setStatus('#steward-status', 'error', `The steward could not answer: ${res.error.message}`); return; }
    setStatus('#steward-status', '', '');
    renderStewardAnswer(res);
    bus.emit('steward:answer', res);
  } catch (error) {
    setStatus('#steward-status', 'error', error.message);
  } finally {
    ui.stewardBusy = false;
    renderSteward();
  }
}

const VERDICT_CLASS = { match: 'ok', action: 'warn', differs: 'bad', unavailable: 'warn' };
function renderStewardAnswer(res) {
  const box = $('#steward-answer');
  box.hidden = false;
  box.replaceChildren(
    h('span', { class: 'source-badge ai' }, `AI steward · ${res.model} · read-only${res.paypalTools ? ' · PayPal Agent Toolkit' : ''}`),
    h('p', { class: 'steward-text' }, res.answer),
    ...(res.warnings.length ? [h('div', { class: 'callout warn' }, res.warnings.join(' '))] : []),
    h('h5', {}, 'What it checked'),
    h('ul', { class: 'checks' }, ...(res.checks.length ? res.checks.map((c) => h('li', {},
      h('span', { class: `tag ${c.source.startsWith('PayPal') ? 'sandbox' : 'reported'}` }, c.source),
      ' ', c.summary,
      c.reconciliation ? h('span', { class: `verdict ${VERDICT_CLASS[c.reconciliation.verdict] ?? 'warn'}` }, c.reconciliation.note) : null,
      c.reconciliation?.verdict === 'action' ? h('button', { type: 'button', onclick: () => refreshOrder(c.orderId) }, 'Check with PayPal') : null))
      : [h('li', {}, 'Nothing was checked.')])),
  );
}

async function completePending(id) {
  try { handleContributionResult(await api.post(`/api/example/contributions/${id}/complete`, { householdId: state.household.id })); } catch (error) { setStatus('#ledger-status', 'error', error.message); }
}
async function refreshOrder(orderId) {
  try { handleContributionResult(await api.post(`/api/paypal/orders/${encodeURIComponent(orderId)}/refresh`, ownership())); } catch (error) { setStatus('#ledger-status', 'error', error.message, { debugId: error.debugId }); }
}
async function refund(captureId, simulated) {
  ui.refundArm = null;
  const url = simulated ? `/api/example/captures/${encodeURIComponent(captureId)}/refund` : `/api/paypal/captures/${encodeURIComponent(captureId)}/refund`;
  setStatus('#ledger-status', 'working', simulated ? 'Recording a simulated refund…' : 'Asking PayPal sandbox to refund…');
  try {
    const res = await api.post(url, { householdId: state.household.id, approverId: persona().id, approvalConfirmed: true });
    applyState(res.state, { animate: true });
    setStatus('#ledger-status', res.outcome === 'refunded' ? 'ok' : 'info', res.outcome === 'refunded'
      ? 'Refunded. Goal progress went down by exactly that amount; the house keeps its keepsake.' : `Refund status: ${res.outcome}. Progress changes only when the refund completes.`);
  } catch (error) {
    setStatus('#ledger-status', 'error', error.message, { debugId: error.debugId });
    renderLedger();
  }
}

async function logEntry(event, kind) {
  event.preventDefault();
  const form = event.currentTarget;
  const label = form.elements.label.value.trim();
  const cents = parseAmountToCents(form.elements.amount.value);
  form.elements.amount.toggleAttribute('aria-invalid', cents === null);
  if (label.length < 2 || cents === null) { setStatus('#ledger-status', 'error', 'Add a short description and an amount like 60.00.'); return; }
  try {
    const res = await api.post('/api/entries', { kind, label, amountCents: cents, memberId: persona()?.id });
    form.reset();
    if (res.awarded?.some((a) => String(a).startsWith('garden:'))) sound.cue('sprout');
    applyState(res.state, { animate: true, result: { awarded: res.awarded } });
    setStatus('#ledger-status', 'ok', kind === 'bill_paid'
      ? `Logged “${label}”. Bills are tracked as habits and do not count toward the goal.` : `Logged “${label}”. Gifts are tracked separately and do not count toward the goal.`);
  } catch (error) {
    setStatus('#ledger-status', 'error', error.message);
  }
}

// ---------- tabs, footer, events ----------
const TABS = ['house', 'plan', 'give', 'ledger', 'rewards'];
function selectTab(name, { focus = true } = {}) {
  ui.tab = name;
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`);
    const selected = tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
  }
  if (name === 'ledger' && state) renderLedgerGrid();
  if (focus) $(`#tab-${name}`).focus();
}
function renderTabs() {
  $('#tab-house').classList.toggle('done', state.household.setupComplete);
  $('#tab-plan').classList.toggle('done', Boolean(state.acceptedPlanId));
  $('#tab-give').classList.toggle('done', state.contributions.some((c) => ['completed', 'refunded', 'partially_refunded'].includes(c.status)));
}
function renderFooter() {
  const { modes } = state;
  const parts = [];
  parts.push(modes.payments.mode === 'sandbox' ? 'PayPal sandbox only: test accounts and test money; nothing here moves real money.' : 'Example payments: simulated and labeled; no PayPal call is made.');
  parts.push(modes.ai.mode === 'live' ? `Plans are proposed by ${modes.ai.model} and checked by the server.` : 'Plans come from built-in rules; no AI is called.');
  parts.push('Goal progress is this app’s own ledger, not a bank balance. Household bills are recorded by you; no utility-bill verification provider is connected.');
  if (modes.warnings?.length) parts.push(`Server notes: ${modes.warnings.join(' ')}`);
  $('#honesty').textContent = parts.join(' ');
}

function bindEvents() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.id.slice(4), { focus: false }); });
  $('#tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(ui.tab);
    const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[next]);
  });
  $('#sound-toggle').addEventListener('click', (e) => {
    const on = sound.setEnabled(e.currentTarget.getAttribute('aria-pressed') !== 'true');
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Sound on' : 'Sound off';
  });
  for (const button of $$('[data-view]')) button.addEventListener('click', () => scene?.adjustView(button.dataset.view));
  // Arrow keys pan the view while the view controls have focus (handy after zooming in).
  $('.world-navigation').addEventListener('keydown', (e) => {
    const action = { ArrowLeft: 'pan-left', ArrowRight: 'pan-right', ArrowUp: 'pan-up', ArrowDown: 'pan-down' }[e.key];
    if (!action || !scene) return;
    e.preventDefault();
    scene.adjustView(action);
  });
  $('#end-preview').addEventListener('click', () => { ui.preview = null; renderBoard({ animate: false, result: null }); });
  bus.on('scene:hop', (detail) => sound.cue('hop', detail));
  bus.on('scene:rise', (detail) => sound.cue('fanfare', detail));
  $('#pixel-toggle').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Pixel art' : 'Raw 3D';
    scene?.setPixelMode(on);
  });
  $('#persona').addEventListener('change', (e) => { ui.personaId = e.target.value; pref.set('persona', ui.personaId); ui.refundArm = null; renderGive(); renderLedger(); });

  // House
  $('#panel-house').addEventListener('change', (e) => {
    const draft = houseDraft();
    if (e.target.name === 'playMode') draft.playMode = e.target.value;
    if (e.target.name === 'crestField') draft.crest.field = e.target.value;
    if (e.target.name === 'crestCharge') draft.crest.charge = e.target.value;
    ui.houseDirty = true;
    renderHouse();
  });
  $('#house-name').addEventListener('input', (e) => { houseDraft().name = e.target.value; ui.houseDirty = true; });
  $('#save-house').addEventListener('click', saveHouse);

  // Plan
  $('#plan-form').addEventListener('input', (e) => {
    if (e.target.dataset.k) ui.commitments[Number(e.target.dataset.i)][e.target.dataset.k] = e.target.value;
    ui.planFormDirty = true;
  });
  $('#plan-form').addEventListener('change', (e) => { if (e.target.dataset.k) ui.commitments[Number(e.target.dataset.i)][e.target.dataset.k] = e.target.value; });
  $('#commitment-rows').addEventListener('click', (e) => {
    const i = e.target.closest('[data-remove]')?.dataset.remove;
    if (i === undefined) return;
    ui.commitments.splice(Number(i), 1); ui.planFormDirty = true; renderCommitments();
  });
  $('#add-commitment').addEventListener('click', () => {
    if (ui.commitments.length >= 8) return;
    ui.commitments.push({ label: '', amount: '', cadence: 'monthly' }); ui.planFormDirty = true; renderCommitments();
    $$('#commitment-rows input[data-k="label"]').at(-1)?.focus();
  });
  $('#plan-form').addEventListener('submit', askPlanner);
  $('#plan-schedule').addEventListener('input', () => {
    ui.scheduleDirty = true;
    const amounts = scheduleAmounts();
    $('#plan-total').textContent = amounts.some((a) => a === null) ? '—' : money(amounts.reduce((a, b) => a + b, 0));
    $('#save-edits').disabled = false;
    $('#accept-plan').disabled = true;
  });
  $('#save-edits').addEventListener('click', saveEdits);
  $('#accept-plan').addEventListener('click', acceptPlan);

  // Contribute
  $('#quick-picks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cents]');
    if (!b) return;
    $('#give-amount').value = centsToInput(Number(b.dataset.cents));
    ui.amountTouched = true;
    renderGive();
  });
  $('#give-amount').addEventListener('input', () => { ui.amountTouched = true; renderGive(); });
  $('#give-approve').addEventListener('change', () => { setStatus('#give-status', '', ''); renderGive(); });

  // Ledger
  $('#ledger-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    ui.ledgerFilter = b.dataset.filter;
    for (const x of $$('#ledger-filter [data-filter]')) x.setAttribute('aria-pressed', String(x === b));
    ledgerGrid?.setFilter(ui.ledgerFilter);
  });
  $('#steward-suggestions').addEventListener('click', (e) => { const b = e.target.closest('[data-question]'); if (b) askSteward(b.dataset.question); });
  $('#steward-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.currentTarget.elements.question.value.trim();
    if (q.length < 3) { setStatus('#steward-status', 'error', 'Type a question first.'); return; }
    askSteward(q);
  });
  $('#bill-form').addEventListener('submit', (e) => logEntry(e, 'bill_paid'));
  $('#gift-form').addEventListener('submit', (e) => logEntry(e, 'gift_sent'));
  $('#reset-demo').addEventListener('click', async (e) => {
    if (e.currentTarget.dataset.armed !== 'true') { e.currentTarget.dataset.armed = 'true'; e.currentTarget.textContent = 'Click again to erase the example household'; return; }
    e.currentTarget.dataset.armed = 'false'; e.currentTarget.textContent = 'Reset the example household';
    try {
      const res = await api.post('/api/demo/reset');
      Object.assign(ui, { receipt: null, houseDirty: false, planFormDirty: false, scheduleDirty: false, amountTouched: false });
      applyState(res.state, { animate: false });
      selectTab('house');
      setStatus('#house-status', 'info', 'The example household was reset.');
    } catch (error) { setStatus('#ledger-status', 'error', error.message); }
  });
}

boot();
