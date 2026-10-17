# Sending real OTPs by SMS (MSG91) – setup steps

Patients sign in with their mobile number and a 6-digit OTP. Until an SMS company is connected, Perinexa runs in
**practice mode**: the OTP is shown on the screen (only on a development computer; on a live server OTP sign-in is
switched off). Once MSG91 is connected, the OTP goes by SMS to the patient's mobile and is never shown on screen.

The code is ready (17 Oct 2026): `server/src/reminders/sender.js` (`msg91`, `otpSender`), used by
`server/src/routes/portalSignup.js`. Only the accounts and two settings are needed.

## 1. DLT registration (required by law in India – once, for the hospital)

Every business SMS in India must be registered on a DLT portal (TRAI rules), or the phone companies block it.

1. Register the hospital as a **Principal Entity** on one DLT portal – for example Jio TrueConnect, Airtel DLT or
   Vodafone Idea (Vi) DLT. Documents: the hospital's PAN, GST certificate (or other business proof), the authorised
   person's ID, and a letter of authorisation. There is a one-time fee. Approval takes a few working days.
2. Register a **Header (Sender ID)**: 6 letters naming the hospital, e.g. `ANANDI` or `PRNXHS`, category
   *Transactional / Service – Implicit*.
3. Register the **Content Template** for the OTP, type *Transactional (OTP)*, exactly this text:

   `{#var#} is your OTP to sign in to {#var#}. It works for {#var#} minutes. Do not share it.`

   Note the **Template ID** DLT gives you.

## 2. MSG91 account

1. Sign up at msg91.com with the hospital's details and add balance (OTP SMS cost well under a rupee each).
2. In MSG91, add your **DLT Entity ID** and the **Sender ID** (Header) from step 1.
3. In MSG91 → SMS → **Templates (Flow)**, create a template:
   - DLT Template ID: the one from step 1.3
   - Sender ID: yours
   - Text, with these exact variable names:
     `##otp## is your OTP to sign in to ##hospital##. It works for ##minutes## minutes. Do not share it.`
   - Save, and copy its **Template ID** (MSG91's, shown on the template).
4. In MSG91 → **API / Auth key**, copy the **Auth key**.

## 3. Connect Perinexa

Open `server/.env` (on the computer that runs Perinexa – never in the code, never in a chat) and fill in:

```
MSG91_AUTH_KEY=<the auth key from MSG91>
MSG91_OTP_TEMPLATE_ID=<MSG91's template ID from step 2.3>
```

Restart Perinexa. The on-screen practice OTP disappears and OTPs go by SMS.

## 4. Check it

Use **your own mobile number** with a sample patient (no real patient yet – the go-live checklist comes first):
patient sign-up → reception approves → Sign in → Mobile number + OTP → Send OTP. The SMS should arrive within
seconds. If the screen says "The OTP could not be sent just now", the keys or the template are not right yet: check in
MSG91 → Reports why the message was refused (wrong template ID, template not approved, no balance).

## Notes

- Only OTPs go through MSG91. Appointment reminders stay as before (the outbox for staff, or Twilio if set up), because
  each reminder wording would need its own DLT template.
- The hospital name in the SMS is cut to 30 letters (the most a DLT variable may hold).
- Nothing about the patient is written to the server's log when a message fails.
