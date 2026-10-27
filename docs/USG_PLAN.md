# Ultrasound (USG) reports – plan (DRAFT; first version built 15 Oct 2026)

> Copied from the owner's repository (`girishsolanke/perinexa`) on 27 Oct 2026 for reference. perinexa1 does this its own way; this file describes the owner's plan, not perinexa1.

Written on 15 Oct 2026 at the owner's request. **The owner then asked for it to be built straight away**, as an
exception to the pause before the developer's health check, with **Hadlock** charts (question 3). The first version is
built (server `server/src/routes/usg.js`, `server/src/usg/`; screens `client/src/pages/usg/`; how to test: PROGRESS.md).
The other questions below still use their defaults. Built differently from this plan: any doctor who may write the
report signs it (no separate sonologist tick yet); no images, machine import, twin or follicle templates, care-plan tick
or automatic charge yet.
Every template, formula, normal range and suggestion rule is clinical content: it stays marked **DRAFT** until the
owner approves it.

## What the owner asked for, and what this plan does instead

The owner asked for a report written by the app **from the scan images alone**, in ready-made templates, with
suggestions that are added only after the doctor approves them.

This plan keeps the templates, the automatic report and the approve-first suggestions, but **the app does not read
the images**. The findings come from the measurements and findings the sonologist enters (or the machine sends).

Why the images are not read by AI:
1. **Not safe enough.** The only AI Perinexa uses (OpenAI) is a general chatbot. It is not tested or approved for
   ultrasound, can miss or invent findings and cannot measure from a picture. A report that looks complete invites
   approval without checking.
2. **A medical device.** Software that makes a diagnosis from images is a medical device under India's Medical Devices
   Rules (CDSCO). It would need approval and clinical testing – a separate project, not a feature.
3. **Privacy and fetal sex.** Pregnancy scans would go to an outside company, and an AI could tell the baby's sex from
   the images – exactly what Perinexa's fetal-sex protection must stop (`CLAUDE.md`: never weaken it).

## The law to check first (before any building)

The owner decided on 2 Oct 2026 that Perinexa has no PC-PNDT paperwork. An **obstetric ultrasound** module brings the
PC-PNDT Act in directly, whether the paperwork is on paper or in an app:
- The hospital must be a **registered ultrasound centre** and the person reporting a **registered sonologist**.
- **Form F** is needed for every scan of a pregnant woman, and records are kept for the years the law requires.
- The baby's sex is never written, said, shown or printed.

The developer and a lawyer confirm this before step 1 of the build. Perinexa does not add a Form F register unless
the owner asks for one (owner decision of 2 Oct 2026 stands).

## How it would work

### 1. Ordering a scan
- From a visit or from the care plan: the scan items already in the care plans (dating, NT, anomaly, growth, Doppler,
  twin and placenta scans) get an **Order scan** button. A scan can also be ordered on its own.
- Orders appear on a **Scan list** (like the lab worklist) for the sonologist, in order of arrival.
- The price comes from the billing price list automatically, as for lab orders.

### 2. Templates (one per type of scan, DRAFT until the owner approves)
Early pregnancy / viability · Dating / NT · Anomaly (level II) · Growth (with fluid and Doppler) · Twins ·
Gynaecology / pelvis (uterus, endometrium, ovaries) · Follicle study. Doctors can copy a template and make their own,
as with prescription sets.

Each template is a short form with fields: measurements (e.g. CRL, BPD, HC, AC, FL, AFI or deepest pocket, Doppler
indices), findings from a list (placenta position, presentation, cardiac activity …) and free text.
**There is no field for the baby's sex**, and free text goes through the existing fetal-sex filter
(`server/src/utils/pcpndt.js`), so such words are refused.

### 3. Entering the findings – three ways
1. **Typing** into the form (Tab moves to the next box).
2. **Voice**, using the voice entry Perinexa already has for visits.
3. **From the ultrasound machine** (later step): most machines can send their measurements as a structured file
   (DICOM "structured report"). This is more accurate than reading images, but needs a DICOM add-on and a check of
   the hospital's machines – the developer decides.

### 4. The app writes the report
- Works out **gestational age** and **estimated fetal weight** from the measurements, with the growth charts and
  formulas the owner chooses (question 3 below), and shows the **centile** for each measurement.
