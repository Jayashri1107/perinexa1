// The clocks of a referral (docs/REFERRALS_PLAN.md – the owner's decision 5, from the guide's six promises). PURE: no
// database, and the clock is passed in, so every rule can be tested with a fixed time. Times of day are the
// hospital's own clock ("HH:MM", HOSPITAL_TIME_ZONE); days are date-only values at midnight UTC (careplans/dates.js).
//
// The promises, each with the moment it is due and what meets it:
//  - reply: within 2 WORKING hours of the referral reaching the hospital (the admin's working days and hours –
//    Mon–Sat 9 am–8 pm unless changed – without the admin's holidays); met by the first reply marked sent;
//  - seen: urgent – the same hospital day (before 23:59:59), or by urgentNextMorning (8 am) the next day when it came
//    at or after urgentCutoff (8 pm); routine – within 48 hours; met by her first visit or admission (a visit the
//    same hospital day, or a stay she was already in when it came, counts – it can be before the referral was logged);
//  - note: the consultant note within 24 hours of that first visit; met by the first note marked sent. If she said
//    No to sharing, the note is never sent: met by its signing, shown as "not sent – she did not agree" (never a miss);
//  - discharge: the discharge summary within 24 hours of her discharge (a confirmed discharge card of a stay after
//    the referral, or of the stay she was in when it came); met by the first discharge summary marked sent; the same
//    rule for a No.
// State of each: not_started (its clock has not begun: she has not been seen yet, or is still in hospital) · waiting
// · soon (under a quarter of its time left) · late · met · met_late · not_needed (no stay in hospital; or the referral
// was closed before its clock began) · no_consent. A cancelled referral has no clocks. Closing never lets a promise
// off once its clock has begun – the reply and seen clocks begin when it comes, the note's at her first visit, the
// discharge summary's at her discharge – so a promise still to keep runs on and turns late as it would have (closing
// is not a way to hide a miss); only a clock that had not begun becomes not_needed.
// The reply and seen due times are worked out once, when the referral is logged (or its time or urgency corrected
// before anything happened), and stored (dues): a later change of the working hours, the holidays or the urgent
// cut-off never moves a past clock. An older referral without them is worked out with the settings of today.

import { config } from '../config.js';
import { addDays, hospitalDayStart, hospitalToday, isoDay } from '../careplans/dates.js';
import { hospitalMinutes, minutesOf } from '../appointments/slots.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const REPLY_WORKING_MINUTES = 120;
export const ROUTINE_SEEN_HOURS = 48;
export const NOTE_HOURS = 24;
export const DISCHARGE_HOURS = 24;
// How far ahead a working clock looks for working time before it gives up (no working day set, or all holidays):
// it then runs as an ordinary clock rather than never ending.
const MAX_DAYS = 400;

export const PROMISE_KEYS = ['reply', 'seen', 'note', 'discharge'];
export const PROMISE_LABELS = {
  reply: 'Reply to the doctor',
  seen: 'Seen',
  note: 'Consultant note',
  discharge: 'Discharge summary',
};
const SEEN_LABELS = { urgent: 'Seen the same day', routine: 'Seen within 48 hours' };
/** A promise that was missed (the weekly review lists these). */
export const isMissed = (state) => state === 'late' || state === 'met_late';
/** A promise still running (the desk's "next" clock). */
export const isRunning = (state) => state === 'waiting' || state === 'soon' || state === 'late';

// ---------- Working time ----------

const holidaysOf = (settings) => new Set((settings?.holidays ?? []).map((h) => h.on));

/**
 * The working window of one hospital day ({ open, close } in milliseconds), or null on a day off or a holiday.
 * India keeps one clock all year, so the window is the day's start plus the hours (a clock change inside a working
 * day would shift it by that hour).
 */
function windowOf(day, settings, holidays, tz) {
  const hours = settings?.workingHours ?? {};
  if (!(hours.days ?? []).includes(day.getUTCDay()) || holidays.has(isoDay(day))) return null;
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  if (from == null || to == null || to <= from) return null;
  const start = hospitalDayStart(day, tz).getTime();
  return { open: start + from * MINUTE, close: start + to * MINUTE };
}

