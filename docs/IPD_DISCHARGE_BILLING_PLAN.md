# IPD discharge and the IPD bill window (plan, 9 Nov 2026)

Asked for: the discharge and IPD billing of the hospital's old HIMS (IPD menu → Discharge → Patient Discharge /
Discharge Clearance; the IPD bill window with its tabs and Draft / Details / Summary prints). Decisions taken on
9 Nov 2026 (developer, for the owner):

- **The doctor's discharge card stays first** (the owner's rule: a stay ends when a doctor signs the card). After that
  the desk records the **discharge details**: type, the discharging doctor and a remark. The date and time are the
  card's.
- **Built now**: discharge details with the type; the IPD bill window; interim and final bill with three prints;
  concession with who authorised it; administrative charges.
- **Later (ideas list)**: IPD packages (a fixed price for e.g. normal delivery or LSCS). Package prices and what they
  include are the owner's decision.

## The flow at the desk

1. The doctor signs the discharge card → the stay is discharged (unchanged).
2. Billing → IPD → the patient → **Discharge**: type, doctor, remark.
3. **Final bill**: the bed days stop at the discharge; no item can be added or taken off. Billing or the admin can
   reopen it with a reason (audit).
4. Settlement (payment, concession) as now; then **Clearance** and the gate pass (unchanged, but it now needs the
   discharge type and the final bill).

While she is in hospital the window prints an **Interim bill**; after the final bill, the **Final bill**.

## Discharge types

Normal · DAMA (discharge against medical advice) · LAMA (left against medical advice) · DOR (discharge on request) ·
Transfer (to another hospital) · Death.

**Death** is never chosen at the desk. Reception and the billing staff may see only that a record is closed, never why
(`patients/deathRules.js`): when a doctor has recorded the death, the desk's form says "Record closed" and the type is
recorded from the record. People who may see her medical details see "Death".

## The IPD bill window (Billing → IPD)

- **Left**: UHID, IPD number, admitted on, patient, age, ward and bed, insurer, doctor in charge, days in hospital,
  MLC yes or no; bill amount, advance, balance, due back.
- **Tabs**: Services (by date, filter by group, show items taken off), Advance list (deposits, payments and refunds
  with receipt numbers), Previous bills (her other bills), Bed transfers (each move from now on – moves before this
  are in the audit log only), Summary (by group).
- **Foot**: print as Date-wise draft / Details / Summary; administrative charges; concession with its reason and who
  authorised it (a doctor or the hospital admin of this hospital); total, concession and net payable.
- One primary button: **Final bill** after the discharge, **Take advance** while in hospital.

## Rules kept

Every query has the hospital's `tenantId`; reception, billing and the admin only (the billing router's gate); every
change is in the audit log with ids and amounts; nothing is deleted (lines are taken off, a final bill is reopened, not
undone); the PC-PNDT guard covers every typed reason and remark; the confidential HIV test keeps its neutral name.
