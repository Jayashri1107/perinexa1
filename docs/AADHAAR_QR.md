# Fill from Aadhaar card (16 Oct 2026)

**What it does.** On the patient's details (New patient, and Edit for staff who may change identity), reception, a
doctor or RMO ticks the patient's agreement and uploads a photo, scan or screenshot of the side of the Aadhaar card
that has the QR code. The QR is read in the browser and fills the full name, age, address, PIN code, city, state and
"ID proof seen: Aadhaar, last 4 digits". Staff check the details and save as usual. Admission picks a registered
patient, so registering her this way covers admission too.

**What it never does.** It never sends the picture or the QR anywhere, never keeps the image (the file box is cleared
at once), and never uses the whole Aadhaar number, the photo in the QR, gender, care-of or mobile/email.

**Code.** `client/src/pages/patients/aadhaarQr.js` (reading: Secure QR V1/V2 and the old XML QR; tests in
`aadhaarQr.test.js`), `AadhaarQrFill.jsx` (the panel), `PatientForm.jsx` (`fillFromAadhaar`).

**Add-on.** `jsqr` 1.4.0 (Apache-2.0, no dependencies, exact version) finds the QR in the picture. Agreed by the owner
for the developer on 16 Oct 2026 (choice "QR code, in the browser"). Loaded only when a picture is uploaded.

**Not done yet – for the developer.**
- The UIDAI digital signature in the Secure QR is **not checked** (it needs UIDAI's public certificate). A made-up QR
  would fill the form with its own words, so staff still compare with the card. The screen says so.
- e-Aadhaar PDFs are password-protected: staff upload a screenshot of the QR instead.
- No live camera scanning; on a phone or tablet the upload button offers the camera.
