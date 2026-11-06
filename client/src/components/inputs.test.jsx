// A weight in kg or grams, and a date and time with AM / PM (owner, 6 Nov 2026). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateTimeInput, joinLocal, splitLocal } from './DateTimeInput.jsx';
import { WeightInput, gramsFrom } from './WeightInput.jsx';

describe('weight in kg or g', () => {
  it('1.75 kg is 1750 g; grams stay grams; a comma works; empty stays empty', () => {
    expect(gramsFrom('1.75', 'kg')).toBe('1750');
    expect(gramsFrom('1,75', 'kg')).toBe('1750');
    expect(gramsFrom('3.105', 'kg')).toBe('3105');
    expect(gramsFrom('2900', 'g')).toBe('2900');
    expect(gramsFrom('', 'kg')).toBe('');
    expect(gramsFrom('abc', 'kg')).toBe('abc'); // the server's message shows
  });

  it('shows a stored 1750 g as 1.75 kg with the grams beside it', () => {
    const out = renderToStaticMarkup(<WeightInput id="w" value="1750" onChange={() => {}} />);
    expect(out).toContain('value="1.75"');
    expect(out).toContain('= 1750 g');
    expect(out).toContain('<option value="kg" selected="">kg</option>');
  });
});

describe('date and time with AM / PM', () => {
  it('splits and joins the browser time text', () => {
    expect(splitLocal('2026-11-06T14:30')).toEqual({ date: '2026-11-06', hour: '2', minute: '30', ampm: 'PM' });
    expect(splitLocal('2026-11-06T00:05')).toEqual({ date: '2026-11-06', hour: '12', minute: '05', ampm: 'AM' });
    expect(splitLocal('2026-11-06T12:00')).toMatchObject({ hour: '12', ampm: 'PM' });
    expect(joinLocal({ date: '2026-11-06', hour: '2', minute: '30', ampm: 'PM' })).toBe('2026-11-06T14:30');
    expect(joinLocal({ date: '2026-11-06', hour: '12', minute: '', ampm: 'AM' })).toBe('2026-11-06T00:00');
    expect(joinLocal({ date: '2026-11-06', hour: '12', minute: '15', ampm: 'PM' })).toBe('2026-11-06T12:15');
    expect(joinLocal({ date: '', hour: '3', minute: '00', ampm: 'AM' })).toBe('');
  });

  it('offers hours 1–12 and AM / PM', () => {
    const out = renderToStaticMarkup(<DateTimeInput id="t" value="2026-11-06T21:45" onChange={() => {}} />);
    expect(out).toContain('<option value="9" selected="">9</option>');
    expect(out).toContain('<option value="PM" selected="">PM</option>');
    expect(out).not.toContain('datetime-local');
  });
});
