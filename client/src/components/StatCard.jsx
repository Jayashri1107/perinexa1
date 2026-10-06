export function StatCard({ icon: Icon, label, value, hint, tone = 'primary' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon">{Icon && <Icon size={22} aria-hidden />}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}
