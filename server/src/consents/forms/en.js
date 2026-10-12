// English wording of the built-in DRAFT consent forms – the source the Marathi (mr.js) and Hindi (hi.js)
// drafts are translated from. Each hospital gets its own copy, which its doctors edit and approve in the app.
//
// ⚠️ Drafted by the software developer (Claude) from common Indian hospital practice and published guidance
// (HIV and AIDS (Prevention and Control) Act 2017, Government of India sterilisation standards 2014, RCOG
// information for VBAC). NOT reviewed by a lawyer or a doctor: the hospital must check every form (and its
// translations) before using it with patients.
//
// Blanks filled in when a form is printed for a patient (the same blanks must appear in every language):
//   {patient} the patient's name · {age} age in years · {mrn} patient number · {hospital} hospital name
//   {doctor} the doctor who explains the form · {procedure} and {reason}: typed by the doctor when printing
//   (a blank line to fill in by hand when left empty).
// Forms that a relative may sign (admission, procedure, anaesthesia, transfusion, refusal) do not use {age}:
// they can be printed for newborns too.

// The last clause of every form.
const CLOSING =
  'I have read this form, or it has been read and explained to me in a language I understand. I had the chance to ask questions and all my questions were answered. I sign this form of my own free will.';

export const EN = {
  admission: {
    title: 'General consent for admission and treatment',
    clauses: [
      'I, the undersigned (the patient, or the parent, guardian or relative signing for the patient), consent to the admission of {patient} (patient no. {mrn}) to {hospital}.',
      'I consent to the routine examinations, nursing care, blood and urine tests, other investigations and medicines that the doctors consider necessary during the stay. An internal (vaginal) examination will be done only when needed, with a female staff member present.',
      'I understand that an operation, anaesthesia, blood transfusion or any other special procedure needs a separate written consent, except in an emergency when delay would put life at risk.',
      "The expected cost of treatment and the hospital's payment rules have been explained to me.",
      "I understand that medical information will be kept confidential and shared only with those involved in the patient's care, or as required by law.",
      "I understand that the hospital is not responsible for the loss of valuables, and that the hospital's rules for patients and visitors must be followed.",
      'I understand that medicine is not an exact science and that no guarantee has been given about the result of treatment.',
      CLOSING,
    ],
  },

  procedure: {
    title: 'Consent for an operation or procedure',
    clauses: [
      'I, the undersigned (the patient, or the parent, guardian or relative signing for the patient), give consent for the following operation or procedure for {patient} (patient no. {mrn}): {procedure}.',
      'The reason it is advised: {reason}.',
      '{doctor} has explained to me the nature and purpose of the procedure, the expected benefits, the other options (including not having it) and what may happen if it is not done.',
      'The possible risks and complications have been explained to me, including bleeding, infection, injury to nearby organs such as the bladder or bowel, blood clots, reactions to medicines and, rarely, the need for another operation or risk to life.',
      'If, during the procedure, the doctors find that an additional or different procedure is needed to protect life or health, I consent to it.',
      'Anaesthesia and blood transfusion, if needed, will be explained and consented to separately, except in an emergency.',
      'Tissue removed during the procedure may be sent for laboratory examination and then disposed of as per the rules.',
      'No guarantee has been given to me about the result of the procedure.',
      CLOSING,
    ],
  },

  anaesthesia: {
    title: 'Consent for anaesthesia',
    clauses: [
      'I, the undersigned (the patient, or the parent, guardian or relative signing for the patient), give consent for anaesthesia for {patient} (patient no. {mrn}) for the procedure: {procedure}.',
      'The anaesthetist has explained the type of anaesthesia planned – spinal or epidural (the lower body is made numb), general anaesthesia (complete sleep) or local anaesthesia – and that the type may have to be changed during the procedure for safety.',
      'The common side effects have been explained: nausea, vomiting, shivering, headache, back pain, sore throat and a fall in blood pressure.',
      'The rare but serious risks have been explained: allergic reaction to medicines, breathing problems, nerve injury, awareness during general anaesthesia, heart problems and, very rarely, risk to life.',
      'I have told the doctors about illnesses, allergies, medicines taken, any earlier anaesthesia and problems with it, and when food or drink was last taken. The fasting instructions given will be followed.',
      CLOSING,
    ],
  },

  blood_transfusion: {
    title: 'Consent for blood transfusion',
    clauses: [
      'I, the undersigned (the patient, or the parent, guardian or relative signing for the patient), give consent for the transfusion of blood and blood products (such as red cells, plasma or platelets) to {patient} (patient no. {mrn}) if the doctors consider it necessary.',
      'The reason has been explained to me: {reason}.',
      'I understand that donated blood is tested for HIV, hepatitis B, hepatitis C, syphilis and malaria as required by law, but that a very small risk of infection still remains.',
      'The possible reactions have been explained: fever, chills, rash and itching and, rarely, serious reactions affecting breathing, blood pressure or the kidneys, which will be treated at once.',
      'The benefits of transfusion, the risks of not having it when it is needed, and the other options where available have been explained to me.',
      CLOSING,
    ],
  },

  refusal: {
    title: 'Refusal of advised treatment / leaving against medical advice',
    clauses: [
      'I, the undersigned (the patient, or the parent, guardian or relative responsible for the patient), have been advised by {doctor} that {patient} (patient no. {mrn}) needs the following treatment or admission: {procedure}.',
      'The reasons for this advice and the possible results of refusing it – including the condition getting worse, harm to the mother and/or the baby, and risk to life – have been explained to me in a language I understand.',
      'Despite this, of my own free will, I refuse the advised treatment / I am taking the patient away from the hospital against medical advice. My reason: {reason}.',
      'I take full responsibility for the results of this decision, and I will not hold {hospital}, its doctors or its staff responsible for any harm that results from it.',
      'I understand that the patient may come back to the hospital at any time and that, in an emergency, the patient should be taken to the nearest hospital without delay.',
      CLOSING,
    ],
  },

  hiv_test: {
    title: 'Consent for HIV test (with counselling)',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), have received counselling about the HIV test before the test.',
      'It has been explained to me why the test is advised, and that if the result is positive, treatment is available that protects my health and, in pregnancy, greatly reduces the chance of passing HIV to the baby.',
      'I understand that my result will be kept confidential and shared only with the doctors and staff involved in my care, or as required by law (HIV and AIDS (Prevention and Control) Act, 2017).',
      'I understand that I will receive counselling again when the result is given, and that I may refuse the test; refusing will not affect the rest of my care.',
      'I agree to have my blood tested for HIV.',
      CLOSING,
    ],
  },

  high_risk_pregnancy: {
    title: 'High-risk pregnancy: information and consent',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), have been told by {doctor} that my pregnancy is high-risk because of: {reason}.',
      'The possible problems for me and my baby have been explained, such as high blood pressure, diabetes, bleeding, early (preterm) delivery, poor growth of the baby, the need for a caesarean section, admission of the baby to the newborn unit and, rarely, risk to the life of the mother or the baby.',
      'I understand that I need more frequent check-ups, tests and scans, and that I may need to be admitted or referred to a higher centre.',
      'I agree to follow the advice given and take my medicines regularly, and to come to the hospital at once if I have bleeding, severe headache, blurred vision, fits, fever, leaking of water, pain in the abdomen or reduced movements of the baby.',
      'I understand that even with the best care, a good outcome cannot be guaranteed.',
      CLOSING,
    ],
  },

  labour_delivery: {
    title: 'Consent for labour and vaginal delivery',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), give consent to be cared for in labour and for vaginal delivery at {hospital}.',
      "It has been explained to me that during labour the doctors may need to examine me internally, break the waters, give medicines to start or strengthen contractions, monitor the baby's heartbeat, give an episiotomy (a cut to widen the birth opening, stitched afterwards) and use a vacuum or forceps to help deliver the baby.",
      'If there is a problem with me or the baby, an emergency caesarean section may be needed. I consent to it if the doctors advise it; a separate consent will be taken if time allows.',
      'The possible complications have been explained, including tears, heavy bleeding after delivery, infection, the need for blood transfusion, a retained placenta that needs removal under anaesthesia, and problems for the baby that may need admission to the newborn unit.',
      'I consent to the medicines routinely given at delivery to prevent heavy bleeding, and to routine care of my baby after birth (such as vitamin K and the birth doses of vaccines).',
      CLOSING,
    ],
  },

  induction: {
    title: 'Consent for induction of labour',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), give consent for induction of labour (starting labour with medicines or other methods).',
      'The reason it is advised: {reason}.',
      'The methods have been explained to me: tablets or gel placed in the vagina or taken by mouth, a balloon catheter in the neck of the womb, breaking the waters, and a drip (oxytocin) to start or strengthen contractions.',
      "The possible risks have been explained: very strong or frequent contractions, changes in the baby's heartbeat, induction that does not work, a longer labour, infection, and the need for an emergency caesarean section. Very rarely the uterus can tear, especially after a previous caesarean.",
      'The option of waiting for labour to start naturally, and its risks, have been explained to me.',
      CLOSING,
    ],
  },

  vbac: {
    title: 'Consent for vaginal birth after caesarean (trial of labour)',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), have had a caesarean section before, and I choose to try for a vaginal birth in this pregnancy (trial of labour after caesarean).',
      'It has been explained to me that about 3 out of 4 women who try have a vaginal birth, and that if labour does not progress or there is a problem, an emergency caesarean section will be needed.',
      'The main risk has been explained: the scar on the uterus can open (scar rupture) in about 1 in 200 women. This is an emergency that can cause serious harm to or death of the baby, heavy bleeding, and the need to remove the uterus.',
      "I understand that I will be monitored closely in labour, including continuous monitoring of the baby's heartbeat, and that I must come to the hospital as soon as labour pains start, the waters break or I have any bleeding.",
      'The option of a planned repeat caesarean section, with its own risks and benefits, has been explained to me.',
      CLOSING,
    ],
  },

  caesarean: {
    title: 'Consent for caesarean section',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), give consent for a caesarean section (delivery of the baby through a cut in the abdomen and the uterus).',
      'The reason it is advised: {reason}.',
      'The risks have been explained to me, including bleeding that may need blood transfusion, infection, injury to the bladder or bowel, blood clots in the legs or lungs and a longer recovery than after a vaginal birth; and for the baby, small cuts and breathing difficulty that may need care in the newborn unit.',
      'I understand that in the rare case of bleeding that cannot be controlled, removal of the uterus (hysterectomy) may be needed to save my life, and I consent to it.',
      'It has been explained to me that a caesarean affects future pregnancies, including the risk of the scar opening and of problems with the placenta.',
      'Anaesthesia, and a family planning operation (tubal ligation) if I request it, will be consented to separately.',
      CLOSING,
    ],
  },

  tubal_ligation: {
    title: 'Consent for tubal ligation (permanent family planning)',
    clauses: [
      'I, {patient}, aged {age} years (patient no. {mrn}), request and give consent for tubal ligation (closing both fallopian tubes) so that I do not become pregnant again.',
      'I have been told that this is a permanent method: I will not be able to become pregnant again, and reversing it is difficult and often does not work.',
      'Other methods of family planning – such as the Copper-T (IUCD), injections, pills and condoms, and vasectomy for the husband – have been explained to me. I choose this method of my own free will, without any pressure.',
      'I understand that there is a small chance of failure (about 1 in 200), and that a pregnancy after the operation may be outside the womb (ectopic pregnancy), which is an emergency. I will report a missed period at once.',
      'The risks of the operation and of the anaesthesia, including bleeding, infection and injury to nearby organs, have been explained to me.',
      'I understand that I can change my mind at any time before the operation.',
      CLOSING,
    ],
  },

  newborn_care: {
    title: 'Consent for newborn care and vaccination',
    clauses: [
      'I, the undersigned, the parent or guardian of baby {patient} (patient no. {mrn}), give consent for the routine care of my baby at {hospital}.',
      'This includes examination, a vitamin K injection, the birth doses of vaccines (BCG, oral polio and hepatitis B) as per the national immunisation schedule, and routine blood or screening tests if advised.',
      'The common side effects of vaccines have been explained to me, such as mild fever, soreness or swelling where the injection was given, and the small scar after BCG.',
      'If my baby needs admission to the newborn unit (for example for breathing difficulty, jaundice needing phototherapy, low sugar, low temperature or infection), I consent to the treatment needed, including tests, medicines, oxygen and fluids through a drip. Any major procedure will need a separate consent.',
      'I have been told how to feed my baby and keep the baby warm, and about the danger signs for which the baby must be brought to the hospital at once.',
      CLOSING,
    ],
  },
};
