// The AI brief (Smart features, step 10): a few lines on what is most important to look at on the Today page, the
// calendar or a patient's page – made only when a doctor or RMO asks, shown and not saved (routes/aiBrief.js).
//
// What the AI is told is built here from the same lists the page shows, as plain text WITHOUT names, phone
// numbers, addresses or patient numbers. On Today and the calendar each patient is a label such as [P3] that only
// Perinexa can turn back into a name, and no text typed by staff is sent (it could name someone). HIV status is
// never sent – not as a condition, a risk reason or a test result, and typed lines of the record that name it are
// left out (the HIV and AIDS Act 2017 protects it). The answer is checked: a point naming a label that is not on
// the page is dropped, and the baby's sex in a pregnancy is never shown (PCPNDT).

import { hospitalToday, isoDay, timeIn, toHospitalDate } from '../careplans/dates.js';
import { isAbnormal, testByKey } from '../lab/labTests.js';
import { gestationalAge } from '../models/Patient.js';
import { flagFromText } from '../redflags/redFlags.js';
import { HttpError } from '../utils/httpError.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../utils/pcpndt.js';
import { LOSS_LABELS } from '../patients/abortionRules.js';
import { scrub } from './context.js';
import { strictObject } from './openai.js';

export const MAX_POINTS = 6;
const MAX_ROWS = 40; // per list of the Today page
const MAX_ENTRIES = 160; // calendar entries

// ---------- Labels: [P1], [P2] … ----------

/**
 * Labels for the patients of a page, in the order they are first mentioned. Only the server keeps the map; the
 * name and patient number go back to the screen (two patients with one name are told apart by the number).
 */
export function patientLabels() {
  const byId = new Map(); // patient id -> { label, patient: { id, fullName, mrn } }
  return {
    tag(patient) {
      const id = String(patient.id);
      if (!byId.has(id)) byId.set(id, { label: `P${byId.size + 1}`, patient: { id, fullName: patient.fullName ?? '', mrn: patient.mrn ?? '' } });
      return `[${byId.get(id).label}]`;
    },
    get size() {
      return byId.size;
    },
    ids: () => [...byId.keys()],
    entries: () => [...byId.values()],
  };
}

// ---------- HIV is never sent ----------

const HIV_WORDS = /\b(hiv|plhiv|aids|retro\s*-?\s*(?:viral|positive|reactive)|rvd|pptct|ictc)\b/i;
export const mentionsHiv = (text) => HIV_WORDS.test(String(text ?? '').replace(/_/g, ' '));
const hivReason = (r) => mentionsHiv(r?.label) || mentionsHiv(r?.key);
const hivTest = (t) => mentionsHiv(t?.key) || mentionsHiv(t?.name);

// Care-plan lines name tests that are due (the HIV test is offered to every pregnant woman) – never a result.
const DUE_LINE = /^(?:Care plan overdue|Care plan due now|Next planned visit): /;

/**
 * The record text of ai/context.js without HIV: the condition and the risk reason are taken out of their lines,
 * and any other line that names it (a typed complaint, diagnosis or note) is left out.
 */
export function withoutHiv(text) {
  return String(text)
    .split('\n')
    .map((line) => {
      if (!mentionsHiv(line) || DUE_LINE.test(line)) return line;
      const conditions = /^(Known conditions: )(.*)$/.exec(line);
      if (conditions) {
        const kept = conditions[2].split(', ').filter((c) => !mentionsHiv(c));
        return kept.length ? conditions[1] + kept.join(', ') : null;
      }
      const risk = /^(Risk level: [^–]*?)(?: – (.*))?$/.exec(line);
      if (risk) {
        const kept = (risk[2] ?? '').split('; ').filter((r) => r && !mentionsHiv(r));
        return kept.length ? `${risk[1]} – ${kept.join('; ')}` : risk[1];
      }
      return null;
    })
    .filter((line) => line != null)
    .join('\n');
}

// ---------- Facts ----------

