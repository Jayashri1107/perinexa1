# Patients deleting their own portal account – plan (19 Nov 2026)

**Status: built 19 Nov 2026 on branch `account-deletion`, with the recommended answer to each question in section 5 –
waiting for the owner to confirm them, and for the developer to read and merge it.** Needed before the Android app
goes on Google Play (`mobile/README.md`, `docs/IDEAS_FOR_LATER.md` → "Perinexa Android app"). Built at the request of
the person at the keyboard as an exception to the feature freeze (a store requirement, not a new feature idea).

**What was built:**
- **Her side:** Portal → My profile → My details → **Delete my account** (`PortalProfile.jsx`, `DeleteAccount`): what is
  deleted and what the hospital keeps, then her password (an account with an email) or an OTP to her mobile; done, she
  lands on the sign-in page with "Your account is deleted". Words in English, Marathi and Hindi (Marathi and Hindi DRAFT,
  `docs/TRANSLATIONS_TO_CHECK.md`). Not shown to a patient signed in with a paper code (no account of hers).
- **Server:** `POST /api/portal/account/delete/otp` and `POST /api/portal/account/delete` (`routes/portalSignup.js`,
  `eraseAccount`): wrong tries count towards the same 3-tries lock as signing in; the personal fields are unset, status
  `deleted` with a `deleted` stamp (`models/PatientAccount.js`); every portal access of her record and of the account
  is revoked; audit `PORTAL_ACCOUNT_DELETED` (ids only) and `PORTAL_ACCOUNT_DELETE_REFUSED`.
- **Reception (question 5):** Patients → Online sign-ups → Recently handled → **Delete account**, with "How you checked
  who she is" (`POST /api/patient-accounts/:id/delete`). Reception, doctors and RMOs – the people who already approve
  sign-ups – rather than the hospital admin, who does not see sign-ups. A deleted account shows as "Account deleted, by
  the patient / by <name>", with no name or contact details.
- **Tests:** `server/tests/portal-signup.test.js` → "deleting her account" (erasing, signing out on two phones, the record
  untouched, signing up again, OTP, the lock, a paper code, reception, another hospital); `portal.test.jsx` (the words).

**Not done yet:** a *pending* account cannot sign in, so it has no in-app button – reception rejects it, then deletes it
from Recently handled; the web page **perinexa.com/delete-account** and the privacy-policy section (section 4, website
repository); not tried on a phone.

## 1. Why

Google Play's user data policy: an app in which people can **create an account** must also let them **ask for that
account and its data to be deleted**, in two places:
- **inside the app** – a path a person can find themselves (e.g. Profile → Delete my account);
- **on a web page** – an address entered in the Play Console's Data safety form, where someone can ask for deletion
  without installing the app again.

