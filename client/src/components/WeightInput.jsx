import { useEffect, useState } from 'react';

// A weight typed in kg or in grams (owner, 6 Nov 2026: "1.75" for a baby of 1.75 kg was refused as 1.75 g). What is
// stored and sent stays grams, as before; the person chooses the unit beside the box (kg by default) and sees the
// grams worked out. onChange gets an event-like { target: { value } } with the grams as text ('' when empty; what was
// typed when it is not a number, so the server's message shows), so it drops in where a plain input was.

const toText = (grams, unit) => {
  if (grams === '' || grams == null || !Number.isFinite(Number(grams))) return grams ?? '';
  return unit === 'kg' ? String(Number(grams) / 1000) : String(grams);
};
/** The grams from what was typed in this unit ('' when empty, the text itself when not a number). PURE. */
export function gramsFrom(text, unit) {
  const t = String(text).trim().replace(',', '.');
  if (!t) return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return String(Math.round(unit === 'kg' ? n * 1000 : n));
}

export function WeightInput({ id, value, onChange, className = '', ariaLabel, defaultUnit = 'kg' }) {
  const [unit, setUnit] = useState(defaultUnit);
  const [text, setText] = useState(() => toText(value, defaultUnit));
  // A new value from outside (the form was reset or reloaded): show it in the chosen unit
  useEffect(() => {
    if (gramsFrom(text, unit) !== String(value ?? '')) setText(toText(value, unit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const send = (t, u) => onChange({ target: { value: gramsFrom(t, u) } });
  const grams = gramsFrom(text, unit);
  return (
    <span className="weight-input">
      <input
        id={id}
        className={className}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          send(e.target.value, unit);
        }}
      />
      <select
        aria-label="Unit"
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value);
          send(text, e.target.value);
        }}
      >
        <option value="kg">kg</option>
        <option value="g">g</option>
      </select>
      {unit === 'kg' && grams && /^\d+$/.test(grams) && <span className="hint">{`= ${grams} g`}</span>}
    </span>
  );
}
