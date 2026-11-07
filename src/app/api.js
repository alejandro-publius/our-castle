// Thin JSON client for the local server. The browser never holds provider secrets.
export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || `Request failed (${status})`);
    this.status = status;
    this.code = error.code;
    this.issues = error.issues;
    this.debugId = error.debugId;
  }
}

// Family access: the signed-in session's CSRF token (kept in memory only, never in storage) and what to do when the
// server says the session ended. Example mode sets neither.
let csrfToken = null;
let onSessionLost = null;
export function setSession({ csrf = null, lost = null } = {}) { csrfToken = csrf; onSessionLost = lost; }
// The page may keep a newer sign-in of the same member, made in another tab while a request was under way. That request
// was refused, and whether its action took place is not known here, so the page says so instead of repeating it.
const SESSION_RENEWED = 'This browser signed in again while this was in progress. Check the latest records before trying again.';

// A background read (a shared family's page re-reading after a live update, or its fallback refresh) says so: it is not
// the person's activity, so it never keeps an idle session alive.
async function request(method, url, body, { signal, background = false } = {}) {
  let response;
  const headers = body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (background) headers['X-Our-Castle-Refresh'] = 'background';
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error; // the caller cancelled a request it no longer needs
    throw new ApiError(0, { code: 'network', message: 'Could not reach the Our Castle server. Is it still running?' });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiError(response.status, data.error);
    if (response.status === 401 && ['session_required', 'session_expired'].includes(error.code) && onSessionLost) {
      // The page decides whether its session really ended; it keeps a newer sign-in of the same member.
      if ((await onSessionLost(error)) === 'kept') throw new ApiError(409, { code: 'session_renewed', message: SESSION_RENEWED });
    }
    throw error;
  }
  return data;
}

export const api = {
  get: (url, options) => request('GET', url, undefined, options),
  post: (url, body = {}, options) => request('POST', url, body, options),
  put: (url, body = {}) => request('PUT', url, body),
};

export const newRequestId = () => `web_${crypto.randomUUID()}`;
