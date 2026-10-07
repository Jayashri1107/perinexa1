// Words for visits and prescriptions (the codes are the server's visits/rxCodes.js).
import { Ban, CircleCheck, OctagonX, PencilLine, ShieldAlert, Siren, Syringe, TriangleAlert } from 'lucide-react';

export const FORMS = { tab: 'Tab.', cap: 'Cap.', syrup: 'Syp.', suspension: 'Susp.', drops: 'Drops', inj: 'Inj.', sachet: 'Sachet', powder: 'Powder', pessary: 'Pessary', suppository: 'Supp.', cream: 'Cream', ointment: 'Oint.', gel: 'Gel', lotion: 'Lotion', spray: 'Spray', inhaler: 'Inhaler', other: '' };
export const FREQUENCIES = {
  '1-0-0': '1-0-0 (morning)',
  '0-1-0': '0-1-0 (afternoon)',
  '0-0-1': '0-0-1 (night)',
  '1-0-1': '1-0-1 (morning and night)',
  '1-1-1': '1-1-1 (three times)',
  '1-1-1-1': '1-1-1-1 (four times)',
  sos: 'When needed (SOS)',
  stat: 'Once now (STAT)',
  weekly: 'Once a week',
  alternate: 'Alternate days',
  custom: 'Other (write it)',
};
export const TIMINGS = { '': '—', after_food: 'After food', before_food: 'Before food', with_food: 'With food', empty_stomach: 'Empty stomach', bedtime: 'At bedtime' };
export const ROUTES = { '': '—', oral: 'Oral', vaginal: 'Vaginal', rectal: 'Rectal', im: 'IM', iv: 'IV', sc: 'SC', sublingual: 'Sublingual', local: 'Local' };
export const DURATION_UNITS = { '': '—', days: 'days', weeks: 'weeks', months: 'months', till_delivery: 'till delivery', continue: 'continue' };
export const URINE = ['', 'nil', 'trace', '1+', '2+', '3+', '4+'];
export const PRESENTATIONS = { '': '—', cephalic: 'Cephalic', breech: 'Breech', transverse: 'Transverse', oblique: 'Oblique', variable: 'Variable' };
export const MOVEMENTS = { '': '—', present: 'Present', reduced: 'Reduced', absent: 'Absent' };
export const OEDEMA = { '': '—', none: 'None', mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

export const options = (map) => Object.entries(map).filter(([k]) => k !== '').map(([value, label]) => ({ value, label }));

// A visit's state: signed, open, or entered in error.
export function visitLook(v) {
  if (v.status === 'cancelled') return { tone: 'inactive', icon: Ban, word: 'Entered in error' };
  if (v.signed) return { tone: 'active', icon: CircleCheck, word: 'Signed' };
  return { tone: 'pending', icon: PencilLine, word: 'Open – not signed' };
}

export const FLAG_LOOKS = {
  urgent: { tone: 'danger', icon: Siren, word: 'Urgent' },
  watch: { tone: 'pending', icon: TriangleAlert, word: 'Watch' },
};
export const WARNING_LOOKS = {
  allergy: { tone: 'danger', icon: ShieldAlert, word: 'Allergy' },
  avoid: { tone: 'danger', icon: OctagonX, word: 'Avoid' },
  caution: { tone: 'pending', icon: TriangleAlert, word: 'Caution' },
  dose: { tone: 'pending', icon: Syringe, word: 'Dose' },
};
export const needsReason = (w) => w.level === 'avoid' || w.level === 'allergy';

// "Tab. Folic acid 5 mg – 1 – 1-0-0 – after food – 30 days"
export function rxLine(i) {
  const how = i.frequency === 'custom' ? i.frequencyText : i.frequency;
  const duration = i.durationUnit === 'till_delivery' || i.durationUnit === 'continue' ? DURATION_UNITS[i.durationUnit] : i.durationValue ? `${i.durationValue} ${DURATION_UNITS[i.durationUnit] || 'days'}` : '';
  return [[FORMS[i.form], i.drug, i.strength].filter(Boolean).join(' '), i.dose, how, TIMINGS[i.timing] !== '—' && TIMINGS[i.timing], i.route && ROUTES[i.route], duration].filter(Boolean).join(' – ');
}

// A new visit request id: the same click sent twice makes one visit.
export const requestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
