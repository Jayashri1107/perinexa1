# Colour labels for billing type and admission type – plan (owner, 9 Nov 2026)

**Status: plan only, nothing built.** The developer reads it first. The department part depends on
`docs/DEPARTMENT_ACCESS_PLAN.md` (branch `department-access`), which brings the 9 departments.

## What the owner asked for

- Colour labels for the patient's **billing type**: Insurance, Cash, Package.
- Colour labels for the **admission type**: ANC, PNC, Delivered, Other.
- On the **doctor's dashboard**, the admitted patients are grouped and coloured by department and admission type
  (pregnant, after delivery, and so on), so a doctor can tell them apart at a glance.
- The billing label is for **doctors and RMOs** only.
- At every admission, for the mother **or the baby**, the desk must be asked: Insurance, Cash or Package.
- "Set of medicine to add": **the owner will send the list later**. It is not part of this plan.

## The owner's decisions (9 Nov 2026)

| # | Question | Decision |
|---|----------|----------|
| 1 | Billing types | **Only 3: Insurance, Cash, Package.** They replace self / insurance / govt_scheme / corporate. A government scheme or a company counts as Insurance, and its name still goes in the name field. |
| 2 | How the admission type is set | **Chosen at admission** by the desk: ANC, PNC, Delivered or Other. Whoever may change the admission (desk, RMO, her doctor) changes it by hand, for example from ANC to Delivered after the delivery. Every change goes in the audit log. |
| 3 | Who sees the billing type | **Doctors and RMOs only**, with the colour label. The billing department and the admission desk keep it, as they work with it. **Nurses no longer see it**: `payer` comes out of the nurse's fields in `patientAccess.js`. Pharmacist and referral desk: unchanged (pharmacist none, desk none). |

## Colours (from `client/src/styles/tokens.css` only – docs/BRAND.md)

Each label is **colour + icon + word**, never colour alone. Red and amber stay for clinical risk only, so a billing
label is never confused with a warning.

| Label | Token pair | Icon |
|-------|-----------|------|
| Insurance | `--status-due-fg / -bg` (blue) | shield |
| Cash | `--status-stable-fg / -bg` (green) | banknote |
| Package | `--status-admitted-fg / -bg` (purple) | box |
| ANC | `--teal-700 / --teal-100` | pregnant woman |
| PNC | `--status-due-fg / -bg` (blue) | mother and baby |
| Delivered | `--status-stable-fg / -bg` (green) | baby |
| Other | `--status-inactive-fg / -bg` (grey) | dot |

Billing and admission labels appear in different places on a row, so sharing a colour (for example Cash and Delivered)
does not mix them up. **Departments** (owner, 9 Nov 2026): **no colour per department.** The list is grouped under
department headings, and no new tokens are needed.

## What gets built (backend first, then frontend)

1. **Billing type.** `PAYER_TYPES` becomes `['cash', 'insurance', 'package']` in `models/Patient.js`, used by
   `models/Admission.js`. The billing code (`billing/billingRules.js`, IPD bills, Tally, reports) follows it. The admission
   records only the word "Package". Which package is chosen on the bill, as today.
2. **Admission form.** "Billing type" is **required** (Insurance / Cash / Package) for every admission, including NICU
   B/O babies (`clinical/nicuAdmission.js`) and the admission desk (`inpatient/admissionDesk.js`). It starts from the
   patient's own billing type. "Admission type" is required too: ANC / PNC / Delivered / Other (`Admission.stayType`).
   Babies default to Other.
3. **Changing the admission type** during the stay: a small "Change" on the stay, with an audit log entry.
4. **Doctor's and RMO's dashboard.** The admitted patients list is grouped by department, then sorted by admission type.
   Each row has the admission type label and the billing label. The billing label is sent by the server **only** to
   doctors and RMOs, never just hidden in the browser.
5. **Tests** (`npm test` only): billing type required on admission (mother and baby); a nurse gets no `payer`; a doctor
   and an RMO do; changing the admission type is audited; old data is mapped correctly.

## Moving the old records

- Patient and admission billing types: self → cash; insurance, govt_scheme, corporate → insurance (the name is kept).
  Not set → stays empty and is asked at the next admission.
- Old admissions get an admission type from the record: a delivery recorded in the stay → Delivered; postnatal care →
  PNC; antenatal care → ANC; anything else → Other. This applies to the old records only. New admissions are chosen by
  the desk.

## Questions left

None left. Package (owner, 9 Nov 2026): the desk marks only **"Package"** at admission. Which package is chosen
later, on the bill, as today.
