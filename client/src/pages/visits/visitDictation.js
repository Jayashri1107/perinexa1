// Voice entry for a visit (Feature 8 – Visit details): the vital signs, the pregnancy check, the doctor's notes and the
// next visit, read from dictated (or typed) text – entirely in the browser; nothing is sent anywhere or kept. The same
// plain rules as registration, not AI: patients/dictation.js prepares the text (Indian English corrections, spoken
// numbers, case-sheet shorthand), and the rules here know the visit's details. What they are sure of is filled in and
// marked "From voice – check", what they are not sure of becomes a question with choices, and what they did not
// understand is listed. The baby's sex is never read (PCPNDT): the voice card takes it out first in pregnancy care, and
// a part of the text that still mentions it is not used – for every patient but a newborn, as the server checks.
// The card is registration's (patients/VoiceEntry.jsx); planVisitFill fills the form the way registration does.

import { prepareSpoken, readDate, saysFetalSex } from '../patients/dictation.js';
import { hearingPhrases } from '../patients/obgyTerms.js';
import { MOVEMENT_LABELS, OEDEMA_LABELS, PRESENTATION_LABELS, URINE_LABELS } from './rxFormat.js';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const showDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const capitalise = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const opt = (value, label) => ({ value, label });
const LEAVE_BLANK = opt('ignore', 'Leave blank');
const MAX_UNUSED = 8; // as registration

/** The pregnancy check: read in antenatal visits only (the form shows it only there). */
export const PREGNANCY_CHECK_PATHS = ['details.fundalHeightCm', 'details.fetalHeartRate', 'details.presentation', 'details.fetalMovements', 'details.oedema'];
/** Notes: what is said is added to what is already written, a line each (a number or a choice replaces the old value). */
export const VISIT_TEXT_PATHS = ['details.complaints', 'details.examination', 'details.diagnosis', 'details.investigations', 'details.advice', 'details.privateNote'];
const isText = (path) => VISIT_TEXT_PATHS.includes(path);
/** Every field voice entry can fill on a visit (the form lets each person fill only some: see planVisitFill). */
export const VISIT_VOICE_PATHS = [
  ...['weightKg', 'bpSystolic', 'bpDiastolic', 'pulse', 'temperatureF', 'spo2', 'hb', 'urineAlbumin', 'urineSugar'].map((k) => `vitals.${k}`),
  ...PREGNANCY_CHECK_PATHS,
  ...VISIT_TEXT_PATHS,
  'details.nextVisitOn',
  'details.nextVisitNote',
];

// ---------- The text, prepared ----------

