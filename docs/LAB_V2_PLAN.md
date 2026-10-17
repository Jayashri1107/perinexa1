# Lab version 2 – plan and decisions

**Decision (owner, 17 Oct 2026):** the feature freeze is lifted for Lab version 2: the next 8 parts of a full lab
system, after comparing Perinexa with eLabAssist (www.elabassist.com – used only as a list of features; Perinexa keeps
its own look and wording). **The lab may register walk-in patients (identity details only, like reception) and enter
test orders from an outside doctor's prescription** for walk-in and referred patients (owner's clinical decision).

Branch `lab-v2` (worktree `.claude/worktrees/lab-v2`) from `deploy-hardening` 3cfbb60; merged only when the owner asks
and `npm test` and `npm run build` pass.

## The 8 parts, in order

1. **Walk-in and referred patients; referrers.** The lab registers a walk-in patient (name, age, phone, address) and
   orders tests from a prescription: the referring doctor or centre (Lab → Referrers), or "self (no prescription)",
   with the prescription's details. Such an order is reported by the lab (with the second-person check when the
   hospital has it on) and is not in the hospital doctors' review list; it does not tick care plans. **No commissions**
   to referrers – medical ethics forbid them; Perinexa records who referred, nothing else.
2. **Trends and delta checks.** Each order shows her earlier results of the same values (date, value, flag). A value
   that changed by more than the hospital's limit (Lab → Tests, per value, DRAFT – none by default) is flagged
   "Big change"; the flag is kept with the result and printed.
3. **QR code on the report.** Each reported order gets a secret verification code; the printed report carries a QR
   code to a public page that confirms the report is genuine: hospital, sample number, dates, the tests (the
   confidential test under its neutral name) and the patient's initials – never a value or a name.
4. **Quality control.** Control lots per test value and level (1–3) with mean and SD; daily control runs; Levey-Jennings
   chart; Westgard rules (1-2s warning; 1-3s, 2-2s, R-4s, 4-1s, 10-x rejecting); a rejected run needs a corrective
   action, and while a value's latest run today is rejected, reporting that test needs a reason.
5. **Lab inventory.** Reagents and consumables with batches, expiry, cost and reorder level; receive, adjust and write
   off; what each test uses (per test, per value of the item) is taken from the earliest-expiring batch when the
   result is reported; low-stock and expiring lists.
6. **Cost per test.** From the inventory: the reagent cost of one test, and by month the tests done, the price-list
   income, the reagent cost and write-offs, and the margin.
7. **Home collection.** An order can be collected at home: address, day and time, the collector (lab staff); the
   collector's list; on the way, collected (the sample is then taken), or could not collect (with why).
8. **USG and radiology.** Imaging orders by doctors and RMOs (USG obstetric, early pregnancy, NT, anomaly, growth,
   pelvic/TVS, follicular study, breast, X-ray, other), scheduled, done; DRAFT report templates with fields,
   findings and impression; the doctor (sonologist) signs; printed report. ⚠️ PCPNDT: no template and no field holds
   the sex of a fetus, and words about it are refused.

## Not built (need outside things)

Machine interfacing (needs the analyser's make, model and connection), a payment gateway (needs an account), an
outside doctors' portal and branches inside one hospital (need the developer's security review), an AI report summary.
