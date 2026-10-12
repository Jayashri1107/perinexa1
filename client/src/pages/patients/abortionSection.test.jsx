// The "Pregnancy loss" section of the patient form (rendered to HTML, no browser): a threatened miscarriage is no
// longer a type of loss (owner, 3 Oct 2026: it stays under Antenatal), and a record saved before still shows what it
// holds, with what to do. All fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AbortionSection, abortionPayload, abortionValues } from './AbortionSection.jsx';
import { RETIRED_LOSS_MESSAGE, THREATENED_HINT } from './abortionFormat.js';

const render = (stored) =>
  renderToStaticMarkup(
    <AbortionSection values={abortionValues(stored)} set={() => {}} bloodGroup="A+" fe={() => undefined} vc={() => undefined} vm={() => null} fromAntenatal={false} storedSeen="" />,
  );
const optionsOf = (html, id) => {
  const select = html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`, 's'))[1];
  return [...select.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], attrs: m[2], label: m[3] }));
};
const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe('the pregnancy-loss section', () => {
  it('offers no threatened miscarriage and no "pregnancy continuing", and says where a threatened miscarriage goes', () => {
    const html = words(render(null));
    expect(optionsOf(html, 'ab-lossType').map((o) => o.value)).toEqual(['', 'inevitable', 'incomplete', 'complete', 'missed', 'septic', 'ectopic', 'molar', 'recurrent']);
    expect(optionsOf(html, 'ab-outcome').map((o) => o.value)).not.toContain('continuing');
    expect(html).toContain(THREATENED_HINT);
    expect(html).not.toContain(RETIRED_LOSS_MESSAGE);
  });

  it('an old threatened-miscarriage record shows what it holds (nothing changed silently) and what to do', () => {
    const old = { lossType: 'threatened', lmp: '2026-08-02T00:00:00.000Z', presentedOn: '2026-09-21T00:00:00.000Z', management: { method: 'medicines', outcome: 'continuing' } };
    const html = words(render(old));
    expect(html).toContain(RETIRED_LOSS_MESSAGE);
    const type = optionsOf(html, 'ab-lossType').find((o) => o.value === 'threatened');
    expect(type.label).toBe('Threatened miscarriage (now recorded under Antenatal)');
    expect(type.attrs).toMatch(/disabled/); // shown, but cannot be chosen again
    expect(optionsOf(html, 'ab-method').find((o) => o.value === 'medicines').label).toBe("Medicines (doctor's choice)");
    expect(optionsOf(html, 'ab-outcome').find((o) => o.value === 'continuing').label).toBe('Pregnancy continuing (now recorded under Antenatal)');
    expect(html).toContain('id="ab-lmp"'); // the LMP stays on show
    // Saved as it is, the same values go to the server (which refuses them with the message above)
    expect(abortionPayload(abortionValues(old))).toMatchObject({ lossType: 'threatened', management: { method: 'medicines', outcome: 'continuing' } });
  });
});
