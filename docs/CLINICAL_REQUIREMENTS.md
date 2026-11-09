# Clinical Requirements Specification (PX-REQ-00) – Group A in perinexa1

Written 6 Nov 2026. The owner's PX-REQ-00 v1.0 maps the three Anandi department manuals to software; the owner's
decisions of 5 Nov 2026 are recorded in the owner's status note (kept with the owner's copy). The `.docx` and the
manuals are **not** in this project. This file records what was built in perinexa1 for **Group A** (the seven items
the owner cleared without a manual page) and what is left out on purpose.

Built on branch `crs-group-a` (worktree `C:\perinexa1-crs`), one commit per item, from `master` at `81f1177e`. The
branch is local: it is not pushed and not merged into `master` – the developer reads it first.

| # | Item | Requirements | Server | Website |
|---|------|--------------|--------|---------|
| 1 | Robson group on the delivery note; monthly ten-group table | PX-OBG-13 (part), PX-OBG-28 | `clinical/robson.js`, `routes/clinicalAudit.js` | delivery note; **Clinical audit** |
| 2 | Caesarean category 1–4, decision and incision times, decision-to-delivery worked out (category 1 over 30 min red), measured blood loss compulsory, typing time stored | PX-OBG-14 (part), PX-OBG-13 (part), PX-X-04 | `clinical/caesarean.js`, `inpatient/docSchemas.js`, `ClinicalDocument.timesEnteredAt` | delivery note; **Clinical audit** |
| 3 | Specimen and histopathology tracker, overdue at 21 days | PX-OT-04, OBG-L-05 | `models/Specimen.js`, `routes/specimens.js` | **Specimens**; her record → Specimens |
| 4 | Newborn screening log (ROP per NNF / RBSK), follow-up at corrected age, defaulters; **Newborn follow-up coordinator** login | PX-NEO-13, PX-NEO-15, part of PX-NEO-14 and PX-COM-02 | `clinical/newbornSchedule.js`, `models/NewbornFollowUp.js`, `routes/newbornFollowUp.js` | **Newborn follow-up**; a baby's record → Screening |
| 5 | EPDS (scores only, no questions) and VTE risk score with advice | PX-OBG-19, PX-OBG-17 (score and advice) | `clinical/scores.js`, `models/ClinicalScore.js`, `routes/clinicalScores.js` | her record → Scores |
| 6 | Incident reporting: report, lead's review, actions, closure; **Quality lead** login; automatic incident for a late category 1 caesarean | PX-X-10, PX-OBG-14 (automatic incident) | `models/Incident.js`, `incidents/`, `routes/incidents.js` | **Incidents** |
| 7 | The formulary table (empty; a dose only from a row verified by a doctor and the pharmacist) | owner's decision 9 | `models/FormularyItem.js`, `routes/formulary.js` | **Formulary** |

## Rules followed
- **DRAFT clinical content.** Every rule is a constant in one small file with its source: Robson (WHO 2017), caesarean
  urgency (NICE NG192), screening schedule (RBSK; NNF ROP and high-risk follow-up 2020), EPDS thresholds (Cox 1987,
  NICE CG192), VTE table (RCOG Green-top 37a, 2015), harm scale (WHO ICPS 2009). Each screen says DRAFT. The leads
  confirm them: the schedule (Lead Neonatologist), VTE and EPDS against OBG-F-10 / OBG-F-11, the kinds of incident.
- **Website copies** of the Robson, caesarean, score and incident tables are checked against the server's by tests.
- **No weakening.** Every new model is `tenantScoped`; no new `aggregate()`. Record access goes through
  `patientAccess` (a sensitive record's specimens and scores only for those who see it in full). The two new roles are
  not in `PATIENT_ROLES`: they never open a medical record. Every action is audited with ids only.
- **Incidents stay out of the record** and its copy (a test checks both).
- **Old delivery notes are not changed.** The new required fields apply to delivery notes started from
  6 Nov 2026 (`GROUP_A_REQUIRED_FROM`); an older draft keeps the rules it was started under.
- **No new dependency**, no `npx` download.

## Left out on purpose (the developer's to decide)
- The super admin's screen to edit rule tables (owner's decision 6): the rules are constants in code.
- Corrections of a saved screen, score or specimen beyond "entered in error" / cancel – waits for PX-X-05 (Group C).
- Formulary: a single person with both roles cannot verify a row alone; whether a doctor alone may verify where a
  hospital has no pharmacist login is open. The medicine safety list is not merged into the formulary yet.
- The VTE score's dose and the spinal timing check: with a verified formulary row and the anaesthesia record (later).
- Not in perinexa1's delivery note before: gestation at birth on a baby's record – it is typed in her screening log.
- Not built (owner): PC-PNDT, MTP, sterilisation register and consent, the "late entry" badge, PX-X-01.

## Group B, item 8 – MEOWS chart (OBG-F-05 v1.0, 7 Nov 2026; first DRAFT 6 Nov 2026)
Built on 6 Nov 2026 as a DRAFT from the published CEMACH chart; **upgraded on 7 Nov 2026 to the manual page** as the
field schema `docs/field_schemas/build8_meows.json` gives it (OBG-F-05 v1.0, OBG-SOP-11 §1–2, OBG-SOP-12 §2, PX-OBG-11,
PX-X-04, PX-X-09). Branch `claude/build8-meows-f05-694f40` (Build 8), from `master` at `76e29b84`; not merged, not pushed.

