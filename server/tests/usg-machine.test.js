// The ultrasound machine on the LAN (docs/USG_MACHINE_PLAN.md): the readings in a structured report and the average
// table, the scan bridge's key and worklist, a study sent by the machine matched to its order, its pictures and readings
// used in the report, a study linked by hand, and the bridge program's own pieces. All fake sample data: the structured
// report below is made up in the shape Orthanc gives it, with no real patient.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { fieldFor, inUnit, readingsFromSr, sameName, tableOf, usedValue } from '../src/imaging/machineReadings.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { MachineStudy } from '../src/models/MachineStudy.js';
import { dicomMoment, settingsFrom, skipAfter, studyPayload, worklistTags } from '../../scan-bridge/bridge.mjs';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-10-29T05:00:00Z');
const ROLES = { drA: 'doctor', rmo: 'rmo', sono: 'sonographer', reception: 'receptionist', admin: 'admin' };

// A made-up OB structured report (DICOM TID 5000) as Orthanc's simplified JSON: fetal biometry for fetus A with three
// BPD readings and the machine's mean, HC in cm, AC, FL, AFI, the heart rate, a measurement Perinexa does not know, a
// ratio, and an item about the fetus's sex that must be dropped.
const code = (CodeValue, CodeMeaning, CodingSchemeDesignator = 'LN') => [{ CodeValue, CodeMeaning, CodingSchemeDesignator }];
const num = (c, meaning, value, unit, extra = {}) => ({
  ValueType: 'NUM',
  RelationshipType: 'CONTAINS',
  ConceptNameCodeSequence: code(c, meaning),
  MeasuredValueSequence: [{ NumericValue: String(value), MeasurementUnitsCodeSequence: code(unit, unit, 'UCUM') }],
  ...extra,
});
const mean = { ContentSequence: [{ ValueType: 'CODE', RelationshipType: 'HAS CONCEPT MOD', ConceptNameCodeSequence: code('121401', 'Derivation', 'DCM'), ConceptCodeSequence: code('R-00317', 'Mean', 'SRT') }] };
const SR = [
  { ValueType: 'TEXT', ConceptNameCodeSequence: code('121106', 'Comment', 'DCM'), TextValue: 'Sample study' },
  {
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: code('125002', 'Fetal Biometry', 'DCM'),
    ContentSequence: [
      { ValueType: 'TEXT', RelationshipType: 'HAS OBS CONTEXT', ConceptNameCodeSequence: code('11951-1', 'Fetus ID'), TextValue: 'A' },
      num('11820-8', 'Biparietal Diameter', 78.1, 'mm'),
      num('11820-8', 'Biparietal Diameter', 78.6, 'mm'),
      num('11820-8', 'Biparietal Diameter', 77.9, 'mm'),
      num('11820-8', 'Biparietal Diameter', 78.2, 'mm', mean),
      num('11984-2', 'Head Circumference', 28.5, 'cm'),
      num('11984-2', 'Head Circumference', 28.9, 'cm'),
      num('99VENDOR', 'AC', 270.4, 'mm'),
      num('11963-6', 'Femur Length', 60.2, 'mm'),
      num('11948-7', 'Fetal Heart Rate', 142, '{H.B.}/min'),
      num('99VENDOR', 'Transcerebellar diameter', 35.1, 'mm'),
      num('99VENDOR', 'FL/AC', 22.3, '%'),
      { ValueType: 'CODE', ConceptNameCodeSequence: code('99SEX', 'Fetal sex', '99V'), ConceptCodeSequence: code('X', 'Not stated', '99V') },
    ],
  },
  { ValueType: 'CONTAINER', ConceptNameCodeSequence: code('121070', 'Findings', 'DCM'), ContentSequence: [num('11627-7', 'Amniotic Fluid Index', 12.1, 'cm')] },
];

