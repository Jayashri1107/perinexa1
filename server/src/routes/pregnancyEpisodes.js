import { Router } from 'express';
import { z } from 'zod';
import { addDays, PREGNANCY_DAYS } from '../careplans/dates.js';
import { patientFacts } from '../careplans/risk.js';
import { TIERS, TIER_CRITERIA, TIER_SOURCE, tierFor } from '../clinical/riskTiers.js';
import { Admission } from '../models/Admission.js';
import { CarePlan } from '../models/CarePlan.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { LabOrder } from '../models/LabOrder.js';
import { Patient } from '../models/Patient.js';
import { TheatreCase } from '../models/TheatreCase.js';
import { Visit } from '../models/Visit.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { assertNotHidden, departmentListFilter, patientAccess } from '../utils/patientAccess.js';
import { findPatientById } from '../utils/patientLookup.js';
import { objectId, parse } from '../utils/validate.js';

// The pregnancy episode (Clinical Requirements Group C – PX-X-15): /api/pregnancy-episodes?patientId=.
// One entry per pregnancy – each antenatal care plan is one pregnancy (closed as delivered, pregnancy ended, new
// pregnancy …), and a pregnancy without a plan yet is the current one – with what belongs to it: the visits, stays,
// delivery notes, operations, lab orders and babies between two weeks before her LMP and the end of the pregnancy.
// Nothing is moved or copied: the episode is read from the records as they are.
// The current pregnancy also gets the GREEN / AMBER / RED tier (DRAFT, clinical/riskTiers.js) beside today's risk
// level – shown only, never used. Who: those who may see her pregnancy details. Audited as PREGNANCY_EPISODES_VIEWED.

export const pregnancyEpisodesRouter = Router();
const CLOSE_WORDS = { delivered: 'Delivered', pregnancy_ended: 'Pregnancy ended', transferred_out: 'Transferred out', care_elsewhere: 'Care continues elsewhere', new_pregnancy: 'New pregnancy', other: 'Closed' };
const MATERNAL = ['antenatal', 'postnatal', 'abortion'];

pregnancyEpisodesRouter.get('/', async (req, res) => {
  const { patientId } = parse(z.object({ patientId: objectId }).strict(), req.query);
  const patient = await findPatientById(req.tenantId, patientId);
  assertNotHidden(req, patient); // another department's patient: "not found" for a doctor (departments, 9 Nov 2026)
  const access = patientAccess(req, patient);
  if (!access.view.has('pregnancy')) throw new HttpError(403, "You can't see this patient's pregnancy details.", 'FORBIDDEN');
  if (!MATERNAL.includes(patient.careType) && patient.careType !== 'infertility') return res.json({ episodes: [], tier: null });
  const now = req.now ?? new Date();
  const t = { tenantId: req.tenantId, patientId: patient._id };

  const plans = await CarePlan.find({ ...t, careType: 'antenatal' }, { current: 1, status: 1, closed: 1, 'basis.edd': 1, createdAt: 1 }).sort({ createdAt: 1 }).lean();
  const spans = plans.map((p) => ({ id: String(p._id), edd: p.basis?.edd ?? null, open: !p.closed, closed: p.closed ? { reason: p.closed.reason, word: CLOSE_WORDS[p.closed.reason] ?? 'Closed', at: p.closed.at ?? null } : null }));
  // The current pregnancy without a care plan yet (antenatal, with dates)
  if (patient.careType === 'antenatal' && !spans.some((s) => s.open)) spans.push({ id: 'current', edd: patient.pregnancy?.effectiveEdd ?? null, open: true, closed: null });

  const startOf = (s) => (s.edd ? addDays(s.edd, -(PREGNANCY_DAYS + 14)) : null);
  const endOf = (s) => s.closed?.at ?? (s.open ? now : s.edd ? addDays(s.edd, 42) : now);
  const from = spans.map(startOf).filter(Boolean).sort((a, b) => a - b)[0] ?? null;

  const [visits, stays, deliveries, ops, labs, babies] = from
    ? await Promise.all([
        Visit.find({ ...t, status: 'active', visitOn: { $gte: from } }, { visitOn: 1 }).sort({ visitOn: 1 }).lean(),
        Admission.find({ ...t, admittedAt: { $gte: from } }, { admittedAt: 1, dischargedAt: 1, ward: 1, status: 1 }).sort({ admittedAt: 1 }).lean(),
        ClinicalDocument.find({ ...t, kind: 'delivery', status: 'signed', createdAt: { $gte: from } }, { admissionId: 1, 'content.deliveredAt': 1, createdAt: 1 }).lean(),
        TheatreCase.find({ ...t, listDate: { $gte: from }, cancelled: null }, { procedure: 1, listDate: 1, status: 1 }).sort({ listDate: 1 }).lean(),
        LabOrder.find({ ...t, status: { $ne: 'cancelled' }, createdAt: { $gte: from } }, { createdAt: 1 }).lean(),
        // (a baby the department rule hides from this doctor is not listed – departments, 9 Nov 2026)
        Patient.find({ tenantId: req.tenantId, 'newborn.mother': patient._id, 'newborn.birthAt': { $gte: from }, ...departmentListFilter(req) }, { fullName: 1, mrn: 1, 'newborn.birthAt': 1 }).lean(),
      ])
    : [[], [], [], [], [], []];

  const inSpan = (s, d) => {
    const a = startOf(s);
    return Boolean(a && d && d >= a && d <= endOf(s));
  };
  const episodes = spans.map((s, i) => {
    const deliveredAt = (d) => d.content?.deliveredAt ?? d.createdAt;
    return {
      id: s.id,
      number: i + 1,
      edd: s.edd,
      from: startOf(s),
      to: s.open ? null : endOf(s),
      status: s.open ? 'open' : 'closed',
      closed: s.closed ? { reason: s.closed.reason, word: s.closed.word, at: s.closed.at } : null,
      visits: visits.filter((v) => inSpan(s, v.visitOn)).map((v) => ({ id: String(v._id), on: v.visitOn })),
      stays: stays.filter((a) => inSpan(s, a.admittedAt)).map((a) => ({ id: String(a._id), admittedAt: a.admittedAt, dischargedAt: a.dischargedAt, ward: a.ward, status: a.status })),
      deliveries: deliveries.filter((d) => inSpan(s, deliveredAt(d))).map((d) => ({ admissionId: String(d.admissionId), at: deliveredAt(d) })),
      operations: ops.filter((o) => inSpan(s, o.listDate)).map((o) => ({ id: String(o._id), procedure: o.procedure, on: o.listDate, status: o.status })),
      labOrders: labs.filter((l) => inSpan(s, l.createdAt)).length,
      babies: babies.filter((b) => inSpan(s, b.newborn?.birthAt)).map((b) => ({ id: String(b._id), fullName: b.fullName, mrn: b.mrn, birthAt: b.newborn.birthAt })),
    };
  });

  // The DRAFT tier for the current pregnancy, beside today's risk level (for those who may see the risk).
  let tier = null;
  if (patient.careType === 'antenatal') {
    tier = {
      ...tierFor(patientFacts(patient.toObject(), now)),
      riskLevelToday: access.view.has('risk') ? (patient.risk?.level ?? null) : undefined,
      source: TIER_SOURCE,
      tiers: TIERS,
      criteria: TIER_CRITERIA.map(({ key, tier: tr, label }) => ({ key, tier: tr, label })),
    };
  }
  await audit(req, 'PREGNANCY_EPISODES_VIEWED', { details: { patientId: String(patient._id), mrn: patient.mrn, episodes: episodes.length } });
  res.json({ episodes: episodes.reverse(), tier });
});
