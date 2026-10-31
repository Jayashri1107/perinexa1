// The study a scan due in her care plan is ordered as (31 Oct 2026): the order dialog comes filled in with it, and the
// doctor checks it before ordering.
import { describe, expect, it } from 'vitest';
import { STATUS, studyForPlanItem } from './ImagingPages.jsx';

describe('a care-plan scan ordered with one click', () => {
  it('fills in the study from the item', () => {
    expect(studyForPlanItem({ name: 'Dating / viability scan' })).toBe('usg_early');
    expect(studyForPlanItem({ name: 'NT scan with first-trimester combined screening (double marker)' })).toBe('usg_nt');
    expect(studyForPlanItem({ name: 'Anomaly scan (level II / TIFFA)' })).toBe('usg_anomaly');
    expect(studyForPlanItem({ name: 'Growth scan with Doppler' })).toBe('usg_growth');
    expect(studyForPlanItem({ name: 'Repeat scan for the position of the placenta' })).toBe('usg_growth');
    expect(studyForPlanItem({ name: 'Baseline transvaginal scan (antral follicle count, uterus, ovaries)' })).toBe('usg_pelvis');
    expect(studyForPlanItem({ name: 'A scan added by hand' })).toBe('usg_early');
  });

  it('a booking by reception shows as To confirm', () => {
    expect(STATUS.requested.word).toBe('To confirm');
  });
});
