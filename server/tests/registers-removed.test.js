// The MTP and PC-PNDT Form F registers were removed at the owner's request on 2 Oct 2026. Nothing about MTP
// stays in new or unapproved built-in content; content a doctor approved keeps its stored wording (the doctor
// edits it). The protection stays and is stronger: the baby's sex is never recorded before birth. Fake data only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as clientWords from '../../client/src/pcpndtWords.js';
import { createApp } from '../src/app.js';
import { ANTENATAL_DRAFT, RISK_RULES_VERSION } from '../src/careplans/antenatalDraft.js';
import { ensureStandardTemplates } from '../src/careplans/templatesService.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { BUILT_IN_MED_SAFETY, BUILT_IN_MED_SAFETY_VERSION } from '../src/medsafety/medicineSafety.js';
import { CarePlanTemplate } from '../src/models/CarePlanTemplate.js';
import { MedicineSafetyList } from '../src/models/MedicineSafetyList.js';
import { FILE_KINDS } from '../src/models/StoredFile.js';
import { Tenant } from '../src/models/Tenant.js';
import { ensureMedicineSafety } from '../src/routes/medicineSafety.js';
import * as serverWords from '../src/utils/pcpndt.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

const MTP = /MTP|terminat/i;
let hospital;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetTestDb();
  hospital = await createTenant('No Registers Hospital');
});

describe('the registers are gone', () => {
  it('no register routes, register scans or PC-PNDT number', async () => {
    const app = createApp();
    const doctor = await createUser({ name: 'Sample doctor' });
    await addMember(doctor, hospital, 'doctor');
    const s = await loginAs(doctor, { app });
    const p = (await s.post('/api/patients').send(samplePatient({ fullName: 'Registers Gone' }))).body.patient;
    expect((await s.get('/api/registers/form-f')).status).toBe(404);
    expect((await s.get('/api/registers/mtp')).status).toBe(404);
    expect((await s.post(`/api/patients/${p.id}/registers/mtp`).send({})).status).toBe(404);
    expect((await request(app).get('/api/registers/form-f')).status).toBe(404);
    expect(FILE_KINDS).not.toContain('register_form');
    expect(Tenant.schema.path('letterhead.pcpndtRegistration')).toBeUndefined();
  });
});

