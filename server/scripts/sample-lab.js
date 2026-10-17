// Sample lab data for trying the full lab (owner, 17 Oct 2026 – docs/LAB_V2_PLAN.md) – FAKE SAMPLE DATA ONLY, never in a
// real hospital. Every patient's name ends in "(Demo)" and every phone number is made up (90000 000xx).
//
//   npm run sample:lab -w server -- "Anandi Hospital"
//
// For the hospital named, it adds: 2 referrers; 6 demo patients; lab orders at every step of the flow (a home
// collection, samples to take – one urgent and late, one rejected and to take again – results to enter, results to
// check, one test at an outside lab, reported walk-in reports with a QR code and an earlier result for the trend, a
// result waiting for the doctor's review); quality-control lots with 10 days of runs (a warning and a rejected run);
// lab stock (one item low, one batch expiring soon) with what each test uses; and 3 scans (to schedule, to report,
// signed). Charges go on the bills as usual. Running it again adds nothing (it checks for the demo referrer first).
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { billLabOrdered } from '../src/billing/hooks.js';
import { hospitalToday } from '../src/careplans/dates.js';
import { westgard, zScore } from '../src/lab/qc.js';
import { dueAt, fieldFor, labCatalogue, nextSampleNo, rangeContext, setupOf } from '../src/lab/labSetup.js';
import { flagFor, isAbnormal } from '../src/lab/labTests.js';
import { ImagingOrder } from '../src/models/ImagingOrder.js';
import { LabBatch } from '../src/models/LabBatch.js';
import { LabItem } from '../src/models/LabItem.js';
import { LabOrder } from '../src/models/LabOrder.js';
import { LabStockMove } from '../src/models/LabStockMove.js';
import { Membership } from '../src/models/Membership.js';
import { QcLot } from '../src/models/QcLot.js';
import { QcRun } from '../src/models/QcRun.js';
import { Referrer } from '../src/models/Referrer.js';
import { Tenant } from '../src/models/Tenant.js';
import { User } from '../src/models/User.js';
import { registerPatient } from '../src/routes/patients.js';

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Give the hospital\'s name, e.g.: npm run sample:lab -w server -- "Anandi Hospital"');
  process.exit(1);
}

await mongoose.connect(config.MONGO_URI);
const tenant = await Tenant.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
if (!tenant) {
  console.error(`No hospital is called "${name}".`);
  await mongoose.disconnect();
  process.exit(1);
}
const tenantId = tenant._id;
async function memberWith(role) {
  const m = await Membership.findOne({ tenantId, isActive: true, roles: role }).lean();
  const u = m ? await User.findById(m.userId).lean() : null;
  return u ? { user: u, membership: m } : null;
}
const lab = await memberWith('lab');
const doctor = await memberWith('doctor');
if (!lab || !doctor) {
  console.error(`${tenant.name} needs at least one active lab staff member and one doctor. Add them first (Hospital admin → Staff).`);
  await mongoose.disconnect();
  process.exit(1);
}
if (await Referrer.exists({ tenantId, name: 'Dr Meera Kulkarni (Demo)' })) {
  console.log(`${tenant.name} already has the sample lab data. Nothing added.`);
  await mongoose.disconnect();
  process.exit(0);
}

const now = new Date();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(now.getTime() - ms);
const reqOf = (who, at = now) => ({ tenantId, user: who.user, membership: who.membership, now: at, ip: null, get: () => 'sample-lab script' });
const stamp = (who, at) => ({ by: who.user._id, byName: who.user.name, at });
const catalogue = await labCatalogue(tenantId);

// ---------- Referrers and patients ----------
const meera = await Referrer.create({ tenantId, kind: 'doctor', name: 'Dr Meera Kulkarni (Demo)', qualification: 'MBBS, MD', registrationNumber: 'DEMO-1234', phone: '90000 00090', address: 'Sample Clinic, Pune', updatedByName: lab.user.name });
const city = await Referrer.create({ tenantId, kind: 'centre', name: 'City Diagnostics Centre (Demo)', phone: '90000 00091', address: 'Sample Road, Pune', updatedByName: lab.user.name });

