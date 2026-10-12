// The words of the visit page's offer to add a finding of this pregnancy to her record (pure, tested).
// The server says when the vital signs saved at this visit suggest one (routes/visits.js findingOffers); a doctor
// or RMO confirms with one click – nothing is ever ticked by itself.
import { PREGNANCY_FINDING_LABELS } from '../patients/patientFormat.js';

// Where the 140/90 suggestion comes from. It is fixed in the software (not one of the hospital's risk rules), so
// the screen says that it is a draft no doctor of the hospital has reviewed, and names the guideline.
export const HYPERTENSION_OFFER_SOURCE =
  'Draft suggestion built into the software, not reviewed by your hospital’s doctors. Source: MoHFW SBA guidelines and PMSMA high-risk list – blood pressure 140/90 or higher, on two readings.';

/**
 * { found, button, hint, source, done } for one offer ({ key, bp, beforeWeek20 }), or null for an offer this screen
 * does not know (it is then not shown).
 */
export function findingOfferText(offer) {
  if (offer?.key !== 'hypertension' || !offer.bp) return null;
  return {
    found: `Blood pressure ${offer.bp} at this visit – 140/90 or higher.`,
    button: 'Add to her record: high blood pressure in this pregnancy',
    hint: offer.beforeWeek20
      ? 'Before 20 weeks, high blood pressure usually counts as chronic. If so, tick “High blood pressure” under Existing conditions in Edit details instead.'
      : 'Recheck it after rest first if you have not. One raised reading alone is not a diagnosis.',
    source: HYPERTENSION_OFFER_SOURCE,
    done: `Added to her record: ${PREGNANCY_FINDING_LABELS.hypertension.toLowerCase()}. The risk level and the care plan were worked out again.`,
  };
}
