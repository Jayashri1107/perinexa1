// Words, marks and row building for the calendar screen. PURE (no clock, no server calls).
// The server decides what each person may see (docs/BRAND.md "Calendar event marks"); the browser only turns
// the answer into rows and words. Reception rows are built from reception fields only: nothing here reads an
// entry's status or name unless the patient's level is 'clinical'.
import { Baby, CalendarCheck, Droplet, Stethoscope } from 'lucide-react';
import { formatDate } from '../../components/ui.jsx';
import { timeLabel } from '../appointments/appointmentFormat.js';
import { gaText, statusLook, windowText } from '../patients/carePlanFormat.js';
import { spokenDay } from './calendarDates.js';

// The kinds of entries, in the order they are listed (the same order as the server).
export const EVENT_TYPES = ['booked', 'plan', 'edd', 'lmp'];
// Entries only doctors and RMOs see.
const PREGNANCY_TYPES = ['edd', 'lmp'];
const CLINICAL_ROLES = ['doctor', 'rmo'];

const has = (roles, list) => (roles ?? []).some((r) => list.includes(r));

/** 'clinical' for doctors and RMOs, else 'reception' (the words used for the counts and the type filter). */
export const personLevel = (roles) => (has(roles, CLINICAL_ROLES) ? 'clinical' : 'reception');

/** The types this person may see: all four for doctors and RMOs, booked and plan visits for reception. */
export const allowedTypesFor = (roles) => (has(roles, CLINICAL_ROLES) ? [...EVENT_TYPES] : EVENT_TYPES.filter((t) => !PREGNANCY_TYPES.includes(t)));

/** "mine" for a doctor who is not an RMO, else "all" (as on the Patients page and on the server). */
export const defaultScopeFor = (roles) => ((roles ?? []).includes('doctor') && !(roles ?? []).includes('rmo') ? 'mine' : 'all');

/** A receptionist who is neither a doctor nor an RMO (opens on today's day view). */
export const isReceptionOnly = (roles) => (roles ?? []).includes('receptionist') && !has(roles, CLINICAL_ROLES);

// ---------- Marks: colour + icon + word (docs/BRAND.md "Calendar event marks") ----------

export const EVENT_LOOK = {
  booked: { className: 'cal-mark-booked', icon: CalendarCheck, word: () => 'Booked visit' },
  plan: {
    className: 'cal-mark-plan',
    icon: Stethoscope,
    word: (level, _event, view) => `${level === 'clinical' ? 'Plan visit' : 'Visit due'}${view === 'month' ? ' – window opens' : ''}`,
  },
  edd: {
    className: 'cal-mark-edd',
    icon: Baby,
    word: (_level, event) => (event?.eddSource === 'scan' ? 'EDD (scan)' : event?.eddSource === 'lmp' ? 'EDD (LMP)' : 'EDD'),
  },
  lmp: { className: 'cal-mark-lmp', icon: Droplet, word: () => 'LMP' },
};

// ---------- Views, types and patients in the web address ----------

export const CALENDAR_VIEWS = ['day', 'week', 'month'];

/** "plan,booked" → ['booked', 'plan'] (fixed order, unknown or not allowed dropped; empty → every allowed type). */
export function parseTypes(value, allowed = EVENT_TYPES) {
  const asked = String(value ?? '')
    .split(',')
    .map((t) => t.trim());
  const list = allowed.filter((t) => asked.includes(t));
  return list.length ? list : [...allowed];
}

/** ['booked', 'plan'] → "booked,plan" (fixed order); every allowed type on → '' (left out of the address). */
export function serializeTypes(list, allowed = EVENT_TYPES) {
  const shown = allowed.filter((t) => list.includes(t));
  if (!shown.length || shown.length === allowed.length) return '';
  return shown.join(',');
}

/** The patients to ask for: 'mine' or 'all' only for a doctor (the only role with the switch); else '' (the server's default for the role). */
export const parseScope = (value, roles) => ((roles ?? []).includes('doctor') && ['mine', 'all'].includes(value) ? value : '');

/**
 * "Go to today" after the server refused the address (400): clear the day, and also a view or patients value the
 * server cannot use. Valid choices stay; the types stay too (they are always cleaned before they are sent).
 */
export function todayParams(params, roles) {
  const doctor = (roles ?? []).includes('doctor');
  const scope = params?.scope ?? '';
  const scopeOk = !scope || scope === 'all' || (scope === 'mine' && doctor);
  return { date: '', ...(CALENDAR_VIEWS.includes(params?.view) ? {} : { view: '' }), ...(scopeOk ? {} : { scope: '' }) };
}

// ---------- Rows ----------

/**
 * The day view's rows, one per patient in each section: { booked, planOpens, attended, edd, lmp }, each row
 * { patientId, patient, events, eventIds }. A patient with a booked visit and a care-plan visit on the day is
 * listed once, under booked visits, with the plan visit among her events. Rows keep the server's order.
 */
