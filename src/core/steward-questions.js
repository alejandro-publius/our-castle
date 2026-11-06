export const CONFIRMATION_HISTORY_QUESTION = 'When was our last contribution confirmed?';

// Only explicit historical questions take the local path. Other requests retain the existing model/tool boundary.
const HISTORY_QUESTIONS = new Set([
  'when was our last contribution confirmed', 'when was the last contribution confirmed',
  'when was my last contribution confirmed', 'when was this contribution confirmed',
  'when was last contribution confirmed', 'when was this payment last verified',
]);
export function isConfirmationHistoryQuestion(question) {
  return typeof question === 'string' && HISTORY_QUESTIONS.has(question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, ''));
}
