import { useState } from 'react';
import { Ban, ClipboardCheck, ClipboardList, FileText, Home, Inbox, Plus, ScanBarcode, Siren, TestTube, Truck } from 'lucide-react';
import { api } from '../../api.js';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { HOSPITAL_LAB } from '../../platform/modules.js';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { Section } from '../worklist/WorklistSections.jsx';
import { DEPARTMENTS, FLAG_LOOK, LATE_LOOK, orderLook, testNames } from './labFormat.js';
import { WalkInDialog, homeWord } from './LabWalkIn.jsx';

// The Lab module (Version 2; the full lab system of docs/LAB_LIMS_PLAN.md): the lab's worklist – samples to take,
// results to enter, results to check (when the hospital checks results before the report), tests at an outside lab,
// and what was reported in the last 7 days. Urgent orders come first; a department narrows every list. Lab staff see
// every order (the patient's name, number and age only); doctors, RMOs and nurses see the orders of the patients whose
// medical details they may see.

const LISTS = [
  { key: 'collect', label: 'Samples to take', icon: TestTube, empty: 'No samples waiting.' },
  { key: 'receive', label: 'Samples to receive', icon: Inbox, empty: 'No sample waiting to reach the lab.' },
  { key: 'report', label: 'Results to enter', icon: ClipboardList, empty: 'No results waiting to be entered.' },
  { key: 'verify', label: 'Results to check', icon: ClipboardCheck, empty: 'No results waiting for a check.' },
  { key: 'outside', label: 'At outside labs', icon: Truck, empty: 'No tests waiting for an outside lab.' },
  { key: 'home', label: 'Home collections', icon: Home, empty: 'No home collection waiting.' },
  { key: 'done', label: 'Reported (last 7 days)', icon: FileText, empty: 'Nothing reported in the last 7 days.' },
];

