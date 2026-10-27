# Visits and prescriptions – how they work and what must be checked

Feature 8. Every patient record has a **Visits** tab. A visit has two tabs:

- **Visit details** – vital signs, the pregnancy check (fundal height, fetal heart rate, presentation, movements,
  oedema), the doctor's notes (complaints, examination, diagnosis, tests advised, advice, a private note), the
  next visit, and the care-plan items done at this visit (ticked items are marked done in the care plan).
- **Prescription** – the medicines, typed row by row, and general instructions. It prints in the design the
  doctor chose (10 designs, below).

> ⚠️ **Safety limits – read before any real use.**
> - The app's checks are **limited**. The doctor decides and is responsible for every medicine. (When Feature 8 was
>   built the app checked nothing. Since then the hospital's **Medicine safety** list warns while the prescription
>   is written: recorded allergies and medicines to avoid or use with caution in pregnancy since 30 Sep 2026; the
>   usual maximum doses, medicines while breastfeeding and medicines for newborn babies were built on 4 Oct 2026 –
>   see Next in `docs/PROGRESS.md`.)
> - The **dose check** only compares what is typed with the usual maximum on that list. It stays silent for a
>   combined medicine, a strength without a unit, a dose in words or drops, a cream, an injection with no dose
>   written, and any medicine not on the list. No warning does not mean the dose is right. There is still **no
>   general check of drug interactions** (only the few combinations on the list, for pregnant patients).
> - The list is a **draft** until a doctor approves it (Clinic library → Clinical rules → Medicine safety). A
>   warning never blocks saving; an Avoid or Allergy warning asks for a one-line reason.
> - The ready-made prescription sets are drafts until a doctor approves them (below), and even then only a starting
>   point: the doctor who writes the prescription checks it.
> - The list of about 70 common OBGY medicines (`client/src/pages/visits/medicines.js`) only makes typing quicker.
>   It is **not a formulary**: it holds generic names, forms and strengths, no doses. Brand names can be typed.
> - The Marathi and Hindi words printed under the English instructions were written by the software developer
>   (Claude) and have **not** been checked by fluent speakers – see the list below.
> - Fake data only until the app has been reviewed for real use.

## Who can do what

| Person | Vital signs | Notes, pregnancy check, next visit, care-plan ticks | Prescription | Private note | Print |
| --- | --- | --- | --- | --- | --- |
| The patient's doctor (or any doctor, when no doctor is assigned) | write | write | write | read and write | yes |
| RMO (all patients, also sensitive records) | write | write | write | read and write | yes |
| Another doctor | read | read | read | read (not on sensitive records) | yes |
| Nurse | write (not on sensitive records) | read | read | – | yes |
| Receptionist, lab staff | no Visits tab | | | | |

