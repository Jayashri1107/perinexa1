// Taking one hospital's data out (npm run export:hospital – for the person who runs the server, never a web page):
// the folder checks, the confirmation, one hospital only, what never leaves, the stored files, README.txt and the
// audit entry. Run against the TEST database only (helpers.js refuses any other); the folders are made in the
// computer's temporary folder and removed again. Fake sample data only.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { KINDS, LEFT_OUT, PROJECT_ROOT, checkOutputFolder, exportHospital, recordFor, runExportCommand } from '../src/export/hospitalExport.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Patient } from '../src/models/Patient.js';
import { PortalAccess } from '../src/models/PortalAccess.js';
import { StoredFile } from '../src/models/StoredFile.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { safeAuditDetails } from '../src/utils/auditDetails.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n% Sample lab report (fake)\n%%EOF\n');
const JSON_FILES = [...KINDS.map((k) => k.file), 'hospital.json', 'staff.json', 'stored-files.json'];

let hospital;
let other;
let doctor;
let nurse;
let temp; // this test's own temporary folder

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  temp = await mkdtemp(path.join(os.tmpdir(), 'perinexa-export-test-'));
  hospital = await createTenant('Export Sample Hospital');
  other = await createTenant('Other Export Hospital');
  doctor = await createUser({ name: 'Dr Export Sample', professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-SAMPLE-1', council: 'Sample Medical Council' } });
  nurse = await createUser({ name: 'Nurse Export Sample' });
  await addMember(doctor, hospital, 'doctor');
  await addMember(nurse, hospital, 'nurse');
  await addMember(doctor, other, 'doctor');
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

const app = createApp();
const ok = (res, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
const readJson = async (dir, file) => JSON.parse(await readFile(path.join(dir, file), 'utf8'));
/** Every file of the folder as one text (the stored files as their bytes). */
async function allText(dir) {
  const parts = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) parts.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
  }
  return parts.join('\n');
}

/** A hospital with a patient, a visit (with a private note), a stored lab report, portal access and secrets. */
async function sampleData() {
  const s = await loginAs(doctor, { app });
  const p = ok(await s.post('/api/patients').send(samplePatient({ careType: 'antenatal', fullName: 'Export Mother Sample', pregnancy: { scanEdd: '2027-03-01' }, assignedDoctor: doctor._id.toString() })), 201).patient;
  const v = ok(await s.post(`/api/patients/${p.id}/visits`).send({ clientRequestId: randomUUID() }), 201).visit;
  ok(await s.patch(`/api/patients/${p.id}/visits/${v.id}`).send({ details: { rev: 0, complaints: 'Mild back pain', privateNote: 'PRIVATE-NOTE-SAMPLE' } }));
  const file = await StoredFile.create({ tenantId: hospital._id, patientId: p.id, kind: 'lab_report', ownerId: new mongoose.Types.ObjectId(), fileName: 'Export Mother Sample report.pdf', mediaType: 'application/pdf', size: PDF.length, data: PDF, by: doctor._id, byName: doctor.name });
  await PortalAccess.create({ tenantId: hospital._id, patientId: p.id, codeHash: 'PORTAL-CODE-HASH-SAMPLE-0001', expiresAt: new Date(Date.now() + 86400000), createdBy: doctor._id, createdByName: doctor.name });
  // The waiting-room screen key, an old PC-PNDT number and a field removed from the code (still stored)
  await Tenant.collection.updateOne({ _id: hospital._id }, { $set: { 'messaging.displayKey': 'SCREEN-KEY-SAMPLE-0001', 'letterhead.pcpndtRegistration': 'PCPNDT-OLD-SAMPLE', 'billing.upiId': 'sample@upi' } });
  await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(p.id) }, { $set: { oldRegisterNumber: 'REMOVED-FIELD-SAMPLE', 'medical.removedNested': 'REMOVED-NESTED-SAMPLE' } });
  // An audit entry of this hospital holding an e-mail address in its details
  await AuditLog.create({ action: 'USER_UPDATED', tenantId: hospital._id, actor: doctor._id, actorEmail: doctor.email, target: nurse._id, targetEmail: nurse.email, details: { changes: { email: { from: 'old-sample@example.com', to: nurse.email } } } });
  // Another hospital's patient
  const so = await loginAs(doctor, { app });
  await so.switchTo(other);
  ok(await so.post('/api/patients').send(samplePatient({ fullName: 'Other Hospital Patient Sample' })), 201);
  ok(await so.switchTo(hospital)); // (this hospital's log then says where she came from: never written)
  return { p, v, file };
}

