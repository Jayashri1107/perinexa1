// The history-taking sheet (docs/HISTORY_SHEET_LAYOUT.md, layout agreed by the owner on 27 Oct 2026): the lists with
// their words (the same keys as server/src/patients/historyFields.js – a server test compares them), the form's values,
// what is sent, the lines shown on the record, and the reading of a dictated sentence into the five blanks.

export const HISTORY_LABELS = {
  CYCLE_KINDS: { regular: 'Regular', irregular: 'Irregular' },
  YES_NO: { yes: 'Yes', no: 'No' },
  FLOW: { scanty: 'Scanty', normal: 'Normal', heavy: 'Heavy' },
  PERIOD_PAIN: { none: 'None', mild: 'Mild', severe: 'Severe' },
  PREGNANCY_OUTCOMES: { live_birth: 'Live birth', stillbirth: 'Stillbirth', miscarriage: 'Miscarriage', ectopic: 'Ectopic', molar: 'Molar' },
  BIRTH_MODES: { normal: 'Normal', assisted: 'Assisted (forceps or vacuum)', caesarean: 'Caesarean' },
  IMMUNISATION_STATUS: { done: 'Done', not_done: 'Not done', not_known: 'Not known' },
  FAMILY_HISTORY: {
    diabetes: 'Diabetes',
    hypertension: 'High blood pressure',
    thyroid: 'Thyroid disease',
    tuberculosis: 'Tuberculosis',
    twins: 'Twins',
    congenital_anomalies: 'Congenital anomalies',
    breast_ovarian_cancer: 'Breast or ovarian cancer',
    bleeding_disorders: 'Bleeding disorders',
  },
  DIETS: { vegetarian: 'Vegetarian', mixed: 'Mixed (non-vegetarian)' },
  HABIT: { never: 'Never', past: 'In the past', current: 'Now' },
};

// Words about a child's sex are allowed only where a child already born is described (the owner's decision 4 of
// 27 Oct 2026; server/src/patients/historyFields.js BORN_CHILD_TEXTS): every other text of the sheet is checked.
export const SEX_CHECKED_TEXTS = ['complaint', 'otherHistory', 'periodsOther', 'contraception', 'operations', 'currentMedicines', 'familyWho', 'occupation', 'sleepAppetite', 'bowelBladder'];
const TEXTS = ['complaint', 'previousDeliveries', 'otherHistory', 'periodsOther', 'contraception', 'operations', 'currentMedicines', 'familyWho', 'occupation', 'sleepAppetite', 'bowelBladder'];
const NUMBERS = ['marriedSinceYears', 'menarcheAge', 'cycleLengthDays', 'bleedingDays'];
const CHOICES = ['cycle', 'consanguinity', 'flow', 'pain', 'lmpCertain', 'transfusion', 'td', 'rubella', 'hepB', 'diet', 'tobacco', 'alcohol'];
export const EMPTY_PREGNANCY = { year: '', outcome: '', weeks: '', mode: '', place: '', weightGrams: '', aliveNow: '', problems: '' };

const str = (v) => (v == null ? '' : String(v));
const day = (v) => (v ? String(v).slice(0, 10) : '');

/** The form's values from the stored sheet (text, as the inputs show it). */
export function historyValues(h) {
  return {
    ...Object.fromEntries(TEXTS.map((k) => [k, h?.[k] ?? ''])),
    ...Object.fromEntries(NUMBERS.map((k) => [k, str(h?.[k])])),
    ...Object.fromEntries(CHOICES.map((k) => [k, h?.[k] ?? ''])),
    previousPeriod: day(h?.previousPeriod),
    family: [...(h?.family ?? [])],
    pregnancies: (h?.pregnancies ?? []).map((r) => ({ ...EMPTY_PREGNANCY, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)])) })),
  };
}

const blankRow = (r) => Object.values(r).every((v) => !String(v).trim());

