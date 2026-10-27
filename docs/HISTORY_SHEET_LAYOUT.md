# New patient as a history-taking sheet – layout agreed 27 Oct 2026 (nothing built)

Drafted 27 Oct 2026 at the owner's request, redrawn the same day from the owner's paper template, and agreed by the
owner the same day (section 7): when a new patient's details are entered, the history is **one short page in the
words a doctor dictates**, so that dictating it fills the form, with everything else **hidden in drop-downs** the
doctor opens only for reference. Whether and when it is built is a separate decision; the feature pause holds.

Mock-up to click through: https://claude.ai/artifact/3UpmfFjA44UBpqDT8nJaK2 (private – share it from its Share menu
before the developer can open it). Board 1 is the sheet as dictated, drop-downs closed; board 2 is the same sheet
with every drop-down opened. In Play the drop-downs open and close.

## 1. The idea in one paragraph

Page 1 (name, age, phone, address, type of care, doctor) stays as it is. Page 2 becomes **one page that reads like
the paper template**: five short lines with blanks – *Patient is … with complaints of …*, *LMP … Cycle regular /
irregular*, *Married since … Consanguinity …*, *Previous deliveries …*, *Any other personal, medical, operative or
family history …* – and a **Dictate** button. The doctor says the sentence as written on the paper; the words of the
template tell the app which blank each part fills. Under each heading sits one closed drop-down (**More …**) with the
rest of the history for that heading; nothing in it is asked, suggested or checked unless the doctor opens it. One
**Save** writes the page; the record's Overview then shows what the app works out from it (risk level and reasons,
care plan, red flags, information sheets, the allergy strip) as today. The details of this pregnancy (EDD by scan,
planned or not, conception, folic acid, medicines taken, symptoms) are **recorded at the visit**, not on this page.

## 2. The page, line by line

The wording is the owner's paper template. Existing = stored on the record today; new = would need a new field.
Voice = the app's voice entry reads it today (rules, not AI – see section 4).

