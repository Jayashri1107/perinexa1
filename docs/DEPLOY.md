# Deploying Perinexa on DigitalOcean App Platform

> **On AWS** (one EC2 server in Mumbai, Caddy, MongoDB Atlas): `docs/DEPLOY_AWS.md`, with `deploy/` and the CI in
> `.github/workflows/ci.yml`.

**FAKE SAMPLE DATA ONLY.** This puts Perinexa online for a private demo. Real patient data waits until the developer's
health check and the go-live checklist are complete (`docs/HANDOVER.md` sections 2 and 6–8).

What you get: one web service in **Bangalore (BLR1)** that builds the website and runs the server, and a **Managed
MongoDB** cluster in the same region with daily backups. Every push to `main` on GitHub deploys again by itself.
About **$25/month** for the app (2 GB, so several people can use it at once) and **$15/month** for the database.

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
   - Key **`SETUP_CODE`**, value: another random text made the same way; tick **Encrypt**. The sign-in page asks for
     it when the first super admin is created, so nobody who finds the new address first can make themselves super
     admin. Remove it once the first super admin exists.
4. **Create resources**. The first build takes a few minutes. The app's address is shown at the top
   (`https://perinexa-xxxxx.ondigitalocean.app`).

## 3. First start

1. Open the address **straight after the first deploy**. The sign-in page asks to **create the first super admin**:
   the **setup code** (`SETUP_CODE` from step 2.3), name, email, password.
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
| `SETUP_CODE` | Asked for once, when the first super admin is created. Encrypted; remove it afterwards. |
| 2 GB instance | Enough for several people at once; 1 GB is too small. Request limits count per signed-in person, so a whole hospital behind one internet address does not share one limit. |
| `instance_count` | Copies of the server (1 to start). For more users at once, raise it to 2–3 in the App's **Settings → web → Resources** – nothing else changes: request limits, ABDM steps and background jobs are shared in the database (`docs/HANDOVER.md` section 7). |
| `RATE_LIMIT_STORE` | Not set: on the live server the request limits are counted in the database, the same for every copy. |
| `MONGO_MAX_POOL_SIZE` | Database connections per copy (50). Copies × 50 must stay under the database plan's connection limit; lower it on the smallest plan with several copies. |

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
- **Health:** `https://<app address>/api/health` answers `{"ok":true}` when the server and the database are running,
  and `503` while the database cannot be reached. Add it to a free uptime monitor that alerts you.
- **Slow screens:** the App's **Runtime logs** show "Slow request: GET /api/… 1834 ms" for any request slower than
  1.5 seconds (no names, no queries).

## Trying it with many people (fake data only)

Only against a THROW-AWAY database (its name ends in `_loadtest`), never the live one:
1. Start a server on it, then add fake staff and patients:
   `MONGO_URI=mongodb://…/perinexa_loadtest DEMO_PASSWORD=<a test password> node scripts/load-test-seed.mjs --patients 2000 --api <server address>`
   (start that server with `API_RATE_LIMIT_MAX=100000` while seeding – 2,000 registrations by one person go over the
   normal limit).
2. `DEMO_PASSWORD=<the same> node scripts/load-test.mjs --users 40 --seconds 60 --url <server address>` – pretend staff
   sign in, open the screens their role opens, never save anything; it prints how fast each screen was and any failures.

Result on 20 Oct 2026 (a laptop, two copies of the server on one database, 2,000 fake patients, 50 pretend staff each
clicking every second – several times a busy hospital): no failures, half the answers in 0.03 s, 95 in 100 in about
0.5 s. The slowest screen is the whole-hospital worklist the first time a person opens it (every pregnant patient's
care plan is read – about 2 s for 500 patients, a few seconds under heavy load); after that it is kept for that person
for 15 seconds (`WORKLIST_CACHE_SECONDS`).