**Owner's approvals, recorded here (7 Nov 2026, given through the developer):**
- The three field schemas (Build 8 MEOWS, Build 15 PPH, Build 13 NICU admission) are **approved as clinical content**.
  The MEOWS rules are therefore no longer marked DRAFT on screen; the manual masters are v1.0 and the department lead's
  sign-off on fake data (the schema's acceptance tests) is still to come.
- **Reversed** – the earlier "not built" decisions: the **late-entry badge (PX-X-04)** is built (here, as a helper any
  chart can use); the **level-of-care gates (PX-X-01)**, **printed fixed doses** and **Director alerts** may be built –
  Director alerts go through the in-app notification bell, never a new SMS or outside service. Of these, only the
  late-entry badge applies to the MEOWS chart; this build adds no level-of-care gate, dose or Director alert.

What the chart does now:
- **Bands (RED / AMBER)** from the page, in `server/src/clinical/meows.js` (the website's copy
  `client/src/pages/inpatient/meowsRules.js` is checked by a test): RR red <10 or >30, amber 21–30; SpO2 red <92, amber
  92–94; temperature red <35 or ≥38, amber 35–36 or 37.5–37.9; pulse red <40 or >120, amber 40–50 or 100–120; systolic
  red <90 or ≥160, amber 90–100 or 150–159; diastolic red ≥110, amber 90–109; urine/4 h red <100, amber 100–120; AVPU
  red P or U, amber V or new confusion; pain amber ≥7; lochia red heavy or offensive; fundus red soft or rising; nurse
  concern red (counts as one red). "Yellow" is now "Amber"; sets saved before keep their CEMACH bands and source, shown
  as amber.
- **Chart header** (doctors and RMOs – the frequency is a doctor's order): context (antenatal, postnatal,
  post-operative, HDU), detail, diagnosis or procedure, frequency (15, 30, 60, 240, 480 min; 5 is accepted by the API
  for the PPH chart later), blood loss at delivery (offered from the stay's signed delivery note, marked "delivery note"
  or "typed"), LMWH prescribed (offered from the latest VTE score: LMWH before birth or high risk).
- **Observation fields:** clinical time (kept apart from the time typed), the vitals, urine in 4 h, new confusion,
  pain 0–10, lochia, fundus, wound / perineum, nurse concern, action taken, doctor informed at, recorded by (the login).
- **Worked out:** shock index (pulse ÷ systolic, two decimals, red at 0.9 or more – not added to the red count, as in
  acceptance test 1), red and amber counts, hypertensive emergency (systolic ≥160 or diastolic ≥110: its own red
  banner, "treat within 30 minutes").
- **Late entry (PX-X-04):** `server/src/utils/lateEntry.js` (`isLateEntry`, `entryDelayMinutes`) – typed more than 60
  minutes after the clinical time shows "Late entry" on screen and on the printout.
- **Escalation** (stored on the set that raised it): **E1** (one red or two amber) – a task "resident at the bedside"
  due in 30 min, the next set due in 30 min, the RMOs and her consultant told through the **notification bell** (kind
  `meows`; the text has her name, ward and bed and the rule, never the readings); a trigger needs the action taken.
  **E2** (two red, or E1 still met 60 min after it began) – tasks "consultant at the bedside" and "anaesthetist
  informed", the bell again; the chart shows pathway buttons – Sepsis six (OBG-ALG-07), PPH (OBG-ALG-01, opens the
  existing PPH chart on the stay page), Severe hypertension (OBG-ALG-02) – and "offer HDU transfer" as a suggestion.
  An E1 left 60 minutes with no newer set shows "escalate to E2" on the chart. **E3** (shock index ≥0.9) – red banner;
  the PPH chart is suggested for a postnatal mother (within 24 h of birth when the delivery note gives it). **E4** –
  overdue at the ordered frequency + 15 min: on the chart, and on the ward list of Today (a pill per stay and a "MEOWS
  overdue" card for nurses and RMOs). One task of each kind is open at a time on a stay; a task is marked done with its
  time and who.
- **Dashboard (OBG-A-05)** – three rows on the obstetrics dashboard (`server/src/clinical/meowsKpi.js`): MEOWS completed
  4-hourly in the first 24 h postnatal (target 95%), suspected sepsis – antibiotics within 1 h of the trigger (90%),
  severe hypertension treated within 30 min (95%). The times come from the chart: the pathway chosen, the first
  antibiotic's time and the antihypertensive's time, each recorded once on the set, by whom and when.
- **Print (PX-X-03):** A4 landscape, 12 sets per sheet, rows = the page's parameters with their RED and AMBER limits,
  then totals, action and signature rows; footer "OBG-F-05 · v1.0 · effective <date>" from the document register.
- Where: a mother's stay page, above the nursing chart; API `/api/meows` (GET, PUT `/chart`, POST, POST `/:id/tasks/:key`,
  POST `/:id/follow-up`, POST `/:id/cancel`). Every action is audited with ids, the level and rule ids only.

