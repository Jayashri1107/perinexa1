// Today for a nurse (owner, 9 Oct 2026): her shift and ward at the top; the numbers that matter as small tiles; then
// what is due now across her patients (doses and care tasks, oldest first, each opening that patient's chart), the
// patients who need attention, and the services she sent to billing today. Every number comes from the records.
import { AlertTriangle, ArrowRight, BedDouble, ClipboardList, Droplets, FlaskConical, HeartPulse, Pill, Plus, Receipt, Send, Siren, Syringe } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nursingServicesApi, wardCareApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { FLAG_LOOKS } from '../visits/visitFormat.js';
import { SLOT_LOOKS, clock, slotWhen } from './nursingFormat.js';
import { ServiceDialog } from './ServiceDialog.jsx';

const WARD_KEY = 'perinexa1.nursingWard';
const readWard = () => {
  try {
    return localStorage.getItem(WARD_KEY) ?? '';
  } catch {
    return '';
  }
};
const saveWard = (id) => {
  try {
    localStorage.setItem(WARD_KEY, id);
  } catch {
    /* only a convenience */
  }
};

function Tile({ icon: Icon, label, value, hint, tone, to }) {
  return (
    <Link to={to} className={`nt-tile tone-${tone}`}>
      <span className="nt-tile-icon"><Icon size={18} aria-hidden /></span>
      <span className="nt-tile-value">{value}</span>
      <span className="nt-tile-label">{label}</span>
      {hint && <span className="nt-tile-hint">{hint}</span>}
    </Link>
  );
}

// Why a patient needs attention, most urgent first.
function reasons(p) {
  const out = [];
  for (const f of p.redFlags) out.push({ look: { ...FLAG_LOOKS[f.level], word: f.label } });
  if (p.dosesOverdue) out.push({ look: { tone: 'danger', icon: AlertTriangle, word: `${p.dosesOverdue} dose${p.dosesOverdue === 1 ? '' : 's'} overdue` } });
  if (p.labFlagged) out.push({ look: { tone: 'danger', icon: FlaskConical, word: 'Abnormal result' } });
  if (p.vitalsDue) out.push({ look: { tone: 'pending', icon: HeartPulse, word: 'Vital signs due' } });
  if (p.ivToStart) out.push({ look: { tone: 'pending', icon: Droplets, word: 'IV to start' } });
  return out;
}

