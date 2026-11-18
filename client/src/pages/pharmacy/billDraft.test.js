// A bill left half made is kept for the same person in the same hospital only (18 Nov 2026). Made-up values only.
import { describe, expect, it } from 'vitest';
import { clearDraft, draftOwner, findDraft, saveDraft } from './billDraft.js';
import { PHARMACY_TOPICS, topicFits } from './PharmacyTopics.jsx';

describe('a bill left half made', () => {
  it('opens again for the same person and hospital, never for another, and is gone once cleared', () => {
    const me = draftOwner({ id: 'u1' }, 't1');
    saveDraft('sale', me, { lines: [{ key: 'a' }], remark: 'Sample' });
    expect(findDraft('sale', me)).toMatchObject({ remark: 'Sample' });
    expect(findDraft('sale', draftOwner({ id: 'u2' }, 't1'))).toBeNull(); // another person
    expect(findDraft('sale', draftOwner({ id: 'u1' }, 't2'))).toBeNull(); // another hospital
    expect(findDraft('issue', me)).toBeNull(); // a sale's draft is not an issue's
    clearDraft('sale');
    expect(findDraft('sale', me)).toBeNull();
  });
});

describe('All topics search', () => {
  it('finds topics by a word of their name or of what to do', () => {
    const all = PHARMACY_TOPICS.flatMap((g) => g.items);
    expect(all.filter((t) => topicFits(t, 'credit')).map(([name]) => name)).toEqual(expect.arrayContaining(['Credit report', 'Patient-wise credit report', 'Settlement']));
    expect(all.filter((t) => topicFits(t, '  ')).length).toBe(all.length);
  });
});
