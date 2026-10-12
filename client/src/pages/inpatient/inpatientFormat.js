// Inpatient documents (Version 2): the words the website shows. The server has the same lists
// (server/src/inpatient/docSchemas.js).
import { BadgeCheck, CircleMinus, PenLine, UserCheck } from 'lucide-react';

export const DOC_KINDS = ['admission', 'round', 'delivery', 'operation', 'discharge'];
export const KIND_LABELS = { admission: 'Admission note', round: 'Round note', delivery: 'Delivery note', operation: 'Operation note', discharge: 'Discharge card' };
/** Who signs (server SIGNED_BY): delivery, operation and discharge are confirmed by a doctor. */
export const DOCTOR_CONFIRMS = ['delivery', 'operation', 'discharge'];
export const ONE_PER_STAY = ['admission', 'discharge'];

export const DELIVERY_MODE_LABELS = { normal: 'Normal vaginal delivery', vacuum: 'Vacuum-assisted', forceps: 'Forceps', lscs: 'Caesarean section (LSCS)', other: 'Other' };
export const LABOUR_ONSET_LABELS = { spontaneous: 'Spontaneous', induced: 'Induced', not_in_labour: 'Not in labour (elective)' };
export const PERINEUM_LABELS = { intact: 'Intact', episiotomy: 'Episiotomy', tear_1: '1st-degree tear', tear_2: '2nd-degree tear', tear_3: '3rd-degree tear', tear_4: '4th-degree tear' };
export const BABY_SEX_LABELS = { female: 'Female', male: 'Male', indeterminate: 'Indeterminate' };
export const OUTCOME_LABELS = { live: 'Live birth', stillbirth: 'Stillbirth' };
export const ANAESTHESIA_LABELS = { spinal: 'Spinal', epidural: 'Epidural', general: 'General', local: 'Local', other: 'Other' };

/** The status of a document as colour + icon + words. */
export function docStatusLook(doc) {
  if (doc.status === 'cancelled') return { tone: 'inactive', icon: CircleMinus, word: 'Entered in error' };
  if (doc.status === 'signed') return { tone: 'stable', icon: BadgeCheck, word: DOCTOR_CONFIRMS.includes(doc.kind) ? 'Confirmed' : 'Signed' };
  return DOCTOR_CONFIRMS.includes(doc.kind) ? { tone: 'watch', icon: UserCheck, word: 'Draft – waiting for a doctor' } : { tone: 'watch', icon: PenLine, word: 'Draft' };
}

/** The time a document is about (the round's time, the delivery, the operation, the discharge), or when it was written. */
export function docTime(doc) {
  const c = doc.content ?? {};
  return c.at ?? c.deliveredAt ?? c.performedAt ?? c.dischargedAt ?? doc.createdAt;
}

/** "BP 120/80 · Pulse 88 · Temp 98.6 °F · SpO2 98%" */
export function vitalsLine(v) {
  if (!v) return '';
  return [
    v.bpSystolic != null && v.bpDiastolic != null && `BP ${v.bpSystolic}/${v.bpDiastolic}`,
    v.pulse != null && `Pulse ${v.pulse}`,
    v.temperatureF != null && `Temp ${v.temperatureF} °F`,
    v.spo2 != null && `SpO2 ${v.spo2}%`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The date-and-time input's value ("2026-10-01T11:30") for a saved time, in this computer's time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** The time to save, from the input's value (empty → null). */
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
