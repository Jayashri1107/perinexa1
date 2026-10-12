// The template pages' words for "used by N current plans", a doctor's default protocol and "Update all plans"
// (5 Oct 2026). Counts only – no patient and no item names. Fake data only.
import { describe, expect, it } from 'vitest';
import {
  careWords,
  defaultChangedText,
  defaultNotice,
  defaultPill,
  myDefaultsNotInUse,
  notInUseText,
  plansUpdateResultText,
  plansUpdateText,
  plansUseText,
  usedByText,
} from './templateFormat.js';

const ME = 'u-me';
const protocol = (over = {}) => ({ id: 't1', kind: 'personal', owner: ME, ownerName: 'Dr Sample', name: 'My antenatal protocol', careType: 'antenatal', ownerDefault: true, defaultState: 'in_use', ...over });

describe('used by N current plans', () => {
  it('counts plans in plain words', () => {
    expect(usedByText(0)).toBe('Not used by any current plan');
    expect(usedByText(1)).toBe('Used by 1 current plan');
    expect(usedByText(12)).toBe('Used by 12 current plans');
    expect(plansUseText({ usedBy: 12, olderVersion: 3 })).toBe('Used by 12 current plans. 3 of them use an older version.');
    expect(plansUseText({ usedBy: 5, olderVersion: 1 })).toBe('Used by 5 current plans. 1 of them uses an older version.');
    expect(plansUseText({ usedBy: 0, olderVersion: 0 })).toBe('Not used by any current plan.');
    expect(careWords('abortion')).toBe('pregnancy-loss care');
  });
});

describe("a doctor's default protocol", () => {
  it('the list marks it: "My default" for its own doctor, "Default" for others, a watch status with its reason when not in use', () => {
    expect(defaultPill(protocol(), ME)).toMatchObject({ tone: 'neutral', word: 'My default' });
    expect(defaultPill(protocol(), 'u-other')).toMatchObject({ tone: 'neutral', word: 'Default' });
    expect(defaultPill(protocol({ defaultState: 'draft' }), ME)).toMatchObject({ tone: 'watch', word: 'Default – not in use', title: 'Not used for new plans: this version is a draft' });
    expect(defaultPill(protocol({ defaultState: 'owner_inactive' }), ME).title).toBe('Not used for new plans: its doctor no longer works here as a doctor');
    for (const p of [protocol(), protocol({ defaultState: 'draft' })]) expect(defaultPill(p, ME).icon).toBeTruthy(); // colour + icon + word
    expect(defaultPill(protocol({ ownerDefault: false }), ME)).toBeNull();
    expect(defaultPill({ kind: 'standard', ownerDefault: true }, ME)).toBeNull();
  });

  it('the template page says whose new plans start from it, or why they do not now', () => {
    expect(defaultNotice(protocol(), ME)).toEqual({
      type: 'info',
      text: 'This is your default protocol for antenatal care: new care plans of the patients assigned to you start from it. Plans that already exist do not change.',
    });
    expect(defaultNotice(protocol(), 'u-other').text).toBe(
      "This is Dr Sample's default protocol for antenatal care: new care plans of the patients assigned to Dr Sample start from it. Plans that already exist do not change.",
    );
    expect(defaultNotice(protocol({ defaultState: 'draft' }), ME)).toEqual({
      type: 'warning',
      text: 'This is your default protocol for antenatal care, but this version is a draft. New care plans of the patients assigned to you start from the hospital standard template until you approve this version.',
    });
    expect(defaultNotice(protocol({ defaultState: 'owner_inactive', careType: 'postnatal' }), 'u-other').text).toBe(
      "This is Dr Sample's default protocol for postnatal care, but its doctor no longer works here as a doctor. New care plans of the patients assigned to Dr Sample start from the hospital standard template.",
    );
    expect(defaultNotice(protocol({ ownerDefault: false }), ME)).toBeNull();
  });

  it('the list warns its doctor about their defaults not in use, and the messages after a change', () => {
    const list = [protocol(), protocol({ id: 't2', name: 'My postnatal protocol', careType: 'postnatal', defaultState: 'draft' }), protocol({ id: 't3', owner: 'u-other', defaultState: 'draft' })];
    expect(myDefaultsNotInUse(list, ME).map((t) => t.id)).toEqual(['t2']);
    expect(myDefaultsNotInUse(undefined, ME)).toEqual([]);
    expect(notInUseText(list[1])).toBe(
      'Your default protocol “My postnatal protocol” for postnatal care is not in use: this version is a draft. New care plans of your patients start from the hospital standard template until you approve it.',
    );
    expect(defaultChangedText(protocol(), true)).toBe('New antenatal care plans of the patients assigned to you now start from “My antenatal protocol”. Plans that already exist do not change.');
    expect(defaultChangedText(protocol(), false)).toBe(
      '“My antenatal protocol” is no longer your default. New antenatal care plans of your patients start from the hospital standard template. Plans that already exist do not change.',
    );
  });
});

