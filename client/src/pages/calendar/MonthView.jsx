import { useEffect, useRef } from 'react';
import { EVENT_LOOK, countWords, monthHasEntries } from './calendarFormat.js';
import { dayOfMonth, monthTitle, monthWeeks, gridKeyMove, weekdayLong, weekdayOf, weekdayShort } from './calendarDates.js';
import { EmptyCard } from './DayView.jsx';

// The month view: a grid of whole weeks with the number of entries per day (docs/BRAND.md "Calendar month grid
// and day lists"), and the chosen day's entries in a panel beside it (below it when the calendar is narrower
// than 980 px). The grid is the date-picker pattern: arrow keys, Home / End, Page Up / Page Down, Enter / Space.

function Cell({ day, chosen, tabbable, today, level, onChoose, onKey }) {
  const { pieces, total, label } = countWords(day, level);
  const isChosen = day.date === chosen;
  const isToday = day.date === today;
  const cls = ['cal-cell', isToday ? 'cal-cell-today' : '', isChosen ? 'cal-cell-chosen' : '', day.inMonth ? '' : 'cal-cell-out'].filter(Boolean).join(' ');
  return (
    <div role="gridcell" aria-selected={isChosen} className={cls}>
      <button
        type="button"
        className="cal-cell-btn"
        data-date={day.date}
        tabIndex={day.date === tabbable ? 0 : -1}
        aria-label={label}
        aria-current={isToday ? 'date' : undefined}
        onClick={() => onChoose(day.date)}
        onKeyDown={(e) => onKey(e, day.date)}
      >
        <span className="cal-cell-head" aria-hidden="true">
          <span className="cal-daynum">{dayOfMonth(day.date)}</span>
          {isToday && <span className="cal-cell-today-label">Today</span>}
        </span>
        <span className="cal-counts" aria-hidden="true">
          {pieces.map((p) => {
            const Icon = EVENT_LOOK[p.type].icon;
            return (
              <span key={p.type} className={`cal-count cal-count-${p.type}`}>
                <Icon />
                {p.count}
              </span>
            );
          })}
        </span>
        {total > 0 && (
          <span className="cal-total" aria-hidden="true">
            {day.booked > 0 && <span className="cal-dot" />}
            {total}
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * data: the server's month answer (counts), or null while it first loads. chosen: the chosen day ("YYYY-MM-DD").
 * data must be for the chosen day's month (the page passes null while another month loads: skeleton cells).
 * onChoose(date): choose another day (moves to its month when it is outside). panel: the chosen day's entries.
 * panelBusy: the chosen day's entries are loading (aria-busy on the panel; the title's live region stays quiet).
 */
export function MonthView({ data, chosen, level, onChoose, panelTitle, panel, panelBusy, onShowAll, upcoming = null }) {
  const gridRef = useRef(null);
  const wantFocus = useRef(false);
  const days = data?.days ?? [];
  const weeks = monthWeeks(days, chosen);
  const firstWeekday = days.length ? weekdayOf(days[0].date) : 1;
  // One day button is in the Tab order: the chosen day, or (while another month is loading) the first day shown.
  const tabbable = days.some((d) => d.date === chosen) ? chosen : days[0]?.date;

  // After a keyboard move, focus follows the chosen day (also when the move changed the month and the new grid came in).
  useEffect(() => {
    if (!wantFocus.current) return;
    const btn = gridRef.current?.querySelector(`button[data-date="${chosen}"]`);
    if (btn) {
      btn.focus();
      wantFocus.current = false;
    }
  }, [chosen, data]);

  const onKey = (e, date) => {
    // Leave browser and system shortcuts alone (Alt+Left = Back, Cmd+Left on Mac, Ctrl+PageUp = switch tab).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = gridKeyMove(date, e.key, firstWeekday);
    if (!next) return;
    e.preventDefault();
    wantFocus.current = true;
    onChoose(next);
  };

  return (
    <div className="cal-month-layout">
      <section className="card cal-month" aria-label="Month">
        {data ? (
          <div ref={gridRef} role="grid" aria-label={monthTitle(chosen)} className="cal-grid">
            <div role="row" className="cal-grid-row cal-grid-head">
              {days.slice(0, 7).map((d) => (
                <div key={d.date} role="columnheader" className="cal-colhead">
                  <abbr title={weekdayLong(d.date)}>{weekdayShort(d.date)}</abbr>
                </div>
              ))}
            </div>
            {weeks.map((row, i) => (
              <div key={row[0]?.date ?? i} role="row" className="cal-grid-row">
                {row.map((d) => (
                  <Cell
                    key={d.date}
                    day={d}
                    chosen={chosen}
                    tabbable={tabbable}
                    today={data.today}
                    level={level}
                    onChoose={onChoose}
                    onKey={onKey}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="cal-grid cal-grid-loading" aria-hidden="true">
            {Array.from({ length: 35 }, (_, i) => (
              <span key={i} className="cal-cell cal-cell-skeleton" />
            ))}
          </div>
        )}
        {data && !monthHasEntries(days, chosen) && (
          <EmptyCard compact scope={data.scope} onShowAll={onShowAll}>
            Nothing this month.
          </EmptyCard>
        )}
      </section>
      <div className="cal-side">
        <section className="card cal-panel" aria-label={panelTitle} aria-busy={panelBusy || undefined}>
          <h3 className="cal-panel-title">{panelTitle}</h3>
          {panel}
        </section>
        {upcoming}
      </div>
    </div>
  );
}
