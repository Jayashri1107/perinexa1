import { Router } from 'express';
import { z } from 'zod';
import { aiEnabled, askAI, transcribe } from '../ai/openai.js';
import { FORM_FIELDS, checkSuggestions, fieldList, suggestionSchema } from '../ai/understand.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { addDays, hospitalToday } from '../careplans/dates.js';
import { carePlanSummaryFor, planCtx } from '../careplans/plansService.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { hasRole } from '../models/Membership.js';
import { CARE_TYPES, CONDITIONS, PAST_COMPLICATIONS, Patient, currentAge, gestationalAge } from '../models/Patient.js';
import { IN_USE } from '../patients/deathRules.js';
import { User } from '../models/User.js';
import { Visit } from '../models/Visit.js';
import { redFlagsForPatients } from '../redflags/redFlagService.js';
import { audit } from '../utils/audit.js';
import { HttpError } from '../utils/httpError.js';
import { patientAccess } from '../utils/patientAccess.js';
import { parse } from '../utils/validate.js';
import { RX_DURATION_UNITS, RX_FORMS, RX_FREQUENCIES, RX_ROUTES, RX_TIMINGS } from '../visits/rxCodes.js';

// "Ask your records" (Smart features, step 9): /api/ai/ask. A doctor, RMO or nurse types a question in
// plain words ("high-risk patients over 36 weeks", "who missed the anomaly scan"). Only the QUESTION goes
// to the AI – never any patient data: the AI turns it into a search from a fixed list of filters, and
// Perinexa runs that search itself over the patients this person may see. The answer says how the question
// was understood, so a wrong reading is easy to spot. Audited (counts only, never the question).

const ROLES = ['doctor', 'rmo', 'nurse'];
const MAX_RESULTS = 200;
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
const list = (values) => ({ type: 'array', items: { type: 'string', enum: values } });

// The search the AI may ask for. Every field is required (strict mode); null / [] means "not asked".
const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    understood: { type: 'string' },
    unsupported: { type: 'string' },
    careTypes: list(CARE_TYPES),
    weeksFrom: nullable('integer'),
    weeksTo: nullable('integer'),
    eddFrom: nullable('string'),
    eddTo: nullable('string'),
    riskLevels: list(['high', 'moderate', 'low', 'incomplete']),
    redFlags: nullable('string', { enum: ['any', 'urgent', 'none', null] }),
    carePlan: list(['overdue', 'due', 'needsDecision', 'missedVisits']),
    carePlanItem: nullable('string'),
    conditions: list(CONDITIONS),
    pastComplications: list(PAST_COMPLICATIONS),
    rhNegative: nullable('boolean'),
    previousCaesareansAtLeast: nullable('integer'),
    ageFrom: nullable('integer'),
    ageTo: nullable('integer'),
    seenFrom: nullable('string'),
    seenTo: nullable('string'),
    notSeenForDays: nullable('integer'),
    mine: { type: 'boolean' },
  },
};
FILTER_SCHEMA.required = Object.keys(FILTER_SCHEMA.properties);

const askSchema = z.object({ question: z.string().trim().min(3, 'Type a question').max(300, 'Please keep the question short') });
const isoDay = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);

export const aiAskRouter = Router();

