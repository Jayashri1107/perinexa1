// The copy of a patient's whole record in words (More → "Copy of the whole record"): what the server sends
// (GET /api/patients/:id/record-copy) turned into headings, label-and-value rows and table rows for the printout
// (RecordCopy.jsx). Plain functions, so they can be tested without a browser. The server decides what a copy
// holds (server/src/patients/recordCopyView.js); nothing is added or worked out here beyond wording.
import { formatDate, formatDateTime } from '../../components/ui.jsx';
import { STATUS_LOOK, VISIT_TYPE_LABELS, whenLabel } from '../appointments/appointmentFormat.js';
import { DOCTOR_CONFIRMS, DELIVERY_MODE_LABELS, KIND_LABELS, vitalsLine } from '../inpatient/inpatientFormat.js';
import { FLAG_LOOK, ORDER_STATUS, resultLine } from '../lab/labFormat.js';
import { instructionLine, medicineName, pregnancyCheckText, vitalsText } from '../visits/rxFormat.js';
import {
  ANTI_D,
  ECTOPIC_SITES,
  HISTOLOGY,
  LOSS_LABELS,
  MANAGEMENT,
  MOLE_KINDS,
  OUTCOME_LABELS,
  currentLossFindings,
  gaText as lossWeeks,
  lossFindingByText,
  lossFindingLabel,
  lossFindingText,
  pastLossFindings,
} from './abortionFormat.js';
import { CLOSE_REASONS, approvalText, basisText, gaText, isAntenatalPlan, planTitle } from './carePlanFormat.js';
import { DEATH_PLACES, DEATH_TIMINGS, ageText as ageAtDeathText } from './deathFormat.js';
import {
  BREASTFEEDING_LABELS,
  CARE_TYPE_LABELS,
  CARE_TYPE_SHORT,
  CONDITION_LABELS,
  FEEDING_AT_DISCHARGE_LABELS,
  NEWBORN_SEX_LABELS,
  PAST_COMPLICATION_LABELS,
  PREGNANCY_FINDING_LABELS,
  bmi,
  currentFindings,
  formatGestation,
  formatGpla,
  isFirstPregnancy,
  newbornAge,
  nicuStayText,
  pastFindings,
  readingRows,
} from './patientFormat.js';
import { NOT_CHECKED_YET, RISK_LABELS, findingsNotCheckedText, noReasonText, notMeasuredText, readingsNotCheckedText } from './riskFormat.js';

export const COPY_TITLE = 'Copy of the whole record';
/** The last line of every page (with the hospital, the patient number and who printed it when). */
export const COPY_CONFIDENTIAL = 'Copy of the record – confidential';
const NOT_RECORDED = 'Not recorded';

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
/** Only the rows that have something to say. */
const filled = (rows) => rows.filter(([, value]) => has(value));
const by = (name) => (name ? ` by ${name}` : '');
const stampText = (s) => (s?.at ? `${formatDateTime(s.at)}${by(s.byName)}` : (s?.byName ?? ''));
/**
 * The day of a moment – a delivery, a printout, a change made by someone – in this computer's time, as
 * formatDateTime writes it. formatDate is only for days without a time (LMP, EDD, the day of a visit: stored as
 * midnight UTC); for a moment it would give the day before when it was after midnight in India.
 */
export const dayOf = (value) => formatDateTime(value).split(',')[0];

/** The PDF's name: the patient number and the day – never her name (it shows in download lists). */
export const copyFileName = (copy) => `Record copy ${copy.patient.mrn} ${formatDate(copy.today)}.pdf`;

/** The age on the day of the copy: "28 yrs", or "12 days old" for a baby (a baby who died: the age at death). */
export function copyAge(copy) {
  const p = copy.patient;
  if (p.careType === 'newborn' && p.death) return p.death.ageDays == null ? 'Age at death not known' : `Died ${p.death.ageDays === 0 ? 'on the day of birth' : `aged ${ageAtDeathText(p.death.ageDays)}`}`;
  if (p.careType === 'newborn') return newbornAge(p.newborn?.birthAt, new Date(copy.madeAt));
  return p.currentAge != null ? `${p.currentAge} yrs` : '—';
}

