import { api, newRequestId } from './api.js';

const $ = id => document.getElementById(id);
const RAILS = Object.freeze({ simulated: 'Simulated contribution · no money moves', 'paypal-sandbox': 'PayPal sandbox · test payment', 'pyusd-devnet': 'PYUSD devnet · test tokens with no monetary value' });
export const villageRailLabel = rail => RAILS[rail] ?? 'Unsupported contribution type';
export function parseVillageMinor(value, decimals = 2, allowZero = false) {
  if (![2, 6].includes(decimals) || typeof value !== 'string' || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = Number(whole + fraction.padEnd(decimals, '0'));
  return Number.isSafeInteger(minor) && minor >= (allowZero ? 0 : 1) ? minor : null;
}
export function villageMoney(minor, fund) {
  if (!Number.isSafeInteger(minor)) return '—';
  const decimals = fund?.decimals === 6 ? 6 : 2, scale = 10n ** BigInt(decimals), value = BigInt(minor), magnitude = value < 0 ? -value : value;
  const whole = (magnitude / scale).toLocaleString('en-US'), fraction = String(magnitude % scale).padStart(decimals, '0'), sign = value < 0 ? '−' : '';
  if (fund?.rail === 'pyusd-devnet') { const tail = fraction.replace(/0+$/, ''); return `${sign}${whole}${tail ? `.${tail}` : ''} test PYUSD`; }
  return `${sign}$${whole}.${fraction}`;
}
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined || v === null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) if (c !== undefined && c !== null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};
const button = (text, action, attrs = {}) => h('button', { type: 'button', onclick: action, ...attrs }, text);
const field = (label, control) => { control.setAttribute('aria-label', label); return h('label', { class: 'field' }, h('span', {}, label), control); };
const input = (name, attrs = {}) => h('input', { name, ...attrs });
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : 'No date set';

