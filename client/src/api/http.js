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

async function request(method, path, { body, query } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body && { 'Content-Type': 'application/json' }),
        ...(activeHospitalId && { 'X-Hospital-Id': activeHospitalId }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: 'Cannot reach the server. Check that it is running.', code: 'NETWORK' });
  }
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
};
