import { useId, useState } from 'react';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PERIOD_OPTIONS } from './analyticsFormat.js';

const CUSTOM = { doctor: 'custom', platform: 'custom_months' };

// The month before a date ("2026-10-15" → "2026-09").
function monthBefore(isoDay) {
  if (!isoDay) return '';
  const [y, m] = isoDay.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The one row of filters above the cards: the period (a segmented control; a dropdown when the page is narrow),
 * "Whole hospital | My patients" for doctors, and the hospital for the super admin. Every choice goes into the
 * address bar, so Back, reloads and bookmarks keep it.
 */
export function AnalyticsFilters({ audience, params, setParams, period, today, hospitals, leftOut }) {
  const options = PERIOD_OPTIONS[audience];
  const custom = CUSTOM[audience];
  const months = audience === 'platform';
  const [open, setOpen] = useState(false);
  const showCustom = Boolean(custom) && (open || params.period === custom);
  const [draft, setDraft] = useState({ from: params.from || '', to: params.to || '' });
  const id = useId();

  const choose = (value) => {
    if (value === custom) {
      // Start from the dates now shown; nothing changes until "Show".
      const from = params.from || (months ? period?.from?.slice(0, 7) : period?.from) || '';
      const to = params.to || (months ? period?.to?.slice(0, 7) : period?.to) || '';
      setDraft({ from, to });
      setOpen(true);
      return;
    }
    setOpen(false);
    setParams({ period: value, from: '', to: '' });
  };
  const apply = (e) => {
    e.preventDefault();
    if (!draft.from || !draft.to) return;
    setParams({ period: custom, from: draft.from, to: draft.to });
  };
  const pressed = (value) => (value === custom ? showCustom : !showCustom && (params.period || '') === value);
  const maxDate = months ? monthBefore(today) : today;
  const minDate = months ? '2020-01' : '2020-01-01';

  return (
    <div className="an-filters">
      <div className="an-filter">
        <span className="dt-filter-label an-period-label" id={`${id}-period`}>
          Period
        </span>
        <div className="segmented an-period-wide" role="group" aria-labelledby={`${id}-period`}>
          {options.map((o) => (
            <button key={o.value} type="button" aria-pressed={pressed(o.value)} onClick={() => choose(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="an-period-narrow">
          <FilterSelect label="Period" value={showCustom ? custom : params.period} onChange={choose} options={options} allLabel={null} />
        </div>
        {period?.label && <span className="an-caption">{period.label}</span>}
        {showCustom && (
          <form className="an-custom" onSubmit={apply}>
            <label className="dt-filter">
              <span className="dt-filter-label">From</span>
              <input
                type={months ? 'month' : 'date'}
                value={draft.from}
                min={minDate}
                max={maxDate || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                required
              />
            </label>
            <label className="dt-filter">
              <span className="dt-filter-label">To</span>
              <input
                type={months ? 'month' : 'date'}
                value={draft.to}
                min={minDate}
                max={maxDate || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                required
              />
            </label>
            <button type="submit" className="btn btn-secondary">
              Show
            </button>
            <span className="an-caption an-custom-hint">
              {months ? 'Whole months, up to 24, ending with last month.' : 'Up to 24 months, ending today or earlier.'}
            </span>
          </form>
        )}
      </div>

      {audience === 'doctor' && (
        <div className="an-filter">
          <span className="dt-filter-label" id={`${id}-scope`}>
            Patients
          </span>
          <div className="segmented" role="group" aria-labelledby={`${id}-scope`}>
            <button type="button" aria-pressed={params.scope !== 'mine'} onClick={() => setParams({ scope: 'hospital' })}>
              Whole hospital
            </button>
            <button type="button" aria-pressed={params.scope === 'mine'} onClick={() => setParams({ scope: 'mine' })}>
              My patients
            </button>
          </div>
          {params.scope !== 'mine' && leftOut > 0 && (
            <span className="an-caption">{`Leaves out ${formatNumber(leftOut)} sensitive ${leftOut === 1 ? 'record' : 'records'} of other doctors.`}</span>
          )}
          {params.scope === 'mine' && <span className="an-caption">Patients assigned to you (and babies of your patients).</span>}
        </div>
      )}

      {audience === 'platform' && (
        <div className="an-filter">
          <FilterSelect
            label="Hospital"
            value={params.hospital}
            onChange={(hospital) => setParams({ hospital })}
            allLabel={null}
            options={[
              { value: 'all', label: 'All active hospitals' },
              ...(hospitals ?? []).map((h) => ({ value: h.id, label: h.isActive ? h.name : `${h.name} (inactive)` })),
            ]}
          />
        </div>
      )}
    </div>
  );
}
