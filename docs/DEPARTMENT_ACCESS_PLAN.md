# Department access – plan (owner, 9 Nov 2026)

**Status: plan only, nothing built.** The developer must read this plan before the build starts. It changes the
"need-to-know" rules in `server/src/utils/patientAccess.js` and the agreed rule in `docs/USE_CASE.md` (line 163:
a doctor can open other doctors' patients read-only).

## What the owner asked for

> When the super admin or anyone else adds a doctor and ticks "doctor", the departments are shown. The doctor is given
> a department. That doctor then sees only the patients of their own department, not every doctor's patients.

## The owner's decisions (9 Nov 2026)

| # | Question | Decision |
|---|----------|----------|
| 1 | The department list | **Only these 9**, replacing the 23 used now: Obgy, Pediatric, Radiology, Anesthesia, Diet and yoga, Surgery, Fetal medicine, Counselling, Cardiology. ("Diet and yoga" is one department.) |
| 2 | How a patient gets a department | **Reception chooses it at registration.** Existing patients need one too (see Moving the old records). |
| 3 | A patient from another department | **Hidden completely.** No read-only view and no emergency note. |
| 4 | Anesthesia, Radiology, Counselling, Diet and yoga | **They see a patient when she is referred to them.** Her doctor refers her to that department. |
| 5 | A doctor with no department | **Sees no patients**, apart from their own (`assignedDoctor`), until the admin gives them a department. |

The owner was told about the risk of decision 3: a doctor who needs a file at night has no way in. The RMO role still
sees every patient (unchanged), so the RMO on duty is the way in at night.

## The new rule for a doctor

A doctor may open a patient only when one of these is true:
1. she is **their own patient** (`assignedDoctor`), or
2. her **department** is one of the doctor's departments, or
3. she was **referred to one of the doctor's departments** (and the referral is still open).

Otherwise the patient is not in the doctor's lists, searches, dashboards or calendars, and opening her by number gives
"not found". It does not give "not allowed", because that would show that the record exists.

Inside the department, today's rules stay the same. A doctor has full access to their own patients and to unassigned
ones. Other doctors' patients in the same department are read-only, with an emergency note. Sensitive records show the
identity details only.

Nothing changes for the other roles: RMO, nurse, reception, lab, sonographer, pharmacist, billing, referral desk and
admin. A doctor who is also an RMO still sees everything.

## What gets built (backend first, then frontend)

1. **Department list.** The 9 names go in `server/src/models/Membership.js` (`DEPARTMENTS`) and in
   `client/src/platform/departments.js`.
2. **Add doctor.** On the "Add person" form (`MembersPanel.jsx` and the super admin's version), ticking "Doctor" shows
   the 9 departments. At least one is required. The departments are saved with the membership in the same request.
3. **Patient department.** `Patient.department` (one of the 9) is required at registration for new patients, in every
   place a patient is registered (reception, OPD, the lab, the referral desk and NICU B/O babies). B/O babies go to
   Pediatric. Reception and RMOs may change it later, and each change is written to the audit log.
4. **Referral to a department.** `Patient.departmentReferrals: [{ department, reason, by, at, closedAt }]`. Her doctor
   (or an RMO) adds one with a reason on her record. The patient's doctor, an RMO or the department's doctors may close
   it. Adding and closing a referral are both written to the audit log.
5. **Access check.** `forRole('doctor')` and `pregnancyVisibleFilter` in `patientAccess.js`, plus a new
   `doctorDepartmentFilter(req)` for list queries. The doctor's departments come from `req.membership`, so the check
   stays synchronous.
6. **Every route that lists or opens patients** has to use the new filter. That is about 109 places, including
   patients, visits, appointments, calendar, beds and admissions, lab results, imaging, dashboards, reports, search,
   Ask AI and exports. Any `aggregate()` needs its own `tenantId` match **and** the department match.
7. **Tests.** For each rule above: a doctor in another department cannot see her (list, search, open, or the visit,
   lab and imaging routes); a referral opens her; closing the referral hides her again. Run with `npm test` only.

## Moving the old records

- Doctors: their old departments are mapped to the new list as shown below. A doctor with no match is left without a
  department. The admin is shown a list of these doctors to fix.
  - Obstetrics & Gynaecology → Obgy
  - Paediatrics and Neonatology → Pediatric
  - Anaesthesia → Anesthesia
  - Dietetics and Yoga → Diet and yoga
  - General Surgery → Surgery
  - Genetic Counselling → Counselling
  - Radiology and Interventional Radiology → Radiology
  - Cardiology → Cardiology
  - All the others (General, General Medicine, Gastroenterology, Lactation, Neurology, the two oncology departments,
    Orthopaedics, Pathology, Physiotherapy, Plastic surgery, Urology) → none
- Patients: each patient gets her assigned doctor's first department. A patient with no doctor, or whose doctor has no
  department, stays **visible to all doctors** until reception gives her a department. Reception gets a "Needs a
  department" list.
- `Admission.department`: the old names are mapped in the same way.

## Questions for the owner before the build

- A **delivery**: the mother is in Obgy and the baby is in Pediatric. Does the paediatrician need to see the mother's
  record (proposed: no, the baby's record carries the birth details)?
