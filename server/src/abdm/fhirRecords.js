// ABDM milestone M2 – a patient's records as FHIR R4 documents, following the NRCeS profiles ABDM uses
// (https://nrces.in/ndhm/fhir/r4): OPConsultRecord and PrescriptionRecord for a signed visit, DiagnosticReportRecord
// for reviewed lab results, DischargeSummaryRecord for a confirmed discharge card. Pure (no database): the service
// (abdmRecords.js) loads the record, checks shareRules.js, and passes what is needed here.
//
// Field by field, so nothing is shared by accident: a field added to a visit or a document later stays out until it
// is added here on purpose. Never in a document: the doctor's private note, the reasons a doctor gave to go ahead
// despite a medicine warning, the doctor's note to the lab, the doctor's review comment on results, report files,
// the confidential tests (HIV) and staff ids or e-mail addresses (names and a doctor's registration number only).
//
// Free text stays free text (CodeableConcept.text): Perinexa does not code diagnoses in SNOMED CT. The vital signs
// carry their LOINC codes. ⚠️ To check with NRCeS's FHIR validator before going live (ABDM_CHECKLIST_M2): the section
// codes, the codes of the vital signs, and the identifiers a profile may require (a doctor's HPR ID, the HFR ID).

import { randomUUID } from 'node:crypto';
import { dateWords, isoDay, toHospitalDate, utcDay } from '../careplans/dates.js';
import { testByKey } from '../lab/labTests.js';
import { sampleStampedByReport } from '../patients/recordCopyView.js';
import { referenceOf, sharedTests } from './shareRules.js';

const SNOMED = 'http://snomed.info/sct';
const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';
const V2_0074 = 'http://terminology.hl7.org/CodeSystem/v2-0074';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const INTERPRETATION = 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';
const CONDITION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category';
const NRCES = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/';
const NDHM_IDENTIFIER = 'https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code';

/** The document of each ABDM health information type: its NRCeS profile and SNOMED CT type. */
export const DOCUMENT_TYPES = {
  OPConsultation: { profile: 'OPConsultRecord', code: '371530004', display: 'Clinical consultation report', title: 'Consultation report' },
  Prescription: { profile: 'PrescriptionRecord', code: '440545006', display: 'Prescription record', title: 'Prescription' },
  DiagnosticReport: { profile: 'DiagnosticReportRecord', code: '721981007', display: 'Diagnostic studies report', title: 'Diagnostic report' },
  DischargeSummary: { profile: 'DischargeSummaryRecord', code: '373942005', display: 'Discharge summary', title: 'Discharge summary' },
};

// ---------- Small pieces ----------

