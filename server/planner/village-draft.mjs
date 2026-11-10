import { createHash } from 'node:crypto';
import { DomainError, addDays, daysBetween, isIsoDate } from '../household.mjs';

const fail = (code, message, status = 400) => new DomainError(status, code, message);
const MAX_TARGET = 100_000_000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SOURCE = { rules: { mode: 'rules', label: 'Draft from built-in rules; no AI' }, ai: { mode: 'ai', label: 'AI draft, checked by Our Castle' } };
const plain = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x1f\x7f<>]/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function checkedMembers(members) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 50) throw fail('village_members', 'Choose a neighborhood with 1–50 families.');
  const refs = new Set();
  const result = members.map(member => {
    if (!plain(member?.familyReference, 100) || !plain(member?.alias, 80) || refs.has(member.familyReference))
      throw fail('village_members', 'The neighborhood member list is not valid.');
    refs.add(member.familyReference);
    return { familyReference: member.familyReference, alias: member.alias.trim() };
  });
  return result.sort((a, b) => a.familyReference.localeCompare(b.familyReference, 'en'));
}

/** A deliberately bounded grammar: one explicit USD amount and one calendar date WITH a year. */
export function parseVillageSentence(raw, today) {
  if (!plain(raw, 800)) throw fail('village_draft_text', 'Describe the fund in 1–800 characters of plain text.');
  if (!isIsoDate(today)) throw fail('village_today', 'The server date is not valid.');
  const text = raw.trim().replace(/\s+/g, ' '), issues = [];
  const amounts = [...text.matchAll(/(?:\$\s*|\bUSD\s+)([+-]?\d[\d,]*(?:\.\d+)?)(?![\d.])|\b([+-]?\d[\d,]*(?:\.\d+)?)\s+USD\b/gi)];
  let targetMinor = null;
  if (amounts.length === 1) {
    const match = amounts[0], amount = match[1] ?? match[2];
    if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount) && !/[+-]\s*$/.test(text.slice(0, match.index))) {
      const [whole, fraction = ''] = amount.replaceAll(',', '').split('.');
      const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (Number.isSafeInteger(value) && value > 0 && value <= MAX_TARGET) targetMinor = value;
    }
  }
  if (targetMinor === null) issues.push({ field: 'targetMinor', message: 'Give one total target in USD, such as $400 or $400.50. Other amounts can be reviewed afterward.' });
  if (/(?:€|£|\b(?:EUR|GBP|PYUSD|USDT|USDC)\b)/i.test(text)) issues.push({ field: 'currency', message: 'Sentence drafts use USD. Choose another fund rail explicitly in the fund form.' });

  const dates = [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => ({ value: match[0], text: match[0], index: match.index }));
  const monthExpression = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+)(\\d{4})\\b`, 'gi');
  for (const match of text.matchAll(monthExpression)) dates.push({ value: `${match[3]}-${String(MONTHS.indexOf(match[1].toLowerCase()) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`, text: match[0], index: match.index });
  const deadline = dates.length === 1 && isIsoDate(dates[0].value) ? dates[0].value : null;
  if (!deadline || daysBetween(today, deadline) < 1 || daysBetween(today, deadline) > 366)
    issues.push({ field: 'deadline', message: 'Give one real future date including its year, within the next 366 days; for example December 12, 2026.' });

  // Extract a readable proposal title; the adult can replace it at review. Never infer a payee, member or debt.
  let title = text;
  if (amounts.length === 1) title = title.replace(amounts[0][0], '');
  if (dates.length === 1) title = title.replace(dates[0].text, '');
  title = title.replace(/^(?:we\s+)?(?:need|want|raise|collect|save|fund)\s*/i, '').replace(/^\s*(?:for|toward|towards)\s+/i, '')
    .replace(/\s+(?:by|before|on)\s*[.!]?$/i, '').replace(/\s+/g, ' ').replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '');
  if (!plain(title, 80)) issues.push({ field: 'title', message: 'Name one short purpose for the fund, such as the class trip.' });
  return { text, title: plain(title, 80) ? title : null, targetMinor, deadline, currency: 'USD', issues };
}

function split(total, count) {
  const each = Math.floor(total / count), remainder = total % count;
  return Array.from({ length: count }, (_, index) => each + (index < remainder ? 1 : 0));
}

function scheduleFor(shares, today, deadline) {
  const dates = [];
  for (let date = addDays(today, 7); date <= deadline; date = addDays(date, 7)) dates.push(date);
  // A short deadline gets one proposal on that date. Later weeks stay exactly seven days apart.
  if (!dates.length) dates.push(deadline);
  const allocations = shares.map(share => split(share.committedMinor, dates.length));
  return dates.map((date, index) => {
    const families = shares.map((share, member) => ({ familyReference: share.familyReference, amountMinor: allocations[member][index] }));
    return { date, totalMinor: families.reduce((sum, family) => sum + family.amountMinor, 0), families };
  });
}

function draftBody({ title, targetMinor, deadline, members, membershipRevision, today }) {
  const parts = split(targetMinor, members.length);
  const shares = members.map((member, index) => ({ ...member, committedMinor: parts[index], proposed: true }));
  return { title, targetMinor, currency: 'USD', decimals: 2, deadline, rail: 'simulated', project: 'schoolhouse',
    shares, schedule: scheduleFor(shares, today, deadline), membershipRevision, createdOn: today };
}

/** Proposals only. The server caller supplies authorized membership; provider input contains no private ledger. */
export async function createVillageDraft({ text, members, membershipRevision, today, provider = null, assertAccess = () => {} }) {
  assertAccess();
  const allowed = checkedMembers(members);
  if (!plain(membershipRevision, 160)) throw fail('village_revision', 'Read the latest neighborhood before drafting a fund.');
  const parsed = parseVillageSentence(text, today);
  const result = { status: 'needs_details', source: SOURCE.rules, draft: null, issues: parsed.issues, requiresAdultReview: true, paymentScheduled: false };
  if (parsed.issues.length) return result;
  let title = parsed.title;
  if (provider) {
    let reply;
    try { reply = await provider.proposeVillage({ text: parsed.text, title, targetMinor: parsed.targetMinor, deadline: parsed.deadline, currency: 'USD' }); }
    finally { assertAccess(); }
    const candidate = reply?.output;
    if (!candidate || Object.keys(candidate).sort().join(',') !== 'currency,deadline,targetMinor,title' ||
        !plain(candidate.title, 80) || candidate.targetMinor !== parsed.targetMinor || candidate.deadline !== parsed.deadline || candidate.currency !== 'USD')
      throw fail('village_ai_output', 'The AI draft changed or added facts. Review the original amount and date, then try again.', 422);
    title = candidate.title.trim();
    result.source = { ...SOURCE.ai, provider: provider.provider ?? null, model: reply.model ?? provider.model ?? null };
  }
  assertAccess();
  const body = draftBody({ title, targetMinor: parsed.targetMinor, deadline: parsed.deadline, members: allowed, membershipRevision, today });
  return { ...result, status: 'ready', draft: { ...body, revision: hash(body) }, issues: [] };
}

/**
 * storedDraft MUST be the server-retained proposal, never the client's echoed JSON. A digest detects stale review;
 * it is not a signature. The route binds the retained proposal to the same session/household that requested it.
 */
export function validateReviewedVillageDraft({ storedDraft, reviewedRevision, members, membershipRevision, today, actor }) {
  if (actor?.role !== 'adult' || !plain(actor.memberId, 100)) throw fail('adult_required', 'An adult reviews the proposed village fund.', 403);
  const allowed = checkedMembers(members);
  if (!storedDraft || !plain(storedDraft.title, 80) || !Number.isSafeInteger(storedDraft.targetMinor) || storedDraft.targetMinor < 1 || storedDraft.targetMinor > MAX_TARGET ||
      !isIsoDate(storedDraft.deadline) || !isIsoDate(today) || daysBetween(today, storedDraft.deadline) < 1 || daysBetween(today, storedDraft.deadline) > 366)
    throw fail('village_draft_missing', 'Make a fresh fund proposal before creating it.', 409);
  const body = draftBody({ title: storedDraft.title, targetMinor: storedDraft.targetMinor, deadline: storedDraft.deadline, members: allowed, membershipRevision, today });
  if (storedDraft.membershipRevision !== membershipRevision || storedDraft.createdOn !== today || storedDraft.revision !== reviewedRevision || hash(body) !== reviewedRevision ||
      hash(Object.fromEntries(Object.entries(storedDraft).filter(([key]) => key !== 'revision'))) !== reviewedRevision)
    throw fail('village_draft_changed', 'The proposal or neighborhood changed. Review a fresh fund proposal.', 409);
  // B creates the fund only. Individual shares remain proposals until each family accepts its own commitment.
  return { title: body.title, targetMinor: body.targetMinor, deadline: body.deadline, currency: body.currency,
    decimals: body.decimals, rail: body.rail, project: body.project, proposedShares: body.shares, proposedSchedule: body.schedule };
}
