# Reception like a hospital system – plan and decisions (owner, 17 Oct 2026)

Branch `reception-v2` (built on `lab-flow`). The owner asked for reception, doctor and billing work to match what a HIMS,
the Docterz app and eLabAssist do, without the bill becoming complicated. All test data is fake.

## What the owner asked, and what was built

| Asked | Built |
|---|---|
| The options inside a page as separate items in the sidebar | Each menu item with more than one page shows its pages under it (Billing → Bills, Unpaid, Daily summary, Cash handover, Price list …). Open by itself on that module's pages; the arrow opens or hides it. Only the pages this person may open. Hidden in the icon rail. |
| All charges on the bill, as in a HIMS | New price-list items. Keyed ones go on the bill **by themselves once the hospital admin sets a price** (₹0 = not charged): registration fee (new patient), admission charge, nursing charge per day (same days as the bed), doctor visit (ward round – when the doctor signs the round note, with the doctor's name), each scan ordered. Unkeyed items to add by hand: emergency consultation, labour room, OT, surgeon fee, anaesthesia, baby care/NICU per day, oxygen, diet, CTG, consumables, ambulance, medical certificate. |
| The doctor's name on the bill | The patient's doctor on the bill (screen and print); each line shows its doctor (consultations, ward rounds, items added by hand with a doctor chosen). |
| Adding items must be easy | New **Add items** dialog: type to find, or tap a common item (priced consultations, procedures, inpatient and other charges); taps go into a list; − / + for quantity; choose the doctor once; one button adds them all with the total. |
| Slots kept for walk-ins | Appointments → OPD settings → **Slots kept for walk-ins** (0–10 per session, the last slots of each session). Not offered in the patient portal; reception and doctors see them marked **Walk-in** (dashed) and can book them. |
| Notifications to the doctor and every module | A **bell** in the top bar (checked every minute): the doctor – a new appointment, her patient arrived, lab results to review; reception – a checkup marked done, an admission request; the lab – a new lab order (patient and number of tests, never the test names). Short text, no clinical detail; kept 30 days; never to the person who did it. |
| The doctor marks the checkup done; reception sees it | Today → Waiting to be seen → open a patient → **Checkup done** (doctors and RMOs, today's appointments). She leaves the waiting list, her appointment shows **Checkup done**, reception gets a notification. Audit: "Checkup marked done". |
| WhatsApp message when an appointment is booked | Already built (`docs/WHATSAPP_DESK_PLAN.md`): a booking, move or cancellation goes at once to a patient who chose WhatsApp, once WhatsApp is set up (below). |

**Changed 19 Oct 2026 (owner):** the sidebar is back as it was first – no pages under any item (the Lab too); each
module's pages are the tabs at the top.

## Is WhatsApp integrated?

Yes, in the code: OTPs, appointment messages, bills/receipts, reviewed lab reports and the queue time. To actually
send from +91 88880 24000 the hospital still needs (one time, by the owner or the developer):
1. A Meta Business account, verified, with the number added to the WhatsApp Business Platform (Cloud API).
2. Three approved templates: `perinexa_document`, `perinexa_otp` (Authentication), `perinexa_update` (Utility).
3. In `server/.env` (never in the code): `WHATSAPP_MODE=live`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_NUMBER`. Until then `WHATSAPP_MODE=practice` shows what would be sent without sending.
4. Hospital admin → Patient messages → switch on automatic reminders (appointment messages), and each patient chooses
   WhatsApp on her page (More → Reminders and portal).

## Decisions
- Automatic charges only when priced: a hospital that does not charge registration or nursing leaves them at ₹0.
- Nursing per day follows the bed days of the stay; the ward round is charged per signed round note.
- Walk-in slots are counted from the end of each session (evening walk-ins get the end of the evening session).
- Notifications carry names and times only – no diagnosis, no results. The hospital-data export leaves them out.
- The bell does not count as activity: the 30-minute logout still happens.

## Later (not built)
- Doctor-wise revenue report, package billing (e.g. a delivery package), TPA pre-authorisation.
- Notifications on the phone (push) and sound; a notification for pharmacy and billing desks.
- A walk-in limit per doctor per day instead of slots.

Code: `server/src/notifications/notify.js`, `routes/notifications.js`, model `Notification`; `billing/billingService.js`
(chargeRegistration, chargeRound, chargeScan, syncNursing); `appointments/slots.js` (`walkInStarts`); website
`components/NotificationBell.jsx`, `components/AppLayout.jsx` (SideLink), `pages/billing/BillPage.jsx` (AddItemDialog).
Tests: `server/tests/reception-v2.test.js`, `client/src/platform/modules.test.js`.