describe('a stored PC-PNDT number stays in the database but is never sent', () => {
  it('not by the platform hospital list, one hospital, or the overview', async () => {
    await Tenant.collection.updateOne({ _id: hospital._id }, { $set: { 'letterhead.pcpndtRegistration': 'OLD-PNDT-1' } });
    const app = createApp();
    const root = await createSuperAdmin({ name: 'Sample root' });
    const s = await loginAs(root, { app });

    const one = await s.agent.get(`/api/platform/tenants/${hospital._id}`);
    expect(one.status).toBe(200);
    expect(one.body.tenant.name).toBe('No Registers Hospital');
    const list = await s.agent.get('/api/platform/tenants');
    expect(list.status).toBe(200);
    const listed = list.body.tenants.find((t) => t.id === String(hospital._id));
    expect(listed).toBeTruthy();
    // Active, no admin yet: listed on the overview.
    const stats = await s.agent.get('/api/platform/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.tenantsWithoutAdmin.map((t) => t.id)).toContain(String(hospital._id));
    for (const t of [one.body.tenant, listed, stats.body.tenantsWithoutAdmin[0]]) expect(t.letterhead?.pcpndtRegistration).toBeUndefined();
    expect(JSON.stringify([one.body, list.body, stats.body])).not.toMatch(/OLD-PNDT-1|pcpndtRegistration/);

    expect((await Tenant.collection.findOne({ _id: hospital._id })).letterhead.pcpndtRegistration).toBe('OLD-PNDT-1');
  });
});

describe('old register entries in the audit log', () => {
  it('still show, but the action filter no longer offers register actions', async () => {
    const app = createApp();
    const admin = await createUser({ name: 'Sample admin' });
    await addMember(admin, hospital, 'admin');
    await AuditLog.create({ action: 'REGISTER_LIST_VIEWED', tenantId: hospital._id, actorEmail: 'sample@example.com', details: { register: 'form_f' } });
    const s = await loginAs(admin, { app });
    for (const url of ['/api/tenant/audit-logs', '/api/tenant/audit-logs?category=patients']) {
      const res = await s.get(url);
      expect(res.status, url).toBe(200);
      expect(res.body.actions.filter((a) => a.startsWith('REGISTER_')), url).toEqual([]);
      expect(res.body.actions, url).toContain('REPORT_VIEWED');
      expect(res.body.entries.map((e) => e.action), url).toContain('REGISTER_LIST_VIEWED');
    }
    // An old link filtered on a register action still works.
    const old = await s.get('/api/tenant/audit-logs?action=REGISTER_LIST_VIEWED');
    expect(old.status).toBe(200);
    expect(old.body.entries).toHaveLength(1);
  });
});

describe('built-in wording has no MTP', () => {
  it('in the draft risk rules and the medicine safety list', () => {
    expect(JSON.stringify(ANTENATAL_DRAFT)).not.toMatch(MTP);
    expect(JSON.stringify(ANTENATAL_DRAFT)).not.toMatch(/Form F/);
    expect(JSON.stringify(BUILT_IN_MED_SAFETY)).not.toMatch(MTP);
    expect(RISK_RULES_VERSION).toBe(5); // 4: MTP wording removed; 5: rules for findings and readings in this pregnancy
    expect(BUILT_IN_MED_SAFETY_VERSION).toBe(3); // 3: dose limits, breastfeeding and newborn entries added (4 Oct 2026)
    const miso = BUILT_IN_MED_SAFETY.find((m) => m.key === 'misoprostol');
    expect(miso.message).toBe('Causes uterine contractions. Only under protocol – management of miscarriage, induction of labour or bleeding after delivery.');
  });

  it('an unapproved built-in risk template gets the new wording; an approved one keeps its stored text', async () => {
    const OLD = 'MoHFW SBA 2010: ≥ 3 spontaneous abortions – refer (bad obstetric history). Note: the count also includes planned terminations (MTP)';
    await ensureStandardTemplates(hospital._id);
    const filter = { tenantId: hospital._id, careType: 'antenatal', kind: 'standard' };
    const std = await CarePlanTemplate.findOne(filter);
    const oldRules = ANTENATAL_DRAFT.riskRules.map((r) => (r.key === 'abortions_3_plus' ? { ...r, source: OLD } : r));

    await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: oldRules, builtInRulesVersion: 3, status: 'draft' } });
    await ensureStandardTemplates(hospital._id);
    const refreshed = await CarePlanTemplate.findOne(filter).lean();
    expect(refreshed.builtInRulesVersion).toBe(RISK_RULES_VERSION);
    expect(JSON.stringify(refreshed.riskRules)).not.toMatch(MTP);

    await CarePlanTemplate.collection.updateOne({ _id: std._id }, { $set: { riskRules: oldRules, builtInRulesVersion: 3, status: 'approved' } });
    await ensureStandardTemplates(hospital._id);
    const approved = await CarePlanTemplate.findOne(filter).lean();
    expect(approved.status).toBe('approved');
    expect(approved.riskRules.find((r) => r.key === 'abortions_3_plus').source).toBe(OLD); // the doctor edits it (Library → Risk rules)
  });

  it('an unedited draft medicine safety list gets the new misoprostol text; an approved one keeps its own', async () => {
    const OLD = 'Causes uterine contractions and abortion. Only when induction of labour or termination is intended, under protocol.';
    const oldEntries = BUILT_IN_MED_SAFETY.map((m) => (m.key === 'misoprostol' ? { ...m, message: OLD } : m));
    await ensureMedicineSafety(hospital._id);
    const filter = { tenantId: hospital._id, set: 'standard' };

    await MedicineSafetyList.collection.updateOne({ tenantId: hospital._id, set: 'standard' }, { $set: { entries: oldEntries, builtInVersion: 1, status: 'draft' } });
    await ensureMedicineSafety(hospital._id);
    const draft = await MedicineSafetyList.findOne(filter).lean();
    expect(draft.builtInVersion).toBe(BUILT_IN_MED_SAFETY_VERSION);
    expect(JSON.stringify(draft.entries)).not.toMatch(MTP);

    await MedicineSafetyList.collection.updateOne({ tenantId: hospital._id, set: 'standard' }, { $set: { entries: oldEntries, builtInVersion: 1, status: 'approved' } });
    await ensureMedicineSafety(hospital._id);
    const approved = await MedicineSafetyList.findOne(filter).lean();
    expect(approved.entries.find((m) => m.key === 'misoprostol').message).toBe(OLD); // the doctor edits it (Prescription sets → Medicine safety)
  });
});

describe('the fetal-sex protection stays, and catches whole karyotypes', () => {
  it('server and website refuse 69,XXY, 47,XXY and 69,XXX, and let "10, X-ray" and a bare XXX through', () => {
    for (const words of [serverWords, clientWords]) {
      for (const t of ['partial mole, 69,XXY', '47,XXY', '69,XXX', '69, XYY', '46,XY']) expect([t, words.mentionsFetalSex(t)]).toEqual([t, true]);
      for (const t of ['Hb 10, X-ray chest', 'XXX', 'Hb 10, X-ray']) expect([t, words.mentionsFetalSex(t)]).toEqual([t, false]);
    }
    expect(clientWords.KARYOTYPE.source).toBe(serverWords.KARYOTYPE.source);
  });
});