Readings of the schema to confirm with the Lead Obstetrician (the page wins if it differs):
- "35–36 °C" amber is read as 35.0 to 36.0 inclusive; "37.5–37.9" as 37.5 up to (not including) 38.
- New confusion and AVPU are one row (one amber at most between them).
- "E1 open 60 min without improvement" = every set since the first trigger of the run is still a trigger.
- The 4-hourly indicator counts from the time of birth on the signed delivery note (else admission), allows the ordered
  frequency (at most 4 h) + 15 min between sets, and counts stays whose chart context is postnatal.
- Severe hypertension counts each run of flagged sets once (treated if an antihypertensive is recorded within 30 min of
  its first flag).

Left out (later, or another build):
- The pain score is not copied into the pain chart (ANA-F-03) yet – it stays on the MEOWS chart.
- The PPH chart setting the MEOWS frequency to 5 min (Build 15 adds that hook; the frequency 5 is accepted).
- Antibiotic and antihypertensive times are typed on the MEOWS set, not taken from the nursing chart's medicines.
- An HDU transfer is suggested, not recorded; anaesthetists have no login role, so their task is marked by the nurse or
  doctor who told them.

## Group B, item 15 – PPH management and blood-loss chart (Build 15, OBG-F-07 v1.0, 7 Nov 2026)
Replaces the DRAFT chart of 6 Nov 2026 (RCOG 52 / WHO / Nathan bands). Built exactly from the manual's field schema
`docs/field_schemas/build15_pph.json` (OBG-F-07 v1.0, OBG-SOP-09 §3–5, OBG-ALG-01; issued 6 Nov 2026). Branch
`claude/build15-pph-f07-efe494`. The existing chart was upgraded – same model (`PphChart`), route (`/api/pph`) and
screen – not a second system.

**Owner's approvals (recorded 7 Nov 2026, given through the developer):**
- The schema's fields, bands, rules and wording are **approved as clinical content** – the chart is no longer DRAFT.
- **Late-entry badge (PX-X-04): built** – reverses "not built (owner)" in Group A's list above, for this chart.
- **Level-of-care gates (PX-X-01): approved** – reverses "not built (owner)". The PPH schema names no gate of its own,
  so none was added here beyond the consultant-only sign-off; the approval is recorded for the builds that need one.
- **Fixed doses printed:** "Perinexa gives no dose" no longer applies to the schema's doses – oxytocin 10 IU IM,
  infusion 20–40 IU in 500 ml at 125–250 ml/h, misoprostol 800 micrograms, tranexamic acid 1 g. No other dose is shown
  (carboprost and ergometrine have none in the schema).
- **Director alerts** go through the in-app notification bell – no SMS or push service was added.

**What it does** (rules in `server/src/clinical/pph.js`; the website's copy `client/src/pages/inpatient/pphRules.js`
is checked word for word by a server test):
- **Paper first.** "Declare PPH" in one tap – on the patient banner (safety strip) or the stay page – stamps
  `declared_at` and `declared_by` and starts the banner clock (minutes since declaration) with the read-only ALG-01
  card (A2). "Type in a paper chart" starts one with the paper's declaration time. `declared_at` is editable with a
  reason (kept).
- **Transcription screen laid out like OBG-F-07:** header (delivery mode and time copied from the delivery note, loss
  at declaration and method, pulse and systolic → shock index at declaration, help/consultant/anaesthetist/blood bank
  times, 4 Ts, risk factors, recorder); the E-MOTIVE bundle, each item with its time and "within 15 min of declared_at";
  escalation; observation rows; Hb series and labs; outcome with debrief.
- **Observation rows:** cumulative loss never goes down (and not below the loss at declaration); the outcome's total
  can't be less than the last row. Blood products with their unit numbers need the second person's check
  (`auth/witness.js`, PX-X-06).
- **Bands:** loss 500–999 / 1000–1499 / 1500 or more (severe) – 500–999 amber, 1000 and more red (the schema gives no
  colours; chosen to match the rest of the app). Shock index 0.9 or more red.
- **A3:** a carboprost dose less than 15 minutes from another, or a 9th dose, is refused (and audited). Tranexamic
  acid more than 3 hours after birth: a warning; the repeat before the first + 30 minutes: refused.
- **Warnings, never blocks:** asthma on her record → carboprost; hypertension (her record or this pregnancy),
  pre-eclampsia (risk factor ticked) or heart disease → ergometrine. Each warning shown is kept on the episode.
- **Labs:** fibrinogen under 2 g/L → "cryoprecipitate 2 pools".
- **A1** (total ≥1500 ml, or ≥4 units, or hysterectomy, or ICU / transferred / death): a near-miss review (the
  existing `CaseReview`, kind near miss – the OBG-F-19 record; `server/src/incidents/` holds incident reports, not
  near misses) is started pre-filled with the criteria; the Lead Obstetrician is told by the bell; the episode goes on
  the **PPH M&M list** (Clinical audit → PPH M&M list) with "review by" 7 days.
- **A4** (massive haemorrhage declared): the Director is told by the bell, and the blood bank's massive-transfusion
  pack request is recorded with its time (ANA-ALG-06 named). There is no blood bank module yet: the request is a
  record on the episode, shown on screen and on the printout.
