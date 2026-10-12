// The readings of this pregnancy that the risk rules use:
//  - the lowest haemoglobin: from the vital signs of her visits, and from lab results once a doctor has
//    reviewed them. A result that is only reported does not count. A result changed after its review keeps
//    counting as the doctor reviewed it until a doctor reviews the change (never dropped in between, which
//    could lower the level without a doctor having seen anything);
//  - the latest blood pressure: from the vital signs of her visits.
// Only antenatal visits that are not marked "entered in error", and only since this pregnancy began
// (patients/pregnancyFindings.js pregnancySince – the same rule as the red flags' "visits of this pregnancy").
//
// They are read again from the visits and lab orders every time a risk level is worked out, and kept on the
// record (pregnancy.readings) so the rules, the screens and the lists use the same values. Nobody types them.

import { toHospitalDate } from './dates.js';
import { LabOrder } from '../models/LabOrder.js';
import { Visit } from '../models/Visit.js';
import { pregnancySince } from '../patients/pregnancyFindings.js';

// Lab tests that carry a haemoglobin value (its value key is 'hb'): lab/labTests.js.
const HB_TESTS = ['cbc', 'hb'];
// g/dL, as the visit form accepts. A lab value outside it (e.g. typed in g/L) is left out: it never raises or
// lowers the level.
const HB_MIN = 2;
const HB_MAX = 25;

const time = (d) => new Date(d).getTime();

// The tests of a lab order as a doctor last reviewed them: the order's own tests when it is reviewed; for an
// order changed after a review (back to "reported"), the results kept from that review. null: never reviewed.
function reviewedTests(order) {
  if (order.status === 'reviewed') return order.tests ?? [];
  if (order.status !== 'reported') return null;
  return (order.amendments ?? []).filter((a) => a.reviewedAt).at(-1)?.tests ?? null;
}

/**
 * The readings from one patient's visits and lab orders (pure). visits: her antenatal visits that are not
 * entered in error; orders: her lab orders; `since`: the first day of this pregnancy.
 * Returns { lowestHb: { value, on, source } | null, latestBp: { systolic, diastolic, on } | null }, or null when
 * there is neither.
 */
export function readingsOf(visits, orders, since) {
  const from = time(since);
  const hbs = [];
  let latestBp = null;
  let latestKey = null;
  for (const v of visits) {
    if (time(v.visitOn) < from) continue;
    const vit = v.vitals ?? {};
    if (vit.hb != null) hbs.push({ value: vit.hb, on: v.visitOn, source: 'visit' });
    if (vit.bpSystolic != null && vit.bpDiastolic != null) {
      const key = [time(v.visitOn), time(v.createdAt ?? v.visitOn)];
      if (!latestKey || key[0] > latestKey[0] || (key[0] === latestKey[0] && key[1] > latestKey[1])) {
        latestKey = key;
        latestBp = { systolic: vit.bpSystolic, diastolic: vit.bpDiastolic, on: v.visitOn };
      }
    }
  }
  for (const o of orders) {
    // The day of the sample (as the care plan uses for a reviewed result)
    const on = toHospitalDate(o.collected?.at ?? o.reported?.at ?? o.createdAt);
    if (time(on) < from) continue;
    for (const t of reviewedTests(o) ?? []) {
      if (!HB_TESTS.includes(t.key)) continue;
      const raw = (t.values ?? []).find((x) => x.key === 'hb')?.value;
      if (raw == null || String(raw).trim() === '') continue;
      const value = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(value) && value >= HB_MIN && value <= HB_MAX) hbs.push({ value, on, source: 'lab' });
    }
  }
  // The lowest value; of equal values, the day it was first that low
  hbs.sort((a, b) => a.value - b.value || time(a.on) - time(b.on));
  const lowestHb = hbs[0] ?? null;
  return lowestHb || latestBp ? { lowestHb, latestBp } : null;
}

/**
 * The readings of this pregnancy for many patients of one hospital, in two queries: Map patient id → readings
 * (antenatal patients only; a patient without a reading is left out).
 */
export async function readingsFor(tenantId, patients, now = new Date()) {
  const out = new Map();
  const antenatal = patients.filter((p) => p.careType === 'antenatal');
  if (!antenatal.length) return out;
  const since = new Map(antenatal.map((p) => [String(p._id), pregnancySince(p, now)]));
  const earliest = new Date(Math.min(...[...since.values()].map(time)));
  const ids = antenatal.map((p) => p._id);
  const [visits, orders] = await Promise.all([
    Visit.find(
      {
        tenantId,
        patientId: { $in: ids },
        status: 'active',
        careType: 'antenatal',
        visitOn: { $gte: earliest },
        $or: [{ 'vitals.hb': { $ne: null } }, { 'vitals.bpSystolic': { $ne: null } }],
      },
      'patientId visitOn createdAt vitals.hb vitals.bpSystolic vitals.bpDiastolic',
    ).lean(),
    LabOrder.find(
      { tenantId, patientId: { $in: ids }, status: { $in: ['reviewed', 'reported'] }, 'tests.key': { $in: HB_TESTS } },
      'patientId status tests.key tests.values amendments.reviewedAt amendments.tests collected.at reported.at createdAt',
    ).lean(),
  ]);
  const group = (rows) => {
    const by = new Map();
    for (const r of rows) {
      const k = String(r.patientId);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    return by;
  };
  const visitsOf = group(visits);
  const ordersOf = group(orders);
  for (const [id, from] of since) {
    const r = readingsOf(visitsOf.get(id) ?? [], ordersOf.get(id) ?? [], from);
    if (r) out.set(id, r);
  }
  return out;
}

// Readings as plain values, to compare what is stored with what was just read.
const plain = (r) => {
  if (!r || (!r.lowestHb && !r.latestBp)) return null;
  const hb = r.lowestHb ? [r.lowestHb.value, time(r.lowestHb.on), r.lowestHb.source] : null;
  const bp = r.latestBp ? [r.latestBp.systolic, r.latestBp.diastolic, time(r.latestBp.on)] : null;
  return JSON.stringify([hb, bp]);
};

/** Puts the readings on the record (in memory), only when they differ from what is stored. Returns true if they did. */
export function setReadings(patient, readings) {
  if (plain(patient.pregnancy?.readings) === plain(readings)) return false;
  patient.pregnancy.readings = readings && (readings.lowestHb || readings.latestBp) ? { lowestHb: readings.lowestHb ?? null, latestBp: readings.latestBp ?? null } : null;
  return true;
}
