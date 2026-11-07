import { useEffect, useState } from 'react';
import { BedDouble, Building2, Plus, Save, ShieldPlus } from 'lucide-react';
import { api } from '../../api.js';
import { FullPageSpinner } from '../../auth/guards.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, FieldError, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { moduleByKey } from '../../platform/modules.js';

// Hospital admin → NICU units (Build 13, NEO-A-01): the hospital's NICU units with their level of care (level II or
// level IIIA – only a level IIIA unit offers ventilation, TPN, exchange and central lines, PX-X-01) and admission floor
// (below it the transfer pathway is suggested, not blocked), which beds are NICU beds (unit, intensive or step-down,
// incubator, warmer or cot), and "one more admission" to a full unit (used once, within 2 hours). Names are typed
// here by the admin – never put in the code. No patient appears on this page. Read-only for anyone but the admin.
// Laid out like the other Hospital admin settings (Referrals, Beds): the save button in the header, one card per part.

const keyFrom = (name, taken) => {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (base.length < 2) base = `unit${base ? `_${base}` : ''}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 27)}_${n}`;
  return key;
};
const wardsOf = (beds) => {
  const map = new Map();
  for (const b of beds) {
    const k = `${b.floor}|${b.ward}`;
    if (!map.has(k)) map.set(k, { key: k, ward: b.ward, floor: b.floor, beds: [] });
    map.get(k).beds.push(b);
  }
  return [...map.values()];
};

