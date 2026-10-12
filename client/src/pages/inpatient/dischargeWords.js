// The printed discharge card in English with Marathi or Hindi next to it (5 Oct 2026): the card's own words – its
// title, labels and notes. What the doctor wrote (diagnosis, course, advice, follow-up note, the ward, a medicine's
// own instructions) prints as typed; a medicine's dose, how often, food and how long are printed in her language too,
// with the prescriptions' words (visits/rxFormat.js). The other inpatient documents are staff documents: English only.
//
// ⚠️ DRAFT – the Marathi and Hindi wording must be checked by fluent speakers before it is used with patients
// (docs/TRANSLATIONS_TO_CHECK.md).

const W = (en, mr, hi) => ({ en, mr, hi });

/** The card's fixed words. */
export const DISCHARGE_WORDS = {
  title: W('Discharge card', 'डिस्चार्ज कार्ड (रुग्णालयातून सुट्टी)', 'डिस्चार्ज कार्ड (अस्पताल से छुट्टी)'),
  patient: W('Patient', 'रुग्ण', 'रोगी'),
  age: W('Age', 'वय', 'आयु'),
  patientNo: W('Patient no.', 'रुग्ण क्रमांक', 'रोगी क्रमांक'),
  admitted: W('Admitted', 'दाखल झाल्याची वेळ', 'भर्ती का समय'),
  discharged: W('Discharged', 'सुट्टीची वेळ', 'छुट्टी का समय'),
  wardBed: W('Ward / bed', 'वॉर्ड व खाट', 'वार्ड और बिस्तर'),
  bed: W('Bed', 'खाट', 'बिस्तर'),
  corrections: W('Corrections and additions', 'दुरुस्त्या व भर', 'सुधार और जोड़'),
  notSigned: W('Not signed yet.', 'अजून सही झालेली नाही.', 'अभी हस्ताक्षर नहीं हुए हैं।'),
  draft: W('DRAFT – not confirmed by a doctor yet.', 'मसुदा – डॉक्टरांनी अजून निश्चित केलेले नाही.', 'ड्राफ़्ट – डॉक्टर ने अभी पुष्टि नहीं की है।'),
};

/** The label of each part of the discharge card (the keys of DOC_FIELDS.discharge; `en` is the same label). */
export const DISCHARGE_FIELD_WORDS = {
  dischargedAt: W('Date and time of discharge', 'सुट्टीची तारीख व वेळ', 'छुट्टी की तारीख़ और समय'),
  finalDiagnosis: W('Final diagnosis', 'अंतिम निदान', 'अंतिम निदान'),
  procedures: W('Procedures and operations', 'केलेल्या प्रक्रिया व ऑपरेशन', 'की गई प्रक्रियाएँ और ऑपरेशन'),
  course: W('Course in hospital', 'रुग्णालयात असताना झालेले उपचार', 'अस्पताल में रहते हुए हुआ इलाज'),
  conditionAtDischarge: W('Condition at discharge', 'सुट्टीच्या वेळची प्रकृती', 'छुट्टी के समय की हालत'),
  medicines: W('Medicines on discharge', 'घरी घ्यायची औषधे', 'घर पर लेने की दवाइयाँ'),
  advice: W('Advice', 'सल्ला', 'सलाह'),
  followUpOn: W('Follow-up date', 'पुन्हा तपासणीची तारीख', 'दोबारा जाँच की तारीख़'),
  followUpNote: W('Follow-up note', 'पुन्हा तपासणीबद्दल सूचना', 'दोबारा जाँच के बारे में निर्देश'),
};
