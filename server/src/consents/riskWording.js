// The patient's high-risk factors on her consent forms (owner's request, 14 Nov 2026): every consent form printed
// for a patient can carry a section that names the risk factors her record shows (the reasons behind her risk
// level, careplans/risk.js) and the complications each of them can lead to – in English with Marathi or Hindi
// next to it, like the clauses. The doctor chooses which ones are printed (routes/patientConsents.js).
//
// ⚠️ DRAFT clinical wording, written by the software developer (Claude) from common obstetric teaching (MoHFW /
// PMSMA high-risk pregnancy lists, FOGSI and RCOG patient information). NOT reviewed by a doctor or a lawyer: a
// doctor of the hospital must read it, with the translations, and approve it (Clinic library › Consent forms ›
// High-risk factors). Until then every form that carries the section says DRAFT.
//
// Privacy: HIV is never offered, printed or stored here (HIV and AIDS (Prevention and Control) Act 2017 – a
// consent form is signed by relatives and witnesses): a reason is left out when its rule checks the HIV condition
// – whatever a doctor called the rule – or when its name names HIV, and a typed line that names HIV is refused.
// Syphilis, hepatitis B and mental-health conditions are printed like the others (owner's decision, 14 Nov 2026)
// and marked `private`, so the doctor is reminded to untick them when the patient has not agreed that her relatives
// may know.

import { createHash } from 'node:crypto';
import { mentionsConfidential } from '../abdm/shareRules.js';
import { ANTENATAL_DRAFT } from '../careplans/antenatalDraft.js';

// Increase when any wording below changes: an approval is for one version, so the section is a draft again. (The
// approval also keeps a fingerprint of the text – RISK_WORDING_HASH below – so a change made without a new number
// is a draft again too.)
export const RISK_WORDING_VERSION = 1;

/** The fixed words of the section, in each language. */
export const RISK_SECTION = {
  heading: { en: 'High-risk factors in this patient', mr: 'या रुग्णातील जोखमीचे घटक', hi: 'इस रोगी में जोखिम के कारक' },
  intro: {
    en: 'It has been explained to me that the following high-risk factors are present in this patient and what complications each of them can lead to. They can add to the risks of the treatment, operation or delivery covered by this form, and to the risks of delaying or refusing it.',
    mr: 'मला समजावून सांगण्यात आले आहे की या रुग्णामध्ये खालील जोखमीचे घटक आहेत आणि त्या प्रत्येकामुळे कोणती गुंतागुंत होऊ शकते. त्यांच्यामुळे या फॉर्ममधील उपचार, शस्त्रक्रिया किंवा प्रसूतीचा धोका वाढू शकतो, तसेच ते उशिरा केल्यास किंवा नाकारल्यास होणारा धोकाही वाढू शकतो.',
    hi: 'मुझे समझाया गया है कि इस रोगी में नीचे दिए गए जोखिम के कारक मौजूद हैं और इनमें से हर एक से कौन-सी जटिलताएँ हो सकती हैं। इनसे इस फॉर्म में बताए गए उपचार, ऑपरेशन या प्रसव का जोखिम बढ़ सकता है, और उसमें देर करने या उससे इनकार करने का जोखिम भी बढ़ सकता है।',
  },
  complications: { en: 'Possible complications', mr: 'संभाव्य गुंतागुंत', hi: 'संभावित जटिलताएँ' },
  other: { en: 'Other risk factors and their complications', mr: 'इतर जोखमीचे घटक व त्यांची गुंतागुंत', hi: 'अन्य जोखिम के कारक और उनकी जटिलताएँ' },
};

