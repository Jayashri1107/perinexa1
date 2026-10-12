import { Router } from 'express';
import { daysBetween, hospitalToday, isoDay } from '../careplans/dates.js';
import { refreshStalePlans } from '../careplans/plansService.js';
import { refreshDueRisks } from '../careplans/templatesService.js';
import { allowedTypes, canChooseScope, defaultScope } from '../calendar/calendarAccess.js';
import { loadCalendar } from '../calendar/calendarLoad.js';
import { rangeFor } from '../calendar/calendarRange.js';
import { CALENDAR_ROLES, EVENT_TYPES, MAX_DAYS_FROM_TODAY } from '../calendar/calendarRules.js';
import { calendarQuerySchema } from '../calendar/calendarSchemas.js';
import { hasRole } from '../models/Membership.js';
import { HttpError } from '../utils/httpError.js';
import { parse } from '../utils/validate.js';

// The calendar: GET /api/calendar?view=day|week|month&date=YYYY-MM-DD&types=booked,plan,edd,lmp&scope=mine|all
// Booked next visits, care-plan visits, EDD and LMP by day, week and month (docs: calendar spec).
// The server owns the hospital's "today" and the range; the website shows what it gets.
// Not audited, like the patient list: opening a patient from the calendar is audited as before.

export const calendarRouter = Router();

calendarRouter.use((req, _res, next) => {
  if (!hasRole(req.membership, ...CALENDAR_ROLES)) {
    throw new HttpError(403, "Your role in this hospital doesn't include the calendar.", 'FORBIDDEN');
  }
  next();
});

const badRequest = (message) => new HttpError(400, message, 'VALIDATION');

calendarRouter.get('/', async (req, res) => {
  const q = parse(calendarQuerySchema, req.query);
  const today = hospitalToday(req.now);
  const date = q.date ?? today;
  if (Math.abs(daysBetween(today, date)) > MAX_DAYS_FROM_TODAY) throw badRequest('Please choose a date within 10 years of today.');

  const allowed = allowedTypes(req);
  const asked = q.types ?? allowed;
  if (asked.some((t) => !allowed.includes(t))) throw new HttpError(403, "Your role doesn't include pregnancy dates.", 'FORBIDDEN');
  const types = EVENT_TYPES.filter((t) => asked.includes(t));

  const scope = q.scope ?? defaultScope(req);
  if (scope === 'mine' && !hasRole(req.membership, 'doctor')) throw badRequest('Only doctors have their own patient list. Choose All patients.');

  const [from, to] = rangeFor(q.view, date);

  // Care-plan visits come from stored plans: bring risk levels and plans that are behind up to date first.
  let plansPending = 0;
  if (types.includes('plan')) {
    await refreshDueRisks(req.tenantId, req.now);
    ({ pending: plansPending } = await refreshStalePlans(req.tenantId, req.now));
  }

  const { patients, events, days, countsIncomplete } = await loadCalendar(req, { view: q.view, from, to, types, scope });
  res.json({
    view: q.view,
    date: isoDay(date),
    from: isoDay(from),
    to: isoDay(to),
    today: isoDay(today),
    scope,
    types,
    canChooseScope: canChooseScope(req),
    patients,
    events,
    days,
    countsIncomplete,
    plansPending,
  });
});
