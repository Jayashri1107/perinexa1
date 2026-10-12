import { Router } from 'express';
import { z } from 'zod';
import { appointmentView, statesFor } from '../appointments/appointmentService.js';
import { hospitalToday } from '../careplans/dates.js';
import { carePlansForCopy, planCtx } from '../careplans/plansService.js';
import { RETIRED_FORM_KEYS, retiredFormIds } from '../consents/retiredForms.js';
import { admissionView, documentView, entryView } from '../inpatient/inpatientView.js';
import { Admission } from '../models/Admission.js';
import { Appointment } from '../models/Appointment.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { NursingEntry } from '../models/NursingEntry.js';
import { Patient } from '../models/Patient.js';
import { PatientConsent } from '../models/PatientConsent.js';
import { PatientNote } from '../models/PatientNote.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { WorkDone } from '../models/WorkDone.js';
import { NOT_DUPLICATE } from '../patients/duplicateRules.js';
import { earlierRecordsFor } from '../patients/duplicateService.js';
import {
  appointmentForCopy,
  catalogueFor,
  consentForCopy,
  documentForCopy,
  labOrderForCopy,
  noteForCopy,
  nursingEntryForCopy,
  patientForCopy,
  planForCopy,
  stayForCopy,
  visitForCopy,
  workForCopy,
} from '../patients/recordCopyView.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { mayCopyRecord, patientAccess, projectPatient } from '../utils/patientAccess.js';
import { findPatient, loadPatientForPlan } from '../utils/patientLookup.js';
import { parse } from '../utils/validate.js';
import { visitView } from '../visits/visitView.js';
import { labAccess, orderView } from './lab.js';
import { workDoneView } from './workDone.js';

// A complete copy of one patient's record: /api/patients/:id/record-copy. Mounted inside the patients router, after
// its role gate. For the patient herself (her right to a copy of her data – Digital Personal Data Protection Act
// 2023) and for referrals.
//  - GET  /         everything in her record, oldest first, as one answer; the website shows it in a print preview.
//                   Audited as PATIENT_RECORD_COPIED ("Full record copied").
//  - POST /printed  { as: 'paper' | 'pdf' }: the copy was printed, or saved as a PDF (made in the browser).
// Who: only someone with full clinical access to THIS record – her doctor (any doctor while she has none) or an
// RMO (utils/patientAccess.js mayCopyRecord). Never reception, nurses, the lab, the pharmacist or an admin; another
// doctor's patient, sensitive or not, is refused. A patient of another hospital is "not found".
// What is in it and what is always left out: patients/recordCopyView.js. It is put together from the views the
// screens already use, so nothing reaches a copy that its reader could not already see on the screens.
// The audit log gets the record's id and number only – never what the copy held.

export const recordCopyRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

// A copy must be complete. A record has far fewer entries than this; if one ever has more, the newest are copied
// and the copy says which part is not complete (`cut`) – it never looks complete when it is not.
export const COPY_LIMITS = { visits: 1000, labOrders: 1000, stays: 200, documents: 3000, nursing: 10000, consents: 1000, appointments: 1000, workDone: 1000, notes: 500, carePlans: 50 };

function assertCanCopy(req, patient) {
  const access = patientAccess(req, patient);
  if (mayCopyRecord(access)) return access;
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden("Only the patient's doctor or an RMO can make a copy of the whole record.");
  if (patient.sensitive) throw forbidden('This is a sensitive record: only the treating doctor or an RMO can make a copy of the whole record.');
  throw forbidden("This is another doctor's patient: ask that doctor or an RMO for a copy of the whole record.");
}

const ids = (patient, access) => ({ patientId: String(patient._id), mrn: patient.mrn, access: access.level });

/** The newest `limit` rows of a query sorted newest first, turned oldest first; more: there were more than that. */
async function newest(query, limit) {
  const rows = await query.limit(limit + 1);
  return { rows: rows.slice(0, limit).reverse(), more: rows.length > limit };
}

/** Her own details as this person may see them, with the people linked to her reduced to patient numbers. */
async function patientPart(req, patient, access) {
  const tenantId = req.tenantId;
  const [doctor, createdBy, mother, earlier] = await Promise.all([
    patient.assignedDoctor ? User.findById(patient.assignedDoctor, { name: 1 }).lean() : null,
    User.findById(patient.createdBy, { name: 1 }).lean(),
    patient.careType === 'newborn' && patient.newborn?.mother ? Patient.findOne({ _id: patient.newborn.mother, tenantId }, { mrn: 1 }).lean() : null,
    earlierRecordsFor(req, patient),
  ]);
  // Her babies – also those linked to an earlier record of hers (as on her page) – by patient number only
  const babies =
    patient.careType === 'newborn'
      ? []
      : await Patient.find({ tenantId, 'newborn.mother': { $in: [patient._id, ...earlier.ids] }, ...NOT_DUPLICATE }, { mrn: 1 }).sort({ 'newborn.birthAt': 1, _id: 1 }).lean();
  const full = {
    ...patient.toJSON(),
    assignedDoctorName: doctor?.name ?? null,
    createdByName: createdBy?.name ?? null,
    motherInfo: mother ? { mrn: mother.mrn } : null,
    babies: babies.map((b) => ({ mrn: b.mrn })),
    earlierRecords: earlier.shown.map((r) => ({ mrn: r.mrn })),
  };
  // projectPatient first (the need-to-know rules), then only what belongs on a copy
  return patientForCopy(projectPatient(full, access));
}

