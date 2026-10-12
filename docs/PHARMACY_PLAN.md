# Pharmacy and medicine stock – plan (approved and built)

Planned with the owner on 3 Oct 2026, approved with three changes (GST invoices for inpatient issues, narcotics
included, returns before expiry) and built the same day. How to test it: `docs/PROGRESS.md` → "How to test the
pharmacy".

## The owner's answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | What it covers | Hospital stock **and a retail pharmacy counter** selling to patients |
| 2 | Who works in it | A **new Pharmacist role** |
| 3 | Selling | **From the patient's prescription**; the sale goes on her bill (walk-ins without a Perinexa prescription too) |
| 4 | Receiving stock | **Purchase entry with batches**: supplier, invoice, batch, expiry, quantity, purchase price, MRP; first-to-expire sold first |
| 5 | Medicines used in the hospital | **Issued to the admitted patient**, going on her stay's bill |
| 6 | Reports | Low stock, expiry, **Schedule H1 register**, stock value and sales |
| 7 | GST | **Shown on pharmacy bills** (the pharmacy has a GSTIN): a tax invoice with taxable value, CGST and SGST – **also for medicines issued to admitted patients** (owner, 3 Oct 2026) |
| 8 | Narcotics | **Included** (owner, 3 Oct 2026), with their own register |
| 9 | Returns | Unopened medicines can be returned **any time before their expiry** (owner, 3 Oct 2026) |

## ⚠️ Before real use (legal – please confirm with your pharmacist and accountant)
- A retail pharmacy needs a **drug licence** (Forms 20 and 21) and a **registered pharmacist** on duty. Perinexa
  records sales; it does not replace the licence conditions.
- **Schedule H1** sales must be written in a register (patient, doctor, drug, quantity, date) and kept 3 years:
  Perinexa keeps and prints this register.
- **Narcotic drugs** (e.g. morphine, pethidine, fentanyl – NDPS Act): a hospital may stock them only as a
  **Recognised Medical Institution (RMI)** under the NDPS Rules 2015, kept under lock, with a register of every
  receipt and every dose given. Perinexa keeps that register; the RMI recognition, the lock and the physical checks
  stay the hospital's duty.
- **GST**: every sale and every issue to an admitted patient gets a tax invoice (owner's choice). Medicines given
  during a stay are often treated as part of exempt healthcare – your accountant should confirm; the invoice can be
  changed later without changing anything else.

## How it will work

### 1. The Pharmacist role
- A new staff role, given by the hospital admin like the others (one person can also hold another role).
- **Pharmacists see**: patients' names, numbers and phones, and the **medicines** of their prescriptions (drug,
  strength, dose, how often, how long) – never the diagnosis, notes or results.
- The pharmacist does everything in the pharmacy: the medicine list, suppliers, purchases, counter sales, issuing to
  inpatients, returns, write-offs, stock counts and the registers. The hospital admin sees the reports.

### 2. The medicine list (Pharmacy → Medicines)
- Each medicine: brand name, generic name, form (tablet, capsule, syrup, injection …), strength, **unit of sale**
  (e.g. tablet; a strip of 10 is 10 units), **HSN code**, **GST rate** (0, 5, 12 or 18 %), **schedule** (none, G, H,
  H1, X, or **narcotic (NDPS)**), **reorder level**. Added by the pharmacist; stopped, never deleted.
- Starts empty (each pharmacy stocks different brands). The admin or pharmacist adds medicines once, as they are
  first bought.

### 3. Suppliers and purchases (Pharmacy → Purchases)
- Suppliers: name, GSTIN, drug licence number, phone.
- **A purchase** is one supplier invoice: invoice number and date, and for each medicine the **batch, expiry,
  quantity (and free quantity), purchase price per unit and MRP per unit**. Saving it adds the stock, batch by batch.
- A purchase entered by mistake can be cancelled (with a reason) as long as none of its stock has been sold.

### 4. Selling at the counter (Pharmacy → Sell)
- Choose the patient → her recent **prescriptions** are listed; pick one and each medicine is matched to the stock
  list by name (the pharmacist confirms or picks another brand; quantity suggested from dose × frequency ×
  duration, changeable).
- A walk-in **without a Perinexa prescription**: the pharmacist types the doctor's name and ticks "prescription
  seen" for Schedule H and H1 medicines.
- **Batches**: the earliest-expiring batch is used first (can be changed). **Expired batches can't be sold**; a batch
  expiring within 30 days shows a warning.
- **Price**: MRP per unit (GST included), never above MRP. An optional discount for the whole sale, with a reason.
- **The tax invoice** (PH-000001 …, A5): pharmacy name, GSTIN and drug licence numbers, patient, doctor, each
  medicine with HSN, batch, expiry, quantity, MRP, taxable value, CGST and SGST, total.