/** The moment `minutes` working minutes after `start` (outside working hours the clock waits for the next opening). */
export function addWorkingMinutes(start, minutes, settings, tz = config.HOSPITAL_TIME_ZONE) {
  const from = new Date(start).getTime();
  let left = minutes * MINUTE;
  if (left <= 0) return new Date(from);
  const holidays = holidaysOf(settings);
  let day = hospitalToday(new Date(from), tz);
  for (let i = 0; i < MAX_DAYS; i += 1, day = addDays(day, 1)) {
    const w = windowOf(day, settings, holidays, tz);
    if (!w) continue;
    const s = Math.max(from, w.open);
    if (s >= w.close) continue;
    if (s + left <= w.close) return new Date(s + left);
    left -= w.close - s;
  }
  return new Date(from + minutes * MINUTE);
}

/** Working minutes between two moments (0 when `to` is not after `from`). */
export function workingMinutesBetween(from, to, settings, tz = config.HOSPITAL_TIME_ZONE) {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (b <= a) return 0;
  const holidays = holidaysOf(settings);
  const last = hospitalToday(new Date(b), tz).getTime();
  let total = 0;
  let day = hospitalToday(new Date(a), tz);
  for (let i = 0; i < MAX_DAYS && day.getTime() <= last; i += 1, day = addDays(day, 1)) {
    const w = windowOf(day, settings, holidays, tz);
    if (w) total += Math.max(0, Math.min(b, w.close) - Math.max(a, w.open));
  }
  return Math.round(total / MINUTE);
}

// ---------- The promises ----------

/** When she must be seen: urgent – the same hospital day (or the next morning after the cutoff); routine – 48 h. */
export function seenDue(receivedAt, urgency, settings, tz = config.HOSPITAL_TIME_ZONE) {
  const at = new Date(receivedAt);
  if (urgency !== 'urgent') return new Date(at.getTime() + ROUTINE_SEEN_HOURS * HOUR);
  const nextDayStart = hospitalDayStart(addDays(hospitalToday(at, tz), 1), tz).getTime();
  const cutoff = minutesOf(settings?.urgentCutoff) ?? 20 * 60;
  if (hospitalMinutes(at, tz) >= cutoff) return new Date(nextDayStart + (minutesOf(settings?.urgentNextMorning) ?? 8 * 60) * MINUTE);
  return new Date(nextDayStart - 1000); // 23:59:59 of the day it came
}

/** The reply and seen due times of a referral that came at receivedAt (stored on it: Referral.dues). */
export function duesFor(receivedAt, urgency, settings, tz = config.HOSPITAL_TIME_ZONE) {
  return { reply: addWorkingMinutes(receivedAt, REPLY_WORKING_MINUTES, settings, tz), seen: seenDue(receivedAt, urgency, settings, tz) };
}

