import { Router } from 'express';
import { z } from 'zod';
import { patientContext, scrub } from '../ai/context.js';
import { aiEnabled, askAI, strictObject } from '../ai/openai.js';
import { hasRole } from '../models/Membership.js';
import { CONDITIONS, PAST_COMPLICATIONS } from '../models/Patient.js';
import { Visit } from '../models/Visit.js';
import { HttpError } from '../utils/httpError.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../utils/pcpndt.js';
import { patientAccess } from '../utils/patientAccess.js';
import { loadPatientForPlan } from '../utils/patientLookup.js';
import { parse } from '../utils/validate.js';

// AI help on one patient (Smart features 4–8): /api/patients/:id/ai/...
//  - summary: a few lines to read before seeing her (step 4);
//  - translate: the doctor's advice in Marathi or Hindi (step 5);
//  - letter: a draft referral or discharge letter (step 6);
//  - risk-suggestions: risk factors found in what was typed as free text (step 7);
//  - read-report: values read from a photo or PDF of a lab or scan report (step 8).
// Everything returned is a draft for the doctor to check – nothing is saved from here. For the treating (or
// an unassigned) doctor and RMOs: the people who write the record. See ai/openai.js for the rules on what is
// sent; the AI is never told her name, phone, address or patient number.

export const patientAiRouter = Router({ mergeParams: true });

const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');
export const PCPNDT_RULE =
  'Never mention, hint at or guess the sex of the fetus or baby in a pregnancy (illegal in India under the PCPNDT Act). If a source mentions it, leave it out.';

// Loads the patient and checks this person may use AI on her record (they may write clinical details).
async function load(req) {
  if (!hasRole(req.membership, 'doctor', 'rmo')) throw forbidden('AI help is for doctors and RMOs.');
  const patient = await loadPatientForPlan(req);
  const access = patientAccess(req, patient);
  if (!access.editClinical) throw forbidden("Only the patient's doctor or an RMO can use AI help on this record.");
  return { patient, ids: { patientId: String(patient._id), mrn: patient.mrn } };
}

// AI text for a pregnancy must never speak of the baby's sex: if it does, it is not shown.
export function assertNoFetalSex(patient, ...texts) {
  if (patient.careType === 'newborn') return;
  if (texts.some((t) => mentionsFetalSex(t))) throw new HttpError(422, `The AI answer was withheld: ${PCPNDT_MESSAGE}`, 'AI_DECLINED');
}

patientAiRouter.get('/status', (_req, res) => res.json({ enabled: aiEnabled() }));

// ---------- Step 4: visit summary ----------

const SUMMARY_SCHEMA = strictObject({
  points: {
    type: 'array',
    items: strictObject({ text: { type: 'string' }, important: { type: 'boolean' } }),
  },
  missing: { type: 'array', items: { type: 'string' } },
});

patientAiRouter.post('/summary', async (req, res) => {
  const { patient, ids } = await load(req);
  const record = await patientContext(req, patient, { visits: 6 });
  const answer = await askAI(req, {
    feature: 'visit_summary',
    ids,
    fast: true, // the cheaper model (owner's choice, 2 Oct 2026)
    instructions: [
      'You help an obstetrician in India prepare to see a patient. From the record below, write 4 to 6 short points the doctor should know before the consultation today:',
      'where she is (weeks, risk level and why), anything abnormal or changing across visits (BP rising, Hb falling, weight, red flags), what is overdue or due in the care plan, current medicines, and anything left open from the last visit.',
      'Mark a point important=true only if it needs attention today. Use only what is in the record – do not invent values or diagnoses, and do not give treatment orders.',
      'In "missing", list important things not recorded (e.g. no Hb this trimester). Plain English, no markdown, each point under 30 words.',
      PCPNDT_RULE,
    ].join(' '),
    content: record,
    schema: SUMMARY_SCHEMA,
  });
  const points = (answer.points ?? []).slice(0, 8);
  assertNoFetalSex(patient, ...points.map((p) => p.text), ...(answer.missing ?? []));
  res.json({ points, missing: (answer.missing ?? []).slice(0, 6), generatedAt: new Date() });
});

// ---------- Step 5: advice in her language ----------

const LANGS = { mr: 'Marathi', hi: 'Hindi' };
const translateSchema = z.object({
  text: z.string().trim().min(1, 'Write the advice first').max(2000, 'The advice is too long to translate at once'),
  language: z.enum(Object.keys(LANGS), 'Choose Marathi or Hindi'),
});

