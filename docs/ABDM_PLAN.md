# ABDM linking (Milestone M1) – plan (approved and built in practice mode)

Planned with the owner on 3 Oct 2026, approved and built the same day. It runs in practice mode until the owner's
sandbox credentials arrive. How to test it: `docs/PROGRESS.md` → "How to test ABDM linking".

## The owner's answers

| # | Question | Answer |
| --- | --- | --- |
| 1 | May Perinexa store the ABHA number and ABHA address? | **Yes – ABHA only, never the Aadhaar number** (this changes the earlier "no government IDs" rule for ABHA only) |
| 2 | Which milestones | **M1 only**: create or verify a patient's ABHA, link it to her record, and Scan & Share registration (M2 and M3 built later, in October 2026 – see "Not included in M1" below) |
| 3 | Creating ABHAs at the desk | **Yes**, with her Aadhaar number and the OTP on her Aadhaar-linked mobile – the Aadhaar number is never stored |

## What only the owner can do (needed before it works with the real ABDM)
1. **Register the hospital in the Health Facility Registry (HFR)** – facility.abdm.gov.in – and the doctors in the
   **Health Professional Registry (HPR)**. The HFR ID is also the hospital's ABDM "HIP" ID.
2. **Apply for ABDM sandbox credentials** (sandbox.abdm.gov.in): a client ID and secret. They go into `server/.env`
   (never into the code). I cannot create these accounts.
3. **Scan & Share needs a public HTTPS address** for ABDM to send the patient's details to – that comes with putting
   Perinexa on the internet (the hosting step). On this computer it can only be tried in practice mode.
4. **Before real patients: ABDM's certification** – a functional test in the sandbox and a security audit (WASA) –
   then production credentials.

## How it will work

### 1. Practice mode and real mode
- **Practice mode** (until the credentials are in `server/.env`): a built-in stand-in for ABDM that answers like the
  sandbox, with made-up ABHAs; the OTP is shown on screen ("practice OTP: 123456"). Every screen says "Practice mode
  – not connected to ABDM". This lets the screens be tried and tested now.
- **Sandbox / production mode**: the same screens call ABDM's V3 APIs (ABHA enrolment and login at
  abhasbx.abdm.gov.in / abha.abdm.gov.in, and the gateway at dev.abdm.gov.in). The exact request fields will be checked
  against ABDM's sandbox documentation once the credentials arrive – ABDM changes details from time to time.

### 2. Verify and link an existing ABHA (patient record → "ABHA")
- Reception (or a doctor or RMO) enters her **ABHA number, ABHA address or mobile number** → ABDM sends an OTP to her
  mobile → she reads it out → her ABHA details come back (name, gender, year of birth, mobile, ABHA number and address).
- Perinexa shows them **beside her record** (name and age) to check it is the same person, then **links** them: the
  record stores the ABHA number and ABHA address, when, by whom, and that she agreed.
- A linked record shows an **ABHA** mark with the number partly hidden (e.g. 91-XXXX-XXXX-1234) to everyone who can
  see her phone number; the full number only on her record's ABHA page.

### 3. Create a new ABHA at the desk (owner's choice)
- She agrees (the ABDM consent text is shown and ticked), reception types her **Aadhaar number** → ABDM sends an OTP
  to her Aadhaar-linked mobile → she reads it out, gives a mobile number for ABHA → her ABHA is created and linked.
- She chooses an **ABHA address** (name@abdm) from ABDM's suggestions, or keeps the one given.
- **Print her ABHA card** (ABDM's card, as ABDM sends it).
- **The Aadhaar number**: typed into a box that hides it, encrypted with ABDM's public key **on the server only to send
  it on**, never saved in the database, never shown again, never written to any log or the audit log (the audit log
  records only "ABHA created" with the patient's id).

### 4. Scan & Share (registration from her ABHA app)
- The hospital's **Scan & Share QR code** (from HFR, with a counter code) is printed for the reception desk
  (Hospital admin → ABDM).
- She scans it in her ABHA app → ABDM sends her details to Perinexa → a **"Scan & Share" list on reception's Today
  page** with a **token number**: reception opens it, finds her record (or registers her with the details filled in),
  and links the ABHA.
- Perinexa checks that each such message really comes from ABDM (its signature) before accepting it.

### 5. Settings (Hospital admin → ABDM)
- Mode (practice, sandbox, production – the credentials themselves stay in `server/.env`), HFR facility ID / HIP ID,
  Scan & Share counter code, and the QR to print. A "Test the connection" button.

### 6. Who does what
| Role | ABDM |
| --- | --- |
| Reception, doctors, RMOs | Verify and link, create an ABHA, Scan & Share list, print the ABHA card |
| Nurses, lab, pharmacist | See the ABHA mark (partly hidden) only |
| Hospital admin | ABDM settings and the QR; the audit log |

Every verification, link, unlink, creation, card printed and Scan & Share received is in the audit log (ids only –
never the Aadhaar number, the OTP or the full ABHA number).

## Build order (each step tested and committed)
1. Server: ABHA fields on the patient record; the ABDM client with practice mode; settings.
2. Server: verify and link; create with Aadhaar OTP; ABHA address; ABHA card; unlink.
3. Server: Scan & Share receiver (signature checked) and the list.
4. Screens: the ABHA page on the patient record, the create flow, the Scan & Share list on Today, Hospital admin → ABDM.
5. How to test it (in `docs/PROGRESS.md`); the list of fields to check against the sandbox when credentials arrive.

## Not included in M1 (M2 and M3 – built in October 2026, in practice mode – see `docs/PROGRESS.md`, Next)
- M2: linking her visits, prescriptions, lab reports and discharge summaries to her ABHA and sharing them (FHIR records)
  (built in October 2026 – see Next: "Her records in ABHA" on the ABHA tab).
- M3: fetching her records from other hospitals with her consent (built in October 2026 – see Next: "Her records from
  other hospitals" on the ABHA tab).
- Neither has been tried against ABDM's sandbox yet; how to test them in practice mode: `docs/PROGRESS.md` → "How to
  test ABDM sharing and records from other hospitals".