describe('the folder', () => {
  it('refuses a folder inside the project (also through a link), one that is not empty, a file, and no folder', async () => {
    await expect(checkOutputFolder(path.join(PROJECT_ROOT, 'exports', 'sample'))).rejects.toThrow(/inside the Perinexa folder/);
    await expect(checkOutputFolder(PROJECT_ROOT)).rejects.toThrow(/inside the Perinexa folder/);
    await expect(checkOutputFolder('server', { cwd: PROJECT_ROOT })).rejects.toThrow(/inside the Perinexa folder/);
    const link = path.join(temp, 'link-into-project');
    await symlink(path.join(PROJECT_ROOT, 'server'), link);
    await expect(checkOutputFolder(path.join(link, 'new-export'))).rejects.toThrow(/inside the Perinexa folder/);

    const full = path.join(temp, 'full');
    await mkdir(full);
    await writeFile(path.join(full, 'notes.txt'), 'something already here');
    await expect(checkOutputFolder(full)).rejects.toThrow(/is not empty/);
    await expect(checkOutputFolder(path.join(full, 'notes.txt'))).rejects.toThrow(/is a file, not a folder/);
    await expect(checkOutputFolder('')).rejects.toThrow(/Say where to write the files/);

    // A new folder (not created by the check) and an empty one are fine
    expect(await checkOutputFolder(path.join(temp, 'new', 'export'))).toMatchObject({ exists: false });
    await mkdir(path.join(temp, 'empty'));
    expect(await checkOutputFolder(path.join(temp, 'empty'))).toMatchObject({ exists: true });
    expect(await readdir(temp)).not.toContain('new');
  });
});

