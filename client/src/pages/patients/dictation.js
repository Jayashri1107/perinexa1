// Voice entry: picks a patient's details out of dictated (or typed) text – entirely in the browser, nothing
// is sent anywhere. Simple rules, not AI: the words OBGY doctors in India use (obgyTerms.js) plus each doctor's
// own words (taught in voice entry and kept in their account). What the rules are sure of is filled in and
// marked "From voice"; what they are not sure of becomes a question with choices; what they did not understand
// is listed. The baby's sex is read only for newborns – never during a pregnancy (PCPNDT Act).

import { CONDITION_LABELS, NEWBORN_SEX_LABELS, PAST_COMPLICATION_LABELS } from './patientFormat.js';
import { ANTI_D, LOSS_LABELS, THREATENED_HINT } from './abortionFormat.js';
import { COMMON_WORDS, FAMILY_WORDS, KNOWN_SHORT_FORMS, TERMS, isBlockedLearned } from './obgyTerms.js';
import {
  DETAIL_START,
  addressAfter,
  addressStart,
  applySelfCorrections,
  clinicalAnchor,
  findProtectedSpans,
  fixAfterDigits,
  normaliseLabels,
  prepareTranscript,
  sayPattern,
} from './indianEnglish.js';
import { REAL_WORDS } from './realWordGuard.js';
import { FETAL_SEX_WORDS, KARYOTYPE, SEX_SYMBOLS, mentionsFetalSex } from '../../pcpndtWords.js';

const DAY = 24 * 60 * 60 * 1000;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const localIso = (d) => `${isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
// Same formats as the rest of the app: "12 Jul 2026" and "12 Jul 2026, 09:15"
const showDate = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
};
const showDateTime = (iso) => `${showDate(iso)}, ${iso.slice(11, 16)}`;
const escapeRx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalise = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const PREGNANCY_CARE = ['antenatal', 'postnatal'];

// ---------- Numbers said as words: "twenty eight" → 28, "second" → 2nd, "double 5" → 55 ----------
const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const SMALL = { zero: 0, ...UNITS, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
const alt = (words) => Object.keys(words).join('|');

// Short forms the app knows (a list said after "no" without commas, the unknown ones asked about).
const isShortForm = (w) => /^[A-Za-z0-9]{2,7}$/.test(w) && /[A-Z].*[A-Z]/.test(w);
const SHORT_FORMS = new Set([...KNOWN_SHORT_FORMS, ...TERMS.flatMap((t) => t.says.filter(isShortForm).map((w) => w.toUpperCase()))]);

// Runs of "*" are words hidden by Chrome's "Mask offensive words" setting: kept as one marker word, so the words
// around them are still read (VoiceEntry says how to turn the setting off).
export const cleanup = (text) =>
  ` ${String(text ?? '')} `
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\S*\*{2,}\S*/g, ' (masked) ')
    .replace(/\s+/g, ' ');

// Numbers said as words become digits everywhere, names too ("first", "gravita", "prev" or "wt" – now "1st", "gravida",
// "previous", "weight" – end a name); "nahi", dotted letters and "NR" are read outside names only (plan 2.1).
// The Indian English steps before and after this one are in indianEnglish.js.
const NAME_KINDS = new Set(['name', 'husband', 'mother', 'father', 'referrer', 'hospital']);
function normalise(text) {
  const s = normaliseWords(cleanup(text));
  let out = '';
  let at = 0;
  for (const span of findProtectedSpans(s).filter((p) => NAME_KINDS.has(p.kind))) {
    out += decodeLetters(s.slice(at, span.start)) + s.slice(span.start, span.end);
    at = span.end;
  }
  return out + decodeLetters(s.slice(at));
}

// What is safe to read in names too: numbers said as words and case-sheet shorthand
export function normaliseWords(text) {
  let s = text;
  const low = (w) => w.toLowerCase();
  s = s.replace(new RegExp(`\\b(${alt(TENS)})[\\s-]+(${alt(ORDINALS)})\\b`, 'gi'), (_, t, o) => ordinal(TENS[low(t)] + ORDINALS[low(o)]));
  s = s.replace(new RegExp(`\\b(${alt(ORDINALS)})\\b`, 'gi'), (_, o) => ordinal(ORDINALS[low(o)]));
  s = s.replace(new RegExp(`\\b(${alt(TENS)})(?:[\\s-]+(${alt(UNITS)}))?\\b`, 'gi'), (_, t, u) => String(TENS[low(t)] + (u ? UNITS[low(u)] : 0)));
  s = s.replace(new RegExp(`\\b(${alt(SMALL)})\\b`, 'gi'), (_, w) => String(SMALL[low(w)]));
  s = s
    .replace(/\b(\d)\s+hundred(?:\s+and)?\s+(\d{1,2})\b/gi, (_, h, r) => String(Number(h) * 100 + Number(r)))
    .replace(/\b(\d)\s+hundred\b/gi, (_, h) => String(Number(h) * 100))
    .replace(/\b([1-9]\d)\s+hundred\b/gi, (_, h) => String(Number(h) * 100)) // "twenty eight hundred grams"
    .replace(/\b(\d+)\s+(?:point|decimal)\s+(\d+)\b/gi, '$1.$2')
    .replace(/\b(\d{1,2})\s+thousand(?:\s+and)?\s+(\d{1,3})\b/gi, (_, t, r) => String(Number(t) * 1000 + Number(r))) // birth weight "2 thousand 800"
    .replace(/\b(\d{1,2})\s+thousand\b/gi, (_, t) => String(Number(t) * 1000))
    .replace(/\bdouble\s+(\d)\b/gi, '$1$1')
    .replace(/\btriple\s+(\d)\b/gi, '$1$1$1');
  // Indian case-sheet shorthand
  return s
    .replace(/\bk\s*\/\s*c\s*\/?\s*o\b/gi, 'known case of')
    .replace(/\bh\s*\/\s*o\b/gi, 'history of')
    .replace(/\bc\s*\/\s*o\b/gi, 'complains of')
    .replace(/\bs\s*\/\s*p\b/gi, 'status post')
    .replace(/\bw\s*\/\s*o\b/gi, 'wife of')
    .replace(/\bd\s*\/\s*o\b/gi, 'daughter of')
    .replace(/\bb\s*\/\s*o\b/gi, 'baby of')
    .replace(/\br\s*\/\s*o\s+(?=[A-Z])/g, 'resident of ')
    .replace(/\br\s*\/\s*o\b/gi, 'rule out')
    .replace(/\?(?=[A-Za-z])/g, 'query ')
    .replace(/\b(\d{1,3})\s*(?:saal|sal|varsh)\b/gi, '$1 years')
    .replace(/\b(?:pehli|pahli)\b/gi, '1st')
    .replace(/\b(?:doosri|dusri)\b/gi, '2nd')
    .replace(/\b(?:teesri|tisri)\b/gi, '3rd')
    .replace(/\s*\+\s*ve\b/gi, ' positive')
    .replace(/\s*-\s*ve\b/gi, ' negative')
    .replace(/\bprev\b\.?/gi, 'previous')
    .replace(/\bwt\b\.?\s*(?=\d)/gi, 'weight ')
    .replace(/\bht\b\.?\s*(?=\d)/gi, 'height ')
    .replace(/\bhx\b/gi, 'history')
    .replace(/\b(?:prime|primi|primy|premi)\s+gravida\b/gi, 'primigravida')
    .replace(/\bmulti\s+gravida\b/gi, 'multigravida')
    .replace(/\bgravita\b/gi, 'gravida')
    .replace(/\bhbs\s+(?:ag|antigen)\b/gi, 'HBsAg')
    .replace(/\bhepatitis\s+b\s+surface\s+antigen\b/gi, 'HBsAg')
    .replace(/\bthyro\s+norm\b/gi, 'Thyronorm')
    .replace(/\(\s*(\d{3})\s*\)\s*(\d{3})\s*-\s*(\d{4})\b/g, '$1$2$3') // "(987) 654-3210", as Chrome may write a number
    .replace(/\bG\s+DM\b/gi, 'GDM') // not diabetes from before the pregnancy
    .replace(/\bFH\b/g, 'family history')
    // A blood group's subgroup: "blood group A1 positive" → A positive, "A1B" → AB
    .replace(/(?<=\b(?:group|grp|type|bg)\s*(?:is\s+|:\s*|-\s*)?)\ba[12](\s?b)?(?=\s*(?:rh\s*)?(?:positive|negative|pos|neg|\+|-)(?![a-z0-9]))/gi, (_, b) => (b ? 'AB' : 'A'));
}

// Outside names only: "nahi" ("Nai" is a surname), letters with dots, and "NR". Letters said one by one are read
// in indianEnglish.js (decodeLetters).
function decodeLetters(text) {
  return text
    .replace(/\b(?:nahi|nahin|nai)\b/gi, 'negative')
    .replace(/\b(?:[A-Za-z]\.){2,}(?:[A-Za-z](?![A-Za-z]))?\.?/g, (m) => m.replace(/\./g, '')) // L.S.C.S. → LSCS
    .replace(/\bNR\b/g, 'non-reactive');
}

// ---------- Clauses and segments (for "no …", "… negative", "previous …") ----------
const BOUNDARY = /[;!?\n]|\.(?!\d)/g;
function clauseStart(s, i) {
  let start = 0;
  for (const m of s.slice(0, i).matchAll(BOUNDARY)) start = m.index + 1;
  return start;
}
function clauseEnd(s, i) {
  const rx = new RegExp(BOUNDARY.source, 'g');
  rx.lastIndex = i;
  const m = rx.exec(s);
  return m ? m.index : s.length;
}
const segmentStart = (s, i) => Math.max(clauseStart(s, i), s.lastIndexOf(',', i - 1) + 1);
function segmentEnd(s, i) {
  const comma = s.indexOf(',', i);
  return Math.min(clauseEnd(s, i), comma < 0 ? s.length : comma);
}

const NEGATOR = /\b(?:no|not|nil|none|never|without|denies|denied|negative\s+for|free\s+of|absence\s+of|non|query|suspected|rule\s+out|to\s+rule\s+out|doubtful)\b/gi;
const POSITIVE_WORD = /^(?:positive|reactive|present|detected|diagnosed)$/i;
const NEGATIVE_WORD = /^(?:negative|non-?reactive|absent|nil|normal)$/i;
// Words that start another detail: a result said after them belongs to that detail ("… allergy nil").
const OTHER_DETAIL = /^(?:allerg\w*|blood|group|lmp|phone|mobile|age|aged|weight|height|gravida|para|address|edd|scan|history|known|previous|on)$/i;
// Blood tests: after a treatment word ("history of syphilis treated, VDRL non-reactive now", "anti-D given at 28 weeks,
// ICT negative") a result said after one is that test's, not the finding's. Without one ("syphilis VDRL negative", "HIV
// syphilis HBsAg negative", "TB, HIV negative") it stays the result of the whole list, so nothing is ticked.
const BLOOD_TEST = /^(?:hiv|vdrl|rpr|tpha|hcv|hbsag|ict|dct|coombs)$/i;
const TREATED = /^(?:treated|given|taken|received|completed|cured)$/i;
// After a treatment, a blood group starts another detail: "anti-D given, B negative" is her blood group, not anti-D's
// result (so anti-D is still read as given).
const BLOOD_GROUP_WORD = /^(?:a|b|ab|o|rh)$/i;

// The first "positive"/"negative" said in the few words after a finding ("HIV, HBsAg and VDRL negative"). `test`: the
// finding is itself a test (then another test's name does not end it). `start`: where the finding starts (a treatment
// word in it counts: "anti D given").
// resultSpan also says where the result word is ({ kind, start, end }; "non reactive" and "ruled out" are one), so
// "Not understood" never lists it apart from its test (plan G5.10).
function resultSpan(s, end, test = true, start = end) {
  let treated = s.slice(start, end).split(/[\s,:]+/).some((w) => TREATED.test(w));
  const words = [...s.slice(end, clauseEnd(s, end)).matchAll(/non\s+reactive|ruled\s+out|[^\s,:]+/gi)].slice(0, 5);
  const word = (m) => (m ? m[0].replace(/^non\s+reactive$/i, 'non-reactive').replace(/^ruled\s+out$/i, 'negative') : '');
  const at = (kind, m) => ({ kind, start: end + m.index, end: end + m.index + m[0].length });
  for (const [i, m] of words.entries()) {
    const w = word(m);
    // "none / nan / non reactive" is most likely a misheard "non-reactive": not taken as reactive (it is asked)
    if (POSITIVE_WORD.test(w)) return i > 0 && /^(?:none|nan|non)$/i.test(word(words[i - 1])) && /^(?:reactive|positive)$/i.test(w) ? null : at('positive', m);
    if (NEGATIVE_WORD.test(w)) return at('negative', m);
    if (OTHER_DETAIL.test(w) || (treated && !test && (BLOOD_TEST.test(w) || BLOOD_GROUP_WORD.test(w)))) return null;
    if (TREATED.test(w)) treated = true;
  }
  return null;
}
const resultAfter = (s, end, test = true, start = end) => resultSpan(s, end, test, start)?.kind ?? null;

// "none", "nan", "non", "known" or "on" just before "reactive"/"positive" may be a misheard "non-" (plan 2.3 step 5):
// such a result is asked both ways, showing every word heard ("HIV none reactive"), never as "is that right?".
const DOUBTFUL_RESULT = /^[\s,:-]*(?:\S+\s+)?(?:none|nan|non|known|on)[\s-]*(?:reactive|positive)\b/i;
function doubtfulResult(s, start, end) {
  const m = s.slice(end, clauseEnd(s, end)).match(DOUBTFUL_RESULT);
  return m ? s.slice(start, end + m[0].length) : null;
}

// A "no" covers the finding right after it ("no history of …") and a list joined by "or", "and" or commas
// ("no diabetes, hypertension or asthma") – not a new finding said without a joining word ("no DM no HTN
// thyroid on eltroxin"), nor one said as known after a comma ("non-diabetic, known asthmatic").
// Speech has no commas: after "no", a run of only findings and short forms is one list too. After "no history
// of" / "not a known case of" the whole run is "no"; after a bare "no DM HTN …" the later ones are asked about
// ('ask', when `allowAsk`), unless "on", "since", "diagnosed" … follows (then she has it). `test`: see resultAfter.
const FILLER = '(?:known|case|history|h\\/o|any|signs|evidence|complaints|significant|past|previous|a|an|of)';
const ONLY_FILLER = new RegExp(`^(?:${FILLER}\\s*)*$`, 'i');
const LIST_TAIL = new RegExp(`(?:[,/]|\\b(?:or|and|nor))\\s*((?:${FILLER}\\s*)*)$`, 'i');
// The filler words straight after a "no" ("no history of", "not a known case of"), as whole words
const FILLER_RUN = new RegExp(`^[\\s-]*(?:${FILLER}\\b\\s*)*`, 'i');

// The last "no" (or "not", "nil" …) before a finding in its clause, after any "but": { neg, before, from } – before is
// the text from `from` up to the finding – or null
function negatorBefore(s, start) {
  let from = clauseStart(s, start);
  const turn = [...s.slice(from, start).matchAll(/\b(?:but|however|although|except|whereas)\b/gi)].pop();
  if (turn) from += turn.index + turn[0].length;
  const before = s.slice(from, start);
  // "none" or "non" said as a result ("VDRL none reactive, HBsAg …") does not start a "no …" list
  const neg = [...before.matchAll(NEGATOR)].filter((m) => !/^[\s-]*(?:reactive|positive)\b/i.test(before.slice(m.index + m[0].length))).pop();
  return neg ? { neg, before, from } : null;
}

// Where the "no" before a finding is said, with the words that go with it ("no history of", "not a known case of"):
// { start, end }, or null. Used only once `negated` has said the finding is negated (or asked about).
function negationSpan(s, start) {
  const found = negatorBefore(s, start);
  if (!found) return null;
  const a = found.from + found.neg.index;
  const run = found.before.slice(found.neg.index + found.neg[0].length).match(FILLER_RUN)[0].trimEnd();
  return { start: a, end: a + found.neg[0].length + run.length };
}

function negated(s, start, end, allowAsk = false, test = true) {
  const after = resultAfter(s, end, test, start);
  if (after) return after === 'negative';
  const found = negatorBefore(s, start);
  if (!found) return false;
  const { neg, before } = found;
  const between = before.slice(neg.index + neg[0].length).replace(/^[\s-]+/, '').trim(); // "non-diabetic"
  if (ONLY_FILLER.test(between)) return true;
  const tail = between.match(LIST_TAIL);
  if (tail) return !/\bknown\b/i.test(tail[1]);
  const listed = between.replace(ANY_TERM_G, ' ').replace(/\b[A-Z]{2,6}\b/g, (w) => (SHORT_FORMS.has(w) ? ' ' : w));
  if (!ONLY_FILLER.test(listed.trim())) return false;
  if (/^\s*(?:on|since|diagnosed|detected|treated|under\s+treatment|controlled|taking)\b/i.test(s.slice(end, end + 30))) return false;
  if (/\b(?:known|case|history|h\/o|significant|past)\b/i.test(before.slice(neg.index))) return true;
  return allowAsk ? 'ask' : false;
}

// A family member's (or a previous baby's) illness is not the patient's own. Family history ends where she is
// talked about again ("mother diabetic she is hypothyroid"); a baby or child counts only within 3 words.
const FAMILY_PEOPLE = `mother|father|husband|sister|brother|parents?|grand\\w+|aunt|uncle|in-laws?|sibling|${FAMILY_WORDS.join('|')}`;
const FAMILY_ADULT = new RegExp(`\\b(?:family\\s+history|family|${FAMILY_PEOPLE})\\b`, 'gi');
const FAMILY = new RegExp(`${FAMILY_ADULT.source}|\\b(?:baby|babies|child|son|daughter)\\b`, 'gi');
const HERSELF = /\b(?:she|patient|pt|herself|her\s+own|self)\b/i;
// "mother of (the) patient" names the mother, it is not the patient talked about again
const OF_PATIENT = /\bof\s+(?:the\s+|this\s+|our\s+)?(?:patient|pt)\b/gi;
// Who it was said about ('husband', 'mother' …), or null when it is about her
function aboutFamily(s, start, rx = FAMILY) {
  const before = s.slice(segmentStart(s, start), start);
  const last = [...before.matchAll(new RegExp(rx.source, 'gi'))].pop();
  if (!last) return null;
  const rest = before.slice(last.index + last[0].length);
  if (HERSELF.test(rest.replace(OF_PATIENT, ' '))) return null;
  if (/^(?:baby|babies|child|son|daughter)$/i.test(last[0]) && rest.trim().split(/\s+/).filter(Boolean).length > 3) return null;
  return last[0].toLowerCase();
}
// Only a woman can have these: never the husband's, even when said just after him
const HERS_ONLY = /PCOS|Fibroid|Adenomyosis|Endometriosis|Uterine|Tubal|ovarian|Pap|prolapse|ectopic|molar|hysterectomy|sterilisation|cervical|Recurrent pregnancy loss/i;

// Said about a previous pregnancy, or about this one? The nearest marker in the same clause decides.
const PAST_MARK =
  /\b(?:previous|prior|earlier|past|last(?!\s+(?:menstrual|period|menses|monthly|mc|date))|history\s+of|before|older|elder|bad\s+obstetric|(?:1st|2nd|3rd|4th)\s+(?:pregnancy|delivery|baby|child|issue))\b/gi;
const NOW_MARK = /\b(?:(?:this|present|current|index)\s+(?:pregnancy|delivery|time)|now|currently|presently|at\s+present|diagnosed|detected|admitted|today|tonight|this\s+morning)\b/gi;
function whenSaid(s, start, end) {
  const phrase = segmentStart(s, start) > clauseStart(s, start) || segmentEnd(s, end) < clauseEnd(s, end);
  const from = phrase ? segmentStart(s, start) : clauseStart(s, start);
  const text = s.slice(from, phrase ? segmentEnd(s, end) : clauseEnd(s, end));
  let best = null;
  for (const [kind, rx] of [['past', PAST_MARK], ['now', NOW_MARK]]) {
    for (const m of text.matchAll(new RegExp(rx.source, 'gi'))) {
      const a = from + m.index;
      const b = a + m[0].length;
      const dist = b <= start ? start - b : a >= end ? a - end : 0;
      if (dist <= 40 && (!best || dist < best.dist)) best = { kind, dist };
    }
  }
  return best?.kind ?? null;
}

// ---------- Cutting a free-text value (name, address, allergy) before the next detail ----------
// DETAIL_START (where the next detail starts, and so where an address ends) is shared with indianEnglish.js.
// A name or an allergy ends at more words: a bare "age", "blood", "known", "mother", "baby" …, "doctor" or "Dr" before
// another name ("name Nergis Doctor age 28" keeps her surname), "umar" before an age, and fillers ("Priya achha")
const NEXT_DETAIL = new RegExp(
  `\\s(?:${DETAIL_START}|age|aged|scan|blood|known|history|baby|mother|living|married|village|gaon|hypo\\w*|hyper\\w*|` +
    '(?:doctor|dr)(?=\\.?\\s+(?!(?:age|aged)\\b)[a-z])|(?:umar|umr)(?=\\s+(?:\\d|\\S+\\s+(?:saal|years?)\\b))|achha|acha|accha|haan)\\b',
  'i',
);
// Said before or after a name or an address, never part of it: "name haan Sunita Devi", "Wakad Pune achha"
const LEADING_FILLER = /^(?:[\s,]*\b(?:haan|han|achha|acha|accha|uh|um|hmm|okay|ok)\b)+[\s,]*/i;
const TRAILING_FILLER = /(?:\s+(?:ji|haan|han|achha|acha|accha|okay|ok))+$/i;

function cutAt(text, stops) {
  let end = text.length;
  for (const rx of stops) {
    const i = text.search(rx);
    if (i >= 0 && i < end) end = i;
  }
  return text.slice(0, end);
}
const tidy = (text) => text.replace(/^[\s,:-]+|[\s,.;:-]+$/g, '').replace(/\s+(?:and|or|of|at|in|with)$/i, '').trim();

const NOT_NAME = new Set(
  (
    'a an and the this that our is was has have had with for of in at on to she he her his patient pt lady woman female girl mother pregnant ' +
    'primi primigravida gravida multigravida married housewife known case new old follow up visit came comes presented presents age aged ' +
    'lmp baby mrs ms smt miss kumari name doctor dr hospital referred booking antenatal postnatal registered admitted today yesterday here ' +
    'years year no not diabetic hypertensive okay ok so comfortable stable conscious oriented afebrile alert fine well better normal previous history ' +
    'husband wife father son daughter brother sister'
  ).split(' '),
);
const TITLES = /^(?:(?:mrs|ms|miss|misses|smt|shrimati|shreemati|sau|sou|kumari|km)\.?\s+)+/i;
const NAME_STOPS = [/[,.;:!?\n()"]/, /\d/, NEXT_DETAIL, /\s(?:is|was|who|she|he|her|his|and|with|has|having|came|for|from|in|at|on|of|w\/o|d\/o|s\/o|wife|daughter|referred|refd)\b/i];

// A name at the start of `raw`: { name, length } (length = characters of `raw` used), or null. Titles (Mrs, Smt …)
// and fillers said before it ("haan") are left out, an initial keeps its letter ("R. Lakshmi" → R Lakshmi), and a
// respectful "ji" at the end is dropped.
function cleanName(raw) {
  const filler = raw.match(LEADING_FILLER)?.[0] ?? '';
  const title = raw.slice(filler.length).match(TITLES)?.[0] ?? '';
  const skip = filler.length + title.length;
  const rest = raw.slice(skip).replace(/\b([A-Za-z])\.\s*(?=[A-Za-z])/g, '$1 ');
  let words = tidy(cutAt(` ${rest}`, NAME_STOPS)).split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length > 1 && /^ji$/i.test(words.at(-1))) words = words.slice(0, -1);
  if (!words.length || words.every((w) => NOT_NAME.has(w.toLowerCase()))) return null;
  const name = words.map(capitalise).join(' ');
  if (name.length < 2) return null;
  let length = skip;
  for (const w of words) length = raw.indexOf(w, length) + w.length;
  return { name: name.slice(0, 150), length };
}

// ---------- Dates ----------
const MONTH_RX = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const monthNumber = (name) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase()) + 1;
// A year said in two parts ("twenty twenty six" → "20 26") is one year. Never a time of birth said after the date
// ("born 27 September 20 30 hours" is 20:30, not 2030; "born 27 9 10 30 am", "27th September 11:40 pm") or another
// detail ("LMP 5th August 12 weeks").
const TIME_AFTER = "\\s*(?:hrs|hours|baje|a\\.?\\s?m\\b|p\\.?\\s?m\\b|o'?\\s?clock)";
const YEAR_4 = `\\d{4}(?!\\d)(?!${TIME_AFTER})|20\\s+\\d{2}(?!\\d)(?!\\s*[:.]?\\d|${TIME_AFTER})`;
const YEAR = `(${YEAR_4}|\\d{2}(?!\\d)(?!\\s*[:.]?\\d|${TIME_AFTER}|\\s*(?:weeks?|wks?|w\\b|days?|months?|years?|yrs?|in\\s+the)))`;
const DATE_PATTERNS = [
  // 12 July 2026 · 12th of July · 12 Jul '26 · 12 tarikh July
  { rx: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+|tarikh\\s+)?(${MONTH_RX})\\.?(?:,?\\s*'?${YEAR})?\\b`, 'i'), d: 1, m: 2, y: 3 },
  // July 12, 2026 · July 12th
  { rx: new RegExp(`(${MONTH_RX})\\.?\\s*(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s*(${YEAR_4}))?`, 'i'), m: 1, d: 2, y: 3 },
  // 12/07/2026 · 12-7-26 (day first)
  { rx: /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})(?!\d)/, d: 1, m: 2, y: 3 },
];
// Only right after LMP, EDD, DOB or "born" (plan G2.1): "12 7 2026", "12 by 7 by 2026", "5/8", "23 12" (day first).
// Not "LMP 12 7 28 weeks" (weeks are another detail), and not a time ("born 2 10 am").
const NOT_A_YEAR = "(?![\\d:.]|\\s*(?:weeks?|wks?|w\\b|days?|months?|years?|yrs?|a\\.?\\s?m\\b|p\\.?\\s?m\\b|hrs|hours|baje|o'?\\s?clock|in\\s+the))";
const SAID_DATE_PATTERNS = [
  { rx: new RegExp(`^(\\d{1,2})(?:\\s+by\\s+|\\s+)(\\d{1,2})(?:(?:\\s+by\\s+|\\s+)${YEAR})?${NOT_A_YEAR}`, 'i'), d: 1, m: 2, y: 3 },
  { rx: /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?![\d/.-])/, d: 1, m: 2 },
];
const todayUtc = (now) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

