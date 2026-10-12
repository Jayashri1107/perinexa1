// Pharmacy stock while prescribing: does a medicine as a doctor typed it match a medicine on the pharmacy's stock list?
// PURE. Deliberately conservative – a wrong "In the pharmacy" is worse than saying nothing:
//  - the NAME must be the same words as the pharmacy's brand name or its generic name (form words such as "Tab." and
//    anything in brackets are ignored; "Paracetamol" never matches "Paracetamol + caffeine");
//  - the STRENGTH must agree: every amount the doctor wrote is found on the pharmacy's medicine ("500 mg" = "0.5 g";
//    a number in a brand name counts, "Dolo 650" = 650 mg), and a liquid's volume too ("250 mg/5 ml"). By generic name
//    the pharmacy's medicine must have no further ingredient ("Amoxicillin 500 mg" is not "500 mg + 125 mg"). A
//    strength in words ("DS", "forte") matches only the same words. No strength written: only a brand name matches,
//    or a generic that the pharmacy also lists without a strength;
//  - the FORM must be of the same kind (a tablet is never matched to a syrup or an injection).
// The answer is only one of three words (statusFor): never a quantity, price, batch or supplier. It is left out where
// the pharmacy's list cannot settle it: a brand kept in several strengths that do not all say the same (and no
// strength was written), and "not in stock" by generic name while another medicine of that form and strength has no
// generic name recorded (it may be the same medicine).

// The prescription's forms (visits/rxCodes.js) → the pharmacy's forms (pharmacyRules.js) that count as the same kind.
const FORM_KINDS = {
  tab: ['tablet', 'capsule'],
  cap: ['tablet', 'capsule'],
  syrup: ['syrup', 'suspension'],
  suspension: ['syrup', 'suspension'],
  drops: ['drops'],
  inj: ['injection', 'infusion'],
  sachet: ['sachet'],
  powder: ['sachet'],
  pessary: ['pessary'],
  suppository: ['suppository'],
  cream: ['cream', 'ointment', 'gel'],
  ointment: ['cream', 'ointment', 'gel'],
  gel: ['cream', 'ointment', 'gel'],
  lotion: [],
  spray: [],
  inhaler: ['inhaler'],
};
// Words that say what form a medicine is, or nothing at all: never part of its name.
const NOT_NAME = new Set([
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'inj', 'injection', 'injections', 'syp', 'syr', 'syrup', 'susp', 'suspension',
  'drop', 'drops', 'cream', 'oint', 'ointment', 'gel', 'lotion', 'sachet', 'sachets', 'powder', 'pessary', 'pessaries', 'supp', 'suppository', 'suppositories',
  'spray', 'inhaler', 'infusion', 'vial', 'amp', 'ampoule', 'ip', 'bp', 'usp', 'and', 'with', 'the', 'of',
]);
const UNITS = { mcg: ['mass', 0.001], 'µg': ['mass', 0.001], 'μg': ['mass', 0.001], ug: ['mass', 0.001], mg: ['mass', 1], g: ['mass', 1000], gm: ['mass', 1000], iu: ['iu', 1], ml: ['ml', 1], '%': ['pct', 1] };
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(mcg|µg|μg|ug|mg|gm|g|iu|ml|%)?(?![a-z0-9])/g;

// Lower case, without anything in brackets; "per ml" written without a number ("100 mg/ml") is per 1 ml.
const clean = (text) => String(text ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\/\s*ml/g, '/1 ml');
// A number that ends a word ("d3", "b12") is part of the name, not an amount.
const isAmount = (t, m) => !(m.index > 0 && /[a-z]/.test(t[m.index - 1]));

/** The words of a medicine's name, without form words, amounts and anything in brackets – sorted, as one string. */
export function nameKey(text) {
  const t = clean(text);
  const words = t
    .replace(AMOUNT, (...m) => (isAmount(t, { index: m.at(-2) }) ? ' ' : m[0]))
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => /^[a-z]/.test(w) && !NOT_NAME.has(w));
  return [...new Set(words)].sort().join(' ');
}

