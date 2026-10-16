# Patient sign-up and records in the patient portal – plan (owner, 16 Oct 2026)

Status: **approved by the owner on 16 Oct 2026** (with the two choices in section 5). Branch `patient-signup` (from `deploy-hardening`).

Asked for by the owner: a patient signs in herself, registers herself, books an appointment and sees her reports,
prescriptions and other useful things. The owner chose (16 Oct 2026):

| # | Question | Owner's answer |
|---|----------|----------------|
| 1 | How does she register herself? | **ABHA with OTP** – her name, sex, year of birth and mobile come checked from ABDM. **No Aadhaar card is uploaded or stored** (the earlier "never the Aadhaar number" decision stays). |
| 2 | When do staff see her? | **Only after reception confirms her.** Until then she waits in a list at the desk. |
| 3 | What may she see? | **Prescriptions, lab reports, visit summaries, bills and receipts.** |

Everything below builds on what exists: the portal (`routes/portal.js`), ABHA verify by OTP and Scan & Share
(`routes/abdm.js`), online booking, and the rules for what may leave the hospital through ABHA (`abdm/shareRules.js`).

## 1. Signing up (the patient, on her phone)
- Each hospital gets its own **sign-up link** (and a QR poster to print), e.g. `/portal/h/7KQ2MX`. The link is a random
  code, not the hospital's name. Off until the hospital admin switches on **"Patients may sign up online"** (Hospital
  admin → Patient messages, next to the portal switches). Needs the portal on.
- She enters her **ABHA number, ABHA address or her Aadhaar-linked mobile** → ABDM sends an OTP → she types it →
  ABDM returns her ABHA details (name, sex, year of birth, mobile). If ABDM finds more than one ABHA, she chooses hers.
- She reads and ticks the agreement (DRAFT wording for the owner): the hospital receives her ABHA details to register
  her; nothing medical is shared by signing up.
- She is told: "Thank you. The hospital will confirm your registration. You can sign in after that." She is **not**
  told whether she is already registered (that would let a stranger test whose ABHA is at this hospital).
- **Never stored:** the Aadhaar card, the Aadhaar number, the OTP. Practice mode works as today (OTP 123456).

## 2. Confirming her (reception)
- Her sign-up appears in the **Scan & Share list** on reception's Today page, marked **"Signed up online"**, with the
  same three choices as today: **Register** (the registration form opens with her ABHA name, phone and age filled in;
  her ABHA is linked once saved), **This is …** (an existing record – her ABHA is linked to it), or **Put aside**.
- Until reception does one of these she is **not a patient**: no record, no patient number, not in any doctor's list.
- Sign-ups not handled stay in the list for **7 days** (a Scan & Share is for one day only), then drop off the list
  (kept in the database, never deleted, as for every Scan & Share).

## 3. Signing in
- Two ways, on the same sign-in page:
  - **With ABHA (new):** her ABHA number, ABHA address or mobile → OTP from ABDM → in. Works only when a record in
    this hospital has that ABHA linked, the portal is on and the record is not closed. Same answer for every refusal
    ("We could not sign you in. Please call the hospital.").
  - **With the paper code** (as today), for patients without ABHA.
- Everything else stays as it is: its own cookie and key, 15 minutes, every sign-in and failed try in the audit log,
  tries limited per computer.

