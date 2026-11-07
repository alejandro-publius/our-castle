// The house ledger as one AG Grid Community (MIT) grid, themed with the parchment tokens.
// AG Grid is loaded only when the ledger is first shown. If it cannot load, a plain HTML table
// with the same rows is rendered instead, so the ledger never disappears.
import { rowChanges, hasChanges } from '../core/row-updates.js';

let loading = null;
function loadAgGrid() {
  if (window.agGrid) return Promise.resolve(window.agGrid);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/ag-grid/ag-grid-community.min.js';
      script.async = true;
      script.onload = () => (window.agGrid ? resolve(window.agGrid) : reject(new Error('AG Grid loaded without window.agGrid')));
      script.onerror = () => reject(new Error('AG Grid could not be loaded'));
      document.head.append(script);
    });
  }
  return loading;
}

const PARCHMENT = {
  fontFamily: 'Alegreya, "Alegreya Sans", Arial, sans-serif',
  fontSize: 14,
  headerFontWeight: 700,
  backgroundColor: '#f6edd6',
  foregroundColor: '#382f25',
  chromeBackgroundColor: '#ecdfbd',
  headerBackgroundColor: '#e3d3ab',
  headerTextColor: '#382f25',
  oddRowBackgroundColor: '#f1e5c7',
  rowHoverColor: '#ead9b0',
  selectedRowBackgroundColor: '#e3cf9c',
  pinnedRowBackgroundColor: '#e3d3ab',
  pinnedRowFontWeight: 700,
  borderColor: '#c9ab6e',
  accentColor: '#8d6c3a',
  wrapperBorderRadius: 3,
  borderRadius: 3,
  spacing: 6,
  browserColorScheme: 'light',
};

const byIso = (a, b, nodeA, nodeB) => (nodeA.data?.whenIso ?? '').localeCompare(nodeB.data?.whenIso ?? '');