/** What is sent to the server: trimmed text, numbers or null, empty rows of the table left out. */
export function historyPayload(values) {
  const v = { ...historyValues(null), ...(values ?? {}) }; // a form without the sheet sends an empty one
  const n = (x) => (String(x).trim() === '' ? null : Number(x));
  return {
    ...Object.fromEntries(TEXTS.map((k) => [k, v[k].trim()])),
    ...Object.fromEntries(NUMBERS.map((k) => [k, n(v[k])])),
    ...Object.fromEntries(CHOICES.map((k) => [k, v[k]])),
    previousPeriod: v.previousPeriod || null,
    family: v.family,
    pregnancies: v.pregnancies
      .filter((r) => !blankRow(r))
      .map((r) => ({ year: n(r.year), outcome: r.outcome, weeks: n(r.weeks), mode: r.mode, place: r.place.trim(), weightGrams: n(r.weightGrams), aliveNow: r.aliveNow, problems: r.problems.trim() })),
  };
}

/** True when nothing has been written on the sheet. */
export function historyEmpty(h) {
  if (!h) return true;
  if (CHOICES.some((k) => h[k]) || NUMBERS.some((k) => h[k] != null && h[k] !== '') || h.previousPeriod) return false;
  if ((h.family ?? []).length || (h.pregnancies ?? []).length) return false;
  return !TEXTS.some((k) => (h[k] ?? '').trim());
}

/** The five lines as the record shows them (Overview, copy of the record): [label, text] for those written. */
export function historyLines(h) {
  if (!h) return [];
  const L = HISTORY_LABELS;
  const married = [h.marriedSinceYears != null && h.marriedSinceYears !== '' ? `${h.marriedSinceYears} years` : '', h.consanguinity ? `Consanguinity ${L.YES_NO[h.consanguinity].toLowerCase()}` : ''].filter(Boolean).join(' · ');
  const lines = [
    ['Complaints', h.complaint],
    ['Menstrual history', h.cycle ? `Cycle ${L.CYCLE_KINDS[h.cycle].toLowerCase()}` : ''],
    ['Married since', married],
    ['Previous deliveries', h.previousDeliveries],
    ['Other history', h.otherHistory],
    ['Family history', [(h.family ?? []).map((k) => L.FAMILY_HISTORY[k]).join(', '), h.familyWho].filter(Boolean).join(' – ')],
    ['Operations', h.operations],
    ['Current medicines', h.currentMedicines],
  ];
  return lines.filter(([, t]) => t && String(t).trim());
}

/**
 * The sheet as the printed page reads it (the owner's printed page, 27 Oct 2026): the paper template's lines with the
 * blanks filled – only the lines written. `age`: as printed in the patient line ("28 yrs"); `lmp`: a day, when known.
 */
export function historyPrintLines(h, { age = '', lmp = '' } = {}) {
  if (!h || historyEmpty(h)) return [];
  const L = HISTORY_LABELS;
  const years = String(age ?? '').replace(/\s*yrs?$/, '');
  const out = [];
  if (h.complaint?.trim()) out.push(`Patient is ${years ? `${years} years` : '…'} with complaints of ${h.complaint.trim()}`);
  const menstrual = [lmp ? `LMP ${lmp}` : '', h.cycle ? `Cycle ${L.CYCLE_KINDS[h.cycle].toLowerCase()}` : ''].filter(Boolean).join(' · ');
  if (menstrual) out.push(`Menstrual history – ${menstrual}`);
  const married = [h.marriedSinceYears != null && h.marriedSinceYears !== '' ? `Married since ${h.marriedSinceYears} years` : '', h.consanguinity ? `Consanguinity ${L.YES_NO[h.consanguinity].toLowerCase()}` : ''].filter(Boolean).join(' · ');
  if (married) out.push(`Obstetric history – ${married}`);
  if (h.previousDeliveries?.trim()) out.push(`Previous deliveries – ${h.previousDeliveries.trim()}`);
  if (h.otherHistory?.trim()) out.push(`Any other personal, medical, operative or family history – ${h.otherHistory.trim()}`);
  return out;
}

// This pregnancy's details, recorded at the visit (the owner, 27 Oct 2026 – server/src/patients/historyFields.js PLANNED,
// CONCEPTION, FOLIC_ACID): kept with the pregnancy on her record, not on the history sheet.
export const PLANNED_LABELS = { yes: 'Planned', no: 'Not planned' };
export const CONCEPTION_LABELS = { natural: 'Natural', ovulation_induction: 'Ovulation induction', iui: 'IUI', ivf: 'IVF or ICSI' };
export const FOLIC_ACID_LABELS = { before: 'Started before pregnancy', after: 'Started in pregnancy', not_taken: 'Not taken' };

