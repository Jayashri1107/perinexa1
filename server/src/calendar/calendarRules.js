// The calendar (LMP, EDD, care-plan visits and booked next visits by day, week and month): the choices the
// owner may want to change later, each in one place. The website keeps its own copy of CALENDAR_ROLES
// (client/src/platform/modules.js).

// Roles that may open the calendar (nurses, lab staff and admin-only people may not).
export const CALENDAR_ROLES = ['doctor', 'rmo', 'receptionist'];
// The kinds of entries, in the order they are listed on a day.
export const EVENT_TYPES = ['booked', 'plan', 'edd', 'lmp'];
// Entries only doctors and RMOs may see (pregnancy dates).
export const PREGNANCY_TYPES = ['edd', 'lmp'];
// The three views.
export const VIEWS = ['day', 'week', 'month'];
// First day of the week: 0 = Sunday, 1 = Monday. The only place the week start is set.
export const WEEK_STARTS_ON = 1;
// The longest range one answer covers (a month shown as whole weeks: 28 to 42 days).
export const MAX_RANGE_DAYS = 42;
// Entries sent per day before "open the day" (the counts stay complete).
export const MAX_EVENTS_PER_DAY = { day: 2000, week: 300 };
// Rows read per database query; reaching it marks the answer as possibly incomplete.
export const MAX_ROWS = 10000;
// Whether reception sees the care-plan visit windows of sensitive records (false: booked visits only).
export const RECEPTION_PLAN_FOR_SENSITIVE = false;
// Care-plan visit statuses shown to doctors and RMOs ("done" reads "Attended").
export const CLINICAL_PLAN_STATUSES = ['due', 'upcoming', 'overdue', 'missed', 'done'];
// Care-plan visit statuses shown to reception, all as the plain "Visit due" (no status word).
export const RECEPTION_PLAN_STATUSES = ['due', 'upcoming', 'overdue'];
// A booking stays on its day, marked "Arrived", when a visit is started for the patient on that day (owner's
// decision, 1 Oct 2026). A visit on another day still replaces it.
export const BOOKING_KEPT_AFTER_VISIT = true;
// Reception sees only the first day of a care-plan visit's window ("Visit due from 28 Sep"): the whole window can
// hint at how far along the pregnancy is (owner's decision, 1 Oct 2026).
export const RECEPTION_WINDOW_FIRST_DAY_ONLY = true;
// How far from today a date may be chosen.
export const MAX_DAYS_FROM_TODAY = 3660;
