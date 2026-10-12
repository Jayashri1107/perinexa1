// The template page's "Patients' plans" and "My default protocol" cards and the "Update all plans" preview (5 Oct
// 2026), rendered to HTML (no browser). Counts only; fake sample data.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DefaultCard, PlansUseCard } from './TemplateDetailPage.jsx';
import { UpdatePlansPreview } from './UpdatePlansDialog.jsx';

const html = (node) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};
const standard = (over = {}) => ({ id: 't1', kind: 'standard', careType: 'antenatal', name: 'Standard antenatal care', version: 3, status: 'approved', usedBy: 14, olderVersion: 8, canEdit: true, mayUpdatePlans: true, canUpdatePlans: true, ...over });

describe("Patients' plans on a template's page", () => {
  it('says how many current plans use it and offers the update to who may make it', () => {
    const out = html(<PlansUseCard template={standard()} onUpdate={noop} />);
    expect(text(out)).toContain('Used by 14 current plans. 8 of them use an older version.');
    expect(text(out)).toContain("one by one on the patient's Care plan tab, or all at once here");
    expect(out).toMatch(/<button type="button" class="btn btn-secondary"><svg[^>]*lucide-refresh-cw[^>]*>.*?<\/svg> Update plans to version 3<\/button>/);
    expect(out).not.toContain('btn-primary'); // the page's one primary action stays the template's own
    expect(out).not.toMatch(/!/);
  });

  it('no button for a nurse or an RMO, nor before the version is approved (then it says so to who may change it), nor when nothing is behind', () => {
    const nurse = html(<PlansUseCard template={standard({ canEdit: false, mayUpdatePlans: false, canUpdatePlans: false })} onUpdate={noop} />);
    expect(nurse).not.toContain('<button');
    expect(text(nurse)).not.toContain('all at once');
    // A protocol whose doctor is now an RMO: they may still edit it, but never update its plans – no promise either
    const formerDoctor = html(<PlansUseCard template={standard({ kind: 'personal', status: 'draft', mayUpdatePlans: false, canUpdatePlans: false })} onUpdate={noop} />);
    expect(formerDoctor).not.toContain('<button');
    expect(text(formerDoctor)).not.toContain('all at once');
    const draft = html(<PlansUseCard template={standard({ status: 'draft', canUpdatePlans: false })} onUpdate={noop} />);
    expect(draft).not.toContain('<button');
    expect(text(draft)).toContain('Once this version is approved, the plans can be updated here all at once.');
    const upToDate = html(<PlansUseCard template={standard({ olderVersion: 0 })} onUpdate={noop} />);
    expect(upToDate).not.toContain('<button');
    expect(text(upToDate)).toContain('Used by 14 current plans.');
    expect(text(html(<PlansUseCard template={standard({ usedBy: 0, olderVersion: 0 })} onUpdate={noop} />))).toContain('Not used by any current plan.');
  });
});

describe('"My default protocol" on a doctor\'s own protocol', () => {
  const mine = (over = {}) => ({ id: 't2', kind: 'personal', careType: 'antenatal', name: 'My protocol', status: 'approved', ownerDefault: false, ...over });
  it('an approved protocol can be made the default; a default can be stopped; a draft cannot be one', () => {
    const make = html(<DefaultCard template={mine()} busy={false} onChange={noop} />);
    expect(text(make)).toContain('Make this protocol your default for antenatal care: new care plans of the patients assigned to you then start from it');
    expect(text(make)).toContain('Plans that already exist do not change.');
    expect(make).toMatch(/lucide-star[^-][^>]*>.*?<\/svg> Make it my default<\/button>/);
    const stop = html(<DefaultCard template={mine({ ownerDefault: true })} busy={false} onChange={noop} />);
    expect(stop).toMatch(/lucide-star-off[^>]*>.*?<\/svg> Stop using as my default<\/button>/);
    expect(text(stop)).toContain('If you stop using it as your default, new care plans of your patients start from the hospital standard template.');
    // a default that became a draft can still be stopped
    expect(html(<DefaultCard template={mine({ ownerDefault: true, status: 'draft' })} busy={false} onChange={noop} />)).toContain('Stop using as my default');
    const draft = html(<DefaultCard template={mine({ status: 'draft' })} busy={false} onChange={noop} />);
    expect(draft).not.toContain('<button');
    expect(text(draft)).toContain('A draft cannot be your default.');
    expect(text(html(<DefaultCard template={mine({ careType: 'abortion' })} busy={false} onChange={noop} />))).toContain('your default for pregnancy-loss care');
    for (const out of [make, stop, draft]) expect(out).not.toMatch(/!|btn-primary/);
  });
});

describe('the "Update all plans" preview', () => {
  it('shows the counts and what to check afterwards – no patient and no item names', () => {
    const preview = {
      template: { id: 't1', name: 'Standard antenatal care', careType: 'antenatal', version: 3, itemsHash: 'a'.repeat(64) },
      plans: { behind: 9, toUpdate: 8, later: 0, otherDoctors: 1, notUsable: 0, paused: 0, fromVersions: [{ version: 2, plans: 8 }] },
      items: { added: 8, changed: 8, removed: 0, kept: 0, needsDecision: 0, plansWithPossibleDuplicates: 8 },
    };
    const out = html(<UpdatePlansPreview preview={preview} />);
    const words = text(out);
    expect(words).toContain('9 current plans use an older version than version 3. You can update 8 plans now.');
    expect(words).toContain('From version 2 (8 plans).');
    expect(words).toContain('In the 8 plans you update: 8 items added, 8 items changed and 0 items removed (not started).');
    expect(words).toContain("1 plan is of another doctor's patient");
    expect(out).toContain('alert-warning');
    expect(words).toContain('8 plans get an item that may repeat one they already have. It is marked “May repeat” on the patient\'s Care plan tab');
    expect(out).not.toMatch(/!/);
    expect(html(<UpdatePlansPreview preview={null} />)).toBe('');
  });
});