aiAskRouter.post('/ask', async (req, res) => {
  if (!hasRole(req.membership, ...ROLES)) throw forbidden('Asking the records is for doctors, RMOs and nurses.');
  const { question } = parse(askSchema, req.body);
  const now = req.now ?? new Date();
  const today = hospitalToday(now);

  const f = await askAI(req, {
    feature: 'ask_records',
    fast: true,
    maxTokens: 2000,
    instructions: [
      `Turn a doctor's question about the patients of an obstetrics clinic in India into a search. Today is ${today.toISOString().slice(0, 10)}.`,
      'Fill only the filters the question asks for; leave the others null or empty. Dates as YYYY-MM-DD. "Due next month" means EDD in that range; "36 weeks or more" means weeksFrom 36.',
      'carePlan: patients with care-plan items in that state; carePlanItem: a word from the item name if the question names one (e.g. "anomaly", "OGTT", "Td"), else null.',
      '"my patients" means mine=true. "understood": one plain sentence saying what will be searched. "unsupported": what the question asks that these filters cannot do (else "").',
      'Never ask about or search for the sex of a fetus.',
    ].join(' '),
    content: question,
    schema: FILTER_SCHEMA,
  });

  await refreshDueRisks(req.tenantId);
  // A record marked as a duplicate is left out of every search; so is a record closed after a death (IN_USE): these
  // answers are follow-up and call lists, with red flags and overdue care-plan items. The Patients list still finds it.
  const q = { tenantId: req.tenantId, ...IN_USE };
  if (f.careTypes?.length) q.careType = { $in: f.careTypes };
  if (f.mine) q.assignedDoctor = { $in: [req.user._id, null] };
  if (f.riskLevels?.length) q['risk.level'] = { $in: f.riskLevels };
  if (f.conditions?.length) q['medical.conditions'] = { $all: f.conditions };
  if (f.pastComplications?.length) q['obstetric.pastComplications'] = { $all: f.pastComplications };
  if (f.rhNegative === true) q['medical.bloodGroup'] = /-$/;
  if (f.previousCaesareansAtLeast != null) q['obstetric.previousCaesareans'] = { $gte: f.previousCaesareansAtLeast };
  const eddFrom = isoDay(f.eddFrom);
  const eddTo = isoDay(f.eddTo);
  if (eddFrom || eddTo) q['pregnancy.effectiveEdd'] = { ...(eddFrom ? { $gte: eddFrom } : {}), ...(eddTo ? { $lte: eddTo } : {}) };
  // Weeks today → EDD range (week w starts 280 − 7w days before the EDD)
  if (f.weeksFrom != null || f.weeksTo != null) {
    q['pregnancy.effectiveEdd'] = {
      ...(q['pregnancy.effectiveEdd'] ?? {}),
      ...(f.weeksFrom != null ? { $lte: addDays(today, 280 - 7 * f.weeksFrom) } : {}),
      ...(f.weeksTo != null ? { $gt: addDays(today, 280 - 7 * (f.weeksTo + 1)) } : {}),
    };
  }

  // Weeks and due dates belong to antenatal records only (a pregnancy that ended may still have dates stored).
  if (q['pregnancy.effectiveEdd']) q.careType = !f.careTypes?.length || f.careTypes.includes('antenatal') ? 'antenatal' : { $in: [] };

  let patients = (await Patient.find(q).sort({ 'pregnancy.effectiveEdd': 1 }).limit(1000)).filter((p) => patientAccess(req, p).view.has('pregnancy'));
  // In due-date order: antenatal records first (others may have old dates stored), the rest after them.
  patients.sort((a, b) => (a.careType !== 'antenatal') - (b.careType !== 'antenatal'));
  if (f.ageFrom != null || f.ageTo != null) {
    patients = patients.filter((p) => {
      const a = currentAge(p, now);
      return a != null && (f.ageFrom == null || a >= f.ageFrom) && (f.ageTo == null || a <= f.ageTo);
    });
  }
  // Visits: seen in a period, or not seen for N days
  const seenFrom = isoDay(f.seenFrom);
  const seenTo = isoDay(f.seenTo);
  if (seenFrom || seenTo || f.notSeenForDays != null) {
    const last = await Visit.aggregate([
      { $match: { tenantId: req.tenantId, patientId: { $in: patients.map((p) => p._id) }, status: 'active' } },
      { $group: { _id: '$patientId', visits: { $push: '$visitOn' } } },
    ]);
    const byId = new Map(last.map((x) => [String(x._id), x.visits]));
    patients = patients.filter((p) => {
      const visits = byId.get(String(p._id)) ?? [];
      if ((seenFrom || seenTo) && !visits.some((d) => (!seenFrom || d >= seenFrom) && (!seenTo || d <= seenTo))) return false;
      if (f.notSeenForDays != null) {
        const latest = visits.reduce((a, d) => (a && a > d ? a : d), null);
        if (latest && latest > addDays(today, -f.notSeenForDays)) return false;
      }
      return true;
    });
  }
  let flagsById = new Map();
  if (f.redFlags) {
    flagsById = (await redFlagsForPatients(planCtx(req), patients)).byPatient;
    patients = patients.filter((p) => {
      const flags = flagsById.get(String(p._id))?.flags ?? [];
      if (f.redFlags === 'none') return flags.length === 0;
      if (f.redFlags === 'urgent') return flags.some((x) => x.level === 'urgent');
      return flags.length > 0;
    });
  }
  let planById = new Map();
  if (f.carePlan?.length || f.carePlanItem) {
    const ctx = planCtx(req);
    const word = (f.carePlanItem ?? '').toLowerCase();
    const checked = [];
    for (const p of patients.filter((x) => x.careType === 'antenatal').slice(0, 300)) {
      const s = await carePlanSummaryFor(ctx, p);
      if (!s?.exists) continue;
      const states = f.carePlan?.length ? f.carePlan : ['overdue', 'due'];
      if (!states.some((st) => s.counts?.[st] > 0)) continue;
      if (word && !(s.top ?? []).some((it) => it.name.toLowerCase().includes(word))) continue;
      planById.set(String(p._id), s);
      checked.push(p);
    }
    patients = checked;
  }

  const cut = patients.length > MAX_RESULTS;
  patients = patients.slice(0, MAX_RESULTS);
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctor && String(p.assignedDoctor)).filter(Boolean))];
  const doctors = new Map((await User.find({ _id: { $in: doctorIds } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
  const results = patients.map((p) => {
    const ga = p.careType === 'antenatal' ? gestationalAge(p, now) : null;
    const s = planById.get(String(p._id));
    return {
      id: String(p._id),
      fullName: p.fullName,
      mrn: p.mrn,
      careType: p.careType,
      gestationalAge: ga ? { weeks: ga.weeks, days: ga.days } : null,
      edd: p.careType === 'antenatal' ? (p.pregnancy?.effectiveEdd ?? null) : null,
      risk: p.careType === 'antenatal' && p.risk?.level ? { level: p.risk.level } : null,
      assignedDoctorName: p.assignedDoctor ? (doctors.get(String(p.assignedDoctor)) ?? null) : null,
      flags: flagsById.get(String(p._id))?.flags ?? null,
      carePlan: s ? { counts: s.counts, top: s.top } : null,
    };
  });
  await audit(req, 'AI_QUESTION_ASKED', { details: { feature: 'ask_records', results: results.length } });
  res.json({ understood: f.understood, unsupported: f.unsupported, filters: f, results, cut, today });
});

// AI dictation (voice entry): a short recording → text for the form (the form's own reader then fills the fields,
// with the same checks and questions as on-device voice entry). Only when the person presses "AI dictation".
// For everyone who uses voice entry. Nothing is kept: neither the recording nor the text.
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
const transcribeSchema = z.object({
  mediaType: z.string().transform((t) => t.split(';')[0].trim()).pipe(z.enum(AUDIO_TYPES, 'This recording format is not supported')),
  data: z.string().min(100, 'The recording is empty').max(12_000_000, 'The recording is too long – at most about 5 minutes'),
});

// Voice entry asks this before recording: Start recording uses AI dictation when AI is set up (owner, 14 Oct 2026).
aiAskRouter.get('/status', (_req, res) => res.json({ enabled: aiEnabled() }));

aiAskRouter.post('/transcribe', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'rmo', 'nurse', 'receptionist')) throw forbidden('Voice entry is not part of your role.');
  const { mediaType, data } = parse(transcribeSchema, req.body);
  const text = await transcribe(req, { audio: Buffer.from(data, 'base64'), mediaType });
  res.json({ text });
});

