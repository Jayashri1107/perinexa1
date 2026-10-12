// Voice entry: the Indian English layer (plan section 2) – plain rules that run in the browser only; nothing said is
// stored or sent.
//  - findProtectedSpans: the parts of what was said that are names, addresses, phone numbers, referring doctors and
//    hospitals. Later steps never "correct" them ("husband Umar", "12 Palm Tree Colony", "Dr Asthana").
//  - applySelfCorrections: "age 25, sorry, 26" → age 26, with a note, and a detail said twice with two different
//    values (and no "sorry") reported so the app can ask which is right.
//  - normaliseLabels, prepareTranscript and fixAfterDigits: words and numbers as Indian English speakers say them and
//    Chrome writes them ("naam", "prebious", "twenty tree", "else CS", "are H negative", "nine ate seven …"). Each
//    change is reported ({ heard, to, rule, tier }) so the app can show it; what is not sure becomes a question.
//  - indiKey, accentDistance and fuzzyTerm: a word the app knows, found by how the word heard sounds ("fibloid" →
//    fibroid, "diabitis" → diabetes), never for an ordinary English word or an Indian name (realWordGuard.js).

import { COMMON_WORDS, EXTRA_VOCAB, FAMILY_WORDS, KNOWN_SHORT_FORMS, SAME_SPELLING, TERMS } from './obgyTerms.js';
import { DICTATION_WORDS, REAL_WORDS } from './realWordGuard.js';
import { mentionsFetalSex } from '../../pcpndtWords.js';

// Numbers in Indian languages (research-accents.md §6.2), read only right before a unit word or inside the obstetric
// formula (plan 2.3 step 4): "pachees saal" = 25 years, "para do" = para 2. Never on their own ("do", "be", "tin").
export const INDIAN_NUMBERS = {
  // Hindi / Urdu (with the ages most often said)
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chah: 6, saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, gyaarah: 11,
  barah: 12, baarah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnees: 19, bees: 20, ikkees: 21, baees: 22,
  bais: 22, teyees: 23, teis: 23, chaubees: 24, pachees: 25, pachchees: 25, chhabbees: 26, sattaees: 27, sattais: 27, atthaees: 28, atthais: 28,
  untees: 29, tees: 30, paintees: 35, chaalees: 40, chalees: 40,
  // Punjabi
  ikk: 1, tinn: 3, panj: 5, satt: 7, atth: 8,
  // Marathi
  don: 2, paach: 5, saha: 6, daha: 10,
  // Gujarati
  be: 2, tran: 3, chha: 6, nav: 9,
  // Bengali
  dui: 2, tin: 3, chhoy: 6, aat: 8, noy: 9, dosh: 10,
  // Odia ("na", 9, is left out: it is also a filler)
  eka: 1, tini: 3, chari: 4, pancha: 5, sata: 7, atha: 8, dasa: 10,
  // Tamil
  onnu: 1, rendu: 2, moonu: 3, naalu: 4, anju: 5, aaru: 6, ezhu: 7, ettu: 8, ombodhu: 9, pathu: 10,
  // Telugu
  okati: 1, moodu: 3, naalugu: 4, aidu: 5, edu: 7, enimidi: 8, tommidi: 9, padi: 10,
  // Kannada
  ondu: 1, eradu: 2, mooru: 3, naalku: 4, elu: 7, entu: 8, ombattu: 9, hattu: 10,
  // Malayalam
  randu: 2, moonnu: 3, anchu: 5, onpathu: 9,
};
// Indian numbers that are also English words: inside the formula only with another part of it said next to them
const ENGLISH_LOOKING = new Set(['do', 'be', 'don', 'tin', 'teen', 'char', 'das']);
// Unit words (and what they are in English). Unit words that are common first names (Varsha) are left out.
const UNIT_WORDS = {
  saal: 'years', sal: 'years', varsh: 'years', varas: 'years', baras: 'years', vayasu: 'years', vayassu: 'years',
  maas: 'months', mahina: 'months', mahine: 'months', mahino: 'months', nela: 'months', tingalu: 'months', maasam: 'months',
  hafte: 'weeks', hafta: 'weeks', vaaram: 'weeks', din: 'days', kilo: 'kilo', tarikh: 'tarikh', tareekh: 'tarikh',
};

// ---------- Protected spans ----------
const NUMBER_WORDS =
  'zero oh nought one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen ' +
  'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand double triple';
// Words that end a name: small words, the names of other details, numbers, and words the app reads as a finding
const NAME_END = new Set(
  [
    ...(
      'is was who she he her his hers and or but with has have having had came comes come for from in at on of to the a an by as ' +
      'age aged years yrs year old months weeks phone mobile contact number no not nil none address lives living resident residing staying ' +
      'lmp edd blood group height weight allergic allergy history known case married para gravida primi baby husband wife mother father ' +
      'son daughter doctor dr hospital clinic referred patient pt ji sir madam today yesterday now also then so okay ok please thank thanks ' +
      'positive negative reactive non normal sorry mean matlab correction village gaon residence hai hain tha thi'
    ).split(' '),
    ...Object.keys(UNIT_WORDS),
    ...NUMBER_WORDS.split(' '),
    ...COMMON_WORDS,
    ...TERMS.flatMap((t) => t.says.flatMap((say) => say.toLowerCase().split(/[\s-]+/))).filter((w) => w.length >= 3),
  ].filter((w) => !/^[a-z]$/.test(w)), // single letters are initials ("K P Sreeja")
);
const SHORT_FORMS = new Set([...KNOWN_SHORT_FORMS, ...TERMS.flatMap((t) => t.says.filter((w) => /^[A-Za-z0-9]{2,7}$/.test(w) && /[A-Z].*[A-Z]/.test(w)).map((w) => w.toUpperCase()))]);
const isNameWord = (w) => /^[A-Za-z][A-Za-z'.]*$/.test(w) && !NAME_END.has(w.toLowerCase().replace(/[.']+$/, '')) && !(w.length > 1 && SHORT_FORMS.has(w.toUpperCase().replace(/\.$/, '')));