describe('readings from the structured report (pure)', () => {
  it('matches by code, then by words; converts units; keeps unknown ones as not matched; drops the fetal sex', () => {
    const { readings, unmatched, dropped } = readingsFromSr(SR, '1.2.3');
    expect(dropped).toBe(1);
    expect(JSON.stringify({ readings, unmatched })).not.toMatch(/sex/i);
    const bpd = readings.filter((r) => r.key === 'bpd');
    expect(bpd.map((r) => [r.value, r.derived])).toEqual([[78.1, null], [78.6, null], [77.9, null], [78.2, 'mean']]);
    expect(readings.filter((r) => r.key === 'hc').map((r) => r.value)).toEqual([285, 289]); // cm → mm
    expect(readings.find((r) => r.key === 'ac')).toMatchObject({ value: 270.4, fetus: 'A' }); // the machine's own code, by its name
    expect(readings.find((r) => r.key === 'fhr').value).toBe(142);
    expect(readings.find((r) => r.key === 'afi').value).toBe(12.1);
    expect(unmatched.map((u) => u.meaning)).toEqual(['Transcerebellar diameter', 'FL/AC']); // a ratio is never a length
  });

  it('the average table and its rules', () => {
    const [bpd, hc] = tableOf(readingsFromSr(SR).readings, 'A');
    expect(bpd).toEqual({ key: 'bpd', name: 'BPD', unit: 'mm', readings: [78.1, 78.6, 77.9], machine: { value: 78.2, derived: 'mean' } });
    expect(usedValue(bpd)).toBe(78.2);
    expect(usedValue(bpd, { ticked: [true, false, true] })).toBe(78);
    expect(usedValue(bpd, { use: 'last', ticked: [true, true, false] })).toBe(78.6);
    expect(usedValue(bpd, { use: 'machine' })).toBe(78.2);
    expect(usedValue(bpd, { use: 'reading', reading: 2 })).toBe(77.9);
    expect(usedValue(bpd, { ticked: [false, false, false] })).toBeNull();
    expect(usedValue(hc)).toBe(287);
    expect(usedValue({ readings: [], machine: { value: 12 }, unit: 'cm' })).toBe(12); // only the machine's value
  });

  it('units, words and names', () => {
    expect(inUnit(2.85, 'cm', 'mm')).toBe(28.5);
    expect(inUnit(1.85, 'kg', 'g')).toBe(1850);
    expect(inUnit(5, 'mm', 'cm')).toBe(0.5);
    expect(inUnit(140, '/min', 'bpm')).toBe(140);
    expect(inUnit(5, 'furlong', 'mm')).toBeNull();
    expect(fieldFor('', 'GA by BPD')).toBeNull();
    expect(fieldFor('', 'BPD (Hadlock)')?.key).toBe('bpd');
    expect(fieldFor('', 'Acceleration time')).toBeNull();
    expect(sameName('SAMPLE^ASHA', 'Asha Sample')).toBe(true);
    expect(sameName('DUMMY^ONE', 'Asha Sample')).toBe(false);
  });
});

describe('the scan bridge program (pure)', () => {
  it('settings, DICOM dates, the worklist tags, the study it sends, and what it gives up on', () => {
    expect(settingsFrom({ PERINEXA_URL: 'http://perinexa.example.in', BRIDGE_KEY: 'x' }).problems).toHaveLength(2);
    expect(settingsFrom({ PERINEXA_URL: 'http://localhost:4000', BRIDGE_KEY: 'k'.repeat(43) }).problems).toEqual([]);
    expect(dicomMoment('20261029', '103000.123')).toBe(new Date(2026, 9, 29, 10, 30, 0).toISOString());
    expect(dicomMoment('', '')).toBeNull();
    const tags = worklistTags({ accession: 'US00000001', patientId: 'P-000001', patientName: 'Asha Sample', age: 29, studyName: 'USG growth', scheduledFor: null }, { now: new Date(2026, 9, 29, 9, 5), aet: 'USG1' });
    expect(tags).toMatchObject({ PatientID: 'P-000001', PatientAge: '029Y', AccessionNumber: 'US00000001' });
    expect(tags.ScheduledProcedureStepSequence[0]).toMatchObject({ Modality: 'US', ScheduledStationAETitle: 'USG1', ScheduledProcedureStepStartDate: '20261029', ScheduledProcedureStepStartTime: '090500' });
    expect(JSON.stringify(tags)).not.toMatch(/sex/i);
    const payload = studyPayload({ MainDicomTags: { StudyInstanceUID: '1.2.3', AccessionNumber: 'US00000001 ', StudyDate: '20261029' }, PatientMainDicomTags: { PatientID: 'P-000001', PatientName: 'SAMPLE^ASHA' } }, { Manufacturer: 'Sample', ManufacturerModelName: 'U1' }, []);
    expect(payload).toMatchObject({ studyUid: '1.2.3', accession: 'US00000001', patientName: 'SAMPLE^ASHA', manufacturer: 'Sample', model: 'U1' });
    expect(skipAfter({ from: 'orthanc', status: 404 })).toBe(true);
    expect(skipAfter({ from: 'perinexa', status: 400 })).toBe(true);
    expect(skipAfter({ from: 'perinexa', status: 401 })).toBe(false);
    expect(skipAfter({ from: 'perinexa', status: 503 })).toBe(false);
    expect(skipAfter(new Error('network'))).toBe(false);
  });
});

