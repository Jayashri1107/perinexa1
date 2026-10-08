// Booked beds (owner, 8 Oct 2026): how many beds are booked of all beds in use, and each booked bed with the patient in
// it (name and number, linking to her record) – for reception on Today and on Admissions. From the wards' availability.
import { ArrowRight, BedDouble } from 'lucide-react';
import { Link } from 'react-router-dom';

export function bedCounts(beds) {
  const total = (beds?.items ?? []).reduce((n, w) => n + w.total, 0);
  const free = (beds?.items ?? []).reduce((n, w) => n + w.free, 0);
  return { total, free, booked: total - free };
}

export function BookedBedsList({ beds }) {
  const rows = (beds?.items ?? []).flatMap((w) => w.beds.filter((b) => b.booked).map((b) => ({ ward: w.name, ...b, key: `${w.id}|${b.label}` })));
  if (rows.length === 0) return <p className="muted">No beds booked – every bed is free.</p>;
  return (
    <ul className="plain-list booked-beds">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bed-chip"><BedDouble size={14} aria-hidden /> {r.label}</span>
          <span className="booked-beds-who">
            {r.patient ? (
              <Link to={`/hospital/patients/${r.patient.id}`}><strong>{r.patient.name}</strong></Link>
            ) : (
              <strong>Booked</strong>
            )}
            <span className="muted small"> {r.patient?.patientNumber}</span>
          </span>
          <span className="muted small">{r.ward}</span>
        </li>
      ))}
    </ul>
  );
}

// Today: the booked beds with the patients, and a link to Admissions.
export function BookedBedsCard({ beds }) {
  const c = bedCounts(beds);
  return (
    <section className="card">
      <div className="card-head">
        <h2><BedDouble size={18} aria-hidden /> Booked beds <span className="muted small">{c.booked} of {c.total}</span></h2>
        <Link to="/hospital/admissions" className="small">Admissions <ArrowRight size={12} aria-hidden /></Link>
      </div>
      <BookedBedsList beds={beds} />
    </section>
  );
}
