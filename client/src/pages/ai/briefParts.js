// The AI brief names patients by labels such as [P3] (their names never go to the AI); the server sends back who
// each label is, for the patients named. These helpers turn a point into words and patient links.

const LABEL = /\[(P\d+)\]/g;

/**
 * "[P3] and [P5] are due" → [{ patient, label: 'P3' }, { text: ' and ' }, { patient, label: 'P5' }, { text: ' are due' }].
 * A label the server did not name stays as "a patient".
 */
export function briefParts(text, patients = {}) {
  const parts = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(LABEL)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const patient = patients[m[1]];
    parts.push(patient ? { patient, label: m[1] } : { text: 'a patient' });
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) parts.push({ text: text.slice(last) });
  return parts;
}

/** How to show a named patient: with her patient number when another patient named in the brief has the same name. */
export function briefNamer(patients = {}) {
  const count = new Map();
  for (const p of Object.values(patients)) count.set(p.fullName, (count.get(p.fullName) ?? 0) + 1);
  return (p) => (count.get(p.fullName) > 1 && p.mrn ? `${p.fullName} (${p.mrn})` : p.fullName);
}

/** The brief's request for the calendar: only the choices that are set (the server fills in the rest). */
export function calendarBriefBody({ view, date, types, scope }) {
  return Object.fromEntries(Object.entries({ view, date, types, scope }).filter(([, v]) => v));
}
