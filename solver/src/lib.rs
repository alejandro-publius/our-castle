//! Exact complete-kit selection over a small, disclosed candidate pool (Our Castle's kit planner).
//!
//! A kit has up to eight lines still to get. Each line has a count still needed and up to three listings an adult
//! shortlisted for it. A complete kit picks exactly one listing per line. Buying it takes `ceil(need / per_listing)`
//! whole listings, so its listed cost is that many times the listing price, and its listed weight is that many times the
//! listing weight. The solver enumerates every complete kit (at most 3^8 = 6561), checks each against the planning
//! ceiling it is given, and reports:
//! - the lowest listed total that fits;
//! - the lowest listed weight of the new items that fits, only when every option in the pool reports a weight;
//! - the fewest distinct retailers that fit, counting each kit's actual set of retailers (never a partial count);
//! - the fewest switched lines from the current selection that fit, with kept ("pinned") lines held fixed;
//! - the cheapest complete kit whether or not it fits, so a shortfall can be stated honestly;
//! - the current selection's own figures;
//! - a few of the lowest-total kits that fit (an already-feasible set that a preference may order).
//!
//! Pure computation with checked integer arithmetic. No network, files, clock, randomness, environment or persistence.
//! It knows no product, family, money or identity: whole cents, counts, milligrams and opaque indices only.
#![forbid(unsafe_code)]

use serde_json::{Map, Value, json};
use std::cmp::Ordering;

pub const VERSION: u64 = 1;
pub const MAX_LINES: usize = 8;
pub const MAX_OPTIONS: usize = 3;
pub const MAX_NEED: u64 = 20;
pub const MAX_PER_LISTING: u64 = 100;
pub const MAX_LISTING_CENTS: u64 = 10_000_000;
pub const MAX_CEILING_CENTS: u64 = 10_000_000;
pub const MAX_WEIGHT_MG: u64 = 1_000_000_000;
/// Retailer indices are 0..=23: eight lines of three options can name at most 24 distinct retailers.
pub const MAX_RETAILER: u64 = 23;
pub const MAX_SAMPLE: usize = 8;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SolveError {
    pub code: &'static str,
    pub message: String,
}

fn invalid(message: impl Into<String>) -> SolveError {
    SolveError { code: "invalid_request", message: message.into() }
}
fn too_large(message: impl Into<String>) -> SolveError {
    SolveError { code: "too_large", message: message.into() }
}
fn overflow() -> SolveError {
    SolveError { code: "overflow", message: "A total went beyond the integer range.".into() }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listing {
    pub listing_cents: u64,
    pub per_listing: u64,
    pub weight_mg: Option<u64>,
    pub retailer: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub need: u64,
    pub options: Vec<Listing>,
    pub current: Option<usize>,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub ceiling_cents: u64,
    pub lines: Vec<Line>,
    pub sample_size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kit {
    pub choice: Vec<usize>,
    pub total_cents: u64,
    pub weight_mg: Option<u64>,
    pub retailers: u32,
    pub changes: Option<u32>,
    pub fits: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub combinations: u64,
    pub feasible: u64,
    pub weight_comparable: bool,
    pub lowest_total: Option<Kit>,
    pub lower_weight: Option<Kit>,
    pub fewest_retailers: Option<Kit>,
    pub smallest_change: Option<Kit>,
    pub cheapest: Kit,
    pub current: Option<Kit>,
    pub sample: Vec<Kit>,
}

// ---- Reading the request: every field required, no unknown field, whole numbers within explicit bounds ----

fn object<'a>(value: &'a Value, what: &str, keys: &[&str]) -> Result<&'a Map<String, Value>, SolveError> {
    let map = value.as_object().ok_or_else(|| invalid(format!("{what} must be an object.")))?;
    if map.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(invalid(format!("{what} has an unknown field.")));
    }
    if let Some(missing) = keys.iter().find(|key| !map.contains_key(**key)) {
        return Err(invalid(format!("{what} is missing {missing}.")));
    }
    Ok(map)
}

