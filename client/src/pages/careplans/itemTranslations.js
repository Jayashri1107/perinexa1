// The patient wording of the BUILT-IN care-plan items in Marathi and Hindi, by item key (the templates in
// server/src/careplans/antenatalDraft.js and otherDrafts.js – antenatal, postnatal, newborn, gynaecology, infertility;
// the pregnancy-loss template, ABORTION_DRAFT, has no lines here yet: its items print in English). Used on the patient
// copy of the care plan and in the patient portal.
//
// ⚠️ DRAFT – the Marathi and Hindi wording was written by the software developer and must be checked by fluent
// speakers (and the medical words by a doctor) before it is used with patients. Listed in docs/TRANSLATIONS_TO_CHECK.md.
//
// A translation is used ONLY while the item's English patient wording is still exactly the built-in one (`en` below):
// an item whose wording a doctor changed in the template, or an item a doctor added to a plan, prints as typed, in
// English – never a translation of other words. A server test (server/tests/careplan-print.test.js) checks that every
// built-in item has its line here and that `en` is word for word the built-in wording.

const T = (en, mr, hi) => ({ en, mr, hi });

export const ITEM_TRANSLATIONS = {
  // ── Antenatal: visits ──
  visit_booking: T('First pregnancy check-up', 'गरोदरपणाची पहिली तपासणी', 'गर्भावस्था की पहली जाँच'),
  visit_16: T('Check-up at about 16 weeks', 'सुमारे 16 आठवड्यांची तपासणी', 'लगभग 16 हफ़्ते पर जाँच'),
  visit_20: T('Check-up at about 20 weeks', 'सुमारे 20 आठवड्यांची तपासणी', 'लगभग 20 हफ़्ते पर जाँच'),
  visit_24: T('Check-up at about 24–26 weeks', 'सुमारे 24–26 आठवड्यांची तपासणी', 'लगभग 24–26 हफ़्ते पर जाँच'),
  visit_28: T('Check-up at about 28–30 weeks', 'सुमारे 28–30 आठवड्यांची तपासणी', 'लगभग 28–30 हफ़्ते पर जाँच'),
  visit_32: T('Check-up at about 32 weeks', 'सुमारे 32 आठवड्यांची तपासणी', 'लगभग 32 हफ़्ते पर जाँच'),
  visit_34: T('Check-up at about 34 weeks', 'सुमारे 34 आठवड्यांची तपासणी', 'लगभग 34 हफ़्ते पर जाँच'),
  visit_36: T('Check-up at 36 weeks', '36 आठवड्यांची तपासणी', '36 हफ़्ते पर जाँच'),
  visit_37: T('Check-up at 37 weeks', '37 आठवड्यांची तपासणी', '37 हफ़्ते पर जाँच'),
  visit_38: T('Check-up at 38 weeks', '38 आठवड्यांची तपासणी', '38 हफ़्ते पर जाँच'),
  visit_39: T('Check-up at 39 weeks', '39 आठवड्यांची तपासणी', '39 हफ़्ते पर जाँच'),
  visit_40: T('Check-up at 40 weeks (due date)', '40 आठवड्यांची तपासणी (प्रसूतीची अंदाजे तारीख)', '40 हफ़्ते पर जाँच (प्रसव की अनुमानित तारीख़)'),
  visit_41: T('Check-up at 41 weeks if baby not yet born', 'बाळाचा जन्म अजून झाला नसल्यास 41 आठवड्यांची तपासणी', 'शिशु का जन्म अभी न हुआ हो तो 41 हफ़्ते पर जाँच'),

  // ── Antenatal: tests ──
  lab_cbc: T('Blood test (haemoglobin)', 'रक्त तपासणी (हिमोग्लोबिन)', 'ख़ून की जाँच (हीमोग्लोबिन)'),
  lab_group: T('Blood group test', 'रक्तगटाची तपासणी', 'ब्लड ग्रुप की जाँच'),
  lab_urine: T('Urine test', 'लघवीची तपासणी', 'पेशाब की जाँच'),
  lab_ogtt1: T('Sugar test (glucose drink test)', 'साखरेची तपासणी (ग्लुकोजचे पाणी पिऊन)', 'शुगर की जाँच (ग्लूकोज़ का पानी पीकर)'),
  lab_hiv: T('HIV test', 'एचआयव्ही (HIV) तपासणी', 'एचआईवी (HIV) की जाँच'),
  lab_vdrl: T('Syphilis blood test', 'सिफिलीसची रक्त तपासणी', 'सिफ़लिस की ख़ून की जाँच'),
  lab_hbsag: T('Hepatitis B blood test', 'हिपॅटायटिस बी ची रक्त तपासणी', 'हेपेटाइटिस बी की ख़ून की जाँच'),
  lab_tsh: T('Thyroid blood test', 'थायरॉईडची रक्त तपासणी', 'थायरॉइड की ख़ून की जाँच'),
  lab_ict1: T('Antibody blood test (Rh negative)', 'अँटिबॉडीची रक्त तपासणी (Rh निगेटिव्ह)', 'एंटीबॉडी की ख़ून की जाँच (Rh नेगेटिव)'),
  lab_ogtt2: T('Repeat sugar test', 'साखरेची तपासणी पुन्हा', 'शुगर की जाँच दोबारा'),
  lab_hb28: T('Repeat blood test (haemoglobin)', 'रक्त तपासणी पुन्हा (हिमोग्लोबिन)', 'ख़ून की जाँच दोबारा (हीमोग्लोबिन)'),
  lab_ict28: T('Repeat antibody blood test', 'अँटिबॉडीची रक्त तपासणी पुन्हा', 'एंटीबॉडी की ख़ून की जाँच दोबारा'),
  lab_hb36: T('Blood and urine tests before delivery', 'प्रसूतीपूर्वी रक्त व लघवीच्या तपासण्या', 'प्रसव से पहले ख़ून और पेशाब की जाँचें'),

  // ── Antenatal: ultrasound (sonography) ──
  scan_dating: T('First ultrasound (to confirm dates)', 'पहिली सोनोग्राफी (तारखा निश्चित करण्यासाठी)', 'पहली सोनोग्राफ़ी (तारीख़ें पक्की करने के लिए)'),
  scan_nt: T('Ultrasound and blood test for baby’s health (11–13 weeks)', 'बाळाच्या आरोग्यासाठी सोनोग्राफी व रक्त तपासणी (11–13 आठवडे)', 'शिशु के स्वास्थ्य के लिए सोनोग्राफ़ी और ख़ून की जाँच (11–13 हफ़्ते)'),
  scan_anomaly: T('Detailed ultrasound of baby (18–20 weeks)', 'बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे)', 'शिशु की विस्तृत सोनोग्राफ़ी (18–20 हफ़्ते)'),
  scan_growth32: T('Ultrasound to check baby’s growth', 'बाळाची वाढ तपासण्यासाठी सोनोग्राफी', 'शिशु की बढ़त जाँचने के लिए सोनोग्राफ़ी'),
  scan_doppler: T('Ultrasound with blood-flow check', 'रक्तप्रवाहाच्या तपासणीसह सोनोग्राफी', 'ख़ून के बहाव की जाँच के साथ सोनोग्राफ़ी'),
  scan_twins_24: T('Ultrasound to check growth (24 weeks)', 'वाढ तपासण्यासाठी सोनोग्राफी (24 आठवडे)', 'बढ़त जाँचने के लिए सोनोग्राफ़ी (24 हफ़्ते)'),
  scan_twins_28: T('Ultrasound to check growth (28 weeks)', 'वाढ तपासण्यासाठी सोनोग्राफी (28 आठवडे)', 'बढ़त जाँचने के लिए सोनोग्राफ़ी (28 हफ़्ते)'),
  scan_growth_gdm: T('Ultrasound to check baby’s growth (28–30 weeks)', 'बाळाची वाढ तपासण्यासाठी सोनोग्राफी (28–30 आठवडे)', 'शिशु की बढ़त जाँचने के लिए सोनोग्राफ़ी (28–30 हफ़्ते)'),
  scan_twins_32: T('Ultrasound to check growth (32 weeks)', 'वाढ तपासण्यासाठी सोनोग्राफी (32 आठवडे)', 'बढ़त जाँचने के लिए सोनोग्राफ़ी (32 हफ़्ते)'),
  scan_placenta_32: T('Follow-up ultrasound (32 weeks)', 'पुन्हा सोनोग्राफी (32 आठवडे)', 'दोबारा सोनोग्राफ़ी (32 हफ़्ते)'),

  // ── Antenatal: injections ──
  vacc_td1: T('Tetanus (Td) injection – dose 1', 'धनुर्वाताचे (Td) इंजेक्शन – डोस 1', 'टिटनेस (Td) का इंजेक्शन – ख़ुराक 1'),
  vacc_td2: T('Tetanus (Td) injection – dose 2', 'धनुर्वाताचे (Td) इंजेक्शन – डोस 2', 'टिटनेस (Td) का इंजेक्शन – ख़ुराक 2'),
  vacc_tdap: T('Tdap injection (protects baby from whooping cough)', 'Tdap इंजेक्शन (बाळाचे डांग्या खोकल्यापासून संरक्षण करते)', 'Tdap इंजेक्शन (शिशु को काली खाँसी से बचाता है)'),
  vacc_flu: T('Flu injection (if in flu season)', 'फ्लूचे इंजेक्शन (फ्लूचा हंगाम असल्यास)', 'फ़्लू का इंजेक्शन (फ़्लू का मौसम हो तो)'),
  anti_d: T('Anti-D injection (Rh negative)', 'अँटी-डी इंजेक्शन (Rh निगेटिव्ह)', 'एंटी-डी इंजेक्शन (Rh नेगेटिव)'),

  // ── Antenatal: medicines ──
  med_folic: T('Folic acid tablet every day until 3 months', 'रोज फॉलिक ॲसिडची गोळी, 3 महिन्यांपर्यंत', 'रोज़ फ़ोलिक एसिड की गोली, 3 महीने तक'),
  med_ifa: T('Iron tablet every day from 4th month', 'गरोदरपणाच्या 4 थ्या महिन्यापासून रोज लोहाची (आयर्न) गोळी', 'गर्भावस्था के 4थे महीने से रोज़ आयरन की गोली'),
  med_calcium: T('Calcium tablets from 4th month', 'गरोदरपणाच्या 4 थ्या महिन्यापासून कॅल्शियमच्या गोळ्या', 'गर्भावस्था के 4थे महीने से कैल्शियम की गोलियाँ'),
  med_deworm: T('Deworming tablet (one dose)', 'जंतनाशक गोळी (एकच डोस)', 'पेट के कीड़ों की गोली (एक ख़ुराक)'),

  // ── Antenatal: advice ──
  adv_diet: T(
    'Eat a balanced diet, rest well, and keep taking your tablets',
    'संतुलित आहार घ्या, पुरेशी विश्रांती घ्या आणि गोळ्या नियमित घेत राहा',
    'संतुलित आहार लें, अच्छी तरह आराम करें और अपनी गोलियाँ लेती रहें',
  ),
  adv_danger: T(
    'Come to hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking water or reduced baby movements',
    'रक्तस्राव, तीव्र डोकेदुखी, धूसर दिसणे, झटके, ताप, पाणी जाणे किंवा बाळाची हालचाल कमी झाल्यास लगेच रुग्णालयात या',
    'ख़ून आना, तेज़ सिरदर्द, धुंधला दिखना, दौरे, बुख़ार, पानी जाना या शिशु की हलचल कम होने पर तुरंत अस्पताल आएँ',
  ),
  adv_fmc: T('Count your baby’s movements every day', 'बाळाच्या हालचाली रोज मोजा', 'रोज़ अपने शिशु की हलचल गिनें'),
  adv_birthplan: T('Plan for delivery; learn about breastfeeding', 'प्रसूतीची तयारी करा; स्तनपानाबद्दल माहिती घ्या', 'प्रसव की तैयारी करें; स्तनपान के बारे में जानें'),
  adv_twins_placentas: T('Ask your doctor how often you need an ultrasound scan', 'सोनोग्राफी किती वेळा करायची ते तुमच्या डॉक्टरांना विचारा', 'सोनोग्राफ़ी कितनी बार करानी है, यह अपने डॉक्टर से पूछें'),

  // ── Postnatal (after delivery) ──
  pnc_day1: T('Check-up on the day after delivery', 'प्रसूतीनंतरच्या दिवशी तपासणी', 'प्रसव के अगले दिन जाँच'),
  pnc_day3: T('Check-up about 3 days after delivery', 'प्रसूतीनंतर सुमारे 3 दिवसांनी तपासणी', 'प्रसव के लगभग 3 दिन बाद जाँच'),
  pnc_wk1: T('Check-up 1–2 weeks after delivery', 'प्रसूतीनंतर 1–2 आठवड्यांनी तपासणी', 'प्रसव के 1–2 हफ़्ते बाद जाँच'),
  pnc_cs_wound: T('Wound check about a week after the operation', 'ऑपरेशननंतर सुमारे एका आठवड्याने जखमेची (टाक्यांची) तपासणी', 'ऑपरेशन के लगभग एक हफ़्ते बाद घाव (टाँकों) की जाँच'),
  pnc_wk6: T('Check-up 6 weeks after delivery', 'प्रसूतीनंतर 6 आठवड्यांनी तपासणी', 'प्रसव के 6 हफ़्ते बाद जाँच'),
  pnc_hb: T('Blood test for haemoglobin at 6 weeks', '6 आठवड्यांनी हिमोग्लोबिनसाठी रक्त तपासणी', '6 हफ़्ते पर हीमोग्लोबिन के लिए ख़ून की जाँच'),
  pnc_bp: T('Blood pressure check in the first week', 'पहिल्या आठवड्यात रक्तदाबाची तपासणी', 'पहले हफ़्ते में ब्लड प्रेशर की जाँच'),
  pnc_sugar: T('Blood sugar test after delivery', 'प्रसूतीनंतर रक्तातील साखरेची तपासणी', 'प्रसव के बाद ख़ून में शुगर की जाँच'),
  pnc_antid: T('Anti-D injection soon after delivery', 'प्रसूतीनंतर लवकरात लवकर अँटी-डी इंजेक्शन', 'प्रसव के बाद जल्द से जल्द एंटी-डी इंजेक्शन'),
  pnc_ifa: T('Iron tablets every day for 6 months', '6 महिने रोज लोहाच्या (आयर्न) गोळ्या', '6 महीने तक रोज़ आयरन की गोलियाँ'),
  pnc_calcium: T('Calcium tablets every day for 6 months', '6 महिने रोज कॅल्शियमच्या गोळ्या', '6 महीने तक रोज़ कैल्शियम की गोलियाँ'),
  pnc_adv_bf: T('Give only breast milk for the first 6 months', 'पहिले 6 महिने बाळाला फक्त आईचे दूध द्या', 'पहले 6 महीने शिशु को सिर्फ़ माँ का दूध दें'),
  pnc_adv_danger: T(
    'Come at once for heavy bleeding, fever, bad-smelling discharge, severe headache or breathlessness',
    'जास्त रक्तस्राव, ताप, दुर्गंधीयुक्त स्राव, तीव्र डोकेदुखी किंवा धाप लागल्यास लगेच या',
    'ज़्यादा ख़ून आना, बुख़ार, बदबूदार स्राव, तेज़ सिरदर्द या साँस फूलने पर तुरंत आएँ',
  ),
  pnc_adv_contra: T('Talk about family planning', 'कुटुंब नियोजनाबद्दल चर्चा करा', 'परिवार नियोजन के बारे में बात करें'),

  // ── Newborn (the baby's care and vaccinations) ──
  nb_exam: T('Baby’s first check-up', 'बाळाची पहिली तपासणी', 'शिशु की पहली जाँच'),
  nb_check: T('Baby check-up in the first week', 'पहिल्या आठवड्यात बाळाची तपासणी', 'पहले हफ़्ते में शिशु की जाँच'),
  nb_lab_screening: T('Heel-prick blood test for the baby (after 2 days of age)', 'बाळाच्या टाचेतून रक्त घेऊन तपासणी (2 दिवसांनंतर)', 'शिशु की एड़ी से ख़ून लेकर जाँच (2 दिन की उम्र के बाद)'),
  nb_cchd: T("Oxygen check on the baby's hand and foot", 'बाळाच्या हातावर व पायावर ऑक्सिजनची तपासणी', 'शिशु के हाथ और पैर पर ऑक्सीजन की जाँच'),
  nb_hearing: T("Baby's hearing test", 'बाळाच्या ऐकण्याची तपासणी', 'शिशु की सुनने की जाँच'),
  nb_vacc_birth: T('Vaccines at birth: BCG, polio drops, Hepatitis B', 'जन्माच्या वेळच्या लसी: बीसीजी (BCG), पोलिओचे थेंब, हिपॅटायटिस बी', 'जन्म के समय के टीके: बीसीजी (BCG), पोलियो की बूँदें, हेपेटाइटिस बी'),
  nb_vacc_6w: T('Vaccines at 6 weeks', '6 आठवड्यांच्या लसी', '6 हफ़्ते पर टीके'),
  nb_vacc_10w: T('Vaccines at 10 weeks', '10 आठवड्यांच्या लसी', '10 हफ़्ते पर टीके'),
  nb_vacc_14w: T('Vaccines at 14 weeks', '14 आठवड्यांच्या लसी', '14 हफ़्ते पर टीके'),
  nb_vacc_9m: T('Vaccines at 9 months (measles–rubella)', '9 महिन्यांच्या लसी (गोवर–रुबेला)', '9 महीने पर टीके (खसरा–रूबेला)'),
  nb_vita_1: T('Vitamin A at 9 months', '9 महिन्यांचे झाल्यावर व्हिटॅमिन ए', '9 महीने पर विटामिन ए'),
  nb_vacc_16m: T('Vaccines at 16–24 months', '16–24 महिन्यांच्या लसी', '16–24 महीने पर टीके'),
  nb_vita_2: T('Vitamin A every 6 months till 5 years', '5 वर्षांपर्यंत दर 6 महिन्यांनी व्हिटॅमिन ए', '5 साल तक हर 6 महीने पर विटामिन ए'),
  nb_vacc_5y: T('Vaccine at 5–6 years', '5–6 वर्षांची लस', '5–6 साल पर टीका'),
  nb_vacc_10y: T('Vaccine at 10 years', '10 वर्षांची लस', '10 साल पर टीका'),
  nb_vacc_16y: T('Vaccine at 16 years', '16 वर्षांची लस', '16 साल पर टीका'),
  nb_adv_bf: T(
    'Only breast milk for 6 months, keep the baby warm, keep the cord dry',
    '6 महिने फक्त आईचे दूध द्या, बाळाला उबदार ठेवा, नाळ कोरडी ठेवा',
    '6 महीने तक सिर्फ़ माँ का दूध दें, शिशु को गरम रखें, नाल को सूखा रखें',
  ),
  nb_adv_danger: T(
    'Come at once if the baby feeds poorly, breathes fast, is hot or cold, turns yellow or has fits',
    'बाळ नीट दूध पीत नसल्यास, भरभर श्वास घेत असल्यास, अंग गरम किंवा थंड लागल्यास, पिवळे दिसू लागल्यास किंवा झटके आल्यास लगेच या',
    'शिशु ठीक से दूध न पिए, तेज़ साँस ले, शरीर गरम या ठंडा लगे, पीला पड़ने लगे या दौरे आएँ तो तुरंत आएँ',
  ),

  // ── Gynaecology ──
  gyn_first: T('First check-up', 'पहिली तपासणी', 'पहली जाँच'),
  gyn_hb: T('Blood test for haemoglobin', 'हिमोग्लोबिनसाठी रक्त तपासणी', 'हीमोग्लोबिन के लिए ख़ून की जाँच'),
  gyn_breast: T('Breast examination', 'स्तनांची तपासणी', 'स्तनों की जाँच'),
  gyn_cervix: T('Test for cervical cancer (if due)', 'गर्भाशयमुखाच्या कर्करोगाची तपासणी (करायची वेळ झाली असल्यास)', 'बच्चेदानी के मुँह के कैंसर की जाँच (समय हो गया हो तो)'),
  gyn_review: T('Come back with the reports', 'रिपोर्ट घेऊन पुन्हा या', 'रिपोर्ट लेकर दोबारा आएँ'),
  gyn_annual: T('Yearly check-up', 'वार्षिक तपासणी', 'सालाना जाँच'),
  gyn_cervix_repeat: T('Repeat cervical cancer test', 'गर्भाशयमुखाच्या कर्करोगाची तपासणी पुन्हा', 'बच्चेदानी के मुँह के कैंसर की जाँच दोबारा'),

  // ── Infertility (fertility care) ──
  inf_first: T('First fertility check-up (please come with your partner)', 'गर्भधारणेसाठी पहिली तपासणी (कृपया जोडीदारासोबत या)', 'गर्भधारण के लिए पहली जाँच (कृपया अपने साथी के साथ आएँ)'),
  inf_folic: T('Folic acid tablet every day', 'रोज फॉलिक ॲसिडची गोळी', 'रोज़ फ़ोलिक एसिड की गोली'),
  inf_hormones: T('Blood tests on day 2–3 of the period', 'पाळीच्या 2 ऱ्या–3 ऱ्या दिवशी रक्ताच्या तपासण्या', 'माहवारी के 2रे–3रे दिन ख़ून की जाँचें'),
  inf_tvs: T('Scan early in the cycle', 'पाळीच्या सुरुवातीच्या दिवसांत सोनोग्राफी', 'माहवारी चक्र की शुरुआत में सोनोग्राफ़ी'),
  inf_semen: T('Semen test for your partner', 'तुमच्या जोडीदाराची वीर्य तपासणी', 'आपके साथी के वीर्य की जाँच'),
  inf_infections: T('Blood tests for both partners', 'दोघांच्याही रक्ताच्या तपासण्या', 'दोनों साथियों की ख़ून की जाँचें'),
  inf_tubal: T('Test to check the tubes', 'नलिका (ट्यूब) तपासण्याची चाचणी', 'नलियों (ट्यूब) की जाँच'),
  inf_review: T('Come back with all the reports', 'सर्व रिपोर्ट घेऊन पुन्हा या', 'सारी रिपोर्ट लेकर दोबारा आएँ'),
  inf_review_3m: T('Check-up after 3 months', '3 महिन्यांनी तपासणी', '3 महीने बाद जाँच'),
  inf_adv: T(
    'Healthy weight, no smoking or alcohol; your doctor explains the fertile days',
    'वजन योग्य ठेवा, धूम्रपान व मद्यपान करू नका; गर्भधारणेसाठी योग्य दिवस तुमचे डॉक्टर समजावून सांगतील',
    'वज़न सही रखें, धूम्रपान और शराब न लें; गर्भधारण के सही दिन आपके डॉक्टर समझाएँगे',
  ),
};

