import { Check, ClipboardCheck, ClipboardPen, FileText, Inbox, TestTube, UserCheck, UserPlus } from 'lucide-react';
import { formatDateTime } from '../../components/ui.jsx';

// The order's steps as a tracker (owner, 19 Oct 2026 – docs/LAB_DASHBOARD_PLAN.md, as eLabAssist shows a sample's
// progress): Registered → Sample taken → Received in the lab → Results entered → Checked (when the hospital checks
// results) → Reported → Reviewed by the doctor (not for a walk-in). Each step done shows who and when (colour, icon and
// word – never colour alone).

/** The steps of an order: { key, word, icon, stamp } – stamp null while not done. */
export function orderSteps(order) {
  const checks = Boolean(order.entered || order.verified || order.status === 'entered');
  // Without the check, results are entered and reported in one step
  const entered = order.entered ?? (order.reported && !checks ? order.reported : null);
  const steps = [
    { key: 'ordered', word: 'Registered', icon: UserPlus, stamp: order.ordered },
    { key: 'collected', word: 'Sample taken', icon: TestTube, stamp: order.collected },
    { key: 'received', word: 'Received in lab', icon: Inbox, stamp: order.received },
    { key: 'entered', word: 'Results entered', icon: ClipboardPen, stamp: entered },
    ...(checks ? [{ key: 'verified', word: 'Checked', icon: ClipboardCheck, stamp: order.verified }] : []),
    { key: 'reported', word: 'Reported', icon: FileText, stamp: order.reported },
    ...(order.source === 'walk_in' ? [] : [{ key: 'reviewed', word: 'Seen by doctor', icon: UserCheck, stamp: order.reviewed }]),
  ];
  return steps;
}

/**
 * Each step with { done, next }: a step with no stamp before one that has one was passed without being recorded (an
 * older order, from before the "received" step); "next" is the first step after the last one done.
 */
export function trackedSteps(order) {
  const steps = orderSteps(order);
  const lastDone = steps.reduce((n, s, i) => (s.stamp ? i : n), -1);
  const next = steps.findIndex((s, i) => !s.stamp && i > lastDone);
  return steps.map((s, i) => ({ ...s, done: Boolean(s.stamp) || i < lastDone, next: i === next }));
}

export function OrderTracker({ order }) {
  if (order.status === 'cancelled') return null;
  const steps = trackedSteps(order);
  return (
    <ol className="lab-track" aria-label="Where this order is">
      {steps.map((s, i) => {
        const { done } = s;
        const Icon = done ? Check : s.icon;
        return (
          <li key={s.key} className={done ? 'is-done' : s.next ? 'is-now' : ''} aria-current={s.next ? 'step' : undefined}>
            <span className="lab-track-dot" aria-hidden="true">
              <Icon />
            </span>
            <span>
              <span className="lab-track-word">
                {s.word}
                <span className="sr-only">{done ? ' – done' : s.next ? ' – next' : ' – not yet'}</span>
              </span>
              <span className="lab-track-when">{s.stamp ? `${formatDateTime(s.stamp.at)}${s.stamp.byName ? ` · ${s.stamp.byName}` : ''}` : done ? 'Not recorded' : s.next ? 'Next' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
