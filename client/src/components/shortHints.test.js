import { describe, expect, it } from 'vitest';
import { canShorten } from './shortHints.js';

const LONG = 'Booked appointments and next visits the doctor wrote. Confirm or remind them by phone.';

describe('long instruction lines on a phone (canShorten)', () => {
  it('shortens a long plain instruction, not a short one', () => {
    expect(canShorten(LONG, '/follow-ups')).toBe(true);
    expect(canShorten('Only cash is handed over.', '/cash-handover')).toBe(false);
  });
  it('keeps safety wording in full view', () => {
    for (const text of [
      '"Draft schedule": the date comes from a schedule no doctor has approved yet – ask the doctor before calling.',
      'With the patient’s agreement. The QR code on her card is read on this computer – nothing is saved or sent.',
      'Write the allergies here, or tick the box that says none are known for this person.',
      'The baby’s sex must never be written anywhere in this record, under the law in India.',
    ]) expect(canShorten(text, '/patients/new/gynaecology')).toBe(false);
  });
  it('keeps every clinical page in full view', () => {
    for (const page of ['/medicine-safety', '/care-plans/red-flags', '/clinical-rules/risk', '/consent-forms', '/patients/abc/visits/1', '/patients/abc/care-plan', '/patients/abc/stays/2']) {
      expect(canShorten(LONG, page)).toBe(false);
    }
  });
});