/** This pregnancy's details as [label, text], for those recorded (the dates are shown with the EDD). */
export function pregnancyDetailLines(p) {
  if (!p) return [];
  return [
    ['Planned', PLANNED_LABELS[p.planned] ?? ''],
    ['Conception', CONCEPTION_LABELS[p.conception] ?? ''],
    ['Folic acid', FOLIC_ACID_LABELS[p.folicAcid] ?? ''],
    ['Medicines taken so far', p.medicinesTaken?.trim() ?? ''],
    ['Symptoms so far', p.symptoms?.trim() ?? ''],
  ].filter(([, v]) => v);
}

// ---------- Reading a dictated sentence (rules, not AI: nothing leaves the computer) ----------
// The paper template's own words are the anchors: what follows "with complaints of" is the complaint, "cycle regular"
// sets the cycle, "married since" the years, "consanguinity" yes or no, what follows "previous deliveries" goes into
// that blank until the next anchor, and what follows "any other" (or "other history") the last line.

const ANCHORS = [
  ['complaint', /\bwith (?:the )?complaints? of\b|\bcomplain(?:s|ing)? of\b|\bcomplaints?\b/i],
  ['menstrual', /\bmenstrual history\b|\bL\.?\s?M\.?\s?P\b/i],
  ['married', /\bmarried (?:since|for)\b|\bobstetric history\b/i],
  ['deliveries', /\bprevious deliver(?:y|ies)\b/i],
  ['other', /\bany other\b|\bother (?:personal|medical|history)\b/i],
];
// The one more line of a type of care (decision 7): infertility and postnatal care only, so the words end a blank there
const CARE_ANCHORS = {
  infertility: [['conceive', /\btrying (?:to|for) (?:conceive|conception|pregnancy)(?: since| for)?\b/i]],
  postnatal: [['delivered', /\bdelivered on\b/i]],
};
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const NUMBER = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)';
const number = (x) => WORD_NUMBERS[x.toLowerCase()] ?? Number(x);
// "by normal delivery", "by caesarean" – the keys of the delivery section (inpatientFormat.js DELIVERY_MODE_LABELS)
const DELIVERY_MODES = [
  ['lscs', /\b(?:lscs|caesarean|cesarean|c[\s-]?section|section)\b/i],
  ['vacuum', /\b(?:vacuum|ventouse)\b/i],
  ['forceps', /\bforceps\b/i],
  ['normal', /\b(?:normal|vaginal|nvd|ftnd)\b/i],
];

const clean = (t) =>
  t
    .replace(/^[\s,.:;-]+|[\s,.;-]+$/g, '')
    .replace(/^(?:is|are|of|since|history|-)\s+/i, '')
    .trim();

