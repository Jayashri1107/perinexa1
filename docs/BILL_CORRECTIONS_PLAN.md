# Correcting a payment, and the bill as a hospital bill – plan and decisions (owner, 19 Oct 2026)

Branch `bill-correct`. All test data is fake.

## Correcting a payment

When a payment fails (a UPI or card problem) and the patient then pays another way, the desk corrects the payment on
its receipt: the mode, the reference, the amount and the time (the same day).

The safe way for money records:
- **Never overwritten silently.** The payment shows what is true now. Each correction keeps what it was before (mode,
  amount, reference, insurer, time), who corrected it, when and why. Corrections are never removed.
- **A reason always** (at least 3 letters; no words that hint at a baby's sex – PCPNDT).
- **The receipt keeps its number** and prints as "Receipt (corrected)" with the correction under it. Print it again for
  the patient.
- **Audit log**: "Payment corrected" – the bill, the receipt, the mode and amount before and after, whether the time
  changed, the reason. No patient name.
- **The money follows**: the bill's paid and balance, the daily summary and the reports count the corrected payment.
  The cash handover of the person who took it is counted again while it waits for a confirmation. Once confirmed it is
  not changed; the correction is shown on it ("Corrected after it was confirmed").
- **Limits**: a payment cannot become more than the bill without it (a deposit during a stay can); a refund not more
  than is due back; the time not later than now; something must change.

**Who may correct (owner's decision, 19 Oct 2026):** reception and the billing department on the day of the payment,
until that day's cash handover (of the person who took it) is confirmed. After that, or on a later day, only the
hospital admin. A reason always.

## The bill screen

The owner found the bill screen hard to read. It is now laid out as a hospital bill:
1. **Bill details** at the top: patient (link to her record), patient no., OPD or IPD, doctor, date, status; for a stay,
   the ward and bed, admitted and discharged.
2. **Items** as a numbered table: No., item (who added it), category, doctor, qty, rate, amount, Take off. An item with
   no price shows "Price not set" (colour + icon + word); the hospital admin sets the price right there ("Set price" –
   it changes the price list, so every bill from now on uses it).
3. **Amount** under the items, on the right: subtotal, discount (with its reason), total, paid, balance to pay.
4. **Payments** as a table: receipt (with "Corrected"), date and time, type, mode, reference, amount, taken by; Receipt,
   Correct and History.
5. Insurance or scheme, and what was taken off.

On a tablet held upright and on a phone each item and payment is a block (no sideways scrolling).

Also on this branch: only the Lab shows its pages under it in the sidebar (owner, 19 Oct 2026: "I am only asking for
lab"); Patients, Appointments, Calendar, Billing and the rest are one item each again. And fixed: a duplicate React key between the notification bell and the Ctrl K box (from the reception update).

Code: `server/src/routes/billing.js` (`POST /api/billing/bills/:id/payments/:paymentId/correct`,
`GET /api/billing/bills/:id/corrections`), `models/Bill.js` (payment `corrections`), `models/CashHandover.js`
(`correctedAfter`), `routes/cashHandover.js`; website `pages/billing/BillPage.jsx` (CorrectPaymentDialog,
SetPriceDialog, PaymentRow), `pages/billing/CashHandoverPage.jsx`, `styles/pages-billing.css`.
Tests: `server/tests/bill-correct.test.js`, `client/src/components/auditFormat.test.js`.
