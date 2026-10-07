// A patient's medical history on one page (added 7 Oct 2026 at the owner's request), for those who read her record
// clinically (config.access.patientsClinical, and her record level at least clinicalRead): her stays with their
// discharge cards, her signed visits (diagnosis and medicines), her lab orders and her scanned documents. Read-only;
// each part opens in its own screen. Opening it is in the audit log (ids only).
import { HttpError } from '../../core/httpError.js';
import { atLeast } from '../patients/patientAccess.js';
import { Admission, InpatientDocument } from '../admissions/admission.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { documentView } from '../documents/document.service.js';
import { loadForRecords } from '../documents/recordsAccess.js';
import { MedicalDocument } from '../documents/medicalDocument.model.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { Visit } from '../visits/visit.model.js';

const medicineText = (i) => [i.drug, i.strength].filter(Boolean).join(' ');

export async function medicalHistory(req, patientId) {
  const { patient, level } = await loadForRecords(req, patientId);
  if (!atLeast(level, 'clinicalRead')) throw new HttpError(403, 'The medical history is for those who look after her clinically.', 'FORBIDDEN');
  const hid = req.hospitalId;
  const pid = patient._id;
  const [stays, cards, visits, labs, docs] = await Promise.all([
    Admission.find({ hospitalId: hid, patientId: pid }).sort({ admittedAt: -1 }).limit(100).lean(),
    InpatientDocument.find({ hospitalId: hid, patientId: pid, kind: 'discharge', status: 'signed' }).lean(),
    Visit.find({ hospitalId: hid, patientId: pid, status: 'active' }).sort({ visitOn: -1 }).limit(200).lean(),
    LabOrder.find({ hospitalId: hid, patientId: pid }).sort({ createdAt: -1 }).limit(200).lean(),
    MedicalDocument.find({ hospitalId: hid, patientId: pid, cancelled: null }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);
  const cardByStay = new Map(cards.map((c) => [String(c.admissionId), c]));

  await recordAudit(req, 'HISTORY_VIEWED', { hospitalId: hid, details: { patientId: String(pid) } });
  return {
    patient: { id: String(pid), name: patient.name, patientNumber: patient.patientNumber, bloodGroup: patient.bloodGroup ?? '', allergies: patient.allergies ?? '' },
    stays: stays.map((s) => {
      const card = cardByStay.get(String(s._id));
      return {
        id: String(s._id),
        status: s.status,
        admittedAt: s.admittedAt,
        dischargedAt: s.dischargedAt,
        ward: s.ward,
        reason: s.reason,
        dischargeCard: card ? { id: String(card._id), finalDiagnosis: card.content?.finalDiagnosis ?? '', signedByName: card.signed?.byName ?? '' } : null,
      };
    }),
    visits: visits.map((v) => ({
      id: String(v._id),
      visitOn: v.visitOn,
      signed: Boolean(v.signed),
      diagnosis: v.details?.diagnosis ?? '',
      complaints: v.details?.complaints ?? '',
      medicines: (v.prescription?.items ?? []).map(medicineText),
      doctorName: v.signed?.byName ?? v.createdByName,
    })),
    labOrders: labs.map((o) => ({
      id: String(o._id),
      orderNumber: o.orderNumber,
      orderedAt: o.ordered?.at ?? o.createdAt,
      status: o.status,
      tests: (o.tests ?? []).map((t) => t.name),
    })),
    documents: docs.map(documentView),
  };
}
