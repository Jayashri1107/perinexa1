import { useState } from 'react';
import { BedDouble, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { DateText } from '../../components/DateText.jsx';
import { formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal } from './pharmacyUi.jsx';

/**
 * Patient Information, as on the pharmacy's earlier Sales Bill (13 Nov 2026): UHID with Search, and Patient name with a
 * drop-down of the matches while typing – OPD: every OPD patient by name or number (owner's approval of 9 Nov 2026),
 * IPD: those admitted now. Someone found who is admitted is billed as an issue to the ward (that page opens).
 * onPick(patient): { id, fullName, mrn, phone }.
 */
export function PatientInfoBox({ who, onPick }) {
  const navigate = useNavigate();
  const ipd = who === 'inpatient';
  const [uhid, setUhid] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false); // the Search patient window
  const term = name.trim();
  const inpatients = useFetch(ipd ? '/pharmacy/inpatients' : null);
  const people = useFetch(!ipd && term.length >= 2 ? '/pharmacy/invoices/people' : null, { type: 'opd', search: term });
  const lower = term.toLowerCase();
  const matches = ipd
    ? (inpatients.data?.inpatients ?? [])
        .filter((x) => !lower || [x.patient.fullName, x.patient.mrn, x.ward, x.bed].some((v) => v && String(v).toLowerCase().includes(lower)))
        .map((x) => ({ patient: x.patient, sub: [x.patient.mrn, x.ward, x.bed && `bed ${x.bed}`].filter(Boolean).join(' · ') }))
    : (people.data?.people ?? []).filter((x) => x.mrn).map((x) => ({ patient: { id: x.key, fullName: x.name, mrn: x.mrn }, sub: [x.mrn, x.billCount ? `${x.billCount} pharmacy bill${x.billCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') }));
  const choose = (patient, admitted = false) => {
    setOpen(false);
    if (!ipd && admitted) return navigate('/pharmacy/issue', { state: { patient } });
    return onPick(patient);
  };
  const search = async () => {
    const q = uhid.trim();
    // No UHID typed: the Search patient window, as on the earlier software
    if (!q) return setFinding(true);
    if (q.length < 3) return setMessage('Type the UHID (patient number), at least 3 characters.');
    setBusy(true);
    setMessage(null);
    try {
      const { patients } = await api('/pharmacy/register/find', { query: { q } });
      const exact = patients.find((p) => String(p.mrn).toLowerCase() === q.toLowerCase()) ?? (patients.length === 1 ? patients[0] : null);
      if (!exact) setMessage(patients.length ? 'More than one patient matches: type the full UHID, or pick from the name list.' : 'No patient with this UHID.');
      else if (ipd && !exact.admitted) setMessage(`${exact.fullName} is not admitted now: bill her as OPD.`);
      else choose({ id: exact.id, fullName: exact.fullName, mrn: exact.mrn, phone: exact.phone ?? '' }, exact.admitted);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  const showList = open && (ipd || term.length >= 2);
  return (
    <div className="ph-pi">
      <div className="ph-pi-row">
        <label htmlFor="ph-pi-uhid">UHID</label>
        <div className="ph-pi-uhid">
          <input
            id="ph-pi-uhid"
            value={uhid}
            maxLength={40}
            autoComplete="off"
            placeholder="Patient number"
            onChange={(e) => {
              setUhid(e.target.value);
              setMessage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={search}>
            <Search aria-hidden="true" /> {busy ? '…' : 'Search'}
          </button>
        </div>
      </div>
      <div className="ph-pi-row">
        <label htmlFor="ph-pi-name">Patient name</label>
        <div className="ph-pi-combo">
          <input
            id="ph-pi-name"
            role="combobox"
            aria-expanded={showList}
            aria-controls="ph-pi-list"
            aria-autocomplete="list"
            value={name}
            maxLength={100}
            autoComplete="off"
            placeholder={ipd ? 'Admitted patients – type to narrow' : 'Type 2 letters of the name or number'}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setName(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) {
                e.preventDefault();
                choose(matches[0].patient);
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {showList && (
            <ul id="ph-pi-list" className="ph-pi-list" role="listbox" aria-label={ipd ? 'Admitted patients' : 'OPD patients'}>
              {matches.slice(0, 30).map((m) => (
                <li key={m.patient.id} role="option" aria-selected="false">
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m.patient)}>
                    <strong>
                      {ipd && <BedDouble aria-hidden="true" />} {m.patient.fullName}
                    </strong>
                    <span>{m.sub}</span>
                  </button>
                </li>
              ))}
              {!matches.length && <li className="ph-pi-none">{(ipd ? inpatients.data : people.data) ? (ipd ? 'Nobody admitted matches.' : 'Nobody matches.') : 'Looking…'}</li>}
            </ul>
          )}
        </div>
      </div>
      {message && (
        <p className="field-error ph-pi-msg" role="status">
          {message}
        </p>
      )}
      {finding && (
        <FindPatientDialog
          ipd={ipd}
          onClose={() => setFinding(false)}
          onPick={(patient, type) => {
            setFinding(false);
            choose(patient, type === 'ipd');
          }}
        />
      )}
    </div>
  );
}

/**
 * Search patient, as the earlier software's window (13 Nov 2026): patient type OP or IP; the name in parts and the
 * mobile number; the UHID; the bills' dates from–to (ticked to use them); Show lists who matches, a click picks them.
 */
function FindPatientDialog({ ipd, onPick, onClose }) {
  const [type, setType] = useState(ipd ? 'ipd' : 'opd');
  const [f, setF] = useState({ first: '', middle: '', last: '', phone: '', mrn: '' });
  const [dateOn, setDateOn] = useState(false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState(null); // what Show asked for
  const res = useFetch(query ? '/pharmacy/invoices/people' : null, query ?? undefined);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const show = () => {
    const phone = f.phone.replace(/\D/g, '');
    setQuery({
      type,
      ...(f.first.trim() ? { first: f.first.trim() } : {}),
      ...(f.middle.trim() ? { middle: f.middle.trim() } : {}),
      ...(f.last.trim() ? { last: f.last.trim() } : {}),
      ...(phone.length >= 3 ? { phone } : {}),
      ...(f.mrn.trim() ? { mrn: f.mrn.trim() } : {}),
      ...(dateOn ? { from, to } : {}),
    });
  };
  const people = (res.data?.people ?? []).filter((x) => x.mrn);
  return (
    <Modal id="ph-find-patient" title="Search patient" onClose={onClose} wide>
      <div className="ph-fp">
        <form
          className="ph-fp-form"
          onSubmit={(e) => {
            e.preventDefault();
            show();
          }}
        >
          <div className="ph-fp-row">
            <span className="ph-fp-label">Patient type</span>
            <div className="segmented" role="group" aria-label="Patient type">
              <button type="button" aria-pressed={type === 'opd'} onClick={() => setType('opd')}>
                OP
              </button>
              <button type="button" aria-pressed={type === 'ipd'} onClick={() => setType('ipd')}>
                IP
              </button>
            </div>
          </div>
          <h3 className="ph-find-head">Patient name</h3>
          {[
            ['first', 'First name'],
            ['middle', 'Middle name'],
            ['last', 'Last name'],
            ['phone', 'Mob. no.'],
            ['mrn', 'UHID'],
          ].map(([k, label]) => (
            <label key={k} className="ph-fp-row">
              <span className="ph-fp-label">{label}</span>
              <input value={f[k]} maxLength={k === 'mrn' ? 40 : k === 'phone' ? 20 : 50} inputMode={k === 'phone' ? 'tel' : undefined} autoFocus={k === 'first'} onChange={set(k)} />
            </label>
          ))}
          <label className="ph-find-tick">
            <input type="checkbox" checked={dateOn} onChange={(e) => setDateOn(e.target.checked)} /> Date
          </label>
          <div className="ph-fp-row">
            <span className="ph-fp-label">From date</span>
            <DateText aria-label="From date" value={from} max={to} disabled={!dateOn} onChange={setFrom} />
          </div>
          <div className="ph-fp-row">
            <span className="ph-fp-label">To date</span>
            <DateText aria-label="To date" value={to} min={from} disabled={!dateOn} onChange={setTo} />
          </div>
          <button type="submit" className="btn btn-primary ph-fp-show">
            <Search aria-hidden="true" /> Show
          </button>
        </form>
        <div className="ph-fp-results">
          {!query && <p className="muted">Fill in what you know and press Show.</p>}
          {res.error && <p className="field-error">{res.error}</p>}
          {query && res.loading && <p className="muted">Looking…</p>}
          {query && res.data && (
            <table className="bill-report ph-fp-table">
              <thead>
                <tr>
                  <th scope="col">UHID</th>
                  <th scope="col">Patient name</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Last bill</th>
                </tr>
              </thead>
              <tbody>
                {people.map((x) => (
                  <tr key={x.key} className="ph-fp-pick" tabIndex={0} onClick={() => onPick({ id: x.key, fullName: x.name, mrn: x.mrn, phone: x.phone ?? '' }, x.type)} onKeyDown={(e) => e.key === 'Enter' && onPick({ id: x.key, fullName: x.name, mrn: x.mrn, phone: x.phone ?? '' }, x.type)}>
                    <td className="tabular">{x.mrn}</td>
                    <td>{x.name}</td>
                    <td className="tabular">{x.phone || '–'}</td>
                    <td>{x.lastAt ? formatDate(x.lastAt) : '–'}</td>
                  </tr>
                ))}
                {!people.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Nobody matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
