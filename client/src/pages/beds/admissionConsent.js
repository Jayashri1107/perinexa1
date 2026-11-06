// The consent on page 2 of the admission form: the hospital's own wording from its paper IPD admission form, in
// English (owner's approval passed on by the developer, 6 Nov 2026). The Marathi paragraph of the paper form follows
// once its text is typed – the PDF's Marathi cannot be read back. Clinical and legal wording: change it only with the
// owner's approval.

export const CONSENT_POINTS = [
  'I have been fully informed in my own language about the present status and illness of myself / my patient.',
  'I have been fully informed about the proposed line of treatment, investigation, medication, effects, possible side effects and complications.',
  'If any treating doctor feels it necessary, he / she can consult any other specialist for better treatment.',
  'I agree to accept the consequences and also to pay the cost of treatment, period in wards / cabins, if the patient is required to be shifted to the Critical Care Unit (CCU) as a life-saving measure.',
  'I allow my treating doctor to provide any sort of emergency treatment, including endotracheal intubation, mechanical ventilation, temporary pacemaker implantation, cardioversion, defibrillation and central line insertion, or anything other required to save the life of the patient.',
  'I hereby give my consent to examine, and later to dispose of, any tissue / organ removed from the body of the patient to save his / her life, as per the existing rules and regulations.',
  "If the patient or any of his / her attendant(s) damages any of the hospital's equipment and properties, I shall remain bound to suitably compensate that loss by paying the estimated cost / price.",
  'I consent to the taking and publishing of any photographs / videos / audios or any other storage media captured during examination / treatment / operation of the patient for the uplifting of medical knowledge. I also understand that the identity of the patient will not be disclosed and privacy will be maintained.',
];

export const UNDERSTAND_POINTS = [
  'The medicines and consumables used for the treatment are not manufactured by the hospital; they are procured from reliable manufacturers to ensure the quality. I agree to accept all the materials supplied by the hospital for the treatment of the patient. The hospital reserves the right of not accepting anything from outside to treat the patient.',
  'I / we can meet the patient only during the visiting hours and when we are called for.',
  'As doctors are busy, I can meet the treating doctor only at the prefixed party meeting time, but I can be called at any time to discuss the patient by the treating doctor if the situation demands. If I cannot make myself available for discussion, the treating doctor may proceed with any new treatment / modification for the sake of the patient.',
  'It has also been explained to me that my patient may worsen during the course of treatment. I offer my free consent for any type of treatment and decision to be taken by the doctor. I will not blame the hospital / doctor or any other hospital staff, and will take each and every responsibility ourselves.',
  'The hospital authorities have clearly made me / us understand the approximate cost of treatment. If, due to any reason, the cost of treatment exceeds the estimated amount, I / we shall remain bound to settle the bill in full and final, irrespective of the outcome of the treatment. If the bill is not paid by the patient / relative, the hospital management has full rights to take necessary legal action.',
];

export const INSURANCE_TEXT =
  "I / we have no objection to providing details of my / our patient's treatment, submitting documents or any other related information to the insurance company / TPA. I / we are aware that the initial approval by the TPA is purely based on the primary information declared by me / my relative. I also agree to pay the entire hospital bill in case the claim is rejected by my insurance company / TPA at any stage. I / we are also aware that I / we have to make payments for the heads which are not covered by the insurance company / TPA. I / we also agree to pay the co-payment of the said amount to the insurance company / TPA.";

/** The closing line, with the hospital's name. */
export const acceptText = (hospital) => `I / we accept all terms and conditions and am / are ready to admit myself / our patient in ${hospital || 'this hospital'}.`;
