// What the AI is told about a patient: the clinical record as plain text, WITHOUT her name, phone, address
// or patient number. Free text typed by staff is also scrubbed of her name and of anything that looks like a
// phone number. The doctor's private notes are never sent.

import { gaOn, hospitalToday, toHospitalDate } from '../careplans/dates.js';
import { planCtx, reminderItems } from '../careplans/plansService.js';
import { currentAge } from '../models/Patient.js';
import { ANTI_D, ECTOPIC_SITES, HISTOLOGY, LOSS_FINDINGS, LOSS_LABELS, MANAGEMENT, MOLE_KINDS, OUTCOME_LABELS, lossFindingText } from '../patients/abortionRules.js';
import { currentLossFindings } from '../patients/lossFindings.js';
import { Visit } from '../models/Visit.js';
import { redFlagsForPatient } from '../redflags/redFlagService.js';
import { flagFromText } from '../redflags/redFlags.js';

const words = (code) => String(code ?? '').replace(/_/g, ' ');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ga = (edd, d) => {
  const g = edd && d ? gaOn(edd, d) : null;
  return g ? `${g.weeks}w ${g.days}d` : '';
};

/** Removes the patient's name (each part of 3+ letters) and phone-like numbers from typed text. */
export function scrub(text, patient) {
  let t = String(text ?? '');
  for (const part of String(patient.fullName ?? '').split(/\s+/).filter((p) => p.length >= 3)) {
    t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[patient]');
  }
  return t.replace(/\+?\d(?:[\s-]?\d){9,12}/g, '[number]').trim();
}

const line = (label, value) => (value === '' || value == null ? null : `${label}: ${value}`);

function visitText(v, edd, patient) {
  const vt = v.vitals ?? {};
  const d = v.details ?? {};
  const s = (x) => scrub(x, patient);
  const vitals = [
    vt.bpSystolic && vt.bpDiastolic ? `BP ${vt.bpSystolic}/${vt.bpDiastolic}` : null,
    vt.weightKg != null ? `weight ${vt.weightKg} kg` : null,
    vt.pulse != null ? `pulse ${vt.pulse}` : null,
    vt.temperatureF != null ? `temp ${vt.temperatureF} F` : null,
    vt.spo2 != null ? `SpO2 ${vt.spo2}%` : null,
    vt.hb != null ? `Hb ${vt.hb} g/dL` : null,
    vt.urineAlbumin ? `urine albumin ${vt.urineAlbumin}` : null,
    vt.urineSugar ? `urine sugar ${vt.urineSugar}` : null,
  ].filter(Boolean);
  const exam = [
    d.fundalHeightCm != null ? `fundal height ${d.fundalHeightCm} cm` : null,
    d.fetalHeartRate != null ? `FHR ${d.fetalHeartRate}` : null,
    d.presentation ? `presentation ${d.presentation}` : null,
    d.fetalMovements ? `fetal movements ${d.fetalMovements}` : null,
    d.oedema ? `oedema ${d.oedema}` : null,
  ].filter(Boolean);
  const meds = (v.prescription?.items ?? []).map((it) => [it.drug, it.strength, it.dose, it.frequencyText || it.frequency, it.durationValue ? `${it.durationValue} ${it.durationUnit}` : ''].filter(Boolean).join(' '));
  return [
    `Visit ${day(v.visitOn)}${edd ? ` (${ga(edd, v.visitOn)})` : ''}`,
    line('  Vitals', vitals.join(', ')),
    line('  Pregnancy check', exam.join(', ')),
    line('  Complaints', s(d.complaints)),
    line('  Examination', s(d.examination)),
    line('  Diagnosis', s(d.diagnosis)),
    line('  Tests advised', s(d.investigations)),
    line('  Advice', s(d.advice)),
    line('  Medicines', meds.join('; ')),
    line('  Next visit', day(d.nextVisitOn)),
  ]
    .filter(Boolean)
    .join('\n');
}

