// Today → In hospital now (doctors, RMOs, nurses): each stay with its ward and bed, drafts to finish and red flags.
import { BedDouble } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { admissionsApi } from '../../api/index.js';
import { StateBadge } from '../../components/StateBadge.jsx';
import { FLAG_LOOKS } from '../visits/visitFormat.js';

export function InHospitalCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    admissionsApi.inpatients().then(setData).catch(() => setData({ items: [] }));
  }, []);
  if (!data) return null;
  return (
    <section className="card">
      <h2><BedDouble size={18} aria-hidden /> In hospital now</h2>
      {data.items.length === 0 && <p className="muted">Nobody is admitted.</p>}
      <ul className="plain-list rows">
        {data.items.map((s) => (
          <li key={s.id} className="appt-line">
            <span>
              <Link to={`/hospital/inpatients/${s.id}`}><strong>{s.patient.name}</strong></Link>
              <span className="muted block small">{[s.ward, s.bed && `bed ${s.bed}`, s.drafts && `${s.drafts} draft${s.drafts === 1 ? '' : 's'} to finish`].filter(Boolean).join(' · ')}</span>
            </span>
            {s.redFlags.map((f) => <StateBadge key={f.label} look={{ ...FLAG_LOOKS[f.level], word: f.label }} small />)}
          </li>
        ))}
      </ul>
    </section>
  );
}