describe('"Update all plans"', () => {
  const preview = (plans = {}, items = {}) => ({
    template: { id: 't1', name: 'Standard antenatal care', careType: 'antenatal', version: 3, itemsHash: 'a'.repeat(64) },
    plans: { behind: 14, toUpdate: 8, later: 0, otherDoctors: 5, notUsable: 0, paused: 1, fromVersions: [{ version: 1, plans: 2 }, { version: 2, plans: 6 }], ...plans },
    items: { added: 8, changed: 16, removed: 0, kept: 0, needsDecision: 0, plansWithPossibleDuplicates: 0, ...items },
  });

  it('the preview in words – counts only, exactly the server\'s numbers', () => {
    expect(plansUpdateText(null)).toBeNull();
    expect(plansUpdateText(preview())).toEqual({
      summary: '14 current plans use an older version than version 3. You can update 8 plans now.',
      from: 'From version 1 (2 plans) and version 2 (6 plans).',
      items: 'In the 8 plans you update: 8 items added, 16 items changed and 0 items removed (not started).',
      lines: [
        "5 plans are of other doctors' patients: the patient's own doctor or an RMO updates them on the patient's Care plan tab.",
        "1 plan is paused: a paused plan is updated on the patient's Care plan tab once it is active again.",
      ],
      warnings: [],
    });
    const w = plansUpdateText(preview({ later: 50, otherDoctors: 1, paused: 0 }, { kept: 1, needsDecision: 3, plansWithPossibleDuplicates: 2 }));
    expect(w.lines).toEqual([
      "1 plan is of another doctor's patient: the patient's own doctor or an RMO updates it on the patient's Care plan tab.",
      '50 more plans can be updated afterwards, with this button again (at most 8 at a time).',
    ]);
    expect(w.warnings).toEqual([
      '1 item is no longer in the template but kept, because staff recorded something on it.',
      "3 added items need a decision on the patient's plan: their time has passed.",
      "2 plans get an item that may repeat one they already have. It is marked “May repeat” on the patient's Care plan tab and counted under Needs decision (also on Today, under “Care plan to act on”): keep it, or mark one of the two not needed.",
    ]);
    // Postnatal, newborn, gynaecology and fertility plans are not listed on Today: only the Care plan tab is named
    const postnatal = plansUpdateText({ ...preview({}, { plansWithPossibleDuplicates: 1 }), template: { id: 't2', name: 'Standard postnatal care', careType: 'postnatal', version: 2, itemsHash: 'b'.repeat(64) } });
    expect(postnatal.warnings).toEqual([
      "1 plan gets an item that may repeat one it already has. It is marked “May repeat” on the patient's Care plan tab and counted under Needs decision: keep it, or mark one of the two not needed.",
    ]);
    // A doctor's protocol: plans of patients now assigned to another doctor cannot be updated to it, only switched
    expect(plansUpdateText(preview({ otherDoctors: 0, paused: 0, notUsable: 2 })).lines).toEqual([
      "2 plans are of patients now assigned to other doctors, who cannot use this protocol, so they are not updated. The patient's doctor can switch each plan to the hospital standard template or to their own protocol on the patient's Care plan tab.",
    ]);
    expect(plansUpdateText(preview({ otherDoctors: 0, paused: 0, notUsable: 1 })).lines[0]).toBe(
      "1 plan is of a patient now assigned to another doctor, who cannot use this protocol, so it is not updated. The patient's doctor can switch it to the hospital standard template or to their own protocol on the patient's Care plan tab.",
    );
    const none = plansUpdateText(preview({ behind: 2, toUpdate: 0, otherDoctors: 2, paused: 0, fromVersions: [] }));
    expect(none.summary).toBe('2 current plans use an older version than version 3. You can update none of them now.');
    expect(none.items).toBe('');
    expect(none.from).toBe('');
    expect(plansUpdateText(preview({ behind: 0, toUpdate: 0, otherDoctors: 0, paused: 0, fromVersions: [] })).summary).toBe('Every current plan already uses version 3.');
    for (const text of Object.values(plansUpdateText(preview())).flat()) expect(text).not.toMatch(/!/);
  });

  const result = (r = {}) => ({ updated: 0, withPossibleDuplicates: 0, alreadyUpdated: 0, notUpdated: 0, failed: 0, otherDoctors: 0, notUsable: 0, paused: 0, remaining: 0, ...r });

  it('what was done, for the message on the page', () => {
    expect(plansUpdateResultText(result({ updated: 8, otherDoctors: 5, paused: 1 }), 3, 'antenatal')).toBe(
      "8 plans updated to version 3. 5 plans of other doctors' patients were left for the patient's own doctor. 1 paused plan was left as it was.",
    );
    expect(plansUpdateResultText(result({ updated: 1, alreadyUpdated: 1, notUpdated: 1, remaining: 20 }), 2, 'antenatal')).toBe(
      "1 plan updated to version 2. 1 plan was already updated. 1 plan was changed or closed meanwhile and left as it was – update it on the patient's Care plan tab if needed. 20 more plans can be updated with the button again.",
    );
    expect(plansUpdateResultText(result(), 2)).toBe('No plan was updated.');
  });

  it('says where the plans with a possible repeat are, and tells failures apart from changes made meanwhile', () => {
    expect(plansUpdateResultText(result({ updated: 6, withPossibleDuplicates: 4 }), 3, 'antenatal')).toBe(
      "6 plans updated to version 3. 4 of them got an item that may repeat one they already had. It is marked “May repeat” on the patient's Care plan tab and counted under Needs decision (also on Today, under “Care plan to act on”): keep it, or mark one of the two not needed.",
    );
    expect(plansUpdateResultText(result({ updated: 1, withPossibleDuplicates: 1 }), 3, 'newborn')).toBe(
      "1 plan updated to version 3. 1 of them got an item that may repeat one it already had. It is marked “May repeat” on the patient's Care plan tab and counted under Needs decision: keep it, or mark one of the two not needed.",
    );
    expect(plansUpdateResultText(result({ updated: 2, notUpdated: 1, failed: 2 }), 3, 'antenatal')).toBe(
      "2 plans updated to version 3. 1 plan was changed or closed meanwhile and left as it was – update it on the patient's Care plan tab if needed. 2 plans could not be updated and were left as they were: update them one by one on the patient's Care plan tab, which says why.",
    );
    expect(plansUpdateResultText(result({ updated: 1, notUsable: 1 }), 3, 'antenatal')).toBe(
      '1 plan updated to version 3. 1 plan of a patient now assigned to another doctor was left as it was: the patient\'s doctor can switch it to the hospital standard template or their own protocol.',
    );
    for (const r of [result({ updated: 3, withPossibleDuplicates: 2, failed: 1, notUsable: 2 })]) expect(plansUpdateResultText(r, 2, 'antenatal')).not.toMatch(/!/);
  });
});
