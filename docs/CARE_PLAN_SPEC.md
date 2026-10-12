# Feature 7 – Antenatal care plan per patient (final specification)

> The design this feature was built from (Sep 2026), kept for the developer review. Where the built app differs,
> the app and its tests are right; known differences are listed in `docs/CARE_PLAN_DECISIONS.md` ("Changed while
> testing"). The clinical questions and their defaults are in the same file.

- **How it is built:** one feature, server first and then screens, in 3 commits.
- **Data:** fake data only.
- **Decision support:** the plan suggests; the treating doctor or an RMO decides.
- **Running tests:** only `npm test` from the project folder, one run at a time.

---

## 0. How the critique was applied

| # | Critique point | Verdict | What changes (or why it was rejected) |
|---|---|---|---|
| 1 | Earlier-plan and reopen `planId` not tied to the patient | Accepted | Every plan lookup uses `{_id, tenantId, patientId: patient._id, careType}`. Anything else gives 404. Tests added. |
| 2 | Sync can apply facts from an out-of-date patient | Accepted | `basis.patientVersion`. Sync re-reads the patient, then the plan, in every attempt, and skips if the patient's `__v` is lower than the stored one. Test added. |
| 3 | Missed visits never expire | Accepted | New status `missed`, a visit `covered` by the booking visit, and a next-visit suggestion built only from visits that are not missed (§5.3, §5.7, §5.8). |
| 4 | Lazy approvals fallback breaks at the first edit; approve race | Accepted | Backfill when writing, guarded by `approvedVersion === version`. Approve becomes a conditional update. `optimisticConcurrency` on templates (§4). |
| 5 | Default booking date is wrong for patients who switch to antenatal | Accepted | Default = the hospital date when the plan is built. Doctor edits must be ≥ 4 w 0 d. The 'built late' banner is dropped, because it no longer applies. |
| 6 | Dates with a time of day (seed data) | Accepted | `utcDay()` everywhere. Patient pre-validate normalises `lmp`/`scanEdd`. Seed data fixed. `formatToParts` with a cached formatter. |
| 7 | IST-midnight flaky tests; no clock control | Accepted | `req.now` (one instant per request). Tests pin time with `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`. `patients.test.js` updated. Edge tests at 18:29Z and 18:31Z. |
| 8 | Repeat/rev check order; Undo not a real undo | Accepted | Order fixed (§7.1). Undo is offered only when the item was open before, and sends `reopen`. This is the simpler of the two proposed fixes. |
| 9 | Audit reveals a pregnancy outcome | Accepted | Plan-level actions are audited as `change: 'plan_changed'` only. No `replacesPlanId`. An automatic replacement plan is not audited on its own. |
| 10 | Approval ignores the risk rules | Accepted, refined | The rules are checked by content (`rulesHash` in approvals), not by `patient.risk.templateApproved`, because that flag also turns false after an items-only edit. Draft label when the rules that decide `high_risk` items are unapproved and there is no override (§4.3). |
| 11 | Draft wording only in a tooltip | Accepted | Visible sentence on the card. `label` in `carePlanSummary` and PlanView. Features 8 and 10 must show it. |
| 12 | Items added by merge/switch become Overdue at once | Accepted | `item.addedOn`; the late-start rule uses `max(bookedOn, addedOn)`. The preview lists items that need a decision and possible duplicates. |
| 13 | Template labels promise GDM detection | Accepted | Labels renamed to 'Pre-existing diabetes only' / 'Chronic high blood pressure only', plus an editor hint. Structured this-pregnancy findings → open question / later (built on 4 Oct 2026 – see Next in `docs/PROGRESS.md`). |
| 14 | PCPNDT gaps | Accepted | Guard also on template text. Karyotype notation, Hinglish variants and ♂/♀ added. One list in server and client, with a test that the two match. |
| 15 | Too big for one feature | Partly | **Not split:** the owner approved Feature 7 as one item and asked to continue with it. **Scope cut instead:** bulk done → Feature 8/9; stored summary and indexes → Feature 10; notices and the 'seen' endpoint → replaced by the plan log; editing custom items → later (built in October 2026 – see Next in `docs/PROGRESS.md`). Template switch/update is kept, because the Feature 5 protocols would otherwise be unusable per patient. The one new UI pattern (the Today divider row) goes into BRAND.md first; `.segmented` already exists. |
| 16 | Paused plan described in two ways | Accepted | Paused: item actions allowed; plan-level actions refused except Close. Closed: read-only. Test added. |
| 17 | An action can land on an item that sync changed | Accepted (2nd variant) | `derivePlan` raises the item's `rev` when what the person saw changes (applies, phase, dates, flags). |
| 18 | Limits can block work or trim people's entries | Accepted | No cap on entries made by people; only automatic plan-log entries are trimmed (keep 100). Rejected: a separate CarePlanEvent collection. Without transactions, the plan write and the event write could split and lose history. |
| 19 | Stored summary can't answer 'due this week' | Accepted (alternative) | No stored summary in Feature 7; Feature 10 designs `summary.windows` and its indexes. |
| 20 | Some patient changes don't trigger a sync | Accepted | Sync after every fact-changing patient save (including age) and inside `loadPatientForPlan`. |
| 21 | Browser clock used for dates | Accepted for the plan UI and routes | Plan UI uses `plan.today`; `pregnancySchema` uses `hospitalToday`; server times formatted in HOSPITAL_TIME_ZONE. Rejected for PatientForm's `gestationFromEdd`: it is only a preview while typing, and the saved value comes from the server. Listed as a separate small fix. |
| 22 | Nested router needs `mergeParams` | Accepted | `Router({ mergeParams: true })` plus a smoke test. |
| 23 | Rules for 'after' items | Accepted | The anchor's effective applicability counts (an included anchor = yes). `estimateFrom = max(anchor dueFrom, today) + weeks`. A warning (not a block) when an after-item's done date is too early. |
| 24 | Closing an on-hold plan brings a new one back | Accepted | Closed plans also match on `eddReview.toEdd`. The way back from a mistaken 'New pregnancy' is documented and tested; the confirmation shows the number of done items. |
| 25 | `planSummary` state goes stale | Accepted | `localSummary ?? patient.carePlanSummary`, reset when a new patient object arrives. |
| 26 | Custom timing checked differently from Move | Accepted | Same limits as Move; week-timed custom items use the window rule, counted from `addedOn`. |
| 27 | Converted infertility patients stay sensitive | Accepted as open question | Behaviour unchanged; stated in the access table. |
| 28 | 'Approved' stays after the content was replaced | Accepted | 'Approved v2 – replaced by approved v3' in the watch tone, on the tab and on the card. |

### 0.1 Facts checked in the code (the build relies on these)

**Templates**
- `routes/templates.js` checks only that `after.key` exists. Loops and self-references pass.
- `PUT /templates/:id` always sets `status: 'draft'` and `version += 1`.
- `ensureStandardTemplates` can set `std.status = 'draft'`.
- `CarePlanTemplate` has no `optimisticConcurrency`. Approve does read → set → `save()`.
- Template audit entries include the template **name**.

**Patient model and patient routes**
- `Patient` has `optimisticConcurrency: true`. In Mongoose 9.10 every save with changes raises `__v` (VERSION_ALL), and `recalculateMany` does `$inc: {__v: 1}`.
- `gestationalAge(patient, now)` is an exported function, not a method. It uses the UTC date.
- `Patient.pre('validate')` computes `edd = lmp + 280 d` and keeps any time of day.
- `IDENTITY_EDIT` includes `careType`, so reception can change the type of care.
- `PATCH /patients/:id` with `ageYears` runs `updateRisk`.
- `POST /patients` sets `sensitive: careType === 'infertility'`.
- `POST /:id/emergency-notes` writes the free-text `reason` into the audit log. This is outside Feature 7 and listed under risks.

**Server utilities**
- `idParams` is a non-strict `z.object({id})`, so extra params such as `itemId` are fine.
- `errorHandler` maps `VersionError` to 409.

**Tests and seed data**
- `seed-demo.js` stores `lmp: weeksAgo(12)`, which has a time of day.
- `patients.test.js` line 60 expects 12 w from a UTC date. It fails between 18:30 and 24:00 UTC once the hospital date is used.

**Client**
- `MenuButton` renders `NavLink`s only.
- `ApiError` keeps only `message`, `code` and `fields`.
- `.segmented` exists in `components.css`.
- `DataTable` has no group rows.
- `APPLIES_LABELS` says 'Diabetes / GDM only'.
- `dictation.js` has its own `SEX_WORDS`; `dictationWords.js` has its own regex without the `i` flag.

**Draft template content**
- The draft template has 44 items.
- None of its item text, risk-rule text, name or description contains a fetal-sex word or karyotype notation (checked with the new pattern).

---

## 1. Scope

### 1.1 Built in Feature 7
- Automatic plan per antenatal pregnancy from the hospital standard template (even while it is a draft, clearly labelled).
- Due dates from the effective EDD.
- Automatic re-timing and re-applicability when the patient's facts change.
- EDD-jump hold with a 'same or new pregnancy' decision.
- Pause and resume when the type of care changes.
- Abortion (pregnancy loss, added 2 Oct 2026): no care plan in this version. `noPlanReason` is `'no_plan_for_type'`,
  `POST /care-plan/start` answers 400 ("There is no care plan for abortion care in this version."), and
  `'abortion'` is not a template type. (Built in October 2026 – see `docs/PROGRESS.md`, Next: `'abortion'` is now a
  template type with the DRAFT "Care after pregnancy loss" template; the plan starts by itself from the date seen
  (`noPlanReason` `'no_loss_details'` until a type of loss is entered); a date seen moved by more than 8 weeks closes
  it and starts a new one; a pregnancy-loss plan is paused when her care becomes antenatal.) Changing an antenatal patient to Abortion pauses her antenatal plan
  (`care_type_changed`); it is never closed automatically – the paused-plan message suggests closing it with
  "Pregnancy ended" if the pregnancy has ended.
- Doctor/RMO adjustments:
  - done (with date, result, note, elsewhere), reopen, Undo
  - not needed (with reason), move date, reset date
  - include anyway, remove inclusion, keep as planned, note
  - add custom item, change booking date
  - switch or update protocol (preview + apply)
  - close and reopen plan
- Earlier plans, read-only.
- Overview card and Care plan tab.
- Access, audit and PCPNDT guard.
- Tests.

### 1.2 Deferred (explicitly not built now)
- **Feature 8 (visits):**
  - Ticking plan items done at a visit. This replaces 'bulk done' and uses `applyItemAction` with `via: 'visit'`.
  - Next visit on the prescription, using `nextVisitSuggestion()`.
  - Nurse vaccination ticks, if the owner agrees.
- **Feature 9 (printouts):**
  - Selection checkbox column and sticky selection bar.
  - Patient copy (selected items or all, plus advice) and staff copy.
  - `CARE_PLAN_PRINTED` audit entry.
  - The Draft label on every page.
- **Feature 10 (lists):**
  - Stored `summary.windows` with multikey indexes.
  - `refreshStalePlans` before lists.
  - Overdue and due-this-week lists applying the missed-visit and post-dates rules.
  - Reception rows with generic categories only.
- **Later (V2+):**
  - Editing custom items (use Not needed + Add item meanwhile). (Built in October 2026 – see Next in `docs/PROGRESS.md`.)
  - 'Apply this update to all plans'. (Built in October 2026 – see Next in `docs/PROGRESS.md`.)
  - A default protocol per doctor. (Built in October 2026 – see Next in `docs/PROGRESS.md`.)
  - Structured this-pregnancy findings (GDM, gestational hypertension, twins) as plan facts. (Built on 4 Oct 2026 – see Next in `docs/PROGRESS.md`; also low-lying placenta and bleeding.)
  - Postnatal, newborn and other plan types.
  - A 'used by N plans' count on templates. (Built in October 2026 – see Next in `docs/PROGRESS.md`.)
  - PatientForm gestation preview on the hospital date.

---

## 2. Dates and constants

### 2.1 `server/src/careplans/dates.js` (pure except for reading config)

All plan dates are **date-only values stored as UTC midnight**. 'Today' is the hospital's calendar date.

```js
import { config } from '../config.js';
export const DAY = 86_400_000;
export const PREGNANCY_DAYS = 280;
const formatters = new Map();
function ymdIn(timeZone, instant) {
  let f = formatters.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }); formatters.set(timeZone, f); }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return [Number(p.year), Number(p.month), Number(p.day)];
}
export function hospitalToday(now = new Date(), timeZone = config.HOSPITAL_TIME_ZONE) {
  const [y, m, d] = ymdIn(timeZone, now); return new Date(Date.UTC(y, m - 1, d));
}
export const toHospitalDate = (instant, tz) => hospitalToday(new Date(instant), tz);
export const utcDay = (v) => { if (v == null) return null; const d = new Date(v); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
export const addDays = (d, n) => new Date(utcDay(d).getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((utcDay(b) - utcDay(a)) / DAY);
export const dayZero = (edd) => addDays(edd, -PREGNANCY_DAYS);            // LMP-equivalent of the EDD in use
export const weekStart = (edd, w) => addDays(dayZero(edd), 7 * w);         // w w 0 d
export const weekEnd = (edd, w) => addDays(dayZero(edd), 7 * w + 6);       // w w 6 d (completed weeks, inclusive)
export function gaOn(edd, date) { const t = daysBetween(dayZero(edd), date); return t < 0 ? null : { weeks: Math.floor(t / 7), days: t % 7, totalDays: t }; }
export const timeIn = (instant, tz = config.HOSPITAL_TIME_ZONE) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
```

**Configuration**
- `config.js`: `HOSPITAL_TIME_ZONE: z.string().default('Asia/Kolkata').refine(isValidTimeZone, 'HOSPITAL_TIME_ZONE is not a known time zone')`, where the check is `new Intl.DateTimeFormat('en', { timeZone })` without a throw.
- Add `HOSPITAL_TIME_ZONE=Asia/Kolkata` to `server/.env.example`.

**One instant per request**
- In `createApp`, right after `cookieParser()`: `app.use((req, _res, next) => { req.now = new Date(); next(); })`.
- All plan code uses `req.now`, so a request that straddles midnight sees a single 'today'.

**Fixes to existing code (commit 1)**
- `gestationalAge(patient, now)`: `today = hospitalToday(now)`, `edd = utcDay(effectiveEdd)`.
- `Patient.pre('validate')`: `p.lmp = utcDay(p.lmp); p.scanEdd = utcDay(p.scanEdd)` before computing `edd`/`effectiveEdd`.
- `pregnancySchema` in `routes/patients.js`: compare with `hospitalToday()` instead of `Date.now()`, so an LMP of today is accepted at 00:00–05:30 IST.
- `seed-demo.js`: `weeksAgo(w) = addDays(hospitalToday(), -7 * w)`.
- **Templates:** week numbers are **completed weeks, inclusive**. '11–13 w' means 11 w 0 d to 13 w 6 d.

### 2.2 Constants (`server/src/careplans/planRules.js`; each has an open question with a default)

| Constant | Value | Meaning |
|---|---|---|
| `BOOKING_WINDOW_DAYS` | 14 | At-booking items are due from `bookedOn` to `bookedOn + 13` |
| `AFTER_WINDOW_DAYS` | 14 | After-items are due from `anchor.done.on + 7·weeks`, for 14 days |
| `LATE_START` | `{ visit: 'lapsed', advice: 'catch_up', medication: 'decide', investigation: 'decide', scan: 'decide', vaccination: 'decide' }` | What happens when a window ended before the item's start date |
| `REMINDER_KINDS` | `['visit','investigation','scan','vaccination']` | Kinds that may go on reminder lists (`auto.listable`) |
| `SAME_PREGNANCY_DAYS` | 56 | An EDD change above this is held for a decision; also used for resume/new-pregnancy matching |
| `POST_DATES_DAYS` | 21 | EDD + 21 d → banner (and excluded from Feature 10 lists) |
| `MIN_BOOKING_DAYS` | 28 | A doctor-set booking date must be ≥ day 0 + 28 (4 w 0 d) |
| `DONE_EARLIEST_DAYS` | 365 | Done date ≥ day 0 − 365 d (earlier results, e.g. blood group) |
| `MOVE_MAX_SPAN_DAYS` | 84 | Longest due window a person can set |
| `RECENT_CHANGES_DAYS` | 14 | Automatic log entries shown in the 'Recent automatic changes' alert |
| `AUTO_LOG_KEEP` | 100 | Automatic plan-log entries kept; entries by people are never trimmed |
| `MAX_ITEMS` / `MAX_CUSTOM` | 400 / 100 | Per plan |
| `PLAN_ENGINE_VERSION` | 1 | Raise when derivation changes; every plan re-derives on its next read |

### 2.3 Worked examples (checked with node; they become engine tests)

**EDD 1 Mar 2027 → day 0 = 25 May 2026**
- Scan and visit windows:
  - NT 11–13 w → 10 Aug – 30 Aug 2026
  - Anomaly 18–20 w → 28 Sep – 18 Oct 2026
  - Visit 36 w → 1 – 7 Feb 2027
- Gestation:
  - 28 Sep 2026 = 18 w 0 d
  - 20 Jul 2026 = 8 w 0 d
  - The minimum booking date is 22 Jun 2026 (4 w 0 d)
  - EDD + 21 d = 22 Mar 2027 = 43 w 0 d
- Visit windows: visit_16 is 7–27 Sep 2026; visit_20 is 5–25 Oct; visit_24 is 9–29 Nov; visit_28 is 7–27 Dec.
- **Missed visit:**
  - visit_24 is Overdue from 30 Nov to 6 Dec 2026.
  - It becomes **Missed** on 7 Dec 2026 (28 w 0 d), when visit_28's window starts. On 21 Dec 2026 (30 w 0 d) the suggestion is visit_28, not visit_24.
  - visit_37 (8–14 Feb 2027) becomes Missed on 15 Feb 2027 (visit_38 starts), and stays Missed after visit_38 is marked done on 16 Feb.
- **Booking at 16 w 3 d (17 Sep 2026):**
  - visit_16 (7–27 Sep) → 'Covered by the booking visit'.
  - visit_booking due 17–30 Sep.
- **Booking at 20 w 0 d (12 Oct 2026):**

  | Item | Result |
  |---|---|
  | NT, dating scan, IFA, calcium | Decide |
  | visit_16 | Before booking |
  | visit_20 (5–25 Oct) | Covered by the booking visit |
  | Anomaly scan (28 Sep – 18 Oct) | Due now |
  | Deworming (14–26 w), flu (14–36 w) | Due |
  | At-booking bloods | Due 12–25 Oct |

- **Booking at 33 w 0 d (11 Jan 2027):**
  - Fetal-movement advice (28 w) is caught up and due 11–24 Jan 2027.
  - visit_32 (28 Dec – 17 Jan) → covered.
  - visit_34 → upcoming.

**LMP 1 Jun 2026 (EDD 8 Mar 2027)**
- NT → 17 Aug – 6 Sep 2026
- Anomaly → 5 – 25 Oct 2026
- Booking on 14 Sep 2026 = 15 w 0 d

**After-item and time zone**
- Td-1 done 15 Oct 2026 → Td-2 due 12 – 25 Nov 2026.
- At 2026-10-18T19:00Z it is 19 Oct in IST, so the anomaly scan (due by 18 Oct) is **Overdue**.
- At 2026-10-18T18:29Z it is 18 Oct 23:59 IST, so the scan is **Due now**.
- At 2026-10-12T20:00Z it is 13 Oct in IST.

---

## 3. Data model

### 3.1 `server/src/models/CarePlan.js` (exact schema)

```js
import mongoose from 'mongoose';
import { tenantScoped } from '../utils/tenantScope.js';
import { APPLIES_WHEN, ITEM_KINDS, TEMPLATE_CARE_TYPES } from './CarePlanTemplate.js';

const { ObjectId, Mixed } = mongoose.Schema.Types;
const nested = (def) => ({ type: new mongoose.Schema(def, { _id: false }), default: null });
const actor = { by: { type: ObjectId, ref: 'User', default: null }, byName: { type: String, required: true, maxlength: 150 }, at: { type: Date, required: true } };

export const PLAN_STATUSES = ['active', 'paused', 'closed'];
export const CLOSE_REASONS = ['delivered', 'pregnancy_ended', 'transferred_out', 'care_elsewhere', 'new_pregnancy', 'other'];
export const USER_CLOSE_REASONS = CLOSE_REASONS.filter((r) => r !== 'new_pregnancy'); // new pregnancy goes through the EDD decision
export const NOT_NEEDED_REASONS = ['not_indicated', 'declined', 'covered', 'window_passed', 'unavailable', 'other'];
export const PHASES = ['open', 'waiting', 'check', 'decide', 'lapsed', 'on_hold', 'not_applicable', 'done', 'not_needed', 'inactive'];
export const FLAGS = ['check_date', 'outside_window', 'no_longer_indicated'];

const historyEntry = new mongoose.Schema({
  at: { type: Date, required: true }, by: { type: ObjectId, default: null }, byName: { type: String, required: true },
  action: { type: String, required: true, maxlength: 40 }, from: Mixed, to: Mixed, reason: { type: String, maxlength: 300, default: '' },
}, { _id: false });

const logEntry = new mongoose.Schema({
  at: { type: Date, required: true }, by: { type: ObjectId, default: null }, byName: { type: String, required: true },
  action: { type: String, required: true, maxlength: 40 }, text: { type: String, maxlength: 300, default: '' }, auto: { type: Boolean, default: false },
}, { _id: false });

const itemSchema = new mongoose.Schema({            // keeps its own _id = the stable item id for the API and audit
  key: { type: String, required: true, maxlength: 80 },          // template key; custom: 'custom_' + 8 hex
  origin: { type: String, enum: ['template', 'custom'], required: true },
  rev: { type: Number, default: 0 },
  revByName: { type: String, default: null },                    // who or what last raised rev ('Automatic' for sync)
  revAt: { type: Date, default: null },
  clientRequestId: { type: String, maxlength: 64, default: null },
  // content: copied from the template, or the doctor's custom item
  kind: { type: String, enum: ITEM_KINDS, required: true },
  name: { type: String, required: true, maxlength: 200 },
  patientText: { type: String, maxlength: 300, default: '' },
  source: { type: String, maxlength: 400, default: '' },
  appliesWhen: { type: String, enum: APPLIES_WHEN, default: 'always' },
  timing: {
    atBooking: { type: Boolean, default: false },
    fromWeek: { type: Number, min: 0, max: 44, default: null },
    toWeek: { type: Number, min: 0, max: 44, default: null },
    after: { key: { type: String, maxlength: 80, default: null }, weeks: { type: Number, min: 1, max: 40, default: null } },
    date: { type: Date, default: null },     // custom, fixed dates
    dateBy: { type: Date, default: null },
  },
  addedOn: { type: Date, default: null },     // hospital date the item joined an existing plan (merge/switch/custom); null = built with the plan
  notInTemplate: nested({ since: Date, templateName: String, version: Number }),
  // staff-owned: ONLY explicit actions by a person write these
  state: { type: String, enum: ['open', 'done', 'not_needed'], default: 'open' },
  done: nested({ on: { type: Date, required: true }, elsewhere: { type: Boolean, default: false }, result: { type: String, maxlength: 500, default: '' },
    note: { type: String, maxlength: 1000, default: '' }, via: { type: String, enum: ['manual', 'visit'], default: 'manual' }, visitId: { type: ObjectId, default: null }, ...actor }),
  notNeeded: nested({ reasonCode: { type: String, enum: NOT_NEEDED_REASONS, required: true }, reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  manualDate: nested({ dueFrom: { type: Date, required: true }, dueBy: { type: Date, required: true }, reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  forceInclude: nested({ reason: { type: String, required: true, minlength: 5, maxlength: 300 }, ...actor }),
  note: nested({ text: { type: String, required: true, maxlength: 1000 }, ...actor }),
  staffBasis: nested({ edd: Date, bookedOn: Date, timingKey: String, applies: { type: String, enum: ['yes', 'no', 'unknown'] }, at: Date }),
  added: nested({ reason: { type: String, maxlength: 300, default: '' }, ...actor }),
  history: { type: [historyEntry], default: [] },
  // engine-owned: ONLY derivePlan writes these (all date-independent)
  auto: {
    applies: { type: String, enum: ['yes', 'no', 'unknown'], default: 'yes' },
    why: { type: String, default: null },
    riskBased: { type: Boolean, default: false },                // applicability depends on high_risk (own or inherited)
    windowFrom: { type: Date, default: null }, windowTo: { type: Date, default: null },
    dueFrom: { type: Date, default: null }, dueBy: { type: Date, default: null },
    dateSource: { type: String, enum: ['window', 'booking', 'after_done', 'catch_up', 'manual', 'fixed', null], default: null },
    lateStart: { type: String, enum: ['lapsed', 'covered', 'decide', 'catch_up', null], default: null },
    lateFrom: { type: String, enum: ['booking', 'added', null], default: null },
    anchor: nested({ state: { type: String, enum: ['waiting', 'not_needed', 'missing', 'loop'] }, key: String }),
    flags: { type: [{ type: String, enum: FLAGS }], default: [] },
    phase: { type: String, enum: PHASES, default: 'open' },
    listable: { type: Boolean, default: false },
  },
});

const planSchema = new mongoose.Schema({
  patientId: { type: ObjectId, ref: 'Patient', required: true },
  careType: { type: String, enum: TEMPLATE_CARE_TYPES, required: true },   // V1 builds 'antenatal' only
  current: { type: Boolean, default: true },                               // false once closed
  status: { type: String, enum: PLAN_STATUSES, default: 'active' },
  pausedReason: { type: String, enum: ['care_type_changed', 'no_edd', null], default: null },
  closed: nested({ reason: { type: String, enum: CLOSE_REASONS, required: true }, note: { type: String, maxlength: 500, default: '' }, auto: { type: Boolean, default: false }, ...actor }),
  replacesPlanId: { type: ObjectId, default: null },
  source: {
    templateId: { type: ObjectId, ref: 'CarePlanTemplate', required: true },
    templateName: { type: String, required: true },
    templateKind: { type: String, enum: ['standard', 'personal'], required: true },
    ownerName: { type: String, default: null },
    version: { type: Number, required: true },
    itemsHash: { type: String, required: true },
    chosenBy: nested({ ...actor }),                                          // null = automatic (standard)
  },
  basis: {                                                                   // medical facts: never sent to the browser or audited
    key: { type: String, required: true }, edd: { type: Date, required: true }, eddSource: { type: String, enum: ['scan', 'lmp'], required: true },
    patientVersion: { type: Number, required: true }, engineVersion: { type: Number, required: true }, syncedAt: { type: Date, required: true },
  },
  eddReview: nested({ fromEdd: Date, toEdd: Date, detectedAt: Date }),      // EDD moved > 56 d: plan on hold
  bookedOn: { type: Date, required: true },
  bookedOnSetBy: nested({ ...actor }),                                       // null = automatic default
  items: { type: [itemSchema], default: [], validate: [(v) => v.length <= 400, 'A care plan can have at most 400 items.'] },
  log: { type: [logEntry], default: [] },
  createdBy: { by: { type: ObjectId, default: null }, byName: { type: String, required: true } },   // 'Automatic'
}, { timestamps: true, optimisticConcurrency: true });
planSchema.plugin(tenantScoped);
planSchema.index({ tenantId: 1, patientId: 1, careType: 1 }, { unique: true, partialFilterExpression: { current: true } });
planSchema.index({ tenantId: 1, patientId: 1, createdAt: -1 });
export const CarePlan = mongoose.model('CarePlan', planSchema);
```

- **No fetal-sex field anywhere.**
- `toJSON` is not used for the API; `planView()` (§10.2) builds a whitelisted object.
- Feature 10 adds its own summary field and indexes.

### 3.2 Who writes what (tested as a property)

| Fields | Written by | Never written by |
|---|---|---|
| Content, `origin`, `notInTemplate`, `addedOn`, `source` | create, template merge, custom add | item actions, sync |
| `state`, `done`, `notNeeded`, `manualDate`, `forceInclude`, `note`, `staffBasis`, `added`, `history`, `bookedOn(SetBy)`, `closed` (user) | actions by people (routes; Feature 8's `applyItemAction`) | sync, derive, merge |
| `auto.*`, `basis.syncedAt` | `derivePlan` only | anything else |
| `rev`, `revByName`, `revAt` | actions by people, merge, `derivePlan` (when what a person sees changes) | – |
| `basis.key/edd/eddSource/patientVersion/engineVersion`, `eddReview`, `status` active↔paused, automatic `closed` (new pregnancy), automatic log entries | sync, EDD decision | item actions |

### 3.3 Changes to existing code

**Templates (`CarePlanTemplate` and `routes/templates.js`)**
- `CarePlanTemplate`:
  - Add `approvals: [{ version: Number, itemsHash: String, rulesHash: String|null, by: ObjectId, byName: String, at: Date }]` (default `[]`).
  - Add `optimisticConcurrency: true`.
- `routes/templates.js`:
  - **Loop check** in `templateBody.superRefine`: follow each item's `after` chain. On a self-reference or loop, add an issue on `items[i].after.key`: `Item "x" is timed after itself (through "y").`
  - **PCPNDT check** on `name`, `description`, `sources` and each item's `name`/`patientText`/`source` (§12).
  - **Backfill before changes** in PUT (§4.2).
  - **Approve** becomes a conditional update (§4.2).
- `templatesService.ensureStandardTemplates`:
  - Backfill sweep (§4.2) before its own change.
  - Its existing `VersionError` catch stays.

**Utilities**
- `utils/validate.js`: export `dateOnly(label)` (moved from `patients.js`, which imports it).
- `utils/patientLookup.js`:
  - `findPatient(req)`, moved from `routes/patients.js` unchanged. Both routers import it.
  - `loadPatientForPlan(req)` (§6.1).
- `utils/pcpndt.js` (server) + `client/src/pcpndtWords.js` (client). Identical patterns (§12). `routes/dictationWords.js` and `client/.../dictation.js` import them.
- `utils/patientAccess.js`:
  - Add `'carePlanSummary'` to `CLINICAL_FIELDS`.
  - `projectPatient().access` gets `canViewCarePlan = view.has('pregnancy')` and `canEditCarePlan = editClinical`.

**Audit**
- `models/AuditLog.js`: add `CARE_PLAN_CREATED`, `CARE_PLAN_VIEWED`, `CARE_PLAN_CHANGED` to `AUDIT_ACTIONS` and to `AUDIT_CATEGORIES.patients`.
- `routes/auditLogs.js` `safeDetails`: `CARE_PLAN_*` → only `['patientId','mrn','planId','itemId','change','access']` (defence in depth, also for older entries).

**Wiring and tests**
- `routes/patients.js`:
  - `patientsRouter.use('/:id/care-plan', carePlanRouter)`, placed right after the role gate.
  - Sync hooks (§6.3).
  - `carePlanSummary` added to GET `/:id` for clinical viewers.
- `routes/carePlans.js`: `export const carePlanRouter = Router({ mergeParams: true })`.
- `server/tests/helpers.js` `connectTestDb`: add `CarePlan.init()` (the unique index must exist before the race tests).

---

## 4. Content hashes and approval (`server/src/careplans/hashes.js`)

### 4.1 Hashes

**`itemsHash(items)`**
- sha256 (`node:crypto`) of canonical JSON of the items, sorted by `key`.
- Fields: `[key, kind, name, patientText, atBooking, fromWeek, toWeek, after.key, after.weeks, appliesWhen, source]`, with `null`/`''`/`undefined` normalised to `null`.

**`rulesHash(riskRules)`**
- sha256 of the rules sorted by `key`.
- Fields: `[key, label, factor, op, value, condition, complication, level, source]`.
- `null` when there are no rules (personal protocols).

**What counts**
- Editing only the name or description never changes either hash.
- Editing only the rules changes `rulesHash`, not `itemsHash`.

### 4.2 Approvals: written, never guessed

**`backfillApproval(t)`** (in memory; idempotent)
- If `t.approvals.length === 0 && t.status === 'approved' && t.approvedVersion === t.version`, push `{ version: t.version, itemsHash: itemsHash(t.items), rulesHash: rulesHash(t.riskRules), by: t.approvedBy, byName: t.approvedByName, at: t.approvedAt }`.
- The `approvedVersion === version` guard means a template left 'approved' by the old approve race is not trusted.

**Where the backfill runs**
1. `PUT /templates/:id`, **before** `Object.assign`/`status = 'draft'`, in the same `save()`.
2. `ensureStandardTemplates`, before it changes `std`.
3. `POST /approve`, before pushing the new entry.
4. A per-tenant sweep inside `ensureStandardTemplates`: `CarePlanTemplate.find({ tenantId, status: 'approved', 'approvals.0': { $exists: false } })`, then `backfillApproval` + `updateOne({_id, tenantId, 'approvals.0': {$exists: false}}, {$set: {approvals}})`.
   - Remember done tenants in a process-level `Set`.
   - It runs before any plan is read, because every patient route calls `ensureStandardTemplates` first.

**Approve (replaces the read → save)**

```js
const t = await findTemplate(req);            // existing checks: canApprove, version === body.version, items.length
if (t.status === 'approved' && t.version === version) return res.json(...);
backfillApproval(t);
const entry = { version, itemsHash: itemsHash(t.items), rulesHash: rulesHash(t.riskRules), by: req.user._id, byName: req.user.name, at: req.now };
const r = await CarePlanTemplate.updateOne(
  { _id: t._id, tenantId: req.tenantId, version, status: 'draft' },
  { $set: { status: 'approved', approvedBy: entry.by, approvedByName: entry.byName, approvedAt: entry.at, approvedVersion: version },
    $push: { approvals: { $each: [...(t.approvals.length && !t.isModified('approvals') ? [] : t.approvals.slice(0, -0 || undefined)), entry] } } });
```

In plain words:
- Push the backfilled entry (if any) and `entry`.
- If `matchedCount === 0`, re-read:
  - Approved at this `version` → 200.
  - Otherwise → 409: 'This template was changed (now version N) after you opened it. Please review the latest version before approving.'
- Audit and recalculate as today.

**`approvalsOf(t)`**
- Returns `t.approvals`, plus the same guarded fallback as `backfillApproval` (so a read before the sweep gives the same answer).
- It is **never** based on `status` alone.

### 4.3 The plan's approval label (worked out on every read; nothing stored)

```
srcT = template(plan.source.templateId); stdT = hospital standard antenatal template
itemsApproval  = approvalsOf(srcT).filter(a => a.itemsHash === plan.source.itemsHash).at(-1) ?? null
usesRisk       = plan.items.some(it => it.auto.riskBased)
rulesApproved  = !usesRisk || Boolean(patient.risk?.override) || approvalsOf(stdT).some(a => a.rulesHash === rulesHash(stdT.riskRules))
approved       = Boolean(itemsApproval) && rulesApproved
label          = approved ? null : 'Draft – not approved for clinical use'
draftReason    = approved ? null : (!itemsApproval ? 'content' : 'risk_rules')
currentHash    = itemsHash(srcT.items)
updateAvailable = currentHash !== plan.source.itemsHash
updateApproved  = updateAvailable && approvalsOf(srcT).some(a => a.itemsHash === currentHash)
newerApprovedVersion = updateApproved ? srcT.version : null
```

What the plan shows:
- **Approved, and the current template content is the same:** stable pill 'Approved · v{itemsApproval.version}' plus the approver and date.
- **Approved, but newer approved content exists:** watch pill 'Approved v{a} – replaced by approved v{b}'.
- **Draft:** watch pill 'Draft' **and** the visible sentence 'Draft – not approved for clinical use'.
  - With `draftReason = 'risk_rules'`, the text adds: 'The risk rules that decide the high-risk items have changed since a doctor last approved them.'
  - Items with `auto.riskBased` carry the neutral marker 'Based on draft risk rules'.

---

## 5. Plan engine (`server/src/careplans/planEngine.js`, pure, no database)

### 5.1 Facts and basis key (`planFacts(patient)`)

```
edd = utcDay(patient.pregnancy.effectiveEdd) ?? null; eddSource = patient.pregnancy.scanEdd ? 'scan' : 'lmp'
f = patientFacts(patient)                                   // reuse risk.js
rhNegative = f.rhNegative == null ? 'unknown' : f.rhNegative ? 'yes' : 'no'
r = patient.risk
highRisk = r?.override ? (r.override.level === 'high' ? 'yes' : 'no')
         : r?.level === 'high' ? 'yes' : r?.level === 'low' ? 'no'
         : r?.level === 'moderate' ? (r.mayBeHigher ? 'unknown' : 'no')
         : 'unknown'                                          // incomplete or not worked out
previousCaesarean = f.previousCaesareans > 0 ? 'yes' : (f.previousCaesareans === 0 || isFirstPregnancy(patient)) ? 'no' : 'unknown'
diabetes     = f.conditions.includes('diabetes')     ? 'yes' : f.conditionsKnown ? 'no' : 'unknown'   // pre-existing only
hypertension = f.conditions.includes('hypertension') ? 'yes' : f.conditionsKnown ? 'no' : 'unknown'   // chronic only
basisKey = ['e' + PLAN_ENGINE_VERSION, 'antenatal', iso(edd) ?? 'none', 'hr:' + highRisk, 'rh:' + rhNegative,
            'cs:' + previousCaesarean, 'dm:' + diabetes, 'ht:' + hypertension].join('|')
```

- GDM, gestational hypertension and twins found **in this pregnancy** are not structured fields, so they are not detected. The screen says so. (Changed on 4 Oct 2026 – see Next in `docs/PROGRESS.md`: a doctor or RMO ticks the findings on the record; they are plan facts, part of the plan's basis key, and the plan engine version is 2.)
- `why` codes (the client maps them to words):
  - Unknown facts: `risk_incomplete`, `risk_may_be_higher`, `rh_unknown`, `caesareans_unknown`, `conditions_unconfirmed`.
  - Rule is 'no': `only_high_risk`, `only_rh_negative`, `only_previous_caesarean`, `only_diabetes`, `only_hypertension`.
  - Timing: `anchor_waiting`, `anchor_not_needed`, `anchor_missing`, `timing_loop`.
  - Other: `no_longer_indicated`, `not_in_template`.

### 5.2 Applicability

- `ruleFor(appliesWhen, facts)`: `always` → `yes`; otherwise the matching fact (`yes`/`no`/`unknown`).
- Unknown `why`:
  - `high_risk` → `risk_may_be_higher` if `r.mayBeHigher`, else `risk_incomplete`
  - `rh_negative` → `rh_unknown`
  - `previous_caesarean` → `caesareans_unknown`
  - `diabetes`/`hypertension` → `conditions_unconfirmed`
- **After-items:** the rule is the weaker of the item's own rule and the anchor's *effective* applicability (`no < unknown < yes`).
  - Anchor effective = `yes` if the anchor has `forceInclude` or `manualDate`; otherwise the anchor's own result.
  - `riskBased = appliesWhen === 'high_risk' || anchor.riskBased`.
- `forced = Boolean(manualDate || forceInclude)`.
- `noLongerIndicated = forced && rule === 'no' && staffBasis?.applies !== 'no'`. The rule turned to 'no' **after** the person's action; including an item that was already 'no' is not flagged.

### 5.3 Timing (per item; `E = plan.basis.edd`, `B = plan.bookedOn`, `S = max(B, addedOn ?? B)`)

Items are worked out in dependency order, memoised, with a visiting set. A cycle gives `anchor.state = 'loop'` for the items in it.

1. `timing.atBooking` → window = due = `[B, B+13]`, `dateSource 'booking'`.
2. `fromWeek/toWeek` → window = due = `[weekStart(E, from), weekEnd(E, to)]`, `dateSource 'window'`.
3. `after {key, weeks}`: the anchor is the template-origin item with that key (including kept not-in-template items).
   - Missing → `anchor {state: 'missing'}`, no dates.
   - Loop → `anchor {state: 'loop'}`.
   - Anchor `done` → window = due = `[done.on + 7·weeks, +13]`, `dateSource 'after_done'`.
   - Anchor `not_needed` → `anchor {state: 'not_needed'}`.
   - Anchor effective applicability `no` → the item inherits 'does not apply' (why = the anchor's why).
     Exception: an after-item a person included (`forceInclude`) or moved (`manualDate`) itself still gets `anchor {state: 'waiting'}`, so a forced item waits for its anchor (it shows Waiting with an estimate) instead of being open with no dates.
   - Otherwise → `anchor {state: 'waiting'}`. There are no stored dates; the estimate is worked out on read (§5.7).
4. Custom fixed date → due = `[timing.date, timing.dateBy ?? date + 6]`, `dateSource 'fixed'`. No guideline window.
5. **Late start.** Only for rules 1–3, and only while there is no `manualDate`. `lateFrom = addedOn > B ? 'added' : 'booking'`.
   - **Covered by the booking visit:** `kind === 'visit' && !atBooking && addedOn == null && windowFrom ≤ B ≤ windowTo` → `lateStart 'covered'`.
   - **Window already over:** else if `windowTo < S` → `lateStart = LATE_START[kind]`.
     - `catch_up` → due = `[S, S+13]`, `dateSource 'catch_up'`.
     - `lapsed` / `decide` → the dates are kept for display.
   - A window still open at `S` (for example the anomaly scan when booked at 19 w) is simply due.
6. **Effective dates** = `manualDate` if set (`dateSource 'manual'`), otherwise the above.
7. **Flags.** `timingKey(it)` = `'b'` | `'w<from>-<to>'` | `'a<key>+<weeks>'` | `'d'`.
   - `check_date`: `manualDate` and (`staffBasis.edd ≠ E`, or `staffBasis.timingKey ≠ timingKey(it)`, or (atBooking and `staffBasis.bookedOn ≠ B`)).
   - `outside_window`: `manualDate` and a window exists and `manualDate` is not inside `[windowFrom, windowTo]`.
   - `no_longer_indicated`: see §5.2.

### 5.4 Phase (stored; first match wins)

| # | Condition | phase | why |
|---|---|---|---|
| 1 | state `done` / `not_needed` | `done` / `not_needed` | (done + rule no → marker 'No longer applies') |
| 2 | `plan.status !== 'active'` | `inactive` | – |
| 3 | `forced && noLongerIndicated` | `check` | `no_longer_indicated` |
| 4 | `!forced && rule === 'no'` | `not_applicable` | `only_…` |
| 5 | `!forced && rule === 'unknown'` | `check` | unknown why |
| 6 | `notInTemplate && !manualDate` | `decide` | `not_in_template` |
| 7 | `!manualDate && anchor waiting` | `waiting` | `anchor_waiting` |
| 8 | `!manualDate && anchor not_needed/missing/loop` | `check` | `anchor_…` / `timing_loop` |
| 9 | `!manualDate && lateStart in (lapsed, covered)` | `lapsed` | – |
| 10 | `!manualDate && lateStart === 'decide'` | `decide` | – |
| 11 | `plan.eddReview` set | `on_hold` | – |
| 12 | otherwise | `open` | – |

`listable = phase === 'open' && REMINDER_KINDS.includes(kind) && plan.status === 'active'`. Feature 10 also applies the missed rule and the post-dates rule.

### 5.5 `derivePlan(plan, facts, { at, actorName, changedIds = new Set(), newIds = new Set() })`: pure, deterministic, idempotent

- Writes `auto.*` for every item and sets `basis.syncedAt = at` (only when something else changed).
- **Rev rule.** Watched fields: `applies`, `phase`, `windowFrom`, `windowTo`, `dueFrom`, `dueBy`, `flags`. If any of them changed on an item that already existed, and the item is not in `changedIds`, then `rev += 1`, `revByName = actorName` ('Automatic' in sync), `revAt = at`. "Already existed" is explicit: every item except those in `newIds` (items the caller has just created), which keep rev 0 and are not counted for the plan log. Callers pass `newIds`: `createPlan` (all items), `mergeTemplate` (the added items), `POST /items` (the new custom item).
- `listable` also needs a due date (`dueFrom`).
- Never touches staff fields.
- Returns `{ nowApply: [itemIds], noLongerApply: [itemIds], retimed: n, checkDate: n }`. These are open items whose `auto.applies` or dates changed, used for the plan log.

### 5.6 `timingKey`, `staffBasis`

Whenever `move`, `include` or `keep` is saved, `staffBasis = { edd: E, bookedOn: B, timingKey: timingKey(it), applies: rule (before forcing), at }`.

### 5.7 Status shown (computed on read; `T = hospitalToday(req.now)`)

```
phase open:
  T > dueBy  → (kind === 'visit' && laterVisitStarted(it, T)) ? 'missed' : 'overdue'
  T >= dueFrom → 'due'   else 'upcoming'
laterVisitStarted(it, T) = items.some(v => v !== it && v.kind === 'visit' && v.state !== 'not_needed'
      && ['open', 'done'].includes(v.auto.phase) && v.auto.dueFrom > it.auto.dueFrom && (v.auto.dueFrom <= T || v.state === 'done'))
phase waiting → 'waiting', estimateFrom = addDays(max(anchor effective dueFrom ?? T, T), 7·weeks)   (null if the anchor itself has no dates)
check → 'check_needed' · decide → 'decide' · lapsed → 'lapsed' · on_hold · not_applicable · done · not_needed
inactive → 'inactive' ('Paused' or 'Not done (plan closed)')
```

| status | StatusPill tone / icon / word |
|---|---|
| `overdue` | `high` / CalendarX2 / 'Overdue' |
| `due` | `due` / CalendarDays / 'Due now' |
| `upcoming` | `neutral` / CalendarClock / 'Upcoming' (dates in Deep Teal) |
| `missed` | `inactive` / CalendarMinus2 / 'Missed' ('later visit started') |
| `waiting` | `neutral` / Hourglass / 'Waiting' + '4 w after Td – dose 1 · about 12 Nov 2026' |
| `check_needed` | `watch` / CircleHelp / 'Check needed' + why ('Blood group not recorded') |
| `decide` | `watch` / History / 'Decide' + 'Window 11–13 w ended before booking at 20 w 0 d' (or '…before this item was added (34 w 2 d)') |
| `on_hold` | `inactive` / CirclePause / 'On hold – EDD to confirm' |
| `lapsed` | `inactive` / CalendarOff / 'Before booking' · 'Covered by the booking visit (17 Sep 2026)' · 'Passed before it was added' |
| `done` | `stable` / Check / per kind: 'Attended' (visit), 'Done' (lab test, scan), 'Given' (vaccination, advice), 'Started' (medicine) + '12 Oct 2026 (19 w 2 d)' + 'elsewhere' |
| `not_needed` | `inactive` / Ban / 'Not needed' + reason |
| `not_applicable` | `inactive` / CircleMinus / 'Does not apply' + reason ('Only for Rh-negative mothers – blood group B+') |
| `inactive` | `inactive` / CirclePause 'Paused' or X 'Not done (plan closed)' |

- `dueBy` is inclusive: an item becomes Overdue the day after `dueBy`.
- Overdue stays until a decision is recorded, except for visits, which become Missed once a later visit has started.
- **Markers** (neutral pills with an icon):
  - 'Moved by Dr X' (UserPen)
  - 'Included by Dr X'
  - 'Added by Dr X'
  - 'No longer in the template'
  - 'No longer applies'
  - 'Based on draft risk rules'
  - In the watch tone: 'Check date' and 'Outside guideline window'
- The server sends `today` and every item's `status`; the browser never works statuses out itself.

### 5.8 Next-visit suggestion (`nextVisitSuggestion(plan, T)`, exported for Feature 8)

- `visits` = open-phase visits with status `overdue`, `due` or `upcoming`, sorted by `dueFrom`.
- `visit` = the first overdue or due visit, otherwise the first upcoming one, otherwise null.
- `alsoDue` = open non-visit items with status overdue or due, or upcoming with `dueFrom ≤ visit.dueBy`.
- `missedVisits` = the count of items with status `missed`.

### 5.9 `mergeTemplate(plan, template, { at, actor, facts })`: pure; the preview and the apply use the same function

```
T = Map(template.items by key); out = []; rep = { added: [], changed: [], kept: [], dropped: [], unchanged: 0, customKept: 0 }
for it of plan.items:
  if it.origin === 'custom': out.push(it); rep.customKept++; continue
  t = T.get(it.key)
  if t && t.kind === it.kind:                       // same meaning → update the content, keep all staff data
     fields = diffContent(it, t)                    // name, patientText, source, appliesWhen, timing.*
     if fields.length: copyContent(it, t); it.rev++ (revByName = actor.name, revAt = at);
        it.history.push({ at, by: actor.id, byName: actor.name, action: 'template_changed', to: { fields } });
        rep.changed.push({ itemId, name, fields, keepsDoctorDate: !!it.manualDate })
     else rep.unchanged++
     if it.notInTemplate: it.notInTemplate = null; it.rev++
     T.delete(it.key); out.push(it)
  else if touched(it):
     if !it.notInTemplate: it.notInTemplate = { since: at, templateName: template.name, version: template.version }; it.rev++;
        it.history.push({ at, by, byName, action: 'kept_not_in_template' })
     rep.kept.push({ itemId, name, why: stateWord(it) }); out.push(it)
  else rep.dropped.push({ itemId, name })          // generated and untouched: nothing a person did is lost
for t of template.items in order, if T.has(t.key): out.push(newItem(t, { addedOn: hospitalToday(at) })); rep.added.push(...)
plan.items = out
plan.source = { templateId, templateName, templateKind, ownerName, version, itemsHash: itemsHash(template.items), chosenBy: actor }
derivePlan(plan, facts, { at, actorName: actor.name, changedIds: raised items, newIds: added items })
rep.needsDecision = added items whose phase is decide or lapsed
rep.possibleDuplicates = added items with the same kind as an existing (kept, done or open) item AND
                         (overlapping [windowFrom, windowTo] OR equal normalised name)   // lower case, no brackets/punctuation
return rep
```

`touched(it) = it.state !== 'open' || it.manualDate || it.forceInclude || it.note || it.history.some(h => !['template_changed', 'kept_not_in_template'].includes(h.action))`

A 'template_changed' entry does not make an item 'touched', so a later update can still drop it if a person never touched it.

---

## 6. Lifecycle (`server/src/careplans/plansService.js`)

### 6.1 `loadPatientForPlan(req)` (`utils/patientLookup.js`)

- `findPatient(req)` (id **and** tenant).
- Then, if antenatal and `riskIsStale(patient, std)`: `updateRisk` + save. On `VersionError`, reload once.
- Used by GET `/patients/:id`, GET `/care-plan` and every plan change, replacing the inline code in GET `/:id`.

### 6.2 Creation (`createPlan`)

**Condition**, all of:
- `careType === 'antenatal'`.
- `effectiveEdd` is set.
- There is no current plan.
- `!closedPlanForPregnancy(edd)`. That is: no closed plan of this patient with `|basis.edd − edd| ≤ 56 d`, or (`closed.reason !== 'new_pregnancy'` and `eddReview` and `|eddReview.toEdd − edd| ≤ 56 d`).

**Steps**
1. Template = the hospital standard antenatal template, even while it is a draft.
2. One item per template item (`state 'open'`, `rev 0`, `addedOn null`).
3. Plan fields:
   - `bookedOn = hospitalToday(req.now)` (the day the dates are entered, normally the booking visit). `seed-demo` passes an explicit `bookedOn`.
   - `createdBy.byName = 'Automatic'`.
   - Log `{action: 'created', auto: true, text: 'Plan built from “{name}” version {v}'}`.
4. `derivePlan` with `newIds` = every item id, then `save()`. A duplicate-key error (11000) from a race → retry the sync loop, which will find the plan.
5. **Audit** `CARE_PLAN_CREATED {patientId, mrn, planId}` **only for a patient's first plan**, with the requesting user as actor. A replacement plan is not audited on its own (see §9).

**Called from:**
- `POST /patients`, after its save and audit.
- `PATCH /patients/:id`.
- GET `/patients/:id` (only viewers with `view.has('pregnancy')`).
- GET `/care-plan`.

### 6.3 Sync (`syncPlan(ctx, patientId)` and `syncPlanSafely`)

**Triggers**
- After `POST /patients`.
- After every successful `PATCH /patients/:id` save when the patient is antenatal, was antenatal before the save, or has a current plan. This includes `ageYears`, which can change risk.
- After `PUT` / `DELETE /risk-override`.
- Inside GET `/patients/:id` (clinical viewers) and GET `/care-plan`.
- At the start of every plan change.
- The doctor and sensitive-flag routes don't change plan facts, so they need no call.

```
async function syncPlan({ tenantId, now, actorName = 'Automatic' }, patientId):
  for attempt in 1..3:
    patient = await Patient.findOne({ _id: patientId, tenantId })       // fresh; read BEFORE the plan
    plan = await CarePlan.findOne({ tenantId, patientId, careType: 'antenatal', current: true })
    if plan && plan.basis.patientVersion > patient.__v: return { plan, patient }   // a newer sync already ran
    facts = planFacts(patient)
    if !plan:
      if !canCreate(patient, facts) || await closedPlanForPregnancy(...): return { plan: null, patient }
      try { plan = await createPlan(...); return } catch 11000 → continue
    before = snapshot(plan)
    if patient.careType !== 'antenatal':  pause('care_type_changed')        // active → paused; log auto
    else if !facts.edd:                   pause('no_edd')
    else:
      if plan.status === 'paused':
        if within56(facts.edd, plan.basis.edd) || (plan.eddReview && within56(facts.edd, plan.eddReview.toEdd)):
          plan.status = 'active'; plan.pausedReason = null; log auto 'resumed'
        else:
          close(plan, 'new_pregnancy', { auto: true, byName: 'Automatic' }); save (VersionError → continue)
          await createPlan(patient, { replacesPlanId: plan._id })          // not audited separately
          return
      Δ = |facts.edd − plan.basis.edd|
      if Δ === 0:                          if plan.eddReview: plan.eddReview = null; log auto 'edd_review_cleared'
      else if plan.eddReview && sameDay(facts.edd, plan.eddReview.toEdd): (still on hold – nothing)
      else if Δ ≤ 56 d:                    plan.basis.edd = facts.edd; plan.basis.eddSource = facts.eddSource; plan.eddReview = null
                                           log auto 'edd_redated' ('Due dates moved: EDD changed from 3 Mar 2027 to 24 Feb 2027 (scan EDD). 2 moved items need a date check.')
      else:                                plan.eddReview = { fromEdd: plan.basis.edd, toEdd: facts.edd, detectedAt: now }; log auto 'edd_review'
    plan.basis.key = facts.basisKey; plan.basis.patientVersion = patient.__v; plan.basis.engineVersion = PLAN_ENGINE_VERSION
    res = derivePlan(plan, facts, { at: now, actorName })
    if res.nowApply.length: log auto 'items_apply' ('3 items now apply: Indirect Coombs test, …')
    if res.noLongerApply.length: log auto 'items_no_longer_apply'
    trimAutoLog(plan)                                                        // keep the newest 100 automatic entries
    if !changed(before, plan): return { plan, patient }                      // same facts, same version → no write
    try { await plan.save(); return { plan, patient } } catch VersionError → continue
  throw new SyncConflict()
```

- **`syncPlanSafely`** catches and logs any error, so a patient save and its response never fail because of the plan.
- A mismatched basis key or version heals the plan on the next read. If a GET cannot save, it answers with a view derived in memory from the latest plan.
- **Not audited:** sync, pause, resume, re-dating, EDD hold, automatic close and the automatic replacement plan. The triggering `PATIENT_CREATED`, `PATIENT_UPDATED` or `RISK_OVERRIDDEN` entry is audited, following the Feature 6 rule. The details go into the plan `log`, which only clinical viewers can see.

### 6.4 Template switch or update (doctor or RMO)

- **Options** (same hospital, `careType 'antenatal'`, at least 1 item, drafts allowed with a warning):
  1. The patient's **assigned doctor's** personal protocols.
  2. The hospital **standard** template.
  3. The **acting doctor's** own protocols.
  - An RMO gets 1 and 2.
- **Preview:** `mergeTemplate` on an in-memory copy (`CarePlan.hydrate(plan.toObject())`). Not audited.
- **Apply:**
  - Allowed only if `fromItemsHash === plan.source.itemsHash` and `toItemsHash === itemsHash(template.items)`; otherwise 409 'The template or the plan changed since you reviewed the changes. Please review them again.'
  - Same template and same hash → 200 `changed:false`.
  - Afterwards: log (person), `source.chosenBy`, audit `plan_changed`.
- Protocols copied with 'Copy as my protocol' keep the keys, so done and moved items carry across.

### 6.5 EDD decision, close, reopen

**EDD decision** (only while `eddReview` is set; `toEdd` must equal `eddReview.toEdd`, else 409)
- `same_pregnancy` → `basis.edd = toEdd`, `eddSource` from the patient, `eddReview = null`. Moved items then get 'Check date'. Log.
- `new_pregnancy`:
  1. Close this plan (`reason 'new_pregnancy'`, by the user); `eddReview` stays on the closed plan.
  2. Save.
  3. Create a new plan from the standard template (`replacesPlanId`, `bookedOn = today`).
  4. One audit entry, `plan_changed`, with the old `planId`.

**Close** (active or paused plan; reason from `USER_CLOSE_REASONS`; note ≤ 500, required for `other`)
- `current: false`, `status: 'closed'`, `closed{…}`, log.
- The plan becomes read-only and leaves all lists. No automatic re-creation for this pregnancy (§6.2).

**Reopen** (`planId` of a closed plan of **this patient**)
- 409 'This patient already has a current care plan.' if one exists.
- Otherwise `current: true`, `status: 'active'`, `closed: null` (the old close record stays in the log text), log, then sync. The plan may pause, or go on hold for a far EDD.

**Undoing a mistaken 'New pregnancy'**
- Close the new plan (reason Other, 'Chosen by mistake'), then Reopen the old plan.
- Sync puts the old plan on hold again (EDD jump), and the doctor then chooses 'Same pregnancy'. Tested.

### 6.6 Plan log

- Entries: `{ at, by|null, byName, action, text, auto }`.
- Actions:
  - `created`, `template_switched`, `template_updated`, `booking_date`
  - `edd_redated`*, `edd_review`*, `edd_review_cleared`*, `edd_same_pregnancy`, `edd_new_pregnancy`
  - `paused`*, `resumed`*, `closed`, `reopened`
  - `items_apply`*, `items_no_longer_apply`*, `replaced`*
  - (* = automatic)
- Automatic entries are trimmed to the newest 100; **entries made by people are never trimmed**.
- Item `history` holds only entries made by people (plus the merge's `template_changed`/`kept_not_in_template`) and is never capped. A server warning is logged above 1,000 entries per item, which is unrealistic.

---

## 7. Doctor and RMO adjustments

### 7.1 The loop for every change (`applyItemAction(ctx, patientId, itemId, intent)`; Feature 8 reuses it)

0. The body is validated by a strict zod schema first → 400.
1. `loadPatientForPlan`, then `syncPlan`. Access check: `editClinical`, else 403 (§8).
2. Find the current plan.
   - None, and the latest plan is closed → 409 `PLAN_CLOSED` 'This care plan is closed. Reopen it to make changes.'
   - No plan at all → 404 'This patient has no care plan.'
   - Item not in the current plan → 404 'Item not found.'
3. **Identical repeat** → **200 `{changed:false}`**, with no rev check, no write and no audit. 'Identical' means:
   - done: same `on`, `elsewhere`, `result`, `note`
   - reopen: already open
   - not_needed: same code and reason
   - move: same dates and reason
   - reset_date: no manualDate
   - include: same reason
   - remove_include: none set
   - keep: no flags
   - note: same text
4. **Rev check.** `body.rev !== item.rev` → 409 `CONFLICT`:
   - '{revByName} changed this item at {HH:mm}. The latest plan is shown – check it and try again.'
   - If `revByName` is 'Automatic': 'This item was updated automatically at {HH:mm} (the patient's details changed). The latest plan is shown – check it and try again.'
   - The time is formatted in HOSPITAL_TIME_ZONE.
5. **State precondition** (table below) → 409 with a plain message, e.g. 'This item is already marked done.'
6. **Checks that need the plan** (dates against the window, EDD, etc.) → 400 with `fields`.
7. **Apply:**
   - `rev += 1`, `revByName = person`, `revAt = now`.
   - History entry `{at, by, byName, action, from, to, reason}`.
   - `staffBasis` refreshed for move, include and keep.
8. `derivePlan(plan, facts, { at, actorName: person, changedIds: [itemId] })`; save.
9. On `VersionError`: reload and **re-apply the intent from step 1** (up to 3 attempts). Two people changing different items both succeed.
10. Audit `CARE_PLAN_CHANGED`.
11. Respond `{ plan, summary, changed: true }`.

**Paused plan:** item actions are allowed (for example a late result after delivery). **Closed plan:** read-only.

### 7.2 Item actions (`PATCH /items/:itemId`, body = one of these; every body has `rev`)

| action | Body | Allowed when | Validation (exact messages) | Effect |
|---|---|---|---|---|
| `done` | `on` (YYYY-MM-DD), `elsewhere?`, `result?` ≤500, `note?` ≤1000 | state open or not_needed | `on ≤ today` ('The date can't be in the future.'); `on ≥ day 0 − 365 d` ('This date is more than a year before this pregnancy – please check it.'); `result` only for investigation/scan ('Results are recorded for lab tests and scans only.'); PCPNDT | `state 'done'`, `done{…, via:'manual'}`; a previous notNeeded moves to history; dependent after-items re-dated |
| `reopen` | `reason?` ≤300 | done or not_needed | – | `state 'open'`; old record kept in history |
| `not_needed` | `reasonCode`, `reason` | open | `reason` 5..300 required for `not_indicated`/`other` ('Please say why (at least 5 characters).'); PCPNDT | `state 'not_needed'` |
| `move` | `dueFrom`, `dueBy?` (default dueFrom + 6), `reason?` | open | `dueFrom ≥ day 0`; `dueBy ≥ dueFrom` ('\'Due by\' must be on or after \'Due from\'.'); `dueBy ≥ today` ('Choose a date from today onwards.'); `dueBy ≤ EDD + 21 d` ('Choose a date before 43 weeks.'); span ≤ 84 d; outside the guideline window → `reason` 5..300 ('This date is outside the guideline window (18 w 0 d – 20 w 6 d). Please give a reason.'); PCPNDT | `manualDate`, `staffBasis`. This is also 'Plan now' for Decide, Before booking, Missed, Waiting and anchor-Check items |
| `reset_date` | – | manualDate set | – | manualDate cleared (history keeps the old one) |
| `include` | `reason` 5..300 (quick picks: 'GDM in this pregnancy', 'High BP in this pregnancy', 'Doctor's decision') | open, `auto.applies ≠ 'yes'`, no forceInclude | PCPNDT | `forceInclude`, `staffBasis` |
| `remove_include` | – | forceInclude set | – | cleared |
| `keep` | – | flag `check_date` or `no_longer_indicated` | – | `staffBasis` = current facts (clears the flags); history 'Kept as planned' |
| `note` | `text` 0..1000 (empty removes it) | any state | PCPNDT | `note` |

- **Undo** (client): after Mark done, the flash reads '{name} marked done (14 Sep 2026). [Undo]'. It is shown **only when the item was open before**, and sends `{action:'reopen', rev, reason:'Undo'}`.
- **Warning, not a block** (client, from `dependsOn`): 'Td – dose 1 was given on 15 Oct 2026; dose 2 is usually 4 w later (from 12 Nov 2026).' or 'Td – dose 1 is not marked done yet.'

### 7.3 Plan-level actions (active plan only; paused → 409 `PLAN_PAUSED` 'This care plan is paused (the type of care is not antenatal). Only items can be updated, or the plan closed.')

**Add custom item** — `POST /items`
- Body: `{clientRequestId (uuid), kind, name 1..200, patientText? ≤300, note? ≤1000, reason? ≤300, timing}`.
  - `timing` = `{type:'weeks', fromWeek 0..44, toWeek ≥ fromWeek}` with `weekEnd(E, toWeek)` between today and EDD + 21 d ('The window must end between today and 43 weeks.').
  - Or `timing` = `{type:'date', dueFrom, dueBy?}` with the same rules as Move (no window reason).
- `appliesWhen 'always'`, `addedOn = today`, `added{…}`, key `'custom_' + randomBytes(4).hex`. Derive with the new item in `newIds`.
- Limits: 100 custom, 400 total → 400 with a clear message.
- The same `clientRequestId` → 200 with the existing item.
- PCPNDT check on all text.

**Booking date** — `PATCH /`
- Body: `{bookedOn, previousBookedOn}`. `previousBookedOn ≠ plan.bookedOn` → 409; the same value → `changed:false`.
- Rule: `day 0 + 28 ≤ bookedOn ≤ today` ('The booking date must be between 4 w 0 d (22 Jun 2026) and today.').
- Effects: `bookedOn`, `bookedOnSetBy`, log, derive. At-booking items with moved dates get 'Check date'.

**Protocol** — `GET /template-options`, `GET /template-preview`, `PUT /template` (§6.4).

**EDD decision** — `POST /edd-decision` with `{decision, toEdd}` (§6.5).

**Close / reopen** — `POST /close`, `POST /reopen` (close is also allowed on a paused plan) (§6.5).

Nothing is ever marked done or not needed automatically. Feature 8 sets `done.via = 'visit'` and `visitId`.

---

## 8. Access (server-enforced)

**How it is wired**
- The plan router is mounted inside `patientsRouter`, after its `PATIENT_ROLES` gate, with `mergeParams: true`.
- `findPatient` looks up by id **and** tenant.
- Every plan lookup adds `patientId: patient._id`. Access is always decided from the patient in the URL.
- `view = patientAccess(req, patient).view.has('pregnancy')`; `edit = patientAccess(req, patient).editClinical`.

| Role | See the plan (GET, card) | Change the plan |
|---|---|---|
| RMO | all patients, including sensitive records | yes (template options: standard + the assigned doctor's protocols) |
| Doctor – own or unassigned patient | yes | yes (standard + own + the assigned doctor's protocols) |
| Doctor – another doctor's patient | read-only; sensitive record → 403 | 403 'This is another doctor's patient: you can view the care plan but not change it.' |
| Nurse | read-only, including item notes and results; sensitive record → 403 | 403 'Only the patient's doctor or an RMO can change the care plan.' |
| Receptionist, Lab | 403 'Your role doesn't include care plans.' (Feature 10 adds a separate list with generic categories) | no |
| Hospital admin only / super admin | blocked by the existing gate | no |

- **Sensitive record:** 403 'This is a sensitive record: care plans are only visible to the treating doctor and RMOs.'
  - Infertility patients registered as infertility keep `sensitive: true` when their type of care changes to antenatal, so nurses get 403 on these plans. This is today's behaviour; it is an open question.
- **Another hospital:** another hospital's patient → 404. Another patient's `planId` or `itemId`, or another hospital's template → 404.
- `carePlanSummary` is a clinical field, so `projectPatient` strips it for reception and lab.
- Reception can change the type of care: the plan pauses, and the response still contains no medical details.

---

## 9. Audit (ids only; nothing medical)

| Action | details (exactly these keys) |
|---|---|
| `CARE_PLAN_CREATED` | `patientId, mrn, planId`. Only a patient's first plan. |
| `CARE_PLAN_VIEWED` | `patientId, mrn, planId` (null if none), `access`. On GET `/care-plan`, also with `?planId`; the Overview card is covered by `PATIENT_VIEWED`. |
| `CARE_PLAN_CHANGED` | `patientId, mrn, planId, change, itemId?` |

**`change` words**
- Items: `item_done`, `item_reopened`, `item_not_needed`, `item_moved`, `item_date_reset`, `item_included`, `item_include_removed`, `item_kept`, `item_note`, `item_added`.
- Plan: **`plan_changed`** only (booking date, template switch or update, EDD decision same or new, close, reopen), so the audit log never reveals a pregnancy outcome.

**Never logged**
- The item key, name or kind (`anti_d` or `lab_hiv` would reveal Rh status or HIV testing).
- The template id or name (template audit entries carry names such as 'GDM protocol').
- `replacesPlanId`, dates, EDD, reasons, results, notes, the close reason, risk.
- Automatic re-dating, pause, resume, hold, automatic close and the automatic replacement are not audited. An identical repeat writes no entry.

**Client `auditFormat.js`**
- Labels: 'Care plan created', 'Care plan viewed', 'Care plan changed'.
- Plain words for `change`: 'item marked done', 'item marked not needed', 'item date moved', 'item added', 'plan updated', ….
- FileText icon, neutral tone.

---

## 10. API (under `/api/patients/:id/care-plan`)

**Conventions**
- Zod schemas are `.strict()`, so unknown keys such as `fetalSex` → 400.
- Request dates are `YYYY-MM-DD` (`dateOnly`); response dates are ISO strings at UTC midnight.
- Errors use the existing shape `{error: {message, code, fields}}`: 400 `VALIDATION`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT` / `PLAN_CLOSED` / `PLAN_PAUSED`.
- The client handles every 409 the same way: close the dialog, show the message in a warning Alert, reload the plan. `ApiError` keeps only `message`, `code` and `fields`.

### 10.1 Endpoints

| Method and path | Who | Request | Response / notes |
|---|---|---|---|
| `GET /` | view | `?planId=` (optional; this patient's earlier plan, read-only, no sync) | `{plan: PlanView \| null, reason: null \| 'not_antenatal' \| 'no_dates', earlierPlans: [{id, status, edd, closedAt, closedReason, templateName}]}`. `plan` = the current plan (active or paused); otherwise null. Runs `loadPatientForPlan` + sync; audits VIEWED. |
| `PATCH /items/:itemId` | edit | §7.2 action union | `{plan, summary, changed}` |
| `POST /items` | edit | custom item (§7.3) | 201 `{plan, summary, itemId}`; 200 on the same `clientRequestId` |
| `PATCH /` | edit | `{bookedOn, previousBookedOn}` | `{plan, summary, changed}` |
| `GET /template-options` | edit | – | `{templates: [{id, name, kind, ownerName, version, contentApproved, itemCount, inUse}]}`, in the order assigned doctor's, standard, own |
| `GET /template-preview` | edit | `?templateId=` | `{from: {name, version, itemsHash}, to: {id, name, version, contentApproved, itemsHash}, added: [{key, name, kind, timingText}], needsDecision: [{key, name}], possibleDuplicates: [{key, name, withItemId, withName}], changed: [{itemId, name, fields, keepsDoctorDate}], kept: [{itemId, name, why}], dropped: [{itemId, name}], unchanged, customKept}`. Not audited. 403 for another doctor's protocol ('You can use the hospital standard, your own protocols or the assigned doctor's protocols.'); 400 when it has no items ('This protocol has no items.'); 404 for another hospital. |
| `PUT /template` | edit | `{templateId, fromItemsHash, toItemsHash}` | `{plan, summary, changed}` / 409 |
| `POST /edd-decision` | edit | `{decision: 'same_pregnancy' \| 'new_pregnancy', toEdd}` | `{plan, summary, changed}` (`plan` is the new plan after `new_pregnancy`) |
| `POST /close` | edit | `{reason, note?}` | `{plan: null, summary, changed}` |
| `POST /reopen` | edit | `{planId}` | `{plan, summary, changed}` / 409 / 404 |

### 10.2 PlanView (`planView(plan, { today, patient, srcT, stdT, access, viewingEarlier })`, whitelisted)

```
{ id, status, pausedReason, pausedAt, closed: {reason, note, auto, byName, at} | null, replacesPlanId,
  today, gestationToday: {weeks, days}, edd, eddSource, dayZero, postDates,
  bookedOn, bookedAt: {weeks, days}, bookedOnSetByName, minBookedOn,
  eddReview: {fromEdd, toEdd} | null,
  template: { id, name, kind, ownerName, version, approved, approvedVersion, approvedByName, approvedAt,
              label, draftReason, currentVersion, updateAvailable, updateApproved, newerApprovedVersion,
              newerApprovedByName, newerApprovedAt },       // who approved the newer version, and when (or null)
  counts: { overdue, due, upcoming, missed, waiting, checkNeeded, decide, onHold, lapsed, done, notNeeded, notApplicable, total },
  missingFacts: ['Blood group', 'Risk level (Incomplete)', 'Previous caesareans', 'Pre-existing conditions'],   // only facts the plan's items need
  recentChanges: [{ at, action, text }],               // automatic log entries from the last 14 days, newest first, max 5
  next: { visit: {itemId, name, dueFrom, dueBy, status} | null, alsoDue: [{itemId, kind, name, status}], missedVisits },
  items: [{ id, rev, key, origin, kind, name, patientText, source, appliesWhen, timing, timingText,
            window: {from, to}, gaWindow: {from, to}, due: {from, to}, estimateFrom, dateSource,
            status, applies, why, riskBased, lateStart, lateFrom, flags, anchor,
            dependsOn: {id, name, state, doneOn, weeks} | null, addedOn,
            done: {on, gaOn, elsewhere, result, note, via, byName, at} | null,
            notNeeded: {reasonCode, reason, byName, at} | null, manualDate: {dueFrom, dueBy, reason, byName, at} | null,
            forceInclude: {reason, byName, at} | null, note: {text, byName, at} | null, added: {byName, at, reason} | null,
            notInTemplate: {templateName, version} | null, history: [last 20: {at, byName, action, from, to, reason}] }],
  log: [last 50, newest first: {at, byName, action, text, auto}],
  canEdit,          // editClinical && !closed && !viewingEarlier  (item actions)
  canChangePlan,    // canEdit && status === 'active'
  canClose,         // editClinical && status in (active, paused) && !viewingEarlier
  canReopen,        // editClinical && status === 'closed' && no current plan
  readOnly }        // !canEdit
```

- Staff ids (`by`), `basis` and `revByName` are never sent.
- `timingText` uses `templateFormat.timingText` wording, extended for fixed dates.

### 10.3 `carePlanSummary` on `GET /api/patients/:id` (clinical viewers only; worked out on read)

```
{ exists, planId, status, pausedReason, pausedAt, eddReview: bool, eddChange: {fromEdd, toEdd} | null,
  postDates: bool, earlierCount, lastClosed: {at, reason} | null,   // lastClosed: newest closed plan, only when there is no current plan
  template: { label, draftReason, approved, approvedVersion, newerApprovedVersion },
  counts: { overdue, due, needsDecision, missedVisits, done, total },
  next: { visit: {itemId, name, dueFrom, dueBy, status} | null, alsoDue: [{itemId, kind, name, status}] },
  top: [≤4 {itemId, kind, name, status, dueBy}],          // overdue first, then due now
  reason: null | 'not_antenatal' | 'no_dates' }
```

- Every plan change returns this `summary`.
- Features 8 and 10 **must show `template.label`** wherever they show plan content.

---

## 11. UI

**Brand rules for this feature**
- Tokens only.
- Status = colour + icon + word.
- One primary button per screen.
- Dates as '12 Oct 2026'; gestation as '28 w 3 d'.
- Teal marks scheduled items.
- No exclamation marks or emoji.
- Checked at 1366 × 768, tablet and phone.

### 11.1 Where it lives

**Tabs and routes**
- Patient tabs become **Overview | Care plan | Edit details**.
- Route `patients/:id/care-plan` → `PatientCarePlanTab` (`App.jsx`).
- The tab shows when `access.canViewCarePlan && (careType === 'antenatal' || carePlanSummary?.exists || carePlanSummary?.earlierCount > 0)`.
- The browser tab title stays 'Patient record'.
- The header's **Edit details** stays the one primary button. On the plan tab everything is secondary, positive or a link. Each dialog has its own primary button (as EmergencyNoteDialog does today).

**Summary state in `PatientDetailPage`**
- `const [localSummary, setLocalSummary] = useState(null); useEffect(() => setLocalSummary(null), [patient]);`
- The page shows `localSummary ?? patient.carePlanSummary`.
- `onPlanChanged(summary)` is passed through the outlet context, so the Overview card stays current without re-fetching the record (no extra `PATIENT_VIEWED`).

**New and changed files**
- New client files:
  - `pages/patients/CarePlanTab.jsx`, `CarePlanCard.jsx`, `carePlanDialogs.jsx`
  - `carePlanFormat.js` (+ `carePlanFormat.test.js`)
  - `client/src/pcpndtWords.js`
- Styles go in `styles/pages-careplans.css`: `.plan-summary`, `.plan-next` (`color: var(--teal-700)`), `.plan-today-row` (`border-top: 2px solid var(--teal-500)`, label in `--teal-700`), `.plan-group-row`.
- The view switch reuses the existing `.segmented`.
- The **Today divider row** is the one new pattern. Add it to `docs/BRAND.md` (and the design system) before building it.
- `templateFormat.js`:
  - `timingText()` handles `timing.date` ('12–26 Oct 2026').
  - `APPLIES_LABELS.diabetes = 'Pre-existing diabetes only'`, `hypertension = 'Chronic high blood pressure only'`.
  - TemplateEditPage shows the hint 'Findings in this pregnancy (GDM, high blood pressure, twins) are not detected automatically – the doctor uses Include anyway on the patient's plan.' (Replaced on 4 Oct 2026 – see Next in `docs/PROGRESS.md`: the hint now says an item "for" a finding applies once a doctor or RMO has ticked that finding on the patient's record. 'For which patients' also has the five findings, 'Any diabetes' and 'Any high blood pressure'.)
- `TemplateDetailPage` hint: 'Patients' plans keep the version they were built from until a doctor updates each plan.'

### 11.2 Overview card 'Care plan' (first card, `card card-wide`, about 170 px)

**Header**
- Title 'Care plan', plus the approval state:
  - **Draft:** a watch pill 'Draft' **and** the visible text 'Draft – not approved for clinical use'.
  - **Approved:** a stable pill 'Approved · v3'.
  - **Replaced:** a watch pill 'Approved v2 – replaced by approved v3'.

**Body**
- **Counts:** pills Overdue (high), Due now (due), Needs decision (watch), Missed visits (inactive), plus 'Done 9 of 44'.
- **Next visit:** a teal line with CalendarDays: 'Next visit: Antenatal visit (16 weeks) · 7 – 27 Sep 2026 · also due: Repeat Hb, Td – dose 2'.
- **Items:** up to 4 rows (status pill, name, date).
- **Link:** 'Open care plan'. The card is read-only.

**States**
- **No dates:** 'No care plan yet – it is built automatically once the LMP or scan EDD is entered.' Editors also get the link 'Add pregnancy dates'.
- **EDD review:** 'The EDD changed by 16 weeks – the plan waits for the doctor's decision.'
- **Paused or closed:** one line with the date.
- **Nothing due:** 'Nothing overdue or due now.' plus the next-visit line.

### 11.3 Care plan tab (top to bottom)

**1. Alerts** (not dismissible), in this order:
- **Draft** (warning):
  - Content not approved: '**Draft – not approved for clinical use.** Based on “{template}” version {v}, which no doctor has approved yet. Use it only as a reminder; the treating doctor decides.'
  - Risk rules not approved: '**Draft – not approved for clinical use.** The risk rules that decide the high-risk items have changed since a doctor last approved them.'
  - Link 'Review the template' for doctors, RMOs and nurses.
- **EDD review** (warning):
  - Editors: 'The EDD changed from 1 Mar 2027 to 20 Sep 2027. The plan is on hold. Is this the same pregnancy?' with secondary buttons 'Same pregnancy – move the dates' and 'New pregnancy – start a new plan', each confirmed in a dialog.
  - Others: 'Waiting for the treating doctor or an RMO to confirm the new dates.'
- **Paused** (info): 'Paused on 12 Oct 2026 – the type of care is Postnatal. Items can still be marked done; no reminders.'
- **Closed / earlier plan** (info): 'Closed on … (Delivered).' Editors get 'Reopen'.
- **Update available** (info; editors; only when `updateApproved`): 'An approved version of “{template}” is available (v5, approved by Dr Rao on 2 Oct 2026). [Review changes]'. A newer draft gets a quiet hint line instead.
- **Recent automatic changes** (info): the lines from `recentChanges`, e.g. '12 Oct 2026 – Due dates moved: EDD changed from 3 Mar 2027 to 24 Feb 2027 (scan EDD). 2 moved items need a date check.'
- **Missing facts** (warning): 'Rh-negative items can't be decided: blood group not recorded. High-risk items can't be decided: risk level is Incomplete.' plus the link 'Add in Edit details'.
- **Not detected** (hint): 'GDM, high blood pressure or twins found in this pregnancy are not detected automatically – use Include anyway or Add item.' (Replaced on 4 Oct 2026 – see Next in `docs/PROGRESS.md`: the note now says items for a finding apply once the finding is ticked on her record in Edit details, and to use Include anyway or Add item only for what the template has no item for. A plan built before the template had the items shows a warning 'Ticked on her record: …' with 'Review the update'.)
- **Post-dates** (warning): 'Past 43 weeks. If she has delivered, change the type of care to Postnatal – the plan pauses.'
- **Read-only** (hint): 'View only – the treating doctor or an RMO updates the plan.'

**2. Summary card** (h2 'Antenatal care plan')
- The template pill.
- A tabular line: 'Today 18 w 0 d · EDD 1 Mar 2027 (from scan) · Booked 20 Jul 2026 at 8 w 0 d · From: Standard antenatal care – v1'.
- The hint 'Suggested schedule – the treating doctor decides. Statuses as of 28 Sep 2026.'
- Links: **Change booking date**, **Change protocol** (when `canChangePlan`), **Close plan** (when `canClose`).
- The teal next-visit line.
- Count chips (44 px buttons, each a StatusPill with a count) that set the filter: Overdue, Due now, Needs decision, Missed visits, Done x of y.

**3. Toolbar**
- `.segmented`: **To do** (default) · **Done & not needed** · **All**.
- A type select (Visits, Lab tests, Scans, Vaccinations, Medicines, Advice).
- **Add item** (secondary, Plus) when `canChangePlan`.
- `view`, `kind` and `status` are kept in the URL (`useListParams`).

**4. Items table** (`<table className="dt">` inside `.dt-card`; rows ≥ 56 px; phone: stacked cards with `data-label`, no sideways scroll, 44 px targets)
- **To do view:**
  - First, a group 'Needs a decision': Decide, Check needed, and items flagged Check date. (A date the doctor moved outside the window with a reason keeps the 'Outside guideline window' marker but is not asked again.) Quick actions on each row:
    - *Plan now* (Move, prefilled today → today + 6)
    - *Done elsewhere* (Mark done with 'elsewhere' ticked)
    - *Include anyway* (for Check needed) or *Not needed*
  - Then overdue, due, waiting and upcoming items by effective date, with the full-width row '**Today · 18 w 0 d**' between items starting on or before today and later ones.
- **Done & not needed view:** newest first.
- **All view:** grouped by stage using the effective due-from: At booking / First trimester to 13 w 6 d / Second 14–27 w / Third 28 w onwards / Timed after another item.
- **Columns:**
  - **When:** `timingText` + date range; Deep Teal with CalendarDays when upcoming or due.
  - **Item:** neutral kind pill (`ITEM_KIND_ICONS`) + name + markers; the note, result or reason on a sub-line.
  - **Status:** pill + 12 px caption ('by 18 Oct 2026 · 3 days ago', using `relativeDays(date, plan.today)`).
  - **Actions** (when `canEdit`):
    - Open items: **Mark done** (secondary small, `aria-label="Mark {name} done"`) and a **More** menu: Move date, Reset date, Not needed, Include anyway, Remove inclusion, Keep as planned, Add note, Details.
    - Done or not-needed items: Reopen, Add note, Details.
- Read-only viewers: no Actions column; a row click opens Details.

**5. Folded `<details>` sections**
- 'Missed visits (n)' – each row keeps Mark done (attended) for editors.
- 'Does not apply (n)' – with the reason, e.g. 'Only for Rh-negative mothers – blood group B+'; editors get Include anyway.
- 'Before booking or covered (n)'.
- 'Plan history (n)' – Avatar, name, date and time, text.
- 'Earlier care plans (n)' – link to `?planId=`, which opens with a read-only banner.

### 11.4 Dialogs (each: `useDialogFocus`, one primary button, Cancel as a link, field errors from `err.fields`, Escape closes, focus returns to the row)

- **Mark done** ('Mark done: {name}'):
  - Fields: Date (default and maximum `plan.today`); 'Done elsewhere (outside report)'; Result (lab tests and scans only; placeholder 'e.g. Hb 11.2 g/dL'); Note.
  - Hints:
    - Scans: 'Record findings needed for care. Never record or disclose the baby's sex (PCPNDT Act).'
    - Blood group test: 'Also enter the blood group in Edit details – Rh-negative items depend on it.'
    - Dating scan: 'If the scan changes the EDD, enter the scan EDD in Edit details – the plan's dates follow.'
  - The after-item warning (§7.2).
- **Move date:**
  - Due from and Due by, with a live readout ('20 w 1 d – 20 w 6 d'), the guideline window, and the min/max from `plan.today`.
  - Reason, highlighted as required when outside the window.
- **Not needed:**
  - Reason radios: Not indicated – doctor's decision · Patient declined · Covered by another item (e.g. booster given, booking OGTT) · Window passed · Not available here · Other; plus text.
  - Hint: 'Done at another centre? Use Mark done and tick “Done elsewhere”.'
- **Include anyway:** reason with quick picks.
- **Note.**
- **Add item:** Type, Name, When (weeks from–to, or dates), Text for the patient's copy, Note, and an optional Reason.
- **Item details** (`modal-wide`):
  - Window with gestation, planned vs moved dates, 'For' (APPLIES label).
  - Patient text, source, done or not-needed details.
  - Flags with *Keep as planned*, and the history.
- **Change protocol** (`modal-wide`):
  1. Step 1: the options with Draft/Approved pills; the current one is marked 'In use'.
  2. Step 2: the preview: Added (with 'n need a decision – their window has passed') · Possible duplicates (warning) · Changed (dates you moved are kept – check them) · Kept because they have staff changes · Removed (not started) · Unchanged.
  3. Primary 'Switch to this protocol' or 'Update plan'. A draft target shows the warning 'This protocol is a draft – the plan will be marked “Draft – not approved for clinical use”.'
- **Change booking date:**
  - Hint 'Items due at the first visit are counted from this date. Items due since this date that were done but not recorded will show as Overdue – mark them done.'
  - Allowed range shown from `minBookedOn` to `plan.today`.
- **EDD decision confirmations:**
  - Same: 'Move the plan to the new EDD (20 Sep 2027)? Items not yet done get new due dates; dates you moved stay and are marked “Check date”.'
  - New: 'Start a new plan for the pregnancy with EDD 20 Sep 2027? The current plan is closed and kept read-only under Earlier care plans. {n} items marked done stay in the old plan and are not carried over.'
- **Close plan:**
  - Reason select (Delivered, Pregnancy ended, Transferred out, Care continues elsewhere, Other) + note.
  - Danger button 'Close plan'.
  - Text: 'Reminders for this pregnancy stop. The plan stays in the record and can be reopened.'
- **Reopen plan:** a confirmation.

### 11.5 States

- **Loading:** skeleton rows.
- **Error:** error Alert + *Try again*.
- **No dates:** 'Pregnancy dates not entered yet. The care plan is built automatically when a doctor or RMO adds the LMP or scan EDD.' Editors get 'Add pregnancy dates'.
- **Not antenatal and no plan:** 'Care plans for {care type} patients come in a later version.' (plus earlier plans, if any).
- **Empty template:** 'The template has no items – choose a protocol or add items.'
- **Any 409:** close the dialog, show a warning Alert with the server message, reload the plan.

### 11.6 Shared component change and `carePlanFormat.js`

**`MenuButton`**
- Accepts items `{label, to}` **or** `{label, icon?, onSelect, danger?}`; it renders a `<button>` for the latter.
- Arrow keys move through links and buttons (the selector becomes `.menu-list a, .menu-list button`).

**`carePlanFormat.js` exports**
- `PLAN_STATUS` (tone, icon, word per status, §5.7).
- `DONE_WORDS`, `NOT_NEEDED_REASONS`, `CLOSE_REASONS`, `WHY_TEXT`, `FLAG_LABELS`, `LOG_LABELS`.
- `statusNote(item, plan)`.
- `windowText(from, to)`: '12–26 Oct 2026', '28 Sep – 4 Oct 2026', '30 Dec 2026 – 5 Jan 2027'.
- `relativeDays(date, today)`: 'today', 'in 5 days', '22 days ago'.
- `approvalText(template)`.

---

## 12. PCPNDT

- There is no fetal-sex field in the model or the API, and strict schemas reject unknown keys.
- **`server/src/utils/pcpndt.js`** and **`client/src/pcpndtWords.js`** export identical patterns:

```js
export const FETAL_SEX_WORDS = /\b(?:boys?|girls?|males?|females?|sons?|daughters?|sex|gender|lad(?:ka|ke|ki|kiyan|kiyaan)|lar(?:ka|ke|ki))\b/i;
export const KARYOTYPE = /(?:\b\d{2}\s*,\s*)?\bX[XY]\b/;      // case-sensitive: 46,XY · 46, XX · XY
export const SEX_SYMBOLS = /[♂♀]/;                   // ♂ ♀
export const mentionsFetalSex = (t) => Boolean(t) && (FETAL_SEX_WORDS.test(t) || KARYOTYPE.test(t) || SEX_SYMBOLS.test(t));
```

**Where the server checks it**
- `safeText(label, max)` = `z.string().trim().max(max).refine((t) => !mentionsFetalSex(t), PCPNDT_MESSAGE)`.
- Plan text: done result/note, not-needed reason, move reason, include reason, note text, custom name/patientText/note/reason, close note.
- Template text: template name/description/sources and item name/patientText/source.

**Message and word lists**
- `PCPNDT_MESSAGE`: 'Please remove words about the baby's sex – it must never be recorded in a pregnancy (PCPNDT Act). For the partner, write “partner” or “husband”.'
- `routes/dictationWords.js` uses `mentionsFetalSex` on the lower-cased phrase.
- `client/.../dictation.js` replaces `SEX_WORDS` with `FETAL_SEX_WORDS`.
- A server test imports the client module (`../../client/src/pcpndtWords.js`) and checks that the `.source` and `.flags` of all three patterns are equal.

**Must pass / must be refused**
- Must pass: 'beta hCG 1200', 'sonography', 'person', 'sexually transmitted', 'Hb 11.2 g/dL', 'TIFFA normal, AFI 12'.
- Must be refused: 'It's a boy', 'ladki', 'ladke', '46,XY', '46, XX', '♀'.
- The built-in template content passes (checked).
- The Mark done dialog shows the scan hint.
- A word list can be misspelt around, so staff training is still needed.

---

## 13. Edge cases (expected behaviour; each has a test)

- **Late bookings:**
  - 20 w and 33 w: see §2.3. None of the lapsed, covered or decide items are Overdue or listable.
  - Booking at 16 w 3 d: visit_16 is covered.
- **A window that closes after booking, not done:** Overdue (a real miss). For visits it becomes Missed once the next visit window starts. The next-visit suggestion never proposes a missed visit.
- **Blood group missing:** ICT and anti-D show *Check needed*.
  - O− entered at 32 w → they apply (plan log 'items now apply'). Windows that closed after booking are Overdue.
  - Corrected to O+ → open, unmoved Rh items become *Does not apply* (notes kept). A moved one becomes *Check needed – no longer indicated*. A done ICT stays done with 'No longer applies'.
- **Risk override high → low:** Doppler becomes Does not apply (or Check if moved). Low → high brings it back with its note and date intact.
- **Risk incomplete, or moderate that may be higher:** high-risk items show Check needed.
- **Risk rules edited (items unchanged):** the plan shows Draft with the risk-rules reason, and Doppler carries 'Based on draft risk rules'. A risk override removes that for this patient.
- **Scan EDD 6 days earlier:** template items re-time; the log line appears; moved items keep their dates with Check date (plus Outside guideline window if outside); done items are unchanged.
- **EDD moves more than 56 d:**
  - On hold (nothing listable) until the decision. Typing the old EDD back clears the hold.
  - New pregnancy → old plan closed read-only, new plan built.
  - The way back from a mistaken choice is §6.5.
- **Closing a plan while on hold:** no new plan is built for the new EDD.
- **Td-1 done 15 Oct 2026:** Td-2 due 12–25 Nov.
  - Td-1 open → Td-2 Waiting ('about …', never a past date).
  - Td-1 not needed → Td-2 Check needed.
  - Td-1 reopened → waiting again.
  - Td-1 included anyway while its rule is 'no' → Td-2 applies.
- **'After' loop or missing anchor:** Check needed. Template saves now refuse loops.
- **Care type → Postnatal:**
  - The plan pauses; items can still be marked done; plan-level actions return 409.
  - Back to antenatal with the same EDD → active, with all staff data.
  - A new pregnancy later (EDD more than 56 d away) → old plan closed automatically, new plan built, and no plan audit entry.
- **Doctor closes the plan ('Delivered') while the patient is still antenatal:** no automatic re-creation; Reopen is available.
- **Past EDD + 21 d:** post-dates banner.
- **Record marked sensitive:** nurses and other doctors get 403 at once. A doctor reassignment changes access, not the plan.
- **Infertility → antenatal:** stays sensitive (open question).
- **Reception changes the type of care:** the plan pauses; the response has no medical details.
- **Template edits and approvals:**
  - Existing plans are unchanged.
  - Approving identical content marks plans approved (checked on read). An edit followed by a revert matches the hash again.
  - A template approved before Feature 7 → backfilled; editing only its rules keeps the plans' content approved.
- **Template switch:**
  - At 20 w to a from-scratch protocol: the done NT is kept as not-in-template; the protocol's NT is listed as a possible duplicate; added items whose windows passed are Decide, not Overdue.
  - A kind changed under the same key: the old item is kept if touched, plus a new item.
  - Another doctor's protocol → 403. Empty → 400. Another hospital → 404.
- **Concurrency:**
  - Same item: the second person gets 409 (or 200 `changed:false` if identical).
  - Different items: both succeed.
  - A sync that changed the item after it was opened → 409 'updated automatically'.
  - Two first views → one plan.
  - An out-of-date sync (a patient version older than the stored one) changes nothing.
- **Booking date:** the default is the build date; a doctor edit must be ≥ 4 w 0 d and ≤ today. An infertility patient converted with an LMP 3 weeks before registration gets `bookedOn` = the build date.
- **Legacy patients** without a plan get one on first view. `seed:demo` builds plans with date-only values.
- **Folic acid 'until 12 weeks'** at a 30 w booking, and a booking OGTT at ≥ 24 w overlapping the repeat OGTT: the doctor marks *Not needed – covered*.

---

## 14. Tests

### 14.1 Engine (`server/tests/careplan-engine.test.js`, no database)

1. **Dates:**
   - Every §2.3 example; completed-week boundaries; `gaOn` round trip; scan EDD beats LMP.
   - `hospitalToday` at 18:29Z / 18:31Z / 19:00Z.
   - `utcDay` with a non-midnight EDD gives the same windows.
   - `gestationalAge` uses the hospital date at the IST midnight edge.
2. **At-booking window** `[B, B+13]`; the default booking date = the build date.
3. **Status boundaries:** `dueBy` = today → due; +1 → overdue; `dueFrom` = tomorrow → upcoming.
4. **Late start:**
   - Per kind (lapsed, decide, catch_up).
   - `covered` when a visit window contains B (booking at 16 w 3 d).
   - A window still open at the booking date is due.
   - `lateFrom 'added'` for merge-added and custom items.
5. **Missed visits:**
   - visit_24 Overdue on 30 Nov and Missed on 7 Dec 2026.
   - visit_37 Missed on 15 Feb 2027; stays Missed after visit_38 is done.
   - The suggestion at 30 w is visit_28; `missedVisits` count; an at-booking visit follows the same rule.
6. **After-items:**
   - Waiting (estimate = max(anchor dueFrom, today) + weeks; not listable; never overdue).
   - Dated from `done.on`.
   - Anchor not needed → check; missing or loop → check without hanging.
   - Inherited 'does not apply'; an included anchor gives yes; dependency order.
7. **Applicability** for every `appliesWhen`: override, incomplete, moderate + mayBeHigher, first pregnancy with null caesareans, conditions not confirmed, Include anyway. No-longer-indicated only when the rule changed after the person's action.
8. **EDD changes:**
   - Δ 7 d → re-timed; moved items get `check_date` and `outside_window`; done items unchanged.
   - Δ 200 d → `on_hold`, nothing listable; reverting clears it.
9. **Rev rule:** derive raises the rev only when watched fields change; it is idempotent (a second run changes nothing); items in `changedIds` are not raised twice.
10. **Property:** 200 random changes of facts, EDD, booking date and template → staff-owned fields deep-equal before and after; `derivePlan` is idempotent; the basis key is stable.
11. **Merge:**
    - Same key and kind; a timing change flags a moved item.
    - An untouched removed item is dropped; a touched one (including one with only a history entry by a person) is kept as not-in-template.
    - An item that only has a `template_changed` history entry counts as untouched.
    - Kind change; added items with `addedOn`; `needsDecision`; `possibleDuplicates`; custom items untouched.
    - Preview equals apply.
12. **Hashes:** `itemsHash`/`rulesHash` are order-independent and change with any field (including `source`); `backfillApproval` guard (`approvedVersion ≠ version` → no entry).
13. **Labels:** content unapproved → `content`; rules unapproved + `high_risk` items → `risk_rules`; an override clears it; a plan with no `high_risk` items ignores the rules; approved-then-replaced gives `newerApprovedVersion`.
14. **PCPNDT patterns:** the positive and negative lists in §12; the client and server patterns are identical.

### 14.2 API (`server/tests/careplans.test.js`, supertest + helpers; time pinned with `vi.setSystemTime`)

15. **Smoke:** `GET /api/patients/:id/care-plan` returns 200 (proves `mergeParams`).
16. **Creation:**
    - An RMO registers an antenatal patient with an LMP → a Draft plan with 44 items; `CARE_PLAN_CREATED` has the allowed keys only.
    - Reception registration without dates → no plan. A PATCH adding an LMP → created.
    - None for gynaecology.
    - Lazy creation on GET for a directly inserted patient.
    - Two parallel GETs → one plan.
    - No re-creation after a doctor closed the plan for the same EDD, or while it was on hold (`toEdd`).
17. **Approval:**
    - `template.label` is present.
    - Approving the unchanged template → the plan is approved without regeneration.
    - A template approved before Feature 7 (no approvals) and then only its rules edited → items still approved and label `risk_rules`; approving again clears it.
    - Items edited + approved → `updateAvailable` and 'replaced' text; the preview diff is correct; `PUT /template` keeps staff data; a stale hash → 409.
    - Approve race: a PUT between reading and approving → 409, and status is not approved.
    - Template PUT on a stale version → 409.
18. **Access matrix:**
    - RMO, own doctor and a doctor on an unassigned patient can edit.
    - Another doctor: GET 200 read-only, changes 403, sensitive record 403.
    - Nurse: 200 read-only; 403 on a sensitive record and on changes.
    - Reception, lab and admin-only: 403.
    - Another hospital's patient, item or template → 404.
    - **A nurse on patient A with sensitive patient B's `planId` → 404. Reopen with another patient's `planId` → 404.**
    - `carePlanSummary` is absent for reception and lab.
19. **Each action:**
    - Happy paths.
    - Validation: `on` in the future or too early; a result on a visit; a short reason; a move outside the window without a reason; `dueBy` in the past or after 43 w; include without a reason; custom item with a window after 43 w; an unknown field (`fetalSex`) → 400.
    - Wrong-state messages.
    - Undo (reopen with reason 'Undo').
20. **Order, conflicts and repeats:**
    - An identical repeat with an **old** rev → 200 `changed:false`, and no second audit entry.
    - A stale rev with a different change → 409 naming the person, and nothing changed.
    - An item changed by sync (blood group corrected) after it was opened → 409 'updated automatically'.
    - Two items saved with old plan revisions → both succeed.
    - The same `clientRequestId` → one item.
21. **Patient changes reach the plan:**
    - Scan EDD Δ 6 d → re-timed plus a log entry.
    - Δ 200 d → hold, then `edd-decision` same / new (old plan closed, `replacesPlanId`), and the way back (close new, reopen old, hold, same).
    - Blood group O− / O+.
    - Risk override PUT / DELETE.
    - PATCH `ageYears` crossing 35 → high-risk items apply without a GET.
    - Reception changing the type of care → paused (item done allowed; template switch 409 `PLAN_PAUSED`), then back → active.
22. **Stale sync:** sync with an out-of-date patient object after a newer EDD sync → the plan, the hold and the log are unchanged.
23. **Self-healing:** `Patient.updateOne` behind the app's back (same `__v`) → the next GET re-derives. A template approval that changes risk levels → the plan follows on the next read.
24. **Close / reopen:** closed → changes return 409 `PLAN_CLOSED`; reopen while another current plan exists → 409.
25. **Audit privacy:**
    - After the whole flow, every `CARE_PLAN_*` entry has only whitelisted keys.
    - The hospital admin's audit-log JSON contains no item key (`anti_d`, `lab_hiv`), item name, template id, `replacesPlanId`, reason, note, result, date, or the words `new_pregnancy` / `plan_closed`.
    - Automatic re-dating, pause, hold and the automatic replacement write no entry.
26. **PCPNDT:**
    - 'It's a boy' in a scan result → 400; '46,XY' → 400; 'beta hCG 1200' is accepted.
    - A template item with 'ladki' → 400.
    - A dictation word with 'ladka' → refused.
27. **Template save** refuses an `after` loop and a self-reference.
28. **Tenancy:** every CarePlan query carries `tenantId` (the plugin would throw).
29. **Log limits:** 150 automatic changes → 100 automatic entries kept, and every entry made by a person kept.
30. **Regression:**
    - `patients.test.js` lines 46, 60 and 103 compute expectations with `hospitalToday()` / pinned time.
    - An LMP of 'today' is accepted at 00:30 IST.
    - `seed-demo` stores midnight dates.

### 14.3 Client

- `carePlanFormat.test.js`:
  - Every status maps to a tone, an icon and a word.
  - `windowText` (same month, different months, different years, single day).
  - `DONE_WORDS` per kind; `relativeDays` with `plan.today`; `statusNote` variants; `approvalText` (Approved, replaced, Draft content, Draft rules).
  - `timingText` with fixed dates.
- The existing `dictation.test.js` still passes with the shared words.

---

## 15. Files and build order (commit after each working step)

### Commit 1 – 'Feature 7 (1/3): care-plan engine and date fixes'
- `careplans/dates.js`, `planRules.js`, `hashes.js`, `planEngine.js`.
- `utils/pcpndt.js` + `client/src/pcpndtWords.js`.
- `config.HOSPITAL_TIME_ZONE`, `.env.example`.
- `gestationalAge` fix, Patient pre-validate normalisation, `pregnancySchema` using `hospitalToday`.
- `patients.test.js` updates.
- Engine tests.

### Commit 2 – 'Feature 7 (2/3): patient care plans on the server'
- **Models:** `models/CarePlan.js`.
- **Template changes:** `CarePlanTemplate.approvals` + `optimisticConcurrency`; `templates.js` (loop check, PCPNDT, backfill, conditional approve); backfill in `ensureStandardTemplates`.
- **Utilities:** `utils/patientLookup.js` (`findPatient`, `loadPatientForPlan`); `dateOnly` in `validate.js`.
- **App wiring:** `req.now` middleware in `createApp`.
- **Plans:** `careplans/plansService.js`; `routes/carePlans.js` (`Router({ mergeParams: true })`) mounted in `patients.js`; sync hooks (POST, PATCH, risk override, GET) and `carePlanSummary`.
- **Access and audit:** `patientAccess` flags; audit actions, categories and whitelist; `dictationWords.js` uses the shared words.
- **Seed and helpers:** `scripts/seed-demo.js` (date-only values; plans built with an explicit `bookedOn`; some booking items done with fake results); `helpers.js` `CarePlan.init()`.
- API tests.

### Commit 3 – 'Feature 7 (3/3): care plan on the patient record'
- **Brand first:** `docs/BRAND.md` gets the Today divider row pattern.
- **Shared pieces:** `carePlanFormat.js` + test; `MenuButton` actions; `templateFormat.js` (labels, dates); `dictation.js` uses the shared words.
- **Screens:** `CarePlanCard`, `CarePlanTab`, dialogs; route in `App.jsx`; `PatientDetailPage` tabs and `localSummary`; styles; audit labels; template-page hints.
- **Checks:** 1366 × 768, tablet and phone.
- **Docs:** `docs/PROGRESS.md` and `docs/FEATURES.md` (Feature 7 ✅, content awaiting doctor review); browser test steps for the owner.

### Browser check for the owner (fake data only)
1. As the demo RMO, open an antenatal patient. Check the Overview card (the Draft sentence is visible), the Care plan tab, the Draft banner, and the dates against the EDD.
2. Mark a test done, then Undo. Move the anomaly scan outside its window (a reason is needed). Mark folic acid not needed. Add 'Thyroid review' at 24–26 w.
3. Enter a scan EDD 6 days different: the dates move, the moved scan shows 'Check date', and 'Recent automatic changes' explains why.
4. Set the blood group to O−: anti-D and ICT appear.
5. Log in as a nurse (view only), reception (no tab) and another doctor (read-only).
6. As a doctor, approve the standard template: the Draft banner goes away. Edit only a risk rule: the Draft banner returns with the risk-rules reason.
7. As hospital admin, the audit log shows only 'Care plan …' entries with record numbers.

---

## 16. Hooks for later features (not built now)

- **Feature 8 (visits):**
  - `nextVisitSuggestion(plan, today)` and `planView.next`: missed visits are never suggested, and missed ones are counted.
  - Saving a visit calls `applyItemAction(ctx, patientId, itemId, {action:'done', on, via:'visit', visitId, rev})` for each ticked item (this replaces bulk done).
  - The prescription print shows `template.label` when it is set.
- **Feature 9 (printouts):**
  - PlanView already has `patientText`, `source`, status, results, notes, reasons, the approver and `template.label`. Every printed page repeats 'Draft – not approved for clinical use' when `approved` is false.
  - Feature 9 adds the selection column and the sticky bar, and a `CARE_PLAN_PRINTED` audit entry (ids only).
- **Feature 10 (lists):**
  - Add `summary.windows: [{dueFrom, dueBy, category: 'visit' | 'test_scan' | 'vaccination'}]` written by `derivePlan` for listable items, with a multikey index `{tenantId, current, status, 'summary.windows.dueFrom'}` queried with `$elemMatch`.
  - Apply the missed-visit rule (a visit window ended and a later visit window started) and exclude plans past EDD + 21 d.
  - `refreshStalePlans(tenantId)`, throttled like `refreshDueRisks`: compare `basis.key`/version with `planFacts` for antenatal patients, and create missing plans.
  - Re-check `patientAccess` per row. Reception gets name, number, phone, 'overdue since' and a generic category only, never item names.
  - Rows show `template.label`.