# Tally link for billing and pharmacy – plan (owner's decisions 16 Oct 2026; step 1 built)

Asked by the owner on 16 Oct 2026: "whatever is added in billing and pharmacy should automatically reach Tally".
This plan records what the link does, how it reaches the accountant's Tally, and the decisions behind it. The owner
made it **an exception to the feature pause** (like the ultrasound reports) and accepted every recommended default the
same day; **step 1 – the file – was built on 16 Oct 2026** (see "Built" below). Steps 2 and 3 are not built. The
developer reviews it after the fact, like the other exceptions (`docs/HANDOVER.md`, section 9). Idea 17 in
`docs/IDEAS.md`.

The study behind this plan (16 Oct 2026) read Perinexa's billing and pharmacy code, Tally's own documentation (the
current release is TallyPrime 7.2 of 12 Oct 2026) and the GST rules for hospitals and pharmacies. The technical notes
for the developer are at the end.

## The short answer

Yes, it is possible. Tally accepts entries from other programs in its own file format (XML), either as a file the
accountant imports or sent over the network into a Tally that is open on a computer. Perinexa already keeps every
hospital bill, receipt, refund, pharmacy tax invoice, credit note and supplier debit note with their numbers and
amounts, so the entries can be made from what exists.

"Fully automatic" has three limits that no software can remove:
- Tally must be open, with the hospital's company loaded, on the computer that receives the entries.
- Only money that Perinexa knows can go: bills, receipts, pharmacy sales and returns. Salaries, rent, the canteen,
  doctors' payouts and the hospital's non-medicine purchases stay with the accountant. Supplier invoices for medicines
  can follow later, once Perinexa records the GST on them (today it does not).
- The accountant still checks what arrived and clears the entries Tally refused, exactly as with a bank feed.

Recommended path: **Step 1, a Tally file** that the hospital admin downloads for a period and the accountant imports
(works anywhere, nothing new to install, like the e-invoice file today). **Step 2, a small helper program on the
accountant's computer** that fetches the waiting entries from Perinexa every few minutes and hands them to Tally, so
nobody downloads anything. Step 1 remains the fallback when the helper is off.

## Before anything is built: three money matters found during this study

These matter whether or not Tally is linked. None changes the code until the owner and the accountant say so.

1. **Medicine GST rates changed on 22 September 2025** (56th GST Council; Notifications 9/2025 and 10/2025 – Central
   Tax (Rate)). The 12 % rate no longer exists for goods: all drugs and medicines are 5 %, 36 named life-saving drugs
   are nil, and 18 % remains only for non-medicine items a pharmacy may sell (disinfectants and hand sanitiser,
   sunscreen and cosmetics, mouthwash, deodorant, liquid handwash, nicotine gum). Perinexa's medicine list still
   offers 0 / 5 / 12 / 18 % and **a new medicine starts at 12 %** (`server/src/pharmacy/pharmacyRules.js`,
   `server/src/models/Pharmacy.js`, `client/src/pages/pharmacy/PurchasesPage.jsx`). The pharmacist can pick 5 % by
   hand, but the default is wrong and the 12 % choice invites mistakes. Recommended: the accountant confirms, then the
   list becomes 0 / 5 / 18 % with 5 % as the default (a small change, with the tests that assume 12 % updated).
2. **A room costing more than ₹5,000 a day carries 5 % GST** (not ICU or NICU; since 18 July 2022, still in force on
   16 Oct 2026). Perinexa bills hospital services with no GST (owner, 3 Oct 2026). That is right only if no private
   room costs more than ₹5,000 a day. If one does, the hospital bill needs a GST line for that room and the hospital
   itself needs a GST registration recorded in the app. **Owner, 16 Oct 2026: no room costs more than ₹5,000 a day.**
3. **Medicines given to admitted patients** are invoiced with GST (owner, 3 Oct 2026). Most tax rulings treat medicines
   supplied by the hospital's own pharmacy during a stay as part of the exempt treatment, **if the hospital and the
   pharmacy are one GST registration and one composite bill is raised**. If the pharmacy has its own GSTIN, the
   current GST invoice is the defensible choice. This has been an open question for the accountant since 3 Oct 2026
   and it decides which Tally account these invoices go to.

## The owner's decisions (16 Oct 2026)

The owner accepted the recommended default for decisions 2 to 8 and chose to build now.

