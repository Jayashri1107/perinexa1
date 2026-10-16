import { CalendarCheck, CircleCheck, CircleDot, Clock, TriangleAlert } from 'lucide-react';
import { Tip } from '../../components/Tip.jsx';
import { StatusPill, formatDate } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { TRIMESTERS, gestationOn, ribbonPosition } from './pregnancyTimeline.js';

// The pregnancy timeline on her Overview (doctor ideas #7, 16 Oct 2026): a ribbon from the LMP to 42 weeks with the
// trimesters, today marked, the visits of this pregnancy, and the care plan's scans, tests and check-ups – done, due
// or missed (colour, icon and word, as everywhere). The whole pregnancy in one look; the list below says the same in
// words. DRAFT (clinical): the trimester weeks, for the owner to check (pregnancyTimeline.js).

const STATUS = {
  done: { word: 'Done', tone: 'stable', Icon: CircleCheck },
  due: { word: 'Due', tone: 'due', Icon: Clock },
  overdue: { word: 'Missed', tone: 'high', Icon: TriangleAlert },
  upcoming: { word: 'Coming', tone: 'neutral', Icon: CircleDot },
};
const statusOf = (s) => STATUS[s] ?? STATUS.upcoming;
const KIND_WORDS = { scan: 'Scan', investigation: 'Test', visit: 'Check-up', vaccination: 'Vaccination' };

export function PregnancyTimeline({ patient }) {
  const res = useFetch(`/patients/${patient.id}/timeline`);
  const t = res.data;
  if (!t?.edd) return null;
  const today = new Date();
  const ga = gestationOn(t.edd, today);
  const items = t.items.slice().sort((a, b) => new Date(a.dueBy) - new Date(b.dueBy));
  return (
    <div className="ptl">
      <Tip id="timeline-2026-10" />
      <h3 className="ptl-title">
        Pregnancy timeline <span className="muted">{ga ? `· ${ga.weeks} w ${ga.days} d today` : ''}</span>
      </h3>
      <div
        className="ptl-ribbon"
        role="img"
        aria-label={`From the LMP to 42 weeks; today ${ga ? `${ga.weeks} weeks ${ga.days} days` : ''}; ${t.visits.length} visits; ${items.length} scans, tests and check-ups`}
      >
        {TRIMESTERS.map((tr, i) => (
          <span key={tr.label} className={`ptl-band ptl-band-${i}`} style={{ left: `${tr.from}%`, width: `${tr.to - tr.from}%` }} title={tr.label} />
        ))}
        {t.visits.map((v) => (
          <span key={`v-${v}`} className="ptl-visit" style={{ left: `${ribbonPosition(t.edd, v)}%` }} title={`Visit ${formatDate(v)}`} />
        ))}
        {/* On the ribbon: the visits and the scans (the idea's "dots for visits and scans"); every item is in the list below */}
        {items.map((it, i) => {
          if (it.kind !== 'scan') return null;
          const s = statusOf(it.status);
          return <span key={`i-${i}`} className={`ptl-item ptl-${s.tone}`} style={{ left: `${ribbonPosition(t.edd, it.dueBy)}%` }} title={`${it.name} – by ${formatDate(it.dueBy)} (${s.word})`} />;
        })}
        <span className="ptl-today" style={{ left: `${ribbonPosition(t.edd, today)}%` }} title="Today" />
      </div>
      <div className="ptl-scale muted" aria-hidden="true">
        <span style={{ left: 0 }}>LMP</span>
        <span style={{ left: `${(14 * 7 * 100) / 294}%` }}>14 w</span>
        <span style={{ left: `${(28 * 7 * 100) / 294}%` }}>28 w</span>
        <span style={{ left: `${(280 * 100) / 294}%` }}>EDD {formatDate(t.edd)}</span>
      </div>
      <p className="ptl-legend muted">
        <span className="ptl-key ptl-key-visit" /> Visit · scans: <span className="ptl-key ptl-stable" /> Done <span className="ptl-key ptl-due" /> Due <span className="ptl-key ptl-high" /> Missed{' '}
        <span className="ptl-key ptl-neutral" /> Coming <span className="ptl-key ptl-key-today" /> Today · trimester weeks DRAFT
      </p>
      {items.length > 0 && (
        <details className="ptl-list">
          <summary>Scans, tests and check-ups by date ({items.length})</summary>
          <ul className="plain-list">
            {items.map((it, i) => {
              const s = statusOf(it.status);
              return (
                <li key={i}>
                  <StatusPill tone={s.tone} icon={s.Icon}>
                    {s.word}
                  </StatusPill>{' '}
                  {KIND_WORDS[it.kind] ?? ''}: {it.name} <span className="muted">– by {formatDate(it.dueBy)}</span>
                </li>
              );
            })}
            {t.visits.length > 0 && (
              <li>
                <StatusPill tone="neutral" icon={CalendarCheck}>
                  Visits
                </StatusPill>{' '}
                {t.visits.map((v) => formatDate(v)).join(', ')}
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