| Line | Blanks | Field | Voice today |
| --- | --- | --- | --- |
| **Patient is ___ with complaints of ___** | free text (age and a few words about her), free text (complaint and duration) | new (age is on page 1 already) | no |
| **Menstrual history – LMP ___ Cycle Regular / Irregular** | date; one of two | LMP existing (antenatal and abortion care); cycle new | LMP yes; cycle no |
| **Obstetric history – Married since ___ Consanguinity ___** | years; Yes / No | new | no |
| **Previous deliveries ___** | free text, as written on paper ("one full-term normal delivery in 2023, 2.9 kg, alive and well") | new; G P L A exist in the drop-down | G P L A and caesareans yes |
| **Any other personal, medical, operative or family history ___** | one line of free text | new; conditions, allergies, blood group exist in the drop-down | conditions, allergies, blood group yes |
| *Infertility only:* **Trying to conceive since ___** | months or years | existing (the fertility history's "months trying") | no |
| *Postnatal only:* **Delivered on ___ by ___** | date; mode | existing (the delivery section) | no |

Below the last line: **Save the history** (the one primary button) and a link back to Patient information. A small
grey strip under the heading shows what was heard the last time Dictate was pressed, so the doctor can compare it
with the blanks. There is no separate print of the sheet (decision 9).

## 3. What the three drop-downs hold (closed until clicked)

| Drop-down | Fields |
| --- | --- |
| **More about her periods** | Age at first period; period before the LMP; cycle length (days); days of bleeding; amount (scanty, normal, heavy); pain (none, mild, severe); LMP date certain (yes, no); anything else |
| **More: G P L A, each pregnancy, problems, contraception** | G, P, L, A and previous caesareans (existing); a table of each previous pregnancy – year, outcome (live birth, stillbirth, miscarriage, ectopic, molar), weeks, mode, place, baby's weight, alive now, problems (new); the tick list of problems in previous pregnancies (existing); contraception used before and when stopped (new) |
| **More: conditions, operations, medicines, allergies, immunisation, blood group, family, personal** | Conditions tick list, allergies (None known / Has allergies), blood group and Rh (existing); operations with year; blood transfusion; current medicines; immunisation – Td, rubella, hepatitis B; family history tick list (diabetes, high blood pressure, thyroid disease, tuberculosis, twins, congenital anomalies, breast or ovarian cancer, bleeding disorders) with who; personal – diet, tobacco, alcohol, occupation, sleep, appetite, bowel and bladder (new) |

Not on this page: the details of this pregnancy (EDD by scan, planned, conception, folic acid, medicines taken,
symptoms so far) – they belong to the visit. The sections of the other types of care (the fertility history of
24 Oct 2026, the delivery for postnatal care, the pregnancy loss, the newborn's birth details) stay where they are
today. Height and weight are measurements, not history: they stay with the visit's vital signs (they feed the BMI
there). Findings of this pregnancy (GDM, high blood pressure, twins, low-lying placenta, bleeding) are findings, not
history: they stay on the record and the visit pages.

## 4. Dictation: how the sentence fills the blanks

The app's voice entry works by rules in the browser, not by AI, and nothing leaves the computer: it looks for the
words doctors use (LMP, gravida, para, caesarean, allergic to, blood group, …) and fills what it is sure of. The
paper template helps it, because **the template's own words become the anchors**: what follows *with complaints of*
goes into the complaint blank, what follows *LMP* is the date, *cycle regular* or *irregular* sets the cycle,
*married since* the years, *consanguinity* or *non-consanguineous* the answer, what follows *previous deliveries*
goes into that blank until the next anchor, and what follows *any other* (or *history*) goes into the last line.
Numbers said as words, Indian English and the doctor's own taught words are handled as today.

Today's voice entry already fills LMP, G P L A, previous caesareans, conditions, allergies, blood group and the
problems in previous pregnancies; the anchors for the complaint, the cycle, married since, consanguinity, the
previous-deliveries text, the last line and the two type-of-care lines would be new. The drop-down fields fill from
the same dictation where the words are there (for example *G2 P1 L1* or *allergic to penicillin* said in the
sentence); otherwise they stay empty until the doctor opens the drop-down.

## 5. What is hidden, and what stays

Hidden while the history is taken: every hint under a field, every example of what to say, the "From voice – check"
marks, the AI checks offered on typed notes, and everything the app works out (risk level, care plan, red flags,
safety strip, information sheets) – these appear on the Overview after Save, as today. The Dictate button is the
only extra control; the heard strip is the only extra text.

Stays, because it protects the record: the duplicate check on page 1 ("She may already be registered"); the
allergy answer, asked once at Save if the drop-down was never opened (an empty answer is not "none"); and the silent
check of free text for words about the baby's sex (PC-PNDT Act).

**Built on 27 Oct 2026, after the developer reviewed it with the owner:** the exception below is in place –
`server/src/patients/historyFields.js` (BORN_CHILD_TEXTS, SEX_CHECKED_TEXTS), the website's check before saving, and
tests that it is allowed in those two places only and still refused in every other text of the sheet, the notes and the
medical text (`server/tests/history-sheet.test.js`).

**The one exception the owner decided (decision 4):** in *Previous deliveries* a doctor may write "male child,
2.9 kg" about a child already born, and the owner wants that allowed. Today the app refuses such words in all patient
free text except fertility text. The exception must be built so that the protection of **this** pregnancy is not
weakened: the words are allowed in the *Previous deliveries* line and the rows of the previous-pregnancies table
only; every other field, note, visit and scan text keeps the refusal; the exception is reviewed by the developer
with the owner before it is built, and the fetal-sex tests are extended rather than loosened. `CLAUDE.md` lists the
fetal-sex protection among the things never to weaken – this is a narrowing of where the check applies, decided by
the owner, not a change to what it protects.

## 6. How it behaves

- One Save for the whole page; leaving with unsaved blanks asks once. Required to save: only the name, age and type
  of care from page 1 and the allergy answer.
- Reception fills page 1 only (as today); a doctor or RMO fills the page; a nurse reads it on the record.
- The same page replaces **Edit details** on an existing record, so a history can be completed over visits.
- The Overview keeps its cards; the new blanks show on it as a read-only "History" card in the same lines, and in the
  copy of the whole record.
- **Printing**: not the sheet on its own. The owner wants **one printed page in template form** that carries this
  history, the visit's vitals and the prescription (the tablets) together, for the paper file. Its layout is to be
  finalised after all the changes to the sheet are done (a later draft, like this one).

## 7. Decisions of 27 Oct 2026 (the owner, one at a time)

1. **Wording** – the lines keep the paper wording.
2. **Drop-downs** – three, holding what section 3 lists.
3. **Previous deliveries** – the line of text, plus the table of each pregnancy in the drop-down (the two are not
   checked against each other).
4. **Words about a born child's sex** – allowed in *Previous deliveries* only, under the conditions in section 5.
5. **Allergies** – inside the drop-down; asked once at Save when never answered.
6. **Dictate** – one button for the whole page.
7. **Extra line by type of care** – *Trying to conceive since …* for infertility, *Delivered on … by …* for postnatal
   care; the other types of care have the five lines only.
8. **Edit details** – the same page replaces it on existing records.
9. **Print** – no separate print of the sheet; one page in template form with history, vitals and prescription, to
   be finalised later.

## 8. If it is built

New fields on the patient record (complaint, cycle, married since, consanguinity, previous-deliveries text, the
other-history text, the drop-down fields), the same need-to-know rules as the rest of the record, the copy of the
whole record and the hospital export extended, new dictation anchors with their tests (the dictation corpus and
safety tests exist), the pregnancy details moved from the registration page to the visit, the previous-deliveries
exception to the fetal-sex word check (section 5), the risk rules reading the new facts only where the owner approves
a rule for them, and the registration page and Edit details rebuilt as the one-page sheet. The combined one-page
printout (decision 9) is a separate piece with its own draft. The developer's health check decides the slot; the
clinical content of the tick lists is the owner's to approve.

## 9. Earlier draft

The first draft of the morning had ten tabs (Complaint, Menstrual, Marital, Obstetric, Past history, Family,
Personal, the type-of-care tab, Review). The owner's paper template replaced it with the one page above; the tab
boards remain in versions 2 to 5 of the mock-up's history.

## 10. The printed page – history, vitals and prescription (agreed 27 Oct 2026)

Decision 9 asked for one printed page in template form instead of a print of the sheet. Board 3 of the mock-up
draws it: **one A4 page per visit**, with

1. the doctor's and the hospital's details at the top, as on today's prescription (name, qualification,
   registration number, specialities; hospital name, address, phone, timings);
