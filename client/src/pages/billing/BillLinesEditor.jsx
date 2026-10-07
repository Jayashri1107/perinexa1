// Lines for a bill: from the price list, or written in. value: [{ priceItemId, name, group, unitPrice, qty }].
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { priceListApi } from '../../api/index.js';
import { useAppConfig } from '../../context/AppConfigContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatMoney } from '../../utils/format.js';

const WRITE_IN = '__write_in__';
export const newLine = () => ({ priceItemId: '', name: '', group: '', unitPrice: '', qty: 1 });

export function BillLinesEditor({ value, onChange }) {
  const { billing } = useAppConfig();
  const { canAccess } = useAuth();
  const [items, setItems] = useState(null); // null while loading
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    priceListApi
      .options()
      .then((r) => setItems(r.items))
      .catch((err) => {
        setItems([]);
        setLoadError(err.message);
      });
  }, []);
  const list = items ?? [];

  const update = (i, patch) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const priceOf = (l) => (l.priceItemId && l.priceItemId !== WRITE_IN ? list.find((x) => x.id === l.priceItemId)?.price ?? 0 : Number(l.unitPrice) || 0);
  const total = value.reduce((n, l) => n + priceOf(l) * (Number(l.qty) || 0), 0);

  return (
    <div className="lines-editor">
      {items === null && <p className="field-help">Loading the price list…</p>}
      {loadError && <p className="field-error">The price list could not be loaded: {loadError}</p>}
      {items !== null && !loadError && list.length === 0 && (
        <p className="field-help">
          The price list has no items yet.{' '}
          {canAccess('billingAdmin') ? 'Add them in Billing → Price list.' : 'Ask the hospital admin to add them in Billing → Price list.'} Until then, choose
          "Something else" and write the item and its price in.
        </p>
      )}
      {value.map((l, i) => (
        <div key={i} className="line-row">
          <select aria-label={`Line ${i + 1}`} value={l.priceItemId} onChange={(e) => update(i, { priceItemId: e.target.value })}>
            <option value="">Choose from the price list…</option>
            {billing.priceGroups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {list.filter((x) => x.group === g.key).map((x) => (
                  <option key={x.id} value={x.id}>{x.name} – {x.price ? formatMoney(x.price) : 'price not set'}</option>
                ))}
              </optgroup>
            ))}
            <option value={WRITE_IN}>Something else (write it in)</option>
          </select>
          {l.priceItemId === WRITE_IN && (
            <>
              <input aria-label="Name" placeholder="Name" value={l.name} onChange={(e) => update(i, { name: e.target.value })} />
              <select aria-label="Group" value={l.group} onChange={(e) => update(i, { group: e.target.value })}>
                <option value="">Group…</option>
                {billing.priceGroups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
              <input aria-label="Price" type="number" min="0" placeholder="Price" value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
            </>
          )}
          <input aria-label="Quantity" className="qty" type="number" min="1" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
          {l.priceItemId && l.priceItemId !== WRITE_IN && (
            <span className="line-rate muted">{priceOf(l) ? `Rate ${formatMoney(priceOf(l))}` : 'Price not set'}</span>
          )}
          <span className="line-amount">{formatMoney(priceOf(l) * (Number(l.qty) || 0))}</span>
          <button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div className="line-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...value, newLine()])}>
          <Plus size={14} aria-hidden /> Line
        </button>
        <strong>{formatMoney(total)}</strong>
      </div>
    </div>
  );
}

// The lines as the server expects them.
export const toServerLines = (lines) =>
  lines
    .filter((l) => l.priceItemId)
    .map((l) =>
      l.priceItemId === WRITE_IN
        ? { name: l.name, group: l.group || undefined, unitPrice: l.unitPrice === '' ? undefined : Number(l.unitPrice), qty: Number(l.qty) }
        : { priceItemId: l.priceItemId, qty: Number(l.qty) },
    );