/**
 * The page footer: the hospital, the patient number (never the name – a loose page must not name her), when it was
 * printed and by whom, and that it is a confidential copy. Two parts, left and right.
 */
export function copyFooter({ hospital, mrn, printedAt, printedByName }) {
  return [`${hospital} · Patient no. ${mrn} · ${COPY_CONFIDENTIAL}`, `Printed ${formatDateTime(printedAt)}${by(printedByName)}`];
}

// ---------- The parts the copy could not hold, and what it never holds ----------

const CUT_WORDS = {
  visits: 'visits',
  labOrders: 'lab orders',
  stays: 'stays in hospital',
  documents: 'inpatient documents',
  nursing: 'nursing chart entries',
  consents: 'consent forms and information given',
  appointments: 'appointments',
  workDone: 'scans and procedures',
  notes: 'emergency treatment notes',
  carePlans: 'care plans',
};
/** A warning when a part of the record was too long for one copy (null when the copy is complete). */
export function cutWarning(copy) {
  const parts = (copy.cut ?? []).map((k) => CUT_WORDS[k] ?? k);
  if (!parts.length) return null;
  return `This copy is not complete: the record has more ${parts.join(', ')} than one copy can hold, and only the newest are here. Ask the person who looks after Perinexa for the rest.`;
}

/** What a copy never holds, said on the copy itself so nobody takes it for more than it is. */
export function notInCopy(copy) {
  const p = copy.patient;
  const baby = p.careType === 'newborn';
  return [
    'The doctor’s private notes of a visit. They are never printed.',
    'What was written in a visit, a document or a chart entry that was marked “entered in error”, and in a lab order that was cancelled. They are listed, without their content.',
    'Inpatient documents that are not signed yet. They are listed as drafts.',
    'Lab values that the lab has not reported yet, and the report files and scanned papers attached in Perinexa. Ask for those separately.',
    'What was typed into a consent form. The signed paper is the record; only its title and dates are listed.',
    'Bills, payments and pharmacy invoices, and the reminder messages that were sent.',
    // (only when there is one: a copy for a woman after a pregnancy loss must not speak of babies she does not have)
    ...(baby && p.motherMrn ? ['The mother’s record. It is a separate record, named here by its patient number only.'] : []),
    ...(!baby && p.babyMrns?.length
      ? [p.babyMrns.length === 1 ? 'The record of her baby. The baby has a record of its own, named here by its patient number only.' : 'The records of her babies. Each baby has a record of its own, named here by its patient number only.']
      : []),
    ...(p.earlierRecordMrns?.length || p.duplicateOf ? ['Another record of the same person in this hospital. It is named here by its patient number only – make a copy from that record too.'] : []),
  ];
}

// ---------- The patient's own details ----------

const LANGUAGES = { en: 'English', mr: 'Marathi', hi: 'Hindi' };

export function identityRows(copy) {
  const p = copy.patient;
  const r = p.reminders;
  return filled([
    ['Name', p.fullName],
    ['Patient no.', p.mrn],
    ['Age', copyAge(copy)],
    ['Type of care', CARE_TYPE_LABELS[p.careType] ?? p.careType],
    ['Phone', p.phone || NOT_RECORDED],
    ['Address', p.address || NOT_RECORDED],
    ['Doctor', p.assignedDoctorName ?? 'Not assigned'],
    ['Registered', p.registeredAt ? `${formatDateTime(p.registeredAt)}${by(p.registeredByName)}` : ''],
    ['ABHA', p.abha ? `${p.abha.masked} (partly hidden)` : ''],
    ['Automatic reminders', r ? `${r.consent ? `Agreed – ${r.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}, ${LANGUAGES[r.language] ?? 'English'}` : 'Not agreed'}${r.at ? ` (recorded ${dayOf(r.at)}${by(r.byName)})` : ''}` : ''],
    [
      'This record',
      p.duplicateOf
        ? `Marked as a duplicate of ${p.duplicateOf.mrn}${by(p.duplicateOf.byName)}${p.duplicateOf.at ? ` on ${dayOf(p.duplicateOf.at)}` : ''}${p.duplicateOf.reason ? `: ${p.duplicateOf.reason}` : ''}. The main record is ${p.duplicateOf.mrn}; this copy has only what is on this record.`
        : '',
    ],
    [p.earlierRecordMrns?.length === 1 ? 'Earlier record' : 'Earlier records', p.earlierRecordMrns?.length ? `${p.earlierRecordMrns.join(', ')} – kept separately; not in this copy.` : ''],
  ]);
}

