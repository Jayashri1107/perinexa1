// City (district), state and the post offices of an Indian PIN code, for filling in an address (owner, 8 Oct 2026).
// Asked of the free India Post PIN code service (config.patients.pincodeLookupUrl). Only the 6-digit PIN code is sent
// – never a name or anything else about the patient. Answers are kept in memory for a day. When the service cannot be
// reached the address is simply typed by hand.
import { config } from '../../config/index.js';
import { HttpError } from '../../core/httpError.js';

const cache = new Map(); // pin → { at, answer }
const DAY = 24 * 60 * 60 * 1000;
const MAX_CACHED = 5000;

export async function lookupPincode(pin) {
  if (!/^[1-9]\d{5}$/.test(pin)) throw new HttpError(400, 'A PIN code has 6 digits and does not start with 0.', 'VALIDATION');
  const kept = cache.get(pin);
  if (kept && Date.now() - kept.at < DAY) return kept.answer;

  let body;
  try {
    const res = await fetch(`${config.patients.pincodeLookupUrl}/${pin}`, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    body = await res.json();
  } catch {
    throw new HttpError(502, 'The PIN code service could not be reached. Type the city and state.', 'PINCODE_UNAVAILABLE');
  }
  const offices = Array.isArray(body) && body[0]?.Status === 'Success' ? (body[0].PostOffice ?? []) : [];
  if (!offices.length) throw new HttpError(404, 'This PIN code was not found. Check it, or type the city and state.', 'PINCODE_NOT_FOUND');

  const answer = {
    pincode: pin,
    city: offices[0].District ?? '',
    state: offices[0].State ?? '',
    areas: [...new Set(offices.map((o) => o.Name).filter(Boolean))].slice(0, 50),
  };
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
  cache.set(pin, { at: Date.now(), answer });
  return answer;
}
