// Words for visits, prescriptions and the 10 printed prescription designs (Feature 8), in English, Marathi and
// Hindi. The codes match the server's (server/src/visits/rxCodes.js); a server test checks them.
// ⚠️ The Marathi and Hindi phrases were written by the software developer: a fluent speaker should check them
// (they are listed in docs/PRESCRIPTIONS.md).

// ---------- Codes (same as the server) ----------

export const RX_FORMS = ['tab', 'cap', 'syrup', 'suspension', 'drops', 'inj', 'sachet', 'powder', 'pessary', 'suppository', 'cream', 'ointment', 'gel', 'lotion', 'spray', 'inhaler', 'other'];
export const RX_FREQUENCIES = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', 'sos', 'stat', 'weekly', 'alternate', 'custom'];
export const RX_TIMINGS = ['', 'after_food', 'before_food', 'with_food', 'empty_stomach', 'bedtime'];
export const RX_ROUTES = ['', 'oral', 'vaginal', 'rectal', 'im', 'iv', 'sc', 'sublingual', 'local'];
export const RX_DURATION_UNITS = ['', 'days', 'weeks', 'months', 'till_delivery', 'continue'];
export const URINE_GRADES = ['', 'nil', 'trace', '1+', '2+', '3+', '4+'];
export const PRESENTATIONS = ['', 'cephalic', 'breech', 'transverse', 'oblique', 'variable'];
export const FETAL_MOVEMENTS = ['', 'present', 'reduced', 'absent'];
export const OEDEMA_GRADES = ['', 'none', 'mild', 'moderate', 'severe'];
export const RX_DESIGNS = ['classic', 'letterhead', 'two_column', 'table', 'dose_chart', 'side_band', 'pregnancy', 'preprinted', 'half_page', 'minimal'];
export const RX_ACCENTS = ['indigo', 'teal', 'maroon', 'green', 'charcoal'];
export const RX_FONTS = ['standard', 'sans', 'serif'];
export const RX_LINE_SPACINGS = ['compact', 'standard', 'relaxed'];
export const RX_TITLES = ['medicines', 'instructions', 'tests', 'advice', 'nextVisit'];
export const RX_SHOW = ['vitals', 'complaints', 'examination', 'diagnosis', 'investigations', 'advice', 'nextVisit', 'planItems', 'pregnancy', 'signature', 'rxSymbol'];

// ---------- Words on screen ----------

/** In the form's list (what the doctor picks). */
export const FORM_NAMES = {
  tab: 'Tablet',
  cap: 'Capsule',
  syrup: 'Syrup',
  suspension: 'Suspension',
  drops: 'Drops',
  inj: 'Injection',
  sachet: 'Sachet',
  powder: 'Powder',
  pessary: 'Pessary (vaginal)',
  suppository: 'Suppository',
  cream: 'Cream',
  ointment: 'Ointment',
  gel: 'Gel',
  lotion: 'Lotion',
  spray: 'Spray',
  inhaler: 'Inhaler',
  other: 'Other',
};
/** Printed before the medicine's name, as on Indian prescriptions ("Tab. Folic acid"). */
export const FORM_PREFIX = {
  tab: 'Tab.',
  cap: 'Cap.',
  syrup: 'Syp.',
  suspension: 'Susp.',
  drops: 'Drops',
  inj: 'Inj.',
  sachet: 'Sachet',
  powder: 'Powder',
  pessary: 'Pessary',
  suppository: 'Supp.',
  cream: 'Cream',
  ointment: 'Oint.',
  gel: 'Gel',
  lotion: 'Lotion',
  spray: 'Spray',
  inhaler: 'Inhaler',
  other: '',
};
export const FREQUENCY_LABELS = {
  '1-0-0': '1-0-0 · once a day, morning',
  '0-1-0': '0-1-0 · once a day, afternoon',
  '0-0-1': '0-0-1 · once a day, night',
  '1-0-1': '1-0-1 · twice a day',
  '1-1-1': '1-1-1 · three times a day',
  '1-1-1-1': '1-1-1-1 · four times a day',
  sos: 'SOS · only when needed',
  stat: 'STAT · once, now',
  weekly: 'Once a week',
  alternate: 'Every other day',
  custom: 'Other – write it',
};
export const TIMING_LABELS = { '': '—', after_food: 'After food', before_food: 'Before food', with_food: 'With food', empty_stomach: 'Empty stomach', bedtime: 'At bedtime' };
export const ROUTE_LABELS = { '': '—', oral: 'By mouth', vaginal: 'Vaginal', rectal: 'Rectal', im: 'IM', iv: 'IV', sc: 'SC', sublingual: 'Under the tongue', local: 'Apply locally' };
export const DURATION_LABELS = { '': '—', days: 'days', weeks: 'weeks', months: 'months', till_delivery: 'till delivery', continue: 'continue' };
export const COUNTED_UNITS = ['days', 'weeks', 'months'];

