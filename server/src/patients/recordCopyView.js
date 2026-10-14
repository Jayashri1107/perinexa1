// What a copy of one patient's whole record holds (pure, no database). The route (routes/recordCopy.js) reads the
// record and makes the views the screens already use – projectPatient, visitView, PlanView, the lab's orderView,
// documentView, entryView … – so the same need-to-know rules apply; the functions here cut those views down to
// what belongs on a copy that leaves the hospital. Field by field, so a field added to a model later stays out
// until it is added here on purpose.
//
// Always left out:
//  - the doctor's private note of a visit (never printed anywhere), and the reasons a doctor typed to go ahead
//    despite a medicine warning (kept on the visit, never printed);
//  - other patients: a baby's copy points to the mother by patient number only, a mother's to her babies by number
//    only, and an earlier record of the same person (marked as a duplicate) by number only;
//  - staff ids and e-mail addresses (names only), bills and fees, uploaded files (only how many there are);
//  - the content of anything marked "entered in error" or cancelled (a visit, an inpatient document, a nursing chart
//    entry, a scan or procedure, a lab order): it is listed as such, with who marked it and when. It is often
//    something written on the wrong patient's record, and its reason may name that patient;
//  - drafts of inpatient documents (not signed yet, so not part of the record yet): listed as drafts;
//  - lab values that were saved but not reported yet;
//  - consent forms and information given: titles and dates only.

import { testByKey } from '../lab/labTests.js';

/** Who and when (never an id). */
const stamp = (x) => (x ? { byName: x.byName ?? null, at: x.at ?? null } : null);
const list = (v) => (Array.isArray(v) ? [...v] : []);

// ---------- The patient's own details ----------

function riskForCopy(p) {
  const r = p.risk;
  if (p.careType !== 'antenatal' || !r?.level) return null;
  const o = r.override;
  return {
    level: r.level,
    computedLevel: r.computedLevel ?? null,
    reasons: list(r.reasons).map((x) => ({ key: x.key, label: x.label, level: x.level, detail: x.detail ?? '' })),
    missing: list(r.missing),
    notMeasured: list(r.notMeasured),
    findingsNotChecked: list(r.findingsNotChecked),
    readingsNotChecked: list(r.readingsNotChecked),
    mayBeHigher: Boolean(r.mayBeHigher),
    freeTextNotChecked: Boolean(r.freeTextNotChecked),
    overrideNeedsReview: Boolean(r.overrideNeedsReview),
    // The rules the level was worked out with, and whether a doctor has approved them (a draft is said on the copy)
    templateName: r.templateName ?? null,
    templateVersion: r.templateVersion ?? null,
    templateApproved: Boolean(r.templateApproved),
    computedAt: r.computedAt ?? null,
    override: o ? { level: o.level, reason: o.reason, byName: o.byName, at: o.at, computedLevelAtOverride: o.computedLevelAtOverride ?? null } : null,
  };
}

/**
 * The patient's own details for the copy. `p` is the record as this person may see it (projectPatient's answer,
 * with motherInfo, babies and earlierRecords already reduced to patient numbers by the route).
 */
