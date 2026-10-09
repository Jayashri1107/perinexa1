// Choosing a ward and a free bed: every ward of the hospital with how many beds are free, then its beds – free ones to
// choose, booked ones shown with who is in them. value: { wardId, bed }. exceptStayId: when moving a patient, her own
// bed counts as free.
import { BedDouble } from 'lucide-react';
import { useEffect, useState } from 'react';
import { wardsApi } from '../../api/index.js';
import { labelOf } from '../../utils/format.js';
import { byFloor } from './inpatientFormat.js';

export function BedPicker({ value, onChange, exceptStayId, error }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    wardsApi
      .availability(exceptStayId ? { exceptStayId } : {})
      .then(setData)
      .catch((err) => setLoadError(err.message));
  }, [exceptStayId]);

  if (loadError) return <p className="field-error">{loadError}</p>;
  if (!data) return <p className="muted small">Loading the wards…</p>;
  if (!data.items.length) return <p className="muted">No wards yet. The hospital admin adds them in Hospital admin → Wards and beds.</p>;
  const ward = data.items.find((w) => w.id === value.wardId);

  return (
    <div className="bed-picker">
      <span className="field-label">Ward<span className="required" aria-hidden> *</span></span>
      <div role="radiogroup" aria-label="Ward">
        {byFloor(data.items).map((g) => (
          <div key={g.floor} className="floor-group">
            <span className="floor-title small">{g.floor}</span>
            <div className="ward-cards">
              {g.items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={w.id === value.wardId}
                  className={`ward-card${w.id === value.wardId ? ' on' : ''}${w.free === 0 ? ' full' : ''}`}
                  onClick={() => onChange({ wardId: w.id, bed: '' })}
                >
                  <strong>{w.name}</strong>
                  <span className="muted small">{labelOf(data.kinds, w.kind)}</span>
                  <span className={`ward-free${w.free === 0 ? ' none' : ''}`}>{w.free === 0 ? 'Full' : `${w.free} of ${w.total} free`}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {ward && (
        <>
          <span className="field-label top-gap-sm">Bed in {ward.name}{ward.floor && `, ${ward.floor}`}<span className="required" aria-hidden> *</span></span>
          <div className="bed-grid" role="radiogroup" aria-label={`Beds in ${ward.name}`}>
            {ward.beds.map((b) => (
              <button
                key={b.label}
                type="button"
                role="radio"
                aria-checked={value.bed === b.label}
                disabled={b.booked}
                title={b.booked && b.patient ? `Booked – ${b.patient.name} (${b.patient.patientNumber})` : b.booked ? 'Booked' : 'Free'}
                className={`bed-chip${b.booked ? ' booked' : ''}${value.bed === b.label ? ' on' : ''}`}
                onClick={() => onChange({ wardId: ward.id, bed: b.label })}
              >
                <BedDouble size={14} aria-hidden /> {b.label}
                <span className="bed-state">{b.booked ? 'Booked' : value.bed === b.label ? 'Chosen' : 'Free'}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
