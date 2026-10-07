// The medicine safety check of a prescription (Perinexa's client/src/pages/medsafety/medSafety.js, run here on the
// server so a warning can never be skipped by the website). It uses the hospital's medicine safety list only once a
// doctor has APPROVED it (Clinic library). Decision support: it warns, it never blocks – going ahead despite an Avoid
// or Allergy warning needs a one-line reason, kept with the visit (never printed). PURE – no database.
import { timesPerDay } from './rxCodes.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Does the name appear in what was typed, at the start of a word? Short names (under 5 letters) and names of several
// words must also end there ("iron" does not match "ironic").
export function termMatches(text, term) {
  const t = String(term ?? '').trim().toLowerCase();
  if (!t || !text) return false;
  const whole = t.length < 5 || /\s/.test(t);
  return new RegExp(`(^|[^a-z0-9])${escape(t)}${whole ? '($|[^a-z0-9])' : ''}`, 'i').test(text);
}
const anyTerm = (text, terms) => (terms ?? []).some((t) => termMatches(text, t));

// Medicine groups for allergies written as a group ("allergic to penicillin").
const ALLERGY_GROUPS = [
  { name: 'penicillin', words: ['penicillin', 'penicillins', 'pcn'], members: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'piperacillin', 'amoxiclav', 'augmentin', 'mox', 'novamox', 'clavam', 'benzathine'] },
  { name: 'cephalosporin', words: ['cephalosporin', 'cephalosporins'], members: ['cefixime', 'ceftriaxone', 'cefuroxime', 'cephalexin', 'cefalexin', 'cefpodoxime', 'cefadroxil', 'cefotaxime', 'cefoperazone', 'taxim', 'monocef', 'zifi'] },
  { name: 'sulfa', words: ['sulfa', 'sulpha', 'sulfonamide', 'sulphonamide'], members: ['sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septran', 'bactrim', 'sulfasalazine'] },
  { name: 'NSAID', words: ['nsaid', 'nsaids'], members: ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aceclofenac', 'ketorolac', 'nimesulide', 'indomethacin', 'piroxicam', 'etoricoxib', 'aspirin', 'brufen', 'combiflam', 'meftal', 'voveran', 'ecosprin'] },
  { name: 'quinolone', words: ['quinolone', 'quinolones', 'fluoroquinolone'], members: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin', 'ciplox', 'oflox', 'norflox'] },
  { name: 'macrolide', words: ['macrolide', 'macrolides'], members: ['azithromycin', 'erythromycin', 'clarithromycin', 'azee', 'azithral'] },
  { name: 'metronidazole', words: ['metronidazole', 'flagyl'], members: ['metronidazole', 'flagyl', 'metrogyl', 'tinidazole', 'ornidazole'] },
];
const NOT_NAMES = new Set(['allergy', 'allergic', 'allergies', 'none', 'known', 'reaction', 'rash', 'to', 'and', 'with', 'drug', 'drugs', 'food', 'history', 'mild', 'severe', 'itching', 'swelling', 'tablet', 'tablets', 'injection', 'syrup', 'nkda', 'nil']);

function allergyNames(allergies) {
  const text = String(allergies ?? '').toLowerCase().trim();
  if (!text || /^(none|nil|no|nkda|no known)/.test(text)) return { groups: [], words: [] };
  const groups = ALLERGY_GROUPS.filter((g) => g.words.some((w) => termMatches(text, w)) || g.members.some((m) => termMatches(text, m)));
  const words = [...new Set(text.split(/[^a-z0-9-]+/).filter((w) => w.length >= 4 && !NOT_NAMES.has(w)))];
  return { groups, words };
}

const inWeeks = (e, weeks) => (e.fromWeek == null || (weeks != null && weeks >= e.fromWeek)) && (e.toWeek == null || (weeks != null && weeks <= e.toWeek));
const UNIT_MG = { mg: 1, mcg: 0.001, g: 1000 };

// The amount in one dose, in the entry's unit: "500 mg" × "2" tablets → 1000 (mg). null when it cannot be told.
function doseAmount(item, unit) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/i.exec(item.strength ?? '');
  if (!m) return null;
  const from = m[2].toLowerCase();
  const count = item.dose ? Number(String(item.dose).replace('½', '0.5').replace(/[^\d.]/g, '')) || null : 1;
  if (count == null) return null;
  const amount = Number(m[1]) * count;
  if (from === unit.toLowerCase()) return amount;
  if (UNIT_MG[from] && UNIT_MG[unit]) return (amount * UNIT_MG[from]) / UNIT_MG[unit];
  return null;
}

