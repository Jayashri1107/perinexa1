// Every event the audit log can hold, with the plain words shown on screen.
// A new event is added here once; the model, the filter and the screen all read this list.
export const AUDIT_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'Logged in',
  LOGIN_FAILED: 'Login failed',
  LOGIN_RATE_LIMITED: 'Too many login attempts',
  LOGOUT: 'Logged out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET: 'Password reset',
  USER_CREATED: 'Account created',
  USER_UPDATED: 'Account updated',
  USER_ACTIVATED: 'Account activated',
  USER_DEACTIVATED: 'Account deactivated',
  HOSPITAL_CREATED: 'Hospital created',
  HOSPITAL_UPDATED: 'Hospital updated',
  HOSPITAL_ACTIVATED: 'Hospital activated',
  HOSPITAL_DEACTIVATED: 'Hospital deactivated',
  MEMBER_ADDED: 'Staff added to hospital',
  MEMBER_ROLES_CHANGED: 'Staff roles changed',
  MEMBER_ACTIVATED: 'Staff access activated',
  MEMBER_DEACTIVATED: 'Staff access deactivated',
  MASTER_CREATED: 'Master data added',
  MASTER_UPDATED: 'Master data updated',
  MASTER_ACTIVATED: 'Master data activated',
  MASTER_DEACTIVATED: 'Master data deactivated',
  HOSPITAL_SWITCHED: 'Switched hospital',
  SETTINGS_UPDATED: 'Hospital settings changed',
  OPD_TIMINGS_UPDATED: 'OPD timings changed',
  PROFILE_UPDATED: 'Professional details changed',
  // Patients (ids and field names only – never medical details)
  PATIENT_REGISTERED: 'Patient registered',
  PATIENT_REGISTERED_ANYWAY: 'Patient registered despite a possible duplicate',
  PATIENT_VIEWED: 'Patient record opened',
  PATIENT_UPDATED: 'Patient record changed',
  PATIENT_CLOSED: 'Patient record closed',
  PATIENT_REOPENED: 'Patient record reopened',
  PATIENT_EMERGENCY_ACCESS: 'Emergency access to a patient record',
  // Billing
  PRICE_ITEM_CREATED: 'Price list item added',
  PRICE_ITEM_UPDATED: 'Price list item changed',
  BILL_CREATED: 'Bill created',
  BILL_UPDATED: 'Bill changed',
  BILL_DISCOUNTED: 'Discount given',
  BILL_CANCELLED: 'Bill cancelled',
  PAYMENT_RECEIVED: 'Payment received',
  REFUND_GIVEN: 'Refund given',
  BILLING_SETTINGS_UPDATED: 'Billing settings changed',
  BILLS_EXPORTED: 'Bills exported',
  // Pharmacy
  MEDICINE_CREATED: 'Medicine added',
  MEDICINE_UPDATED: 'Medicine changed',
  SUPPLIER_CREATED: 'Supplier added',
  SUPPLIER_UPDATED: 'Supplier changed',
  PURCHASE_RECORDED: 'Purchase recorded',
  SALE_MADE: 'Medicines sold',
  SALE_RETURNED: 'Medicines returned',
  STOCK_ADJUSTED: 'Stock written off or corrected',
});

export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTIONS);

// Simple groups for filtering the audit log, by the start of the event name. An event not matched falls in "other".
const GROUPS = [
  { key: 'logins', label: 'Logins and passwords', prefixes: ['LOGIN', 'LOGOUT', 'PASSWORD', 'HOSPITAL_SWITCHED'] },
  { key: 'accounts', label: 'Accounts and staff', prefixes: ['USER', 'MEMBER', 'PROFILE'] },
  { key: 'hospitals', label: 'Hospitals and settings', prefixes: ['HOSPITAL_', 'SETTINGS', 'OPD', 'MASTER'] },
  { key: 'patients', label: 'Patient records', prefixes: ['PATIENT'] },
  { key: 'billing', label: 'Billing', prefixes: ['BILL', 'PAYMENT', 'REFUND', 'PRICE'] },
  { key: 'pharmacy', label: 'Pharmacy', prefixes: ['MEDICINE', 'SUPPLIER', 'PURCHASE', 'SALE', 'STOCK'] },
];
const groupOf = (action) => GROUPS.find((g) => g.prefixes.some((p) => action.startsWith(p)))?.key ?? 'other';

export const AUDIT_CATEGORIES = [...GROUPS, { key: 'other', label: 'Other' }].map(({ key, label }) => ({
  key,
  label,
  actions: AUDIT_ACTION_KEYS.filter((a) => groupOf(a) === key),
})).filter((c) => c.actions.length);
