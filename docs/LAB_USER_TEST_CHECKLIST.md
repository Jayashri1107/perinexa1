# Pathology (lab) – what the lab user tests and checks

Written 12 Nov 2026 for the hospital's lab staff and the developer. Use **sample patients only** (names with
"Sample"), never a real patient, on a test copy or with the developer's agreement on the live site. Sign in with a
**Lab** account; some steps need a doctor's account as well (marked **Doctor**).

Tick each line when it works; write down anything that does not, with the screen and what you did.

## 1. Signing in and what the lab sees
- [ ] Sign in as Lab: the menu shows **Lab** (Dashboard, Worklist, Result entry, Find, Admitted, Register, QC, Stock,
      Tests, Referrers, Cash, Settings), **Patients** and **Today** – no clinical notes, no bills of patients.
- [ ] Open a patient: only her name, patient number and type of care show – not her history, notes or diagnosis.
- [ ] After 30 minutes without use, Perinexa signs out by itself.

## 2. Admitted patients (new, 12 Nov 2026)
- [ ] **Doctor**: admit a sample patient (ward and bed) and order a test (Hb) for her.
- [ ] Lab → **Admitted**: she shows with her ward, bed, name and patient number, and the order "Sample to take".
- [ ] Nothing else of her record shows (no doctor, diagnosis, notes, bill).
- [ ] Tick **Only those with a sample to take**: patients with nothing to collect drop off.
- [ ] Click the test: her lab order opens.
- [ ] An HIV test shows by its neutral name, never "HIV".
- [ ] A doctor or RMO opening Lab → Admitted gets "This list is for the lab".

## 3. Registering and ordering
- [ ] **Doctor** orders tests for a sample patient from her Lab tab: the order appears on the lab's **Worklist**.
- [ ] Lab → **New**: register a walk-in / referred sample patient with tests; the order appears on the Worklist.
- [ ] A package (for example Antenatal booking tests) adds all its tests (its note reminds that the HIV test needs its
      consent form and counselling).

## 4. Samples
- [ ] Worklist → an order → **Sample taken** (collect); print the **labels** – the sample number is on them.
- [ ] **Receive** the sample in the lab.
- [ ] **Reject** a sample with a reason (haemolysed, clotted …): it goes back to "Sample to take".
- [ ] An **urgent** order shows Urgent and its due time; a late one shows **Late**.

## 5. Results
- [ ] **Result entry**: type the values; a value outside the usual range shows **Low / High / Abnormal**.
- [ ] For a pregnant patient, the range used fits her weeks (where the hospital has set one) – the lab sees the numbers,
      not her weeks.
- [ ] **Big change**: a value very different from her last one asks "Are you sure?" before the report.
- [ ] **Critical value** (only once the hospital has set critical limits or critical choices in Lab → Tests): reporting
      asks whom you told, when, how, and the read-back tick – or "nobody reached". Without it, it is not reported.
- [ ] "Call not completed" stays at the top of the lab's list until the call is noted.
- [ ] If the hospital turned on **Check before the report** (Lab → Settings): the person who typed the results only
      marks them Entered; a second person approves or sends them back – never the same person.
- [ ] **Report** the order: it goes to her doctor (**Doctor**: it shows on Today under results to review, critical ones
      first, with **Acknowledge**).

## 6. Reports and amendments
- [ ] **Print** the report: the hospital's header, the values with ranges, the signer, DRAFT where a test is not
      approved yet.
- [ ] **Amend** a reported result with a reason: the earlier one is kept; a value that becomes critical asks for the
      call again.
- [ ] Send a test **outside** to another lab and mark it received back.

## 7. Find and Register
- [ ] **Find** by sample number, patient number or name; narrow by dates, status and department.
- [ ] **Register**: the day's register of samples prints.

## 8. Tests and settings (lab in-charge, with a doctor to approve)
- [ ] Lab → **Tests** → a test: change a range or add a group range; it becomes **DRAFT**.
- [ ] **Doctor** opens the same test: the red-flag rules on each value show beside the ranges; **Approve**.
- [ ] Lab staff do not see the red-flag rules.
- [ ] Critical limits (numbers) and **critical choices** (ticked options, not on HIV) – DRAFT until a doctor approves.
- [ ] Lab → **Settings** (**Doctor**): Check before the report, who may check, who signs the report, and
      "An RMO may also acknowledge a critical result" (off unless the owner chose it).

## 9. QC, stock, referrers, cash
- [ ] **QC**: enter a control run; one breaking a Westgard rule is marked rejected and asks for a corrective action;
      the Levey-Jennings chart shows the runs.
- [ ] **Stock**: receive reagent stock; it goes down as tests are reported; low stock and expiring batches show.
- [ ] **Referrers**: add a referring doctor; it can be chosen on a walk-in order.
- [ ] **Cash**: the day's cash handover adds up the walk-in payments.

## 10. Safety checks
- [ ] Another hospital's patients and orders never show.
- [ ] Nothing printed for the lab shows a pregnant patient's weeks or a red-flag text.
- [ ] Every report, amendment, critical call and acknowledgement is in Hospital admin → Audit log (ids only).