export const URINE_LABELS = { '': '—', nil: 'Nil', trace: 'Trace', '1+': '1+', '2+': '2+', '3+': '3+', '4+': '4+' };
export const PRESENTATION_LABELS = { '': '—', cephalic: 'Cephalic', breech: 'Breech', transverse: 'Transverse', oblique: 'Oblique', variable: 'Variable (not settled yet)' };
export const MOVEMENT_LABELS = { '': '—', present: 'Present', reduced: 'Reduced', absent: 'Absent' };
export const OEDEMA_LABELS = { '': '—', none: 'None', mild: 'Mild (+)', moderate: 'Moderate (++)', severe: 'Severe (+++)' };

// ---------- Words on paper, in each language ----------

const W = (en, mr, hi) => ({ en, mr, hi });

/** The unit after a bare number dose ("1" → "1 tab", "1 गोळी", "1 गोली"). */
export const DOSE_UNIT_WORDS = {
  tab: W('tab', 'गोळी', 'गोली'),
  cap: W('cap', 'कॅप्सूल', 'कैप्सूल'),
  syrup: W('ml', 'मिली', 'मिली'),
  suspension: W('ml', 'मिली', 'मिली'),
  drops: W('drops', 'थेंब', 'बूंद'),
  sachet: W('sachet', 'पाकीट', 'पाउच'),
  pessary: W('pessary', 'गोळी', 'गोली'),
  suppository: W('supp.', 'गोळी', 'गोली'),
  spray: W('spray', 'स्प्रे', 'स्प्रे'),
  inhaler: W('puff', 'पफ', 'पफ'),
};

export const FREQUENCY_WORDS = {
  '1-0-0': W('morning', 'सकाळी', 'सुबह'),
  '0-1-0': W('afternoon', 'दुपारी', 'दोपहर'),
  '0-0-1': W('night', 'रात्री', 'रात'),
  '1-0-1': W('morning and night', 'सकाळी व रात्री', 'सुबह और रात'),
  '1-1-1': W('morning, afternoon and night', 'सकाळी, दुपारी व रात्री', 'सुबह, दोपहर और रात'),
  '1-1-1-1': W('four times a day', 'दिवसातून चार वेळा', 'दिन में चार बार'),
  sos: W('only when needed', 'गरज असेल तेव्हाच', 'ज़रूरत होने पर ही'),
  stat: W('once, now', 'एकदाच, लगेच', 'एक बार, तुरंत'),
  weekly: W('once a week', 'आठवड्यातून एकदा', 'सप्ताह में एक बार'),
  alternate: W('every other day', 'एक दिवसाआड', 'एक दिन छोड़कर'),
};
export const TIMING_WORDS = {
  after_food: W('after food', 'जेवणानंतर', 'खाना खाने के बाद'),
  before_food: W('before food', 'जेवणापूर्वी', 'खाना खाने से पहले'),
  with_food: W('with food', 'जेवणासोबत', 'खाने के साथ'),
  empty_stomach: W('on an empty stomach', 'उपाशीपोटी', 'खाली पेट'),
  bedtime: W('at bedtime', 'झोपताना', 'सोते समय'),
};
export const ROUTE_WORDS = {
  oral: W('by mouth', 'तोंडाने', 'मुँह से'),
  vaginal: W('in the vagina', 'योनीमार्गात', 'योनि में'),
  rectal: W('in the rectum', 'गुदद्वारात', 'गुदा में'),
  im: W('injection in the muscle (IM)', 'स्नायूत इंजेक्शन (IM)', 'मांसपेशी में इंजेक्शन (IM)'),
  iv: W('into a vein (IV)', 'शिरेतून (IV)', 'नस में (IV)'),
  sc: W('injection under the skin (SC)', 'त्वचेखाली इंजेक्शन (SC)', 'त्वचा के नीचे इंजेक्शन (SC)'),
  sublingual: W('under the tongue', 'जिभेखाली', 'जीभ के नीचे'),
  local: W('apply on the skin', 'त्वचेवर लावा', 'त्वचा पर लगाएँ'),
};

/** The dose chart's four times of day, in the 1-1-1-1 order (morning, afternoon, evening, night). */
export const SLOTS = ['morning', 'afternoon', 'evening', 'night'];
export const SLOT_WORDS = {
  morning: W('Morning', 'सकाळी', 'सुबह'),
  afternoon: W('Afternoon', 'दुपारी', 'दोपहर'),
  evening: W('Evening', 'संध्याकाळी', 'शाम'),
  night: W('Night', 'रात्री', 'रात'),
};
// 1-0-1 means morning and night; 1-1-1 morning, afternoon and night; 1-1-1-1 adds the evening.
const SLOT_PATTERN = { '1-0-0': [1, 0, 0, 0], '0-1-0': [0, 1, 0, 0], '0-0-1': [0, 0, 0, 1], '1-0-1': [1, 0, 0, 1], '1-1-1': [1, 1, 0, 1], '1-1-1-1': [1, 1, 1, 1] };
export const isPattern = (frequency) => Boolean(SLOT_PATTERN[frequency]);