export function medicalRows(copy) {
  const p = copy.patient;
  const m = p.medical ?? {};
  const conditions = [...(m.conditions ?? []).map((c) => CONDITION_LABELS[c] ?? c), m.otherConditions].filter(Boolean).join(', ');
  if (p.careType === 'newborn') {
    return filled([
      ['Blood group', m.bloodGroup || NOT_RECORDED],
      ['Conditions', conditions],
      ['Allergies', m.allergies?.trim() ?? ''],
      ['Notes on the record', p.notes],
    ]);
  }
  return filled([
    ['Blood group', m.bloodGroup || NOT_RECORDED],
    ['Height', m.heightCm ? `${m.heightCm} cm` : ''],
    ['Weight', m.weightKg ? `${m.weightKg} kg` : ''],
    ['BMI', bmi(m) ?? ''],
    ['Conditions', conditions || (m.conditionsReviewed ? 'None known (confirmed)' : NOT_RECORDED)],
    ['Allergies', m.allergies?.trim() || NOT_RECORDED],
    ['Notes on the record', p.notes],
  ]);
}

/** Obstetric history (not for a baby). The babies registered here are named by patient number only. */
export function obstetricRows(copy) {
  const p = copy.patient;
  const o = p.obstetric;
  if (!o) return [];
  return filled([
    ['Summary', formatGpla(o)],
    ['Previous caesareans', o.previousCaesareans ?? ''],
    [
      'Problems in previous pregnancies',
      o.pastComplications?.length
        ? o.pastComplications.map((c) => PAST_COMPLICATION_LABELS[c] ?? c).join(', ')
        : isFirstPregnancy(p.careType, o)
          ? 'None (first pregnancy)'
          : o.complicationsReviewed
            ? 'None (confirmed)'
            : NOT_RECORDED,
    ],
    [p.babyMrns?.length === 1 ? 'Baby registered here' : 'Babies registered here', p.babyMrns?.length ? `${p.babyMrns.join(', ')} – each baby has a record of its own.` : ''],
  ]);
}

/** The pregnancy on the record: its dates, the findings ticked for it and the readings the risk rules use. */
export function pregnancyRows(copy) {
  const p = copy.patient;
  const g = p.pregnancy;
  if (!g) return [];
  const current = currentFindings(p).map((f) => `${PREGNANCY_FINDING_LABELS[f.key] ?? f.key} – ${f.byName ?? 'staff'}, ${dayOf(f.at)}${f.via === 'visit' ? ' (confirmed at a visit)' : ''}`);
  const earlier = pastFindings(p, dayOf).map((f) => `${f.label} – ${f.text}`);
  return filled([
    ['Weeks on the day of this copy', p.gestationalAge ? formatGestation(p.gestationalAge) : ''],
    ['EDD', g.effectiveEdd ? `${formatDate(g.effectiveEdd)}${g.scanEdd ? ' (from scan)' : ' (from LMP)'}` : ''],
    ['LMP', g.lmp ? formatDate(g.lmp) : ''],
    ['EDD from LMP', g.scanEdd && g.edd ? formatDate(g.edd) : ''],
    ['Findings in this pregnancy', p.careType === 'antenatal' ? current.join('\n') || 'None recorded' : current.join('\n')],
    ['Earlier entries of findings', earlier.join('\n')],
    ...readingRows(p, formatDate),
  ]);
}

/**
 * The risk level with its reasons – and, as on the risk card, everything the level did not count: findings and
 * readings the hospital's rules have no rule for and conditions typed as free text ("Doctor to assess"), readings
 * not measured yet, an override whose automatic result has changed since, what the automatic check never looks at,
 * and whether the rules were approved by a doctor (a draft is said). A copy that leaves the hospital must not look
 * more complete than the screen it came from.
 */
