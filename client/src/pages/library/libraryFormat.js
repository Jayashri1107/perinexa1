// Words and looks for the clinic library.
import { Ban, PencilLine, ShieldCheck } from 'lucide-react';
import { labelOf } from '../../utils/format.js';

export const DRAFT_LOOK = { tone: 'pending', icon: PencilLine, word: 'Draft – not approved' };
export const APPROVED_LOOK = { tone: 'active', icon: ShieldCheck, word: 'Approved' };
export const INACTIVE_LOOK = { tone: 'inactive', icon: Ban, word: 'Not in use' };
export const entryLook = (e) => (e.status === 'approved' ? APPROVED_LOOK : DRAFT_LOOK);

export const RULE_KINDS = ['red_flag_rules', 'medicine_safety', 'risk_rules'];

// "Antenatal, Postnatal" or "Every type of care"
export const careTypesText = (careTypes, list) => (careTypes?.length ? careTypes.map((c) => labelOf(list, c)).join(', ') : 'Every type of care');

export const LEVEL_WORDS = { urgent: 'Urgent', watch: 'Watch', high: 'High', moderate: 'Moderate', avoid: 'Avoid', caution: 'Caution' };
export const ITEM_KIND_WORDS = { visit: 'Visit', investigation: 'Test', scan: 'Scan', vaccination: 'Vaccine', medication: 'Medicine', advice: 'Advice' };
export const MED_KIND_WORDS = { medicine: 'In pregnancy', combination: 'Combination', breastfeeding: 'Breastfeeding', newborn: 'Newborn', dose: 'Maximum dose' };
export const LANGUAGE_WORDS = { en: 'English', mr: 'Marathi', hi: 'Hindi' };

// "Weeks 24–28", "At booking", "4 weeks after Td – dose 1"
export function whenText(item, byKey = new Map()) {
  if (item.atBooking) return 'At booking';
  if (item.after) return `${item.after.weeks} weeks after ${byKey.get(item.after.key)?.name ?? item.after.key}`;
  if (item.fromWeek == null && item.toWeek == null) return '—';
  if (item.fromWeek === item.toWeek) return `Week ${item.fromWeek}`;
  return `Weeks ${item.fromWeek ?? 0}–${item.toWeek ?? '…'}`;
}

// A red-flag rule's window: "from 20 weeks", "days 0–7"
export function windowText(r) {
  const parts = [];
  if (r.fromWeek != null || r.toWeek != null) parts.push(r.toWeek != null ? `weeks ${r.fromWeek ?? 0}–${r.toWeek}` : `from ${r.fromWeek} weeks`);
  if (r.fromDay != null || r.toDay != null) parts.push(r.toDay != null ? `days ${r.fromDay ?? 0}–${r.toDay}` : `from day ${r.fromDay}`);
  return parts.join(', ');
}

// A unique key for a new row: own_ + random letters.
export const newKey = () => `own_${Math.random().toString(36).slice(2, 10)}`;

// The empty content of a new entry of each kind the hospital may add.
export const EMPTY_CONTENT = {
  care_plan: () => ({ items: [] }),
  consent_form: () => ({ title: { en: '', mr: '', hi: '' }, clauses: [{ en: '', mr: '', hi: '' }], suggestWhen: 'none' }),
  information_form: () => ({ title: { en: '', mr: '', hi: '' }, clauses: [{ en: '', mr: '', hi: '' }], suggestWhen: 'none' }),
  test_package: () => ({ who: 'adult', fromDay: null, toDay: null, forWhom: '', tests: [] }),
  prescription_set: () => ({ items: [], notes: '', investigations: '', advice: '' }),
};
