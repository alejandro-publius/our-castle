// Realm atmosphere: which light and weather the world is drawn with. Cosmetic only, never progress, access or rewards.
// Shared and dependency-free, so the clock and weather rules can be tested without a browser.

export const TIME_MODES = Object.freeze(['auto', 'day', 'afternoon', 'night']);
export const WEATHER_MODES = Object.freeze(['clear', 'rain', 'local']);
export const PERIODS = Object.freeze(['day', 'afternoon', 'night']);
export const PERIOD_LABELS = Object.freeze({ day: 'Day', afternoon: 'Afternoon', night: 'Night' });
// Device-clock bands (not astronomical sunrise or sunset): day 06–15, afternoon 15–19, night 19–06.
export const PERIOD_HOURS = Object.freeze({ day: [6, 15], afternoon: [15, 19] });

export function periodForHour(hour) {
  if (hour >= PERIOD_HOURS.day[0] && hour < PERIOD_HOURS.day[1]) return 'day';
  if (hour >= PERIOD_HOURS.afternoon[0] && hour < PERIOD_HOURS.afternoon[1]) return 'afternoon';
  return 'night';
}

/** The device's IANA time zone, or null when the browser does not say. */
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

/**
 * Wall-clock hour and minute at `date` in `timeZone`, through Intl (so daylight saving is the platform's). When the
 * zone is missing or invalid, falls back to the runtime's own local clock and says so.
 */
export function localClock(date = new Date(), timeZone = deviceTimeZone()) {
  if (timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .formatToParts(date).map((p) => [p.type, p.value]));
      const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
      if (Number.isInteger(hour) && Number.isInteger(minute)) return { hour, minute, timeZone, fallback: false };
    } catch { /* an unknown zone: fall back below */ }
  }
  return { hour: date.getHours(), minute: date.getMinutes(), timeZone: null, fallback: true };
}

const two = (n) => String(n).padStart(2, '0');
// How a provider weather kind is drawn. Only rain is drawn as rain; the rest are honest approximations.
const WEATHER_LOOK = Object.freeze({ clear: 'clear', rain: 'rain', cloudy: 'overcast', fog: 'overcast', snow: 'overcast' });

/**
 * Resolve the time and weather modes into what the scene draws and what the status line says.
 * @param options.timeMode 'auto' | 'day' | 'afternoon' | 'night'
 * @param options.weatherMode 'clear' | 'rain' | 'local'
 * @param options.now a Date
 * @param options.timeZone the device zone (tests pass one explicitly)
 * @param options.local { place, result, error, loading } for local weather, or null
 */
export function resolveAtmosphere({ timeMode = 'auto', weatherMode = 'clear', now = new Date(), timeZone = deviceTimeZone(), local = null } = {}) {
  const time = TIME_MODES.includes(timeMode) ? timeMode : 'auto';
  let period, timeSource;
  if (time === 'auto') {
    const clock = localClock(now, timeZone);
    period = periodForHour(clock.hour);
    timeSource = clock.fallback ? `browser clock ${two(clock.hour)}:${two(clock.minute)} (time zone unavailable)` : `device clock ${two(clock.hour)}:${two(clock.minute)}, ${clock.timeZone}`;
  } else {
    period = time;
    timeSource = 'chosen by you';
  }

  const mode = WEATHER_MODES.includes(weatherMode) ? weatherMode : 'clear';
  let weather = mode === 'rain' ? 'rain' : 'clear', weatherSource = 'chosen by you', live = false;
  let weatherLabel = mode === 'rain' ? 'Rain' : 'Clear';
  if (mode === 'local') {
    const place = local?.place?.label;
    const result = local?.result;
    if (!place) { weatherLabel = 'Clear'; weatherSource = 'local weather: choose a town'; }
    else if (result) {
      const fresh = Number.isFinite(result.expiresAt) && now.getTime() < result.expiresAt && !local.error;
      weather = WEATHER_LOOK[result.kind] ?? 'clear';
      const condition = result.kind === 'snow' ? `${result.label} (shown as overcast)` : result.label;
      const at = result.observedAt ? new Date(result.observedAt) : null;
      const stamp = at && !Number.isNaN(at.getTime()) ? `${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC` : 'unknown time';
      weatherLabel = condition;
      // The time is Open-Meteo's report time, not a personal sensor reading.
      weatherSource = fresh ? `${place}, Open-Meteo report for ${stamp}` : `${place}, last Open-Meteo report for ${stamp}, not current`;
      live = fresh;
    } else if (local?.loading) { weatherLabel = 'Clear'; weatherSource = `${place}: loading local weather`; }
    else { weatherLabel = 'Clear'; weatherSource = `${place}: local weather unavailable${local?.error ? ` (${local.error})` : ''}`; }
  }
  return {
    period, weather, live,
    timeMode: time, weatherMode: mode,
    status: `${PERIOD_LABELS[period]} (${timeSource}) · ${weatherLabel} (${weatherSource})`,
  };
}
