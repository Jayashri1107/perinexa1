// PIN code → city (the district) and state, from India Post's All India Pincode Directory (client/public/pincodes.json,
// made by scripts/build-pincodes.mjs). Owner, 27 Oct 2026: kept inside Perinexa, so a PIN never leaves the hospital.
// The list (about 260 KB) is loaded once, the first time a full PIN is typed.

let list = null;

/** { city, state } for a 6-digit Indian PIN code, or null (not a PIN, not in the list, or the list could not load). */
export async function lookupPin(pin) {
  if (!/^[1-9]\d{5}$/.test(pin ?? '')) return null;
  list ??= fetch('/pincodes.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('PIN list not loaded'))));
  let data;
  try {
    data = await list;
  } catch {
    list = null; // tried again with the next PIN
    return null;
  }
  return placeOf(data, pin);
}

/** The place of a PIN in a loaded list (no network – also for tests). */
export function placeOf(data, pin) {
  const i = data.pins[pin];
  if (i === undefined) return null;
  const [city, s] = data.districts[i];
  return { city, state: data.states[s] };
}
