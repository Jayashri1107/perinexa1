// Findings made in THIS pregnancy, recorded on the antenatal record as structured tick boxes: gestational
// diabetes, high blood pressure in this pregnancy, twins or more, a low-lying placenta, bleeding.
//
// A finding is ticked or unticked only by a person who may edit the clinical details of the record (the treating
// or an unassigned doctor, an RMO) – never by the software. Every entry keeps who recorded it and when; unticking
// ends the entry (it stays on the record, with who and when) instead of deleting it.
//
// A finding belongs to the pregnancy it was recorded in: one recorded before this pregnancy began (by the dates
// on the record) no longer counts, so a record used again for a later pregnancy starts without the findings of
// the earlier one. Pure – no database.

import { PREGNANCY_DAYS, addDays, hospitalToday, toHospitalDate, utcDay } from '../careplans/dates.js';

export const PREGNANCY_FINDINGS = ['gdm', 'hypertension', 'multiple', 'placenta_praevia', 'bleeding'];
/** How a finding was recorded: on the record itself, or confirmed on a visit page after a suggestion. */
export const FINDING_VIA = ['record', 'visit'];
/** Entries kept per record (ticks and unticks); the oldest ended ones go first. */
export const MAX_FINDING_ENTRIES = 100;

// This pregnancy counts from two weeks before the LMP-equivalent of the EDD in use (the same rule as the red
// flags use for "visits of this pregnancy"): something recorded before the dates were known still counts.
export const PREGNANCY_WINDOW_DAYS = PREGNANCY_DAYS + 14;

// A visit's blood pressure at or above this suggests "high blood pressure in this pregnancy" (the visit page
// offers it; a doctor or RMO confirms). DRAFT threshold, not reviewed by a doctor: MoHFW SBA guidelines / PMSMA
// (BP 140/90 or higher; the guidelines ask for two readings). The screen names this source with the offer.
export const SUGGEST_HYPERTENSION_BP = { systolic: 140, diastolic: 90 };

/**
 * The EDD in use, from the dates as they are on the record now (the scan EDD, otherwise LMP + 280 days). Worked
 * out here so that it is right even before a changed record is saved (the stored effectiveEdd is set on save).
 */
export function eddInUse(patient) {
  const p = patient?.pregnancy ?? {};
  if (p.lmp === undefined && p.scanEdd === undefined) return utcDay(p.effectiveEdd) ?? null;
  return utcDay(p.scanEdd) ?? (p.lmp ? addDays(p.lmp, PREGNANCY_DAYS) : null);
}

/**
 * The first day that counts as this pregnancy (a date). Without dates on the record: the last 42 weeks – no
 * pregnancy is longer. Never after today.
 */
export function pregnancySince(patient, now = new Date()) {
  const today = hospitalToday(now);
  const since = addDays(eddInUse(patient) ?? today, -PREGNANCY_WINDOW_DAYS);
  return since > today ? today : since;
}

/**
 * The findings the vital signs saved at this visit suggest, for a doctor or RMO to confirm ("Add to her record")
 * – nothing is ever ticked by itself. Pure; the same check makes the visit page's offer and decides whether a
 * finding may be recorded as "confirmed at a visit".
 *  - only an antenatal visit of this pregnancy that is not marked "entered in error", on an antenatal record;
 *  - high blood pressure in this pregnancy: BP 140/90 or higher at this visit (either number), when it is not
 *    ticked yet and chronic high blood pressure is not among her existing conditions.
 * Returns [{ key: 'hypertension', systolic, diastolic }] or [].
 */
export function suggestedFindings(patient, visit, now = new Date()) {
  if (!patient || !visit || patient.careType !== 'antenatal' || visit.careType !== 'antenatal' || visit.status !== 'active') return [];
  if (utcDay(visit.visitOn) < pregnancySince(patient, now)) return []; // a visit of an earlier pregnancy
  const { bpSystolic: systolic, bpDiastolic: diastolic } = visit.vitals ?? {};
  if (systolic == null || diastolic == null) return [];
  if (systolic < SUGGEST_HYPERTENSION_BP.systolic && diastolic < SUGGEST_HYPERTENSION_BP.diastolic) return [];
  if (currentFindings(patient, now).includes('hypertension') || (patient.medical?.conditions ?? []).includes('hypertension')) return [];
  return [{ key: 'hypertension', systolic, diastolic }];
}