// A date in `text` – at its start when `anchored` (then also a date said with spaces or "by", plan G2.1). `when`:
// 'past' (LMP, birth) or 'future' (EDD) decides a missing year. Returns { iso, end } (end = characters of `text` used)
// or null.
export function readDate(text, now, when, anchored = true) {
  const body = anchored ? text.replace(/^[\s,:-]*(?:(?:was|is|on|of|dated|date|ka|tarikh|as|the|about|around|approximately|approx\.?)\s+)*/i, '') : text;
  let best = null;
  for (const p of anchored ? [...DATE_PATTERNS, ...SAID_DATE_PATTERNS] : DATE_PATTERNS) {
    const m = body.match(p.rx);
    if (!m || (anchored && m.index !== 0) || (best && m.index >= best.index)) continue;
    best = { m, p, index: m.index };
  }
  if (!best) return null;
  const { m, p } = best;
  const day = Number(m[p.d]);
  const month = /^\d+$/.test(m[p.m]) ? Number(m[p.m]) : monthNumber(m[p.m]);
  let year = m[p.y] ? Number(m[p.y].replace(/\s+/g, '')) : null;
  if (year !== null && year < 100) year += 2000;
  if (year === null) {
    year = now.getFullYear();
    const guess = Date.UTC(year, month - 1, day);
    if (when === 'past' && guess > todayUtc(now)) year -= 1;
    if (when === 'future' && guess < todayUtc(now) - 60 * DAY) year += 1;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { iso: isoDate(year, month, day), end: (anchored ? text.length - body.length : 0) + m.index + m[0].length };
}

// ---------- Meanings: what a term or an answer puts into the form ----------
// condition:<key> · past:<key> · other:<text> · note:<text> · bloodgroup (with data.group) · blood:<group> ·
// scanedd (with data.date) · height-ftin / height-feet (with data.raw) · ignore ·
// value:<path>=<value>(&<path>=<value>…) – the answer to a check ("Age 90 or 19?"). It holds a patient's value, so it
// is used on this page only: never remembered as a word and never sent to the server.
const VALUE_LABELS = {
  ageYears: 'Age',
  phone: 'Phone',
  'pregnancy.lmp': 'LMP',
  'pregnancy.scanEdd': 'EDD from dating scan',
  // Abortion type of care (pregnancy loss)
  'abortion.lmp': 'LMP',
  'abortion.lossType': 'Type of loss',
  'abortion.weeks': 'Weeks at presentation',
  'abortion.antiD': 'Anti-D',
  'obstetric.gravida': 'Gravida',
  'obstetric.para': 'Para',
  'obstetric.living': 'Living',
  'obstetric.abortions': 'Abortions',
  'obstetric.previousCaesareans': 'Previous caesareans',
  'medical.bloodGroup': 'Blood group',
  'medical.heightCm': 'Height (cm)',
  'medical.weightKg': 'Weight (kg)',
  'newborn.birthWeightGrams': 'Birth weight (g)',
  'newborn.birthAt': 'Date and time of birth',
};
const valuePairs = (meaning) =>
  meaning
    .slice('value:'.length)
    .split('&')
    .map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)])
    .filter(([path, value]) => VALUE_LABELS[path] && value);
export const isValueMeaning = (meaning) => String(meaning).startsWith('value:');

/** An AI suggestion for a part not understood ({ field, value }, checked on the server) as an answer for this form. */
const SUGGESTION_KINDS = { 'medical.conditions': 'condition', 'obstetric.pastComplications': 'past', 'medical.otherConditions': 'other', notes: 'note' };
export function suggestionMeaning({ field, value }) {
  if (VALUE_LABELS[field]) return `value:${field}=${value}`;
  return SUGGESTION_KINDS[field] ? `${SUGGESTION_KINDS[field]}:${value}` : null;
}

export function meaningLabel(meaning) {
  const [kind, value] = [meaning.split(':')[0], meaning.slice(meaning.indexOf(':') + 1)];
  if (kind === 'value') {
    const show = (path, v) =>
      /\.(?:lmp|scanEdd)$/.test(path) ? showDate(v) : path === 'newborn.birthAt' ? showDateTime(v) : path === 'abortion.lossType'
          ? (LOSS_LABELS[v] ?? v)
          : path === 'abortion.antiD'
            ? (ANTI_D[v] ?? v)
            : v;
    return valuePairs(meaning).map(([path, v]) => `${VALUE_LABELS[path]}: ${show(path, v)}`).join(', ');
  }
  if (kind === 'condition') return `Existing condition: ${CONDITION_LABELS[value] ?? value}`;
  if (kind === 'past') return `Previous pregnancy: ${PAST_COMPLICATION_LABELS[value] ?? value}`;
  if (kind === 'other') return `Other condition: ${value}`;
  if (kind === 'note') return `Notes: ${value}`;
  return (
    {
      bloodgroup: 'It is the blood group (e.g. “B positive” = B+)',
      scanedd: 'It is the dating-scan EDD',
      'height-ftin': 'It means 5 feet 2 inches',
      'height-feet': 'It means 5.2 feet',
      ignore: 'Not a patient detail – ignore it',
    }[meaning] ?? meaning
  );
}

function heightFrom(raw, how) {
  const [ft, rest = '0'] = String(raw).split('.');
  const cm = how === 'height-feet' ? Number(raw) * 30.48 : Number(ft) * 30.48 + Number(rest) * 2.54;
  return String(Math.round(cm * 10) / 10);
}

// ---------- Collecting what was found ----------
function newFindings(careType) {
  return { careType, values: {}, paths: [], learned: new Set(), texts: { 'medical.otherConditions': [], notes: [] } };
}
// `at`: where in the text it was said (other conditions, notes and questions keep that order).
function put(f, path, value, learned = false, at = Infinity) {
  const [a, b] = path.split('.');
  if (path === 'medical.conditions' || path === 'obstetric.pastComplications') {
    const list = f.values[a]?.[b] ?? [];
    if (!list.includes(value)) f.values[a] = { ...f.values[a], [b]: [...list, value] };
    if (learned) f.learned.add(`${path}.${value}`);
  } else if (path === 'medical.otherConditions' || path === 'notes') {
    if (!f.texts[path].some((t) => t.text.toLowerCase() === value.toLowerCase())) f.texts[path].push({ text: value, at });
    if (learned) f.learned.add(`${path}.${value}`);
  } else {
    if (b) f.values[a] = { ...f.values[a], [b]: value };
    else f.values[a] = value;
    if (learned) f.learned.add(path);
  }
  if (!f.paths.includes(path)) f.paths.push(path);
}

// Puts one meaning into the findings (the form fields shown for this type of care only).
function applyMeaning(f, meaning, data = {}, learned = false, at = Infinity) {
  const [kind] = meaning.split(':');
  const value = meaning.slice(meaning.indexOf(':') + 1);
  const newborn = f.careType === 'newborn';
  if (kind === 'condition' && !newborn && CONDITION_LABELS[value]) put(f, 'medical.conditions', value, learned);
  else if (kind === 'past' && !newborn && PAST_COMPLICATION_LABELS[value]) put(f, 'obstetric.pastComplications', value, learned);
  else if (kind === 'other' && !newborn) put(f, 'medical.otherConditions', value, learned, at);
  else if (kind === 'note') put(f, 'notes', value, learned, at);
  else if (meaning === 'bloodgroup' && data.group) put(f, 'medical.bloodGroup', data.group, learned);
  else if (kind === 'blood') put(f, 'medical.bloodGroup', value, learned);
  else if (meaning === 'scanedd' && data.date && f.careType === 'antenatal') put(f, 'pregnancy.scanEdd', data.date, learned);
  else if ((meaning === 'height-ftin' || meaning === 'height-feet') && data.raw && !newborn) put(f, 'medical.heightCm', heightFrom(data.raw, meaning), learned);
  else if (kind === 'value') for (const [path, v] of valuePairs(meaning)) put(f, path, v);
}

// Patient-information fields (page 1) – everything else is a clinical detail (page 2).
export const isInfoPath = (path) => /^(?:fullName|ageYears|phone|address|motherName|newborn\.)/.test(path);

// What to show the person, in the form's order.
function finish(f) {
  // Ticked items in the form's own order
  for (const [a, b, labels] of [['medical', 'conditions', CONDITION_LABELS], ['obstetric', 'pastComplications', PAST_COMPLICATION_LABELS]]) {
    const order = Object.keys(labels);
    if (f.values[a]?.[b]) f.values[a][b] = [...f.values[a][b]].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  }
  for (const path of ['medical.otherConditions', 'notes']) {
    if (!f.texts[path].length) continue;
    f.texts[path] = [...f.texts[path]].sort((x, y) => x.at - y.at).map((t) => t.text);
    const [a, b] = path.split('.');
    const text = f.texts[path].join('; ');
    if (b) f.values[a] = { ...f.values[a], [b]: text };
    else f.values[a] = text;
  }
  const v = f.values;
  const mine = (path, text) => (f.learned.has(path) ? `${text} (your word)` : text);
  // Each item says where it came from (`path`; `ticks` of a ticked list, `pieces` of a text or the obstetric history),
  // so what a fill left alone can be told apart (splitFound)
  const ticks = (path, labels) => (v[path.split('.')[0]]?.[path.split('.')[1]] ?? []).map((k) => ({ key: `${path}.${k}`, text: mine(`${path}.${k}`, labels[k]) }));
  const list = (path, labels) => ticks(path, labels).map((t) => t.text).join(', ');
  const pieces = (path) => f.texts[path].map((t) => ({ key: `${path}|${t.toLowerCase()}`, text: mine(`${path}.${t}`, t) }));
  const found = [];
  const show = (path, label, text, extra) => {
    if (f.paths.includes(path)) found.push({ label, text, part: isInfoPath(path) ? 'info' : 'clinical', path, ...extra });
  };
  const newborn = f.careType === 'newborn';
  show('fullName', 'Full name', v.fullName);
  show('ageYears', 'Age', v.ageYears);
  show('phone', newborn ? "Parent's phone" : 'Phone', v.phone);
  show('address', 'Address', v.address);
  show('newborn.birthAt', 'Date and time of birth', v.newborn?.birthAt && showDateTime(v.newborn.birthAt));
  show('newborn.birthWeightGrams', 'Birth weight', `${v.newborn?.birthWeightGrams} g`);
  show('newborn.sex', 'Sex', NEWBORN_SEX_LABELS[v.newborn?.sex]);
  show('motherName', 'Mother', `${v.motherName} – pick her from the search results`);
  show('pregnancy.lmp', 'LMP', v.pregnancy?.lmp && showDate(v.pregnancy.lmp));
  show('pregnancy.scanEdd', 'EDD from dating scan', v.pregnancy?.scanEdd && mine('pregnancy.scanEdd', showDate(v.pregnancy.scanEdd)));
  show('abortion.lossType', 'Type of loss', LOSS_LABELS[v.abortion?.lossType]);
  show('abortion.lmp', 'LMP', v.abortion?.lmp && showDate(v.abortion.lmp));
  show('abortion.weeks', 'Weeks at presentation', v.abortion?.weeks);
  show('abortion.antiD', 'Anti-D', ANTI_D[v.abortion?.antiD]);
  const ob = v.obstetric ?? {};
  const formula = [['G', 'gravida'], ['P', 'para'], ['L', 'living'], ['A', 'abortions']].filter(([, k]) => ob[k] !== undefined).map(([l, k]) => ({ path: `obstetric.${k}`, text: `${l}${ob[k]}` }));
  const cs = ob.previousCaesareans;
  const csPiece = cs !== undefined ? [{ path: 'obstetric.previousCaesareans', text: `${cs} previous caesarean${cs === '1' ? '' : 's'}` }] : [];
  const obText = [formula.map((x) => x.text).join(' '), csPiece[0]?.text ?? ''].filter(Boolean).join(', ');
  if (obText) found.push({ label: 'Obstetric history', text: obText, part: 'clinical', pieces: [...formula, ...csPiece] });
  show('obstetric.pastComplications', 'Problems in previous pregnancies', list('obstetric.pastComplications', PAST_COMPLICATION_LABELS), {
    ticks: ticks('obstetric.pastComplications', PAST_COMPLICATION_LABELS),
  });
  show('obstetric.complicationsReviewed', 'Problems in previous pregnancies', 'None of these');
  show('medical.bloodGroup', 'Blood group', v.medical?.bloodGroup && mine('medical.bloodGroup', v.medical.bloodGroup));
  show('medical.heightCm', 'Height', v.medical?.heightCm && mine('medical.heightCm', `${v.medical.heightCm} cm`));
  show('medical.weightKg', 'Weight', `${v.medical?.weightKg} kg`);
  show('medical.conditions', 'Existing conditions', list('medical.conditions', CONDITION_LABELS), { ticks: ticks('medical.conditions', CONDITION_LABELS) });
  show('medical.conditionsReviewed', 'Existing conditions', 'No known conditions');
  show('medical.otherConditions', 'Other conditions', pieces('medical.otherConditions').map((t) => t.text).join('; '), { pieces: pieces('medical.otherConditions') });
  show('medical.allergies', 'Allergies', v.medical?.allergies);
  show('notes', 'Notes', pieces('notes').map((t) => t.text).join('; '), { pieces: pieces('notes') });
  return { values: f.values, paths: f.paths, found };
}

/** What choosing `value` for a question (or "Add to notes") puts into the form: { values, paths, found }. */
export function answerToResult(question, value, careType) {
  const f = newFindings(careType);
  applyMeaning(f, value, question?.data);
  return finish(f);
}