async function patient(fullName, ageYears, phoneEnd, extra = {}, who = lab) {
  const out = await registerPatient(reqOf(who), { careType: 'gynaecology', fullName, ageYears, phone: `90000 000${phoneEnd}`, address: `${phoneEnd} Sample Lane, Pune`, registerAnyway: true, ...extra });
  return out.patient;
}
const asha = await patient('Asha Patil (Demo)', 34, '01');
const kavita = await patient('Kavita Shinde (Demo)', 29, '02');
const rekha = await patient('Rekha Jadhav (Demo)', 41, '03');
const sunita = await patient('Sunita More (Demo)', 52, '04');
const pooja = await patient('Pooja Deshmukh (Demo)', 26, '05');
const mother = await patient('Neha Gaikwad (Demo)', 27, '06', { careType: 'antenatal', assignedDoctor: String(doctor.user._id), pregnancy: { scanEdd: new Date(now.getTime() + 160 * DAY).toISOString().slice(0, 10) } }, doctor);

// ---------- Lab orders at every step ----------
const homeOn = hospitalToday(now);
async function order(p, keys, { at = now, urgent = false, source = 'walk_in', referrer = null, prescription = '', home = null, by = lab, noteToLab = '' } = {}) {
  const tests = keys.map((k) => ({ key: k, name: catalogue.byKey.get(k).name, values: [], text: '', department: catalogue.byKey.get(k).department }));
  const o = await LabOrder.create({
    tenantId,
    patientId: p._id,
    urgent,
    tests,
    noteToLab,
    sampleNo: await nextSampleNo(tenantId, at),
    dueAt: dueAt(at, tests.map((t) => setupOf(catalogue, t.key)), urgent),
    ordered: stamp(by, at),
    clientRequestId: randomUUID(),
    source,
    referrer: referrer ? { id: referrer._id, name: referrer.name, kind: referrer.kind } : null,
    prescription,
    home,
  });
  await billLabOrdered(reqOf(by, at), p, o);
  return o;
}
/** Fills in results (as the lab would type them), with the range that applies to her and the flags. */
function fill(o, p, values, at) {
  const ctx = rangeContext(p, at);
  o.tests = o.tests.map((t) => {
    const def = catalogue.byKey.get(t.key);
    const vals = Object.entries(values[t.key] ?? {}).map(([key, value]) => {
      const f = fieldFor(def.fields.find((x) => x.key === key), ctx);
      return { key, value, flag: flagFor(f, value), name: f.name, ...(f.unit ? { unit: f.unit } : {}), ...(f.range ? { range: f.range } : {}) };
    });
    return { ...t.toObject(), values: vals };
  });
  o.abnormal = o.tests.some((t) => t.values.some((v) => isAbnormal(v.flag)));
  o.lastSaved = stamp(lab, at);
}
async function reported(o, p, values, at, { status = 'reported' } = {}) {
  o.status = 'collected';
  o.collected = stamp(lab, new Date(at.getTime() - 2 * HOUR));
  fill(o, p, values, at);
  o.status = status;
  o.reported = stamp(lab, at);
  o.verifyToken = `${String(tenantId)}.${randomBytes(12).toString('hex')}`;
  o.stockTaken = true;
  o.rev += 3;
  await o.save();
  return o;
}

