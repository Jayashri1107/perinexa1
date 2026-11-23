# Discharge and the stay bill: one Discharge screen for the developer to build

> **Perinexa1 copy (brought over 23 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-discharge-desk`, commits
> 49bfa1b and 11a5fec).** Written against the other Perinexa copy. Perinexa1 built the desk's side of a discharge on
> 9 Nov 2026 (`docs/IPD_DISCHARGE_BILLING_PLAN.md`): the final bill, the desk's discharge details, clearance and the
> gate pass, nursing per day and a charge for each signed ward round are already here. Read section 0 before
> anything else, and section 2 ("what exists") again against this code before building. The ideas list in this
> repository is `docs/IDEAS_FOR_LATER.md`. **Nothing of this note is built in perinexa1.**

Written 23 Nov 2026 for the developer, at the owner's request. The owner asked for the discharge and billing of an
inpatient to be made easier, saw how it works today and three options of growing size, and chose the largest:
**one Discharge screen per stay, reached from a Discharge tab**, which includes the two smaller options (the two sides
told about each other; charges that add themselves).

**Nothing is built.** The feature pause in `CLAUDE.md` still holds: when this is built is for the developer and the
owner to agree. Sections 2 to 7 are written engineer to engineer; sections 1 and 8 are the owner's part.

## 0. Perinexa1: what differs from this note (read in the code, 23 Nov 2026)

Sections 1 to 8 are the other copy's note, unchanged. Perinexa1 built the desk's side of a discharge on 9 Nov 2026
(`docs/IPD_DISCHARGE_BILLING_PLAN.md`; "IPD discharge and the IPD bill window" in `docs/PROGRESS.md`), so parts of
Stage A are here in another form and Stage B has a start. Read in the code only: nothing below was tried in the
browser.

**Already here – fit the note to it, do not build it twice**
- *A billing login.* `BILLING_ROLES` is `['receptionist', 'billing', 'admin']` (`billing/billingRules.js`). Where the
  note says "reception and the hospital admin", read "reception, billing and the hospital admin".
- *A stay bill has an end.* `Bill.final` (who and when) and `Bill.reopened[]` with a reason (`models/Bill.js`);
  `POST /api/billing/ipd/bills/:id/final` and `…/reopen` (`routes/ipdBilling.js`). A final bill takes no item
  (`refuseFinal` in `routes/billing.js`) and its bed and nursing days stop (`syncBed`). So Stage A's `Bill.closed`,
  `close` and `reopen` are not new here: use `final`. It can already be made with money due (decision 16). Two rules
  differ from the note: the final bill needs the desk's discharge details first, and only billing or the admin
  reopen it, never after the gate pass.
- *The desk's discharge steps.* After the doctor confirms the card the desk records the discharge details
  (`Admission.dischargeInfo`: Normal, DAMA, LAMA, DOR, Transfer; a death comes from the record), makes the final
  bill, takes the payment and clears her for leaving with a gate pass (`Admission.clearance`). Billing → IPD →
  Discharge lists every discharge by step: To record · Final bill due · To clear · Cleared
  (`client/src/pages/billing/IpdPages.jsx`). The pharmacy has its own Discharge clearance list (18 Nov 2026). The
  note's "Going home today" list and steps 3 and 4 of its Discharge tab belong inside these, not beside them.
- *Reception already sees who is going home, as a guess.* `GET /api/beds/desk` (`routes/beds.js`) counts a patient as
  going home once a discharge card draft exists, and lists who went home today (`DISCHARGES_VIEWED`). There is no
  planned day. The note's `Admission.goingHome` mark is new and should replace this guess, not add a second list.
- *The clinical side sees a little of the bill.* The Stays tab has a Discharge column, and a discharged stay's page a
  Discharge panel: the desk's details, "Final bill due" or "Final bill made", the gate pass, no amounts
  (`client/src/pages/inpatient/StayDischarge.jsx`). The one word for the bill while she is still in hospital, and
  the line above the confirm button, are new.
- *Some charges add themselves.* A stay bill's lines already come from `admission`, `nursing`, `round`, `scan` and
  `registration` besides those the note lists (`models/Bill.js`, `billing/billingService.js`): an admission charge
  (key `admission`), **nursing per day with the bed's days** (`syncNursing`, key `nursing`), and **one doctor visit
  for each ward-round note a doctor signs, with the doctor's name** (`chargeRound`, key `ipd_round`). Each only once
  the hospital admin has priced it.
- *Ward changes are kept.* `Admission.moves[]` as `{ fromWard, fromBed, toWard, toBed, by, byName, at }`, written by
  the bed board's transfer (`routes/beds.js`) and shown in the bill window's Bed transfers tab. Not the note's
  `{ ward, bed, from }`, and stays from before 9 Nov 2026 have none. Perinexa1 has a bed board (`models/Bed.js`,
  `Admission.bedId`), which the note leaves out on purpose.
- *The postnatal discharge checklist* (Clinical Requirements Group B, item 14, DRAFT) is built
  (`routes/dischargeChecklist.js`, `client/src/pages/inpatient/DischargeChecklist.jsx`): in section 6 it is the step
  between 1 and 2 now, not later.

**Still true here – to build**
- No delivery or operation charge from a confirmed note: reception types them (weak point 3).
- No RMO or duty doctor charge, and no packages (`docs/IDEAS_FOR_LATER.md`, "IPD packages").
- The bed line is one line at the first ward's price for the whole stay (`syncBed`): weak point 5.
- Nothing is checked or said when the card is confirmed: weak point 2.
- The day's list still matches every open stay bill ever made (`routes/billing.js`, about line 134): weak point 6,
  for the list.
- The discharge card's medicines use `MedicineRows` directly (`client/src/pages/inpatient/DocumentPage.jsx`), and the
  pharmacist's list of prescriptions reads visits only (`routes/pharmacy.js`, about line 952): both points of
  section 6 hold. The three built-in discharge sets are here under the same keys (`pn_normal_delivery`,
  `pn_caesarean`, `loss_after_evacuation`); `PrescriptionSet` has no mark for discharge.

**To settle with the owner before building**
1. **The doctor's visit.** Decisions 5 and 8 count it per day like the bed. Perinexa1 charges it for each signed
   round note (owner, 17 Oct 2026 – `docs/RECEPTION_V2_PLAN.md`). Both together would charge twice: it is one of
   the two.
2. **Who reopens a final bill.** Billing and the hospital admin today; the note lets reception do it too.
3. **Where the Discharge tab goes.** The patient record's tabs differ here (Admissions, Current stay, IPD bill, and
   an IPD tab for the desk), and the desk already has Billing → IPD → Discharge. Either one more place, or these
   made into the one place.

**Rules that read differently here**
- Section 7 says the super admin gets nothing of either side. In perinexa1 the owner's decision of 17 Nov 2026
  holds (`utils/platformAccess.js`, `CLAUDE.md`): Perinexa's own staff reach a hospital's patients and bills only
  while its admin allows support access. The new routes follow that rule through `platformHospitalGuard` like every
  other patient and bill route, and are made no wider.
- Lists leave off another department's patients (`departmentListed`, 9 Nov 2026): the Going home list too.
- Line numbers in sections 2 to 6 are the other copy's. For example the card's confirmation is at
  `routes/admissions.js` about line 387 here, and `syncBed` at `billing/billingService.js` line 163.

## 1. The owner's decisions (23 Nov 2026)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Which option | **Option 3**: one Discharge screen, on top of "the two sides connected" and "charges add themselves" |
| 2 | Where it lives | **A Discharge tab.** The owner left the line to Claude: on the patient record's tab line, **beside Stays** (why: section 6) |
| 3 | Who builds it | **The developer**, from this note. Nothing is built now |
| 4 | A discharge is confirmed while money is due | **Warn only.** The doctor is never stopped; reception sees her on a "Going home today" list |
| 5 | Charges that count per day by themselves | The bed (today), and **the doctor's visit, nursing, the RMO or duty doctor** |
| 6 | Packages | **Yes** – one price for a set number of days, extras on top |
| 7 | Twins or triplets | **One delivery charge**, however many babies; reception adds an extra item by hand if the hospital charges more |
| 8 | Which days the doctor's visit, nursing and RMO charges count | **As for the bed**: the day of admission counts, the day of discharge does not, at least 1 |
| 9 | The day of a ward change | **The new ward's price** |
| 10 | What a package may cover | **The bed for its days, the delivery or operation, the three daily charges.** Lab tests are charged on top |
| 11 | Ward medicines in a package | **No** – always a separate line outside the package |
| 12 | The baby | **Separate**: the mother's package never reaches the baby's bill |
| 13 | The name of an operation on the bill of a sensitive record or the Abortion type of care | **Only "Procedure"**, on screen and on paper, with its real price |
| 14 | The first text of "Course in hospital" | **From the notes, by rule.** No AI |
| 15 | Who marks "Going home" | **The doctor and the RMO**; nurses see it |
| 16 | A final bill with money still due | **Reception may make it**; it stays on the unpaid list |
| 17 | Discharge medicine sets | **Claude drafts, the owner corrects** – section 8; DRAFT until approved |

Decisions 7 to 17 are the owner's answers of the same day to the questions this note first left open.

Two things said to the owner when the options were shown turned out differently once the code was read; both are
corrected here and in section 6:

- *"All prints together"* – nobody holds both rights. A doctor has no billing and reception has no clinical records,
  so each side prints its own papers from the same tab. Nothing is weakened to make one button.
- *"Medicines from what was issued"* – what the pharmacy issued to the ward is what she was given in hospital, not what
  she takes home. The discharge medicines start from a prescription set or her last prescription, chosen by the doctor.

## 2. What exists today (read in the code, 23 Nov 2026)

**The stay**
- `server/src/models/Admission.js`: `admittedAt`, `ward`, `bed`, `reason`, `status: admitted | discharged`,
  `dischargedAt`, `dischargedByName`. One open stay per patient (index `one_current_stay`).
- `server/src/routes/admissions.js` (`/api/patients/:id/admissions`): admit, change ward and bed (`PATCH`), documents,
  the nursing chart. Access through `patientAccess` – see: medical details; write: her doctor or an RMO; chart: nurses
  too. **Reception cannot open a stay** (`assertCanView`).
- Documents – `models/ClinicalDocument.js`, `inpatient/docSchemas.js`: `admission`, `round`, `delivery`, `operation`,
  `discharge`. The discharge card holds `dischargedAt`, `finalDiagnosis`, `course`, `procedures`,
  `conditionAtDischarge`, `medicines`, `advice`, `followUpOn`, `followUpNote`. A new card starts with the provisional
  diagnosis, "Admitted for: …" and the delivery mode and operations (`startingContent`).
- **Confirming the discharge card is what discharges her** (`POST …/documents/:docId/sign`, `admissions.js:338`): the
  stay becomes `discharged` with the card's time. Only a doctor confirms; an RMO may write the draft. A confirmed card
  cannot be marked entered in error.
- Screens – `client/src/pages/inpatient/`: `PatientStaysTab.jsx` (the list, Admit), `AdmissionPage.jsx` (one long page:
  the stay, red flags, documents, nursing chart – no tabs), `DocumentPage.jsx` (write, confirm, print; the discharge
  card prints with Marathi or Hindi). `TodayPage.jsx` has "Waiting for your confirmation" (`routes/inpatients.js`,
  doctors, RMOs and nurses only).

**The stay bill**
- `server/src/models/Bill.js`: `kind: opd | ipd`, `admissionId`, `lines[]` (`source: auto | manual`, `ref.kind: visit |
  lab | bed | pharmacy | work | appointment`), `discount`, `payments[]` (`payment | deposit | refund`), `insurance`,
  `status: open | cancelled`. Totals are worked out (`billing/money.js` `totals`).
- `billing/hooks.js` → `billingService.js`: admission opens the stay bill with a bed line (`chargeAdmission`,
  `syncBed`); a lab order, a scan or procedure recorded as done (`routes/workDone.js`, groups `scan` and `procedure`
  only) and a pharmacy issue to the ward (`pharmacy/pharmacyService.js:276`, one line "Pharmacy – invoice …") go on the
  stay bill while she is admitted (`openBillFor`). Every hook catches its own error: **billing never stops clinical
  work**.
- Bed days – `money.js` `bedDays`: the day of admission counts, the day of discharge does not, at least 1. The line's
  quantity is brought up to date whenever the bill is read (`freshBill`).
- `routes/billing.js` (reception and the hospital admin only): items, discount, payments (a payment during a stay is a
  deposit and may be more than the balance), refund, cancel, insurance details, claim forms, UPI link, reports.
- Other readers of a bill, which any change to lines or states reaches: the Tally link (`tally/events.js` –
  `billVector` credits `income:<group>`, leaves out `ref.kind 'pharmacy'`; `depositsVector` sets the deposits against
  the bill once the stay is `discharged`), the claim form (`billing/claim.js`), the monthly income by group and by
  doctor, the CSV export, the hospital export, the audit texts (`client/src/components/auditFormat.js`).

**Six weak points**

| # | Weak point | Where |
| --- | --- | --- |
| 1 | The two sides do not know of each other: no bill state on a stay, no stay state for reception beyond "in hospital / discharged" on the bill, no list of who is going home | `inpatientView.js`, `billView` |
| 2 | Nothing is checked at discharge: money due, lines at ₹0, a delivery with no charge | `admissions.js` sign |
| 3 | The biggest charges are typed by reception: "Normal delivery" and "Caesarean section" are price items of group `inpatient`, which `workDone` does not offer, and confirming a delivery or operation note adds nothing | `builtInPrices.js`, `workDone.js:28` |
| 4 | No per-day charge but the bed; no packages | `syncBed` |
| 5 | A change of ward keeps the first ward's rate and name for the whole stay: `syncBed` only changes the quantity of the line it finds | `billingService.js:162` |
| 6 | A stay bill has no end: `status` stays `open`, lines can be added after she has left, and the day's list matches every stay bill ever made (`{ kind: 'ipd', status: 'open', on: { $lte: day } }`) | `routes/billing.js:124` |

Weak point 6 was read in the code, not run: a test with a stay discharged and paid last month should confirm it
before it is changed.

## 3. Suggested order

Three stages, one branch each, each useful by itself:

1. **Stage A – the two sides connected.** A planned discharge, the "Going home today" list, the bill as one word on
   the clinical side, the warning at confirming, and an end for the stay bill. Small; no change to how anything is
   charged.
2. **Stage B – charges add themselves.** Delivery and operation charges, the three daily charges, the ward change,
   packages. Touches money: Tally, the claim form, the reports and the export all read the same lines.
3. **Stage C – the Discharge tab.** One page that shows the steps of A and B in order, each person with their own
   steps, and a discharge card that starts fuller.

## 4. Stage A – the two sides connected

**What the user sees**
- *Doctor or RMO, on the stay:* "Going home" with a day (today by default), and "Not going home yet" to take it back.
- *Reception and the hospital admin, in Billing:* a **Going home today** list – the patient, ward and bed, the planned
  day, "in hospital" or the time the discharge was confirmed, the bill's total, paid and balance, and what is not
  ready (below). A stay stays on the list until its bill is closed.
- *Doctors, RMOs and nurses, on the stay:* the bill as **one word with its icon and colour** – Not ready, Balance due,
  Paid, To give back – and never an amount or an item (the owner's billing decision of 3 Oct 2026: no billing for
  clinical roles; `workDone` gives them names, never prices).
- *Confirming the discharge card while the word is not "Paid":* one line above the button – "Balance due on the stay
  bill. Reception sees her on the Going home list." The doctor confirms as today (decision 4).
- *Reception, on the stay bill after the discharge:* **Make the final bill** – also with money still due (decision
  16); it then stays on the unpaid list. After it the items and the discount are fixed; payments and refunds go on.
  "Open the bill again" asks for a reason.

**What is not ready** (worked out when read, never stored): a live line at ₹0; a bed line taken off by hand; and,
until Stage B is in, a confirmed delivery or operation note on the stay with no line of group `inpatient` or
`procedure` on the bill. The last one tells reception that a delivery or an operation took place – which reception
knows today, since it types that charge – but never which operation.

**Data**
- `Admission.goingHome: { on, by, byName, at } | null`.
- `Bill.closed: { by, byName, at } | null` and `Bill.reopened[]: { by, byName, at, reason }`. A field, not a third
  `status`: `status: 'open'` is read as "not cancelled" in many places (`pushLines`, the payments route,
  `appointmentFees`, `earlierInsurance`, both partial unique indexes).

**Routes**
- `PUT /api/patients/:id/admissions/:admissionId/going-home` `{ on | null }` – `assertCanEdit`, stay `admitted`.
- `GET /api/billing/going-home` – `BILLING_ROLES`; stays with `goingHome` set or discharged, whose bill is not closed.
- `POST /api/billing/bills/:id/close`, `POST …/reopen` `{ reason }` – stay bills only, the stay `discharged`.
- `pushLines`, line removal and the discount refuse a closed bill (409, "Open the bill again first").
- The stay's page payload (`admissionPage`) gains `bill: { word }`; any error reading the bill gives "not known",
  never an error on the stay.
- The day's list (`routes/billing.js:124`): stay bills of patients in hospital that day, discharged that day, paid on
  that day, or not closed.

**Access and audit**
- New audit actions: `ADMISSION_GOING_HOME_SET`, `BILL_CLOSED`, `BILL_REOPENED`, `GOING_HOME_VIEWED` (counts only, as
  `INPATIENTS_VIEWED`); each needs its sentence in `auditFormat.js`.
- The Going home list carries what `billView` already gives reception (name, number, phone, ward, bed, stay times)
  and nothing clinical: no reason for admission, no type of care, no document names.
- The bill word is new knowledge for nurses and RMOs. The owner agreed to it as part of Option 1; it is a word about
  the hospital's bill, not an amount.

**Tests**: the going-home mark by each role; the list for reception, refused for a nurse; the word for each bill state
and "not known" when the bill cannot be read; a closed bill refuses a line, a removal and a discount and takes a
payment; reopen needs a reason; the day's list with an old paid stay; hospital separation on every new query.

## 5. Stage B – charges add themselves

**Delivery and operation**
- Keyed price items `delivery:normal`, `delivery:assisted` (vacuum, forceps), `delivery:lscs`. The starting list
  already has un-keyed "Normal delivery" and "Caesarean section" that hospitals have priced: give those two their key
  in a one-time step rather than letting `ensurePriceList` add twins of them.
- Confirming a delivery note adds **one line, however many babies** (decision 7; `ref: { kind: 'delivery', id:
  doc._id }`, the doctor who confirmed for the report by doctor); a note marked entered in error takes it off
  (`removeLinesOf`). Hooks as in `billing/hooks.js`.
- The operation note gains "Charge for this operation": a price item of group `procedure` or `inpatient`, chosen by
  name, never with its price. Optional; confirming adds the line (`ref.kind 'operation'`). The field is not printed.
  `contentSchema` is strict, and notes confirmed before stay as they are.
- **A neutral name** (decision 13): on a sensitive record (`patient.sensitive`) or a stay of the Abortion type of
  care, the line added from an operation note is named **"Procedure"** when it is written – on the bill page, the
  print, the receipts and the export – with its real price and group, as `labLineName` does for the HIV test. The
  price item's id stays on the line and is not sent to the website (`lineView` does not send it today). What reception
  types by hand, and a procedure recorded through `workDone`, keep the names they have today. The owner's answer was
  about operation notes; a delivery charge keeps its name on every record.

**Daily charges** (decision 5)
- Price items `daily:doctor`, `daily:nursing`, `daily:rmo` beside `bed`, at ₹0 until the admin prices them. A hospital
  that does not charge one of them stops the item (`active: false`) and gets no line.
- `syncBed` becomes one function for every per-day line of a stay. The days are counted as for the bed (decision 8:
  `bedDays`).

**Ward change**
- `Admission.moves[]: { ward, bed, from }`, the first written at admission, one added by each `PATCH`. One bed line per
  ward, each with its own days and rate. **The day of a move counts for the new ward** (decision 9). A stay with no
  `moves` is one stretch, as today.

**Packages** (decisions 6, 10, 11, 12)
- A package is a price item of group `inpatient` with `package: { days, covers }`, where `covers` is any of `bed`,
  `delivery`, `operation`, `daily`. **Lab tests and the pharmacy's line are never covered**, and a package belongs to
  one stay bill: the mother's package never reaches the baby's bill. Perinexa ships none: each hospital's admin
  writes its own (as the owner decided for pharmacy kits).
- Chosen for the stay by reception on the stay bill, until the bill is closed: `Bill.package: { priceItemId, name,
  days, covers, by, byName, at }`, and one line for its price (`ref.kind 'package'`).
- A covered line stays on the bill with its real rate, marked `inPackage`, and **counts ₹0** (`amountPaise: 0`). A
  per-day line is split: the package's days in the package, the days beyond it charged. This keeps one rule true
  everywhere: **the sum of the live lines' `amountPaise` is the bill** – `totals`, `billVector`, the claim form, the
  reports and the export need no second way of adding up.
- Why the pharmacy's line stays outside (decision 11): that money reaches Tally through the pharmacy invoice with its
  own tax (`billVector` leaves it out), and a package price has no GST.
- Taking the package off, or changing it, puts the covered lines back to their amounts; each change is audited.

**What also changes**: `Bill` line `ref.kind` gains `delivery`, `operation`, `daily`, `package`; `lineView.from`; the
"added by itself" words on the bill page; the Tally entries of a stay that gets a package after charges were sent
(a credit note and a sale, through `classifyBillDelta` – to be tried with the accountant's file).

**Tests**: each delivery mode adds its line once, a cancelled note takes it off, a note confirmed twice adds nothing
more; a missing or stopped price item adds nothing and stops nothing; the days of each daily line at admission, across
midnight, at discharge; two wards; a package with fewer, equal and more days than the stay; a covered lab test ordered
after the package was chosen; the sums in `totals`, `billVector`, `claimSums` and the export for the same bill. A
delivery note with two babies adds one line. An operation line on a sensitive record and on an Abortion stay reads
"Procedure" in the bill view, the print payload and the export, and keeps its name on any other record.

## 6. Stage C – the Discharge tab

**Where** – on the patient record's tab line, `Overview · Care plan · Visits · Stays · Discharge · Lab and scans …`
(`PatientDetailPage.jsx`), route `/patients/:id/discharge`. Shown while she has a stay in hospital, and after it
until that stay's bill is closed. Why here and not as a tab inside the stay: reception opens the patient record (it
has the Bills tab there) but may not open a stay, and the point of the screen is that both sides look at the same
place. The stay's page and the Going home list link to it.

**The steps** – every step shows a word, who and when; the content of a step only to those who may see it today.

| # | Step | Who does it | Others see |
| --- | --- | --- | --- |
| 1 | Going home: the planned day | Doctor, RMO | The day |
| 2 | Discharge card: written, then confirmed | RMO or doctor writes; a doctor confirms | "Draft", or "Confirmed by … at …" – never its content |
| 3 | Bill checked: what is not ready, the package, the discount, **Make the final bill** | Reception, hospital admin | The bill word only |
| 4 | Payment: the balance taken, or the deposit given back; receipts | Reception, hospital admin | The bill word only |
| 5 | Papers: the discharge card (English, Marathi or Hindi); the final bill and receipts | Each side prints its own | "Printed" with the time |
| 6 | Follow-up: the card's date offered for booking | Reception, doctor, RMO, nurse (as Appointments today) | The appointment's day |

One payload, `GET /api/patients/:id/discharge`, built per role from the existing access functions (`patientAccess`,
`BILLING_ROLES`); the writes stay the routes of today and of Stage A. "Printed" comes from the stamps the print routes
already audit (`DOCUMENT_PRINTED`, `BILL_PRINTED`), kept on the document and the bill as a last-printed stamp.

**A discharge card that starts fuller** (clinical; the owner approves the wording; DRAFT until then)
- *Fill from the notes*, a button on the draft: the course written from the stay's own confirmed notes – the reason
  for admission, the delivery (date, mode) and operations (date, name), and each round's assessment by day – as text
  the doctor edits. Never filled in at confirming, never without the button. The text must pass the card's own
  fetal-sex guard (`safeText`): nothing about the babies beyond what a discharge card may say.
- *Medicines*: "Start from a set" or "As her last prescription"; the doctor changes the rows. The sets are the
  hospital's approved prescription sets (`PrescriptionSet`, drafts from `visits/builtInSets.js`); three of the
  built-in drafts are already written for discharge (section 8). Sets are offered by the patient's type of care
  today, and a mother is still `antenatal` when her discharge card is written (confirming a delivery note sets
  `lastDelivery`, not the type of care): the card should offer the sets marked for discharge that fit the stay's own
  notes – a delivery note, an operation note – so a set needs a mark such as `atDischarge`.
- *Medicine safety*: as far as the code shows, the discharge card's medicines do not get the medicine safety
  warnings of a visit – those are in `client/src/pages/visits/PrescriptionForm.jsx`, and the card uses `MedicineRows`
  directly. To be confirmed in the browser; if so, the card should warn as a visit does.
- *No AI draft* of the course (decision 14). The existing "Write a letter" (`routes/ai.js`, type `discharge`) stays
  what it is and is not wired into the card.
- The pharmacist's list of a patient's prescriptions reads visits only (`routes/pharmacy.js:415`): a confirmed
  discharge card's medicines should be offered there too, or the take-home medicines cannot be sold from the screen.

**Left out on purpose**: a "she has left the ward" time and a bed board. They belong with the patient timeline
(`docs/PATIENT_FLOW_PLAN.md`), which measures stages; the going-home mark, the card's confirmation, the final bill and
the last receipt give that plan four of its times for free. The postnatal and newborn discharge checklists
(PX-OBG-18, PX-NEO-02, PX-NEO-14 in `docs/CLINICAL_REQUIREMENTS.md`, Group B) are clinical forms waiting for their
manual pages; when built they are one more step between 1 and 2.

**Tests**: the payload for a doctor, an RMO, a nurse, reception, a hospital admin with no desk role, a pharmacist
(refused) and the treating doctor of a sensitive record; reception's payload holds no document content; the tab
appears and goes with the stay and the bill's closing; "Fill from the notes" with a delivery, with an operation only,
with words the guard refuses.

## 7. What must not change

- **Confirming the discharge card stays the only thing that discharges her**, and only a doctor confirms. No step of
  billing discharges, and no state of the bill stops a discharge (decision 4; `hooks.js`).
- **Hospital separation**: every new query starts with `tenantId`; the Going home list is a `find`, and if it becomes
  an `aggregate()` it needs its own `tenantId` match.
- **Need to know**: reception and the hospital admin get no clinical content through the tab or the list; clinical
  roles get no amounts, items or prices; the super admin gets nothing of either.
- **The neutral name for the HIV test** on every bill view and print (`labLineName`), also inside a package; and the
  new neutral "Procedure" of decision 13 wherever a line's name is shown, printed or exported.
- **The fetal-sex protection**: every new text field on a bill or a stay goes through `refuseFetalSex` or `safeText`;
  a package's name too.
- **The audit log**: every new write has its action with ids and amounts only, and its sentence in `auditFormat.js`.
- **A record closed after a death** keeps its open stay until the discharge card ends it (`patients/deathService.js`);
  the tab must work on a closed record.
- **Nothing is deleted**: a line taken off, a package changed and a bill opened again all stay readable.
- Tests only with `npm test` from the project root.

## 8. For the owner: discharge medicine sets (DRAFT) and what is left

All ten questions this note first left open were answered on 23 Nov 2026 (decisions 7 to 17 in section 1). What
remains is yours as the doctor: the medicine sets a discharge card can start from (decision 17).

**Already in Perinexa as DRAFTS** – three of the ready-made prescription sets are written for discharge
(`server/src/visits/builtInSets.js`; all sets are listed for review in `docs/PRESCRIPTIONS.md`). They are not
approved yet either:

| Set | Medicines |
| --- | --- |
| After normal delivery | Iron + folic acid 1 tablet a day and calcium + vitamin D3 500 mg twice a day, both for 6 months; paracetamol 500 mg when needed for 5 days |
| After caesarean section | The same iron and calcium; paracetamol 500 mg three times a day for 5 days; lactulose 15 ml at bedtime for 7 days. No antibiotic |
| After surgical evacuation for a miscarriage | Paracetamol 2 × 500 mg when needed for 3 days; iron + folic acid for 3 months. No antibiotic |

One point to check in the caesarean set: it has paracetamol alone. NICE NG192 (Caesarean birth) advises paracetamol
together with an anti-inflammatory painkiller such as ibuprofen unless there is a reason against it. Whether to add
it is your decision.

**Two new sets proposed** – not in the code. Written by Claude from published guidance, **not reviewed by a doctor**:
every medicine, dose and word is for you to correct.

*A. After a gynaecological operation (at discharge)* – for example hysterectomy, laparoscopy, myomectomy.

| Medicine | Dose | When | Days | Instruction |
| --- | --- | --- | --- | --- |
| Paracetamol 500 mg tablet | 2 | Three times a day, after food | 5 | For pain (1 g is for an adult over 50 kg) |
| Ibuprofen 400 mg tablet | 1 | Three times a day, after food | 3 | For pain; not with a stomach ulcer, kidney disease, or asthma made worse by such painkillers |
| Lactulose syrup | 15 ml | At bedtime | 7 | For soft stools |

- *Advice she reads:* Keep the wound clean and dry. Walk a little several times a day and drink plenty of fluids. Do
  not lift anything heavy for 6 weeks. Come at once for fever, redness, pain or discharge from the wound, heavy
  bleeding or a smelly discharge, pain or swelling in the legs, breathlessness, or if you cannot pass urine.
- *Notes for doctors:* no antibiotic – prophylaxis is one dose before the incision, and the WHO guideline on surgical
  site infection (2016) advises against continuing it after the operation (also ACOG Practice Bulletin 195, 2018).
  Paracetamol with ibuprofen after surgery: NICE NG180 (2020). A blood thinner is added by hand when her VTE score
  asks for it. The histopathology report is seen at the follow-up visit.

*B. After repair of a third- or fourth-degree tear (at discharge).*

| Medicine | Dose | When | Days | Instruction |
| --- | --- | --- | --- | --- |
| Iron + folic acid, calcium + vitamin D3 | – | As after normal delivery | 6 months | – |
| Paracetamol 500 mg tablet | 2 | Three times a day, after food | 5 | For pain |
| Lactulose syrup | 15 ml | Twice a day | 10 | Keep the stools soft; do not strain |
| Amoxicillin + clavulanic acid 625 mg tablet | 1 | Three times a day, after food | 5 | Complete the full course |

- *Advice she reads:* Keep the stitches clean and dry, and wash after using the toilet. Eat fruit and vegetables and
  drink plenty of fluids so that the stools stay soft. Start the pelvic floor exercises you were shown. Come at once
  for fever, more pain or swelling, a smelly discharge, or if you cannot hold wind or stools.
- *Notes for doctors:* RCOG Green-top Guideline 29 (2015) recommends a broad-spectrum antibiotic and laxatives after
  the repair, physiotherapy, and a review at 6 to 12 weeks. It does not name the antibiotic: **the medicine and the
  number of days here are a placeholder for the hospital's own choice.**

**What is left for you**
- Read and correct the five sets above. They stay DRAFT until you approve them, and none of them is offered on a
  discharge card before that.
- Decision 13 was about operations. Say if the delivery charge on a sensitive record should also be printed under a
  neutral name.
- Prices and packages are each hospital's own and are typed by its hospital admin.