patientAiRouter.post('/translate', async (req, res) => {
  const { patient, ids } = await load(req);
  const { text, language } = parse(translateSchema, req.body);
  if (patient.careType !== 'newborn' && mentionsFetalSex(text)) throw Object.assign(new HttpError(400, PCPNDT_MESSAGE, 'VALIDATION'), { fields: { text: PCPNDT_MESSAGE } });
  const answer = await askAI(req, {
    feature: 'translate_advice',
    ids,
    fast: true,
    maxTokens: 3000,
    instructions: [
      `Translate a doctor's advice for a patient in India into simple, everyday ${LANGS[language]} in Devanagari script, as a doctor would say it to a patient with little schooling.`,
      'Keep every instruction, number, dose, time and date exactly. Keep medicine names and test names in English letters.',
      'Do not add, remove or soften anything. One line in the translation for each line of advice.',
      PCPNDT_RULE,
    ].join(' '),
    content: scrub(text, patient),
    schema: strictObject({ translation: { type: 'string' } }),
  });
  assertNoFetalSex(patient, answer.translation);
  res.json({ translation: answer.translation.trim(), language });
});

// ---------- Step 6: referral and discharge letters ----------

const LETTER_TYPES = { referral: 'referral letter', discharge: 'discharge summary', fitness: 'medical certificate / fitness note' };
const letterSchema = z.object({
  type: z.enum(Object.keys(LETTER_TYPES), 'Choose the kind of letter'),
  to: z.string().trim().max(200).default(''),
  reason: z.string().trim().min(3, 'Say briefly why (e.g. "Severe pre-eclampsia at 32 weeks – for NICU backup")').max(500),
  extra: z.string().trim().max(2000).default(''),
});

patientAiRouter.post('/letter', async (req, res) => {
  const { patient, ids } = await load(req);
  const body = parse(letterSchema, req.body);
  if (patient.careType !== 'newborn' && [body.reason, body.extra].some(mentionsFetalSex)) {
    throw Object.assign(new HttpError(400, PCPNDT_MESSAGE, 'VALIDATION'), { fields: { reason: PCPNDT_MESSAGE } });
  }
  const record = await patientContext(req, patient, { visits: 8 });
  const answer = await askAI(req, {
    feature: `letter_${body.type}`,
    ids,
    fast: true, // the cheaper model (owner's choice, 2 Oct 2026)
    maxTokens: 5000,
    instructions: [
      `Draft a ${LETTER_TYPES[body.type]} from an obstetrician in India, using only the record and the doctor's notes below.`,
      'Write the patient as "[Patient name]", her age from the record, and leave "[Doctor name]" for the signature – the doctor fills these in. Do not invent findings, results, dates or treatment: write "not recorded" where something needed is missing.',
      'Structure: reason; relevant history (obstetric, medical, allergies); findings and investigations; treatment given / medicines; current condition; what is requested or advised; follow-up. Formal, concise, plain text without markdown.',
      PCPNDT_RULE,
    ].join(' '),
    content: `${record}\n\n## Letter\nKind: ${LETTER_TYPES[body.type]}\nTo: ${scrub(body.to, patient) || 'not given'}\nReason: ${scrub(body.reason, patient)}\nDoctor's notes: ${scrub(body.extra, patient) || 'none'}`,
    schema: strictObject({ subject: { type: 'string' }, body: { type: 'string' } }),
  });
  assertNoFetalSex(patient, answer.subject, answer.body);
  res.json({ subject: answer.subject.trim(), body: answer.body.trim(), generatedAt: new Date() });
});

// ---------- Step 7: smarter risk check ----------

