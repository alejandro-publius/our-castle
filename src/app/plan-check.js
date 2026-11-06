// A read-only check of the existing Plan fields. Saving and generating a plan remain separate, explicit actions.
import { api } from './api.js';
import { formatCents, parseAmountToCents } from '../core/rules.js';

const $ = (id) => document.getElementById(id);
const fields = ['goal-name-input', 'goal-target', 'goal-starting', 'goal-weekly', 'goal-date'];
const date = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function createPlanCheck({ getState, isBlocked = () => false, isStale = () => false, refreshGoal }) {
  const button = $('check-schedule'), result = $('plan-check-result');
  let sequence = 0, controller = null, stateKey = null, blockedKey = isBlocked();
  const inputs = () => Object.fromEntries(fields.map(id => [id, $(id).value]));
  const facts = () => {
    const s = getState();
    return JSON.stringify([s.goal, s.progress.startingCents, s.progress.progressCents, s.progress.confirmedNetCents, s.acceptedPlanId]);
  };
  const signature = () => JSON.stringify([facts(), inputs(), isBlocked()]);
  const current = (n, key) => n === sequence && key === signature();

  function clear() {
    sequence++;
    controller?.abort(); controller = null;
    result.replaceChildren(); result.hidden = true;
    button.removeAttribute('aria-busy');
    button.disabled = isBlocked();
  }

  function message(text, { error = false, reload = false } = {}) {
    result.hidden = false;
    result.dataset.kind = error ? 'error' : 'ok';
    const summary = el('p', text);
    summary.tabIndex = -1;
    result.replaceChildren(summary);
    if (reload) {
      const action = el('button', 'Load latest goal', 'link-button');
      action.type = 'button';
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          const loaded = await refreshGoal();
          if (loaded === false || isBlocked()) return;
          stateKey = facts();
          message('Latest goal loaded. Check your schedule again.');
          button.focus();
        } catch (error) {
          if (!isBlocked()) message(error.message, { error: true, reload: true });
        }
      });
      result.append(action);
    }
    return summary;
  }

  function render(p) {
    const money = (c) => formatCents(c, p.facts.currency);
    let text;
    if (p.outcome === 'reached') text = 'Goal reached. No further contributions are needed.';
    else if (p.outcome === 'no_budget') text = `At ${money(0)} a week, ${money(p.facts.remainingCents)} remains.`;
    else if (p.outcome === 'short') text = `${money(p.totals.shortfallCents)} short by ${date(p.requested.targetDate)} at ${money(p.requested.weeklyBudgetCents)} a week.`;
    else {
      // The chosen weekly amount is a ceiling. Use the returned schedule's finish, not the earliest possible date
      // at that ceiling: the built-in schedule may spread smaller contributions over the requested weeks.
      const finish = p.schedule.findLast(c => c.amountCents > 0)?.date;
      text = `Up to ${money(p.requested.weeklyBudgetCents)} a week, finishing ${date(finish)}.`;
    }
    const summary = message(text);
    if (p.outcome === 'short' && p.reach.withinPlanningLimit && p.reach.date) {
      const later = el('button', `Try ${date(p.reach.date)}`, 'link-button');
      later.type = 'button';
      later.addEventListener('click', () => {
        $('goal-date').value = p.reach.date;
        $('goal-date').dispatchEvent(new Event('input', { bubbles: true }));
        message('Date added to the form. Make a new plan when you are ready.');
        $('goal-date').focus();
      });
      result.append(later);
    } else if (p.outcome === 'short' && !p.reach.withinPlanningLimit) {
      result.append(el('p', `This amount needs ${p.reach.weeksNeeded} weeks, beyond the 52-week planning limit.`, 'fine'));
    }
    if (p.schedule.length) {
      const details = el('details'), label = el('summary', 'See dates');
      const table = el('table', undefined, 'schedule');
      const head = el('thead'), row = el('tr');
      for (const title of ['Week', 'Date', 'Amount']) { const th = el('th', title); th.scope = 'col'; row.append(th); }
      head.append(row);
      const body = el('tbody');
      for (const c of p.schedule) {
        const tr = el('tr');
        for (const value of [`${c.week}`, date(c.date), money(c.amountCents)]) tr.append(el('td', value));
        body.append(tr);
      }
      table.append(head, body);
      const wrap = el('div', undefined, 'table-wrap'); wrap.append(table);
      details.append(label, wrap); result.append(details);
    }
    summary.focus({ preventScroll: true });
  }

  async function check() {
    clear();
    if (isBlocked()) {
      message('Save or discard the market draft first.', { error: true });
      $('goal-draft-title').focus(); return;
    }
    // Another member saved a newer goal while this form was being edited: offer it, keeping this member's own edits.
    if (isStale()) {
      message('Your goal or contributions changed. Load the latest goal before checking again.', { error: true, reload: true });
      return;
    }
    const s = getState(), values = inputs();
    if (values['goal-name-input'].trim() !== s.goal.name
      || parseAmountToCents(values['goal-target']) !== s.goal.targetCents
      || parseAmountToCents(values['goal-starting']) !== s.progress.startingCents) {
      message('Make a plan for the changed goal first. Then check different amounts or dates.', { error: true });
      $('ask-planner').focus(); return;
    }
    const weeklyBudgetCents = parseAmountToCents(values['goal-weekly']);
    if (weeklyBudgetCents === null) {
      $('goal-weekly').setAttribute('aria-invalid', 'true');
      message('Enter a weekly amount like 20.00.', { error: true }); $('goal-weekly').focus(); return;
    }
    if (!values['goal-date']) {
      message('Choose a target date.', { error: true }); $('goal-date').focus(); return;
    }
    $('goal-weekly').removeAttribute('aria-invalid');
    const mine = sequence, key = signature();
    controller = new AbortController();
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    message('Checking the schedule…');
    try {
      const { preview: p } = await api.post('/api/plans/preview', { weeklyBudgetCents, targetDate: values['goal-date'] }, { signal: controller.signal });
      if (!current(mine, key)) return;
      if (p?.kind !== 'remaining-plan-preview' || !Array.isArray(p.schedule)) throw new Error('The schedule could not be read. Check again.');
      if (p.facts.goalId !== s.goal.id || p.facts.goalName !== s.goal.name || p.facts.targetCents !== s.goal.targetCents
        || p.facts.startingCents !== s.progress.startingCents || p.facts.progressCents !== s.progress.progressCents
        || p.savedSettings.weeklyBudgetCents !== s.goal.weeklyBudgetCents || p.savedSettings.targetDate !== s.goal.targetDate
        || p.planInUseId !== s.acceptedPlanId) {
        message('Your goal or contributions changed. Load the latest goal before checking again.', { error: true, reload: true });
        return;
      }
      render(p);
    } catch (error) {
      if (current(mine, key) && error.name !== 'AbortError') message(error.message, { error: true });
    } finally {
      if (current(mine, key)) { controller = null; button.disabled = isBlocked(); button.removeAttribute('aria-busy'); }
    }
  }

  button.addEventListener('click', check);
  $('plan-form').addEventListener('input', (event) => { if (fields.includes(event.target.id)) clear(); });
  // Trying a weekly amount/date with Enter is a read-only calculation. The focused Make-plan button retains its
  // explicit submit behavior; implicit form submission must not save settings or invoke the model here.
  $('plan-form').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && ['goal-weekly', 'goal-date'].includes(event.target.id)) {
      event.preventDefault(); check();
    }
  });
  return {
    clear,
    update() {
      const next = facts(), blocked = isBlocked();
      if (stateKey !== next || blockedKey !== blocked || blocked) clear();
      stateKey = next; blockedKey = blocked;
      if (!controller) button.disabled = blocked;
    },
  };
}
