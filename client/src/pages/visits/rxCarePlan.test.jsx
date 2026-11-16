// The care plan on the prescription (doctor's request, 16 Nov 2026): what was ticked done at this visit is printed
// with the items due by the next visit, on every design, and neither when the design's switch is off.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RxDocument } from './RxDocument.jsx';
import { RX_DESIGNS, RX_SHOW } from './rxFormat.js';
import { SAMPLE } from './rxSample.js';

const design = (key, planItems = true) => ({
  design: key,
  accent: 'indigo',
  textSize: 'standard',
  paper: key === 'half_page' ? 'A5' : 'A4',
  language: 'en',
  capitals: false,
  specialities: '',
  timings: '',
  footerNote: '',
  marginTopMm: 45,
  marginBottomMm: 20,
  show: { ...Object.fromEntries(RX_SHOW.map((k) => [k, true])), planItems },
});
const print = (key, { planItems = true, nextVisitOn = SAMPLE.visit.details.nextVisitOn } = {}) =>
  renderToStaticMarkup(
    <RxDocument
      design={design(key, planItems)}
      letterhead={{ name: 'Demo Hospital' }}
      doctor={{ name: 'Dr Sample', professional: {} }}
      patient={SAMPLE.patient}
      visit={{ ...SAMPLE.visit, details: { ...SAMPLE.visit.details, nextVisitOn } }}
      pregnancy={SAMPLE.pregnancy}
      nextDue={SAMPLE.nextDue}
      doneToday={[{ text: 'Thyroid test' }, { text: 'Dating scan' }]}
      printedAt={new Date('2026-09-28T10:30:00')}
      printedByName="Dr Sample"
    />,
  );

describe('the care plan on the prescription', () => {
  it.each(RX_DESIGNS)('the %s design prints what was done at this visit and what is due next', (key) => {
    const html = print(key);
    expect(html).toContain('Done at this visit');
    expect(html).toContain('Thyroid test');
    expect(html).toContain('Dating scan');
    expect(html).toContain(SAMPLE.nextDue[0].text);
  });

  it('prints the done items even without a next visit date', () => {
    expect(print('classic', { nextVisitOn: null })).toContain('Thyroid test');
  });

  it('prints neither when the design leaves the care-plan items out', () => {
    const html = print('classic', { planItems: false });
    expect(html).not.toContain('Done at this visit');
    expect(html).not.toContain('Thyroid test');
  });
});
