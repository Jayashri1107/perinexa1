import { useCallback, useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { AiBriefCard } from '../ai/AiBriefCard.jsx';
import { calendarBriefBody } from '../ai/briefParts.js';
import { firstOfMonth, panelDayTitle, parseIso, rangeTitle, sameMonth, stepDate } from './calendarDates.js';
import {
  CALENDAR_VIEWS,
  allowedTypesFor,
  defaultScopeFor,
  isReceptionOnly,
  parseScope,
  parseTypes,
  personLevel,
  serializeTypes,
  subtitleFor,
  todayParams,
} from './calendarFormat.js';
import { CalendarToolbar } from './CalendarToolbar.jsx';
import { DayView, EmptyCard } from './DayView.jsx';
import { MonthView } from './MonthView.jsx';
import { WeekView } from './WeekView.jsx';

// The calendar: booked next visits, care-plan visits, EDD and LMP by day, week and month (GET /api/calendar).
// The server owns the hospital's today, the range and who sees what; this page never reads the computer's
// clock – it steps from the day in the server's answer. View, day, types and patients are kept in the address.

const STALE_MS = 5 * 60 * 1000; // back on the tab after this long: load again (a screen left open past midnight)

function Placeholder() {
  const columns = [
    { key: 'patient', header: 'Patient' },
    { key: 'details', header: 'Details' },
    { key: 'status', header: 'Status' },
  ];
  return <DataTable caption="Calendar entries" columns={columns} rows={undefined} loading />;
}

export function CalendarPage() {
  const { activeMembership } = useAuth();
  const location = useLocation();
  const roles = activeMembership?.roles ?? [];
  const level = personLevel(roles);
  const allowed = allowedTypesFor(roles);
  const roleScope = defaultScopeFor(roles);
  const defaultView = isReceptionOnly(roles) ? 'day' : 'week';
  const [params, setParams] = useListParams({ view: defaultView, date: '', types: '', scope: '' });

  const view = CALENDAR_VIEWS.includes(params.view) ? params.view : null; // an unknown view is sent as it is: the server explains
  const types = parseTypes(params.types, allowed);
  const typesParam = serializeTypes(types, allowed);
  // Patients: only a doctor has the switch; a copied scope=mine for anyone else is ignored (as types are).
  const scopeParam = parseScope(params.scope, roles);
  const monthKey = params.date && parseIso(params.date) ? firstOfMonth(params.date) : params.date;

  // Day and week: the entries. Month: the counts of the month (the chosen day's entries come from `panel`).
  const main = useFetch('/calendar', { view: params.view, date: view === 'month' ? monthKey : params.date, types: typesParam, scope: scopeParam });
  const panel = useFetch(view === 'month' ? '/calendar' : null, { view: 'day', date: params.date, types: typesParam, scope: scopeParam });
  const { reload: reloadMain } = main;
  const { reload: reloadPanel } = panel;

  // Nothing from an answer is shown while there is an error (e.g. after a role or hospital change).
  const failed = main.error ? main : view === 'month' && panel.error ? panel : null;
  const answer = !failed && main.data?.view === view ? main.data : null;
  // The day everything steps from: the one in the address, else the server's today (never the computer's clock).
  // (While a new answer loads, an older one counts only when it was for today.)
  const resolved = params.date || (answer && (!main.loading || answer.date === answer.today) ? answer.date : null);
  const chosen = view === 'month' ? resolved : null;
  // The grid shows counts only for the chosen day's month. While another month loads (‹ ›, Page Up/Down, arrows
  // past the edge, an outside day, Today) it shows skeleton cells, never an older month under the new title.
  const monthAnswer = view === 'month' && answer && sameMonth(answer.date, chosen) ? answer : null;
  const panelAnswer = !failed && chosen && panel.data?.view === 'day' && panel.data.date === chosen ? panel.data : null;

  // Coming back to the tab after a while (e.g. the next morning): load again, so Today moves.
  const lastLoad = useRef(performance.now());
  useEffect(() => {
    if (main.data) lastLoad.current = performance.now();
  }, [main.data]);
  const reloadAll = useCallback(() => {
    reloadMain();
    reloadPanel();
  }, [reloadMain, reloadPanel]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || performance.now() - lastLoad.current <= STALE_MS) return;
      lastLoad.current = performance.now();
      reloadAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reloadAll]);

  const scope = answer?.scope ?? (scopeParam || roleScope);
  const canChooseScope = answer?.canChooseScope ?? roles.includes('doctor');
  const setScope = (s) => setParams({ scope: s === roleScope ? '' : s });
  const onShowAll = canChooseScope ? () => setScope('all') : undefined;
  // After a 400: clear the day, and a view or patients value the server cannot use (valid choices stay).
  const goToToday = () => setParams(todayParams(params, roles));

  const title = !view
    ? ''
    : view === 'month'
      ? chosen
        ? rangeTitle('month', null, null, chosen)
        : ''
      : answer
        ? rangeTitle(view, answer.from, answer.to, answer.date)
        : '';

  // The address of a day's day view, keeping the types and patients chosen.
  const dayHref = (date) => {
    const sp = new URLSearchParams(location.search);
    if (defaultView === 'day') sp.delete('view');
    else sp.set('view', 'day');
    sp.set('date', date);
    return `/calendar?${sp}`;
  };

  const incomplete = answer?.countsIncomplete || panelAnswer?.countsIncomplete;
  const pending = Math.max(answer?.plansPending ?? 0, panelAnswer?.plansPending ?? 0);

  let body = null;
  if (failed) {
    if (failed.status === 403) {
      body = (
        <section className="card narrow acc-message">
          <span className="acc-message-icon" aria-hidden="true">
            <Lock />
          </span>
          <p>{failed.error}</p>
        </section>
      );
    } else if (failed.status === 400) {
      body = (
        <Alert type="error">
          {failed.error}{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={goToToday}>
            Go to today
          </button>
        </Alert>
      );
    } else {
      body = (
        <Alert type="error">
          The calendar could not be loaded.{' '}
          <button type="button" className="btn btn-link plan-inline-link" onClick={reloadAll}>
            Try again
          </button>
        </Alert>
      );
    }
  } else if (view === 'month') {
    body = (
      <MonthView
        data={monthAnswer}
        chosen={chosen}
        level={level}
        onChoose={(date) => setParams({ date })}
        onShowAll={onShowAll}
        panelTitle={chosen ? panelDayTitle(chosen, answer?.today) : 'Chosen day'}
        panelBusy={panel.loading}
        panel={panelAnswer ? <DayView data={panelAnswer} level={level} compact onShowAll={onShowAll} /> : <p className="cal-note">Loading…</p>}
      />
    );
  } else if (view === 'week') {
    body = !answer ? (
      <Placeholder />
    ) : answer.events.length === 0 ? (
      <EmptyCard scope={answer.scope} onShowAll={onShowAll}>
        Nothing this week.
      </EmptyCard>
    ) : (
      <WeekView data={answer} level={level} dayHref={dayHref} />
    );
  } else if (view === 'day') {
    body = answer ? <DayView data={answer} loading={main.loading} level={level} onShowAll={onShowAll} /> : <Placeholder />;
  }

  return (
    <>
      <PageHeader breadcrumbs={[{ label: 'Calendar' }]} title="Calendar" documentTitle="Calendar" subtitle={subtitleFor(level, scope)} />
      <div className="pf-content cal-page">
        {failed?.status !== 403 && (
          <CalendarToolbar
            view={view ?? defaultView}
            onView={(v) => setParams({ view: v })}
            title={title}
            loading={main.loading}
            canStep={Boolean(view && resolved && parseIso(resolved))}
            onStep={(dir) => setParams({ date: stepDate(view, resolved, dir) })}
            onToday={() => setParams({ date: '' })}
            canChooseScope={canChooseScope}
            scope={scope}
            onScope={setScope}
            allowed={allowed}
            types={types}
            onTypes={(list) => setParams({ types: serializeTypes(list, allowed) })}
            level={level}
          />
        )}
        {!failed && incomplete && (
          <Alert type="warning">There are too many entries to count them all. Counts and lists may be incomplete – open a week or a day.</Alert>
        )}
        {!failed && pending > 0 && <Alert type="info">Some care plans are being updated – reload in a minute.</Alert>}
        {/* The AI brief of the dates shown (doctors and RMOs): the same view, day, types and patients */}
        {!failed && view && level === 'clinical' && (
          <AiBriefCard
            endpoint="/ai/brief/calendar"
            body={calendarBriefBody({ view, date: view === 'month' ? chosen : resolved, types: typesParam, scope: scopeParam })}
            resetKey={`${view}:${view === 'month' ? (chosen ?? '').slice(0, 7) : (resolved ?? '')}:${typesParam}:${scopeParam}`}
            intro="What to look at in these dates."
          />
        )}
        {body}
      </div>
    </>
  );
}
