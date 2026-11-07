import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BedDouble, CircleCheck, TriangleAlert, Users } from 'lucide-react';
import { api } from '../../api.js';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, Field, StatusPill, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { Banners } from './NicuAdmissionSection.jsx';
import { useNewbornTabs } from './newbornFormat.js';

// The NICU unit board (Build 13, NEO-A-01): each unit with its level of care, its beds and who is in them, the nurses
// on duty and the nurse:baby warning for intensive beds (more than 2 babies per nurse), and each baby's flags – the
// admission record not complete within the hour (N6), parents not counselled after an hour (N1), hypothermia, below the
// floor, outside the unit's capability. Doctors, RMOs and nurses; a baby they may not see shows as "occupied".

const RATIO_WORDS = { worse: 'Worse than 1 nurse to 2 babies in intensive beds', unknown: 'Nurses on duty not entered' };

function RosterForm({ unit, onDone }) {
  const [nurses, setNurses] = useState(unit.nurses?.nurses != null ? String(unit.nurses.nurses) : '');
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/newborn-care/roster', { method: 'POST', body: { unit: unit.key, nurses } });
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="row" onSubmit={save}>
      <Field label="Nurses on duty now" id={`nb-nurses-${unit.key}`} error={error?.fields?.nurses ?? error?.message}>
        <input id={`nb-nurses-${unit.key}`} inputMode="numeric" value={nurses} onChange={(e) => setNurses(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-secondary btn-sm">
        Save
      </button>
    </form>
  );
}

export function NicuBoardPage() {
  const tabs = useNewbornTabs();
  const { data, error, reload } = useFetch('/newborn-care/board');
  return (
    <>
      <PageHeader tabs={tabs} title="NICU unit board" documentTitle="NICU board" subtitle="Beds, nurses on duty and what each baby still needs." />
      <div className="pf-content stack">
        <Alert type="error">{error}</Alert>
        {!data && !error && <p className="muted">Loading…</p>}
        {data && !data.units.length && <p className="muted">No NICU units in use. The hospital admin sets them up (Hospital admin → NICU units).</p>}
        <div className="nicu-board-units">
          {data?.units.map((u) => (
            <section key={u.key} className="card stack" aria-labelledby={`nb-${u.key}`}>
              <div className="item-editor-head">
                <h2 id={`nb-${u.key}`}>{`${u.name} · ${data.levels[u.level] ?? u.level}`}</h2>
                <span className="row">
                  <StatusPill tone={u.free ? 'stable' : 'high'} icon={BedDouble}>{u.capacity ? `${u.free} of ${u.capacity} beds free` : 'No beds set up'}</StatusPill>
                  {u.ratio ? (
                    <StatusPill tone={u.ratio === 'worse' ? 'high' : 'watch'} icon={TriangleAlert}>
                      {RATIO_WORDS[u.ratio]}
                    </StatusPill>
                  ) : (
                    u.intensiveBabies > 0 && (
                      <StatusPill tone="stable" icon={Users}>
                        Nurse to baby ratio within 1:2
                      </StatusPill>
                    )
                  )}
                  {u.counts.incomplete > 0 && <StatusPill tone="watch" icon={TriangleAlert}>{`${u.counts.incomplete} admission record${u.counts.incomplete > 1 ? 's' : ''} not complete within 1 hour`}</StatusPill>}
                  {u.counts.counselOverdue > 0 && <StatusPill tone="high" icon={TriangleAlert}>{`${u.counts.counselOverdue} not counselled after 1 hour`}</StatusPill>}
                </span>
              </div>
              <p className="hint">{`${u.intensiveBabies} in intensive beds · nurses on duty: ${u.nurses ? `${u.nurses.nurses} (entered by ${u.nurses.byName}, ${formatDateTime(u.nurses.at)})` : 'not entered'}`}</p>
              <RosterForm unit={u} onDone={reload} />
              <div className="nicu-beds">
                {u.beds.map((b) => {
                  const a = u.admissions.find((x) => x.bedId === b.id);
                  return (
                    <div key={b.id} className={`nicu-bed${b.occupied ? '' : ' nicu-bed-free'}`}>
                      <strong>{`${b.name} · ${data.bedKinds[b.kind] ?? b.kind}`}</strong>
                      <span className="hint">{b.level === 'intensive' ? 'Intensive' : 'Step-down'}</span>
                      {a?.baby ? (
                        <Link to={`/patients/${a.baby.id}/newborn-care`}>{`${a.baby.fullName} · ${a.baby.mrn}`}</Link>
                      ) : b.occupied ? (
                        <span>{b.stay && !a ? 'Occupied (a stay)' : 'Occupied'}</span>
                      ) : (
                        <span className="muted">
                          <CircleCheck aria-hidden="true" /> Free
                        </span>
                      )}
                      {a?.banners?.length > 0 && <Banners list={a.banners} />}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
