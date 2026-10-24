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

**Add-ons.** `zxing-wasm` 3.1.4 (MIT; ZXing, the reader most scanner apps use) reads the QR first – agreed by the
owner on 17 Oct 2026 because jsQR could not read the dense Secure QR from webcams. Its program file
(`zxing_reader.wasm`, ~950 KB) is bundled with the app; `locateFile` in `aadhaarQr.js` stops it being fetched from its
default CDN. `jsqr` 1.4.0 (Apache-2.0) is the fallback. Both load only when the Aadhaar panel opens. Measured with
Aadhaar-sized sample codes (about 150 squares across), blurred like a webcam picture: ZXing needs about 3 camera dots
per square (the QR about half the height of a Full-HD picture); jsQR about 4 sharp ones. Laptop webcams that cannot
focus closer than ~30 cm may still fail – then a USB QR scanner, a phone camera or a close photo.

**Real cards (23 Oct 2026).** On the live site most real cards failed while the demo card read. Now: the Secure QR is
unpacked in pieces and what came out before a problem is kept (Chrome's unpacker refused the whole QR for extra or
damaged bytes after the packed data, where zlib-based readers stop quietly); the start of the fields is found by the
date of birth and gender, so a version with more fields before the name reads; the short `<QPDB … />` XML of some
e-Aadhaar/mAadhaar copies is read; spaces and line breaks in the number are ignored; photos are also tried with
ZXing's other black-and-white methods and smaller. Tests rebuild each case with fake details (`aadhaarQr.test.js`).

**Not done yet – for the developer.**
- e-Aadhaar PDFs are password-protected: staff upload a screenshot of the QR instead (a PDF now gets that message).
- The "verified" result has only been tested with a key made in the tests: confirm it with a real card (on a phone of
  staff, never in a test or a chat) before relying on it. Which UIDAI key signs today's cards is not published.
- The patient's sign-up (portal) does not show the signature result yet: it needs wording in her languages (owner).
- Camera: starts when the agreement is ticked, reads by itself, turns off; asks for the camera's sharpest picture and continuous focus where the camera has it.

**UIDAI signature (24 Oct 2026).** The Secure QR's signature is now checked in the browser (`aadhaarSignature.js`,
Web Crypto, no add-on): the last 256 bytes of the unpacked QR are an RSA-2048 SHA-256 signature over every byte before
them. UIDAI's certificates are in `client/src/pages/patients/uidai-keys/` (PEM), downloaded on 24 Oct 2026 from
uidai.gov.in "Data and Downloads" (Secure QR: `uidai_12_06_18_cer`, `uidai_prod_cdup`; Offline e-KYC: the five
`uidai_offline_publickey_*`; digital signature: `uidai_auth_sign_Prod_2026`, `uidai_auth_sign_prod_2023`). Every key is
tried; an expired certificate still checks cards printed while it was in use. Staff see "UIDAI signature checked",
"could not be confirmed – compare every detail with the card", or, for the old XML QR, "has no UIDAI signature". The
form is filled in every case; staff decide. When UIDAI publishes a new key, add its PEM to `uidai-keys/`.

**Photos (24 Oct 2026).** Measured with a fake Aadhaar-sized Secure QR (~145 squares) photographed in the browser:
read at 2 camera dots per square and more while the blur stays under about half a square, at any angle, with skew,
shade and strong JPEG; stronger sharpening with light evened out now also reads blur of 2 dots at 3 dots per square.
More blur than that does not read: take the photo again closer and in focus, or use the camera. Upload checks: a PDF
or a file over 25 MB gets its own message; HEIC (iPhone) is not a picture Chrome opens.
