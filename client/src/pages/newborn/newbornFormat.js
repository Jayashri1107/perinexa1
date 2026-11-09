// Newborn screening and follow-up (Clinical Requirements Group A, item 4). Same roles as
// server/src/routes/newbornFollowUp.js. DRAFT schedule (NNF / RBSK) until the Lead Neonatologist checks it.
import { useAuth } from '../../auth/AuthContext.jsx';
import { hasRole } from '../../components/ui.jsx';
import { CalendarClock, CircleCheck, CircleMinus, Clock, TriangleAlert } from 'lucide-react';

export const NEWBORN_FOLLOW_UP_ROLES = ['doctor', 'rmo', 'nurse', 'followup_coordinator'];
export const RESULT_LABELS = { pass: 'Pass', refer: 'Refer', normal: 'Normal', abnormal: 'Abnormal', no_rop: 'No ROP', rop_found: 'ROP found' };
// Which results fit which screen
export const RESULTS_FOR = { cchd: ['pass', 'refer'], hearing: ['pass', 'refer'], metabolic: ['normal', 'abnormal'], rop: ['no_rop', 'rop_found'] };
export const HIGH_RISK_LABELS = {
  preterm: 'Born preterm',
  low_birth_weight: 'Low birth weight',
  nicu_stay: 'NICU or SNCU stay',
  asphyxia: 'Birth asphyxia',
  sepsis: 'Sepsis',
  jaundice_treated: 'Jaundice needing treatment',
  ventilation: 'Needed ventilation',
  other: 'Other',
};

/** A screen's or visit's state as colour, icon and word. */
export function itemLook(x) {
  switch (x.state) {
    case 'done':
      return { tone: 'stable', icon: CircleCheck, word: x.record?.result ? `Done – ${RESULT_LABELS[x.record.result]}` : 'Done' };
    case 'attended':
      return { tone: 'stable', icon: CircleCheck, word: 'Attended' };
    case 'not_needed':
      return { tone: 'inactive', icon: CircleMinus, word: 'Not needed' };
    case 'overdue':
      return { tone: 'high', icon: TriangleAlert, word: 'Overdue' };
    case 'defaulter':
      return { tone: 'high', icon: TriangleAlert, word: 'Missed' };
    case 'due':
      return { tone: 'due', icon: CalendarClock, word: 'Due now' };
    default:
      return { tone: 'neutral', icon: Clock, word: 'Later' };
  }
}

/** The module's tabs: Newborn follow-up, and the NICU / SNCU register for doctors, RMOs and nurses (never the coordinator). */
export function useNewbornTabs() {
  const membership = useAuth()?.activeMembership;
  const tabs = [{ label: 'Newborn follow-up', to: '/newborn-follow-up', end: true }];
  if (membership && hasRole(membership, 'doctor', 'rmo', 'nurse')) tabs.push({ label: 'NICU register', to: '/nicu-register', end: true }, { label: 'NICU board', to: '/nicu-board', end: true });
  if (membership && hasRole(membership, 'doctor', 'rmo')) tabs.push({ label: 'NICU – new baby', to: '/nicu-admit', end: true });
  return tabs;
}
