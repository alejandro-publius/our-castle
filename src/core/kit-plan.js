// The complete-kit solver's contract, on the JavaScript side (the native solver is solver/, in Rust):
// - checkSolverRequest: the bounded request both solvers accept;
// - referenceSolve: an independent, deliberately simple exhaustive solver. It is the oracle the Rust solver is tested
//   against, and the solver a checkout without a Rust build uses;
// - verifySolverAnswer: what the server checks in every answer before using it, whichever solver gave it.
// A request carries whole cents, counts, milligrams and opaque indices only: no product, family, member or money record.
// Kits are complete (one listing per line still to get) and bought in whole listings: ceil(need / perListing) of them.

export const KIT_PLAN_LIMITS = Object.freeze({
  maxLines: 8, maxOptions: 3, maxNeed: 20, maxPerListing: 100, maxListingCents: 10_000_000, maxCeilingCents: 10_000_000,
  maxWeightMg: 1_000_000_000, maxRetailer: 23, maxSample: 8,
});
const L = KIT_PLAN_LIMITS;

export class KitPlanError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (message) => { throw new KitPlanError('invalid_request', message); };
const whole = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));

/** The request both solvers accept, or a KitPlanError saying why not. Same bounds as the Rust solver. */
export function checkSolverRequest(request) {
  if (!exactKeys(request, ['version', 'ceilingCents', 'lines', 'sampleSize']) || request.version !== 1) refuse('The request is not a version 1 kit request.');
  if (!whole(request.ceilingCents, 0, L.maxCeilingCents)) refuse('The ceiling is out of range.');
  if (!whole(request.sampleSize, 0, L.maxSample)) refuse('The sample size is out of range.');
  if (!Array.isArray(request.lines) || request.lines.length < 1) refuse('There must be at least one line.');
  if (request.lines.length > L.maxLines) throw new KitPlanError('too_large', `At most ${L.maxLines} lines can be compared.`);
  for (const line of request.lines) {
    if (!exactKeys(line, ['need', 'options', 'current', 'pinned']) || !whole(line.need, 1, L.maxNeed)) refuse('A line is malformed.');
    if (!Array.isArray(line.options) || line.options.length < 1) refuse('Every line needs at least one option.');
    if (line.options.length > L.maxOptions) throw new KitPlanError('too_large', `At most ${L.maxOptions} options per line can be compared.`);
    for (const o of line.options) {
      if (!exactKeys(o, ['listingCents', 'perListing', 'weightMg', 'retailer']) || !whole(o.listingCents, 1, L.maxListingCents)
        || !whole(o.perListing, 1, L.maxPerListing) || !(o.weightMg === null || whole(o.weightMg, 1, L.maxWeightMg)) || !whole(o.retailer, 0, L.maxRetailer)) refuse('An option is malformed.');
    }
    if (!(line.current === null || whole(line.current, 0, line.options.length - 1))) refuse('A current option is not one of the line’s options.');
    if (typeof line.pinned !== 'boolean' || (line.pinned && line.current === null)) refuse('A kept line needs its current option.');
  }
  return request;
}

/** Whole listings that cover `need` items when one listing gives `perListing` of them. */
export const listingsFor = (need, perListing) => Math.ceil(need / perListing);

/** What one line costs with one option: listings bought, items they give, the surplus, listed cost and listed weight. */
export function lineCost(need, option) {
  const listings = listingsFor(need, option.perListing);
  const bought = listings * option.perListing;
  return { listings, bought, surplus: bought - need, cents: listings * option.listingCents, weightMg: option.weightMg === null ? null : listings * option.weightMg };
}

const allowedOf = (request) => request.lines.map((line) => (line.pinned ? [line.current] : line.options.map((_, i) => i)));
const comparableOf = (request, allowed) => allowed.every((set, i) => set.every((o) => request.lines[i].options[o].weightMg !== null));

