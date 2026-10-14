# Deploying Perinexa on DigitalOcean App Platform

**FAKE SAMPLE DATA ONLY.** This puts Perinexa online for a private demo. Real patient data waits until the developer's
health check and the go-live checklist are complete (`docs/HANDOVER.md` sections 2 and 6–8).

What you get: one web service in **Bangalore (BLR1)** that builds the website and runs the server, and a **Managed
MongoDB** cluster in the same region with daily backups. Every push to `main` on GitHub deploys again by itself.
About **$12/month** for the app and **$15/month** for the database.

## 1. The database (once)

1. DigitalOcean → **Databases** → **Create Database Cluster**.
2. Engine **MongoDB**, region **Bangalore (BLR1)**, the smallest plan.
3. Name it **`perinexa-db`** (the app settings file links to this name). Create.

## 2. The app (once)

1. DigitalOcean → **Apps** → **Create App** → **GitHub** → allow access to the repository → choose
   **`Jayashri1107/perinexa1`** (or the repository you pushed to) and branch **`main`**, with **Autodeploy** on.
2. When App Platform shows the detected settings, choose **Edit app spec** (or "Upload spec") and paste the contents of
   **`.do/app.yaml`** from this repository. If the code is in another repository, change `repo:` first.
3. Add the one secret: **Settings → App-Level Environment Variables → Edit → Add**
   - Key **`JWT_SECRET`**, value: a long random text, made on your computer with
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; tick **Encrypt**.
4. **Create resources**. The first build takes a few minutes. The app's address is shown at the top
   (`https://perinexa-xxxxx.ondigitalocean.app`).

## 3. First start

1. Open the address. The sign-in page asks to **create the first super admin** (name, email, password).
2. As the super admin: **Hospitals → Add hospital**, then add its staff (doctors, reception, a hospital admin …).
3. Optional sample beds for trying admission (in the App's **Console** tab):
   `npm run sample:beds -w server -- "<hospital name>"`.

## What the settings mean

| Setting | Why |
| --- | --- |
| `NODE_ENV=production` | Secure cookies, the server delivers the built website, no development helpers. |
| `API_PORT=8080` | The port App Platform sends visitors to (`http_port`). |
| `TRUST_PROXY=1` | The app sits behind App Platform's load balancer: the sign-in limits then see each visitor's address. |
| `CLIENT_URL=${APP_URL}` | Only the app's own address may call the API. |
| `MONGO_URI`, `MONGO_CA_CERT` | Filled in by App Platform from the linked database; the connection is checked against its certificate. |
| `JWT_SECRET` | Signs the sign-in sessions. Encrypted; never in the code or in git. |
| one instance | Some parts assume a single server (`docs/HANDOVER.md` section 7). Do not scale out. |

Kept **off** until their agreements are done (`docs/HANDOVER.md` section 8): AI (no `OPENAI_API_KEY`), SMS and
WhatsApp (no Twilio / WhatsApp keys), ABDM (`ABDM_MODE` stays `practice`).

## Updating

Push to `main` – App Platform builds and deploys by itself. To go back to an earlier version: the App's
**Activity** tab → choose a deployment → **Rollback**.

## Custom address (optional)

App → **Settings → Domains → Add domain** (e.g. `demo.yourhospital.in`), then add the DNS record DigitalOcean shows.
HTTPS is set up by itself. Then change nothing else: `CLIENT_URL` follows the app's address.

## If something goes wrong

- **Build failed:** the App's **Activity** tab → the failed deployment → **Build logs**.
- **"Could not connect to the database":** check that the database cluster is named `perinexa-db`, is in BLR1, and that
  the app is listed in its **Trusted sources** (App Platform adds it when the database is linked).
- **"JWT_SECRET must be at least 32 characters long":** set `JWT_SECRET` as in step 2.3.
- **Health:** `https://<app address>/api/health` answers `{"ok":true}` when the server is running.