// The parts of a sentence, each from its anchor to the next one
function parts(text, careType) {
  const said = ` ${text ?? ''} `.replace(/\s+/g, ' ');
  const found = [...ANCHORS, ...(CARE_ANCHORS[careType] ?? [])]
    .map(([key, rx]) => {
      const m = rx.exec(said);
      return m ? { key, start: m.index, end: m.index + m[0].length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return found.map((f, i) => ({ key: f.key, text: said.slice(f.end, i + 1 < found.length ? found[i + 1].start : said.length) }));
}

/**
 * The blanks a sentence fills: { complaint, cycle, marriedSinceYears, consanguinity, previousDeliveries, otherHistory }
 * – only those it is sure of (anything else is left as it is in the form). `careType`: its own line's words end a blank.
 */
export function readSentence(text, { careType } = {}) {
  const out = {};
  for (const f of parts(text, careType)) {
    const t = f.text;
    if (f.key === 'complaint') {
      const c = clean(t.replace(/\b(?:menstrual|obstetric) history\b.*$/i, ''));
      if (c) out.complaint = c;
    }
    if (f.key === 'menstrual' || f.key === 'complaint') {
      const cyc = /\bcycles?\s+(?:is\s+|are\s+)?(regular|irregular)\b|\b(regular|irregular)\s+cycles?\b/i.exec(t);
      if (cyc) out.cycle = (cyc[1] ?? cyc[2]).toLowerCase();
    }
    if (f.key === 'married') {
      const yrs = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s*(?:years?|yrs?)\b/i.exec(t);
      if (yrs) out.marriedSinceYears = String(WORD_NUMBERS[yrs[1].toLowerCase()] ?? Number(yrs[1]));
      if (/\bnon[\s-]?consanguin/i.test(t) || /\bconsanguinity\s*(?:is\s*)?(?:no|nil|absent|none|negative)\b/i.test(t)) out.consanguinity = 'no';
      else if (/\bconsanguinity\s*(?:is\s*)?(?:yes|present|positive)\b|\bconsanguineous marriage\b/i.test(t)) out.consanguinity = 'yes';
    }
    if (f.key === 'deliveries') {
      const d = clean(t);
      if (d) out.previousDeliveries = d;
    }
    if (f.key === 'other') {
      const o = clean(t.replace(/^\s*(?:personal|medical|operative|or|family|,|\s)*history\b/i, ''));
      if (o) out.otherHistory = o;
    }
  }
  return out;
}

/**
 * The type of care's own line: { durationMonths } for "trying to conceive since 2 years" (infertility), { on, mode } for
 * "delivered on 20 October 2026 by caesarean" (postnatal). `readDate(text, now, when)` reads the date (dictation.js).
 */
export function readCareLine(text, careType, readDate, now = new Date()) {
  const out = {};
  for (const { key, text: t } of parts(text, careType)) {
    if (key === 'conceive') {
      const m = new RegExp(`\\b${NUMBER}\\s*(years?|yrs?|months?)\\b`, 'i').exec(t);
      const months = m ? number(m[1]) * (/^y/i.test(m[2]) ? 12 : 1) : NaN;
      if (months > 0 && months <= 360) out.durationMonths = String(months);
    }
    if (key === 'delivered') {
      const date = readDate(t, now, 'past');
      if (date) out.on = date.iso;
      const by = /\bby\b(.*)$/i.exec(date ? t.slice(date.end) : t);
      const mode = by && DELIVERY_MODES.find(([, rx]) => rx.test(by[1]));
      if (mode) out.mode = mode[0];
    }
  }
  return out;
}

const SHEET_LABELS = {
  complaint: 'Complaints',
  cycle: 'Cycle',
  marriedSinceYears: 'Married since (years)',
  consanguinity: 'Consanguinity',
  previousDeliveries: 'Previous deliveries',
  otherHistory: 'Any other history',
};
const plainWords = (x) =>
  String(x ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * One Dictate for the whole page (decision 6): the voice entry's reading of what was said (`result`, as
 * extractPatientDetails returns it) with the history sheet's blanks added – the five lines, and the type of care's own
 * line when it is on the page (`careLine`). What the sheet took is no longer listed as not understood.
 */
export function withHistorySheet(result, text, { careType, careLine = false, readDate, now = new Date() }) {
  const sheet = readSentence(text, { careType });
  const line = careLine ? readCareLine(text, careType, readDate, now) : {};
  const values = { ...result.values };
  const paths = [...result.paths];
  const found = [...result.found];
  const add = (section, key, value, label, shown = value) => {
    values[section] = { ...values[section], [key]: value };
    paths.push(`${section}.${key}`);
    found.push({ label, text: shown, part: 'clinical', path: `${section}.${key}` });
  };
  const L = HISTORY_LABELS;
  for (const [k, value] of Object.entries(sheet)) add('history', k, value, SHEET_LABELS[k], k === 'cycle' ? L.CYCLE_KINDS[value] : k === 'consanguinity' ? L.YES_NO[value] : value);
  if (line.durationMonths) add('fertility', 'durationMonths', line.durationMonths, 'Trying to conceive since', `${line.durationMonths} months`);
  if (line.on) add('delivery', 'on', line.on, 'Delivered on');
  if (line.mode) add('delivery', 'mode', line.mode, 'Mode of delivery');
  const taken = [...Object.values(sheet), ...Object.values(line)].map(plainWords).filter((t) => t.length > 2);
  const covered = (u) => {
    const t = plainWords(u.text);
    return !t || taken.some((s) => s.includes(t) || t.includes(s));
  };
  return { ...result, values, paths: [...new Set(paths)], found, unused: (result.unused ?? []).filter((u) => !covered(u)) };
}