const NUMBER_WORD = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|tirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
// "FH 28", "SFH twenty eight": the fundal height here (registration reads FH as the family history)
const FH_NUMBER = new RegExp(`\\b(?:s\\.?\\s?)?f\\.?\\s?h\\b\\.?(?=\\s*(?:is\\s+|of\\s+|:\\s*|-\\s*|=\\s*)?(?:\\d|(?:${NUMBER_WORD})\\b))`, 'gi');
// A correction said while speaking ("pulse 88, sorry, 92"): kept as a mark that the preparation leaves alone
const CORRECTION_WORDS = /[\s,]*\b(?:(?:i\s*'?\s*a?m\s+)?sorry|no\s+no|i\s+mean|correction|make\s+(?:it|that)|change\s+(?:it|that)\s+to)\b[\s,]*/gi;
const MARK = '§';
// Corrections that made a number ("one tirty" → 130) have no Undo – a number is changed in the form itself (as in
// dictation.js)
const NUMBER_RULES = new Set(['number', 'digits', 'formula', 'height']);

/**
 * The text ready for the visit rules: { text, spans, corrections }. The one place where text is prepared: registration's
 * shared preparation (prepareSpoken) does the Indian English corrections, spoken numbers and shorthand; before it, the
 * fundal height and the correction marks the visit needs. `keep`: words to leave as heard (Undo on a correction).
 */
export function prepareVisitText(text, { careType, words = [], keep = [] } = {}) {
  const raw = String(text ?? '')
    .replace(FH_NUMBER, ' fundal height ')
    .replace(CORRECTION_WORDS, ` ${MARK} `);
  const p = prepareSpoken(raw, { careType, words, voice: true, keep });
  return { text: p.text, spans: p.spans ?? [], corrections: p.corrections ?? [] };
}

// ---------- Details said with their name: numbers and choices ----------

const LINK = '\\s*(?:is|was|of|at|:|-|=|today|now)?\\s*';
// 72 · 110 · "1 20" (one twenty) · "hundred and 10"
const N3 = '((?:a\\s+)?hundred(?:\\s+and)?(?:\\s+\\d{1,2}(?!\\d))?|1\\s+\\d{2}(?!\\d)|\\d{2,3}(?!\\d))';
const num3 = (t) => {
  const h = String(t).match(/hundred(?:\s+and)?(?:\s+(\d{1,2}))?/i);
  return h ? 100 + Number(h[1] ?? 0) : Number(String(t).replace(/\s+/g, ''));
};
const PER_MIN = '(?:\\s*(?:\\/\\s*min(?:ute)?|per\\s+min(?:ute)?|bpm|beats?(?:\\s*(?:\\/|per)\\s*min(?:ute)?)?))?';
const KG = '\\s*(?:kilograms?|kilos?|kgs?)(?![a-z])'; // the longest word first: "kilograms" is not "kilo" + "grams"
const FHR_LABEL = '(?:\\b(?:fetal|foetal|fetus|foetus)\\s+heart(?:\\s+(?:rate|sounds?|tones?|beats?))?|\\bf\\.?\\s?h\\.?\\s?[sr]\\b\\.?)';
const PULSE_LABEL = '\\b(?:pulse(?:\\s+rate)?|p\\.?\\s?r\\.?|heart\\s+rate)\\b\\.?';
const BP_LABEL = '\\b(?:b\\.?\\s?p\\.?|blood\\s+pressure)\\b\\.?';
const URINE_VALUE = '(nil|absent|negative|none|traces?|plus(?:\\s+plus){0,3}|(?:single|double|triple)\\s+plus|\\+{1,4}|[1-4]\\s*\\+|\\+\\s*[1-4]|[1-4]\\s*plus|plus\\s*[1-4])(?![a-z0-9])';
const urineGrade = (v) => {
  const t = v.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(?:nil|absent|negative|none)$/.test(t)) return 'nil';
  if (/^traces?$/.test(t)) return 'trace';
  const plusWords = t.match(/^plus(?: plus)*$/);
  if (plusWords) return `${t.split(' ').length}+`;
  const word = { single: 1, double: 2, triple: 3 }[t.split(' ')[0]];
  if (word) return `${word}+`;
  if (/^\++$/.test(t)) return `${t.length}+`;
  const digit = t.match(/[1-4]/);
  return digit ? `${digit[0]}+` : null;
};
const OEDEMA_WORD = '(?:o?edema|oedema|odema)';
const OEDEMA_PLACE = '(?:(?:pedal|ankle|leg|pitting|facial|bilateral|generali[sz]ed)\\s+)*';
const oedemaGrade = (v) => {
  const t = (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || /^(?:present|positive)$/.test(t)) return null; // a grade is asked
  if (/^(?:nil|absent|none|no)$/.test(t)) return 'none';
  if (/^(?:trace|mild|\+|1 ?plus|plus|grade ?1)$/.test(t)) return 'mild';
  if (/^(?:moderate|\+\+|2 ?plus|plus plus|double plus|grade ?2)$/.test(t)) return 'moderate';
  if (/^(?:severe|gross|\+\+\+|3 ?plus|plus plus plus|triple plus|grade ?3)$/.test(t)) return 'severe';
  return null;
};
const PRESENTATION_OF = (w) => {
  const t = w.toLowerCase();
  if (/cephalic|vertex|head/.test(t)) return 'cephalic';
  if (/breech/.test(t)) return 'breech';
  if (/transverse/.test(t)) return 'transverse';
  if (/oblique/.test(t)) return 'oblique';
  return 'variable';
};
const MOVEMENTS_OF = (w) => {
  const t = w.toLowerCase();
  if (/reduced|decreased|less|diminished|poor/.test(t)) return 'reduced';
  if (/absent|not|nil|negative|no\b/.test(t)) return 'absent';
  return 'present';
};

// Said about the past or denied: "previous breech", "not cephalic"
const NOT_NOW = /\b(?:previous|last|prior|past|history\s+of|h\s*\/\s*o|not|no)\s+(?:\w+\s+)?$/i;
const beforeIn = (s, start, n = 30) => s.slice(Math.max(0, start - n), start);
const set1 = (path) => (v) => ({ [path]: String(v) });

/**
 * The details read with their name. Each: the form field(s) it fills, how it is found (rx: one or more patterns,
 * `read` turning a match into a value or null), what a sensible value is (`ok`), how it is shown (`text`), and what
 * it puts into the form (`set`). `again`: the same value said after a correction mark ("88 § 92").
 */
function details(careType) {
  const newborn = careType === 'newborn';
  const [minKg, maxKg] = newborn ? [0.3, 10] : [25, 200];
  return [
    {
      key: 'fhr',
      name: 'fetal heart rate',
      pregnancyCheck: true,
      rx: [new RegExp(`${FHR_LABEL}${LINK}${N3}${PER_MIN}`, 'gi')],
      again: new RegExp(`^(?:${FHR_LABEL}${LINK})?${N3}${PER_MIN}`, 'i'),
      read: (m) => num3(m[1]),
      ok: (v) => v >= 60 && v <= 220,
      text: (v) => `${v}/min`,
      set: set1('details.fetalHeartRate'),
    },
    {
      key: 'bp',
      name: 'blood pressure',
      rx: [
        new RegExp(`${BP_LABEL}${LINK}${N3}\\s*(?:\\/|by|over|upon|slash|on)?\\s*(\\d{2,3})(?!\\d)(?:\\s*mm\\s*(?:of\\s*)?hg|\\s*millimet(?:er|re)s?\\s+of\\s+mercury)?`, 'gi'),
        // "120/80" said without "BP" (never a date: a day is not 60 or more)
        /(?<![\d/.:-])(1\d{2}|[6-9]\d)\s*\/\s*(\d{2,3})(?![\d/])/g,
      ],
      again: new RegExp(`^(?:${BP_LABEL}${LINK})?${N3}\\s*(?:\\/|by|over|upon|slash|on)?\\s*(\\d{2,3})(?!\\d)`, 'i'),
      read: (m) => ({ sys: num3(m[1]), dia: Number(m[2]) }),
      ok: (v) => v.sys >= 50 && v.sys <= 260 && v.dia >= 30 && v.dia <= 160 && v.dia < v.sys,
      key2: (v) => `${v.sys}/${v.dia}`,
      text: (v) => `${v.sys}/${v.dia} mmHg`,
      set: (v) => ({ 'vitals.bpSystolic': String(v.sys), 'vitals.bpDiastolic': String(v.dia) }),
    },
    {
      key: 'pulse',
      name: 'pulse',
      rx: [new RegExp(`${PULSE_LABEL}${LINK}${N3}${PER_MIN}`, 'gi')],
      again: new RegExp(`^(?:${PULSE_LABEL}${LINK})?${N3}${PER_MIN}`, 'i'),
      skip: (s, start) => /\b(?:fetal|foetal|fetus|foetus)\s+$/i.test(beforeIn(s, start, 12)),
      read: (m) => num3(m[1]),
      ok: (v) => v >= 30 && v <= 220,
      text: (v) => `${v}/min`,
      set: set1('vitals.pulse'),
    },
    {
      key: 'weight',
      name: 'weight',
      rx: [
        new RegExp(`\\b(?:weight|weighs|wt)\\b\\.?${LINK}(\\d{1,3}(?:\\.\\d{1,2})?)(?!\\d)(?:${KG})?`, 'gi'),
        // "58 kg" said without "weight" (a newborn's "2.8 kg"; for others, not "gained 2 kg")
        new RegExp(`(?<![\\d.])(${newborn ? '\\d{1,2}(?:\\.\\d{1,2})?' : '\\d{2,3}(?:\\.\\d{1,2})?'})${KG}\\b`, 'gi'),
      ],
      again: new RegExp(`^(?:(?:weight|weighs|wt)\\b\\.?${LINK})?(\\d{1,3}(?:\\.\\d{1,2})?)(?!\\d)(?:${KG})?`, 'i'),
      read: (m) => Number(m[1]),
      ok: (v) => v >= minKg && v <= maxKg,
      text: (v) => `${v} kg`,
      set: set1('vitals.weightKg'),
    },
    {
      key: 'temperature',
      name: 'temperature',
      rx: [new RegExp(`\\btemp(?:erature)?\\b\\.?${LINK}(\\d{2,3}(?:\\.\\d{1,2})?)(?!\\d)\\s*(?:°|degrees?|deg\\.?)?\\s*(f(?:ahrenheit)?|c(?:elsius|entigrade)?)?(?![a-z])`, 'gi')],
      again: /^(\d{2,3}(?:\.\d{1,2})?)(?!\d)\s*(?:°|degrees?|deg\.?)?\s*(f(?:ahrenheit)?|c(?:elsius|entigrade)?)?(?![a-z])/i,
      read: (m) => {
        const v = Number(m[1]);
        const unit = m[2] ? (/^c/i.test(m[2]) ? 'C' : 'F') : v <= 45 ? 'C' : 'F';
        return { v, unit };
      },
      ok: (t) => (t.unit === 'F' ? t.v >= 90 && t.v <= 110 : t.v >= 32 && t.v <= 43),
      key2: (t) => `${t.v}${t.unit}`,
      text: (t) => `${t.v} °${t.unit}`,
      set: (t) => ({ 'vitals.temperatureF': String(t.v) }),
      // In Celsius: asked, with the Fahrenheit the form keeps
      celsius: (t) => t.unit === 'C',
    },
    {
      key: 'spo2',
      name: 'SpO2',
      rx: [new RegExp(`\\b(?:s\\s?p\\s?[o0]\\s?2|s\\s?a\\s?[o0]\\s?2|o2\\s+sat(?:uration)?s?|oxygen\\s+saturation|saturation|sats?)\\b${LINK}(\\d{2,3})(?!\\d)\\s*(?:%|percent|per\\s*cent)?`, 'gi')],
      again: /^(\d{2,3})(?!\d)\s*(?:%|percent|per\s*cent)?/i,
      read: (m) => Number(m[1]),
      ok: (v) => v >= 50 && v <= 100,
      text: (v) => `${v}%`,
      set: set1('vitals.spo2'),
    },
    {
      key: 'hb',
      name: 'Hb',
      rx: [new RegExp(`\\b(?:h\\s?b|hgb|ha?emoglobin|hemoglobin)\\b\\.?${LINK}(\\d{1,2}(?:\\.\\d{1,2})?)(?!\\d)\\s*(?:grams?(?:\\s*(?:%|percent|per\\s*cent))?|g\\s*\\/\\s*dl|gm?s?(?![a-z])\\s*(?:%|percent|per\\s*cent|\\/\\s*dl)?)?`, 'gi')],
      again: /^(\d{1,2}(?:\.\d{1,2})?)(?!\d)/i,
      read: (m) => Number(m[1]),
      ok: (v) => v >= 2 && v <= 25,
      text: (v) => `${v} g/dL`,
      set: set1('vitals.hb'),
    },
    {
      key: 'fundal',
      name: 'fundal height',
      pregnancyCheck: true,
      rx: [new RegExp(`\\b(?:(?:symphysio[\\s-]?)?fundal\\s+height|fundus(?:\\s+height)?|sfh)\\b${LINK}(?:corresponds\\s+to\\s+|of\\s+)?(\\d{1,2})(?!\\d)\\s*(cms?|centimet(?:er|re)s?|weeks?|wks?)?(?![a-z])`, 'gi')],
      again: /^(\d{1,2})(?!\d)\s*(cms?|centimet(?:er|re)s?|weeks?|wks?)?(?![a-z])/i,
      read: (m) => ({ v: Number(m[1]), weeks: /^w/i.test(m[2] ?? '') }),
      ok: (f) => f.v >= 5 && f.v <= 50,
      key2: (f) => String(f.v),
      text: (f) => `${f.v} ${f.weeks ? 'weeks' : 'cm'}`,
      set: (f) => ({ 'details.fundalHeightCm': String(f.v) }),
      // Said in weeks: asked (the form keeps centimetres)
      weeks: (f) => f.weeks,
    },
    {
      key: 'albumin',
      name: 'urine albumin',
      rx: [
        // "urine albumin and sugar nil": both
        new RegExp(`\\b(?:urine\\s+(?:examination\\s+)?)?(?:albumin|alb|protein)\\s*(?:and|,|&|\\/)\\s*(?:sugar|glucose)\\s*(?:are\\s+|is\\s+|both\\s+|:\\s*|-\\s*)*${URINE_VALUE}`, 'gi'),
        new RegExp(`\\b(?:urine\\s+)?(?:albumin|alb|protein)\\b\\s*(?:is|:|-|in\\s+urine)?\\s*${URINE_VALUE}`, 'gi'),
      ],
      read: (m) => urineGrade(m[1]),
      both: (m) => /sugar|glucose/i.test(m[0]),
      ok: (v) => Boolean(v),
      text: (v) => URINE_LABELS[v],
      set: set1('vitals.urineAlbumin'),
    },
    {
      key: 'sugar',
      name: 'urine sugar',
      rx: [new RegExp(`\\b(?:urine\\s+)?(?:sugar|glucose)\\b\\s*(?:is|:|-|in\\s+urine)?\\s*${URINE_VALUE}`, 'gi')],
      skip: (s, start) => /\b(?:blood|fasting|random|pp|post\s*prandial|fbs|ppbs|rbs|albumin\s*(?:and|,|&|\/)\s*)\s*$/i.test(beforeIn(s, start, 20)),
      read: (m) => urineGrade(m[1]),
      ok: (v) => Boolean(v),
      text: (v) => URINE_LABELS[v],
      set: set1('vitals.urineSugar'),
    },
    {
      key: 'presentation',
      name: 'presentation',
      pregnancyCheck: true,
      rx: [/\b(?:presentation\s*(?:is|:|-)?\s*)?(cephalic|vertex|head\s+down|breech|transverse(?:\s+lie)?|oblique(?:\s+lie)?|(?:variable|unstable)(?:\s+(?:lie|presentation))?)\b/gi],
      skip: (s, start) => NOT_NOW.test(beforeIn(s, start)),
      read: (m) => PRESENTATION_OF(m[1]),
      ok: () => true,
      text: (v) => PRESENTATION_LABELS[v],
      set: set1('details.presentation'),
    },
    {
      key: 'movements',
      name: 'fetal movements',
      pregnancyCheck: true,
      rx: [
        /\b(?:no|nil|absent)\s+(?:fetal|foetal)\s+movements?\b/gi,
        /\b(?:perceives?|perceiving|perceived|feels?|feeling)\s+(?:(?:the\s+)?(?:fetal|foetal|baby'?s?)\s+)?movements?\b/gi,
        /\b(?:(?:fetal|foetal)\s+movements?|f\.?\s?m\.?s?|fms)\b\s*(?:is|are|:|-)?\s*(present|positive|good|felt|perceived|normal|adequate|active|\+(?!\+)|reduced|decreased|less|diminished|poor|absent|not\s+(?:felt|perceived)|nil|negative)?/gi,
      ],
      read: (m) => (/^(?:no|nil|absent)\s/i.test(m[0]) ? 'absent' : /^(?:perceiv|feel)/i.test(m[0]) ? 'present' : m[1] ? MOVEMENTS_OF(m[1]) : undefined),
      ok: () => true,
      text: (v) => MOVEMENT_LABELS[v],
      set: set1('details.fetalMovements'),
      // Said without present, reduced or absent: asked
      ask: { prompt: 'Fetal movements: present, reduced or absent?', values: ['present', 'reduced', 'absent'] },
    },
    {
      key: 'oedema',
      name: 'oedema',
      pregnancyCheck: true,
      rx: [
        new RegExp(`\\b(?:no|nil|without|absent)\\s+${OEDEMA_PLACE}${OEDEMA_WORD}\\b`, 'gi'),
        new RegExp(`\\b${OEDEMA_PLACE}${OEDEMA_WORD}\\b\\s*(?:is|:|-|of\\s+(?:both\\s+)?(?:feet|legs))?\\s*(nil|absent|none|trace|mild|moderate|severe|gross|present|positive|grade\\s*[1-3]|\\+{1,3}(?!\\+)|[1-3]\\s*plus|plus(?:\\s+plus){0,2}|(?:double|triple)\\s+plus)?(?![a-z0-9])`, 'gi'),
      ],
      read: (m) => (/^(?:no|nil|without|absent)\s/i.test(m[0]) ? 'none' : (oedemaGrade(m[1]) ?? undefined)),
      ok: () => true,
      text: (v) => OEDEMA_LABELS[v],
      set: set1('details.oedema'),
      ask: { prompt: 'Oedema: how much?', values: ['mild', 'moderate', 'severe'] },
    },
  ];
}

// ---------- Notes said under a heading ----------

// After "review", "follow up", "come back" and the like: a date, SOS or what to bring. Otherwise the word belongs to a
// note ("review scan", "come back if bleeding").
const WHEN_NEXT =
  '(?=[\\s,:-]*(?:(?:is|on|at|by|after|in|within)\\s+)?(?:\\d|an?\\s+(?:week|fortnight|month)|(?:next|coming|this)\\s+\\w|tomorrow|day\\s+after|fortnight|' +
  '(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d|' +
  'sos\\b|with\\s+(?:the\\s+|all\\s+)?(?:reports?|results?|scan|usg|sonography)))';
// The headings a doctor says, in the order the notes are kept
const HEADINGS = [
  ['complaints', /\b(?:(?:chief|presenting|main|present)\s+)?complaints?\b(?:\s+(?:of|are|is))?|\bcomplain(?:s|ing|ed)?\s+of\b|\b(?:she|patient|pt)\s+(?:says|reports|complains|is\s+complaining)\b(?:\s+of)?|\bc\s*\/\s*o\b/gi],
  ['examination', /\bon\s+(?:general\s+)?examination\b|\bo\s*\/\s*e\b|\b(?:general|systemic|abdominal|obstetric|breast|pelvic|local|speculum|vaginal)\s+examination\b|\bexamination(?:\s+findings?)?\b|\bfindings?\b/gi],
  ['diagnosis', /\b(?:(?:provisional|working|final|clinical)\s+)?diagnosis\b|\bimpression\b|\bdx\b/gi],
  ['investigations', /\b(?:tests?|investigations?|labs?|lab\s+tests?)(?:\s+(?:advised|advice|ordered|to\s+(?:be\s+)?do(?:ne)?|required|needed|sent|asked\s+for))?\b|\bsend\s+for\b/gi],
  ['advice', /\badvice\b|\badvised?\b|\bcounsell?(?:ed|ing)\b|\btold\s+to\b|\basked\s+to\b/gi],
  ['privateNote', /\bprivate\s+note\b|\bnote\s+for\s+(?:me|myself)\b/gi],
  [
    'nextVisit',
    new RegExp(
      `\\bnext\\s+(?:visit|review|follow[\\s-]?up|check[\\s-]?up|appointment|anc(?:\\s+visit)?|antenatal\\s+visit)\\b|(?:\\breview|\\bfollow[\\s-]?up|\\bf\\s*\\/\\s*u|\\brevisit|\\bcome\\s+(?:back|again)|\\brecall)\\b${WHEN_NEXT}`,
      'gi',
    ),
  ],
];
// Findings that start the examination at the start of a sentence, or when no heading was said before them
const EXAM_START =
  /\b(?:per\s+abdomen|p\s*\/\s*a\b|pa\s+(?:soft|tender|distended|relaxed|non[\s-]?tender)|per\s+speculum|p\s*\/\s*s\b|pallor|icterus|jaundice|cyanosis|clubbing|lymphadenopathy|general\s+condition|gc\s+(?:fair|good|poor|stable)|chest\s+clear|cvs\b|rs\s+(?:clear|nad|normal)|uterus\b|os\s+(?:closed|open|admits)|cervix\b|abdomen\s+(?:soft|tender|distended)|breasts?\s+(?:normal|soft)|(?:fetal\s+heart(?:\s+sounds?)?|f\.?\s?h\.?\s?[sr]\b\.?)\s*(?:is\s+|:\s*)?(?:present|positive|heard|good|regular|normal|absent|not\s+heard|not\s+locali[sz]ed|negative|irregular))/gi;
// Said after "advised": a test (it goes under Tests advised), otherwise advice
const TEST_WORD =
  /^(?:(?:to\s+)?(?:do|get|repeat|send|check)\s+(?:a\s+|an\s+|the\s+|her\s+)?|for\s+)?(?:repeat\s+)?(?:cbc|complete\s+blood\s+count|hb|ha?emoglobin|hemogram|tsh|thyroid(?:\s+(?:profile|test|function))?|t3|t4|urine(?:\s+(?:routine|r\s*\/\s*m|culture|examination|test|for))?|usg|ultrasound|sonography|(?:\w+\s+)?scan|nst|non[\s-]?stress\s+test|doppler|echo|ecg|ogtt|gtt|gct|glucose\s+(?:tolerance|challenge)|blood\s+sugar|sugar|fbs|ppbs|rbs|hba1c|lft|kft|rft|liver\s+function|kidney\s+function|renal\s+function|creatinine|urea|uric\s+acid|hiv|hbsag|vdrl|hcv|serology|ict|indirect\s+coombs|coombs|blood\s+group|ferritin|iron\s+studies|vitamin\s+(?:d|b12)|platelets?|coagulation|pt[\s-]?inr|ldh|upcr|protein\s+creatinine|24\s+hours?\s+urine|pap(?:\s+smear)?|x[\s-]?ray|mri|double\s+marker|triple\s+marker|quadruple\s+marker|nipt|culture|swab)\b/i;
const FILLER = /^(?:okay|ok|so|then|and|also|haan|han|achha|acha|accha|ji|um|uh|hmm|that'?s\s+all|thank\s+you|thanks|done|full\s+stop|next|please|doctor|sister)$/i;
const onlyFiller = (t) =>
  t
    .split(/[\s,.;:]+/)
    .filter(Boolean)
    .every((w) => FILLER.test(w));
const tidy = (t) =>
  String(t ?? '')
    .replace(/§/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])(?:\s*[,.;:])+/g, '$1')
    .replace(/^[\s,.;:)-]+|[\s,;:(-]+$/g, '')
    .replace(/^(?:(?:is|are|was|were|of|that|okay|ok|so)\b[\s,:-]*)+/i, '')
    .replace(/(?:[\s,]+(?:okay|ok|ji|haan|achha))+[.\s]*$/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
// The end of a sentence (not the dot in 98.6 or 15.10.2026)
const BOUNDARY = /\.(?!\d)|(?<!\d)\.|[;\n]/g;

// ---------- The next visit ----------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const addMonths = (t, n) => {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last));
};
/** "after 2 weeks", "in 10 days", "on 15th October", "next Monday", "tomorrow" → { iso, end } from the start of `t`. */
function readNextDate(t, visitDay) {
  const lead = t.match(/^[\s,:;-]*(?:(?:is|was|will\s+be|should\s+be|to\s+be|on|at|by)\s+)?/i)[0];
  const body = t.slice(lead.length);
  const done = (at, len) => ({ iso: isoDay(at), end: lead.length + len });
  let m = body.match(/^(?:after|in|within)\s+(\d{1,2}|a|an)\s*(days?|weeks?|wks?|months?)\b|^(\d{1,2})\s*(days?|weeks?|wks?|months?)\s+(?:later|after|from\s+(?:now|today))\b/i);
  if (m) {
    const n = /^an?$/i.test(m[1] ?? '') ? 1 : Number(m[1] ?? m[3]);
    const unit = (m[2] ?? m[4]).toLowerCase();
    if (unit.startsWith('month')) return done(addMonths(visitDay, n), m[0].length);
    return done(visitDay + n * (unit.startsWith('w') ? 7 : 1) * DAY, m[0].length);
  }
  if ((m = body.match(/^(?:after\s+|in\s+)?(?:a\s+)?fortnight\b/i))) return done(visitDay + 14 * DAY, m[0].length);
  if ((m = body.match(/^(?:next|coming)\s+(week|month)\b/i))) return done(m[1].toLowerCase() === 'week' ? visitDay + 7 * DAY : addMonths(visitDay, 1), m[0].length);
  if ((m = body.match(/^day\s+after\s+tomorrow\b/i))) return done(visitDay + 2 * DAY, m[0].length);
  if ((m = body.match(/^tomorrow\b/i))) return done(visitDay + DAY, m[0].length);
  if ((m = body.match(new RegExp(`^(?:(?:next|coming|this)\\s+)?(${WEEKDAYS.join('|')})\\b`, 'i')))) {
    const want = WEEKDAYS.indexOf(m[1].toLowerCase());
    const have = new Date(visitDay).getUTCDay();
    return done(visitDay + (((want - have + 7) % 7) || 7) * DAY, m[0].length);
  }
  const v = new Date(visitDay);
  const date = readDate(body, new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()), 'future', true);
  return date ? { iso: date.iso, end: lead.length + date.end } : null;
}

// ---------- Reading ----------

const LABELS = {
  'details.complaints': 'Complaints',
  'details.examination': 'Examination findings',
  'details.diagnosis': 'Diagnosis',
  'details.investigations': 'Tests advised',
  'details.advice': 'Advice for the patient',
  'details.privateNote': 'Private note',
  'details.nextVisitNote': 'Next visit note',
};
const partOf = (path) => (path.startsWith('vitals.') ? 'vitals' : path === 'details.privateNote' ? 'private' : 'clinical');
// A note's lines, each once
const linesOf = (t) => {
  const seen = new Set();
  const lines = [];
  for (const line of String(t ?? '').split('\n')) {
    const x = line.trim();
    if (x && !seen.has(x.toLowerCase())) {
      seen.add(x.toLowerCase());
      lines.push(x);
    }
  }
  return lines;
};

/**
 * What was filled, to show: [{ label, text, paths, part, path? }] in the form's order. `path` (numbers and choices):
 * the card keeps an answer in its list until that field is changed by hand.
 */
function foundOf(values, paths) {
  const v = { ...values.vitals, ...values.details };
  const has = (p) => paths.includes(p);
  const found = [];
  const show = (label, text, list) => found.push({ label, text, paths: list, part: partOf(list[0]), ...(isText(list[0]) ? {} : { path: list[0] }) });
  if (has('vitals.weightKg')) show('Weight', `${v.weightKg} kg`, ['vitals.weightKg']);
  if (has('vitals.bpSystolic')) show('Blood pressure', `${v.bpSystolic}/${v.bpDiastolic} mmHg`, ['vitals.bpSystolic', 'vitals.bpDiastolic']);
  if (has('vitals.pulse')) show('Pulse', `${v.pulse}/min`, ['vitals.pulse']);
  if (has('vitals.temperatureF')) show('Temperature', `${v.temperatureF} °F`, ['vitals.temperatureF']);
  if (has('vitals.spo2')) show('SpO2', `${v.spo2}%`, ['vitals.spo2']);
  if (has('vitals.hb')) show('Hb', `${v.hb} g/dL`, ['vitals.hb']);
  if (has('vitals.urineAlbumin')) show('Urine albumin', URINE_LABELS[v.urineAlbumin], ['vitals.urineAlbumin']);
  if (has('vitals.urineSugar')) show('Urine sugar', URINE_LABELS[v.urineSugar], ['vitals.urineSugar']);
  if (has('details.fundalHeightCm')) show('Fundal height', `${v.fundalHeightCm} cm`, ['details.fundalHeightCm']);
  if (has('details.fetalHeartRate')) show('Fetal heart rate', `${v.fetalHeartRate}/min`, ['details.fetalHeartRate']);
  if (has('details.presentation')) show('Presentation', PRESENTATION_LABELS[v.presentation], ['details.presentation']);
  if (has('details.fetalMovements')) show('Fetal movements', MOVEMENT_LABELS[v.fetalMovements], ['details.fetalMovements']);
  if (has('details.oedema')) show('Oedema', OEDEMA_LABELS[v.oedema], ['details.oedema']);
  for (const path of VISIT_TEXT_PATHS) if (has(path)) show(LABELS[path], linesOf(v[path.split('.')[1]]).join('; '), [path]);
  if (has('details.nextVisitOn')) show('Next visit', showDate(v.nextVisitOn), ['details.nextVisitOn']);
  if (has('details.nextVisitNote')) show(LABELS['details.nextVisitNote'], v.nextVisitNote, ['details.nextVisitNote']);
  return found;
}

const setValue = (pairs) => `set:${Object.entries(pairs)
  .map(([p, v]) => `${p}=${encodeURIComponent(v)}`)
  .join('&')}`;

/**
 * The visit details in dictated text. `visitOn`: the visit's date (the next visit is counted from it); `careType`: the
 * pregnancy check is read in antenatal visits only; `words`: the person's own words and `keep` the words to leave as
 * heard (Undo), both for the shared preparation.
 * Returns { values: { vitals, details }, paths, found, notes, questions, unused, corrections } – values as the form keeps
 * them (strings, "YYYY-MM-DD", a note's parts a line each); found: [{ label, text, paths, part: 'vitals' | 'clinical' |
 * 'private', path? }]; questions: [{ id, key, heard, prompt, options, paths, part, group, remember }]; unused: [{ text,
 * note, canNote, sex, start }]; corrections: [{ heard, to, rule, tier, undo? }] (a number's has undo: false).
 */
export function extractVisitDetails(text, { careType = 'antenatal', visitOn = new Date(), words = [], keep = [] } = {}) {
  const prepared = prepareVisitText(text, { careType, words, keep });
  const s = prepared.text;
  const visitDay = Date.parse(isoDay(visitOn));
  const antenatal = careType === 'antenatal';
  const newborn = careType === 'newborn';
  const values = { vitals: {}, details: {} };
  const paths = [];
  const notes = [];
  const questions = [];
  const unused = [];
  const used = [];
  const isUsed = (a, b) => used.some(([x, y]) => a < y && b > x);
  const use = (a, b) => used.push([a, b]);
  const inName = (a) => prepared.spans.some((p) => p.kind !== 'address' && a >= p.start && a < p.end);
  const put = (pairs) => {
    for (const [path, value] of Object.entries(pairs)) {
      const [part, key] = path.split('.');
      values[part][key] = value;
      if (!paths.includes(path)) paths.push(path);
    }
  };
  const note = (t) => !notes.includes(t) && notes.push(t);
  const ask = (q, heard, at) =>
    questions.push({ key: null, remember: false, group: 'other', ...q, part: partOf(q.paths[0]), heard: tidy(heard), id: `vq${questions.length}-${at}` });
  // The baby's sex (PCPNDT): that part is not used, and the card says so once
  const aboutSex = (t) => !newborn && saysFetalSex(t);
  const sexPart = (at) => !unused.some((u) => u.sex) && unused.push({ text: '', note: '', canNote: false, sex: true, start: at });

  // 1. Details said with their name. The same detail twice with different values is asked; a value after a
  //    correction mark replaces the one before it.
  for (const d of details(careType)) {
    if (d.pregnancyCheck && !antenatal) continue; // left in the notes, as said
    const hits = [];
    for (const rx of d.rx) {
      for (const m of s.matchAll(rx)) {
        const start = m.index;
        let end = start + m[0].length;
        if (isUsed(start, end) || inName(start) || d.skip?.(s, start, m)) continue;
        let value = d.read(m);
        if (value === null) continue;
        const mark = s.slice(end).match(/^\s*§\s*/);
        const again = mark && d.again && s.slice(end + mark[0].length).match(d.again);
        const next = again ? d.read(again) : null;
        if (next !== null && next !== undefined) {
          note(`Corrected while speaking: ${d.name} ${value === undefined ? '' : `${d.text(value)} `}→ ${d.text(next)}.`);
          value = next;
          end += mark[0].length + again[0].length;
        }
        use(start, end);
        hits.push({ value, start, end, both: d.both?.(m) });
      }
    }
    const heardOf = (h) => s.slice(h.start, h.end);
    const good = hits.filter((h) => h.value !== undefined && d.ok(h.value));
    for (const h of hits) if (h.value !== undefined && !d.ok(h.value)) note(`The ${d.name} heard (${d.text(h.value)}) doesn't look right, so it was not used.`);
    const byKey = new Map(good.map((h) => [(d.key2 ?? String)(h.value), h]));
    const distinct = [...byKey.values()];
    if (distinct.length > 1) {
      const pathsOf = Object.keys(d.set(distinct[0].value));
      ask(
        {
          prompt: `${capitalise(d.name)}: ${distinct.map((h) => d.text(h.value)).join(' or ')}?`,
          options: [...distinct.map((h) => opt(setValue(d.set(h.value)), d.text(h.value))), LEAVE_BLANK],
          paths: pathsOf,
        },
        distinct.map(heardOf).join(' … '),
        distinct[0].start,
      );
    } else if (distinct.length === 1) {
      const h = distinct[0];
      if (d.celsius?.(h.value)) {
        const f = Math.round((h.value.v * 9) / 5 * 10 + 320) / 10;
        ask({ prompt: `Temperature ${h.value.v} °C is ${f} °F. Use ${f} °F?`, options: [opt(setValue({ 'vitals.temperatureF': String(f) }), `${f} °F`), LEAVE_BLANK], paths: ['vitals.temperatureF'] }, heardOf(h), h.start);
      } else if (d.weeks?.(h.value)) {
        ask({ prompt: `Fundal height ${h.value.v} weeks: write ${h.value.v} cm?`, options: [opt(setValue(d.set(h.value)), `${h.value.v} cm`), LEAVE_BLANK], paths: ['details.fundalHeightCm'] }, heardOf(h), h.start);
      } else {
        put(d.set(h.value));
        if (h.both) put({ 'vitals.urineSugar': h.value });
      }
    } else if (d.ask && hits.some((h) => h.value === undefined)) {
      const h = hits.find((x) => x.value === undefined);
      const path = Object.keys(d.set('x'))[0];
      ask({ prompt: d.ask.prompt, options: [...d.ask.values.map((v) => opt(setValue({ [path]: v }), d.text(v))), LEAVE_BLANK], paths: [path] }, heardOf(h), h.start);
    }
  }

  // 2. Notes said under a heading: from the heading to the next one. The next visit takes its sentence only; a finding
  //    such as "pallor" starts the examination at the start of a sentence, or before any heading.
  const heads = [];
  for (const [to, rx] of HEADINGS) {
    for (const m of s.matchAll(rx)) {
      let start = m.index;
      const end = start + m[0].length;
      if (isUsed(start, end)) continue;
      let no = false;
      if (to === 'complaints') {
        const before = s.slice(0, start).match(/\b(?:no|nil|without)\s+(?:(?:fresh|new|other|specific|significant)\s+)?$/i);
        if (before) {
          no = true;
          start = before.index;
        }
      }
      heads.push({ to, start, end, no });
    }
  }
  const firstHead = Math.min(...heads.map((h) => h.start), s.length);
  const sentenceStart = (i) => {
    let at = 0;
    for (const m of s.slice(0, i).matchAll(BOUNDARY)) at = m.index + 1;
    return at;
  };
  for (const m of s.matchAll(EXAM_START)) {
    const start = m.index;
    if (isUsed(start, start + m[0].length)) continue;
    const atSentence = !s.slice(sentenceStart(start), start).replace(/[\s,]+/g, '');
    if (atSentence || start < firstHead) heads.push({ to: 'examination', start, end: start, inline: true });
  }
  heads.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const h of heads) {
    const last = kept.at(-1);
    if (last && h.start < Math.max(last.end, last.start + 1)) continue; // inside the heading before it ("tests advised")
    if (last?.inline && h.inline && h.to === last.to) continue; // one examination, not one per finding
    kept.push(h);
  }
  const texts = { complaints: [], examination: [], diagnosis: [], investigations: [], advice: [], privateNote: [] };
  // The text between a and b without the details already read (each one leaves a comma behind)
  const plain = (a, b) => {
    let out = '';
    let gap = false;
    for (let i = a; i < b; i += 1) {
      const taken = used.some(([x, y]) => i >= x && i < y);
      if (!taken) out += s[i];
      else if (!gap) out += ' , ';
      gap = taken;
    }
    return out;
  };
  let nextVisit = null;
  const loose = [[0, kept[0]?.start ?? s.length]]; // text under no heading
  kept.forEach((h, i) => {
    let end = kept[i + 1]?.start ?? s.length;
    if (h.to === 'nextVisit') {
      const stop = s.slice(h.end, end).search(BOUNDARY);
      if (stop >= 0) {
        loose.push([h.end + stop + 1, end]);
        end = h.end + stop + 1;
      }
    }
    const body = plain(h.end, end);
    if (h.to === 'nextVisit') {
      const date = readNextDate(body, visitDay);
      const rest = tidy(date ? body.slice(date.end) : body);
      nextVisit ??= { date, heard: s.slice(h.start, end), start: h.start, note: '' };
      if (date && !nextVisit.date) nextVisit.date = date;
      const more = rest.replace(/[.;,\s]+$/, '');
      if (more && !onlyFiller(more)) nextVisit.note = nextVisit.note ? `${nextVisit.note}; ${more}` : more;
      return;
    }
    const content = tidy(body);
    const add = (to, t) => texts[to].push({ text: t, at: h.start });
    if (h.no) {
      add('complaints', content ? `No complaints, ${content}` : 'No complaints');
      return;
    }
    if (!content || onlyFiller(content)) return;
    if (h.to === 'advice' && !/^advice\b/i.test(s.slice(h.start, h.end))) {
      // "advised CBC, urine routine and rest": each part where it belongs
      const parts = content.split(/\s*(?:,|;|\band\b|\.)\s*/i).filter(Boolean);
      const tests = parts.filter((p) => TEST_WORD.test(p));
      const rest = parts.filter((p) => !TEST_WORD.test(p)).map((p) => p.replace(/^to\s+/i, ''));
      if (tests.length) add('investigations', tests.join(', '));
      if (rest.length) add('advice', rest.join(', '));
      return;
    }
    add(h.to, content);
  });

  // Each part a line of its own (the form adds each line once)
  for (const [to, list] of Object.entries(texts)) {
    const lines = [];
    for (const { text: t, at } of list) {
      for (const line of t.split('\n')) {
        const piece = capitalise(line.trim().replace(/[.;,\s]+$/, ''));
        if (!piece || lines.some((x) => x.toLowerCase() === piece.toLowerCase())) continue;
        if (aboutSex(piece)) sexPart(at);
        else lines.push(piece);
      }
    }
    if (lines.length) put({ [`details.${to}`]: lines.join('\n') });
  }

  if (nextVisit) {
    const { date } = nextVisit;
    if (date) {
      const t = Date.parse(date.iso);
      if (t <= visitDay) note(`The next visit heard (${showDate(date.iso)}) is not after this visit, so it was not used.`);
      else if (t > visitDay + 366 * DAY) note(`The next visit heard (${showDate(date.iso)}) is more than a year away, so it was not used.`);
      else put({ 'details.nextVisitOn': date.iso });
    }
    if (nextVisit.note) {
      const n = capitalise(nextVisit.note.replace(/[.;,\s]+$/, '')).slice(0, 200);
      if (aboutSex(n)) sexPart(nextVisit.start);
      else put({ 'details.nextVisitNote': n });
    }
    if (!date && !nextVisit.note) unused.push({ text: tidy(nextVisit.heard), note: tidy(nextVisit.heard), canNote: true, start: nextVisit.start });
  }

  // 3. What nothing was taken from
  for (const [a, b] of loose) {
    let offset = 0;
    for (const bit of plain(a, b).split(BOUNDARY)) {
      const at = a + offset;
      offset += bit.length + 1;
      const t = tidy(bit);
      if (!t || onlyFiller(t) || !/[a-z]{2}/i.test(t)) continue;
      if (aboutSex(t)) sexPart(at);
      else if (unused.length < MAX_UNUSED) unused.push({ text: t.length > 100 ? `${t.slice(0, 100)}…` : t, note: capitalise(t).slice(0, 200), canNote: true, start: at });
    }
  }

  const corrections = prepared.corrections.map((c) => (NUMBER_RULES.has(c.rule) ? { ...c, undo: false } : c));
  return { values, paths, found: foundOf(values, paths), notes, questions, unused, corrections };
}

