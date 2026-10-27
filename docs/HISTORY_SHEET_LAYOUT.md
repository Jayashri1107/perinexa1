# New patient as a history-taking sheet – layout draft (nothing built)

Drafted 27 Oct 2026 at the owner's request: when a new patient's details are entered, the screen should be a
history-taking sheet – tabs that ask only for the patient's history, with every suggestion, hint and check hidden.
The layout is to be finalised first; whether it is built is a separate decision (the feature pause holds).

Mock-up to click through: https://claude.ai/artifact/3UpmfFjA44UBpqDT8nJaK2 (private – share it from its Share menu
before the developer can open it). Four of the ten tabs are drawn: Menstrual (showing the whole frame), Obstetric,
Fertility (the type-of-care tab) and Review. The rest are described below.

## 1. The idea in one paragraph

Today a new patient is entered on two pages: Patient information (name, age, phone, address, doctor) and Clinical
details (one long page: pregnancy dates, obstetric counts, medical background, notes), with hints under the fields,
voice-entry examples, "From voice – check" marks, warnings about the risk level, and the allergy prompt. The draft
keeps page 1 and turns page 2 into a **sheet of tabs in the order a history is taken** – Complaint, Menstrual, Marital,
Obstetric, Past history, Family, Personal, the type-of-care tab, Review. Each tab asks only its history; nothing is
worked out, suggested or warned about while the history is taken. **Save** writes the whole sheet; the record's
Overview then shows what the app works out from it (risk level and reasons, care plan, red flags, information sheets,
the allergy strip) as it does today.

The same tabs replace **Edit details** on an existing record, so a history can be completed over several visits.

## 2. The tabs and their fields

Existing = stored on the record today; new = would need a new field. Every field may stay empty.

| Tab | Fields | For |
| --- | --- | --- |
| **Patient** (page 1 today, unchanged) | Name, age, phone, address, type of care, assigned doctor | All; reception may fill |
| **Complaint** (new) | Presenting complaint and its duration; referred by (free text, optional); reason for registration (routine antenatal, infertility, symptom …) | All adults |
| **Menstrual** (new, except LMP) | Age at first period; cycles regular or irregular; cycle length (days); days of bleeding; amount (scanty, normal, heavy); pain (none, mild, severe); LMP and whether the date is certain; the period before; anything else (clots, bleeding between periods) | All adults; LMP already exists for antenatal and abortion care |
| **Marital** (new) | Married since (years); consanguinity (yes, no, not known); contraception used before (method, when stopped); for infertility also how often and whether relations are difficult | All adults |
| **Obstetric** (existing counts + new table) | G, P, L, A and previous caesareans (existing); a table of previous pregnancies – year, outcome (live birth, stillbirth, miscarriage, ectopic, molar), weeks, mode (vaginal, caesarean, instrumental), place, baby's weight, alive now, problems (new); the tick list of problems in previous pregnancies (existing) | All adults except newborn |
| **Past history** (partly existing) | Conditions tick list (existing); operations with year (new); blood transfusion (new); current medicines (new); allergies (existing – the "None known" answer stays); immunisation – Td, rubella, hepatitis B (new); blood group and Rh (existing) | All adults |
| **Family** (new) | Tick list: diabetes, high blood pressure, thyroid disease, tuberculosis, twins, congenital anomalies, breast or ovarian cancer, bleeding disorders; who (free text) | All adults |
| **Personal** (new) | Diet (vegetarian, non-vegetarian); tobacco (none, chewed, smoked); alcohol; occupation; sleep, appetite, bowel and bladder (normal or a note); exercise | All adults |
| **Type-of-care tab** | Antenatal – *This pregnancy*: LMP, scan EDD (existing), planned or unplanned, conception (natural or after treatment), symptoms so far, medicines taken in this pregnancy, folic acid started (new). Infertility – *Fertility*: the fertility history built on 24 Oct 2026 (existing) plus the partner described – age, occupation, tobacco or alcohol, children from an earlier relationship, illnesses (new; no name, no separate record). Postnatal – *Delivery*: date, mode, place, baby's weight, breastfeeding (existing), complications (new). Abortion care – *This loss*: the existing pregnancy-loss section. Gynaecology – *Complaint details*: bleeding pattern, discharge, pain, urinary symptoms, prolapse symptoms, menopausal symptoms (new tick lists). Newborn – *Baby*: the existing birth details | By type of care |
| **Review** (new) | Every tab's answers read back as label and value, an Edit link per tab, Save, and (to decide) Print the sheet | All |

Height and weight are measurements, not history: the draft leaves them to the visit's vital signs (they are already
recorded there and feed the BMI). The findings of this pregnancy (GDM, high blood pressure, twins, low-lying placenta,
bleeding) are findings, not history, so they are not on the sheet; they stay on the record and the visit pages.

## 3. What is hidden while the history is taken

- Every hint under a field ("e.g. Penicillin – rash", "For a delivery at another hospital …", the LMP-copied note,
  the threatened-miscarriage note, the doctor hint) and every explanation of the risk rules ("Leaving everything
  unticked is not the same as none …").
- The voice-entry panel with its "What to say" examples and the "From voice – check" marks (to decide: one quiet
  Dictate button that opens the panel only when pressed, or voice entry off on the sheet).
- The AI checks offered on typed notes, and anything the app works out: the risk level, the care plan, red flags,
  the safety strip, the information sheets to give – all of these appear on the Overview after Save, as today.

What stays, because it protects the record: the duplicate check on page 1 ("She may already be registered"), the
allergy question before the sheet is saved (an empty answer is not "none"), and the silent check of free text for
words about the baby's sex (PC-PNDT Act) – the sheet refuses such a word with one line, nothing else.

## 4. How it behaves

- The tabs sit in a row under the page title; a tick marks a tab with anything filled in; the current tab is
  Indigo. Back and Next move along the row; Save the history is on every tab (one primary button per screen).
- One Save for the whole sheet; leaving the page with unsaved answers asks once. Nothing is required to save except
  the name, age and type of care from page 1 and the allergy answer (to decide: which others).
- Reception sees only the Patient tab (as today); a doctor or RMO sees all tabs; a nurse reads the sheet on the
  record but does not change it.
- The sheet prints as one page per tab in the order of the tabs, for the paper file, if "Print the sheet" is wanted.
- The Overview keeps its cards; the new history shows on it as read-only cards (Menstrual, Marital, Family,
  Personal …) and in the copy of the whole record.

## 5. To decide before anything is built

1. The order and names of the tabs, and which are needed at all (Family and Personal could be one tab).
2. The fields of each tab – add, remove, reword; whether the previous-pregnancies table replaces the G P L A boxes
   or sits beside them (the draft keeps both and checks them against each other on Save).
3. The sex of living children in the obstetric table: left out of the draft (the app records a child's sex only on
   the baby's own record after birth).
4. Height and weight: on the sheet or only at the visit.
5. Voice entry on the sheet: a quiet Dictate button, or off.
6. Printing the sheet for the paper file.
7. Whether the same tabs replace Edit details on existing records (the draft says yes).

## 6. If it is built

New fields on the patient record (complaint, menstrual, marital, previous pregnancies, operations, transfusion,
medicines, immunisation, family, personal, the type-specific extras), the same need-to-know rules as the rest of the
record, the copy of the whole record and the hospital export extended, the risk rules reading the new facts only
where the owner approves a rule for them, and the registration page and Edit details rebuilt as the tabbed sheet.
The developer's health check decides the slot; the clinical content of the tick lists is the owner's to approve.