// Positions (in pregnancy.findings) of the entries that count now: not ended, recorded in this pregnancy. One
// per finding.
function currentIndexes(patient, now) {
  const since = pregnancySince(patient, now);
  const at = new Map();
  (patient?.pregnancy?.findings ?? []).forEach((f, i) => {
    if (!f || f.endedAt || !f.at || !PREGNANCY_FINDINGS.includes(f.key)) return;
    if (toHospitalDate(f.at) < since) return; // from an earlier pregnancy on the same record
    at.set(f.key, i);
  });
  return at;
}

/** The entries that count now, in the fixed order of PREGNANCY_FINDINGS. */
export function currentFindingEntries(patient, now = new Date()) {
  const at = currentIndexes(patient, now);
  return PREGNANCY_FINDINGS.filter((k) => at.has(k)).map((k) => patient.pregnancy.findings[at.get(k)]);
}

/** The findings ticked for this pregnancy (their keys). */
export const currentFindings = (patient, now = new Date()) => currentFindingEntries(patient, now).map((f) => f.key);

/**
 * Ticks or unticks one finding on the record (in memory; the caller saves). who: { by, byName, at }.
 * Returns true if the record changed (ticking a ticked finding, or unticking one that is not ticked, changes nothing).
 */
export function setFinding(patient, key, present, { by = null, byName, at, via = 'record', visitId = null }) {
  if (!patient.pregnancy.findings) patient.pregnancy.findings = [];
  const list = patient.pregnancy.findings;
  const index = currentIndexes(patient, at).get(key);
  if (present ? index !== undefined : index === undefined) return false;
  if (present) {
    // Room for the new entry: the oldest ended entries go first (open ones are never dropped)
    while (list.length >= MAX_FINDING_ENTRIES) {
      const oldest = list.findIndex((f) => f.endedAt);
      if (oldest < 0) break;
      list.splice(oldest, 1);
    }
    list.push({ key, by, byName, at, via, visitId, endedAt: null, endedByName: null });
  } else {
    list[index].endedAt = at;
    list[index].endedByName = byName;
  }
  // A database record: the whole list is written on save. (A change inside one entry is otherwise lost when the
  // pregnancy section was set as a whole in the same request, as the edit route does.)
  patient.markModified?.('pregnancy.findings');
  return true;
}

/**
 * Makes the ticked findings `keys` (the edit form sends its whole list). Only the differences are written: a
 * finding that stays ticked keeps who first recorded it and when. Returns true if anything changed.
 * seen: the list the form showed when it was opened. Then only what the person changed on the form is applied
 * (ticked there: in `keys`, not in `seen`; unticked there: in `seen`, not in `keys`), so a finding a colleague
 * ticked meanwhile – for example from a visit page – is never unticked by saving an older form.
 */
export function setFindings(patient, keys, who, { seen = null } = {}) {
  const want = new Set(keys);
  const before = seen ? new Set(seen) : null;
  let changed = false;
  for (const key of PREGNANCY_FINDINGS) {
    if (before && want.has(key) === before.has(key)) continue; // not changed on the form
    changed = setFinding(patient, key, want.has(key), who) || changed;
  }
  return changed;
}

/**
 * What the screens get: every entry without staff ids, newest last, with `current` (counts for this pregnancy
 * now). An entry that is neither current nor ended is from an earlier pregnancy on the same record.
 */
export function findingsView(patient, now = new Date()) {
  const current = new Set(currentIndexes(patient, now).values());
  return (patient?.pregnancy?.findings ?? []).map((f, i) => ({
    key: f.key,
    byName: f.byName ?? null,
    at: f.at ?? null,
    via: f.via ?? 'record',
    endedAt: f.endedAt ?? null,
    endedByName: f.endedByName ?? null,
    current: current.has(i),
  }));
}
