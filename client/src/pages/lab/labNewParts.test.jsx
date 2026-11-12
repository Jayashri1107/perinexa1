import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { bigChangeWords, waitedWords } from './labFormat.js';
import { eddOf, hoursOld, weeksOn } from './LabTrends.jsx';
import { LabRegistrationPage } from './LabRegistrationPage.jsx';

// The lab's parts of 12 Nov 2026 (docs/LAB_BUILD_NOTE.md P6 and P9, and the simpler Lab → New). Fake data only.
describe('the lab helpers', () => {
  it('how long an order waited, in plain words', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(waitedWords('2026-11-12T11:35:00Z', now)).toBe('25 min');
    expect(waitedWords('2026-11-12T08:50:00Z', now)).toBe('3 h 10 min');
    expect(waitedWords('2026-11-10T08:00:00Z', now)).toBe('2 days 4 h');
  });
  it('a big change in per cent, or by the amount when there is no per cent', () => {
    expect(bigChangeWords({ deltaPercent: -18.6, deltaAmount: -2.2 }, 'g/dL')).toBe('−18.6 %');
    expect(bigChangeWords({ deltaAmount: 3 }, 'mg/dL')).toBe('+3 mg/dL');
  });
  it('weeks of pregnancy under a date, and a baby’s age in hours', () => {
    const edd = eddOf({ pregnancy: { scanEdd: '2027-01-05' } });
    expect(weeksOn(edd, '2026-11-10T06:00:00Z')).toBe('32w');
    expect(weeksOn(null, '2026-11-10')).toBe('');
    expect(hoursOld('2026-11-10T00:00:00Z', '2026-11-11T12:00:00Z')).toBe(36);
  });
});

describe('Lab → New patient test', () => {
  it('four plain steps, a New patient button, and the save button says what is missing', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LabRegistrationPage />
      </MemoryRouter>,
    );
    for (const words of ['Patient', 'Doctor and tests', 'Sample', 'Payment', 'New patient', 'Choose or register the patient', 'Now, at the lab', 'At her home']) expect(html).toContain(words);
    expect(html).not.toContain('Aadhaar');
    expect(html).not.toContain('Department');
  });
});
