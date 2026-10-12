// Words for Calendar → Reminders (pure). Each message in the outbox has a kind; staff see it as a plain label.
// The two general kinds – "a check-up or test is due" and "we missed you" – never say what is due, here or in the
// message itself.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "12 Oct 2026" (dates are date-only, stored as midnight UTC) – the same words as formatDate in components/ui.jsx.
const day = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
};

/** The kinds of message, as staff read them. */
export const KIND_LABELS = {
  appointment: 'Appointment reminder',
  booked: 'Appointment booked',
  moved: 'Appointment moved',
  cancelled: 'Appointment cancelled',
  care_due: 'Check-up or test due',
  missed: 'Missed appointment',
};
export const GENERAL_KINDS = ['care_due', 'missed'];

/**
 * What a message is about, in a few plain words: "Appointment reminder · appointment 2 Oct 2026",
 * "Check-up or test due · can be sent until 27 Oct 2026", "Missed appointment · of 20 Oct 2026".
 * A message from before kinds were shown (no kind) reads as an appointment reminder.
 */
export function messageAbout(m) {
  const kind = KIND_LABELS[m.kind] ? m.kind : 'appointment';
  if (kind === 'care_due') return `${KIND_LABELS.care_due} · can be sent until ${day(m.dueOn)}`;
  if (kind === 'missed') return `${KIND_LABELS.missed} · of ${day(m.aboutOn)}`;
  return `${KIND_LABELS[kind]} · appointment ${day(m.dueOn)}`;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What "Send due reminders now" did, in one sentence. r: the answer of POST /reminders/run
 * ({ queued, missed, careDue, heldBack, dropped, waiting, sent, failed, toSend }; older servers send fewer counts).
 */
export function runNotice(r) {
  const added = [
    count(r.queued ?? 0, 'new reminder for tomorrow', 'new reminders for tomorrow'),
    r.missed ? count(r.missed, 'for a missed appointment', 'for missed appointments') : null,
    r.careDue ? count(r.careDue, 'for a check-up or test due', 'for check-ups or tests due') : null,
  ].filter(Boolean);
  const result = [`${r.sent ?? 0} sent`, `${r.toSend ?? 0} to send by hand`, r.failed ? `${r.failed} failed` : null].filter(Boolean);
  const notes = [
    r.dropped ? `${count(r.dropped, 'waiting message was', 'waiting messages were')} cancelled as no longer needed.` : null,
    r.waiting
      ? `${count(r.waiting, 'message for a check-up or test due or a missed appointment waits', 'messages for a check-up or test due or a missed appointment wait')} until the morning: these are not sent in the evening or at night.`
      : null,
    r.heldBack
      ? `${count(r.heldBack, 'patient has', 'patients have')} something overdue but got no message: their care plan is still a draft (a doctor approves it in Clinic library → To approve).`
      : null,
  ].filter(Boolean);
  return [`Done: ${added.join(', ')}; ${result.join(', ')}.`, ...notes].join(' ');
}

/** True when a listed message is in Marathi or Hindi (their wording is a draft until a fluent speaker has checked it). */
export const hasDraftWording = (messages = []) => messages.some((m) => m.language && m.language !== 'en');
