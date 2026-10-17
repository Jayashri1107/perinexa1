// Admission like a hospital system (owner, 17 Oct 2026 – docs/ADMISSION_DESK_PLAN.md): IPD, OPD and gate-pass numbers,
// the admission checklist at the desk, and what the admission form, the wristband and the gate pass print.
import { z } from 'zod';
import { hospitalToday } from '../careplans/dates.js';
import { nextNumber } from '../models/Counter.js';
import { ID_PROOF_TYPES, PAYER_TYPES, currentAge } from '../models/Patient.js';
import { patientAccess } from '../utils/patientAccess.js';
import { safeText } from '../utils/pcpndt.js';
import { reasonFor } from './beds.js';

/** "IP-2026-000001" / "OP-2026-000001" / "GP-2026-000001": a per-hospital, per-year number (the hospital's year). */
export async function yearNumber(tenantId, prefix, now = new Date()) {
  const year = hospitalToday(now).getUTCFullYear();
  const n = await nextNumber(tenantId, `${prefix.toLowerCase()}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}
export const nextIpdNo = (tenantId, now) => yearNumber(tenantId, 'IP', now);
export const nextOpdNo = (tenantId, now) => yearNumber(tenantId, 'OP', now);
export const nextPassNo = (tenantId, now) => yearNumber(tenantId, 'GP', now);

// ---------- The checklist ----------

export const checklistSchema = z
  .object({
    idProof: z.enum([...ID_PROOF_TYPES, '']).default(''),
    idLast4: z.string().trim().regex(/^[A-Za-z0-9]{0,4}$/, 'Only the last 4 letters or digits of the ID – never the whole number').default(''),
    attendantName: safeText('Attendant', 100).default(''),
    attendantRelation: safeText('Relation', 40).default(''),
    attendantPhone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'Write the phone number in digits').default(''),
    payer: z.enum([...PAYER_TYPES, '']).default(''),
    payerName: safeText('Insurer or scheme', 100).default(''),
    consentSigned: z.boolean().default(false),
  })
  .strict();

/** What is still missing from a checklist: { field: words } (empty when complete). */
export function checklistMissing(c) {
  const m = {};
  if (!c?.idProof) m['checklist.idProof'] = 'Choose the ID proof you saw.';
  else if ((c.idLast4 ?? '').length !== 4) m['checklist.idLast4'] = 'Write its last 4 letters or digits.';
  if (!c?.attendantName?.trim()) m['checklist.attendantName'] = "Write the attendant's name.";
  if ((c?.attendantPhone ?? '').replace(/\D/g, '').length < 10) m['checklist.attendantPhone'] = "Write the attendant's phone number.";
  if (!c?.payer) m['checklist.payer'] = 'Choose who pays.';
  else if (['insurance', 'govt_scheme', 'corporate'].includes(c.payer) && !c.payerName?.trim()) m['checklist.payerName'] = 'Write the insurer, scheme or employer.';
  if (!c?.consentSigned) m['checklist.consentSigned'] = 'The general consent for admission must be signed.';
  return m;
}

/** The checklist as stored on the stay: the answers, whether it is complete, and who filled it in. */
export const checklistDoc = (req, c) => ({ ...c, idLast4: (c.idLast4 ?? '').toUpperCase(), complete: Object.keys(checklistMissing(c)).length === 0, by: req.user._id, byName: req.user.name, at: req.now ?? new Date() });

/** Her record's details as a first answer (ID proof, payer, emergency contact as the attendant). */
export const checklistFromRecord = (p) => ({
  idProof: p.idProof?.kind ?? '',
  idLast4: p.idProof?.last4 ?? '',
  attendantName: p.emergencyContact?.name ?? '',
  attendantRelation: p.emergencyContact?.relation ?? '',
  attendantPhone: p.emergencyContact?.phone ?? '',
  payer: p.payer?.type ?? '',
  payerName: p.payer?.name ?? '',
  consentSigned: false,
});

export const checklistView = (c) =>
  c
    ? {
        idProof: c.idProof ?? '',
        idLast4: c.idLast4 ?? '',
        attendantName: c.attendantName ?? '',
        attendantRelation: c.attendantRelation ?? '',
        attendantPhone: c.attendantPhone ?? '',
        payer: c.payer ?? '',
        payerName: c.payerName ?? '',
        consentSigned: Boolean(c.consentSigned),
        complete: Boolean(c.complete),
        byName: c.byName ?? '',
        at: c.at ?? null,
      }
    : null;

// ---------- The papers ----------

/**
 * What the admission form, the wristband and the gate pass print, for this person. Blood group and allergies only
 * for those who may see her medical details; the reason as the bed board shows it to them (inpatient/beds.js).
 */
export function papersFor(req, patient, stay, doctorName) {
  const a = patientAccess(req, patient);
  const medical = a.view.has('pregnancy');
  return {
    ipdNo: stay.ipdNo ?? null,
    admittedAt: stay.admittedAt,
    admissionType: stay.admissionType ?? null,
    mlc: Boolean(stay.mlc),
    mlcPolice: stay.mlcPolice ?? '',
    ward: stay.ward ?? '',
    bed: stay.bed ?? '',
    reason: reasonFor(req, patient, stay),
    admittedByName: stay.admittedByName,
    status: stay.status,
    dischargedAt: stay.dischargedAt ?? null,
    checklist: checklistView(stay.checklist),
    clearance: stay.clearance ? { byName: stay.clearance.byName, at: stay.clearance.at, passNo: stay.clearance.passNo, balancePaise: stay.clearance.balancePaise, note: stay.clearance.note ?? '' } : null,
    patient: {
      fullName: patient.fullName,
      mrn: patient.mrn,
      age: patient.careType === 'newborn' ? null : currentAge(patient),
      careType: patient.careType,
      phone: a.view.has('phone') ? (patient.phone ?? '') : '',
      address: a.view.has('address') ? [patient.address, patient.city, patient.state, patient.pinCode].filter(Boolean).join(', ') : '',
      doctorName: doctorName ?? '',
      ...(medical ? { bloodGroup: patient.medical?.bloodGroup ?? '', allergies: patient.medical?.allergies ?? '' } : {}),
    },
    medical,
  };
}