fn whole(map: &Map<String, Value>, key: &str, min: u64, max: u64) -> Result<u64, SolveError> {
    let number = map.get(key).and_then(Value::as_u64).ok_or_else(|| invalid(format!("{key} must be a whole number.")))?;
    if number < min || number > max {
        return Err(invalid(format!("{key} is out of range.")));
    }
    Ok(number)
}

pub fn parse_request(value: &Value) -> Result<Request, SolveError> {
    let map = object(value, "The request", &["version", "ceilingCents", "lines", "sampleSize"])?;
    whole(map, "version", VERSION, VERSION)?;
    let ceiling_cents = whole(map, "ceilingCents", 0, MAX_CEILING_CENTS)?;
    let sample_size = whole(map, "sampleSize", 0, MAX_SAMPLE as u64)? as usize;
    let raw_lines = map.get("lines").and_then(Value::as_array).ok_or_else(|| invalid("lines must be a list."))?;
    if raw_lines.is_empty() {
        return Err(invalid("There must be at least one line."));
    }
    if raw_lines.len() > MAX_LINES {
        return Err(too_large(format!("At most {MAX_LINES} lines can be compared.")));
    }
    let mut lines = Vec::with_capacity(raw_lines.len());
    for raw in raw_lines {
        let line = object(raw, "A line", &["need", "options", "current", "pinned"])?;
        let need = whole(line, "need", 1, MAX_NEED)?;
        let raw_options = line.get("options").and_then(Value::as_array).ok_or_else(|| invalid("options must be a list."))?;
        if raw_options.is_empty() {
            return Err(invalid("Every line needs at least one option."));
        }
        if raw_options.len() > MAX_OPTIONS {
            return Err(too_large(format!("At most {MAX_OPTIONS} options per line can be compared.")));
        }
        let mut options = Vec::with_capacity(raw_options.len());
        for raw_option in raw_options {
            let option = object(raw_option, "An option", &["listingCents", "perListing", "weightMg", "retailer"])?;
            let weight_mg = match option.get("weightMg") {
                Some(Value::Null) => None,
                _ => Some(whole(option, "weightMg", 1, MAX_WEIGHT_MG)?),
            };
            options.push(Listing {
                listing_cents: whole(option, "listingCents", 1, MAX_LISTING_CENTS)?,
                per_listing: whole(option, "perListing", 1, MAX_PER_LISTING)?,
                weight_mg,
                retailer: whole(option, "retailer", 0, MAX_RETAILER)? as u32,
            });
        }
        let current = match line.get("current") {
            Some(Value::Null) => None,
            _ => Some(whole(line, "current", 0, (options.len() - 1) as u64)? as usize),
        };
        let pinned = line.get("pinned").and_then(Value::as_bool).ok_or_else(|| invalid("pinned must be true or false."))?;
        if pinned && current.is_none() {
            return Err(invalid("A kept line needs its current option."));
        }
        lines.push(Line { need, options, current, pinned });
    }
    Ok(Request { ceiling_cents, lines, sample_size })
}

// ---- Arithmetic: whole listings, checked products and sums ----

/// Whole listings needed to cover `need` items when one listing gives `per_listing` of them (rounded up).
pub fn listings(need: u64, per_listing: u64) -> Result<u64, SolveError> {
    if per_listing == 0 {
        return Err(invalid("perListing must be at least 1."));
    }
    let padded = need.checked_add(per_listing - 1).ok_or_else(overflow)?;
    Ok(padded / per_listing)
}

struct Cost {
    cents: u64,
    weight_mg: Option<u64>,
}

fn costs_of(request: &Request) -> Result<Vec<Vec<Cost>>, SolveError> {
    request
        .lines
        .iter()
        .map(|line| {
            line.options
                .iter()
                .map(|option| {
                    let count = listings(line.need, option.per_listing)?;
                    let cents = count.checked_mul(option.listing_cents).ok_or_else(overflow)?;
                    let weight_mg = match option.weight_mg {
                        Some(weight) => Some(count.checked_mul(weight).ok_or_else(overflow)?),
                        None => None,
                    };
                    Ok(Cost { cents, weight_mg })
                })
                .collect()
        })
        .collect()
}

