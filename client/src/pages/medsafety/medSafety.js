// Medicine safety check (Smart features, step 2): warnings while a prescription is written, from the
// hospital's medicine safety list (GET /medicine-safety) and the patient's recorded allergies. Pure.
// The list's entries apply by who the patient is: pregnancy entries to antenatal patients, breastfeeding entries to
// postnatal patients who are breastfeeding (or for whom it is not recorded), newborn entries to newborn-care
// patients, and the usual maximum doses to everyone (babies: per kg, with a recorded weight, by age – doseCheck.js).
// A warning never stops saving – the doctor decides.

import { allergyStatus } from '../patients/patientFormat.js';
import { gaOn } from '../patients/carePlanFormat.js';
import { doseWarnings, isDoseLimit } from './doseCheck.js';

/**
 * Whether the pregnancy warnings apply on a visit's date, and the weeks of pregnancy then (null when not known).
 * Only a continuing pregnancy gets them – antenatal care, weeks from the EDD in use. Abortion care never does (owner,
 * 3 Oct 2026): a threatened miscarriage stays under Antenatal, and in a pregnancy loss misoprostol or methotrexate is
 * the intended treatment. This includes an old record that still says threatened miscarriage.
 */
export function pregnancyOnVisit(patient, visitOn) {
  if (patient?.careType !== 'antenatal') return { pregnant: false, weeks: null };
  return { pregnant: true, weeks: gaOn(patient.pregnancy?.effectiveEdd, visitOn)?.weeks ?? null };
}

/**
 * Whether the breastfeeding warnings apply: 'yes' (recorded), 'unknown' (a postnatal patient for whom it is not
 * recorded – the warnings then say "if she is breastfeeding"), or null (recorded as not breastfeeding, or not a
 * postnatal patient).
 */
