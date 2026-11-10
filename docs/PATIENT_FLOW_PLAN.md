# Patient timeline and waiting times – asked 10 Nov 2026 (first version built in perinexa1 on 10 Nov 2026 – section 9)

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, commit 0f2a14cd).** Written against the
> other Perinexa copy; read these differences before building:
> - **Super admin.** Decision 3 relies on "the super admin never sees patient data". In perinexa1 a super admin may
>   open a hospital and work there with every role (`docs/HANDOVER.md`, "Super admin and platform admin"). The
>   numbers-only rule for the super admin must still hold for this feature – ask the owner if that changes anything.
> - **What is already noted (section 3) needs a second look in perinexa1**: it also has "Mark left"
>   (`PATIENT_LEFT_MARKED`), tokens and the queue-time message (`TOKEN_GIVEN`, `QUEUE_TIME_SENT`) and its own arrival
>   record (`server/src/models/Arrival.js`), so fewer moments may be missing than the table says.
> - The code paths named below (`server/src/analytics/…`, `auditFormat.js`) exist in perinexa1 too. The ideas list in
>   this repository is `docs/IDEAS_FOR_LATER.md`. Nothing is built; it waits for the health check.

Written 10 Nov 2026 at the owner's request. The owner's words: a timeline "so that wherever there is point of contact
of patient in hospital time should be noted so that superadmin and doctor can track where the delay was", and a
section in Analytics that tells "how much time is required for registration or from registration to RMO login or from
RMO login to doctor login or from patient coming to hospital at reception to patient going out after taking medicines
from pharmacy".

**Nothing is built.** The owner chose the ideas list (decision 1 below): the feature pause holds until the
developer's health check. This document holds the owner's seven decisions (section 1), what Perinexa already notes
today (section 2), and a proposal for the developer (sections 3 to 7) with the points still open (section 8).
Sections 3 to 7 follow from the decisions but their details are **a proposal, not yet confirmed by the owner**.

Scope: an outpatient's day (OPD) – from reception to the pharmacy. Inpatient stays and the labour room are not part
of it (section 8, point 7).

## 1. The owner's decisions (10 Nov 2026)

1. **Not built now.** It goes on the ideas list (`docs/IDEAS_FOR_LATER.md`).
2. **"RMO login" and "doctor login" mean the moment the RMO, and then the doctor, starts seeing that patient** – not
   signing in to Perinexa in the morning.
3. **Who sees it.**
   - One patient's own timeline: **her doctor only**, on her record, under the same need-to-know rule as the rest of
     her record, and every look is written in the audit log.
   - The numbers in Analytics: **doctors, the hospital admin and the super admin.**
   - The super admin and the hospital admin get **numbers only** – never a name, a record number or one patient's
     timeline. The owner first asked for "only superadmin and doctor"; the standing rule that the super admin never
     sees patient data was explained and stays, and the owner added the hospital admin.
   - RMOs, nurses, reception, the lab and the pharmacy see none of it.
4. **Times are noted automatically** from what staff already do. No "Arrived", "Start" or "Left" buttons. "Left the
   hospital" is taken as the last noted step of the day (usually the pharmacy sale).
5. **Stages measured.** The owner's four:
   1. time to register,
   2. registration → the RMO starts seeing her,
   3. the RMO → the doctor starts seeing her,
   4. arrival at reception → leaving the pharmacy with her medicines;

   and five more chosen from a list: time with the doctor, the pharmacy wait, the billing wait, the lab (order →
   sample, sample → report) and vitals (arrival → the nurse records them).
6. **Stages only, no split by person.** Analytics shows each stage by hour of the day and day of the week. It does
   not rank or name doctors, RMOs, nurses, receptionists or pharmacists. A split by person can be asked for later.
7. **What counts as a delay: both ways.** From the start, a stage is marked when it took clearly longer than the
   hospital's own usual time. Limits in minutes per stage can be set later for the stages that matter most.

## 2. What Perinexa notes today

Read in the code on 10 Nov 2026 (branch `ideas-plan-table`). Every time is the server's clock.