/** The amounts in a text ("500 mg + 125 mg", "100 mg/5 ml", "Dolo 650"): [{ value, kind, base }] (kind '' = no unit). */
export function amountsIn(text) {
  const out = [];
  const t = clean(text);
  for (const m of t.matchAll(AMOUNT)) {
    if (!isAmount(t, m)) continue;
    const value = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const [kind, factor] = UNITS[m[2]] ?? ['', 1];
    out.push({ value, kind, base: value * factor });
  }
  return out;
}

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
// The same amount: the same kind of unit and value (0.5 g = 500 mg); a bare number (from a brand name) by its figure.
const sameAmount = (a, b) => (a.kind && b.kind ? a.kind === b.kind && near(a.base, b.base) : near(a.value, b.value));

/** Every amount in `wanted` is found among `have` (each used once). */
function allFound(wanted, have) {
  const left = [...have];
  return wanted.every((w) => {
    const i = left.findIndex((h) => sameAmount(w, h));
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
}

function formsAgree(rxForm, medForm) {
  if (!rxForm || rxForm === 'other' || !medForm || medForm === 'other') return true;
  return (FORM_KINDS[rxForm] ?? []).includes(medForm);
}

// A pharmacy medicine as the matcher reads it.
function readMedicine(med) {
  const strength = String(med.strength ?? '').trim();
  return {
    med,
    brand: nameKey(med.name),
    generic: String(med.generic ?? '').trim() ? nameKey(med.generic) : '',
    amounts: strength ? amountsIn(strength) : amountsIn(med.name),
    strengthWords: asWritten(strength),
  };
}
// A strength as written, for one in words only ("DS", "forte"): lower case, single spaces.
const asWritten = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A prescription line { drug, strength, form } as the matcher reads it – worked out once for each line, however many
 * medicines the pharmacy keeps. name '' = nothing to look for.
 */
export function readLine(rx) {
  const typed = Boolean(String(rx.strength ?? '').trim());
  return { name: nameKey(rx.drug), form: rx.form, typed, asked: typed ? amountsIn(rx.strength) : amountsIn(rx.drug), strengthWords: asWritten(rx.strength) };
}

const count = (list, isVolume) => list.filter((a) => (a.kind === 'ml') === isVolume).length;

// Whether the strength of a line agrees with a pharmacy medicine found by its brand name or by its generic name.
function strengthAgrees(line, r, byBrand) {
  const { typed, asked } = line;
  const have = r.amounts;
  // A strength in words only ("DS", "forte"): it says which medicine is meant, so the pharmacy must say the same words.
  if (typed && !asked.length) return line.strengthWords === r.strengthWords;
  // No strength written: the brand itself was named (any strength of it), or the pharmacy lists none either.
  if (!asked.length) return byBrand || !have.length;
  // A liquid's strength is so much in so many ml: a typed strength must say the same volume ("250 mg" alone is not
  // "250 mg/5 ml" – it could as well be 250 mg/ml).
  if (typed && count(asked, true) !== count(have, true)) return false;
  // By generic name the pharmacy's medicine must be that medicine alone: one more amount is one more ingredient
  // (the pharmacist may have written only the main ingredient as the generic name).
  if (!byBrand && count(asked, false) !== count(have, false)) return false;
  return allFound(asked, have);
}
const agrees = (line, r, byBrand) => formsAgree(line.form, r.med.form) && strengthAgrees(line, r, byBrand);

/**
 * Whether a prescription line { drug, strength, form } is confidently this pharmacy medicine { name, generic, strength,
 * form }.
 */
export function matchesMedicine(rx, med) {
  const line = readLine(rx);
  if (!line.name) return false;
  const r = readMedicine(med);
  const byBrand = line.name === r.brand;
  if (!byBrand && line.name !== r.generic) return false;
  return agrees(line, r, byBrand);
}

const push = (map, key, value) => (map.get(key) ?? map.set(key, []).get(key)).push(value);

/**
 * The pharmacy's list, read once for the lines asked about (readLine): the medicines by brand name and by generic name,
 * and the medicines with no generic name recorded. Only a medicine with a word of an asked name in its own names is
 * read in full, so a long stock list costs little.
 */
export function stockIndex(medicines, lines) {
  const wanted = new Set(lines.map((l) => l.name).filter(Boolean));
  // The longest word of each asked name: every word of a name's key is written in the name itself.
  const probes = [...new Set([...wanted].map((n) => n.split(' ').reduce((a, b) => (b.length > a.length ? b : a))))];
  const byBrand = new Map();
  const byGeneric = new Map();
  const noGeneric = [];
  for (const med of medicines) {
    const name = String(med.name ?? '').toLowerCase();
    const generic = String(med.generic ?? '').trim().toLowerCase();
    if (!generic) noGeneric.push(med);
    if (!probes.some((w) => name.includes(w) || generic.includes(w))) continue;
    const r = readMedicine(med);
    if (wanted.has(r.brand)) push(byBrand, r.brand, r);
    if (r.generic && r.generic !== r.brand && wanted.has(r.generic)) push(byGeneric, r.generic, r);
  }
  return { byBrand, byGeneric, noGeneric };
}

const strengthKey = (r) => r.amounts.map((a) => `${a.kind}:${a.base}`).sort().join('+') || r.strengthWords;

/**
 * The pharmacy medicines a line (readLine) confidently matches, from the list as read by stockIndex:
 *  { medicines, groups, outIsSure } – groups: the matches by strength (one group when the line says a strength);
 *  outIsSure: false when the line matched by generic name and a medicine with no generic name recorded could be the
 *  same medicine (same kind of form, and a strength that agrees or none) – the list then cannot say "not in stock".
 */
export function matchLine(line, index) {
  if (!line.name) return { medicines: [], groups: [], outIsSure: true };
  const brand = (index.byBrand.get(line.name) ?? []).filter((r) => agrees(line, r, true));
  const generic = (index.byGeneric.get(line.name) ?? []).filter((r) => agrees(line, r, false));
  const found = [...brand, ...generic];
  let groups = found.length ? [found] : [];
  if (found.length > 1 && !line.asked.length) {
    const byStrength = new Map();
    for (const r of found) push(byStrength, strengthKey(r), r);
    groups = [...byStrength.values()];
  }
  let outIsSure = true;
  if (generic.length) {
    const matched = new Set(found.map((r) => r.med));
    outIsSure = !index.noGeneric.some((med) => {
      if (matched.has(med) || !formsAgree(line.form, med.form)) return false;
      const amounts = String(med.strength ?? '').trim() ? amountsIn(med.strength) : amountsIn(med.name);
      return !line.asked.length || !amounts.length || (count(line.asked, false) === count(amounts, false) && allFound(line.asked, amounts));
    });
  }
  return { medicines: found.map((r) => r.med), groups: groups.map((g) => g.map((r) => r.med)), outIsSure };
}

/** The pharmacy medicines a prescription line confidently matches (the whole list is read: for one line at a time). */
export function matchingMedicines(rx, medicines) {
  const line = readLine(rx);
  return matchLine(line, stockIndex(medicines, [line]));
}

// Medicines that are the same medicine in the same strength: in stock if any of them has more than its reorder level,
// low if one has some left, otherwise out.
function groupStatus(medicines, usable) {
  let best = 'out';
  for (const m of medicines) {
    const qty = usable.get(String(m._id)) ?? 0;
    if (qty > (m.reorderLevel ?? 0)) return 'in';
    if (qty > 0) best = 'low';
  }
  return best;
}

/**
 * 'in' | 'low' | 'out' for a line's matches (matchLine), from their usable stock (not expired) – or null: nothing
 * matched, the strengths of a brand written without a strength do not all say the same, or "out" cannot be relied on.
 * usable: Map "<medicineId>" → units.
 */
export function statusFor(match, usable) {
  if (!match.groups.length) return null;
  const answers = new Set(match.groups.map((g) => groupStatus(g, usable)));
  if (answers.size > 1) return null;
  const [answer] = answers;
  return answer === 'out' && !match.outIsSure ? null : answer;
}
