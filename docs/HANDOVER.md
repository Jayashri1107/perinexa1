# Handover for the developer

Written on 5 Oct 2026 for the developer who takes Perinexa from a test app with fake data to a commercial product.
The owner's step-by-step plan, with the timeline and the go-live checklist, is the "Perinexa Handover Plan" page they
share with you. This document is the technical side: what exists, how to run it, what to look at first, and what the
owner has decided. Read it with `CLAUDE.md` (project rules, read by Claude automatically) and `README.md`.

## 1. What Perinexa is

A web app for obstetrics and gynaecology hospitals and clinics in India, used by several hospitals from one
installation (multi-tenant). MERN: MongoDB, Express 5, React with Vite, Node (24.x used so far).

- **Who uses it.** A platform **super admin** creates hospitals and accounts and never sees patient data. In each
  hospital a person has one or more roles: `admin`, `doctor`, `rmo`, `nurse`, `receptionist`, `lab`, `pharmacist`
  (`server/src/models/Membership.js`). One person can work at several hospitals and switches between them.
- **What it does.** Patient registration (with an already-registered warning and duplicate records), appointments and
  OPD tokens, visits and prescriptions (dose, stock, breastfeeding and newborn checks; prescription sets; PDF and
  WhatsApp), care plans per type of care (antenatal, postnatal, newborn, gynaecology, infertility, pregnancy loss)
  with risk levels and red flags, a daily worklist, inpatient stays (documents, nursing chart, discharge), a lab
  module, scans and procedures, consent forms, billing (insurance and PM-JAY claim sheets, UPI link), a pharmacy
  (stock, purchases, purchase orders, returns to suppliers, GST e-invoice file, H1 / X / narcotic registers), ABDM
  (ABHA M1, sharing records M2, fetching records M3 – practice mode), a patient portal, reminders (SMS / WhatsApp
  outbox), AI features (OpenAI), analytics and a monthly report, voice entry (on-device), Marathi and Hindi printouts
  for patients, an audit log, and a server-operator export of one hospital's data.
