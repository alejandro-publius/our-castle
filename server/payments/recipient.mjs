import { DomainError } from '../household.mjs';

/** A server-owned merchant identity. No payer request may choose this value. */
export function paypalRecipient(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.merchantId !== 'string' || !/^[A-Z0-9]{5,32}$/.test(value.merchantId)
    || (value.kind !== undefined && value.kind !== 'paypal')
    || (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 1))) {
    throw new DomainError(400, 'recipient_invalid', 'Choose a configured PayPal sandbox merchant.');
  }
  return Object.freeze({ kind: 'paypal', merchantId: value.merchantId, revision: value.revision ?? 1 });
}

/** The caller is our own service, not an HTTP body. The account still needs PayPal's permissions. */
export function paypalAuthAssertion(clientId, recipient) {
  const payee = paypalRecipient(recipient);
  if (!payee) return undefined;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ iss: clientId, payer_id: payee.merchantId })}.`;
}

export function samePayPalRecipient(unit, recipient) {
  const expected = paypalRecipient(recipient);
  return expected !== null && unit?.payee?.merchant_id === expected.merchantId;
}
