// Moss, the castle keeper: a short, authored and optional tour of the example demo. Opened from Journal → House
// ("Meet the Keeper") or with ?tour=1 on a fresh demo, and offered only while payments are simulated.
//
// The keeper only shows things: a journal tab, the compass or the Sound button, through navigation the page injects.
// It never presses, fills or ticks a control, never calls the server or a provider, and never changes a record or
// a saved preference, so drafts, a selected receipt and an amount approval stay exactly as the family left them.
const PORTRAIT = 'assets/member-avatars/wizard.png'; // an original bundled portrait, shown as is

export const KEEPER_STEPS = Object.freeze([
  { id: 'welcome', text: 'Welcome, traveler. I’m Moss, keeper of this castle. Every house here begins with a shared goal. Let me show you around.' },
  { id: 'house', tab: 'house', cue: '#tab-house', text: 'Your house begins here in the journal. Give it a name and a crest; its banner flies over the realm once you raise it.' },
  { id: 'plan', tab: 'plan', cue: '#tab-plan', text: 'In Plan, the house sets a weekly pace toward its goal. Try ideas freely; nothing is kept until you choose to save a plan.' },
  { id: 'give', tab: 'give', cue: '#tab-give', text: 'Every contribution needs an adult’s approval. Payments here are simulated, so no money moves, and nothing happens until an adult approves.' },
  { id: 'ledger', tab: 'ledger', cue: '#tab-ledger', text: 'The Treasury keeps each record the house makes. Choose a receipt to read what was recorded and when.' },
  { id: 'compass', cue: '#map-explore', text: 'The compass on the map lets you wander the realm freely. Districts not yet opened show what the house is working toward.' },
  { id: 'sound', cue: '#sound-toggle', text: 'If you’d like music, the Sound button plays a quiet tune. It stays off unless you turn it on.' },
  { id: 'finish', text: 'That’s the castle. Wander at your own pace; you’ll find me under House in the journal whenever you’d like the tour again.' },
]);

const PHONE = '(max-width: 800px)';
const visible = (el) => Boolean(el && el.isConnected && el.getClientRects().length > 0);

/**
 * @param {object} page what the page lets the keeper do
 * @param {() => boolean} page.available whether payments are simulated (the only mode the tour is offered in)
 * @param {() => string} page.currentTab the journal tab now shown
 * @param {() => boolean} page.journalOpen whether the journal is open
 * @param {(tab: string) => void} page.showTab show a journal tab without moving focus or saving a preference
 * @param {() => void} page.closeJournal close the journal without saving a preference
 * @param {boolean} [page.autoStart] open at once (?tour=1)
 */
