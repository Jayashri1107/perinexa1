// A date and a time with AM / PM (owner, 6 Nov 2026): the browser's own date-and-time box shows a 24-hour clock on many
// computers. The value is the same text as that box ("2026-11-06T14:30", this computer's time), and onChange gets an
// event-like { target: { value } }, so it drops in where <input type="datetime-local"> was.

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/** "2026-11-06T14:30" → { date: '2026-11-06', hour: '2', minute: '30', ampm: 'PM' } (blanks when empty). PURE. */
export function splitLocal(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return { date: '', hour: '', minute: '', ampm: 'AM' };
  const h = Number(m[2]);
  return { date: m[1], hour: String(h % 12 === 0 ? 12 : h % 12), minute: m[3], ampm: h >= 12 ? 'PM' : 'AM' };
}
/** The parts → "2026-11-06T14:30"; '' until the date and the hour are chosen (minutes default to 00). PURE. */
export function joinLocal({ date, hour, minute, ampm }) {
  if (!date || !hour) return '';
  const h = (Number(hour) % 12) + (ampm === 'PM' ? 12 : 0);
  return `${date}T${pad(h)}:${minute || '00'}`;
}

export function DateTimeInput({ id, value, onChange, max, className = '' }) {
  const parts = splitLocal(value);
  const set = (k) => (e) => onChange({ target: { value: joinLocal({ ...parts, [k]: e.target.value }) } });
  return (
    <span className={`datetime-input ${className}`.trim()}>
      <input id={id} type="date" value={parts.date} max={max ? max.slice(0, 10) : undefined} onChange={set('date')} />
      <select aria-label="Hour" value={parts.hour} onChange={set('hour')}>
        <option value="">hh</option>
        {HOURS.map((h) => (
          <option key={h} value={String(h)}>
            {h}
          </option>
        ))}
      </select>
      <select aria-label="Minutes" value={parts.minute} onChange={set('minute')}>
        <option value="">mm</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select aria-label="AM or PM" value={parts.ampm} onChange={set('ampm')}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}
