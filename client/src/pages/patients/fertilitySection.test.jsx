// The "Fertility history" section of the patient form (rendered to HTML, no browser): every choice list, the numbers,
// the diagnoses and the texts are on it, with "not recorded" as the first choice. All fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FertilitySection } from './FertilitySection.jsx';
import { DIAGNOSIS_LABELS, FERTILITY_CHOICES, FERTILITY_NUMBER_FIELDS, FERTILITY_TEXT_FIELDS, fertilityValues } from './fertilityFormat.js';

const render = (stored) => renderToStaticMarkup(<FertilitySection values={fertilityValues(stored)} set={() => {}} fe={() => undefined} />);
const optionsOf = (html, id) => {
  const select = html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`, 's'))[1];
  return [...select.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], attrs: m[2], label: m[3] }));
};

describe('the fertility history section', () => {
  it('offers every list with "Not recorded" first, every number and text, and the diagnoses as tick boxes', () => {
    const html = render(null);
    for (const c of FERTILITY_CHOICES) {
      const options = optionsOf(html, `fert-${c.key}`);
      expect(options[0]).toMatchObject({ value: '', label: 'Not recorded' });
      expect(options.slice(1).map((o) => o.value)).toEqual(Object.keys(c.labels));
    }
    for (const n of FERTILITY_NUMBER_FIELDS) expect(html).toContain(`id="fert-${n.key}"`);
    for (const t of FERTILITY_TEXT_FIELDS) expect(html).toContain(`id="fert-${t.key}"`);
    for (const label of Object.values(DIAGNOSIS_LABELS)) expect(html).toContain(label.replace(/'/g, '&#x27;'));
    expect(html).toContain('Fertility history');
    expect(html).not.toMatch(/!/);
  });

  it('shows what is stored', () => {
    const html = render({ type: 'secondary', tubes: 'hydrosalpinx', diagnoses: ['pcos'], amh: 1.2, previousTreatment: 'Three cycles elsewhere' });
    expect(optionsOf(html, 'fert-type').find((o) => o.value === 'secondary').attrs).toMatch(/selected/);
    expect(optionsOf(html, 'fert-tubes').find((o) => o.value === 'hydrosalpinx').attrs).toMatch(/selected/);
    expect(html).toContain('value="1.2"');
    expect(html).toContain('Three cycles elsewhere');
    expect(html).toMatch(/type="checkbox" checked=""[^>]*\/> PCOS/);
  });
});
