# WhatsApp at the desk – plan, decision and setup

**Decision (owner, 17 Oct 2026):** the feature freeze is lifted for these 5 items, after a comparison with the clinic
app Docterz (its public pages describe reception, queues with a waiting time on a TV, prescriptions, bills, a daily
cash tally "Hisaab Kitaab", a vaccine manager and a patient app; they do not mention WhatsApp – Docterz's patient
onboarding is an SMS link). The hospital's WhatsApp number: **+91 88880 24000**.

Branch `whatsapp-desk` (worktree `.claude/worktrees/whatsapp-desk`), built on `lab-lims` (the lab report print is
there), merged into `deploy-hardening` only when the owner asks and `npm test` and `npm run build` pass.

## What was built

1. **Sign-in OTP on WhatsApp, SMS if it fails.** Hospital admin → Patient messages → "Send patients' sign-in OTPs on
   WhatsApp". The OTP goes in Meta's **Authentication** template (a "Copy code" button). If WhatsApp refuses or does
   not answer, the same OTP goes by SMS (MSG91, docs/SMS_OTP_SETUP.md); if neither can send, she is told and nothing is
   logged. `server/src/reminders/sender.js` (`deliverOtp`), `server/src/routes/portalSignup.js`.
2. **Appointment messages on WhatsApp.** Booking, move and cancellation messages and the day-before reminder go to
   patients who chose WhatsApp (her page: More → Reminders and portal) through the hospital's number, in one
   **Utility** template, "Message from {{1}}: {{2}}". A booking, move or cancellation now goes at once (not with the
   next hourly round). **Bills and receipts:** Billing → a bill → Print → Send on WhatsApp now.
3. **The lab report on WhatsApp** – only once a doctor has reviewed it, never with the confidential (HIV) test (the
   button disappears when "Include the confidential test" is ticked; the server refuses it too).
4. **Queue time.** When reception marks her arrived (a walk-in token or her booking): her token or time, how many are
   before her with that doctor, and about when she goes in (now + 10 minutes per patient before her, never before her
   booked time). Hospital admin → Patient messages → "Send the queue time on WhatsApp". Today shows "Queue time sent
   on WhatsApp …".
5. **Daily cash handover** (Billing → Cash handover): each person who took payments sees Perinexa's count of their
   cash (and UPI, card, insurance for checking) and hands over the cash, with a note when it differs; a doctor or the
   hospital admin counts it and confirms (never their own). Doctors see "N cash handovers are waiting" on Today.

Every message goes only to the mobile number on her record (the OTP: the number she signs in with), only with her
agreement to WhatsApp messages, never from a closed record, and never says why she came. Each send is in the audit
log with ids only (QUEUE_TIME_SENT, BILL_SENT_WHATSAPP, LAB_REPORT_SENT_WHATSAPP, CASH_HANDED_OVER,
CASH_HANDOVER_CONFIRMED). Marathi and Hindi wording: DRAFT (docs/TRANSLATIONS_TO_CHECK.md section 6).

## Setting up +91 88880 24000 with Meta (the hospital does this once)

⚠️ Fake data only until the app has been reviewed by an experienced developer. Keys go only in `server/.env` on the
computer that runs Perinexa – never in the code, never in a chat.

1. **Meta Business account**: business.facebook.com → create the hospital's business (name, address, website or
   GST certificate) → **Business verification** (a few days).
2. **WhatsApp Business Platform**: developers.facebook.com → create an app (type *Business*) → add **WhatsApp** →
   *API setup* → **Add phone number** → +91 88880 24000, the display name (the hospital's name; Meta checks it) →
   verify by SMS or a call to that number.
   - A number used on the Cloud API normally cannot stay in the ordinary WhatsApp app on a phone. Meta's
     "coexistence" (keeping the WhatsApp Business app and the API on one number) may be offered when you add the
     number – if not, the number leaves the phone app. Decide this before step 2.
3. **Payment method** in Meta Business → WhatsApp → *Payment settings* (Meta charges per message; Authentication and
   Utility messages cost a little, set by Meta for India).
4. **Message templates** (WhatsApp Manager → *Message templates* → Create), language **English**:
   - `perinexa_document` – *Utility*, header *Document*, body: `Your document from {{1}} is attached. Please call the
     hospital if you have any questions.` (prescriptions, bills, lab reports – may already exist)
   - `perinexa_otp` – *Authentication*, "Copy code" button, code expiry 10 minutes, with the security warning.
   - `perinexa_update` – *Utility*, body: `Message from {{1}}: {{2}}` (if Meta asks for more fixed words, use
     `Hello, here is a message from {{1}}: {{2}} Reply STOP to stop these messages.` – the name stays `perinexa_update`).
5. **A permanent access token**: Meta Business settings → *System users* → add one (Admin) → *Add assets* → the app
   and the WhatsApp account → *Generate token* with `whatsapp_business_messaging` and `whatsapp_business_management`.
6. **In `server/.env`** (then restart Perinexa):

   ```
   WHATSAPP_MODE=live
   WHATSAPP_PHONE_NUMBER_ID=<the phone number ID from API setup>
   WHATSAPP_ACCESS_TOKEN=<the system user's token>
   WHATSAPP_TEMPLATE=perinexa_document
   WHATSAPP_OTP_TEMPLATE=perinexa_otp
   WHATSAPP_UPDATE_TEMPLATE=perinexa_update
   WHATSAPP_NUMBER=+91 88880 24000
   ```

   To try the screens first without sending anything: `WHATSAPP_MODE=practice`.
7. Hospital admin → **Patient messages**: switch on what you want (documents, OTPs, queue time, automatic reminders).
   Each patient must agree to WhatsApp messages on her record (More → Reminders and portal → WhatsApp).

## Later (not built)

Sending handouts on WhatsApp, two-way chat (replies from patients), the baby growth chart and milestones, clinic
expenses, consumables, a website builder.