/** The languages the patient wording is kept in (English is the template's own wording). */
export const ITEM_LANGUAGES = ['mr', 'hi'];

/**
 * The Marathi or Hindi wording of a care-plan item for the patient, or null when it must print as typed (in English):
 * - key: the template item's key – null (or a custom key) for an item a doctor added to the plan;
 * - text: the item's English patient wording as it is now (the plan's copy of the template).
 * A translation is used only when `text` is still word for word the built-in English. lang 'en' → null.
 */
export function translatedItemText({ key, text }, lang) {
  if (!ITEM_LANGUAGES.includes(lang) || !key || typeof text !== 'string') return null;
  const t = Object.hasOwn(ITEM_TRANSLATIONS, key) ? ITEM_TRANSLATIONS[key] : null;
  return t && text === t.en ? t[lang] : null;
}

/** The same for a PlanView item ({ key, origin, patientText }): only template items, only their patient wording. */
export const planItemText = (item, lang) => translatedItemText({ key: item?.origin === 'template' ? item.key : null, text: item?.patientText }, lang);

// The built-in item whose English patient wording this is (every built-in wording is different – a test checks it).
const KEY_BY_ENGLISH = new Map(Object.entries(ITEM_TRANSLATIONS).map(([key, t]) => [t.en, key]));

/**
 * The same for a care-plan item in the patient portal ({ builtIn, text }): the portal is never sent an item's key (a
 * key can name a diagnosis), only `builtIn` – which the server sets with the rule of planItemText (a built-in item
 * whose wording is still word for word its own built-in English; server/src/careplans/plansService.js). Such an item
 * is found here by its wording; anything else (added, reworded, a hospital's own item) is shown as typed.
 */
export const portalItemTranslation = (item, lang) =>
  item?.builtIn === true && typeof item.text === 'string' ? translatedItemText({ key: KEY_BY_ENGLISH.get(item.text) ?? null, text: item.text }, lang) : null;
