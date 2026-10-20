# Marathi and Hindi wording to check

⚠️ **DRAFT.** Everything in Marathi and Hindi below was written by the software developer (an AI assistant) on 5 October 2026 and has **not** been checked by a fluent speaker. The medical words should also be checked by a doctor. Until then, the app says on the print preview and at the top of the portal that this wording is a draft.

Where it is used – what the patient herself reads:

- the **patient copy of the care plan** (Care plan tab → Print → Patient copy);
- the **discharge card** (a stay → the discharge card → Print);
- the **patient portal** (the address /portal) and the **paper with her portal code**.

On paper the English is always printed, with the Marathi or Hindi under it (or after it, with " / ", for short labels), as on the prescriptions and the consent forms. Staff copies stay in English. What staff typed – advice, notes, the diagnosis, names, an item a doctor added or reworded – is never translated.

How to check: read each line next to its English. Keep dates (`20 Oct 2026`), numbers in figures and words in capitals such as `HIV`, `Td`, `EDD` as they are. Write the corrected wording next to the line (or in a copy of this file) and give it to the developer: the wording lives in the file named in each section. The prescriptions’ own words (dose, how often, before or after food, how long) are listed in `docs/PRESCRIPTIONS.md`; the consent forms’ in `docs/CONSENT_FORMS.md`.

In all: 99 care-plan items, and the fixed words of the three pages and the code paper.

- [ ] Marathi checked by a fluent speaker (name, date): 
- [ ] Hindi checked by a fluent speaker (name, date): 
- [ ] Medical words checked by a doctor (name, date): 

## 1. The built-in care-plan items

File: `client/src/pages/careplans/itemTranslations.js`. Printed on the patient copy of the care plan (under the English) and shown in the patient portal. A line is used only while the item’s English wording is still exactly the one below; an item a doctor reworded or added is printed in English, as typed.

The built-in pregnancy-loss template (the Abortion type of care, added to the app on 5 October 2026 alongside this work) has no Marathi or Hindi yet: its items print and show in the portal in English only, and the print preview counts them among the items printed in English only.

### Pregnancy (antenatal)

| Item | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `visit_booking` (visit) | First pregnancy check-up | गरोदरपणाची पहिली तपासणी | गर्भावस्था की पहली जाँच |
| `visit_16` (visit) | Check-up at about 16 weeks | सुमारे 16 आठवड्यांची तपासणी | लगभग 16 हफ़्ते पर जाँच |
| `visit_20` (visit) | Check-up at about 20 weeks | सुमारे 20 आठवड्यांची तपासणी | लगभग 20 हफ़्ते पर जाँच |
| `visit_24` (visit) | Check-up at about 24–26 weeks | सुमारे 24–26 आठवड्यांची तपासणी | लगभग 24–26 हफ़्ते पर जाँच |
| `visit_28` (visit) | Check-up at about 28–30 weeks | सुमारे 28–30 आठवड्यांची तपासणी | लगभग 28–30 हफ़्ते पर जाँच |
| `visit_32` (visit) | Check-up at about 32 weeks | सुमारे 32 आठवड्यांची तपासणी | लगभग 32 हफ़्ते पर जाँच |
| `visit_34` (visit) | Check-up at about 34 weeks | सुमारे 34 आठवड्यांची तपासणी | लगभग 34 हफ़्ते पर जाँच |
| `visit_36` (visit) | Check-up at 36 weeks | 36 आठवड्यांची तपासणी | 36 हफ़्ते पर जाँच |
| `visit_37` (visit) | Check-up at 37 weeks | 37 आठवड्यांची तपासणी | 37 हफ़्ते पर जाँच |
| `visit_38` (visit) | Check-up at 38 weeks | 38 आठवड्यांची तपासणी | 38 हफ़्ते पर जाँच |
| `visit_39` (visit) | Check-up at 39 weeks | 39 आठवड्यांची तपासणी | 39 हफ़्ते पर जाँच |
| `visit_40` (visit) | Check-up at 40 weeks (due date) | 40 आठवड्यांची तपासणी (प्रसूतीची अंदाजे तारीख) | 40 हफ़्ते पर जाँच (प्रसव की अनुमानित तारीख़) |
| `visit_41` (visit) | Check-up at 41 weeks if baby not yet born | बाळाचा जन्म अजून झाला नसल्यास 41 आठवड्यांची तपासणी | शिशु का जन्म अभी न हुआ हो तो 41 हफ़्ते पर जाँच |
| `lab_cbc` (investigation) | Blood test (haemoglobin) | रक्त तपासणी (हिमोग्लोबिन) | ख़ून की जाँच (हीमोग्लोबिन) |
| `lab_group` (investigation) | Blood group test | रक्तगटाची तपासणी | ब्लड ग्रुप की जाँच |
| `lab_urine` (investigation) | Urine test | लघवीची तपासणी | पेशाब की जाँच |
| `lab_ogtt1` (investigation) | Sugar test (glucose drink test) | साखरेची तपासणी (ग्लुकोजचे पाणी पिऊन) | शुगर की जाँच (ग्लूकोज़ का पानी पीकर) |
| `lab_hiv` (investigation) | HIV test | एचआयव्ही (HIV) तपासणी | एचआईवी (HIV) की जाँच |
| `lab_vdrl` (investigation) | Syphilis blood test | सिफिलीसची रक्त तपासणी | सिफ़लिस की ख़ून की जाँच |
| `lab_hbsag` (investigation) | Hepatitis B blood test | हिपॅटायटिस बी ची रक्त तपासणी | हेपेटाइटिस बी की ख़ून की जाँच |
| `lab_tsh` (investigation) | Thyroid blood test | थायरॉईडची रक्त तपासणी | थायरॉइड की ख़ून की जाँच |
| `lab_ict1` (investigation) | Antibody blood test (Rh negative) | अँटिबॉडीची रक्त तपासणी (Rh निगेटिव्ह) | एंटीबॉडी की ख़ून की जाँच (Rh नेगेटिव) |
| `lab_ogtt2` (investigation) | Repeat sugar test | साखरेची तपासणी पुन्हा | शुगर की जाँच दोबारा |
| `lab_hb28` (investigation) | Repeat blood test (haemoglobin) | रक्त तपासणी पुन्हा (हिमोग्लोबिन) | ख़ून की जाँच दोबारा (हीमोग्लोबिन) |
| `lab_ict28` (investigation) | Repeat antibody blood test | अँटिबॉडीची रक्त तपासणी पुन्हा | एंटीबॉडी की ख़ून की जाँच दोबारा |
| `lab_hb36` (investigation) | Blood and urine tests before delivery | प्रसूतीपूर्वी रक्त व लघवीच्या तपासण्या | प्रसव से पहले ख़ून और पेशाब की जाँचें |
| `scan_dating` (scan) | First ultrasound (to confirm dates) | पहिली सोनोग्राफी (तारखा निश्चित करण्यासाठी) | पहली सोनोग्राफ़ी (तारीख़ें पक्की करने के लिए) |
| `scan_nt` (scan) | Ultrasound and blood test for baby’s health (11–13 weeks) | बाळाच्या आरोग्यासाठी सोनोग्राफी व रक्त तपासणी (11–13 आठवडे) | शिशु के स्वास्थ्य के लिए सोनोग्राफ़ी और ख़ून की जाँच (11–13 हफ़्ते) |
| `scan_anomaly` (scan) | Detailed ultrasound of baby (18–20 weeks) | बाळाची सविस्तर सोनोग्राफी (18–20 आठवडे) | शिशु की विस्तृत सोनोग्राफ़ी (18–20 हफ़्ते) |
| `scan_growth32` (scan) | Ultrasound to check baby’s growth | बाळाची वाढ तपासण्यासाठी सोनोग्राफी | शिशु की बढ़त जाँचने के लिए सोनोग्राफ़ी |
| `scan_doppler` (scan) | Ultrasound with blood-flow check | रक्तप्रवाहाच्या तपासणीसह सोनोग्राफी | ख़ून के बहाव की जाँच के साथ सोनोग्राफ़ी |
| `scan_twins_24` (scan) | Ultrasound to check growth (24 weeks) | वाढ तपासण्यासाठी सोनोग्राफी (24 आठवडे) | बढ़त जाँचने के लिए सोनोग्राफ़ी (24 हफ़्ते) |
| `scan_twins_28` (scan) | Ultrasound to check growth (28 weeks) | वाढ तपासण्यासाठी सोनोग्राफी (28 आठवडे) | बढ़त जाँचने के लिए सोनोग्राफ़ी (28 हफ़्ते) |
| `scan_growth_gdm` (scan) | Ultrasound to check baby’s growth (28–30 weeks) | बाळाची वाढ तपासण्यासाठी सोनोग्राफी (28–30 आठवडे) | शिशु की बढ़त जाँचने के लिए सोनोग्राफ़ी (28–30 हफ़्ते) |
| `scan_twins_32` (scan) | Ultrasound to check growth (32 weeks) | वाढ तपासण्यासाठी सोनोग्राफी (32 आठवडे) | बढ़त जाँचने के लिए सोनोग्राफ़ी (32 हफ़्ते) |
| `scan_placenta_32` (scan) | Follow-up ultrasound (32 weeks) | पुन्हा सोनोग्राफी (32 आठवडे) | दोबारा सोनोग्राफ़ी (32 हफ़्ते) |
| `vacc_td1` (vaccination) | Tetanus (Td) injection – dose 1 | धनुर्वाताचे (Td) इंजेक्शन – डोस 1 | टिटनेस (Td) का इंजेक्शन – ख़ुराक 1 |
| `vacc_td2` (vaccination) | Tetanus (Td) injection – dose 2 | धनुर्वाताचे (Td) इंजेक्शन – डोस 2 | टिटनेस (Td) का इंजेक्शन – ख़ुराक 2 |
| `vacc_tdap` (vaccination) | Tdap injection (protects baby from whooping cough) | Tdap इंजेक्शन (बाळाचे डांग्या खोकल्यापासून संरक्षण करते) | Tdap इंजेक्शन (शिशु को काली खाँसी से बचाता है) |
| `vacc_flu` (vaccination) | Flu injection (if in flu season) | फ्लूचे इंजेक्शन (फ्लूचा हंगाम असल्यास) | फ़्लू का इंजेक्शन (फ़्लू का मौसम हो तो) |
| `anti_d` (vaccination) | Anti-D injection (Rh negative) | अँटी-डी इंजेक्शन (Rh निगेटिव्ह) | एंटी-डी इंजेक्शन (Rh नेगेटिव) |
| `med_folic` (medication) | Folic acid tablet every day until 3 months | रोज फॉलिक ॲसिडची गोळी, 3 महिन्यांपर्यंत | रोज़ फ़ोलिक एसिड की गोली, 3 महीने तक |
| `med_ifa` (medication) | Iron tablet every day from 4th month | गरोदरपणाच्या 4 थ्या महिन्यापासून रोज लोहाची (आयर्न) गोळी | गर्भावस्था के 4थे महीने से रोज़ आयरन की गोली |
| `med_calcium` (medication) | Calcium tablets from 4th month | गरोदरपणाच्या 4 थ्या महिन्यापासून कॅल्शियमच्या गोळ्या | गर्भावस्था के 4थे महीने से कैल्शियम की गोलियाँ |
| `med_deworm` (medication) | Deworming tablet (one dose) | जंतनाशक गोळी (एकच डोस) | पेट के कीड़ों की गोली (एक ख़ुराक) |
| `adv_diet` (advice) | Eat a balanced diet, rest well, and keep taking your tablets | संतुलित आहार घ्या, पुरेशी विश्रांती घ्या आणि गोळ्या नियमित घेत राहा | संतुलित आहार लें, अच्छी तरह आराम करें और अपनी गोलियाँ लेती रहें |
| `adv_danger` (advice) | Come to hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking water or reduced baby movements | रक्तस्राव, तीव्र डोकेदुखी, धूसर दिसणे, झटके, ताप, पाणी जाणे किंवा बाळाची हालचाल कमी झाल्यास लगेच रुग्णालयात या | ख़ून आना, तेज़ सिरदर्द, धुंधला दिखना, दौरे, बुख़ार, पानी जाना या शिशु की हलचल कम होने पर तुरंत अस्पताल आएँ |
| `adv_fmc` (advice) | Count your baby’s movements every day | बाळाच्या हालचाली रोज मोजा | रोज़ अपने शिशु की हलचल गिनें |
| `adv_birthplan` (advice) | Plan for delivery; learn about breastfeeding | प्रसूतीची तयारी करा; स्तनपानाबद्दल माहिती घ्या | प्रसव की तैयारी करें; स्तनपान के बारे में जानें |
| `adv_twins_placentas` (advice) | Ask your doctor how often you need an ultrasound scan | सोनोग्राफी किती वेळा करायची ते तुमच्या डॉक्टरांना विचारा | सोनोग्राफ़ी कितनी बार करानी है, यह अपने डॉक्टर से पूछें |

