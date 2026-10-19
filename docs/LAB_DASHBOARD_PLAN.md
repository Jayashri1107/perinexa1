# The lab as eLabAssist lays it out – plan and decisions (owner, 19 Oct 2026)

Branch `lab-dash`. The owner asked for the lab's modules and screens to work as in eLabAssist (public screenshots and
product pages), in Perinexa's own look (`docs/BRAND.md`). Most of the workflow already existed (`docs/LAB_LIMS_PLAN.md`,
`docs/LAB_V2_PLAN.md`); this adds how it is laid out. All test data is fake.

## What was built

1. **Lab dashboard** (`/lab/dashboard`; the Lab item in the menu opens it for lab staff):
   - every lab module as a button – Registration, Sample collection, Sample receiving, Result entry, Authorisation,
     Reports, Home collection, Outside labs, Find, Lab register, Quality control, Stock, Test master, Referrers, Cash,
     Settings – with what waits there;
   - for lab staff, for today / the last 7 days / this month: registered (orders, patients, walk-in), tests, reported,
     charged; tests and charges by department (bars); waiting now at each step and orders past their due time.
   - Numbers only – no patient, no test names. Doctors, RMOs and nurses see the module buttons (counts of the patients
     they may see) and keep the worklist as their Lab page.
2. **Registration on one screen** (`/lab/new`, lab staff): 1 patient (find or register), 2 referral (referrer,
   prescription, note, urgent), 3 tests (search, add several, each with department and price), 4 sample (taken now at
   the counter – sample number at once, received in the lab; to take later; collect at home), 5 bill (total, discount
   with a reason, payment, balance) → **Save and print receipt**.
   - The discount is given only when the order's bill has nothing else on it; with other charges on her bill today it
     belongs to the billing desk (which sees the whole bill). Audit: "Discount given".
3. **Status tracker** on every lab order: Registered → Sample taken → Received in lab → Results entered → Checked (when
   the hospital checks results) → Reported → Seen by doctor (not for a walk-in), each with who and when.
4. **Result entry by department** (`/lab/results`): the samples received in one department, each with its values in
   rows (value, unit, usual range, flag); Save each sample; Report (or Send for checking) once every test of the sample
   has a result. The flag is left to the server unless someone chooses it, so it uses **her** usual range (age,
   pregnancy) – the screen shows the general range.

The tabs at the top of the lab pages now start with Dashboard, Worklist, Result entry. The main sidebar is unchanged
(no pages under any item – owner, 19 Oct 2026).

5. **QC, Stock, Tests and Referrers laid out properly** (owner, 19 Oct 2026): each as a table with aligned columns,
   search and pages (10, 25 or 50 rows); the Add button at the top right; adding, changing, receiving a batch, counting
   or writing off, the QC chart and the corrective action in dialogs instead of forms always open on the page. QC:
   today's value is typed on the lot's row. Stock: items and batches in two tables. Tests: by department, with search.

## Later (not built)
- Several branches and collection centres (a filter on the dashboard).
- Test-wise and referrer-wise income reports; a daily trend chart.
- A patient app with her report history (the patient portal covers part of it).

Code: `server/src/routes/lab.js` (`GET /api/lab/dashboard`; `POST /api/lab/walk-in` takes `discount` and
`collectNow`); website `pages/lab/LabDashboardPage.jsx`, `LabRegistrationPage.jsx`, `LabResultsPage.jsx`,
`OrderTracker.jsx`, `styles/layout.css`. The old walk-in pop-up was replaced by the registration screen.
Tests: `server/tests/lab-dashboard.test.js`, `client/src/pages/lab/orderTracker.test.js`, `client/src/platform/modules.test.js`.