const list = (v) => (Array.isArray(v) ? v : []);
const iso = (d) => (d ? new Date(d).toISOString() : undefined);
const profile = (name) => ({ profile: [`${NRCES}${name}`] });
const concept = (system, code, display, text = display) => ({ coding: [{ system, code, display }], text });
const snomed = (code, display) => concept(SNOMED, code, display);
const xhtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** FHIR narrative: the lines as paragraphs (a narrative is never empty). */
export function narrative(lines) {
  const ps = lines.filter((l) => l != null && String(l).trim()).map((l) => `<p>${xhtml(l)}</p>`);
  return { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${ps.join('') || '<p>No details recorded.</p>'}</div>` };
}
const words = (key) => (key ? String(key).charAt(0).toUpperCase() + String(key).slice(1).replace(/_/g, ' ') : '');

// ---------- Medicines in words (the same words as the printed prescription) ----------

const FORM_PREFIX = { tab: 'Tab.', cap: 'Cap.', syrup: 'Syp.', suspension: 'Susp.', drops: 'Drops', inj: 'Inj.', sachet: 'Sachet', powder: 'Powder', pessary: 'Pessary', suppository: 'Supp.', cream: 'Cream', ointment: 'Oint.', gel: 'Gel', lotion: 'Lotion', spray: 'Spray', inhaler: 'Inhaler', other: '' };
const FREQUENCY_WORDS = { '1-0-0': '1-0-0 (once a day, morning)', '0-1-0': '0-1-0 (once a day, afternoon)', '0-0-1': '0-0-1 (once a day, night)', '1-0-1': '1-0-1 (twice a day)', '1-1-1': '1-1-1 (three times a day)', '1-1-1-1': '1-1-1-1 (four times a day)', sos: 'only when needed (SOS)', stat: 'once, now (STAT)', weekly: 'once a week', alternate: 'every other day' };
const TIMING_WORDS = { after_food: 'after food', before_food: 'before food', with_food: 'with food', empty_stomach: 'on an empty stomach', bedtime: 'at bedtime' };
const ROUTE_WORDS = { oral: 'by mouth', vaginal: 'vaginal', rectal: 'rectal', im: 'intramuscular (IM)', iv: 'intravenous (IV)', sc: 'under the skin (SC)', sublingual: 'under the tongue', local: 'apply locally' };
const UNIT_WORDS = { days: ['day', 'days'], weeks: ['week', 'weeks'], months: ['month', 'months'] };

/** "Tab. Folic acid 5 mg" */
export const medicineName = (it) => [FORM_PREFIX[it.form] ?? '', it.drug, it.strength].filter(Boolean).join(' ');
/** "Dose 1, 1-0-0 (once a day, morning), after food, for 30 days, take with water" */
export function dosageText(it) {
  const n = it.durationValue;
  const duration = n && UNIT_WORDS[it.durationUnit] ? `for ${n} ${UNIT_WORDS[it.durationUnit][n === 1 ? 0 : 1]}` : it.durationUnit === 'till_delivery' ? 'until delivery' : it.durationUnit === 'continue' ? 'continue until told otherwise' : '';
  return [
    it.dose ? `Dose ${it.dose}` : '',
    it.frequency === 'custom' ? it.frequencyText : (FREQUENCY_WORDS[it.frequency] ?? ''),
    TIMING_WORDS[it.timing] ?? '',
    ROUTE_WORDS[it.route] ?? '',
    duration,
    it.instructions ?? '',
  ]
    .filter(Boolean)
    .join(', ');
}

// ---------- One document ----------

/**
 * ctx: { hospital: { name, key, hfrId }, patient: { mrn, fullName, careType, newbornSex, birthDate, abhaNumber },
 *        people: Map(user id → { name, registrationNumber, council }), newId(), now }.
 */
function documentOf(ctx, hiType, reference) {
  const newId = ctx.newId ?? randomUUID;
  const resources = [];
  const add = (r) => {
    const res = { resourceType: r.resourceType, id: newId(), ...r };
    resources.push(res);
    return res;
  };
  const ref = (res, display) => ({ reference: `urn:uuid:${res.id}`, ...(display ? { display } : {}) });
  const p = ctx.patient;

  const patient = add({
    resourceType: 'Patient',
    meta: profile('Patient'),
    text: narrative([`${p.fullName}, patient number ${p.mrn}`]),
    identifier: [
      { type: concept(V2_0203, 'MR', 'Medical record number'), system: `urn:perinexa:${ctx.hospital.key}:patient-number`, value: p.mrn },
      ...(p.abhaNumber ? [{ type: concept(NDHM_IDENTIFIER, 'ABHA', 'Ayushman Bharat Health Account (ABHA) ID'), system: 'https://healthid.abdm.gov.in', value: p.abhaNumber }] : []),
    ],
    name: [{ text: p.fullName }],
    // Perinexa's patients are women and their babies; a baby's sex only after birth (never a fetus – PC-PNDT)
    gender: p.careType === 'newborn' ? ({ female: 'female', male: 'male', indeterminate: 'other' }[p.newbornSex] ?? 'unknown') : 'female',
    ...(p.birthDate ? { birthDate: p.birthDate } : {}),
  });
  const organization = add({
    resourceType: 'Organization',
    meta: profile('Organization'),
    text: narrative([ctx.hospital.name]),
    ...(ctx.hospital.hfrId ? { identifier: [{ type: concept(V2_0203, 'PRN', 'Provider number'), system: 'https://facility.ndhm.gov.in', value: ctx.hospital.hfrId }] } : {}),
    name: ctx.hospital.name,
  });
  const patientRef = ref(patient, p.fullName);
  const orgRef = ref(organization, ctx.hospital.name);

  const people = new Map();
  /** The person who signed or reviewed (a stamp { by, byName }) as a Practitioner – name and registration only. */
  const practitioner = (stamp) => {
    if (!stamp?.byName) return null;
    const key = String(stamp.by ?? stamp.byName);
    if (!people.has(key)) {
      const who = ctx.people?.get(String(stamp.by)) ?? {};
      const name = stamp.byName;
      const reg = who.registrationNumber ?? '';
      people.set(
        key,
        add({
          resourceType: 'Practitioner',
          meta: profile('Practitioner'),
          text: narrative([name, reg ? `Registration ${reg}${who.council ? `, ${who.council}` : ''}` : null]),
          ...(reg ? { identifier: [{ type: concept(V2_0203, 'MD', 'Medical License number'), system: 'urn:perinexa:medical-council-registration', value: reg }] } : {}),
          name: [{ text: name }],
        }),
      );
    }
    return people.get(key);
  };

  const condition = (text, category, recorded) =>
    add({
      resourceType: 'Condition',
      meta: profile('Condition'),
      text: narrative([text]),
      ...(category ? { category: [concept(CONDITION_CATEGORY, category, category === 'encounter-diagnosis' ? 'Encounter Diagnosis' : 'Problem List Item')] } : {}),
      code: { text },
      subject: patientRef,
      ...(recorded ? { recordedDate: iso(recorded) } : {}),
    });

  const medicationRequest = (it, authoredOn, requester) =>
    add({
      resourceType: 'MedicationRequest',
      meta: profile('MedicationRequest'),
      text: narrative([medicineName(it), dosageText(it)]),
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: { text: medicineName(it) },
      subject: patientRef,
      ...(authoredOn ? { authoredOn: iso(authoredOn) } : {}),
      ...(requester ? { requester: ref(requester, requester.name[0].text) } : {}),
      dosageInstruction: [{ text: dosageText(it) || 'As directed' }],
    });

  const followUp = (on, note) =>
    add({
      resourceType: 'Appointment',
      meta: profile('Appointment'),
      text: narrative([`Next visit${on ? ` on ${dateWords(on)}` : ''}${note ? ` – ${note}` : ''}`]),
      status: 'proposed',
      ...(note ? { description: note } : {}),
      ...(on ? { requestedPeriod: [{ start: isoDay(on), end: isoDay(on) }] } : {}),
      participant: [{ actor: patientRef, status: 'needs-action' }],
    });

  /** A section of the Composition: a title, a code (or only words), its entries and its narrative. */
  const section = (title, code, entries, lines) => ({ title, code: code ?? { text: title }, text: narrative(lines), ...(entries.length ? { entry: entries.map((e) => ref(e)) } : {}) });

  const additionsSection = (additions) =>
    list(additions).length
      ? [section('Corrections and additions after signing', null, [], list(additions).map((a) => `${dateWords(toHospitalDate(a.at))}, ${a.byName}: ${a.text}`))]
      : [];

  /** The finished Bundle: the Composition first, then every resource it points to. */
  const finish = ({ date, authors, attester, encounter, sections, amended }) => {
    const type = DOCUMENT_TYPES[hiType];
    const lastUpdated = iso(ctx.now ?? new Date());
    const composition = {
      resourceType: 'Composition',
      id: newId(),
      meta: { versionId: '1', lastUpdated, ...profile(type.profile) },
      language: 'en-IN',
      text: narrative([`${type.title} – ${ctx.hospital.name}`, `${p.fullName} (${p.mrn})`, date ? dateWords(toHospitalDate(date)) : null]),
      identifier: { system: `urn:perinexa:${ctx.hospital.key}:document`, value: `${reference}-${hiType}` },
      status: amended ? 'amended' : 'final',
      type: snomed(type.code, type.display),
      subject: patientRef,
      ...(encounter ? { encounter: ref(encounter) } : {}),
      date: iso(date),
      author: authors.filter(Boolean).length ? authors.filter(Boolean).map((a) => ref(a, a.name?.[0]?.text ?? a.name)) : [orgRef],
      title: type.title,
      ...(attester?.party ? { attester: [{ mode: 'legal', ...(attester.at ? { time: iso(attester.at) } : {}), party: ref(attester.party) }] } : {}),
      custodian: orgRef,
      section: sections.length ? sections : [section('Details', null, [], [])],
    };
    const bundleId = newId();
    return {
      resourceType: 'Bundle',
      id: bundleId,
      meta: { versionId: '1', lastUpdated, ...profile('DocumentBundle'), security: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'V', display: 'very restricted' }] },
      identifier: { system: `urn:perinexa:${ctx.hospital.key}:bundle`, value: bundleId },
      type: 'document',
      timestamp: lastUpdated,
      entry: [composition, ...resources].map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
    };
  };

  return { add, ref, patientRef, orgRef, practitioner, condition, medicationRequest, followUp, section, additionsSection, finish };
}

// ---------- Observations (vital signs and the pregnancy check) ----------

const quantity = (value, unit, code) => ({ value: Number(value), unit, system: UCUM, code: code ?? unit });

/** The visit's measurements as Observations: [{ resource, line }]. */
function visitObservations(doc, visit) {
  const v = visit.vitals ?? {};
  const d = visit.details ?? {};
  const when = isoDay(visit.visitOn);
  const out = [];
  const obs = (code, valueFields, line) =>
    out.push({ resource: doc.add({ resourceType: 'Observation', meta: profile('Observation'), text: narrative([line]), status: 'final', code, subject: doc.patientRef, effectiveDateTime: when, ...valueFields }), line });
  const num = (value, loinc, display, unit, ucum, label = display) => {
    if (value == null) return;
    obs(concept(LOINC, loinc, display, label), { valueQuantity: quantity(value, unit, ucum) }, `${label}: ${value} ${unit}`);
  };
  const text = (value, label, loinc, display) => {
    if (!value) return;
    obs(loinc ? concept(LOINC, loinc, display, label) : { text: label }, { valueString: String(value) }, `${label}: ${value}`);
  };
  num(v.weightKg, '29463-7', 'Body weight', 'kg', 'kg', 'Weight');
  if (v.bpSystolic != null && v.bpDiastolic != null) {
    obs(
      concept(LOINC, '85354-9', 'Blood pressure panel with all children optional', 'Blood pressure'),
      {
        component: [
          { code: concept(LOINC, '8480-6', 'Systolic blood pressure'), valueQuantity: quantity(v.bpSystolic, 'mmHg', 'mm[Hg]') },
          { code: concept(LOINC, '8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(v.bpDiastolic, 'mmHg', 'mm[Hg]') },
        ],
      },
      `Blood pressure: ${v.bpSystolic}/${v.bpDiastolic} mmHg`,
    );
  }
  num(v.pulse, '8867-4', 'Heart rate', '/min', '/min', 'Pulse');
  num(v.temperatureF, '8310-5', 'Body temperature', '°F', '[degF]', 'Temperature');
  num(v.spo2, '59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry', '%', '%', 'SpO2');
  num(v.hb, '718-7', 'Hemoglobin [Mass/volume] in Blood', 'g/dL', 'g/dL', 'Haemoglobin (point of care)');
  text(words(v.urineAlbumin), 'Urine albumin (dipstick)', '20454-5', 'Protein [Presence] in Urine by Test strip');
  text(words(v.urineSugar), 'Urine sugar (dipstick)', '25428-4', 'Glucose [Presence] in Urine by Test strip');
  num(d.fundalHeightCm, '11881-0', 'Uterus Fundal height by Tape measure', 'cm', 'cm', 'Fundal height');
  num(d.fetalHeartRate, '55283-6', 'Fetal Heart rate', '/min', '/min', 'Fetal heart rate');
  text(words(d.presentation), 'Presentation');
  text(words(d.fetalMovements), 'Fetal movements');
  text(words(d.oedema), 'Oedema');
  text(d.examination, 'Examination');
  return out;
}

// ---------- A signed visit: OPConsultRecord and PrescriptionRecord ----------

/** The documents of a signed visit: the consultation, and the prescription when it has medicines. */
export function visitDocuments(ctx, visit) {
  const out = [{ hiType: 'OPConsultation', bundle: opConsultRecord(ctx, visit) }];
  if (list(visit.prescription?.items).length) out.push({ hiType: 'Prescription', bundle: prescriptionRecord(ctx, visit) });
  return out;
}

function visitEncounter(doc, visit) {
  return doc.add({
    resourceType: 'Encounter',
    meta: profile('Encounter'),
    text: narrative([`OPD visit on ${dateWords(visit.visitOn)}`]),
    status: 'finished',
    class: { system: ACT_CODE, code: 'AMB', display: 'ambulatory' },
    subject: doc.patientRef,
    period: { start: isoDay(visit.visitOn) },
  });
}

function opConsultRecord(ctx, visit) {
  const ref = referenceOf('visit', visit._id);
  const doc = documentOf(ctx, 'OPConsultation', ref);
  const d = visit.details ?? {};
  const p = visit.prescription ?? {};
  const signer = doc.practitioner(visit.signed);
  const encounter = visitEncounter(doc, visit);
  const sections = [];
  if (d.complaints) sections.push(doc.section('Chief complaints', snomed('422843007', 'Chief complaint section'), [doc.condition(d.complaints, 'problem-list-item', visit.signed?.at)], [d.complaints]));
  const observations = visitObservations(doc, visit);
  if (observations.length) sections.push(doc.section('Physical examination', snomed('425044008', 'Physical exam section'), observations.map((o) => o.resource), observations.map((o) => o.line)));
  if (d.diagnosis) sections.push(doc.section('Diagnosis', snomed('439401001', 'Diagnosis'), [doc.condition(d.diagnosis, 'encounter-diagnosis', visit.signed?.at)], [d.diagnosis]));
  if (d.investigations) {
    const request = doc.add({ resourceType: 'ServiceRequest', meta: profile('ServiceRequest'), text: narrative([d.investigations]), status: 'active', intent: 'order', code: { text: d.investigations }, subject: doc.patientRef, ...(signer ? { requester: doc.ref(signer, signer.name[0].text) } : {}) });
    sections.push(doc.section('Investigation advice', snomed('721963009', 'Order document'), [request], [d.investigations]));
  }
  const items = list(p.items);
  if (items.length) {
    const meds = items.map((it) => doc.medicationRequest(it, p.at ?? visit.signed?.at, signer));
    sections.push(doc.section('Medications', snomed('721912009', 'Medication summary document'), meds, [...items.map((it) => `${medicineName(it)} – ${dosageText(it)}`), p.notes]));
  }
  if (d.advice) sections.push(doc.section('Advice', null, [], [d.advice]));
  if (d.nextVisitOn || d.nextVisitNote) sections.push(doc.section('Follow up', snomed('390906007', 'Follow-up encounter'), [doc.followUp(d.nextVisitOn, d.nextVisitNote)], [`Next visit${d.nextVisitOn ? ` on ${dateWords(d.nextVisitOn)}` : ''}${d.nextVisitNote ? ` – ${d.nextVisitNote}` : ''}`]));
  sections.push(...doc.additionsSection(visit.additions));
  return doc.finish({ date: visit.signed?.at ?? visit.visitOn, authors: [signer], attester: { party: signer, at: visit.signed?.at }, encounter, sections, amended: list(visit.additions).length > 0 });
}

function prescriptionRecord(ctx, visit) {
  const ref = referenceOf('visit', visit._id);
  const doc = documentOf(ctx, 'Prescription', ref);
  const p = visit.prescription ?? {};
  const signer = doc.practitioner(visit.signed);
  const items = list(p.items);
  const meds = items.map((it) => doc.medicationRequest(it, p.at ?? visit.signed?.at, signer));
  const sections = [doc.section('Prescription', snomed('440545006', 'Prescription record'), meds, [...items.map((it) => `${medicineName(it)} – ${dosageText(it)}`), p.notes])];
  return doc.finish({ date: visit.signed?.at ?? visit.visitOn, authors: [signer], attester: { party: signer, at: visit.signed?.at }, encounter: null, sections, amended: false });
}

// ---------- Reviewed lab results: DiagnosticReportRecord ----------

const FLAG_CODES = { low: ['L', 'Low'], high: ['H', 'High'], abnormal: ['A', 'Abnormal'], normal: ['N', 'Normal'] };

/** The document of reviewed lab results, without the confidential tests (shareRules.sharedTests). */
export function labDocuments(ctx, order) {
  const ref = referenceOf('lab', order._id);
  const doc = documentOf(ctx, 'DiagnosticReport', ref);
  const reviewer = doc.practitioner(order.reviewed);
  const amended = list(order.amendments).length > 0;
  const status = amended ? 'amended' : 'final';
  const sampleAt = order.collected?.at && !sampleStampedByReport(order) ? order.collected.at : null;
  const lines = [];
  const reports = sharedTests(order).map((t) => {
    const catalogue = testByKey.get(t.key);
    const results = [];
    const testLines = [t.name];
    for (const v of list(t.values)) {
      if (v.value === '' || v.value == null) continue;
      const field = catalogue?.fields.find((f) => f.key === v.key);
      const name = field?.name ?? v.key;
      const n = Number(v.value);
      const isNumber = field?.type === 'number' && v.value !== '' && Number.isFinite(n);
      const flag = FLAG_CODES[v.flag];
      results.push(
        doc.add({
          resourceType: 'Observation',
          meta: profile('Observation'),
          text: narrative([`${name}: ${v.value}${isNumber && field.unit ? ` ${field.unit}` : ''}${flag && v.flag !== 'normal' ? ` (${flag[1]})` : ''}`]),
          status,
          category: [concept('http://terminology.hl7.org/CodeSystem/observation-category', 'laboratory', 'Laboratory')],
          code: { text: name },
          subject: doc.patientRef,
          ...(sampleAt ? { effectiveDateTime: iso(sampleAt) } : {}),
          ...(order.reported?.at ? { issued: iso(order.reported.at) } : {}),
          ...(isNumber ? { valueQuantity: { value: n, ...(field.unit ? { unit: field.unit } : {}) } } : { valueString: String(v.value) }),
          ...(flag ? { interpretation: [concept(INTERPRETATION, flag[0], flag[1])] } : {}),
          ...(field?.type === 'number' && field.range ? { referenceRange: [{ text: field.range }] } : {}),
        }),
      );
      testLines.push(`${name}: ${v.value}${isNumber && field.unit ? ` ${field.unit}` : ''}${flag && v.flag !== 'normal' ? ` (${flag[1]})` : ''}${field?.type === 'number' && field.range ? ` – reference ${field.range}` : ''}`);
    }
    if (t.text) testLines.push(t.text);
    lines.push(testLines.join(' · '));
    return doc.add({
      resourceType: 'DiagnosticReport',
      meta: profile('DiagnosticReportLab'),
      text: narrative(testLines),
      status,
      category: [concept(V2_0074, 'LAB', 'Laboratory')],
      code: { text: t.name },
      subject: doc.patientRef,
      ...(sampleAt ? { effectiveDateTime: iso(sampleAt) } : {}),
      ...(order.reported?.at ? { issued: iso(order.reported.at) } : {}),
      performer: [doc.orgRef],
      ...(reviewer ? { resultsInterpreter: [doc.ref(reviewer, reviewer.name[0].text)] } : {}),
      ...(results.length ? { result: results.map((r) => doc.ref(r)) } : {}),
      ...(t.text ? { conclusion: t.text } : {}),
    });
  });
  const sections = [doc.section('Lab results', snomed('721981007', 'Diagnostic studies report'), reports, [...lines, order.labNote ? `Remarks from the lab: ${order.labNote}` : null, amended ? 'Results changed after the first report (the values shown are the current ones).' : null])];
  return [{ hiType: 'DiagnosticReport', bundle: doc.finish({ date: order.reviewed?.at ?? order.reported?.at, authors: [reviewer], attester: { party: reviewer, at: order.reviewed?.at }, encounter: null, sections, amended }) }];
}

// ---------- A confirmed discharge card: DischargeSummaryRecord ----------

/** The discharge summary; `admission`: its stay (for the dates in hospital). */
export function dischargeDocuments(ctx, document, admission) {
  const ref = referenceOf('discharge', document._id);
  const doc = documentOf(ctx, 'DischargeSummary', ref);
  const c = document.content ?? {};
  const signer = doc.practitioner(document.signed);
  const end = c.dischargedAt ?? admission?.dischargedAt ?? null;
  const encounter = doc.add({
    resourceType: 'Encounter',
    meta: profile('Encounter'),
    text: narrative([`In hospital${admission?.admittedAt ? ` from ${dateWords(toHospitalDate(admission.admittedAt))}` : ''}${end ? ` to ${dateWords(toHospitalDate(end))}` : ''}`]),
    status: 'finished',
    class: { system: ACT_CODE, code: 'IMP', display: 'inpatient encounter' },
    subject: doc.patientRef,
    period: { ...(admission?.admittedAt ? { start: iso(admission.admittedAt) } : {}), ...(end ? { end: iso(end) } : {}) },
  });
  const sections = [];
  if (c.finalDiagnosis) sections.push(doc.section('Diagnosis', snomed('439401001', 'Diagnosis'), [doc.condition(c.finalDiagnosis, 'encounter-diagnosis', document.signed?.at)], [c.finalDiagnosis]));
  if (c.course) sections.push(doc.section('Course in hospital', null, [], [c.course]));
  if (c.procedures) {
    const procedure = doc.add({ resourceType: 'Procedure', meta: profile('Procedure'), text: narrative([c.procedures]), status: 'completed', code: { text: c.procedures }, subject: doc.patientRef });
    sections.push(doc.section('Procedures', snomed('371525003', 'Clinical procedure report'), [procedure], [c.procedures]));
  }
  if (c.conditionAtDischarge) sections.push(doc.section('Condition at discharge', null, [], [c.conditionAtDischarge]));
  const items = list(c.medicines);
  if (items.length) {
    const meds = items.map((it) => doc.medicationRequest(it, document.signed?.at, signer));
    sections.push(doc.section('Medications', snomed('721912009', 'Medication summary document'), meds, items.map((it) => `${medicineName(it)} – ${dosageText(it)}`)));
  }
  if (c.advice) sections.push(doc.section('Advice', null, [], [c.advice]));
  const followOn = c.followUpOn ? utcDay(c.followUpOn) : null;
  if (followOn || c.followUpNote) sections.push(doc.section('Follow up', snomed('390906007', 'Follow-up encounter'), [doc.followUp(followOn, c.followUpNote)], [`Next visit${followOn ? ` on ${dateWords(followOn)}` : ''}${c.followUpNote ? ` – ${c.followUpNote}` : ''}`]));
  sections.push(...doc.additionsSection(document.additions));
  return [{ hiType: 'DischargeSummary', bundle: doc.finish({ date: document.signed?.at ?? end, authors: [signer], attester: { party: signer, at: document.signed?.at }, encounter, sections, amended: list(document.additions).length > 0 }) }];
}