export function riskRows(copy) {
  const p = copy.patient;
  const r = p.risk;
  if (!r) return [];
  const o = r.override;
  const level = RISK_LABELS[r.level] ?? r.level;
  const earlier = (p.riskOverrideHistory ?? [])
    .filter((h) => h.endedAt)
    .map((h) => `${RISK_LABELS[h.level] ?? h.level} – set${by(h.byName)} on ${dayOf(h.at)}: ${h.reason} (${h.endedBecause === 'replaced' ? 'replaced' : 'removed'}${by(h.endedByName)} on ${dayOf(h.endedAt)})`);
  const rules = r.templateName ? `“${r.templateName}”${r.templateVersion ? ` version ${r.templateVersion}` : ''}` : 'the hospital’s risk rules';
  const changed = o?.computedLevelAtOverride && o.computedLevelAtOverride !== r.computedLevel ? ` (was ${RISK_LABELS[o.computedLevelAtOverride] ?? o.computedLevelAtOverride}, now ${RISK_LABELS[r.computedLevel] ?? r.computedLevel})` : '';
  const listed = (t) => (t ? `${t.list} – ${t.rest}` : null);
  const notMeasured = notMeasuredText(r);
  const otherConditions = p.medical?.otherConditions?.trim();
  const toAssess = [
    listed(findingsNotCheckedText(r)),
    listed(readingsNotCheckedText(r, p.pregnancy?.readings)),
    r.freeTextNotChecked && otherConditions ? `“${otherConditions}” – typed as free text, not checked automatically.` : null,
  ].filter(Boolean);
  return filled([
    ['Level', o ? `${level} – set${by(o.byName)} on ${dayOf(o.at)}: ${o.reason}` : level],
    ['Automatic result', o ? (RISK_LABELS[r.computedLevel] ?? r.computedLevel ?? '') : ''],
    ['To be reviewed', o && r.overrideNeedsReview ? `The automatic result has changed since this override${changed}. A doctor has not reviewed the override since.` : ''],
    ['Reasons', r.reasons?.length ? r.reasons.map((x) => `${x.label}${x.level && x.level !== r.computedLevel ? ` (${RISK_LABELS[x.level] ?? x.level})` : ''}`).join('\n') : noReasonText(r)],
    [r.mayBeHigher ? 'May be higher – still to record' : 'Still to record', (r.missing ?? []).join(' · ')],
    // (noReasonText points here: "See “Doctor to assess” below.")
    ['Doctor to assess', toAssess.join('\n')],
    ['Not measured yet in this pregnancy', notMeasured ? `${notMeasured.list}. ${notMeasured.rest}` : ''],
    ['Rules used', r.templateApproved ? `${rules}, approved by a doctor.` : `${rules} – DRAFT rules that no doctor has approved yet. A reminder only; the treating doctor decides.`],
    ['What the automatic check does not see', NOT_CHECKED_YET],
    ['Earlier levels set by a doctor', earlier.join('\n')],
  ]);
}