### After delivery (postnatal)

| Item | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `pnc_day1` (visit) | Check-up on the day after delivery | प्रसूतीनंतरच्या दिवशी तपासणी | प्रसव के अगले दिन जाँच |
| `pnc_day3` (visit) | Check-up about 3 days after delivery | प्रसूतीनंतर सुमारे 3 दिवसांनी तपासणी | प्रसव के लगभग 3 दिन बाद जाँच |
| `pnc_wk1` (visit) | Check-up 1–2 weeks after delivery | प्रसूतीनंतर 1–2 आठवड्यांनी तपासणी | प्रसव के 1–2 हफ़्ते बाद जाँच |
| `pnc_cs_wound` (visit) | Wound check about a week after the operation | ऑपरेशननंतर सुमारे एका आठवड्याने जखमेची (टाक्यांची) तपासणी | ऑपरेशन के लगभग एक हफ़्ते बाद घाव (टाँकों) की जाँच |
| `pnc_wk6` (visit) | Check-up 6 weeks after delivery | प्रसूतीनंतर 6 आठवड्यांनी तपासणी | प्रसव के 6 हफ़्ते बाद जाँच |
| `pnc_hb` (investigation) | Blood test for haemoglobin at 6 weeks | 6 आठवड्यांनी हिमोग्लोबिनसाठी रक्त तपासणी | 6 हफ़्ते पर हीमोग्लोबिन के लिए ख़ून की जाँच |
| `pnc_bp` (visit) | Blood pressure check in the first week | पहिल्या आठवड्यात रक्तदाबाची तपासणी | पहले हफ़्ते में ब्लड प्रेशर की जाँच |
| `pnc_sugar` (investigation) | Blood sugar test after delivery | प्रसूतीनंतर रक्तातील साखरेची तपासणी | प्रसव के बाद ख़ून में शुगर की जाँच |
| `pnc_antid` (vaccination) | Anti-D injection soon after delivery | प्रसूतीनंतर लवकरात लवकर अँटी-डी इंजेक्शन | प्रसव के बाद जल्द से जल्द एंटी-डी इंजेक्शन |
| `pnc_ifa` (medication) | Iron tablets every day for 6 months | 6 महिने रोज लोहाच्या (आयर्न) गोळ्या | 6 महीने तक रोज़ आयरन की गोलियाँ |
| `pnc_calcium` (medication) | Calcium tablets every day for 6 months | 6 महिने रोज कॅल्शियमच्या गोळ्या | 6 महीने तक रोज़ कैल्शियम की गोलियाँ |
| `pnc_adv_bf` (advice) | Give only breast milk for the first 6 months | पहिले 6 महिने बाळाला फक्त आईचे दूध द्या | पहले 6 महीने शिशु को सिर्फ़ माँ का दूध दें |
| `pnc_adv_danger` (advice) | Come at once for heavy bleeding, fever, bad-smelling discharge, severe headache or breathlessness | जास्त रक्तस्राव, ताप, दुर्गंधीयुक्त स्राव, तीव्र डोकेदुखी किंवा धाप लागल्यास लगेच या | ज़्यादा ख़ून आना, बुख़ार, बदबूदार स्राव, तेज़ सिरदर्द या साँस फूलने पर तुरंत आएँ |
| `pnc_adv_contra` (advice) | Talk about family planning | कुटुंब नियोजनाबद्दल चर्चा करा | परिवार नियोजन के बारे में बात करें |

### Baby (newborn)

| Item | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `nb_exam` (visit) | Baby’s first check-up | बाळाची पहिली तपासणी | शिशु की पहली जाँच |
| `nb_check` (visit) | Baby check-up in the first week | पहिल्या आठवड्यात बाळाची तपासणी | पहले हफ़्ते में शिशु की जाँच |
| `nb_lab_screening` (investigation) | Heel-prick blood test for the baby (after 2 days of age) | बाळाच्या टाचेतून रक्त घेऊन तपासणी (2 दिवसांनंतर) | शिशु की एड़ी से ख़ून लेकर जाँच (2 दिन की उम्र के बाद) |
| `nb_cchd` (investigation) | Oxygen check on the baby's hand and foot | बाळाच्या हातावर व पायावर ऑक्सिजनची तपासणी | शिशु के हाथ और पैर पर ऑक्सीजन की जाँच |
| `nb_hearing` (investigation) | Baby's hearing test | बाळाच्या ऐकण्याची तपासणी | शिशु की सुनने की जाँच |
| `nb_vacc_birth` (vaccination) | Vaccines at birth: BCG, polio drops, Hepatitis B | जन्माच्या वेळच्या लसी: बीसीजी (BCG), पोलिओचे थेंब, हिपॅटायटिस बी | जन्म के समय के टीके: बीसीजी (BCG), पोलियो की बूँदें, हेपेटाइटिस बी |
| `nb_vacc_6w` (vaccination) | Vaccines at 6 weeks | 6 आठवड्यांच्या लसी | 6 हफ़्ते पर टीके |
| `nb_vacc_10w` (vaccination) | Vaccines at 10 weeks | 10 आठवड्यांच्या लसी | 10 हफ़्ते पर टीके |
| `nb_vacc_14w` (vaccination) | Vaccines at 14 weeks | 14 आठवड्यांच्या लसी | 14 हफ़्ते पर टीके |
| `nb_vacc_9m` (vaccination) | Vaccines at 9 months (measles–rubella) | 9 महिन्यांच्या लसी (गोवर–रुबेला) | 9 महीने पर टीके (खसरा–रूबेला) |
| `nb_vita_1` (medication) | Vitamin A at 9 months | 9 महिन्यांचे झाल्यावर व्हिटॅमिन ए | 9 महीने पर विटामिन ए |
| `nb_vacc_16m` (vaccination) | Vaccines at 16–24 months | 16–24 महिन्यांच्या लसी | 16–24 महीने पर टीके |
| `nb_vita_2` (medication) | Vitamin A every 6 months till 5 years | 5 वर्षांपर्यंत दर 6 महिन्यांनी व्हिटॅमिन ए | 5 साल तक हर 6 महीने पर विटामिन ए |
| `nb_vacc_5y` (vaccination) | Vaccine at 5–6 years | 5–6 वर्षांची लस | 5–6 साल पर टीका |
| `nb_vacc_10y` (vaccination) | Vaccine at 10 years | 10 वर्षांची लस | 10 साल पर टीका |
| `nb_vacc_16y` (vaccination) | Vaccine at 16 years | 16 वर्षांची लस | 16 साल पर टीका |
| `nb_adv_bf` (advice) | Only breast milk for 6 months, keep the baby warm, keep the cord dry | 6 महिने फक्त आईचे दूध द्या, बाळाला उबदार ठेवा, नाळ कोरडी ठेवा | 6 महीने तक सिर्फ़ माँ का दूध दें, शिशु को गरम रखें, नाल को सूखा रखें |
| `nb_adv_danger` (advice) | Come at once if the baby feeds poorly, breathes fast, is hot or cold, turns yellow or has fits | बाळ नीट दूध पीत नसल्यास, भरभर श्वास घेत असल्यास, अंग गरम किंवा थंड लागल्यास, पिवळे दिसू लागल्यास किंवा झटके आल्यास लगेच या | शिशु ठीक से दूध न पिए, तेज़ साँस ले, शरीर गरम या ठंडा लगे, पीला पड़ने लगे या दौरे आएँ तो तुरंत आएँ |

### Gynaecology

| Item | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `gyn_first` (visit) | First check-up | पहिली तपासणी | पहली जाँच |
| `gyn_hb` (investigation) | Blood test for haemoglobin | हिमोग्लोबिनसाठी रक्त तपासणी | हीमोग्लोबिन के लिए ख़ून की जाँच |
| `gyn_breast` (visit) | Breast examination | स्तनांची तपासणी | स्तनों की जाँच |
| `gyn_cervix` (investigation) | Test for cervical cancer (if due) | गर्भाशयमुखाच्या कर्करोगाची तपासणी (करायची वेळ झाली असल्यास) | बच्चेदानी के मुँह के कैंसर की जाँच (समय हो गया हो तो) |
| `gyn_review` (visit) | Come back with the reports | रिपोर्ट घेऊन पुन्हा या | रिपोर्ट लेकर दोबारा आएँ |
| `gyn_annual` (visit) | Yearly check-up | वार्षिक तपासणी | सालाना जाँच |
| `gyn_cervix_repeat` (investigation) | Repeat cervical cancer test | गर्भाशयमुखाच्या कर्करोगाची तपासणी पुन्हा | बच्चेदानी के मुँह के कैंसर की जाँच दोबारा |

### Fertility (infertility)