/** Section headings that the patient reads, in each language. */
export const RX_LABELS = {
  medicines: W('Medicines', 'औषधे', 'दवाइयाँ'),
  medicine: W('Medicine', 'औषध', 'दवा'),
  dose: W('Dose', 'मात्रा', 'खुराक'),
  howOften: W('How often', 'किती वेळा', 'कितनी बार'),
  food: W('Food', 'जेवण', 'खाना'),
  howLong: W('How long', 'किती दिवस', 'कितने दिन'),
  instructions: W('Instructions', 'सूचना', 'निर्देश'),
  advice: W('Advice', 'सल्ला', 'सलाह'),
  tests: W('Tests advised', 'करायच्या तपासण्या', 'कराने वाली जाँचें'),
  nextVisit: W('Next visit', 'पुढील तपासणी', 'अगली जाँच'),
  dueByNext: W('Due by your next visit', 'पुढील तपासणीपर्यंत करायचे', 'अगली जाँच तक करना है'),
  summary: W('Visit summary', 'तपासणीचा सारांश', 'जाँच का सारांश'),
};

// ---------- One medicine on paper ----------

const numberOnly = /^[\d½¼¾⅓⅔.\s/]+$/;

/** "TAB. FOLIC ACID 5 mg" (names in CAPITALS when the design asks; the strength as written). */
export function medicineName(item, { capitals = true } = {}) {
  const prefix = FORM_PREFIX[item.form] ?? '';
  const name = capitals ? item.drug.toUpperCase() : item.drug;
  return [capitals ? prefix.toUpperCase() : prefix, name, item.strength].filter(Boolean).join(' ');
}

/** "1 tab", "½ tab", "10 ml" ("1 गोळी" in Marathi), or the dose as written ("2 puffs"). */
export function doseText(item, lang = 'en') {
  const d = (item.dose ?? '').trim();
  if (!d) return '';
  const unit = DOSE_UNIT_WORDS[item.form]?.[lang];
  return unit && numberOnly.test(d) ? `${d} ${unit}` : d;
}

/** How often in a language: "1-0-1 (morning and night)"; custom words as written. */
export function frequencyText(item, lang = 'en') {
  if (item.frequency === 'custom') return item.frequencyText ?? '';
  const words = FREQUENCY_WORDS[item.frequency]?.[lang] ?? '';
  return isPattern(item.frequency) ? `${item.frequency} (${words})` : words;
}

// Counted units, singular and plural. Hindi uses the plural form before तक ("1 महीने तक"), the singular alone
// ("1 महीना").
const COUNT_WORDS = {
  days: { en: ['day', 'days'], mr: ['दिवस', 'दिवस'], hi: ['दिन', 'दिन'] },
  weeks: { en: ['week', 'weeks'], mr: ['आठवडा', 'आठवडे'], hi: ['सप्ताह', 'सप्ताह'] },
  months: { en: ['month', 'months'], mr: ['महिना', 'महिने'], hi: ['महीना', 'महीने'] },
};

/** How long in a language: "for 30 days", "30 दिवस", "30 दिन तक", "till delivery" … ('' when not given). */
export function durationText(item, lang = 'en') {
  const n = item.durationValue;
  switch (item.durationUnit) {
    case 'days':
    case 'weeks':
    case 'months': {
      const [one, many] = COUNT_WORDS[item.durationUnit][lang];
      return { en: `for ${n} ${n === 1 ? one : many}`, mr: `${n} ${n === 1 ? one : many}`, hi: `${n} ${many} तक` }[lang];
    }
    case 'till_delivery':
      return W('till delivery', 'प्रसूतीपर्यंत', 'प्रसव तक')[lang];
    case 'continue':
      return W('continue until told to stop', 'पुढील सूचनेपर्यंत चालू ठेवा', 'अगली सलाह तक जारी रखें')[lang];
    default:
      return '';
  }
}

