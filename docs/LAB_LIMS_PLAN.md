# Lab module – full lab system (LIMS) plan

**Decision (owner, 17 Oct 2026):** the feature freeze (HANDOVER.md section 2) is lifted **for the lab module only**, to
build the 8 "V1" features below. The owner asked for a lab system "like eLabAssist" so that the lab assistant can
manage every part of the lab and every report. eLabAssist (www.elabassist.com) was used only as a list of the
features a hospital lab system offers; nothing of its look, wording or screens is copied – Perinexa keeps its own
design (docs/BRAND.md).

Branch `lab-lims` (worktree `.claude/worktrees/lab-lims`), merged into `deploy-hardening` only when the owner asks and
`npm test` and `npm run build` pass.

## What the lab module had before (deploy-hardening 8ea25dd)

Orders by the patient's doctor or an RMO (fixed test list in `server/src/lab/labTests.js`, typed "other" tests, test
packages), worklist (samples to take, results to enter, reported in the last 7 days), results with a suggested flag
from one DRAFT adult range, report files, cancel with a reason, change after the report with a reason, the doctor's
review (care-plan items ticked, red flags), automatic billing per test, the patient portal after review (HIV never),
audit log of every step.

## V1 – built now

1. **Sample number and barcode labels; sample rejected.** Every order gets a sample number (`YYMMDD-NNNN`, per
   hospital and day). Labels print one per container (sample type) with a Code 128 barcode (`<number>-<container>`).
   The lab can reject a sample (haemolysed, clotted, too little, wrong container, not labelled, leaked, other) – the
   order goes back to "Samples to take" marked "New sample needed"; every rejection is kept.
2. **The hospital's test list.** Lab staff and doctors add the hospital's own tests (fields, units, ranges, sample
   type, department) and set, for every test, its department, turnaround time, usual outside lab and whether it is
   offered. A new test gets a ₹0 line on the price list for the hospital admin to price. Changes to fields and ranges
   make a new DRAFT version that only a doctor approves.
3. **Usual ranges by age, sex (babies only) and pregnancy.** Per value, the hospital adds ranges that apply to a
   group (from/to age in years or days of life, pregnant or not, the baby's sex recorded after birth). The first
   matching range is used, else the test's usual range. The range used is saved with each result. All DRAFT until a
   doctor approves the test.
4. **Printed lab report** with the letterhead, sample number, dates, results by department with the range used and
   the flag (colour + icon + word), the lab remark, who entered and who checked it, "DRAFT" for unapproved ranges.
   A confidential test (HIV) is left out unless the person printing includes it, and then prints under its neutral
   name.
5. **Check before the report (optional, per hospital).** When on, "Report results" by the technician only marks them
   "entered – to check"; a checker (people the hospital chose, or any lab staff or doctor) other than the person who
   entered them approves – then they go to the doctor – or sends them back with a reason.
6. **Departments, search and turnaround time.** Worklist filtered by department; Find (sample number, patient
   number or name, dates, status); each order has a due time (from the tests' turnaround times, shorter when urgent)
   and shows "Late" when past it.
7. **Tests sent to an outside lab:** which lab and their reference, sent and received (who, when); a list of tests
   still outside; the outside lab's report is attached as a report file and named on the printed report.
8. **Lab register:** orders by day (date range, department) with counts – ordered, samples taken, rejected, reported,
   reviewed, cancelled, late, sent outside, outside the range – printable and as a CSV file.

## Later (not built)

Quality control (Levey-Jennings charts, Westgard rules), reagent and consumables stock, connecting lab machines,
home sample collection, sending reports by WhatsApp or SMS from the lab, delta checks, lab-only walk-in patients,
several branches, cost per test. Referral commissions to doctors are not recommended (ethics).

## Rules kept

`tenantScoped` on the new models; need-to-know (lab staff still see only the name, number and age); every step in
the audit log with ids only; HIV under its neutral name on labels, the register and the printed report; no fetal sex
anywhere (sex-based ranges only for a baby after birth); DRAFT on every range a doctor has not approved.