| Item | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `inf_first` (visit) | First fertility check-up (please come with your partner) | गर्भधारणेसाठी पहिली तपासणी (कृपया जोडीदारासोबत या) | गर्भधारण के लिए पहली जाँच (कृपया अपने साथी के साथ आएँ) |
| `inf_folic` (medication) | Folic acid tablet every day | रोज फॉलिक ॲसिडची गोळी | रोज़ फ़ोलिक एसिड की गोली |
| `inf_hormones` (investigation) | Blood tests on day 2–3 of the period | पाळीच्या 2 ऱ्या–3 ऱ्या दिवशी रक्ताच्या तपासण्या | माहवारी के 2रे–3रे दिन ख़ून की जाँचें |
| `inf_tvs` (scan) | Scan early in the cycle | पाळीच्या सुरुवातीच्या दिवसांत सोनोग्राफी | माहवारी चक्र की शुरुआत में सोनोग्राफ़ी |
| `inf_semen` (investigation) | Semen test for your partner | तुमच्या जोडीदाराची वीर्य तपासणी | आपके साथी के वीर्य की जाँच |
| `inf_infections` (investigation) | Blood tests for both partners | दोघांच्याही रक्ताच्या तपासण्या | दोनों साथियों की ख़ून की जाँचें |
| `inf_tubal` (investigation) | Test to check the tubes | नलिका (ट्यूब) तपासण्याची चाचणी | नलियों (ट्यूब) की जाँच |
| `inf_review` (visit) | Come back with all the reports | सर्व रिपोर्ट घेऊन पुन्हा या | सारी रिपोर्ट लेकर दोबारा आएँ |
| `inf_review_3m` (visit) | Check-up after 3 months | 3 महिन्यांनी तपासणी | 3 महीने बाद जाँच |
| `inf_adv` (advice) | Healthy weight, no smoking or alcohol; your doctor explains the fertile days | वजन योग्य ठेवा, धूम्रपान व मद्यपान करू नका; गर्भधारणेसाठी योग्य दिवस तुमचे डॉक्टर समजावून सांगतील | वज़न सही रखें, धूम्रपान और शराब न लें; गर्भधारण के सही दिन आपके डॉक्टर समझाएँगे |

## 2. The patient copy of the care plan

File: `client/src/pages/patients/carePlanPrintFormat.js` (Care plan tab → Print → Patient copy → Preview → Language for the patient). Each line prints under its English, or after it with " / " for labels. The dates (`20 Oct 2026`) stay as they are.

### Labels and types of item

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `name` | Name | नाव | नाम |
| `age` | Age | वय | आयु |
| `patientNo` | Patient no. | रुग्ण क्रमांक | रोगी क्रमांक |
| `edd` | Due date (EDD) | प्रसूतीची अंदाजे तारीख (EDD) | प्रसव की अनुमानित तारीख़ (EDD) |
| `weeksToday` | Weeks of pregnancy today | आज गरोदरपणाचे आठवडे | आज गर्भावस्था के हफ़्ते |
| `doctor` | Doctor | डॉक्टर | डॉक्टर |
| `planned` | What is planned | पुढे काय करायचे आहे | आगे क्या करना है |
| `when` | When | केव्हा | कब |
| `what` | What | काय | क्या |
| `alreadyDone` | Already done | आधीच झालेले | जो हो चुका है |
| `done` | Done | झाले | हुआ |
| `advice` | Advice | सल्ला | सलाह |
| `fromDoctor` | From your doctor | तुमच्या डॉक्टरांचा सल्ला | आपके डॉक्टर की सलाह |
| type: `visit` | Check-up | तपासणी | जाँच |
| type: `scan` | Ultrasound (sonography) | सोनोग्राफी | सोनोग्राफ़ी |
| type: `investigation` | Test | चाचणी | टेस्ट |
| type: `vaccination` | Injection | इंजेक्शन | इंजेक्शन |
| type: `medication` | Medicine | औषध | दवा |
| type: `advice` | Advice | सल्ला | सलाह |
| day the plan counts from: `delivery` | Delivered | प्रसूतीची तारीख | प्रसव की तारीख़ |
| day the plan counts from: `birth` | Born | जन्मतारीख | जन्म की तारीख़ |
| day the plan counts from: `start` | Started | सुरू झाल्याची तारीख | शुरू होने की तारीख़ |
| day the plan counts from: `loss` (pregnancy-loss care: the day she was seen – never names the loss) | Seen | तपासणीची तारीख | जाँच की तारीख़ |

### Titles

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| title, antenatal | Pregnancy care plan | गरोदरपणातील काळजीची योजना | गर्भावस्था की देखभाल योजना |
| title, postnatal | Care plan after delivery | प्रसूतीनंतरच्या काळजीची योजना | प्रसव के बाद की देखभाल योजना |
| title, newborn | Baby’s care and vaccination plan | बाळाची काळजी व लसीकरणाची योजना | शिशु की देखभाल और टीकाकरण योजना |
| title, gynaecology | Care plan | काळजीची योजना | देखभाल योजना |
| title, infertility | Fertility care plan | गर्भधारणेसाठी काळजीची योजना | गर्भधारण के लिए देखभाल योजना |
| title, abortion (pregnancy-loss care – never names the loss) | Follow-up care plan | पुढील काळजीची योजना | आगे की देखभाल की योजना |
| title, any other type of care | Care plan | काळजीची योजना | देखभाल योजना |
| title, visits only | Visit schedule | तपासण्यांचे वेळापत्रक | जाँचों की समय-सारिणी |
| title, scans only | Sonography (scan) schedule | सोनोग्राफीचे वेळापत्रक | सोनोग्राफ़ी की समय-सारिणी |
| title, visits and scans | Visit and scan schedule | तपासणी व सोनोग्राफीचे वेळापत्रक | जाँच और सोनोग्राफ़ी की समय-सारिणी |
| title, some types | Pregnancy care plan: lab tests, vaccinations and medicines | गरोदरपणातील काळजीची योजना: प्रयोगशाळेतील चाचण्या, लसीकरण व औषधे | गर्भावस्था की देखभाल योजना: लैब टेस्ट, टीकाकरण और दवाइयाँ |
| title, some types | Pregnancy care plan: check-ups, scans and advice | गरोदरपणातील काळजीची योजना: तपासण्या, सोनोग्राफी व सल्ला | गर्भावस्था की देखभाल योजना: जाँचें, सोनोग्राफ़ी और सलाह |
| title, chosen items | Pregnancy care plan – selected items | गरोदरपणातील काळजीची योजना – निवडक बाबी | गर्भावस्था की देखभाल योजना – चुनी हुई बातें |

### When, done, next check-up

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| weeks of an item (range) | 20–22 weeks | 20–22 आठवडे | 20–22 हफ़्ते |
| weeks of an item (one week) | 36 weeks | 36 आठवडे | 36 हफ़्ते |
| overdue item | As soon as possible | लवकरात लवकर | जल्द से जल्द |
| overdue item, second line | was due by 20 Sep 2026 | 20 Sep 2026 पर्यंत करायचे होते | 20 Sep 2026 तक होना था |
| timed after another item | From about 30 Oct 2026 | सुमारे 30 Oct 2026 पासून | लगभग 30 Oct 2026 से |
| timed after another item, no estimate | Your doctor will tell you the date | तारीख तुमचे डॉक्टर सांगतील | तारीख़ आपके डॉक्टर बताएँगे |
| done: visit | Attended 17 Sep 2026 | 17 Sep 2026 रोजी झाली | 17 Sep 2026 को हुई |
| done: investigation | Done 17 Sep 2026 | 17 Sep 2026 रोजी झाली | 17 Sep 2026 को हुआ |
| done: scan | Done 17 Sep 2026 | 17 Sep 2026 रोजी झाली | 17 Sep 2026 को हुई |
| done: vaccination | Given 17 Sep 2026 | 17 Sep 2026 रोजी दिले | 17 Sep 2026 को दिया गया |
| done: medication | Started 17 Sep 2026 | 17 Sep 2026 पासून सुरू | 17 Sep 2026 से शुरू |
| done: advice | Given 17 Sep 2026 | 17 Sep 2026 रोजी दिला | 17 Sep 2026 को दी गई |
| done: any other type | Done 17 Sep 2026 | 17 Sep 2026 रोजी झाले | 17 Sep 2026 को हुआ |
| done elsewhere | Done 17 Sep 2026 (elsewhere) | 17 Sep 2026 रोजी झाली (इतर ठिकाणी) | 17 Sep 2026 को हुई (कहीं और) |
| next check-up | Your next check-up: 12–26 Oct 2026. | तुमची पुढील तपासणी: 12–26 Oct 2026. | आपकी अगली जाँच: 12–26 Oct 2026। |
| next check-up, overdue | Your next check-up is due now – please come as soon as possible. | तुमची पुढील तपासणी आता करायची आहे – कृपया लवकरात लवकर या. | आपकी अगली जाँच अभी होनी है – कृपया जल्द से जल्द आएँ। |
| weeks of pregnancy today | 24 weeks 3 days | 24 आठवडे 3 दिवस | 24 हफ़्ते 3 दिन |
| Draft band (after the English band) | Draft – not approved for clinical use | मसुदा – डॉक्टरांनी अजून मंजूर केलेले नाही. | ड्राफ़्ट – डॉक्टर ने अभी मंज़ूरी नहीं दी है। |

### The note at the end of the copy

For a pregnancy the English is the note every patient copy has printed so far, unchanged.

**The English for the other types of care is new and needs the doctor's approval.** Until now every patient copy – a baby's, a gynaecology patient's and a pregnancy-loss patient's too – ended with the pregnancy note ("worked out from your due date … reduced movements of the baby"). Now the first sentence names the day the dates are worked out from, and the last sentence is:

- after a delivery and for a baby: the patient words of the plan's own danger-sign advice item (`pnc_adv_danger`, `nb_adv_danger` – see their rows above), as the doctor's template has them. Nothing is kept here: when a doctor changes that item in the template, the note follows. In Marathi or Hindi it is that item's line above while its English is still the built-in one; otherwise the Marathi or Hindi ends with the general line below;
- for any other care (gynaecology, fertility, pregnancy loss), or a plan without that item: the general line below – the same as the patient portal's (its row `emergency`).

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| antenatal | The dates are a guide worked out from your due date; your doctor may change them. Bring this sheet to every visit. Come to the hospital at once for bleeding, severe headache, blurred vision, fits, fever, leaking of water or reduced movements of the baby. | या तारखा तुमच्या प्रसूतीच्या अंदाजे तारखेवरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. रक्तस्राव, तीव्र डोकेदुखी, धूसर दिसणे, झटके, ताप, पाणी जाणे किंवा बाळाची हालचाल कमी झाल्यास लगेच रुग्णालयात या. | ये तारीख़ें आपकी प्रसव की अनुमानित तारीख़ से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ। ख़ून आना, तेज़ सिरदर्द, धुंधला दिखना, दौरे, बुख़ार, पानी जाना या शिशु की हलचल कम होने पर तुरंत अस्पताल आएँ। |
| postnatal (then the danger signs) | The dates are a guide worked out from the day of delivery; your doctor may change them. Bring this sheet to every visit. | या तारखा प्रसूतीच्या दिवसावरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. | ये तारीख़ें प्रसव के दिन से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ। |
| newborn (then the danger signs) | The dates are a guide worked out from the baby’s date of birth; your doctor may change them. Bring this sheet to every visit. | या तारखा बाळाच्या जन्मतारखेवरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. | ये तारीख़ें शिशु की जन्म की तारीख़ से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ। |
| gynaecology, fertility and any other care (then the general line) | The dates are a guide worked out from the day this plan started; your doctor may change them. Bring this sheet to every visit. | या तारखा ही योजना सुरू झाल्याच्या दिवसावरून काढलेल्या आहेत; तुमचे डॉक्टर त्या बदलू शकतात. प्रत्येक तपासणीला हा कागद घेऊन या. | ये तारीख़ें इस योजना के शुरू होने के दिन से निकाली गई हैं; आपके डॉक्टर इन्हें बदल सकते हैं। हर जाँच पर यह काग़ज़ साथ लाएँ। |
| the general line | In an emergency, go to the hospital straight away. | आणीबाणीच्या वेळी लगेच रुग्णालयात जा. | आपात स्थिति में तुरंत अस्पताल जाएँ। |