export function patientForCopy(p) {
  const baby = p.careType === 'newborn';
  const preg = p.pregnancy ?? null;
  const hasPregnancy = Boolean(preg && (preg.lmp || preg.scanEdd || preg.effectiveEdd || list(preg.findings).length));
  const m = p.medical ?? {};
  const o = p.obstetric ?? {};
  const a = p.abortion ?? null;
  const risk = riskForCopy(p);
  return {
    mrn: p.mrn,
    careType: p.careType,
    fullName: p.fullName,
    currentAge: p.currentAge ?? null,
    phone: p.phone ?? '',
    address: p.address ?? '',
    assignedDoctorName: p.assignedDoctorName ?? null,
    sensitive: Boolean(p.sensitive),
    registeredAt: p.createdAt ?? null,
    registeredByName: p.createdByName ?? null,
    // Her ABHA as the screens show it (partly hidden) – never the full number
    abha: p.abha?.linked ? { masked: p.abha.masked, at: p.abha.at ?? null } : null,
    reminders: p.reminders ? { consent: Boolean(p.reminders.consent), channel: p.reminders.channel ?? null, language: p.reminders.language ?? null, byName: p.reminders.byName ?? null, at: p.reminders.at ?? null } : null,
    medical: {
      bloodGroup: m.bloodGroup ?? '',
      heightCm: m.heightCm ?? null,
      weightKg: m.weightKg ?? null,
      allergies: m.allergies ?? '',
      conditions: list(m.conditions),
      conditionsReviewed: Boolean(m.conditionsReviewed),
      otherConditions: m.otherConditions ?? '',
    },
    obstetric: baby
      ? null
      : {
          gravida: o.gravida ?? null,
          para: o.para ?? null,
          living: o.living ?? null,
          abortions: o.abortions ?? null,
          previousCaesareans: o.previousCaesareans ?? null,
          pastComplications: list(o.pastComplications),
          complicationsReviewed: Boolean(o.complicationsReviewed),
        },
    notes: p.notes ?? '', // the notes on the record (not a visit's private note)
    pregnancy: hasPregnancy
      ? {
          lmp: preg.lmp ?? null,
          edd: preg.edd ?? null,
          scanEdd: preg.scanEdd ?? null,
          effectiveEdd: preg.effectiveEdd ?? null,
          findings: list(preg.findings).map((f) => ({ key: f.key, byName: f.byName ?? null, at: f.at ?? null, via: f.via ?? 'record', endedAt: f.endedAt ?? null, endedByName: f.endedByName ?? null, current: Boolean(f.current) })),
          readings: preg.readings
            ? {
                lowestHb: preg.readings.lowestHb ? { value: preg.readings.lowestHb.value, on: preg.readings.lowestHb.on, source: preg.readings.lowestHb.source } : null,
                latestBp: preg.readings.latestBp ? { systolic: preg.readings.latestBp.systolic, diastolic: preg.readings.latestBp.diastolic, on: preg.readings.latestBp.on } : null,
              }
            : null,
        }
      : null,
    gestationalAge: p.careType === 'antenatal' && p.gestationalAge ? { weeks: p.gestationalAge.weeks, days: p.gestationalAge.days } : null,
    risk,
    riskOverrideHistory: risk
      ? list(p.riskOverrideHistory).map((h) => ({ level: h.level, reason: h.reason, byName: h.byName, at: h.at, endedAt: h.endedAt ?? null, endedByName: h.endedByName ?? null, endedBecause: h.endedBecause ?? null }))
      : [],
    // Pregnancy loss (never an induced termination – that is not recorded in Perinexa)
    abortion: a
      ? {
          lossType: a.lossType ?? null,
          lmp: a.lmp ?? null,
          presentedOn: a.presentedOn ?? null,
          weeks: a.weeks ?? null,
          days: a.days ?? null,
          ectopicSite: a.ectopicSite ?? null,
          moleKind: a.moleKind ?? null,
          management: { method: a.management?.method ?? null, on: a.management?.on ?? null, outcome: a.management?.outcome ?? null },
          histology: { status: a.histology?.status ?? null, result: a.histology?.result ?? '' },
          antiD: { status: a.antiD?.status ?? null, on: a.antiD?.on ?? null },
          note: a.note ?? '',
          // The findings of the loss (fixed answers; who recorded each and the hospital's day), with earlier entries
          findings: list(a.findings).map((f) => ({
            key: f.key,
            value: f.value ?? null,
            byName: f.byName ?? null,
            at: f.at ?? null,
            on: f.on ?? null,
            via: f.via ?? 'record',
            endedAt: f.endedAt ?? null,
            endedOn: f.endedOn ?? null,
            endedByName: f.endedByName ?? null,
            current: Boolean(f.current),
          })),
        }
      : null,
    // timeKnown: from the delivery note a doctor confirmed (a moment); otherwise a day typed on the record (midnight UTC)
    lastDelivery: p.lastDelivery?.at ? { at: p.lastDelivery.at, mode: p.lastDelivery.mode ?? null, timeKnown: Boolean(p.lastDelivery.documentId) } : null,
    postnatal: { breastfeeding: p.postnatal?.breastfeeding ?? '' },
    // A baby: its own birth details, and the mother by her patient number only (her data is on her own record)
    newborn: baby ? { birthAt: p.newborn?.birthAt ?? null, birthWeightGrams: p.newborn?.birthWeightGrams ?? null, sex: p.newborn?.sex ?? '' } : null,
    motherMrn: baby ? (p.motherInfo?.mrn ?? null) : null,
    // A mother: her babies by their patient numbers only
    babyMrns: baby ? [] : list(p.babies).map((b) => b.mrn),
    // Two records of one person: the other record by its number only
    duplicateOf: p.duplicateOf ? { mrn: p.duplicateOf.mrn, byName: p.duplicateOf.byName ?? null, at: p.duplicateOf.at ?? null, reason: p.duplicateReason ?? '' } : null,
    earlierRecordMrns: list(p.earlierRecords).map((r) => r.mrn),
    // A baby's care after birth: the NICU or SNCU stay and feeding at discharge ('' or null: not recorded)
    newbornCare: baby
      ? {
          nicu: { admitted: p.newbornCare?.nicu?.admitted ?? '', from: p.newbornCare?.nicu?.from ?? null, to: p.newbornCare?.nicu?.to ?? null },
          feedingAtDischarge: p.newbornCare?.feedingAtDischarge ?? '',
        }
      : null,
    // A death a doctor recorded on the record (the record is closed): the day, the place or the timing, a baby's age
    // in days, who recorded it and when. A death recorded in error and undone is listed with who recorded and who
    // undid it, and when – never the date it gave or the reason typed (like anything entered in error: it may be
    // about another patient's record).
    death: p.death?.on ? { on: p.death.on, place: p.death.place ?? null, timing: p.death.timing ?? null, ageDays: p.death.ageDays ?? null, byName: p.death.byName ?? null, at: p.death.at ?? null } : null,
    deathsUndone: list(p.deathHistory).map((h) => ({ byName: h.byName ?? null, at: h.at ?? null, undoneByName: h.undoneByName ?? null, undoneAt: h.undoneAt ?? null })),
  };
}