- **Who is told:** the hospital admin names the Lead Obstetrician(s) and Director(s) on the PPH M&M page; until
  named, A1 goes to the quality lead and A4 to the hospital admin. The bell's text has the ward and bed only.
- **Late entry (PX-X-04):** any timed field, row, dose or product typed more than 60 minutes after its clinical time
  (declaration fields: after `declared_at`) shows "Late entry"; the consultant can sign off only once the scan of the
  paper OBG-F-07 is attached (stored files, kind `pph_paper_scan`). A small local helper in the PPH module – to be
  unified with Build 8's shared helper in `server/src/utils/` after both are merged.
- **A5:** the consultant (a doctor who may edit her record) signs off: the KPI fields are worked out and kept, and the
  episode is locked.
- **KPI feeds (OBG-A-05)** in the monthly dashboards (`server/src/clinical/pphKpi.js`, five rows in `dashboards.js`):
  births with measured blood loss recorded; PPH ≥500 ml after a vaginal birth and ≥1000 ml after a caesarean (two
  rows); PPH with TXA and a second uterotonic within 15 min; severe PPH / ≥4 units / hysterectomy per 1000.
- **Print:** "Print OBG-F-07" – A4 portrait, header, the E-MOTIVE three-column tick-with-time block, observations,
  labs and outcome; footer "OBG-F-07 · v1.0" on every page. The document register's code for the PPH chart is now
  OBG-F-07.
- **Tests:** the schema's six acceptance tests are automated – 1–5 in `server/tests/crs-pph.test.js`, 6 (the print)
  in `client/src/pages/inpatient/pph.test.jsx`.

