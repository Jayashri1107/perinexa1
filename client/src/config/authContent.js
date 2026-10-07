// The words on the sign-in pages' brand panel. Change them here.
import { BedDouble, CalendarClock, FlaskConical, ShieldCheck } from 'lucide-react';

export const AUTH_HEADLINE = 'Every patient, every ward, one calm workspace.';
export const AUTH_INTRO = 'OPD, wards, lab, pharmacy and billing for all your branches – each person sees only what their work needs.';

export const AUTH_POINTS = [
  { icon: CalendarClock, title: 'OPD and appointments', text: 'Doctors’ days, walk-ins, visits and prescriptions.' },
  { icon: BedDouble, title: 'Wards and inpatients', text: 'Admissions, nursing chart and discharge cards.' },
  { icon: FlaskConical, title: 'Lab and pharmacy', text: 'Orders, results, stock and issue to ward.' },
  { icon: ShieldCheck, title: 'Private by design', text: 'Need-to-know access, and every action recorded.' },
];
