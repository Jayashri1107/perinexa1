// The nursing station (owner, 9 Oct 2026): the patients in hospital in the nurse's ward – her choice, remembered in
// this browser – with what is due now: doses, vital signs, care tasks, IV fluids, tests, red flags. Every number
// comes from the records. A patient opens her medicine and care charts.
import { Activity, BedDouble, ClipboardList, Droplets, FlaskConical, HeartPulse, Pill, Siren, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { wardCareApi } from '../../api/index.js';
import { Alert } from '../../components/Alert.jsx';
import { Loader } from '../../components/Loader.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { StateBadge } from '../../components/StateBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { FLAG_LOOKS } from '../visits/visitFormat.js';

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
    /* the choice is only a convenience */
  }
};

// What needs doing for one patient, most urgent first, as colour + icon + word.
function dueBadges(p) {
  const out = [];
  if (p.dosesOverdue) out.push({ key: 'od', look: { tone: 'danger', icon: TriangleAlert, word: `${p.dosesOverdue} dose${p.dosesOverdue === 1 ? '' : 's'} overdue` } });
  if (p.dosesDue - p.dosesOverdue > 0) out.push({ key: 'd', look: { tone: 'info', icon: Pill, word: `${p.dosesDue - p.dosesOverdue} dose${p.dosesDue - p.dosesOverdue === 1 ? '' : 's'} due` } });
  if (p.vitalsDue) out.push({ key: 'v', look: { tone: 'pending', icon: HeartPulse, word: 'Vital signs due' } });
  if (p.ivToStart) out.push({ key: 'is', look: { tone: 'pending', icon: Droplets, word: `IV to start` } });
  if (p.tasksDue) out.push({ key: 't', look: { tone: 'info', icon: ClipboardList, word: `${p.tasksDue} task${p.tasksDue === 1 ? '' : 's'} due` } });
  if (p.labFlagged) out.push({ key: 'lf', look: { tone: 'danger', icon: FlaskConical, word: 'Abnormal result' } });
  return out;
}

function PatientCard({ p }) {
  const badges = dueBadges(p);
  const urgent = p.redFlags.some((f) => f.level === 'urgent') || p.dosesOverdue > 0;
  return (
    <Link to={`/hospital/inpatients/${p.id}?tab=care`} className={`card ns-patient${urgent ? ' ns-urgent' : ''}`}>
      <div className="ns-bed">
        <BedDouble size={16} aria-hidden />
        <strong>{p.bed || '—'}</strong>
      </div>
      <div className="ns-body">
        <div className="ns-name">
          <strong>{p.patient.name}</strong>
          <span className="muted small">{[p.patient.patientNumber, p.patient.age != null && `${p.patient.age} y`].filter(Boolean).join(' · ')}</span>
        </div>
        <p className="muted small ns-line">{[p.ward, p.doctorName && `Dr ${p.doctorName.replace(/^Dr\.?\s*/i, '')}`].filter(Boolean).join(' · ')}</p>
        {p.reason && <p className="small ns-line">{p.reason}</p>}
        {p.patient.allergies && <p className="small ns-allergy"><TriangleAlert size={12} aria-hidden /> Allergies: {p.patient.allergies}</p>}
        <div className="ns-badges">
          {p.redFlags.map((f) => <StateBadge key={f.label} look={{ ...FLAG_LOOKS[f.level], word: f.label }} small />)}
          {badges.map((b) => <StateBadge key={b.key} look={b.look} small />)}
          {p.ivRunning > 0 && <StateBadge look={{ tone: 'info', icon: Droplets, word: `${p.ivRunning} IV running` }} small />}
          {p.labPending > 0 && <StateBadge look={{ tone: 'inactive', icon: FlaskConical, word: `${p.labPending} test${p.labPending === 1 ? '' : 's'} waiting` }} small />}
          {badges.length === 0 && p.redFlags.length === 0 && <StateBadge look={{ tone: 'active', icon: Activity, word: 'Nothing due now' }} small />}
        </div>
        <p className="muted small ns-line">Last vital signs: {p.lastVitalsAt ? formatDateTime(p.lastVitalsAt) : 'none yet'}</p>
      </div>
    </Link>
  );
}

