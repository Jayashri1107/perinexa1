// A death recorded on a record, and the record CLOSED by it (5 Oct 2026): the words only. Pure (no screen, no
// request), so the server's tests can check the lists against their own copy (server/src/patients/deathRules.js).
// The server decides who may record or undo a death (a doctor of the record) and refuses what makes no sense.
//
// Who sees what: those who may see the medical details get the date, the place or the timing and who recorded it;
// everyone else who may open the record sees only that it is closed – never why or when.

// A baby's record: where the baby died.
export const DEATH_PLACES = { here: 'This hospital', elsewhere: 'Elsewhere' };
// Every other record: when, in relation to the pregnancy. DRAFT wording, for a doctor to check (WHO).
export const DEATH_TIMINGS = {
  pregnancy: 'During pregnancy',
  delivery: 'During delivery or within 24 hours after it',
  postpartum: 'From 24 hours up to 42 days after delivery (or after the pregnancy ended)',
  other: 'Other: an accident or a cause not related to the pregnancy, or later than 42 days',
};
export const TIMING_HINT =
  'The first three are counted as a maternal death. A death from an accident or a cause not related to the pregnancy is “Other” (WHO). These choices are a DRAFT for a doctor to check.';

/** "YYYY-MM-DD" of a moment in this computer's time (the hospital's day on its own computers). */
export function localDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Completed days from the day of birth to the day of death (0 = the day of birth); null when it cannot be said. */
export function ageAtDeathDays(birthAt, deathDay) {
  if (!birthAt || !deathDay) return null;
  const born = Date.parse(`${localDay(birthAt)}T00:00:00Z`);
  const died = Date.parse(`${deathDay}T00:00:00Z`);
  if (!Number.isFinite(born) || !Number.isFinite(died) || died < born) return null;
  return Math.round((died - born) / 86_400_000);
}

/** "On the day of birth", "1 day", "12 days". */
export const ageText = (days) => (days === 0 ? 'on the day of birth' : `${days} ${days === 1 ? 'day' : 'days'}`);

/** Under the date in "Record a death" on a baby's record: the age worked out, or why it is not. */
export function ageHint(birthAt, deathDay, formatDate) {
  if (!birthAt) return 'The time of birth is not on this record: the age is recorded as not known. Add the time of birth in Edit details, and it is worked out.';
  if (!deathDay) return `Born ${formatDate(`${localDay(birthAt)}T00:00:00Z`)}. The age is worked out from the date of birth.`;
  const days = ageAtDeathDays(birthAt, deathDay);
  if (days == null) return 'This date is before the day of birth.';
  return `Age at death: ${ageText(days)} (worked out from the date of birth, ${formatDate(`${localDay(birthAt)}T00:00:00Z`)}).`;
}

/** The status on the banner: "Died on 3 Oct 2026". */
export const diedOnText = (death, formatDate) => `Died on ${formatDate(death.on)}`;

/** The facts after it: a baby – the age and the place; everyone else – when it was. */
export function deathFacts(death, { baby }) {
  if (baby) {
    return [death.ageDays == null ? 'Age not known (no time of birth on the record)' : `Aged ${ageText(death.ageDays)}`, DEATH_PLACES[death.place] ?? null].filter(Boolean).join(' · ');
  }
  return DEATH_TIMINGS[death.timing] ?? '';
}

/** What a closed record no longer takes, in one sentence (the same for everyone: it never says why). */
export const CLOSED_TAKES_NOTHING = 'It can still be read, but it takes nothing new – no visits, appointments, lab orders, admissions, reminders or messages.';

/** The reason for undoing must say something: at least 5 characters. */
export const undoReasonProblem = (reason) => (String(reason ?? '').trim().length >= 5 ? null : 'Please write why this was recorded in error (at least 5 characters).');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What to say after a death was recorded (the server's answer: { appointmentsCancelled, messagesCancelled,
 * portalEnded, inHospital, babies }). baby: the record is a baby's.
 */
export function recordedMessage(result, { baby = false } = {}) {
  const who = baby ? 'the baby' : 'her';
  const parts = ['The death was recorded and this record is closed.'];
  const done = [
    result?.appointmentsCancelled ? `${plural(result.appointmentsCancelled, 'appointment')} from today on ${result.appointmentsCancelled === 1 ? 'was' : 'were'} cancelled, with no message to the family` : null,
    result?.messagesCancelled ? `${plural(result.messagesCancelled, 'waiting message')} ${result.messagesCancelled === 1 ? 'was' : 'were'} stopped` : null,
    result?.portalEnded ? `${baby ? 'the' : 'her'} patient portal access ended` : null,
  ].filter(Boolean);
  if (done.length) parts.push(`${done.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()));
  if (result?.inHospital) parts.push(`${baby ? 'The baby is' : 'She is'} still on the In hospital list: the discharge card ends the stay.`);
  const babies = result?.babies ?? [];
  if (babies.length) {
    parts.push(
      `${babies.length === 1 ? `Her baby's record ${babies[0].mrn} is` : `Her babies' records ${babies.map((b) => b.mrn).join(', ')} are`} still in use: reminders for ${babies.length === 1 ? 'it' : 'them'} go on, to the number on the baby's record. Look at ${babies.length === 1 ? 'it' : 'them'}.`,
    );
  }
  if (!result?.appointmentsCancelled && !result?.messagesCancelled && !result?.portalEnded) parts.push(`Nothing was booked or waiting for ${who}.`);
  return parts.join(' ');
}

/**
 * What to say after a death recorded in error was undone ({ undone, appointmentsToRebook: [{ date, start,
 * doctorName }] }). timeLabel: how a time is written ("10:30 AM").
 */
export function undoneMessage(result, { formatDate, timeLabel }) {
  if (!result?.undone) return 'No death was recorded on this record.';
  const again = result.appointmentsToRebook ?? [];
  const head = 'The death recorded in error was undone: this record is in use again.';
  if (!again.length) return `${head} No appointment ahead had been cancelled by it.`;
  const lines = again.map((a) => `${formatDate(a.date)}${a.start ? ` at ${timeLabel(a.start)}` : ''}${a.doctorName ? ` with ${a.doctorName}` : ''}`);
  return `${head} Nothing that was cancelled comes back by itself. Book again on the Appointments tab what is still wanted: ${lines.join('; ')}.`;
}

/** One undone death in the record's history (formatDate for days, formatDateTime for moments). */
export function undoneLine(h, { formatDate, formatDateTime, baby = false }) {
  const what = baby ? (DEATH_PLACES[h.place] ? ` (${DEATH_PLACES[h.place].toLowerCase()})` : '') : DEATH_TIMINGS[h.timing] ? ` (${DEATH_TIMINGS[h.timing].toLowerCase()})` : '';
  return `A death on ${formatDate(h.on)}${what} was recorded by ${h.byName ?? 'a doctor'} on ${formatDateTime(h.at)} and undone by ${h.undoneByName ?? 'a doctor'} on ${formatDateTime(h.undoneAt)}: ${h.undoneReason || 'no reason given'}.`;
}