/** How long, for a table column: "30 days", "30 दिवस", "1 महीना"; the other units as in durationText. */
export function durationShort(item, lang = 'en') {
  const n = item.durationValue;
  if (!COUNTED_UNITS.includes(item.durationUnit)) return durationText(item, lang);
  const [one, many] = COUNT_WORDS[item.durationUnit][lang];
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The instruction line in a language: "1 tab · 1-0-1 (morning and night) · after food · for 30 days · by mouth".
 * In Marathi or Hindi the dose stays in figures and the medicine's own instructions stay as the doctor wrote them.
 */
export function instructionLine(item, lang = 'en') {
  const route = item.route && !['oral'].includes(item.route) ? ROUTE_WORDS[item.route]?.[lang] : '';
  return [doseText(item, lang), frequencyText(item, lang), TIMING_WORDS[item.timing]?.[lang], durationText(item, lang), route]
    .filter(Boolean)
    .join(' · ');
}

/** The dose in each of the chart's four times of day ('' when not taken then), or null for SOS, weekly, custom … */
export function doseSlots(item) {
  const pattern = SLOT_PATTERN[item.frequency];
  if (!pattern) return null;
  const dose = (item.dose ?? '').trim() || '1';
  return pattern.map((on) => (on ? dose : ''));
}

// ---------- The visit on paper ----------

const has = (v) => v !== null && v !== undefined && v !== '';

/** "BP 110/70 mmHg · Pulse 82/min · Weight 58 kg · Temp 98.6 °F · SpO2 98% · Hb 11.2 g/dL · Urine albumin nil" */
export function vitalsText(v = {}) {
  return [
    has(v.bpSystolic) && has(v.bpDiastolic) && `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg`,
    has(v.pulse) && `Pulse ${v.pulse}/min`,
    has(v.weightKg) && `Weight ${v.weightKg} kg`,
    has(v.temperatureF) && `Temp ${v.temperatureF} °F`,
    has(v.spo2) && `SpO2 ${v.spo2}%`,
    has(v.hb) && `Hb ${v.hb} g/dL`,
    has(v.urineAlbumin) && `Urine albumin ${URINE_LABELS[v.urineAlbumin].toLowerCase()}`,
    has(v.urineSugar) && `Urine sugar ${URINE_LABELS[v.urineSugar].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Fundal height 24 cm · FHR 140/min · Cephalic · Movements present · Oedema none" */
export function pregnancyCheckText(d = {}) {
  return [
    has(d.fundalHeightCm) && `Fundal height ${d.fundalHeightCm} cm`,
    has(d.fetalHeartRate) && `FHR ${d.fetalHeartRate}/min`,
    has(d.presentation) && PRESENTATION_LABELS[d.presentation],
    has(d.fetalMovements) && `Fetal movements ${MOVEMENT_LABELS[d.fetalMovements].toLowerCase()}`,
    has(d.oedema) && `Oedema ${OEDEMA_LABELS[d.oedema].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------- The 10 designs (the design page shows them in this order) ----------

export const DESIGNS = {
  classic: { name: 'Classic Rx pad', about: "The doctor's name and degrees on the left, the clinic on the right, a large ℞ and a numbered list – the pad most Indian doctors use." },
  letterhead: { name: 'Hospital letterhead', about: "The hospital's name centred at the top, the doctor under it and the patient's details in a box – formal, for hospitals." },
  two_column: { name: 'Two columns', about: 'Complaints, findings, tests and diagnosis in a narrow left column; the medicines on the right.' },
  table: { name: 'Medicine table', about: 'Every medicine in a table – dose, how often, when and how long. Clear for patients and chemists.' },
  dose_chart: { name: 'Dose chart with symbols', about: "Morning, afternoon, evening and night columns with sun and moon symbols – for patients who don't read well." },
  side_band: { name: 'Side band', about: "A coloured band down the left side with the doctor's details, specialities and clinic timings." },
  pregnancy: { name: 'Pregnancy card', about: 'A pregnancy box (LMP, EDD, weeks, G P L A, blood group, risk), the pregnancy check, and what is due by the next visit.' },
  preprinted: { name: 'Your own printed pad', about: "Prints only the patient's details and the prescription, leaving space for the header and footer already printed on your pad." },
  half_page: { name: 'Half page (A5)', about: 'Everything on half a sheet – saves paper for short prescriptions.' },
  minimal: { name: 'Modern minimal', about: "Clean lines and plenty of space, with each medicine's dose in clear chips." },
};

export const ACCENT_NAMES = { indigo: 'Indigo', teal: 'Teal', maroon: 'Maroon', green: 'Green', charcoal: 'Charcoal' };
export const LANGUAGE_CHOICES = { en: 'English only', mr: 'English + मराठी (Marathi)', hi: 'English + हिंदी (Hindi)' };
export const SHOW_LABELS = {
  vitals: 'Vital signs',
  complaints: 'Complaints',
  examination: 'Examination findings and the pregnancy check',
  diagnosis: 'Diagnosis',
  investigations: 'Tests advised',
  advice: 'Advice',
  nextVisit: 'Next visit',
  planItems: 'Care-plan items due by the next visit',
  pregnancy: 'Pregnancy summary (LMP, EDD, weeks, G P L A)',
  signature: 'Signature block',
  rxSymbol: 'The ℞ symbol',
};
