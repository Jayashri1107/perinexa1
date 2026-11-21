# Health check – perinexa1 (16 Nov 2026)

The developer's health check required by `CLAUDE.md` before the first commercial version. Code reviewed: `master` at
`cea36e29` (the same as `main` plus the deploy backup step). Live site checked from outside: https://app.perinexa.com.

**How it was done.** Read-only review of `server/src` (about 425 files, 80,000 lines), `deploy/` and the CI file, in
four parts: hospital separation, route access control, sign-in / input / files, and audit log / legal rules /
operations / dependencies (`npm audit --omit=dev`). The findings marked **verified** were re-read in the code before
they were written here; the others were found by reading, and are marked *plausible* where the effect was not
reproduced. Nothing was tested against a running server, and this is not a penetration test – the outside security
test (VAPT) is still needed. The client (`client/src`) was looked at only where the server depends on it.

**Status per finding:** Open · Fixed · Owner decides · Accepted (with the owner's written OK).

## Summary

| | High | Medium | Low |
| --- | --- | --- | --- |
| Count | 4 | 11 | 20 |
| Need the owner's decision | H3 | M6, M7, M9 | L4, L5, L12 |

Before real patients: all High items closed, every Medium item fixed or accepted in writing by the owner.

**Status on 21 Nov 2026** (headings below brought in line with the notes under them): High – H2, H3, H4 done; H1 partly
(M10 in use, restore test to do). Medium – all fixed, decided or reduced, except M9 (owner decides before AI is on).
Low – L3 fixed 21 Nov 2026; L2, L14 and part of L20 open. The website code and the ABDM callbacks, "Not covered"
below, were reviewed on 21 Nov 2026: `docs/REVIEW_2026-11-21.md`.

From outside the live site is in good shape: HTTPS with a Let's Encrypt certificate (renewed by Caddy), `http://`
redirected, HSTS, a Content-Security-Policy, X-Frame-Options, nosniff, a strict referrer policy, every data route
answers 401 without a session, and ports 22, 4000 and 27017 are closed to the internet.

## High

**H1 – No scheduled backup, and no backup off the server.** Partly fixed 21 Nov 2026: the live `MONGO_URI` points at the owner's paid Atlas M10 cluster (checked by the owner on the server). Still to do: confirm Cloud Backup and Continuous Cloud Backup are on, and one restore to a temporary cluster with the time written down (`docs/RUNBOOK.md`).
The database is on Atlas M0 (no backups). `deploy.sh` now saves a `mongodump` before each deploy
(`deploy/db-backup-lib.sh`), but only when someone deploys, unencrypted, on the same disk. A week without a deploy and
a lost cluster or disk means a week (or everything) lost.
*Fix:* Atlas M10 with Cloud Backup and Continuous Cloud Backup, a backup policy, one restore to a temporary cluster
with the time written down (`docs/DEPLOY_AWS.md` sections 4 and 9). Encrypted EBS volume for the deploy copies.

**H2 – Vulnerable production dependencies** (`npm audit --omit=dev`: 3 high, 2 moderate, all with fixes). Fixed 16 Nov 2026 (`npm audit --omit=dev` on 21 Nov 2026: 0 vulnerabilities).
- `body-parser` 2.3.0 – denial of service through compressed bodies (GHSA-27r3-jxmh-p828). `express.json` inflates by
  default and runs before sign-in (`server/src/app.js:164`), so anyone can send one.
- `mongoose` 9.10.2 – four advisories incl. `sanitizeFilter` not applied and prototype pollution; fixed in 9.12.1.
- `zod` 4.6.5 – memory exhaustion (GHSA-mrhx-c7xc-m3w5); fixed in 4.6.6+.
- Moderate: `qs` 6.16.0, `ip-address` 10.7.2.
*Fix:* update within the existing ranges (no new dependency), `npm test`, `npm run build`, one server start.
**Fixed 16 Nov 2026** (`d65467a0`, `98365b6d`): body-parser 2.4.0, mongoose 9.12.1, zod 4.6.7, qs 6.17.1, ip-address
10.7.6; the build and test tools too (vite 8.3.8, vitest 5.1.0, concurrently 10.0.7). `npm audit` finds 0 in all
packages. Only `package-lock.json` changed.

**H3 – Platform users can read patient records inside a hospital.** Owner decided 17 Nov 2026 (support access, below). **Verified.**
`server/src/middleware/auth.js` `platformMembership` gives a platform user every hospital role, and
`platformHospitalGuard` lets a super admin do everything in a hospital and a platform admin read everything there
(`GET /api/patients`, `/:id`, notes, record copy, lab …). This follows the owner's decision of 12 Oct 2026
(`docs/HANDOVER.md` section 9; every record opened is in the hospital's audit log), but `CLAUDE.md` lists "the super
admin never seeing patient data" as never-weaken. Also inconsistent:
- the comments at `auth.js:43-44` and `routes/auth.js:290` still say "never patients";
- the 24 Oct decision limits the patient list to super admins, yet a platform admin can list patients through
  `/api/patients`;
- `analytics/roles.js:28-29` blocks the super admin from analytics lists, but a platform admin gets the doctor
  audience (`/api/analytics/list`), against the 10 Nov "numbers only" decision.
*Needed:* the owner chooses, in writing, between (a) no patient data for platform users (remove the reads, keep the
setup paths) and (b) the 12 Oct decision, with `CLAUDE.md` changed to match. Either way the comments and the platform
admin's reach are made consistent with the choice.
**Owner's decision, 17 Nov 2026 (given in a Claude chat; please confirm with the owner): a third option – only with the
hospital's consent.** Built on branch `owner-decisions-1117`: a platform user reaches a hospital's setup and staff, and
its patients, bills, pharmacy, lab and analytics lists only while that hospital's own admin allows **support access**
(Hospital admin → Support access: a reason, 2 / 8 / 24 / 72 hours, ended early at any time; `SUPPORT_ACCESS_GRANTED` /
`_ENDED` in its audit log). Platform → Patients and the hospital view's patient list show only hospitals with it open.
During it the 12 Oct rules apply (super admin like staff, platform admin reads). `platformHospitalGuard`,
`utils/platformAccess.js`, `tests/support-access.test.js`; `CLAUDE.md` and handover section 9 changed to match.

**H4 – No two-step sign-in for staff.** Fixed 17 and 20 Nov 2026 (below).
No TOTP or other second factor anywhere in `server/src`. With H3 as it stands, one phished super-admin password opens
every hospital's records.
*Fix:* TOTP (authenticator app) required for super admin, platform admins and hospital admins, offered to everyone.
Needs the developer's and owner's agreement on the library (a new dependency).
**Built 17 Nov 2026 (branch `owner-decisions-1117`; the owner chose an authenticator app over SMS):** RFC 6238 with
Node's own crypto – no new dependency (`server/src/auth/totp.js`, checked against the RFC's test values). Required for
super admins, platform admins and hospital admins when `TWO_STEP_FOR_ADMINS` is on – the default on the live server –
so **each of them sets up an authenticator app at their next sign-in after the deploy**. Anyone else may turn it on under
My settings → Security. Secret encrypted (key from `JWT_SECRET`), 8 recovery codes as hashes, a code works once, its
own 3-try lock; "Switch back to super admin" asks the code too; the super admin resets it for a lost phone (user page).
Changing `JWT_SECRET` leaves only the recovery codes working for those who had it on. `tests/two-step.test.js`.
**Changed 20 Nov 2026 (the developer, with the owner's agreement of 20 Nov 2026):** required for the super admin and
platform admins only. Hospital admins found typing the code at every sign-in too much; like all other staff they may turn
it on under My settings → Security, and those who already set it up keep it until they turn it off there.

## Medium

**M1 – Page access (None / View per menu item) is only a hint.** Fixed 16 Nov 2026 (below). **Verified.**
`server/src/middleware/pageAccess.js` acts only when the browser sends `X-Perinexa-Page` with a known page. A direct
request without the header, or with the name of a page set to Edit, skips the check. Roles and need-to-know still
apply, so it never gives more than the roles do – but a hospital admin who sets "Reports: None" will believe reports
are blocked. *Fix:* map routes to pages on the server, or say plainly in the admin screen that it hides menu items only.
**Fixed for each page's own areas, 16 Nov 2026:** `PAGE_ROUTES` in `server/src/access/pages.js` lists the API areas
that belong to one menu item only (found by reading which screens call each area): Pharmacy, Theatre, Specimens,
Formulary, Privileges, Clinical audit (with case reviews, dashboards, PPH reviews), Analytics, Tally (Billing), the lab's
QC / setup / stock, and referring doctors. These are checked on the server whatever page the request names, or none
(`pageAccessGuard`); Formulary → Stock places still reads the pharmacy's medicines and stock. **Still by the header
only:** areas several menu items share – patients, billing, the lab's orders, appointments, beds, the Today page's
summaries – because refusing them by area would break the other pages that use them. For those, the roles and the
need-to-know rules remain the real limit, as the admin screen's help already says ("Each item also needs a role").

**M2 – The server never ends a session for inactivity on its own; no absolute limit.** Fixed 16 Nov 2026. **Verified.**
`requireAuth` renews the cookie on every request, including the background polls (`NotificationBell.jsx:29`,
`TodayPage.jsx:592`, `pharmacy/RegisterPage.jsx:181`). The 30-minute logout is enforced only by the browser timer; a
stolen cookie, or an open tab, stays signed in indefinitely. *Fix:* an absolute lifetime (e.g. 12 hours, an `authTime`
claim) and a last-activity time that polls do not refresh.
**Fixed 16 Nov 2026:** the session cookie carries the sign-in time (`at`), kept as it is renewed, and is refused
`SESSION_MAX_HOURS` (default 12) after signing in. Only a change (any non-GET request) or the website's "still here"
call (`GET /api/auth/me`, sent at most every 5 minutes while the person is using the page) renews it; the lists pages
read again by themselves do not, so an unused open tab ends after `SESSION_TIMEOUT_MINUTES` on the server too.
Sessions from before the change start their 12 hours at their next request. Staff on a longer shift sign in again
after 12 hours.

**M3 – Account lock and OTP try counter can be raced.** Fixed 16 Nov 2026. *Plausible.*
`routes/auth.js:188` with `auth/loginLock.js`, and `routes/portalSignup.js:244-248`: the lock is checked before the
attempt and counted after it; `otp.tries` is incremented in memory and saved, so parallel guesses overwrite each other.
Many parallel requests from many addresses can make far more guesses than the limit. *Fix:* atomic
`findOneAndUpdate` with a condition on `tries` / `lockedUntil`.
**Fixed 16 Nov 2026** (confirmed: a test of 12 wrong passwords sent at once checked all 12 before the fix, at most 3
after). Every try – staff sign-in (`staffClaimTry`), a patient's password and OTP (`claimFor` in `portalSignup.js`) and
the portal code (`portal.js`) – is now counted in one database step *before* it is checked, and refused unchecked once
3 in a row are used; the OTP's own try count is a database `$inc` too. Tests: `server/tests/parallel-tries.test.js`.

**M4 – Nothing limits OTP messages to one mobile number.** Fixed 16 Nov 2026. **Verified.**
`routes/portalSignup.js` `POST /:key/otp` is limited per IP only; each request for a registered mobile sends a paid
SMS / WhatsApp. *Fix:* a cooldown per mobile (e.g. 60 s) and a daily cap.
**Fixed 16 Nov 2026:** one OTP a minute and 5 in 24 hours per hospital and mobile number, whoever asks
(`PORTAL_OTP_MOBILE_GAP_SECONDS`, `PORTAL_OTP_MOBILE_DAILY_MAX`; 0 turns a limit off). Counted for every number,
registered or not, so the answer never tells whether someone is a patient. Refused with the existing `RATE_LIMITED`
code, which the portal already shows in Marathi and Hindi – no new patient wording.

**M5 – A patient's bills are listed without the need-to-know check or an audit entry.** Fixed 16 Nov 2026. **Verified.**
`routes/billing.js:144` `GET /patient/:patientId` checks only the hospital; the appointments equivalent
(`appointments.js:326-333`) calls `assertNotHidden` / `patientAccess` and writes an audit line. *Fix:* the same three
steps here.
**Fixed 16 Nov 2026:** `assertNotHidden` and a `BILL_VIEWED` entry (`list: true`, the number of bills, never an
amount) on every listing. On a closer look the access gap was smaller than stated: only reception, billing and the
admin reach the billing routes, and reception and billing see every patient's identity by design, so the real gap was
the missing audit entry. A view-level check like the appointments one was not added, because it would block the
hospital admin – whether admins see bills is the owner's decision (L5).

**M6 – Fertility plan text is not checked for the baby's sex.** Owner decided 17 Nov 2026: built. **Verified.**
`routes/fertilityPlans.js` (section text up to 8,000 characters, switch notes, cycle notes) never calls the PC-PNDT
check. The Act also covers sex selection before conception, so "patient requests male child" can be saved and printed.
*Needed:* the owner's OK to add the same check as the history sheet.
**Owner's decision, 17 Nov 2026: yes.** Built on branch `owner-decisions-1117`. The pregnancy word list would refuse the
approved library itself ("male factor", "sexual health", "47,XXY"), so fertility text uses a narrower list – words for a
child of one sex and sex selection (`SEX_SELECTION_WORDS` in `utils/pcpndt.js`, **DRAFT until the owner reads it**) – on
the plan's title, sections, switch and outcome notes and every cycle-sheet text.

**M7 – Hospital admins can export patient names in bulk.** Owner decided 17 Nov 2026: allowed with a reason, built.
`routes/billing.js:1048` (admin and billing) and `routes/pharmacy.js:1740` (admin) return up to a year as CSV with
MRN, full name and each item or medicine – against the rule at `routes/exports.js:9-10` that an admin sees no patient
data. A pharmacy sales file can show a named patient next to HIV medicines, which defeats the neutral test name. Both
are audited. *Needed:* the owner decides who may download these; numbers only for admins is the safer default.
**Owner's decision, 17 Nov 2026: allowed with a reason.** Built on branch `owner-decisions-1117`: the billing export
and the pharmacy sales file need a reason (5–200 characters), written to the audit entry; the supplier files need none.
Still open for the owner: the pharmacy sales file can name a patient next to HIV medicines (the neutral test name does
not cover medicines).

**M8 – Startup data changes run on every start, without a lock, inside the deploy's one-minute window.** Reduced 16 Nov 2026; what is left is Low (before a second server copy). *Plausible.*
`server/src/index.js:39-108` runs six data-changing steps before `listen()`, on every start of every copy, without
`takeTurn`. `deploy.sh` waits 60 seconds; on a large database it can restart the server in the middle of one and go
back to the old code on half-changed data. A failed step is only a warning. *Fix:* record each finished step in the
database (run once), move finished ones out of `index.js`, and give `healthy()` more time when a step is running.
**Reduced 16 Nov 2026:** `deploy.sh` and `restore.sh` now wait up to five minutes for the server to answer, and
`index.js` logs how long the startup steps took (`journalctl -u perinexa | grep "Startup steps"`). On a closer look
the steps are not one-off moves but repairs that keep running (a doctor without "Dr.", a member without a group, a
next-visit date without an appointment …), each safe to run again, so they were not made run-once – that would change
what the app does. **Still open (Low, before a second server copy):** a lock so only one copy runs them at a time;
and, per step, whether it can retire once the owner agrees nothing old is left.

**M9 – The AI report reader sends the whole report image.** Owner decides (before AI is switched on).
`routes/ai.js:212-236` sends the full photo / PDF, with the printed name, phone and MRN; text features remove them
(`ai/context.js` scrub). Off unless `OPENAI_API_KEY` is set. *Needed:* part of the AI data agreement
(`docs/AI_PROVIDERS.md`); crop or mask the header before sending.

**M10 – `deploy.sh` could report a failed build as a good deploy.** Fixed (this change). **Verified.**
`build_and_start` runs inside `if`, where `set -e` is off; a failed `npm ci` or build still restarted the server, and
`/api/health` said OK. Now joined with `&&`.

**M11 – Large request bodies are read before sign-in.** Fixed 16 Nov 2026.
The JSON parsers (21 MB for `/api/patients/*/documents`) run before `requireAuth` and before the API rate limit
(`app.js:164-218`); Caddy allows 32 MB. Anonymous parallel 21 MB posts can exhaust the memory of the single server.
*Fix:* parse large bodies only after `requireAuth`, and the rate limit before the parsers.
**Fixed 16 Nov 2026:** every larger staff body limit (`big()` in `app.js`) first checks the session cookie's
signature, so a large body is read only for someone signed in; the cookie parser and the per-person request limit now
come before any body is read. Still read before a sign-in check: the scan bridge (its own key, 8 MB) and the ABDM push
address (refused before reading when ABDM is off, as before).

## Low

| ID | Where | What | Status |
| --- | --- | --- | --- |
| L1 | `routes/members.js` `PATCH /:memberId/department` | An admin who is also a doctor can change their own departments (no self check, unlike roles, group and pages), then see other departments' patients in clinical work. Audited. **Verified.** | Fixed 16 Nov 2026: refused (`SELF_ACTION`); one's own departments shown read-only on the staff screen |
| L2 | members reset-password, `platformUsers.js:291` | A password reset hands the admin the temporary password of a doctor who works nowhere else – they can sign in as her. Audited, and she is locked out. Consider a reset link to the user instead. | Open |
| L3 | `utils/patientAccess.js`, `patients.js:1356` | Rights of several roles are OR-ed: a doctor who is also a receptionist can assign another doctor's sensitive patient to themselves. Audited. | Fixed 21 Nov 2026: a person makes themselves her doctor only through the doctor role (her doctor, or none yet, in their department) or as an RMO – never through the receptionist's right (`canAssignSelf`; tests in `access.test.js`) |
| L4 | `platformPatients.js:41`, `platformHospitalView.js:170` | The super admin's patient lists show `careType` (e.g. abortion, infertility) and include sensitive records. Follows 24 Oct decision. | Owner decides |
| L5 | `billingRules.js:6` | Hospital admins are in the billing roles, so they see bills with names and services. *Plausible.* | Owner decides |
| L6 | `utils/tenantScope.js:28, 36` | The hospital guard checks only that `tenantId` is present; `{$in: [...]}` or `{$ne: x}` would pass. Nothing uses that today. | Fixed 16 Nov 2026: tenantId must be one ObjectId, its text or { $eq } |
| L7 | `routes/abdm.js:234`, `abdmService.js:81` | `POST /api/abdm/done/:id` ends an ABDM transaction without the hospital / user check `getTxn` does (random UUID; nothing read). | Fixed 16 Nov 2026: only a step this person started here is ended |
| L8 | `patients.js:1452, 933`, `arrivals.js:104`, `admissionDesk.js:165`, `fertilityPlans.js:517`, `stockPlaces.js:233`, `billing.js:120` | Patient-reading routes without an audit entry (the page flow logs `GET /patients/:id`, a direct call is not logged). | Partly fixed 16 Nov 2026: the doctors' notes are now audited (PATIENT_VIEWED, sections: notes); the others are read inside a record already opened and logged – accepted |
| L9 | `models/AuditLog.js`, `utils/audit.js:18` | Edit blocking misses `replaceOne`, `findOneAndReplace`, `bulkWrite`, `save()` on an existing entry and `collection` calls; a failed audit write is swallowed and the record still returned. | Fixed 16 Nov 2026: replaceOne, findOneAndReplace, bulkWrite and save() of an existing entry blocked; a failed audit write still does not stop the work – accepted (a database fault would otherwise stop the hospital) |
| L10 | `utils/auditDetails.js` | `FERTILITY_*`, `STOCK_PLACE_USED`, `WARD_REQUEST_MADE` are not in the patients category: ids (never names) reach the super admin's log, and fertility events miss the hospital's Patients tab. | Fixed 16 Nov 2026: these events are now patient events |
| L11 | `ai/prescriptionCheck.js:33` | The AI prescription check's output is not passed through the fetal-sex check (input is). | Fixed 16 Nov 2026: an issue that mentions it is left out |
| L12 | `careplans/antenatalDraft.js:80` | "HIV test (with counselling)" is named on care plans, outside the neutral name. DRAFT content. | Owner decides |
| L13 | `routes/labStock.js:132-133` | Lab stock adjustment is read-then-write; it can lose an update against the atomic `$inc` in `lab/stock.js:27`. | Fixed 16 Nov 2026: one conditional $inc; a clash asks for a recount |
| L14 | `pharmacyService.js` (about line 371) | No transactions anywhere; a crash in the middle of a pharmacy sale can leave stock out with no invoice. | Open |
| L15 | `middleware/errorHandler.js:54` | The whole error is logged; Mongoose cast / validation errors carry the rejected value (a phone number) into the log. | Fixed 16 Nov 2026: cast / validation errors answer 400 and log the field names only |
| L16 | `routes/portalSignup.js:224-230` | The OTP request is slower, and can answer 503, only for a registered mobile: shows whether someone is a patient. Send without waiting, same answer always. | Owner decides: fixing it removes the patient's "OTP could not be sent" message |
| L17 | `routes/auth.js:503` | A wrong current password on "change password" is not counted towards the lock. | Fixed 16 Nov 2026: counted like a sign-in try |
| L18 | `routes/portal.js:59`, `portalSignup.js:47`, `utils/sharedState.js:14` | Several keys are derived from `JWT_SECRET`; rotating it also invalidates every printed portal code and pending ABDM steps. Document it, or use separate keys. | Accepted: documented here; separate keys later would reissue every printed portal code |
| L19 | `index.js:102`, `auth.js:137`, `portal.js:183`, `portal.js:33` | Hardening: the server listens on all interfaces (bind to 127.0.0.1 behind Caddy); pin `algorithms: ['HS256']` on verify; portal logout leaves the token valid up to 15 min; comments say "5 tries, 30 minutes" where the code does 3 and 2; no `Permissions-Policy` header. | Fixed 16 Nov 2026 except portal logout (token ends within 15 min – accepted): API_HOST=127.0.0.1 in perinexa.service, HS256 pinned, comments corrected, Permissions-Policy sent |
| L20 | `deploy/perinexa.service`, `db-backup-lib.sh`, `patients.js:751` | Ops: the service does not set `NODE_ENV=production` itself; `ReadWritePaths` lets the server rewrite its own code; the backup does not pass `MONGO_CA_CERT` (only matters off Atlas – it then refuses to deploy, safely); patient search uses an unanchored regex that cannot use the indexes. | Partly fixed 16 Nov 2026: NODE_ENV=production in perinexa.service; ReadWritePaths, the CA file for the backup and the search regex stay open (Low) |

## Decisions for the owner

1. **H3** – may the super admin and platform admins open patient records? (Then `CLAUDE.md` or the code changes.)
2. **M6** – add the PC-PNDT check to fertility plans.
3. **M7, L5** – may hospital admins see bills and download sales / billing files with patient names?
4. **M9** – before AI is switched on: may whole report images go to the AI company?
5. **L4** – may the super admin's patient list show the type of care?
6. **L12** – does the neutral HIV name apply to care plans?
7. Every Medium item not fixed before go-live: accept in writing.

## Checked and correct

- **Hospital separation.** The `tenantScoped` plugin hooks find, update, delete, count and `aggregate()` (first stage
  must match `tenantId`), with no bypass flag. 41 `aggregate()`, 25 `distinct`, 12 `bulkWrite` / `insertMany`, 7
  direct `collection` calls and the one `$lookup` all take the hospital from the server; none reads `tenantId` from
  the request. `x-tenant-id` is only compared with the signed session. No unique index leaks across hospitals.
- **Route guards.** Every data router needs a session and a hospital; the public routes (portal, display, verify, scan
  bridge, ABDM callbacks, sign-in) each have their own key or token and rate limit. Need-to-know is applied in the 16
  patient routers sampled. No mass assignment: every body goes through zod. Only a super admin grants super or
  platform admin; a hospital admin cannot change their own roles, group or page access, or another hospital's staff.
- **Sign-in.** bcrypt cost 12; one message and even timing for wrong email / password / inactive; setup code refused
  once a super admin exists; sessions end on password change, logout and deactivation (`tokenVersion`); cookie
  httpOnly, Secure, SameSite=Strict; CORS to one origin; the `X-Tenant-Id` header also blocks cross-site forms.
- **Input and files.** Searches escape user input; no `$where`; 100 kb default body limit; CSV exports guard against
  formula injection; uploads limited to PDF / JPEG / PNG / WebP by their first bytes, with size limits; downloads check
  hospital, record and access, and are audited; no stack traces in production answers; no secrets in the code.
- **Legal rules.** Fetal-sex checks on AI input and output, voice entry, visit drafts and report reading; HIV kept off
  consent risk factors, neutral name on bills, portal and exports.
- **Data integrity.** Bill, MRN and IPD numbers from an atomic counter with unique indexes; pharmacy stock taken out
  with a conditional `$inc`; hot query paths indexed.
- **Operations.** Graceful shutdown; background jobs take turns; CI runs tests and build without secrets; the deploy
  backup fails safe and keeps the database address off the command line.

## Corrections to other documents

- `docs/HANDOVER.md` section 6 says the `tenantScoped` plugin does not cover `aggregate()`: it does (first stage).
  It does not cover `distinct`, `bulkWrite`, `insertMany`, `collection` calls or joined collections – those stay a
  review item.

## Not covered

The ABDM public callbacks' signature handling; every cross-hospital reference field in request bodies (spot-checked
only); the client code; behaviour under load (`scripts/load-test.mjs` on a t3.medium is still to do); the AWS account
and Atlas settings themselves (MFA, network access, budget alerts – see `docs/DEPLOY_AWS.md`).
