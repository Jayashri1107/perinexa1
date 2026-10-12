// Practice mode, ABDM milestone M3: two made-up "other hospitals" that hold records for any practice patient and send
// them when she agrees – so fetching her records from other hospitals can be tried without ABDM. Every document says
// it is made up ("PRACTICE – made-up record"). They are built with the same FHIR builders Perinexa uses to share its
// own records (fhirRecords.js), so the reading side (fhirReader.js) is tried on real-shaped documents.
//
// What they show on purpose:
//  - a consultation whose examination mentions the baby's sex ("Sex of the fetus was not disclosed.") – the
//    fetal-sex guard withholds that sentence;
//  - an attached PDF (offered as a download) and an attached web page (not on the safe list – left out);
//  - a prescription, a discharge summary, a lab report with a Low mark, and a vaccination record.

import { randomUUID } from 'node:crypto';
import { addDays, hospitalToday, isoDay } from '../careplans/dates.js';
import { dischargeDocuments, labDocuments, visitDocuments } from './fhirRecords.js';
import { withinRange } from './shareRules.js';

export const PRACTICE_HIPS = [
  { id: 'PRACTICE-HIP-CITY', name: 'Sample City Hospital (practice)' },
  { id: 'PRACTICE-HIP-LAB', name: 'Sample Town Lab (practice)' },
];
export const PRACTICE_MARK = 'PRACTICE – made-up record, not a real patient.';
/** The sentence of the practice consultation that the fetal-sex guard must withhold. */
export const PRACTICE_SEX_SENTENCE = 'Sex of the fetus was not disclosed.';

const SNOMED = 'http://snomed.info/sct';
const NRCES = 'https://nrces.in/ndhm/fhir/r4/StructureDefinition/';

// ---------- A tiny real PDF (so the download opens) ----------

