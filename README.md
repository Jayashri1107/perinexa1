# Perinexa1

A hospital platform (MongoDB, Express, React, Node), built **one module at a time**, following the flow of Perinexa.
Fake sample data only.

| # | Module | Status |
| --- | --- | --- |
| 1 | **Main admin** (super admin): login, dashboard, hospitals, users & access, master data, audit log | Done |
| 2 | **Hospital admin**: overview, staff, OPD timings, hospital settings (print letterhead, patient messages, ABDM), the hospital's audit log, hospital switcher, My settings | Done |
| 3 | **Patients**: registration with a duplicate warning, need-to-know access per role, sensitive records, emergency access | Done |
| 4 | **Billing**: price list, bills, payments, refunds, discounts, unpaid, daily summary, monthly income, CSV export, UPI settings, printed bills | Done |
| 5 | **Pharmacy**: medicines, suppliers, purchases, batch stock, counter sales (earliest expiry first), returns, write-offs, H1 / X / narcotic registers, alerts, sales and GST reports, settings, printed tax invoices | Done |
| 6 | **Analytics and Today**: per hospital (small numbers hidden for non-doctors), platform analytics for the super admin, a role-aware Today page | Done |
| 7 | **The doctor's work**: Appointments (day of slots, needs a time, walk-in tokens, arrived/seen, OPD timings – doctors set their own), Calendar (booked visits, EDD, LMP; reminders to send), Lab (order, sample, results with flags, amend with a reason, review), Clinic library (Perinexa's DRAFT care plans, red-flag / risk / medicine-safety rules, consent and information forms, test packages, prescription sets – a doctor approves each) | Done |
| 8 | Visits and prescriptions (using the approved care plans, rules and prescription sets) | Next |
| 10 | **Records** (7 Oct 2026): medical history page (stays and discharge cards, visits, lab, documents); scanned documents on a patient's record (PDF / JPG / PNG, kept in the database, entered in error instead of deleted); Discharges for reception (signed discharge cards to print or save as PDF, scans to upload) | Done |

**8 Oct 2026 – notifications, Send to pharmacy, sign-in page, sidebar**
- The bell: once a day a doctor gets "Your day today" (her appointments, admitted today, in hospital) and reception
  "Discharges today" (discharged, cards being prepared) – counts only, sent only when there is something to tell. A
  booking for today says "today"; reception also hears when a discharge summary is marked ready for review. Each kind
  of notification has its own icon.
- Send to pharmacy: on a visit's prescription her doctor or an RMO clicks **Send to pharmacy**; it appears on
  Pharmacy → **Prescriptions** (waiting, oldest first; given today) and the pharmacists are notified. "Sell at the
  counter" opens the counter with her and the medicines filled in; the sale takes it off the list ("Mark as given"
  for one given another way). The visit shows "Waiting at the pharmacy" / "Given by the pharmacy".
- Sign-in page: things glide in, soft rings drift, two made-up sample cards float beside the form (wide screens);
  still when the computer asks for reduced motion. No gradients anywhere (sidebar, sign-in, Today, My settings).
- The sidebar's menu scrolls inside it on short screens (it ran off the bottom, e.g. for the super admin).
- Billing on Today: four cards (bills today, received today, outstanding, refunds today); "Needs your attention" with
  overdue bills (older than `billing.overdueDays`, 7), part-paid bills and the rest not paid; quick actions Collect a
  payment and Find a bill. For the billing department and the hospital admin: recent bills (Collect, Print), pending
  payments (oldest first, overdue in red), today's collection by payment mode, today's activity and the last 7 days.
  "Collect" opens the bill with the payment form. The bill list filters Unpaid, Part paid, Overdue and Refund due.