/** An AI suggestion for a part not understood ({ field, value }, checked on the server) as an answer for the visit. */
export function visitSuggestionMeaning({ field, value }) {
  if (!VISIT_VOICE_PATHS.includes(field) || field === 'details.privateNote') return null; // never the doctor's private note
  return isText(field) ? `note:${field.slice('details.'.length)}:${value}` : `set:${field}=${encodeURIComponent(value)}`;
}

/**
 * What an answer puts into the form: "set:<path>=<value>&…" (a question's choice) or "note:<field>:<text>" (a part not
 * understood, added to that note). Returns { values, paths, found }.
 */
export function visitAnswer(question, value) {
  const values = { vitals: {}, details: {} };
  const paths = [];
  const put = (path, v) => {
    const [part, key] = path.split('.');
    values[part][key] = v;
    if (!paths.includes(path)) paths.push(path);
  };
  if (value?.startsWith('set:')) {
    for (const pair of value.slice(4).split('&')) {
      const [path, v] = pair.split('=');
      put(path, decodeURIComponent(v ?? ''));
    }
  } else if (value?.startsWith('note:')) {
    const [, to, ...rest] = value.split(':');
    const t = rest.join(':').trim();
    if (t && isText(`details.${to}`)) put(`details.${to}`, t);
  }
  return { values, paths, found: foundOf(values, paths) };
}