| Moment in her OPD day | Noted? | Where | Caveat |
| --- | --- | --- | --- |
| Appointment booked, token given | Yes | `Appointment.created.at`; audit `APPOINTMENT_BOOKED`, `TOKEN_GIVEN` | A walk-in gets a token only when reception picks a doctor |
| Registration form opened (new patient) | **No** | – | Nothing is saved before the record exists |
| Registration saved (new patient) | Yes | `Patient.createdAt`; audit `PATIENT_CREATED` | Once in her life; a returning patient has no registration on the day |
| Arrived at reception | Yes, when pressed | `Arrival.at` (one per patient per day) | "Mark arrived" is optional – a visit can start without it. Undo deletes the row |
| Called in / waiting states | **No** | worked out live from arrivals and visits | No history of the queue |
| Visit started | Yes | `Visit.createdAt`, `createdBy` | By a nurse, an RMO or a doctor – the role is not kept |
| Vitals recorded | Last save only | `Visit.vitals.at` | The first save is only in the audit log (`VISIT_UPDATED`, sections) |
| RMO starts seeing her | **No** | – | Only "who saved last" and the audit log, which holds no role |
| Doctor starts seeing her | **No** | – | Same. `signed.role` says who signed, at the end |
| Prescription printed, saved or sent | Audit only | `PRESCRIPTION_PRINTED`, `PRESCRIPTION_PDF_SAVED`, `*_SENT_WHATSAPP` | Not on the visit itself |
| Visit signed | Yes | `Visit.signed.at`, `signed.role` | Signing may happen much later in the day |
| Lab ordered, sample taken, reported, reviewed | Yes | `LabOrder.ordered.at`, `collected.at`, `reported.at`, `reviewed.at` | `collectedAtReport` = the sample time is not known |
| Bill opened, payment received | Yes | `Bill.createdAt`, `Bill.payments[].at` | A fee paid in advance at booking is also a payment |
| Medicines sold | Yes | `PharmacyInvoice.created.at` (`patientId`, `visitId` when sold from the prescription) | A registered patient pays for them on her hospital bill |
| Left the pharmacy / the hospital | **No** | – | Nearest: the sale or the last payment |

Analytics has no waiting time or turnaround today. The nearest patterns: card H9 (caesarean decision to delivery, in
minutes – `server/src/analytics/metrics/deliveries.js`) and card G3 (a median with a minimum count –
`metrics/newborn.js`, `MEDIAN_MIN_N`).

**So four moments are missing:** registration started, the first vitals, the RMO starts, the doctor starts. "Left" is
worked out, by decision 4. Everything else exists and only needs reading.

## 3. The moments and how each is noted (proposal)

No new button anywhere. Times come from the server's clock (`req.now`), never from the browser's.

| # | Moment | How it is noted | New? |
| --- | --- | --- | --- |
| a | Registration started (new patient) | The registration form counts the seconds it has been open and sends that number with Save; the server works out the start from its own clock. More than 60 minutes = left open, not counted | New |
| b | Registration saved | `Patient.createdAt` | Exists |
| c | Arrived at reception | `Arrival.at`. For a new patient registered today with no "Mark arrived": the registration start (a) | Exists |
| d | Vitals first recorded | Set once, on the first save of vitals in today's visit | New |
| e | RMO starts seeing her | Set once, the first time a person with the RMO role (and not the doctor role) opens today's visit while it can still be written | New |
| f | Doctor starts seeing her | Set once, the first time a person with the doctor role opens today's visit while it can still be written | New |
| g | Visit finished | The earliest of: prescription first printed, saved as PDF or sent; visit signed | New stamp of an existing action |
| h | Bill paid | The first payment on her OPD bill after she arrived (an advance fee at booking does not count) | Exists |
| i | Lab: ordered, sample taken, reported | `LabOrder` stamps of orders of that day | Exists |
| j | Medicines sold | The first pharmacy sale to her that day | Exists |
| k | Left | The last of g, h and j | Worked out |

Proposal for storing the new moments: a small `flow` part on the visit (`vitalsFirstAt`, `rmoFirstAt`, `doctorFirstAt`,
`finishedAt`, and the role of whoever started the visit), each written once and never changed, and the registration
seconds on the patient. **The role is kept, not the person** – enough for the stages, and in line with decision 6.
The existing moments are read from their own records when the timeline is asked for, so there is one truth and
nothing to keep in step. The developer decides the storage (section 8, point 1).

## 4. The stages and how each is measured (proposal)

| Stage | From → to | Notes |
| --- | --- | --- |
| 1. Registration | a → b | New patients only. A returning patient is only marked arrived |
| 2. Reception to RMO | reception finished (the later of b and c) → e | The owner's "registration to RMO login". Returning patients: from "Mark arrived" |
| 3. RMO to doctor | e → f | Only when both saw her |
| 3b. Reception to doctor, no RMO | reception finished → f | When the doctor sees her directly; shown as its own row so that it does not blur stage 3 |
| 4. Whole visit | c → k | The owner's "reception to going out of the pharmacy". Shown twice: all visits, and visits with a pharmacy sale |
| 5. Vitals | c → d | |
| 6. With the doctor | f → g | |
| 7. Pharmacy wait | g → j | Only when medicines were sold here |
| 8. Billing wait | g → h | Only when a payment was taken after the visit |
| 9. Lab | ordered → sample; sample → report | In hours when the report comes another day; not part of stage 4 |

A stage with a missing end, or with times in the wrong order, is "not known" for that visit and is left out of the
numbers – never guessed.

