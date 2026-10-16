import { useState } from 'react';
import { Tip } from '../components/Tip.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { KNOWLEDGE_CRUMB, knowledgeTabs } from '../platform/modules.js';
import { Alert, Field, formatDate } from '../components/ui.jsx';
import { eddFromLmp, gestationOn, lmpFromEdd, milestoneDates } from './patients/pregnancyTimeline.js';

// The pregnancy wheel (doctor ideas #8, 16 Oct 2026): a digital version of the cardboard wheel. Count from the LMP or
// from an EDD (a scan's), pick any date, and see the weeks and days then, the EDD, and the dates of the usual
// milestones. A calculator only – nothing is saved and no patient is chosen. DRAFT (clinical): the milestones and
// their weeks are for the owner to check (pregnancyTimeline.js).

const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const utc = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);

/** The wheel: 40 weeks round, the pointer at the weeks on the chosen date. */
function Dial({ ga }) {
  const r = 96;
  const angle = ga ? (Math.min(ga.total, 280) / 280) * 360 - 90 : -90;
  const rad = (a) => (a * Math.PI) / 180;
  return (
    <svg className="wheel-dial" viewBox="0 0 220 220" role="img" aria-label={ga ? `${ga.weeks} weeks ${ga.days} days of 40 weeks` : 'Pick the dates'}>
      <circle cx="110" cy="110" r={r} fill="var(--mist-50)" stroke="var(--border)" />
      {Array.from({ length: 40 }, (_, w) => {
        const a = rad((w / 40) * 360 - 90);
        const long = w % 4 === 0;
        return <line key={w} x1={110 + Math.cos(a) * (r - (long ? 14 : 7))} y1={110 + Math.sin(a) * (r - (long ? 14 : 7))} x2={110 + Math.cos(a) * r} y2={110 + Math.sin(a) * r} stroke="var(--slate-600)" strokeWidth={long ? 2 : 1} />;
      })}
      {[0, 12, 20, 28, 36].map((w) => {
        const a = rad((w / 40) * 360 - 90);
        return (
          <text key={w} x={110 + Math.cos(a) * (r - 26)} y={114 + Math.sin(a) * (r - 26)} textAnchor="middle" fontSize="11" fill="var(--slate-600)">
            {w || '40'}
          </text>
        );
      })}
      {ga && <line x1="110" y1="110" x2={110 + Math.cos(rad(angle)) * (r - 4)} y2={110 + Math.sin(rad(angle)) * (r - 4)} stroke="var(--indigo-700)" strokeWidth="4" strokeLinecap="round" />}
      <circle cx="110" cy="110" r="6" fill="var(--indigo-700)" />
    </svg>
  );
}

export function PregnancyWheelPage() {
  const { activeMembership } = useAuth();
  const [from, setFrom] = useState('lmp'); // lmp | edd
  const [date, setDate] = useState('');
  const [on, setOn] = useState(todayInput);
  const edd = from === 'lmp' ? eddFromLmp(utc(date)) : utc(date);
  const lmp = from === 'lmp' ? utc(date) : lmpFromEdd(utc(date));
  const ga = edd && on ? gestationOn(edd, utc(on)) : null;
  const tooLate = ga && ga.total > 44 * 7;
  return (
    <>
      <PageHeader breadcrumbs={[KNOWLEDGE_CRUMB, { label: 'Pregnancy wheel' }]} title="Pregnancy wheel" subtitle="Weeks and days on any date – a calculator; nothing is saved" tabs={knowledgeTabs(activeMembership?.roles ?? [])} />
      <div className="pf-content">
        <Tip id="wheel-2026-10" />
        <div className="wheel-grid">
          <section className="card">
            <div className="segmented" role="group" aria-label="Count from">
              <button type="button" aria-pressed={from === 'lmp'} onClick={() => setFrom('lmp')}>
                From the LMP
              </button>
              <button type="button" aria-pressed={from === 'edd'} onClick={() => setFrom('edd')}>
                From an EDD (scan)
              </button>
            </div>
            <Field label={from === 'lmp' ? 'First day of the last period (LMP)' : 'EDD'} id="wheel-date">
              <input id="wheel-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="On this date" id="wheel-on">
              <input id="wheel-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
            </Field>
          </section>
          <section className="card" aria-live="polite">
            <Dial ga={ga && !tooLate ? ga : null} />
            {!date && <p className="muted">Pick the {from === 'lmp' ? 'LMP' : 'EDD'} to start.</p>}
            {date && !ga && <p className="muted">That date is before the pregnancy started.</p>}
            {tooLate && <Alert type="warning">That date is more than 44 weeks on: check the dates.</Alert>}
            {ga && !tooLate && (
              <>
                <p className="wheel-answer tabular">
                  {ga.weeks} w {ga.days} d
                </p>
                <p className="muted">on {formatDate(utc(on))}</p>
              </>
            )}
            {edd && (
              <p>
                EDD <strong>{formatDate(edd)}</strong>
                {from === 'edd' && lmp ? <span className="muted"> · LMP-equivalent {formatDate(lmp)}</span> : null}
              </p>
            )}
          </section>
          {edd && (
            <section className="card">
              <h2>Milestones</h2>
              <table className="wheel-table">
                <tbody>
                  {milestoneDates(edd).map((m) => (
                    <tr key={m.label}>
                      <th scope="row">{m.label}</th>
                      <td className="tabular">{formatDate(m.on)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">DRAFT – these milestones are to be checked by the hospital's doctor before use.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
