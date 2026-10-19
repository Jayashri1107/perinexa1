// Appointment booking (docs/APPOINTMENTS_PLAN.md, approved by the owner on 3 Oct 2026): the choices the owner may
// want to change later, each in one place. The website keeps its own copy of BOOKING_ROLES and QUEUE_ROLES
// (client/src/platform/modules.js).

// Who books, moves and cancels appointments (owner: reception and doctors – not RMOs, nurses or lab staff; and the
// referral desk, which books the woman another doctor sent – owner, 15 Oct 2026, docs/REFERRALS_PLAN.md).
export const BOOKING_ROLES = ['receptionist', 'doctor', 'referral_desk'];
// Who sees the doctors' days and waiting lists (to call patients in; the referral desk, to find a free time).
export const QUEUE_ROLES = ['receptionist', 'doctor', 'rmo', 'nurse', 'referral_desk'];
// Who sees a patient's appointments (her record's Appointments tab). Marking her arrived is not the desk's
// (routes/arrivals.js ARRIVAL_ROLES).
export const PATIENT_APPOINTMENT_ROLES = ['receptionist', 'doctor', 'rmo', 'nurse', 'referral_desk'];
// Length of one time slot in minutes (owner: 10). Changing it keeps old bookings at their times.
export const SLOT_MINUTES = 10;
// How long a visit of each type takes (owner, 4 Oct 2026): each doctor chooses, in whole slots. A longer visit takes
// the slots that follow its time as well.
export const VISIT_LENGTHS = [10, 20, 30, 40, 50, 60];
// The kinds of visit reception may choose – deliberately no medical details.
export const VISIT_TYPES = ['new', 'follow_up', 'scan', 'other'];
export const VISIT_TYPE_LABELS = { new: 'New', follow_up: 'Follow-up', scan: 'Scan', other: 'Other' };
// Reasons for a cancellation.
export const CANCEL_REASONS = ['patient_asked', 'doctor_leave', 'other'];
// How far ahead a booking may be made (a next visit may be up to a year away).
export const MAX_DAYS_AHEAD = 366;
// At most this many sessions a day, and leave entries per doctor.
export const MAX_SESSIONS_PER_DAY = 4;
export const MAX_LEAVE_ENTRIES = 60;
export const MAX_LEAVE_DAYS = 180;