describe('what is written', () => {
  it("one file per kind of record of this hospital only, the stored files, README.txt – and never secrets, e-mail addresses or another hospital's data", async () => {
    const { p, v, file } = await sampleData();
    const out = path.join(temp, 'export');
    const now = new Date('2026-10-05T08:35:00Z');
    const done = await exportHospital({ tenant: await Tenant.findById(hospital._id), out, now });

    expect((await readdir(out)).sort()).toEqual([...JSON_FILES, 'README.txt', 'files'].sort());
    expect(await readdir(path.join(out, 'files'))).toEqual([`${file._id}.pdf`]);
    expect(await readFile(path.join(out, 'files', `${file._id}.pdf`))).toEqual(PDF);
    for (const f of JSON_FILES) {
      const records = await readJson(out, f);
      expect(Array.isArray(records) ? records.length : 1, f).toBe(done.counts[f]);
    }

    const patients = await readJson(out, 'patients.json');
    expect(patients).toHaveLength(1);
    expect(patients[0]).toMatchObject({ id: p.id, tenantId: String(hospital._id), mrn: p.mrn, fullName: 'Export Mother Sample', careType: 'antenatal' });
    expect(patients[0].pregnancy.scanEdd).toBe('2027-03-01T00:00:00.000Z');
    const visits = await readJson(out, 'visits.json');
    expect(visits).toMatchObject([{ id: v.id, patientId: p.id, details: { complaints: 'Mild back pain', privateNote: 'PRIVATE-NOTE-SAMPLE' } }]);
    expect(await readJson(out, 'stored-files.json')).toEqual([
      expect.objectContaining({ id: String(file._id), kind: 'lab_report', patientId: p.id, mediaType: 'application/pdf', size: PDF.length, path: `files/${file._id}.pdf` }),
    ]);
    expect(await readJson(out, 'staff.json')).toEqual([
      { id: String(doctor._id), name: 'Dr Export Sample', roles: ['doctor'], activeHere: true, since: expect.any(String), professional: { qualification: 'MBBS, MS (OBGY)', registrationNumber: 'MMC-SAMPLE-1', council: 'Sample Medical Council' } },
      { id: String(nurse._id), name: 'Nurse Export Sample', roles: ['nurse'], activeHere: true, since: expect.any(String), professional: { qualification: '', registrationNumber: '', council: '' } },
    ]);
    const h = await readJson(out, 'hospital.json');
    expect(h).toMatchObject({ id: String(hospital._id), name: 'Export Sample Hospital', billing: { upiId: 'sample@upi' }, messaging: { waitingRoomScreenOn: true } });
    const audit = await readJson(out, 'audit-log.json');
    expect(audit.length).toBeGreaterThan(0);
    const changed = audit.find((e) => e.action === 'USER_UPDATED');
    expect(changed).toMatchObject({ actor: String(doctor._id), actorName: 'Dr Export Sample', target: String(nurse._id), targetName: 'Nurse Export Sample', details: { changes: {} } });
    for (const e of audit) expect(e.tenantId).toBe(String(hospital._id));
    // Coming back from the other hospital: the entry is kept, without the other hospital's id
    expect(audit.find((e) => e.action === 'TENANT_SWITCHED')?.details).toEqual({ to: String(hospital._id) });

    const text = await allText(out);
    const withHash = await User.findById(doctor._id).select('+passwordHash');
    const never = [
      withHash.passwordHash, // password hashes
      'PORTAL-CODE-HASH-SAMPLE-0001', // portal code hashes
      'SCREEN-KEY-SAMPLE-0001', // the waiting-room screen key
      process.env.JWT_SECRET, // server/.env
      process.env.MONGO_URI,
      doctor.email, // staff e-mail addresses
      nurse.email,
      'old-sample@example.com',
      String(other._id), // another hospital
      'Other Hospital Patient Sample',
      'Other Export Hospital',
      'REMOVED-FIELD-SAMPLE', // fields no longer in the code
      'REMOVED-NESTED-SAMPLE',
      'PCPNDT-OLD-SAMPLE',
    ];
    for (const value of never) expect(text.includes(value), value).toBe(false);
    expect(text).not.toMatch(/"(passwordHash|codeHash|tokenVersion|displayKey|actorEmail|targetEmail)"/);

    // README.txt: the hospital, the date, the counts and the warning, in plain words
    const readme = await readFile(path.join(out, 'README.txt'), 'utf8');
    expect(readme).toContain('Hospital: Export Sample Hospital');
    expect(readme).toContain('Taken out: 5 Oct 2026, 14:05 (Asia/Kolkata time) – 2026-10-05T08:35:00.000Z in UTC');
    expect(readme).toContain('patients.json (1 record)');
    expect(readme).toContain('stored-files.json (1 record)');
    expect(readme).toContain('files/ (1 file)');
    expect(readme).toMatch(/confidential medical records of every patient/);
    expect(readme).toContain('It is NOT encrypted: anyone who can open this folder can read all of it.');
    expect(readme).toMatch(/Keep it only on an encrypted disk/);
    expect(readme).toMatch(/Delete it \(and empty the bin\) as soon as it is no longer needed/);
    for (const k of KINDS) expect(readme, k.file).toContain(`${k.file} (`);
    expect(readme).not.toMatch(/!/);
    expect(Math.max(...readme.split('\n').map((l) => l.length))).toBeLessThanOrEqual(100);

    // One audit entry in this hospital's log – counts only, nobody signed in – and none in the other hospital's
    const entries = await AuditLog.find({ action: 'HOSPITAL_DATA_EXPORTED' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tenantId: hospital._id, actor: null, actorEmail: null });
    expect(Object.keys(entries[0].details).sort()).toEqual(['counts', 'files', 'patients', 'records']);
    expect(entries[0].details).toMatchObject({ patients: 1, files: 1, records: done.records, counts: { patients: 1, visits: 1, 'stored-files': 1 } });
    for (const n of Object.values(entries[0].details.counts)) expect(typeof n).toBe('number');
    expect(safeAuditDetails('HOSPITAL_DATA_EXPORTED', { ...entries[0].details, folder: '/somewhere' })).not.toHaveProperty('folder');
    expect(safeAuditDetails('HOSPITAL_DATA_EXPORTED', entries[0].details, { scope: 'platform' })).toEqual(entries[0].details);
  });

  it('only the fields the code knows: a record is written as the model describes it, ids and times as text', () => {
    const id = new mongoose.Types.ObjectId();
    const raw = { _id: id, __v: 3, tenantId: id, fullName: 'Sample', removedLongAgo: 'x', medical: { allergies: 'None', gone: 'x' }, pregnancy: { findings: [{ key: 'gdm', at: new Date('2026-10-01T05:00:00Z'), extra: 'x' }] }, createdAt: new Date('2026-10-01T05:00:00Z') };
    expect(recordFor(Patient, raw)).toEqual({ id: String(id), tenantId: String(id), fullName: 'Sample', medical: { allergies: 'None' }, pregnancy: { findings: [{ key: 'gdm', at: '2026-10-01T05:00:00.000Z' }] }, createdAt: '2026-10-01T05:00:00.000Z' });
  });

  it('every kind of record in Perinexa is either written or left out on purpose (a new kind needs a decision)', async () => {
    const dir = path.join(fileURLToPath(new URL('../src/models/', import.meta.url)));
    for (const f of await readdir(dir)) if (f.endsWith('.js')) await import(path.join(dir, f));
    const written = new Set(KINDS.map((k) => k.model.modelName));
    const missing = mongoose.modelNames().filter((name) => !written.has(name) && !LEFT_OUT[name]);
    expect(missing).toEqual([]);
    expect(Object.keys(LEFT_OUT).filter((name) => written.has(name))).toEqual([]);
    expect(Object.keys(LEFT_OUT)).toEqual(expect.arrayContaining(['User', 'PortalAccess', 'Tenant']));
  });
});

