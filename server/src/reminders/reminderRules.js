// Automatic "something is due" and "we missed you" messages (4 Oct 2026): the choices the owner may want to change
// later, each in one place. Both are GENERAL messages – the same fixed wording for everyone, never what is due or
// why – and go out under the same two switches as the appointment reminders: the hospital admin switched reminders
// on, and the patient (or, for a baby, the baby's own record) agreed.

// The general kinds of message in the outbox (models/ReminderMessage.js): a care-plan item is overdue; a booked
// appointment passed and nobody came.
export const GENERAL_KINDS = ['care_due', 'missed'];
// At most one general message (of either kind) in any this-many days – per patient AND per mobile number: a mother
// and her baby (or twins) on one number get one message, not the same words twice.
export const GENERAL_EVERY_DAYS = 14;
// A general message that could not go out by itself waits this many days (the day it was queued included) under
// "To send by hand"; after that it is too old to send.
export const GENERAL_VALID_DAYS = 7;
// Care-plan items that count as "something is due": tests, scans, vaccinations and check-ups (never advice or
// daily medicines). For a baby only vaccinations count (the brief for this feature, 4 Oct 2026).
export const CARE_DUE_KINDS = ['visit', 'investigation', 'scan', 'vaccination'];
// Pregnancy-loss care (abortion): none – no automatic "a check-up or test is due" message goes out from a
// pregnancy-loss care plan (5 Oct 2026). The message says nothing medical, but it may be read on a family phone
// soon after a loss; until the owner decides otherwise, staff see the overdue items on her care plan and call her
// themselves. To send it as for the other types of care, remove `abortion` from this list.
export const CARE_DUE_KINDS_BY_CARE = { newborn: ['vaccination'], abortion: [] };
// An item counts for a message only while it became overdue at most this many days ago (as the reminder staff
// prepare by hand: older ones are for the doctor to decide first). So nobody is messaged for ever about one item.
export const CARE_DUE_OVERDUE_DAYS = 42;
// "Something is due" goes to a patient only from a care plan whose content a doctor has approved (Clinic library →
// To approve). false: also from plans built from a draft schedule (they would then act on content nobody reviewed).
export const CARE_DUE_ONLY_FROM_APPROVED_PLANS = true;
// No "something is due" for this many days after she came (a visit, an arrival, a scan or procedure recorded as
// done, a lab sample taken, or the day she went home from a stay in hospital): the doctor has just seen her, and
// what is still open is the doctor's to decide.
export const CARE_DUE_QUIET_AFTER_VISIT_DAYS = 7;
// "We missed you": appointments of the last this-many days are looked at (1 = only yesterday's). More than one, so a
// day on which the server was switched off (a Sunday) does not lose the message; each appointment gets one at most
// for a day (an appointment moved to a new day after a no-show counts anew).
export const MISSED_LOOKBACK_DAYS = 3;
// How many patients one round looks at, per hospital.
export const GENERAL_MAX_PATIENTS = 5000;
// A SENSITIVE record's "check-up or test due" row in Calendar → Reminders. The message itself goes like any other
// (the rule of the appointment reminders: it says nothing medical). But the ROW tells staff that something in her
// care plan is overdue – and reception, nurses and other doctors see nothing of a sensitive record's care plan
// anywhere else (calendar/calendarRules.js RECEPTION_PLAN_FOR_SENSITIVE; the Today lists). false: the row is shown
// only to staff who may see her medical details (her doctor and RMOs), who send it by hand when there is no
// provider. true: to everyone who may see her phone number. "Missed appointment" rows are about a booking, which
// those staff see anyway, and are not affected.
export const CARE_DUE_ROW_FOR_SENSITIVE = false;
// The staff lists "Vaccinations overdue" and reception's "Babies due" (the Today page): a baby is listed while one
// of its vaccinations became overdue in the last this-many days (the same six weeks as the messages). Older ones
// stay on the baby's care plan – otherwise every baby whose later doses were given elsewhere stays listed for years.
export const VACCINATION_LIST_DAYS = 42;
