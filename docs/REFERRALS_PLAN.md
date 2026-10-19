# Referrals from other doctors – plan

Planned with the owner on 15 Oct 2026 from Anandi Hospitals' "Clinical Partner Guide" (Edition 1, October 2026), and
built the same day at the owner's request as an exception to the feature pause (like the ultrasound reports). Fake
data only until the go-live checklist in the handover plan is complete; real referring doctors, consultants' direct
lines and the referral desk number are entered by the hospital admin, never put in the code.

## The owner's decisions (15 Oct 2026)

| # | Question | Answer |
| --- | --- | --- |
| 1 | Centres | **One hospital, "Anandi Hospitals"** in Perinexa: shared records and one referral desk. Each referral records the centre she will be seen at (Sutgirni Chowk, Adalat Road, later Waluj – the admin's list) |
| 2 | Who runs the desk | **A new "Referral desk" login**: referrals, booking and sending; never her full medical record. Doctors and RMOs can also log a referral (urgent ones that come to the unit line) |
| 3 | How messages reach the referring doctor | **The app prepares, the desk sends from its own WhatsApp**: the text is copied and the PDF saved, the chat with the doctor opens, the desk attaches and sends, and marks it sent. Who sent what and when is kept |
| 4 | Her agreement | The **reply** (appointment time and consultant) goes **without asking**. The **consultant note and the discharge summary** go **only after her recorded Yes**, asked at her first visit. A No is respected and is not a missed promise |
| 5 | Clocks | As the guide: reply within **2 working hours** (Mon–Sat 9 am–8 pm; the admin's holidays do not count); **urgent** seen before midnight of the day it came (after 8 pm: by 8 am next morning); **routine** within **48 hours**; consultant note within **24 h** of her first visit; discharge summary within **24 h** of discharge. The admin can change working hours and holidays |
| 6 | When | **Built now, into the main version** |

## The guide's six promises, and what Perinexa does for each

| Promise | In Perinexa |
| --- | --- |
| 1. Reply within 2 working hours with the appointment time and the consultant | The desk logs the referral and books her appointment; **Reply** prepares the message; a clock shows the time left |
| 2. Urgent seen the same day, routine within 48 hours | The clock runs from the referral to her first visit (or admission) – found by itself from her record |
| 3. Consultant note within 24 hours of the first visit | A note in the guide's own layout (page 7), started from her first visit, written and signed by the consultant, released to the desk as a PDF |
| 4. Discharge summary within 24 hours of discharge | The confirmed discharge card, released to the desk as a PDF |
| 5. She comes back to you | "Returns to you for" must be filled in before the note can be signed |
| 6. A consultant you can call | The consultants' direct lines, kept by the admin, shown to the desk and printed on the slip |
| A miss is reviewed within the week | Every referral is checked against the promises; the **weekly review** lists the misses, and the consultants write what went wrong and what changed |

Also: a **quarterly one-page summary** for each referring doctor (outcomes, what returned to them, any missed
promise – details only for patients who said Yes), and a **printable referral slip** for their pads.

## Who sees what

| Role | Can do |
| --- | --- |
| Referral desk | Referring doctors list; log, edit and close referrals; attach the doctor's note or reports; register the patient (name, age, phone, type of care, doctor) and book her appointment; record her Yes or No; prepare and mark messages sent; download PDFs released to it; the weekly review and the quarterly summaries (read). On a patient's record: name, number, age, phone and her doctor only – no medical details |
| Doctors, RMOs | Everything the desk does, for referrals of patients whose medical details they may see; write the consultant note (her doctor or an RMO), sign it (a doctor), release the note and the discharge card PDFs; write the weekly review notes |
| Nurses, reception, lab, pharmacist, sonologist | Nothing in Referrals (reception keeps booking as now) |
| Hospital admin | The referral settings (centres, desk number, consultants' direct lines, working hours, holidays). No referrals: they are patient data |
| Super admin | Nothing (never patient data) |

## Built differently from the first draft (15 Oct 2026, while building)
- **Booking** from a referral follows the Appointments rule (owner, 3 Oct 2026): the referral desk and doctors book;
  RMOs log referrals but do not book.
- The desk registers a patient with her name, age, phone, type of care and doctor – no address (it could not see it
  afterwards), and not a baby. It sees the Appointments pages like reception (to book).
- The desk never sees the words of the consultant note on screen; it handles the released PDF. The quarterly summary
  shows the outcome and "returns to you for" only for patients who said Yes.
- **Misses cannot be hidden** (after the independent review): Cancel is only for a referral logged by mistake, before
  anything happened – after that it is closed, and any missed promise stays on record. Closing never turns a running
  promise (a note or discharge summary already due) into "not needed". The time it came and its urgency are fixed once
  the reply is sent, she has been seen or a promise is late. The reply and "seen" deadlines are saved when the referral
  is logged, so later changes to working hours or holidays never rewrite past clocks.
- The desk can save a note or discharge PDF only after her recorded Yes (not merely before a No).
- The desk links a referral to a record only when her name or phone matches; otherwise her doctor or an RMO links it.
- "Seen" also counts a visit on the day the referral came (even if started before it was logged) and a stay she was
  already in.
- Booking from a referral makes the booked doctor her consultant (the reply names that doctor); no new booking once
  she has been seen.
- The quarterly summary never shows details of a referral the viewer may not open, and for a patient without her Yes
  shows only the reply and "seen" promises.

## Not in this version
- A login for referring doctors; second opinions on reports sent without a referral; Case of the Month; CME
  invitations; Meta one-click sending to doctors; email.
- Prepared messages never go inside the WhatsApp link (Perinexa's rule: nothing about a patient in an address); the
  desk pastes the copied text.

---

## Technical design (for the build and the developer)

### Role
- `referral_desk` added to `TENANT_ROLES` (after `sonologist`); label "Referral desk".
- `utils/patientAccess.js`: in `PATIENT_ROLES`; `forRole('referral_desk')` = `{...NONE, view: DESK_FIELDS}` with
  `DESK_FIELDS = [...LAB_FIELDS, 'closed', 'ageYears', 'ageRecordedOn', 'currentAge', 'phone', 'assignedDoctor',
  'assignedDoctorName', 'createdAt', 'updatedAt']` (no address, reminders, ABHA, sensitive, pregnancy …); level
  'identity'. `creationAccess.allowed` includes it (not `clinical`, so only identity details are saved).
- `routes/patients.js` `SEES_PHONE_AND_DOCTOR` includes it.
- Appointments: `BOOKING_ROLES` and `QUEUE_ROLES` (server `appointments/appointmentRules.js`; client copies in
  `platform/modules.js` and `pages/appointments/appointmentFormat.js`) and the `/appointments/:id/link` roles include
  it. `ARRIVAL_ROLES` does not.
- `REFERRAL_ROLES = ['referral_desk', 'doctor', 'rmo']` (server `routes/referrals.js`, client `platform/modules.js`).

### Models (all `tenantScoped`)
`ReferringDoctor`: `name` (≤150, required), `qualification` (≤150), `clinic` (≤150), `area` (≤150), `phone` (≤30 –
WhatsApp), `email` (≤150), `registrationNumber` (≤60), `notes` (≤500), `partner: { joined: Boolean, caseOfMonth:
Boolean, cme: Boolean, quarterlySummary: Boolean }`, `isActive` (default true), `created`/`updated` stamps
`{by, byName, at}`, `nameKey` (lower-case name for search). Never deleted (made inactive).

`Referral`:
- `number` ('REF-000001', `nextNumber(tenantId, 'referral')`), `centre` (a key from settings), `status`
  'open' | 'closed' | 'cancelled', `closed {by, byName, at, reason}`, `cancelled {by, byName, at, reason}`.
- `receivedAt` (Date; the time it reached the hospital – may be earlier than logging, never later than now),
  `via` 'whatsapp' | 'call' | 'walk_in' | 'letter', `urgency` 'urgent' | 'routine'.
- `referringDoctorId` (required).
- `patientId` (null until known) and `guest {name, phone, ageYears}` (before registration); exactly one is needed.
- `reasons` [keys of `referrals/reasons.js`], `otherReason` (≤300), `question` (≤1000) – "the question you want
  answered", `sent` – what the doctor sent: `lmpEdd`, `gravidaPara`, `bp`, `hb`, `sugar`, `medicines`, `scans`
  (each ≤200 text).
- `consultantId` (a doctor of the hospital).
- `attachments` [`{fileId, fileName, mediaType, size, by, byName, at}`] (StoredFile kind `referral_attachment`, at
  most 10).
- `appointmentId` (the booking made for it).
- `sharing {answer: 'yes'|'no', by, byName, at}` + `sharingHistory` [same] – her agreement for the note and the
  discharge summary.
- `firstSeen {at, visitId, admissionId}` – frozen when first found (earliest active Visit with `createdAt >=
  receivedAt`, or Admission with `admittedAt >= receivedAt`); re-found if that visit is later marked entered in error.
- `discharge {admissionId, documentId, dischargedAt}` – the first stay after the referral whose card is confirmed.
- `note` – the consultant note: `{status: 'draft'|'signed', fromVisitId, questionRestated, findings, diagnosis,
  plan, needFromYou, returnsToYouFor, nextAtAnandi, saved {by, byName, at}, signed {by, byName, at}, additions [{text,
  by, byName, at}], rev}` (free text through `safeText`, never the visit's private note).
- `releases` [`{kind: 'note'|'discharge', fileId, fileName, size, documentId, by, byName, at, supersededAt}`]
  (StoredFile kind `referral_release`, PDF only).
- `messages` [`{what: 'reply'|'note'|'discharge'|'other', releaseFileId, by, byName, at}`] – marked sent by hand.
- `reviews` [`{promise: 'reply'|'seen'|'note'|'discharge', wentWrong, changed, by, byName, at}`] – the weekly review.
- `rev`, `clientRequestId` (unique per tenant), `created`/`updated` stamps.

`StoredFile.FILE_KINDS` gains `referral_attachment` and `referral_release`; `patientId` is required except for these
two kinds (a referral can arrive before she is registered).

### Settings (`tenant.referrals`, `GET/PUT /api/tenant/settings/referrals`)
`{ centres: [{key, name, active}], deskNumber, consultantLines: [{userId, phone, note}], workingHours: {days: [1..6],
from: '09:00', to: '20:00'}, holidays: [{on: 'YYYY-MM-DD', note}], urgentCutoff: '20:00', urgentNextMorning: '08:00' }`.
Read by everyone in the hospital; changed by the hospital admin (audit `REFERRAL_SETTINGS_CHANGED`, field names only).
Removed from `Tenant.toJSON` (platform lists); written in the hospital export.

### Clocks (`referrals/clocks.js`, pure, clock passed in)
- reply due = `addWorkingMinutes(receivedAt, 120, settings)`; met by the first `messages` entry `reply`.
- seen due: urgent – before 23:59:59 of the hospital day it came, or `urgentNextMorning` next day when received at or
  after `urgentCutoff`; routine – `receivedAt + 48 h`; met by `firstSeen.at`.
- note due = `firstSeen.at + 24 h`; met by the first `messages` entry `note`; if she said No: met by the note's
  signing, shown as "not sent – she did not agree" (never a miss).
- discharge due = `discharge.dischargedAt + 24 h`; met by `messages` `discharge`; same rule for a No.
- Each promise: `{key, due, doneAt, state}`, state 'not_started' | 'waiting' | 'soon' (under a quarter of the time
  left) | 'late' | 'met' | 'met_late' | 'not_needed' | 'no_consent'. A cancelled referral has no clocks.

### API (`/api/referrals`, role guard `REFERRAL_ROLES`)
- `GET /settings-view` → `{centres, deskNumber, consultantLines: [{userId, name, phone, note}], reasons}` (for forms).
- `GET /` `?list=open|late|closed|all&patientId=&referringDoctorId=` → `{referrals: [listView]}`; listView = `{id,
  number, centre, status, urgency, receivedAt, referringDoctor {id, name, clinic}, patient {id, fullName, mrn,
  ageYears}|null, guest, consultant {id, name}, promises: [...], next: {key, due, state}|null, sharing, waiting:
  {replyToSend, noteToWrite, noteToRelease, dischargeToRelease, toSend}}` – only the referrals this person may open.
- `POST /` (desk, doctor, rmo) `{clientRequestId, referringDoctorId, receivedAt?, via, urgency, centre, patientId? |
  guest?, reasons, otherReason, question, sent, consultantId}` → 201 `{referral}`.
- `GET /:id` → `{referral: fullView}` (adds `appointment {date, start, doctorName, status}`, attachments, note,
  releases, messages, reviews, access `{canEdit, canWriteNote, canSignNote, canRelease, canAnswerSharing,
  canMarkSent, canClose, canReview}`); audit `REFERRAL_VIEWED`.
- `PUT /:id` `{rev, ...intake fields}` (open only).
- `POST /:id/link` `{patientId}` – the registered patient (refused on a duplicate or closed record).
- `POST /:id/book` `{doctorId, date, start, visitType, confirm}` → books through `bookSlot` (patient, or the guest)
  and stores `appointmentId`; 409 `SLOT_TAKEN`/`ALREADY_BOOKED` with `confirmable`.
- `POST /:id/attachments` (8 MB body) `{fileName, mediaType, data}`; `GET /:id/attachments/:fileId` (file).
- `POST /:id/sharing` `{answer: 'yes'|'no'}`.
- `PUT /:id/note` `{rev, ...note fields}` (her doctor or an RMO; draft only); `POST /:id/note/from-visit` (fills an
  empty draft from her first visit after the referral – never the private note); `POST /:id/note/sign` `{rev}` (a
  doctor; needs findings, diagnosis, plan, returnsToYouFor); `POST /:id/note/additions` `{text}`.
- `POST /:id/releases` (8 MB body) `{kind: 'note'|'discharge', fileName, mediaType: 'application/pdf', data}` – a
  signed note, or a confirmed discharge card; an earlier release of the same kind is marked superseded;
  `GET /:id/releases/:fileId` (file, for the desk).
- `POST /:id/messages` `{what, releaseFileId?}` – marked sent by hand (a note or discharge only with her Yes and a
  release; an `other` message for anything else).
- `POST /:id/reviews` `{promise, wentWrong, changed}` (doctors, RMOs).
- `POST /:id/close` `{reason}`, `POST /:id/cancel` `{reason}`.
- `GET /review?week=YYYY-MM-DD` → the referrals with a promise due in that week (Mon–Sun) that was missed, with
  their reviews.
- `GET /worklist` → counts for Today: `{replies, late, notesToWrite, toRelease, toSend}` (desk: replies, late, toSend;
  doctors: notesToWrite, toRelease for their patients).

`/api/referring-doctors` (REFERRAL_ROLES): `GET /?search=&active=` `{doctors}`, `POST /`, `PUT /:id`,
`GET /:id/summary?quarter=YYYY-Qn` → `{doctor, quarter, referrals: [{number, receivedAt, patient (only with her
Yes), reason, outcome (the signed note's diagnosis, with her Yes), returnsToYouFor, promises}], counts}`.

### Audit (ids only; `AUDIT_CATEGORIES.patients`, own allowlist `REFERRAL_DETAIL_FIELDS = ['patientId', 'mrn',
'referralId', 'what', 'kind', 'answer', 'promise', 'fileId']`; `referralId` hidden from the platform)
`REFERRAL_CREATED, REFERRAL_VIEWED, REFERRAL_UPDATED, REFERRAL_LINKED, REFERRAL_BOOKED, REFERRAL_ATTACHMENT_ADDED,
REFERRAL_ATTACHMENT_OPENED, REFERRAL_SHARING_ANSWERED, REFERRAL_NOTE_SAVED, REFERRAL_NOTE_SIGNED,
REFERRAL_NOTE_ADDITION_ADDED, REFERRAL_PDF_RELEASED, REFERRAL_PDF_OPENED, REFERRAL_MESSAGE_SENT,
REFERRAL_REVIEW_ADDED, REFERRAL_CLOSED, REFERRAL_CANCELLED, REFERRING_DOCTOR_ADDED, REFERRING_DOCTOR_UPDATED,
REFERRAL_SUMMARY_VIEWED`; `REFERRAL_SETTINGS_CHANGED` in `access`.

### Screens
- Menu **Referrals** (desk, doctors, RMOs): **Desk** (open referrals with their next promise and clock; Late; Closed),
  **Referring doctors**, **Weekly review**, **Referral slip** (printable).
- **New referral** form; **referral page**: patient (find or register → link), booking (doctor, day, free times),
  her Yes/No, the promises with their clocks, attachments, **Reply** (copy text + open chat + mark sent), consultant
  note (draft from her first visit, edit, sign, release PDF), discharge card release, messages, weekly review notes,
  close.
- Hospital admin → **Referrals** settings tab.
- Today: desk tiles (replies due, late, to send); doctors: "Consultant notes to write", "PDFs to release".
- The patient record (doctors, RMOs): a **Referrals** tab when she has any.
