# Sign-in wait after wrong passwords, and the lab order page – decisions (owner, 19 Oct 2026)

Branch `login-lock`. All test data is fake.

## 3 wrong tries → 2 minutes' wait, with a countdown

- **Hospital staff** (`/login`): 3 wrong passwords in a row for one email lock that email for 2 minutes. The same for an
  email that does not exist, so the answer never shows whether an account exists. The second wrong try says "One more
  wrong try and sign-in waits 2 minutes." While locked the password is not checked at all; a right password after the
  wait clears the count. Audit log: "Sign-in locked for 2 minutes (3 wrong tries)".
- **Patients**: the same rule for the code on paper (code + 4 digits) and for their own account (email and password,
  or the OTP). **Owner's decision:** this replaces the earlier 5 tries / 30 minutes for patients.
- The sign-in page shows "Too many wrong tries. Please wait 1:58 – then you can try again." counting down every
  second, with the Sign in button off until the time is up (also in Marathi and Hindi for patients – DRAFT wording).
- The answer is HTTP 429 with `retryAfterSeconds` and a `Retry-After` header. The per-computer rate limits (20 tries in
  15 minutes) stay as before, on top.
- For the developer: a 2-minute lock slows a guesser to about 90 tries an hour per account; the IP limits and strong
  passwords do the rest. Anyone who knows a staff email can keep it locked by typing wrong passwords – the short time
  keeps that a nuisance only. Review in the health check.

Code: `server/src/auth/loginLock.js`, `models/LoginLock.js`, `routes/auth.js`, `routes/portal.js`,
`routes/portalSignup.js`, `middleware/errorHandler.js`; website `components/LockCountdown.jsx`, `pages/LoginPage.jsx`,
`pages/portal/PortalPage.jsx`, `pages/portal/PortalAccount.jsx`. Tests: `server/tests/auth.test.js`, `portal.test.js`,
`portal-signup.test.js`.

## The lab order page

- One summary card: the tests and the status, the patient, the steps (who and when), the facts in a grid (sample
  number, ordered by, report due or time taken, where it came from, package, note to the lab), and all buttons in one
  row at the bottom (Reject and Cancel on the right). The list of stamps under the steps is gone – the steps show them.
- Results are typed in a table per test: value, result, unit, her usual range, flag; then the comment.
- An older order with no "received" stamp shows that step as passed ("Not recorded").

## "The app is not running" message

The website shows "Can't reach the server. Please check that the app is running." when the server does not answer –
usually for a few seconds while it restarts after an update is added (it restarts by itself), or if the database
service (MongoDB) stopped. Reloading after a few seconds is enough in the first case.