- Fills the template's sentences, e.g. "Single live intrauterine pregnancy. Biometry corresponds to 32 weeks 3 days.
  Estimated fetal weight 1,850 g (30th centile). Liquor adequate (AFI 12 cm). Placenta posterior, upper segment."
- The sonologist can change any sentence before signing.

### 5. Suggestions – added only after the doctor approves
Suggestions come from **written rules the owner approves** (like the red-flag rules), never from AI. Each one shows
why, and has **Add** and **Ignore** buttons. Examples (DRAFT wording and limits):
- "AFI 4 cm is below the usual range. Add 'Reduced liquor (oligohydramnios)' to the impression?"
- "Estimated weight below the 10th centile. Add 'Small for gestational age' and suggest a repeat growth scan with
  Doppler in 2 weeks?"
- "Scan dates differ from her LMP dates by more than the agreed limit. Change her EDD to the scan EDD?" – her EDD
  changes only if the doctor presses **Add**.
- "Placenta low-lying at 20 weeks. Add a repeat scan at 32 weeks to her care plan?"

Nothing is added to the report, her record, her risk level or her care plan without a click. Every Add and Ignore
goes into the audit log (ids and the rule's name only).

### 6. Signing and printing
- The report is a **draft until a doctor signs it** (as with visits). After signing it cannot change; a correction is
  an addendum, kept with the original.
- Printed on the hospital letterhead with the sonologist's name, qualification and registration number.
- **Images:** the sonologist may attach a few chosen images (uploaded from the machine or a USB stick). They are kept
  in Perinexa's own file store, never sent to AI. *Question 5:* print images with pregnancy reports or not.
- The signed report appears on her record, ticks off the care-plan scan item, and can go into her ABHA records
  (practice mode until ABDM is live).

### 7. Who sees what
| Role | Can do |
| --- | --- |
| Sonologist – her own login, the "Sonologist" role (owner, 15 Oct 2026; was "a tick for doctors" in this plan) | Finds a patient by name or number; scan details only (name, number, age, type of care, LMP/EDD/weeks); starts, writes, signs and prints reports. On a sensitive record: only reports her doctor started, or she started or signed; no dates. Her Add on a suggestion that would change the record leaves the change waiting for the patient's doctor |
| The patient's doctor, RMOs | Start, write and sign reports (doctors sign); apply or decline a change a sonologist's report left waiting ("Apply to her record") |
| Other doctors, nurses | Read the reports of patients whose medical details they may see |
| Reception | Book the scan and bill it; never the findings |
| Lab staff, pharmacist | Nothing |
| Hospital admin | Turn the module on or off; templates list; no reports |
| Super admin | Nothing (never patient data) |

## Questions for the owner (default used until answered)

| # | Question | Default |
| --- | --- | --- |
| 1 | Is the hospital a registered ultrasound centre, and how is Form F done today? | To be answered before building |
| 2 | Which templates first? | Early pregnancy, dating/NT, anomaly, growth, gynaecology |
| 3 | Growth charts and formulas (e.g. Hadlock, INTERGROWTH-21st, Fetal Medicine Foundation) | Owner to choose |
| 4 | Limit for changing EDD by scan (by weeks of pregnancy) | Owner to set; EDD never changes on its own |
| 5 | Print images with pregnancy reports? | No (images only in the record) |
| 6 | Who may sign: only doctors marked as sonologists? | Yes |
| 7 | Reports in Marathi/Hindi for the patient? | English only |

## Build order (each step tested and committed – after the health check)
1. Legal check (question 1) and the owner's choices (questions 2–7).
2. Server: scan orders, templates, reports with draft → signed, audit log, hospital separation.
3. Server: calculations (gestational age, weight, centiles) with tests against published examples.
4. Server: suggestion rules (owner-approved list), Add/Ignore recorded.
5. Screens: Order scan, Scan list, report form with suggestions, sign, print.
6. Links: care plan tick, billing charge, ABHA record.
7. Later: measurements from the ultrasound machine (DICOM – developer to agree the add-on).

## Not included
- Reading or interpreting images by AI (see the top of this plan).
- A PC-PNDT Form F register (owner decision of 2 Oct 2026; can be added if the owner asks).
- Anything that records, shows or hints at the baby's sex.
