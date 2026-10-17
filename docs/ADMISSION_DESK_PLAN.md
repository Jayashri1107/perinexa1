# Admission like a hospital system (HIMS) – plan and decision

**Decision (owner, 17 Oct 2026):** the feature freeze is lifted for these 6 admission items, after comparing Perinexa's
admission with what hospital information systems (HIMS) usually offer – "more securely and easily".

Branch `admission-desk` (worktree `.claude/worktrees/admission-desk`), from `deploy-hardening` after the lab and WhatsApp
merge (1cfe79d); merged only when the owner asks and `npm test` and `npm run build` pass.

## Built

1. **IPD number and admission form.** Every stay gets an IPD number (`IP-2026-000001`, per hospital and year) – from the
   bed board and from her record. **Admission form** (A4): letterhead, IPD number, patient, attendant, ID proof (type and
   last 4 digits only), payer, admission time and type, MLC with the police station, ward and bed, doctor, reason (as the
   person printing may see it), and the general consent with signature lines.
2. **Wristband** with a Code 128 barcode of the IPD number: name, age, patient and IPD number, doctor, admitted; blood
   group and allergies only for those who may see medical details (nurses, RMOs, doctors) – reception's wristband says
   "Blood group and allergies: see the record".
3. **Admission checklist at the desk:** ID proof checked (type + last 4 digits – never the whole number), attendant's
   name, relation and phone, payer (cash, insurance with the insurer, government scheme with its name), general consent
   signed. Required for a planned or day-care admission; an emergency is admitted at once and shows **Checklist
   incomplete** on the bed board until reception completes it. MLC needs the police station (or "to inform").
4. **A doctor's admission request.** A doctor or RMO asks for an admission from her record (reason, planned or
   emergency, ward wanted, when, note). Reception sees **Admission requests** on the bed board and admits from it.
   Hospital admin → Beds: "Reception admits only after a doctor's request" (emergencies excepted, marked so).
5. **Discharge clearance and gate pass.** After the doctor confirms the discharge card, reception or billing **clears
   her for leaving**: the stay's bill must be settled, or a note says why not (e.g. insurance claim pending). A
   **gate pass** (number `GP-2026-000001`) is printed for the security desk.
6. **OPD number and case paper.** When she is marked arrived she gets the day's OPD number (`OP-2026-000001`, per
   hospital and year); **Print OPD case paper** (A4) gives the letterhead, OPD number, date, token or time, doctor,
   patient details and ruled space for the doctor to write by hand.

Every new step is in the audit log with ids only. The ID proof's number is never stored (only its last 4 digits).

## Later

Insurance pre-authorisation, room-category tariffs and upgrades, bed reservation, attendant passes, transfer between
hospitals, ID scan upload.