// One entry per risk factor as the patient is told about it. keys: the built-in risk rules (careplans/
// antenatalDraft.js) that mean this factor – several rules can mean the same one (e.g. BMI 30 and BMI 35 are both
// "Obesity"). covers: factors that are not printed as well when this one applies. exact: the name states the rule's
// cut-off, so it is used only while the hospital's rule still has that cut-off. private: see above.
// A rule of the hospital's own has no entry: it is printed by its label, with a line to write on.
export const RISK_GROUPS = [
  {
    id: 'age_under_20',
    keys: ['age_under_20'],
    exact: true, // the name states the cut-off
    name: { en: "Mother's age under 20 years", mr: 'आईचे वय 20 वर्षांपेक्षा कमी', hi: 'माँ की आयु 20 वर्ष से कम' },
    complications: {
      en: 'anaemia, high blood pressure in pregnancy, early (preterm) delivery, a small baby, and a difficult labour that may need an operation.',
      mr: 'रक्तक्षय (ॲनिमिया), गरोदरपणातील उच्च रक्तदाब, वेळेआधी (मुदतपूर्व) प्रसूती, कमी वजनाचे बाळ आणि अवघड प्रसूती, ज्यासाठी शस्त्रक्रिया करावी लागू शकते.',
      hi: 'खून की कमी (एनीमिया), गर्भावस्था में हाई ब्लड प्रेशर, समय से पहले प्रसव, कम वज़न का बच्चा और कठिन प्रसव, जिसके लिए ऑपरेशन की ज़रूरत पड़ सकती है।',
    },
  },
  {
    id: 'age_over_35',
    keys: ['age_over_35'],
    exact: true,
    name: { en: "Mother's age over 35 years", mr: 'आईचे वय 35 वर्षांपेक्षा जास्त', hi: 'माँ की आयु 35 वर्ष से अधिक' },
    complications: {
      en: 'high blood pressure, diabetes in pregnancy, miscarriage, a chromosomal condition in the baby (such as Down syndrome), early delivery, the need for a caesarean section, and more bleeding at delivery.',
      mr: 'उच्च रक्तदाब, गरोदरपणातील मधुमेह, गर्भपात, बाळामध्ये गुणसूत्रांचा दोष (उदा. डाऊन सिंड्रोम), वेळेआधी प्रसूती, सिझेरियन शस्त्रक्रियेची गरज आणि प्रसूतीच्या वेळी जास्त रक्तस्राव.',
      hi: 'हाई ब्लड प्रेशर, गर्भावस्था में डायबिटीज़ (शुगर), गर्भपात, बच्चे में गुणसूत्र (क्रोमोसोम) की गड़बड़ी (जैसे डाउन सिंड्रोम), समय से पहले प्रसव, सिज़ेरियन ऑपरेशन की ज़रूरत और प्रसव के समय ज़्यादा खून बहना।',
    },
  },
  {
    id: 'short_stature',
    keys: ['height_under_145'],
    name: { en: 'Short height', mr: 'कमी उंची', hi: 'कम कद' },
    complications: {
      en: 'the baby may not pass easily through the birth passage: a long or obstructed labour and the need for a caesarean section.',
      mr: 'बाळाला जन्ममार्गातून बाहेर येणे अवघड जाऊ शकते: प्रसूती लांबणे किंवा अडणे आणि सिझेरियन शस्त्रक्रियेची गरज.',
      hi: 'हो सकता है कि बच्चा जन्म के रास्ते से आसानी से न निकल पाए: प्रसव का लंबा चलना या रुक जाना और सिज़ेरियन ऑपरेशन की ज़रूरत।',
    },
  },
  {
    id: 'obesity',
    keys: ['bmi_35_plus', 'bmi_30_plus'],
    name: { en: 'Obesity (high BMI)', mr: 'लठ्ठपणा (जास्त BMI)', hi: 'मोटापा (ज़्यादा BMI)' },
    complications: {
      en: 'high blood pressure, diabetes, blood clots in the legs or lungs, a large baby, difficult anaesthesia and operation, wound infection and slow healing, and heavy bleeding after delivery.',
      mr: 'उच्च रक्तदाब, मधुमेह, पायांमध्ये किंवा फुप्फुसांमध्ये रक्ताच्या गुठळ्या, मोठे बाळ, भूल देणे व शस्त्रक्रिया अवघड होणे, जखमेत जंतुसंसर्ग व जखम उशिरा भरणे, आणि प्रसूतीनंतर जास्त रक्तस्राव.',
      hi: 'हाई ब्लड प्रेशर, डायबिटीज़, पैरों या फेफड़ों में खून के थक्के, बड़ा बच्चा, एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) देने और ऑपरेशन में कठिनाई, घाव में संक्रमण और घाव का देर से भरना, और प्रसव के बाद ज़्यादा खून बहना।',
    },
  },
  {
    id: 'underweight',
    keys: ['bmi_under_18_5', 'weight_under_45'],
    name: { en: 'Low body weight', mr: 'कमी वजन', hi: 'कम वज़न' },
    complications: {
      en: 'anaemia, early delivery, a small or low-birth-weight baby, and slower recovery after an operation.',
      mr: 'रक्तक्षय (ॲनिमिया), वेळेआधी प्रसूती, कमी वजनाचे बाळ आणि शस्त्रक्रियेनंतर बरे होण्यास जास्त वेळ लागणे.',
      hi: 'खून की कमी (एनीमिया), समय से पहले प्रसव, कम वज़न का बच्चा और ऑपरेशन के बाद ठीक होने में ज़्यादा समय लगना।',
    },
  },
  {
    id: 'previous_caesarean',
    keys: ['previous_caesarean'],
    name: { en: 'Previous caesarean section', mr: 'आधीची सिझेरियन शस्त्रक्रिया', hi: 'पहले हुआ सिज़ेरियन ऑपरेशन' },
    complications: {
      en: 'the old scar on the uterus can open (rupture) in labour, the placenta can lie low or grow into the scar and bleed heavily, the operation can be more difficult with injury to the bladder or bowel, blood transfusion is needed more often and, rarely, the uterus has to be removed.',
      mr: 'प्रसूतीच्या वेळी गर्भाशयावरील जुना व्रण (टाका) उघडू शकतो, वार (प्लॅसेंटा) खाली असू शकते किंवा व्रणात रुतून खूप रक्तस्राव होऊ शकतो, शस्त्रक्रिया अधिक अवघड होऊन मूत्राशय (लघवीची पिशवी) किंवा आतड्यांना इजा होऊ शकते, रक्त द्यावे लागण्याची शक्यता वाढते आणि क्वचित प्रसंगी गर्भाशय काढावे लागू शकते.',
      hi: 'प्रसव के दौरान बच्चेदानी का पुराना निशान (टाँका) खुल सकता है; आँवल (प्लेसेंटा) नीचे हो सकता है या निशान में धँस सकता है, जिससे बहुत खून बह सकता है; ऑपरेशन ज़्यादा कठिन हो सकता है और मूत्राशय या आँतों को चोट लग सकती है; खून चढ़ाने की ज़रूरत बढ़ जाती है और कम ही मामलों में बच्चेदानी निकालनी पड़ सकती है।',
    },
  },
  {
    id: 'uterine_surgery',
    keys: ['cond_uterine_surgery'],
    name: { en: 'Previous operation on the uterus', mr: 'गर्भाशयावर आधी झालेली शस्त्रक्रिया', hi: 'बच्चेदानी पर पहले हुआ ऑपरेशन' },
    complications: {
      en: 'the scar on the uterus can open in pregnancy or labour, the placenta can attach abnormally and bleed heavily, and a caesarean section is often needed.',
      mr: 'गरोदरपणात किंवा प्रसूतीच्या वेळी गर्भाशयावरील व्रण उघडू शकतो, वार (प्लॅसेंटा) चुकीच्या प्रकारे चिकटून खूप रक्तस्राव होऊ शकतो, आणि अनेकदा सिझेरियन शस्त्रक्रिया करावी लागते.',
      hi: 'गर्भावस्था या प्रसव के दौरान बच्चेदानी का निशान खुल सकता है; आँवल (प्लेसेंटा) गलत तरह से चिपक सकता है, जिससे बहुत खून बह सकता है; और अक्सर सिज़ेरियन ऑपरेशन करना पड़ता है।',
    },
  },
  {
    id: 'grand_multipara',
    keys: ['grand_multipara'],
    name: { en: 'Many previous births (grand multipara)', mr: 'आधीच्या अनेक प्रसूती (ग्रँड मल्टिपॅरा)', hi: 'पहले कई प्रसव (ग्रैंड मल्टीपैरा)' },
    complications: {
      en: 'anaemia, the baby lying in an abnormal position, a very fast labour, heavy bleeding after delivery because the uterus does not contract (PPH), and rupture of the uterus.',
      mr: 'रक्तक्षय (ॲनिमिया), बाळ आडवे किंवा उलटे असणे, खूप झपाट्याने प्रसूती होणे, प्रसूतीनंतर गर्भाशय आकुंचन न पावल्याने खूप रक्तस्राव (PPH) आणि गर्भाशय फाटणे.',
      hi: 'खून की कमी (एनीमिया), बच्चे का आड़ा या उल्टा होना, बहुत तेज़ी से प्रसव होना, प्रसव के बाद बच्चेदानी के न सिकुड़ने से बहुत खून बहना (PPH) और बच्चेदानी का फटना।',
    },
  },
  {
    id: 'recurrent_loss',
    keys: ['abortions_3_plus', 'abortions_2'],
    exact: true,
    name: { en: 'Two or more previous miscarriages or abortions', mr: 'आधीचे दोन किंवा अधिक गर्भपात', hi: 'पहले दो या उससे अधिक गर्भपात' },
    complications: {
      en: 'another miscarriage, early delivery, poor growth of the baby and problems with the placenta.',
      mr: 'पुन्हा गर्भपात, वेळेआधी प्रसूती, बाळाची वाढ नीट न होणे आणि वारेशी (प्लॅसेंटा) संबंधित समस्या.',
      hi: 'फिर से गर्भपात, समय से पहले प्रसव, बच्चे का ठीक से न बढ़ना और आँवल (प्लेसेंटा) से जुड़ी समस्याएँ।',
    },
  },
  {
    id: 'hist_stillbirth',
    keys: ['hist_stillbirth'],
    name: { en: 'Previous stillbirth or newborn death', mr: 'आधी मृत बाळाचा जन्म किंवा नवजात बाळाचा मृत्यू', hi: 'पहले मृत बच्चे का जन्म या नवजात की मृत्यु' },
    complications: {
      en: 'the same problem can come back: poor growth of the baby, early delivery, or loss of the baby before or soon after birth. An earlier delivery may be advised.',
      mr: 'तीच समस्या पुन्हा उद्भवू शकते: बाळाची वाढ नीट न होणे, वेळेआधी प्रसूती, किंवा जन्माआधी अथवा जन्मानंतर लगेच बाळ दगावणे. प्रसूती लवकर करण्याचा सल्ला दिला जाऊ शकतो.',
      hi: 'वही समस्या फिर हो सकती है: बच्चे का ठीक से न बढ़ना, समय से पहले प्रसव, या जन्म से पहले अथवा जन्म के तुरंत बाद बच्चे की मृत्यु। प्रसव जल्दी कराने की सलाह दी जा सकती है।',
    },
  },
  {
    id: 'hist_preterm',
    keys: ['hist_preterm'],
    name: { en: 'Previous preterm birth', mr: 'आधीची मुदतपूर्व प्रसूती', hi: 'पहले समय से पूर्व प्रसव' },
    complications: {
      en: 'labour can again start too early; a preterm baby may have breathing difficulty and infection and may need care in the newborn unit (NICU).',
      mr: 'पुन्हा वेळेआधी प्रसूती कळा सुरू होऊ शकतात; मुदतपूर्व बाळाला श्वास घेण्यास त्रास व जंतुसंसर्ग होऊ शकतो आणि त्याला नवजात शिशु कक्षात (NICU) ठेवावे लागू शकते.',
      hi: 'प्रसव पीड़ा फिर से समय से पहले शुरू हो सकती है; समय से पहले जन्मे बच्चे को साँस लेने में तकलीफ और संक्रमण हो सकता है और उसे नवजात शिशु इकाई (NICU) में रखना पड़ सकता है।',
    },
  },
  {
    id: 'hist_pre_eclampsia',
    keys: ['hist_pre_eclampsia'],
    name: {
      en: 'Pre-eclampsia or eclampsia in an earlier pregnancy',
      mr: 'आधीच्या गरोदरपणात प्री-एक्लॅम्पसिया किंवा एक्लॅम्पसिया',
      hi: 'पिछली गर्भावस्था में प्री-एक्लेम्पसिया या एक्लेम्पसिया',
    },
    complications: {
      en: 'it can come back: very high blood pressure, fits (eclampsia), harm to the kidneys, liver or brain, the placenta separating early, poor growth of the baby and early delivery.',
      mr: 'तो पुन्हा होऊ शकतो: खूप जास्त रक्तदाब, झटके (एक्लॅम्पसिया), मूत्रपिंड (किडनी), यकृत (लिव्हर) किंवा मेंदूला इजा, वार वेळेआधी सुटणे, बाळाची वाढ नीट न होणे आणि वेळेआधी प्रसूती.',
      hi: 'यह फिर हो सकता है: बहुत ज़्यादा ब्लड प्रेशर, दौरे (एक्लेम्पसिया), गुर्दे, लिवर या दिमाग को नुकसान, आँवल का समय से पहले अलग होना, बच्चे का ठीक से न बढ़ना और समय से पहले प्रसव।',
    },
  },
  {
    id: 'hist_anomaly',
    keys: ['hist_anomaly'],
    name: { en: 'Previous baby with a birth defect', mr: 'आधीच्या बाळामध्ये जन्मजात व्यंग', hi: 'पिछले बच्चे में जन्मजात विकृति' },
    complications: {
      en: 'a similar problem can occur again in this baby; extra scans and tests may be advised, and the baby may need special care after birth.',
      mr: 'या बाळामध्येही तशीच समस्या असू शकते; जास्तीच्या सोनोग्राफी व चाचण्यांचा सल्ला दिला जाऊ शकतो, आणि जन्मानंतर बाळाला विशेष देखभालीची गरज पडू शकते.',
      hi: 'इस बच्चे में भी वैसी ही समस्या हो सकती है; अतिरिक्त स्कैन और जाँचों की सलाह दी जा सकती है, और जन्म के बाद बच्चे को विशेष देखभाल की ज़रूरत पड़ सकती है।',
    },
  },
  {
    id: 'hist_obstructed',
    keys: ['hist_obstructed'],
    name: { en: 'Previous obstructed labour', mr: 'आधीची अडलेली प्रसूती', hi: 'पहले रुका हुआ (अवरुद्ध) प्रसव' },
    complications: {
      en: 'labour can become obstructed again, with injury to the mother, rupture of the uterus and distress of the baby; a caesarean section may be needed.',
      mr: 'प्रसूती पुन्हा अडू शकते, त्यामुळे आईला इजा, गर्भाशय फाटणे आणि बाळाला त्रास होऊ शकतो; सिझेरियन शस्त्रक्रिया करावी लागू शकते.',
      hi: 'प्रसव फिर से रुक सकता है, जिससे माँ को चोट, बच्चेदानी का फटना और बच्चे को तकलीफ हो सकती है; सिज़ेरियन ऑपरेशन की ज़रूरत पड़ सकती है।',
    },
  },
  {
    id: 'hist_pph',
    keys: ['hist_pph'],
    name: { en: 'Heavy bleeding after an earlier delivery (PPH)', mr: 'आधीच्या प्रसूतीनंतर खूप रक्तस्राव (PPH)', hi: 'पिछले प्रसव के बाद बहुत खून बहना (PPH)' },
    complications: {
      en: 'heavy bleeding can occur again after this delivery, with the need for blood transfusion, an operation to stop the bleeding and, rarely, removal of the uterus.',
      mr: 'या प्रसूतीनंतरही खूप रक्तस्राव होऊ शकतो; रक्त द्यावे लागू शकते, रक्तस्राव थांबवण्यासाठी शस्त्रक्रिया करावी लागू शकते आणि क्वचित प्रसंगी गर्भाशय काढावे लागू शकते.',
      hi: 'इस प्रसव के बाद भी बहुत खून बह सकता है; खून चढ़ाने, खून रोकने के लिए ऑपरेशन करने और कम ही मामलों में बच्चेदानी निकालने की ज़रूरत पड़ सकती है।',
    },
  },
  {
    id: 'rh_sensitised',
    keys: ['hist_rh_iso'],
    covers: ['rh_negative'], // already sensitised: anti-D no longer helps, so the Rh-negative line is not printed as well
    name: { en: 'Rh sensitisation in an earlier pregnancy', mr: 'आधीच्या गरोदरपणात Rh सेन्सिटायझेशन', hi: 'पिछली गर्भावस्था में Rh सेंसिटाइज़ेशन' },
    complications: {
      en: "antibodies in the mother's blood can cause severe anaemia, swelling (hydrops) and jaundice in the baby, a blood transfusion for the baby, early delivery, or loss of the baby.",
      mr: 'आईच्या रक्तातील प्रतिपिंडांमुळे (ॲन्टिबॉडीज) बाळाला तीव्र रक्तक्षय, अंगावर सूज (हायड्रॉप्स) व कावीळ होऊ शकते, बाळाला रक्त द्यावे लागू शकते, वेळेआधी प्रसूती करावी लागू शकते किंवा बाळ दगावू शकते.',
      hi: 'माँ के खून की एंटीबॉडी से बच्चे में खून की गंभीर कमी, शरीर में सूजन (हाइड्रॉप्स) और पीलिया हो सकता है, बच्चे को खून चढ़ाना पड़ सकता है, समय से पहले प्रसव कराना पड़ सकता है या बच्चे की मृत्यु हो सकती है।',
    },
  },
  {
    id: 'hist_lbw',
    keys: ['hist_lbw'],
    name: { en: 'Previous baby under 2.5 kg', mr: 'आधीचे बाळ 2.5 किलोपेक्षा कमी वजनाचे', hi: 'पिछला बच्चा 2.5 किलो से कम वज़न का' },
    complications: {
      en: 'this baby can also be small or born early, and may need care in the newborn unit (NICU).',
      mr: 'हे बाळही कमी वजनाचे किंवा वेळेआधी जन्माला येऊ शकते, आणि त्याला नवजात शिशु कक्षात (NICU) ठेवावे लागू शकते.',
      hi: 'यह बच्चा भी कम वज़न का या समय से पहले पैदा हो सकता है, और उसे नवजात शिशु इकाई (NICU) में रखना पड़ सकता है।',
    },
  },
  {
    id: 'hist_big_baby',
    keys: ['hist_big_baby'],
    name: { en: 'Previous baby over 4 kg', mr: 'आधीचे बाळ 4 किलोपेक्षा जास्त वजनाचे', hi: 'पिछला बच्चा 4 किलो से अधिक वज़न का' },
    complications: {
      en: "diabetes in pregnancy, a large baby again, a difficult delivery with the baby's shoulder getting stuck, tears, heavy bleeding and the need for a caesarean section.",
      mr: 'गरोदरपणातील मधुमेह, पुन्हा मोठे बाळ, बाळाचा खांदा अडकून प्रसूती अवघड होणे, जन्ममार्ग फाटणे, खूप रक्तस्राव आणि सिझेरियन शस्त्रक्रियेची गरज.',
      hi: 'गर्भावस्था में डायबिटीज़, फिर से बड़ा बच्चा, बच्चे का कंधा फँसने से कठिन प्रसव, जन्म के रास्ते का फटना, बहुत खून बहना और सिज़ेरियन ऑपरेशन की ज़रूरत।',
    },
  },
  {
    id: 'rh_negative',
    keys: ['rh_negative'],
    name: { en: 'Rh-negative blood group', mr: 'Rh-निगेटिव्ह रक्तगट', hi: 'Rh-निगेटिव ब्लड ग्रुप' },
    complications: {
      en: "if the baby's blood is Rh positive, the mother's blood can form antibodies. These usually do not harm this baby but can harm a baby in a later pregnancy (anaemia and jaundice in the baby); an anti-D injection, given when advised, usually prevents this.",
      mr: 'बाळाचा रक्तगट Rh-पॉझिटिव्ह असल्यास आईच्या रक्तात प्रतिपिंडे (ॲन्टिबॉडीज) तयार होऊ शकतात. सहसा त्यांच्यामुळे या बाळाला इजा होत नाही, पण पुढच्या गरोदरपणातील बाळाला इजा होऊ शकते (बाळाला रक्तक्षय व कावीळ); सल्ल्यानुसार घेतलेल्या ॲन्टी-डी इंजेक्शनमुळे हे बहुतेक वेळा टळते.',
      hi: 'यदि बच्चे का खून Rh-पॉज़िटिव हो, तो माँ के खून में एंटीबॉडी बन सकती हैं। आमतौर पर ये इस बच्चे को नुकसान नहीं पहुँचातीं, लेकिन अगली गर्भावस्था के बच्चे को नुकसान पहुँचा सकती हैं (बच्चे में खून की कमी और पीलिया); सलाह के अनुसार लगवाया गया एंटी-डी इंजेक्शन अधिकतर मामलों में इससे बचाता है।',
    },
  },
  {
    id: 'diabetes',
    keys: ['cond_diabetes'],
    covers: ['gdm'], // diabetes known before pregnancy is printed instead when both are recorded
    name: { en: 'Diabetes', mr: 'मधुमेह (शुगर)', hi: 'डायबिटीज़ (शुगर)' },
    complications: {
      en: 'high blood pressure, a large baby and a difficult delivery, infection and slow wound healing, the need for a caesarean section; for the baby: birth defects (when sugar was high in early pregnancy), low sugar, breathing difficulty and jaundice after birth, and loss of the baby in the womb.',
      mr: 'उच्च रक्तदाब, मोठे बाळ व अवघड प्रसूती, जंतुसंसर्ग व जखम उशिरा भरणे, सिझेरियन शस्त्रक्रियेची गरज; बाळासाठी: जन्मजात व्यंग (गरोदरपणाच्या सुरुवातीला साखर जास्त असल्यास), जन्मानंतर साखर कमी होणे, श्वास घेण्यास त्रास व कावीळ, आणि पोटातच बाळ दगावणे.',
      hi: 'हाई ब्लड प्रेशर, बड़ा बच्चा और कठिन प्रसव, संक्रमण और घाव का देर से भरना, सिज़ेरियन ऑपरेशन की ज़रूरत; बच्चे के लिए: जन्मजात विकृति (यदि गर्भावस्था की शुरुआत में शुगर ज़्यादा रही हो), जन्म के बाद शुगर कम होना, साँस लेने में तकलीफ और पीलिया, और गर्भ में ही बच्चे की मृत्यु।',
    },
  },
  {
    id: 'gdm',
    keys: ['preg_gdm'],
    name: { en: 'Diabetes in this pregnancy (gestational diabetes)', mr: 'या गरोदरपणातील मधुमेह (जेस्टेशनल डायबेटीस)', hi: 'इस गर्भावस्था में डायबिटीज़ (जेस्टेशनल डायबिटीज़)' },
    complications: {
      en: 'high blood pressure, a large baby and a difficult delivery, infection and slow wound healing, the need for a caesarean section; for the baby: low sugar, breathing difficulty and jaundice after birth and, rarely, loss of the baby in the womb.',
      mr: 'उच्च रक्तदाब, मोठे बाळ व अवघड प्रसूती, जंतुसंसर्ग व जखम उशिरा भरणे, सिझेरियन शस्त्रक्रियेची गरज; बाळासाठी: जन्मानंतर साखर कमी होणे, श्वास घेण्यास त्रास व कावीळ, आणि क्वचित प्रसंगी पोटातच बाळ दगावणे.',
      hi: 'हाई ब्लड प्रेशर, बड़ा बच्चा और कठिन प्रसव, संक्रमण और घाव का देर से भरना, सिज़ेरियन ऑपरेशन की ज़रूरत; बच्चे के लिए: जन्म के बाद शुगर कम होना, साँस लेने में तकलीफ और पीलिया, और कम ही मामलों में गर्भ में ही बच्चे की मृत्यु।',
    },
  },
  {
    id: 'high_bp',
    keys: ['cond_hypertension', 'preg_hypertension'],
    covers: ['bp_reading'], // the ticked diagnosis is printed instead of the single reading
    name: { en: 'High blood pressure', mr: 'उच्च रक्तदाब (हाय बीपी)', hi: 'हाई ब्लड प्रेशर (उच्च रक्तचाप)' },
    complications: {
      en: 'fits (eclampsia), bleeding in the brain (stroke), harm to the kidneys and liver, the placenta separating early with heavy bleeding, poor growth of the baby, early delivery and loss of the baby; the blood pressure can rise further during an operation or anaesthesia.',
      mr: 'झटके (एक्लॅम्पसिया), मेंदूत रक्तस्राव (स्ट्रोक), मूत्रपिंड (किडनी) व यकृत (लिव्हर) यांना इजा, वार वेळेआधी सुटून खूप रक्तस्राव, बाळाची वाढ नीट न होणे, वेळेआधी प्रसूती आणि बाळ दगावणे; शस्त्रक्रिया किंवा भुलीच्या वेळी रक्तदाब आणखी वाढू शकतो.',
      hi: 'दौरे (एक्लेम्पसिया), दिमाग में खून बहना (स्ट्रोक), गुर्दे और लिवर को नुकसान, आँवल के समय से पहले अलग होने से बहुत खून बहना, बच्चे का ठीक से न बढ़ना, समय से पहले प्रसव और बच्चे की मृत्यु; ऑपरेशन या एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) के दौरान ब्लड प्रेशर और बढ़ सकता है।',
    },
  },
  {
    // One reading (the latest visit's) of 140/90 or more: not yet the diagnosis (careplans/antenatalDraft.js bp_systolic_140)
    id: 'bp_reading',
    keys: ['bp_systolic_140', 'bp_diastolic_90'],
    name: { en: 'Raised blood pressure at the latest check', mr: 'सर्वात अलीकडच्या तपासणीत वाढलेला रक्तदाब', hi: 'सबसे हाल की जाँच में बढ़ा हुआ ब्लड प्रेशर' },
    complications: {
      en: 'if the blood pressure stays high when it is checked again: fits (eclampsia), bleeding in the brain (stroke), harm to the kidneys and liver, the placenta separating early with heavy bleeding, poor growth of the baby and early delivery; the blood pressure can rise further during an operation or anaesthesia.',
      mr: 'पुन्हा तपासल्यावरही रक्तदाब जास्त राहिल्यास: झटके (एक्लॅम्पसिया), मेंदूत रक्तस्राव (स्ट्रोक), मूत्रपिंड (किडनी) व यकृत (लिव्हर) यांना इजा, वार वेळेआधी सुटून खूप रक्तस्राव, बाळाची वाढ नीट न होणे आणि वेळेआधी प्रसूती; शस्त्रक्रिया किंवा भुलीच्या वेळी रक्तदाब आणखी वाढू शकतो.',
      hi: 'दोबारा जाँचने पर भी ब्लड प्रेशर ज़्यादा रहे तो: दौरे (एक्लेम्पसिया), दिमाग में खून बहना (स्ट्रोक), गुर्दे और लिवर को नुकसान, आँवल के समय से पहले अलग होने से बहुत खून बहना, बच्चे का ठीक से न बढ़ना और समय से पहले प्रसव; ऑपरेशन या एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) के दौरान ब्लड प्रेशर और बढ़ सकता है।',
    },
  },
  {
    id: 'heart',
    keys: ['cond_heart'],
    name: { en: 'Heart disease', mr: 'हृदयविकार', hi: 'दिल की बीमारी' },
    complications: {
      en: 'the heart may not bear the strain of pregnancy, labour, an operation or anaesthesia (heart failure): breathlessness, an irregular heartbeat, blood clots, infection of the heart and risk to life; the baby can be small or born early.',
      mr: 'गरोदरपण, प्रसूती, शस्त्रक्रिया किंवा भुलीचा ताण हृदयाला सहन न होणे (हार्ट फेल्युअर): धाप लागणे, हृदयाचे ठोके अनियमित होणे, रक्ताच्या गुठळ्या, हृदयाचा जंतुसंसर्ग आणि जिवाला धोका; बाळ कमी वजनाचे किंवा वेळेआधी जन्माला येऊ शकते.',
      hi: 'गर्भावस्था, प्रसव, ऑपरेशन या एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) का बोझ दिल सहन न कर पाए (हार्ट फेल्योर): साँस फूलना, दिल की धड़कन का अनियमित होना, खून के थक्के, दिल का संक्रमण और जान को खतरा; बच्चा कम वज़न का या समय से पहले पैदा हो सकता है।',
    },
  },
  {
    id: 'kidney',
    keys: ['cond_renal'],
    name: { en: 'Kidney disease', mr: 'मूत्रपिंडाचा (किडनीचा) आजार', hi: 'गुर्दे (किडनी) की बीमारी' },
    complications: {
      en: 'the kidneys can work less well, high blood pressure and pre-eclampsia, anaemia, poor growth of the baby and early delivery; the doses of some medicines have to be changed.',
      mr: 'मूत्रपिंडाचे काम आणखी बिघडणे, उच्च रक्तदाब व प्री-एक्लॅम्पसिया, रक्तक्षय, बाळाची वाढ नीट न होणे आणि वेळेआधी प्रसूती; काही औषधांचे डोस बदलावे लागतात.',
      hi: 'गुर्दे का काम और बिगड़ना, हाई ब्लड प्रेशर और प्री-एक्लेम्पसिया, खून की कमी, बच्चे का ठीक से न बढ़ना और समय से पहले प्रसव; कुछ दवाइयों की खुराक बदलनी पड़ती है।',
    },
  },
  {
    id: 'autoimmune',
    keys: ['cond_autoimmune'],
    name: {
      en: 'Autoimmune disease (such as SLE or antiphospholipid syndrome)',
      mr: 'ऑटोइम्यून आजार (उदा. SLE किंवा ॲन्टिफॉस्फोलिपिड सिंड्रोम)',
      hi: 'ऑटोइम्यून बीमारी (जैसे SLE या एंटीफॉस्फोलिपिड सिंड्रोम)',
    },
    complications: {
      en: 'the disease can flare up, blood clots, pre-eclampsia, miscarriage, poor growth of the baby, early delivery and loss of the baby.',
      mr: 'आजार बळावणे, रक्ताच्या गुठळ्या, प्री-एक्लॅम्पसिया, गर्भपात, बाळाची वाढ नीट न होणे, वेळेआधी प्रसूती आणि बाळ दगावणे.',
      hi: 'बीमारी का बढ़ जाना, खून के थक्के, प्री-एक्लेम्पसिया, गर्भपात, बच्चे का ठीक से न बढ़ना, समय से पहले प्रसव और बच्चे की मृत्यु।',
    },
  },
  {
    id: 'thrombophilia',
    keys: ['cond_thrombophilia'],
    name: { en: 'Clotting disorder (thrombophilia)', mr: 'रक्त गोठण्याचा विकार (थ्रॉम्बोफिलिया)', hi: 'खून जमने का विकार (थ्रॉम्बोफिलिया)' },
    complications: {
      en: 'blood clots in the legs or lungs (which can threaten life), especially after an operation or delivery; miscarriage, pre-eclampsia, and poor growth or loss of the baby. Blood-thinning injections can increase bleeding.',
      mr: 'पायांमध्ये किंवा फुप्फुसांमध्ये रक्ताच्या गुठळ्या (जिवाला धोका होऊ शकतो), विशेषतः शस्त्रक्रियेनंतर किंवा प्रसूतीनंतर; गर्भपात, प्री-एक्लॅम्पसिया, आणि बाळाची वाढ नीट न होणे किंवा बाळ दगावणे. रक्त पातळ करणाऱ्या इंजेक्शनांमुळे रक्तस्राव वाढू शकतो.',
      hi: 'पैरों या फेफड़ों में खून के थक्के (जिनसे जान को खतरा हो सकता है), खासकर ऑपरेशन या प्रसव के बाद; गर्भपात, प्री-एक्लेम्पसिया, और बच्चे का ठीक से न बढ़ना या बच्चे की मृत्यु। खून पतला करने वाले इंजेक्शन से खून बहना बढ़ सकता है।',
    },
  },
  {
    id: 'thyroid',
    keys: ['cond_thyroid'],
    name: { en: 'Thyroid disease', mr: 'थायरॉईडचा आजार', hi: 'थायरॉइड की बीमारी' },
    complications: {
      en: "when it is not well controlled: miscarriage, high blood pressure, anaemia, early delivery, a small baby and effects on the development of the baby's brain; problems of heart rate and blood pressure during an operation or anaesthesia.",
      mr: 'आजार नियंत्रणात नसल्यास: गर्भपात, उच्च रक्तदाब, रक्तक्षय, वेळेआधी प्रसूती, कमी वजनाचे बाळ आणि बाळाच्या मेंदूच्या वाढीवर परिणाम; शस्त्रक्रिया किंवा भुलीच्या वेळी हृदयाचे ठोके व रक्तदाब यांच्या समस्या.',
      hi: 'बीमारी काबू में न होने पर: गर्भपात, हाई ब्लड प्रेशर, खून की कमी, समय से पहले प्रसव, कम वज़न का बच्चा और बच्चे के दिमाग के विकास पर असर; ऑपरेशन या एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) के दौरान दिल की धड़कन और ब्लड प्रेशर की समस्याएँ।',
    },
  },
  {
    id: 'epilepsy',
    keys: ['cond_epilepsy'],
    name: { en: 'Epilepsy (fits)', mr: 'अपस्मार (फिट्स / झटके येण्याचा आजार)', hi: 'मिर्गी (दौरे)' },
    complications: {
      en: 'fits can become more frequent in pregnancy, in labour or after an operation, with injury to the mother and the baby; some medicines can cause birth defects; medicines must not be stopped without advice.',
      mr: 'गरोदरपणात, प्रसूतीच्या वेळी किंवा शस्त्रक्रियेनंतर झटके वाढू शकतात, त्यामुळे आईला व बाळाला इजा होऊ शकते; काही औषधांमुळे बाळामध्ये जन्मजात व्यंग येऊ शकते; सल्ल्याशिवाय औषधे बंद करू नयेत.',
      hi: 'गर्भावस्था में, प्रसव के दौरान या ऑपरेशन के बाद दौरे बढ़ सकते हैं, जिससे माँ और बच्चे को चोट लग सकती है; कुछ दवाइयों से बच्चे में जन्मजात विकृति हो सकती है; सलाह के बिना दवाइयाँ बंद नहीं करनी चाहिए।',
    },
  },
  {
    id: 'mental_health',
    keys: ['cond_mental_health'],
    private: true,
    name: { en: 'Mental health condition', mr: 'मानसिक आरोग्याचा आजार', hi: 'मानसिक स्वास्थ्य की बीमारी' },
    complications: {
      en: 'the illness can get worse in pregnancy or after delivery (including depression after delivery), which can make it hard to care for herself and the baby; some medicines have to be changed.',
      mr: 'गरोदरपणात किंवा प्रसूतीनंतर आजार वाढू शकतो (प्रसूतीनंतरच्या नैराश्यासह), त्यामुळे स्वतःची व बाळाची काळजी घेणे कठीण होऊ शकते; काही औषधे बदलावी लागतात.',
      hi: 'गर्भावस्था में या प्रसव के बाद बीमारी बढ़ सकती है (प्रसव के बाद का अवसाद भी), जिससे अपनी और बच्चे की देखभाल करना कठिन हो सकता है; कुछ दवाइयाँ बदलनी पड़ती हैं।',
    },
  },
  {
    id: 'tuberculosis',
    keys: ['cond_tb'],
    name: { en: 'Tuberculosis', mr: 'क्षयरोग (टीबी)', hi: 'टीबी (क्षय रोग)' },
    complications: {
      en: 'when the disease is active or not fully treated: weakness and anaemia, early delivery, a small baby and spread of the infection to the baby after birth; breathing problems under anaesthesia when the lungs are affected.',
      mr: 'आजार सक्रिय असल्यास किंवा पूर्ण उपचार न झाल्यास: अशक्तपणा व रक्तक्षय, वेळेआधी प्रसूती, कमी वजनाचे बाळ आणि जन्मानंतर बाळाला संसर्ग होणे; फुप्फुसांवर परिणाम झाला असल्यास भुलीच्या वेळी श्वासाच्या समस्या.',
      hi: 'बीमारी सक्रिय होने पर या पूरा इलाज न होने पर: कमज़ोरी और खून की कमी, समय से पहले प्रसव, कम वज़न का बच्चा और जन्म के बाद बच्चे में संक्रमण फैलना; फेफड़ों पर असर होने पर एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) के दौरान साँस की समस्याएँ।',
    },
  },
  {
    id: 'syphilis',
    keys: ['cond_syphilis'],
    private: true,
    name: { en: 'Syphilis', mr: 'सिफिलिस', hi: 'सिफलिस' },
    complications: {
      en: 'when it is not fully treated: miscarriage, stillbirth, early delivery and infection of the baby (congenital syphilis).',
      mr: 'पूर्ण उपचार न झाल्यास: गर्भपात, मृत बाळाचा जन्म, वेळेआधी प्रसूती आणि बाळाला संसर्ग (जन्मजात सिफिलिस).',
      hi: 'पूरा इलाज न होने पर: गर्भपात, मृत बच्चे का जन्म, समय से पहले प्रसव और बच्चे में संक्रमण (जन्मजात सिफलिस)।',
    },
  },
  {
    id: 'hepatitis_b',
    keys: ['cond_hepatitis_b'],
    private: true,
    name: { en: 'Hepatitis B', mr: 'हिपॅटायटिस बी', hi: 'हेपेटाइटिस बी' },
    complications: {
      en: 'the infection can pass to the baby at birth (the baby needs a vaccine and an immunoglobulin injection within hours of birth); liver problems in the mother; more bleeding when the liver is affected.',
      mr: 'जन्माच्या वेळी बाळाला संसर्ग होऊ शकतो (जन्मानंतर काही तासांतच बाळाला लस व इम्युनोग्लोब्युलिन इंजेक्शन द्यावे लागते); आईला यकृताच्या (लिव्हरच्या) समस्या; यकृतावर परिणाम झाला असल्यास जास्त रक्तस्राव.',
      hi: 'जन्म के समय बच्चे को संक्रमण हो सकता है (जन्म के कुछ घंटों के भीतर बच्चे को टीका और इम्युनोग्लोबुलिन इंजेक्शन देना ज़रूरी है); माँ को लिवर की समस्याएँ; लिवर पर असर होने पर ज़्यादा खून बहना।',
    },
  },
  {
    id: 'liver',
    keys: ['cond_liver'],
    name: { en: 'Liver disease or jaundice', mr: 'यकृताचा (लिव्हरचा) आजार किंवा कावीळ', hi: 'लिवर की बीमारी या पीलिया' },
    complications: {
      en: 'when the liver is not working well: more bleeding at delivery or an operation because the blood does not clot well, liver failure, early delivery and loss of the baby; some medicines and anaesthetic drugs have to be used with care.',
      mr: 'यकृताचे काम नीट होत नसल्यास: रक्त नीट न गोठल्याने प्रसूतीच्या किंवा शस्त्रक्रियेच्या वेळी जास्त रक्तस्राव, यकृत निकामी होणे, वेळेआधी प्रसूती आणि बाळ दगावणे; काही औषधे व भुलीची औषधे जपून वापरावी लागतात.',
      hi: 'लिवर ठीक से काम न कर रहा हो तो: खून ठीक से न जमने के कारण प्रसव या ऑपरेशन के समय ज़्यादा खून बहना, लिवर का काम बंद होना, समय से पहले प्रसव और बच्चे की मृत्यु; कुछ दवाइयाँ और बेहोशी की दवाइयाँ सावधानी से देनी पड़ती हैं।',
    },
  },
  {
    // From the LOWEST haemoglobin of this pregnancy (careplans/readings.js): it stays after treatment, so the line says
    // "in this pregnancy" and "if still very low". "Anaemia" below stays on offer (unticked) for a haemoglobin that has come up.
    id: 'severe_anaemia',
    keys: ['hb_under_7'],
    name: { en: 'Severe anaemia in this pregnancy (very low haemoglobin)', mr: 'या गरोदरपणात तीव्र रक्तक्षय (हिमोग्लोबिन खूप कमी)', hi: 'इस गर्भावस्था में खून की गंभीर कमी (हीमोग्लोबिन बहुत कम)' },
    complications: {
      en: 'if the haemoglobin is still very low at delivery or an operation: heart failure, serious risk to life from even a small loss of blood, the need for blood transfusion and infection; also early delivery, a small baby and, rarely, loss of the baby.',
      mr: 'प्रसूती किंवा शस्त्रक्रियेच्या वेळी हिमोग्लोबिन अजूनही खूप कमी असल्यास: हार्ट फेल्युअर, थोड्या रक्तस्रावानेही जिवाला गंभीर धोका, रक्त द्यावे लागणे आणि जंतुसंसर्ग; तसेच वेळेआधी प्रसूती, कमी वजनाचे बाळ आणि क्वचित प्रसंगी बाळ दगावणे.',
      hi: 'प्रसव या ऑपरेशन के समय हीमोग्लोबिन अब भी बहुत कम हो तो: हार्ट फेल्योर, थोड़ा खून बहने से भी जान को गंभीर खतरा, खून चढ़ाने की ज़रूरत और संक्रमण; साथ ही समय से पहले प्रसव, कम वज़न का बच्चा और कम ही मामलों में बच्चे की मृत्यु।',
    },
  },
  {
    id: 'anaemia',
    keys: ['cond_anaemia', 'hb_under_11'],
    name: { en: 'Anaemia (low haemoglobin)', mr: 'रक्तक्षय (ॲनिमिया – हिमोग्लोबिन कमी)', hi: 'खून की कमी (एनीमिया – हीमोग्लोबिन कम)' },
    complications: {
      en: 'tiredness and breathlessness, infection, poor tolerance of even the usual loss of blood at delivery or an operation, the need for blood transfusion, early delivery and a small baby.',
      mr: 'थकवा व धाप लागणे, जंतुसंसर्ग, प्रसूती किंवा शस्त्रक्रियेतील नेहमीचा रक्तस्रावही सहन न होणे, रक्त द्यावे लागणे, वेळेआधी प्रसूती आणि कमी वजनाचे बाळ.',
      hi: 'थकान और साँस फूलना, संक्रमण, प्रसव या ऑपरेशन में होने वाला सामान्य खून बहना भी सहन न कर पाना, खून चढ़ाने की ज़रूरत, समय से पहले प्रसव और कम वज़न का बच्चा।',
    },
  },
  {
    id: 'asthma',
    keys: ['cond_asthma'],
    name: { en: 'Asthma', mr: 'दमा (अस्थमा)', hi: 'दमा (अस्थमा)' },
    complications: {
      en: 'attacks of breathlessness in pregnancy, in labour or under anaesthesia, low oxygen for the mother and the baby, early delivery and a small baby.',
      mr: 'गरोदरपणात, प्रसूतीच्या वेळी किंवा भुलीच्या वेळी दम्याचा झटका, आईला व बाळाला ऑक्सिजन कमी पडणे, वेळेआधी प्रसूती आणि कमी वजनाचे बाळ.',
      hi: 'गर्भावस्था, प्रसव या एनेस्थीसिया (बेहोशी या सुन्न करने की दवा) के दौरान दमे का दौरा, माँ और बच्चे को ऑक्सीजन की कमी, समय से पहले प्रसव और कम वज़न का बच्चा।',
    },
  },
  {
    id: 'multiple',
    keys: ['preg_multiple'],
    name: { en: 'Twins or more', mr: 'जुळी किंवा अधिक बाळे', hi: 'जुड़वाँ या उससे अधिक बच्चे' },
    complications: {
      en: 'anaemia, high blood pressure, early delivery, small babies, a baby lying in an abnormal position, the need for a caesarean section, heavy bleeding after delivery and admission of the babies to the newborn unit (NICU).',
      mr: 'रक्तक्षय, उच्च रक्तदाब, वेळेआधी प्रसूती, कमी वजनाची बाळे, बाळ आडवे किंवा उलटे असणे, सिझेरियन शस्त्रक्रियेची गरज, प्रसूतीनंतर खूप रक्तस्राव आणि बाळांना नवजात शिशु कक्षात (NICU) ठेवावे लागणे.',
      hi: 'खून की कमी, हाई ब्लड प्रेशर, समय से पहले प्रसव, कम वज़न के बच्चे, बच्चे का आड़ा या उल्टा होना, सिज़ेरियन ऑपरेशन की ज़रूरत, प्रसव के बाद बहुत खून बहना और बच्चों को नवजात शिशु इकाई (NICU) में भर्ती करना।',
    },
  },
  {
    id: 'placenta_praevia',
    keys: ['preg_placenta_praevia'],
    name: { en: 'Low-lying placenta (placenta praevia)', mr: 'वार खाली असणे (प्लॅसेंटा प्रिव्हिया)', hi: 'आँवल का नीचे होना (प्लेसेंटा प्रीविया)' },
    complications: {
      en: 'sudden heavy bleeding in pregnancy or at delivery, the need for blood transfusion and a caesarean section, early delivery, a placenta that does not separate and, rarely, removal of the uterus.',
      mr: 'गरोदरपणात किंवा प्रसूतीच्या वेळी अचानक खूप रक्तस्राव, रक्त द्यावे लागणे व सिझेरियन शस्त्रक्रियेची गरज, वेळेआधी प्रसूती, वार न सुटणे आणि क्वचित प्रसंगी गर्भाशय काढावे लागणे.',
      hi: 'गर्भावस्था में या प्रसव के समय अचानक बहुत खून बहना, खून चढ़ाने और सिज़ेरियन ऑपरेशन की ज़रूरत, समय से पहले प्रसव, आँवल का अलग न होना और कम ही मामलों में बच्चेदानी निकालना।',
    },
  },
  {
    id: 'bleeding',
    keys: ['preg_bleeding'],
    name: { en: 'Bleeding in this pregnancy', mr: 'या गरोदरपणात रक्तस्राव', hi: 'इस गर्भावस्था में खून आना' },
    complications: {
      en: 'more bleeding, miscarriage or early delivery, the placenta separating early, anaemia, the need for blood transfusion and risk to the baby.',
      mr: 'पुन्हा रक्तस्राव, गर्भपात किंवा वेळेआधी प्रसूती, वार वेळेआधी सुटणे, रक्तक्षय, रक्त द्यावे लागणे आणि बाळाला धोका.',
      hi: 'फिर से खून आना, गर्भपात या समय से पहले प्रसव, आँवल का समय से पहले अलग होना, खून की कमी, खून चढ़ाने की ज़रूरत और बच्चे को खतरा।',
    },
  },
];