/** A one-page PDF with these lines of plain ASCII text (Helvetica). */
export function practicePdf(lines) {
  const esc = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `${i ? '0 -22 Td ' : ''}(${esc(l)}) Tj`).join(' ');
  const stream = `BT /F1 14 Tf 60 780 Td ${text} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- The records ----------

const DOCTOR = { by: 'practice-doctor', byName: 'Dr Practice Sample' };
const PATHOLOGIST = { by: 'practice-pathologist', byName: 'Dr Practice Pathologist' };

/** Adds attached files to a document: a DocumentReference with its attachments, and a section that lists it. */
function attach(bundle, { title, attachments }) {
  const id = randomUUID();
  const ref = { resourceType: 'DocumentReference', id, meta: { profile: [`${NRCES}DocumentReference`] }, status: 'current', type: { text: title }, description: title, content: attachments.map((attachment) => ({ attachment })) };
  bundle.entry.push({ fullUrl: `urn:uuid:${id}`, resource: ref });
  bundle.entry[0].resource.section.push({ title: 'Attached documents', code: { text: 'Attached documents' }, entry: [{ reference: `urn:uuid:${id}` }] });
  return bundle;
}

/** A vaccination record (the NRCeS ImmunizationRecord), built here: Perinexa does not share vaccinations itself. */
function immunizationRecord(ctx, { reference, on }) {
  const add = (r) => ({ id: randomUUID(), ...r });
  const patient = add({ resourceType: 'Patient', name: [{ text: ctx.patient.fullName }], gender: 'female' });
  const org = add({ resourceType: 'Organization', name: ctx.hospital.name });
  const doctor = add({ resourceType: 'Practitioner', name: [{ text: DOCTOR.byName }] });
  const at = (r) => ({ reference: `urn:uuid:${r.id}` });
  const vaccine = add({
    resourceType: 'Immunization',
    status: 'completed',
    vaccineCode: { coding: [{ system: SNOMED, code: '871826000', display: 'Tetanus and diphtheria vaccine' }], text: 'Td (tetanus and adult diphtheria) vaccine' },
    patient: at(patient),
    occurrenceDateTime: isoDay(on),
    lotNumber: 'PRACTICE-LOT-1',
    protocolApplied: [{ doseNumberPositiveInt: 1 }],
    note: [{ text: PRACTICE_MARK }],
  });
  const composition = add({
    resourceType: 'Composition',
    meta: { profile: [`${NRCES}ImmunizationRecord`] },
    status: 'final',
    type: { coding: [{ system: SNOMED, code: '41000179103', display: 'Immunization record' }], text: 'Immunization record' },
    subject: at(patient),
    date: new Date(on.getTime() + 5 * 3600 * 1000).toISOString(),
    author: [at(doctor)],
    title: 'Immunization record',
    custodian: at(org),
    section: [{ title: 'Vaccinations', code: { coding: [{ system: SNOMED, code: '41000179103', display: 'Immunization record' }] }, entry: [at(vaccine)] }],
  });
  const all = [composition, patient, org, doctor, vaccine];
  return [{ hiType: 'ImmunizationRecord', reference, bundle: { resourceType: 'Bundle', id: randomUUID(), meta: { profile: [`${NRCES}DocumentBundle`] }, identifier: { system: `urn:practice:${ctx.hospital.key}:bundle`, value: reference }, type: 'document', timestamp: new Date().toISOString(), entry: all.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })) } }];
}

/**
 * The practice records of each practice hospital: { reference, hiTypes, daysAgo, documents(ctx, on) }. `on` is the
 * record's day (midnight UTC); documents → [{ hiType, bundle }].
 */
export const PRACTICE_RECORDS = {
  'PRACTICE-HIP-CITY': [
    {
      reference: 'CITY-OPD-40',
      hiTypes: ['OPConsultation', 'Prescription'],
      daysAgo: 40,
      documents(ctx, on) {
        const at = new Date(on.getTime() + 5 * 3600 * 1000);
        const visit = {
          _id: 'practice-city-opd-40',
          visitOn: on,
          status: 'active',
          signed: { ...DOCTOR, role: 'doctor', at },
          vitals: { weightKg: 61, bpSystolic: 112, bpDiastolic: 72, pulse: 88, hb: 10.4 },
          details: {
            complaints: `Tiredness for two weeks. ${PRACTICE_MARK}`,
            examination: `Pallor present. Ultrasound seen: single live fetus, growth normal. ${PRACTICE_SEX_SENTENCE}`,
            diagnosis: 'Practice: mild anaemia in pregnancy',
            investigations: 'CBC after 4 weeks',
            advice: 'Iron-rich diet. Review in 4 weeks.',
            fundalHeightCm: 24,
            fetalHeartRate: 142,
            nextVisitOn: addDays(on, 28),
          },
          prescription: {
            at,
            items: [
              { drug: 'Ferrous sulphate', form: 'tab', strength: '200 mg', dose: '1', frequency: '1-0-1', timing: 'after_food', durationValue: 30, durationUnit: 'days' },
              { drug: 'Folic acid', form: 'tab', strength: '5 mg', dose: '1', frequency: '1-0-0', timing: 'after_food', durationValue: 30, durationUnit: 'days' },
            ],
            notes: 'Practice prescription – not real.',
          },
        };
        return visitDocuments(ctx, visit).map((d) =>
          d.hiType === 'OPConsultation'
            ? {
                ...d,
                bundle: attach(d.bundle, {
                  title: 'Practice ultrasound report',
                  attachments: [
                    { contentType: 'application/pdf', title: 'Practice ultrasound report (made up).pdf', data: practicePdf(['PRACTICE - made-up ultrasound report', ctx.hospital.name, 'Not a real patient. For trying Perinexa only.', 'Single live intrauterine pregnancy. Growth normal.']).toString('base64') },
                    { contentType: 'text/html', title: 'Practice web page', data: Buffer.from('<html><body><p>Practice web page - never offered as a download.</p></body></html>').toString('base64') },
                  ],
                }),
              }
            : d,
        );
      },
    },
    {
      reference: 'CITY-DS-100',
      hiTypes: ['DischargeSummary'],
      daysAgo: 100,
      documents(ctx, on) {
        const admittedAt = new Date(on.getTime() - 2 * 86_400_000 + 4 * 3600 * 1000);
        const dischargedAt = new Date(on.getTime() + 6 * 3600 * 1000);
        const doc = {
          _id: 'practice-city-ds-100',
          status: 'signed',
          signed: { ...DOCTOR, role: 'doctor', at: dischargedAt },
          content: {
            dischargedAt,
            finalDiagnosis: 'Practice: hyperemesis gravidarum, settled',
            course: `IV fluids and anti-emetics for two days. ${PRACTICE_MARK}`,
            conditionAtDischarge: 'Well, eating and drinking',
            medicines: [{ drug: 'Doxylamine + Pyridoxine', form: 'tab', strength: '10 mg + 10 mg', dose: '1', frequency: '0-0-1', timing: 'bedtime', durationValue: 10, durationUnit: 'days' }],
            advice: 'Small frequent meals. Come back if vomiting returns.',
            followUpOn: addDays(on, 7),
          },
        };
        return dischargeDocuments(ctx, doc, { admittedAt, dischargedAt });
      },
    },
  ],
  'PRACTICE-HIP-LAB': [
    {
      reference: 'LAB-CBC-20',
      hiTypes: ['DiagnosticReport'],
      daysAgo: 20,
      documents(ctx, on) {
        const at = new Date(on.getTime() + 6 * 3600 * 1000);
        const order = {
          _id: 'practice-lab-cbc-20',
          status: 'reviewed',
          collected: { at: new Date(on.getTime() + 3 * 3600 * 1000) },
          reported: { at },
          reviewed: { ...PATHOLOGIST, at },
          tests: [
            { key: 'cbc', name: 'Complete blood count (CBC)', values: [{ key: 'hb', value: '10.1', flag: 'low' }, { key: 'tlc', value: '9000', flag: 'normal' }, { key: 'platelets', value: '2.4', flag: 'normal' }] },
            { key: 'tsh', name: 'TSH (thyroid)', values: [{ key: 'tsh', value: '2.1', flag: 'normal' }] },
          ],
          labNote: PRACTICE_MARK,
        };
        return labDocuments(ctx, order);
      },
    },
    {
      reference: 'LAB-TD-60',
      hiTypes: ['ImmunizationRecord'],
      daysAgo: 60,
      documents: (ctx, on) => immunizationRecord(ctx, { reference: 'LAB-TD-60', on }),
    },
  ],
};

/** The day of a practice record (the hospital's day, as midnight UTC). */
export const practiceDay = (record, now = new Date()) => addDays(hospitalToday(now), -record.daysAgo);

/**
 * What a practice hospital would put in her consent: its records of the kinds asked for and inside the dates.
 * → [{ hip, records: [record] }] (hospitals with nothing for her are left out, as ABDM does).
 */
export function practiceMatches({ hiTypes, from, to }, now = new Date()) {
  return PRACTICE_HIPS.map((hip) => ({
    hip,
    records: PRACTICE_RECORDS[hip.id].filter((r) => r.hiTypes.some((t) => hiTypes.includes(t)) && withinRange(practiceDay(r, now), from, to)),
  })).filter((x) => x.records.length);
}

/** The FHIR documents of one practice record, of the kinds in the consent: [{ hiType, bundle }]. */
export function practiceDocuments(hipId, reference, { hiTypes, patientName, now = new Date() }) {
  const hip = PRACTICE_HIPS.find((h) => h.id === hipId);
  const record = PRACTICE_RECORDS[hipId]?.find((r) => r.reference === reference);
  if (!hip || !record) return [];
  const ctx = { hospital: { name: hip.name, key: hip.id, hfrId: '' }, patient: { mrn: `${hip.id}-SAMPLE-1`, fullName: patientName || 'Practice patient (made up)', careType: 'antenatal', abhaNumber: null }, people: new Map(), now };
  return record.documents(ctx, practiceDay(record, now)).filter((d) => hiTypes.includes(d.hiType));
}
