# Pathology (laboratory) software and Perinexa – the four features the owner chose

> **Perinexa1 copy (brought over 10 Nov 2026 from `girishsolanke/perinexa`, branch `ideas-pathology-apps-review`,
> commit 6e7fb66c).** Written against the other Perinexa copy. Perinexa1's lab has grown further: the hospital's own
> test list and usual ranges (Lab setup – `server/src/routes/labSetup.js`, `docs/LAB_LIMS_PLAN.md`,
> `docs/LAB_V2_PLAN.md`), sample numbers and labels, the check before the report, outside labs, QC
> (`labQc.js`), stock (`labStock.js`) and packages. Read section 1 ("what exists") again against this code before
> building – for example the test list is not only in `lab/labTests.js` here. The ideas list in this repository is
> `docs/IDEAS_FOR_LATER.md`. **Nothing is built**; when is for the developer and the owner to agree.

Written 10 Nov 2026 at the owner's request. The owner asked what the best pathology software has that Perinexa's lab
module lacks, saw the list, and **chose four features and only these four**: ranges that fit the patient (P4),
critical results with a record of the call (P5), earlier results with graphs and a second look at a big change (P6),
and the time taken (P9). At the owner's request every other feature was taken out of this document on the same day;
the longer first version is in the git history (commit `18eb98b`) if it is ever wanted again.

**Nothing is built.** How to build the four is in `docs/LAB_BUILD_NOTE.md`, written for the developer. This document
is only the background: what laboratory software does for these four, and what Perinexa does today.

Every product claim below is from the vendor's own pages; vendors' pages are advertising, and their percentages were
not verified. A number in square brackets points to the source list in section 4.

## 1. What laboratory software does for these four

| Feature | What the products offer |
| --- | --- |
| **P4 – ranges that fit the patient** | Normal ranges by age and sex, chosen by the program from the patient's details: "age- and sex-specific reference intervals" (AyusLab [1]); normal values set by age and gender (LabSmart [3]). None of the products read offers ranges by the weeks of pregnancy – a separate laboratory program does not know them. |
| **P5 – critical results** | Critical values flagged and sent at once to the referring doctor, with a record of the alert (AyusLab [1]); a doctors' portal "with critical alerts" (Rely LIS [2]). The international laboratory standard asks that a clinician be told promptly of a critical result; an Indian hospital audit found 9 % of 4,687 critical results never passed on, and only 40 % of the calls noted in the laboratory's program [5]. |
| **P6 – earlier results** | "Cumulative & trend reporting" and a "delta check" – a result very different from the same patient's last one is held for a second look (Rely LIS [2]). A hospital study of automatic checking used such limits for each test, with a time window in days [6]. |
| **P9 – time taken** | An expected time for each test, a warning before it is missed, and turnaround-time figures: "TAT tracking live; alerts before you breach the committed turnaround" (AyusLab [1]); per-test times such as two hours for a blood count and 48 hours for a culture, with a warning to the technician and then to the lab in-charge (Fyond [4]); times printed on the report (LabSmart [3]). |

## 2. What Perinexa does today

Confirmed in the code on 10 Nov 2026 (`server/src/routes/lab.js`, `server/src/lab/`, `server/src/models/LabOrder.js`,
`client/src/pages/lab/`):

- **Ranges:** one usual range for each value of an adult test, with a note where pregnancy differs ("lower limits in
  pregnancy – doctor to judge"); babies have their own list of tests. The lab can change the suggested Low or High
  mark. All ranges are DRAFT.
- **Critical results:** a result outside the hospital's approved red-flag rules reaches the doctor's Today page the
  moment the lab reports it, and a result outside the usual range cannot be marked reviewed without a comment. The
  lab has no place to note whom it told and when, and no time is measured.
- **Earlier results:** each order stands alone. Nothing shows the last value beside the new one, there is no graph,
  and a result far from the last one is not questioned.
- **Time taken:** the times of the order, the sample, the report and the review are stored on every order. Nothing
  shows which order is late, and Analytics has no lab figures.

What Perinexa has that a separate laboratory program does not: it knows the weeks of pregnancy and the baby's age in
hours, the result ticks the care plan and raises a red flag, and the lab staff see no more of the patient than they
need. The four features build on exactly that.

## 3. What is missing

| Feature | Missing in Perinexa |
| --- | --- |
| P4 | A range chosen by her state (pregnant by weeks, after delivery, not pregnant) and a baby's by its age |
| P5 | The hospital's own critical list; the lab's note of the call; the doctor's acknowledgement; the minutes counted |
| P6 | The last values beside today's; a table and a graph over time; a question to the lab on a big change |
| P9 | An expected time per test; a "late" mark in the Lab list; the lab's times in Analytics |

## 4. Sources read

Read in full unless marked. "Search summary" means only the search engine's summary of the page was seen.

1. AyusLab (ISIRI Technologies), capabilities – https://ayuslab.com/capabilities.html
2. Rely Health Technologies, Rely LIS – https://relyhealthtech.com/solutions/relylis . Its percentages are
   advertising.
3. LabSmart, reporting features – https://website.cdn.labsmartlis.com/features/lab_reporting
4. Fyond (earlier GoClixy), 12 Mar 2025 – https://fyond.com/blog/diagnostic-lab-sample-tracking-whatsapp-reports-india
5. St. John's Medical College, Bengaluru, audit of critical value notification – search summary –
   https://www.stjohns.in/publications/evaluation-of-critical-value-and-urgent-sample-notification-at-clinical-biochemistry-laboratory-in-a-tertiary-care-hospital ;
   the ISO 15189:2022 wording on prompt notification – search summary –
   https://www.thieme-connect.com/products/ejournals/html/10.1055/s-0043-1775573
6. Wang Z et al. Design and evaluation of a LIS-based autoverification system for coagulation assays in a core
   clinical laboratory. BMC Med Inform Decis Mak 2019;19:123 – https://pmc.ncbi.nlm.nih.gov/articles/PMC6609390 .
   One hospital, one machine type.

The sources for the medical values the owner has to approve (haemoglobin and TSH in pregnancy, critical lists, delta
limits) are in `docs/LAB_BUILD_NOTE.md`, section 9.
