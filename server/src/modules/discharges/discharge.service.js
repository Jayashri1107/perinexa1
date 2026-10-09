// Discharge cards for the front desk (added 7 Oct 2026 at the owner's request): the recent discharges, and one signed
// discharge card with the hospital's letterhead for printing or saving as PDF. Only SIGNED discharge cards – never
// drafts, other ward documents, notes or the nursing chart. Who may open them: recordsAccess.js. Every list and every
// card opened is in the audit log (ids only).
import { config } from '../../config/index.js';
import { notFoundError } from '../../core/httpError.js';
import { containsText, escapeRegex, toObjectId } from '../../core/validate.js';
import { Admission, InpatientDocument } from '../admissions/admission.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { getSettings } from '../hospitalSettings/hospitalSettings.service.js';
import { Patient } from '../patients/patient.model.js';
import { recordLevel } from '../patients/patientAccess.js';
import { User } from '../users/user.model.js';
import { LabOrder } from '../lab/labOrder.model.js';
import { testByKey } from '../lab/labTests.js';
import { loadForRecords, mayOpenRecords } from '../documents/recordsAccess.js';

const DAY = 24 * 60 * 60 * 1000;

// Signed discharge cards: the last N days, or – with a search – any time for the patients found.
export async function recentDischarges(req, { search, days }) {
  const hid = toObjectId(req.hospitalId);
  const match = { hospitalId: hid, kind: 'discharge', status: 'signed' };
  if (search) {
    const found = await Patient.find({ hospitalId: hid, $or: [{ nameKey: containsText(search) }, { patientNumber: new RegExp(`^${escapeRegex(search)}`, 'i') }] })
      .select('_id')
      .limit(50)
      .lean();
    match.patientId = { $in: found.map((p) => p._id) };
  } else {
    match['signed.at'] = { $gte: new Date(Date.now() - (days ?? config.documents.recentDischargeDays) * DAY) };
  }
  const cards = await InpatientDocument.find(match).sort({ 'signed.at': -1 }).limit(200).lean();
  const [patients, stays] = await Promise.all([
    Patient.find({ hospitalId: hid, _id: { $in: cards.map((c) => c.patientId) } }).lean(),
    Admission.find({ hospitalId: hid, _id: { $in: cards.map((c) => c.admissionId) } }).lean(),
  ]);
  const patientById = new Map(patients.map((p) => [String(p._id), p]));
  const stayById = new Map(stays.map((s) => [String(s._id), s]));
  const items = [];
  for (const c of cards) {
    const p = patientById.get(String(c.patientId));
    if (!p || !mayOpenRecords(req, p, recordLevel(req, p))) continue;
    const s = stayById.get(String(c.admissionId));
    items.push({
      id: String(c._id),
      admissionId: String(c.admissionId),
      patient: { id: String(p._id), name: p.name, patientNumber: p.patientNumber },
      admittedAt: s?.admittedAt ?? null,
      dischargedAt: c.content?.dischargedAt ?? s?.dischargedAt ?? null,
      ward: s?.ward ?? '',
      signedByName: c.signed?.byName ?? '',
    });
  }
  await recordAudit(req, 'DISCHARGES_VIEWED', { hospitalId: req.hospitalId, details: { shown: items.length, ...(search && { searched: true }) } });
  return { items, days: search ? null : (days ?? config.documents.recentDischargeDays) };
}

// One signed discharge card, ready to print.
export async function dischargeCard(req, cardId) {
  const card = await InpatientDocument.findOne({ hospitalId: req.hospitalId, _id: cardId, kind: 'discharge', status: 'signed' }).lean();
  if (!card) throw notFoundError('Discharge card');
  const { patient } = await loadForRecords(req, card.patientId);
  const stay = await Admission.findOne({ hospitalId: req.hospitalId, _id: card.admissionId }).lean();
  const doctorId = stay?.doctorId ?? patient.assignedDoctorId;
  // the blood and other lab results reported during the stay (to the day after discharge), for the printed card
  const until = new Date(new Date(stay?.dischargedAt ?? card.signed?.at ?? Date.now()).getTime() + 24 * 3600_000);
  const [doctor, settings, labs] = await Promise.all([
    doctorId ? User.findById(doctorId).select('name professional').lean() : null,
    getSettings(req.hospitalId),
    stay ? LabOrder.find({ hospitalId: req.hospitalId, patientId: patient._id, status: { $in: ['reported', 'reviewed'] }, 'reported.at': { $gte: stay.admittedAt, $lte: until } }).sort({ 'reported.at': 1 }).lean() : [],
  ]);
  await recordAudit(req, 'DISCHARGE_CARD_VIEWED', { hospitalId: req.hospitalId, details: { patientId: String(patient._id), admissionId: String(card.admissionId), documentId: String(card._id) } });
  return {
    letterhead: settings.letterhead ?? {},
    hospitalName: settings.name,
    patient: {
      id: String(patient._id),
      name: patient.name,
      patientNumber: patient.patientNumber,
      birthDate: patient.birthDate,
      birthDateApprox: patient.birthDateApprox,
      sex: patient.sex,
      phone: patient.phone ?? '',
      address: patient.address ?? {},
    },
    stay: stay ? { id: String(stay._id), admissionNumber: stay.admissionNumber ?? '', admittedAt: stay.admittedAt, ward: stay.ward, bed: stay.bed, dischargedAt: stay.dischargedAt, doctorName: doctor?.name ?? '' } : null,
    consultant: doctor?.name ?? '',
    consultantQualification: doctor?.professional?.qualification ?? '',
    labResults: labs.map((o) => ({
      orderNumber: o.orderNumber,
      reportedAt: o.reported?.at,
      reviewed: o.status === 'reviewed',
      tests: o.tests.map((t) => {
        const fields = testByKey.get(t.key)?.fields ?? [];
        return {
          name: t.name,
          values: (t.values ?? []).map((v) => {
            const f = fields.find((x) => x.key === v.key);
            return { name: f?.name ?? v.key, value: v.value, unit: f?.unit ?? '', flag: v.flag };
          }),
          text: t.text ?? '',
        };
      }),
    })),
    card: { id: String(card._id), content: card.content, signed: card.signed, additions: (card.additions ?? []).map((a) => ({ text: a.text, byName: a.byName, at: a.at })) },
  };
}
