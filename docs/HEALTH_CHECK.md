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

From outside the live site is in good shape: HTTPS with a Let's Encrypt certificate (renewed by Caddy), `http://`
redirected, HSTS, a Content-Security-Policy, X-Frame-Options, nosniff, a strict referrer policy, every data route
answers 401 without a session, and ports 22, 4000 and 27017 are closed to the internet.

## High

**H1 – No scheduled backup, and no backup off the server.** Open.
The database is on Atlas M0 (no backups). `deploy.sh` now saves a `mongodump` before each deploy
(`deploy/db-backup-lib.sh`), but only when someone deploys, unencrypted, on the same disk. A week without a deploy and
a lost cluster or disk means a week (or everything) lost.
*Fix:* Atlas M10 with Cloud Backup and Continuous Cloud Backup, a backup policy, one restore to a temporary cluster
with the time written down (`docs/DEPLOY_AWS.md` sections 4 and 9). Encrypted EBS volume for the deploy copies.

**H2 – Vulnerable production dependencies** (`npm audit --omit=dev`: 3 high, 2 moderate, all with fixes). Open.
- `body-parser` 2.3.0 – denial of service through compressed bodies (GHSA-27r3-jxmh-p828). `express.json` inflates by
  default and runs before sign-in (`server/src/app.js:164`), so anyone can send one.
- `mongoose` 9.10.2 – four advisories incl. `sanitizeFilter` not applied and prototype pollution; fixed in 9.12.1.
- `zod` 4.6.5 – memory exhaustion (GHSA-mrhx-c7xc-m3w5); fixed in 4.6.6+.
- Moderate: `qs` 6.16.0, `ip-address` 10.7.2.
*Fix:* update within the existing ranges (no new dependency), `npm test`, `npm run build`, one server start.
**Fixed 16 Nov 2026** (`d65467a0`, `98365b6d`): body-parser 2.4.0, mongoose 9.12.1, zod 4.6.7, qs 6.17.1, ip-address
10.7.6; the build and test tools too (vite 8.3.8, vitest 5.1.0, concurrently 10.0.7). `npm audit` finds 0 in all
packages. Only `package-lock.json` changed.

**H3 – Platform users can read patient records inside a hospital.** Owner decides. **Verified.**
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

**H4 – No two-step sign-in for staff.** Open.
No TOTP or other second factor anywhere in `server/src`. With H3 as it stands, one phished super-admin password opens
every hospital's records.
*Fix:* TOTP (authenticator app) required for super admin, platform admins and hospital admins, offered to everyone.
Needs the developer's and owner's agreement on the library (a new dependency).

## Medium

**M1 – Page access (None / View per menu item) is only a hint.** Open. **Verified.**
`server/src/middleware/pageAccess.js` acts only when the browser sends `X-Perinexa-Page` with a known page. A direct
request without the header, or with the name of a page set to Edit, skips the check. Roles and need-to-know still
apply, so it never gives more than the roles do – but a hospital admin who sets "Reports: None" will believe reports
are blocked. *Fix:* map routes to pages on the server, or say plainly in the admin screen that it hides menu items only.

**M2 – The server never ends a session for inactivity on its own; no absolute limit.** Open. **Verified.**
`requireAuth` renews the cookie on every request, including the background polls (`NotificationBell.jsx:29`,
`TodayPage.jsx:592`, `pharmacy/RegisterPage.jsx:181`). The 30-minute logout is enforced only by the browser timer; a
stolen cookie, or an open tab, stays signed in indefinitely. *Fix:* an absolute lifetime (e.g. 12 hours, an `authTime`
claim) and a last-activity time that polls do not refresh.

**M3 – Account lock and OTP try counter can be raced.** Open. *Plausible.*
`routes/auth.js:188` with `auth/loginLock.js`, and `routes/portalSignup.js:244-248`: the lock is checked before the
attempt and counted after it; `otp.tries` is incremented in memory and saved, so parallel guesses overwrite each other.
Many parallel requests from many addresses can make far more guesses than the limit. *Fix:* atomic
`findOneAndUpdate` with a condition on `tries` / `lockedUntil`.

