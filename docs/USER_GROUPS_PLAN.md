# Super admin hospital view, user groups and page access – plan (14 Nov 2026)

**Status: Part A and Part B built (14 Nov 2026, branches `user-groups` and `user-groups-b`), at the developer's
go-ahead, and merged into master for the development app.** Part B needs the **owner's approval** before it goes to
main (see "Needs the owner" below).

Part B as built differs from the plan in one way (developer's agreement, 14 Nov 2026): the ~300 role checks were **not**
rewritten. A group holds roles (which keep deciding what is allowed and which records open) and None / View / Edit per
menu item (one per left-menu item, 23). The website sends the menu item each request comes from (`X-Perinexa-Page`);
the server refuses a request from a None item and a change from a View item (`server/src/middleware/pageAccess.js`).
Page access therefore only takes away. Group roles: never changed on the 13 role groups, nor on a group people are in.
Admin rights stay on the person (as before). Files: `server/src/access/pages.js`, `models/UserGroup.js`,
`routes/userGroups.js`, `users/userGroups.js` (the move at start), `routes/members.js` (group, own pages);
`client/src/platform/pageAccess.js`, `pages/platform/UserGroupsPage.jsx`, `components/GroupDialog.jsx`. Tests:
`server/tests/user-groups.test.js`.

Part A as built: Platform → Hospitals → one hospital has the tabs Departments, Staff by department, Patients (super
admins only) and Activity (with Department and Role filters). Staff without a department are grouped by their role
(Pharmacist, Receptionist …), as only doctors have departments. Server: `server/src/routes/platformHospitalView.js`,
the `department` / `role` filters in `routes/auditLogs.js`; tests: `server/tests/platform-hospital-view.test.js`.

## What was asked

> When the super admin clicks a hospital and selects it, he sees everything: all departments, their activity,
> everything. Then add users and user groups: when a user group is chosen, its permissions go to that group (doctor,
> reception, pharmacy, others). For users, show which pages they can access.

## The developer's answers (14 Nov 2026)

| # | Question | Answer |
|---|----------|--------|
| 1 | What the super admin sees in a hospital | **All four**: department dashboard, live activity feed, staff list per department, patient lists per department |
| 2 | Groups and the 13 fixed roles | **Groups replace roles.** The 13 roles become ready-made groups whose pages and actions can be edited; new groups can be added |
| 3 | Who makes groups | **The super admin, once, for every hospital** (platform-wide groups) |
| 4 | How fine page access is | **View / edit per page**, for a group, with **per-user changes** on top |
| 5 | Patient-record access | **Ticks decide everything** – see "Patient records" below for how this is kept inside the need-to-know rules |
| 6 | Groups per user | **One group per user** in each hospital |
| 7 | How to proceed | This plan first; the developer reads it; then backend first, then the screens |

## What exists today (master, ca5867da)

- **Super admin in a hospital** – may open any hospital and work there with every role, patient records included (owner,
  12 Oct 2026; every record opened is in that hospital's audit log). Platform → Hospitals → one hospital has two tabs:
  *Hospital and staff* and *Activity* (`client/src/pages/platform/HospitalWorkspace.jsx`). Platform → Patients lists
  every hospital's patients, identity only (`server/src/routes/platformPatients.js`, owner 24 Oct 2026).
- **Roles** – 13 fixed roles in `server/src/models/Membership.js` (`TENANT_ROLES`): admin, doctor, rmo, nurse,
  receptionist, lab, sonographer, pharmacist, billing, referral_desk, followup_coordinator, quality, records. A
  membership can hold several. Admins also get 5 ticked rights (`ADMIN_RIGHTS`). Doctors have departments.
- **Where roles are checked** – about **300 checks in 89 server files** (`requireTenantRole`, `hasRole`, role lists
  such as `READERS`/`KEEPERS` in each route) and **141 checks in 58 client files**. The left menu and tabs come from
  `hospitalModules(roles)` in `client/src/platform/modules.js` (about 140 menu entries and tabs).
- **Patient records** – `server/src/utils/patientAccess.js`: one access profile per role (`forRole`), merged when a
  person has several roles; the department rule for doctors; RMOs see every patient.

## Part A – Super admin: one hospital, everything (no rule changes)

Platform → Hospitals → one hospital gets four more tabs next to *Hospital and staff* and *Activity*. Super admins only
(platform admins as today: reads only). Everything is scoped to that one hospital (`tenantId` match, including every
`aggregate()`).

1. **Departments** (dashboard) – one card per department (the owner's 9) plus "No department": patients, visits today,
   in-patients now, lab tests ordered today, pharmacy bills and billing totals today. Counts only. Cards link to tab 4.
2. **Activity** (extended) – the existing tab gains filters: department, person, kind of action, date range. Built on
   the audit log, **still trimmed by `utils/auditDetails.js`** (no medical details).
3. **Staff** – every member of the hospital grouped by department, then by group: name, group, last sign-in,
   active / deactivated (colour + icon + word). Staff only.
4. **Patients by department** – the hospital's patients for one department: name, patient number, type of care,
   doctor, added on. **Identity only, as on Platform → Patients** (owner, 24 Oct 2026). A record still opens inside the
   hospital, audited there. The list shown is written to the hospital's audit log (count only, as today).

Server: one route file `server/src/routes/platformHospitalView.js` under `/api/platform/tenants/:id/...`, super admin
check like `platformPatients.js`. Tests: tenant separation (two hospitals, nothing leaks), platform admin refused on
patient lists, audit written, no phone/address/medical field in any response.

Part A can be built and merged on its own before Part B.

## Part B – User groups replace roles

### Data

- **`UserGroup`** (platform-wide, no `tenantId`; it holds no patient data):
  `name`, `key`, `description`, `isSystem` (the 13 starting groups cannot be deleted, only edited),
  `pages: { [pageKey]: 'none' | 'view' | 'edit' }`,
  `recordAccess: [profile]` (see Patient records), `adminRights: [ADMIN_RIGHTS]`, `isActive`.
  Deactivated, never deleted. Every change is audited (`USER_GROUP_CREATED / _CHANGED / _DEACTIVATED`, with the
  pages changed).
- **`Membership`** gets `groupId` (one group) and `pageOverrides: { [pageKey]: 'none' | 'view' | 'edit' }` (the
  per-user changes). `departments` stay on the membership. `roles` is kept, read-only, until the move is checked, then
  removed in a later step.
- **Pages list** – one file shared by server and client, `server/src/access/pages.js`: each page key with its label,
  its menu module, and which API paths it covers. A user's access to a page = the override if set, else the group's.
  Hidden pages leave the menu; a page set to *view* shows no Save / Add / Delete buttons.

### Server checks

- New `requirePage(pageKey)` middleware: reads (GET) need *view*, changes (POST/PUT/PATCH/DELETE) need *edit*.
  Each of the ~300 `requireTenantRole` / `hasRole` checks is replaced by `requirePage`, route by route, with the
  existing tests run after each module.
- `req.membership.roles` is filled from the group for the code that still reads it during the change, so the move
  can be done module by module rather than in one cut.
- The super admin keeps "everything" in every hospital; platform admins keep reads-only as today
  (`platformHospitalGuard`).

### Patient records ("ticks decide everything")

Patient-record access stays decided by the server's need-to-know rules; **ticks choose which rules apply, they never go
around them.** On the group screen, "Patient records" is a set of ticks, one per existing access profile in
`utils/patientAccess.js`:

Doctor rules (own + own department, the 9 Nov department rule) · RMO rules (every patient) · Nurse · Reception · Lab ·
Sonographer · Pharmacy · Billing · Referral desk · Records · none.

A group with several ticks gets what any of them allows – exactly how several roles merge today. No tick opens a record
the matching role could not open today. These stay fixed and cannot be ticked away by anyone: hospital separation
(`tenantScoped`), the audit log and its trimming, the fetal-sex protection, the neutral name for HIV tests, the
department rule ("another department's patient is hidden completely", owner 9 Nov 2026), "record a death" only for the
treating doctor.

### Moving existing users

On the first start after the change (like `patients/moveDepartments.js`), once:
1. The 13 roles become 13 system groups with **exactly today's pages and record profiles** (taken from
   `hospitalModules` and the route role lists, so nobody gains or loses a page on the day of the change).
2. A member with one role gets that group.
3. A member with several roles (for example doctor + admin): one group per user, so a combined group is made once per
   combination ("Doctor + admin"), with the combined pages and profiles. The list of combinations made is written to
   the log for the super admin to rename or tidy.
4. A test checks every user's pages before = after.

### Screens

- **Platform → User groups** (super admin): list of groups; one group opens a grid of pages (grouped by menu module)
  with None / View / Edit per page, the Patient records ticks and the admin rights. One primary button: Save.
- **Add / edit a user** (super admin, and the hospital admin with the "roles" right): choose **one group** from a
  drop-down; below it, the pages that group gives, each with None / View / Edit, so single pages can be changed for this
  person (changes marked "Changed for this person"). Departments are still asked when the group has Doctor rules.
- **The user's own page access** – Platform → Users → one user shows, per hospital, the group and the pages they can
  open (view / edit), changes marked.

### Tests (Part B)

- `requirePage`: view vs edit per method; overrides beat the group; none hides the page and refuses the API.
- Need-to-know unchanged: run `patientAccess`, `departments.test.js` and the sensitive-record tests with users moved
  to groups – same results as with roles.
- Move: 13 roles → 13 groups; combinations; pages before = after for every seeded user.
- Tenant separation for group assignment (a hospital admin assigns only in their own hospital).
- Client: menu built from pages; *view* hides the change buttons.

## Size and order

| Step | What | Size |
|------|------|------|
| A | Super admin hospital view (4 tabs) | medium – about 1 route file, 3 pages, tests |
| B1 | `UserGroup`, pages list, `requirePage`, move of existing users, filling `roles` from the group | medium |
| B2 | Replace role checks module by module (89 server files) | **large** |
| B3 | Client: menu and buttons from pages (58 files), group and user screens | large |
| B4 | Remove `roles` from memberships once everything reads pages | small |

Each step on its own branch, merged into master only after `npm test` and `npm run build` pass and the developer has
read it.

## Needs the owner (before Part B is built)

1. **Groups replace roles.** Who sees which page and which patient record is then set on a screen, not in the code.
   That is the most important safety setting in the app; a wrong tick on a shared group reaches every hospital at once.
2. **Patient records by ticks** – as limited above (ticks choose existing rules, never new ones). The owner should
   confirm that limit, or say if more is wanted (that would mean rewriting the need-to-know rules and a full review).
3. **Platform-wide groups** – one change applies to every hospital. Should a hospital be able to have its own version
   later?

## Open questions for the developer

1. Page keys: one per **menu module** (about 30) or one per **tab** (about 140)? Tabs give finer control but a long grid.
2. May the hospital admin edit a user's per-page changes, or only choose the group (and the super admin does the rest)?
3. "Followup coordinator" and "quality" are not patient roles today – keep them as groups with no record ticks?
4. Is Part A wanted first, merged on its own?
