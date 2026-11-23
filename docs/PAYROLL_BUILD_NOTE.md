# Payroll from an attendance file: a build note for the developer

> **Perinexa1 copy (brought over 23 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-payroll`, commit cef6e5a).**
> Written against the other Perinexa copy. Perinexa1 has no payroll either, but its roles, its page access and the
> way Perinexa's own staff enter a hospital differ: as the code stands, a role check alone would let a super admin
> into the payroll while a hospital allows support access. Read section 0 before anything else, and section 2 ("what
> exists") again against this code before building. The ideas list in this repository is `docs/IDEAS_FOR_LATER.md`.
> **Nothing of this note is built in perinexa1.**

Written 23 Nov 2026 for the developer, at the owner's request. The owner asked for "a payroll function for accounts":
a soft copy of the month's attendance goes in, and Perinexa works out each staff member's salary. The owner saw what
Perinexa has today and three options of growing size (a salary sheet; that plus allowances, deductions, advances and
payslips; that plus leave, overtime, shifts and a Tally entry) and chose the middle one, **Option 2**.

**Nothing is built.** The feature pause in `CLAUDE.md` still holds: when this is built is for the developer and the
owner to agree. Sections 2 to 7 are written engineer to engineer; sections 1 and 8 are the owner's part.

## 0. Perinexa1: what differs from this note (read in the code, 23 Nov 2026)

Sections 1 to 8 are the other copy's note, unchanged. What it says is missing is missing here too: nothing on
attendance, shifts, leave, salary or advances, no accounts login, no staff without a login, nothing that reads a
spreadsheet, and the same ten server packages with no Excel library. The differences are in what payroll stands on.
Read in the code only.

**The one that matters most: Perinexa's own staff inside a hospital**
- Decision 3: the super admin never sees the payroll. In perinexa1 a super admin or platform admin who opens a
  hospital is given a membership with **every** hospital role (`platformMembership` in `middleware/auth.js`:
  `roles: [...TENANT_ROLES]`, `platform: true`), and `platformHospitalGuard` lets that through to everything outside
  the setup paths while the hospital's admin allows support access – a super admin to change, a platform admin to
  read (owner, 17 Nov 2026; `utils/platformAccess.js`).
- So `assertRole(req, PAYROLL_ROLES)` is not enough here: during support access it would pass. **Every payroll route
  refuses `req.membership.platform` itself, support access open or not**, with a test for a super admin and a
  platform admin in both states (`tests/support-access.test.js` shows how to open it in a test). The payroll never
  appears in the super admin's hospital view (`routes/platformHospitalView.js`) or the platform's statistics.
- The audit log has two readers (`utils/auditDetails.js`, scope `tenant` or `platform`). An action with no entry of
  its own in `PLATFORM_FIELDS_BY_ACTION`, and outside the patients category, reaches the super admin's log with
  every detail but the patient keys (`platformDetails`). Each payroll action needs its entry there, as the Tally
  actions have, naming nothing of a person, an amount or a month.

**Roles**
- Thirteen hospital roles here, some under other names (`models/Membership.js`): `sonographer` (the note's
  `sonologist`), `followup_coordinator` (the note's `coordinator`), and a `billing` login the other copy does not
  have. `accounts` would be the fourteenth.
- The roles that open patient records are listed in `PATIENT_ROLES` (`utils/patientAccess.js`): `accounts` stays out
  of it, as `admin`, `quality` and `followup_coordinator` do.
- Money today: `BILLING_ROLES = ['receptionist', 'billing', 'admin']`, `REPORT_ROLES = ['admin', 'billing']`, prices
  admin only (`billing/billingRules.js`); the Tally files for the admin and billing, their account names for the
  admin (`tally/tallyRules.js`). The note's open question – should the accounts login take the money reports and
  the Tally files – reads differently here, since the billing login already has both.
- A person who is a hospital admin and clinical staff works in one of the two at a time (`workingRoles`,
  `middleware/auth.js`): the admin's payroll rights exist in admin mode only. Nothing separates `accounts` from a
  second role the same way. To ask the owner: is the accounts login always given alone, or does it get the same
  switch.

**Page access and user groups** (14 Nov 2026 – `models/UserGroup.js`, `access/pages.js`, `docs/USER_GROUPS_PLAN.md`)
- A "Payroll" menu item needs its key in `PAGES`, and its API area (`/api/payroll`) in `PAGE_ROUTES`, so that the
  server checks it whatever page the request names (health check M1). No user group gets it unless the hospital
  admin gives it.

**Staff details**
- `User` here already has `phone` and `employeeId` (a work phone and a staff number each person types in My
  profile, `routes/auth.js`). They stay what they are. `StaffMember.staffNumber` is still its own field, for the note's
  reason: most people on a payroll have no login.

**Money that must stay apart**
- Perinexa1 has **Daily expenses** (Billing → Daily expenses; `models/Expense.js`, `ExpenseHead.js`, page key
  `expenses`), open to reception, billing and the admin through the billing router. A salary or an advance entered
  there would be read by reception. Payroll writes nothing into it; if the hospital wants salaries in its expenses,
  that is a total typed by the admin, and a question for the owner.
- The Tally link here also carries the pharmacy's purchases (11 Nov 2026). Still no salary entry, as section 7 says.

**Files and CSV**
- `StoredFile` kinds without a patient are `referral_attachment`, `referral_release` and `expense_bill`
  (`NO_PATIENT_KINDS`). The note's rule holds: the attendance file gets its own collection.
- `utils/csv.js` has `csvCell` and `toCsv` (with the byte-order mark): the payroll lists use these, not the copies
  inside `routes/billing.js` and `routes/pharmacy.js`.
- A body over 100 kb is read only after the session cookie is checked (`big()` in `app.js`, health check M11): the
  attendance upload needs its own line there, at 1 MB or a little more for base64.

**Keeping the four numbers**
- Perinexa1 already encrypts one thing at rest: the two-step sign-in secret (`auth/totp.js`, AES-256-GCM, a key
  made from `JWT_SECRET`). Health check L18 warns against one more key made from `JWT_SECRET`: the four numbers get
  their own key in `server/.env`, as the note proposes, with what happens when it is lost or changed written in
  `docs/RUNBOOK.md`.
- Two-step sign-in is required for super admins and platform admins and offered to everyone else
  (`TWO_STEP_FOR_ADMINS`). To ask the owner: required for the accounts login too, since it reaches bank account
  numbers.

**Also here and not in the other copy**
- A live server (`docs/RUNBOOK.md`, `docs/DEPLOY_AWS.md`) and the hospital export run by the server operator: the
  new models start in `LEFT_OUT` (`export/hospitalExport.js`), as the note says.
- Every new audit action needs its sentence in `client/src/components/auditFormat.js` and in the copied list in
  `auditFormat.test.js`, or the website tests fail (`docs/HANDOVER.md` section 4).
- The phone layout (below 720 px, 31 Oct 2026): the payroll screens are desk screens, but the menu item and the
  payslip print must not break it.

**What can start now, and what waits**
- Stage A (the accounts login, the staff list, the settings) depends on nothing but the two questions to the owner
  above.
- Stage B waits for the owner's sample attendance files and the accountant's answer on a day's pay; stage C for the
  accountant's word on every rate; stage D follows C (section 3).

## 1. The owner's decisions (23 Nov 2026)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Which option | **Option 2**: salary from an attendance file, with salary parts and allowances, deductions (PF, ESI, professional tax, TDS), advances, payslips and a monthly register. Leave balances, overtime, shifts and a Tally entry are **not** in it |
| 2 | Who builds it | **The developer**, from this note. Nothing is built now |
| 3 | Who may see salaries and run the payroll | **A new "accounts" login and the hospital admin.** Nobody else in the hospital. The accounts login opens no patient record. The super admin never sees it |
| 4 | Where the attendance file comes from | **Both, or not sure** – some staff may be on a biometric machine and some on a hand-kept Excel sheet. Open until the owner brings samples (section 8) |
| 5 | How one day's pay is counted | **The accountant decides.** Open until the accountant answers (section 8) |
| 6 | Whose pay | **All employees on a monthly salary**, including staff with no Perinexa login (attendants, cleaners, security). Visiting consultants paid by fee or share stay with the accountant, as today |
| 7 | Staff numbers kept | **PF number (UAN), ESI number, PAN and the bank account.** Aadhaar is never kept. The owner chose this against the advice to leave out the bank account; section 6 says how these four are protected |
| 8 | Income tax taken from salary (TDS) | **The accountant types the monthly figure** for each person who has one. Perinexa subtracts and prints it and never works the tax out |
| 9 | A mistake found after a month is locked | **The hospital admin reopens the month** with a written reason. The old payslip is marked replaced, a new one is printed, and every version is kept |

Said to the owner with the options, and still true: the deduction rates are legal content and start as DRAFT until
the hospital's accountant confirms each one; the first two or three months run beside the present method and the two
results are compared; Tally has its own salary function, and if the accountant already uses it the first stage alone
(the salary sheet) may be enough.

## 2. What exists today (read in the code, 23 Nov 2026)

**Staff**
- `server/src/models/User.js`: a login – `name`, `email`, `isActive`, and for doctors `professional` (qualification,
  registration number, council). Shared across hospitals. No staff number, joining date, designation or phone.
- `server/src/models/Membership.js`: user + hospital + `roles` from `TENANT_ROLES` (twelve: admin, doctor, rmo, nurse,
  receptionist, lab, pharmacist, sonologist, referral_desk, coordinator, quality, records). No "accounts" role.
- `server/src/routes/members.js`, `client/src/components/MembersPanel.jsx`: the hospital admin adds a person by email,
  sets roles, deactivates. That is all a hospital knows about its staff.
- **Staff with no login are nowhere in Perinexa.**

**Attendance, shifts, leave, salary, advances:** nothing, in the code or the notes. `docs/TALLY_PLAN.md` says salaries
stay manual in Tally and lists payroll under "Not included".

**Money and who sees it**
- `server/src/billing/billingRules.js`: `BILLING_ROLES = ['receptionist', 'admin']`; prices, reports and the export
  are admin only. `routes/tally.js` is admin only. The super admin is a member of no hospital and sees no money.
- Money is whole paise (`billing/money.js`). Payroll should use the same.

**Files**
- `models/StoredFile.js`, `utils/storedFiles.js`, `client/src/components/fileUpload.js`: a PDF or a photo only, checked
  by its first bytes, 5 MB (15 MB for a scanned document), sent as base64 in JSON with a per-path body limit in
  `app.js`, kept in the database, **and every kind but a referral's belongs to a patient**. The contents are never read.
- **Nothing reads a spreadsheet.** CSV is only written: `routes/billing.js` (`csvCell`, which stops a cell opening as a
  formula in Excel) and `routes/pharmacy.js`.
- **No Excel library is installed** (server: bcrypt, cookie-parser, cors, dotenv, express, express-rate-limit, helmet,
  jsonwebtoken, mongoose, zod). Reading `.xlsx` needs a new dependency, which is the developer's decision
  (`CLAUDE.md`). Until then the file is saved from Excel as CSV.

**What payroll can stand on:** `tenantScoped` (`utils/tenantScope.js`), `audit` (`utils/audit.js`), the role checks
(`assertRole`, `RequireTenantRole` in `client/src/App.jsx`), the settings kept on the hospital (`Tenant.tally` is the
pattern: stripped from `toJSON`, read only through its own routes), `TallyBatch` (a file that can always be re-made
byte for byte), the printouts, and the test in `export/hospitalExport.js` that fails until every new model is placed
in `KINDS` or `LEFT_OUT`.

## 3. Suggested order

Four stages, each useful by itself and each on its own branch.

| Stage | What | Depends on |
| --- | --- | --- |
| A | The accounts login, the staff list with pay, payroll settings | Nothing |
| B | The attendance file → the salary sheet (Option 1 of the three shown) | The owner's sample files; the accountant's answer on a day's pay |
| C | Salary parts, deductions, TDS typed in, advances | The accountant's confirmation of every rate |
| D | Lock, reopen, payslips, the register and the monthly lists | C |

After B the hospital runs it beside its present method for a month or two before C is switched on.

## 4. Stage A – the accounts login, the staff list, settings

**The role**
- `accounts` joins `TENANT_ROLES`. Like `quality` and `coordinator` it gets **no patient role** in
  `utils/patientAccess.js`: no patient list, no record, no bills, no Today lists of patients.
- `PAYROLL_ROLES = ['accounts', 'admin']` in a new `server/src/payroll/payrollRules.js`; every payroll route asserts it.
  Reopening a locked month is `['admin']` only (decision 9).
- Not decided, so not changed: whether the accounts login should also take the money reports, the CSV exports and the
  Tally files, which are admin only today. Ask the owner before widening those.
- The role appears wherever roles are listed or labelled (the members panel, the role filter, the audit texts, the
  seed and `docs/TEST_ACCOUNTS.md`), and in the platform's user screens as a word only.

**The staff list** – a new tenant-scoped model, `StaffMember`, separate from `User` on purpose: most of the people on
a payroll have no login, a login is shared across hospitals and pay is not, and a login's JSON goes to many screens.
- `staffNumber` (the hospital's own, unique in the hospital), `name`, `designation`, `department`, `joinedOn`,
  `leftOn`, `isActive` (never deleted, like users), `userId` (optional, set by hand when the person also has a login –
  never matched by name or email automatically).
- `attendanceCodes[]`: the code or codes this person carries in the machine's file or the sheet. Matching in stage B
  is by code, never by name.
- `pay[]`, dated: `{ from, parts: [{ key, amountPaise }], pf: { applies }, esi: { applies }, pt: { applies },
  tdsPaise }`. A change of pay adds an entry; an entry a locked month has used is never edited.
- The four numbers of decision 7 – `uan`, `esiNumber`, `pan`, `bank: { accountNumber, ifsc, bankName }` – with the
  protections of section 6.

**Settings** – `Tenant.payroll`, handled like `Tenant.tally` (never in the tenant's JSON, never to the platform):
- the salary parts the hospital uses (basic, HRA and its own allowances) and, for each, whether it counts for PF and
  for ESI;
- the basis of a day's pay (decision 5, open) and the rounding;
- the rate table of section 8, each row with `status: 'draft' | 'confirmed'`, `confirmedBy`, `confirmedOn` and a
  `from` date, so a rate change never rewrites an old month;
- the saved attendance layouts of stage B.

**Screens** – a "Payroll" entry in the menu for the two roles: Staff, Run payroll, Advances, Lists, Settings. Brand
rules as everywhere (`docs/BRAND.md`); while any rate is DRAFT the Settings and Run payroll screens say so with the
usual colour + icon + word.

## 5. Stages B to D – from the file to the payslip

**B. The attendance file → the salary sheet**
- The steps on one screen: choose the month → choose the file → match → check → the sheet.
- **Format:** CSV, read on the server by a small parser of our own (quoted cells, the byte-order mark, CRLF, comma,
  semicolon or tab; at most 1 MB and a few thousand rows; refused with a plain message otherwise). Every cell is text
  – nothing is evaluated. `.xlsx` only if the developer agrees to a library; do not write a zip and XML reader by hand.
- **Layout:** not fixed until the owner's samples are seen (decision 4). Expect three shapes and write the reader so a
  shape is data, not code: (a) a register, one row per person and one column per day (P, A, half day, weekly off,
  holiday, leave); (b) a punch log, one row per person per day with in and out times; (c) a summary, one row per
  person with totals. The accounts person maps the columns once on a preview of the first rows; the mapping is saved
  per hospital and offered next month. With two sources, two files may be read into one month, each with its layout.
- **Matching:** by `attendanceCodes`. Rows with an unknown code are listed for the accounts person to tie to a staff
  member (which saves the code) or to leave out with a reason. Active staff with no row are listed too. The sheet is
  not made while either list is unanswered.
- **The original file is kept** with the month (bytes and a SHA-256), in its own collection – not `StoredFile`, whose
  rule "a file belongs to a patient" and whose PDF-or-photo check should not be loosened for this.
- **The sum:** for each person, paid days from the file and the basis of decision 5, then pay for the month =
  monthly pay × paid days ÷ basis days, in whole paise, rounded as the settings say. Joining or leaving inside the
  month follows the same rule from `joinedOn` and `leftOn`. A hand correction of a person's paid days needs a reason
  and is shown beside the file's figure, never in place of it.
- All arithmetic in one pure module (`server/src/payroll/payrollMath.js`) with its own tests, like `billing/money.js`.

**C. Salary parts, deductions, TDS, advances**
- Earnings by part, each reduced for unpaid days as the accountant says (most hospitals reduce every part alike).
- Deductions from the rate table: PF and ESI for those they apply to, professional tax by slab; the employer's
  shares are worked out and shown on the register and the lists, never on the take-home. **No deduction is worked
  out from a DRAFT rate in a month that is locked**: while a rate is DRAFT a month may be prepared and printed as
  "DRAFT – not for payment", and locking is refused.
- TDS: the figure typed on the person's pay entry, or for one month on the run (decision 8).
- Advances – `StaffAdvance`: the date, the amount, the monthly instalment, a note; each locked month writes what it
  recovered. The accounts person may change one month's instalment with a reason. A recovery never takes the
  take-home below zero; whether there is a stricter limit is a question for the accountant.
- One-off additions and deductions on a month (an arrear, a fine the hospital's rules allow), each with a reason.

**D. Lock, reopen, payslips, lists**
- `PayrollRun`, one per hospital and month (unique index), `status: 'draft' | 'locked'`, and `versions[]`: each lock
  stores a full snapshot (every person's pay entry used, the rates used, days, earnings, deductions, employer shares,
  advances, take-home, who locked and when). A payslip is printed from a snapshot, so the same payslip can always be
  re-made.
- **Reopen** (admin only, decision 9): a written reason; the run returns to `draft`; the snapshot stays and its
  payslips print with "Replaced on <date>"; the next lock makes version 2, whose payslips say "Revised". Advance
  recoveries of the replaced version are undone and written again by the new one. If the month's PF, ESI or bank list
  was already downloaded, the reopen screen says so in plain words: what was filed or paid outside Perinexa must be
  corrected by the accountant.
- Payslip: the hospital's name, the month, the person's name, staff number and designation, UAN and ESI number, PAN
  and bank account **masked to the last four characters**, days, earnings, deductions, take-home in figures and words.
  One per page, all of a month in one print.
- Lists for a locked month, each a CSV through the existing `csvCell` and each audited: the salary register, the PF
  list, the ESI list, the professional tax list. A bank payment list (name, account, IFSC, amount) is possible
  because of decision 7 but was not asked for – section 8 puts the question to the owner. It would be the only place
  a full account number leaves Perinexa.

## 6. Privacy and safety

- **Hospital separation.** Every new model takes the `tenantScoped` plugin; any `aggregate()` starts with its own
  `tenantId` match. A staff member's pay belongs to one hospital even when their login works in two.
- **The super admin** sees nothing of this: no payroll route under `/api/platform`, no pay figure or staff count from
  the payroll in the platform's statistics, `Tenant.payroll` stripped like `Tenant.tally`.
- **Need to know inside the hospital.** Only the two roles. No other screen shows pay: not the members panel, not
  analytics, not the audit screen's texts for other readers. A person never sees their own payslip on screen in this
  option; they get the paper.
- **The four numbers** (UAN, ESI number, PAN, bank account):
  - `select: false` on the model and absent from every list answer; a staff member's page shows them masked to the
    last four;
  - the full value only through one route, one person at a time, with an audit entry naming whose number was shown
    (never the number);
  - never in the audit log's details, never in an error message, never in the server log, never sent to the AI
    provider;
  - checked on entry by shape only (PAN: ten characters in the usual pattern; IFSC: eleven) – no outside lookup;
  - proposed, for the developer to decide: encrypted at rest with a key from `server/.env` (Node's own `crypto`, no
    new dependency), since a copy of the database would otherwise hold every account number in plain text.
- **Aadhaar** is never asked for and has no field. The free-text fields of the staff list should refuse a 12-digit
  number that looks like one, as the consent boxes refuse HIV wording.
- **AI.** No payroll or attendance data goes to any AI feature. Column mapping is done by the person, not guessed by
  a model.
- **The audit log.** New actions at least for: staff added or changed (which fields, not the values of the four
  numbers), a number shown in full, an attendance file read (month, rows, unmatched), a correction by hand, an advance
  given or changed, a month locked, a month reopened (with the reason), a payslip print, each list downloaded, a rate
  confirmed. The log's trimming is not changed.
- **The hospital export** (`export/hospitalExport.js`): the new models go in `LEFT_OUT` at first, with the reason
  written there. Whether staff pay should ever be part of a hospital's export is a question for the owner.
- **The attendance file is untrusted input:** size and row limits, text only, a name from the file is escaped
  wherever it is shown, and a cell beginning with `=`, `+`, `-` or `@` is written back out through `csvCell`.
- **Test data.** Fake staff and made-up pay only, in the seed, the tests and any chat. The hospital's real staff and
  salaries wait for the go-live checklist, like patient data.

## 7. What must not change

- The protections in `CLAUDE.md`: hospital separation, need-to-know record access, the audit log and its trimming,
  the fetal-sex protection, the neutral name for HIV tests, the super admin never seeing patient data.
- The accounts login opens nothing that exists today. Billing, prices, reports and the Tally link keep their present
  roles until the owner says otherwise.
- `StoredFile` and its checks stay as they are.
- `User` and `Membership` gain no pay field. Deactivating a login does not end a staff member's pay, and the reverse.
- The Tally files carry no salary entry (that was Option 3).
- No new dependency without the developer's agreement; tests only through `npm test` from the project root.
- Legal content – the rate table, the rules for a day's pay, what counts for PF and ESI – changes only on the
  accountant's word, recorded with a name and a date, as clinical content changes only on the owner's.

## 8. For the owner: what is needed from you and from the accountant

**From you**
1. **A sample of each attendance file** the hospital has (the machine's file, the Excel sheet, or both), one month,
   with every name replaced by a made-up one. This decides how the file is read.
2. **A yes or no to a bank payment list** – a file of names, account numbers and amounts for the bank. It is useful
   and it is the one place full account numbers would leave Perinexa.
3. Whether the accounts login should also take over the money reports and Tally files that only the hospital admin
   sees today. Nothing changes unless you say so.

**From the accountant** – in their own words, on paper or by message to you
1. One day's pay: the monthly salary divided by the days of that month, by 30, or by 26. Whether weekly offs and
   holidays are paid days.
2. Half days, late arrival, and joining or leaving in the middle of a month.
3. The parts of a salary the hospital uses (basic, HRA, others), and which parts count for PF and for ESI.
4. Whether the hospital is registered for PF and for ESI, and which staff each covers.
5. Every rate in the table below: right or wrong today, and from which date.
6. How the new labour codes' meaning of "wages" changes any of this for the hospital.
7. Rounding (to the rupee, and which way).
8. Advances: any limit on how much may be taken back in one month.
9. What the payslip and the salary register must show by law, and whether the labour welfare fund applies.
10. How the monthly TDS figure for each person will reach the accounts person.

**DRAFT rates – not checked, not for use.** These are from general knowledge on 23 Nov 2026, not from the current
government notifications. They are here only so the accountant has something to correct. Professional tax differs by
state; the rows below assume Maharashtra.

| What | DRAFT figure | Accountant's answer |
| --- | --- | --- |
| PF, staff share | 12% of basic pay (with dearness allowance) | |
| PF, hospital's share | 12% of the same, part of it to the pension scheme, plus small administration charges | |
| PF, pay limit | Compulsory up to basic pay of ₹15,000 a month | |
| ESI, staff share | 0.75% of gross pay | |
| ESI, hospital's share | 3.25% of gross pay | |
| ESI, pay limit | Covers staff with gross pay up to ₹21,000 a month | |
| Professional tax, men | Nil up to ₹7,500; ₹175 up to ₹10,000; ₹200 above (₹300 in February) | |
| Professional tax, women | Nil up to ₹25,000; ₹200 above (₹300 in February) | |
| Labour welfare fund | Not known – the accountant to say | |

**Not in this option** (each was in Option 3, or stays with the accountant): leave balances and a holiday list kept
in Perinexa, overtime, shifts and night allowance, a salary entry in the Tally file, staff seeing their own payslip
in their login, working out income tax, Form 16 and the other yearly papers, bonus, gratuity, consultants' fees and
shares, and filing anything with the PF, ESI or tax offices.
