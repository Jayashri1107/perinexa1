import { Baby, Banknote, CircleDot, HandHeart, HeartPulse, Package, ShieldCheck } from 'lucide-react';
import { Field, StatusPill } from './ui.jsx';

// The colour labels of a stay (owner, 9 Nov 2026 – docs/ADMISSION_COLOURS_PLAN.md), each colour + icon + word (BRAND.md):
//  - billing type: Insurance, Cash, Package – shown to doctors and RMOs (the server sends it only to them);
//  - admission type: ANC, PNC, Delivered, Other – asked at admission, changed by hand during the stay.
// Red and amber stay for clinical risk only, so a billing label is never read as a warning.

export const BILLING_OPTIONS = [
  ['insurance', 'Insurance'],
  ['cash', 'Cash'],
  ['package', 'Package'],
];
export const STAY_TYPE_OPTIONS = [
  ['anc', 'ANC'],
  ['pnc', 'PNC'],
  ['delivered', 'Delivered'],
  ['other', 'Other'],
];
// What each admission type means, for the hint in the forms
export const STAY_TYPE_HINT = 'ANC: pregnant, before the delivery. PNC: after a delivery elsewhere or a later stay. Delivered: delivered in this stay. Other: anything else, and babies.';

const BILLING = {
  insurance: { tone: 'due', icon: ShieldCheck, word: 'Insurance' },
  cash: { tone: 'stable', icon: Banknote, word: 'Cash' },
  package: { tone: 'admitted', icon: Package, word: 'Package' },
};
const STAY = {
  anc: { tone: 'teal', icon: HeartPulse, word: 'ANC' },
  pnc: { tone: 'due', icon: HandHeart, word: 'PNC' },
  delivered: { tone: 'stable', icon: Baby, word: 'Delivered' },
  other: { tone: 'inactive', icon: CircleDot, word: 'Other' },
};
// The order on the dashboard: within a department, ANC first, then Delivered, PNC and Other
export const STAY_ORDER = ['anc', 'delivered', 'pnc', 'other'];

export function BillingLabel({ type }) {
  const b = BILLING[type];
  if (!b) return null;
  return (
    <StatusPill tone={b.tone} icon={b.icon} title={`Billing: ${b.word}`} className={`adm-label bill-label bill-${type}`}>
      {b.word}
    </StatusPill>
  );
}

export function StayTypeLabel({ type }) {
  const s = STAY[type];
  if (!s) return null;
  return (
    <StatusPill tone={s.tone} icon={s.icon} title={`Admission type: ${s.word}`} className="adm-label">
      {s.word}
    </StatusPill>
  );
}

/**
 * The stays grouped under their department (alphabetical; "No department" last), each group sorted by admission type
 * and then by when admitted. Returns [{ department, stays }].
 */
export function groupByDepartment(stays) {
  const groups = new Map();
  for (const s of stays) {
    const d = s.department || '';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(s);
  }
  const rank = (t) => {
    const i = STAY_ORDER.indexOf(t);
    return i === -1 ? STAY_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([department, list]) => ({
      department,
      stays: [...list].sort((a, b) => rank(a.stayType) - rank(b.stayType) || new Date(a.admittedAt) - new Date(b.admittedAt)),
    }));
}

/** The admission type to start with: a baby is Other; anyone else is chosen at the desk (empty). */
export const startStayType = (careType) => (careType === 'newborn' ? 'other' : '');

/**
 * The two questions asked at every admission (owner, 9 Nov 2026): billing type and admission type. value:
 * { billingType, stayType }; onChange(next). stayType: false leaves the admission type out (a NICU baby).
 */
export function AdmissionLabelFields({ value, onChange, fields = {}, idPrefix = 'adm', stayType = true }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <Field label="Billing type" id={`${idPrefix}-billing`} error={fields.billingType} hint="Ask at every admission: insurance (or a scheme or company), cash, or a package.">
        <select id={`${idPrefix}-billing`} value={value.billingType} onChange={set('billingType')} required>
          <option value="">Choose…</option>
          {BILLING_OPTIONS.map(([k, w]) => (
            <option key={k} value={k}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      {stayType && (
        <Field label="Admission type" id={`${idPrefix}-staytype`} error={fields.stayType} hint={STAY_TYPE_HINT}>
          <select id={`${idPrefix}-staytype`} value={value.stayType} onChange={set('stayType')} required>
            <option value="">Choose…</option>
            {STAY_TYPE_OPTIONS.map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