// The pregnancy loss in one line (never anything about the baby's sex: there is no such field). The histology
// result is typed text (checked for the baby's sex when saved), scrubbed of her name like any typed text.
function lossText(a, patient) {
  if (!a?.lossType) return 'Pregnancy loss: type not recorded yet';
  const m = a.management ?? {};
  const h = a.histology ?? {};
  const d = a.antiD ?? {};
  return `Pregnancy loss: ${[
    (LOSS_LABELS[a.lossType] ?? 'type not known').toLowerCase(), // includes an old threatened miscarriage
    a.ectopicSite ? `site: ${ECTOPIC_SITES[a.ectopicSite].toLowerCase()}` : null,
    a.moleKind ? MOLE_KINDS[a.moleKind].toLowerCase() : null,
    a.weeks != null ? `${a.weeks}w ${a.days ?? 0}d at presentation` : null,
    a.presentedOn ? `seen ${day(a.presentedOn)}` : null,
    m.method ? `management: ${MANAGEMENT[m.method].toLowerCase()}${m.on ? ` on ${day(m.on)}` : ''}` : null,
    m.outcome ? `outcome: ${(OUTCOME_LABELS[m.outcome] ?? m.outcome).toLowerCase()}` : null,
    h.status ? `histology: ${HISTOLOGY[h.status].toLowerCase()}${h.result ? ` (${scrub(h.result, patient)})` : ''}` : null,
    d.status ? `anti-D: ${ANTI_D[d.status].toLowerCase()}${d.status === 'given' && d.on ? ` on ${day(d.on)}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(', ')}`;
}

// The findings recorded on a pregnancy-loss record (fields with fixed answers – nothing typed, never a name): each
// with the hospital's day it was recorded (a moment, not a date: 01:00 in India is that day, not the UTC day before),
// so an older finding is not read as today's.
const FINDING_LABELS = Object.fromEntries(LOSS_FINDINGS.map((f) => [f.key, f.label]));
const lossFindingsText = (a) =>
  currentLossFindings(a)
    .map((f) => `${FINDING_LABELS[f.key].toLowerCase()}: ${lossFindingText(f.key, f.value).toLowerCase()}${f.at ? ` (recorded ${day(toHospitalDate(f.at))})` : ''}`)
    .join('; ');

/**
 * The record as text for the AI: facts, risk, red flags, care plan, and the latest visits (newest first).
 * visits: how many visits to include.
 */
export async function patientContext(req, patient, { visits: howMany = 5 } = {}) {
  const now = req.now ?? new Date();
  const today = hospitalToday(now);
  // EDD and weeks today only for a current pregnancy (antenatal): another type of care may keep old dates.
  const edd = patient.careType === 'antenatal' ? (patient.pregnancy?.effectiveEdd ?? null) : null;
  const o = patient.obstetric ?? {};
  const m = patient.medical ?? {};
  const ctx = planCtx(req);
  const [visits, plan, flags] = await Promise.all([
    Visit.find({ tenantId: req.tenantId, patientId: patient._id, status: 'active' }).sort({ visitOn: -1, createdAt: -1 }).limit(howMany).lean(),
    patient.careType === 'antenatal' ? reminderItems(ctx, patient).catch(() => null) : null,
    redFlagsForPatient(ctx, patient),
  ]);
  const r = patient.risk;
  const facts = [
    `Type of care: ${patient.careType === 'abortion' ? 'abortion (pregnancy loss)' : patient.careType}`,
    patient.careType === 'abortion' ? lossText(patient.abortion, patient) : null,
    patient.careType === 'abortion' ? line('Pregnancy loss findings (on her record)', lossFindingsText(patient.abortion)) : null,
    patient.careType === 'abortion' ? line('Pregnancy loss note (typed)', scrub(patient.abortion?.note, patient)) : null,
    line('Age', currentAge(patient, now)),
    line("Today's date", day(today)),
    edd ? `EDD: ${day(edd)} (${patient.pregnancy?.scanEdd ? 'from dating scan' : 'from LMP'}); weeks today: ${ga(edd, today)}` : null,
    patient.careType !== 'newborn'
      ? line('Obstetric history', [o.gravida != null && `G${o.gravida}`, o.para != null && `P${o.para}`, o.living != null && `L${o.living}`, o.abortions != null && `A${o.abortions}`].filter(Boolean).join(' '))
      : null,
    line('Previous caesareans', o.previousCaesareans),
    line('Problems in previous pregnancies', (o.pastComplications ?? []).map(words).join(', ')),
    line('Blood group', m.bloodGroup),
    line('Height / weight at booking', [m.heightCm && `${m.heightCm} cm`, m.weightKg && `${m.weightKg} kg`].filter(Boolean).join(', ')),
    line('Known conditions', (m.conditions ?? []).map(words).join(', ')),
    line('Other conditions (typed)', scrub(m.otherConditions, patient)),
    line('Allergies', scrub(m.allergies, patient)),
    r?.level ? `Risk level: ${r.level}${r.override ? ' (set by doctor)' : ''}${r.reasons?.length ? ` – ${r.reasons.map((x) => x.label).join('; ')}` : ''}` : null,
    // Flags from rules no doctor has approved yet are said to be so (as in the Today brief, ai/brief.js)
    flags?.flags?.length ? `Red flags${flags.rules?.status === 'draft' ? ' (from draft rules, not yet approved by a doctor – reminders only)' : ''}: ${flags.flags.map((f) => [`${f.label} [${f.level}] ${f.detail}`, flagFromText(f)].filter(Boolean).join(' – ')).join('; ')}` : null,
    plan?.overdue?.length ? `Care plan overdue: ${plan.overdue.map((i) => i.name).join('; ')}` : null,
    plan?.due?.length ? `Care plan due now: ${plan.due.map((i) => i.name).join('; ')}` : null,
    plan?.nextVisit ? `Next planned visit: ${plan.nextVisit.name} (${day(plan.nextVisit.dueFrom)} to ${day(plan.nextVisit.dueBy)})` : null,
    line('Notes (typed)', scrub(patient.notes, patient)),
  ].filter(Boolean);
  return [
    '## Record',
    ...facts,
    '',
    visits.length ? `## Latest ${visits.length} visit(s), newest first` : '## No visits recorded',
    ...visits.map((v) => visitText(v, edd, patient)),
  ].join('\n');
}
