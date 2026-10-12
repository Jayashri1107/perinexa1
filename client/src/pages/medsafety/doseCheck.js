// The dose check without AI: works out the dose of a prescription line from what was typed (strength × dose × how
// often) and compares it with the usual maximum in the hospital's medicine safety list. PURE.
// It is deliberately limited: where the typed values do not give one clear amount – a combined medicine, a strength
// without a unit, a dose in words, drops, puffs, creams, an injection with no dose written – it works nothing out and
// the check stays silent. It only ever adds a caution; the doctor decides.

export const DOSE_UNITS = ['mg', 'mcg', 'g', 'IU'];

// Mass units in mg; IU only compares with IU.
const MASS = { mcg: 0.001, mg: 1, g: 1000 };
const UNIT_WORDS = {
  mcg: 'mcg', 'µg': 'mcg', 'μg': 'mcg', ug: 'mcg', microgram: 'mcg', micrograms: 'mcg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  g: 'g', gm: 'g', gram: 'g', grams: 'g',
  iu: 'IU', 'i.u.': 'IU', unit: 'IU', units: 'IU',
};
const UNIT_PATTERN = 'micrograms?|milligrams?|grams?|mcg|µg|μg|ug|mg|gm|g|i\\.u\\.|iu|units?';
const NUMBER = '\\d[\\d,]*(?:\\.\\d+)?';

