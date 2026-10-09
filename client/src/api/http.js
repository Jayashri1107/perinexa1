// The one way the website talks to the server: JSON in and out, the session cookie sent automatically,
// and every error turned into an ApiError with the server's message and per-field messages.
/* global __API_PREFIX__ */
const API_PREFIX = __API_PREFIX__;

export const SESSION_EXPIRED_EVENT = 'app:session-expired';
// The hospital changed in another tab: the session is reloaded.
export const HOSPITAL_CHANGED_EVENT = 'app:hospital-changed';

// The hospital this tab works in, sent with every request so the server can refuse a request meant for another one.
let activeHospitalId = null;
export const setActiveHospital = (id) => {
  activeHospitalId = id ?? null;
};

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error.code ?? 'ERROR';
    this.fields = error.fields ?? null;
    this.details = error; // everything the server sent (e.g. the possible duplicates of a patient)
  }
}

// The address of a file download (opened by the browser itself; the session cookie goes along).
export const apiUrl = (path) => API_PREFIX + path;

function buildUrl(path, query) {
  const url = new URL(API_PREFIX + path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

// The server was not reachable for a moment (restarting, a network blip, or the proxy answering for it): the request
// never reached the app. Readings are sent again; a change only when the proxy says the app could not be reached (502,
// 503, 504), so a change is never saved twice.
const RETRY_WAIT_MS = [400, 1200];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const unreachable = (res) => [502, 503, 504].includes(res.status) || (res.status === 500 && !(res.headers.get('content-type') ?? '').includes('application/json'));

// raw: a File or Blob sent as it is (uploads), with `headers`; blob: the answer is a file, not JSON.
async function request(method, path, { body, query, raw, headers, blob = false } = {}) {
  let res;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetch(buildUrl(path, query), {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body && { 'Content-Type': 'application/json' }),
          ...(raw && { 'Content-Type': 'application/octet-stream' }),
          ...headers,
          ...(activeHospitalId && { 'X-Hospital-Id': activeHospitalId }),
        },
        body: raw ?? (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      // no answer at all: a reading is sent again (a change is not – it may have arrived before the line dropped)
      if (method === 'GET' && attempt < RETRY_WAIT_MS.length) {
        await wait(RETRY_WAIT_MS[attempt]);
        continue;
      }
      throw new ApiError(0, { message: 'Cannot reach the server. Check your connection and try again.', code: 'NETWORK' });
    }
    // the proxy answered for an unreachable app: readings are sent again; changes only when they cannot have arrived
    if (unreachable(res) && attempt < RETRY_WAIT_MS.length && (method === 'GET' || path === '/auth/login' || res.status !== 500)) {
      await wait(RETRY_WAIT_MS[attempt]);
      continue;
    }
    break;
  }
  if (blob && res.ok) return res.blob();
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    if (res.status === 409 && data?.error?.code === 'HOSPITAL_MISMATCH') {
      window.dispatchEvent(new Event(HOSPITAL_CHANGED_EVENT));
    }
    throw new ApiError(res.status, data?.error);
  }
  return data;
}

export const http = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
  // A file as the body; `headers` say what it is (header values are URI-encoded by the caller).
  upload: (path, file, headers) => request('POST', path, { raw: file, headers }),
  // A file from the server (as a Blob), e.g. a scanned document to show.
  file: (path) => request('GET', path, { blob: true }),
};
