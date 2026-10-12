import { ChevronLeft, ChevronRight, Square, SquareCheck } from 'lucide-react';
import { EventMark } from './EventMark.jsx';

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
const STEP_WORD = { day: 'day', week: 'week', month: 'month' };

/**
 * The calendar's toolbar card, two rows:
 * 1. ‹ Today › and the range title (announced when it changes), then the Day | Week | Month switch;
 * 2. My patients | All patients (doctors only), then one toggle per type – the marks double as the legend.
 */
export function CalendarToolbar({
  view,
  onView,
  title,
  loading,
  canStep,
  onStep,
  onToday,
  canChooseScope,
  scope,
  onScope,
  allowed,
  types,
  onTypes,
  level,
}) {
  const toggle = (t) => {
    const on = types.includes(t);
    if (on && types.length === 1) return; // at least one type stays shown
    onTypes(on ? types.filter((x) => x !== t) : allowed.filter((x) => x === t || types.includes(x)));
  };

  return (
    <section className="card cal-toolbar" aria-label="Calendar controls">
      <div className="cal-toolbar-row">
        <div className="cal-nav">
          <button type="button" className="icon-btn" onClick={() => onStep(-1)} disabled={!canStep} aria-label={`Previous ${STEP_WORD[view]}`} title={`Previous ${STEP_WORD[view]}`}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-secondary" onClick={onToday}>
            Today
          </button>
          <button type="button" className="icon-btn" onClick={() => onStep(1)} disabled={!canStep} aria-label={`Next ${STEP_WORD[view]}`} title={`Next ${STEP_WORD[view]}`}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <h2 className="cal-title" aria-live="polite">
          {title}
          {loading && <span className="cal-loading"> Loading…</span>}
        </h2>
        <div className="segmented cal-views" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => onView(v.value)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="cal-toolbar-row">
        {canChooseScope && (
          <div className="segmented cal-scope" role="group" aria-label="Patients">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => onScope('mine')}>
              My patients
            </button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => onScope('all')}>
              All patients
            </button>
          </div>
        )}
        <div className="cal-types" role="group" aria-label="Show">
          <span className="cal-show-label" aria-hidden="true">
            Show:
          </span>
          {allowed.map((t) => {
            const on = types.includes(t);
            const last = on && types.length === 1;
            const Box = on ? SquareCheck : Square;
            return (
              <button
                key={t}
                type="button"
                className="cal-chip"
                aria-pressed={on}
                aria-disabled={last || undefined}
                title={last ? 'At least one type stays shown' : undefined}
                onClick={() => toggle(t)}
              >
                <Box className="cal-chip-box" aria-hidden="true" />
                <EventMark type={t} level={level} view={view} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
