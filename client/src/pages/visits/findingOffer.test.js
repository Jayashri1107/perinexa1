import { describe, expect, it } from 'vitest';
import { findingOfferText } from './findingOffer.js';

describe('the visit page offer to add a finding', () => {
  it('high blood pressure: says the reading, what the button adds, and that one reading is not a diagnosis', () => {
    const t = findingOfferText({ key: 'hypertension', bp: '150/96', beforeWeek20: false });
    expect(t.found).toBe('Blood pressure 150/96 at this visit – 140/90 or higher.');
    expect(t.button).toBe('Add to her record: high blood pressure in this pregnancy');
    expect(t.hint).toMatch(/Recheck it after rest/);
    expect(t.done).toBe('Added to her record: high blood pressure in this pregnancy. The risk level and the care plan were worked out again.');
    // the cut-off is built into the software: it is shown as a draft, with the guideline it comes from
    expect(t.source).toMatch(/^Draft suggestion built into the software, not reviewed by your hospital’s doctors\. Source: MoHFW SBA guidelines and PMSMA/);
    expect(t.source).toMatch(/140\/90 or higher, on two readings/);
  });

  it('before 20 weeks it points to chronic high blood pressure under Existing conditions instead', () => {
    const t = findingOfferText({ key: 'hypertension', bp: '142/92', beforeWeek20: true });
    expect(t.hint).toMatch(/Before 20 weeks.*chronic.*Existing conditions/);
  });

  it('an offer this screen does not know is not shown', () => {
    expect(findingOfferText({ key: 'something_new' })).toBeNull();
    expect(findingOfferText({ key: 'hypertension' })).toBeNull(); // no reading with it
    expect(findingOfferText(undefined)).toBeNull();
  });

  it('follows the brand rules: no exclamation marks', () => {
    for (const before of [true, false]) expect(JSON.stringify(findingOfferText({ key: 'hypertension', bp: '150/96', beforeWeek20: before }))).not.toMatch(/!/);
  });
});