- **More detail.** `docs/FEATURES.md` (feature list), `docs/USE_CASE.md` (the owner's interview), `docs/PROGRESS.md`
  (everything built, in order, with "How to test" sections at the end – long; ask Claude to summarise a part).

## 2. Where things stand (5 Oct 2026)

- **Size and age.** About 100,000 lines of JavaScript (server ≈ 44,000, website ≈ 56,000, tests not counted), 39
  Mongoose models, built with Claude Code in 9 days (27 Sep to 5 Oct 2026) by a non-technical owner.
- **Tests.** Server 62 files / 1,351 tests, website 85 files / 1,944 tests, all passing on main (385ab1f). The build
  works. There is no linter or formatter.
- **Never reviewed by an experienced developer.** That review is your first job (the plan calls it the health check).
  Until it is done and the go-live checklist is complete: fake data only.
- **Not deployed.** It runs only on the owner's Mac. There is no hosting, CI, backup, monitoring or release process.
- **Feature freeze** since 5 Oct 2026, until your health check is done and you and the owner have agreed what the first
  commercial version contains.
- **DRAFT clinical content** waits for the owner's review (section 10). **Outside services** are off or in practice mode
  (section 8).

## 3. Run it on your computer

You need Node LTS, npm, git and MongoDB Community Server (`mongod` on your PATH).

```bash
npm install
cp server/.env.example server/.env   # then fill in JWT_SECRET, SUPER_ADMIN_*, DEMO_PASSWORD
npm run seed                         # the first super admin
the demo script (removed 12 Oct 2026)                    # fake demo hospitals, staff and patients
npm run dev                          # http://localhost:5173 (API on :4000, Vite proxies /api)
```

`npm run dev` first starts a local `mongod` (data in `./.mongo-data`, listening on 127.0.0.1:27017 only;
`scripts/db.mjs`). `npm run db:stop` stops it. On the owner's Mac, `Start Perinexa.command` runs `npm run dev` in
the Mac's Terminal. The owner's `docs/TEST_ACCOUNTS.md` and `server/.env` stay on their Mac and are never in git:
make your own with your own passwords.

## 4. Tests – read this before you run any

- Run them from the repository root with `npm test` (server first, then website). The server tests take their
  database from `server/vitest.config.js`: a throw-away `perinexa_test`, or `PERINEXA_TEST_DB` when two copies run at
  the same time. `server/tests/helpers.js` refuses any name that does not end in `_test`.
- **Never run a server test file without that config** (for example `npx vitest` from another folder). On 28 Sep 2026
  that happened once: the helpers connected to the development database from `server/.env` and dropped it.
- One test run per database at a time; two runs on the same database clear each other's data. The analytics
  performance tests are skipped unless switched on.
- The website tests read `server/src/models/AuditLog.js` to check that every audit event has a plain name in
  `client/src/components/auditFormat.js`: a new server event needs a label there and in the copied list in
  `auditFormat.test.js`.

## 5. Code map

```
server/src/
  app.js              Express setup: helmet, CORS (CLIENT_URL only), rate limits, routers
  index.js            Start-up and the background timers (reminders, ABDM expiry)
  config.js           Settings from server/.env, checked with zod
  middleware/auth.js  Session cookie, inactivity timeout, roles, the selected hospital
  routes/             One router per area (48 files)
  models/             39 Mongoose models
  utils/              audit.js, auditDetails.js, patientAccess.js, tenantScope.js, pcpndt.js, storedFiles.js, validate.js …
  abdm/ ai/ analytics/ appointments/ billing/ calendar/ careplans/ consents/ inpatient/ lab/ medsafety/
  patients/ pharmacy/ redflags/ reminders/ reports/ visits/      domain logic per area
server/scripts/       seed.js, seed-demo.js, export-hospital.js
server/tests/         API tests (vitest + supertest)
client/src/
  App.jsx, main.jsx   Routes and start-up
  api.js              The one fetch wrapper (cookie, errors, hospital mismatch)
  auth/               Session state, protected pages, 30-minute inactivity logout
  platform/modules.js Navigation per role (same role lists as the server)
  pages/<area>/       Screens; *Format.js files hold the wording and are unit-tested
  components/         Shared UI, print preview and PDF (print/), the audit log
  styles/             tokens.css holds every colour and size (rules in docs/BRAND.md)
scripts/db.mjs        Local MongoDB start / stop
```

## 6. Security and privacy model – review this first

- **Sign-in.** JWT in an `httpOnly`, `sameSite=strict` cookie (`secure` in production), bcrypt, no public sign-up,
  password change at first sign-in, 30 minutes of inactivity ends the session (browser and server), rate limits on
  sign-in, the portal sign-in and the whole API.
- **Hospital separation.** Hospital data carries a `tenantId`. The `tenantScoped` plugin (`utils/tenantScope.js`)
  refuses find / update / delete queries that do not name the hospital. It does **not** cover `aggregate()` (used in
  about 15 server files) or direct `collection` calls: check those by hand. This is the most important review item.
- **Need-to-know access to a record.** `utils/patientAccess.js`: a doctor's own patients, sensitive records, read-only
  access, emergency access with a written reason, what each role may see.
- **Audit log.** `utils/audit.js` writes, `models/AuditLog.js` blocks edits and deletes through Mongoose only (not at
  database level), `utils/auditDetails.js` trims what each reader sees: never medical details, and the super admin's
  log never shows which patient. Plain names in `client/src/components/auditFormat.js`.
- **Rules required by law or chosen for safety** (keep them): no recording or showing of the baby's sex before birth
  (PC-PNDT Act: `server/src/utils/pcpndt.js`, `client/src/pcpndtWords.js`, also stripped from voice entry); HIV tests
  shown and printed under a neutral name; staff are deactivated, never deleted; password hashes are never returned.
- **Files** (lab reports, scanned consent forms) are stored inside MongoDB (`StoredFile`, `utils/storedFiles.js`).
- **Taking data out.** `npm run export:hospital` writes one hospital's data to an unencrypted folder (README.md).

## 7. Parts that assume a single server

Fine for the first hospitals on one server. Running several copies needs changes first.

- Background timers in `server/src/index.js` (`setInterval` for reminders and ABDM expiry): every copy would run them.
- ABDM transactions kept in memory: `server/src/abdm/abdmService.js`, `server/src/abdm/practiceClient.js`, and the
  (no longer the patient portal: its sign-up and sign-in steps are kept in the database since 16 Oct 2026).
- Throttles and caches in memory: `careplans/templatesService.js`, `careplans/plansService.js`, the analytics caches,
  `analytics/auditThrottle.js`.
- `express-rate-limit` with its default in-memory store (`app.js`, `routes/auth.js`, `routes/portal.js`).

## 8. Outside services

All are off or in practice mode by default; the switches are in `server/.env` (see `server/.env.example`).

| Service | Used for | Default | Before real use |
| --- | --- | --- | --- |
| OpenAI | AI features (visit summary, letters, report reading, ask the records …) | off (empty `OPENAI_API_KEY`) | data agreement; data may be processed outside India (`docs/AI_PROVIDERS.md`) |
| Twilio | SMS / WhatsApp reminders | outbox, staff send by hand (empty `REMINDER_PROVIDER`) | DLT registration for SMS; approved WhatsApp templates |
| Meta WhatsApp Business | prescription / visit summary to the patient in one click | off (empty `WHATSAPP_MODE`; `practice` sends nothing) | approved template; documents pass through Meta's servers |
| ABDM | ABHA (M1), sharing (M2), fetching (M3) | `ABDM_MODE=practice` (built-in stand-in) | sandbox testing, then NHA certification for production |

The patient portal is off for each hospital until its hospital admin turns it on (`messaging.portalEnabled` on the
hospital, `server/src/routes/reminderOutbox.js`).

## 9. Decisions the owner has made

The owner is a doctor, not a software person. Ask them before changing any of these.

- **The owner approves all clinical content** (care-plan templates, risk and red-flag rules, the medicine safety list,
  lab ranges, consent forms). Anything not approved stays marked DRAFT on screen and on paper.
- **No MTP or PC-PNDT registers, no Form F** (2 Oct 2026). The "Abortion" type of care is only for pregnancy loss
  outside the MTP Act (spontaneous, recurrent, ectopic, molar). A threatened miscarriage stays under Antenatal; a loss
  at 28 w 0 d or later is a delivery; recurrent loss means 2 or more losses. The fetal-sex protection is separate and
  stays.
- **Voice entry uses Chrome's on-device speech only** (no online service). Chrome has one English model (en-US);
  `client/src/pages/patients/indianEnglish.js` corrects common mishearings.
- **AI provider: OpenAI** (chosen 30 Sep 2026). The owner puts the key in `server/.env` themselves.
- **Look and wording** follow `docs/BRAND.md`: colours only from `tokens.css`, a status is colour + icon + word, one
  primary button per screen, no exclamation marks or emoji, plain doctor-to-doctor wording.
- **Super admin and platform admin (Perinexa1, 12 Oct 2026).** The first super admin is created on the first start
  (no password in a settings file). A super admin may open any hospital and work there with every role, patient records
  included (each record opened is in that hospital's audit log) – a deliberate change from "the super admin never sees
  patient data". Platform admins see the same and change only what the super admin ticked (Users & access → User
  permissions). Hospital admins reset passwords, remove access, change roles or edit staff details only with the super
  admin's permission; new people are added by the super admin. Review this before real patient data.
- **Feature freeze lifted for the lab module (17 Oct 2026)** to build a full lab system (sample numbers and labels,
  the hospital's test list and ranges, printed report, check before the report, outside labs, Find, register) –
  `docs/LAB_LIMS_PLAN.md`. The freeze stays for everything else.
- **Feature freeze lifted for WhatsApp at the desk (17 Oct 2026)**: OTP on WhatsApp with SMS fallback, appointment,
  bill and reviewed lab-report messages, queue time, daily cash handover – `docs/WHATSAPP_DESK_PLAN.md`. The hospital's
  WhatsApp number: +91 88880 24000.
- **Fake data only.** Test patient P-000003 in "Sunrise General Hospital (Demo)" is fake but uses the owner's own phone
  number and address: never copy those anywhere shared.

## 10. DRAFT content waiting for the owner's review

- Care-plan templates: antenatal (50 items) and the postnatal, newborn, gynaecology, infertility and pregnancy-loss
  templates; the 25 decisions in `docs/CARE_PLAN_DECISIONS.md`.
- Risk rules (`docs/RISK_RULES_RESEARCH.md`), red-flag rules, the medicine safety list, prescription sets, test packages.
- Lab usual ranges (adult; the newborn values need a paediatrician).
- Consent forms and their translations (`docs/CONSENT_FORMS.md`); Marathi and Hindi wording
  (`docs/TRANSLATIONS_TO_CHECK.md`).

## 11. Working with Claude on this project

- `CLAUDE.md` is read automatically. It holds the owner's rules and a section for you.
- **No `npx`** for tools that are not installed: it downloads them silently. Check code with `npm run build` and
  `npm test`.
- **Claude Code's auto mode blocks `git push`** (it treats it as sending data out). Push yourself, or add a narrow
  permission rule in your own settings.
- **Parallel sessions**: commit only your own files (`git add <files>`, not `-A`), and one test run per database.
- **The Claude desktop browser pane** has no microphone and no on-device speech, so voice entry must be tried in
  Google Chrome; it cannot print either – check printouts with Download PDF or headless Chrome. Screens can be looked
  at without signing in by answering the app's `/api` calls with fake data in the page.
- **The owner's dev server** should run from `Start Perinexa.command`, not Claude's terminal pane (it stops when the
  app reloads).

## 12. Repository

- Private GitHub repository `girishsolanke/perinexa`, owned by the owner. `main` is the only branch; the parallel work
  lanes were combined into it and removed on 5 Oct 2026. Tags `done-*` mark finished pieces of work.
- Commit messages describe what changed for the people using the app, in plain words.
- `docs/` – plans and decisions per area (`*_PLAN.md`), the brand (`BRAND.md`), prescriptions (`PRESCRIPTIONS.md`),
  voice entry (`VOICE_ENTRY_TEST.md`), the care-plan specification (`CARE_PLAN_SPEC.md`), and the progress notes.

## 13. Your first week

Set it up on your computer, run all tests, then write the health check into `docs/HEALTH_CHECK.md`: security (start
with sections 6 and 7), privacy under India's DPDP Act 2023, reliability, speed with large amounts of fake data, code
quality and what is missing to run it live. Rank each finding by risk with an estimate in days, and end with a
half-page summary in plain words for the owner. Change no code before that is done.
