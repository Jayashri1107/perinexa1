import { Router } from 'express';
import { z } from 'zod';
import { CS_SOURCE, CS_TARGET_MINUTES, caesareanTimes } from '../clinical/caesarean.js';
import { robsonGroup, robsonTable } from '../clinical/robson.js';
import { hasRole } from '../models/Membership.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';

// Clinical audit of deliveries (Clinical Requirements Group A, items 1 and 2): /api/clinical-audit.
//  - GET /robson?month=YYYY-MM: the Robson ten-group table of the month's confirmed delivery notes (numbers only) –
//    doctors, RMOs, the quality lead and the hospital admin.
//  - GET /caesareans?month=YYYY-MM: the month's caesareans with category and decision-to-delivery interval.
//    Doctors and RMOs see each one (patient number and name, to open the record); the quality lead and the hospital
//    admin get the counts only – neither opens a medical record.
// A month is a calendar month in India time (the hospitals' time).

export const clinicalAuditRouter = Router();

const NUMBER_ROLES = ['doctor', 'rmo', 'quality', 'admin'];
const LIST_ROLES = ['doctor', 'rmo'];
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month (YYYY-MM)') }).strict();

/** The month's start and end (India time). PURE. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(`${month}-01T00:00:00+05:30`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start, end: new Date(`${next}-01T00:00:00+05:30`) };
}

async function confirmedDeliveries(req, month, extra = {}) {
  const { start, end } = monthRange(month);
  const docs = await ClinicalDocument.find(
    { tenantId: req.tenantId, kind: 'delivery', status: 'signed', ...extra },
    { content: 1, patientId: 1, admissionId: 1 },
  ).lean();
  // deliveredAt is stored as an ISO string in the content
  return docs.filter((d) => {
    const t = new Date(d.content?.deliveredAt ?? NaN);
    return t >= start && t < end;
  });
}

const allow = (req, roles) => {
  if (!hasRole(req.membership, ...roles)) throw new HttpError(403, 'The clinical audit is for doctors, RMOs, the quality lead and the hospital admin.', 'FORBIDDEN');
};

clinicalAuditRouter.get('/robson', async (req, res) => {
  allow(req, NUMBER_ROLES);
  const { month } = parse(monthQuery, req.query);
  const docs = await confirmedDeliveries(req, month);
  await audit(req, 'ROBSON_TABLE_VIEWED', { details: { month } });
  res.json({ month, ...robsonTable(docs.map((d) => d.content)) });
});

clinicalAuditRouter.get('/caesareans', async (req, res) => {
  allow(req, NUMBER_ROLES);
  const { month } = parse(monthQuery, req.query);
  const docs = (await confirmedDeliveries(req, month)).filter((d) => d.content?.mode === 'lscs');
  const items = docs.map((d) => ({ doc: d, times: caesareanTimes(d.content) }));
  const byCategory = ['1', '2', '3', '4', null].map((category) => {
    const these = items.filter((x) => x.times.category === category);
    return { category, count: these.length, overTarget: these.filter((x) => x.times.overTarget).length };
  });
  const counts = { month, total: items.length, byCategory, targets: CS_TARGET_MINUTES, source: CS_SOURCE };
  if (!hasRole(req.membership, ...LIST_ROLES)) {
    await audit(req, 'CAESAREAN_AUDIT_VIEWED', { details: { month, list: false } });
    return res.json(counts);
  }
  const patients = await Patient.find({ tenantId: req.tenantId, _id: { $in: docs.map((d) => d.patientId) } }, { fullName: 1, mrn: 1 }).lean();
  const byId = new Map(patients.map((p) => [String(p._id), p]));
  const list = items
    .map(({ doc, times }) => ({
      patientId: String(doc.patientId),
      admissionId: String(doc.admissionId),
      documentId: String(doc._id),
      mrn: byId.get(String(doc.patientId))?.mrn ?? '',
      fullName: byId.get(String(doc.patientId))?.fullName ?? '',
      decisionAt: doc.content.decisionAt ?? null,
      deliveredAt: doc.content.deliveredAt,
      robsonGroup: robsonGroup(doc.content),
      ...times,
    }))
    .sort((a, b) => new Date(a.deliveredAt) - new Date(b.deliveredAt));
  await audit(req, 'CAESAREAN_AUDIT_VIEWED', { details: { month, list: true, count: list.length } });
  res.json({ ...counts, list });
});
