import { useState } from 'react';
import { CircleAlert, CircleCheck, FileUp } from 'lucide-react';
import { api } from '../../api.js';
import { Alert, Field } from '../../components/ui.jsx';
import { medicineLabel } from './pharmacyFormat.js';
import { MedicineFinder, Modal } from './pharmacyUi.jsx';
import { BILL_FIELDS, BILL_LABELS, BILL_NEEDED, billHeadings, billLines, formLineFromBill, readSheetRows } from './stockFile.js';

// PH16 (docs/PHARMACY_BUILD_NOTE.md): the supplier's bill from its CSV or Excel file. Read in this browser; it only
// fills the purchase form – each line is still opened and checked, and saving goes through the usual purchase entry.
// The supplier's column headings and its item names matched to our medicines are remembered for its next bill. An item
// the list does not have is never added from the file: it is picked, or left out and added by hand.

export function BillFileDialog({ supplier, onClose, onFill }) {
  const [file, setFile] = useState(null); // { name, rows, index, headings }
  const [columns, setColumns] = useState({}); // field → column number (as text for the selects)
  const [items, setItems] = useState(null); // [{ name, medicine, how, picked, leaveOut }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const lines = file ? billLines(file.rows, file.index, Object.fromEntries(Object.entries(columns).filter(([, v]) => v !== '').map(([f, v]) => [f, Number(v)]))) : [];
  const missing = BILL_NEEDED.filter((f) => columns[f] === '' || columns[f] == null);

  const choose = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setError(null);
    setItems(null);
    try {
      const [rows, saved] = await Promise.all([readSheetRows(f), api(`/pharmacy/suppliers/${supplier.id}/bill-file`)]);
      const head = billHeadings(rows, saved.columns);
      if (!head) throw new Error('No heading row was found in the top 20 rows: it should name the item, batch, expiry and quantity.');
      setFile({ name: f.name, rows, index: head.index, headings: head.headings });
      setColumns(Object.fromEntries(BILL_FIELDS.map((k) => [k, k in head.columns ? String(head.columns[k]) : ''])));
    } catch (err) {
      setFile(null);
      setError(err.message);
    }
    setBusy(false);
  };

  const match = async () => {
    setBusy(true);
    setError(null);
    try {
      const names = [...new Set(lines.map((l) => l.name))];
      const res = await api(`/pharmacy/suppliers/${supplier.id}/bill-file/match`, { method: 'POST', body: { names } });
      setItems(res.matches.map((m) => ({ ...m, picked: false, leaveOut: false })));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const setItem = (name, change) => setItems((list) => list.map((x) => (x.name === name ? { ...x, ...change } : x)));
  const waiting = (items ?? []).filter((x) => !x.medicine && !x.leaveOut);

  const fill = async () => {
    setBusy(true);
    setError(null);
    try {
      const byName = new Map(items.map((x) => [x.name, x]));
      await api(`/pharmacy/suppliers/${supplier.id}/bill-file`, {
        method: 'PUT',
        body: {
          columns: Object.fromEntries(BILL_FIELDS.map((f) => [f, columns[f] === '' ? '' : (file.headings[Number(columns[f])] ?? '')])),
          items: items.filter((x) => x.picked && x.medicine).map((x) => ({ name: x.name, medicineId: x.medicine.id })),
        },
      });
      const out = lines.filter((l) => byName.get(l.name)?.medicine && !byName.get(l.name).leaveOut).map((l) => formLineFromBill(l, byName.get(l.name).medicine));
      onFill(out, lines.length - out.length);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal id="bill-file" title={`Bill from a file – ${supplier.name}`} onClose={onClose} wide>
      <p className="hint">The file is read on this computer. It fills the items of this purchase; open each line to check it before saving.</p>
      <Field label="The supplier’s bill (CSV or Excel .xlsx)" id="bf-file">
        <input id="bf-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={choose} disabled={busy} />
      </Field>
      <Alert type="error">{error}</Alert>
      {file && !items && (
        <>
          <h3>Which column holds what</h3>
          <p className="hint">Found from the headings and this supplier’s last file. Change any that is wrong; it is remembered for this supplier.</p>
          <div className="form-grid">
            {BILL_FIELDS.map((f) => (
              <Field key={f} label={`${BILL_LABELS[f]}${BILL_NEEDED.includes(f) ? '' : ' (if on the bill)'}`} id={`bf-col-${f}`}>
                <select id={`bf-col-${f}`} value={columns[f] ?? ''} onChange={(e) => setColumns({ ...columns, [f]: e.target.value })}>
                  <option value="">Not in the file</option>
                  {file.headings.map((h, i) =>
                    h ? (
                      <option key={`${h}-${i}`} value={String(i)}>
                        {h}
                      </option>
                    ) : null,
                  )}
                </select>
              </Field>
            ))}
          </div>
          <p className="muted">
            {lines.length} item line{lines.length === 1 ? '' : 's'} found in {file.name}.
          </p>
          {missing.length > 0 && <Alert type="warning">Choose the column for: {missing.map((f) => BILL_LABELS[f]).join(', ')}.</Alert>}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || missing.length > 0 || !lines.length} onClick={match}>
              {busy ? 'Matching…' : 'Match the items'}
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
      {items && (
        <>
          <h3>The items</h3>
          <p className="hint">Each of the supplier’s item names is matched to a medicine of the list. Pick the ones not found; they are remembered for this supplier. A medicine not on the list is added from Medicines first, or left out.</p>
          <ul className="bf-items">
            {items.map((x) => (
              <li key={x.name} className="bf-item">
                <span className="bf-name">{x.name}</span>
                {x.medicine ? (
                  <span className="bf-match">
                    <CircleCheck aria-hidden="true" className="bf-ok" /> {medicineLabel(x.medicine)}
                    <span className="muted"> · {x.picked ? 'picked now' : x.how === 'remembered' ? 'remembered' : 'same name'}</span>
                    <button type="button" className="btn btn-link" onClick={() => setItem(x.name, { medicine: null, picked: false })}>
                      Change
                    </button>
                  </span>
                ) : x.leaveOut ? (
                  <span className="bf-match muted">
                    Left out{' '}
                    <button type="button" className="btn btn-link" onClick={() => setItem(x.name, { leaveOut: false })}>
                      Pick a medicine
                    </button>
                  </span>
                ) : (
                  <span className="bf-match">
                    <span className="bf-warn">
                      <CircleAlert aria-hidden="true" /> Not matched
                    </span>
                    <MedicineFinder label={`Medicine for ${x.name}`} onPick={(m) => setItem(x.name, { medicine: m, picked: true })} />
                    <button type="button" className="btn btn-link" onClick={() => setItem(x.name, { leaveOut: true })}>
                      Leave it out
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || waiting.length > 0} onClick={fill}>
              <FileUp aria-hidden="true" /> {waiting.length ? `${waiting.length} item${waiting.length === 1 ? '' : 's'} still to match` : 'Fill the purchase'}
            </button>
            <button type="button" className="btn btn-link" onClick={() => setItems(null)}>
              Back to the columns
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
