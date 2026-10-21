// Pharmacy and medicine stock (docs/PHARMACY_PLAN.md, approved by the owner on 3 Oct 2026): the choices the owner
// may want to change later, each in one place. The website keeps its own copy of the role lists
// (client/src/pages/pharmacy/pharmacyFormat.js).

// Who works in the pharmacy, and who sees its reports (the hospital admin can also keep the medicine list).
export const PHARMACY_ROLES = ['pharmacist', 'admin'];
export const PHARMACY_DESK_ROLES = ['pharmacist']; // sells, issues, receives, returns, writes off, counts
export const PHARMACY_REPORT_ROLES = ['pharmacist', 'admin'];
export const PHARMACY_EXPORT_ROLES = ['admin'];

export const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'drops', 'injection', 'infusion', 'cream', 'ointment', 'gel', 'pessary', 'suppository', 'inhaler', 'sachet', 'other'];
// GST rates since 22 September 2025 (56th GST Council; Notifications 9/2025 and 10/2025 – Central Tax (Rate)): the
// 12 % rate is gone. Drugs and medicines are 5 %, named life-saving drugs nil, and 18 % is left for non-medicine items
// (sanitiser, cosmetics, mouthwash and the like). A new medicine starts at 5 %.
export const GST_RATES = [0, 5, 18];
export const DEFAULT_GST_RATE = 5;
// Rates no longer in use. Medicines saved before the change may still hold one (npm run fix:gst-rates moves them to
// 5 %); invoices, purchases and returns made then keep theirs, as printed.
export const OLD_GST_RATES = [12];
// Schedules: '' none (over the counter), G, H, H1, X, and narcotic (NDPS). X and narcotic: own register, a
// prescription with the doctor's registration number, registered patients only, a witness for stock counts.
export const SCHEDULES = ['', 'G', 'H', 'H1', 'X', 'narcotic'];
export const SCHEDULE_LABELS = { '': 'None', G: 'Schedule G', H: 'Schedule H', H1: 'Schedule H1', X: 'Schedule X', narcotic: 'Narcotic (NDPS)' };
export const NEEDS_PRESCRIPTION = ['H', 'H1', 'X', 'narcotic'];
export const CONTROLLED = ['X', 'narcotic']; // the strictest: own register, doctor's registration number, a witness

// Batches expiring within this many days show a warning at the counter; the expiry report looks this far ahead.
export const EXPIRY_WARNING_DAYS = 30;
export const EXPIRY_REPORT_DAYS = 90;
// Payment modes of a walk-in customer (not a registered patient) paying at the counter.
export const COUNTER_MODES = ['cash', 'upi', 'card'];
// Reasons are required for these, at least this long.
export const MIN_REASON = 3;
// Upper limits.
export const MAX_QTY = 100_000;
export const MAX_PAISE = 100_000_000;

// ---------- Pharmacy extras (4 Oct 2026): purchase orders, returns to a supplier, barcodes, the e-invoice file ----------

// A purchase order: draft → sent → part received / received, or cancelled. A part-received order of which nothing
// more will come is closed (it stays "part received").
export const ORDER_STATUSES = ['draft', 'sent', 'part_received', 'received', 'cancelled'];
export const ORDER_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', part_received: 'Part received', received: 'Received', cancelled: 'Cancelled' };
// "Suggest from low stock" fills in enough to bring a medicine up to this many times its reorder level.
export const ORDER_SUGGEST_TIMES = 2;
export const MAX_ORDER_LINES = 200;

// Why stock goes back to a supplier (expired stock may go back: unlike a sale, there is no expiry check).
export const SUPPLIER_RETURN_REASONS = ['expired', 'damaged', 'recalled', 'excess', 'wrong_item'];
export const SUPPLIER_RETURN_REASON_LABELS = { expired: 'Expired', damaged: 'Damaged', recalled: 'Recalled', excess: 'Excess stock', wrong_item: 'Wrong item' };

// Barcodes: the number under the bars on a pack (EAN, UPC, GTIN – digits; some packs use letters too). Kept without
// spaces, letters in capitals; found by exact match only; one barcode belongs to one medicine in a hospital.
export const MAX_BARCODES = 10;
export const BARCODE_PATTERN = /^[0-9A-Z][0-9A-Z-]{3,31}$/;
/** A barcode as it is kept: no spaces, capitals. '' when nothing was typed. */
export const cleanBarcode = (text) => String(text ?? '').replace(/\s+/g, '').toUpperCase();

// Who may download the e-invoice file of a sale to a business (it goes to the accountant).
export const PHARMACY_EINVOICE_ROLES = ['admin'];
