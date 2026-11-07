import { CircleCheck, CircleHelp, CircleAlert, TriangleAlert } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { Alert, StatusPill, formatDate, formatDateTime } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { RISK_LABELS } from './riskFormat.js';

// Her pregnancies (Clinical Requirements Group C – PX-X-15): one entry per pregnancy – the current one first – with its
// visits, stays, delivery notes, operations, lab orders and babies, read from the records as they are. For the current
// pregnancy, the GREEN / AMBER / RED tier (DRAFT, not in use) beside today's risk level.

export const TIER_LOOK = {
  red: { tone: 'high', icon: TriangleAlert },
  amber: { tone: 'watch', icon: CircleAlert },
  green: { tone: 'stable', icon: CircleCheck },
  grey: { tone: 'neutral', icon: CircleHelp },
};

export function TierCard({ tier }) {
  const look = TIER_LOOK[tier.tier];
  return (
    <section className="card" aria-label="Tier (draft)">
      <h2>Tier – DRAFT, not in use</h2>
      <p>
        <StatusPill tone={look.tone} icon={look.icon} large>
          {tier.word}
        </StatusPill>
      </p>
      {tier.riskLevelToday !== undefined && <p>{`Today's risk level, which Perinexa uses: ${RISK_LABELS[tier.riskLevelToday] ?? 'not worked out yet'}.`}</p>}
      {tier.reasons.length > 0 && (
        <ul>
          {tier.reasons.map((r) => (
            <li key={r.key}>{`${r.tier === 'red' ? 'RED' : 'AMBER'}: ${r.label}`}</li>
          ))}
        </ul>
      )}
      {tier.missing.length > 0 && <p className="hint">{`Not recorded yet: ${tier.missing.join('; ')}.`}</p>}
      <p className="hint">{`${tier.source}. Whether the tiers replace today's risk rules is the owner's decision.`}</p>
    </section>
  );
}

function Episode({ e, base }) {
  const title = e.status === 'open' ? `Pregnancy ${e.number} – current` : `Pregnancy ${e.number} – ${e.closed?.word ?? 'ended'}`;
  const rows = [
    ['EDD', e.edd ? formatDate(e.edd) : 'Not known'],
    ['From', e.from ? formatDate(e.from) : '–'],
    ...(e.to ? [['To', formatDate(e.to)]] : []),
  ];
  return (
    <section className="card">
      <div className="item-editor-head">
        <h2>{title}</h2>
        <StatusPill tone={e.status === 'open' ? 'due' : 'inactive'}>{e.status === 'open' ? 'Open' : 'Closed'}</StatusPill>
      </div>
      <dl className="details">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div>
          <dt>Visits</dt>
          <dd>{e.visits.length ? `${e.visits.length} (last ${formatDate(e.visits[e.visits.length - 1].on)})` : 'None'}</dd>
        </div>
        <div>
          <dt>Stays</dt>
          <dd>
            {e.stays.length
              ? e.stays.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ' · '}
                    <Link to={`${base}/stays/${s.id}`}>{`${formatDateTime(s.admittedAt)}${s.ward ? `, ${s.ward}` : ''}${s.status === 'admitted' ? ' (in hospital)' : ''}`}</Link>
                  </span>
                ))
              : 'None'}
          </dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{e.deliveries.length ? e.deliveries.map((d) => formatDateTime(d.at)).join(' · ') : 'No signed delivery note'}</dd>
        </div>
        <div>
          <dt>Operations</dt>
          <dd>{e.operations.length ? e.operations.map((o) => `${o.procedure}, ${formatDate(o.on)}`).join(' · ') : 'None'}</dd>
        </div>
        <div>
          <dt>Lab orders</dt>
          <dd>{e.labOrders || 'None'}</dd>
        </div>
        <div>
          <dt>Babies</dt>
          <dd>
            {e.babies.length
              ? e.babies.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && ' · '}
                    <Link to={`/patients/${b.id}`}>{`${b.fullName} · ${b.mrn}`}</Link>
                  </span>
                ))
              : 'None'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function PregnanciesTab() {
  const { patient } = useOutletContext();
  const { data, error } = useFetch('/pregnancy-episodes', { patientId: patient.id });
  const base = `/patients/${patient.id}`;
  return (
    <div className="stack">
      <Alert type="error">{error}</Alert>
      {data?.tier && <TierCard tier={data.tier} />}
      {data && data.episodes.length === 0 && <p className="muted">No pregnancy recorded here.</p>}
      {data?.episodes.map((e) => (
        <Episode key={e.id} e={e} base={base} />
      ))}
      {data && <p className="hint">Each pregnancy is read from her records as they are: the visits, stays and results from two weeks before her LMP to the end of the pregnancy.</p>}
    </div>
  );
}