patientAiRouter.post('/risk-suggestions', async (req, res) => {
  const { patient, ids } = await load(req);
  const m = patient.medical ?? {};
  const typed = [
    m.otherConditions && `Other conditions: ${m.otherConditions}`,
    m.allergies && `Allergies: ${m.allergies}`,
    patient.notes && `Notes: ${patient.notes}`,
  ].filter(Boolean);
  const visits = await Visit.find({ tenantId: req.tenantId, patientId: patient._id, status: 'active' }, 'visitOn details.complaints details.examination details.diagnosis')
    .sort({ visitOn: -1 })
    .limit(6)
    .lean();
  for (const v of visits) {
    const d = v.details ?? {};
    const t = [d.complaints, d.examination, d.diagnosis].filter(Boolean).join(' / ');
    if (t) typed.push(`Visit ${v.visitOn.toISOString().slice(0, 10)}: ${t}`);
  }
  if (!typed.length) return res.json({ suggestions: [], checked: false });
  const recorded = new Set([...(m.conditions ?? []), ...(patient.obstetric?.pastComplications ?? [])]);
  const answer = await askAI(req, {
    feature: 'risk_suggestions',
    ids,
    fast: true,
    maxTokens: 2500,
    instructions: [
      'An obstetrician in India typed the free text below. Find pre-existing conditions or problems in PREVIOUS pregnancies that it clearly states, and map each to one of the codes given.',
      `Condition codes: ${CONDITIONS.join(', ')}. Previous-pregnancy codes: ${PAST_COMPLICATIONS.join(', ')}.`,
      'Only include something the text clearly says the patient has or had (not "rule out", not family history, not a negative). Quote the exact words. Common short forms: GDM, PIH, HTN, DM, APLA, h/o, LSCS.',
      'Findings of the current pregnancy (e.g. GDM or PIH now) are not pre-existing conditions: leave them out.',
    ].join(' '),
    content: typed.map((t) => scrub(t, patient)).join('\n'),
    schema: strictObject({
      suggestions: {
        type: 'array',
        items: strictObject({ kind: { type: 'string', enum: ['condition', 'pastComplication'] }, code: { type: 'string' }, quote: { type: 'string' } }),
      },
    }),
  });
  const valid = (s) => (s.kind === 'condition' ? CONDITIONS : PAST_COMPLICATIONS).includes(s.code);
  const seen = new Set();
  const suggestions = (answer.suggestions ?? []).filter((s) => valid(s) && !recorded.has(s.code) && !seen.has(s.code) && seen.add(s.code));
  res.json({ suggestions, checked: true });
});

// ---------- Step 8: reading a lab or scan report ----------

const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const reportSchema = z.object({
  fileName: z.string().trim().max(200).default('report'),
  mediaType: z.enum(MEDIA, 'Choose a photo (JPG, PNG) or a PDF'),
  // base64 without the "data:" prefix; the upload limit for this route is set in app.js
  data: z.string().min(100, 'The file is empty').max(9_000_000, 'The file is too big – at most about 6 MB'),
});

const REPORT_SCHEMA = strictObject({
  kind: { type: 'string', enum: ['lab', 'scan', 'other'] },
  reportDate: { type: 'string' },
  title: { type: 'string' },
  values: {
    type: 'array',
    items: strictObject({ name: { type: 'string' }, value: { type: 'string' }, unit: { type: 'string' }, flag: { type: 'string', enum: ['normal', 'high', 'low', 'abnormal', 'unknown'] } }),
  },
  // Values Perinexa can put straight into the visit (null when not in the report)
  hb: { type: ['number', 'null'] },
  summary: { type: 'string' },
  readable: { type: 'boolean' },
});

patientAiRouter.post('/read-report', async (req, res) => {
  const { patient, ids } = await load(req);
  const f = parse(reportSchema, req.body);
  const dataUrl = `data:${f.mediaType};base64,${f.data}`;
  const filePart =
    f.mediaType === 'application/pdf'
      ? { type: 'file', file: { filename: 'report.pdf', file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };
  const answer = await askAI(req, {
    feature: 'read_report',
    ids,
    // the stronger model (not fast: owner's choice, 2 Oct 2026) – values are copied from a photo or PDF
    maxTokens: 4000,
    instructions: [
      'Read this lab or ultrasound report for an obstetrician in India. Copy each test or measurement exactly as printed (name, value, unit) and mark it high/low/abnormal only if the report itself marks it or gives a range it is outside.',
      'For a scan: gestational age, EFW, AFI / liquor, placenta position, presentation, FHR, and the impression. reportDate as YYYY-MM-DD or "" if not printed.',
      'hb: the haemoglobin in g/dL if printed, else null. summary: one or two plain sentences of what is abnormal (or "No abnormal values marked").',
      'Set readable=false and leave values empty if the image is not a medical report or cannot be read. Never copy names, phone numbers, addresses or ID numbers of any person.',
      PCPNDT_RULE,
    ].join(' '),
    content: [{ type: 'text', text: 'The report:' }, filePart],
    schema: REPORT_SCHEMA,
  });
  assertNoFetalSex(patient, answer.title, answer.summary, ...(answer.values ?? []).map((v) => `${v.name} ${v.value}`));
  res.json({ ...answer, hb: typeof answer.hb === 'number' && answer.hb >= 2 && answer.hb <= 25 ? answer.hb : null });
});
