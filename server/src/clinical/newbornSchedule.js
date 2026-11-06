// The newborn screening schedule and the high-risk follow-up clinic at corrected age (Clinical Requirements Group A,
// item 4 – PX-NEO-13, PX-NEO-15, part of PX-NEO-14 and PX-COM-02). DRAFT until the Lead Neonatologist checks it
// against NNF / RBSK and the manual (NEO-F-17). ROP follows NNF / RBSK (owner's decision 5 Nov 2026), not the
// "30 days of life or 31 weeks, whichever later" of PX-NEO-13.
// Sources: RBSK Operational Guidelines (MoHFW 2013) and the Newborn Screening guidance of RBSK; NNF Clinical Practice
// Guidelines – Retinopathy of Prematurity (2020) and Follow-up of High-Risk Newborns (2020).
// Each rule here is a constant in one small file with its source (an edit screen for the super admin is the
// developer's to decide – docs/HANDOVER.md).

export const SCHEDULE_SOURCE = 'RBSK Operational Guidelines (MoHFW 2013); NNF Clinical Practice Guidelines: Retinopathy of Prematurity (2020), Follow-up of High-Risk Newborns (2020)';

// Screens: from and by which day of life (day 0 = the day of birth). `who`: every baby, or only those the rule picks.
export const SCREENS = {
  cchd: { label: 'Pulse oximetry for critical congenital heart disease', fromDay: 1, byDay: 2, who: 'all' },
  metabolic: { label: 'Newborn metabolic screen (heel prick)', fromDay: 1, byDay: 3, who: 'all' },
  hearing: { label: 'Hearing screen (OAE or AABR)', fromDay: 0, byDay: 30, who: 'all' },
  rop: { label: 'Retinopathy of prematurity – first eye examination', fromDay: 20, byDay: 30, who: 'rop' },
};
// ROP: babies born before 34 weeks or under 1750 g (NNF / RBSK); the first examination by day 30 of life – and by
// day 21 (from day 14) for those born before 28 weeks or under 1200 g.
export const ROP_WEEKS = 34;
export const ROP_GRAMS = 1750;
export const ROP_EARLY_WEEKS = 28;
export const ROP_EARLY_GRAMS = 1200;

// The high-risk follow-up clinic: at term-equivalent age (40 weeks after the last period), then 3, 6, 9, 12 and 18
// months of corrected age (NNF). A visit not attended 14 days after its date is a defaulter.
export const VISITS = [
  { key: 'term', label: 'Term-equivalent age (40 weeks)', months: 0 },
  { key: 'm3', label: '3 months corrected age', months: 3 },
  { key: 'm6', label: '6 months corrected age', months: 6 },
  { key: 'm9', label: '9 months corrected age', months: 9 },
  { key: 'm12', label: '12 months corrected age', months: 12 },
  { key: 'm18', label: '18 months corrected age', months: 18 },
];
export const DEFAULTER_GRACE_DAYS = 14;
export const HIGH_RISK_REASONS = ['preterm', 'low_birth_weight', 'nicu_stay', 'asphyxia', 'sepsis', 'jaundice_treated', 'ventilation', 'other'];

const DAY = 24 * 60 * 60 * 1000;
/** The baby's day of birth (India time) as a UTC midnight date. */
export function birthDay(birthAt) {
  const local = new Date(new Date(birthAt).getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
function addMonths(d, n) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** Needs an ROP examination? (null while the gestation and the weight are both unknown) PURE. */
export function needsRop({ gestationWeeks, birthWeightGrams }) {
  if (gestationWeeks == null && birthWeightGrams == null) return null;
  return (gestationWeeks != null && gestationWeeks < ROP_WEEKS) || (birthWeightGrams != null && birthWeightGrams < ROP_GRAMS);
}

/**
 * Due dates of the screens and (for a high-risk baby) the follow-up visits, from the birth, the gestation at birth
 * (weeks + days) and the birth weight. Corrected age: the months are counted from the day she would have reached
 * 40 weeks; a baby born at 40 weeks or later from her birth. PURE.
 */
export function schedule({ birthAt, gestationWeeks = null, gestationDays = 0, birthWeightGrams = null, highRisk = false }) {
  if (!birthAt) return { screens: [], visits: [] };
  const born = birthDay(birthAt);
  const rop = needsRop({ gestationWeeks, birthWeightGrams });
  const early = (gestationWeeks != null && gestationWeeks < ROP_EARLY_WEEKS) || (birthWeightGrams != null && birthWeightGrams < ROP_EARLY_GRAMS);
  const screens = Object.entries(SCREENS)
    .filter(([, s]) => s.who === 'all' || rop)
    .map(([key, s]) => {
      const [fromDay, byDay] = key === 'rop' && early ? [14, 21] : [s.fromDay, s.byDay];
      return { key, label: s.label, dueFrom: addDays(born, fromDay), dueBy: addDays(born, byDay) };
    });
  let visits = [];
  if (highRisk && gestationWeeks != null) {
    const gaDays = gestationWeeks * 7 + (gestationDays ?? 0);
    const term = addDays(born, Math.max(0, 280 - gaDays));
    visits = VISITS.map((v) => ({ key: v.key, label: v.label, dueOn: addMonths(term, v.months) }));
  }
  return { screens, visits, rop };
}
