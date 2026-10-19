# Lab report templates – plan and decisions (owner, 19 Oct 2026)

The owner asked that each lab test have its own report and report template (the right values, units, ranges by age
and sex, method, interpretation notes and layout – CBC, LFT, thyroid, urine routine, culture, histopathology each in
a proper format), printable on the letterhead with signatures, as a lab system like eLabAssist offers (used only as a
list of features; Perinexa keeps its own look). The owner approved the 4 parts below ("implement the remaining
module"). Branch `lab-templates` from `deploy-hardening` c9965e9.

**Everything clinical here is DRAFT for the owner (a doctor) to check and approve** (Lab → Tests → a test → Approve):
the new values and their ranges, the ranges for men, the methods and the interpretation notes. A report shows
"(DRAFT)" next to an unapproved range or note.

## 1. A report template per test

Each test prints by its template (Lab → Tests → a test → On the report):
- **Table of values** with sections – CBC (haemoglobin and red cells, red cell indices, white cells, platelets,
  peripheral smear), LFT (bilirubin, enzymes, proteins), RFT (kidney, electrolytes), urine routine (physical,
  chemical, microscopy), thyroid and lipid profiles, sugars …
- **Serology** – result, method and cut-off (HIV under its neutral name, VDRL, HBsAg, anti-HCV, ICT).
- **Culture and sensitivity** – growth, organism, colony count, then the antibiotic table (Sensitive / Intermediate /
  Resistant, zone) from the test's panel (urine and high vaginal swab panels built in; the lab can change the list).
- **Paragraphs** – histopathology (specimen, clinical details, gross, microscopy, diagnosis, comment) and the Pap
  smear in the Bethesda 2014 layout.

Each test also has its **method**, its **interpretation notes** (printed under the result) and **"print on its own
page"** (on for cultures, Pap and histopathology). The method and notes are saved with each result as they were then.
The template and own page are layout; the method and notes are clinical wording (a change makes a new DRAFT).

## 2. Full value sets and worked-out values

- New values (existing keys kept, so earlier results, red flags and care plans are unchanged): full CBC (RBC, PCV,
  MCV, MCH, MCHC, RDW, differential count, peripheral smear), LFT (direct and indirect bilirubin, ALP, GGT, total
  protein, albumin, globulin, A/G ratio), RFT with sodium, potassium and chloride, urine routine (colour, appearance,
  specific gravity, pH, ketones, bile salts and pigments, blood, nitrite, red cells, epithelial cells, casts, crystals,
  bacteria), Pap smear (specimen type, adequacy, Bethesda interpretation, organisms).
- New tests: thyroid profile (T3, T4, free T4, TSH – ticks the TSH care-plan item), lipid profile, high vaginal swab
  culture and sensitivity, histopathology. Each new test is added to the price list at ₹0 automatically.
- **Worked out when left empty** (`server/src/lab/labCalcs.js`): MCV, MCH, MCHC, indirect bilirubin, globulin, A/G
  ratio, LDL (Friedewald, not with triglycerides of 400 or more), VLDL, cholesterol/HDL. A value the lab types (an
  analyser's own MCV) is kept. The result form shows what it comes to while typing; the report marks it "worked out".
  A worked-out value alone is not a result (a report still needs a typed value).

## 3. Ranges by age and sex

- A range for a group may now be for **women or men** on any test (before: only a baby's sex). Built-in DRAFT ranges
  for men: haemoglobin 13–17, RBC 4.5–5.5, PCV 40–50, creatinine 0.7–1.3, uric acid 3.4–7.0, ALP 40–129, GGT up to
  55, HDL 40 or more, ferritin 30–400. The hospital can change or remove them.
- **Sex at the lab's registration** (Lab → New registration → 1. Patient): Woman / Man, saved on the patient as an
  adult's own sex (`Patient.sex`). Every other adult is a women's-care patient (female). A baby's sex stays the one
  recorded after birth. **No fetal sex anywhere** (PCPNDT): the words are still refused in every result.

## 4. Signatures, end of report, page numbers

- Lab → Settings → **Who signs the report** (doctors): name, qualification, title, registration number, the staff
  member who checks as them, a signature picture (PNG or JPEG, at most 150 KB, checked from its bytes), default
  signer, signing or not (never deleted).
- **The signature picture prints only on a report its signer checked** (or reported, without the check). On other
  reports the default signer is named with a line to sign by hand – a report is never "signed" by someone who did not
  check it.
- "End of report" at the end; "Page 1 of 2" at the bottom of each page (printing and the PDF); "Each test on its own
  page" when printing.

## Later (not built)

Connecting lab machines; e-mail or SMS dispatch; branches and collection centres; income reports by test and by
referrer; a payment gateway; an outside doctors' portal; company (B2B) billing; an AI summary of a report. In the
PDF (WhatsApp), "own page" is not applied (the printout keeps it).

Code: `server/src/lab/labTests.js`, `labCalcs.js`, `labSetup.js` (templates, `reportSigner`), `routes/lab.js`
(`checkedTests`), `routes/labSetup.js` (`/signatories`); website `pages/lab/LabPrints.jsx` (`LabReportDocument`),
`LabTemplateParts.jsx`, `labCalcs.js`, `LabSigners.jsx`, `LabTestEditPage.jsx`, `LabOrderPage.jsx`,
`LabResultsPage.jsx`, `components/print/PrintPreview.jsx` and `pdfExport.js` (page numbers). Tests:
`server/tests/lab-templates.test.js`, `client/src/pages/lab/labTemplates.test.jsx`.