### Her age (care-plan copy and discharge card)

File: `client/src/components/print/printLanguage.js`.

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| a woman | 28 yrs | 28 वर्षे | 28 वर्ष |
| a baby born today | Born today | आज जन्म | आज जन्म |
| a baby, 1 day | 1 day old | 1 दिवसाचे | 1 दिन का |
| a baby, 12 days | 12 days old | 12 दिवसांचे | 12 दिन का |
| a baby, 60 days (in months from then) | 1 month old | 1 महिन्याचे | 1 महीने का |
| a baby, 2 months | 2 months old | 2 महिन्यांचे | 2 महीने का |
| a baby, 4 months | 4 months old | 4 महिन्यांचे | 4 महीने का |
| the language choice | English | मराठी | हिंदी |

## 3. The discharge card

File: `client/src/pages/inpatient/dischargeWords.js` (a stay → Discharge card → Print → Language for the patient). A medicine’s dose, how often, before or after food and how long are printed with the prescriptions’ Marathi and Hindi words, which are listed in `docs/PRESCRIPTIONS.md` and are not repeated here. What the doctor wrote prints as typed.

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `title` | Discharge card | डिस्चार्ज कार्ड (रुग्णालयातून सुट्टी) | डिस्चार्ज कार्ड (अस्पताल से छुट्टी) |
| `patient` | Patient | रुग्ण | रोगी |
| `age` | Age | वय | आयु |
| `patientNo` | Patient no. | रुग्ण क्रमांक | रोगी क्रमांक |
| `admitted` | Admitted | दाखल झाल्याची वेळ | भर्ती का समय |
| `discharged` | Discharged | सुट्टीची वेळ | छुट्टी का समय |
| `wardBed` | Ward / bed | वॉर्ड व खाट | वार्ड और बिस्तर |
| `bed` | Bed | खाट | बिस्तर |
| `corrections` | Corrections and additions | दुरुस्त्या व भर | सुधार और जोड़ |
| `notSigned` | Not signed yet. | अजून सही झालेली नाही. | अभी हस्ताक्षर नहीं हुए हैं। |
| `draft` | DRAFT – not confirmed by a doctor yet. | मसुदा – डॉक्टरांनी अजून निश्चित केलेले नाही. | ड्राफ़्ट – डॉक्टर ने अभी पुष्टि नहीं की है। |
| part: `dischargedAt` | Date and time of discharge | सुट्टीची तारीख व वेळ | छुट्टी की तारीख़ और समय |
| part: `finalDiagnosis` | Final diagnosis | अंतिम निदान | अंतिम निदान |
| part: `procedures` | Procedures and operations | केलेल्या प्रक्रिया व ऑपरेशन | की गई प्रक्रियाएँ और ऑपरेशन |
| part: `course` | Course in hospital | रुग्णालयात असताना झालेले उपचार | अस्पताल में रहते हुए हुआ इलाज |
| part: `conditionAtDischarge` | Condition at discharge | सुट्टीच्या वेळची प्रकृती | छुट्टी के समय की हालत |
| part: `medicines` | Medicines on discharge | घरी घ्यायची औषधे | घर पर लेने की दवाइयाँ |
| part: `advice` | Advice | सल्ला | सलाह |
| part: `followUpOn` | Follow-up date | पुन्हा तपासणीची तारीख | दोबारा जाँच की तारीख़ |
| part: `followUpNote` | Follow-up note | पुन्हा तपासणीबद्दल सूचना | दोबारा जाँच के बारे में निर्देश |

## 4. The patient portal

File: `client/src/pages/portal/portalWords.js` (the address /portal; the switch English · मराठी · हिंदी at the top). `{hospital}`, `{doctor}` and `{day and time}` are filled in by the app. "Draft note" shows at the top of the portal in Marathi and Hindi until the wording is checked (it can then be removed).

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `pageTitle` | Your care · Perinexa | तुमची काळजी · Perinexa | आपकी देखभाल · Perinexa |
| `language` | Language | भाषा | भाषा |
| `draftNote` (top of the portal) | (none – shown only in Marathi and Hindi) | मराठी शब्द अजून तपासले जात आहेत. काही समजले नाही तर English निवडा किंवा रुग्णालयाला फोन करा. | हिंदी शब्द अभी जाँचे जा रहे हैं। कुछ समझ न आए तो English चुनें या अस्पताल को फ़ोन करें। |
| `loading` | Loading… | उघडत आहे… | खुल रहा है… |
| `dismiss` | Dismiss message | संदेश बंद करा | संदेश बंद करें |
| `signInTitle` | Your care at the hospital | रुग्णालयातील तुमची काळजी | अस्पताल में आपकी देखभाल |
| `signInIntro` | Sign in with the code on the paper the hospital gave you. | रुग्णालयाने दिलेल्या कागदावरील कोड वापरून आत या. | अस्पताल ने जो काग़ज़ दिया है, उस पर लिखे कोड से अंदर आएँ। |
| `code` | Code | कोड | कोड |
| `codeHint` | e.g. ABCD-EFGH-JKLM | उदा. ABCD-EFGH-JKLM | जैसे ABCD-EFGH-JKLM |
| `digits` | Last 4 digits of your mobile number | तुमच्या मोबाइल नंबरचे शेवटचे 4 अंक | आपके मोबाइल नंबर के आख़िरी 4 अंक |
| `signingIn` | Signing in… | आत येत आहे… | अंदर आ रहे हैं… |
| `signIn` | Sign in | आत या | अंदर आएँ |
| `sharedDevice` | On a shared phone or computer, sign out when you finish. | इतरांसोबत वापरल्या जाणाऱ्या फोनवर किंवा संगणकावर, काम झाल्यावर बाहेर पडा. | साझा फ़ोन या कंप्यूटर पर, काम पूरा होने पर बाहर निकलें। |
| `timedOut` | You were signed out after 15 minutes without use. | 15 मिनिटे वापर न झाल्याने तुम्ही बाहेर पडलात. | 15 मिनट तक इस्तेमाल न होने के कारण आपको बाहर कर दिया गया। |
| `signedOut` | You are signed out. | तुम्ही बाहेर पडला आहात. | आप बाहर निकल चुके हैं। |
| `signOut` | Sign out | बाहेर पडा | बाहर निकलें |
| `nextAppointment` | Your next appointment | तुमची पुढील भेट | आपकी अगली मुलाक़ात |
| `noAppointment` | No appointment is booked. | कोणतीही भेट ठरलेली नाही. | कोई मुलाक़ात तय नहीं है। |
| `callToBook` | Please call the hospital to book one. | भेट ठरवण्यासाठी कृपया रुग्णालयाला फोन करा. | मुलाक़ात तय करने के लिए कृपया अस्पताल को फ़ोन करें। |
| `comingUp` | Coming up in your care plan | तुमच्या काळजीच्या योजनेत पुढे | आपकी देखभाल योजना में आगे |
| `checkUp` | Check-up | तपासणी | जाँच |
| `nothingElse` | Nothing else is due in the next 8 weeks. | पुढील 8 आठवड्यांत दुसरे काही करायचे नाही. | अगले 8 हफ़्तों में और कुछ नहीं करना है। |
| `doctorDecides` | Your doctor decides what is needed; dates may change at your next visit. | काय आवश्यक आहे ते तुमचे डॉक्टर ठरवतात; पुढील भेटीत तारखा बदलू शकतात. | क्या ज़रूरी है, यह आपके डॉक्टर तय करते हैं; अगली मुलाक़ात पर तारीख़ें बदल सकती हैं। |
| `questions` | Questions, or need to change the date? | काही प्रश्न आहेत, किंवा तारीख बदलायची आहे? | कोई सवाल है, या तारीख़ बदलनी है? |
| `call` | Call {hospital} | {hospital} ला फोन करा | {hospital} को फ़ोन करें |
| `callJoin` (before the hospital’s phone number) | "on" | ":" | ":" |
| `stop` (end of the sentence) | "." | "." | "।" |
| `emergency` | In an emergency, go to the hospital straight away. | आणीबाणीच्या वेळी लगेच रुग्णालयात जा. | आपात स्थिति में तुरंत अस्पताल जाएँ। |
| `item` | Item | बाब | बात |
| `cancelling` | Cancelling… | रद्द करत आहे… | रद्द हो रहा है… |
| `yesCancel` | Yes, cancel my appointment | हो, माझी भेट रद्द करा | हाँ, मेरी मुलाक़ात रद्द करें |
| `keepIt` | Keep it | भेट ठेवा | मुलाक़ात रखें |
| `cancelAppointment` | Cancel this appointment | ही भेट रद्द करा | यह मुलाक़ात रद्द करें |
| `callToBookOnline` | To book an appointment, please call the hospital. | भेट ठरवण्यासाठी कृपया रुग्णालयाला फोन करा. | मुलाक़ात तय करने के लिए कृपया अस्पताल को फ़ोन करें। |
| `bookWith` | Book an appointment with {doctor} | {doctor} यांची भेट ठरवा | {doctor} से मुलाक़ात तय करें |
| `chooseDoctor` (added 16 Oct 2026) | Doctor | डॉक्टर | डॉक्टर |
| `onlyFree` (added 16 Oct 2026) | Only free times are shown. | फक्त उपलब्ध वेळा दाखवल्या आहेत. | केवल ख़ाली समय दिखाए गए हैं। |
| `day` | Day | दिवस | दिन |
| `noFreeTime` | No free time on this day. Please choose another day. | या दिवशी वेळ उपलब्ध नाही. कृपया दुसरा दिवस निवडा. | इस दिन कोई समय ख़ाली नहीं है। कृपया कोई और दिन चुनें। |
| `doctorOnLeave` (added 15 Oct 2026) | {doctor} is on leave: {dates}. No bookings on these days. | {doctor} रजेवर आहेत: {dates}. या दिवसांत भेट ठरवता येणार नाही. | {doctor} छुट्टी पर हैं: {dates}। इन दिनों मुलाक़ात तय नहीं हो सकती। |
| `onLeaveDay` (added 15 Oct 2026) | {doctor} is on leave on this day. Please choose another day. | {doctor} या दिवशी रजेवर आहेत. कृपया दुसरा दिवस निवडा. | {doctor} इस दिन छुट्टी पर हैं। कृपया कोई और दिन चुनें। |
| `time` | Time | वेळ | समय |
| `booking` | Booking… | भेट ठरवत आहे… | मुलाक़ात तय हो रही है… |
| `bookAt` | Book {day and time} | {day and time} ही भेट ठरवा | {day and time} की मुलाक़ात तय करें |
| `book` | Book | भेट ठरवा | मुलाक़ात तय करें |
| type: `investigation` | Test | चाचणी | टेस्ट |
| type: `scan` | Scan | सोनोग्राफी | सोनोग्राफ़ी |
| type: `vaccination` | Vaccination | लसीकरण | टीकाकरण |
| type: `visit` | Check-up | तपासणी | जाँच |

