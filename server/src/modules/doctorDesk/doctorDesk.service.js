// The doctor's desk (owner, 9 Oct 2026) – Today for doctors and RMOs, clinical-task first:
//  - my patients in hospital: ward, bed, diagnosis (the admission note's provisional diagnosis, else the reason for
//    admission), the last ward round, and what is open on each;
//  - clinical alerts: red flags from the approved rules (abnormal vital signs, lab results), results outside range not
//    yet reviewed, and what nurses and the lab escalated (doses not given in 24 hours, samples rejected, lab questions);
//  - pending reviews: lab reports to verify, ward documents to sign, discharge summaries ready for review;
//  - ward rounds due today (no round note today).
// A doctor's patients: stays under her and patients assigned to her; an RMO (all records) sees everyone in hospital.
import { config } from '../../config/index.js';
import { dayRange, todayLocal } from '../../core/dates.js';
import { HttpError } from '../../core/httpError.js';
import { toObjectId } from '../../core/validate.js';
import { Admission, InpatientDocument, NursingEntry } from '../admissions/admission.model.js';
import { stayFlags } from '../admissions/admission.service.js';
import { recordAudit } from '../audit/audit.service.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { isAbnormal } from '../lab/labTests.js';
import { approvedEntries } from '../library/library.service.js';
import { Patient } from '../patients/patient.model.js';

const HOUR = 3600_000;
const NOT_GIVEN = ['refused', 'withheld', 'missed'];
const DOC_WORDS = { admission: 'Admission note', round: 'Round note', delivery: 'Delivery note', operation: 'Operation note', discharge: 'Discharge summary' };
const ageOf = (p) => (p.birthDate ? Math.floor((Date.now() - new Date(p.birthDate)) / (365.25 * 24 * HOUR)) : null);