/** One complete kit's figures, from the request alone. */
export function evaluateKit(request, choice) {
  let totalCents = 0, weightMg = 0, changes = 0, complete = true;
  const retailers = new Set();
  request.lines.forEach((line, i) => {
    const cost = lineCost(line.need, line.options[choice[i]]);
    totalCents += cost.cents;
    weightMg = weightMg === null || cost.weightMg === null ? null : weightMg + cost.weightMg;
    retailers.add(line.options[choice[i]].retailer);
    if (line.current === null) complete = false;
    else if (line.current !== choice[i]) changes += 1;
  });
  if (!Number.isSafeInteger(totalCents) || !(weightMg === null || Number.isSafeInteger(weightMg))) throw new KitPlanError('overflow', 'A total went beyond the integer range.');
  return { choice: [...choice], totalCents, weightMg, retailers: retailers.size, changes: complete ? changes : null, fits: totalCents <= request.ceilingCents };
}

// The same orders as the Rust solver: each objective, then fixed tie-breaks ending in the choice itself.
const UNKNOWN = Number.MAX_SAFE_INTEGER;
const choiceOrder = (a, b) => { for (let i = 0; i < a.choice.length; i++) if (a.choice[i] !== b.choice[i]) return a.choice[i] - b.choice[i]; return 0; };
const weightKey = (k, comparable) => (comparable ? k.weightMg ?? UNKNOWN : 0);
export const orders = {
  total: (a, b, comparable) => a.totalCents - b.totalCents || a.retailers - b.retailers || weightKey(a, comparable) - weightKey(b, comparable) || choiceOrder(a, b),
  weight: (a, b) => weightKey(a, true) - weightKey(b, true) || a.totalCents - b.totalCents || a.retailers - b.retailers || choiceOrder(a, b),
  retailers: (a, b, comparable) => a.retailers - b.retailers || a.totalCents - b.totalCents || weightKey(a, comparable) - weightKey(b, comparable) || choiceOrder(a, b),
  changes: (a, b, comparable) => (a.changes ?? UNKNOWN) - (b.changes ?? UNKNOWN) || a.totalCents - b.totalCents || a.retailers - b.retailers
    || weightKey(a, comparable) - weightKey(b, comparable) || choiceOrder(a, b),
};

function* everyKit(allowed, prefix = []) {
  if (prefix.length === allowed.length) { yield prefix; return; }
  for (const option of allowed[prefix.length]) yield* everyKit(allowed, [...prefix, option]);
}
const best = (kits, order) => kits.reduce((winner, kit) => (winner === null || order(kit, winner) < 0 ? kit : winner), null);

/**
 * The reference solver: list every complete kit, then take each objective's best by sorting. Written independently of
 * the Rust solver's odometer and running bests, and kept simple on purpose. Same answer shape as the Rust solver.
 */
export function referenceSolve(request) {
  checkSolverRequest(request);
  const allowed = allowedOf(request);
  const comparable = comparableOf(request, allowed);
  const kits = [...everyKit(allowed)].map((choice) => evaluateKit(request, choice));
  const fitting = kits.filter((k) => k.fits);
  const complete = request.lines.every((line) => line.current !== null);
  return {
    version: 1,
    combinations: kits.length,
    feasible: fitting.length,
    weightComparable: comparable,
    lowestTotal: best(fitting, (a, b) => orders.total(a, b, comparable)),
    lowerWeight: comparable ? best(fitting, orders.weight) : null,
    fewestRetailers: best(fitting, (a, b) => orders.retailers(a, b, comparable)),
    smallestChange: complete ? best(fitting, (a, b) => orders.changes(a, b, comparable)) : null,
    cheapest: best(kits, (a, b) => orders.total(a, b, comparable)),
    current: complete ? evaluateKit(request, request.lines.map((line) => line.current)) : null,
    sample: [...fitting].sort((a, b) => orders.total(a, b, comparable)).slice(0, request.sampleSize),
  };
}

const ANSWER_KEYS = ['version', 'combinations', 'feasible', 'weightComparable', 'lowestTotal', 'lowerWeight', 'fewestRetailers', 'smallestChange', 'cheapest', 'current', 'sample'];
const KIT_KEYS = ['choice', 'totalCents', 'weightMg', 'retailers', 'changes', 'fits'];
const mismatch = (what) => { throw new KitPlanError('solver_mismatch', `The solver's answer does not check out: ${what}.`); };

/**
 * Check an answer against the request it answers, whichever solver gave it. Every kit is recomputed here from the request:
 * it must pick one allowed listing per line (kept lines unchanged) and report exactly these figures. Each objective's kit
 * must fit, the weight objective needs comparable weights, the sample must be sorted, distinct and fitting, and the
 * counts must agree. An answer that fails any check is refused as a whole; nothing from it is shown.
 */