/** Pregnancy loss (the Abortion type of care; never an induced termination – that is not recorded in Perinexa). */
export function lossRows(copy) {
  const a = copy.patient.abortion;
  if (!a) return [];
  const m = a.management ?? {};
  const weeks = a.lmp && a.presentedOn ? lossWeeks(a.lmp, a.presentedOn) : a.weeks != null ? `${a.weeks} w ${a.days ?? 0} d` : '';
  const pregnant = a.lossType !== 'recurrent';
  return filled([
    ['Type of loss', LOSS_LABELS[a.lossType] ?? NOT_RECORDED],
    ['Site', a.lossType === 'ectopic' ? (ECTOPIC_SITES[a.ectopicSite] ?? '') : ''],
    ['Kind of mole', a.lossType === 'molar' ? (MOLE_KINDS[a.moleKind] ?? '') : ''],
    ['Date seen', a.presentedOn ? formatDate(a.presentedOn) : ''],
    ['LMP', pregnant && a.lmp ? formatDate(a.lmp) : ''],
    ['Weeks at presentation', pregnant ? (weeks ?? '') : ''],
    ['Management', m.method ? `${MANAGEMENT[m.method] ?? m.method}${m.on ? ` · ${formatDate(m.on)}` : ''}` : ''],
    ['Outcome', OUTCOME_LABELS[m.outcome] ?? ''],
    ['Histology', a.lossType === 'molar' ? [HISTOLOGY[a.histology?.status], a.histology?.result].filter(Boolean).join(' · ') : ''],
    ['Anti-D', pregnant && a.antiD?.status ? `${ANTI_D[a.antiD.status] ?? a.antiD.status}${a.antiD.on ? ` · ${formatDate(a.antiD.on)}` : ''}` : ''],
    ['Note', a.note],
    // Each finding with who recorded it and the hospital's day (the server's `on`); then the earlier entries – replaced,
    // cleared, or of an earlier loss on this record
    ['Findings', currentLossFindings(a).map((f) => `${lossFindingLabel(f.key)}: ${lossFindingText(f.key, f.value)} – ${lossFindingByText(f, formatDate)}`).join('\n')],
    ['Earlier entries of findings', pastLossFindings(a, formatDate).map((f) => `${f.label} – ${f.text}`).join('\n')],
  ]);
}

/** The delivery on the record and breastfeeding (a mother after delivery). */
export function deliveryRows(copy) {
  const p = copy.patient;
  const d = p.lastDelivery;
  return filled([
    // (the time only when it is known: from the delivery note a doctor confirmed; a day typed on the record has none)
    ['Delivered', d?.at ? `${d.timeKnown ? formatDateTime(d.at) : formatDate(d.at)}${d.mode ? ` – ${DELIVERY_MODE_LABELS[d.mode] ?? d.mode}` : ''}` : ''],
    ['Breastfeeding', p.postnatal?.breastfeeding ? BREASTFEEDING_LABELS[p.postnatal.breastfeeding] : p.careType === 'postnatal' ? NOT_RECORDED : ''],
  ]);
}

/** A baby's birth details; the mother by her patient number only (her data is on her own record). */
export function birthRows(copy) {
  const p = copy.patient;
  const n = p.newborn;
  if (!n) return [];
  return [
    ['Born', n.birthAt ? formatDateTime(n.birthAt) : NOT_RECORDED],
    ['Birth weight', n.birthWeightGrams ? `${n.birthWeightGrams} g` : NOT_RECORDED],
    ['Sex', NEWBORN_SEX_LABELS[n.sex] ?? NOT_RECORDED],
    ['Mother', p.motherMrn ? `Patient no. ${p.motherMrn} – her record is separate; not in this copy.` : 'Not linked to a mother’s record'],
    // The baby's care after birth (5 Oct 2026)
    ['NICU or SNCU', nicuStayText(p.newbornCare?.nicu, formatDate)],
    ['Feeding at discharge', FEEDING_AT_DISCHARGE_LABELS[p.newbornCare?.feedingAtDischarge ?? ''] ?? NOT_RECORDED],
  ];
}

/**
 * The death a doctor recorded on the record (the record is closed), and any death recorded in error and undone –
 * listed with who recorded and who undid it, without its date or reason (like anything entered in error).
 */
export function deathRows(copy) {
  const p = copy.patient;
  const d = p.death;
  const baby = p.careType === 'newborn';
  const undone = (p.deathsUndone ?? []).map((h) => `A death was recorded${by(h.byName)} on ${dayOf(h.at)} and undone as recorded in error${by(h.undoneByName)} on ${dayOf(h.undoneAt)}.`);
  return filled([
    ['Died on', d ? formatDate(d.on) : ''],
    ['Age at death', d && baby ? (d.ageDays == null ? 'Not known (no time of birth on the record)' : ageAtDeathText(d.ageDays)) : ''],
    ['Place', d && baby ? (DEATH_PLACES[d.place] ?? '') : ''],
    ['When', d && !baby ? (DEATH_TIMINGS[d.timing] ?? '') : ''],
    ['Recorded', d ? stampText({ byName: d.byName, at: d.at }) : ''],
    ['This record', d ? 'Closed when the death was recorded.' : ''],
    ['Recorded in error and undone', undone.join('\n')],
  ]);
}

