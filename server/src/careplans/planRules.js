// Numbers the care-plan engine works with. Each one is a choice the owner or the reviewing doctor may want
// to change (they are listed as open questions with these defaults).

// Items due "at booking" are due from the booking date for 14 days (booking date + 13, inclusive).
export const BOOKING_WINDOW_DAYS = 14;
// Items timed "N weeks after another item" are due for 14 days from (that item's done date + N weeks).
export const AFTER_WINDOW_DAYS = 14;
// What happens to an item whose window had already ended when the plan started (late booking), when the item
// was added, or when the finding of this pregnancy that makes it apply was ticked. lapsed = shown as "Before
// booking"; decide = the doctor decides; catch_up = due from that day for 14 days.
export const LATE_START = {
  visit: 'lapsed',
  advice: 'catch_up',
  medication: 'decide',
  investigation: 'decide',
  scan: 'decide',
  vaccination: 'decide',
};
// Kinds that may appear on reminder lists (Feature 10).
export const REMINDER_KINDS = ['visit', 'investigation', 'scan', 'vaccination'];
// An EDD change larger than this is held for the doctor's "same or new pregnancy" decision. Also used to
// decide whether a paused plan belongs to the same pregnancy.
export const SAME_PREGNANCY_DAYS = 56;
// From EDD + 21 days (43 w 0 d) the plan shows a post-dates banner (and leaves Feature 10's lists).
export const POST_DATES_DAYS = 21;
// A booking date set by a doctor must be at least 4 w 0 d.
export const MIN_BOOKING_DAYS = 28;
// A done date may be up to a year before day 0 (earlier results, e.g. a known blood group).
export const DONE_EARLIEST_DAYS = 365;
// The longest due window a person can set when moving an item.
export const MOVE_MAX_SPAN_DAYS = 84;
// Automatic plan-log entries from this many days are shown as "Recent automatic changes".
export const RECENT_CHANGES_DAYS = 14;
// Automatic plan-log entries kept per plan. Entries made by people are never trimmed.
export const AUTO_LOG_KEEP = 100;
// Items per plan, and items a person added.
export const MAX_ITEMS = 400;
export const MAX_CUSTOM = 100;
// Raise when the way plans are worked out changes: every plan is worked out again on its next read.
// 1 = first version, 2 = items can depend on findings ticked for this pregnancy (GDM, high blood pressure,
// twins, low-lying placenta, bleeding); an item whose weeks had passed when its finding was ticked is a late
// start (for the doctor to decide), not overdue.
export const PLAN_ENGINE_VERSION = 2;
