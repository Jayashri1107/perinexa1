# Pregnancy plan as a month-by-month table – asked 10 Nov 2026 (built in perinexa1 on 10 Nov 2026 – section 7)

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, commit 23be8de3).** The owner wrote this
> against the other Perinexa copy. Section 1 matches perinexa1: the patient copy is printed from the same files
> (`client/src/pages/patients/CarePlanPrint.jsx`, `carePlanPrintFormat.js`) and logs `CARE_PLAN_PRINTED`. The ideas
> list in this repository is `docs/IDEAS_FOR_LATER.md`. Nothing is built; it waits for the health check.

Written 10 Nov 2026 at the owner's request. The owner showed a sample sheet (the "9-Month Pregnancy Plan" printed by the
Anandi ANC desk, a PDF the owner keeps – it is not in this repository) and asked for the same in Perinexa:

1. the patient's plan **as a table** instead of one item below the other,
2. **an option to leave out what has passed its dates**, so the sheet shows only what is needed from the day of the
   visit, and
3. the table **editable** – the doctor adds or removes lines before the sheet is given to the patient.

The owner's two decisions of the same day are in section 5. **Nothing is built**: the feature pause holds, and this
is on the ideas list (`docs/IDEAS_FOR_LATER.md`) for the owner and the developer to choose from after the health check.

Sections 1 to 3 describe the sample and how it would map onto what Perinexa has. Apart from the two decisions in
section 5 they are a **proposal, not yet confirmed by the owner** – section 6 lists what is still open.

## 1. What Perinexa prints today

Care plan tab → **Print** → Patient copy (`client/src/pages/patients/CarePlanPrint.jsx`, wording and choice of items in
`carePlanPrintFormat.js`): a two-column list, **When / What**, of everything still to come in date order, optionally
"Already done", then advice, the doctor's own advice (printed only, never saved) and a closing note with the danger
signs. English, or English with Marathi or Hindi. Pressing Print writes "care plan printed" to the audit log.

## 2. The page in the sample

Top of the page: letterhead; name, age, patient number, mobile; obstetric score, LMP, EDD (and whether from LMP or
scan), blood group; a boxed line **Special care needed** with her risk reasons in plain words.

Then one table, **one row for each month of pregnancy**, with these columns (headings in English with Marathi under
them):

| Month | Visit dates | Scans | Tests | Medicines & vaccines | Advice |
| --- | --- | --- | --- | --- | --- |

The months, as on the sample (the dates of each month are worked out from the EDD and printed under its name):

| Month | Weeks | Month | Weeks | Month | Weeks |
| --- | --- | --- | --- | --- | --- |
| 1 | 0–4 | 4 | 14–17 | 7 | 28–31 |
| 2 | 5–8 | 5 | 18–22 | 8 | 32–35 |
| 3 | 9–13 | 6 | 23–27 | 9 | 36–40 (its dates run on to 42 w 6 d) |

In each cell: one line for each item with a tick box and its target date ("☐ Anomaly scan — Level II · 14 Dec"). The
Visit dates column lists the dates of the check-ups of that month. Months before she registered are grey with "Before
registration". In the month of the visit, everything that is to be done on the day is gathered in one line that starts
with **Today:**.

Under the table: Delivery plan, Doctor's remarks, the danger signs in both languages, three standing reminders
(movement count from 28 weeks, iron and calcium at different times, bring the sheet), the signature line and the note
that the dates are approximate and that fetal sex is not disclosed.

The sample's last pages are the ANC booking history sheet. That is a separate piece, already agreed and also not
built: `docs/HISTORY_SHEET_LAYOUT.md`, section 10.

## 3. How it would map onto Perinexa (proposal)

- **Where:** a second layout of the existing patient copy, chosen in the Print dialog ("List" as today, or "Month-by-month
  table"). Pregnancy plans only: the plans counted from a delivery, a birth or a start date have no months of
  pregnancy and keep the list. Pregnancy-loss care keeps the list, with its rule that the paper never names the loss.
- **Rows and columns:** each plan item goes in the row of the month its window starts in and in the column of its
  type – visit → Visit dates, scan → Scans, investigation → Tests, vaccination and medication → Medicines & vaccines,
  advice → Advice. An item timed after another item goes by its estimated date.
- **Words:** the item's text for the patient, as on the list today, and its Marathi or Hindi only while the English is
  still the built-in wording. The Marathi and Hindi column headings would be new DRAFT wording
  (`docs/TRANSLATIONS_TO_CHECK.md`).
- **The option "Only from today's visit"** (ticked to start with):
  - still to come (due now, upcoming, waiting for another item) → in its month, with its date;
  - overdue but still needed → in this month's row under **Now** (the sample's "Today:"), never dropped by itself;
  - done, not needed, does not apply, before booking, missed visits and items waiting for a doctor's decision → not
    printed (the same as the list today);
  - the months before this one → left out.
  Unticked: all nine months, the months before registration grey, done items with a tick and the date they were done.
- **Editing:** see section 4.
- **Unchanged:** the Draft band while the template is not approved, the audit entry on Print, the fetal-sex check on
  anything typed, the closing note.

## 4. Editing the table

Decided by the owner (section 5): an edit **changes her saved care plan**, so the paper and the record always match.
The server already has both actions, with their checks and audit entries, so no new way of changing a plan is needed:

- **Add a line** in a cell → `POST /api/patients/:id/care-plan/items` (`addCustomItem`): the column gives the kind,
  the row gives the weeks. The item is then tracked like any other (worklist, reminders, staff copy).
- **Remove a line** → `PATCH /api/patients/:id/care-plan/items/:itemId` with `not_needed`: the item stays in the plan
  as "Not needed" with the doctor's name and reason; nothing is deleted, and it can be reopened.
