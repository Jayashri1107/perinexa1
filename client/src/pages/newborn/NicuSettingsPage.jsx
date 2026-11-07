import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admin → NICU units (Build 13, NEO-A-01): the hospital's NICU units with their level of care (level II or
// level IIIA – only a level IIIA unit offers ventilation, TPN, exchange and central lines, PX-X-01) and admission floor
// (below it the transfer pathway is suggested, not blocked), which beds are NICU beds (unit, intensive or step-down,
// incubator, warmer or cot), and "one more admission" to a full unit (used once, within 2 hours). Names are typed
// here by the admin – never put in the code. No patient appears on this page. Read-only for anyone but the admin.

const keyFrom = (name, taken) => {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (base.length < 2) base = `unit${base ? `_${base}` : ''}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 27)}_${n}`;
  return key;
};

export function NicuSettingsPage() {
  const tabs = moduleByKey('hospital-admin')?.tabs;
  const { data, error, reload } = useFetch('/newborn-care/settings');
  const [units, setUnits] = useState(null);
  const [beds, setBeds] = useState(null);
  const [result, setResult] = useState(null);
  const [over, setOver] = useState({ unit: '', reason: '' });
  useEffect(() => {
    if (!data) return;
    setUnits(data.units.map((u) => ({ ...u, saved: true })));
    setBeds(Object.fromEntries(data.beds.map((b) => [b.id, b.nicu])));
  }, [data]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data || !units || !beds) return <p className="muted">Loading…</p>;
  const edit = data.access.edit;
  const setUnit = (i, ch) => setUnits(units.map((u, j) => (j === i ? { ...u, ...ch } : u)));
  const save = async () => {
    const taken = new Set(units.filter((u) => u.saved).map((u) => u.key));
    const list = units.map((u) => {
      if (u.saved) return u;
      const key = keyFrom(u.name, taken);
      taken.add(key);
      return { ...u, key };
    });
    try {
      await api('/newborn-care/settings', {
        method: 'PUT',
        body: {
          units: list.map(({ key, name, level, active, minGestationWeeks, minBirthWeightGrams }) => ({ key, name, level, active, minGestationWeeks: Number(minGestationWeeks), minBirthWeightGrams: Number(minBirthWeightGrams) })),
          beds: data.beds.map((b) => ({ bedId: b.id, nicu: beds[b.id] ?? null })),
        },
      });
      setResult({ text: 'Saved.' });
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  const allow = async (e) => {
    e.preventDefault();
    try {
      await api('/newborn-care/settings/override', { method: 'POST', body: over });
      setOver({ unit: '', reason: '' });
      setResult({ text: 'One more admission allowed for the next 2 hours.' });
      reload();
    } catch (err) {
      setResult({ error: err });
    }
  };
  const fe = (k) => result?.error?.fields?.[k];
  return (
    <>
      <PageHeader tabs={tabs} title="NICU units" subtitle="Each unit's level of care and admission floor, and which beds are NICU beds." />
      <div className="pf-content stack">
        <Alert type="error">{result?.error?.message}</Alert>
        {result?.text && (
          <Alert type="success" onClose={() => setResult(null)}>
            {result.text}
          </Alert>
        )}
        {!edit && <Alert type="info">Only the hospital admin changes these settings.</Alert>}
        <section className="card stack" aria-labelledby="ns-units">
          <h2 id="ns-units">Units</h2>
          {fe('units') && <p className="field-error">{fe('units')}</p>}
          {units.map((u, i) => (
            <div key={u.key ?? `new-${i}`} className="form-grid">
              <Field label="Name" id={`ns-name-${i}`} error={fe(`units.${i}.name`)}>
                <input id={`ns-name-${i}`} maxLength={60} value={u.name} disabled={!edit} onChange={(e) => setUnit(i, { name: e.target.value })} />
              </Field>
              <Field label="Level of care" id={`ns-level-${i}`} hint="Level IIIA: ventilation, TPN, exchange and central lines (PX-X-01)">
                <select id={`ns-level-${i}`} value={u.level} disabled={!edit} onChange={(e) => setUnit(i, { level: e.target.value })}>
                  {Object.entries(data.levels).map(([k, w]) => (
                    <option key={k} value={k}>
                      {w}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Admission floor – weeks" id={`ns-ga-${i}`} error={fe(`units.${i}.minGestationWeeks`)}>
                <input id={`ns-ga-${i}`} inputMode="numeric" value={u.minGestationWeeks} disabled={!edit} onChange={(e) => setUnit(i, { minGestationWeeks: e.target.value })} />
              </Field>
              <Field label="Admission floor – grams" id={`ns-g-${i}`} error={fe(`units.${i}.minBirthWeightGrams`)}>
                <input id={`ns-g-${i}`} inputMode="numeric" value={u.minBirthWeightGrams} disabled={!edit} onChange={(e) => setUnit(i, { minBirthWeightGrams: e.target.value })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={u.active} disabled={!edit} onChange={(e) => setUnit(i, { active: e.target.checked })} /> In use
              </label>
            </div>
          ))}
          {edit && (
            <button type="button" className="btn btn-link" onClick={() => setUnits([...units, { name: '', level: 'level_II', active: true, minGestationWeeks: data.floorDefaults.minGestationWeeks, minBirthWeightGrams: data.floorDefaults.minBirthWeightGrams, saved: false }])}>
              <Plus aria-hidden="true" /> Add a unit
            </button>
          )}
        </section>
        <section className="card stack" aria-labelledby="ns-beds">
          <h2 id="ns-beds">NICU beds</h2>
          <p className="hint">The beds come from Hospital admin → Beds. Mark which are NICU beds and in which unit. The nurse to baby rule (1:2) counts the intensive beds.</p>
          {!data.beds.length && <p className="muted">No beds yet: add them in Hospital admin → Beds first.</p>}
          {data.beds.map((b, i) => {
            const v = beds[b.id];
            const set = (ch) => setBeds({ ...beds, [b.id]: ch === null ? null : { unit: units[0]?.key, level: 'intensive', kind: 'incubator', ...(v ?? {}), ...ch } });
            return (
              <div key={b.id} className="form-grid">
                <Field label={`${b.ward} · ${b.name}`} id={`ns-bed-${b.id}`} error={fe(`beds.${i}.nicu.unit`)}>
                  <select id={`ns-bed-${b.id}`} value={v?.unit ?? ''} disabled={!edit} onChange={(e) => set(e.target.value ? { unit: e.target.value } : null)}>
                    <option value="">Not a NICU bed</option>
                    {units.filter((u) => u.saved).map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {v && (
                  <>
                    <Field label="Intensive or step-down" id={`ns-bl-${b.id}`}>
                      <select id={`ns-bl-${b.id}`} value={v.level} disabled={!edit} onChange={(e) => set({ level: e.target.value })}>
                        {Object.entries(data.bedLevels).map(([k, w]) => (
                          <option key={k} value={k}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Kind of bed" id={`ns-bk-${b.id}`}>
                      <select id={`ns-bk-${b.id}`} value={v.kind} disabled={!edit} onChange={(e) => set({ kind: e.target.value })}>
                        {Object.entries(data.bedKinds).map(([k, w]) => (
                          <option key={k} value={k}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}
              </div>
            );
          })}
          {edit && (
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={save}>
                <Save aria-hidden="true" /> Save units and beds
              </button>
            </div>
          )}
        </section>
        <section className="card stack" aria-labelledby="ns-over">
          <h2 id="ns-over">One more admission to a full unit</h2>
          <p className="hint">A full unit refuses an admission and suggests the transfer pathway (NEO-F-18). The hospital admin can allow one more admission: it is used once, within 2 hours, and the admission shows who allowed it and why.</p>
          {edit && (
            <form className="form-grid" onSubmit={allow}>
              <Field label="Unit" id="ns-ou" error={fe('unit')}>
                <select id="ns-ou" value={over.unit} onChange={(e) => setOver({ ...over, unit: e.target.value })}>
                  <option value="">Choose…</option>
                  {units.filter((u) => u.saved && u.active).map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Why" id="ns-or" error={fe('reason')}>
                <input id="ns-or" maxLength={300} value={over.reason} onChange={(e) => setOver({ ...over, reason: e.target.value })} />
              </Field>
              <div className="row">
                <button type="submit" className="btn btn-secondary">
                  Allow one more admission
                </button>
              </div>
            </form>
          )}
          <ul className="plain-list">
            {data.overrides.map((o) => (
              <li key={o.id} className="row">
                <StatusPill tone={o.open ? 'due' : 'inactive'}>{o.open ? 'Open' : o.usedAt ? 'Used' : 'Expired'}</StatusPill>
                {`${units.find((u) => u.key === o.unit)?.name ?? o.unit} · ${o.reason} · ${o.byName}, ${formatDateTime(o.at)}`}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
