# Google Play – listing and form answers (DRAFT, 20 Nov 2026)

Drafted from what the code does on 20 Nov 2026 (main db1c27b2 and after). **The owner reads and approves every line
before it is entered in Play Console** – the listing speaks for the company. Recheck the answers whenever a feature that
collects or sends data is switched on or added.

Package: `com.perinexa.app` · version 1.0 (versionCode 1) · target SDK 36 · min SDK 24 (Android 7).

## 1. Store listing

- **App name (30 max):** Perinexa
- **Category:** Medical
- **Contact email:** perinexaofficial@gmail.com · **Phone:** 88880 23000 · **Website:** https://perinexa.com
- **Privacy policy:** https://perinexa.com/privacy/ (the app version is on branch `app-privacy` of perinexa-website –
  it must be live before submitting)
- **Short description (80 max, 76 used):**
  > Maternity and OBGY hospital records for staff, and a patient portal on phone.
- **Full description (4,000 max):**

  > Perinexa is the record-keeping app for maternity homes and obstetrics and gynaecology hospitals in India that use
  > Perinexa. Hospital staff sign in with the account their hospital gives them; patients sign in to their hospital's
  > patient portal.
  >
  > For hospital staff
  > • Today: your patients, admissions, visits due and lab results to review, in one place.
  > • Patient records: registration, visits and prescriptions, care plans for pregnancy and other types of care, lab
  >   and scans, consent forms and documents.
  > • Appointments and calendar, beds and admissions, billing, lab and pharmacy.
  > • Print and save bills, reports and patient cards from the phone.
  >
  > For patients
  > • See your appointments, care plan, lab reports and prescriptions from your hospital.
  > • Book an appointment where your hospital allows it.
  > • Read it in English, मराठी or हिंदी.  ← keep this line only once a fluent speaker has checked the Marathi and Hindi
  >   wording (docs/TRANSLATIONS_TO_CHECK.md); until then the portal marks them as being checked
  > • Delete your account from My profile at any time.
  >
  > Privacy
  > • Nothing is kept on the phone and nothing goes into phone backups; you are signed out after a short time without
  >   use (15 minutes for patients, 30 for staff).
  > • Each hospital's records are kept apart, every opened record is written in an audit log, and records are stored in
  >   India.
  > • No ads and no tracking.
  >
  > Perinexa is a scheduling, record-keeping and decision-support tool for qualified medical practitioners. It does not
  > diagnose or treat and does not replace clinical judgement. You need an account from a hospital that uses Perinexa.

- **Graphics:**
  - App icon 512 × 512: `mobile/store/play-store-icon-512.png` ✅
  - Feature graphic 1024 × 500: `mobile/store/feature-graphic-1024x500.png` ✅ (source and how to render it again:
    `feature-graphic.html`, `RELEASE.md`)
  - Phone screenshots, 2 to 8, sample data only (never a real patient): `mobile/store/screenshots/` – **to make**

## 2. App content forms

| Form | Answer |
|---|---|
| **Privacy policy** | https://perinexa.com/privacy/ |
| **Ads** | No, the app contains no ads |
| **App access** | All functionality needs a sign-in. Give Google a **sample staff login and a sample patient login on the live server, in a demo hospital with sample patients only** (to make – see section 4). Write in the instructions: "Sign in as hospital staff with the email and password below. For the patient portal choose Patient on the sign-in page." |
| **Content rating** | Questionnaire, category *Reference, News or Educational* or *Utility*: no violence, sex, language, drugs, gambling; users do not interact or share content with other users; no location sharing; no purchases. Expected rating: Everyone / 3+ (the app is still for adults – see target audience). |
| **Target audience** | 18 and over only. Not designed for children. |
| **News app** | No |
| **COVID-19 contact tracing** | No |
| **Data safety** | See section 3 |
| **Government app** | No |
| **Financial features** | None (bills are records of the hospital's charges; the app does not take payments) – recheck if a payment gateway is added |
| **Health apps declaration** | Tick: *Medical – electronic health records / patient management* and *clinical decision support* (care plans, risk levels, red flags). Not a medical device. The app is for licensed hospitals and their patients. |
| **Account deletion** | In the app: My profile → Delete my account (patient portal). Web: https://perinexa.com/delete-account/ (branch `app-privacy` – must be live). Staff accounts are closed by their hospital. |

## 3. Data safety form

"Collected" = sent from the phone to Perinexa's server. Under Google's definitions, sending data to service providers that
process it for us (MSG91 / Twilio / Meta WhatsApp for messages, OpenAI for AI features) is **not "sharing"**.

- **Does the app collect or share any of the required user data types?** Yes.
- **Is all user data encrypted in transit?** Yes (HTTPS only; the app refuses plain http).
- **Do you provide a way for users to request that their data is deleted?** Yes (in the app and on the web page above).
- **Data shared with third parties:** none.

| Data type | Collected | Required or optional | Why |
|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, account management |
| Personal info → Email address | Yes | Optional for patients, required for staff | Account management |
| Personal info → Phone number | Yes | Required | Account management (sign-in OTP), app functionality (reminders) |
| Personal info → Address | Yes | Required for a patient's sign-up | App functionality |
| Personal info → Other info (age, ID numbers the hospital records) | Yes | Optional | App functionality |
| Health and fitness → Health info | Yes | Required | App functionality (the patient's medical record) |
| Photos and videos → Photos | Yes, when the user chooses to upload one (a document, a scan) | Optional | App functionality |
| Audio → Voice or sound recordings | **Check before submitting:** dictation is on-device and sends only text; if the hospital switches on AI transcription (`OPENAI_TRANSCRIBE_MODEL`), audio is sent – then answer Yes, optional | Optional | App functionality |
| Files and docs | Yes, when the user uploads one | Optional | App functionality |
| App activity → App interactions | Yes (the audit log: which records were opened) | Required | Security, compliance |
| Location, contacts, messages, calendar, financial info, web history, device IDs | No | – | – |

Data is **not** processed ephemerally only (it is stored); it is not used for advertising or analytics.

## 4. Before submitting – who does what

| Step | Who |
|---|---|
| Owner reads and approves this file, the privacy policy and the Delete your account page; website branch `app-privacy` merged and deployed | Owner, developer |
| Google Play **organisation** developer account (D-U-N-S number), $25 | Owner |
| Demo hospital on the live server with sample patients only; one sample staff login and one sample patient login for Google's reviewers | Developer |
| Upload key: Android Studio → Build → Generate Signed App Bundle → create key store; keep the `.jks` and passwords out of git, in a password manager with a backup; use Play App Signing | Developer |
| Build the release `.aab` (`mobile/README.md`), raise versionCode for every later upload | Developer |
| Feature graphic and 2–8 phone screenshots (sample data) | Developer / designer |
| Internal testing track first (testers' emails), then closed or production | Developer |
| **Real patients only after the go-live checklist** (`docs/HANDOVER.md`) – the store listing does not change that | Owner, developer |
