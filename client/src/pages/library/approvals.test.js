import { describe, expect, it } from 'vitest';
import { draftsFrom } from './ApprovalsPage.jsx';

describe('draftsFrom', () => {
  it('lists the drafts this doctor may approve, from all five libraries, with a link each', () => {
    const drafts = draftsFrom({
      templates: {
        templates: [
          { id: 't1', name: 'Hospital standard antenatal', status: 'draft', canApprove: true },
          { id: 't2', name: "Dr B's protocol", status: 'draft', canApprove: false },
          { id: 't3', name: 'Approved one', status: 'approved', canApprove: true },
        ],
      },
      redFlags: { ruleSet: { status: 'draft', canApprove: true } },
      medSafety: { list: { status: 'approved', canApprove: true } },
      consents: { forms: [{ id: 'c1', title: { en: 'LSCS consent' }, status: 'draft', isActive: true }, { id: 'c2', title: { en: 'Old' }, status: 'draft', isActive: false }] },
      sets: null, // still loading
    });
    expect(drafts.map((d) => [d.kind, d.name, d.to])).toEqual([
      ['template', 'Hospital standard antenatal', '/care-plans/templates/t1'],
      ['redflags', 'Red-flag rules', '/care-plans/red-flags'],
      ['consent', 'LSCS consent', '/consent-forms/c1'],
    ]);
  });

  it('lists the new built-in entries of the medicine safety list that a doctor has not added yet', () => {
    const names = (list) => draftsFrom({ medSafety: { list } }).map((d) => [d.key, d.name, d.to]);
    // An approved list made before the new kinds of entry existed: nothing to approve, but entries to add
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 76 })).toEqual([['medsafety-new', 'Medicine safety list – 76 new built-in draft entries to add and review', '/medicine-safety']]);
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 1 })[0][1]).toBe('Medicine safety list – 1 new built-in draft entry to add and review');
    // The hospital's own draft with entries to add: both
    expect(names({ status: 'draft', canApprove: true, newBuiltIn: 3 }).map((r) => r[0])).toEqual(['medsafety', 'medsafety-new']);
    expect(names({ status: 'approved', canApprove: true, newBuiltIn: 0 })).toEqual([]);
    expect(names({ status: 'approved', canApprove: true })).toEqual([]);
  });
});