// ---------- Visits ----------

const ROLE_WORDS = { doctor: 'doctor', rmo: 'RMO' };
const errorText = (what, e) => `${what} was marked as entered in error${e?.byName ? ` by ${e.byName}` : ''}${e?.at ? ` on ${formatDateTime(e.at)}` : ''}. Its content is not part of the record and is not copied.`;
const medicineLine = (it, i) => `${i + 1}. ${medicineName(it)} – ${instructionLine(it)}${it.instructions ? ` (${it.instructions})` : ''}`;

/**
 * One visit: { key, title, status, error, rows, additions }. A visit entered in error has only its day and the
 * `error` sentence.
 */
export function visitBlock(v) {
  if (v.status !== 'active') return { key: v.id, title: formatDate(v.visitOn), status: 'Entered in error', error: errorText('This visit', v.enteredInError), rows: [], additions: [] };
  const d = v.details ?? {};
  const rx = v.prescription ?? {};
  const wrote = [v.vitals?.byName && `vital signs – ${v.vitals.byName}`, d.byName && `notes – ${d.byName}`, rx.byName && rx.items?.length && `prescription – ${rx.byName}`].filter(Boolean);
  return {
    key: v.id,
    title: `${formatDate(v.visitOn)} · ${CARE_TYPE_SHORT[v.careType] ?? 'Visit'} visit`,
    status: v.signed ? `Signed by ${v.signed.byName} (${ROLE_WORDS[v.signed.role] ?? v.signed.role}) on ${formatDateTime(v.signed.at)}` : 'Not signed',
    error: null,
    rows: filled([
      ['Vital signs', vitalsText(v.vitals)],
      ['Complaints', d.complaints],
      ['Pregnancy check', pregnancyCheckText(d)],
      ['Examination', d.examination],
      ['Diagnosis', d.diagnosis],
      ['Tests advised', d.investigations],
      ['Advice', d.advice],
      ['Next visit', d.nextVisitOn ? `${formatDate(d.nextVisitOn)}${d.nextVisitNote ? ` – ${d.nextVisitNote}` : ''}` : ''],
      ['Medicines', (rx.items ?? []).map(medicineLine).join('\n')],
      ['Instructions with the medicines', rx.notes],
      ['Written by', wrote.join(' · ')],
    ]),
    additions: (v.additions ?? []).map((x) => ({ key: x.id, text: x.text, by: `${x.byName}, ${formatDateTime(x.at)}` })),
  };
}

// ---------- Lab ----------

const REPORTED = ['reported', 'reviewed'];
const resultsOf = (tests, catalogue) => (tests ?? []).map((t) => [t.name, resultLine(t, catalogue) || 'See the lab report']);

/** One lab order: { key, title, status, error, rows }. */
export function labBlock(o, catalogue) {
  const title = o.ordered?.at ? `Ordered ${formatDateTime(o.ordered.at)}${by(o.ordered.byName)}` : 'Lab order';
  if (o.status === 'cancelled') {
    return { key: o.id, title, status: 'Cancelled', error: `This order was cancelled${by(o.cancelled?.byName)}${o.cancelled?.at ? ` on ${formatDateTime(o.cancelled.at)}` : ''} and not carried out. Its tests are not copied.`, rows: [] };
  }
  const reported = REPORTED.includes(o.status);
  const rows = [
    ['Test packages', (o.packages ?? []).join('; ')],
    ['Note to the lab', o.noteToLab],
    ...(reported ? resultsOf(o.tests, catalogue) : [['Tests', (o.tests ?? []).map((t) => t.name).join(', ')]]),
    ['Lab remark', o.labNote],
    // (results reported without "sample collected" first: the sample's time is not known)
    ['Sample taken', reported && !o.collected ? 'Not recorded – the results were entered without it.' : stampText(o.collected)],
    ['Reported', reported ? stampText(o.reported) : 'The lab has not reported the results yet.'],
    ['Doctor’s review', o.reviewed ? `${stampText(o.reviewed)}${o.reviewed.comment ? `: ${o.reviewed.comment}` : ''}` : reported ? 'Not reviewed by a doctor yet.' : ''],
    ...(o.amendments ?? []).map((m) => [
      'Changed after the report',
      `${stampText(m)}: ${m.reason || 'no reason given'}. Before the change: ${resultsOf(m.tests, catalogue).map(([name, line]) => `${name} – ${line}`).join('; ')}${m.labNote ? `; lab remark: ${m.labNote}` : ''}${m.reviewedByName ? ` (reviewed by ${m.reviewedByName})` : ''}.`,
    ]),
    ['Report files', o.files ? `${o.files} attached in Perinexa – not in this copy.` : ''],
  ];
  return { key: o.id, title, status: `${ORDER_STATUS[o.status]?.word ?? o.status}${o.urgent ? ' · urgent' : ''}`, error: null, rows: filled(rows) };
}

