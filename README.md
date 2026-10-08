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

### Who sees what (config.access)

| Role | Menu |
| --- | --- |
| Hospital admin | Today, Billing (all tabs), Pharmacy (no counter), Analytics (small numbers hidden), Hospital admin, My settings – no patient records |
| Doctor | Today, Patients (own patients full, others read-only, emergency access), Appointments (book, own OPD timings), Calendar (with EDD / LMP), Lab (order and review for own patients), Analytics (exact, "my patients"), Clinic library (change and approve), My settings |
| RMO | Today, Patients (all records), Appointments (look, mark seen), Calendar (with EDD / LMP), Lab (order and review), Clinic library (change, not approve), My settings |
| Nurse | Today, Patients (read), Appointments (look, mark seen), Lab (read results), Clinic library (read; no prescription sets), My settings |
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