## 5. One patient's timeline, for her doctor (proposal)

- **Where:** on each visit in her record (Visits tab and the visit page), a line "Time in hospital": Arrived 10:02 ·
  Vitals 10:10 · RMO 10:25 · Doctor 11:05 · Finished 11:20 · Bill paid 11:26 · Medicines 11:34 · 1 h 32 min in all,
  with the minutes of each stage.
- **Delay mark:** a stage that took longer than usual carries colour + icon + the words "Longer than usual"
  (`docs/BRAND.md`); with a limit set, "Over the limit of 30 min". "Usual" = longer than 9 of 10 visits of the last
  three finished months in this hospital; no mark until there are enough visits (suggested: 30).
- **Who:** a person with the doctor role who may see her clinical record (`patientAccess`, `view.has('pregnancy')`):
  her treating doctor, or another doctor through the existing read-only and emergency-access rules. Not RMOs, nurses,
  reception or the hospital admin; never the super admin.
- **Server:** its own endpoint under the patient (`tenantId` in every query), 403 for every other role, and its own
  audit action (for example `VISIT_TIMELINE_VIEWED`, with its plain name in `client/src/components/auditFormat.js`
  and in the copied list in `auditFormat.test.js`).
- **What it shows:** times and stage names only. No names of staff (decision 6) and no clinical content.

## 6. The Analytics section "Waiting times" (proposal)

A new tab at the **end** of `SECTIONS` (`server/src/analytics/registry.js` explains why new tabs go last), in
`analyticsFormat.js` and in `analyticsModuleTabs()`.

- **Per stage:** the usual time (median), the slow time (9 of 10 visits are within it), the number of visits
  measured, and the share over the limit when a limit is set. The stage with the longest usual wait is marked
  "Longest wait".
- **Splits:** by hour of arrival and by day of the week (hospital time, `HOSPITAL_TIME_ZONE`), and by month for the
  trend. No split by person (decision 6).
- **How complete the numbers are**, shown beside them: the share of visits with the arrival marked, with a
  prescription printed or signed the same day, and with a pharmacy sale. A low share means the number is weak, and
  says which habit to fix (for example reception not pressing "Mark arrived").

Who gets what, with the existing audiences (`server/src/analytics/roles.js`):

| Audience | Sees | Protection |
| --- | --- | --- |
| Doctor | Exact numbers, any period the other tabs allow; from a stage, the list of the slowest visits | Only patients she may see, as on every other tab (`analytics/visibility.js`); a list is doctors-only (`DRILLDOWN_ROLES`) and audited (`ANALYTICS_LIST_VIEWED`) |
| Hospital admin | The same numbers for whole finished months; no patient list | A median or a slow time only from a minimum number of visits (as G3: `adminView.DERIVED`, `MEDIAN_MIN_N`); smaller cells read "Too few visits to show"; counts go through the existing masking or are rounded |
| Super admin | Per hospital and all hospitals together: whole finished months, rounded minutes, numbers only | The `platformTotals.js` path: nothing but numbers leaves the hospital's computation; no ids, names, record numbers or lists; no hour-by-hour cell below the minimum |

Technical notes for the developer:

- The masking graph (`mask.js`) protects counts. Durations must travel like G3's median (an `extras` value with a
  rule in `adminView.DERIVED`); the admin path must go on failing closed.
- New loaders are needed in `analytics/load.js` (`NEEDS` has no arrivals, bills, pharmacy invoices or lab orders
  today), each naming the hospital; any `aggregate()` starts with its own `$match` on `tenantId`.
- The audit log is not a good source for these numbers: its entries hold no role, `details.patientId` has no index,
  and `PATIENT_ARRIVED` is written again on a second press.
- Limits (decision 7): a small table per hospital – stage → minutes – changed by a doctor or the hospital admin
  (section 8, point 8), each change in the audit log.

## 7. Privacy and safety – what must hold

- **The super admin never sees patient data.** Numbers only, through the platform path. No timeline of one patient,
  no list, no record number.
- **Hospital separation.** Every new query names the hospital (`tenantScoped`); every `aggregate()` has its own
  `tenantId` match; the new fields are part of the hospital export.
- **Need-to-know.** One patient's timeline follows `patientAccess`; sensitive records stay with their doctor; it is
  not shown to roles that cannot see her visits.
- **Audit log.** Opening a timeline and opening the Analytics tab are logged (`ANALYTICS_VIEWED` is throttled as
  today). Nothing here trims or replaces the audit log.
- **Staff.** Even without names, in a small hospital a stage can be one person (one pharmacist, one receptionist).
  The owner should tell the staff that stage times are measured and why – to find queues, not to rank people. A slow
  number often means a hard case. The new stamps keep the role, not the person.