fn evaluate(request: &Request, costs: &[Vec<Cost>], choice: &[usize]) -> Result<Kit, SolveError> {
    let mut total: u64 = 0;
    let mut weight: Option<u64> = Some(0);
    let mut retailers: u32 = 0;
    let mut changes: u32 = 0;
    let mut complete_current = true;
    for (index, &option) in choice.iter().enumerate() {
        let line = &request.lines[index];
        let cost = &costs[index][option];
        total = total.checked_add(cost.cents).ok_or_else(overflow)?;
        weight = match (weight, cost.weight_mg) {
            (Some(sum), Some(more)) => Some(sum.checked_add(more).ok_or_else(overflow)?),
            _ => None,
        };
        retailers |= 1u32 << line.options[option].retailer;
        match line.current {
            Some(current) if current != option => changes += 1,
            Some(_) => {}
            None => complete_current = false,
        }
    }
    Ok(Kit {
        choice: choice.to_vec(),
        total_cents: total,
        weight_mg: weight,
        retailers: retailers.count_ones(),
        changes: complete_current.then_some(changes),
        fits: total <= request.ceiling_cents,
    })
}

// ---- Orders: each objective, then fixed tie-breaks ending in the choice itself, so every answer is deterministic ----

fn weight_key(kit: &Kit, comparable: bool) -> u64 {
    if comparable { kit.weight_mg.unwrap_or(u64::MAX) } else { 0 }
}

pub fn by_total(a: &Kit, b: &Kit, comparable: bool) -> Ordering {
    a.total_cents
        .cmp(&b.total_cents)
        .then(a.retailers.cmp(&b.retailers))
        .then(weight_key(a, comparable).cmp(&weight_key(b, comparable)))
        .then(a.choice.cmp(&b.choice))
}

pub fn by_weight(a: &Kit, b: &Kit) -> Ordering {
    weight_key(a, true)
        .cmp(&weight_key(b, true))
        .then(a.total_cents.cmp(&b.total_cents))
        .then(a.retailers.cmp(&b.retailers))
        .then(a.choice.cmp(&b.choice))
}

pub fn by_retailers(a: &Kit, b: &Kit, comparable: bool) -> Ordering {
    a.retailers
        .cmp(&b.retailers)
        .then(a.total_cents.cmp(&b.total_cents))
        .then(weight_key(a, comparable).cmp(&weight_key(b, comparable)))
        .then(a.choice.cmp(&b.choice))
}

pub fn by_changes(a: &Kit, b: &Kit, comparable: bool) -> Ordering {
    a.changes
        .unwrap_or(u32::MAX)
        .cmp(&b.changes.unwrap_or(u32::MAX))
        .then(a.total_cents.cmp(&b.total_cents))
        .then(a.retailers.cmp(&b.retailers))
        .then(weight_key(a, comparable).cmp(&weight_key(b, comparable)))
        .then(a.choice.cmp(&b.choice))
}

fn keep_better(best: &mut Option<Kit>, kit: &Kit, order: impl Fn(&Kit, &Kit) -> Ordering) {
    if best.as_ref().is_none_or(|current| order(kit, current) == Ordering::Less) {
        *best = Some(kit.clone());
    }
}

