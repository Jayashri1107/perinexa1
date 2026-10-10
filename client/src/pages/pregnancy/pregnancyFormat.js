// Words and looks for a pregnancy's scans and vaccinations (the patient's Pregnancy card and its printout).
import { CalendarClock, CircleCheck, CircleHelp, Clock, Hourglass, Minus, TriangleAlert } from 'lucide-react';

export const STATUS_LOOKS = {
  done: { tone: 'active', icon: CircleCheck, word: 'Done' },
  due: { tone: 'pending', icon: Clock, word: 'Due now' },
  overdue: { tone: 'danger', icon: TriangleAlert, word: 'Overdue' },
  upcoming: { tone: 'info', icon: CalendarClock, word: 'Upcoming' },
  decide: { tone: 'inactive', icon: CircleHelp, word: 'Doctor decides' },
  waiting: { tone: 'inactive', icon: Hourglass, word: 'Date not known yet' },
  not_applicable: { tone: 'inactive', icon: Minus, word: 'Not needed' },
  not_needed: { tone: 'inactive', icon: Minus, word: 'Not needed' },
};
export const statusLook = (status) => STATUS_LOOKS[status] ?? STATUS_LOOKS.waiting;

// When an item is due, in words: "11–13 weeks", "At booking", "4 weeks after Td – dose 1".
export function whenText(item, items = []) {
  if (item.atBooking) return 'At booking';
  if (item.afterKey) {
    const anchor = items.find((i) => i.key === item.afterKey);
    return `${item.afterWeeks} weeks after ${anchor?.name ?? 'the earlier dose'}`;
  }
  if (item.fromWeek != null) return item.toWeek != null && item.toWeek !== item.fromWeek ? `${item.fromWeek}–${item.toWeek} weeks` : `${item.fromWeek} weeks`;
  return '';
}

// "Only when …" items the doctor decides on (twins, gestational diabetes …).
export const ONLY_WHEN = {
  high_risk: 'if high risk',
  rh_negative: 'if Rh negative',
  multiple_pregnancy: 'if twins',
  gdm: 'if gestational diabetes',
  placenta_praevia: 'if low-lying placenta',
};
export const onlyWhenText = (item) => (item.appliesWhen && item.appliesWhen !== 'always' ? ONLY_WHEN[item.appliesWhen] ?? 'if the doctor decides' : '');

export const weeksText = (w) => (w ? `${w.weeks} weeks ${w.days} day${w.days === 1 ? '' : 's'}` : '—');