| # | Question | Decision |
| --- | --- | --- |
| 1 | **When** | **Built now** (owner, 16 Oct 2026), an exception to the feature pause like the ultrasound reports; the developer reviews it after the fact |
| 2 | **How Tally is reached** | Step 1 a Tally file (download and import). Step 2 a helper program on the accountant's computer. **Not** a direct connection from the Perinexa server into Tally: Tally's receiving door has no password, so it must never face a network Perinexa's server is on, and where Perinexa will be hosted is not yet decided |
| 3 | **Patient names in Tally** | **No.** Only bill, receipt and invoice numbers, dates, amounts and account names leave Perinexa. The patient number (P-000045) in the entry's note is optional. No item names, no lab test names, no medicine names, no doctors' names, no reasons typed by staff. Tally files and the accountant's computer are outside Perinexa's protection |
| 4 | **One account for all patients** | **Yes:** one "Patients" account in Tally, not one account per patient (privacy; Perinexa keeps the per-patient detail) |
| 5 | **What goes** | Hospital bills, receipts, deposits and refunds; pharmacy tax invoices, counter payments and credit notes; debit notes to suppliers. Supplier purchase invoices later (see 12) |
| 6 | **Corrections** | Perinexa never changes an entry already sent. A removed item, a changed discount, a cancelled bill or a return becomes a new reversing entry dated the day of the change |
| 7 | **Who runs it** | The hospital admin (like today's accountant exports and the e-invoice file). No accountant login in Perinexa for now |
| 8 | **Scope statement** | Everything outside bills and pharmacy stays manual in Tally: salaries, rent, canteen, ambulance, doctors' payouts, hospital-store purchases |

## Questions for the accountant (the owner passes these on)

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | Which Tally: TallyPrime version (Help → About), Silver or Gold, the Edit Log build or the normal one, and where it runs: the accountant's own PC, a PC in the hospital, a rented "Tally on cloud" desktop, or Tally's own Cloud Access | Decides file vs helper program and the exact format. XML works on every TallyPrime; JSON only from release 7.0 |
| 2 | Is the hospital a company (Private Limited)? | Companies must use Tally's Edit Log build (audit trail rule, 1 April 2023). Proprietorships, partnerships, LLPs and trusts need not |
| 3 | Is the pharmacy a separate GST registration from the hospital, or one GSTIN for both? Is the hospital itself registered? | Decides the GST treatment of medicines for admitted patients (matter 3 above) and whether the hospital bill must be a "bill of supply" |
| 4 | Does any non-ICU room cost more than ₹5,000 a day? | Matter 2 above |
| 5 | Books kept as sales plus receipts (every bill is income when raised) or receipts only (income when paid)? | Changes every entry. Recommended: sales plus receipts |
| 6 | One Tally entry per bill, receipt and invoice (recommended), or one daily total for cash patients? | Sales to business buyers must be one entry per invoice in any case (GST returns) |
| 7 | The exact Tally account names for: each billing group (Consultation, Procedure, Scan, Lab test, Inpatient, Other), the pharmacy sales accounts per GST rate, Output CGST and SGST, Cash, Bank for UPI, Bank for card, each insurer or scheme, Patient deposits, Discount allowed, and each supplier | Perinexa will use the names exactly as typed; a wrong letter makes Tally refuse the entry |
| 8 | Deposits at admission: a "Patient deposits" account (money owed back until discharge) or against the Patients account? Inpatient bill posted at discharge (recommended) or daily? | Decides when a stay becomes income |
| 9 | Insurance and schemes (PM-JAY, MJPJAY, private TPAs): today reception records "paid by insurance" when the claim is made, not when the money arrives, and nothing records the 10 % tax deducted at source or amounts refused. Should Perinexa post the claim as money due from the insurer, with the accountant recording the bank receipt in Tally? | Otherwise Tally's bank book and Perinexa's daily summary will disagree |
| 10 | A discount given on the whole hospital bill also reduces the pharmacy invoice line, which already carries GST. Allowed as a goodwill discount (the law today treats it as a commercial credit, GST unchanged), or should discounts on medicines be made only in the pharmacy with a credit note? | Recommended: only in the pharmacy; this needs a small code rule |
| 11 | Medicines issued to admitted patients: taxable pharmacy sale (as now) or exempt part of treatment? | Matter 3 above |
| 12 | Supplier purchases: should they reach Tally at all? If yes, is the rate typed in Perinexa the price before GST, and may Perinexa start recording each supplier invoice's total and its CGST, SGST or IGST for input tax credit? | Today purchases carry no GST amounts, so they cannot be posted correctly |
| 13 | Returns to suppliers: does each supplier give a credit note, or expect the pharmacy's own invoice for the return? | Perinexa prints a debit note with GST; the accountant confirms the document per supplier |
| 14 | Does the hospital plus pharmacy take in more than ₹5 crore a year (exempt income counts)? | Then e-invoices are compulsory for pharmacy sales to businesses; the e-invoice file exists but has never been uploaded |
| 15 | Should medicine HSN totals go to Tally for the GST return's HSN table (still no medicine names)? Doctor-wise income as Tally cost centres (doctors' names would then go)? | Recommended: no, until asked |
| 16 | Up to which date are the books closed each month, and does a new Tally company start each financial year? | Corrections to closed periods are dated on the day of the change; a new company changes where entries go |
| 17 | Who looks at the entries Tally refused, and how quickly: the hospital admin or the accountant? Would the accountant sign a monthly control sheet from Perinexa (totals per account) before filing GST? | Keeps the two systems in step |