const flaggedTest = (t) => (t.values ?? []).some((v) => FLAG_LOOK[v.flag]);
/**
 * Under the lab results when one of them is marked Low, High or Abnormal: the marks come from Perinexa's DRAFT
 * lists, so a copy that leaves the hospital says so – and names the right list. A baby's record has only the
 * newborn tests (server/src/lab/newbornTests.js: DRAFT newborn values from published guidance, not reviewed by a
 * paediatrician, many depending on the age in hours); everyone else's the usual adult values (labTests.js).
 * null when nothing is marked.
 */
export function labFlagNote(copy) {
  const flagged = (copy.labOrders ?? []).some((o) => REPORTED.includes(o.status) && [...(o.tests ?? []), ...(o.amendments ?? []).flatMap((m) => m.tests ?? [])].some(flaggedTest));
  if (!flagged) return null;
  return copy.patient?.careType === 'newborn'
    ? 'Low, High and Abnormal only draw attention. Perinexa suggests them from a DRAFT list of newborn values taken from published guidance (NNF India, AAP), not reviewed by a paediatrician, and the lab may change them. Many newborn values depend on the baby’s age in hours. The lab’s own report and the treating doctor decide.'
    : 'Low, High and Abnormal only draw attention. Perinexa suggests them from a DRAFT list of usual adult values, and the lab may change them; the lab’s own report and the treating doctor decide.';
}

// ---------- Scans and procedures, emergency notes ----------

const WORK_GROUPS = { scan: 'Scan', procedure: 'Procedure' };
/** Table rows [day, kind, what, by whom]. One entered in error has no name. */
export const workRows = (work) =>
  (work ?? []).map((w) => ({
    key: w.id,
    cells: [formatDate(w.on), WORK_GROUPS[w.group] ?? w.group, w.enteredInError ? `Entered in error${w.enteredInError.byName ? ` (marked by ${w.enteredInError.byName})` : ''} – not copied` : w.name, w.enteredInError ? '' : w.doneByName],
  }));

/** An emergency treatment note by a doctor who is not her doctor. */
export const noteBlock = (n) => ({ key: n.id, title: `${formatDateTime(n.at)}${by(n.byName)}`, rows: filled([['Reason', n.reason], ['Treatment given', n.text]]) });

// ---------- Stays in hospital ----------

/** A stay's heading and facts. */
export function stayBlock(s) {
  return {
    key: s.id,
    title: `Admitted ${formatDateTime(s.admittedAt)}${s.dischargedAt ? ` · discharged ${formatDateTime(s.dischargedAt)}` : ' · in hospital on the day of this copy'}`,
    rows: filled([
      ['Ward and bed', [s.ward, s.bed && `Bed ${s.bed}`].filter(Boolean).join(' · ')],
      ['Reason for admission', s.reason],
      ['Admitted by', s.admittedByName],
      ['Discharge confirmed by', s.dischargedByName],
    ]),
  };
}