export function dayRows(events, patients, date) {
  const out = { booked: [], planOpens: [], attended: [], edd: [], lmp: [] };
  const onDay = (events ?? []).filter((e) => e.date === date);
  const bookedIds = new Set(onDay.filter((e) => e.type === 'booked').map((e) => e.patientId));
  const index = new Map();
  const add = (section, e) => {
    const key = `${section}:${e.patientId}`;
    let row = index.get(key);
    if (!row) {
      row = { patientId: e.patientId, patient: patients?.[e.patientId] ?? null, events: [], eventIds: [] };
      index.set(key, row);
      out[section].push(row);
    }
    row.events.push(e);
    row.eventIds.push(e.id);
  };
  for (const e of onDay) {
    if (e.type === 'booked') add('booked', e);
    else if (e.type === 'plan') {
      if (bookedIds.has(e.patientId)) add('booked', e);
      else {
        // Reception never gets attended visits, and its rows never read a status.
        const clinical = patients?.[e.patientId]?.level === 'clinical';
        add(clinical && e.status === 'done' ? 'attended' : 'planOpens', e);
      }
    } else if (e.type === 'edd') add('edd', e);
    else if (e.type === 'lmp') add('lmp', e);
  }
  return out;
}

/** The week view's day sections: [{ date, events, more }] – one per day of the answer, in order. */
export function weekSections(events, days) {
  const byDate = new Map((days ?? []).map((d) => [d.date, []]));
  for (const e of events ?? []) byDate.get(e.date)?.push(e);
  return (days ?? []).map((d) => ({ date: d.date, events: byDate.get(d.date), more: d.more ?? 0 }));
}

/**
 * The day view's numbers: the server's count of the day (days[0], the same numbers as the month cell, complete
 * even when the list is cut), falling back to the day's rows (dayRows). opens / attended: care-plan visits whose
 * window opens / that were attended on the day; withBooked: care-plan visits listed inside a Booked visits row.
 * A status is read only for clinical rows (reception never gets attended visits).
 */
export function dayCounts(day, rows) {
  const all = Object.values(rows ?? {}).flatMap((list) => list.flatMap((r) => r.events.map((e) => ({ e, clinical: r.patient?.level === 'clinical' }))));
  const done = (x) => x.e.type === 'plan' && x.clinical && x.e.status === 'done';
  const n = (k, test) => day?.[k] ?? all.filter(test).length;
  const opens = n('plan', (x) => x.e.type === 'plan' && !done(x));
  const attended = n('attended', done);
  const withBooked = (rows?.booked ?? []).reduce((s, r) => s + r.events.filter((e) => e.type === 'plan').length, 0);
  return { booked: n('booked', (x) => x.e.type === 'booked'), plan: opens + attended, opens, attended, edd: n('edd', (x) => x.e.type === 'edd'), lmp: n('lmp', (x) => x.e.type === 'lmp'), withBooked };
}

/** The line under the plan section when some of the day's care-plan visits sit in a booked-visit row. */
export const withBookedText = (n) => `${n === 1 ? '1 more is' : `${n} more are`} listed under Booked visits, with the booked visit.`;

// ---------- Words ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const COUNT_WORDS = {
  booked: (n) => plural(n, 'booked visit', 'booked visits'),
  plan: (n, level) => (level === 'clinical' ? plural(n, 'visit window opens', 'visit windows open') : plural(n, 'visit due from this day', 'visits due from this day')),
  edd: (n) => plural(n, 'EDD', 'EDDs'),
  lmp: (n) => plural(n, 'LMP', 'LMPs'),
};

/**
 * A month cell: the icon + number pieces (booked, plan, EDD, LMP; zeros left out), their total, and the words
 * a screen reader hears: "Monday 12 October 2026: 5 booked visits, 3 visit windows open, 1 EDD".
 */
export function countWords(day, level) {
  const pieces = EVENT_TYPES.filter((t) => (day?.[t] ?? 0) > 0).map((t) => ({ type: t, count: day[t] }));
  const words = pieces.map((p) => COUNT_WORDS[p.type](p.count, level));
  if (level === 'clinical' && (day?.attended ?? 0) > 0) words.push(plural(day.attended, 'visit attended', 'visits attended'));
  const total = pieces.reduce((n, p) => n + p.count, 0);
  return { pieces, total, label: `${spokenDay(day?.date)}: ${words.length ? words.join(', ') : 'no entries'}` };
}