## How it will work (recommended design)

### 1. What becomes a Tally entry

| In Perinexa | In Tally | Money moves |
| --- | --- | --- |
| Hospital bill – outpatient at the end of the day, inpatient at discharge (live items less the discount) | Sales entry (service, no GST) carrying the bill number | Patients ← one income account per group (Consultation, Procedure, Scan, Lab test, Inpatient, Other); the discount to Discount allowed |
| Payment or deposit (receipt R-000045) | Receipt entry; for money "paid by insurance" a Journal (an insurer's account, not cash) | Cash, Bank (UPI), Bank (card) or the insurer's account ← Patients (a deposit: ← Patient deposits) |
| Refund (also an R- number) | Payment entry (a Journal for an insurer) | The reverse |
| Pharmacy tax invoice PH-000321 (counter sale or issue to a ward) | Sales entry with GST | Patients, "Pharmacy counter customers" or the business buyer's own account, named "Business name (GSTIN)" ← Pharmacy sales 0 / 5 / 18 % and Output CGST and SGST, from the invoice's own tax table |
| Counter payment or refund (a walk-in or a business buyer) | Receipt or Payment entry | Cash, UPI or card ← the same account the invoice went to |
| Pharmacy return (credit note CN-000012) | Credit note with GST | The reverse, per rate |
| Return to a supplier (debit note SR-000007) | Debit note | Supplier ← Purchases returned, Input CGST and SGST (or IGST) |
| Item taken off, discount changed, bill cancelled or lowered after it was sent | Credit note or reversing entry dated the day of the change | Never an edit of the old entry |
| Supplier purchase invoice PU-000088 | Purchase entry, **later** (Step 3) | Needs the supplier invoice total and GST first |

The medicine line that Perinexa puts on a patient's hospital bill ("Pharmacy – invoice PH-…") is **left out** of the
hospital Sales entry, because the same money arrives through the pharmacy invoice with its GST. Her receipt still clears
the shared Patients account for both. Nothing is counted twice.

Every entry carries Perinexa's own number (B-, R-, PH-, CN-, SR-) and a unique identifier, so an entry sent twice is
recognised by Tally and overwritten rather than doubled. Tally's own numbering stays untouched: the entries use their own
voucher types ("Perinexa Sales", "Perinexa Receipt" and so on) with Perinexa's numbers, if the accountant agrees.

### 2. What never goes to Tally
Patient names, phone numbers and addresses; item names (so the neutral "Lab test (confidential)" label is never even
needed: no words leave, only account names); medicine names, batches and expiry dates; doctors' names (unless cost
centres are chosen); reasons typed for discounts, removals and cancellations; insurance policy, claim and PM-JAY
numbers; walk-in customers' names. Business buyers go by name and GSTIN because the GST return needs them; insurers and
schemes go by name. The fetal-sex protection and the HIV protection are untouched because no free text is sent.

The existing "Export for the accountant" files (CSV) carry patient names, item names and medicine names. Once the Tally
link exists they can be narrowed to the same rule (a separate, small change).

### 3. Four ways to reach Tally, and the choice

