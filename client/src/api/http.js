// The one way the website talks to the server: JSON in and out, the session cookie sent automatically,
// and every error turned into an ApiError with the server's message and per-field messages.
/* global __API_PREFIX__ */
const API_PREFIX = __API_PREFIX__;

export const SESSION_EXPIRED_EVENT = 'app:session-expired';

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message ?? 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error.code ?? 'ERROR';
    this.fields = error.fields ?? null;
  }
}

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
      headers: body ? { 'Content-Type': 'application/json' } : {},
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
    throw new ApiError(res.status, data?.error);
  }
  return data;
}

export const http = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
};