/// Every complete kit, once each. Kept lines allow only their current option.
pub fn solve(request: &Request) -> Result<Answer, SolveError> {
    let lines = &request.lines;
    if lines.is_empty() || lines.len() > MAX_LINES || request.sample_size > MAX_SAMPLE {
        return Err(invalid("The request is outside the solver's bounds."));
    }
    let mut allowed: Vec<Vec<usize>> = Vec::with_capacity(lines.len());
    for line in lines {
        if line.options.is_empty() || line.options.len() > MAX_OPTIONS {
            return Err(invalid("Every line needs one to three options."));
        }
        if line.current.is_some_and(|current| current >= line.options.len()) {
            return Err(invalid("A current option is not one of the line's options."));
        }
        allowed.push(match (line.pinned, line.current) {
            (true, Some(current)) => vec![current],
            (true, None) => return Err(invalid("A kept line needs its current option.")),
            (false, _) => (0..line.options.len()).collect(),
        });
    }
    let costs = costs_of(request)?;
    let comparable = allowed
        .iter()
        .enumerate()
        .all(|(index, set)| set.iter().all(|&option| lines[index].options[option].weight_mg.is_some()));
    let complete_current = lines.iter().all(|line| line.current.is_some());

    let mut combinations: u64 = 0;
    let mut feasible: u64 = 0;
    let (mut lowest_total, mut lower_weight, mut fewest_retailers, mut smallest_change, mut cheapest) = (None, None, None, None, None);
    let mut sample: Vec<Kit> = Vec::new();
    let mut odometer = vec![0usize; lines.len()];
    let mut choice = vec![0usize; lines.len()];
    loop {
        for (index, set) in allowed.iter().enumerate() {
            choice[index] = set[odometer[index]];
        }
        let kit = evaluate(request, &costs, &choice)?;
        combinations = combinations.checked_add(1).ok_or_else(overflow)?;
        keep_better(&mut cheapest, &kit, |a, b| by_total(a, b, comparable));
        if kit.fits {
            feasible += 1;
            keep_better(&mut lowest_total, &kit, |a, b| by_total(a, b, comparable));
            if comparable {
                keep_better(&mut lower_weight, &kit, by_weight);
            }
            keep_better(&mut fewest_retailers, &kit, |a, b| by_retailers(a, b, comparable));
            if complete_current {
                keep_better(&mut smallest_change, &kit, |a, b| by_changes(a, b, comparable));
            }
            if request.sample_size > 0 {
                let at = sample.partition_point(|kept| by_total(kept, &kit, comparable) == Ordering::Less);
                if at < request.sample_size {
                    sample.insert(at, kit.clone());
                    sample.truncate(request.sample_size);
                }
            }
        }
        // Advance the odometer from the last line; stop after the last combination.
        let mut index = lines.len();
        let finished = loop {
            if index == 0 {
                break true;
            }
            index -= 1;
            odometer[index] += 1;
            if odometer[index] < allowed[index].len() {
                break false;
            }
            odometer[index] = 0;
        };
        if finished {
            break;
        }
    }
    let current = if complete_current {
        let current_choice: Vec<usize> = lines.iter().map(|line| line.current.unwrap_or(0)).collect();
        Some(evaluate(request, &costs, &current_choice)?)
    } else {
        None
    };
    let cheapest = cheapest.ok_or_else(|| invalid("There was no complete kit to compare."))?;
    Ok(Answer {
        combinations,
        feasible,
        weight_comparable: comparable,
        lowest_total,
        lower_weight,
        fewest_retailers,
        smallest_change,
        cheapest,
        current,
        sample,
    })
}

// ---- Writing the answer ----

fn kit_json(kit: &Kit) -> Value {
    json!({
        "choice": kit.choice,
        "totalCents": kit.total_cents,
        "weightMg": kit.weight_mg,
        "retailers": kit.retailers,
        "changes": kit.changes,
        "fits": kit.fits,
    })
}

pub fn answer_json(answer: &Answer) -> Value {
    json!({
        "version": VERSION,
        "combinations": answer.combinations,
        "feasible": answer.feasible,
        "weightComparable": answer.weight_comparable,
        "lowestTotal": answer.lowest_total.as_ref().map(kit_json),
        "lowerWeight": answer.lower_weight.as_ref().map(kit_json),
        "fewestRetailers": answer.fewest_retailers.as_ref().map(kit_json),
        "smallestChange": answer.smallest_change.as_ref().map(kit_json),
        "cheapest": kit_json(&answer.cheapest),
        "current": answer.current.as_ref().map(kit_json),
        "sample": answer.sample.iter().map(kit_json).collect::<Vec<_>>(),
    })
}

