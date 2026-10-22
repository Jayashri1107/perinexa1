// People's names start every word with a capital letter (21 Oct 2026): "jayashri sable" → "Jayashri Sable", whoever
// types it and wherever. Only the first letter of a word changes. Medicine and business names are left as typed.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { capitalizeName } from '../src/utils/personName.js';
import { User } from '../src/models/User.js';
import { addMember, connectTestDb, createSuperAdmin, createTenant, createUser, disconnectTestDb, loginAs, resetTestDb, samplePatient } from './helpers.js';

describe('capitalizeName', () => {
  it('capitalises the first letter of every word and nothing else', () => {
    expect(capitalizeName('jayashri sable')).toBe('Jayashri Sable');
    expect(capitalizeName('JAYASHRI sable')).toBe('JAYASHRI Sable'); // the rest stays as typed
    expect(capitalizeName('walk-in mother')).toBe('Walk-in Mother'); // only after a space
    expect(capitalizeName('baby of asha patil')).toBe('Baby of Asha Patil'); // "of" stays small inside a name
    expect(capitalizeName('of drB')).toBe('Of DrB'); // …but not as the first word
    expect(capitalizeName('A.K. mcDonald')).toBe('A.K. McDonald');
    expect(capitalizeName('dr. meera  iyer')).toBe('Dr. Meera  Iyer');
    expect(capitalizeName('आशा पाटील')).toBe('आशा पाटील'); // no capitals in Devanagari
    expect(capitalizeName('')).toBe('');
    expect(capitalizeName(undefined)).toBe(undefined);
  });
});

describe('names typed in small letters are saved with capitals', () => {
  beforeAll(connectTestDb);
  beforeEach(resetTestDb);
  afterAll(disconnectTestDb);

  it('a patient and her emergency contact', async () => {
    const home = await createTenant('Names Hospital');
    const doctor = await createUser();
    await addMember(doctor, home, 'doctor');
    const s = await loginAs(doctor);
    const res = await s.post('/api/patients').send(samplePatient({ fullName: 'asha  patil', emergencyContact: { name: 'ravi patil', relation: 'Husband', phone: '+91 00000 00001' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.patient.fullName).toBe('Asha  Patil');
    expect(res.body.patient.emergencyContact.name).toBe('Ravi Patil');
  });

  it('staff added by the super admin, and a person changing their own name', async () => {
    const home = await createTenant('Names Hospital');
    const sa = await createSuperAdmin();
    const root = await loginAs(sa);
    const added = await root.agent.post(`/api/platform/tenants/${home._id}/members`).send({ name: 'jayashri sable', email: 'jayashri.names@example.com', roles: ['nurse'] });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect((await User.findOne({ email: 'jayashri.names@example.com' })).name).toBe('Jayashri Sable');

    const nurse = await createUser();
    await addMember(nurse, home, 'nurse');
    const n = await loginAs(nurse);
    const mine = await n.put('/api/auth/me/details').send({ name: 'meera kulkarni' });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((await User.findById(nurse._id)).name).toBe('Meera Kulkarni');
  });
});
