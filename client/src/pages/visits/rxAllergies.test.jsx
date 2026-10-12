// Allergies are printed with the patient's details on every prescription design (rendered to HTML, no browser).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { allergyPrintLine } from '../patients/patientFormat.js';
import { RxDocument } from './RxDocument.jsx';
import { RX_DESIGNS, RX_SHOW } from './rxFormat.js';
import { SAMPLE } from './rxSample.js';

const design = (key) => ({
  design: key,
  accent: 'indigo',
  textSize: 'standard',
  paper: key === 'half_page' ? 'A5' : 'A4',
  language: 'mr',
  capitals: false,
  specialities: '',
  timings: '',
  footerNote: '',
  marginTopMm: 45,
  marginBottomMm: 20,
  show: Object.fromEntries(RX_SHOW.map((k) => [k, true])),
});
const print = (key, allergies) =>
  renderToStaticMarkup(
    <RxDocument
      design={design(key)}
      letterhead={{ name: 'Demo Hospital' }}
      doctor={{ name: 'Dr Sample', professional: {} }}
      patient={{ ...SAMPLE.patient, allergies }}
      visit={SAMPLE.visit}
      pregnancy={SAMPLE.pregnancy}
      nextDue={SAMPLE.nextDue}
      printedAt={new Date('2026-09-28T10:30:00')}
      printedByName="Dr Sample"
    />,
  );

describe('allergies on the prescription', () => {
  it.each(RX_DESIGNS)('the %s design prints them', (key) => {
    const html = print(key, 'Penicillin – rash');
    expect(html).toContain('Allergies');
    expect(html).toContain('Penicillin – rash');
  });

  it('the line: the allergy, "None known" or "Not recorded"; nothing without medical details or for a newborn', () => {
    const p = (allergies, extra = {}) => ({ careType: 'antenatal', medical: { allergies }, ...extra });
    expect(allergyPrintLine(p(' Sulfa '))).toBe('Sulfa');
    expect(allergyPrintLine(p('nil'))).toBe('None known');
    expect(allergyPrintLine(p(''))).toBe('Not recorded');
    expect(allergyPrintLine({ careType: 'antenatal' })).toBeNull();
    expect(allergyPrintLine(p('Sulfa', { careType: 'newborn' }))).toBeNull();
  });
});
