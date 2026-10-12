// Billing (docs/BILLING_PLAN.md, approved by the owner on 3 Oct 2026): the choices the owner may want to change
// later, each in one place. The website keeps its own copy of the role lists (client/src/platform/modules.js).

// Who handles bills and payments (owner: reception does everything; the hospital admin too). The billing department
// ("billing" role, added 7 Oct 2026 at the owner's request) shares this work with reception.
export const BILLING_ROLES = ['receptionist', 'billing', 'admin'];
// Who keeps the price list (the admin), and who sees the monthly report and the export (the admin and billing).
export const PRICE_ROLES = ['admin'];
export const REPORT_ROLES = ['admin', 'billing'];
// The groups of the price list (and of the monthly income report).
export const GROUPS = ['consultation', 'procedure', 'scan', 'lab', 'inpatient', 'medicine', 'other'];
export const GROUP_LABELS = { consultation: 'Consultation', procedure: 'Procedure', scan: 'Scan', lab: 'Lab test', inpatient: 'Inpatient', medicine: 'Medicine', other: 'Other' };
// How patients pay.
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'insurance'];
export const MODE_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', insurance: 'Insurance / scheme' };
// Safety exception (owner approved): these lab tests are shown and printed under a neutral name – the HIV and AIDS
// Act 2017 protects whether someone was tested.
export const CONFIDENTIAL_TESTS = ['hiv'];
export const CONFIDENTIAL_NAME = 'Lab test (confidential)';
// Reasons are required for these, at least this long.
export const MIN_REASON = 3;
// The most one bill line, payment or price may be (₹10 lakh), in paise.
export const MAX_PAISE = 100_000_000;

// ---------- Billing extras (4 Oct 2026): insurance details, claim forms, the UPI payment link ----------

// Who keeps the billing settings (the hospital's UPI ID and payee name). Everyone who bills may read them.
export const SETTINGS_ROLES = ['admin'];
// Insurance or scheme details on a bill, each with its longest length. `insurer` and `claimNumber` are as long as a
// payment's "scheme" and "reference" (models/Bill.js), so the two always fit each other. The last three are typed by
// reception for the PM-JAY claim sheet. Perinexa connects to no insurer and to no government portal.
export const INSURANCE_FIELDS = { insurer: 80, policyNumber: 60, tpa: 80, preAuthNumber: 60, claimNumber: 80, pmjayId: 40, packageCode: 40, packageName: 150 };
export const INSURANCE_LABELS = {
  insurer: 'Insurance company or scheme',
  policyNumber: 'Policy or member number',
  tpa: 'TPA',
  preAuthNumber: 'Pre-authorisation number',
  claimNumber: 'Claim number',
  pmjayId: 'PM-JAY ID',
  packageCode: 'Package code',
  packageName: 'Package name',
};
// What belongs to the person (offered again on her next bill); the rest belongs to one claim.
export const INSURANCE_KEPT = ['insurer', 'policyNumber', 'tpa', 'pmjayId'];
// The printed claim forms.
export const CLAIM_LAYOUTS = ['claim', 'pmjay'];
// PC-PNDT on a bill: what reception reads under a box when text typed on the bill of a patient who is not a baby
// holds a word about a baby's sex (the words and patterns are those of utils/pcpndt.js). The message of the pregnancy
// record speaks of the partner; at the billing desk it says what to write for a relative, a card or a number instead.
export const BILL_PCPNDT_MESSAGE =
  "Please leave out words such as son, daughter, boy, girl, male or female, and the letters XX or XY standing on their own: nothing on this bill may hint at a baby's sex (PCPNDT Act). Write “staff family” or “paid by a relative” instead. In a number, join those letters to the rest (ABXY12, not AB-XY-12).";
// How many changes of the UPI ID and payee name are kept with the settings (Billing → Settings shows them).
export const UPI_HISTORY_KEPT = 50;
// The smallest UPI payment (₹1), in paise.
export const UPI_MIN_PAISE = 100;