describe('the ultrasound machine through the scan bridge', () => {
  let app;
  let hospital;
  let people;
  let sessions;
  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetTestDb();
    app = createApp();
    hospital = await createTenant('Machine Hospital');
    people = {};
    sessions = {};
    for (const [key, role] of Object.entries(ROLES)) {
      people[key] = await createUser({ name: `Sample ${key}` });
      await addMember(people[key], hospital, role);
    }
  });
  afterEach(() => vi.useRealTimers());

  const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
  const bridge = (key) => ({
    get: (path) => request(app).get(`/api/scan-bridge${path}`).set('Authorization', `Bearer ${key}`),
    post: (path, body) => request(app).post(`/api/scan-bridge${path}`).set('Authorization', `Bearer ${key}`).send(body),
  });
  const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)]).toString('base64');
  async function mother(name = 'Asha Sample') {
    const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: name, assignedDoctor: people.drA._id.toString(), pregnancy: { scanEdd: '2027-01-10' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.patient;
  }
  const order = async (p, study = 'usg_growth') => (await (await as('drA')).post(`/api/patients/${p.id}/imaging`).send({ clientRequestId: randomUUID(), study })).body.study;
  const makeKey = async () => {
    const res = await (await as('admin')).post('/api/tenant/scan-bridge/key');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.key;
  };

  it('the hospital admin makes the key (shown once); a new one stops the old; switched off, the bridge is refused', async () => {
    expect((await (await as('drA')).post('/api/tenant/scan-bridge/key')).status).toBe(403);
    expect((await bridge('k'.repeat(43)).get('/worklist')).status).toBe(401);
    const first = await makeKey();
    expect((await bridge(first).get('/worklist')).status).toBe(200);
    const status = (await (await as('admin')).get('/api/tenant/scan-bridge')).body.bridge;
    expect(status).toMatchObject({ on: true, keyHint: first.slice(-4), madeByName: 'Sample admin', keepDays: 30 });
    expect(JSON.stringify(status)).not.toContain(first);
    const second = await makeKey();
    expect((await bridge(first).get('/worklist')).status).toBe(401);
    expect((await bridge(second).get('/worklist')).status).toBe(200);
    expect((await (await as('admin')).delete('/api/tenant/scan-bridge/key')).body.bridge.on).toBe(false);
    expect((await bridge(second).get('/worklist')).status).toBe(401);
    const actions = (await AuditLog.find({ tenantId: hospital._id }).lean()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['SCAN_BRIDGE_KEY_MADE', 'SCAN_BRIDGE_SWITCHED_OFF']));
  });

  it('worklist → machine → matched study; pictures chosen with the PCPNDT confirmation; the average table fills the report; review and sign', async () => {
    const key = await makeKey();
    const p = await mother();
    let s = await order(p);
    await order(p, 'xray'); // not an ultrasound: never on the machine's worklist
    const items = (await bridge(key).get('/worklist')).body.items;
    expect(items).toEqual([expect.objectContaining({ accession: 'US00000001', patientId: p.mrn, patientName: 'Asha Sample', study: 'usg_growth' })]);
    expect((await bridge(key).get('/worklist')).body.items[0].accession).toBe('US00000001'); // kept
    expect(JSON.stringify(items)).not.toMatch(/sex|indication/i);
    s = (await (await as('drA')).get(`/api/imaging/${s.id}`)).body.study;
    expect(s.accession).toBe('US00000001');

    // The machine sends the study with the scan number, then its pictures
    const study = { studyUid: '1.2.826.0.1.1', accession: 'US00000001', patientId: p.mrn, patientName: 'SAMPLE^ASHA', studyAt: '2026-10-29T05:30:00.000Z', manufacturer: 'Sample Maker', model: 'U1', srs: [{ sopUid: '1.2.826.0.1.1.9', content: SR }] };
    const sent = await bridge(key).post('/studies', study);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body).toMatchObject({ matched: true, readings: 10 });
    expect((await bridge(key).post('/studies', study)).status).toBe(200); // sent again: the same readings, not doubled
    expect((await MachineStudy.findOne({ tenantId: hospital._id, studyUid: study.studyUid })).readings).toHaveLength(10);
    expect((await bridge(key).post(`/studies/${study.studyUid}/images`, { sopUid: '1.2.826.0.1.1.20', mediaType: 'image/jpeg', data: jpeg(1) })).status).toBe(201);
    expect((await bridge(key).post(`/studies/${study.studyUid}/images`, { sopUid: '1.2.826.0.1.1.21', mediaType: 'image/jpeg', data: jpeg(2) })).status).toBe(201);
    expect((await bridge(key).post(`/studies/${study.studyUid}/images`, { sopUid: '1.2.826.0.1.1.20', mediaType: 'image/jpeg', data: jpeg(1) })).body.duplicate).toBe(true);
    expect((await bridge(key).post(`/studies/${study.studyUid}/images`, { sopUid: '1.2.826.0.1.1.22', mediaType: 'image/jpeg', data: Buffer.from('not a picture').toString('base64') })).status).toBe(400);
    const stored = await MachineStudy.findOne({ tenantId: hospital._id, studyUid: study.studyUid }).lean();
    expect(stored.droppedSex).toBe(1);
    expect(JSON.stringify([...stored.readings, ...stored.unmatched])).not.toMatch(/sex/i);

    // On her scan: who may see it, and what it shows
    expect((await (await as('reception')).get(`/api/imaging/${s.id}/machine`)).status).toBe(403);
    const machine = (await (await as('sono')).get(`/api/imaging/${s.id}/machine`)).body;
    expect(machine.defaultUse).toBe('average');
    const [m] = machine.studies;
    expect(m).toMatchObject({ matchedBy: 'worklist', machine: 'Sample Maker U1', nameDiffers: false, droppedSex: 1 });
    expect(m.images).toHaveLength(2);
    expect(m.fetuses[0].rows.map((r) => [r.key, r.inTemplate])).toEqual([['bpd', true], ['hc', true], ['ac', true], ['fl', true], ['fhr', true], ['afi', true]]);
    expect(m.unmatched.map((u) => u.meaning)).toEqual(['Transcerebellar diameter', 'FL/AC']);
    const picture = await (await as('drA')).get(`/api/imaging/machine/${m.id}/images/${m.images[0].id}`);
    expect(picture.status).toBe(200);
    expect(picture.headers['content-type']).toBe('image/jpeg');

    // Before the scan is done: nothing goes in
    const fill = (who, study, rows) => as(who).then((a) => a.post(`/api/imaging/${study.id}/machine/${m.id}/fill`).send({ rev: study.rev, fetus: 'A', rows }));
    const pictures = (who, study, body) => as(who).then((a) => a.post(`/api/imaging/${study.id}/machine/${m.id}/pictures`).send({ rev: study.rev, ...body }));
    expect((await fill('sono', s, [{ key: 'bpd' }])).status).toBe(403);
    s = (await (await as('sono')).post(`/api/imaging/${s.id}/done`).send({ rev: s.rev })).body.study;

    // Pictures: only with the confirmation that they do not show the baby's sex
    expect((await pictures('sono', s, { imageIds: [m.images[0].id] })).status).toBe(400);
    let res = await pictures('sono', s, { imageIds: [m.images[0].id], noSexShown: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    s = res.body.study;
    expect(s.images).toEqual([expect.objectContaining({ fileName: 'machine-1.jpg', inPrint: true, byName: 'Sample sono' })]);
    expect((await pictures('sono', s, { imageIds: [m.images[0].id], noSexShown: true })).body.added).toBe(0); // already in

    // The average table: BPD without its second reading, HC the last one, AC the only one; the rest left out
    res = await fill('sono', s, [
      { key: 'bpd', ticked: [true, false, true] },
      { key: 'hc', use: 'last' },
      { key: 'ac' },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    s = res.body.study;
    expect(s.report.values).toMatchObject({ bpd: 78, hc: 289, ac: 270.4 });
    expect(s.report.values.fl).toBeUndefined();
    expect(s.report.machine).toMatchObject({ fetus: 'A', machine: 'Sample Maker U1', byName: 'Sample sono' });
    expect(s.report.machine.rows[0]).toMatchObject({ key: 'bpd', readings: [78.1, 78.6, 77.9], ticked: [true, false, true], use: 'average', value: 78, edited: false });

    // Changed by hand afterwards: marked, and the machine's record stays
    res = await (await as('sono')).put(`/api/imaging/${s.id}/report`).send({ rev: s.rev, values: { ...s.report.values, bpd: 78.5 }, findings: 'Single live intrauterine fetus.', impression: 'Growth appropriate.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    s = res.body.study;
    expect(s.report.machine.rows.find((r) => r.key === 'bpd')).toMatchObject({ value: 78, edited: true });

    // Finalised by a doctor (the sonographer cannot sign); a signed report takes no more readings
    expect((await (await as('sono')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).status).toBe(403);
    s = (await (await as('drA')).post(`/api/imaging/${s.id}/sign`).send({ rev: s.rev })).body.study;
    expect(s.status).toBe('signed');
    expect((await fill('drA', s, [{ key: 'fl' }])).status).toBe(403);

    const actions = (await AuditLog.find({ tenantId: hospital._id }).lean()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['SCAN_BRIDGE_STUDY_RECEIVED', 'IMAGING_MACHINE_VIEWED', 'MACHINE_IMAGE_VIEWED', 'IMAGING_IMAGE_ADDED', 'IMAGING_MACHINE_READINGS_USED']));
    const added = await AuditLog.findOne({ tenantId: hospital._id, action: 'IMAGING_IMAGE_ADDED' }).lean();
    expect(added.details).toMatchObject({ fromMachine: true, noSexShownConfirmed: true });
  });

  it('a study the machine sent without a known number waits to be linked by hand; another patient cannot use it', async () => {
    const key = await makeKey();
    const p = await mother();
    const other = await mother('Other Sample');
    const study = { studyUid: '1.2.826.0.2', patientId: 'TYPO-1', patientName: 'SAMPLE^ASHA', srs: [{ sopUid: '1.2.826.0.2.9', content: SR }] };
    expect((await bridge(key).post('/studies', study)).body.matched).toBe(false);
    await bridge(key).post(`/studies/${study.studyUid}/images`, { sopUid: '1.2.826.0.2.20', mediaType: 'image/jpeg', data: jpeg(3) });
    const list = (await (await as('rmo')).get('/api/imaging/machine/unmatched')).body.studies;
    expect(list).toEqual([expect.objectContaining({ nameOnMachine: 'SAMPLE ASHA', numberOnMachine: 'TYPO-1' })]);
    expect((await (await as('reception')).get('/api/imaging/machine/unmatched')).status).toBe(403);
    expect((await (await as('rmo')).get(`/api/imaging/machine/${list[0].id}/images/${list[0].images[0].id}`)).status).toBe(200); // to see whose it is
    expect((await (await as('rmo')).post(`/api/imaging/machine/${list[0].id}/link`).send({ mrn: 'P-999999' })).status).toBe(400);
    const linked = await (await as('rmo')).post(`/api/imaging/machine/${list[0].id}/link`).send({ mrn: p.mrn });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.study).toMatchObject({ matchedBy: 'hand', linked: { byName: 'Sample rmo' }, nameDiffers: false });
    expect((await (await as('rmo')).post(`/api/imaging/machine/${list[0].id}/link`).send({ mrn: other.mrn })).status).toBe(409);
    expect((await (await as('rmo')).get('/api/imaging/machine/unmatched')).body.studies).toEqual([]);

    // On her scan it shows; on the other patient's scan it does not, and cannot be used
    const mine = await order(p);
    expect((await (await as('drA')).get(`/api/imaging/${mine.id}/machine`)).body.studies.map((x) => x.id)).toEqual([list[0].id]);
    let theirs = await order(other);
    expect((await (await as('drA')).get(`/api/imaging/${theirs.id}/machine`)).body.studies).toEqual([]);
    theirs = (await (await as('drA')).post(`/api/imaging/${theirs.id}/done`).send({ rev: theirs.rev })).body.study;
    expect((await (await as('drA')).post(`/api/imaging/${theirs.id}/machine/${list[0].id}/fill`).send({ rev: theirs.rev, fetus: 'A', rows: [{ key: 'bpd' }] })).status).toBe(409);
    expect((await AuditLog.find({ tenantId: hospital._id, action: 'MACHINE_STUDY_LINKED' })).length).toBe(1);
  });

  it('another hospital\'s key never sees or matches this hospital\'s patients', async () => {
    const key = await makeKey();
    const p = await mother();
    await order(p);
    const elsewhere = await createTenant('Other Hospital');
    const admin2 = await createUser({ name: 'Other admin' });
    await addMember(admin2, elsewhere, 'admin');
    const key2 = (await (await loginAs(admin2, { app })).post('/api/tenant/scan-bridge/key')).body.key;
    expect((await bridge(key).get('/worklist')).body.items).toHaveLength(1);
    expect((await bridge(key2).get('/worklist')).body.items).toEqual([]);
    expect((await bridge(key2).post('/studies', { studyUid: '1.2.3.4', patientId: p.mrn })).body.matched).toBe(false);
  });
});
