// "Ask AI where these belong" (voice entry, Smart features): the parts of a dictation that Perinexa's own reader did
// not understand are given to the AI, which suggests a form field and value for each. Every suggestion is checked
// here against a fixed list of fields and allowed values; the doctor then accepts or refuses each one. Nothing is
// filled in automatically. Never identity fields (name, phone, address), never the doctor's private note.

import { BLOOD_GROUPS, CONDITIONS, PAST_COMPLICATIONS } from '../models/Patient.js';
import { FETAL_MOVEMENTS, OEDEMA_GRADES, PRESENTATIONS, URINE_GRADES } from '../visits/rxCodes.js';
import { mentionsFetalSex } from '../utils/pcpndt.js';
import { ANTI_D, LOSS_TYPE_KEYS, MAX_WEEKS } from '../patients/abortionRules.js';

const num = (label, min, max, decimals = false) => ({ type: 'number', label, min, max, decimals });
const choice = (label, values) => ({ type: 'choice', label, values: values.filter(Boolean) });
const text = (label) => ({ type: 'text', label });
const date = (label, check) => ({ type: 'date', label, check });

const DAY = 86_400_000;
const pastWithin = (days) => (d, today) => d <= today && today - d <= days * DAY;
const aroundToday = (days) => (d, today) => Math.abs(d - today) <= days * DAY;
const futureWithin = (days) => (d, today) => d > today && d - today <= days * DAY;

export const FORM_FIELDS = {
  patient: {
    ageYears: num('Age', 12, 60),
    'pregnancy.lmp': date('LMP', pastWithin(300)),
    'pregnancy.scanEdd': date('EDD from dating scan', aroundToday(300)),
    // Abortion type of care only (pregnancy loss; never an induced one – there is no such value)
    'abortion.lmp': date('LMP (pregnancy loss)', pastWithin(200)),
    'abortion.lossType': choice('Type of loss', LOSS_TYPE_KEYS),
    'abortion.weeks': num('Weeks at presentation', 0, MAX_WEEKS),
    'abortion.antiD': choice('Anti-D', Object.keys(ANTI_D)),
    'obstetric.gravida': num('Gravida', 1, 20),
    'obstetric.para': num('Para', 0, 20),
    'obstetric.living': num('Living children', 0, 20),
    'obstetric.abortions': num('Abortions', 0, 20),
    'obstetric.previousCaesareans': num('Previous caesareans', 0, 10),
    'medical.bloodGroup': choice('Blood group', BLOOD_GROUPS),
    'medical.heightCm': num('Height (cm)', 100, 210, true),
    'medical.weightKg': num('Weight (kg)', 25, 200, true),
    'medical.conditions': choice('Existing condition', CONDITIONS),
    'obstetric.pastComplications': choice('Previous pregnancy problem', PAST_COMPLICATIONS),
    'medical.otherConditions': text('Other condition'),
    notes: text('Notes'),
  },
  visit: {
    'vitals.weightKg': num('Weight (kg)', 25, 200, true),
    'vitals.bpSystolic': num('BP systolic', 60, 250),
    'vitals.bpDiastolic': num('BP diastolic', 30, 150),
    'vitals.pulse': num('Pulse', 30, 200),
    'vitals.temperatureF': num('Temperature (°F)', 93, 108, true),
    'vitals.spo2': num('SpO2 (%)', 60, 100),
    'vitals.hb': num('Hb (g/dL)', 3, 20, true),
    'vitals.urineAlbumin': choice('Urine albumin', URINE_GRADES),
    'vitals.urineSugar': choice('Urine sugar', URINE_GRADES),
    'details.fundalHeightCm': num('Fundal height (cm)', 8, 45),
    'details.fetalHeartRate': num('Fetal heart rate', 80, 220),
    'details.presentation': choice('Presentation', PRESENTATIONS),
    'details.fetalMovements': choice('Fetal movements', FETAL_MOVEMENTS),
    'details.oedema': choice('Oedema', OEDEMA_GRADES),
    'details.complaints': text('Complaints'),
    'details.examination': text('Examination findings'),
    'details.diagnosis': text('Diagnosis'),
    'details.investigations': text('Tests advised'),
    'details.advice': text('Advice'),
    'details.nextVisitOn': date('Next visit', futureWithin(365)),
  },
};

/** The JSON schema the AI answers in, for one form: a list of suggestions, each for one part. */
export function suggestionSchema(form, careType) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['part', 'field', 'value'],
          properties: { part: { type: 'integer' }, field: { type: 'string', enum: fieldsFor(form, careType) }, value: { type: 'string' } },
        },
      },
    },
  };
}

/** The field list as the AI is told it: "obstetric.living (Living children): number 0–20". */
/** The fields offered for a form and type of care (undefined type: all of them). */
const fieldsFor = (form, careType) => Object.keys(FORM_FIELDS[form]).filter((k) => careType === undefined || fitsCareType(k, careType));

export const fieldList = (form, careType) =>
  Object.entries(FORM_FIELDS[form])
    .filter(([path]) => careType === undefined || fitsCareType(path, careType))
    .map(([path, f]) => {
      const what =
        f.type === 'number' ? `number ${f.min}–${f.max}` : f.type === 'choice' ? `one of ${f.values.join(', ')}` : f.type === 'date' ? 'date YYYY-MM-DD' : 'short text, in the words said';
      return `${path} (${f.label}): ${what}`;
    })
    .join('\n');

const showValue = (f, v) => (f.type === 'date' ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : v.replace(/_/g, ' '));

/**
 * Keeps only suggestions that fit: a known field, a value allowed there, for a part that exists, nothing about the
 * baby's sex (except for a newborn). Values are normalised (numbers as digits, dates checked against today).
 * Returns [{ part, field, value, label }] ("label": what the doctor sees, e.g. "Living children: 2").
 */
export function checkSuggestions(raw, { form, parts, today, careType }) {
  const fields = FORM_FIELDS[form];
  const out = [];
  const seen = new Set();
  for (const s of raw ?? []) {
    const f = fields[s.field];
    if (!fitsCareType(s.field, careType)) continue;
    if (!f || !Number.isInteger(s.part) || s.part < 0 || s.part >= parts.length) continue;
    let value = String(s.value ?? '').trim();
    if (!value) continue;
    if (f.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < f.min || n > f.max || (!f.decimals && !Number.isInteger(n))) continue;
      value = String(n);
    } else if (f.type === 'choice') {
      const hit = f.values.find((x) => x.toLowerCase() === value.toLowerCase());
      if (!hit) continue;
      value = hit;
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const d = Date.parse(`${value}T00:00:00Z`);
      if (Number.isNaN(d) || !f.check(d, today.getTime())) continue;
    } else if (value.length > 200) continue;
    if (careType !== 'newborn' && mentionsFetalSex(value)) continue;
    const key = `${s.part}|${s.field}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ part: s.part, field: s.field, value, label: `${f.label}: ${showValue(f, value)}` });
  }
  // With an LMP the weeks at presentation are worked out from it.
  return out.some((x) => x.field === 'abortion.lmp') ? out.filter((x) => x.field !== 'abortion.weeks') : out;
}

// Pregnancy dates belong to antenatal care, and the pregnancy-loss fields only to the Abortion type of care.
function fitsCareType(field, careType) {
  if (careType === 'abortion') return !String(field).startsWith('pregnancy.');
  return !String(field).startsWith('abortion.');
}