const CARE_WORDS = { antenatal: 'pregnancy', postnatal: 'after delivery', infertility: 'infertility', gynaecology: 'gynaecology', newborn: 'newborn baby', abortion: 'pregnancy loss (abortion care)' };
// Every stored type of loss, including an old threatened miscarriage ("… now recorded under antenatal")
const LOSS_WORDS = Object.fromEntries(Object.entries(LOSS_LABELS).map(([k, label]) => [k, label.toLowerCase()]));
const careWords = (type) => CARE_WORDS[type] ?? String(type ?? 'type of care not known').replace(/_/g, ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (instant) => (instant ? isoDay(toHospitalDate(instant)) : '');
const dayAndTime = (instant) => (instant ? `${day(instant)} ${timeIn(new Date(instant))}` : '');
const gaText = (ga) => (ga ? `${ga.weeks}w ${ga.days}d` : '');

/** One patient's facts (only for patients whose medical details the person may see): care, weeks, EDD, risk. */
export function patientFacts(p, now = new Date()) {
  const parts = [careWords(p.careType)];
  if (p.careType === 'antenatal') {
    const ga = gestationalAge(p, now);
    parts.push(ga ? `${gaText(ga)} today` : 'weeks not known (no EDD recorded)');
    if (p.pregnancy?.effectiveEdd) parts.push(`EDD ${isoDay(p.pregnancy.effectiveEdd)}`);
    const r = p.risk;
    if (r?.level) {
      const reasons = (r.reasons ?? []).filter((x) => !hivReason(x)).map((x) => x.label).filter(Boolean);
      parts.push(`risk ${r.level}${r.override ? ' (set by the doctor)' : ''}${reasons.length ? ` – ${reasons.join('; ')}` : ''}`);
    }
  }
  // Abortion care: only the type of loss (no weeks today, no EDD – the pregnancy has ended or is not counted).
  if (p.careType === 'abortion' && LOSS_WORDS[p.abortion?.lossType]) parts.push(LOSS_WORDS[p.abortion.lossType]);
  return parts.join(', ');
}

const fieldOf = (test, key) => testByKey.get(test.key)?.fields?.find((f) => f.key === key);

/** The names of an order's tests, without HIV. */
export const testNamesOf = (order) => (order.tests ?? []).filter((t) => !hivTest(t)).map((t) => t.name);

/** The values of an order outside range, without HIV: "Haemoglobin 8.9 g/dL (low)". Typed result text is not sent. */
export function flaggedValues(order) {
  const out = [];
  for (const t of order.tests ?? []) {
    if (hivTest(t)) continue;
    for (const v of t.values ?? []) {
      if (!isAbnormal(v.flag)) continue;
      const f = fieldOf(t, v.key);
      out.push(`${f?.label ?? t.name} ${v.value}${f?.unit ? ` ${f.unit}` : ''} (${v.flag})`);
    }
  }
  return out;
}

const rows = (title, list, line) => {
  const shown = (list ?? []).slice(0, MAX_ROWS).map(line).filter(Boolean);
  if (!shown.length) return [];
  const more = (list?.length ?? 0) - MAX_ROWS;
  return [`## ${title}`, ...shown, ...(more > 0 ? [`… and ${more} more not listed`] : []), ''];
};

const patientsSection = (labels, facts, now, other) => {
  const people = labels.entries();
  if (!people.length) return [];
  return ['## The patients', ...people.map(({ label, patient }) => `[${label}] ${facts.has(patient.id) ? patientFacts(facts.get(patient.id), now) : other}`)];
};

// ---------- The Today page ----------

const DOC_WORDS = { delivery: 'delivery note', operation: 'operation note', discharge: 'discharge card', admission: 'admission note', round: 'round note' };

/**
 * The Today page as text: work (routes/worklist.js), day (routes/today.js), stays (routes/inpatients.js), lab
 * ([{ order, patient }] waiting for this doctor's review); facts: Map id -> patient (medical details allowed).
 * Returns { text, labels }.
 */
export function todayBriefText({ work, day: todays, stays, lab, facts, now = new Date(), scope }) {
  const labels = patientLabels();
  const t = (patient) => labels.tag(patient);
  const progress = new Map((work?.seenToday ?? []).map((v) => [v.visitId, v]));
  const draftRules = work?.rules?.status === 'draft' ? '; the red-flag rules are still a draft, not yet approved by a doctor' : '';

  const lines = [
    `Today is ${isoDay(hospitalToday(now))}. The lists are of ${scope === 'mine' ? "the doctor's own and unassigned patients" : 'all patients this person may see'}.`,
    ...(work?.cut || todays?.cut ? ['Some lists are cut short: there are more patients than the page can show.'] : []),
    '',
    ...rows(`Red flags (from each patient's latest visit, lab results and, in hospital, the nursing chart${draftRules})`, work?.redFlags, (r) =>
      `${t(r.patient)} ${r.flags.map((f) => `${f.level}: ${f.label}${f.detail ? ` (${f.detail})` : ''}${flagFromText(f) ? ` ${flagFromText(f)}` : ''}`).join('; ')}`,
    ),
    ...rows("Notes waiting for the doctor's confirmation", stays?.toConfirm, (d) => `${t(d.patient)} ${DOC_WORDS[d.kind] ?? d.kind} written ${dayAndTime(d.at)}`),
    ...rows("Lab results waiting for the doctor's review", lab, ({ order, patient }) => {
      const names = testNamesOf(order);
      if (!names.length) return null;
      const flagged = flaggedValues(order);
      return `${t(patient)} ${names.join(', ')} – ${flagged.length ? `outside range: ${flagged.join(', ')}` : 'no value outside range'}${order.urgent ? ' (urgent order)' : ''}, reported ${dayAndTime(order.reported?.at)}`;
    }),
    ...rows('In hospital now', stays?.admitted, (s) => `${t(s.patient)} admitted ${dayAndTime(s.admittedAt)}${s.drafts ? `, ${plural(s.drafts, 'note')} still draft` : ''}`),
    ...rows("Today's patients (booked for today, arrived, or came without a booking)", todays?.patients, (r) => {
      const v = r.visitId ? progress.get(r.visitId) : null;
      const visit = r.visitStarted
        ? `visit started${v ? ` (${[v.vitalsSaved ? 'vitals saved' : 'no vitals yet', v.detailsSaved ? 'details saved' : 'no details yet', plural(v.medicines, 'medicine')].join(', ')})` : ''}`
        : '';
      return `${t(r.patient)} ${r.booked ? 'booked for today' : 'came without a booking'}, ${r.arrivedAt ? `arrived ${timeIn(new Date(r.arrivedAt))}` : 'not arrived yet'}${visit ? `, ${visit}` : ''}`;
    }),
    ...rows('Visits due now – not booked (to call)', todays?.dueNow, (r) => `${t(r.patient)} care-plan visit due from ${r.dueFrom}`),
    ...rows('Overdue – not booked (to call)', todays?.overdue, (r) =>
      `${t(r.patient)} ${[r.bookedFor && `booked for ${r.bookedFor}, no visit recorded`, r.dueFrom && `visit was due from ${r.dueFrom}`].filter(Boolean).join('; ')}`,
    ),
    ...rows('Care plan to act on', work?.carePlan, (c) => {
      const n = c.counts ?? {};
      const counts = [n.overdue && `${n.overdue} overdue`, n.due && `${n.due} due now`, n.needsDecision && `${n.needsDecision} need a decision`, n.missedVisits && plural(n.missedVisits, 'missed visit')]
        .filter(Boolean)
        .join(', ');
      // An item added by hand for her has a typed name: without her name or phone-like numbers
      const top = (c.top ?? []).map((i) => `${scrub(i.name, c.patient)} (${i.status}, by ${isoDay(i.dueBy)})`).join('; ');
      return `${t(c.patient)} ${counts}${top ? ` – ${top}` : ''}`;
    }),
  ];
  const text = [...lines, ...patientsSection(labels, facts, now, 'appointment details only')].join('\n').trim();
  return { text, labels };
}

// ---------- The calendar ----------

const TYPE_WORDS = { booked: 'booked next visits', plan: 'care-plan visits', edd: 'EDDs', lmp: 'LMPs' };
const STATE_WORDS = { booked: 'booked', today: 'booked for today', arrived: 'she came', no_visit: 'no visit was recorded on the day (missed)' };
const weekday = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The calendar's dates as text: cal is loadCalendar's answer (calendar/calendarLoad.js); from, to and today are
 * "YYYY-MM-DD"; facts: Map id -> patient (only those the person sees at the clinical level). Returns { text, labels }.
 */
export function calendarBriefText({ cal, view, from, to, today, types, scope, facts, now = new Date() }) {
  const labels = patientLabels();
  const t = (id) => labels.tag({ id, fullName: cal.patients?.[id]?.fullName, mrn: cal.patients?.[id]?.mrn });
  const dayLine = (d) => {
    const parts = [
      d.booked && plural(d.booked, 'booked visit'),
      d.plan && plural(d.plan, 'care-plan visit'),
      d.attended && `${plural(d.attended, 'care-plan visit')} attended`,
      d.edd && plural(d.edd, 'EDD'),
      d.lmp && plural(d.lmp, 'LMP'),
      d.more && `${d.more} more not listed below`,
    ].filter(Boolean);
    return parts.length ? `${d.date} (${weekday(d.date)}): ${parts.join(', ')}` : null;
  };
  const entry = (e) => {
    const who = t(e.patientId);
    if (e.type === 'booked') return `${e.date} ${who} booked visit – ${STATE_WORDS[e.state] ?? e.state}${e.ga ? ` (${gaText(e.ga)} that day)` : ''}`;
    if (e.type === 'plan') {
      if (!e.name) return `${e.date} ${who} a care-plan visit window opens`;
      const done = e.status === 'done' && e.doneOn ? ` on ${e.doneOn}` : '';
      return `${e.date} ${who} care-plan visit "${scrub(e.name, cal.patients?.[e.patientId] ?? {})}" – ${e.status}${done}${e.due ? ` (window ${e.due.from} to ${e.due.to})` : ''}`;
    }
    if (e.type === 'edd') return `${e.date} ${who} EDD (expected delivery date)`;
    if (e.type === 'lmp') return `${e.date} ${who} LMP`;
    return null;
  };

  const events = cal.events ?? [];
  const lines = [
    `The calendar shows ${view === 'day' ? `one day, ${from}` : `${from} to ${to}`} (today is ${today}). Entries shown: ${types.map((x) => TYPE_WORDS[x] ?? x).join(', ')}. Patients: ${scope === 'mine' ? "the doctor's own" : 'all'}.`,
    ...(cal.countsIncomplete ? ['There are too many entries to count them all: the counts may be incomplete.'] : []),
    '',
    ...rowsOf('Entries per day', (cal.days ?? []).map(dayLine).filter(Boolean)),
    ...rowsOf('Entries', events.slice(0, MAX_ENTRIES).map(entry).filter(Boolean), events.length - MAX_ENTRIES),
  ];
  const text = [...lines, ...patientsSection(labels, facts, now, 'appointment details only')].join('\n').trim();
  return { text, labels };
}

function rowsOf(title, list, more = 0) {
  if (!list.length) return [];
  return [`## ${title}`, ...list, ...(more > 0 ? [`… and ${more} more not listed`] : []), ''];
}

// ---------- A patient's page ----------

const LAB_STATUS = {
  ordered: 'ordered – sample not taken yet',
  collected: 'sample taken – waiting for results',
  reported: "results ready – waiting for the doctor's review",
  reviewed: 'reviewed by a doctor',
};

/** A patient's recent lab orders (newest first) and current stay, for her page's brief: no HIV, no typed text. */
export function patientExtrasText({ orders = [], stay = null }) {
  const lines = [];
  const shown = orders
    .map((o) => {
      const names = testNamesOf(o);
      if (!names.length) return null;
      const flagged = ['reported', 'reviewed'].includes(o.status) ? flaggedValues(o) : [];
      return `${day(o.ordered?.at)} ${names.join(', ')} – ${LAB_STATUS[o.status] ?? o.status}${o.urgent ? ' (urgent)' : ''}${flagged.length ? `; outside range: ${flagged.join(', ')}` : ''}`;
    })
    .filter(Boolean);
  if (shown.length) lines.push('## Lab orders of the last 90 days, newest first', ...shown);
  if (stay) lines.push(...(lines.length ? [''] : []), `## In hospital since ${dayAndTime(stay.admittedAt)}`);
  return lines.join('\n');
}

// ---------- What the AI is asked, and its answer ----------

const POINTS = { type: 'array', items: strictObject({ text: { type: 'string' }, first: { type: 'boolean' } }) };
export const BRIEF_SCHEMA = strictObject({ points: POINTS });
export const PATIENT_BRIEF_SCHEMA = strictObject({ points: POINTS, missing: { type: 'array', items: { type: 'string' } } });

const DATES = 'Write dates like "14 Oct 2026" (or "14 Oct" in the current year), not 2026-10-14.';
const LABEL_RULES = [
  'Patients appear only as labels in square brackets such as [P3]. Refer to a patient only by that label, written exactly as given with the brackets; never guess a name and never use a label that is not listed.',
  'Write 3 to 6 short points, the most urgent first. Put patients with the same need in one point, naming at most 4 of them (for more, say how many others). Set first=true only for the one or two points to act on before anything else today (none if nothing is urgent).',
  'Use only what is listed – do not invent values, diagnoses or patients, and do not give treatment orders. Plain English, no markdown, each point under 35 words. If nothing needs attention, say so in one point.',
  DATES,
];
const PAGES = {
  today: [
    "You help an obstetrician-gynaecologist in India who has just opened the Today page of the hospital's app. Below are the lists on that page.",
    "Say what is most important to look at first: urgent red flags and lab results outside range, notes waiting for the doctor's confirmation, patients who have arrived and are waiting, then overdue care-plan items, missed visits and patients in hospital.",
    ...LABEL_RULES,
  ],
  calendar: [
    "You help an obstetrician-gynaecologist in India looking at the hospital's calendar for the dates below.",
    'Say what is most important to look at in these dates: expected deliveries (EDD) – especially of high-risk patients –, booked visits with no visit recorded (to call), overdue care-plan visits, bookings for today, and the busiest days to prepare for.',
    ...LABEL_RULES,
  ],
  patient: [
    "You help an obstetrician-gynaecologist in India who has opened one patient's page in the hospital's app. From the record below, write 3 to 6 short points on what is most important to look at on this page now:",
    'red flags and abnormal or worsening values, lab results waiting for review or outside range, overdue or due care-plan items, the risk level and why, medicines and allergies when they matter, and what is planned next.',
    'Set first=true only for points that need attention today. Use only what is in the record – do not invent values or diagnoses, and do not give treatment orders.',
    'In "missing", list important things not recorded (e.g. no Hb this trimester). Plain English, no markdown, each point under 30 words.',
    DATES,
  ],
};

/** The instructions for a page ('today' | 'calendar' | 'patient'), ending with the PCPNDT rule. */
export const briefInstructions = (page, pcpndtRule) => [...PAGES[page], pcpndtRule].join(' ');

const LABEL = /\[(P\d+)\]/g;

/**
 * The AI's points, checked: at most MAX_POINTS; with labels (Today, calendar) a label written without brackets is
 * put in them, and a point naming a label that is not on the page is dropped (the AI made it up).
 * pcpndt: when true, an answer speaking of the baby's sex is withheld (422), as for every AI answer in a pregnancy.
 * Returns { points: [{ text, first }], patients: { P3: { id, fullName, mrn } } } – only the patients named.
 */
export function finishBrief(answer, labels = null, { pcpndt = true } = {}) {
  const known = new Map((labels?.entries() ?? []).map((e) => [e.label, e.patient]));
  const patients = {};
  const points = [];
  for (const p of answer?.points ?? []) {
    let text = String(p?.text ?? '')
      .replace(/\*\*/g, '')
      .trim();
    if (!text) continue;
    if (known.size) text = text.replace(/(?<!\[)\b(P\d+)\b(?!\])/g, (m, label) => (known.has(label) ? `[${label}]` : m));
    const used = [...text.matchAll(LABEL)].map((m) => m[1]);
    if (used.some((label) => !known.has(label))) continue;
    for (const label of used) patients[label] = known.get(label);
    points.push({ text, first: p.first === true });
    if (points.length === MAX_POINTS) break;
  }
  if (pcpndt && points.some((p) => mentionsFetalSex(p.text))) throw new HttpError(422, `The AI answer was withheld: ${PCPNDT_MESSAGE}`, 'AI_DECLINED');
  return { points, patients };
}