- A nurse or a doctor starts a visit (**New visit**, or **Open today's visit** if one exists). Each part saves on
  its own; if someone else saved the same part meanwhile, nothing is lost silently: the page says who saved it
  and when, and shows their version.
- **Entered in error** (doctor or RMO, with a reason) keeps the visit but greys it out; it no longer prints.
- The **private note** is never printed and never shown to nurses.
- Words that could reveal the sex of the fetus are refused in every free-text box (PC&PNDT Act); a newborn's
  record is the exception.

## Printing and PDFs

- **Print or share** (at the top of a visit, and next to Save on both tabs) prints the visit as saved. It is
  **signed by the doctor who wrote it** – whoever saved the prescription, or else whoever wrote the doctor's notes
  – and printed in that doctor's design, whoever presses Print. Until a doctor or RMO has saved one of the two,
  there is nothing to print. Unsaved changes are saved first (the button then reads **Save and print**; if
  something must be fixed, the tab shows what and nothing is printed), so the paper always matches the record.
- **Prescription or visit summary.** When no medicines were given, the printout is the **visit summary**: the same
  page in the same design, titled "Visit summary", with the vital signs, findings, diagnosis, tests, advice and
  the next visit – without the medicines and their instructions. When medicines were given, the preview offers
  both (the summary e.g. for the patient's file). What prints follows the doctor's "What to print" choices; the
  private note never prints.
- **Fits the page.** The preview says how many pages it prints on. When that saves a page, it fits the page more
  closely – first the parts closer together, then the text about 6% smaller – and says so. A long "Due by your
  next visit" list is printed in two columns. A page never ends in the middle of a line, a medicine or the
  next-visit box.
- **PDF.** **Download PDF** saves the printout as a PDF file (A4 or A5, as printed) in the computer's Downloads
  folder, named with the patient number and date (never the name), e.g. "Prescription P-000002 29 Sep 2026.pdf".
  Where the browser can hand files to other apps (e.g. Chrome on Windows), **Share PDF…** opens the computer's
  share window (WhatsApp, e-mail …). The PDF is made on the computer itself – nothing is sent to any service – so
  it can be sent to the patient, or to reception to print when the printer in the doctor's room is not working.
- **Send on WhatsApp** (when the patient's record has a mobile number) saves the PDF and opens WhatsApp – the app
  on the computer or WhatsApp Web – with a chat to that number (WhatsApp's own "click to chat" link, wa.me, with
  nothing but the number in it). The doctor attaches the PDF from the Downloads folder (paperclip → Document),
  checks it is the right patient and presses Send. A website can't put the file into the chat by itself: sending
  it in one click from the hospital's own number needs Meta's WhatsApp Business Platform (a hospital number
  registered with Meta, Meta's business verification and approval of the message wording, a charge per message,
  the patient's recorded agreement, and the PDF passing through Meta's servers) – to plan after the app has been
  reviewed. It sends from whichever WhatsApp is on that computer: a hospital number is better than a personal one.
  Unofficial tools that remote-control a personal WhatsApp are not used (WhatsApp forbids them).
- **Send on WhatsApp now** (added 4 Oct 2026) sends the PDF in one click from the hospital's own WhatsApp Business
  number, through Meta's WhatsApp Business Platform. It appears instead of *Send on WhatsApp* only when: `WHATSAPP_MODE`
  is set in `server/.env` (`practice` pretends to send; `live` sends for real with the phone number id and access token
  from Meta), the hospital admin switched it on (Hospital admin → Patient messages), and the patient agreed to WhatsApp
  messages. It asks once, shows the number on her record, and goes nowhere else. Live mode needs a message template
  approved by Meta with a DOCUMENT header and a body with one variable (the hospital's name), for example: "Your
  document from {{1}} is attached. Please call the hospital if you have any questions." ⚠️ In live mode the PDF passes
  through Meta's servers: use it for real patients only after the app has been reviewed.
  ⚠️ Once sent (e.g. on WhatsApp), a PDF is outside Perinexa's protection: send it only to the patient's own
  number or to the hospital's staff, and delete it from a shared computer after sending. Use made-up patients only
  until the app has been reviewed.
- "Due by your next visit" lists the care-plan tests, scans, injections and medicines whose time starts before the
  next visit (or within 4 weeks when no next visit is set). **Overdue items are not printed**: the preview says how
  many were left out, and the doctor writes any still needed under *Tests advised*.
- Every page repeats a footer with the patient's name and number and who printed it when. When a long
  prescription runs onto a second page, the signature always goes over with the block before it – it never
  stands alone on a page.
- Each printout and PDF is recorded in the audit log – "Prescription printed", "Prescription saved as PDF", "Visit
  summary printed", "Visit summary saved as PDF" (record numbers only, never medicines); "– to send on WhatsApp"
  when it was saved for WhatsApp (never the phone number). A PDF shared from the share window is recorded when it
  has been shared.

## The 10 designs (My account → Prescription design)

Each doctor chooses one and makes it their own; each hospital keeps each doctor's design separately.

| Design | What it looks like |
| --- | --- |
| Classic Rx pad | The doctor's name and degrees on the left, the clinic on the right, a large ℞ and a numbered list – the pad most Indian doctors use. |
| Hospital letterhead | The hospital's name centred at the top, the doctor under it and the patient's details in a box – formal, for hospitals. |
| Two columns | Complaints, findings, tests and diagnosis in a narrow left column; the medicines on the right. |
| Medicine table | Every medicine in a table – dose, how often, when and how long. Clear for patients and chemists. |
| Dose chart with symbols | Morning, afternoon, evening and night columns with sun and moon symbols – for patients who don't read well. |
| Side band | A coloured band down the left side with the doctor's details, specialities and clinic timings. |
| Pregnancy card | A pregnancy box (LMP, EDD, weeks, G P L A, blood group, risk), the pregnancy check, and what is due by the next visit. |
| Your own printed pad | Only the patient's details and the prescription, leaving blank space (top and bottom margins in mm) for the header and footer already printed on the pad. |
| Half page (A5) | Everything on half a sheet – for short prescriptions. |
| Modern minimal | Clean lines and plenty of space, with each medicine's dose in chips. |

What the doctor can change: colour (Indigo, Teal, Maroon, Green, Charcoal), text size (standard or large), paper
(A4 or A5), the language of the instructions (English only, English + Marathi, English + Hindi), medicine names in
CAPITALS, which parts print (vital signs, complaints, findings, diagnosis, tests, advice, next visit, care-plan
items, pregnancy summary, signature block, the ℞ symbol), specialities, clinic timings, and a footer note.

### Before real use, the hospital should check
1. **Registration number.** Indian rules for doctors (the Indian Medical Council (Professional Conduct, Etiquette
   and Ethics) Regulations, 2002, as amended) ask for the doctor's registration number on every prescription and
   for generic names written legibly, preferably in capitals. The app prints the number from My account →
   Professional details and warns when it is missing; "CAPITALS" is on by default. Please confirm the current rules.
2. **A printed pad** – print one test page on the real pad and adjust the top and bottom margins.
3. **The Marathi and Hindi words** below.

## Ready-made prescription sets (Feature 8b)

A **prescription set** is a ready-made prescription for a common situation – the medicines with their doses,
general instructions, tests advised and advice. On a visit's **Prescription** tab, **Add a ready-made set** shows
the sets (those for the patient's type of care first), what each one adds, and adds the chosen one with one click
(Abortion – pregnancy loss, added 2 Oct 2026 – has no built-in sets: a doctor saves their own and ticks Abortion;
four DRAFT built-in sets for it were added in October 2026 – see the end of the list below):

- its medicines go on the prescription – a medicine already there (same name and form) is **replaced in its place
  by the set's version**, the others are added at the end;
- its general instructions are added under the medicines, and its tests and advice to **Visit details**;
- **nothing is saved** until the doctor has checked and changed what is needed and saved both tabs. The saved
  prescription is the doctor's own; later changes to the set never change it.

The library is under **Prescription sets** in the left menu (doctors and RMOs). Doctors add sets (**New set**, or
**Save as a set** on the Prescription tab from what is on screen), copy, edit, **approve** and **stop using** them;
RMOs use them. Every change makes a set a draft again; sets are never deleted. A set is shared by the whole
hospital, so it must hold nothing about one patient. Each change is in the audit log (the set's name and version).

> ⚠️ The 12 built-in sets below (16 since October 2026, with the 4 for pregnancy-loss care) are **drafts written by
> the software developer (Claude)** from published guidance –
> **no doctor has checked them**. Each is marked *Draft* in the library and when it is added to a prescription,
> until a doctor has checked every medicine, strength, dose, duration and instruction and approves it. Points to
> decide in particular: folic acid 400 mcg or 5 mg; aspirin 75 or 150 mg and until 36 weeks or birth; the
> antibiotic for urinary infection in pregnancy; doxylamine–pyridoxine 1 or 2 tablets at bedtime; metformin in
> PCOS; antibiotics after a caesarean (none included). For the pregnancy-loss sets: mifepristone before
> misoprostol for a missed miscarriage (not included – NICE adds it, FIGO does not); the misoprostol route and the
> second dose; iron for 3 months after every loss or only when the haemoglobin is low; no antibiotic after an
> evacuation. The advice is in English; write it in Marathi or Hindi in your own copy if your patients need that.

### The built-in draft sets

#### First trimester – routine care (Antenatal)
- **Tab. Folic acid 400 mcg** – 1 tab · 1-0-0 (morning) · after food – *Until 12 weeks of pregnancy*
- Advice: Eat small, frequent meals and drink plenty of water. Rest well and avoid heavy lifting. Do not take any other medicine without asking us. Come at once for bleeding, severe pain in the abdomen, fever, or vomiting that does not stop.
- Notes for doctors: Folic acid 400 mcg a day until 12 weeks (MoHFW and WHO antenatal care guidance); 5 mg for women at higher risk of a neural tube defect (a previous affected pregnancy, diabetes, epilepsy on treatment, obesity). The booking tests and the dating scan come from the care plan and print under the next visit.

#### Second and third trimester – routine care (Antenatal)
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 0-1-0 (afternoon) · after food · till delivery
- **Tab. Calcium carbonate + vitamin D3 500 mg + 250 IU** – 1 tab · 1-0-1 (morning and night) · after food · till delivery
- General instructions: Take the iron and the calcium at least 2 hours apart. Do not take them with tea, coffee or milk.
- Advice: Eat a balanced diet every day with green leafy vegetables, pulses, fruit and milk. From 28 weeks, notice your baby's movements every day. Come at once for bleeding, leaking of water, severe headache, blurred vision, swelling of the face or hands, or if the baby moves less than usual.
- Notes for doctors: MoHFW: one IFA tablet (60 mg elemental iron + 500 mcg folic acid) a day from 14–16 weeks for at least 180 days, and calcium 500 mg twice a day from 14 weeks. Albendazole 400 mg once in the second trimester is in the care plan – add it on the day it is given.

#### Nausea and vomiting in pregnancy (mild) (Antenatal)
- **Tab. Doxylamine + pyridoxine 10 mg + 10 mg** – 2 tab · 0-0-1 (night) · at bedtime · for 10 days – *May cause drowsiness*
- Advice: Eat small, dry meals every 2–3 hours (for example biscuits, toast or khakhra) and avoid oily and spicy food. Sip water, coconut water or ORS through the day. Come at once if you cannot keep fluids down, pass very little urine, or feel dizzy or faint.
- Notes for doctors: Doxylamine with pyridoxine is the usual first choice (ACOG). Labelled dose: 2 tablets at bedtime, up to 4 a day (1 in the morning, 1 in the afternoon, 2 at bedtime) if needed. Admit or refer if she is dehydrated or losing weight (hyperemesis).

#### Anaemia in pregnancy (mild to moderate) (Antenatal)
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 1-0-1 (morning and night) · after food · for 3 months – *Not with tea, coffee or milk*
- General instructions: Take the iron with water or lemon juice. Black stools are normal with iron tablets.
- Tests advised: CBC with peripheral smear. Repeat haemoglobin after 4 weeks.
- Advice: Eat iron-rich food every day: green leafy vegetables, jaggery, dates, pulses, and meat, fish or eggs if you eat them. Have lemon, amla or orange with your meals. Come at once for breathlessness, a racing heart or extreme tiredness.
- Notes for doctors: MoHFW (Anemia Mukt Bharat): mild to moderate anaemia in pregnancy (Hb 7–10.9 g/dL) – 2 IFA tablets a day, and repeat the haemoglobin after a month. Severe anaemia (Hb below 7 g/dL) needs referral and treatment by protocol (IV iron or transfusion). Give albendazole if it was not given in the second trimester.

#### Pre-eclampsia prevention (high risk) (Antenatal)
- **Tab. Aspirin (low dose) 150 mg** – 1 tab · 0-0-1 (night) · after food · till delivery – *Stop at 36 weeks unless told otherwise*
- **Tab. Calcium carbonate + vitamin D3 500 mg + 250 IU** – 1 tab · 1-0-1 (morning and night) · after food · till delivery
- Advice: Check your blood pressure every week, at home or at a clinic, and bring the readings. Come at once for severe headache, blurred vision, pain in the upper abdomen, swelling of the face or hands, or if the baby moves less than usual.
- Notes for doctors: For women at high risk of pre-eclampsia (previous pre-eclampsia, chronic hypertension, diabetes, kidney or autoimmune disease, twins – or several moderate risks): aspirin at night from 12–16 weeks, usually until 36 weeks (NICE continues until birth). Doses in guidance range from 75 to 150 mg (FOGSI, ISSHP, NICE); the ASPRE trial used 150 mg. Calcium 1 g a day (MoHFW).

#### Urinary infection in pregnancy (cystitis) (Antenatal)
- **Cap. Cephalexin 500 mg** – 1 cap · 1-0-1 (morning and night) · after food · for 7 days – *Complete the full course*
- General instructions: Drink 2–3 litres of water a day.
- Tests advised: Urine routine and culture – send before the first dose.
- Advice: Do not hold urine for long. Come at once for fever with chills, pain in the back or side, vomiting, or pains like contractions.
- Notes for doctors: NICE NG109 (urinary infection in pregnancy): nitrofurantoin 100 mg modified-release twice a day for 7 days (avoid near term) is the first choice; amoxicillin or cephalexin 500 mg twice a day for 7 days when the culture shows the germ is sensitive. Change to suit the culture report. Fever or loin pain means pyelonephritis – admit.

#### After normal delivery (at discharge) (Postnatal)
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 0-1-0 (afternoon) · after food · for 6 months
- **Tab. Calcium carbonate + vitamin D3 500 mg + 250 IU** – 1 tab · 1-0-1 (morning and night) · after food · for 6 months
- **Tab. Paracetamol 500 mg** – 1 tab · only when needed · after food · for 5 days – *For pain – at least 6 hours apart*
- General instructions: Take the iron and the calcium at least 2 hours apart.
- Advice: Breastfeed your baby often, day and night – only breast milk for 6 months. Keep the stitches clean and dry, and wash after using the toilet. Eat well and drink plenty of fluids. Come at once for fever, heavy bleeding or clots, foul-smelling discharge, painful swollen breasts, severe headache, or pain or swelling in the legs. We will talk about family planning at your 6-week check-up.
- Notes for doctors: MoHFW: IFA (one tablet a day) and calcium (500 mg twice a day) for 180 days after delivery. Paracetamol is compatible with breastfeeding.

#### After caesarean section (at discharge) (Postnatal)
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 0-1-0 (afternoon) · after food · for 6 months
- **Tab. Calcium carbonate + vitamin D3 500 mg + 250 IU** – 1 tab · 1-0-1 (morning and night) · after food · for 6 months
- **Tab. Paracetamol 500 mg** – 1 tab · 1-1-1 (morning, afternoon and night) · after food · for 5 days – *For pain*
- **Syp. Lactulose** – 15 ml · 0-0-1 (night) · at bedtime · for 7 days – *For soft stools*
- General instructions: Take the iron and the calcium at least 2 hours apart.
- Advice: Keep the wound clean and dry. Walk a little several times a day and drink plenty of fluids. Do not lift anything heavy for 6 weeks. Breastfeed your baby often. Come at once for fever, redness, pain or discharge from the wound, heavy bleeding, pain or swelling in the legs, or breathlessness.
- Notes for doctors: No antibiotics are included – add them only if the hospital's protocol gives them after discharge. Set the next visit for the wound check. MoHFW: IFA and calcium for 180 days after delivery.

#### PCOS – first visit (tests, lifestyle, metformin) (Infertility, Gynaecology)
- **Tab. Metformin 500 mg** – 1 tab · 0-0-1 (night) · with food · for 1 month – *With dinner. Your doctor may increase the dose slowly.*
- Tests advised: Ultrasound pelvis (transvaginal if suitable). TSH, prolactin. Fasting blood sugar and 2-hour 75 g OGTT. Lipid profile.
- Advice: Aim for at least 150 minutes of exercise a week – for example a brisk 30-minute walk on 5 days. Eat regular meals with vegetables, pulses and whole grains; cut down sugar, sweets, fried food and sweet drinks. Losing even 5–10% of your weight can bring your periods back.
- Notes for doctors: International PCOS guideline (2023): lifestyle first; metformin with lifestyle for adults with a BMI of 25 or more (start with 500 mg with dinner and increase slowly); a combined pill is the first choice for irregular cycles or excess hair – add one if there is no contraindication. Consider 17-OH progesterone if congenital adrenal hyperplasia is possible.

#### Vaginal thrush (candidiasis) (Antenatal, Gynaecology)
- **Pessary Clotrimazole 100 mg** – 1 pessary · 0-0-1 (night) · at bedtime · for 7 days · in the vagina – *Insert high in the vagina at bedtime*
- **Cream Clotrimazole 1%** – 1-0-1 (morning and night) · for 7 days · apply on the skin – *On the outer skin for itching*
- Advice: Wear loose cotton underwear and keep the area dry. Do not use soap, douches or vaginal washes inside. Avoid intercourse until the course is finished, or use a condom. Come back if it is not better in a week, or if it keeps coming back.
- Notes for doctors: Clotrimazole 100 mg pessary at night for 7 nights also suits pregnancy (no oral fluconazole in pregnancy). Outside pregnancy a single 500 mg pessary or fluconazole 150 mg once are alternatives. Check the blood sugar if thrush keeps coming back.

#### Painful periods (primary dysmenorrhoea) (Gynaecology)
- **Tab. Mefenamic acid 500 mg** – 1 tab · 1-1-1 (morning, afternoon and night) · after food · for 3 days – *Start when the pain or bleeding starts*
- Advice: A hot water bag on the lower abdomen and regular exercise help. Come back if the pain is not relieved, gets worse each month, or comes with heavy bleeding, fever or pain at other times.
- Notes for doctors: Anti-inflammatory painkillers are the first choice for primary dysmenorrhoea; avoid them with a peptic ulcer, kidney disease or asthma made worse by such painkillers. Consider an ultrasound (endometriosis, adenomyosis, fibroids) if the pain is new, severe or not relieved.

#### Heavy periods (while bleeding) (Gynaecology)
- **Tab. Tranexamic acid 500 mg** – 2 tab · 1-1-1 (morning, afternoon and night) · after food · for 4 days – *Only on the heavy days of the period*
- **Tab. Ferrous ascorbate + folic acid 100 mg + 1.5 mg** – 1 tab · 0-1-0 (afternoon) · after food · for 3 months
- Tests advised: CBC. TSH. Ultrasound pelvis.
- Advice: Keep a note of how many pads you use each day. Come at once if you soak a pad every hour for more than 2 hours, pass large clots, or feel faint or breathless.
- Notes for doctors: NICE NG88: tranexamic acid 1 g three times a day for up to 4 days while bleeding is heavy; do not use it after a thrombosis. Rule out pregnancy; take an endometrial sample when indicated (for example at 45 or older when treatment fails, or with persistent bleeding between periods).

### Fertility – ovulation induction and IUI (fertility idea F6, added 27 Oct 2026)
Drafts from the approved fertility protocol library (`server/src/fertility/protocols.js`), starting doses of its
"usual regimen" lines – every dose is the doctor's to confirm before approving the set. Infertility type of care only.

#### Ovulation induction – letrozole (one cycle) (Infertility)
- **Tab. Letrozole 2.5 mg** – 1 tab · 1-0-0 (morning) · after food · for 5 days – *From day 2 of the period, for 5 days*
- **Tab. Folic acid 400 mcg** – 1 tab · 1-0-0 (morning) · after food · for 3 months
- Tests advised: Follicular study (transvaginal scan) from day 9–10 of the cycle, as advised.
- Notes for doctors: 2.5 mg, then 5 mg and 7.5 mg in later cycles if no ovulation; off-label in India – check the CDSCO position and take written consent.

#### Ovulation induction – clomiphene (one cycle) (Infertility)
- **Tab. Clomiphene citrate 50 mg** – 1 tab · 1-0-0 (morning) · after food · for 5 days – *From day 2 of the period, for 5 days*
- **Tab. Folic acid 400 mcg** – 1 tab · 1-0-0 (morning) · after food · for 3 months
- Tests advised: Follicular study from day 9–10.
- Notes for doctors: 50 mg, then 100 mg and 150 mg; not beyond six ovulatory cycles; stop for visual symptoms.

#### Ovulation trigger (hCG) (Infertility)
- **Inj. hCG 5,000 IU** – once, IM, at the time written by the doctor
- Tests advised: Urine pregnancy test 14 days after the injection if the period has not come.
- Notes for doctors: 5,000–10,000 IU (or 250 micrograms recombinant) when the lead follicle is 18 mm or more; withhold and cancel when more than 2 follicles reach 14 mm.

#### Luteal support – vaginal progesterone (Infertility)
- **Cap. Progesterone (micronised) 200 mg** – 1 · 1-0-1 · vaginal · for 14 days – *From the day after the trigger or IUI*
- Tests advised: Urine pregnancy test 14 days after the trigger or IUI.
- Notes for doctors: 200–400 mg daily where chosen; optional in OI and IUI cycles.

### Pregnancy-loss care (added in October 2026 – see `docs/PROGRESS.md`, Next)
Only for a loss that has already happened or been diagnosed – never for ending a continuing pregnancy. Left out on
purpose: methotrexate for an ectopic pregnancy (a specialist protocol, RCOG Green-top Guideline 21) and a threatened
miscarriage (a continuing pregnancy, cared for under Antenatal). Chosen for a patient of another type of care, a set
shows a warning but is not blocked. The words a patient reads never name the loss.

#### Complete miscarriage – after the loss (Abortion – pregnancy loss)
- **Tab. Paracetamol 500 mg** – 2 tab · only when needed · after food · for 3 days – *For pain – at least 6 hours apart, at most 4 times a day*
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 0-1-0 (afternoon) · after food · for 3 months – *Not with tea, coffee or milk*
- Tests advised: Haemoglobin, if the bleeding was heavy. Urine pregnancy test after 3 weeks, if the doctor advises it.
- Advice: Some bleeding, like a period, and mild cramps can go on for up to 2 weeks. Use pads, not tampons, until the bleeding stops. Come at once for heavy bleeding (soaking 2 pads an hour for 2 hours), large clots, fever, a smelly discharge, severe pain in the abdomen, or feeling faint or dizzy. You can become pregnant again even before your next period: use contraception if you do not want a pregnancy now. Feeling sad or low afterwards is common – please talk to us about it.
- Notes for doctors: For a miscarriage that is already complete – nothing in this set ends a pregnancy. NICE NG126 (2019, updated 2023): a complete miscarriage needs no medicine to empty the uterus; anti-D is not needed after a complete miscarriage (record the answer under Pregnancy loss). When it was not confirmed on a scan, a urine pregnancy test after 3 weeks checks that it is complete (doctor to decide). Iron for 3 months after blood loss is common practice, not a NICE recommendation: check the haemoglobin and treat anaemia by the hospital's protocol (Anemia Mukt Bharat). Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist protocol with strict criteria (RCOG Green-top Guideline 21). Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).

#### Missed miscarriage (diagnosed) – medical management with misoprostol (Abortion – pregnancy loss)
- **Tab. Misoprostol 200 mcg** – 4 tab · One dose; a second after 3 hours only if told · in the vagina – *Place all 4 tablets high in the vagina, then lie down for 30 minutes*
- **Tab. Ibuprofen 400 mg** – 1 tab · only when needed · after food · for 3 days – *For cramps – after food, at most 3 times a day*
- **Tab. Paracetamol 500 mg** – 2 tab · only when needed · after food · for 3 days – *For pain – at least 6 hours apart, at most 4 times a day*
- General instructions: Bleeding and cramps usually start within a few hours of the tablets, and the bleeding can be heavier than a period. Nausea, loose motions, shivering or a mild fever on that day are common.
- Tests advised: Urine pregnancy test 3 weeks after the tablets – come back if it is still positive.
- Advice: Have someone with you on the day you take the tablets. Use pads, not tampons, until the bleeding stops. Call us if no bleeding has started within 48 hours. Come at once for heavy bleeding (soaking 2 pads an hour for 2 hours), large clots, fever, a smelly discharge, severe pain in the abdomen, or feeling faint or dizzy. You can become pregnant again even before your next period: use contraception if you do not want a pregnancy now. Feeling sad or low afterwards is common – please talk to us about it.
- Notes for doctors: FOR A MISCARRIAGE ALREADY DIAGNOSED – NOT FOR ENDING A CONTINUING PREGNANCY. Only when a scan has confirmed a missed miscarriage under 13 weeks (NICE NG126 criteria). Misoprostol 800 mcg: NICE NG126 (2019, updated 2023) gives 800 mcg vaginally, by mouth or under the tongue 48 hours after mifepristone 200 mg by mouth – add the mifepristone if the hospital uses it; FIGO 2017 (misoprostol alone, under 13 weeks): 800 mcg vaginally or 600 mcg under the tongue every 3 hours, 2 doses. From 13 weeks the doses differ. NICE: offer pain relief and anti-emetics as needed, and a urine pregnancy test after 3 weeks; no anti-D after medical management alone. Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist protocol with strict criteria (RCOG Green-top Guideline 21). Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).

#### Incomplete miscarriage (diagnosed) – medical management with misoprostol (Abortion – pregnancy loss)
- **Tab. Misoprostol 200 mcg** – 3 tab · Once only – *Swallow all 3 tablets together*
- **Tab. Ibuprofen 400 mg** – 1 tab · only when needed · after food · for 3 days – *For cramps – after food, at most 3 times a day*
- **Tab. Paracetamol 500 mg** – 2 tab · only when needed · after food · for 3 days – *For pain – at least 6 hours apart, at most 4 times a day*
- General instructions: Bleeding and cramps usually start within a few hours of the tablets, and the bleeding can be heavier than a period. Nausea, loose motions, shivering or a mild fever on that day are common.
- Tests advised: Urine pregnancy test 3 weeks after the tablets – come back if it is still positive.
- Advice: Have someone with you on the day you take the tablets. Use pads, not tampons, until the bleeding stops. Call us if no bleeding has started within 48 hours. Come at once for heavy bleeding (soaking 2 pads an hour for 2 hours), large clots, fever, a smelly discharge, severe pain in the abdomen, or feeling faint or dizzy. You can become pregnant again even before your next period: use contraception if you do not want a pregnancy now. Feeling sad or low afterwards is common – please talk to us about it.
- Notes for doctors: FOR A MISCARRIAGE ALREADY DIAGNOSED – NOT FOR ENDING A CONTINUING PREGNANCY. For an incomplete miscarriage under 13 weeks without heavy bleeding or signs of infection – those need surgical evacuation or the hospital's protocol at once. Misoprostol 600 mcg once: NICE NG126 (2019, updated 2023) – vaginally, by mouth or under the tongue, without mifepristone; FIGO 2017 – 600 mcg by mouth or 400 mcg under the tongue once, or 400–800 mcg vaginally once. NICE: offer pain relief and anti-emetics as needed, and a urine pregnancy test after 3 weeks; no anti-D after medical management alone. Methotrexate for an ectopic pregnancy has no set, on purpose: it is a specialist protocol with strict criteria (RCOG Green-top Guideline 21). Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).

#### After surgical evacuation for a miscarriage (at discharge) (Abortion – pregnancy loss)
- **Tab. Paracetamol 500 mg** – 2 tab · only when needed · after food · for 3 days – *For pain – at least 6 hours apart, at most 4 times a day*
- **Tab. Iron + folic acid (IFA) 60 mg + 500 mcg** – 1 tab · 0-1-0 (afternoon) · after food · for 3 months – *Not with tea, coffee or milk*
- Tests advised: Report of the tissue sent to the laboratory (histopathology) – to be seen at the follow-up visit.
- Advice: Light bleeding or spotting for up to 2 weeks is normal. Use pads, not tampons, and avoid intercourse until the bleeding stops. Come at once for heavy bleeding (soaking 2 pads an hour for 2 hours), large clots, fever, a smelly discharge, severe pain in the abdomen, or feeling faint or dizzy. You can become pregnant again even before your next period: use contraception if you do not want a pregnancy now. Feeling sad or low afterwards is common – please talk to us about it. Come for your follow-up visit in 1–2 weeks.
- Notes for doctors: After vacuum aspiration (manual or electric) or evacuation under anaesthesia for a miscarriage – nothing in this set ends a pregnancy. No antibiotic: NICE NG126 has no recommendation for antibiotics after surgical management of a miscarriage, and the AIMS trial (Lancet 2019) found that routine prophylaxis before miscarriage surgery did not clearly reduce pelvic infection. Where the hospital gives prophylaxis, it is one dose before the procedure, not a course at discharge; treat an infection by the hospital's protocol. Anti-D: NICE NG126 gives it to a Rh-negative woman after a surgical procedure (record it under Pregnancy loss). Iron after blood loss is common practice, not a NICE recommendation – check the haemoglobin. After a molar pregnancy the hCG follow-up is in the care plan. Every medicine and dose is for the doctor to check (paracetamol 1 g is for an adult over 50 kg).

## Marathi and Hindi words to check

The English is always printed; the Marathi or Hindi goes under it (or next to it in the tables). Source:
`client/src/pages/visits/rxFormat.js`.

| English | Marathi | Hindi |
| --- | --- | --- |
| **How often** | | |
| morning (1-0-0) | सकाळी | सुबह |
| afternoon (0-1-0) | दुपारी | दोपहर |
| night (0-0-1) | रात्री | रात |
| morning and night (1-0-1) | सकाळी व रात्री | सुबह और रात |
| morning, afternoon and night (1-1-1) | सकाळी, दुपारी व रात्री | सुबह, दोपहर और रात |
| four times a day (1-1-1-1) | दिवसातून चार वेळा | दिन में चार बार |
| only when needed (SOS) | गरज असेल तेव्हाच | ज़रूरत होने पर ही |
| once, now (STAT) | एकदाच, लगेच | एक बार, तुरंत |
| once a week | आठवड्यातून एकदा | सप्ताह में एक बार |
| every other day | एक दिवसाआड | एक दिन छोड़कर |
| **When** | | |
| after food | जेवणानंतर | खाना खाने के बाद |
| before food | जेवणापूर्वी | खाना खाने से पहले |
| with food | जेवणासोबत | खाने के साथ |
| on an empty stomach | उपाशीपोटी | खाली पेट |
| at bedtime | झोपताना | सोते समय |
| **How long** | | |
| for 5 days / 1 week / 2 weeks | 5 दिवस / 1 आठवडा / 2 आठवडे | 5 दिन तक / 1 सप्ताह तक |
| for 1 month / 3 months | 1 महिना / 3 महिने | 1 महीने तक / 3 महीने तक |
| (in the table and dose chart) 1 month | 1 महिना | 1 महीना |
| till delivery | प्रसूतीपर्यंत | प्रसव तक |
| continue until told to stop | पुढील सूचनेपर्यंत चालू ठेवा | अगली सलाह तक जारी रखें |
| **Dose** | | |
| 1 tab / 1 cap | 1 गोळी / 1 कॅप्सूल | 1 गोली / 1 कैप्सूल |
| 10 ml (syrup, suspension) | 10 मिली | 10 मिली |
| 2 drops | 2 थेंब | 2 बूंद |
| 1 sachet | 1 पाकीट | 1 पाउच |
| pessary, suppository | गोळी | गोली |
| spray, puff (inhaler) | स्प्रे, पफ | स्प्रे, पफ |
| **Route** (printed when not by mouth) | | |
| in the vagina | योनीमार्गात | योनि में |
| in the rectum | गुदद्वारात | गुदा में |
| injection in the muscle (IM) | स्नायूत इंजेक्शन (IM) | मांसपेशी में इंजेक्शन (IM) |
| into a vein (IV) | शिरेतून (IV) | नस में (IV) |
| injection under the skin (SC) | त्वचेखाली इंजेक्शन (SC) | त्वचा के नीचे इंजेक्शन (SC) |
| under the tongue | जिभेखाली | जीभ के नीचे |
| apply on the skin | त्वचेवर लावा | त्वचा पर लगाएँ |
| **Headings** | | |
| Medicines / Medicine | औषधे / औषध | दवाइयाँ / दवा |
| Dose | मात्रा | खुराक |
| How often | किती वेळा | कितनी बार |
| Food | जेवण | खाना |
| How long | किती दिवस | कितने दिन |
| Morning / Afternoon / Evening / Night (dose chart) | सकाळी / दुपारी / संध्याकाळी / रात्री | सुबह / दोपहर / शाम / रात |
| Instructions | सूचना | निर्देश |
| Tests advised | करायच्या तपासण्या | कराने वाली जाँचें |
| Advice | सल्ला | सलाह |
| Next visit | पुढील तपासणी | अगली जाँच |
| Due by your next visit | पुढील तपासणीपर्यंत करायचे | अगली जाँच तक करना है |
| Visit summary (title of the printout without medicines) | तपासणीचा सारांश | जाँच का सारांश |

Points for the reviewer: "IM / IV / SC" are kept in English letters because patients and nurses know them that
way; "मिली" is used for ml in both languages; the doctor's own words (medicine instructions, advice, notes) are
printed as typed, not translated.

## How it works in the app (for developers)

- Server: `server/src/models/Visit.js`, `PrescriptionDesign.js`; `server/src/routes/visits.js` (under
  `/api/patients/:id/visits`), `prescriptionDesign.js`; `server/src/visits/*` (codes, checks, views, designs).
  Each part of a visit (vital signs, notes, prescription) has its own version number, so two people can work on
  one visit without overwriting each other. The audit log records ids only.
- Website: `client/src/pages/visits/*` – `VisitPage.jsx` (the two tabs and printing), `VisitDetailsForm.jsx`,
  `PrescriptionForm.jsx`, `RxDocument.jsx` (the 10 designs, and the visit summary), `PrescriptionDesignPage.jsx`,
  `rxFormat.js` (all words); styles in `client/src/styles/pages-visits.css` and `print-rx.css`.
- Print preview, page count and PDF: `client/src/components/print/PrintPreview.jsx`; `pdfExport.js` lays the
  printout out on the paper in a hidden frame with the app's own styles and fonts, ends pages between lines
  (`paperLayout.js`) and draws each page as a picture into a PDF (`imagePdf.js` – a small PDF writer, so no
  library is added). The PDF's pages are pictures: text in it can't be searched or copied.
- Ready-made sets: `server/src/models/PrescriptionSet.js`, `server/src/routes/prescriptionSets.js` (under
  `/api/prescription-sets`), `server/src/visits/builtInSets.js` (the drafts – raise `BUILT_IN_SETS_VERSION` when
  they change: unedited drafts in every hospital are then refreshed) and `prescriptionSets.js`; on the website
  `PrescriptionSetsPage.jsx`, `PrescriptionSetPage.jsx`, `PrescriptionSetEditPage.jsx`, `SetDialogs.jsx` (the
  picker and "Save as a set"), `MedicineRows.jsx` (the medicine rows shared with the Prescription tab) and
  `rxRows.js` (the rule for adding a set).
- Tests: `server/tests/visits.test.js`, `server/tests/prescription-sets.test.js`,
  `client/src/pages/visits/rxFormat.test.js` and `rxRows.test.js` (a server test checks that the website and the
  server use the same codes).
