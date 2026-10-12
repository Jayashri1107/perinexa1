// ABDM milestone M2 – which of a patient's records may be linked to her ABHA and shared through ABDM (pure, no
// database). ABDM's own rules (her consent, its dates and types) are checked in abdmRecords.js; these are the
// hospital's rules ON TOP of them, checked when a record is linked AND again every time ABDM asks for it:
//
//  - Only finished records: a SIGNED visit (consultation and prescription), lab results REVIEWED by a doctor, a
//    CONFIRMED (signed) discharge card. A draft, an unsigned visit or unreviewed results are "not yet".
//  - Never: anything marked "entered in error" (or a cancelled lab order); a record marked SENSITIVE (nothing of it);
//    the confidential tests (HIV – CONFIDENTIAL_TESTS in billing/billingRules.js), and any record whose shared text
//    mentions them (CONFIDENTIAL_WORDS – a draft list for the owner to check); no visit or discharge summary of a
//    patient with HIV among her known conditions; the doctor's private note, the reasons a doctor gave to go ahead
//    despite a medicine warning, the doctor's review comment on lab results, the doctor's note to the lab and report
//    files (the documents in fhirRecords.js never hold them).
//  - What her ABHA app shows (`display`): the kind of record and its date only – never a test name or a diagnosis.

import { CONFIDENTIAL_TESTS } from '../billing/billingRules.js';
import { dateWords, toHospitalDate, utcDay } from '../careplans/dates.js';

/** ABDM's health information types this hospital shares (M2). */
export const HI_TYPES = ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary'];
export const HI_TYPE_WORDS = { OPConsultation: 'Consultation', Prescription: 'Prescription', DiagnosticReport: 'Lab report', DischargeSummary: 'Discharge summary' };

/**
 * DRAFT – a privacy rule for the owner to check (not clinical advice): words that show a record is about HIV, each
 * with how Hospital admin → ABDM shows it. A record whose shared text has one of them is never shared through ABDM
 * (the HIV and AIDS (Prevention and Control) Act 2017 protects whether someone was tested and the result). It covers
 * the shorthand of Indian antenatal notes ("RVD NR", "retro negative", "Tri-Dot") and the usual antiretroviral
 * abbreviations, and errs on the side of privacy: tenofovir (TDF) and a viral load are also used for hepatitis B, and
 * TLE also means temporal lobe epilepsy, so such a visit is held back too. "ART" alone is not on the list: it also
 * means assisted reproduction (but no visit is shared of a patient with HIV among her known conditions).
 */
export const CONFIDENTIAL_WORD_LIST = [
  { shown: 'HIV (also HIV-1, HIV-2, HIV1/2)', re: /\bHIV(?:-?[12])?\b/i },
  { shown: 'AIDS (in capitals)', re: /\bAIDS\b/ },
  { shown: 'PLHIV, PLWHA, PLHA (people living with HIV)', re: /\b(?:PLHIV|PLWHA|PLHA)\b/i },
  { shown: 'RVD (retroviral disease)', re: /\bRVD\b/i },
  {
    shown: 'Retroviral, retro positive, retro reactive, retro negative, retro non-reactive, retro NR, retro status, retro screening, retro test',
    re: /\bretro\s*-?\s*(?:viral|virus|positive|negative|reactive|non\s*-?\s*reactive|NR|status|screen(?:ing)?|test(?:ing)?)\b/i,
  },
  { shown: 'Antiretroviral, ART centre or ART clinic', re: /\bantiretroviral|\bART (?:centre|center|clinic)\b/i },
  // In capitals only: "gestational sacs" is not about HIV
  { shown: 'PPTCT, ICTC, NACO, and SACS in capitals (HIV programmes and centres)', re: [/\b(?:PPTCT|ICTC|NACO)\b/i, /\b[A-Z]{0,4}SACS\b/] },
  { shown: 'Tri-Dot (an HIV rapid test)', re: /\btri\s*-?\s*dot\b/i },
  { shown: 'CD4 count, viral load', re: /\bCD4\b|\bviral\s+loads?\b/i },
  {
    shown: 'Antiretroviral medicines by name: tenofovir, lamivudine, dolutegravir, efavirenz, nevirapine, zidovudine, abacavir, lopinavir, ritonavir, atazanavir, raltegravir, emtricitabine',
    re: /\b(?:tenofovir|lamivudine|dolutegravir|efavirenz|nevirapine|zidovudine|abacavir|lopinavir|ritonavir|atazanavir|raltegravir|emtricitabine)\b/i,
  },
  { shown: 'Antiretroviral medicines by abbreviation, in capitals: ARV, TLD, TLE, TDF, AZT, ZDV, 3TC, FTC, NVP, EFV, DTG, LPV', re: /\b(?:ARV|TLD|TLE|TDF|AZT|ZDV|3TC|FTC|NVP|EFV|DTG|LPV)\b/ },
];
export const CONFIDENTIAL_WORDS = CONFIDENTIAL_WORD_LIST.flatMap((w) => [w.re].flat());
export const CONFIDENTIAL_WORDS_SOURCE = 'HIV and AIDS (Prevention and Control) Act 2017 – confidentiality of HIV status (draft list, to be checked by the owner)';