export function createLedgerGrid(container, { formatMoney, onSelect = () => {} }) {
  let api = null;
  let failed = false;
  let filter = 'all';
  let search = '';
  let selected = null;
  let rows = [];
  let total = null;
  let appliedRows = [];

  // Two-line cells keep four readable columns inside the parchment panel. Labels can be typed by the
  // household, so cells are built as DOM text, never HTML strings.
  const twoLine = (top, bottom) => {
    const wrap = document.createElement('span');
    wrap.className = 'cell-two-line';
    const a = document.createElement('strong'); a.textContent = top ?? '';
    const b = document.createElement('small'); b.textContent = bottom ?? '';
    wrap.append(a, b);
    return wrap;
  };
  const columnDefs = [
    {
      colId: 'record', headerName: 'Record', minWidth: 102, flex: 1, sortable: false,
      cellRenderer: (p) => (p.node.rowPinned ? twoLine('Total', '') : twoLine(p.data.record, p.data.source)),
      getQuickFilterText: (p) => p.data?.searchText ?? '',
    },
    {
      colId: 'entry', field: 'entry', headerName: 'Entry', minWidth: 136, flex: 1.6, sort: 'desc', comparator: byIso, autoHeight: true,
      cellRenderer: (p) => (p.node.rowPinned ? twoLine(p.data.entry, '') : twoLine(p.data.entry, p.data.when)),
    },
    {
      colId: 'amount', headerName: 'Amount', minWidth: 84, flex: 0.8, type: 'rightAligned', cellDataType: 'number',
      // Sort the amount shown, including uncredited attempts. Their goal effect remains zero;
      // real ledger entries (including refunds) and the pinned total keep their signed values.
      valueGetter: ({ data }) => data?.contribution && !data.recordEntry ? data.contribution.amountCents : data?.signedCents,
      valueFormatter: (p) => (p.data ? p.data.amountText : ''),
    },
    { colId: 'counts', field: 'counts', headerName: 'Counts toward goal', minWidth: 92, flex: 0.9, wrapText: true, autoHeight: true, wrapHeaderText: true, autoHeaderHeight: true },
  ];

  function choose(row) {
    if (!row || row.id === 'total') return;
    selected = String(row.id);
    onSelect(row);
  }
  function fallback() {
    const all = [...rows].sort((a, b) => b.whenIso.localeCompare(a.whenIso)).filter((r) =>
      (filter === 'all' || r.category === filter) && (!search || r.searchText.toLowerCase().includes(search.toLowerCase())));
    const table = document.createElement('table');
    table.className = 'ledger-table';
    table.innerHTML = '<thead><tr><th scope="col">When</th><th scope="col">Record</th><th scope="col">Entry</th><th scope="col">Source</th><th scope="col" class="amount">Amount</th><th scope="col">Toward goal</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const r of [...all, ...(total ? [total] : [])]) {
      const tr = document.createElement('tr');
      if (r === total) tr.className = 'total';
      for (const [key, cls] of [['when'], ['record'], ['entry'], ['source'], ['amountText', 'amount'], ['counts']]) {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        if (key === 'entry' && r !== total) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'ledger-record-button';
          button.textContent = r[key] ?? '';
          button.setAttribute('aria-pressed', String(String(r.id) === selected));
          button.addEventListener('click', () => { choose(r); fallback(); });
          td.append(button);
        } else td.textContent = r[key] ?? '';
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.append(table);
    container.replaceChildren(wrap);
  }

  async function ensure() {
    if (api || failed) return api;
    try {
      const ag = await loadAgGrid();
      // Another update may have mounted the grid while these callers shared the script load.
      if (api || failed) return api;
      ag.ModuleRegistry?.registerModules?.([ag.AllCommunityModule]);
      api = ag.createGrid(container, {
        theme: ag.themeQuartz.withParams(PARCHMENT),
        columnDefs,
        rowData: rows,
        pinnedBottomRowData: total ? [total] : [],
        domLayout: 'autoHeight',
        defaultColDef: { sortable: true, resizable: true, suppressMovable: true },
        isExternalFilterPresent: () => filter !== 'all',
        doesExternalFilterPass: (node) => node.data?.category === filter,
        getRowId: (p) => String(p.data.id),
        rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true, isRowSelectable: (node) => !node.rowPinned },
        onSelectionChanged: (event) => { const row = event.api.getSelectedRows()[0]; if (row) choose(row); },
        onCellKeyDown: (event) => { if (event.event?.key === 'Enter' && !event.node.rowPinned) event.node.setSelected(true); },
        rowClassRules: { 'not-savings': (p) => !p.node.rowPinned && p.data?.category !== 'goal' },
        ensureDomOrder: true,
        suppressColumnVirtualisation: true,
        localeText: { noRowsToShow: 'No records yet.' },
      });
      container.dataset.grid = 'ag-grid';
      appliedRows = rows;
    } catch (error) {
      console.warn('[ledger] AG Grid unavailable, showing a plain table', error);
      failed = true;
      container.dataset.grid = 'fallback';
    }
    return api;
  }

  return {
    /** Stable-id transactions preserve selection, sorting and filters while the server's records change. */
    async update(nextRows, progressCents) {
      rows = nextRows;
      total = { id: 'total', whenIso: '', when: '', record: 'Total', entry: 'Current tracked progress', source: '', signedCents: progressCents, amountText: formatMoney(progressCents), counts: '' };
      const grid = await ensure();
      if (grid) {
        const delta = rowChanges(appliedRows, rows);
        if (hasChanges(delta)) {
          // Rows arriving above the keyboard's cell (another member's new record, say) must not move it to another record.
          const focused = grid.getFocusedCell();
          const focusedId = focused && !focused.rowPinned ? grid.getDisplayedRowAtIndex(focused.rowIndex)?.id : null;
          grid.applyTransaction({ ...delta, remove: delta.remove.map((id) => ({ id })) });
          const node = focusedId ? grid.getRowNode(focusedId) : null;
          if (node && node.rowIndex != null && node.rowIndex !== focused.rowIndex && container.contains(document.activeElement)) grid.setFocusedCell(node.rowIndex, focused.column);
        }
        appliedRows = rows;
        grid.setGridOption('pinnedBottomRowData', [total]);
      } else fallback();
    },
    setFilter(next) {
      if (filter === next) return;
      filter = next;
      if (api) api.onFilterChanged(); else if (failed) fallback();
    },
    setSearch(next) {
      if (search === String(next).trim()) return;
      search = String(next).trim();
      if (api) api.setGridOption('quickFilterText', search); else if (failed) fallback();
    },
    selectRecord(id) {
      selected = id == null ? null : String(id);
      if (api) {
        api.forEachNode((node) => { if (node.isSelected() !== (String(node.id) === selected)) node.setSelected(String(node.id) === selected); });
      } else if (failed) fallback();
    },
    get mode() { return api ? 'ag-grid' : failed ? 'fallback' : 'loading'; },
  };
}