| | A. A file | B. Perinexa's server sends to Tally directly | C. Helper program on the accountant's PC | D. A paid middle service |
| --- | --- | --- | --- | --- |
| How | Admin downloads a Tally file for a period; accountant imports it (Import → Transactions) | Server posts entries over the network into the open Tally | A small program next to Tally fetches waiting entries from Perinexa over a secure link and hands them to Tally on the same PC, then reports back | A company's connector does what C does, for a monthly fee |
| Works when Perinexa is hosted outside the hospital | Yes | **No** (needs the same network or a VPN) | Yes | Yes |
| Works with "Tally on cloud" | Yes | No | Yes (through Tally's local sync client) | Depends |
| Tally's door opened to a network | No | **Yes, and it has no password** | No (stays on the PC) | Usually no |
| Perinexa learns what Tally accepted | Only when told | Yes | Yes | Yes |
| New software on the accountant's PC | None | None | The helper and its runtime | The vendor's connector |
| Running cost | None | None | None | Monthly fee; another company holds the hospital's money data |

Recommendation: **A first, then C.** B is not recommended (an unprotected door, and the hosting decision is still open).
D is not recommended (cost, and a third company holding the data).

### 4. The hospital admin's screens (Billing → Accounts, admin only)
- **Account names:** the accountant's exact Tally names for every group, payment mode, GST rate, insurer and supplier,
  the Tally company name, the date the books start in Perinexa, and the date up to which the books are closed. Saved
  with who changed it and when; the audit log records that the names changed, never the names.
- **Prepare a batch (Step 1):** choose the period (default: the day after the last batch up to yesterday). Perinexa
  first lists what would stop the import: account names not filled in, items still marked "Price not set", entries
  dated before the books start, open inpatient bills. Then **Download Tally file** makes batch TB-000001, records every
  entry as "Sent to Tally", and keeps the file so the same download returns the same file. A one-time **Download
  account names file** creates the accounts in Tally first.
- **Sent to Tally** shows on each bill and invoice, with the batch number.
- **Exceptions:** entries Tally refused, with Tally's own words ("Voucher totals do not match", a missing account, a
  date out of range), and the actions Retry, Mark imported by hand, or Skip with a reason (all in the audit log).
- **Control sheet:** totals per Tally account for a month, to compare with Tally before the GST return.

### 5. The helper program (Step 2)
One small program file installed in a folder on the accountant's Windows PC, started at login and repeated every five
minutes. Each round: check that Tally is open with the right company; fetch up to fifty waiting entries from Perinexa
with a key the hospital admin created (shown once, can be cancelled any time); hand each to Tally on the same PC; report
back what Tally said. Perinexa shows "Helper last seen" on the Accounts screen. If the PC is off, entries wait; Step 1's
file remains available. Nothing from outside ever connects into the hospital's network.

### 6. Who does what

| Role | Tally link |
| --- | --- |
| Hospital admin | Account names, batches, exceptions, the helper's key, the control sheet |
| Reception, pharmacist | Nothing new; their work makes the entries by itself |
| Doctors, RMOs, nurses, lab, sonologist, referral desk | Nothing |
| Super admin | Nothing (no money figures of a hospital, as before) |
| The accountant (outside Perinexa) | Creates the Tally accounts with the agreed names, imports the file or keeps Tally open for the helper, clears exceptions in Tally, checks the control sheet |

## Build order (each step tested and committed; developer's review before main)
0. **Decisions first.** The owner's eight decisions and the accountant's answers; the GST rate list and default put
   right (matter 1); the developer exports one sales entry, one receipt, one credit note and one debit note made by
   hand in the accountant's own TallyPrime (a scratch company) and compares them with what Perinexa will write.
1. **Step 1, the file:** the accounting entries worked out from bills and invoices (a pure module, like the e-invoice
   file); the Tally XML writer (string templates, no new library); the entries and batches as new hospital-separated
   records; the account-names settings; the Accounts screens; "Sent to Tally" marks; the exceptions list; tests with
   golden files. Purchases excluded.
2. **Step 2, the helper:** the helper program (one file, no packages), two server endpoints with a per-hospital key,
   the sync screen, a fake Tally in the tests.
3. **Step 3, later:** supplier purchases (after the invoice total and GST are recorded), HSN totals if asked, the
   insurance "claim sent / money received" steps, the monthly control sheet, narrowing the CSV exports.