export const mentionsConfidential = (texts) => texts.some((t) => typeof t === 'string' && t && CONFIDENTIAL_WORDS.some((re) => re.test(t.replace(/_/g, ' '))));

/** A confidential lab test: HIV (CONFIDENTIAL_TESTS), or a test whose name (or key) mentions it – e.g. "RVD" typed. */
export const isConfidentialTest = (test) => CONFIDENTIAL_TESTS.includes(test.key) || mentionsConfidential([test.name, test.key]);

/**
 * HIV among her known conditions (or written in her other conditions): her visits and discharge summaries are never
 * shared – their words may not say HIV ("on ART"), but they are about it. Lab reports keep their own rules (the HIV
 * test left out, a report that mentions HIV held back).
 */
export const hivOnRecord = (patient) => (patient?.medical?.conditions ?? []).includes('hiv') || mentionsConfidential([patient?.medical?.otherConditions]);

/** Why a record is not shared yet (it may be later) – the website words these. */
export const NOT_YET = ['visit_not_signed', 'lab_not_reviewed', 'discharge_not_signed'];
/** Why a record is never shared. */
export const NEVER = ['entered_in_error', 'cancelled', 'confidential_test', 'mentions_confidential', 'sensitive_record', 'hiv_on_record'];

// ---------- References (ABDM's "care context reference": opaque, never a name or a test) ----------

const PREFIX = { visit: 'V', lab: 'L', discharge: 'D' };
export const referenceOf = (kind, id) => `${PREFIX[kind]}-${String(id)}`;
export function parseReference(ref) {
  const m = /^([VLD])-([a-f\d]{24})$/i.exec(String(ref ?? ''));
  if (!m) return null;
  return { kind: { V: 'visit', L: 'lab', D: 'discharge' }[m[1].toUpperCase()], id: m[2].toLowerCase() };
}

// ---------- The text each record would share (to look for the confidential words) ----------

const list = (v) => (Array.isArray(v) ? v : []);

export function visitTexts(visit) {
  const d = visit.details ?? {};
  const p = visit.prescription ?? {};
  return [
    d.complaints,
    d.examination,
    d.diagnosis,
    d.investigations,
    d.advice,
    d.nextVisitNote,
    ...list(p.items).flatMap((it) => [it.drug, it.strength, it.dose, it.frequencyText, it.instructions]),
    p.notes,
    ...list(visit.additions).map((a) => a.text),
  ];
}

export const sharedTests = (order) => list(order.tests).filter((t) => !isConfidentialTest(t));

export function labTexts(order) {
  return [...sharedTests(order).flatMap((t) => [t.name, t.text, ...list(t.values).map((v) => v.value)]), order.labNote];
}

export function dischargeTexts(doc) {
  const c = doc.content ?? {};
  return [
    c.finalDiagnosis,
    c.course,
    c.procedures,
    c.conditionAtDischarge,
    c.advice,
    c.followUpNote,
    ...list(c.medicines).flatMap((it) => [it.drug, it.strength, it.dose, it.frequencyText, it.instructions]),
    ...list(doc.additions).map((a) => a.text),
  ];
}

// ---------- Each kind of record ----------

/**
 * A record as something to link and share: { kind, sourceId, reference, date, display, hiTypes, state, reason }.
 * state: 'ready' (may be linked and shared), 'not_yet' (NOT_YET reason) or 'never' (NEVER reason).
 */
