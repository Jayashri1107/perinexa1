# Smart features plan (agreed with the owner, 2026-09-30)

Ten features to make the OB-GYN consultant's day easier. Built one at a time, each tested before the next.
Fake data only, as always. Nothing an AI writes is saved without a doctor checking it.

## Decisions
- **Order:** as below (no-AI features first).
- **AI service:** OpenAI (owner's choice on 2026-09-30, after the comparison in `docs/AI_PROVIDERS.md`). Its India
  option stores data in India but may process it abroad – to be reviewed before any real patient data.
- **Clinical rules** (red flags, unsafe medicines): drafted from standard FOGSI / WHO (and other named) guidance,
  shown as DRAFT, and edited / approved by the owner in the app (owner's decision, 2026-09-30).
- Steps 1–3 built on 2026-09-30 without stopping (owner's request); the only stop is choosing the AI service.

## Build order
| Step | Feature | How it works | Needs AI |
|---|---|---|---|
| 1 ✓ | Daily worklist + Red-flag alerts | Rules pick who needs attention today (overdue items, missed visits, red flags); red flags also show on the patient and the visit. Widened in October 2026: red flags also from lab results, postnatal and newborn visits and the nursing chart of a patient in hospital – see `docs/PROGRESS.md`, Next | No |
| 2 ✓ | Medicine safety check in pregnancy | Doctor-given list of medicines unsafe by trimester / with allergies; warning on the prescription | No |
| 3 ✓ | Follow-up reminders to patients | Care plan knows what is due; a worded message (Marathi / Hindi / English) to send by WhatsApp | No |
| 4 ✓ | Visit summary before you walk in | AI writes 4–5 lines from the record; doctor reads | Yes |
| 5 ✓ | Patient advice in her language | AI translates the doctor's advice; doctor checks before printing | Yes |
| 6 ✓ | Discharge and referral letters | AI drafts from the record; doctor edits and signs | Yes |
| 7 ✓ | Smarter risk check | AI reads free-text conditions and suggests a risk factor; doctor confirms | Yes |
| 8 ✓ | Reading lab and scan reports | AI reads a photo/PDF; doctor checks values before saving | Yes |
| 9 ✓ | Ask your records | AI turns a question into a safe search; answers come from the database | Yes |
| 10 ✓ | AI brief (owner's request, 2 Oct 2026) | On Today, the Calendar and a patient's page, "Brief me" gives 3–6 points on what to look at first. Patients are sent as labels ([P3]) – no names, phones, addresses, patient numbers or typed notes – and HIV is never sent. Cheaper model (GPT-5.4 mini): about ₹0.07–0.20 a brief | Yes |

## Before any AI feature is used with real patients
- An AI provider with a data-privacy agreement suitable for medical data.
- Names, phone numbers and addresses removed before sending wherever possible.
- Every AI use recorded in the audit log.
- A review by an experienced developer (as for the whole app).
