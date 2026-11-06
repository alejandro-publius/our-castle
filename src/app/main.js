import { createBoardScene } from '../world/board-scene.js';
import { createFamilyAvatars } from './family-avatars.js';
import { memberAvatar, avatarImage } from '../core/avatars.js';
import { api, newRequestId, setSession } from './api.js';
import { createAccessDialog, renderFamilyAccess } from './family-access.js';
import { createFamilyLive } from './family-live.js';
import { bus } from './bus.js';
import { chargeIcon, crestChoices, crestSvg } from './crest.js';
import { TIERS, formatCents, formatPercent, parseAmountToCents, ROUTE_LENGTH } from '../core/rules.js';
import { mountPayPalButton } from './paypal-checkout.js';
import { createLedgerGrid } from './ledger-grid.js';
import { sound } from './sound.js';
import { newlyEarnedEstate } from '../core/rewards.js';
import { courtForTier } from '../core/court.js';
import { isCounted, nextAction } from '../core/journey.js';
import { districtDeed, newlyOpenedDistricts } from '../core/deeds.js';
import { TIME_MODES, WEATHER_MODES, resolveAtmosphere } from '../core/atmosphere.js';
import { WEATHER_TTL_MS, createWeatherClient } from './local-weather.js';
import { REALM_DISTRICTS, REALM_LEGENDS, realmAccess, districtById, homeDistrict } from '../core/realm.js';
import { ledgerTrail } from '../core/ledger.js';
import { createMerchantDialog, resultFacts } from './merchant.js';
import { createTreasury } from './treasury.js';
import { FAMILY_PROJECT_SITE, PROJECT_KINDS, projectKind, projectLabel, projectStage } from '../core/family-project.js';
import { CONFIRMATION_HISTORY_QUESTION, NEEDS_CHECK_QUESTION, isLocalQuestion, isNeedsCheckQuestion } from '../core/steward-questions.js';
import { checkStatus } from '../core/check-status.js';
import { createPlanCheck } from './plan-check.js';

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
// The family project's stage, read from the server's progress and goal, drawn as the goal's saved Build choice.
const currentProject = () => projectStage(state.progress.progressCents, state.goal.targetCents, state.goal.projectKind);
// Its map marker, in the quiet gold-and-ink glint style: a tent, a sprout in its bed, or a schoolhouse with its bell.
const PROJECT_ICON_STROKE = 'stroke="#3b2a12" stroke-width="1.6" stroke-linejoin="round"';
const PROJECT_ICONS = {
  campsite: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><path d="M14 4 2.5 24h23L14 4Z" fill="currentColor" ${PROJECT_ICON_STROKE}/><path d="M14 11.5 9 24h10l-5-12.5Z" fill="#3b2a12"/><path d="M14 1v3" stroke="#3b2a12" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  garden: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><path d="M14 19.5V10" stroke="#3b2a12" stroke-width="1.8" stroke-linecap="round"/><path d="M13.6 14.2C8.4 14.6 5.2 11.6 5 6.6c5.1-.3 8.4 2.6 8.6 7.6Z" fill="currentColor" ${PROJECT_ICON_STROKE}/><path d="M14.4 11.2c.2-5 3.5-7.9 8.6-7.6-.2 5-3.4 8-8.6 7.6Z" fill="currentColor" ${PROJECT_ICON_STROKE}/><path d="M3 25h22l-2.4-5.6H5.4L3 25Z" fill="currentColor" ${PROJECT_ICON_STROKE}/></svg>`,
  schoolhouse: `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true"><path d="M10.6 9.5V4.2h6.8v5.3" fill="currentColor" ${PROJECT_ICON_STROKE}/><path d="M9.4 4.4 14 1.3l4.6 3.1H9.4Z" fill="#3b2a12"/><circle cx="14" cy="6.6" r="1.35" fill="#3b2a12"/><path d="M3.5 15.4 14 8.6l10.5 6.8v9.4h-21v-9.4Z" fill="currentColor" ${PROJECT_ICON_STROKE}/><path d="M12 24.8v-5.4h4v5.4" fill="#3b2a12"/></svg>`,
};
const pref = {
  get(key) { try { return localStorage.getItem(`our-castle:${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`our-castle:${key}`, value); } catch { /* private mode: fine */ } },
  remove(key) { try { localStorage.removeItem(`our-castle:${key}`); } catch { /* private mode: fine */ } },
};
// The tab a family last chose, for this browser tab only: a refresh returns to it instead of jumping elsewhere.
const sessionTab = {
  get() { try { return sessionStorage.getItem('our-castle:tab'); } catch { return null; } },
  set(value) { try { if (value) sessionStorage.setItem('our-castle:tab', value); else sessionStorage.removeItem('our-castle:tab'); } catch { /* storage off: fine */ } },
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
let paypalLoadFailed = false;
let ledgerGrid = null;
let familyAvatars = null;
let merchant = null;
let treasury = null;
let planCheck = null;
const ui = {
  tab: 'house',
  personaId: pref.get('persona'),
  houseDraft: null,
  houseDirty: false,
  planFormDirty: false,
  planGoalId: null,
  planGoalRevision: null,
  planProjectKind: null, // the saved Build choice the Plan form last loaded; only a change from it is sent
  scheduleDirty: false,
  schedulePlanId: null,
  commitments: [{ label: 'Internet bill', amount: '60.00', cadence: 'monthly' }],
  amountTouched: false,
  receipt: null,
  refundArm: null,
  celebrationTimer: null,
  ledgerFilter: 'all',
  ledgerSearch: '',
  ledgerRecord: null,
  stewardFocus: null,
  stewardBusy: false,
  receiptReviewed: null,
  next: null,
  navigation: 0,
  ledgerLayout: Promise.resolve(),
  deeds: { queue: [], index: 0, mode: 'new', origin: null, visiting: false },
  goalDraft: null, // a Market Town merchant result shown in the Plan form, not saved until the family confirms
  goalDraftBusy: false,
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
  for (const el of $$('.world-hud')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > world.top && r.top < world.top + world.height / 2) top = Math.max(top, r.bottom - world.top);
  }
  const foot = $('.board-foot').getBoundingClientRect();
  if (foot.height && foot.top < world.bottom) bottom = world.bottom - foot.top;
  return { top: (top + 8) / world.height, bottom: (bottom + 6) / world.height };
}

// ---------- boot ----------
// ---------- Realm atmosphere: cosmetic time of day and weather (browser preferences only; no server request) ----------
const savedPlace = () => { try { const p = JSON.parse(pref.get('atmosphere:place') ?? 'null'); return p && typeof p.label === 'string' ? p : null; } catch { return null; } };
const sky = {
  time: TIME_MODES.includes(pref.get('atmosphere:time')) ? pref.get('atmosphere:time') : 'auto',
  weather: WEATHER_MODES.includes(pref.get('atmosphere:weather')) ? pref.get('atmosphere:weather') : 'clear',
  place: savedPlace(), result: null, error: null, loading: false, editing: false,
  generation: 0, controller: null, searchGeneration: 0, searchController: null, client: null, resolved: null,
  attemptPlaceId: null, nextAttemptAt: 0,
};
// The weather client makes no request until a town is searched or a chosen town's weather is loaded.
const weatherClient = () => (sky.client ??= createWeatherClient());
function applySky() {
  const resolved = resolveAtmosphere({ timeMode: sky.time, weatherMode: sky.weather, now: new Date(),
    local: sky.weather === 'local' ? { place: sky.place, result: sky.result?.place?.id === sky.place?.id ? sky.result : null, error: sky.error, loading: sky.loading } : null });
  sky.resolved = resolved;
  scene?.setAtmosphere({ period: resolved.period, weather: resolved.weather });
  if ($('#time-mode').value !== sky.time) $('#time-mode').value = sky.time;
  if ($('#weather-mode').value !== sky.weather) $('#weather-mode').value = sky.weather;
  if ($('#atmosphere-status').textContent !== resolved.status) $('#atmosphere-status').textContent = resolved.status;
  $('.board-shell').dataset.period = resolved.period;
  $('.board-shell').dataset.weather = resolved.weather;
  renderWeatherPlace();
}
function renderWeatherPlace() {
  const local = sky.weather === 'local', editing = local && (sky.editing || !sky.place);
  $('#weather-place').hidden = !local;
  $('#weather-place-current').hidden = !local || !sky.place;
  if (sky.place) $('#weather-place-name').textContent = `Local weather: ${sky.place.label}`;
  $('#weather-place-form').hidden = !editing;
  if (!editing) $('#weather-place-results').replaceChildren();
}
// Load the chosen town's weather. A newer mode, town or disconnect cancels it, and an old answer never overrides them.
// Scheduled loads (the minute tick, the page becoming visible) wait at least 15 minutes after any attempt for that town,
// failed or not. Only an explicit choice (choosing a town, switching to Local weather) forces a new attempt sooner.
async function loadLocalWeather({ force = false } = {}) {
  if (sky.weather !== 'local' || !sky.place || document.hidden) return;
  if (!force && sky.attemptPlaceId === sky.place.id && Date.now() < sky.nextAttemptAt) return;
  sky.controller?.abort();
  const generation = ++sky.generation, controller = (sky.controller = new AbortController()), place = sky.place;
  Object.assign(sky, { loading: true, attemptPlaceId: place.id, nextAttemptAt: Date.now() + WEATHER_TTL_MS });
  applySky();
  try {
    const result = await weatherClient().loadWeather(place, { signal: controller.signal });
    if (generation !== sky.generation || sky.weather !== 'local' || sky.place?.id !== place.id) return;
    Object.assign(sky, { result, error: null, nextAttemptAt: Math.max(sky.nextAttemptAt, result.expiresAt) });
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== sky.generation) {
      if (generation === sky.generation) sky.nextAttemptAt = 0; // canceled, not attempted: a later tick may try
      return;
    }
    sky.error = error?.message || 'The weather service could not be reached.';
  } finally {
    if (generation === sky.generation) { sky.loading = false; sky.controller = null; applySky(); }
  }
}
function cancelLocalWeather() {
  sky.generation++;
  sky.controller?.abort();
  sky.searchGeneration++;
  sky.searchController?.abort();
  Object.assign(sky, { controller: null, searchController: null, loading: false });
}
async function searchTowns(event) {
  event.preventDefault();
  sky.searchController?.abort();
  const generation = ++sky.searchGeneration, controller = (sky.searchController = new AbortController());
  $('#weather-place-results').replaceChildren();
  $('#weather-place-status').textContent = 'Searching Open-Meteo for that town…';
  try {
    const places = await weatherClient().searchPlaces($('#weather-place-query').value, { signal: controller.signal });
    if (generation !== sky.searchGeneration || sky.weather !== 'local') return;
    $('#weather-place-status').textContent = places.length ? `${places.length} ${places.length === 1 ? 'town' : 'towns'} found. Choose one to use its weather.` : 'No town found. Try another spelling.';
    $('#weather-place-results').replaceChildren(...places.map((place) => h('li', {}, h('button', { type: 'button', 'data-place': place.id, onclick: () => choosePlace(place) }, place.label))));
  } catch (error) {
    if (error?.name === 'AbortError' || generation !== sky.searchGeneration) return;
    $('#weather-place-status').textContent = error?.message || 'The town search did not work.';
  } finally {
    if (generation === sky.searchGeneration) sky.searchController = null;
  }
}
function choosePlace(place) {
  cancelLocalWeather();
  Object.assign(sky, { place, result: null, error: null, editing: false, weather: 'local' });
  pref.set('atmosphere:place', JSON.stringify(place));
  pref.set('atmosphere:weather', 'local');
  $('#weather-place-status').textContent = '';
  applySky();
  $('#weather-change').focus();
  loadLocalWeather({ force: true });
}
function disconnectLocalWeather() {
  cancelLocalWeather();
  sky.client?.clear();
  Object.assign(sky, { place: null, result: null, error: null, editing: false, weather: 'clear', attemptPlaceId: null, nextAttemptAt: 0 });
  pref.remove('atmosphere:place');
  pref.set('atmosphere:weather', 'clear');
  $('#weather-place-status').textContent = '';
  applySky();
  $('#weather-mode').focus();
}
function bindAtmosphere() {
  $('#time-mode').addEventListener('change', (e) => { sky.time = e.target.value; pref.set('atmosphere:time', sky.time); applySky(); });
  $('#weather-mode').addEventListener('change', (e) => {
    sky.weather = e.target.value;
    pref.set('atmosphere:weather', sky.weather);
    if (sky.weather !== 'local') { cancelLocalWeather(); sky.editing = false; applySky(); return; }
    sky.editing = !sky.place;
    applySky();
    if (sky.place) loadLocalWeather({ force: true }); else $('#weather-place-query').focus();
  });
  $('#weather-place-form').addEventListener('submit', searchTowns);
  $('#weather-change').addEventListener('click', () => { sky.editing = true; renderWeatherPlace(); $('#weather-place-query').focus(); });
  $('#weather-disconnect').addEventListener('click', disconnectLocalWeather);
  // The Auto period follows the clock minute by minute; local weather refreshes at most every 15 minutes while visible.
  setInterval(() => { if (!document.hidden) { applySky(); loadLocalWeather(); } }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { applySky(); loadLocalWeather(); } });
}

async function boot() {
  // The server says whether this is the example household or shared families, and who (if anyone) is signed in. A
  // shared family's page shows nothing of the realm until a passkey signs someone in: no world, journal or records.
  let session = { mode: 'example' };
  try { session = await api.get('/api/session'); } catch { /* the household read below reports an unreachable server */ }
  const invite = takeInvitationFromUrl();
  if (session.mode === 'family') {
    family.on = true;
    document.body.dataset.access = 'family';
    family.dialog = createAccessDialog({ signedIn: session.signedIn });
    // An invitation link opened in a tab that is already open changes only the fragment; take it the same way.
    window.addEventListener('hashchange', () => {
      const token = takeInvitationFromUrl();
      if (token) family.dialog.open({ invite: token, signedIn: Boolean(state) && !family.lost });
    });
    if (!session.signedIn) {
      document.body.dataset.signedIn = 'false';
      $('#world').setAttribute('aria-busy', 'false');
      await family.dialog.open({ invite });
      exposeDebug();
      document.body.dataset.ready = 'true';
      return;
    }
    setSession({ csrf: session.csrfToken, lost: sessionLost });
    // This page belongs to one member of one household for its whole life; a state for anyone else is never shown here.
    family.householdId = session.household.id;
    family.memberId = session.member.id;
    ui.personaId = session.member.id;
    ui.commitments = []; // a real family reports its own bills; the example bill row is example data
  }
  try {
    // The board announces hops and tier rises on the bus; sound (and tests) listen. Nothing calls audio directly.
    scene = createBoardScene($('#world'), {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      isOccluded: () => Boolean(document.querySelector('dialog[open]')),
      onEvent: (type, detail) => bus.emit(`scene:${type}`, detail),
      insets: worldInsets,
      onViewChange: syncRealmMarkers,
    });
  } catch (error) {
    console.warn('[our-castle] 3D board unavailable', error);
    $('#world').hidden = true;
    $('#world-fallback').hidden = false;
    $('#pixel-toggle').hidden = true;
    $('#sound-toggle').hidden = true;
  }
  $('#world').setAttribute('aria-busy', 'false');
  bindAtmosphere();
  applySky();
  loadLocalWeather();
  buildCrestPickers();
  buildProjectChoices();
  bindEvents();
  try {
    if (family.on && invite) family.dialog.open({ invite, signedIn: true });
    applyState(await api.get('/api/state'), { animate: false });
    selectTab(resumeTab(), { focus: false, remember: false, open: false });
    setJournalOpen(pref.get('journal') !== 'closed', { remember: false });
    scene?.focusDistrict(homeDistrict(state.board.builtTier).id);
    if (family.on) startFamilyLive();
  } catch (error) {
    $('#honesty').textContent = `Could not load the household: ${error.message}`;
  }
  exposeDebug();
  document.body.dataset.ready = 'true';
  window.__booted = true;
}
function exposeDebug() {
  window.__ourCastle = { get state() { return state; }, scene: () => scene?.debug() ?? null, treasury: () => treasury?.status() ?? null, sky: () => ({ time: sky.time, weather: sky.weather, place: sky.place, loading: sky.loading, error: sky.error, result: sky.result && { kind: sky.result.kind, label: sky.result.label, expiresAt: sky.result.expiresAt }, resolved: sky.resolved }), route: () => scene?.routeOnScreen() ?? null, bus, sound: () => ({ enabled: sound.enabled, played: sound.played() }), family: () => ({ on: family.on, refreshes: family.refreshes, lost: family.lost, live: family.status, revision: family.revision, discarded: family.discarded, stream: family.live?.status() ?? null }) };
}

// ---------- Family access (shared families with passkeys; absent in example mode) ----------
const family = {
  on: false, dialog: null, lost: false, householdId: null, memberId: null,
  // Live updates: the stream, its state ('off', 'live', 'down', 'polling'), and the one state read allowed at a time.
  live: null, status: 'off', statusTimer: null, timer: null, lastRefresh: 0, refreshes: 0, reading: null, again: false, stale: false,
  // The newest household revision this page shows, the server starts it has seen (in order), answers set aside as older,
  // and how many times this browser's session was renewed (a renewed session clears an approval given before it).
  revision: null, boots: [], discarded: 0, epoch: 0, retryTimer: null,
};
const SESSION_ENDED = {
  expired: 'Your session ended. Sign in again with your passkey.',
  signed_out: 'You signed out in this browser. Sign in again to continue.',
  access_revoked: 'Your access to this family was removed.',
};
// An invitation arrives in the link's fragment, which is never sent to the server by the browser. Take it out of the
// address bar and history at once; it is used only through a checked same-origin request.
function takeInvitationFromUrl() {
  if (!location.hash.startsWith('#invite=')) return null;
  const token = location.hash.slice('#invite='.length);
  history.replaceState(null, '', location.pathname + location.search);
  return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : 'invalid';
}
// The session ended (expired, signed out elsewhere or access removed): stop refreshing and ask for the passkey again.
// The household stays behind the dialog's backdrop; signing in reloads the page for whoever signs in.
function sessionLost(error) {
  if (family.lost) return;
  family.lost = true;
  family.live?.stop();
  clearInterval(family.timer); clearTimeout(family.statusTimer); clearTimeout(family.retryTimer);
  showLiveStatus(false);
  setSession({});
  document.body.dataset.signedIn = 'false'; // nothing of this household stays visible behind the sign-in dialog
  family.dialog.open({ message: error.message, signedIn: false });
}
// Collaborators see each other's saved changes as they happen. The live stream says only that the household changed;
// the page then re-reads its own state, one read at a time, and keeps the newest answer. Without a stream (a dropped
// connection, a restarting server, or another tab of this browser holding it) the page re-reads when shown or focused
// and at most every 45 seconds while visible. Reads only: unsaved edits are kept by the existing dirty-form guards.
function startFamilyLive() {
  const streaming = () => family.status === 'live';
  family.live = createFamilyLive({
    onChange: (kind, revision) => { if (!revision || revision !== family.revision) readFamilyState({ background: true }); },
    onEnded: (reason) => sessionLost({ message: SESSION_ENDED[reason] ?? SESSION_ENDED.expired }),
    onStatus: setLiveStatus,
    checkSession: checkFamilySession,
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || family.lost) return;
    if (family.live.status().replaced) family.live.retryNow();
    if (family.stale || !streaming()) readFamilyState({ throttle: true });
  });
  window.addEventListener('focus', () => { if (!family.lost && (family.stale || !streaming())) readFamilyState({ throttle: true }); });
  family.timer = setInterval(() => { if (!streaming() && document.visibilityState === 'visible') readFamilyState({ background: true, throttle: true }); }, 45_000);
  $('#live-retry').addEventListener('click', () => { family.live?.retryNow(); readFamilyState(); });
}
// Is this browser still signed in as this page's member? A renewed session (signed in again in another tab) keeps the
// page, with its new CSRF token; anyone else, or no one, sends it to sign-in.
async function checkFamilySession() {
  let session;
  try { session = await api.get('/api/session', { background: true }); } catch { return 'unreachable'; }
  if (!session.signedIn || session.member?.id !== family.memberId || session.household?.id !== family.householdId) return 'signed-out';
  family.epoch++;
  setSession({ csrf: session.csrfToken, lost: sessionLost });
  return 'signed-in';
}
// One state read at a time. A change announced while one is under way reads once more after it; a hidden tab waits
// until it is shown. A failed read (the server is restarting or unreachable) tries again once, a few seconds later.
async function readFamilyState({ background = false, throttle = false } = {}) {
  if (family.lost) return;
  if (document.visibilityState !== 'visible') { family.stale = true; return; }
  if (throttle && Date.now() - family.lastRefresh < 5_000) return;
  if (family.reading) { family.again = true; return family.reading; }
  family.reading = (async () => {
    do {
      family.again = false; family.stale = false; family.lastRefresh = Date.now();
      try {
        const next = await api.get('/api/state', { background });
        if (!family.lost && applyState(next)) family.refreshes++;
      } catch (error) {
        if (family.lost || error.status) break; // an ended session opens sign-in; other refusals wait for the next change
        family.stale = true;
        clearTimeout(family.retryTimer);
        family.retryTimer = setTimeout(() => readFamilyState({ background: true }), 5_000);
        break;
      }
    } while (family.again && !family.lost);
  })().finally(() => { family.reading = null; });
  return family.reading;
}
// The one connection state: shown only when live updates have been away for a while, with the action that helps.
function setLiveStatus(status) {
  const was = family.status;
  family.status = status;
  if (status === 'down') {
    // Timed from the first failure: the browser's own retries every few seconds do not restart the wait.
    if (was !== 'down') family.statusTimer = setTimeout(() => showLiveStatus(!family.lost && family.status === 'down'), 8_000);
    return;
  }
  clearTimeout(family.statusTimer);
  showLiveStatus(false);
}
function showLiveStatus(show) {
  const box = $('#live-status');
  if (box) box.hidden = !show;
}
// Accept a state for this page only if it is this member's household and no older than the one shown. Revisions are
// "<server start>.<count>": a later count, or a newer server start, is newer.
function acceptFamilyState(next) {
  if (next?.household?.id !== family.householdId || (next.access && next.access.me.memberId !== family.memberId)) {
    sessionLost({ message: 'This browser is now signed in as someone else. Sign in again to continue here.' });
    return false;
  }
  const [boot, count] = String(next.revision ?? '').split('.');
  if (!boot) return true;
  const [shownBoot, shownCount] = String(family.revision ?? '').split('.');
  if (shownBoot) {
    const older = family.boots.indexOf(boot) !== -1 && family.boots.indexOf(boot) < family.boots.indexOf(shownBoot);
    if (older || (boot === shownBoot && Number(count) < Number(shownCount))) { family.discarded++; return false; }
  }
  if (!family.boots.includes(boot)) family.boots.push(boot);
  family.revision = next.revision;
  return true;
}

// A returning family lands on the tab they last chose in this browser tab; otherwise on the tab holding their next step.
// An unfounded house always starts at House.
function resumeTab() {
  const chosen = sessionTab.get();
  if (!state.household.setupComplete) return 'house';
  return TABS.includes(chosen) ? chosen : TABS.includes(ui.next?.step) ? ui.next.step : 'ledger';
}

// Announce only additions earned between two authoritative server states for the same goal (see rewards.js).
const newlyEarned = (previous, next) => (previous?.goal?.id === next?.goal?.id ? newlyEarnedEstate(previous?.rewards, next?.rewards) : []);

function applyState(next, options = {}) {
  if (family.on && !acceptFamilyState(next)) {
    // An older answer arrived after a newer one: keep the newer records, and still draw what this action changed on the
    // page around them (a receipt, a status).
    if (state && !family.lost) drawState(state, { animate: false });
    return false;
  }
  drawState(next, options);
  return true;
}
function drawState(next, { animate = true, result = null } = {}) {
  const added = newlyEarned(state, next);
  // Areas the server newly opened for this household and goal (never on a first load, reload or replay).
  const opened = newlyOpenedDistricts(state, next);
  const scope = { householdId: next.household.id, goalId: next.goal.id };
  state = next;
  if (state.access) ui.personaId = state.access.me.memberId; // a signed-in member is always themselves
  else if (!persona()) ui.personaId = state.members.find((m) => m.role === 'adult')?.id ?? state.members[0]?.id;
  renderHeader();
  renderQuest();
  renderNextStep();
  const boardDone = renderBoard({ animate, result, added, hasNewDistrict: opened.length > 0 });
  if (opened.length) Promise.resolve(boardDone).then(() => queueDeedsWhenFree(opened, scope));
  renderHouse();
  renderPlan();
  renderGive();
  renderLedger();
  renderTabs();
  renderFooter();
  bus.emit('state:applied', { result, added: added.map((r) => r.id) });
}

// ---------- the family's next step ----------
// A receipt counts as shown per contribution *and* status: seeing a pending receipt does not cover its later completion.
const receiptKey = () => (ui.receipt ? `${ui.receipt.contribution.id}:${ui.receipt.contribution.status}` : null);
// Text is updated in place, so the button keeps focus across refreshes. Nothing here writes to the server.
function renderNextStep() {
  if (!state) return;
  const next = nextAction(state, { persona: persona(), receipt: ui.receipt?.contribution ?? null, receiptReviewed: Boolean(ui.receipt) && ui.receiptReviewed === receiptKey() });
  ui.next = next;
  $('#next-step').dataset.key = next.key;
  const go = $('#next-step-go');
  if (go.textContent !== next.cta) go.textContent = next.cta;
  go.hidden = next.step === ui.tab && next.key !== 'receipt-ready';
  const record = $('#next-step-record');
  record.hidden = !next.record || ['give', 'ledger'].includes(ui.tab);
  if (next.record) {
    const r = next.record;
    $('#next-step-record-text').textContent = `${money(r.amountCents)} · ${STATUS_LABEL[r.status] ?? r.status} · ${r.simulated ? 'simulated' : 'sandbox'}`;
    record.dataset.contribution = r.contributionId;
  }
  $('#next-step').hidden = go.hidden && record.hidden;
  renderTabs();
}
// Open the Ledger at that record. No server call: the record is already in the loaded state.
function openPaymentRecord(e) {
  const id = $('#next-step-record').dataset.contribution;
  ui.ledgerRecord = ledgerRows().find((r) => r.contribution?.id === id)?.id ?? ui.ledgerRecord;
  selectTab('ledger', { focus: false });
  renderLedgerRecord();
  ledgerGrid?.selectRecord(ui.ledgerRecord);
  revealInLedger(() => $(`#ledger-contributions [data-contribution="${CSS.escape(id)}"]`) ?? $('#ledger-contrib-title'), e?.detail === 0);
}
// The Ledger grid loads and sizes itself lazily (started by selectTab), and the contributions below it move when it
// does. Measure and reveal a Ledger destination only after that layout has settled, and only if the family is still on
// the Ledger and has not moved focus elsewhere in the meantime.
async function revealInLedger(target, keyboard) {
  const navigation = ui.navigation, origin = document.activeElement;
  await ui.ledgerLayout;
  await layoutSettled($('#ledger-goal'));
  if (navigation !== ui.navigation || ui.tab !== 'ledger') return;
  if (document.activeElement !== origin && document.activeElement !== document.body) return;
  revealFocus(target(), keyboard);
}
// Resolves when an element keeps the same height for two animation frames (the grid's auto-height rows are measured).
// Bounded, so a page that never settles still gets its focus.
function layoutSettled(el, maxFrames = 120) {
  return new Promise((resolve) => {
    let last = -1, same = 0, frames = 0;
    const tick = () => {
      const height = el.getBoundingClientRect().height;
      same = height === last ? same + 1 : 0;
      last = height;
      if (same >= 2 || ++frames >= maxFrames) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function revealFocus(target, keyboard) {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', behavior: keyboard || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
// Open the step: switch tab and move focus to its heading or control. Keyboard activation scrolls instantly.
function openNextStep(e) {
  const next = ui.next;
  if (!next) return;
  if (next.step === 'realm') {
    ui.navigation++;
    const id = $(next.target)?.dataset.district;
    if (id && scene) visitDistrict(id, e);
    return;
  }
  selectTab(next.step, { focus: false });
  let target = $(next.target);
  if (!target || target.hidden || target.closest('[hidden]')) target = $(`#panel-${next.step} h3`);
  if (next.key === 'receipt-ready') ui.receiptReviewed = receiptKey();
  if (next.step === 'ledger') revealInLedger(() => target, e?.detail === 0);
  else revealFocus(target, e?.detail === 0);
  renderNextStep();
}

// ---------- header, quest, board ----------
function renderHeader() {
  const { household, modes, members } = state;
  $('#brand-crest').innerHTML = crestSvg(household.crest, { title: `${household.name} crest` });
  $('#house-eyebrow').textContent = household.setupComplete
    ? household.name
    : 'Your household';
  $('#mode-badges').replaceChildren(
    h('li', { class: `mode-badge ${modes.payments.mode === 'sandbox' ? 'live' : 'example'}`, title: modes.payments.mode === 'sandbox' ? 'Real PayPal sandbox API calls with test money' : 'No PayPal calls; payments are simulated and labeled' },
      modes.payments.mode === 'sandbox' ? 'PayPal sandbox' : 'Simulated payments'),
    h('li', { class: `mode-badge ${modes.ai.mode === 'live' ? 'live' : 'example'}`, title: modes.ai.mode === 'live' ? `Plans are written by ${modes.ai.model} and checked by the server` : 'Plans come from built-in rules; no AI is called' },
      modes.ai.mode === 'live' ? 'AI planner' : 'Built-in planner'),
  );
  const select = $('#persona');
  select.closest('.persona').hidden = Boolean(state.access);
  $('#signed-in').hidden = !state.access;
  if (state.access) { const me = members.find((m) => m.id === state.access.me.memberId); $('#signed-in').textContent = `${me?.name ?? ''} · ${state.access.me.role === 'adult' ? 'Adult' : 'Child'}`; return; }
  select.replaceChildren(...members.map((m) => h('option', { value: m.id, selected: m.id === ui.personaId }, `${m.name} · ${m.role === 'adult' ? 'Adult' : 'Child'}`)));
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
    ? `${next.name} · ${money(next.awayCents)} to go`
    : 'Goal reached. The castle stands.';
  const parts = [`${money(progress.startingCents)} reported savings`];
  if (progress.contributedCents) parts.push(`${money(progress.contributedCents)} confirmed in PayPal sandbox`);
  if (progress.simulatedContributedCents) parts.push(`${money(progress.simulatedContributedCents)} simulated`);
  if (progress.refundedCents + progress.simulatedRefundedCents) parts.push(`${money(progress.refundedCents + progress.simulatedRefundedCents)} refunded`);
  $('#progress-breakdown').textContent = parts.join(' · ');
}

function renderBoard({ animate, result, added = [], hasNewDistrict = false }) {
  // The earned deed is the celebration for a new district; do not stack a second banner behind it.
  if (hasNewDistrict) { clearTimeout(ui.celebrationTimer); $('#celebration').hidden = true; }
  const { board, household, goal, progress } = state;
  const built = TIERS[board.builtTier];
  $('#board-title').textContent = 'Your connected realm';
  $('#realm-progress-summary').textContent = `${goal.name} · ${money(progress.progressCents)} of ${money(goal.targetCents)} tracked`;
  let status = board.position >= ROUTE_LENGTH
    ? `Travelers are home at the castle gate (space ${ROUTE_LENGTH} of ${ROUTE_LENGTH}). `
    : `Travelers on space ${board.position} of ${ROUTE_LENGTH} · ${board.spaceName}. `;
  status += board.builtTierCommemorative
    ? `The ${built.name} commemorates a milestone reached earlier; current progress is ${formatPercent(progress.progressCents, goal.targetCents)}.`
    : `The ${built.name.toLowerCase()} district is open; locked districts wait across the rivers behind raised bridges.`;
  if (board.gardens) status += ` ${board.gardens} garden bed${board.gardens === 1 ? '' : 's'} for bill habits.`;
  status += ` ${courtForTier(board.builtTier).capacity} guests roam the grounds.`;
  $('#board-status').textContent = status;
  renderRealmNavigation();
  $('#tier-track').replaceChildren(...board.tiers.map((t) => h('li', {
    class: [t.built ? 'built' : '', t.index === board.currentTier ? 'current' : ''].join(' ').trim(),
    'aria-current': t.index === board.currentTier ? 'step' : false,
  }, h('strong', {}, `${t.numeral} · ${t.name}`), t.percent ? money(t.targetCents) : 'Start')));
  if (!scene) return null;
  // Returned so a new-area deed can wait until the board has finished moving.
  return scene.update({
    builtTier: board.builtTier,
    position: board.position,
    crest: household.crest,
    gardens: board.gardens,
    estateLevel: board.estateLevel ?? 0,
    previewFeature: null,
    playMode: household.playMode,
    members: state.members,
    milestoneSpaces: board.milestoneSpaces.map((m) => m.space),
    // The project's stage is read from the server's progress and goal through the existing milestone rules; what it
    // builds is the family's saved choice, never an unsaved Plan field.
    project: (({ index, key, detail, kind }) => ({ index, key, detail, kind }))(currentProject()),
  }, { animate }).then(() => {
    if (!hasNewDistrict && (result?.awarded?.length || added.length)) celebrate(result?.awarded ?? [], added);
  });
}

// Bring the realm into view (as before: the top of the board) without stranding keyboard focus. `keep` is the control
// that has focus afterwards; the scroll is limited so that it stays fully inside the viewport. A keyboard activation
// (`instant`) jumps straight there: focus has already moved, so the focused control must be on screen at once, even when
// a busy renderer would stall a smooth scroll. Pointer navigation keeps the smooth scroll.
function revealRealm(keep, { instant = false } = {}) {
  const margin = 8, r = keep?.getBoundingClientRect();
  let delta = $('.board-shell').getBoundingClientRect().top - margin;
  if (r) delta = Math.min(Math.max(delta, r.bottom + margin - innerHeight), r.top - margin);
  if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

function districtCondition(district) {
  if(district.percent===null)return 'Report an on-time bill to unlock';
  if(district.percent===0)return 'Starting district';
  const required=Math.ceil(state.goal.targetCents*district.percent/100),remaining=Math.max(0,required-state.progress.progressCents);
  return remaining ? `${money(remaining)} to unlock` : `${district.percent}% milestone`;
}
function renderRealmNavigation() {
  const regions = realmAccess({ builtTier: state.board.builtTier, estateLevel: state.board.estateLevel, gardens: state.board.gardens });
  const lock = '<svg viewBox="0 0 12 14" width="12" height="14" fill="none" aria-hidden="true"><path d="M3 6V4a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.5"/><rect x="1.5" y="6" width="9" height="6.5" rx=".5" fill="currentColor"/></svg>';
  $('#realm-districts').replaceChildren(...regions.map((d) => h('button', { type: 'button', class: 'realm-stop', 'data-district': d.id, 'data-status': d.status, 'aria-pressed': 'false' },
    h('strong', {}, d.name), h('small', {}, d.open ? 'Open district' : `Locked · ${d.percent === null ? 'bill habit' : `${d.percent}%`}`))));
  $('#realm-markers').replaceChildren(...regions.map((d) => h('button', { type: 'button', class: 'realm-marker', 'data-district': d.id, 'data-status': d.status, 'aria-label': `Inspect ${d.name} on the map`, hidden: true },
    !d.open && h('span', { class: 'realm-lock', 'aria-hidden': 'true', html: lock }), h('strong', {}, d.name))));
  $('#realm-markers').append(h('button', {type:'button',id:'sword-glint',class:'realm-legend','data-legend':'sword-stone','aria-label':'Investigate the glint in the trees','aria-pressed':'false',hidden:true},h('span',{'aria-hidden':'true'},'✦')));
  // The family project: a small marker in the west meadow drawn as the chosen place (a tent, a sprout or a schoolhouse
  // with its bell). Selecting it only moves the camera and names its stage.
  const kind = projectKind(state.goal.projectKind);
  $('#realm-markers').append(h('button', {type:'button',id:'project-marker',class:'realm-legend realm-project','data-legend':FAMILY_PROJECT_SITE.id,'data-kind':kind.key,'aria-label':`Visit the ${kind.name.toLowerCase()}`,'aria-pressed':'false',hidden:true},h('span',{'aria-hidden':'true',html:PROJECT_ICONS[kind.key]})));
  $('#realm-focus-status').textContent = 'Select a district.';
}
function syncRealmMarkers({focus,points}){
  const map=$('.realm-map'),focused=focus?'true':'false';if(map.dataset.focused!==focused)map.dataset.focused=focused;
  const board=map.closest('.board-shell'),menuHeight=Math.max(120,Math.floor(map.clientHeight-110))+'px';
  if(board.style.getPropertyValue('--world-menu-height')!==menuHeight)board.style.setProperty('--world-menu-height',menuHeight);
  // On a phone, full property plaques would cover the overview. Keep the current home named;
  // all districts stay available in Areas and a focused district always gets its full plaque.
  const compactOverview = !focus && map.clientWidth < 640;
  const home = homeDistrict(state?.board?.builtTier ?? 0).id;
  const occupied=[];
  const priority=(p)=>document.activeElement?.dataset?.district===p.id?3:p.id===home?2:0;
  for(const point of [...points].sort((a,b)=>priority(b)-priority(a))){
    const legend = point.id === 'sword-stone' || point.id === FAMILY_PROJECT_SITE.id;
    const el=legend ? $(`#realm-markers [data-legend="${point.id}"]`) : $(`#realm-markers [data-district="${point.id}"]`);if(!el)continue;
    // A small marker also shows while a neighbouring district is in view: the grove beside the garden and keep, the campsite beside the village.
    const nearby = point.id === 'sword-stone' ? ['garden','keep'] : point.id === FAMILY_PROJECT_SITE.id ? ['cottage'] : [];
    const visible = (!focus || point.id === focus || legend && nearby.includes(focus)) && (!compactOverview || legend || point.id === home || el === document.activeElement) && point.x > 0 && point.x < point.width && point.y > 0 && point.y < point.height;
    el.hidden = !visible;
    if (visible) {
      const px=Math.max(el.offsetWidth/2+8,Math.min(point.width-el.offsetWidth/2-8,point.x));
      const py=Math.max(el.offsetHeight+8,Math.min(point.height-8,point.y));
      const bounds={left:px-el.offsetWidth/2,right:px+el.offsetWidth/2,top:py-el.offsetHeight,bottom:py};
      if(!legend&&!focus){
        if(el!==document.activeElement&&occupied.some(b=>bounds.left<b.right+6&&bounds.right>b.left-6&&bounds.top<b.bottom+6&&bounds.bottom>b.top-6)){el.hidden=true;continue;}
        occupied.push(bounds);
      }
      const x=px+'px',y=py+'px';
      if (el.style.left !== x) el.style.left = x;
      if (el.style.top !== y) el.style.top = y;
    }
  }
  for(const button of $$('#realm-districts button, #realm-markers button')){const value=String((button.dataset.district ?? button.dataset.legend)===focus);if(button.getAttribute('aria-pressed')!==value)button.setAttribute('aria-pressed',value);}
  if(!state)return;
  const regions=realmAccess({builtTier:state.board.builtTier,estateLevel:state.board.estateLevel,gardens:state.board.gardens});
  const d=regions.find(d=>d.id===focus);
  const merchantButton = $('#open-merchant');
  if (merchantButton.hidden !== (focus !== 'market')) merchantButton.hidden = focus !== 'market';
  const deedButton = $('#view-deed');
  deedButton.hidden = !d?.open;
  if (d?.open) {
    deedButton.dataset.district = d.id;
    deedButton.setAttribute('aria-label', `View deed for ${d.name}`);
  } else delete deedButton.dataset.district;
  const secret = REALM_LEGENDS.find(d=>d.id===focus);
  const message=focus===FAMILY_PROJECT_SITE.id ? projectLabel(currentProject()) : secret ? secret.name : d && !d.open ? `${d.name} · ${districtCondition(d)}` : '';
  if($('#realm-focus-status').textContent!==message)$('#realm-focus-status').textContent=message;
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

// ---------- District deeds: a card when the server newly opens an area ----------
// Queue newly opened districts after the board animation. Each is re-checked against the current household, goal and
// access, so a later state (a reset, another goal) cannot show a stale card.
// An open dialog is never closed and reopened here: its close event arrives later and would clear the new deeds. New
// deeds join an open queue, or replace a deed opened from the map, in place; focus later returns to the origin
// that opened the dialog first.
// A newly opened area's deed is a modal card. Someone typing (a goal, an invitation, an amount) keeps their place: the
// card waits until focus leaves the field. This matters when the change came from another member's page.
const editingField = () => document.activeElement?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select') ?? false;
function queueDeedsWhenFree(ids, scope) {
  if (!editingField()) { queueDeeds(ids, scope); return; }
  const wait = () => setTimeout(() => {
    if (editingField()) return;
    document.removeEventListener('focusout', wait);
    queueDeeds(ids, scope);
  }, 0);
  document.addEventListener('focusout', wait);
}
function queueDeeds(ids, scope) {
  if (state.household.id !== scope.householdId || state.goal.id !== scope.goalId) return;
  const open = new Set(state.rewards.realm.districts.filter((d) => d.open).map((d) => d.id));
  const d = ui.deeds, dialog = $('#deed-dialog');
  const fresh = ids.filter((id) => open.has(id) && !(d.mode === 'new' && dialog.open && d.queue.includes(id)));
  if (!fresh.length) return;
  if (dialog.open && d.mode === 'new') { d.queue.push(...fresh); renderDeed(); return; }
  if (dialog.open) Object.assign(d, { queue: fresh, index: 0, mode: 'new', visiting: false });
  else Object.assign(d, { queue: fresh, index: 0, mode: 'new', origin: document.activeElement, visiting: false });
  showDeed();
}
function openDeedFromMap(id, origin) {
  if (!districtDeed(state, id)?.open) return;
  const dialog = $('#deed-dialog');
  Object.assign(ui.deeds, { queue: [id], index: 0, mode: 'map', visiting: false, ...(dialog.open ? {} : { origin }) });
  showDeed();
}
function showDeed() {
  const dialog = $('#deed-dialog');
  renderDeed();
  if (!dialog.open) dialog.showModal();
  $('#deed-name').focus();
}
function renderDeed() {
  const d = ui.deeds, id = d.queue[d.index], deed = districtDeed(state, id);
  if (!deed) return;
  const card = $('#deed');
  card.dataset.district = id;
  card.dataset.status = deed.status;
  card.style.setProperty('--deed', `var(--${deed.colour})`);
  $('#deed-name').textContent = deed.name;
  $('#deed-count').textContent = d.queue.length > 1 ? `${d.index + 1} / ${d.queue.length}` : '';
  const art = $('#deed-art');
  if (art.getAttribute('src') !== deed.art) art.setAttribute('src', deed.art);
  art.alt = `Pixel portrait of ${deed.name}`; // an illustration of the area, not a live view of the earned realm
  $('#deed-seal').innerHTML = crestSvg(state.household.crest, { title: `${state.household.name} seal` });
  const family = $('#deed-family');
  family.hidden = d.mode !== 'new' || deed.status !== 'earned';
  family.setAttribute('aria-label', state.household.name);
  family.replaceChildren(...(family.hidden ? [] : state.members.map((member, index) => {
    const avatar = memberAvatar(member, index), label = `${member.name} · ${avatar.label}`;
    return h('img', { src: avatarImage(avatar.id), alt: label, title: label, width: 44, height: 44,
      'data-member': member.id, style: `--arrival: ${Math.min(index, 3) * 30}ms` });
  })));
  const percent = districtById(id).percent;
  const milestone = deed.selfReported ? 'Recorded bill habit' : percent ? `${percent}% milestone` : 'Starting village';
  $('#deed-earned').textContent = `${deed.status === 'keepsake' ? 'Keepsake' : deed.open ? 'Unlocked' : 'Locked'} · ${milestone}`;
  const visit = $('#deed-visit');
  visit.textContent = 'Visit';
  visit.setAttribute('aria-label', `Visit ${deed.name}`);
  visit.hidden = !deed.open;
  const more = d.index < d.queue.length - 1;
  $('#deed-next').hidden = !more;
  $('#deed-next').textContent = 'Next';
  $('#deed-next').setAttribute('aria-label', more ? `Next deed (${d.index + 2} of ${d.queue.length})` : 'Next deed');
  $('#deed-close').textContent = 'Close';
  $('#deed-close').setAttribute('aria-label', more ? 'Close all' : 'Close');
}
// Visit the earned district and keep keyboard focus on its map control. No writes.
function visitDeed(e) {
  const id = ui.deeds.queue[ui.deeds.index];
  ui.deeds.visiting = true;
  $('#deed-dialog').close();
  scene?.focusDistrict(id);
  $('.realm-map').dataset.focused = 'true';
  const button = $(`#realm-markers [data-district="${CSS.escape(id)}"]`);
  if (!button) return;
  button.focus({ preventScroll: true });
  revealRealm(button, { instant: e?.detail === 0 });
}
// Closing (button or Escape) returns focus to its map button, or the district if that button became hidden.
// A close event that arrives after the dialog was opened again belongs to the earlier deed and is ignored.
function deedClosed() {
  if ($('#deed-dialog').open) return;
  const d = ui.deeds, id = d.queue[d.index];
  const visiting = d.visiting;
  Object.assign(d, { queue: [], index: 0, visiting: false });
  if (visiting) return;
  let target = d.origin;
  if (!target?.isConnected || target.closest('[hidden], details:not([open])')) {
    const marker = $(`#realm-markers [data-district="${CSS.escape(id ?? '')}"]`);
    target = marker && !marker.hidden ? marker : $('#journal-toggle');
  }
  target.focus();
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
// The Plan form's "Build" choice: the listed places only. Its value is saved with the goal, never on change.
function buildProjectChoices() {
  $('#goal-project').replaceChildren(...PROJECT_KINDS.map((k) => h('option', { value: k.key }, k.label)));
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
  // Shared families: members are the people who enrolled; only the owner names the house; each member edits their own avatar.
  const access = state.access, owner = !access || access.me.owner;
  $('#play-mode').hidden = Boolean(access);
  nameInput.disabled = !owner;
  for (const input of $$('input[name="crestField"], input[name="crestCharge"]')) input.disabled = !owner;
  $('#save-house').hidden = !owner;
  if (!familyAvatars) familyAvatars = createFamilyAvatars($('#family-avatars'), { save: async (memberId, avatarId) => {
    const res = await api.put('/api/members/' + encodeURIComponent(memberId) + '/avatar', { avatarId });
    applyState(res.state, { animate: false });
  }, canEdit: (member) => !state.access || member.id === state.access.me.memberId });
  familyAvatars.update(access ? state.members.filter((m) => access.members.some((a) => a.id === m.id && a.access === 'active')) : state.members);
  renderFamilyAccess(state, { onState: (next) => applyState(next, { animate: false }), onStatus: (kind, message) => setStatus('#house-status', kind, message) });
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
function renderPlan() { renderPlanForm(); lockPlanForChildren(); }
// A child in a shared family sees the goal and plan and may try a weekly amount or date with the read-only check, but
// changes neither; the server refuses those requests anyway.
function lockPlanForChildren() {
  if (!state.access || state.access.me.role === 'adult') return;
  for (const el of $$('#plan-form input:not(#goal-weekly):not(#goal-date), #plan-form select, #plan-form button:not(#check-schedule), #plan-schedule input, #save-edits, #accept-plan, #goal-draft button')) el.disabled = true;
  $('#planner-lede').textContent = 'Adults in the family change the goal and the plan.';
  $('#planner-lede').hidden = false;
}
function renderPlanForm() {
  const { goal, progress, modes, plan } = state;
  $('#planner-lede').textContent = '';
  $('#planner-lede').hidden = true;
  $('#plan-project-stage').textContent = projectLabel(currentProject());
  $('#visit-campsite').textContent = `Visit ${projectKind(goal.projectKind).label.toLowerCase()}`;
  $('#ask-planner').textContent = modes.ai.mode === 'live' ? 'Ask the AI planner' : 'Make an example plan';
  renderGoalDraft();
  if (!ui.planFormDirty) {
    ui.planGoalId = goal.id;
    ui.planGoalRevision = state.merchantGoalRevision;
    ui.planProjectKind = goal.projectKind;
    ui.planBaseline = planFieldValues(state); // what the form shows; a live update can move the state on past it
    $('#goal-project').value = goal.projectKind;
    $('#goal-name-input').value = goal.name;
    $('#goal-target').value = centsToInput(goal.targetCents);
    $('#goal-starting').value = centsToInput(progress.startingCents);
    $('#goal-date').value = goal.targetDate;
    $('#goal-weekly').value = centsToInput(goal.weeklyBudgetCents);
    if (plan?.inputs?.commitments) ui.commitments = plan.inputs.commitments.map((c) => ({ label: c.label, amount: centsToInput(c.amountCents), cadence: c.cadence }));
    renderCommitments();
  }
  planCheck ??= createPlanCheck({ getState: () => state, isBlocked: () => Boolean(ui.goalDraft), isStale: planFormStale, refreshGoal: refreshPlanGoal });
  planCheck.update();
  const result = $('#plan-result');
  if (!plan) { result.hidden = true; return; }
  result.hidden = false;
  const badge = $('#plan-source');
  badge.className = `source-badge ${plan.source}`;
  badge.textContent = plan.source === 'ai'
    ? 'AI plan'
    : plan.source === 'household-edited' ? 'Household plan' : 'Built-in plan';
  if (state.acceptedPlanId === plan.id) badge.append(' · in use');
  $('#plan-headline').textContent = plan.headline;
  $('#plan-summary').textContent = plan.summary;
  const review = state.planReview;
  const stale = Boolean(review?.factsChanged);
  const reviewStatus = $('#plan-review-status');
  reviewStatus.hidden = !stale;
  reviewStatus.textContent = !stale ? '' : review.needsRefresh
    ? 'Progress or goal details changed. Make a new plan before using these weeks.'
    : 'This plan stays in use. Make a new plan to change the remaining weeks.';
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
  $('#plan-schedule-help').hidden = stale;
  for (const input of $$('#plan-schedule .week-amount')) input.readOnly = stale;
  $('#save-edits').disabled = !ui.scheduleDirty || stale;
  const accepted = state.acceptedPlanId === plan.id;
  const accept = $('#accept-plan');
  accept.disabled = accepted || ui.scheduleDirty || Boolean(review?.needsRefresh);
  accept.textContent = accepted ? 'Plan in use ✓' : 'Use this plan';
}

const planFieldValues = (s) => ({ 'goal-name-input': s.goal.name, 'goal-target': centsToInput(s.goal.targetCents), 'goal-starting': centsToInput(s.progress.startingCents), 'goal-weekly': centsToInput(s.goal.weeklyBudgetCents), 'goal-date': s.goal.targetDate, 'goal-project': s.goal.projectKind });
// The Plan form's goal is older than the household's (another member saved a newer one while this form was being edited).
const planFormStale = () => Boolean(state && ui.planFormDirty && ui.planGoalRevision && ui.planGoalRevision !== state.merchantGoalRevision);
async function refreshPlanGoal() {
  // Fields still showing what the form was filled with are the family's untouched fields; any other value is an edit.
  const shown = ui.planBaseline ?? planFieldValues(state), fields = Object.keys(shown);
  const before = Object.fromEntries(fields.map(id => [id, $(`#${id}`).value]));
  const latest = await api.get('/api/state');
  // Keep current trial inputs and optional bill rows, including edits made while this local read was pending.
  // Refresh only goal facts the family has not meanwhile edited; a newly selected market draft keeps its own scope.
  ui.planFormDirty = true;
  applyState(latest);
  if (ui.goalDraft) return false;
  const values = planFieldValues(state); // the newest state shown: this answer, or a newer live one
  for (const id of fields) if (before[id] === shown[id] && $(`#${id}`).value === before[id]) $(`#${id}`).value = values[id];
  ui.planBaseline = values;
  ui.planGoalId = state.goal.id;
  ui.planGoalRevision = state.merchantGoalRevision;
  ui.planProjectKind = state.goal.projectKind; // a Build choice the family made still differs from it and is sent
  return true;
}

async function showPlanError(error) {
  if (['plan_stale', 'plan_facts_changed', 'plan_superseded'].includes(error.code)) {
    // Read current local records once; this never regenerates a plan or contacts a model/provider.
    try { applyState(await api.get('/api/state')); } catch { /* retain the original actionable error */ }
    setStatus('#plan-status', state.planReview?.factsChanged ? '' : 'error', state.planReview?.factsChanged ? '' : 'Goal or progress changed. Make a new plan using the latest figures.');
    $('#ask-planner').focus();
    return;
  }
  if (error.code === 'goal_changed' && !ui.goalDraft) {
    // Another member saved a newer goal. Nothing was overwritten; keep this family member's edits and offer the newer goal.
    setStatus('#plan-status', 'error', error.message, { action: h('button', { type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        if (await refreshPlanGoal()) setStatus('#plan-status', 'info', 'Latest goal loaded. Fields you changed are kept; review them, then save again.');
      } catch (err) { setStatus('#plan-status', 'error', err.message); }
    } }, 'Load latest goal') });
    return;
  }
  setStatus('#plan-status', 'error', error.message, { issues: error.code === 'invalid_edit' ? [] : error.issues });
}

// ---------- Market Town merchant draft: shown in the Plan form, saved only on "Save as our goal" ----------
const goalNameFor = (title) => {
  const words = title.replace(/…$/, '').split(' ');
  let name = '';
  for (const w of words) { if (`${name} ${w}`.trim().length > 60) break; name = `${name} ${w}`.trim(); }
  return name.length >= 2 ? name : title.slice(0, 60);
};
function renderGoalDraft() {
  const draft = ui.goalDraft, box = $('#goal-draft');
  box.hidden = !draft;
  $('#goal-draft-review').hidden = !draft?.needsReview;
  $('#goal-draft-search').hidden = !draft?.expired;
  $('#goal-draft-save').disabled = ui.goalDraftBusy || Boolean(draft?.needsReview || draft?.expired);
  $('#goal-draft-review').disabled = ui.goalDraftBusy;
  $('#goal-draft-discard').disabled = ui.goalDraftBusy;
  $('#ask-planner').disabled = Boolean(draft); // one explicit decision at a time: save or discard the draft first
  planCheck?.update(); // programmatic market selections must clear calculations for the previous goal immediately
  const item = state.goalItem;
  const line = $('#goal-item');
  line.hidden = Boolean(draft) || !item;
  if (item && !draft) {
    line.replaceChildren(`${item.title} · ${formatCents(item.priceCents, item.currency)} saved price. `,
      h('button', { type: 'button', class: 'link-button', onclick: (e) => merchant.openSaved(e.currentTarget) }, 'Check item'));
  }
  if (!draft) return;
  const image = $('#goal-draft-image');
  image.hidden = !draft.image;
  if (draft.image && image.getAttribute('src') !== draft.image.url) image.setAttribute('src', draft.image.url);
  $('#goal-draft-name').textContent = draft.title;
  $('#goal-draft-facts').textContent = ` ${resultFacts(draft).join(' · ')} · Channel3, checked ${timeLabel(draft.checkedAt)}`;
  const { goal, progress } = state;
  const effects = [`Not saved yet. Saving replaces “${goal.name}” (${money(goal.targetCents)}) with the name and amount below`];
  if (progress.progressCents > 0) effects.push(`; the ${money(progress.progressCents)} already tracked stays and counts toward the new amount`);
  if (state.plan) effects.push('; the current plan is set aside, so make a new one afterwards');
  effects.push('. The price excludes tax and shipping; nothing is bought.');
  $('#goal-draft-effect').textContent = effects.join('');
}
function useMerchantItem(item) {
  // Bind to the Plan fields the family actually saw. A search may start after another tab changed the goal;
  // its newer revision must not give these older starting/date/budget fields permission to replace that edit.
  ui.goalDraft = { ...item, goalId: ui.planGoalId, goalRevision: ui.planGoalRevision };
  ui.planFormDirty = true;
  $('#goal-name-input').value = goalNameFor(item.title);
  $('#goal-target').value = centsToInput(item.priceCents);
  for (const field of ['#goal-name-input', '#goal-target']) $(field).removeAttribute('aria-invalid');
  setStatus('#plan-status', '', '');
  selectTab('plan', { focus: false });
  renderGoalDraft();
  $('#goal-draft-title').focus();
}
function discardGoalDraft() {
  ui.goalDraft = null;
  ui.planFormDirty = false;
  renderPlan();
  setStatus('#plan-status', 'info', 'Draft discarded. The goal is unchanged.');
  $('#goal-name-input').focus();
}
async function saveGoalDraft() {
  const draft = ui.goalDraft;
  if (!draft || ui.goalDraftBusy || draft.needsReview || draft.expired) return;
  const { goal, errors } = readGoalFields();
  if (errors.length) { setStatus('#plan-status', 'error', 'Please fix these first:', { issues: errors }); return; }
  ui.goalDraftBusy = true;
  renderGoalDraft();
  setStatus('#plan-status', 'working', 'Saving the goal…');
  try {
    const res = await api.post('/api/merchant/goal', { draftId: draft.draftId, goalId: draft.goalId, expectedGoalRevision: draft.goalRevision, goal });
    if (ui.goalDraft !== draft) { applyState(res.state); return; }
    ui.goalDraft = null;
    ui.planFormDirty = false;
    applyState(res.state);
    setStatus('#plan-status', 'ok', `Goal saved: ${res.state.goal.name}, ${money(res.state.goal.targetCents)}. Make a plan when you are ready.`);
    $('#goal-name-input').focus();
  } catch (error) {
    if (ui.goalDraft !== draft) return;
    setStatus('#plan-status', 'error', error.message); // a refused save changes nothing; the draft stays for review
    if (error.code === 'merchant_draft_expired') draft.expired = true;
    if (error.code === 'goal_changed') draft.needsReview = true;
  } finally {
    ui.goalDraftBusy = false;
    renderGoalDraft();
  }
}

async function reviewGoalDraft() {
  const draft = ui.goalDraft;
  if (!draft || ui.goalDraftBusy) return;
  // Keep the selected item and its edited name/target; reload the household's latest starting amount, date and budget.
  const name = $('#goal-name-input').value, target = $('#goal-target').value;
  ui.goalDraftBusy = true; renderGoalDraft();
  try {
    const current = await api.get('/api/state');
    if (ui.goalDraft !== draft) return;
    ui.planFormDirty = false;
    applyState(current);
    ui.goalDraft = { ...draft, goalId: current.goal.id, goalRevision: current.merchantGoalRevision, needsReview: false };
    ui.planFormDirty = true;
    $('#goal-name-input').value = name; $('#goal-target').value = target;
    setStatus('#plan-status', 'info', 'Latest household goal loaded. Review the fields, then save when ready.');
    $('#goal-name-input').focus();
  } catch (error) {
    if (ui.goalDraft === draft) setStatus('#plan-status', 'error', error.message);
  } finally { ui.goalDraftBusy = false; renderGoalDraft(); }
}

function renderCommitments() {
  $('#commitment-rows').replaceChildren(...ui.commitments.map((c, i) => h('div', { class: 'commitment' },
    h('label', { class: 'field commitment-label' }, h('span', {}, 'Bill'), h('input', { value: c.label, maxlength: 40, 'data-i': i, 'data-k': 'label', 'aria-label': `Bill ${i + 1} name` })),
    h('label', { class: 'field' }, h('span', {}, 'Amount'), h('span', { class: 'money' }, h('input', { value: c.amount, inputmode: 'decimal', 'data-i': i, 'data-k': 'amount', 'aria-label': `Bill ${i + 1} amount` }))),
    h('label', { class: 'field' }, h('span', {}, 'Every'), h('select', { 'data-i': i, 'data-k': 'cadence', 'aria-label': `Bill ${i + 1} frequency` },
      h('option', { value: 'monthly', selected: c.cadence === 'monthly' }, 'month'), h('option', { value: 'weekly', selected: c.cadence === 'weekly' }, 'week'))),
    h('button', { type: 'button', 'data-remove': i, 'aria-label': `Remove bill ${i + 1}` }, 'Remove'))));
}

function readGoalFields() {
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
  // The Build choice travels only when the family changed it, so an untouched form never reverts a newer saved choice.
  const project = $('#goal-project').value;
  if (project && project !== ui.planProjectKind) goal.projectKind = project;
  return { goal, errors };
}

function readPlanForm() {
  const { goal, errors } = readGoalFields();
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
  if (ui.goalDraft) { setStatus('#plan-status', 'error', 'Save or discard the market draft first.'); return; }
  const { goal, commitments, errors } = readPlanForm();
  if (errors.length) { setStatus('#plan-status', 'error', 'Please fix these first:', { issues: errors }); return; }
  const button = $('#ask-planner');
  button.disabled = true;
  setStatus('#plan-status', 'working', state.modes.ai.mode === 'live' ? 'The AI planner is writing your plan. This can take up to a minute…' : 'Working out the example plan…');
  try {
    const res = await api.post('/api/plans', { goal, commitments, expectedGoalRevision: ui.planGoalRevision });
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
    await showPlanError(error);
  } finally {
    button.disabled = Boolean(ui.goalDraft);
  }
}

async function useRulesPlan(goal, commitments) {
  try {
    const res = await api.post('/api/plans/rules', { goal, commitments, afterAiFailure: true, expectedGoalRevision: ui.planGoalRevision });
    applyState(res.state);
    setStatus('#plan-status', 'info', 'Showing the example rules plan, clearly labeled. It was not written by AI.');
  } catch (error) {
    await showPlanError(error);
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
    await showPlanError(error);
  }
}

async function acceptPlan() {
  try {
    const res = await api.post(`/api/plans/${state.plan.id}/accept`);
    applyState(res.state);
    setStatus('#plan-status', 'ok', 'Plan in use. Each contribution still needs an adult’s approval.');
    selectTab('give');
  } catch (error) {
    await showPlanError(error);
  }
}

// ---------- 3. Contribute ----------
function suggestedContribution() {
  const { board, nextStep, progress, contributionLimits: lim } = state;
  return [board.nextMilestone?.awayCents, nextStep?.dueCents, progress.remainingCents]
    .filter((c) => Number.isInteger(c) && c >= lim.minCents && c <= lim.maxCents && c <= progress.remainingCents)
    .sort((a, b) => a - b)[0] ?? null;
}

function amountCheck() {
  const cents = parseAmountToCents($('#give-amount').value);
  const { contributionLimits: lim, progress } = state;
  if (cents === null) return { cents: null, error: 'Enter an amount like 15.00.' };
  if (cents < lim.minCents || cents > lim.maxCents) return { cents, error: `Contributions are ${money(lim.minCents)}–${money(lim.maxCents)}.` };
  if (cents > progress.remainingCents) return { cents, error: `Only ${money(progress.remainingCents)} is still needed for this goal.` };
  return { cents, error: null };
}

function renderGive() {
  const { household, goal, progress } = state;
  const setup = household.setupComplete;
  const done = progress.remainingCents <= 0;
  $('#give-context').textContent = !setup ? 'Create your house to contribute.' : done ? 'Goal complete.' : '';
  $('#give-context').hidden = !$('#give-context').textContent;
  const suggested = setup && !done ? suggestedContribution() : null;
  const amountInput = $('#give-amount');
  if (!ui.amountTouched && document.activeElement !== amountInput) amountInput.value = suggested !== null ? centsToInput(suggested) : '';
  const check = amountCheck();
  const error = amountInput.value ? check.error : null;
  $('#give-amount-help').textContent = error ?? '';
  $('#give-amount-help').hidden = !error;
  amountInput.setAttribute('aria-invalid', String(Boolean(error)));

  const who = persona();
  const approve = $('#give-approve');
  const row = $('#give-approve-row');
  const amountText = check.cents !== null && !check.error ? money(check.cents) : 'this';
  // An approval covers one amount, for one goal, by one adult, in one session. If any of them changed since the box was
  // ticked (another member saved a new goal, say), the tick is cleared and asked for again.
  if (approve.checked && ui.approvalBasis !== approvalBasis()) {
    approve.checked = false;
    ui.approvalBasis = null;
    setStatus('#give-status', 'info', 'Approval cleared because the goal or sign-in changed. Check the amount, then approve again.');
  }
  if (!who || who.role !== 'adult') {
    approve.checked = false;
    approve.disabled = true;
    row.classList.add('blocked');
    $('#give-approve-text').textContent = state.access ? 'An adult in the family approves contributions.' : 'Switch to an adult to contribute.';
  } else {
    approve.disabled = !setup || done || Boolean(check.error);
    row.classList.remove('blocked');
    $('#give-approve-text').textContent = check.error ? 'Approve this payment.' : `I approve ${amountText} ${goal.currency} (${isSandbox() ? 'test money' : 'simulated'}).`;
  }
  const ready = setup && !done && approve.checked && !check.error && who?.role === 'adult';
  renderGiveAction(ready);
  renderReceipt();
}

function renderGiveAction(ready) {
  const box = $('#give-action');
  if (isSandbox()) {
    paypal?.setEnabled(ready);
    // Planning and exploring the world do not need PayPal's SDK or eligibility service. A failed initialization waits
    // for an explicit retry here; editing an amount/approval must never restart a provider load behind the family.
    if (ui.tab !== 'give' || !state.household.setupComplete || persona()?.role !== 'adult' || paypalLoadFailed) return;
    if (!paypalMount && !box.querySelector('paypal-button')) {
      box.replaceChildren(h('p', { class: 'fine' }, 'Loading PayPal sandbox checkout…'));
      paypalMount = mountPayPalButton(box, {
        getOrderInput: () => orderInput(),
        getOwnership: ownership,
        onStatus: ({ kind, message, debugId }) => setStatus('#give-status', kind, message, { debugId }),
        onResult: (res) => handleContributionResult(res),
      }).then((control) => { paypal = control; paypal.setEnabled(readyToPay()); })
        .catch((error) => {
          paypalLoadFailed = true;
          box.replaceChildren(h('button', { type: 'button', id: 'retry-checkout', onclick: () => {
            paypalLoadFailed = false;
            setStatus('#give-status', '', '');
            renderGive();
          } }, 'Retry checkout'));
          setStatus('#give-status', 'error', `Checkout unavailable: ${error.message}`);
          paypalMount = null;
        });
    }
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

function approvalBasis() {
  const { household, goal, modes } = state;
  return JSON.stringify([household.id, goal.id, goal.name, goal.targetCents, goal.currency, modes.payments.mode, persona()?.id ?? null, amountCheck().cents, family.epoch]);
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
  canceled: ['info', 'Checkout window closed. Check the contribution record before trying again.'],
  record_unchanged: ['info', 'The payment record is unchanged. Review its status in the Ledger.'],
  declined: ['error', 'Declined. No progress was recorded.'],
  not_approved: ['error', 'PayPal has not recorded an approval yet. No progress was recorded.'],
  not_captured: ['info', 'Approved but not captured yet. No progress was recorded.'],
  rejected_mismatch: ['error', 'The payment did not match what this server expected, so it was not counted.'],
  not_credited: ['error', 'PayPal reported an unexpected status. No progress was recorded.'],
  unknown: ['info', 'PayPal did not confirm this payment in time, so its outcome is not known yet. Nothing was credited; check it from its Ledger receipt.'],
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
  if (res.contribution) {
    ui.ledgerRecord = ledgerRows().find((r) => r.contribution?.id === res.contribution.id)?.id ?? ui.ledgerRecord;
    renderLedgerRecord(); ledgerGrid?.selectRecord(ui.ledgerRecord);
  }
  if (ui.receipt && ['completed', 'pending'].includes(res.outcome)) $('#receipt').focus({ preventScroll: false });
  renderNextStep();
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
      h('dt', {}, 'Approved by'), h('dd', {}, approver ? `${approver.name} (adult${state.access ? '' : ', example persona'})` : c.approvedBy),
      h('dt', {}, c.simulated ? 'Simulated order' : 'PayPal order'), h('dd', {}, c.providerOrderId ?? '—'),
      h('dt', {}, c.simulated ? 'Simulated capture' : 'PayPal capture'), h('dd', {}, capture?.captureId ?? 'none yet'),
      h('dt', {}, 'Recorded'), h('dd', {}, timeLabel(c.updatedAt)),
      ...(completed && r.outcome === 'completed' ? [h('dt', {}, 'Goal progress'), h('dd', {}, `${money(r.before)} → ${money(r.after)} (${formatPercent(r.after, state.goal.targetCents)})`)] : []),
      ...(r.awarded.filter((a) => typeof a === 'number').length ? [h('dt', {}, 'Milestone'), h('dd', {}, r.awarded.filter((a) => typeof a === 'number').map((t) => `${TIERS[t].name} raised`).join(', '))] : []),
    ),
    // replaceChildren would print a null as the text "null", so the optional action is spread in only when present.
    ...(!c.simulated && c.providerOrderId && state.steward.paypalTools && mayAskSteward()
      ? [h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => askSteward(`Did PayPal confirm the ${money(c.amountCents)} contribution?`, c.providerOrderId) }, 'Ask the steward to verify with PayPal'))]
      : []),
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
  creating: 'Creating', created: 'Awaiting approval', approval_canceled: 'Checkout closed', pending: 'Pending — not counted yet',
  completed: 'Completed — counted', declined: 'Declined — not counted', failed: 'Failed — not counted', rejected: 'Rejected (mismatch) — not counted',
  refunded: 'Refunded — progress reversed', partially_refunded: 'Partly refunded',
};
const KIND_LABEL = {
  starting_progress: 'Starting progress', contribution: 'Contribution', refund: 'Refund', simulated_contribution: 'Contribution', simulated_refund: 'Refund',
};

function ledgerRows() {
  return ledgerTrail(state).map((row) => {
    const e = row.entry, c = row.contribution, category = row.category;
    const signed = e ? e.effect * e.amountCents : 0;
    const source = e?.source ?? (c?.simulated ? 'simulated' : 'paypal');
    const sourceText = source === 'user-reported' ? 'You reported' : source === 'simulated' ? 'Simulated' : 'PayPal sandbox';
    const entry = e?.label || KIND_LABEL[e?.kind] || STATUS_LABEL[c?.status] || 'Contribution';
    const whenIso = e?.createdAt ?? c.createdAt;
    const amount = e?.amountCents ?? c.amountCents;
    const record = c ? (signed < 0 ? 'Refund' : 'Contribution') : category === 'goal' ? 'Goal progress' : category === 'bill' ? 'Bill paid (habit)' : 'Gift sent';
    // A PayPal record's source line carries its compact saved-check status, so the grid shows it without another column.
    const check = c ? checkStatus(c) : null;
    return { ...row, recordEntry: e, whenIso, when: timeLabel(whenIso), record, entry, source: check?.short ? `${sourceText} · ${check.short}` : sourceText, check,
      signedCents: category === 'goal' ? signed : amount,
      amountText: category === 'goal' && e ? `${signed < 0 ? '−' : '+'}${money(amount)}` : money(amount),
      counts: category !== 'goal' ? 'No — not savings' : !e ? 'No — not counted' : signed < 0 ? 'Yes (subtracts)' : 'Yes',
      searchText: [record, entry, sourceText, check?.label, check?.short, timeLabel(whenIso), money(amount), c?.providerOrderId, ...(c?.captures.map((cap) => cap.captureId) ?? [])].filter(Boolean).join(' '),
    };
  });
}
function ensureLedgerSelection(rows) {
  if (!rows.some((r) => r.id === ui.ledgerRecord))
    ui.ledgerRecord = (rows.find((r) => r.contribution?.id === state.contributions[0]?.id) ?? rows.at(-1))?.id ?? null;
}

// Returns (and keeps in ui.ledgerLayout) the grid's load-and-fill work, so a Ledger destination can wait for it.
function renderLedgerGrid() {
  if (ui.tab !== 'ledger') return ui.ledgerLayout;
  const rows = ledgerRows(); ensureLedgerSelection(rows);
  if (!ledgerGrid) ledgerGrid = createLedgerGrid($('#ledger-goal'), { formatMoney: money, onSelect: (row) => {
    // Programmatic selection already rendered the receipt. AG Grid may report it asynchronously; rebuilding the
    // same receipt then would remove its focused element after an "Open receipt" link moved keyboard focus there.
    if (ui.ledgerRecord === row.id) return;
    ui.ledgerRecord = row.id; ui.refundArm = null; renderLedgerRecord();
    if (ui.stewardFocus && row.contribution?.providerOrderId !== ui.stewardFocus) $('#steward-answer').hidden = true;
  } });
  ui.ledgerLayout = ledgerGrid.update(rows, state.progress.progressCents).then(() => {
    ledgerGrid.setFilter(ui.ledgerFilter); ledgerGrid.setSearch(ui.ledgerSearch); ledgerGrid.selectRecord(ui.ledgerRecord);
  }).catch(() => {});
  return ui.ledgerLayout;
}

function renderLedger() {
  const { contributions, achievements, modes } = state;
  renderTreasury();
  renderLedgerGrid();
  renderSteward();

  ensureLedgerSelection(ledgerRows());
  renderLedgerRecord();

  $('#achievements').replaceChildren(...(achievements.length ? achievements.map((a) => h('li', {}, h('strong', {}, a.label), h('span', {}, a.detail), h('small', {}, timeLabel(a.earnedAt))))
    : [h('li', { class: 'empty' }, 'Keepsakes appear as the house reaches milestones.')]));
  if (state.board.builtTierCommemorative) {
    $('#achievements').append(h('li', {}, h('strong', {}, 'About keepsakes'), h('span', {}, 'Raised buildings stay as keepsakes after a refund. Current progress and the travelers always show the true amount.')));
  }
  $('#reset-row').hidden = modes.payments.mode !== 'example';
}

// Move the camera to a district and keep keyboard focus on its map control. Never writes.
function visitDistrict(id, e) {
  setJournalOpen(false); scene?.focusDistrict(id); $('.realm-map').dataset.focused = 'true';
  const marker = $(`#realm-markers [data-district="${CSS.escape(id)}"]`);
  marker?.focus({ preventScroll: true }); revealRealm(marker, { instant: e?.detail === 0 });
}
// The same journey as "Visit <district>", to the family project (campsite, garden or schoolhouse): close the journal,
// focus the meadow, land on its marker.
function visitCampsite(e) {
  setJournalOpen(false); scene?.focusLegend(FAMILY_PROJECT_SITE.id); $('.realm-map').dataset.focused = 'true';
  const marker = $('#project-marker');
  marker?.focus({ preventScroll: true }); revealRealm(marker, { instant: e?.detail === 0 });
}
function recordImpact(row) {
  if (row.afterCents === null) return null;
  const open = new Set(state.rewards.realm.districts.filter((d) => d.open).map((d) => d.id));
  return h('div', { class: 'ledger-impact', title: 'After this record in the current ledger' },
    h('span', {}, `After record: ${money(row.afterCents)} tracked`),
    ...row.districts.filter((id) => open.has(id)).map((id) => h('button', { type: 'button', class: 'link-button', 'data-record-district': id, onclick: (e) => visitDistrict(id, e) }, `Visit ${districtById(id).name}`)));
}
// The Treasury's one next-area milestone (AG Studio custom widget, server data). Built when the Ledger is first shown.
function renderTreasury() {
  if (ui.tab !== 'ledger') return;
  treasury ??= createTreasury($('#treasury-next'), { formatMoney: money, onVisit: visitDistrict,
    onRecord: (id) => {
      ui.ledgerRecord = id; ui.refundArm = null;
      ledgerGrid?.selectRecord(id); renderLedgerRecord();
      revealInLedger(() => $('#ledger-contributions li'), true);
    },
    requestSteward: (payload, options) => api.post('/api/steward', payload, options),
    getStewardScope: () => JSON.stringify([state.household.id, state.household.name, state.goal, state.progress, state.plan?.id, state.acceptedPlanId,
      state.contributions.map((c) => [c.id, c.status, c.updatedAt]), persona()?.id, ui.ledgerRecord, family.epoch]),
    getLicence: () => api.get('/api/treasury/studio').then((r) => r.licenseKey ?? null) });
  treasury.update(state);
}
function renderLedgerRecord() {
  if (treasury?.refreshScope()) {
    $('#steward-answer').hidden = true;
    if (!ui.stewardBusy) setStatus('#steward-status', '', '');
  }
  const row = ledgerRows().find((r) => r.id === ui.ledgerRecord), c = row?.contribution;
  const list = $('#ledger-contributions');
  $('#ledger-contrib-title').textContent = row?.record ?? 'Selected record';
  if (!row) { list.replaceChildren(h('li', { class: 'empty' }, 'No records yet.')); return; }
  if (!c) {
    list.replaceChildren(h('li', { tabindex: -1, 'data-ledger-record': row.id },
      h('div', { class: 'row' }, h('strong', {}, row.record), h('span', { class: 'amount' }, row.amountText)),
      h('p', { class: 'fine' }, `${row.source} · ${row.when}`), recordImpact(row)));
    return;
  }
  const adult = persona()?.role === 'adult';
  const card = (() => {
    const capture = c.captures.find((x) => x.credited);
    const refundable = capture && capture.amountCents - capture.refundedCents > 0;
    const refundId = row.recordEntry?.effect < 0 ? row.recordEntry.sourceRef?.split(':').at(-1) : null;
    const actions = [];
    if (c.status === 'pending' && c.simulated) actions.push(h('button', { type: 'button', onclick: () => completePending(c.id) }, 'Simulate PayPal completing it'));
    // The existing explicit check. It runs only from this button: never on open, search, reload or a local question.
    const check = checkStatus(c);
    const checkButton = !c.simulated && c.providerOrderId && (check.needsCheck || ['pending', 'completed', 'partially_refunded'].includes(c.status))
      ? h('button', { type: 'button', onclick: () => refreshOrder(c.providerOrderId) }, 'Check with PayPal') : null;
    if (checkButton && !check.needsCheck) actions.push(checkButton);
    if (!c.simulated && c.providerOrderId && state.steward.paypalTools && mayAskSteward()) {
      actions.push(h('button', { type: 'button', onclick: () => askSteward(`Did PayPal confirm the ${money(c.amountCents)} contribution?`, c.providerOrderId) }, 'Ask the steward to verify'));
    }
    if (refundable && adult) {
      const left = capture.amountCents - capture.refundedCents;
      actions.push(ui.refundArm === capture.captureId
        ? h('button', { type: 'button', class: 'danger', onclick: () => refund(capture.captureId, c.simulated) }, `Confirm refund of ${money(left)}`)
        : h('button', { type: 'button', onclick: () => { ui.refundArm = capture.captureId; renderLedger(); } }, c.simulated ? 'Simulate refund' : 'Refund in sandbox'));
    }
    return h('li', { 'data-contribution': c.id, tabindex: -1 },
      h('div', { class: 'row' }, h('span', { class: 'amount' }, row.recordEntry?.effect < 0 ? row.amountText : money(c.amountCents)), h('span', {}, STATUS_LABEL[c.status] ?? c.status,
        h('span', { class: `tag ${c.simulated ? 'simulated' : 'sandbox'}` }, c.simulated ? 'simulated' : 'PayPal sandbox'))),
      // The server's record of the last explicit "Check with PayPal": its own reconciliation of PayPal's order, kept across reloads.
      // A record that needs a check carries that action right here; a completed capture with no check says so.
      check.key !== 'none' ? h('p', { class: 'fine last-check', 'data-check': check.key },
        h('span', { class: `verdict ${check.tone}` }, check.label),
        c.lastCheck ? h('span', {}, timeLabel(c.lastCheck.checkedAt)) : null,
        c.lastCheck ? h('span', { class: 'check-note' }, c.lastCheck.note) : null,
        check.needsCheck ? checkButton : null) : null,
      recordImpact(row),
      h('details', { class: 'record-ids' }, h('summary', {}, 'Payment details'),
        h('div', { class: 'ids' }, `${timeLabel(c.createdAt)} · order ${c.providerOrderId ?? '—'}${capture ? ` · capture ${capture.captureId}` : ''}${refundId ? ` · refund ${refundId}` : ''}`),
        c.checks?.length > 1 ? h('ul', { class: 'ids check-history', 'aria-label': 'Earlier checks with PayPal' },
          ...c.checks.slice(1).map((k) => h('li', {}, `${timeLabel(k.checkedAt)} · ${k.note}`))) : null),
      c.statusDetail && !['completed'].includes(c.status) ? h('div', { class: 'ids' }, c.statusDetail) : null,
      actions.length ? h('div', { class: 'actions' }, actions) : null);

  })();
  list.replaceChildren(card);
}

// ---------- House steward (AI, read-only) ----------
const STEWARD_SUGGESTIONS = ['Did PayPal confirm our last contribution?', 'How close are we to the next milestone?', 'Is anything still pending?'];

// In a shared family only adults ask the steward (the server refuses anyone else before any model or PayPal call).
const mayAskSteward = () => !state.access || state.access.me.role === 'adult';
function renderSteward() {
  const steward = mayAskSteward() ? state.steward : { ...state.steward, available: false, localHistory: false, paypalTools: false };
  $('#steward-note').textContent = !mayAskSteward() ? 'An adult in the family can ask the steward.' : !steward.available ? (steward.localHistory ? 'Saved confirmations' : 'Steward unavailable.') : steward.paypalTools ? 'Reads PayPal and household records. Cannot make payments.' : 'Reads household records. Cannot make payments.';
  const suggestions = $('#steward-suggestions');
  if (!suggestions.childElementCount) {
    suggestions.append(h('button', { type: 'button', 'data-question': STEWARD_SUGGESTIONS[0], 'aria-label': STEWARD_SUGGESTIONS[0] }, h('span', {}, 'Check last payment')));
    suggestions.append(h('button', { type: 'button', 'data-question': CONFIRMATION_HISTORY_QUESTION }, 'Last confirmation'));
    suggestions.append(h('button', { type: 'button', 'data-question': NEEDS_CHECK_QUESTION }, 'Needs a check?'));
  }
  const disabled = !steward.available || ui.stewardBusy;
  for (const el of [$('#steward-form input'), $('#steward-ask')]) el.disabled = disabled;
  $('#steward-form').hidden = !steward.available;
  for (const button of $$('#steward-suggestions button')) {
    const local = isLocalQuestion(button.dataset.question);
    button.hidden = local ? !steward.localHistory : !steward.available;
    button.disabled = ui.stewardBusy || !(local ? steward.localHistory : steward.available);
  }
}

async function askSteward(question, focusOrderId = null) {
  const local = state.steward.localHistory && isLocalQuestion(question);
  if ((!state.steward.available && !local) || ui.stewardBusy || !mayAskSteward()) return;
  if (focusOrderId) ui.ledgerRecord = ledgerRows().find((r) => r.contribution?.providerOrderId === focusOrderId)?.id ?? ui.ledgerRecord;
  if (ui.tab !== 'ledger') selectTab('ledger', { focus: false });
  $('#steward-block').open = true; // the steward is disclosed on request; a verification asked from a receipt opens it
  $('#steward-form').elements.question.value = question;
  ui.stewardFocus = focusOrderId;
  ui.stewardBusy = true;
  renderSteward();
  setStatus('#steward-status', 'working', local ? 'Reading saved records…' : state.steward.paypalTools ? 'The steward is reading the ledger and checking with PayPal…' : 'The steward is reading the ledger…');
  $('#steward-answer').hidden = true;
  try {
    const res = await treasury.askSteward({ question, memberId: persona()?.id, focusOrderId });
    if (res.status !== 'ok') { setStatus('#steward-status', 'error', `The steward could not answer: ${res.error.message}`); return; }
    if (focusOrderId && ledgerRows().find((r) => r.id === ui.ledgerRecord)?.contribution?.providerOrderId !== focusOrderId) {
      setStatus('#steward-status', 'info', 'The payment selection changed. Verify the selected record.'); return;
    }
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
  const box = $('#steward-answer'), focus = ui.stewardFocus;
  const proof = res.checks.find((c) => c.tool === 'get_order' && (!focus || c.orderId === focus) && c.reconciliation);
  const matched = proof?.reconciliation?.verdict === 'match' && (!focus || res.verification?.status === 'verified');
  const local = res.source === 'local-records';
  box.hidden = false;
  box.replaceChildren(
    h('strong', { class: `verification-title ${matched ? 'verified' : ''}` },
      local ? (res.kind === 'needs-check' ? 'PayPal checks' : 'Saved confirmation') : matched ? 'PayPal and ledger match' : focus ? 'Payment not yet verified' : 'House steward'),
    h('p', { class: 'steward-text' }, res.answer),
    // Receipts the local answer names: opening one only selects that record. The check itself stays a separate button.
    res.receipts?.length ? h('div', { class: 'actions receipt-links' }, ...res.receipts.map((r) =>
      h('button', { type: 'button', class: 'link-button', 'data-open-receipt': r.contributionId, onclick: () => openReceipt(r.contributionId) }, `Open receipt · ${r.amount} · ${r.status}`))) : null,
    ...(res.warnings.length ? [h('div', { class: 'callout warn' }, res.warnings.join(' '))] : []),
    h('details', { class: 'verification-details' }, h('summary', {}, 'What was checked'),
      h('small', {}, local ? 'Saved household record · read-only' : `${res.model} · read-only${res.paypalTools ? ' · PayPal Agent Toolkit' : ''}`),
      h('ul', { class: 'checks' }, ...(res.checks.length ? res.checks.map((c) => h('li', {},
        h('span', { class: `tag ${c.source.startsWith('PayPal') ? 'sandbox' : 'reported'}` }, c.source), ' ', c.summary,
        c.reconciliation ? h('span', { class: `verdict ${VERDICT_CLASS[c.reconciliation.verdict] ?? 'warn'}` }, c.reconciliation.note) : null,
        c.reconciliation?.verdict === 'action' ? h('button', { type: 'button', onclick: () => refreshOrder(c.orderId) }, 'Check with PayPal') : null))
        : [h('li', {}, 'Nothing was checked.')]))),
  );
}

/** Select one contribution's receipt in the ledger and move focus to it. It reads nothing from the server. */
function openReceipt(contributionId) {
  const rows = ledgerRows();
  const row = rows.find((r) => r.contribution?.id === contributionId && !(r.recordEntry?.effect < 0)) ?? rows.find((r) => r.contribution?.id === contributionId);
  if (!row) return;
  ui.ledgerRecord = row.id; ui.refundArm = null;
  ledgerGrid?.selectRecord(row.id);
  renderLedgerRecord();
  $('#ledger-contributions li')?.focus();
}

async function completePending(id) {
  try { handleContributionResult(await api.post(`/api/example/contributions/${id}/complete`, { householdId: state.household.id })); } catch (error) { setStatus('#ledger-status', 'error', error.message); }
}
async function refreshOrder(orderId) {
  try { handleContributionResult(await api.post(`/api/paypal/orders/${encodeURIComponent(orderId)}/refresh`, ownership())); }
  catch (error) {
    // PayPal failures are also saved checks. Read the local record so an older successful line cannot look current;
    // this GET never asks PayPal again. Keep the original error even if the local state cannot be read.
    if (error.code === 'paypal_error') {
      try { applyState(await api.get('/api/state'), { animate: false }); } catch {}
    }
    setStatus('#ledger-status', 'error', error.message, { debugId: error.debugId });
  }
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
const TABS = ['house', 'plan', 'give', 'ledger'];
function setJournalOpen(open, { focus = false, remember = true } = {}) {
  $('#journey').hidden = !open;
  $('.layout').dataset.journal = open ? 'open' : 'closed';
  $('#journal-toggle').setAttribute('aria-expanded', String(open));
  if (remember) pref.set('journal', open ? 'open' : 'closed');
  if (focus) (open ? $(`#tab-${ui.tab}`) : $('#journal-toggle')).focus();
}

function selectTab(name, { focus = true, remember = true, open = true } = {}) {
  if (open) setJournalOpen(true);
  ui.tab = name;
  ui.navigation++; // a pending Ledger reveal stands down once the family navigates again
  if (remember) sessionTab.set(name);
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`);
    const selected = tab === name;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
  }
  if (name === 'ledger' && state) { renderTreasury(); renderLedgerGrid(); renderLedgerRecord(); }
  if (name === 'give' && state) renderGive();
  if (state) renderNextStep();
  if (focus) $(`#tab-${name}`).focus();
}
function renderTabs() {
  $('#tab-house').classList.toggle('done', state.household.setupComplete);
  $('#tab-plan').classList.toggle('done', Boolean(state.plan && state.plan.id === state.acceptedPlanId));
  $('#tab-give').classList.toggle('done', state.contributions.some(isCounted));
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`), next = ui.next?.step === tab;
    button.classList.toggle('next', next);
  }
}
function renderFooter() {
  const { modes } = state;
  const sandbox = modes.payments.mode === 'sandbox';
  // A shared family signs in with passkeys; the example household's members are demo profiles.
  const mode = sandbox ? 'PayPal sandbox · test money only.' : state.access ? 'Simulated payments.' : 'Demo mode · simulated payments.';
  const people = state.access ? 'Each member signs in with their own passkey.' : 'Demo profiles, not sign-in.';
  $('#honesty').textContent = `${mode} ${people} Reported savings and bills are unverified; progress is not a bank balance.`;
}

function bindEvents() {
  $('#journal-toggle').addEventListener('click', () => setJournalOpen($('#journey').hidden, { focus: true }));
  $('#close-journal').addEventListener('click', () => setJournalOpen(false, { focus: true }));
  $('#journey').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setJournalOpen(false, { focus: true }); } });
  $('.skip-link').addEventListener('click', (e) => { e.preventDefault(); setJournalOpen(true); $('#journey').focus(); });
  const menus = $$('.hud-menu');
  for (const menu of menus) {
    menu.addEventListener('toggle', () => { if (menu.open) for (const other of menus) if (other !== menu) other.open = false; });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); menu.open = false; menu.querySelector('summary').focus(); } });
  }
  document.addEventListener('click', (e) => { for (const menu of menus) if (menu.open && !e.composedPath().includes(menu)) menu.open = false; });
  // Selecting a district keeps focus on the button that was used. The focused map is taller on phones, so set that
  // layout before measuring, then reveal the realm without scrolling the button out of view.
  for(const root of [$('#realm-districts'),$('#realm-markers')])root.addEventListener('click',e=>{const button=e.target.closest('[data-district]');if(button&&scene){scene.focusDistrict(button.dataset.district);$('.realm-map').dataset.focused='true';let keep=button;if(root.id==='realm-districts'){$('#district-menu').open=false;keep=$('#district-menu summary');keep.focus();}revealRealm(keep,{instant:e.detail===0});}});
  $('#realm-markers').addEventListener('click',e=>{const button=e.target.closest('[data-legend]');if(!button||!scene)return;scene.focusLegend(button.dataset.legend);revealRealm(button,{instant:e.detail===0});});
  $('#view-deed').addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.district;
    if (id) openDeedFromMap(id, e.currentTarget);
  });
  merchant = createMerchantDialog({ getState: () => state, onUse: useMerchantItem });
  for (const opener of [$('#open-merchant'), $('#find-goal-item')]) opener.addEventListener('click', (e) => merchant.open(e.currentTarget));
  $('#visit-campsite').addEventListener('click', visitCampsite);
  $('#goal-draft-save').addEventListener('click', saveGoalDraft);
  $('#goal-draft-review').addEventListener('click', reviewGoalDraft);
  $('#goal-draft-search').addEventListener('click', () => {
    if (ui.goalDraft) merchant.open($('#goal-draft-search'), { query: ui.goalDraft.searchQuery ?? ui.goalDraft.title, budgetCents: ui.goalDraft.searchBudgetCents });
  });
  $('#goal-draft-discard').addEventListener('click', discardGoalDraft);
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
  bus.on('scene:hop', (detail) => sound.cue('hop', detail));
  bus.on('scene:bridge:open', (detail) => sound.cue('bridge', detail));
  bus.on('scene:rise', (detail) => sound.cue('fanfare', detail));
  $('#pixel-toggle').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'Pixel art' : 'Raw 3D';
    scene?.setPixelMode(on);
  });
  $('#persona').addEventListener('change', (e) => { ui.personaId = e.target.value; pref.set('persona', ui.personaId); ui.refundArm = null; $('#give-approve').checked = false; ui.approvalBasis = null; renderGive(); renderLedger(); renderNextStep(); });
  $('#next-step-go').addEventListener('click', openNextStep);
  $('#deed-visit').addEventListener('click', visitDeed);
  $('#deed-next').addEventListener('click', () => { ui.deeds.index++; renderDeed(); $('#deed-name').focus(); });
  $('#deed-close').addEventListener('click', () => $('#deed-dialog').close());
  $('#deed-dialog').addEventListener('close', deedClosed);
  $('#next-step-record-go').addEventListener('click', openPaymentRecord);
  $('#receipt').addEventListener('focus', () => { if (ui.receipt && ui.receiptReviewed !== receiptKey()) { ui.receiptReviewed = receiptKey(); renderNextStep(); } });

  // House
  $('#panel-house').addEventListener('change', (e) => {
    // Name edits are tracked on input. Redrawing this scrollable panel on name blur can
    // move the Save button between pointer-down and click in WebKit.
    if (!['playMode', 'crestField', 'crestCharge'].includes(e.target.name)) return;
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
  $('#give-amount').addEventListener('input', () => { ui.amountTouched = true; $('#give-approve').checked = false; ui.approvalBasis = null; renderGive(); });
  $('#give-approve').addEventListener('change', (e) => {
    // Ticking approves the amount shown now: a later suggestion never replaces it.
    ui.approvalBasis = e.target.checked ? approvalBasis() : null;
    if (e.target.checked) ui.amountTouched = true;
    setStatus('#give-status', '', ''); renderGive();
  });

  // Ledger
  $('#ledger-search').addEventListener('input', (e) => { ui.ledgerSearch = e.target.value; ledgerGrid?.setSearch(ui.ledgerSearch); });
  $('#ledger-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    ui.ledgerFilter = b.dataset.filter;
    for (const x of $$('#ledger-filter [data-filter]')) x.setAttribute('aria-pressed', String(x === b));
    ledgerGrid?.setFilter(ui.ledgerFilter);
    const visible = ledgerRows().filter((r) => ui.ledgerFilter === 'all' || r.category === ui.ledgerFilter);
    if (!visible.some((r) => r.id === ui.ledgerRecord)) {
      ui.ledgerRecord = visible.at(-1)?.id ?? null;
      ledgerGrid?.selectRecord(ui.ledgerRecord); renderLedgerRecord();
    }
  });
  $('#steward-suggestions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-question]');
    // The "needs a check" question covers every record of this goal, so it is never focused on one order.
    if (b) askSteward(b.dataset.question, isNeedsCheckQuestion(b.dataset.question) ? null : state.contributions.find((c) => !c.simulated && c.providerOrderId)?.providerOrderId ?? null);
  });
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
      Object.assign(ui, { receipt: null, receiptReviewed: null, houseDirty: false, planFormDirty: false, scheduleDirty: false, amountTouched: false, goalDraft: null });
      sessionTab.set(null);
      applyState(res.state, { animate: false });
      selectTab('house');
      setStatus('#house-status', 'info', 'The example household was reset.');
    } catch (error) { setStatus('#ledger-status', 'error', error.message); }
  });
}

boot();
