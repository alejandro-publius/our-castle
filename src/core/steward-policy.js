// The runtime PayPal wrapper and the local permissions answer share this allow-list. Neither the answer nor its
// example question is an authorization gate: every runtime tool call is still checked on the server.
export const PAYPAL_READ_TOOLS = Object.freeze(['get_order', 'list_transactions']);
export const READ_ONLY_QUESTION = 'Can you make a payment or refund for me?';

const questions = new Set([
  'can you make a payment or refund for me', 'can you pay or refund',
  'can you refund this contribution', 'can you refund my last contribution',
  'refund my last contribution', 'make a payment for me',
]);
export function isReadOnlyQuestion(question) {
  return typeof question === 'string' && questions.has(question.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, ''));
}