export function LabRow({ o, list }) {
  const look = orderLook(o);
  return (
    <li>
      <div className="wl-row-head">
        <span className="wl-who">
          <Link to={`/lab/orders/${o.id}`} className="strong-name">
            {o.patient.fullName}
          </Link>
          <span className="muted tabular">
            {[o.sampleNo, o.patient.mrn, o.patient.age != null ? `${o.patient.age} yrs` : CARE_TYPE_SHORT[o.patient.careType], o.patient.assignedDoctorName].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="wl-counts">
          {o.urgent && list !== 'done' && (
            <StatusPill tone="high" icon={Siren}>
              Urgent
            </StatusPill>
          )}
          {o.late && (
            <StatusPill tone={LATE_LOOK.tone} icon={LATE_LOOK.icon}>
              {LATE_LOOK.word}
            </StatusPill>
          )}
          {o.source === 'walk_in' && (
            <StatusPill tone="neutral" icon={null}>
              Walk-in
            </StatusPill>
          )}
          {o.home && o.status === 'ordered' && (
            <StatusPill tone="due" icon={Home}>
              {homeWord(o.home.status)}
            </StatusPill>
          )}
          {o.status === 'ordered' && o.rejections?.length > 0 && (
            <StatusPill tone="watch" icon={Ban}>
              New sample needed
            </StatusPill>
          )}
          {o.abnormal && ['reported', 'reviewed'].includes(o.status) && (
            <StatusPill tone="high" icon={FLAG_LOOK.abnormal.icon}>
              Outside range
            </StatusPill>
          )}
          <StatusPill tone={look.tone} icon={look.icon}>
            {look.word}
          </StatusPill>
        </span>
      </div>
      <span className="hint">
        {testNames(o)} · ordered by {o.ordered.byName}, {formatDateTime(o.ordered.at)}
        {o.reported ? ` · reported ${formatDateTime(o.reported.at)}` : o.dueAt && o.status !== 'cancelled' ? ` · due ${formatDateTime(o.dueAt)}` : ''}
        {o.home && o.status === 'ordered' ? ` · home ${o.home.time}, ${o.home.address}${o.home.collectorName ? ` (${o.home.collectorName})` : ''}` : ''}
        {list === 'outside'
          ? ` · ${[...new Set(o.tests.filter((t) => t.outside && !t.outside.received).map((t) => t.outside.labName))].join(', ')}`
          : ''}
        {o.noteToLab ? ` · ${o.noteToLab}` : ''}
      </span>
    </li>
  );
}

export function DepartmentSelect({ value, onChange, id = 'lab-department' }) {
  return (
    <label className="lab-filter" htmlFor={id}>
      <span>Department</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All departments</option>
        {Object.entries(DEPARTMENTS).map(([k, w]) => (
          <option key={k} value={k}>
            {w}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LabWorklistPage() {
  const [params, setParams] = useSearchParams();
  const [walkIn, setWalkIn] = useState(false);
  // Receiving by scanning a label (the scanner types the number and presses Enter)
  const [scan, setScan] = useState('');
  const [scanNote, setScanNote] = useState(null);
  const receive = async (e) => {
    e.preventDefault();
    try {
      const { order } = await api('/lab/receive', { method: 'POST', body: { code: scan.trim() } });
      setScanNote({ ok: true, text: `Received: ${order.patient.fullName}, sample ${order.sampleNo}.` });
      setScan('');
      reload();
    } catch (err) {
      setScanNote({ ok: false, text: err.fields?.code ?? err.message });
    }
  };
  const list = LISTS.some((l) => l.key === params.get('list')) ? params.get('list') : 'collect';
  const department = params.get('department') && DEPARTMENTS[params.get('department')] ? params.get('department') : '';
  const { data, error, loading, reload } = useFetch('/lab/worklist', { list, ...(department ? { department } : {}) });
  const current = LISTS.find((l) => l.key === list);
  const count = (key) => (key === 'done' ? null : data?.counts?.[key]);
  // "Results to check" only where the hospital checks results (or something is still waiting for a check)
  const shown = LISTS.filter((l) => l.key !== 'verify' || data?.verify || data?.counts?.verify > 0 || list === 'verify');
  const go = (next) => {
    const p = { ...(next.list && next.list !== 'collect' ? { list: next.list } : {}), ...(next.department ? { department: next.department } : {}) };
    setParams(p, { replace: true });
  };

  return (
    <>
      <PageHeader tabs={HOSPITAL_LAB.tabs} title="Lab" help="Samples to take, results to enter and check, tests at outside labs and recent reports. Open an order to print its labels, enter its results or print the report." />
      <div className="pf-content">
        <div className="lab-toolbar">
          <div className="segmented lab-lists" aria-label="Lab lists">
            {shown.map((l) => (
              <button key={l.key} type="button" aria-pressed={l.key === list} onClick={() => go({ list: l.key, department })}>
                {l.label}
                {count(l.key) != null && <span className="tabular"> ({count(l.key)})</span>}
              </button>
            ))}
          </div>
          <DepartmentSelect value={department} onChange={(d) => go({ list, department: d })} />
          {data?.isLab && (
            <button type="button" className="btn btn-primary" onClick={() => setWalkIn(true)}>
              <Plus aria-hidden="true" /> Walk-in patient
            </button>
          )}
        </div>
        <Alert type="error">{error}</Alert>
        {list === 'receive' && data?.isLab && (
          <form className="card lab-scan" onSubmit={receive} noValidate>
            <label className="lab-filter" htmlFor="lab-scan">
              <span>
                <ScanBarcode aria-hidden="true" /> Scan or type the sample number on the label
              </span>
              <input id="lab-scan" value={scan} onChange={(e) => setScan(e.target.value)} autoFocus autoComplete="off" />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={!scan.trim()}>
              Receive
            </button>
            {scanNote && <Alert type={scanNote.ok ? 'success' : 'error'} onClose={() => setScanNote(null)}>{scanNote.text}</Alert>}
          </form>
        )}
        {loading && !data ? (
          <p className="muted">Loading…</p>
        ) : (
          <Section id="lab-list" collapsible={false} icon={current.icon} title={current.label} count={data?.list === list ? data.orders.length : 0} empty={current.empty}>
            <ul className="wl-list">
              {(data?.orders ?? []).map((o) => (
                <LabRow key={o.id} o={o} list={list} />
              ))}
            </ul>
          </Section>
        )}
      </div>
      {walkIn && <WalkInDialog onClose={() => setWalkIn(false)} />}
    </>
  );
}
