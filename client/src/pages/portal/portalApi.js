// The patient portal's own small requests (never the staff helper: a portal "please sign in again" must not touch a
// staff session in the same browser).

export async function portal(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/portal${path}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error("Can't reach the hospital's server. Please try again later."), { status: 0, code: 'NETWORK' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? 'Something went wrong. Please try again.'), { status: res.status, code: data?.error?.code, retryAfterSeconds: data?.error?.retryAfterSeconds });
  return data;
}
