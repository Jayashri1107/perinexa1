# Billing – plan (approved and built)

Planned with the owner on 3 Oct 2026, approved the same day and built. How to test it: `docs/PROGRESS.md` → "How to
test billing". The HIV safety exception was kept (also for the test added by hand).

## The owner's answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | What is charged | Consultations, procedures and scans, lab tests, inpatient stays |
| 2 | Prices | **One hospital price list** (kept by the hospital admin) |
| 3 | Payment | **Cash, UPI / card, insurance or a scheme, advance deposits** for inpatients |
| 4 | Who bills | **Reception does everything**: bills, payments, discounts, cancelling – with a reason recorded |
| 5 | Charges when work is done | **Fully automatic** |
| 6 | What reception sees | **Full item names** (e.g. "Beta hCG test") on screen and on the printed bill |
| 7 | Tax | **No GST** (healthcare services are exempt) |
| 8 | Reports | Daily cash summary, unpaid bills, monthly income, export for the accountant |

## How it will work

### 1. The price list (Hospital admin → Price list)
- Items with a name, a group (Consultation, Procedure, Scan, Lab test, Inpatient, Medicine, Other) and a price in ₹.
  Items can be added, changed and stopped (never deleted – old bills keep their prices).
- **Ready-made starting list with ₹0 prices**, for the admin to fill in. It has consultation (new, follow-up), every
  lab test the app can order, bed charge per day (general ward, private room), and common procedures and scans
  (ultrasound, NST, dressing, IUCD insertion, normal delivery, caesarean section).
- A price change applies to new charges only; bills already made keep their prices.

### 2. Charges added automatically
| When this happens | This goes on the bill |
| --- | --- |
| A visit is started | **Consultation – new** (her first visit) or **Consultation – follow-up** |
| A lab order is made | Each test (or a package's tests) at its price |
| A patient is admitted | An **inpatient bill** for the stay; **bed charge per day** by ward, worked out every day until discharge |
| A visit, lab order or test is cancelled | Its charge is taken off (if already paid: the balance shows money to refund) |

- Outpatient charges go on **one bill per patient per day**; a stay has **one bill for the whole stay**.
- **Procedures, scans and medicines are added by reception from the price list.** The app does not yet record when
  a scan or procedure is done, so these cannot be added automatically. The doctor could tick them on the visit
  later, if wanted.
- A charge whose price is still ₹0 is marked **"Price not set"**, so it is noticed.
- *Default chosen:* bed days count the day of admission but not the day of discharge, with at least 1 day.

### 3. Bills and payments (new **Billing** item in the left menu, and a **Bills** tab on the patient record)
- A bill shows its number (B-000001 …), the patient, the items, the discount, the total, what was paid and the
  **balance**.
- **Take payment**: cash, UPI or card (with the UPI or card reference), or insurance or a scheme (scheme name and
  claim number – the claim itself is made outside Perinexa). A bill can be paid in parts. Each payment gets a
  **receipt number** (R-000001 …).
- **Deposits**: payments taken at or during an inpatient stay are deposits. They are set against the final bill
  at discharge.
- **Refund**: when more was paid than is due (e.g. a cancelled test), reception records the refund and its mode.
- **Discount**: an amount or a percentage, with a reason. **Cancel a bill**: with a reason. Both by reception (owner's
  choice) and both in the audit log. A cancelled bill is kept and shown crossed out; nothing is ever deleted.
- **Printing**: the bill and each receipt on A5 with the letterhead – bill or receipt number, date, patient name and
  number, items, amounts, total, paid, balance, payment mode. No tax lines. "This is a computer-generated bill."
- All amounts in whole rupees and paise, stored exactly (no rounding errors).

### 4. Who does what
| Role | Billing |
| --- | --- |
| Reception | Everything: bills, payments, deposits, refunds, discounts, cancelling, printing, the daily summary |
| Hospital admin | The price list, all reports, the Excel export; can also do everything reception does |
| Doctors, RMOs, nurses, lab | No billing (they keep working as now; their work adds the charges by itself) |
| Super admin | Nothing (no money figures of a hospital) |

Every bill, payment, refund, discount and cancellation is in the audit log (ids and amounts only).

### 5. Reports (Billing → Reports)
- **Daily cash summary**: money in by cash, UPI, card and insurance; refunds; per person who collected; discounts
  and cancelled bills, for any day. Printable for handing over the cash at day's end.
- **Unpaid bills**: who owes how much, since when, with the phone number to call.
- **Monthly income**: by month, by group (consultations, procedures, scans, lab, inpatient, medicines) and by
  doctor (consultations by the visit's doctor; lab by the doctor who ordered; a stay by the patient's doctor).
- **Export**: bills, items and payments for a chosen period as a file that opens in Excel (CSV).

### 6. Privacy and safety
- Reception sees full item names, as the owner chose.
- ⚠️ **One safety exception (recommended – tell me if you don't want it): the HIV test is shown and printed as
  "Lab test (confidential)"**, with its real price. The HIV and AIDS Act 2017 protects whether someone was tested,
  and Perinexa already keeps HIV out of AI and out of the information forms signed by relatives.
- The fetal-sex protection stays: no bill item can name the baby's sex.
- Bills hold no diagnosis, no notes and no results: only item names and amounts.

## Build order (each step tested and committed)
1. Server: the price list with its starting items.
2. Server: bills, automatic charges (visits, lab orders, stays and bed days, cancellations), manual items.
3. Server: payments, receipts, deposits, refunds, discounts, cancelling; audit.
4. Server: reports and export.
5. Screens: price list; Billing (today's bills, find a bill, take payment, print); patient Bills tab; reports.
6. Fake demo prices and bills; how to test it in the browser (in `docs/PROGRESS.md`).

## Not included (could come later)
- Insurance claim forms or PM-JAY portal submission. (Insurance details on a bill, a general claim form and a PM-JAY
  claim sheet were built in October 2026 – see Next in `docs/PROGRESS.md`. Sending a claim to an insurer or to the
  PM-JAY portal is still not included: the sheet is copied into the portal by hand.)
- A pharmacy / medicine stock.
- Online payment links (e.g. a UPI link by SMS). (A UPI payment link was built in October 2026 – see Next in
  `docs/PROGRESS.md`: reception copies the message and sends it; Perinexa sends no SMS and records the payment only
  when reception takes it.)
- GST invoices.
- Doctors' revenue sharing or payouts.