- Today for reception: **Book appointment** (the booking form opens at once), **Book lab** (choose the patient and the
  tests – straight to the lab's worklist, marked "Booked by reception", her doctor notified; `/api/hospital/lab-bookings`)
  and **Book ultrasound** (Obstetric or Gynaecology – the booking form with visit type "Ultrasound – obstetric /
  gynaecology"). A "Beds booked" card and the booked beds with the patient in each, on Today and on Admissions.
- New patient: one microphone beside the "fake data only" notice asks the questions one at a time and fills the form
  (the two voice cards are gone).
- Sign-in page: calm and minimal – a small stethoscope symbol, one headline, one changing line, three chips.

- Give a prescription (`config.access.dispense`: pharmacist, receptionist; `/api/hospital/dispensing`): Today shows
  "Prescriptions to give"; **Give prescription** shows her details and the doctor's medicines read-only, matched to
  stock with the quantity from the dose and days, price and amount; more medicines can be added; other charges from
  the price list or written in; discount; payment (Cash, UPI, Card, Bank transfer …). "Give and make the bill": the
  medicines are sold from stock onto ONE new bill with the charges, the payment is recorded, the prescription is
  marked given; **Print bill** shows each medicine and charge.
- The prescription opens in a box, one card per medicine, the dose as 1-0-1 buttons. Users & access → Type lists each
  staff position.

**9 Oct 2026 – the nurse's work, wards on floors, phones**
- Wards have a **floor**; Wards and beds and the bed picker group them by floor; a stay keeps "Ward (Floor)".
- **Nursing station** (`/hospital/nursing`, doctors, RMOs, nurses): the patients in hospital in the chosen ward (remembered
  in the browser) – bed, name, number, age, doctor, reason, allergies – with doses due / overdue, vital signs due, IV fluids
  running or to start, tests waiting, abnormal results, care tasks due and red flags; totals on top; refreshed every
  minute; most urgent first. Nurses see the same numbers on Today ("My ward now").
- A stay opens on **Medicine and care charts** (`?tab=care`; the documents are the other tab): Medicines, IV fluids,
  Vital signs (now also breathing rate, pain score, blood sugar), Tests, Tasks and notes, Intake and output (24-hour
  totals), Shift handover (an automatic summary for the next shift and the handover note).
- **Doctor's orders** (`wardCare/careOrder.model.js`): her doctor or an RMO writes a medicine (dose, route, food, times
  – none for as needed), an IV fluid (fluid, volume, rate) or a care task (times); stops it with a reason; never changed
  or deleted. Nurses are notified of new and stopped orders (bell → Orders).
- **Charting** (`/api/hospital/ward-care`): a dose given, given late, refused, withheld or missed (all but given need a
  reason; her doctor is notified when one is not given); a dose or task charted only once; IV started / paused /
  resumed / completed / site checked with the volume given; intake and output; the handover. Entries are never
  changed: "entered in error" with a reason. Every order, entry and opening is in the audit log.
- What counts as due: `config.nursing` – shifts (sample 08:00 / 14:00 / 20:00), the dose times, due from 60 minutes
  before, overdue 60 minutes after, vital signs every 4 hours. **Sample settings: the hospital decides them.**
- Fixed: typing in the vital-sign boxes of the nursing chart removed every digit.

**9 Oct 2026 (later) – nurse services to billing, a nurse's Today, Appearance with themes**
- **Services nurses give** (`/api/hospital/nursing-services`): on a patient (her stay's Services tab, or Today → Record a
  service) the nurse picks injections, dressings, IV drips … from the price list (`config.nursing.serviceGroups`) with
  how many; it is **sent to the front desk** (reception and billing are notified). Charting an IM / IV / SC dose offers
  its injection charge (`injectionPriceCode`). Billing → **Nursing services**: "Add to bill" puts it on her open bill or a
  new one (lines marked `source: 'nursing'` with the NS- number), once only; a waiting one can be cancelled by its nurse.
- **A nurse's Today**: shift and ward, six count tiles, **Due now** (every dose and task due or overdue, opening the chart),
  **Needs attention**, and **My services today**. Others keep their Today; reception's shows services waiting to bill.
- **Appearance**: Theme (Light, Dark, Match device), Text size and Spacing as compact choices with a live preview. The dark
  theme is in `styles/tokens.css` (`:root[data-theme='dark']`); printouts stay black on white.

**9 Oct 2026 (evening) – the lab's overview and sample tracking, theme in the top bar**
- **Lab staff's Today** (Laboratory overview): new test requests, samples pending (and on the way from the ward), tests in
  progress, results awaiting the doctor's verification – each opens its Lab tab; urgent orders first in Pending lab work.
- **Lab** has a tab per step: Requests · Sample tracking · In progress · Awaiting verification · Finalized · Cancelled.
- **Sample tracking** (`labOrder.model.js`): a taken sample gets a number (`lab.samplePrefix`, S-) and its kinds from the
  test list; taken on the ward it is "on its way" until the lab marks it **received**; **Start test**; **Reject sample**
  (with the reason) sends the order back for a new sample and tells the doctors (and the nurses, if she is in hospital);
  **Ask the doctor** sends a question without changing the order. Entering results tells the ordering doctor and her
  doctor ("outside range" in the title). Lab staff cannot verify: the doctor or RMO marks results reviewed (final).
- **Theme**: the sun / moon button beside the bell (Light, Dark, Match device); My settings keeps text size and spacing.
- The active menu item is a white tile with an indigo icon (no light green); the nurse tiles use indigo too.

**9 Oct 2026 (night) – the doctor's desk, a fuller lab overview**
- **Doctors and RMOs' Today** (`/api/hospital/doctor-desk`): Patients under care, Reviews due, Reports to review, Pending
  tasks; **My patients** in hospital (bed, ward, diagnosis from the admission note, allergies, round due, alerts) beside
  **Clinical alerts** (red flags of the approved rules, results outside range not reviewed, doses not given in 24 hours,
  rejected samples, the lab's questions); **Ward rounds** (Write round note opens a new round note) beside **Pending
  reviews** (lab reports, ward documents to sign, OPD visits to sign); OPD today. An RMO sees everyone in hospital.
- The round note also holds **Follow-up plan** and **Handover**.
- The lab overview is full width row by row (no empty columns); the sidebar's colour runs the whole page height.

**9 Oct 2026 (late) – theme toggle, curved sidebar, pharmacist's Today, all prescriptions given**
- **Theme**: the sun / moon button beside the bell switches light ↔ dark in one click (no menu; two themes).
- **Sidebar**: a rounded panel with a small gap from the window's edges. The sign-in page uses the indigo theme (no
  light green).
- **Lab** staff are notified of every new request – ordered by a doctor or booked by reception ("URGENT –" first).
- **New patient by voice** asks the date of birth (spoken years understood, e.g. "nineteen ninety five") and shows the
  age; it asks the age only when the date of birth is not known.
- **Today, general** (reception, billing): quick actions in one row, what needs attention across the page; "Nursing
  services to bill" is under Billing; the billing desk's cards side by side share one height.
- **Pharmacists' Today**: prescriptions waiting / given today, sales, low stock, expiring and expired; quick actions;
  Waiting beside Given today; Running low beside Expiring.
- **Pharmacy → Prescriptions**: Waiting · Given today · **All given** (every prescription given, by patient name or
  number and dates, a page at a time – `GET /api/hospital/pharmacy/prescriptions/history`).

**9 Oct 2026 (later still) – sign-in reliability, floor tags, nurse page heights**
- The first sign-in sometimes did nothing and pages sometimes said "try again" until refreshed: the development website
  found new libraries late (pages load on demand) and reloaded itself; and a request during a server restart got no
  answer. Now `client/vite.config.js` prepares every page at start-up (`optimizeDeps`), and `api/http.js` quietly sends a
  reading (and a sign-in) again after 0.4 s and 1.2 s when the server could not be reached – a change is never sent twice.
- Beds show their floor as a small tag (`components/FloorTag.jsx`) on Booked beds, the nursing station, a nurse's Today and
  the doctor's desk. A nurse's Today: both sides end together; long lists scroll inside their card.

**9 Oct 2026 (evening) – motion and feedback across the website (plain CSS, no new library)**
- `styles/motion.css` (timings in `tokens.css`: `--motion-fast`, `--motion`, `--motion-page`): pages fade in and rise a
  little; clickable cards lift on hover; buttons ease and press in; pop-ups and menus fade and scale open; the active
  menu item has a marker; error messages fade in; loading shows shimmering placeholder lines (`Loader`).
- Dashboard numbers count up once (`components/CountUp.jsx`; plain whole numbers only; the real number always shows
  within a second, also in a background tab).
- Small slide-in notices (`components/Toast.jsx`, `toast('…')`) for payments, uploads, charting, orders, nursing
  services and the profile photo. Clinical warnings are never toasts and never flash.
- Everything stops moving when the device asks for reduced motion.

**9 Oct 2026 (night) – printed papers as the hospital's own forms, with its logo**
- **Logo**: Hospital admin → Print letterhead → Upload logo (shrunk in the browser, PNG kept transparent; checked by
  its bytes; `hospital_logos`, `hospital.logoVersion`). Every letterhead carries `logoVersion`; prints load
  `GET /api/hospital/logo`.
- **Letterhead** (`print/PrintFrame.jsx`): a ruled box – logo left, the name large in capitals, address, "Mob." and
  "E-mail" lines – and the paper's name in a dark band (`DocTitle`). Name, address, phones and e-mail come from the
  letterhead settings: nothing about a hospital is written in the code.
- **Discharge card** (A4), as the hospital's printed form: Name, Age / Sex, Consultant, D.O.A., D.O.D., Room No.,
  Reg. No., IPD No.; Diagnosis · History / complaints · O/E · Course in the hospital · Surgery / procedure ·
  Investigation · Blood investigation (report – the lab results of the stay, `labResults`) · Condition at discharge ·
  Advice / suggested investigations | Advice on discharge (medicines) · Follow-up with the notes; signatures.
- **Bills** (and the pharmacy's prescription bill): A4 with the same letterhead and band, ruled tables.

### Who sees what (config.access)

| Role | Menu |
| --- | --- |
| Hospital admin | Today, Billing (all tabs), Pharmacy (no counter), Analytics (small numbers hidden), Hospital admin, My settings – no patient records |
| Doctor | Today, Patients (own patients full, others read-only, emergency access), Appointments (book, own OPD timings), Calendar (with EDD / LMP), Lab (order and review for own patients), Analytics (exact, "my patients"), Clinic library (change and approve), My settings |
| RMO | Today, Patients (all records), Appointments (look, mark seen), Calendar (with EDD / LMP), Lab (order and review), Clinic library (change, not approve), My settings |
| Nurse | Today (My ward now), **Nursing station**, Patients (read), Appointments (look, mark seen), Lab (read results, mark a sample as taken – `access.labCollect`), Clinic library (read; no prescription sets), My settings; on a stay: charts doses, IV fluids, care tasks, vital signs, intake/output, notes and the handover – never writes or changes an order |
| Receptionist | Today, Patients (register, contact details, emergency contact, ID proof type + last 4), New registration, Appointments (book, move, cancel, walk-ins), Calendar (bookings only; reminders), Billing (no Monthly / Settings), My settings |
| Lab staff | Today, Patients (name and number), Lab (take samples, enter and amend results – patients by name and number only), My settings |
| Pharmacist | Today, Patients (contact), Pharmacy (everything but its settings), My settings |
| Billing (7 Oct 2026) | Today, Patients (contact, read-only), Billing (bills, payments, unpaid, daily summary, Monthly and the export; not the price list changes or Settings), My settings – shares billing with reception |
| Super admin | The platform; can open any hospital with every role (`access.superAdminInHospitals`), including patient records (`access.superAdminPatientAccess` – the owner's choice; every record opened is in the audit log). Switch either off in `config/local.json`. |

Passwords: at least 8 characters with a capital letter, a small letter, a number and a special character
(`auth.password` in config).

### Module 2 – how it works

- The session (JWT) carries the hospital the person works in. Every hospital address takes the hospital from the
  session, never from the web address, and checks the person's access to it again on every request. The browser
  sends `X-Hospital-Id`; if another tab switched hospital, the request is refused (409) and the page reloads.
- Staff, the audit log and the overview reuse module 1's services, always limited to the session's hospital.
- Hospital-owned collections use the `hospitalScoped` plugin (`server/src/db/hospitalScoped.js`): any query or
  aggregate without a `hospitalId` is refused. OPD timings are the first such collection.
- A hospital admin cannot change their own access or roles, and a hospital always keeps one active admin.
- The hospital's settings are never part of the super admin's views.

## Run it

Needs Node LTS and MongoDB running on this computer (the Windows "MongoDB" service). The project uses its own
database, `perinexa1`.

```bash
npm install
npm run seed     # first super admin + starting master data (safe to run again)
npm run dev      # website http://localhost:5174 · API http://127.0.0.1:5000/api
```

First login: the email and password under `seed.superAdmin` in `config/local.json`. The app then asks for a new password.

Other commands: `npm run build` (website build), `npm run db:evaluate` (checks that every main query uses an index).

## Settings – `config/`, no .env file

| File | In git | Holds |
| --- | --- | --- |
| `config/default.json` | yes | every setting: ports, database, session time, password rules, pagination sizes, roles, master-data lists, dashboard sizes, starting data |
| `config/local.json` | **no** | secrets and this computer's overrides (`auth.jwtSecret`, `seed.superAdmin`) – copy `local.example.json` |
| `config/loadConfig.js` | yes | merges the two (local wins) |

The server checks all settings at start-up (`server/src/config/index.js`) and stops with a clear message if one is
wrong. The website gets the non-secret ones from `GET /api/meta`, so nothing is repeated in its code.
Production: set `auth.cookieSecure` to `true` (HTTPS) in that server's `config/local.json`.

## Folder structure

```
config/                     settings (see above)
server/
  scripts/                  seed.js, evaluate-queries.js
  src/
    index.js, app.js        start-up; app.js mounts every module from modules/index.js
    config/                 reads and checks config/*.json
    core/                   shared: pagination, aggregate stages, validation, password, session (JWT), errors
    db/                     connection, query timer (slow-query warnings)
    middleware/             auth guards, rate limits, error handler
    modules/
      index.js              the list of modules: path + who may call it + router
      <module>/
        <name>.model.js       Mongoose schema and indexes
        <name>.validation.js  what the browser may send (zod)
        <name>.service.js     the work: list (aggregate) / get / create / update / status
        <name>.controller.js  reads the request, calls the service, sends the answer
        <name>.routes.js      the module's addresses only
client/src/
  api/                      http.js (one fetch wrapper), resource.js (standard CRUD calls), index.js (one entry per module)
  context/                  app settings (from /api/meta), login session
  hooks/                    usePagedList, useForm, useOptions, useIdleLogout
  components/
    form/                   FormBuilder, FormField, FormModal – every form
    list/                   ListPanel = ListToolbar + DataTable + Pagination – every list
  forms/                    each form described as data (fields, empty values)
  config/navigation.js      the menu
  layout/, routes/, pages/<module>/, styles/ (tokens.css holds every colour)
```

## How the main admin module works

- **Login** (same rules as Perinexa): no sign-up; JWT in an httpOnly, sameSite=strict cookie; bcrypt; temporary
  password must be changed at first login; 30 minutes without activity logs out (website and server); 10 failed
  tries in 15 minutes are blocked; logout and password change end the session on the server (`tokenVersion`);
  every attempt is in the audit log.
- **Accounts**: the super admin creates hospitals (optionally with the first hospital admin), super admins and staff.
  New accounts get a temporary password shown once. Accounts, hospitals, staff access and master data are
  deactivated, never deleted. There is always at least one active super admin and one admin per hospital.
- **Main super admin**: the first super admin (made by the seed, `isPrimary`) is protected – nobody else can edit,
  deactivate or reset it. Only the main super admin creates super admins or changes other super admin accounts;
  every super admin can manage hospitals and staff.
- **Lists**: every list is one aggregate – `$match` → `$sort` → `$facet` (the page + the total) – with joins
  (`$lookup`) only for the rows on the page (`server/src/core/pagination.js`).
- **Consolidated views**: the dashboard (platform totals, staff by role, largest hospitals, master data, recent
  activity), a hospital with its departments and staff per role, and each user with all their hospitals and roles.
- **Master data**: one collection for every list; the lists are named in `config.masterData.types`.

## Add the next module

1. `server/src/modules/<name>/` with model, validation, service, controller, routes (copy `masterData/`).
2. One line in `server/src/modules/index.js` (path, access, router).
3. One entry in `client/src/api/index.js` (usually `createResource('/<path>')`).
4. A field list in `client/src/forms/`, a page in `client/src/pages/<name>/` using `ListPanel` and `FormModal`.
5. A menu line in `client/src/config/navigation.js` and a route in `client/src/App.jsx`.
6. New audit events in `server/src/modules/audit/audit.actions.js`; new indexes checked with `npm run db:evaluate`.
