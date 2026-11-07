import { Admission } from '../models/Admission.js';
import { ClinicalDocument } from '../models/ClinicalDocument.js';
import { MeowsChartHeader, MeowsEntry } from '../models/MeowsEntry.js';
import { rate } from './dashboards.js';
import { OVERDUE_GRACE_MINUTES } from './meows.js';

// The three OBG-A-05 rows fed by the MEOWS chart (field schema build8_meows.json, kpi_feeds) for the monthly dashboard
// (clinical/dashboardData.js). Worked out from the records, never typed; every query names the hospital.
//  - meows4hFirst24h: postnatal stays (chart context "postnatal") whose first 24 h – from the time of birth on the
//    stay's signed delivery note, else from admission – began this month and are over; numerator: those with no
//    overdue observation in those 24 h (a gap longer than the ordered frequency, at most 4 h, + 15 min – E4);
//  - meowsSepsisAbx1h: triggers this month where the sepsis pathway was chosen; numerator: first antibiotic within
//    60 min of the trigger's clinical time;
//  - meowsSevereHtn30: hypertensive emergencies this month (the first set of a run of flagged sets on a stay);
//    numerator: an antihypertensive recorded within 30 min of that first flag, on any set of the run.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ms = (d) => new Date(d).getTime();

/** True when no gap in [from, from + 24 h] is longer than the allowed minutes (observation times sorted). PURE. */
export function first24hOnTime(from, times, frequencyMinutes) {
  const allowed = (Math.min(frequencyMinutes || 240, 240) + OVERDUE_GRACE_MINUTES) * MIN;
  const start = ms(from);
  const end = start + DAY;
  let prev = start;
  for (const t of times.map(ms).filter((t) => t >= start && t <= end).sort((a, b) => a - b)) {
    if (t - prev > allowed) return false;
    prev = t;
  }
  return end - prev <= allowed;
}

export async function meowsKpis(tenantId, { start, end }, now = new Date()) {
  // 1. MEOWS 4-hourly in the first 24 h postnatal
  const headers = await MeowsChartHeader.find({ tenantId, context: 'postnatal' }, { admissionId: 1, frequencyMinutes: 1 }).lean();
  const stayIds = headers.map((h) => h.admissionId);
  const [stays, notes] = stayIds.length
    ? await Promise.all([
        Admission.find({ tenantId, _id: { $in: stayIds } }, { admittedAt: 1 }).lean(),
        ClinicalDocument.find({ tenantId, admissionId: { $in: stayIds }, kind: 'delivery', status: 'signed' }, { admissionId: 1, 'content.deliveredAt': 1 }).lean(),
      ])
    : [[], []];
  const windows = headers
    .map((h) => {
      const stay = stays.find((s) => String(s._id) === String(h.admissionId));
      const born = notes.find((n) => String(n.admissionId) === String(h.admissionId))?.content?.deliveredAt;
      const from = born ?? stay?.admittedAt;
      return from && { id: h.admissionId, from: new Date(from), frequency: h.frequencyMinutes };
    })
    .filter((w) => w && w.from >= start && w.from < end && ms(w.from) + DAY <= ms(now));
  const sets = windows.length ? await MeowsEntry.find({ tenantId, admissionId: { $in: windows.map((w) => w.id) }, cancelled: null }, { admissionId: 1, at: 1 }).lean() : [];
  const onTime = windows.filter((w) => first24hOnTime(w.from, sets.filter((s) => String(s.admissionId) === String(w.id)).map((s) => s.at), w.frequency)).length;

  // 2. Suspected sepsis: antibiotics within 1 h of the trigger
  const sepsis = await MeowsEntry.find({ tenantId, at: { $gte: start, $lt: end }, cancelled: null, level: 'trigger', 'pathway.key': 'sepsis' }, { at: 1, antibioticAt: 1 }).lean();
  const abxOnTime = sepsis.filter((e) => e.antibioticAt?.at && ms(e.antibioticAt.at) - ms(e.at) <= 60 * MIN).length;

  // 3. Severe hypertension treated within 30 min
  const flagged = await MeowsEntry.find({ tenantId, at: { $gte: start, $lt: end }, cancelled: null, hypertensiveEmergency: true }, { admissionId: 1 }).lean();
  const htnStays = [...new Set(flagged.map((e) => String(e.admissionId)))];
  const all = htnStays.length ? await MeowsEntry.find({ tenantId, admissionId: { $in: htnStays }, cancelled: null }, { admissionId: 1, at: 1, hypertensiveEmergency: 1, antihypertensiveAt: 1 }).sort({ at: 1, _id: 1 }).lean() : [];
  let episodes = 0;
  let treated = 0;
  for (const id of htnStays) {
    const list = all.filter((e) => String(e.admissionId) === id);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.hypertensiveEmergency || (i > 0 && list[i - 1].hypertensiveEmergency) || e.at < start || e.at >= end) continue;
      episodes += 1;
      let given = false;
      for (let j = i; j < list.length && list[j].hypertensiveEmergency; j++) {
        const t = list[j].antihypertensiveAt?.at;
        if (t && ms(t) >= ms(e.at) && ms(t) - ms(e.at) <= 30 * MIN) given = true;
      }
      if (given) treated += 1;
    }
  }
  return {
    meows4hFirst24h: rate(onTime, windows.length),
    meowsSepsisAbx1h: rate(abxOnTime, sepsis.length),
    meowsSevereHtn30: rate(treated, episodes),
  };
}
