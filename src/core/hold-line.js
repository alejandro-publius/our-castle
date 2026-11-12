// Where one open hold stands, in a sentence, from the server's own dates for it (a row of server/treasury.mjs
// `openHolds`). Shared by the Treasury plaque and the steward's answer, so both say the same thing.
const shortDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const days = (n) => `${n} more ${n === 1 ? 'day' : 'days'}`;

export function holdLine(h) {
  const guarantee = h.simulated ? 'The simulated guarantee' : 'PayPal’s guarantee';
  const standing = h.phase === 'expired' ? `It has reached its ${h.simulated ? 'simulated ' : ''}expiry.${h.simulated ? '' : ' Check it with PayPal.'}`
    : !h.honorUntil ? 'Its guarantee dates are not known yet.'
      : h.phase === 'unguaranteed' ? `${guarantee} ended ${shortDay(h.honorUntil)}.${h.canExtend ? ' An adult can extend it once.' : ''}`
        : `${guarantee} lasts ${days(h.guaranteedDays)}, until ${shortDay(h.honorUntil)}.`;
  const latest = h.expiresAt && h.phase !== 'expired' ? ` It can be held until ${shortDay(h.expiresAt)} at the latest.` : '';
  return `${standing}${latest}${h.pending ? ' A decision on it is still being confirmed.' : ''}`;
}