// ---------- Filling the form again without undoing the person's own work (as registration, plan 1.7) ----------

const valueIn = (form, path) => {
  const [part, key] = path.split('.');
  return form?.[part]?.[key] ?? '';
};
const withValue = (form, path, value) => {
  const [part, key] = path.split('.');
  return { ...form, [part]: { ...form[part], [key]: value } };
};
const pieceKey = (path, piece) => `${path}|${piece.toLowerCase()}`;
const pieceOf = (key) => {
  const cut = key.indexOf('|');
  return { path: key.slice(0, cut), piece: key.slice(cut + 1) };
};
// Already written: the same words, as whole words ("Rest" is in "Rest on the left side", not in "interest")
const hasPiece = (text, piece) => new RegExp(`(?<![a-z0-9])${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(String(text ?? ''));
const withLine = (text, piece) => (String(text ?? '').trim() ? `${String(text).trimEnd()}\n${piece}` : piece);
// A line voice added, taken out again – only while it is still a line of its own, as voice wrote it (null otherwise)
const withoutLine = (text, piece) => {
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex((l) => l.trim().toLowerCase() === piece.toLowerCase());
  if (i < 0) return null;
  lines.splice(i, 1);
  return lines.join('\n').replace(/^\n+|\n+$/g, '');
};

/** What one visit form remembers between fills from voice – for that form only; nothing is saved. */
export function newVisitFillMemory() {
  return {
    handEdited: new Set(), // fields changed by hand: a number or choice said again is not used there
    answered: new Set(), // fields filled by answers to questions: a new reading never takes them out
    pieces: new Set(), // note lines added by voice ("details.complaints|mild backache"): never added twice
    // What the last reading filled, the values before it, and whether each line was already written when a reading
    // first gave it
    last: { fields: [], pieces: [], before: {}, present: {} },
  };
}

/** Fields changed by hand: voice never changes them again (until an answer to a question does). */
export function noteVisitHandEdit(memory, paths) {
  for (const p of paths) {
    memory.handEdited.add(p);
    memory.answered.delete(p);
  }
}

/**
 * One fill of the visit form from voice, as registration's planFill. `reading`: the whole text was read (again) –
 * numbers and choices changed by hand are left alone, a line taken out by hand is not added again, and what the last
 * reading filled but this one no longer gives (a correction undone, a word changed in the box) is taken out: a number
 * or choice goes back to what it was, and a line voice added goes while it is still as voice wrote it. Otherwise
 * `result` is an answer to a question: the person chose it, so it is used even over a change by hand. Notes are added
 * a line each to what is written; numbers and choices replace. `usable`: every path this person may fill (from
 * VISIT_VOICE_PATHS – not only this result's, so what a new reading no longer gives can be taken out); `form`:
 * { vitals, details } now; `fromVoice`: the fields marked "From voice". Updates `memory`. Returns { form, marks, here,
 * notChanged } – the form's next values and "From voice" fields, and what was said: filled in, or not changed because
 * the person changed it by hand (the form keeps theirs).
 */
export function planVisitFill(memory, result, { reading, usable, form, fromVoice }) {
  const allowed = new Set(usable);
  const paths = result.paths.filter((p) => allowed.has(p));
  const lines = (p) => linesOf(valueIn(result.values, p));
  const given = paths.filter(isText).flatMap((p) => lines(p).map((x) => pieceKey(p, x)));
  let next = form;
  const marks = new Set(fromVoice);
  const fields = []; // numbers and choices filled now
  const gone = new Set(); // lines voice added before that the person has taken out since

  if (reading) {
    const last = memory.last;
    const present = { ...last.present };
    for (const k of given) {
      if (!(k in present)) present[k] = hasPiece(valueIn(form, pieceOf(k).path), pieceOf(k).piece);
    }
    // What the last reading gave and this one no longer does
    for (const k of last.pieces) {
      const { path, piece } = pieceOf(k);
      if (given.includes(k) || !allowed.has(path)) continue;
      memory.pieces.delete(k); // no longer said: the line goes, or it is the person's
      if (present[k]) continue; // written before voice gave it
      const left = withoutLine(valueIn(next, path), piece);
      if (left !== null) next = withValue(next, path, left); // (null: changed by hand since)
    }
    const before = { ...last.before };
    const stillVoice = (f) => fromVoice.has(f) && !memory.handEdited.has(f) && !memory.answered.has(f);
    for (const f of last.fields) {
      if (paths.includes(f) || !allowed.has(f) || !stillVoice(f)) continue;
      next = withValue(next, f, before[f] ?? '');
      marks.delete(f);
    }
    for (const f of paths) if (!isText(f) && !memory.handEdited.has(f) && !(f in before)) before[f] = valueIn(form, f);
    memory.last = { fields: paths.filter((f) => !isText(f) && !memory.handEdited.has(f)), pieces: given, before, present };
  }

  for (const path of paths) {
    if (isText(path)) {
      let added = false;
      for (const piece of lines(path)) {
        const k = pieceKey(path, piece);
        const text = valueIn(next, path);
        if (reading && memory.pieces.has(k) && !hasPiece(text, piece)) {
          gone.add(k); // taken out by hand: not added again
          continue;
        }
        if (!hasPiece(text, piece)) {
          next = withValue(next, path, withLine(text, piece));
          added = true;
        }
        memory.pieces.add(k);
      }
      if (added || (!memory.handEdited.has(path) && lines(path).some((x) => !gone.has(pieceKey(path, x))))) marks.add(path);
    } else if (!(reading && memory.handEdited.has(path))) {
      next = withValue(next, path, valueIn(result.values, path));
      fields.push(path);
      marks.add(path);
    }
    if (!reading) {
      memory.answered.add(path);
      memory.handEdited.delete(path);
    }
  }

  // A note keeps its mark while a line voice added is still in it
  for (const path of VISIT_TEXT_PATHS) {
    if (!marks.has(path)) continue;
    const voiceLeft = [...memory.pieces].some((k) => pieceOf(k).path === path && hasPiece(valueIn(next, path), pieceOf(k).piece));
    if (!voiceLeft) marks.delete(path);
  }

  // What was said, as the form now has it
  const here = [];
  const notChanged = [];
  for (const item of result.found.filter((f) => f.paths.every((p) => allowed.has(p)))) {
    const [path] = item.paths;
    if (isText(path)) {
      const said = lines(path);
      const used = said.filter((x) => !gone.has(pieceKey(path, x)));
      const left = said.filter((x) => gone.has(pieceKey(path, x)));
      if (used.length) here.push({ ...item, text: used.join('; ') });
      if (left.length) notChanged.push({ ...item, text: left.join('; ') });
    } else if (item.paths.every((p) => fields.includes(p))) here.push(item);
    else if (item.paths.some((p) => String(valueIn(form, p)) !== String(valueIn(result.values, p)))) notChanged.push(item);
  }
  return { form: next, marks, here, notChanged };
}

// ---------- The words Chrome is told to expect ----------

// The visit's words, before registration's whole list (patients/obgyTerms.js, at most 212): the details' names,
// findings and headings – about 245 in all, within the 100–300 usually advised (Chrome sets no limit). The cap only
// guards against a much longer list; registration's least used words (at its end) would make room.
const MAX_HEARING = 260;
const VISIT_HEARING = {
  pregnancy: ['fundal height', 'FHR', 'FHS', 'fetal heart rate', 'fetal movements', 'cephalic', 'vertex', 'breech', 'transverse lie', 'presentation'],
  mother: ['pedal oedema', 'oedema', 'urine albumin', 'urine sugar', 'pallor', 'per abdomen', 'per speculum'],
  newborn: ['jaundice', 'feeding', 'umbilical cord'],
  all: ['blood pressure', 'pulse', 'temperature', 'SpO2', 'saturation', 'haemoglobin', 'complaints', 'on examination', 'diagnosis', 'advised', 'next visit', 'follow up', 'review', 'fortnight', 'private note'],
};
/** The phrases for Chrome's speech recognition in a visit ([{ text, boost }]): the visit's words, then registration's. */
export function visitHearing(careType, words = []) {
  const mine = [
    ...(careType === 'antenatal' ? VISIT_HEARING.pregnancy : []),
    ...(careType === 'newborn' ? VISIT_HEARING.newborn : VISIT_HEARING.mother),
    ...VISIT_HEARING.all,
  ].map((text) => ({ text, boost: 2 }));
  const seen = new Set(mine.map((p) => p.text.toLowerCase()));
  const rest = hearingPhrases(careType, words).filter((p) => !seen.has(p.text.toLowerCase()));
  return [...mine, ...rest].slice(0, MAX_HEARING);
}
