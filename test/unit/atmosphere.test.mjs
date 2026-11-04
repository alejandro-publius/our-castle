import test from 'node:test';
import assert from 'node:assert/strict';
import { localClock, periodForHour, resolveAtmosphere } from '../../src/core/atmosphere.js';

test('periods follow the device-clock bands at their exact edges', () => {
  const at = (h) => periodForHour(h);
  assert.deepEqual([0, 5, 6, 14, 15, 18, 19, 23].map(at), ['night', 'night', 'day', 'day', 'afternoon', 'afternoon', 'night', 'night']);
});

test('the local hour comes from the IANA zone through Intl, including daylight-saving changes', () => {
  // New York springs forward on 2026-03-08 at 02:00 → 03:00.
  assert.equal(localClock(new Date('2026-03-08T06:30:00Z'), 'America/New_York').hour, 1);
  assert.equal(localClock(new Date('2026-03-08T07:30:00Z'), 'America/New_York').hour, 3);
  // London falls back on 2026-10-25 at 02:00 BST → 01:00 GMT.
  assert.equal(localClock(new Date('2026-10-25T00:30:00Z'), 'Europe/London').hour, 1);
  assert.equal(localClock(new Date('2026-10-25T01:30:00Z'), 'Europe/London').hour, 1);
  assert.equal(localClock(new Date('2026-10-25T02:30:00Z'), 'Europe/London').hour, 2);
  // A zone with a half-hour offset, and midnight as 0 rather than 24.
  assert.deepEqual(localClock(new Date('2026-11-04T18:45:00Z'), 'Asia/Kolkata'), { hour: 0, minute: 15, timeZone: 'Asia/Kolkata', fallback: false });
  // An unknown zone falls back to the runtime clock and says so.
  assert.equal(localClock(new Date('2026-11-04T12:00:00Z'), 'Not/AZone').fallback, true);
  assert.equal(localClock(new Date('2026-11-04T12:00:00Z'), null).fallback, true);
});

test('Auto follows the device zone; a manual time overrides it', () => {
  const now = new Date('2026-11-05T03:30:00Z'); // 19:30 in Los Angeles, 03:30 in London
  let a = resolveAtmosphere({ timeMode: 'auto', now, timeZone: 'America/Los_Angeles' });
  assert.equal(a.period, 'night');
  assert.match(a.status, /^Night \(device clock 19:30, America\/Los_Angeles\) · Clear \(chosen by you\)$/);
  a = resolveAtmosphere({ timeMode: 'auto', now: new Date('2026-11-04T23:10:00Z'), timeZone: 'America/Los_Angeles' });
  assert.deepEqual([a.period, a.status.startsWith('Afternoon (device clock 15:10')], ['afternoon', true]);
  a = resolveAtmosphere({ timeMode: 'day', weatherMode: 'rain', now, timeZone: 'America/Los_Angeles' });
  assert.deepEqual([a.period, a.weather], ['day', 'rain']);
  assert.equal(a.status, 'Day (chosen by you) · Rain (chosen by you)');
  a = resolveAtmosphere({ timeMode: 'auto', now, timeZone: 'Not/AZone' });
  assert.match(a.status, /\(browser clock \d\d:\d\d \(time zone unavailable\)\)/);
  // Unknown modes fall back to Auto and Clear rather than throwing.
  a = resolveAtmosphere({ timeMode: 'dusk', weatherMode: 'hail', now, timeZone: 'America/Los_Angeles' });
  assert.deepEqual([a.timeMode, a.weatherMode, a.weather], ['auto', 'clear', 'clear']);
});

test('local weather is drawn and labelled honestly: rain only when it rains, stale and unavailable said plainly', () => {
  const now = new Date('2026-11-04T14:00:00Z');
  const place = { id: 'lisbon', label: 'Lisbon, Portugal', latitude: 38.7, longitude: -9.1, timeZone: 'Europe/Lisbon' };
  const result = (kind, label, expires = now.getTime() + 10 * 60_000) => ({ place, kind, label, rain: kind === 'rain', observedAt: '2026-11-04T13:45:00Z', expiresAt: expires });
  const at = (local) => resolveAtmosphere({ timeMode: 'day', weatherMode: 'local', now, timeZone: 'UTC', local });

  let a = at({ place: null });
  assert.deepEqual([a.weather, a.status], ['clear', 'Day (chosen by you) · Clear (local weather: choose a town)']);
  a = at({ place, loading: true });
  assert.match(a.status, /Lisbon, Portugal: loading local weather/);
  a = at({ place, result: result('rain', 'Light rain') });
  assert.deepEqual([a.weather, a.live], ['rain', true]);
  assert.equal(a.status, 'Day (chosen by you) · Light rain (Lisbon, Portugal, Open-Meteo report for 13:45 UTC)');
  for (const [kind, look] of [['cloudy', 'overcast'], ['fog', 'overcast'], ['snow', 'overcast'], ['clear', 'clear']]) assert.equal(at({ place, result: result(kind, kind) }).weather, look, kind);
  assert.match(at({ place, result: result('snow', 'Snow') }).status, /Snow \(shown as overcast\)/);
  // Expired, or a refresh that failed: the last condition stays, labelled as not current.
  a = at({ place, result: result('rain', 'Light rain', now.getTime() - 1) });
  assert.deepEqual([a.weather, a.live], ['rain', false]);
  assert.match(a.status, /last Open-Meteo report for 13:45 UTC, not current/);
  a = at({ place, result: result('rain', 'Light rain'), error: 'offline' });
  assert.equal(a.live, false);
  // Nothing loaded and an error: clear, unavailable.
  a = at({ place, error: 'The weather service did not answer' });
  assert.deepEqual([a.weather, a.live], ['clear', false]);
  assert.match(a.status, /Lisbon, Portugal: local weather unavailable \(The weather service did not answer\)/);
});
