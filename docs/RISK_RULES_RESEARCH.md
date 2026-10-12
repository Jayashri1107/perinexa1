# Risk rules – research notes for the reviewing doctor

> Prepared automatically by several independent research agents (28 Sep 2026) that read published guidance. This is **not** a clinical review. Please check the sources yourself and decide each rule before approving the template in *Care plans → Templates & protocols*.

Each draft rule was checked twice: once against **Government of India** sources (MoHFW PMSMA high-risk list 2016 and 2024 update, MoHFW SBA/ANC guidelines, MCP Card guidebook 2018, MoHFW GDM and Anemia Mukt Bharat) and once against **professional/international** sources (FOGSI / FOGSI-ICOG, WHO 2016, NICE, RCOG, ACOG). Below, each rule shows both passes (A and B – one focused on Government of India documents, the other on professional/international guidance; the notes say which sources each used). Where they disagree, the app's draft follows the Government of India criterion and says so in the rule's source text.

## Later change (rules version 5, 4 Oct 2026)

Built on 4 Oct 2026 (see "Next" in `docs/PROGRESS.md`). Nine DRAFT rules were added for what is found **during**
the pregnancy. None of them has been reviewed by a doctor; each rule's source text says "doctor to confirm".

- **Findings a doctor or RMO ticks on the record** (Edit details → Findings in this pregnancy), each High risk:
  gestational diabetes (`preg_gdm`), high blood pressure in this pregnancy (`preg_hypertension`), twins or more
  (`preg_multiple`), low-lying placenta / placenta praevia (`preg_placenta_praevia`), bleeding in this pregnancy
  (`preg_bleeding`). Nothing is ticked by the software.
- **Readings**: lowest haemoglobin of this pregnancy under 7 g/dL = High (`hb_under_7`), under 11 g/dL = Moderate
  (`hb_under_11`); latest blood pressure at a visit, upper number 140 or more = High (`bp_systolic_140`), lower
  number 90 or more = High (`bp_diastolic_90`). Haemoglobin comes from the visits and from lab results a doctor has
  reviewed; blood pressure from the visits. One reading is used, although the guidelines ask for two.
- These rules use the sources already listed below for the same factors (PMSMA high-risk list, MoHFW SBA guidelines,
  Anemia Mukt Bharat, WHO 2024 haemoglobin cut-offs, FOGSI-GESTOSIS-ICOG 2019). No new research pass was made.
- **Not researched here:** the schedules of the six new care-plan items for findings (twin growth scans – NICE
  NG137 / ISUOG; GDM growth scan – MoHFW GDM guidelines 2018; follow-up placenta scan – RCOG Green-top 27a). They
  were written from the developer's knowledge of those guidelines and were not checked against the original texts.
- Rules version 4 (2 Oct 2026) only changed wording: the rules about previous abortions no longer mention MTP.

## Later change (rules version 3)

- **Previous surgery on the uterus** (e.g. myomectomy) moved from "problems in previous pregnancies" to the
  **conditions** list (rule `cond_uterine_surgery`, still high risk). It can happen outside any pregnancy, so it
  must also count for a first pregnancy. Existing sample patients were moved over by `npm run seed`.
- A **first pregnancy** now means: pregnant, Gravida 1, and no earlier deliveries, abortions or caesareans. Only
  then is "problems in previous pregnancies" not needed. The app also checks that Gravida ≥ Para + Abortions + 1.

## What changed in the draft after this research (rules version 2)

| Rule | First draft | Now (draft v2) | Why |
|---|---|---|---|
| Young age | under 18 | **under 20** | PMSMA: 'young primi (less than 20 years)'; 2024 list: teenage pregnancy |
| Grand multipara | para ≥ 5 | **para ≥ 4** | MoHFW SBA 2010 defines grand multipara as 4 or more; NICE parity ≥ 4 |
| Miscarriages / abortions | ≥ 2 → high | **≥ 3 high, exactly 2 moderate** | GoI SBA uses ≥ 3 spontaneous; the app's count also includes MTPs |
| Severe obesity | – | **BMI ≥ 35 → high** (added) | FOGSI-ICOG: BMI ≥ 35 at first contact is high risk |
| Low weight | – | **weight < 45 kg → moderate** (added) | MoHFW SBA/ANM guideline |
| Previous-pregnancy problems | – | **10 new rules** (stillbirth/newborn death, preterm, pre-eclampsia, anomaly, obstructed labour, PPH, uterine surgery (moved to conditions in v3), Rh sensitisation → high; baby < 2.5 kg or > 4 kg → moderate) | PMSMA 'bad obstetric history'; MoHFW SBA/ANC guidelines |
| More conditions | – | **kidney, autoimmune, thrombophilia, mental health, syphilis → high; other liver disease → moderate** | MoHFW SBA systemic illness list; PMSMA (syphilis); FOGSI-GESTOSIS-ICOG HDP score |

## Rule-by-rule findings

### Young age (draft said under 18)

**Research pass A:** partly supported — *Age < 20 years (teenage pregnancy / 'young primi less than 20 years'). The older 2010 ANM guideline gives < 18.* (suggested level: high)

Teenage pregnancy is a GoI high-risk category, but the government's numeric cut-off is under 20, not under 18. The 2016 PMSMA list and the National Health Portal use 'young primi (<20)', and the Portal describes adolescent mothers as 10-19 years. The 2024 list of 25 categories has separate 'Teenage Pregnancy' and 'Early Primi' entries but gives no numbers. The 2010 SBA/ANM guideline uses under 18. Suggest changing the value to lt 20 and keeping level high. The obstetrician should confirm whether it applies to all parities (2024 'Teenage Pregnancy') or only first pregnancies (2016 'young primi').

