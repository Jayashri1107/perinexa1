// Words for "Time in hospital" (VisitTimeline.jsx) and the Waiting times page – pure functions, tested on their own.

/** The moments of her day, in order, as the line names them. */
export const MOMENTS = {
  registrationStart: 'Registration started',
  arrived: 'Arrived',
  registered: 'Registered',
  vitals: 'Vitals',
  rmo: 'RMO',
  doctor: 'Doctor',
  finished: 'Finished',
  paid: 'Bill paid',
  sold: 'Medicines',
};

/** Only a doctor sees one patient's time in hospital – never a super admin or platform admin (decision 3). */
export const canSeeTimeline = ({ isDoctor, isPlatform }) => Boolean(isDoctor) && !isPlatform;

/** "10:02" in the hospital's time (India). */
export function clockTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

/** "45 min", "1 h 32 min", "2 h"; "—" when not known. */
export function durationWords(minutes) {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * The line and the table of one visit: { moments: [{ key, at }] in time order, stages: [stages with minutes], total }.
 * A moment that is not known is left out; so is a stage.
 */
export function timelineParts(data) {
  const moments = Object.keys(MOMENTS)
    .filter((k) => data.moments?.[k])
    .map((k) => ({ key: k, at: data.moments[k] }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const stages = (data.stages ?? []).filter((s) => s.minutes != null && s.key !== 'wholeWithSale');
  const whole = (data.stages ?? []).find((s) => s.key === 'whole');
  return { moments, stages: stages.filter((s) => s.key !== 'whole'), total: whole?.minutes ?? null };
}
