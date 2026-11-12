# Lab module: four features for the developer to build

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-pathology-apps-review`,
> commit 6e7fb66c).** Written against the other Perinexa copy. Perinexa1's lab has grown further: the hospital's own
> test list and usual ranges (Lab setup – `server/src/routes/labSetup.js`, `docs/LAB_LIMS_PLAN.md`,
> `docs/LAB_V2_PLAN.md`), sample numbers and labels, the check before the report, outside labs, QC
> (`labQc.js`), stock (`labStock.js`) and packages. Read section 1 ("what exists") again against this code before
> building – for example the test list is not only in `lab/labTests.js` here. The ideas list in this repository is
> `docs/IDEAS_FOR_LATER.md`. **Built on 10 Nov 2026 (branch `lab-four`) without the clinical numbers – see section 0.**

Written 10 Nov 2026 for the developer, at the owner's request. After a review of pathology laboratory software
(`docs/PATHOLOGY_APPS_REVIEW.md`), the owner chose **four features and only these four** for the lab module:

| # | Feature | In one line |
| --- | --- | --- |
| P4 | **Usual ranges that fit the patient** | A result is judged against the range for her state – pregnant by weeks, after delivery, not pregnant – and a baby's by its age |
| P5 | **Critical results with a record of the call** | The lab cannot finish a critical result without noting whom it told and when; the doctor acknowledges it; the minutes are counted |
| P6 | **Earlier results, a graph, and a second look at a big change** | The last values beside today's, a graph over time, and a question to the lab when a result is far from the last one |
| P9 | **Time taken** | An expected time for each test, what is late in the Lab list, and the lab's times in Analytics |

**Built in perinexa1 on 10 Nov 2026 (section 0)**, with every clinical number left for the owner (section 7). The numbers P4, P5, P6 and P9 are the owner's names for them and are kept so that both mean the same
thing. Sections 2 to 6 are written engineer to engineer; section 7 is the owner's part.

## 0. Built in perinexa1 (10 Nov 2026, branch `lab-four`) – what differs from this note

The four features are built with **no clinical numbers filled in** (section 7 is still the owner's). Against the note:
- **P4** – perinexa1 already had group ranges (age, sex, pregnant or not – `lab/labSetup.js` bands, DRAFT and approved
  per test in Lab → Tests). Added to them: `fromWeeks` / `toWeeks` (only with "pregnant"; weeks from `eddInUse` on the
  sample's day) and `pregnant: 'postnatal'` (after delivery). The context is worked out at the sample's time
  (`sampleTime` in `routes/lab.js`). Each value keeps `range` (words without the weeks – what the lab sees and the
  report prints) and `rangeWho` ("Pregnant, 14–27 weeks" – clinical users only). The red-flag rules that read each value
  are shown beside its ranges for doctors (12 Nov 2026, `redFlagsByValue` in `routes/labSetup.js`; never for lab staff).
- **P5** – the critical limits are `criticalLow` / `criticalHigh` on a number value **in the hospital's test settings**
  (`LabTestSetting`, the same DRAFT → doctor-approved versions as the ranges) rather than a separate list document.
  Critical *choices* (12 Nov 2026): `criticalOptions` on a choice value, in the same settings, empty until the
  hospital lists some; never on a confidential test (HIV). The order keeps
  `critical { values, calls, notReached, acknowledged, open }`; `PUT /results` (report or amendment) and
  `POST /verify` (the hospital's check) answer `409 CRITICAL_CALL` without a call or a not-reached note;
  `POST /orders/:id/critical-call` and `POST /orders/:id/acknowledge` (whoever may review; reviewing also
  acknowledges). The worklist has a `critical` list. An RMO may also acknowledge when a doctor turns on Lab → Settings → "An RMO may also acknowledge"
  (`LabSetup.rmoAcknowledges`, off by default – the owner's choice, 12 Nov 2026).
- **P6** – perinexa1 already had her earlier results beside each value and a "Big change" mark (`deltaPercent`, Lab
  version 2). Added: the question before the report (`409 DELTA_CHECK` unless `deltaConfirmed`; kept in
  `order.deltaChecks`, audited `LAB_DELTA_CONFIRMED`), asked once per value; Results over time and inline-SVG graphs on
  the Lab tab (`LabTrends.jsx`, `GRAPH_VALUES` in `labFormat.js` – the proposed set). Added 12 Nov 2026: a big change by an amount
  (`deltaAmount`, in the value's unit) and only against a result of the last N days (`deltaWithinDays`); the graphs
  show the weeks of pregnancy under the dates for clinical users and a baby's bilirubin against its age in hours.
- **P9** – perinexa1 already had due times per test (`tatHours`, `urgentTatHours`, `dueAt`) and the Late mark in the
  lists. Added: `firstReported` and **Analytics → Lab times** (`analytics/labTimes.js`, its own page beside Waiting
  times, the same protection). Old orders: `reported` when never amended, else the first `LAB_RESULTS_REPORTED` in the audit log (12 Nov 2026)
  where the log still has it. The lab's list shows how long each open order has waited (12 Nov 2026). Closed hours are counted (open point), and the lab in-charge sees no figures.
- Tests: `server/tests/lab-four.test.js`.

## 1. What exists today (read in the code, 10 Nov 2026)

- **One document per order** – `server/src/models/LabOrder.js`: `tests[].values[] = { key, value, flag }`, statuses
  `ordered → collected → reported → reviewed` (or `cancelled`), stamps `ordered`, `collected`, `reported`, `reviewed`
  (`{ by, byName, at }`), `amendments[]`, `abnormal`, `urgent`, `rev`.
- **The test list is in code** – `server/src/lab/labTests.js` (28 adult tests) and `lab/newbornTests.js` (14 baby
  tests and checks). A number field has one `low`, one `high` and a `range` text; `flagFor(field, value)` gives
  `low | high | abnormal | normal | ''`. The website has its own copy in `client/src/pages/lab/labFormat.js`.
- **Routes** – `server/src/routes/lab.js`: `labAccess(req, patient)` decides who may do what; `PUT
  /orders/:id/results` checks and stores the values (`checkedTests`), sets `abnormal`, and with `report: true` moves
  the order to `reported`; `POST /orders/:id/review` needs a comment when `abnormal`; `GET /worklist` and `GET
  /to-review` feed the Lab list and the doctor's Today page (`client/src/pages/TodayPage.jsx`).
- **Lab staff see little on purpose** – `patientBrief`: name, patient number, age (none for a baby), her doctor's
  name. Not her weeks, not her record, not the package name that says why she is tested.
- **Red flags already read lab values** – `labReadings` in `server/src/redflags/redFlags.js` takes the latest
  reported value of eleven lab factors (`LAB_FACTOR_SOURCES`: Hb, platelets, four sugars, TSH, urine albumin, a baby's
  sugar and bilirubin) with the sample date and the baby's age, and the hospital's approved rule set
  (`RedFlagRuleSet`) turns them into Urgent or Watch flags for doctors, RMOs and nurses – never for the lab.
- **Other readers of lab results**, which any change to values or flags reaches: the care plan
  (`careplans/readings.js`, `plansService.js` – a reviewed Hb counts for the risk level), ABDM sharing
  (`abdm/shareRules.js`), the copy of the whole record (`patients/recordCopyView.js`), the hospital export, the
  monthly report, the AI context (`ai/askContext.js`).
- **Analytics** – `server/src/analytics/`: cards are registered in `registry.js` (`SECTIONS`, `METRICS`), audiences in
  `roles.js` (doctors exact numbers; hospital admins whole finished months with 1–4 shown as "fewer than 5" –
  `adminView.js`, `mask.js`; the super admin totals only).

Three limits of today's module that these four features have to live with, not solve:

- The test list stays in code. Ranges, critical limits and expected times are therefore added to the catalogue
  entries and, where a hospital must be able to change them, kept in a small per-hospital document.
- An order is reported as a whole. A culture in the same order as a blood count holds the whole order back, so times
  are counted per order.
- Adults have no sex field (and must not get one for this): every adult patient is a woman, a semen test is her
  partner's, and a baby's sex exists only after birth.

## 2. Suggested order

1. **P6 first, the reading part** – a helper that returns the earlier values of a test for a patient. P4, P5 and the
   delta check all show or use earlier values, and it changes no stored data.
2. **P9** – one new stamp, expected times, a mark in the Lab list, one Analytics tab.
3. **P4** – the change to how a flag is worked out; touches both copies of `flagFor`.
4. **P5** – builds on the stamps of P9 and on the flag of P4; adds the one new write path.
5. **P6, the delta check** – last, when P5's "the lab must confirm before reporting" step exists to hang it on.

One branch per feature, as `CLAUDE.md` asks.

## 3. P6 – earlier results, a graph, a second look at a big change

**What the user sees**
- *Lab, entering a result:* beside each value, the last three reported values of **the same test** with their dates.
- *Doctor, reviewing (Today and the patient's Lab tab):* the same, and a **Results over time** table on the Lab tab –
  one row per value, one column per date.
- *A graph* for the values that are followed over time. Proposed first set: haemoglobin, platelets, TSH, beta hCG,
  fasting and post-meal sugar, a baby's bilirubin and sugar. The horizontal axis is the date, with the weeks of
  pregnancy under it for clinical users; a baby's bilirubin is drawn against its age in hours.
- *Delta check:* when the lab presses **Report results** and a value is far from her last one, a question – "Hb 7.1
  g/dL; it was 11.8 on 29 Oct. Check the sample and the number." – with **Change** and **Confirm and report**. It
  never blocks, and it asks once.

**Building it**
- A pure function beside `labReadings`, for example `labHistory(orders, { testKey, valueKey, before, limit })`: only
  `reported` and `reviewed` orders, their current values (an amended report has replaced the earlier ones), the
  sample time by the same rule `labReadings` uses (`collectedAtReport`). Query by `{ tenantId, patientId }` – the
  index exists – and filter in memory; a patient has few orders.
- Send the history with the order: `orderView` gains `history` per value. Lab staff get the same test's earlier
  values only – the lab's own earlier work – and nothing of other tests. On a record marked sensitive, and for a
  record marked as a duplicate, follow what the existing lists do; earlier values of the other record of a duplicate
  pair are **not** joined (the red flags do not join them either – `docs/PROGRESS.md`, "Red flags are not joined").
- The graph: inline SVG, no charting library (a new dependency needs her agreement). Status by colour, icon and word
  (`docs/BRAND.md`); colours from `tokens.css`.
- Delta rules as data on the catalogue field: `delta: { mode: 'absolute' | 'percent', limit, withinDays }`. The
  server works it out in `PUT /results` when `report` is true and answers `409` with code `DELTA_CHECK` and the
  earlier value unless the body carries `deltaConfirmed: true`; the confirmation is stored on the order (`who, when,
  which values`) and audited (`LAB_DELTA_CONFIRMED`, ids only).
- No delta check across the birth of a baby's mother and her baby (different records anyway), and none when the
  earlier value is older than `withinDays`.

**Tests**: the history leaves out saved-but-not-reported and cancelled orders; an amended value replaces the old one;
lab staff never receive another test's values; the delta question appears once and its confirmation is stored.

## 4. P9 – time taken

**What the user sees**
- *Lab list:* each order shows how long it has waited and, when it is past its expected time, a **Late** mark
  (colour, icon and word). Urgent orders keep their place at the top.
- *Analytics, a new Lab tab:* order → sample, sample → report, report → doctor's review, and order → report as a
  whole; the median and the share that was late; by test group, by month, by hour of the day and day of the week;
  urgent orders separately. After P5: report → first call and report → acknowledgement for critical results.

**Building it**
- **A stamp is missing.** When a reported result is amended, `PUT /results` writes `order.reported = stampOf(req)`
  again, so the time of the first report is lost. Add `firstReported` (set once, never changed) and count times from
  it. For old orders: without amendments it equals `reported`; with amendments it can be taken from the audit entry
  `LAB_RESULTS_REPORTED` of that `orderId` where the log still has it, otherwise the order is left out of the
  figures.
- **Sample time is not always known.** When the lab reports without marking the sample taken, `collected` is stamped
  by the report (`collectedAtReport`, and on orders before 5 Oct 2026 `collected.at === reported.at`). Leave these
  out of "order → sample" and "sample → report"; they still count for "order → report".
- **Expected times** as data on the catalogue entry – `expect: { routineHours, urgentHours }` – with a per-hospital
  override (hospital admin, in Settings). An order's expected time is the longest of its tests. These are the
  hospital's own targets, not clinical content; the catalogue ships with none filled in until the owner gives them.
- **Analytics**: add `'lab'` at the **end** of `SECTIONS` (the comment in `registry.js` says why) and a
  `metrics/lab.js`. Audiences as for the other tabs: doctors, hospital admins (whole finished months, small numbers
  masked – a median over fewer than five orders must be hidden too, not only a count), super admin totals only.
  Every `aggregate()` needs its own `tenantId` match.
- **The owner's decisions for the patient timeline apply** (`docs/PATIENT_FLOW_PLAN.md`, decisions 3, 6 and 7): no
  figure per named person – not per technician, not per doctor; a stage is "late" against the hospital's own usual
  time until limits are set; RMOs, nurses, reception and the lab get no Analytics. The lab sees its late orders in
  the Lab list, not the figures.
- Clock time is counted, day and night, as the timeline plan does. Whether the lab's closed hours should be taken
  out is an open point (section 7).

**Tests**: an amended order keeps its first report time; a stamped sample time is left out of the two sample stages;
the admin view hides a median over fewer than five orders; one hospital's orders never count in another's.

## 5. P4 – usual ranges that fit the patient

**What the user sees**
- The Low or High mark, and the range printed beside a value, fit the patient: a pregnant woman's haemoglobin and TSH
  are judged by her weeks; a woman who is not pregnant by the non-pregnant range; a baby by its age.
- A clinical user sees which range was used ("in pregnancy, 14–27 weeks"). The lab sees the numbers of the range
  only.

**Building it**
- **Data.** A field keeps `low`, `high`, `range` as its default and gains an ordered list:
  `ranges: [{ when: { state: 'pregnant' | 'postnatal' | 'not_pregnant' | 'newborn', weeksFrom, weeksTo, ageDaysFrom,
  ageDaysTo }, low, high, range, source }]`. The first entry whose `when` matches wins; none matching falls back to
  the default. Every entry carries its `source` and is DRAFT until the owner approves it.
- **Context** is worked out on the server at the time of the sample (not of typing): the care type, the weeks from
  the EDD (`gaOn(edd, date)` in `careplans/dates.js`), the baby's age (the lab's `ageHours` value first, then
  `newborn.birthAt` – the same order `labReadings` uses). No EDD: the general "in pregnancy" entry, and say so.
- **`flagFor(field, value, context)`** on the server is the authority. The website's copy in `labFormat.js` suggests
  a flag while typing, but it cannot know the weeks for lab staff – so the server sends, with the order, the range
  already chosen for each field (`low`, `high`, `range`), and the website uses that. Keep the test that checks both
  copies agree.
- **Need-to-know.** A range labelled "in pregnancy, 14–27 weeks" tells the lab she is pregnant and how far. Lab
  staff receive the chosen numbers without the label; clinical users receive the label too. The same care applies
  to anything printed for the lab.
- **Snapshot.** Store with each value what it was judged against (`rangeText`, and the entry's key or `when`). A
  later change of a range must not re-judge an old result; the record copy, ABDM sharing, P6's history and the
  export then show each value with the range of its day. Old results keep their stored flag and show no label.
- **The lab can still change the flag**, as today.
- **Keep the ranges and the red-flag rules from contradicting each other.** A haemoglobin of 10.6 at 20 weeks would
  be "normal" by a second-trimester limit of 10.5 while the hospital's approved rule set marks 10–10.9 as Watch.
  Both are the owner's to set; put the two side by side on the screen where ranges are approved.
- Amending an old result keeps the context of its sample time.

**Tests**: each `when` boundary (13+6 and 14+0 weeks, day 2 and day 3 of life); no EDD; a postnatal woman; the lab's
view carries no label; an old result is not re-judged after a range changes; server and website agree.

## 6. P5 – critical results with a record of the call

**What the user sees**
- *Lab:* a value beyond the hospital's critical limit is marked **Critical** (colour, icon, word). **Report results**
  then asks for the call: whom the lab told (name and role), when, how (phone or in person), and a tick that the
  value was read back. If nobody could be reached: who was tried and when – the result is still reported, and it
  stays at the top of the lab's list as "call not completed" until a call is noted.
- *Doctor:* critical results come first on Today, apart from the other results to review, with **Acknowledge** – one
  click that records who and when. The usual review, with its comment, follows as today.
- The minutes from report to first call and to acknowledgement are counted (P9).

**Building it**
- **The list.** Critical limits are the hospital's own and clinical: a per-hospital document in the pattern of
  `RedFlagRuleSet` and `LabPackage` – DRAFT until a doctor approves it, every change a new version, never deleted.
  One row per catalogue field: `{ testKey, valueKey, who: 'adult' | 'newborn', low, high }`, or for a choice field
  the options that count (a baby's blood culture "Growth"). Ship it **empty**; the owner fills it (section 7).
- **Why a second list beside the red flags.** Red-flag rules know her weeks and her record and are never shown to the
  lab; a critical limit is about the number alone and the lab must see it to make the call. Keep them apart, and
  show both on the approval screen so that they do not contradict (as in P4).
- **On the order**: `critical: { values: [{ testKey, valueKey }], calls: [{ toldName, toldRole, how, readBack, at,
  by, byName }], notReached: [{ triedName, at, by, byName }], acknowledged: { by, byName, at } }`.
  `PUT /results` with `report: true` (and an amendment that makes a value critical) refuses without a call or a
  not-reached note – code `CRITICAL_CALL`. A new endpoint adds a call later; another records the acknowledgement.
- **Who may acknowledge** – proposed: whoever may review (`access.review`: her doctor, or any doctor for an
  unassigned patient). Whether an RMO may acknowledge at night is the owner's decision (section 7).
- **The red flags still fire at "reported"** as today; nothing about them changes.
- **Not on this list:** a reactive HIV test and a cancer report are not "critical values" in this sense and must not
  appear in a list that says so on a shared screen. They keep their own paths (the neutral name; the specimen
  tracker).
- **Audit**: `LAB_CRITICAL_CALL_NOTED`, `LAB_CRITICAL_NOT_REACHED`, `LAB_CRITICAL_ACKNOWLEDGED`, ids only; add their
  labels in `client/src/components/auditFormat.js` and its copied list (`docs/HANDOVER.md`).
- The told person's name is typed text about staff, not patient data – still pass it through `safeText`.

**Tests**: a critical value cannot be reported without a call or a not-reached note; an amendment that turns a value
critical asks again; only someone who may review can acknowledge; the lab's view shows no red-flag text; the list is
DRAFT after any change.

## 7. For the owner to decide or approve (the doctor's part)

All of it starts as DRAFT on screen and on paper. Sources were read only as far as marked in section 9.

**P4 – which ranges, from which source**
- *Haemoglobin in pregnancy.* The WHO's 2024 guideline sets anaemia as below 11.0 g/dL in the first and third
  trimesters and below 10.5 in the second [1]. Today Perinexa uses 11 for all of pregnancy. Which should it be – and
  should the Watch rule at 10–10.9 change with it?
- *Haemoglobin, not pregnant.* Today the same "11–16" is used for every adult; the usual limit for a woman who is not
  pregnant is 12 (to be checked – not re-read for this note).
- *TSH in pregnancy.* The American Thyroid Association's 2017 guideline prefers the laboratory's own
  trimester ranges and, without them, allows an upper limit of about 4.0 in the first trimester; other summaries
  still give 2.5, 3.0 and 3.0–3.5 by trimester [2]. The sources disagree – the owner chooses.
- *Which other values change in pregnancy* (creatinine, platelets, uric acid, liver enzymes, fasting sugar) and
  after delivery: the owner's list, each with its source.
- *Babies:* ranges by day of life, with a paediatrician (the baby values are already marked as not reviewed by one).

**P5 – the critical list**
- No Indian consensus list was found. Hospital lists that could be seen differ: haemoglobin below about 6 to 6.5
  g/dL; platelets below 20,000 or 40,000; sugar below 40–50 or above 450–500 mg/dL; a baby's sugar below 30–40
  mg/dL; a baby's bilirubin from 15 mg/dL [3]. The list is the owner's and the pathologist's to write, test by test.
- Who may take the call, and who may acknowledge at night (an RMO, or only a doctor).
- Why it matters: in a Bengaluru teaching hospital 9 % of 4,687 critical results were never passed on, and only 40 %
  of the calls were noted in the laboratory's program [4].

**P6 – the graphs and the limits**
- Which values get a graph (the proposed first set is in section 3).
- The "big change" limits. No published table could be read – the standard on it (CLSI EP33) is sold, not free [5].
  Suggested: start with haemoglobin, platelets and creatinine, with limits the owner and the pathologist set, see how
  often the question appears in the first month, and adjust.
- Whether lab staff may see the earlier values of the same test (proposed: yes).

**P9 – the expected times**
- The expected time for each test, routine and urgent – the hospital's own targets.
- Whether the lab's closed hours count.
- Whether the lab in-charge should see the figures (today the lab has no Analytics).

## 8. Rules that hold throughout

- `tenantScoped` on every new model; a `tenantId` match in every `aggregate()`.
- Need-to-know: lab staff learn nothing new about the patient through a range label, a graph or a history.
- The audit log: every new step, ids only.
- The neutral name for HIV tests on every new list, graph and figure; no fetal-sex words in any new text box
  (`safeText`, `server/src/utils/pcpndt.js`).
- The super admin gets numbers only.
- Clinical content – ranges, critical limits, delta limits – changes only with the owner's approval and stays DRAFT
  until then.
- No new dependency without the developer's agreement; none is needed for these four.
- `npm test` from the project root only; fake data only.
- If the laboratory is or will be NABL accredited: NABL 112A (Dec 2024) has its own demands on critical results and
  turnaround time. It could not be opened for this note and should be read before P5 and P9 are finished [6].

## 9. Sources

"Search summary" means only the search engine's summary of the page was seen – check it before relying on it.

1. WHO 2024 haemoglobin cut-offs in pregnancy – search summaries of Indian Pediatrics, July 2024
   (https://indianpediatrics.net/july2024/671.pdf) and of a cohort study that notes the trimester limits are not yet
   well tested in low- and middle-income countries (https://pmc.ncbi.nlm.nih.gov/articles/PMC12303321/).
2. American Thyroid Association 2017 pregnancy guideline (Alexander et al., Thyroid 2017;27:315–389) – search
   summaries (https://pmc.ncbi.nlm.nih.gov/articles/PMC6358369 ; https://www.frontiersin.org/articles/10.3389/fendo.2018.00432/pdf).
   The summaries contradict each other on the fallback limits; read the guideline itself.
3. Critical value lists of single hospitals – search summaries: Mayo Clinic Laboratories
   (https://www.mayocliniclabs.com/it-mmfiles/DLMP_Critical_Values_-_Critical_Results_List.pdf), Singapore General
   Hospital (https://sgh.com.sg/patient-care/specialties-services/pathology/pages/critical-test-results-and-laboratory-values.aspx).
   Foreign, adult and general – not a list for an Indian maternity hospital.
4. St. John's Medical College, Bengaluru, audit of critical value notification – search summary –
   https://www.stjohns.in/publications/evaluation-of-critical-value-and-urgent-sample-notification-at-clinical-biochemistry-laboratory-in-a-tertiary-care-hospital
5. CLSI EP33, Use of delta checks in the medical laboratory, 2nd edition 2023 – https://clsi.org/shop/standards/ep33/
   (paid; not read).
6. NABL 112A, Specific Criteria for Accreditation of Medical Laboratories, 18 Dec 2024 – could not be opened (NABL's
   download link answered "not found").

What laboratory software offers for these four features, and the vendors' pages read, is in
`docs/PATHOLOGY_APPS_REVIEW.md`.
