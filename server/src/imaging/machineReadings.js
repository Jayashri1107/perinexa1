import { mentionsFetalSex } from '../utils/pcpndt.js';

// Readings from the ultrasound machine (docs/USG_MACHINE_PLAN.md step 3) – PURE.
// The machine's DICOM structured report (SR), as the scan bridge sends it (Orthanc's "simplified" JSON of the SR's
// ContentSequence), turned into readings for the scan templates' fields (imaging/templates.js), and the average table.
// DRAFT: the codes and words below are for the owner and the developer to check against the hospital's machine (its
// DICOM conformance statement and a sample export with a dummy patient). A measurement not recognised is kept as "not
// matched" – never guessed. The website has the same average rule (client/src/pages/imaging/machineTable.js).
// PC-PNDT: only numeric measurements are read; an item that mentions the sex of a fetus is dropped and only counted.

// Each template field the machine can fill: LOINC codes (the standard OB-GYN SR, DICOM TID 5000), and the words of the
// measurement's name for machines that send their own codes. Units are the templates' units.
export const MACHINE_FIELDS = [
  { key: 'crl', name: 'CRL', unit: 'mm', codes: ['11957-8'], words: /^(crl\b|crown[\s-]*rump)/i },
  { key: 'msd', name: 'Mean sac diameter', unit: 'mm', codes: ['11850-5'], words: /^(msd\b|mean sac|gestational sac|gs\b)/i },
  { key: 'bpd', name: 'BPD', unit: 'mm', codes: ['11820-8'], words: /^(bpd\b|biparietal)/i },
  { key: 'hc', name: 'HC', unit: 'mm', codes: ['11984-2'], words: /^(hc\b|head circ)/i },
  { key: 'ac', name: 'AC', unit: 'mm', codes: ['11979-2'], words: /^(ac\b|abdominal circ)/i },
  { key: 'fl', name: 'FL', unit: 'mm', codes: ['11963-6'], words: /^(fl\b|femur)/i },
  { key: 'nt', name: 'NT', unit: 'mm', codes: ['12146-5'], words: /^(nt\b|nuchal transl)/i },
  { key: 'fhr', name: 'Fetal heart rate', unit: 'bpm', codes: ['11948-7'], words: /^(fhr\b|fetal heart rate|heart rate)/i },
  { key: 'efw', name: 'Estimated fetal weight', unit: 'g', codes: ['11727-5'], words: /^(efw\b|estimated (fetal )?weight)/i },
  { key: 'afi', name: 'AFI', unit: 'cm', codes: ['11627-7'], words: /^(afi\b|amniotic fluid index)/i },
  { key: 'dvp', name: 'Deepest vertical pocket', unit: 'cm', codes: [], words: /^(dvp\b|sdp\b|single deepest|deepest (vertical )?pocket|max(imum)? vertical pocket)/i },
  { key: 'cervix', name: 'Cervical length', unit: 'mm', codes: ['11961-0'], words: /^cervi(x|cal)\b/i },
  { key: 'endometrium', name: 'Endometrial thickness', unit: 'mm', codes: ['12145-7'], words: /^endometri/i },
];
const byCode = new Map(MACHINE_FIELDS.flatMap((f) => f.codes.map((c) => [c, f])));
export const machineFieldByKey = new Map(MACHINE_FIELDS.map((f) => [f.key, f]));
// Not a measurement itself: a ratio, an age or a centile worked out from one (matched by words only)
const NOT_A_MEASUREMENT = /\/|ratio|gestational age|\bga\b|centile|percentile|z-?score|\bsd\b/i;

const FETUS_ID = '11951-1';
const DERIVATION = '121401';
export const MAX_UNMATCHED = 100;

const first = (seq) => (Array.isArray(seq) ? seq[0] : seq) ?? null;
const conceptOf = (item) => first(item?.ConceptNameCodeSequence) ?? {};
const textOf = (item) => String(item?.TextValue ?? first(item?.ConceptCodeSequence)?.CodeMeaning ?? '');

/** The template field a measurement fills, from its code or (for the machine's own codes) the words of its name. */
export function fieldFor(code, meaning) {
  const f = byCode.get(String(code ?? '').trim());
  if (f) return f;
  const m = String(meaning ?? '').trim();
  if (!m || NOT_A_MEASUREMENT.test(m)) return null;
  return MACHINE_FIELDS.find((x) => x.words.test(m)) ?? null;
}

const LENGTH_MM = { mm: 1, cm: 10, m: 1000 };
const WEIGHT_G = { g: 1, kg: 1000 };
const PER_MINUTE = new Set(['/min', '1/min', 'bpm', '{h.b.}/min', '{beats}/min', '{heartbeat}/min', '{beat}/min']);
/** A value in the machine's unit (UCUM) in the template's unit; null when it cannot be (an unknown unit). */
export function inUnit(value, from, to) {
  const u = String(from ?? '').trim().toLowerCase();
  if (to === 'mm' || to === 'cm') return LENGTH_MM[u] ? (value * LENGTH_MM[u]) / LENGTH_MM[to] : null;
  if (to === 'g') return WEIGHT_G[u] ? value * WEIGHT_G[u] : null;
  if (to === 'bpm') return PER_MINUTE.has(u) ? value : null;
  return null;
}
const decimalsOf = (unit) => (unit === 'g' || unit === 'bpm' ? 0 : 1);
const roundFor = (value, unit) => {
  const f = 10 ** decimalsOf(unit);
  return Math.round(value * f) / f;
};

