import { useState } from 'react';
import { CircleSlash, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, useDebounced } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Modal, useSend } from './pharmacyUi.jsx';

// PH14 (docs/PHARMACY_BUILD_NOTE.md, owner's decision 4): kits – a named set of medicines and items with quantities
// (server/src/routes/pharmacyKits.js). A doctor or the hospital admin makes and changes them; the pharmacist reads
// them and fills an issue from one. Perinexa ships none. No prices here.

const medicineText = (m) => [m.name, m.strength].filter(Boolean).join(' ') + (m.kind === 'consumable' ? ' (item)' : '');

function FindForKit({ onPick }) {
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 250);
  const found = useFetch(term.length >= 2 ? '/pharmacy-kits/search' : null, { q: term });
  return (
    <div>
      <label htmlFor="kit-find">Add a medicine or item</label>
      <input id="kit-find" placeholder="Type at least 2 letters" value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="plain-list">
        {(found.data?.medicines ?? []).slice(0, 8).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="btn btn-link btn-sm"
              onClick={() => {
                onPick(m);
                setText('');
              }}
            >
              <Plus aria-hidden="true" /> {medicineText(m)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KitDialog({ kit, onClose, onDone }) {
  const [v, setV] = useState(() => ({ name: kit?.name ?? '', note: kit?.note ?? '', lines: (kit?.lines ?? []).map((l) => ({ medicine: l.medicine, qty: String(l.qty) })) }));
  const s = useSend((res) => onDone(res.kit));
  const add = (m) => setV((x) => (x.lines.some((l) => l.medicine.id === m.id) ? x : { ...x, lines: [...x.lines, { medicine: m, qty: '1' }] }));
  const save = (e) => {
    e.preventDefault();
    s.send(kit ? `/pharmacy-kits/${kit.id}` : '/pharmacy-kits', { name: v.name, note: v.note, active: true, lines: v.lines.map((l) => ({ medicineId: l.medicine.id, qty: Number.parseInt(l.qty, 10) || 0 })) }, kit ? 'PUT' : 'POST');
  };
  return (
    <Modal id="kit-dialog" title={kit ? `Change ${kit.name}` : 'New kit'} onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        <Alert type="error">{s.error}</Alert>
        <div className="form-grid">
          <Field label="Name" id="kit-name" error={s.fields.name}>
            <input id="kit-name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Note (optional)" id="kit-note" error={s.fields.note}>
            <input id="kit-note" value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
        </div>
        <h3>In the kit</h3>
        {s.fields.lines && <p className="field-error">{s.fields.lines}</p>}
        {!v.lines.length && <p className="muted">Nothing yet.</p>}
        <ul className="plain-list">
          {v.lines.map((l, i) => (
            <li key={l.medicine.id} className="kit-line">
              <span>{medicineText(l.medicine)}</span>
              <label className="sr-only" htmlFor={`kit-qty-${i}`}>
                Quantity of {l.medicine.name}
              </label>
              <input id={`kit-qty-${i}`} className="kit-qty" inputMode="numeric" value={l.qty} onChange={(e) => setV({ ...v, lines: v.lines.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)) })} />
              <span className="muted">{l.medicine.unit ?? ''}</span>
              <button type="button" className="icon-btn" aria-label={`Take ${l.medicine.name} out`} onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}>
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <FindForKit onPick={add} />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={s.busy}>
            {kit ? 'Save the kit' : 'Add the kit'}
          </button>
          <button type="button" className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function KitsPage({ tabs }) {
  const res = useFetch('/pharmacy-kits');
  const [editing, setEditing] = useState(null); // { kit } – kit null for a new one
  const [flash, setFlash] = useState(null);
  const stop = useSend(() => {
    setFlash('The kit is stopped.');
    res.reload();
  });
  const d = res.data;
  return (
    <>
      <PageHeader tabs={tabs} title="Kits" documentTitle="Kits" help="Named sets of medicines and items (a delivery kit, a caesarean kit). Made by a doctor or the hospital admin; the pharmacist issues from them." />
      <div className="pf-content lab-stack">
        <Alert type="success" onClose={() => setFlash(null)}>
          {flash}
        </Alert>
        <Alert type="error">{res.error ?? stop.error}</Alert>
        {d?.canEdit && (
          <p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ kit: null })}>
              <PackagePlus aria-hidden="true" /> New kit
            </button>
          </p>
        )}
        {d && !d.kits.length && <p className="muted">No kits yet. Perinexa ships none: a doctor or the hospital admin makes them.</p>}
        {(d?.kits ?? []).map((k) => (
          <section key={k.id} className="card">
            <h2>
              {k.name}{' '}
              {!k.active && (
                <StatusPill tone="inactive" icon={CircleSlash}>
                  Stopped
                </StatusPill>
              )}
            </h2>
            {k.note && <p className="hint">{k.note}</p>}
            <ul className="plain-list">
              {k.lines.map((l) => (
                <li key={l.medicine.id}>
                  {l.qty} × {medicineText(l.medicine)}
                  {!l.medicine.active && <span className="muted"> – no longer used</span>}
                  {'inStock' in l && l.inStock < l.qty && <span className="ph-warn"> In stock: {l.inStock}</span>}
                </li>
              ))}
            </ul>
            <p className="hint">{k.updatedByName ? `Last changed by ${k.updatedByName}.` : ''}</p>
            {d.canEdit && (
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing({ kit: k })}>
                  Change
                </button>
                {k.active ? (
                  <button type="button" className="btn btn-link btn-sm" disabled={stop.busy} onClick={() => stop.send(`/pharmacy-kits/${k.id}`, { name: k.name, note: k.note, active: false, lines: k.lines.map((l) => ({ medicineId: l.medicine.id, qty: l.qty })) }, 'PUT')}>
                    Stop using
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>
      {editing && (
        <KitDialog
          kit={editing.kit}
          onClose={() => setEditing(null)}
          onDone={(kit) => {
            setEditing(null);
            setFlash(`${kit.name} is saved.`);
            res.reload();
          }}
        />
      )}
    </>
  );
}

/** PH14: at the issue counter – fills the lines from a kit; says which lines are short (the pharmacist issues the rest). */
export function KitPicker({ onPick }) {
  const res = useFetch('/pharmacy-kits', { active: '1' });
  const kits = res.data?.kits ?? [];
  if (!kits.length) return null;
  return (
    <Field label="From a kit" id="ph-kit" keepHint hint="Fills the lines with the kit; change any quantity before saving.">
      <select
        id="ph-kit"
        value=""
        onChange={(e) => {
          const kit = kits.find((k) => k.id === e.target.value);
          if (kit) onPick(kit);
        }}
      >
        <option value="">Choose a kit…</option>
        {kits.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** What a kit leaves short or out (PURE): the lines with too little usable stock, and the medicines no longer used. */
export function kitShortfall(kit) {
  return {
    short: kit.lines.filter((l) => l.medicine.active !== false && (l.inStock ?? 0) < l.qty).map((l) => `${l.medicine.name} (${l.inStock ?? 0} of ${l.qty})`),
    stopped: kit.lines.filter((l) => l.medicine.active === false).map((l) => l.medicine.name),
  };
}
