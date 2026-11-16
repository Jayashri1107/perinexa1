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
const NUMBERS = ['marriedSinceYears', 'marriedSinceMonths', 'menarcheAge', 'cycleLengthDays', 'bleedingDays'];
const CHOICES = ['cycle', 'consanguinity', 'flow', 'pain', 'lmpCertain', 'transfusion', 'td', 'rubella', 'hepB', 'diet', 'tobacco', 'alcohol'];
export const EMPTY_PREGNANCY = { year: '', outcome: '', weeks: '', mode: '', place: '', weightGrams: '', aliveNow: '', problems: '' };

const str = (v) => (v == null ? '' : String(v));
// A stored day as the record shows it ("2 Oct 2026")
const showDay = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const day = (v) => (v ? String(v).slice(0, 10) : '');

/** The form's values from the stored sheet (text, as the inputs show it). */
export function historyValues(h) {
  return {
    ...Object.fromEntries(TEXTS.map((k) => [k, h?.[k] ?? ''])),
    ...Object.fromEntries(NUMBERS.map((k) => [k, str(h?.[k])])),
    ...Object.fromEntries(CHOICES.map((k) => [k, h?.[k] ?? ''])),
    lmp: day(h?.lmp),
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
    lmp: v.lmp || null,
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
  if (CHOICES.some((k) => h[k]) || NUMBERS.some((k) => h[k] != null && h[k] !== '') || h.previousPeriod || h.lmp) return false;
  if ((h.family ?? []).length || (h.pregnancies ?? []).length) return false;
  return !TEXTS.some((k) => (h[k] ?? '').trim());
}

// "4 years", "7 months", "2 years 3 months" (doctor's request, 16 Nov 2026: months too, for a marriage of under a year)
const filled = (x) => x != null && String(x).trim() !== '';
const count = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
export function marriedSinceText(h) {
  const y = filled(h?.marriedSinceYears) ? Number(h.marriedSinceYears) : null;
  const m = filled(h?.marriedSinceMonths) ? Number(h.marriedSinceMonths) : null;
  if (y == null && m == null) return '';
  if (y == null) return count(m, 'month');
  return m ? `${count(y, 'year')} ${count(m, 'month')}` : `${y} years`;
}

/** The five lines as the record shows them (Overview, copy of the record): [label, text] for those written. */
export function historyLines(h) {
  if (!h) return [];
  const L = HISTORY_LABELS;
  const married = [marriedSinceText(h), h.consanguinity ? `Consanguinity ${L.YES_NO[h.consanguinity].toLowerCase()}` : ''].filter(Boolean).join(' · ');
  const lines = [
    ['Complaints', h.complaint],
    ['Menstrual history', [h.lmp ? `LMP ${showDay(h.lmp)}` : '', h.cycle ? `Cycle ${L.CYCLE_KINDS[h.cycle].toLowerCase()}` : ''].filter(Boolean).join(' · ')],
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
  const menstrual = [lmp ? `LMP ${lmp}` : h.lmp ? `LMP ${showDay(h.lmp)}` : '', h.cycle ? `Cycle ${L.CYCLE_KINDS[h.cycle].toLowerCase()}` : ''].filter(Boolean).join(' · ');
  if (menstrual) out.push(`Menstrual history – ${menstrual}`);
  const married = [marriedSinceText(h) ? `Married since ${marriedSinceText(h)}` : '', h.consanguinity ? `Consanguinity ${L.YES_NO[h.consanguinity].toLowerCase()}` : ''].filter(Boolean).join(' · ');
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
// 10 Nov 2026 (the developer's test on a tablet): also the words doctors say instead of the template's – "came first
// time with", "c/o", "chief complaint", "presented with" start the complaint, which stops before "advise…" (that goes to
// notes); "previous delivery", "previously delivered", "past deliveries", "delivery history" and "previous LSCS /
// caesarean / normal delivery" start the previous-deliveries blank.

const COMPLAINT_WORDS = [
  /\bwith (?:the )?complaints? of\b/,
  /\bcomplain(?:s|ing|ed)? of\b/,
  /\bchief complaints?(?: (?:is|are|of))?\b/,
  /\bc\s?\/\s?o\b/,
  /\bpresent(?:s|ed|ing) with\b/,
  /\b(?:came|comes|come|has come|coming)(?: for the| the)?(?: (?:first|1st) time| today)?(?: to (?:the )?(?:hospital|opd|clinic))? with\b/,
  // "Came to confirm the pregnancy", "came for ANC check-up" (16 Nov 2026): the reason she came is the complaint
  /\b(?:came|comes|has come|coming)(?: (?:here|today))?(?= (?:to|for) )/,
  /\bcomplaints?\b/,
];
const DELIVERY_WORDS = [
  /\b(?:previous(?:ly)?|prev\.?|past|earlier) deliver(?:y|ies|ed)\b/,
  /\bdelivery history\b/,
  // "previous LSCS in 2021": the anchor is "previous" alone, so the kind of delivery stays in the blank
  // (also with a count: "previous 2 normal deliveries", "previous one LSCS" – 16 Nov 2026)
  /\bprevious(?=\s+(?:(?:\d{1,2}|one|two|three|four|five)\s+)?(?:lscs|caesarean|cesarean|c[\s-]?section|normal|ftnd|nvd|vaginal|full[\s-]term))/,
];
const anyOf = (list) => new RegExp(list.map((rx) => rx.source).join('|'), 'i');

const ANCHORS = [
  ['complaint', anyOf(COMPLAINT_WORDS)],
  // also "…, periods were regular" / "menses irregular" said after a comma or full stop (the word regular stays in the blank)
  ['menstrual', /\bmenstrual history\b|\bL\.?\s?M\.?\s?P\b|(?<=^\s?|[,.;]\s?)(?:(?:her|the)\s+)?(?:periods?|menses|cycles?)(?:\s+(?:is|are|were|was|has been|have been))?(?=\s+(?:ir)?regular\b)/i],
  ['married', /\bmarried (?:since|for)\b|\bobstetric history\b/i],
  ['deliveries', anyOf(DELIVERY_WORDS)],
  // "No major personal, medical, operative and family history" / "nil significant past history": the words themselves are
  // the answer, so this anchor takes no words (doctor's request, 15 Nov 2026)
  ['other', /\bany other\b|\bother (?:personal|medical|history)\b|(?=\b(?:no|nil|not any)\s+(?:(?:major|significant|relevant|other|known|any)\s+)?(?:past|personal|medical|operative|surgical|family)\b)/i],
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

// Consanguinity as speech to text writes it: "consanguineous", "consanguinous", "consensuous", "consagnuity"
const KIN = '(?:consan\\w*|consen\\w*|consag\\w*)';
const NO_CONSANGUINITY = new RegExp(`\\bnon[\\s-]?${KIN}|\\b(?:no|not|nil|without)\\s+${KIN}|\\b${KIN}\\s*(?:is\\s*)?(?:no|nil|absent|none|negative)\\b`, 'i');
const YES_CONSANGUINITY = new RegExp(`\\b${KIN}\\s*(?:is\\s*)?(?:yes|present|positive)\\b|\\b${KIN}\\s+marriage\\b`, 'i');

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
 * Where "Previous deliveries" is said in `text`: [{ start, end }] – the one blank about children already born, where
 * their sex may be said (owner's decision 4 of 27 Oct 2026), so a pregnancy's Dictate leaves those words in.
 */
export function bornChildSpans(text, careType) {
  const s = String(text ?? '');
  const found = [...ANCHORS, ...(CARE_ANCHORS[careType] ?? [])]
    .map(([key, rx]) => {
      const m = rx.exec(s);
      return m ? { key, start: m.index, end: m.index + m[0].length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return found.flatMap((f, i) => (f.key === 'deliveries' ? [{ start: f.start, end: i + 1 < found.length ? found[i + 1].start : s.length }] : []));
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
      // Ends before the template's next words, or before advice or a plan said in the same breath (that goes to notes)
      const c = clean(t.replace(/\b(?:menstrual|obstetric) history\b.*$/i, '').replace(/(?:[.;]\s*|\s)(?:advise[ds]?|advice|plan(?:ned)?|investigations?)\b.*$/i, ''));
      if (c) out.complaint = c.replace(/^for\s+/i, ''); // "came for ANC check-up"
    }
    if (f.key === 'menstrual' || f.key === 'complaint') {
      // "cycle regular", "regular cycles", and "periods were regular" (its anchor ends just before the word)
      // (also "LMP 2 October, periods were regular": the LMP anchor came first, so the words are inside this part)
      const cyc = /\b(?:cycles?|periods?|menses)\s+(?:(?:is|are|were|was|has been|have been)\s+)?(regular|irregular)\b|\b(regular|irregular)\s+(?:cycles?|periods?|menses)\b|^\s*(regular|irregular)\b/i.exec(t);
      if (cyc) out.cycle = (cyc[1] ?? cyc[2] ?? cyc[3]).toLowerCase();
    }
    if (f.key === 'married') {
      // "4 years", "7 months", "2 years 3 months" (doctor's request, 16 Nov 2026: months too); "24 months" is 2 years
      const yrs = new RegExp(`\\b${NUMBER}\\s*(?:years?|yrs?)\\b`, 'i').exec(t);
      const mos = new RegExp(`\\b${NUMBER}\\s*(?:months?|mths?)\\b`, 'i').exec(t);
      const months = mos ? number(mos[1]) : NaN;
      if (yrs && (!mos || months < 12)) out.marriedSinceYears = String(number(yrs[1]));
      if (mos && months < 12) out.marriedSinceMonths = String(months);
      else if (mos && !yrs && months % 12 === 0) out.marriedSinceYears = String(months / 12);
      // Speech to text spells it many ways: "consanguineous", "consanguinous", "consensuous", "consagnuity"
      if (NO_CONSANGUINITY.test(t)) out.consanguinity = 'no';
      else if (YES_CONSANGUINITY.test(t)) out.consanguinity = 'yes';
    }
    if (f.key === 'deliveries') {
      const d = clean(t);
      if (d) out.previousDeliveries = d;
    }
    if (f.key === 'other') {
      const o = clean(t.replace(/^\s*(?:personal|medical|operative|surgical|or|and|family|,|\s)*history\b/i, ''));
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
  marriedSinceMonths: 'Married since (months)',
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
  // A piece is covered when the sheet took it – also once its anchor words are left out ("Previous delivery", "Previously
  // delivered twice" when the blank took "twice, both normal"): those words are the blank's heading, not something to ask
  const anchorsOf = [...ANCHORS, ...(CARE_ANCHORS[careType] ?? [])].map(([, rx]) => new RegExp(rx.source, 'gi'));
  const covered = (u) => {
    // "married since 7 months" and "no consensuous marriage": the blanks took a number or a yes/no, too short to compare
    if ((sheet.marriedSinceYears || sheet.marriedSinceMonths) && /\bmarried (?:since|for)\b/i.test(u.text) && !/\b(?:con[sn]|kin)/i.test(u.text)) return true;
    if (sheet.consanguinity && (NO_CONSANGUINITY.test(u.text) || YES_CONSANGUINITY.test(u.text)) && !/\bmarried (?:since|for)\b/i.test(u.text)) return true;
    if (sheet.consanguinity && (sheet.marriedSinceYears || sheet.marriedSinceMonths) && /\bmarried (?:since|for)\b/i.test(u.text)) return true;
    // (numbers compared as digits: the voice entry writes "1" and "2nd" where the blank kept "one" and "second")
    const digits = (x) => norm(x).replace(/\b(\d+)(?:st|nd|rd|th)\b/g, '$1').replace(/\b(?:first|second|third)\b/g, (w) => ({ first: '1', second: '2', third: '3' })[w]);
    const takenD = taken.map(digits);
    const t = digits(u.text);
    if (!t || takenD.some((s) => s.includes(t) || t.includes(s))) return true;
    const rest = digits(anchorsOf.reduce((x, rx) => x.replace(rx, ' '), u.text));
    return !rest || takenD.some((s) => s.includes(rest));
  };
  // The complaint is written once (10 Nov 2026): when the sheet's "complaints of" took it, the voice entry's
  // "Reason for visit: …" note saying the same is left out of the notes; any other note stays
  let foundOut = found;
  let pathsOut = [...new Set(paths)];
  // (number words as digits: the voice entry writes "1 week" where the sheet keeps "one week")
  const norm = (x) => plainWords(x).replace(/\b[a-z]+\b/g, (w) => (WORD_NUMBERS[w] != null ? String(WORD_NUMBERS[w]) : w));
  const complaint = norm(sheet.complaint ?? '');
  if (complaint && typeof values.notes === 'string') {
    const same = (piece) => {
      const m = /^Reason for visit:\s*(.*)$/i.exec(piece.trim());
      const r = m ? norm(m[1]) : '';
      return Boolean(r) && (r.includes(complaint) || complaint.includes(r));
    };
    const kept = values.notes.split('; ').filter((p) => !same(p));
    if (kept.length !== values.notes.split('; ').length) {
      const notes = kept.join('; ');
      if (notes) values.notes = notes;
      else {
        delete values.notes;
        pathsOut = pathsOut.filter((p) => p !== 'notes');
      }
      foundOut = found
        .map((f) => (f.path !== 'notes' ? f : notes ? { ...f, text: notes, ...(f.pieces ? { pieces: f.pieces.filter((p) => !same(p.text ?? '')) } : {}) } : null))
        .filter(Boolean);
    }
  }
  return { ...result, values, paths: pathsOut, found: foundOut, unused: (result.unused ?? []).filter((u) => !covered(u)) };
}
