import { LabOrder } from '../models/LabOrder.js';

// The latest semen analysis on her record (fertility idea F2, the owner's go-ahead of 27 Oct 2026), and the choice it
// suggests for the fertility history's "Semen analysis" (fertility/fertilityFields.js SEMEN_STATUS). The doctor sets
// the history with one click on the Treatment plan tab, or chooses otherwise – the result never changes it by itself.
//
// The rule (doctor to confirm): no sperm → azoospermia; a concentration under 5 million/mL (severe oligozoospermia) →
// severe changes; any other value under its WHO 2021 lower reference limit → mild changes; all within → normal.
// Without the concentration, motility and normal forms there is no suggestion.

export const SEVERE_CONCENTRATION = 5; // million/mL
const WHO_2021 = { volume: 1.4, count: 16, totalCount: 39, motility: 42, progressive: 30, vitality: 54, morphology: 4 };
const NEEDED = ['count', 'motility', 'morphology'];

const numberOf = (v) => {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

/** { status, below: [keys under the limit] } or null when the result is too incomplete to suggest anything. */
export function semenStatusFrom(values) {
  const n = Object.fromEntries((values ?? []).map((v) => [v.key, numberOf(v.value)]));
  if (n.count === 0) return { status: 'azoospermia', below: ['count'] };
  if (NEEDED.some((k) => n[k] == null)) return null;
  const below = Object.entries(WHO_2021)
    .filter(([k, limit]) => n[k] != null && n[k] < limit)
    .map(([k]) => k);
  if (n.count < SEVERE_CONCENTRATION) return { status: 'severe_abnormal', below };
  return { status: below.length ? 'mild_abnormal' : 'normal', below };
}

/** Her latest reported semen analysis: { orderId, at, values, suggested } or null. */
export async function latestSemen(tenantId, patientId) {
  const order = await LabOrder.findOne({ tenantId, patientId, status: { $in: ['reported', 'reviewed'] }, 'tests.key': 'semen' })
    .sort({ 'reported.at': -1, createdAt: -1 })
    .select('tests reported createdAt')
    .lean();
  const test = order?.tests.find((t) => t.key === 'semen');
  if (!test) return null;
  return {
    orderId: order._id.toString(),
    at: order.reported?.at ?? order.createdAt,
    values: test.values.filter((v) => String(v.value ?? '').trim() !== '').map((v) => ({ key: v.key, name: v.name, value: v.value, unit: v.unit ?? '', flag: v.flag ?? '' })),
    suggested: semenStatusFrom(test.values),
  };
}