// 1. A home collection today (scheduled)
await order(asha, ['cbc', 'tsh'], { referrer: meera, prescription: 'Prescription of today', home: { address: '01 Sample Lane, Pune', on: homeOn, time: '11:30', collectorId: lab.user._id, collectorName: lab.user.name, status: 'scheduled', note: '', updated: stamp(lab, now) } });
// 2. Samples to take: an urgent one, past its due time (late)
await order(kavita, ['hb', 'hiv'], { at: ago(6 * HOUR), urgent: true, referrer: city, prescription: 'Referral slip' });
// 3. A rejected sample, to take again
const rej = await order(rekha, ['fbs'], { at: ago(3 * HOUR), prescription: 'Self – fasting sugar' });
rej.rejections.push({ ...stamp(lab, ago(2 * HOUR)), reason: 'haemolysed', note: 'Pink plasma (demo)' });
rej.rev += 1;
await rej.save();
// 4. Results to enter (sample taken)
const toEnter = await order(sunita, ['lft', 'rft'], { at: ago(4 * HOUR), referrer: meera, prescription: 'Prescription of today' });
Object.assign(toEnter, { status: 'collected', collected: stamp(lab, ago(3 * HOUR)), rev: 1 });
await toEnter.save();
// 5. Results to check (entered by the lab, waiting for a second person)
const toCheck = await order(pooja, ['hb'], { at: ago(5 * HOUR), prescription: 'Self' });
toCheck.status = 'collected';
toCheck.collected = stamp(lab, ago(4 * HOUR));
fill(toCheck, pooja, { hb: { hb: '11.6' } }, ago(1 * HOUR));
Object.assign(toCheck, { status: 'entered', entered: stamp(lab, ago(1 * HOUR)), rev: 2 });
await toCheck.save();
// 6. A test at an outside lab
const outside = await order(asha, ['bhcg'], { at: ago(DAY), referrer: meera, prescription: 'Prescription of yesterday' });
outside.status = 'collected';
outside.collected = stamp(lab, ago(DAY - HOUR));
outside.tests[0].outside = { labName: 'Sample Town Lab (Demo)', ref: 'ST-DEMO-1', sent: stamp(lab, ago(DAY - 2 * HOUR)), received: null };
outside.markModified('tests');
outside.rev = 2;
await outside.save();
// 7. Reported walk-in reports – Kavita's Hb two weeks ago, then today's lower Hb (the trend)
const earlier = await order(kavita, ['hb'], { at: ago(14 * DAY), referrer: city, prescription: 'Referral slip' });
await reported(earlier, kavita, { hb: { hb: '11.8' } }, ago(14 * DAY - 3 * HOUR));
const latest = await order(kavita, ['hb', 'urine'], { at: ago(8 * HOUR), referrer: city, prescription: 'Referral slip' });
await reported(latest, kavita, { hb: { hb: '9.1' }, urine: { albumin: 'Nil', sugar: 'Nil', pusCells: '3' } }, ago(5 * HOUR));
const thyroid = await order(sunita, ['tsh', 'hba1c'], { at: ago(2 * DAY), referrer: meera, prescription: 'Prescription' });
await reported(thyroid, sunita, { tsh: { tsh: '6.2' }, hba1c: { hba1c: '6.1' } }, ago(2 * DAY - 4 * HOUR));
// 8. The pregnant patient's tests ordered by her doctor, reported, waiting for the doctor's review
const anc = await order(mother, ['cbc', 'group', 'hiv', 'hbsag', 'vdrl'], { at: ago(DAY), source: 'doctor', by: doctor, noteToLab: 'Booking tests' });
await reported(anc, mother, { cbc: { hb: '10.4', tlc: '8200', platelets: '2.4' }, group: { group: 'B+' }, hiv: { hiv: 'Non-reactive' }, hbsag: { hbsag: 'Non-reactive' }, vdrl: { vdrl: 'Non-reactive' } }, ago(20 * HOUR));

