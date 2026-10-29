import { useState } from 'react';
import { CircleAlert, CircleCheck, FileUp, Info, PackagePlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { expiryLabel } from './pharmacyFormat.js';
import { PharmacyHeader, money } from './pharmacyUi.jsx';
import { FIELD_LABELS, readStockFile } from './stockFile.js';

// Pharmacy → Stock → Import opening stock (29 Oct 2026): the stock already on the shelves, from the old pharmacy
// software's Excel file. The file is read in this browser; its lines are checked by the server (every problem listed,
// nothing saved), and Import brings them all in at once – or nothing while a line has a problem.

const SHOWN = 300; // lines listed without problems; every line with a problem is always listed

export function OpeningStockPage() {
  const [file, setFile] = useState(null); // { name, lines, columns }
  const [checked, setChecked] = useState(null); // the server's { lines, summary }
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const choose = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setChecked(null);
    setDone(null);
    setFile(null);
    setBusy(true);
    try {
      const read = await readStockFile(f);
      if (read.missing.length) throw new Error(`These columns were not found: ${read.missing.map((k) => FIELD_LABELS[k]).join(', ')}. The heading row should name them (for example ItemName, BatchNo, Exp_Date, Bal Qty, MRP, Rate).`);
      if (!read.lines.length) throw new Error('No stock lines were found under the heading row.');
      setFile({ name: f.name, lines: read.lines, columns: read.columns });
      setChecked(await api('/pharmacy/opening-stock/check', { method: 'POST', body: { lines: read.lines } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const bringIn = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api('/pharmacy/opening-stock', { method: 'POST', body: { lines: file.lines } });
      setDone(res.imported);
      setChecked(null);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const s = checked?.summary;
  const problemLines = checked ? checked.lines.filter((l) => l.problems.length) : [];
  const goodLines = checked ? checked.lines.filter((l) => !l.problems.length && !l.skip) : [];
  return (
    <>
      <PharmacyHeader title="Import opening stock" crumb="Stock" />
      <div className="pf-content bill-page">
        <Alert type="error">{error}</Alert>
        {done && (
          <Alert type="success">
            {done.batches} batches brought in ({done.units} units, {money(done.mrpValuePaise)} at MRP)
            {done.medicinesAdded ? `, with ${done.medicinesAdded} new medicines on the medicine list` : ''}. See them in <Link to="/pharmacy/stock">Stock</Link>; the Stock sheet there lists every batch.
          </Alert>
        )}
        <section className="card bill-section">
          <h2>Choose the stock file</h2>
          <p className="hint">
            The stock list from your old pharmacy software, saved as Excel (.xlsx) or CSV, one line per batch. Its heading row should name the item, batch, expiry and quantity, the MRP and the purchase rate (each per unit, or as the line&rsquo;s total value), and where the software has them, GST %, HSN, schedule, form and unit. The file stays on this computer: only its stock lines are checked.
          </p>
          <Field label="Stock file" id="os-file" hint="Nothing is saved until you press Import after checking.">
            <input id="os-file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={choose} disabled={busy} />
          </Field>
          {busy && <p className="muted">{checked ? 'Bringing in the stock…' : 'Reading and checking the file…'}</p>}
        </section>

        {checked && (
          <section className="card bill-section" aria-labelledby="os-check">
            <h2 id="os-check">Checked: {file.name}</h2>
            {s.importedBefore && (
              <Alert type="warning">Opening stock was already brought in on {formatDateTime(s.importedBefore)}. Importing again adds this stock a second time.</Alert>
            )}
            <ul className="os-summary">
              <li>
                <strong>{s.batches}</strong> batches to bring in · <strong>{s.units}</strong> units
              </li>
              <li>
                Value <strong>{money(s.mrpValuePaise)}</strong> at MRP · <strong>{money(s.costValuePaise)}</strong> at purchase rate
              </li>
              <li>
                <strong>{s.newMedicines}</strong> new medicines for the medicine list
              </li>
              {s.expired > 0 && <li>{s.expired} batches already expired (they come in to be written off or returned)</li>}
              {s.skipped > 0 && <li>{s.skipped} lines with no stock left out</li>}
            </ul>
            {s.problems ? (
              <Alert type="error">
                {s.problems} of {s.lines} lines have problems, listed below with their row in the file. Correct them in the file and choose it again: nothing is saved until every line is right.
              </Alert>
            ) : (
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={busy || !s.batches} onClick={bringIn}>
                  <PackagePlus aria-hidden="true" /> Import {s.batches} batches
                </button>
                <span className="muted">Check the totals against your old software&rsquo;s stock sheet first.</span>
              </div>
            )}

            {problemLines.length > 0 && <OpeningLines caption={`Lines with problems (${problemLines.length})`} lines={problemLines} />}
            {goodLines.length > 0 && (
              <OpeningLines caption={goodLines.length > SHOWN ? `Lines to bring in (the first ${SHOWN} of ${goodLines.length})` : `Lines to bring in (${goodLines.length})`} lines={goodLines.slice(0, SHOWN)} />
            )}
          </section>
        )}
        {!checked && !done && (
          <p className="hint">
            <FileUp aria-hidden="true" /> A new stock delivery after today goes in through Purchases, as usual.
          </p>
        )}
      </div>
    </>
  );
}

function OpeningLines({ caption, lines }) {
  return (
    <div className="os-scroll">
      <table className="bill-report os-lines">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Row</th>
            <th scope="col">Medicine</th>
            <th scope="col">Batch</th>
            <th scope="col">Expiry</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">MRP</th>
            <th scope="col" className="num">Rate</th>
            <th scope="col">Check</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.row}>
              <td className="num">{l.row}</td>
              <td>
                {l.name}
                {l.medicine.isNew && (
                  <span className="muted">
                    {' '}
                    · new: {l.medicine.form}, GST {l.medicine.gstRate} %{l.medicine.schedule ? `, ${l.medicine.schedule}` : ''}
                  </span>
                )}
              </td>
              <td>{l.batch}</td>
              <td>{l.expiry ? expiryLabel(`${l.expiry}-01`) : ''}</td>
              <td className="num">{l.qty ?? ''}</td>
              <td className="num">{Number.isInteger(l.mrpPaise) ? money(l.mrpPaise) : ''}</td>
              <td className="num">{Number.isInteger(l.ratePaise) ? money(l.ratePaise) : ''}</td>
              <td>
                {l.problems.map((p) => (
                  <StatusPill key={p} tone="high" icon={CircleAlert}>
                    {p}
                  </StatusPill>
                ))}
                {l.notes.map((n) => (
                  <span key={n} className="os-note">
                    <Info aria-hidden="true" /> {n}
                  </span>
                ))}
                {!l.problems.length && !l.notes.length && (
                  <StatusPill tone="stable" icon={CircleCheck}>
                    Ready
                  </StatusPill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
