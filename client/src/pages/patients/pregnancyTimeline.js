// The pregnancy timeline and the pregnancy wheel (doctor ideas #7 and #8, 16 Oct 2026). PURE.
// DRAFT (clinical – for the owner to check): the trimesters end at 13 w 6 d and 27 w 6 d, term starts at 37 w 0 d,
// the EDD is 280 days after the LMP (Naegele), and the milestones below are the usual ones of Indian antenatal care.

const DAY_MS = 86_400_000;
const dayNo = (d) => Math.floor(new Date(d).getTime() / DAY_MS);
const fromDayNo = (n) => new Date(n * DAY_MS);

export const PREGNANCY_DAYS = 280;
export const RIBBON_DAYS = 42 * 7; // to 42 weeks, so a pregnancy past its EDD still shows

/** The EDD from the LMP (280 days), and the LMP-equivalent of an EDD. */
export const eddFromLmp = (lmp) => (lmp ? fromDayNo(dayNo(lmp) + PREGNANCY_DAYS) : null);
export const lmpFromEdd = (edd) => (edd ? fromDayNo(dayNo(edd) - PREGNANCY_DAYS) : null);

/** Weeks and days on a date, from the EDD ({ weeks, days, total }), or null before day 0. */
export function gestationOn(edd, d) {
  if (!edd || !d) return null;
  const total = dayNo(d) - (dayNo(edd) - PREGNANCY_DAYS);
  return total < 0 ? null : { weeks: Math.floor(total / 7), days: total % 7, total };
}

/** Where a date sits on the ribbon, 0–100 (%), clamped. */
export function ribbonPosition(edd, d) {
  const g = dayNo(d) - (dayNo(edd) - PREGNANCY_DAYS);
  return Math.max(0, Math.min(100, (g / RIBBON_DAYS) * 100));
}

/** DRAFT: the usual milestones, as the date each falls on for this EDD. */
export const MILESTONES = [
  { weeks: 12, label: 'NT scan window ends (13 w 6 d)', days: 13 * 7 + 6 },
  { weeks: 14, label: 'Second trimester', days: 14 * 7 },
  { weeks: 20, label: 'Anomaly scan (18–20 weeks)', days: 20 * 7 },
  { weeks: 24, label: 'Glucose test (24–28 weeks)', days: 24 * 7 },
  { weeks: 28, label: 'Third trimester', days: 28 * 7 },
  { weeks: 37, label: 'Term', days: 37 * 7 },
  { weeks: 40, label: 'EDD', days: 40 * 7 },
];
export const milestoneDates = (edd) => (edd ? MILESTONES.map((m) => ({ ...m, on: fromDayNo(dayNo(edd) - PREGNANCY_DAYS + m.days) })) : []);

/** The trimester bands on the ribbon (%). */
export const TRIMESTERS = [
  { label: '1st trimester', from: 0, to: (14 * 7 * 100) / RIBBON_DAYS },
  { label: '2nd trimester', from: (14 * 7 * 100) / RIBBON_DAYS, to: (28 * 7 * 100) / RIBBON_DAYS },
  { label: '3rd trimester', from: (28 * 7 * 100) / RIBBON_DAYS, to: (40 * 7 * 100) / RIBBON_DAYS },
  { label: 'After the EDD', from: (40 * 7 * 100) / RIBBON_DAYS, to: 100 },
];
