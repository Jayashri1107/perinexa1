import { caesareanTimes } from '../clinical/caesarean.js';
import { robsonGroup, robsonMissing } from '../clinical/robson.js';
import { groupARules } from './docSchemas.js';
import { dischargeTypeFor } from './dischargeTypes.js';
// What the website receives about stays, documents and the nursing chart (pure). Never staff ids.

// medical: may this person see why a record is closed (doctors, RMOs, nurses)? Otherwise a death discharge reads
// "Record closed" (inpatient/dischargeTypes.js). bill: the stay's bill as the ward sees it – final or not, no amounts.
export const admissionView = (a, { medical = false, bill = undefined } = {}) => ({
  id: String(a._id),
  patientId: String(a.patientId),
  careType: a.careType,
  admittedAt: a.admittedAt,
  ward: a.ward ?? '',
  bed: a.bed ?? '',
  reason: a.reason ?? '',
  admissionType: a.admissionType ?? null,
  mlc: Boolean(a.mlc),
  ipdNo: a.ipdNo ?? null, // docs/ADMISSION_DESK_PLAN.md
  checklistIncomplete: Boolean(a.checklist) && !a.checklist.complete,
  cleared: a.clearance ? { passNo: a.clearance.passNo, byName: a.clearance.byName, at: a.clearance.at } : null,
  status: a.status,
  dischargedAt: a.dischargedAt ?? null,
  admittedByName: a.admittedByName,
  dischargedByName: a.dischargedByName ?? null,
  // The discharge recorded at the desk after the card (9 Nov 2026 – docs/IPD_DISCHARGE_BILLING_PLAN.md)
  discharge: a.dischargeInfo
    ? { ...dischargeTypeFor(a.dischargeInfo.type, { medical }), doctorName: a.dischargeInfo.doctorName ?? '', remark: a.dischargeInfo.remark ?? '', byName: a.dischargeInfo.byName ?? '', at: a.dischargeInfo.at ?? null }
    : null,
  ...(bill !== undefined ? { bill: bill ? { number: bill.number, final: bill.final ? { byName: bill.final.byName ?? '', at: bill.final.at ?? null } : null } : null } : {}),
});

export const documentView = (d) => ({
  id: String(d._id),
  admissionId: String(d.admissionId),
  kind: d.kind,
  status: d.status,
  content: d.content ?? {},
  rev: d.rev ?? 0,
  createdByName: d.createdByName,
  createdAt: d.createdAt,
  savedByName: d.savedByName ?? null,
  savedAt: d.savedAt ?? null,
  signed: d.signed ? { byName: d.signed.byName, role: d.signed.role, at: d.signed.at } : null,
  cancelled: d.cancelled ? { reason: d.cancelled.reason, byName: d.cancelled.byName, at: d.cancelled.at } : null,
  additions: (d.additions ?? []).map((x) => ({ id: String(x._id), text: x.text, byName: x.byName, at: x.at })),
  // When each time was typed (PX-X-04), and – on a delivery note – what is worked out from the stored times
  timesEnteredAt: d.timesEnteredAt ?? {},
  ...(d.kind === 'delivery' ? { derived: deliveryDerived(d.content ?? {}) } : {}),
  groupARules: d.kind === 'delivery' ? groupARules(d) : false,
});

/** The Robson group and the caesarean's interval, worked out from the note (never typed). */
export function deliveryDerived(c) {
  return { robsonGroup: robsonGroup(c), robsonMissing: robsonMissing(c), caesarean: c.mode === 'lscs' ? caesareanTimes(c) : null };
}

export const entryView = (e) => ({
  id: String(e._id),
  kind: e.kind,
  at: e.at,
  vitals: e.kind === 'vitals' ? { bpSystolic: e.vitals?.bpSystolic ?? null, bpDiastolic: e.vitals?.bpDiastolic ?? null, pulse: e.vitals?.pulse ?? null, temperatureF: e.vitals?.temperatureF ?? null, spo2: e.vitals?.spo2 ?? null } : null,
  medicine: e.kind === 'medicine' ? { drug: e.medicine?.drug ?? '', dose: e.medicine?.dose ?? '', route: e.medicine?.route ?? '' } : null,
  note: e.note ?? '',
  escalatedTo: e.kind === 'escalation' ? (e.escalatedTo ?? '') : '',
  highAlert: Boolean(e.highAlert),
  discarded: e.discarded ?? '',
  witness: e.witness ? { byName: e.witness.byName, role: e.witness.role, at: e.witness.at } : null,
  byName: e.byName,
  cancelled: e.cancelled ? { reason: e.cancelled.reason, byName: e.cancelled.byName, at: e.cancelled.at } : null,
});