export function NurseToday() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wardId, setWardId] = useState(readWard);
  const [data, setData] = useState(null);
  const [services, setServices] = useState(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);

  const load = useCallback(() => {
    wardCareApi
      .station(wardId ? { wardId } : {})
      .then((d) => { setData(d); setError(''); })
      .catch((err) => {
        if (wardId && err.status === 400) { setWardId(''); saveWard(''); } else setError(err.message);
      });
    nursingServicesApi.mineToday().then((r) => setServices(r.items)).catch(() => setServices([]));
  }, [wardId]);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const choose = (id) => { setWardId(id); saveWard(id); };
  const firstName = user.name.split(' ')[0];
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loader />;
  const t = data.totals;
  const ward = data.wards.find((w) => w.id === wardId);
  const attention = data.items.map((p) => ({ p, why: reasons(p) })).filter((x) => x.why.length).sort((a, b) => b.why.length - a.why.length).slice(0, 8);
  const sentTotal = (services ?? []).filter((s) => s.status !== 'cancelled').reduce((n, s) => n + s.amount, 0);

  return (
    <div className="nurse-today">
      <section className="card nt-hero">
        <div>
          <p className="muted small nt-date">{dateText} · {data.shift.label}</p>
          <h1>Good to see you, {firstName}</h1>
          <p className="muted">{ward ? `${ward.name}${ward.floor ? `, ${ward.floor}` : ''}` : 'All wards'} · {t.patients} patient{t.patients === 1 ? '' : 's'} in hospital</p>
        </div>
        <div className="nt-hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => setRecording(true)}><Syringe size={16} aria-hidden /> Record a service</button>
          <Link to="/hospital/nursing" className="btn btn-ghost"><ClipboardList size={16} aria-hidden /> Nursing station</Link>
        </div>
      </section>

      <div className="chips nt-wards" role="group" aria-label="My ward">
        <button type="button" className={`chip-toggle${!wardId ? ' on' : ''}`} aria-pressed={!wardId} onClick={() => choose('')}>All wards</button>
        {data.wards.map((w) => (
          <button key={w.id} type="button" className={`chip-toggle${wardId === w.id ? ' on' : ''}`} aria-pressed={wardId === w.id} onClick={() => choose(w.id)}>
            {w.name}{w.floor && <span className="muted"> · {w.floor}</span>} <span className="muted">({w.patients})</span>
          </button>
        ))}
      </div>

      <div className="nt-tiles">
        <Tile icon={Pill} label="Doses due" value={t.dosesDue} hint={t.dosesOverdue ? `${t.dosesOverdue} overdue` : 'None overdue'} tone={t.dosesOverdue ? 'danger' : 'teal'} to="/hospital/nursing" />
        <Tile icon={HeartPulse} label="Vital signs due" value={t.vitalsDue} hint={`Every ${data.settings.vitalsEveryHours} h`} tone="amber" to="/hospital/nursing" />
        <Tile icon={Droplets} label="IV running" value={t.ivRunning} tone="blue" to="/hospital/nursing" />
        <Tile icon={ClipboardList} label="Tasks due" value={t.tasksDue} tone="teal" to="/hospital/nursing" />
        <Tile icon={FlaskConical} label="Tests waiting" value={t.labPending} tone="grey" to="/hospital/lab" />
        <Tile icon={Siren} label="Red flags" value={t.redFlags} tone={t.redFlags ? 'danger' : 'grey'} to="/hospital/nursing" />
      </div>

      <div className="nt-grid">
        <section className="card">
          <div className="card-head">
            <h2><Pill size={18} aria-hidden /> Due now</h2>
            <span className="muted small">{data.due.length} item{data.due.length === 1 ? '' : 's'}</span>
          </div>
          {data.due.length === 0 ? (
            <p className="muted">Nothing due right now.</p>
          ) : (
            <ul className="plain-list nt-due">
              {data.due.map((d) => (
                <li key={`${d.stayId}${d.what}${d.dueAt}`}>
                  <button type="button" className={`nt-due-row${d.state === 'overdue' ? ' overdue' : ''}`} onClick={() => navigate(`/hospital/inpatients/${d.stayId}?tab=care`)}>
                    <span className="nt-due-time"><strong>{slotWhen(d.dueAt)}</strong></span>
                    <span className="nt-due-what">
                      <strong>{d.what}</strong>
                      <span className="muted small block"><BedDouble size={12} aria-hidden /> {d.bed || '—'} · {d.patient.name}{d.instructions && ` · ${d.instructions}`}</span>
                    </span>
                    <StateBadge look={SLOT_LOOKS[d.state]} small />
                    <ArrowRight size={16} className="muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h2><AlertTriangle size={18} aria-hidden /> Needs attention</h2>
              <Link to="/hospital/nursing" className="small">All patients <ArrowRight size={12} aria-hidden /></Link>
            </div>
            {!data.rulesApproved && <p className="muted small">Red-flag alerts are off until a doctor approves the rules in the Clinic library.</p>}
            {attention.length === 0 ? (
              <p className="muted">Everyone is up to date.</p>
            ) : (
              <ul className="plain-list rows">
                {attention.map(({ p, why }) => (
                  <li key={p.id} className="nt-att">
                    <Link to={`/hospital/inpatients/${p.id}?tab=care`}><strong>{p.bed || '—'} · {p.patient.name}</strong></Link>
                    <span className="ns-badges">{why.slice(0, 3).map((w) => <StateBadge key={w.look.word} look={w.look} small />)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2><Receipt size={18} aria-hidden /> My services today</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecording(true)}><Plus size={14} aria-hidden /> Add</button>
            </div>
            {!services && <Loader />}
            {services?.length === 0 && <p className="muted">None yet. Record injections, dressings and other services – they go to the front desk for the bill.</p>}
            {services?.length > 0 && (
              <>
                <ul className="plain-list rows">
                  {services.slice(0, 6).map((s) => (
                    <li key={s.id} className={s.status === 'cancelled' ? 'struck' : ''}>
                      <span><strong>{s.items.map((i) => i.name).join(', ')}</strong><span className="muted small block">{clock(s.givenAt)} · {s.patient.name}</span></span>
                      <StateBadge look={s.status === 'billed' ? { tone: 'active', icon: Receipt, word: 'On the bill' } : s.status === 'sent' ? { tone: 'pending', icon: Send, word: 'Sent' } : { tone: 'inactive', icon: Send, word: 'Cancelled' }} small />
                    </li>
                  ))}
                </ul>
                <p className="muted small top-gap-sm">{services.length} today · {formatMoney(sentTotal)}</p>
              </>
            )}
          </section>
        </div>
      </div>

      {recording && <ServiceDialog onClose={() => setRecording(false)} onSaved={() => { setRecording(false); load(); }} />}
    </div>
  );
}