export function visitRecord(visit) {
  const date = utcDay(visit.visitOn);
  const base = {
    kind: 'visit',
    sourceId: String(visit._id),
    reference: referenceOf('visit', visit._id),
    date,
    display: `OPD visit on ${dateWords(date)}`,
    hiTypes: list(visit.prescription?.items).length ? ['OPConsultation', 'Prescription'] : ['OPConsultation'],
  };
  if (visit.status !== 'active') return { ...base, state: 'never', reason: 'entered_in_error' };
  if (!visit.signed) return { ...base, state: 'not_yet', reason: 'visit_not_signed' };
  if (mentionsConfidential(visitTexts(visit))) return { ...base, state: 'never', reason: 'mentions_confidential' };
  return { ...base, state: 'ready', reason: null };
}

export function labRecord(order) {
  const date = toHospitalDate(order.reported?.at ?? order.ordered?.at ?? order.createdAt ?? new Date(0));
  const base = { kind: 'lab', sourceId: String(order._id), reference: referenceOf('lab', order._id), date, display: `Lab report of ${dateWords(date)}`, hiTypes: ['DiagnosticReport'] };
  if (order.status === 'cancelled') return { ...base, state: 'never', reason: 'cancelled' };
  const shared = sharedTests(order);
  if (!shared.length) return { ...base, state: 'never', reason: 'confidential_test' };
  const leftOut = list(order.tests).length - shared.length; // confidential tests left out of a report that is shared
  if (order.status !== 'reviewed') return { ...base, state: 'not_yet', reason: 'lab_not_reviewed', confidentialLeftOut: leftOut };
  if (mentionsConfidential(labTexts(order))) return { ...base, state: 'never', reason: 'mentions_confidential' };
  return { ...base, state: 'ready', reason: null, confidentialLeftOut: leftOut };
}

export function dischargeRecord(doc) {
  const at = doc.content?.dischargedAt ? new Date(doc.content.dischargedAt) : (doc.createdAt ?? new Date(0));
  const date = toHospitalDate(at);
  const base = { kind: 'discharge', sourceId: String(doc._id), reference: referenceOf('discharge', doc._id), date, display: `Discharge summary of ${dateWords(date)}`, hiTypes: ['DischargeSummary'] };
  if (doc.status === 'cancelled') return { ...base, state: 'never', reason: 'entered_in_error' };
  if (doc.status !== 'signed') return { ...base, state: 'not_yet', reason: 'discharge_not_signed' };
  if (mentionsConfidential(dischargeTexts(doc))) return { ...base, state: 'never', reason: 'mentions_confidential' };
  return { ...base, state: 'ready', reason: null };
}

/** Why NOTHING of this record may be linked or shared (null: her records can be). */
export function patientBlock(patient) {
  if (patient.sensitive) return 'sensitive_record';
  if (!patient.abha?.number) return 'no_abha';
  return null;
}

/**
 * A record with the rules of her whole record applied: marked sensitive (nothing of it), or HIV among her known
 * conditions (no visit and no discharge summary). A record already "never" keeps its own reason.
 */
export function withPatientRules(patient, record) {
  if (record.state === 'never') return record;
  if (patient?.sensitive) return { ...record, state: 'never', reason: 'sensitive_record' };
  if (record.kind !== 'lab' && hivOnRecord(patient)) return { ...record, state: 'never', reason: 'hiv_on_record' };
  return record;
}

/** The records of a patient, newest first, with the rules of her whole record applied to each. */
export function recordsOf(patient, { visits = [], orders = [], discharges = [] }) {
  const all = [...visits.map(visitRecord), ...orders.map(labRecord), ...discharges.map(dischargeRecord)].map((r) => withPatientRules(patient, r));
  return all.sort((a, b) => b.date - a.date || a.reference.localeCompare(b.reference));
}

/**
 * Is a record's day inside a consent's dates (both ends included; a missing end is open)? Compared as the hospital's
 * days, so a consent "from 5 Oct 10:00" still includes a visit of 5 Oct.
 */
export const withinRange = (day, from, to) => {
  const d = utcDay(day).getTime();
  return (!from || d >= toHospitalDate(from).getTime()) && (!to || d <= toHospitalDate(to).getTime());
};