/** One paper for shared funds. It reads server projections; it never guesses payment or presence outcomes. */
export function createVillageFund({ getState, actor, applyState, getScene, onSquare = () => {}, onFundView = () => {}, onExchange = () => {} }) {
  const opener = $('open-village'), dialog = $('village-fund-dialog'), controls = $('village-square-controls');
  let village = null, stateVillage = null, review = null, recoveryFundId = null, selected = null, pane = 'project', scopeKey = null, scopeHousehold = null, scopeSignedIn = false, openedBy = null;
  let busy = false, square = false, destroyed = false, generation = 0, polling = false, lastRead = 0, lastPresenceRead = 0;
  let presence = { members: [], selfId: null }, joined = false, presenceEpoch = 0, lastHeartbeat = 0, paymentKey = null, paymentRequest = null, pendingPayment = null, draft = null;
  const watched = new Set(); let lastVaultRead = 0;
  let ownPaymentsKey = null, paymentReadEpoch = 0, assistantGrant = null;
  const scope = () => JSON.stringify([getState()?.household?.id, actor()?.id]);
  const adult = () => actor()?.role === 'adult';
  const fund = () => review?.fund?.id === selected ? review.fund : village?.funds?.find(f => f.id === selected) ?? null;
  const outside = () => review?.fund?.id === selected && (review.viewerMember ?? review.fund.viewerMember) === false;
  const orderScope = id => JSON.stringify([scope(), id]);
  const memberInput = () => getState()?.access ? {} : { memberId: actor()?.id, approverId: actor()?.id };
  const memberQuery = () => getState()?.access ? '' : `&memberId=${encodeURIComponent(actor()?.id ?? '')}`;
  const status = h('p', { id: 'village-status', class: 'village-status', role: 'status', 'aria-live': 'polite' });
  const say = text => { status.textContent = text; };
  const selection = h('select', { id: 'village-fund-select', onchange: () => choose(selection.value) });
  const title = h('h3', { id: 'village-project-title', tabindex: '-1' });
  const rail = h('p', { class: 'village-rail' });
  const progress = h('progress', { id: 'village-progress', max: 10000, value: 0, 'aria-label': 'Shared project progress' });
  const summary = h('p', { class: 'village-progress-copy' }), remaining = h('p', { class: 'fine' });
  const empty = h('p', { id: 'village-empty' }, 'A shared project begins with a purpose, an amount and a date.');
  // First use. A fund needs a neighborhood and a neighborhood needs a second family; both already have their own reviewed
  // forms in Village Exchange. These only open that form over this paper. They create, join and send nothing themselves.
  const startNeighborhood = button('Start a new neighborhood', () => onExchange('start'), { id: 'village-start', class: 'village-action' });
  const joinNeighborhood = button('Join with an invitation code', () => onExchange('join'), { id: 'village-join', class: 'village-action' });
  const begin = h('div', { class: 'village-begin', hidden: true }, startNeighborhood, joinNeighborhood);
  const sheet = h('section', { class: 'village-fund-sheet' });
  const heading = h('h2', { id: 'village-fund-title', tabindex: '-1' }, 'The village fund');
  const neighborhood = h('p', { class: 'exchange-eyebrow' });
  const tabs = h('nav', { class: 'village-tabs', 'aria-label': 'Fund sections' });
  const pages = Object.fromEntries(['project', 'families', 'records'].map(name => [name, h('section', { id: `village-${name}`, 'aria-label': name[0].toUpperCase() + name.slice(1) })]));
  for (const name of Object.keys(pages)) tabs.append(button({ project: 'Project', families: 'Families', records: 'Records' }[name], () => { pane = name; renderPane(); }, { 'data-village-tab': name, 'aria-controls': `village-${name}`, 'aria-pressed': String(name === pane) }));

  const amount = input('amount', { id: 'village-amount', type: 'text', inputmode: 'decimal', required: true, autocomplete: 'off' });
  const approved = input('approved', { type: 'checkbox', id: 'village-approve', required: true });
  const approvalText = h('span');
  const paymentButton = h('button', { type: 'submit', id: 'village-contribute' }, 'Contribute');
  const paymentForm = h('form', { id: 'village-payment-form', class: 'village-contribution' }, field('Your contribution', amount), h('label', { class: 'check' }, approved, approvalText), paymentButton);
  const paymentNote = h('p', { class: 'fine' });
  const paymentFollowup = h('div', { class: 'village-payment-followup' });
  amount.addEventListener('input', () => { approved.checked = false; paymentRequest = null; renderApproval(); });
  approved.addEventListener('change', renderApproval);
  paymentForm.addEventListener('submit', e => { e.preventDefault(); contribute(); });
  const vaultAddress = h('code', { class: 'village-address' });
  const vaultStatus = h('p', { class: 'fine' });
  const vaultWatch = button('Watch new deposits', () => act('/api/village/vault/enroll', { fundId: selected, confirmed: true }, () => { watched.add(selected); render(); }));
  const vaultRefresh = button('Check for test-token deposits', () => act('/api/village/vault/refresh', { fundId: selected }));
  const vault = h('div', { class: 'village-vault' }, h('p', {}, 'Send only PYUSD devnet test tokens to the watched address. This app cannot sign or send tokens.'), vaultAddress,
    vaultWatch, vaultRefresh, vaultStatus, h('p', { class: 'fine' }, 'A wallet refresh confirms incoming records only. Test tokens do not pay for the real project.'));
  const shareAmount = input('committed', { type: 'text', inputmode: 'decimal', required: true });
  const shareApproved = input('confirmed', { type: 'checkbox', required: true });
  const shareForm = h('form', { id: 'village-share-form' }, field('Our family’s voluntary share', shareAmount), h('label', { class: 'check' }, shareApproved, ' We reviewed this share. It is a commitment, not a payment or debt.'), h('button', { type: 'submit' }, 'Save our share'));
  shareForm.addEventListener('submit', e => { e.preventDefault(); const f = fund(), n = parseVillageMinor(shareAmount.value, f?.decimals, true); if (!f || n === null || !shareApproved.checked) return say('Enter a valid share and review it first.'); act('/api/village', { action: 'share', fundId: f.id, committedMinor: n, expectedRevision: f.revision, confirmed: true }); });
  const shareDetails = h('details', {}, h('summary', {}, 'Our family’s share'), shareForm);
  pages.project.append(title, rail, progress, summary, remaining,
    button('Visit the shared square', showSquare, { id: 'village-visit' }), paymentNote, paymentForm, vault, shareDetails);
  const families = h('ul', { class: 'village-family-list' });
  const shareCastle = button('Share our castle’s appearance', () => act('/api/village', { action: 'share-castle', shared: !village.members?.find(m => m.mine)?.shared, confirmed: true }), { class: 'village-action' });
  const inviteFamily = button('Invite a family', () => onExchange('invite'), { id: 'village-invite', class: 'village-action' });
  const invite = h('div', { class: 'village-invite', hidden: true }, inviteFamily, h('p', { class: 'fine' }, 'Opens Village Exchange. You create a one-family code there and share it yourself.'));
  pages.families.append(h('h3', {}, 'Building together'), h('p', { class: 'fine' }, 'Only this shared project’s commitments and contributions appear here. A family’s household balance stays private.'), families,
    invite, shareCastle, h('p', { class: 'fine' }, 'Sharing shows your castle’s tier and crest to this neighborhood. Otherwise a plain starter home stands in its place. No amounts appear on the map.'));
  const records = h('ol', { class: 'village-records' });
  pages.records.append(h('h3', {}, 'Contribution records'), h('p', { class: 'fine' }, 'Confirmed captures add progress. Refunds subtract it. Promised shares never count as payments.'), records);
  const assistantStatus = h('p', { class: 'fine', role: 'status' });
  const assistantToken = input('assistant-token', { type: 'password', readonly: true, autocomplete: 'off', 'aria-label': 'Private assistant token, shown only this time', hidden: true });
  const assistantCreate = button('Create a temporary connection', () => { const id = selected; act('/api/mcp/grants', { fundId: id }, res => { assistantGrant = { ...res, token: dialog.open && selected === id ? res.token : undefined }; renderAssistant(); }); });
  const assistantCopy = button('Copy local assistant configuration', async () => {
    if (!assistantGrant?.token) return;
    const config = { mcpServers: { 'our-castle': { command: 'node', args: ['/absolute/path/to/our-castle/scripts/mcp.mjs'], env: { OUR_CASTLE_MCP_URL: location.origin, OUR_CASTLE_MCP_TOKEN: assistantGrant.token } } } };
    try { await navigator.clipboard.writeText(JSON.stringify(config, null, 2)); assistantStatus.textContent = 'Copied. Set the script’s absolute path in your assistant. Keep this temporary configuration private.'; }
    catch { assistantStatus.textContent = 'Clipboard permission is unavailable. The connection was not copied.'; }
  }, { hidden: true });
  const assistantRevoke = button('Revoke this connection', () => assistantGrant && act('/api/mcp/grants/revoke', { grantId: assistantGrant.grantId }, () => { assistantGrant = null; renderAssistant(); }), { hidden: true });
  const assistantDetails = h('details', { id: 'village-assistant' }, h('summary', {}, 'Connect a local assistant'),
    h('p', { class: 'fine' }, 'Read this fund only. Cannot make payments. Use the local Node adapter from your copy of Our Castle; edit its absolute path in the copied configuration. The token expires within 15 minutes and ends with this passkey session.'),
    assistantStatus, assistantToken, assistantCreate, assistantCopy, assistantRevoke);
  pages.records.append(assistantDetails);

  function renderAssistant() {
    const local = location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && Number(location.port) >= 1024;
    assistantDetails.hidden = !getState()?.access || !adult() || outside() || !village?.capabilities?.mcp;
    assistantCreate.disabled = !local || Boolean(assistantGrant);
    assistantCopy.hidden = assistantToken.hidden = !assistantGrant?.token;
    assistantToken.value = assistantGrant?.token ?? '';
    assistantRevoke.hidden = !assistantGrant;
    assistantStatus.textContent = assistantGrant ? `Private connection for ${assistantGrant.fundId} expires ${new Date(assistantGrant.expiresAt).toLocaleString()}.${assistantGrant.token ? ' Copy it before closing this window.' : ' Its token is no longer displayed; revoke it before making another.'}` : local ? 'Choose this only when you are ready to configure your local assistant. Nothing is connected automatically.' : 'The local adapter requires this app on a loopback address with an explicit port.';
  }
  function forgetAssistantToken() { if (assistantGrant) assistantGrant = { ...assistantGrant, token: undefined }; assistantToken.value = ''; assistantToken.hidden = assistantCopy.hidden = true; }

  const createTitle = input('title', { required: true, maxlength: 100 }), createAmount = input('target', { required: true, type: 'text', inputmode: 'decimal' });
  const createDate = input('deadline', { required: true, type: 'date' });
  const createRail = h('select', { name: 'rail' }, Object.keys(RAILS).map(value => h('option', { value }, RAILS[value])));
  const recipient = input('recipient', { maxlength: 100, autocomplete: 'off', spellcheck: 'false' });
  const recipientField = field('Recipient', recipient);
  const createConfirmed = input('confirmed', { type: 'checkbox', required: true });
  const createForm = h('form', { id: 'village-create-form', class: 'village-create-grid' }, field('Project name', createTitle), field('Target amount', createAmount), field('Target date', createDate), field('Contribution type', createRail), recipientField,
    h('p', { class: 'fine' }, 'Each fund uses one contribution type. Changing the recipient requires a new fund.'), h('label', { class: 'check' }, createConfirmed, ' I reviewed this project, amount, date and recipient.'), h('button', { type: 'submit' }, 'Create shared project'));
  const createDetails = h('details', { id: 'village-create' }, h('summary', {}, 'Start a shared project'), createForm);
  function railChanged() { const value = createRail.value; recipientField.hidden = value === 'simulated'; recipient.required = !recipientField.hidden; recipientField.firstChild.textContent = value === 'paypal-sandbox' ? 'Organizer’s sandbox merchant ID' : 'Organizer’s Solana devnet address'; recipient.setAttribute('aria-label', recipientField.firstChild.textContent); createConfirmed.checked = false; }
  createRail.addEventListener('change', railChanged); createForm.addEventListener('input', e => { if (e.target !== createConfirmed) createConfirmed.checked = false; }); railChanged();
  createForm.addEventListener('submit', e => {
    e.preventDefault(); const n = parseVillageMinor(createAmount.value, createRail.value === 'pyusd-devnet' ? 6 : 2);
    if (!n || !createConfirmed.checked) return say('Review a valid target amount first.');
    const to = createRail.value === 'paypal-sandbox' ? { kind: 'paypal', merchantId: recipient.value.trim() } : createRail.value === 'pyusd-devnet' ? { kind: 'solana-devnet', address: recipient.value.trim() } : null;
    act('/api/village', { action: 'create', title: createTitle.value.trim(), targetMinor: n, deadline: createDate.value, rail: createRail.value, projectKind: 'schoolhouse', recipient: to, confirmed: true }, res => { selected = res.fundId ?? selected; createForm.reset(); railChanged(); createDetails.open = false; render(); });
  });

  const draftText = h('textarea', { rows: 2, maxlength: 500, required: true, placeholder: 'We need $400 for the class trip by December 12, 2026.' });
  const draftResult = h('div', { id: 'village-draft-result' });
  const draftForm = h('form', {}, field('Describe a shared project', draftText), h('button', { type: 'submit' }, 'Draft a project'));
  draftText.addEventListener('input', () => { draft = null; draftResult.replaceChildren(); });
  draftForm.addEventListener('submit', async e => {
    e.preventDefault(); await act('/api/village/draft', { text: draftText.value.trim() }, res => {
      draft = res;
      draftResult.replaceChildren(h('p', { class: 'fine' }, res.source?.label ?? 'Project draft'));
      if (res.status !== 'ready') { draftResult.append(h('ul', {}, (res.issues ?? []).map(i => h('li', {}, i.message)))); return; }
      const d = res.draft;
      draftResult.append(h('p', {}, `${d.title} · ${villageMoney(d.targetMinor, d)} · by ${day(d.deadline)}`), h('p', { class: 'fine' }, villageRailLabel(d.rail)),
        h('ul', {}, (d.shares ?? []).map(s => h('li', {}, `${s.alias}: proposed ${villageMoney(s.committedMinor, d)}`))),
        h('p', { class: 'fine' }, 'No payment or recurring charge is scheduled. Each family chooses its own share.'),
        button('I reviewed this — create project', () => draft && act('/api/village/draft/accept', { revision: draft.draft.revision, confirmed: true }, res => { selected = res.fundId ?? selected; draft = null; draftResult.replaceChildren(); draftText.value = ''; draftDetails.open = false; render(); }), { class: 'village-action primary' }));
    }, res => res.status === 'ready' ? 'Draft ready to review. Nothing is created until you accept it.' : 'A few details are missing. Nothing was created.');
  });
  const draftDetails = h('details', {}, h('summary', {}, 'Describe it in one sentence'), draftForm, draftResult);
  const question = input('question', { required: true, maxlength: 300, placeholder: 'Who has contributed?' }), answer = h('p', { id: 'village-answer', role: 'status' });
  const questionForm = h('form', {}, field('Ask the treasurer', question), h('button', { type: 'submit' }, 'Read the fund records'));
  questionForm.addEventListener('submit', e => { e.preventDefault(); act('/api/village/treasurer', { fundId: selected, question: question.value.trim() }, res => { answer.textContent = res.answer; }, ''); });
  const treasurer = h('details', {}, h('summary', {}, 'Ask the treasurer'), h('p', { class: 'fine' }, 'Answers from this fund’s records. It cannot move money.'), questionForm, answer);
  const reviewLink = h('a', { id: 'village-review-link' }), qr = h('img', { width: 160, height: 160, alt: 'QR code for this project’s review link' });
  const publishButton = button('Publish this project’s review link', () => { const f = fund(); act('/api/village', { action: 'publish', fundId: f.id, expectedRevision: f.revision, published: !f.published, confirmed: true }); });
  const shareLink = h('details', { id: 'village-review-link-details' }, h('summary', {}, 'Review link (this computer)'),
    h('p', { class: 'fine' }, 'This local link opens on this computer. It is not a public fundraiser or a way to pay from another device.'), publishButton, h('div', { class: 'village-qr' }, qr, reviewLink));
  shareLink.addEventListener('toggle', () => { if (shareLink.open) renderReviewLink(); });
  sheet.append(field('Shared project', selection), empty, begin, tabs, ...Object.values(pages), paymentFollowup, treasurer, shareLink);
  dialog.replaceChildren(h('header', { class: 'exchange-window-head' }, h('img', { src: 'assets/brand/our-castle/crest.webp', width: 40, height: 44, alt: '' }), h('div', {}, neighborhood, heading), button('×', close, { class: 'exchange-close', 'aria-label': 'Close village fund' })),
    h('div', { class: 'exchange-window-body village-paper' }, sheet, status, draftDetails, createDetails));
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });

  const squareName = h('strong', {}), squareNote = h('span', { class: 'fine' });
  const presenceText = h('span', { id: 'village-presence-status', role: 'status' });
  const join = button('Join the square', () => changePresence(joined ? 'leave' : 'join'), { id: 'village-presence-join' });
  const movement = h('div', { class: 'village-walk', 'aria-label': 'Walk around the square', hidden: true });
  for (const [name, dx, dz] of [['North', 0, -3], ['West', -3, 0], ['East', 3, 0], ['South', 0, 3]]) movement.append(button(name, () => { const self = presence.members.find(p => p.id === presence.selfId); if (self) changePresence('move', { x: Math.max(-16, Math.min(16, self.x + dx)), z: Math.max(-16, Math.min(16, self.z + dz)) }); }, { 'aria-label': `Walk ${name.toLowerCase()}` }));
  controls.replaceChildren(h('div', { class: 'village-square-heading' }, h('div', {}, squareName, squareNote), button('Project & records', open), button('My realm', leaveSquare, { id: 'village-back' })),
    h('div', { class: 'village-presence-controls' }, join, presenceText, movement));
  opener.addEventListener('click', open);

  function renderPane() {
    for (const [name, page] of Object.entries(pages)) page.hidden = pane !== name || !fund();
    for (const b of tabs.querySelectorAll('button')) { b.hidden = outside() && b.dataset.villageTab !== 'project'; b.setAttribute('aria-pressed', String(b.dataset.villageTab === pane)); }
  }
  function renderApproval() {
    const f = fund(), n = parseVillageMinor(amount.value, f?.decimals);
    approvalText.textContent = ` I approve ${n ? villageMoney(n, f) : 'this amount'} toward ${f?.title ?? 'this project'}${f?.rail === 'simulated' ? ' (simulated)' : ' in PayPal sandbox'}.`;
    const unresolved = f?.rail === 'paypal-sandbox' && (ownPaymentsKey !== orderScope(f.id) || Boolean(pendingPayment));
    paymentButton.disabled = busy || !adult() || !n || !approved.checked || unresolved || f?.status !== 'open' || (f?.rail === 'paypal-sandbox' && village?.capabilities?.paypal === false);
    paymentButton.textContent = f?.rail === 'simulated' ? 'Add simulated contribution' : 'Create PayPal sandbox checkout';
  }
  function renderReviewLink() {
    const f = fund(); shareLink.hidden = !f;
    if (!f) return;
    const own = f.canManage === true;
    publishButton.hidden = !adult() || !own;
    publishButton.textContent = f.published ? 'Stop sharing the review link' : 'Publish this project’s review link';
    qr.hidden = reviewLink.hidden = !f.published;
    if (!f.published) { qr.removeAttribute('src'); return; }
    const url = new URL(location.href); url.search = `?villageFund=${encodeURIComponent(f.id)}`; url.hash = '';
    reviewLink.href = url.href; reviewLink.textContent = url.href;
    if (shareLink.open) qr.src = `/api/village/qr?fundId=${encodeURIComponent(f.id)}`;
  }
  function render() {
    if (destroyed) return;
    const state = getState(), nextScope = scope(), changed = scopeKey !== null && nextScope !== scopeKey;
    if (changed) { generation++; presenceEpoch++; paymentReadEpoch++; close(); leaveSquare({ notify: false }); selected = null; village = null; review = null; recoveryFundId = null; assistantGrant = null; watched.clear(); ownPaymentsKey = null; paymentRequest = null; pendingPayment = null; paymentFollowup.replaceChildren(); amount.value = ''; approved.checked = false; draft = null; draftResult.replaceChildren(); answer.textContent = ''; }
    // An example member choice is a local selector over one household's own projection, which names no member, and it
    // redraws without a new state: the state already held is the newly chosen member's too. Any other scope change
    // (a signed-in member or another household) shows nothing until that scope's own new state arrives.
    const exampleMember = changed && !state?.access && !scopeSignedIn && state?.household?.id === scopeHousehold;
    scopeKey = nextScope; scopeHousehold = state?.household?.id; scopeSignedIn = Boolean(state?.access);
    if (stateVillage !== state?.village || exampleMember) { stateVillage = state?.village; village = stateVillage; generation++; }
    const available = Boolean(village?.available); opener.hidden = !available;
    if (!available) { close(); leaveSquare(); return; }
    const choices = [...(village.funds ?? [])];
    if (review?.fund && !choices.some(f => f.id === review.fund.id)) choices.push(review.fund);
    if (recoveryFundId && !review) selected = null;
    else if (!choices.some(f => f.id === selected)) selected = village.selectedFundId ?? choices[0]?.id ?? null;
    const ids = JSON.stringify(choices.map(f => [f.id, f.title]));
    if (selection.dataset.options !== ids) { selection.replaceChildren(...choices.map(f => h('option', { value: f.id }, f.title))); selection.dataset.options = ids; }
    selection.value = selected ?? ''; selection.closest('label').hidden = choices.length < 2;
    neighborhood.textContent = outside() ? `Published project · ${fund()?.organizer?.alias ?? 'Organizer'}` : village.neighborhood?.name ?? 'No neighborhood yet';
    const f = fund(); empty.hidden = Boolean(f); tabs.hidden = !f; treasurer.hidden = !f; shareLink.hidden = !f;
    const owner = getState()?.exchange?.neighborhood?.owner === true, exchange = getState()?.exchange?.available === true;
    begin.hidden = Boolean(f) || Boolean(village.neighborhood) || Boolean(recoveryFundId) || !adult() || !exchange;
    invite.hidden = !f || !adult() || outside() || !owner || !exchange;
    createDetails.hidden = draftDetails.hidden = !adult() || outside() || !village.neighborhood || !owner;
    empty.textContent = recoveryFundId ? 'This project’s review link is no longer available. An existing checkout can still be checked below.' : !village.neighborhood ? 'Start or join an invited neighborhood in Village Exchange, then create a shared project.' : 'A shared project begins with a purpose, an amount and a date.';
    if (!f) { leaveSquare(); renderPane(); return; }
    title.textContent = f.title; rail.textContent = villageRailLabel(f.rail);
    progress.value = Math.max(0, Math.min(10000, f.progress?.basisPoints ?? 0));
    summary.textContent = `${villageMoney(f.progress?.netMinor ?? 0, f)} of ${villageMoney(f.targetMinor, f)} recorded`;
    remaining.textContent = `${villageMoney(f.progress?.remainingMinor ?? f.targetMinor, f)} to go · by ${day(f.deadline)}${f.status === 'closed' ? ' · Closed' : ''}`;
    paymentForm.hidden = !adult() || f.rail === 'pyusd-devnet' || f.status !== 'open'; vault.hidden = f.rail !== 'pyusd-devnet';
    paymentNote.textContent = f.rail === 'simulated' ? 'Practice together with simulated contributions. No money moves.' : f.rail === 'paypal-sandbox' ? 'The recipient is fixed on this fund. Continue only after reviewing the amount and organizer.' : 'Test-token progress is separate from money. These tokens cannot buy the project.';
    vaultAddress.textContent = f.recipient?.address ?? '';
    vaultWatch.disabled = !adult() || !f.canManage || !village.capabilities?.devnet || watched.has(f.id);
    vaultRefresh.disabled = !adult() || !village.capabilities?.devnet || !watched.has(f.id);
    vaultWatch.hidden = vaultRefresh.hidden = outside();
    vaultStatus.textContent = !village.capabilities?.devnet ? 'A devnet connection is not configured. No wallet requests are running.' : watched.has(f.id) ? 'Watching new deposits while this fund is visible. Leave this page to stop its refreshes.' : 'An adult starts the watch before new deposits are checked. Existing wallet history is not credited automatically.';
    if (f.rail === 'paypal-sandbox' && village.capabilities?.paypal === false) paymentNote.textContent = 'PayPal sandbox is not configured. The project is saved, but checkout cannot start yet.';
    shareDetails.hidden = !adult() || outside() || f.status !== 'open';
    treasurer.hidden = outside(); $('village-visit').hidden = outside();
    const key = JSON.stringify([scope(), f.id, f.revision, f.rail]);
    if (key !== paymentKey) { approved.checked = false; paymentKey = key; paymentRequest = null; shareApproved.checked = false; answer.textContent = ''; }
    renderApproval();
    const shares = new Map((f.shares ?? []).map(s => [s.familyReference, s]));
    shareCastle.hidden = !adult(); shareCastle.textContent = village.members?.find(m => m.mine)?.shared ? 'Hide our castle’s appearance' : 'Share our castle’s appearance';
    families.replaceChildren(...(outside() ? [] : village.members ?? []).map(m => { const s = shares.get(m.familyReference); return h('li', {}, h('div', {}, h('strong', {}, m.alias), h('small', {}, m.familyReference)), h('div', {}, h('span', {}, s ? `${villageMoney(s.paidMinor ?? 0, f)} contributed` : 'No contribution recorded'), h('small', {}, s ? `${villageMoney(s.committedMinor ?? 0, f)} voluntary share` : 'No share chosen'))); }));
    records.replaceChildren(...(f.receipts ?? []).map(r => h('li', {}, h('div', {}, h('strong', {}, `${['refund', 'reversal'].includes(r.kind) ? '−' : '+'}${villageMoney(r.amountMinor, f)}`), h('span', {}, r.alias ?? 'Unmatched contribution')), h('small', {}, `${r.reference ?? r.id} · ${r.kind} · ${new Date(r.at).toLocaleString()}`), h('small', {}, villageRailLabel(f.rail)))));
    if (!f.receipts?.length) records.append(h('li', {}, 'No confirmed contribution yet.'));
    if (square) { squareName.textContent = f.title; squareNote.textContent = villageRailLabel(f.rail); getScene()?.setVillage({ fundId: f.id, stage: f.progress?.stage ?? 0, members: village.members ?? [] }); getScene()?.setVillagePresence(presence.members); onFundView(f); }
    renderPane(); renderReviewLink(); renderAssistant();
  }
  async function refresh({ background = false } = {}) {
    const stamp = ++generation, before = scope(), reviewId = review?.fund?.id;
    const res = await api.get('/api/village', { background });
    if (destroyed || stamp !== generation || before !== scope()) return;
    village = res.village ?? res;
    if (reviewId) {
      try { const nextReview = await api.get(`/api/village/review/${encodeURIComponent(reviewId)}`, { background }); if (stamp === generation && before === scope()) review = nextReview; }
      catch (error) { if (stamp === generation && before === scope()) { review = null; recoveryFundId = reviewId; selected = null; say(error.message); } }
    }
    if (!destroyed && stamp === generation && before === scope()) render();
  }
  async function act(path, body, after, done = 'Saved.') {
    if (busy || (!adult() && path !== '/api/village/treasurer')) return null;
    const before = scope(); busy = true; generation++; dialog.setAttribute('aria-busy', 'true'); renderApproval(); say('Working…');
    try {
      const res = await api.post(path, { ...body, ...memberInput() });
      if (before !== scope() || destroyed) return null;
      if (res.state) applyState(res.state); else if (res.village) village = res.village;
      if (res.fundId) selected = res.fundId;
      if (review || (!res.state && !res.village && !['/api/village/draft', '/api/village/treasurer'].includes(path))) await refresh();
      if (before !== scope() || destroyed) return null;
      say(typeof done === 'function' ? done(res) : done); after?.(res); render(); return res;
    } catch (e) { if (before === scope()) say(e.message); return null; }
    finally { busy = false; dialog.removeAttribute('aria-busy'); renderApproval(); }
  }
  async function contribute() {
    const f = fund(), n = parseVillageMinor(amount.value, f?.decimals);
    if (!f || !n || !approved.checked || !adult()) return;
    if (f.rail === 'paypal-sandbox' && (pendingPayment || ownPaymentsKey !== orderScope(f.id))) return say('Check the existing checkout before starting another one.');
    paymentRequest ??= newRequestId();
    const response = await act('/api/village/payments', { fundId: f.id, amountMinor: n, expectedRevision: f.revision, approvalConfirmed: true, requestId: paymentRequest }, res => {
      approved.checked = false;
      if (f.rail === 'simulated') { say('Simulated contribution recorded. The shared project now reflects the latest records.'); paymentRequest = null; return; }
      receivePayment(res, f.id);
      say('Order created. Progress changes only after the server confirms the payment.');
    });
    if (!response && f.rail === 'paypal-sandbox') await loadOwnPayments(f.id);
  }
  function receivePayment(res, id) {
    const result = res.payment ?? res, p = result.contribution ?? result;
    pendingPayment = p.status === 'completed' ? null : { ...p, fundId: id };
    if (!pendingPayment) paymentRequest = null;
    ownPaymentsKey = orderScope(id); renderPendingPayment();
    say(p.status === 'completed' ? 'Payment confirmed by the server. Its contribution is recorded.' : 'This checkout is unfinished. Check it before creating another payment.');
  }
  function renderPendingPayment() {
    paymentFollowup.replaceChildren(); paymentFollowup.hidden = !pendingPayment;
    if (!pendingPayment) return;
    const p = pendingPayment, f = fund();
    paymentFollowup.append(h('h4', {}, 'Your unfinished checkout'), h('p', {}, `${villageMoney(p.amountMinor, { rail: 'paypal-sandbox', decimals: 2 })} toward ${f?.id === p.fundId ? f.title : 'the previously reviewed project'}`),
      h('p', { class: 'fine' }, `Reference ${p.id} · ${p.status}. This is your existing approved amount; a new checkout is blocked.`));
    if (p.recipient?.merchantId) paymentFollowup.append(h('p', { class: 'fine' }, `Sandbox recipient: ${p.recipient.merchantId}`));
    let url; try { url = new URL(p.approveUrl); } catch { /* fail closed */ }
    const safe = url?.origin === 'https://www.sandbox.paypal.com' && !url.username && !url.password;
    if (safe) paymentFollowup.append(h('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer', class: 'village-paypal-link' }, 'Continue to PayPal sandbox'));
    if (!p.providerOrderId || !safe) paymentFollowup.append(button('Recover this checkout', () => act('/api/village/payments/resume', { orderId: p.id }, res => receivePayment(res, p.fundId)), { id: 'village-resume-payment' }));
    if (p.providerOrderId) paymentFollowup.append(button('I approved in PayPal — check payment', () => act('/api/village/payments/capture', { fundId: p.fundId, orderId: p.id }, res => receivePayment(res, p.fundId)), { id: 'village-check-payment' }));
  }
  async function loadOwnPayments(id = recoveryFundId ?? selected) {
    const f = fund(), epoch = ++paymentReadEpoch, before = scope();
    if (!id || !adult() || (f && f.rail !== 'paypal-sandbox')) { pendingPayment = null; ownPaymentsKey = null; renderPendingPayment(); renderApproval(); return; }
    ownPaymentsKey = null; renderApproval(); say('Checking your existing checkouts…');
    try {
      const res = await api.get(`/api/village/payments?fundId=${encodeURIComponent(id)}${memberQuery()}`);
      if (destroyed || epoch !== paymentReadEpoch || before !== scope() || id !== (recoveryFundId ?? selected)) return;
      pendingPayment = (res.payments ?? []).filter(p => ['creating', 'created', 'pending'].includes(p.status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
      ownPaymentsKey = orderScope(id); renderPendingPayment(); renderApproval();
      say(pendingPayment ? 'An unfinished checkout was restored. Review or check that exact payment before starting another.' : 'Ready to review a contribution.');
    } catch (error) { if (epoch === paymentReadEpoch && before === scope()) say(`Existing checkouts could not be checked: ${error.message}`); }
  }
  function choose(id) { leaveSquare(); forgetAssistantToken(); if (id !== review?.fund?.id) review = null; recoveryFundId = null; selected = id; ownPaymentsKey = null; paymentFollowup.replaceChildren(); pendingPayment = null; amount.value = ''; approved.checked = false; paymentRequest = null; pane = 'project'; render(); if (dialog.open) loadOwnPayments(); }
  function open() { if (!village?.available) return; openedBy = document.activeElement; presenceEpoch++; if (joined) changePresence('leave'); if (!dialog.open) dialog.showModal(); heading.focus(); refresh().then(() => loadOwnPayments()).catch(e => say(e.message)); }
  async function openReview(id) {
    if (!id || !village?.available) return;
    const before = scope(); leaveSquare(); pendingPayment = null; ownPaymentsKey = null; paymentFollowup.replaceChildren();
    try { const res = await api.get(`/api/village/review/${encodeURIComponent(id)}`); if (before !== scope() || destroyed) return; review = res; recoveryFundId = null; selected = id; pane = 'project'; render(); open(); }
    catch (error) { if (before !== scope() || destroyed) return; review = null; recoveryFundId = id; selected = null; render(); open(); say(error.message); }
  }
  function close() { forgetAssistantToken(); if (!dialog.open) return; dialog.close(); if (openedBy?.isConnected) openedBy.focus({ preventScroll: true }); }
  // Back from Village Exchange, which was opened over this paper: draw what its change made possible and put focus on the
  // next useful control. The control that opened the Exchange may no longer exist (a neighborhood now does).
  function resume() {
    if (destroyed || !dialog.open) return;
    render();
    const f = fund(), describing = !f && !draftDetails.hidden;
    if (describing) draftDetails.open = true;
    const next = [!begin.hidden && startNeighborhood, describing && draftDetails.querySelector('summary'), f && pane === 'families' && !invite.hidden && inviteFamily, f && pane === 'project' && title].find(Boolean) || heading;
    next.focus(); next.scrollIntoView({ block: 'nearest' });
  }
  function showSquare() { if (!fund() || !getScene()) return; square = true; controls.hidden = false; document.body.dataset.villageSquare = 'true'; onSquare(true); render(); close(); $('village-back').focus({ preventScroll: true }); controls.scrollIntoView({ block: 'nearest' }); }
  function leaveSquare({ notify = true } = {}) { if (!square) return; const held = controls.contains(document.activeElement); presenceEpoch++; if (joined && notify) changePresence('leave'); square = false; joined = false; presence = { members: [], selfId: null }; controls.hidden = true; delete document.body.dataset.villageSquare; getScene()?.setVillage(null); onSquare(false); renderPresence();
    // The square's own controls are gone; focus goes to the button that leads back to this project.
    if (held && !opener.hidden) opener.focus({ preventScroll: true }); }
  function renderPresence() { join.textContent = joined ? 'Leave the square' : 'Join the square'; movement.hidden = !joined; presenceText.textContent = presence.members.length ? `${presence.members.length} ${presence.members.length === 1 ? 'person' : 'people'} here now` : 'No one is in the square right now.'; if (square) getScene()?.setVillagePresence(presence.members); }
  let presenceBusy = false;
  async function changePresence(action, point = {}, background = false) {
    if (presenceBusy || !selected) return;
    const id = selected, before = scope(), identity = memberInput(), epoch = ++presenceEpoch; presenceBusy = true; join.disabled = true;
    try {
      const res = await api.post('/api/village/presence', { action, fundId: id, confirmed: action === 'join', ...point, ...identity }, { background });
      if (epoch !== presenceEpoch || (action !== 'leave' && (!square || dialog.open || document.hidden))) {
        // A join may finish after closing the square. Retire that same identity's presence,
        // without allowing its late response to restore an avatar or heartbeat.
        if (action !== 'leave' && before === scope()) await api.post('/api/village/presence', { action: 'leave', fundId: id, ...identity }, { background: true }).catch(() => {});
        return;
      }
      if (before !== scope() || id !== selected || destroyed) return;
      presence = res.presence ?? res; joined = action !== 'leave' && Boolean(presence.selfId); lastHeartbeat = Date.now(); renderPresence();
    } catch (e) { if (before === scope() && epoch === presenceEpoch) { joined = false; presence = { members: [], selfId: null }; renderPresence(); presenceText.textContent = e.message; } }
    finally { presenceBusy = false; join.disabled = false; }
  }
  async function tick() {
    if (destroyed || document.hidden || busy || polling || (!dialog.open && !square)) return;
    polling = true;
    try {
      const now = Date.now();
      if (now - lastRead > 5000) { lastRead = now; await refresh({ background: true }); }
      if (square && !dialog.open && selected && now - lastPresenceRead > 3000) {
        lastPresenceRead = now; const id = selected, before = scope(), epoch = presenceEpoch;
        const res = await api.get(`/api/village/presence?fundId=${encodeURIComponent(id)}${memberQuery()}`, { background: true });
        if (square && !dialog.open && epoch === presenceEpoch && id === selected && before === scope()) { presence = res.presence ?? res; if (joined && !presence.members.some(p => p.id === presence.selfId)) joined = false; renderPresence(); }
        if (joined && now - lastHeartbeat > 10000) { const self = presence.members.find(p => p.id === presence.selfId); if (self) await changePresence('move', { x: self.x, z: self.z }, true); }
      }
      if (adult() && village?.capabilities?.devnet && watched.has(selected) && fund()?.rail === 'pyusd-devnet' && now - lastVaultRead > 10000) {
        lastVaultRead = now; const id = selected, before = scope();
        const res = await api.post('/api/village/vault/refresh', { fundId: id, ...memberInput() }, { background: true });
        if (before === scope() && id === selected) { if (res.state) applyState(res.state); else if (res.village) { village = res.village; render(); } }
      }
    } catch (e) { if (dialog.open) say(e.message); if (square) { joined = false; presence = { members: [], selfId: null }; renderPresence(); presenceText.textContent = 'Connection paused. People will reappear after a fresh check.'; } }
    finally { polling = false; }
  }
  const timer = setInterval(tick, 1000);
  const hidden = () => { if (document.hidden) { presenceEpoch++; if (joined) changePresence('leave'); joined = false; presence = { members: [], selfId: null }; renderPresence(); } else tick(); };
  document.addEventListener('visibilitychange', hidden);
  return { render, open, openReview, close, resume, leaveSquare, select: choose, activeFund: () => square ? fund() : null,
    dispose() { destroyed = true; generation++; clearInterval(timer); document.removeEventListener('visibilitychange', hidden); close(); leaveSquare(); },
    debug: () => ({ selected, square, joined, people: presence.members.length }),
  };
}