pub fn error_json(error: &SolveError) -> Value {
    json!({ "version": VERSION, "error": { "code": error.code, "message": error.message } })
}

/// One request in, one answer out: the JSON text to print and the process exit code (0, or 2 for a refused request).
pub fn run(input: &[u8]) -> (String, i32) {
    let result = (|| {
        if input.len() > MAX_INPUT_BYTES {
            return Err(too_large(format!("The request is over {MAX_INPUT_BYTES} bytes.")));
        }
        let value: Value = serde_json::from_slice(input).map_err(|_| invalid("The request is not JSON."))?;
        solve(&parse_request(&value)?)
    })();
    match result {
        Ok(answer) => (answer_json(&answer).to_string(), 0),
        Err(error) => (error_json(&error).to_string(), 2),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(cents: u64, grams: Option<u64>, retailer: u32) -> Listing {
        Listing { listing_cents: cents, per_listing: 1, weight_mg: grams.map(|g| g * 1000), retailer }
    }
    fn line(need: u64, options: Vec<Listing>) -> Line {
        Line { need, options, current: None, pinned: false }
    }

    /// kit-planning-acceptance-20261109.json: tent 1, sleeping bags 2, stove 1 (the two torches are owned, so not sent).
    fn acceptance(ceiling_cents: u64) -> Request {
        Request {
            ceiling_cents,
            sample_size: 8,
            lines: vec![
                line(1, vec![option(8000, Some(3000), 0), option(11000, Some(1800), 1)]),
                line(2, vec![option(2000, Some(800), 0), option(3000, Some(500), 1)]),
                line(1, vec![option(3000, Some(600), 0), option(3500, Some(300), 1)]),
            ],
        }
    }

    #[test]
    fn the_eight_literal_combinations_of_the_acceptance_example() {
        let answer = solve(&acceptance(18_000)).unwrap();
        assert_eq!(answer.combinations, 8);
        assert_eq!(answer.feasible, 5);
        assert!(answer.weight_comparable);
        let lowest = answer.lowest_total.unwrap();
        assert_eq!((lowest.choice, lowest.total_cents, lowest.weight_mg, lowest.retailers), (vec![0, 0, 0], 15_000, Some(5_200_000), 1));
        let light = answer.lower_weight.unwrap();
        assert_eq!((light.choice, light.total_cents, light.weight_mg, light.retailers), (vec![1, 0, 0], 18_000, Some(4_000_000), 2));
        // The one-retailer winner is the lowest-total kit again: a duplicate, not a third option.
        assert_eq!(answer.fewest_retailers.unwrap().choice, vec![0, 0, 0]);
        assert_eq!(answer.cheapest.choice, vec![0, 0, 0]);
        assert_eq!(answer.smallest_change, None);
        assert_eq!(answer.sample.iter().map(|k| k.total_cents).collect::<Vec<_>>(), vec![15_000, 15_500, 17_000, 17_500, 18_000]);
        // Every literal combination: [tent, bag, stove] -> total, grams, retailers, fits.
        let literal = [
            ([0, 0, 0], 15_000, 5200, 1, true), ([0, 0, 1], 15_500, 4900, 2, true), ([0, 1, 0], 17_000, 4600, 2, true),
            ([0, 1, 1], 17_500, 4300, 2, true), ([1, 0, 0], 18_000, 4000, 2, true), ([1, 0, 1], 18_500, 3700, 2, false),
            ([1, 1, 0], 20_000, 3400, 2, false), ([1, 1, 1], 20_500, 3100, 1, false),
        ];
        let request = acceptance(18_000);
        let costs = costs_of(&request).unwrap();
        for (choice, total, grams, retailers, fits) in literal {
            let kit = evaluate(&request, &costs, &choice).unwrap();
            assert_eq!((kit.total_cents, kit.weight_mg, kit.retailers, kit.fits), (total, Some(grams * 1000), retailers, fits), "{choice:?}");
        }
    }

    #[test]
    fn a_larger_one_off_leaves_only_the_lowest_total_kit() {
        let answer = solve(&acceptance(15_000)).unwrap();
        assert_eq!(answer.feasible, 1);
        assert_eq!(answer.lowest_total.as_ref().unwrap().choice, vec![0, 0, 0]);
        assert_eq!(answer.lower_weight.unwrap().choice, vec![0, 0, 0]);
        assert_eq!(answer.fewest_retailers.unwrap().choice, vec![0, 0, 0]);
    }

    #[test]
    fn retailer_sets_are_tracked_rather_than_partial_counts() {
        // paypal-internship-engineering-research-20261109.json, algorithmTrap: A1 and B1 both have one retailer, but only
        // B1 shares the retailer of the only option for the second group.
        let request = Request {
            ceiling_cents: 10_000,
            sample_size: 0,
            lines: vec![line(1, vec![option(8000, Some(1000), 0), option(8000, Some(1000), 1)]), line(1, vec![option(2000, Some(500), 1)])],
        };
        let answer = solve(&request).unwrap();
        let fewest = answer.fewest_retailers.unwrap();
        assert_eq!((fewest.choice, fewest.retailers, fewest.total_cents), (vec![1, 0], 1, 10_000));
        assert_eq!(answer.lowest_total.unwrap().choice, vec![1, 0]); // equal totals: the fewer retailers first
    }

    #[test]
    fn the_smallest_change_keeps_the_kept_tent_and_switches_one_line() {
        // production-replanning-commerce-research-20261109.json: $160 -> capacity $140, the tent is kept.
        let mut request = Request {
            ceiling_cents: 14_000,
            sample_size: 0,
            lines: vec![
                line(1, vec![option(9000, None, 0), option(7000, None, 1)]),
                line(2, vec![option(2000, None, 0), option(1000, None, 2)]),
                line(1, vec![option(3000, None, 0), option(2000, None, 1)]),
            ],
        };
        for item in &mut request.lines {
            item.current = Some(0);
        }
        request.lines[0].pinned = true;
        let answer = solve(&request).unwrap();
        let current = answer.current.unwrap();
        assert_eq!((current.total_cents, current.fits, current.changes), (16_000, false, Some(0)));
        let repair = answer.smallest_change.unwrap();
        assert_eq!((repair.choice, repair.total_cents, repair.changes), (vec![0, 1, 0], 14_000, Some(1)));
        let lowest = answer.lowest_total.unwrap();
        assert_eq!((lowest.choice, lowest.total_cents, lowest.changes), (vec![0, 1, 1], 13_000, Some(2)));
        assert_eq!(answer.combinations, 4); // the cheaper $70 tent is never tried while the $90 tent is kept
        assert!(!answer.weight_comparable);
        assert_eq!(answer.lower_weight, None);
    }

    #[test]
    fn whole_listings_are_bought_and_their_surplus_is_paid_for() {
        let request = Request {
            ceiling_cents: 10_000,
            sample_size: 0,
            lines: vec![line(3, vec![Listing { listing_cents: 1500, per_listing: 2, weight_mg: Some(250_000), retailer: 0 }])],
        };
        let kit = solve(&request).unwrap().cheapest;
        assert_eq!((kit.total_cents, kit.weight_mg), (3000, Some(500_000)));
        assert_eq!(listings(3, 2).unwrap(), 2);
        assert_eq!(listings(4, 2).unwrap(), 2);
        assert_eq!(listings(1, 100).unwrap(), 1);
    }

    #[test]
    fn nothing_fits_but_the_cheapest_kit_still_says_by_how_much() {
        let answer = solve(&acceptance(10_000)).unwrap();
        assert_eq!((answer.feasible, answer.lowest_total.is_none(), answer.sample.len()), (0, true, 0));
        assert_eq!((answer.cheapest.total_cents, answer.cheapest.fits), (15_000, false));
    }

    #[test]
    fn an_unknown_weight_is_never_compared_as_zero() {
        let mut request = acceptance(18_000);
        request.lines[2].options[1].weight_mg = None;
        let answer = solve(&request).unwrap();
        assert!(!answer.weight_comparable);
        assert_eq!(answer.lower_weight, None);
        assert_eq!(answer.lowest_total.unwrap().weight_mg, Some(5_200_000)); // its own listed weight is still known
    }

    #[test]
    fn the_largest_valid_request_stays_within_the_integer_range() {
        let options = vec![Listing { listing_cents: MAX_LISTING_CENTS, per_listing: 1, weight_mg: Some(MAX_WEIGHT_MG), retailer: MAX_RETAILER as u32 }; 3];
        let request = Request { ceiling_cents: MAX_CEILING_CENTS, sample_size: MAX_SAMPLE, lines: vec![line(MAX_NEED, options); MAX_LINES] };
        let answer = solve(&request).unwrap();
        assert_eq!(answer.combinations, 6561);
        assert_eq!(answer.cheapest.total_cents, 8 * 20 * MAX_LISTING_CENTS);
        assert_eq!(answer.feasible, 0);
        assert_eq!(listings(u64::MAX, 2), Err(overflow()));
    }

    #[test]
    fn refused_requests_name_their_reason() {
        let base = json!({ "version": 1, "ceilingCents": 18000, "sampleSize": 0,
            "lines": [{ "need": 1, "current": null, "pinned": false, "options": [{ "listingCents": 8000, "perListing": 1, "weightMg": null, "retailer": 0 }] }] });
        assert_eq!(run(base.to_string().as_bytes()).1, 0);
        let refused = |value: Value| {
            let (text, code) = run(value.to_string().as_bytes());
            assert_eq!(code, 2, "{text}");
            serde_json::from_str::<Value>(&text).unwrap()["error"]["code"].as_str().unwrap().to_owned()
        };
        let with = |path: &str, replacement: Value| {
            let mut value = base.clone();
            *value.pointer_mut(path).unwrap() = replacement;
            value
        };
        assert_eq!(refused(with("/version", json!(2))), "invalid_request");
        assert_eq!(refused(with("/ceilingCents", json!(1.5))), "invalid_request");
        assert_eq!(refused(with("/ceilingCents", json!(-1))), "invalid_request");
        assert_eq!(refused(with("/ceilingCents", json!(MAX_CEILING_CENTS + 1))), "invalid_request");
        assert_eq!(refused(with("/lines/0/need", json!(0))), "invalid_request");
        assert_eq!(refused(with("/lines/0/options/0/perListing", json!(0))), "invalid_request");
        assert_eq!(refused(with("/lines/0/options/0/retailer", json!(24))), "invalid_request");
        assert_eq!(refused(with("/lines/0/current", json!(1))), "invalid_request");
        assert_eq!(refused(with("/lines/0/pinned", json!(true))), "invalid_request");
        assert_eq!(refused(with("/lines/0/options/0/weightMg", json!("3 kg"))), "invalid_request");
        assert_eq!(refused(with("/lines", json!([]))), "invalid_request");
        let mut extra = base.clone();
        extra["lines"][0]["options"][0]["priceText"] = json!("$80");
        assert_eq!(refused(extra), "invalid_request");
        let mut missing = base.clone();
        missing["lines"][0].as_object_mut().unwrap().remove("current");
        assert_eq!(refused(missing), "invalid_request");
        let line = base["lines"][0].clone();
        assert_eq!(refused(with("/lines", json!(vec![line.clone(); MAX_LINES + 1]))), "too_large");
        let option = base["lines"][0]["options"][0].clone();
        assert_eq!(refused(with("/lines/0/options", json!(vec![option; MAX_OPTIONS + 1]))), "too_large");
        assert_eq!(run(b"not json").1, 2);
        assert_eq!(run(&vec![b' '; MAX_INPUT_BYTES + 1]).1, 2);
    }
}
