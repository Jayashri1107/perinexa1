// Words for the "may already be registered" warning at registration, and for a record marked as a duplicate of
// another. Words only: nothing is drawn and nothing is requested here. The server decides what is shown of a
// matching record (need to know) – a fact it left out is simply not written here.

import { CONDITION_LABELS, PAST_COMPLICATION_LABELS, PREGNANCY_FINDING_LABELS, newbornAge } from './patientFormat.js';
import { RISK_LABELS } from './riskFormat.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "She may already be registered" – for a baby, "This baby may already be registered". */
export const matchesTitle = (careType) => `${careType === 'newborn' ? 'This baby' : 'She'} may already be registered`;

/** Why a record is shown: "Same phone number and name", "Same phone number" or "Same name". */
export function matchedOnText(match) {
  const on = match?.matchedOn ?? [];
  if (on.includes('phone') && on.includes('name')) return 'Same phone number and name';
  if (on.includes('phone')) return 'Same phone number';
  return on.includes('name') ? 'Same name' : 'Possible match';
}

/**
 * The facts under a matching record's name: the patient number, the age, the doctor and the end of the phone number
 * – each only when the server sent it. Never a clinical detail.
 */
export function matchFacts(match, now = new Date()) {
  const age = match.baby ? (match.birthAt ? newbornAge(match.birthAt, now) : null) : match.age != null ? `${match.age} yrs` : null;
  return [
    match.mrn,
    age,
    match.doctorName === undefined ? null : match.doctorName ? `Doctor: ${match.doctorName}` : 'No doctor assigned',
    match.phoneEnd === undefined ? null : match.phoneEnd ? `Phone ending ${match.phoneEnd}` : 'No phone number',
  ].filter(Boolean);
}

/** "and 3 more records with the same phone number or name" – '' when every match is shown. */
export function moreMatchesText(total, shown) {
  const more = (total ?? 0) - (shown ?? 0);
  return more > 0 ? `and ${plural(more, 'more record')} with the same phone number or name – look in the Patients list.` : '';
}

/** A baby's record is joined only with a baby's, everyone else's never with a baby's. */
export const sameKindOfRecord = (a, b) => (a?.careType === 'newborn') === (b?.careType === 'newborn');

/** May this record be chosen as the main record of `patient`? (not itself, not a duplicate, the same kind) */
export const canBeMainRecord = (patient, candidate) => candidate.id !== patient.id && !candidate.duplicateOf && sameKindOfRecord(patient, candidate);

/** The reason must say something: at least 5 characters. */
export const reasonProblem = (reason) => (String(reason ?? '').trim().length >= 5 ? null : 'Please write why this is a duplicate (at least 5 characters).');

/** How many records the "Mark as a duplicate" search asks for, and how many of them it offers. */
export const MAIN_SEARCH_ASKED = 25;
export const MAIN_SEARCH_SHOWN = 8;

/**
 * The records offered as the main record: the search results without this record, records already marked and
 * records of the other kind (baby / not a baby) – the first MAIN_SEARCH_SHOWN of them. `more`: there may be others
 * (the search returned a full page, or more fit than are shown), so the person is told to type more.
 */
export function mainRecordChoices(patient, found) {
  const fit = (found ?? []).filter((p) => canBeMainRecord(patient, p));
  return { shown: fit.slice(0, MAIN_SEARCH_SHOWN), more: fit.length > MAIN_SEARCH_SHOWN || (found ?? []).length >= MAIN_SEARCH_ASKED };
}

const list = (values, labels) => (values ?? []).map((k) => labels[k] ?? k).join(', ');
const riskWord = (level) => RISK_LABELS[level] ?? level;

/**
 * What the record that is (or is about to be) marked has, that the main record does not – one line each, from the
 * server's `details` (formatDate: how a date is written). Nothing is copied by itself: the doctor copies what still
 * applies.
 */
export function leftBehindLines(details, mainMrn, formatDate = (d) => d) {
  return (details ?? [])
    .map((d) => {
      switch (d.key) {
        case 'allergy':
          return `Allergy: ${d.text} (${mainMrn}: ${d.onMain === 'none' ? 'none known' : d.onMain === 'recorded' ? 'another note' : 'not recorded'})`;
        case 'bloodGroup':
          return `Blood group ${d.value} (${mainMrn}: ${d.onMain || 'not known'})`;
        case 'conditions':
          return `Conditions: ${list(d.values, CONDITION_LABELS)}`;
        case 'otherConditions':
          return `Other conditions: ${d.text}`;
        case 'previousCaesareans':
          return `${plural(d.value, 'previous caesarean')}`;
        case 'pastComplications':
          return `Problems in previous pregnancies: ${list(d.values, PAST_COMPLICATION_LABELS)}`;
        case 'pregnancyDates':
          return `Pregnancy dates: EDD ${formatDate(d.edd)} (${mainMrn}: ${d.onMain ? `EDD ${formatDate(d.onMain)}` : 'no dates'})`;
        case 'findings':
          return `Findings in this pregnancy: ${list(d.values, PREGNANCY_FINDING_LABELS)}`;
        case 'risk':
          return `${riskWord(d.level)} (${mainMrn}: ${d.onMain ? riskWord(d.onMain).toLowerCase() : 'no risk level'})`;
        case 'carePlan':
          return `A care plan in use (${mainMrn} has none)`;
        default:
          return null;
      }
    })
    .filter(Boolean);
}

