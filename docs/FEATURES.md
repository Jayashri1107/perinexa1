# Feature plan (approved by the owner)

Based on `docs/USE_CASE.md`. Built one feature at a time: server first, then screens; tested, committed,
and `docs/PROGRESS.md` updated after each.

## Version 1 (must-have), in build order

| # | Feature | Status |
| --- | --- | --- |
| 1 | **Several roles per person + new roles** (RMO, lab staff) | ✅ |
| 2 | **Hospital print settings** (letterhead; doctors' registration numbers) | ✅ |
| 3 | **Patient registration (OBGY)** incl. assignment to a doctor | ✅ |
| 4 | **Need-to-know access** (per role; read-only for other doctors' patients + emergency note with reason) | ✅ |
| 5 | **Care-plan template library** (combined FOGSI/WHO/GoI antenatal draft + doctors' own protocols; doctor approval) | ✅ (content awaiting doctor review) |
| 6 | **Automatic risk level** with reasons; doctor override with reason | ✅ (rules awaiting doctor review) |
| 7 | **Antenatal care plan per patient** (visits, tests, scans with due dates; doctor can adjust) | ✅ (content awaiting doctor review) |
| 8 | **Visits and typed prescriptions** (nurse vitals; doctor/RMO notes and medicines; print in 10 prescription designs, each doctor customises one; next visit from plan) | ✅ (Marathi/Hindi words awaiting review) |
| 8b | **Ready-made prescription sets** (12 draft sets – 16 since October 2026, with 4 for pregnancy-loss care – for common OBGY situations – first trimester, anaemia, PCOS …; added to a prescription with one click and changed before saving; doctors add, edit and approve; "Save as a set" from a prescription) – added at the owner's request | ✅ (sets awaiting doctor review) |
| 8c | **Voice entry on a visit** (Visit details: say the vital signs, the pregnancy check, the notes and the next visit; filled in for checking, as in registration) – added at the owner's request | ✅ (to be tried in Chrome with a microphone) |
| 8d | **Print or share a visit** (Save and print from both tabs; the visit summary when no medicines are given; each printout fitted to the page; Download PDF / Share PDF to send to the patient or to reception) – added at the owner's request | ✅ |
| 9 | **Care-plan printouts** (simple patient copy: selected or complete + advice; detailed staff copy) | ✅ |
| 9b | **Bilingual consent forms** (English + Marathi or Hindi; hospital library with doctor approval; printed for a patient, suggested from her record) – moved forward from "Later" at the owner's request | ✅ (wording awaiting legal and translation review) |
| 9c | **Calendar** (day, week and month: booked next visits, care-plan visits by the day their window opens or the day attended, EDD and LMP of current pregnancies; doctors: my patients or all patients; RMOs: all patients; reception: names, patient numbers, phones and visit dates only, never LMP, EDD or visit names; nurses, lab and admin-only staff: no calendar) – added at the owner's request | ✅ |
| 10 | **Daily lists** (today's appointments with "arrived"; overdue list) – on the **Today** start page: today's patients (booked, arrived with the time, came without a booking), and for reception "Visits due now" and "Overdue" call lists; bookings stay on the calendar marked "Arrived" | ✅ |
| 11 | **Analytics** (OBGY and newborn numbers on five tabs: overview, pregnancy, risk and conditions, care plans and visits, newborn; a sixth tab, Deliveries – delivery and newborn outcomes and deaths – built in October 2026, see PROGRESS.md). Doctors: exact numbers, "My patients", and a click on a number opens those patients (recorded in the audit log). Hospital admins: whole-hospital numbers for whole finished months, 1–4 as "fewer than 5", no patient lists. Super admin: totals per hospital and for all hospitals, numbers only. RMOs, nurses, reception and lab staff: no Analytics. Sex at birth only for babies already born – added at the owner's request | ✅ (to be checked by the owner with the demo data) |
| + | **Abortion as a type of care** (pregnancy loss outside the MTP Act: miscarriage, ectopic and molar pregnancy, recurrent-loss work-up – a threatened miscarriage stays under Antenatal (owner, 3 Oct 2026); type of loss, weeks at presentation, management, anti-D; no care plan and no delivery note in this version (care plan with hCG follow-up, findings as fields, red flags, prescription sets and a recurrent-loss test package built in October 2026 – see PROGRESS.md, Next); never induced termination (MTP) and never the baby's sex) – added at the owner's request on 2 Oct 2026 | ✅ (draft lists and hints awaiting doctor review) |
| + | **Personal appearance** (My account → Appearance: colour template, font, text size, spacing, animation – saved to each person's account) – added at the owner's request | ✅ |

Safety: care-plan content drafted from published guidance is marked **"Draft – not approved for clinical use"**
until a doctor approves the template.

## Version 2 (built 1 Oct 2026 – details and how to test in PROGRESS.md)

| # | Feature | Status |
| --- | --- | --- |
| V2.1 | Inpatients: admission, round, delivery, operation and discharge notes (RMO draft → doctor confirms), nursing chart | ✅ |
| V2.2 | Care plans for postnatal, newborn (UIP vaccinations), gynaecology and fertility care | ✅ (draft templates to approve) |
| V2.3 | Lab module: orders, lab worklist, results with flags, report files, doctor review | ✅ (usual ranges to check) |
| V2.4 | Scanned signed consents (the PC-PNDT Form F and MTP registers were removed on 2 Oct 2026 at the owner's request) | ✅ |
| V2.5 | Monthly report in the HMIS order · 12-month charts (in Analytics, doctors only, since 2 Oct 2026) | ✅ |
| V2.6 | Automatic SMS/WhatsApp reminders (with consent; provider keys in .env) · limited patient portal (off by default) | ✅ (not for real patients before review) |
| V2.10 | **ABDM linking – M1** (owner, 3 Oct 2026 – `docs/ABDM_PLAN.md`): verify and link ABHA by OTP, create ABHA with Aadhaar OTP (Aadhaar never stored), ABHA address and card, Scan & Share; practice mode until sandbox credentials. M2 (sharing her records through ABHA) and M3 (her records from other hospitals) built in October 2026, practice mode only – see PROGRESS.md, Next | ✅ practice mode (sandbox: credentials, HFR, public address and certification needed) |
| V2.9 | **Pharmacy and medicine stock** (owner, 3 Oct 2026 – `docs/PHARMACY_PLAN.md`): Pharmacist role, medicines, suppliers, batch-wise purchases, counter sales from prescriptions and issues to inpatients with GST tax invoices, returns with credit notes, H1/X/narcotic rules and registers, alerts, reports, export | ✅ (licences, RMI and GST treatment to be confirmed before real use) |
| V2.8 | **Billing** (owner, 3 Oct 2026 – `docs/BILLING_PLAN.md`): price list, automatic charges (visits, lab orders, bed days), bills, payments, deposits, refunds, discounts, receipts, daily summary, unpaid, monthly income, export | ✅ (prices to be entered by the hospital admin) |
| V2.7 | **Appointment booking** (owner, 3 Oct 2026 – `docs/APPOINTMENTS_PLAN.md`): doctors' OPD timings and leave, 10-minute slots, booking by reception and doctors (quick booking for new patients), next visit books itself, walk-in tokens per doctor per day with a slip, waiting lists in calling order, messages on booking/moving/cancelling | ✅ (Marathi/Hindi message wording awaiting review) |
| + | **Fertility treatment plans** (owner, 24 Oct 2026 – `docs/FERTILITY_PLAN.md`, an exception to the feature pause): a fertility history on the infertility record; a DRAFT library of 21 protocols from WHO 2025, NICE NG257 2026, ESHRE, the 2023 PCOS guideline, FOGSI and the ART Act; the protocols that fit her record suggested with why; the plan built from the doctor's choice, edited as text, confirmed by a doctor, ended with an outcome; **Switch to…** moves up the ladder (follicular study → IUI → IVF/ICSI) or to another procedure, closing the old plan and recording the cycles done; in the record copy and the export | ✅ (library DRAFT – every protocol to be reviewed by the owner) |

## Roles (Version 1)

| Role | Can do |
| --- | --- |
| Doctor | Own patients: full access. Other doctors' patients: read-only + emergency note with reason. Create and approve care-plan templates, consent forms and prescription sets. Analytics with exact numbers and patient lists. |
| RMO | All patients (incl. sensitive records): visits, prescriptions, plans, printouts. Cannot approve templates. |
| Nurse | Record vitals; see care plans and today's list; not all doctor notes. |
| Receptionist | Register patients (name, age, phone, address); today's appointments, mark arrived, overdue list. No medical details. |
| Lab staff | Name and patient number only (lab module comes in version 2). |
| Hospital admin | Staff and roles, print settings, hospital audit log, Analytics numbers (small numbers protected, no patient lists). No patient data unless also holding a clinical role. |
| Super admin (owner) | Hospitals and users across the platform; Analytics totals per hospital (numbers only); no patient details. |

One person can hold several roles in the same hospital. Every view or change of a patient record is audited.