describe('nothing is kept when it goes wrong', () => {
  it('a secret setting of server/.env found in the data stops the export and removes what was written; no audit entry', async () => {
    const { p } = await sampleData();
    await Patient.collection.updateOne({ _id: new mongoose.Types.ObjectId(p.id) }, { $set: { notes: `pasted by mistake ${process.env.JWT_SECRET}` } });
    const tenant = await Tenant.findById(hospital._id);
    const fresh = path.join(temp, 'fresh', 'export'); // (both folders are made, and both removed again)
    await expect(exportHospital({ tenant, out: fresh })).rejects.toThrow(/A secret setting of server\/\.env \(JWT_SECRET\) was found in the data for patients\.json\. Nothing was kept/);
    expect(await readdir(temp)).not.toContain('fresh');
    const empty = path.join(temp, 'empty');
    await mkdir(empty);
    await expect(exportHospital({ tenant, out: empty })).rejects.toThrow(/JWT_SECRET/);
    expect(await readdir(empty)).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'HOSPITAL_DATA_EXPORTED' })).toBe(0);
  });

  it('stopped by the operator (Ctrl+C): what was written is removed', async () => {
    await sampleData();
    const stop = new AbortController();
    stop.abort();
    const out = path.join(temp, 'stopped');
    await expect(exportHospital({ tenant: await Tenant.findById(hospital._id), out, signal: stop.signal })).rejects.toThrow(/stopped/);
    expect(await readdir(temp)).not.toContain('stopped');
  });
});

