import { useEffect, useRef, useState } from 'react';
import { PackageX, ScanBarcode, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, StatusPill, useDialogFocus } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { rupees } from '../billing/billingFormat.js';
import { buyingSections, cleanBarcode, isBarcode, medicineLabel, pharmacyTabs, scanQueue, scheduleLook } from './pharmacyFormat.js';

// Small pieces shared by the pharmacy pages: the header with the pharmacy's tabs, a dialog frame, sending a change,
// the schedule mark, finding a medicine on the stock list, and the "Scan or type a barcode" box.

/**
 * buying: the page belongs to the Purchases tab (purchases, orders, returns to a supplier) and shows its sections.
 * A pharmacist has the pharmacy's sections in the sidebar (owner, 26 Oct 2026), so no tabs; the admin keeps them.
 */
export function PharmacyHeader({ title, crumb, actions, subtitle, badges, buying = false }) {
  const { activeMembership } = useAuth();
  const pharmacist = activeMembership.roles.includes('pharmacist');
  return (
    <PageHeader
      breadcrumbs={[{ label: 'Pharmacy', to: pharmacist ? '/' : '/pharmacy/stock' }, ...(crumb ? [{ label: crumb }] : [])]}
      title={title}
      subtitle={subtitle}
      badges={badges}
      actions={actions}
      tabs={pharmacist ? undefined : pharmacyTabs(activeMembership.roles)}
      subtabs={buying ? buyingSections() : undefined}
    />
  );
}

export function Modal({ id, title, onClose, wide = false, children }) {
  const ref = useDialogFocus(onClose);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Sends a change; on success calls onDone(answer). Keeps the error and the fields the server named. */
export function useSend(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const send = async (path, body, method = 'POST') => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await api(path, { method, body });
      setBusy(false);
      onDone(res);
    } catch (err) {
      setError(err.message);
      setFields(err.fields ?? {});
      setBusy(false);
    }
  };
  return { busy, error, fields, send, setError };
}

export function ScheduleMark({ schedule }) {
  const look = scheduleLook(schedule);
  if (!look) return null;
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.label}
    </StatusPill>
  );
}

/** Find a medicine on the stock list (name or generic), with what is in stock. */
export function MedicineFinder({ onPick, label = 'Add a medicine', autoFocus = false }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const term = text.trim();
  useEffect(() => {
    if (term.length < 2) {
      setResult(null);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/pharmacy/medicines', { query: { search: term, active: '1' } });
        if (current) setResult({ medicines: res.medicines.slice(0, 10) });
      } catch (err) {
        if (current) setResult({ error: err.message });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);
  return (
    <div className="ph-finder">
      <label className="bill-search">
        <Search aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input type="search" placeholder={`${label}: brand or generic name`} value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} />
      </label>
      {result?.error && <p className="field-error">{result.error}</p>}
      {result?.medicines && (
        <ul className="appt-pick-list" aria-label="Medicines found">
          {!result.medicines.length && <li className="muted">Not on the stock list. Add it under Medicines first.</li>}
          {result.medicines.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="appt-pick"
                onClick={() => {
                  onPick(m);
                  setText('');
                }}
              >
                <strong>{medicineLabel(m)}</strong>
                <span className="muted">
                  {m.inStock} {m.unit}
                  {m.inStock === 1 ? '' : 's'} in stock · {m.gstRate}% GST{m.scheduleLabel && m.schedule ? ` · ${m.scheduleLabel}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Scan or type a barcode": finds the medicine that holds exactly this barcode and hands it to onPick. A barcode
 * scanner works like a keyboard – it types the digits and presses Enter – so the box only needs the cursor in it; a
 * person can type the number under the bars and press Enter (or Find) too. The cursor stays in the box for the next
 * scan. onPick(medicine) may answer with a sentence to show ("… added"), or { error } when the medicine cannot be used
 * here.
 * The next pack may be scanned before the last one was found: each scan empties the box at once and waits its turn
 * (scanQueue), so no pack is dropped and no two barcodes run together.
 */
export function BarcodeBox({ onPick, autoFocus = false }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null); // { ok, text }
  const input = useRef(null);
  // The page's own handler changes with every change of its list: a waiting scan is handed to the newest one
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  const [scans] = useState(() =>
    scanQueue({
      lookup: async (code) => (await api(`/pharmacy/barcode/${encodeURIComponent(code)}`)).medicine,
      onPick: (medicine) => pick.current(medicine),
      onSaid: setSaid,
      onBusy: setBusy,
    }),
  );
  const find = () => {
    const code = cleanBarcode(text);
    if (!code) return;
    if (!isBarcode(code)) {
      setSaid({ ok: false, text: 'A barcode has 4 to 32 digits or letters.' });
      return;
    }
    setText(''); // at once: the next scan may already be coming
    scans.add(code);
    input.current?.focus();
  };
  return (
    <div className="ph-barcode">
      <div className="ph-barcode-row">
        <label className="bill-search">
          <ScanBarcode aria-hidden="true" />
          <span className="sr-only">Scan or type a barcode</span>
          <input
            ref={input}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            placeholder="Scan or type a barcode"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                find();
              }
            }}
            autoFocus={autoFocus}
          />
        </label>
        <button type="button" className="btn btn-secondary" disabled={!text.trim()} onClick={find}>
          {busy ? 'Finding…' : 'Find'}
        </button>
      </div>
      <p className={said && !said.ok ? 'field-error' : 'hint'} role="status">
        {said ? said.text : 'Click in the box and scan the pack, or type the number under the bars and press Enter. Only the exact barcode is found.'}
      </p>
    </div>
  );
}

/** Finding a medicine for a list: by name on the left, by barcode on the right (under each other on a narrow screen). */
export function FindMedicine({ onPick, onScan, label = 'Add a medicine' }) {
  return (
    <div className="ph-find">
      <MedicineFinder label={label} onPick={onPick} />
      <BarcodeBox onPick={onScan} />
    </div>
  );
}

export const money = rupees;

/** The pharmacist's notice on the Today page: low stock and batches expiring soon or expired. */
export function PharmacyTodayNotice() {
  const res = useFetch('/pharmacy/reports/alerts');
  const a = res.data;
  if (!a || (!a.low.length && !a.expiring.length)) return null;
  const expired = a.expiring.filter((b) => b.expired).length;
  return (
    <Alert type="warning" icon={PackageX}>
      Pharmacy: {a.low.length} medicine{a.low.length === 1 ? '' : 's'} at or below the reorder level · {a.expiring.length - expired} batch
      {a.expiring.length - expired === 1 ? '' : 'es'} expiring within {a.days} days{expired ? ` · ${expired} expired` : ''}. <Link to="/pharmacy/reports">See the alerts</Link>
    </Alert>
  );
}
