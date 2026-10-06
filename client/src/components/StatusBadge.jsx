import { Ban, CircleCheck, Clock } from 'lucide-react';

// A status is always colour + icon + word.
const STATUSES = {
  active: { icon: CircleCheck, label: 'Active' },
  inactive: { icon: Ban, label: 'Inactive' },
  pending: { icon: Clock, label: 'First login pending' },
};

export function StatusBadge({ status }) {
  const { icon: Icon, label } = STATUSES[status] ?? STATUSES.inactive;
  return (
    <span className={`badge badge-${status}`}>
      <Icon size={14} aria-hidden />
      {label}
    </span>
  );
}
