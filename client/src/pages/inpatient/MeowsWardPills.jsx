import { Activity, Clock } from 'lucide-react';
import { StatusPill, formatDateTime } from '../../components/ui.jsx';

// The MEOWS chart on the ward's list (Clinical Requirements Group B, item 8 – E4 of OBG-F-05): observations overdue
// (the ordered frequency + 15 min; 30 min after a trigger) and the escalation tasks still open. From
// /api/inpatients (admitted[].meows); nothing when the stay has no MEOWS chart.

/** True when the ward nurse should look at this stay's MEOWS chart now. */
export const meowsNeedsAction = (m) => Boolean(m && (m.overdue || m.lateTasks > 0));

export function MeowsWardPills({ meows }) {
  if (!meows) return null;
  return (
    <>
      {meows.overdue && (
        <StatusPill tone="high" icon={Clock}>
          {`MEOWS overdue since ${formatDateTime(meows.dueAt)}`}
        </StatusPill>
      )}
      {meows.openTasks > 0 && (
        <StatusPill tone={meows.lateTasks > 0 ? 'high' : 'watch'} icon={Activity}>
          {`MEOWS escalation: ${meows.openTasks} task${meows.openTasks > 1 ? 's' : ''} open${meows.lateTasks > 0 ? `, ${meows.lateTasks} past due` : ''}`}
        </StatusPill>
      )}
    </>
  );
}
