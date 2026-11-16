// Hospital separation (health check L6, 16 Nov 2026): every query on hospital data names ONE hospital – an id, its text
// or { $eq } – and a list of hospitals only when the query says so (acrossHospitals). Operators that could match other
// hospitals ($ne, $exists, $nin …) are always refused.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Patient } from '../src/models/Patient.js';
import { connectTestDb, createTenant, disconnectTestDb, resetTestDb } from './helpers.js';

beforeAll(connectTestDb);
beforeEach(resetTestDb);
afterAll(disconnectTestDb);

describe('the hospital guard (health check L6)', () => {
  it('takes one hospital, written any plain way', async () => {
    const h = await createTenant('Guard Hospital');
    await expect(Patient.countDocuments({ tenantId: h._id })).resolves.toBe(0);
    await expect(Patient.countDocuments({ tenantId: String(h._id) })).resolves.toBe(0);
    await expect(Patient.countDocuments({ tenantId: { $eq: h._id } })).resolves.toBe(0);
    await expect(Patient.aggregate([{ $match: { tenantId: h._id } }])).resolves.toEqual([]);
  });

  it('refuses anything that could match other hospitals', async () => {
    const h = await createTenant('Guard Hospital');
    await expect(Patient.find({})).rejects.toThrow(/without a tenantId/);
    await expect(Patient.find({ tenantId: { $ne: h._id } })).rejects.toThrow(/one hospital/);
    await expect(Patient.find({ tenantId: { $exists: true } })).rejects.toThrow(/one hospital/);
    await expect(Patient.find({ tenantId: { $in: [h._id] } })).rejects.toThrow(/one hospital/);
    await expect(Patient.aggregate([{ $match: { tenantId: { $ne: h._id } } }])).rejects.toThrow(/one hospital/);
  });

  it('a list of named hospitals only when the query says so – never $ne, even then', async () => {
    const [a, b] = [await createTenant('Guard A'), await createTenant('Guard B')];
    await expect(Patient.countDocuments({ tenantId: { $in: [a._id, b._id] } }).setOptions({ acrossHospitals: true })).resolves.toBe(0);
    await expect(Patient.find({ tenantId: { $ne: a._id } }).setOptions({ acrossHospitals: true })).rejects.toThrow(/one hospital/);
  });
});