/** The first time a message of this kind was marked sent, or null. */
function firstSent(messages, what) {
  const times = (messages ?? []).filter((m) => m.what === what && m.at).map((m) => new Date(m.at).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

/**
 * The state of one clock that has begun. start → due is its time; soon: under a quarter of it left (soonFn overrides,
 * for the working-hours reply). Closing the referral does not stop it (see the top of this file).
 */
function stateOf({ start, due, doneAt, now, soonFn }) {
  if (doneAt) return doneAt.getTime() <= due.getTime() ? 'met' : 'met_late';
  if (now.getTime() > due.getTime()) return 'late';
  const soon = soonFn ? soonFn() : due.getTime() - now.getTime() < (due.getTime() - start.getTime()) / 4;
  return soon ? 'soon' : 'waiting';
}

const promise = (key, label, due, doneAt, state) => ({ key, label, due: due ?? null, doneAt: doneAt ?? null, state });

/**
 * The four promises of a referral at `now`: [{ key, label, due, doneAt, state }] ([] when cancelled).
 * r (a plain object): { status, urgency, receivedAt, dues: { reply, seen } (stored when logged; null on an older
 * referral), firstSeen: { at }, discharge: { dischargedAt }, inHospital (a stay of hers still open), sharing:
 * { answer }, note: { status, signed: { at } }, messages: [{ what, at }] }.
 * Facts are found only while a referral is open (referralService.js), so on a closed one a first visit or a discharge
 * it holds was found before it was closed: those clocks had begun.
 */
export function promisesFor(r, now, settings, tz = config.HOSPITAL_TIME_ZONE) {
  if (!r || r.status === 'cancelled') return [];
  const nowAt = new Date(now);
  const closed = r.status === 'closed';
  const received = new Date(r.receivedAt);
  const said = r.sharing?.answer ?? null;
  const out = [];

  // 1. The reply (working hours): "soon" by the working minutes left, so a reply due at 10:00 is not "soon" all night.
  // Its clock begins when the referral comes – closing does not stop it.
  const replyDue = r.dues?.reply ? new Date(r.dues.reply) : addWorkingMinutes(received, REPLY_WORKING_MINUTES, settings, tz);
  const replied = firstSent(r.messages, 'reply');
  out.push(
    promise('reply', PROMISE_LABELS.reply, replyDue, replied, stateOf({ start: received, due: replyDue, doneAt: replied, now: nowAt, soonFn: () => workingMinutesBetween(nowAt, replyDue, settings, tz) <= REPLY_WORKING_MINUTES / 4 })),
  );

  // 2. Seen on time (begun when it came, like the reply). Closed before she was seen and before it was due (she went
  // elsewhere, or did not want to come): not needed – a fair closing, not a miss. Closed after it was due: missed.
  const seenAt = r.firstSeen?.at ? new Date(r.firstSeen.at) : null;
  const seenBy = r.dues?.seen ? new Date(r.dues.seen) : seenDue(received, r.urgency, settings, tz);
  const closedAt = closed && r.closed?.at ? new Date(r.closed.at) : null;
  const seenState = !seenAt && closedAt && closedAt.getTime() <= seenBy.getTime() ? 'not_needed' : stateOf({ start: received, due: seenBy, doneAt: seenAt, now: nowAt });
  out.push(promise('seen', SEEN_LABELS[r.urgency] ?? PROMISE_LABELS.seen, seenBy, seenAt, seenState));

  // 3. The consultant note: its clock starts at her first visit (closed before she was seen: not needed)
  if (!seenAt) out.push(promise('note', PROMISE_LABELS.note, null, null, closed ? 'not_needed' : 'not_started'));
  else {
    const due = new Date(seenAt.getTime() + NOTE_HOURS * HOUR);
    if (said === 'no') {
      const signedAt = r.note?.status === 'signed' && r.note?.signed?.at ? new Date(r.note.signed.at) : null;
      out.push(promise('note', PROMISE_LABELS.note, due, signedAt, 'no_consent'));
    } else {
      const sent = firstSent(r.messages, 'note');
      out.push(promise('note', PROMISE_LABELS.note, due, sent, stateOf({ start: seenAt, due, doneAt: sent, now: nowAt })));
    }
  }

  // 4. The discharge summary: only when she stayed in hospital; its clock starts at her discharge (closed before
  // that: not needed)
  const dischargedAt = r.discharge?.dischargedAt ? new Date(r.discharge.dischargedAt) : null;
  if (!dischargedAt) out.push(promise('discharge', PROMISE_LABELS.discharge, null, null, r.inHospital && !closed ? 'not_started' : 'not_needed'));
  else {
    const due = new Date(dischargedAt.getTime() + DISCHARGE_HOURS * HOUR);
    if (said === 'no') out.push(promise('discharge', PROMISE_LABELS.discharge, due, dischargedAt, 'no_consent'));
    else {
      const sent = firstSent(r.messages, 'discharge');
      out.push(promise('discharge', PROMISE_LABELS.discharge, due, sent, stateOf({ start: dischargedAt, due, doneAt: sent, now: nowAt })));
    }
  }
  return out;
}

/** The promise to act on next: the running one due first ({ key, label, due, state }), or null. */
export function nextPromise(promises) {
  const running = promises.filter((p) => isRunning(p.state) && p.due).sort((a, b) => new Date(a.due) - new Date(b.due));
  const p = running[0];
  return p ? { key: p.key, label: p.label, due: p.due, state: p.state } : null;
}
