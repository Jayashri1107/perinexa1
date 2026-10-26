import { useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Clock, Search, Stethoscope, UserPlus, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable, formatNumber } from '../../components/DataTable.jsx';
import { Alert, KpiCard, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { addDaysIso } from '../appointments/appointmentFormat.js';
import { PharmacyHeader, money } from './pharmacyUi.jsx';

// Pharmacy → Daily register (owner, 26 Oct 2026): the day's patients who need the pharmacy, never the whole patient
// list – OPD (arrived that day or prescribed that day), IPD (in hospital) and External (walk-in customers billed that
// day), each with what the pharmacy has done and the next step: make her bill, issue her medicines, or open the bill.
// Someone from another day is found by her exact patient number or phone number (in the audit log).

export const PATIENT_TYPES = { opd: 'OPD', ipd: 'IPD', external: 'External' };
const TYPE_LOOK = { opd: { tone: 'due', icon: Stethoscope }, ipd: { tone: 'admitted', icon: BedDouble }, external: { tone: 'neutral', icon: UserPlus } };
const STATUS_LOOK = {
  no_rx: { tone: 'inactive', icon: CircleDashed, label: 'No prescription yet' },
  rx_waiting: { tone: 'watch', icon: Clock, label: 'Prescription waiting' },
  billed: { tone: 'stable', icon: CircleCheck, label: 'Billed' },
  not_issued: { tone: 'watch', icon: Clock, label: 'Nothing issued today' },
  issued: { tone: 'stable', icon: CircleCheck, label: 'Issued today' },
};

export function TypePill({ type }) {
  const look = TYPE_LOOK[type];
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {PATIENT_TYPES[type]}
    </StatusPill>
  );
}

/** Where a patient's next bill is made: OPD at the counter, IPD as an issue to her stay. */
export const billPath = (type) => (type === 'ipd' ? '/pharmacy/issue' : '/pharmacy');

const nameOf = (r) => r.patient?.fullName ?? r.customer?.name ?? '';
const detailsOf = (r) => {
  if (r.type === 'opd') return [r.opdNo, r.doctor, r.at && `came ${formatDateTime(r.at)}`].filter(Boolean).join(' · ');
  if (r.type === 'ipd') return [r.ward || 'Ward not given', r.bed && `bed ${r.bed}`, r.discharged && 'discharged'].filter(Boolean).join(', ');
  return [r.customer.phone, formatDateTime(r.at)].filter(Boolean).join(' · ');
};