## 4. What she sees after signing in
Tabs on her page: **Home** (as today: next appointment, care plan, hospital phone) · **Appointment** (as today:
book or cancel online, the doctor's leave) · **Prescriptions** · **Lab reports** · **Visits** · **Bills**.

The rule for every record: **she sees online only what she has already been given on paper, and only once it is
final.** The same rules as sharing through ABHA (`abdm/shareRules.js`):

| What | Shown when | Shown as |
|------|-----------|----------|
| Prescriptions | the visit is **signed** | the same patient copy as the printed prescription, with the hospital's prescription design (what the design hides stays hidden) – to view and print |
| Lab reports | a doctor has **reviewed** the results | test, result, unit, normal range and the lab's remark – the same as the printed report |
| Visits | the visit is **signed** | date, doctor, advice, tests advised and next visit |
| Bills | always (open or paid; cancelled bills not shown) | lines, total, paid, due, and each receipt to print |

**Never shown:** the doctor's private note, examination, risk and red flags, nursing notes, AI points, unsigned visits,
unreviewed results, cancelled or "entered in error" records, any record about HIV (a test, a visit or a record
mentioning it – she collects those from the hospital; bills keep the neutral test name), and anything from a stay
that is not signed off. There is no fetal-sex field anywhere, and that stays.

Every page she opens is in the audit log (ids only), as today.

## 5. Owner decisions (16 Oct 2026)
- **Visits:** the diagnosis is shown online **exactly when the printed prescription shows it** (the hospital's
  prescription design decides; online = paper).
- **Lab reports:** **reviewed by a doctor = ready for her.** No extra tick.
- **The patient wording** (agreement text, tab names, explanations) stays DRAFT until the owner reads it on screen;
  Marathi and Hindi DRAFT in `TRANSLATIONS_TO_CHECK.md`.

## 6. Order of work (each step tested and committed)
1. Server: hospital sign-up link and switch; sign-up with ABHA OTP → waits in the desk list; reception's choices.
2. Server: sign-in with ABHA OTP.
3. Server: her prescriptions, lab reports, visits and bills, with the rules above.
4. Website: sign-up page, ABHA sign-in, the new tabs; "Signed up online" at the desk; the admin switch and QR poster.
5. Tests (sign-up never creates a patient; refusals look the same; nothing on the "never shown" list leaves), build,
   `PROGRESS.md`.

## 7. Before real patients
This page is open to the internet and shows medical records. The developer reviews it (health check) before any real
patient uses it, together with HTTPS hosting and the go-live checklist in the handover plan.

## 8. Built (16 Oct 2026, branch `patient-signup`, not merged yet)
Everything in sections 1–4 except what is listed under "Not done" below.
- Server: `routes/portalSignup.js` (the hospital's page, OTP, sign-up, ABHA sign-in), `routes/portalRecords.js` (her
  records), the switch in `routes/reminderOutbox.js` (`portalSignup`; the code is `Tenant.messaging.signupKey`),
  sign-ups as Scan & Share with `source: 'portal'` (waiting 7 days in `GET /api/abdm/scan-share`), ABHA sign-ins as
  `PortalAccess` with `method: 'abha'`. Audit: `PORTAL_SIGNUP_RECEIVED`, `PORTAL_RECORDS_VIEWED`, and
  `PORTAL_LOGIN_SUCCESS` / `PORTAL_LOGIN_FAILED` with `method: 'abha'` / `reason: 'abha_not_registered'`.
  `PORTAL_OTP_RATE_LIMIT_MAX` (default 8 OTPs per computer in 15 minutes). Tests: `server/tests/portal-signup.test.js`.
- Website: `PortalAccount.jsx` (sign-in and sign-up with ABHA), `PortalRecords.jsx` (the four tabs; a prescription
  opens as the printed page, to print or save as PDF), `portalAccountWords.js` (English, Marathi and Hindi – DRAFT,
  `TRANSLATIONS_TO_CHECK.md` section 5), "Signed up online" in the desk's Scan & Share list, and the switch, address
  and poster in Hospital admin → Patient messages.

**Not done / known limits** (for the developer and the owner):
- **No QR code on the poster** – the address is printed in large letters. A QR code needs a new library (developer's
  agreement first).
- **Lab reports and bills are shown, not printed** as their own documents (prescriptions and visit summaries are).
- **"Withdraw" on the patient's portal access ends her session, but she can sign in again with her ABHA** while the
  hospital's sign-up switch is on. Blocking one patient's ABHA sign-in needs a small change (a flag on her record).
- **Sign-up steps are kept in the server's memory** for 10 minutes (one server, as the ABDM steps – HANDOVER.md
  section 7).
- The print preview of a prescription is a little wider than a phone screen (as for staff); "Save as PDF" gives the
  whole page.
- Real ABDM (sandbox or production) not tried: practice mode only, as for the rest of ABDM.

## 9. One sign-in page (owner, 16 Oct 2026)
The owner asked for patient sign-in on the same page as staff, not a separate one. The sign-in page (/login) now has
**Hospital staff | Patient** at the top. Patient: the hospital is chosen from the hospitals that switched on patient
sign-up (only their names are listed, by `GET /api/portal/h`; one hospital is chosen by itself), then the same ABHA
sign-in or sign-up as on the hospital's portal address, and a link for patients with a paper code. The sessions stay
separate: a patient never gets a staff session, and staff sign-in is unchanged. Note for the developer: the list
shows publicly which hospitals use Perinexa with patient sign-up on.

