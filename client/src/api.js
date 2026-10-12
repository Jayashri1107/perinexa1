// Small helper for talking to the server. The login cookie is sent automatically by the browser.

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || "Couldn't complete that – try again, or reload the page.");
    this.status = status;
    this.code = error.code;
    this.fields = error.fields || {};
    // Registration only ("She may already be registered", code POSSIBLE_MATCHES): the records that match, and how many
    if (error.matches) {
      this.matches = error.matches;
      this.total = error.total ?? error.matches.length;
    }
  }
}

let onSessionEnded = null;
let onTenantMismatch = null;
let activeTenantId = null;

export const setSessionEndedHandler = (fn) => {
  onSessionEnded = fn;
};
export const setTenantMismatchHandler = (fn) => {
  onTenantMismatch = fn;
};
// The hospital this browser tab is showing. Sent with every request so the server can refuse
// to save data if the session has meanwhile switched to another hospital (e.g. in another tab).
export const setActiveTenant = (id) => {
  activeTenantId = id;
};

export async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (activeTenantId) headers['X-Tenant-Id'] = activeTenantId;

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: "Can't reach the server. Please check that the app is running." });
  }

  const data = await res.json().catch(() => null);
  if (!res.ok && !data?.error && res.status >= 500) {
    // The dev proxy answers this way when the API server itself is not running.
    throw new ApiError(res.status, { message: "Can't reach the server. Please check that the app is running." });
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error);
    // A 401 on any page other than login/startup means the session ended (timeout, deactivated, etc.).
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onSessionEnded?.();
    // The hospital changed underneath this tab (or access to it was removed): reload the session.
    if (err.code === 'TENANT_MISMATCH' || err.code === 'NO_TENANT') onTenantMismatch?.();
    throw err;
  }
  return data;
}

// A new id for a request that must be saved only once (e.g. "Add item", printing a consent form), so a double
// click or a retry on a slow connection saves it once. crypto.randomUUID needs a secure page (https or
// localhost); the fallback builds the same kind of id from random bytes.
export function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A file from the server (e.g. a CSV export): the same checks as api(), returning the file as a Blob and its name.
export async function apiFile(path, { query } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin', headers: activeTenantId ? { 'X-Tenant-Id': activeTenantId } : {} });
  } catch {
    throw new ApiError(0, { message: "Can't reach the server. Please check that the app is running." });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401) onSessionEnded?.();
    throw new ApiError(res.status, data?.error);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'perinexa-export.csv';
  return { blob: await res.blob(), name };
}
