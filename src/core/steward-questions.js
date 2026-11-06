export const CONFIRMATION_HISTORY_QUESTION = 'When was our last contribution confirmed?';
export const NEEDS_CHECK_QUESTION = 'Any contributions that need a PayPal check?';

const normalize = (question) => question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, '');

// Only explicit historical questions take the local path. Other requests retain the existing model/tool boundary.
const HISTORY_QUESTIONS = new Set([
  'when was our last contribution confirmed', 'when was the last contribution confirmed',
  'when was my last contribution confirmed', 'when was this contribution confirmed',
  'when was last contribution confirmed', 'when was this payment last verified',
]);
export function isConfirmationHistoryQuestion(question) {
  return typeof question === 'string' && HISTORY_QUESTIONS.has(normalize(question));
}

// "What still needs a check?" is answered from this household's saved records alone: no model, no PayPal lookup.
const NEEDS_CHECK_QUESTIONS = new Set([
  'any contributions that need a paypal check', 'any contributions need a paypal check', 'do any contributions need a paypal check',
  'which contributions need a paypal check', 'what needs a paypal check', 'does anything need a paypal check',
  'anything that needs a paypal check', 'is anything waiting for a paypal check',
]);
export function isNeedsCheckQuestion(question) {
  return typeof question === 'string' && NEEDS_CHECK_QUESTIONS.has(normalize(question));
}

/** Questions the server answers from saved household records, with no model or provider call. */
export const isLocalQuestion = (question) => isConfirmationHistoryQuestion(question) || isNeedsCheckQuestion(question);
