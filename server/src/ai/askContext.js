// What the AI is told for "Ask AI" about one patient (docs/ASK_AI_PLAN.md): the record as the other AI features send
// it (ai/context.js – never her name, phone, address or patient number; typed text scrubbed; never private notes),
// plus her lab results, signed scan reports (perinexa1's Imaging module – routes/imaging.js), hospital stays with confirmed discharge cards, and referrals.
// Never HIV (the HIV and AIDS Act 2017): the HIV test and any line naming it are left out, as in the AI brief.
// Nothing about the baby's sex is ever stored, and typed text was checked for it when it was saved.

import { addDays, hospitalDayStart, hospitalToday, isoDay, toHospitalDate } from '../careplans/dates.js';
import { isAbnormal, testByKey } from '../lab/labTests.js';
import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { LabOrder } from '../models/LabOrder.js';
import { Referral } from '../models/Referral.js';
import { ImagingOrder } from '../models/ImagingOrder.js';
import { reasonByKey } from '../referrals/reasons.js';
import { studyByKey } from '../imaging/templates.js';
import { mentionsHiv, withoutHiv } from './brief.js';
import { patientContext, scrub } from './context.js';

const LOOK_BACK_DAYS = 400; // a pregnancy and the months around it
const day = (instant) => (instant ? isoDay(toHospitalDate(instant)) : '');
// Long typed text is shortened, and says so (the AI is told such text may say more)
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)} … (shortened)` : text);
const hivTest = (t) => mentionsHiv(t?.key) || mentionsHiv(t?.name);

/** A lab order's values (never typed result text, never HIV): "Haemoglobin 8.9 g/dL (low)". */
function labLine(o) {
  const parts = [];
  for (const t of o.tests ?? []) {
    if (hivTest(t)) continue;
    const def = testByKey.get(t.key);
    const values = (t.values ?? [])
      .map((v) => ({ v, f: def?.fields?.find((x) => x.key === v.key) }))
      // Typed results (an organism, Pap details) are not sent: lab staff type them freely
      .filter(({ v, f }) => v.value !== '' && v.value != null && f?.type !== 'text')
      .map(({ v, f }) => {
        return `${f?.name ?? v.key} ${v.value}${f?.unit ? ` ${f.unit}` : ''}${isAbnormal(v.flag) ? ` (${v.flag})` : ''}`;
      });
    if (values.length) parts.push(`${t.name}: ${values.join(', ')}`);
  }
  if (!parts.length) return null;
  return `Lab ${day(o.collected?.at ?? o.reported?.at)} (${o.status === 'reviewed' ? 'reviewed by a doctor' : 'reported, not yet reviewed'}): ${parts.join('; ')}`;
}

/** The record text for Ask AI (HIV taken out of every line). */
export async function askRecordText(req, patient) {
  const now = req.now ?? new Date();
  const since = hospitalDayStart(addDays(hospitalToday(now), -LOOK_BACK_DAYS));
  const base = { tenantId: req.tenantId, patientId: patient._id };
  const [record, orders, scans, stays, referrals] = await Promise.all([
    patientContext(req, patient, { visits: 10 }),
    LabOrder.find({ ...base, status: { $in: ['reported', 'reviewed'] }, 'reported.at': { $gte: since } }, { tests: 1, status: 1, collected: 1, reported: 1 })
      .sort({ 'reported.at': -1 })
      .limit(30)
      .lean(),
    ImagingOrder.find({ ...base, status: 'signed', 'signed.at': { $gte: since } }, { study: 1, done: 1, signed: 1, report: 1 })
      .sort({ 'signed.at': -1 })
      .limit(10)
      .lean(),
    Admission.find({ ...base, admittedAt: { $gte: since } }, { admittedAt: 1, reason: 1, status: 1, dischargedAt: 1 })
      .sort({ admittedAt: -1 })
      .limit(5)
      .lean(),
    Referral.find({ ...base, status: { $ne: 'cancelled' }, receivedAt: { $gte: since } }, { number: 1, receivedAt: 1, reasons: 1, otherReason: 1, question: 1, note: 1 })
      .sort({ receivedAt: -1 })
      .limit(5)
      .lean(),
  ]);
  const cards = stays.length
    ? await ClinicalDocument.find({ tenantId: req.tenantId, admissionId: { $in: stays.map((s) => s._id) }, kind: 'discharge', status: 'signed' }, { admissionId: 1, content: 1, additions: 1 }).lean()
    : [];
  const cardOf = new Map(cards.map((c) => [String(c.admissionId), c]));
  const s = (text, max = 1000) => clip(scrub(text ?? '', patient), max);
  // One entry (a scan, a stay, a referral) as lines; an entry that names HIV anywhere is left out WHOLE, so no line of
  // it is read as part of the entry above
  const entry = (lines) => {
    const kept = lines.filter(Boolean);
    return kept.some((l) => mentionsHiv(l)) ? null : kept.join('\n');
  };
  const corrections = (list, word) => (list ?? []).map((x) => `  ${word} ${day(x.at)} (newer than the text above): ${s(x.text, 600)}`);

  const labs = orders.map(labLine).filter(Boolean);
  // A signed scan report as it stands now (a change after signing replaces the report; the earlier one is not sent)
  const scanLines = scans
    .map((o) => {
      const study = studyByKey.get(o.study);
      const values = o.report?.values ?? {};
      const measured = (study?.fields ?? [])
        .filter((f) => values[f.key] !== undefined && values[f.key] !== null && String(values[f.key]).trim() !== '')
        .map((f) => `${f.name} ${f.type === 'text' ? s(String(values[f.key]), 200) : values[f.key]}${f.unit ? ` ${f.unit}` : ''}`);
      return entry([
        `Scan ${day(o.done?.at ?? o.signed?.at)} – ${study?.name ?? o.study}`,
        measured.length ? `  Measurements: ${measured.join('; ')}` : null,
        o.report?.impression ? `  Impression: ${s(o.report.impression, 2000)}` : null,
        o.report?.findings ? `  Findings: ${s(o.report.findings, 2500)}` : null,
      ]);
    })
    .filter(Boolean);
  const stayLines = stays
    .map((a) => {
      const card = cardOf.get(String(a._id));
      const c = card?.content;
      const medicines = (c?.medicines ?? []).map((m) => [m.drug, m.strength, m.frequencyText || m.frequency].filter(Boolean).join(' ')).filter(Boolean);
      return entry([
        `Hospital stay from ${day(a.admittedAt)}${a.status === 'discharged' ? ` to ${day(a.dischargedAt)}` : ' (still in hospital)'}`,
        a.reason ? `  Admitted for: ${s(a.reason, 300)}` : null,
        c?.finalDiagnosis ? `  Discharge diagnosis: ${s(c.finalDiagnosis)}` : null,
        c?.procedures ? `  Procedures: ${s(c.procedures)}` : null,
        c?.conditionAtDischarge ? `  Condition at discharge: ${s(c.conditionAtDischarge)}` : null,
        medicines.length ? `  Medicines at discharge: ${medicines.join('; ')}` : null,
        c?.advice ? `  Advice at discharge: ${s(c.advice, 1500)}` : null,
        ...corrections(card?.additions, 'Correction to the discharge card'),
      ]);
    })
    .filter(Boolean);
  const referralLines = referrals
    .map((r) => {
      const reasons = (r.reasons ?? []).map((k) => reasonByKey.get(k)?.label).filter(Boolean);
      const n = r.note?.status === 'signed' ? r.note : null;
      return entry([
        `Referral from another doctor, ${day(r.receivedAt)}${reasons.length ? ` – ${reasons.join('; ')}` : ''}`,
        r.otherReason ? `  Other reason: ${s(r.otherReason, 300)}` : null,
        r.question ? `  Their question: ${s(r.question, 1000)}` : null,
        n?.diagnosis ? `  Our consultant note – diagnosis: ${s(n.diagnosis)}` : null,
        n?.plan ? `  Our consultant note – plan: ${s(n.plan, 1500)}` : null,
        n?.returnsToYouFor ? `  Returns to the referring doctor for: ${s(n.returnsToYouFor, 500)}` : null,
        ...corrections(n?.additions, 'Addition to the consultant note'),
      ]);
    })
    .filter(Boolean);
  const section = (title, list) => (list.length ? [`## ${title}`, ...list, ''] : []);
  return withoutHiv(
    [
      record,
      '',
      ...section('Lab results (newest first)', labs),
      ...section('Signed scan reports (newest first)', scanLines),
      ...section('Hospital stays (newest first)', stayLines),
      ...section('Referrals from other doctors (newest first)', referralLines),
    ].join('\n'),
  );
}
