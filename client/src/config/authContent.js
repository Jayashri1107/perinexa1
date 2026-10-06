// The words on the sign-in pages' brand panel. Change them here.
import { Building2, ShieldCheck, Stethoscope } from 'lucide-react';

export const AUTH_HEADLINE = 'Calm, clear care for every patient.';
export const AUTH_INTRO =
  'One place for your hospitals: patients, billing, pharmacy and staff – each person sees only what their work needs.';

export const AUTH_POINTS = [
  { icon: ShieldCheck, title: 'Secure sign-in', text: 'Encrypted session that ends by itself after inactivity.' },
  { icon: Stethoscope, title: 'Built for clinical teams', text: 'Doctors, nurses, reception, lab and pharmacy – each with their own view.' },
  { icon: Building2, title: 'All your hospitals', text: 'Every branch in one platform, every action recorded.' },
];
