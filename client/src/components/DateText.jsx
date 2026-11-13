import { useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { isoToTyped, typedToIso, typingDate } from './dateTyped.js';

/**
 * A date box that is typed (13 Nov 2026, the pharmacy: quicker than a calendar): dd/mm/yyyy, the slashes added while
 * typing, with a small calendar button for those who prefer to pick. value and onChange use 'YYYY-MM-DD' like a date
 * input; onChange is called only with a real date inside min and max. A date not yet complete or wrong is marked and
 * goes back to the last good one when the box is left.
 */
export function DateText({ id, value, onChange, min, max, disabled = false, required = false, className = '', 'aria-label': ariaLabel, ...rest }) {
  const [text, setText] = useState(isoToTyped(value));
  const [shownFor, setShownFor] = useState(value);
  const picker = useRef(null);
  // The value changed from outside (a quick choice, the calendar): show it
  if (value !== shownFor) {
    setShownFor(value);
    setText(isoToTyped(value));
  }
  const inRange = (iso) => (!min || iso >= min) && (!max || iso <= max);
  const parsed = typedToIso(text);
  const wrong = text.trim() !== '' && (!parsed || !inRange(parsed));
  const type = (e) => {
    const next = typingDate(e.target.value, text);
    setText(next);
    const iso = typedToIso(next);
    if (iso && inRange(iso) && iso !== value) {
      setShownFor(iso);
      onChange(iso);
    }
  };
  const open = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <span className={`date-text ${className}`.trim()}>
      <input
        {...rest}
        id={id}
        value={text}
        placeholder="dd/mm/yyyy"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={wrong || undefined}
        onChange={type}
        onBlur={() => wrong && setText(isoToTyped(value))}
      />
      <button type="button" className="date-text-pick" onClick={open} disabled={disabled} aria-label="Choose from a calendar" tabIndex={-1}>
        <CalendarDays aria-hidden="true" />
      </button>
      <input
        ref={picker}
        type="date"
        className="date-text-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => e.target.value && inRange(e.target.value) && onChange(e.target.value)}
      />
    </span>
  );
}