### Messages when something is refused or fails

In English the server’s own sentence is shown (as before); in Marathi and Hindi the sentence below.

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `NETWORK` | Can't reach the hospital's server. Please try again later. | रुग्णालयाच्या सर्व्हरशी संपर्क होत नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा. | अस्पताल के सर्वर से संपर्क नहीं हो पा रहा है। कृपया थोड़ी देर बाद फिर से कोशिश करें। |
| `PORTAL_LOGIN_FAILED` | The code or the 4 digits are not right. Check the paper the hospital gave you, or call the hospital. | कोड किंवा 4 अंक बरोबर नाहीत. रुग्णालयाने दिलेला कागद तपासा, किंवा रुग्णालयाला फोन करा. | कोड या 4 अंक सही नहीं हैं। अस्पताल का दिया काग़ज़ देखें, या अस्पताल को फ़ोन करें। |
| `PORTAL_LOCKED` | Too many wrong tries. Please wait 2 minutes, then try again. | चुकीच्या प्रयत्नांमुळे हा कोड 2 मिनिटांसाठी बंद झाला आहे. कृपया थांबा, मग पुन्हा प्रयत्न करा. | ग़लत कोशिशों के कारण यह कोड 2 मिनट के लिए बंद है। कृपया रुकें, फिर से कोशिश करें। |
| `RATE_LIMITED` | Too many tries. Please wait 15 minutes, or call the hospital. | खूप जास्त प्रयत्न झाले. कृपया 15 मिनिटे थांबा, किंवा रुग्णालयाला फोन करा. | बहुत ज़्यादा कोशिशें हो गईं। कृपया 15 मिनट रुकें, या अस्पताल को फ़ोन करें। |
| `PORTAL_SIGNED_OUT` | Please sign in again. | कृपया पुन्हा आत या. | कृपया फिर से अंदर आएँ। |
| `SLOT_TAKEN` | That time has just been taken. Please choose another time. | ही वेळ आत्ताच दुसऱ्या कोणी घेतली. कृपया दुसरी वेळ निवडा. | यह समय अभी-अभी किसी और ने ले लिया। कृपया कोई और समय चुनें। |
| `BOOKING_OFF` | Online booking is not available. Please call the hospital. | ऑनलाइन भेट ठरवता येत नाही. कृपया रुग्णालयाला फोन करा. | ऑनलाइन मुलाक़ात तय नहीं हो सकती। कृपया अस्पताल को फ़ोन करें। |
| `ALREADY_BOOKED` | You already have an appointment. To change it, call the hospital. | तुमची भेट आधीच ठरलेली आहे. ती बदलण्यासाठी रुग्णालयाला फोन करा. | आपकी मुलाक़ात पहले से तय है। उसे बदलने के लिए अस्पताल को फ़ोन करें। |
| `NOT_CANCELLABLE` | This appointment cannot be cancelled here. Please call the hospital. | ही भेट इथे रद्द करता येत नाही. कृपया रुग्णालयाला फोन करा. | यह मुलाक़ात यहाँ रद्द नहीं हो सकती। कृपया अस्पताल को फ़ोन करें। |
| `BOOKING_DAYS` | Please choose a day from tomorrow up to 30 days ahead. | कृपया उद्यापासून पुढील 30 दिवसांतील एखादा दिवस निवडा. | कृपया कल से अगले 30 दिनों में से कोई दिन चुनें। |
| `OTHER` | (any other refusal) Something went wrong. Please try again. | काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा, किंवा रुग्णालयाला फोन करा. | कुछ ग़लत हो गया। कृपया फिर से कोशिश करें, या अस्पताल को फ़ोन करें। |

### The paper with her portal code

File: `client/src/pages/portal/portalWords.js` (`PORTAL_SLIP_WORDS`; Patient → More → Reminders and portal → Make her code → Print it for her → Language for the patient).

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `title` | Your care at {hospital} – online | {hospital} मधील तुमची काळजी – ऑनलाइन | {hospital} में आपकी देखभाल – ऑनलाइन |
| `title` (name of the hospital not set) | Your care at the hospital – online | रुग्णालयातील तुमची काळजी – ऑनलाइन | अस्पताल में आपकी देखभाल – ऑनलाइन |
| `forWhom` | For | नाव | नाम |
| `open` | Open {address} and sign in with: | {address} हा पत्ता उघडा आणि हे वापरून आत या: | {address} खोलें और इससे अंदर आएँ: |
| `digits` | and the last 4 digits of your mobile number. You will see your next appointment and what is due in your care plan. | आणि तुमच्या मोबाइल नंबरचे शेवटचे 4 अंक. तुम्हाला तुमची पुढील भेट आणि तुमच्या काळजीच्या योजनेत पुढे काय करायचे आहे ते दिसेल. | और आपके मोबाइल नंबर के आख़िरी 4 अंक। आपको अपनी अगली मुलाक़ात और अपनी देखभाल योजना में आगे क्या करना है, यह दिखेगा। |
| `keep` | Keep this paper safe. The code works for 90 days. If you lose it, ask the hospital for a new one – the old one then stops working. | हा कागद सांभाळून ठेवा. हा कोड 90 दिवस चालतो. कागद हरवल्यास रुग्णालयाकडून नवीन कोड घ्या – मग जुना कोड बंद होतो. | यह काग़ज़ सँभालकर रखें। यह कोड 90 दिन तक चलता है। काग़ज़ खो जाए तो अस्पताल से नया कोड लें – तब पुराना कोड बंद हो जाता है। |

## 5. The patient portal: her own account and her records (added 16 Oct 2026)

