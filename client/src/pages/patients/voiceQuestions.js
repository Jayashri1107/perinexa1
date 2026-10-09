// "Ask by voice" (owner, 8 Oct 2026): the registration questions, one at a time, and how each spoken answer becomes
// that one field. Simple rules in the browser – nothing is sent anywhere. Each question:
//   { key: the form field, ask: what is said and shown, read(text, ctx): the value, or null when not understood,
//     shown(value, ctx): the value in words, when(values): asked only then }
// PC-PNDT: nothing about a baby's sex before birth is asked (the sex asked is the patient's own).
import { dateFrom, title, wordsToDigits } from './patientFromSpeech.js';

const clean = (t) => String(t ?? '').trim().replace(/[.?!]+$/, '');
const digitsOf = (t) => wordsToDigits(t).replace(/\D/g, '');
// Spoken commands, answered instead of a value
export function commandOf(text) {
  const t = clean(text).toLowerCase();
  if (/^(skip|next|next question|leave it|don'?t know|not known|none)$/.test(t)) return 'skip';
  if (/^(back|go back|previous|last question)$/.test(t)) return 'back';
  if (/^(repeat|again|say again|pardon|sorry)$/.test(t)) return 'repeat';
  if (/^(stop|finish|done|that'?s all|end)$/.test(t)) return 'stop';
  return null;
}

// "her name is Asha Patil" → "Asha Patil"
const nameFrom = (t) => {
  const v = clean(t).replace(/^(her |his |the )?(full )?name( is)?\s+|^(it is|it's|this is)\s+/i, '');
  return /^[a-z][a-z .'-]{1,119}$/i.test(v) ? title(v) : null;
};
// 10 digits, with +91 or 0 in front taken off
const mobileFrom = (t) => {
  let d = digitsOf(t);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^\d{10}$/.test(d) ? d : null;
};
// letters and digits said one by one ("A B C D E 1 2 3 4 F") → "ABCDE1234F"
const codeFrom = (t) => {
  const v = wordsToDigits(t).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 4 ? v : null;
};
const ID_WORDS = [
  [/\baadh?aa?r\b/, 'aadhaar'],
  [/\bpan\b|\bpan card\b/, 'pan'],
  [/\bvoter\b|\belection\b|\bepic\b/, 'voter_id'],
  [/\bdriving\b|\blicen[cs]e\b|\bdl\b/, 'driving_licence'],
  [/\bpassport\b/, 'passport'],
  [/\bration\b/, 'ration_card'],
  [/\bother\b/, 'other'],
];
const CARE_WORDS = [
  [/\b(pregnan\w*|antenatal|anc|expecting)\b/, 'antenatal'],
  [/\b(postnatal|after delivery|delivered)\b/, 'postnatal'],
  [/\b(newborn|new born|baby)\b/, 'newborn'],
  [/\b(miscarriage|abortion|pregnancy loss)\b/, 'pregnancy_loss'],
  [/\b(infertility|trying to conceive)\b/, 'infertility'],
  [/\b(gynae\w*|gyne\w*|gynecology)\b/, 'gynaecology'],
  [/\b(general|other)\b/, 'general'],
];
const labelIn = (list, key) => list?.find((x) => x.key === key)?.label ?? key;

// A date of birth needs its year ("12 May 1995", "12/5/1995", "12-5-95"); a two-digit year in the future is last
// century; a date after today or more than 120 years ago is not taken.
function birthDateFrom(t) {
  // spoken years: "19 95" → 1995, "2 thousand 3" → 2003, "2 thousand" → 2000
  const text = wordsToDigits(ordinalsToDigits(t))
    .replace(/\b(19|20) (\d{2})\b/g, '$1$2')
    .replace(/\b2 thousand(?: and)? (\d{1,2})\b/g, (_, n) => String(2000 + Number(n)))
    .replace(/\b2 thousand\b/g, '2000');
  if (!/\b\d{4}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b/.test(text)) return null;
  let v = dateFrom(text);
  if (!v) return null;
  const now = new Date();
  if (new Date(`${v}T00:00:00`) > now && /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b/.test(text)) v = `${Number(v.slice(0, 4)) - 100}${v.slice(4)}`;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime()) || d > now || now.getFullYear() - d.getFullYear() > 120) return null;
  return v;
}
// "31 years" (or months, for a baby) from a date of birth
export function ageText(iso) {
  const b = new Date(`${iso}T00:00:00`);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) years -= 1;
  if (years >= 1) return `${years} year${years === 1 ? '' : 's'}`;
  const months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth() - (now.getDate() < b.getDate() ? 1 : 0);
  return months >= 1 ? `${months} month${months === 1 ? '' : 's'}` : 'under a month';
}
// "fifth august", "twenty first june" → "5 august", "21 june"
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const ordinalsToDigits = (t) =>
  t
    .toLowerCase()
    .replace(/\b(twenty|thirty)[\s-](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, a, b) => String((a === 'twenty' ? 20 : 30) + ORDINALS[b]))
    .replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g, (w) => String(ORDINALS[w]));

export const QUESTIONS = [
  { key: 'name', ask: 'What is the patient’s full name?', read: nameFrom },
  // the date of birth first (owner, 9 Oct 2026); the age is worked out from it. Only when it is not known: the age.
  {
    key: 'birthDate',
    ask: 'What is the patient’s date of birth? For example, 12 May 1995.',
    read: birthDateFrom,
    shown: (v) => `${new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} – ${ageText(v)}`,
  },
  {
    key: 'ageYears',
    ask: 'The date of birth is not known. How old is she, in years?',
    read: (t) => {
      const n = Number(digitsOf(t));
      return digitsOf(t) && n >= 0 && n <= 120 ? n : null;
    },
    shown: (v) => `${v} years`,
    when: (values) => !values.birthDate,
  },
  {
    key: 'sex',
    ask: 'Is the patient female or male?',
    read: (t) => (/\b(female|woman|lady|girl|f)\b/i.test(t) ? 'female' : /\b(male|man|boy|gentleman|m)\b/i.test(t) ? 'male' : /\bother\b/i.test(t) ? 'other' : null),
    shown: (v, ctx) => labelIn(ctx.sexes, v),
  },
  { key: 'phone', ask: 'What is her mobile number?', read: mobileFrom },
  { key: 'emergencyContact.name', ask: 'What is the name of her relative or attendant?', read: nameFrom },
  {
    key: 'emergencyContact.relation',
    ask: 'How is this person related to her? For example husband, mother.',
    read: (t) => {
      const v = clean(t).replace(/^(he is|she is|her|the)\s+/i, '');
      return /^[a-z][a-z -]{1,49}$/i.test(v) ? title(v) : null;
    },
  },
  { key: 'emergencyContact.phone', ask: 'What is the relative’s mobile number?', read: mobileFrom },
  {
    key: 'idProof.kind',
    ask: 'Which ID proof did you see? Aadhaar, PAN, voter ID, driving licence, passport or ration card?',
    read: (t) => ID_WORDS.find(([re]) => re.test(clean(t).toLowerCase()))?.[1] ?? null,
    shown: (v, ctx) => labelIn(ctx.idProofTypes, v),
  },
  {
    key: 'idProof.number',
    ask: (values) => (values.idProof?.kind === 'aadhaar' ? 'Say the last 4 digits of the Aadhaar number.' : 'Say the ID number, letter by letter and digit by digit.'),
    read: (t, ctx) => {
      if (ctx.values.idProof?.kind === 'aadhaar') {
        const d = digitsOf(t);
        return d.length >= 4 ? d.slice(-4) : null;
      }
      return codeFrom(t);
    },
    when: (values) => Boolean(values.idProof?.kind),
  },
  {
    key: 'address.pincode',
    ask: 'What is the PIN code of her address?',
    read: (t) => {
      const d = digitsOf(t);
      return /^[1-9]\d{5}$/.test(d) ? d : null;
    },
  },
  {
    key: 'address.line',
    ask: 'What is her house, street and area?',
    read: (t) => (clean(t).length >= 3 ? title(clean(t)) : null),
  },
  {
    key: 'careType',
    ask: 'What type of care? For example pregnancy, after delivery, gynaecology, infertility.',
    read: (t, ctx) => {
      const key = CARE_WORDS.find(([re]) => re.test(clean(t).toLowerCase()))?.[1];
      return key && ctx.careTypes.some((c) => c.key === key) ? key : null;
    },
    shown: (v, ctx) => labelIn(ctx.careTypes, v),
  },
  {
    key: 'lmp',
    ask: 'What was the first day of her last period?',
    read: (t) => dateFrom(wordsToDigits(ordinalsToDigits(t))),
    shown: (v) => new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    when: (values, ctx) => Boolean(ctx.careTypes.find((c) => c.key === values.careType)?.needsLmp),
  },
  {
    key: 'assignedDoctorId',
    ask: 'Which doctor will see her?',
    read: (t, ctx) => {
      const said = clean(t).toLowerCase().replace(/\b(doctor|dr)\.?\s*/g, '').split(/\s+/);
      return ctx.doctors.find((d) => d.label.toLowerCase().split(/\s+/).some((w) => w.length > 2 && said.includes(w.replace(/\W/g, ''))))?.value ?? null;
    },
    shown: (v, ctx) => ctx.doctors.find((d) => d.value === v)?.label ?? v,
    when: (_values, ctx) => ctx.doctors.length > 0,
  },
];

export const askText = (q, values) => (typeof q.ask === 'function' ? q.ask(values) : q.ask);
