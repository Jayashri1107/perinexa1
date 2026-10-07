// The codes used by visits and prescriptions (the same lists as Perinexa's visits/rxCodes.js). The website shows them
// with words (client/src/pages/visits/visitFormat.js).

/** What a medicine is: printed before its name ("TAB.", "INJ." …). */
export const RX_FORMS = ['tab', 'cap', 'syrup', 'suspension', 'drops', 'inj', 'sachet', 'powder', 'pessary', 'suppository', 'cream', 'ointment', 'gel', 'lotion', 'spray', 'inhaler', 'other'];
/** How often, in the Indian 1-0-1 style (morning – afternoon – night), or in words; "custom": the doctor's own words. */
export const RX_FREQUENCIES = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', 'sos', 'stat', 'weekly', 'alternate', 'custom'];
export const RX_TIMINGS = ['', 'after_food', 'before_food', 'with_food', 'empty_stomach', 'bedtime'];
export const RX_ROUTES = ['', 'oral', 'vaginal', 'rectal', 'im', 'iv', 'sc', 'sublingual', 'local'];
export const RX_DURATION_UNITS = ['', 'days', 'weeks', 'months', 'till_delivery', 'continue'];

// Measurements at a visit. There is deliberately no fetal-sex field anywhere (PC-PNDT Act).
export const URINE_GRADES = ['', 'nil', 'trace', '1+', '2+', '3+', '4+'];
export const PRESENTATIONS = ['', 'cephalic', 'breech', 'transverse', 'oblique', 'variable'];
export const FETAL_MOVEMENTS = ['', 'present', 'reduced', 'absent'];
export const OEDEMA_GRADES = ['', 'none', 'mild', 'moderate', 'severe'];

/** Doses a day of a frequency (for the dose check), or null when it cannot be told. */
export function timesPerDay(frequency) {
  if (/^\d(-\d){2,3}$/.test(frequency)) return frequency.split('-').reduce((n, x) => n + Number(x), 0);
  return { stat: 1, sos: null, weekly: null, alternate: null, custom: null }[frequency] ?? null;
}
