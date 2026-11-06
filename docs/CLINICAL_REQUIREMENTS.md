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

## Group B, item 8 – MEOWS chart (DRAFT, 6 Nov 2026)
Built before the manual page was given, at the developer's request: the published CEMACH MEOWS chart (Saving Mothers'
Lives 2003–2005, 2007; Singh et al., Anaesthesia 2012). Every trigger is a constant in `server/src/clinical/meows.js`
with its source, marked DRAFT on screen, and is replaced by OBG-F-05 when the Lead Obstetrician gives it.
**Needs the owner's approval as clinical content before it goes to `main`.** Branch `crs-8-meows`.
- Where: a mother's stay page, above the nursing chart (`client/src/pages/inpatient/MeowsChart.jsx`; API `/api/meows`).
- One red or two yellow readings = trigger: saving asks whom you told. One yellow = watch.
- Temperature in °C or °F (stored °C). Entries are never changed: "entered in error" with a reason.

## Group B, item 15 – PPH chart (DRAFT, 6 Nov 2026)
Built before OBG-F-07 was given, at the developer's request, from RCOG Green-top 52 (2016), WHO PPH recommendations
(2012, tranexamic acid 2017) and the shock index of Nathan et al. (BJOG 2015). Constants in `server/src/clinical/pph.js`,
marked DRAFT on screen. **Needs the owner's approval as clinical content before it goes to `main`.** Branch `crs-15-pph`.
- Where: a mother's stay page, under the MEOWS chart (`client/src/pages/inpatient/PphChart.jsx`; API `/api/pph`).
- Start when bleeding is recognised (or to type in the paper chart afterwards); add blood loss, steps and observations
  with their times; blood loss added up and banded (minor 500–1000 mL, major over 1000); shock index worked out
  (0.9 watch, 1.4 urgent); the four Ts; closed by her doctor or an RMO with how it ended.
- Perinexa gives no dose: a medicine step needs the dose typed by whoever gave it. Lines are never changed.

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
