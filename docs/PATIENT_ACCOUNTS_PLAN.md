# Patients' own accounts in the patient portal (owner, 16 Oct 2026)

Status: **built on branch `patient-accounts`** (from `deploy-hardening`). Replaces the ABHA sign-up and ABHA sign-in of
`docs/PATIENT_SIGNUP_PLAN.md` – the owner did not want patients to sign in with ABHA. What she sees once signed in
(her appointment and booking, prescriptions, lab reports, visits and bills, and the rules for each) is unchanged: see
`PATIENT_SIGNUP_PLAN.md` sections 4, 5 and 8.

The owner's flow (16 Oct 2026):

| # | Step | How it works |
|---|------|--------------|
| 1 | She signs up | Sign-in page → **Patient** → **Sign up** (or the hospital's portal address on the poster): full name, age, mobile number, email, password, and the agreement. |
| 2 | Pending | She is told her registration is waiting for the hospital. Nothing is a patient record yet. Signing in before approval says so (only after the right password or OTP). |
| 3 | Reception reviews | Patients → **Online sign-ups** (and a section on reception's Today page): check who she is (at the desk or by phone), then **Find her record and approve** (records with the same mobile or name are suggested), **Register and approve** (the registration form opens with her details), or **Reject** with a reason (kept by the hospital; she is told to call the hospital). |
| 4 | Approved | She signs in with **mobile number + OTP** or **email + password**; both open the same record. |
| 5 | Her page | As before: appointment and booking, care plan, prescriptions, lab reports, visits, bills. Only signed visits and reviewed lab reports; never notes, risk or anything about HIV. |

## Rules (server)
- **Only an approved account signs in.** One approved account per patient record; one live (pending or approved)
  account per email and per mobile in a hospital. A rejected account does not block signing up again.
- **Sign-up never says who is registered:** signing up again with the same mobile or email gets the same answer and
  makes nothing new. A wrong email and a wrong password get the same answer.
- **Passwords:** bcrypt, the same rules as staff (8+ characters, a letter and a number). 5 wrong passwords or OTPs
  lock the account for 30 minutes. Tries are also limited per computer.
- **OTP:** 6 digits, 10 minutes, at most 5 tries, kept only as a keyed hash; sent as an SMS by the reminders' SMS
  provider (Twilio keys in `server/.env`). **Without a provider:** practice mode (the OTP is shown on screen) – never on
  a production server, where mobile sign-in is then switched off and only email + password works. "If this number is
  registered, an OTP was sent" – the same answer for every number.
- **Forgot password:** sign in with mobile + OTP, then **Change password** on her page.
- **Withdraw** on a patient's portal access (her record → Reminders and portal) also closes her account (marked
  rejected, "Portal access withdrawn"); her session ends at once.
- Her session is the portal's own (separate cookie and key, 15 minutes); a patient never gets a staff session.
- Audit log: `PORTAL_SIGNUP_RECEIVED`, `PORTAL_SIGNUP_APPROVED`, `PORTAL_SIGNUP_REJECTED`, `PORTAL_PASSWORD_CHANGED`,
  `PORTAL_LOGIN_SUCCESS` (method password or otp), `PORTAL_LOGIN_FAILED` (wrong password, wrong or expired OTP,
  unknown email) – ids only.
- The paper code from the hospital (`/portal`) still works, as before.

## Code
- Server: `models/PatientAccount.js`, `routes/portalSignup.js` (sign-up, sign-in, OTP, her password),
  `routes/patientAccounts.js` (reception: list, matches, approve, reject), `routes/portal.js` (account sessions,
  Withdraw). Tests: `server/tests/portal-signup.test.js`.
- Website: `pages/portal/PortalAccount.jsx` (Sign in / Sign up, Change password), `pages/LoginPage.jsx` (Hospital staff
  | Patient), `pages/patients/SignupsPage.jsx` (Online sign-ups and the Today section), `PatientNewPage.jsx` (Register
  and approve), `portalAccountWords.js` (English, Marathi and Hindi – DRAFT, `TRANSLATIONS_TO_CHECK.md` section 5).

## New personal data – for the developer and the owner
- **Email** is new: the identity details were limited to name, age, phone and address (`USE_CASE.md` 4). The owner asked
  for email + password sign-in on 16 Oct 2026. It is kept on the account only, never on the patient record.
- The sign-in page lists, by name, the hospitals that switched on patient sign-up.

## Before real patients
- An SMS provider with DLT registration of the OTP message (India), and the developer's review of these public pages
  (rate limits are in memory – HANDOVER.md section 7), HTTPS, and the go-live checklist.
- One mobile number per account: two patients sharing a phone (e.g. a mother and her grown-up daughter) need different
  numbers, or one of them signs in with the paper code.
