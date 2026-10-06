// A number card. With `to`, the whole card is a link (and lifts on hover like the others).
import { Link } from 'react-router-dom';

export function StatCard({ icon: Icon, label, value, hint, tone = 'primary', to }) {
  const body = (
    <>
      <div className="stat-icon">{Icon && <Icon size={22} aria-hidden />}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className={`stat-card tone-${tone} is-link`}>{body}</Link>
  ) : (
    <div className={`stat-card tone-${tone}`}>{body}</div>
  );
}
