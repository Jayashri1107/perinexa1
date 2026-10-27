# New patient as a history-taking sheet – layout draft (nothing built)

Drafted 27 Oct 2026 at the owner's request, and redrawn the same day from the owner's paper template: when a new
patient's details are entered, the history should be **one short page in the words a doctor dictates**, so that
dictating it fills the form, with everything else **hidden in drop-downs** the doctor opens only for reference.
The layout is to be finalised first; whether it is built is a separate decision (the feature pause holds).

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

Below the last line: **Save the history** (the one primary button), **Print the sheet** (to decide), and a link
back to Patient information. A small grey strip under the heading shows what was heard the last time Dictate was
pressed, so the doctor can compare it with the blanks.

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
previous-deliveries text and the last line would be new. The drop-down fields fill from the same dictation where
the words are there (for example *G2 P1 L1* or *allergic to penicillin* said in the sentence); otherwise they stay
empty until the doctor opens the drop-down.

## 5. What is hidden, and what stays

Hidden while the history is taken: every hint under a field, every example of what to say, the "From voice – check"
marks, the AI checks offered on typed notes, and everything the app works out (risk level, care plan, red flags,
safety strip, information sheets) – these appear on the Overview after Save, as today. The Dictate button is the
only extra control; the heard strip is the only extra text.

Stays, because it protects the record: the duplicate check on page 1 ("She may already be registered"); the
allergy answer, asked once at Save if the drop-down was never opened (an empty answer is not "none"); and the silent
check of free text for words about the baby's sex (PC-PNDT Act) – the sheet refuses such a word with one line.
That last check has a catch on this page: *Previous deliveries* is free text, and a doctor may naturally write
"male child, 2.9 kg". Today the app refuses such words in patient free text (fertility free text excepted). Keeping
the refusal means writing "2.9 kg, alive and well"; allowing the words for born children is an owner decision.

## 6. How it behaves

- One Save for the whole page; leaving with unsaved blanks asks once. Required to save: only the name, age and type
  of care from page 1 and the allergy answer (to decide: anything else).
- Reception fills page 1 only (as today); a doctor or RMO fills the page; a nurse reads it on the record.
- The same page replaces **Edit details** on an existing record, so a history can be completed over visits.
- The Overview keeps its cards; the new blanks show on it as a read-only "History" card in the same lines, and in the
  copy of the whole record.
- Printing the sheet, if wanted, prints the lines and only the drop-downs that have anything in them.

## 7. To decide before anything is built

1. The wording of the lines – they follow the paper template; change any word.
2. What each of the three drop-downs holds.
3. Previous deliveries: one line of text as on paper, the table in the drop-down, or both (the draft keeps both and
   does not check one against the other).
4. A child's sex in *Previous deliveries*: keep today's refusal of such words, or allow them for born children.
5. Allergies: in the drop-down with one question at Save when empty, or a visible line on the page.
6. One Dictate button for the whole page, or a microphone on each line.
7. An extra line for infertility (*trying to conceive since …*) and postnatal (*delivered on … by …*) patients.
8. The same page for Edit details on existing records (the draft says yes).
9. Print the sheet for the paper file.

## 8. If it is built

New fields on the patient record (complaint, cycle, married since, consanguinity, previous-deliveries text, the
other-history text, the drop-down fields), the same need-to-know rules as the rest of the record, the copy of the
whole record and the hospital export extended, new dictation anchors with their tests (the dictation corpus and
safety tests exist), the pregnancy details moved from the registration page to the visit, the risk rules reading the
new facts only where the owner approves a rule for them, and the registration page and Edit details rebuilt as the
one-page sheet. The developer's health check decides the slot; the clinical content of the tick lists is the
owner's to approve.

## 9. Earlier draft

The first draft of the morning had ten tabs (Complaint, Menstrual, Marital, Obstetric, Past history, Family,
Personal, the type-of-care tab, Review). The owner's paper template replaced it with the one page above; the tab
boards remain in versions 2 to 5 of the mock-up's history.