## Not included
- Tally pulling data from Perinexa by itself (a Tally add-on written in Tally's own language), GST return filing, a
  connection to the e-invoice portal, bank statement matching, stock quantities in Tally (money only), payroll.
- Any change to how bills and pharmacy invoices are made today, except the small rules named above (medicine discounts
  only in the pharmacy; the GST rate list).

## Built on 16 Oct 2026 – step 1, the file

**Billing → Accounts** (hospital admin only), with four pages:
- **Batches**: what the next file would hold up to a chosen day (default yesterday), what stops it (missing company
  name, books-start day, account names; a day not yet over), what is left out for now (stay bills until discharge,
  bills with "Price not set", fees taken for later appointments, bills from before the books start), the new account
  names the batch introduces and the GST accounts the accountant must create – then **Make the batch**. The list of
  batches with their status.
- **One batch**: the two files to download – the **account names file** (only names not introduced before; imported
  first) and the **entries file** – the steps for the accountant, every entry with its lines, and **Mark the whole
  batch imported**. The same file is written again from the kept entries on every download (the same bytes).
- **Account names**: the Tally company, the day the books start, how medicines issued to admitted patients are booked
  (taxable, as printed, or exempt), and the accountant's exact names for income accounts, money accounts (cash, UPI,
  card, insurance; a scheme may have its own), Patients, Pharmacy counter customers, Patient deposits, Discount
  allowed, pharmacy sales per GST rate, the GST accounts, Purchase returns, and Perinexa's six voucher types.
- **Exceptions**: entries Tally refused (the admin records Tally's words), skipped entries (with a reason), and entries
  waiting; each can be sent again (it joins the next file with the same identifier, so Tally overwrites rather than
  doubles), marked imported, or skipped.
- **Control sheet**: totals per account for a month (waiting and imported entries), to compare with Tally.
- **Sent to Tally** on a bill and on a pharmacy invoice (hospital admin): each entry, its batch and status.

What becomes an entry is exactly the table under "How it will work", with these details settled while building:
- Entries keep each line's **role** (the account's job) as well as the account name used, so renaming an account later
  never makes a correction entry; the accountant renames the account in Tally too. An entry **sent again** after Tally
  refused it carries the account names as they are at that moment (a corrected name is the point of sending again).
- Only entries Tally has or will have count as sent: a refused or skipped first entry means the next batch posts the
  document whole. A change stamped after a batch's last day waits for a later batch, so no entry is dated before it
  happened; a back-dated bill is dated no earlier than the batch's first day.
- An entry's **key** is Tally's voucher number: the document's own number for its first entry (B-000123, R-000045,
  PH-000321, CN-000012, SR-000007; a walk-in's counter payment PH-000321/P1), then B-000123/S2, /CN1, /J1 for later
  changes and B-000123/DEP for a stay's deposits set against the bill at discharge. A change after sending is a Sales
  entry (more charged), a Credit note (less charged, a bigger discount, a cancelled bill) or a Journal (moved between
  accounts), dated the batch's last day.
- The bill-level discount is taken wholly on the hospital's side (Dr Discount allowed); the pharmacy invoice's GST is
  never touched by it (the law in force treats such a discount as a commercial credit).
- Perinexa never creates the **GST duty accounts** in Tally (their GST tags are not published); it names them and the
  accountant creates them. Everything else the first batch needs is in the account names file, including Perinexa's
  voucher types with manual numbering. Every account is created **without bill-wise details** (the entries carry no bill
  references; Patients is one shared account). A business buyer's account is named "Business name (GSTIN)" with its
  GSTIN and state in both the older flat tags and TallyPrime's registration lists; a supplier's account is its name as
  typed, with its GSTIN when known.
- The batch page tells the accountant the two Tally import settings to use: "Overwrite voucher when a voucher with same
  GUID exists" = Yes (so a file imported twice doubles nothing) and, for account names, "Behaviour of import if master
  already exists" = Ignore duplicates (an account the accountant already has is left as it is).
- Entries are kept for good (`TallyVoucher`), batches too (`TallyBatch`); both are in the operator export. The audit
  log gets batch and document numbers, counts and status words – never an account name or a note.
