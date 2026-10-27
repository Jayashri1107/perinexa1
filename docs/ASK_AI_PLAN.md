# Ask AI about a patient – plan

> Copied from the owner's repository (`girishsolanke/perinexa`) on 27 Oct 2026 for reference. perinexa1 does this its own way; this file describes the owner's plan, not perinexa1.

Planned with the owner on 15 Oct 2026 and built the same day at the owner's request (another exception to the
feature pause). Fake data only; no real patient before the OpenAI data-privacy agreement (`docs/AI_FEATURES_PLAN.md`,
"Before any AI feature is used with real patients").

## The owner's decisions (15 Oct 2026)

| # | Question | Answer |
| --- | --- | --- |
| 1 | What conversation | **The doctor talks with the AI** about her, with follow-up questions (no team thread) |
| 2 | Kept? | **Not kept**: it lasts while the tab is open; a useful answer is copied into a visit note by the doctor. The audit log records each use (feature, model, token counts – never the words) |
| 3 | Who | **Her doctor (any doctor while she has none) and RMOs** – as the AI brief and letters |
| 4 | Scope | **Her record and general medical knowledge, clearly labelled**: "From her record" (with dates) and "General medical knowledge – check against current guidelines" |
| 5 | Model | **The cheaper model (GPT-5.4 mini)**, with a **Think harder** button that sends one question to the stronger model (GPT-5.5) |
| 6 | When | Built now, into the main version |

## What the AI is told
The record as the other AI features send it (`server/src/ai/context.js`: never her name, phone, address or patient
number; typed text scrubbed of her name and phone-like numbers; never the doctor's private notes), plus, for this tab:
lab results (values and their Low/High marks, never typed result text), signed ultrasound reports (impression and
findings), hospital stays and confirmed discharge cards, and referrals (the question and the signed consultant note).
**Never** anything about the baby's sex (PC-PNDT: questions and answers are checked, and an answer that mentions it is
withheld) and **never** HIV (the HIV and AIDS Act 2017: the HIV test, results and any line naming it are left out, as
in the AI brief). OpenAI is asked not to store anything (`store: false`).

## How it works
- Patient record → **Ask AI** tab (her doctor and RMOs only). Suggested questions to start; type a question; **Ask**.
- Each answer: **From her record** (each point with where it comes from, e.g. "visit 12 Oct 2026"), **General
  medical knowledge – check against current guidelines**, **Not in her record** (what the record does not say), and a
  caution when needed. Marked "AI answer – check against her record".
- Follow-up questions send the conversation so far (up to 8 questions in one conversation).
- **Think harder** asks the latest question again with the stronger model. **Copy** copies an answer as plain text.
- **New conversation** clears it. Leaving the tab clears it. Nothing is saved on her record.

## After the independent review (15 Oct 2026)
- **HIV**: a question that names HIV is refused before anything is sent ("Look at her record directly"), HIV lines
  are taken out of earlier answers, and a scan, stay or referral that names HIV anywhere is left out whole. The HIV
  word list now also catches antiretroviral treatment and the medicines used only for HIV (dolutegravir, efavirenz,
  zidovudine, nevirapine, lopinavir, atazanavir, raltegravir, abacavir, TLD/TLE, CD4, viral load) – this also
  protects the AI brief. **DRAFT list: the owner checks it** (tenofovir and lamivudine alone are not on it: they are
  also used for hepatitis B; nor "ART" alone, which also means assisted reproduction).
- Her patient number is scrubbed from what is sent (also from a question), and typed lab results (an organism, Pap
  details) are not sent at all.
- Corrections are sent with what they correct: ultrasound addenda, additions to a discharge card and to a consultant
  note. Long typed text is marked "(shortened)".
- Answers are capped in length, so the conversation always fits when sent back. "Think harder" is offered on the
  latest answer only. Copied text starts "AI answer (OpenAI, date and time) to: <question> – to be checked against
  her record before use."
- The AI is told never to use the words that would make a non-pregnancy answer look like it mentions a baby's sex
  ("male factor" → "partner factor"), so answers are withheld less often.

## Technical
- `POST /api/patients/:id/ai/ask` `{question, history: [{question, answer}], deep}` → `{answer: {fromRecord:
  [{text, source}], general: [{text}], notInRecord: [text], caution}, model: 'cheaper'|'stronger', generatedAt}`.
  The same gate as the other patient AI help (doctor or RMO, and the clinical record may be changed by them). Audit
  `AI_USED` with feature `ask_patient` or `ask_patient_deep`.
- `server/src/ai/askContext.js` builds the record text; `client/src/pages/ai/PatientAskTab.jsx` is the tab.