// "Ask AI where these belong" (voice entry): the parts the reader did not understand → suggested fields and values,
// checked against a fixed list (ai/understand.js), for the person to accept one by one. Parts about the baby's sex are
// never sent. Nothing is kept.
const understandSchema = z.object({
  form: z.enum(Object.keys(FORM_FIELDS)),
  careType: z.enum(CARE_TYPES),
  parts: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
});

aiAskRouter.post('/understand', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'rmo', 'nurse', 'receptionist')) throw forbidden('Voice entry is not part of your role.');
  const { form, careType, parts } = parse(understandSchema, req.body);
  const sendable = parts.map((p) => (careType !== 'newborn' && mentionsFetalSex(p) ? '' : p));
  const today = hospitalToday(req.now ?? new Date());
  const answer = await askAI(req, {
    feature: 'understand_dictation',
    fast: true,
    maxTokens: 2000,
    instructions: [
      `A doctor in India dictated details for a ${careType === 'abortion' ? 'pregnancy loss (abortion care)' : careType} ${form === 'visit' ? 'clinic visit' : 'patient record'}. Today is ${today.toISOString().slice(0, 10)}.`,
      "Perinexa's reader could not place the numbered parts below. For each part, suggest where it belongs, using ONLY these fields and value formats:",
      fieldList(form, careType),
      'Rules: only what the part clearly says – never guess or add. A part may give several fields (e.g. "two kids both normal delivery" → para 2 and living 2), or none (leave it out).',
      'Existing conditions and previous-pregnancy problems: the code from the list. Text fields: the words said, tidied, in English. Dates: work out the full date from today if said relatively.',
      'Never suggest a name, phone, address, or anything about the sex of a fetus or baby.',
    ].join('\n'),
    content: sendable.map((p, i) => `${i}: ${p || '(left out)'}`).join('\n'),
    schema: suggestionSchema(form, careType),
  });
  const suggestions = checkSuggestions(answer.suggestions, { form, parts: sendable, today, careType }).filter((s) => sendable[s.part]);
  res.json({ suggestions });
});