/** Her stays, each with its documents and nursing chart, oldest first. */
async function staysPart(req, patient, cut) {
  const tenantId = req.tenantId;
  const stays = await newest(Admission.find({ tenantId, patientId: patient._id }).sort({ admittedAt: -1, _id: -1 }), COPY_LIMITS.stays);
  if (stays.more) cut.push('stays');
  if (!stays.rows.length) return [];
  const stayIds = stays.rows.map((s) => s._id);
  const [docs, entries] = await Promise.all([
    newest(ClinicalDocument.find({ tenantId, patientId: patient._id, admissionId: { $in: stayIds } }).sort({ createdAt: -1, _id: -1 }), COPY_LIMITS.documents),
    newest(NursingEntry.find({ tenantId, patientId: patient._id, admissionId: { $in: stayIds } }).sort({ at: -1, _id: -1 }), COPY_LIMITS.nursing),
  ]);
  if (docs.more) cut.push('documents');
  if (entries.more) cut.push('nursing');
  const byTime = (a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0);
  return stays.rows.map((s) =>
    stayForCopy(
      admissionView(s),
      docs.rows
        .filter((d) => d.admissionId.equals(s._id))
        .map((d) => documentForCopy(documentView(d)))
        .sort(byTime),
      entries.rows.filter((e) => e.admissionId.equals(s._id)).map((e) => nursingEntryForCopy(entryView(e))),
    ),
  );
}

/** Her appointments, oldest first: the day, the time or token, the doctor and what became of it. */
async function appointmentsPart(req, patient, cut) {
  const tenantId = req.tenantId;
  const found = await newest(Appointment.find({ tenantId, patientId: patient._id }).sort({ on: -1, start: -1, token: -1, _id: -1 }).lean(), COPY_LIMITS.appointments);
  if (found.more) cut.push('appointments');
  if (!found.rows.length) return [];
  const doctorIds = [...new Set(found.rows.map((a) => String(a.doctorId)))];
  const [doctors, states] = await Promise.all([User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean(), statesFor(tenantId, found.rows)]);
  const names = new Map(doctors.map((d) => [String(d._id), d.name]));
  const today = hospitalToday(req.now);
  // (no patient lookup and no fees: the copy has neither)
  return found.rows.map((a) => appointmentForCopy(appointmentView(a, { patients: new Map(), doctors: names, states, today })));
}

recordCopyRouter.get('/', async (req, res) => {
  // The risk level is brought up to date first, as when her page is opened.
  const patient = await loadPatientForPlan(req);
  const access = assertCanCopy(req, patient);
  const tenantId = req.tenantId;
  const own = { tenantId, patientId: patient._id };
  const cut = [];
  const lab = labAccess(req, patient);
  const retired = await retiredFormIds(tenantId);

  // The care plans first (the current one is brought in step with her details, as on the Care plan tab), then the
  // rest of the record, which only reads.
  const plans = await carePlansForCopy(planCtx(req), patient, { limit: COPY_LIMITS.carePlans });
  if (plans.more) cut.push('carePlans');
  const [patientView, visits, orders, work, notes, consents, stays, appointments] = await Promise.all([
    patientPart(req, patient, access),
    newest(Visit.find(own).sort({ visitOn: -1, createdAt: -1, _id: -1 }), COPY_LIMITS.visits),
    newest(LabOrder.find(own).sort({ createdAt: -1, _id: -1 }), COPY_LIMITS.labOrders),
    newest(WorkDone.find(own).sort({ on: -1, createdAt: -1, _id: -1 }).lean(), COPY_LIMITS.workDone),
    newest(PatientNote.find(own).sort({ createdAt: -1, _id: -1 }).lean(), COPY_LIMITS.notes),
    // Printouts of forms removed from Perinexa stay stored but are never listed (as on the Consent forms tab)
    newest(PatientConsent.find({ ...own, formKey: { $nin: RETIRED_FORM_KEYS }, formId: { $nin: [...retired] } }).sort({ printedAt: -1, _id: -1 }).lean(), COPY_LIMITS.consents),
    staysPart(req, patient, cut),
    appointmentsPart(req, patient, cut),
  ]);
  for (const [key, part] of Object.entries({ visits, labOrders: orders, workDone: work, notes, consents })) if (part.more) cut.push(key);

  const labOrders = orders.rows.map((o) => labOrderForCopy({ ...orderView(o, lab), collectedAtReport: o.collectedAtReport === true }));
  const copy = {
    madeAt: req.now,
    today: hospitalToday(req.now),
    patient: patientView,
    emergencyNotes: notes.rows.map(noteForCopy),
    // The private note is never asked for (notes: false), whoever makes the copy
    visits: visits.rows.map((v) => visitForCopy(visitView(v, { notes: false }))),
    carePlans: plans.plans.map(planForCopy),
    labOrders,
    catalogue: catalogueFor(labOrders),
    workDone: work.rows.map((w) => workForCopy(workDoneView(w))),
    stays,
    consents: consents.rows.map(consentForCopy),
    appointments,
    cut,
  };
  await audit(req, 'PATIENT_RECORD_COPIED', { details: ids(patient, access) });
  res.json({ copy });
});

// The copy was printed, or saved as a PDF (both are made in the browser): recorded like the other printouts.
const printedSchema = z.object({ as: z.enum(['paper', 'pdf'], 'Choose paper or PDF') }).strict();
recordCopyRouter.post('/printed', async (req, res) => {
  const patient = await findPatient(req);
  const access = assertCanCopy(req, patient);
  const { as } = parse(printedSchema, req.body);
  await audit(req, as === 'paper' ? 'PATIENT_RECORD_COPY_PRINTED' : 'PATIENT_RECORD_COPY_PDF_SAVED', { details: ids(patient, access) });
  res.json({ printed: true });
});