export function createKeeper({ available, currentTab, journalOpen, showTab, closeJournal, autoStart = false, doc = document, win = window }) {
  const entry = doc.getElementById('keeper-entry');
  const opener = doc.getElementById('keeper-open');
  const off = { open() {}, close() {}, get isOpen() { return false; } };
  if (!available()) { if (entry) entry.hidden = true; return off; }
  if (entry) entry.hidden = false;

  let guide = null, index = 0, cue = null, returnTo = null, start = null, shownTab = null;
  let watchDialogs = null, watchSize = null;
  const reduced = () => win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => guide.querySelector(`#${id}`);

  function build() {
    const box = doc.createElement('section');
    box.className = 'keeper';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-labelledby', 'keeper-name keeper-role');
    box.setAttribute('aria-describedby', 'keeper-text');
    box.innerHTML = `
      <img class="keeper-portrait" src="${PORTRAIT}" alt="" width="96" height="96" decoding="async">
      <div class="keeper-body">
        <p class="keeper-who"><span class="keeper-name" id="keeper-name">Moss</span> <span class="keeper-role" id="keeper-role">castle keeper</span><span class="keeper-step" id="keeper-step"></span></p>
        <p class="keeper-text" id="keeper-text" aria-live="polite"></p>
        <div class="keeper-actions">
          <button type="button" class="keeper-skip" id="keeper-skip">Skip</button>
          <button type="button" class="keeper-back" id="keeper-back">Back</button>
          <button type="button" class="keeper-next" id="keeper-next">Next</button>
        </div>
      </div>`;
    box.querySelector('#keeper-skip').addEventListener('click', () => close());
    box.querySelector('#keeper-back').addEventListener('click', () => go(index - 1));
    box.querySelector('#keeper-next').addEventListener('click', () => (index === KEEPER_STEPS.length - 1 ? close() : go(index + 1)));
    // Only Escape is the keeper's own key, and only from inside it. Enter and Space stay with the focused button.
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    return box;
  }

  // One cue at a time: a dashed outline on the control the step is about. Nothing is pressed.
  function setCue(selector) {
    cue?.classList.remove('keeper-cue');
    cue = selector ? doc.querySelector(selector) : null;
    cue?.classList.add('keeper-cue');
  }

  function render() {
    const step = KEEPER_STEPS[index];
    const last = index === KEEPER_STEPS.length - 1;
    const focused = doc.activeElement;
    $('keeper-step').textContent = `${index + 1} of ${KEEPER_STEPS.length}`;
    const text = $('keeper-text');
    text.textContent = step.text;
    if (!reduced()) { text.classList.remove('keeper-turn'); void text.offsetWidth; text.classList.add('keeper-turn'); }
    $('keeper-back').hidden = index === 0;
    $('keeper-skip').hidden = last;
    $('keeper-next').textContent = last ? 'Done' : 'Next';
    // A button that just hid itself (Back on the first step, Skip on the last) hands focus to Next, not to the page.
    if (focused && guide.contains(focused) && focused.hidden) $('keeper-next').focus({ preventScroll: true });
    if (step.tab) { showTab(step.tab); shownTab = step.tab; }
    setCue(step.cue);
    // On a phone the journal follows the world in one column, so bring what the step is about into view, above the
    // docked keeper.
    if (win.matchMedia(PHONE).matches) {
      const target = step.tab ? doc.getElementById('tabs') : cue;
      target?.scrollIntoView({ block: step.tab ? 'start' : 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
  }

  function go(next) {
    if (next < 0 || next >= KEEPER_STEPS.length) return;
    index = next;
    render();
  }

  // Existing modal cards (a deed, the merchant, family sign-in) put the keeper aside; it comes back when they close,
  // without taking focus from what the family is doing.
  function syncPaused() {
    if (guide) guide.hidden = Boolean(doc.querySelector('dialog[open]'));
  }

  // On a phone the keeper is docked to the bottom of the screen: reserve its measured height so every field,
  // approval and button can still scroll above it. On desktop it sits over the map, above the map's own footer.
  function measure() {
    if (!guide) return;
    doc.documentElement.style.setProperty('--keeper-space', `${Math.ceil(guide.getBoundingClientRect().height)}px`);
    const foot = doc.querySelector('.board-foot');
    const height = foot ? foot.getBoundingClientRect().height : 0;
    guide.style.setProperty('--keeper-lift', `${height > 0 ? Math.ceil(height) + 24 : 14}px`);
  }

  function open(from = null) {
    if (guide) { if (!guide.hidden) $('keeper-next').focus(); return; }
    returnTo = from;
    start = { tab: currentTab(), journal: journalOpen() };
    shownTab = null;
    index = 0;
    guide = build();
    (doc.querySelector('.board-shell') ?? doc.body).append(guide);
    doc.documentElement.dataset.keeper = 'open';
    watchDialogs = new MutationObserver(syncPaused);
    for (const dialog of doc.querySelectorAll('dialog')) watchDialogs.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    watchSize = new ResizeObserver(measure);
    watchSize.observe(guide);
    const foot = doc.querySelector('.board-foot');
    if (foot) watchSize.observe(foot);
    render();
    syncPaused();
    measure();
    if (!guide.hidden) $('keeper-next').focus({ preventScroll: true });
  }

  function close() {
    if (!guide) return;
    const hadFocus = guide.contains(doc.activeElement) || doc.activeElement === doc.body || !doc.activeElement;
    setCue(null);
    watchDialogs?.disconnect();
    watchSize?.disconnect();
    guide.remove();
    guide = null;
    delete doc.documentElement.dataset.keeper;
    doc.documentElement.style.removeProperty('--keeper-space');
    // Put the journal back as it was, unless the family moved somewhere themselves during the tour.
    if (!shownTab || currentTab() === shownTab) {
      if (start.journal) showTab(start.tab); else closeJournal();
    }
    if (!hadFocus) return;
    // Focus goes back to whatever opened the keeper (or, after ?tour=1, to where it can be opened again).
    const target = [returnTo, opener].find(visible)
      ?? (journalOpen() ? doc.getElementById(`tab-${currentTab()}`) : doc.getElementById('journal-toggle'));
    target?.focus();
  }

  opener?.addEventListener('click', () => open(opener));
  if (autoStart) open(null);
  return { open, close, get isOpen() { return Boolean(guide); } };
}
