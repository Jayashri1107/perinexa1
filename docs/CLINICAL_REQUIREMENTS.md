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