// "Mean", "Last", "Maximum" …: the machine's own value worked out from the single readings
function derivationOf(item) {
  const mod = (item.ContentSequence ?? []).find((c) => conceptOf(c).CodeValue === DERIVATION);
  return mod ? textOf(mod).trim().toLowerCase().slice(0, 30) || 'derived' : null;
}

/**
 * The readings in one structured report. content: the SR's ContentSequence (Orthanc's simplified JSON); srUid: its
 * SOP instance UID. → { readings: [{ key, fetus, value, derived, srUid }], unmatched: [{ code, meaning, value, unit,
 * fetus, srUid }], dropped } – dropped: items about the sex of a fetus (counted, never kept).
 */
export function readingsFromSr(content, srUid = '') {
  const readings = [];
  const unmatched = [];
  let dropped = 0;
  const walk = (items, fetus) => {
    if (!Array.isArray(items)) return;
    // A container for one fetus (twins: A, B) names it among its own items
    const named = items.find((i) => conceptOf(i).CodeValue === FETUS_ID && textOf(i).trim());
    const here = named ? textOf(named).trim().slice(0, 10) : fetus;
    for (const item of items) {
      const c = conceptOf(item);
      const meaning = String(c.CodeMeaning ?? '').trim().slice(0, 120);
      if (mentionsFetalSex(meaning) || mentionsFetalSex(textOf(item))) {
        dropped += 1;
        continue;
      }
      if (item.ValueType === 'NUM') {
        const measured = first(item.MeasuredValueSequence);
        const value = Number.parseFloat(String(measured?.NumericValue ?? '').split('\\')[0]);
        if (!Number.isFinite(value)) continue;
        const unit = String(first(measured?.MeasurementUnitsCodeSequence)?.CodeValue ?? '').trim().slice(0, 30);
        const field = fieldFor(c.CodeValue, meaning);
        const converted = field ? inUnit(value, unit, field.unit) : null;
        if (converted != null && converted > 0) readings.push({ key: field.key, fetus: here, value: roundFor(converted, field.unit), derived: derivationOf(item), srUid });
        else if (unmatched.length < MAX_UNMATCHED) unmatched.push({ code: String(c.CodeValue ?? '').slice(0, 30), meaning, value, unit, fetus: here, srUid });
      } else if (item.ContentSequence) walk(item.ContentSequence, here);
    }
  };
  walk(content, 'A');
  return { readings, unmatched, dropped };
}

export const fetusesOf = (readings) => [...new Set(readings.map((r) => r.fetus))].sort();

/**
 * One fetus's readings as the rows of the average table, in the order of MACHINE_FIELDS: each field's single readings
 * (in the order taken) and the machine's own value (its mean when it sends one).
 */
export function tableOf(readings, fetus) {
  const rows = new Map();
  for (const r of readings) {
    if (r.fetus !== fetus) continue;
    const f = machineFieldByKey.get(r.key);
    if (!f) continue;
    const row = rows.get(r.key) ?? { key: r.key, name: f.name, unit: f.unit, readings: [], machine: null };
    if (!r.derived) row.readings.push(r.value);
    else if (!row.machine || r.derived === 'mean') row.machine = { value: r.value, derived: r.derived };
    rows.set(r.key, row);
  }
  return MACHINE_FIELDS.filter((f) => rows.has(f.key)).map((f) => rows.get(f.key));
}

// DRAFT – the owner's decision (docs/USG_MACHINE_PLAN.md question 6): what is used when a measurement is taken more
// than once. average: of the ticked readings; last: the last ticked one; machine: the machine's own value; reading:
// one chosen reading.
export const USE_RULES = ['average', 'last', 'machine', 'reading'];
export const DEFAULT_USE = 'average';

/** The value a row puts in the report; null when nothing is left to use (every reading unticked). */
export function usedValue(row, { ticked = [], use = DEFAULT_USE, reading = 0 } = {}) {
  if (use === 'machine') return row.machine?.value ?? null;
  if (use === 'reading') return row.readings[reading] ?? null;
  if (!row.readings.length) return row.machine?.value ?? null;
  const on = row.readings.filter((_, i) => ticked[i] !== false);
  if (!on.length) return null;
  const v = use === 'last' ? on.at(-1) : on.reduce((a, b) => a + b, 0) / on.length;
  return roundFor(v, row.unit);
}

/** Does the name typed on the machine ("SHARMA^ASHA") share a word with her name in Perinexa? */
export function sameName(machineName, fullName) {
  const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2));
  const theirs = words(fullName);
  return [...words(machineName)].some((w) => theirs.has(w));
}
