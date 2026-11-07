// Clinical Requirements Group C (PX-X-13): the alerts that follow the patient show in the safety strip, as colour +
// icon + words, with the button to add or end them for those who may. Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: null, error: null, loading: true, reload: () => {} }) }));
const { SafetyStrip } = await import('./SafetyStrip.jsx');
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const base = { id: 'p1', careType: 'antenatal', medical: { allergies: 'None known', bloodGroup: 'O+' } };

describe('alerts in the safety strip', () => {
  it('shows each alert with its note before the allergy and blood group', () => {
    const out = text(<SafetyStrip patient={{ ...base, alerts: [{ id: 'a1', label: 'Difficult airway', note: 'Short neck', byName: 'Sample nurse' }] }} />);
    expect(out).toMatch(/Difficult airway : Short neck.*No known allergies.*Blood group O\+/);
    expect(out).not.toContain('Alerts');
  });

  it('offers the button only to those who may write her chart', () => {
    expect(text(<SafetyStrip patient={base} canAlerts />)).toContain('Add an alert');
    expect(text(<SafetyStrip patient={{ ...base, alerts: [{ id: 'a1', label: 'Fall risk', note: '', byName: 'x' }] }} canAlerts />)).toContain('Alerts');
    expect(text(<SafetyStrip patient={{ id: 'p1', careType: 'antenatal' }} canAlerts />)).toBe('');
  });
});