// ---------- Visits ----------

/** One visit. `v`: visitView(visit, { notes: false }) – the private note is never asked for, and dropped again here. */
export function visitForCopy(v) {
  if (v.status !== 'active') return { id: v.id, visitOn: v.visitOn, status: 'cancelled', enteredInError: stamp(v.cancelled) };
  const { privateNote: _never, ...details } = v.details ?? {};
  const p = v.prescription ?? {};
  return {
    id: v.id,
    visitOn: v.visitOn,
    careType: v.careType,
    status: 'active',
    signed: v.signed ? { byName: v.signed.byName, role: v.signed.role, at: v.signed.at } : null,
    vitals: v.vitals,
    details,
    // (never the reasons typed to go ahead despite a medicine warning: they are not printed)
    prescription: { items: list(p.items), notes: p.notes ?? '', byName: p.byName ?? null, at: p.at ?? null },
    additions: list(v.additions).map((x) => ({ id: x.id, text: x.text, byName: x.byName, at: x.at })),
    createdByName: v.createdByName ?? null,
    createdAt: v.createdAt ?? null,
  };
}

// ---------- Lab ----------

const REPORTED = ['reported', 'reviewed'];
const testForCopy = (t) => ({ key: t.key, name: t.name, values: list(t.values).map((x) => ({ key: x.key, value: x.value, flag: x.flag })), text: t.text ?? '' });
const time = (v) => (v ? new Date(v).getTime() : NaN);

/**
 * Whether the sample time of a reported order was only stamped by the report (the lab reported without marking the
 * sample collected first). Orders since 5 Oct 2026 carry the flag `collectedAtReport`; on an older order the sample
 * time is then exactly the report's time. The same rule as redflags/redFlags.js (labReadings).
 */
export const sampleStampedByReport = (o) => o.collectedAtReport === true || !o.collected?.at || (o.reported?.at != null && time(o.collected.at) === time(o.reported.at));

/**
 * One lab order. `o`: the lab's orderView for someone who may see the medical details, with `collectedAtReport`
 * from the order. Results reported without "sample collected" first carry the report's time and name as the
 * sample's: the copy then says the sample time was not recorded rather than give a wrong one.
 */
export function labOrderForCopy(o) {
  if (o.status === 'cancelled') return { id: o.id, status: 'cancelled', ordered: stamp(o.ordered), cancelled: stamp(o.cancelled) };
  const reported = REPORTED.includes(o.status);
  const sampleTimeUnknown = reported && sampleStampedByReport(o);
  return {
    id: o.id,
    status: o.status,
    urgent: Boolean(o.urgent),
    ordered: stamp(o.ordered),
    collected: sampleTimeUnknown ? null : stamp(o.collected),
    reported: reported ? stamp(o.reported) : null,
    reviewed: o.reviewed ? { byName: o.reviewed.byName, at: o.reviewed.at, comment: o.reviewed.comment ?? '' } : null,
    packages: list(o.packages).map((p) => p.name),
    noteToLab: o.noteToLab ?? '',
    // Values saved before the report are not results yet: only the names of the tests
    tests: list(o.tests).map((t) => (reported ? testForCopy(t) : { key: t.key, name: t.name, values: [], text: '' })),
    labNote: reported ? (o.labNote ?? '') : '',
    abnormal: reported && Boolean(o.abnormal),
    // Results changed after the report: why, by whom, and the results as they were before
    amendments: reported
      ? list(o.amendments).map((m) => ({ byName: m.byName, at: m.at, reason: m.reason ?? '', tests: list(m.tests).map(testForCopy), labNote: m.labNote ?? '', reviewedByName: m.reviewedByName ?? null, reviewedAt: m.reviewedAt ?? null }))
      : [],
    files: list(o.files).length, // report files: how many (never a file name – it may hold a name)
  };
}

