import { useState } from 'react';
import { ArrowLeftRight, CircleAlert, CircleCheck, ClipboardCheck, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime, useDebounced } from '../../components/ui.jsx';
import { WitnessFields, emptyWitness } from '../../components/WitnessFields.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal, useSend } from './pharmacyUi.jsx';

// PH13 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 4): places that hold stock outside the pharmacy
// (server/src/routes/stockPlaces.js). A doctor or the hospital admin makes the places and names their staff; the
// pharmacist moves stock there and back; the staff and the pharmacist check a place; the staff use its stock for an
// admitted patient (an issue on her bill, names and quantities only). Perinexa ships no places.

const KIND_WORDS = { labour_room: 'Labour room', theatre: 'Theatre', ward: 'Ward', tray: 'Emergency tray', other: 'Other' };
const CONTROLLED = ['X', 'narcotic'];
const witnessOk = (w) => w.email.trim().length >= 3 && w.password.length >= 1;

function PlaceDialog({ place, kinds, onClose, onDone }) {
  const staff = useFetch('/stock-places/staff').data?.staff ?? [];
  const [v, setV] = useState({ name: place?.name ?? '', kind: place?.kind ?? 'other', checkEveryDays: String(place?.checkEveryDays ?? 7), staffIds: (place?.staff ?? []).map((x) => x.id), active: place?.active ?? true });
  const s = useSend((res) => onDone(res.place));
  const toggle = (id) => setV({ ...v, staffIds: v.staffIds.includes(id) ? v.staffIds.filter((x) => x !== id) : [...v.staffIds, id] });
  return (
    <Modal id="place-dialog" title={place ? `Change ${place.name}` : 'New place that holds stock'} onClose={onClose} wide>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Name" id="pl-name" error={s.fields.name}>
          <input id="pl-name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Kind" id="pl-kind">
          <select id="pl-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_WORDS[k] ?? k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Check every (days)" id="pl-every" error={s.fields.checkEveryDays}>
          <input id="pl-every" inputMode="numeric" value={v.checkEveryDays} onChange={(e) => setV({ ...v, checkEveryDays: e.target.value })} />
        </Field>
      </div>
      <fieldset className="fieldset">
        <legend>Staff of this place (they check it and use its stock for their patients)</legend>
        {s.fields.staffIds && <p className="field-error">{s.fields.staffIds}</p>}
        <div className="pl-staff">
          {staff.map((x) => (
            <label key={x.id} className="checkbox">
              <input type="checkbox" checked={v.staffIds.includes(x.id)} onChange={() => toggle(x.id)} /> {x.name} <span className="muted">({x.roles})</span>
            </label>
          ))}
        </div>
      </fieldset>
      {place && (
        <label className="checkbox">
          <input type="checkbox" checked={!v.active} onChange={(e) => setV({ ...v, active: !e.target.checked })} /> No longer used (only once its stock is back in the pharmacy)
        </label>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy} onClick={() => s.send(place ? `/stock-places/${place.id}` : '/stock-places', { ...v, checkEveryDays: Number.parseInt(v.checkEveryDays, 10) || 7 }, place ? 'PUT' : 'POST')}>
          {place ? 'Save the place' : 'Add the place'}
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The pharmacist: a pharmacy batch of a medicine to move to the place. */
function MoveInDialog({ place, onClose, onDone }) {
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 250);
  const found = useFetch(term.length >= 2 ? '/pharmacy/medicines' : null, { search: term, active: '1' });
  const [med, setMed] = useState(null);
  const detail = useFetch(med ? `/pharmacy/stock/${med.id}` : null);
  const [batchId, setBatchId] = useState('');
  const [qty, setQty] = useState('');
  const [witness, setWitness] = useState(emptyWitness);
  const s = useSend((res) => onDone(`${res.moved.qty} of ${res.moved.name} (batch ${res.moved.batch}) moved to ${res.moved.to}.`));
  const batches = (detail.data?.batches ?? []).filter((b) => !b.place && b.qtyLeft > 0 && !b.expired && !b.hold);
  const controlled = med && CONTROLLED.includes(med.schedule);
  return (
    <Modal id="move-in" title={`Move stock to ${place.name}`} onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      {!med ? (
        <>
          <Field label="Medicine or item" id="mi-find">
            <input id="mi-find" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type at least 2 letters" />
          </Field>
          <ul className="plain-list">
            {(found.data?.medicines ?? []).slice(0, 8).map((m) => (
              <li key={m.id}>
                <button type="button" className="btn btn-link btn-sm" onClick={() => setMed(m)}>
                  {m.name} {m.strength ?? ''} <span className="muted">· in stock {m.inStock ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>
            <strong>{med.name}</strong>{' '}
            <button type="button" className="btn btn-link btn-sm" onClick={() => setMed(null)}>
              Change
            </button>
          </p>
          <Field label="Batch in the pharmacy" id="mi-batch">
            <select id="mi-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Choose…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batch} · expiry {b.expiry.slice(0, 7)} · {b.qtyLeft} left
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" id="mi-qty" error={s.fields.qty}>
            <input id="mi-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          {controlled && <WitnessFields id="mi-wit" value={witness} onChange={setWitness} errors={s.fields} what="Moving a narcotic or Schedule X medicine" />}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={s.busy || !batchId || !(Number(qty) > 0) || (controlled && !witnessOk(witness))} onClick={() => s.send(`/stock-places/${place.id}/move-in`, { batchId, qty: Number.parseInt(qty, 10), witness: controlled ? witness : '' })}>
              <ArrowLeftRight aria-hidden="true" /> Move
            </button>
            <button type="button" className="btn btn-link" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function MoveOutDialog({ place, row, onClose, onDone }) {
  const [qty, setQty] = useState(String(row.qty));
  const [witness, setWitness] = useState(emptyWitness);
  const controlled = CONTROLLED.includes(row.schedule);
  const s = useSend((res) => onDone(`${res.moved.qty} of ${res.moved.name} back in the pharmacy.`));
  return (
    <Modal id="move-out" title={`Back to the pharmacy: ${row.name}, batch ${row.batch}`} onClose={onClose}>
      <Alert type="error">{s.error}</Alert>
      <Field label={`Quantity (at most ${row.qty})`} id="mo-qty">
        <input id="mo-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      {controlled && <WitnessFields id="mo-wit" value={witness} onChange={setWitness} errors={s.fields} what="Moving a narcotic or Schedule X medicine" />}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy || !(Number(qty) > 0) || (controlled && !witnessOk(witness))} onClick={() => s.send(`/stock-places/${place.id}/move-out`, { batchId: row.batchId, qty: Number.parseInt(qty, 10), witness: controlled ? witness : '' })}>
          Move back
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CheckDialog({ place, stock, onClose, onDone }) {
  const [found, setFound] = useState(() => Object.fromEntries(stock.map((r) => [r.batchId, String(r.qty)])));
  const [note, setNote] = useState('');
  const [witness, setWitness] = useState(emptyWitness);
  const differs = (r) => Number(found[r.batchId]) !== r.qty || r.expired;
  const controlled = stock.some((r) => CONTROLLED.includes(r.schedule) && differs(r));
  const s = useSend((res) => onDone(`Checked: ${res.check.differences} different, ${res.check.expiredOut} expired taken out.`));
  return (
    <Modal id="check-place" title={`Check ${place.name}`} onClose={onClose} wide>
      <p className="hint">Count each batch on the shelf. A different count corrects the stock; expired stock is taken out (written off).</p>
      <Alert type="error">{s.error}</Alert>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Batch</th>
            <th scope="col" className="num">
              Expected
            </th>
            <th scope="col" className="num">
              Found
            </th>
          </tr>
        </thead>
        <tbody>
          {stock.map((r) => (
            <tr key={r.batchId}>
              <td>
                {r.name} {r.expired && <StatusPill tone="high">Expired – taken out</StatusPill>}
              </td>
              <td>{r.batch}</td>
              <td className="num">{r.qty}</td>
              <td className="num">
                <label className="sr-only" htmlFor={`ck-${r.batchId}`}>
                  Found of {r.name}
                </label>
                <input id={`ck-${r.batchId}`} className="kit-qty" inputMode="numeric" value={found[r.batchId]} onChange={(e) => setFound({ ...found, [r.batchId]: e.target.value })} />
              </td>
            </tr>
          ))}
          {!stock.length && (
            <tr>
              <td colSpan={4} className="muted">
                Nothing is kept here now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Field label="Note (optional)" id="ck-note">
        <input id="ck-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {controlled && <WitnessFields id="ck-wit" value={witness} onChange={setWitness} errors={s.fields} what="A narcotic or Schedule X count that differs" />}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy || (controlled && !witnessOk(witness))} onClick={() => s.send(`/stock-places/${place.id}/checks`, { lines: stock.map((r) => ({ batchId: r.batchId, found: Number.parseInt(found[r.batchId], 10) || 0 })), note, witness: controlled ? witness : '' })}>
          <ClipboardCheck aria-hidden="true" /> Save the check
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function UseDialog({ place, stock, onClose, onDone }) {
  const who = useFetch(`/stock-places/${place.id}/patients`).data;
  const [patientId, setPatientId] = useState('');
  const [orderedById, setOrderedById] = useState('');
  const [lines, setLines] = useState([]); // { row, qty }
  const usable = stock.filter((r) => !r.expired && !r.hold && r.qty > 0);
  const s = useSend((res) => onDone(`${res.used.number}: ${res.used.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')} from ${res.used.place}, on her bill.`));
  return (
    <Modal id="use-place" title={`Use stock of ${place.name} for a patient`} onClose={onClose} wide>
      <p className="hint">For an admitted patient you look after. It goes on her bill like a pharmacy issue.</p>
      <Alert type="error">{s.error}</Alert>
      <div className="form-grid">
        <Field label="Patient" id="use-pt" error={s.fields.patientId}>
          <select id="use-pt" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">Choose…</option>
            {(who?.patients ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.fullName} ({x.mrn}){x.ward ? ` · ${x.ward}` : ''}
                {x.bed ? `, bed ${x.bed}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ordered by" id="use-doc" error={s.fields.orderedById}>
          <select id="use-doc" value={orderedById} onChange={(e) => setOrderedById(e.target.value)}>
            <option value="">Choose the doctor…</option>
            {(who?.doctors ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ul className="plain-list">
        {usable.map((r) => (
          <li key={r.batchId}>
            <button type="button" className="btn btn-link btn-sm" disabled={lines.some((l) => l.row.batchId === r.batchId)} onClick={() => setLines([...lines, { row: r, qty: '1' }])}>
              <Plus aria-hidden="true" /> {r.name} · batch {r.batch} · {r.qty} here
            </button>
          </li>
        ))}
      </ul>
      {lines.map((l, i) => (
        <div key={l.row.batchId} className="kit-line">
          <span>
            {l.row.name} · batch {l.row.batch}
          </span>
          <label className="sr-only" htmlFor={`use-qty-${i}`}>
            Quantity of {l.row.name}
          </label>
          <input id={`use-qty-${i}`} className="kit-qty" inputMode="numeric" value={l.qty} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
          <button type="button" className="icon-btn" aria-label={`Take ${l.row.name} out`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={s.busy || !patientId || !orderedById || !lines.length} onClick={() => s.send(`/stock-places/${place.id}/use`, { patientId, orderedById, lines: lines.map((l) => ({ medicineId: l.row.medicineId, batchId: l.row.batchId, qty: Number.parseInt(l.qty, 10) || 0 })) })}>
          Use for her
        </button>
        <button type="button" className="btn btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function PlaceDetail({ id, onChanged }) {
  const res = useFetch(`/stock-places/${id}`);
  const [dialog, setDialog] = useState(null);
  const [flash, setFlash] = useState(null);
  const d = res.data;
  if (res.error) return <Alert type="error">{res.error}</Alert>;
  if (!d) return <p className="muted">Loading…</p>;
  const done = (text) => {
    setDialog(null);
    setFlash(text);
    res.reload();
    onChanged();
  };
  return (
    <section className="card" aria-labelledby="pl-detail">
      <h2 id="pl-detail">{d.place.name}</h2>
      <Alert type="success" onClose={() => setFlash(null)}>
        {flash}
      </Alert>
      <div className="row">
        {d.can.use && (
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'use' })}>
            Use for a patient
          </button>
        )}
        {d.can.move && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'in' })}>
            <PackagePlus aria-hidden="true" /> Move stock here
          </button>
        )}
        {d.can.check && (
          <button type="button" className="btn btn-secondary" onClick={() => setDialog({ kind: 'check' })}>
            <ClipboardCheck aria-hidden="true" /> Check this place
          </button>
        )}
      </div>
      <table className="bill-report">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Batch</th>
            <th scope="col">Expiry</th>
            <th scope="col" className="num">
              Here
            </th>
            {d.can.move && <th scope="col">Pharmacy</th>}
          </tr>
        </thead>
        <tbody>
          {d.stock.map((r) => (
            <tr key={r.batchId}>
              <td>
                {r.name} {r.hold && <StatusPill tone="high">On hold</StatusPill>}
              </td>
              <td>{r.batch}</td>
              <td>
                {r.expiry.slice(5)}/{r.expiry.slice(0, 4)}{' '}
                {r.expired && (
                  <StatusPill tone="high" icon={CircleAlert}>
                    Expired
                  </StatusPill>
                )}
              </td>
              <td className="num">
                {r.qty} {r.unit}
              </td>
              {d.can.move && (
                <td>
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setDialog({ kind: 'out', row: r })}>
                    Back to pharmacy
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!d.stock.length && (
            <tr>
              <td colSpan={5} className="muted">
                Nothing is kept here now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <h3>Checks</h3>
      {!d.checks.length ? (
        <p className="muted">Not checked yet.</p>
      ) : (
        <ul className="plain-list">
          {d.checks.map((c, i) => (
            <li key={i}>
              {formatDateTime(c.at)} · {c.byName} · {c.differences} different · {c.expiredOut} expired taken out{c.witness ? ` · witness ${c.witness}` : ''}
              {c.note ? ` · ${c.note}` : ''}
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'in' && <MoveInDialog place={d.place} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'out' && <MoveOutDialog place={d.place} row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'check' && <CheckDialog place={d.place} stock={d.stock} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'use' && <UseDialog place={d.place} stock={d.stock} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  );
}

export function StockPlacesPage({ tabs }) {
  const res = useFetch('/stock-places');
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null); // { place } – null place for a new one
  const d = res.data;
  return (
    <>
      <PageHeader tabs={tabs} title="Stock places" documentTitle="Stock places" help="Stock kept outside the pharmacy – labour room, theatre, wards, emergency trays – with their checks." />
      <div className="pf-content lab-stack">
        <Alert type="error">{res.error}</Alert>
        {d?.canEdit && (
          <p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ place: null })}>
              <Plus aria-hidden="true" /> New place
            </button>
          </p>
        )}
        {d && !d.places.length && <p className="muted">{d.canEdit || d.canMove ? 'No places yet. Perinexa ships none: a doctor or the hospital admin adds them.' : 'You are not on the staff of any place.'}</p>}
        <ul className="plain-list">
          {(d?.places ?? []).map((p) => (
            <li key={p.id} className="mm-row">
              <strong>{p.name}</strong> <span className="muted">· {KIND_WORDS[p.kind] ?? p.kind}</span>{' '}
              {!p.active ? (
                <StatusPill tone="inactive">No longer used</StatusPill>
              ) : p.checkOverdue ? (
                <StatusPill tone="watch" icon={CircleAlert}>
                  Check due
                </StatusPill>
              ) : (
                <StatusPill tone="stable" icon={CircleCheck}>
                  Checked
                </StatusPill>
              )}
              <p className="hint">
                {p.lastCheck ? `Last checked ${formatDateTime(p.lastCheck.at)} by ${p.lastCheck.byName}` : 'Not checked yet'} · every {p.checkEveryDays} days · staff: {p.staff.map((x) => x.name).join(', ') || 'none named'}
              </p>
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? 'Close' : 'Open'}
                </button>
                {d.canEdit && (
                  <button type="button" className="btn btn-link btn-sm" onClick={() => setEditing({ place: p })}>
                    Change
                  </button>
                )}
              </div>
              {open === p.id && <PlaceDetail id={p.id} onChanged={res.reload} />}
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <PlaceDialog
          place={editing.place}
          kinds={d?.kinds ?? Object.keys(KIND_WORDS)}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            res.reload();
          }}
        />
      )}
    </>
  );
}