/** Find someone who is not on the day's register: her exact patient number, or her phone number. bare: inside another card. */
export function FindElsewhere({ onPick, onOpenBill, bare = false }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const find = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setResult(await api('/pharmacy/register/find', { query: { q: text.trim() } }));
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  };
  const nothing = result && !result.error && !result.patients.length && !result.external.length;
  const Box = bare ? 'div' : 'section';
  const Heading = bare ? 'h3' : 'h2';
  return (
    <Box className={bare ? 'ph-elsewhere' : 'card bill-section'} aria-labelledby="ph-find">
      <Heading id="ph-find">Someone from another day</Heading>
      <p className="hint">Type her full patient number (as on her card) or her phone number. Each search is kept in the audit log.</p>
      <form className="bill-toolbar" onSubmit={find}>
        <label className="bill-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Patient number or phone number</span>
          <input type="search" placeholder="Patient number or phone number" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={busy || text.trim().length < 3}>
          <Search aria-hidden="true" /> Find
        </button>
      </form>
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {nothing && <p className="muted">Nobody found. Check the number, or ask reception to check her in.</p>}
      {(result?.patients?.length > 0 || result?.external?.length > 0) && (
        <ul className="appt-pick-list" aria-label="Found">
          {result.patients.map((p) => (
            <li key={p.id}>
              <button type="button" className="appt-pick" onClick={() => onPick({ type: p.admitted ? 'ipd' : 'opd', patient: p })}>
                <strong>
                  {p.fullName} <TypePill type={p.admitted ? 'ipd' : 'opd'} />
                </strong>
                <span className="muted">
                  {p.mrn}
                  {p.phone ? ` · ${p.phone}` : ''} · {p.admitted ? 'Issue her medicines' : 'Make her bill'}
                </span>
              </button>
            </li>
          ))}
          {result.external.map((x) => (
            <li key={x.bills[0].id}>
              <button type="button" className="appt-pick" onClick={() => onOpenBill(x.bills[0].id)}>
                <strong>
                  {x.customer.name} <TypePill type="external" />
                </strong>
                <span className="muted">
                  Bill {x.bills[0].number} · {formatDateTime(x.at)} · {money(x.bills[0].netPaise)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const type = PATIENT_TYPES[params.get('type')] ? params.get('type') : 'all';
  const res = useFetch('/pharmacy/register', date ? { date } : undefined);
  const day = date ?? res.data?.date;
  const isToday = res.data && res.data.date === res.data.today;
  const set = (next) => setParams({ ...(date ? { date } : {}), ...(type !== 'all' ? { type } : {}), ...next }, { replace: true });
  const goDay = (d) => setParams({ ...(type !== 'all' ? { type } : {}), ...(d && d !== res.data?.today ? { date: d } : {}) }, { replace: true });

  const open = ({ type: t, patient }) => navigate(billPath(t), { state: { patient } });
  const openBill = (id) => navigate(`/pharmacy/invoices/${id}`);
  const term = text.trim().toLowerCase();
  const rows = (res.data?.rows ?? [])
    .filter((r) => type === 'all' || r.type === type)
    .filter((r) => !term || [nameOf(r), r.patient?.mrn, r.patient?.phone, r.customer?.phone, r.opdNo].some((v) => v && String(v).toLowerCase().includes(term)))
    .map((r) => ({ ...r, key: `${r.type}-${r.patient?.id ?? r.bills[0]?.id}` }));
  const counts = res.data?.counts;

  const action = (r) => {
    if (r.type === 'external') {
      return (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBill(r.bills[0].id)}>
          Open bill
        </button>
      );
    }
    return (
      <span className="row-actions">
        {r.bills.map((b) => (
          <button key={b.id} type="button" className="btn btn-link btn-sm" onClick={() => openBill(b.id)}>
            {b.number}
          </button>
        ))}
        {isToday && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(r)}>
            {r.type === 'ipd' ? 'Issue medicines' : r.bills.length ? 'Another bill' : 'Make bill'}
          </button>
        )}
      </span>
    );
  };

  return (
    <>
      <PharmacyHeader
        title="Daily register"
        crumb="Daily register"
        subtitle={isToday || !day ? "Today's patients who need the pharmacy" : `Patients of ${day}`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/pharmacy', { state: { type: 'external' } })}>
            <UserPlus aria-hidden="true" /> New external bill
          </button>
        }
      />
      <div className="pf-content bill-page">
        {res.error && <Alert type="error">{res.error}</Alert>}
        <div className="kpi-grid" aria-label="How many">
          <KpiCard icon={Stethoscope} tone="due" label="OPD" value={counts ? formatNumber(counts.opd) : '—'} sub="Outpatients" />
          <KpiCard icon={BedDouble} tone="admitted" label="IPD" value={counts ? formatNumber(counts.ipd) : '—'} sub={isToday || !day ? 'Admitted now' : 'In hospital that day'} />
          <KpiCard icon={UserPlus} label="External" value={counts ? formatNumber(counts.external) : '—'} sub="Walk-in customers billed" />
        </div>
        <DataTable
          caption="Daily patient register"
          rows={res.data ? rows : undefined}
          rowKey="key"
          loading={res.loading}
          emptyText={term ? 'Nobody on this register matches.' : type === 'all' ? 'Nobody on the register yet.' : `No ${PATIENT_TYPES[type]} patients on this register.`}
          toolbar={
            <div className="bill-toolbar">
              <div className="segmented" role="group" aria-label="Type of patient">
                {[['all', 'All', Users], ['opd', 'OPD', Stethoscope], ['ipd', 'IPD', BedDouble], ['external', 'External', UserPlus]].map(([k, label, Icon]) => (
                  <button key={k} type="button" aria-pressed={type === k} onClick={() => set({ type: k === 'all' ? undefined : k })}>
                    <Icon aria-hidden="true" /> {label}
                    {counts && k !== 'all' ? ` (${formatNumber(counts[k])})` : ''}
                  </button>
                ))}
              </div>
              <input type="search" className="bill-search-plain" aria-label="Find on this register" placeholder="Name, number or phone" value={text} onChange={(e) => setText(e.target.value)} />
              {day && (
                <div className="appt-daynav" role="group" aria-label="Day">
                  <button type="button" className="icon-btn" onClick={() => goDay(addDaysIso(day, -1))} aria-label="Previous day">
                    <ChevronLeft aria-hidden="true" />
                  </button>
                  <input type="date" aria-label="Day" value={day} max={res.data?.today} onChange={(e) => e.target.value && goDay(e.target.value)} />
                  <button type="button" className="icon-btn" onClick={() => goDay(addDaysIso(day, 1))} aria-label="Next day" disabled={isToday}>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          }
          columns={[
            {
              key: 'who',
              header: 'Patient',
              render: (r) => (
                <span>
                  <strong>{nameOf(r)}</strong>
                  {r.patient && <span className="muted tabular"> · {r.patient.mrn}</span>}
                </span>
              ),
            },
            { key: 'type', header: 'Type', render: (r) => <TypePill type={r.type} /> },
            { key: 'details', header: 'Details', render: detailsOf },
            {
              key: 'status',
              header: 'Pharmacy',
              render: (r) => {
                const look = STATUS_LOOK[r.status];
                return (
                  <StatusPill tone={look.tone} icon={look.icon}>
                    {look.label}
                    {r.status === 'billed' && r.bills.length ? ` · ${money(r.bills.reduce((s, b) => s + b.netPaise, 0))}` : ''}
                  </StatusPill>
                );
              },
            },
            { key: 'action', header: 'Next step', align: 'right', render: action },
          ]}
        />
        <FindElsewhere onPick={open} onOpenBill={openBill} />
      </div>
    </>
  );
}
