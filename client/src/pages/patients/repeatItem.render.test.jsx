// An item a protocol change added that may repeat one the plan already had ("May repeat …", 5 Oct 2026): its Details
// dialog names the other item and offers Keep as planned, and the history says what was kept. Rendered to HTML (no
// browser). Fake sample data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ItemDetailsDialog } from './carePlanDialogs.jsx';

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

const plan = { id: 'plan1', careType: 'antenatal', status: 'active', canEdit: true, edd: '2027-03-01T00:00:00.000Z', today: '2026-09-28T00:00:00.000Z', template: { approved: true } };
const patient = { id: 'p1', careType: 'antenatal' };
const repeat = (over = {}) => ({
  id: 'i2',
  rev: 0,
  key: 'lab_vitd',
  origin: 'template',
  kind: 'investigation',
  name: 'Vitamin D level',
  patientText: '',
  status: 'due',
  timingText: 'At booking',
  flags: ['possible_duplicate'],
  possibleDuplicate: { withItemId: 'i1', withName: 'Vitamin D test' },
  manualDate: null,
  done: null,
  notNeeded: null,
  history: [],
  ...over,
});

describe('an added item that may repeat another', () => {
  it('names the other item, says what to do, and offers Keep as planned (a secondary button)', () => {
    const out = html(<ItemDetailsDialog patient={patient} plan={plan} item={repeat()} onSaved={noop} onConflict={noop} onCancel={noop} />);
    const words = text(out);
    expect(words).toContain('May repeat “Vitamin D test”');
    expect(out).toMatch(/pill-watch[^>]*><svg[^>]*lucide-copy-plus/); // colour + icon + word
    expect(words).toContain('A protocol change added this item while the plan already had “Vitamin D test”, which may be the same. Mark one of the two not needed, or keep both as planned.');
    expect(words).not.toContain("The dates or the patient's details changed");
    expect(out).toMatch(/btn btn-secondary[^>]*>.*?Keep as planned<\/button>/);
    expect(out).not.toMatch(/!|btn-primary/);
  });

  it('once kept, no flag is left and the history says beside which item it was kept', () => {
    const kept = repeat({
      flags: [],
      possibleDuplicate: null,
      history: [{ at: '2026-09-28T06:00:00.000Z', byName: 'Dr Sample', action: 'keep', from: { possibleDuplicate: { withItemId: 'i1', withName: 'Vitamin D test' } }, to: null, reason: 'Kept as planned' }],
    });
    const words = text(html(<ItemDetailsDialog patient={patient} plan={plan} item={kept} onSaved={noop} onConflict={noop} onCancel={noop} />));
    expect(words).not.toContain('May repeat');
    expect(words).toContain('Kept as planned – beside “Vitamin D test”');
    expect(words).not.toContain('Kept as planned – beside “Vitamin D test” · Kept as planned'); // the label is not said twice
  });
});
