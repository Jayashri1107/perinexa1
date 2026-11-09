// The medical records module (9 Nov 2026): documents attached to a record (scans of outside papers), the medical
// records login, the records index, the incomplete-records list and the copies register. Fake data only.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureStandardTemplates, resetApprovalBackfill } from '../src/careplans/templatesService.js';
import * as website from '../../client/src/pages/records/recordLists.js';
import * as rules from '../src/records/recordRules.js';
import { KINDS } from '../src/export/hospitalExport.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { TENANT_ROLES } from '../src/models/Membership.js';
import { Patient } from '../src/models/Patient.js';
import { PatientDocument } from '../src/models/PatientDocument.js';
import { StoredFile } from '../src/models/StoredFile.js';
import { RECORDS_ROLES } from '../src/routes/records.js';
import { PATIENT_ROLES } from '../src/utils/patientAccess.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const NOW = new Date('2026-11-09T06:00:00Z'); // Monday 9 Nov 2026, 11:30 in the hospital (India)
const DAY = 86_400_000;
// A one-page PDF's first bytes are enough for the upload check (utils/storedFiles.js reads the start of the file)
const PDF = Buffer.from('%PDF-1.4\n% fake sample scanned case sheet\n').toString('base64');

describe('the rules', () => {
  it('the website has the same lists and the same 72-hour rule', () => {
    for (const k of ['DOC_TYPES', 'COPY_WHATS', 'GIVEN_TO', 'RECEIVER_NAME_NEEDED', 'INCOMPLETE_KINDS', 'COPY_WITHIN_HOURS', 'VISIT_UNSIGNED_AFTER_DAYS', 'DRAFT_OPEN_AFTER_DAYS', 'MAX_DOCUMENT_BYTES']) expect(website[k], k).toEqual(rules[k]);
    expect(Object.keys(website.DOC_TYPE_LABELS)).toEqual(rules.DOC_TYPES);
    expect(Object.keys(website.GIVEN_TO_LABELS)).toEqual(rules.GIVEN_TO);
    for (const issue of [{ requestedOn: null, givenOn: '2026-11-09' }, { requestedOn: '2026-11-06', givenOn: '2026-11-09' }, { requestedOn: '2026-11-05', givenOn: '2026-11-09' }, { requestedOn: '2026-11-01', givenOn: null }]) {
      expect(website.hoursToGive(issue, NOW)).toBe(rules.hoursToGive(issue, NOW));
      expect(website.copyLate(issue, NOW)).toBe(rules.copyLate(issue, NOW));
    }
    expect(rules.hoursToGive({ requestedOn: '2026-11-06', givenOn: '2026-11-09' })).toBe(72);
    expect(rules.copyLate({ requestedOn: '2026-11-06', givenOn: '2026-11-09' })).toBe(false);
    expect(rules.copyLate({ requestedOn: '2026-11-05', givenOn: '2026-11-09' })).toBe(true);
    expect(rules.MAX_DOCUMENT_BYTES).toBeLessThan(16 * 1024 * 1024); // a file lives in one database document while files are in the database
  });
});

