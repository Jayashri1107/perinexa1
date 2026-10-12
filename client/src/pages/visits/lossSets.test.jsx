// The ready-made prescription sets for pregnancy-loss care (5 Oct 2026): where they are chosen and in the library,
// the note on what they are for and what is left out on purpose. Rendered to HTML (react-dom/server) from fake
// answers – the website has no browser test setup. All fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A dialog remembers which button opened it (document.activeElement): there is no page here, so nothing was focused.
beforeAll(() => vi.stubGlobal('document', { activeElement: null }));
afterAll(() => vi.unstubAllGlobals());

const answers = {};
vi.mock('../../hooks/useFetch.js', () => ({
  useFetch: (path) => ({ data: path ? (answers[path] ?? null) : null, loading: false, error: null, status: null, reload: () => {} }),
}));
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ activeMembership: { roles: ['doctor'], tenantName: 'Sample Hospital' }, user: { name: 'Dr Sample' } }) }));

const { SetPicker } = await import('./SetDialogs.jsx');
const { PrescriptionSetsPage } = await import('./PrescriptionSetsPage.jsx');
const { LOSS_SETS_NOTE, THREATENED_NOTE, lossSetWarning } = await import('./PrescriptionSetParts.jsx');

const item = (drug, more = {}) => ({ id: `i-${drug}`, drug, form: 'tab', strength: '', dose: '1', frequency: 'sos', frequencyText: '', timing: '', route: '', durationValue: null, durationUnit: '', instructions: '', ...more });
const set = (key, name, careTypes, items, more = {}) => ({
  id: `s-${key}`, key, origin: 'built_in', name, about: '', careTypes, items, notes: '', investigations: '', advice: '', order: 10, isActive: true,
  status: 'draft', version: 1, approvedByName: null, approvedAt: null, approvedVersion: null, updatedAt: '2026-10-05T05:00:00.000Z', updatedByName: 'Built-in draft', ...more,
});
const SETS = [
  set('anc_first_trimester', 'First trimester – routine care', ['antenatal'], [item('Folic acid')]),
  set('loss_missed_medical', 'Missed miscarriage (diagnosed) – medical management with misoprostol', ['abortion'], [item('Misoprostol', { strength: '200 mcg', dose: '4', frequency: 'custom', frequencyText: 'One dose', route: 'vaginal' })], { order: 140 }),
];
const words = (html) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const render = (node) => words(renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>));
const picker = (careType) => render(<SetPicker patient={{ id: 'p1', careType }} rows={[]} careLabel={careType === 'abortion' ? 'abortion' : 'antenatal'} onAdd={() => {}} onCancel={() => {}} />);

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  answers['/prescription-sets'] = { sets: SETS, canEdit: true };
});

describe('choosing a set on a pregnancy-loss visit', () => {
  it('offers the pregnancy-loss sets first, and says what they are for and that methotrexate is left out on purpose', () => {
    const html = picker('abortion');
    expect(html).toContain('For abortion patients');
    expect(html.indexOf('Missed miscarriage (diagnosed)')).toBeLessThan(html.indexOf('Other sets'));
    expect(html.indexOf('Other sets')).toBeLessThan(html.indexOf('First trimester'));
    expect(html).toContain(LOSS_SETS_NOTE);
    expect(LOSS_SETS_NOTE).toContain('for a miscarriage already diagnosed – never for ending a continuing pregnancy');
    expect(LOSS_SETS_NOTE).toContain('Methotrexate for an ectopic pregnancy has no set, on purpose');
    expect(html).toContain('Draft · v1');
  });

  it('the note is not shown for another type of care', () => {
    const html = picker('antenatal');
    expect(html).not.toContain(LOSS_SETS_NOTE);
    expect(html.indexOf('First trimester')).toBeLessThan(html.indexOf('Missed miscarriage'));
  });

  it('a pregnancy-loss set chosen for a patient of another type of care gets a warning (it never blocks); pregnancy-loss care and other sets get none', () => {
    const [firstTrimester, missed] = SETS;
    expect(lossSetWarning(missed, { careType: 'antenatal' })).toBe(
      'This set is for pregnancy-loss care, and she is recorded as pregnant (antenatal). Use it only for a miscarriage already confirmed, and change her type of care to Abortion in Edit details.',
    );
    expect(lossSetWarning(missed, { careType: 'abortion' })).toBeNull();
    // Any other type of care: she may be in early pregnancy, and no medicine warning speaks of misoprostol there
    for (const careType of ['gynaecology', 'infertility', 'postnatal']) {
      expect(lossSetWarning(missed, { careType }), careType).toBe(
        'This set is for pregnancy-loss care, and she is not recorded under it. Use it only for a miscarriage already confirmed – never if she may have a continuing pregnancy – and record the loss under Abortion in Edit details.',
      );
    }
    expect(lossSetWarning(firstTrimester, { careType: 'antenatal' })).toBeNull();
    expect(lossSetWarning({ ...missed, careTypes: [] }, { careType: 'antenatal' })).toBeNull(); // a set for every type of care
    expect(lossSetWarning({ ...missed, careTypes: ['antenatal', 'abortion'] }, { careType: 'antenatal' })).toBeNull();
  });
});

describe('the prescription-set library', () => {
  it('explains the pregnancy-loss sets, methotrexate and a threatened miscarriage in a hint, with no exclamation marks', () => {
    const html = render(<PrescriptionSetsPage />);
    expect(html).toContain(LOSS_SETS_NOTE);
    expect(html).toContain(THREATENED_NOTE);
    expect(`${LOSS_SETS_NOTE} ${THREATENED_NOTE}`).not.toMatch(/!/);
    expect(html).toContain('Draft sets have not been checked by a doctor.');
  });
});
