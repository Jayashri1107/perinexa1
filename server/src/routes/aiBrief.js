import { Router } from 'express';
import { z } from 'zod';
import { BRIEF_SCHEMA, PATIENT_BRIEF_SCHEMA, briefInstructions, calendarBriefText, finishBrief, patientExtrasText, todayBriefText, withoutHiv } from '../ai/brief.js';
import { patientContext } from '../ai/context.js';
import { askAI } from '../ai/openai.js';
import { allowedTypes, defaultScope } from '../calendar/calendarAccess.js';
import { loadCalendar } from '../calendar/calendarLoad.js';
import { rangeFor } from '../calendar/calendarRange.js';
import { EVENT_TYPES, MAX_DAYS_FROM_TODAY } from '../calendar/calendarRules.js';
import { calendarQuerySchema } from '../calendar/calendarSchemas.js';
import { addDays, daysBetween, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { Admission } from '../models/Admission.js';
import { LabOrder } from '../models/LabOrder.js';
import { hasRole } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { parse } from '../utils/validate.js';
import { PCPNDT_RULE, assertNoFetalSex } from './ai.js';
import { inpatientsFor } from './inpatients.js';
import { todayFor } from './today.js';
import { worklistFor } from './worklist.js';
import { refuseNewOnClosed } from '../patients/deathRules.js';

// The AI brief (Smart features, step 10): POST /api/ai/brief/today | calendar | patient/:id. A few lines on what is
// most important to look at on that page, for doctors and RMOs, made only when they ask (each one costs a little)
// and not saved. Every brief uses the faster, cheaper model (owner's choice, 2 Oct 2026: about ₹0.10–0.20 each).
// The server builds what the AI is told from the same lists the page shows, for this person only, with no names,
// phone numbers, addresses or patient numbers (see ai/brief.js) – the answer names patients by labels that are
// turned back into names here. Audited as AI_USED: the page, the model, the token counts and which patients were
// included (never what was sent or written). A page with nothing on it is not sent.

export const aiBriefRouter = Router();

const ROLES = ['doctor', 'rmo'];
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const badRequest = (message) => new HttpError(400, message, 'VALIDATION');

aiBriefRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('The AI brief is for doctors and RMOs.');
  next();
});

const nowOf = (req) => req.now ?? new Date();
const nothing = () => ({ empty: true, points: [], patients: {}, generatedAt: new Date() });
// Which patients' details went to the AI (ids only, for the audit log)
const auditIds = (labels) => ({ results: labels.size, patientIds: labels.ids().sort() });

// The patients whose medical details this person may see (weeks, EDD, risk go to the AI only for them).
async function clinicalFacts(req, ids) {
  if (!ids.length) return new Map();
  const found = await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } });
  return new Map(found.filter((p) => patientAccess(req, p).view.has('pregnancy')).map((p) => [String(p._id), p]));
}

// "Lab results to review" of the Today page: reported orders of patients this doctor reviews (as routes/lab.js:
// the patient's doctor, or any doctor for an unassigned patient).
async function labToReview(req) {
  if (!hasRole(req.membership, 'doctor')) return [];
  const orders = await LabOrder.find({ tenantId: req.tenantId, status: 'reported' }, { patientId: 1, tests: 1, urgent: 1, reported: 1 })
    .sort({ abnormal: -1, 'reported.at': 1 })
    .limit(300)
    .lean();
  const ids = [...new Set(orders.map((o) => String(o.patientId)))];
  const patients = ids.length ? await Patient.find({ tenantId: req.tenantId, _id: { $in: ids } }) : [];
  const reviews = new Map(patients.filter((p) => patientAccess(req, p).editClinical).map((p) => [String(p._id), p]));
  return orders
    .filter((o) => reviews.has(String(o.patientId)))
    .map((o) => {
      const p = reviews.get(String(o.patientId));
      return { order: o, patient: { id: String(p._id), fullName: p.fullName, mrn: p.mrn } };
    });
}

// ---------- Today ----------

const todaySchema = z.strictObject({ scope: z.enum(['mine', 'all']).optional() });

