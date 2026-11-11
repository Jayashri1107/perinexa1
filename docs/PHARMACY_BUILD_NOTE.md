# Pharmacy: 18 features for the developer to build

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-pharmacy-apps-review`,
> commit 3dbc77af).** Written against the other Perinexa copy. Perinexa1's pharmacy has grown further: purchases
> (GRN), opening stock import, the sales register, supplier returns, the stock sheet and Tally (`pharmacyStock.js`,
> `pharmacyRegister.js`, `pharmacySupplierReturns.js`, `docs/PHARMACY_PLAN.md`, `docs/TALLY_PLAN.md`). Read
> "what exists" again against this code before building. The ideas list in this repository is
> `docs/IDEAS_FOR_LATER.md`. **Stage A (PH4, PH2, PH3, PH1) built on 11 Nov 2026, branch `pharm-stage-a` – see
> `docs/PROGRESS.md` and the note under Stage A below.** **Stage B (PH6, PH5, PH7, PH10) built on 11 Nov 2026, branch
> `pharm-stage-b` – see the note under Stage B.** Stages C and D are not built.

Written 10 Nov 2026 for the developer, at the owner's request. After a comparison with pharmacy (medical store)
programs and hospital pharmacy modules (`docs/PHARMACY_APPS_REVIEW.md`), the owner chose **these 18 features and only
these**, and gave seven decisions (section 7 of this note repeats them).

| # | Feature | In one line |
| --- | --- | --- |
| PH1 | Starting stock from a file | A hospital that joins loads its medicine list and the stock on its shelves from a file |
| PH2 | Pack sizes | Bought by the box or strip, sold by the tablet, without dividing by hand |
| PH3 | GST and discount on a purchase | The supplier's bill as it is printed: discount, tax, total; the supplier's credit note; a purchase register |
| PH4 | The manufacturer's name | On the medicine and the purchase – what a recall names |
| PH5 | A batch on hold | A recalled batch cannot be sold; a list of who received it |
| PH6 | "Already sold" on a prescription | What was sold from each prescription line, and what is still owed to her |
| PH7 | Warnings at the counter | Her allergies; high-alert and look-alike marks; a witness for writing off controlled stock |
| PH8 | Vaccine batch | The batch on her or the baby's record (the refrigerator's temperature log is put off – owner, 10 Nov 2026) |
| PH10 | Substitutes | Another brand of the same medicine, only with a doctor's yes, never for the doctors' list |
| PH11 | What each supplier is owed | Bills, payments, credit days |
| PH12 | The ward asks on screen | A request from the ward that the pharmacist issues against |
| PH13 | Stock outside the pharmacy | Labour room, theatre, ward, emergency tray – transfers and expiry checks |
| PH14 | Kits and consumables | A delivery kit issued in one step; surgical items as their own kind |
| PH15 | The missing reports | Profit, non-moving stock, expiry loss, days out of stock, prescriptions filled in-house, day closing |
| PH16 | The supplier's bill from a file | A purchase filled from the distributor's file instead of typed |
| PH17 | Reorder by what was used | The order suggestion follows the last weeks' use |
| PH24 | Sales by doctor | For the pharmacist and the super admin only |
| PH26 | AI forecasting of demand | A second opinion beside PH17, only if it proves better |

**Nothing is built.** The feature pause in `CLAUDE.md` still holds: when these are built is for the developer and the
owner to agree. The numbers are the owner's names for the features and are kept (PH9 and PH18–PH25 are not on the
list). Sections 1 to 6 are written engineer to engineer; section 7 is the owner's and the hospital's part.

## 1. What exists today (read in the code, 10 Nov 2026)

- **Models** – `server/src/models/Pharmacy.js`: `Medicine`, `Supplier`, `Purchase` (lines with batch, expiry, `qty`,
  `freeQty`, `ratePaise`, `mrpPaise`, and a snapshot of `hsn` and `gstRate`), `PurchaseOrder`, `SupplierReturn`,
  `StockBatch` (`qtyIn`, `qtyLeft`, `mrpPaise`, `costPaise`, `purchaseId`, `supplierId`), `StockMove` (`MOVE_KINDS`,
  `balanceAfter` of the medicine across all batches) and `PharmacyInvoice` (`kind: 'sale' | 'issue'`, `visitId`,
  `doctor { name, reg }`, `lines`, `returns`, `payments`). Amounts are whole paise; **every quantity is in units of
  sale**. Nothing is deleted.
- **The stock rules** – `server/src/pharmacy/pharmacyService.js`: `moveStock` is the only way a quantity changes (one
  conditional update, so it never goes below zero, and it writes the `StockMove`); `allocate` picks the batches
  (earliest expiry first, expired refused); `createPurchase`, `createInvoice`, `returnItems`, `writeOff`,
  `countStock`. Tax: `pharmacy/gst.js` (`lineMoney` works the taxable value back from the MRP; CGST + SGST only).
- **Routes** – `server/src/routes/pharmacy.js` (settings, medicines, suppliers, purchases, stock, the patient's
  prescriptions, invoices, reports, export), `pharmacyOrders.js`, `pharmacySupplierReturns.js`, and
  `pharmacyStock.js` (`POST /api/pharmacy-stock/check` – what doctors see while prescribing). Guards in
  `pharmacy/pharmacyHttp.js`: `desk` (pharmacist), `editor` (pharmacist or admin), `reports` (both).
- **Two matchers, on purpose different.** The counter's prescription list (`routes/pharmacy.js`, about line 419)
  scores word overlap on brand and generic and offers the top three. `pharmacy/stockMatch.js` is the strict one
  (same name words, every amount found with units converted, same kind of form, no extra ingredient) and is used
  only for the doctor's "in stock" mark.
- **What the pharmacist sees of a patient** – `utils/patientAccess.js`: `view` is the lab's fields plus `closed`,
  `phone` and the doctor's name; every flag false. `routes/pharmacy.js` builds its own narrow views inline
  (`fullName, mrn, phone, duplicateOf, death.on`), with her last five prescriptions.
- **Allergies** – `Patient.medical.allergies`, **one free-text string** (max 500), required or "None known" when the
  medical section is saved. The pharmacist never receives it. The allergy check for doctors runs **in the browser
  only**: `client/src/pages/medsafety/medSafety.js` (`allergyNames`, `ALLERGY_GROUPS`, `termMatches`,
  `medicineWarnings`, `needsReason`); the server's `medsafety/medicineSafety.js` has no allergy matching.
- **Reports** – low stock and expiry, the H1 / X / narcotic registers (read from `StockMove`), sales and GST by day,
  purchases by supplier, the admin's CSV export. No profit, no report by doctor.
- **Outside the pharmacy module**: Tally sends pharmacy invoices, credit notes, counter receipts and supplier debit
  notes – **no purchase event** (`tally/events.js`); the hospital export has eight pharmacy files
  (`export/hospitalExport.js`); 26 `PHARMACY_*` audit actions (`models/AuditLog.js`), details trimmed in
  `utils/auditDetails.js`; the formulary's two-person verification (`formulary/formularyRules.js` – `isVerified`,
  `routes/formulary.js` – `POST /:itemId/verify`, `SAME_PERSON`).
- **Tests** – `server/tests/pharmacy.test.js`, `pharmacyExtras.test.js`, `pharmacyStock.test.js`;
  `client/src/pages/pharmacy/pharmacyExtras.test.js`, `pharmacyExtrasScreens.test.jsx`.

Four limits to keep in mind:

- **One stock.** No query knows a place; PH13 changes that everywhere.
- **MRP per unit in whole paise.** A strip of 15 at ₹100 has no exact price per tablet. PH2 has to solve this, not
  round it away.
- **The doctor on an invoice is text** (`doctor.name`, `doctor.reg`), not a user id.
- **No demo stock.** `server/scripts/seed-demo.js` adds the demo pharmacist only; medicines exist in tests alone.

## 2. Suggested order

The features lean on each other; four stages, one branch per feature inside each.

| Stage | Features | Why here |
| --- | --- | --- |
| A – the data underneath | PH4, PH2, PH3, PH1 | They change `Medicine`, `Purchase` and `StockBatch`. Do them before any hospital loads real stock, and PH1 last so that the file already has pack sizes, manufacturer and tax |
| B – safety at the counter | PH6, PH5, PH7, PH10 | Small, no new places, the largest gain in safety. PH10 needs PH6's link from a sale line to a prescription line |
| C – money and figures | PH11, PH15, PH24, PH17, PH16, PH26 | PH11 and the profit report need PH3's totals; PH26 needs PH17 |
| D – the hospital side | PH13, PH12, PH14, PH8 | PH13 is the largest change in this note; PH12 and PH14 are simple once it exists |

## 3. Stage A – the data underneath

> **Built in perinexa1 (11 Nov 2026).** Differences from what follows: PH2 – perinexa1's purchase line already kept
> the bill's pack (`pack.conv`, `pack.mrpPaise`); the batch now keeps `packMrpPaise` and `unitsPerPack` from it and a
> sale line `grossPaise` (`pharmacy/gst.js grossOf`); the medicine has `packSize`, `packName`, `looseSale`. PH3 –
> discount, IGST and rounding were already in the GRN; added `grn.printedTotalPaise` (409 `BILL_TOTAL_DIFFERS` beyond
> ₹1 unless `totalConfirmed`), `SupplierReturn.creditNote` (`POST /supplier-returns/:id/credit-note`, audit
> `PHARMACY_SUPPLIER_CREDIT_NOTE`) and the register in `GET /reports/purchases`. **Purchases to Tally: built 11 Nov 2026 (`tally/events.js purchaseVector`, voucher kind `purchase`).**
> PH1 – opening stock already existed (Excel read in the browser, `pharmacy/openingStock.js`); added the manufacturer
> and pack-size columns and the refusal of a batch already brought in. No `StockImport` model; the witness for
> controlled opening stock was added 11 Nov 2026. Tests: `server/tests/pharmacy-stage-a.test.js`.

### PH4 – the manufacturer's name

- The pharmacist's answer (through the owner, 10 Nov 2026): the manufacturer's name is **not** a legal particular of
  the registers. It is kept for what a recall needs, so no register column and nothing new on the printed invoice.
- `Medicine.manufacturer` (text, 120). Snapshot it on purchase lines and supplier-return lines, where `hsn` and
  `gstRate` are already snapshotted. `medicineView` in `pharmacyHttp.js`; the purchases and supplier-returns CSV
  exports; PH5's hold screen shows it.
- `PATCH /medicines/:id` changes only what was sent (the fault of 4 Oct 2026 – keep its test).
- A notice on Pharmacy → Medicines for medicines without a manufacturer, in the pattern of the existing notice for
  medicines with empty fields.
- **Tests**: old lines without the field still show and export, empty rather than "undefined".

### PH2 – pack sizes

**What the user sees**: on a medicine, "a strip of 10 tablets". A purchase is typed as on the supplier's bill –
12 strips, 1 free, ₹86.40 a strip, MRP ₹107.50 a strip. At the counter: "2 strips and 3 tablets", or a number of
tablets. Stock shows both ("143 tablets – 14 strips and 3").

**Building it**
- **Stock stays in units of sale.** `StockBatch`, `StockMove`, the registers and the conditional update do not
  change. Add `Medicine.packSize` (units in a pack, default 1), `packName` (strip, box, bottle …) and `looseSale`
  (false for what cannot be split).
- **The purchase line keeps what was typed**: `packs`, `freePacks`, `packRatePaise`, `packMrpPaise`, `unitsPerPack`
  (a snapshot – a pack size can change), and the server derives `qty` and `freeQty`.
- **The price problem.** Keep the pack price as the truth: `StockBatch.packMrpPaise` and `unitsPerPack`, and work a
  line's gross out as `Math.floor(qty × packMrpPaise / unitsPerPack)` – so a whole strip costs exactly its printed
  MRP and loose tablets are rounded down once per line, never above the MRP. `mrpPaise` per unit stays for
  old batches and for display. This touches `lineMoney` in `gst.js` (takes the gross or the pack price), `partOf`
  (already proportional), `batchView`, the e-invoice unit price (`einvoice.js`) and the Tally vectors – re-run the
  Tally control sheet tests.
- Cost the same way: `packRatePaise` and `unitsPerPack`; `costPaise` per unit stays as a rounded figure for the
  stock value.
- **Loose sale from a pack whose price does not divide evenly is allowed** (the pharmacist's answer through the
  owner, 10 Nov 2026). A strip of 15 at ₹100, sold one tablet at a time at ₹6.67, would total ₹100.05 – five paise
  above the MRP. So a line that is not whole packs is rounded **down** to the paisa (`Math.floor`), whole packs stay
  exact: no way of splitting a pack can then cost more than its MRP. (Rounding down is this note's reading of
  "allowed, never above MRP" – confirm it with the pharmacist when the screen exists.)
- **Tests**: 15 tablets at ₹100 – one strip is ₹100.00, two strips ₹200.00, 7 tablets ₹46.66, fifteen single
  tablets ₹99.90; a return of part of a line; old batches without pack fields; the Tally and e-invoice figures of a
  pack sale.

### PH3 – GST and discount on a purchase

**What the user sees**: a purchase line gains the discount and the tax as on the bill; at the foot, taxable value,
CGST + SGST or IGST, round-off and the total, with "Bill total as printed" to type – a difference of more than ₹1
is shown before saving. A supplier return can carry the supplier's credit note number and date. A purchase register
for a period.

**Building it**
- Per line: `discountPercent`, `gstRate` (today a snapshot of the medicine's rate – it becomes what the supplier
  charged, changeable), and worked out: `taxablePaise`, `gstPaise`, `cgstPaise`, `sgstPaise`, `igstPaise`. Per
  purchase: `interState` (reuse `isInterState(pharmacyGstin, supplierGstin)` from `supplierReturnsService.js`),
  `roundOffPaise`, `invoiceTotalPaise` (typed), `totalPaise` stays the value before tax.
- A pure function beside `lineMoney` for tax **added to** a rate (a purchase) rather than taken out of an MRP.
- `StockBatch.costPaise` stays before GST and after discount: **the pharmacy claims the tax on purchases back** (the
  accountant's answer through the owner, 10 Nov 2026), so the tax is not part of the cost.
- `SupplierReturn.creditNote { number, date, amountPaise, by, byName, at }` – added later than the return, so its
  own small route; audit it.
- **Report and export**: `GET /reports/purchases` gains the register (one row per purchase: taxable, tax by rate,
  total); purchases without tax fields are listed apart as "tax not recorded" and left out of the tax totals.
- **Tally: purchases go to Tally** (the accountant's answer through the owner, 10 Nov 2026). Add a purchase event to
  `tally/events.js` (`docs/TALLY_PLAN.md` held it back until the tax was recorded), with the plan's rules: no item or
  medicine names in the entry, a cancelled purchase as a reversing entry, and the supplier's account as the
  supplier debit note already uses it (`supplierReturnVector`). Purchases without tax fields are not sent.
- **Tests**: intra-state and inter-state; a free quantity; the typed total within and beyond ₹1; an old purchase.

### PH1 – starting stock and the medicine list from a file

**What the user sees**: Pharmacy → Medicines → **Bring in from a file**, and Stock → **Starting stock from a file**.
A template to download; the file is chosen; a preview shows every row with what is wrong in it; **Bring in the 412
rows that are right** – nothing is saved before that.

**Building it**
- **CSV only, read in the browser** (`File.text()`, a small parser for quoted cells – the server already writes CSV
  by hand in `routes/pharmacy.js`), sent as JSON rows. No upload library and no Excel library; an `.xlsx` reader
  would be a new dependency – her agreement first.
- Two server paths, each with `dryRun: true` returning the same row-by-row answer the real run would give:
  medicines (name, generic, form, strength, unit, pack size, manufacturer, HSN, GST rate, schedule, reorder level,
  barcodes) and starting stock (medicine, batch, expiry, quantity, MRP, cost, optional supplier).
- **A new move kind `'opening'`** in `MOVE_KINDS`; the batch has `purchaseId: null`. It must not appear as a
  purchase (reports, Tally, the purchase register). In the narcotic and Schedule X registers it is a row "Starting
  stock", and it needs a witness, as a count does. Without a supplier, the batch cannot go on a supplier return –
  `returnableBatches` already filters by supplier; say so on the screen.
- A `StockImport` document per run (who, when, file name, counts, a hash of the rows) – the same file a second time
  is refused. Limits on rows per request; chunks of a few hundred.
- Matching a stock row to a medicine: exact name and strength (case and spaces ignored), or a barcode. No guessing –
  an unmatched row is an error in the preview.
- Expired rows are refused, as in `createPurchase`. A schedule left empty for a medicine whose name is on the
  hospital's H1 or narcotic list cannot be known – show a count of rows without a schedule and ask.
- Audit `PHARMACY_STOCK_IMPORTED`, counts only.
- A fake sample file in the repository (it doubles as the demo stock that is missing today).
- **Tests**: a dry run saves nothing; a second run of the same file is refused; one hospital's import never touches
  another's; the registers show the starting row; a controlled medicine without a witness is refused.

## 4. Stage B – safety at the counter

> **Built in perinexa1 (11 Nov 2026).** PH6 – `rxItemId` and `repeatReason` on sale lines, `pharmacy/rxGiven.js`,
> `409 ALREADY_SOLD`. PH5 – `StockBatch.hold` / `released`, one usable-stock filter (`usableMatch` in
> `pharmacyService.js`), `POST /batches/hold`, `/batches/release`, `GET /batches/recipients`. PH7 – `allergyFor` on the
> prescriptions answer (allergy text only), `Medicine.marks` with two-person confirmation (`routes/medicineMarks.js`,
> website Formulary → Medicine marks), a witness on `POST /batches/:id/writeoff` for X and narcotic medicines. PH10 –
> `pharmacy/substitutes.js` (sure only when a brand was written and another brand of the same generic is chosen –
> unclear cases are left as before rather than blocked), `NoSubstitute` model (doctors), `substitution` on the sale
> line, `GET /medicines/:id/substitutes`, `GET /doctors`, `409 SUBSTITUTE_NEEDS_DOCTOR` / `NO_SUBSTITUTE`. Not built:
> the printed pick list's marks; the formulary's own `highAlert` is still separate. Tests:
> `server/tests/pharmacy-stage-b.test.js`.

### PH6 – "already sold" on a prescription

**What the user sees**: under each prescription line at the counter – "Given: 10 on 3 Nov (PH-000412). Still to
give: 20." A line fully given is marked so. Choosing it again asks: "This was already given on 3 Nov. Sell again?"
with a reason.

**Building it**
- **Link the sale line to the prescription line**: `invoiceLineSchema.rxItemId` (the prescription item's `_id`), sent
  by `SellPage.jsx` when a line comes from `useRx`. An index `{ tenantId, visitId }` on invoices (partial).
- `GET /pharmacy/patients/:id/prescriptions` adds to each item `sold: [{ number, date, name, qty }]` (net of
  returns) and `stillToGive` where `suggestedQty` could be worked out. Old invoices have no `rxItemId`: show them at
  the level of the prescription ("PH-000398 was sold from this prescription on 28 Oct"), not guessed onto lines.
- A second sale of a line already given in full: `409 ALREADY_SOLD` unless the body carries `repeatReason` (kept on
  the line, audited). **A reason for every medicine** (owner, 10 Nov 2026), not only the prescription-only ones.
- Prescriptions written on an earlier record of a duplicate pair are already listed (`earlierRecordIds`); query the
  sales by `visitId`, not by patient, so both records count.
- **Tests**: a part sale then the rest; a return puts the quantity back to "still to give"; the reason is required
  for an H1 line and for an over-the-counter line alike; a sale on the main record counts for a prescription written on the earlier record.

### PH5 – a batch on hold, and who received it

**What the user sees**: Stock → a batch → **Put on hold** (recalled / quality doubt / other, a note). The batch shows
"On hold" (colour, icon, word) and cannot be sold or issued. **Who received this batch**: date, invoice, patient and
number, phone, quantity net of returns; walk-ins by the name on the invoice; what is still in stock; printable.
**Release** with a reason.

**Building it**
- `StockBatch.hold { reason, note, by, byName, at }` (null when free) and `released[]`. A recall names a
  manufacturer's batch number, and the same number can sit in several `StockBatch` documents (two purchases; after
  PH13 several places): the action works on `{ tenantId, medicineId, batch }`, all of them at once.
- **Every "usable stock" query must leave held batches out**: `allocate` (skip in first-expiry order; `409 ON_HOLD`
  when chosen by hand), `GET /stock`, `GET /reports/alerts`, `GET /medicines/:id/batches`, `suggestFromLowStock`,
  and `pharmacyStock.js` (the doctor's "in stock"). Put the filter in one helper; today "not expired and
  `qtyLeft > 0`" is written out in each place.
- Still allowed on a held batch: a supplier return (reason `recalled` exists), a write-off, a count. A patient's
  return of a held batch: take it back **onto the hold**, never into saleable stock.
- The list reads `StockMove` (`batchId`, kinds `sale`, `issue`, `return`) – no new data. It shows what the pharmacist
  already sees of a patient, no more; a closed record shows as "Record closed", as on the other pharmacy screens.
- Audit: `PHARMACY_BATCH_HELD`, `PHARMACY_BATCH_RELEASED`, `PHARMACY_BATCH_RECIPIENTS_VIEWED` (ids and a count).
- **No notice to her doctor** (owner, 10 Nov 2026): the pharmacist's list is enough. Telling the patients is the
  hospital's own step, outside Perinexa.
- **Tests**: first-expiry skips a held batch and sells the next; held stock does not count as "in stock" for the
  doctor or for the reorder list; the list is net of returns; another hospital's batch with the same number is
  untouched.

### PH7 – warnings at the counter

**Allergies – the owner's decision 2 changes who sees what.**
- `GET /pharmacy/patients/:id/prescriptions` and the issue path return `allergies: { status, text }` for the
  pharmacist: the free text of `medical.allergies` and whether it was asked at all (`allergyStatus` in
  `client/src/pages/patients/patientFormat.js` tells "none known" from "not asked"). **Only this field.** Do not
  widen `patientAccess` for the pharmacist: `medical` holds far more than allergies; keep the pharmacy's own narrow
  projection and add the one path.
- The warning itself: reuse the browser's matcher (`allergyNames`, `termMatches` in `medSafety.js`) against the
  chosen medicine's brand and generic name. It is text against text and will miss – so the allergy line is always
  shown when she has one, and the warning is an extra, never the only signal.
- **No reason is asked of the pharmacist** (owner, 10 Nov 2026): the warning is shown and the sale goes on. Nothing
  new is stored on the invoice, and no server-side matcher is needed for this.
- A walk-in has no record: nothing is shown, and the screen says "No record – ask about allergies."
- Audit: the viewing is already logged as `PHARMACY_PRESCRIPTIONS_VIEWED`; add `allergiesShown: true` to its details
  rather than the text.
- Update what describes the pharmacist's access: the header comment of `routes/pharmacy.js`,
  `docs/PHARMACY_PLAN.md` section 1, **`docs/HANDOVER.md` section 9** (an owner's decision), `docs/TEST_ACCOUNTS.md`.

**High-alert and look-alike marks – written by a doctor and the pharmacist together (decision 6).**
- `Medicine.highAlert` and `Medicine.lookAlike: [medicineId]`, each with the formulary's pattern: proposed by one,
  in force only when a doctor and a pharmacist – two different people – have both agreed (`isVerified`, `SAME_PERSON`
  in the formulary code). Any change clears the agreement. Perinexa ships none.
- Shown on Sell, Issue, Stock and the printed pick list: "High alert" as colour, icon and word; for a look-alike,
  when the medicine is added to a sale: "Looks or sounds like Cefixime 200 – check the pack."
- The formulary (branch `crs-7-formulary`) has its own `highAlert` on a dose row. Two flags for one idea will drift;
  when both are in `main`, let the stock list read the formulary's flag where a row matches, or keep one.

**A witness for writing off controlled stock.** `writeOff` takes no witness today (noted in October). Give it the
same rule as `countStock` (`CONTROLLED`, a name of two letters or more), in the route's schema and on
`StockPage.jsx`.

**Tests**: the pharmacist's answer holds `allergies` and nothing else of `medical`; a hospital admin on the same
route gets no allergies; a mark is not shown until both have agreed; the same person cannot agree twice; a narcotic
write-off without a witness is refused.

### PH10 – substitutes

**The owner's rule (decision 3)**: only with a doctor's yes – the pharmacist asks and writes which doctor agreed –
and never for the medicines on the doctors' "never substitute" list.

**What the user sees**: beside a prescription line whose brand is out of stock (or on **Other brands**): the
medicines in stock with the same generic, strength and form. Choosing one asks "Which doctor agreed?" – a doctor of
the hospital from a list, or a typed name for an outside prescription. For a medicine on the never-substitute list
nothing is offered: "The doctors do not allow another brand for this medicine."

**Building it**
- **Use the strict matcher.** "The same medicine" is what `stockMatch.js` already defines (`nameKey`, `amountsIn`,
  the form kinds, no extra ingredient) – not the counter's word-overlap score. Candidates need `Medicine.generic`
  and `strength` filled; a medicine without a generic name is never offered and never substituted for.
- **What counts as a substitute.** When the doctor wrote a generic name, any brand of it is what was prescribed –
  no question. When the doctor wrote a brand and the chosen medicine is another brand, it is a substitute. Today the
  counter lets the pharmacist "pick another brand" freely; with this rule that choice asks for the doctor. Decide it
  on the server from `rxItemId` (PH6), the prescribed text and the chosen medicine – and test the edge cases
  (a brand name that is also the generic's first word; a combination).
- The line keeps `substitution { prescribed, agreedById, agreedByName, at }`; the server refuses a substitute
  without it (`SUBSTITUTE_NEEDS_DOCTOR`). Printed on the invoice: "Given in place of …, agreed by Dr …".
- **The never-substitute list**: a small per-hospital model (`text`, its `nameKey`, who added it, active). Only
  doctors edit it; the pharmacist reads it. Matched against the prescribed text and the generic. `NO_SUBSTITUTE`
  from the server, whatever the website offered.
- Not built: showing prices or margins beside the candidates. The order is alphabetical, then earliest expiry.
- **Tests**: a generic prescription takes any brand without a question; a brand needs the doctor; a listed medicine
  is refused even when the request is forged; Paracetamol is never offered for Paracetamol + caffeine.

## 5. Stage C – money and figures

> **Built in perinexa1 (11 Nov 2026), except PH26.** PH11 – `pharmacy/supplierAccount.js`, `SupplierPayment`
> (SP-numbers, cancelled never deleted), `GET /suppliers/:id/account`, `POST /suppliers/:id/payments`,
> `GET /reports/supplier-dues`; payments go to Tally since 11 Nov 2026 (`supplierPaymentVector`). PH15 – `pharmacy/figures.js` (profit by medicine,
> slow stock, expiry loss, days out of stock, prescriptions filled, H1 use), `StockMove.writeoffKind`, invoice line
> `costPaise`, `PharmacyDayClose` and `POST /day-close`. PH24 – `pharmacy/salesByDoctor.js`, invoice `doctor.userId`,
> `GET /reports/by-doctor` (pharmacist only), `GET /api/platform/analytics/pharmacy-by-doctor` (numbers only, a doctor
> from 5 invoices). PH17 – `pharmacy/reorderByUse.js`, `GET /orders/suggest?mode=use`, `Tenant.pharmacy.reorder*Days`
> (30 / 3 / 15), `Medicine.preferredSupplierId`, `GET /medicines/:id/last-price` (shown on the purchase line).
> PH16 – `Supplier.billFile` (column headings and item matches, per supplier), `GET/PUT /suppliers/:id/bill-file`,
> `POST /suppliers/:id/bill-file/match`, website `BillFile.jsx` and `stockFile.js billHeadings / billLines`; CSV and
> .xlsx only, no photo or PDF. **PH26 is not built**: its own condition (a back-test showing it beats PH17) needs months
> of a hospital's real sales, which do not exist yet. Tests: `server/tests/pharmacy-stage-c.test.js`.

### PH11 – what each supplier is owed

- `Supplier.creditDays`. A `SupplierPayment` model: supplier, date, amount, mode (cash, cheque, bank, UPI),
  reference, optionally the purchases it settles, cancelled with a reason, never deleted.
- A supplier's account = purchase totals **with tax** (PH3 – before it, totals are before tax and the account would
  be wrong) − debit notes (supplier returns) − payments. Due date = bill date + credit days. A page per supplier and
  a list "owed and overdue"; in the admin's export.
- **Supplier payments are entered in Perinexa** (the accountant's answer through the owner, 10 Nov 2026). Who: the
  pharmacist enters, the hospital admin sees – proposed. Since purchases now go to Tally (PH3), the payments should
  follow as payment entries, or the supplier's account in Tally will never close: add them to the Tally events with
  the purchase event, and tell the accountant not to type them in Tally as well.
- Audit with ids and amounts. **Tests**: a cancelled purchase and a cancelled return leave the account; part payments.

### PH15 – the missing reports

All under `reports(req)` on Pharmacy → Reports, with CSV where the others have it.

| Report | Read from | Watch |
| --- | --- | --- |
| Profit by medicine | Invoice lines (taxable, net of returns) less cost | Snapshot `costPaise` on the invoice line from now on; for old lines look the batch up |
| Non-moving and slow stock | Medicines with stock and no `sale` or `issue` move in 90 / 180 days, at cost | Held and expired stock shown apart |
| Value lost to expiry | `writeoff` moves and supplier returns with reason `expired`, at cost | The write-off reason is free text today – add a kind (expired, damaged, lost, other) from now on |
| Days out of stock | Per medicine, the stretches where `balanceAfter` was 0 | `balanceAfter` counts expired stock too: say "about", or count usable stock from the moves |
| Use by ward | `issue` moves by place | Only after PH13; until then one total |
| Prescriptions filled in-house | Visits with a prescription in the period against invoices with that `visitId` | Counts only – no patient list |
| Antibiotic (H1) use | H1 medicines' `sale` and `issue` moves by month | |
| Day closing | Walk-in `payments` by mode for the day, refunds, and the sales that went on hospital bills | A small `PharmacyDayClose` (expected, counted cash, difference, note, who closed). No table of takings per named pharmacist – the closing carries the name of who closed it, nothing more |

Every `aggregate()` starts with a `$match` on `tenantId` (the guard in `utils/tenantScope.js` refuses it otherwise).

### PH24 – sales by doctor

**The owner's decision 5: only the pharmacist and the super admin see it** – not the hospital admin, not the doctors.

- `GET /pharmacy/reports/by-doctor` with its own guard (a new `PHARMACY_DOCTOR_SALES_ROLES = ['pharmacist']`; it is
  **not** `reports(req)`, which lets the admin in), and its own copy in the website's role lists
  (`pharmacyFormat.js`).
- Per doctor for a period: invoices, amount net of returns. `invoice.doctor` is text – add `doctor.userId` from now
  on (the prescription's `by`); group old invoices by name and registration number. **Outside doctors appear by name**
  (owner, 10 Nov 2026) – the name typed at the counter. Typed names vary ("Dr A. Kulkarni", "Dr Kulkarni A"): group
  by registration number when one was typed, otherwise by the name with case, dots and spaces ignored, and offer the
  earlier typed names while the pharmacist types.
- **The super admin** has no pharmacy access and must get numbers only: a platform route under `superAdmin`
  (`app.js`), built like `analytics/platformTotals.js` – per hospital, per doctor, a count and an amount; no invoice
  number, no patient, no medicine. A doctor's name is a staff name, not patient data. One invoice in a period is one
  patient's purchase: use a minimum count before a line is shown (the platform's own switch,
  `PLATFORM_MIN_DENOMINATOR`, is 0 today).
- Not in the admin's export, not in the hospital's Analytics. Audit `PHARMACY_DOCTOR_SALES_VIEWED`.
- **One thing the decision does not cover**: the hospital admin already sees the doctor's name on every pharmacy
  invoice and in a "Doctor" column of the sales export, and could add it up. Hiding that would change the tax
  invoice list and the accountant's file – asked of the owner in section 7.
- **Tests**: the admin gets 403; the platform answer holds no id, number or name of a patient; returns are netted.

### PH17 – reorder by what was used

- Use per day = `sale` + `issue` − `return` moves over the last N days, divided by the days the medicine was in
  stock in that time (not by N – a week out of stock must not lower the figure). A pure function beside
  `suggestedOrderQty`: use per day × (days the supplier takes + days to cover) − usable stock − on order, never below
  what the fixed reorder level asks.
- Settings on `Tenant.pharmacy`: the days to look back and to cover. `Medicine.preferredSupplierId` (today the last
  supplier is taken from the newest batch – keep that as the fallback). The last price paid, on the order screen and
  in purchase entry, with a mark when today's is higher.
- `suggestFromLowStock` stays; a second mode beside it. Held stock (PH5) is not usable stock.
- **Tests**: a week out of stock; a return inside the period; a new medicine with no history falls back to its level.

### PH16 – the supplier's bill from a file

- The same browser-side CSV reading as PH1. Distributors' files differ: a column map saved per supplier
  (`Supplier.importMap`) and remembered matches from their item name to a `Medicine` (`Supplier.itemMap`).
- The file only **fills the purchase form**; saving goes through the existing `POST /purchases` with every check it
  has. No second way for stock to come in.
- An unmatched item is picked by the pharmacist once and remembered. Never created from the file without a look.
- A photo or PDF read by AI: later, and only with her agreement on the add-on; a supplier's bill holds no patient
  data, but it is the pharmacy's prices going outside.

### PH26 – AI forecasting of demand

- After PH17, and **only if it proves better**. First back-test: for the months already past, compare what PH17
  would have suggested, what "the same month last year" gives, and what the model gives, against what was really
  used. A single hospital's history is short and the model may add nothing; if it does not beat the plain figures,
  do not ship it.
- What is sent, through `askAI` (`server/src/ai/openai.js`, `store: false`): the generic name, form, strength and
  the net quantity used per month. **Never** a patient, a doctor, an invoice, a supplier or a price. Write the
  context builder as a pure function with a test that fails on any other field, as `ai/askContext.js` is reviewed.
- AI is switched on for the whole server by `OPENAI_API_KEY`; there is no switch per hospital. A hospital must be
  able to leave this off – add one before this feature.
- Shown beside PH17's figure, marked "Suggested by AI – check", with its reason in a line. The pharmacist decides;
  nothing is ordered by itself. In tests the key is empty (`server/vitest.config.js`) – use a fake provider.

## 6. Stage D – the hospital side

> **Stage D built in perinexa1 (11 Nov 2026).** PH13 – `StockLocation` and `LocationCheck` models,
> `StockBatch.locationId` (null = the pharmacy, so no script was needed), `/api/stock-places`
> (`routes/stockPlaces.js`: places by a doctor or the admin with `staffIds`; `move-in` / `move-out` by the pharmacist,
> a copy of the batch at the destination and moves `transfer_out` / `transfer_in` with `place` and `otherPlace`;
> `checks`; `use` by the place's staff for a patient with `patientAccess(...).recordVitals`, through `createInvoice`
> with `_place` and `_orderedBy`); `usableMatch(today, locationId)` is the pharmacy's by default; the reorder
> suggestion counts all places. PH8 – `done.vaccine { batch, expiry, manufacturer, stockBatchId }` on a care-plan
> item, required when a vaccination is marked done here (also `doneItems[].vaccine` at a visit),
> `GET /api/pharmacy-stock/vaccine-batches`, `vaccinationsRecorded` in `GET /batches/recipients`.
> **PH14 and PH12:** PH14 – `Kit` model, `/api/pharmacy-kits`
> (`routes/pharmacyKits.js`: a doctor or the hospital admin writes, the pharmacist reads with what is short),
> `kitId` on an issue (the invoice keeps `kitName`), `Medicine.kind` 'medicine' | 'consumable' (a consumable has no
> schedule – 400 – and is left out of `/api/pharmacy-stock/check`). Website: Formulary → Kits, Pharmacy → Medicines →
> Kits, "From a kit" at the issue counter. PH12 – `WardRequest` model (WR-numbers, `statusOfLines`),
> `/api/patients/:id/ward-requests` (`routes/wardRequests.js`: those with the nursing chart's access, current stay only,
> stock words only), `GET /pharmacy/ward-requests`, `POST /pharmacy/ward-requests/:id/refuse`, `wardRequestId` on an
> issue (the ordering doctor becomes the prescriber; the narcotic and X rule still needs that doctor's registration
> number). Website: "Pharmacy requests" on the stay page, Pharmacy → Ward requests, a notice on the pharmacist's Today.
> Tests: `server/tests/pharmacy-stage-d.test.js`.

### PH13 – stock outside the pharmacy

**The owner's decision 4**: which places exist is decided by each hospital's doctor and admin. Perinexa ships none
beyond the pharmacy itself.

**What the user sees**: Settings → **Places that hold stock** (the hospital admin or a doctor adds: labour room,
theatre, a ward, an emergency tray). The pharmacist **moves stock** to a place; each place has its list with expiry
dates; a place can be **checked** (each item seen, expired ones taken out) and shows when its check is overdue.

**Building it**
- A `StockLocation` model (name, kind, active, `checkEveryDays`); one built-in "Pharmacy" per hospital.
- **Recommended shape**: a move to a place creates a **new `StockBatch`** at the destination with the same batch
  number, expiry, prices and a `fromBatchId`, and two moves (`transfer_out`, `transfer_in`). Each document keeps its
  own conditional update, `moveStock` is unchanged, `balanceAfter` stays the medicine's total, and PH5's hold by
  batch number reaches every copy. The alternative – one batch with a quantity per place – changes the invariant
  everything rests on.
- `StockBatch.locationId` (a script sets the pharmacy on existing batches, with an audit entry). **Every usable-stock
  query gains the place** – the helper from PH5 is where it goes: the counter and "issue to ward" take from the
  pharmacy; the doctor's "in stock" means the pharmacy; the reorder list counts all places or the pharmacy only
  (decide; proposed: all).
- **Using stock from a place for a patient** has to reach her bill with a tax invoice (the owner's decision of
  3 Oct). That is an `issue` invoice from the place's batches, entered by a nurse – a new, narrow path for nurses:
  admitted patients they may chart for (`assertCanChart` in `routes/admissions.js`), their place only, names and
  quantities, no prices, no purchase data. Review it as an access change.
- Controlled medicines: a transfer needs a witness and appears in the narcotic and Schedule X registers with the
  place.
- A `LocationCheck` (place, when, who, what was found); the alerts report lists expiring stock by place and overdue
  checks.
- **Tests**: a transfer keeps the medicine's total; a held batch number is held in every place; a nurse cannot issue
  from another place or see a price; one hospital's places never appear in another's.

### PH12 – the ward asks on screen

- A `WardRequest` (WR-000001): for an admitted patient (or, after PH13, to refill a place), lines of medicine and
  quantity, urgent or not, the doctor who ordered, requested → issued / part issued / refused / cancelled.
- Who asks: nurses, RMOs and doctors who may chart for her. They pick from the stock list by name, form and strength
  and see what doctors see while prescribing – in stock, low, not in stock (`pharmacyStock.js`) – never a quantity or
  a price.
- The pharmacist's **Issue to ward** lists open requests, urgent first, and a notice on Today. Issuing goes through
  `createInvoice({ kind: 'issue' })` with the request's id; the checks for prescription-only and controlled
  medicines are unchanged – the ordering doctor's registration number comes from the request.
- The paper path stays possible (an issue without a request), since a ward will not switch in a day.
- **Tests**: a nurse cannot ask for a patient she may not chart for; a refused line says why; a part issue leaves
  the rest open; the narcotic rule still needs the doctor's number.

### PH14 – kits and consumables

- A `Kit` model (name, lines of medicine and quantity, active). **Made by a doctor or the hospital admin** (decision
  4); the pharmacist reads it. Issuing a kit fills the issue form with its lines; the pharmacist sees what is short
  and may issue the rest. The invoice keeps the kit's name. No separate kit stock.
- Consumables: `Medicine.kind: 'medicine' | 'consumable'` rather than one more `FORMS` entry. A consumable has no
  schedule, is left out of the doctor's "in stock" check and of the registers, keeps HSN and GST. The screens say
  "Medicines and items".
- **Tests**: a kit with a line out of stock; a stopped medicine in a kit; a consumable never appears in a register.

### PH8 – vaccine batch

The refrigerator's temperature log that was part of this feature is **put off** (owner, 10 Nov 2026) – do not build
it now.

- A vaccination is a care-plan item (`ITEM_KINDS` has `'vaccination'`; `done { on, elsewhere, result, note, via … }`
  set in `applyIntent`, `careplans/plansService.js`). Add to `done`: `vaccine { batch, expiry, manufacturer,
  stockBatchId }` – asked when the item is marked done here, optional when `elsewhere`. When the vaccine came from
  the pharmacy's stock, offer its batches. It goes on the patient's copy of the plan and the baby's immunisation
  list.
- PH5's "who received this batch" then also searches these by batch number, for vaccines not sold through the
  pharmacy. That list reaches clinical records: it stays a count and a pointer for the pharmacist, the names for
  doctors.
- **Tests**: a vaccine marked done elsewhere needs no batch; a vaccine given here cannot be marked done without one;
  an item done before this feature shows no batch and no error.

## 7. The owner's decisions, and what the owner and the hospital still have to give

**Decided on 10 Nov 2026** (`docs/PHARMACY_APPS_REVIEW.md` section 6):
1. These 18 features, and no others.
2. The pharmacist sees a patient's allergies – and nothing else of her record.
3. A substitute only with a doctor's yes; the pharmacist asks and writes which doctor agreed; never for the
   medicines on the doctors' list.
4. The places that hold stock, and the kits, are decided by each hospital's doctor and admin.
5. Sales by doctor are seen only by the pharmacist and the super admin.
6. The high-alert and look-alike lists are written by a doctor and the pharmacist together.
7. No pharmacy bills sent to WhatsApp by themselves.

**Content each hospital writes** (Perinexa ships all of it empty): the never-substitute list (doctors); the
high-alert medicines and look-alike pairs (a doctor and the pharmacist); the places and the kits (a doctor and the
admin).

**Answered by the owner later the same day** (the questions this note raised):
8. PH24 – outside doctors' prescriptions appear in the sales by doctor **by name**.
9. PH5 – no notice to her doctor when a batch is recalled; the pharmacist's list is enough.
10. PH7 – the pharmacist is **not** asked for a reason before selling a medicine that matches her allergy.
11. PH6 – selling a prescription line again needs a reason **for every medicine**.
12. PH8 – the refrigerator's temperature log is put off.

**Answers for the pharmacist and the accountant, given through the owner**
- PH4 – the manufacturer's name is not a legal particular of the registers.
- PH2 – loose tablets may be sold from a pack whose price does not divide evenly.
- PH3 – the pharmacy claims the tax on purchases back, and purchases go to Tally.
- PH11 – supplier payments are entered in Perinexa.

**Still to ask – the owner**
- PH24: the hospital admin can already see the doctor's name on each pharmacy invoice and in the sales export. Is
  that acceptable, with only the added-up report hidden – or should the doctor's name leave the admin's export too?

## 8. Rules that hold throughout

- `tenantScoped` on every new model; a `tenantId` match first in every `aggregate()`.
- Need-to-know: the pharmacist gains the allergy line and nothing else; nurses and ward staff gain names and
  "in stock", never prices or purchases; the hospital admin gains no clinical field through any new report.
- The super admin gets numbers only – PH24 is the only feature here that reaches the platform side.
- The audit log: every new step, ids, quantities and amounts; add the labels in
  `client/src/components/auditFormat.js` and trim details in `utils/auditDetails.js`.
- Nothing is deleted: stop, cancel, release, reverse.
- Clinical content – the three lists of section 7 – is the hospital's doctors' to write and starts empty or DRAFT.
- Free text typed by staff goes through `safeText`.
- The medicine names of an HIV treatment are in the pharmacy by necessity; no new list, notice or figure outside
  the pharmacy may carry them.
- No new dependency without the developer's agreement. None is needed for PH1–PH17 and PH24 as described; an Excel
  reader, a photo reader (PH16) or a charting library would be one.
- The website keeps its own copy of the pharmacy's role lists (`pharmacyFormat.js`) and menu
  (`client/src/platform/modules.js`) – change both sides.
- Scripts that change stored data (PH13's place on old batches) write an audit entry and can be run twice.
- `npm test` from the project root only; fake data only.
- The GST rates on this branch still offer 12 % (ended 22 Sept 2025); the correction is in the developer's copy and
  should be in before PH3.

What pharmacy programs offer, the rules read and their sources are in `docs/PHARMACY_APPS_REVIEW.md`.