export function NicuSettingsPage() {
  const { data, error: loadError, reload } = useFetch('/newborn-care/settings');
  const [units, setUnits] = useState(null);
  const [beds, setBeds] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState({});
  const [over, setOver] = useState({ unit: '', reason: '' });
  useEffect(() => {
    if (!data) return;
    setUnits(data.units.map((u) => ({ ...u, saved: true })));
    setBeds(Object.fromEntries(data.beds.map((b) => [b.id, b.nicu])));
    setDirty(false);
  }, [data]);

  const edit = Boolean(data?.access?.edit);
  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Hospital admin', to: '/admin/staff' }, { label: 'NICU units' }]}
      title="NICU units"
      help="Each NICU unit's level of care and admission floor, which beds are NICU beds, and one more admission to a full unit. No patient is shown here."
      tabs={moduleByKey('hospital-admin')?.tabs}
      actions={
        edit &&
        units && (
          <button type="submit" form="nicu-settings" className="btn btn-primary" disabled={saving || !dirty}>
            <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save units and beds'}
          </button>
        )
      }
    />
  );
  if (loadError && !data) {
    return (
      <>
        {header}
        <div className="pf-content">
          <div className="card narrow load-error">
            <Alert type="error">{`Couldn't load the NICU units. ${loadError}`}</Alert>
          </div>
        </div>
      </>
    );
  }
  if (!data || !units || !beds) return <FullPageSpinner />;

  const change = (fn) => {
    fn();
    setDirty(true);
    setSaved(null);
  };
  const setUnit = (i, ch) => change(() => setUnits(units.map((u, j) => (j === i ? { ...u, ...ch } : u))));
  const setBed = (id, ch) => change(() => setBeds((all) => ({ ...all, [id]: ch === null ? null : { unit: units.find((u) => u.saved)?.key, level: 'intensive', kind: 'incubator', ...(all[id] ?? {}), ...ch } })));
  const savedUnits = units.filter((u) => u.saved);
  const bedCount = (key) => Object.values(beds).filter((v) => v?.unit === key).length;
  const err = (k) => fields[k];

  const save = async (e) => {
    e.preventDefault();
    if (!edit) return;
    const taken = new Set(savedUnits.map((u) => u.key));
    const list = units.map((u) => {
      if (u.saved) return u;
      const key = keyFrom(u.name, taken);
      taken.add(key);
      return { ...u, key };
    });
    setSaving(true);
    setError(null);
    setFields({});
    try {
      await api('/newborn-care/settings', {
        method: 'PUT',
        body: {
          units: list.map(({ key, name, level, active, minGestationWeeks, minBirthWeightGrams }) => ({ key, name, level, active, minGestationWeeks: Number(minGestationWeeks), minBirthWeightGrams: Number(minBirthWeightGrams) })),
          beds: data.beds.map((b) => ({ bedId: b.id, nicu: beds[b.id] ?? null })),
        },
      });
      setSaved('NICU units and beds saved.');
      reload();
    } catch (saveError) {
      setError(saveError.message);
      setFields(saveError.fields ?? {});
    } finally {
      setSaving(false);
    }
  };
  const allow = async () => {
    setError(null);
    setFields({});
    try {
      await api('/newborn-care/settings/override', { method: 'POST', body: over });
      setOver({ unit: '', reason: '' });
      setSaved('One more admission allowed for the next 2 hours.');
      reload();
    } catch (allowError) {
      setError(allowError.message);
      setFields(allowError.fields ?? {});
    }
  };

  return (
    <>
      {header}
      <form id="nicu-settings" className="pf-content appt-page nicu-settings" onSubmit={save} noValidate>
        <Alert type="success" onClose={() => setSaved(null)}>
          {saved}
        </Alert>
        {error && (
          <Alert type="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {!edit && <Alert type="info">Only the hospital admin changes these settings.</Alert>}

        {/* Units */}
        <section className="card appt-section" aria-labelledby="ns-units">
          <h2 id="ns-units">
            <Building2 aria-hidden="true" /> Units
          </h2>
          <p className="hint">Level IIIA units offer ventilation, TPN, exchange transfusion and central lines (PX-X-01); level II units do not, and a sick transfer in is shown as outside their capability. Below the admission floor the transfer pathway (NEO-F-18) is suggested and the consultant decides. A unit that has admissions stays on the list: untick In use instead.</p>
          <FieldError>{err('units')}</FieldError>
          <div className="an-table-wrap">
            <table className="ca-table nicu-units-table">
              <thead>
                <tr>
                  <th scope="col">Unit</th>
                  <th scope="col">Level of care</th>
                  <th scope="col" className="num">Floor – weeks</th>
                  <th scope="col" className="num">Floor – grams</th>
                  <th scope="col" className="num">NICU beds</th>
                  <th scope="col">In use</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => (
                  <tr key={u.saved ? u.key : `new-${i}`}>
                    <th scope="row">
                      {edit ? (
                        <input aria-label={`Unit ${i + 1}: name`} maxLength={60} value={u.name} placeholder="For example Garkheda" aria-invalid={err(`units.${i}.name`) ? true : undefined} onChange={(e) => setUnit(i, { name: e.target.value })} />
                      ) : (
                        u.name
                      )}
                      <FieldError>{err(`units.${i}.name`)}</FieldError>
                    </th>
                    <td data-label="Level of care">
                      {edit ? (
                        <select aria-label={`${u.name || `Unit ${i + 1}`}: level of care`} value={u.level} onChange={(e) => setUnit(i, { level: e.target.value })}>
                          {Object.entries(data.levels).map(([k, w]) => (
                            <option key={k} value={k}>
                              {w}
                            </option>
                          ))}
                        </select>
                      ) : (
                        data.levels[u.level]
                      )}
                    </td>
                    <td data-label="Floor – weeks" className="num">
                      {edit ? <input className="nicu-num" aria-label={`${u.name || `Unit ${i + 1}`}: floor in weeks`} inputMode="numeric" value={u.minGestationWeeks} onChange={(e) => setUnit(i, { minGestationWeeks: e.target.value })} /> : u.minGestationWeeks}
                      <FieldError>{err(`units.${i}.minGestationWeeks`)}</FieldError>
                    </td>
                    <td data-label="Floor – grams" className="num">
                      {edit ? <input className="nicu-num" aria-label={`${u.name || `Unit ${i + 1}`}: floor in grams`} inputMode="numeric" value={u.minBirthWeightGrams} onChange={(e) => setUnit(i, { minBirthWeightGrams: e.target.value })} /> : u.minBirthWeightGrams}
                      <FieldError>{err(`units.${i}.minBirthWeightGrams`)}</FieldError>
                    </td>
                    <td data-label="NICU beds" className="num">
                      {u.saved ? bedCount(u.key) : '–'}
                    </td>
                    <td>
                      <label className="check">
                        <input type="checkbox" checked={u.active} disabled={!edit} onChange={(e) => setUnit(i, { active: e.target.checked })} /> {u.active ? 'In use' : 'Not in use'}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edit && (
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => change(() => setUnits([...units, { name: '', level: 'level_II', active: true, minGestationWeeks: data.floorDefaults.minGestationWeeks, minBirthWeightGrams: data.floorDefaults.minBirthWeightGrams, saved: false }]))}>
                <Plus aria-hidden="true" /> Add a unit
              </button>
            </div>
          )}
          {units.some((u) => !u.saved) && <p className="hint">Save the new unit first; then its beds can be chosen below.</p>}
        </section>

        {/* Beds, by ward */}
        <section className="card appt-section" aria-labelledby="ns-beds">
          <h2 id="ns-beds">
            <BedDouble aria-hidden="true" /> NICU beds
          </h2>
          <p className="hint">The beds come from Hospital admin → Beds. Choose the unit of each NICU bed; the nurse to baby rule (1 nurse to 2 babies) counts the intensive beds. A bed with a baby in it stays in its unit until the baby leaves.</p>
          {!data.beds.length && <p className="muted">No beds yet. Add them in Hospital admin → Beds first.</p>}
          {wardsOf(data.beds).map((w) => {
            const inWard = w.beds.map((b) => beds[b.id]?.unit ?? '');
            const same = inWard.every((x) => x === inWard[0]) ? inWard[0] : 'mixed';
            return (
              <div key={w.key} className="nicu-ward">
                <div className="nicu-ward-head">
                  <h3>{w.floor ? `${w.ward} · ${w.floor}` : w.ward}</h3>
                  <span className="muted tabular">{`${w.beds.filter((b) => beds[b.id]).length} of ${w.beds.length} are NICU beds`}</span>
                  {edit && (
                    <label className="nicu-ward-all">
                      <span className="field-label">Whole ward</span>
                      <select
                        value={same}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'mixed') return;
                          change(() =>
                            setBeds((all) => {
                              const next = { ...all };
                              for (const b of w.beds) next[b.id] = v ? { level: 'intensive', kind: 'incubator', ...(all[b.id] ?? {}), unit: v } : null;
                              return next;
                            }),
                          );
                        }}
                      >
                        {same === 'mixed' && <option value="mixed">Mixed</option>}
                        <option value="">Not NICU beds</option>
                        {savedUnits.map((u) => (
                          <option key={u.key} value={u.key}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="an-table-wrap">
                  <table className="ca-table nicu-beds-table">
                    <thead>
                      <tr>
                        <th scope="col">Bed</th>
                        <th scope="col">NICU unit</th>
                        <th scope="col">Intensive or step-down</th>
                        <th scope="col">Kind of bed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.beds.map((b) => {
                        const v = beds[b.id];
                        const i = data.beds.findIndex((x) => x.id === b.id);
                        return (
                          <tr key={b.id}>
                            <th scope="row">
                              {b.name}
                              <FieldError>{err(`beds.${i}.nicu.unit`)}</FieldError>
                            </th>
                            <td data-label="NICU unit">
                              {edit ? (
                                <select aria-label={`${b.name}: NICU unit`} value={v?.unit ?? ''} onChange={(e) => setBed(b.id, e.target.value ? { unit: e.target.value } : null)}>
                                  <option value="">Not a NICU bed</option>
                                  {savedUnits.map((u) => (
                                    <option key={u.key} value={u.key}>
                                      {u.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                (savedUnits.find((u) => u.key === v?.unit)?.name ?? 'Not a NICU bed')
                              )}
                            </td>
                            <td data-label="Intensive or step-down">
                              {v ? (
                                edit ? (
                                  <select aria-label={`${b.name}: intensive or step-down`} value={v.level} onChange={(e) => setBed(b.id, { level: e.target.value })}>
                                    {Object.entries(data.bedLevels).map(([k, x]) => (
                                      <option key={k} value={k}>
                                        {x}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  data.bedLevels[v.level]
                                )
                              ) : (
                                <span className="muted">–</span>
                              )}
                            </td>
                            <td data-label="Kind of bed">
                              {v ? (
                                edit ? (
                                  <select aria-label={`${b.name}: kind of bed`} value={v.kind} onChange={(e) => setBed(b.id, { kind: e.target.value })}>
                                    {Object.entries(data.bedKinds).map(([k, x]) => (
                                      <option key={k} value={k}>
                                        {x}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  data.bedKinds[v.kind]
                                )
                              ) : (
                                <span className="muted">–</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>

        {/* One more admission to a full unit */}
        <section className="card appt-section" aria-labelledby="ns-over">
          <h2 id="ns-over">
            <ShieldPlus aria-hidden="true" /> One more admission to a full unit
          </h2>
          <p className="hint">A full unit refuses an admission and suggests the transfer pathway (NEO-F-18). You can allow one more admission: it is used once, within 2 hours, and the admission shows who allowed it and why.</p>
          {edit && (
            <div className="opd-leave">
              <label>
                <span className="field-label">Unit</span>
                <select value={over.unit} aria-invalid={err('unit') ? true : undefined} onChange={(e) => setOver({ ...over, unit: e.target.value })}>
                  <option value="">Choose…</option>
                  {savedUnits
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.key} value={u.key}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="opd-leave-note">
                <span className="field-label">Why</span>
                <input maxLength={300} value={over.reason} placeholder="For example: twin of a baby in the unit" aria-invalid={err('reason') ? true : undefined} onChange={(e) => setOver({ ...over, reason: e.target.value })} />
              </label>
              <button type="button" className="btn btn-secondary" onClick={allow} disabled={!over.unit || over.reason.trim().length < 5}>
                Allow one more admission
              </button>
            </div>
          )}
          <FieldError>{err('unit') ?? err('reason')}</FieldError>
          {data.overrides.length > 0 ? (
            <ul className="opd-leave-list">
              {data.overrides.map((o) => (
                <li key={o.id} className="row">
                  <StatusPill tone={o.open ? 'due' : 'inactive'}>{o.open ? 'Open' : o.usedAt ? 'Used' : 'Expired'}</StatusPill>
                  <span>{`${savedUnits.find((u) => u.key === o.unit)?.name ?? o.unit} · ${o.reason}`}</span>
                  <span className="muted">{`${o.byName}, ${formatDateTime(o.at)}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None allowed yet.</p>
          )}
        </section>
      </form>
    </>
  );
}