/**
 * "This record has 5 visits, P-000001 has none …" – said when the record being marked has more visits than the
 * record chosen as the main one (the record with the history is usually the one to keep). '' otherwise.
 */
export function moreVisitsHere(visits, mainMrn, baby = false) {
  const here = visits?.here ?? 0;
  const main = visits?.main ?? 0;
  if (here <= main) return '';
  return `This record has ${plural(here, 'visit')}, ${mainMrn} has ${main === 0 ? 'none' : main}. If this is the record with ${baby ? "the baby's" : 'her'} history, keep it: open ${mainMrn} and mark that one as the duplicate instead.`;
}

/**
 * What to say after a record was marked as a duplicate (the server's answer: { main, appointmentsMoved,
 * arrivedToday, details, remindersHere, abhaHere }). baby: the record is a baby's. Never anything about her bills:
 * the doctor or RMO who marks does not see billing – the sentence about bills is the same every time.
 */
export function markedMessage(result, { baby = false, formatDate } = {}) {
  const mrn = result?.main?.mrn ?? 'the main record';
  const parts = [`Marked as a duplicate of ${mrn}. Nothing was moved or deleted.`];
  if (result?.appointmentsMoved) parts.push(`${plural(result.appointmentsMoved, 'appointment')} from today on ${result.appointmentsMoved === 1 ? 'is' : 'are'} now on ${mrn}.`);
  parts.push('Any open bill stays on this record for reception to settle.');
  if (result?.arrivedToday) parts.push(`${baby ? 'The baby' : 'She'} was marked as arrived today on this record: mark ${baby ? 'the baby' : 'her'} as arrived on ${mrn}, so that ${baby ? 'the baby' : 'she'} stays on today's waiting list.`);
  const lines = leftBehindLines(result?.details, mrn, formatDate);
  if (lines.length) parts.push(`This record has details that ${mrn} does not have – copy what still applies to ${mrn}: ${lines.join('; ')}.`);
  if (result?.remindersHere) parts.push(`${baby ? 'The parents' : 'She'} agreed to reminders on this record only: ask again and record it on ${mrn} (More → Reminders and portal), or no reminders are sent.`);
  if (result?.abhaHere) parts.push(`${baby ? 'The' : 'Her'} ABHA is linked on this record: unlink it here and link it on ${mrn} (ABHA tab).`);
  return parts.join(' ');
}

/** What to say after the marking was undone ({ undone, appointmentsMoved, arrivedOnMain, main }). */
export function undoneMessage(result, { baby = false } = {}) {
  if (!result?.undone) return 'This record was not marked as a duplicate.';
  const back = result.appointmentsMoved ? ` ${plural(result.appointmentsMoved, 'appointment')} came back to this record.` : '';
  const arrived = result.arrivedOnMain
    ? ` ${baby ? 'The baby' : 'She'} was marked as arrived today on ${result.main?.mrn ?? 'the main record'}: mark ${baby ? 'the baby' : 'her'} as arrived on this record, so that ${baby ? 'the baby' : 'she'} stays on today's waiting list.`
    : '';
  return `The duplicate marking was removed: this record is in use again.${back}${arrived}`;
}

/** "Earlier record: P-000002" / "Earlier records: P-000002, P-000005" (the label only; the numbers are links). */
export const earlierRecordsLabel = (records) => ((records ?? []).length === 1 ? 'Earlier record' : 'Earlier records');

/** One undone marking in the record's history, in a sentence (formatDate: how a date is written). */
export function historyLine(h, formatDate) {
  const marked = `Marked as a duplicate of ${h.mrn}${h.byName ? ` by ${h.byName}` : ''}${h.at ? ` on ${formatDate(h.at)}` : ''}`;
  const undone = h.undoneAt || h.undoneByName ? ` Undone${h.undoneByName ? ` by ${h.undoneByName}` : ''}${h.undoneAt ? ` on ${formatDate(h.undoneAt)}` : ''}.` : '';
  return `${marked}${h.reason ? `: ${h.reason}` : ''}.${undone}`;
}
