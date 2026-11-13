import { useEffect, useRef, useState } from 'react';
import { BedDouble, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Clock, Search, Stethoscope, UserPlus, Users } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { DataTable, formatNumber } from '../../components/DataTable.jsx';
import { Alert, StatusPill, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { addDaysIso } from '../appointments/appointmentFormat.js';
import { money } from './pharmacyUi.jsx';
import { DateText } from '../../components/DateText.jsx';

// The pharmacy's daily register, on the pharmacist's Today page (owner, 26 Oct 2026): the day's patients who need the
// pharmacy, never the whole patient list – OPD (arrived that day or prescribed that day), IPD (in hospital) and External (walk-in customers billed that
// day), each with what the pharmacy has done and the next step: make her bill, issue her medicines, or open the bill.
// Someone from another day is found by her exact patient number or phone number, or by name among people the pharmacy
// has billed, as you type (in the audit log). A double click on a patient opens their bills.

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

/** How often today's register is read again, so a prescription the doctor has just saved appears. */
export const REFRESH_SECONDS = 30;

/** Where a patient's next bill is made: OPD at the counter, IPD as an issue to her stay. */
export const billPath = (type) => (type === 'ipd' ? '/pharmacy/issue' : '/pharmacy');

const nameOf = (r) => r.patient?.fullName ?? r.customer?.name ?? '';
const detailsOf = (r) => {
  if (r.type === 'opd') return [r.opdNo, r.doctor, r.at && `came ${formatDateTime(r.at)}`].filter(Boolean).join(' · ');
  if (r.type === 'ipd') return [r.ward || 'Ward not given', r.bed && `bed ${r.bed}`, r.discharged && 'discharged'].filter(Boolean).join(', ');
  return [r.customer.phone, formatDateTime(r.at)].filter(Boolean).join(' · ');
};

/** Where a double click on a patient goes: Sold, with that patient's bills open (the number stays out of the address). */
export const billsPlace = (patient) => ['/pharmacy/invoices', { state: { find: patient.mrn } }];

/**
 * A row where one click and a double click do different things: the click waits a moment, and a double click cancels
 * it. Call it for each row: {...clicks(single, double)}.
 */
export function useClickOrDouble() {
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (single, double) => ({
    onClick: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(single, 250);
    },
    onDoubleClick: () => {
      clearTimeout(timer.current);
      double();
    },
  });
}

/**
 * Find someone who is not on the day's register, as you type: part of a name, number or phone among people the pharmacy
 * has billed, or anyone's exact patient number or phone number. onText: the words typed, for the page to filter its own
 * list too. bare: inside another card; slim: one line, no heading (the pharmacist's Today toolbar, 26 Oct 2026).
 */