/**
 * The warnings for the medicines being written: [{ key, level: 'allergy'|'avoid'|'caution'|'dose', title,
 * medicines, message, unsureWeeks }] – allergies first, then Avoid, Caution and the doses.
 * list: the approved medicine safety entries in use; weeks: weeks of pregnancy at the visit (null if not known);
 * pregnant: antenatal care; breastfeeding: postnatal care; babyAgeDays: newborn care (null if not known).
 */
export function medicineWarnings({ items, list = [], weeks = null, pregnant = false, breastfeeding = false, newborn = false, babyAgeDays = null, allergies = '' }) {
  const drugs = items.map((r) => String(r.drug ?? '').trim()).filter(Boolean);
  const out = [];
  if (!drugs.length) return out;

  const a = allergyNames(allergies);
  for (const drug of drugs) {
    const group = a.groups.find((g) => g.members.some((m) => termMatches(drug, m)));
    const word = a.words.find((w) => termMatches(drug, w));
    if (group || word) {
      out.push({
        key: `allergy:${drug.toLowerCase()}`,
        level: 'allergy',
        title: `Allergy recorded: “${String(allergies).trim()}”`,
        medicines: [drug],
        message: group ? `${drug} belongs to the ${group.name} group. Check before prescribing.` : `${drug} may be the medicine in the allergy note. Check before prescribing.`,
      });
    }
  }

  for (const e of list) {
    if (e.active === false) continue;
    if (pregnant && e.kind === 'combination') {
      const first = drugs.filter((d) => anyTerm(d, e.terms));
      const second = drugs.filter((d) => anyTerm(d, e.otherTerms) && !first.includes(d));
      if (first.length && second.length) out.push({ key: e.key, level: e.level, title: e.label, medicines: [...first, ...second], message: e.message });
    } else if (pregnant && e.kind === 'medicine') {
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      const windowed = e.fromWeek != null || e.toWeek != null;
      if (matched.length && (weeks == null || inWeeks(e, weeks))) out.push({ key: e.key, level: e.level, title: e.label, medicines: matched, message: e.message, unsureWeeks: weeks == null && windowed });
    } else if (breastfeeding && e.kind === 'breastfeeding') {
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      if (matched.length) out.push({ key: e.key, level: e.level, title: `${e.label} – if she is breastfeeding`, medicines: matched, message: e.message });
    } else if (newborn && e.kind === 'newborn' && (e.maxAgeDays == null || babyAgeDays == null || babyAgeDays <= e.maxAgeDays)) {
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      if (matched.length) out.push({ key: e.key, level: e.level, title: e.label, medicines: matched, message: e.message });
    } else if (e.kind === 'dose' && !e.perKg) {
      // adult maximum doses; per-kg (baby) doses need a weight and are left to the doctor here
      for (const item of items) {
        if (!anyTerm(item.drug, e.terms)) continue;
        const single = doseAmount(item, e.doseUnit);
        if (single == null) continue;
        const times = timesPerDay(item.frequency);
        const daily = times == null ? null : single * times;
        const over = [e.maxSingle != null && single > e.maxSingle && `${single} ${e.doseUnit} in one dose (usual most ${e.maxSingle})`, e.maxDaily != null && daily != null && daily > e.maxDaily && `${daily} ${e.doseUnit} a day (usual most ${e.maxDaily})`].filter(Boolean);
        if (over.length) out.push({ key: `${e.key}:${item.drug.toLowerCase()}`, level: 'dose', title: `${e.label}: dose`, medicines: [item.drug], message: `${over.join('; ')}. ${e.message ?? ''}`.trim() });
      }
    }
  }
  const order = { allergy: 0, avoid: 1, caution: 2, dose: 3 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

export const needsReason = (w) => w.level === 'avoid' || w.level === 'allergy';