Sources: [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Release ID 2040949, Annexure-2: 25 HRP categories](https://pib.gov.in/PressReleasePage.aspx?PRID=2040949); [PMSMA (MoHFW): High risk factors of pregnancy and their management at an ANC clinic (High-Risk-Conditions-in-p](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [National Health Portal (MoHFW/CHI), High risk pregnancy page (archived 26 Mar 2023)](https://web.archive.org/web/20230326083738/https://www.nhp.gov.in/disease/gynaecology-and-obstetrics/high-risk-pregnancy); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010), Introduction p.1](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf)

**Research pass B:** partly supported — *Age < 18 years (MoHFW SBA guideline). Other Indian cut-offs: PMSMA 'young primi' < 20 years; FOGSI-GESTOSIS-ICOG score < 19 years. WHO counts adolescent pregnancy as ages 10-19.* (suggested level: high)

Young maternal age is a recognised risk factor, but sources draw the line in different places. MoHFW SBA uses < 18, PMSMA uses < 20 (and only for first pregnancies), the FOGSI HDP score uses < 19 (1 point, for pre-eclampsia risk), and the FOGSI-ICOG ANC GCPR says only 'extremes of age' with no number. Keep < 18 as high. To match PMSMA, consider adding a second rule for ages 18-19 (at least for first pregnancies) at moderate or high. Draft level matches.

Sources: [MoHFW (GoI) Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010)](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA (MoHFW) - High risk factors of pregnancy and their management at an ANC clinic](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [FOGSI-GESTOSIS-ICOG GCPR: Hypertensive Disorders in Pregnancy (2019)](https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf); [FOGSI-ICOG GCPR: Recommendations for Routine Antenatal Care for the Healthy Pregnant Women (approved 2009)](https://icogonline.org/wp-content/uploads/pdf/gcpr/Care_for_the_Healthy_Pregnant_Women.pdf)

### age_over_35

**Research pass A:** supported — *Age > 35 years ('elderly gravida more than 35 years')* (suggested level: high)

Keep as drafted. Both the 2016 PMSMA list and the National Health Portal use 'more than 35 years', and 'Elderly Primi' is one of the 2024 categories. The sources disagree in two ways. First, the 2024 wording is 'Elderly Primi' (first pregnancy only), while the 2016 wording is 'elderly gravida' (any pregnancy). Second, the 2010 SBA guideline uses above 40. The text says 'more than 35', which matches gt 35. The obstetrician should decide whether a woman who is exactly 35 at booking should be flagged, since many guidelines use >= 35.

Sources: [PMSMA (MoHFW): High risk factors of pregnancy and their management at an ANC clinic](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [National Health Portal (MoHFW/CHI), High risk pregnancy page (archived 26 Mar 2023)](https://web.archive.org/web/20230326083738/https://www.nhp.gov.in/disease/gynaecology-and-obstetrics/high-risk-pregnancy); [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Release ID 2040949, Annexure-2](https://pib.gov.in/PressReleasePage.aspx?PRID=2040949); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010), p.1](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf)

**Research pass B:** supported — *Age >= 35 years, ideally worked out at the expected delivery date (ACOG). PMSMA and FOGSI word it as 'more than 35'. Risk rises further at 40 and over (NICE; MoHFW SBA).* (suggested level: high)

Supported, but the boundary differs. ACOG covers women aged 35 or older at delivery. PMSMA and the FOGSI HDP score say 'more than 35', and the FOGSI-ICOG ANC GCPR says 'aged 35 or older' for pre-eclampsia risk. Suggest op 'gte' and computing age at the EDD, so women who turn 35 during pregnancy are caught. PMSMA counts elderly gravida as a high-risk condition, so keeping 'high' fits Indian practice. International guidance treats 35-39 as a moderate risk factor and 40+ as higher risk (NICE lists 40+ as a moderate pre-eclampsia factor; MoHFW SBA uses 'above 40'). A separate rule for 40+ is worth considering.

Sources: [ACOG Obstetric Care Consensus No. 11: Pregnancy at Age 35 Years or Older (Obstet Gynecol 2022;140:348-66)](https://pubmed.ncbi.nlm.nih.gov/35852294/); [PMSMA (MoHFW) - High risk factors of pregnancy and their management at an ANC clinic](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [FOGSI-GESTOSIS-ICOG GCPR: Hypertensive Disorders in Pregnancy (2019)](https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf); [FOGSI-ICOG GCPR: Routine Antenatal Care for the Healthy Pregnant Women (approved 2009)](https://icogonline.org/wp-content/uploads/pdf/gcpr/Care_for_the_Healthy_Pregnant_Women.pdf)

### height_under_145

**Research pass A:** supported — *Height < 145 cm* (suggested level: high)

Keep as drafted. The MoHFW/MWCD MCP Card Guidebook 2018 states the 145 cm cut-off explicitly, and 'Short Stature' is one of the 25 GoI HRP categories (2024). One secondary paper (JOGH 2023) uses < 140 cm and attributes it to PMSMA, but the PMSMA document it cites has no height criterion. The 2010 SBA guideline gives no height cut-off.

Sources: [MoHFW & MWCD, Guidebook for Mother-Child Protection Card 2018 (for ANM/ASHA/AWW), p.13](https://nhm.gov.in/New_Updates_2018/NHM_Components/Immunization/Guildelines_for_immunization/MCP_Guide_Book.pdf); [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Release ID 2040949, Annexure-2](https://pib.gov.in/PressReleasePage.aspx?PRID=2040949); [JOGH 2023: High-risk pregnancy in India, prevalence and contributing risk factors (secondary)](https://jogh.org/2023/jogh-13-04116)

**Research pass B:** partly supported — *Height < 145 cm (the usual cut-off in Indian and LMIC research). Some Indian analyses use < 140 cm. No FOGSI, WHO, NICE or ACOG guideline found that sets a height threshold.* (suggested level: moderate)

The 145 cm cut-off is well backed by evidence: a meta-analysis including WHO Global Survey data found about 2x risk of SGA and preterm birth, and a Thai study found OR 2.4 for CPD. Indian studies say an MoHFW manual defines short stature as < 145 cm. However, the PMSMA high-risk list and the FOGSI-ICOG ANC GCPR that I actually read do not include height. The national JOGH analysis used < 140 cm. It is mainly a CPD / operative-delivery and SGA risk, so moderate seems proportionate. Keep 'high' only if the hospital follows the Indian convention of treating it as high risk; the obstetrician should decide.

Sources: [Kozuki N et al. Short maternal stature increases risk of SGA and preterm births in LMICs: IPD meta-analysis (J](https://pubmed.ncbi.nlm.nih.gov/26423738/); [Short stature as an independent risk factor for cephalopelvic disproportion (Thailand, PMC3351595)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3351595/); [Prevalence and correlates of high-risk pregnancy in an aspirational district of Assam (PMC13068423)](https://pmc.ncbi.nlm.nih.gov/articles/PMC13068423/); [High-risk pregnancy in India: prevalence and contributing risk factors - national survey analysis (JOGH 2023, ](https://pmc.ncbi.nlm.nih.gov/articles/PMC10502764/)

### bmi_30_plus

**Research pass A:** partly supported — *No GoI HRP BMI threshold. Obesity is BMI >= 30 kg/m2 (RCOG). The MoHFW GDM guideline 2018 uses Asian cut-offs: overweight 23-24.9, obese >25.* (suggested level: moderate)

Obesity is a recognised risk, but it is not one of the 25 GoI HRP categories (it could only go under 'Others'). The PMSMA doc mentions obesity only as a reason to screen for thyroid disease, with no cut-off. The National Health Portal lists pre-pregnancy obesity as a risk, also without a cut-off. >= 30 fits international definitions, but MoHFW's own GDM guideline calls >25 obese for Indian women. The obstetrician may want to add a 25-29.9 tier. Booking BMI taken in later pregnancy overstates pre-pregnancy BMI, so prefer first-trimester weight.

Sources: [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Release ID 2040949, Annexure-2](https://pib.gov.in/PressReleasePage.aspx?PRID=2040949); [PMSMA (MoHFW): High risk factors of pregnancy and their management at an ANC clinic](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW, Diagnosis & Management of Gestational Diabetes Mellitus: Technical and Operational Guidelines (2018), p](https://nhm.gov.in/New_Updates_2018/NHM_Components/RMNCH_MH_Guidelines/Gestational-Diabetes-Mellitus.pdf); [National Health Portal (MoHFW/CHI), High risk pregnancy page (archived 26 Mar 2023)](https://web.archive.org/web/20230326083738/https://www.nhp.gov.in/disease/gynaecology-and-obstetrics/high-risk-pregnancy)

**Research pass B:** supported — *BMI >= 30 kg/m2 at first antenatal visit (WHO; RCOG GTG 72). FOGSI-ICOG treats BMI >= 35 at first contact as high risk. For Indian women, lower Asian cut-offs are recommended: WHO action points 23 / 27.5, and the Indian consensus defines obesity as >= 25.* (suggested level: moderate)

Keep >= 30 as moderate. Consider a separate 'high' rule for BMI >= 35: the FOGSI-ICOG ANC GCPR counts it as high risk, the FOGSI HDP score gives it 2 points (vs 1 for > 30), and NICE lists it as a moderate pre-eclampsia factor. For an Indian population, WHO 2004 and FIGO 2020 suggest lower action points (23 / 27.5). The Indian consensus uses obesity >= 25, and an Indian obstetric study found Asian cut-offs predicted GDM and pre-eclampsia better. Consider flagging BMI >= 27.5 (or >= 25) as moderate; the obstetrician should decide.

Sources: [RCOG Green-top Guideline No. 72: Care of Women with Obesity in Pregnancy](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/care-of-women-with-obesity-in-pregnancy-green-top-guideline-no-72/); [FIGO guideline: Management of prepregnancy, pregnancy and postpartum obesity (2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7590083/); [WHO Expert Consultation. Appropriate BMI for Asian populations (Lancet 2004;363:157-63)](https://pubmed.ncbi.nlm.nih.gov/14726171/); [Misra A et al. Consensus statement for diagnosis of obesity in Asian Indians (JAPI 2009)](https://pubmed.ncbi.nlm.nih.gov/19582986/)

### bmi_under_18_5

**Research pass A:** partly supported — *BMI < 18.5 kg/m2 (underweight in the MoHFW GDM guideline table). GoI ANC guidance instead uses body weight < 45 kg.* (suggested level: moderate)

Not one of the 25 GoI HRP categories. GoI treats low maternal weight mainly as a nutrition issue. The ANM guideline gives extra nutrition to women under 45 kg, and the PMSMA doc lists pre-pregnancy weight under 50 kg as a cause of IUGR. The < 18.5 cut-off comes from MoHFW's GDM guideline BMI table. Moderate is reasonable. The obstetrician may want an additional weight < 45 kg check, since that is the threshold GoI field guidance uses.

Sources: [MoHFW, Diagnosis & Management of Gestational Diabetes Mellitus: Technical and Operational Guidelines (2018), p](https://nhm.gov.in/New_Updates_2018/NHM_Components/RMNCH_MH_Guidelines/Gestational-Diabetes-Mellitus.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010), p.30](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA (MoHFW): High risk factors of pregnancy and their management at an ANC clinic, IUGR section](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Release ID 2040949, Annexure-2](https://pib.gov.in/PressReleasePage.aspx?PRID=2040949)

**Research pass B:** supported — *BMI < 18.5 kg/m2 (WHO underweight). FOGSI-ICOG uses BMI < 18 at first contact as a high-risk criterion.* (suggested level: moderate)

Underweight is a recognised risk: about 1.3x preterm birth and 1.6x low birth weight in a large meta-analysis. The FOGSI-ICOG ANC GCPR (2009) counts BMI < 18 at first contact as high risk, so the obstetrician may want to escalate. Given the modest effect sizes and how common underweight is in India, moderate is reasonable. WHO ANC 2016 recommends balanced energy-protein supplements where more than 20% of women have BMI < 18.5, which applies to India nationally. MoHFW SBA also flags weight < 45 kg for extra nutrition.

Sources: [WHO Global Health Observatory: BMI among adults](https://www.who.int/data/gho/data/themes/topics/indicator-groups/indicator-group-details/GHO/bmi-among-adults); [FOGSI-ICOG GCPR: Routine Antenatal Care for the Healthy Pregnant Women (approved 2009)](https://icogonline.org/wp-content/uploads/pdf/gcpr/Care_for_the_Healthy_Pregnant_Women.pdf); [Han Z et al. Maternal underweight and the risk of preterm birth and low birth weight: systematic review and me](https://pubmed.ncbi.nlm.nih.gov/21097954/); [Victora/Christian et al. on targeting maternal undernutrition (PMC7101036), summarising WHO ANC 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC7101036/)

### previous_caesarean

**Research pass A:** supported — *Any previous caesarean section (>=1 prior CS / 'Previous LSCS'). No source gives a higher numeric cut-off. Risk of placenta praevia and accreta goes up with each additional CS.* (suggested level: high)

Same as the draft (high). Indian national guidance (PMSMA 2024 list of 25 HRP categories) includes 'Previous LSCS', and the PMSMA synopsis says to plan delivery at a CEmOC facility that can transfuse blood. WHO PCPNC puts 'prior delivery by caesarean' at referral level. NICE NG235 Table 7 lists previous caesarean birth under planned birth at an obstetric unit. The PMSMA synopsis notes that antenatal complications are 'not high'; the main risks are scar rupture, praevia/accreta and repeat-surgery problems. Consider a separate escalation for >=2 CS, or CS plus a low-lying placenta (accreta risk, RCOG GTG 45). I could not verify the FOGSI GCPR text: fogsi.org requires a human-verification check, which I did not complete.

Sources: [PIB/MoHFW: Update on Pradhan Mantri Surakshit Matritva Abhiyan (PMSMA), Aug 2024, Annexure-2: 25 HRP categorie](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2040949); [PMSMA / MoHFW: High Risk Conditions in Pregnancy (synopsis for doctors)](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [WHO: Pregnancy, Childbirth, Postpartum and Newborn Care: a guide for essential practice (PCPNC), chart C2 (AFR](https://www.afro.who.int/sites/default/files/2017-06/mps%20pcpnc.pdf); [NICE NG235 Intrapartum care (2023, updated 2025), Table 7](https://www.nice.org.uk/guidance/ng235/chapter/Recommendations)

**Research pass B:** supported — *Previous LSCS: any prior caesarean section, so previousCaesareans >= 1. No GoI source uses a higher count.* (suggested level: high)

The sources agree. 'Previous LSCS' is one of the 25 PMSMA high-risk pregnancy (HRP) categories and appears in the LaQshya HRP list. The PMSMA doctor synopsis says these women should deliver at a CEmOC facility with blood transfusion. The 2009 MO handbook says to refer to an FRU in labour. PMSMA does not grade risk into tiers, so 'high' fits. Gap: the 2010 SBA guideline also flags other 'surgery on the reproductive tract' (for example myomectomy), which this count field does not capture.

Sources: [PIB (MoHFW), Update on Pradhan Mantri Surakshit Matritva Abhiyan (PMSMA), 02 Aug 2024 (Lok Sabha reply)](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2040949); [PMSMA / MoHFW: High risk factors of pregnancy and their management at an ANC clinic (doctor synopsis, 2016)](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW LaQshya Standard Operating Procedures for District Hospitals (2018)](https://www.nhm.gov.in/New_Updates_2018/NHM_Components/RMNCHA/MH/Guidelines/DH_SOP_LaQshya.pdf); [MoHFW Trainees' Handbook for Training of Medical Officers in Pregnancy Care and Management of Common Obstetric](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/trainees_handbook_for_training_of_mos_in_preg_care.pdf)

### Grand multipara

**Research pass A:** partly supported — *Para >=5 (classic definition: 5 or more previous births at or beyond viability). Sources disagree: NICE uses parity >=4, MoHFW SBA 2010 uses '4 or more pregnancies', WHO PCPNC uses 'more than six previous births', and PMSMA lists 'Grand Multipara' with no number.* (suggested level: high)

It is a recognised risk factor, but both the threshold and the tier vary. In India, PMSMA's national HRP list includes 'Grand Multipara' (no threshold), which supports 'high' for Indian HRP tagging. International sources put it lower: NICE NG235 lists 'Grand multiparity (parity 4 or more)' only in Table 9 ('other factors to take into account', individual assessment), and WHO PCPNC places >6 births at primary-care level, not referral level. So 'moderate' is defensible if you follow NICE/WHO. The older MoHFW SBA guide counts pregnancies (>=4), not births. The obstetrician should choose 4 vs 5. Make sure 'para' counts births at or beyond viability (twins count once) and does not include abortions.

Sources: [PIB/MoHFW: Update on PMSMA, Aug 2024, Annexure-2: 25 HRP categories](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2040949); [MoHFW: Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (April 2010)](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [NICE NG235 Intrapartum care (2023, updated 2025), Table 9](https://www.nice.org.uk/guidance/ng235/chapter/Recommendations); [WHO PCPNC, chart C2 (AFRO-hosted copy of the earlier edition)](https://www.afro.who.int/sites/default/files/2017-06/mps%20pcpnc.pdf)

**Research pass B:** partly supported — *'Grand multipara', with a threshold of four: the MoHFW SBA guideline (2010) defines grand multiparas as women who have had four or more pregnancies. In practice that is para >= 4. PMSMA and LaQshya list grand multipara with no number.* (suggested level: high)

The category is supported: it is PMSMA HRP category no. 23 and item 1 in the LaQshya HRP list, so 'high' fits. The threshold is not. The only GoI number found is four (SBA), but the draft uses para >= 5, so it would miss para-4 women whom GoI guidance counts. SBA's wording ('pregnancies', not births) is loose. International literature usually starts at parity >= 5. Suggest para >= 4 to match GoI, or let the obstetrician choose 4 or 5.

Sources: [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010), Introduction p.1](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Annexure-2 (25 HRP categories)](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2040949); [MoHFW LaQshya Standard Operating Procedures for District Hospitals (2018)](https://www.nhm.gov.in/New_Updates_2018/NHM_Components/RMNCHA/MH/Guidelines/DH_SOP_LaQshya.pdf); [Mgaya AH et al. Grand multiparity: is it still a risk in pregnancy? BMC Pregnancy Childbirth 2013;13:241](https://pmc.ncbi.nlm.nih.gov/articles/PMC3878019/)

### Previous miscarriages / abortions

**Research pass A:** partly supported — *>=2 SPONTANEOUS pregnancy losses before viability, not necessarily consecutive, excluding ectopic, molar and induced abortions/MTP (ESHRE 2022, ASRM 2026). RCOG uses >=3 first-trimester miscarriages. MoHFW SBA 2010 refers antenatal cases with 'three or more spontaneous consecutive abortions'.* (suggested level: moderate)

The >=2 threshold matches the ESHRE and ASRM definitions of RPL, but those definitions are for starting investigations, not antenatal risk tiers. RCOG 2023 still uses >=3 (evaluation after 2 at discretion). India's MoHFW SBA guideline uses >=3 spontaneous consecutive abortions as a bad-obstetric-history referral criterion. PMSMA lists 'Bad Obstetric History' (includes abortion) as an HRP category with no number. WHO PCPNC does not list miscarriages as a referral indication. Main problem: the 'abortions' field (the A in GPAL) usually includes induced abortions/MTP, which are not RPL, so this rule will over-flag. Suggestions: record spontaneous and induced losses separately; flag >=2 spontaneous as moderate and >=3 spontaneous as high. I could not verify FOGSI GCPR text on fogsi.org (human-verification check); an ICOG (FOGSI academic wing) review supports starting a workup after 2 consecutive losses.

Sources: [ESHRE guideline: recurrent pregnancy loss: an update in 2022 (Hum Reprod Open 2023)](https://academic.oup.com/hropen/article/2023/1/hoad002/7068067); [ESHRE guideline: recurrent pregnancy loss (2017; Hum Reprod Open 2018)](https://academic.oup.com/hropen/article-abstract/2018/2/hoy004/4963604); [ASRM: Recurrent pregnancy loss: a committee opinion (2026)](https://www.asrm.org/practice-guidance/practice-committee-documents/recurrent-pregnancy-loss-a-committee-opinion-2026/); [RCOG Green-top Guideline No. 17: Recurrent Miscarriage (June 2023)](https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/recurrent-miscarriage-green-top-guideline-no-17/)

**Research pass B:** partly supported — *MoHFW SBA guideline (2010), Box 5: three or more spontaneous consecutive abortions means refer for ANC and delivery. PMSMA's 'Bad obstetric history' includes history of abortion but gives no count.* (suggested level: high)

GoI sources support a bad obstetric history as high risk, but the only GoI number is 3 or more spontaneous consecutive abortions, not 2. Also, the 'abortions' field mixes spontaneous losses with induced MTPs, so abortions >= 2 would flag women with elective MTPs. Suggest high at >= 3 spontaneous losses (add a spontaneous/induced field if possible), and at most moderate at 2. Sources disagree: ESHRE (2022) defines RPL as 2 or more losses, while RCOG (2023) uses 3 or more first-trimester miscarriages, with evaluation after 2 at the clinician's discretion. Both are about investigating RPL, not ANC risk tiers.

Sources: [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010), Box 5, p.16](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA / MoHFW: High risk factors of pregnancy and their management at an ANC clinic (2016)](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [PIB (MoHFW), Update on PMSMA, 02 Aug 2024, Annexure-2](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2040949); [ESHRE guideline: recurrent pregnancy loss, update 2022 (summary paper)](https://www.eshre.eu/-/media/sitecore-files/Guidelines/Recurrent-pregnancy-loss/2022/ESHRE-RPL-Guideline-2022-Summary-paper.pdf)

### rh_negative

**Research pass A:** supported — *Rh-negative blood group (PMSMA lists it as a high risk condition with no further qualifier). SBA Box 5 separately lists 'Rh negative in the previous pregnancy' as a reason to refer for ANC and delivery.* (suggested level: no change)

PMSMA names Rh negative directly, so keep it at high. GoI sources do not split sensitised from unsensitised women. The SBA guideline also says blood group and Rh should be tested at the PHC/FRU. Anti-D and antibody-titre protocols were not found in the GoI documents reviewed, so the obstetrician should apply them.

Sources: [PMSMA – High Risk Conditions in Pregnancy (MoHFW synopsis for PMSMA doctors)](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs (2010)](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf)

**Research pass B:** partly supported — *India (PMSMA): 'Rh negative' blood group is on the high-risk list, with no further conditions. International guidance: the high-risk state is RhD-negative with red-cell alloantibodies (positive indirect Coombs / antibody screen). An unsensitised RhD-negative woman gets routine care: an antibody screen, anti-D at 28 weeks, and anti-D within 72 h of birth if the baby is RhD-positive.* (suggested level: moderate)

The sources disagree. Keeping 'high' matches PMSMA high-risk line-listing. NICE CG62 does not list Rh-negative among women needing additional care. ACOG PB 181 handles unsensitised women with routine prophylaxis. WHO 2016 recommends routine antenatal anti-D only in research settings. Suggestion: make plain Rh-negative 'moderate' (prompt ICT and an anti-D plan), and add a separate 'high' rule for Rh-negative with positive ICT or known alloimmunisation, which BSH says needs fetal-medicine referral. The obstetrician should decide whether to keep 'high' to match PMSMA.

Sources: [MoHFW/PMSMA - High risk factors of pregnancy and their management at an ANC clinic](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [Adverse birth outcomes among women with 'low-risk' pregnancies in India (NFHS-5), Lancet Reg Health SE Asia 20](https://doi.org/10.1016/j.lansea.2023.100253); [ACOG Practice Bulletin No. 181: Prevention of Rh D Alloimmunization (2017)](https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2017/08/prevention-of-rh-d-alloimmunization); [WHO 2016 Recommendations: Antenatal Care for a Positive Pregnancy Experience (summary)](https://www.who.int/docs/default-source/reproductive-health/maternal-health/anc.pdf)

### cond_diabetes

**Research pass A:** supported — *Pre-existing diabetes (type 1 or type 2), recorded as a current systemic illness. GDM is listed as its own PMSMA high risk condition.* (suggested level: no change)

PMSMA names only GDM. Pre-existing diabetes is covered by the PMSMA catch-all 'any current systemic illness(es)/past history of illness', and SBA names 'Diabetes' in that list. The GoI GDM guideline lets well-controlled GDM on diet alone deliver at a PHC, but it does not cover pre-gestational diabetes. Keep high.

Sources: [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [MoHFW National Guidelines for Diagnosis & Management of GDM (2018)](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/National_Guidelines_for_Diagnosis_&_Management_of_Gestational_Diabetes_Mellitus.pdf); [Mother and Child Protection Card (MoHFW/MoWCD, 2018)](https://nhm.gov.in/New-Update-2022-24/CH-Programmes/HBNC-&-HBYC-Resource-%20Material/Revised-India-MCP-Card-English-(28-05-2018).pdf)

**Research pass B:** supported — *Pre-existing (pregestational) type 1 or type 2 diabetes. NICE CG62 wording: 'endocrine disorders or diabetes requiring insulin'. In the FOGSI-GESTOSIS-ICOG HDP score, pregestational diabetes scores 3, which on its own reaches the 'at risk for pre-eclampsia' threshold (>=3).* (suggested level: high)

The sources agree; same level as the draft. PMSMA names gestational diabetes explicitly. Pre-existing diabetes is covered by PMSMA's 'current systemic illness'. Keep this code separate from GDM diagnosed in pregnancy, which should also be flagged. ACOG links the size of the risk to glycaemic control (HbA1c).

Sources: [ACOG Practice Bulletin No. 201: Pregestational Diabetes Mellitus (2018)](https://pubmed.ncbi.nlm.nih.gov/30461693/); [FOGSI-GESTOSIS-ICOG Hypertensive Disorders in Pregnancy GCPR 2019](https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf); [MoHFW/PMSMA High risk conditions synopsis](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf)

### cond_hypertension

**Research pass A:** supported — *Chronic hypertension: BP >=140/90 on two readings that predates pregnancy or is present before 20 weeks' gestation.* (suggested level: no change)

The PMSMA list names PIH and pre-eclampsia. Its hypertension section defines chronic hypertension as hypertension that antedates pregnancy or is present before 20 weeks, and notes it can be complicated by superimposed pre-eclampsia. SBA lists 'High blood pressure (hypertension)' as a systemic illness. The sources agree, so keep high.

Sources: [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [Mother and Child Protection Card (2018)](https://nhm.gov.in/New-Update-2022-24/CH-Programmes/HBNC-&-HBYC-Resource-%20Material/Revised-India-MCP-Card-English-(28-05-2018).pdf)

**Research pass B:** supported — *Chronic hypertension: known hypertension, or BP >=140/90 mmHg detected before 20 weeks (FOGSI-GESTOSIS-ICOG 2019; PMSMA). It scores 3 on the FOGSI HDP-Gestosis score, which alone means 'at risk for pre-eclampsia' and calls for aspirin 75-150 mg.* (suggested level: high)

The sources agree; same level as the draft. NICE CG62 lists 'cardiac disease, including hypertension' as needing additional care. NICE NG133 treats chronic hypertension as a high-risk factor for pre-eclampsia and recommends aspirin from 12 weeks. That NG133 point comes from search results only; the NICE site blocked the full text.

Sources: [FOGSI-GESTOSIS-ICOG Hypertensive Disorders in Pregnancy GCPR 2019](https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf); [MoHFW/PMSMA High risk conditions synopsis](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf); [NICE NG133 Hypertension in pregnancy (search-result summary; full text not accessible)](https://www.nice.org.uk/guidance/ng133/chapter/recommendations)

### cond_heart

**Research pass A:** supported — *Known heart disease, recorded as a current or past systemic illness. SBA prompts: breathlessness on exertion, palpitations.* (suggested level: no change)

The PMSMA list does not name heart disease. It falls under the PMSMA catch-all 'any current systemic illness(es)/past history of illness'. SBA and the MCP card name heart disease explicitly. The MCP guidebook says women with a chronic or systemic disease must see a specialist at the FRU. Keep high.

Sources: [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MCP Card Guidebook (MoHFW 2018)](https://nhm.gov.in/New_Updates_2018/NHM_Components/Immunization/Guildelines_for_immunization/MCP_Guide_Book.pdf)

**Research pass B:** supported — *Any known maternal heart disease, followed by risk classification with the modified WHO scale (mWHO 2.0 in ESC 2025), classes I to IV. A Pregnancy Heart Team is mandated for mWHO II-III and above.* (suggested level: high)

A blanket 'high' is reasonable for screening; same level as the draft. However, ESC mWHO class I conditions carry no detectable increase in maternal mortality and at most a mild increase in morbidity, so the obstetrician may downgrade after classifying. Consider recording the mWHO class. NICE CG62 lists cardiac disease; PMSMA covers it through 'current systemic illness'.

Sources: [2018 ESC Guidelines for the management of cardiovascular diseases during pregnancy (Eur Heart J)](https://academic.oup.com/eurheartj/article/39/34/3165/5078465); [ESC guidelines 2025 on cardiovascular disease and pregnancy: considerations and future perspectives (Eur Heart](https://doi.org/10.1093/eurheartjsupp/suag017); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf)

### cond_thyroid

**Research pass A:** supported — *Hypothyroidism, which PMSMA names explicitly. MoHFW defines it in pregnancy as TSH above 2.5 (1st trimester) or above 3 mIU/L (2nd/3rd trimester) with low FT4, or TSH above 10 regardless of FT4. Subclinical hypothyroidism is TSH 2.5–10 with normal FT4. Hyperthyroidism falls under the systemic illness catch-all.* (suggested level: no change)

PMSMA names hypothyroidism, so high is consistent with GoI. The sources differ on acuity: the MoHFW hypothyroidism guideline says uncomplicated cases can deliver at a PHC/CHC under a Medical Officer, and only complicated cases go to an obstetrician. The obstetrician may choose moderate for a euthyroid woman on levothyroxine. The draft's 'thyroid disease' is broader than the named condition.

Sources: [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW National Guidelines for Screening of Hypothyroidism during Pregnancy (2014)](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/National_Guidelines_for_Screening_of_Hypothyroidism_during_Pregnancy.pdf)

**Research pass B:** partly supported — *Hypothyroidism is a named PMSMA high-risk condition (diagnosis uses trimester TSH ranges: 0.1-2.5, 0.2-3, 0.3-3 mIU/L). Per the ATA, adequately treated hypothyroidism adds no obstetric risk. The higher-risk groups are hyperthyroidism/Graves' disease and uncontrolled or untreated hypothyroidism.* (suggested level: moderate)

The sources disagree. PMSMA names hypothyroidism as a high-risk condition, and NICE CG62 lists endocrine disorders, so keeping 'high' matches PMSMA reporting. But the ATA 2017 (strong recommendation) finds no evidence that adequately treated hypothyroidism increases obstetric complications and advises no extra fetal testing. PMSMA itself allows uncomplicated cases to deliver at a PHC/CHC. Suggestion: split the code. Hyperthyroidism/Graves' or uncontrolled thyroid disease becomes 'high'; stable treated hypothyroidism becomes 'moderate'. On the FOGSI HDP score, hypothyroidism adds 2 points toward pre-eclampsia risk.

Sources: [MoHFW/PMSMA High risk conditions synopsis](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [2017 ATA Guidelines for Diagnosis and Management of Thyroid Disease During Pregnancy and the Postpartum (Thyro](https://journals.sagepub.com/doi/full/10.1089/thy.2016.0457); [FOGSI-GESTOSIS-ICOG HDP GCPR 2019](https://icogonline.org/wp-content/uploads/pdf/gcpr/hdp_fogsi_gestosis_icog_gcpr_2019.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf)

### cond_epilepsy

**Research pass A:** supported — *Known epilepsy or a seizure disorder, recorded as a current or past systemic illness. SBA prompt: 'Convulsions (epilepsy)'.* (suggested level: no change)

The PMSMA list does not name epilepsy. It falls under the PMSMA catch-all 'any current systemic illness(es)/past history of illness', and SBA lists 'Convulsions (epilepsy)' as a systemic illness to ask about. GoI sources give no severity grading, so keep high.

Sources: [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf)

**Research pass B:** supported — *Epilepsy that is active or treated with antiepileptic drugs (NICE CG62: 'epilepsy requiring anticonvulsant drugs'). RCOG GTG 68: a woman with a history of epilepsy who is not at high risk of unprovoked seizures can be managed as low risk.* (suggested level: high)

Same level as the draft. RCOG reports about a ten-fold higher risk of death in pregnant women with epilepsy, mostly SUDEP linked to poorly controlled seizures, and recommends joint obstetric-neurology care. Consider a sub-flag: a history of epilepsy, seizure-free and off AEDs, can be low or moderate at the clinician's discretion. PMSMA covers epilepsy only through 'systemic illness'.

Sources: [RCOG Green-top Guideline No. 68: Epilepsy in Pregnancy (2016)](https://www.rcog.org.uk/media/rzldnacf/gtg68_epilepsy.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf)

### cond_anaemia

**Research pass A:** partly supported — *Anaemia in pregnancy is Hb <11 g/dl: mild 10–10.9, moderate 7–9.9, severe <7. Only severe anaemia (Hb <7 g/dl) is a PMSMA high risk condition.* (suggested level: no change)

Moderate is reasonable when Hb is unknown, because PMSMA reserves high risk for Hb <7. The flag should defer to the measured Hb: <7 should be high. Sources differ on bands: the older SBA guideline uses 7–11 as moderate, while PMSMA and Anaemia Mukt Bharat use 10–10.9 mild and 7–9.9 moderate. AMB says Hb 5–6.9 should be treated by an MO with IV iron, and Hb <5 needs immediate hospitalisation. PMSMA says women with Hb <7 at term should deliver at an FRU.

Sources: [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [Anemia Mukt Bharat – Intensified NIPI Operational Guidelines (MoHFW 2018)](https://nhm.gov.in/images/pdf/Nutrition/AMB-guidelines/Anemia-Mukt-Bharat-Operational-Guidelines-FINAL.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf)

**Research pass B:** partly supported — *Anaemia in pregnancy is Hb <11 g/dL (WHO 2024: <11.0 in the 1st and 3rd trimesters, <10.5 in the 2nd; MoHFW: <11). Severity bands: mild 10-10.9, moderate 7-9.9, severe <7 g/dL. The PMSMA high-risk criterion is severe anaemia, Hb <7 g/dL: refer to an FRU and plan delivery at an FRU with blood transfusion.* (suggested level: moderate)

'Moderate' is reasonable when Hb is not recorded; same level as the draft. Recommend capturing Hb and adding a rule Hb <7 g/dL = high. NICE investigates Hb below 11 g/dL at booking and below 10.5 g/dL at 28 weeks. Extended PMSMA tracks 'anaemia' and 'severe anaemia' separately. The FOGSI HDP score gives maternal anaemia 1 point.

Sources: [MoHFW/PMSMA High risk conditions synopsis](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [WHO Guideline on haemoglobin cutoffs to define anaemia in individuals and populations (2024)](https://iris.who.int/server/api/core/bitstreams/f9f74397-1440-478d-a63c-26f29a01552f/content); [Guidance Note for Extended PMSMA for tracking High Risk Pregnancies (NHM)](https://www.nhm.gov.in/New_Update-2022-23/MH/GUIDELINES-%20MH/Guidance_Note-Extended_PMSMA_for_tracking_HRPs.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf)

### cond_tb

**Research pass A:** supported — *Tuberculosis, recorded as a current or past systemic illness. The strongest guidance is for active TB, whether on treatment or diagnosed in pregnancy.* (suggested level: no change)

Keep high. The PMSMA catch-all counts both current and past illness. SBA and the MCP card name tuberculosis. The GoI TB-maternal health framework recommends referral to specialist facilities and delivery at a district hospital or facility with an SNCU. That framework covers active TB. It does not grade past, fully treated TB, so the obstetrician may downgrade a remote, cured case.

Sources: [Collaborative Framework for Management of Tuberculosis in Pregnant Women (CTD & Maternal Health Division, MoHF](https://tbcindia.mohfw.gov.in/wp-content/uploads/2023/05/5156619257Print-ready-version-MH-TB-Framework_Final_Feb-18.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [Mother and Child Protection Card (2018)](https://nhm.gov.in/New-Update-2022-24/CH-Programmes/HBNC-&-HBYC-Resource-%20Material/Revised-India-MCP-Card-English-(28-05-2018).pdf)

**Research pass B:** partly supported — *Active TB disease in the current pregnancy (diagnosed and on, or needing, treatment). These sources do not specifically classify past, fully treated TB as high risk.* (suggested level: high)

Active TB is clearly high risk: MoHFW reports about twice the rate of preterm birth, low birth weight and growth restriction, and about six times the perinatal death rate. WHO says TB contributes 6-15% of maternal mortality. NICE CG62 does not name TB, reflecting a low-prevalence setting. PMSMA's 'current systemic illness / past history of illness' would flag both active and past TB. Suggestion: distinguish active from past treated TB. The level for past TB is clinical judgement (no source found; 'moderate' is a reasonable default).

Sources: [MoHFW Collaborative Framework for Management of Tuberculosis in Pregnant Women (Feb 2021)](https://tbcindia.mohfw.gov.in/wp-content/uploads/2023/05/5156619257Print-ready-version-MH-TB-Framework_Final_Feb-18.pdf); [WHO Global TB Report 2024 - featured topic: TB and pregnancy](https://www.who.int/teams/global-programme-on-tuberculosis-and-lung-health/tb-reports/global-tuberculosis-report-2024/featured-topics/tb-and-pregnancy); [WHO 2016 Recommendations: Antenatal Care for a Positive Pregnancy Experience (summary)](https://www.who.int/docs/default-source/reproductive-health/maternal-health/anc.pdf)

### cond_hiv

**Research pass A:** supported — *HIV positive (PMSMA lists 'Syphilis/HIV Positive' as a high risk condition).* (suggested level: no change)

PMSMA names HIV positive directly, so keep high. SBA also lists HIV-positive women as needing extra nutrition, and HIV testing is a standard ANC test. Consider adding a syphilis-positive rule, because PMSMA puts syphilis on the same line as HIV. NACO PPTCT pages could not be retrieved (connection refused), so they are not cited.

Sources: [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf)

**Research pass B:** supported — *HIV-seropositive. PMSMA lists 'Syphilis/HIV positive' as a high-risk condition; NICE CG62 lists HIV infection as needing additional care.* (suggested level: high)

The sources agree; same level as the draft. WHO ANC recommends routine provider-initiated HIV testing in high-prevalence settings. The Extended PMSMA checklist tracks HIV-seropositive women.

Sources: [MoHFW/PMSMA High risk conditions synopsis](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf); [WHO 2016 Recommendations: Antenatal Care for a Positive Pregnancy Experience (summary)](https://www.who.int/docs/default-source/reproductive-health/maternal-health/anc.pdf)

### cond_hepatitis_b

**Research pass A:** partly supported — *HBsAg positive (chronic hepatitis B carrier). No GoI source found names it on the high risk list itself.* (suggested level: no change)

PMSMA does not name hepatitis B. It can reasonably count under 'current systemic illness', and SBA's systemic illness list includes jaundice. NVHCP requires tracking HBsAg-positive pregnant women to ensure institutional delivery, with a newborn birth-dose vaccine and HBIG. NVHCP also says HBV alone is not an indication for caesarean or termination. High is defensible for delivery planning. For an inactive carrier with normal liver tests, the obstetrician may prefer moderate.

Sources: [NVHCP Technical Guidelines for Diagnosis & Management of Hepatitis B (MoHFW 2019)](https://nvhcp.mohfw.gov.in/common_libs/TechnicalGuidelines-for-Diagnosis-management-of-Hepatitis-B.pdf); [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf)

**Research pass B:** partly supported — *HBsAg-positive. Evaluate HBV DNA and/or HBeAg. WHO 2024 recommends tenofovir prophylaxis when HBV DNA is >=200,000 IU/mL (or HBeAg-positive where DNA testing is unavailable), from the 2nd or 3rd trimester; this detail is from search results. The infant needs the hepatitis B birth dose within 24 h plus HBIG within 12-24 h (NVHCP).* (suggested level: high)

NICE CG62 lists HBV infection alongside HIV as needing additional care. India's NVHCP requires tracking so that every HBV-carrier pregnant woman has an institutional delivery. PMSMA does not name HBV explicitly. The main risk is transmission to the baby rather than maternal or obstetric complications, so 'moderate' is a defensible alternative if the app reserves 'high' for maternal or fetal medical risk. HBV is not in itself an indication for caesarean.

Sources: [NVHCP Technical Guidelines for Diagnosis & Management of Hepatitis B (MoHFW, 2019)](https://nvhcp.mohfw.gov.in/common_libs/TechnicalGuidelines-for-Diagnosis-management-of-Hepatitis-B.pdf); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf); [WHO news: WHO publishes updated guidelines on hepatitis B (March 2024)](https://www.who.int/news/item/29-03-2024-who-publishes-updated-guidelines-on-hepatitis-b)

### cond_asthma

**Research pass A:** partly supported — *Asthma, recorded as a current systemic illness. SBA prompt: 'Attacks of breathlessness or asthma'. GoI sources give no severity or control threshold.* (suggested level: high)

GoI sources treat asthma like the other systemic illnesses. SBA and the MCP card list it next to heart disease, TB and diabetes, and the MCP guidebook sends every chronic or systemic disease to a specialist at the FRU. The PMSMA catch-all would therefore make it high risk, so moderate is lower than the GoI framework. Clinically, mild well-controlled asthma is lower risk, but GoI sources do not make that split. The obstetrician should decide whether to keep moderate for controlled asthma.

Sources: [MoHFW Guidelines for Antenatal Care and Skilled Attendance at Birth by ANMs/LHVs/SNs](https://nhm.gov.in/images/pdf/programmes/maternal-health/guidelines/sba_guidelines_for_skilled_attendance_at_birth.pdf); [Mother and Child Protection Card (2018)](https://nhm.gov.in/New-Update-2022-24/CH-Programmes/HBNC-&-HBYC-Resource-%20Material/Revised-India-MCP-Card-English-(28-05-2018).pdf); [MCP Card Guidebook (MoHFW 2018)](https://nhm.gov.in/New_Updates_2018/NHM_Components/Immunization/Guildelines_for_immunization/MCP_Guide_Book.pdf); [PMSMA – High Risk Conditions in Pregnancy](https://pmsma.mohfw.gov.in/wp-content/uploads/2016/10/High-Risk-Conditions-in-preg-modified-Final.pdf)

**Research pass B:** supported — *Asthma: 'moderate' by default. Severe or poorly controlled asthma should be 'high': NICE CG62 lists 'severe asthma', and ACOG PB 90 advises extra fetal surveillance for moderate-to-severe or poorly controlled asthma.* (suggested level: moderate)

Same level as the draft. ACOG says mild and well-controlled moderate asthma can have excellent outcomes, while severe or poorly controlled asthma is linked to prematurity, pre-eclampsia, growth restriction and maternal morbidity. PMSMA's 'systemic illness' catch-all could technically make any asthma high risk; the NFHS-5 analysis counted chronic respiratory disease, including asthma, as PMSMA high risk. Suggest recording severity/control and a rule 'severe/poorly controlled = high'. ACOG PB 90 dates from 2008.

Sources: [ACOG Practice Bulletin No. 90: Asthma in Pregnancy (2008)](https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2008/02/asthma-in-pregnancy); [NICE CG62 Antenatal care (2008; replaced by NG201)](https://www.pi.nhs.uk/nice/cg62fullguideline.pdf); [Adverse birth outcomes among women with 'low-risk' pregnancies in India (NFHS-5), Lancet Reg Health SE Asia 20](https://doi.org/10.1016/j.lansea.2023.100253)

## Published high-risk factors the app cannot check automatically yet

These need blood-pressure readings, lab results, scan findings or events in the current pregnancy, which come in later features. Until then, doctors must assess them clinically.

**Update, 4 Oct 2026** (see "Next" in `docs/PROGRESS.md`): six of the factors below are now checked – anaemia and blood pressure from the recorded readings, and gestational diabetes, twins, a low-lying placenta and bleeding once a doctor or RMO ticks the finding on the record. Each is marked in the list. The rules are DRAFT. Everything else in the list is still for the doctor to assess.

- **Previous stillbirth or neonatal loss** — MoHFW Maternal Health Division, Guidelines for Ante-natal Care and Skilled Attendance at Birth by ANMs and LHVs (2005), Box 2; PMSMA HRP list ('history of still
- **Bad obstetric history: previous preterm birth, previous baby with congenital malformation, previous obstructed labour** — PMSMA HRP list ('bad obstetric history', 'congenital malformation') per PMC12903710; BOH defined as history of congenital malformation, stillbirth, abortion, pr
- **Previous baby birth weight under 2500 g (low birth weight)** — MoHFW Guidelines for Ante-natal Care and Skilled Attendance at Birth by ANMs and LHVs (2005), Box 2 (matches WHO FANC classifying form)
- **Previous baby birth weight over 4500 g (macrosomia)** — MoHFW Guidelines for Ante-natal Care and Skilled Attendance at Birth by ANMs and LHVs (2005), Box 2
- **Hypertension, pre-eclampsia or eclampsia in a previous pregnancy (hospital admission for it)** — MoHFW SBA/ANC Guidelines (2005) Box 2; FOGSI-GESTOSIS-ICOG HDP GCPR 2019 ('Hypertensive disease during previous pregnancy' = 2)
- **Previous surgery on the reproductive tract other than caesarean (e.g. myomectomy)** — MoHFW SBA/ANC Guidelines (2005) Box 2; WHO FANC classifying form (WHO antenatal care randomized trial manual, 2002)
- **Rh iso-immunisation (sensitisation) in a previous pregnancy, a higher tier than simply being Rh-negative** — MoHFW SBA/ANC Guidelines (2005) Box 2 ('iso-immunization (Rh -ve) in the previous pregnancy')
- **Renal disease / chronic kidney disease** — MoHFW SBA/ANC Guidelines (2005) systemic illness history list; FOGSI-GESTOSIS-ICOG HDP GCPR 2019 ('Maternal chronic kidney disease' = 3); WHO FANC classificatio
- **Autoimmune disease (SLE, antiphospholipid syndrome, rheumatoid arthritis)** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score
- **Inherited or acquired thrombophilia** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score
- **Mental disorders** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score
- **Other pre-existing conditions scored by FOGSI: polycystic ovary syndrome, dyslipidaemia/chronic vascular disease** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score
- **Jaundice/liver disease other than hepatitis B** — MoHFW SBA/ANC Guidelines (2005) systemic illness history list ('jaundice')
- **Any other current systemic illness (e.g. cancer)** — PMSMA HRP list ('history of any current systemic illness(es)') per PMC12903710; WHO FANC classification as reproduced in Open University HEAT Antenatal Care Mod
- **Conception after infertility treatment / assisted reproduction (IVF/ICSI; oocyte donation or surrogacy)** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019; MoHFW SBA/ANC Guidelines (2005) (history of infertility treatment raises the chance of twins)
- **Family history: pre-eclampsia, cardiovascular disease, hypertension, diabetes, TB, thalassaemia, twins, congenital malformation** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019; MoHFW SBA/ANC Guidelines (2005) family history section
- **Birth spacing: short interval between pregnancies, or interval over 7 years** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019 ('Inter pregnancy interval more than 7 years'); Assam study PMC13068423 (inadequate birth spacing, from MoHFW High Risk Condit
- **Tobacco (chewed or smoked) or alcohol use** — MoHFW SBA/ANC Guidelines (2005), history of harmful substances
- **Other FOGSI history items: woman was born small for gestational age; short duration of sperm exposure (cohabitation)** — FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score
- **Severe anaemia (Hb under 7 g/dL); anaemia Hb under 11 g/dL** (checked since 4 Oct 2026, from the lowest Hb of this pregnancy at visits and in reviewed lab results) — PMSMA HRP list ('severe anemia'); Extended PMSMA Guidance Note (MoHFW) monitoring format Section F (anaemia, severe anaemia); Hb<7 per Mumbai study PMC13232776;
- **Pregnancy-induced hypertension / pre-eclampsia / eclampsia (BP 140/90 or higher; diastolic 90 or higher at booking; MAP over 85 in FOGSI score)** (partly checked since 4 Oct 2026: the latest BP at a visit, 140 or more or 90 or more, and the finding 'High blood pressure in this pregnancy' ticked by a doctor or RMO; the MAP score is not checked) — PMSMA HRP list ('pregnancy induced hypertension'); Extended PMSMA Guidance Note Section F; MoHFW SBA/ANC Guidelines (2005) BP section; FOGSI HDP GCPR 2019 (MAP>
- **Gestational diabetes mellitus (current pregnancy)** (checked since 4 Oct 2026, once a doctor or RMO ticks the finding; not read from an OGTT result) — PMSMA HRP list ('gestational diabetes mellitus'); FOGSI HDP GCPR 2019
- **Syphilis seropositivity / RTI or STI** — PMSMA HRP list ('syphilis', 'RTI/STI'); Extended PMSMA Guidance Note Section F
- **Malaria / high fever in pregnancy** — PMSMA HRP list ('malaria', 'high fever') per PMC12903710
- **Twin / multiple pregnancy** (checked since 4 Oct 2026, once a doctor or RMO ticks the finding) — PMSMA HRP list ('twins/multiple pregnancy'); MoHFW SBA/ANC Guidelines (2005); FOGSI HDP GCPR 2019
- **Malpresentation (e.g. breech, transverse lie)** — Extended-PMSMA HRP criteria as cited in Mumbai study (PMC13232776); breech listed in Assam study (PMC13068423)
- **Low-lying placenta / placenta praevia / placental disorders** (low-lying placenta / praevia checked since 4 Oct 2026, once a doctor or RMO ticks the finding; other placental disorders are not) — PMSMA criteria as used in PMSMA-based studies (low-lying placenta or placenta previa); 'placental disorders' per Mumbai study PMC13232776
- **Antepartum haemorrhage / vaginal bleeding in current pregnancy** (checked since 4 Oct 2026, once a doctor or RMO ticks the finding 'Bleeding in this pregnancy') — Mumbai Extended-PMSMA study risk factors (PMC13232776); MoHFW SBA/ANC Guidelines (2005) APH section; WHO FANC classification (vaginal bleeding) as reproduced in
- **Cephalopelvic disproportion** — PMSMA HRP list ('cephalo-pelvic disproportion') per PMC12903710
- **Abnormal fetal heart rate** — PMSMA HRP list ('abnormal fetal heart rate') per PMC12903710
- **Pelvic mass / pelvic growth** — WHO FANC classification for the basic component (pelvic growth) as reproduced in Open University HEAT Antenatal Care Module, Study Session 13; underlying WHO an
- **Excessive weight gain during pregnancy (SBA: over 3 kg in a month)** — MoHFW SBA/ANC Guidelines (2005) weight section; FOGSI HDP GCPR 2019

## Suggestions the research raised for the doctor to decide

- Teenage pregnancy / early primi, age 18-19 (published cut-off is under 20; draft flags only under 18): factor=age; operator=<; value=20; level=high (either raise age_under_18 to under 20, or add age_18_19 for 18 <= age < 20). FOGSI HDP-Gestosis score uses 'younger than 19' (1 point). (PMSMA HRP list ('teenage pregnancy', 'early primi') as quoted in Reproductive Health 2026 qualitative study citing PIB R)
- Severe obesity, BMI over 35 (a higher-risk tier above the draft's BMI 30+ flag): factor=bmi; operator=>; value=35; level=high (escalate from bmi_30_plus; worth 2 points versus 1 point for BMI over 30 in the HDP-Gestosis score) (FOGSI-GESTOSIS-ICOG Hypertensive Disorders in Pregnancy Good Clinical Practice Recommendations 2019, HDP-Gestosis score )
- Primigravida (first pregnancy) as a pre-eclampsia risk factor: factor=gravida; operator===; value=1 (if gravida counts the current pregnancy; otherwise para==0 AND abortions==0); level=low/contributory (1 point in the HDP-Gestosis score; not a stand-alone HRP flag) (FOGSI-GESTOSIS-ICOG HDP GCPR 2019, HDP-Gestosis score (Primigravida = 1 point))
- FOGSI HDP-Gestosis score of 3 or more (at risk of pre-eclampsia; low-dose aspirin 75-150 mg advised), partial score from registration fields: Partial score from available fields only: age>35 (+1), age<19 (+1), cond_anaemia (+1), bmi>30 (+1), gravida==1 (+1), cond_thyroid [hypothyroidism] (+2), bmi>35 (+2, per table), cond_diabetes [pregestational] (+3), cond_h (FOGSI-GESTOSIS-ICOG HDP GCPR 2019 (score items and aspirin advice); threshold of 3 or more per 'Gestosis Score in Antena)