aiBriefRouter.post('/today', async (req, res) => {
  const { scope } = parse(todaySchema, req.body ?? {});
  const [work, day, stays, lab] = await Promise.all([worklistFor(req, scope), todayFor(req, scope), inpatientsFor(req), labToReview(req)]);
  const listed = [work.redFlags, work.carePlan, day.patients, day.dueNow ?? [], day.overdue ?? [], stays.admitted, stays.toConfirm ?? [], lab].flat();
  const facts = await clinicalFacts(req, [...new Set(listed.map((r) => r.patient.id))]);
  const { text, labels } = todayBriefText({ work, day, stays, lab, facts, now: nowOf(req), scope: day.scope });
  if (!labels.size) return res.json(nothing());
  const answer = await askAI(req, { feature: 'brief_today', ids: auditIds(labels), instructions: briefInstructions('today', PCPNDT_RULE), content: text, schema: BRIEF_SCHEMA, fast: true, maxTokens: 8000 });
  res.json({ ...finishBrief(answer, labels), generatedAt: new Date() });
});

// ---------- Calendar: the same choices as GET /api/calendar ----------

aiBriefRouter.post('/calendar', async (req, res) => {
  const q = parse(calendarQuerySchema, req.body ?? {});
  const today = hospitalToday(req.now);
  const date = q.date ?? today;
  if (Math.abs(daysBetween(today, date)) > MAX_DAYS_FROM_TODAY) throw badRequest('Please choose a date within 10 years of today.');
  const allowed = allowedTypes(req);
  const asked = q.types ?? allowed;
  if (asked.some((t) => !allowed.includes(t))) throw forbidden("Your role doesn't include pregnancy dates.");
  const types = EVENT_TYPES.filter((t) => asked.includes(t));
  const scope = q.scope ?? defaultScope(req);
  if (scope === 'mine' && !hasRole(req.membership, 'doctor')) throw badRequest('Only doctors have their own patient list. Choose All patients.');

  const [from, to] = rangeFor(q.view, date);
  // A month is read entry by entry (as weeks are), not as counts only.
  const cal = await loadCalendar(req, { view: q.view === 'month' ? 'week' : q.view, from, to, types, scope });
  const clinical = Object.keys(cal.patients).filter((id) => cal.patients[id].level === 'clinical');
  const facts = await clinicalFacts(req, clinical);
  const { text, labels } = calendarBriefText({ cal, view: q.view, from: isoDay(from), to: isoDay(to), today: isoDay(today), types, scope, facts, now: nowOf(req) });
  if (!labels.size) return res.json(nothing());
  const answer = await askAI(req, { feature: 'brief_calendar', ids: auditIds(labels), instructions: briefInstructions('calendar', PCPNDT_RULE), content: text, schema: BRIEF_SCHEMA, fast: true, maxTokens: 8000 });
  res.json({ ...finishBrief(answer, labels), generatedAt: new Date() });
});

// ---------- One patient's page ----------

aiBriefRouter.post('/patient/:id', async (req, res) => {
  const patient = await loadPatientForPlan(req);
  if (!patientAccess(req, patient).editClinical) throw forbidden("Only the patient's doctor or an RMO can use AI help on this record.");
  refuseNewOnClosed(patient, 'ai'); // a record closed after a death: nothing is to be looked at first any more
  const since = hospitalDayStart(addDays(hospitalToday(nowOf(req)), -90));
  const [record, orders, stay] = await Promise.all([
    patientContext(req, patient, { visits: 4 }),
    LabOrder.find({ tenantId: req.tenantId, patientId: patient._id, status: { $ne: 'cancelled' }, 'ordered.at': { $gte: since } }, { tests: 1, status: 1, urgent: 1, ordered: 1 })
      .sort({ 'ordered.at': -1 })
      .limit(12)
      .lean(),
    Admission.findOne({ tenantId: req.tenantId, patientId: patient._id, status: 'admitted' }, { admittedAt: 1 }).lean(),
  ]);
  const content = [withoutHiv(record), patientExtrasText({ orders, stay })].filter(Boolean).join('\n\n');
  const answer = await askAI(req, {
    feature: 'brief_patient',
    ids: { patientId: String(patient._id), mrn: patient.mrn },
    instructions: briefInstructions('patient', PCPNDT_RULE),
    content,
    schema: PATIENT_BRIEF_SCHEMA,
    fast: true,
  });
  const { points } = finishBrief(answer, null, { pcpndt: false });
  const missing = (answer.missing ?? []).map((m) => String(m).trim()).filter(Boolean).slice(0, 6);
  assertNoFetalSex(patient, ...points.map((p) => p.text), ...missing);
  res.json({ points, missing, generatedAt: new Date() });
});
