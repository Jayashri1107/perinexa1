# Progress

## Handover to a developer (from 5 Oct 2026)
The owner has hired a developer to make Perinexa ready for commercial use; she works with Claude. The plan, with the
timeline and a go-live checklist, is the "Perinexa Handover Plan" page the owner shares with her.
- **Online copy (step A2, done 5 Oct 2026):** the private GitHub repository `girishsolanke/perinexa` (git remote
  `origin`, branch `main`). Secret files (`server/.env`, `docs/TEST_ACCOUNTS.md`, `.mongo-data`) were never in git.
- **One main version (step A1, done 5 Oct 2026):** the work lanes (lane-a, lane-b, lane-c, threatened-antenatal) and
  two side branches were combined into `main` and the lanes removed. New features are paused until the developer's
  health check. Tests on the combined version: server 1,351 passed (4 skipped as usual), website 1,944 passed; the
  build works.
- **For the developer (steps A5 and A6, done 5 Oct 2026):** `docs/HANDOVER.md` (start here) and the section "Working
  with the developer" in `CLAUDE.md`.
- **Next for the owner:** contract with the developer (A3), service accounts in the company's name (A4), the kick-off
  meeting (A8).
- **31 Oct 2026 – scans booked by reception and ordered from the care plan; pharmacy papers (developer's requests –
  exceptions to the feature freeze, the owner's go-ahead to be recorded):** (1) **Reception → a patient → More → Book a
  scan:** the study, the doctor who asked for it (on paper), urgent, and a day and time if agreed. Reception types no
  clinical text. The scan waits as **To confirm**: not billed, not on the machine's worklist, not scheduled or done.
  (2) **Doctors and RMOs → Sonography → To confirm** (a tile on the dashboard too): open it, check the study, write the
  indication, **Confirm the scan** – it is then ordered (or scheduled for the agreed time) and goes on her bill – or
  **Decline** with a reason. (3) **Care plan:** a scan due in her plan has **Order the scan**; the order dialog comes
  filled in (the study worked out from the item's name, the item's name as the reason – the doctor checks both), and the
  row then shows "Scan ordered …: To schedule" with a link. The separate sonologist login and two-step approval (ideas
  17 and 22) stay out (owner, 19 Oct 2026). (4) **Pharmacy → Settings:** the store's own **address and phone numbers**
  (empty = the hospital letterhead's) on every pharmacy paper; the **tax invoice** redrawn as a pharmacy bill (store
  letterhead, bill details, numbered medicines with HSN, batch, expiry, MRP, GST, the sums boxed, amount in words, "For
  <store>" and the pharmacist's line); printed tables no longer turn into stacked boxes on A5 or A4 paper. **How to
  test:** as reception, open a patient → More → Book a scan → choose the doctor → Book the scan; as that doctor,
  Sonography → To confirm → open it → write the indication → Confirm the scan (her bill gets the scan). As a doctor, a
  pregnant patient → Care plan → a scan "Due now" → Order the scan → Order the scan. Pharmacy → Settings → type the
  store's address and phones → Save; Sold → a bill → Print → Tax invoice.
- **The ultrasound machine on the LAN is a separate, later part** (built and merged on 29 Oct 2026, `docs/USG_MACHINE_PLAN.md`):
  still to do with the hospital – the machine's make and model, Orthanc on the PC beside it, a test with a dummy
  patient, and the owner's approval of the DRAFT measurement matching and averaging rule.
- **31 Oct 2026 – Perinexa as an installable app (PWA; branch `installable-app`, at the developer's request):** the live
  site can be installed like an app on Android (Chrome → Install app), iPhone/iPad (Safari → Share → Add to Home Screen)
  and Windows/Mac (Chrome or Edge → the install button in the address bar). It opens in its own window with the Perinexa
  icon. `client/public/manifest.webmanifest` (name, colours, icons), `sw.js` (service worker), `offline.html` (shown
  without internet), the icons, and the tags in `index.html`. **No patient data is kept on the device:** the service
  worker never answers `/api` and never stores a page; sign-in, the 30-minute sign-out and every permission work as on
  the website, and each deploy updates the app by itself. The icons are made from the 128-pixel logo: a 1024-pixel or
  SVG logo from the designer would make them sharper. **How to test:** after the deploy, open app.perinexa.com in
  Chrome on a phone → menu → Install app.
- **29 Oct 2026 – the hospital's admission form, departments and floors (branch `admission-form`, at the developer's
  request from the hospital's paper forms – an exception to the feature freeze, the owner's go-ahead to be recorded):**
  (1) **Departments:** "General" and "Genetic Counselling" added; a doctor may be in **more than one** department
  (Hospital admin → Staff → the department list under a doctor's roles is a tick list). (2) **Admit a patient** (bed
  board, her record): **Department → Doctor in charge** (only that department's doctors; her assigned doctor to start
  with), **Referred by**, the attendant's **address**, and for a medico-legal case the **MLC number and date, the
  constable and the buckle number** besides the police station. Who may open her record is unchanged. (3) The printed
  **admission form** shows them, plus the paper form's lines for the doctors to **write by hand**: provisional and final
  diagnosis, two transfers (bed, class, date, time, CMO), surgery date, surgeon, anaesthetist and surgery name –
  reception never types medical details. The admission slip and the bed card show the doctor in charge. (4) **Beds by
  floor:** Hospital admin → Beds → Add beds has a **Floor**; the bed board and the setup list each ward under its floor
  ("2nd floor · Deluxe AC"); the same room type can be on two floors. Doctors are added by the hospital admin as staff
  (Staff → Add), each with their departments; beds as Floor + Ward or room type + bed or room numbers. **How to test:**
  Hospital admin → Beds → add "1st floor · General ward · G1-G10"; Staff → tick a doctor's departments; Beds → Admit →
  choose a department and see only its doctors; print the admission form.
- **29 Oct 2026 – the ultrasound machine on the LAN (branch `usg-machine`, merged into main on 29 Oct 2026 – an
  exception to the feature freeze at the developer's request; the owner's go-ahead to be recorded):** `docs/USG_MACHINE_PLAN.md`.
  (1) **Scan bridge** (`scan-bridge/`): a small program on a hospital PC next to Orthanc (the free DICOM receiver the
  machine sends to); it sends each finished study – the machine's structured report and a JPEG of each still picture –
  to Perinexa with the hospital's key, and writes today's ultrasound orders as the machine's worklist. (2) Hospital
  admin → **Ultrasound machine**: make the key (shown once), make a new one, switch off. (3) On a scan, **From the
  machine**: the patient's studies from the machine (matched by the scan number on the worklist, or her patient number
  typed on the machine), its pictures to tick and add to the report (only after confirming they do not show the baby's
  sex), and the **average table**: each measurement's readings with ticks, the machine's own value, the rule (average,
  last, machine's own, one reading) and the value; **Fill the report with these values**. (4) **Review the final
  report** → **Finalise – sign and print**; the printed report lists the machine's readings. (5) Scans → **From the
  machine – not linked**: studies with an unknown number, linked by her patient number. DRAFT: the measurement codes,
  units and the average rule (owner's approval); not tried with a real machine yet. **How to test (without a machine):**
  `server/tests/usg-machine.test.js` sends a made-up study through the bridge's address; with a machine: follow
  `scan-bridge/README.md` with a dummy patient only.
- **28 Oct 2026 – pharmacy: prescribed medicines stay on the bill; Sold list (developer's requests):** medicines put
  on a bill from the doctor's prescription are marked Prescribed and cannot be taken off (only their quantity and batch
  change; a prescribed medicine short of stock says so); medicines the pharmacist adds can be removed. Pharmacy bills is
  now **Sold**: each bill shows the medicines sold on it, the search also finds a medicine's brand or generic name, and
  New bill is at the top. On New bill, the search for someone from another day comes first, then today's OPD patients.
  **How to test:** pharmacist → Today → Bill the prescription → no remove button on the prescribed lines; Sold → type a
  medicine name.
- **28 Oct 2026 – a doctor's saved prescription billed at the pharmacy in one step (developer's request):** on the
  pharmacist's Today register, a patient whose prescription was saved today shows Prescription waiting with **Bill the
  prescription**: it opens the sale with her and that prescription's medicines already on the bill (the pharmacist checks
  the quantities and batches, then makes the invoice). Today's register reads itself again every 30 seconds while in
  view, so a prescription just saved appears without reloading. **How to test:** as a doctor, save a prescription on a
  sample patient's visit; as the pharmacist, open Today → Bill the prescription → check the lines → make the invoice.
- **28 Oct 2026 – Pharmacy → Purchase bills as the earlier software's GRN screen (developer's request, from photos of the
  old screen):** **GRN List** and **New GRN** tabs; New GRN has the supplier's invoice on the left (store, supplier,
  invoice and gate entry numbers, dates, tax name, direct or purchase order, credit or cash) and the items on the right:
  the item name (or a barcode) opens a **pop-up** for the medicine – batch, expiry, quantity, free quantity, conversion
  factor, discount, rate, MRP, GST – with the disc amount, total, total quantity, GST amount, net amount, HSN code, sale
  rate, landed rate and profit worked out; the list shows each line (Fill in when something is missing); under the
  amounts: CRN adjust, Save and add to stock, Close. Saving and the sums are unchanged. **Not on the pop-up:** a scheme
  amount per line and a separate sales rate (the stock sells at the MRP), and the Mfg barcode tick (barcodes are on the
  medicine). **How to test:** Pharmacy → Purchases → New GRN → choose a supplier, write an invoice number → type a
  medicine name → fill the pop-up → Add to the bill → Save and add to stock → GRN List.
- **28 Oct 2026 – history-taking sheet, the gaps closed (`docs/HISTORY_SHEET_LAYOUT.md` sections 4 and 5):** one Dictate
  for the page – the voice entry, which turns speech into text on this computer only (the sheet's own button, which
  used the browser's online speech, is gone); its reading fills the five lines **and** the LMP, G P L A, caesareans,
  allergies, blood group and conditions from the same sentence, and the type of care's line ("trying to conceive since 3
  years"; "delivered on 20 October 2026 by caesarean" in Edit details of a postnatal record). The grey strip shows what
  was heard (read-only). Hints under the history fields and the "From voice – check" marks are hidden on the sheet;
  Edit details has Dictate too. The hospital export's note names the history sheet. **Still open (owner's choice):**
  height and weight sit in the third drop-down although section 3 says they belong to the visit; the anti-D hint and
  the abortion G P L A hint are kept as safety notes. **How to test:** Patients → a sample record → Edit details →
  Dictate → type (or say) the example sentence in the voice card → the blanks and the drop-downs fill → Save.
- **27 Oct 2026 (developer's requests, in perinexa1):** (1) **OPD and IPD**: the Patients list has OPD (Today's
  patients first, All patients, New registration, Add service charge) and IPD (in hospital now); the patient record's
  tabs are grouped under OPD and IPD; the left menu's Patients opens OPD and IPD lists. (2) **Registration**: the type of
  care can be corrected on the form; a PIN code fills the city and state (India Post's directory kept inside Perinexa,
  `client/public/pincodes.json`); doctors' departments (Admin → Users) with the department first on registration;
  service charges billed at registration. (3) **Billing**: the bill printed as the hospital's OPD receipt (logo,
  consultant, department, amount in words, the hospital's notes); the hospital's logo on the letterhead; **Reports**
  (21 OPD, IPD and collection MIS reports; print, PDF, Excel); the **Daily collection** redesigned with the **day's
  expenses** taken off the total (`Expense`, cancelled with a reason, never deleted; in the hospital export). (4) The
  owner's **fertility treatment plans** brought over from `girishsolanke/perinexa`. (5) The **history-taking sheet**
  (`docs/HISTORY_SHEET_LAYOUT.md`): the five template lines on page 2 and in Edit details, Dictate with the template's
  words as anchors, three closed drop-downs, a History card on the Overview. Decision 4 (words about a born child's sex allowed
  in Previous deliveries and the table of previous pregnancies only) built after the developer's review with the owner,
  with extended tests. **Not built:** moving this
  pregnancy's details to the visit, risk rules reading the new facts, the combined one-page print (decision 9).
  **How to test:** Patients → Edit details on a sample patient → History → type the sentence of the paper template in
  the grey box → Fill the blanks → Save; Billing → Daily summary → Add expense; Billing → Reports.
- **Fertility treatment plans (24 Oct 2026, owner's request – another exception to the feature pause):** on an
  infertility record, a **Fertility history** section in Edit details (kind and months of infertility, cycles,
  ovulation, tubes, uterus, endometriosis, the partner's semen against the WHO 2021 ranges, diagnoses, AMH / AFC / FSH
  / prolactin / TSH, cycles done before) and a **Treatment plan** tab: **Suggest plans** reads her record and offers
  the protocols that fit, with why ("Suggested for her", "May also apply", the rest of the library); the doctor ticks
  one or more; the plan is built from their text (aim, cautions, investigations, treatment steps, medicines and doses,
  monitoring, review, what to explain, general advice), edited as text with every earlier version kept, confirmed by a
  doctor, and ended as pregnant, next step or stopped with a reason. The library (`docs/FERTILITY_PLAN.md`) is DRAFT:
  20 protocols written from the WHO infertility guideline (Nov 2025), NICE NG257 (Mar 2026), ESHRE (unexplained
  infertility 2023, endometriosis 2022, recurrent loss 2022, ovarian insufficiency 2024, stimulation 2025), the 2023
  international PCOS guideline, FOGSI practice points, the WHO semen manual 2021 and India's ART Act, Rules and
  Regulations – every dose or day the texts do not give is marked "doctor to confirm". In the record copy and the
  hospital export; audit log with ids and the plan's status only. How to test: "How to test fertility treatment plans".
  **Switch to…** (same day, owner's request): from a current plan the doctor moves up the ladder – follicular study with
  timed intercourse → IUI → IVF/ICSI – or to another procedure (ovarian drilling, tubal or hysteroscopic surgery,
  endometriosis surgery, varicocele repair, sperm retrieval with ICSI, donor gametes, fertility preservation): the old
  plan is completed as moved to the next step, the cycles done under it are added to her record, and the next draft is
  built; **Start with a step…** when there is no plan yet. A **Follicular study** protocol joins the library (21).
  **Cycle (follicular study) sheets** (same day, owner's go-ahead for idea F1): under a confirmed plan, one sheet per
  cycle – day 1, the medicines, the scan days with each ovary's follicles and the endometrium, the trigger, timed
  relations or IUI with the post-wash count, luteal support, a cancellation, the outcome; the state follows what is
  filled in and a completed cycle is counted on her record by itself; **Print report** gives the couple the follicular
  study report on the letterhead in English with Marathi or Hindi (draft wording). Section 7 of `docs/FERTILITY_PLAN.md`.
- **24 Oct 2026:** (1) Voice entry takes Chrome's corrections as they are (no repeated or lost words). (2) Fill from
  Aadhaar checks the UIDAI signature; PDFs and large files get their own message (`docs/AADHAAR_QR.md`). (3)
  Sonography (freeze lifted for ideas 17–22): the Scans dashboard (booked today, to scan, to report, to sign, signed
  today) and scan pictures in the report (add, choose for print, take off with a reason). (4) Super admin → Patients:
  every hospital's patients, identity only, with the hospital and who added her. (5) Names get a capital at the start
  of each word while typing. **How to test:** Scans → the tiles at the top; open a study marked done → Pictures → Add
  pictures (a JPEG), untick "In the printed report", sign and print. Sign in as the super admin → Patients → filter by
  hospital → click a row (her hospital opens). New patient → type "asha patil" → the box shows "Asha Patil".
- **26 Oct 2026 (branch `reception-followups`, not merged – an exception to the feature freeze, the owner's
  go-ahead to be recorded before merging):** reception could not clearly see follow-ups and vaccinations (ideas 24,
  25 and 27 in `docs/IDEAS_FOR_LATER.md`). (1) **Follow-ups** in reception's left menu, with two tabs: *Follow-ups* –
  the patients to call (a visit due or overdue, nothing booked) and everyone booked for the next 7 days, by day, with
  the time, the doctor, New or Follow-up and Arrived; *Vaccinations* – babies overdue, and babies whose vaccination is
  due in the next 7 days with nothing booked, in general words only ("a check-up or test"), never the vaccine.
  `GET /api/follow-ups` (reception only, `server/src/routes/followUps.js`). Both tabs have a **filter**: part of the
  patient's name, patient number, phone or doctor, and **All / OPD / IPD / Day care** (IPD or day care: her latest stay
  is still going or ended in the last 90 days; everyone else is OPD), kept in the address bar (`?q=`, `?type=`). (2)
  On reception's Today the call lists
  now come right under Today's patients, with a link to Follow-ups. **How to test:** sign in as reception → Follow-ups
  → the four numbers at the top, "To call – not booked", "Coming up – next 7 days" (a doctor's next visit shows on its
  day as Follow-up, "Needs a time" until it has a time) → Vaccinations: a baby registered today is under "Due in the
  next 7 days"; press Book, book the visit, and the baby moves to Coming up. As a doctor or nurse there is no
  Follow-ups in the menu and `/follow-ups` says it is for reception.
- **26 Oct 2026, same branch – registering and editing in dialogs on Appointments (as Docterz's reception):** (1)
  **Book → New patient** no longer goes to the registration page: the dialog asks the type of care and the visit
  type, then shows her full registration form (page 1 of Patients → New patient, with Fill from Aadhaar); **Register
  and book** saves her and books the time for her record ("She may already be registered" books it for the record
  chosen; a slot taken meanwhile asks "Book anyway"). Clinical details are added later from her record. Those who do
  not register patients still book by name and phone. (2) On every booking: **Edit details** (her registration
  details in a dialog, saved as on her record's Edit tab) and, for a booking "Not registered yet", **Register** (the
  same form filled in with that name and phone; the booking joins her record). `client/src/pages/appointments/
  RegisterAndBook.jsx`. **How to test:** as reception → Appointments → a free time → New patient → Gynaecology →
  fill in a fake name and phone → Register and book: she is booked, no page change. Press Edit details on her line,
  change the address, Save changes. On a line "Not registered yet" press Register.
- **26 Oct 2026, same branch – reception's Today made simpler, and "Details missing":** (1) For reception (not also
  clinical staff) Today shows only the lists with someone in them, open, one under the other (empty lists are hidden;
  "Nothing to do in today's lists" when all are empty); a list closed by hand stays closed. Follow-ups is a quick
  button at the top. (2) **Details missing**: a warning box near the top lists patients registered in the last 30
  days (and anyone on today's list) whose registration details are not all filled in – address (or city), emergency
  contact's phone, doctor, and age or phone on older records – with what is missing in words and **Fill details**
  (her details in a dialog; saved, she leaves the list). Identity details only. `server/src/patients/
  missingDetails.js`, `client/src/pages/DetailsMissing.jsx`. **How to test:** as reception → Patients → New patient →
  Gynaecology → only name, age and phone → Register → Today: "Details missing (1)" with "Address, emergency contact and
  doctor missing" → Fill details → add them → Save changes: the box is gone.
- **26 Oct 2026, same branch – reception's Today redesigned as a desk** (`client/src/pages/ReceptionDesk.jsx`,
  `styles/pages-reception.css`; reception only, not also clinical staff): (1) a large search box first – phone, name
  or patient number – each patient found with **Mark arrived**, **Book** and **Edit details**; nobody found or not
  the right person: **Register new patient** in a dialog with the phone or name already typed in; (2) the number
  cards (Today's patients, Calls to make, Money today, Free beds); (3) two columns: today's patients, the waiting
  lists and the bookings to register (open), beside a short **To do** – calls to make, details missing (opens its
  list in a dialog, replacing the big box), bookings to register, payments to collect, tomorrow's calls,
  discharges, only those with someone in them ("Nothing waiting" when all are done) – and Doctors today; (4) the
  other lists under "More lists", only with someone in them. **How to test:** as reception → Today → type a fake
  patient's phone → Mark arrived; type a new number → Register new patient → she is found at once; To do → Details
  missing → Fill details.
- **26 Oct 2026, same branch – Appointments page redesigned:** the day's counts as coloured pills (booked, free, seen);
  the times with a legend (free – click to book, booked with an indigo edge, kept for walk-ins dashed, passed); each
  patient of the day as a card – time on the left, her initials, name and details, the status on the right, a
  coloured edge for her state (booked blue, arrived green, done grey, did not come or needs a time amber, next
  indigo) – and the actions on one row: **Edit info** (one button for everyone: her details, or for a booking "Not
  registered yet" her registration with that name and phone), Take fee, Reschedule, and Cancel last. **How to
  test:** as reception → Appointments → a day with bookings → Edit info on a "Not registered yet" card → Gynaecology
  → Register: the card shows her patient number.
- **26 Oct 2026, same branch – the live queue on reception's desk:** each patient of the day is **Expected**,
  **Waiting** (arrived), **With the doctor** (her visit started) or **Done** (the visit signed, the checkup marked done,
  or reception's **Mark done** – she left; can be undone). **Emergency** (reception, nurses, doctors, RMOs, for a
  patient who has arrived) puts her first on Today and in her doctor's waiting line, in red with the word; audited
  (ARRIVAL_EMERGENCY_CHANGED, PATIENT_LEFT_MARKED, ids only). Reception's desk shows **Today's queue**: a strip with
  the count of each state (click to show only that state), then one row per patient – time or token, name, doctor,
  state and the buttons (Mark arrived, Emergency, Mark done, Undo arrival, Undo done, Slip), nothing to open. The desk
  reloads every 30 seconds while it is in front and no dialog is open ("Updated 10:32", Refresh now); the old rows
  stay while the new ones load. `POST /api/arrivals/:patientId/emergency|left`, `server/src/routes/today.js`
  (queue, emergency), `appointments/slots.js` (waitingOrder: emergencies first), `client/src/pages/ReceptionDesk.jsx`
  (QueueBoard). **How to test:** as reception → Today → Mark arrived on two booked patients → Emergency on the second:
  she moves to the top, red, and first under Waiting to be seen → as a nurse start the first one's visit → back as
  reception within 30 seconds she shows With the doctor → Mark done → Done; Undo done.
- **26 Oct 2026, same branch – reception's dashboard laid out as the owner's sketch** (`client/src/pages/
  ReceptionDashboard.jsx`, `styles/pages-reception-dashboard.css`; brand colours instead of the sketch's pink, no
  exclamation mark or emoji): a greeting; three number cards (Today's patients – arrived and waiting; Appointments –
  completed and upcoming; Collection today – payments); quick-action tiles (Book appointment, Admit to bed, Billing
  and payments, Follow-ups, More); **Today's patients** as a table – tabs All / Expected / Waiting / In consultation /
  Completed with counts, a search box (name, patient number, phone; anyone not on today's list is offered below with
  Check in, Book, Edit info, or Register new patient), a doctor filter, one row each (initials, name and number,
  age, time or token, visit type, state, **Check in** or **View**, and a menu: Emergency, Mark done, the undos, Edit
  info, Book, token slip); the day's other lists as **one row of small cards** (name and count, only those with
  someone in them; a card opens its list below); beside it To do, **Doctors today** (state, hours, expected /
  waiting / seen on their own lines) and **Upcoming appointments**. Today's patients now also carry her age and her
  booking's visit type (`routes/today.js`). The queue's words: In consultation, Completed.
- **26 Oct 2026, same branch – follow-ups added by hand, and why she came:** a patient registered on Monday comes
  back on Friday to show her reports. (1) **Add follow-up** (Follow-ups page button, or a row's menu on the desk):
  her doctor, what for – a fixed list (Follow-up consultation, Show reports, Test or scan, Dressing or procedure,
  Prescription, Other) and a short note (at most 120 characters, "no medical details – reception sees this"), and
  from which day; listed under **Follow-ups added** (Book, Cancel). Reception, doctors and RMOs; audited
  (FOLLOW_UP_ADDED, FOLLOW_UP_CANCELLED, ids and the purpose only). `server/src/models/FollowUp.js`,
  `routes/addedFollowUps.js` (`/api/added-follow-ups`). (2) **Check in** now always asks **"Why did she come?"** (the
  same list, filled in from her follow-up, with the follow-up shown); a booked patient only chooses why, a walk-in
  also the doctor for a token. Her follow-ups due by today are marked "came". (3) **Her doctor's notification**
  says why: "Asha Sample has arrived. Came for: Show reports (bring the blood report)." – the doctor of her
  appointment, or of her follow-up when she has none; the doctor's waiting line shows it beside her time. (4) The
  desk's table shows "Follow-up: Show reports" before she comes and why she came after. **Privacy:** reception never
  got the medical reason for a visit; this is a short fixed list and a short note on purpose – the owner to confirm
  the list's words. **How to test:** as reception → Follow-ups → Add follow-up → a fake patient, Dr A, Show reports,
  "bring the blood report", from today → Today → find her → Check in: "Show reports" is chosen → Check in → sign in
  as Dr A: the bell says why she came.
- **26 Oct 2026, branch `reception-simpler` – reception's Today made simpler:** the bookings made by name and phone are
  rows of Today's patients too ("Not registered yet", amber, with **Register** – the booking joins her record), so the
  table, the numbers and Doctors today count the same people (before: "Nobody is booked" while Doctors today said 3);
  the quick-action tiles and the row of small list cards are gone (the sidebar has Appointments, Beds, Billing and
  Follow-ups; **Book appointment** is a button at the top; To do opens the lists, with "Close this list");
  Upcoming appointments is hidden when nobody is left. Website only. **Upcoming visits** under Today's patients: the next
  days' bookings (from tomorrow, 6 days), by day – time, patient, phone, doctor, New or Follow-up – the first 10, all
  of them under Follow-ups; hidden when nobody is booked. The side card "Upcoming appointments" (today's later bookings)
  is gone: they are already rows of Today's patients. A booking by name and phone is a row with "Details missing" and **Fill info**: her
  details form at once (name and phone filled in, the type of care set to Gynaecology and changeable); saved, her
  record is made and the booking joins it (the form's own check still says "She may already be registered"). No other
  patient's record is offered from the table. A registered patient whose details are missing has "Details missing" and
  **Fill info** (her own form, the missing items said at the top); none once everything is filled in. The rows are white
  like the others (`routes/today.js`: guests[].registered, samePhone).
- **26 Oct 2026, branch `pharmacy-today-compact` – the pharmacist's Today made compact ("not too much space"):** one
  line for "someone from another day" (patient number or phone; still audited) with the quick actions beside it; the
  pharmacy's seven numbers as one row of small cards (value and short name; what each means on pointing at it); then
  the day's register as before. Same order as the owner chose. Website only.
- **26 Oct 2026 (branch `pharmacy-register`, not merged – an exception to the feature freeze at the owner's request,
  for the developer to read before merging):** the pharmacy as the owner described it. (1) A pharmacist's sidebar
  holds the pharmacy's sections: New bill, Pharmacy bills, Suppliers, Purchase bills, Stock, Medicines, Reports,
  Pharmacy settings (the hospital admin keeps one Pharmacy item with tabs). (2) **Daily register**, on the
  pharmacist's **Today** page (owner: not a menu item of its own; "Someone from another day" and "Pharmacy at a
  glance" on top, then the list – no heading or count cards): only the day's patients – OPD (arrived today or prescribed today), IPD (admitted) and
  External (walk-in customers billed today) – with counts, an All/OPD/IPD/External filter, a day picker (today or
  earlier) and what the pharmacy has done (prescription waiting, billed, issued). Someone from another day is found
  by her **exact patient number or phone number** only; each search is in the audit log. (3) A pharmacist with no
  other patient role no longer sees the hospital's patient list or its search (the server refuses it too).
  (4) **New bill** asks OPD / IPD / External: OPD lists today's register, IPD issues to her stay as before, External
  is a walk-in whose name and phone stay on the bill only (no new patient record). (5) **Suppliers**: each supplier
  has its own page with its details, its bills and **Add bill** (the supplier already chosen). (6) The same supplier
  invoice number can't be entered twice for one supplier (its stock would come in twice). **How to test:** sign in as
  a pharmacist → the sidebar shows the sections → Today shows the Daily register → Make bill on an OPD patient (she is already
  chosen) → New external bill → name, phone, a medicine → Make the invoice → back on the register under External.
  Suppliers → click a supplier → Add bill → the supplier is filled in; save an invoice number that supplier already
  has → refused. Find "P-000001" under "Someone from another day". Not done (ideas list): saving a purchase as a
  draft before stock comes in, attaching the supplier's PDF, supplier payment status.
  **Purchase bill (GRN), same day (owner's photo and video of the earlier software):** Add a purchase bill now asks
  for everything the earlier software did: the store, the supplier (its address, phone, GSTIN and drug licence shown),
  invoice number, gate entry number, invoice date, the time it is entered, CGST + SGST or IGST (chosen from the two
  GSTINs, changeable), direct purchase or against a purchase order, credit or cash; for each medicine its unit (UOM),
  HSN, batch, expiry, pack size (ConvF), quantity and free quantity in packs, MRP and rate per pack, discount % and
  GST %, with its total and GST; and scheme discount, discount %, credit note adjusted, other charges, surcharge,
  freight, received by and remark – worked out to total, less, add, CGST/SGST or IGST, GST, rounding and the net
  amount to pay (`server/src/pharmacy/grn.js`). The stock still counts units of sale (packs × pack size; the unit
  MRP rounded down so it is never above the pack's). Saved bills show all of it. **How to test:** Suppliers → a
  supplier → Add bill → a medicine with Pack of 10, Qty 2, Free 1, MRP 45, Rate 30, Disc 10, GST 5 → freight 5 →
  the net to pay changes as you type → Save → the bill shows the sums; Stock shows 30 tablets.
- **Ideas for later (owner, 15 Oct 2026):** saved in `docs/IDEAS_FOR_LATER.md`. Nothing on the list is approved or
  built; new features remain paused until the developer's health check and agreement on the first commercial version.
- **New look (8 Oct 2026, branch `theme-premium-dashboard`, not merged yet – for the developer to review):** at the
  owner's request a calmer premium dashboard theme: soft lavender-blue canvas, white cards with 24 px corners and a
  subtle edge (table cards too), pastel icon tiles on the KPI cards, pill-shaped quick filters and search box, and one
  "selected" look everywhere (Teal Wash with an indigo edge). Style only, no change to how anything works; rules in
  `docs/BRAND.md` → "Dashboard look". Tests on Windows: 4 server tests (hospital export, a file scan in analytics) fail
  on Windows with or without this change (they were written on the Mac); the voice-entry corpus test sometimes fails
  when the whole suite runs at once and passes on its own.
- **Prescription extras (15 Oct 2026, branch `rx-ai-design`, not merged yet – an exception to the feature freeze
  the owner asked for):** (1) the AI recording note on voice entry is now behind an ⓘ button; (2) the Prescription tab
  has "Start recording" (AI, only when the OpenAI key is set, doctors and RMOs): say the medicines, press Stop, and
  each one is added as a row to check – `POST /api/ai/medicines`, rows checked against the fixed lists, nothing kept;
  (3) Prescription design → "Fine-tune": font (Perinexa, Arial, Georgia), text / medicine-name / doctor-name sizes in
  points, line spacing, left and right margins, and the doctor's own section titles. Still to do: several
  prescriptions per visit (changes the visit model, pharmacy sales, ABDM records, signing – planned separately).
- **Patients' own accounts and their records online (16 Oct 2026, branch `patient-accounts`, not merged yet – the owner
  lifted the feature freeze for this):** `docs/PATIENT_ACCOUNTS_PLAN.md`. On the sign-in page a patient chooses
  **Patient**, signs up (name, age, mobile, email, password) and waits; reception approves her in Patients → Online
  sign-ups (choosing her record or registering her) or rejects. Then she signs in with **mobile + OTP** or **email +
  password** and sees her appointment and booking, prescriptions and visits (signed only, as printed), lab reports
  (reviewed only) and bills; never notes, risk or anything about HIV. OTPs go by the reminders' SMS provider; without
  one a practice OTP shows on screen (never on a live server). This replaced the ABHA sign-up of the same morning
  (`docs/PATIENT_SIGNUP_PLAN.md`, merged into deploy-hardening before the owner changed her mind) – the owner did not
  want ABHA sign-in. Since the same afternoon she fills her own registration details (address, what she comes for,
  her last period for a pregnancy) and reception approves a new patient in one click. Hospital admin → Patient messages → "Let patients sign up for their own account". Marathi and Hindi
  DRAFT (`TRANSLATIONS_TO_CHECK.md` section 5). **How to test:** see "How to test patients' own accounts" below.

- **Easier and more pleasant for doctors: ideas 1–11 built (16 Oct 2026, branch `doctor-ideas` – the owner asked for
  them; the feature freeze was lifted for this):** from `docs/IDEAS_FOR_LATER.md`. (1) Ctrl+K opens one box for pages,
  actions, "book Friday" and patients; (2) "Same as last visit" copies the last visit's medicines, instructions and
  advice; (3) My settings → Typing shortcuts (".fu2" and a space); (4) unsaved visit typing kept as the person's own
  draft on the server for 7 days – Restore on the visit, "Continue ___'s visit" on Today; (5) Undo instead of "Are you
  sure?" for unsaved changes; (6) Enter moves to the next box, Ctrl+Enter saves, Enter on the last medicine adds one;
  (7) the pregnancy timeline on her Overview; (8) Clinic library → Pregnancy wheel; (9) "Your day so far" on a doctor's
  Today; (10) the baby keepsake card on a baby's record; (11) one short tip per changed screen and Help → What's new.
  DRAFT for the owner: the trimester and milestone weeks (7, 8) and the keepsake card's words (10). Ideas 12–16 are
  planned only: `docs/IDEAS_12_16_PLANS.md`. **How to test:** "How to test the doctor ideas" below.

- **Booking with a chosen doctor, Aadhaar QR, and voice picking choices (16–17 Oct 2026, branches `portal-booking`,
  `aadhaar-qr`, `voice-autoselect` – asked by the owner):** (1) In the patient portal, Appointments: she chooses the
  doctor (any doctor with OPD timings, her own first), then a day; only free times are shown, with that doctor's leave.
  (2) New patient / Edit details → "Fill from Aadhaar card": with the patient's agreement, a photo of the card's QR
  side fills name, age, address, PIN, city, state and the last 4 digits – read in the browser, nothing sent or kept;
  the UIDAI signature is not checked yet (`docs/AADHAAR_QR.md`; add-on `jsqr` 1.4.0 – run `npm install` after merging).
  (3) New patient → Dictate: the type of care said ("Pregnancy, Asha Sample, 28 …") opens its form with the rest
  filled in; on the clinical page, GDM, PIH / pre-eclampsia, twins, placenta praevia and APH said in antenatal care
  tick "Findings in this pregnancy" (marked From voice; saved only on Save). **How to test:** "How to test booking with
  a chosen doctor, the Aadhaar QR and voice choices" below.

- **Brought from the other copy, C:\Perinexa (19 Oct 2026 – owner asked for the modules missing here):**
  1. **Sonography** – perinexa1 already had Scans (USG and radiology), so the other copy's ultrasound module was not added
     as a second system; its strengths were added to Scans: the readings work out the weeks and EDD by scan (CRL,
     biometry or mean sac diameter), the baby's weight (Hadlock) and its centile by her dates, filled into the form
     (never over what was typed by hand); "Write the report from the readings" drafts the findings and impression;
     after saving, "Is the report complete?" – Complete signs it and the print window opens by itself. Scans is now for
     doctors and RMOs only (owner). DRAFT formulas and sentences (`client/src/pages/imaging/usgCalc.js`). **Not yet:**
     the machine sending its readings by itself (DICOM structured report) – needs the machine's make and model and a
     DICOM add-on (developer to agree).
  2. **Referrals from other doctors** – the referral desk login, referring doctors, the six promises with clocks, the
     consultant note, PDFs released to the desk, the weekly review, quarterly summaries, the referral slip, and
     Hospital admin → Referrals settings (`docs/REFERRALS_PLAN.md`). Left out here: the other copy's separate
     sonologist login; referrals in the copy of the whole record (later).
  3. **Tally link** – Billing → Accounts for the hospital admin: account names, batches as Tally XML files, exceptions,
     the control sheet and "Sent to Tally" marks (`docs/TALLY_PLAN.md`). To be tried with the accountant's TallyPrime.
  **How to test:** see "How to test the modules brought from C:\Perinexa" below.

## Done
- **Lab report on the lab's own letterhead paper (22 Oct 2026):** Print report now offers the paper – **the lab's
  letterhead paper** (the default, remembered in this browser) prints the report only: no letterhead, hospital name or
  footer, the top and bottom left blank for the printed header and footer (45 mm and 30 mm, adjustable), **one test
  per page**, each sheet with the patient and sample block, Test Name · Obtained Value · Unit · Bio. Ref. Interval, the
  sample barcode and the signature; tight rows so a full CBC fits on one page (204 of 222 mm). "All tests on one sheet"
  is a choice. Plain A4 with the hospital letterhead stays as before. **Ctrl+P on a lab order** now opens the report
  print instead of printing the page with its buttons. DRAFT ranges stay marked; HIV stays neutral.
  `LabPrints.jsx` (LabReportSheets), `pages-lab.css`, `LabOrderPage.jsx`; test `labSheets.test.jsx`.
- **Switch back to super admin, however the doctor account was reached (22 Oct 2026):** a doctor account a super admin
  linked as their own – made with Work as a doctor, or an existing doctor login linked by email – now shows **Switch
  back to super admin** whether it was reached by the switch, by signing in with its own password, or directly; going
  up always asks the super admin password. A doctor no super admin linked never sees it. `superAdminBehind` in
  `routes/auth.js`.
- **Admin or clinical work, one at a time; Add people; Admin permissions (22 Oct 2026, developer):** a doctor (or other
  clinical staff) whom the super admin also made a hospital admin now works as one or the other: they start in clinical
  work (patients, no admin pages); **Switch to admin** asks their password and gives the admin pages only (no patient
  records, like every hospital admin); **Switch to Doctor** goes back without a password. Both in the audit log
  ("Switched between clinical work and admin"); the stored roles never change. A super admin in their own doctor
  account types the super admin password. New hospital-admin permission **Add people**: such an admin adds staff (a
  temporary password is shown) but never another admin – and "Change roles" no longer makes or removes admins either;
  only the super admin does. The super admin gives the permissions on the new **Users & access → Admin permissions**
  page (every hospital admin, a tick per permission). Changes the owner's decision of 12 Oct 2026 that only the super
  admin adds people (now: or an admin they allow) – **owner to confirm**. Code: `middleware/auth.js` (workingRoles,
  the session's `mode`), `routes/auth.js` (/switch-to-admin, /switch-to-clinical), `routes/members.js`,
  `UserPermissionsPage.jsx` (AdminPermissionsPage), `MembersPanel.jsx`, `AppLayout.jsx`. Tests: `server/tests/admin-mode.test.js`.
- **Export lists as Excel-ready CSV (21 Oct 2026, developer):** an **Export** button on Patients, Appointments, Beds, Lab,
  Scans and Referrals saves a list for the dates chosen (patients: all, or registered between two dates). Exports show
  exactly what the person may already see: **doctors, their own patients** – their appointments, and the stays, lab
  orders (tests and status, HIV under its neutral name, never results), scans (study and status, never the report) and
  referrals (as consultant) of their own patients. A hospital admin with no clinical role sees no patient data, so has
  no export (an admin who is also a doctor exports as that doctor); nor has a platform user who opened the hospital.
  At most 366 days and 20,000 rows per file; cells that start like a formula get an apostrophe; every file saved is in
  the audit log (what, the dates, how many rows – no names). The dialog warns that the file holds names and phone
  numbers. Code: `server/src/routes/exports.js`, `server/src/utils/csv.js`, `client/src/components/ExportButton.jsx`.
  Tests: `server/tests/exports.test.js`, `client/src/components/exportButton.test.jsx`.
- **Names start with capitals (21 Oct 2026, developer):** people's names are saved with every word starting with a
  capital letter – "jayashri sable" → "Jayashri Sable" – for patients, emergency contacts, staff (added, or their own
  name on My profile), portal sign-ups, referral and appointment guests, referring doctors, pharmacy customers, doctors on
  walk-in sales, pharmacists and witnesses. Only the first letter after a space changes ("McDonald", "A.K.", "Walk-in" keep
  theirs; "of" stays small, so "Baby of Asha Patil"); Marathi and Hindi are left as they are; medicine, hospital and business names stay as typed. Names saved
  before keep their spelling until changed. `server/src/utils/personName.js`, `server/tests/person-names.test.js`.
- **A super admin who is also a doctor – one login (21 Oct 2026, developer):** profile menu → **Work as a doctor…** →
  choose a hospital: the super admin's own doctor account is made once (their email with "+doctor", a random password
  nobody knows – no second email or password to remember) and added to that hospital's staff as a doctor; this browser
  switches to it. **Switch to your doctor account** then needs no password; **Switch back to super admin** asks for the
  super admin password (wrong tries count towards the sign-in lock). Only a super admin's OWN account is entered without
  a password – a doctor login linked by email still asks for its own password, so no one steps into another doctor's
  account. Both switches are in the audit log ("Switched between super admin and own doctor account"). Changes the
  owner's decision of 13 Oct 2026 (the doctor password asked every time) for the own account only – **owner to confirm**.
  Code: `routes/auth.js` (/me/doctor-account, /switch-to-doctor, /switch-to-super-admin), `User.ownedBy`, the session
  cookie's `via`; website `AppLayout.jsx` (DoctorAccountDialog, SwitchBackDialog). Tests:
  `server/tests/superadmin-doctor-switch.test.js`, `client/src/components/switchAccount.test.jsx`.
- **Ready for AWS (21 Oct 2026):** `docs/DEPLOY_AWS.md` – one EC2 server in Mumbai, Caddy for HTTPS, MongoDB Atlas,
  with `deploy/perinexa.service`, `deploy/Caddyfile` and `deploy/deploy.sh` (updates, builds, restarts, and goes back
  to the version before if the health check fails). CI on GitHub (`.github/workflows/ci.yml`): every test and the
  build on each push to `main` and each pull request, no secrets. Two fixes for the live server: its security header
  now lets the app's own WebAssembly run and pictures made from a chosen file show (reading the Aadhaar QR, QR codes,
  profile photos and signatures would have failed there – the development website does not send that header); and it
  refuses a `JWT_SECRET` or `SETUP_CODE` that looks typed or copied from an example. `server/.env.example` now has
  Perinexa1's own addresses (server 4001, website 5174): a new computer set up from it got "Can't reach the server".
- **Medicine GST rates brought up to date (21 Oct 2026):** the pharmacy now offers 0, 5 and 18 % (the 12 % rate ended
  on 22 Sept 2025, 56th GST Council) and a new medicine starts at 5 %. Medicines saved earlier at 12 % keep working;
  `npm run fix:gst-rates` moves them to 5 % in every hospital, lists them, and writes each change to the audit log –
  the pharmacist then checks the list (a non-medicine item such as sanitiser or a cosmetic is 18 %). Invoices,
  purchases and returns already made keep the rate they were made with. Hospital services stay without GST.
- Project rules saved in `CLAUDE.md`.
- **Phase 0 – computer set up.** macOS 26.6 (Intel), Node.js v24 (LTS), npm 11, git 2.50,
  MongoDB 8.0 running locally (data in `.mongo-data/`, only reachable from this computer).
- **Phase 1 – base app.**
  - Server: login/logout/current user/change password with a JWT in an httpOnly, sameSite=strict cookie
    (secure in production). Sessions end after 30 minutes without activity.
  - No public sign-up. Admin features: list users (search, filters, pages), create, edit, change role,
    activate/deactivate, reset password (user must change it at next login).
  - Safety rules: admins can't demote or deactivate themselves; the last active admin can't be removed;
    users are deactivated, never deleted.
  - Audit log of logins, failed logins, rate-limited logins, logouts, password changes and all account changes.
  - Security: helmet, CORS limited to the website, login rate limiting, zod validation, central error handling,
    no password hashes in responses.
  - Seed script creates the first admin from `server/.env`.
  - 33 automatic tests (all passing): `npm test`.
  - Website: login, forced password change, dashboard, user management, audit log viewer,
    "sample data only" banner, auto-logout after 30 minutes idle (with a 1-minute warning), works on phones.
  - Tested by hand in the browser: wrong/correct login, forced password change, create/edit user, role change,
    deactivate/reactivate, reset password, audit log, non-admin blocked from admin pages, idle logout.

- **Multi-hospital (multi-tenant) version.**
  - Hospitals ("tenants") share one database; hospital data carries a `tenantId` (patients, memberships,
    audit log entries, record-number counters). A database safety net refuses patient queries without a hospital.
  - Platform super admin: creates/renames/deactivates hospitals, manages all accounts, tags people to hospitals
    with a role (admin, doctor, nurse, receptionist). Super admins can't see patient data.
  - One account can work at several hospitals; the selected hospital is kept in the login session and chosen
    from the top-right dropdown (shown only when tagged to more than one). People land in their last hospital.
  - Hospital admins manage staff of their own hospital only and see only their hospital's audit log.
  - Patients: add, list/search, view — always in the selected hospital; record numbers per hospital (P-000001…).
    Viewing and creating patients is recorded in the audit log (ids only, no personal details).
  - If the hospital is switched in another tab, the server refuses the stale request and the page refreshes.
  - 60 automatic tests (incl. hospital data isolation); tested by hand in the browser.
  - the demo script (removed 12 Oct 2026) creates fake demo hospitals, staff and patients. Local logins: `docs/TEST_ACCOUNTS.md`
    (not in git).

- **Enterprise layout for every login (same design for all roles).**
  - Left menu with the main modules; sub-modules as tabs at the top; breadcrumbs; collapsible menu
    (remembered) and a slide-in menu on phones.
  - Super admin modules: Overview (summary tiles, hospitals without an admin, recent activity), Hospitals
    (list/new; each hospital has Overview/Staff/Activity tabs), Users & access (all, super admins, hospital
    staff, pending first login, new account; each person has Profile/Hospital access/Activity tabs),
    Audit & compliance (all events, security, access changes, sign-ins, patient record access), My account.
  - Hospital staff modules: Dashboard, Patients (all/new), and for hospital admins Staff and Audit log
    (same five audit tabs, limited to their hospital). The hospital switcher sits at the top of the menu.
  - Tables built for large data: server-side search/sort/paging, rows per page (10–100), first/last page and
    "go to page", sticky header, loading placeholders; filters/sort/page kept in the web address.
    Audit log has date-range filters. Database indexes added for the common sorts and filters.
  - 67 automatic tests passing.

- **Phase 2 – use case interview complete** and confirmed: see `docs/USE_CASE.md`
  (OBGY hospital; guideline-based care plans; typed prescriptions/notes; need-to-know privacy).

- **Phase 3 started** – plan approved (`docs/FEATURES.md`).
  - ✅ Feature 1: several roles per person in a hospital; new roles RMO and Lab staff. Roles are edited with
    checkboxes ("Edit" next to a person's roles). Existing data was converted automatically (`npm run seed`).

  - ✅ Feature 2: hospital letterhead (Settings → Print letterhead, admins only, with live preview) and
    professional details (My account → Professional details: qualification, registration number, council).

  - ✅ Feature 3: OBGY patient registration – type of care (antenatal, postnatal, infertility, gynaecology,
    newborn; abortion – pregnancy loss – added 2 Oct 2026); name, age, phone, address; LMP → EDD and weeks of pregnancy (scan EDD overrides); G P L A and
    previous caesareans (with consistency checks); blood group, height, weight, conditions, allergies; newborn
    birth details linked to the mother; assigned doctor ("My patients" / "Not assigned" filters). No fetal-sex
    field (PCPNDT). Edits change only the fields sent; the audit log records which fields changed, not values.

  - ✅ Feature 4: need-to-know access, enforced on the server (`server/src/utils/patientAccess.js`):
    RMO all; doctor own/unassigned full, others read-only + emergency note with reason (audited, can't be
    edited); nurse medical details without notes; reception identity only; lab name + number; admin-only no
    patient data. Sensitive records (infertility automatically, or marked by the treating doctor/RMO): medical
    details only for treating doctor and RMOs. Demo staff added for every role (the demo script (removed 12 Oct 2026)).

  - ✅ Feature 5: care-plan template library (Care plans → Templates & protocols). Each hospital gets its own
    copy of the built-in antenatal DRAFT (44 items: visits, lab tests, scans, vaccinations, medicines, advice,
    each with its guideline source – `server/src/careplans/antenatalDraft.js`; 50 items since 4 Oct 2026, with six
    for findings in this pregnancy – see Next). Doctors edit, copy into their
    own protocols, and approve (with a confirmation); any change makes it a draft again (new version).
    Nurses and RMOs can view. ⚠️ The draft content has NOT been reviewed by a doctor yet.

  - ✅ Feature 6: automatic risk level for pregnant patients (High / Moderate / Low / Incomplete) with the
    reasons, missing information, "may be higher" and draft-rules warnings. 38 draft rules (v2) checked by
    research against MoHFW PMSMA/SBA/MCP, FOGSI-ICOG, WHO, NICE/RCOG/ACOG – see `docs/RISK_RULES_RESEARCH.md`.
    (Rules on findings in this pregnancy and on the measured Hb and BP were built on 4 Oct 2026 – see Next.)
    New registration fields: problems in previous pregnancies, more conditions, and explicit "none known"
    confirmations. Only the treating doctor can override (with reason; history kept on the record; flagged
    for review when the automatic result changes). Risk filter/dashboard limited to roles that may see risk;
    audit log holds no medical details. Reviewed by 50 independent review agents; all confirmed issues fixed,
    then re-checked by 34 verification agents and the remaining gaps fixed (rules v3: uterine surgery is a
    condition; stricter first-pregnancy check; approval tied to the version reviewed; "Overrides to review"
    covers a doctor's own and unassigned patients; automatic risk changes no longer written to the audit log).
  - 🔒 Safety lock: the automated tests refuse to run against any database whose name doesn't end in `_test`
    (on 28 Sep 2026 a test run started from the wrong folder emptied the fake development database).
    Always run tests with `npm test` from the project folder.
  - ✅ New look: the whole app follows the Perinexa Brand & UI Guidelines v1.0 (Night Indigo sidebar with the
    Perinexa logo, Mist background with white cards, Jost/Mukta fonts, status pills with icon + word, initials
    avatars, KPI cards, dates as "12 Oct 2026", gestation as "28 w 3 d"). Works at 1366 × 768, as an icon rail on
    tablets and with a slide-in menu on phones. Rules for new screens: `docs/BRAND.md`.
  - ✅ New sign-in page: indigo panel with the white login card, Perinexa logo top right, optional photo
    (`client/src/assets/brand/login-photo.jpg`).
  - ✅ New patient in two steps: 1 patient information (type of care as a dropdown, name, age, contact, doctor;
    newborns also birth details) is saved first and gets a patient number; 2 the clinical details (pregnancy
    dates, history, medical background, notes) follow on their own page – for RMOs, and for a doctor registering
    their own or an unassigned patient. "Add later" leaves them for later. Reception, and a doctor who assigns a
    colleague, register step 1 only; that doctor or an RMO adds the clinical details. Pregnancy dates are now
    required when the clinical details are saved (not at step 1). "Edit details" on a record still shows everything.
  - ✅ New patient menu and voice entry: the "New patient" tab (and the New patient buttons on the dashboard and
    patient list) opens a menu of the types of care (six since 2 Oct 2026, with Abortion). On both new-patient pages, "Voice entry" records what is
    said, turns it into text **on this computer only** (Google Chrome's on-device speech recognition – never an
    online service; other browsers can type or paste instead) and fills the patient information, and after saving
    the clinical details. Every filled field is marked "From voice – check" until it is changed. The details are
    picked out by rules built into the app (no AI service), so they work best said with their names ("age 28",
    "LMP 12 July", "G2 P1 L1 A0", "blood group O positive"). Handles "no …" and "… negative", family history, scan
    EDD only when "scan" is said; never picks up fetal sex (PCPNDT); nothing said is stored. Rules and their tests:
    `client/src/pages/patients/dictation.js` / `dictation.test.js` (`npm test` now runs the website tests too).
  - ✅ Voice entry knows OBGY words used in India: ~80 groups of terms, short forms, Indian usage (k/c/o, h/o,
    B/O, 28/F, NR, +ve/-ve, prev LSCS, G2P1L1A0, P1+1…), Indian medicine brands (Thyronorm, Eltroxin, Nicardia,
    Aldomet, Clexane…) and a little Hinglish (saal, pehli, nahi) – list in `client/src/pages/patients/obgyTerms.js`
    (the owner can review it in My account → Voice words). Conditions without a tick box go to "Other conditions"
    (PCOS, fibroid, thalassaemia trait…); this-pregnancy findings go to the notes (GDM, twins, praevia, IUGR…) –
    still so for voice entry; since 4 Oct 2026 a doctor or RMO ticks them as findings in Edit details (see Next).
    The word list is also given to Chrome's on-device speech recognition so it hears these words better.
    When unsure it asks "Did you mean …?" with choices: medicines without a reason, "PIH"/"sugar"/"BP", previous
    vs this pregnancy, tests without a result, "B positive"/Rh without "blood group", EDD without "scan", a height
    like 5.2, misheard words, and short forms it doesn't know (the doctor teaches them). Parts it didn't understand
    are listed with "Add to notes" (never the baby's sex in a pregnancy). Answers about words (not about the patient)
    can be remembered per doctor ("Remember my answer") and are used automatically next time; each doctor sees and
    removes them in My account → Voice words (server: `/api/me/dictation-words`, only the word and its meaning).
  - ✅ Voice entry made much more reliable for Indian English (29 Sep 2026; the owner reported "stops by itself" and
    "wrong words").
    - Recording keeps going: Chrome ends a listening session after a pause, and Perinexa now starts a new one by
      itself until Stop is pressed. It stops on its own only after about half a minute of silence, after 5 minutes,
      or when you leave the page; the text is kept and Save is disabled while recording. Clear messages for a blocked,
      missing or busy microphone. A microphone can be chosen (Microphone and speech settings), with noise suppression.
    - Chrome has only one on-device English model (US English), so no language setting can fix accents. Perinexa
      therefore corrects common Indian English mishearings after the words are heard (`client/src/pages/patients/
      indianEnglish.js`): accent spellings ("tirty", "jero", "sizerian", "hypo tyroid", "else CS"), letters said one by
      one, "double/triple" and digit pairs, Hinglish (naam, pachees saal, pehli, haan ji, matlab), months, split words,
      and words matched by sound for 12 varieties of Indian English (Hindi belt, Punjab, Gujarat, Maharashtra, Bengal,
      Odisha, Assam/North-East, Tamil Nadu, Andhra/Telangana, Karnataka, Kerala, cities). A correction is automatic
      only when it is safe; otherwise it asks "Did you mean …?". Corrections are listed with Undo.
    - Safety: test results (HIV, HBsAg, VDRL …) and blood group heard by voice are filled only after a one-tap
      confirmation; "sorry" corrections ("age 26, sorry, 27") use the later value with a note; approximate dates
      ("2 months back") are asked; impossible values (height, weight, age, formula, partial phone numbers) are asked
      or left out; names, addresses and medicine doses are never changed; hand corrections are kept when you record
      again. PCPNDT: words about the baby's sex are removed before birth, never listed, remembered or sent to Chrome.
    - Tested with about 1,250 website tests, including 700 made-up dictations (every regional variety) and 40 written
      separately and kept hidden from the builders: 38 correct, 2 left for a question, 0 wrong (before: 12 wrong).
      Real speech could not be tested here (no microphone): see `docs/VOICE_ENTRY_TEST.md` for 10 sentences to read
      in Chrome and 10 decisions for the owner.
    - After the owner's test in Chrome (29 Sep 2026): "NTD given" is read as anti-D, "previous LSCS 5 years back"
      becomes a note, weeks said without an LMP offer an approximate LMP, non-reactive HIV/HBsAg/VDRL results go to
      the notes, "BP" as an illness ticks high blood pressure, recording continues in another tab, and speaking counts
      as activity for the 30-minute logout. The owner's decisions and results are in `docs/VOICE_ENTRY_TEST.md`.
  - ✅ Feature 7: antenatal care plan per patient. Every antenatal patient with pregnancy dates gets a care plan
    built from the hospital's antenatal template (or a doctor's own protocol): visits, tests, scans, vaccinations,
    medicines and advice, each with a due window worked out from the EDD. It shows as a "Care plan" card on the
    patient's Overview and as a "Care plan" tab (To do, Done & not needed, All; a "Today" line between past and
    coming items; count chips that filter the list). The treating doctor (own or unassigned patients) or an RMO can
    mark items done (with Undo), move a date (outside the guideline window a reason is needed), mark an item not
    needed, include an item anyway, add a note, add an item for this patient, change the booking date, change or
    update the protocol (every change is shown before it is saved), and close or reopen the plan. When the EDD,
    blood group or risk level changes, the plan follows by itself and "Recent automatic changes" says why (an EDD
    change of more than 8 weeks waits for the doctor: same pregnancy or new pregnancy). Nurses can only view,
    other doctors see it read-only, reception and lab staff don't see it. The audit log records only "Care plan …"
    entries with record numbers, never medical details. No field for the baby's sex anywhere (PCPNDT).
    Files: `server/src/careplans/*`, `server/src/routes/carePlans.js`, `client/src/pages/patients/CarePlan*.jsx`,
    `carePlanDialogs.jsx`, `carePlanFormat.js`.
    ⚠️ The plan shows "Draft – not approved for clinical use" until a doctor approves the template. The template
    content and the plan timing rules have NOT been reviewed by a doctor yet: 25 decisions with their defaults are
    listed in `docs/CARE_PLAN_DECISIONS.md` for the doctor's review. The full design is in `docs/CARE_PLAN_SPEC.md`.
    395 automatic tests (server 303, website 92), all passing. Checked in the browser at 1366 × 768, 1024 px,
    tablet and phone, as RMO, another doctor (read-only), nurse and reception.

  - ✅ Feature 9: care-plan printouts. "Print" on the Care plan tab (everyone who can see the plan): a **patient copy**
    in plain words – the complete plan, only some types (e.g. the **visit schedule** or the **sonography schedule**),
    or hand-picked items (e.g. only the next scan), optionally what is already done, the plan's advice and the doctor's
    own advice (printed only, not saved) – or a **staff copy** with every item's timing, status, guideline source,
    result and notes. A4 with the hospital letterhead; a print preview first; every page repeats the patient's name
    and number (and "Draft – not approved for clinical use" while the template is a draft). Printing records "Care
    plan printed" (patient or staff copy, record number only) in the audit log. (Since October 2026 the patient copy
    can also print with Marathi or Hindi under the English – see Next.)
    Files: `client/src/components/print/PrintPreview.jsx`, `client/src/styles/print.css`,
    `client/src/pages/patients/CarePlanPrint.jsx`, `carePlanPrintFormat.js`.

  - ✅ Bilingual consent forms (moved forward from "Later" at the owner's request). **Consent forms** in the left menu
    (doctors, RMOs, nurses) is the hospital's library of draft forms – HIV test, high-risk pregnancy, labour and delivery, induction, VBAC, caesarean, tubal ligation,
    admission, operation or procedure, anaesthesia, blood transfusion, refusal / leaving against advice, newborn
    care – each in **English, Marathi and Hindi**, clause by clause. Doctors edit (all three languages, who it is for,
    when it is suggested), copy, add their own, approve, and stop using forms; any change makes a form a draft
    again; blanks such as `{patient}` must match in every language. On the patient record, a **Consent forms** tab
    (those who may see her medical details) lists the forms for her type of care, **suggested** ones first (HIV test
    due, high-risk, previous caesarean, 37 / 40 weeks, newborn; a hospital's own form can also be suggested when a
    scan in the care plan is due), and the forms printed so far. Her doctor or an RMO prints: English + Marathi,
    English + Hindi or English only; the procedure and reason are filled in from the record where possible (e.g.
    the high-risk reasons) or left as lines; the doctor's name and registration number, or a blank. The paper has signature boxes for the patient (or a relative / parent), a
    witness, the doctor and an interpreter. Drafts print "DRAFT" on every page. Each printout is recorded on the
    patient; the audit log gets the record number only. Second language offered first: Settings → Print letterhead.
    ⚠️ The wording and the translations have NOT been legally reviewed or checked by native speakers – see
    `docs/CONSENT_FORMS.md` for what to check. (The ultrasound consent was removed on 2 Oct 2026 – see below.)
    Files: `server/src/consents/*` (wording in `forms/en.js`, `mr.js`, `hi.js`), `server/src/routes/consentForms.js`,
    `patientConsents.js`, `client/src/pages/consents/*`.
    445 automatic tests (server 337, website 108), all passing. Checked in the browser at 1366 × 768 and phone width
    as RMO, doctor and hospital admin; the printed pages (care-plan copies, Marathi and Hindi consent forms) were
    checked as A4 PDFs.

  - ✅ Feature 8: visits and typed prescriptions, with 10 printed prescription designs. A **Visits** tab on the
    patient record (for those who may see her medical details): **New visit** (nurse, doctor or RMO), or open an
    earlier visit. Each visit has two tabs. **Visit details**: vital signs (the nurse too), the pregnancy check, the
    doctor's notes and a private note (never printed, not shown to nurses), the next visit (suggested from the care
    plan, or in 1, 2 or 4 weeks) and the care-plan items done at this visit (ticked items are marked done in the
    care plan on the visit's date). **Prescription**: medicines row by row – form, strength, dose, 1-0-1, before or
    after food, how long, route, instructions – with the doctor's own recent medicines and about 70 common OBGY
    medicines offered while typing, "Your usual" for a medicine the doctor wrote before, and "Copy from the
    previous prescription". The patient's doctor or an RMO writes the notes and the prescription; other doctors
    read them; the nurse records vital signs. **Print prescription** prints the saved visit, signed by the doctor
    who wrote it, in that doctor's design: 10 designs common in India (classic Rx pad, hospital letterhead, two
    columns, medicine table, dose chart with sun and moon symbols, side band, pregnancy card, your own printed pad,
    half page A5, modern minimal), chosen and customised at **My account → Prescription design** (colour, text size,
    paper, instructions in English + Marathi or Hindi, CAPITALS, what to print, specialities, timings, footer note,
    pad margins). The care-plan items due by the next visit print under its date (overdue ones are left to the
    doctor). The audit log records visits viewed, started, updated and entered in error, and prescriptions saved
    and printed – record numbers only.
    ⚠️ The app does not check doses, allergies or interactions; the medicine list is not a formulary; the Marathi
    and Hindi words have not been checked by fluent speakers – see `docs/PRESCRIPTIONS.md`.
    (Later: allergy and pregnancy warnings came with the Medicine safety list on 30 Sep 2026; a limited dose check,
    breastfeeding and newborn warnings were built on 4 Oct 2026 – see Next. Still no general interaction check.)
    Files: `server/src/models/Visit.js`, `PrescriptionDesign.js`, `server/src/routes/visits.js`,
    `prescriptionDesign.js`, `server/src/visits/*`, `client/src/pages/visits/*`, `client/src/styles/print-rx.css`,
    `pages-visits.css`.
    470 automatic tests (server 354, website 116), all passing. Checked in the browser at 1366 × 768 and phone width
    as doctor, another doctor (read-only) and nurse; all 10 designs printed as PDFs (A4, A5 and a pre-printed pad
    with its margins), in English, Marathi and Hindi.

  - ✅ Feature 8b: ready-made prescription sets (added at the owner's request). **Prescription sets** in the left
    menu (doctors and RMOs) is the hospital's library: 12 **draft** sets for common situations – first trimester,
    second and third trimester, nausea and vomiting, anaemia in pregnancy, pre-eclampsia prevention, urinary
    infection in pregnancy, after normal delivery, after caesarean, PCOS, vaginal thrush, painful periods and heavy
    periods – each with medicines and doses, general instructions, tests, advice and notes for doctors (the
    guidance it follows). On a visit's **Prescription** tab, **Add a ready-made set** shows the sets (those for the
    patient's type of care first) and what each adds; one click adds its medicines (a medicine already there is
    replaced by the set's version), its instructions, and its tests and advice to Visit details – nothing is saved
    until the doctor has checked and saved. Doctors add sets (**New set**, or **Save as a set** from the
    prescription on screen), copy, edit, approve and stop using them; RMOs use them. Drafts are marked in the
    library and when added. The audit log records each change to a set (its name and version).
    ⚠️ The 12 sets were written by the software developer from published guidance and have NOT been checked by a
    doctor – they are listed with every dose, and the points to decide, in `docs/PRESCRIPTIONS.md`.
    Files: `server/src/models/PrescriptionSet.js`, `server/src/routes/prescriptionSets.js`,
    `server/src/visits/builtInSets.js`, `prescriptionSets.js`, `client/src/pages/visits/PrescriptionSet*.jsx`,
    `SetDialogs.jsx`, `MedicineRows.jsx`, `rxRows.js`.
    Automatic tests: server 367 and website 1,012 (including the new voice-entry tests), all passing. Checked in the browser at
    1366 × 768 and phone width as a doctor: the library, a set's page, editing, approving, adding a set to a
    prescription (replacing a medicine already there) and saving a prescription as a set.

  - ✅ Personal appearance (at the owner's request): **My account → Appearance** for everyone. Each person chooses
    a **colour template** (Perinexa Indigo, Ocean blue, Forest green, Plum, Burgundy, Slate grey, High contrast), the
    **font** (Jost, Mukta or the computer's own – nothing fetched from the internet), the **text size** (small,
    standard, large, extra large), the **spacing** (comfortable or compact) and **animation** (on or off). Each
    choice shows at once and is saved to their account, so it follows them to any computer; logging out brings back
    the standard look (for the next person on a shared computer). Status colours, the teal of what is scheduled and
    every printout never change. "Back to standard settings" undoes everything. Not in the audit log (it opens no
    record). Rules for the looks: `docs/BRAND.md` → Personal look.
    Files: `client/src/appearance.js`, `client/src/pages/AppearancePage.jsx`, `client/src/styles/tokens.css`
    (templates, text size, spacing, fonts), `base.css` (animation), `server/src/utils/appearance.js`,
    `server/src/routes/auth.js` (`PUT /api/auth/me/appearance`), `server/src/models/User.js`.
    Automatic tests: server 372 and website 1,016, all passing. Checked in the browser at 1366 × 768 and phone width:
    every setting, logging out and in again, and that a printout keeps its size, colours and font.

  - ✅ Voice entry on a visit (at the owner's request): the **Visit details** tab now has the same **Voice entry**
    card as registration. What is said (or typed or pasted into its box) fills in:
    - the **vital signs**: weight, BP ("120 by 80"), pulse, temperature, SpO2, Hb, urine albumin and sugar;
    - the **pregnancy check** (antenatal visits): fundal height ("FH 28"), fetal heart rate ("FHS 144"),
      presentation, fetal movements, oedema;
    - the **doctor's notes**, said under a heading: "complaints …", "on examination …" (or a finding such as
      "pallor"), "diagnosis …", "advised …" (tests go to Tests advised, the rest to Advice), "private note …";
    - the **next visit**: "next visit after 2 weeks with reports", "review on 15 October", "follow up next Monday".
    Notes are added under what is already written, one line each; numbers and choices replace. Every field filled is
    marked "From voice – check" until it is changed. Recording again never changes what was changed by hand (the card
    lists it as "not changed") and never adds a line twice. It asks when it is not sure: two different values ("BP
    110/70 or 130/90?"), a temperature in °C (offered in °F), a fundal height in weeks, oedema or fetal movements
    without a grade. A value that cannot be right is left out with a note, and so is a next visit that is not after
    this visit. Parts not understood can be added to complaints, examination or advice. The same Indian English
    corrections as registration ("one tirty by eighty" → 130/80, "wait 58 kilo" → weight 58), and "pulse 88,
    sorry, 92" uses 92. Nurses fill the vital signs only (other details said are left for the doctor); the private
    note only for those who may see it. The baby's sex is never written (PCPNDT). Saving waits while recording, and
    going to the Prescription tab stops the recording. Nothing said is stored or sent anywhere (Chrome's on-device
    speech recognition, as in registration).
    Files: `client/src/pages/visits/visitDictation.js` (the rules for a visit, with `visitDictation.test.js`),
    `VisitDetailsForm.jsx`, and `client/src/pages/patients/VoiceEntry.jsx` (the shared card: it can now be given the
    words Chrome should expect on a visit).
    Automatic tests: server 372 and website 1,287 (25 new for voice entry on a visit), all passing. Checked in the browser at 1366 × 768 and phone width as an RMO, with
    typed text and a simulated recording (the browser used for checking has no microphone) – still to be tried with
    real speech in Google Chrome (see below).

  - ✅ Printing a visit fixed, visit summary, and PDF (at the owner's request: "the print prescription is not
    working", "if treatment is not to be given … print the details of the current visit", "share the prescription
    as a PDF … so the treatment does not stop if my cabin's printer is not working").
    - Why print seemed not to work: the Print button at the top stayed greyed out while anything was unsaved, far
      from the Save button. Now **Print or share** is at the top and next to Save on both tabs, and with unsaved
      changes it reads **Save and print**: it saves first (or shows what to fix) and then opens the preview.
    - Fitting the page: the example prescription (4 medicines in two languages and 7 care-plan items) printed on
      two pages with the next-visit box and signature alone on page 2. Now a long "Due by your next visit" list is
      in two columns, the preview says how many pages it prints on, and when that saves a page it spaces the parts
      closer (and if needed makes the text about 6% smaller) – 9 of the 10 designs print that example on one page
      (the A5 half page needs two). The "Medicine table" design's page was also wrongly marked "keep together"
      (a clash of style names), which pushed its last block to page 2; fixed.
    - **Visit summary**: when no medicines are given, the printout is the visit summary – the same design without
      the medicines, titled "Visit summary / तपासणीचा सारांश". With medicines, the preview offers both.
    - **Download PDF** and, where the computer allows it, **Share PDF…** (e.g. to WhatsApp or e-mail): the printout
      as a PDF made on the computer (nothing sent to any service), named with the patient number and date, never
      the name – for the patient, or for reception to print. Recorded in the audit log ("Prescription saved as
      PDF", "Visit summary printed" …). ⚠️ A PDF sent outside Perinexa can't be taken back: send it only to the
      patient or hospital staff (see `docs/PRESCRIPTIONS.md`).
    Files: `client/src/components/print/PrintPreview.jsx`, `pdfExport.js`, `paperLayout.js`, `imagePdf.js`;
    `client/src/pages/visits/VisitPage.jsx`, `RxDocument.jsx`, `VisitDetailsForm.jsx`, `PrescriptionForm.jsx`,
    `rxFormat.js`; `client/src/styles/print-rx.css`, `print.css`; `server/src/routes/visits.js`,
    `server/src/visits/visitSchemas.js`, `server/src/models/AuditLog.js`.
    - **Send on WhatsApp** (at the owner's request): when the record has a mobile number, the preview saves the PDF
      and opens WhatsApp with a chat to that number; the doctor attaches the PDF and presses Send. (Sending it in
      one click through Meta's WhatsApp Business Platform was added on 4 Oct 2026 – off until set up; see "Next".)
      Files: `client/src/pages/visits/whatsapp.js` (the number as WhatsApp needs it, with its tests).
    - **Knowledge base** (at the owner's request): Care plans, Consent forms and Prescription sets are now one item in
      the left menu, **Knowledge base**. It opens with three tabs at the top – Care plans, Consent forms, Prescription
      sets (only for doctors and RMOs, as before) – and a second, smaller row where a tab has two parts: Care plans →
      Templates & protocols | Red-flag rules; Prescription sets → Set library | Medicine safety. Every page keeps its
      address, and the path at the top reads "Knowledge base › …".
      Files: `client/src/platform/modules.js` (with `modules.test.js`), `client/src/components/PageHeader.jsx` (the
      second row), `client/src/styles/layout.css`, and the library pages' headers.
    - **New patient, voice beside the form** (at the owner's request): on a wide screen (1200 px and more) the
      Voice entry card is on the left and the patient's details on the right, so the fields fill in beside what was
      said; the card stays in view while the form scrolls. Narrower screens keep it above the form. Removed from the
      page: "Say or type the details, check them, then save …" and "This patient will be registered in … Use
      made-up details only." (the hospital is in the left menu; "Fake sample data only" stays at the top right).
      Files: `client/src/pages/patients/PatientForm.jsx`, `PatientNewPage.jsx`, `client/src/styles/pages-patients.css`.
    - **Choosing a design, page by page** (at the owner's request): on My account → Prescription design, each of the
      10 cards now shows its whole page, and clicking a card opens that page at the size it prints – in the doctor's
      own colour, text size and language, on the fake sample visit – with **Previous / Next** (or the ← → keys) to
      go through the designs and **Use this design** to choose one (then Save design, as before). "Your own printed
      pad" shows grey bands for the pad's own print; the half page shows as A5.
      File: `client/src/pages/visits/PrescriptionDesignPage.jsx` (styles in `pages-visits.css`).
    Automatic tests: server 373 and website 1,298, all passing. Checked in the browser as a doctor: Save and print (and what happens
    when something must be fixed first), all 10 designs as PDFs and as Chrome printouts (page counts match), the
    visit summary with and without medicines, and the preview at phone width. Sharing needs a computer where Chrome
    offers it (not the browser used for checking).
    - **Patient Overview on one screen** (at the owner's request, 2026-09-30): Care plan and Risk level side by side,
      then Pregnancy, Obstetric history and Medical background in one row; the Patient box (phone, address) is gone
      from the Overview (the header has name, no., age, weeks and doctor; contact details are on Edit details).
      The Risk level box shows only the level, the reasons, what is still to record and what the doctor must assess;
      the rest is under **More details**. Fixed: a blank abortions count no longer shows as "Obstetric history
      (G P L A)" missing – each of G, P and A is named (risk engine v3, results recalculated on their own).
      The Care plan box: **Overdue / Due now / Needs decision** are buttons that open their list (hidden until
      clicked); each item has **Add to prescription** (opens today's visit, started if needed, with the item added
      unsaved to Tests advised, Advice or the medicines – the doctor checks and saves) and **Remove** (Not needed,
      with a reason). Files: `PatientDetailPage.jsx`, `RiskCard.jsx`, `CarePlanCard.jsx`, `VisitPage.jsx`,
      `PrescriptionForm.jsx`, `server/src/careplans/risk.js`, styles. Tests all passing; not yet checked on screen.
    - **Smart features 1–3 (no AI)** (2026-09-30, plan in `docs/AI_FEATURES_PLAN.md`):
      1. **Red-flag alerts + Today's worklist.** Red flags come from the values recorded at the latest visit (BP, Hb,
         urine albumin/sugar, fetal movements, FHR, SpO₂, temperature, pulse, oedema, presentation, fundal height vs
         weeks, weight gain per week, and 41+ weeks today), using the hospital's **Red-flag rules** (Care plans →
         Red-flag rules): 21 DRAFT rules prepared from FOGSI / WHO / MoHFW / NICE / RCOG guidance – a doctor edits
         and approves them. Shown on the visit page, as a "Red flag" pill in the patient header and a card on the
         Overview, and on the new **Worklist** (left menu): red flags, care plans to act on, visits today. Worked out
         when read (never stored). Files: `server/src/redflags/`, `routes/redFlagRules.js`, `routes/worklist.js`,
         `client/src/pages/redflags/`, `pages/worklist/`.
         (Widened in October 2026: flags also come from lab results, postnatal and newborn visits and the nursing
         chart of a patient in hospital; 55 draft rules, now under Clinic library → Clinical rules – see Next.)
      2. **Medicine safety check.** The hospital's **Medicine safety** list (Prescription sets → Medicine safety):
         35 DRAFT entries (avoid / caution by weeks, e.g. ACE inhibitors, warfarin, NSAIDs from 20 weeks; and
         combinations such as iron with calcium) from BNF / FDA-TGA categories / FOGSI / MoHFW – a doctor edits,
         adds local brands and approves. The prescription warns while writing (and checks recorded allergies for every
         patient); a warning never blocks saving. Files: `server/src/medsafety/`, `routes/medicineSafety.js`,
         `client/src/pages/medsafety/`. (111 entries since 4 Oct 2026: usual maximum doses, breastfeeding and
         newborn entries were added – see Next.)
      3. **Follow-up reminders.** "Reminder" on the worklist and "Send a reminder" on the Care plan box: a message
         in English, मराठी or हिंदी (appointment set at the last visit, or the care plan's next visit; items due or
         overdue; what to bring; danger signs; the hospital phone). Staff copy it and open her WhatsApp chat – nothing
         is sent automatically and nothing about the patient goes into a web address. Marathi and Hindi wording to be
         checked by fluent speakers. Files: `routes/reminders.js`, `client/src/pages/reminders/`. (An automatic,
         general "a check-up or test is due" message for overdue items was built on 4 Oct 2026 – see Next. This
         hand-prepared reminder stays as it is.)
      Automatic tests: server 397 and website 1,369, all passing. Not yet checked on screen (the preview was logged out).
    - **Smart features 4–9 (AI, OpenAI – the owner's choice)** (2026-09-30). Off until the administrator puts an
      OpenAI key in `server/.env` (`OPENAI_API_KEY`; models `gpt-5.5` and `gpt-5.4-mini`, changeable there – since
      2 Oct 2026 only reading reports uses `gpt-5.5`, everything else the cheaper `gpt-5.4-mini`).
      For the treating (or unassigned) doctor and RMOs. The AI is never told her name, phone, address or patient
      number (typed notes are scrubbed of her name and phone-like numbers; private notes are never sent), OpenAI
      is asked not to store requests, nothing is saved until a person checks it, anything about the baby's sex
      is withheld, and every use is in the audit log (feature, model, sizes – never the text).
      4. **AI summary** on the visit page: 4–6 points (weeks, risk, what changed, what is due, what is missing).
      5. **Translate the advice** (visit → Doctor's notes): Marathi or Hindi, editable, "Add below the advice".
      6. **Write a letter** (patient header): referral, discharge summary or fitness note drafted from the record;
         edit, copy or print on the letterhead. Not saved.
      7. **Check the typed notes with AI** (Risk level box): risk factors found in free text, each added only
         when the doctor clicks "Add to the record".
      8. **Read a lab or scan report** (visit → Doctor's notes): photo/PDF → values to check → added to the
         examination notes (and the Hb to the vital signs). The file is not kept. Crop out names before the photo.
      9. **Ask your records** (Worklist → Ask your records): only the question goes to the AI; Perinexa runs the
         search on the records the person may see and says how it understood the question.
      Voice entry (owner's requests, 2026-09-30): **AI dictation** (a second button; OpenAI gpt-4o-transcribe with an
      obstetric word list; the text is read by the same reader and checks), **Use what was said** on a detail typed
      by hand, and **Ask AI where these belong** for the parts not understood – suggestions checked against a fixed
      list of fields and values (never name, phone, address or the private note; never the baby's sex), each filled
      only when the person taps "Yes, fill in". Also: a clearly said blood group is filled in; "live 2" is read as
      living children; the form warns when the LMP gives more than 42 weeks.
      **AI check before printing** (owner's choice 2026-10-01: automatic, gpt-5.4-mini, about ₹0.40 a prescription):
      Print or share on a visit saves, then the saved prescription is checked with the record (doses, durations,
      duplicates, pregnancy weeks, allergies, findings vs treatment). Points found: Correct it / Print as it is
      (audited). Not checked again until the prescription changes; never blocks printing.
      Files: `server/src/ai/`, `routes/ai.js`, `routes/aiAsk.js`, `client/src/pages/ai/`,
      `pages/worklist/AskRecordsPage.jsx`. Tests use a stand-in for OpenAI (no real calls): server 449 and website
      1,412, all passing. Before real patients: OpenAI's India option stores data in India but may process it
      abroad – needs the data agreement and a review (see `docs/AI_PROVIDERS.md`).
  - ✅ Calendar (at the owner's request). **Calendar** in the left menu for doctors, RMOs and reception. Day, week
    and month views, with Previous / Today / Next and filters. What it shows:
    - **Booked visit:** the next-visit date set when a visit was saved. A later visit replaces the booking.
    - **Plan visit:** each care-plan visit on the day its due window opens, or on the day it was attended. The
      due window and status (due now, upcoming, overdue, missed, attended) are shown with it.
    - **EDD and LMP:** for current pregnancies (the scan EDD when recorded).

    Who sees what:
    - Doctors see their own patients, with a switch to all patients; other doctors' sensitive records stay hidden.
    - RMOs see all patients.
    - Reception sees names, patient numbers, phones and visit dates only ("Visit due", "Booked visit") – never
      LMP, EDD, weeks or visit names.
    - Nurses, lab and admin-only staff have no calendar.

    Nothing is written to the audit log for viewing the calendar (the same as the patient list). Files:
    `server/src/calendar/`, `routes/calendar.js`, `client/src/pages/calendar/`. Automatic tests: server 438 and
    website 1,410, all passing. Checked in the browser as a doctor, RMO, reception, nurse and admin, at 1366 × 768
    and phone width.

  - ✅ Feature 11: **Analytics** (at the owner's request: "build analytics – super admin should be able to see and
    RMOs should not see this"). A new **Analytics** item in the left menu (after Calendar; after Today for a hospital
    admin) with five tabs: Overview, Pregnancy, Risk & conditions, Care plans & visits, Newborn (a sixth tab,
    Deliveries, was built in October 2026 – see Next) – 24 cards and six headline numbers (active pregnancies, due
    in the next 4 weeks, high-risk, pregnancies booked, visits, babies registered). Merged with the Calendar, Today
    page, Smart features and Knowledge base on 1 Oct 2026.
    - **Who sees what** (decided by the owner): **doctors** see exact numbers of the patients whose details they may
      open, can switch to "My patients", and can click a number to see the patients behind it – every list opened is
      recorded in the audit log ("Patient list opened from Analytics", with the patients' ids only). Patient lists are
      only for doctors. **Hospital admins** see whole-hospital numbers for whole finished months; 1–4 read "fewer than
      5", some other numbers read "Not shown" so a small number can't be worked out, the condition-by-condition rows
      are only for doctors, and numbers can't be clicked. **The super admin** has its own **Analytics** item: exact
      totals per hospital and for all active hospitals together, for whole finished months – never an id, a name, a
      record number or a list. **RMOs, nurses, reception and lab staff** have no Analytics: no menu item, and the
      server refuses them.
    - **Kept in memory for speed** (numbers only, never a patient list): a doctor's page for 60 seconds (per doctor);
      a hospital admin's numbers for 10 minutes (per hospital and day); the super admin's pages for 5 minutes (per
      page, hospital choice, period, type of care and hospital date – the same for every super admin, with no
      person's or patient's id in it). So a change can take up to 1, 10 or 5 minutes to show; the page says when it
      was worked out. Opening a kept page is still recorded in the audit log. The times can be changed in
      `server/.env` (`ANALYTICS_CACHE_SECONDS`, `ANALYTICS_PLATFORM_CACHE_SECONDS`).
    - **Sex at birth** is counted only for babies already born (girls per 1,000 boys, "For information"), never
      before birth, never split by doctor or mother, and never in a list (PCPNDT). Before Analytics was built, three
      small server gaps that could have let a sex value be stored on a pregnancy record were closed.
    - Charts are drawn in the app (no new library), one colour per chart, each column chart with "Show as table".
      New colour "Chart grey" for "not recorded" rows (`docs/BRAND.md` → Charts and analytics).
    - the demo script (removed 12 Oct 2026) now adds about 60 more fake patients over the last 12 months to Sunrise General Hospital
      (Demo), so the cards look real and the admin view is not all "fewer than 5".
    - **What the numbers can't say yet** (told to the owner):
      - There is no delivery record, so no caesarean rate, normal vs caesarean delivery, stillbirths, deaths, PPH or
        Apgar (built in October 2026 – see Next: the Deliveries tab counts them). "Babies registered" counts babies
        registered in Perinexa, which can include babies born elsewhere and registered later, so past months can
        still change.
      - Antenatal records stay "active" until someone acts: a woman who delivered but is still marked antenatal,
        with no closed care plan, shows as "past the due date" or "not seen recently" and under "Records to tidy
        up". Closing her care plan as delivered removes her from the pregnancy numbers.
      - "Pregnancies booked" uses the booking date on each care plan; patients registered before care plans
        existed, or with no dates, fall back to their first antenatal visit.
      - The date a type of care changed isn't stored, so registrations use the type at the first visit.
      - Gestation depends on the EDD on the record: visits outside 0–45 weeks of the current EDD are treated as an
        earlier pregnancy and left out. Gestation at birth needs the mother linked to the baby.
      - Missing isn't "none": conditions and risk show "known for x of y"; low numbers often mean "not recorded".
      - Care-plan numbers are only as good as the ticking. Hb, BP and urine come from visits only (not from lab
        results typed into the care plan).
      - The sex ratio swings a lot by chance in one hospital (with 500 babies, 800 to 1,135 is normal chance).
      - Doctors' numbers leave out other doctors' sensitive records, so two doctors can see slightly different
        whole-hospital numbers (the page says how many are left out).
      - Hospital admins: "fewer than 5", "Not shown" and whole months stop casual reading, but the "as of today"
        numbers change day by day, so a determined admin comparing days with the audit log could sometimes tell
        that one record changed – that is why diagnosis-level rows are kept from admins.
      - For a hospital with only a few patients, the super admin's exact numbers describe those few women closely,
        even without names (open question Q-A below).
    Files: `server/src/analytics/` (roles, period, load, facts, visibility, registry, compute, publicCards, mask,
    adminView, listService, platformTotals, auditThrottle, sectionCache, metrics/*), `server/src/routes/analytics.js`,
    `platformAnalytics.js`; `client/src/pages/analytics/`, `client/src/components/charts/`,
    `client/src/styles/pages-analytics.css`; the demo script (removed 12 Oct 2026).
    Automatic tests (after joining main): server 630 (plus 4 performance tests that run only on request) and
    website 1,454, all passing. The screens were checked as a doctor, a hospital admin and the super admin at
    1366 × 768 and phone width with made-up numbers; the owner's own check in the browser is still to do ("How to
    test Analytics" below). Speed: see "Analytics speed" below.

## Plan agreed on 1 Oct 2026: making the app simpler and safer
A page-by-page review found that the safety features are there but hidden among too much text and too many
equal buttons. Nothing is removed – rarely used things move into "More" menus, folded sections or help icons.
Agreed order (one step at a time, each tested and committed):
1. ✅ **Patient safety strip** (allergies, blood group with Rh, EDD) at the top of every patient screen,
   including visits and prescriptions; **allergies must be answered** ("None known" or the allergy) when the
   clinical details are saved. Allergies are now the first field of "Medical background", with a "None known"
   tick box. Records saved before this show "Allergies not recorded – ask" until a doctor or RMO answers it.
   Shown only to people who may see medical details. Files: `pages/patients/SafetyStrip.jsx`,
   `PatientForm.jsx`, `patientFormat.js` (`allergyStatus`). Automatic tests: website 1,429, all passing.
2. ✅ **Sign and finish a visit**: the treating doctor or an RMO presses **Sign and finish** (unsaved changes are
   saved first). Only the version on screen is signed; if someone saved meanwhile, it says who. After signing,
   nothing can be changed (vitals, notes, prescription, care-plan ticks) – also refused by the server. Doctors,
   RMOs and nurses can add a **correction or addition** below it, saved with name and time, never changed or
   removed. **History of this visit** (folded, at the bottom) lists who started, saved, signed, corrected and
   printed it – never what was written. A signed visit can still be printed or marked entered in error. The
   Visits list has a Signed / Not signed column. Files: `server/src/routes/visits.js` (sign, additions,
   history), `models/Visit.js`, `client/src/pages/visits/VisitSignature.jsx`. Tests: server 461, website 1,430.
3. ✅ **"Today" page** = Dashboard + Worklist + today's patients, built together with Feature 10. The left menu
   item "Dashboard" is now **Today**; the separate "Worklist" item is gone (its sections are on Today) and
   **Ask your records** is a tab under Patients. The "Coming soon" box and the "Registered" count are gone.
   In order, each for the roles it is for: red flags (doctors, RMOs, nurses) · **Today's patients** – booked
   for today, "Arrived · time" or "Expected", and who came without a booking; doctors and RMOs also see the
   visit's progress (vitals, seen by doctor); nurses see the visits started today · reception's call lists
   **Visits due now – not booked** and **Overdue – not booked** (with phone numbers; a patient booked for a
   later day or seen today is left out; first day of the window only) · care plan to act on · counts
   (high-risk, overrides to review, active staff). Server: `routes/today.js` (`GET /api/today`); website:
   `pages/TodayPage.jsx`, `pages/worklist/WorklistSections.jsx`.
4. ✅ **Patient search box** ("Find a patient") at the top of every screen for staff who work with patient
   records: type 2 or more letters of a name, phone or patient number; up to 8 matches appear (name, number,
   age, type of care, phone, risk where the person may see it); arrow keys + Enter or a click opens the record.
   Press "/" anywhere to start typing. What is typed never goes into the page address (browser history).
   File: `client/src/components/PatientSearch.jsx`. The old Dashboard page file was deleted (owner's OK).
5. ✅ **Fewer buttons and less text.**
   - **Help** switch (top of every screen, and My account → Appearance → Explanations; saved per person,
     hidden unless shown): 35 how-to paragraphs and most field hints are explanations. Always shown: safety
     notes ("not checked", "doctor decides", drafts), privacy notes (AI, private note), values worked out from
     what was typed (dates, weeks), and records (who, when).
   - Patient page: one main button – **Start today's visit** / **Open today's visit** (else Edit details) –
     and **More** (Edit details, Change doctor – now a small dialog, Mark sensitive, Write a letter, Emergency
     note). No Edit details tab. A second visit on the same day asks first.
   - Visit page: **Sign and finish**, **Print or share**, **AI tools** (summary, translate the advice, read a
     report) and **More** (Mark as entered in error). Print is no longer repeated in the bottom bars.
   - Voice entry is a **Dictate** button until opened (remembered on the computer), with **Hide** on the card.
   - Print preview: **Print**, and **Share** (Download PDF, Send on WhatsApp, Share PDF).
   - Patients page: what is typed in its search box no longer goes into the page address.
6. ✅ **Menu and settings.** Left menu: Today · Patients · Calendar · (Analytics) · **Clinic library** (was
   Knowledge base; each library page now has its own title) · **Hospital admin** (Staff, Audit log, Print
   letterhead – was three menu items) · **My settings** (was My account).
   - My settings: password, professional details (doctors and RMOs only) and appearance on **one page**;
     Prescription design only for doctors and RMOs; Voice words only for those who use voice entry.
   - Audit log (hospital admin and super admin): **one page** with a **Type** filter (Security, Access
     changes, Sign-ins, Patient record access) instead of five tabs; old addresses still work.
7. ✅ **More safety.**
   - **Check these values** under Vital signs and the Pregnancy check, as typed: BP raised (≥140/90) or severe
     (≥160/110) or low, anaemia (Hb <11 in pregnancy, <10, <7), fever (≥100.4 °F), SpO2 <95/<92, pulse,
     urine albumin and sugar, fetal heart rate outside 110–160, reduced or absent movements. Same limits as the
     draft red-flag rules (`client/src/pages/visits/vitalLimits.js`) – owner to review with those rules.
     (Since October 2026 a baby has its own temperature limits here and none of the adult ones – see Next.)
   - **Medicine safety:** an Avoid or Allergy warning asks for a one-line **reason for going ahead** before
     the prescription is saved (Caution does not). Kept with the prescription and shown with it later; the
     audit log gets the count only.
   - **AI check not done** is said in the print preview when the AI check can't run (before: nothing).
   - **Consent forms:** each printout shows **Signed copy received** (date signed, witness, where the paper is
     kept, recorded by) or **Signed copy not received yet** with **Record signed copy** (doctor, RMO or nurse;
     saved once, never changed; audited). Scanned copies come with the full Consents feature (version 2).
8. ✅ **Smaller clean-ups.**
   - Overview: a **Last visit** card at the top (BP, weight, Hb, diagnosis, medicines, next visit, signed),
     and the EDD shown once (the LMP's EDD only when the scan's is used).
   - Care plan tab: notes that need no action fold into **Notes about this plan**; Change booking date,
     Change protocol and Close plan are in a **Plan** menu.
   - Patients list: a **Red flag** pill beside the risk and a **Last visit** column (clinical staff).
   - Clinic library: **To approve** (doctors) – every draft in one list; Today shows a **To approve** count.
   - Prescription: starts with one empty medicine row; **Add medicine** also at the top; Route and
     Instructions folded behind "+ Route or instructions" until needed.
   - (Done later, in Group 1 below: red flags, medicine safety and risk rules grouped as "Clinical rules"; short
     code and source under Advanced.)

### Group 1 (after the simplification plan, 1 Oct 2026) ✅
- **Allergies required on the server** too, whenever the medical background is saved ("None known" is an answer).
- **Allergies printed on every prescription** with the patient's details (all 10 designs): the allergy, "None
  known" or "Not recorded".
- **Mark arrived** on Today (reception, nurses, doctors, RMOs; Undo the same day until a visit starts). The time
  shows on Today, the booking shows Arrived on the calendar, the patient leaves the call lists, and nurses see
  **Arrived – waiting** until her visit is started.
- **Patients list** sorted by the last visit for clinical staff (each patient keeps her last visit day); the filters
  fold behind **Filters**.
- **Clinic library → Clinical rules**: red-flag rules, medicine safety and risk rules together; short code and
  guideline source under **Advanced** on the edit pages.
- **Page descriptions** (what a page is for) are explanations too: shown only while Help is on. "A doctor must
  approve" lines on edit pages always show.

## Version 2 (started 1 Oct 2026; the owner asked for all of it without stopping)
1. ✅ **Inpatients – admission, rounds, delivery, operation and discharge notes, and the nursing chart.**
   - Patient page → **Stays** tab: **Admit** (the patient's doctor or an RMO: reason, ward, bed, time). One stay at a
     time; the header shows **In hospital · Bed n**.
   - A stay's page: **New document** (admission note, round note, delivery note, operation note, discharge card),
     the documents with their status, and the **nursing chart** (vital signs, medicine given, note – by nurses, the
     doctor or RMOs; corrected only by "entered in error" with a reason).
   - A document is a **draft** until signed: admission and round notes are signed by the doctor or RMO who writes
     them; **delivery, operation and discharge are confirmed by a doctor** (RMOs write them). Signed = locked;
     corrections are added below with name and time. Each prints on the letterhead with the signer's name and
     registration number ("DRAFT" until signed).
   - Confirming the **discharge card** discharges the patient. Confirming a **delivery note** records the delivery
     on her record (the postnatal plan will start from it) and offers to register the baby as a newborn.
   - **Today**: doctors see **Waiting for your confirmation** (their own and unassigned patients); doctors, RMOs and
     nurses see **In hospital**.
   - Server: `routes/admissions.js`, `routes/inpatients.js`, `inpatient/docSchemas.js`; website: `pages/inpatient/`.
   - Demo data (the demo script (removed 12 Oct 2026), owner runs it): Rekha Inpatient (Demo), admitted in labour, with a signed
     admission note, a delivery note waiting for Dr. Riley Demo, and nursing-chart entries.
2. ✅ **Care plans for every type of care** (not only pregnancy). Each has a **draft** standard template (Clinic
   library → Care plan templates) for the doctor to check and approve, with its sources:
   - **Postnatal** (WHO 2022 / MoHFW): starts by itself from the day of delivery – from the confirmed delivery note,
     or, for a delivery at another hospital, from **Edit → Delivery** (date and mode). Caesarean wound check only
     after a caesarean; anti-D only for an Rh-negative mother; sugar test after diabetes (since 4 Oct 2026 the
     sugar test and the first-week BP check also apply after GDM or high blood pressure found in the pregnancy –
     see Next).
   - **Newborn** (Government of India UIP schedule): starts by itself from the date of birth – the birth doses,
     6, 10 and 14 weeks, 9 months, 16–24 months, 5, 10 and 16 years, vitamin A.
   - **Gynaecology** and **Fertility**: a doctor or RMO presses **Start a care plan** (counted from that day).
   - The plan says "6 w 2 d after delivery / after birth / since the start" instead of weeks of pregnancy, the items
     are grouped by first 6 weeks / up to 1 year / after 1 year, and the printouts have their own titles.
   - When a pregnancy becomes postnatal, the antenatal plan is paused and kept (listed under Earlier care plans).
   - Server: `careplans/otherDrafts.js`, `startFor`/`otherFacts` in `planEngine.js`, `syncOtherPlan` and
     `startCarePlan` in `plansService.js`; tests `tests/careplans-other.test.js`.
3. ✅ **Lab module.** Patient page → **Lab** tab → **Order tests** (the patient's doctor or an RMO): common tests
   by group (CBC, Hb, blood group, ICT, HIV, VDRL, HBsAg, HCV, TSH, OGTT, sugars, HbA1c, LFT, RFT, ferritin,
   beta hCG, day 2–3 hormones, urine, urine culture, semen analysis, Pap smear) or any test typed by name, urgent
   or not, with a note to the lab.
   - **Lab** module (lab staff, nurses, doctors, RMOs): **Samples to take**, **Results to enter**, **Reported (last
     7 days)**, urgent first. Lab staff see only the patient's name, number and age.
   - An order: **Mark sample taken**; type each value (the flag Low / High / Abnormal is suggested from the usual
     range – a DRAFT list for the doctor to check – and can be changed); **Save for later** or **Report results**;
     **Attach the report** (PDF or photo, at most 5 MB, checked to really be a PDF or photo).
   - **Today → Lab results to review** (doctors): their own and unassigned patients, results outside the range
     first. **Mark reviewed** – a result outside the range needs a comment on what was done. Reviewed results
     tick off the matching care-plan items that are due ("from the lab result").
   - A change after the report needs a reason; the earlier results are kept (shown to doctors) and the result goes
     back for review. Cancelled orders stay with who, when and why. Every step is in the audit log (ids only).
   - Server: `lab/labTests.js` (the test list and usual ranges), `models/LabOrder.js`, `models/StoredFile.js`,
     `routes/lab.js`; website: `pages/lab/`.
4. ✅ **Scanned signed consents.**
   - **Scanned signed consent**: Consent forms tab → once the signed copy is recorded, **Attach the scan** (PDF or
     photo, up to 3 pages); it opens from the same line. All attached files share one store (`utils/storedFiles.js`):
     at most 5 MB, checked to really be a PDF or a photo, never changed or deleted, every opening in the audit log.
   - 2 Oct 2026 – At the owner's request the registers (PC-PNDT Form F and MTP), the hospital's PC-PNDT number and
     the ultrasound consent form were removed. Old records stay stored but are hidden. The app still never records
     or shows the baby's sex before birth.
     - Hidden hospital copies of the ultrasound consent: the built-in copy, any form copied from it (and copies of
       those copies), and any of the hospital's own forms that mention "Form F" as stored before 2 Oct 2026 (a form
       edited later is never hidden this way). A hospital form that only says the sex of the foetus is not
       disclosed stays listed. Their printouts on patients are kept but not listed.
       (`server/src/consents/retiredForms.js`)
     - Built-in wording without MTP: the risk rules about previous abortions now say "The A count may include
       losses that were not spontaneous – doctor to confirm", and the misoprostol safety note says "Only under
       protocol – management of miscarriage, induction of labour or bleeding after delivery." Hospitals whose
       risk rules or medicine safety list were not yet approved get the new wording by themselves; an approved
       one keeps its wording until a doctor edits it (Clinic library → Clinical rules → Risk rules, and
       → Medicine safety).
     - The fetal-sex check now also catches whole karyotypes such as "69,XXY" or "47,XXY" (not "10, X-ray").
5. ✅ **Monthly report (HMIS) and the owner's charts.** **Analytics → Monthly report** (doctors only; moved
   here from Registers on 2 Oct 2026): the month's numbers in the order of the HMIS monthly form – registrations
   and outpatient visits (first and follow-up), antenatal care (registered, in the first trimester, Td, Hb tested
   and anaemia, high BP, OGTT, syphilis, HIV, hepatitis B), deliveries (normal, assisted, caesarean, preterm), live
   births (male, female, under 2500 g) and still births, postnatal checks, admissions, discharges and operations,
   child immunisation by age, pregnancy loss (the Abortion type of care, counted by the date seen: miscarriage,
   ectopic and molar pregnancy; recurrent-loss work-up apart; surgical management in the month; records with no
   type of loss yet or an old threatened miscarriage), and scans and lab: **pregnancy scans done here** (scan items of antenatal care plans
   marked done in the month, not "done elsewhere") and lab tests. **Print the report** for the HMIS entry. Below
   it, the last 12 months as charts: registrations, visits, deliveries, caesareans, admissions.
   - Counts only, whole hospital. Doctors only: in a small hospital even a count (one HIV-positive mother) can
     point to a patient. Hospital admins have no Monthly report tab (the address answers "The monthly report is
     for doctors."); RMOs and nurses see only Ask your records under Analytics. Opening it records the month in
     the audit log ("Monthly report opened"), never a patient.
   - The numbers come from what is recorded in the app (confirmed delivery notes, care-plan items marked done,
     reported lab results): anything kept only on paper is not counted. Pregnancy scans count only scans ticked
     as done here in the care plan, not "done elsewhere".
   - Old links to `/registers` open the monthly report (a month in the link, `?month=2026-09`, is kept).
   - Server: `reports/monthlyReport.js` (routes `GET /api/analytics/report/monthly` and `/report/trend` in
     `routes/analytics.js`); website: `pages/analytics/MonthlyReportPage.jsx`.
6. ✅ **Automatic reminders and the patient portal.** Both are off until the hospital admin switches them on
   (Hospital admin → **Patient messages**).
   - **Reminders**: patient page → More → **Reminders and portal** → record her agreement (SMS or WhatsApp, and the
     language). The day before her booked appointment she gets: "<hospital>: your appointment is on <date>. To
     change it, call <phone>. Reply STOP …" – no name, no reason (a phone is often shared). Once an hour from
     10:00 the server queues and sends them. **Without a message provider** they wait in **Calendar → Reminders**
     under "To send by hand" (copy the message, open WhatsApp, Mark as sent). To send automatically, the owner
     puts Twilio keys in `server/.env` (see `.env.example`); in India SMS also needs DLT registration of the
     sender and wording, and WhatsApp needs approved templates. Marathi and Hindi wording: to be checked.
     (Two more automatic messages – "a check-up or test is due" and "we missed you" – were built on 4 Oct 2026
     under the same switch and the same agreement – see Next.)
   - **Patient portal** (deliberately small): staff make a code for her (same dialog) and print it for her. At
     `/portal` she signs in with the code and the last 4 digits of her mobile, and sees only her next appointment
     and the coming care-plan items in plain words, with the hospital's phone – no results, notes, diagnoses,
     risk or documents. Codes last 90 days, can be withdrawn, lock for 30 minutes after 5 wrong tries; the
     session ends after 15 minutes; every sign-in, failed try and view is in the audit log. (Since October 2026
     the portal and the paper with her code are also in Marathi and Hindi – see Next.)
   - ⚠️ **Privacy risks, for the owner:** a portal puts patient information on the internet. Before switching it
     on for real patients: run the app on a secure (https) address, have it reviewed by an experienced developer
     (security test of the sign-in), tell patients how their data is used and get their consent (Digital
     Personal Data Protection Act 2023), and keep the portal to what it shows now. Reminders: only with recorded
     consent, and keep the wording free of medical details.
   - Server: `reminders/`, `models/ReminderMessage.js`, `routes/reminderOutbox.js`, `models/PortalAccess.js`,
     `routes/portal.js`; website: `pages/reminders/`, `pages/portal/`, `pages/patients/PatientMessagesDialog.jsx`,
     `pages/settings/PatientMessagesSettingsPage.jsx`.

**Version 2 is complete** (1 Oct 2026). Every part is marked DRAFT where clinical or legal wording needs the
owner's or an expert's check: the care-plan templates, the lab's usual ranges, the HMIS rows, the reminder wording in Marathi and Hindi. Use fake data only until the app has been reviewed.

## Next
- **Layout agreed, nothing built – a new patient as a history-taking sheet (27 Oct 2026).** The owner asked that the tabs
  for a new patient's details ask only for the history, with every hint, example, voice panel, risk warning and AI
  check hidden, and that the layout be agreed before anything is built. The draft is in
  `docs/HISTORY_SHEET_LAYOUT.md` (one page in the words of the owner's paper template, a Dictate button, three drop-downs
  for the rest, what is hidden, what stays for safety, and the owner's nine decisions of 27 Oct 2026 – among them
  one printed page in template form with history, vitals and prescription, drafted as board 3 of the mock-up and its five points decided) with a click-through
  mock-up (link in the document). **Nothing is built**; the feature pause holds until the owner and the developer
  decide whether and when it goes ahead.
- ✅ **ABDM milestones M2 (share her records through ABHA) and M3 (fetch her records from other hospitals), in
  practice mode** (built at the owner's request, October 2026). The two steps after ABHA linking (M1, below). Like
  M1 it works only in **practice mode** for now: a built-in stand-in for ABDM, and nothing leaves the computer.
  - **Sharing her records (M2)**: Patient record → **ABHA** tab → card **Her records in ABHA** (once her ABHA is
    linked). It lists her signed visits (shared as a consultation, plus a prescription when it has medicines), lab
    results a doctor has reviewed, and confirmed discharge cards. Each has a status with its reason: **Can be
    linked**, **Linked**, **Waiting for ABDM**, **No answer from ABDM** or **Not linked** (both can be linked again),
    **Not yet**, **Never shared**, or **Linked – not shared now**. Tick records (or **Choose all that can be
    linked**), tick **She agrees…** → **Link to ABHA**. She can also link them from her ABHA app: it finds her only
    through the ABHA linked to her record, and an OTP goes to the mobile number on her record. Her app shows only the
    kind and date of each record ("OPD visit on 21 Sep 2026"), never a test name or a diagnosis.
  - **Consents and what was sent** (same tab): each consent she gave in her ABHA app – who asked, the kinds of
    records, the dates, until when, and **Consent given**, **Withdrawn**, **Expired** or **Refused** – and under it
    each time records were asked for: **Sent** (N records, M documents), **Nothing sent** (with why), **Not sent** or
    **Being sent**. Records go out only under a valid consent, only for its kinds and dates, and each one is checked
    again just before it is sent.
  - **Her records from other hospitals (M3)**: a second card on the ABHA tab. **Ask for her records from other
    hospitals** → kinds of record (7), **Records from** / **Records to** (today at the latest), **Consent lasts** (7
    days to 1 year) → **Send the request to her ABHA app**. Nothing comes until she agrees in her app. Each
    hospital's answer has a status (Waiting for the records, N documents received, Not received, Deleted); **Fetch
    again** when its records failed or nothing came for 30 minutes. **Records received** → **Read** opens a document
    read-only (medicines with dose, results with Low/High, diagnoses, procedures, vaccinations, notes), with
    **Download** for an attached PDF, JPEG or PNG of at most 10 MB.
  - **Practice buttons**: under **Try it in practice mode**, **As her ABHA app: find and link her records** (OTP
    123456) and **As another hospital: she gives a consent** ("Sample Clinic (practice)"); on a practice consent
    **The other hospital asks again (practice)**, **She withdraws the consent (practice)** and **See what was
    received**. For M3, **Practice: she approves**, **Practice: she refuses**, **Practice: she withdraws her
    consent** and **Practice: her consent ends now**; two made-up hospitals ("Sample City Hospital (practice)" and
    "Sample Town Lab (practice)") send 5 made-up documents, each marked **Practice – made up**.
  - **Hospital admin → ABDM**: new cards **Sharing her records through ABHA** (the bridge URL to register with ABDM
    – "Not set yet" until the server has a public address –, the addresses ABDM calls, and the draft list **Words
    that mark a record as about HIV**) and **Her records from other hospitals**; two new lists under "To check with
    ABDM's sandbox documentation". A HIP ID another hospital already uses is refused.
  - **Who may use it**: only doctors and RMOs who may see her medical details see the two cards (another doctor
    read-only; another doctor's sensitive record not at all). Linking, asking, **Fetch again** and the practice
    buttons: her doctor (any doctor when she has none) or an RMO. Reception sees her ABHA but neither card; nurses,
    the lab, the pharmacist and the hospital admin never see them.
  - **Never shared through ABHA** (also listed on her ABHA tab): anything of a record marked sensitive (infertility
    records are marked sensitive when registered); the HIV test, any record that mentions HIV, and her visits and
    discharge summaries when HIV is among her known conditions; the doctor's private note; the reasons given to go
    ahead despite a medicine warning; the review comment on lab results and the note to the lab; report files, scan
    reports, admission, round, delivery and operation notes, care plans, consent forms and bills (of a stay only the
    discharge summary); anything unsigned, unreviewed, changed since review, entered in error or cancelled. A record
    marked sensitive or changed after linking is held back at the moment of sending.
  - **Records from other hospitals – safety**: read-only, never copied into her records here, never sent on, not in
    the copy of the whole record or in the hospital export. Deleted when her consent ends (checked every 15 minutes
    and whenever they are opened) and at once when she withdraws it. A sentence that may mention a baby's sex is
    withheld before it is saved, for every patient who is not a baby, and the screen says how many; files cannot be
    checked for that, and a warning says so. Only real PDF, JPEG or PNG files are offered; a web page or a link to
    another website never. The download is always named "record-from-another-hospital". No new request on a record
    closed after a death or on a duplicate record.
  - **Audit log**: new events in plain words, ids and counts only, never content – "Records linked to her ABHA",
    "Records sent through ABDM", "Request for her records refused", "Consent from her ABHA app received", "Her ABHA
    app looked for her records", "Records linked to her ABHA opened", "Her records asked for from other hospitals",
    "Her answer to a request for her records", "Records received from another hospital", "Records from other
    hospitals opened" and "… deleted". The earlier ABHA events (verified, linked, created, unlinked, card printed,
    Scan & Share) now have plain names too.
  - ⚠️ **DRAFT for the doctor to check**: the HIV word list (Hospital admin → ABDM): HIV, AIDS, PLHIV, RVD, retro
    positive / negative / reactive / NR, antiretroviral, ART centre, PPTCT, ICTC, NACO, SACS, Tri-Dot, CD4, viral
    load, and the antiretroviral medicines by name and abbreviation (TLD, TDF, 3TC …). It errs on the side of
    privacy: tenofovir and a viral load are also used for hepatitis B, so such a visit is held back too. "ART" alone
    is not on it (it also means assisted reproduction).
  - **Defaults the owner may want to change**: pregnancy-loss records are shared like other records unless marked
    sensitive; a record closed after a death can still be shared under a consent; the lab review comment is held
    back and only the discharge summary of a stay is shared; her app finds her only through the ABHA linked at the
    desk (never by mobile, name or year of birth); in real use the OTP goes by SMS through the reminders' Twilio
    setup (without it she is told to link at the reception desk); the Ask form starts with all 7 kinds, the last 12
    months and a 30-day consent; nurses do not see records from other hospitals; attached files are offered during
    a pregnancy.
  - **New on her record**: her ABHA details now also keep the gender and year of birth ABDM sends (ABDM asks for
    them when the hospital links records). An ABHA linked before 5 Oct 2026 needs **Verify her ABHA** once more
    before linking for real (not in practice mode). The hospital export has three new files (linked records,
    consents, what was sent) and one for what was asked for – references and counts only.
  - **Left out**: telling her ABHA app when something is added to a visit already linked; unlinking one record; how
    often a consent allows fetching (ABDM checks that); answering ABDM again when it repeats a request; "Delete now"
    and printing for records from other hospitals. The reason each record was held back is stored, but the screen
    shows counts only. What Sample Clinic received is kept in memory only (the last 20, gone after a restart).
  - ⚠️ **Before real use**: nothing has been tried against ABDM's sandbox (no credentials). Every request, the
    encryption and the documents are on the checklists for a developer (Hospital admin → ABDM). The documents were
    not run through the official FHIR validator, and the signature on a consent is not checked yet (on the
    checklist). Records sent by another hospital carry no signature to check: they are accepted only for a request
    the hospital is waiting for, and only those in her consent. Perinexa also needs a public https address, put in
    `server/.env` as ABDM_PUBLIC_URL (placeholders in `server/.env.example`, with ABDM_GATEWAY_CLIENT_ID).
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). The screens were rendered in tests and
    the website was built. The full run after the merge reported 1,350 server tests and 1,934 website tests passing
    (4 skipped on purpose, as before).
  - Files: `server/src/abdm/shareRules.js`, `abdmRecords.js`, `fhirRecords.js`, `fidelius.js` (the encryption),
    `fetchRecords.js`, `fhirReader.js`, `practiceHospitals.js`, `practiceClient.js`, `v3Client.js`;
    `routes/abdmRecords.js`, `routes/abdmFetch.js`; `models/AbdmCareContext.js`, `AbdmConsent.js`, `AbdmTransfer.js`,
    `AbdmLinkRequest.js`, `AbdmFetchRequest.js`, `AbdmFetchedRecord.js`; website `pages/abdm/AbhaRecords.jsx`,
    `AbhaFetched.jsx`, `ScanShare.jsx` (Hospital admin → ABDM). Tests: `server/tests/abdm-records.test.js`,
    `abdm-fetch.test.js`; website `pages/abdm/abhaRecords.render.test.jsx`, `abhaRecordsFormat.test.js`,
    `abhaFetched.render.test.jsx`, `abhaFetchedFormat.test.js`, `components/auditFormat.test.js`.
- ✅ **Care plans: a default protocol per doctor, apply a new template version to all plans, edit added items, "used
  by N plans"** (built at the owner's request, October 2026). Four things the care-plan plan had left for later.
  - **My default protocol**: Clinic library → **Care plans** → one of your own approved protocols → card **My default
    protocol** → **Make it my default** (or **Stop using as my default**). One default per doctor for each type of
    care; choosing another replaces the earlier one. Every new care plan of a patient assigned to you then starts
    from it instead of the hospital standard template: the first plan, a new pregnancy, postnatal, newborn,
    pregnancy-loss, gynaecology and fertility plans. The plan history says "Plan built from “…” version … – the
    default protocol of …". Choosing, changing or removing a default never changes plans that already exist. The
    template list and **Change protocol** on a patient's plan mark it **My default** (other doctors see **Default**).
  - **When a default is not used**: a draft cannot be made the default. If you edit your default (it is a draft again
    until you approve it), it has no items, or its doctor no longer works here as a doctor, the choice is kept but
    new plans start from the hospital standard template. The list then shows **Default – not in use** with the
    reason and a warning at the top; the protocol's page and its edit page say so too.
  - **Patients' plans** (a card on every template's page): "Used by N current plans. N of them use an older
    version." The template list has a new **Current plans** column. Counts only, never names. Paused plans are
    counted; closed plans, duplicate records and records closed after a death are not.
  - **Update plans to version N** (same card): once a template's version is approved. First a preview in counts
    only: how many plans, from which versions, items added, changed, removed or kept, items needing a decision,
    plans of other doctors' patients, paused plans. Then **Update N plans**: each plan is moved exactly as the
    single update on the Care plan tab – items done stay done, moved dates, notes and items added for the patient
    are kept. A message says what was done. At most 200 plans per press; the button offers the rest again.
  - **Edit item**: Care plan tab → an item added for this patient → **More** → **Edit item**: name, text for the
    patient's copy, due window (weeks or dates), note → **Save changes**. Only while the item is open and the plan
    active. Not for a protocol's own items (move the date, add a note or mark it not needed, as before), not for a
    done item (reopen it first) or a not-needed one. **Details** → History shows "Edited" with what it was; the
    plan history says "Item “…” (was “…”) changed: name, due window." In Add item and Edit item a plan that is
    not a pregnancy now says "Weeks after delivery", "Weeks after birth" or "Weeks since she was seen".
  - **"May repeat"**: when an update or a change of protocol adds an item of the same type at the same time (or with
    the same name) as one the plan already has, the new item shows **May repeat “…”** and counts under Needs
    decision (for pregnancy and pregnancy-loss care also on **Today** → **Care plan to act on**). **Keep as
    planned**, or **Not needed** on one of the two, clears it. It never stops the item being due or on reminder
    lists. This now also happens with **Update to version N** and **Change protocol** on one patient's plan.
  - **Who may use it**: only the doctor who owns a protocol makes it their default. Update all plans: for the
    standard template any doctor, for a protocol only its own doctor. It moves only the plans that doctor could
    also update one by one – their own patients and unassigned patients (every patient for a doctor who is also an
    RMO). Edit item: the patient's doctor or an RMO, as for Add item. Doctors, RMOs and nurses see the counts;
    nurses have no buttons.
  - **Safety and privacy**: closed plans, records closed after a death and duplicate records are never touched.
    Paused plans and other doctors' patients (sensitive records too) are counted and left for one-by-one updates by
    the patient's own doctor or an RMO. A protocol's plans whose patient now has another doctor are not moved; her
    doctor can switch the plan to the standard template or their own protocol. Each plan moved gets its own audit
    entry, as a single update ("Care plan changed – Record P-…: plan updated", ids only). There is no summary entry
    naming the template, because next to the per-plan entries it would show which patients use, for example, a GDM
    protocol. New audit entries: "Protocol made a doctor's default" and "Protocol no longer a doctor's default"
    (the protocol's name and version, never a patient), and "Record P-…: added item edited" (no item names).
  - ⚠️ **Nothing new for the doctor to approve**: no medical content was added. The templates stay DRAFT as before;
    only an approved protocol can be a default.
  - **Defaults the owner may want to change**: only patients assigned to a doctor start from that doctor's default
    (an unassigned patient starts from the standard template, even when a doctor with a default starts her plan);
    one doctor updates only their own and unassigned patients' plans; paused plans are left out of the update (but
    counted under "used by"); nurses see the counts; 200 plans per press.
  - **Left out**: editing the type of item and the reason for adding; editing a protocol's item on one patient's
    plan; a summary audit entry for an update of all plans (on purpose, see above).
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). The screens were rendered in tests and
    the website was built. Not covered by tests: the 200-plans limit and a plan changed by someone else during the
    update (the code counts both as left as they were). The full run after the merge reported 1,291 server tests
    and 1,910 website tests passing (4 skipped on purpose, as before).
  - Files: server `careplans/defaultProtocol.js`, `plansService.js`, `planEngine.js`, `planView.js`,
    `planSchemas.js`, `hashes.js`, `models/CarePlanTemplate.js`, `models/CarePlan.js`, `models/AuditLog.js`,
    `routes/templates.js`; website `pages/careplans/TemplatesPage.jsx`, `TemplateDetailPage.jsx`,
    `TemplateEditPage.jsx`, `UpdatePlansDialog.jsx`, `templateFormat.js`, `pages/patients/CarePlanTab.jsx`,
    `carePlanDialogs.jsx`, `carePlanFormat.js`, `customItemFormat.js`, `components/auditFormat.js`. Tests:
    `server/tests/careplan-protocols.test.js`, `careplan-engine.test.js`;
    `client/src/pages/careplans/templateFormat.test.js`, `templatePages.render.test.jsx`,
    `pages/patients/customItemFormat.test.js`, `editItem.render.test.jsx`, `repeatItem.render.test.jsx`,
    `carePlanFormat.test.js`, `components/auditFormat.test.js`.
- ✅ **Marathi and Hindi for what the patient reads: care-plan sheet, discharge card, patient portal** (built at the
  owner's request, October 2026). Before this her care-plan sheet, her discharge card and the portal were in English
  only. Staff copies stay in English.
  - **Care-plan sheet**: Care plan tab → **Print** → **Patient copy** → **Preview**: under the title, **Language for
    the patient** – English · मराठी · हिंदी. Marathi or Hindi prints under the English (or after it, with " / ", for
    short labels), in the style of the prescriptions and consent forms: the titles, labels, the 99 built-in
    care-plan items, the Draft band and the note at the end. **Change what is printed** keeps the language. The
    **Staff copy** has no choice.
  - **Discharge card**: a stay → the discharge card → **Print**: the same choice. The card's own words, and each
    medicine's dose, how often, before or after food and how long (the prescriptions' words), print in her language.
    Admission, round, delivery and operation notes print in English, with no choice.
  - **Paper with her portal code** (More → **Reminders and portal** → **Print it for her**): the same choice.
  - **Patient portal** (`/portal`): English · मराठी · हिंदी at the top of the sign-in page and her page; the phone
    remembers her choice. Without a choice it uses the language of her reminders once she has signed in, and keeps
    it when she signs out or is timed out. Built-in care-plan items show in her language; error messages too.
  - **Which language a printout opens in**: the language recorded under Reminders and portal, but only while she
    agrees to reminders; otherwise English.
  - **Who may use it**: everyone who could already print the care plan or the discharge card, or make her portal
    code. Nothing new to switch on.
  - ⚠️ **DRAFT for fluent speakers and the doctor to check**: all the Marathi and Hindi. `docs/TRANSLATIONS_TO_CHECK.md`
    lists every line next to its English, with tick boxes (a test fails if a line is missing from it). The print
    previews, Hospital admin → **Patient messages** and a note at the top of the portal say the wording is a draft.
  - ⚠️ **New English for the doctor to approve**: the note at the end of the patient copy now depends on the type of
    care. Pregnancy: word for word as before. After a delivery or for a baby: the dates count from the day of
    delivery or birth, then the danger signs of the plan's own advice item, in the template's words (they follow
    your template edits). Gynaecology, fertility and pregnancy loss: "…from the day this plan started…" and "In an
    emergency, go to the hospital straight away." Until now every copy, a baby's too, ended with the pregnancy note
    about leaking of water and the baby's movements.
  - **Safety and privacy**: the English is always printed. Nothing staff typed is translated – the doctor's advice,
    the diagnosis, notes, names, and an item a doctor added or reworded print as typed; the preview says how many
    items print in English only. The portal is never sent an item's code (a code such as scan_growth_gdm names a
    diagnosis), only whether its wording is still the built-in one. In Marathi or Hindi the portal never shows an
    English error sentence she may not read. The audit log adds only the language: "Care plan printed – … patient
    copy, in English and Marathi", "Document printed – …, in English and Hindi". The server refuses another language
    for the staff copy and for every inpatient document except the discharge card.
  - **Defaults the owner may want to change**: printouts and the portal open in the language of her reminders
    (English without her agreement); the draft note at the top of the portal; numbers stay in figures in Marathi and
    Hindi.
  - **Left out**: the pregnancy-loss template's 23 items and "Check-up or test – your doctor will explain" have no
    Marathi or Hindi yet (they print and show in English, and the preview counts them); the letterhead, "Reg. No."
    and the page footer stay in English, as on the prescriptions; doctors cannot type their own Marathi or Hindi for
    an item (only the developer can change it); the AI **Discharge summary** letter, which is for other doctors.
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). The printouts were checked as A4 PDFs
    and the portal at phone width. The full run after the merge reported 1,272 server tests and 1,885 website tests
    passing (4 skipped on purpose, as before).
  - Files: website `client/src/components/print/printLanguage.js`, `Bilingual.jsx`,
    `pages/careplans/itemTranslations.js`, `pages/patients/CarePlanPrint.jsx`, `carePlanPrintFormat.js`,
    `PatientMessagesDialog.jsx`, `pages/inpatient/DocumentPage.jsx`, `dischargeWords.js`,
    `pages/portal/PortalPage.jsx`, `portalWords.js`, `pages/settings/PatientMessagesSettingsPage.jsx`,
    `components/auditFormat.js`; server `careplans/planSchemas.js`, `plansService.js`, `routes/admissions.js`,
    `routes/portal.js`, `utils/auditDetails.js`; the checklist `docs/TRANSLATIONS_TO_CHECK.md`. Tests:
    `server/tests/portal.test.js`, `careplan-print.test.js`, `admissions.test.js`;
    `client/src/translationsToCheck.test.js`, `components/print/printLanguage.test.js`,
    `pages/careplans/itemTranslations.test.js`, `pages/patients/carePlanPrintFormat.test.js`,
    `carePlanPrint.render.test.jsx`, `pages/portal/portal.test.jsx`, `pages/inpatient/inpatient.test.jsx`,
    `components/auditFormat.test.js`.
- ✅ **Pregnancy-loss care: findings as fields, care plan with hCG follow-up, red flags, prescription sets,
  recurrent-loss test package** (built at the owner's request, October 2026).
  Before this an Abortion (pregnancy loss) record had no care plan, the os, the scan and signs of rupture could only
  be written in the notes, and no red flag, ready-made set or test package was made for it.
  - **Findings as fields**: a pregnancy-loss patient → **Edit details** → **Pregnancy loss** → **Findings**.
    Examination: cervical os, products of conception seen, bleeding (light, moderate, heavy), fever with
    foul-smelling discharge. Scan: gestational sac seen in the uterus (Yes, No, or "Not now – an earlier scan showed
    it"), mean sac diameter and crown–rump length in mm, heartbeat, adnexal mass, free fluid. For an ectopic or a
    pregnancy not yet located: **Signs of rupture**. All optional and fixed answers only – nothing typed, so nothing
    about the baby can be written. Each value keeps who recorded it and the date; a changed or cleared value stays
    under **Earlier entries** – nothing is deleted. The Overview's **Pregnancy loss** card lists them. On a
    pregnancy-loss visit the card **Findings of this pregnancy loss** → **Record findings** (or **Change findings**)
    → **Save findings to her record** does the same. A record only for the recurrent-loss work-up has no findings.
  - **Another loss on the same record**: a date seen moved by more than 8 weeks is another loss. The form warns
    first; the findings start empty (the old ones stay as earlier entries); the care plan of the earlier loss is
    closed (under Earlier plans) and a new one starts. If the date was only mistyped, close the new plan and
    **Reopen** the old one – it then counts from the date on the record.
  - **Care plan** (Care plan tab → **Pregnancy-loss care plan**): starts by itself from the **Date seen** (the hint
    under it says so) – for patients registered earlier too, the next time the record is opened. Which items apply
    follows the type of loss, its management, the anti-D answer and the Abortions (A) count; an item that does not
    apply says why. Every loss cared for now: a follow-up visit at 1–2 weeks, haemoglobin, contraception, advice for
    the next pregnancy. Molar pregnancy: beta hCG every 2 weeks to 8 weeks, then at 3, 4, 5 and 6 months, and no new
    pregnancy until the follow-up ends. Ectopic managed by waiting: beta hCG on days 2, 4 and 7, then weekly to week
    6; with methotrexate: days 4 and 7, then weekly; after an operation: none. Rh-negative woman: anti-D, which is
    recorded only in Edit details → Pregnancy loss → Anti-D (the plan row has no **Mark done** and says where). From
    the third loss in Abortions (A): the recurrent-loss work-up ("check needed" at two). A work-up-only record gets
    only the next-pregnancy advice and the work-up. Her printed copy is titled "Follow-up care plan".
  - **Lab results tick the hCG tests**: a beta hCG result the doctor reviews ticks the molar test or weekly ectopic
    test whose window holds the day the sample was taken (or the one before, if she came late and it is still open).
    One result ticks one test – reviewing a corrected result again ticks nothing more – and a test she missed is
    never filled in by a later result: the doctor marks it done elsewhere or not needed. The doctor ticks the ectopic
    day 2, 4 and 7 tests (they fall in the week of the first hCG) and the work-up item (it includes a scan).
  - **Today → Care plan to act on** now lists pregnancy-loss plans with something overdue, due or waiting for a
    decision (due in the last 6 weeks or later), marked "Abortion". **Reminder** there prepares a message in the
    patient's own words, which never name the loss. No automatic "a check-up or test is due" message goes out from a
    pregnancy-loss plan. The portal, her printed copy and the visit printout never name the loss either (an item a
    doctor added without words for the patient shows "Check-up or test – your doctor will explain").
  - **8 DRAFT red-flag rules** (Clinic library → Clinical rules → Red-flag rules, under Abortion (pregnancy loss)):
    **Possible ruptured ectopic pregnancy** – an ectopic or a pregnancy not yet located with a pulse over 110 or a
    systolic BP under 90 at a visit, or "Signs of rupture: Yes"; **Possible septic abortion** – temperature 100.4 °F
    or more with a pulse over 110, or fever with foul-smelling discharge ticked; **Heavy bleeding** ticked; **Severe
    anaemia after pregnancy loss** – Hb under 7 at a visit or from the lab. A flag from a finding says "from her
    record, <date>" and counts for 3 months. "Not yet located" is only a complete miscarriage with no sac seen now or
    on an earlier scan and no products seen. Once an operation is recorded with its date, or the outcome is
    "Treatment complete", the ectopic flags stop (a rupture tick recorded after the operation still counts). A
    work-up-only record is not checked by any rule (in hospital, her stay page and Today say why). Hospitals whose
    rules are an untouched draft get the 8 by themselves; where a doctor approved the rules, press **Add them as a
    draft** first – until then the screens say the findings raise no red flag.
  - **4 DRAFT prescription sets** (Clinic library → Prescription sets; on a pregnancy-loss visit they come first):
    "Complete miscarriage – after the loss"; "Missed miscarriage (diagnosed) – medical management with misoprostol"
    (800 mcg in the vagina, a second dose after 3 hours only if told); "Incomplete miscarriage (diagnosed) – medical
    management with misoprostol" (600 mcg by mouth, once); "After surgical evacuation for a miscarriage (at
    discharge)". Pain relief in each; iron for 3 months after a complete miscarriage and after evacuation; no
    mifepristone, antibiotic or anti-D (the notes say why). Each says it is for a miscarriage already diagnosed, never
    for ending a continuing pregnancy. Chosen for a patient of any other type of care, a set shows a warning (it never
    blocks).
  - **Lab**: a DRAFT package **Recurrent pregnancy loss work-up** (Clinic library → Test packages): lupus
    anticoagulant, anticardiolipin IgG and IgM, anti-beta-2-glycoprotein I, TSH, TPO antibodies and HbA1c (karyotype
    and the scan of the uterus only in its notes). New tests: those antibodies (a new "Antibodies" group) and **Serum
    bile acids (total)** under Biochemistry (High from 19 µmol/L); the price list has them at ₹0. Numbers are typed as
    the report gives them: "1,23,456" is saved as 123456; "1,500" is refused with a question (1500 or 1.5?);
    "1,40,000" in a field such as platelets (lakh/µL) is refused with the unit. A number with no usual range (beta
    hCG, LH, the antibodies) is "Not flagged", never "Normal". Lab staff see the tests of an order, not the package
    name.
  - **Copy of the whole record** has the findings and their earlier entries; the AI brief reads the current ones.
  - ⚠️ **DRAFT for the doctor to check and approve**: the template "Care after pregnancy loss (NICE / RCOG / FOGSI /
    ESHRE) – DRAFT" (Clinic library → Care plans – listed first, above the antenatal one), the 8 red-flag rules, the
    4 sets, the work-up package, the bile-acid limit and the findings hints (what counts as "not yet located"). Each
    names its source – please check the sources too before approving.
  - **Safety and privacy**: only her doctor (any doctor while she has none) or an RMO records findings – not from a
    signed visit and not on a record marked as a duplicate. Nurses and other doctors see them; reception, the lab and
    the pharmacist see only "Abortion". The audit log says "Findings of the pregnancy loss" changed, never the value.
    Nothing about MTP, Form F or PC-PNDT was added.
  - **Defaults the owner may want to change**: the work-up from the third loss (one setting); no automatic message
    from a pregnancy-loss plan (one line); 8 weeks for "another loss"; a finding raises its flag for 3 months; pulse
    "over 110"; the molar hCG tests counted from the date seen, not from the evacuation.
  - **Left out**: a methotrexate set and a threatened-miscarriage set (on purpose); which operation was done for an
    ectopic (after a salpingotomy, include the hCG items yourself); a shock rule for a loss in the uterus; voice entry
    for the findings; results such as "<2" as numbers. The cholestasis information sheet still says there is no
    bile-acid test (changing it needs a new version of the consent forms). A result typed "1,500" before this change
    was stored as 1.5 – check any such earlier result.
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). The website is covered by render tests
    and the build. The full run after the merge reported 1,264 server tests and 1,849 website tests passing (4
    skipped on purpose, as before).
  - Files: `server/src/patients/abortionRules.js`, `patients/lossFindings.js`, `models/Patient.js`,
    `routes/patients.js` (`PUT /:id/loss-findings`), `careplans/otherDrafts.js` (the template), `planEngine.js`,
    `plansService.js`, `templatesService.js`, `models/CarePlanTemplate.js`, `redflags/redFlags.js`,
    `redFlagService.js`, `routes/redFlagRules.js`, `routes/worklist.js`, `routes/reminders.js`,
    `reminders/reminderRules.js`, `visits/builtInSets.js`, `lab/labTests.js`, `lab/builtInPackages.js`,
    `routes/lab.js`, `patients/recordCopyView.js`, `ai/context.js`; website: `pages/patients/AbortionSection.jsx`,
    `LossFindings.jsx`, `abortionFormat.js`, `CarePlanTab.jsx`, `CarePlanCard.jsx`, `carePlanFormat.js`,
    `carePlanPrintFormat.js`, `recordCopyFormat.js`, `pages/visits/LossFindingsCard.jsx`, `PrescriptionSetParts.jsx`,
    `SetDialogs.jsx`, `pages/lab/labFormat.js`, `pages/redflags/*`, `pages/worklist/WorklistSections.jsx`. Tests:
    `server/tests/pregnancy-loss-care.test.js`, `pregnancy-loss-sets.test.js`, `abortion.test.js`,
    `careplans-other.test.js`, `redflags-wider.test.js`, `record-copy.test.js`, `risk.test.js`;
    `client/src/pages/patients/lossFindings.test.jsx`, `recordCopyFormat.test.js`, `pages/visits/lossSets.test.jsx`,
    `pages/lab/labFormat.test.js`, `pages/redflags/redFlagFormat.test.js`, `redFlagScreens.test.jsx`,
    `components/auditFormat.test.js`.
- ✅ **Delivery and newborn outcomes recorded as fields (stillbirth, PPH, NICU, breastfeeding, deaths) and counted
  in Analytics** (built at the owner's request, October 2026).
  Before this the delivery note had no fixed answer for heavy bleeding, the kind of stillbirth, breastfeeding or the
  NICU, so none of them could be counted, and a death could not be recorded – staff had to switch reminders off by
  hand.
  - **Delivery note** (a stay → **New document** → **Delivery note**): beside the blood loss, **Heavy bleeding after
    delivery (postpartum haemorrhage)** – Yes, No, or "Not recorded" to start. A hint says what the blood loss
    suggests: 500 mL or more after a vaginal birth, 1,000 mL or more after a caesarean, nothing for "Other". The
    doctor decides – nothing is ticked by itself. For each baby: **Kind of stillbirth** (fresh or macerated) for a
    stillbirth; **Breastfed within one hour of birth** and **Admitted to the NICU or SNCU** for a live birth. An
    answer that does not fit the outcome is cleared. The confirmed note and its printout show the answers in words.
  - **A baby's record**: **Edit details** → **Care after birth** – admitted to the NICU or SNCU (with the dates) and
    **Feeding at discharge**; a **Care after birth** card on the Overview. Doctors and RMOs change it; reception does
    not see it.
  - **Record a death**: the patient's page → **More** → **Record a death**. Only her doctor (any doctor while she has
    none) – not an RMO, a nurse or reception, and not on a record marked as a duplicate. The date; for a baby where
    it happened (the age is worked out from the date of birth, and again if the time of birth is corrected later);
    for everyone else **When was it?** (four choices). There is no cause of death – write it in the notes of the
    stay or the discharge card. A tick box names the patient and her number. The date cannot be in the future,
    before the birth, or before a visit, an admission, or vital signs or a medicine on the nursing chart of that
    record.
  - **What a closed record does**: a grey banner "Died on …" with who recorded it, and **Record closed** in the page
    header, the Patients list, the search, the appointment booking search, the In hospital list on Today and beside
    her baby or mother. Reception and the pharmacist see only "Record closed", never why or when; lab staff do not
    see it. The record can still be read but takes nothing new: no visit, appointment, arrival, lab order,
    admission, scan or procedure, counter sale, reminder, WhatsApp chat, patient card, portal access or AI brief.
    When it is closed, her appointments from today on are cancelled with no message to the family, the messages
    waiting for her are stopped and her portal access ends. A visit already started, the documents of an open stay
    (the discharge card ends it) and her bills can still be finished. She leaves Today, the worklists, the
    Calendar, the overdue and vaccination lists, Ask your records, and the pregnancy and follow-up numbers in
    Analytics. Her red flags still show while her stay is open (in case the death was put on the wrong record). Her
    babies' records stay in use, and the message after saving says so.
  - **Undo recorded death** (**More**, or **Undo – recorded in error** on the banner): her doctor, with a reason of
    at least 5 characters. The record is in use again; nothing that was cancelled comes back by itself – the
    appointments to book again are listed. The Overview keeps "Deaths recorded in error and undone".
  - **Analytics → Deliveries** (a new tab before Newborn), from the delivery notes a doctor confirmed and the deaths
    recorded: **Deliveries and mode of delivery** (with the caesarean rate), **Heavy bleeding after delivery
    (postpartum haemorrhage)**, **Births and stillbirths** (fresh or macerated), **Apgar score at 5 minutes** (under
    7), **NICU or SNCU admission**, **Breastfeeding within one hour of birth**, and **Stillbirths and deaths**
    (newborn deaths in the first 28 days, and in the first 7; maternal deaths by when). Each card shows what it is
    counted out of and a "Not recorded" row; drafts and notes marked entered in error are never counted; twins
    count as two babies. Doctors can click a number for the list (one row per delivery or baby, showing the
    mother). Hospital admins see the first two cards only, with 1–4 as "fewer than 5". The super admin sees all
    seven, numbers only. **Overview → Not in this version** now points to this tab.
  - **Monthly report**: stillbirths are split into fresh and macerated, and a new part **Deaths (recorded on the
    records by a doctor)** has newborn and maternal deaths. For the same month the numbers match the Deliveries tab.
  - the demo script (removed 12 Oct 2026) now adds a confirmed delivery note for each of the 8 fake postnatal demo mothers (two sets
    of twins, one stillborn twin) – no deaths, so no demo record is closed.
  - ⚠️ **DRAFT for the doctor to check and approve**: the PPH amounts (500 mL, 1,000 mL after a caesarean, none for
    "Other" – WHO 2012 and an older ACOG definition); fresh = died during labour, macerated = before labour; Apgar
    under 7 at 5 minutes as a low score (AAP and ACOG 2015); the WHO newborn and maternal death definitions and the
    four "When was it?" choices. Each is marked DRAFT on the screen with its source.
  - **Safety and privacy**: the audit log shows **Record closed by a doctor** and **Closed record reopened
    (recorded in error)** with counts only – never which patient, the date or the reason; a change to a baby's NICU
    or feeding is logged as "Care after birth". The undo reason is checked for words about the baby's sex. The copy
    of the whole record has the death, the deaths undone (who and when only) and a baby's care after birth.
  - **Defaults the owner may want to change**: PPH is counted out of the deliveries with an answer; breastfeeding
    within one hour out of all live births (babies with no answer lower the rate); a percentage shows only when 20
    or more are counted, as elsewhere in Analytics; hospital admins do not get births, Apgar, NICU, breastfeeding or
    deaths (deliveries minus live births would show the stillbirths); undo does not book anything again by itself.
  - **Left out**: a cause of death; a NICU or SNCU stay entered only on the baby's own record is not counted on the
    NICU card (the card says so); deaths of babies 28 days or older and deaths not related to a pregnancy are in
    the monthly report only, not on the Deliveries tab.
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). The website is covered by render tests
    and the build. The full run after the merge reported 1,182 server tests and 1,821 website tests passing (4
    skipped on purpose, as before).
  - Files: `server/src/inpatient/docSchemas.js`, `models/Patient.js`, `patients/deathRules.js`, `deathService.js`,
    `routes/patientDeath.js`, `routes/patients.js`, `utils/patientAccess.js`, `utils/auditDetails.js`,
    `analytics/metrics/deliveries.js`, `analytics/facts.js`, `load.js`, `populations.js`, `roles.js`,
    `reports/monthlyReport.js`, `patients/recordCopyView.js`, the demo script (removed 12 Oct 2026), and the closed-record checks
    in the reminder, appointment, Today, worklist, lab, pharmacy, portal and AI routes; website:
    `pages/inpatient/deliveryOutcomes.js`, `DocumentPage.jsx`, `docFields.js`, `pages/patients/DeathDialogs.jsx`,
    `deathFormat.js`, `PatientDetailPage.jsx`, `PatientForm.jsx`, `PatientsPage.jsx`, `pages/analytics/*`,
    `components/auditFormat.js`. Tests: `server/tests/delivery-outcomes.test.js`, `patient-death.test.js`,
    `analytics.test.js`, `analytics-units.test.js`, `analytics-demo.test.js`, `monthly-report.test.js`,
    `record-copy.test.js`, `ai.test.js`; `client/src/pages/inpatient/deliveryOutcomes.test.jsx`,
    `pages/patients/deathScreens.render.test.jsx`, `patientPayload.test.js`, `recordCopyFormat.test.js`,
    `pages/analytics/deliveriesCards.render.test.jsx`, `analyticsFormat.test.js`, `components/auditFormat.test.js`.
- ✅ **A complete copy of one patient's record, and a server-operator command to take a hospital's data out** (built
  at the owner's request, October 2026).
  Before this a patient, or a doctor she is referred to, could be given only single printouts (a prescription, a
  care plan, a document), and a hospital's data could not be taken out of Perinexa at all.
  - **Copy of the whole record**: the patient's page → **More** → **Copy of the whole record**. "Collecting
    everything in the record" shows for a moment, then the print preview opens with **Print** and **Download PDF**.
    Everything recorded for her, each part under its own heading and oldest first: Identity and contact (a baby:
    Birth details), Medical background, Obstetric history, Pregnancy with the risk level and its reasons, Pregnancy
    loss, After delivery, Emergency treatment notes, Visits, Care plans, Lab orders and results, Scans and procedures
    done, Stays in hospital (signed documents and the nursing chart), Consent forms and information given,
    Appointments, and at the end **Not in this copy**. A part with nothing in it says "None recorded."
  - **Every page** has a footer: the hospital, the patient number (never her name – a loose page must not name
    her), when and by whom it was printed, and "Copy of the record – confidential". The PDF is named "Record copy
    P-… <date>.pdf", never with her name.
  - **Who may make the copy**: only someone with full access to this record – her doctor, any doctor while she has
    no doctor, or an RMO. Not reception, nurses, the lab, the pharmacist or a hospital admin, and not another doctor
    who sees her record read-only (even when it is not sensitive). A patient of another hospital is "not found".
  - **Taking a hospital's data out** (for the person who runs the server only – there is no button in the app, on
    purpose: one folder with every patient is the riskiest thing Perinexa can make). For a move to another system, a
    legal request or an off-site copy. In the Mac's Terminal, in the Perinexa folder:
    `npm run export:hospital -- --hospital "<exact hospital name>" --out "<folder>"`. The name must be exactly as on
    the platform's Hospitals page (other capitals are refused with "Did you mean …"), and is typed again to go on.
    The folder must be new or empty and outside the Perinexa folder, so the data can never end up in git or on the
    website. It gets one file per kind of record of that hospital only (patients, visits, emergency notes, care
    plans, lab orders, scans and procedures, stays, inpatient documents, nursing chart, consent forms, appointments,
    arrivals, reminder messages, ABHA Scan & Share (and four ABHA sharing files since October 2026 – see Next),
    bills, eight pharmacy files, the hospital's audit log, numbering,
    nine settings files), `hospital.json`, `staff.json` (names, roles, whether they still work there, a doctor's
    registration – no e-mail addresses), a `files` folder with the lab report files and scanned signed consent forms
    (named by their id, never by the uploaded name), and a `README.txt` in plain words: what each file is, the date,
    how many records, and the warning. README.md has a section "Taking a hospital's data out".
  - ⚠️ **For the doctor to check**: when a lab result is marked Low, High or Abnormal, the copy says these marks only
    draw attention, come from Perinexa's DRAFT list of usual adult values (a baby: DRAFT newborn values from published
    guidance, NNF India and AAP, not reviewed by a paediatrician), and that the lab's report and the treating doctor
    decide. The risk part repeats what the risk card says the level did not count ("Doctor to assess", "Not measured
    yet in this pregnancy", "What the automatic check does not see", and "To be reviewed" when the automatic result
    changed after a doctor's override) and names
    DRAFT risk rules as such. Please read one copy as a patient would, and check the wording.
  - **Safety and privacy (the copy)**: it is made from what the screens already show this person, so the same
    need-to-know rules apply. It never holds: the doctor's private note of a visit, the content of anything marked
    "entered in error" or a cancelled lab order (listed only, with who marked it and when), inpatient documents not
    signed yet (listed as drafts), lab values not reported yet, report files and scanned papers (counted only), what
    was typed into a consent form (title and dates only), bills, payments, pharmacy invoices and reminder messages,
    staff e-mail addresses, and other patients – her babies, a baby's mother and an earlier record of hers appear by
    patient number only. "Not in this copy" says this on the copy itself. Results the lab reported without marking
    the sample collected first say "Sample taken: Not recorded – the results were entered without it." Download PDF
    only: no Share or WhatsApp for a whole record. A sensitive record shows "Hand the copy in person to the patient
    herself (a baby: the baby's parents), or give it only to a doctor she is referred to." The audit log gets **Full
    record copied** each time the copy is opened, and **Copy of the whole record printed** / **saved as PDF** – the
    record's id and number only, never what the copy held.
  - **Safety and privacy (the export)**: never in it – passwords, sign-in sessions, patient portal codes, the
    waiting-room screen key, staff e-mail addresses, another hospital's data, or the secret settings of
    `server/.env`; every file is checked for these before it is kept. If anything goes wrong or Ctrl + C is pressed,
    what was written is removed again. The hospital's audit log (type Security) shows **Hospital data exported by the
    server operator**, done by "Server operator", with counts only.
  - ⚠️ **The export folder is not encrypted** and holds every patient of the hospital. Keep it only on an encrypted
    disk, give it only to the people it is for, delete it when no longer needed, and run it when nobody is using
    Perinexa (so the files match each other). Unlike the printed copy, it holds the doctors' private notes, what was
    written in visits marked "entered in error", what was typed into consent forms and the full ABHA number.
  - **Defaults the owner may want to change**: the record's own **Notes** box (which doctors and RMOs see) is in the
    copy; the copy is grouped by part, each oldest first (not one timeline); each part has a limit (for example 1,000
    visits or 10,000 nursing chart entries) – if a record ever has more, the newest are copied and a band on every
    page says the copy is not complete; the "Printed" time in the footer is when the preview was opened, as on the
    other printouts. The export's audit log keeps the IP address and browser and names people, without e-mail
    addresses.
  - **Left out**: a copy of only some parts of the record; a copy for another doctor's patient; old register scans
    (removed 2 Oct 2026), patient portal codes, staff voice-entry words and fields no longer used by Perinexa are not
    exported; Perinexa has no command to read an export back in.
  - ⚠️ **Not seen in a running app yet** (starting a server was not allowed). Two sample copies (a mother's and a
    baby's) were turned into PDFs and read; the export was run only by the tests, on the test database. The full run
    after the merge reported 1,124 server tests and 1,793 website tests, all passing, and the website build. The
    export has not had its own independent review yet – one is recommended before it is used on real data.
  - Files: `server/src/routes/recordCopy.js`, `patients/recordCopyView.js`, `utils/patientAccess.js`
    (`mayCopyRecord`), `careplans/plansService.js` (`carePlansForCopy`), `routes/patients.js`;
    `server/src/export/hospitalExport.js`, `server/scripts/export-hospital.js`, `package.json` (`export:hospital`),
    `README.md`; `models/AuditLog.js`, `utils/auditDetails.js`; website: `pages/patients/RecordCopy.jsx`,
    `recordCopyFormat.js`, `PatientDetailPage.jsx`, `components/print/PrintPreview.jsx`,
    `components/auditFormat.js`. Tests: `server/tests/record-copy.test.js`, `hospital-export.test.js`;
    `client/src/pages/patients/recordCopyFormat.test.js`, `recordCopy.render.test.jsx` (sample record in
    `testdata/recordCopySample.js`), and new cases in `components/auditFormat.test.js`.
- ✅ **Pharmacy extras (purchase orders, returns to a supplier, barcodes, e-invoice file) and billing extras
  (insurance details, claim forms, UPI link)** (built at the owner's request, October 2026).
  Before this the pharmacy could not order from or send stock back to a supplier, and a bill had no place for her
  insurance; claim forms and UPI requests were made outside the app.
  - **Purchase orders** (PO-000001 …): Pharmacy → **Purchases** now has three sections: **Purchases**, **Orders**
    and **Returns to supplier**. **Orders** → **New order** → choose the supplier → **Suggest from low stock** fills
    in the medicines at or below their reorder level → **Save the draft**. On an order: **Change** (a draft),
    **Print** (A4, quantities only, no prices), **Mark as sent** (only a note – Perinexa sends nothing to the
    supplier), **Receive** / **Receive the rest** (opens the New purchase form filled in from the order),
    **Cancel the order** (only while nothing has come) and **Nothing more will come** (closes a part-received
    order, with a reason). A purchase made this way says "received against order PO-…".
  - **Returns to a supplier** (SR-000001 …): **Returns to supplier** → **Return stock to a supplier** (or **Return
    stock** on a supplier's row) → the supplier, a reason, a quantity beside each batch bought from that supplier
    (expired ones too) → **Return and make the debit note**. The stock leaves with its own stock move ("Returned to
    supplier") and shows in the H1, Schedule X and narcotic registers with the balance. **Print the debit note**
    (HSN, batch, expiry, rate and GST). A return entered by mistake: **Cancel this return** with a reason – the
    stock goes back on its batches and the return is kept, marked Cancelled. Reports → **Purchases by supplier, net
    of returns**; the admin's export has **Returns to suppliers**.
  - **Barcodes**: Medicines → Add a medicine / Change → **Barcodes on the pack** (up to 10 per medicine; a barcode
    belongs to one medicine only). A **Scan or type a barcode** box sits beside the medicine search on Sell, Issue
    to ward and Enter a purchase, and on Stock (it opens that medicine). Only the exact number is found.
  - **E-invoice file**: Sell → Walk-in customer → tick **The buyer is a business that gives its GSTIN** → name,
    GSTIN (checked; the state is read from it), address, city or town, PIN. On that invoice (Pharmacy → Invoices)
    the card **Business buyer and e-invoice file** lets the hospital admin **Download the e-invoice file** (and one
    for each credit note) in the government's e-invoice format, to upload on the portal by hand. Perinexa is not
    connected to the portal. The file needs an HSN code of 6 or 8 digits for every medicine (4 is still enough for
    the printed invoice); the card names the medicines that need the longer code. Pharmacy → **Settings** has two
    new boxes, **City or town** and **PIN code**, needed only for this file.
  - **Insurance or scheme on a bill**: Billing → a bill → new card **Insurance or scheme** → **Add details** /
    **Change the details**: insurer or scheme, policy or member number, TPA, pre-authorisation number, claim number,
    and for PM-JAY the PM-JAY ID, package code and package name. All optional, but the insurer is needed once
    anything else is typed. **Take payment** → Insurance / scheme fills in the insurer and claim number from the
    bill; a claim number typed there is kept on the bill when it has none. Another open bill of the same patient
    offers her insurer, policy number, TPA and PM-JAY ID again. Billing → **Unpaid** has a new column **Insurance
    or scheme**.
  - **Claim forms**: Billing → a bill → **Print** → **Print claim form** or **Print PM-JAY claim sheet** (A4, two
    pages): letterhead and registration number, her identity, the visit or stay dates, the treating doctor with
    registration number, the bill by group (Consultation, Lab test, Inpatient …) with total, paid and due, the
    insurance details, and an empty box "Diagnosis and procedure – to be filled in and signed by the treating
    doctor". A detail not recorded prints as an empty line and the preview says which ones are missing. It is a
    general form made from the bill, not an insurer's own form; the PM-JAY sheet is for copying into the PM-JAY
    portal by hand.
  - **UPI payment link**: Billing → **Settings** (new tab): the hospital's UPI ID (typed twice when changed) and payee name;
    **Changes to the UPI ID** lists every change with who and when. On a bill with a balance → **UPI payment link**
    (beside Take payment) → **Make the link** → **Copy the message** or **Copy the link only**, to paste into
    WhatsApp or an SMS yourself. The message gives the hospital, the bill number, the amount, and the UPI ID in case
    the link does not open. Making a link records nothing: the payment is recorded with **Take payment** (or **Take
    a deposit** while she is in hospital) when the money has arrived.
  - **Who may use it**: orders – the pharmacist or the hospital admin; receiving an order, returns to a supplier
    and cancelling a return – the pharmacist only; the e-invoice file – the hospital admin only; insurance details,
    claim forms and the UPI link – reception and the hospital admin; Billing → Settings – the hospital admin only.
  - ⚠️ **For the doctor to check**: nothing clinical was written here. To approve: the wording of the empty
    doctor's box on the claim form, who sees age and address on it, and the defaults below. Several points are for
    your accountant (see the owner's questions below).
  - **Safety and privacy**: the claim form never names an item (so a confidential test or a procedure is not on
    it) and has no ward, reason for admission or type of care. A hospital admin with no reception role gets her
    name, number and phone on it; age and address print as empty lines, and a doctor is named only when that doctor
    is on a charge of the bill. The UPI link and message carry the bill number only, never her name. The insurance
    boxes on a bill that is not a baby's go through the guard against words about the baby's sex. Returns of
    Schedule X and narcotic medicines, and cancelling one, need a witness's name; a batch goes back only to the
    supplier it was bought from. Orders, returns and barcodes hold no patient data. Fifteen new audit entries
    (orders, returns, debit note printed, e-invoice file downloaded, insurance details changed, claim form printed,
    UPI link made, billing settings changed) hold ids, numbers and amounts or the names of the details – never what
    was typed and never a UPI ID (it is often a phone number).
  - ⚠️ **A fault found and fixed – please check your medicines**: until 4 Oct 2026, **Stop using** or **Use again**
    on a medicine emptied its generic name, strength, HSN code, schedule and reorder level, so a narcotic or H1
    medicine could lose its schedule – it is then sold with no prescription check and is missing from its register.
    A change now changes only what was changed (for suppliers too). Pharmacy → **Medicines** shows the pharmacist
    or admin a notice naming every medicine with all five empty: open each with **Change** and set its schedule by
    hand. Nothing is guessed.
  - **Also changed on bills**: text typed on a mother's bill (an item's name, a reason, the payer or reference of a
    payment) and on the fee taken with an appointment now goes through the same guard, as the billing plan
    promised, with billing's own message. A number with XX or XY standing alone ("POL/XY/2026/01") is refused;
    reception joins the letters ("POLXY2026"). See the owner's questions.
  - **Defaults the owner may want to change**: **Suggest from low stock** brings each medicine up to twice its
    reorder level, less usable stock and what is on sent orders; the printed order has no prices; the debit note
    takes the purchase rate as before GST and adds GST, and spreads the price paid over free units too; the
    e-invoice file charges CGST + SGST with the place of supply in the pharmacy's state; barcodes are 4 to 32
    letters or digits; the UPI link asks for the balance or a smaller part (at least ₹1) and warns above ₹1,00,000;
    the UPI message is in English only and is offered only when the bill has a balance.
  - **Left out**: Perinexa sends nothing to a supplier, an insurer, the PM-JAY portal or the e-invoice portal; GST
    return filing; the supplier's credit note is not recorded; write-offs of Schedule X and narcotic stock still
    need no witness; 2D pack codes (with batch and expiry) are not read; no UPI QR code; the accountant's export has
    no insurance columns; the demo data has no orders, returns or barcodes; insurance details are not offered from a
    record marked as a duplicate of hers.
  - ⚠️ **Not tried outside the app**: the e-invoice file was never uploaded on the portal – the accountant should
    check the first file. The UPI link was never tried on a real phone – pay ₹1 from your own phone first.
  - ⚠️ **Not seen in a running app yet** – by the builders or after the merge (starting a server was not allowed).
    Checked with tests only: the full run after the merge reported 1,098 server tests and 1,753 website tests, all
    passing, and the website build. Please click through "How to test the pharmacy extras and billing extras"
    below with fake data.
  - Files: `server/src/pharmacy/ordersService.js`, `supplierReturnsService.js`, `einvoice.js`, `gstin.js`,
    `pharmacyRules.js`, `pharmacyHttp.js`, `routes/pharmacyOrders.js`, `routes/pharmacySupplierReturns.js`,
    `routes/pharmacy.js`, `models/Pharmacy.js`; `server/src/billing/claim.js`, `upi.js`, `billingRules.js`,
    `billingService.js`, `routes/billing.js`, `models/Bill.js`, `models/Tenant.js`; website:
    `pages/pharmacy/OrdersPage.jsx`, `SupplierReturnsPage.jsx`, `PurchasesPage.jsx`, `SellPage.jsx`,
    `InvoicesPage.jsx`, `StockPage.jsx`, `ReportsPage.jsx`, `pharmacyUi.jsx`, `gstin.js`;
    `pages/billing/BillingExtras.jsx`, `BillPage.jsx`, `BillingReports.jsx`. Tests:
    `server/tests/pharmacyExtras.test.js`, `billingExtras.test.js`; `client/src/pages/pharmacy/pharmacyExtras.test.js`,
    `pharmacyExtrasScreens.test.jsx`, `pages/billing/billingExtras.test.js`, `billingExtrasScreens.test.jsx`, and new
    cases in `components/auditFormat.test.js`.
- ✅ **Already-registered warning at registration, and marking a record as a duplicate of another** (built at the
  owner's request, October 2026).
  Before this the same woman could be registered twice without a word, and her two records stayed apart.
  - **Warning at registration**: when **Register patient** is pressed, the app first looks in this hospital for a
    record with the same phone number (with or without +91, a 0 in front, spaces or dashes; two numbers typed in
    the one field both count) or the same name (capitals, spaces and dots make no difference). If it finds one,
    nothing is saved and a pop-up **She may already be registered** (for a newborn: **This baby may already be
    registered**) lists up to 5 records, the closest first: name, patient number, age, doctor, "Phone ending 3210"
    and why it is shown (**Same phone number**, **Same name**, or both). The choices: **Open this record**,
    **Register as a new patient anyway**, **Back to the form**. A baby is compared only with babies – never with
    the mother, who has the same phone – and everyone else never with a baby. A match that is itself a duplicate is
    shown as its main record. A quick booking being registered goes to the record that is opened.
  - **Marking a record as a duplicate**: open the record that should no longer be used → **More** → **Mark as a
    duplicate** → search the main record (the one to keep), type a reason → **Mark as a duplicate**. Nothing is
    moved, copied or deleted; only her booked appointments from today on go to the main record. Before confirming,
    an amber box lists what only this record has – an allergy, a blood group, conditions, previous caesareans,
    problems in previous pregnancies, pregnancy dates, findings in this pregnancy, a higher risk level, a care plan,
    more visits, her agreement to reminders, her ABHA – so that the doctor copies by hand what still applies, or
    marks the other record instead. The same list is in the green message afterwards and stays on the main record
    under **Earlier record: P-…** ("On P-… and not on this record: …").
  - **A duplicate record afterwards**: an amber banner **Duplicate record** on every tab with a link to the main
    record, who marked it and why, and a grey **Duplicate** pill beside the name. It can still be read and printed,
    but takes nothing new: no visit, no writing in a visit that is not signed, no prescription, lab order,
    admission, appointment, **Mark arrived**, scan or procedure, bill, fee when booking or pharmacy sale – the
    server refuses with a plain sentence that names the main record. **Print patient card** is not offered, and
    online booking in the portal is off for it. Where a duplicate is found by its number in the patient finder
    (booking, bills, arrivals, pharmacy), the row says "Duplicate of P-… – choose P-… instead". A visit on it can
    still be signed, corrected below the signature and marked entered in error. It
    is left out of the Patients list, searches, Today, the worklists, the Calendar, reminders, Ask your records and
    the patient counts of Analytics and the monthly report. Its exact patient number typed in **Find a patient**
    still finds it (the number is on her old card), with "Duplicate of P-…" in its line.
  - **Work under way is not lost**: a lab order already made on the duplicate is still finished and reviewed
    there. An open bill stays there and can be paid; the main record's **Bills** tab says "She also owes ₹… on her
    earlier record P-…". The pharmacy sells on the main record, where prescriptions written on the earlier record
    are listed too ("written on her earlier record P-…"). Babies linked to her earlier record are listed on the
    main record's Babies card.
  - **Undo**: **Undo duplicate marking** (under More, and in the banner) puts the record back in use and in the
    lists. Appointments that went to the main record and are still ahead come back; reminders that the marking
    cancelled and whose day has not passed wait again; Overview keeps "Duplicate markings that were undone (1)".
  - **Where to find it**: Patients → New patient → **Register patient** · a record → **More** → **Mark as a
    duplicate** / **Undo duplicate marking** · Patients → **More filters** → **Duplicates** (Duplicates hidden /
    Duplicates shown / Only duplicates; a row carries the pill "Duplicate of P-…") · the notes on the **Bills**
    tab, a bill page, Pharmacy → Sell, Scan and Share and More → Reminders and portal · Admin → Audit log.
  - **Who may use it**: the warning – everyone who registers patients (reception, doctors, RMOs). Marking and
    undoing – the patient's doctor (any doctor when she has no doctor) or an RMO, and only when they may change
    **both** records. The **Duplicates** filter – doctors and RMOs. Nurses, reception, the lab and the pharmacist
    cannot mark or undo. A record of another hospital is never looked at and never offered.
  - ⚠️ **For the doctor to check**: nothing clinical was written here – no rule, cut-off or wording to approve; the
    comparison of the two records only lists facts already on them and never stops the marking. To confirm: visits
    made on a duplicate are counted under the main record in Analytics and the monthly report, and when her
    consultation is priced as new or follow-up (nothing is moved in the database); and the defaults below.
  - **Safety rules**: nothing is ever joined by itself. A record cannot be marked while today's visit on it is
    still open, or while she is in hospital on it – the message says to sign the visit first, or to mark the other
    record instead. Also refused: a record as a duplicate of itself, of a record that is itself a duplicate, a
    record that is already the main record of another, and a baby's record with an adult's. A marking that was cut
    off half-way is finished by pressing the button again. If she was marked arrived today on the duplicate (or,
    after undo, on the main record), the message says to mark her arrived on the other record so that she stays on
    the waiting list. Her agreement to reminders and her ABHA are not copied: the messages say to record the
    agreement on the main record and to unlink the ABHA on the earlier record and link it on the main one; no
    automatic message is sent for a duplicate. A fee taken when booking is not charged a second time at her visit
    on the main record. A visit form keeps what was typed if the record was marked meanwhile.
  - **Privacy**: the warning shows only what the person registering may already see of that record – never a
    medical detail, the type of care or "sensitive" – and only the last 4 digits of the phone. The typed reason,
    the undone markings and "On P-… and not on this record" are shown only to those who may see the medical
    details (the last: of both records); the lab and the pharmacist see only the numbers "Duplicate of P-…" and
    "Earlier record: P-…". The reason is checked for words about the baby's sex (not on a baby's own record). The
    doctor who marks is told nothing about her bills. Three new audit entries – **Registered as new although a
    record matched**, **Record marked as a duplicate**, **Duplicate marking undone** – carry record numbers and
    counts only, never a name, a phone number or the reason; the super admin's log has the counts alone. Comparing
    two records is logged as a view of the main record. The patient portal of a duplicate shows only the
    appointment that came from that record.
  - **Defaults the owner may want to change**: the same name alone raises the warning; a phone number with fewer
    than 6 digits or one digit repeated (0000000000) is not compared, a name needs 2 letters; at most 5 records are
    shown, with "and … more records" under them; the reason needs at least 5 characters; an unsigned visit of an
    earlier day does not stop the marking but can then no longer be written in; undo needs the right to change both
    records; the reminders the marking cancelled are kept in the outbox as cancelled, with the reason.
  - **Left out**: no warning when a phone number or name is changed later on **Edit details**; nothing is copied
    between the records (allergy, blood group, agreement to reminders, ABHA – by hand); the lab worklist, the
    pharmacy lists and the billing lists do not label a duplicate's work in progress; Analytics holds its pages for
    a short time, so it can show the old numbers briefly after a marking or undo; no test drives the registration
    page itself in a browser (the pop-up and the server's answer are each tested).
  - ⚠️ **Red flags are not joined**: a red flag is worked out from the visits and lab orders of one record only. A
    flagged value on the duplicate – its last visit, or a lab order made before the marking and reported after it –
    shows only when someone opens the duplicate; it is not on Today and not on the main record. The lab's results
    to review still list the result. To decide (see the owner's questions below).
  - **Also changed for every patient**: a full name with a character that cannot be seen (a tab, a line break) is
    refused at registration and on Edit details, with a message under the field.
  - ⚠️ **Not seen in a running app yet** – by the builders or after the merge (starting a server was not allowed).
    Checked with tests only: the full run after the merge reported 1,050 server tests and 1,682 website tests, all
    passing, and the website build. Please click through "How to test the already-registered warning and duplicate
    records" below with fake patients.
  - Files: `server/src/patients/duplicateRules.js` (the rules and the words), `duplicateService.js` (matches,
    marking, undo), `duplicateCompare.js` (what only one record has), `routes/patientDuplicates.js`,
    `routes/patients.js` (the warning, the Duplicates filter), `models/Patient.js` (`duplicateOf`,
    `duplicateHistory`), `models/Appointment.js` (`movedFromPatientId`); website:
    `pages/patients/PossibleMatchesDialog.jsx`, `DuplicateDialogs.jsx`, `duplicateFormat.js`, `PatientNewPage.jsx`,
    `PatientDetailPage.jsx`, `PatientsPage.jsx`. Tests: `server/tests/patient-duplicates.test.js` (45 tests),
    `client/src/pages/patients/duplicateFormat.test.js`, `duplicateScreens.render.test.jsx`, and new cases in
    `components/auditFormat.test.js`. For developers: the test helper `samplePatient` now sends
    `registerAnyway: true`; a test that registers the same name or phone twice without it gets the warning (409).
- ✅ **Red flags beyond pregnancy visits: lab results, care after delivery, newborn babies and patients in
  hospital** (built at the owner's request, October 2026).
  Before this a red flag came only from the values of a pregnancy patient's latest visit.
  - **Lab results** raise flags from the moment the lab presses **Report results** – before a doctor's review –
    and again with the new values after **Change the results**: haemoglobin, platelets, blood sugar (fasting, OGTT
    2-hour, random), TSH, urine albumin (the lab's grade Nil … 4+, like the dipstick), and for a baby total and
    direct bilirubin and blood sugar. The latest value of this pregnancy or episode of care counts, dated by the day
    of the sample. Not counted: a result that is only saved, a cancelled order, a value outside a plausible range
    for its unit (platelets typed as 150000 instead of 1.5 lakh).
  - **Care after delivery and babies**: a postnatal or newborn visit raises its own flags – BP, temperature, pulse
    and Hb after delivery; a baby's temperature, and weight more than 10 % below the birth weight on the record.
    A baby's bilirubin is checked against the day of life (from the age in hours the lab enters with the result, or
    the time of birth on the record); without a known age nothing is raised.
  - **In hospital**: the latest value of each vital sign on the **nursing chart** of the stay is checked with the
    rules of her type of care. A charted value replaces the visit's when it is newer; when nobody can tell which is
    newer (the visit was saved again later), both are checked. An entry without a BP does not clear an earlier
    raised BP; an entry marked **Entered in error** stops counting at once.
  - **Every flag says where it is from**: the value, a link ("from the lab result of 3 Oct 2026", "from the visit
    on …", "from the nursing chart, 3 Oct 2026, 14:30") and the rule. Flags are still worked out when read, never
    stored.
  - **Where to find it**: **Today → Red flags** (now also postnatal patients, babies and patients in hospital; the
    hint under the list names the types of care that are checked and those that are not) · **Today → In hospital**
    (a **Red flag** pill beside the name; click the name for her flags) · the **Red flag** pill in the Patients
    list and the patient header · **Overview → Red flags** · a visit page: **Red flags** (this visit's values) and
    a new card **Other red flags on the record** · a stay page: a **Red flags** card above Documents while she is
    in hospital.
  - **The rules**: Clinic library → Clinical rules → **Red-flag rules** lists them under Pregnancy (antenatal),
    After delivery (postnatal) and Newborn. **Edit rules**: *Applies to (types of care)* tick boxes on every rule
    (older rules stay pregnancy rules), a **Lab results** group in the Check list, *From / To baby's age (days)* on
    newborn rules, weeks only on pregnancy rules, buttons to list one type of care. A rule that could never be
    raised (fetal heart rate on a postnatal rule) is refused with a plain message; weeks, days and values take
    plain digits only. At most 150 rules per hospital (was 60).
  - **Who may use it**: doctors, RMOs and nurses see the flags and the rules – only for patients whose medical
    details they may see; only doctors change and approve the rules. Reception and the lab never get red flags.
    Staff of another hospital cannot open the stay or its flags.
  - ⚠️ **DRAFT for the doctor to check and approve** – 34 new rules, 55 in all. Nothing here is approved, and every
    source named with a new rule was written from memory, not looked up:
    - **14 for lab results in pregnancy**: Hb under 7 Urgent, 7–9.9 and 10–10.9 Watch; platelets 1–1.49 lakh
      Watch; OGTT 2-hour 140–199 Watch, 200 or more Urgent; fasting sugar 92–125 Watch, 126 or more Urgent; random
      sugar 200 or more Urgent; TSH above 4 or under 0.1 Watch; urine albumin 1+ or more from 20 weeks Watch;
      "Possible pre-eclampsia" (BP 140/90 or more with lab urine albumin 1+ or more, from 20 weeks) Urgent.
    - **1 for pregnancy and after delivery**: platelets under 1 lakh Urgent.
    - **8 after delivery**: BP 140/90 Watch and 160/110 Urgent; temperature 100.4 °F or more Urgent; pulse over 110
      Urgent; Hb under 7 at a visit or from the lab Urgent.
    - **11 for babies**: temperature under 95.9 °F Urgent, under 97.7 °F Watch, over 99.5 °F Urgent; weight more
      than 10 % below birth weight Urgent; total bilirubin above 5.8 / 11.7 / 14.6 / 17.5 / 20.5 mg/dL on day
      0 / 1 / 2 / 3 / 4 and later (the NICE line for starting phototherapy, for babies born at 38 weeks or later)
      Urgent; direct bilirubin above 1.0 mg/dL Watch; blood sugar under 45 mg/dL Urgent.
    - **"Check these values"** on the visit form (as typed) now uses a baby's temperature limits for newborn care
      and none of the adult limits – to review with the newborn rules.
  - **Rules a doctor approved or changed are never changed by themselves.** Only a draft nobody has changed or
    approved gets the new rules by itself. On any other, the rules page shows **New built-in rules are available**
    with **Add them as a draft** (also listed in Clinic library → **To approve**); nothing already there is changed
    and each added rule is marked **New built-in draft** until a doctor approves. ⚠️ Until a doctor adds them, such
    a hospital gets no lab, postnatal or newborn flags. Its approved pregnancy rules do now also read the nursing
    chart of an admitted pregnancy patient.
  - **Safety rules**: a value that was not recorded never raises or clears a flag. Haemoglobin and urine albumin
    measured at a visit and by the lab count once – the newer reading (same day: both). A rule that joins values
    from different places (BP with a lab urine result) is raised only when they were recorded within 7 days of each
    other. After a **confirmed delivery note** a mother still recorded as pregnancy care is checked with the rules
    for care after delivery, from the moment of the birth – "41 weeks or more" is no longer raised (if the hospital
    has no rules for care after delivery, her pregnancy rules stay in use). A type of care without a rule is never
    shown as "no red flags": Today, the In hospital list and the stay page say that no rule applies to it. Every
    card keeps **What is not checked** (symptoms written as text, scan findings, lab results in words, as a file or
    in another unit, SpO₂ after delivery or for a baby, a baby's skin bilirubin, babies born early).
  - **Privacy**: opening Today now writes one more audit entry, "In hospital list viewed – 3 patients in hospital,
    1 with red flags" – counts only, never a name or a value. "Red-flag rules changed" says how many built-in rules
    were added. The AI's text about a patient says when the flags come from draft rules; the Today brief gets each
    flag with where it is from, never a name.
  - **Defaults the owner may want to change**: a lab result counts as soon as it is reported, not after the
    doctor's review; on **Today** a flag from a lab result alone, or of a patient who is not in pregnancy care and
    not in hospital, is listed for 6 weeks after the value was recorded (it stays on the record and in the Patients
    list); the 7 days for joining values are one fixed number, not per rule; "this pregnancy or episode of care"
    starts two weeks before the LMP (without dates: the last 42 weeks – older visits no longer count), at the
    delivery (without a date: the last 6 weeks), at birth for a baby, and 3 months back for the other types of
    care; the levels above; "pulse over 110" and "temperature over 99.5 °F" do not include the value itself (each
    rule's source text says how to change that).
  - **Left out**: lower bilirubin limits for babies born before 38 weeks (the baby's record has no "weeks at
    birth") and skin bilirubin; an SpO₂ rule after delivery or for a baby; built-in rules for post-meal sugar and
    for a baby's Hb, platelets or TSH (the checks exist, a doctor can write the rule); built-in rules for
    gynaecology, infertility and pregnancy loss; vital signs written inside admission and round notes (only the
    nursing chart counts); the mother's type of care is still changed by hand on **Edit details**; the stored
    wording of the information forms still says "the latest visit has a … red flag", though for a patient in
    hospital the flag can now come from the nursing chart.
  - ⚠️ **Not yet seen in a running app by anyone** – checked by tests and still pictures only.
  - Files: `server/src/redflags/redFlags.js` (the checks and the 55 built-in rules), `redflags/redFlagService.js`,
    `routes/redFlagRules.js` (`POST /api/red-flag-rules/add-built-in`), `routes/worklist.js`, `routes/inpatients.js`
    (new audit action `INPATIENTS_VIEWED`), `routes/admissions.js`, `routes/patients.js`, `routes/visits.js`,
    `routes/lab.js`, `ai/context.js`, `ai/brief.js`, `models/RedFlagRuleSet.js` and `models/LabOrder.js` (one new
    optional field each – existing data needs no change); website `pages/redflags/*`,
    `pages/worklist/WorklistSections.jsx`, `pages/TodayPage.jsx`, `pages/inpatient/AdmissionPage.jsx`,
    `pages/visits/VisitPage.jsx`, `pages/visits/vitalLimits.js`, `pages/library/ApprovalsPage.jsx`,
    `components/auditFormat.js`. Tests: `server/tests/redflags-wider.test.js`; website
    `pages/redflags/redFlagFormat.test.js`, `redFlagScreens.test.jsx`, `pages/visits/vitalLimits.test.js`,
    `components/auditFormat.test.js`.
- ✅ **Risk level and care-plan items from findings in this pregnancy** (built 4 Oct 2026 at the owner's request).
  What is found during the pregnancy now counts for the automatic risk level and switches on care-plan items.
  - **Five findings to tick**: patient record → **Edit details** → Pregnancy → *Findings in this pregnancy*:
    Gestational diabetes (GDM), High blood pressure in this pregnancy, Twins or more, Low-lying placenta / placenta
    praevia, Bleeding in this pregnancy. Antenatal records only. Ticked by the patient's doctor (any doctor when none
    is assigned) or an RMO – never by the software. Each tick is kept with who recorded it and when; unticking ends
    the entry instead of deleting it. The **Overview** → Pregnancy card lists them, with **Lowest Hb** and **Latest
    BP** as the rules use them, and *Earlier entries*. Nurses see them but cannot tick; reception and lab see nothing.
  - **Readings count too**: the lowest haemoglobin of this pregnancy (vital signs of her visits, and lab results of
    CBC or Haemoglobin **once a doctor has reviewed them**) and the latest blood pressure (visits). Only antenatal
    visits of this pregnancy that are not marked entered in error. A lab value outside 2–25 g/dL is ignored.
  - **Risk level**: worked out again when a finding is ticked or unticked, when a visit's vital signs are saved (or
    the visit is marked entered in error) and when a lab result is reviewed (**Mark reviewed** then says "Her risk
    level changed with this result"). The **Risk level** card shows the reason with its detail ("Lowest Hb 6.5 g/dL
    on 28 Sep 2026 (visit)"), a line **Not measured yet in this pregnancy** (Hb, BP) and **Doctor to assess** when
    a ticked finding or a recorded reading has no rule in the hospital's rules – so nothing looks counted when it
    was not. A doctor's override still wins and is marked **Review override**.
  - **Visit page**: after BP 140/90 or higher is saved, the doctor or RMO sees **Suggested for her record** with the
    button **Add to her record: high blood pressure in this pregnancy**. Nothing is added by itself. Not offered when
    chronic high blood pressure is already ticked; before 20 weeks it adds a note that high BP then usually counts
    as chronic. The request is refused if the visit was meanwhile marked entered in error or the reading corrected.
  - **Care plan**: items "for" a finding show as not applicable until the finding is ticked. A finding ticked after
    an item's weeks have passed makes the item **Decide** ("Window 28–30 w ended before the finding was ticked"),
    not Overdue. A plan built before the template had these items says so – Overview: "Her care plan has no items
    yet for: …"; Care plan tab: "Ticked on her record: …" with **Review the update**. Each plan is still updated one
    by one; the risk level and the existing high-risk items react at once.
  - **Clinic library**: the template editor's *For which patients* has the five findings plus **Any diabetes** and
    **Any high blood pressure**; a risk rule's *Checks* has Finding in this pregnancy, Lowest haemoglobin and the two
    blood-pressure numbers. "Pre-existing diabetes only" and "Chronic high blood pressure only" keep their meaning.
  - ⚠️ **DRAFT for the doctor to check and approve** (nothing here is approved; each has its source and "doctor to
    confirm"):
    - **Nine risk rules** (the built-in rules now number 47): each of the five findings = High; lowest Hb under
      7 g/dL = High; lowest Hb under 11 g/dL = Moderate; latest BP upper number 140 or more = High; lower number 90
      or more = High.
    - **Six antenatal items** (the built-in antenatal draft now has 50): growth scans for twins with separate
      placentas at 24, 28 and 32 weeks; an advice item "Twins or more: check the number of placentas – a shared
      placenta or triplets need more scans"; a growth scan with amniotic fluid at 28–30 weeks for GDM; a repeat scan
      for the position of the placenta at 32 weeks. Their wording for the patient never names the finding (a
      shared phone).
    - **Postnatal template**: "BP check within the first week" and "Blood sugar review" now also apply after high
      blood pressure or GDM found in the pregnancy.
    - The **140/90 suggestion** on the visit page is fixed in the software; the screen says it is a draft and names
      its source.
    - The item schedules (NICE NG137, MoHFW GDM guidelines 2018, RCOG Green-top 27a) were **not** checked against
      the original texts; `docs/RISK_RULES_RESEARCH.md` has no research on them (it says so).
  - **A template a doctor approved or edited is never changed by itself.** Only a template that was never approved
    and not edited gets the new rules and items by itself (a new draft version, in the audit log as "system"). On
    any other, its page shows **New built-in draft content is available** listing exactly what would be added or
    changed; a doctor presses **Add as a new draft** and approves again. The older rules stay exactly as approved.
  - **Privacy**: the audit log says "Patient details changed: Findings in this pregnancy" – never which finding, and
    never the level. The lab is told nothing about the risk level; only the reviewing doctor's message mentions it.
  - **Defaults the owner may want to change**: no Hb or BP yet does **not** make the level "Incomplete" (it shows
    "Not measured yet"); the **lowest** Hb of the pregnancy is used, so she stays flagged after treatment; **one**
    BP reading of 140/90 makes her High until a later normal reading; an unticked finding means "not found so far"
    (there is no "none of these" box); a finding recorded more than two weeks before this pregnancy began no longer
    counts (a record used again for a later pregnancy starts clean); a lab result changed after its review keeps
    counting as reviewed until a doctor reviews the change.
  - **Left out**: built-in items for high blood pressure or bleeding (they only raise the level, which switches on
    the existing high-risk scan); the number of placentas for twins as a field; GDM offered from a reviewed OGTT;
    BP from the in-hospital nursing chart; voice entry ticking a finding (spoken findings still go to the notes);
    nurses ticking findings; the Information-forms reminder does not use the ticks; "Update all plans at once" (built in October 2026 – see
    Next);
    the routine 30–32 week growth scan is not switched off for twins (the 32-week twin item says to mark it not
    needed); the "New built-in draft content" box cannot be dismissed.
  - Files: `server/src/patients/pregnancyFindings.js`, `careplans/readings.js`, `careplans/risk.js`,
    `careplans/antenatalDraft.js`, `careplans/otherDrafts.js`, `careplans/templatesService.js`,
    `careplans/planEngine.js`, `routes/patients.js` (`POST /api/patients/:id/pregnancy-findings`),
    `routes/templates.js` (`POST /api/care-plans/templates/:id/built-in`), `routes/visits.js`, `routes/lab.js`;
    website `pages/patients/PatientForm.jsx`, `PatientDetailPage.jsx`, `RiskCard.jsx`, `riskFormat.js`,
    `CarePlanTab.jsx`, `pages/visits/FindingOffers.jsx`, `pages/careplans/TemplateDetailPage.jsx`,
    `TemplateEditPage.jsx`. Tests: `server/tests/pregnancy-findings.test.js`, `risk.test.js`,
    `careplan-engine.test.js`, `careplans-other.test.js`; website `pregnancyFindings.test.js`,
    `pregnancyFindings.render.test.jsx`, `findingOffer.test.js`.
- ✅ **Automatic reminders for overdue care-plan items and missed appointments; overdue vaccinations lists** (built
  4 Oct 2026 at the owner's request).
  - **"A check-up or test is due"**: once an hour the server looks at the care plans of patients who agreed to
    reminders. If a test, scan, vaccination or check-up became overdue in the last 6 weeks and nothing is booked
    from today on, one general message is queued: "A check-up or test is due at <hospital>. Please call <phone> to
    book. Reply STOP to stop these messages." It never names what is due or why. Never for advice or daily tablets.
  - **"We missed you"**: the day after a booked appointment nobody came to: "<hospital>: we missed you at your
    appointment on <date>. To book again, call <phone>." Once per appointment and day; never the doctor or the
    visit type. It looks back 3 days, so a day with the server off does not lose it.
  - **Same two switches as the appointment reminders – no new switch and no new agreement**: Hospital admin →
    **Patient messages** → *Send automatic reminders to patients who agreed* (the page now lists the three kinds of
    message), and the agreement and a mobile number on the record itself (More → **Reminders and portal**).
  - **Babies**: only an overdue **vaccination** counts. The message goes to the number on the **baby's own record**,
    only under the agreement recorded on the baby's own record ("The parents agree…"). The mother's agreement is
    never used for the baby.
  - **Rules for both**: at most one of the two in any 14 days, per patient **and** per mobile number (a mother and
    her baby on one number get one). None while she is in hospital (a baby: nor while the mother on the baby's
    record is), when she is booked from today on, or for a record whose care plan is closed. Sent only between 10:00
    and 19:00 hospital time – also with **Send due reminders now**; outside those hours they wait for the morning.
  - **More rules for "a check-up or test is due"**: only from a care plan whose schedule **a doctor has approved** –
    a draft plan sends nothing, and the result line says how many were held back; none for 7 days after she came or
    went home from a stay; none for an antenatal record whose delivery is already recorded; none from 43 weeks.
  - **More rules for "we missed you"**: none if she came that day after all (a visit, an arrival mark, a scan or
    procedure recorded as done, or a lab sample taken), has come since, was in hospital that day, was admitted
    between the booking and its day, has delivered since it was made, or her care plan was closed after it was made.
  - **Calendar → Reminders**: every message shows its kind – "Check-up or test due · can be sent until <date>",
    "Missed appointment · of <date>". With no message provider they wait under **To send by hand** for 7 days, then
    are cancelled as too old. A waiting message that is no longer true (she booked, came, was admitted, nothing is
    overdue, the agreement was withdrawn, reminders were switched off) is cancelled by itself and shows why; one
    whose number or language changed on the record is brought up to date. **Mark as sent** checks again first.
    **Send due reminders now** (doctors, hospital admin) also counts the new messages.
  - **Sensitive records**: the message goes like any other (it says nothing medical). But the "Check-up or test
    due" **row** in Calendar → Reminders is shown only to her doctor and RMOs – so with no message provider only
    they can send it by hand. "Missed appointment" rows are shown as appointment reminders are.
  - **Today → Vaccinations overdue** (doctors, RMOs, nurses): babies with a vaccination that became overdue in the
    last 6 weeks; click a name for the vaccines by name with their last day, "Booked for…" or "No appointment
    booked", the phone and **Open the care plan**; "Draft plan" when the schedule is not approved. Another doctor's
    sensitive baby stays hidden. At most 200 babies, the newest kept.
  - **Today → Babies due – not booked** (reception): the same babies in general words only – "A check-up or test
    was due from <date>" and the phone, never the vaccine; "Draft schedule" with "ask the doctor before calling".
    Babies already booked, seen today, in hospital, or with a sensitive record are left out.
  - **Also fixed** (the "closed record" rule needed it): a postnatal or newborn care plan that a doctor closed now
    stays closed until **Reopen** – before, it was built again the next time the record was opened. A closed
    postnatal plan can be reopened also while her antenatal plan is still paused.
  - ⚠️ **DRAFT**: the Marathi and Hindi wording of the two messages (`server/src/reminders/messages.js`) – to be
    checked by fluent speakers. The vaccination dates come from the newborn template, a draft until a doctor
    approves it.
  - ⚠️ **Before real use**: a hospital that already has reminders switched on starts queueing the two new messages
    at the next hourly round, under agreements that were asked for appointment reminders only – the settings page
    says to ask those patients again. **Nothing stops the messages after a death**: staff must switch the
    reminders off on the record and close the care plan (the pages say so). (Built in October 2026 – see Next: her
    doctor records it with More → Record a death, and a closed record gets no message of any kind; the two pages
    now say so.) "Reply STOP" is still not processed by the app – staff switch the agreement off by hand. In India
    SMS wording needs DLT registration and WhatsApp approved templates, as for the appointment reminder. A
    pregnancy loss with the record left as Antenatal can still get "a check-up or test is due".
  - **Defaults the owner may want to change** (each one setting in `server/src/reminders/reminderRules.js`): 14 days
    between general messages; 6 weeks an overdue item keeps counting, and 6 weeks on the two vaccination lists
    (older ones stay on the baby's care plan only); approved plans only; 7 quiet days after she came; 3 days looked
    back for missed appointments; 7 days a message may wait; the sensitive-row rule. The hours 10:00–19:00 are
    `REMINDER_SEND_HOUR` and `REMINDER_LAST_HOUR` in `server/.env` (the defaults work without them).
  - **Left out**: a separate switch or a separate agreement for the two new messages; a "Died" close reason (a
    death is now recorded on the record itself – built in October 2026, see Next);
    automatic handling of STOP; the newborn checks and tests (hearing screen, heel prick) as a trigger; nurses
    ticking vaccinations as given; nothing new goes to the AI brief.
  - Audit log: no new entry – "Reminders sent now" and "Worklist viewed" carry counts only.
  - One-off after this update: every care plan is worked out again the first time it is read, so the first reminder
    round and the first opening of Today may be slower than usual.
  - Files: `server/src/reminders/generalReminders.js`, `reminderRules.js`, `messages.js`, `reminderService.js`,
    `phone.js`, `careplans/overdue.js`, `careplans/plansService.js`, `routes/reminderOutbox.js`, `routes/today.js`,
    `routes/worklist.js`; website `pages/reminders/RemindersPage.jsx`, `outboxFormat.js`, `pages/TodayPage.jsx`,
    `pages/worklist/WorklistSections.jsx`, `pages/settings/PatientMessagesSettingsPage.jsx`,
    `pages/patients/PatientMessagesDialog.jsx`. Tests: `server/tests/reminders-general.test.js`,
    `vaccinations-overdue.test.js`, `careplans-other.test.js`; website `outboxFormat.test.js`, `todayPage.test.js`,
    `vaccinationsOverdue.test.jsx`.
- ✅ **Prescriptions: dose check without AI, pharmacy stock while prescribing, breastfeeding and newborn warnings**
  (built 4 Oct 2026 at the owner's request). All three are on a visit's **Prescription** tab.
  - **Dose check (no AI)**: the Medicine safety list has a new kind of entry, **Dose limit** – the usual maximum for
    one dose and for a day. The form works the dose out from strength × dose × how often and shows a **Check dose**
    caution: "Paracetamol: above the usual maximum of 1 g a dose and 4 g a day". It never blocks saving and never
    asks for a reason. The same medicine on two lines is added up for the day.
  - **It is limited, and the form always says so** under the Medicine safety box: silent for a combined medicine, a
    strength without a unit ("650"), a dose in words or drops, a cream, an injection with no dose written, and any
    medicine not on the list; with SOS or "Other – write it" only the single dose is checked. "No warning does not
    mean the dose is right."
  - **Babies** (newborn care): only per-kg limits apply, with the weight recorded at this visit, otherwise the birth
    weight (the warning says which). With no weight at all the form says the doses are not checked. A limit can be
    for babies up to an age (the lower doses of the first week of life). Adult limits never apply to a baby.
  - **Breastfeeding**: postnatal record → **Edit details** → *Delivery and breastfeeding* → **Breastfeeding**: Yes /
    No / Not recorded. Shown in the safety strip ("Breastfeeding", "Not breastfeeding", "Breastfeeding not recorded
    – ask") and on a new **After delivery** card on the Overview. Breastfeeding entries warn for postnatal patients
    only: "Codeine – breastfeeding", or "… – if she is breastfeeding" when not recorded, with a link **Record it in
    her details (opens in a new tab)** – coming back, the form reads her record again and keeps what was typed
    (**Check again** does the same). An **Avoid** entry asks for a one-line reason, as in pregnancy – also when
    breastfeeding is not recorded. Changing the type of care away from postnatal clears the answer.
  - **Newborn warnings**: entries for babies in newborn care, some only up to an age in days (ceftriaxone in the
    first 28 days, co-trimoxazole under 6 weeks). The box heading says "baby, 9 days old".
  - **Never "No warnings" for what was not checked**: where the hospital's list has no entries of the patient's
    kind, the form says "Not checked: this hospital's medicine safety list has no entries for breastfeeding and no
    dose limits yet", with a link to the list.
  - **Pharmacy stock**: beside each medicine, a moment after typing stops: **In the pharmacy**, **In the
    pharmacy – low stock** or **Not in stock**. Only for those who write the prescription (doctors, RMOs). The
    server answers in stock / low / out only – never a quantity, price, batch or supplier. Nothing is shown when
    the match is not certain or the hospital keeps no medicines in the Pharmacy; "nothing beside a medicine means
    the stock list could not say". Expired stock and stopped medicines do not count.
  - **Clinic library → Clinical rules → Medicine safety**: six groups – Pregnancy: avoid, Pregnancy: use with
    caution, Pregnancy: combinations, While breastfeeding, Newborn babies, Usual maximum doses. **Edit list** → Type:
    Pregnancy – medicine, Pregnancy – combination, While breastfeeding, Newborn baby, Dose limit. Doctors edit and
    approve; RMOs and nurses read. Up to 300 entries.
  - ⚠️ **DRAFT for the doctor to check and approve**: the built-in list now has **111 entries, 76 of them new** –
    23 for breastfeeding (LactMed, BNF), 16 for newborn babies, 27 adult dose limits (BNF, labels, FOGSI) and 10
    per-kg limits for babies (3 of them for the first week of life). Each has its source. Limits where sources
    differ: nifedipine 120 mg a day (BNF 90 mg), metformin 2 g a day (label 3 g), clomifene 100 mg a day, letrozole
    7.5 mg a day, ondansetron 16 mg a dose with no daily limit, ibuprofen 600 mg a dose, phenobarbitone 20 mg/kg
    (the loading dose), cefotaxime in the first week (BNF for Children and the WHO Pocket book differ – the entry
    says so). Not confirmed against a source: drotaverine, cefixime, aceclofenac.
  - **A list a doctor approved or changed is never changed by itself.** An untouched draft list gets the new
    entries by itself. Otherwise the Medicine safety page (and **To approve**) says "76 new built-in draft entries
    are not in this list" and a doctor presses **Add them as a draft**, then reviews and approves.
  - **Privacy**: Breastfeeding is a clinical detail – doctors, RMOs and nurses see it; reception, lab and the
    pharmacist do not. The audit log gets the field name only, never the answer. The stock check reads no patient
    record and is not in the audit log. Nurses and reception see nothing about stock.
  - **Defaults the owner may want to change**: a dose warning is always a caution; a tablet, capsule, sachet,
    pessary or suppository with no dose written counts as one; the birth weight is used when no weight was recorded
    at the visit; breastfeeding warnings for postnatal patients only; stock matching is strict (the name must be the
    pharmacy's brand or generic name and the strength must agree – "Paracetamol" with no strength against "Dolo
    650" shows nothing); doctors see "low stock".
  - **Left out**: dose limits where the right maximum depends on the indication (misoprostol, oxytocin, magnesium
    sulphate, aspirin, enoxaparin, most antibiotics); baby medicines that cannot be checked per kg (vitamin K);
    combined medicines and a brand with a bare number ("Dolo 650" with an empty Strength); voice entry does not
    fill in Breastfeeding; no general interaction check.
  - Files: `server/src/medsafety/medicineSafety.js`, `routes/medicineSafety.js`
    (`POST /api/medicine-safety/add-built-in`), `pharmacy/stockMatch.js`, `routes/pharmacyStock.js`
    (`POST /api/pharmacy-stock/check`), `models/Patient.js` (`postnatal.breastfeeding`), `routes/patients.js`;
    website `pages/medsafety/doseCheck.js`, `medSafety.js`, `MedicineSafetyPanel.jsx`, `MedicineSafetyPage.jsx`,
    `MedicineSafetyEditPage.jsx`, `pages/visits/PrescriptionForm.jsx`, `rxStock.js`, `MedicineRows.jsx`,
    `pages/patients/SafetyStrip.jsx`, `hooks/onReturnToPage.js`. Tests: `server/tests/medicineSafety.test.js`,
    `pharmacyStock.test.js`, `breastfeeding.test.js`; website `doseCheck.test.js`, `medSafety.test.js`,
    `medSafetyScreens.test.jsx`, `rxStock.test.js`, `patientPayload.test.js`.
- ⚠️ **The three features above were not tried in a running app** – by the builders or after the merge (starting
  the servers was not allowed in this round). They are covered by the automatic tests (server 962 and website
  1,628, all passing after the three merges) and the website build. Please look once, with fake patients, at: Today
  (Vaccinations overdue, Babies due – not booked), Calendar → Reminders, Hospital admin → Patient messages, the
  prescription form (stock, dose check, the "Record it in her details" round trip in a second tab), Edit details
  (findings and Breastfeeding), the Overview's Risk level card, the Care plan tab, and the template and Medicine
  safety pages in the Clinic library. Phone and tablet widths were not checked.
- ✅ **Four items that had been set aside for later** (owner asked for them on 4 Oct 2026):
  1. **Scans and procedures charge the bill by themselves.** Patient record → **Lab and scans** tab → *Scans and
     procedures* → **Record a scan or procedure** (the patient's doctor, RMOs, nurses): choose it from the hospital's
     price list (names only – clinical staff never see prices). Its charge goes on her bill of the day (or her stay's
     bill) as "added by itself"; **Cancel** (with a reason) takes it off. Only what was done and when – the findings
     are written in the visit. Files: `server/src/models/WorkDone.js`, `routes/workDone.js`, `billing/hooks.js`;
     website `pages/lab/WorkDoneSection.jsx`.
  2. **Analytics → By doctor** (doctors only): the six headline numbers of Overview for each doctor's own patients,
     and the whole hospital in the last row. Exactly what "My patients only" shows that doctor; other doctors'
     sensitive records are left out and the page says how many. Hospital admins, RMOs and nurses do not get it
     (numbers this small compare staff and can point to a patient). Files: `/doctors` in
     `server/src/routes/analytics.js`; website `pages/analytics/ByDoctorPage.jsx`.
  3. **Appointments:**
     - **Length of a visit by type** – Appointments → OPD timings → *Length of a visit*: each doctor chooses 10 to 60
       minutes for New, Follow-up, Scan and Other. A longer visit also takes the slots that follow ("Taken – the
       10:00 AM visit … is still going on"); a next visit takes the first time that is free for its whole length.
     - **Fee when booking** – reception sees **Take fee** on a registered patient's New or Follow-up booking: the
       consultation price from the price list, paid in full (cash, UPI, card, insurance), on her bill of that day with
       a receipt; the booking shows **Fee paid**. Her visit that day adds no second consultation. Cancelling the
       appointment takes the charge off, and her bill shows the money as due back (Billing → Unpaid → Give money
       back). Not for quick bookings (register her first) or scans, and only once the price is set.
     - **Waiting-room screen** – Hospital admin → Patient messages → *Waiting-room screen*: switching it on gives a
       secret web address for a TV or tablet (no login). It shows each doctor's name and who goes in next, as a
       token number or an appointment time – **never a name** – and refreshes every 20 seconds. *Make a new address*
       stops the old one. Files: `server/src/routes/display.js`; website `pages/appointments/DisplayPage.jsx`.
     - **Online booking by patients** – Hospital admin → Patient messages → *Let patients book their own appointment
       in the portal* (needs the portal on). In the portal she books **one** appointment with her own doctor, from the
       next day up to 30 days ahead, in a free time, and can cancel a booking she made online. She sees which times
       are free, never who else is booked. Reception sees it marked "booked online by the patient". Recorded in the
       audit log as hers. Files: `/booking` routes in `server/src/routes/portal.js`.
  4. **WhatsApp in one click** – print preview → Share → **Send on WhatsApp now**: the prescription or visit summary
     goes to the mobile number on her record from the hospital's own WhatsApp Business number (Meta's WhatsApp
     Business Platform). It asks once before sending. Off unless all of these hold: `WHATSAPP_MODE` is set in
     `server/.env` (`practice` pretends to send – nothing leaves the computer; `live` sends), the hospital admin
     switched it on (Patient messages → *Prescriptions on WhatsApp*), and the patient agreed to WhatsApp messages
     (More → Reminders and portal → WhatsApp). The file is named with the patient number, never her name; the audit
     log never holds the number. Otherwise the earlier *Send on WhatsApp* (opens a chat to attach the PDF by hand)
     stays. Files: `server/src/visits/whatsappSender.js`, `/whatsapp` routes in `routes/visits.js`.
     - ⚠️ **Privacy:** in live mode the PDF goes through Meta's servers and can't be taken back. To go live the
       hospital needs a WhatsApp Business account with Meta, the phone number id and access token in `server/.env`
       (typed there by the owner, never in chat), and a message template approved by Meta (a DOCUMENT header and a
       body with one variable, the hospital's name). Real patients only after the app has been reviewed.
  - ⚠️ The waiting-room screen and online booking open a little of Perinexa to people without a staff login. Both are
    off until the hospital admin switches them on, and need a secure (https) address and a developer's review before
    real use.
  - Tests: `server/tests/billing.test.js`, `analytics.test.js`, `appointments.test.js`, `portal.test.js`,
    `visits.test.js`. Checked on screen with made-up data: By doctor, the day's times (longer visits, Take fee, Fee
    paid, booked online), the fee dialog, OPD timings, Patient messages, Scans and procedures, the waiting-room
    screen, the portal's booking. Not seen on screen: the "Send on WhatsApp now" question in the print preview.
- ✅ **ABDM linking – milestone M1** (owner approved the plan on 3 Oct 2026 – `docs/ABDM_PLAN.md`). Works now in
  **practice mode** (a built-in stand-in for ABDM: made-up ABHAs, the OTP is 123456, every screen says so).
  - Patient record → **ABHA** tab (reception, doctors, RMOs): **Verify her ABHA** (ABHA number, ABHA address or
    mobile → OTP to her mobile → her ABHA details beside her record → she agrees → linked) or **Create her ABHA**
    (her agreement to ABDM's text → her Aadhaar number in a hidden box → OTP to her Aadhaar-linked mobile → her ABHA
    → choose an ABHA address → linked) → **Print her ABHA card**; **Unlink** with a reason.
  - The record keeps the ABHA number and address (owner allowed ABHA only – the "no government ID" rule still holds
    for Aadhaar and all other IDs). Screens show it partly hidden (91-XXXX-XXXX-3333); the full number only on the
    ABHA tab. **The Aadhaar number is never stored, shown again or logged** (a test reads every record to make sure).
  - **Scan & Share** on reception's Today page: patients who scanned the desk QR in their ABHA app, with a token;
    *Confirm* (record already has that ABHA), *Find her record*, *Register* (form filled in from her ABHA, linked on
    save) or *Put aside*. ABDM's messages are accepted only with ABDM's signature, for the hospital with that HIP ID.
  - **Hospital admin → ABDM**: HFR facility ID, HIP ID, counter code; how to get the Scan & Share QR from HFR; the
    list of requests to check against ABDM's sandbox documentation.
  - ⚠️ To connect for real: register the hospital in HFR and the doctors in HPR; apply for sandbox credentials
    (sandbox.abdm.gov.in) and put them in `server/.env` (ABDM_MODE=sandbox, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET);
    Scan & Share also needs Perinexa on a public HTTPS address (its bridge URL is `https://<host>/api/abdm/public`);
    a developer checks the requests in `server/src/abdm/v3Client.js` (ABDM_CHECKLIST) against the sandbox; ABDM's
    certification (functional test and WASA audit) before production.
  - Files: `server/src/abdm/`, `routes/abdm.js`, `models/ScanShare.js`; website `pages/abdm/`. Tests:
    `server/tests/abdm.test.js`.
- ✅ **Pharmacy and medicine stock** (owner approved the plan on 3 Oct 2026 with three changes – `docs/PHARMACY_PLAN.md`).
  - New **Pharmacist** staff role (Hospital admin → Staff). Pharmacists see patients' names, numbers, phones and the
    medicines prescribed – never diagnoses, notes or results. A new **Pharmacy** item in the left menu (pharmacists;
    the hospital admin gets Stock, Purchases, Medicines, Suppliers, Reports and Settings).
  - **Medicines** (brand, generic, form, strength, unit of sale, HSN, GST rate, schedule – G, H, H1, X, narcotic –,
    reorder level) and **Suppliers**; **Purchases**: each supplier invoice with batch, expiry month, quantity, free
    quantity, purchase price and MRP per unit (cancel only while none of its stock has left).
  - **Sell**: choose the patient → her recent prescriptions (medicines only) → *Use this prescription* matches each
    medicine to the stock list with a suggested quantity; or find medicines; or a **walk-in customer** who pays at the
    counter. Earliest-expiring batch first (or choose one); expired stock is never sold. Schedule H/H1/X/narcotic
    need a prescription (the Perinexa one, or the doctor's name and "prescription seen"); **X and narcotic** only to
    registered patients with the doctor's registration number. Optional discount % with a reason.
  - Every sale and every **issue to an admitted patient** (Issue to ward) is a **GST tax invoice** (PH-000001 …:
    HSN, batch, expiry, MRP, taxable value, CGST, SGST – owner's choice, also for inpatients). A registered patient's
    invoice goes on her hospital bill (her stay's bill when admitted). **Returns** of unopened medicines **before
    expiry** (owner's choice): stock back, a credit note (CN-000001), her bill lowered or a walk-in refunded.
  - **Stock**: usable and expired quantities, value at cost and MRP, low and expiring marks; per medicine its
    batches and every stock move; **write-off** and **stock count** with a reason (a witness's name for X and
    narcotic medicines).
  - **Reports**: low-stock and expiry alerts (also a notice on the pharmacist's Today page), the **H1, Schedule X
    and narcotic registers** (running balance, printable), sales by day, GST by rate after returns, purchases by
    supplier; admin export of sales and purchases for Excel. **Settings**: pharmacy name, GSTIN, drug licence numbers
    (Forms 20/21), NDPS recognition (RMI), pharmacist – printed on invoices.
  - ⚠️ Before real use: drug licence and a registered pharmacist; narcotics only with RMI recognition and locked
    storage; the accountant to confirm GST on inpatient issues.
  - Demo: a pharmacist's account (both demo hospitals; added to the demo script (removed 12 Oct 2026)).
  - Files: `server/src/pharmacy/`, `models/Pharmacy.js`, `routes/pharmacy.js`; website `pages/pharmacy/`,
    `styles/pages-pharmacy.css`. Tests: `server/tests/pharmacy.test.js`.
- ✅ **Billing** (owner approved the plan on 3 Oct 2026 – `docs/BILLING_PLAN.md`). A new **Billing** item in the left
  menu for reception and the hospital admin (doctors, RMOs, nurses and lab staff have no billing):
  - **Price list** (Billing → Price list; the admin changes it, reception reads it): a starting list at ₹0 for the
    admin to fill in – consultation (new, follow-up), every lab test, bed charge per day (general ward, private
    room – matched to the ward written at admission), deliveries, scans, procedures, medicines, other. Items can be
    added and stopped, never deleted. A new price applies to new charges; automatic charges still at ₹0 ("price not
    set") pick the price up once it is set.
  - **Charges add themselves**: starting a visit → consultation (new for her first visit, else follow-up); a lab
    order → each test; an admission → the stay's bill with the bed days (admission day counts, discharge day not,
    at least 1, growing until discharge). Cancelling the visit or the lab order takes its charge off. Outpatient:
    one bill per patient per day; a stay: one bill. A billing problem never stops the clinical work.
  - **A bill** (B-000001 …): add items from the price list (scans, procedures, medicines – the app does not yet
    record when these are done), take items off (reason), discount by amount or % (reason), **Take payment**
    (cash, UPI, card, insurance/scheme with its name and claim number; part payments), **deposits** while she is
    in hospital, **Give money back** when more was paid than is due, **Cancel** an unpaid bill (reason). Each
    payment has a receipt (R-000001 …). The bill and each receipt print on A5 with the letterhead (no GST).
  - **Unpaid** (who owes how much, with phone), **Daily summary** (by mode and by person, discounts and cancelled
    bills – printable for handing over the cash), **Monthly** (admin: charged by group and doctor, collected, and
    the **export** of bill items or payments as a file for Excel).
  - Patient record → **Bills** tab (reception). Full item names on screen and on paper (owner's choice) – except
    the HIV test, shown and printed as "Lab test (confidential)" (HIV and AIDS Act 2017, owner approved).
  - Audit log: bill viewed, item added/taken off, discount, payment, refund, cancelled, printed, price list
    changed, export (ids and amounts only).
  - Note: the hospital admin sees patient names and bill items in Billing (the approved plan); elsewhere an admin
    with no clinical role still sees no patient data.
  - Files: `server/src/billing/`, `models/Bill.js`, `models/PriceItem.js`, `routes/billing.js`; website
    `pages/billing/`, `styles/pages-billing.css`. Tests: `server/tests/billing.test.js`.
- ✅ **Reception patient card** (owner, 3 Oct 2026; from `docs/USE_CASE.md` "Print a patient card"): patient record →
  **More → Print patient card**, or **Print patient card** on her Appointments tab (reception, doctors, RMOs,
  nurses). An A5 page with the letterhead, her name, patient number, doctor, her next 3 booked appointments (date,
  time, doctor) and empty rows to write later ones in, and "bring this card to every visit". Nothing medical and no
  phone number (a card can be lost). Each printout is in the audit log ("Patient card printed", ids only). Checked on
  paper (headless Chrome PDF): one A5 page. Files: `client/src/pages/appointments/PatientCard.jsx`, the
  `card-printed` route in `server/src/routes/appointments.js`.
- ✅ **Appointment booking** (owner approved the plan on 3 Oct 2026 – `docs/APPOINTMENTS_PLAN.md`). A new
  **Appointments** item in the left menu (reception, doctors, RMOs, nurses; reception and doctors book):
  - **OPD timings** (Appointments → OPD timings; hospital admins: Hospital admin → OPD timings): each doctor's
    sessions for each day of the week and their leave. Cut into **10-minute slots**. Saving lists bookings that no
    longer fit, and gives next visits that were waiting for a time the first free slot.
  - **Day** tab: one doctor's day, slot by slot. Click **Book** on a free time → find a registered patient, or
    **New patient** (quick booking: name and phone only) → visit type (New, Follow-up, Scan, Other – no medical
    details). A taken slot, or a second booking the same day, asks **Book anyway**. **Move** and **Cancel** (with a
    reason). Refused: a past day or time, a leave day, outside the OPD hours, a doctor with no timings.
  - **The next visit books itself**: saving a visit with "Next visit" takes the first free slot that day with her
    doctor ("Booked: 17 Oct 2026 at 10:00 AM with Dr. …" under the field). Doctor on leave / no OPD / day full →
    the **Needs a time** tab (and a notice on Today) for reception. Changing the date moves the booking, clearing it
    cancels it, cancelling the visit cancels it; a booking reception moved by hand is left alone.
  - **Today**: each patient's time or token and doctor; **Walk-in token** (header) or *Mark arrived* for someone
    with no appointment → choose the doctor → the next token (1, 2, 3 … per doctor per day) and a printable
    **token slip** (A5: hospital, doctor, token, date – no name, nothing medical). **Waiting to be seen**: each
    doctor's list in calling order – booked patients at their time first, walk-ins in token order in the gaps,
    early arrivals after; the first is marked **Next**. **New patients booked today** with **Register** (the form
    opens with her name, phone and doctor filled in; the booking joins her record when saved).
  - Patient record → **Appointments** tab (upcoming with Move/Cancel; earlier ones: seen, did not come, cancelled
    and why). A booking nobody came to becomes **Did not come** and goes on the Overdue call list (since 4 Oct
    2026 a patient who agreed to reminders also gets a "we missed you" message the next day – see above).
  - **Calendar**, portal and the reminder page show the time and doctor. **Messages** (only if the hospital switched
    them on and the patient agreed): on booking, moving and cancelling, plus the day-before reminder with the time
    and doctor – never her name or why she comes. An unsent change is replaced by the newer one. ⚠️ The Marathi and
    Hindi wording is DRAFT (to be checked by fluent speakers).
  - Older next-visit dates are turned into appointments once when the server starts.
  - Audit log: booked, moved, cancelled, linked, token given, OPD timings changed (ids, days and times only).
  - Files: `server/src/appointments/`, `models/Appointment.js`, `models/OpdSchedule.js`, `routes/appointments.js`;
    website `pages/appointments/`, `styles/pages-appointments.css`. Tests: `server/tests/appointments.test.js`.
  - Online booking by patients, the fee when booking, a waiting-room screen and the length of a visit by type were
    added on 4 Oct 2026 (see "Next").
- ✅ **Cheaper AI model** (owner, 2 Oct 2026): the **AI summary** on the visit page and **Write a letter** now use
  gpt-5.4-mini, like the AI brief – measured on a demo patient: a summary about ₹0.08 and a referral letter about
  ₹0.12, each in about 3 seconds (on gpt-5.5 they were roughly ₹1–3). **Reading a lab or scan report** stays on
  gpt-5.5, the stronger model, because it copies values from a photo or PDF. Translation, the risk check, Ask your
  records and the check before printing were already on the cheaper model.
- ✅ **AI brief** (owner, 2 Oct 2026: "AI will brief about what's important to look at in that page") on **Today**,
  the **Calendar** and a **patient's page** (Overview), for doctors and RMOs. **Brief me** gives 3–6 short points,
  the most urgent first (marked "Attention"); patients named in it are links to their record. Made only when
  asked (each one costs a little), shown and not saved; **Brief me again** after changes. Until asked it is one slim
  line, so the patient Overview still fits one screen. Every brief uses the cheaper model, gpt-5.4-mini (owner's
  choice, 2 Oct 2026). Measured on the demo data (₹88 per $1): Today with 21 patients about ₹0.16, a Calendar
  week about ₹0.11, a patient's page about ₹0.07 (with a "Not recorded" list), each in 4–15 seconds. Example: Today
  3 times a day, the Calendar once and 20 patient briefs a day ≈ ₹50 a month. (On gpt-5.5 a Today brief cost about
  ₹5.70 and a patient brief ₹1.20–1.90.)
  - What it reads is what the page shows for that person: Today – red flags, lab results to review, notes to
    confirm, who is in hospital, today's patients (arrived / expected / visit progress), call lists, care plan to
    act on; Calendar – the entries and counts of the day, week or month on screen (same types and patients);
    a patient – the record as for the AI summary, plus lab orders of the last 90 days and a current stay.
  - **Privacy:** on Today and the Calendar each patient goes to OpenAI as a label such as [P3] – never the name,
    phone, address or patient number, and no typed notes; Perinexa turns the labels back into names on the screen.
    A point naming a label that was not sent is dropped. **HIV is never sent** (condition, risk reason, test result,
    or a typed line that names it – HIV and AIDS Act 2017); an HIV test that is *due* can be mentioned (offered to
    every pregnant woman). Anything about the baby's sex is withheld (PCPNDT). Audit log: "AI used" with the page
    and the ids of the patients included – never the text. An empty page is not sent.
  - Files: `server/src/ai/brief.js`, `routes/aiBrief.js` (`POST /api/ai/brief/today | calendar | patient/:id`);
    the Today, worklist and inpatient lists are now functions the brief reuses (`todayFor`, `worklistFor`,
    `inpatientsFor`); website `pages/ai/AiBriefCard.jsx`, `briefParts.js`. Tests: `server/tests/aiBrief.test.js`.
  - Before real patients: as for every AI feature (provider agreement, developer review). Typed notes on a
    patient's page are scrubbed of her name and phone-like numbers only; medicines are sent by name.
  - Automatic tests: server 695 and website 1,493, all passing (OpenAI is replaced by a stand-in in the tests).
- ✅ **Baby lab tests and packages** (owner, 2 Oct 2026): a baby's Lab tab (newborn care) now offers only **baby
  tests**, with newborn values – blood sugar, bilirubin (total and direct, with the age in hours), newborn CBC with
  reticulocytes, blood group + DCT, G6PD, Na/K/calcium, preterm bone check (Ca, phosphorus, ALP), TSH + free T4,
  sepsis screen (TLC, ANC, I/T ratio, micro-ESR, CRP), blood culture, the heel-prick **newborn screening panel**
  (hypothyroidism, G6PD, CAH, galactosaemia, PKU, biotinidase) and the nursery checks (hearing OAE, pulse-oximetry
  heart screen, skin bilirubin TcB). Adult tests are refused on a baby's record, and baby tests on an adult's; the
  baby's tab links to the **mother's** Lab tab.
  - **Packages by day of life** (day of birth = day 0) in the order form, those that fit the baby's age marked
    "Fits today": at birth – cord blood; first 24 h – low-sugar watch; day 0–2 – baby of a diabetic mother;
    day 2–3 – newborn screening before going home (every baby); day 1–14 – jaundice work-up; sepsis screen;
    day 3–14 – baby of a mother with thyroid disease; day 7–14 – repeat screening; after day 14 – prolonged
    jaundice; week 3–6 – preterm anaemia and bone check. A package ticks its tests (any can be unticked); the
    order records the package and shows it.
  - **Clinic library → Test packages** (owner asked, 2 Oct 2026): the packages are now the hospital's own, like
    prescription sets – doctors add, edit (a new draft), copy, approve and stop using them; doctors, RMOs and nurses
    read them; drafts show "Draft" in the order form and on "To approve". 16 built-in DRAFT packages: the 10 baby
    packages above, and 6 for adults (antenatal booking, 24–28 weeks, 32–36 weeks, pre-eclampsia work-up, before an
    operation, sugar test 6–12 weeks after GDM). An order records each package's name and version.
    Files: `server/src/lab/builtInPackages.js`, `lab/labPackages.js`, `models/LabPackage.js`, `routes/labPackages.js`;
    website `pages/lab/TestPackage*.jsx`.
  - **Newborn care plan**: three new items – newborn screening (heel prick, after 48 hours), pulse-oximetry heart
    screen (after 24 hours) and hearing screen (OAE, by 1 month). A reviewed lab result ticks them off. Hospitals
    that already had the newborn template get them added once, as a new **draft version to approve** (an approved
    template becomes a draft); babies' plans take them when moved to the new version on the Care plan tab. If a
    doctor removes them, they are not added again.
  - ⚠️ DRAFT newborn values, packages and care-plan items (NNF India, AAP 2022, RBSK) – to be checked by a
    paediatrician.
- ✅ **Abortion as a type of care** (owner, 2 Oct 2026): pregnancy loss outside the MTP Act only – miscarriage
  (inevitable, incomplete, complete, missed, septic), ectopic and molar pregnancy, and the work-up for
  recurrent pregnancy loss. A threatened miscarriage stays under Antenatal (owner, 3 Oct 2026 – see below).
  **Induced termination (MTP) is not recorded in Perinexa** – there is no value for it, and no field for the baby's
  sex (PC-PNDT).
  - **New patient → Abortion (pregnancy loss)** (between Gynaecology and Newborn). Step 2, "Pregnancy loss": type of
    loss (with a short help text), date seen (today by default), LMP – the weeks at presentation are worked out
    ("9 w 2 d"), or typed when the LMP is not known – site (ectopic), kind of mole and histology (molar),
    management (only the choices that fit the type of loss) with its date and outcome, anti-D, and a note. Then the
    usual obstetric history and medical background (blood group and Rh: anti-D may be needed).
  - Checks: below 28 w 0 d (from 28 weeks it is a still birth, recorded as a delivery); a hint from 20 weeks; no
    date in the future; the LMP not after the date seen; recurrent loss keeps no LMP, weeks, anti-D or date of
    management. The note and the histology result never mention the baby's sex.
  - The record: a **Pregnancy loss** card on Overview (for those who see medical details), "Abortion · missed" in
    the header, and "Rh negative – anti-D" in the safety strip until anti-D is recorded as given or not needed.
    Reception and lab see only the word "Abortion". It is not marked sensitive by itself (the doctor can mark it).
  - No care plan in this version (the Care plan tab says so). (Built in October 2026 – see Next: a DRAFT
    pregnancy-loss care plan now starts by itself from the date seen.) Changing an antenatal patient to Abortion
    pauses her antenatal plan, as any change of type does (a warning shows first); her pregnancy dates stay stored but
    are not used (no EDD, no calendar dates, no weeks today, no risk level). Changing back to Antenatal copies the
    loss's LMP only for an old threatened-miscarriage record (the same pregnancy), with "copied from the pregnancy
    loss – check it" under the LMP; any other loss has ended, so a new pregnancy needs its own LMP. A record that becomes
    antenatal has its stored LMP checked again (more than 45 weeks ago is refused).
  - No delivery note on an Abortion record: an evacuation or an operation for an ectopic goes in an operation note.
    A delivery draft made while she was antenatal still opens, read-only.
  - Voice entry: in abortion care "LMP …" fills the loss's LMP and "missed miscarriage", "ectopic", "molar
    pregnancy" … fill the type of loss (two different types said are asked about); "anti-D given" fills Anti-D
    (given), "anti-D due" fills "not given yet" (the date given is left for the doctor; for recurrent loss or a
    previous pregnancy it stays a note, as before). Anything about the baby's sex is
    taken out and flagged, as in antenatal care. Not offered for abortion: breech, EDD, scans and the like.
  - Medicine warnings for pregnancy: only a continuing pregnancy (antenatal care) gets them. Abortion care never
    does (owner, 3 Oct 2026) – misoprostol or methotrexate is the intended treatment there.
  - Analytics: Abortion in "New registrations by type of care", "Visits" and "Other care" (Overview). Monthly
    report: a "Pregnancy loss" section after Deliveries (by the date seen).
  - AI brief (Today and the Calendar, added on main): an abortion patient is described only as "pregnancy loss
    (abortion care)" with the type of loss – no weeks today and no EDD, even if old pregnancy dates are stored.
  - Consent forms: the HIV test, anaesthesia and the early-pregnancy-loss information sheets (miscarriage,
    ectopic, molar) are listed for Abortion (the threatened-miscarriage sheet stays for antenatal and gynaecology
    care); nothing is suggested automatically. No new
    consent form and no built-in prescription sets for it (four DRAFT sets built in October 2026 – see Next).
    Reminders and the portal never name it.
  - Demo data (the demo script (removed 12 Oct 2026), owner runs it): Sample Loss 01–03 (Demo) – missed (medical management), ectopic
    in the tube (laparoscopy, O negative, anti-D given), incomplete (surgical evacuation).
  - Also fixed while doing this: (a) pregnancy dates are checked against today only when they change, so a record
    whose pregnancy ended (now postnatal or abortion care) with an LMP more than 45 weeks ago can be saved again –
    before, every later save failed; (b) the record's notes, allergies and other conditions are checked for words
    about the baby's sex in antenatal and abortion care (infertility notes may still say "male factor"); text
    already stored is not checked again; (c) due-date sorting (patient list, Analytics lists, Ask your records)
    and the weeks / EDD search of Ask your records use antenatal records only.
  - ⚠️ DRAFT clinical content, for the doctor to check (NICE NG126, ESHRE 2022, RCOG GTG 38, WHO 2022, MoHFW CAC
    2018): the help text for each type of loss, which management fits which type, the 20-week hint and the 28-week
    limit, the anti-D line, the molar hint, the antenatal-to-abortion warning and the Gravida / Abortions (A) hint.
    These are fixed in the app, not in the Clinic library, so there is no Approve button for them: the Pregnancy
    loss form always shows "Lists and hints are drafts". After checking them, tell the developer what to change (or
    that they are fine); the developer then updates them and removes the note.
  - **Questions for the owner – answered 3 Oct 2026** (the owner's answers; the numbers are the ones below):
    1. Week limits: **as built.** A loss at 28 w 0 d or later is refused under Abortion and must be recorded as a
       delivery (still birth); the hint from 20 weeks stays.
    2. Recurrent loss: **2 or more losses** (ESHRE), as built ("Two or more losses before 24 weeks").
    6. The word patients and reception see: **keep "Abortion".**
    8. A threatened miscarriage: **stays under Antenatal** – changed, see "Threatened miscarriage under Antenatal"
       below.
    9. Changing the type of care: **reception may still change it** (unchanged).
    - Medicine warnings: **only a continuing pregnancy gets pregnancy warnings** – agreed; with 8, an abortion
      patient never gets them.
    - Not covered by the answers, so still open (the app keeps working as in brackets): 3. Anti-D – NICE (only
      after surgical management or an ectopic) or every Rh-negative woman? (the reminder shows for every
      Rh-negative woman until recorded) 4. Does the current loss count in Abortions (A)? (count it once the loss is
      over if before 20 weeks; at 20 weeks or more the doctor decides) 5. A septic or incomplete abortion after an
      abortion done elsewhere: only the care of the complication is recorded, never whether it was induced.
      (as built) 7. The misoprostol medicine-safety text and the risk-rule wording of 2 Oct 2026. (as changed)
      10. Saving an old record with an LMP more than 45 weeks ago used to fail (fixed) – was that seen in use?
  - **Threatened miscarriage under Antenatal** (owner's answer 8, 3 Oct 2026). A threatened miscarriage is a
    continuing pregnancy: it is recorded in her antenatal record (the "Threatened miscarriage" note, as before),
    never as a type of loss.
    - Removed from the Abortion lists (server and website), the help texts, "Pregnancy continuing" as an outcome
      and "Medicines (doctor's choice)" as a management; the AI's voice suggestions, the monthly report row and the
      demo data. The threatened-miscarriage information sheet is no longer listed for Abortion (still for antenatal
      and gynaecology care; unedited draft copies are refreshed).
    - The registration and edit pages for Abortion say: "A threatened miscarriage is a continuing pregnancy –
      register or keep her under Pregnancy (antenatal)." Voice entry on those pages fills no type of loss for
      "threatened miscarriage" and shows that sentence as a note instead. The visit's voice example for abortion
      now uses an incomplete miscarriage.
    - **Records saved before** with "Threatened miscarriage" are kept exactly as they are (nothing is migrated or
      deleted) and still open everywhere: the record, the list ("Abortion · threatened (now under Antenatal)"), the
      AI, the brief and the monthly report. They show "Threatened miscarriage (now recorded under Antenatal)" and
      "Pregnancy continuing (now recorded under Antenatal)", with a note on the record. Saving the Pregnancy loss
      section without changing the type of loss is refused: "Threatened miscarriage is now recorded under Pregnancy
      (antenatal). Choose another type of loss, or change the type of care to Pregnancy (antenatal)." A doctor's or RMO's
      Edit details sends that section, so it is refused until one of the two is done (the edit page shows the same
      warning at the top of the section). Saves without that section (reception's contact details, notes) work and
      leave it untouched. Changing such a record to Antenatal copies
      the loss's LMP into the pregnancy (check it). The monthly report counts them under "records … to tidy".
    - How to test (fake data): New patient → Abortion: the hint shows, and the type of loss has no threatened
      miscarriage. In voice entry on step 2 say "threatened miscarriage": nothing is filled and the hint shows.
      An old record can only be made by the developer (tests do this).
  - Not in this version (the first five – the care plan with hCG follow-up, the red flags, the findings as fields, the
    prescription sets and the work-up package – were built in October 2026, see Next): a care plan or follow-up for
    pregnancy loss (beta hCG series, molar follow-up, ectopic hCG schedule); red flags for a ruptured ectopic or a
    septic abortion; os, rupture and scan measurements as fields (they go in the note or the visit notes); built-in
    prescription sets for medical management; a recurrent-loss work-up panel (order antiphospholipid antibodies and
    karyotype as "Another test"); limiting type-of-care changes to clinical staff (the owner decided against it on 3
    Oct 2026); Analytics beyond counts; an Approve step in the Clinic library for the abortion lists and hints.
    **Never**: induced termination (MTP) records, Form F, a PC-PNDT register, or any record of the baby's sex before
    birth.
  - Analytics speed with the seventh admin view per period (Abortion): the speed test
    (`ANALYTICS_PERF=1 npm test`) was not run for this change.
  - Files: `server/src/patients/abortionRules.js` (lists; the website's copy is
    `client/src/pages/patients/abortionFormat.js`, a test checks they match), `models/Patient.js` (`abortion`),
    `routes/patients.js`, `routes/admissions.js`, `careplans/plansService.js`, `reports/monthlyReport.js`,
    `analytics/metrics/overview.js`, `ai/context.js`, `ai/understand.js`, `routes/aiAsk.js`; website:
    `pages/patients/AbortionSection.jsx`, `PatientForm.jsx`, `PatientDetailPage.jsx`, `SafetyStrip.jsx`,
    `dictation.js`, `obgyTerms.js`, `medsafety/medSafety.js`.
- ✅ **Information forms** (owner, 2 Oct 2026): a separate part for conditions that need the patient and her
  relatives to be *informed* rather than to *consent* – e.g. PIH, GDM, low thyroid, oligohydramnios. The doctor
  explains the condition, its risks and complications, and the patient and two relatives sign that they were
  informed (with the doctor, a witness and an interpreter if needed). The sheet says plainly that it is not a
  consent for any procedure.
  - **Clinic library → Information forms** (beside Consent forms): 38 DRAFT sheets in English, Marathi and Hindi,
    listed on the patient's tab by stage of care –
    - Early pregnancy: severe vomiting (hyperemesis), bleeding / threatened miscarriage, miscarriage, suspected
      ectopic, molar pregnancy.
    - Pregnancy: high BP / PIH / pre-eclampsia, GDM, low thyroid, anaemia, obstetric cholestasis, Rh negative, heart
      disease, epilepsy, hepatitis B, BMI 30+, age 35+, bad obstetric history, twins, oligohydramnios,
      polyhydramnios, FGR, big baby, a problem found in the baby (doctor types it; never the sex), low-lying placenta,
      bleeding / abruption, short cervix, preterm labour / leaking, reduced movements, breech / transverse,
      past the due date, death of the baby in the womb.
    - Labour: concern about the baby (fetal distress / meconium), labour not progressing.
    - After delivery: PPH, infection (puerperal sepsis), severe perineal tear, postnatal depression.
    - A general sheet where the doctor types any other condition.
    - **Not included on purpose: HIV.** A sheet signed by relatives would disclose her HIV status, which the HIV and
      AIDS Act 2017 forbids without her consent – HIV counselling stays with the HIV consent and the ICTC.
      Hepatitis B and postnatal depression sheets say relatives are informed only with her agreement.
    Doctors edit, copy, add their own, and approve, exactly like consent forms.
  - Patient record → **Information given** tab (next to Consent forms): "To explain now" lists the sheets the record
    points to – ticked conditions (hypertension, diabetes, thyroid, anaemia), the latest visit's red flags (raised
    BP / possible pre-eclampsia, anaemia, not head-down), lab results this pregnancy (OGTT or TSH flagged high,
    Hb below 11) an Rh-negative blood group, heart disease / epilepsy / hepatitis B ticked (or HBsAg reactive), BMI 30+, age 35+,
    40 weeks or more, reduced fetal movements at the latest visit, and problems in earlier pregnancies or 2+ miscarriages / abortions (bad obstetric
    history – those problems are filled into the sheet). Print in English + Marathi/Hindi; the printout is listed under
    "Given to this patient", and the signed copy and its scan are recorded as for consents.
  - **Reminder**: at the top of every screen of the record (Overview, a visit, a stay) – "Information to give: …" –
    until that sheet has been printed in this pregnancy. So it appears at the OPD visit where high BP is found, and
    at admission.
  - Sheets that depend on scan findings, the labour ward or after-delivery events (e.g. oligohydramnios, cholestasis –
    no bile-acid test in the lab list (added in October 2026 – see Next) – FGR, low-lying placenta, twins, PPH) are
    not suggested automatically (scan findings are not stored as fixed fields): the doctor picks them from the list.
    (Since 4 Oct 2026 twins, a low-lying placenta, GDM, high blood pressure and bleeding can be ticked as findings in
    this pregnancy – see above – but the sheets are not yet suggested from those ticks.)
  - ⚠️ The medical content and the Marathi and Hindi wording are drafts by the developer and must be checked by the
    doctor (and fluent speakers) before approval.
  - Files: `server/src/consents/forms/info_en.js`, `info_mr.js`, `info_hi.js`, `consents/builtInForms.js`,
    `consents/suggest.js`, `routes/patientConsents.js` (`?kind=information`, `/information-due`); website:
    `pages/consents/*` (`InformationDue.jsx` is the reminder).
- Owner/doctor: **look once at sharing her records through ABHA and her records from other hospitals** with fake
  patients ("How to test ABDM sharing and records from other hospitals" below) – nobody has seen these screens in a
  running app yet.
- Owner/doctor: check and approve the DRAFT **HIV word list** (Hospital admin → ABDM, "Words that mark a record as
  about HIV"). A record whose shared text has one of these words is never shared. Tenofovir is also used for
  hepatitis B in pregnancy, so those visits are held back too. Approve, or say what to add or remove.
- Owner/doctor: **pregnancy-loss records** (Abortion type of care) are shared through ABHA like other records unless
  marked sensitive (infertility records are sensitive from registration, so never shared). Should pregnancy-loss
  records be held back by default too?
- Owner/doctor: when a **death has been recorded** (record closed), may her records still be sent when a consent
  comes from her ABHA app (as built), or should closing the record stop all sharing?
- Owner/doctor: should the doctor's **review comment on lab results** go with the lab report (held back now)? And
  should admission, operation or delivery notes ever be shared? Only the discharge summary is now.
- Owner/doctor: linking her records to her ABHA is for **her doctor or an RMO only**, not reception. Right for your
  hospital?
- Owner/doctor: her ABHA app finds her records here **only through the ABHA verified at the desk**. ABDM also allows
  matching by mobile number, name and year of birth (looser, and could show that someone is a patient here). Keep
  the strict rule?
- Owner/doctor: in real use the OTP for linking from her app goes by **SMS through the Twilio setup** used for
  reminders: "<hospital>: <OTP> is your OTP to link your records at this hospital to your ABHA. It is valid for 10
  minutes. Do not share it with anyone." In India this wording needs DLT registration. Approve the wording and using
  Twilio for OTPs?
- Owner/doctor: should **nurses** also see records from other hospitals? Now only doctors and RMOs who may see her
  medical details do, because they include doctors' notes from elsewhere.
- Owner/doctor: Perinexa cannot look inside an attached PDF or photo for words about the baby's sex. Should **attached
  files** be offered during a pregnancy, as now (with a warning on screen), or held back until after delivery?
- Owner/doctor: the fetal-sex word list also withholds harmless lines from other hospitals, such as "Sex hormone
  binding globulin" or "female pelvis". Acceptable, or should known lab test names be exempt?
- Owner/doctor: is **30 days** the right default for how long her consent lasts (choices 7 days to 1 year)? Shorter is
  more private, but the records disappear when it ends.
- Owner/doctor: should the Ask form start with **all 7 kinds of record** ticked (as now), or only some (for example
  consultations, lab reports and discharge summaries)?
- Owner/doctor: should a doctor be able to **delete records from other hospitals** before her consent ends ("Delete
  now")? And should they ever be printable (printing could count as sending them on)?
- Owner/doctor: should Perinexa **flag a document whose name differs** from her record? Now the doctor is asked to
  check it by eye.
- Owner/doctor: **look once at the care-plan default protocol, updating all plans and editing an added item** with
  fake patients ("How to test the care-plan default protocol…" below) – nobody has seen these screens in a running
  app yet.
- Owner/doctor: when a doctor with a default protocol starts the plan of an **unassigned patient**, should it start
  from that doctor's default? Today it starts from the hospital standard; only patients assigned to the doctor
  use the doctor's default.
- Owner/doctor: **Update all plans** for the hospital standard template – today a doctor updates only their own and
  unassigned patients' plans; other doctors' patients are left for their own doctor, or an RMO, one plan at a time.
  Should one doctor be allowed to update everyone's plans at once?
- Owner/doctor: **paused plans** are left out of Update all plans (they are counted under "used by"). Is that
  right, or should paused plans be updated too?
- Owner/doctor: should **nurses** see the "used by N current plans" counts? They do now; it is a count only.
- Owner/doctor: when editing an item a doctor added, should the **type of item** (test, scan, vaccination…) and the
  **reason for adding** also be editable? Both are fixed today.
- Owner/doctor: **look once at Marathi and Hindi for the patient** with fake patients ("How to test Marathi and Hindi
  for what the patient reads" below) – nobody has seen these screens in a running app yet.
- Owner/doctor: **who will check the Marathi and the Hindi?** Every line is in `docs/TRANSLATIONS_TO_CHECK.md`, next
  to its English, with tick boxes for the checkers. Until then the app shows the wording as a draft. Should the
  note at the top of the portal (the wording is still being checked) stay until then?
- Owner/doctor: please approve the **new English note at the end of the patient copy**. After a delivery it ends
  with the plan's own danger-sign advice: "heavy bleeding, fever, bad-smelling discharge, severe headache or
  breathlessness"; for a baby: "feeds poorly, breathes fast, is hot or cold, turns yellow or has fits".
  Gynaecology, fertility and pregnancy-loss copies end only with "In an emergency, go to the hospital straight
  away." Is the wording right, and should those copies name some danger signs?
- Owner/doctor: the pregnancy copy still names its danger signs in a fixed sentence (unchanged). Should it follow
  the plan's own danger-sign advice item instead, as after a delivery and for a baby? Its English would change.
- Owner/doctor: should doctors be able to type their own **Marathi and Hindi for care-plan items** in the template
  editor? Today a reworded item prints in English only, and only the developer can change the translations.
- Owner/doctor: the letterhead ("Phone:"), the doctor's signature block ("Reg. No.") and the page footer stay in
  **English** on these printouts, as on the prescriptions. Do you want them translated too?
- Owner/doctor: should a patient who **declines reminders** still have a preferred language recorded for her
  printouts and the portal? Today the language counts only while she agrees to reminders.
- Owner/doctor: the **pregnancy-loss care plan** (23 items) and "Check-up or test – your doctor will explain" have
  no Marathi or Hindi yet, so they print and show in the portal in English. Translate them next?
- Owner/doctor: **look once at pregnancy-loss care** with fake patients ("How to test pregnancy-loss care" below) –
  nobody has seen these screens in a running app yet.
- Owner/doctor: check and approve the DRAFT content of **pregnancy-loss care**: the care-plan template (Clinic
  library → Care plans), the 8 red-flag rules, the 4 prescription sets, the "Recurrent pregnancy loss work-up"
  package, the bile-acid limit and the findings hints, with the sources each one names.
- Owner/doctor: the care plan asks for the **recurrent-loss work-up from the third loss** in Abortions (A), with
  "check needed" at two. ESHRE 2022 advises it after two, and on 3 Oct you chose "2 or more losses" for the type of
  loss. Keep 3, or change to 2?
- Owner/doctor: **molar pregnancy** – beta hCG every 2 weeks to 8 weeks, then at 3, 4, 5 and 6 months, counted from
  the date seen (not from the evacuation). Is that your protocol, or do you test weekly (FOGSI)?
- Owner/doctor: **contraception after a molar pregnancy** – the draft says no intrauterine device until hCG is
  normal (WHO 2015 allows pills, injections and implants); RCOG has advised barrier methods until hCG is normal.
  Which do you follow?
- Owner/doctor: after an **operation for an ectopic** the plan has no hCG tests. After a salpingotomy (tube kept)
  NICE advises them, but the record cannot tell it from a salpingectomy. Should the record ask which one was done?
- Owner/doctor: a fast pulse or low BP raises "possible ruptured ectopic" only for an ectopic or a pregnancy not yet
  located. Do you also want a **shock rule** (pulse over 110 or systolic BP under 90) for a loss in the uterus?
- Owner/doctor: a ticked finding (for example "Bleeding: heavy") raises its red flag for **up to 3 months**, until
  someone changes it. Right, or a shorter time such as 7 days?
- Owner/doctor: the pulse rule says **"over 110"**, like the other built-in rules; WHO counts 110 itself as a sign of
  shock. Keep "over 110", or "110 or more"?
- Owner/doctor: a record only for the **recurrent-loss work-up** is checked by no red-flag rule, so an Hb under 7 is
  not flagged for her. Should a general anaemia rule check her?
- Owner/doctor: no automatic **"a check-up or test is due" message** goes out from a pregnancy-loss plan (it may be
  read on a family phone soon after a loss); staff use Today's list and **Reminder** instead. Send it automatically
  like the other types of care?
- Owner/doctor: **anti-D** (question 3 of the Abortion section, still open) – the plan's anti-D item, like the
  safety strip, asks for it for every Rh-negative woman until it is recorded; NICE gives it only after surgery for a
  miscarriage or an ectopic. Which is your practice?
- Owner/doctor: **missed miscarriage set** – add mifepristone 200 mg by mouth 48 hours before the misoprostol, as
  NICE (2023) advises? It is misoprostol alone now (FIGO 2017), with mifepristone only in the notes.
- Owner/doctor: **misoprostol route** – 800 mcg in the vagina for a missed miscarriage and 600 mcg by mouth for an
  incomplete one. Another route (under the tongue, or vaginal for both)? Keep "a second dose after 3 hours only if
  told" for a missed miscarriage?
- Owner/doctor: **iron for 3 months** after every complete miscarriage and every evacuation, or only when the Hb is
  low? And no antibiotic after an evacuation (as drafted) – right for your hospital?
- Owner/doctor: the **work-up package** – keep HbA1c in it, and anti-beta-2-glycoprotein I (ESHRE: "can be
  considered")? The antibody results are not flagged by the app (cut-offs depend on the kit); do you want a fixed
  cut-off, for example anticardiolipin over 40?
- Owner/doctor: **bile acids** are flagged High from 19 µmol/L for every woman, also when she is not pregnant (many
  labs use about 10). Right? Should a high result suggest the cholestasis information sheet by itself?
- Owner/doctor: a pregnancy-loss set chosen for a patient of another type of care shows a **warning** but is
  allowed. Enough, or hide those sets for antenatal patients?
- Owner/doctor: Clinic library → Care plans now lists the pregnancy-loss template **first**, above the antenatal one
  (the list is in order of the type of care's name). Keep, or put antenatal first?
- Owner/doctor: **look once at the delivery and newborn outcomes** with fake patients ("How to test delivery and
  newborn outcomes" below) – nobody has seen these screens in a running app yet.
- Owner/doctor: check and approve the DRAFT content of **delivery outcomes**: the PPH amounts (500 mL after a vaginal
  birth, 1,000 mL after a caesarean, no suggestion for "Other"), fresh and macerated stillbirth, Apgar under 7 at 5
  minutes as a low score, the WHO newborn and maternal death definitions, and the four "When was it?" choices.
- Owner/doctor: hospital admins see Deliveries and PPH (small numbers masked) and, on the Newborn tab, "Babies
  registered". The difference hints at stillbirths only roughly (babies born elsewhere and twins are in it), and
  the audit-log data already pairs delivery notes with newborn registrations. Keep this, or hide all delivery
  counts from admins?
- Owner/doctor: hospital admins do not see births and stillbirths, Apgar, NICU, breastfeeding or deaths (as built).
  Right, or should they see Apgar, NICU and breastfeeding with small numbers masked?
- Owner/doctor: the admin's audit log shows that a record was closed, by which doctor and when – never which
  patient. An audit entry is required; should it be hidden from admins?
- Owner/doctor: should a NICU or SNCU stay recorded only on the **baby's own record** (for example on day 3) also
  count on the NICU card? Today only the answer on the delivery note counts.
- Owner/doctor: the NICU and feeding-at-discharge fields are in the baby's **Edit details**, not in newborn
  registration (reception registers babies; these are clinical details). Is that right?
- Owner/doctor: PPH is counted out of the deliveries with an answer; breastfeeding within one hour out of **all**
  live births. Right for both?
- Owner/doctor: deaths of babies 28 days or older, and deaths not related to a pregnancy, are only in the monthly
  report, not on the Deliveries tab. Right?
- Owner/doctor: a record closed after a death no longer appears under "Records to tidy up", even when it is still
  marked antenatal. Right?
- Owner/doctor: **look once at the copy of the whole record, and try the export on the demo data** ("How to test
  the copy of the whole record and taking a hospital's data out" below) – nobody has seen them in a running app yet.
- Owner/doctor (before any real use): have an experienced developer **review the export command**
  (`npm run export:hospital`) – it writes every patient of a hospital to one unencrypted folder and has not had its
  own independent review yet.
- Owner/doctor: the copy includes the record's own **Notes** box (which doctors and RMOs see); only a visit's
  private note is left out. Keep the Notes in the copy, or leave them out too?
- Owner/doctor: only her doctor (any doctor while she has none) and RMOs can make the copy. Should another doctor
  who sees her record read-only also be able to? Today they cannot (the safer choice).
- Owner/doctor: is this wording right on a copy handed to a patient: "Low, High and Abnormal only draw attention.
  Perinexa suggests them from a DRAFT list of usual adult values, and the lab may change them; the lab's own report
  and the treating doctor decide."? A baby's copy names the DRAFT newborn values (NNF India, AAP) instead.
- Owner/doctor: for a **sensitive record** the preview says "Hand the copy in person to the patient herself, or give
  it only to a doctor she is referred to" (a baby: the baby's parents). Is that the rule you want?
- Owner/doctor: the export's `visits.json` holds the doctors' **private notes** and what was written in visits
  marked "entered in error" (a move to another system needs them; the printed copy leaves them out). Keep them in
  the export, or leave them out?
- Owner/doctor: the export leaves out the old register scans (removed on 2 Oct 2026), fields no longer used by
  Perinexa, patient portal codes and staff voice-entry words. Is anything of these needed?
- Owner/doctor: the export's audit log keeps the IP address and browser of each entry and names the people, but
  leaves out their e-mail addresses. Is that right?
- Owner/doctor: **look once at the pharmacy extras and billing extras** with fake data ("How to test the pharmacy
  extras and billing extras" below) – nobody has seen them in a running app yet.
- Owner/doctor (before any real use): **check Pharmacy → Medicines** for medicines that were stopped and used again
  before 4 Oct 2026. The notice at the top lists every medicine whose generic name, strength, HSN code, schedule and
  reorder level are all empty; set the schedule of each prescription or narcotic medicine by hand.
- Owner/doctor: should **writing off** narcotic or Schedule X stock also need a witness's name? Today stock counts
  and returns to a supplier need one; write-offs do not.
- Owner/doctor: the guard against words about the baby's sex on **bills** also refuses a number with XX or XY
  standing alone (a policy number "POL/XY/2026/01", a card "XX-4321"); reception has to join the letters. The
  suggestion: keep the word check, but drop the XX/XY check in the pure number boxes (policy, claim,
  pre-authorisation, package code, PM-JAY ID, payment reference). Keep it as it is, or change it?
- Owner/doctor: **Suggest from low stock** brings each low medicine up to twice its reorder level. Is that the rule
  you want for an order?
- Owner/doctor: a return to a supplier can be cancelled, but the **supplier's credit note** is not recorded in
  Perinexa (it stays with the accountant). Should it be?
- Owner/doctor: questions for your **accountant** – (1) is the purchase rate typed on a purchase the price before
  GST? The debit note adds GST on top. (2) When stock that came with free units goes back, the debit note spreads the
  price paid over all units – or should it claim the full invoice rate? (3) A business buyer registered in another
  state who collects at the counter is charged CGST + SGST with the place of supply in the pharmacy's state, on the
  invoice and in the e-invoice file – right, or IGST? (4) Does e-invoicing apply to this pharmacy at all (it
  depends on yearly turnover)? Please have the first downloaded file checked on the portal, including whether its
  bulk upload takes a list of invoices or a single one.
- Owner/doctor: is one **general claim form** enough? Most insurers and TPAs have their own hospital form; tell us
  if a particular layout is needed. On the **PM-JAY claim sheet**, is anything missing that your staff copy into the
  portal (for example the hospital's own PM-JAY hospital ID)?
- Owner/doctor: the **doctor's box** on the claim form has "Diagnosis" and "Procedure or treatment" (two lines
  each), signature, date, name and registration number. Is that what the treating doctor should fill in? A hospital
  admin with no reception role gets the patient's name, number and phone on the form and empty lines for age and
  address – right, or should the admin see age and address too?
- Owner/doctor: the **UPI message** is in English only – do you want Marathi and Hindi too? The UPI link is offered
  only when the bill has a balance – should reception also be able to ask for a deposit by UPI link for a patient in
  hospital when nothing is due yet? Please try the link once with ₹1 from your own phone before staff use it.
- Owner/doctor: her insurance details are offered again from another open bill on the **same record** only, not from
  a record marked as a duplicate of hers. Should they be (a small follow-up)?
- Owner/doctor: **look once at the already-registered warning and duplicate records** with fake patients ("How to
  test the already-registered warning and duplicate records" below) – nobody has seen them in a running app yet.
- Owner/doctor: the **same name alone** raises the warning at registration. With common names reception may see it
  often. Keep it, or warn on the name only when something else also agrees (for example the age within a few
  years)? Should the warning also come when a phone number or name is changed later on Edit details (not built)?
- Owner/doctor: phone numbers typed as a placeholder (0000000000, 9999999999, fewer than 6 digits) are not
  compared. Does your reception use any other placeholder number that should be ignored?
- Owner/doctor: on a duplicate record an **unsigned visit** can no longer be written in (vital signs, details,
  prescription); it can still be signed, corrected below the signature or marked entered in error. Right for your
  practice, or should an open visit on the duplicate stay editable?
- Owner/doctor: a record **cannot be marked** as a duplicate while today's visit on it is still open, or while she
  is in hospital on it (the message suggests marking the other record instead). Are these the rules you want?
- Owner/doctor: **undo** needs a doctor or RMO who may change both records. Should any doctor be allowed to undo?
- Owner/doctor: the lab and the pharmacist see "Duplicate of P-…" and "Earlier record: P-…" (numbers only, never
  the reason). Acceptable, or only reception and clinical staff?
- Owner/doctor: the pharmacy no longer sells on a duplicate; a prescription written on it is sold on the main
  record. Lab orders already made on the duplicate are finished and reviewed there. Is that what you expect?
- Owner/doctor: nothing is copied to the main record – an allergy, a blood group, her agreement to reminders and
  her **ABHA** are moved by hand (one ABHA can be on one record only). Should the app offer to do this at marking?
- Owner/doctor: visits made on a duplicate are **counted under the main record** in Analytics and the monthly
  report, and for new or follow-up consultation pricing. Please confirm.
- Owner/doctor: **red flags are not joined** – a flagged visit or lab result on the duplicate shows only on the
  duplicate, not on Today and not on the main record. Should the main record's red flags also read her earlier
  record's visits and lab results (a small follow-up)?
- Owner/doctor: **look once at the red flags from lab results, after delivery, for babies and in hospital** with
  fake patients ("How to test red flags beyond pregnancy visits" below) – nobody has seen them in a running app yet.
- Owner/doctor: check and approve the **34 new DRAFT red-flag rules** (Clinic library → Clinical rules → Red-flag
  rules; on approved rules press **Add them as a draft** first). Every source named with them (WHO, NICE, ACOG, ATA,
  MoHFW, NNF, FOGSI, NASPGHAN) was written from memory – please check each one before approving.
- Owner/doctor: a baby's **bilirubin** – the draft uses the NICE line for starting phototherapy, for babies born at
  38 weeks or later, at the start of each day of life (5.8, 11.7, 14.6, 17.5, 20.5 mg/dL). Keep it, change the values
  to your own chart, or remove these rules? Should a baby's record get a **weeks at birth** field, so babies born
  early get lower limits (today they are not covered)?
- Owner/doctor: **after delivery** – temperature 100.4 °F or more and pulse over 110 are Urgent; BP 140/90 is Watch
  and 160/110 Urgent. Are these the levels you want? Should a pulse of exactly 110 count (WHO: 110 or more)?
- Owner/doctor: **a baby's temperature** – Watch under 97.7 °F, Urgent under 95.9 °F and over 99.5 °F. Right for
  your nursery? Should 99.5 °F itself count (IMNCI)? **Weight** more than 10 % below birth weight is Urgent at any
  age – only in the first 2 weeks instead?
- Owner/doctor: **lab cut-offs in pregnancy** – OGTT 2-hour 140–199 Watch, 200 or more Urgent; fasting 92–125 Watch,
  126 or more Urgent; random 200 or more Urgent; platelets under 1 lakh Urgent (also after delivery), 1–1.49 lakh
  Watch. TSH above 4 (ATA 2017) or under 0.1 is Watch – the Government of India guideline uses 2.5 in the first
  trimester and 3 later. Which do you use?
- Owner/doctor: a lab result raises a red flag **as soon as the lab reports it**, before a doctor has reviewed it
  (chosen as the safer way; the risk level still waits for the review). Is that what you want?
- Owner/doctor: Today lists a flag from a lab result alone, or of a patient who is not pregnant and not in
  hospital, for **6 weeks** (it stays on the record). Is 6 weeks right – or until a doctor has reviewed the report,
  or Urgent lab flags listed until they clear?
- Owner/doctor: a rule joins values from different places (BP with a lab urine result) only when they were recorded
  within **7 days** of each other, and of a visit Hb and a lab Hb (or urine albumin) only the newer counts. Agree?
- Owner/doctor: without a delivery date on a postnatal record only the last 6 weeks count; gynaecology, infertility
  and pregnancy loss would use the last 3 months. Suitable? Do you want red-flag rules for those three types of
  care (pregnancy loss: 8 DRAFT rules built in October 2026 – see Next), or an **SpO₂ rule** after delivery or for
  a baby (none is built in), and with which values?
- Owner/doctor: after a confirmed delivery note the mother is checked with the rules for care after delivery, but
  her record stays "pregnancy care" until someone changes it on Edit details. Should the app offer that change?
- Owner/doctor: **look once at the screens of the three features of 4 Oct 2026** with fake patients (the three "How
  to test" sections below) – nobody has seen them in a running app yet.
- Owner/doctor: check and approve the new DRAFT content for **findings in this pregnancy** – the nine risk rules,
  the six antenatal items, the two changed postnatal items and the 140/90 suggestion (Clinic library → Care plan
  templates; on an approved template press **Add as a new draft** first).
- Owner/doctor: no haemoglobin or blood pressure recorded yet in this pregnancy – keep the level with the note "Not
  measured yet" (as built), or show "Incomplete" until both are recorded?
- Owner/doctor: anaemia as Moderate risk – lowest Hb under 11 g/dL (as built, very common) or under 10 g/dL? And
  should the rule use the **lowest** Hb of the pregnancy (as built – she stays flagged after treatment unless you
  override) or the latest one?
- Owner/doctor: one BP reading of 140/90 or higher makes her High-risk until a later normal reading (as built). Or
  Moderate for a single reading, and High only once "High blood pressure in this pregnancy" is ticked?
- Owner/doctor: are all five findings High risk for you – also light early bleeding that settled, and a low-lying
  placenta before 32 weeks?
- Owner/doctor: before 20 weeks the visit page still offers "high blood pressure in this pregnancy", with a note that
  it usually counts as chronic. Hide the offer before 20 weeks instead? And should the 140/90 follow the hospital's
  own BP rule when a doctor changes that rule?
- Owner/doctor: twins – are the scans at 24, 28 and 32 weeks plus the advice item enough, or should the number of
  placentas be recorded so the right schedule switches on? Is the GDM growth scan at 28–30 weeks and the placenta
  scan at 32 weeks right?
- Owner/doctor: do you want built-in items for **high blood pressure in this pregnancy** (for example a BP and urine
  protein check, blood tests) or for **bleeding**, and at which weeks? Today these two only raise the risk level.
- Owner/doctor: may **nurses** tick findings, or only doctors and RMOs (as built)? Should blood pressure from the
  in-hospital nursing chart count for the risk level (as built: only OPD visits)? (For red flags it counts since
  October 2026 – see the top of Next.)
- Owner/hospital: have the Marathi and Hindi wording of **"a check-up or test is due"** and **"we missed you"**
  checked by fluent speakers before any real use.
- Owner/doctor: patients who agreed before 4 Oct 2026 agreed to appointment reminders only. As built their agreement
  also covers the two new messages (the settings page says to ask them again). Is that acceptable, or should the app
  hold the new messages back until staff ask again? Do you want a separate hospital switch for the two new messages?
- Owner/doctor: "a check-up or test is due" goes out only from a care plan whose schedule a doctor approved (as
  built). Agree, or also from draft schedules?
- Owner/doctor: sensitive records – the message goes like any other, but the "Check-up or test due" row in Calendar →
  Reminders is shown only to her doctor and RMOs (as built), so only they can send it by hand. Is that right, or
  should sensitive records get no such message at all?
- Owner/doctor: are 14 days between general messages, 6 weeks for an overdue item to keep counting, and 7 quiet days
  after a visit right? Should the two vaccination lists show a baby only for 6 weeks after a dose was missed (as
  built), or longer?
- Owner/doctor: for babies only vaccinations trigger the message. Should the overdue newborn checks and tests
  (hearing screen, heel prick, newborn examination) trigger it too? May nurses tick vaccinations as given (still
  open – `docs/CARE_PLAN_DECISIONS.md` point 18)?
- Owner/doctor: "we missed you" also goes to a patient under Abortion (pregnancy loss) who missed a booked
  appointment – the wording is general. Are you comfortable with that, or should that type of care be left out?
- Owner/doctor: how should a **death** (of a mother or a baby) be recorded so that messages stop? Today staff must
  switch the reminders off on the record and close the care plan. (Built in October 2026 – see Next: More → Record
  a death closes the record, and no message of any kind goes to it.)
- Owner/hospital: before real sending through a provider – DLT registration of the two new SMS wordings, approved
  WhatsApp templates, and a way to handle "STOP" replies (today staff switch the agreement off by hand).
- Owner/doctor: check and approve the **76 new DRAFT medicine safety entries** (Clinic library → Clinical rules →
  Medicine safety; on an approved list press **Add them as a draft** first). Look especially at: nifedipine 120 mg
  a day (BNF 90 mg), metformin 2 g a day (label 3 g), clomifene 100 mg a day, letrozole 7.5 mg a day, ondansetron
  16 mg a dose with no daily limit, ibuprofen 600 mg a dose, the baby limits for the first week of life (gentamicin
  5 mg/kg; ampicillin and cefotaxime 100 mg/kg a day), phenobarbitone 20 mg/kg, and the unconfirmed drotaverine,
  cefixime and aceclofenac limits.
- Owner/doctor: when breastfeeding is "Not recorded", an Avoid entry (codeine, cabergoline, the combined pill) still
  asks for a one-line reason before saving (as built). Keep that, or only warn until it is recorded as Yes?
- Owner/doctor: breastfeeding warnings apply only to patients under postnatal care. Should a gynaecology or other
  patient who is still breastfeeding get them too (the Breastfeeding question would then be on those records)?
- Owner/doctor: for a baby with no weight recorded at the visit, the per-kg check uses the birth weight and says so.
  Acceptable, or stay silent unless today's weight is recorded?
- Owner/doctor: should doctors see "low stock" beside a medicine, or only "In the pharmacy" and "Not in stock"?
- Owner/doctor: no dose limits were written for misoprostol, oxytocin, magnesium sulphate, aspirin and enoxaparin
  (the right maximum depends on the indication). Do you want any of them, and with which limits?
- Owner/doctor: newborn entries – aspirin, codeine and tramadol, tetracyclines, promethazine, cough and cold
  medicines, loperamide, metoclopramide under 1 year, co-trimoxazole under 6 weeks, nitrofurantoin under 3 months and
  vitamin K3 are "Avoid"; ceftriaxone and chloramphenicol are "Caution". Chloramphenicol while breastfeeding is
  "Caution" (the BNF says avoid) so that eye drops do not ask for a reason each time. Is that split right for you?
- Owner/doctor: check the draft lists and hints for **Abortion (pregnancy loss)** (the help texts, management per
  type, week limits, anti-D line and the Gravida / Abortions (A) hint) and send changes to the developer.
- Owner/doctor: check and approve the 38 draft **information forms** (Clinic library → Information forms), and have
  the Marathi and Hindi checked; say which other conditions need a sheet.
- ✅ Calendar questions answered by the owner (1 Oct 2026) and built: a booking stays on its day marked
  **Arrived · time** once her visit is started that day (a visit on another day still replaces it); reception sees
  only the first day of a care-plan visit window ("Visit due from 28 Sep") – the server no longer sends the end.
- Owner/doctor: review the antenatal draft template, its risk rules (see `docs/RISK_RULES_RESEARCH.md`) and the
  care-plan decisions (`docs/CARE_PLAN_DECISIONS.md`), correct them, and approve.
- Owner/hospital: have the consent forms checked (legal review, and the Marathi and Hindi by fluent speakers – see
  `docs/CONSENT_FORMS.md`), correct them in the app, and approve the ones the hospital will use.
- Owner/doctor: add your registration number (My account → Professional details), have the Marathi and Hindi
  prescription words checked (`docs/PRESCRIPTIONS.md`), and print one test page on your own pad if you use one.
- Owner/doctor: check the 12 draft prescription sets (16 since October 2026, with the 4 for pregnancy-loss care –
  see Next; every medicine, dose and instruction – `docs/PRESCRIPTIONS.md`), change them to your hospital's practice, approve the ones to use, and stop using the others.
- Owner/doctor: try voice entry again in Google Chrome with the same 10 sentences, plus your own made-up dictation
  (`docs/VOICE_ENTRY_TEST.md`), and send what the text box shows for anything filled wrongly or missed.
- Owner/doctor: try voice entry on a visit in Google Chrome with a microphone ("How to test voice entry on a visit"
  below) and say what it gets wrong.
- Owner/doctor: try Print or share on a visit ("How to test printing and PDFs" below), and have "Visit summary /
  तपासणीचा सारांश / जाँच का सारांश" checked with the other Marathi and Hindi words (`docs/PRESCRIPTIONS.md`).
- Smart features (see `docs/AI_FEATURES_PLAN.md`): steps 1–3 done. Owner/doctor: review and approve the draft
  **Red-flag rules** (55 draft rules since October 2026, 63 with the 8 for pregnancy-loss care – see Next) and
  **Medicine safety** list; have the reminder wording in Marathi and Hindi checked.
- Owner/doctor: check **Analytics** with the demo data ("How to test Analytics" below), and answer the open
  questions in "Analytics: open questions" (the defaults are in use until then). Decide whether the Care plans &
  visits numbers need to be faster for very large hospitals ("Analytics speed").
- Owner/administrator: to try the AI features, create an OpenAI API key (platform.openai.com → API keys, with a
  small credit limit) and paste it after `OPENAI_API_KEY=` in `server/.env` yourself – never in chat – then
  restart Perinexa. Fake data only.

## How to test the doctor ideas (fake data only)
1. **Ctrl+K** anywhere (or the "Ctrl K" button in the title bar): type "unpaid", "new patient", "book Friday", or a
   patient's name or number, then Enter.
2. A visit → Prescription → **Same as last visit**: the medicines come in, the advice goes to Visit details; Undo puts
   back what was there.
3. My settings → **Typing shortcuts**: add "fu2" = "Follow up after 2 weeks"; in a visit's Advice type ".fu2 " (with
   the space).
4. Type in a visit without saving, wait a few seconds, go to Today: "Continue ___'s visit". Open it: "You have unsaved
   changes … Restore them".
5. Remove a medicine line: it goes at once, with **Undo** at the bottom of the screen.
6. In a visit, Enter moves to the next box; Ctrl+Enter saves; Enter in the last box of the last medicine adds a line.
7. A pregnant patient's Overview → Pregnancy card → **Pregnancy timeline** (and its list of scans and tests).
8. Clinic library → **Pregnancy wheel**: an LMP or an EDD and a date.
9. As a doctor, Today → **Your day so far**.
10. A baby's record → Birth details → **Keepsake card** → type a note → Print.
11. The first time on each changed screen a short "New:" tip shows; "Got it" hides it; Help → **What's new**.

## How to test booking with a chosen doctor, the Aadhaar QR and voice choices (fake data only)

1. Hospital admin → Patient messages: tick online booking. Give two doctors OPD timings (Appointments → OPD timings).
   Sign in to the portal as a sample patient → Appointments: both doctors are listed, hers first; pick one and a day –
   only free times show; book. Reception sees it on that doctor's day as "Patient (online)".
2. New patient → Pregnancy → "Fill from Aadhaar card": tick the agreement, upload a photo of a **sample** Aadhaar QR
   (never a real patient's card on a developer's computer). Name, age, address and ID last 4 fill in; check and save.
3. New patient → Dictate → say or type "Pregnancy, Asha Sample, age 28, phone 98765 43210, GDM on diet, twins" → stop
   (or "Open this form"): the Pregnancy form opens filled in. As a doctor, Save and continue: GDM and Twins are ticked
   on the next page, marked "From voice – check".

## How to test the modules brought from C:\Perinexa (fake data only)

1. **Sonography:** sign in as a doctor → a sample pregnant patient → Lab tab → order a scan (e.g. growth scan) → Scans
   → open it → Mark done → type BPD, HC, AC, FL: the weeks, EDD by scan and weight appear; Write the report from the
   readings → Save the report → "Is the report complete?" → Complete – sign and print: the print window opens.
   Signed in as reception or a nurse, Scans is not in the menu.
2. **Referrals:** as the hospital admin, Hospital admin → Referrals (centres, desk number, working hours). Give a sample
   staff member the "Referral desk" role (super admin → Staff). As the desk: Referrals → New referral → log one →
   book her appointment → Reply. As a doctor: Referrals → write the consultant note → sign → release the PDF.
3. **Tally:** as the hospital admin, Billing → Accounts → Settings (company name, books from) → make a batch → download
   the files (for the accountant to import into TallyPrime).

## How to test patients' own accounts (fake data only)
1. As the hospital admin: Hospital admin → Patient messages → tick "Let patients see their next appointment and care
   plan online" and "Let patients sign up for their own account" → Save.
2. Sign out. On the sign-in page choose **Patient** → **Sign up**: a made-up name, mobile (e.g. 9000000009), age,
   address, what she comes for (Pregnancy care asks the first day of her last period), and if you like an email and
   password → tick the agreement → Sign up. Try to sign in with that email and password: "waiting for …
   to approve it".
3. As reception: Patients → **Online sign-ups** (also on Today) → **Review and approve**: her details are shown;
   **Register as a new patient and approve** (one click – her record is made from what she typed), or approve with a
   record that is already hers, or Reject with a reason.
4. Sign out. Patient → Sign in → **Mobile number + OTP**: her mobile → Send OTP; without an SMS provider the OTP is
   shown on screen ("Practice mode") → Sign in. Or **Email + password**. Her page opens; "Change password" is next to
   the hospital's name.
5. Five wrong passwords lock the account for 30 minutes. Reject, or Withdraw on her record (Reminders and portal):
   she is told to call the hospital.

## How to test risk level and care-plan items from findings in this pregnancy (fake data only)
1. **The rules first.** Log in as Dr. Riley Demo → Clinic library → Care plan templates → the standard antenatal
   template. If a box **New built-in draft content is available** shows (the template was approved or edited
   before), open *What would be added or changed*, then press **Add as a new draft**: the older rules are unchanged
   and the nine new ones are at the end. If there is no box, the new DRAFT rules and items are already there.
2. **Tick a finding.** A fake antenatal patient of yours → **Edit details** → Pregnancy → *Findings in this
   pregnancy* → tick **Twins or more** → Save. On the Overview the Risk level card shows **High-risk** with the
   reason "Twins or more", and the Pregnancy card lists the finding with your name and today's date.
3. **Care plan.** Care plan tab: "Growth scan with Doppler" (high-risk only) now applies. For a patient registered
   before step 1 the tab says "Ticked on her record: Twins or more…" → **Review the update** → **Update plan**: the
   twin scans and the advice item appear. A patient registered after step 1 has them at once.
4. **Untick.** Edit details → untick **Twins or more** → Save: the level goes back, and the finding moves to
   *Earlier entries* on the Overview.
5. **A finding ticked late.** On a fake patient past 31 weeks (her plan updated as in step 3) tick **Gestational
   diabetes (GDM)**. Care plan tab: the GDM growth scan shows **Decide** with "Window 28–30 w ended before the
   finding was ticked" – not Overdue.
6. **Visit page.** **Start today's visit**, enter BP **150/96** and save the vital signs. The risk badge in the page
   header turns High-risk, and a card **Suggested for her record** appears with its source line ("Draft suggestion
   built into the software…"). Press **Add to her record: high blood pressure in this pregnancy**; the Overview
   lists it "(confirmed at a visit)".
7. **Refused when the visit changed.** Repeat step 6 on another fake patient, but before pressing the button open
   the same visit in a second tab and choose More → **Mark as entered in error** there. Now press the button in the
   first tab: it is refused with a plain message and nothing is added.
8. **Haemoglobin at a visit.** In a visit enter Hb **6.5** and save: the Risk level card shows "Severe anaemia:
   lowest Hb in this pregnancy under 7 g/dL" with the value and the date.
9. **Haemoglobin from the lab.** On another fake patient → Lab and scans → **Order tests** → Haemoglobin (Hb). Log in
   as lab staff: **Mark sample taken**, enter 6.4, **Report results**. Her risk level has not changed yet. Log in as
   the doctor → **Mark reviewed** (with a comment): the message says "Her risk level changed with this result".
10. **Not measured yet.** Register a new fake antenatal patient with complete details and no visit: the Risk level
    card shows "Not measured yet in this pregnancy: Haemoglobin (Hb) · Blood pressure" – and not "Incomplete".
11. **Override.** Set an override to Low risk on a fake patient, then save a high BP at a visit. The level stays Low
    with **Review override**; the Overview names the new reason and says "Please review the override".
12. **Rules with no rule for it** (only where step 1 showed the box and you have not pressed the button yet): save a
    visit with Hb 6.5. The Risk level card says "Doctor to assess: Lowest Hb 6.5 g/dL … the hospital's risk rules
    have no rule for it" and does not say "No risk factor found".
13. **Who sees what.** As the nurse: the findings show on the Overview, but there are no tick boxes and no "Add to
    her record" button. As reception: no findings and no risk level.
14. **Audit log.** As the hospital admin → Audit log: "Patient details changed … Findings in this pregnancy" – never
    which finding.
15. **Postnatal template.** Clinic library → Care plan templates → the standard postnatal template: either the BP
    check and the blood sugar review already say "Any high blood pressure" and "Any diabetes", or the box offers
    "2 changed items" with before and after.

## How to test automatic reminders for overdue items and missed appointments, and the vaccination lists (fake data only)
Nothing can be marked "overdue" by hand. For a mother, step 3 moves the booking date back. For a baby, time has to
pass (step 13).
1. **Switch on.** As the hospital admin → Hospital admin → **Patient messages** → tick *Send automatic reminders to
   patients who agreed* → Save. The list under it names the three kinds of message.
2. **Approve the schedule.** As Dr. Riley Demo → Clinic library → **To approve** → approve the standard antenatal
   template (and the newborn one). Without this, "A check-up or test is due" is held back on purpose.
3. **Make something overdue.** A fake antenatal patient of yours with no visit in the last 7 days and nothing booked
   ahead. Her Care plan tab must not say "Draft – not approved for clinical use" (if it does: *Update available* →
   **Review changes** → **Update plan**). Then Care plan tab → **Plan** → **Change booking date** → a day 3 weeks
   ago: the booking tests show **Overdue**.
4. **Her agreement.** More → **Reminders and portal** → "She agrees to reminders by WhatsApp", a language → Save
   reminders. Her record needs a made-up mobile number (10 digits starting with 6–9).
5. **Send.** Calendar → **Reminders** → **Send due reminders now**, between 10:00 and 19:00. The result line counts
   "1 for a check-up or test due". With no message provider the message is under **To send by hand**, labelled
   "Check-up or test due · can be sent until <date>", with the fixed wording and nothing about what is due. After
   19:00 the line says it waits until the morning.
6. **Not twice.** Press **Send due reminders now** again: no second message for her (one in 14 days).
7. **Draft check.** If step 2 was skipped, the result line says "1 patient has something overdue but got no
   message: their care plan is still a draft…".
8. **Number changed.** Correct the mobile number on her record and open Calendar → Reminders again: the waiting row
   shows the new number.
9. **Sensitive record.** Mark her record sensitive (More → **Mark sensitive**). As reception or the nurse, her
   "Check-up or test due" row is not shown; as her doctor or the RMO it is. Remove the marking afterwards.
10. **No longer needed.** Book an appointment for her for next week, then open Calendar → Reminders: her message is
    gone from "To send by hand"; in the day's list it shows **Cancelled** with "No longer needed".
11. **Switched off.** As the hospital admin switch the reminders off: waiting "Check-up or test due" and "Missed
    appointment" rows are cancelled. Switch them on again for the next steps.
12. **"We missed you"** needs a day to pass. Book a fake patient who agreed for today and do not mark her arrived.
    Tomorrow after 10:00 open Calendar → Reminders (or press **Send due reminders now**): "Missed appointment · of
    <date>" is there. If a scan was recorded as done for her on that day instead (Lab and scans → *Record a scan or
    procedure*), no message is made.
13. **A baby with an overdue vaccination.** Register a fake baby born today and open the record once (this starts
    the plan); the birth doses become overdue after 7 days. If the demo data already has a baby whose Care plan tab
    shows a vaccination as Overdue, use that one.
14. **Vaccinations overdue.** As the doctor, the RMO or the nurse → Today → **Vaccinations overdue** → click the
    baby's name: the vaccines by name with "by <date>", "No appointment booked" or "Booked for…", the phone and
    **Open the care plan**.
15. **Babies due – not booked.** As reception → Today: the same baby with only "A check-up or test was due from
    <date>" and the phone – no vaccine name; "Draft schedule" until the newborn template is approved. When the
    doctor admits the baby (Stays → Admit), it leaves reception's list.
16. **The baby's own agreement.** On the baby's record → More → Reminders and portal: the choice reads "The parents
    agree…". With the agreement recorded on the mother only, **Send due reminders now** queues nothing for the baby.
    Record it on the baby: the message is queued to the number on the baby's record. Give the mother and the baby
    the same number: that number gets one message, not two.
17. **A closed plan stays closed.** On a fake baby → Care plan → **Plan** → **Close plan** (Care continues
    elsewhere). Open the record again: it still says "No current care plan", and the baby is on neither list. Open
    the earlier plan and press **Reopen**: it is back.

## How to test the prescription checks: dose, pharmacy stock, breastfeeding and newborn (fake data only)
1. **The list.** As Dr. Riley Demo → Clinic library → Clinical rules → **Medicine safety**: six groups, the last
   three *While breastfeeding*, *Newborn babies* and *Usual maximum doses*. If the list was approved or edited
   earlier, a notice says "76 new built-in draft entries are not in this list" (fewer if some are already there),
   and Clinic library → **To approve** lists "Medicine safety list – 76 new built-in draft entries to add and review".
2. **Not checked is said** (only where step 1 showed the notice, before adding): open a prescription for a fake
   postnatal patient and type Codeine. There is no green "No warnings" line; it says "Not checked: this hospital's
   medicine safety list has no entries for breastfeeding and no dose limits yet." Then press **Add them as a
   draft** on the Medicine safety page and try again: the warning appears.
3. **The editor.** **Edit list** → **Add entry** → Type **Dose limit**: Unit, Maximum for one dose, Maximum for a day
   and the tick "For a baby: per kg of body weight" appear; with the tick, also "Only up to this age". Leave
   without saving.
4. **Dose check.** A fake adult patient (for example gynaecology) → new visit → **Prescription**. Type Paracetamol,
   strength "650 mg", dose "2", how often 1-1-1-1. A **Check dose** line says "Paracetamol: above the usual maximum
   of 1 g a dose and 4 g a day". Saving is not blocked and no reason is asked.
5. **Silent cases.** Change the dose to "1": the warning goes. Change the strength to "650" (no unit): no warning
   either – the note under the box explains why.
6. **Breastfeeding not recorded.** A fake postnatal patient → Edit details → *Delivery and breastfeeding* → leave
   **Breastfeeding** as "Not recorded" → Save. The strip at the top shows "Breastfeeding not recorded – ask". In her
   visit's Prescription type Codeine: "Codeine – if she is breastfeeding" (Avoid, with a reason box).
7. **The link.** Click **Record it in her details (opens in a new tab)**, choose **No**, save, and go back to the
   prescription tab: the warning and the reason box go away by themselves and Codeine is still typed. Set it to
   **Yes** the same way: the warning reads "Codeine – breastfeeding". **Check again** does the same by hand.
8. **Two edit forms.** Open the postnatal patient's Edit details in two tabs. Record Breastfeeding = Yes in one;
   in the other save only a change to the notes: the answer stays Yes.
9. **Baby, by weight and age.** A fake baby in newborn care, 3 days old → new visit → weight **3** kg in the vital
   signs → Save. Prescription: Gentamicin, form Injection, dose "22 mg", once a day → "Gentamicin (baby, first week
   of life): above the usual maximum of 5 mg/kg…", naming the weight used. The same for a baby 10 days old: no
   warning. Type Ceftriaxone: a Caution for a baby in the first 28 days. Type Ampicillin, form Injection, strength
   "500 mg", with the Dose box empty: no dose warning (an injection with no dose written is not checked). The box
   heading shows the baby's age.
10. **Baby with no weight** (none at the visit, no birth weight): "No weight is recorded for this baby, so the doses
    are not checked."
11. **Stock.** As a pharmacist's account → Pharmacy → **Medicines**: add "Dolo 650", generic "Paracetamol",
    strength "650 mg", reorder level 20; **Purchases** → enter 100 tablets of it. Add "Labetalol", strength
    "100 mg", with no purchase.
12. As the doctor, in a prescription: Paracetamol, strength "650 mg", tablet → after a moment **In the pharmacy**
    beside it. Labetalol 100 mg → **Not in stock**. Paracetamol 500 mg → nothing (no certain match). A brand kept in
    two strengths, one in stock and one not, typed without a strength → nothing; with the strength → the right
    answer.
13. **Who sees what.** As the nurse or reception: nothing about stock anywhere. Reception does not see Breastfeeding
    on the patient.
14. **Audit log.** As reception change a postnatal patient who has a recorded answer to Gynaecology. As the hospital
    admin → Audit log: the entry names the fields "Care type, Breastfeeding" – never the answer.

## How to test red flags beyond pregnancy visits (fake data only)
1. **The rules first.** Log in as Dr. Riley Demo → Clinic library → Clinical rules → **Red-flag rules**. If the
   rules were never approved or changed: 55 draft rules under Pregnancy (antenatal), After delivery (postnatal) and
   Newborn. If they were: a blue box **New built-in rules are available** → press **Add them as a draft** – your
   older rules are unchanged, the page says Draft, and each added rule is marked **New built-in draft**. Without
   this, rules approved earlier raise none of the lab, postnatal or newborn flags of the steps below.
2. **Edit rules.** Press **Edit rules**. Every rule has *Applies to (types of care)*; the Check list ends with the
   group **Lab results**; the buttons at the top list one type of care. On the rule "Slow fetal heart rate" also
   tick **After delivery (postnatal)**: a red message says "Fetal heart rate is not checked for postnatal
   patients …". Press **Cancel**.
3. **A lab result.** A fake pregnancy patient → **Lab and scans** → **Order tests** → Haemoglobin (Hb). Log in as
   lab staff: **Mark sample taken**, enter 6.4, **Report results**. As the doctor, without reviewing it, open her
   **Overview**: the Red flags card shows "Severe anaemia – Haemoglobin (lab) 6.4 g/dL · from the lab result of
   <today>" and "Rule: Haemoglobin (lab) under 7 g/dL". The date is a link to the result. The header shows the
   **Red flag** pill and Today → Red flags lists her.
4. **Seen during a visit.** Open a visit of the same patient: under the visit's own flags there is a card **Other
   red flags on the record** with the lab flag.
5. **A changed result.** As the lab → the order → **Change the results** → 11.6, with a reason → **Save the
   change**. The flag is gone everywhere.
6. **After delivery.** Register a fake postnatal patient → **Start today's visit** → BP 150/96, temperature 101,
   pulse 118 → save. The visit page shows three flags: "Fever after delivery" and "Fast pulse after delivery"
   (Urgent), "Raised blood pressure after delivery" (Watch). Today → Red flags lists her; click her name:
   "Postnatal · 2 urgent, 1 to watch".
7. **A baby.** Register a fake newborn, born 2 days ago, birth weight 3000 grams. Start a visit, enter weight 2.6 kg
   and temperature 97.2 → save: "Weight more than 10 % below birth weight – Weight 2.6 kg – 13.3 % below the birth
   weight of 3000 g" (Urgent) and "Low temperature (baby)" (Watch). On the baby's Lab and scans tab order **Serum
   bilirubin, total and direct (baby)**; as the lab enter *Baby's age when sampled* 30 hours and total bilirubin 13
   → **Report results**: the Overview shows "High bilirubin for the baby's age" (Urgent).
8. **In hospital.** A fake pregnancy patient → **Stays** → **Admit**. On the stay page, nursing chart → Vital signs
   → BP 166/112 → **Add to the chart**. A **Red flags** card appears above Documents: "Severe-range blood pressure
   – BP 166/112 mmHg · from the nursing chart, <date, time>". Today → In hospital shows a **Red flag** pill beside
   her name; click the name for the flag.
9. **A newer reading, then entered in error.** Add another chart entry with BP 128/84: the flag goes. Mark that
   entry **Entered in error**: the flag comes back.
10. **A visit saved again.** On another fake pregnancy patient start today's visit with a normal BP, admit her,
    chart BP 170/110, then add an Hb to the same visit and save. The severe blood pressure flag must stay.
11. **Delivery.** For the patient of step 8: **New document → Delivery note** with a time of delivery after the
    chart entries; as her doctor **Confirm and sign**. The flag from the chart entry before the delivery goes.
    Chart temperature 101 now: "Fever after delivery" (Urgent) – although her record still says pregnancy care.
12. **No rule for the type of care.** Admit a fake gynaecology patient. Today → In hospital → click her name, and
    her stay page: "No red-flag rule applies to Gynaecology – the vital signs on the nursing chart are not
    checked." The hint under Today → Red flags names the types of care that are checked and those that are not.
13. **Who sees what.** As reception: no Red flag pill in the Patients list, no Red flags card on a record, no Red
    flags list on Today.
14. **Audit log.** As the hospital admin → Audit log: "In hospital list viewed – … patients in hospital, … with
    red flags" for each time the doctor opened Today – no names. If you pressed **Add them as a draft** in step 1:
    "Red-flag rules changed – … built-in rules added".

## How to test the already-registered warning and duplicate records (fake data only)
Use made-up names and phone numbers only.
1. **Register once.** Log in as reception → Patients → **New patient** → Gynaecology → "Asha Sample", age 28, phone
   "+91 98765 43210" → **Register patient**. She is saved as usual.
2. **Same phone.** New patient → Gynaecology → "Someone Else", phone "098765-43210" → **Register patient**: the
   pop-up **She may already be registered** shows Asha Sample with her number, age, doctor, "Phone ending 3210" and
   **Same phone number**. Press **Back to the form**: nothing was saved. Press **Register patient** again →
   **Open this record**: the button reads "Opening…", her record opens, and no new patient was made.
3. **Same name.** New patient → "asha  sample" with another phone: the pop-up says **Same name**. Press **Register
   as a new patient anyway**: she is saved with a new number. This second record is used in the steps below.
4. **Other ways of writing a number.** Try once more with the phone "+91 098765 43210", or with two numbers in the
   phone field: the warning appears. With the phone "0000000000" and a new name: no warning.
5. **A baby.** New patient → Newborn → "Baby of Asha Sample" with the mother's phone: no warning (a baby is not
   compared with the mother). Register the same baby again: **This baby may already be registered** shows the
   first baby only.
6. **Who may mark.** As reception or a nurse open any record: **More** has no "Mark as a duplicate".
7. **What only this record has.** Log in as the doctor of both records (Dr. Riley Demo, if you chose that doctor
   when registering) or as the RMO. On Asha's second record → Edit details: add an allergy and a blood group. Then
   **More** → **Mark as a duplicate** → search "Asha" → choose the first record: an amber box **Before you mark,
   look at what only this record has** lists the allergy and the blood group. Press **Cancel**.
8. **Today's visit still open.** On the second record press **Start today's visit**, then More → Mark as a
   duplicate → choose the first record: an amber line says today's visit is still open, and marking is refused.
   Add a prescription with one medicine to the visit, then sign it.
9. **An appointment.** Book the second record for tomorrow (Appointments, a doctor with OPD timings).
10. **Mark it.** More → **Mark as a duplicate** → the first record → a reason of a few words → **Mark as a
    duplicate**. The green message says the appointment is now on the main record, "Any open bill stays on this
    record for reception to settle", and repeats the allergy and blood group. The record shows the amber banner
    **Duplicate record** with a link and a grey **Duplicate** pill; the Visits tab has no **New visit**. The first
    record shows **Earlier record: P-…** with "On P-… and not on this record: …", and has the appointment.
11. **The lists.** Patients: the duplicate is gone. **More filters** → **Duplicates** → *Duplicates shown*: it is
    back with the pill "Duplicate of P-…". Type its exact patient number in **Find a patient**: it is found, with
    "Duplicate of P-…" in its line.
12. **Reception.** Log in as reception → the first record: **Earlier record: P-…** is only a link (no medical
    details). Its **Bills** tab: "She also owes ₹… on her earlier record P-…" if the visit of step 8 left an unpaid
    bill (the consultation needs a price in the price list). The duplicate's Bills tab has a note that the bills
    stay there; take the payment as usual. Billing → New bill for the duplicate's number: the finder says "choose
    P-… instead", and choosing it is refused with a plain sentence.
13. **Pharmacy.** As the pharmacist → Pharmacy → Sell → type the duplicate's patient number: the row says
    "Duplicate of P-… – choose P-… instead", and choosing it shows a note that it takes no new sale. Choose the
    main record: the prescription of step 8 is listed with "written on her earlier record P-…" and can be sold.
14. **Reminders.** On the duplicate → More → **Reminders and portal**: a line says no automatic messages are sent
    for this record.
15. **Undo.** As the doctor, on the duplicate → **Undo duplicate marking** → **Undo marking**. The banner goes,
    the record is back in the Patients list, the appointment is back on it, and Overview shows **Duplicate markings
    that were undone (1)** at the bottom.
16. **A baby's record.** Mark the second baby of step 5 as a duplicate of the first: the search offers babies only
    and the banner says "for the baby's care".
17. **Audit log.** As the hospital admin → Audit log: **Registered as new although a record matched**, **Record
    marked as a duplicate** and **Duplicate marking undone** – record numbers and counts only, no name, no reason.

## How to test the pharmacy extras and billing extras (fake data only)
Use made-up medicines, suppliers, numbers and patients only. Steps 1–9 as a pharmacist's account (Sunrise)
unless a step says otherwise.
1. **A barcode.** Pharmacy → Medicines → **Change** a medicine: set a reorder level above its stock, type a made-up
   barcode (e.g. 8901234567890) in **Barcodes on the pack**, press Enter, Save. Type the same barcode on another
   medicine: it is refused, naming the first one.
2. **Stop using.** Press **Stop using** and then **Use again** on a medicine with a schedule: its schedule, generic
   name, HSN code and reorder level stay. If a notice at the top lists medicines to check, open each with **Change**
   and set its schedule.
3. **Scan.** Pharmacy → Stock: click in **Scan or type a barcode**, type the barcode, press Enter: that medicine's
   page opens. One digit off: no medicine has it. On Sell, type two barcodes quickly one after the other: both
   medicines are added.
4. **An order.** Purchases → **Orders** → **New order** → choose a supplier → **Suggest from low stock** (the low
   medicine appears with a quantity) → **Save the draft**. On the order: **Print**, then **Mark as sent**.
5. **Receive it.** On the sent order press **Receive**: the New purchase form opens with the supplier fixed and the
   medicine filled in. Lower the quantity, type an invoice number, batch, expiry month, rate and MRP → Save: the
   order shows **Part received**. **Receive the rest** with the remainder: **Received**. (Or try **Nothing more will
   come** on a part-received order.) Purchases shows "received against order PO-…".
6. **A return.** Purchases → **Returns to supplier** → **Return stock to a supplier** → the supplier and a reason →
   a quantity beside a batch → **Return and make the debit note** → **Print the debit note**: HSN, batch, expiry, rate
   and GST. Stock → the medicine: its moves show "Returned to supplier". Reports → **Purchases by supplier, net of
   returns** shows it.
7. **A narcotic.** Add a narcotic medicine, buy some, return part of it: it asks for a witness. Reports → the
   Narcotic register shows the return with the balance. Open the return → **Cancel this return** → a reason and a
   witness: the stock is back, the return says Cancelled, and Reports no longer count it.
8. **A business buyer.** Give a medicine the HSN code 3004 (Medicines → Change). Sell → Walk-in customer → tick
   **The buyer is a business that gives its GSTIN** → GSTIN 27ABCDE1234F1Z0: the state shows as Maharashtra; change
   one character and it is refused. Fill in name, address, town and PIN, add that medicine: a warning names it (its
   HSN code is too short for the e-invoice file). **Make the invoice**.
9. **The e-invoice file.** As the demo hospital admin → Pharmacy → Invoices → that invoice: the card **Business
   buyer and e-invoice file** says what is missing. Fill in the pharmacy's GSTIN, city and PIN under Pharmacy →
   Settings, change the medicine's HSN code to 300490, come back → **Download the e-invoice file**: a file
   einvoice-PH-….json is saved. As the pharmacist the same invoice says the admin downloads it; an ordinary invoice
   has no such card.
10. **UPI settings.** As the hospital admin → Billing → **Settings**: a made-up UPI ID such as samplehospital@okbank,
    the same again in **Type the UPI ID again**, and a payee name → Save. "samplehospital" without the @ is refused.
    Change it once more: **Changes to the UPI ID** lists both changes with who and when.
11. **Insurance details.** As reception → Billing → a bill with charges and a balance (or start a visit for a fake
    patient so that one appears) → card **Insurance or scheme** → **Add details** → a made-up insurer, policy number,
    TPA and pre-authorisation number → Save. A policy number with no insurer asks for the insurer. On a mother's
    bill, a package name with the word "girl" is refused.
12. **Claim forms.** **Print** → **Print claim form**: letterhead, her name, number, age and address, the dates, the
    doctor, the bill by group with Total, Paid and Due, the insurance details, and the empty box for the treating
    doctor – no test or item names. Add the PM-JAY ID, package code and package name → **Print** → **Print PM-JAY
    claim sheet**: it says it is for copying into the PM-JAY portal by hand. Leave one PM-JAY box empty: the preview
    names it and prints an empty line.
13. **UPI link.** **UPI payment link** beside Take payment → **Make the link** → **Copy the message** and paste it
    into a note: the amount, the link, the bill number and the UPI ID – no patient name. The bill still shows
    nothing paid for it. On the bill of a patient in hospital the notice says **Take a deposit**.
14. **Paid by insurance.** **Take payment** → Insurance / scheme: the insurer is filled in from the bill. Type a claim
    number → record it: it appears in the Insurance card and on the claim form. Billing → **Unpaid** shows the
    insurer in its new column.
15. **The fee when booking.** Appointments → book a fake patient → **Take fee** → Insurance / scheme → payer "girl
    child scheme": refused, with the message under the box.
16. **Who sees what.** As a hospital admin with no other role: **Print claim form** shows an empty "Age or date of
    birth" line and no assigned doctor. Reception does not see **Changes to the UPI ID**.
17. **Audit log.** As the hospital admin → Audit log: **Purchase order made**, **Stock returned to a supplier**,
    **Debit note printed**, **E-invoice file downloaded**, **Insurance details of a bill changed**, **Claim form
    printed**, **UPI payment link made**, **Billing settings changed** – numbers only, never a UPI ID.

## How to test the copy of the whole record and taking a hospital's data out (fake data only)
Use made-up patients only. Steps 1–10 in the app; steps 11–13 in the Mac's Terminal, on the demo data only.
1. **A record worth copying.** Log in as Dr. Riley Demo (or as yourself) → a fake patient of yours, for example
   P-000003, or register a made-up one. Add a visit with vital signs, a diagnosis, a private note and a prescription,
   and sign it. On another visit → **Mark as entered in error**.
2. **Optional extras.** Order a lab test; as the lab user, enter and report a result outside the usual range (for
   example haemoglobin 8) without marking the sample collected first. Admit her with a signed admission note and one
   nursing chart entry, and print a consent form for her.
3. **Open the copy.** Her page → **More** → **Copy of the whole record**: "Collecting everything in the record", then
   the print preview with **Print** and **Download PDF** (no Share button).
4. **The parts.** The title is "Copy of the whole record". Headings, each oldest first: Identity and contact, Medical
   background, Obstetric history, Pregnancy with "Risk level and its reasons", Visits, Care plans, Lab orders and
   results, Scans and procedures done, Stays in hospital, Consent forms and information given, Appointments, Not in
   this copy. An empty part says "None recorded."
5. **What must not be there.** The visit marked entered in error shows only that, with who marked it – not what was
   written. The private note is nowhere. The lab result says "Sample taken: Not recorded – the results were entered
   without it", and above the lab orders a note says Low and High come from a DRAFT list. The consent form shows its
   title and dates only. "Not in this copy" speaks of babies only when she has a baby on record.
6. **Antenatal risk.** On an antenatal patient with something typed under other conditions: the risk part has
   "Doctor to assess" and "What the automatic check does not see".
7. **The footer.** At the bottom of every page: the hospital, "Patient no. P-…" (not her name), "Copy of the record
   – confidential", and "Printed <time> by <your name>".
8. **Print and PDF.** **Download PDF**: a file "Record copy P-… <date>.pdf" is saved. **Print**: the browser's print
   window opens (Cancel it).
9. **A baby, and a sensitive record.** The copy of a fake baby with a flagged lab result names the DRAFT newborn
   values. Mark a fake record sensitive and open its copy: an amber box says to hand it in person to the patient
   herself, or give it only to a doctor she is referred to.
10. **Who cannot, and the audit log.** As reception, a nurse, the lab, the pharmacist, the hospital admin, or a
    doctor who is not her doctor: **More** has no "Copy of the whole record". As the hospital admin → Audit log →
    type **Patient record access**: **Full record copied** (each time the copy was opened), **Copy of the whole
    record printed** and **Copy of the whole record saved as PDF** – the patient number only.
11. **The export.** Open the Mac's Terminal (not the terminal inside Claude), go to the Perinexa folder, and type
    `npm run export:hospital -- --hospital "Sunrise General Hospital (Demo)" --out ~/Desktop/perinexa-export-test`.
    It says how many patients and that the files are not encrypted; type the hospital's name again. It lists what
    it wrote.
12. **Look at it.** Open the folder on the Desktop: `README.txt` (what each file is, the counts and the warning), a
    few `.json` files (`staff.json` has names and roles, no e-mail addresses) and the `files` folder. As the demo
    hospital admin → Audit log → type **Security**: **Hospital data exported by the server operator**, done by
    "Server operator", with counts.
13. **Refusals.** Run the same command again (the folder is no longer empty): refused. With `--out` a folder inside
    the Perinexa folder: refused. With the name in small letters: "Did you mean …". Type something else when asked
    for the name again: "Not confirmed – nothing was written." Delete the test folder afterwards.

## How to test delivery and newborn outcomes (fake data only)
Use made-up patients only. Restart Perinexa with Start Perinexa.command first (the server changed).
1. **Demo numbers.** Run the demo script (removed 12 Oct 2026) once (fake data only – it adds a confirmed delivery note for each of the
   8 fake postnatal mothers, and nothing more if run again). Log in as Dr. Riley Demo → **Analytics** → the new
   **Deliveries** tab (before Newborn). For the last 12 months: 8 deliveries, 11 babies born with 1 stillbirth, and
   1 heavy bleeding (older demo data can give a little less). Each card shows what it is counted out of and a "Not
   recorded" row; the PPH and Apgar cards say DRAFT, with the source.
2. **Lists.** Click **Caesarean section**: one row per delivery. Go back and click **Babies born**: a mother of
   twins is there twice ("baby 1 of 2", "baby 2 of 2").
3. **Delivery note.** A made-up antenatal patient → **Stays** → **Admit** → **New document** → **Delivery note**.
   Mode Normal, blood loss 700: the hint under **Heavy bleeding after delivery (postpartum haemorrhage)** says it
   suggests PPH, and the answer stays "Not recorded" until you choose. Change the mode to Caesarean: the hint says it
   is below 1,000 mL. Add a baby, **Live birth**: you get **Breastfed within one hour of birth** and **Admitted to the
   NICU or SNCU**. Change it to **Stillbirth**: you get **Kind of stillbirth** instead. Save, and as her doctor
   confirm and sign: the note shows the answers in words. Within a minute the Deliveries tab counts it.
4. **A baby's record.** A made-up baby → **Edit details** → **Care after birth**: NICU or SNCU Yes with a date, and
   Feeding at discharge → Save. The Overview has a **Care after birth** card. As reception it is not there.
5. **Record a death.** As her doctor, on a made-up patient with an appointment booked: **More** → **Record a
   death**. Look at the DRAFT hint under **When was it?** (on a baby: the age worked out from the date of birth) and
   the tick box with her name and number. A date in the future is refused. After saving: the message says what was
   cancelled; a grey "Died on …" banner; **Record closed** in the header; no **Start today's visit**; her
   appointment is cancelled, and booking a new one is refused ("This record is closed, so it takes no new
   appointments."). The Patients list and the search still find her, marked Record closed.
6. **Who sees what.** As reception: only "Record closed", never the date, and no **Record a death** under More.
   As another doctor (when she has a doctor): no **Record a death**. As the pharmacist: a counter sale for her says
   the record is closed and takes no new sale.
7. **Undo.** As her doctor → **More** → **Undo recorded death**, with a reason. The record is in use again, the
   appointments to book again are listed, and the Overview shows "Deaths recorded in error and undone".
8. **Audit log.** As the hospital admin → Audit log: **Record closed by a doctor** and **Closed record reopened
   (recorded in error)**, with counts only and no patient number.
9. **Analytics after a death.** Record a death on a made-up pregnant woman: within a minute she leaves Active
   pregnancies and the "not seen recently" and overdue numbers. As the hospital admin → Analytics → Deliveries: two
   cards only, 1–4 read "fewer than 5", and nothing can be clicked.
10. **Monthly report.** As the doctor → Analytics → **Monthly report** for a month with deliveries: stillbirths are
    split into fresh and macerated, there is a **Deaths** part, and the notes say the definitions are a DRAFT. The
    numbers match the Deliveries tab for that month.

## How to test pregnancy-loss care (fake data only)
Use made-up patients only. Restart Perinexa with Start Perinexa.command first (the server changed).
1. **Rules.** Log in as Dr. Riley Demo → Clinic library → Clinical rules → **Red-flag rules**: the 8 pregnancy-loss
   rules are under Abortion (pregnancy loss), marked Draft. If the page offers new built-in rules, press **Add them
   as a draft**. Clinic library → **Care plans**: "Care after pregnancy loss … – DRAFT" is there.
2. **Findings and the plan.** New patient → **Abortion (pregnancy loss)**, "Loss Sample 1" (made up). Type of loss
   **Missed miscarriage**, Date seen today (read the hint under it). Findings: Cervical os Closed, Gestational sac
   seen Yes, Crown–rump length 7.5. Blood group **O-** → Save. Overview → **Pregnancy loss**: each finding with your
   name and today's date. **Care plan** tab: "Pregnancy-loss care plan", Draft; the follow-up visit, haemoglobin,
   contraception and next-pregnancy advice apply, the beta hCG items say why they do not. The anti-D row has no
   **Mark done** and says to record it in Edit details → Pregnancy loss → Anti-D.
3. **Ectopic flags.** Edit details → type of loss **Ectopic pregnancy**, management **Wait and watch (expectant)** →
   Save. The Care plan now has beta hCG on days 2, 4 and 7 and weekly to week 6. Start today's visit, pulse 124 →
   save: the visit page and **Today** show the urgent "Possible ruptured ectopic pregnancy" with what to consider and
   its source. Then Edit details → management **Laparoscopy** with today's date → Save: the flag leaves Today and
   her record (the visit page of that day keeps it), and the hCG items say why they no longer apply.
4. **Signs of rupture.** Register "Loss Sample 2": **Complete miscarriage**, Gestational sac seen **No**, Products
   of conception seen **No** – the hint says this is a pregnancy of unknown location. Start today's visit → card
   **Findings of this pregnancy loss** → **Record findings** → Signs of rupture **Yes** → **Save findings to her
   record**. Today shows the flag "from her record, <date>". Edit details → Gestational sac seen **Not now – an
   earlier scan showed it**: Signs of rupture stays, with a hint, and the flag stays until you clear it.
5. **Another loss.** On Loss Sample 2 → Edit details → move the Date seen 10 weeks back: a warning says it is
   another loss, and the findings start empty. Save: the old findings are under **Earlier entries**; the Care plan
   tab has a new plan, the old one under Earlier plans.
6. **hCG from the lab.** Register "Loss Sample 3": **Molar pregnancy**, Date seen 29 days ago, a made-up mobile
   number. Care plan: the 2-week beta hCG asks for your decision, the 4-week one is due. **Lab** tab → order Beta
   hCG. As a lab user: **Mark sample taken**, type "85,000" – it asks you to write it without the comma or with a
   point; type "1,23,456" – saved as 123456, "Not flagged" → **Report results**. As the doctor, **Mark reviewed**:
   the 4-week test is Done, the 2-week one still waits for you. Change the result as the lab and review it again:
   nothing more is ticked.
7. **Today's list.** As the doctor → Today → **Care plan to act on**: Loss Sample 3, marked "Abortion" →
   **Reminder**: the message does not name the loss.
8. **Work-up.** Register "Loss Sample 4": **Recurrent pregnancy loss (work-up)**. Care plan: only the next-pregnancy
   advice and the recurrent-loss work-up apply; there are no findings to record. Lab tab → **Order tests** → tick
   the package **Recurrent pregnancy loss work-up** (six tests) → Order. As the lab user: the order shows the tests
   but not the package name. Order a CBC and **Serum bile acids (total)** for another made-up patient: as the lab,
   platelets "1,40,000" is refused with the unit, and bile acids 24 shows High.
9. **Sets.** Clinic library → **Prescription sets**: four new Draft sets and the note under the table. On Loss
   Sample 1's visit → Prescription → **Add a ready-made set**: the four come first, with the note about methotrexate;
   the missed-miscarriage set adds misoprostol, ibuprofen and paracetamol with no medicine warning. On a made-up
   antenatal patient's visit, choosing that set shows a warning in the preview – cancel without saving.
10. **Who sees what.** As reception: Loss Sample 1 shows only "Abortion", no findings. As a nurse: the findings show
    but cannot be changed. As the hospital admin → Audit log: "Findings of the pregnancy loss", never the value.
11. **Copy of the record.** Loss Sample 2 → **More** → **Copy of the whole record**: the Pregnancy loss part lists
    the findings and the earlier entries.

## How to test Marathi and Hindi for what the patient reads (fake data only)
Use made-up patients only. Restart Perinexa with Start Perinexa.command first (the server changed).
1. **Her language.** Log in as Dr. Riley Demo → a fake patient with a made-up mobile number (for example P-000003) →
   **More** → **Reminders and portal** → "She agrees to reminders by SMS", Language **Marathi** → **Save reminders**.
2. **Care-plan sheet.** **Care plan** tab → **Print** → **Patient copy** → **Preview**: **Language for the patient**
   shows मराठी chosen, with two hints. Check the Marathi under the English: the title, the labels, the built-in
   items, the note at the end, and the Draft band while the template is a draft. Press हिंदी, then English: the
   sheet changes. **Change what is printed** → **Preview** again: the language is kept. Cancel the print window.
3. **An item of your own.** Care plan tab → **Add item**, patient wording "Urine test" → save. Print the patient copy
   in Marathi again: your item is in English only, and the hint says how many items print in English only.
4. **Staff copy.** **Print** → **Staff copy** → **Preview**: no language choice, English only.
5. **Discharge card.** **Stays** → admit her → a discharge card with a medicine (for example Tab Iron 1-0-1 after
   food for 30 days) and some advice → **Print**: it opens in Marathi. The labels and, under each medicine, the dose,
   timing and duration are in Marathi; the diagnosis and advice are as typed. A round note's **Print** has no
   language choice.
6. **Audit log.** As the hospital admin → Audit log: "Care plan printed – … patient copy, in English and Marathi"
   and "Document printed – …, in English and Marathi".
7. **Code paper.** As the admin → Hospital admin → **Patient messages**: tick the portal (read the new hint about
   languages) → Save. As the doctor → More → Reminders and portal → **Make her code** → **Print it for her**:
   Marathi under the English, with the same choice. Note the code.
8. **Portal.** Open `/portal` in a private window: it is in English (nothing chosen on this phone yet). Sign in with
   the code and the last 4 digits of the made-up mobile: her page is now in Marathi, with a note at the top that the
   wording is still being checked; built-in items are in Marathi, "Urine test" in English. Press **बाहेर पडा** (sign
   out): the notice and the sign-in page stay in Marathi. Press हिंदी, then English, and reload the page: the last
   choice is remembered.
9. **No agreement, no language.** On the patient → Reminders and portal → "No automatic reminders" → Save reminders.
   A new print preview now opens in English.
10. **The note at the end.** Print the patient copy of a fake postnatal or newborn patient in English: the last line
    counts from the day of delivery or birth and ends with the danger signs of the plan's advice item. A
    gynaecology copy ends with "In an emergency, go to the hospital straight away." A pregnancy copy is as before.

## How to test the care-plan default protocol, updating all plans and editing an added item (fake data only)
Use made-up patients only. Restart Perinexa with Start Perinexa.command first (the server changed).
1. **The counts.** Log in as Dr. Riley Demo → Clinic library → **Care plans**: the new **Current plans** column shows
   how many patients' plans use each template. Open the standard antenatal template: the card **Patients' plans**
   says "Used by N current plans".
2. **Your default.** On that template press **Copy as my protocol**, then **Approve** the copy. In the card **My
   default protocol** press **Make it my default**: the message says new antenatal plans of your patients now start
   from it. Back on the list it shows **My default**.
3. **New plans start from it.** Register two made-up antenatal patients assigned to you, with their pregnancy
   dates ("Default Sample 1" and "Default Sample 2"). On each, **Care plan** tab → **Plan history**: the first line
   says "Plan built from “<your protocol>” … – the default protocol of Dr. Riley Demo". On Default Sample 1 mark one
   item done. A patient assigned to another doctor, or to nobody, still starts from the hospital standard.
4. **A default that is a draft.** Open your protocol → **Edit**: a warning says saving makes it a draft. Rename one
   item and add a lab test at booking (for example "Vitamin D level") → save. The list shows **Default – not in
   use** and a warning at the top. Register a third made-up patient: her plan comes from the standard template.
   Approve your protocol again: **My default** is back.
5. **Update all plans.** On your protocol's page, **Patients' plans** says 2 of them use an older version. Press
   **Update plans to version N**, read the counts, then **Update 2 plans**: the message says what was done.
   Default Sample 1 → Care plan: the new version, the renamed item, and the item you marked done is still done.
   Plan history: "Updated to … – with every plan of this protocol." If the new lab test may repeat one she already
   has, it shows **May repeat “…”** under Needs decision (and on **Today** → **Care plan to act on**): press **Keep
   as planned**, or mark one of the two **Not needed**, and the mark goes.
6. **Edit item.** Default Sample 2 → Care plan → **Add item** (for example a test "Thyroid revew", weeks 24–26) →
   save. That row → **More** → **Edit item**: correct the name, change the weeks, add a note → **Save changes**.
   Check the row, **Details** → History ("Edited", with what it was) and Plan history ("Item “Thyroid review” (was
   “Thyroid revew”) changed: …"). Mark it done: **Edit item** is no longer offered. A protocol item never offers it.
7. **Stop the default.** Your protocol → **Stop using as my default**: new plans start from the standard again;
   the plans already built do not change.
8. **Who sees what.** As a nurse → Clinic library → Care plans: the counts, but no update or default buttons. As
   the hospital admin → Audit log: "Protocol made a doctor's default", "Protocol no longer a doctor's default" and
   "Care plan changed – Record P-…: added item edited", with no item names.

## How to test ABDM sharing and records from other hospitals (practice mode, fake data only)
Use made-up patients only, for example your own fake test patient P-000003. Restart Perinexa with Start
Perinexa.command first (the server changed). Leave ABDM in practice mode: every ABHA screen says "Practice mode – not
connected to ABDM".
1. **Link her ABHA.** Log in as Dr. Riley Demo → a fake patient of yours → **ABHA** tab → *Verify her ABHA* → ABHA
   number **91-1111-2222-3333** → *Send the OTP to her mobile* → **123456** → compare → tick → *Link to her record*
   (if that ABHA is already on another fake record, use 91-4444-5555-6666).
2. **Give her some records.** A visit with notes, a private note and a prescription, which you sign; a lab order
   (for example CBC) that the lab reports and you review with a review comment; a second visit you leave unsigned;
   an HIV test ordered on its own, reported and reviewed. If you like, a stay whose discharge card you confirm.
3. **Her records in ABHA.** Back on the ABHA tab: the signed visit and the reviewed CBC say **Can be linked**; the
   unsigned visit **Not yet** – "The visit is not signed yet."; the HIV-only order **Never shared** – "HIV test –
   confidential, never shared." The list of what is never shared is underneath.
4. **Link.** Tick the signed visit (leave the CBC for step 5), tick **She agrees…** → **Link to ABHA**: it shows
   **Linked** with your name and the date.
5. **From her ABHA app.** Under **Try it in practice mode** → **As her ABHA app: find and link her records**: it lists
   the CBC. Type 123456 → **Confirm in her app**: the CBC shows "Linked from her ABHA app".
6. **A consent.** **As another hospital: she gives a consent** → keep the defaults → **Give the consent**. Under
   **Consents and what was sent**: "Sample Clinic (practice)", **Consent given**, and **Sent** with the number of
   records and documents. **See what was received** → open each document: your private note, the review comment
   and the HIV test are not in them.
7. **Withdrawn and expired.** **She withdraws the consent (practice)**, then **The other hospital asks again
   (practice)**: **Nothing sent** – "The consent was withdrawn." Give another consent with "Consent valid for
   (days)" set to -1: **Nothing sent** – "The consent had expired."
8. **Sensitive.** More → **Mark sensitive**. The ABHA tab says nothing from her record is linked or shared; the linked
   records show **Linked – not shared now** – "Her record is marked sensitive."; **Link to ABHA** and the practice
   buttons are gone. More → **Remove sensitive marking** afterwards.
9. **Ask other hospitals.** Same tab → **Her records from other hospitals** → **Ask for her records from other
   hospitals** → keep every kind, the last 12 months and 30 days → **Send the request to her ABHA app**. Under
   Requests: **Waiting for her answer**.
10. **She approves.** **Practice: she approves**: **She agreed**; Sample City Hospital (practice) "3 documents
    received" (1 file to download, 1 file not offered, 1 sentence withheld) and Sample Town Lab (practice) "2
    documents received". **Records received** lists 5 documents, each marked **Practice – made up**.
11. **Read.** **Read** on the consultation from Sample City Hospital: the notes that it is made up, read-only (with
    the day it will be deleted) and that 1 sentence was withheld; the name in the document is "Practice patient (made
    up)", never hers. At the bottom: **Download Practice ultrasound report (made up).pdf** (it saves as
    record-from-another-hospital.pdf) and "Practice web page: not a PDF, JPEG or PNG file – not offered, for
    safety". Also read the lab report (Haemoglobin 10.1 g/dL, Low) and the vaccination record.
12. **Withdraw, refuse, end.** **Practice: she withdraws her consent**: the 5 documents disappear, the request shows
    **She withdrew her consent**, each hospital **Deleted** with today's date. Ask again → **Practice: she
    refuses**: **She refused**, nothing comes. Ask again → approve → **Practice: her consent ends now**: everything
    is deleted again.
13. **Fewer kinds.** Ask once more with only **Lab or scan report** ticked: only the lab's report comes.
14. **Who sees what.** As another fake doctor, the same patient: both cards, but no Link, Ask, Fetch again or
    practice buttons. As the demo receptionist: the ABHA tab shows her ABHA but neither card. Nurses, the lab and
    the pharmacist have no ABHA tab.
15. **Hospital admin.** As the demo hospital admin → **Hospital admin → ABDM**: **Sharing her records through ABHA**
    ("Not set yet" for the bridge URL, the addresses ABDM calls, the draft HIV word list), **Her records from other
    hospitals**, and the two new checklists. **Audit log**: "Records linked to her ABHA", "Records sent through
    ABDM", "Her records asked for from other hospitals" and the others, with record numbers and counts only.

## How to test the four items of 4 Oct 2026 (fake data only)
1. **Scans and procedures.** Log in as the hospital admin → Billing → Price list: give "Ultrasound – obstetric" a
   price. Log in as Dr. Riley Demo → a fake patient → **Lab and scans** → *Record a scan or procedure* → choose it →
   *Record as done*. Log in as reception → Billing: her bill of today has the scan, "added by itself". As the doctor,
   **Cancel** it with a reason: reception sees it under "Taken off".
2. **By doctor.** As Dr. Riley Demo → Analytics → **By doctor**: one row per doctor and "Whole hospital" last. Change
   the period. Compare your own row with Overview → *My patients only*.
3. **Length of a visit.** As Dr. Riley Demo → Appointments → OPD timings → *Length of a visit*: set New to 30 minutes
   → Save timings. On the Day tab, book a patient at a free time with visit type **New**: the next two times say
   "Taken – … is still going on".
4. **Fee when booking.** As the admin set the price of "Consultation – follow-up". As reception → Appointments → book
   a registered patient (Follow-up) → **Take fee** → Cash → *Fee received*: the booking shows **Fee paid**; click it
   to open her bill and print the receipt. Cancel the appointment: Billing → Unpaid shows the money as due back.
5. **Waiting-room screen.** As the admin → Hospital admin → Patient messages → tick *Show who goes in next…* → Save →
   open the address shown in another window. On Today (reception) give a walk-in token or mark a booked patient
   arrived: within 20 seconds the screen shows "Token 1" or her appointment time under the doctor – no name.
6. **Online booking.** On Patient messages tick the portal and *Let patients book their own appointment* → Save. For
   a fake patient with a doctor and a made-up mobile: More → Reminders and portal → make a code. Open `/portal` in a
   private window, sign in, choose a day and a time → Book. Reception sees it on the doctor's day, "booked online by
   the patient". In the portal, *Cancel this appointment*.
7. **WhatsApp in one click (practice).** Put `WHATSAPP_MODE=practice` in `server/.env` and restart Perinexa. As the
   admin tick *Prescriptions on WhatsApp* → Save. For a fake patient with a made-up mobile: More → Reminders and
   portal → she agrees, **WhatsApp**. Open a visit with a prescription → Print or share → Share → **Send on WhatsApp
   now** → *Send now*: it says "Practice mode: nothing was sent". The hospital's audit log shows "Prescription sent
   to the patient on WhatsApp – practice mode".

## How to test appointment booking (fake data only)
1. Log in as the demo doctor → **Appointments → OPD timings** → *Add a session* on Monday (10–1), again (5–8),
   **Copy Monday to Tuesday–Saturday**, then **Save timings**.
2. **Day** tab → choose a day → **Book** on a free time → find *Asha Sample* → Book. Press **Add** on the same time
   and book a **New patient** (made-up name and phone): it asks **Book anyway**.
3. Press **Move** (choose another time) and **Cancel** (choose a reason) – the patient's record → **Appointments**
   tab shows both.
4. Open a fake patient → *Start today's visit* → Next visit **In 2 weeks** → Save visit: under the field it says
   which time was booked. Set the date to a Sunday and save: it goes to **Needs a time**.
5. As the demo receptionist on **Today**: **Walk-in token** → find a patient → *Give a token* → *Print the token
   slip*. Mark a booked patient arrived: **Waiting to be seen** shows the calling order with **Next**.
6. Book a new patient for today, then on Today → **New patients booked today** → **Register**: her name and phone
   are filled in; after saving, the appointment is on her record.

## How to test the patient card (fake data only)
1. Log in as the demo receptionist, open a fake patient (e.g. Asha Sample) → **More → Print patient card**.
2. The preview shows her name, number, doctor and booked appointments. Press **Print** (A5 paper).

## How to test the pharmacy (fake data only)
1. Log in as a pharmacist's account (Sunrise) → **Pharmacy → Settings**: fill in made-up GSTIN and licence
   numbers → Save. **Medicines** → *Add a medicine* (e.g. a folic acid tablet, GST 12 %, reorder level 30).
   **Suppliers** → *Add a supplier*. **Purchases** → *Enter a purchase*: two batches with different expiry months.
2. **Sell** → find *Meera Testcase (Demo)* → *Use this prescription* → set the quantity → *Make the invoice*: the
   earliest-expiring batch is used first; **Print → Tax invoice**; *open the bill* shows it on her hospital bill.
3. Sell to a **walk-in customer** (pays at the counter). Add a Schedule H medicine: it asks for the doctor's name
   and "prescription seen". Add a narcotic medicine: refused for a walk-in and without a registration number.
4. On an invoice: **Take back** a few unopened tablets → a credit note; the stock goes back.
5. **Stock** → a medicine → *Count* or *Write off* a batch. **Reports**: alerts, the H1/narcotic registers (Print),
   sales and GST. As the hospital admin: Reports → *Export*.
6. Admit a fake patient → **Issue to ward** → choose her → the invoice goes on her stay's bill.

## How to test ABDM linking (practice mode, fake data only)
1. As the demo receptionist (Sunrise), open a fake patient → **ABHA** → *Create her ABHA* → tick her agreement →
   a made-up Aadhaar number (any 12 digits starting 2–9, e.g. 2341 2341 2346) → *Send the OTP* → OTP **123456** and
   a made-up mobile → pick an ABHA address → *Link to her record* → *Print her ABHA card* (a practice card).
2. Another fake patient → **ABHA** → *Verify her ABHA* → ABHA number **91-4444-5555-6666** (a practice ABHA) → OTP
   123456 → compare → tick → *Link*. The header shows "ABHA 91-XXXX-XXXX-6666".
3. **Today → Scan & Share (ABHA)** → *Try a practice scan* → token 1 → *Register* (name, age and phone filled in) →
   save: her ABHA is linked.
4. As the demo hospital admin: **Hospital admin → ABDM** – the settings and the list for the sandbox.

## How to test billing (fake data only)
1. Log in as the demo hospital admin → **Billing → Price list** → enter prices (e.g. Consultation – new ₹500,
   Complete blood count ₹250, Bed charge general ward ₹1,000) → Save each.
2. As the demo doctor, start a visit for a fake patient and order a lab test. As the demo receptionist →
   **Billing**: today's bill is there with the consultation and the test, added by themselves.
3. Open the bill → **Add an item** (e.g. Ultrasound – obstetric) → **Give a discount** (10 %, reason) → **Take
   payment** part by UPI, the rest in cash → **Print** the bill and a receipt.
4. **Take off** an item that was paid for → **Give money back**. Try **Cancel this bill** on a new unpaid bill.
5. Admit a fake patient (ward "Private") → her stay's bill shows the bed day; take a deposit.
6. **Daily summary**, **Unpaid**, and as the admin **Monthly** → *Export* bill items or payments (opens in Excel).

## How to test scanned consents (fake data only)
1. Consent forms tab → a printed form → **Record signed copy** → then **Attach the scan** with any fake PDF or
   photo → the "Scan" link opens it.

## How to test reminders and the portal (fake data only)
1. Hospital admin → **Patient messages** → tick both → Save.
2. As the demo doctor: a made-up patient with a made-up mobile number → **More → Reminders and portal** →
   "She agrees to reminders by WhatsApp", Marathi → Save reminders.
3. Start a visit for her and set the next visit to **tomorrow** (Visit details → Next visit) → save.
4. **Calendar → Reminders** → **Send due reminders now**. With no provider set up it appears under "To send by
   hand": copy it, **Open WhatsApp chat** (to your own test number only), then **Mark as sent**.
5. Back on her page → More → Reminders and portal → **Make her code** → **Print it for her**.
6. In a private browser window open `http://localhost:5173/portal`, type the code and the last 4 digits of her
   (made-up) mobile number → you see her next appointment and care plan, nothing else. Try wrong digits five
   times: the code locks. Back in the staff window: **Withdraw access** – the portal signs her out.

## How to test the monthly report (fake data only)
1. Log in as the demo doctor and open **Analytics → Monthly report** (the tab just before Ask your records).
2. Pick a month with the Month box: the numbers change. This month shows the made-up delivery and lab tests from
   the steps above. The last section is "Scans and lab".
3. Open a fake antenatal patient → **Care plan** → mark a scan (e.g. the dating scan) done today, not "done
   elsewhere". Back in the Monthly report, "Pregnancy scans done here" has gone up by 1.
4. **Print the report**: the preview shows the same rows and the scans note. Below the report: the 12-month charts
   (each has "Show as table").
5. Log in as a hospital admin: Analytics has no Monthly report tab, and opening `/analytics/report` shows "The
   monthly report is for doctors."
6. Log in as an RMO: Analytics shows only Ask your records. An old bookmark to `/registers` opens the monthly
   report for a doctor.
7. Hospital admin → **Audit log**: "Monthly report opened · Monthly report · October 2026".

## How to test the lab module (fake data only)
1. Log in as the demo doctor → a made-up pregnant patient → **Lab** tab → **Order tests** → tick CBC and HIV,
   type "Serum vitamin D" under Another test → **Add** → tick Urgent → **Order 3 tests**.
2. Log in as a lab staff member (Hospital admin → Staff → add a made-up person with the Lab role) → **Lab** →
   the order is first under Samples to take, marked Urgent → open it → **Mark sample taken** → type Hb 9.2 (it
   shows Low by itself), WBC 8000, platelets 2.1, HIV Non-reactive, a result for vitamin D → **Report results**.
   Try **Attach the report** with any fake PDF.
3. Back as the doctor → **Today** shows it under **Lab results to review**, marked Outside range → open it →
   **Mark reviewed** without a comment (it asks what was done) → write "Iron started" → Mark reviewed. The care
   plan's booking CBC and HIV are now Done, "from the lab result".
4. As the lab → open the order → **Change the results** → change Hb → it asks why → the doctor sees it again to
   review, with the earlier values under "Changes after the report".

## How to test the Abortion type of care (fake data only)
1. Log in as a doctor → **New patient → Abortion (pregnancy loss)** (between Gynaecology and Newborn).
2. Fill step 1 with made-up details (e.g. "Loss Sample", age 29) → **Save and continue**.
3. Step 2, Pregnancy loss: type of loss **Missed miscarriage**, LMP **2 Aug 2026** – the weeks at presentation show
   as "x w y d". Management **Medical management** with today's date. Under Medical background choose blood group
   **O-** – the anti-D line in Pregnancy loss now says "Rh negative – Blood group is Rh negative – anti-D given?".
   Answer the allergy question → **Save**.
4. The record: Overview shows the **Pregnancy loss** card; the safety strip shows "Rh negative – anti-D"; the
   **Care plan** tab (or card) says there is no care plan for abortion care in this version, with no Start button.
   (Since October 2026 it shows her DRAFT pregnancy-loss care plan instead – see "How to test pregnancy-loss care".)
5. **Patients** → the **Abortion** filter lists her, as "Abortion · missed".
6. Open a made-up **antenatal** patient → Edit details → type of care **Abortion (pregnancy loss)**: the warning
   about her antenatal plan shows, and her LMP is copied in. Choose a type of loss → Save. Her Care plan tab shows
   the antenatal plan paused.
7. **Stays → Admit** her → New document: there is no delivery note (operation note is there).
8. Register another made-up Abortion patient; on step 2 press **Dictate** and say (or type into the text box)
   "LMP 2 August 2026, missed miscarriage, it is a boy": "it is a boy" is taken out and flagged; the LMP and the
   type of loss are filled. Say "anti D given" too: the Anti-D box shows **Given** (not a note), and after saving
   the "Rh negative – anti-D" reminder is gone.
9. **Analytics → Overview**: Abortion in New registrations, Visits and Other care. **Analytics → Monthly report**:
   the **Pregnancy loss** section counts her.
10. Log in as reception: the patient list and her page show only the word "Abortion", no details.

## How to test care plans for other types of care (fake data only)
1. Log in as the demo doctor. Patients → **New patient** → type of care **Newborn**, a made-up baby born about
   7 weeks ago → open **Care plan**: it says "Newborn care and vaccination plan", "Born …", "Today 7 w … after
   birth", and the 6-week vaccines are **Due now**. The birth doses ask for a decision (the baby came late).
2. Register a made-up **Gynaecology** patient → Care plan → **Start a care plan**. The first visit and tests are
   due today; the annual review is a year later.
3. Register a made-up **Postnatal** patient → Care plan says no delivery is recorded → **Add the delivery date**
   → choose a date last week and **Caesarean section** → Save. The care plan now counts from that day and shows
   the wound check.
4. A pregnancy whose delivery note a doctor confirms (Stays tab), then changed to Postnatal: the postnatal plan
   counts from the delivery, and the antenatal plan is under **Earlier care plans**.
5. Clinic library → Care plan templates: four new **Draft** templates to check and approve.

## How to test the safety strip and allergies (fake data only)
1. Log in as a doctor and open a patient. Under the name you see: the allergy (red, "Allergy: …"), "No known
   allergies" (green) or "Allergies not recorded – ask" (amber); the blood group (amber when Rh negative); the EDD.
2. Open the Visits tab and a visit, then its Prescription tab: the same strip stays at the top.
3. Edit details → Medical background: Allergies is first. Empty it and press Save: it asks you to write the
   allergies or tick "None known". Tick "None known" and save: the strip shows "No known allergies".
4. Log in as reception: the strip is not shown (no medical details for that role).

## How to test signing a visit (fake data only)
1. Log in as a doctor, open one of your patients → Visits → a visit (or New visit). Type a diagnosis.
2. Press **Save, sign and finish** (top right) → the dialog says what signing means → **Sign and finish**. The
   visit shows "Signed" and "Signed by … · time"; every field is now read-only.
3. Under the header, **Corrections and additions**: write "Weight re-checked: 58.5 kg" → **Add**. It appears
   with your name and the time, with no way to change it.
4. At the bottom, open **History of this visit**: started, saved, signed, correction added – with names and times.
5. Back on the Visits tab: the visit shows "Signed"; other visits show "Not signed".
6. Log in as a nurse: no Sign button; the nurse can add a correction to a signed visit.

## How to test the Today page (fake data only)
1. Log in as a doctor: the left menu starts with **Today** (no Worklist item). The page shows Red flags,
   Today's patients, Care plan to act on, and the high-risk count. Switch My patients / All patients at the top.
2. Open a patient → Visits → a past visit, set **Next visit** to today and save. Back on Today: she is listed
   as "Expected – Booked for today". Start a new visit for her: she shows "Arrived · time" with the visit's
   progress; the Calendar's day view shows the booking as "Arrived · time".
3. Log in as reception: Today's patients (no medical details), then **Visits due now – not booked** and
   **Overdue – not booked**, with phone numbers and "Visit due from …" (the first day only).
4. Log in as a nurse: Red flags, Today's patients (visits started today), Care plan to act on.
5. Patients → **Ask your records** (doctors, RMOs, nurses): the AI question page, moved from the Worklist.

## How to test the patient search box (fake data only)
1. Log in as a doctor, nurse or reception. At the top of every screen: "Find a patient". Press "/" – the cursor
   jumps there.
2. Type "sa": matching sample patients appear. Use ↓ ↑ and Enter (or click) to open one.
3. Type a patient number (e.g. "P-000003") or part of a phone number: the patient appears.
4. Log in as a hospital admin only, or the super admin: no search box (no patient records for those roles).

## How to test the simpler screens (fake data only)
1. Top right: **Help**. Press it – explanations appear under fields and on pages; press again – they go. The
   choice is kept for your account (also My account → Appearance → Explanations).
2. Open a patient: one main button, **Start today's visit** (or **Open today's visit**), and **More** with Edit
   details, Change doctor, Mark sensitive, Write a letter, Emergency note.
3. In a visit: **AI tools** (summary, translate, read a report), **More → Mark as entered in error**, and voice
   entry behind **Dictate**. Press **Print or share** → **Share** holds Download PDF / WhatsApp / Share PDF.
4. Visits tab when today's visit exists: **New visit** asks before starting a second one.

## How to test inpatients (fake data only)
1. As an RMO, open a patient → **Stays** → **Admit** (reason "In labour", ward, bed). The header shows In hospital.
2. **New document → Admission note**: write, **Save draft**, then **Sign**. It is locked; add a correction below.
3. **New document → Delivery note**: fill in the time, mode, the baby, then **Save draft**. As the RMO there is no
   Confirm button. Log in as the patient's doctor: **Today → Waiting for your confirmation** shows it; open it and
   **Confirm and sign**.
4. On the stay page add to the **nursing chart** (vital signs, medicine given) as a nurse; mark one entered in error.
5. **New document → Discharge card**: it starts with the diagnosis and procedures; add medicines, then as the doctor
   **Confirm and sign** – the stay shows Discharged. **Print** shows the card on the letterhead with your signature.

## How to test the Calendar (fake data only)
1. Log in as Dr. Riley Demo and choose **Calendar** in the left menu. The week opens with your own patients.
   **All patients** shows the whole hospital.
2. Switch between **Day**, **Week** and **Month**, and use ‹ Today › to move. In Month, click a day to see its list.
3. Untick types (Booked visit, Plan visit, EDD, LMP) to hide them. **Care plan** on a row opens that patient's plan.
4. Go to a month with due dates (e.g. February 2027): the EDDs of the demo pregnancies appear.
5. Log in as the demo RMO: all patients. As reception: only "Booked visits" and "Visits due", with name, patient
   number, phone and doctor – no LMP, EDD or visit names. As the nurse or the admin-only account: no Calendar.

## How to test the smart features (fake data only)
1. Log in as Dr. Riley Demo → **Worklist** (left menu). Three sections: Red flags, Care plan to act on, Visits
   today. "My patients / All patients" at the top right.
2. Open a pregnant demo patient → **Visits** → today's visit. Enter BP **165/100** and Hb **8.5**, save. A red
   "Red flags" card appears (Severe-range blood pressure – Urgent; Moderate anaemia – Watch). The patient header
   shows "Red flags 2", the Overview shows the card, and the Worklist lists her.
3. **Care plans → Red-flag rules**: the 21 draft rules. Edit one (e.g. change a value), save – it becomes a new
   draft version; Approve (tick the box) – the flags now say "Rules approved by …". (Since October 2026: 55 draft
   rules, under Clinic library → Clinical rules → Red-flag rules; for lab results, care after delivery, babies and
   patients in hospital see "How to test red flags beyond pregnancy visits" above.)
4. On the visit's **Prescription** tab type **Tab. Telma 40** – a red "Avoid" warning appears; type **Tab. Brufen
   400** at more than 20 weeks – "Avoid"; add **Tab. Ferrous ascorbate** and **Tab. Shelcal 500** – "Caution: iron
   and calcium together". Give a patient the allergy "Penicillin" (Edit details) and type **Cap. Amoxicillin 500** –
   "Allergy". Saving still works.
5. **Prescription sets → Medicine safety**: the draft list; Edit / Approve as for the red-flag rules.
6. On the Worklist (Care plan to act on) click **Reminder**, or on the Overview's Care plan box **Send a reminder**:
   choose English / मराठी / हिंदी, change the text if needed, **Copy message**, then **Open WhatsApp chat** (only
   with a demo number – never a real patient's).

## How to test the AI features (fake data only, after the OpenAI key is in server/.env)
1. Log in as Dr. Riley Demo, open a demo pregnant patient → Visits → today's visit. **AI summary → Summarise the
   record**: a few points appear (important ones marked "Attention").
2. Doctor's notes: write some advice, then **Translate the advice for her (AI)** → मराठी → Translate → correct it
   → **Add below the advice**, Save.
3. **Read a lab or scan report (AI)**: choose a photo of a FAKE report → check the values → **Add to this visit**.
4. Patient header → **Write a letter** → Referral, a reason → **Draft the letter** → edit → **Print**.
5. Overview → Risk level: if "Other conditions" has text (e.g. "h/o PIH"), **Check the typed notes with AI** →
   **Add to the record**.
6. **Worklist → Ask your records**: click an example, e.g. "High-risk patients over 34 weeks".
7. Admin → Audit log: "AI used on a record" entries show the feature, never the text.
Without a key each button says "AI is not set up for this hospital yet".

## How to test the AI brief (fake data only, after the OpenAI key is in server/.env)
1. Log in as Dr. Riley Demo (doctor). **Today** → the **AI brief** box at the top → **Brief me**. After a few
   seconds: 3–6 points, urgent ones marked **Attention**; click a patient's name to open her record.
2. Switch **My patients / All patients** – the brief is put away (it was about the other list); **Brief me** again.
3. **Calendar** → Week → **AI brief → Brief me**: deliveries due, missed bookings, overdue care-plan visits, busy
   days. Step to the next week: the brief is put away. Try Month too.
4. Open a demo pregnant patient → **Overview** → **AI brief → Brief me**: points about her page, and "Not recorded".
5. As a nurse or receptionist: no AI brief box. Hospital admin → Audit log: "AI used" entries (Today brief,
   Calendar brief, Patient page brief), never the text.
Without a key, Brief me says "AI is not set up for this hospital yet".

## How to test Analytics (fake data only)
Use only the fake demo data. Do not enter real patient information until the app has been reviewed by an
experienced developer.
1. Run the demo script (removed 12 Oct 2026) once (it adds the analytics demo patients to Sunrise General Hospital (Demo)), start the
   app and log in as Dr. Riley Demo (a doctor's account). Open **Analytics** → Overview. The six headline numbers
   and the cards appear for the last 12 months. Under the filters, a line says how many sensitive records of other
   doctors are left out.
2. Click **My patients**. The numbers get smaller, and the "Sex at birth" card (Newborn tab) says "Whole hospital".
3. Open the **Pregnancy** tab and click **Third trimester**. A list opens with the patients behind that number, and a
   note says that opening it is recorded. Then log in as Dana Demo-Admin (a hospital admin's account) → **Audit log**: it
   shows "Patient list opened from Analytics".
4. As Dana Demo-Admin, open **Analytics**. The periods are whole finished months ("Last month" … "Last 12 months"),
   small numbers read "fewer than 5", some other numbers read "Not shown" (in a very small hospital also some small
   numbers and zeros), numbers can't be clicked, there is no "My patients", and the condition-by-condition rows are
   not there.
5. Log in as Rani Demo-RMO (an RMO's account) or Nico Demo-Nurse (a nurse's account), or as reception or lab
   staff: there is no Analytics in the menu, and typing `/analytics` in the address bar shows "Analytics is for
   doctors and hospital admins."
6. Log in as the super admin: **Analytics** shows all active hospitals together, with "By hospital" under each card
   and a Hospital picker for one hospital at a time, for whole months. No patient's name, record number or list
   appears anywhere. The platform audit log does not show record numbers. Open the same page again within 5 minutes:
   it comes back at once, with the same "worked out at" time.
7. Try each page at full screen, with the menu as an icon rail (a narrower window), and at phone width: the cards go
   to one column and the period becomes a drop-down.

## Analytics speed
Measured on 1 Oct 2026 on the development laptop with **fake data only: 5 hospitals, each with 10,000 patients,
60,000 visits over 24 months and 3,000 care plans** (much more than one clinic has today), on its own test database.
The 3 pages over budget are over only at this size – 10,000 patients per hospital. Since then the super admin's
pages are kept for 5 minutes, so only the first opening of a page in 5 minutes takes the time below; the hospital
admin's numbers are kept for 10 minutes and a doctor's page for 60 seconds.

| Request | Measured | Budget | Payload | Result |
|---|---|---|---|---|
| Doctor, Overview – first request, worked out in full | 0.892 s | (information) | 16.6 KB | – |
| Doctor, Pregnancy – first request | 0.696 s | (information) | 11.2 KB | – |
| Doctor, Risk – first request | 0.839 s | (information) | 21.6 KB | – |
| Doctor, Care plans & visits – first request | 2.133 s | (information) | 54.4 KB | – |
| Doctor, Newborn – first request | 0.257 s | (information) | 12.4 KB | – |
| Doctor, Overview (p95 of 10) | 0.009 s | 1.0 s | 16.6 KB | Within budget |
| Doctor, Pregnancy (p95 of 10) | 0.004 s | 1.0 s | 11.2 KB | Within budget |
| Doctor, Risk (p95 of 10) | 0.004 s | 1.0 s | 21.6 KB | Within budget |
| Doctor, Care plans & visits (p95 of 10) | 0.004 s | 1.0 s | 54.4 KB | Within budget |
| Doctor, Newborn (p95 of 10) | 0.003 s | 1.0 s | 12.4 KB | Within budget |
| One list page (p95 of 10) | 0.232 s | 1.0 s | – | Within budget |
| Hospital admin, uncached (all sections, four periods, masking) | 3.698 s | 3.0 s | 16.8 KB | **Over budget** |
| Hospital admin, Overview, cached (p95 of 10) | 0.005 s | 0.2 s | 16.8 KB | Within budget |
| Hospital admin, Pregnancy, cached | 0.004 s | 0.2 s | 11.4 KB | Within budget |
| Hospital admin, Risk, cached | 0.003 s | 0.2 s | 11.4 KB | Within budget |
| Hospital admin, Care plans & visits, cached | 0.006 s | 0.2 s | 48.7 KB | Within budget |
| Hospital admin, Newborn, cached | 0.004 s | 0.2 s | 12.5 KB | Within budget |
| Super admin, Overview, one hospital | 0.641 s | 1.5 s | 16.1 KB | Within budget |
| Super admin, Overview, all 5 hospitals | 3.087 s | 6.0 s | 17.7 KB | Within budget |
| Super admin, Pregnancy, one hospital | 0.590 s | 1.5 s | 10.9 KB | Within budget |
| Super admin, Pregnancy, all 5 hospitals | 2.901 s | 6.0 s | 11.8 KB | Within budget |
| Super admin, Risk, one hospital | 0.815 s | 1.5 s | 24.2 KB | Within budget |
| Super admin, Risk, all 5 hospitals | 3.821 s | 6.0 s | 26.0 KB | Within budget |
| Super admin, Care plans & visits, one hospital | 2.108 s | 1.5 s | 58.1 KB | **Over budget** |
| Super admin, Care plans & visits, all 5 hospitals | 10.938 s | 6.0 s | 61.4 KB | **Over budget** |
| Super admin, Newborn, one hospital | 0.208 s | 1.5 s | 11.9 KB | Within budget |
| Super admin, Newborn, all 5 hospitals | 0.815 s | 6.0 s | 12.8 KB | Within budget |

Why the three are slow: the Care plans & visits numbers read every current care plan (3,000 plans of 44 items in
each hospital) and work each one out as it would show today – about 1.7 s per hospital. Every payload is far under
150 KB. If it is ever needed for very large hospitals: keep each care plan's worked-out state with the plan when it
is saved, so Analytics does not work out 3,000 plans on each request.

## Analytics: open questions (the default is in use until the owner answers)
| # | Question | Default |
|---|---|---|
| Q-A | For the super admin: in a hospital with fewer than 10 women in a card, should the medical cards (risk, conditions, Hb, BP, birth weight, gestation, sex at birth) say "Too few patients in this hospital to show"? Counts such as registrations, visits and babies would stay exact. | No – exact, as decided. One setting (`PLATFORM_MIN_DENOMINATOR`) if you change your mind. |
| Q-B | Hospital admins: whole finished months only, and no condition-by-condition, risk-reason, blood-group or severe-anaemia rows. OK? | Yes. Each hidden row is one entry in `ADMIN_HIDDEN`. |
| Q-C | Doctors' numbers leave out other doctors' sensitive records (as the Patients list already does for risk). OK? | Yes. |
| Q1 | Should "My patients" include patients not assigned to any doctor? | No – only patients assigned to you. |
| Q2 | Is a baby "mine" if it is assigned to me, or if its mother is assigned to me? | Yes, either. |
| Q3 | Sex ratio under "My patients". | Always whole hospital, never split by doctor. |
| Q7 | Should "All hospitals" for the super admin mean active hospitals only? | Yes. An inactive hospital can still be picked on its own. |
| Q8 | Numbers per doctor (pregnancies, high-risk and due per doctor; visits per doctor) compare staff. Wanted later, and for whom? | Built 4 Oct 2026: Analytics → By doctor, for doctors only. |
| Q9 | A printable monthly report. | Done: Analytics → Monthly report (doctors only), with Print, since 2 Oct 2026. |
| Q10 | Add the new "Chart grey" colour (#838AA2) to the brand guide. | Yes (done). |

## How to test choosing a prescription design
1. Log in as Dr. Riley Demo → **My account → Prescription design**. Each card shows a whole page.
2. Click **Pregnancy card** (or its "See the whole page"): the page opens at the size it prints. Press **Next** and
   **Previous** (or the ← → keys) to go through the designs; **Close** (or Esc) goes back.
3. On the design you like, press **Use this design**: its card says "Chosen". Change the colour or language under
   "Make it yours" if you like, and press **Save design**.

## How to test printing and PDFs (fake data only)
1. Log in as Dr. Riley Demo (a doctor's account) and open **Patients → Meera Testcase (Demo) → Visits → the
   29 Sep 2026 visit**. Press **Print or share** (top right, or next to Save visit at the bottom).
2. The preview shows the prescription in your design and says how many pages it prints on. Press **Print** – it
   fits on one A4 page.
3. Choose **Visit summary** at the top of the preview: the same page without the medicines, titled "Visit summary".
4. Press **Download PDF**: the PDF is in your Downloads folder, e.g. "Prescription P-000002 29 Sep 2026.pdf" – open
   it, or send it. On a Windows computer, **Share PDF…** opens the share window (WhatsApp, Mail …).
   **Send on WhatsApp** shows for a patient with a mobile number (Meera's demo number isn't one: the preview says
   so). To try it, register a made-up patient with your own mobile number, open a visit and press **Send on
   WhatsApp**: WhatsApp opens a chat with that number – attach the PDF from Downloads (paperclip → Document).
5. Change something (e.g. the advice) without saving: the button reads **Save and print** – press it: the visit is
   saved and the preview opens. Leave the lower BP number empty and press it again: it shows what to fix and
   prints nothing.
6. A visit without medicines prints the visit summary straight away.
7. As the demo hospital admin (a hospital admin's account): the audit log shows "Prescription printed", "Prescription
   saved as PDF", "Visit summary printed" … with record numbers only.

## How to test voice entry on a visit (fake data only)
1. In **Google Chrome**, log in as Dr. Riley Demo (a doctor's account) and open **Patients → Meera Testcase
   (Demo) → Visits → the 29 Sep 2026 visit**. The **Voice entry** card is at the top of **Visit details**.
2. Press **Start recording** (the first time, Chrome sets up speech recognition once and asks to use the
   microphone – choose Allow) and say: "BP one twenty by eighty, pulse eighty eight, weight sixty four kilo, fundal
   height twenty six, FHS one forty four, cephalic, fetal movements present, no pedal oedema. Complaints mild
   backache. On examination pallor present. Advised CBC and rest. Next visit after two weeks with reports."
   Press **Stop recording**: the fields are filled in and marked "From voice – check", and the card lists them.
3. Record again and say: "pulse eighty eight, sorry, ninety two" (92 is used), "temperature 37.8" (it offers
   100 °F), "BP 110 by 70 … BP 130 by 90" (it asks which one).
4. Change a filled field by hand, then press **Fill in the form** again: your change stays, the card says what was
   said but not used, and no note is added twice.
5. Check every field and press **Save visit** (it waits while recording). Without a microphone, type or paste the
   same sentence into the "What was said" box and press **Fill in the form**.
6. A nurse (a nurse's account, at Lakeside Clinic (Demo)) sees the same card on a visit: only the vital signs
   are filled in, and the card says that the other details are left for a doctor or RMO.

## How to test Feature 8 in the browser (fake data only)
1. Log in as Dr. Riley Demo (a doctor's account). **My account → Prescription design**: click a few of the 10
   designs and watch the preview; choose one, e.g. "Dose chart with symbols", pick a colour and
   "English + हिंदी (Hindi)", untick "Vital signs" under "What to print", and press **Save design**.
2. **Patients → Meera Testcase (Demo) → Visits → New visit** (or open the 29 Sep 2026 visit already there).
   On **Visit details**: fill in BP, weight and the pregnancy check, type a diagnosis and advice, choose the next
   visit (the care-plan suggestion or "In 2 weeks"), and press **Save visit**. On a new visit today, the check-up
   due in the care plan is ticked already (tick anything else done today); the message says how many care-plan
   items were marked done.
3. **Prescription** tab → **Add medicine**: start typing "Iron" and pick "Iron + folic acid (IFA)", then the
   strength, dose 1, 1-0-1, after food, 3 months. Add a second medicine and press **Save prescription**. Each row's
   title shows how it will print.
4. **Print or share**: the preview is in your design with the Hindi words under the English. **Print** (A4 –
   or A5 for "Half page"), or **Download PDF**. For "Your own printed pad", set the top and bottom margins,
   print on plain paper and hold it against your pad.
5. Log in as Dr. Sam Second (a second doctor's account), switch to Sunrise General Hospital (Demo) and open
   Meera's visit: everything is read-only, and Print uses Dr. Riley Demo's design and name.
6. Log in as the demo nurse (a nurse's account, Lakeside Clinic), open an antenatal patient (e.g. Ritu
   Reception Sample) → Visits → **New visit**: only the vital signs can be typed; Print says "Nothing to print yet"
   until a doctor writes the notes or the prescription.
7. As the demo hospital admin (a hospital admin's account): the audit log shows "Visit started", "Visit updated",
   "Prescription saved" and "Prescription printed" with record numbers only.
Never enter real patient details – the app has not been reviewed for real use yet.

## How to test personal appearance in the browser
1. Log in as anyone, e.g. Dr. Riley Demo (a doctor's account) → **My account → Appearance**.
2. Click **Ocean blue**: the menu, buttons and headings turn blue at once. Try **High contrast**.
3. Text size **Extra large**, spacing **Compact**, font **Mukta**, animation **Off** – each shows at once; the line
   at the bottom says "Saved".
4. Open **Patients** and a patient: the whole app is in your look; High-risk and other status labels keep their
   usual colours. Open a visit → **Print or share**: the paper looks exactly as before.
5. **Log out**: the login page is in the standard look. Log in again: your look comes back (also on another
   computer). Log in as another demo person: they have their own look.
6. **Back to standard settings** undoes everything.

## How to test ready-made prescription sets (Feature 8b) in the browser (fake data only)
1. Log in as Dr. Riley Demo (a doctor's account) → **Prescription sets** (left menu): 12 sets, all "Draft".
   Open "Anaemia in pregnancy (mild to moderate)": what it adds, and the notes for doctors with the guidance used.
2. **Edit** it – for example change the advice – and **Save as new draft**: version 2, still a draft. **Approve**
   (tick the box after checking every medicine and dose): "Approved · v2".
3. **Patients → Meera Testcase (Demo) → Visits** → open a visit → **Prescription** tab → **Add a ready-made set**.
   Sets for antenatal patients come first. Choose "Anaemia in pregnancy": the preview shows the medicines (Meera's
   iron tablet will be replaced by the set's version), the instructions, and the tests and advice for Visit
   details. **Add to prescription**: the message says what was added; both tabs show "•" (unsaved). Check the
   Visit details tab – the tests and advice are added under what was there. Save both tabs (or leave without
   saving to keep Meera's prescription as it was).
4. Choose a draft set: the preview and the message say it is a draft – check every medicine and dose.
5. On the Prescription tab, **Save as a set**: give it a name, keep "Antenatal", **Save as a set**. It appears in
   the library as a draft; open it to add tests or advice and approve it.
6. As the demo RMO (an RMO's account): Prescription sets can be read and added to prescriptions, but there is
   no New set, Edit, Approve or "Save as a set". The demo nurse has no Prescription sets menu.
7. As the demo hospital admin: Audit log → Access changes shows "Prescription set changed / approved" with the
   set's name and version.

## How to test Feature 7 in the browser (fake data only)
0. Start the app (`npm run dev`) and run the demo script (removed 12 Oct 2026) once, so the demo pregnancies get a care plan
   (patients that already have one are skipped). The demo logins are in `docs/TEST_ACCOUNTS.md`.
1. Log in as the demo RMO (an RMO's account) and open an antenatal demo patient, for example
   Asha Sample (Demo).
   Check the "Care plan" card on the Overview, the Care plan tab, and that the due dates match the EDD. While the
   standard template is a draft, both show "Draft – not approved for clinical use"; once a doctor has approved it
   (in the demo data Dr. Riley Demo approved it on 28 Sep 2026) they show "Approved · v1" instead.
2. Mark a test done, then press Undo. Move the anomaly scan outside its window (a reason is needed). Mark folic
   acid not needed. Add "Thyroid review" at 24–26 weeks.
3. In Edit details, enter a scan EDD 6 days different: the dates move, the moved scan shows "Check date", and
   "Recent automatic changes" explains why.
4. Set the blood group to O negative: anti-D and ICT appear.
5. The demo nurse works at Lakeside Clinic (Demo), which has no pregnancy yet. First, as Dr. Riley Demo
   (a doctor's account, a doctor at Lakeside), switch to Lakeside and add a fake antenatal patient with an
   LMP about 20 weeks ago. Then log in as the demo nurse (a nurse's account), switch to Lakeside and open
   her Care plan tab: view only, with no action buttons. As the demo receptionist
   (a receptionist's account): no Care plan tab. As Dr. Sam Second (a second doctor's account), open
   Meera Testcase (Demo), who is assigned to Dr. Riley Demo: read-only.
6. As a doctor, approve the standard template: the Draft banner goes away. Then edit only a risk rule: the Draft
   banner comes back with the risk-rules reason.
7. As the demo hospital admin (a hospital admin's account), open the audit log: only "Care plan …" entries with record
   numbers, no medical details.
Never enter real patient details – the app has not been reviewed for real use yet.

## How to test baby lab tests and packages (fake data only)
1. As Dr. Riley Demo, open a made-up newborn (or register one with a birth date 2 days ago) → **Lab** tab: the
   text says these are the baby's tests and links to the mother's Lab tab.
2. **Order tests**: only "Baby: …" groups are listed. At the top, **Packages – the baby is on day 2 of life**; "Day
   2–3 – newborn screening before going home" says **Fits today**. Tick it: 4 tests are ticked. Untick one, then
   **Order 3 tests**. The order shows "Package: …".
3. As the lab, enter a blood sugar of 38 for a baby: it is flagged Low (below 45).
4. On the mother's record, the order form shows only the adult tests, and the adult packages (e.g. Antenatal booking).
5. **Clinic library → Test packages**: open a package → **Edit** (change the days or tests) → save: it is a new draft.
   **Approve** it; the order form no longer marks it "Draft". **Copy** and **New package** make the hospital's own.
6. **Care plans → Templates**: the newborn template now has the three screening items (a new draft version to approve).

## How to test information forms (fake data only)
1. As Dr. Riley Demo (a doctor's account): **Clinic library → Information forms** – 38 draft sheets. Open
   "high blood pressure in pregnancy" and switch between English + मराठी and English + हिंदी.
2. Open a made-up antenatal patient → **Edit details** → tick **Thyroid** under conditions → save. The top of the
   record now says "Information to give: low thyroid (hypothyroidism) in pregnancy".
3. Start today's visit and enter BP **150/96** → save. Back on the record, the reminder also lists high blood
   pressure. Open **Information given**: both sheets are under "To explain now".
4. **Print** one → English + Marathi → Preview: boxes for the patient, two relatives, the doctor, a witness and an
   interpreter. Print. It moves to "Given to this patient" and disappears from the reminder.
5. Print the **general** sheet and type a made-up condition (e.g. "Cholestasis of pregnancy"): it is filled in.
6. **Record signed copy** works as for consent forms. The receptionist sees no Information given tab.

## How to test care-plan printing and consent forms in the browser (fake data only)
1. Log in as the demo RMO (an RMO's account) and open Asha Sample (Demo) → **Care plan** → **Print**.
   - Patient copy → "Only some types" → tick only **Scans** → type some advice → **Preview**: a "Sonography (scan)
     schedule" with the dates and weeks of each scan and your advice. **Print** opens the computer's print window
     (choose A4; "Save as PDF" works too). Try **Visits** only for the visit schedule, and "Choose items" for one scan.
   - **Staff copy** → Preview: every item by stage, with status, source, results and notes; the patient's name and
     number at the foot of every page.
2. Open **Consent forms** (left menu): every form is "Draft". Open one and switch the wording between
   English + मराठी and English + हिंदी.
3. Back on Asha's record → **Consent forms** tab: "Suggested now" shows the HIV-test form (the HIV test is due).
   **Print** it: choose English + Marathi → Preview → Print. The printout appears under "Printed for this patient"
   with **Print again**.
4. As Dr. Riley Demo (a doctor's account), open Meera Testcase (Demo) → Consent forms: the high-risk form
   (with her risk reasons filled in) and the VBAC and caesarean forms are suggested. Print one in English + Hindi.
5. As a doctor, open a form → **Edit**: type `{naav}` into a Marathi clause and save – it is refused ("Unknown
   blank"). **Approve** a form (only after reading it): it then prints without DRAFT. Editing makes it a draft again.
6. As the demo nurse (Lakeside Clinic): the Consent forms tab is view only. As the receptionist: no tab.
7. As the demo hospital admin: Settings → Print letterhead → "Second language on consent forms". The audit log
   shows "Care plan printed" and "Consent form printed" with record numbers only (never which form).

## Beds and admission at the desk (owner, 13 Oct 2026 – feature freeze lifted for this by the owner)
Built on branch `reception-admission` (after `look-header-profile`), not merged into main until the developer has read it.
- **Hospital admin → Beds**: wards and their beds (a range like G1-G10, or names with commas). A bed is never deleted,
  only taken out of use (not while someone is in it). The admin sees free / occupied, never who.
- **Beds** in the left menu (reception, doctors, RMOs, nurses): each ward's beds – Free, Occupied (name, patient
  number, doctor, since when) or Not in use – with the counts at the top. Reading it is audited with counts only.
- **Admit here** on a free bed (reception, the patient's doctor, RMOs): find the patient, choose the reason from a short
  list (Labour, Caesarean section – planned, Observation, Other surgery, Newborn care, Other) with an optional note,
  and the time. The stay is the same as one started from her record: the RMO writes the admission notes, the stay's
  bill opens with this ward's bed charge, a doctor's discharge card ends it and frees the bed. An admission slip
  (no medical details) prints after admitting.
- **Move** (reception, nurses, her doctor, RMOs): to another free bed. Patients admitted from their record with a typed
  ward and bed are listed under the wards with "Move to a bed".
- **Reason**: reception sees only a reason chosen at the desk, never on a sensitive record or the Abortion type of
  care (owner's choice, limited as in the plan); doctors, RMOs and nurses who may see her details see it as written.
- Not in this step: splitting the bed charge between wards after a move (the first ward's price stays, as before for a
  changed ward); renaming a bed does not rename it on stays already open.

### How to test (fake data only)
1. As the hospital admin: Hospital admin → **Beds** → Ward "General ward", Beds "G1-G4" → Add beds. Take G4 out of use.
2. As the receptionist: **Beds** → G1 → **Admit here** → find a fake patient → reason "Labour", note "sent from the
   OPD" → Admit. The admission slip opens; print or close it. G1 shows her as Occupied; the counts change.
3. Try to admit another fake patient: only free beds offer "Admit here". Use **Move** to put the first patient in G2.
4. As her doctor: open her record → Stays: the stay shows "General ward · G2" and the reason. Billing → her stay bill
   has the bed charge (if a bed price is in the price list).
5. Hospital admin → Audit log: "Patient admitted", "Moved to another bed", "Bed board viewed" – ids and counts only.

## Reception's Today: number cards, quick actions, payments to collect (owner, 13 Oct 2026)
Branch `reception-today-cards` (after `reception-admission`). For logins with the receptionist role:
- **Number cards**: Today's patients (arrived · expected), Calls to make (due, overdue, babies – not booked), Collected
  today (from the Daily summary), Free beds, To collect (unpaid bills). A card opens its list: the first two open the
  box further down Today, the others open Billing or Beds. All from the database – nothing made up.
- **Quick actions** under the cards: Book an appointment, Admit to a bed, Bills and payments (New patient and Walk-in
  token stay at the top right).
- **Payments to collect** (the pending-payment alert): unpaid bills of patients who are here today, and of stays that
  have ended without the bill being settled, most owed first; each opens the bill. A stay still going is settled at
  discharge, so it is not listed.
- The Free beds card reads only the counts (`/api/beds?summary=1`: no names, not audited).

### How to test (fake data only)
1. As the receptionist, open Today: five cards above the lists. Click "Calls to make": the call list opens below.
2. Mark a fake patient with an unpaid bill as arrived: she appears under "Payments to collect"; take the payment on
   her bill and come back – she is gone and "Collected today" has gone up.

## Appointments → Month: the slot calendar (owner, 13 Oct 2026)
Branch `appointments-month` (after `reception-today-cards`). A new **Month** tab in Appointments (reception, doctors,
RMOs, nurses): one doctor's month, Sunday first. Each day shows the doctor's OPD sessions as chips – "10:00–13:00 · 13
free" in teal, or "Full" in grey – leave days, and a line like "2 booked · 1 seen · 1 cancelled". Click a day: on the
left, that day's sessions (taken/total) and its bookings with their status, and "Open this day to book" (the Day tab,
where booking, moving and cancelling already work). The month has counts only (`GET /api/appointments/month`); names
appear only for the chosen day, from the same data as the Day tab.

### How to test (fake data only)
1. A doctor sets OPD timings (Appointments → OPD timings) with a leave day this month.
2. As the receptionist: Appointments → **Month** → choose that doctor: weekdays show their sessions with free slots;
   the leave day shows "Leave". Book two fake patients on one day (Day tab) and cancel one: the month shows
   "1 booked · 1 cancelled" and one slot fewer free. Click the day: both are listed on the left.

## Appointments layout; booking and admitting from a patient's record (owner, 13 Oct 2026)
Branch `appointments-layout` (after `appointments-month`).
- Tabs renamed: **Schedule** (was Day), Month, Needs a time, **OPD settings** (was OPD timings).
- **New appointment** (main button, reception and doctors): choose the doctor and day, then one of the free times;
  the patient and visit type are chosen as before (registered patient, or a quick booking with name and phone).
- Above the times: **Booked** (this doctor, this day, with the free times left), **Needs a time** (opens that list) and
  **Seen**, with the walk-ins of the day. The doctor's OPD hours for the day show beside the day controls.
- **OPD timings not set**: a box saying so, with "Set the OPD timings" for the doctor or the hospital admin – and for
  reception, who to ask (the owner's rule stays: each doctor sets their own timings, or the hospital admin).
- **Patient record**: reception has **Book appointment** and **Admit** beside More; doctors and RMOs who may write her
  record have them in More. Book opens Appointments with New appointment ready for her; Admit chooses a free bed
  (`/api/beds?free=1`: free beds only, no names) and prints the admission slip.

### How to test (fake data only)
1. As the receptionist: Appointments → **New appointment** → a doctor with OPD timings → a day → a free time → find a
   fake patient → Book. The confirmation shows at the top; the Booked number goes up.
2. Choose a doctor without timings: the "OPD timings not set" box says whom to ask.
3. Open a fake patient → **Admit** → choose a free bed and a reason → Admit; the slip opens. **Book appointment** opens
   the New appointment dialog for her.

## My profile page and switching to the doctor account (owner, 13 Oct 2026)
Branch `profile-and-switch` (after `appointments-layout`).
- **My profile**: a card with the person's photo (camera button to add or change it; "Remove photo"), name, role,
  hospital, email and phone; Employee ID, Department (from the roles), Join date (the day added to this hospital) and
  Status. Tabs: **Profile** (personal information – Edit changes name, phone and Employee ID; the email is the login
  and only the super admin changes it – professional details for doctors and RMOs, change password, account
  information, danger zone), **Security**, **Appearance** (colours, spacing) and **Accessibility** (font, text size,
  explanations, animation). Prescription design and Voice words are links at the end of the tabs.
- The photo is made small in the browser (256 px JPEG) and kept with the account (`PUT /api/auth/me/photo`); it is
  shown only to the person themself – on this page and in their profile circle. Lists keep initials (BRAND.md rule 7).
- **Log out from all devices**: logging out already ends every session of the account (the session version goes up),
  so the button logs out after a confirmation.
- **Switch to your doctor account** (super admin or platform admin with a linked doctor account): asks for the doctor
  account's password and signs in as the doctor at once (audited as that account's login).

### How to test (fake data only)
1. As any login: My settings → add a photo, Edit → phone and Employee ID → Save details; the card shows them.
2. Change the password on the Profile tab; try the Appearance and Accessibility tabs.
3. As a super admin with a linked doctor account: profile circle → Switch to your doctor account → type the doctor
   account's password → you are on the doctor's Today page. A wrong password says so and keeps you as super admin.

## Patients list and registration: quick actions, registered dates, empty lists, register another (13 Oct 2026)
Branch `patients-quick-actions` (after `profile-and-switch`).
- **Quick actions on each row (reception)**: Call (opens the phone), Book appointment (New appointment ready for her),
  Admit (choose a free bed; slip). Not on a record marked as a duplicate or closed.
- **More filters → Registered from / to** (`registeredFrom`, `registeredTo` on `GET /api/patients`, hospital days,
  both days included).
- **Empty list**: "No patients match these filters" with Clear the filters; a hospital with no patients yet offers
  "Register the first patient".
- **Save and register another** on the New patient form (when no clinical page follows, i.e. reception): saved, the
  confirmation shows, and a fresh form is ready for the next patient.

### How to test (fake data only)
1. As the receptionist: Patients → each row has Call, Book appointment and Admit; try Book and Admit.
2. More filters → Registered from today: only today's registrations.
3. New patient → fill in a fake patient → **Save and register another**: the confirmation shows above an empty form.

## The Materio look (owner, 13 Oct 2026)
Branch `materio-look` (after `patients-quick-actions`). The look of the Materio admin template, in Perinexa's own
colours and fonts – no new library (`client/src/styles/look-materio.css`, loaded after the other screen styles):
- **Outlined fields**: the label sits on the field's border (on every form where a label is followed by one box);
  fields with choices or checkboxes keep the label above.
- **Underline tabs** on every page instead of pills (the chosen tab in Perinexa Indigo).
- **My profile → Account** as in Materio: the photo with **Upload new photo** and **Reset** ("Allowed JPG, PNG or WebP.
  Max size of 800 KB"), then the details in two columns (name, email, phone, Employee ID, role, hospital, department,
  join date) with **Save changes** and **Reset**. Security, Appearance and Accessibility are the other tabs.
- Note: this page has two filled buttons (Upload new photo, Save changes), as in the owner's picture – an exception
  to "one primary button per screen" (docs/BRAND.md).

## The full lab system (owner, 17 Oct 2026 – feature freeze lifted for the lab by the owner)
Branch `lab-lims`. Plan and decision: `docs/LAB_LIMS_PLAN.md`. Features like a commercial lab system (eLabAssist was
used only as a list of features; the look stays Perinexa's own).
- **Sample numbers and labels**: every order gets a sample number (`261017-0003`); **Print labels** – one per
  container, with a barcode (`261017-0003-2`), name, number, age, sample and tests (HIV under its neutral name).
- **Reject the sample** (haemolysed, clotted, too little …): the order goes back to Samples to take, marked
  **New sample needed**; every rejection is kept.
- **Lab → Tests**: the hospital's test list by department. The lab, doctors and RMOs add the hospital's own tests
  (₹0 line on the price list for the admin) and change any test's department, times, outside lab, "offered", limits,
  and **ranges for a group** (an age; pregnant or not; a baby's sex after birth). Values and ranges are DRAFT until a
  doctor approves them; the range used is saved with each result and shown on the report.
- **Print the report** (once reported): letterhead, results by department, flags, the range used (DRAFT marked), who
  entered and who checked. The confidential test is left out unless ticked, then printed under its neutral name.
- **Lab → Settings** (doctors): a second person checks results before they go to the doctor (Results to check, Approve
  and report, Send back); optionally only chosen people. Red flags from lab results start once checked.
- **Worklist**: department filter, **Late** when past the due time (24 h, urgent 4 h, cultures 72 h, smears 120 h –
  changeable per test), **At outside labs** list. **Lab → Find**: sample number (scan a label), patient number or
  name, dates, status. **Outside lab** on an order: send tests (lab, reference), mark them come back.
- **Lab → Register**: orders between two dates (at most 62 days) with counts; Print; Save for Excel (CSV).
- Server: `lab/labSetup.js`, `models/LabTestSetting.js`, `models/LabSetup.js`, `routes/labSetup.js`
  (`/api/lab-setup`), `routes/lab.js`; website: `pages/lab/` (LabFindPage, LabRegisterPage, LabTestsPage,
  LabTestEditPage, LabSettingsPage, LabOrderExtras, LabPrints), `components/print/barcode.js`. Tests:
  `server/tests/lab-lims.test.js`, `client/src/pages/lab/labLims.test.jsx`.
- ⚠️ For the doctor to check: every usual range (built-in and new) stays DRAFT until approved under Lab → Tests.
- Not yet: the hospital's own tests can't go into test packages; the copy of the whole record names their values by
  key. Later list: QC charts, reagent stock, machine connection, home collection, WhatsApp/SMS reports, delta checks.

### How to test (fake data only)
1. As a doctor: open a fake patient → Lab → Order tests (CBC, HIV, TSH). The order shows a **Sample number**.
2. Log in as lab staff → Lab → open the order → **Print labels** (one label per tube, with a barcode) → **Mark sample
   taken** → **Reject the sample** (Haemolysed): it is back under Samples to take with **New sample needed**.
3. Take the sample again, enter results, **Report results** → **Print the report**; tick "Include the confidential
   test" and see it printed as "Lab test (confidential)".
4. Lab → **Tests** → Haemoglobin (Hb) → Add a range for a group: Pregnant, 10.5 to 14 → Save. Order Hb for an
   antenatal patient: the form says "Usual for her: 10.5–14 g/dL (pregnant)". As a doctor, open the test → Approve.
5. As a doctor: Lab → **Settings** → tick the check → Save. Lab staff report a result: it waits under **Results to
   check**; a second lab person opens it → Approve and report (or Send back).
6. On an order: Outside lab → **Send tests to an outside lab** → it shows under **At outside labs** → Mark as come back.
7. Lab → **Find**: type the sample number (or a patient's name). Lab → **Register**: today's counts → Print, Save for
   Excel.

## WhatsApp at the desk (owner, 17 Oct 2026 – feature freeze lifted for these 5 items)
Branch `whatsapp-desk` (on top of `lab-lims`). Plan, decision and Meta setup for +91 88880 24000:
`docs/WHATSAPP_DESK_PLAN.md`. Off until WhatsApp is set up in `server/.env` and the hospital admin switches it on.
- **Sign-in OTP on WhatsApp**, SMS if WhatsApp fails (Hospital admin → Patient messages).
- **Appointment messages** (booking, move, cancellation – now at once – and the day-before reminder) on WhatsApp for
  patients who chose WhatsApp; **bill or receipt** from its print preview (Send on WhatsApp now).
- **Lab report** on WhatsApp once a doctor reviewed it, never with the confidential test.
- **Queue time** on WhatsApp when she is marked arrived (token or time, patients before her, about when).
- **Cash handover** (Billing → Cash handover): hand over the day's cash; a doctor or the admin confirms.
- Server: `reminders/sender.js` (`deliverOtp`, WhatsApp in `currentSender`), `visits/whatsappSender.js` (templates),
  `visits/whatsappDocuments.js`, `appointments/queueTime.js`, `models/CashHandover.js`, `routes/cashHandover.js`;
  website: `pages/billing/CashHandoverPage.jsx`, BillPage and LabPrints (Send on WhatsApp now), TodayPage, portal
  words, Patient messages settings. Tests: `server/tests/whatsapp-desk.test.js`, `client/src/pages/billing/cashHandover.test.jsx`.
- ⚠️ Marathi and Hindi of the queue message and the portal line are DRAFT (TRANSLATIONS_TO_CHECK.md section 6).

### How to test (fake data only, `WHATSAPP_MODE=practice` – nothing really sent)
1. Hospital admin → Patient messages: tick "Let staff send … on WhatsApp", "Send patients' sign-in OTPs on WhatsApp",
   "Send the queue time on WhatsApp" and automatic reminders → Save.
2. A fake patient's page → More → Reminders and portal → agrees, WhatsApp.
3. Today → mark her arrived and give a token: "Queue time sent on WhatsApp: … about 10:40".
4. Billing → her bill → Print → Send on WhatsApp now. Lab → a reviewed order → Print the report → Send on WhatsApp now
   (tick "Include the confidential test": the button goes away).
5. Portal sign-in with mobile and OTP: "an OTP was sent to it on WhatsApp (or by SMS)".
6. As reception: take a cash payment → Billing → Cash handover → Hand over the cash. As a doctor: Today shows
   "1 cash handover is waiting" → Count and confirm.

## Admission like a hospital system (owner, 17 Oct 2026 – feature freeze lifted for these 6 items)
Branch `admission-desk`. Plan and decision: `docs/ADMISSION_DESK_PLAN.md`.
- **IPD number** for every stay (`IP-2026-000001`) and a printed **admission form** with the general consent (DRAFT
  wording) and signature lines.
- **Wristband** with a barcode of the IPD number (blood group and allergies only for nurses, RMOs and doctors).
- **Admission checklist** at the desk (ID proof type + last 4 digits only, attendant, who pays, consent signed),
  pre-filled from her record; **Checklist incomplete** on the bed board; MLC needs the police station.
- **A doctor's admission request** (her Stays tab → Request admission at the desk); reception admits from **Admission
  requests** on the bed board. Hospital admin → Beds → **Admission rules** (request first; checklist required).
- **Discharge clearance and gate pass**: after the doctor confirms the discharge card, the bed board lists her under
  **Discharged – to clear for leaving**; reception or billing clears her (dues need a reason) and prints the **gate pass**.
- **OPD number** when marked arrived (`OP-2026-000001`) and **Print the OPD case paper** on Today.
- Server: `inpatient/admissionDesk.js`, `models/AdmissionRequest.js`, `routes/admissionDesk.js` (`/api/admission-desk`),
  `routes/beds.js`, `routes/arrivals.js`; website: `pages/beds/AdmissionDesk.jsx`, BedBoardPage, BedSetupPage,
  PatientStaysTab, TodayPage. Tests: `server/tests/admission-desk.test.js`, `client/src/pages/beds/admissionDesk.test.jsx`.

### How to test (fake data only)
1. Hospital admin → Beds → Admission rules: tick both (or leave them off to try the flag).
2. As a doctor: a fake patient → Stays → **Request admission at the desk** (Caesarean section – planned, tomorrow).
3. As reception: Beds → **Admission requests** → Admit → choose a bed; the checklist is pre-filled from her record –
   complete it (ID proof last 4 digits, attendant, who pays, consent signed) → Admit. Her bed shows the IPD number.
4. On her bed: **Form** (admission form with the barcode and consent lines) and **Wristband**.
5. Admit someone as an **Emergency** without the checklist: "Checklist incomplete" on her bed → **Checklist** → complete.
6. As her doctor, confirm her discharge card; as reception: Beds → **Discharged – to clear for leaving** → Clear (a due
   amount needs a reason) → the gate pass prints.
7. Today → mark a patient arrived: "OPD number OP-2026-…" → **Print the OPD case paper**.

## Lab version 2 (owner, 17 Oct 2026 – feature freeze lifted for these 8 parts)
Branch `lab-v2`. Plan and decisions: `docs/LAB_V2_PLAN.md`. **The lab may now register walk-in patients (identity only)
and order tests from an outside prescription** (owner's clinical decision).
1. **Walk-in and referred patients**: Lab → Worklist → **Walk-in patient** (find or register her, referrer or "self",
   prescription, tests, home collection). Lab → **Referrers** (doctors and centres; no commissions). Walk-in orders are
   not in the hospital doctors' review list and can go on WhatsApp once reported.
2. **Trends and delta checks**: an order shows **Her earlier results**; Lab → Tests → a value's "Big change" limit (%)
   flags a jump (DRAFT, none by default); printed on the report.
3. **QR code** on the printed report → a public page (/verify/…) confirms it is genuine – no results, initials only.
4. **Quality control**: Lab → **QC** – control lots, the day's runs, Westgard rules, **Levey-Jennings chart**,
   corrective actions; while a test's QC is rejected today, reporting it needs a reason.
5. **Lab stock**: Lab → **Stock** – items, what each test uses, batches (expiry, cost), receive, count, write off; a
   reported test takes its stock (earliest expiry first); low-stock and expiring warnings.
6. **Cost per test**: Lab → Stock → **Cost per test** – by month: tests, income, reagents, write-offs, margin.
7. **Home collection**: on a walk-in or any order waiting for a sample – address, day, time, collector; Worklist →
   **Home collections**; On the way → Collected (the sample is taken) or Could not collect.
8. **USG and radiology**: patient → Lab tab → **Order a scan**; left menu **Scans** (to schedule, scheduled, to report,
   signed); DRAFT report templates (early pregnancy, NT, anomaly, growth, pelvis/TVS, follicular, breast, abdomen,
   X-ray); a doctor signs; printed report says the fetal sex is not determined (PCPNDT).
- Server: `routes/lab.js`, `routes/labQc.js`, `routes/labStock.js`, `routes/imaging.js`, `routes/verify.js`,
  `lab/qc.js`, `lab/stock.js`, `imaging/templates.js`, models Referrer, QcLot, QcRun, LabItem, LabBatch, LabStockMove,
  ImagingOrder. Website: `pages/lab/` (LabWalkIn, LabQcPage, LabStockPage, LabReferrersPage, VerifyReportPage),
  `pages/imaging/ImagingPages.jsx`, `components/print/QrCode.jsx`. Tests: `server/tests/lab-v2.test.js`,
  `client/src/pages/lab/labV2.test.jsx`.
- ⚠️ For the doctor to approve: the scan report templates and any "Big change" limits (DRAFT).

### How to test (fake data only)
1. As lab staff: Lab → Referrers → add a fake doctor. Lab → Worklist → **Walk-in patient** → register a fake patient →
   choose the referrer, tests (Hb), tick "Collect the sample at home" → Make the order.
2. Worklist → **Home collections** → open it → On the way → Collected. Enter Hb 12 → Report results → **Print the
   report**: "Referred by", and a QR code at the bottom; open the QR's address: "This is a genuine report".
3. Lab → **QC** → add a lot (Haemoglobin, level 1, mean 12, SD 0.3) → enter 12.2 (Accepted), then 13.2 (Rejected) →
   Chart. Make another Hb order → reporting asks why (QC rejected) → write a corrective action under QC.
4. Lab → **Stock** → add "Hb reagent", unit test, used by Hb 1 per test → Receive a batch (10, ₹30). Report an Hb:
   the stock drops by 1. Stock → **Cost per test** for this month.
5. Lab → Tests → Haemoglobin → set the "Big change" limit (20 %); report Hb 12, then Hb 9 for the same patient: Big change.
6. As a doctor: a patient → Lab tab → **Order a scan** (USG – NT scan). Scans → Schedule → Mark done → write the report
   → Sign → Print.

## Reception like a hospital system (owner, 17 Oct 2026)
Branch `reception-v2`. Plan, decisions and the WhatsApp set-up steps: `docs/RECEPTION_V2_PLAN.md`.
- **Sidebar**: each module's pages show under it in the left menu.
- **Charges by themselves** once priced: registration, admission, nursing per day, doctor's ward round, scans; more
  hospital items in the price list. **Doctor's name** on the bill and on each line.
- **Add items** on a bill: search or tap, a list with − / +, the doctor once, one button.
- **Slots kept for walk-ins** (OPD settings), not offered online, marked Walk-in for reception.
- **Bell** (notifications) and **Checkup done** for the doctor; reception is told.

### How to test (fake data only)
1. Hospital admin → Billing → Price list: set Registration fee ₹100, Nursing charge per day ₹300, Doctor visit (ward
   round) ₹400. Register a fake patient → her bill has the registration fee, with her doctor's name.
2. A bill → **Add items** → type "cert" → tap Medical certificate, tap Emergency consultation twice → choose a doctor →
   Add to the bill. The lines show the doctor; Print shows "Doctor".
3. Appointments → OPD settings → Slots kept for walk-ins: 2 → Save. Schedule: the last two slots of each session say
   Walk-in. The patient portal does not offer them.
4. As reception book a fake patient for the doctor → as the doctor, the bell shows "New appointment". Mark her arrived
   → "has arrived". As the doctor: Today → Waiting to be seen → open her → **Checkup done** → as reception, the bell
   says "Checkup done".
5. The left menu: Billing, Lab, Appointments show their pages underneath.

## Correcting a payment, and a clearer bill (owner, 19 Oct 2026)
Branch `bill-correct`. Plan and decisions: `docs/BILL_CORRECTIONS_PLAN.md`.
- **Correct a payment** (e.g. UPI failed, paid in cash): mode, reference, amount, time; the original is kept with who,
  when and why; the receipt prints "Corrected"; audit log; the cash handover follows. Reception on the day until the
  cash handover is confirmed, then only the hospital admin.
- **Sidebar**: only the Lab shows its pages under it (owner's change); the other items are one link each again.
- **The bill screen** as a hospital bill: details at the top, numbered items with category and doctor, "Set price" for
  the admin on an item with no price, totals on the right, payments as a table.

### How to test (fake data only)
1. As reception: a fake patient's bill → Add items → take payment by UPI.
2. Payments → **Correct** → Paid by: Cash, reason "UPI failed, paid in cash" → Save. The payment shows "Corrected";
   History shows what it was. Print → the receipt says "Receipt (corrected)".
3. Billing → Cash handover: your cash now includes it.
4. Hand over and have a doctor confirm it → as reception, Correct is gone ("only the hospital admin"); as the hospital
   admin, correct it → the confirmed handover shows "Corrected after it was confirmed".
5. As the hospital admin, a bill with a lab test at ₹0 → **Set price** → the bill takes the price.
6. Make the browser narrow (tablet): items and payments show as blocks, no sideways scrolling.

## The lab as eLabAssist lays it out (owner, 19 Oct 2026)
Branch `lab-dash`. Plan and decisions: `docs/LAB_DASHBOARD_PLAN.md`.
- **Lab dashboard**: every lab module as a button with what waits there; the day's numbers and tests and charges by
  department (lab staff).
- **Registration on one screen**: patient, referral, tests, sample, bill (discount, payment) → Save and print receipt.
- **Status tracker** on each order; **result entry by department**.

### How to test (fake data only)
1. As lab staff: click **Lab** in the menu → the dashboard. Click **New registration**.
2. Find or register a fake patient → Prescription "Self" → type "hb", tap Haemoglobin; type "tsh", tap TSH → Sample:
   Taken now → Discount ₹50, why "Staff family" → Save and print receipt. The receipt shows the sample number.
3. Close the receipt → the order shows the steps: Registered, Sample taken, Received in lab done; Results entered next.
4. Lab → **Result entry** → Haematology → type Hb 9.5 → Save, then (after TSH under Hormones) Report. Open the order:
   Hb is flagged Low.
5. Lab → Dashboard: Registered, Tests, Reported and Charged went up; Today / Last 7 days / This month.

## Sign-in wait after wrong passwords; the lab order page (owner, 19 Oct 2026)
Branch `login-lock`. Decisions: `docs/LOGIN_LOCK_PLAN.md`.
- 3 wrong passwords in a row → 2 minutes' wait with a countdown, for staff and patients (was 5 / 30 minutes for patients).
- The lab order page as one clear summary card (steps, facts, buttons) and results typed in a table.

### How to test (fake data only)
1. Sign-in page: a fake staff email, a wrong password three times. The second time it warns; the third shows "Please
   wait 1:59…" counting down, and Sign in is off. After 2 minutes the right password works.
2. Patient → code on paper: a wrong 4 digits three times – the same countdown.
3. Lab → open any order: one card with the steps, the facts and the buttons; Results as a table.

## Walk-in slots: after every 5 online, 2 kept (owner, 19 Oct 2026)
Branch `walkin-pattern`. Appointments → OPD settings → Slots kept for walk-ins: "Slots open online in a row" (e.g. 5) and
"Then kept for walk-ins" (e.g. 2), through the whole day; the screen says the rule in words with an example. Replaces
"the last slots of each session".

### How to test (fake data only)
1. As a doctor: Appointments → OPD settings → a session 10:00–13:00 → 5 and 2 → Save timings.
2. Schedule: 10:50 and 11:00, 12:00 and 12:10 … say Walk-in (dashed); reception can book them.
3. Patient portal booking: those times are not offered.

## Lab report templates: each test its own report (owner, 19 Oct 2026)
Branch `lab-templates`. Plan and decisions: `docs/LAB_TEMPLATES_PLAN.md`.
- **Each test prints by its own template**: a table with sections (CBC, LFT, RFT, urine routine, thyroid, lipid …),
  serology with method and cut-off, culture with the antibiotic table (S / I / R), or paragraphs (histopathology, Pap
  smear in the Bethesda layout); with its method and interpretation notes, and cultures and histopathology on their
  own page.
- **Full value sets**: full CBC with indices and differential, full LFT, RFT with electrolytes, full urine routine;
  new thyroid and lipid profiles, high vaginal swab culture, histopathology. MCV, MCH, MCHC, indirect bilirubin,
  globulin, A/G ratio, LDL, VLDL and cholesterol/HDL are **worked out** when left empty.
- **Ranges for men** (a man the lab registers – Woman / Man at registration); women and pregnancy ranges as before.
- **Who signs the report** (Lab → Settings): name, qualification, registration number and signature picture – printed
  only on a report that person checked. "End of report" and "Page 1 of 2".
- ⚠️ **DRAFT for the doctor to check and approve**: the new values and ranges, the ranges for men, every method and
  note (Lab → Tests → a test → Approve).

### How to test (fake data only)
1. As a doctor: Lab → Settings → **Add a signer** → "Dr Sample Pathologist", MD (Pathology), Reg. No. "TEST 123",
   staff member: a lab person, signature picture: any small PNG → Save. Tick **Default signer** on a second signer.
2. As that lab person: Lab → New registration → a fake patient → Sex **Man** → tests CBC, LFT, Urine culture → Taken now
   → Save.
3. Open the order → type Hb 12.5, RBC 4.2, PCV 38 (leave MCV, MCH, MCHC empty: the hint shows what they come to),
   bilirubin 1.0, direct 0.3, total protein 7, albumin 4; urine culture: Growth, E. coli, Nitrofurantoin Sensitive,
   Ciprofloxacin Resistant → Report results.
4. Hb 12.5 is **Low** with "13–17 g/dL (men)"; MCV, globulin and A/G ratio say "worked out".
5. **Print the report**: CBC in sections, LFT, the culture on its own page with the S / I / R table, methods and
   "Note (DRAFT)", the signer with the signature picture, "End of report", "Page 1 of 2" at the bottom.
6. Lab → Tests → **Histopathology** → layout Paragraphs. Order it for a fake patient, type the specimen and diagnosis →
   the report prints them as paragraphs.

## Pathology rate list in every hospital's price list (owner, 23 Oct 2026)

- The hospital's rate list ("PATHOLOGY RATE LIST-6.pdf") is in `server/src/billing/pathologyRates.js`. On the server,
  `npm run load:lab-rates` puts it into every hospital's price list (safe to run again; each change in the audit log).
- 36 of the app's own lab tests get their price (ordering one charges it). Owner's choices: HIV and HBsAg at the card
  price; a test made of several is their sum (Day 2–3 hormones ₹4,200); HVS culture as pus culture; histopathology
  as small biopsy. Tests not on the list (anti-TPO, lupus anticoagulant, the baby's sepsis screen …) keep their price.
- The 130 other tests on the list are added to the price list under Lab test, for reception to add to a bill. They
  can't be ordered in the Lab until each is set up in Lab → Tests (fields and ranges: the doctor approves). HIV's other
  methods show only as "Lab test (confidential) – Duo Ultra / Chemi".

### How to test (fake data only)
1. On the server (or your computer): `npm run load:lab-rates` → one line per hospital with what changed.
2. As the hospital admin: Billing → Price list → Lab test: CBC ₹300, Day 2–3 hormones ₹4,200, Vitamin D ₹1,500.
3. Order a CBC for a fake patient in the Lab → her bill has CBC ₹300.

## How to test fertility treatment plans (fake data only)
Log in as Dr. Riley Demo (demo.doctor@example.com) at Sunrise General Hospital (Demo). (A fresh `npm run seed:demo` gives
the four demo fertility records a made-up history; on an older database enter one yourself in step 1.)
1. Open **Sample Fertility 02 (Demo)** (an infertility record, sensitive) → **Edit details** → the new **Fertility
   history** section: choose *Primary*, 20 months, *Irregular* cycles, ovulation *Anovulation*, tubes *Both tubes
   patent*, semen *Within the WHO 2021 ranges*, tick **PCOS**, AMH 6 → **Save changes**. The Overview now has a
   **Fertility history** card.
2. **Treatment plan** tab → **Suggest plans**: "Suggested for her" shows *Ovulation induction with letrozole* with the
   reason (PCOS with anovulation; letrozole first line – PCOS 2023, WHO 2025, FOGSI 2024) and, with a BMI of 30 or
   more, a weight caution; the other protocols are under "Show the other … protocols". Open **What this protocol
   contains** to read the text and its sources. Tick letrozole and *Lifestyle and preconception care* → **Build the
   plan from the selected**.
3. The draft opens for editing: change a line under *Medicines and doses*, set a review date → **Save the plan**. The
   plan shows **Draft**; **Earlier versions of this plan (1)** holds the text before your edit.
4. **Confirm plan** (a doctor; as the demo RMO the button is not there and the server refuses). Then **Record outcome**
   → *Pregnant* → **Mark completed**: the plan moves to **Earlier plans**, and **Suggest plans** is offered again.
5. Change the history (Edit details: tubes *Hydrosalpinx*) → Suggest plans: *Tubal factor* and *IVF or ICSI* lead,
   with "salpingectomy or tubal occlusion before IVF". Set her age to 52 in Edit details → the IVF card carries the ART
   Act caution (upper age 50).
6. **Switch to…** on a confirmed plan → *IUI with ovarian stimulation*, 4 cycles completed, a reason → **Switch**: the
   IUI draft opens with "Switched from …" as its first line, the earlier plan sits under Earlier plans as *Completed –
   Moved to the next step*, and the Overview's Fertility history shows "Ovulation induction 4". Switch again to
   *IVF or ICSI* with 3 IUI cycles; **Suggest plans** now puts IVF first. With no plan, **Start with a step…** builds the
   first plan from the ladder.
7. On a confirmed plan → **Start a cycle** (day 1 and the medicines) → the sheet opens: **Add scan day** twice (dates
   after day 1, follicles "12, 10" and "16, 11", endometrium 8), the trigger (hCG, a date), *Insemination (IUI)* with
   a date and post-wash count 12 → **Save the sheet**: the state is "After trigger" and each scan day shows who
   entered it. **Print report** → मराठी: the follicular study report with the scan table, the trigger and the IUI
   under their Marathi labels, advice typed in the preview, the doctor's signature. Enter the pregnancy test
   (negative, a date) → Save: "Completed", and the Fertility history card shows one more ovulation induction cycle.
   Back on the plan the sheet is listed under "Cycle sheets"; **Start a cycle** again is offered only now.
8. As the demo nurse (Lakeside Clinic) the tab is missing on a sensitive record; remove the sensitive marking (More →
   Remove sensitive marking) and the nurse reads the plan without buttons. **More → Copy of the whole record** has the
   parts **Fertility history** and **Fertility treatment plans**. Hospital admin → Audit log: "Fertility treatment plan
   opened / built / edited / confirmed or ended" with the record number only.
Nothing in a plan is prescribed or ordered; prescriptions and orders are written on the visit as before.


## Ideas for later (security hardening before any real use)
- Lock an account temporarily after many failed logins (in addition to the current rate limit).
- Run MongoDB with authentication and as a replica set (enables transactions); encrypted backups.
- HTTPS hosting, security review by an experienced developer, and a privacy/compliance check (e.g. HIPAA/GDPR,
  depending on the country) before any real patient data.

## How to start the app
Easiest: double-click **Start Perinexa.command** in the project folder (Finder). It opens the Mac's Terminal and
starts everything; keep that window open while you use Perinexa. (The Terminal inside the Claude app stops the app
whenever Claude reloads, so the Mac's own Terminal is more reliable.) If the login page says "Can't reach the
server", the app has stopped: double-click the file again.

Or, from the project folder:

    npm run dev

Then open http://localhost:5173. After updating to Feature 7, run the demo script (removed 12 Oct 2026) once so the demo
pregnancies get a care plan. Logins are listed in `docs/TEST_ACCOUNTS.md` (super admin:
`SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `server/.env`; first login asks for a new password). Stop with Ctrl + C. Stop the database with `npm run db:stop`.