**Not done / for later:**
- **TODO – A2 "MEOWS frequency set to 5 min"**: not wired (the MEOWS chart is Build 8's). To be added after both
  builds are merged; a TODO marks the place in `routes/pph.js`, `clinical/pph.js` and `PphBanner.jsx`.
- `shock_index_at_declaration` comes from the pulse and systolic typed on the PPH screen; reading the latest MEOWS set
  was left out (it would touch Build 8's files).
- The ALG-01 card shows the bundle, doses and rules from the schema; the OBG-ALG-01 page itself was not given.
- Blood products are typed by hand until the blood bank's issue records exist (Build 16+/PX-OBG-16).
- PPH charts started on the DRAFT chart (6 Nov 2026, fake data only) are kept as they were and shown as "earlier
  DRAFT chart"; they cannot be signed off.

## Group B, item 14 – postnatal discharge checklist and danger-sign teaching (DRAFT, 6 Nov 2026)
Built before OBG-F-11 and OBG-P-03 were given, at the developer's request, from WHO's postnatal recommendations (2022)
and MoHFW India (HBNC 2014, MCP card). Constants in `server/src/clinical/postnatalDischarge.js`, marked DRAFT on screen.
**Needs the owner's approval as clinical content and patient wording before it goes to `main`.** English only: Marathi
and Hindi wait for approved translations. Branch `crs-14-postnatal`.
- Where: a mother's stay page, under the PPH chart (`client/src/pages/inpatient/DischargeChecklist.jsx`; API
  `/api/discharge-checklist`). For antenatal, postnatal and pregnancy-loss records.
- 14 checks (mother, baby, going home) – Yes / No, Not applicable only for anti-D and the baby's birth vaccines; 10
  danger signs in the mother and 8 in the baby, each ticked when explained; teach-back (who said them back, language).
- Saved as a draft; marked complete only when nothing is missing – then locked. One per stay; entered in error with a
  reason, then a new one can be started.

## Group B, item 16 – theatre list and WHO Surgical Safety Checklist (6 Nov 2026)
The WHO Surgical Safety Checklist (2009) as published – sign in (7 items), time out (7), sign out (5) – in
`server/src/clinical/whoChecklist.js`; DRAFT until compared with OBG-F-16. **Needs the owner's approval before `main`.**
Branch `crs-16-theatre`.
- Where: the **Theatre** menu (doctors, RMOs, nurses): the day's list by theatre and order; each operation's page has
  the three steps (`client/src/pages/theatre/`; API `/api/theatre`).
- Steps are confirmed in order, once, then locked (who, role, when); sign in puts the case in theatre, sign out makes it
  done. A check must be done (or not applicable where allowed); a yes to a question needs its note; wrong counts need
  a note. Taken off the list with a reason, never deleted.
- The second person checking the counts comes with the base rules (PX-X-06, Group C).

## Group B, item 17 – monthly dashboards with targets and sign-off (DRAFT, 6 Nov 2026)
Each row only from fields Perinexa already records (the specification's rule), worked out for the month, never typed:
obstetrics (12 rows), newborn (7), theatre and anaesthesia (6), safety (4). Definitions in
`server/src/clinical/dashboards.js` (rows) and `dashboardData.js` (how each is worked out), DRAFT from WHO Robson 2017,
NICE NG192, WHO/UNICEF Every Newborn, MoHFW LaQshya and the WHO checklist until OBG-A-05, NEO-A-05 and ANA-A-06 are
given. **Needs the owner's approval before `main`.** Branch `crs-17-dashboards`.
- Where: **Clinical audit → Monthly dashboards** (doctors, RMOs, the quality lead, the hospital admin – the admin without
  the stillbirth and EPDS-positive rows). API `/api/dashboards`.
- Targets: the hospital's own, set by a doctor or the quality lead; rows that are only counted have none. Each judged
  row shows target met or missed (colour, icon, word).
- Sign-off: a doctor signs off a finished month with a comment; the numbers are kept as they were (later records change
  the live numbers only). Department-lead privileges come with the base rules (Group C).
- Not yet: drill-down from a number to its records (PX-X-09) – the Deliveries tab and the Specimens, Incidents and
  Theatre lists are the way in for now.

## Group B, items 9 and 10 – pre-anaesthesia check-up and pain chart (DRAFT, 6 Nov 2026)
From the ASA classification (2020), modified Mallampati, ASA fasting guidelines (2017), pain bands and POSS (2009), in
`server/src/clinical/anaesthesia.js`, until ANA-F-01, F-02, F-11 and F-03. **Owner's approval before `main`.**
- Check-up: a patient's **Anaesthesia** tab; signed in one go by a doctor or RMO (ASA, Mallampati, conditions, fasting
  hours against the guideline, plan, fitness, risks explained). Her latest shows on the theatre case.
- Pain chart: the stay page, under MEOWS; a POSS of 3–4 needs whom you told, severe pain needs what was done.
- Order sets A–D (PX-ANA-04) are not built: they wait for verified formulary rows (owner's decision 9).

## Group B, item 11 – consent forms (checked, 6 Nov 2026)
Covered by the existing consent module (DRAFT built-in forms in English, Marathi and Hindi: labour and delivery,
induction, VBAC, caesarean, anaesthesia, blood transfusion, procedure, refusal / LAMA, admission, HIV test, high-risk
pregnancy, newborn care). **Not built:** a separate labour-epidural (labour analgesia) consent, ANA-F-05 – its legal
wording and translations need the manual's text and the owner's approval. **For the owner:** the built-in tubal ligation
consent predates decision 10 (sterilisation consent stays on paper) – the owner decides whether it stays offered.

## Group B, items 12 and 13 – newborn at birth and on the ward, bilirubin, CCHD, NICU register (DRAFT, 6 Nov 2026)
From WHO Essential Newborn Care (2014), IAP–NNF NSSK / NRP (2021), the AAP CCHD algorithm (2020), the NNF newborn
examination guideline and the MoHFW SNCU register, in `server/src/clinical/newbornCare.js`, until NEO-F-01, F-02, F-03
and NEO-L-05. **Owner's approval before `main`.**
- A baby's **Newborn care** tab: at birth (once), examinations (each part normal or not), bilirubin readings with hours
  of age on a chart – no treatment lines (they come from the manual) – and NICU / SNCU admissions with outcome (doctor
  or RMO). The **NICU register** (Newborn follow-up → NICU register): the month in register order, with totals.
- CCHD helper in the screening log: right-hand and foot SpO2 → pass, repeat or refer.
- Two newborn dashboard rows added now that their fields exist: NICU / SNCU admissions; deaths in the unit (hidden
  from the hospital admin). Identity bands checked by two people wait for the base rules (Group C).

### Build 13 – the NICU admission as NEO-F-03, its register NEO-L-05 and unit board NEO-A-01 (7 Nov 2026)
From the field schema `docs/field_schemas/build13_nicu_admission.json` (NEO-F-03 v1.0, NEO-SOP-03, NEO-A-01, NEO-L-05,
NEO-A-05, PX-NEO-04, PX-X-01, PX-X-14). Branch `claude/build13-nicu-f03-85abb9`, not merged, not pushed.
**Owner's approvals (recorded by the developer, 7 Nov 2026):** the owner approved the three field schemas as clinical
content – for this build the NEO-F-03 fields, the computed rules (maturity, ROP, cranial ultrasound, hearing), the
thresholds (temperature 36.5–37.5 °C and under 36.0 °C, glucose under 45 mg/dL, the 28 weeks / 1000 g floor, nurse:baby
1:2, counselling and completion within 60 minutes) and the NEO-A-05 targets. The owner also reversed four earlier "not
built" decisions: the **late-entry badge (PX-X-04)** – built here for the admission time and the counselling time;
**level-of-care gates (PX-X-01)** – built here; **printed fixed doses** and **Director alerts** (the in-app notification
bell, no SMS service) – not part of NEO-F-03 (no dose and no Director alert on this form), so nothing in this build.
- **Code:** rules `server/src/clinical/nicuAdmission.js` (pure), form checks `clinical/nicuForm.js`, database work
  `clinical/nicuData.js` (pre-fill, ROP screen, N1, board, NEO-A-05 numbers); routes `routes/newbornCare.js`; models
  `NicuAdmission` (format `f03`) and `NicuRoster` in `models/NewbornCare.js`, `Bed.nicu`, `Tenant.nicu`,
  `NewbornFollowUp.events`. Website `client/src/pages/newborn/` (NicuAdmissionSection, nicuFields, NicuF03Print,
  NicuRegisterPage, NicuBoardPage, NicuSettingsPage).
- **Units are settings, not code** (Hospital admin → NICU units): the schema's Garkheda (level IIIA, 6 beds), Adalat
  Road and Waluj (level II) are typed by the admin; the sources `transfer_<unit key>` follow the units. A hospital that
  never set them has NICU and SNCU at level II (the DRAFT's units), so the level IIIA screens stay hidden until set.
- **Old records:** DRAFT admissions (6 Nov) keep their fields, outcome words and hospital-wide number ("No. 4"); they are
  read-only. New outcomes use NEO-L-05's list (discharged home, transferred, died, LAMA).
- **Register number:** per unit per year (UNIT-YEAR-0001), given when the admission is saved (the next number after the
  unit's last of the year, retried on a clash – a failed save uses no number), never changed (the model refuses), kept
  when entered in error; the register checks and shows that no number is missing. The year is the admission day's.
- **Owner confirmed all the Build 13 changes as built (developer, 7 Nov 2026)**, including the five decisions below.
- **Decisions made here (confirmed by the owner, 7 Nov 2026):**
  1. *Admin override of a full unit (N4).* A hospital admin works in admin mode with no patient records, so the admin
     cannot admit. Built as "one more admission" allowed by the admin on NICU units (with a reason, used once within 2
     hours); the admission shows who allowed it and why.
  2. *ROP rule (Confirm 4).* NICU babies use NEO-F-03's rule (under 34 weeks, under 2000 g, or under 37 weeks with an
     unstable course; first examination at the later of 30 days and 31 weeks' PMA) and the date is put in the baby's
     screening log. Other babies keep the screening log's NNF / RBSK schedule (owner's decision of 5 Nov: under 34 weeks
     or 1750 g; by day 30, or day 21 under 28 weeks / 1200 g). The owner decides whether NEO-F-03's rule replaces it.
  3. *Late entry (PX-X-04):* "typed more than 60 minutes after the time it records" – the schema gives no threshold.
  4. *KPI denominators:* temperature in range counts every admission (a missing temperature is "not in range");
     counselling and completion within 1 hour count NEO-F-03 admissions only (the DRAFT had no such fields); survival
     counts admissions that ended in the month; ROP on time counts eligible babies whose first exam fell due in the month.
  5. *Serology pre-fill:* only a positive from the mother's recorded conditions (syphilis → VDRL, hepatitis B → HBsAg,
     HIV); the absence of a condition is not a negative test, so those start empty. HIV is shown and printed under the
     neutral name "Lab test (confidential)".
- **Reception admits at the desk (developer's request, 9 Nov 2026).** A baby's record → **NICU** tab, for reception
  only: admit with the unit, bed, where from, when and the admitting doctor (required); then only where the baby is
  ("In the NICU – unit, bed, number", "Left the NICU" with the day – never how it ended). Reception never sees the NICU
  form, the register or the board, and the server refuses every other NICU call from reception (need-to-know access
  unchanged). The admission shows "Admitted at the desk – enter the weight, gestation and temperature (§2) and the main
  reason (§3)" until a nurse or doctor does; the admitting doctor and the nurses get a notification. §1 is not
  pre-filled at the desk (reception may not read the mother's record): **Fill in from the linked records** in §1 fills
  the empty fields later (also usable any time before signing). Audit: NICU_DESK_VIEWED; NICU_ADMITTED with atDesk.
- **Gaps – stored as fields or flags, not built:**
  - No weight-centile tables (Fenton, INTERGROWTH-21st, WHO) in Perinexa: the chart is chosen (Fenton under 37 weeks,
    WHO from 37 by default) and the centile typed; SGA / AGA / LGA come from the typed centile. Not invented.
  - EOS calculator (Build 12, NEO-SOP-06): sepsis risk and pathway are typed; "culture before antibiotics" (needs order
    times) is not worked out.
  - Transfer form NEO-F-18: transfers suggested (floor, capability, full unit) but no form; decision and departure times
    are typed on the outcome for the 2-hour KPI; the HIE "departed by 3 hours of life" KPI is not worked out.
  - Fluids NEO-F-05, parent counselling NEO-F-19, ventilator chart NEO-F-10, consent NEO-F-14 (a yes / no and a typed
    reference, not linked to Consent forms), M&M review NEO-A-06 (a typed reference).
  - SOP-04 hypothermia and SOP-08 hypoglycaemia pathways: the banners prompt them; the steps and the glucose-check
    schedule (the schema gives no intervals) are not built. The TSB due time is stored, not reminded.
  - Not recorded at birth in Perinexa, so typed on NEO-F-03: cord pH, base excess, clamping seconds (the record at birth
    gives delayed / early), vitamin K time, first feed time, delivery-room glucose; GBS and rubella.
  - No staff roster: the nurses on duty are typed on the unit board (the latest entry counts).
  - The hospital's bed board (Beds) does not show a NICU bed as taken by a NICU admission – only by a stay; the NICU board
    shows both. A baby's **Edit details → Care after birth** (NICU dates) is not filled from the admission.
  - Hearing (AABR) and cranial ultrasound: shown as due on the admission; no screening entry or task is made (the log
    already has the hearing screen). Exchange transfusion and TPN order screens do not exist in Perinexa; the gate covers
    the form's ventilator and central-line choices.
  - The NEO-L-05 register is exported as CSV; it has no printed page.
- **Test:** `docs/PROGRESS.md` → "How to test Build 13 – the NICU admission". Automated: `server/tests/build13-nicu-admission.test.js`
  (AT1–AT7 of the schema) and `client/src/pages/newborn/newbornCare.test.jsx`.

## Group C – the second-person check (PX-X-06, 6 Nov 2026)
`server/src/auth/witness.js`. A step that needs two people is confirmed by a SECOND member of staff who types their own
email and password on the same screen: someone else, active, a member of this hospital as a doctor, RMO or nurse; the
same 3-tries / 2-minute lock as sign-in on their email; the password is never stored or audited – only who, role, when.
Audit: WITNESS_CONFIRMED (purpose), WITNESS_FAILED (a security event). Branch `crs-c-witness`.
- Theatre sign out: the instrument, swab and needle counts (PX-OT-02).
- Newborn at birth: the identity band (PX-NEO-17, part).
- Nursing chart: a medicine ticked high-alert or controlled, or listed high-alert in the formulary, and any amount
  discarded – narcotic wastage in the labour room and on the ward (PX-OT-07, part).
- Pharmacy (Schedule X and narcotic medicines): a stock count, a supplier return and cancelling a return – the second
  person (pharmacist, doctor, RMO or nurse) signs in; the register shows "Name (Role)". Older rows keep the typed name.
  Test: Pharmacy → Stock → a narcotic batch → Count; Pharmacy → Supplier returns with a narcotic batch.

## Group C – alerts that follow the patient (PX-X-13, 7 Nov 2026)
DRAFT list (`server/src/clinical/patientAlerts.js`, owner's approval before `main`): difficult airway, declines blood
products, infection precautions (the precaution only – never the diagnosis or a test result), fall risk, needs an
interpreter, implant or device, other. Model `PatientAlert`, route `/api/patient-alerts` (band, list, add, end).
- Worked out by Perinexa and shown with them (cannot be ended by hand): high-risk pregnancy (for those who may see the
  risk), MEOWS trigger on the latest observations of her current stay, PPH chart open.
- Shown in the safety strip (with allergies and blood group) on every screen of her record – her stays and documents
  included – and on the theatre case page (`PatientSafetyBand`). Only for those who may see her medical details.
- Her doctor, RMOs and nurses add them ("Add an alert" / "Alerts" in the strip) and end them with a reason; never
  deleted. One of each kind at a time (except "Other"). The note follows the fetal-sex protection.
- Audit: PATIENT_ALERT_ADDED, PATIENT_ALERT_ENDED, PATIENT_ALERTS_VIEWED – ids and the kind, never the note.
- Test: open a patient → in the strip under her name, **Add an alert** → Difficult airway, a note → it shows in red
  with a warning icon; open her operation from the Theatre list – the same band; **Alerts** → End, with a reason.

## Group C – maternal death and near-miss review (PX-OBG-30) with corrections and sealing (PX-X-05), 7 Nov 2026
DRAFT lists (`server/src/clinical/caseReview.js`, owner's approval before `main`): WHO near-miss criteria (2011), WHO
ICD-MM groups of causes (2012), the three delays as in India's MDSR guidelines (2017). Model `CaseReview`, route
`/api/case-reviews`. Clinical audit → **Death and near-miss reviews** (doctors, RMOs, quality lead – not the admin).
- Start a review by her patient number (death or near miss, when it happened). The list shows mothers' deaths recorded
  in the last year that have no review yet; one death review per mother.
- A draft is filled in and saved by the team: summary, near-miss criteria, cause, the three delays, avoidable, factors,
  lessons, actions (who, by when), the meeting day and who was present.
- **Sealing**: a doctor signs and seals it once the required parts are filled in. A sealed review is never changed –
  the route refuses and the model itself refuses any save that changes it. A mistake found later is a **correction**
  added on top (which part, what it should say, why, who, when); the sealed text stays as signed.
- Confidential: nothing is shown on her record or in the copy of her record. Audit: CASE_REVIEW_* – ids, kind and
  step, never the text. In the hospital export.
- Not done: corrections and sealing for the other Group A and B records (scores, specimens, MEOWS, PPH, theatre…) –
  they keep "entered in error" with a reason; when a record should seal (end of shift, 24 hours, signature) is a
  decision for the owner and the developer.
- Test: Clinical audit → Death and near-miss reviews → **Start a review** (a fake patient number, Maternal near miss)
  → **Sign and seal** at once: the missing parts are named → fill them → **Sign and seal** → shown as signed →
  add a correction (Summary, what it should say, why) → it shows under Corrections; the summary is unchanged.

## Group C – clinical privileges (PX-X-07), 7 Nov 2026
DRAFT list (`server/src/clinical/privileges.js`, owner's approval before `main`): caesarean, operative vaginal birth,
complex perineal repair, hysterectomy, laparoscopy, hysteroscopy, cerclage, ectopic surgery, surgical MTP, minor
gynaecological procedures, obstetric ultrasound, egg collection and embryo transfer, general and regional anaesthesia,
newborn intubation and resuscitation – with reminders of the MTP Act, PC-PNDT and ART Act (not checked by Perinexa).
Model `StaffPrivilege`, route `/api/privileges`, page **Privileges** (`/privileges`).
- The hospital admin and the quality lead grant a privilege to a doctor, RMO or nurse (until a last day, or no end
  date) and end it with a reason; never deleted. Past its last day it shows as lapsed. Doctors, RMOs and nurses read it.
- The theatre list's **Add an operation** has "The surgeon's privilege it needs"; the theatre case shows whether the
  surgeon holds it and whether the anaesthetist holds the privilege for the anaesthesia chosen (general → general
  anaesthesia; spinal or epidural → regional). The names are matched to staff by name. **A warning only** – whether a
  missing privilege should block the operation is for the owner to decide.
- Audit: PRIVILEGE_GRANTED, PRIVILEGE_ENDED (no patient data). In the hospital export.
- Test: sign in as the quality lead or admin → Privileges → **Grant a privilege** → a doctor, Caesarean section →
  "In force"; as a doctor → Theatre → Add an operation with that doctor's name as surgeon and the privilege chosen →
  open it: "… holds the privilege: Caesarean section"; a name not on the staff list says to check by hand.

## Group C – form versions and the document register (PX-X-02), printing as the manual's page (PX-X-03), 7 Nov 2026
`server/src/clinical/formRegister.js` (DRAFT list of the Perinexa screens that stand in for the manual's forms; codes
known so far: OBG-F-16 WHO checklist, OBG-F-05 MEOWS). Model `FormVersion`, route `/api/forms`, page Clinical audit →
**Document register**.
- The quality lead or the admin records a version (screen, the manual's code, title, version, in force from, review
  due); a doctor approves it. An approved version is in force from its day until a later approved version of the same
  screen; never changed after approval, never deleted – a draft entered by mistake is withdrawn with a reason. A review
  date that has passed shows "Review overdue".
- **Print as the manual's page** (A4, `components/print/ManualPage.jsx`): the hospital's letterhead with the form's box
  – code, title and the version in force on the record's day; the header repeats on every page. With no approved
  version the box says "No form code … not in the document register yet". Added to: the theatre case (WHO checklist),
  the MEOWS chart, and a sealed death or near-miss review. The other screens in the list (PPH chart, discharge
  checklist, PAC, pain chart, newborn records, NICU register, incident, specimen) get the same button next.
- Audit: FORM_VERSION_RECORDED / _APPROVED / _WITHDRAWN (no patient data). In the hospital export.
- Test: as the quality lead → Clinical audit → Document register → **Record a form version** (WHO Surgical Safety
  Checklist, OBG-F-16, 1.0, in force from a past day) → as a doctor → **Approve** → "In force" → open an operation on the
  Theatre list → **Print as the manual's page**: the box shows OBG-F-16, version 1.0.

## Group C – pregnancy episode (PX-X-15) and GREEN / AMBER / RED tiers (DRAFT, not in use), 7 Nov 2026
Route `/api/pregnancy-episodes`, patient tab **Pregnancies** (antenatal, postnatal and abortion records; those who may
see the visits).
- One entry per pregnancy: each antenatal care plan is one pregnancy (closed as delivered, pregnancy ended, new
  pregnancy …); a pregnancy without a plan yet is the current one. Each shows its EDD, from–to, and what belongs to it
  between two weeks before the LMP and its end: visits, stays (linked), signed delivery notes, operations, lab orders and
  babies linked to her. Nothing is moved or copied – read from the records as they are. Audit: PREGNANCY_EPISODES_VIEWED.
- **Tiers** (`server/src/clinical/riskTiers.js`, DRAFT from India's PMSMA high-risk list and NICE NG201): RED (high
  risk), AMBER (additional care), GREEN (routine), or "Not enough recorded". Worked out from the same facts as today's
  risk rules and shown on the Pregnancies tab **beside today's risk level only – not used anywhere**. Replacing today's
  risk rules with the tiers (the manual's own criteria) is the owner's decision. Labels never name a confidential test.
- Not built (need the manual's content and the owner): the antenatal record laid out as OBG-F-01, standing
  prescriptions, the labour admission form (PX-OBG-01, 02, 03, 07).
- Test: open a pregnant patient → OPD → **Pregnancies**: the tier card (DRAFT) with today's risk level, then
  "Pregnancy 1 – current" with her stays and operations; fill in her conditions, G P A and blood group → the tier
  changes from "Not enough recorded".

## Group C – the baby's record made from the delivery (PX-X-14), 7 Nov 2026
Route `/api/delivery-babies`; on a signed delivery note, the card **The babies' records** (was: "register by hand").
- For each live-born baby on the note a doctor or RMO presses **Make the baby's record**: the baby is registered as by
  hand (patient number, checks, registration fee, audit) – "Baby of <mother>" or "First / Second Baby of <mother>" for
  more than one – linked to the mother, with the time of birth, weight and sex from the note (written after the birth).
  The record remembers the note and the baby (`newborn.fromDelivery`, unique), so it is made once.
- Records that may already be this baby are shown first, as on New patient; **Make the record anyway** after checking.
  A twin made from the same note is not a match for the other twin. Babies already linked to the mother by hand are
  listed under the card. No record for a stillbirth. Audit: BABY_RECORD_FROM_DELIVERY (plus PATIENT_CREATED).
- The identity band checked by two people at birth is already in place (second-person check).
- Test: open a mother's stay → a signed delivery note with a live baby → **Make the baby's record** → "Record made:
  Baby of … · P-…" with a link; the baby's record shows the mother, time of birth, weight and sex.