/** One inpatient document's heading: { key, title, status, error, signedContent } (the content only when signed). */
export function documentBlock(d) {
  const name = KIND_LABELS[d.kind] ?? d.kind;
  const confirms = DOCTOR_CONFIRMS.includes(d.kind);
  if (d.status === 'cancelled') return { key: d.id, title: name, status: 'Entered in error', error: errorText(`This ${name.toLowerCase()}`, d.enteredInError), signedContent: false };
  if (d.status !== 'signed') {
    return { key: d.id, title: name, status: 'Draft', error: `A draft started ${formatDateTime(d.at)}${by(d.createdByName)}, not ${confirms ? 'confirmed by a doctor' : 'signed'} yet. It is not part of the record until then and is not copied.`, signedContent: false };
  }
  return {
    key: d.id,
    title: `${name} · ${formatDateTime(d.at)}`,
    status: `${confirms ? 'Confirmed' : 'Signed'} by ${d.signed?.byName ?? '—'} (${ROLE_WORDS[d.signed?.role] ?? d.signed?.role ?? 'doctor'}) on ${formatDateTime(d.signed?.at)}${d.createdByName && d.createdByName !== d.signed?.byName ? ` · written by ${d.createdByName}` : ''}`,
    error: null,
    signedContent: true,
  };
}

const NURSING_KINDS = { vitals: 'Vital signs', medicine: 'Medicine given', note: 'Note' };
/** The nursing chart as table rows [time, kind, what, by whom]. */
export const nursingRows = (entries) =>
  (entries ?? []).map((e) => {
    const what = e.enteredInError
      ? `Entered in error${e.enteredInError.byName ? ` (marked by ${e.enteredInError.byName})` : ''} – not copied`
      : [e.kind === 'vitals' ? vitalsLine(e.vitals) : '', e.kind === 'medicine' ? [e.medicine?.drug, e.medicine?.dose, e.medicine?.route].filter(Boolean).join(' · ') : '', e.note].filter(Boolean).join(' – ');
    return { key: e.id, cells: [formatDateTime(e.at), NURSING_KINDS[e.kind] ?? e.kind, what, e.enteredInError ? '' : (e.byName ?? '')] };
  });

// ---------- Care plans ----------

const PLAN_STATUS_WORDS = { active: 'In use', paused: 'Paused', closed: 'Closed' };
/** A care plan's heading and facts (its items are printed with the staff copy's table). */
export function planBlock(plan) {
  const t = plan.template ?? {};
  const approval = approvalText(t);
  const closed = plan.closed;
  return {
    key: plan.id,
    title: planTitle(plan),
    status: PLAN_STATUS_WORDS[plan.status] ?? plan.status,
    // A plan from content no doctor approved is a reminder only: said on the copy
    draft: approval && !t.approved ? `${approval.label}. ${approval.reason}` : null,
    rows: filled([
      ['Counted from', basisText(plan)],
      ['Booked', isAntenatalPlan(plan) && plan.bookedOn ? `${formatDate(plan.bookedOn)}${plan.bookedAt ? ` at ${gaText(plan.bookedAt)}` : ''}` : ''],
      ['Plan used', t.name ? `${t.name} – version ${t.version} · ${approval?.word ?? ''}` : ''],
      ['Closed', closed ? `${dayOf(closed.at)}${by(closed.byName)} – ${CLOSE_REASONS[closed.reason] ?? closed.reason}${closed.note ? `: ${closed.note}` : ''}` : ''],
      ['Statuses as of', formatDate(plan.today)],
    ]),
  };
}

// ---------- Consent forms and information given, appointments ----------

/** Table rows [printed, kind, title, signed]. Titles and dates only. */
export const consentRows = (consents) =>
  (consents ?? []).map((c) => ({
    key: c.id,
    cells: [dayOf(c.printedAt), c.kind === 'information' ? 'Information given' : 'Consent form', c.title, c.signedOn ? `Signed ${formatDate(c.signedOn)}` : 'Signed copy not recorded'],
  }));

/** Table rows [day, time or token, kind of visit, doctor, what became of it]. */
export const appointmentRows = (appointments) =>
  (appointments ?? []).map((a) => ({
    key: a.id,
    cells: [formatDate(`${a.date}T00:00:00Z`), whenLabel(a), VISIT_TYPE_LABELS[a.visitType] ?? a.visitType, a.doctorName ?? '', STATUS_LOOK[a.status]?.label ?? a.status],
  }));