/** The names and units of the values in these orders (for writing "Haemoglobin 9.8 g/dL"): only the tests that occur. */
export function catalogueFor(orders) {
  const keys = [...new Set(orders.flatMap((o) => list(o.tests).map((t) => t.key)))].filter((k) => testByKey.has(k));
  return {
    tests: keys.map((k) => {
      const t = testByKey.get(k);
      return { key: t.key, name: t.name, fields: t.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, unit: f.unit ?? '' })) };
    }),
  };
}

// ---------- Scans and procedures done ----------

/** `w`: the work-done view. One entered in error is listed without its name. */
export function workForCopy(w) {
  if (w.cancelled) return { id: w.id, group: w.group, on: w.on, enteredInError: stamp(w.cancelled) };
  return { id: w.id, group: w.group, name: w.name, on: w.on, doneByName: w.doneByName ?? '' };
}

// ---------- Stays in hospital ----------

const TIME_OF = { round: 'at', delivery: 'deliveredAt', operation: 'performedAt', discharge: 'dischargedAt' };

/** `d`: documentView(doc). Signed documents with their content; a draft or one entered in error only listed. */
export function documentForCopy(d) {
  const base = { id: d.id, kind: d.kind, status: d.status, at: d.createdAt ?? null };
  if (d.status === 'cancelled') return { ...base, enteredInError: stamp(d.cancelled) };
  if (d.status !== 'signed') return { ...base, status: 'draft', createdByName: d.createdByName ?? null };
  return {
    ...base,
    at: d.content?.[TIME_OF[d.kind]] ?? d.createdAt ?? null, // the time the document is about
    content: d.content ?? {},
    createdByName: d.createdByName ?? null,
    signed: d.signed ? { byName: d.signed.byName, role: d.signed.role, at: d.signed.at } : null,
    additions: list(d.additions).map((x) => ({ id: x.id, text: x.text, byName: x.byName, at: x.at })),
  };
}

/** `e`: entryView(entry) of the nursing chart. */
export function nursingEntryForCopy(e) {
  if (e.cancelled) return { id: e.id, kind: e.kind, at: e.at, enteredInError: stamp(e.cancelled) };
  return { id: e.id, kind: e.kind, at: e.at, vitals: e.vitals ?? null, medicine: e.medicine ?? null, note: e.note ?? '', ...(e.kind === 'escalation' ? { escalatedTo: e.escalatedTo ?? '' } : {}), byName: e.byName ?? null };
}

/** `a`: admissionView(stay), with its documents and nursing chart entries (already made for the copy, oldest first). */
export function stayForCopy(a, documents, nursing) {
  return {
    id: a.id,
    careType: a.careType,
    admittedAt: a.admittedAt,
    ward: a.ward ?? '',
    bed: a.bed ?? '',
    reason: a.reason ?? '',
    status: a.status,
    dischargedAt: a.dischargedAt ?? null,
    admittedByName: a.admittedByName ?? null,
    dischargedByName: a.dischargedByName ?? null,
    documents,
    nursing,
  };
}

// ---------- Consent forms, appointments, notes, care plans ----------

/** A printed consent form or information form: its title and dates only (never what was typed into it). */
export const consentForCopy = (c) => ({
  id: String(c._id ?? c.id),
  kind: c.kind === 'information' ? 'information' : 'consent',
  title: c.title,
  printedAt: c.printedAt ?? null,
  signedOn: c.signed?.on ?? null,
});

/** `v`: appointmentView. Never the fee, the phone number or who booked it. */
export const appointmentForCopy = (v) => ({
  id: v.id,
  date: v.date,
  kind: v.kind,
  start: v.start ?? null,
  token: v.token ?? null,
  needsTime: Boolean(v.needsTime),
  visitType: v.visitType,
  status: v.status,
  doctorName: v.doctor?.name ?? null,
});

/** An emergency treatment note (written by a doctor who is not her doctor): never the author's id. */
export const noteForCopy = (n) => ({ id: String(n._id ?? n.id), at: n.createdAt ?? null, byName: n.authorName ?? null, reason: n.reason ?? '', text: n.text ?? '' });

/** `v`: PlanView. Without the plan's log, the items' change histories and what the viewer may do. */
export function planForCopy(v) {
  const { log: _log, recentChanges: _recent, canEdit: _e, canChangePlan: _c, canClose: _x, canReopen: _r, readOnly: _o, items, ...plan } = v;
  return { ...plan, items: list(items).map(({ history: _h, rev: _rev, ...it }) => it) };
}
