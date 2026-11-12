// Who does the work in each journal chapter, in this session. One short line per chapter names the sponsor's tool, says
// whether it is at work here or stood in for, and names where that maker's sign stands in the woodland: three boards in
// districts (src/world/sponsor-signs.js) and PayPal's wordmark on its hillside (src/world/paypal-hillside.js). A line
// never claims a provider that this session does not use. Shared and dependency-free, so it can be tested in Node.
import { catalogueOf } from './catalogue.js';

/**
 * @param state the server's /api/state view
 * @param page what the page itself loaded: `grid` is the ledger's mode ('ag-grid', 'fallback' or 'loading'), `studio`
 *   whether the next-area plaque is drawn by AG Studio
 * @returns {{ plan: Mark, give: Mark, ledger: Mark|null }} each Mark is { text, signs }, and each sign is
 *   { id, label, district }: `district` is null for PayPal's sign, which stands outside every district
 */
export function makerMarks(state, { grid = 'loading', studio = false } = {}) {
  const modes = state?.modes ?? {}, catalogue = catalogueOf(state);
  const market = modes.merchant?.mode === 'live'
    ? 'Market Town’s listings come from Channel3, and the kit planner compares them within your family’s limit.'
    : catalogue.sample
      ? 'In this example an invented catalogue stands in for Channel3 at Market Town.'
      : 'Market Town is not connected in this session. With a key, its listings come from Channel3.';
  const planner = modes.ai?.mode === 'live'
    ? 'Schedules are proposed by Claude and kept only if they match the server’s own arithmetic.'
    : 'Schedules here come from built-in rules. With a key, Claude proposes them and the server checks the arithmetic.';
  const sdk = 'PayPal’s Server SDK, which APIMatic generates';
  const paying = modes.payments?.mode === 'sandbox'
    ? `Contributions go to the PayPal sandbox with test money, through ${sdk}.`
    : `Simulated in this example: no PayPal call is made. With keys, the same step goes to the PayPal sandbox through ${sdk}.`;
  return {
    plan: { text: `${market} ${planner}`, signs: [{ id: 'channel3', label: 'Channel3’s sign at Market Town', district: 'market' }] },
    give: { text: paying, signs: [{ id: 'paypal', label: 'PayPal’s sign on the hillside', district: null }, { id: 'apimatic', label: 'APIMatic’s sign at the Starfall Observatory', district: 'wizard' }] },
    // Said only once the grid has really loaded: the plain-table fallback is not AG Grid.
    ledger: grid === 'ag-grid'
      ? { text: `These records are kept in AG Grid${studio ? ', and the next-area plaque below is an AG Studio widget' : ''}.`, signs: [{ id: 'ag-grid', label: 'AG Grid’s sign at the Stone Keep', district: 'keep' }] }
      : null,
  };
}
