import { CircleAlert, CircleCheck, Info } from 'lucide-react';

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info };

export function Alert({ type = 'info', children }) {
  if (!children) return null;
  const Icon = ICONS[type];
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
