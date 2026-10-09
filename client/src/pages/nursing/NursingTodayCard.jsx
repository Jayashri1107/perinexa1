// Today for nurses (owner, 9 Oct 2026): what is due now in her ward – the same numbers as the nursing station.
import { ArrowRight, ClipboardList, Droplets, FlaskConical, HeartPulse, Pill } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { wardCareApi } from '../../api/index.js';

const savedWard = () => {
  try {
    return localStorage.getItem('perinexa1.nursingWard') ?? '';
  } catch {
    return '';
  }
};

export function NursingTodayCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    const wardId = savedWard();
    wardCareApi.station(wardId ? { wardId } : {}).then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const t = data.totals;
  const ward = data.wards.find((w) => w.id === savedWard());
  const rows = [
    [Pill, 'Doses due now', t.dosesDue, t.dosesOverdue ? `${t.dosesOverdue} overdue` : ''],
    [HeartPulse, 'Vital signs due', t.vitalsDue, ''],
    [Droplets, 'IV fluids running', t.ivRunning, ''],
    [FlaskConical, 'Tests waiting', t.labPending, ''],
    [ClipboardList, 'Care tasks due', t.tasksDue, ''],
  ];
  return (
    <section className="card">
      <div className="card-head">
        <h2><ClipboardList size={18} aria-hidden /> My ward now <span className="muted small">{data.shift.label} · {ward ? ward.name : 'all wards'} · {t.patients} patients</span></h2>
        <Link to="/hospital/nursing" className="btn btn-primary btn-sm">Nursing station <ArrowRight size={14} aria-hidden /></Link>
      </div>
      <ul className="plain-list rows">
        {rows.map(([Icon, label, n, extra]) => (
          <li key={label}>
            <span><Icon size={14} aria-hidden /> {label}</span>
            <span><strong>{n}</strong>{extra && <span className="field-error"> · {extra}</span>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