- **Not clinical content,** but a timeline shows that she came and when: it is part of her record and is treated
  like it. The fetal-sex protection and the neutral name for HIV tests are not touched – the timeline carries no
  test names (the lab stage says "Lab" only).
- **Fake data only** until the go-live checklist is complete.

## 8. Still open

For the developer:

1. **Storage.** A `flow` part on the visit (proposed) or a record of its own per patient per day; whether to keep a
   ready-made row per visit for speed (health check: speed with large amounts of data).
2. **"Starts seeing her" = first opens today's visit** (as put to the owner in decision 4). A doctor who opens a
   record early from the worklist makes the wait look shorter; the alternative is the first typing or save, which
   makes it look longer. Try both against a stop-watch for a week before the numbers are trusted.
3. **A person with both roles** counts as the doctor, as when signing (`signed.role`). A hospital with no RMO has
   only stage 3b.
4. **The minimum counts** for the hospital admin and the super admin (per stage, and per hour or weekday cell), and
   the rounding of minutes for the super admin.
5. **No back-filling.** The four missing moments exist only from the day this is switched on. Older days could show
   arrival, bill and pharmacy times only; suggested: start clean from the switch-on day.

For the owner, when it is taken up:

6. Confirm sections 3 to 6: the moments, the nine stages, the "Time in hospital" line, the Analytics tab.
7. **Other patients.** A patient who comes only for the lab, a scan or the pharmacy; the second visit on the same
   day; emergencies and the labour room; admitted patients. First version: OPD visits only.
8. **Who sets the limits** in minutes (decision 7) – doctors, the hospital admin, or both – and the first limits.
9. **Reception's habit.** The whole-visit time (stage 4) is only as good as "Mark arrived". Whether reception must
   mark every patient arrived before a visit can start is a change to their work – the owner's call.
10. **Telling the staff** (section 7) before it is switched on.

## 9. Built in perinexa1 (10 Nov 2026) – first version

The owner agreed to build it now. Built as sections 3 to 6 propose, for **OPD visits only** (point 7), with these
choices for the open points:

- **Storage (point 1):** a `flow` part on the visit (`startedRole`, `vitalsFirstAt`, `rmoFirstAt`, `doctorFirstAt`,
  `finishedAt`), each written once with an update that only matches while the field is empty; and
  `Patient.registrationStartedAt` from the seconds the New patient form was open (more than an hour: not kept). The
  other moments are read from their own records. No ready-made rows (speed: for the health check).
- **"Starts seeing her" (point 2):** the first time an RMO (without the doctor role) or a doctor **opens** the visit
  on its own day while it can still be written. A person with both roles counts as the doctor (point 3). Platform
  users working in a hospital are not counted.
- **Finished (moment g):** the first of prescription or summary printed, saved as PDF or sent on WhatsApp, or the
  visit signed.
- **Time in hospital** on the visit page: a fold-out panel that loads when opened (each look is
  `VISIT_TIMELINE_VIEWED` in the audit log). Doctor role only; **never** a super admin or platform admin, also inside
  a hospital (developer's decision); 403 for RMOs, nurses, reception and the hospital admin. Times and stage names
  only. "Longer than usual" = over the time 9 of 10 visits of the last three finished months took, from 30 visits per
  stage; worked out once a day per hospital.
- **Waiting times** is a page of its own under Analytics (tab "Waiting times"), not a card of the existing tabs: the
  tabs' protection (`mask.js`) is built for counts and stays exactly as it was. Doctors: exact numbers, "This month
  so far" too, only patients they may see (`visibility.js`). Hospital admin: whole finished months; a usual or slow
  time only from 10 visits (`WAIT_MIN_N`), otherwise "Too few visits to show"; counts rounded to 5. Super admin
  (Platform → Analytics → Waiting times): the same, per hospital and all hospitals, numbers only. By stage, by hour of
  arrival, by weekday, by month, and how complete the numbers are.
- **Not in this first version:** limits in minutes per stage (decision 7, "later"); the list of the slowest visits for
  doctors; the second visit of a day, lab-only or pharmacy-only patients, emergencies and admitted patients; no
  back-filling (point 5) – the four new moments exist from 10 Nov 2026.
- **Still for the owner:** points 6, 8, 9 and 10 above – above all, **tell the staff** that stage times are measured
  before this is used.

Code: `server/src/visits/flow.js` (moments, stages, loading), `server/src/analytics/waitingTimes.js` (the numbers and
who sees what), the routes `GET /api/patients/:id/visits/:visitId/timeline`, `GET /api/analytics/waiting-times`,
`GET /api/platform/analytics/waiting-times`; website `VisitTimeline.jsx`, `WaitingTimesPage.jsx`. Tests:
`server/tests/patient-timeline.test.js`, `client/src/pages/visits/visitTimelineFormat.test.js`.

