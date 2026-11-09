// Which catalogue Market Town answers from, as this server reports it (state.modes.merchant):
// - "live": Channel3, with the server's own key;
// - "sample": the playable family-trip example's catalogue of invented shops, listings and prices, answered on this
//   computer (npm run demo -- --family-trip). The page works the same, and says the listings are invented wherever it
//   would otherwise name Channel3, real stock or a shop to visit;
// - anything else: not connected.
// Shared and dependency-free, so the page's modules agree and it can be tested in Node.
export function catalogueOf(state) {
  const mode = state?.modes?.merchant?.mode;
  const sample = mode === 'sample';
  return { open: mode === 'live' || sample, sample, name: sample ? 'the example catalogue' : 'Channel3' };
}