export function NursingStationPage() {
  const [wardId, setWardId] = useState(readWard);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    wardCareApi
      .station(wardId ? { wardId } : {})
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => {
        // a ward that no longer exists: back to all wards
        if (wardId && err.status === 400) {
          setWardId('');
          saveWard('');
        } else setError(err.message);
      });
  }, [wardId]);
  useEffect(load, [load]);
  // what is due changes with the clock: refresh every minute while the page is open
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const choose = (id) => {
    setWardId(id);
    saveWard(id);
  };
  const t = data?.totals;
  const ward = data?.wards.find((w) => w.id === wardId);
  // most urgent patients first: red flags and overdue doses, then whatever is due, then by bed
  const items = [...(data?.items ?? [])].sort((a, b) => {
    const score = (p) => (p.redFlags.some((f) => f.level === 'urgent') ? 100 : 0) + p.dosesOverdue * 10 + p.dosesDue + p.tasksDue + Number(p.vitalsDue) + p.labFlagged * 5;
    return score(b) - score(a) || `${a.ward}${a.bed}`.localeCompare(`${b.ward}${b.bed}`, undefined, { numeric: true });
  });

  return (
    <>
      <PageHeader
        title="Nursing station"
        subtitle={data ? `${data.shift.label} · ${ward ? `${ward.name}${ward.floor ? `, ${ward.floor}` : ''}` : 'All wards'} · updated every minute` : 'Patients in hospital and what is due now'}
      />
      <Alert type="error">{error}</Alert>
      {data && (
        <div className="chips ns-wards" role="group" aria-label="Ward">
          <button type="button" className={`chip-toggle${!wardId ? ' on' : ''}`} aria-pressed={!wardId} onClick={() => choose('')}>All wards</button>
          {data.wards.map((w) => (
            <button key={w.id} type="button" className={`chip-toggle${wardId === w.id ? ' on' : ''}`} aria-pressed={wardId === w.id} onClick={() => choose(w.id)}>
              {w.name}{w.floor && <span className="muted"> · {w.floor}</span>} <span className="muted">({w.patients})</span>
            </button>
          ))}
        </div>
      )}
      {!data && !error && <Loader />}
      {data && (
        <>
          <div className="stat-grid ns-stats">
            <StatCard icon={BedDouble} label="Patients" value={t.patients} tone="primary" />
            <StatCard icon={Pill} label="Doses due now" value={t.dosesDue} hint={t.dosesOverdue ? `${t.dosesOverdue} overdue` : 'None overdue'} tone={t.dosesOverdue ? 'danger' : 'teal'} />
            <StatCard icon={HeartPulse} label="Vital signs due" value={t.vitalsDue} hint={`Every ${data.settings.vitalsEveryHours} hours`} tone="amber" />
            <StatCard icon={Droplets} label="IV fluids running" value={t.ivRunning} tone="blue" />
            <StatCard icon={FlaskConical} label="Tests waiting" value={t.labPending} tone="grey" />
            <StatCard icon={ClipboardList} label="Care tasks due" value={t.tasksDue} tone="teal" />
          </div>
          {!data.rulesApproved && (
            <p className="muted small"><Siren size={14} aria-hidden /> Red-flag alerts are off: the red-flag rules are still a draft in the Clinic library until a doctor approves them.</p>
          )}
          {items.length === 0 ? (
            <section className="card"><p className="muted">No patients in hospital{ward ? ` in ${ward.name}` : ''}.</p></section>
          ) : (
            <div className="ns-grid">{items.map((p) => <PatientCard key={p.id} p={p} />)}</div>
          )}
        </>
      )}
    </>
  );
}