export function FindElsewhere({ onPick, onOpenBills, onOpenBill, onText, bare = false, slim = false }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const clicks = useClickOrDouble();
  const term = useDebounced(text.trim(), 300);
  useEffect(() => {
    if (term.length < 3) {
      setResult(null);
      return undefined;
    }
    let current = true;
    api('/pharmacy/register/find', { query: { q: term } })
      .then((res) => current && setResult(res))
      .catch((err) => current && setResult({ error: err.message }));
    return () => {
      current = false;
    };
  }, [term]);
  const nothing = result && !result.error && !result.patients.length && !result.external.length;
  const Box = bare || slim ? 'div' : 'section';
  const Heading = bare ? 'h3' : 'h2';
  return (
    <Box className={slim ? 'ph-find-slim' : bare ? 'ph-elsewhere' : 'card bill-section'} aria-labelledby={slim ? undefined : 'ph-find'} aria-label={slim ? 'Someone from another day' : undefined}>
      {!slim && <Heading id="ph-find">Someone from another day</Heading>}
      {!slim && <p className="hint">Type a name, number or phone. Double-click a patient to open their bills. Each search is kept in the audit log.</p>}
      <div className="bill-toolbar">
        <label className="bill-search" title="A name finds people the pharmacy has billed. Anyone else: their full patient number or phone number. Each search is kept in the audit log.">
          <Search aria-hidden="true" />
          <span className="sr-only">Find a patient: name, number or phone (each search is kept in the audit log)</span>
          <input
            type="search"
            placeholder="Patient name, number or phone"
            value={text}
            maxLength={40}
            onChange={(e) => {
              setText(e.target.value);
              onText?.(e.target.value);
            }}
          />
        </label>
      </div>
      {result?.error && <Alert type="error">{result.error}</Alert>}
      {nothing && <p className="muted">Nobody else found. A name finds only people the pharmacy has billed: for anyone else, type their full patient number or phone, or ask reception to check them in.</p>}
      {(result?.patients?.length > 0 || result?.external?.length > 0) && (
        <ul className="appt-pick-list" aria-label="Found">
          {result.patients.map((p) => (
            <li key={p.id}>
              <button type="button" className="appt-pick" title="Double-click to open their bills" {...clicks(() => onPick({ type: p.admitted ? 'ipd' : 'opd', patient: p }), () => onOpenBills(p))}>
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

/** The old address /pharmacy/register: the register is on Today now (its filters kept). */
export function RegisterRedirect() {
  return <Navigate to={`/${useLocation().search}`} replace />;
}

/**
 * The daily register on the pharmacist's Today page (owner, 26 Oct 2026): finding someone from another day first,
 * then `glance` (the pharmacy's numbers), then the day's list – no heading or count cards of its own (the filter
 * buttons carry the counts).
 */
export function DailyRegister({ glance = null, actions = null }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [topText, setTopText] = useState('');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : undefined;
  const type = PATIENT_TYPES[params.get('type')] ? params.get('type') : 'all';
  const res = useFetch('/pharmacy/register', date ? { date } : undefined);
  const day = date ?? res.data?.date;
  const isToday = res.data && res.data.date === res.data.today;
  const set = (next) => setParams({ ...(date ? { date } : {}), ...(type !== 'all' ? { type } : {}), ...next }, { replace: true });
  const goDay = (d) => setParams({ ...(type !== 'all' ? { type } : {}), ...(d && d !== res.data?.today ? { date: d } : {}) }, { replace: true });

  // A prescription saved by the doctor shows here without reloading: today's register is read again every
  // REFRESH_SECONDS while the page is in view
  const reload = res.reload;
  useEffect(() => {
    if (date) return undefined;
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [date, reload]);

  // A waiting prescription opens the sale with her and that prescription's medicines already on the bill
  const open = ({ type: t, patient, status, prescriptionVisitId }) => navigate(billPath(t), { state: { patient, ...(status === 'rx_waiting' && prescriptionVisitId ? { visitId: prescriptionVisitId } : {}) } });
  const openBill = (id) => navigate(`/pharmacy/invoices/${id}`);
  const openBills = (patient) => navigate(...billsPlace(patient));
  // The box at the top filters the day's list too
  const term = (text.trim() || topText.trim()).toLowerCase();
  const rows = (res.data?.rows ?? [])
    .filter((r) => type === 'all' || r.type === type)
    .filter((r) => !term || [nameOf(r), r.patient?.mrn, r.patient?.phone, r.customer?.phone, r.opdNo].some((v) => v && String(v).toLowerCase().includes(term)))
    .map((r) => ({ ...r, key: `${r.type}-${r.patient?.id ?? r.bills[0]?.id}` }));
  const counts = res.data?.counts;
  // Phones, as in the app design (2 Nov 2026): who is waiting with a prescription, above the register
  const onPhone = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 719px)').matches);
  const waiting = onPhone && isToday ? (res.data?.rows ?? []).filter((r) => r.status === 'rx_waiting') : [];

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
            {r.type === 'ipd' ? 'Issue medicines' : r.bills.length ? 'Another bill' : r.status === 'rx_waiting' ? 'Bill the prescription' : 'Make bill'}
          </button>
        )}
      </span>
    );
  };

  return (
    <section className="td-group" aria-label="Daily register">
      <div className="ph-register">
        {/* One slim line: someone from another day, and the day's quick actions (26 Oct 2026: less space) */}
        <div className="ph-topbar">
          <FindElsewhere slim onPick={open} onOpenBills={openBills} onOpenBill={openBill} onText={setTopText} />
          {actions}
        </div>
        {glance}
        {waiting.length > 0 && (
          <section className="ph-rx-waiting" aria-labelledby="ph-rx-waiting">
            <h2 id="ph-rx-waiting">Prescriptions waiting</h2>
            <ul>
              {waiting.map((r) => (
                <li key={r.patient.id}>
                  <button type="button" onClick={() => open(r)}>
                    <span>
                      <strong>{nameOf(r)}</strong>
                      {[r.patient.mrn, r.doctor].filter(Boolean).join(' · ')}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {res.error && <Alert type="error">{res.error}</Alert>}
        <DataTable
          caption="Daily patient register"
          rows={res.data ? rows : undefined}
          rowKey="key"
          loading={res.loading}
          onRowDoubleClick={(r) => (r.patient ? openBills(r.patient) : openBill(r.bills[0].id))}
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
                  <DateText aria-label="Day" value={day} max={res.data?.today} onChange={(v) => v && goDay(v)} />
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
      </div>
    </section>
  );
}