const listWords = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`);

/** "No booked visits, plan visits, EDD or LMP on this day." – naming only the types shown. */
export function emptyDayText(types, level) {
  if (level !== 'clinical') {
    if (types.includes('booked') && types.includes('plan')) return 'No booked or due visits on this day.';
    return types.includes('booked') ? 'No booked visits on this day.' : 'No due visits on this day.';
  }
  const names = { booked: 'booked visits', plan: 'plan visits', edd: 'EDD', lmp: 'LMP' };
  return `No ${listWords(EVENT_TYPES.filter((t) => types.includes(t)).map((t) => names[t]))} on this day.`;
}

/** The line under the page title. */
export function subtitleFor(level, scope) {
  if (level !== 'clinical') return 'Booked visits and visits due, all patients';
  return `Booked visits, care-plan visits, EDD and LMP of ${scope === 'mine' ? 'your patients' : 'all patients'}`;
}

const SECTION_TITLES = { booked: 'Booked visits', plan: 'Plan visits', edd: 'EDD', lmp: 'LMP' };

/** A day-view section's title; reception sees care-plan visits only as "Visits due". */
export const sectionTitle = (type, level) => (type === 'plan' && level !== 'clinical' ? 'Visits due' : SECTION_TITLES[type]);

/**
 * The (screen-reader) caption of a day-view table. section: booked | planOpens | attended | edd | lmp.
 * Reception gets its own words only ("Visits due" – never "Plan" or "window").
 */
export function dayCaption(section, level) {
  if (section === 'planOpens') return level === 'clinical' ? 'Plan visits – window opens this day' : sectionTitle('plan', level);
  if (section === 'attended') return 'Plan visits – attended this day';
  return sectionTitle(section, level);
}

/** Whether a month answer has anything on the days of its month. */
export function monthHasEntries(days, date) {
  const month = String(date ?? '').slice(0, 7);
  return (days ?? []).some((d) => d.date.slice(0, 7) === month && ['booked', 'plan', 'attended', 'edd', 'lmp'].some((k) => (d[k] ?? 0) > 0));
}

// ---------- One entry in words (day and week rows) ----------

const isClinical = (patient) => patient?.level === 'clinical';

/** The status pill of a care-plan visit (clinical only): the Care plan tab's words, "Attended (elsewhere)". */
export function planStatusLook(event) {
  const look = statusLook({ ...event, kind: 'visit' });
  return event.status === 'done' && event.doneElsewhere ? { ...look, word: `${look.word} (elsewhere)` } : look;
}

/**
 * The details of one entry, as short lines:
 * plan (clinical) "Antenatal visit (28–30 weeks)", "19 Oct – 8 Nov 2026", "28 w 1 d on the day"; (reception) only the
 * window's first day "From 12 Oct 2026" (the mark already says "Visit due");
 * booked (clinical) "Booked at the visit of 20 Sep 2026", the note, the gestation on the day; (reception) nothing
 * (the mark already says "Booked visit");
 * edd "now 38 w 2 d"; lmp "EDD 12 Jul 2027", "now 1 w 0 d".
 */
export function eventLines(event, patient) {
  const clinical = isClinical(patient);
  const now = clinical && patient.gaToday ? `now ${gaText(patient.gaToday)}` : '';
  switch (event.type) {
    case 'plan': {
      const window = event.due ? windowText(event.due.from, event.due.to) : '';
      // Reception gets only the window's first day (the whole window can hint at how far along she is).
      if (!clinical) return [event.due?.from ? `From ${formatDate(event.due.from)}` : ''].filter(Boolean);
      return [event.name, window, event.ga ? `${gaText(event.ga)} on the day` : ''].filter(Boolean);
    }
    case 'booked': {
      // Appointment booking: the time (or "time to be given") and the doctor, for everyone
      const when = event.appointmentId ? [event.start ? `${timeLabel(event.start)}${event.doctorName ? ` with ${event.doctorName}` : ''}` : `Time to be given${event.doctorName ? ` · ${event.doctorName}` : ''}`] : [];
      if (!clinical) return when;
      return [
        ...when,
        event.visitOn ? `Booked at the visit of ${formatDate(event.visitOn)}` : '',
        event.note ?? '',
        event.ga ? `${gaText(event.ga)} on the day` : '',
      ].filter(Boolean);
    }
    case 'edd':
      return clinical ? [now].filter(Boolean) : [];
    case 'lmp':
      return clinical ? [event.edd ? `EDD ${formatDate(event.edd)}` : '', now].filter(Boolean) : [];
    default:
      return [];
  }
}

/** A care-plan visit shown inside a booked-visit row: "Plan: Antenatal visit (28–30 weeks) · Due now"; reception "Visit due from 12 Oct 2026". */
export function mergedPlanLine(event, patient) {
  if (!isClinical(patient)) {
    // Inside a booked row the plan visit has no mark of its own, so the words are needed here.
    return event.due?.from ? `Visit due from ${formatDate(event.due.from)}` : 'Visit due';
  }
  return `Plan: ${event.name} · ${planStatusLook(event).word}`;
}