// "Start recording" on the Prescription tab: the medicines the doctor dictated (already written down by
// /ai/transcribe) → prescription rows from the fixed lists, for the doctor to check before saving. Doctors and
// RMOs only (they write prescriptions). Never a dose the doctor did not say; nothing about the baby's sex. Nothing is kept.
const medicinesSchema = z.object({ text: z.string().trim().min(1, 'Nothing was said').max(6000, 'The dictation is too long') });
const str = (max) => ({ type: 'string', maxLength: max });
const MEDICINE_ANSWER = {
  type: 'object',
  additionalProperties: false,
  required: ['medicines', 'notes'],
  properties: {
    medicines: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['drug', 'form', 'strength', 'dose', 'frequency', 'frequencyText', 'timing', 'route', 'durationValue', 'durationUnit', 'instructions'],
        properties: {
          drug: str(120),
          form: { type: 'string', enum: RX_FORMS },
          strength: str(40),
          dose: str(40),
          frequency: { type: 'string', enum: RX_FREQUENCIES },
          frequencyText: str(60),
          timing: { type: 'string', enum: RX_TIMINGS },
          route: { type: 'string', enum: RX_ROUTES },
          durationValue: nullable('integer'),
          durationUnit: { type: 'string', enum: RX_DURATION_UNITS },
          instructions: str(200),
        },
      },
    },
    notes: str(500),
  },
};
const clip = (v, max) => String(v ?? '').trim().slice(0, max);
const oneOf = (v, list, fallback = '') => (list.includes(v) ? v : fallback);

/** The AI's medicines, checked against the fixed lists (exported for tests). */
export function checkMedicines(answer) {
  const medicines = (Array.isArray(answer?.medicines) ? answer.medicines : [])
    .map((m) => {
      const frequency = oneOf(m?.frequency, RX_FREQUENCIES, 'custom');
      const days = Number.isInteger(m?.durationValue) && m.durationValue >= 1 && m.durationValue <= 365 ? m.durationValue : null;
      return {
        drug: clip(m?.drug, 120),
        form: oneOf(m?.form, RX_FORMS, 'tab'),
        strength: clip(m?.strength, 40),
        dose: clip(m?.dose, 40),
        frequency,
        frequencyText: frequency === 'custom' ? clip(m?.frequencyText, 60) : '',
        timing: oneOf(m?.timing, RX_TIMINGS),
        route: oneOf(m?.route, RX_ROUTES),
        durationValue: days,
        durationUnit: oneOf(m?.durationUnit, RX_DURATION_UNITS),
        instructions: clip(m?.instructions, 200),
      };
    })
    .filter((m) => m.drug && !mentionsFetalSex(JSON.stringify(m)))
    .slice(0, 40);
  const notes = clip(answer?.notes, 500);
  return { medicines, notes: mentionsFetalSex(notes) ? '' : notes };
}

aiAskRouter.post('/medicines', async (req, res) => {
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden('Only doctors and RMOs write prescriptions.');
  const { text } = parse(medicinesSchema, req.body);
  const answer = await askAI(req, {
    feature: 'dictated_medicines',
    fast: true,
    maxTokens: 4000,
    instructions: [
      'A doctor in India dictated the medicines of a prescription. Turn what was said into prescription rows, one per medicine, in the order said.',
      'drug: the medicine name as said (generic or brand), tidied, in English. form: tab, cap, syrup, inj and so on from the list ("other" if unsure).',
      'frequency in the Indian style morning-afternoon-night: "once a day"/"OD" → 1-0-0 (0-0-1 if said at night), "twice a day"/"BD" → 1-0-1, "thrice"/"TDS" → 1-1-1, "QID" → 1-1-1-1, "SOS"/"as needed" → sos, "stat" → stat; anything else → custom with the words in frequencyText.',
      'durationValue with durationUnit (days, weeks, months), or till_delivery / continue with durationValue null. timing: after_food, before_food, with_food, empty_stomach, bedtime, or "".',
      'Rules: only what was clearly said – never guess or add a dose, strength, frequency or duration that was not said (leave it "" or null). Never add a medicine that was not said.',
      'notes: general instructions for the patient that are not about one medicine (else ""). Never write a name, phone number, or anything about the sex of a fetus or baby.',
    ].join('\n'),
    content: text,
    schema: MEDICINE_ANSWER,
  });
  res.json(checkMedicines(answer));
});