// The name words right after `from`: [end] of the last one, or null.
function nameAfter(text, from, max = 4) {
  let end = null;
  const rx = /\s*([A-Za-z][A-Za-z'.]*)/y;
  rx.lastIndex = from;
  for (let n = 0; n < max; n += 1) {
    const m = rx.exec(text);
    if (!m || !isNameWord(m[1])) break;
    // "naam Sunaina Mishra pachees saal": a number said with its unit is not part of the name
    const next = text.slice(rx.lastIndex).match(/^\s*([A-Za-z]+)/)?.[1].toLowerCase();
    if (INDIAN_NUMBERS[m[1].toLowerCase()] && UNIT_WORDS[next]) break;
    end = rx.lastIndex;
  }
  return end;
}

const TITLE = '(?:mrs|ms|miss|misses|smt|shrimati|shreemati|sau|sou|kumari|km)\\.?';
// Where a name starts: after these words. `kind` says whose name it is.
const NAME_KEYS = [
  { kind: 'name', rx: /\b(?:patient'?s?\s+)?name\s*(?:is|:|-)?\s+/gi, notAfter: /\b(?:husband|mother|father|baby|wife|son|daughter|doctor|dr|hospital|pati)(?:'?s)?\s*$/i },
  { kind: 'name', rx: new RegExp(`\\b${TITLE}\\s+`, 'gi'), skip: (m) => /^MS\b/.test(m[0]) }, // "MS" in capitals is mitral stenosis
  { kind: 'name', rx: /\bpatient\s+(?:is|:)\s+/gi },
  { kind: 'husband', rx: /\b(?:husband(?:'?s)?(?:\s+name)?|w\s*\/\s*o|wife\s+of|pati(?:\s+ka\s+naam)?)\s*(?:is|:|-)?\s+/gi },
  { kind: 'mother', rx: /\b(?:mother(?:'?s)?(?:\s+name)?|baby\s+of|b\s*\/\s*o)\s*(?:is|:|-)?\s+/gi },
  { kind: 'father', rx: /\b(?:father(?:'?s)?(?:\s+name)?|d\s*\/\s*o|daughter\s+of)\s*(?:is|:|-)?\s+/gi },
  { kind: 'referrer', rx: /\b(?:referred|refd|ref\.?)\s+(?:by|from)\s+(?:(?:dr\.?|doctor)\s+)?/gi },
  { kind: 'referrer', rx: /\bdr\.?\s+/gi },
  { kind: 'referrer', rx: /\b[Dd]octor\s+(?=[A-Z])/g }, // "doctor advised" is not a name
];
const HOSPITAL = /\b(?:hospital|nursing\s+home|maternity\s+home|clinic|medical\s+college)\b/gi;

// ---------- Where an address starts and ends (used here and by dictation.js, so the two always agree) ----------
const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// How a term is said, as a pattern: "HELLP syndrome" also as "HELLP-syndrome"
export const sayPattern = (say) =>
  say
    .trim()
    .split(/[\s-]+/)
    .map((w) => escapeRx(w).replace(/'/g, "'?"))
    .join('[\\s-]*');
// Where the next detail starts (plan G3.1): only a detail's own words count – "para 2", "blood group", "age 28",
// "married for", "scan EDD", "mother's name" – so an address such as "Ghosh Para", "Opposite Blood Bank", "Old Age Home
// Road", "Mother Dairy Road" or "Near Dr Ambedkar Chowk" is kept whole. An address ends here.
export const DETAIL_START =
  'name|(?:age|aged)\\s*(?:is|of|:|-|=)?\\s*\\d+|phone|mobile|contact|cell|address|lives|living\\s*(?:is|:|-)?\\s*\\d+|living\\s+(?:at|in)|resident|residing|' +
  'residence\\s+(?:at|in)|staying|lmp|l\\.?\\s?m\\.?\\s?p|last\\s+(?:menstrual|period|menses|mc|date)|periods?\\s+came\\s+on|edd|due\\s+date|expected\\s+date|' +
  '(?:scan|usg)\\s+edd|gravida|para\\s*(?:is|:|-)?\\s*\\d+|primi\\w*|g\\s?\\d+(?:\\s*[plad]\\s*\\d+)*|blood\\s*(?:group|grp|type)|height|weight|weighs|allerg\\w*|nkda|' +
  "history\\s+of|known\\s+case|born|birth|delivered|dob|tob|bw|time\\s+of\\s+birth|sex|mother(?:'?s)?\\s+name|husband|married\\s+(?:for|since|\\d+)|housewife|" +
  'occupation|diabet\\w*|hypertens\\w*|asthma\\w*|thyroid|an(?:ae|e|a)mi[ac]\\w*|previous|postnatal|antenatal|thank\\s+you|\\d{1,3}\\s*(?:years?|yrs?)\\b';
export const ADDRESS_STOP = new RegExp(`\\s(?:${DETAIL_START})\\b`, 'i');
// A finding said right after an address ends it, with the words that lead into it: "Wakad Pune known hypothyroid",
// "12 MG Road, mother is diabetic", "Wakad Pune scan shows placenta previa". Not a place named after one ("TB Hospital
// Road").
const FINDING_LEAD_IN = String.raw`(?:(?:known|k\/?c|case|of|h\/?o|c\/?o|history|with|has|had|is|was|scan|usg|shows?|showing|suggestive|mother|father|sister|brother|family|baby)\s+){0,3}`;
const PLACE_WORD = 'hospital|clinic|cent(?:re|er)|nursing|home|road|rd|marg|lane|street|chowk|nagar|colony|society|school|market|bazaa?r|park|garden|tower|complex|building|station|stand|gate';
const ANY_TERM = TERMS.flatMap((t) => t.says)
  .sort((a, b) => b.length - a.length)
  .map(sayPattern)
  .join('|');
const ADDRESS_FINDING = new RegExp(
  `(?<=\\S)\\s+(?=${FINDING_LEAD_IN}(?:(?<![a-z0-9])(?:${ANY_TERM})(?![a-z0-9])|hypo\\w*|hyper(?!market)\\w*|blood\\s+(?:pressure|sugar)|bp\\b|baby\\s+(?:movements?|kicks?|of)\\b|scan\\s+(?:shows?|showed|showing|report|done|normal|edd)\\b)(?!\\s+(?:${PLACE_WORD})\\b))`,
  'i',
);
// "address …", "residence at …", "at post …" (plan G3.3)
export const ADDRESS_WORD =
  /\b(?:address|addr|residing\s+at|resident\s+of|residence\s+(?:at|in)|lives\s+(?:at|in)|living\s+(?:at|in)|staying\s+(?:at|in)|stays\s+(?:at|in)|at\s+post)\b\s*(?:is|:|-)?\s*/i;
// Only when none of those is said: "village Khed …" keeps the word "village". A place name must follow, so "village
// health nurse", "gaon se aayi hai" and "village side" never become the address
export const VILLAGE_WORD =
  /\b(?=(?:village|gaon)\s+(?!(?:se|ka|ki|ke|ko|me|mein|main|wala|wali|wale|side|level|health|worker|nurse|asha|anganwadi|sevika|dai|referred|refer|hospital|clinic|phc|chc|centre|center|camp|people|women|from|to|and|or|the|a|of|in|is|was|hai|tha|thi)\b)[a-z])/i;
const ADDRESS_STOPS = [
  /[;\n]/,
  /\.\s+(?=(?:she|he|her|his|patient|the|this|husband|wife)\b)/i,
  ADDRESS_STOP,
  ADDRESS_FINDING,
  // a phone number (10 digits, perhaps said one by one) – never inside digits said one by one ("4 1 1 0 5 7 9 8 …"),
  // where dictation.js decides the split
  /(?<!(?:^|\s)\d)\s(?=(?:\+?91[\s-]?|0[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d))/,
];
// The address said from `from` (up to `upTo`), as said: it ends where the next detail or a finding starts, or before a
// phone number
export function addressAfter(s, from, upTo = s.length) {
  const rest = ` ${s.slice(from, upTo)}`;
  let end = rest.length;
  for (const rx of ADDRESS_STOPS) {
    const i = rest.search(rx);
    if (i >= 0 && i < end) end = i;
  }
  return rest.slice(1, end);
}
// Where the address starts: { index, length } of its keyword ("village" itself is kept in the address), or null
export function addressStart(s) {
  const m = s.match(ADDRESS_WORD) ?? s.match(VILLAGE_WORD);
  return m && { index: m.index, length: m[0].length };
}
const PHONE_KEY = /\b(?:phone|mobile|contact|cell|mob|ph|tel(?:ephone)?|landline|whats\s?app)\b\.?(?:\s*(?:number|no\.?|num|nos?))?\s*(?:is|:|-)?\s*/gi;
const PHONE_RUN = new RegExp(`^(?:(?:\\+|\\(|\\)|\\d+|${NUMBER_WORDS.split(' ').join('|')}|o|plus)(?:[\\s,-]+|$|(?=[()+])))+`, 'i');

// A name said first with no keyword ("Asha Sample, 28 years …", "patient anamika sharma twenty six years"), read the way
// dictation.js findName reads it: 2 to 4 name words at the start, then a comma or full stop (capitalised words only),
// "age", or an age with "years" – not "… 3 years back". [start, end) or null. (Made when first used: NUMBER_ALT is
// defined further down.)
let leadNameRx = null;
let backRx = null;
function leadName(s) {
  if (!leadNameRx) {
    const age = `(?:\\d{1,3}|(?:${NUMBER_ALT})(?:[\\s-]+(?:${NUMBER_ALT}))?)`;
    leadNameRx = new RegExp(
      `^\\s*(?:patient\\s+)?([a-z][a-z'.-]*(?:\\s+[a-z][a-z'.-]*){1,3}?)(?=\\s*[,.]|\\s+(?:is\\s+(?:a\\s+)?)?(?:age|aged)\\b|\\s+(?:is\\s+(?:a\\s+)?)?${age}[\\s-]*(?:years?|yrs?|y\\b|\\/f\\b))`,
      'i',
    );
    backRx = new RegExp(`^\\s*${age}\\s*(?:years?|yrs?)\\s+(?:back|ago|before)\\b`, 'i');
  }
  const m = s.match(leadNameRx);
  if (!m) return null;
  const words = m[1].split(/\s+/);
  const rest = s.slice(m.index + m[0].length);
  if (!words.every(isNameWord) || backRx.test(rest)) return null;
  if (/^\s*[,.]/.test(rest) && !words.every((w) => /^[A-Z]/.test(w))) return null;
  const start = m.index + m[0].length - m[1].length;
  return { start, end: start + m[1].length };
}

/**
 * The parts of `text` that are names, addresses, phone numbers, referring doctors or hospitals:
 * [{ start, end, kind }] in order, never overlapping. kind: 'name' (the patient), 'husband', 'mother', 'father',
 * 'referrer', 'hospital', 'address', 'phone'.
 */
export function findProtectedSpans(text) {
  const s = String(text ?? '');
  const spans = [];
  for (const key of NAME_KEYS) {
    for (const m of s.matchAll(key.rx)) {
      if (key.skip?.(m) || key.notAfter?.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
      const start = m.index + m[0].length;
      const end = nameAfter(s, start);
      if (end) spans.push({ start: start + s.slice(start).search(/\S/), end, kind: key.kind });
    }
  }
  // (not where a name said after its keyword is found: "name T B Lakshmi")
  const lead = leadName(s);
  if (lead && !spans.some((sp) => sp.start < lead.end && sp.end > lead.start)) spans.push({ ...lead, kind: 'name' });
  // "Sai Hospital", "Ruby Hall Clinic": up to 3 name words before the word
  for (const m of s.matchAll(HOSPITAL)) {
    let start = m.index;
    for (let n = 0; n < 3; n += 1) {
      const w = s.slice(0, start).match(/([A-Za-z][A-Za-z'.]*)\s+$/);
      if (!w || !isNameWord(w[1])) break;
      start = w.index;
    }
    if (start < m.index) spans.push({ start, end: m.index + m[0].length, kind: 'hospital' });
  }
  // An address: after each address word, or from "village …" when none is said
  const addressWords = [...s.matchAll(new RegExp(ADDRESS_WORD.source, 'gi'))];
  const village = addressWords.length ? null : s.match(VILLAGE_WORD);
  for (const m of village ? [village] : addressWords) {
    const start = m.index + m[0].length;
    const raw = addressAfter(s, start);
    if (raw.trim().length >= 3) spans.push({ start: start + raw.search(/\S/), end: start + raw.trimEnd().length, kind: 'address' });
  }
  const phone = (from) => {
    const run = s.slice(from).match(PHONE_RUN);
    return run && /\d|zero|one|two|three|four|five|six|seven|eight|nine/i.test(run[0]) ? from + run[0].trimEnd().replace(/[\s,-]+$/, '').length : null;
  };
  for (const m of s.matchAll(PHONE_KEY)) {
    const start = m.index + m[0].length;
    const end = phone(start);
    if (end && end > start) spans.push({ start, end, kind: 'phone' });
  }
  for (const m of s.matchAll(/\+?\d[\d\s-]{8,}\d/g)) if (m[0].replace(/\D/g, '').length >= 10) spans.push({ start: m.index, end: m.index + m[0].length, kind: 'phone' });
  // In order; where two overlap, the one that starts first (then the longer) is kept
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const sp of spans) if (!out.length || sp.start >= out.at(-1).end) out.push(sp);
  return out;
}

// ---------- Self-corrections ----------
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE = `\\d{1,2}(?:st|nd|rd|th)?\\s*(?:of\\s+)?(?:${MONTH})\\.?(?:,?\\s*\\d{4})?|(?:${MONTH})\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*\\d{2,4}`;
// Right after LMP or EDD a date may also be said with spaces or "by", or without a year ("12 7 2026", "12 by 7", "5/8"),
// as dictation.js reads it there (plan G2.1)
const SAID_DATE = `\\d{1,2}(?:\\s+by\\s+|\\s+)\\d{1,2}(?:(?:\\s+by\\s+|\\s+)(?:\\d{4}|20\\s+\\d{2}|\\d{2}))?(?![\\d:.]|\\s*(?:weeks?|wks?|days?|months?|years?))|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}(?![\\d/.-])`;
const BLOOD = '(?:a\\s?b|a|b|oh|o|0)\\s*(?:rh\\s*)?(?:positive|negative|pos|neg|\\+|-)(?![a-z0-9])';
// Only the Rh said again after a marker ("B positive, sorry, negative"): the letter said before is kept
const RH_ONLY = '(?:rh\\s*)?(?:positive|negative|pos|neg)(?![a-z0-9])(?![\\s,]*(?:for|result))';
const RESULT = 'non[\\s-]?reactive|reactive|positive|negative';
const RESULT_TESTS = 'hiv|hbsag|vdrl|rpr|tpha|hcv|hepatitis\\s+[bc]';
const LINK = '\\s*(?:is|was|of|:|-|=)?\\s*';
// Weeks ("28 weeks", "28+3 weeks", "28 weeks 3 days"), and the words before the weeks anti-D was given at
const WEEKS = '\\d{1,2}(?:\\s*\\+\\s*\\d)?\\s*(?:weeks?|wks?)(?:\\s*,?\\s*(?:and\\s+)?[0-6]\\s*days?)?(?![a-z0-9])';
const ANTI_D_LABEL = 'anti[\\s-]*d\\s+(?:(?:injection|inj|dose)\\s+)?(?:given|taken|administered|received|due)\\s+(?:at|in)';
// How a phone number is named, and a whole number (a husband's is someone else's: SOMEONE_ELSE)
const PHONE_LABEL = '(?:phone|mobile|contact|mob|tel(?:ephone)?|landline|whats\\s?app)\\b\\.?(?:\\s*(?:number|no\\.?|num))?';
// 10 digits starting 6–9 (with +91 or 0 before them), and no more digits after them
const PHONE_VALUE = '(?:\\+\\s*91[\\s-]*|0[\\s-]*)?[6-9](?:[\\s-]*\\d){9}(?![\\s-]*\\d)';
// A number that starts another detail is not a value of this one: "age 28, sorry, 2nd pregnancy", "weight 60,
// sorry, 2 weeks back". `units`: the units of the other number details. It starts with \d, so "23 weeks" is never
// read as "2".
const numberEnd = (units) =>
  `(?!\\d|\\.\\d|\\s*(?:st|nd|rd|th|weeks?|wks?|days?|months?|mths?|hours?|hrs?|times?|pregnan\\w*|babies|children|kids|deliver\\w*|abortions?|miscarriages?|back|ago|${units})\\b)`;
const FORMULA = `\\d{1,2}${numberEnd('years?|yrs?|kgs?|kilos?|cms?|feet|ft')}`;

// The details a correction can be about. `label`: how the detail is named; `value`: a value of it. `letter`: a
// formula letter said straight before its number ("G2"). `confirm`: shown in the confirmation card, never filled
// silently (blood group and results). `only`: types of care where it applies. `notAfter`: words before the label
// that make it another detail ("menarche at age 13", "gestational age 28 weeks"). `rhOnly`: a later value said as the
// Rh alone.
const CORRECTABLE = [
  {
    field: 'age',
    name: 'age',
    label: 'age|aged',
    value: `\\d{1,3}(?:\\s*(?:years?|yrs?)(?:\\s*old)?)?${numberEnd('kgs?|kilos?|cms?|feet|ft')}`,
    notAfter: /\b(?:gestational|menarche|menopause|at)\s+$/i,
  },
  {
    field: 'lmp',
    name: 'LMP',
    label: 'lmp|last\\s+menstrual\\s+(?:period|cycle)|last\\s+(?:monthly\\s+)?period|last\\s+mc|last\\s+date|periods?\\s+came\\s+on',
    value: `(?:(?:was|on|the)\\s+)*(?:${DATE}|${SAID_DATE})`,
  },
  { field: 'edd', name: 'EDD', label: 'edd|expected\\s+date\\s+of\\s+delivery|due\\s+date', value: `(?:(?:was|on|the|by\\s+scan)\\s+)*(?:${DATE}|${SAID_DATE})` },
  { field: 'bloodGroup', name: 'blood group', label: 'blood\\s*(?:group|type|grp)|bg|group', value: BLOOD, confirm: true, rhOnly: RH_ONLY },
  { field: 'height', name: 'height', label: 'height', value: `\\d{1,3}(?:\\.\\d{1,2})?(?:\\s*(?:cm|cms|feet|ft))?${numberEnd('years?|yrs?|kgs?|kilos?')}` },
  { field: 'weight', name: 'weight', label: 'weight|weighs', value: `\\d{1,3}(?:\\.\\d{1,2})?(?:\\s*(?:kg|kgs|kilos?))?${numberEnd('years?|yrs?|cms?|feet|ft')}` },
  { field: 'gravida', name: 'gravida', label: 'gravida', letter: 'g', value: FORMULA },
  { field: 'para', name: 'para', label: 'para', letter: 'p', value: FORMULA },
  { field: 'living', name: 'living', label: 'living', letter: 'l', value: FORMULA },
  { field: 'abortions', name: 'abortions', label: 'abortions?', letter: 'a', value: FORMULA },
  // A whole phone number (the husband's is someone else's): "phone 98765 43210, sorry, 91234 56789"
  { field: 'phone', name: 'phone', label: PHONE_LABEL, value: PHONE_VALUE },
  { field: 'result', name: 'result', label: RESULT_TESTS, value: RESULT, confirm: true, perLabel: true },
  // Weeks of pregnancy ("POG 28 weeks, sorry, 30 weeks") and when anti-D was given ("anti-D given at 28 weeks, sorry,
  // 30 weeks"): dictation.js reads them; a value said twice without a marker is not asked about here (there it is)
  { field: 'weeks', name: 'weeks of pregnancy', label: 'pog|period\\s+of\\s+gestation|gestational\\s+age|ga|now', value: WEEKS },
  { field: 'antiD', name: 'anti-D', label: ANTI_D_LABEL, value: WEEKS },
  { field: 'sex', name: "the baby's sex", label: 'baby|newborn|sex', value: 'boy|girl|male|female', only: ['newborn'], hidden: true },
];

export const CORRECTION_MARKERS = /\s*,?\s*\b(?:no\s+sorry|sorry|i\s+mean|matlab|correction|change\s+(?:that|it)\s+to|no\s+no|rather|cancel\s+that)\b\s*,?\s*/gi;
const GENERIC = /^(?:no\s+sorry|sorry|i\s+mean|matlab)$/i; // removed even when no detail is found around them
// Values said about someone else are not the patient's ("husband age 32", "birth weight 3 kg"), and a detail named
// only as the source of another ("EDD by LMP 11 April") is not that detail
const SOMEONE_ELSE = new RegExp(
  `\\b(?:husband|husband's|wife|mother|mother's|father|father's|sister|brother|in[\\s-]laws?|${FAMILY_WORDS.join('|')}|baby|baby's|birth|fetal|foetal|` +
    "estimated|son|daughter|child|fundal|sfh|symphysis|uterine)\\s+(?:\\w+\\s+)?$|\\b(?:by|as\\s+per|per|according\\s+to)\\s+$",
  'i',
);

// The same value however it was said: "5th July" = "5 July", "B +" = "B positive", "NR" = "non-reactive" = "negative"
const key = (v) =>
  String(v)
    .toLowerCase()
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\b(?:was|on|the|of|is|by\s+scan|years?|yrs?|old)\b/g, ' ')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g, '$1')
    .replace(/\bnon[\s-]?reactive\b/g, '-')
    .replace(/\b(?:positive|pos|reactive)\b|\+/g, '+')
    .replace(/\b(?:negative|neg)\b|-(?=\s*$)/g, '-')
    .replace(/\s+|rh/g, '')
    .replace(/^(?:0|oh)(?=[+-])/, 'o');
const labelRx = (f) => (f.letter ? `(?:${f.label})|${f.letter}(?=\\d)` : f.label);
// A formula letter is the formula only inside one, as the formula reader reads it: the first G, P, L and A of each
// run ("G2 P1 L1 A0", "G2P1L1A0", "P1 L1") – never "G6PD", "L4 L5", "P4 support" or "blood group A1"
const FORMULA_RUN =
  /\b(?:g\s*-?\s*\d{1,2}(?:\s*[,-]?\s*[plad]\s*-?\s*\d{1,2}(?:\s*\+\s*\d{1,2})?)+|p\s*\d{1,2}(?:\s*\+\s*\d{1,2})?\s*[,-]?\s*l\s*\d{1,2}(?:\s*[,-]?\s*a\s*\d{1,2})?)(?![a-z\d])/gi;
const STARTS_WITH_FORMULA = new RegExp(`^(?:${FORMULA_RUN.source})`, 'i');
function formulaStarts(s) {
  const at = new Set();
  for (const run of s.matchAll(FORMULA_RUN)) {
    const first = new Set();
    for (const l of run[0].matchAll(/[gpla](?=\s*-?\s*\d)/gi)) {
      if (first.has(l[0].toLowerCase())) continue;
      first.add(l[0].toLowerCase());
      at.add(run.index + l.index);
    }
  }
  return at;
}
const inFormula = (s, i) => [...s.matchAll(FORMULA_RUN)].some((m) => i >= m.index && i < m.index + m[0].length);
const inSpan = (spans, i) => spans.some((sp) => i >= sp.start && i < sp.end);
const tidySpaces = (t) => t.replace(/[ \t]{2,}/g, ' ');

/**
 * Corrections said while speaking. With a marker (sorry, I mean, matlab, correction, change that to, cancel that,
 * no no, rather) between two values of the same detail, the later value wins. "no" straight before a marker is
 * never a "no" about what follows ("no sorry, she has asthma"). Markers inside names or addresses are left alone.
 * Also finds a detail said twice with different values and no marker (the app asks which is right).
 * Returns { text, changes: [{ field, name, from, to, confirm, hidden }], conflicts: [{ field, name, label, scan, values:
 * [{ value, start, end }] }], unclear: [{ field, name, from }] } – unclear: a marker straight after a blood group or a
 * result whose new value was not understood (it is never dropped silently: the app says so and confirms it).
 */
export function applySelfCorrections(text, spans = [], { careType } = {}) {
  let s = String(text ?? '');
  const changes = [];
  const unclear = [];
  // After a change the text moves: the spans (when given) are found again
  const edited = () => {
    if (spans.length) spans = findProtectedSpans(s);
  };
  const fields = CORRECTABLE.filter((f) => !f.only || f.only.includes(careType));
  // "blood group not B positive, B negative"
  for (const f of fields) {
    const rx = new RegExp(`\\b(${labelRx(f)})${LINK}not\\s+(${f.value})\\s*,?\\s*(?:but\\s+|it\\s+is\\s+|it'?s\\s+)?(${f.value})`, 'gi');
    s = s.replace(rx, (all, label, from, to, at) => {
      if (inSpan(spans, at) || key(from) === key(to)) return all;
      changes.push({ field: f.field, name: f.name, from: from.trim(), to: to.trim(), confirm: Boolean(f.confirm), hidden: Boolean(f.hidden), label });
      return `${label} ${to}`;
    });
    edited();
  }
  let from = 0;
  for (;;) {
    const markers = new RegExp(CORRECTION_MARKERS.source, 'gi');
    markers.lastIndex = from;
    const m = markers.exec(s);
    if (!m) break;
    const word = m[0].replace(/^[\s,]+|[\s,]+$/g, '').toLowerCase().replace(/\s+/g, ' ');
    if (spans.length && inSpan(spans, m.index + m[0].indexOf(word[0]))) {
      from = m.index + m[0].length;
      continue;
    }
    const before = s.slice(0, m.index);
    const after = s.slice(m.index + m[0].length);
    let done = false;
    let missed = null; // a blood group or result said just before the marker, with no new value understood after it
    for (const f of fields) {
      const old = before.match(new RegExp(`\\b(${labelRx(f)})(${LINK})(${f.value})\\s*$`, 'i'));
      if (!old || SOMEONE_ELSE.test(before.slice(0, old.index)) || f.notAfter?.test(before.slice(0, old.index))) continue;
      // "L4 L5 sorry L3 L4" is not the formula; "G2 sorry 3 P2 L2 A0" still is
      if (f.letter && f.letter !== 'g' && old[1].length === 1 && !inFormula(s, old.index) && !STARTS_WITH_FORMULA.test(after)) continue;
      const oldStart = old.index;
      if (word === 'cancel that') {
        changes.push({ field: f.field, name: f.name, from: old[3].trim(), to: null, confirm: Boolean(f.confirm), hidden: Boolean(f.hidden), label: old[1] });
        s = tidySpaces(`${before.slice(0, oldStart)} ${after}`);
        edited();
        from = oldStart;
        done = true;
        break;
      }
      let again = after.match(new RegExp(`^(?:(${labelRx(f)})${LINK})?(${f.value})`, 'i'));
      if (!again && f.rhOnly) {
        // "B positive, sorry, negative": the letter said before, with the new Rh
        const rh = after.match(new RegExp(`^${f.rhOnly}`, 'i'));
        if (rh) again = [rh[0], undefined, `${old[3].match(/^(?:a\s?b|a|b|oh|o|0)/i)[0]} ${rh[0].replace(/^rh\s*/i, '')}`];
      }
      if (!again) {
        if (f.confirm) missed ??= { field: f.field, name: f.perLabel ? `${old[1]} result` : f.name, from: old[3].trim() };
        continue;
      }
      if (f.perLabel && again[1] && again[1].toLowerCase().replace(/\s+/g, '') !== old[1].toLowerCase().replace(/\s+/g, '')) continue; // another test
      if (key(old[3]) !== key(again[2])) {
        changes.push({ field: f.field, name: f.name, from: old[3].trim(), to: again[2].trim(), confirm: Boolean(f.confirm), hidden: Boolean(f.hidden), label: old[1] });
      }
      const label = f.letter && old[1].length === 1 ? old[1] : `${old[1]} `;
      s = tidySpaces(`${before.slice(0, oldStart)}${label}${again[2]}${after.slice(again[0].length)}`);
      edited();
      from = oldStart + label.length;
      done = true;
      break;
    }
    if (!done) {
      if (missed) unclear.push(missed);
      // No detail around it: a spoken "sorry" or "I mean" is dropped, so "no sorry, she has asthma" keeps asthma
      if (GENERIC.test(word)) {
        s = tidySpaces(`${before} ${after}`);
        edited();
        from = m.index;
      } else from = m.index + m[0].length;
    }
  }
  return { text: s, changes, conflicts: findConflicts(s, fields, spans), unclear };
}

const SCAN_BEFORE = /\b(?:scan|usg|ultrasound|sonography|dating|corrected|revised)\s+$/i;
// "EDD 15 April by scan" – but not the next EDD's "scan EDD"
const SCAN_AFTER = /^\s*,?\s*(?:(?:by|as\s+per|per|according\s+to|from|on)\s+(?:the\s+)?)?(?:(?:dating|early|nt)\s+)?(?:scan|usg|ultrasound|sonography)\b(?!\s*(?:edd|e\.?\s?d\.?\s?d|expected|due))/i;

// The same detail said twice with different values: [{ field, name, label, scan, values: [{ value, start, end }] }].
// A scan EDD and a plain EDD are two details ("EDD 11 April, EDD by scan 15 April"): `scan` says which one it is.
function findConflicts(s, fields, spans) {
  const conflicts = [];
  const formulaLetters = formulaStarts(s);
  for (const f of fields) {
    const seen = new Map(); // per test for results ("HIV negative … VDRL positive" is not a conflict)
    const rx = new RegExp(`\\b(${labelRx(f)})${LINK}(${f.value})`, 'gi');
    for (const m of s.matchAll(rx)) {
      const before = s.slice(Math.max(0, m.index - 30), m.index);
      if (inSpan(spans, m.index) || SOMEONE_ELSE.test(before) || f.notAfter?.test(before)) continue;
      if (f.letter && m[1].length === 1 && !formulaLetters.has(m.index)) continue; // "G6PD", "blood group A1 positive", "L4-L5"
      const scan = f.field === 'edd' && (/\bscan\b/i.test(m[2]) || SCAN_BEFORE.test(before) || SCAN_AFTER.test(s.slice(m.index + m[0].length)));
      const group = f.perLabel ? m[1].toLowerCase().replace(/\s+/g, '') : scan ? 'edd:scan' : f.field;
      const list = seen.get(group) ?? [];
      list.push({ value: m[2].trim(), label: m[1], start: m.index, end: m.index + m[0].length });
      // A second value said straight after the first, with no marker, is the same detail said twice (asked): for a
      // result or blood group always ("HIV negative, reactive"); for a number only after "actually" ("age 28
      // actually 29"), since "age 28, 2 years married" is two details
      const end = m.index + m[0].length;
      const next = s.slice(end).match(new RegExp(`^\\s*,?\\s*${f.confirm ? '' : '(?:actually|basically)\\s*,?\\s*'}(${f.value})`, 'i'));
      if (next && !inSpan(spans, end)) list.push({ value: next[1].trim(), label: m[1], start: end, end: end + next[0].length });
      seen.set(group, list);
    }
    for (const [group, list] of seen) {
      const values = [...new Map(list.map((v) => [key(v.value), v])).values()];
      const scan = group === 'edd:scan';
      if (values.length > 1) conflicts.push({ field: f.field, name: scan ? 'EDD by scan' : f.name, label: list[0].label, scan, confirm: Boolean(f.confirm), hidden: Boolean(f.hidden), values, all: list });
    }
  }
  return conflicts;
}

// =====================================================================================================================
// ---------- Words and numbers as Indian English speakers say them (plan 2.3 steps 1 and 3–8, and 2.4) ----------
// Tiers (plan 2.3 step 8): A – changed anywhere (what was heard is not an ordinary word, and it can mean only one
// thing); B – changed only next to its anchor ("tree" next to another number, "gravity" before a number); C – asked
// ("Did you mean GDM?"), never changed. Names, addresses and the doctor's own words are never changed: they are
// masked while the rules run. Every change is reported as { heard, to, rule, tier } – words removed (fillers such as
// "haan" or "ji") are not changes.

const NAME_SPAN_KINDS = new Set(['name', 'husband', 'mother', 'father', 'referrer', 'hospital']);
const wordsAlt = (list) => [...list].sort((a, b) => b.length - a.length).map(escapeRx).join('|');
const ENGLISH_NUMBERS = (
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen ' +
  'twenty thirty forty fifty sixty seventy eighty ninety hundred thousand double triple point decimal'
).split(' ');
const DIGIT_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const ORDINAL_WORDS = 'first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth twentieth thirtieth'.split(' ');
const MONTH_NAMES = 'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' ');

// Numbers said with an accent (plan 2.3 step 7). Tier A: not English words, changed anywhere. Tier B: English words,
// changed only next to another number word or digit, or after one of its labels ("ward number tree", "gravida tree",
// "abortion hero"; research-accents.md §7e). "sero" is not a number here ("HIV sero negative"), and "free" is left out
// ("sugar free", "free fluid").
const tierA = (to) => ({ to, tier: 'A' });
const tierB = (to, labels) => ({ to, tier: 'B', labels });
const IN_FORMULA = ['gravida', 'para', 'living', 'abortion', 'abortions', 'g', 'p', 'l', 'a'];
export const ACCENT_NUMBER_WORDS = {
  tirty: tierA('thirty'), tirteen: tierA('thirteen'), tirteenth: tierA('thirteenth'), tirtieth: tierA('thirtieth'), tousand: tierA('thousand'),
  fife: tierA('five'), pive: tierA('five'), sewen: tierA('seven'), seben: tierA('seven'), sewenty: tierA('seventy'), sewenteen: tierA('seventeen'),
  fourty: tierA('forty'), jero: tierA('zero'), zeero: tierA('zero'), yeleven: tierA('eleven'),
  tree: tierB('three', 'numeric'), tri: tierB('three', 'numeric'), van: tierB('one', IN_FORMULA), won: tierB('one', IN_FORMULA), tan: tierB('ten', []),
  hero: tierB('zero', ['abortion', 'abortions', 'a']),
};
// Month names as they are often heard (tier A: none is an English word)
export const MONTH_SPELLINGS = {
  jully: 'July', agust: 'August', augest: 'August', augus: 'August', febuary: 'February', febrary: 'February', februry: 'February', janvary: 'January',
  janwary: 'January', jenuary: 'January', aprail: 'April', epril: 'April', septembar: 'September', setember: 'September', octobar: 'October',
  novembar: 'November', decembar: 'December', desember: 'December',
};
// Hinglish fillers, removed (plan 2.3 step 4). "hai" is removed after a word, and "ji" when it is not a letter G
// ("ji 2 P1 L1" is G2). "matlab" is a correction marker, not a filler. "thank you" ends what was being said.
export const FILLERS = ['haan', 'han', 'achha', 'acha', 'accha', 'aacha', 'uh', 'um', 'umm', 'hmm'];
// Said after a value for emphasis ("28 only", "5th July itself"): removed there only
export const TRAILING_FILLERS = ['only', 'itself', 'actually', 'basically', 'na', 'yaar', 'bas', 'theek hai', 'thik hai', 'thick high', 'arre'];
// Letters said as words (plan 2.3 step 6). Weak ones are also ordinary words: they count only in a group that has more
// real letters than weak words, and "a" and "I" never start one.
export const LETTER_NAMES = {
  strong: {
    else: 'LS', pie: 'P', edge: 'H', etch: 'H', aitch: 'H', haitch: 'H', dee: 'D', tee: 'T', gee: 'G', cue: 'Q', kay: 'K', zed: 'Z', el: 'L', ell: 'L',
    em: 'M', ee: 'E', pee: 'P', vee: 'V', ess: 'S', ef: 'F',
  },
  weak: { are: 'R', our: 'R', see: 'C', be: 'B', bee: 'B', you: 'U', yes: 'S', age: 'H', and: 'N', in: 'N', a: 'A', i: 'I', yem: 'M', yel: 'L' },
};

const NUMBER_WORD = new Set([...ENGLISH_NUMBERS, ...Object.keys(ACCENT_NUMBER_WORDS)]);
const NUMBER_ALT = wordsAlt(NUMBER_WORD);
const bare = (w) => String(w ?? '').toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
const isNumberish = (w) => /^\d+(?:\.\d+)?(?:st|nd|rd|th)?$/.test(bare(w)) || NUMBER_WORD.has(bare(w));
const wordBefore = (s, i) => s.slice(0, i).match(/(\S+)\s*$/)?.[1] ?? '';
const wordAfter = (s, j) => s.slice(j).match(/^\s*(\S+)/)?.[1] ?? '';

// ---------- Masking what must not change ----------
const PIECE = /\uE000([\uE100-\uEFFF])\uE001/g;
// In an address only a number said after these words may be read ("ward number tree" = 3, "pin four one one …");
// the rest is kept as said ("12 Palm Tree Colony"). [1]: the keyword, [2]: the number said after it.
const ADDRESS_NUMBER = new RegExp(
  `\\b(?:(?:flat|house|plot|room|ward|bed|sector)\\s+)?((?:number|flat|house|plot|sector|ward|room|wing|pin\\s*code|pincode|pin)\\b|no\\b\\.?)\\s*(?:is|:|-)?\\s*` +
    `((?:(?:\\d+|oh|o|${NUMBER_ALT})\\b(?:[\\s,-]+|$))+)`,
  'gi',
);
const ACCENT_B = new Set(Object.keys(ACCENT_NUMBER_WORDS).filter((w) => ACCENT_NUMBER_WORDS[w].tier === 'B'));
// How much of an address number may be read: "tree", "van", "hero" … only straight after the keyword ("ward number
// tree"), or in a pincode before its 6 digits are said. After a number they are a place's name ("Plot 7 Van Vihar",
// "Sector 5 Hero Honda Chowk", "pin 462016 Van Vihar").
function addressNumberLength(m) {
  const runAt = m[0].length - m[2].length;
  let said = 0;
  for (const w of m[2].matchAll(/[a-z0-9]+/gi)) {
    if (ACCENT_B.has(w[0].toLowerCase()) && said >= (/^pin/i.test(m[1]) ? 6 : 1)) return runAt + w.index;
    said += /^\d+$/.test(w[0]) ? w[0].length : 1;
  }
  return m[0].length;
}
// The text with names, addresses and the doctor's own words replaced by placeholders: { text, restore, isName }
function maskParts(text, spans, protect) {
  const regions = [];
  for (const sp of spans) {
    if (NAME_SPAN_KINDS.has(sp.kind)) regions.push({ start: sp.start, end: sp.end, kind: sp.kind });
    else if (sp.kind === 'address') {
      let at = sp.start;
      for (const m of text.slice(sp.start, sp.end).matchAll(ADDRESS_NUMBER)) {
        if (sp.start + m.index > at) regions.push({ start: at, end: sp.start + m.index, kind: 'address' });
        at = sp.start + m.index + addressNumberLength(m);
      }
      if (at < sp.end) regions.push({ start: at, end: sp.end, kind: 'address' });
    }
  }
  for (const phrase of protect) {
    if (!String(phrase ?? '').trim()) continue;
    for (const m of text.matchAll(new RegExp(`(?<![a-z0-9])${sayPattern(phrase)}(?![a-z0-9])`, 'gi'))) {
      const r = { start: m.index, end: m.index + m[0].length, kind: 'learned' };
      if (!regions.some((x) => r.start < x.end && r.end > x.start)) regions.push(r);
    }
  }
  regions.sort((a, b) => a.start - b.start);
  const pieces = [];
  let out = '';
  let at = 0;
  for (const r of regions) {
    if (r.start < at || r.end <= r.start) continue;
    out += `${text.slice(at, r.start)}\uE000${String.fromCharCode(0xe100 + pieces.length)}\uE001`;
    pieces.push({ text: text.slice(r.start, r.end), kind: r.kind });
    at = r.end;
  }
  out += text.slice(at);
  const piece = (c) => pieces[c.charCodeAt(0) - 0xe100];
  return {
    text: out,
    restore: (t) => String(t).replace(PIECE, (_, c) => piece(c).text),
    isName: (t) => [...String(t).matchAll(PIECE)].some(([, c]) => NAME_SPAN_KINDS.has(piece(c).kind)),
  };
}

// ---------- The obstetric formula: is this G, P, L or A one? ----------
const FORMULA_WORD = 'gravida|para|living|abortions?';
const FORMULA_VALUE = `(?:\\d{1,2}(?:\\s*\\+\\s*\\d{1,2})?|${wordsAlt([...NUMBER_WORD, ...Object.keys(INDIAN_NUMBERS), 'to', 'too', 'for', 'nil', 'none', 'o', 'oh', 'jiro'])})`;
const FORMULA_BEFORE = new RegExp(`(?:\\b[gpla]|\\b(?:${FORMULA_WORD}))\\s*-?\\s*${FORMULA_VALUE}\\s*[,-]?\\s*$`, 'i');
const FORMULA_AFTER = new RegExp(`^\\s*[,-]?\\s*(?:[plad]\\s*-?\\s*${FORMULA_VALUE}(?![a-z])|(?:${FORMULA_WORD})\\b)`, 'i');
// Another part of the formula is said right before [start, end) or right after it ("G tree P do", "L do A hero")
const formulaAround = (s, start, end) => FORMULA_BEFORE.test(s.slice(Math.max(0, start - 40), start)) || FORMULA_AFTER.test(s.slice(end, end + 40));

// ---------- Step 1: label words (normaliseLabels) ----------
const NUMBER_SAID = `(?:\\d{1,3}|(?:${wordsAlt(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'])})(?:[\\s-]+(?:${wordsAlt(Object.keys(DIGIT_WORD))}))?|${wordsAlt(ENGLISH_NUMBERS.slice(0, 20))})`;
// Labels matched by how they sound, for words that are not ordinary words, and only when the value the label
// expects is said with it: 'number' after it, 'near' a number, a number 'before' it (a unit), a 'term' after it,
// 'context' (a word such as "previous" before it), any 'word' after it, or 'married' ("married for 5 years").
const LABELS = {
  previous: 'term', history: 'term', pregnancy: 'context', delivery: 'context', gravida: 'number', abortion: 'near', husband: 'word',
  mobile: 'number', address: 'word', height: 'number', weight: 'number', weeks: 'before', months: 'before', years: 'before', married: 'married',
};
// Ordinary words that sound like a label (a "books" or "yours" is never changed): the real words found by running a
// dictionary (web2, plus its -s/-es/-ed/-ing forms) through the sound matching below. "hight", "gravid" and non-words
// such as "adress", "munths" or "yeers" are left to match on purpose. (realWordGuard.js is for matching by sound.)
const LABEL_NEVER = new Set(
  (
    'deliver pervious gravity wicks vicks weak mints yours ours yrs wks mths hrs marred hysteria adders books backs adores adorers addressee ' +
    'previews previses mounts mantis mantes mantas wakes beaks becks bight wight weighty haught deliverer delver husbanded murred myrrhed'
  ).split(' '),
);
// How a label sounds: its consonants, with the sounds Indian English speakers swap merged (b/v/w, t/th, s/sh/z, k/c/q)
const labelKey = (word) => {
  const w = word
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/[vw]/g, 'b')
    .replace(/th/g, 't')
    .replace(/sh/g, 's')
    .replace(/z/g, 's')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/t(?=io)/g, 's');
  return (w[0] + w.slice(1).replace(/[aeiouyh]/g, '')).replace(/(.)\1+/g, '$1');
};
const LABEL_BY_KEY = new Map(Object.keys(LABELS).map((l) => [labelKey(l), l]));
const TERM_WORD = new Set(TERMS.flatMap((t) => t.says.flatMap((say) => say.toLowerCase().split(/[\s-]+/))).filter((w) => w.length >= 4));
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const CONTEXT_BEFORE = new Set('previous this last current present first second third 1st 2nd 3rd 4th in during of normal vaginal per index'.split(' '));
const TERM_AFTER = /^\s*(?:of\s+)?(?:lscs|cs|c-?\s?section|caesarean|cesarean|pregnancy|pregnancies|delivery|deliveries|abortions?|miscarriages?|[A-Z]{2,}\b)/;
function labelValueSaid(label, s, start, end) {
  const prev = wordBefore(s, start);
  const next = wordAfter(s, end);
  switch (LABELS[label]) {
    case 'number':
      return isNumberish(wordAfter(s, end + (s.slice(end).match(/^\s*(?:is|of|:|-|=)\s*(?=\S)/i)?.[0].length ?? 0)));
    case 'near':
      return isNumberish(prev) || isNumberish(next);
    case 'before':
      return isNumberish(prev);
    case 'term': {
      const rest = s.slice(end).replace(/^\s*of\b/i, '');
      return TERM_AFTER.test(rest) || TERM_WORD.has(bare(wordAfter(rest, 0)));
    }
    case 'context':
      return CONTEXT_BEFORE.has(bare(prev)) || isNumberish(prev);
    case 'married':
      return /^(?:for|since|at|in)$/.test(bare(next)) || isNumberish(next);
    default:
      return /[a-z0-9]/i.test(next);
  }
}

// "baby off Lakshmi" is "baby of Lakshmi" only when a name follows, and only when the mother's name is not said
// another way ("baby of Rekha", "mother Rekha") – "baby off feeds / oxygen / phototherapy" is what a doctor says.
const OFF_NOT_NAME = new Set(
  'feeds feed feeding oxygen o2 phototherapy photo breast breastfeed breastfeeding milk formula top tube ryles iv fluids drip antibiotics antibiotic medicines medicine support ventilator ventilation cpap warmer incubator nbm sugar'.split(' '),
);
function babyOffName(s) {
  if (/\bbaby\s+of\b|\bmother\b/i.test(s)) return s;
  return s.replace(/\bbaby\s+off\s+(?=([A-Za-z][A-Za-z'.]*))/gi, (all, w) => (isNameWord(w) && !OFF_NOT_NAME.has(w.toLowerCase()) ? 'baby of ' : all));
}

// "Pati" is also a surname (Odia): kept when it ends a name – straight after a name word and not before another name
// ("name Sunita Pati age 28", "Sunita Pati umar 28 saal"). "pati ka naam …", "Sunita, pati Ramesh" and "uska pati …"
// are the husband.
const POSSESSIVE = /^(?:uska|uski|unka|unki|iska|inka|mera|meri|aapka|aapki)$/i;
function patiIsSurname(s, start, end) {
  const prev = s.slice(0, start).match(/([A-Za-z][A-Za-z'.]*)\s+$/)?.[1];
  const next = s.slice(end).match(/^\s+([A-Za-z][A-Za-z'.]*)(?![A-Za-z'.]|\s*\/)/)?.[1]; // not "w/o"
  const nextIsName = next && isNameWord(next) && !/^(?:umar|umr|umra)$/i.test(next);
  return Boolean(prev && isNameWord(prev) && !POSSESSIVE.test(prev) && !nextIsName);
}

/**
 * Label words, before names and addresses are found (plan 2.3 step 1): Hinglish labels ("naam" → name, "pati" →
 * husband – left alone when it is a surname, "Sunita Pati" – "28 saal" → 28 years, "3 hafte" → 3 weeks), and a label
 * heard with an accent when the value it expects is said with it ("prebious LSCS", "hight 152", "POG 28 wicks"). "umar"
 * is not read as age ("husband Umar 32").
 * `protect`: words kept exactly as heard (a correction undone for this form only, plan 1.7).
 * Returns { text, changes } – changes: only the labels matched by sound (the Hindi words are not corrections).
 */
export function normaliseLabels(text, { protect = [] } = {}) {
  const changes = [];
  const m = maskParts(String(text ?? ''), [], protect);
  let s = m.text
    .replace(/\bpati\b/gi, (w, at, str) => (patiIsSurname(str, at, at + w.length) ? w : 'husband'))
    .replace(/\b(?:ka|ki|ke)\s+naam\b/gi, 'name')
    .replace(/\bnaam\b/gi, 'name')
    // "k c o" (k/c/o said without the slashes) before the letter decoder, which would read "c o D M" as OD – never
    // a name's initials
    .replace(/(?<!\b(?:name|dr|mr|mrs|ms|husband|w\/o|d\/o)\.?\s+(?:\S+\s+){0,2})\bk\s+c\s+o\b(?=\s+\S)/gi, 'known case of')
    .replace(/\b(?:ka|ki|ke)\s+(?:tarikh|tareekh)\b/gi, 'date')
    .replace(new RegExp(`\\b(${NUMBER_SAID})\\s+(?:saal|sal|varsh|varas|baras)(?:\\s+ki\\s+(?:hai|hain|thi))?\\b`, 'gi'), '$1 years')
    .replace(new RegExp(`\\b(${NUMBER_SAID})\\s+(?:hafte|hafta)\\b`, 'gi'), '$1 weeks')
    .replace(new RegExp(`\\b(${NUMBER_SAID})\\s+(?:mahine|mahina|mahino)\\b`, 'gi'), '$1 months');
  s = babyOffName(s);
  // Tier B: "POG 28 wicks" – only after a number
  s = s.replace(new RegExp(`\\b(${NUMBER_SAID})\\s+(vicks|wicks|weaks|veeks|weak)\\b`, 'gi'), (all, n, w) => {
    changes.push({ heard: w, to: 'weeks', rule: 'label', tier: 'B' });
    return `${n} weeks`;
  });
  // Tier A, by sound: never an ordinary word, a name (capitalised, except at the start) or a medical word
  s = s.replace(/\b[A-Za-z]{5,}\b/g, (w, at, str) => {
    const low = w.toLowerCase();
    const label = LABEL_BY_KEY.get(labelKey(low));
    if (!label || label === low || LABEL_NEVER.has(low) || COMMON_WORDS.has(low) || TERM_WORD.has(low) || editDistance(low, label) > 2) return w;
    const lead = str.slice(0, at);
    if (/^[A-Z]/.test(w) && lead.trim() && !/[.?!]\s*$/.test(lead)) return w;
    if (!labelValueSaid(label, str, at, at + w.length)) return w;
    changes.push({ heard: w, to: label, rule: 'label', tier: 'A' });
    return label;
  });
  return { text: m.restore(s), changes };
}

// ---------- Step 4: fillers, and numbers in Indian languages ----------
const VALUE_WORD = `(?:\\d[\\w.]*|${wordsAlt([...ENGLISH_NUMBERS, ...ORDINAL_WORDS, ...MONTH_NAMES])}|positive|negative|non-reactive|reactive|nil|none|normal|kgs?|kilos?|cms?|weeks?|months?|years?|days?)`;
// "actually" and "basically" are kept before another number ("age 28 actually 29"): that is asked (plan 2.3 step 2)
const KEEP_BEFORE_NUMBER = new Set(['actually', 'basically']);
const TRAILING = new RegExp(
  `(?<=\\b${VALUE_WORD}[.,]?)\\s+(?:(?:${TRAILING_FILLERS.filter((f) => !KEEP_BEFORE_NUMBER.has(f)).map((f) => f.replace(/\s+/g, '\\s+')).join('|')})\\b` +
    `|(?:${[...KEEP_BEFORE_NUMBER].join('|')})\\b(?!\\s*,?\\s*(?:\\d|(?:${NUMBER_ALT})\\b)))`,
  'gi',
);
// A "no" at the end of a clause after a value asks "isn't it?" – it is not a "no" ("LMP was 5th July no, diabetes nil")
const TAG_NO = new RegExp(`(?<=\\b${VALUE_WORD})\\s+no(?=\\s*(?:[,.;?!]|$))`, 'gi');
const INDIAN_ALT = wordsAlt(Object.keys(INDIAN_NUMBERS));
const INDIAN_WITH_UNIT = new RegExp(`\\b(${INDIAN_ALT})\\s+(${wordsAlt(Object.keys(UNIT_WORDS))})\\b(?:\\s+ki\\s+(?:hai|hain|thi))?`, 'gi');
const INDIAN_IN_FORMULA = new RegExp(`\\b(${FORMULA_WORD}|[gpla])(\\s*-?\\s*)(${INDIAN_ALT})\\b`, 'gi');

function fillersAndNumbers(s, change) {
  // Numbers first, so "pachees saal ki hai" is 25 years as a whole
  let t = s.replace(INDIAN_WITH_UNIT, (all, word, unit) => {
    const to = `${INDIAN_NUMBERS[word.toLowerCase()]} ${UNIT_WORDS[unit.toLowerCase()]}`;
    change(all, to, 'number', 'B');
    return to;
  });
  t = t
    .replace(new RegExp(`\\b(?:${FILLERS.join('|')})\\b`, 'gi'), ' ')
    .replace(/\bthank\s+you\b/gi, ';')
    .replace(/(?<=\S\s+)\b(?:hai|hain)\b/gi, ' ')
    // "ji" is kept after a name ("Sharma ji") and where it may be the letter G ("ji 2 P1 L1", "ji DM")
    .replace(new RegExp(`\\bji\\b(?!\\s*(?:\\d{1,2}|${NUMBER_ALT}|${INDIAN_ALT})\\s*(?:p\\s*-?\\s*\\d|p\\b|para\\b))(?!\\s+d\\s*m\\b)`, 'gi'), (ji, at, str) =>
      /\b[A-Z][a-z]+\s+$/.test(str.slice(0, at)) ? ji : ' ',
    );
  for (let n = 0; n < 2; n += 1) t = t.replace(TRAILING, '');
  t = t.replace(TAG_NO, '');
  return t.replace(INDIAN_IN_FORMULA, (all, label, gap, word, at, str) => {
    // after G, P, L or A (and "living do") only with another part of the formula said next to it
    const needsMore = label.length === 1 || (ENGLISH_LOOKING.has(word.toLowerCase()) && /^living$/i.test(label));
    if (needsMore && !formulaAround(str, at, at + all.length)) return all;
    const n = INDIAN_NUMBERS[word.toLowerCase()];
    change(word, String(n), 'number', 'B');
    return `${label}${gap || ' '}${n}`;
  });
}

// ---------- Step 5: a result that may be a misheard "non-reactive" ----------
const TEST_NAME = /\b(?:hiv|vdrl|bdrl|wdrl|rpr|tpha|hcv|hbsag|hbs\s*ag|ict|australia\s+antigen|hepatitis\s+[bc]|hep\s+[bc])\b/i;
// "none/nan reactive" after a test name is "non-reactive" (tier A). "none positive", "known reactive" or "on reactive"
// are left as heard, and dictation.js asks both ways; a reactive or positive result is never ticked without a "yes".
function resultGuard(s, change) {
  return s.replace(/\b(none|nan)[\s-]*reactive\b/gi, (all, word, at, str) => {
    const from = Math.max(str.lastIndexOf(',', at - 1), str.lastIndexOf(';', at - 1), str.lastIndexOf('.', at - 1)) + 1;
    if (!TEST_NAME.test(str.slice(from, at))) return all;
    change(all, 'non-reactive', 'result', 'A');
    return 'non-reactive';
  });
}

// ---------- Step 6: letters said one by one, and letter names ----------
// Known short forms (plus Rh and HBsAg). Titles, "OK", "am" and "pm" are never made from letters.
const DECODE_FORMS = new Set([...SHORT_FORMS, 'RH', 'HBSAG'].filter((f) => !['DR', 'MR', 'MRS', 'SMT', 'KUM', 'OK', 'NA', 'AM', 'PM'].includes(f)));
const DECODED = { RH: 'Rh', HBSAG: 'HBsAg' };
function letterToken(raw, forms) {
  const w = raw.replace(/[,;:!?]+$/, '').replace(/\.$/, '');
  if (!w || /[^A-Za-z]/.test(w)) return null;
  const low = w.toLowerCase();
  if (w.length === 1) return { letters: w.toUpperCase(), weak: /^[ai]$/i.test(w), single: true };
  if (LETTER_NAMES.strong[low]) return { letters: LETTER_NAMES.strong[low], word: true };
  if (LETTER_NAMES.weak[low]) return { letters: LETTER_NAMES.weak[low], weak: true, word: true };
  // two or three capitals as Chrome writes them ("LS CS", "OG TT", "VD RL")
  if (/^[A-Z]{2,3}$/.test(w)) return { letters: w, chunk: true, known: forms.has(w) };
  return null;
}
// A name within 3 words before or after tokens [from, to), with only words that could be part of it in between (a
// number or another detail ends a name: "name Farzana Khan age 25 E D D …" is not near it)
function nearName(toks, from, to) {
  const ends = (t) => /\d|[,.;:!?]$/.test(t.raw) || NAME_END.has(bare(t.raw));
  for (let k = from - 1; k >= Math.max(0, from - 3); k -= 1) {
    if (toks[k].name) return true;
    if (ends(toks[k])) break;
  }
  for (let k = to; k < Math.min(toks.length, to + 3); k += 1) {
    if (toks[k].name) return true;
    if (ends(toks[k])) break;
  }
  return false;
}
// Returns the text with the letters joined; `spelled`: short forms of 2 letters made from separate letters ("T B"),
// which may be a name's initials (dictation.js asks before ticking them).
function decodeMasked(s, forms, isName, change, spelled) {
  const toks = [...s.matchAll(/\S+/g)].map((m) => ({ raw: m[0], at: m.index, info: letterToken(m[0], forms), name: isName(m[0]) }));
  // "double D" is D D
  for (let i = 0; i + 1 < toks.length; i += 1) {
    if (/^double$/i.test(toks[i].raw) && toks[i + 1].info && !toks[i + 1].info.chunk) {
      toks[i].info = { ...toks[i + 1].info, letters: toks[i + 1].info.letters.repeat(2), word: true };
      toks[i].raw = `${toks[i].raw} ${toks[i + 1].raw}`;
      toks.splice(i + 1, 1);
    }
  }
  const edits = [];
  for (let i = 0; i < toks.length; ) {
    const first = toks[i].info;
    let found = null;
    if (first && !(first.weak && first.single)) {
      for (let n = Math.min(6, toks.length - i); n >= 2 && !found; n -= 1) {
        const win = toks.slice(i, i + n);
        if (win.some((t) => !t.info) || win.slice(0, -1).some((t) => /[,;:!?]$|[^A-Za-z]\.$|[A-Za-z]{2,}\.$/.test(t.raw))) continue;
        const letters = win.map((t) => t.info.letters).join('');
        if (!forms.has(letters)) continue;
        const weak = win.filter((t) => t.info.weak).length;
        const strong = win.filter((t) => !t.info.weak).reduce((k, t) => k + t.info.letters.length, 0);
        if (weak > strong) continue;
        // "MS B" is not MSB: a known short form is joined only with other capitals or letter names
        if (win.some((t) => t.info.known) && win.some((t) => t.info.single)) continue;
        // never within 3 words of a name ("K P Sreeja", "Lakshmi K P")
        if (nearName(toks, i, i + n)) continue;
        found = { n, letters, win };
      }
    }
    if (!found) {
      i += 1;
      continue;
    }
    const last = found.win.at(-1);
    const end = last.at + last.raw.replace(/[,;:!?.]+$/, '').length;
    const said = s.slice(toks[i].at, end);
    const to = DECODED[found.letters] ?? found.letters;
    edits.push([toks[i].at, end, to]);
    if (found.letters.length === 2) spelled.add(found.letters);
    // letters said plainly ("l s c s", "T B") are not a correction; letter names and split capitals are
    if (found.win.some((t) => t.info.word || t.info.chunk)) change(said, to, 'letters', 'A');
    i += found.n;
  }
  let out = s;
  for (const [a, b, to] of edits.reverse()) out = out.slice(0, a) + to + out.slice(b);
  return out;
}

/**
 * Letters said one by one or as letter names ("l s c s", "else CS", "are H", "E double D", "L S C yes") → the short
 * form, only when it is one the app knows (plan 2.3 step 6). Weak words (are, our, see, be, you, yes, age, and, in, a,
 * I, yem, yel) count only in a group with more real letters than weak words, so "you are" and "age I V" stay as said.
 * Never within 3 words of a name. `shortForms`: the short forms (in capitals) that may be made. Returns { text, changes,
 * questions: [], spelled: [2-letter short forms] } – a 2-letter one that would tick a finding is asked by dictation.js.
 */
export function decodeLetters(text, shortForms = DECODE_FORMS, spans = []) {
  const m = maskParts(String(text ?? ''), spans, []);
  const changes = [];
  const spelled = new Set();
  const forms = shortForms instanceof Set ? shortForms : new Set(shortForms);
  const out = decodeMasked(m.text, forms, m.isName, (heard, to, rule, tier) => changes.push({ heard: m.restore(heard), to, rule, tier }), spelled);
  return { text: m.restore(out), changes, questions: [], spelled: [...spelled] };
}

// ---------- Step 7: numbers and months said with an accent ----------
const NUMERIC_LABEL = new Set('age aged gravida para living abortion abortions weight weighs height number ward room bed flat house plot sector pog hb'.split(' '));
// `labels`: the labels after which the word is a number ('numeric': any numeric label)
function numberContext(s, start, end, labels) {
  if (isNumberish(wordBefore(s, start)) || isNumberish(wordAfter(s, end))) return true;
  const from = Math.max(0, start - 30);
  const lead = s.slice(from, start).match(/([a-z]+)\s*(?:(?:is|of|was|:|-|=)\s*)?$/i);
  const label = lead?.[1].toLowerCase();
  // "flat no tree", "house no. tree"
  if (labels === 'numeric' && /\b(?:flat|house|plot|room|ward|bed|sector)\s+no\.?\s*$/i.test(s.slice(from, start))) return true;
  if (!label || (labels !== 'numeric' && !labels.includes(label))) return false;
  // a formula letter: another part of the formula said before the letter, or after the number ("L do A hero")
  return /^[gpla]$/.test(label) ? formulaAround(s, from + lead.index, end) : labels !== 'numeric' || NUMERIC_LABEL.has(label);
}
const ACCENT_NUMBER_RX = new RegExp(`\\b(?:${wordsAlt(Object.keys(ACCENT_NUMBER_WORDS))})\\b`, 'gi');
const MONTH_SPELLING_RX = new RegExp(`\\b(?:${wordsAlt(Object.keys(MONTH_SPELLINGS))})\\b`, 'gi');
function accentNumbers(s, change) {
  const t = s
    .replace(ACCENT_NUMBER_RX, (w, at, str) => {
      const e = ACCENT_NUMBER_WORDS[w.toLowerCase()];
      if (e.tier === 'B' && !numberContext(str, at, at + w.length, e.labels)) return w;
      change(w, e.to, 'number', e.tier);
      // "20 tree" (a ten already written as digits) is 23
      return DIGIT_WORD[e.to] && /^[2-9]0$/.test(wordBefore(str, at)) ? `\u0002${e.to}` : e.to;
    })
    .replace(/\b([2-9])0\s+\u0002([a-z]+)/g, (_, ten, unit) => `${ten}${DIGIT_WORD[unit]}`)
    .replace(/\u0002/g, '');
  return t.replace(MONTH_SPELLING_RX, (w) => {
    change(w, MONTH_SPELLINGS[w.toLowerCase()], 'month', 'A');
    return MONTH_SPELLINGS[w.toLowerCase()];
  });
}

// ---------- Step 8: the lookup table ----------
const before = (s, at, n = 40) => s.slice(Math.max(0, at - n), at);
// The part of the sentence around [start, end), between commas, full stops or semicolons
const clauseAround = (s, start, end) => {
  const from = Math.max(s.lastIndexOf(',', start - 1), s.lastIndexOf(';', start - 1), s.lastIndexOf('.', start - 1)) + 1;
  const to = s.slice(end).search(/[,.;]/);
  return s.slice(from, to < 0 ? s.length : end + to);
};
const NUMBER_NEXT = new RegExp(`^\\s*(?:is|of|:|-|=)?\\s*(?:\\d|(?:${NUMBER_ALT})\\b)`, 'i');
const DATE_NEXT = new RegExp(`^\\s*(?:(?:is|on|was|by|of|:|-)\\s+)?(?:\\d|(?:${NUMBER_ALT}|${wordsAlt([...ORDINAL_WORDS, ...MONTH_NAMES])})\\b)`, 'i');
const CS_WORD = String.raw`(?:lscs|cs|c-?\s?sections?|caesareans?|cesareans?|caesarians?|cesarians?|scars?)`;
const CS_ANCHOR = new RegExp(`\\b(?:previous|prior|post|repeat|by|emergency|elective|\\d+|${wordsAlt(Object.keys(DIGIT_WORD))})\\s+$`, 'i');
// Words said straight before the name of an illness ("known case of", "k/c/o", "h/o", "history of", "diagnosed with")
const ILLNESS_BEFORE = /\b(?:known\s+case\s+of|k\s*\/?\s*c\s*\/?\s*o|h\s*\/\s*o|history\s+of|diagnosed\s+(?:with|as)|treated\s+for)\s+$/i;
const BLOOD_GROUP_BEFORE = /\b(?:blood\s*(?:group|type|grp)|group|grp|bg)\s*(?:is|:|-)?\s*$/i;
// "NTD" after a baby or history word is the baby's neural tube defect ("previous baby NTD", "h/o NTD", "with NTD")
const NTD_HISTORY_BEFORE = /\b(?:baby|babies|child|children|sibling|f(?:o)?etus|pregnancy|pregnancies|previous|prior|last|h\s*\/\s*o|history\s+of|known\s+case\s+of|k\s*\/?\s*c\s*\/?\s*o|with|had|has|risk\s+of|for|of|no)\s+$/i;
// Anti-D only when "given", "injection", "dose", "due" … ends what was said, or a time or the next detail follows ("given
// at 28 weeks", "due after delivery", "given HIV non-reactive") – never "given folic acid" or "due to low folate"
const ANTI_D_THEN = new RegExp(
  String.raw`^\s+(?:given|injection|inj|dose|administered|taken|due)(?:\s+(?:dose|due|given|today|yesterday|stat|postpartum|postnatal|antenatal))*` +
    String.raw`(?:\s*$|\s*[,.;]|\s+(?:at|in|on|by|after|within)\s+(?:\d|delivery|birth)|\s+\d|` +
    String.raw`\s+(?:hiv|hbs\w*|vdrl|ict|dct|coombs|blood|bp|weight|height|lmp|edd|mobile|phone|age|gravida|tt|td|tdap)\b)`,
  'i',
);
const FORMULA_IN = new RegExp(`\\b(?:${FORMULA_WORD})\\b|\\b[gp]\\s*-?\\s*(?:\\d|(?:${NUMBER_ALT})\\b)`, 'i');
const TIME_AFTER_WEIGHT = /^\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|for|till|until)\b/i;
const waitKg = (m) => Number(m[1]);
const waitIsWeight = (m, s, at, end) => !TIME_AFTER_WEIGHT.test(s.slice(end)) && (Boolean(m[2]) || (waitKg(m) >= 30 && waitKg(m) <= 150));
// Tubectomy said the Indian way ("family planning operation", "TL operation", "tube operation", "nasbandi")
const STERILISATION_SAID = /\b(?:(?:family\s+planning|tube|tl)\s+operation|nasbandi)\b/gi;
const STERILISATION_DONE = /\b(?:done|previous|prior|past|h\s*\/\s*o|history\s+of|s\s*\/\s*p|status\s+post|underwent|had|operated|(?:19|20)\d\d|years?\s+(?:back|ago)|ho\s+(?:chuki|gayi|gaya))\b/i;
// Planned, advised or counselled is a future operation; the husband's "family planning operation" is a vasectomy
const STERILISATION_NOT_DONE = /\b(?:husband|pati|partner|counsell?(?:ed|ing)?|plan(?:ned|s)?|wants?|wanted|willing|desires?|advised?|consent(?:ed)?|for|posted|will|to\s+be|refused)\b/i;
// 'done', 'no' (planned, or the husband's) or 'unsure', from the words close before and after it
function sterilisation(s, at, end) {
  const near = `${before(s, at, 40)} ${s.slice(end, end + 30)}`;
  const clause = clauseAround(s, at, end);
  const text = clause.length < near.length ? clause : near;
  if (STERILISATION_NOT_DONE.test(text)) return 'no';
  return STERILISATION_DONE.test(text) ? 'done' : 'unsure';
}

/**
 * The lookup table (plan 2.3 step 8, research-accents.md §7e): { rx, to, tier, anchor?, only?, not?, stage?, value?,
 * why }. `to`: the text put in (a string, or a function of the match); for tier C the word suggested. `anchor(m, s,
 * start, end)`: tier B and C rows apply only when it holds. `stage: 'digits'`: read after numbers said as words
 * became digits (fixAfterDigits). `value(m)`: a C question answered with a value (used on this page only).
 * `remember: false`: a C question that never offers Remember.
 */
export const LOOKUPS = [
  // Caesarean (moved here from dictation.js, Task 1)
  { rx: /\b(?:sizerian|sizarian|sizerean|sezarian|sezerian|sijerian|sizeriyan|sisarian)(?:\s+sections?)?\b/gi, to: 'caesarean', tier: 'A', why: 'caesarean said with an Indian accent' },
  { rx: /\belse\s+c\s*s\b|\bl\s+scs\b|\bls\s+cs\b|\blcs\b/gi, to: 'LSCS', tier: 'A', why: 'LSCS heard as other words' },
  { rx: /\belsie\s+(?:s|yes|as|is)\b/gi, to: 'LSCS', tier: 'B', anchor: (m, s, at) => CS_ANCHOR.test(before(s, at)), why: '"Elsie s" is LSCS after previous, by, emergency …' },
  { rx: /\b(?:see|sea|season|seizure)\s+sections?\b/gi, to: 'caesarean', tier: 'B', anchor: (m, s, at) => CS_ANCHOR.test(before(s, at)), why: '"see section" is a caesarean after previous, by …' },
  { rx: new RegExp(`\\bprecious(?=\\s+${CS_WORD}\\b)`, 'gi'), to: 'previous', tier: 'B', why: '"precious" is "previous" before a caesarean word' },
  { rx: /\bsyrian\b/gi, to: 'caesarean', tier: 'C', anchor: (m, s, at) => /\b(?:previous|prior|by|emergency)\s+$/i.test(before(s, at)), why: '"Syrian" is a word: asked (dictation.js)' },
  // Rh and anti-D
  { rx: /\b(?:are|our|aar|r)\s+(?:h|edge|etch|aitch|haitch)\b(?=\s*(?:positive|negative|factor|\+|-))/gi, to: 'Rh', tier: 'A', why: 'Rh said as letters' },
  {
    rx: /\bour(?=\s+(?:positive|negative)\b)/gi,
    to: 'Rh',
    tier: 'B',
    anchor: (m, s, at) => /\b(?:a|b|ab|o)\s+$/i.test(before(s, at, 4)) && /\b(?:blood|group|grp|bg)\b/i.test(before(s, at)),
    why: '"our negative" after a blood group is Rh negative',
  },
  { rx: /\b(?:auntie|aunty)[\s-]*(?:d|de|dee)\b|\banti[\s-]+(?:de|dee|the)\b/gi, to: 'anti-D', tier: 'A', why: 'anti-D heard as other words' },
  { rx: /\bandy[\s-]+d(\s+given)?\b/gi, to: (m) => (m[1] ? 'anti-D given' : 'anti-D'), tier: 'C', why: '"Andy D" may be anti-D' },
  // Chrome writes "NTD" (neural tube defect) for "anti D": anti-D only straight before "given", "injection", "dose" …
  // with a time or nothing after ("previous baby with NTD", "NTD given folic acid", "NTD scan" and "no NTD" stay as said)
  { rx: /\bN\.?\s?T\.?\s?D\b\.?/gi, to: 'anti-D', tier: 'B', anchor: (m, s, at, end) => !NTD_HISTORY_BEFORE.test(before(s, at)) && ANTI_D_THEN.test(s.slice(end)), why: '"NTD given" is anti-D given' },
  // Tests
  { rx: /\b(?:bdrl|wdrl)\b|\bvd\s+rl\b/gi, to: 'VDRL', tier: 'A', why: 'VDRL with v heard as b or w' },
  { rx: /\b(?:etch|edge|aitch|haitch)\s+(?:i\s*v|iv)\b/gi, to: 'HIV', tier: 'A', why: 'HIV said as letters' },
  {
    rx: /\bh\s*i\s*b\b/gi,
    to: 'HIV',
    tier: 'B',
    not: ['newborn'],
    anchor: (m, s, at, end) => /^\s*(?:\S+\s+)?(?:non[\s-]?reactive|reactive|positive|negative)\b/i.test(s.slice(end)),
    why: '"HIB" with a result is HIV (the Hib vaccine is for babies)',
  },
  { rx: /\b(?:h\s*b\s*s\s+a\s*g|(?:edge|etch)\s+b\s*s\s+ag|hbs\s+antigen)\b/gi, to: 'HBsAg', tier: 'A', why: 'HBsAg said as letters' },
  { rx: /\bg\s+d\s+n\b|\bgdn\b|\bg\s+dm\b/gi, to: 'GDM', tier: 'A', why: 'GDM with m heard as n' },
  { rx: /\b(?:o\s+g\s+t\s+t|og\s+tt|ogt|oh\s+gtt)\b/gi, to: 'OGTT', tier: 'A', why: 'OGTT heard in parts' },
  { rx: /\bt\s*s\s+(?:edge|etch|aitch)\b|\btea\s+s\s*h\b/gi, to: 'TSH', tier: 'A', why: 'TSH said as letters' },
  { rx: /\b(?:e\s+d\s+d|ed\s+d)\b/gi, to: 'EDD', tier: 'A', why: 'EDD heard in parts' },
  { rx: /\b(?:eddie|yeddie)\b/gi, to: 'EDD', tier: 'B', anchor: (m, s, at, end) => DATE_NEXT.test(s.slice(end)), why: '"Eddie" before a date is EDD' },
  { rx: /\bl\s+[mn]\s+p\b|\blnp\b|\belampi\b|\byel\s+yem\s+p(?:ee)?\b|\bel\s+em\s+pee\b/gi, to: 'LMP', tier: 'A', why: 'LMP said as letters' },
  { rx: /\bl\s+and\s+p\b/gi, to: 'LMP', tier: 'B', anchor: (m, s, at, end) => DATE_NEXT.test(s.slice(end)), why: '"L and P" before a date is LMP' },
  { rx: /\b(?:u\s+s\s+g|you\s+s\s*g|us\s+g)\b/gi, to: 'USG', tier: 'A', why: 'USG said as letters' },
  { rx: /\b(?:and|an|en|n)\s+t(?=\s+scan\b)/gi, to: 'NT', tier: 'A', why: 'NT scan heard as "and T scan"' },
  { rx: /\b(?:empty|enter|anti)\s+scan\b/gi, to: 'NT scan', tier: 'C', why: 'may be the NT scan' },
  { rx: /\b(?:a\s+normally|abnormally)\s+scan\b/gi, to: 'anomaly scan', tier: 'B', why: 'anomaly scan heard as other words' },
  { rx: /\banimal(?:ly)?\s+scan\b/gi, to: 'anomaly scan', tier: 'C', why: 'may be the anomaly scan' },
  { rx: /\btif+a\b/gi, to: 'TIFFA', tier: 'A', why: 'TIFFA (targeted anomaly scan)' },
  // Close short forms: one confusable letter (b/p, d/t, g/k/c, m/n) – asked only. TT and Td are never swapped.
  { rx: /\b(?:cdm|kdm|gtm)\b/gi, to: 'GDM', tier: 'C', why: 'g heard as c or k, d as t' },
  { rx: /\bdsh\b/gi, to: 'TSH', tier: 'C', why: 't heard as d' },
  { rx: /\boktt\b/gi, to: 'OGTT', tier: 'C', why: 'g heard as k' },
  { rx: /\bbih\b/gi, to: 'PIH', tier: 'C', why: 'p heard as b' },
  { rx: /\bbbh\b/gi, to: 'PPH', tier: 'C', why: 'p heard as b' },
  { rx: /\bBOG\b/g, to: 'POG', tier: 'C', why: 'p heard as b' },
  { rx: /\btipsy\b/gi, to: 'DIPSI', tier: 'C', anchor: (m, s, at, end) => /\btests?\b/i.test(s.slice(Math.max(0, at - 20), end + 20)), why: 'd heard as t, near "test"' },
  // Findings and words
  { rx: /\b(?:pie|pi)\s+(?:(?:i|eye)\s+)?(?:h|edge|etch|aitch)\b/gi, to: 'PIH', tier: 'A', why: 'PIH said as letters' },
  { rx: /\bhyper\s+tension\b|\bhypertention\b/gi, to: 'hypertension', tier: 'A', why: 'hypertension heard in parts' },
  { rx: /\bhypo\s*t(?:h)?yroid(ism)?\b/gi, to: (m) => `hypothyroid${m[1] ?? ''}`, tier: 'A', why: 'hypothyroid heard in parts (never hyper)' },
  { rx: /\bhyper\s*t(?:h)?yroid(ism)?\b/gi, to: (m) => `hyperthyroid${m[1] ?? ''}`, tier: 'A', why: 'hyperthyroid heard in parts (never hypo)' },
  { rx: /\bt(?:ai|hai|y)roid\b/gi, to: 'thyroid', tier: 'A', why: 'thyroid said with an accent' },
  // "tired" is a word: asked, only straight after a word that names an illness ("known case of tired")
  { rx: /\btired\b/gi, to: 'thyroid', tier: 'C', anchor: (m, s, at) => ILLNESS_BEFORE.test(before(s, at)), why: '"tired" after "known case of" may be thyroid' },
  // (p and b sound alike to the sound key, so "pibroid" is too far from fibroid to be matched by sound)
  { rx: /\bpibroid(s?)\b/gi, to: (m) => `fibroid${m[1] ?? ''}`, tier: 'A', why: 'fibroid said with f as p' },
  { rx: /\btyronorm\b|\bthyro\s+norm\b/gi, to: 'Thyronorm', tier: 'A', why: 'Thyronorm said with an accent' },
  { rx: /\beltroxine\b|\bel\s+troxin\b/gi, to: 'Eltroxin', tier: 'A', why: 'Eltroxin said with an accent' },
  { rx: /\bthairox\b/gi, to: 'Thyrox', tier: 'A', why: 'Thyrox said with an accent' },
  { rx: /\boligo\s*hydr[a-z]*\b|\boligo\s+hydro\s+amnios\b/gi, to: 'oligohydramnios', tier: 'A', why: 'oligohydramnios (never poly)' },
  { rx: /\bpol[iy]\s*hydr[a-z]*\b|\bpoly\s+hydro\s+amnios\b/gi, to: 'polyhydramnios', tier: 'A', why: 'polyhydramnios (never oligo)' },
  { rx: /\bplacenta\s+(?:privia|pravia|brevia|pre\s+via)\b/gi, to: 'placenta praevia', tier: 'A', why: 'praevia said with an accent' },
  { rx: /\blow\s+line\s+placenta\b/gi, to: 'low lying placenta', tier: 'A', why: '"low lying" heard as "low line"' },
  { rx: /\bpre[\s-]*e?(?:clampshia|clamshia|klampsia)\b/gi, to: 'pre-eclampsia', tier: 'A', why: 'pre-eclampsia said with an accent' },
  // ("eclamsia", one letter from the word, is still asked "Did you mean …?" as before)
  { rx: /\b(?:eclampshia|eclamshia|eklampsia)\b/gi, to: 'eclampsia', tier: 'A', why: 'eclampsia said with an accent' },
  { rx: /\b(?:grevida|gravita|cravida|kravida|grabida|gravid\s+a)\b/gi, to: 'gravida', tier: 'A', why: 'gravida said with an accent' },
  { rx: /\bgravity\b/gi, to: 'gravida', tier: 'B', anchor: (m, s, at, end) => NUMBER_NEXT.test(s.slice(end)), why: '"gravity" before a number is gravida' },
  {
    rx: /\bleaving\b/gi,
    to: 'living',
    tier: 'B',
    anchor: (m, s, at, end) => NUMBER_NEXT.test(s.slice(end)) && FORMULA_IN.test(clauseAround(s, at, end).replace(m[0], ' ')),
    why: '"leaving" before a number, with the formula, is living',
  },
  {
    rx: /\b(?:a\s+portion|apportion)\b/gi,
    to: 'abortion',
    tier: 'B',
    anchor: (m, s, at, end) => NUMBER_NEXT.test(s.slice(end)) || isNumberish(wordBefore(s, at)) || FORMULA_IN.test(clauseAround(s, at, end)),
    why: '"a portion" next to a number or the formula is abortion',
  },
  {
    rx: /\b(?:pera|parra|bara|barra)\b/gi,
    to: 'para',
    tier: 'B',
    anchor: (m, s, at, end) => NUMBER_NEXT.test(s.slice(end)) && /\b(?:gravida|living|g\s*-?\s*\d)/i.test(clauseAround(s, at, end)),
    why: '"bara 2" with gravida or living is para',
  },
  // Blood group letters (only after "blood group", "group" or "BG", or right before "Rh")
  { rx: /\b(?:be|bee|bi)(?=\s+(?:positive|negative|rh\b|\+\s*ve|-\s*ve))/gi, to: 'B', tier: 'B', anchor: (m, s, at, end) => BLOOD_GROUP_BEFORE.test(before(s, at, 25)) || /^\s+rh\b/i.test(s.slice(end)), why: 'B said as "be"' },
  { rx: /\b(?:oh|zero)(?=\s+(?:positive|negative)\b)/gi, to: 'O', tier: 'B', anchor: (m, s, at) => BLOOD_GROUP_BEFORE.test(before(s, at, 25)), why: 'O said as "oh"' },
  { rx: /\babby(?=\s+(?:positive|negative)\b)/gi, to: 'AB', tier: 'B', anchor: (m, s, at) => BLOOD_GROUP_BEFORE.test(before(s, at, 25)), why: 'AB said as "abby"' },
  { rx: /\b(?:hey|eh)(?=\s+(?:positive|negative)\b)/gi, to: 'A', tier: 'B', anchor: (m, s, at) => BLOOD_GROUP_BEFORE.test(before(s, at, 25)), why: 'A said as "hey"' },
  // Procedures and medicines
  { rx: /\b(?:sirklage|circlage)\b/gi, to: 'cerclage', tier: 'A', why: 'cerclage said with an accent' },
  { rx: /\b(?:sirodkar|sirodker|shirodker)\b/gi, to: 'Shirodkar', tier: 'A', why: 'Shirodkar said with an accent' },
  { rx: /\b(?:wentouse|bentouse)\b/gi, to: 'ventouse', tier: 'A', why: 'ventouse with v heard as w or b' },
  { rx: /\bvent\s+house\b/gi, to: 'ventouse', tier: 'C', why: 'may be ventouse' },
  { rx: /\b(?:pholic|polic|frolic)\s+acid\b/gi, to: 'folic acid', tier: 'A', why: 'folic acid said with an accent' },
  { rx: /\bphallic\s+acid\b/gi, to: 'folic acid', tier: 'C', why: 'may be folic acid' },
  { rx: /\bmiss?\s+carriage\b|\bmisscarriage\b/gi, to: 'miscarriage', tier: 'A', why: 'miscarriage heard in parts' },
  { rx: /\b(?:istillbirth|steel\s+birth|is\s+still\s*birth)\b/gi, to: 'stillbirth', tier: 'A', why: 'stillbirth said with an accent' },
  { rx: /\b(?:copper|cu)[\s-]+t\b/gi, to: 'Copper T', tier: 'A', why: 'Copper T' },
  // Filled only when said as already done; never when planned, advised or counselled, or said about the husband (left
  // as heard, with no question). Otherwise asked, without Remember (the next time may be a planned one).
  { rx: STERILISATION_SAID, to: 'tubectomy', tier: 'B', anchor: (m, s, at, end) => sterilisation(s, at, end) === 'done', why: 'Indian words for a tubectomy already done' },
  { rx: STERILISATION_SAID, to: 'tubectomy', tier: 'C', remember: false, anchor: (m, s, at, end) => sterilisation(s, at, end) === 'unsure', why: 'may be a tubectomy already done' },
  // Read after numbers became digits: "wait 58" is weight 58 – never "wait 2 weeks"
  { rx: /\b(?:wait|wet)\s+(\d{1,3}(?:\.\d)?)(?![\d.])(\s*(?:kg|kgs|kilos?|kilograms?)\b)?/gi, stage: 'digits', to: (m) => `weight ${m[1]}${m[2] ?? ''}`, tier: 'B', anchor: waitIsWeight, why: '"wait 58" is weight' },
  {
    rx: /\b(?:wait|wet)\s+(\d{1,3}(?:\.\d)?)(?![\d.])(\s*(?:kg|kgs|kilos?|kilograms?)\b)?/gi,
    stage: 'digits',
    to: 'weight',
    tier: 'C',
    anchor: (m, s, at, end) => !waitIsWeight(m, s, at, end) && !TIME_AFTER_WEIGHT.test(s.slice(end)) && waitKg(m) >= 15 && waitKg(m) <= 250,
    value: (m) => `value:medical.weightKg=${waitKg(m)}`,
    why: 'may be the weight',
  },
];

// Runs the lookup rows of one stage. Tier C rows add a question and leave the words as heard.
function applyLookups(s, { careType, stage }, change, ask) {
  let t = s;
  for (const row of LOOKUPS) {
    if ((row.stage ?? 'words') !== stage || (row.only && !row.only.includes(careType)) || row.not?.includes(careType)) continue;
    t = t.replace(row.rx, (...args) => {
      const hasGroups = typeof args.at(-1) === 'object';
      const str = args.at(hasGroups ? -2 : -1);
      const at = args.at(hasGroups ? -3 : -2);
      const m = args.slice(0, hasGroups ? -3 : -2);
      const end = at + m[0].length;
      if (row.anchor && !row.anchor(m, str, at, end)) return m[0];
      const to = typeof row.to === 'function' ? row.to(m) : row.to;
      if (row.tier === 'C') {
        ask({ heard: m[0], to, why: row.why, ...(row.value ? { value: row.value(m) } : {}), ...(row.remember === false ? { remember: false } : {}) });
        return m[0];
      }
      // "oligo hydramnios" → oligohydramnios is the same word, not a correction
      if (to.toLowerCase().replace(/[\s-]+/g, '') !== m[0].toLowerCase().replace(/[\s-]+/g, '')) change(m[0], to, 'lookup', row.tier);
      return to;
    });
  }
  return t;
}

// ---------- Matching words by sound (plan 2.3 step 9 and 2.5) ----------
// realWordGuard.js is made from this part of the file, the words it matches to (including the number words), the
// word lists in obgyTerms.js and testdata/ and the "Did you mean" part of dictation.js by
// client/scripts/make-word-guard.mjs; a test checks that it was made from the current ones.

// The key of a word: how it sounds, with the sounds Indian English speakers swap merged (research-accents.md §7b).
// Prefixes that make a word its opposite (hypo/hyper, oligo/poly, pre/post, micro/macro) stay as said, in front of
// the key ("hypo:TRT" is never "hyper:TRT"); their accent spellings count as the prefix ("haipo", "poli", "pri").
const SOUND_PREFIXES = [
  ['hyper', 'hyper'], ['haiper', 'hyper'], ['hiper', 'hyper'], ['hypo', 'hypo'], ['haipo', 'hypo'], ['hipo', 'hypo'], ['oligo', 'oligo'],
  ['poly', 'poly'], ['poli', 'poly'], ['micro', 'micro'], ['macro', 'macro'], ['post', 'post'], ['pre', 'pre'], ['pri', 'pre'],
];
const lettersOf = (w) => String(w ?? '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
function splitPrefix(w) {
  for (const [said, is] of SOUND_PREFIXES) if (w.startsWith(said) && w.length - said.length >= 3) return [is, w.slice(said.length)];
  return ['', w];
}
const VOWEL = /[aeiouy]/;
// The consonant sounds of a word, as capitals (vowels count only at the start)
function soundKey(word) {
  const w = lettersOf(word)
    .replace(/^[ie]s(?=[ptkmnlcfw])/, 's') // "ischool", "istillbirth": the extra vowel before s
    .replace(/^(?:kn|gn|pn|mn)/, (m) => m[1])
    .replace(/^ps(?=[aeiouy])/, 's')
    .replace(/^wr/, 'r')
    .replace(/mp(?=[st])/g, 'm') // "eclamsia" = eclampsia
    .replace(/^cae|^coe/, 'se')
    .replace(/ae|oe/g, 'e') // caesarean, haemoglobin, oedema
    .replace(/^y(?=e[ilx])/, '') // "yeleven", "yeight"
    .replace(/^v(?=on)/, '') // "vonly"
    .replace(/sph/g, 'sp'); // "azoosphermia"
  const out = [];
  for (let i = 0; i < w.length; i += 1) {
    const c = w[i];
    const n = w[i + 1] ?? '';
    let k = '';
    if (VOWEL.test(c)) k = i === 0 ? 'A' : '';
    else if (c === 'p' && n === 'h') [k, i] = ['F', i + 1];
    else if ((c === 't' || c === 'd') && n === 'h') [k, i] = ['T', i + 1];
    else if (c === 'b' && n === 'h') [k, i] = ['P', i + 1];
    else if (c === 'k' && n === 'h') [k, i] = ['K', i + 1];
    else if (c === 'g' && n === 'h') [k, i] = [i === 0 ? 'K' : '', i + 1];
    else if (c === 's' && n === 'h') [k, i] = ['S', i + 1];
    else if (c === 'w' && n === 'h') [k, i] = ['V', i + 1];
    else if (c === 'c' && n === 'h') [k, i] = [/[rl]/.test(w[i + 2] ?? '') || (i === 0 && /^cho[lr]/.test(w)) ? 'K' : 'J', i + 1];
    else if (c === 'c') k = /[eiy]/.test(n) ? 'S' : 'K';
    else if (c === 'q') k = 'K';
    else if (c === 'x') k = i === 0 ? 'S' : 'KS';
    else if (c === 'g') k = /[eiy]/.test(n) && i > 0 ? 'J' : 'K';
    else if (c === 'j') k = 'J';
    else if (c === 'z') k = 'S';
    else if (c === 't' && /^i[ao]n/.test(w.slice(i + 1))) k = 'S'; // -tion
    else if (c === 't' || c === 'd') k = 'T'; // t, d, th, dh: one sound (retroflex, Dravidian voicing)
    else if (c === 'b' || c === 'p') k = 'P'; // p, b (Tamil voicing); f is kept apart
    else if (c === 'k') k = 'K';
    else if (c === 'v' || c === 'w') k = 'V';
    else if (c === 'f') k = 'F';
    else if (c === 's') k = 'S';
    else if (c === 'h') k = ''; // h dropped or added
    else if (c === 'r') k = VOWEL.test(n) || n === 'l' || i === 0 ? 'R' : ''; // r not said before a consonant ("sterlisation" keeps it)
    else if (c === 'n' && n === 'g') [k, i] = ['N', i + 1];
    else if (c === 'm' || c === 'n') k = c.toUpperCase();
    else if (c === 'l') k = 'L';
    if (k && (k !== out.at(-1) || k.length > 1)) out.push(k);
  }
  return out.join('');
}

/** How a word sounds: "prefix:KEY" ("hypotyroid" → "hypo:TRT", "pibroid" → ":PRT"). */
export function indiKey(word) {
  const [prefix, rest] = splitPrefix(lettersOf(word));
  return `${prefix}:${soundKey(rest)}`;
}

// The sounds Indian English speakers swap (plan 2.5, research §7b step 8): each is tried on the word heard as an extra
// look-up, never as a looser key. b→v (Bengali, Odia, Assamese), p/ph→f (Gujarati, Marathi, Tamil "pibroid"), j↔z
// (Assamese, Telugu, Hindi belt "zondis"), s↔sh, ch↔s (Assamese), l↔r (North-East).
const SWAPS = [
  [/b/g, 'v'], [/ph|p/g, 'f'], [/j/g, 'z'], [/z/g, 'j'], [/sh/g, 's'], [/s(?!h)/g, 'sh'], [/ch/g, 's'], [/s(?!h)/g, 'ch'], [/l/g, 'r'], [/r/g, 'l'],
];
/** The keys a word may have been said with: its own and one for each swap (every place, and each place alone). */
export function keyVariants(word) {
  const w = lettersOf(word);
  const said = new Set([w]);
  for (const [rx, to] of SWAPS) {
    const places = [...w.matchAll(rx)];
    if (!places.length) continue;
    said.add(w.replace(rx, to));
    if (places.length > 1) for (const m of places) said.add(w.slice(0, m.index) + to + w.slice(m.index + m[0].length));
  }
  return [...new Set([...said].map(indiKey))];
}

// Accent-weighted Damerau–Levenshtein distance: the Indian English sound pairs cost little (research §7b step 9)
const CHEAP = [
  ['v', 'w', 0.2], ['v', 'b', 0.5], ['w', 'b', 0.6], ['t', 'd', 0.4], ['p', 'b', 0.4], ['k', 'g', 0.4], ['f', 'p', 0.5], ['z', 'j', 0.3], ['s', 'z', 0.4],
  ['c', 'k', 0.1], ['c', 's', 0.3], ['q', 'k', 0.1], ['i', 'e', 0.3], ['i', 'y', 0.2], ['a', 'e', 0.4], ['o', 'u', 0.4], ['a', 'o', 0.5], ['e', 'y', 0.4],
  ['l', 'r', 0.8], ['m', 'n', 0.6],
];
const SUB = new Map(CHEAP.flatMap(([a, b, cost]) => [[a + b, cost], [b + a, cost]]));
const CHEAP_GAP = new Set(['h', 'e', 'a', 'i', 'o', 'u', 'y', 'r']); // h dropped or added, vowels, r not said
/** How far apart two words sound (0: the same). */
export function accentDistance(a, b) {
  const x = lettersOf(a);
  const y = lettersOf(b);
  const gap = (ch) => (CHEAP_GAP.has(ch) ? 0.5 : 1);
  const d = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i += 1) d[i][0] = d[i - 1][0] + gap(x[i - 1]);
  for (let j = 1; j <= y.length; j += 1) d[0][j] = d[0][j - 1] + gap(y[j - 1]);
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const p = x[i - 1];
      const q = y[j - 1];
      d[i][j] = Math.min(d[i - 1][j] + gap(p), d[i][j - 1] + gap(q), d[i - 1][j - 1] + (p === q ? 0 : (SUB.get(p + q) ?? 1)));
      if (i > 1 && j > 1 && p === y[j - 2] && x[i - 2] === q) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      if (i > 1 && p === x[i - 2]) d[i][j] = Math.min(d[i][j], d[i - 1][j] + 0.1); // a doubled letter
      if (j > 1 && q === y[j - 2]) d[i][j] = Math.min(d[i][j], d[i][j - 1] + 0.1);
    }
  }
  return Math.round(d[x.length][y.length] * 100) / 100;
}

// British and American spellings are one word: "anaemia" = "anemia", "sterilisation" = "sterilization"
const SAME_AS = new Map(SAME_SPELLING.flatMap(([uk, us]) => [[uk, us], [us, us]]));
const spelling = (plain) => SAME_AS.get(plain) ?? plain.replace(/ae|oe/g, 'e').replace(/is(e|ed|es|ing|ation|ations)$/, 'iz$1');

// Words that must never be corrected into each other automatically: at most asked (plan 2.5). A word ending in "-" is
// a prefix. Also numbers that sound alike: -teen and -ty ("fourteen" / "forty"), and a unit with its -ty ("eight" /
// "eighty").
export const NEVER_AUTO_PAIRS = [
  ['hysterotomy', 'hysterectomy'], ['rheumatic', 'rheumatoid'], ['hepatitis B', 'hepatitis C'], ['hepatitis B', 'hepatitis E'], ['hepatitis C', 'hepatitis E'],
  ['thalassaemia minor', 'thalassaemia major'], ['thalassemia minor', 'thalassemia major'], ['decreased', 'increased'], ['placenta previa', 'placenta accreta'],
  ['placenta praevia', 'placenta accreta'], ['abortion', 'abruption'], ['IVF', 'IUI'], ['normal', 'abnormal'], ['stable', 'unstable'], ['reactive', 'non-reactive'],
  ['positive', 'negative'], ['fatal', 'fetal'], ['endometrium', 'endometrioma'], ['type 1', 'type 2'], ['hypo-', 'hyper-'], ['oligo-', 'poly-'], ['pre-', 'post-'],
  ['micro-', 'macro-'],
  ...['thir', 'four', 'fif', 'six', 'seven', 'eigh', 'nine'].map((n) => [`${n}teen`, `${n === 'four' ? 'for' : n}ty`]),
  ['six', 'sixty'], ['seven', 'seventy'], ['eight', 'eighty'], ['nine', 'ninety'],
];
const NEVER_WITH = new Map();
for (const [a, b] of NEVER_AUTO_PAIRS.filter(([x]) => !x.endsWith('-'))) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const k = spelling(lettersOf(x));
    NEVER_WITH.set(k, [...(NEVER_WITH.get(k) ?? []), y]);
  }
}

// Weak prefixes that make a word its opposite: a word is never matched to the same word with one of them added,
// dropped or swapped ("normel" is not abnormal, "creased" not increased or decreased)
const OPPOSITE_STARTS = [['un', ''], ['ab', ''], ['a', ''], ['dys', ''], ['non', ''], ['anti', ''], ['in', ''], ['de', ''], ['in', 'de']];
function prefixClash(a, b) {
  for (const [p, q] of OPPOSITE_STARTS) {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!x.startsWith(p) || x.length - p.length < 3 || (q ? !y.startsWith(q) : y.startsWith(p))) continue;
      if (soundKey(x.slice(p.length)) === soundKey(q ? y.slice(q.length) : y)) return true;
    }
  }
  return false;
}

// The words matched by sound: every way of saying a term (its meaning: the term's), EXTRA_VOCAB, and number and month
// words. Short forms (capitals) and words under 4 letters are never matched. Built once.
const MONTH_WORDS = 'january february march april june july august september october november december'.split(' ');
let vocabulary = null;
/**
 * { words: Map(plain → { word, plain, meaning, kind }), phrases: [{ said, words: [plain…], fixed: [only said exactly…],
 * meaning }], byKey, byDrop, phraseWords, spellings }. kind: 'term', 'word' (EXTRA_VOCAB), 'number' or 'month'. byDrop:
 * the words by their key without its last sound (a last consonant not said). phraseWords: the words of the phrases, by
 * key. spellings: the words, with British and American spellings as one.
 */
export function soundVocabulary() {
  if (vocabulary) return vocabulary;
  const words = new Map();
  const phrases = [];
  const add = (said, meaning, kind) => {
    const parts = said.trim().split(/\s+/);
    if (parts.length > 1) {
      // a short form or a number in a phrase is only ever said exactly ("APLA syndrome", "type 1 DM")
      const fixed = parts.map((x) => /[A-Z].*[A-Z]|\d/.test(x) || lettersOf(x).length < 4);
      if (!phrases.some((p) => p.said.toLowerCase() === said.toLowerCase())) phrases.push({ said, words: parts.map(lettersOf), fixed, meaning, kind });
      return;
    }
    const plain = lettersOf(said);
    if (plain.length < 4 || /\d/.test(said) || /^[A-Z0-9]{2,7}$/.test(said.replace(/[-'.]/g, '')) || /[A-Z].*[A-Z]/.test(said)) return;
    const had = words.get(plain);
    if (had && had.kind === 'term') return;
    words.set(plain, { word: said, plain, meaning: had?.kind === 'term' ? had.meaning : meaning, kind });
  };
  for (const t of TERMS) for (const say of t.says) add(say, t.to, 'term');
  const termMeaning = new Map([...words.values()].map((e) => [spelling(e.plain), e.meaning]));
  for (const w of EXTRA_VOCAB) add(w, termMeaning.get(spelling(lettersOf(w))) ?? `word:${spelling(lettersOf(w))}`, 'word');
  for (const w of ENGLISH_NUMBERS) add(w, `number:${w}`, 'number');
  for (const w of MONTH_WORDS) add(w, `month:${w}`, 'month');
  const byKey = new Map();
  const byDrop = new Map();
  const index = (map, k, e) => map.set(k, [...(map.get(k) ?? []), e]);
  for (const e of words.values()) {
    const k = indiKey(e.plain);
    index(byKey, k, e);
    if (k.length - k.indexOf(':') - 1 >= 4) index(byDrop, k.slice(0, -1), e);
  }
  const phraseWords = new Map();
  for (const w of new Set(phrases.flatMap((p) => p.words.filter((x, k) => !p.fixed[k])))) index(phraseWords, indiKey(w), w);
  vocabulary = { words, phrases, byKey, byDrop, phraseWords, spellings: new Set([...words.keys()].map(spelling)) };
  return vocabulary;
}

// The words the word heard may be, nearest first: [{ …entry, d }], one per word (British and American spellings are
// one word)
function soundCandidates(w, vocab) {
  const found = new Map();
  for (const k of keyVariants(w)) for (const e of [...(vocab.byKey.get(k) ?? []), ...(vocab.byDrop.get(k) ?? [])]) found.set(e.plain, e);
  const nearest = new Map();
  for (const e of found.values()) {
    if (e.plain === w || prefixClash(w, e.plain)) continue;
    const c = { ...e, d: accentDistance(w, e.plain) };
    const k = spelling(e.plain);
    if (!nearest.has(k) || c.d < nearest.get(k).d) nearest.set(k, c);
  }
  return [...nearest.values()].sort((a, b) => a.d - b.d || a.plain.localeCompare(b.plain));
}
const autoLimit = (e) => 0.15 * e.plain.length + 0.6;
const askLimit = (e) => 0.25 * e.plain.length + 1;
// A word of NEVER_AUTO_PAIRS that the word heard may just as well be
const neverAuto = (w, best, others) =>
  (NEVER_WITH.get(spelling(best.plain)) ?? []).some((other) => {
    const o = spelling(lettersOf(other));
    return others.some((c) => spelling(c.plain) === o) || accentDistance(w, lettersOf(other)) < best.d + 1.5;
  });

// A finding that is a blood-test result (syphilis, HIV, hepatitis B) is never ticked without being confirmed (plan
// 2.6): a word matched by sound to one is asked about, never changed
const RESULT_TARGETS = new Set(TERMS.filter((t) => t.result && /^condition:(?:hiv|hepatitis_b|syphilis)$/.test(t.to)).map((t) => t.to));

// The everyday dictation words (DICTATION_WORDS in realWordGuard.js) are not matched to, but a word heard may be one of
// them said a little differently ("cephalis" is cephalic, not syphilis; "tabbets" is tablets, not diabetes): how far the
// nearest one is from `w`, looked for only up to `within`
let ordinaryWords = null;
function nearestOrdinary(w, vocab, within) {
  ordinaryWords ??= [...DICTATION_WORDS].filter((r) => !vocab.spellings.has(spelling(r)));
  let best = Infinity;
  for (const r of ordinaryWords) if (Math.abs(r.length - w.length) * 0.5 < within) best = Math.min(best, accentDistance(w, r));
  return best;
}

/**
 * The word the app knows that `token` sounds like (plan 2.5): { to, distance, mode: 'auto' | 'ask' } or null.
 * Automatic ('auto') only when the word heard is not an ordinary English word, an Indian name or place (`guard`) or a
 * common dictation word; it has at least 4 sounds; the match has the same prefix; it is close (distance ≤ 0.15 × its
 * length + 0.6); it beats the next word by 0.5 and any word that means something else by 1.5; the two are not a
 * NEVER_AUTO_PAIRS pair; it is not a blood-test result; and (with `everyday`) no everyday dictation word is within 0.5
 * of it (one as close or closer: null, not even a question). Otherwise, with a clinical `anchor` ("known case of",
 * "on", "previous" …) and a distance up to 0.25 × length + 1, 'ask' ("Did you mean …?") – ordinary words too. Never for
 * words under 4 letters or about the baby's sex.
 */
export function fuzzyTerm(token, { vocab = soundVocabulary(), guard = REAL_WORDS, anchor = false, everyday = true } = {}) {
  const raw = String(token ?? '');
  const w = lettersOf(raw);
  // (a short form in capitals is read by the short-form rules, never by sound)
  if (w.length < 4 || /[^A-Za-z'’-]/.test(raw) || /^[A-Z]{2,}$/.test(raw) || vocab.spellings.has(spelling(w)) || mentionsFetalSex(raw)) return null;
  if (soundKey(w).length < 4) return null;
  const [best, ...others] = soundCandidates(w, vocab);
  if (!best) return null;
  const ordinary = guard.has(w) || COMMON_WORDS.has(w);
  const auto =
    !ordinary &&
    best.d <= autoLimit(best) &&
    (!others.length || others[0].d - best.d >= 0.5) &&
    others.every((c) => c.meaning === best.meaning || c.d - best.d >= 1.5) &&
    !neverAuto(w, best, others);
  if (auto) {
    const near = everyday ? nearestOrdinary(w, vocab, best.d + 0.5) : Infinity;
    if (near <= best.d) return null; // most likely the everyday word
    if (near > best.d + 0.5 && !RESULT_TARGETS.has(best.meaning)) return { to: best.word, distance: best.d, mode: 'auto', kind: best.kind };
  }
  if (anchor && best.d <= askLimit(best) && (best.kind === 'term' || best.kind === 'word')) return { to: best.word, distance: best.d, mode: 'ask', kind: best.kind };
  return null;
}

// One word of a phrase the app knows, heard a little differently ("shugar in pregnancy"): same key, very close.
// `variants`: keyVariants(heard). Returns the distance, or null.
function phraseWordAlike(heard, meant, guard, variants = keyVariants(heard)) {
  if (heard === meant || heard.length < 4 || meant.length < 4 || guard.has(heard) || COMMON_WORDS.has(heard) || prefixClash(heard, meant)) return null;
  if (!variants.includes(indiKey(meant))) return null;
  const d = accentDistance(heard, meant);
  return d <= 0.6 ? d : null;
}

/**
 * Whether matching by sound would change `word` on its own (with no real-word guard and no everyday dictation words):
 * as a word, or as one word of a phrase the app knows. Used by client/scripts/make-word-guard.mjs to list the ordinary words to protect.
 */
export function changedBySound(word) {
  const none = new Set();
  const w = lettersOf(word);
  if (w.length < 4 || soundVocabulary().spellings.has(spelling(w))) return false;
  if (fuzzyTerm(w, { guard: none, everyday: false })?.mode === 'auto') return true;
  const variants = keyVariants(w);
  const { phraseWords } = soundVocabulary();
  return variants.some((k) => (phraseWords.get(k) ?? []).some((meant) => phraseWordAlike(w, meant, none, variants) !== null));
}

// A clinical word before [at] in the same sentence, within 5 words: only then is an unsure match asked (plan 2.5)
const CLINICAL_ANCHOR =
  /\b(?:known\s+case\s+of|k\s*\/\s*c(?:\s*\/?\s*o)?|h\s*\/\s*o|c\s*\/\s*o|history\s+of|(?:past|medical|obstetric)\s+history|complains?\s+of|on|diagnosed(?:\s+(?:with|as|of))?|previous|treated\s+for|s\s*\/\s*p|status\s+post)\b/gi;
/** Whether a clinical word ("known case of", "h/o", "on", "previous" …) is said before `at`, within 5 words (plan 2.5). */
export function clinicalAnchor(s, at) {
  const from = Math.max(s.lastIndexOf('.', at - 1), s.lastIndexOf(';', at - 1), s.lastIndexOf('?', at - 1)) + 1;
  const lead = s.slice(from, at);
  const last = [...lead.matchAll(CLINICAL_ANCHOR)].pop();
  return Boolean(last) && lead.slice(last.index + last[0].length).trim().split(/\s+/).filter(Boolean).length <= 5;
}

// The words of the text, with where each is: { raw, w (letters only, or '' for a number, a placeholder or a word held
// for a question), at, end, stop (punctuation after it ends a phrase) }. `held`: [start, end) ranges not to change.
function wordsOf(s, held = []) {
  return [...s.matchAll(/\S+/g)].map((m) => {
    const raw = m[0].replace(/[,.;:!?)]+$/, '');
    const end = m.index + raw.length;
    const clean = /^[A-Za-z][A-Za-z'’-]*$/.test(raw) && !held.some(([a, b]) => m.index < b && end > a);
    return { raw, w: clean ? lettersOf(raw) : '', at: m.index, end, stop: raw.length < m[0].length };
  });
}
// Where the words a lookup asked about are ("vent house" – ventouse?): left as heard for that question
const heldFor = (s, asked) =>
  asked.flatMap((heard) => [...s.matchAll(new RegExp(`(?<![A-Za-z])${escapeRx(heard).replace(/\s+/g, '\\s+')}(?![A-Za-z])`, 'gi'))].map((m) => [m.index, m.index + m[0].length]));
const SPLIT_NEVER_FIRST = new Set(['a', 'an', 'no', 'on', 'of']);
// Short words said with a word, never a piece of one when the join only sounds nearly the same
const SPLIT_NEVER_PART = new Set(['the', 'and', 'are', 'was', 'has', 'had', 'not', 'nil', 'non', 'yes', 'any', 'her', 'his', 'she', 'for', 'but', 'one', 'two', 'six', 'ten']);

// Step 9: a word the app knows said as two or three ("glyco met", "still born", "PC OD"), joined when the join is the
// word, or sounds nearly the same (distance ≤ 0.5, same prefix) and every part is a piece of a word, not a short word
// said with it ("convulsion is not there" is not "convulsions not there", "I asthma" is not asthma). Never starting
// with a, an, no, on or of – except "is" or "a" before an s-sound ("is still birth"). A Dravidian "you" said after a
// known word ("twins you") is dropped.
function joinSplitWords(s, change, held) {
  const vocab = soundVocabulary();
  const toks = wordsOf(s, held);
  const edits = [];
  const joinable = (e) => e && (e.kind === 'term' || e.kind === 'word');
  const joinOf = (parts) => {
    if (parts.some((t) => !t.w) || parts.slice(0, -1).some((t) => t.stop)) return null;
    if (parts.every((t) => /^[A-Z]+$/.test(t.raw))) {
      // capital short forms: each part at least 2 letters ("PC OD" – never "MS B")
      const joined = parts.map((t) => t.raw).join('');
      return parts.every((t) => t.raw.length >= 2) && DECODE_FORMS.has(joined) ? { to: joined, exact: true } : null;
    }
    const joined = parts.map((t) => t.w).join('');
    const exact = vocab.words.get(joined);
    if (joinable(exact)) return { to: exact.word, exact: true };
    if (parts.some((t) => t.w.length < 3 || SPLIT_NEVER_PART.has(t.w))) return null;
    const near = soundCandidates(joined, vocab).find((c) => joinable(c) && !RESULT_TARGETS.has(c.meaning) && c.d <= 0.5 && keyVariants(joined).includes(indiKey(c.plain)));
    return near ? { to: near.word, exact: false } : null;
  };
  for (let i = 0; i < toks.length; ) {
    let done = false;
    const lead = toks[i].w;
    const skip = (lead === 'is' || lead === 'a') && /^s[ptkmnlcfw]/.test(toks[i + 1]?.w ?? '') && !toks[i].stop ? 1 : 0;
    for (const n of [3, 2]) {
      const parts = toks.slice(i + skip, i + skip + n);
      if (parts.length < n || (!skip && SPLIT_NEVER_FIRST.has(lead))) continue;
      const got = joinOf(parts);
      if (!got) continue;
      const start = toks[i].at;
      const end = parts.at(-1).end;
      if (!got.exact) change(s.slice(start, end), got.to, 'sound', 'A');
      edits.push([start, end, got.to]);
      i += skip + n;
      done = true;
      break;
    }
    if (!done) i += 1;
  }
  let out = s;
  for (const [a, b, to] of edits.reverse()) out = out.slice(0, a) + to + out.slice(b);
  // "twins you", "fibroid you": the Dravidian final vowel, not a word ("… you are" is kept)
  return out.replace(/\b([A-Za-z][A-Za-z'-]{3,})\s+you\b(?!\s+are\b)/gi, (all, w) => (joinable(vocab.words.get(lettersOf(w))) ? w : all));
}

// Phrases the app knows with one word heard a little differently ("shugar in pregnancy" = sugar in pregnancy): every
// other word said exactly, and one of them a real word of 4 letters or more
function soundPhrases(s, change, guard, held) {
  const vocab = soundVocabulary();
  const toks = wordsOf(s, held);
  const edits = [];
  // the phrase said from word i with some words heard differently: { p, d, swaps: [places], n } or null
  const heardAs = (i, p) => {
    const win = toks.slice(i, i + p.words.length);
    if (win.length < p.words.length || win.some((t) => !t.w) || win.slice(0, -1).some((t) => t.stop)) return null;
    if (!win.some((t, k) => t.w === p.words[k] && t.w.length >= 4)) return null;
    let d = 0;
    const swaps = [];
    for (const [k, t] of win.entries()) {
      if (t.w === p.words[k]) continue;
      const near = p.fixed[k] || mentionsFetalSex(t.raw) || vocab.words.has(t.w) ? null : phraseWordAlike(t.w, p.words[k], guard);
      // never into one word of a NEVER_AUTO_PAIRS pair when it sounds nearly as much like the other ("fatal" / fetal)
      if (near === null || (NEVER_WITH.get(spelling(p.words[k])) ?? []).some((o) => accentDistance(t.w, lettersOf(o)) < near + 1.5)) return null;
      d += near;
      swaps.push(k);
    }
    return swaps.length ? { p, d, swaps, n: win.length } : null;
  };
  for (let i = 0; i < toks.length; ) {
    const [best, ...rivals] = vocab.phrases
      .map((p) => heardAs(i, p))
      .filter(Boolean)
      .sort((a, b) => a.d - b.d);
    // another phrase that means something else, nearly as close: left as heard
    if (!best || rivals.some((r) => r.p.meaning !== best.p.meaning && r.d - best.d < 1.5)) {
      i += 1;
      continue;
    }
    const said = best.p.said.split(/\s+/);
    for (const k of best.swaps) {
      const t = toks[i + k];
      change(t.raw, said[k], 'sound', 'A');
      edits.push([t.at, t.end, said[k]]);
    }
    i += best.n;
  }
  let out = s;
  for (const [a, b, to] of edits.reverse()) out = out.slice(0, a) + to + out.slice(b);
  return out;
}

// Plan 2.5: each word matched by sound – changed when sure, asked ("Did you mean …?") with a clinical word before it
function soundWords(s, change, ask, guard, held) {
  const toks = wordsOf(s, held);
  const edits = [];
  for (const t of toks) {
    if (!t.w || t.w.length < 4) continue;
    const got = fuzzyTerm(t.raw, { guard, anchor: clinicalAnchor(s, t.at) });
    if (!got) continue;
    if (got.mode === 'ask') {
      ask({ heard: t.raw, to: got.to, why: 'sounds like a word the app knows', sound: true });
      continue;
    }
    change(t.raw, got.to, 'sound', 'A');
    edits.push([t.at, t.end, got.to]);
  }
  let out = s;
  for (const [a, b, to] of edits.reverse()) out = out.slice(0, a) + to + out.slice(b);
  return out;
}

// Where a phrase the app knows is said exactly ("hepatitis E", "abruptio placentae"): never changed by sound
let phrasesByFirst = null;
function exactPhrases(s) {
  if (!phrasesByFirst) {
    phrasesByFirst = new Map();
    for (const p of soundVocabulary().phrases) {
      const said = p.said.toLowerCase().split(/\s+/);
      phrasesByFirst.set(said[0], [...(phrasesByFirst.get(said[0]) ?? []), said]);
    }
  }
  const toks = wordsOf(s);
  const found = [];
  for (const [i, t] of toks.entries()) {
    for (const said of phrasesByFirst.get(t.raw.toLowerCase()) ?? []) {
      const win = toks.slice(i, i + said.length);
      if (win.length === said.length && win.every((x, k) => x.raw.toLowerCase() === said[k] && (k === said.length - 1 || !x.stop))) found.push([t.at, win.at(-1).end]);
    }
  }
  return found;
}

/**
 * Joining split words, then phrases and words matched by sound (plan 2.3 step 9, 2.5), on the masked text. `asked`:
 * the words the lookup table asks about, left as heard, as are the phrases the app knows said exactly.
 */
function matchBySound(s, change, ask, asked = [], guard = REAL_WORDS) {
  const held = (t) => [...heldFor(t, asked), ...exactPhrases(t)];
  let t = joinSplitWords(s, change, held(s));
  t = soundPhrases(t, change, guard, held(t));
  return soundWords(t, change, ask, guard, held(t));
}
// ---------- end of matching words by sound ----------

/**
 * The Indian English steps before numbers said as words become digits (plan 2.3 steps 3–8), outside names and
 * addresses (`spans`, from findProtectedSpans) and never inside the doctor's own words (`protect`): fillers and
 * trailing words, numbers in Indian languages next to a unit or in the formula, "none reactive" after a test name,
 * letters and letter names, numbers and months said with an accent, the lookup table, and (with `sound`, for speech)
 * split words joined and words matched by sound (plan 2.3 step 9, 2.5).
 * Returns { text, changes: [{ heard, to, rule, tier }], questions: [{ heard, to, why, value?, sound? }] (tier C, and
 * sound matches that are not sure), spelled }.
 */
export function prepareTranscript(text, { careType, protect = [], spans = [], sound = true } = {}) {
  const m = maskParts(String(text ?? ''), spans, protect);
  const changes = [];
  const questions = [];
  const spelled = new Set();
  const change = (heard, to, rule, tier) => changes.push({ heard: m.restore(heard).trim(), to, rule, tier });
  const ask = (q) => questions.push({ ...q, heard: m.restore(q.heard).trim() });
  let s = fillersAndNumbers(m.text, change);
  s = resultGuard(s, change);
  s = decodeMasked(s, DECODE_FORMS, m.isName, change, spelled);
  s = accentNumbers(s, change);
  s = applyLookups(s, { careType, stage: 'words' }, change, ask);
  if (sound) {
    s = matchBySound(s, change, ask, questions.map((q) => q.heard));
    // a number word matched by sound ("twenti" → twenty) is next to "tree" only now: "twenty tree" is 23, never 20
    s = accentNumbers(s, change);
  }
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,;])/g, '$1').replace(/([,;])(?:\s*[,;])+/g, '$1');
  return { text: m.restore(s), changes, questions, spelled: [...spelled] };
}

// ---------- After numbers became digits (plan 2.4) ----------
const FORMULA_LABEL_BEFORE = /\b(?:gravida|para|living|abortions?|[gpla]\s*-?\s*\d)\b/i;
const NEXT_FORMULA_LETTER = { g: 'p', p: 'l', l: 'a', a: 'd' }; // G P L A D
const FORMULA_NUMBER = { to: '2', too: '2', for: '4', tree: '3', tri: '3', hero: '0', jero: '0', jiro: '0' };
// A number word heard as "to", "for", "tree" or "hero" – only inside a formula ("G to P1 L1", "abortion jiro"), never
// "vitamin A to D3", "RL to D5", "A1 abortion for fetal anomaly" or "living for 2 years"
function formulaWords(s, change) {
  return s
    .replace(/\b([gpla]|gravida|para|living|abortions?)\s+(to|too|for|tree|tri|hero|jero|jiro)\b(?=\s*(?:[plad]\s*-?\s*\d|gravida|para|living|abortions?|[,.;]|$))/gi, (all, label, word, at, str) => {
      const next = str.slice(at + all.length);
      const inside = /^\s*(?:[plad]\s*-?\s*\d|gravida|para|living|abortions?)/i.test(next);
      const partBefore = /[gpla]\s*-?\s*\d{1,2}(?:\s*\+\s*\d{1,2})?\s*[,-]?\s*$/i.test(str.slice(Math.max(0, at - 12), at));
      if (label.length === 1) {
        // a single letter needs the next letter of the formula after it ("G to P1"); "L to A0" and "A to D0" also need a
        // part said just before ("P1 L to A0"). At the end of the formula it needs the part before ("L1 A hero").
        const nextLetter = new RegExp(`^\\s*${NEXT_FORMULA_LETTER[label.toLowerCase()]}\\s*-?\\s*\\d`, 'i').test(next);
        const atEnd = /^\s*(?:[,.;]|$)/.test(next);
        if (!((nextLetter && (!/^[la]$/i.test(label) || partBefore)) || (atEnd && partBefore))) return all;
      } else if (!inside && !FORMULA_LABEL_BEFORE.test(str.slice(Math.max(0, at - 30), at))) return all;
      const n = FORMULA_NUMBER[word.toLowerCase()];
      change(word, n, 'formula', 'B');
      return `${label} ${n}`;
    })
    .replace(/\bji\s+(\d{1,2})(?=\s*(?:p\s*-?\s*\d|para\b))/gi, 'G$1') // "ji 2 P1 L1": G2
    .replace(/\b(p(?:ara)?\s*-?\s*\d{1,2})\s+plus\s+(\d{1,2})\b/gi, '$1+$2'); // "P 1 plus 1": P1+1
}

// Digits said as other words (plan 2.4). "not" is never 0.
const SOUND_ALIKE_DIGITS = {
  oh: '0', o: '0', nought: '0', naught: '0', hero: '0', jero: '0', jiro: '0', sero: '0', won: '1', van: '1', wun: '1', to: '2', too: '2', tree: '3', tri: '3',
  for: '4', shix: '6', sicks: '6', ate: '8', yeight: '8', et: '8', tan: '10',
};
// "cell" (pus cell) and "ph" (urine pH) are a phone only with "number" or "no" after them
const PHONE_BEFORE =
  /\b(?:(?:phone|mobile|contact|mob|tel(?:ephone)?|landline|whats\s?app)\b\.?(?:\s*(?:number|no\.?|num|nos?))?|(?:cell|ph)\.?\s*(?:number|no\.?|num|nos?)|husband'?s?\s+(?:number|no))\s*(?:is|:|-)?\s*$/i;
const PIN_BEFORE = /\b(?:pin\s*code|pincode|pin)\s*(?:is|:|-)?\s*$/i;
// A word like these just after never lets a number word be a digit ("Labebet 1 0 1 for 5 days", "2 to 3 days"): units,
// and the medicines most often said with a dose
const NOT_A_DIGIT_BEFORE =
  /^(?:days?|weeks?|wks?|times|tablets?|tabs?|daily|hours?|hrs?|minutes?|mins?|months?|years?|mg|mcg|ml|units?|iu|labetalol|labebet|nifedipine|nicardia|depin|methyldopa|aldomet|metformin|glycomet|thyronorm|eltroxin|thyrox|ecosprin|aspirin|insulin|susten|duphaston|iron|calcium|folic)$/i;
// Only in a phone number or pincode (after its keyword), or where the result is a run of exactly 6 or 10 digits
function soundAlikeDigits(s, change) {
  const toks = [...s.matchAll(/\S+/g)].map((m) => ({ raw: m[0], at: m.index, w: m[0].toLowerCase().replace(/,$/, '') }));
  const isDigits = (t) => /^\d+$/.test(t.w);
  const isSound = (t) => Object.hasOwn(SOUND_ALIKE_DIGITS, t.w);
  const digitsOf = (i) => {
    const t = toks[i];
    if (isDigits(t)) return { digits: t.w, used: 1 };
    if (/^(?:double|triple)$/.test(t.w) && toks[i + 1] && (isSound(toks[i + 1]) || isDigits(toks[i + 1]))) {
      const d = isDigits(toks[i + 1]) ? toks[i + 1].w : SOUND_ALIKE_DIGITS[toks[i + 1].w];
      return { digits: d.repeat(t.w === 'double' ? 2 : 3), used: 2, sound: isSound(toks[i + 1]) };
    }
    if (isSound(t)) return { digits: SOUND_ALIKE_DIGITS[t.w], used: 1, sound: true };
    return null;
  };
  const edits = [];
  for (let i = 0; i < toks.length; ) {
    // the run: digit groups and sound-alike words, with a comma allowed between them
    const run = [];
    for (let j = i; j < toks.length && /^[a-z0-9]+,?$/i.test(toks[j].raw); ) {
      const d = digitsOf(j);
      if (!d) break;
      // a number word straight before "days", "times" … is left as said
      if (d.sound && toks.slice(j + d.used, j + d.used + 2).some((t) => NOT_A_DIGIT_BEFORE.test(t.w))) break;
      run.push({ ...d, from: j });
      j += d.used;
    }
    if (!run.length) {
      i += 1;
      continue;
    }
    const next = i + run.reduce((k, r) => k + r.used, 0);
    i = next;
    if (!run.some((r) => r.sound) || !run.some((r) => !r.sound)) continue;
    const lead = s.slice(0, toks[run[0].from].at);
    const target = PIN_BEFORE.test(lead) ? 6 : PHONE_BEFORE.test(lead) ? null : undefined;
    let use = run;
    if (target === null) {
      // after a phone keyword: until the number is whole (10 digits, 0 + 10, or 91 + 10)
      use = [];
      let count = '';
      for (const r of run) {
        const want = count.startsWith('91') && count.length >= 2 ? 12 : count.startsWith('0') ? 11 : 10;
        if (count.length >= want) break;
        use.push(r);
        count += r.digits;
      }
    } else {
      const all = run.map((r) => r.digits).join('');
      // without a keyword, "to" / "for" next to a number of two or more digits is a range ("BP 130 to 80", "sugar 90 to
      // 100"), never 6 digits
      const group = (r) => r && !r.sound && r.used === 1 && r.digits.length > 1;
      const range = target === undefined && run.some((r, k) => r.sound && /^(?:to|too|for)$/.test(toks[r.from].w) && (group(run[k - 1]) || group(run[k + 1])));
      // a 10-digit run must look like an Indian mobile number (6-9 first)
      const whole = target === 6 ? all.length === 6 : all.length === 6 || /^[6-9]\d{9}$|^0\d{10}$|^91\d{10}$/.test(all);
      if (range || !whole || (toks[next] && NOT_A_DIGIT_BEFORE.test(toks[next].w))) continue;
    }
    if (!use.some((r) => r.sound)) continue;
    const start = toks[use[0].from].at;
    const endTok = toks[use.at(-1).from + use.at(-1).used - 1];
    const end = endTok.at + endTok.raw.replace(/,$/, '').length;
    const to = use.map((r) => r.digits).join(' ');
    change(s.slice(start, end), to, 'digits', 'B');
    edits.push([start, end, to]);
  }
  let out = s;
  for (const [a, b, to] of edits.reverse()) out = out.slice(0, a) + to + out.slice(b);
  return out;
}

// "height 1 52" (one fifty-two) is 152 cm: only a first digit of 1 and the rest 20–99. "height 5 2" is left for a
// question (5 feet 2 inches), never 52.
function heightNumbers(s, change) {
  const join = (all, one, rest) => {
    change(all.trim(), `1${rest}`, 'height', 'B');
    return `1${rest}`;
  };
  return s
    .replace(/(?<=\b(?:height|ht)\s*(?:is|of|:|-)?\s*)\b(1)\s+([2-9]\d)(?![\d.])(?!\s*(?:feet|foot|ft|inch|inches)\b)/gi, join)
    .replace(/(?<![\d.]\s?)\b(1)\s+([2-9]\d)(?=\s*(?:cm|cms|centimet(?:er|re)s?)\b)/gi, join);
}
// "5 March 20 26" (twenty twenty-six) is 2026, only after a day and a month. A bare month ("LMP July 20 26 years old",
// "LMP August 20 12 weeks", "born September 20 10 30 am") and a unit or time after it are left for the date reader.
const MONTH_THEN_YEAR = new RegExp(
  `\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH}))\\.?,?\\s+20\\s+(\\d{2})(?!\\d)` +
    `(?!\\s*(?:[:.]?\\d|(?:weeks?|wks?|w|days?|months?|mths?|years?|yrs?|hrs|hours|baje|a\\.?\\s?m|p\\.?\\s?m)\\b|o'?\\s?clock|in\\s+the\\b))`,
  'gi',
);

/**
 * The steps after numbers said as words became digits (plan 2.4), outside names, addresses and the doctor's own words:
 * number words heard as "to", "for", "tree" or "hero" inside the obstetric formula; digits said as other words ("nine
 * ate seven", "double oh") inside a phone number or pincode, or where they make a run of exactly 6 or 10 digits; a
 * height said as "1 52"; a year said as "20 26" after a day and month; and the lookup rows read after digits ("wait 58").
 * Approximate dates ("2 months back", "kal", "parson") are asked where each date is read (dictation.js).
 * Returns { text, changes, questions }.
 */
export function fixAfterDigits(text, { careType, spans = [], protect = [] } = {}) {
  const m = maskParts(String(text ?? ''), spans, protect);
  const changes = [];
  const questions = [];
  const change = (heard, to, rule, tier) => changes.push({ heard: m.restore(heard).trim(), to, rule, tier });
  let s = formulaWords(m.text, change);
  s = soundAlikeDigits(s, change);
  s = heightNumbers(s, change);
  s = s.replace(MONTH_THEN_YEAR, '$1 20$2');
  s = applyLookups(s, { careType, stage: 'digits' }, change, (q) => questions.push({ ...q, heard: m.restore(q.heard).trim() }));
  return { text: m.restore(s), changes, questions };
}
