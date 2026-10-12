// Feature 5: care-plan template library.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb } from './helpers.js';

const app = createApp();
let hospital;
let other;
const s = {};
const people = {};

beforeAll(connectTestDb);
beforeEach(async () => {
  await resetTestDb();
  hospital = await createTenant('Template Hospital');
  other = await createTenant('Other Hospital');
  for (const [key, roles] of Object.entries({ drA: 'doctor', drB: 'doctor', rmo: 'rmo', nurse: 'nurse', reception: 'receptionist', admin: 'admin' })) {
    people[key] = await createUser({ name: key });
    await addMember(people[key], hospital, roles);
    s[key] = await loginAs(people[key], { app });
  }
});
afterAll(disconnectTestDb);

const standard = async (who = 'drA') => {
  const list = await s[who].get('/api/care-plans/templates');
  return list.body.templates.find((t) => t.kind === 'standard' && t.careType === 'antenatal');
};
const full = async (who, id) => (await s[who].get(`/api/care-plans/templates/${id}`)).body.template;

describe('the standard antenatal template', () => {
  it('is created for each hospital as an unapproved draft', async () => {
    const t = await standard();
    expect(t).toMatchObject({ status: 'draft', version: 1, canEdit: true, canApprove: true });
    expect(t.itemCount).toBeGreaterThan(30);
    const detail = await full('drA', t.id);
    expect(detail.items.find((i) => i.key === 'scan_anomaly')).toMatchObject({ kind: 'scan', fromWeek: 18, toWeek: 20 });
    expect(detail.items.find((i) => i.key === 'lab_ict1').appliesWhen).toBe('rh_negative');
  });

  it('is viewable by nurses and RMOs, but only doctors may change or approve it', async () => {
    const t = await standard();
    for (const who of ['nurse', 'rmo']) {
      const d = await full(who, t.id);
      expect(d).toMatchObject({ canEdit: false, canApprove: false });
      expect((await s[who].post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: 1 })).status).toBe(403);
    }
    expect((await s.reception.get('/api/care-plans/templates')).status).toBe(403);
    expect((await s.admin.get('/api/care-plans/templates')).status).toBe(403);
  });

  it('needs the doctor to confirm they reviewed it, and records who approved it', async () => {
    const t = await standard();
    expect((await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({})).status).toBe(400);
    const res = await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: 1 });
    expect(res.body.template).toMatchObject({ status: 'approved', approvedByName: 'drA', approvedVersion: 1 });
    expect(await AuditLog.countDocuments({ action: 'TEMPLATE_APPROVED' })).toBe(1);
  });

  it('goes back to draft (new version) when changed', async () => {
    const t = await standard();
    await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: 1 });
    const d = await full('drA', t.id);
    const items = d.items.filter((i) => i.key !== 'visit_41');
    const res = await s.drB.put(`/api/care-plans/templates/${t.id}`).send({ version: d.version, name: d.name, description: d.description, sources: d.sources, items });
    expect(res.status).toBe(200);
    expect(res.body.template).toMatchObject({ status: 'draft', version: 2, approvedVersion: 1, updatedByName: 'drB' });
    expect(res.body.template.items.some((i) => i.key === 'visit_41')).toBe(false);
  });

  it('is separate per hospital', async () => {
    const t = await standard();
    await s.drA.post(`/api/care-plans/templates/${t.id}/approve`).send({ confirm: true, version: 1 });
    await addMember(people.drA, other, 'doctor');
    await s.drA.switchTo(other);
    const t2 = await standard();
    expect(t2.id).not.toBe(t.id);
    expect(t2.status).toBe('draft');
    expect((await s.drA.get(`/api/care-plans/templates/${t.id}`)).status).toBe(404);
  });
});

describe("doctors' own protocols", () => {
  it('a doctor copies the standard template into their own protocol that only they can change', async () => {
    const t = await standard();
    const res = await s.drA.post('/api/care-plans/templates').send({ copyFrom: t.id });
    expect(res.status).toBe(201);
    const mine = res.body.template;
    expect(mine).toMatchObject({ kind: 'personal', ownerName: 'drA', status: 'draft', canEdit: true });
    expect(mine.items.length).toBe((await full('drA', t.id)).items.length);

    const asB = await full('drB', mine.id);
    expect(asB).toMatchObject({ canEdit: false, canApprove: false });
    expect((await s.drB.put(`/api/care-plans/templates/${mine.id}`).send({ version: mine.version, name: 'Hijack', items: [] })).status).toBe(403);
    expect((await s.drB.post(`/api/care-plans/templates/${mine.id}/approve`).send({ confirm: true, version: 1 })).status).toBe(403);
    expect((await s.drA.post(`/api/care-plans/templates/${mine.id}/approve`).send({ confirm: true, version: 1 })).body.template.status).toBe('approved');
  });

  it('only doctors can create protocols', async () => {
    expect((await s.rmo.post('/api/care-plans/templates').send({ careType: 'antenatal' })).status).toBe(403);
    expect((await s.nurse.post('/api/care-plans/templates').send({ careType: 'antenatal' })).status).toBe(403);
  });
});

describe('validation of template items', () => {
  it('checks timing, week ranges, duplicate codes and references', async () => {
    const mine = (await s.drA.post('/api/care-plans/templates').send({ careType: 'antenatal', name: 'Test protocol' })).body.template;
    const res = await s.drA.put(`/api/care-plans/templates/${mine.id}`).send({
      version: mine.version,
      name: 'Test protocol',
      items: [
        { key: 'a', kind: 'visit', name: 'No timing' },
        { key: 'b', kind: 'scan', name: 'Backwards', fromWeek: 20, toWeek: 18 },
        { key: 'b', kind: 'scan', name: 'Duplicate', atBooking: true },
        { key: 'c', kind: 'vaccination', name: 'After nothing', after: { key: 'zzz', weeks: 4 } },
        { key: 'Bad Key', kind: 'advice', name: 'x', atBooking: true },
      ],
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['items.0.fromWeek', 'items.1.toWeek', 'items.2.key', 'items.3.after.key', 'items.4.key']);
    expect((await s.drA.post(`/api/care-plans/templates/${mine.id}/approve`).send({ confirm: true, version: 1 })).status).toBe(400); // empty
  });
});