**M4 – Nothing limits OTP messages to one mobile number.** Open. **Verified.**
`routes/portalSignup.js` `POST /:key/otp` is limited per IP only; each request for a registered mobile sends a paid
SMS / WhatsApp. *Fix:* a cooldown per mobile (e.g. 60 s) and a daily cap.
**Fixed 16 Nov 2026:** one OTP a minute and 5 in 24 hours per hospital and mobile number, whoever asks
(`PORTAL_OTP_MOBILE_GAP_SECONDS`, `PORTAL_OTP_MOBILE_DAILY_MAX`; 0 turns a limit off). Counted for every number,
registered or not, so the answer never tells whether someone is a patient. Refused with the existing `RATE_LIMITED`
code, which the portal already shows in Marathi and Hindi – no new patient wording.

**M5 – A patient's bills are listed without the need-to-know check or an audit entry.** Open. **Verified.**
`routes/billing.js:144` `GET /patient/:patientId` checks only the hospital; the appointments equivalent
(`appointments.js:326-333`) calls `assertNotHidden` / `patientAccess` and writes an audit line. *Fix:* the same three
steps here.
**Fixed 16 Nov 2026:** `assertNotHidden` and a `BILL_VIEWED` entry (`list: true`, the number of bills, never an
amount) on every listing. On a closer look the access gap was smaller than stated: only reception, billing and the
admin reach the billing routes, and reception and billing see every patient's identity by design, so the real gap was
the missing audit entry. A view-level check like the appointments one was not added, because it would block the
hospital admin – whether admins see bills is the owner's decision (L5).

**M6 – Fertility plan text is not checked for the baby's sex.** Owner decides. **Verified.**
`routes/fertilityPlans.js` (section text up to 8,000 characters, switch notes, cycle notes) never calls the PC-PNDT
check. The Act also covers sex selection before conception, so "patient requests male child" can be saved and printed.
*Needed:* the owner's OK to add the same check as the history sheet.

**M7 – Hospital admins can export patient names in bulk.** Owner decides.
`routes/billing.js:1048` (admin and billing) and `routes/pharmacy.js:1740` (admin) return up to a year as CSV with
MRN, full name and each item or medicine – against the rule at `routes/exports.js:9-10` that an admin sees no patient
data. A pharmacy sales file can show a named patient next to HIV medicines, which defeats the neutral test name. Both
are audited. *Needed:* the owner decides who may download these; numbers only for admins is the safer default.

**M8 – Startup data changes run on every start, without a lock, inside the deploy's one-minute window.** Open. *Plausible.*
`server/src/index.js:39-108` runs six data-changing steps before `listen()`, on every start of every copy, without
`takeTurn`. `deploy.sh` waits 60 seconds; on a large database it can restart the server in the middle of one and go
back to the old code on half-changed data. A failed step is only a warning. *Fix:* record each finished step in the
database (run once), move finished ones out of `index.js`, and give `healthy()` more time when a step is running.

**M9 – The AI report reader sends the whole report image.** Owner decides (before AI is switched on).
`routes/ai.js:212-236` sends the full photo / PDF, with the printed name, phone and MRN; text features remove them
(`ai/context.js` scrub). Off unless `OPENAI_API_KEY` is set. *Needed:* part of the AI data agreement
(`docs/AI_PROVIDERS.md`); crop or mask the header before sending.

**M10 – `deploy.sh` could report a failed build as a good deploy.** Fixed (this change). **Verified.**
`build_and_start` runs inside `if`, where `set -e` is off; a failed `npm ci` or build still restarted the server, and
`/api/health` said OK. Now joined with `&&`.

**M11 – Large request bodies are read before sign-in.** Open.
The JSON parsers (21 MB for `/api/patients/*/documents`) run before `requireAuth` and before the API rate limit
(`app.js:164-218`); Caddy allows 32 MB. Anonymous parallel 21 MB posts can exhaust the memory of the single server.
*Fix:* parse large bodies only after `requireAuth`, and the rate limit before the parsers.

## Low