describe('documents on a record, and the records module', () => {
  const ROLES = { drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', lab: 'lab', records: 'records', admin: 'admin' };
  let app;
  let hospital;
  let other;
  let people;
  let sessions;

  beforeAll(connectTestDb);
  afterAll(disconnectTestDb);
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetTestDb();
    resetApprovalBackfill();
    app = createApp();
    hospital = await createTenant('Records Hospital');
    other = await createTenant('Other Records Hospital');
    people = {};
    sessions = {};
    for (const [key, role] of Object.entries(ROLES)) {
      people[key] = await createUser({ name: `Sample ${key}` });
      await addMember(people[key], hospital, role);
    }
    people.otherDr = await createUser({ name: 'Sample other doctor' });
    await addMember(people.otherDr, other, 'doctor');
    await ensureStandardTemplates(hospital._id);
  });
  afterEach(() => vi.useRealTimers());

  const as = async (who) => (sessions[who] ??= await loginAs(people[who], { app }));
  let count = 0;
  async function patient(overrides = {}) {
    count += 1;
    const res = await (await as('drA')).post('/api/patients').send(samplePatient({ careType: 'postnatal', fullName: `Records Mother ${count}`, ageYears: 30, assignedDoctor: people.drA._id.toString(), ...overrides }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.patient;
  }
  const url = (p, rest = '') => `/api/patients/${p.id}/documents${rest}`;
  const upload = async (who, p, extra = {}) => (await as(who)).post(url(p)).send({ clientRequestId: randomUUID(), docType: 'outside_discharge', title: 'Discharge summary, Sample City Hospital', documentOn: '2026-10-20', fileName: 'summary.pdf', mediaType: 'application/pdf', data: PDF, ...extra });
  const ok = (res) => {
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body;
  };

  it('the medical records login: a patient role that sees identity details and documents, never the clinical record', async () => {
    expect(TENANT_ROLES).toContain('records');
    expect(PATIENT_ROLES).toContain('records');
    expect(RECORDS_ROLES).toEqual(['records', 'doctor', 'rmo']);
    const p = await patient();
    const s = await as('records');
    const list = await s.get('/api/patients');
    expect(list.status).toBe(200);
    const row = list.body.patients.find((x) => x.id === p.id);
    expect(row.fullName).toBe(p.fullName);
    expect(row.pregnancy).toBeUndefined(); // identity only
    const page = (await s.get(`/api/patients/${p.id}`)).body.patient;
    expect(page.access).toMatchObject({ canViewDocuments: true, canUploadDocuments: true, canViewVisits: false, canViewCarePlan: false, canEditIdentity: false });
    expect(page.medical).toBeUndefined();
    for (const path of ['/visits', '/admissions', '/lab-orders', '/consents', '/imaging', '/record-copy']) expect((await s.get(`/api/patients/${p.id}${path}`)).status, path).toBe(403);
    expect((await s.post('/api/patients').send(samplePatient({ fullName: 'Registered By Records' }))).status).toBe(403); // registers nobody
    expect((await s.get('/api/records/index')).status).toBe(200);
    // The other new logins have nothing to do with documents
    for (const who of ['lab', 'admin']) expect((await (await as(who)).get(url(p))).status, who).toBe(403);
  });

  it('a document is attached, listed, opened and marked as put on the wrong record – by those who may; audited with ids only', async () => {
    const p = await patient();
    // Who attaches: her doctor, RMOs, nurses, reception and the records login – not another doctor (reads only)
    expect((await upload('drB', p)).status).toBe(403);
    const byDesk = ok(await upload('reception', p, { title: 'Referral letter from reception', docType: 'referral_letter', note: 'Brought by her husband' })).document;
    expect(byDesk.access).toEqual({ canOpen: false, canCancel: false });
    expect(byDesk.note).toBe(''); // reception never reads a note back
    // Reception sees the list, never a file or a note
    const forDesk = (await (await as('reception')).get(url(p))).body;
    expect(forDesk.canUpload).toBe(true);
    expect(forDesk.stays).toEqual([]);
    expect(forDesk.documents.every((x) => !x.access.canOpen && x.note === '')).toBe(true);
    expect((await (await as('reception')).get(url(p, `/${byDesk.id}/file`))).status).toBe(403);
    await PatientDocument.deleteOne({ tenantId: hospital._id, _id: byDesk.id }); // (the counts below are of the other documents)
    await StoredFile.deleteOne({ tenantId: hospital._id, _id: byDesk.file.id });
    const { document: d } = ok(await upload('nurse', p));
    expect(d).toMatchObject({ docType: 'outside_discharge', title: 'Discharge summary, Sample City Hospital', documentOn: '2026-10-20', admissionId: null, note: '', uploaded: { byName: 'Sample nurse' }, cancelled: null, access: { canOpen: true, canCancel: false } });
    expect(d.file).toMatchObject({ fileName: 'summary.pdf', mediaType: 'application/pdf' });
    expect(JSON.stringify(d)).not.toContain(PDF.slice(0, 20)); // never the bytes
    const second = ok(await upload('records', p, { docType: 'case_sheet', title: 'Old case sheet 2024', documentOn: '', note: 'Three pages' })).document;
    expect(second).toMatchObject({ documentOn: null, note: 'Three pages', uploaded: { byName: 'Sample records' }, access: { canOpen: true, canCancel: true } });
    // The same request twice attaches once
    const body = { clientRequestId: 'same-document-request', docType: 'other', title: 'A note', fileName: 'n.pdf', mediaType: 'application/pdf', data: PDF };
    const first = await (await as('drA')).post(url(p)).send(body);
    const again = await (await as('drA')).post(url(p)).send(body);
    expect([first.status, again.status, again.body.document.id]).toEqual([201, 201, first.body.document.id]);
    expect(await PatientDocument.countDocuments({ tenantId: hospital._id })).toBe(3);
    expect(await StoredFile.countDocuments({ tenantId: hospital._id, kind: 'patient_document' })).toBe(3);
    // The list: those who may see her medical details, the records login and reception (no files); the lab never
    const forB = (await (await as('drB')).get(url(p))).body;
    expect(forB.documents.map((x) => x.title)).toEqual(['Discharge summary, Sample City Hospital', 'A note', 'Old case sheet 2024']); // by the date on the paper, the undated last (newest attached first)
    expect(forB.canUpload).toBe(false);
    expect(forB.documents.every((x) => x.access.canOpen && !x.access.canCancel)).toBe(true);
    const forRecords = (await (await as('records')).get(url(p))).body;
    expect([forRecords.canUpload, forRecords.stays, forRecords.maxBytes]).toEqual([true, [], rules.MAX_DOCUMENT_BYTES]); // no stays: a clinical detail
    expect((await (await as('lab')).get(url(p))).status).toBe(403);
    // The file itself, as stored
    const file = await (await as('drB')).get(url(p, `/${d.id}/file`));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/pdf/);
    expect(file.body.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
    // Wrong record: her doctor, an RMO or the records login, with a reason; readers then no longer open it
    expect((await (await as('nurse')).post(url(p, `/${d.id}/cancel`)).send({ reason: 'Wrong patient' })).status).toBe(403);
    expect((await (await as('drA')).post(url(p, `/${d.id}/cancel`)).send({ reason: 'no' })).body.error.fields.reason).toBe('Write why this document does not belong here.');
    const marked = ok(await (await as('records')).post(url(p, `/${d.id}/cancel`)).send({ reason: 'Belongs to another patient with the same name' })).document;
    expect(marked.cancelled).toMatchObject({ byName: 'Sample records', reason: 'Belongs to another patient with the same name' });
    expect(marked.access).toEqual({ canOpen: true, canCancel: false });
    expect((await (await as('drB')).get(url(p, `/${d.id}/file`))).status).toBe(409);
    expect((await (await as('drA')).get(url(p, `/${d.id}/file`))).status).toBe(200);
    expect((await (await as('nurse')).get(url(p))).body.documents.map((x) => [x.title, Boolean(x.cancelled), x.access.canOpen])).toEqual([
      ['A note', false, true],
      ['Old case sheet 2024', false, true],
      ['Discharge summary, Sample City Hospital', true, false], // the marked one last, not opened by a reader
    ]);
    // The audit log: ids, the kind of document and sizes – never a title or a file
    const log = await AuditLog.find({ tenantId: hospital._id, action: /^PATIENT_FILE_/, 'details.documentId': { $ne: byDesk.id } }).sort({ _id: 1 }).lean(); // (not the listings, PATIENT_FILES_VIEWED; not reception's document, removed above)
    expect(log.map((l) => l.action)).toEqual(['PATIENT_FILE_UPLOADED', 'PATIENT_FILE_UPLOADED', 'PATIENT_FILE_UPLOADED', 'PATIENT_FILE_OPENED', 'PATIENT_FILE_CANCELLED', 'PATIENT_FILE_OPENED']);
    expect(Object.keys(log[0].details).sort()).toEqual(['docType', 'documentId', 'fileId', 'mrn', 'patientId', 'size']);
    expect(JSON.stringify(log)).not.toMatch(/Discharge summary|case sheet|same name/);
  });

  it('what is checked: the kind, a title, the date, the stay, a readable PDF or photo; a sensitive, closed or duplicate record', async () => {
    const p = await patient();
    const fields = async (extra) => (await upload('drA', p, extra)).body.error.fields;
    expect(await fields({ docType: 'aadhaar' })).toEqual({ docType: 'Choose what kind of document this is.' });
    expect(await fields({ title: 'x' })).toEqual({ title: 'Write what the document is (a few words).' });
    expect(await fields({ documentOn: '2026-11-10' })).toEqual({ documentOn: 'The date on the document cannot be after today.' });
    expect(await fields({ data: Buffer.from('not a pdf at all, just words').toString('base64') })).toEqual({ file: 'This file is not a readable PDF or photo.' });
    expect((await upload('drA', p, { mediaType: 'text/plain' })).status).toBe(400);
    expect((await upload('drA', p, { colour: 'blue' })).status).toBe(400);
    // The stay it belongs to must be hers; the records login links to none (no clinical access)
    const stay = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'pnc', admittedAt: '2026-11-07T04:00:00.000Z', ward: 'Postnatal', bed: '3', reason: 'After delivery' })).body.admission;
    const otherP = await patient();
    expect((await upload('drA', p, { admissionId: stay.id, title: 'Linked to the wrong stay' })).status).toBe(201); // (hers: fine)
    expect((await upload('drA', otherP, { admissionId: stay.id })).body.error.fields.admissionId).toMatch(/not on her record/);
    expect((await upload('records', p, { admissionId: stay.id })).status).toBe(403);
    const listed = (await (await as('drA')).get(url(p))).body;
    expect(listed.stays.map((s) => [s.id, s.ward, s.status])).toEqual([[stay.id, 'Postnatal', 'admitted']]);
    expect(listed.documents.find((x) => x.title === 'Linked to the wrong stay').admissionId).toBe(stay.id);
    // A sensitive record: her doctor, RMOs and the records login – not a nurse, not another doctor
    const sensitive = await patient({ careType: 'infertility' });
    for (const who of ['nurse', 'drB']) {
      expect((await (await as(who)).get(url(sensitive))).status, who).toBe(403);
      expect((await upload(who, sensitive)).status, who).toBe(403);
    }
    for (const who of ['drA', 'rmo', 'records']) expect((await upload(who, sensitive)).status, who).toBe(201);
    // A closed record takes nothing new; neither does one marked as a duplicate
    const closed = await patient();
    await Patient.updateOne({ _id: closed.id, tenantId: hospital._id }, { $set: { death: { on: new Date(NOW.getTime() - DAY), byName: 'Sample drA', at: NOW } } });
    expect((await upload('drA', closed)).status).toBe(409);
    expect((await (await as('drA')).get(url(closed))).body.canUpload).toBe(false);
    // Another hospital: not found
    expect((await (await loginAs(people.otherDr, { app })).get(url(p))).status).toBe(404);
    // In the hospital export, and in the copy of the whole record (the list, never the files)
    expect(KINDS.map((k) => k.file)).toEqual(expect.arrayContaining(['patient-documents.json', 'record-copies.json']));
    const copy = (await (await as('drA')).get(`/api/patients/${p.id}/record-copy`)).body.copy;
    expect(copy.patientDocuments.map((x) => [x.title, x.docType, x.documentOn, x.fileName, x.uploaded.byName])).toEqual([['Linked to the wrong stay', 'outside_discharge', '2026-10-20', 'summary.pdf', 'Sample drA']]);
    expect(JSON.stringify(copy)).not.toContain('"data"');
  });

  it('the records index: every record with its last stay and its documents; the Records menu is for the records login, doctors and RMOs', async () => {
    const a = await patient({ fullName: 'Index Alpha' });
    const b = await patient({ fullName: 'Index Beta', careType: 'gynaecology' });
    ok(await upload('nurse', a));
    ok(await upload('nurse', a, { title: 'Second paper' }));
    const stay = (await (await as('rmo')).post(`/api/patients/${a.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'pnc', admittedAt: '2026-11-07T04:00:00.000Z', ward: 'Postnatal', bed: '3', reason: 'After delivery' })).body.admission;
    for (const who of ['nurse', 'reception', 'lab', 'admin']) expect((await (await as(who)).get('/api/records/index')).status, who).toBe(403);
    const all = (await (await as('records')).get('/api/records/index')).body;
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => [r.fullName, r.careType, r.assignedDoctorName, r.documents, r.lastStay?.status ?? null])).toEqual([
      ['Index Beta', 'gynaecology', 'Sample drA', 0, null],
      ['Index Alpha', 'postnatal', 'Sample drA', 2, 'admitted'],
    ]);
    expect(all.rows[1].lastStay).toMatchObject({ admittedAt: stay.admittedAt, dischargedAt: null, count: 1 });
    expect(Object.keys(all.rows[0]).sort()).toEqual(['age', 'assignedDoctorName', 'careType', 'closed', 'documents', 'duplicate', 'fullName', 'id', 'lastStay', 'mrn', 'registeredOn']); // identity only
    expect((await (await as('drB')).get('/api/records/index').query({ search: b.mrn })).body.rows.map((r) => r.id)).toEqual([b.id]);
    expect((await (await as('rmo')).get('/api/records/index').query({ careType: 'postnatal' })).body.rows.map((r) => r.id)).toEqual([a.id]);
    expect((await (await as('rmo')).get('/api/records/index').query({ search: 'alpha' })).body.total).toBe(1);
    expect((await (await loginAs(people.otherDr, { app })).get('/api/records/index')).body.total).toBe(0);
    const log = await AuditLog.find({ tenantId: hospital._id, action: 'RECORDS_INDEX_VIEWED' }).lean();
    expect(log).toHaveLength(4);
    expect(log[0].details).toEqual({ shown: 2, page: 1 });
  });

  it('incomplete records: a visit unsigned the day after, an inpatient document still a draft after a week', async () => {
    const p = await patient();
    const visit = (await (await as('nurse')).post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID(), visitOn: '2026-11-09' })).body.visit;
    const stay = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions`).send({ clientRequestId: randomUUID(), billingType: 'cash', stayType: 'pnc', admittedAt: '2026-11-08T04:00:00.000Z', ward: 'Postnatal', bed: '3', reason: 'After delivery' })).body.admission;
    const draft = (await (await as('rmo')).post(`/api/patients/${p.id}/admissions/${stay.id}/documents`).send({ clientRequestId: randomUUID(), kind: 'round' })).body.document;
    expect(visit && stay && draft).toBeTruthy();
    // Today: nothing is late yet
    let list = (await (await as('records')).get('/api/records/incomplete')).body;
    expect(list.rows).toEqual([]);
    expect(list.counts).toEqual({ visits: 0, documents: 0 });
    // Two days later: the visit is listed; the draft is not yet (the stay is open and it is 2 days old)
    vi.setSystemTime(new Date(NOW.getTime() + 2 * DAY));
    sessions = {};
    list = (await (await as('records')).get('/api/records/incomplete')).body;
    expect(list.rows.map((r) => [r.kind, r.patient.mrn, r.daysOpen, r.visitId])).toEqual([['visit_unsigned', p.mrn, 2, visit.id]]);
    // Eight days later: the draft too, oldest first
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY));
    sessions = {};
    list = (await (await as('drA')).get('/api/records/incomplete')).body;
    expect(list.rows.map((r) => [r.kind, r.daysOpen, r.documentKind, r.stayOver])).toEqual([
      ['visit_unsigned', 8, null, undefined],
      ['document_draft', 8, 'round', false],
    ]);
    expect(list.rows[1]).toMatchObject({ admissionId: stay.id, documentId: draft.id, patient: { id: p.id, assignedDoctorName: 'Sample drA' } });
    expect(list.counts).toEqual({ visits: 1, documents: 1 });
    expect((await (await as('nurse')).get('/api/records/incomplete')).status).toBe(403);
    const log = await AuditLog.find({ tenantId: hospital._id, action: 'RECORDS_INCOMPLETE_VIEWED' }).sort({ _id: 1 }).lean();
    expect(log.map((l) => l.details)).toEqual([{ shown: 0, visits: 0, documents: 0 }, { shown: 1, visits: 1, documents: 0 }, { shown: 2, visits: 1, documents: 1 }]);
  });

  it('the copies register: who received what, on what authority, and whether it was given within 72 hours', async () => {
    const p = await patient();
    const post = async (who, body = {}) => (await as(who)).post('/api/records/copies').send({ clientRequestId: randomUUID(), patientId: p.id, what: 'whole_record', givenTo: 'patient', givenOn: '2026-11-09', ...body });
    const fields = async (body) => (await post('records', body)).body.error.fields;
    expect(await fields({ givenTo: 'insurer' })).toEqual({ receiverName: 'Write who received the copy.', authorisation: "Write what the copy rests on: her written consent, a court order, the insurer's request letter …" });
    expect(await fields({ what: 'documents' })).toEqual({ whatNote: 'Write which documents were given.' });
    expect(await fields({ givenOn: '2026-11-10' })).toEqual({ givenOn: 'The day it was given cannot be after today.' });
    expect(await fields({ requestedOn: '2026-11-10', givenOn: '2026-11-09' })).toEqual({ requestedOn: 'The request cannot be after the day it was given.' });
    expect((await post('records', { givenTo: 'spy' })).status).toBe(400);
    expect((await post('nurse')).status).toBe(403);
    // In time, and late
    const quick = ok(await post('records', { requestedOn: '2026-11-08' })).issue;
    expect(quick).toMatchObject({ patient: { id: p.id, mrn: p.mrn }, what: 'whole_record', givenTo: 'patient', requestedOn: '2026-11-08', givenOn: '2026-11-09', hoursToGive: 24, late: false, recorded: { byName: 'Sample records' }, cancelled: null });
    const late = ok(await post('drA', { what: 'documents', whatNote: 'Two outside reports', givenTo: 'insurer', receiverName: 'Sample Insurance TPA', authorisation: 'Her signed consent of 2 Nov 2026', requestedOn: '2026-11-02', givenOn: '2026-11-08' })).issue;
    expect(late).toMatchObject({ hoursToGive: 144, late: true, receiverName: 'Sample Insurance TPA' });
    // The same request twice records once
    const body = { clientRequestId: 'same-copy-request', patientId: p.id, what: 'discharge_summary', givenTo: 'patient', givenOn: '2026-11-09' };
    const first = await (await as('rmo')).post('/api/records/copies').send(body);
    const again = await (await as('rmo')).post('/api/records/copies').send(body);
    expect([first.status, again.status, again.body.issue.id]).toEqual([201, 201, first.body.issue.id]);
    // The register, newest given first; late ones counted; a period
    const reg = (await (await as('records')).get('/api/records/copies')).body;
    expect(reg.rows.map((r) => [r.what, r.givenOn, r.late])).toEqual([
      ['discharge_summary', '2026-11-09', false],
      ['whole_record', '2026-11-09', false],
      ['documents', '2026-11-08', true],
    ]);
    expect([reg.total, reg.late]).toEqual([3, 1]);
    expect((await (await as('records')).get('/api/records/copies').query({ from: '2026-11-09' })).body.total).toBe(2);
    expect((await (await as('records')).get('/api/records/copies').query({ patientId: p.id, to: '2026-11-08' })).body.rows.map((r) => r.id)).toEqual([late.id]);
    // Made by mistake: kept, marked; no longer counted as late
    expect((await (await as('records')).post(`/api/records/copies/${late.id}/cancel`).send({ reason: 'no' })).body.error.fields.reason).toBe('Write why this entry was made by mistake.');
    const cancelled = ok(await (await as('records')).post(`/api/records/copies/${late.id}/cancel`).send({ reason: 'Entered twice by mistake' })).issue;
    expect(cancelled.cancelled).toMatchObject({ byName: 'Sample records', reason: 'Entered twice by mistake' });
    expect((await (await as('records')).get('/api/records/copies')).body.late).toBe(0);
    // Another hospital: her record is not found, and its register is empty
    const otherS = await loginAs(people.otherDr, { app });
    expect((await otherS.post('/api/records/copies').send({ clientRequestId: randomUUID(), patientId: p.id, what: 'whole_record', givenTo: 'patient', givenOn: '2026-11-09' })).status).toBe(404);
    expect((await otherS.get('/api/records/copies')).body.total).toBe(0);
    expect((await otherS.post(`/api/records/copies/${late.id}/cancel`).send({ reason: 'Not mine to cancel' })).status).toBe(404);
    // The audit log: ids and the kind of copy – never a name or an authorisation
    const log = await AuditLog.find({ tenantId: hospital._id, action: /^RECORD_COPY_ISSUE/ }).sort({ _id: 1 }).lean();
    expect(log.map((l) => [l.action, l.details.what ?? null, l.details.givenTo ?? null, l.details.late ?? null])).toEqual([
      ['RECORD_COPY_ISSUED', 'whole_record', 'patient', false],
      ['RECORD_COPY_ISSUED', 'documents', 'insurer', true],
      ['RECORD_COPY_ISSUED', 'discharge_summary', 'patient', false],
      ['RECORD_COPY_ISSUE_CANCELLED', null, null, null],
    ]);
    expect(JSON.stringify(log)).not.toMatch(/Insurance|consent of|twice/);
  });
  it('the department rule (perinexa1, 9 Nov 2026): a doctor lists only their departments; another department is "not found"', async () => {
    const obgy = await createUser({ name: 'Sample Obgy doctor' });
    await addMember(obgy, hospital, 'doctor', { departments: ['Obgy'], department: 'Obgy' });
    const desk = await as('reception');
    const register = async (fullName, department) => {
      const res = await desk.post('/api/patients').send(samplePatient({ careType: 'gynaecology', fullName, department }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.patient;
    };
    const mine = await register('Department Obgy Woman', 'Obgy');
    const theirs = await register('Department Pediatric Child', 'Pediatric');
    const s = await loginAs(obgy, { app });
    const names = (await s.get('/api/records/index?limit=100')).body.rows.map((r) => r.fullName);
    expect(names).toContain('Department Obgy Woman');
    expect(names).not.toContain('Department Pediatric Child');
    // Another department's record: its documents and a copy entry are "not found" (never "not allowed")
    expect((await s.get(`/api/patients/${theirs.id}/documents`)).status).toBe(404);
    const entry = { clientRequestId: randomUUID(), what: 'whole_record', givenTo: 'patient', givenOn: '2026-11-09' };
    expect((await s.post('/api/records/copies').send({ ...entry, patientId: theirs.id })).status).toBe(404);
    expect((await s.post('/api/records/copies').send({ ...entry, clientRequestId: randomUUID(), patientId: mine.id })).status).toBe(201);
    // The records login (and so the register) still has every record; the doctor's register only their department's
    expect((await (await as('records')).post('/api/records/copies').send({ ...entry, clientRequestId: randomUUID(), patientId: theirs.id })).status).toBe(201);
    expect((await (await as('records')).get('/api/records/copies')).body.rows).toHaveLength(2);
    expect((await s.get('/api/records/copies')).body.rows.map((r) => r.patient.fullName)).toEqual(['Department Obgy Woman']);
  });
});