export function verifySolverAnswer(request, answer) {
  checkSolverRequest(request);
  if (answer?.error) throw new KitPlanError('solver_refused', `The solver refused the request (${String(answer.error.code ?? 'unknown')}).`);
  if (!exactKeys(answer, ANSWER_KEYS) || answer.version !== 1) mismatch('it is not a version 1 answer');
  const allowed = allowedOf(request);
  const comparable = comparableOf(request, allowed);
  const complete = request.lines.every((line) => line.current !== null);
  const kitOf = (raw, what) => {
    if (!exactKeys(raw, KIT_KEYS) || !Array.isArray(raw.choice) || raw.choice.length !== request.lines.length) mismatch(`${what} is malformed`);
    raw.choice.forEach((option, i) => { if (!allowed[i].includes(option)) mismatch(`${what} picks a listing that is not allowed for line ${i + 1}`); });
    const kit = evaluateKit(request, raw.choice);
    for (const key of ['totalCents', 'weightMg', 'retailers', 'changes', 'fits']) if (raw[key] !== kit[key]) mismatch(`${what} reports another ${key}`);
    return kit;
  };
  const optional = (raw, what, { fits = true } = {}) => {
    if (raw === null) return null;
    const kit = kitOf(raw, what);
    if (fits && !kit.fits) mismatch(`${what} does not fit`);
    return kit;
  };
  const combinations = allowed.reduce((n, set) => n * set.length, 1);
  if (answer.combinations !== combinations) mismatch('the number of kits');
  if (!whole(answer.feasible, 0, combinations)) mismatch('the number of kits that fit');
  if (answer.weightComparable !== comparable) mismatch('whether weights are comparable');
  const out = {
    combinations, feasible: answer.feasible, weightComparable: comparable,
    lowestTotal: optional(answer.lowestTotal, 'the lowest total'),
    lowerWeight: optional(answer.lowerWeight, 'the lower weight'),
    fewestRetailers: optional(answer.fewestRetailers, 'the fewest retailers'),
    smallestChange: optional(answer.smallestChange, 'the smallest change'),
    cheapest: answer.cheapest === null ? mismatch('the cheapest kit is missing') : kitOf(answer.cheapest, 'the cheapest kit'),
    current: optional(answer.current, 'the current kit', { fits: false }),
  };
  if ((out.feasible === 0) !== (out.lowestTotal === null) || (out.feasible === 0) !== (out.fewestRetailers === null)) mismatch('whether anything fits');
  if (out.lowerWeight !== null && !comparable) mismatch('a weight winner without comparable weights');
  if (comparable && (out.feasible === 0) !== (out.lowerWeight === null)) mismatch('the weight winner');
  if (complete ? (out.current === null || (out.feasible > 0) !== (out.smallestChange !== null)) : (out.current !== null || out.smallestChange !== null)) mismatch('the current selection');
  if (complete && out.current.choice.some((option, i) => option !== request.lines[i].current)) mismatch('the current kit is not the current selection');
  if (out.lowestTotal && out.cheapest.totalCents > out.lowestTotal.totalCents) mismatch('the cheapest kit costs more than the lowest total');
  if (!Array.isArray(answer.sample) || answer.sample.length > Math.min(request.sampleSize, out.feasible)) mismatch('the sample size');
  out.sample = answer.sample.map((raw, i) => optional(raw, `sample kit ${i + 1}`));
  out.sample.forEach((kit, i) => { if (i > 0 && orders.total(out.sample[i - 1], kit, comparable) >= 0) mismatch('the sample order'); });
  if (out.sample.length && orders.total(out.sample[0], out.lowestTotal, comparable) !== 0) mismatch('the sample does not start with the lowest total');
  if (out.sample.length < Math.min(request.sampleSize, out.feasible)) mismatch('the sample is short');
  return out;
}

/** Listed weight in words: "4.2 kg" or "850 g", rounded for reading only. */
export function weightText(mg) {
  if (!Number.isSafeInteger(mg)) return null;
  return mg >= 1_000_000 ? `${(mg / 1_000_000).toFixed(1)} kg` : `${Math.max(1, Math.round(mg / 1000))} g`;
}