File: `client/src/pages/portal/portalAccountWords.js` – signing up, signing in with mobile number + OTP or email +
password (on the sign-in page, Patient, and on the hospital's portal address), changing her password, and the tabs
Prescriptions, Lab reports, Visits and Bills (docs/PATIENT_ACCOUNTS_PLAN.md). Written by the software developer (an AI
assistant) on 16 October 2026; **not checked yet**. The English is also a draft for the owner to read on screen. `{…}`
parts are filled in by the app. Words such as OTP, SMS and UPI stay as they are.

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `hospitalTitle` | Your care at {hospital} | {hospital} मधील तुमची काळजी | {hospital} में आपकी देखभाल |
| `signInTab` | Sign in | आत या | अंदर आएँ |
| `signUpTab` | Sign up | नोंदणी करा | पंजीकरण करें |
| `withOtp` | Mobile number + OTP | मोबाइल नंबर + OTP | मोबाइल नंबर + OTP |
| `withPassword` | Email + password | ईमेल + पासवर्ड | ईमेल + पासवर्ड |
| `mobile` | Mobile number | मोबाइल नंबर | मोबाइल नंबर |
| `mobileHint` | The number you signed up with | नोंदणी करताना दिलेला नंबर | पंजीकरण के समय दिया गया नंबर |
| `email` | Email | ईमेल | ईमेल |
| `password` | Password | पासवर्ड | पासवर्ड |
| `passwordHint` | At least 8 characters, with a letter and a number | किमान 8 अक्षरे, त्यात एक अक्षर आणि एक अंक | कम से कम 8 अक्षर, जिसमें एक अक्षर और एक अंक हो |
| `forgotPassword` | Forgot your password? Sign in with your mobile number and an OTP, then set a new one on your page. | पासवर्ड विसरलात? मोबाइल नंबर आणि OTP ने आत या, मग तुमच्या पानावर नवीन पासवर्ड ठेवा. | पासवर्ड भूल गए? मोबाइल नंबर और OTP से अंदर आएँ, फिर अपने पेज पर नया पासवर्ड रखें। |
| `sendOtp` | Send OTP | OTP पाठवा | OTP भेजें |
| `sendingOtp` | Sending… | पाठवत आहे… | भेज रहे हैं… |
| `otpSentTo` | If {mobile} is registered, an OTP was sent to it. | {mobile} नोंदलेला असल्यास त्यावर OTP पाठवला आहे. | अगर {mobile} पंजीकृत है, तो उस पर OTP भेजा गया है। |
| `otp` | OTP | OTP (एक वेळचा कोड) | OTP (एक बार का कोड) |
| `practiceOtp` | Practice mode (no SMS is sent): the OTP is {OTP}. | सराव मोड (SMS पाठवला जात नाही): OTP आहे {OTP}. | अभ्यास मोड (SMS नहीं भेजा जाता): OTP है {OTP}। |
| `otpOff` | Sign-in with an OTP is not available yet. Please use your email and password. | OTP ने आत येण्याची सोय अजून नाही. कृपया ईमेल आणि पासवर्ड वापरा. | OTP से अंदर आने की सुविधा अभी नहीं है। कृपया ईमेल और पासवर्ड का उपयोग करें। |
| `signIn` | Sign in | आत या | अंदर आएँ |
| `signingIn` | Signing in… | आत येत आहे… | अंदर आ रहे हैं… |
| `startAgain` | Change the number | नंबर बदला | नंबर बदलें |
| `fullName` | Full name | पूर्ण नाव | पूरा नाम |
| `age` | Age (years) | वय (वर्षे) | उम्र (वर्ष) |
| `agree` | I agree that {hospital} keeps these details to register me and to let me sign in. My registration is checked by the hospital before I can see anything. | माझी नोंदणी करण्यासाठी आणि मला आत येऊ देण्यासाठी {hospital} हे तपशील ठेवेल याला माझी संमती आहे. काहीही दिसण्यापूर्वी रुग्णालय माझी नोंदणी तपासेल. | मैं सहमत हूँ कि मेरा पंजीकरण करने और मुझे अंदर आने देने के लिए {hospital} ये विवरण रखे। कुछ भी दिखने से पहले अस्पताल मेरा पंजीकरण जाँचेगा। |
| `signUp` | Sign up | नोंदणी करा | पंजीकरण करें |
| `signingUp` | Signing up… | नोंदणी करत आहे… | पंजीकरण हो रहा है… |
| `signedUp` | Thank you. {hospital} will check your details and approve your registration – the hospital may call you. Once it is approved, sign in here. | धन्यवाद. तुमची नोंदणी {hospital} च्या मंजुरीसाठी थांबली आहे. तुम्ही कोण आहात हे तपासण्यासाठी रुग्णालय तुम्हाला फोन करू शकते. मंजुरी मिळाल्यावर इथे आत या. | धन्यवाद। आपका पंजीकरण {hospital} की मंज़ूरी के लिए रुका है। आप कौन हैं, यह जाँचने के लिए अस्पताल आपको फ़ोन कर सकता है। मंज़ूरी मिलने पर यहाँ अंदर आएँ। |
| `withCode` | I have a code on paper from the hospital | माझ्याकडे रुग्णालयाने दिलेला कोड आहे | मेरे पास अस्पताल का दिया कोड है |
| `changePassword` | Change password | पासवर्ड बदला | पासवर्ड बदलें |
| `newPassword` | New password | नवीन पासवर्ड | नया पासवर्ड |
| `savePassword` | Save the new password | नवीन पासवर्ड जतन करा | नया पासवर्ड सहेजें |
| `saving` | Saving… | जतन करत आहे… | सहेज रहे हैं… |
| `passwordSaved` | Your new password is saved. | तुमचा नवीन पासवर्ड जतन झाला. | आपका नया पासवर्ड सहेज लिया गया। |
| `signInHeading` | Patient sign-in | रुग्ण लॉग-इन | मरीज़ लॉग-इन |
| `signInLead` | {hospital} – your appointments, prescriptions, lab reports and bills. | {hospital} – तुमच्या भेटी, औषधचिठ्ठ्या, तपासणी अहवाल आणि बिले. | {hospital} – आपकी मुलाक़ातें, पर्चे, जाँच रिपोर्ट और बिल। |
| `signUpHeading` | Create your patient account | तुमचे रुग्ण खाते तयार करा | अपना मरीज़ खाता बनाएँ |
| `signUpLead` | For {hospital}. The hospital checks your details before you can sign in. | {hospital} साठी. आत येण्यापूर्वी रुग्णालय तुमचे तपशील तपासेल. | {hospital} के लिए। अंदर आने से पहले अस्पताल आपके विवरण जाँचेगा। |
| `signedUpTitle` | Registration received | नोंदणी मिळाली | पंजीकरण मिल गया |
| `backToSignIn` | Back to sign in | आत येण्याच्या पानावर परत | अंदर आने के पेज पर वापस |
| `address` | Address | पत्ता | पता |
| `comingFor` | What are you coming for? | तुम्ही कशासाठी येत आहात? | आप किसलिए आ रही हैं? |
| `choose` | Choose… | निवडा… | चुनें… |
| `careTypes.antenatal` | Pregnancy care | गर्भारपणाची काळजी | गर्भावस्था की देखभाल |
| `careTypes.postnatal` | Care after delivery | प्रसूतीनंतरची काळजी | प्रसव के बाद की देखभाल |
| `careTypes.gynaecology` | Women's health (gynaecology) | स्त्रियांचे आरोग्य (स्त्रीरोग) | महिला स्वास्थ्य (स्त्री रोग) |
| `careTypes.infertility` | Trying to get pregnant | गर्भधारणेसाठी प्रयत्न | गर्भधारण की कोशिश |
| `lmp` | First day of your last period | शेवटच्या पाळीचा पहिला दिवस | आख़िरी माहवारी का पहला दिन |
| `lmpHint` | Your best guess is fine – the doctor confirms it at your visit. | अंदाजे तारीख चालेल – भेटीत डॉक्टर ती निश्चित करतील. | अंदाज़ी तारीख़ चलेगी – मुलाक़ात पर डॉक्टर इसे पक्का करेंगे। |
| `emailOptional` | Email (optional) | ईमेल (ऐच्छिक) | ईमेल (वैकल्पिक) |
| `emailOptionalHint` | Add one to also sign in with a password. | दिल्यास पासवर्डनेही आत येता येईल. | देने पर पासवर्ड से भी अंदर आ सकते हैं। |
| `tabs.home` | Home | मुख्य | मुख्य |
| `tabs.appointments` | Appointments | अपॉइंटमेंट | अपॉइंटमेंट |
| `tabs.prescriptions` | Prescriptions | औषधचिठ्ठ्या | पर्चे |
| `tabs.lab` | Lab reports | तपासणी अहवाल | जाँच रिपोर्ट |
| `tabs.visits` | Visits | भेटी | मुलाक़ातें |
| `tabs.bills` | Bills | बिले | बिल |
| `tabs.password` | Change password | पासवर्ड बदला | पासवर्ड बदलें |
| `menu` | Menu | मेनू | मेनू |
| `patientRole` | Patient | रुग्ण | मरीज़ |
| `yourHospital` | Your hospital | तुमचे रुग्णालय | आपका अस्पताल |
| `welcome` | Welcome, {name} | नमस्कार, {name} | नमस्ते, {name} |
| `recordsRule` | You see a record here once it is final: visits signed by your doctor, and lab reports your doctor has reviewed. For anything else, please ask the hospital. | नोंद पूर्ण झाल्यावरच इथे दिसते: डॉक्टरांनी सही केलेल्या भेटी, आणि डॉक्टरांनी पाहिलेले तपासणी अहवाल. इतर काहीही हवे असल्यास रुग्णालयाला विचारा. | कोई रिकॉर्ड पूरा होने के बाद ही यहाँ दिखता है: डॉक्टर के हस्ताक्षर वाली मुलाक़ातें, और डॉक्टर द्वारा देखी गई जाँच रिपोर्ट। और कुछ चाहिए तो अस्पताल से पूछें। |
| `noPrescriptions` | No prescriptions to show yet. | अजून दाखवण्यासाठी औषधचिठ्ठी नाही. | अभी दिखाने के लिए कोई पर्चा नहीं है। |
| `noLab` | No lab reports to show yet. | अजून दाखवण्यासाठी तपासणी अहवाल नाही. | अभी दिखाने के लिए कोई जाँच रिपोर्ट नहीं है। |
| `noVisits` | No visits to show yet. | अजून दाखवण्यासाठी भेट नाही. | अभी दिखाने के लिए कोई मुलाक़ात नहीं है। |
| `noBills` | No bills to show. | दाखवण्यासाठी बिल नाही. | दिखाने के लिए कोई बिल नहीं है। |
| `viewPrint` | View, print or save | पहा, छापा किंवा जतन करा | देखें, छापें या सहेजें |
| `medicines` | {n} medicines | {n} औषधे | {n} दवाइयाँ |
| `complaints` | Complaints | तक्रारी | शिकायतें |
| `diagnosis` | Diagnosis | निदान | निदान |
| `advice` | Advice | सल्ला | सलाह |
| `testsAdvised` | Tests advised | सांगितलेल्या तपासण्या | बताई गई जाँचें |
| `nextVisit` | Next visit | पुढील भेट | अगली मुलाक़ात |
| `result` | Result | निकाल | नतीजा |
| `normalRange` | Normal range | सामान्य मर्यादा | सामान्य सीमा |
| `labRemark` | Remark from the lab | प्रयोगशाळेची टीप | लैब की टिप्पणी |
| `reported` | Reported {date and time} | अहवाल {date and time} | रिपोर्ट {date and time} |
| `flags.low` | Low | कमी | कम |
| `flags.high` | High | जास्त | ज़्यादा |
| `flags.abnormal` | Abnormal | असामान्य | असामान्य |
| `flags.normal` | Normal | सामान्य | सामान्य |
| `bill` | Bill {number} | बिल {number} | बिल {number} |
| `total` | Total | एकूण | कुल |
| `paid` | Paid | भरलेले | चुकाया |
| `toPay` | To pay | भरायचे | चुकाना है |
| `refundDue` | To be refunded to you | तुम्हाला परत द्यायचे | आपको वापस मिलेगा |
| `discount` | Discount | सवलत | छूट |
| `receipts` | Receipts | पावत्या | रसीदें |
| `payKinds.payment` | Payment | भरणा | भुगतान |
| `payKinds.deposit` | Deposit | अनामत | जमा राशि |
| `payKinds.refund` | Refund | परतावा | वापसी |
| `payModes.cash` | Cash | रोख | नकद |
| `payModes.upi` | UPI | UPI (ऑनलाइन) | UPI (ऑनलाइन) |
| `payModes.card` | Card | कार्ड | कार्ड |
| `payModes.insurance` | Insurance or scheme | विमा किंवा योजना | बीमा या योजना |
| `billStatus.paid` | Paid | भरले | चुकाया |
| `billStatus.part_paid` | Part paid | काही भरले | कुछ चुकाया |
| `billStatus.unpaid` | Not paid | भरले नाही | नहीं चुकाया |
| `billStatus.refund_due` | Refund due | परतावा बाकी | वापसी बाकी |
| `billStatus.no_charges` | No charges | शुल्क नाही | कोई शुल्क नहीं |
| `printedOnline` | Patient (online) | रुग्ण (ऑनलाइन) | मरीज़ (ऑनलाइन) |
| refusal `PORTAL_LOGIN_FAILED` | (the server's English message) | ईमेल, पासवर्ड किंवा OTP बरोबर नाही. | ईमेल, पासवर्ड या OTP सही नहीं है। |
| refusal `PORTAL_LOCKED` | (the server's English message) | चुकीच्या प्रयत्नांमुळे हे खाते 2 मिनिटांसाठी बंद आहे. कृपया थांबा, मग पुन्हा प्रयत्न करा. | ग़लत कोशिशों के कारण यह खाता 2 मिनट के लिए बंद है। कृपया रुकें, फिर से कोशिश करें। |
| sign-in countdown (components/LockCountdown.jsx) | Too many wrong tries. Please wait 1:45 – then you can try again. | खूप चुकीचे प्रयत्न झाले. कृपया 1:45 थांबा – मग पुन्हा प्रयत्न करा. | बहुत ग़लत कोशिशें हुईं। कृपया 1:45 रुकें – फिर से कोशिश करें। |
| refusal `ACCOUNT_PENDING` | (the server's English message) | तुमची नोंदणी अजून रुग्णालयाच्या मंजुरीसाठी थांबली आहे. मंजुरी मिळाल्यावर आत येता येईल. | आपका पंजीकरण अभी अस्पताल की मंज़ूरी के लिए रुका है। मंज़ूरी मिलने पर अंदर आ सकेंगे। |
| refusal `ACCOUNT_REJECTED` | (the server's English message) | तुमची नोंदणी मंजूर झाली नाही. कृपया रुग्णालयाला फोन करा. | आपका पंजीकरण मंज़ूर नहीं हुआ। कृपया अस्पताल को फ़ोन करें। |
| refusal `OTP_OFF` | (the server's English message) | OTP ने आत येण्याची सोय अजून नाही. कृपया ईमेल आणि पासवर्ड वापरा. | OTP से अंदर आने की सुविधा अभी नहीं है। कृपया ईमेल और पासवर्ड का उपयोग करें। |
| refusal `VALIDATION` | (the server's English message) | कृपया तुम्ही लिहिलेले तपासा. | कृपया आपने जो लिखा उसे जाँचें। |
| refusal `NOT_FOUND` | (the server's English message) | हे पान उपलब्ध नाही. पत्ता तपासा, किंवा रुग्णालयाला फोन करा. | यह पेज उपलब्ध नहीं है। पता जाँचें, या अस्पताल को फ़ोन करें। |
| `aadhaar.reading` (added 17 Oct 2026) | Reading the QR code… | QR कोड वाचत आहे… | QR कोड पढ़ा जा रहा है… |
| `aadhaar.close` (added 17 Oct 2026) | Close | बंद करा | बंद करें |
| `aadhaar.filled` (added 17 Oct 2026) | Filled from your Aadhaar card: {list}. Please check them. | तुमच्या आधार कार्डवरून भरले: {list}. कृपया तपासा. | आपके आधार कार्ड से भरा गया: {list}। कृपया जाँच लें। |
| `aadhaar.noQr` (added 17 Oct 2026) | No QR code was found in this picture. Please upload a clearer photo of the side with the QR code, or type your details. | या फोटोत QR कोड सापडला नाही. कृपया QR कोड असलेल्या बाजूचा अधिक स्पष्ट फोटो अपलोड करा, किंवा माहिती टाइप करा. | इस फ़ोटो में QR कोड नहीं मिला। कृपया QR कोड वाली तरफ़ की साफ़ फ़ोटो अपलोड करें, या अपनी जानकारी टाइप करें। |
| `aadhaar.notAadhaar` (added 17 Oct 2026) | This is not an Aadhaar QR code. Please type your details. | हा आधार QR कोड नाही. कृपया तुमची माहिती टाइप करा. | यह आधार QR कोड नहीं है। कृपया अपनी जानकारी टाइप करें। |
| `aadhaar.notImage` (added 17 Oct 2026) | This file could not be opened as a picture. Please upload a photo or a screenshot. | ही फाइल फोटो म्हणून उघडता आली नाही. कृपया फोटो किंवा स्क्रीनशॉट अपलोड करा. | यह फ़ाइल फ़ोटो की तरह नहीं खुल सकी। कृपया फ़ोटो या स्क्रीनशॉट अपलोड करें। |
| `aadhaar.fields` (added 17 Oct 2026) | name, age, address | नाव, वय, पत्ता | नाम, उम्र, पता |
| `tabs.profile` (added 17 Oct 2026) | My details | माझी माहिती | मेरी जानकारी |
| `home.glance` (added 17 Oct 2026) | Your health at a glance | तुमचे आरोग्य एका नजरेत | आपकी सेहत एक नज़र में |
| `home.book` (added 17 Oct 2026) | Book an appointment | भेट ठरवा | मुलाक़ात तय करें |
| `home.viewAppointments` (added 17 Oct 2026) | Your appointments | तुमच्या भेटी | आपकी मुलाक़ातें |
| `home.withDoctor` (added 17 Oct 2026) | With {x} | {x} यांच्याकडे | {x} के साथ |
| `home.noneBooked` (added 17 Oct 2026) | None booked | भेट ठरलेली नाही | कोई मुलाक़ात तय नहीं |
| `home.toPay` (added 17 Oct 2026) | {x} to pay | {x} भरायचे बाकी | {x} चुकाना बाकी |
| `home.allPaid` (added 17 Oct 2026) | Nothing to pay | काही भरायचे बाकी नाही | कुछ चुकाना बाकी नहीं |
| `home.about.appointments` (added 17 Oct 2026) | Book and see your visits | भेट ठरवा आणि तुमच्या भेटी पाहा | मुलाक़ात तय करें और अपनी मुलाक़ातें देखें |
| `home.about.prescriptions` (added 17 Oct 2026) | Medicines prescribed to you | तुम्हाला दिलेली औषधे | आपको दी गई दवाइयाँ |
| `home.about.lab` (added 17 Oct 2026) | Your test results | तुमचे तपासणी निकाल | आपकी जाँच के नतीजे |
| `home.about.bills` (added 17 Oct 2026) | Charges and payments | शुल्क आणि भरणा | शुल्क और भुगतान |
| `home.help` (added 17 Oct 2026) | Need help? | मदत हवी आहे? | मदद चाहिए? |
| `home.callHospital` (added 17 Oct 2026) | Call the hospital | रुग्णालयाला फोन करा | अस्पताल को फ़ोन करें |
| `home.appointmentsTitle` (added 17 Oct 2026) | Your appointments in the last year and to come | गेल्या वर्षातील आणि पुढील तुमच्या भेटी | पिछले साल की और आने वाली आपकी मुलाक़ातें |
| `home.noAppointments` (added 17 Oct 2026) | No appointments in the last year. | गेल्या वर्षात कोणतीही भेट नाही. | पिछले साल कोई मुलाक़ात नहीं। |
| `home.bookedOnline` (added 17 Oct 2026) | booked online | ऑनलाइन ठरवली | ऑनलाइन तय की गई |
| `home.statuses.upcoming` (added 17 Oct 2026) | Upcoming | पुढील | आने वाली |
| `home.statuses.seen` (added 17 Oct 2026) | Seen by the doctor | डॉक्टरांनी पाहिले | डॉक्टर ने देखा |
| `home.statuses.arrived` (added 17 Oct 2026) | Arrived | आल्या | आ गईं |
| `home.statuses.missed` (added 17 Oct 2026) | Missed | आल्या नाहीत | नहीं आईं |
| `home.statuses.cancelled` (added 17 Oct 2026) | Cancelled | रद्द | रद्द |
| `home.billsSummary.total` (added 17 Oct 2026) | Total billed | एकूण बिल | कुल बिल |
| `home.billsSummary.paid` (added 17 Oct 2026) | Paid | भरले | चुकाया |
| `home.billsSummary.due` (added 17 Oct 2026) | Still to pay | भरायचे बाकी | चुकाना बाकी |
| `home.profile.fullName` (added 17 Oct 2026) | Name | नाव | नाम |
| `home.profile.mrn` (added 17 Oct 2026) | Hospital number | रुग्णालय क्रमांक | अस्पताल नंबर |
| `home.profile.age` (added 17 Oct 2026) | Age (years) | वय (वर्षे) | उम्र (साल) |
| `home.profile.phone` (added 17 Oct 2026) | Mobile | मोबाइल | मोबाइल |
| `home.profile.email` (added 17 Oct 2026) | Email | ईमेल | ईमेल |
| `home.profile.address` (added 17 Oct 2026) | Address | पत्ता | पता |
| `home.profile.hospital` (added 17 Oct 2026) | Hospital | रुग्णालय | अस्पताल |
| `home.profileNote` (added 17 Oct 2026) | To change these details, please call or visit the hospital reception. They check who you are first. | ही माहिती बदलण्यासाठी कृपया रुग्णालयाच्या स्वागत कक्षाला फोन करा किंवा भेट द्या. ते आधी तुमची ओळख तपासतात. | यह जानकारी बदलने के लिए कृपया अस्पताल के रिसेप्शन पर फ़ोन करें या जाएँ। वे पहले आपकी पहचान जाँचते हैं। |
| `aadhaar.camera` (added 17 Oct 2026) | Scan with camera | कॅमेऱ्याने स्कॅन करा | कैमरे से स्कैन करें |
| `aadhaar.cameraBlocked` (added 17 Oct 2026) | The camera could not be opened. Allow the camera for this page, or upload a photo of the card. | कॅमेरा उघडता आला नाही. या पानासाठी कॅमेऱ्याला परवानगी द्या, किंवा कार्डचा फोटो अपलोड करा. | कैमरा नहीं खुल सका। इस पेज के लिए कैमरे की अनुमति दें, या कार्ड की फ़ोटो अपलोड करें। |
| `aadhaar.cameraHint` (added 17 Oct 2026) | Hold the QR code of the card inside the box, about a hand’s width from the camera. Keep it still, in good light – it is read by itself. | कार्डचा QR कोड चौकटीत, कॅमेऱ्यापासून साधारण एक हात-रुंदी अंतरावर धरा. तो स्थिर ठेवा, चांगल्या उजेडात – तो आपोआप वाचला जातो. | कार्ड का QR कोड बॉक्स के अंदर, कैमरे से लगभग एक हथेली की दूरी पर रखें। उसे स्थिर रखें, अच्छी रोशनी में – वह अपने आप पढ़ लिया जाता है। |
| `aadhaar.scanAgain` (added 17 Oct 2026) | Scan again | पुन्हा स्कॅन करा | फिर से स्कैन करें |
| `aadhaar.looking` (added 17 Oct 2026) | Looking for the QR code… | QR कोड शोधत आहे… | QR कोड खोजा जा रहा है… |
| `aadhaar.noCamera` (added 17 Oct 2026) | No camera was found. Please upload a photo of the card. | कॅमेरा सापडला नाही. कृपया कार्डचा फोटो अपलोड करा. | कैमरा नहीं मिला। कृपया कार्ड की फ़ोटो अपलोड करें। |
| `aadhaar.open` (added 17 Oct 2026) | Scan my Aadhaar card | माझे आधार कार्ड स्कॅन करा | मेरा आधार कार्ड स्कैन करें |
| `aadhaar.openHint` (added 17 Oct 2026) | By scanning, you agree to your Aadhaar card being read for your name, age and address. It is read on this phone or computer – nothing is saved or sent. | स्कॅन करून, तुमचे नाव, वय आणि पत्ता यासाठी तुमचे आधार कार्ड वाचण्यास तुम्ही संमती देता. ते याच फोन किंवा संगणकावर वाचले जाते – काहीही साठवले किंवा पाठवले जात नाही. | स्कैन करके, आप अपने नाम, उम्र और पते के लिए अपना आधार कार्ड पढ़े जाने की सहमति देते हैं। इसे इसी फ़ोन या कंप्यूटर पर पढ़ा जाता है – कुछ भी न रखा जाता है, न भेजा जाता है। |
| `aadhaar.upload` (added 17 Oct 2026) | Upload a photo instead | त्याऐवजी फोटो अपलोड करा | इसके बजाय फ़ोटो अपलोड करें |
| `aadhaar.capture` (added 17 Oct 2026) | Capture | फोटो घ्या | फ़ोटो लें |
| `aadhaar.cameraSize` (added 17 Oct 2026) | Camera picture: {size} | कॅमेरा चित्र: {size} | कैमरा तस्वीर: {size} |
| `aadhaar.captureMissed` (added 17 Oct 2026) | The QR code could not be read from this picture. Hold the card still, a little closer or further, with no shine on it, and press Capture again. | या चित्रातून QR कोड वाचता आला नाही. कार्ड स्थिर धरा, थोडे जवळ किंवा दूर, त्यावर चमक नसेल असे, आणि पुन्हा "फोटो घ्या" दाबा. | इस तस्वीर से QR कोड नहीं पढ़ा जा सका। कार्ड स्थिर रखें, थोड़ा पास या दूर, उस पर चमक न हो, और फिर से "फ़ोटो लें" दबाएँ। |
| `aadhaar.slowTips` (added 17 Oct 2026) | Not read yet? Hold the card flat and still with the QR code filling most of the box. If the picture is blurry, move the card a little further away until it is sharp, then press Capture. Or upload a close photo of the QR code. | अजून वाचले नाही? कार्ड सरळ आणि स्थिर धरा, QR कोडने चौकटीचा बहुतेक भाग भरेल असे. चित्र धूसर असल्यास, ते स्पष्ट होईपर्यंत कार्ड थोडे दूर न्या, मग "फोटो घ्या" दाबा. किंवा QR कोडचा जवळून घेतलेला फोटो अपलोड करा. | अभी तक नहीं पढ़ा गया? कार्ड सीधा और स्थिर रखें, ताकि QR कोड बॉक्स का ज़्यादातर हिस्सा भरे। तस्वीर धुंधली हो तो कार्ड थोड़ा दूर ले जाएँ जब तक वह साफ़ न हो, फिर "फ़ोटो लें" दबाएँ। या QR कोड की पास से ली गई फ़ोटो अपलोड करें। |
| `aadhaar.whichCamera` (added 17 Oct 2026) | Camera | कॅमेरा | कैमरा |
| `aadhaar.defaultCamera` (added 17 Oct 2026) | The usual camera | नेहमीचा कॅमेरा | सामान्य कैमरा |
| `aadhaar.switchCamera` (added 17 Oct 2026) | Switch camera | कॅमेरा बदला | कैमरा बदलें |
| `aadhaar.mirror` (added 17 Oct 2026) | Mirror picture | आरशासारखे चित्र | आईने जैसी तस्वीर |
| `aadhaar.oneCamera` (added 17 Oct 2026) | This device has only one camera. | या उपकरणाला एकच कॅमेरा आहे. | इस डिवाइस में केवल एक कैमरा है। |
| refusal `OTP_NOT_SENT` (added 17 Oct 2026) | (the server's English message) | OTP आत्ता पाठवता आला नाही. कृपया एका मिनिटाने पुन्हा प्रयत्न करा, किंवा ईमेल आणि पासवर्डने आत या. | OTP अभी नहीं भेजा जा सका। कृपया एक मिनट बाद फिर कोशिश करें, या ईमेल और पासवर्ड से अंदर आएँ। |

## 6. WhatsApp at the desk (added 17 Oct 2026)

Files: `server/src/reminders/messages.js` (`queueMessage`) and `client/src/pages/portal/portalAccountWords.js`
(`otpSentWhatsapp`). Sent on WhatsApp to a patient who chose Marathi or Hindi for her messages, and shown in the portal
after she asks for an OTP. `{…}` are filled in by the app.

| What | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| Queue time, walk-in token | {hospital}: your token is {token} with {doctor}. {n} patients are before you. Expected time about {time} – it may change a little. | {hospital}: आपला टोकन क्रमांक {token} आहे ({doctor}). आपल्या आधी {n} रुग्ण आहेत. साधारण {time} वाजता आपला क्रमांक येईल. वेळ थोडी बदलू शकते. | {hospital}: आपका टोकन नंबर {token} है ({doctor})। आपसे पहले {n} मरीज़ हैं। लगभग {time} बजे आपकी बारी आएगी। समय थोड़ा बदल सकता है। |
| Queue time, booked time | {hospital}: you are checked in for {time} with {doctor}. … | {hospital}: आपली {time} ची भेट नोंदली आहे ({doctor}). … | {hospital}: आपकी {time} की मुलाक़ात दर्ज है ({doctor})। … |
| OTP sent (portal) | If {number} is registered, an OTP was sent to it on WhatsApp (or by SMS). | {number} नोंदलेला असल्यास त्यावर WhatsApp वर (किंवा SMS ने) OTP पाठवला आहे. | अगर {number} पंजीकृत है, तो उस पर WhatsApp पर (या SMS से) OTP भेजा गया है। |
| `tabs.profile` (changed 19 Oct 2026) | My profile | माझी प्रोफाइल | मेरी प्रोफ़ाइल |
| `myProfile.title` (added 19 Oct 2026) | My profile | माझी प्रोफाइल | मेरी प्रोफ़ाइल |
| `myProfile.tabs.details` (added 19 Oct 2026) | My details | माझी माहिती | मेरी जानकारी |
| `myProfile.tabs.visits` (added 19 Oct 2026) | Visits | भेटी | मुलाक़ातें |
| `myProfile.tabs.plan` (added 19 Oct 2026) | Care plan | काळजीची योजना | देखभाल योजना |
| `myProfile.tabs.scans` (added 19 Oct 2026) | Sonography | सोनोग्राफी | सोनोग्राफ़ी |
| `myProfile.tabs.lab` (added 19 Oct 2026) | Lab reports | तपासणी अहवाल | जाँच रिपोर्ट |
| `myProfile.tabs.prescriptions` (added 19 Oct 2026) | Prescriptions | औषधचिठ्ठ्या | पर्चे |
| `myProfile.tabs.password` (added 19 Oct 2026) | Password | पासवर्ड | पासवर्ड |
| `myProfile.yourDetails` (added 19 Oct 2026) | Your details at the hospital | रुग्णालयाकडे असलेली तुमची माहिती | अस्पताल में आपकी जानकारी |
| `myProfile.contactTitle` (added 19 Oct 2026) | Your contact details | तुमची संपर्क माहिती | आपकी संपर्क जानकारी |
| `myProfile.contactHint` (added 19 Oct 2026) | You can change these yourself. | ही माहिती तुम्ही स्वतः बदलू शकता. | यह जानकारी आप ख़ुद बदल सकती हैं। |
| `myProfile.city` (added 19 Oct 2026) | City, town or village | शहर, गाव | शहर, क़स्बा या गाँव |
| `myProfile.state` (added 19 Oct 2026) | State | राज्य | राज्य |
| `myProfile.pinCode` (added 19 Oct 2026) | PIN code | पिन कोड | पिन कोड |
| `myProfile.emergencyTitle` (added 19 Oct 2026) | Whom to call in an emergency | आणीबाणीच्या वेळी कोणाला फोन करावा | आपातकाल में किसे फ़ोन करें |
| `myProfile.ecName` (added 19 Oct 2026) | Name | नाव | नाम |
| `myProfile.ecRelation` (added 19 Oct 2026) | Relation | नाते | रिश्ता |
| `myProfile.ecPhone` (added 19 Oct 2026) | Phone | फोन | फ़ोन |
| `myProfile.saveContact` (added 19 Oct 2026) | Save my contact details | माझी संपर्क माहिती जतन करा | मेरी संपर्क जानकारी सहेजें |
| `myProfile.contactSaved` (added 19 Oct 2026) | Your contact details are saved. | तुमची संपर्क माहिती जतन झाली. | आपकी संपर्क जानकारी सहेज ली गई। |
| `myProfile.requestTitle` (added 19 Oct 2026) | Change your name, age, mobile or email | तुमचे नाव, वय, मोबाइल किंवा ईमेल बदला | अपना नाम, उम्र, मोबाइल या ईमेल बदलें |
| `myProfile.requestHint` (added 19 Oct 2026) | The hospital reception checks who you are, then changes them. You see the answer here. Fill in only what should change. | रुग्णालयाचा स्वागत कक्ष आधी तुमची ओळख तपासतो, मग बदल करतो. उत्तर इथे दिसेल. फक्त जे बदलायचे ते भरा. | अस्पताल का रिसेप्शन पहले आपकी पहचान जाँचता है, फिर बदलाव करता है। जवाब यहीं दिखेगा। केवल वही भरें जो बदलना है। |
| `myProfile.newName` (added 19 Oct 2026) | New name | नवीन नाव | नया नाम |
| `myProfile.newAge` (added 19 Oct 2026) | Age (years) | वय (वर्षे) | उम्र (साल) |
| `myProfile.newMobile` (added 19 Oct 2026) | New mobile number | नवीन मोबाइल क्रमांक | नया मोबाइल नंबर |
| `myProfile.newEmail` (added 19 Oct 2026) | New email | नवीन ईमेल | नया ईमेल |
| `myProfile.why` (added 19 Oct 2026) | Why (optional) | कारण (ऐच्छिक) | कारण (वैकल्पिक) |
| `myProfile.sendRequest` (added 19 Oct 2026) | Send to reception | स्वागत कक्षाला पाठवा | रिसेप्शन को भेजें |
| `myProfile.requestSent` (added 19 Oct 2026) | Sent to reception. You see their answer here. | स्वागत कक्षाला पाठवले. त्यांचे उत्तर इथे दिसेल. | रिसेप्शन को भेज दिया। उनका जवाब यहीं दिखेगा। |
| `myProfile.waiting` (added 19 Oct 2026) | Waiting for reception | स्वागत कक्षाच्या उत्तराची वाट | रिसेप्शन के जवाब का इंतज़ार |
| `myProfile.requestedOn` (added 19 Oct 2026) | Asked on {x}: | {x} रोजी विचारले: | {x} को पूछा: |
| `myProfile.approved` (added 19 Oct 2026) | Changed | बदलले | बदल दिया |
| `myProfile.rejected` (added 19 Oct 2026) | Not changed | बदलले नाही | नहीं बदला |
| `myProfile.changeNames.fullName` (added 19 Oct 2026) | Name | नाव | नाम |
| `myProfile.changeNames.ageYears` (added 19 Oct 2026) | Age | वय | उम्र |
| `myProfile.changeNames.phone` (added 19 Oct 2026) | Mobile | मोबाइल | मोबाइल |
| `myProfile.changeNames.email` (added 19 Oct 2026) | Email | ईमेल | ईमेल |
| `myProfile.scansRule` (added 19 Oct 2026) | Your scan reports once the doctor has signed them, as printed. | डॉक्टरांनी सही केल्यानंतर तुमचे स्कॅन अहवाल, छापलेल्याप्रमाणे. | डॉक्टर के हस्ताक्षर के बाद आपकी स्कैन रिपोर्ट, छपी हुई जैसी। |
| `myProfile.noScans` (added 19 Oct 2026) | No signed scan reports yet. | अजून सही केलेला स्कॅन अहवाल नाही. | अभी कोई हस्ताक्षरित स्कैन रिपोर्ट नहीं। |
| `myProfile.findings` (added 19 Oct 2026) | Findings | निष्कर्ष | निष्कर्ष |
| `myProfile.impression` (added 19 Oct 2026) | Impression | सारांश | सारांश |
| `myProfile.signedBy` (added 19 Oct 2026) | Signed by {x}, {y} | {x} यांनी सही केली, {y} | {x} ने हस्ताक्षर किए, {y} |
| `myProfile.noPlan` (added 19 Oct 2026) | No care plan yet. | अजून काळजीची योजना नाही. | अभी कोई देखभाल योजना नहीं। |

## 7. The patient's Home page: welcome and next steps (added 20 Oct 2026)

File: `client/src/pages/portal/portalAccountWords.js` (`home`). DRAFT – to be checked by fluent speakers.

| Where | English | मराठी (Marathi) | हिंदी (Hindi) |
|---|---|---|---|
| `greet` | Good morning / Good afternoon / Good evening | सुप्रभात / नमस्कार / शुभ संध्याकाळ | सुप्रभात / नमस्ते / शुभ संध्या |
| `heroLine` | Your care at {hospital}, all in one place. | {hospital} मधील तुमची सर्व काळजी, एकाच ठिकाणी. | {hospital} में आपकी पूरी देखभाल, एक ही जगह। |
| `nextSteps` | Your next steps | तुमची पुढील पावले | आपके अगले कदम |
| `stepPlan` | Coming up in your care | तुमच्या काळजीत पुढे | आपकी देखभाल में आगे |
| `stepReports` | 1 lab report is ready to see / {n} lab reports are ready to see | 1 तपासणी अहवाल पाहण्यासाठी तयार आहे / {n} … तयार आहेत | 1 जाँच रिपोर्ट देखने के लिए तैयार है / {n} … तैयार हैं |
| `stepPay` | {amount} still to pay | {amount} भरायचे बाकी | {amount} भरना बाकी |
| `stepAllDone` | Nothing is waiting for you right now. | सध्या तुमच्यासाठी काहीही बाकी नाही. | अभी आपके लिए कुछ भी बाकी नहीं है। |
| `open` | Open | उघडा | खोलें |
