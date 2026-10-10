// Helpers for writing a prescription (owner, 10 Oct 2026): the amount per dose offered for each form, the route a form
// usually takes, and the total a course needs (shown to the doctor, not printed – the pharmacy works it out again).

// Quick choices for the amount per dose, by form; anything else can be typed.
export const AMOUNTS = {
  tab: ['½ tab', '1 tab', '2 tab'],
  cap: ['1 cap', '2 cap'],
  syrup: ['5 ml', '10 ml', '15 ml'],
  suspension: ['2.5 ml', '5 ml', '10 ml'],
  drops: ['1 drop', '2 drops', '5 drops'],
  inj: ['1 amp', '1 vial', '1 ml', '2 ml'],
  sachet: ['1 sachet'],
  powder: ['1 scoop', '2 scoops'],
  pessary: ['1 pessary'],
  suppository: ['1 supp.'],
  cream: ['Thin layer'],
  ointment: ['Thin layer'],
  gel: ['Thin layer'],
  lotion: ['Thin layer'],
  spray: ['1 puff', '2 puffs'],
  inhaler: ['1 puff', '2 puffs'],
};
export const defaultAmount = (form) => AMOUNTS[form]?.[AMOUNTS[form].length > 1 && form === 'tab' ? 1 : 0] ?? '';

// The route a form usually takes (set when the form is chosen and no route is set yet); injections need a choice.
export const DEFAULT_ROUTE = { pessary: 'vaginal', suppository: 'rectal', cream: 'local', ointment: 'local', gel: 'local', lotion: 'local', spray: 'local' };
// Forms for which the route is asked (tablets, capsules and syrups are taken by mouth).
export const ROUTE_FORMS = ['inj', 'pessary', 'suppository', 'cream', 'ointment', 'gel', 'lotion', 'drops', 'spray', 'inhaler', 'other'];
export const showsRoute = (it) => ROUTE_FORMS.includes(it.form) || Boolean(it.route);

// How many times a day each dose code means (null: not counted – when needed, once only, own words).
const PER_DAY = { '1-0-0': 1, '0-1-0': 1, '0-0-1': 1, '1-1-0': 2, '1-0-1': 2, '0-1-1': 2, '1-1-1': 3, '1-1-1-1': 4 };
const DAYS_IN = { days: 1, weeks: 7, months: 30 };
const COUNTED = { tab: 'tablets', cap: 'capsules', sachet: 'sachets', pessary: 'pessaries', suppository: 'suppositories', inj: 'doses' };

// The number at the start of the amount: "½ tab" → 0.5, "2 tab" → 2, "10 ml" → 10.
function amountNumber(dose) {
  const text = String(dose ?? '').trim();
  if (text.startsWith('½')) return 0.5;
  const n = parseFloat(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "10 tablets", "150 ml" – the total the course needs, or '' when it cannot be told. */
export function totalText(it) {
  const amount = amountNumber(it.dose);
  const days = it.durationValue && DAYS_IN[it.durationUnit] ? Number(it.durationValue) * DAYS_IN[it.durationUnit] : null;
  if (amount == null || !days) return '';
  let times = null;
  if (PER_DAY[it.frequency]) times = PER_DAY[it.frequency] * days;
  else if (it.frequency === 'weekly') times = Math.ceil(days / 7);
  else if (it.frequency === 'alternate') times = Math.ceil(days / 2);
  if (!times) return '';
  const total = amount * times;
  if (/ml\b/i.test(it.dose)) return `${Math.round(total * 10) / 10} ml`;
  if (COUNTED[it.form]) return `${Math.ceil(total)} ${COUNTED[it.form]}`;
  return '';
}
