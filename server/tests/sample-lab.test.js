// The sample lab data script (npm run sample:lab -w server -- "<hospital>"): run on the test database, it fills every
// list of the lab, QC, stock and scans with FAKE "(Demo)" data, and a second run adds nothing.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImagingOrder } from '../src/models/ImagingOrder.js';
import { LabItem } from '../src/models/LabItem.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { Patient } from '../src/models/Patient.js';
import { QcRun } from '../src/models/QcRun.js';
import { addMember, connectTestDb, createTenant, createUser, disconnectTestDb, resetTestDb } from './helpers.js';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../scripts/sample-lab.js', import.meta.url));

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('the sample lab data', () => {
  it('fills the lab at every step, with demo patients only, once', async () => {
    await resetTestDb();
    const hospital = await createTenant('Demo Lab Hospital');
    await addMember(await createUser({ name: 'Sample Lab' }), hospital, 'lab');
    await addMember(await createUser({ name: 'Sample Doctor' }), hospital, 'doctor');
    const first = await run(process.execPath, [SCRIPT, 'Demo Lab Hospital'], { env: process.env });
    expect(first.stdout).toMatch(/sample lab data added/);
    const tenantId = hospital._id;
    const patients = await Patient.find({ tenantId }).lean();
    expect(patients).toHaveLength(6);
    expect(patients.every((p) => p.fullName.endsWith('(Demo)'))).toBe(true);
    const orders = await LabOrder.find({ tenantId }).lean();
    expect(orders).toHaveLength(10);
    const statuses = orders.map((o) => o.status);
    for (const s of ['ordered', 'collected', 'entered', 'reported']) expect(statuses).toContain(s);
    expect(orders.some((o) => o.home?.status === 'scheduled')).toBe(true);
    expect(orders.some((o) => o.rejections?.length)).toBe(true);
    expect(orders.some((o) => o.tests.some((t) => t.outside?.sent))).toBe(true);
    expect((await QcRun.find({ tenantId }).lean()).map((r) => r.status)).toEqual(expect.arrayContaining(['accepted', 'warning', 'rejected']));
    expect(await LabItem.countDocuments({ tenantId })).toBe(4);
    expect(await ImagingOrder.countDocuments({ tenantId })).toBe(3);
    const again = await run(process.execPath, [SCRIPT, 'Demo Lab Hospital'], { env: process.env });
    expect(again.stdout).toMatch(/already has the sample lab data/);
    expect(await LabOrder.countDocuments({ tenantId })).toBe(10);
  });
});
