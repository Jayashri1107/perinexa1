# Plans for the bigger ideas 12–16 (owner, 16 Oct 2026)

From `docs/IDEAS_FOR_LATER.md`. The owner asked for these to be planned, not built, because each has a real risk. Ideas
1–11 were built on branch `doctor-ideas` (see `docs/PROGRESS.md`). **Nothing here is built.** Each plan says what must
be decided or checked first, who decides, and how it would be built. The developer reviews each before any code, and
the owner approves the medical content (the owner is a doctor).

Common rules for all five: fake data only until the go-live checklist is done; never weaken hospital separation, need-
to-know access, the audit log, the fetal-sex protection, the neutral name for HIV tests, or the super admin rule; no
new add-on or outside service without the developer's agreement.

---

## 12. AI listening during the consultation

**What it would do.** With the patient's spoken consent, the doctor presses Record; the conversation becomes a DRAFT
visit note (complaints, findings, advice) that the doctor reads, corrects and saves. Nothing is saved without the
doctor.

**Why it is risky.** The patient's own voice and words – often more private than the notes – would go to an outside AI
company. A wrong word in a draft note can become a wrong record if not checked.

**Decide first (owner and developer).**
- Which provider, under which contract: no keeping of audio or text, no training on it, data kept in India (DPDP Act
  2023). OpenAI is the current provider for other AI features (`docs/AI_PROVIDERS.md`); a medical-grade speech
  service may be better.
- The consent wording (owner – DRAFT until approved), how consent is recorded (a tick with who and when), and what
  happens when she says no (nothing records).
- Never for a sensitive record (infertility, a record marked sensitive), and never anything that could name the baby's
  sex: the draft passes the same PCPNDT check as typed text, and the audio is never kept.

**How it would be built.** Record in the browser only while the button is held or on; send the audio once, after the
consult; get back text; turn it into the visit form's fields with the existing voice-entry reader
(`client/src/pages/patients/visitDictation.js`); every filled field marked "from the recording – check"; audit
`AI_USED` with ids only. A switch for the hospital admin, off by default.

**Effort.** About 2–3 weeks after the decisions, plus the developer's security review.

---

## 13. Phone or tablet for ward rounds

**What it would do.** Install Perinexa on a phone ("Add to home screen"); a simple round list of the ward's patients;
quick round notes and vitals at the bedside.

**Why it is risky.** A phone is easily lost or left unlocked; a shared ward tablet is used by many people.

**Decide first (developer).**
- Sign-in: the same login, with a shorter time-out on phones (e.g. 5 minutes), and nothing kept on the phone after
  sign-out (no offline copy of patient data – the app stays online-only).
- A ward tablet: one person signed in at a time, a quick switch of user, and a visible "signed in as" bar.
- HTTPS is required (an installable app needs it anyway – go-live checklist).

**How it would be built.** A web app manifest and icons (no app store, no new add-on); the phone layout of the existing
screens is already responsive; a "Round" page listing admitted patients by bed with the last vitals and red flags; a
round note saved as a nursing or doctor entry that already exists (`models/NursingEntry.js`, visit additions). The
service worker caches only the app's code, never answers that hold patient data.

**Effort.** About 2 weeks.

---

## 14. Photo of an outside report

**What it would do.** Take a phone photo of another lab's report; the values (Hb, sugar, TSH …) are read and offered to
the doctor, who confirms each one before it goes into the record.

**Why it is risky.** The photo holds her name and results and would go to an outside company to be read; reading
mistakes happen (a 1 read as a 7, a unit missed), and a wrong value can change care.

**Decide first (owner and developer).**
- Reading on the hospital's own server (an open-source text reader – a new add-on, developer's agreement) or by an
  outside AI (contract terms as in idea 12). On-server is safer.
- Only the lab tests the app already knows (`server/src/lab/labTests.js`), with their units and ranges; anything else
  stays as the photo for the doctor to read.
- The photo is kept as a stored file of her record (as uploaded lab reports already are – `models/StoredFile.js`),
  never anywhere else.

**How it would be built.** Upload → read → a table "value read / unit / your value" with every row empty-confirmed by
the doctor; nothing saved until the doctor presses Save; each value saved marked "from an outside report, confirmed by
Dr X"; the photo linked. Audit: uploaded, read, confirmed (ids only).

**Effort.** About 2 weeks after the reading choice.

---

## 15. Registration from the QR code on her Aadhaar card

**What it would do.** Reception holds the Aadhaar card to the webcam; the government-signed Secure QR is read in the
browser and fills name, year or date of birth, sex and address for reception to check.

**Why it is risky.** Aadhaar rules restrict keeping copies and the number; the owner decided "never the Aadhaar number"
(`docs/USE_CASE.md`, `docs/ABDM_PLAN.md`). Patients now also register themselves (patient accounts, 16 Oct 2026).

**Decide first.**
- Check UIDAI's current rules for offline verification with the Secure QR (who may use it, consent, what may be kept)
  – a legal check, not a coding one.
- A QR-reading add-on for the browser (developer's agreement), and checking the QR's UIDAI signature (UIDAI's public
  key).
- **Do first:** make ABHA Scan & Share work for real (built, practice mode only – needs the ABDM sandbox, HFR
  registration and a public address). It already fills the form from her ABHA app without any card.

**How it would be built.** Webcam → read the QR in the browser → check the signature → show the details to reception
with "Use these details" → fill the registration form. Never kept: the image, the QR data, the Aadhaar number (or its
last digits), the photo inside the QR. Only her consent tick and "details from Aadhaar QR" are recorded.

**Effort.** About 1–2 weeks after the legal check.

---

## 16. Ultrasound (USG) reports

**What it would do.** Scan orders and a scan list; report templates per scan type (DRAFT); measurements typed or said;
the app works out gestational age, estimated weight and centiles and writes the report; suggestions from
owner-approved rules added only when the doctor presses Add; signed and printed on the letterhead. A first version was
built on the owner's Mac copy on 15 Oct 2026 (plan `docs/USG_PLAN.md` there) – **it is not in this copy**; bring it
over from that copy rather than writing it again.

**Why it is risky.** The PC-PNDT Act: ultrasound in pregnancy needs a registered centre and sonologist, Form F for
every scan, and the baby's sex must never be recorded, said or shown.

**Decide first (owner).**
- Is the hospital registered under PC-PNDT for ultrasound, and who are the registered sonologists? (The owner decided
  earlier: no PC-PNDT registers or Form F in Perinexa – `docs/HANDOVER.md` section 9. Scan reports would need that
  decision looked at again, or the scan registers kept outside Perinexa.)
- The formulas for weight and centiles (e.g. Hadlock) and their tables – clinical content the owner approves.
- **Not chosen:** AI reading the scan images (a medical device needing CDSCO approval, and it could reveal the sex).

**How it would be built.** Copy the Mac copy's USG module onto a branch of this copy, run its tests here, merge with
the developer.

**Effort.** 1–3 days to bring it across if the Mac copy is available; several weeks to rebuild otherwise.
