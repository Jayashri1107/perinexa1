// Beds (owner, 13 Oct 2026 – docs/RECEPTION_ADMISSION_PLAN.md): the reasons reception chooses from (same list as
// server/src/inpatient/beds.js REASONS) and small helpers for the bed board.

export const REASONS = [
  ['labour', 'Labour'],
  ['caesarean_planned', 'Caesarean section – planned'],
  ['observation', 'Observation'],
  ['surgery', 'Other surgery'],
  ['newborn_care', 'Newborn care'],
  ['other', 'Other'],
];

/** "G1, G2, G3" or "G1-G10" (or "G1–G10") → the bed names. A range keeps the letters before the numbers. */
export function bedNames(text) {
  const out = [];
  for (const part of String(text ?? '').split(/[,\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const range = t.match(/^([^\d]*)(\d+)\s*[-–]\s*(?:\1)?(\d+)$/);
    if (range) {
      const [, prefix, from, to] = range;
      const a = Number(from);
      const b = Number(to);
      if (b >= a && b - a < 100) {
        for (let n = a; n <= b; n += 1) out.push(`${prefix}${n}`);
        continue;
      }
    }
    out.push(t);
  }
  return [...new Set(out)];
}

/** The free beds of the board, for choosing one: [{ id, label: "General ward · G2" }]. */
export const freeBeds = (wards = []) => wards.flatMap((w) => w.beds.filter((b) => !b.stay && b.active).map((b) => ({ id: b.id, ward: w.ward, name: b.name, label: `${w.ward} · ${b.name}` })));

/** The value for a datetime-local box: now, in this computer's time. */
export function nowLocal(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
