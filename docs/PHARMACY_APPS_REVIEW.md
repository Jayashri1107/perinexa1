# What a pharmacy (medical store) program must have – and what the owner chose to add to Perinexa

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-pharmacy-apps-review`,
> commit 3dbc77af).** Written against the other Perinexa copy. Perinexa1's pharmacy has grown further: purchases
> (GRN), opening stock import, the sales register, supplier returns, the stock sheet and Tally (`pharmacyStock.js`,
> `pharmacyRegister.js`, `pharmacySupplierReturns.js`, `docs/PHARMACY_PLAN.md`, `docs/TALLY_PLAN.md`). Read
> "what exists" again against this code before building. The ideas list in this repository is
> `docs/IDEAS_FOR_LATER.md`. **Nothing is built**; when is for the developer and the owner to agree.

Written 10 Nov 2026 at the owner's request ("all features which are must for a medical or pharmacy software, compare
with Perinexa and tell which are missing"). "Medical" is read here as the medical store: the pharmacy counter and the
hospital's medicine stock. The pharmacy was built on 3–5 Oct 2026 (`docs/PHARMACY_PLAN.md`).
The same day the owner saw the list of 23 missing features, **chose 16 of them, added two that had been left out,
and gave the decisions of section 6**. The seven features not chosen were taken out of this note; the longer
first version is in the git history (commit `d03618a`).
Nothing here is built: the feature pause holds until the developer's health check. Product claims are from the
vendors' own pages, which are advertising; prices and rankings were not verified. Rule numbers of the Drugs Rules come
from secondary pages and were **not checked against the rule text** – the hospital's pharmacist should confirm each
one. A number in square brackets points to the source list in section 8, which also says which pages were read in
full and which only as a search summary.

## 1. What was looked at

| Kind | Products and documents | Where used |
| --- | --- | --- |
| Indian medical-store programs | Marg ERP [3]; GoFrugal [2]; eVitalRx [4]; 1pharmacy and MedCounter [5]; buying guides by Vyapar, Logic ERP, Accountune and CodingClave [6] | Retail chemists across India |
| Hospital pharmacy modules | OneCity's hospital pharmacy module (India) [1]; Malaysia's government pharmacy system PhIS – its manuals for ward requests and stock transfers [7]; the NIELIT description of a hospital store [8] | Hospitals with a central pharmacy and ward stocks |
| What hospitals abroad treat as standard | The American pharmacists' society (ASHP) on scanning a barcode before a dose is given, and its hospital survey [10] | Large hospitals, mostly US |
| Quality standards | NABH 6th edition, the medication chapter (a training summary, not the standard itself) [9]; look-alike and sound-alike medicines in India (Lancet Regional Health, 2024, through news reports) [13] | NABH-accredited hospitals |
| India's rules | A 2026 guide to a medical store's duties under the Drugs Rules [14]; a High Court case on missing registers [17]; CDSCO's recall guideline [11]; QR codes on packs (Schedule H2) and their 2026 extension [16]; the draft rule on CCTV in medical stores of 8 Sept 2026 [15] | Every licensed pharmacy |

## 2. What every pharmacy program is expected to have

The same list comes back in every product and buying guide [2] [3] [6]:

- **Fast billing** by name, generic name or barcode; a GST tax invoice with the drug licence number, HSN codes and
  the tax by rate; sale of a whole strip or of loose tablets.
- **Batch and expiry**: stock by batch, the earliest expiry sold first, expired stock blocked, warnings 30, 60 and
  90 days ahead, expired and near-expiry stock sent back to the supplier by batch.
- **The legal registers made by themselves**: Schedule H1, Schedule X and narcotic (NDPS) registers written at each
  sale and kept for the period the rules ask [14]. In a 2026 High Court case an inspection found sale bills missing
  and no separate H1 register [17].
- **Buying**: suppliers, purchase entry, purchase orders from reorder levels, returns to the supplier, the
  supplier's bill read from a file (Excel, CSV, PDF or a photo) instead of typed [3] [5].
- **Substitutes**: other brands of the same generic and strength when the asked brand is out [2] [3].
- **Money**: what each supplier is owed, profit, non-moving stock, day closing, GST reports for the accountant,
  sales by doctor [2].
- **Customers**: purchase history, bills and reminders on WhatsApp, credit accounts, loyalty points, home delivery
  [2] [3] [4].

A **hospital** pharmacy module adds [1] [7] [8]:

- Dispensing from the doctor's order on screen, never from paper; the sale on the patient's bill by itself.
- **Allergy and interaction warnings at the moment of dispensing** [1].
- A central store with **stocks in the wards, labour room, theatre and emergency**; a ward **asks on screen**
  (an "indent"), the pharmacist issues and the ward receives; consumption by department.
- Returns from the ward credited to the patient's bill with the batch put back.

NABH's medication chapter (11 standards) asks for safe handling of high-risk medicines, narcotics and look-alike,
sound-alike medicines, and for medication errors and adverse reactions to be reported [9]. CDSCO's recall guideline
expects the most serious recalls to reach retail level within 24 to 72 hours [11].

## 3. What Perinexa already has

Confirmed in the code on 10 Nov 2026 (`server/src/models/Pharmacy.js`, `server/src/routes/pharmacy*.js`,
`server/src/pharmacy/`, `client/src/pages/pharmacy/`):

- **Medicine list**: brand, generic, form, strength, unit of sale, HSN, GST rate, schedule (G, H, H1, X, narcotic),
  reorder level, up to 10 barcodes. Search by brand or generic name, or by scanning.
- **Buying**: suppliers with GSTIN and drug licence; purchase by batch with expiry, free quantity, price and MRP;
  purchase orders with "Suggest from low stock" and receiving against the order; returns to the supplier with a
  debit note.
- **Selling**: from her Perinexa prescription (matched to the stock list, quantity suggested) or to a walk-in with
  "prescription seen"; earliest expiry first; expired batches blocked; a warning within 30 days; never above MRP;
  a discount with a reason; the A5 GST invoice; the sale on her hospital bill, or cash, UPI or card at the counter.
- **Admitted patients**: issue to her stay, on her bill, with a tax invoice.
- **Registers**: Schedule H1, Schedule X and narcotic, printable for any period; a witness for counts and supplier
  returns of controlled medicines.
- **Returns from patients** with a credit note; write-offs; stock counts; every stock movement kept.
- **Reports**: low stock, expiry (90 days), stock value, sales by day and month, purchases by supplier, the GST
  summary, the accountant's export, the e-invoice file, the Tally file.
- **Links no separate pharmacy program has**: the doctor sees "in the pharmacy / low / not in stock" while
  prescribing; the medicine safety list warns the doctor about pregnancy, breastfeeding, the newborn, allergy,
  combinations and dose limits; the pharmacist sees the medicines only, never the diagnosis; the audit log.
- On the branches not yet in `main`: the hospital's formulary with a high-alert mark, and incident reports with a
  "medication" kind.

So the basics every buying guide lists are there. What follows is what the owner chose to add.

## 4. The owner's choice (10 Nov 2026) – 18 features

The numbers are those of the first list, so some are missing. **(clinical)** marks content the owner approves as the
doctor; all of it would start as DRAFT or empty.

### Needed before another hospital can start using it

| # | Feature | Today in Perinexa | Why it matters |
| --- | --- | --- | --- |
| PH1 | **Starting stock and the medicine list from a file** | The list starts empty; each batch enters only through a purchase | A hospital that joins has hundreds of medicines on its shelves on day one. Without this, they are typed one by one as invented purchases, which also spoils the purchase reports |
| PH2 | **Pack sizes** – buy by the box or strip, sell by the tablet | Everything is in units of sale; the pharmacist divides the supplier's strip price by hand | Every product has strip and loose sale [2]. Dividing by hand is where price and quantity mistakes come from |
| PH3 | **GST and discount on a purchase**, the supplier's credit note, a purchase register | A purchase keeps the price only. Noted before: purchases cannot go to Tally until their GST is recorded | The accountant needs the tax paid on purchases; the supplier's bill total cannot be checked against what was typed |
| PH4 | **The manufacturer's name** on a medicine, and from there on purchases | No such field | A recall is announced by manufacturer and batch. One guide lists the manufacturer among the particulars of the purchase record [14]; the pharmacist's answer through the owner (10 Nov 2026) is that it is not a legal particular of the registers, so no register column |

### Safety

| # | Feature | Today in Perinexa | Why it matters |
| --- | --- | --- | --- |
| PH5 | **A batch on hold, and "who received this batch"** | "Recalled" exists only as a reason for a supplier return; a recalled batch can still be sold until it is returned; no list of the patients it went to | CDSCO expects the most serious recalls done within 24–72 hours down to retail level [11]. The stock movements already hold the answer; nothing shows it |
| PH6 | **"Already sold" on a prescription**, and what is still owed to her | Her prescriptions are listed with no sign that one was sold before; a prescription can be sold twice without notice | Matters most for H1, Schedule X and narcotic medicines. Also shows "2 of 5 medicines given, 3 to come" |
| PH7 | **Warnings at the counter**: her allergies (**owner's decision 2**); a high-alert mark; look-alike, sound-alike pairs **(clinical – the lists are written by a doctor and the pharmacist together, owner's decision 6)**; a witness for writing off controlled stock | The doctor is warned while prescribing; the pharmacist sees no warning. A walk-in's outside prescription is checked by nobody. Writing off narcotic stock needs no witness | Hospital modules check allergies at dispensing [1]; NABH asks for look-alike and high-risk handling [9]; look-alike brand names are a known cause of errors in India [13] |
| PH8 | **Vaccines: the batch on her (or the baby's) record** (the fridge temperature log first listed with it is put off – owner, 10 Nov 2026) | A vaccine is a care-plan item with no batch | The batch belongs on the immunisation record and is what a recall asks for |

### Daily work

| # | Feature | Today in Perinexa | Why it matters |
| --- | --- | --- | --- |
| PH10 | **Substitutes** – other brands of the same generic and strength that are in stock, **only with the doctor's yes – the pharmacist asks and writes which doctor agreed – and never for the medicines on the doctors' list (owner's decision 3) (clinical)** | Search finds by generic name, but nothing offers "same medicine, other brand" when a brand is out | Every product has it [2] [3]; the sale is lost otherwise |
| PH11 | **What each supplier is owed** – bills, payments, credit days, debit notes set off | Purchases and returns are recorded; payments to suppliers are not | Standard in every product [4] |
| PH12 | **The ward asks on screen** (nurse or RMO), the pharmacist issues against the request | "From the ward's written request" – on paper | The core of every hospital module [1] [7]; ends retyping and the lost chit |
| PH13 | **Stock outside the pharmacy** – the places are set up by each hospital's doctor and admin (**owner's decision 4**) – with transfers and an expiry check of each place | One stock, in the pharmacy | Hospital modules keep sub-stores [1] [7]. An emergency tray with an expired ampoule is a classic inspection finding |
| PH14 | **Kits** issued in one step – each kit made by the hospital's doctor and admin (**owner's decision 4**); surgical items and consumables as their own kind | Each item is picked singly; consumables can only be entered as a medicine of form "other" | The same items for every delivery |
| PH15 | **Reports that are missing**: profit by medicine; non-moving and slow stock; value lost to expiry; days out of stock; consumption by ward; prescriptions filled at the hospital's own counter; antibiotic (H1) use; the counter's day closing by cash, UPI and card | Sales, GST, purchases and stock value only | "Visibility of non-moving products" and profit are in every product [2] [3]; the share of prescriptions filled in-house is a figure only a hospital system can give |
| PH16 | **The supplier's bill from a file**, later from a photo | Typed line by line | In every product [3] [5]. A photo read by AI needs a new add-on and sends the bill (no patient data) outside – the developer's agreement first |
| PH17 | **Reorder by what was used** in the last 30–60 days; the usual supplier of each medicine; the last price paid | A fixed reorder level; "Suggest" orders up to twice that level | Fixed levels go stale with the season |

### Added by the owner (first listed as "left out")

| # | Feature | Today in Perinexa | What to settle before it is built |
| --- | --- | --- | --- |
| PH24 | **Sales by doctor** – pharmacy sales by the prescribing doctor, for a period | The invoice keeps the doctor's name; no report adds it up | **Seen only by the pharmacist and the super admin (owner's decision 5)** – not the hospital admin, not the doctors. Totals only, no patient names: the super admin never sees patient data. Still to settle when built: whether sales on outside doctors' prescriptions are listed by the typed name |
| PH26 | **AI forecasting of demand** – a suggested order from the past months' use and the season | Nothing; the AI provider chosen for Perinexa is OpenAI | Build PH17 first: it gives most of the gain with no AI. Only medicine names and monthly quantities may be sent – never anything about a patient. A suggestion only: the pharmacist decides the order |

Not chosen by the owner, and taken out of this note: seven features of the first list (PH9, PH18–PH23). PH25 (the
pharmacy bill sent to her WhatsApp by itself) was added and then removed by the owner the same day – see section 5.

## 5. Left out on purpose

- **Loyalty points, home delivery, online orders, credit accounts for walk-ins**: for a retail chain competing on
  the street, not a hospital counter.
- **Bills sent to WhatsApp by themselves** (owner, 10 Nov 2026: removed): a bill lists her medicines, and medicines
  tell the illness – the HIV medicines above all – on a phone that is often shared in the family.
- **Robots and dispensing cabinets**: no gain at this size.
- **Filing GST returns or e-invoices on the portal from Perinexa**: the accountant uploads the files (owner's
  earlier decision).
- **A dashboard across hospitals**: the owner's decision is that units are separate hospitals.

For the owner to pass to the pharmacist, not software: a draft rule of 8 Sept 2026 would make CCTV compulsory in
medical stores that supply prescription medicines, recordings kept three months; it is still a draft [15].

## 6. The owner's decisions (10 Nov 2026)

1. **The list**: the 18 features of section 4, and no others.
2. **PH7 – the pharmacist sees a patient's allergies.** A change to who sees what: until now the pharmacist saw her
   medicines only. Taken as: when selling or issuing to a registered patient, the pharmacist sees her recorded
   allergies and a warning when a medicine matches one – and still nothing else of her record (not the pregnancy,
   the diagnosis, notes or results). Each viewing goes in the audit log, as her prescriptions do today.
3. **PH10 – a substitute only with the doctor's yes, and never for the medicines the doctors have finalised.** Each
   hospital's doctors keep a "never substitute" list; Perinexa ships it empty. For a medicine on it, no substitute is
   offered at all. **The pharmacist asks the doctor and writes which doctor agreed**; the name is kept on the sale.
4. **PH13 and PH14 – the places and the kits are decided by the doctor and the hospital admin.** Perinexa ships no
   list of places and no kits; each hospital sets up its own.
5. **PH24 – sales by doctor are seen only by the pharmacist and the super admin.** Not by the hospital admin and not
   by the doctors. Totals only.
6. **PH7 – the high-alert and look-alike lists are written by a doctor and the pharmacist together**: an entry counts
   only when both have agreed, as in the formulary.
7. **No pharmacy bills sent to WhatsApp by themselves** (PH25 removed), and **PH6 is on the list**.

The step-by-step note for the developer is `docs/PHARMACY_BUILD_NOTE.md`. Writing it brought up smaller questions,
which the owner answered the same day:

8. **PH24** – outside doctors' prescriptions appear in the sales by doctor by name.
9. **PH5** – no notice to her doctor when a batch is recalled; the pharmacist's list is enough.
10. **PH7** – the pharmacist is not asked for a reason before selling a medicine that matches her allergy; the
    warning is shown and the sale goes on.
11. **PH6** – selling a prescription line again needs a reason for every medicine.
12. **PH8** – the refrigerator's temperature log is put off.

And for the pharmacist and the accountant, through the owner: the manufacturer's name is not a legal particular of
the registers (PH4); loose tablets may be sold from a pack whose price does not divide evenly (PH2 – rounded down, so
never above the MRP); the pharmacy claims the tax on purchases back and purchases go to Tally (PH3); supplier
payments are entered in Perinexa (PH11).

One question is still open for the owner: the hospital admin already sees the doctor's name on each pharmacy invoice
and in the sales export – is hiding only the added-up report enough, or should the name leave the admin's export too?

## 7. Note for the developer

- PH1–PH4 change `Medicine`, `Purchase` and `StockBatch` (pack size, manufacturer, purchase GST) – best done
  together and before any hospital's real stock is loaded, since older purchases will lack the fields.
- PH5 needs no new data: `StockMove` already has batch, patient and invoice. It adds a hold on `StockBatch` that the
  sale, issue and stock-check paths must respect.
- PH6 needs no new data either: `PharmacyInvoice.visitId` ties a sale to a prescription. The list of her
  prescriptions (`GET /pharmacy/patients/:id/prescriptions`) gains, per medicine, what was already sold from it
  (less returns). Suggested: a second sale of the same line asks for a reason rather than being blocked.
- PH10: the sale line keeps the prescribed medicine, the brand given and the name of the doctor who agreed.
- **PH7 changes need-to-know access by the owner's decision 2** – when it is built it belongs in `docs/HANDOVER.md`
  section 9. The pharmacist's view is built in `routes/pharmacy.js` and must stay a narrow projection: allergies only,
  audit-logged, and nothing for a record that is closed or marked as a duplicate beyond what is shown today.
- PH8 and PH12 touch the inpatient and care-plan routes and the nurses' role.
- PH13 turns one stock into several: every `tenantId` + medicine query gains a location. The largest change here;
  PH12 and PH14 are simpler once it exists.
- PH24: `PharmacyInvoice.doctor` and `visitId` already hold the prescriber. An `aggregate()` needs its own `tenantId`
  match. Its readers differ from the other pharmacy reports (`PHARMACY_REPORT_ROLES` includes the hospital admin;
  this one is the pharmacist only). The super admin's copy belongs with the platform figures and returns totals per
  doctor and nothing that names or counts a single patient.
- PH26 goes through the existing AI provider code; what is sent must be reviewed like the Ask AI context. PH16
  (photo) needs a new library – her agreement first.
- The GST rates: on this branch a new medicine still starts at 12 %, a rate that ended on 22 Sept 2025; the fix
  (0, 5 or 18 %) was made in the developer's copy and should be confirmed there.
- Clinical content (the PH7 lists, the PH10 "never substitute" list) ships empty or DRAFT, like the formulary.

## 8. Sources

Read in full on 10 Nov 2026:
1. OneCity, hospital pharmacy module (vendor page, updated 1 Sep 2026) – https://onecity.co.in/hospital-pharmacy-software-bangalore
2. GoFrugal, pharmacy solution highlights (vendor blog, updated 16 Mar 2026) – https://www.gofrugal.com/blog/pharmacy-solution-highlights ; purchase import FAQ (search summary) – https://community.gofrugal.com/portal/en/kb/articles/faqs-purchase-import
14. OkCredit, do's and don'ts for medical store owners (2 Sept 2026; a secondary guide, its rule numbers unverified) – https://okcredit.in/blog/dos-and-donts-for-medical-store-owners/
15. GKToday on the draft amendment of 8 Sept 2026 (17 Sept 2026) – https://www.gktoday.in/health-ministry-proposes-amendments-to-drugs-rules-1945-for-schedule-h-h1-and-x-drugs/

Seen only as a search summary:
3. Marg ERP (vendor pages) – https://margcompusoft.com/retail/medical_store_software.html ; https://margcompusoft.com/retail/drug-inventory-management-software.html
4. eVitalRx (listings) – https://www.capterra.com/p/237227/eVitalRx/ ; https://apps.apple.com/app/id1637429769
5. 1pharmacy – https://1pharmacy.io/ ; MedCounter – https://www.techjockey.com/detail/medcounter
6. Buying guides – https://vyaparapp.in/blog/choose-right-pharmacy-billing-software/ ; https://www.logicerp.com/blog/?p=7658 ; https://www.accountune.com/pharmacy-billing-batch-expiry-guide ; https://codingclave.com/blog/best-pharmacy-software-india-2026
7. Malaysia PhIS manuals (internal indent, stock transfer) – https://phisportal.moh.gov.my/sites/default/files/phis_attachments_39556/U.MANUAL_INV_INTERNAL%20INDENT-9thE.pdf ; https://phisportal.moh.gov.my/sites/default/files/phis_attachments_39556/U.MANUAL_INV_STOCK%20TRANSFER-9thE.pdf
8. NIELIT, hospital management information system – https://nielit.gov.in/node/1758
9. NABH 6th edition, medication chapter: a training summary – https://sites.google.com/view/bcmchtraining/accreditation/nabh-6th-edition/03-mom-chapter ; NABH's course page – https://nabh.co/training/hco-full-accreditation-masterclass-6th-edition-chapter-3-management-of-medication-mom/ . The standard itself was not read.
10. ASHP survey and barcode statement – https://psnet.ahrq.gov/issue/ashp-national-survey-pharmacy-practice-hospital-settings-dispensing-and-administration-2011 ; https://www.pharmacytimes.com/view/ashp-survey-shows-growing-role-of-pharmacists-in-transitions-of-care-services
11. CDSCO, guidelines on recall and rapid alert – https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/biologicals/Guidelinerapid24.pdf ; https://www.raps.org/resource/indian-regulators-finalize-recall-system-requireme.html
13. Look-alike, sound-alike medicines in India – https://medicaldialogues.in/medicine/news/risks-of-look-alike-sound-alike-drugs-highlighted-in-indian-healthcare-landscape-128944 ; https://thesouthfirst.com/news/look-alike-sound-alike-medicine-in-indian-market-can-cause-significant-health-threat-lancet
16. QR codes on packs – https://medicaldialogues.in/news/industry/pharma/union-health-ministry-notifies-300-drug-brands-under-schedule-h2-details-102657 ; https://www.zelthy.com/blog/schedule-h2-expanded-drug-categories ; https://lexplosion.in/india-expands-schedule-h2-labelling-how-pharma-manufacturers-must-prepare/
17. LiveLaw, a Punjab and Haryana High Court case on a pharmacy's records – https://www.livelaw.in/high-court/punjab-and-haryana-high-court/ndps-act-pharmacist-licence-cancellation-excess-psychotropic-stock-548248

(Number 12 belonged to a feature that was not chosen.) Could not be read: the Logic ERP article "Top 10 best features
of medical shop billing software" (the address opened the blog's index).
