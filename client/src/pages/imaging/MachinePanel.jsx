import { useState } from 'react';
import { Check, CircleAlert, Link2, MonitorDown, TableProperties } from 'lucide-react';
import { api } from '../../api.js';
import { ApiImage } from '../../components/ApiImage.jsx';
import { Alert, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { USE_WORDS, startChoices, usedValue, usesFor } from './machineTable.js';

// From the ultrasound machine (docs/USG_MACHINE_PLAN.md): what the machine sent through the hospital's scan bridge for
// this patient – its pictures to choose for the report, and its readings as the average table (each reading with a
// tick, the rule used, the value) to put in the report. The server works the values out again from the readings it
// keeps. PCPNDT: whoever adds pictures confirms they do not show the baby's sex; the readings never hold it.

export const machineImageUrl = (studyId, imageId) => `/imaging/machine/${studyId}/images/${imageId}`;
const MATCHED_WORDS = { worklist: 'from the worklist', number: 'by her patient number', hand: 'linked by hand' };

export function MachinePictures({ s, m, onSaved, onError }) {
  const [chosen, setChosen] = useState(() => new Set());
  const [noSex, setNoSex] = useState(false);
  const [busy, setBusy] = useState(false);
  const can = s.access.canImages;
  if (!m.images.length) return <p className="muted">No still pictures in this study.</p>;
  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  const add = async () => {
    setBusy(true);
    try {
      const res = await api(`/imaging/${s.id}/machine/${m.id}/pictures`, { method: 'POST', body: { rev: s.rev, imageIds: [...chosen], noSexShown: true } });
      setChosen(new Set());
      setNoSex(false);
      onSaved(res.study, res.added === 1 ? 'Picture added to the report.' : `${res.added} pictures added to the report.`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ul className="img-pictures img-machine-pictures">
        {m.images.map((i, n) => (
          <li key={i.id}>
            <ApiImage path={machineImageUrl(m.id, i.id)} alt={`Picture ${n + 1} from the machine`} link />
            {i.inThisStudy ? (
              <StatusPill tone="stable" icon={Check}>
                In the report
              </StatusPill>
            ) : (
              can && (
                <label className="check">
                  <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} /> Picture {n + 1}
                </label>
              )
            )}
          </li>
        ))}
      </ul>
      {can && chosen.size > 0 && (
        <div className="img-machine-confirm">
          <label className="check">
            <input type="checkbox" checked={noSex} onChange={(e) => setNoSex(e.target.checked)} /> I checked: these pictures do not show the baby&apos;s sex (PCPNDT Act).
          </label>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!noSex || busy} onClick={add}>
              {busy ? 'Adding…' : chosen.size === 1 ? 'Add 1 picture to the report' : `Add ${chosen.size} pictures to the report`}
            </button>
          </div>
        </div>
      )}
      {!can && <p className="hint">Pictures are added once the study is marked done, before the report is signed.</p>}
    </>
  );
}

export function AverageTable({ s, m, defaultUse, onSaved, onError }) {
  const [fetus, setFetus] = useState(m.fetuses[0]?.fetus ?? 'A');
  const rows = m.fetuses.find((f) => f.fetus === fetus)?.rows ?? [];
  const [choices, setChoices] = useState(() => Object.fromEntries(m.fetuses.map((f) => [f.fetus, startChoices(f.rows, defaultUse)])));
  const [busy, setBusy] = useState(false);
  const mine = choices[fetus] ?? {};
  const set = (key, change) => setChoices({ ...choices, [fetus]: { ...mine, [key]: { ...mine[key], ...change } } });
  const canFill = s.access.canReport && s.status === 'done';
  const used = rows.filter((r) => r.inTemplate && mine[r.key]?.on && usedValue(r, mine[r.key]) != null);
  const fill = async () => {
    setBusy(true);
    try {
      const body = { rev: s.rev, fetus, rows: used.map((r) => ({ key: r.key, ticked: mine[r.key].ticked, use: mine[r.key].use, reading: mine[r.key].reading })) };
      onSaved((await api(`/imaging/${s.id}/machine/${m.id}/fill`, { method: 'POST', body })).study, 'Readings put in the report. Check them, then write the report from the readings.');
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  if (!rows.length && !m.unmatched.length) return <p className="muted">No measurements in this study (the machine sends them in its structured report).</p>;
  const most = Math.max(0, ...rows.map((r) => r.readings.length));
  return (
    <>
      {m.fetuses.length > 1 && (
        <div className="segmented" aria-label="Fetus">
          {m.fetuses.map((f) => (
            <button key={f.fetus} type="button" aria-pressed={f.fetus === fetus} onClick={() => setFetus(f.fetus)}>
              Fetus {f.fetus}
            </button>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="img-avg-scroll">
          <table className="dt img-avg">
            <caption className="sr-only">Readings from the machine{m.fetuses.length > 1 ? `, fetus ${fetus}` : ''}</caption>
            <thead>
              <tr>
                <th scope="col">Use</th>
                <th scope="col">Measurement</th>
                {Array.from({ length: most }, (_, i) => (
                  <th key={i} scope="col" className="num">
                    Reading {i + 1}
                  </th>
                ))}
                <th scope="col" className="num">
                  Machine
                </th>
                <th scope="col">Rule</th>
                <th scope="col" className="num">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = mine[r.key];
                const value = usedValue(r, c);
                return (
                  <tr key={r.key} className={r.inTemplate ? undefined : 'img-avg-other'}>
                    <td className="img-avg-use">
                      {r.inTemplate ? (
                        <input type="checkbox" aria-label={`Use ${r.name}`} checked={c.on} disabled={!canFill} onChange={(e) => set(r.key, { on: e.target.checked })} />
                      ) : (
                        <span className="hint">Not in this template</span>
                      )}
                    </td>
                    <th scope="row" className="img-avg-name">
                      {r.name} <span className="muted">({r.unit})</span>
                    </th>
                    {Array.from({ length: most }, (_, i) => (
                      <td key={i} className={`num tabular${r.readings[i] == null ? ' img-avg-empty' : ''}`} data-label={`Reading ${i + 1}`}>
                        {r.readings[i] != null && (
                          <label className="img-avg-reading">
                            <input
                              type="checkbox"
                              aria-label={`${r.name} reading ${i + 1}`}
                              checked={c.ticked[i] !== false}
                              disabled={!canFill || c.use === 'machine' || c.use === 'reading'}
                              onChange={(e) => set(r.key, { ticked: c.ticked.map((t, j) => (j === i ? e.target.checked : t)) })}
                            />{' '}
                            {r.readings[i]}
                          </label>
                        )}
                      </td>
                    ))}
                    <td className={`num tabular${r.machine ? '' : ' img-avg-empty'}`} data-label="Machine">
                      {r.machine ? `${r.machine.value}${r.machine.derived && r.machine.derived !== 'mean' ? ` (${r.machine.derived})` : ''}` : '–'}
                    </td>
                    <td data-label="Rule" className={r.inTemplate ? undefined : 'img-avg-empty'}>
                      {r.inTemplate ? (
                        <>
                          <select aria-label={`Rule for ${r.name}`} value={c.use} disabled={!canFill} onChange={(e) => set(r.key, { use: e.target.value })}>
                            {usesFor(r).map((u) => (
                              <option key={u} value={u}>
                                {USE_WORDS[u]}
                              </option>
                            ))}
                          </select>
                          {c.use === 'reading' && (
                            <select aria-label={`Which reading of ${r.name}`} value={c.reading} disabled={!canFill} onChange={(e) => set(r.key, { reading: Number(e.target.value) })}>
                              {r.readings.map((v, i) => (
                                <option key={i} value={i}>
                                  Reading {i + 1}: {v}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="num tabular img-avg-value" data-label="Value">
                      {value ?? '–'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {m.unmatched.length > 0 && (
        <details className="img-unmatched">
          <summary>
            {m.unmatched.length} measurement{m.unmatched.length === 1 ? '' : 's'} not matched to a template field
          </summary>
          <ul>
            {m.unmatched.map((u, i) => (
              <li key={i}>
                {u.meaning || 'No name'}: {u.value} {u.unit}
                {m.fetuses.length > 1 ? ` (fetus ${u.fetus})` : ''}
              </li>
            ))}
          </ul>
          <p className="hint">Typed by hand if needed. The developer adds their codes after the owner approves (DRAFT).</p>
        </details>
      )}
      {canFill ? (
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !used.length} onClick={fill}>
            <TableProperties aria-hidden="true" /> {busy ? 'Putting them in…' : 'Fill the report with these values'}
          </button>
          <span className="hint">Replaces those fields; the findings and impression stay as they are.</span>
        </div>
      ) : (
        <p className="hint">{s.status === 'signed' ? 'The report is signed.' : 'Readings are put in the report once the study is marked done.'}</p>
      )}
    </>
  );
}

/** On a scan's page: the machine studies of this patient around the order. */
export function MachinePanel({ s, onSaved, onError }) {
  const { data, error } = useFetch(`/imaging/${s.id}/machine`, { rev: s.rev });
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return null;
  return (
    <section className="card" aria-labelledby="img-machine-title">
      <h2 id="img-machine-title">
        <MonitorDown aria-hidden="true" /> From the machine
      </h2>
      <p className="hint">DRAFT – what the ultrasound machine sent. Check the patient, choose the pictures, then check the readings and fill the report.</p>
      {data.studies.length === 0 ? (
        <p className="muted">
          Nothing from the machine for this patient yet. On the machine, choose her from the worklist{s.accession ? ` (scan number ${s.accession})` : ''} or type her patient number {s.patient.mrn}, then send the study.
        </p>
      ) : (
        data.studies.map((m) => (
          <article key={m.id} className="img-machine-study">
            <h3>
              {formatDateTime(m.studyAt ?? m.receivedAt)}
              {m.machine ? ` · ${m.machine}` : ''}
            </h3>
            <p className="hint">
              <Link2 aria-hidden="true" className="inline-icon" /> On the machine: {m.nameOnMachine || 'no name'}
              {m.numberOnMachine ? `, ${m.numberOnMachine}` : ''} – matched {MATCHED_WORDS[m.matchedBy] ?? ''}
              {m.linked ? ` by ${m.linked.byName}` : ''}.
            </p>
            {m.nameDiffers && (
              <Alert type="warning" icon={CircleAlert}>
                The name on the machine is not {s.patient.fullName}. Check that this is her study before using it.
              </Alert>
            )}
            <h4>Pictures</h4>
            <MachinePictures s={s} m={m} onSaved={onSaved} onError={onError} />
            <h4>Readings</h4>
            <AverageTable s={s} m={m} defaultUse={data.defaultUse} onSaved={onSaved} onError={onError} />
          </article>
        ))
      )}
    </section>
  );
}