const GROUP_OF_KEY = new Map(RISK_GROUPS.flatMap((g) => g.keys.map((k) => [k, g])));

/**
 * The fingerprint of the whole wording (the fixed words and every factor, in every language, with the rules each
 * stands for). A hospital's approval is of exactly this text: any change – also one made without a new version
 * number – makes it a draft again (as careplans/hashes.js does for care-plan templates).
 */
export const RISK_WORDING_HASH = createHash('sha256').update(JSON.stringify([RISK_SECTION, RISK_GROUPS])).digest('hex');

// ---------- HIV: never on a consent form ----------

// Words that plainly name HIV, in a rule's name or in anything a doctor types for a form: HIV in its spellings
// (H.I.V., एचआयव्ही) and written out, AIDS in capitals only ("hearing aids"), PLHIV, RVD / R.V.D., retroviral and
// "retro positive / negative / NR / +ve" (the result either way, as "HIV negative" is refused too), the HIV
// programmes and centres (PPTCT, PMTCT, ICTC, ART centre), CD4, HAART, and the medicines used for HIV. Not "viral
// load", tenofovir or lamivudine (also written for hepatitis B), not "TLE" (also temporal lobe epilepsy), not "NVP"
// (also nausea and vomiting of pregnancy), not "ART" alone or "ART clinic" (assisted reproduction), not
// "seropositive": a form's own line must stay writable. DRAFT list – the owner checks it (docs/CONSENT_FORMS.md).
// The website has the same words (client/src/pages/consents/consentFormat.js) – a test checks that they match.
const HIV_NAMED = /\bHIV(?:-?[12])?\b|\bH\.I\.V\b|\bH\. I\. V\b|\b(?:PLHIV|PLWHA|PLHA|RVD|PPTCT|PMTCT|ICTC|CD4|HAART)\b|\b(?:anti\s*-?\s*)?retro\s*[-–—:=\/(]*\s*(?:virals?\b|virus\b|positive\b|pos\b|negative\b|neg\b|reactive\b|non\s*-?\s*reactive\b|NR\b|status\b|[-–]\s?ve\b|\+)|\b(?:human\s+)?immun[eo]\s*-?\s*deficiency\s+virus\b|\bacquired\s+immun[eo]\s*-?\s*deficiency\s+syndrome\b|\b(?:zidovudine|nevirapine|efavirenz|dolutegravir|lopinavir|ritonavir|atazanavir|raltegravir|abacavir)\b/i;
// (the second line, case-sensitive: AIDS, H I V and R.V.D. in capitals, and the Devanagari spellings एच·आय/आई/आइ·व्ही/वी –
// with dots, spaces, a halant or the abbreviation sign between the letters, only at the start of a word – and एड्स / एडस)
const HIV_NAMED_OTHER = /\bAIDS\b|\bH I V\b|\bR\.\s?V\.\s?D\b(?!['’])|(?:^|[^ऀ-ॣॱ-ॿ])एच्?[\s.\-॰‌‍]*आ[यईइ]्?[\s.\-॰‌‍]*(?:व्ही|वी|व्हि|वि)|एड्?स/;
// "ART centre" is NACO's name for the HIV treatment centre – but an IVF unit is an "ART clinic" (ART Act 2021) and is
// often called an ART centre too: it counts as HIV only when the same text says nothing about assisted reproduction.
// In capitals only ("a state-of-the-art centre").
const ART_CENTRE = /\bART\s+(?:[Pp]lus\s+)?[Cc](?:entre|enter|ENTRE|ENTER)s?\b/;
const ASSISTED_REPRODUCTION = /\b(?:IVF|ICSI|IUI|OPU|embryos?|oocytes?|fertility|infertility|conceived|conception|donor|surrogacy)\b/i;
export const HIV_WORD_SOURCES = [HIV_NAMED.source, HIV_NAMED_OTHER.source, ART_CENTRE.source, ASSISTED_REPRODUCTION.source];
export const namesHiv = (text) => {
  const t = String(text ?? '').replace(/_/g, ' ');
  return HIV_NAMED.test(t) || HIV_NAMED_OTHER.test(t) || (ART_CENTRE.test(t) && !ASSISTED_REPRODUCTION.test(t));
};
export const HIV_ON_CONSENT_MESSAGE =
  'Please remove the HIV status: it is never printed on a consent or information form or kept with it, because relatives and witnesses sign the form. With the patient’s agreement the doctor writes it on the paper by hand. Consent for an HIV test has its own form.';
/**
 * The typed values that name HIV: the keys of `typed` ({ procedure, reason, condition, otherRisks } – whatever a
 * doctor types for one printout). None of them is printed or kept (owner, 14 Nov 2026).
 */
export const typedHivFields = (typed) => Object.keys(typed ?? {}).filter((k) => namesHiv(typed[k]));

/** The hospital's risk rules by their code (rules: the riskRules of its antenatal template; null when not known). */
export const rulesByKey = (rules) => new Map((rules ?? []).map((r) => [r.key, r]));

/**
 * A risk reason about HIV. rule: the hospital's rule with the reason's code, when known – what a rule CHECKS
 * decides, whatever a doctor called it ("RVD reactive", "On ART", a Marathi name). Otherwise: the built-in rule's
 * code, or a code or name that names HIV; and when the rule is not known, any word the rest of Perinexa treats as
 * a sign of HIV (abdm/shareRules.js). Such a reason never reaches a consent form – not as a risk factor and not in
 * a filled-in blank.
 */
export const isHivReason = (reason, rule = null) =>
  rule?.condition === 'hiv' ||
  reason?.key === 'cond_hiv' ||
  namesHiv(reason?.key) ||
  namesHiv(reason?.label) ||
  (!rule && mentionsConfidential([reason?.key, reason?.label]));

// ---------- Which wording a risk reason gets ----------

// Our names and complications were written for the built-in rules as they are. A doctor can change a rule in place
// (its code stays): when it now checks something else, it is the hospital's own rule and is printed by its name with
// a line to write on; when only its cut-off changed, our complications still fit, and our name too unless the name
// states the cut-off (`exact`) – then the rule's own name is printed with our complications.
const BUILT_IN_RULE = new Map(ANTENATAL_DRAFT.riskRules.map((r) => [r.key, r]));
const DIRECTION = { lt: -1, lte: -1, gt: 1, gte: 1, eq: 0 };
const sameDirection = (a, b) => (a == null || b == null ? a == null && b == null : DIRECTION[a] === DIRECTION[b] || DIRECTION[a] === 0 || DIRECTION[b] === 0);
const sameCheck = (rule, builtIn) =>
  Boolean(builtIn) &&
  rule.factor === builtIn.factor &&
  ['condition', 'complication', 'finding'].every((f) => (rule[f] ?? null) === (builtIn[f] ?? null)) &&
  sameDirection(rule.op ?? null, builtIn.op ?? null);
const sameCutOff = (rule, builtIn) => (rule.op ?? null) === (builtIn.op ?? null) && (rule.value ?? null) === (builtIn.value ?? null);
// Marked private also when the factor comes from a rule of the hospital's own on one of these conditions
const PRIVATE_CONDITIONS = ['mental_health', 'syphilis', 'hepatitis_b'];

const HIGHER = { high: 2, moderate: 1 };

/**
 * The risk factors to offer for a patient's consent forms, from the reasons behind her risk level: high ones
 * first. Each: { id, level, name: { en, mr, hi }, complications: { en, mr, hi } | null, private, labels } – labels:
 * the names of the hospital's rules behind it (the website uses them to find the factor in a typed reason).
 * rules: the hospital's risk rules (the riskRules her level was worked out from); without them the reason's code
 * alone decides. A reason from a rule of the hospital's own has no wording of ours: its label is its name and
 * complications is null (a line to write on). HIV is left out. Empty for a patient without risk reasons (the risk
 * level is worked out for antenatal care only).
 */
export function consentRiskFactors(patient, rules = null) {
  if (patient?.careType !== 'antenatal') return [];
  const ruleOf = rulesByKey(rules);
  const byId = new Map();
  for (const reason of patient.risk?.reasons ?? []) {
    if (!reason?.key) continue;
    const rule = ruleOf.get(reason.key) ?? null;
    if (isHivReason(reason, rule)) continue;
    const level = reason.level === 'high' ? 'high' : 'moderate';
    const label = String(reason.label ?? reason.key).slice(0, 200);
    let group = GROUP_OF_KEY.get(reason.key) ?? null;
    let ourName = Boolean(group);
    if (group && rule) {
      const builtIn = BUILT_IN_RULE.get(reason.key);
      if (!sameCheck(rule, builtIn)) group = null;
      ourName = Boolean(group) && !(group.exact && !sameCutOff(rule, builtIn));
    }
    const id = ourName ? group.id : `rule:${reason.key}`;
    const seen = byId.get(id);
    if (seen) {
      if (HIGHER[level] > HIGHER[seen.level]) seen.level = level;
      if (!seen.labels.includes(label)) seen.labels.push(label);
      continue;
    }
    byId.set(id, {
      id,
      level,
      name: ourName ? group.name : { en: label, mr: '', hi: '' },
      complications: group ? group.complications : null,
      private: group ? Boolean(group.private) : PRIVATE_CONDITIONS.includes(rule?.condition),
      labels: [label],
    });
  }
  // A factor that stands for another one too (e.g. the diagnosis "High blood pressure" for a single raised reading)
  for (const g of RISK_GROUPS) if (g.covers && byId.has(g.id)) for (const covered of g.covers) byId.delete(covered);
  return [...byId.values()].sort((a, b) => HIGHER[b.level] - HIGHER[a.level]);
}

/**
 * Whether a doctor of this hospital approved the wording as it is now, and who: { version, approved, approvedByName,
 * approvedAt }. Approved = this version AND exactly this text (the fingerprint kept with the approval).
 */
export function riskWordingStatus(tenant) {
  const w = tenant?.consentRiskWording ?? {};
  const approved = w.approvedVersion === RISK_WORDING_VERSION && w.approvedHash === RISK_WORDING_HASH;
  return { version: RISK_WORDING_VERSION, approved, approvedByName: approved ? (w.approvedByName ?? null) : null, approvedAt: approved ? (w.approvedAt ?? null) : null };
}

/** The whole wording, for the library page where a doctor reads and approves it. */
export const riskWordingJSON = () => ({
  section: RISK_SECTION,
  groups: RISK_GROUPS.map((g) => ({ id: g.id, name: g.name, complications: g.complications, private: Boolean(g.private) })),
});