export function breastfeedingOnVisit(patient) {
  if (patient?.careType !== 'postnatal') return null;
  const answer = patient.postnatal?.breastfeeding ?? '';
  return answer === 'no' ? null : answer === 'yes' ? 'yes' : 'unknown';
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A newborn-care patient on a visit's date, or null for everyone else:
 *  ageDays: the age the entries are checked against (null when the birth date is not known);
 *  calendarDays: the age to show – the days from the date of birth to the date of the visit;
 *  weight: what the per-kg dose check uses – the weight recorded at this visit, else the birth weight.
 */
export function babyOnVisit(patient, visit) {
  if (patient?.careType !== 'newborn') return null;
  const birth = patient.newborn?.birthAt ? new Date(patient.newborn.birthAt) : null;
  const born = birth ? birth.getTime() : NaN;
  const on = visit?.visitOn ? new Date(visit.visitOn).getTime() : NaN;
  const known = Number.isFinite(born) && Number.isFinite(on);
  // For the checks: whole days from the birth to the start of the visit's day (a day, midnight UTC). Rounded down, so
  // an entry "up to 28 days" may still show a day longer – never a day less.
  const ageDays = known ? Math.max(0, Math.floor((on - born) / DAY_MS)) : null;
  // In words: from the date of birth (the day shown on this computer, as everywhere else) to the visit's date – a baby
  // born yesterday is 1 day old, as the patient's header says.
  const calendarDays = known ? Math.max(0, Math.round((on - Date.UTC(birth.getFullYear(), birth.getMonth(), birth.getDate())) / DAY_MS)) : null;
  const atVisit = Number(visit?.vitals?.weightKg);
  const atBirth = Number(patient.newborn?.birthWeightGrams) / 1000;
  const weight = atVisit > 0 ? { kg: atVisit, from: 'visit' } : atBirth > 0 ? { kg: atBirth, from: 'birth' } : null;
  return { ageDays, calendarDays, weight };
}

/** "born on the day of the visit", "1 day old", "9 days old", "4 months old" (from 2 months on). */
export function babyAgeText(days) {
  if (days < 1) return 'born on the day of the visit';
  if (days < 61) return `${days} ${days === 1 ? 'day' : 'days'} old`;
  return `${Math.floor(days / 30.44)} months old`;
}

/**
 * What the hospital's list cannot check for this patient because it has no entries of that kind, in words for "the
 * list has no … yet" (null: the list has them, or they are not for this patient):
 *  entries: the entries for who the patient is – pregnancy, breastfeeding, or a baby in newborn care;
 *  doses: the dose limits – per kg for a baby, otherwise for adults.
 * A list a doctor approved or changed does not get new kinds of built-in entries by itself, and a doctor may remove
 * entries: "no warnings" must then not read as "checked".
 */
export function notCovered(list, { pregnant = false, breastfeeding = null, baby = null } = {}) {
  const has = (test) => (list ?? []).some(test);
  const entries =
    pregnant && !has((e) => e.kind === 'medicine' || e.kind === 'combination')
      ? 'entries for pregnancy'
      : breastfeeding && !has((e) => e.kind === 'breastfeeding')
        ? 'entries for breastfeeding'
        : baby && !has((e) => e.kind === 'newborn')
          ? 'entries for newborn babies'
          : null;
  const doses = has((e) => isDoseLimit(e) && Boolean(e.perKg) === Boolean(baby)) ? null : baby ? 'dose limits for babies' : 'dose limits';
  return { entries, doses };
}

export const MED_SAFETY_STATUS = {
  avoid: { tone: 'high', word: 'Avoid' },
  caution: { tone: 'watch', word: 'Caution' },
  allergy: { tone: 'high', word: 'Allergy' },
  dose: { tone: 'watch', word: 'Check dose' },
};
/** The types of entry in the hospital's list, as the editor names them. */
export const KIND_LABELS = {
  medicine: 'Pregnancy – medicine',
  combination: 'Pregnancy – combination',
  breastfeeding: 'While breastfeeding',
  newborn: 'Newborn baby',
  dose: 'Dose limit',
};
/** Going ahead despite an Avoid or Allergy warning needs a one-line reason; a Caution or a dose warning does not. */
export const needsReason = (warning) => warning.level === 'avoid' || warning.level === 'allergy';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the name appear in what was typed? At the start of a word, case-insensitive ("losartan" matches
 * "Tab. Losartan 50 mg"). Short names (under 5 letters) and names of several words must also end there,
 * so "iron" doesn't match "ironic" and "mmr" doesn't match "mmrx".
 */
export function termMatches(text, term) {
  const t = term.trim().toLowerCase();
  if (!t || !text) return false;
  const whole = t.length < 5 || /\s/.test(t);
  return new RegExp(`(^|[^a-z0-9])${escape(t)}${whole ? '($|[^a-z0-9])' : ''}`, 'i').test(text);
}
const anyTerm = (text, terms) => (terms ?? []).some((t) => termMatches(text, t));

// Medicine groups for allergies written as a group ("allergic to penicillin", "sulfa allergy").
export const ALLERGY_GROUPS = [
  { name: 'penicillin', words: ['penicillin', 'penicillins', 'pcn'], members: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'piperacillin', 'amoxiclav', 'augmentin', 'mox', 'novamox', 'clavam', 'benzathine'] },
  { name: 'cephalosporin', words: ['cephalosporin', 'cephalosporins'], members: ['cefixime', 'ceftriaxone', 'cefuroxime', 'cephalexin', 'cefalexin', 'cefpodoxime', 'cefadroxil', 'cefotaxime', 'cefoperazone', 'taxim', 'monocef', 'zifi'] },
  { name: 'sulfa', words: ['sulfa', 'sulpha', 'sulfonamide', 'sulphonamide', 'sulfonamides', 'sulphonamides'], members: ['sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septran', 'bactrim', 'sulfasalazine', 'sulphasalazine'] },
  { name: 'NSAID', words: ['nsaid', 'nsaids'], members: ['ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'aceclofenac', 'ketorolac', 'nimesulide', 'indomethacin', 'piroxicam', 'etoricoxib', 'aspirin', 'brufen', 'combiflam', 'meftal', 'voveran', 'ecosprin'] },
  { name: 'quinolone', words: ['quinolone', 'quinolones', 'fluoroquinolone', 'fluoroquinolones'], members: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin', 'ciplox', 'oflox', 'norflox'] },
  { name: 'macrolide', words: ['macrolide', 'macrolides'], members: ['azithromycin', 'erythromycin', 'clarithromycin', 'azee', 'azithral'] },
  { name: 'metronidazole', words: ['metronidazole', 'flagyl'], members: ['metronidazole', 'flagyl', 'metrogyl', 'tinidazole', 'ornidazole'] },
];
// Words in an allergy note that are not medicine names.
const NOT_NAMES = new Set(['allergy', 'allergic', 'allergies', 'none', 'known', 'reaction', 'rash', 'to', 'and', 'with', 'drug', 'drugs', 'food', 'history', 'mild', 'severe', 'itching', 'swelling', 'tablet', 'tablets', 'injection', 'syrup']);

/** What the allergy note names: groups ("penicillin") and single words (≥ 4 letters) that may be medicines. */
export function allergyNames(allergies) {
  const text = (allergies ?? '').toLowerCase();
  if (allergyStatus(text) !== 'recorded') return { groups: [], words: [] };
  const groups = ALLERGY_GROUPS.filter((g) => g.words.some((w) => termMatches(text, w)) || g.members.some((m) => termMatches(text, m)));
  const words = [...new Set(text.split(/[^a-z0-9-]+/).filter((w) => w.length >= 4 && !NOT_NAMES.has(w)))];
  return { groups, words };
}

const inWeeks = (e, weeks) => (e.fromWeek == null || (weeks != null && weeks >= e.fromWeek)) && (e.toWeek == null || (weeks != null && weeks <= e.toWeek));

const inAge = (e, ageDays) => e.maxAgeDays == null || ageDays == null || ageDays <= e.maxAgeDays;

/**
 * The warnings for the medicines being written.
 *  rows: the prescription lines as typed ({ drug, form, strength, dose, frequency }), list: the hospital's entries,
 *  weeks: weeks of pregnancy at the visit (null if not known), pregnant: pregnancy checks apply (antenatal patient),
 *  allergies: the patient's allergy note, breastfeeding: 'yes' | 'unknown' | null (breastfeedingOnVisit),
 *  baby: { ageDays, weight } | null (babyOnVisit).
 * Returns [{ key, level: 'avoid'|'caution'|'allergy'|'dose', title, medicines: [names as typed], message,
 * unsureWeeks, unsureBreastfeeding, unsureAge }] – allergies first, then Avoid, Caution, and the doses.
 */
export function medicineWarnings({ rows, list = [], weeks = null, pregnant = false, allergies = '', breastfeeding = null, baby = null }) {
  const drugs = rows.map((r) => (r.drug ?? '').trim()).filter(Boolean);
  const out = [];
  if (!drugs.length) return out;

  // Allergies (every patient)
  const a = allergyNames(allergies);
  for (const drug of drugs) {
    const group = a.groups.find((g) => g.members.some((m) => termMatches(drug, m)));
    const word = a.words.find((w) => termMatches(drug, w));
    if (group || word) {
      out.push({
        key: `allergy:${drug.toLowerCase()}`,
        level: 'allergy',
        title: `Allergy recorded: “${allergies.trim()}”`,
        medicines: [drug],
        message: group ? `${drug} belongs to the ${group.name} group. Check before prescribing.` : `${drug} may be the medicine in the allergy note. Check before prescribing.`,
      });
    }
  }

  if (pregnant) {
    for (const e of list) {
      if (e.kind !== 'combination' && e.kind !== 'medicine') continue;
      if (e.kind === 'combination') {
        const first = drugs.filter((d) => anyTerm(d, e.terms));
        const second = drugs.filter((d) => anyTerm(d, e.otherTerms) && !first.includes(d));
        if (first.length && second.length) out.push({ key: e.key, level: e.level, title: e.label, medicines: [...first, ...second], message: e.message });
        continue;
      }
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      if (!matched.length) continue;
      const windowed = e.fromWeek != null || e.toWeek != null;
      if (weeks != null && !inWeeks(e, weeks)) continue;
      out.push({ key: e.key, level: e.level, title: e.label, medicines: matched, message: e.message, unsureWeeks: weeks == null && windowed });
    }
  }
  // While breastfeeding (postnatal patients). Not recorded: shown as "if she is breastfeeding".
  if (breastfeeding) {
    const unsure = breastfeeding !== 'yes';
    for (const e of list) {
      if (e.kind !== 'breastfeeding') continue;
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      if (matched.length) out.push({ key: e.key, level: e.level, title: `${e.label} – ${unsure ? 'if she is breastfeeding' : 'breastfeeding'}`, medicines: matched, message: e.message, unsureBreastfeeding: unsure });
    }
  }

  // Newborn-care patients: entries for babies, by age in days where the entry has one.
  if (baby) {
    for (const e of list) {
      if (e.kind !== 'newborn' || !inAge(e, baby.ageDays)) continue;
      const matched = drugs.filter((d) => anyTerm(d, e.terms));
      if (matched.length) out.push({ key: e.key, level: e.level, title: e.label, medicines: matched, message: e.message, unsureAge: baby.ageDays == null && e.maxAgeDays != null });
    }
  }

  // The usual maximum doses (adults; babies per kg, with a recorded weight). Silent where the dose can't be worked out.
  out.push(...doseWarnings({ rows, list, matches: (drug, e) => anyTerm(drug, e.terms), baby: Boolean(baby), weight: baby?.weight ?? null, ageDays: baby?.ageDays ?? null }));

  const order = { allergy: 0, avoid: 1, caution: 2, dose: 3 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

/** Up to what age a newborn entry (or a baby's dose limit) applies, in words ("up to 28 days old", "any age in newborn care"). */
export function entryAgeText(e) {
  if (e.maxAgeDays == null) return 'any age in newborn care';
  if (e.maxAgeDays === 365) return 'under 1 year old';
  if (e.maxAgeDays >= 60 && e.maxAgeDays % 30 === 0) return `under ${e.maxAgeDays / 30} months old`;
  if (e.maxAgeDays % 7 === 0 && e.maxAgeDays > 28) return `under ${e.maxAgeDays / 7} weeks old`;
  return `up to ${e.maxAgeDays} days old`;
}

/** When an entry applies, in words ("from 20 weeks", "up to 15 weeks", "whole pregnancy"). */
export function entryWeeksText(e) {
  if (e.fromWeek != null && e.toWeek != null) return `${e.fromWeek}–${e.toWeek} weeks`;
  if (e.fromWeek != null) return `from ${e.fromWeek} weeks`;
  if (e.toWeek != null) return `up to ${e.toWeek} weeks`;
  return 'whole pregnancy';
}