Switching an account off ("deactivated", "rejected") does **not** count as deletion. Some data **may be kept** when
there is a real reason – legal duty, security, fraud prevention – if the app says so, on the page and in the Data
safety form. (Check Google's current policy page again on the day of submission.)

In Perinexa, patients create accounts themselves: **Patient → Sign up** (`server/src/routes/portalSignup.js`,
`docs/PATIENT_ACCOUNTS_PLAN.md`). Staff accounts are made by the hospital admin, not in the app, so they are not part
of this and keep today's rule: deactivate, never delete. Access codes printed by staff are not accounts the patient
made; they end with the account (section 3).

**Today:** there is no way for a patient to delete her account. `models/PatientAccount.js` says "Never deleted" – a
rejected or withdrawn account is kept with its sign-up details. Only staff can end portal access (Withdraw).

## 2. The key line: the account goes, the hospital's medical record stays

Two different things carry the patient's name:

| | What it is | Whose | On deletion |
|---|---|---|---|
| **Portal account** (`PatientAccount`) | her sign-in: name, age, mobile, email, password, address, care type and LMP as she typed them | hers | **deleted** (details erased) |
| **Medical record** (`Patient`, visits, prescriptions, lab, scans, bills, consents) | what the hospital wrote while treating her | the hospital's – it must keep it by law | **kept by the hospital**, unchanged |

The hospital is responsible for its medical records (under India's DPDP Act it is the "data fiduciary"; Perinexa
processes them for the hospital). A medical-records law requires the hospital to keep treatment records for a fixed time,
so neither the patient nor Perinexa may erase them through an app button. A patient who wants her medical record
erased asks the hospital, which decides under the law. The page and the Data safety form say this plainly.
(The exact retention periods and wording: the owner, and a lawyer before go-live.)

## 3. What happens when she deletes her account

1. **Portal → Profile → Delete my account** (`client/src/pages/portal/PortalProfile.jsx`). A screen says, in plain
   words, what goes (her sign-in and the details she typed) and what stays (the hospital's medical record, and how to
   ask the hospital about it, with the hospital's phone).
2. She confirms with **her password or a new OTP** – so a phone left unlocked cannot delete it.
3. The server (new route `POST /api/portal/account/delete`, portal session only, rate-limited like sign-in):
   - erases the account's personal fields: name, age, mobile, email, password hash, OTP, address, care type, LMP;
   - keeps a small stub: `tenantId`, `patientId` (if approved), `status: 'deleted'`, `deleted: { at, by: 'patient' }`,
     dates – so reception's list and the audit log still make sense, with nothing that names her;
   - ends **every** portal access of her record (codes and account sessions, `PortalAccess.revoked`) and clears her
     cookie – she is signed out at once on every device;
   - writes **`PORTAL_ACCOUNT_DELETED`** to the audit log (ids only; the audit log itself is never trimmed for this).
4. **A pending account** (not yet approved – no medical record linked) is erased the same way.
5. She **can sign up again later** with the same mobile or email (the unique indexes already count only pending and
   approved accounts); reception approves the new account as usual.

**Reception and the hospital admin:** the "Patient accounts" list shows the stub as "Deleted by the patient, 19 Nov
2026". Her record shows no portal access. Nothing of her medical record changes.

## 4. The web page for Google (no app needed)

The app *is* the website, so the in-app path also works at https://app.perinexa.com (Patient → sign in → Profile →
Delete my account). The Play Console needs a public address that explains it: **https://perinexa.com/delete-account**
on the company website (`C:\perinexa-website`), with:
- the steps above, with the app's name "Perinexa";
- what is deleted and what the hospital keeps, and why;
- for someone who can no longer sign in (lost phone, changed number): write to the support email or call the hospital;
  staff then use **Withdraw** on her record, and a new admin action **Delete her account** (hospital admin only,
  audited, same erasing as above) after checking who she is.

The privacy policy (perinexa.com/privacy) links to this page, and gets an app section (health data, the hospital as
data fiduciary, how long things are kept).

## 5. Questions for the owner (one at a time)

1. **What is kept:** the account is erased and the hospital's medical record is kept, as in section 2. Agree?
2. **The sign-up details:** erased completely (recommended), or kept for a time? (Google: kept data must have a real
   reason and be declared.)
3. **When:** at once (recommended – simple, and what Google expects), or a 7-day "undo" period first?
4. **Confirmation:** password or OTP again before deleting. Agree?
5. **A patient who cannot sign in:** the hospital admin may delete her account after checking who she is. Agree?
6. **Wording** of the screen and the web page in English, Marathi and Hindi – marked DRAFT until the owner checks it
   (`docs/TRANSLATIONS_TO_CHECK.md`).

## 6. Build steps (after the answers; backend first, then the screens)

1. `models/PatientAccount.js`: status `deleted`, a `deleted` stamp; update the "Never deleted" comment.
2. `routes/portalSignup.js` (or `portal.js`): `POST /account/delete` with password/OTP check, erasing, revoking all
   `PortalAccess`, clearing the cookie, audit.
3. `routes/patientAccounts.js`: show deleted stubs; hospital admin's **Delete her account** (section 4).
4. `PortalProfile.jsx`: the button, the explanation screen, the confirmation; words in `portalAccountWords.js`.
5. Tests (`server/tests/portal-signup.test.js` and the portal client test): deletion erases every personal field;
   she is signed out and the old cookie and code stop working; another hospital's account is untouched
   (`tenantScoped`); the medical record is unchanged; she can sign up again; wrong password/OTP refuses; the audit
   entry has ids only.
6. `perinexa.com/delete-account` and the privacy-policy section; the address goes in the Play Console's Data safety form.
7. `npm test` and `npm run build`, the developer reads the change, then merge.

## 7. Not changed

Hospital separation, need-to-know access, the audit log and its trimming, the fetal-sex protection, staff accounts
(deactivated, never deleted), and the rule that real patient data waits for the go-live checklist.