describe('the command', () => {
  const run = async (argv, answer, extra = {}) => {
    const lines = [];
    let asked = null;
    let connected = false;
    const code = await runExportCommand({
      argv,
      cwd: temp,
      connect: async () => {
        connected = true;
      },
      ask: async (q) => {
        asked = q;
        return answer;
      },
      print: (t) => lines.push(t),
      ...extra,
    });
    return { code, text: lines.join('\n'), asked, connected };
  };

  it('asks for the hospital\'s name again: anything else stops without writing; the right name (or --yes) exports', async () => {
    await sampleData();
    const no = await run(['--hospital', 'Export Sample Hospital', '--out', 'export'], 'Export sample hospital');
    expect(no).toMatchObject({ code: 1, asked: expect.stringMatching(/Type the hospital's name again/) });
    expect(no.text).toMatch(/not encrypted/);
    expect(no.text).toMatch(/Not confirmed – nothing was written\./);
    expect(await readdir(temp)).toEqual([]);
    expect(await AuditLog.countDocuments({ action: 'HOSPITAL_DATA_EXPORTED' })).toBe(0);

    const yes = await run(['--hospital', 'Export Sample Hospital', '--out', 'export'], 'Export Sample Hospital');
    expect(yes.code).toBe(0);
    expect(yes.text).toMatch(/Done: .* records and 1 stored file were written to /);
    expect(yes.text).toMatch(/NOT encrypted/);
    expect(await readdir(path.join(temp, 'export'))).toContain('README.txt');

    const auto = await run(['--hospital', 'Export Sample Hospital', '--out', path.join(temp, 'second'), '--yes'], null);
    expect(auto).toMatchObject({ code: 0, asked: null });
    expect(await AuditLog.countDocuments({ tenantId: hospital._id, action: 'HOSPITAL_DATA_EXPORTED' })).toBe(2);
  });

  it('refuses before reading anything: a folder inside the project, a folder that is not empty, no hospital, an unknown option', async () => {
    const inside = await run(['--hospital', 'Export Sample Hospital', '--out', path.join(PROJECT_ROOT, 'export-here')], 'Export Sample Hospital');
    expect(inside).toMatchObject({ code: 1, connected: false, asked: null });
    expect(inside.text).toMatch(/inside the Perinexa folder/);
    await writeFile(path.join(temp, 'already.txt'), 'x');
    expect((await run(['--hospital', 'Export Sample Hospital', '--out', '.'], 'x')).text).toMatch(/is not empty/);
    expect((await run(['--out', 'x'], 'x')).text).toMatch(/Say which hospital/);
    const odd = await run(['--hospital', 'Export Sample Hospital', '--out', 'x', '--everything'], 'x');
    expect(odd.code).toBe(1);
    expect(odd.text).toMatch(/npm run export:hospital -- --hospital/);
    expect((await run(['--help'], 'x')).code).toBe(0);
  });

  it('the name must be exact: another spelling, or a hospital that does not exist, is refused', async () => {
    const wrongCase = await run(['--hospital', 'export sample hospital', '--out', 'export'], 'export sample hospital');
    expect(wrongCase.code).toBe(1);
    expect(wrongCase.text).toMatch(/No hospital is named exactly "export sample hospital"\. Did you mean "Export Sample Hospital"\?/);
    expect((await run(['--hospital', 'No Such Hospital', '--out', 'export'], 'x')).text).toMatch(/No hospital is named exactly "No Such Hospital"/);
    expect(await readdir(temp)).toEqual([]);
  });
});

// (The super admin is not a member of any hospital: an export never lists the platform's people as staff)
describe('the staff list', () => {
  it('names only the members of this hospital', async () => {
    await createSuperAdmin({ name: 'Platform Admin Sample' });
    const out = path.join(temp, 'staff');
    await exportHospital({ tenant: await Tenant.findById(hospital._id), out });
    const staff = await readJson(out, 'staff.json');
    expect(staff.map((s) => s.name)).toEqual(['Dr Export Sample', 'Nurse Export Sample']);
  });
});
