import { CircleCheck, FlaskConical, HandCoins, PenLine, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFetch } from '../hooks/useFetch.js';

// "Your day so far" on a doctor's or RMO's Today (doctor ideas #9, 16 Oct 2026): "You saw 23 patients today. 2 lab
// reports are waiting for you. 1 high-risk patient booked with you has not come." – the day's work, and the loose
// ends with a link each. Calm on purpose (the brand rules: no exclamation marks, no badges or confetti).

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function MyDayCard({ enabled }) {
  const res = useFetch(enabled ? '/my-day' : null);
  const d = res.data?.day;
  if (!d) return null;
  const ends = [
    d.notSigned > 0 && { key: 'sign', Icon: PenLine, text: `${plural(d.notSigned, 'visit', 'visits')} of today not signed yet`, to: '/', tone: 'due' },
    d.labToReview > 0 && { key: 'lab', Icon: FlaskConical, text: `${plural(d.labToReview, 'lab report is', 'lab reports are')} waiting for your review`, to: '/lab', tone: 'due' },
    // The cash handed over by reception that waits for a doctor's confirmation (docs/WHATSAPP_DESK_PLAN.md)
    d.cashToConfirm > 0 && { key: 'cash', Icon: HandCoins, text: `${plural(d.cashToConfirm, 'cash handover is', 'cash handovers are')} waiting for your confirmation`, to: '/cash-handover', tone: 'due' },
    d.missedHighRisk > 0 && {
      key: 'missed',
      Icon: TriangleAlert,
      text: `${plural(d.missedHighRisk, 'high-risk patient', 'high-risk patients')} booked with you today ${d.missedHighRisk === 1 ? 'has' : 'have'} not come`,
      to: '/appointments',
      tone: 'high',
    },
  ].filter(Boolean);
  return (
    <section className="card myday" aria-labelledby="myday-title">
      <h2 id="myday-title">Your day so far</h2>
      <p className="myday-lead">
        <CircleCheck aria-hidden="true" /> You saw <strong>{plural(d.seen, 'patient', 'patients')}</strong> today.
        {!ends.length && d.seen > 0 ? ' Nothing is left open.' : ''}
      </p>
      {ends.length > 0 && (
        <ul className="myday-list">
          {ends.map((e) => (
            <li key={e.key} className={`myday-${e.tone}`}>
              <e.Icon aria-hidden="true" /> <Link to={e.to}>{e.text}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