| ID | Where | What | Status |
| --- | --- | --- | --- |
| L1 | `routes/members.js` `PATCH /:memberId/department` | An admin who is also a doctor can change their own departments (no self check, unlike roles, group and pages), then see other departments' patients in clinical work. Audited. **Verified.** | Fixed 16 Nov 2026: refused (`SELF_ACTION`); one's own departments shown read-only on the staff screen |
| L2 | members reset-password, `platformUsers.js:291` | A password reset hands the admin the temporary password of a doctor who works nowhere else – they can sign in as her. Audited, and she is locked out. Consider a reset link to the user instead. | Open |
| L3 | `utils/patientAccess.js`, `patients.js:1356` | Rights of several roles are OR-ed: a doctor who is also a receptionist can assign another doctor's sensitive patient to themselves. Audited. | Open |
| L4 | `platformPatients.js:41`, `platformHospitalView.js:170` | The super admin's patient lists show `careType` (e.g. abortion, infertility) and include sensitive records. Follows 24 Oct decision. | Owner decides |
| L5 | `billingRules.js:6` | Hospital admins are in the billing roles, so they see bills with names and services. *Plausible.* | Owner decides |
| L6 | `utils/tenantScope.js:28, 36` | The hospital guard checks only that `tenantId` is present; `{$in: [...]}` or `{$ne: x}` would pass. Nothing uses that today. | Open |
| L7 | `routes/abdm.js:234`, `abdmService.js:81` | `POST /api/abdm/done/:id` ends an ABDM transaction without the hospital / user check `getTxn` does (random UUID; nothing read). | Open |
| L8 | `patients.js:1452, 933`, `arrivals.js:104`, `admissionDesk.js:165`, `fertilityPlans.js:517`, `stockPlaces.js:233`, `billing.js:120` | Patient-reading routes without an audit entry (the page flow logs `GET /patients/:id`, a direct call is not logged). | Open |
| L9 | `models/AuditLog.js`, `utils/audit.js:18` | Edit blocking misses `replaceOne`, `findOneAndReplace`, `bulkWrite`, `save()` on an existing entry and `collection` calls; a failed audit write is swallowed and the record still returned. | Open |
| L10 | `utils/auditDetails.js` | `FERTILITY_*`, `STOCK_PLACE_USED`, `WARD_REQUEST_MADE` are not in the patients category: ids (never names) reach the super admin's log, and fertility events miss the hospital's Patients tab. | Open |
| L11 | `ai/prescriptionCheck.js:33` | The AI prescription check's output is not passed through the fetal-sex check (input is). | Open |
| L12 | `careplans/antenatalDraft.js:80` | "HIV test (with counselling)" is named on care plans, outside the neutral name. DRAFT content. | Owner decides |
| L13 | `routes/labStock.js:132-133` | Lab stock adjustment is read-then-write; it can lose an update against the atomic `$inc` in `lab/stock.js:27`. | Open |
| L14 | `pharmacyService.js` (about line 371) | No transactions anywhere; a crash in the middle of a pharmacy sale can leave stock out with no invoice. | Open |
| L15 | `middleware/errorHandler.js:54` | The whole error is logged; Mongoose cast / validation errors carry the rejected value (a phone number) into the log. | Open |
| L16 | `routes/portalSignup.js:224-230` | The OTP request is slower, and can answer 503, only for a registered mobile: shows whether someone is a patient. Send without waiting, same answer always. | Open |
| L17 | `routes/auth.js:503` | A wrong current password on "change password" is not counted towards the lock. | Open |
| L18 | `routes/portal.js:59`, `portalSignup.js:47`, `utils/sharedState.js:14` | Several keys are derived from `JWT_SECRET`; rotating it also invalidates every printed portal code and pending ABDM steps. Document it, or use separate keys. | Open |
| L19 | `index.js:102`, `auth.js:137`, `portal.js:183`, `portal.js:33` | Hardening: the server listens on all interfaces (bind to 127.0.0.1 behind Caddy); pin `algorithms: ['HS256']` on verify; portal logout leaves the token valid up to 15 min; comments say "5 tries, 30 minutes" where the code does 3 and 2; no `Permissions-Policy` header. | Open |
| L20 | `deploy/perinexa.service`, `db-backup-lib.sh`, `patients.js:751` | Ops: the service does not set `NODE_ENV=production` itself; `ReadWritePaths` lets the server rewrite its own code; the backup does not pass `MONGO_CA_CERT` (only matters off Atlas – it then refuses to deploy, safely); patient search uses an unanchored regex that cannot use the indexes. | Open |

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