/** "60,000" → 60000 (commas are thousands separators); null when it is not a plain number. */
function toNumber(text) {
  const n = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** An amount in another unit (mg ↔ mcg ↔ g; IU only to IU), or null when the units cannot be compared. */
export function convert(value, from, to) {
  if (from === to) return value;
  if (from in MASS && to in MASS) return (value * MASS[from]) / MASS[to];
  return null;
}

/**
 * A strength as one clear amount: "500 mg" → { value: 500, unit: 'mg', perMl: null }; "250 mg/5 ml" → perMl 5;
 * "100 mg/ml" → perMl 1. null for anything else: no unit ("500"), a combined medicine ("500 mg + 125 mg"), a volume
 * ("10 ml"), a percentage.
 */
export function parseStrength(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  const m = new RegExp(`^(${NUMBER})\\s*(${UNIT_PATTERN})\\s*(?:(?:/|per)\\s*(${NUMBER})?\\s*ml)?$`).exec(t);
  if (!m) return null;
  const value = toNumber(m[1]);
  const perMl = m[0].endsWith('ml') ? (m[3] ? toNumber(m[3]) : 1) : null;
  if (value == null || value <= 0 || (perMl != null && !(perMl > 0))) return null;
  return { value, unit: UNIT_WORDS[m[2]], perMl };
}

/** A strength written in the medicine's name ("Paracetamol 650 mg"), only when it has a unit and there is just one. */
export function strengthInName(drug) {
  const t = String(drug ?? '').toLowerCase();
  const found = [...t.matchAll(new RegExp(`(${NUMBER})\\s*(${UNIT_PATTERN})(?![a-z])(?:\\s*(?:/|per)\\s*(${NUMBER})?\\s*ml(?![a-z]))?`, 'g'))]
    // not the end of a word or of a longer number ("b12 mg")
    .filter((m) => m.index === 0 || !/[a-z0-9.]/.test(t[m.index - 1]));
  return found.length === 1 ? parseStrength(found[0][0]) : null;
}

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
// What one of something is called after a number: "2 tab", "1 capsule", "1 amp".
const PIECES = 'tabs?|tablets?|caps?|capsules?|sachets?|pessary|pessaries|supp|suppository|suppositories|amps?|ampoules?|vials?';

/** "1", "½", "1½", "1/2", "1.5" → the number; null otherwise. */
function countOf(text) {
  const t = text.trim();
  let m = /^(\d+)?\s*([½¼¾⅓⅔])$/.exec(t);
  if (m) return Number(m[1] ?? 0) + FRACTIONS[m[2]];
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
  m = /^\d+(?:\.\d+)?$/.exec(t);
  return m ? Number(t) : null;
}

/**
 * A dose as typed: { kind: 'blank' } | { kind: 'count', value } ("1", "½", "2 tabs") | { kind: 'ml', value }
 * ("10 ml", "1 tsp" = 5 ml) | { kind: 'amount', value, unit } ("500 mg"). null when it is not one clear dose
 * ("1-2", "5 drops", "2 puffs", words).
 */
export function parseDose(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return { kind: 'blank' };
  let m = new RegExp(`^(${NUMBER})\\s*(${UNIT_PATTERN})$`).exec(t);
  if (m) {
    const value = toNumber(m[1]);
    return value > 0 ? { kind: 'amount', value, unit: UNIT_WORDS[m[2]] } : null;
  }
  m = /^(.+?)\s*(ml|tsp|teaspoons?|teaspoonfuls?)$/.exec(t);
  if (m) {
    const n = countOf(m[1]);
    return n > 0 ? { kind: 'ml', value: m[2] === 'ml' ? n : n * 5 } : null;
  }
  m = new RegExp(`^(.+?)\\s*(?:${PIECES})?\\.?$`).exec(t);
  const n = m ? countOf(m[1]) : null;
  return n > 0 ? { kind: 'count', value: n } : null;
}

/** A medicine with more than one ingredient: which strength belongs to which cannot be told, so it is not checked. */
export const isCombined = (row) =>
  /[+&]|\b(and|with)\b/i.test(row.drug ?? '') || /[+&]|\band\b/i.test(row.strength ?? '') || /\S\s*\/\s*[a-z]/i.test((row.drug ?? '').replace(/\/\s*[\d.]*\s*ml\b/gi, ''));

// Forms taken by the piece (a bare number is that many tablets, ampoules …) and liquids measured in ml.
const PIECE_FORMS = ['tab', 'cap', 'sachet', 'pessary', 'suppository', 'inj'];
// No dose written: one piece, as the prescription prints it. Not for an injection – the strength is what the vial or
// ampoule holds, and the dose given from it is often written elsewhere (never a whole vial for a baby).
const ONE_IF_BLANK = ['tab', 'cap', 'sachet', 'pessary', 'suppository'];
const ML_FORMS = ['syrup', 'suspension'];
const MAX_PIECES = 20;

/**
 * The amount of one dose of a prescription line, in `unit` – or null when it cannot be worked out.
 * row: { drug, form, strength, dose } as typed.
 */
export function singleDose(row, unit) {
  if (isCombined(row)) return null;
  const dose = parseDose(row.dose);
  if (!dose) return null;
  // The amount itself was typed as the dose ("500 mg")
  if (dose.kind === 'amount') return convert(dose.value, dose.unit, unit);
  const strength = parseStrength(row.strength) ?? ((row.strength ?? '').trim() ? null : strengthInName(row.drug));
  if (!strength) return null;
  let amount;
  if (strength.perMl != null) {
    // A liquid: so much in so many ml. The dose must be in ml (a bare number of a syrup or suspension is ml).
    const ml = dose.kind === 'ml' ? dose.value : dose.kind === 'count' && ML_FORMS.includes(row.form) ? dose.value : null;
    if (ml == null) return null;
    amount = (strength.value * ml) / strength.perMl;
  } else {
    // So much in each piece: a number of pieces (none written: one – but for an injection, not known).
    if (dose.kind === 'ml' || !PIECE_FORMS.includes(row.form)) return null;
    if (dose.kind === 'blank' && !ONE_IF_BLANK.includes(row.form)) return null;
    const pieces = dose.kind === 'blank' ? 1 : dose.value;
    if (pieces > MAX_PIECES) return null;
    amount = strength.value * pieces;
  }
  return convert(amount, strength.unit, unit);
}

// Doses in a day for each "how often" code (server/src/visits/rxCodes.js). Once now, once a week and every other
// day: one dose on the day it is taken. Only when needed, or in the doctor's own words: not known.
const PER_DAY = { '1-0-0': 1, '0-1-0': 1, '0-0-1': 1, '1-0-1': 2, '1-1-1': 3, '1-1-1-1': 4, stat: 1, weekly: 1, alternate: 1 };
/** Doses on a day it is taken, or null when "how often" does not say (SOS, the doctor's own words, not chosen). */
export const dosesPerDay = (frequency) => PER_DAY[frequency] ?? null;

const round = (n) => {
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3;
  return Number(n.toFixed(digits));
};

/** "4 g", "650 mg", "7.5 mg/kg": an amount in words (1000 mg and more as g, 1000 mcg and more as mg, when it is round). */
export function amountText(value, unit, perKg = false) {
  let v = round(value);
  let u = unit;
  if (!perKg && v >= 1000 && (u === 'mg' || u === 'mcg') && Number.isInteger(v / 100)) {
    v /= 1000;
    u = u === 'mg' ? 'g' : 'mg';
  }
  return `${v} ${u}${perKg ? '/kg' : ''}`;
}

const over = (value, max) => max != null && value > max * (1 + 1e-9);

/** Whether an entry is a dose limit the check can use. */
export const isDoseLimit = (e) => e.kind === 'dose' && DOSE_UNITS.includes(e.doseUnit);
// A per-kg limit can be for babies up to an age only (the lower doses of the first week of life). Age not known: it
// applies, and the warning says to check.
const fitsAge = (e, ageDays) => e.maxAgeDays == null || ageDays == null || ageDays <= e.maxAgeDays;
const ageRank = (e) => e.maxAgeDays ?? Infinity;

/**
 * The dose warnings for the medicines being written.
 *  rows: the prescription lines as typed; matches(drug, entry): whether a line is this entry's medicine;
 *  list: the hospital's entries; baby: the patient is in newborn care; weight: { kg, from: 'visit' | 'birth' } | null;
 *  ageDays: the baby's age on the day of the visit (null: not known).
 * Adults get the entries per dose and per day; babies only the per-kg entries, and only when a weight is recorded.
 * Where a medicine has several per-kg entries, a line is checked against the one with the lowest age that still fits
 * the baby (the first-week limit instead of the general one).
 * One warning for each medicine above its usual maximum: the largest single dose, and the day's total over all its
 * lines. Returns [{ key, level: 'dose', title, medicines, message, unsureAge? }].
 */
export function doseWarnings({ rows, list = [], matches, baby = false, weight = null, ageDays = null }) {
  const out = [];
  const forBaby = list.filter((e) => isDoseLimit(e) && e.perKg && fitsAge(e, ageDays));
  for (const e of list) {
    if (!isDoseLimit(e)) continue;
    if (e.perKg ? !(baby && weight?.kg > 0 && fitsAge(e, ageDays)) : baby) continue;
    const perKg = Boolean(e.perKg);
    const lines = [];
    for (const r of rows) {
      if (!(r.drug ?? '').trim() || !matches(r.drug, e)) continue;
      // Another entry of this medicine is for a younger age that still fits: that one checks this line.
      if (perKg && forBaby.some((x) => ageRank(x) < ageRank(e) && matches(r.drug, x))) continue;
      const one = singleDose(r, e.doseUnit);
      if (one == null || !(one > 0)) continue;
      lines.push({ drug: r.drug.trim(), one: perKg ? one / weight.kg : one, perDay: dosesPerDay(r.frequency) });
    }
    if (!lines.length) continue;
    const single = Math.max(...lines.map((l) => l.one));
    // A line whose "how often" is not known counts as one dose, so the day's total is then "at least".
    const daily = lines.reduce((sum, l) => sum + l.one * (l.perDay ?? 1), 0);
    const dayKnown = lines.every((l) => l.perDay != null);
    const overSingle = over(single, e.maxSingle);
    const overDaily = over(daily, e.maxDaily);
    if (!overSingle && !overDaily) continue;
    const text = (v) => amountText(v, e.doseUnit, perKg);
    const limits = [e.maxSingle != null && `${text(e.maxSingle)} a dose`, e.maxDaily != null && `${text(e.maxDaily)} a day`].filter(Boolean);
    const above = [overSingle && `${text(e.maxSingle)} a dose`, overDaily && `${text(e.maxDaily)} a day`].filter(Boolean).join(' and ');
    const written = [`${text(single)} a dose`, e.maxDaily != null && `${dayKnown ? '' : 'at least '}${text(daily)} a day`].filter(Boolean).join(', ');
    const weighed = perKg ? ` for a weight of ${round(weight.kg)} kg (${weight.from === 'birth' ? 'the birth weight – record today’s weight for a closer check' : 'recorded at this visit'})` : '';
    out.push({
      key: `dose:${e.key}`,
      level: 'dose',
      title: `${e.label}: above the usual maximum of ${above}`,
      medicines: [...new Set(lines.map((l) => l.drug))],
      message: [`As written: ${written}${weighed}.`, `Usual maximum: ${limits.join(', ')}.`, e.message].filter(Boolean).join(' '),
      // The limit is for babies up to an age, and this baby's age is not known
      ...(perKg && ageDays == null && e.maxAgeDays != null ? { unsureAge: true } : {}),
    });
  }
  return out;
}
