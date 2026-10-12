# Use case

> Result of the Phase 2 interview, **confirmed by the owner**. This is the basis for planning features (Phase 3).

## 1. Who will use the app

| Group | How many | Notes |
| --- | --- | --- |
| Doctors | 3–4 | |
| Resident medical officers (RMOs) | 3–4 | New role, not in the app yet |
| Nurses | 3–4 | |
| Reception staff | 2–3 | |
| Lab staff | 1–2 | New role, not in the app yet |
| Patients | Many | Do **not** log in for the first version: they are records managed by staff. A patient portal may come later. |
| Super admin | 1 | The hospital owner |

- The owner (super admin) sees counts and charts only, never patient details (see section 6).

## 2. What problem the app solves

The hospital focuses on **obstetrics & gynaecology (OBGY)**. Two main problems:

1. **Standardised, guideline-based care plans for OBGY patients (main problem).**
   - Follow-up visits, investigations (lab tests) and sonography (ultrasound scans) should follow recent
     clinical guidelines, the same way for every patient.
   - When a patient's details are entered (e.g. for a pregnant patient), the app should **automatically
     generate the full plan**: all future visits, investigations and sonography, with their due dates.
   - **Reminders** so that no appointment, investigation or scan is missed.
2. **Handwritten documents are hard to read and copy.**
   - Doctors' notes, prescriptions and discharge summaries should be typed in the app, clear to read,
     and easy to print or copy.

**Safety notes (to keep in mind when building)**
- The guideline schedule must be **checked and approved by a qualified doctor** before real use. The app
  should use a care-plan template that doctors can review and update when guidelines change, rather than
  rules that only a programmer can change.
- Generated plans are **suggestions that support the doctor's judgement**: a doctor must be able to adjust a
  patient's plan (e.g. for high-risk pregnancies).
- Reminders sent to patients (SMS/WhatsApp/email) would send patient information to an outside service. That
  needs consent and a careful privacy review, so a first version could show reminders to **staff only**
  (e.g. "due this week / overdue" lists).

### Guidelines and care-plan types

- **Guideline sources:** a combined standard based on **FOGSI**, **WHO** and **Government of India (MoHFW)**
  guidance. Where they differ, the doctors decide which to follow (to be settled during the doctor review).
- **Doctor's own protocol:** doctors must be able to create their **own protocol** (a custom care-plan
  template), in addition to the combined standard.
