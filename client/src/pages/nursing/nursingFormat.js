// Words and status looks for the nurse's work (owner, 9 Oct 2026): doses, care tasks, IV fluids, lab tests.
// A status is always colour + icon + word (docs/BRAND.md).
import { Ban, CircleCheck, CircleDashed, CirclePause, CirclePlay, Clock, FlaskConical, Hourglass, OctagonX, TriangleAlert, UserX } from 'lucide-react';

export const SLOT_LOOKS = {
  later: { tone: 'inactive', icon: Clock, word: 'Later' },
  due: { tone: 'info', icon: Hourglass, word: 'Due' },
  overdue: { tone: 'danger', icon: TriangleAlert, word: 'Overdue' },
  given: { tone: 'active', icon: CircleCheck, word: 'Given' },
  late: { tone: 'pending', icon: Clock, word: 'Given late' },
  refused: { tone: 'danger', icon: UserX, word: 'Refused' },
  withheld: { tone: 'pending', icon: CirclePause, word: 'Withheld' },
  missed: { tone: 'danger', icon: OctagonX, word: 'Missed' },
  done: { tone: 'active', icon: CircleCheck, word: 'Done' },
  not_done: { tone: 'danger', icon: OctagonX, word: 'Not done' },
};

// What a nurse can chart for a dose; all but "given" need a reason.
export const DOSE_CHOICES = [
  ['given', 'Given'],
  ['late', 'Given late'],
  ['refused', 'Refused'],
  ['withheld', 'Withheld'],
  ['missed', 'Missed'],
];
export const TASK_CHOICES = [
  ['done', 'Done'],
  ['not_done', 'Not done'],
];
export const needsReason = (outcome) => !['given', 'done', ''].includes(outcome);

export const IV_LOOKS = {
  ordered: { tone: 'pending', icon: CircleDashed, word: 'To start' },
  running: { tone: 'info', icon: CirclePlay, word: 'Running' },
  paused: { tone: 'pending', icon: CirclePause, word: 'Paused' },
  completed: { tone: 'active', icon: CircleCheck, word: 'Completed' },
  stopped: { tone: 'inactive', icon: Ban, word: 'Order stopped' },
};
export const IV_ACTION_WORDS = { started: 'Started', paused: 'Paused', resumed: 'Resumed', completed: 'Completed', site_check: 'Site checked' };
// The IV actions that make sense from each state.
export const IV_NEXT = {
  ordered: ['started'],
  running: ['site_check', 'paused', 'completed'],
  paused: ['resumed', 'site_check', 'completed'],
  completed: [],
};

export const LAB_LOOKS = {
  ordered: { tone: 'pending', icon: FlaskConical, word: 'Sample to take' },
  collected: { tone: 'info', icon: Hourglass, word: 'Sample taken, at the lab' },
  reported: { tone: 'active', icon: CircleCheck, word: 'Report ready' },
  reviewed: { tone: 'active', icon: CircleCheck, word: 'Reviewed by doctor' },
  cancelled: { tone: 'inactive', icon: Ban, word: 'Cancelled' },
};

export const ORDER_WORDS = { medicine: 'Medicine', iv: 'IV fluid', task: 'Care task' };

/** "Paracetamol 500 mg · Oral · after food" / "Ringer lactate 500 ml at 100 ml/h" / the task. */
export function orderText(o) {
  if (o.type === 'medicine') return [o.medicine.drug, o.medicine.dose, o.medicine.route, o.medicine.food].filter(Boolean).join(' · ');
  if (o.type === 'iv') return `${o.iv.fluid} ${o.iv.volumeMl} ml at ${o.iv.rateMlPerHour} ml/h`;
  return o.task.text;
}

// "08:00" from a moment, on this computer's clock.
export const clock = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const isToday = (d) => new Date(d).toDateString() === new Date().toDateString();
export const slotWhen = (d) => (isToday(d) ? clock(d) : `Yesterday ${clock(d)}`);