- **Paying**: a registered patient's sale goes on **her hospital bill** as one line ("Pharmacy – invoice
  PH-000001"), paid at the billing desk like everything else. A customer who is **not a registered patient** pays at
  the counter on the invoice itself (cash, UPI, card).
- **Schedule H1** medicines go into the H1 register automatically.

### 5. Issuing to admitted patients (Pharmacy → Issue to ward, or from her stay)
- The pharmacist chooses the admitted patient and the medicines (from the ward's written request); stock goes
  down and the medicines go on **her stay's bill** at MRP, with a **GST tax invoice** like a counter sale.

### 5a. Narcotic and Schedule X medicines (owner's choice: included)
- Sold or issued **only against a doctor's prescription with the doctor's name and registration number** (taken
  from the Perinexa prescription, or typed and "prescription seen" ticked); never to a walk-in who is not a
  registered patient.
- **Narcotic register** (one page per medicine): date, received from (supplier, invoice, batch) or given to
  (patient, patient number, doctor), quantity in, quantity out, **balance** – printable for any period.
- **Schedule X register** in the same form. Stock counts of narcotic or Schedule X medicines need a reason and a
  second staff member's name (the witness).
- Shown with a "Narcotic" or "Schedule X" mark everywhere; low-stock and expiry alerts as for other medicines.

### 6. Returns, write-offs and stock counts
- **Return** from a patient (**unopened, any time before the expiry date** – owner's choice): stock goes back to its
  batch; the amount comes off her bill (or is refunded at the counter for a walk-in), with a GST credit note.
- **Write-off**: expired, damaged or lost stock, with a reason.
- **Stock count**: the counted quantity of a batch replaces what Perinexa shows, with a reason.
- Every stock movement is kept (in, sold, issued, returned, written off, counted) with who and when.

### 7. Reports and alerts (Pharmacy → Reports)
- **Low stock**: medicines at or below their reorder level (also a notice on the pharmacist's Today page).
- **Expiry**: batches expiring in the next 90 days; expired batches (blocked from sale) to write off or return.
- **Schedule H1 register**: date, patient, doctor, medicine, batch, quantity – printable, for any period.
- **Narcotic and Schedule X registers** (see 5a).
- **Stock value**: at purchase price and at MRP. **Sales** by day and month (counter and inpatient). **Purchases** by
  supplier. **GST summary** of sales by rate (taxable value, CGST, SGST) for the accountant.
- **Export** (admin): sales, purchases and the GST summary as files for Excel.

### 8. Who does what
| Role | Pharmacy |
| --- | --- |
| Pharmacist (new) | Everything above |
| Hospital admin | Reports and export; can also edit the medicine list and suppliers |
| Doctors, RMOs | Nothing new for now (later: seeing "in stock" while prescribing – built on 4 Oct 2026, see Next in `docs/PROGRESS.md`) |
| Reception | Takes payment of pharmacy sales on the patient's bill (Billing) |
| Nurses, lab | Nothing new |

Every purchase, sale, issue, return, write-off and count is in the audit log (ids, quantities and amounts).

## Build order (each step tested and committed)
1. Server: the Pharmacist role and what pharmacists may see.
2. Server: medicines, suppliers, purchases and batches.
3. Server: counter sales (from prescriptions, batches, GST invoice, the patient's bill or counter payment), H1 register.
4. Server: issues to inpatients (with GST invoices), returns (with credit notes), write-offs, stock counts; narcotic and
   Schedule X rules and registers.
5. Server: reports, alerts and export.
6. Screens: Pharmacy (sell, issue, purchases, medicines, suppliers, stock, reports); printed invoice and H1 register.
7. Fake demo medicines and stock; how to test it in the browser (in `docs/PROGRESS.md`).

## Not included (could come later)
- Purchase orders to suppliers, and returns to suppliers. (Built in October 2026 – see Next in `docs/PROGRESS.md`:
  orders with "Suggest from low stock", receiving against an order, returns with a debit note and their cancelling.)
- Barcode scanning. (Built in October 2026 – see Next in `docs/PROGRESS.md`: up to 10 barcodes per medicine and a
  "Scan or type a barcode" box; 2D pack codes with batch and expiry are still not read.)
- Showing doctors what is in stock while they prescribe. (Built on 4 Oct 2026 – see Next in `docs/PROGRESS.md`: only
  "In the pharmacy", "low stock" or "Not in stock" beside a medicine, never quantities or prices.)
- E-invoicing or GST return filing. (The e-invoice file of a sale to a business with a GSTIN was built in October
  2026 – see Next in `docs/PROGRESS.md`: the hospital admin downloads it and uploads it on the portal by hand.
  Connecting to the portal and GST return filing are still not included.)