- **Care-plan types needed (all OBGY-related):**
  - Antenatal care (pregnancy)
  - Postnatal care (mother after delivery)
  - Infertility treatment
  - Routine gynaecology care
  - **Newborn (neonatal) care, including the immunisation schedule**
    (India's national immunisation schedule to be used as the base, reviewed by a doctor)
- Newborns become patients too, linked to their mother's record.
- **Important:** Claude can prepare a *draft* of each template from published guidance, but every template
  must be **reviewed, corrected and approved by a qualified doctor** before real use, and each template
  should show who approved it and when.

## 3. Main daily tasks per type of user

### Outpatient visits (OPD)
- **Doctor or RMO** examines the patient, writes the prescription, **prints it**, and **gives the next visit
  date** (this is where the guideline-based plan should help: the next due visit/tests/scans are suggested).

### Inpatients (admission, delivery, operation, discharge)
| Document | Who fills it | Confirmed by |
| --- | --- | --- |
| Admission notes | RMO | – |
| Daily rounds notes | RMO | – |
| Delivery notes | Mostly RMO (sometimes doctor) | Doctor |
| Operation notes | Mostly RMO (sometimes doctor) | Doctor |
| Discharge card (summary) | Mostly RMO (sometimes doctor) | Doctor |

**What this means for the app**
- Clinical documents need a **draft → confirmed** workflow: the RMO saves a draft, the doctor reviews,
  edits if needed, and **confirms (signs)** it. Confirmed documents are locked; later changes are made as a
  recorded amendment (who, when, why), never by silently overwriting.
- Doctors need a **"waiting for my confirmation"** list.
- Prescriptions and discharge cards must **print cleanly** (hospital letterhead, doctor's name and
  registration number, date).

### Reception
- Register new patients; search existing patients.
- See today's appointment list; mark patients as **arrived**.
- See **overdue** patients (missed visits/tests/scans) and call them to remind them.
- Print a patient card.

### Nurses
- Record vital signs (weight, blood pressure, pulse, temperature).
- Record medicines given to admitted patients.
- Record **newborn vaccinations** given (ticks off the immunisation schedule).

### Lab staff
- See the list of tests ordered by doctors.
- Enter results or upload a report.
- Mark tests as done so the doctor sees the result.

## 4. Information to store

**Identity (only these):** full name, **age**, phone number, address.
- No date of birth for adult patients (age only), no relative/emergency contact, and **no Aadhaar** or other
  government ID numbers. *Exception (owner, 3 Oct 2026): the ABHA number and ABHA address, for ABDM linking –
  still never the Aadhaar number.* The hospital's own patient number (e.g. P-000001) identifies the patient.
- Note: the current test app asks for date of birth; this will change to age.

**Pregnancy:** LMP, EDD, and EDD corrected by the first (dating) scan.

**Obstetric history:** gravida, para, living children, abortions (G P L A), previous caesarean sections.

**Medical background:** blood group and Rh factor, height, weight, allergies, conditions such as diabetes,
high blood pressure, thyroid disease.

**Newborns:** date and time of birth, birth weight, sex, link to the mother.

**Risk level: decided by the application according to the guidelines.**
- The app checks the patient's details against the risk factors in the approved guideline template
  (for example age, previous caesarean, high blood pressure, diabetes, Rh-negative blood group) and
  **shows the risk level together with the reasons** ("High risk because: previous caesarean; Rh negative").
- The risk rules are part of the doctor-approved template (they can be reviewed and updated).
- The risk level is **re-checked automatically** when new information is entered (e.g. a raised blood
  pressure at a later visit).
- Safety: this is decision support. A doctor can **override** the risk level with a reason, and the override
  is recorded. The risk level decides which care plan (normal or high-risk) is suggested.

## 5. Reports, printouts and consents

### Lists and reports (all wanted)
- **Daily lists:** today's appointments; patients overdue for a visit/test/scan/vaccination; pending lab results.
- **Doctor's worklist:** documents waiting for confirmation; high-risk patients under their care.
- **Monthly numbers:** new registrations, antenatal visits, deliveries (normal vs caesarean), admissions and
  discharges, vaccinations given.
- **Government reporting:** monthly figures (e.g. HMIS).
- **Owner overview:** activity and trends as **counts and charts only, without patient names or details**
  (agreed privacy-friendly approach).

### Care-plan printouts for patients and staff
The doctor can give the patient's future plan in two forms:
- **Patient copy (simple):** upcoming visits, tests, scans and vaccinations with dates, plus any **advice**
  the doctor adds, in plain language. The doctor can print **selected items separately** (e.g. only the next
  scan) or **the complete list**.
- **Detailed copy for doctors and staff:** the full plan with guideline reasons, risk level, status of each
  item (done / due / overdue), results and notes.

### Consents
- The app must record the **consents required** (e.g. for admission, surgery/caesarean, anaesthesia, blood
  transfusion, procedures), with who gave consent, who witnessed, date/time, and a printed or scanned signed form.
- The exact list of consent forms and their wording must come from the hospital / be **legally reviewed**.

### Indian legal requirements to respect (to be confirmed with the hospital)
- **PCPNDT Act:** ultrasound in pregnancy requires **Form F** records, and **fetal sex must never be recorded or
  shown** for antenatal scans. The app should not have any field for fetal sex before birth.
- **MTP Act:** medical termination of pregnancy needs its own consent and confidential register.
- **Owner decision (2 Oct 2026):** no PC-PNDT Form F or MTP work in Perinexa – the registers, the PC-PNDT
  number and the ultrasound consent were removed (old records kept, hidden). The rule above stays: the baby's sex
  is never recorded or shown before birth.

## 6. Who should see what (privacy) – "need to know"

| Role | Can see |
| --- | --- |
| Doctor | **Own patients** (assigned to them): full records, can edit. **Other doctors' patients: read-only**, plus emergency note with reason |
| RMO | **All patients** in the hospital – full records |
| Nurse | Vital signs, medicines, vaccinations and care plans; not every doctor's note |
| Reception | Name, phone, address, patient number, appointments, overdue list – **no medical details** |
| Lab staff | Tests ordered, with the patient's name and number only; enter results |
| Hospital admin | Staff management and the hospital's audit log (administrative) |
| Owner (super admin) | Counts and charts only – no patient details |

**Sensitive records** (e.g. MTP / termination of pregnancy, infertility): only the treating doctor and RMOs.
(2 Oct 2026: MTP is not recorded in Perinexa – owner decision.)

**Decisions (confirmed)**
- **RMOs can see sensitive records** (MTP, infertility) too, in addition to the treating doctor.
- **Doctors and other doctors' patients:** a doctor can **open another doctor's patient read-only** (no editing).
  The only thing they can add is an **emergency treatment note, which requires a reason**. Opening another
  doctor's patient and adding an emergency note are both recorded in the audit log. Patients can also be
  transferred/assigned to another doctor.
- **Two roles per person:** one person can hold **more than one role in the same hospital** (e.g. doctor +
  hospital admin). The app will be changed to allow several roles per person per hospital.

## 7. Most important for the first version (agreed)

**Version 1**
1. Patient registration with the agreed information (name, age, phone, address, pregnancy details, G P L A,
   medical background) and the automatic, guideline-based risk level.
2. Guideline-based care plans for **antenatal care** (combined FOGSI / WHO / Government of India draft,
   doctor-approved), plus doctors' own protocols.
3. Printed prescriptions, with the next visit suggested from the care plan.
4. Care-plan printouts: simple patient copy (selected items or complete list, with advice) and detailed
   staff copy.
5. Daily lists: today's appointments and overdue visits/tests/scans.

**Later (version 2 and after)**
- Postnatal, infertility, gynaecology and newborn/immunisation care plans
- Admission notes, daily rounds, delivery notes, operation notes, discharge cards (RMO draft → doctor confirms)
- Lab module (orders, results, reports)
- Consents (and PCPNDT Form F / MTP register) – the registers were removed on 2 Oct 2026 (owner decision);
  the monthly report moved to Analytics
- Monthly and government (HMIS) reports, owner overview charts
- Patient portal and patient reminders by SMS/WhatsApp (needs consent and privacy review)

**Owner decision, 2 Oct 2026:** a sixth type of care, **Abortion (pregnancy loss)**, for pregnancy loss that is not
covered by the MTP Act – spontaneous miscarriage (inevitable, incomplete, complete, missed, septic),
recurrent pregnancy loss, ectopic and molar pregnancy. Induced termination (MTP) is never recorded in Perinexa, and
the baby's sex is never recorded before birth. No care plan for it in this version (built in October 2026 – see
`docs/PROGRESS.md`, Next).

**Owner's answers, 3 Oct 2026:** a loss at 28 weeks or later is refused under Abortion and recorded as a delivery;
recurrent pregnancy loss means 2 or more losses; the word stays "Abortion"; a threatened miscarriage is a continuing
pregnancy and stays under Antenatal (no longer a type of loss; older records keep it until a doctor changes them);
reception may still change the type of care; pregnancy warnings for medicines apply only to a continuing pregnancy.
