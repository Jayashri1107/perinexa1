// What a record that is (or is about to be) marked as a duplicate has, that its main record does not have – so
// that nothing important drops out of sight: after the marking, prescribing and every list use the main record only.
//
// NOTHING IS COPIED OR MOVED HERE. The doctor or RMO is told, before marking and after it, and copies what still
// applies to the main record (or marks the other record as the duplicate). It never stops the marking.
// Only facts already on the two records are compared; no clinical rule or threshold is applied.
// Who gets it: the doctor or RMO who may change both records (the marking), and – on the main record's "Earlier
// record" note – only those who may see the medical details of BOTH records (the caller checks).

import { CarePlan } from '../models/CarePlan.js';
import { Visit } from '../models/Visit.js';
import { currentFindings, eddInUse } from './pregnancyFindings.js';

// The usual ways of writing "no allergies" (the same list as the website's patientFormat.js#isNoKnownAllergies).
const NO_ALLERGY_TEXT = /^(nil|none|no|nka|nkda|none known|nil known|no allerg(y|ies)|no known( drug)? allerg(y|ies))\.?$/;
const clean = (text) => String(text ?? '').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** 'recorded' (an allergy is written), 'none' (asked: none known) or 'not_asked' (empty). */
export function allergyStatus(text) {
  const t = clean(text);
  if (!t) return 'not_asked';
  return NO_ALLERGY_TEXT.test(t.toLowerCase()) ? 'none' : 'recorded';
}

const RISK_ORDER = { high: 3, moderate: 2, low: 1 };
const isBaby = (p) => p?.careType === 'newborn';
const missingFrom = (list, other) => (list ?? []).filter((k) => !(other ?? []).includes(k));
const isoDay = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

/**
 * PURE. The medical details on `dup` that `main` does not have, as a list (empty when there is nothing):
 *  - { key: 'allergy', text, onMain }          onMain: 'none' (none known), 'not_asked' or 'recorded' (another note)
 *  - { key: 'bloodGroup', value, onMain }      onMain: the main record's blood group, or '' (not known)
 *  - { key: 'conditions', values }             pre-existing conditions ticked here only
 *  - { key: 'otherConditions', text }
 *  - { key: 'previousCaesareans', value }      more than on the main record
 *  - { key: 'pastComplications', values }      problems in previous pregnancies ticked here only
 *  - { key: 'pregnancyDates', edd, onMain }    the EDD in use here; onMain: the main record's, or null (no dates)
 *  - { key: 'findings', values }               findings of this pregnancy ticked here only
 *  - { key: 'risk', level, onMain }            high or moderate here; onMain: a lower level, or null
 */
export function detailsOnlyOn(dup, main, now = new Date()) {
  const out = [];
  const d = dup?.medical ?? {};
  const m = main?.medical ?? {};
  // A baby's record has no allergy question
  if (!isBaby(dup) && allergyStatus(d.allergies) === 'recorded' && !same(d.allergies, m.allergies)) {
    out.push({ key: 'allergy', text: clean(d.allergies), onMain: allergyStatus(m.allergies) });
  }
  if (d.bloodGroup && d.bloodGroup !== (m.bloodGroup ?? '')) out.push({ key: 'bloodGroup', value: d.bloodGroup, onMain: m.bloodGroup ?? '' });
  const conditions = missingFrom(d.conditions, m.conditions);
  if (conditions.length) out.push({ key: 'conditions', values: conditions });
  if (clean(d.otherConditions) && !same(d.otherConditions, m.otherConditions)) out.push({ key: 'otherConditions', text: clean(d.otherConditions) });
  if (!isBaby(dup)) {
    const caesareans = dup?.obstetric?.previousCaesareans ?? 0;
    if (caesareans > (main?.obstetric?.previousCaesareans ?? 0)) out.push({ key: 'previousCaesareans', value: caesareans });
    const past = missingFrom(dup?.obstetric?.pastComplications, main?.obstetric?.pastComplications);
    if (past.length) out.push({ key: 'pastComplications', values: past });
  }
  if (dup?.careType === 'antenatal') {
    const edd = eddInUse(dup);
    const mainEdd = main?.careType === 'antenatal' ? eddInUse(main) : null;
    if (edd && isoDay(edd) !== isoDay(mainEdd)) out.push({ key: 'pregnancyDates', edd: isoDay(edd), onMain: isoDay(mainEdd) });
    const findings = missingFrom(currentFindings(dup, now), main?.careType === 'antenatal' ? currentFindings(main, now) : []);
    if (findings.length) out.push({ key: 'findings', values: findings });
    const level = dup.risk?.level;
    const mainLevel = main?.careType === 'antenatal' ? (main.risk?.level ?? null) : null;
    if (['high', 'moderate'].includes(level) && (RISK_ORDER[mainLevel] ?? 0) < RISK_ORDER[level]) out.push({ key: 'risk', level, onMain: mainLevel });
  }
  return out;
}

/** Does this record have a care plan in use (not closed)? */
const hasPlan = (tenantId, patientId) => CarePlan.exists({ tenantId, patientId, current: true, status: { $ne: 'closed' } });
const visitCount = (tenantId, patientId) => Visit.countDocuments({ tenantId, patientId, status: 'active' });

/**
 * detailsOnlyOn, and what needs a look in the database: a care plan in use on `dup` when `main` has none
 * ({ key: 'carePlan' }). Both records are of this hospital (the caller found them by tenantId).
 */
export async function leftBehind(tenantId, dup, main, now = new Date()) {
  const details = detailsOnlyOn(dup, main, now);
  const [here, there] = await Promise.all([hasPlan(tenantId, dup._id), hasPlan(tenantId, main._id)]);
  if (here && !there) details.push({ key: 'carePlan' });
  return details;
}

/**
 * Everything the doctor or RMO who marks is told: { details, visits: { here, main }, abhaHere, remindersHere }.
 *  - details: leftBehind;
 *  - visits: how many visits each record has (the one with the history is usually the one to keep);
 *  - abhaHere: her ABHA is linked on this record and not on the main one;
 *  - remindersHere: she agreed to reminders on this record and not on the main one (her appointments go to the main
 *    record, which sends nothing without its own agreement).
 */
export async function markingCheck(tenantId, dup, main, now = new Date()) {
  const [details, here, there] = await Promise.all([leftBehind(tenantId, dup, main, now), visitCount(tenantId, dup._id), visitCount(tenantId, main._id)]);
  return {
    details,
    visits: { here, main: there },
    abhaHere: Boolean(dup.abha?.number) && !main.abha?.number,
    remindersHere: Boolean(dup.reminders?.consent) && !main.reminders?.consent,
  };
}