// ---------- Quality control: 10 days of runs ----------
async function lot(testKey, fieldKey, level, lotNo, mean, sd, values) {
  const l = await QcLot.create({ tenantId, testKey, fieldKey, level, material: 'Sample control (Demo)', lotNo, expiresOn: new Date(now.getTime() + 90 * DAY), mean, sd, createdByName: lab.user.name });
  const zs = [];
  for (const [i, value] of values.entries()) {
    const at = new Date(now.getTime() - (values.length - 1 - i) * DAY - 2 * HOUR);
    const z = zScore(value, l);
    const { violations, status } = westgard(z, zs.slice(-9));
    zs.push(z);
    await QcRun.create({ tenantId, lotId: l._id, testKey, fieldKey, level, value, z, violations, status, run: stamp(lab, at) });
  }
}
await lot('hb', 'hb', 1, 'HB-L1-DEMO', 12, 0.3, [12.1, 11.9, 12.2, 12.0, 12.3, 11.8, 12.1, 12.7, 12.0, 13.1]); // a warning, then today rejected
await lot('hb', 'hb', 2, 'HB-L2-DEMO', 7.5, 0.25, [7.4, 7.6, 7.5, 7.7, 7.3, 7.5, 7.6, 7.4, 7.5, 7.6]);
await lot('fbs', 'fbs', 1, 'GLU-L1-DEMO', 95, 3, [94, 96, 97, 93, 95, 98, 96, 94, 95, 97]);

// ---------- Lab stock ----------
async function item(nameOf, kind, unit, reorderLevel, perTest, batches) {
  const it = await LabItem.create({ tenantId, name: nameOf, kind, unit, reorderLevel, perTest, updatedByName: lab.user.name });
  for (const b of batches) {
    const batch = await LabBatch.create({ tenantId, itemId: it._id, batchNo: b.no, expiresOn: b.exp ? new Date(now.getTime() + b.exp * DAY) : null, qty: b.qty, unitCostPaise: b.cost, supplier: 'Sample Supplies (Demo)', receivedAt: ago(10 * DAY) });
    await LabStockMove.create({ tenantId, itemId: it._id, batchId: batch._id, kind: 'received', qty: b.qty, costPaise: b.qty * b.cost, by: lab.user._id, byName: lab.user.name, at: ago(10 * DAY) });
  }
}
await item('Haemoglobin reagent (Demo)', 'reagent', 'test', 20, [{ testKey: 'hb', qty: 1 }, { testKey: 'cbc', qty: 1 }], [{ no: 'HBR-SOON', exp: 12, qty: 15, cost: 1500 }, { no: 'HBR-LATE', exp: 300, qty: 100, cost: 1800 }]);
await item('CBC diluent pack (Demo)', 'reagent', 'test', 25, [{ testKey: 'cbc', qty: 1 }], [{ no: 'CBC-01', exp: 200, qty: 8, cost: 4000 }]); // low
await item('EDTA tubes (Demo)', 'consumable', 'piece', 50, [{ testKey: 'cbc', qty: 1 }, { testKey: 'hb', qty: 1 }, { testKey: 'group', qty: 1 }], [{ no: 'EDTA-22', exp: 400, qty: 300, cost: 600 }]);
await item('TSH kit (Demo)', 'reagent', 'test', 10, [{ testKey: 'tsh', qty: 1 }], [{ no: 'TSH-07', exp: 150, qty: 48, cost: 9000 }]);

// ---------- Scans ----------
async function scan(study, status, extra = {}) {
  await ImagingOrder.create({ tenantId, patientId: mother._id, study, status, ordered: stamp(doctor, ago(2 * DAY)), clientRequestId: randomUUID(), indication: 'Routine antenatal scan (demo)', ...extra });
}
await scan('usg_anomaly', 'ordered');
await scan('usg_growth', 'done', { scheduledFor: ago(3 * HOUR), scheduled: stamp(lab, ago(DAY)), done: stamp(doctor, ago(2 * HOUR)) });
await scan('usg_early', 'signed', {
  scheduledFor: ago(60 * DAY),
  done: stamp(doctor, ago(60 * DAY)),
  report: { values: { site: 'Intrauterine', number: 'Single', crl: 24, cardiac: 'Present', fhr: 162 }, findings: 'Single live intrauterine pregnancy.', impression: 'Viable pregnancy, dates as by scan.' },
  saved: stamp(doctor, ago(60 * DAY)),
  signed: stamp(doctor, ago(60 * DAY)),
});

console.log(`${tenant.name}: sample lab data added – 2 referrers, 6 demo patients, 10 lab orders, 3 QC lots with 30 runs, 4 stock items, 3 scans.`);
await mongoose.disconnect();