- Statuses: Waiting for Tally → Imported, Refused by Tally (with Tally's words) or Skipped (with a reason); a refused or
  skipped entry can be sent again or marked imported after all; an imported one can be marked refused after all.

**Still to do before real use** (the developer, with the accountant): step 0 of the build order – compare one entry of
each kind with an entry made by hand in the accountant's own TallyPrime (a scratch company) and adjust the tags if Tally
refuses anything (see "Still to verify" below); matter 1 (the medicine GST rates) was corrected on 21 Oct 2026 (0 / 5 / 18 %, default 5 %; `npm run fix:gst-rates`).
Known and accepted for now: Tally works its GST out from the taxable value per rate and may list a pharmacy invoice
under GSTR-1 "mismatch in tax amount" by a paisa (Perinexa's per-line rounding) – the accountant resolves it as "accept
as is" or allows a small tax difference in Tally; the day the books start must be on or after the Tally company's
"Books beginning from" date. Not built: step 2 (the helper program) and step 3 (purchases, HSN totals, insurance
settlement steps, narrowing the CSV exports). How to test it in the browser: `docs/PROGRESS.md` → "How to test the
Tally file".

An independent review of the code on 16 Oct 2026 (five lenses, every finding checked) led to the corrections above
(business buyers' payments on their own account, deposits of a cancelled stay, dates of back-dated and late changes,
resends with corrected names, a refused first entry not counted as sent, insurance money as a journal, the party line of
an entry chosen by role, batch creation cleaned up on failure). For the developer: each preview and batch rescans every
bill and entry since the books started (a change watermark would be the next improvement), and the review's full
notes on the Tally tags still to prove live are in the "Still to verify" list.

---

## For the developer (technical notes, 16 Oct 2026)

### Verified about Tally (official pages unless marked)
- Releases: TallyPrime 7.2 (12 Oct 2026), 7.1 (20 May 2026), 7.0 (19 Dec 2025, adds native JSON import/export over the
  same port), 4.0 (27 Nov 2023, adds Excel import). The download page still offered 7.0 on 16 Oct 2026, so the
  accountant may be on anything from 4.x up. XML import exists in every release and is the baseline.
- HTTP listener: `Alt+Z (Exchange) → Configure → Client/Server Configuration` (older pages: `F1 → Settings → Advanced
  Configuration`), role Both/Server, port 9000 (shared with ODBC), restart needed; at least one company must be loaded.
  **No authentication, token, TLS or IP allow-list exists**; Tally's own "secure WebSocket" reference architecture
  puts authentication in the integrator's layer and forwards to `http://localhost:9000`. Security Control (company
  login) does not gate requests. Hence option B is rejected and option C talks to localhost only.
- Envelope: `ENVELOPE/HEADER(VERSION 1, TALLYREQUEST Import, TYPE Data, ID Vouchers)/BODY/DESC/STATICVARIABLES/
  SVCURRENTCOMPANY + DATA/TALLYMESSAGE/VOUCHER` (or the `Import Data` + `IMPORTDATA/REQUESTDESC/REPORTNAME Vouchers`
  form). Dates `YYYYMMDD`. `ISDEEMEDPOSITIVE Yes` pairs with a negative `AMOUNT` (debit), `No` with positive (credit);
  debits must equal credits to the paisa or Tally answers `LINEERROR "Voucher totals do not match"`. Service bills are
  "accounting invoices": `PERSISTEDVIEW Invoice Voucher View`, `ISINVOICE Yes`, `LEDGERENTRIES.LIST` only (no stock
  items). Receipts use `ALLLEDGERENTRIES.LIST`. Bill-wise references via `BILLALLOCATIONS.LIST` (`New Ref`, `Agst Ref`,
  `Advance`, `On Account`). Masters: `REPORTNAME All Masters`, `LEDGER Action=Create` with `NAME` and `PARENT`; masters
  before vouchers; names matched exactly (case, spaces, `&` as `&amp;`). **No official GST sales voucher sample
  exists**; Tally's advice is to create the voucher in the UI and export it as XML, then copy the tags (build step 0).
- Response: `STATUS 1/0`, counters `CREATED ALTERED DELETED LASTVCHID COMBINED IGNORED ERRORS CANCELLED`, `LINEERROR`
  text, `DESC not found` for a missing master; sometimes nested under `IMPORTRESULT`, so parse both. Exceptions show
  in Tally under `Alt+O (Import) → Exceptions` and `Alt+Y (Data) → All Exceptions`; the log file is `Tally.imp`.
- Idempotency: `REMOTEID` on `<VOUCHER>` is the integrator's "Voucher ID". Per Tally's FAQ a voucher whose ID comes from
  another system is imported once and a re-send with the same ID overwrites; a voucher without `REMOTEID` duplicates
  on every import. Field reports (TallyPrime 7.1, 2026, unofficial) agree: same `REMOTEID` re-sent gives
  `CREATED 0, ALTERED 1`; the value is only readable back through a TDL collection (`$RemoteGUID`), not in a Day Book
  export; `ACTION=Alter` keyed by `REMOTEID` creates a new voucher instead; an ID used in a refused import must not be
  reused. **Treat Perinexa's own unique key as the real guard** and `REMOTEID` as belt and braces.
- Excel import takes `.xls`/`.xlsx` only; a CSV must be re-saved in Excel first (Tally FAQ). Perinexa has no XLSX
  library, so the file format is Tally XML (no dependency), not CSV.
- Edit Log: the "TallyPrime Edit Log" build cannot be disabled; imported vouchers are logged as "Created due to
  Import"; the MCA audit-trail rule (Companies (Accounts) Rules 2014, Rule 3(1) proviso, FY from 1 April 2023) binds
  companies only, not LLPs, partnerships or proprietorships.
- Vouchers dated before the company's books-beginning date fail with "The date is out of Range".

### Verified about GST (primary texts where stated)
- Notification 9/2025-Integrated Tax (Rate), 17 Sept 2025, in force 22 Sept 2025: schedules 5 / 18 / 40 / 3 / 0.25 /
  1.5 % and a transitional 28 % (tobacco); no 12 % schedule. Chapter 30 (3003, 3004, 3005, 3006) at 5 %; 36 drugs nil
  (Notification 10/2025); 40 % holds no pharmacy item; 18 % survives for 3808, 3304, 3306, 3307, 3401, 2404, 4014,
  7017, non-medical 9025. The 57th Council (8 Oct 2026) changed no medicine rate. Code: `GST_RATES` should become
  `[0, 5, 18]` with default 5 (`pharmacyRules.js:12`, `Pharmacy.js:26`, `PurchasesPage.jsx:305,402`, docs); about 20
  tests hard-code 12. Rates were introduced on 3 Oct 2026 (commit 9ec64de), after the change, so no legacy 12 % data
  exists.
- Room rent above ₹5,000/day (non-ICU): Notifications 03/2022 and 04/2022-CT(R), effective 18 July 2022, 5 % without
  ITC; untouched by every 2025–2026 notification and by the 57th Council. Perinexa has no ICU flag (`Admission.ward`
  is free text) and no tax field on `PriceItem`.
- Finance Act 2026 (assent 30 March 2026) sections 153–154 rewrite s.15(3)(b)/s.34 for post-sale discounts but are
  **not in force** (commencement by notification; CBIC repository still "yet to be notified" on 16 Oct 2026). Today a
  bill-level discount touching a PH invoice is a commercial credit: GST on the PH invoice unchanged, which is how the
  code already behaves (`pharmacyService.js:339-355` ignores the bill discount).
- TPAs deduct 10 % TDS on hospital payments (CBDT Circular 8/2009; now s.393(1) of the Income-tax Act 2025 from
  1 April 2026). Perinexa stores insurance payments at face value with no TDS field.
- E-invoicing applies at ₹5 crore PAN-wide aggregate turnover including exempt income, B2B only; B2C e-invoicing was
  still a pilot in the sources found (check GSTN advisories after June 2026 before relying on this).
- GSTR-1 Table 7 (B2C small) is a rate-wise total net of credit notes, so daily totals are legal for cash patients;
  B2B and credit notes to registered buyers are document-wise.

### Perinexa facts the design rests on
- Money is integer paise everywhere; `paise / 100` with two decimals is exact (`billing/money.js`, `pharmacy/gst.js`).
  Pharmacy GST is worked back from MRP per line with `CGST = floor(gst/2)`; Tally may flag paise mismatches as
  "uncertain transactions" when it recomputes tax: test with an odd amount in step 0.
- Stable keys: `Bill.number` B-, `payments[].receipt` R- (one series for payments, deposits and refunds),
  `PharmacyInvoice.number` PH- (one series for sales and issues), `returns[].number` CN-, `SupplierReturn.number` SR-,
  `Purchase.number` PU-; unique per tenant only (`Counter.nextNumber`), never reset per financial year, and gaps are
  possible because numbers are drawn before conditional writes (`billing.js:282-286`, `billingService.js:107-119`,
  `pharmacyService.js:215-259`). Walk-in counter payments have no receipt number (synthetic key `PH-…/P1`).
- Nothing on any document records an external reference or sync state; nothing in the repo mentions Tally.
- Mutation surface after a document exists: bill lines removed (flag), discount replaced in place (`$set`), payments
  append-only, cancel only when unpaid; a pharmacy return rewrites the bill line in place (`pharmacyService.js:312-319`,
  no-op if reception already removed the line); bed-day lines and ₹0 price fills are rewritten in place **lazily**
  (`freshBill`, `billingService.js:199-207`, run only on GET bill, payments, claim form, UPI link; reports and the CSV
  export read stale values). The event derivation must call `freshBill` first, refuse lines with `ratePaise 0`, and
  post deltas against the sum of already-synced events.
- Billing hooks swallow errors (`billing/hooks.js:7-13`): a charge can be silently missing; the feed inherits this.
- Dates: `bill.on` is a hospital day (`HOSPITAL_TIME_ZONE`, one value per server); visits may be back-dated a year,
  admissions back-dated, and an appointment fee opens a bill dated on a future appointment day
  (`billingService.js:308`). Decide the voucher date rule (bill day vs settlement day) and refuse dates before
  `booksFrom`.
- Insurance: `mode: 'insurance'` is one payment counted as collected when typed; no receivable, TDS or disallowance
  fields (`Bill.js:31-46`).
- Purchases store `ratePaise`, `mrpPaise`, `hsn`, `gstRate` (since 4 Oct 2026) and `totalPaise = rate × qty`; no
  supplier invoice total or tax; whether the rate is pre-GST is an unenforced convention (debit notes assume pre-GST).
- Patterns to reuse: `pharmacy/einvoice.js` (pure builder + `problems()` pre-check + admin-only audited download);
  `models/ReminderMessage.js` and `reminders/reminderService.js` (outbox with `status`, `attempts`, `claimedAt` and a
  stale-claim window: for Tally a stale claim must **not** resend blindly; verify by voucher number first); the
  WhatsApp/ABDM env-enum off/practice/live pattern (`config.js`) and the practice outbox for tests; CSV helpers
  (`csvCell`, BOM) as the model for XML escaping; `Tenant.billing` with `toJSON` strip and change history for the
  account-names block; `hospitalExport.js` KINDS (new models must be added or the export test fails);
  `AUDIT_ACTIONS` closed enum plus `auditDetails.js` trimming and `auditFormat.js` labels (enforced by a client test);
  `tenantScoped` plugin (it **does** cover `aggregate()` with a leading `$match.tenantId`; `docs/HANDOVER.md` section 6
  says otherwise and should be corrected).
- Not reusable: `StoredFile` (needs a patient and a file kind); keep the batch XML on the batch record or a new model.
- Agent (option C): cookie-JWT is the only auth today; the agent needs a bearer-token route mounted before cookie
  auth with its own rate limit, token stored as a SHA-256 hash, bound to one tenant, two endpoints only. Node on the
  accountant's PC is an install outside the project; packaging an `.exe` needs `postject` via `npx`: both need the
  developer's and the owner's agreement.
- No new dependency is needed for XML or JSON; `.xlsx` would need one.

### Still to verify on a scratch company (step 0)
`SVCURRENTCOMPANY` honoured on import with two companies open; `REMOTEID` as a non-GUID string (read back via TDL) and
the "Overwrite voucher when a voucher with same GUID exists" setting on a file imported twice; GST ledger tags on an
exported UI-made sales voucher; the party ledger tags (`PARTYGSTIN`, `LEDSTATENAME`, `GSTREGISTRATIONTYPE` and
TallyPrime's `LEDGSTREGDETAILS.LIST` / `LEDMAILINGDETAILS.LIST`, both written) read back from one buyer ledger; Tally's
spelling of the three union territories' names; `LEDGERENTRIES.LIST` vs `ALLLEDGERENTRIES.LIST` in invoice view; a
Journal with no party line, and a credit note's party credited in invoice view; the voucher type masters
(`NUMBERINGMETHOD Manual`, `PREVENTDUPLICATES`); UTF-8 text in the file (a hyphen is used in narrations; typed names
may hold any character); amounts with paise that Tally's tax recomputation disagrees with ("mismatch in tax amount");
parallel POSTs (vendors say Tally handles one write at a time; unverified); import when data is served by TallyPrime
Server; whether `ACTION=Delete` exists for vouchers (undocumented; use Cancel or a reversal).

### Key sources
Tally: help.tallysolutions.com pages `xml-integration`, `pre-requisites-for-integrations`, `sample-xml`,
`tallyprime-as-server`, `integration-initiated-from-tpas`, `import-data-faq`, `docs/faqs/faq/faq-import-and-export.htm`,
`data-exceptions-resolutions-in-tallyprime`, `tally-prime-integration-using-json-1`, `release-notes-tallyprime-7-2`,
`release-notes-tallyprime-7-0`, `release-notes-tallyprime-4`, `licensing-best-practices`, `secure-websocket-integration`,
`tally-prime/edit-log/edit-log-in-tallyprime-faq`. GST: gstcouncil.gov.in press release and FAQ of the 56th Council
(3 Sept 2025), Notification 9/2025-Integrated Tax (Rate), 57th Council press release (8 Oct 2026), Notification
04/2022-CT(R), Circulars 32/06/2018, 72/46/2018, 92/11/2019 and 251/08/2025-GST, Finance Act 2026 (incometaxindia.gov.in
copy), ICAI implementation guide on audit trail (2024), CBDT Circular 8/2009.