- **Who:** the patient's doctor or an RMO, as for every other change to a plan. Nurses, and a doctor viewing another
  doctor's patient, print the table as it is.
- The existing "Advice from the doctor" box stays as it is: printed on this copy only, not saved.

## 5. The owner's decisions (10 Nov 2026)

1. **Not built now.** It goes on the ideas list; the feature pause holds until the developer's health check.
2. **Edits change the saved plan** (an added line becomes a plan item, a removed line is marked "not needed") – not
   the printout only.

## 6. Still open (for the owner, when it is taken up)

1. Confirm section 3: the month bands, the columns, what "Only from today's visit" leaves out, and which layout the
   Print dialog opens with.
2. **Reason on removing a line.** "Not needed" asks for a reason today (not indicated, patient declined, covered by
   another item, window passed, not available here, other). One click with a default reason, or the usual choice?
3. **Special care needed** and **Delivery plan** on the patient's sheet (clinical wording): each risk reason would
   need words for the patient, approved by the owner, and a rule for the reasons that must not be printed on a paper
   a family reads (the neutral name for HIV tests applies).
4. **The three standing reminders** and the two-column danger-sign list of the sample, in place of today's closing
   note (patient wording – the owner approves).
5. Whether a line can also be **reworded or moved to another month** in the table (today: Edit item and Move date on
   the Care plan tab).

## 7. Built in perinexa1 (10 Nov 2026)

The owner agreed the same day to build it now. Built as section 3 proposes, with these defaults for section 6 (the
owner can change any of them later):

1. Section 3 as written: months 1–9 from the sample (month 9 printed 36–40 weeks, its dates to 42 w 6 d); columns
   Visit dates, Scans, Tests, Medicines & vaccines, Advice; "Only from today's visit" ticked to start with; the Print
   dialog opens with the **month table** for a pregnancy plan (changed the same day after the first test print came out as the list); **List** stays one click away, in the dialog and as a Month table / List switch in the print preview.
2. Removing a line opens the usual **Not needed** dialog with its reasons (no one-click default).
3. **No "Special care needed" and no Delivery plan** on the sheet: no new clinical wording until the owner writes it.
4. **The closing note stays** as today; no new standing reminders or danger-sign list.
5. **No rewording or moving** in the table: Edit item and Move date stay on the Care plan tab.

Also: the Advice column holds the plan's advice items; the doctor's own advice still prints in its box under the
table, on this copy only. Overdue items stay, in this month's row under **Now**. Add and Remove show in the print
preview only for those who may change the plan, and never print. The Marathi and Hindi headings are DRAFT
(`docs/TRANSLATIONS_TO_CHECK.md`).

Code: `monthTable()` and the words in `client/src/pages/patients/carePlanPrintFormat.js`; `MonthTable`, the Layout
choice and the edit buttons in `CarePlanPrint.jsx`; the starting type and weeks of an added line through
`AddItemDialog`'s `initial` (`carePlanDialogs.jsx`). No server change – the existing add and not-needed endpoints.
Tests: `client/src/pages/patients/carePlanMonthTable.test.jsx`.

### 7a. Laid out like the owner's sample sheet (10 Nov 2026, the developer's request with the owner's sample)

After the first test print, the developer asked for the printout to look like the sample (`print.pdf`, the owner's
"9-Month Pregnancy Plan" of Anandi Hospital). Changed:

- The patient copy of a pregnancy plan **opens as the table**; a **Month table / List** switch is in the preview.
- Title "9-Month Pregnancy Plan"; facts as on the sample: name, age, patient no., mobile, obstetric score, LMP, EDD
  (from LMP or scan), blood group.
- Month cell "Month 3 · 9–13 wk" with its dates ("12 Oct–15 Nov"); Marathi/Hindi in Devanagari digits.
- **Visit dates** lists the days only ("07 Dec"); this month's row is marked **Today**. In this month, every column
  starts with **Today:** – what is due now, overdue, or still to come from a month that has passed (replaces "Now").
- Each line "☐ text · 07 Dec" (a tick and the day when done).
- **Delivery plan** and **Doctor's remarks**: typed in the Print dialog, printed on this copy only, never saved,
  checked for words about the baby's sex.
- Open points 3 and 4 **reversed by the developer, marked DRAFT for the owner's approval** (`carePlanPrintFormat.js`):
  - **Special care needed** – her risk reasons in plain words from an allow-list (`SPECIAL_CARE_WORDS`). Never
    printed: an infection needing specialist care (it may be HIV – the neutral-name rule), a mental health condition,
    tuberculosis, a stillbirth or newborn death before. Reasons with the same words print once.
  - **Danger signs** – the sample's ten, in two columns (`DANGER_SIGNS`).
  - **Three reminders** and the closing line with "Fetal sex is not disclosed (PC-PNDT Act)" (`PLAN_REMINDERS`,
    `TABLE_NOTE`). They replace the old closing note on the table only; the list keeps it.
- Items keep **the patient's wording**, not the sample's clinical names: the sample prints "HIV (with consent)", and
  the neutral name for HIV tests must stay on everything the patient reads.
- Colours from `tokens.css` (indigo), not the sample's wine red (brand rules).
- The sample's **signature line** (added the same day): RMO (named when an RMO prints it) · Consultant: her doctor ·
  Date, in place of the single doctor's signature on the table page.
- Not built: page 3 of the sample (the ANC booking history sheet – `docs/HISTORY_SHEET_LAYOUT.md`).

**Approved by the owner on 10 Nov 2026** (the developer's note): the plain words for each risk reason and which
reasons never print, the danger-sign list, the three reminders and the closing line. The Marathi and Hindi stay listed
for a fluent speaker's check (`docs/TRANSLATIONS_TO_CHECK.md`).