2. the patient line – name, age, record number, type of care with G P L A, blood group, pregnancy weeks and EDD,
   the date, and **Allergies** (always printed, as today);
3. **History** – the five template lines as saved on the record, blanks filled and underlined, so the page reads
   like the paper sheet ("Patient is 28-year-old, second pregnancy with complaints of …");
4. **Vitals** of this visit – blood pressure, pulse, weight, temperature, SpO2, Hb, urine albumin, urine sugar
   (the fields the visit records today), then the **Diagnosis** line when the doctor has written one;
5. **Prescription** – the ℞ symbol and the medicine table of today's design (medicine in capitals with strength,
   dose, how often in the 1-0-1 style with words, when, for how long, a note under the medicine), then the general
   instructions;
6. **Advice**, the **Next visit** box with what is due, the doctor's signature block, and the footer note.

It follows the doctor's own prescription design as today: one of the ten designs, the accent colour, A4 or A5,
English alone or with Marathi or Hindi under the medicines, standard or large text, and the margins for a
pre-printed pad. The board shows the Classic design, Indigo, A4, English. The history comes from the record (it is
saved once and printed on every visit's page); the vitals and the prescription come from the visit. Nothing new is
asked of the doctor: the page prints from what the sheet and the visit already hold.

Decisions of 27 Oct 2026 (the owner, one at a time):

1. **Advice, Next visit, the pregnancy line** – the doctor's own ticks in the design, all **on** unless the doctor
   unticks one (as the design defaults are today).
2. **Language** – **Marathi under the medicines by default**: a new design starts with English plus Marathi under
   each medicine's dose, timing and duration; a doctor can change it to Hindi or English alone. (The Marathi and
   Hindi words under the medicines are draft translations – `docs/TRANSLATIONS_TO_CHECK.md` – for the owner to
   confirm.)
3. **When the page does not fit** – normal text always; the prescription continues on a **second page**.
4. **Diagnosis** – one line "Diagnosis: …" prints after the vitals when the doctor has written one; the design
   tick controls it, on by default.
5. **℞ symbol** – stays; the design tick can remove it.

If built, this is a new part of the printed prescription ("history") in the doctor's design, printed from the saved
history, plus the default language of a new design changed to Marathi; no new field on the record.