export async function desk(req) {
  const roles = req.membership.roles;
  if (!roles.some((r) => config.prescriberRoles.includes(r))) throw new HttpError(403, 'The doctor’s desk is for doctors and RMOs.', 'FORBIDDEN');
  const hid = toObjectId(req.hospitalId);
  const me = req.user._id;
  const seesAll = roles.some((r) => config.access.patientsAllRecords.includes(r));
  const now = new Date();
  const [todayStart] = dayRange(todayLocal());

  // my patients: assigned to me (all, for the count) and those of them – or under me – in hospital now
  const assigned = await Patient.find({ hospitalId: hid, assignedDoctorId: me, status: 'active' }).select('_id').lean();
  const assignedIds = assigned.map((p) => p._id);
  const stays = await Admission.find({ hospitalId: hid, status: 'admitted', ...(!seesAll && { $or: [{ doctorId: me }, { patientId: { $in: assignedIds } }] }) }).sort({ ward: 1, bed: 1 }).lean();
  const stayIds = stays.map((s) => s._id);
  const patientIds = [...new Set([...assignedIds, ...stays.map((s) => s.patientId)].map(String))].map(toObjectId);

  const [patients, docs, notGiven, labReported, labRecollect, labQuestions, rules] = await Promise.all([
    Patient.find({ hospitalId: hid, _id: { $in: stays.map((s) => s.patientId) } }).lean(),
    InpatientDocument.find({ hospitalId: hid, admissionId: { $in: stayIds }, status: { $ne: 'cancelled' } }).select('admissionId kind status content.at content.provisionalDiagnosis createdAt signed readyForReview').lean(),
    NursingEntry.find({ hospitalId: hid, admissionId: { $in: stayIds }, kind: 'dose', outcome: { $in: NOT_GIVEN }, cancelled: null, at: { $gte: new Date(now - 24 * HOUR) } }).sort({ at: -1 }).lean(),
    LabOrder.find({ hospitalId: hid, status: 'reported', ...(!seesAll && { $or: [{ 'ordered.by': me }, { patientId: { $in: patientIds } }] }) }).sort({ 'reported.at': 1 }).limit(50).lean(),
    LabOrder.find({ hospitalId: hid, status: 'ordered', recollect: true, ...(!seesAll && { $or: [{ 'ordered.by': me }, { patientId: { $in: patientIds } }] }) }).limit(20).lean(),
    LabOrder.find({ hospitalId: hid, status: { $in: ['ordered', 'collected'] }, 'queries.0': { $exists: true }, 'ordered.by': me }).limit(20).lean(),
    approvedEntries(req.hospitalId, 'red_flag_rules').then((e) => e.flatMap((x) => x.content.rules ?? [])),
  ]);
  const pById = new Map(patients.map((p) => [String(p._id), p]));
  const labPatients = new Map(
    (await Patient.find({ hospitalId: hid, _id: { $in: [...labReported, ...labRecollect, ...labQuestions].map((o) => o.patientId) } }).select('name patientNumber').lean()).map((p) => [String(p._id), p]),
  );
  const who = (id) => labPatients.get(String(id)) ?? pById.get(String(id)) ?? { name: '', patientNumber: '' };

  const alerts = [];
  const myPatients = [];
  for (const s of stays) {
    const p = pById.get(String(s.patientId));
    if (!p) continue;
    const mine = docs.filter((d) => String(d.admissionId) === String(s._id));
    const admissionNote = mine.filter((d) => d.kind === 'admission').sort((a, b) => b.createdAt - a.createdAt)[0];
    const rounds = mine.filter((d) => d.kind === 'round').sort((a, b) => new Date(b.content?.at ?? b.createdAt) - new Date(a.content?.at ?? a.createdAt));
    const lastRoundAt = rounds[0] ? new Date(rounds[0].content?.at ?? rounds[0].createdAt) : null;
    const flags = rules.length ? await stayFlags(req, s, p, rules) : [];
    const doses = notGiven.filter((e) => String(e.admissionId) === String(s._id));
    const where = `${s.ward}${s.bed ? `, bed ${s.bed}` : ''}`;
    for (const f of flags) alerts.push({ kind: 'flag', level: f.level, title: f.label, detail: f.message ?? '', patient: { name: p.name, patientNumber: p.patientNumber }, where, link: `/hospital/inpatients/${s._id}` });
    for (const e of doses) alerts.push({ kind: 'dose', level: 'watch', title: `Dose ${e.outcome}: ${e.medicine?.drug ?? ''}`, detail: `${e.reason} – ${e.byName}`, at: e.at, patient: { name: p.name, patientNumber: p.patientNumber }, where, link: `/hospital/inpatients/${s._id}?tab=care` });
    myPatients.push({
      id: String(s._id),
      patient: { id: String(p._id), name: p.name, patientNumber: p.patientNumber, age: ageOf(p), allergies: p.allergies ?? '' },
      ward: s.ward,
      bed: s.bed,
      admittedAt: s.admittedAt,
      diagnosis: admissionNote?.content?.provisionalDiagnosis || s.reason || '',
      lastRoundAt,
      roundDue: !lastRoundAt || lastRoundAt < todayStart,
      drafts: mine.filter((d) => d.status === 'draft').length,
      urgent: flags.some((f) => f.level === 'urgent'),
      alerts: flags.length + doses.length,
    });
  }

  // results outside range not yet reviewed, rejected samples, the lab's questions
  for (const o of labReported) {
    const outside = o.tests.flatMap((t) => t.values ?? []).filter((v) => isAbnormal(v.flag)).length;
    if (outside) alerts.push({ kind: 'lab', level: 'urgent', title: `${o.tests.map((t) => t.name).join(', ')}: ${outside} outside range`, detail: `${o.orderNumber} · to review`, at: o.reported?.at, patient: who(o.patientId), link: `/hospital/lab/orders/${o._id}` });
  }
  for (const o of labRecollect) {
    const last = o.rejections?.at(-1);
    alerts.push({ kind: 'lab', level: 'watch', title: 'Lab sample rejected – new sample needed', detail: `${o.orderNumber}${last ? ` · ${last.reason}` : ''}`, at: last?.at, patient: who(o.patientId), link: `/hospital/lab/orders/${o._id}` });
  }
  for (const o of labQuestions) {
    const q = o.queries.at(-1);
    alerts.push({ kind: 'lab', level: 'watch', title: 'The lab has a question', detail: `${o.orderNumber} · ${q.text}`, at: q.at, patient: who(o.patientId), link: `/hospital/lab/orders/${o._id}` });
  }
  alerts.sort((a, b) => (a.level === b.level ? new Date(b.at ?? 0) - new Date(a.at ?? 0) : a.level === 'urgent' ? -1 : 1));

  // what waits for this doctor's signature or review
  const stayById = new Map(stays.map((s) => [String(s._id), s]));
  const reviews = [
    ...labReported.map((o) => ({ kind: 'lab', title: `Lab report: ${o.tests.map((t) => t.name).join(', ')}`, detail: o.orderNumber, at: o.reported?.at, outside: o.tests.flatMap((t) => t.values ?? []).filter((v) => isAbnormal(v.flag)).length, patient: who(o.patientId), link: `/hospital/lab/orders/${o._id}` })),
    ...docs
      .filter((d) => d.status === 'draft')
      .map((d) => {
        const s = stayById.get(String(d.admissionId));
        const p = pById.get(String(s?.patientId)) ?? { name: '', patientNumber: '' };
        return { kind: 'document', title: `${DOC_WORDS[d.kind] ?? 'Document'} to ${d.readyForReview ? 'review and sign' : 'finish and sign'}`, detail: `${s?.ward ?? ''}${s?.bed ? `, bed ${s.bed}` : ''}`, at: d.createdAt, ready: Boolean(d.readyForReview), patient: { name: p.name, patientNumber: p.patientNumber }, link: `/hospital/inpatients/${d.admissionId}?tab=documents` };
      }),
  ].sort((a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0));

  await recordAudit(req, 'DOCTOR_DESK_VIEWED', { hospitalId: req.hospitalId, details: { inHospital: myPatients.length, alerts: alerts.length } });
  const roundsDue = myPatients.filter((x) => x.roundDue).length;
  return {
    counts: {
      underCare: assignedIds.length,
      inHospital: myPatients.length,
      reviewsDue: reviews.filter((r) => r.kind === 'document').length,
      reportsToReview: labReported.length,
      roundsDue,
      alerts: alerts.length,
      urgentAlerts: alerts.filter((a) => a.level === 'urgent').length,
    },
    myPatients: myPatients.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.alerts - a.alerts || `${a.ward}${a.bed}`.localeCompare(`${b.ward}${b.bed}`, undefined, { numeric: true })),
    alerts: alerts.slice(0, 30),
    reviews: reviews.slice(0, 30),
    rulesApproved: rules.length > 0,
    seesAll,
  };
}
