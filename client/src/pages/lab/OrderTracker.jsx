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

export function OrderTracker({ order }) {
  if (order.status === 'cancelled') return null;
  const steps = orderSteps(order);
  const next = steps.findIndex((s) => !s.stamp);
  return (
    <ol className="lab-track" aria-label="Where this order is">
      {steps.map((s, i) => {
        const done = Boolean(s.stamp);
        const Icon = done ? Check : s.icon;
        return (
          <li key={s.key} className={done ? 'is-done' : i === next ? 'is-now' : ''} aria-current={i === next ? 'step' : undefined}>
            <span className="lab-track-dot" aria-hidden="true">
              <Icon />
            </span>
            <span>
              <span className="lab-track-word">
                {s.word}
                <span className="sr-only">{done ? ' – done' : i === next ? ' – next' : ' – not yet'}</span>
              </span>
              <span className="lab-track-when">{done ? `${formatDateTime(s.stamp.at)}${s.stamp.byName ? ` · ${s.stamp.byName}` : ''}` : i === next ? 'Next' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
