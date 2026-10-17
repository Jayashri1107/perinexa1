import { useRef, useState } from 'react';
import { Baby, FlaskConical, Lightbulb, Plus, Siren, TriangleAlert, X } from 'lucide-react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, newRequestId } from '../../api.js';
import { DataTable } from '../../components/DataTable.jsx';
import { Alert, Field, StatusPill, formatDateTime, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { PCPNDT_MESSAGE, mentionsFetalSex } from '../../pcpndtWords.js';
import { WorkDoneSection } from './WorkDoneSection.jsx';
import { PatientScans } from '../imaging/ImagingPages.jsx';
import { FLAG_LOOK, dayOfLife, orderLook, packageFits, packageNames, packageWhen, resultLine, testsFor } from './labFormat.js';

// The Lab tab on the patient record (Version 2, lab module): every lab order, newest first, with its status and
// the results in one line; "Order tests" for the patient's doctor and RMOs. An order opens on its own page.
// A baby (newborn care) is offered only the baby tests, with ready-made packages by day of life; the mother's tests
// are on her own record.

/**
 * The hospital's test packages for this patient (Clinic library › Test packages): for a baby, those that fit today's
 * day of life first. Choosing one ticks its tests.
 */
function Packages({ packages, day, chosenPackages, onChoose }) {
  // Those that fit today first, packages for every baby before those for some babies, then by day.
  const sorted = [...packages].sort(
    (a, b) => Number(packageFits(b, day)) - Number(packageFits(a, day)) || Number(a.forWhom != null) - Number(b.forWhom != null) || a.fromDay - b.fromDay,
  );
  return (
    <fieldset className="fieldset lab-packages">
      <legend>Test packages{day != null ? ` – the baby is on day ${day} of life` : ''}</legend>
      <p className="hint help">A package ticks its tests below; untick any test that is not needed.</p>
      <ul className="plain-list lab-package-list">
        {sorted.map((p) => {
          const on = chosenPackages.includes(p.key);
          return (
            <li key={p.key} className="lab-package">
              <label className="check">
                <input type="checkbox" checked={on} onChange={() => onChoose(p)} />
                <span>
                  <strong>{p.name}</strong>{' '}
                  {packageFits(p, day) && (
                    <StatusPill tone="due" icon={Lightbulb}>
                      Fits today
                    </StatusPill>
                  )}{' '}
                  {p.status !== 'approved' && (
                    <StatusPill tone="watch" icon={TriangleAlert}>
                      Draft
                    </StatusPill>
                  )}
                  <span className="t-caption muted lab-package-sub">
                    {[packageWhen(p), p.forWhom || (p.who === 'newborn' ? 'Every baby' : ''), `${p.tests.length} test${p.tests.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function OrderDialog({ patient, catalogue, packages, onDone, onCancel }) {
  const [chosen, setChosen] = useState([]);
  const [chosenPackages, setChosenPackages] = useState([]);
  const who = testsFor(patient);
  const day = who === 'newborn' ? dayOfLife(patient.newborn?.birthAt) : null;
  // Choosing a package adds its tests; unchoosing removes the tests no other chosen package needs.
  const choosePackage = (p) => {
    if (chosenPackages.includes(p.key)) {
      const rest = packages.filter((x) => x.key !== p.key && chosenPackages.includes(x.key));
      const keep = new Set(rest.flatMap((x) => x.tests));
      setChosenPackages(chosenPackages.filter((k) => k !== p.key));
      setChosen(chosen.filter((k) => !p.tests.includes(k) || keep.has(k)));
    } else {
      setChosenPackages([...chosenPackages, p.key]);
      setChosen([...new Set([...chosen, ...p.tests])]);
    }
  };
  const [others, setOthers] = useState([]);
  const [other, setOther] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  const ref = useDialogFocus(onCancel);
  const pcpndt = patient.careType !== 'newborn';
  const toggle = (key) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const addOther = () => {
    const name = other.trim();
    if (name.length < 2) return;
    if (pcpndt && mentionsFetalSex(name)) return setError(PCPNDT_MESSAGE);
    if (!others.some((o) => o.toLowerCase() === name.toLowerCase())) setOthers([...others, name]);
    setOther('');
    return undefined;
  };
  const save = async (e) => {
    e.preventDefault();
    const extra = other.trim() ? [...others, other.trim()] : others;
    if (!chosen.length && !extra.length) return setError('Choose at least one test.');
    if (pcpndt && [note, ...extra].some((t) => mentionsFetalSex(t))) return setError(PCPNDT_MESSAGE);
    setSaving(true);
    setError(null);
    try {
      const tests = [...catalogue.tests.filter((t) => chosen.includes(t.key)).map((t) => ({ key: t.key })), ...extra.map((name) => ({ key: 'other', name }))];
      const res = await api(`/patients/${patient.id}/lab-orders`, { method: 'POST', body: { clientRequestId: requestId.current, tests, urgent, noteToLab: note.trim(), packages: chosenPackages } });
      onDone(res.order);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
    return undefined;
  };
  const offered = catalogue.tests.filter((t) => (t.who ?? 'adult') === who);
  const groups = Object.entries(catalogue.groups).map(([key, label]) => ({ key, label, tests: offered.filter((t) => t.group === key) })).filter((g) => g.tests.length);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <form ref={ref} tabIndex={-1} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="lab-order-dialog-title" onSubmit={save} noValidate>
        <h2 id="lab-order-dialog-title">Order tests for {patient.fullName}</h2>
        <Alert type="error">{error}</Alert>
        <div className="lab-choose">
          {packages.length > 0 && <Packages packages={packages} day={day} chosenPackages={chosenPackages} onChoose={choosePackage} />}
          {groups.map((g) => (
            <fieldset key={g.key} className="fieldset">
              <legend>{g.label}</legend>
              <div className="check-grid">
              {g.tests.map((t) => (
                <label key={t.key} className="check">
                  <input type="checkbox" checked={chosen.includes(t.key)} onChange={() => toggle(t.key)} /> {t.name}
                </label>
              ))}
              </div>
            </fieldset>
          ))}
        </div>
        <Field label="Another test (type its name)" id="lab-other">
          <span className="lab-value-row">
            <input
              id="lab-other"
              value={other}
              maxLength={150}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOther();
                }
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addOther}>
              <Plus aria-hidden="true" /> Add
            </button>
          </span>
        </Field>
        {others.length > 0 && (
          <ul className="plain-list">
            {others.map((o) => (
              <li key={o}>
                {o}{' '}
                <button type="button" className="btn btn-link btn-sm" aria-label={`Remove ${o}`} onClick={() => setOthers(others.filter((x) => x !== o))}>
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Note to the lab (optional)" id="lab-note-to-lab" hint="e.g. fasting sample, clinical question" keepHint>
          <input id="lab-note-to-lab" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent
        </label>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <FlaskConical aria-hidden="true" /> {saving ? 'Ordering…' : `Order ${chosen.length + others.length + (other.trim() ? 1 : 0) || ''} test${chosen.length + others.length + (other.trim() ? 1 : 0) === 1 ? '' : 's'}`}
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

export function PatientLabTab() {
  const { patient, reload: reloadPatient } = useOutletContext();
  const navigate = useNavigate();
  const canView = Boolean(patient.access?.canViewVisits);
  const { data, error, loading } = useFetch(canView ? `/patients/${patient.id}/lab-orders` : null);
  const catalogue = useFetch(canView ? '/lab/tests' : null);
  const packageList = useFetch(canView ? '/lab-packages' : null);
  // Packages in use, for this kind of patient (a package's tests are all of that kind)
  const packages = (packageList.data?.packages ?? []).filter((p) => p.isActive && p.who === testsFor(patient));
  const [ordering, setOrdering] = useState(false);
  if (!canView) return <div className="card">Lab results are not part of your role for this patient.</div>;

  const columns = [
    { key: 'ordered', header: 'Ordered', render: (o) => <span className="tabular">{formatDateTime(o.ordered.at)}</span> },
    {
      key: 'tests',
      header: 'Tests and results',
      className: 'wrap',
      render: (o) => (
        <div>
          {o.packages?.length > 0 && <div className="t-caption muted">Package: {packageNames(o.packages)}</div>}
          {o.tests.map((t, i) => {
            const line = ['reported', 'reviewed'].includes(o.status) ? resultLine(t, catalogue.data) : '';
            return (
              <div key={`${t.key}-${i}`}>
                <strong>{t.name}</strong>
                {line && <span className="muted"> – {line}</span>}
              </div>
            );
          })}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => {
        const look = orderLook(o);
        return (
          <span className="wl-counts">
            {o.urgent && o.status !== 'reviewed' && o.status !== 'cancelled' && (
              <StatusPill tone="high" icon={Siren}>
                Urgent
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
        );
      },
    },
  ];

  return (
    <div className="vs-tab">
      <Alert type="error">{error}</Alert>
      <section className="card vs-intro">
        <span className="vs-intro-icon" aria-hidden="true">
          <FlaskConical />
        </span>
        <div className="vs-intro-text">
          <h2>Lab tests</h2>
          <p className="hint help">
            {patient.careType === 'newborn'
              ? "The baby's tests, their results and the doctor's review. Order them one by one or as a package for the baby's day of life."
              : "Tests ordered for this patient, their results and the doctor's review. Reviewed results also tick off the care plan."}
          </p>
          {patient.careType === 'newborn' && patient.motherInfo && (
            <p className="hint">
              <Baby aria-hidden="true" className="inline-icon" /> The mother's tests are on her own record:{' '}
              <Link to={`/patients/${patient.motherInfo.id}/lab`}>
                {patient.motherInfo.fullName} ({patient.motherInfo.mrn}) – Lab
              </Link>
            </p>
          )}
        </div>
        {data?.canOrder && catalogue.data && (
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setOrdering(true)}>
              <FlaskConical aria-hidden="true" /> Order tests
            </button>
          </div>
        )}
      </section>
      <DataTable caption="Lab orders" columns={columns} rows={data?.orders} loading={loading} onRowClick={(o) => navigate(`/patients/${patient.id}/lab/${o.id}`)} emptyText="No lab tests ordered yet." />
      <PatientScans patient={patient} />
      <WorkDoneSection patient={patient} />
      {ordering && (
        <OrderDialog
          patient={patient}
          catalogue={catalogue.data}
          packages={packages}
          onCancel={() => setOrdering(false)}
          onDone={(order) => {
            setOrdering(false);
            reloadPatient();
            navigate(`/patients/${patient.id}/lab/${order.id}`);
          }}
        />
      )}
    </div>
  );
}
