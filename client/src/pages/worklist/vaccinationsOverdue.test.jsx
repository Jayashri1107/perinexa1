// "Vaccinations overdue" on the Today page (doctors, RMOs, nurses): the box with its heading and count (rendered to
// HTML, no browser). The rows open with a click, as every list on Today. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VaccinationDetails, VaccinationsOverdueSection } from './WorklistSections.jsx';

const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const row = (id, fullName, extra = {}) => ({
  patient: { id, fullName, mrn: `P-00000${id}`, careType: 'newborn', gestationalAge: null, risk: null, assignedDoctorName: 'Sample Doctor' },
  phone: '98765 43210',
  items: [{ itemId: 'i1', name: 'Birth doses: BCG, OPV-0, Hepatitis B (birth dose)', dueBy: '2026-10-07T00:00:00.000Z' }],
  draft: false,
  bookedFor: null,
  ...extra,
});

describe('VaccinationsOverdueSection', () => {
  it('shows the heading and how many babies; closed until it is clicked', () => {
    const html = renderToStaticMarkup(<VaccinationsOverdueSection data={{ vaccinationsOverdue: [row('1', 'Baby One'), row('2', 'Baby Two', { draft: true })] }} />);
    expect(text(<VaccinationsOverdueSection data={{ vaccinationsOverdue: [row('1', 'Baby One'), row('2', 'Baby Two')] }} />)).toContain('Vaccinations overdue 2');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="2 items"');
    expect(html).not.toContain('Baby One'); // names and vaccines appear only when the box is opened
  });

  it('with no babies, or an answer from before the list existed, it shows a count of 0', () => {
    expect(text(<VaccinationsOverdueSection data={{ vaccinationsOverdue: [] }} />)).toContain('Vaccinations overdue 0');
    expect(text(<VaccinationsOverdueSection data={{}} />)).toContain('Vaccinations overdue 0');
  });
});

describe('a baby\'s row, opened', () => {
  it('shows how many are overdue, each vaccine with its last day, whether the baby is booked, and the phone', () => {
    const shown = text(<VaccinationDetails row={row('1', 'Baby One', { bookedFor: '2026-10-12' })} />);
    expect(shown).toContain('Overdue 1');
    expect(shown).toContain('Birth doses: BCG, OPV-0, Hepatitis B (birth dose) by 7 Oct 2026');
    expect(shown).toContain('Booked for 12 Oct 2026');
    expect(shown).toContain('98765 43210');
    expect(shown).not.toContain('Draft plan');
    expect(renderToStaticMarkup(<VaccinationDetails row={row('1', 'Baby One')} />)).toContain('href="tel:9876543210"');
  });

  it('marks a plan built from a schedule no doctor approved – in words, not only colour', () => {
    const shown = text(<VaccinationDetails row={row('2', 'Baby Two', { draft: true, phone: '' })} />);
    expect(shown).toContain('Draft plan');
    expect(shown).toContain('No appointment booked');
    expect(renderToStaticMarkup(<VaccinationDetails row={row('2', 'Baby Two', { draft: true, phone: '' })} />)).not.toContain('tel:');
  });
});