// ---------- Individual details (each returns what it found and where in the text) ----------
// A newborn's mother: "baby of Asha …", "baby of mother Asha …", "mother('s) name Asha …"
const MOTHER_OF_BABY = /\bbaby\s+of\s+(?:mother\s+)?([^\n]+)/i;
const MOTHER_NAMED = /\bmother(?:'?s)?(?:\s+name)?\s*(?:is|:|-)?\s+([^\n]+)/i;
function findName(s, careType) {
  // `ahead`: the name was read ahead (not part of m[0]), so every "name" said is tried
  const tryAt = (m, group, ahead = false) => {
    if (!m) return null;
    const raw = m[group];
    const at = m.index + m[0].length - (ahead ? 0 : raw.length);
    const got = cleanName(raw);
    return got && { name: got.name, start: m.index, end: at + got.length };
  };
  // "name …" (also "name, uh, …") – but not the husband's, mother's, father's or baby's name, said before hers
  let explicit = null;
  for (const m of s.matchAll(/\b(?:patient'?s?\s+)?name\b\s*(?:is|:|-|,)?\s*(?=([^\n]+))/gi)) {
    if (/\b(?:husband|mother|father|baby|wife|son|daughter|hospital|doctor|dr)(?:'?s)?\s*$/i.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
    explicit = tryAt(m, 1, true);
    if (explicit) break;
  }
  if (explicit || careType === 'newborn') return explicit;
  const found =
    tryAt(s.match(/\bpatient\s+(?:is|:)\s+(?:mrs\.?\s+|ms\.?\s+|smt\.?\s+|miss\s+)?([^\n]+)/i), 1) ??
    // a title – but "MS" in capitals is mitral stenosis
    tryAt([...s.matchAll(/\b(?:mrs|ms|miss|misses|smt|shrimati|shreemati|sau|sou|kumari|km)\.?\s+(?!carriage)([^\n]+)/gi)].find((m) => !/^MS\b/.test(m[0])), 1); // not "miss carriage"
  if (found) return found;
  // "Asha Sample, 28 years …" / "Asha Sample age 28 …" at the start
  const lead = s.match(/^\s*(?:patient\s+)?([a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*){1,3}?)(?=\s*[,.]|\s+(?:is\s+(?:a\s+)?)?(?:age|aged)\b|\s+(?:is\s+(?:a\s+)?)?\d{1,3}[\s-]*(?:years?|yrs?|y\b|\/f\b))/i);
  if (!lead) return null;
  const words = lead[1].split(/\s+/);
  const byComma = /^\s*[,.]/.test(s.slice(lead.index + lead[0].length));
  if (words.some((w) => NOT_NAME.has(w.toLowerCase()) || SHORT_FORMS.has(w.toUpperCase()) || COMMON_WORDS.has(w.toLowerCase()) || TERM_WORDS.has(w.toLowerCase()))) return null;
  if (/^\s*\d{1,3}\s*(?:years?|yrs?)\s+(?:back|ago|before)\b/i.test(s.slice(lead.index + lead[0].length))) return null; // "previous LSCS 3 years back"
  if (byComma && !words.every((w) => /^[A-Z]/.test(w))) return null; // only capitalised words before a comma
  const start = lead.index + lead[0].length - lead[1].length;
  return { name: words.map(capitalise).join(' '), start, end: start + lead[1].length };
}

// Whose age: 'hers', 'theirs' or 'unsure'. One said after the husband or another family member, with no "she",
// "patient" or her own name in between, is not surely hers: said right after them ("husband Ramesh age 34", "husband
// Umar 32 years") it is theirs; said further on ("… Ramesh age 34 Sunita 26 years") it may be either.
// "Family history" is not a person.
const FAMILY_PERSON = new RegExp(`\\b(?:${FAMILY_PEOPLE})\\b`, 'gi');
function ageOwner(s, start, name) {
  if (!aboutFamily(s, start, FAMILY_PERSON)) return 'hers';
  const from = segmentStart(s, start);
  const last = [...s.slice(from, start).matchAll(FAMILY_PERSON)].pop();
  const after = from + last.index + last[0].length;
  if (name && name.start >= after && name.start < start) return 'hers';
  const between = s.slice(after, start).trim();
  return !/\d/.test(between) && between.split(/\s+/).length <= 4 ? 'theirs' : 'unsure';
}

// { age: the patient's age ({ age, start, end }) or null, others: the other ages said (left alone), ask: the ages to
// ask about, or null }. Hers when surely hers; else, when only one age was said, or only one not right after the
// family member, that one (as before: "husband name Mohan Iyer age 27" is hers, and so is the 26 in "husband Umar
// 32 years age 26"); else asked, never a guess.
function findAge(s, name) {
  const strong = [
    /\b(?:age|aged)\s*(?:is|of|:|-|=)?\s*(\d{1,3})(?!\d)(?!\s*(?:weeks?|wks?|days?|months?|w\b))/gi,
    /\b(\d{1,3})\s*-?\s*(?:years?|yrs?|yr|y)\s*-?\s*old\b/gi,
    /\b(\d{1,3})\s*(?:y\/o|yo|y\.o\.?)(?!\w)/gi,
    /\b(\d{1,3})\s*(?:years?|yrs?|y)?\s*\/\s*f\b/gi, // "28/F", "28 yrs/F"
  ];
  const all = [];
  const add = (m) => {
    const start = m.index;
    const end = start + m[0].length;
    if (!all.some((a) => start < a.end && end > a.start)) all.push({ age: Number(m[1]), start, end, owner: ageOwner(s, start, name) });
  };
  for (const rx of strong) for (const m of s.matchAll(rx)) add(m);
  // "28 years" – but not "married for 5 years" or "5 years ago"
  for (const m of s.matchAll(/\b(\d{1,3})\s*(?:years?|yrs?)\b(?!\s*(?:ago|back|of\s+marriage|since))/gi)) {
    if (/\b(?:for|since|married|ago|over|past|last|after|before|within|about|nearly|almost|in)\s*$/i.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
    add(m);
  }
  const values = (list) => [...new Set(list.map((a) => a.age))];
  const unsure = all.filter((a) => a.owner === 'unsure');
  const age = all.find((a) => a.owner === 'hers') ?? (values(all).length === 1 ? all[0] : values(unsure).length === 1 ? unsure[0] : null);
  const others = all.filter((a) => a !== age);
  return { age: age ?? null, others, ask: age || !all.length ? null : values(all) };
}

// A number said just before a unit or ending ("10 weeks", "28 years", "2nd") belongs to that detail, not to a phone number
const NOT_PHONE_GROUP =
  /^(?:[a-z]|\s*(?:weeks?|wks?|months?|days?|years?|yrs?|hours?|hrs?|kgs?|kilos?|kilograms?|grams?|gms?|cms?|times|abortions?|deliver\w*|pregnan\w*|kids?|child\w*|bab(?:y|ies))\b)/i;

// A phone number said as digit groups ("98765 43210", "+91 98765-43210", "9 8 7 6 5 …"): { digits, plus, length }
// (length = characters of `text` used), or null. A comma is allowed once, between two groups of 5 ("98765, 43210").
// A group followed by a unit is left out, so "98765 432 10 weeks" is 8 digits, not a whole number.
function takePhone(text) {
  const m = text.match(/^\s*(\+?\s*\d[\d\s-]*)/);
  if (!m) return null;
  const plus = m[1].trim().startsWith('+');
  let digits = '';
  let length = m[0].length - m[1].length;
  const add = (run) => {
    for (const token of run.split(/(?=[\s-])/)) {
      const d = token.replace(/\D/g, '');
      if (d) {
        if (NOT_PHONE_GROUP.test(text.slice(length + token.length))) return;
        const target = digits.startsWith('91') && (plus || digits.length + d.length > 10) ? 12 : digits.startsWith('0') ? 11 : 10;
        if (digits.length >= target) return;
        digits += d;
      }
      length += token.length;
    }
  };
  add(m[1]);
  const more = digits.length === 5 && text.slice(length).match(/^\s*,\s*(\d[\d\s-]*)/);
  if (more && more[1].replace(/\D/g, '').length >= 5) {
    length += more[0].length - more[1].length;
    add(more[1]);
  }
  return { digits, plus, length: length - (text.slice(0, length).match(/[\s,-]+$/)?.[0].length ?? 0) };
}

// A phone number is used only when it is complete: 10 digits starting 6–9, 0 + 10 digits, or 91 + 10 digits.
function phoneFromDigits(digits) {
  if (/^[6-9]\d{9}$/.test(digits)) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `${digits.slice(1, 6)} ${digits.slice(6)}`; // a mobile said with a 0 first
  if (/^0\d{10}$/.test(digits)) return digits; // a landline with its area code
  if (/^91[6-9]\d{9}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return null;
}

// The same number however it was said: "+91 98765 43210" = "098765 43210" = "98765 43210"
const phoneKey = (phone) => String(phone).replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');

// "cell" (pus cell) and "ph" (urine pH) are a phone only with "number" or "no" after them
const PHONE_WORD =
  /\b(?:(?:phone|mobile|contact|mob|tel(?:ephone)?|landline|whats\s?app)\b\.?(?:\s*(?:number|no\.?|num|nos?))?|(?:cell|ph)\.?\s*(?:number|no\.?|num|nos?)|husband'?s?\s+(?:number|no))\s*(?:is|:|-)?/gi;
// { phone, digits, start, end }; `phone` is null when the digits heard are not a whole number (a note says so)
function findPhone(s) {
  for (const m of s.matchAll(PHONE_WORD)) {
    const got = takePhone(s.slice(m.index + m[0].length));
    if (got && got.digits.length >= 2) return { phone: phoneFromDigits(got.digits), digits: got.digits, start: m.index, end: m.index + m[0].length + got.length };
  }
  // No keyword: a 10-digit mobile number (starting 6–9), perhaps with +91. Inside digits said one by one it may only
  // follow a 6-digit pincode ("4 1 1 0 5 7 9 8 7 6 …"); any other split is not guessed, and a note asks.
  for (const run of s.matchAll(/\+?\d[\d\s-]*\d/g)) {
    let offset = 0;
    let unsure = null;
    for (const token of run[0].split(/(?=[\s-])/)) {
      const got = takePhone(s.slice(run.index + offset)); // the whole rest, so a unit after the digits is seen
      const phone = got && phoneFromDigits(got.digits);
      if (phone && !phone.startsWith('0')) {
        const start = run.index + offset;
        const end = start + got.length;
        // single digits said on past either edge of the number: only a whole pincode (6) may be left over
        const said = s.slice(start, end).trim();
        const before = /^\d[\s-]/.test(said) ? (s.slice(run.index, start).match(/(?:^|[\s-])\d(?:[\s-]+\d)*[\s-]*$/)?.[0] ?? '') : '';
        const after = /[\s-]\d$/.test(said) ? (s.slice(end).match(/^[\s-]+\d(?:[\s-]+\d)*(?!\d)/)?.[0] ?? '') : '';
        if ([before, after].every((part) => [0, 6].includes(part.replace(/\D/g, '').length))) return { phone, digits: got.digits, start, end };
        unsure ??= { phone: null, digits: run[0].replace(/\D/g, ''), start: run.index, end: run.index + run[0].length };
      }
      offset += token.length;
    }
    if (unsure) return unsure;
  }
  return null;
}

// The address (where it starts and ends is shared with indianEnglish.js). `phone`: the phone number found, where the
// address ends at the latest.
function findAddress(s, phone) {
  const m = addressStart(s);
  if (!m) return null;
  const from = m.index + m.length;
  const raw = addressAfter(s, from, phone?.phone && phone.start >= from ? phone.start : s.length);
  const address = tidy(tidy(raw).replace(LEADING_FILLER, '').replace(TRAILING_FILLER, ''))
    // A pincode (6 digits) or a flat number (3–4) said digit by digit is joined; any other run stays as heard
    .replace(/\b\d(?:\s+\d){2,}\b/g, (said) => (/^(?:\d{6}|\d{3,4})$/.test(said.replace(/\s+/g, '')) ? said.replace(/\s+/g, '') : said))
    .split(' ')
    .map((w) => (/^[a-z]{3,}$/.test(w) ? capitalise(w) : w))
    .join(' ');
  if (address.length < 3) return null;
  return { address: address.slice(0, 300), start: m.index, end: from + raw.length };
}

// Also "last MC", "last menstrual cycle", "last date" and "periods came on" (a date must follow, owner decision 5)
const LMP_RX =
  /\b(?:lmp|l\.?\s?m\.?\s?p\.?|last\s+menstrual\s+(?:period|cycle)|last\s+menses|last\s+menstruation|last\s+(?:monthly\s+)?period|last\s+mc|last\s+date|periods?\s+came\s+on)\b/gi;
const EDD_RX = /\b(?:c?edd|e\.?\s?d\.?\s?d\.?|expected\s+date\s+of\s+delivery|due\s+date)\b/gi;
const SCAN_WORD = /\b(?:scan|usg|ultrasound|sonography|dating|corrected|revised|nt)\b/i;
const SCAN_AFTER = /^\s*,?\s*(?:(?:by|as\s+per|per|according\s+to|from|on)\s+(?:the\s+)?)?(?:(?:dating|early|1st\s+trimester|nt|first\s+trimester)\s+)?(?:scan|usg|ultrasound|sonography)\b/i;

// ---------- The OBGY terms, the doctor's own words and the unclear ones ----------
const EDGE_L = '(?<![a-z0-9])';
const EDGE_R = '(?![a-z0-9])';
// Longer ways of saying it first, so "HELLP syndrome" wins over "HELLP".
// Any finding (for a list said after "no" without commas, and where an allergy ends)
const ANY_TERM_G = new RegExp(`${EDGE_L}(?:${TERMS.flatMap((t) => t.says).sort((a, b) => b.length - a.length).map(sayPattern).join('|')})${EDGE_R}`, 'gi');
// A comma followed by another finding (for lists such as "allergic to sulpha, twins DCDA")
const ANY_TERM_AFTER_COMMA = new RegExp(`,\\s*(?=(?:${TERMS.flatMap((t) => t.says).map(sayPattern).join('|')})${EDGE_R})`, 'i');
const TERM_RX = TERMS.map((t) => ({ term: t, rx: new RegExp(`${EDGE_L}(?:${[...t.says].sort((a, b) => b.length - a.length).map(sayPattern).join('|')})${EDGE_R}`, 'gi') }));

const opt = (value, label) => ({ value, label });
const IGNORE = opt('ignore', 'Ignore');
const LEAVE_BLANK = opt('ignore', 'Leave blank');
const pregnancyCare = (careType) => PREGNANCY_CARE.includes(careType);

// ---------- The confirmation card (plan 2.6): results, and a blood group not heard plainly, are never filled silently ----------
// A reactive or positive HIV, HBsAg, VDRL, RPR, TPHA or HCV result is ticked only after "Yes, reactive"; a blood group
// (with its Rh) after one tap. These questions have no "Remember" (a result is never learned as a word).
const RESULT_MEANINGS = new Set(TERMS.filter((t) => t.result && /^condition:(?:hiv|hepatitis_b|syphilis)$/.test(t.to)).map((t) => t.to));
function resultCard(meaning, heard, saidPositive) {
  return {
    group: 'confirm',
    prompt: saidPositive ? `${heard} reactive (positive) – is that right?` : `${heard}: reactive (positive) or non-reactive (negative)?`,
    options: [opt(meaning, saidPositive ? 'Yes, reactive' : 'Reactive'), opt('ignore', saidPositive ? 'No, non-reactive' : 'Non-reactive'), LEAVE_BLANK],
  };
}
const bloodCard = (group) => ({ group: 'confirm', prompt: `Blood group ${group} – is that right?`, options: [opt(`blood:${group}`, 'Yes, correct'), LEAVE_BLANK] });

// What has been found already – so "PIH on labetalol" doesn't also ask what the labetalol is for.
const hasCondition = (f, key) => (f.values.medical?.conditions ?? []).includes(key);
const isTicked = (f, meaning) => {
  const [kind, key] = meaning.split(':');
  return (kind === 'condition' && hasCondition(f, key)) || (kind === 'past' && (f.values.obstetric?.pastComplications ?? []).includes(key));
};
const hasText = (f, path, rx) => f.texts[path].some((t) => rx.test(t.text));
const has = {
  diabetes: (f) => hasCondition(f, 'diabetes') || hasText(f, 'notes', /gestational diabetes/i),
  hypertension: (f) => hasCondition(f, 'hypertension') || hasText(f, 'notes', /hypertension|PIH|pre-eclampsia/i),
};

// High BP said about a previous pregnancy ("previous PIH", "BP was high in the last pregnancy")
const PAST_PIH_QUESTION = {
  prompt: 'In a previous pregnancy – was it pre-eclampsia?',
  options: [opt('past:pre_eclampsia', 'Yes – pre-eclampsia in a previous pregnancy'), opt('note:High BP (PIH) in a previous pregnancy', 'High BP only – add to notes'), IGNORE],
};

// Said straight after "anti-D given" (a spoken "sorry" is already gone): a change – "no", "not yet", "(sorry) not given",
// "(I mean) due at 34 weeks" – or, after its weeks, other weeks with no "sorry" ("at 28 weeks 30 weeks"). "Sorry, 30
// weeks" itself is a self-correction (indianEnglish.js), so the text already says 30.
const ANTI_D_RUN = String.raw`(?:\s+(?:no|not|yet|given|due|taken|done|received|administered|pending|at|in|on|after|\d{1,2}|weeks?|wks?))*`;
const ANTI_D_CHANGED = new RegExp(
  String.raw`^\s*,?\s*(?:(?:sorry|i\s+mean|matlab|given|due|taken|received|administered)\b${ANTI_D_RUN}|(?:no|not|nahi|pending|yet)\b${ANTI_D_RUN}(?=\s*(?:$|[,.;])))`,
  'i',
);
const ANTI_D_WEEKS_AGAIN = /^\s*,?\s*(?:(?:at|in)\s+)?\d{1,2}\s*(?:weeks?|wks?)\b/i;

// High BP said in a pregnancy without saying when it started
const BEFORE_OR_PIH_QUESTION = {
  prompt: 'High blood pressure from before this pregnancy, or of this pregnancy (PIH)?',
  options: [opt('condition:hypertension', 'High BP before pregnancy'), opt('note:Gestational hypertension / PIH (this pregnancy)', 'PIH – this pregnancy (notes)'), IGNORE],
};
// "history of BP in (her) mother": a family member's
const BP_FAMILY_AFTER = new RegExp(`^\\s*(?:in|of|to)\\s+(?:her\\s+|the\\s+)?(?:family|${FAMILY_PEOPLE})\\b`, 'i');
// BP said with this pregnancy: "in this pregnancy", "since pregnancy", "from 20 weeks", "since 6 months", a drug used in
// pregnancy – never "since 3 years"
const BP_THIS_PREGNANCY =
  /\b(?:(?:this|present|current)\s+pregnancy|(?:since|from|during|in)\s+(?:the\s+)?pregnancy|(?:since|from|at)\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:weeks?|wks?|months?)|labetalol|labebet|nifedipine|nicardia|depin|methyldopa|aldomet|alphadopa)\b/i;
const PIH_SAID = /\b(?:pih|pregnancy[\s-]*induced\s+hypertension|gestational\s+hypertension|ghtn|pre-?eclampsia)\b/gi;

// Terms that need a question (or depend on the type of care). Each returns { meaning } | { question } | null.
// `late`: looked at after everything else, and `skip`ped when what it would ask is already known. `treatment`: a
// treatment given, so a test's result said after it is that test's ("anti-D given, ICT negative"), not its "no".
const SPECIALS = [
  {
    // "BP" said as an illness – "known case of BP", "h/o BP", "BP patient", "on BP tablets", "BP ki bimari" – is
    // high blood pressure from before: ticked (owner decision 1). Not low BP, nor a family member's said after it
    // ("history of BP in mother"). Said with this pregnancy ("since 28 weeks", "in this pregnancy", on labetalol) it is
    // asked, as "BP high" is (below); with PIH said, the PIH note is enough.
    maternal: true,
    rx: /\b(?:(?:known\s+case\s+of|history\s+of)\s+bp|bp\s+patient|(?:on|taking)\s+bp\s+(?:tablets?|medicines?|medication)|bp\s+ki\s+bimari)\b/gi,
    resolve: (m, ctx) => {
      const end = m.index + m[0].length;
      if (pastAttached(ctx.s, m.index, end)) return { question: PAST_PIH_QUESTION };
      const before = ctx.s.slice(Math.max(clauseStart(ctx.s, m.index), m.index - 30), m.index);
      const after = ctx.s.slice(end, Math.min(clauseEnd(ctx.s, end), end + 50));
      if (/\blow\s*$/i.test(before) || /^\s*(?:is\s+|was\s+)?low\b/i.test(after)) return null;
      if (BP_FAMILY_AFTER.test(after)) return { family: true };
      const pih = [...ctx.s.matchAll(PIH_SAID)].some((x) => !pastAttached(ctx.s, x.index, x.index + x[0].length));
      if (pih) return null;
      if (pregnancyCare(ctx.careType) && BP_THIS_PREGNANCY.test(`${before} ${m[0]} ${after}`)) return { question: BEFORE_OR_PIH_QUESTION };
      return { meaning: 'condition:hypertension' };
    },
  },
  {
    // Anti-D given (or due), with the weeks when they are said: "anti-D given at 28 weeks" (Chrome's "NTD given" is
    // made anti-D in indianEnglish.js). Said about a previous pregnancy, it is an other condition. Always hers, even
    // after "husband B positive" in the same run of words. Changed straight after ("given no", "given sorry not given"):
    // asked, never noted as given; "at 28 weeks sorry 30 weeks" notes the 30.
    // Abortion care (this loss, not recurrent loss): it fills the section's Anti-D field – given, or due = "not given
    // yet" – so the "Rh negative – anti-D" reminder goes when it is given. The weeks are left out there, and the date
    // given is left for the doctor.
    treatment: true,
    rx: /\banti[\s-]*d\s+(?:(?:injection|inj|dose)\s+)?(given|taken|administered|received|due)\b(?:\s+(?:at|in)\s+(\d{1,2})\s*(?:weeks?|wks?)\b)?/gi,
    resolve: (m, ctx) => {
      if (!pregnancyCare(ctx.careType) && ctx.careType !== 'abortion') return null; // abortion care: anti-D matters too
      const end = m.index + m[0].length;
      const past = pastAttached(ctx.s, m.index, end);
      const field = ctx.careType === 'abortion' && !past && ctx.f.values.abortion?.lossType !== 'recurrent';
      const labelOf = (status, weeks) => `Anti-D ${/^due$/i.test(status) ? 'due' : 'given'}${weeks && !field ? ` at ${Number(weeks)} weeks` : ''}`;
      const meaningOf = (label) =>
        field ? `value:abortion.antiD=${/due$/.test(label) ? 'not_yet' : 'given'}` : past ? `other:Previous pregnancy – ${label}` : `note:${label}`;
      const label = labelOf(m[1], m[2]);
      const after = ctx.s.slice(end, clauseEnd(ctx.s, end));
      const changed = after.match(ANTI_D_CHANGED) ?? (m[2] ? after.match(ANTI_D_WEEKS_AGAIN) : null);
      if (!changed) return { meaning: meaningOf(label) };
      ctx.use(end, end + changed[0].length);
      // What was said instead ("due at 34 weeks", "30 weeks") is offered too, never a "not given"
      const status = changed[0].match(/\b(?:given|due|taken|received|administered)\b/i)?.[0];
      const weeks = changed[0].match(/\b(\d{1,2})\s*(?:weeks?|wks?)\b/i)?.[1];
      const instead = !/\b(?:no|not|nahi|pending|yet)\b/i.test(changed[0]) && (status || weeks) && labelOf(status ?? m[1], weeks ?? (status ? null : m[2]));
      return {
        heard: ctx.s.slice(m.index, end + changed[0].length).trim(),
        question: {
          prompt: 'Anti-D – given, due, or not given yet?',
          options: [
            opt(meaningOf(label), label),
            ...(instead && instead !== label ? [opt(meaningOf(instead), instead)] : []),
            opt(field ? 'value:abortion.antiD=not_yet' : past ? 'other:Previous pregnancy – Anti-D not given' : 'note:Anti-D not given yet', 'Not given yet'),
            IGNORE,
          ].filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i), // abortion care: "due" is "not given yet"
        },
      };
    },
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => has.diabetes(ctx.f),
    rx: /\b(?:sugar(?:\s+(?:patient|problem|disease))?|high\s+sugar)\b/gi,
    resolve: (m, ctx) =>
      pregnancyCare(ctx.careType)
        ? {
            question: {
              prompt: 'Diabetes from before this pregnancy, or diabetes of this pregnancy (GDM)?',
              options: [opt('condition:diabetes', 'Diabetes before pregnancy'), opt('note:Gestational diabetes (this pregnancy)', 'GDM – this pregnancy (notes)'), IGNORE],
            },
          }
        : { meaning: 'condition:diabetes' },
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => has.hypertension(ctx.f),
    // also "BP high", "BP is high", "BP ki problem" (plan G5.1)
    rx: /\b(?:high\s+bp|raised\s+bp|bp\s+(?:patient|problems?|tablets?|medicines?|medication)|bp\s+(?:is\s+|was\s+|remains\s+)?(?:high|raised|elevated|increased)|bp\s+(?:ki|ka|ke)\s+(?:problem|bimari|tablets?|goli|dawai)|known\s+case\s+of\s+bp|has\s+bp|antihypertensives?)\b/gi,
    resolve: (m, ctx) =>
      // "BP was high in the last pregnancy" is about a previous pregnancy (not "high BP before pregnancy")
      pastAttached(ctx.s, m.index, m.index + m[0].length)
        ? { question: PAST_PIH_QUESTION }
        : pregnancyCare(ctx.careType)
        ? { question: BEFORE_OR_PIH_QUESTION }
        : {
            // "BP high", "BP tablets" … outside a pregnancy: asked, never ticked by itself ("BP patient" is ticked above)
            question: { prompt: 'High blood pressure (hypertension)?', options: [opt('condition:hypertension', 'Yes – high BP'), IGNORE] },
          },
  },
  {
    maternal: true,
    rx: /\b(?:pih|pregnancy[\s-]*induced\s+hypertension|gestational\s+hypertension|ghtn)\b/gi,
    resolve: (m, ctx) =>
      !pregnancyCare(ctx.careType) || whenSaid(ctx.s, m.index, m.index + m[0].length) === 'past'
        ? { question: PAST_PIH_QUESTION }
        : { meaning: 'note:Gestational hypertension / PIH (this pregnancy)' },
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => has.diabetes(ctx.f),
    rx: /\binsulin\b/gi,
    resolve: (m, ctx) =>
      pregnancyCare(ctx.careType)
        ? {
            question: {
              prompt: 'Insulin for diabetes from before pregnancy, or for GDM?',
              options: [opt('condition:diabetes', 'Diabetes before pregnancy'), opt('note:Gestational diabetes on insulin (this pregnancy)', 'GDM – this pregnancy (notes)'), IGNORE],
            },
          }
        : { meaning: 'condition:diabetes' },
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => has.diabetes(ctx.f) || hasText(ctx.f, 'medical.otherConditions', /PCOS/i),
    rx: /\b(?:metformin|glycomet|glyciphage)\b/gi,
    resolve: (m, ctx) => ({
      question: {
        prompt: 'What is the metformin for?',
        options: [
          opt('condition:diabetes', 'Diabetes'),
          opt('other:PCOS', 'PCOS'),
          ...(pregnancyCare(ctx.careType) ? [opt('note:Gestational diabetes on metformin (this pregnancy)', 'GDM – this pregnancy (notes)')] : []),
          IGNORE,
        ],
      },
    }),
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => has.hypertension(ctx.f),
    rx: /\b(?:labetalol|labebet|nifedipine|nicardia|depin|methyldopa|aldomet|alphadopa|amlodipine)\b/gi,
    resolve: (m, ctx) => {
      if (!pregnancyCare(ctx.careType)) return { meaning: 'condition:hypertension' };
      const tocolytic = /nifedipine|nicardia|depin/i.test(m[0]);
      return {
        question: {
          prompt: `What is the ${m[0].toLowerCase()} for?`,
          options: [
            opt('condition:hypertension', 'High BP before pregnancy'),
            opt('note:Gestational hypertension / PIH (this pregnancy)', 'PIH – this pregnancy (notes)'),
            ...(tocolytic ? [opt('note:Preterm labour (this pregnancy)', 'Preterm labour (notes)')] : []),
            IGNORE,
          ],
        },
      };
    },
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => ['autoimmune', 'thrombophilia', 'heart_disease'].some((k) => hasCondition(ctx.f, k)) || hasText(ctx.f, 'medical.otherConditions', /DVT/i),
    rx: /\b(?:heparin|lmwh|enoxaparin|clexane|lonopin|fondaparinux)\b/gi,
    resolve: () => ({
      question: {
        prompt: 'What is the heparin for?',
        options: [
          opt('condition:autoimmune', 'APS / APLA'),
          opt('condition:thrombophilia', 'Thrombophilia'),
          opt('condition:heart_disease', 'Heart valve / heart disease'),
          opt('other:Previous DVT / pulmonary embolism', 'Previous DVT / PE'),
          IGNORE,
        ],
      },
    }),
  },
  {
    rx: /\bART\b/g,
    resolve: (m, ctx) =>
      ctx.careType === 'infertility'
        ? null
        : {
            question: {
              prompt: 'Antiretroviral therapy, or assisted reproduction?',
              options: [opt('condition:hiv', 'Antiretroviral therapy – HIV'), opt('note:Conceived by IVF / ICSI', 'Conceived by ART / IVF (notes)'), IGNORE],
            },
          },
  },
  {
    // Read last, and not asked when heart disease is already ticked ("RHD with severe MS", plan G5.3)
    maternal: true,
    late: true,
    skip: (ctx) => hasCondition(ctx.f, 'heart_disease'),
    rx: /\bMS\b/g,
    resolve: () => ({
      question: { key: 'ms', remember: true, prompt: 'Which does it mean?', options: [opt('condition:heart_disease', 'Mitral stenosis'), opt('other:Multiple sclerosis', 'Multiple sclerosis'), IGNORE] },
    }),
  },
  {
    maternal: true,
    rx: /\bRA\b/g,
    resolve: () => ({ question: { key: 'ra', remember: true, prompt: 'Rheumatoid arthritis?', options: [opt('condition:autoimmune', 'Rheumatoid arthritis'), IGNORE] } }),
  },
  {
    rx: /\bPE\b/g,
    resolve: (m, ctx) => ({
      question: {
        prompt: 'Pre-eclampsia, or pulmonary embolism?',
        options: [
          opt('past:pre_eclampsia', 'Pre-eclampsia in a previous pregnancy'),
          ...(pregnancyCare(ctx.careType) ? [opt('note:Pre-eclampsia (this pregnancy)', 'Pre-eclampsia – this pregnancy (notes)')] : []),
          opt('other:Previous DVT / pulmonary embolism', 'Pulmonary embolism'),
          IGNORE,
        ],
      },
    }),
  },
  {
    rx: /\bIUD\b/gi,
    resolve: (m, ctx) => {
      const around = ctx.s.slice(segmentStart(ctx.s, m.index), segmentEnd(ctx.s, m.index + m[0].length));
      if (/copper|cu-?\s?t\b|in\s+situ|insert|remov|contracept/i.test(around)) return null;
      if (whenSaid(ctx.s, m.index, m.index + m[0].length) === 'past') return { meaning: 'past:stillbirth_or_neonatal_death' };
      return {
        question: {
          prompt: 'Intrauterine death, or a contraceptive device?',
          options: [
            opt('past:stillbirth_or_neonatal_death', 'Intrauterine death in a previous pregnancy'),
            ...(ctx.careType === 'antenatal' ? [opt('note:Intrauterine fetal death (this pregnancy)', 'Intrauterine death – this pregnancy (notes)')] : []),
            opt('ignore', 'Contraceptive device (Copper T) – ignore'),
          ],
        },
      };
    },
  },
  {
    rx: /\bSB\b/g,
    resolve: () => ({
      question: {
        key: 'sb',
        remember: true,
        prompt: 'Stillbirth, or spina bifida?',
        options: [opt('past:stillbirth_or_neonatal_death', 'Stillbirth in a previous pregnancy'), opt('past:congenital_anomaly', 'Spina bifida (baby with an anomaly)'), IGNORE],
      },
    }),
  },
  {
    maternal: true,
    late: true,
    skip: (ctx) => hasCondition(ctx.f, 'thyroid'),
    rx: /\bhypo\b/gi,
    resolve: () => ({ question: { key: 'hypo', remember: true, prompt: 'Hypothyroidism?', options: [opt('condition:thyroid', 'Hypothyroidism'), IGNORE] } }),
  },
  {
    // "Operation" can mean other surgery, so a previous caesarean is asked about, never assumed (owner decision 2)
    maternal: true,
    late: true,
    skip: (ctx) => ctx.f.values.obstetric?.previousCaesareans !== undefined,
    // In postnatal care "cut delivery" is usually this delivery, so there only "previous operation" is asked about
    rx: /\b(?:previous\s+operation|(?:operation|operated|cut)\s+delivery|delivery\s+by\s+operation)\b/gi,
    resolve: (m, ctx) =>
      ctx.careType === 'postnatal' && !/^previous/i.test(m[0])
        ? null
        : {
            question: {
              group: 'safety',
              prompt: 'A previous caesarean?',
              options: [opt('value:obstetric.previousCaesareans=1', 'Yes, 1 previous caesarean'), opt('ignore', 'No, other surgery')],
            },
          },
  },
  {
    // "Syrian" is a word, so "previous Syrian" is asked about, never filled (plan 2.3 step 8); "by / emergency Syrian" in
    // postnatal care is this delivery
    maternal: true,
    late: true,
    skip: (ctx) => ctx.f.values.obstetric?.previousCaesareans !== undefined || hasText(ctx.f, 'notes', /caesarean/i),
    rx: /\b(?:previous|prior|by|emergency)\s+syrian\b/gi,
    resolve: (m, ctx) =>
      ctx.careType === 'postnatal' && !/^(?:previous|prior)/i.test(m[0])
        ? { question: { prompt: 'Delivered by caesarean?', options: [opt('note:Delivered by caesarean section', 'Yes – delivered by caesarean (notes)'), IGNORE] } }
        : {
            question: {
              group: 'safety',
              prompt: 'A previous caesarean?',
              options: [opt('value:obstetric.previousCaesareans=1', 'Yes, 1 previous caesarean'), opt('ignore', 'No')],
            },
          },
  },
  {
    // Haemoglobin: anaemia below 11 g/dL in pregnancy, 12 otherwise (WHO) – the doctor confirms.
    late: true,
    skip: (ctx) => hasCondition(ctx.f, 'anaemia'),
    rx: /\b(?:hb|haemoglobin|hemoglobin)\s*(?:is|of|:|-|=)?\s*(\d{1,2}(?:\.\d)?)\s*(?:g\/?dl|gm%|g%|gm|grams?)?(?![\d.])/gi,
    resolve: (m, ctx) => {
      const hb = Number(m[1]);
      if (hb < 3 || hb >= (ctx.careType === 'antenatal' ? 11 : 12)) return null;
      return { question: { prompt: `Hb ${hb} g/dL – anaemia?`, options: [opt('condition:anaemia', 'Yes – anaemia'), opt('ignore', 'No')] } };
    },
  },
  {
    // Fits said about a pregnancy may be eclampsia rather than epilepsy.
    rx: /\b(?:fits|convulsions|seizures)\b(?=[^.;]{0,40}\b(?:pregnan\w*|deliver\w*|labou?r)\b)|\b(?:pregnan\w*|deliver\w*|labou?r)\b[^.;]{0,40}\b(?:fits|convulsions|seizures)\b/gi,
    resolve: () => ({
      question: {
        prompt: 'Eclampsia, or epilepsy?',
        options: [opt('past:pre_eclampsia', 'Eclampsia in a previous pregnancy'), opt('condition:epilepsy', 'Epilepsy'), IGNORE],
      },
    }),
  },
];

// "previous GDM", "previous pregnancy GDM", "GDM in the last pregnancy": said right next to a past marker (plan G5.7).
// Not "history of" alone: "h/o leaking PV" is usually about now.
function pastAttached(s, start, end) {
  const before = s.slice(Math.max(0, start - 40), start);
  const after = s.slice(end, end + 50);
  return (
    /\b(?:previous|prior|past|last|earlier)\s+(?:(?:pregnancy|pregnancies|delivery|deliveries|time|baby|child|issue)\s+)?(?:(?:was|had|with|of|history\s+of)\s+)?$/i.test(before) ||
    /^\s*(?:in|during)\s+(?:the\s+|her\s+)?(?:previous|prior|last|earlier|1st|2nd|3rd)\s+(?:pregnancy|pregnancies|delivery|baby)\b/i.test(after)
  );
}

// A term from obgyTerms.js said at [start, end): { meaning } | { question } | { meaning, question } (both used) |
// { family: true } | null.
function resolveTerm(term, s, start, end, ctx) {
  const kind = term.to.split(':')[0];
  if (term.only ? !term.only.includes(ctx.careType) : ctx.careType === 'newborn') return null;
  const neg = negated(s, start, end, true, Boolean(term.result));
  if (neg === 'ask' && !term.result) {
    const label = meaningLabel(term.to).replace(/^[^:]+: /, '');
    return { question: { prompt: `“${s.slice(start, end)}” was said right after “no …” – does she have it?`, options: [opt(term.to, `Yes – ${label}`), opt('ignore', 'No')] } };
  }
  if (neg) return null;
  if (term.result) {
    const said = resultAfter(s, end);
    const doubt = doubtfulResult(s, start, end);
    const positive = !doubt && (said === 'positive' || /\b(?:known\s+case\s+of|diagnosed\s+with|positive\s+for|on\s+treatment\s+for)\s+(?:\w+\s+){0,2}$/i.test(s.slice(clauseStart(s, start), start)));
    // A reactive or positive result is never ticked silently, typed or said (plan 2.6, owner decision 3)
    if (ctx.voice || positive) return { question: resultCard(term.to, s.slice(start, end), positive), heard: doubt };
    const label = kind === 'condition' ? CONDITION_LABELS[term.to.split(':')[1]] : term.to;
    return { question: { prompt: 'Positive or negative?', options: [opt(term.to, `Positive – tick ${label}`), opt('ignore', 'Negative / not known')] }, heard: doubt };
  }
  const who = (kind === 'condition' || kind === 'other') && !term.couple && aboutFamily(s, start);
  if (who && !(who === 'husband' && HERS_ONLY.test(term.to))) return { family: true };
  if (kind === 'note' && !term.delivery && aboutFamily(s, start, FAMILY_ADULT)) return { family: true };
  // A finding of this pregnancy said about a previous one: an other condition, "Previous pregnancy – …"
  if (kind === 'note' && !term.delivery && pastAttached(s, start, end)) {
    const label = term.to.slice('note:'.length).replace(/\s*\((?:this|suspected)[^)]*\)/i, '');
    const past = { meaning: `other:Previous pregnancy – ${label}` };
    // Said about this pregnancy too ("… in the previous pregnancy and also this pregnancy", "… now again"): asked, so this
    // pregnancy's finding is never dropped (and never filled from a vague "now"). Not when the finding is said again
    // for this pregnancy ("previous GDM, now also GDM on metformin"): that one fills the note.
    const clause = s.slice(clauseStart(s, start), start) + s.slice(end, clauseEnd(s, end));
    const again = new RegExp(`${EDGE_L}(?:${term.says.map(sayPattern).join('|')})${EDGE_R}`, 'i').test(s.slice(end, clauseEnd(s, end)));
    if (again || !new RegExp(`${NOW_MARK.source}|\\b(?:again|both)\\b`, 'i').test(clause)) return past;
    return { ...past, question: { prompt: `${label} in this pregnancy too?`, options: [opt(term.to, `Yes – ${label}, this pregnancy (notes)`), opt('ignore', 'No')] } };
  }
  const when = kind === 'past' || term.delivery ? whenSaid(s, start, end) : null;
  if (term.delivery && when === 'past') return null;
  if (kind === 'past' && term.now && term.nowIn.includes(ctx.careType)) {
    if (when === 'now') return { meaning: term.now };
    if (when !== 'past') {
      return {
        question: {
          prompt: 'In a previous pregnancy, or in this one?',
          options: [opt(term.to, `Previous pregnancy – tick ${PAST_COMPLICATION_LABELS[term.to.split(':')[1]]}`), opt(term.now, `This ${ctx.careType === 'postnatal' ? 'delivery' : 'pregnancy'} (notes)`), IGNORE],
        },
      };
    }
  }
  return { meaning: term.to };
}

// Every word of every term ("ovarian", "cyst"): a sentence starting with them is not a name
const TERM_WORDS = new Set(TERMS.flatMap((t) => t.says.flatMap((say) => say.toLowerCase().split(/[\s-]+/))).filter((w) => w.length >= 3));
// ---------- Did you mean (a word misheard or mistyped) ----------
// realWordGuard.js also lists the ordinary words and names closestWord would ask about: made from this part of the
// file by client/scripts/make-word-guard.mjs.
// Single words the app knows, for "did you mean …?" when a word was misheard or mistyped.
const VOCAB = new Map(
  TERM_RX.flatMap(({ term }) => term.says.filter((w) => /^[A-Za-z]{5,}$/.test(w) && !isShortForm(w)).map((w) => [w.toLowerCase(), { word: w, term }])),
);
function distance(a, b) {
  // Damerau–Levenshtein (with transpositions), small strings only
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// The word just before the end of `text` when it sounds like "gestational" but is not a word the app knows
// ("jestational"): { start } or null
function soundsGestational(text) {
  const m = text.match(/([A-Za-z]{7,})\s*$/);
  const w = m?.[1].toLowerCase();
  if (!w || w === 'gestational' || w.startsWith('pre') || TERM_WORDS.has(w) || COMMON_WORDS.has(w) || distance(w, 'gestational') > 3) return null;
  return { start: m.index };
}
/** The word the app knows that `word` may be a slip for ("animia" – anaemia?): { word, term, dist } or null. */
export function closestWord(word) {
  const w = word.toLowerCase();
  if (VOCAB.has(w) || COMMON_WORDS.has(w)) return null;
  let best = null;
  for (const [known, entry] of VOCAB) {
    if (known[0] !== w[0] || Math.abs(known.length - w.length) > 2) continue;
    const dist = distance(w, known);
    if (dist <= (known.length >= 8 ? 2 : 1) && (!best || dist < best.dist)) best = { ...entry, dist };
  }
  return best;
}
// ---------- end of did you mean ----------

// ---------- Pregnancy loss (Abortion type of care) ----------
// The types of loss as said. Only loss that was not induced: there is no other value, so nothing else is ever read
// as a type of loss. A loss said with "previous" / "h/o" before it is a past pregnancy (read as usual, not here).
// A threatened miscarriage is not a type of loss (owner, 3 Oct 2026: it stays under Antenatal): said on an Abortion
// page it fills nothing, and the hint to keep her under antenatal care is shown as a note (THREATENED_SAID).
const THREATENED_SAID = /\bthreatened\s+(?:miscarriage|abortion)\b/gi;
const LOSS_SAID = [
  ['inevitable', /\binevitable\s+(?:miscarriage|abortion)\b/gi],
  ['incomplete', /\bincomplete\s+(?:miscarriage|abortion)\b/gi],
  ['complete', /\bcomplete\s+(?:miscarriage|abortion)\b/gi],
  ['missed', /\bmissed\s+(?:miscarriage|abortion)\b/gi],
  ['septic', /\bseptic\s+(?:miscarriage|abortion)\b/gi],
  ['ectopic', /\b(?:ruptured\s+)?(?:ectopic(?:\s+pregnancy)?|tubal\s+pregnancy)\b/gi],
  ['molar', /\b(?:molar\s+pregnancy|hydatidiform\s+mole|vesicular\s+mole|h\s+mole)\b/gi],
  ['recurrent', /\b(?:recurrent\s+(?:pregnancy\s+loss|miscarriages?|abortions?)|rpl)\b/gi],
];
const PAST_BEFORE = /\b(?:previous|prev|prior|past|last|earlier|h\s*\/\s*o|history\s+of)\s+$/i;
/** Where a threatened miscarriage is said as this pregnancy (not "previous …"): [{ start, end }]. */
export function threatenedSaid(s) {
  return [...s.matchAll(THREATENED_SAID)]
    .filter((m) => !PAST_BEFORE.test(s.slice(Math.max(0, m.index - 24), m.index)))
    .map((m) => ({ start: m.index, end: m.index + m[0].length }));
}
/** The types of loss said in the text, in order: [{ key, start, end }]. */
export function lossTypesSaid(s) {
  const hits = [];
  for (const [key, rx] of LOSS_SAID) {
    for (const m of s.matchAll(rx)) {
      if (PAST_BEFORE.test(s.slice(Math.max(0, m.index - 24), m.index))) continue;
      hits.push({ key, start: m.index, end: m.index + m[0].length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ---------- Checks on what was heard (plan 2.6) ----------
// Care where an age of 45 or more, or a teenage age, is worth asking about (a misheard "-ty" / "-teen")
const AGE_CHECK_CARE = ['antenatal', 'postnatal', 'infertility', 'abortion'];
const FORMULA = [['G', 'gravida'], ['P', 'para'], ['L', 'living'], ['A', 'abortions']];
const lmpEdd = (iso) => Date.parse(`${iso}T00:00:00Z`) + 280 * DAY;

/**
 * Checks what was heard against what is possible. A value that fails is not filled silently: it becomes a question
 * (answered with a `value:` meaning, used on this page only) or a note.
 * - values: what was filled; heard: where each value came from ({ age: { value, teen, text, at }, phone: { digits },
 *   height: { cm, alt, text, at }, weight: { kg, text, at }, weeks: { value, text, at }, formula: { text, at, primi }, twins }).
 *   formula.primi: the 0 caesareans came from "primi" alone, so it goes too when the counts cannot be right
 * Returns { drop: [paths not to fill], questions, notes }.
 */
export function checkRanges(values, heard, careType, now = new Date()) {
  const drop = [];
  const questions = [];
  const notes = [];
  const ask = (h, prompt, options, part = 'clinical') => questions.push({ group: 'safety', part, prompt, options, heard: h.text, at: h.at });
  const today = todayUtc(now);

  // Age: "ninety" for "nineteen", "fourteen" for "forty"
  const age = heard.age;
  if (age && values.ageYears !== undefined && AGE_CHECK_CARE.includes(careType)) {
    const v = age.value;
    const other = v >= 50 && v % 10 === 0 ? v / 10 + 10 : v >= 13 && v <= 19 ? (v - 10) * 10 : null;
    if (v >= 45 || (v <= 19 && (age.teen || v <= 14))) {
      drop.push('ageYears');
      const yes = opt(`value:ageYears=${v}`, other ? String(v) : `Yes, ${v}`);
      ask(age, other ? `Age ${v} or ${other}?` : `Age ${v} – is that right?`, [yes, ...(other ? [opt(`value:ageYears=${other}`, String(other))] : []), LEAVE_BLANK], 'info');
    }
  }

  // Phone: only a whole number is filled in
  if (heard.phone && !values.phone) {
    const n = heard.phone.digits.length;
    notes.push(n < 10 ? `Phone heard with only ${n} digits – check it and type it in.` : `Phone heard with ${n} digits – check it and type it in.`);
  }

  // Height 120–200 cm, weight 30–150 kg
  const h = heard.height;
  if (h && values.medical?.heightCm !== undefined && (h.cm < 120 || h.cm > 200)) {
    drop.push('medical.heightCm');
    if (h.alt) ask(h, `Height ${h.alt.label}?`, [opt(`value:medical.heightCm=${h.alt.cm}`, `Yes, ${h.alt.cm} cm`), LEAVE_BLANK]);
    else if (h.cm >= 50 && h.cm <= 250) ask(h, `Height ${h.cm} cm – is that right?`, [opt(`value:medical.heightCm=${h.cm}`, `Yes, ${h.cm} cm`), LEAVE_BLANK]);
    else notes.push(`The height heard (“${h.text.trim()}”) doesn't look right, so it was not used.`);
  }
  const w = heard.weight;
  if (w && values.medical?.weightKg !== undefined && (w.kg < 30 || w.kg > 150)) {
    drop.push('medical.weightKg');
    if (w.kg >= 15 && w.kg <= 250) ask(w, `Weight ${w.kg} kg – is that right?`, [opt(`value:medical.weightKg=${w.kg}`, `Yes, ${w.kg} kg`), LEAVE_BLANK]);
    else notes.push(`The weight heard (“${w.text.trim()}”) doesn't look right, so it was not used.`);
  }

  // Dates: an LMP more than 10 months ago; weeks said that don't fit the dates; a scan EDD far from the LMP's
  const lmp = values.pregnancy?.lmp;
  const scanEdd = values.pregnancy?.scanEdd;
  if (lmp && today - Date.parse(`${lmp}T00:00:00Z`) > 304 * DAY) {
    drop.push('pregnancy.lmp');
    ask(heard.lmp ?? {}, `LMP ${showDate(lmp)} is more than 10 months ago – is that right?`, [opt(`value:pregnancy.lmp=${lmp}`, `Yes, LMP ${showDate(lmp)}`), LEAVE_BLANK]);
  } else if (lmp && scanEdd && Math.abs(Date.parse(`${scanEdd}T00:00:00Z`) - lmpEdd(lmp)) > 14 * DAY) {
    drop.push('pregnancy.scanEdd');
    const days = Math.round(Math.abs(Date.parse(`${scanEdd}T00:00:00Z`) - lmpEdd(lmp)) / DAY);
    const byLmp = new Date(lmpEdd(lmp)).toISOString().slice(0, 10);
    ask(heard.scanEdd ?? {}, `Scan EDD ${showDate(scanEdd)} is ${days} days from the EDD by LMP (${showDate(byLmp)}) – is it right?`, [
      opt(`value:pregnancy.scanEdd=${scanEdd}`, `Yes, scan EDD ${showDate(scanEdd)}`),
      LEAVE_BLANK,
    ]);
  }
  const weeks = heard.weeks;
  if (weeks && weeks.value > 42) {
    const other = weeks.value >= 50 && weeks.value % 10 === 0 ? weeks.value / 10 + 10 : null;
    ask(weeks, `${weeks.value} weeks is more than 42 weeks${other ? ` – was it ${other} weeks?` : '.'} Check the weeks and the dates.`, [opt('ignore', 'Checked')]);
  } else if (weeks && !drop.includes('pregnancy.lmp') && (scanEdd || lmp)) {
    const [path, iso, label] = scanEdd && !drop.includes('pregnancy.scanEdd') ? ['pregnancy.scanEdd', scanEdd, 'Scan EDD'] : lmp ? ['pregnancy.lmp', lmp, 'LMP'] : [];
    const edd = path === 'pregnancy.scanEdd' ? Date.parse(`${iso}T00:00:00Z`) : iso && lmpEdd(iso);
    const ga = edd && Math.floor((280 * DAY - (edd - today)) / (7 * DAY));
    if (path && Math.abs(ga - weeks.value) > 2) {
      drop.push(path);
      ask(weeks, `${label} ${showDate(iso)} gives ${ga} weeks, but ${weeks.value} weeks was said. Use this ${label}?`, [opt(`value:${path}=${iso}`, `Yes, ${label} ${showDate(iso)}`), LEAVE_BLANK]);
    }
  }

  // Obstetric formula: counts that cannot all be right
  const ob = values.obstetric ?? {};
  const n = (k) => (ob[k] === undefined ? undefined : Number(ob[k]));
  const [g, p, l, a] = FORMULA.map(([, k]) => n(k));
  const impossible =
    (l !== undefined && p !== undefined && l > p && !heard.twins) ||
    (a !== undefined && g !== undefined && (careType === 'antenatal' ? a >= g : a > g)) ||
    (g !== undefined && p !== undefined && g < p + (a ?? 0)) ||
    g > 12 ||
    p > 10;
  if (impossible) {
    const said = FORMULA.filter(([, k]) => ob[k] !== undefined);
    drop.push(...said.map(([, k]) => `obstetric.${k}`));
    if (heard.formula?.primi && ob.previousCaesareans !== undefined) drop.push('obstetric.previousCaesareans'); // "primi" itself is in doubt
    const formula = said.map(([letter, k]) => `${letter}${ob[k]}`).join(' ');
    ask(heard.formula ?? {}, `${formula} – these numbers cannot all be right. Use them as heard?`, [
      opt(`value:${said.map(([, k]) => `obstetric.${k}=${ob[k]}`).join('&')}`, `Yes, ${formula}`),
      LEAVE_BLANK,
    ]);
  }
  // More previous caesareans than deliveries ("primi … previous LSCS"): never filled (the server refuses it too)
  const cs = n('previousCaesareans');
  if (cs > 0 && p !== undefined && cs > p && !drop.includes('obstetric.previousCaesareans')) {
    drop.push('obstetric.previousCaesareans');
    notes.push(`${cs} previous caesarean${cs === 1 ? '' : 's'} heard, but para is ${p} – check and type it in.`);
  }
  return { drop, questions, notes };
}

// An LMP said as a time ago ("2 months back", "do mahine pehle", "kal"): { iso, said } – iso is null when no date can
// be worked out ("last month"). Always asked about, never filled silently.
const SMALL_NUMBERS = { a: 1, an: 1, one: 1, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5 };
const APPROX_LMP = new RegExp(
  '^[\\s,:-]*(?:(?:was|is|on|about|around|approximately|approx|roughly|nearly|almost)\\s+)*' +
    `(?:(\\d{1,2}|${Object.keys(SMALL_NUMBERS).join('|')})\\s+(days?|din|weeks?|hafte|hafta|months?|mahine|mahina)\\s+(?:back|before|ago|pehle|pahle)` +
    '|(day\\s+before\\s+yesterday|yesterday|kal|parson|parso|last\\s+week|last\\s+month|pichh?le\\s+mahine|this\\s+month|is\\s+mahine)(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?' +
    '|(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(this|last|previous)\\s+month)\\b',
  'i',
);
function approximateDate(text, now) {
  const m = text.match(APPROX_LMP);
  if (!m) return null;
  const day = (d) => isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const y = now.getFullYear();
  const mo = now.getMonth();
  const d = now.getDate();
  let iso = null;
  if (m[1]) {
    const count = /^\d/.test(m[1]) ? Number(m[1]) : SMALL_NUMBERS[m[1].toLowerCase()];
    const unit = m[2].toLowerCase();
    if (/^(?:day|din)/.test(unit)) iso = day(new Date(y, mo, d - count));
    else if (/^(?:week|haft)/.test(unit)) iso = day(new Date(y, mo, d - 7 * count));
    else iso = day(new Date(y, mo - count, d));
  } else if (m[3]) {
    const said = m[3].toLowerCase().replace(/\s+/g, ' ');
    const lastMonth = /last month|pichh?le mahine/.test(said);
    if (said === 'yesterday' || said === 'kal') iso = day(new Date(y, mo, d - 1));
    else if (said === 'day before yesterday' || /^pars/.test(said)) iso = day(new Date(y, mo, d - 2));
    else if (said === 'last week') iso = day(new Date(y, mo, d - 7));
    else if (m[4]) iso = day(new Date(y, lastMonth ? mo - 1 : mo, Number(m[4])));
  } else if (m[5]) iso = day(new Date(y, /this/i.test(m[6]) ? mo : mo - 1, Number(m[5])));
  return { iso, said: m[0].replace(/^[\s,:-]+/, '').trim(), length: m[0].length };
}

// How long ago: "5 years back", "2 years ago", "a year back"
const YEARS_BACK = /\b(?:\d{1,2}|a|an)\s*(?:years?|yrs?)\s+(?:back|ago|before)\b/gi;
// Screening tests whose non-reactive or negative result is noted, in their standard spelling
const SCREENING_NAMES = { hiv: 'HIV', hbsag: 'HBsAg', hcv: 'HCV', antihcv: 'Anti-HCV', vdrl: 'VDRL', rpr: 'RPR', tpha: 'TPHA' };
const SCREENING_TEST = /(?<![a-z0-9-])(?:hiv|hbsag|(?:anti[\s-]*)?hcv|vdrl|rpr|tpha)(?![a-z0-9])/gi;
// A screening test's own result, said straight after it: only other tests or joining words may come between ("HIV,
// HBsAg and VDRL negative", "HIV 1 and 2 non reactive", "HIV test negative"). Any other word – "HIV not done", "HIV
// pending", "HIV of husband", "HIV indeterminate" – and that test has no result here. { kind, start, end } or null.
const SCREENING_JOIN = /^(?:and|&|or|,|test|tests|report|reports|1|2|i|ii|antibody|antibodies|ab|ag|antigen|anti|sero|syphilis|hiv|hbsag|hcv|vdrl|rpr|tpha)$/i;
const SCREENING_NEGATIVE = /^(?:negative|non-?reactive|non\s+reactive|-ve|nr)$/i;
const SCREENING_POSITIVE = /^(?:positive|reactive|detected|\+ve)$/i;
function screeningResult(s, end) {
  for (const w of s.slice(end, clauseEnd(s, end)).matchAll(/non[\s-]+reactive|[,&]|[^\s,&]+/gi)) {
    const at = end + w.index;
    if (SCREENING_NEGATIVE.test(w[0])) return { kind: 'negative', start: at, end: at + w[0].length };
    if (SCREENING_POSITIVE.test(w[0])) return { kind: 'positive', start: at, end: at + w[0].length };
    if (!SCREENING_JOIN.test(w[0])) return null;
  }
  return null;
}
// The few words said after a test's result, up to the next test or detail ("HIV negative, no, reactive"; not "… blood
// group AB positive")
const SCREENING_STOP = /^(?:allerg\w*|blood|group|lmp|phone|mobile|age|aged|weight|height|gravida|para|address|edd|scan|bp|hb)$/i;
function screeningAfter(s, end) {
  let stop = clauseEnd(s, end);
  const words = [...s.slice(end, stop).matchAll(/[^\s,]+/g)];
  const next = words.findIndex((w, i) => i >= 6 || (SCREENING_JOIN.test(w[0]) && !/^(?:and|&|or|1|2|i|ii|anti|sero)$/i.test(w[0])) || SCREENING_STOP.test(w[0]) || BLOOD_TEST.test(w[0]));
  if (next >= 0) stop = end + words[next].index;
  return s.slice(end, stop);
}
// Said straight after a result: it was a previous pregnancy's ("HIV negative in the last pregnancy", "… earlier")
const SCREENING_PAST_AFTER =
  /^[\s,]*(?:(?:(?:in|during|at|of)\s+(?:the\s+|her\s+)?)?(?:previous|prior|last|earlier|past|1st|2nd|3rd|first|second|third)\s+(?:pregnanc(?:y|ies)|deliver(?:y|ies)|time|baby|child|issue|anc|visit)|earlier|before|previously|in\s+the\s+past|last\s+time)\b/i;

// Weeks of pregnancy: "POG 28 weeks", "period of gestation 28+3 weeks", "now 28 weeks 3 days", "28 weeks pregnant", "28
// weeks running", "28 weeks by dates" – never "anti-D given at 28 weeks" or "follow up after 2 weeks". [1]: the word
// before, [2] or [5]: the weeks, [3], [4], [6] or [7]: the days, [8]: the word after.
const DAYS_AFTER = String.raw`(?:\s*,?\s*(?:and\s+)?([0-6])\s*(?:days?|d)\b)?`;
const WEEKS_SAID = new RegExp(
  String.raw`\b(pog|period\s+of\s+gestation|gestational\s+age|ga|now)\s*(?:is|of|:)?\s*(\d{1,2})\s*(?:\+\s*(\d)\s*)?(?:weeks?|wks?|w)\b` + DAYS_AFTER +
    String.raw`|(?<!\b(?:at|after|in|for|since|within|every|till|until|from|before|by|of|than)\s+)\b(\d{1,2})\s*(?:\+\s*(\d)\s*)?(?:weeks?|wks?)` + DAYS_AFTER +
    String.raw`\s*(pog|pregnant|of\s+pregnancy|of\s+gestation|gestation|now|running|by\s+dates)\b`,
  'gi',
);
// "now" says little by itself: "now N weeks" / "N weeks now" is not this pregnancy's after a symptom, a medicine, a dose
// or a visit ("cough now 10 weeks", "iron tablets now 6 weeks", "next visit 4 weeks now", "T dap given 28 weeks now")
const WEEKS_DURATION_BEFORE =
  /\b(?:spotting|bleeding|pain|cough|cold|fever|vomiting|nausea|discharge|itching|burning|leaking|headache|swelling|complaints?|symptoms?|tablets?|tabs?|capsules?|caps?|syrup|injections?|inj|medicines?|dose|given|taken|visit|review|follow(?:\s*-?\s*up)?|up|since|for|after|next|iron|calcium|folic\s+acid)\s*$/i;
// … nor "N weeks now" about a previous pregnancy ("previous preterm delivery 32 weeks now", "previous IUD 30 weeks now").
// A time said since ("previous LSCS 5 years back 28 weeks now") ends that.
const WEEKS_PAST_BEFORE =
  /\b(?:previous|prev|prior|last\s+(?:pregnancy|baby|delivery|child|issue)|h\s*\/\s*o|history\s+of|born|delivered|delivery|iud|iufd|still\s*birth|abortions?|miscarriages?|mtps?|preterm|earlier)\b/i;
const WEEKS_PAST_RESET = /\b(?:\d{1,2}|a|an)\s*(?:years?|yrs?|months?)\s+(?:back|ago|before)\b|\bnow\b/gi;
// Bare weeks said straight after (a spoken "sorry" is already gone): "28 weeks pregnant, 30 weeks"
const WEEKS_AGAIN = /^\s*,?\s*(\d{1,2})\s*(?:\+\s*(\d)\s*)?(?:weeks?|wks?)\b/i;
// Every time the weeks of this pregnancy were said: [{ weeks, days, text, at, end }]
function weeksSaid(s) {
  const found = [];
  const rx = new RegExp(WEEKS_SAID.source, 'gi');
  for (let m = rx.exec(s); m; m = rx.exec(s)) {
    rx.lastIndex = m.index + 1; // "32 weeks now 28 weeks": both
    const numAt = m.index + m[0].search(/\d/);
    const end = m.index + m[0].length;
    const same = found.find((x) => x.numAt === numAt); // "now 28 weeks pregnant" is said once
    if (same) {
      same.end = Math.max(same.end, end);
      continue;
    }
    const lead = s.slice(clauseStart(s, m.index), /^now$/i.test(m[1] ?? '') ? m.index : numAt);
    if (/^now$/i.test(m[1] ?? m[8]) && WEEKS_DURATION_BEFORE.test(lead)) continue;
    if (/^now$/i.test(m[8] ?? '') && WEEKS_PAST_BEFORE.test(lead.split(WEEKS_PAST_RESET).pop())) continue;
    found.push({ weeks: Number(m[2] ?? m[5]), days: Number(m[3] ?? m[4] ?? m[6] ?? m[7] ?? 0), at: m.index, end, numAt });
    const again = s.slice(end, clauseEnd(s, end)).match(WEEKS_AGAIN);
    if (again) found.push({ weeks: Number(again[1]), days: Number(again[2] ?? 0), at: end + again[0].search(/\d/), end: end + again[0].length, numAt: end + again[0].search(/\d/) });
  }
  return found.map((x) => ({ ...x, text: s.slice(x.at, x.end).trim() }));
}

// A number said after "she's" or "she is" with nothing after it that makes it weeks, a weight, a height or a date
const SHE_IS_NUMBER = /\bshe(?:'s|’s|\s+is)\s+(\d{1,3})(?![\d.:/])(?!\s*(?:weeks?|wks?|w\b|months?|days?|years?|yrs?|kgs?|kilos?|kilograms?|g\b|grams?|cms?|centimet\w*|feet|foot|ft|inch\w*|mm|hours?|hrs?|minutes?|mins?|times|st\b|nd\b|rd\b|th\b|[+%]))/i;
// A weight's label said just before its number ("birth weight 2.8 kg", "weight 60 kg"): its length, so it is used
// with the number and never listed as not understood
const WEIGHT_LABEL = /\b(?:birth\s*weight|bw|weight|weighing|weighs)\s*(?:(?:is|of)\s+|:\s*)?$/i;
const labelBefore = (s, at) => s.slice(Math.max(0, at - 20), at).match(WEIGHT_LABEL)?.[0].length ?? 0;

// Words that say nothing on their own: a result, a "no", or the clinical words said before a finding ("non reactive",
// "not a known case of", "h/o"). A part of the text made only of them is never listed as not understood, nor offered
// for the notes, where it would be a result without its test (plan G5.10).
const LINK_WORDS = new Set('no not nil none non a an known case of history h/o k/c/o k c o family fh reactive non-reactive negative positive ruled out'.split(' '));
export const onlyLinkWords = (text) => String(text ?? '').trim().split(/[\s,]+/).every((w) => LINK_WORDS.has(w.toLowerCase()));
// A number said with one of these is a medicine's dose ("50 mcg daily"), not a detail missed
const DOSE_WORD = /^(?:mg|mcg|ml|iu|units?|tablets?|tabs?|daily|od|bd|tds|hs|sos)$/i;
// Clinical words said just before a finding ("known case of DM", "h/o asthma", "family history of diabetes"), and the
// small words that may come between a test and its result ("HIV test report non reactive")
const CLINICAL_LEAD = /\b(?:family\s+history\s+of|fh\s+of|known\s+case\s+of|k\s*\/?\s*c\s*\/?\s*o|h\s*\/\s*o|history\s+of)\s*$/i;
const RESULT_GAP = /^[\s,:-]*(?:(?:and|or|is|was|are|were|both|all|also|test|tests|report|reports|result|results|came|comes|found)\b[\s,:-]*)*$/i;

// Small words that alone are not a detail missed ("by", "at", "on" …, and Hindi "hai", "ki" …)
const GAP_WORDS = new Set('by at on in of with for to from today yesterday tablet tab mg mcg daily od bd tds hai hain thi tha ko ki ka ke'.split(' '));
const FILLER_WORDS = new Set('okay ok so then the a an and also is was this that she he her his it um uh hmm next done thank thanks you please write note doctor sister patient'.split(' '));
// "No known conditions" said in words; also "past history nil", "medical history nil", "nil significant" and "no other
// illness" (plan G5.2)
const NO_CONDITIONS = new RegExp(
  [
    String.raw`no\s+(?:known\s+)?(?:medical\s+|chronic\s+)?(?:conditions?|illness(?:es)?|diseases?|co-?morbidit(?:y|ies))`,
    String.raw`no\s+(?:significant\s+|relevant\s+|known\s+)?(?:past\s+)?medical\s+(?:history|illness|problems?)`,
    String.raw`no\s+past\s+(?:medical\s+)?history|nothing\s+significant|nil\s+significant`,
    String.raw`(?:past\s+|medical\s+|past\s+medical\s+)history\s*(?:is\s+|:|-)?\s*(?:nil|none|not\s+significant|insignificant|non-?contributory)`,
    String.raw`no\s+other\s+(?:illness(?:es)?|diseases?|medical\s+problems?)`,
  ]
    .map((x) => `\\b(?:${x})\\b`)
    .join('|'),
  'gi',
);
// "No known conditions" said about her own illnesses. "nil significant" and "nothing significant" do not say whose
// history, so they count only at the start of a clause or after "past/medical history" – never after "family history",
// "surgical history" or an examination (plan G5.2).
// { start, end } (with the heading said before it), or null.
function noConditionsSaid(s) {
  for (const m of s.matchAll(NO_CONDITIONS)) {
    const before = s.slice(segmentStart(s, m.index), m.index);
    const heading = before.match(/\b(?:past\s+|medical\s+)+history\s*(?:is\s+|:|-)?\s*$/i);
    if (aboutFamily(s, m.index, FAMILY_ADULT)) continue;
    if (/^(?:nil|nothing)\s+significant$/i.test(m[0]) && !ONLY_FILLER.test(before.trim()) && !heading) continue;
    return { start: heading ? m.index - heading[0].length : m.index, end: m.index + m[0].length };
  }
  return null;
}
// Questions in this order: the confirmation card, then safety checks, then the rest (plan 1.7)
const GROUP_ORDER = { confirm: 0, safety: 1, other: 2 };
// A round ten and then a word that sounds like a digit ("age thirty to"): [detail, form field, unit shown, unit words]
const SPLIT_NUMBER_FIELDS = [
  ['age', 'ageYears', '', 'years?|yrs?|saal|sal'],
  ['weight', 'medical.weightKg', ' kg', 'kgs?|kilos?|kilograms?'],
  ['height', 'medical.heightCm', ' cm', 'cms?|centimet(?:er|re)s?'],
];
const SPLIT_DIGIT = /^\s*,?\s*(to|too|for|fore|ate|et|[1-9])(?![\w.])/i;
const DIGIT_SOUNDS = { to: 2, too: 2, for: 4, fore: 4, ate: 8, et: 8 };
const NEXT_DETAIL_HERE = new RegExp(`^${NEXT_DETAIL.source}`, 'i');
// Corrections that turn words into a number ("twenty sewen" → 27, "1 52" → 152). Undoing part of a number could only
// leave part of it ("age 20"), so they have no Undo: a number is changed in the form field itself.
const NUMBER_RULES = new Set(['number', 'digits', 'formula', 'height']);
const TEEN_WORDS = /\b(thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi;
const CORRECTED_PATH = { age: 'ageYears', phone: 'phone', lmp: 'pregnancy.lmp', edd: 'pregnancy.scanEdd', bloodGroup: 'medical.bloodGroup', height: 'medical.heightCm', weight: 'medical.weightKg' };
// After these words a word is someone's name, so the answer is never remembered as a word (plan 2.5)
const BEFORE_A_NAME = /\b(?:husband|dr|doctor|mr|mrs|ms|smt|w\/o|d\/o|wife\s+of|daughter\s+of|baby\s+of|referred\s+by)\.?\s+$/i;

// Learned-word keys that are settings, not words ("edd": scan EDD or from dates)
const PREFERENCE_KEYS = new Set(['edd', 'b rh', 'height n.n']);

// The text, ready for the field rules (plan 2.1): label words (normaliseLabels), then the Indian English steps before
// numbers said as words become digits (prepareTranscript), then numbers and shorthand (normalise), then the steps after
// (fixAfterDigits). Names, addresses and the doctor's own words (`protect`) are never changed. Words are matched by
// sound (plan 2.5) only in voice entry (`voice`: spoken, or typed into its box); elsewhere text keeps its words, with
// "Did you mean …?" for a typing slip.
// `keep`: words the person asked to keep as heard (Undo on a correction, for this form only; plan 1.7) – no step
// changes them.
// Returns { text, spelled, corrections, lookups } – lookups: the words the lookup table, or matching by sound, asks
// about.
function prepareText(text, careType, protect, voice, keep = []) {
  const labels = normaliseLabels(cleanup(text), { protect: keep });
  const before = prepareTranscript(labels.text, { careType, protect: [...protect, ...keep], spans: findProtectedSpans(labels.text), sound: voice });
  const digits = normalise(before.text);
  const after = fixAfterDigits(digits, { careType, protect: [...protect, ...keep], spans: findProtectedSpans(digits) });
  return {
    text: after.text,
    spelled: new Set(before.spelled),
    corrections: [...labels.changes, ...before.changes, ...after.changes],
    lookups: [...before.questions, ...after.questions],
  };
}

// What a word suggested by the lookup table would fill, said at [start, end): a term (read where it was said, so a
// "no" or a family member before it still counts) or a special case. { term?, result }, { none: true } when the word
// fills nothing ("TSH", "DIPSI"), or null (a special case said with a "no").
function lookupTarget(word, s, start, end, ctx) {
  const low = word.toLowerCase();
  const term = TERMS.find((t) => t.says.some((say) => say.toLowerCase() === low));
  if (term) return { term, result: resolveTerm(term, s, start, end, ctx) };
  const special = SPECIALS.find((sp) => new RegExp(sp.rx.source, sp.rx.flags.replace('g', '')).test(word));
  if (!special) return { none: true };
  if (negated(s, start, end)) return null;
  return { result: special.resolve(Object.assign([word], { index: start }), ctx) };
}

/**
 * Spoken text made ready for reading, exactly as extractPatientDetails prepares it: labels, Hinglish and filler
 * words, Indian English spellings of words and numbers, letters said one by one, and self-corrections ("age 25,
 * sorry, 26"). For other readers of dictated text (e.g. a visit's notes), so they hear Indian English the same way.
 * `words`: the person's own words ({ phrase, meaning }); the steps never change them. `keep`: words to leave exactly
 * as heard (a correction undone with Undo), as in extractPatientDetails.
 * Returns { text, spans, corrections, questions, selfCorrections, unclear }: spans are the names, addresses and phone
 * text found in `text` (never read as findings); corrections and questions as in extractPatientDetails.
 */
export function prepareSpoken(text, { careType, words = [], voice = true, keep = [] } = {}) {
  const own = (words ?? []).filter((w) => !isBlockedLearned(w.phrase) && !isValueMeaning(w.meaning) && !saysFetalSex(w.phrase.toUpperCase()));
  const kept = (keep ?? []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const prepared = prepareText(text, careType, own.map((w) => w.phrase).filter((p) => !PREFERENCE_KEYS.has(p.toLowerCase())), voice, kept);
  const said = applySelfCorrections(prepared.text, findProtectedSpans(prepared.text), { careType });
  return {
    text: said.text,
    spans: findProtectedSpans(said.text),
    corrections: prepared.corrections.filter((c) => !saysFetalSex(`${c.heard} ${c.to}`)),
    questions: prepared.lookups,
    selfCorrections: said.changes.filter((c) => !c.hidden),
    unclear: said.unclear,
  };
}

/**
 * Details found in the text, for the given type of care. `words`: the person's own words ([{ phrase, meaning }]).
 * A reactive or positive result is only offered in the confirmation card (questions with group 'confirm'), never
 * filled silently. `voice`: the text came from speech – the blood group, and a result said without positive or
 * negative, are then in that card too. `keep`: words to leave exactly as heard (a correction undone with Undo, for
 * this form only – nothing is saved); the safety rules still apply to them.
 * Returns { values, paths, found, notes, questions, unused }:
 *  - values: the details in the form's own format (text, "YYYY-MM-DD" dates, lists of keys)
 *  - paths: which form fields to fill ("fullName", "pregnancy.lmp", "medical.conditions" …)
 *  - found: what to show ({ label, text, part: 'info' | 'clinical' })
 *  - notes: things heard but deliberately not used, and why (and corrections said while speaking)
 *  - questions: what the rules are not sure about ({ id, key, heard, prompt, options, remember, teach, data, group,
 *    part }); group: 'confirm' (results and blood group), 'safety' (checks) or 'other'; part: the page it is about
 *  - unused: parts of the text nothing was taken from ({ text, note, canNote, sex, start }; start: where it is in the text read)
 *  - corrections: words changed because of how they are said in Indian English ({ heard, to, rule, tier }; plan 1.7),
 *    shown on screen only. Words about the baby's sex are never listed. A number's correction has `undo: false`:
 *    undoing part of a number could only leave part of it, so a number is changed in the form field itself.
 */
export function extractPatientDetails(text, { careType, now = new Date(), words = [], voice = false, keep = [] } = {}) {
  // The person's own words – except any that could change a result or a "no" (plan 2.5). The Indian English steps
  // never change them.
  const own = (words ?? []).filter((w) => !isBlockedLearned(w.phrase) && !isValueMeaning(w.meaning) && !saysFetalSex(w.phrase.toUpperCase()));
  const kept = (keep ?? []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const prepared = prepareText(text, careType, own.map((w) => w.phrase).filter((p) => !PREFERENCE_KEYS.has(p.toLowerCase())), voice, kept);
  const { spelled } = prepared;
  const said = applySelfCorrections(prepared.text, findProtectedSpans(prepared.text), { careType });
  const s = said.text;
  // Names of the husband, a doctor or a hospital are never read as findings
  const names = findProtectedSpans(s).filter((p) => NAME_KINDS.has(p.kind));
  const inName = (a, b) => names.some((p) => a < p.end && b > p.start);
  const f = newFindings(careType);
  const notes = [];
  const questions = [];
  const used = [];
  const heard = { twins: /\b(?:twins?|triplets?|dcda|mcda|mcmc)\b/i.test(s) };
  const mine = new Map(own.map((w) => [w.phrase.toLowerCase(), w.meaning]));
  // A correction said while speaking about the blood group or a result (or one not understood): always confirmed
  const card = voice || said.changes.some((c) => c.confirm) || said.unclear.length > 0;
  const isUsed = (a, b) => used.some(([x, y]) => a < y && b > x);
  // Inside words kept as heard (Undo): not asked about again with "Did you mean …?"
  const keptAt = kept.flatMap((k) => [...s.matchAll(new RegExp(`${EDGE_L}${escapeRx(k).replace(/\s+/g, '\\s+')}${EDGE_R}`, 'gi'))].map((x) => [x.index, x.index + x[0].length]));
  const inKept = (a, b) => keptAt.some(([x, y]) => a < y && b > x);
  const use = (a, b) => used.push([a, b]);
  const note = (text) => !notes.includes(text) && notes.push(text);
  // The words around [start, end) that nothing was taken from, in that part of the sentence (as the unused list shows
  // them): { start, end }. Never a word about the baby's sex.
  const unusedRunAround = (start, end) => {
    let run = null;
    for (const w of s.matchAll(/[^\s,.;\n]+|[,.;\n]/g)) {
      const a = w.index;
      const b = a + w[0].length;
      const free = !/^[,.;\n]$/.test(w[0]) && ((a >= start && b <= end) || (!isUsed(a, b) && !inName(a, b) && !mentionsFetalSex(w[0])));
      if (free) run = { start: run?.start ?? a, end: b };
      else if (run && run.start <= start && run.end >= end) return run;
      else run = null;
    }
    return run && run.start <= start && run.end >= end ? run : { start, end };
  };
  const ask = (q, heardText, start) => {
    const item = { remember: false, key: null, group: 'other', part: 'clinical', ...q, heard: String(heardText ?? '').trim(), id: `q${questions.length}-${start}`, at: start ?? Infinity };
    // A word with a number or a "no" is never kept (plan 2.5), so Remember is not offered for it
    if (item.key && isBlockedLearned(item.key)) item.remember = false;
    questions.push(item);
  };
  const drop = (path) => {
    const [a, b] = path.split('.');
    if (b && f.values[a]) delete f.values[a][b];
    if (!b || (f.values[a] && !Object.keys(f.values[a]).length)) delete f.values[a];
    f.paths = f.paths.filter((p) => p !== path);
  };
  const isNewborn = careType === 'newborn';
  // Blood group by voice (owner's decision 2026-09-30): said plainly and once, it is filled in (marked "From voice", to be
  // checked before saving). It is still asked when the speech was corrected or unclear, when the words had to be
  // corrected ("bee positive, are H positive", a subgroup "A1 positive"), or when another blood group was said too (e.g.
  // the husband's).
  const plainly = (heardText) =>
    !/\b(?:oh|0)\b|\ba\s+b\b/i.test(String(heardText ?? '')) && // "oh positive", "0 positive", "a b positive": asked
    new RegExp(escapeRx(String(heardText ?? '').trim()).replace(/\s+/g, '\\s*'), 'i').test(String(text ?? ''));
  const groupsSaid = (s.match(/\b(?:a\s*b|ab|a|b|o)\s*(?:rh\s*)?(?:positive|negative|pos|neg|\+|-)(?![a-z0-9])/gi) ?? []).length;
  const groupCard = (heardText) => !voice ? card : card && (said.changes.some((c) => c.confirm) || said.unclear.length > 0 || groupsSaid > 1 || !plainly(heardText));
  const fillGroup = (group, heardText, at, learned = false) =>
    groupCard(heardText) ? ask(bloodCard(group), heardText, at) : put(f, 'medical.bloodGroup', group, learned);

  for (const c of said.changes) {
    if (c.hidden) note("Corrected while speaking: the baby's sex.");
    else note(`Corrected while speaking: ${c.name} ${c.from} → ${c.to ?? 'removed'}.`);
  }
  for (const u of said.unclear) note(`Something was corrected after the ${u.name} but not understood – check the ${u.name}.`);

  // Identity. A name ends at a word kept as heard ("name Sunita Devi grabida 2" – Sunita Devi): the text with each
  // kept word blanked by a stop, the same length, so positions stay the same.
  const nameText = keptAt.reduce((t, [a, b]) => t.slice(0, a) + ';'.padEnd(b - a) + t.slice(b), s);
  const name = findName(nameText, careType);
  const motherMatch = isNewborn
    ? (() => {
        const m = nameText.match(MOTHER_OF_BABY) ?? nameText.match(MOTHER_NAMED);
        const got = m && cleanName(m[1]);
        return got && { name: got.name, start: m.index, end: m.index + m[0].length - m[1].length + got.length };
      })()
    : null;
  if (name || motherMatch) {
    put(f, 'fullName', name?.name ?? `Baby of ${motherMatch.name}`);
    for (const got of [name, motherMatch]) if (got) use(got.start, got.end);
  }
  if (!isNewborn) {
    const { age, others, ask: ages } = findAge(s, name);
    for (const a of others) use(a.start, a.end); // the husband's age is not read as anything else
    // Two ages, and neither surely hers ("husband Kiran age 41 Lata age 30"): asked, unless "said twice" asks already
    if (ages && !said.conflicts.some((c) => c.field === 'age')) {
      const heardText = others.map((a) => s.slice(a.start, a.end)).join(' … ');
      ask({ group: 'safety', part: 'info', prompt: `Her age: ${ages.join(' or ')}?`, options: [...ages.map((v) => opt(`value:ageYears=${v}`, String(v))), LEAVE_BLANK] }, heardText, others[0].start);
    }
    if (age && age.age >= 10 && age.age <= 120) {
      put(f, 'ageYears', String(age.age));
      use(age.start, age.end + (s.slice(age.end).match(/^\s+of\s+age\b/i)?.[0].length ?? 0)); // "32 years of age"
      const teens = [...cleanup(text).matchAll(TEEN_WORDS)].map((m) => SMALL[m[1].toLowerCase()]);
      heard.age = { value: age.age, teen: teens.includes(age.age), text: s.slice(age.start, age.end), at: age.start };
    } else if (age) note(`The age heard (${age.age}) doesn't look right, so it was not used.`);
    // "she's 32", "she is 32" with no unit: most likely her age, but asked, never filled
    const bare = !age && !ages ? s.match(SHE_IS_NUMBER) : null;
    const n = bare && Number(bare[1]);
    if (n >= 10 && n <= 120) {
      use(bare.index, bare.index + bare[0].length);
      ask({ group: 'safety', part: 'info', prompt: `Age ${n}?`, options: [opt(`value:ageYears=${n}`, `Yes, age ${n}`), LEAVE_BLANK] }, bare[0], bare.index);
    }
  }
  const phone = findPhone(s);
  // A second whole number said straight after it ("phone 98765 43210 91234 56789"): said twice, so asked (plan 2.6)
  const next = phone?.phone && takePhone(s.slice(phone.end));
  const other = next && phoneFromDigits(next.digits);
  if (other && phoneKey(other) !== phoneKey(phone.phone)) {
    use(phone.start, phone.end + next.length);
    const heardText = s.slice(phone.start, phone.end + next.length);
    ask({ group: 'safety', part: 'info', prompt: `Phone was said twice: ${phone.phone} or ${other}?`, options: [opt(`value:phone=${phone.phone}`, phone.phone), opt(`value:phone=${other}`, other), LEAVE_BLANK] }, heardText, phone.start);
  } else if (phone) {
    if (phone.phone) put(f, 'phone', phone.phone);
    heard.phone = { digits: phone.digits };
    use(phone.start, phone.end + (other ? next.length : 0));
    // the same number said again later ("… phone 98765 43210 … mobile 98765 43210")
    for (const m of s.slice(phone.end).matchAll(PHONE_WORD)) {
      const again = takePhone(s.slice(phone.end + m.index + m[0].length));
      const at = phone.end + m.index;
      if (phone.phone && again && phoneKey(again.digits) === phoneKey(phone.phone)) use(at, at + m[0].length + again.length);
    }
  }
  const address = findAddress(s, phone);
  if (address) {
    put(f, 'address', address.address);
    use(address.start, address.end);
  }

  // Allergies first, so a medicine named in them isn't read as a condition
  if (!isNewborn) {
    const none = s.match(/\b(?:no\s+(?:known\s+)?(?:drug\s+|food\s+)?allerg(?:y|ies)|nkda|nkfda|nka|not\s+allergic\s+to\s+anything|no\s+allergic\s+history|allerg(?:y|ies)\s*(?::|-|is|are)?\s*(?:none|nil|no)\b)/i);
    const some = s.match(/\b(?:allergic\s+(?:reaction\s+)?to|allerg(?:y|ies)\s+to|sensitive\s+to|drug\s+allerg(?:y|ies)\s*(?:to|:|-)?|allerg(?:y|ies)\s*(?::|-|is|are))\s*/i);
    if (none) {
      put(f, 'medical.allergies', 'None known');
      use(none.start, none.end);
    } else if (some) {
      // It ends at the next detail, a "no", or a finding after its first word ("allergic to penicillin GDM on diet")
      const stops = [/[;\n]/, /\.(?!\d)/, NEXT_DETAIL, /\s+and\s+(?:she|he|her|his|is|has|no)\b/i, ANY_TERM_AFTER_COMMA, /\s(?:no|nil|not|non)\b/i, new RegExp(`(?<=\\S)\\s+(?=${ANY_TERM_G.source})`, 'i')];
      const raw = cutAt(` ${s.slice(some.index + some[0].length)}`, stops).slice(1);
      const value = tidy(raw);
      if (value.length >= 2) {
        put(f, 'medical.allergies', capitalise(value).slice(0, 500));
        use(some.index, some.index + some[0].length + raw.length);
      }
    }
  }

  if (isNewborn) findNewborn(s, now, f, use, note, ask, nameText);

  // Pregnancy dates. scanEddFrom: whether the scan EDD filled was said as a scan EDD, or is a plain one (the doctor's habit)
  let scanEddFrom = null;
  let datesHeard = false; // an LMP or EDD was said (used or not)
  let approxLmp = null; // the date an LMP said roughly gives ("LMP 2 months back")
  // Abortion care (pregnancy loss): the LMP fills the loss's own LMP; there is no EDD and no weeks today.
  const lmpPath = careType === 'abortion' ? 'abortion.lmp' : 'pregnancy.lmp';
  if (careType === 'antenatal' || careType === 'abortion') {
    for (const m of s.matchAll(LMP_RX)) {
      const rest = s.slice(m.index + m[0].length);
      const date = readDate(rest, now, 'past');
      if (!date) {
        // "LMP 2 months back": asked, never filled silently
        const about = approximateDate(rest, now);
        if (!about) continue;
        datesHeard = true;
        approxLmp = about.iso;
        use(m.index, m.index + m[0].length + about.length);
        if (about.iso) {
          ask(
            {
              group: 'safety',
              prompt: `LMP about ${showDate(about.iso)} (said: “${about.said}”) – is that right?`,
              options: [opt(`value:${lmpPath}=${about.iso}`, `Yes, LMP ${showDate(about.iso)}`), LEAVE_BLANK],
            },
            s.slice(m.index, m.index + m[0].length + about.length),
            m.index,
          );
        } else note(`The LMP was said as “${about.said}”. Say or type the date.`);
        break;
      }
      datesHeard = true;
      use(m.index, m.index + m[0].length + date.end);
      const t = Date.parse(`${date.iso}T00:00:00Z`);
      if (t > todayUtc(now)) note(`The LMP heard (${showDate(date.iso)}) is in the future, so it was not used.`);
      else {
        put(f, lmpPath, date.iso);
        if (careType === 'antenatal') heard.lmp = { text: s.slice(m.index, m.index + m[0].length + date.end), at: m.index };
      }
      break;
    }
  }
  if (careType === 'abortion') {
    // The type of loss said ("missed miscarriage", "ectopic", "molar pregnancy") fills the type of loss, never a note.
    const hits = lossTypesSaid(s);
    for (const h of hits) use(h.start, h.end);
    // "Threatened miscarriage": not a type of loss here – nothing is filled, the hint is shown instead
    const threatened = threatenedSaid(s);
    for (const h of threatened) use(h.start, h.end);
    if (threatened.length) note(THREATENED_HINT);
    const kinds = [...new Set(hits.map((h) => h.key))];
    if (kinds.length === 1) put(f, 'abortion.lossType', kinds[0], false, hits[0].start);
    else if (kinds.length > 1) {
      ask(
        { group: 'safety', prompt: 'Which type of loss?', options: [...kinds.map((k) => opt(`value:abortion.lossType=${k}`, LOSS_LABELS[k])), LEAVE_BLANK] },
        hits.map((h) => s.slice(h.start, h.end)).join(' … '),
        hits[0].start,
      );
    }
  }
  if (careType === 'antenatal') {
    for (const m of s.matchAll(EDD_RX)) {
      let rest = s.slice(m.index + m[0].length);
      const q = rest.match(SCAN_AFTER);
      if (q) rest = rest.slice(q[0].length);
      const date = readDate(rest, now, 'future');
      if (!date) continue;
      datesHeard = true;
      const end = m.index + m[0].length + (q?.[0].length ?? 0) + date.end;
      use(m.index, end);
      if (Math.abs(Date.parse(`${date.iso}T00:00:00Z`) - todayUtc(now)) > 45 * 7 * DAY) {
        note(`The EDD heard (${showDate(date.iso)}) looks wrong, so it was not used.`);
        continue;
      }
      const byScan = q || SCAN_WORD.test(s.slice(clauseStart(s, m.index), m.index)) || SCAN_AFTER.test(rest.slice(date.end)) || /^c/i.test(m[0]);
      if (byScan || mine.get('edd') === 'scanedd') {
        if (byScan) put(f, 'pregnancy.scanEdd', date.iso);
        else applyMeaning(f, 'scanedd', { date: date.iso }, true);
        heard.scanEdd = { text: s.slice(m.index, end), at: m.index };
        scanEddFrom = byScan ? 'scan' : 'plain';
      } else if (mine.get('edd') !== 'ignore') {
        ask(
          {
            key: 'edd',
            remember: true,
            prompt: `EDD ${showDate(date.iso)} – is it from a dating scan?`,
            options: [opt('scanedd', 'Yes – EDD from dating scan'), opt('ignore', 'No – from dates (worked out from the LMP)')],
            data: { date: date.iso },
          },
          s.slice(m.index, end),
          m.index,
        );
      }
    }
    // Weeks of pregnancy. Used (so never listed as not understood) only when something reads them: the LMP question
    // below, the check against a date filled, or the "more than 42 weeks" check (checkRanges).
    const told = weeksSaid(s);
    const kinds = [...new Map(told.map((x) => [`${x.weeks}+${x.days}`, x])).values()];
    const pog = kinds.length === 1 ? told[0] : null;
    const dateFilled = f.paths.some((p) => p.startsWith('pregnancy.'));
    const datesSaid = datesHeard || dateFilled || said.conflicts.some((c) => c.field === 'lmp' || c.field === 'edd');
    if (kinds.length > 1) {
      // Said two ways ("POG 28 weeks … 30 weeks pregnant"): nothing is worked out from them
      for (const x of told) use(x.at, x.end);
      note(`The weeks of pregnancy were said more than once (${kinds.map((x) => `“${x.text}”`).join(', ')}) – check the weeks and the LMP.`);
    } else if (pog) {
      heard.weeks = { value: pog.weeks, text: pog.text, at: pog.at }; // checked against the dates (checkRanges)
      const useAll = () => told.forEach((x) => use(x.at, x.end));
      if (!datesSaid && pog.weeks >= 4 && pog.weeks <= 42) {
        // Said without an LMP or EDD: the LMP the weeks give is asked about, never filled (as "LMP 2 months back")
        useAll();
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * pog.weeks - pog.days);
        const iso = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
        ask(
          {
            group: 'safety',
            prompt: `LMP about ${showDate(iso)} (said: “${pog.text}”) – is that right?`,
            options: [opt(`value:pregnancy.lmp=${iso}`, `Yes, LMP ${showDate(iso)}`), LEAVE_BLANK],
          },
          pog.text,
          pog.at,
        );
      } else if (dateFilled || pog.weeks > 42) useAll();
      else if (!datesSaid) {
        note('Weeks of pregnancy were said, but no LMP or scan EDD: say the LMP (or "EDD by scan …") so the weeks can be worked out.');
      } else if (approxLmp) {
        // With an LMP said roughly ("LMP 2 months back"): compared with it, allowing for the rough date
        useAll();
        const ga = Math.floor((todayUtc(now) - Date.parse(`${approxLmp}T00:00:00Z`)) / (7 * DAY));
        if (Math.abs(ga - pog.weeks) > 4) note(`“${pog.text}” was said, but the LMP said gives about ${ga} weeks – check the weeks and the LMP.`);
      }
      // Otherwise (an EDD waiting for its answer, a date not used): left in "Not understood", to check against it
    }
  }

  if (!isNewborn) {
    const ob = findObstetric(s, careType, f, use);
    if (ob.formula) heard.formula = ob.formula;
    if (ob.bareCaesarean) {
      ask(
        {
          group: 'safety',
          prompt: `“${ob.bareCaesarean.text}” after the obstetric formula – one previous caesarean?`,
          options: [opt('value:obstetric.previousCaesareans=1', 'Yes, 1 previous caesarean'), opt('ignore', 'No')],
        },
        ob.bareCaesarean.text,
        ob.bareCaesarean.at,
      );
    }
    if (ob.caesareanByDelivery) {
      const { text, at, count } = ob.caesareanByDelivery;
      const post = careType === 'postnatal';
      const choices = Array.from({ length: Math.min(count, 10) + (post ? 1 : 0) }, (_, i) => (post ? i : i + 1));
      ask(
        {
          group: 'safety',
          prompt: post ? `“${text}” – how many caesareans before this delivery?` : `“${text}” – how many previous caesareans?`,
          options: [...choices.map((k) => opt(`value:obstetric.previousCaesareans=${k}`, `${k} previous caesarean${k === 1 ? '' : 's'}`)), opt('ignore', 'Leave blank')],
        },
        text,
        at,
      );
    }
  }

  // Blood group ("hepatitis B negative" is not a blood group)
  const BG_VALUE = '(a\\s*b|ab|a|b|o|0|oh)\\s*(?:rh\\s*)?(positive|negative|pos|neg|\\+|-)(?![a-z0-9])';
  const bg =
    s.match(new RegExp(`\\b(?:blood\\s*(?:group|type|grp)|bg|group|grp|abo\\s*rh)\\s*(?:is|:|-)?\\s*${BG_VALUE}`, 'i')) ??
    s.match(new RegExp(`\\b${BG_VALUE}\\s*,?\\s*blood\\s*(?:group|type)\\b`, 'i')) ??
    s.match(/(?<!\b(?:hepatitis|hep|vitamin|type|grade|class|stage)\s)\b(a\s?b|o)\s*(?:rh\s*)?(positive|negative)(?![a-z0-9])/i);
  const groupOf = (m) => `${m[1].replace(/\s/g, '').toUpperCase().replace(/^(?:0|OH)$/, 'O')}${/^(?:positive|pos|\+)/i.test(m[2]) ? '+' : '-'}`;
  if (bg) {
    fillGroup(groupOf(bg), bg[0], bg.index);
    use(bg.index, bg.index + bg[0].length);
  } else {
    // "B positive" alone (not after hepatitis / hep / vitamin): ask, unless this doctor always means a blood group
    const b = s.match(/(?<!\b(?:hepatitis|hep|vitamin|type|grade|class|stage)\s)\b(b|a)\s*(?:rh\s*)?(positive|negative)(?![a-z0-9])(?![\s,]*(?:for|result))/i);
    if (b && !(b[1].toLowerCase() === 'a' && /\ba\s+positive\s+\w/i.test(b[0] + s.slice(b.index + b[0].length, b.index + b[0].length + 12)))) {
      use(b.index, b.index + b[0].length);
      const group = groupOf(b);
      // In the confirmation card nothing is remembered and a saved "ignore" never hides it (plan 2.5, 2.6)
      if (mine.get('b rh') === 'bloodgroup') fillGroup(group, b[0], b.index, true);
      else if (card || mine.get('b rh') !== 'ignore') {
        ask(
          { key: 'b rh', remember: !card, group: 'confirm', prompt: `Blood group ${group}?`, options: [opt('bloodgroup', `Yes – blood group ${group}`), opt('ignore', 'No, not a blood group')], data: { group } },
          b[0],
          b.index,
        );
      }
    }
    const rh = s.match(/\brh\s*(?:factor\s+)?(positive|negative)\b/i);
    if (rh && !isUsed(rh.index, rh.index + rh[0].length)) {
      // "blood group Rh negative" (the ABO group not heard): the label goes with the Rh
      const label = s.slice(0, rh.index).match(/\b(?:blood\s*(?:group|type|grp)|bg)\s*(?:is|:|-)?\s*$/i);
      use(rh.index - (label && !isUsed(label.index, rh.index) ? label[0].length : 0), rh.index + rh[0].length);
      const sign = /^p/i.test(rh[1]) ? '+' : '-';
      ask(
        { group: 'confirm', prompt: 'Which ABO group?', options: [...['A', 'B', 'AB', 'O'].map((g) => opt(`blood:${g}${sign}`, `${g}${sign}`)), opt('ignore', 'Not known yet')] },
        rh[0],
        rh.index,
      );
    }
  }

  // Height and weight (the mother's)
  if (!isNewborn) {
    const ft = s.match(/(?<![\d.])\b(\d)\s*(?:feet|foot|ft|')\s*(?:(\d{1,2})\s*(?:inches|inch|in|")?)?/i);
    const hm =
      s.match(/(?<!\b(?:fundal|sfh|symphysis|symphysio-?fundal|uterine|abdominal)\s)\bheight\s*(?:is|of|:|-)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(cm|cms|centimet(?:er|re)s?|m|metres?|meters?|feet|ft)?(?![a-z])/i) ??
      s.match(/\b(\d{3})\s*(cm|cms|centimet(?:er|re)s?)\b/i) ??
      s.match(/\b(\d{3})()\s+height\b/i); // "152 height"
    if (ft) {
      const cm = Math.round((Number(ft[1]) * 30.48 + Number(ft[2] ?? 0) * 2.54) * 10) / 10;
      put(f, 'medical.heightCm', String(cm));
      heard.height = { cm, text: ft[0], at: ft.index };
      use(ft.index, ft.index + ft[0].length);
    } else if (hm) {
      use(hm.index, hm.index + hm[0].length);
      const n = Number(hm[1]);
      if (n >= 4 && n < 7 && (!hm[2] || /^f/i.test(hm[2])) && /\.\d/.test(hm[1])) {
        // "height 5.2": 5 ft 2 in, or 5.2 ft?
        const how = mine.get('height n.n');
        if (how === 'height-ftin' || how === 'height-feet') applyMeaning(f, how, { raw: hm[1] }, true);
        else if (how !== 'ignore') {
          ask(
            {
              key: 'height n.n',
              remember: true,
              group: 'safety',
              prompt: `Height ${hm[1]} – feet and inches?`,
              options: [opt('height-ftin', `${hm[1].replace('.', ' ft ')} in (${heightFrom(hm[1], 'height-ftin')} cm)`), opt('height-feet', `${hm[1]} feet (${heightFrom(hm[1], 'height-feet')} cm)`), IGNORE],
              data: { raw: hm[1] },
            },
            hm[0],
            hm.index,
          );
        }
      } else if (n > 0) {
        const cm = Math.round((n < 3 ? n * 100 : n) * 10) / 10;
        // "height 1 52" (one fifty-two) or "height 5 2" (5 feet 2): offered, never read as 100 or 5
        const next = !hm[2] && s.slice(hm.index + hm[0].length).match(/^\s*(\d{1,2})(?![\d.])/);
        const two = next && Number(next[1]);
        const alt =
          next && n === 1 && two >= 20 ? { cm: 100 + two, label: `${100 + two} cm` } : next && n >= 4 && n <= 6 && two <= 11 ? { cm: Number(heightFrom(`${n}.${two}`, 'height-ftin')), label: `${n} feet ${two} inches (${heightFrom(`${n}.${two}`, 'height-ftin')} cm)` } : null;
        const end = hm.index + hm[0].length + (alt ? next[0].length : 0);
        if (alt) use(hm.index, end);
        put(f, 'medical.heightCm', String(cm));
        heard.height = { cm, alt, text: s.slice(hm.index, end), at: hm.index };
      }
    }
    // "60 kg" is read before "weight 60", so a number with its unit wins
    const NOT_MOTHER = /\b(?:birth|baby|babies|fetal|foetal|estimated|efw|child|son|daughter|newborn)\s+(?:\w+\s+)?$/i;
    for (const rx of [/\b(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs|kilos?|kilograms?)\b/gi, /\b(?:weight|weighs|weighing)\s*(?:is|of|:|-)?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(?:kg|kgs|kilos?|kilograms?)?(?![a-z0-9])/gi]) {
      const m = [...s.matchAll(rx)].find((x) => !NOT_MOTHER.test(s.slice(Math.max(0, x.index - 25), x.index)) && !isUsed(x.index, x.index + x[0].length));
      if (m) {
        put(f, 'medical.weightKg', String(Number(m[1])));
        heard.weight = { kg: Number(m[1]), text: m[0], at: m.index };
        use(m.index - labelBefore(s, m.index), m.index + m[0].length);
        break;
      }
    }
  }

  // The same detail said twice with different values, and no "sorry": asked, never a silent pick
  for (const c of said.conflicts) {
    if (c.field === 'weeks' || c.field === 'antiD') continue; // read with the weeks, and with anti-D, below
    for (const v of c.all) use(v.start, v.end);
    const at = c.values[0].start;
    const heardText = c.values.map((v) => s.slice(v.start, v.end)).join(' … ');
    if (c.hidden) {
      drop('newborn.sex');
      note("The baby's sex was said in two different ways – choose it in the form.");
      continue;
    }
    if (c.field === 'result') {
      const term = TERMS.find((t) => t.result && t.says.some((say) => say.toLowerCase() === c.label.toLowerCase().replace(/\s+/g, ' ')));
      if (term) ask(resultCard(term.to, c.label, false), heardText, at);
      continue;
    }
    if (c.field === 'bloodGroup') {
      drop('medical.bloodGroup');
      questions.splice(0, questions.length, ...questions.filter((q) => !(q.group === 'confirm' && /^Blood group/.test(q.prompt))));
      const groups = [...new Set(c.values.map((v) => groupOf(v.value.match(new RegExp(BG_VALUE, 'i')))))];
      ask({ group: 'confirm', prompt: `Blood group ${groups.join(' or ')}?`, options: [...groups.map((g) => opt(`blood:${g}`, g)), LEAVE_BLANK] }, heardText, at);
      continue;
    }
    const path = CORRECTED_PATH[c.field] ?? `obstetric.${c.field}`;
    const valueOf = (v) => {
      // a date said with spaces is read only at the start ("12 7"); "by scan 15 April" anywhere
      const when = c.field === 'lmp' ? 'past' : 'future';
      if (c.field === 'lmp' || c.field === 'edd') return (readDate(v.value, now, when, true) ?? readDate(v.value, now, when, false))?.iso;
      if (c.field === 'phone') return phoneFromDigits(v.value.replace(/\D/g, ''));
      return v.value.match(/\d+(?:\.\d+)?/)?.[0];
    };
    const values = c.values.map(valueOf).filter(Boolean);
    // a phone number said in two ways ("+91 …" and "…") is the same one
    const options = c.field === 'phone' ? [...new Map(values.map((v) => [phoneKey(v), v])).values()] : [...new Set(values)];
    if (c.field === 'phone' && options.length < 2) continue;
    // A plain EDD said twice: its "is it from a dating scan?" questions go, and a scan EDD said separately is kept
    if (c.field === 'edd') questions.splice(0, questions.length, ...questions.filter((q) => !(q.key === 'edd' && options.includes(q.data?.date))));
    if (c.field !== 'edd' || c.scan || scanEddFrom !== 'scan') {
      drop(path);
      delete heard[{ age: 'age', phone: 'phone', lmp: 'lmp', edd: 'scanEdd', height: 'height', weight: 'weight' }[c.field] ?? 'formula'];
    }
    const show = (v) => (c.field === 'lmp' || c.field === 'edd' ? showDate(v) : v);
    const plainEdd = c.field === 'edd' && !c.scan;
    ask(
      {
        group: 'safety',
        part: isInfoPath(path) ? 'info' : 'clinical',
        prompt: `${capitalise(c.name)} was said twice: ${options.map(show).join(' or ')}?${plainEdd ? ' Choose one only if it is from a dating scan.' : ''}`,
        options: [...options.map((v) => opt(`value:${path}=${v}`, plainEdd ? `${show(v)} (dating scan)` : String(show(v)))), LEAVE_BLANK],
        ...(plainEdd ? { plainEdd: true } : {}),
      },
      heardText,
      at,
    );
  }

  // A round ten and then a word that sounds like a digit ("age thirty to", "weight 50 ate kg", "height 150 for"): the
  // number may have been split by a pause (32? 58? 154?), so it is asked, never filled (plan 2.6). Only when the
  // detail ends there (a unit, a stop, the next detail): never a range ("FBS 90 to 100") or "age 30 for ANC booking".
  for (const [key, path, unit, ends] of SPLIT_NUMBER_FIELDS) {
    const h = heard[key];
    const [a, b] = path.split('.');
    const value = Number(b ? f.values[a]?.[b] : f.values[a]);
    const tens = key === 'height' ? value - 100 : value;
    if (!h || !Number.isInteger(tens) || tens % 10 || tens < 20 || tens > 90) continue;
    const end = h.at + h.text.length;
    const m = s.slice(end).match(SPLIT_DIGIT);
    const after = m && s.slice(end + m[0].length);
    if (!m || !(new RegExp(`^\\s*(?:[,.;\\n]|$|(?:${ends})\\b)`, 'i').test(after) || NEXT_DETAIL_HERE.test(after))) continue;
    const other = value + (DIGIT_SOUNDS[m[1].toLowerCase()] ?? Number(m[1]));
    drop(path);
    delete heard[key];
    use(end, end + m[0].length);
    const part = isInfoPath(path) ? 'info' : 'clinical';
    const options = [opt(`value:${path}=${value}`, `${value}${unit}`), opt(`value:${path}=${other}`, `${other}${unit}`), LEAVE_BLANK];
    ask({ group: 'safety', part, prompt: `${capitalise(key)} ${value} or ${other}${unit}?`, options }, s.slice(h.at, end + m[0].length), h.at);
  }

  // A word kept as heard (Undo) straight after an age, height or weight ("age 20 tree"): the number may be cut short,
  // so it is asked, never filled
  for (const [key, path, unit] of [['age', 'ageYears', ''], ['height', 'medical.heightCm', ' cm'], ['weight', 'medical.weightKg', ' kg']]) {
    const h = heard[key];
    const end = h && h.at + h.text.length;
    if (!h || !keptAt.some(([x]) => x >= end && /^[\s,-]*$/.test(s.slice(end, x)))) continue;
    const [a, b] = path.split('.');
    const value = b ? f.values[a]?.[b] : f.values[a];
    if (value === undefined) continue;
    drop(path);
    delete heard[key];
    const part = isInfoPath(path) ? 'info' : 'clinical';
    ask({ group: 'safety', part, prompt: `${capitalise(key)} ${value}${unit} – is that right? A word after it was kept as heard.`, options: [opt(`value:${path}=${value}`, `Yes, ${value}${unit}`), LEAVE_BLANK] }, h.text, h.at);
  }

  const checked = checkRanges(f.values, heard, careType, now);
  checked.drop.forEach(drop);
  for (const q of checked.questions) ask(q, q.heard, q.at);
  checked.notes.forEach(note);
  // A plain EDD more than 14 days from the LMP's: "Yes – from a dating scan" fills the scan EDD without the check in
  // checkRanges, so its question says how far apart they are (plan 2.6)
  const lmpKept = f.values.pregnancy?.lmp;
  const plainEdds = questions.filter((q) => q.plainEdd);
  plainEdds.forEach((q) => delete q.plainEdd); // marks the plain EDD said twice; not part of a question
  if (lmpKept) {
    const byLmp = new Date(lmpEdd(lmpKept)).toISOString().slice(0, 10);
    const gap = (iso) => Math.round(Math.abs(Date.parse(`${iso}T00:00:00Z`) - lmpEdd(lmpKept)) / DAY);
    const far = (iso) => gap(iso) > 14;
    for (const q of questions) {
      if (q.key === 'edd' && q.data?.date && far(q.data.date)) {
        q.prompt += ` It is ${gap(q.data.date)} days from the EDD by LMP (${showDate(byLmp)}).`;
        q.options = q.options.map((o) => (o.value === 'scanedd' ? { ...o, label: `${o.label} (${gap(q.data.date)} days from the EDD by LMP)` } : o));
      } else if (plainEdds.includes(q)) {
        const dates = q.options.map((o) => o.value.match(/^value:pregnancy\.scanEdd=(\d{4}-\d{2}-\d{2})$/)?.[1]);
        if (!dates.some((d) => d && far(d))) continue;
        q.prompt += ` The EDD by LMP is ${showDate(byLmp)}.`;
        q.options = q.options.map((o, i) => (dates[i] && far(dates[i]) ? { ...o, label: `${showDate(dates[i])} (dating scan, ${gap(dates[i])} days from the EDD by LMP)` } : o));
      }
    }
  }

  // Terms, the doctor's own words and the special cases – longest first, each part of the text used once
  const candidates = [];
  for (const [phrase, meaning] of mine) {
    if (['edd', 'b rh', 'height n.n'].includes(phrase)) continue;
    for (const m of s.matchAll(new RegExp(`${EDGE_L}${sayPattern(phrase)}${EDGE_R}`, 'gi'))) candidates.push({ start: m.index, end: m.index + m[0].length, rank: 0, mine: meaning, m });
  }
  for (const sp of SPECIALS) for (const m of s.matchAll(sp.rx)) candidates.push({ start: m.index, end: m.index + m[0].length, rank: 1, special: sp, m });
  const late = candidates.filter((c) => c.special?.late).sort((a, b) => a.start - b.start);
  for (const { term, rx } of TERM_RX) for (const m of s.matchAll(rx)) candidates.push({ start: m.index, end: m.index + m[0].length, rank: 2, term, m });
  const early = candidates.filter((c) => !c.special?.late).sort((a, b) => b.end - b.start - (a.end - a.start) || a.rank - b.rank || a.start - b.start);
  const ctx = { s, careType, f, voice: card, use };
  // The words that go with a finding read at [c.start, c.end) are used too, so "Not understood" never lists them on
  // their own (plan G5.10): its result ("HIV non reactive", or one shared: "HIV, HBsAg and VDRL negative"), the "no"
  // said before it with its words ("no history of", "not a known case of"), and a clinical word just before it
  // ("known case of", "h/o"). Never a part of another finding, nor a word the lookup table asks about.
  const lookupAt = prepared.lookups.flatMap((q) => [...s.matchAll(new RegExp(`${EDGE_L}${escapeRx(q.heard).replace(/\s+/g, '\\s+')}${EDGE_R}`, 'gi'))].map((x) => [x.index, x.index + x[0].length]));
  const clear = (a, b, c) => a < b && !candidates.some((x) => x !== c && a < x.end && b > x.start) && !lookupAt.some(([x, y]) => a < y && b > x);
  const useAnchor = (start, c) => {
    const m = s.slice(Math.max(0, start - 30), start).match(CLINICAL_LEAD);
    if (m && clear(start - m[0].length, start, c)) use(start - m[0].length, start);
  };
  const useWith = (c, test = true) => {
    const got = resultSpan(s, c.end, test, c.start);
    const doubt = !got && doubtfulResult(s, c.start, c.end);
    if (got) {
      if (clear(got.start, got.end, c)) use(got.start, got.end);
      if (RESULT_GAP.test(s.slice(c.end, got.start)) && clear(c.end, got.start, c)) use(c.end, got.start);
    } else if (doubt && clear(c.end, c.start + doubt.length, c)) use(c.end, c.start + doubt.length);
    else if (negated(s, c.start, c.end, true, test)) {
      const no = negationSpan(s, c.start);
      if (no && clear(no.start, no.end, c)) use(no.start, no.end);
    }
    useAnchor(c.start, c);
  };
  let family = false;
  for (const c of [...early, ...late]) {
    if (isUsed(c.start, c.end) || inName(c.start, c.end)) continue;
    use(c.start, c.end);
    let result;
    if (c.mine) {
      const kind = c.mine.split(':')[0];
      const neg = (kind === 'condition' || kind === 'past' || kind === 'other') && negated(s, c.start, c.end, true, RESULT_MEANINGS.has(c.mine));
      if (c.mine === 'ignore') continue;
      useWith(c, RESULT_MEANINGS.has(c.mine));
      if (neg === true) continue;
      // A result is confirmed even when it is the doctor's own word (safety rules come after learned words). HCV shares
      // its meaning with liver words that are not results, so there it counts as a result when a result word follows.
      const after = resultAfter(s, c.end);
      if (RESULT_MEANINGS.has(c.mine) || (c.mine === 'condition:liver_disease' && (after || doubtfulResult(s, c.start, c.end)))) {
        const doubt = doubtfulResult(s, c.start, c.end);
        if (after !== 'negative') ask(resultCard(c.mine, c.m[0], after === 'positive' && !doubt), doubt ?? c.m[0], c.start);
      } else if (neg === 'ask') {
        ask({ prompt: `“${c.m[0]}” was said right after “no …” – does she have it?`, options: [opt(c.mine, `Yes – ${meaningLabel(c.mine).replace(/^[^:]+: /, '')}`), opt('ignore', 'No')] }, c.m[0], c.start);
      } else applyMeaning(f, c.mine, {}, true, c.start);
      continue;
    }
    if (c.special) {
      const test = !c.special.treatment;
      if (negated(s, c.start, c.end, false, test)) {
        useWith(c, test);
        continue;
      }
      if (c.special.maternal && aboutFamily(s, c.start, FAMILY_ADULT)) {
        useWith(c, test);
        family = true;
        continue;
      }
      if (c.special.skip?.(ctx)) continue;
      result = c.special.resolve(c.m, ctx);
      if (result) useWith(c, test);
    } else {
      result = resolveTerm(c.term, s, c.start, c.end, ctx);
      useWith(c, Boolean(c.term.result));
      const label = result?.meaning && meaningLabel(result.meaning).replace(/^[^:]+: /, '');
      const gestational = result?.meaning === 'condition:diabetes' && soundsGestational(s.slice(0, c.start));
      if (label && /^(?:condition|past|other):/.test(result.meaning) && spelled.has(c.m[0].replace(/[\s-]/g, '').toUpperCase())) {
        // Two letters said one by one ("T B", "D M") may be a name's initials: asked, never ticked (plan 2.3 step 6)
        result = { question: { prompt: `“${c.m[0]}” was heard as letters said one by one – ${label}?`, options: [opt(result.meaning, `Yes – ${label}`), IGNORE] } };
      } else if (gestational) {
        // "jestational diabetes": never diabetes from before the pregnancy without asking
        use(gestational.start, c.end);
        const options = pregnancyCare(careType)
          ? [opt('condition:diabetes', 'Diabetes before pregnancy'), opt('note:Gestational diabetes (this pregnancy)', 'GDM – this pregnancy (notes)'), IGNORE]
          : [opt('condition:diabetes', 'Yes – diabetes'), IGNORE];
        const prompt = pregnancyCare(careType) ? 'Diabetes from before this pregnancy, or diabetes of this pregnancy (GDM)?' : 'Diabetes (not only in a pregnancy)?';
        result = { heard: s.slice(gestational.start, c.end), question: { prompt, options } };
      }
    }
    if (!result) continue;
    if (result.family) family = true;
    else {
      if (result.meaning) applyMeaning(f, result.meaning, {}, false, c.start);
      if (result.question) ask(result.question, result.heard ?? c.m[0], c.start);
    }
  }
  if (family) note("Illnesses of family members (or of a previous baby) are not the patient's own, so they were not ticked.");

  // "None" answers
  if (!isNewborn && !(f.values.medical?.conditions ?? []).length) {
    const none = noConditionsSaid(s);
    if (none) {
      put(f, 'medical.conditionsReviewed', true);
      use(none.start, none.end);
    }
  }
  const firstPregnancy = careType === 'antenatal' && f.values.obstetric?.gravida === '1';
  if (firstPregnancy && f.values.obstetric?.pastComplications) {
    delete f.values.obstetric.pastComplications;
    f.paths = f.paths.filter((p) => p !== 'obstetric.pastComplications');
  }
  if (!isNewborn && !firstPregnancy && !(f.values.obstetric?.pastComplications ?? []).length) {
    const none = s.match(
      /\b(?:no\s+(?:problems?|complications?|issues?)\s+(?:in|during|with)\s+(?:the\s+|her\s+)?(?:previous|past|earlier|last|prior)\s+(?:pregnanc(?:y|ies)|deliver(?:y|ies))|previous\s+(?:pregnanc(?:y|ies)|deliver(?:y|ies))\s+(?:was\s+|were\s+)?(?:normal|uneventful|uncomplicated)|no\s+bad\s+obstetric\s+history|no\s+boh)\b/i,
    );
    if (none) {
      put(f, 'obstetric.complicationsReviewed', true);
      use(none.start, none.end);
    }
  }
  if (/\b(?:gestational\s+diabet(?:es|ic)|gdm)\b/i.test(s) && careType !== 'antenatal' && careType !== 'postnatal') {
    note('Gestational diabetes was said, but this is not a pregnancy record – add it to the notes if it matters.');
  }

  if (!isNewborn) {
    // How long ago a previous-pregnancy finding was ("previous LSCS 5 years back", "1 abortion 2 years ago"): the
    // finding with its time, in the notes – never a date or a count. Only when every word between "previous" (or the
    // count) and the time was read as a finding, is an abortion word, or joins two ("previous LSCS for CPD 3 years
    // back"); never after "no previous …".
    for (const m of s.matchAll(YEARS_BACK)) {
      const end = m.index + m[0].length;
      if (isUsed(m.index, end) || inName(m.index, end)) continue;
      const lead = [...s.slice(segmentStart(s, m.index), m.index).matchAll(/\b(?:previous|prior)\b|\b\d{1,2}\s+(?=(?:abortions?|miscarriages?|mtps?)\b)/gi)].pop();
      const from = lead && segmentStart(s, m.index) + lead.index;
      if (lead && /\b(?:no|not|nil|never)\s+$/i.test(s.slice(Math.max(0, from - 8), from))) continue;
      const words = lead ? [...s.slice(from + lead[0].length, m.index).matchAll(/\S+/g)].map((w) => ({ w: w[0], at: from + lead[0].length + w.index })) : [];
      const read = words.filter((x) => isUsed(x.at, x.at + 1) || /^(?:abortions?|miscarriages?|mtps?)$/i.test(x.w));
      if (!lead || m.index - from > 60 || !read.length || !words.every((x) => read.includes(x) || /^(?:for|with|by|of|due|to|in|at|pregnancy|delivery|baby)$/i.test(x.w))) continue;
      use(from, end);
      put(f, 'notes', capitalise(s.slice(from, end).replace(/\s+/g, ' ')), false, from);
    }
    // Screening tests said as non-reactive or negative ("HIV non-reactive, HBsAg negative"): one note, the tests in
    // the order said. Nothing is ticked, and a reactive result still goes to the confirmation card. Only a result said
    // straight after its test (screeningResult), and never when the same test is also said as reactive, is corrected
    // ("HIV negative no reactive"), is a previous pregnancy's or a family member's, or is said twice two ways.
    const screened = [];
    const positive = new Set();
    for (const m of s.matchAll(SCREENING_TEST)) {
      const end = m.index + m[0].length;
      const name = SCREENING_NAMES[m[0].toLowerCase().replace(/[\s-]+/g, '')];
      if (inName(m.index, end) || aboutFamily(s, m.index, FAMILY_ADULT) || screened.some((x) => x.name === name)) continue;
      if (said.conflicts.some((c) => c.field === 'result' && c.all.some((v) => m.index < v.end && end > v.start))) continue;
      const got = screeningResult(s, end);
      if (got?.kind === 'positive') positive.add(name);
      if (got?.kind !== 'negative') continue;
      // What follows the result, up to the next test or detail: "… in previous pregnancy", "… no reactive", "… now reactive"
      const rest = screeningAfter(s, got.end);
      if (/\b(?:positive|reactive|detected)\b/i.test(rest.replace(/\bnon[\s-]*reactive\b/gi, ' '))) {
        // Said as reactive too ("HIV negative, no, reactive", "… now reactive"): asked in the confirmation card
        positive.add(name);
        const term = TERMS.find((t) => t.result && t.says.some((say) => say.toLowerCase() === m[0].toLowerCase().replace(/\s+/g, ' ')));
        if (term && !questions.some((q) => q.group === 'confirm' && q.options.some((o) => o.value === term.to))) {
          use(end, got.end + rest.trimEnd().length);
          ask(resultCard(term.to, m[0], false), s.slice(m.index, got.end + rest.trimEnd().length), m.index);
        }
        continue;
      }
      if (pastAttached(s, m.index, got.end) || SCREENING_PAST_AFTER.test(rest)) continue;
      use(end, got.end);
      screened.push({ name, result: /^non|^nr$/i.test(s.slice(got.start, got.end)) ? 'non-reactive' : 'negative', at: m.index });
    }
    for (const [i, x] of [...screened.entries()].reverse()) if (positive.has(x.name)) screened.splice(i, 1);
    if (screened.length) put(f, 'notes', screened.map((x) => `${x.name} ${x.result}`).join(', '), false, screened[0].at);
  }

  // "Did you mean …?" for words the lookup table is not sure of (tier C, plan 2.3 step 8): "CDM" – GDM?, "wait 25" –
  // the weight? The words heard are still in the text. They come after the safety checks (plan 1.7, group 3).
  for (const q of prepared.lookups) {
    const rx = new RegExp(`${EDGE_L}${escapeRx(q.heard).replace(/\s+/g, '\\s+')}${EDGE_R}`, 'gi');
    const m = [...s.matchAll(rx)].find((x) => !isUsed(x.index, x.index + x[0].length) && !inName(x.index, x.index + x[0].length));
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    const keep = opt('ignore', 'Keep as said');
    if (q.value) {
      use(start, end);
      useAnchor(start);
      ask({ prompt: `Did you mean “${q.to}”? (${meaningLabel(q.value)})`, options: [opt(q.value, 'Yes'), keep] }, m[0], start);
      continue;
    }
    const target = lookupTarget(q.to, s, start, end, ctx);
    if (target?.none) {
      // Nothing the word would fill ("DSH normal" – TSH?, "tipsy test done" – DIPSI?): Yes puts that part of the
      // sentence in the notes with the word meant. Remember is not offered – the note holds this patient's words.
      const run = unusedRunAround(start, end);
      const meant = capitalise(`${s.slice(run.start, start)}${q.to}${s.slice(end, run.end)}`.replace(/\s+/g, ' ').trim());
      use(run.start, run.end);
      ask({ key: m[0].toLowerCase(), remember: false, prompt: `Did you mean “${q.to}”?`, options: [opt(`note:${meant}`, `Yes – add “${meant}” to the notes`), keep] }, m[0], start);
      continue;
    }
    const result = target?.result;
    if (!result || result.family || (result.meaning && isTicked(f, result.meaning))) continue;
    use(start, end);
    useAnchor(start);
    const options = result.meaning
      ? [opt(result.meaning, `Yes – ${meaningLabel(result.meaning).replace(/^[^:]+: /, '')}`), keep]
      : [...result.question.options.filter((o) => o.value !== 'ignore'), keep];
    // Remember is not offered for what may be a name (plan 2.5), nor for a result or a finding that depends on when
    const maybeName = /^[A-Z][a-z]/.test(m[0]) || BEFORE_A_NAME.test(s.slice(Math.max(0, start - 20), start));
    const fixedMeaning = Boolean(result.meaning) && !target.term?.now && !target.term?.result && !target.term?.delivery && !maybeName && q.remember !== false;
    const prompt = `Did you mean “${q.to}”?${result.meaning ? '' : ` ${result.question.prompt}`}`;
    ask({ key: m[0].toLowerCase(), remember: fixedMeaning, prompt, options }, m[0], start);
  }

  // Short forms the app doesn't know: ask what they mean (the doctor can teach them). Never inside a name.
  if (!isNewborn) {
    for (const m of s.matchAll(/(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,5}(?![A-Za-z0-9])/g)) {
      const start = m.index;
      const end = start + m[0].length;
      if (isUsed(start, end) || inName(start, end) || SHORT_FORMS.has(m[0]) || /^[A-Z]\d+$/.test(m[0]) || saysFetalSex(m[0])) continue; // never taught as a note (PCPNDT)
      use(start, end);
      ask({ key: m[0].toLowerCase(), remember: true, teach: true, prompt: "The app doesn't know this short form. What does it mean?", options: [IGNORE] }, m[0], start);
    }
    // Words that look misheard or mistyped: "did you mean …?". In voice entry (spoken or typed into its box), a word
    // that may be a name or an ordinary English word (capitalised, or in realWordGuard.js: "Premila", "Kochi",
    // "seizure") is asked about only after a clinical word ("known case of", "on" …; plan 2.5), or when it and the next
    // word are one finding together ("oligio hydramnios" – oligo hydramnios?, "eclamptis fits"): the next word alone
    // may be its opposite. A word that is neither ("animia", "asthoma") is always asked about.
    for (const m of s.matchAll(/(?<![A-Za-z])[A-Za-z]{5,}(?![A-Za-z])/g)) {
      const start = m.index;
      const end = start + m[0].length;
      if (isUsed(start, end) || inName(start, end) || saysFetalSex(m[0]) || inKept(start, end)) continue;
      const close = closestWord(m[0]);
      if (!close) continue;
      const next = s.slice(end).match(/^[\s-]+([A-Za-z]+)/)?.[1].toLowerCase();
      const partOf = Boolean(next) && close.term.says.some((w) => [`${close.word} ${next}`, `${close.word}${next}`].includes(w.toLowerCase()));
      const maybeWord = /^[A-Z]/.test(m[0]) || REAL_WORDS.has(m[0].toLowerCase());
      if (voice && maybeWord && !partOf && !clinicalAnchor(s, start)) continue;
      use(start, end);
      useAnchor(start);
      const result = resolveTerm(close.term, s, start, end, ctx);
      if (!result || result.family) continue;
      if (result.meaning && isTicked(f, result.meaning)) continue; // already ticked (plan G5.4)
      const options = result.meaning ? [opt(result.meaning, `Yes – ${meaningLabel(result.meaning).replace(/^[^:]+: /, '')}`), opt('ignore', 'No')] : result.question.options;
      // Remember is not offered for what may be a name: a capitalised word, or one said after "husband", "Dr" …
      const maybeName = /^[A-Z][a-z]/.test(m[0]) || BEFORE_A_NAME.test(s.slice(Math.max(0, start - 20), start));
      const fixedMeaning = Boolean(result.meaning) && !close.term.now && !close.term.result && !close.term.delivery && !maybeName;
      ask({ key: m[0].toLowerCase(), remember: fixedMeaning, prompt: `Did you mean “${close.word}”?`, options }, m[0], start);
    }
  }

  // What nothing was taken from: runs of 2 or more words inside one part of a sentence (plan G5.10), so they are listed
  // even when something else in that part was used. Anything about the baby's sex is never offered for the notes, and
  // outside a pregnancy it is not listed at all (plan 4.2).
  const unused = [];
  const runs = [];
  let run = null;
  for (const w of s.matchAll(/[^\s,.;\n]+|[,.;\n]/g)) {
    const free = !/^[,.;\n]$/.test(w[0]) && !isUsed(w.index, w.index + w[0].length);
    if (free) run = { start: run?.start ?? w.index, end: w.index + w[0].length };
    else if (run) (runs.push(run), (run = null));
  }
  if (run) runs.push(run);
  for (const { start, end } of runs) {
    // A plain number counts as a word, so one left over is never dropped without a sign ("she's 32") – except the dose
    // of a medicine ("50 mcg daily")
    const words = s.slice(start, end).split(/\s+/).filter((w) => /[a-z]/i.test(w) || /^\d+(?:\.\d+)?$/.test(w));
    const said = s.slice(start, end).trim().replace(/\s+/g, ' ');
    const dose = words.some((w) => DOSE_WORD.test(w));
    const rest = words.filter((w) => !FILLER_WORDS.has(w.toLowerCase()) && !GAP_WORDS.has(w.toLowerCase()) && !(dose && /^\d/.test(w)));
    // Also left out: one known short form with only small words and no number ("today by LSCS" for a newborn), and
    // words that say nothing on their own ("non reactive", "known case of")
    const lone = rest.length === 1 && SHORT_FORMS.has(rest[0].toUpperCase()) && !/\d/.test(said);
    if (words.length < 2 || !rest.length || lone || onlyLinkWords(said)) continue;
    const sex = saysFetalSex(said);
    if (sex && careType !== 'antenatal' && careType !== 'abortion') continue;
    unused.push({ text: said.length > 100 ? `${said.slice(0, 100)}…` : said, note: capitalise(said).slice(0, 200), canNote: !sex, sex, start });
    if (unused.length >= 8) break;
  }

  const corrections = prepared.corrections.filter((c) => !saysFetalSex(`${c.heard} ${c.to}`)).map((c) => (NUMBER_RULES.has(c.rule) ? { ...c, undo: false } : c));
  return { ...finish(f), notes, questions: questions.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.at - b.at), unused, corrections };
}

// The words about the baby's sex, with the few fixed words around them ("the baby is a", "two", "hai", "as per scan").
// A "no" and the details said before or after are never cut (plan 4.2). A scan phrase said before them is kept (it can
// belong to the EDD said before it); one said after them goes.
const SCAN_SAID = String.raw`(?:as\s+per|on|in|by)\s+(?:the\s+)?(?:scan|usg|ultrasound|sonography|sono)`;
const SEX_PHRASE = new RegExp(
  String.raw`\b(?:(?:the\s+)?(?:baby|fetus|foetus|child)\s+(?:(?:is|was|will\s+be)\s+)?(?:a\s+)?)?(?:(?:\d{1,2}|one|two|three|four|a|an)\s+)?` +
    FETAL_SEX_WORDS.source.replace(/^\\b|\\b$/g, '') +
    String.raw`\b(?:\s+(?:baby|child|fetus|foetus|hai|he|hoga|hogi)\b)?(?:\s+of\s+(?:the\s+)?(?:baby|fetus|foetus|child)\b)?(?:\s+${SCAN_SAID})?`,
  'gi',
);
const SEX_MARKS = new RegExp(`${KARYOTYPE.source}|${SEX_SYMBOLS.source}`, 'g'); // case-sensitive, as in pcpndtWords.js
// Chrome can write "male" as its sound-alike "mail" (and "female" as "fe mail" / "fee mail"). Those are ordinary words,
// so they count only next to the baby: "mail baby", "baby is mail", "it's a mail". Voice entry only – the shared list
// in pcpndtWords.js stays the same as the server's.
const SOUND_ALIKE = String.raw`(?:(?:fe|fee|fi)\s?)?mails?`;
const BABY_WORD = String.raw`(?:bab(?:y|ies)|fetus(?:es)?|foetus(?:es)?|child)`;
const HEARD_SEX_SOURCE =
  String.raw`\b${SOUND_ALIKE}\s+${BABY_WORD}\b` +
  String.raw`|\b(?:(?:the\s+)?${BABY_WORD}\s+(?:is|was|will\s+be)|it['’]?s|it\s+(?:is|was))\s+(?:a\s+)?${SOUND_ALIKE}(?:\s+${BABY_WORD})?\b`;
const HEARD_SEX = new RegExp(HEARD_SEX_SOURCE, 'i');
const HEARD_SEX_PHRASE = new RegExp(`(?:${HEARD_SEX_SOURCE})(?:\\s+${SCAN_SAID})?`, 'gi');
/** mentionsFetalSex, and also the sound-alikes Chrome writes for the words (voice entry). */
export const saysFetalSex = (t) => mentionsFetalSex(t) || HEARD_SEX.test(String(t ?? ''));

/** The text without the words about the baby's sex (for antenatal care, plan 4.2): { text, removed }. */
export function withoutFetalSex(text) {
  const t = String(text ?? '');
  if (!saysFetalSex(t)) return { text: t, removed: false };
  const kept = t.replace(HEARD_SEX_PHRASE, ' ').replace(SEX_PHRASE, ' ').replace(SEX_MARKS, ' ');
  return {
    text: kept
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;])/g, '$1')
      .replace(/([,.;])(?:\s*[,.;])+/g, '$1')
      .replace(/^[\s,.;]+/, '')
      .trim(),
    removed: true,
  };
}

// Returns { formula: { text, at, primi } of the G P L A formula (or of where each count was said), bareCaesarean:
// { text, at } of "LSCS" said straight after it, caesareanByDelivery: { text, at, count } of "1st delivery LSCS …"
// when it has to be asked }
function findObstetric(s, careType, f, use) {
  const counts = {};
  const found = {};
  const parts = []; // where each count was said, for the question when the counts cannot all be right
  const set = (key, value, start, end) => {
    if (counts[key] !== undefined) return;
    counts[key] = value;
    use(start, end);
    if (key !== 'previousCaesareans' && !parts.some((p) => p.at === start)) parts.push({ at: start, text: s.slice(start, end) });
  };
  // "G2 P1 L1 A0", "g 2 p 1 l 1 a 0", "G2P1L1A0", "G3 P1+1 L1" (para + abortions)
  for (const g of s.matchAll(/\bg\s*-?\s*(\d{1,2})(?!\d)/gi)) {
    const got = { gravida: Number(g[1]) };
    let end = g.index + g[0].length;
    let t;
    const letters = { p: 'para', l: 'living', a: 'abortions', d: null };
    // "A nil", "A none", "AO": 0 (plan G4.1). The letters may be said as words: "para 1 live 2 abortion 0".
    while ((t = s.slice(end).match(/^\s*[,-]?\s*(para|living|live|alive|abortions?|[plad])\s*-?\s*(\d{1,2}|nil|none|o(?![a-z]))(?:\s*\+\s*(\d{1,2}))?(?!\d)/i))) {
      const key = letters[t[1][0].toLowerCase()];
      if (key) got[key] ??= /^\d/.test(t[2]) ? Number(t[2]) : 0;
      if (key === 'para' && t[3] !== undefined) got.abortions ??= Number(t[3]);
      end += t[0].length;
    }
    if (got.para !== undefined) {
      for (const [k, v] of Object.entries(got)) set(k, v, g.index, end);
      found.formula = { text: s.slice(g.index, end), at: g.index };
      // "G2 P1 L1 A0 LSCS": most likely a previous caesarean – asked (in postnatal care it may be this delivery)
      const cs = careType !== 'postnatal' && s.slice(end).match(/^\s*,?\s*(lscs|cs|caesarean|cesarean|c-?\s?section)\b/i);
      if (cs && !/^\s*,?\s*\S+\s+(?:x|×|times|twice)\b/i.test(s.slice(end))) found.bareCaesarean = { text: cs[1], at: end + cs.index + cs[0].length - cs[1].length };
      break;
    }
  }
  if (counts.para === undefined) {
    const pl = s.match(/\bp\s*(\d{1,2})(?:\s*\+\s*(\d{1,2}))?\s*[,-]?\s*l\s*(\d{1,2})(?:\s*[,-]?\s*a\s*(\d{1,2}|nil|none|o(?![a-z])))?(?!\d)/i);
    if (pl) {
      found.formula = { text: pl[0], at: pl.index };
      set('para', Number(pl[1]), pl.index, pl.index + pl[0].length);
      set('living', Number(pl[3]), pl.index, pl.index + pl[0].length);
      const a = pl[4] ?? pl[2];
      if (a !== undefined) set('abortions', /^\d/.test(a) ? Number(a) : 0, pl.index, pl.index + pl[0].length);
    }
  }
  const CS = '(?:lscs|cs|c-?\\s?sections?|caesareans?(?:\\s+sections?)?|cesareans?(?:\\s+sections?)?|caesarians?|cesarians?|sections?|scars?)';
  const words = [
    ['gravida', /\bgravida\s*(?:is|of|:|-)?\s*(\d{1,2})(?!\d)/i],
    ['gravida', /\b(\d)(?:st|nd|rd|th)\s+gravida\b/i],
    ['para', /\bpara\s*(?:is|of|:|-)?\s*(\d{1,2})(?:\s*\+\s*(\d{1,2}))?(?!\d)/i],
    ['para', /\b(\d{1,2})\s+(?:previous\s+)?(?:normal\s+|vaginal\s+|full[\s-]term\s+)?deliver(?:y|ies)\b/i],
    ['living', /\bliving(?:\s+(?:children|child|kids|issues?))?\s*(?:is|are|:|-)?\s*(\d{1,2})(?!\d)/i],
    ['living', /\b(\d{1,2})\s+(?:living\s+|live\s+|alive\s+)?(?:children|child|kids|issues?)\b/i],
    // "live 2", "live births 2", "alive 2", "live issues 2" – not a time ("live birth 2 years ago")
    ['living', /\b(?:live|alive)(?:\s+(?:births?|children|child|kids|issues?))?\s*(?:is|are|:|-)?\s*(\d{1,2})(?!\d)(?!\s*(?:years?|yrs?|months?|weeks?|days?)\b)/i],
    ['living', /\b(\d{1,2})\s+live\s+births?\b/i],
    ['living', /\bno\s+(?:living\s+)?(?:children|kids|issues?)\b/i, 0],
    // not a time: "previous abortion 2 years back" is when it was (a note), not 2 abortions
    ['abortions', /\b(?:abortions?|miscarriages?|mtps?)\s*(?:is|are|:|-)?\s*(\d{1,2}|nil|none|no)\b(?!\s*(?:years?|yrs?|months?|mths?|weeks?|wks?|days?)\b)/i],
    // a describing word may come before (plan G4.2): "2 missed abortions"
    ['abortions', /\b(\d{1,2})\s+(?:previous\s+)?(?:(?:missed|spontaneous|induced|incomplete|complete|early|medical|surgical|(?:1st|first)\s+trimester)\s+)?(?:abortions?|miscarriages?|mtps?)\b/i],
    ['abortions', /\bno\s+(?:previous\s+)?(?:abortions?|miscarriages?)\b/i, 0],
    ['previousCaesareans', new RegExp(`\\bprevious\\s+${CS}\\s*(?:is|are|:|-)\\s*(\\d{1,2})(?!\\d)`, 'i')],
    ['previousCaesareans', new RegExp(`\\b(?:previous|prior)\\s+${CS}\\s+twice\\b|\\btwice\\s+(?:previous\\s+)?${CS}`, 'i'), 2], // "previous LSCS twice"
    // a number, not "a" or "an": "needs a CS", "planned for a caesarean" is this pregnancy ("a previous CS" is read below)
    ['previousCaesareans', new RegExp(`(?<!\\b[gplad]\\s*)\\b(\\d{1,2})\\s+(?:previous\\s+|prior\\s+|earlier\\s+)?${CS}`, 'i')], // not "A 0 LSCS"
    ['previousCaesareans', new RegExp(`\\b${CS}\\s*(?:x|×|times)\\s*(\\d)\\b`, 'i')],
    ['previousCaesareans', new RegExp(`\\b(\\d)\\s*(?:x|×)\\s*${CS}`, 'i')],
    ['previousCaesareans', new RegExp(`\\bno\\s+(?:previous\\s+|prior\\s+)?${CS}`, 'i'), 0],
    // "previous LSCS", "status post LSCS" – not "post CS counselling", "post LSCS day 2" (this delivery's care)
    [
      'previousCaesareans',
      new RegExp(
        `\\b(?:previous|prior|earlier|past|history\\s+of|status\\s+post|post)\\s+(?:1\\s+)?${CS}(?!\\s*(?:sections?\\s+)?(?:counsell?ing|care|advice|instructions?|day|pod|d\\d|period|recovery|follow[\\s-]?up)\\b)|\\brepeat\\s+(?:lscs|caesarean)`,
        'i',
      ),
      1,
    ],
  ];
  for (const [key, rx, fixed] of words) {
    const m = s.match(rx);
    if (!m) continue;
    if (counts[key] !== undefined) {
      use(m.index, m.index + m[0].length); // said again (e.g. "previous 2 abortions" after G4P1L0A2)
      continue;
    }
    const raw = fixed ?? m[1];
    set(key, /^(?:nil|none|no)$/i.test(String(raw)) ? 0 : Number(raw), m.index, m.index + m[0].length);
    if (key === 'para' && m[2] !== undefined && counts.abortions === undefined) counts.abortions = Number(m[2]);
  }
  // "1st delivery (was) (by) LSCS", "1st and 2nd delivery LSCS", "pehli delivery LSCS thi" (plan G4.3): one previous
  // caesarean only when one delivery is named, "also" is not said and nothing else gave the number. More than one named,
  // "2nd delivery also LSCS", or postnatal care (where "1st" or "last delivery" may be this one) is asked, never filled.
  const byDelivery = [
    ...s.matchAll(
      new RegExp(
        `\\b((?:(?:1st|2nd|3rd|4th|5th|last|previous)(?:\\s*(?:,|and|&)\\s*)?)+)\\s+(?:deliver(?:y|ies)|pregnanc(?:y|ies)|bab(?:y|ies))\\s+(?:(?:was|were|also|bhi)\\s+)*(?:by\\s+)?(?:lscs|cs|caesareans?|cesareans?|c-?\\s?sections?)\\b`,
        'gi',
      ),
    ),
  ];
  if (byDelivery.length) {
    for (const m of byDelivery) use(m.index, m.index + m[0].length);
    const named = new Set(byDelivery.flatMap((m) => m[1].toLowerCase().match(/1st|2nd|3rd|4th|5th|last|previous/g).map((w) => (w === 'previous' ? 'last' : w))));
    const also = byDelivery.some((m) => /\b(?:also|bhi)\b/i.test(m[0]));
    const once = named.size === 1 && !also;
    if (once && careType !== 'postnatal') {
      if (counts.previousCaesareans === undefined) set('previousCaesareans', 1, byDelivery[0].index, byDelivery[0].index + byDelivery[0][0].length);
    } else if (!once || counts.previousCaesareans === undefined) {
      const count = Math.max(named.size, also ? 2 : 1, counts.previousCaesareans ?? 0);
      found.caesareanByDelivery = { text: byDelivery.map((m) => m[0]).join(' … '), at: byDelivery[0].index, count };
    }
  }
  // A current first pregnancy: nothing before it
  if (careType === 'antenatal' && counts.gravida === undefined) {
    // "1st pregnancy" – but not "eclampsia in (her) 1st pregnancy"
    const notThis = '(?<!\\b(?:in|during|at|of|after|with|since|from)\\s+(?:the\\s+|her\\s+)?)';
    const primi = s.match(new RegExp(`\\bprimi(?:gravida|gravidae|gravid)?\\b|${notThis}\\b1st\\s+pregnancy\\b`, 'i')) ?? s.match(/\bPG\b/);
    const nth = s.match(new RegExp(`${notThis}\\b(\\d)(?:st|nd|rd|th)\\s+(?:pregnancy|gravida)\\b`, 'i'));
    if (primi) {
      found.primiCaesareans = counts.previousCaesareans === undefined; // the 0 caesareans comes only from "primi"
      for (const [k, v] of Object.entries({ gravida: 1, para: 0, living: 0, abortions: 0, previousCaesareans: 0 })) set(k, v, primi.index, primi.index + primi[0].length);
    } else if (nth) set('gravida', Number(nth[1]), nth.index, nth.index + nth[0].length);
  }
  for (const [k, v] of Object.entries(counts)) {
    if (!Number.isInteger(v) || v < 0 || v > (k === 'previousCaesareans' ? 10 : 30)) continue;
    put(f, `obstetric.${k}`, String(v));
  }
  if (found.bareCaesarean && counts.previousCaesareans !== undefined) delete found.bareCaesarean;
  // Asked instead: a number said elsewhere ("previous LSCS … 2nd delivery also LSCS") is not filled on its own
  if (found.caesareanByDelivery && f.values.obstetric?.previousCaesareans !== undefined) {
    delete f.values.obstetric.previousCaesareans;
    if (!Object.keys(f.values.obstetric).length) delete f.values.obstetric;
    f.paths = f.paths.filter((p) => p !== 'obstetric.previousCaesareans');
  }
  if (!found.formula && parts.length) {
    parts.sort((x, y) => x.at - y.at);
    found.formula = { text: parts.map((p) => p.text.trim()).join(' … '), at: parts[0].at };
  }
  if (found.formula && found.primiCaesareans) found.formula.primi = true;
  delete found.primiCaesareans;
  return found;
}

// Newborn: date and time of birth (local time, for the date-time input), weight, sex and the mother.
// Ways a time of birth is said, tried in order until one gives a real time (plan G2.3). Each gives { hour, minute,
// ampm?, h24?, needsPart? }: needsPart – only a time when "in the morning", "subah" … is said too ("at 4 in the morning").
const NOT_WEIGHT = '(?!\\s*(?:kg|kgs|kilos?|g|gms?|grams?|weeks?|wks?|days?|months?)\\b)';
// "at 8" is not a time in "at 8 months", "at 6 hours of life" or "at 5 minutes" (Apgar)
const NOT_AGE = '(?!\\s*(?:kg|kgs|kilos?|g|gms?|grams?|weeks?|wks?|days?|months?|hours?|hrs?|minutes?|mins?)\\b)';
// The parts of the day, as said
const DAY_PART_WORDS = [
  ['morning', 'morning|subah|subha|savere|sawere'],
  ['afternoon', 'afternoon|dopahar|dopeher'],
  ['evening', 'evening|shaam|sham'],
  ['night', 'night|tonight|raat'],
];
const PART_WORD = DAY_PART_WORDS.map(([, words]) => words).join('|');
const TIMES = [
  // "9:15 am", "10 30 am", "3 45 pm", "10:30 a m"
  { rx: /\b(\d{1,2})(?:[:.\s](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/i, read: (m) => ({ hour: +m[1], minute: +(m[2] ?? 0), ampm: m[3].toLowerCase().replace(/[.\s]/g, '') }) },
  // "quarter past 9", "half past 8", "quarter to 10"
  {
    rx: /\b(quarter|half)\s+(past|to)\s+(\d{1,2})\b/i,
    read: (m) => (/^to$/i.test(m[2]) ? (/^q/i.test(m[1]) ? { hour: +m[3] - 1, minute: 45 } : null) : { hour: +m[3], minute: /^q/i.test(m[1]) ? 15 : 30 }),
  },
  { rx: /\b(\d{1,2})\s*o'?\s?clock\b/i, read: (m) => ({ hour: +m[1], minute: 0 }) }, // "9 o'clock"
  { rx: new RegExp(`\\b(\\d{1,2})[:.](\\d{2})(?!\\d)${NOT_WEIGHT}`, 'i'), read: (m) => ({ hour: +m[1], minute: +m[2] }) }, // "9:15"
  { rx: /\b([01]?\d|2[0-3])\s?([0-5]\d)\s*(?:hrs|hours)\b/i, read: (m) => ({ hour: +m[1], minute: +m[2], h24: true }) }, // "1030 hours", "10 30 hours"
  // "at 10 30", "time of birth 9 45" (not a weight or a date)
  { rx: new RegExp(`\\b(?:at|tob|time\\s+of\\s+birth)\\s+(\\d{1,2})\\s+([0-5]\\d)(?!\\d)${NOT_WEIGHT}`, 'i'), read: (m) => ({ hour: +m[1], minute: +m[2] }) },
  { rx: /\b(\d{1,2})\s+baje\b/i, read: (m) => ({ hour: +m[1], minute: 0 }) }, // "subah 9 baje"
  { rx: new RegExp(`\\bat\\s+(\\d{1,2})(?![\\d:.])${NOT_AGE}`, 'i'), read: (m) => ({ hour: +m[1], minute: 0, needsPart: true }) }, // "at 4 in the morning"
  // "10 30 in the morning", "11 30 at night", "last night 11 30", "raat 11 30": only with the part of the day said right
  // next to it (never the digits of a date or an Apgar score)
  { rx: new RegExp(`(?<!\\bon\\s)\\b(\\d{1,2})\\s+([0-5]\\d)\\s+(?:in\\s+the\\s+|at\\s+)?(?:${PART_WORD})\\b`, 'i'), read: (m) => ({ hour: +m[1], minute: +m[2] }) },
  { rx: new RegExp(`\\b(?:${PART_WORD})\\s+(\\d{1,2})\\s+([0-5]\\d)(?![\\d:.])${NOT_WEIGHT}`, 'i'), read: (m) => ({ hour: +m[1], minute: +m[2] }) },
];
// The part of the day said with a time: 'morning', 'afternoon', 'evening' or 'night'. Only when said right with it:
// in the words matched, just before ("subah 9 baje", "night at 11 20") or within 3 words after ("at 4 in the
// morning"), never across a comma or full stop ("born at 11 15, in the evening mother had PPH").
const PART_BEFORE = new RegExp(`\\b(${PART_WORD})\\s+(?:(?:at|around|about|ko)\\s+)?$`, 'i');
const PART_AFTER = new RegExp(`^(?:\\s+[a-z]+){0,2}?\\s+(${PART_WORD})\\b`, 'i');
// { part, end }: `end` is where the part of the day ends when it was said after the time
function partNear(win, m) {
  const end = m.index + m[0].length;
  const after = win.slice(end).match(PART_AFTER);
  const word = m[0].match(new RegExp(`\\b(${PART_WORD})\\b`, 'i')) ?? win.slice(0, m.index).match(PART_BEFORE) ?? after;
  if (!word) return { part: null, end };
  const part = DAY_PART_WORDS.find(([, words]) => new RegExp(`^(?:${words})$`, 'i').test(word[1]))[0];
  return { part, end: word === after ? end + after[0].length : end };
}
function readTime(win) {
  for (const { rx, read } of TIMES) {
    const m = win.match(rx);
    const t = m && read(m);
    const { part, end } = m ? partNear(win, m) : {};
    if (!t || (t.needsPart && !part)) continue;
    const { minute, ampm, h24 } = t;
    let { hour } = t;
    if (hour > 23 || hour < 0 || minute > 59 || (ampm && (hour < 1 || hour > 12))) continue;
    if (ampm) hour = (hour % 12) + (ampm === 'pm' ? 12 : 0);
    else if (!h24 && (part === 'afternoon' || part === 'evening') && hour < 12) hour += 12;
    else if (!h24 && part === 'night') hour = hour === 12 ? 0 : hour >= 6 && hour < 12 ? hour + 12 : hour; // "raat 2 baje" is 2 am
    else if (!h24 && part === 'morning' && hour === 12) hour = 0;
    // Without am/pm or a part of the day, 9:15 could be morning or evening
    const fixed = Boolean(ampm || h24 || part) || hour > 12 || hour === 0;
    return { hour, minute, fixed, index: m.index, end };
  }
  return null;
}
// The date of birth said straight after "born (on)", "DOB", "date of birth" or "delivered on", before or after the time
// ("TOB 10 30, DOB 25 9 2026"; "delivered on 25 9 at 10 30 am"): { date, said, start, end } – `said` is where "DOB" …
// was said, `start` where the date itself starts. `unread`: a date of birth was said ("DOB 31 9", "date of birth not
// known") but could not be read.
const DOB_START = /\b(?:born|dob|date\s+of\s+birth|(?:delivered|delivery)(?=\s+(?:on|dated)\b))\b/gi;
function saidBirthDate(s, now) {
  let unread = false;
  for (const k of s.matchAll(DOB_START)) {
    const from = k.index + k[0].length;
    const date = readDate(s.slice(from), now, 'past', true);
    if (date) return { date, said: k.index, start: from, end: from + date.end };
    const lead = s.slice(from).match(/^[\s,:-]*(?:(?:on|dated|date|is|was)\s+)*/i)[0];
    const next = s.slice(from + lead.length);
    // digits that are not a date ("on 31 9"), or no date known – but not "born 2 10 am", "born at 10 30" (a time)
    if (/^(?:not\s+known|unknown|not\s+sure)\b/i.test(next) || (/^\d/.test(next) && !readTime(next.slice(0, 20)))) unread = true;
  }
  return { unread };
}
const DAY_WORD = /\b(today|yesterday|last\s+night|tonight|this\s+morning|this\s+evening)\b/i;
// `nameText`: the text with words kept as heard blanked (the mother's name ends there)
function findNewborn(s, now, f, use, note, ask, nameText = s) {
  const said = saidBirthDate(s, now);
  for (const k of s.matchAll(/\b(?:born|birth|delivered|delivery|dob|tob|date\s+of\s+birth|time\s+of\s+birth)\b/gi)) {
    let win = s.slice(k.index, k.index + 80);
    // The time is never read from the digits of the date of birth ("DOB 20 09 night")
    if (said.date && said.start < k.index + 80 && said.end > k.index) {
      const a = Math.max(0, said.start - k.index);
      const b = Math.min(win.length, said.end - k.index);
      win = win.slice(0, a) + ' '.repeat(b - a) + win.slice(b);
    }
    const t = readTime(win);
    const dayWord = win.match(DAY_WORD);
    // "born at 10 30 on 27 9": a date after "on" or "dated" straight after the time
    const onDate = Boolean(t) && /^[\s,]*(?:on|dated)\s+\d/i.test(win.slice(t.end));
    const after = onDate ? readDate(win.slice(t.end), now, 'past', true) : null;
    const date = said.date ?? after ?? readDate(win, now, 'past', false);
    if (!t && !date) continue;
    use(k.index, k.index + (t ? t.end : 0));
    if (said.date) use(said.said, said.end);
    else if (after) use(k.index + t.end, k.index + t.end + after.end);
    if (!t) {
      note('The time of birth was not recognised – enter it by hand.');
      break;
    }
    // A date of birth was said but could not be read: today or yesterday is never guessed instead
    if (!date && (said.unread || onDate)) {
      note('The date of birth was not recognised – enter the date and time of birth by hand.');
      break;
    }
    const { hour, minute } = t;
    const at = (base, h) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, minute);
    // "born kal raat 10 baje", "born at 9 am kal": the day is not sure ("kal" is yesterday or tomorrow) – asked, never
    // filled (plan 2.4). Only the birth phrase counts – from the last "born" up to the time, and the one word straight
    // after it – never with "today" or "yesterday" in it, nor "kal se" (since yesterday): "born today 4 am, kal …" keeps today.
    const phrase = `${win.slice(0, t.index).split(/\b(?:born|birth|delivered|delivery|dob|tob)\b/i).pop()} ${win.slice(t.end).match(/^\s*[^\s,.;]*(?:\s+se\b)?/)[0]}`;
    const vague = !date && !DAY_WORD.test(phrase) && phrase.match(/\b(kal|parson|parso)\b(?!\s+se\b)/i);
    if (vague) {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (/^kal$/i.test(vague[1]) ? 1 : 2));
      const times = (t.fixed ? [hour] : [hour, (hour + 12) % 24]).map((h) => localIso(at(base, h)));
      ask(
        {
          group: 'safety',
          part: 'info',
          prompt: `Born on ${showDate(times[0])} (said: “${vague[1]}”) – is that right?`,
          options: [...times.map((iso) => opt(`value:newborn.birthAt=${iso}`, `Yes, ${showDateTime(iso)}`)), LEAVE_BLANK],
        },
        win.slice(0, t.end),
        k.index,
      );
      break;
    }
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const soon = now.getTime() + 5 * 60 * 1000;
    // Without am/pm, 9:15 could be morning or evening: the most recent of the two that has already passed.
    const hours = t.fixed ? [hour] : [hour, hour + 12];
    const latest = (days) => days.flatMap((base) => hours.map((h) => at(base, h))).filter((d) => d.getTime() <= soon).sort((a, b) => b - a)[0];
    let when;
    if (date) {
      const [y, m, d] = date.iso.split('-').map(Number);
      when = new Date(y, m - 1, d, hour, minute);
    } else if (dayWord && /yesterday|last\s+night/i.test(dayWord[1])) when = at(yesterday, hour);
    else if (dayWord) when = latest([now]); // "today": never moved to yesterday
    else when = latest([now, yesterday]);
    if (!when || when.getTime() > soon) note('The time of birth heard is in the future, so it was not used.');
    else put(f, 'newborn.birthAt', localIso(when));
    break;
  }
  // "2 kg 800 grams", "2 kilo 800", "3.2 kg", "2800 grams", "birth weight 2800"
  const kgG = s.match(/\b(\d)\s*(?:kg|kgs|kilos?|kilograms?)\s*(?:and\s+)?(?:(\d{1,3})\s*(?:g|gms?|grams?)\b|(\d{3})(?![\d.]))/i);
  const kg = s.match(/(?<!\bpoint\s)\b(\d(?:\.\d{1,3})?)\s*(?:kg|kgs|kilos?|kilograms?)\b/i); // not the "2" of "[misheard] point 2 kg"
  const g = s.match(/\b(\d{3,4})\s*(?:g|gms?|grams?)\b/i) ?? s.match(/\b(?:birth\s*weight|bw|weight|weighing|weighs)\s*(?:is|of|:|-)?\s*(\d{3,4})(?![\d.])/i);
  const w = kgG ? { m: kgG, grams: Number(kgG[1]) * 1000 + Number(kgG[2] ?? kgG[3]) } : kg ? { m: kg, grams: Math.round(Number(kg[1]) * 1000) } : g ? { m: g, grams: Number(g[1]) } : null;
  if (w && w.grams >= 200 && w.grams <= 7000) {
    put(f, 'newborn.birthWeightGrams', String(w.grams));
    use(w.m.index - labelBefore(s, w.m.index), w.m.index + w.m[0].length);
  }
  const sex =
    s.match(/\b(?:baby|newborn|infant|child)\s+(girl|boy)\b/i) ??
    s.match(/\b(girl|boy)\s+(?:baby|child)\b/i) ??
    s.match(/\b(female|male)\s+(?:baby|child|newborn|infant)\b/i) ??
    s.match(/\bsex\s*(?:is|:|-)?\s*(female|male|girl|boy|indeterminate|ambiguous)\b/i) ??
    s.match(/\bit'?s\s+a\s+(girl|boy)\b/i);
  if (sex) {
    const word = sex[1].toLowerCase();
    put(f, 'newborn.sex', word === 'girl' || word === 'female' ? 'female' : word === 'boy' || word === 'male' ? 'male' : 'indeterminate');
    use(sex.index, sex.index + sex[0].length);
  }
  const mother = nameText.match(MOTHER_OF_BABY) ?? nameText.match(MOTHER_NAMED);
  const got = mother && cleanName(mother[1]);
  if (got) put(f, 'motherName', got.name);
}

const TICK_LISTS = new Set(['medical.conditions', 'obstetric.pastComplications']);
const TEXT_LISTS = new Set(['medical.otherConditions', 'notes']);
// The pieces of an "Other conditions" or notes text ("Twin pregnancy; CPD"), as kept in `added`
const textPieces = (path, value) =>
  String(value ?? '')
    .split(/;\s*/)
    .filter(Boolean)
    .map((t) => `${path}|${t.toLowerCase()}`);

/**
 * Puts dictated values into the form's values (`v`), for the given paths only. Ticked lists are added to
 * (never cleared); "none of these" is only ticked when nothing else is; other conditions and notes are added to.
 * A new recording never undoes the person's own work (plan 1.7):
 * - skip: fields changed by hand ("ageYears", "medical.conditionsReviewed" …) – never overwritten
 * - unticked: items the person unticked ("medical.conditions.asthma") – never ticked again
 * - added: pieces of other conditions and notes already added by voice (dictatedPieces) – never added again, even
 *   when the person has deleted them
 */
export function mergeDictated(v, values, paths, { skip = [], unticked = [], added = [] } = {}) {
  const out = { ...v, newborn: { ...v.newborn }, pregnancy: { ...v.pregnancy }, abortion: { ...v.abortion }, obstetric: { ...v.obstetric }, medical: { ...v.medical } };
  const byHand = new Set(skip);
  const untickedSet = new Set(unticked);
  const addedSet = new Set(added);
  const addText = (path, current, extra) => {
    const have = String(current ?? '').trim();
    const more = String(extra)
      .split(/;\s*/)
      .filter((t) => t && !have.toLowerCase().includes(t.toLowerCase()) && !addedSet.has(`${path}|${t.toLowerCase()}`));
    if (!more.length) return have;
    return have ? `${have}; ${more.join('; ')}` : more.join('; ');
  };
  for (const path of paths) {
    if (path === 'motherName') continue;
    const [a, b] = path.split('.');
    const value = b ? values[a]?.[b] : values[a];
    if (value === undefined) continue;
    if (TICK_LISTS.has(path)) {
      const have = out[a][b] ?? [];
      const more = value.filter((key) => !untickedSet.has(`${path}.${key}`) && !have.includes(key));
      if (!more.length) continue;
      out[a][b] = [...have, ...more];
      out[a][b === 'conditions' ? 'conditionsReviewed' : 'complicationsReviewed'] = false;
    } else if (TEXT_LISTS.has(path)) {
      if (path === 'notes') out.notes = addText(path, out.notes, value);
      else out.medical.otherConditions = addText(path, out.medical.otherConditions, value);
    } else if (byHand.has(path)) continue;
    else if (path === 'medical.conditionsReviewed' || path === 'obstetric.complicationsReviewed') {
      if (!(out[a][b === 'conditionsReviewed' ? 'conditions' : 'pastComplications'] ?? []).length) out[a][b] = true;
    } else if (b) out[a][b] = value;
    else out[a] = value;
  }
  return out;
}

/**
 * Takes out what an earlier reading of the text filled that a new reading no longer gives (e.g. after Undo on a
 * correction): `fields` as dictatedFields lists them – ticks come off, other fields go back to their value before
 * (`before`, by field; empty when not given) – and `pieces` of other conditions and notes, as dictatedPieces lists them.
 * The caller leaves out anything changed by hand or answered since.
 */
export function withoutDictated(v, fields, before = {}, pieces = []) {
  if (!fields.length && !pieces.length) return v;
  const out = { ...v, newborn: { ...v.newborn }, pregnancy: { ...v.pregnancy }, abortion: { ...v.abortion }, obstetric: { ...v.obstetric }, medical: { ...v.medical } };
  for (const field of fields) {
    const list = [...TICK_LISTS].find((l) => field.startsWith(`${l}.`));
    if (list) {
      const [a, b] = list.split('.');
      out[a][b] = (out[a][b] ?? []).filter((key) => key !== field.slice(list.length + 1));
    } else if (!TEXT_LISTS.has(field) && field !== 'motherName') {
      const [a, b] = field.split('.');
      const was = before[field] ?? (/Reviewed$/.test(field) ? false : '');
      if (b) out[a][b] = was;
      else out[a] = was;
    }
  }
  for (const piece of pieces) {
    const cut = piece.indexOf('|');
    const path = piece.slice(0, cut);
    const gone = piece.slice(cut + 1);
    const text = path === 'notes' ? out.notes : out.medical.otherConditions;
    const left = String(text ?? '')
      .split(/;\s*/)
      .filter((t) => t && t.toLowerCase() !== gone)
      .join('; ');
    if (path === 'notes') out.notes = left;
    else out.medical.otherConditions = left;
  }
  return out;
}

/** The pieces of other conditions and notes in dictated values, for mergeDictated's `added`. */
export function dictatedPieces(values, paths) {
  return paths.filter((p) => TEXT_LISTS.has(p)).flatMap((path) => textPieces(path, path === 'notes' ? values.notes : values.medical?.otherConditions));
}

/**
 * The form fields to mark "From voice" – for ticked lists, each ticked item ("medical.conditions.asthma"). Fields
 * mergeDictated leaves alone (`skip`, `unticked`) are not marked; other conditions and notes changed by hand only when
 * voice adds a new piece to them (`added` as for mergeDictated; `current`: the form's values).
 */
export function dictatedFields(values, paths, { skip = [], unticked = [], added = [], current } = {}) {
  const byHand = new Set(skip);
  const untickedSet = new Set(unticked);
  const text = (x, path) => (path === 'notes' ? x.notes : x.medical?.otherConditions);
  return paths.flatMap((path) => {
    if (TICK_LISTS.has(path)) {
      const [a, b] = path.split('.');
      return values[a][b].map((key) => `${path}.${key}`).filter((p) => !untickedSet.has(p));
    }
    if (path === 'motherName') return [];
    if (!byHand.has(path)) return [path];
    const grows = TEXT_LISTS.has(path) && current && text(mergeDictated(current, values, [path], { added }), path) !== text(current, path);
    return grows ? [path] : [];
  });
}

// ---------- Filling the form again without undoing the person's own work (plan 1.7) ----------

// A form value by its path ("ageYears", "medical.bloodGroup")
const valueAt = (v, path) => {
  const [a, b] = path.split('.');
  return b ? v?.[a]?.[b] : v?.[a];
};

/**
 * What one form remembers between fills from voice – for that form only; nothing is saved. `dictated`: details
 * carried over from the previous page ({ values, paths }).
 */
export function newFillMemory(dictated) {
  return {
    handEdited: new Set(), // fields changed by hand: never overwritten by voice
    unticked: new Set(), // ticks taken off by hand ("medical.conditions.asthma"): never ticked again by voice
    voiceTextAdded: new Set(dictated ? dictatedPieces(dictated.values, dictated.paths) : []), // other conditions / notes pieces
    answeredFields: new Set(), // fields filled by answers to questions
    // What the last reading filled, the values before it, and whether each tick or piece was already in the form when a
    // reading first gave it
    lastReading: { fields: [], pieces: [], before: {}, present: {} },
    // Page 1: the clinical details for the next page – the latest reading plus the answers to questions about them
    // (`laterAnswers`, kept when the text is read again)
    later: null,
    laterAnswers: null,
  };
}

/** Fields changed by hand: voice never changes them again (until an answer to a question does). */
export function noteHandEdit(memory, paths) {
  for (const p of paths) {
    memory.handEdited.add(p);
    memory.answeredFields.delete(p);
  }
}

/** A tick put on or taken off by hand ("medical.conditions.asthma"): one taken off is never ticked again by voice. */
export function noteTick(memory, path, wasTicked) {
  if (wasTicked) memory.unticked.add(path);
  else memory.unticked.delete(path);
}

/**
 * One fill of the form from voice (plan 1.7). `reading`: the whole text was read (again) – fields changed by hand,
 * ticks taken off and notes already added are left alone, and what the last reading filled but this one no longer
 * gives (e.g. a correction undone) is taken out, unless it was in the form before a reading gave it (said on the
 * previous page, answered, or saved). Otherwise `result` is an answer to a question: the person chose it, so it is used
 * even over a change by hand. `usable`: the paths this page fills; `v`: the form's values now; `fromVoice`: the fields
 * marked "From voice". Updates `memory`. Returns { keep, values(cur), marks(cur) } – the form's next values and
 * "From voice" fields, from the current ones.
 */
export function planFill(memory, result, { reading, usable, v, fromVoice }) {
  const keep = reading ? { skip: [...memory.handEdited], unticked: [...memory.unticked], added: [...memory.voiceTextAdded] } : {};
  const fields = dictatedFields(result.values, usable, { ...keep, current: v });
  const pieces = dictatedPieces(result.values, usable);
  let stale = [];
  let stalePieces = [];
  let before = {};
  if (reading) {
    const last = memory.lastReading;
    const stillVoice = (f) => fromVoice.has(f) && !memory.handEdited.has(f) && !memory.answeredFields.has(f);
    // Ticks and pieces already in the form when a reading first gave them (e.g. said on page 1) never come off
    const present = { ...last.present };
    const inForm = new Set([...dictatedFields(v, [...TICK_LISTS]), ...dictatedPieces(v, [...TEXT_LISTS])]);
    for (const x of [...fields, ...pieces]) if (!(x in present)) present[x] = inForm.has(x);
    stalePieces = last.pieces.filter((p) => !pieces.includes(p) && !present[p] && stillVoice(p.slice(0, p.indexOf('|'))));
    stalePieces.forEach((p) => memory.voiceTextAdded.delete(p));
    // Other conditions and notes keep their mark while text added by voice is still in them
    const left = withoutDictated(v, [], {}, stalePieces);
    const voiceTextLeft = (path) => dictatedPieces(left, [path]).some((p) => memory.voiceTextAdded.has(p));
    stale = last.fields.filter((f) => !fields.includes(f) && !present[f] && stillVoice(f) && !(TEXT_LISTS.has(f) && voiceTextLeft(f)));
    before = { ...last.before };
    for (const f of fields) if (!(f in before) && f.split('.').length < 3) before[f] = valueAt(v, f); // (a tick just comes off)
    memory.lastReading = { fields, pieces, before, present };
  } else {
    for (const f of fields) {
      memory.answeredFields.add(f);
      memory.handEdited.delete(f);
      memory.unticked.delete(f);
    }
  }
  pieces.forEach((p) => memory.voiceTextAdded.add(p));
  return {
    keep,
    values: (cur) => mergeDictated(withoutDictated(cur, stale, before, stalePieces), result.values, usable, keep),
    marks: (cur) => new Set([...[...cur].filter((f) => !stale.includes(f)), ...fields]),
  };
}

/**
 * Page 1: the clinical details kept for the next page, after a fill (`waiting`: what it gives for that page). A new
 * reading replaces what the last one gave; answers to questions are kept.
 */
export function keepForLater(memory, waiting, reading) {
  if (reading) memory.later = combineDictated(waiting, memory.laterAnswers);
  else {
    memory.laterAnswers = combineDictated(memory.laterAnswers, waiting);
    memory.later = combineDictated(memory.later, waiting);
  }
  return memory.later;
}

/**
 * What a reading's found list (extractPatientDetails) really put into the form: { filled, notChanged }. `keep` is what
 * the fill left alone (planFill: fields changed by hand, ticks taken off, pieces added before) and `current` the form's
 * values before it. A value the person changed by hand is "not changed" when what was said differs (the form keeps
 * theirs), and left out when it is the same.
 */
export function splitFound(found, values, { skip = [], unticked = [], added = [] } = {}, current = {}) {
  const byHand = new Set(skip);
  const untickedSet = new Set(unticked);
  const addedSet = new Set(added);
  const same = (path) => String(valueAt(values, path) ?? '') === String(valueAt(current, path) ?? '');
  const filled = [];
  const notChanged = [];
  const split = (item, parts, left, join) => {
    const used = parts.filter((x) => !left(x));
    const kept = parts.filter(left);
    if (used.length) filled.push({ ...item, text: join(used) });
    if (kept.length) notChanged.push({ ...item, text: join(kept) });
  };
  const list = (sep) => (xs) => xs.map((x) => x.text).join(sep);
  // "G2 P1 L1 A0, 1 previous caesarean"
  const history = (xs) => xs.map((x, i) => (i ? (x.path === 'obstetric.previousCaesareans' ? ', ' : ' ') : '') + x.text).join('');
  for (const item of found) {
    if (item.ticks) split(item, item.ticks, (t) => untickedSet.has(t.key), list(', '));
    else if (item.pieces?.[0]?.key) {
      // a piece added before and since taken out of the text by hand
      const text = (path) => String(valueAt(current, path) ?? '').toLowerCase();
      const gone = (x) => {
        const cut = x.key.indexOf('|');
        return addedSet.has(x.key) && !text(x.key.slice(0, cut)).includes(x.key.slice(cut + 1));
      };
      split(item, item.pieces, gone, list('; '));
    } else if (item.pieces) {
      split(item, item.pieces.filter((x) => !byHand.has(x.path) || !same(x.path)), (x) => byHand.has(x.path), history);
    } else if (item.path && byHand.has(item.path)) {
      if (!same(item.path)) notChanged.push(item);
    } else filled.push(item);
  }
  return { filled, notChanged };
}

/** A question's key: a question already answered is not asked again when the text is read again (plan 1.7). */
export const questionKey = (q) => `${q.key ?? q.heard}|${q.prompt}`;

export const QUESTIONS_SHOWN = 5;
/**
 * The questions to show (already in order: results card, safety checks, the rest – plan 1.7): at most 5 unless `all`
 * ("More questions (N)" pressed). Returns { shown, more } – more: how many are not shown yet.
 */
export function questionsToShow(questions, all = false) {
  const shown = all ? questions : questions.slice(0, QUESTIONS_SHOWN);
  return { shown, more: questions.length - shown.length };
}

/** Two sets of dictated details together (e.g. what was said, plus the answers to its questions). */
export function combineDictated(a, b) {
  if (!a) return b;
  if (!b) return a;
  const values = mergeDictated(
    { newborn: {}, pregnancy: {}, obstetric: {}, medical: {}, ...a.values, notes: a.values.notes ?? '' },
    b.values,
    b.paths,
  );
  if (!a.values.notes && !values.notes) delete values.notes;
  const seen = new Set(a.found.map((x) => `${x.label}|${x.text}`));
  return { values, paths: [...new Set([...a.paths, ...b.paths])], found: [...a.found, ...b.found.filter((x) => !seen.has(`${x.label}|${x.text}`))] };
}

/** The built-in words, grouped by meaning (for "My settings → Voice words"). */
export function builtInWords() {
  const groups = new Map();
  for (const t of TERMS) groups.set(t.to, [...(groups.get(t.to) ?? []), ...t.says]);
  return [...groups].map(([to, says]) => ({ to, label: meaningLabel(to), says }));
}
