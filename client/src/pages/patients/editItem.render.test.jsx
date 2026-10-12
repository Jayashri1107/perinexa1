// "Edit item" for an item a doctor added to one patient's care plan (5 Oct 2026), rendered to HTML (no browser): the
// dialog filled from the item, its "When" for the plan's type of care, and the note about a moved date. Fake sample
// data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditItemDialog } from './carePlanDialogs.jsx';

// A dialog remembers which button opened it (document.activeElement): there is no page here, so nothing was focused.
beforeAll(() => vi.stubGlobal('document', { activeElement: null }));
afterAll(() => vi.unstubAllGlobals());

const html = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};

const plan = (over = {}) => ({
  id: 'plan1',
  careType: 'antenatal',
  status: 'active',
  canChangePlan: true,
  edd: '2027-03-01T00:00:00.000Z',
  dayZero: '2026-05-25T00:00:00.000Z',
  today: '2026-09-28T00:00:00.000Z',
  ...over,
});
const item = (over = {}) => ({
  id: 'i1',
  rev: 0,
  origin: 'custom',
  kind: 'investigation',
  name: 'Thyroid revew',
  patientText: 'Thyroid blood test',
  note: { text: 'Ask about tiredness', byName: 'Dr Sample', at: '2026-09-28T06:00:00.000Z' },
  status: 'upcoming',
  timing: { atBooking: false, fromWeek: 20, toWeek: 22, after: { key: null, weeks: null }, date: null, dateBy: null },
  manualDate: null,
  done: null,
  notNeeded: null,
  ...over,
});
const patient = { id: 'p1', careType: 'antenatal' };

describe('the Edit item dialog', () => {
  it('opens filled from the item, with the weeks shown as dates, and one primary button', () => {
    const out = html(<EditItemDialog patient={patient} plan={plan()} item={item()} onSaved={noop} onConflict={noop} onCancel={noop} />);
    const words = text(out);
    expect(words).toContain('Edit: Thyroid revew');
    expect(out).toContain('value="Thyroid revew"');
    expect(out).toContain('value="Thyroid blood test"');
    expect(out).toContain('>Ask about tiredness</textarea>');
    expect(words).toContain('Weeks of pregnancy');
    expect(out).toContain('value="20"');
    expect(out).toContain('value="22"');
    expect(words).toContain('12 Oct – 1 Nov 2026'); // 20 w 0 d – 22 w 6 d
    expect(words).toContain("Only this patient's plan changes; the item's history keeps what it was before.");
    expect(words).toContain('Nothing changed yet.');
    expect(out.match(/btn-primary/g)).toHaveLength(1);
    expect(words).toContain('Save changes');
    expect(out).not.toMatch(/!/);
  });

  it('a moved date is named, and replaced by a new due window; fixed dates; the weeks after delivery in a postnatal plan', () => {
    const moved = item({ manualDate: { dueFrom: '2026-10-12T00:00:00.000Z', dueBy: '2026-10-18T00:00:00.000Z', reason: '', byName: 'RMO Sample', at: '2026-09-28T06:00:00.000Z' } });
    expect(text(html(<EditItemDialog patient={patient} plan={plan()} item={moved} onSaved={noop} onConflict={noop} onCancel={noop} />))).toContain(
      'Its date was moved to 12–18 Oct 2026 by RMO Sample. A new due window replaces the moved date.',
    );
    const dated = item({ timing: { atBooking: false, fromWeek: null, toWeek: null, after: { key: null, weeks: null }, date: '2026-11-02T00:00:00.000Z', dateBy: '2026-11-08T00:00:00.000Z' } });
    const out = html(<EditItemDialog patient={patient} plan={plan()} item={dated} onSaved={noop} onConflict={noop} onCancel={noop} />);
    expect(out).toContain('value="2026-11-02"');
    expect(out).toContain('value="2026-11-08"');
    expect(out).toMatch(/id="edit-when-dates" type="radio" name="edit-when" checked=""/);
    const postnatal = plan({ careType: 'postnatal', startWord: 'delivery', edd: '2027-07-06T00:00:00.000Z', dayZero: '2026-09-29T00:00:00.000Z' });
    expect(text(html(<EditItemDialog patient={patient} plan={postnatal} item={item({ timing: { fromWeek: 1, toWeek: 2 } })} onSaved={noop} onConflict={noop} onCancel={noop} />))).toContain(
      'Weeks after delivery',
    );
  });
});
