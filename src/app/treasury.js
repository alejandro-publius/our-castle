// Treasury next-area milestone: an AG Studio custom widget inside the Ledger, fed by the server's own treasury rows.
// AG Studio (local evaluation licence) is loaded only when the Ledger is first shown. If it cannot load, the same
// milestone is drawn as plain DOM from the same server data, so the Ledger never loses it. No provider, model or write
// request is made by the widget: it reads Studio's in-page data engine, and "View on map" only moves the camera.
// The existing steward can explicitly start a scoped, headless Agent Framework run through askSteward.
import { createTreasuryAgent } from './treasury-agent.js';
import { rowChanges, hasChanges } from '../core/row-updates.js';

let loading = null;
function loadStudio() {
  if (window.agStudio) return Promise.resolve(window.agStudio);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/ag-studio/ag-studio.min.js';
      script.async = true;
      script.onload = () => (window.agStudio ? resolve(window.agStudio) : reject(new Error('AG Studio loaded without window.agStudio')));
      script.onerror = () => reject(new Error('AG Studio could not be loaded'));
      document.head.append(script);
    });
  }
  return loading;
}

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

/** Draw one milestone (or "all open") into `root`. Used by the Studio widget and by the plain fallback. */
export function drawNextArea(root, next, context) {
  const { formatMoney, onVisit } = context;
  const focused = root.contains(document.activeElement) ? document.activeElement?.dataset.action : null;
  const signature = JSON.stringify([next, context.week?.(), context.weekValues]);
  if (root.dataset.renderKey === signature) return;
  root.dataset.renderKey = signature;
  const openDetails = root.querySelector('.treasury-week details')?.open;
  const restore = () => {
    if (openDetails) root.querySelector('.treasury-week details').open = true;
    if (focused) root.querySelector(`[data-action="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  if (!next) {
    const done = el('p', 'next-area-done', 'Every milestone area is open.');
    root.replaceChildren(done, drawWeek(context));
    restore();
    return;
  }
  const head = el('p', 'next-area-name');
  head.append(el('span', 'next-area-label', `Next area · ${next.percent}%`), ' ', el('strong', '', next.label));
  const bar = el('div', 'next-area-bar');
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', `Progress toward ${next.label}`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(next.thresholdCents));
  bar.setAttribute('aria-valuenow', String(next.progressCents));
  bar.setAttribute('aria-valuetext', `${formatMoney(next.progressCents)} of ${formatMoney(next.thresholdCents)}`);
  const fill = el('span');
  // Studio's calculated field supplies the share; the fallback (no Studio) computes the same ratio here.
  const share = Number.isFinite(next.share) ? next.share : next.thresholdCents ? next.progressCents / next.thresholdCents : 0;
  fill.style.width = `${Math.max(0, Math.min(100, 100 * share))}%`;
  bar.append(fill);
  const meta = el('p', 'next-area-meta', `${formatMoney(next.progressCents)} of ${formatMoney(next.thresholdCents)} · ${formatMoney(next.remainingCents)} to go`);
  const visit = el('button', 'link-button next-area-visit', 'View on map');
  visit.type = 'button';
  visit.dataset.action = 'visit';
  visit.setAttribute('aria-label', `View ${next.label} on the map`);
  visit.addEventListener('click', (e) => onVisit(next.id, e));
  const text = el('div', 'next-area-text');
  text.append(head, bar, meta);
  const picture = el('img', 'next-area-art');
  picture.src = `assets/area-cards/${next.id}.png`; picture.alt = ''; picture.width = 88; picture.height = 64;
  const main = el('div', 'next-area-main');
  main.append(picture, text, visit);
  root.replaceChildren(main, drawWeek(context));
  restore();
}

function drawWeek({ week, weekValues, formatMoney, onRecord }) {
  const data = week?.();
  const root = el('section', 'treasury-week'); root.setAttribute('aria-label', 'This week');
  if (!data) return root;
  const values = weekValues ?? data;
  const heading = el('div', 'treasury-week-head');
  const date = new Date(`${data.start}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  heading.append(el('strong', '', 'This week'), el('span', '', `Week of ${date}`));
  root.append(heading);
  const scale = Math.max(values.plannedCents ?? 0, values.netCents, 1);
  const source = data.sources.length === 1 ? ({ simulated: 'Simulated', 'paypal-sandbox': 'Sandbox' }[data.sources[0]] ?? 'Recorded') : 'Recorded';
  for (const [label, cents, type] of [['Planned', values.plannedCents, 'plan'], [source, values.netCents, 'recorded']]) {
    const row = el('div', `treasury-week-row ${type}`);
    const track = el('span', 'treasury-week-track'), fill = el('span');
    track.setAttribute('aria-hidden', 'true'); fill.style.width = `${Math.max(0, cents ?? 0) / scale * 100}%`; track.append(fill);
    row.append(el('span', '', label), track, el('strong', '', cents === null ? 'No plan' : formatMoney(cents)));
    root.append(row);
  }
  const details = el('details');
  const summary = el('summary', '', data.records.length ? `${data.records.length} ${data.records.length === 1 ? 'record' : 'records'}` : 'Week details');
  summary.dataset.action = 'week-details';
  details.append(summary, el('p', 'fine', `Mon–Sun (UTC). Starting savings (${formatMoney(data.startingCents)}) are separate.${data.refundedCents ? ` Includes ${formatMoney(data.refundedCents)} refunded this week.` : ''}`));
  if (data.records.length) {
    const list = el('ul', 'treasury-week-records');
    for (const r of data.records.slice(-5).reverse()) {
      const sourceLabel = { simulated: 'Simulated', 'paypal-sandbox': 'PayPal sandbox' }[r.source] ?? 'Recorded';
      const button = el('button', 'link-button', `${r.refund ? 'Refund' : 'Contribution'} · ${formatMoney(r.amountCents)} · ${sourceLabel}`);
      button.type = 'button'; button.dataset.action = `record-${r.id}`; button.addEventListener('click', () => onRecord?.(r.id));
      const li = el('li'); li.append(button); list.append(li);
    }
    details.append(list);
    if (data.records.length > 5) details.append(el('p', 'fine', 'Latest 5 records; all records are in the ledger.'));
  }
  root.append(details);
  return root;
}

// The widget's own query: the next locked milestone group, aggregated by Studio's data engine from the server rows.
const field = (name, aggregation, key = name) => ({ fieldId: `areas.${name}`, key, aggregation });
export const NEXT_AREA_QUERY = Object.freeze({
  fields: [field('id', 'first'), field('groupLabel', 'first'), field('percent', 'max'), field('thresholdCents', 'max'),
    field('progressCents', 'max'), field('remainingCents', 'max'), field('id', 'count', 'count'),
    { fieldId: 'shareOfThreshold', key: 'share', aggregation: 'max' }],
  filter: [{ field: { fieldId: 'areas.next', key: 'areas.next' }, operator: 'isTrue', value: null }],
});

class NextAreaWidget {
  init(params) { this.params = params; this.root = el('div', 'next-area'); return this.render(); }
  getGui() { return this.root; }
  refresh(params) { this.params = params; return this.render(); } // also called when the data changes
  destroy() { this.root.replaceChildren(); }
  async render() {
    const generation = this.generation = (this.generation ?? 0) + 1;
    const { widgetApi, context } = this.params;
    const [response, weekly] = await Promise.all([
      widgetApi.getData(NEXT_AREA_QUERY, { queryId: 'next-area' }),
      widgetApi.getData({ fields: ['plannedCents', 'netCents', 'stamp'].map((name) => ({ fieldId: `week.${name}`, key: name, aggregation: 'first' })) }, { queryId: 'this-week' }),
    ]);
    if (response.replaced || weekly.replaced || generation !== this.generation) return;
    const row = response.results?.rows?.[0];
    const next = row && row.count > 0 ? {
      id: row.id, label: row.groupLabel, percent: row.percent, thresholdCents: row.thresholdCents,
      progressCents: row.progressCents, remainingCents: row.remainingCents, share: row.share,
    } : null;
    drawNextArea(this.root, next, { ...context, weekValues: weekly.results?.rows?.[0] });
    this.root.dataset.source = 'ag-studio';
    widgetApi.setDisplayState('displayed');
    context.rendered?.(next, this.root);
  }
}

const PARCHMENT = {
  fontFamily: 'Alegreya, "Alegreya Sans", Arial, sans-serif', fontSize: 15, foregroundColor: '#382f25', backgroundColor: 'transparent',
  accentColor: '#8d6c3a', borderColor: '#c9ab6e', browserColorScheme: 'light',
  studioCanvasBackgroundColor: 'transparent', studioCanvasBorder: false, studioCanvasShadow: 'none', studioCanvasPadding: 0,
  studioMinHeight: 0, studioMinWidth: 0, studioCanvasMinWidth: 0,
};
// Studio's page is laid out once with room for the longest milestone name on a phone; the Ledger's own container is
// then sized to the drawn content (overflow hidden), so updates never re-lay out Studio's page.
const ROW = 12, ROWS = 60; // expandable receipt links; measured container clips unused tracks
const LAYOUT = { columns: 24, rowHeight: ROW, pagePadding: 0, widgetPadding: 0, minWidth: 0, backgroundColor: 'transparent', widgetBackgroundColor: 'transparent', widgetBorderEnabled: false };

const rowsFor = (state) => state.treasury.areas.map((a) => ({
  id: a.id, name: a.name, groupLabel: a.groupLabel, percent: a.percent, thresholdCents: a.thresholdCents,
  progressCents: a.progressCents, remainingCents: a.remainingCents, open: a.open, next: a.next,
}));
// Studio's data model for the Treasury: one typed, described table of the server's milestone rows, and one calculated
// column (progress toward each area's threshold) evaluated by Studio's engine. Descriptions are the AI-facing schema
// notes Studio's framework reads; amounts stay integer cents from the server, so nothing here re-derives entitlement.
const cents = (id, name, description) => ({ id, name, description, format: 'integerFormat' });
export const AREA_FIELDS = Object.freeze([
  { id: 'id', name: 'Area id', format: 'textFormat', description: 'Stable district id from the server realm.' },
  { id: 'name', name: 'Area', format: 'textFormat', description: 'District name shown on the map.' },
  { id: 'groupLabel', name: 'Opens with', format: 'textFormat', description: 'Every district that opens at the same milestone.' },
  { id: 'percent', name: 'Milestone', format: 'integerFormat', description: 'Share of the goal, in percent, at which this area opens.' },
  cents('thresholdCents', 'Opens at (cents)', 'Server-tracked goal progress, in integer cents, required for this area.'),
  cents('progressCents', 'Progress (cents)', 'Server-tracked goal progress toward this threshold, capped at it. May include reported or simulated entries; not PayPal verification.'),
  cents('remainingCents', 'To go (cents)', 'Cents still needed; zero once open.'),
  { id: 'open', name: 'Open', format: 'booleanFormat', description: 'Opened by an earned server achievement.' },
  { id: 'next', name: 'Next', format: 'booleanFormat', description: 'Part of the lowest locked milestone group.' },
]);
export const AREA_EXPRESSIONS = Object.freeze([{
  id: 'shareOfThreshold', name: 'Share of threshold', format: 'percentageFormat', isMeasure: false,
  description: 'Progress divided by the threshold for each area (1 = threshold reached). Access comes from the server open flag; keepsakes can remain open after a refund.',
  expression: { operator: 'divide', inputs: [{ id: 'areas.progressCents' }, { id: 'areas.thresholdCents' }] },
}]);
const dataFor = (state) => ({
  description: "One family's goal as milestone areas of a woodland realm. Read-only server ledger rows may include reported savings, simulated payments or confirmed sandbox contributions; not a bank balance.",
  sources: [
    { id: 'areas', name: 'Areas', description: 'Milestone districts in opening order.', data: rowsFor(state), fields: AREA_FIELDS, transactions: 'all', primaryKeyField: 'id' },
    { id: 'week', name: 'This week', data: weekRows(state), transactions: 'all', primaryKeyField: 'id', fields: [
      { id: 'id', format: 'textFormat' }, { id: 'stamp', format: 'textFormat', description: 'Local week record revision; refreshes drill-in links when totals happen to stay equal.' }, cents('plannedCents', 'Planned', 'Accepted plan amounts due this calendar week, or null when no accepted plan.'),
      cents('netCents', 'Recorded', 'Contributions minus refunds recorded this UTC week; excludes starting reports, bills, gifts and uncredited attempts.'),
    ] },
  ],
  expressions: AREA_EXPRESSIONS,
});
const weekRows = (state) => [{ id: 'this-week', plannedCents: state.treasury.week?.plannedCents ?? null, netCents: state.treasury.week?.netCents ?? 0, stamp: JSON.stringify(state.treasury.week ?? null) }];
const fallbackNext = (state) => {
  const n = state.treasury.nextArea;
  return n && { id: n.ids[0], label: state.treasury.areas.find((a) => a.id === n.ids[0])?.groupLabel ?? n.names[0], percent: n.percent,
    thresholdCents: n.thresholdCents, progressCents: n.progressCents, remainingCents: n.remainingCents };
};

/**
 * @param container the Ledger element that hosts the milestone
 * @param options.formatMoney cents -> text in the goal currency
 * @param options.onVisit (districtId, event) => void — focus the district on the map (no writes)
 * @param options.getLicence () => Promise<string|null> — the local AG Studio evaluation licence, if any
 */
export function createTreasury(container, { formatMoney, onVisit, onRecord, getLicence, requestSteward, getStewardScope = () => '' }) {
  let studio = null, failed = false, starting = null, latest = null, lib = null, agent = null;
  let applied = null, flushing = null;
  let stewardScope = getStewardScope();
  const status = { source: 'pending', licensed: false, error: null, next: undefined, transactions: 0 };
  // Size the Ledger's container to the drawn milestone (names wrap on phones). Studio itself is not re-laid out.
  const fit = (root) => { const height = root.offsetHeight; if (height > 0 && container.style.height !== `${height}px`) container.style.height = `${height}px`; };
  const context = { formatMoney, onVisit, onRecord, week: () => latest?.treasury.week, rendered: (next, root) => { status.next = next; requestAnimationFrame(() => fit(root)); } };
  const resize = new ResizeObserver(() => { const root = container.querySelector('.next-area'); if (root && studio) fit(root); });
  resize.observe(container);
  container.addEventListener('toggle', () => { const root = container.querySelector('.next-area'); if (root) requestAnimationFrame(() => fit(root)); }, true);
  const agentFor = (api = studio) => (agent ??= createTreasuryAgent({ lib, studio: api, request: requestSteward, getScope: getStewardScope }));

  function fallback() {
    container.dataset.source = 'fallback';
    container.style.height = '';
    const root = el('div', 'next-area');
    root.dataset.source = 'fallback';
    drawNextArea(root, fallbackNext(latest), context);
    container.replaceChildren(root);
  }

  async function start() {
    try {
      const loaded = await Promise.all([loadStudio(), getLicence().catch(() => null)]);
      lib = loaded[0];
      const licence = loaded[1];
      if (licence) { lib.AgStudioLicenseManager.setLicenseKey(licence); status.licensed = true; } // before createStudio, as documented
      container.replaceChildren();
      container.dataset.source = 'ag-studio';
      container.style.height = '84px'; // until the first draw measures the real height
      const initial = latest;
      applied = { areas: rowsFor(initial), week: weekRows(initial) };
      studio = lib.createStudio(container, {
        mode: 'view',
        panels: { view: { left: [], right: [] } },
        ai: ({ api }) => agentFor(api).harness,
        theme: lib.studioTheme.withParams(PARCHMENT),
        loadThemeGoogleFonts: false,
        layout: LAYOUT,
        context,
        widgets: (config) => lib.createWidgets({
          additionalTypes: [{
            id: 'nextArea', label: 'Next area', comp: NextAreaWidget, dataMapping: {},
            form: (p) => p.createDefaults({ dataMappingItems: [] }),
            defaultSize: { width: 400, height: 84 }, minSize: { width: 200, height: 60 },
          }],
          menu: config.menu,
        }),
        data: dataFor(initial),
        initialState: { pages: [{ id: 'treasury', widgets: { next: { type: 'nextArea' } }, widgetLayout: { next: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: ROWS } } }], selectedPageId: 'treasury' },
      });
      status.source = 'ag-studio';
    } catch (error) {
      agent?.cancel();
      agent?.harness?.dispose?.();
      agent = null; lib = null;
      failed = true;
      status.source = 'fallback';
      status.error = error.message;
      fallback();
    }
  }

  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (studio && !failed) {
        const target = latest;
        const next = { areas: rowsFor(target), week: weekRows(target) };
        const changes = Object.keys(next).map((tableId) => ({ tableId, ...rowChanges(applied[tableId], next[tableId]) })).filter(hasChanges);
        if (!changes.length) break;
        await studio.getDataEngine().applyTransaction(changes);
        applied = next; status.transactions++;
        if (target === latest) break;
      }
    })().catch((error) => {
      failed = true; status.source = 'fallback'; status.error = error.message;
      agent?.cancel(); agent?.harness?.dispose?.(); agent = null; lib = null;
      studio?.destroy?.(); studio = null; fallback();
    }).finally(() => { flushing = null; });
    return flushing;
  }

  return {
    /** Show the current server state; starts Studio on first use. Returns when the milestone is in place. */
    update(state) {
      latest = state;
      if (failed) { fallback(); return Promise.resolve(); }
      if (studio) return flush();
      starting ??= start();
      return starting.then(flush);
    },
    async askSteward(payload) {
      const scope = getStewardScope();
      await starting;
      if (scope !== getStewardScope()) throw new DOMException('The records changed. Check the current record again.', 'AbortError');
      if (failed) { lib = null; agent ??= createTreasuryAgent({ request: requestSteward, getScope: getStewardScope }); }
      return agentFor().ask(payload);
    },
    refreshScope() {
      const scope = getStewardScope(), changed = scope !== stewardScope;
      stewardScope = scope;
      agent?.refreshScope();
      return changed;
    },
    status: () => ({ ...status, agent: agent?.status() ?? null }),
  };
}
