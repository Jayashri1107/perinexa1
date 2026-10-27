# Deployment plan – Perinexa on AWS, Mumbai (written 20 Oct 2026; nothing deployed yet)

> Copied from the owner's repository (`girishsolanke/perinexa`) on 27 Oct 2026 for reference. perinexa1 does this its own way; this file describes the owner's plan, not perinexa1.

The owner opened an AWS account on 20 Oct 2026 and asked for a step-by-step guide for the developer. This is that
guide. It is documentation only: no code changed, nothing is deployed. The health check (`docs/HEALTH_CHECK.md`)
still comes first, and the app runs with fake data only until the go-live checklist in section 7 is complete
(`CLAUDE.md`, `docs/HANDOVER.md` section 2). Section 3 is for the owner; the rest is for the developer.

Decisions behind it (the owner's chat with Claude, 20 Oct 2026): DigitalOcean refused the owner's Indian cards;
AWS India bills in rupees and takes UPI, net banking and RuPay; patient data stays in India (DPDP Act 2023, ABDM);
one always-on server, because of the parts that assume a single server (`docs/HANDOVER.md` section 7); MongoDB Atlas
rather than a hand-run MongoDB, so backups, encryption and patching are not a one-developer job. The developer may
change any of this after the health check – this plan is the starting point, not a contract.

## 1. The shape

```
staff and patients' browsers
        │  https://app.<domain>
        ▼
Amazon Lightsail instance, Mumbai (ap-south-1) – Ubuntu 24.04, 2 vCPU / 4 GB, static IP
  ├─ caddy container     : HTTPS certificate (Let's Encrypt), reverse proxy → app:4000
  └─ app container       : node server/src/index.js, NODE_ENV=production, serves client/dist and /api
        │  TLS, allowed from the static IP only
        ▼
MongoDB Atlas, AWS Mumbai (ap-south-1) – M10 dedicated cluster, continuous backup
```

- One container of the app, never two (handover section 7).
- Files (lab reports, consent scans, referral attachments) live in MongoDB (`StoredFile`), so the server holds no
  data of its own and can be rebuilt from git plus `server/.env`.
- Everything in one AWS account in the company's name, billed in rupees; Atlas through the AWS Marketplace so it lands
  on the same bill.
- When more hospitals join, the same container image moves to AWS App Runner or ECS with an Atlas private endpoint,
  after the section 7 parts are reworked (step 12). Nothing in this plan has to be undone for that.

## 2. What the app needs from a host (read from the code)

- `server/src/index.js` connects to MongoDB, prepares templates and appointments, then listens on `API_PORT`. It also
  runs two timers inside the process (reminders every hour, ABDM expiry every 15 minutes). One long-running process;
  not serverless.
- `server/src/app.js`: with `NODE_ENV=production` it serves `client/dist` and answers every non-API path with
  `index.html`. The website and the API are one origin; `CLIENT_URL` is that public address; there is no separate
  static host.
- The login cookie is `httpOnly`, `sameSite=strict` and `secure` in production (`server/src/middleware/auth.js`).
  HTTPS is mandatory, and site and API must share the origin.
- `express-rate-limit` (API: 300 a minute; login: `LOGIN_RATE_LIMIT_MAX` per 15 minutes) and the audit log use
  `req.ip`. Behind a reverse proxy Express must trust exactly one proxy hop – a code change (step 2). Today there is
  no `trust proxy` setting.
- Request bodies up to 30 MB on specific paths (`app.js`): the proxy's body limit must be above that.
- `GET /api/health` answers `{ ok: true }` (it does not check the database).
- Node 24 (what the owner's Mac runs; there is no `engines` field yet). npm workspaces with one `package-lock.json`
  at the root. `bcrypt` is a native module: the image needs a prebuilt binary or build tools.
- The client has no external fonts or scripts, so helmet's default Content-Security-Policy should pass untouched –
  step 1 confirms it.

## 3. The owner's part (before the developer starts)

Plain language. Each takes a few minutes in the AWS console unless noted.

0. **Check which kind of AWS account it is (first, 20 Oct 2026).** AWS now has two sign-ups. The classic one
   ("Sign up for AWS (advanced)") gives a *root user* with an email address and password, a Region selector at the
   top right of the console (for example "Mumbai"), and IAM. The new one ("Sign up for AWS (new)") signs in with a
   Google, Apple, GitHub or Amazon login or an "AWS Builder ID", shows **Manage projects** and settings.aws.com, has
   no Region selector, and puts an Indian customer's project in **Sydney (ap-southeast-2)** – without AWS Marketplace
   and without IAM logins for the console. This plan needs the classic kind: data in Mumbai, Atlas through the
   Marketplace, an IAM login for the developer. If the account is the new kind, create a classic account with the
   company email (aws.amazon.com → Create account → **Sign up for AWS (advanced)**) and use that one; leave the other
   empty (it costs nothing while empty). AWS India may ask for customer verification (CERT-In): use the company's PAN
   or certificate of incorporation, and the name must match the document exactly.
1. **Protect the main login.** Turn on MFA (an authenticator app on your phone) for the AWS root user. Never use the
   root login for daily work and never share it.
2. **Rupee billing.** Check the account's contact and billing address is in India, so Amazon Web Services India bills
   in rupees with a GST invoice. Add the payment method. Card auto-pay (e-mandate) covers bills up to ₹15,000; above
   that someone must pay in the console each month – decide who.
3. **A spending alarm.** Billing → Budgets → monthly budget of about ₹12,000 with email alerts at 80 % and 100 %.
4. **A login for the developer.** Signed in as the root user: search **IAM** → **Users** → **Create user** → user
   name → tick **Provide user access to the AWS Management Console** → **I want to create an IAM user** →
   **Autogenerated password**, keep **Users must create a new password at next sign-in** ticked → Next →
   **Attach policies directly** → tick `AdministratorAccess` → Next → **Create user** → on the last screen copy
   the **Console sign-in URL**, the user name and the one-time password (shown once; or **Download .csv**). Send
   her the URL and user name by email and the password by another channel. At her first login she sets her own
   password and then turns on MFA (IAM → Users → her name → **Security credentials** → **Assign MFA device** →
   Authenticator app); you can see "Virtual" in the MFA column of the Users list once she has. No access keys for
   her: she creates her own if she needs the command line. Before that, IAM → Dashboard → **Account alias** →
   `perinexa` makes the sign-in address `https://perinexa.signin.aws.amazon.com/console`. Make a second IAM user
   for yourself the same way and stop using the root login.
5. **A domain name.** Buy it in the company's name, from any registrar. The app will live at `app.<domain>`
   (for example `app.perinexa.in`). Give the developer access to the DNS settings.
6. **MongoDB Atlas on the AWS bill.** In the AWS console open AWS Marketplace, search "MongoDB Atlas
   (pay-as-you-go)", Subscribe, then follow "Set up your account" to create the Atlas organisation with the company
   email. Atlas charges then appear on the AWS invoice. If the listing is not offered to an AWS India account (AWS
   has a "Buyers in India FAQ" for the Marketplace), create the Atlas account directly at mongodb.com and pay it by
   card.
7. **Let the developer in.** Atlas → Organization → Access Manager → Invite, role "Organization Project Creator".

## 4. The developer's part, step by step

### Step 1 – Dress rehearsal on your computer (half a day)

Production mode has never been run. Before touching AWS:

```bash
npm ci
npm run build                                                   # client/dist
cd server && NODE_ENV=production COOKIE_SECURE=false node src/index.js
```

(`COOKIE_SECURE=false` only because this is `http://localhost`; never in the cloud.) Open http://localhost:4000 –
the server, not Vite – and check: login; the website's routes survive a reload (the `/{*splat}` fallback); nothing in
the browser console about Content-Security-Policy; a prescription PDF; a 5 MB lab file upload and download; a Marathi
printout; the audit log; the 30-minute inactivity logout (set `SESSION_TIMEOUT_MINUTES=1` to see it). Fix what you
find on a branch, with tests.

### Step 2 – Small code changes, on a branch (one day)

The health check still comes first; these only make the app deployable.

1. Trust exactly one proxy hop, in `createApp()` right after `const app = express();`:
   ```js
   // Exactly one reverse proxy (Caddy) sits in front of the app: take the visitor's address from it.
   app.set('trust proxy', 1);
   ```
   Without it every visitor shares Caddy's address: the login limiter would lock everyone out together and the audit
   log would record the proxy's address. (`true` is refused by express-rate-limit's validator; `1` is right.)
2. Graceful shutdown in `server/src/index.js`, so a `docker compose` restart does not cut requests:
   ```js
   const server = createApp().listen(config.API_PORT, () => { /* unchanged */ });
   const shutdown = (signal) => {
     console.log(`${signal}: shutting down`);
     server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
     setTimeout(() => process.exit(1), 10_000).unref();
   };
   process.on('SIGTERM', shutdown);
   process.on('SIGINT', shutdown);
   ```
3. Pin Node: `"engines": { "node": ">=24 <25" }` in the root `package.json`, and a `.nvmrc` containing `24`.
4. The four container files from section 6 (`Dockerfile`, `.dockerignore`, `compose.yaml`, `Caddyfile`). They are
   deployment files, not features.
5. Worth it, optional: let `/api/health` report the database – `{ ok: mongoose.connection.readyState === 1 }`, status
   503 otherwise. The uptime check then also catches a lost database.

`npm test` and `npm run build` must pass; the owner reads the change; merge to `main`; tag it.

### Step 3 – MongoDB Atlas (two hours)

1. Atlas → the organisation from section 3 → New Project `perinexa-production`.
2. Build a Database → Dedicated → **M10**, provider AWS, region **Mumbai (ap-south-1)**, name `perinexa-prod`.
   Storage 10 GB with auto-scaling on (files live in the database; a scanned report is up to 5 MB). Backup on, with
   continuous cloud backup (point-in-time restore) and the default snapshot retention. MongoDB version: the newest
   that the Mongoose 9 driver supports.
3. Security → Database Access: user `perinexa_app`, generated password of 40+ characters, a custom role with
   `readWrite` on the database `perinexa` only – not "read and write any database". No other users besides your own
   Atlas login, which has MFA.
4. Security → Network Access: nothing yet. After step 4 add the Lightsail static IP, and only that. Never
   `0.0.0.0/0`.
5. Connect → Drivers: the connection string becomes `MONGO_URI`:
   `mongodb+srv://perinexa_app:<password>@perinexa-prod.xxxxx.mongodb.net/perinexa?retryWrites=true&w=majority&appName=perinexa`
   The `/perinexa` database name in the path matters: it is where the models write.
6. Alerts: disk above 80 %, connections above 80 % of the limit, replication lag, backup failed – to your email and
   the owner's. Maintenance window: Sunday 02:00 IST.
7. No test database on this cluster. Tests run only on your computer (`docs/HANDOVER.md` section 4).

### Step 4 – The Lightsail instance (two hours)

1. AWS console → Lightsail → region **Mumbai (ap-south-1)** → Create instance: Linux, OS only, **Ubuntu 24.04
   LTS**, plan 2 vCPU / 4 GB / 80 GB (about US$24 a month), name `perinexa-prod-1`. Download the SSH key Lightsail
   makes and keep it in the company password manager.
2. Networking → Create static IP → attach it to the instance. This address goes into DNS and into Atlas's access
   list.
3. Instance → Networking → IPv4 firewall: keep SSH (22) but restrict it to your address; add HTTPS (443) and HTTP
   (80 – Caddy's certificate issuance and the redirect to HTTPS); 443 UDP too if you want HTTP/3. Nothing else: port
   4000 is never published.
4. Snapshots → enable automatic daily snapshots (the instance holds only `server/.env` and the containers; a snapshot
   costs about US$0.05 per GB).
5. SSH in as `ubuntu` and prepare the machine:
   ```bash
   sudo apt update && sudo apt full-upgrade -y
   sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
   sudo timedatectl set-timezone Asia/Kolkata
   # 2 GB of swap: the client build needs memory
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   # Docker Engine and the compose plugin from Docker's own repository:
   # follow https://docs.docker.com/engine/install/ubuntu/ (apt repository method), then
   sudo usermod -aG docker ubuntu     # log out and in again
   docker compose version
   ```
6. Add the static IP to Atlas → Network Access (step 3.4).

### Step 5 – Domain and DNS (half an hour, then waiting)

- At the registrar: an `A` record `app.<domain>` → the static IP, TTL 300.
- Wait until `dig app.<domain>` from your machine answers with the static IP. Caddy requests the certificate on its
  first start and fails if DNS is not there yet.

### Step 6 – Put the app on the server (two hours)

1. On the instance: `ssh-keygen -t ed25519 -C perinexa-prod-1`; on GitHub → the repository → Settings → Deploy keys
   → add the public key, read-only. Then:
   ```bash
   sudo mkdir -p /opt/perinexa && sudo chown ubuntu:ubuntu /opt/perinexa
   git clone git@github.com:girishsolanke/perinexa.git /opt/perinexa
   cd /opt/perinexa && git checkout <the tag from step 2>
   ```
2. `cp server/.env.example server/.env`, fill in the production values from section 5, `chmod 600 server/.env`.
   Put a copy in the company password manager: it is the one file git does not have.
3. Put the real hostname and the ops email into `Caddyfile`.
4. Build and start:
   ```bash
   docker compose build            # three to six minutes the first time
   docker compose up -d
   docker compose logs -f app      # expect: ✅ Server running on http://localhost:4000 (production)
   ```
5. From your machine: `curl -sS https://app.<domain>/api/health` → `{"ok":true}`; open the address and see the login
   page.

### Step 7 – The first super admin (ten minutes)

`server/scripts/seed.js` reads `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` from the
environment and creates the account once (safe to repeat; it also runs the data upgrades). Run it inside the
container, never the root `npm run seed` (its `pre` step tries to start a local `mongod`):

```bash
docker compose exec app node server/scripts/seed.js
```

Log in; the app forces a new password. Then remove `SUPER_ADMIN_PASSWORD` from `server/.env` and run
`docker compose up -d` again – the seed needs it once, nothing else does. Never run `seed:demo` in production: it
creates fake hospitals and patients.

### Step 8 – Checks after the first start (one hour)

- [ ] `https://app.<domain>/api/health` answers; `http://` redirects to `https://`.
- [ ] The login cookie shows `HttpOnly; Secure; SameSite=Strict` (browser dev tools → Application → Cookies).
- [ ] The audit log shows your real address, not `172.x` – trust proxy works.
- [ ] Security headers present (helmet): `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Content-Type-Options`.
- [ ] Login limiter: the 11th wrong password from one browser is refused; a second browser on another network can
      still log in.
- [ ] A 5 MB lab file upload and download; a prescription PDF; a Marathi printout.
- [ ] After an hour, `docker compose logs app` shows no "Reminders round failed".
- [ ] `docker compose restart app`: the site is back within 15 seconds; Caddy answered 502 meanwhile; nothing crashed.
- [ ] An SSL Labs test gives grade A or better.
- [ ] Reboot the instance from the Lightsail console: the containers come back by themselves (`restart:
      unless-stopped`).

### Step 9 – Backups, and prove a restore (half a day)

- Atlas: Backup → restore a snapshot to a new, temporary M10 cluster, check the data, delete the temporary cluster.
  Write down how long it took: that is the recovery time you can promise.
- Lightsail: create an instance from a snapshot, boot it, confirm `docker compose up -d` works there, delete it.
- `server/.env` and the SSH key live in the company password manager.
- Write the result into `docs/HEALTH_CHECK.md` or a short `docs/RUNBOOK.md`: how to restore, how long, who can.

### Step 10 – Monitoring (two hours)

- Uptime: Route 53 → Health checks → HTTPS to `app.<domain>`, path `/api/health`, every 30 seconds, with a
  CloudWatch alarm → SNS email to you and the owner (about US$0.50 a month). Any external uptime service does the same.
- Atlas alerts from step 3.6; the AWS budget alert from section 3.
- Logs: `docker compose logs --since 1h app`. Rotation is set in `compose.yaml` (5 files of 20 MB). Keeping logs
  longer (the CloudWatch agent) is a later step.
- Lightsail's metrics page: alarm on CPU above 80 % for 15 minutes.

### Step 11 – Releases (the routine)

1. Branch → `npm test` and `npm run build` pass → the owner reads the change → merge to `main` → tag
   `release-YYYY-MM-DD`.
2. On the server, at a quiet hour (the restart takes about 15 seconds):
   ```bash
   cd /opt/perinexa && git fetch --tags && git checkout release-YYYY-MM-DD
   docker compose build && docker compose up -d
   docker compose logs --since 2m app
   ```
3. Smoke check: health, login, open one patient. Note the release in `docs/PROGRESS.md`.
4. Roll back: `git checkout <the previous tag>` and the same two commands.
5. Data upgrades: `seed.js` runs them on demand (`docker compose exec app node server/scripts/seed.js`); a new
   migration goes the same way, and only after a fresh Atlas snapshot.
6. Monthly: `sudo apt full-upgrade` and a reboot at a quiet hour; `docker compose pull caddy && docker compose up -d`
   for Caddy; Atlas patches itself in its maintenance window.

### Step 12 – Later, when hospitals multiply

- Rework handover section 7: timers → one scheduler; rate limits and caches → Redis or the database; ABDM
  transactions → the database.
- Move the same image to App Runner or ECS Fargate in Mumbai with a VPC connector and an Atlas private endpoint;
  Atlas to M20 or M30; a staging copy on a cheaper tier with fake data.

## 5. Production values for `server/.env`

Every variable is explained in `server/.env.example` and checked by `server/src/config.js`. Production values:

| Variable | Production value | Note |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on static serving and secure cookies |
| `API_PORT` | `4000` | Caddy proxies to it; never published |
| `MONGO_URI` | the Atlas string from step 3.5 | with `/perinexa` and `w=majority` |
| `JWT_SECRET` | a new 64-byte random value | `node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"`; never the one from any Mac |
| `CLIENT_URL` | `https://app.<domain>` | exact origin, no trailing slash – CORS allows only this |
| `SESSION_TIMEOUT_MINUTES` | `30` | owner's decision |
| `LOGIN_RATE_LIMIT_MAX` | `10` | per 15 minutes per address |
| `HOSPITAL_TIME_ZONE` | `Asia/Kolkata` | |
| `TZ` | `Asia/Kolkata` | for the container's own clock; config.js ignores unknown keys |
| `COOKIE_SECURE` | leave unset | automatically on in production |
| `ANALYTICS_CACHE_SECONDS`, `ANALYTICS_PLATFORM_CACHE_SECONDS` | leave unset | defaults 60 and 300 |
| `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL` | the owner's name and company email | |
| `SUPER_ADMIN_PASSWORD` | a one-time strong password | remove after step 7 |
| `DEMO_PASSWORD` | leave empty | only `seed:demo` uses it, which never runs here |
| `OPENAI_API_KEY` | empty | until the data agreement (`docs/AI_PROVIDERS.md`); AI buttons then explain AI is off |
| `OPENAI_*` others | leave as in the example | |
| `REMINDER_PROVIDER`, `TWILIO_*` | empty | outbox mode until DLT and templates (handover section 8) |
| `WHATSAPP_MODE`, `WHATSAPP_*` | empty | off until Meta's template is approved |
| `REMINDER_SEND_HOUR`, `REMINDER_LAST_HOUR` | `10`, `19` | |
| `ABDM_MODE` | `practice` | `sandbox` with sandbox credentials; `production` only after NHA certification |
| `ABDM_PUBLIC_URL` | empty; `https://app.<domain>` once ABDM goes to sandbox | the bridge URL registered with ABDM |
| `ABDM_GATEWAY_CLIENT_ID` | `gateway` | |

## 6. The container files

Add these at the project root in step 2. The image is built on the instance itself, so there is no architecture
mismatch with a developer's Apple-silicon Mac and no registry to run.

`Dockerfile`:

```dockerfile
# Perinexa – one image with the server and the built website (docs/DEPLOYMENT_PLAN.md).
FROM node:24-bookworm-slim AS build
# bcrypt is a native module: build tools in case no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/client/dist ./client/dist
USER node
EXPOSE 4000
CMD ["node", "server/src/index.js"]
```

`.dockerignore` (keeps secrets, data and tests out of the image):

```
.git
node_modules
**/node_modules
client/dist
coverage
**/coverage
.mongo-data
**/.env*
docs
plan
*.md
**/*.test.js
**/*.test.jsx
```

`compose.yaml`:

```yaml
# Perinexa in production: Caddy (HTTPS) in front of ONE app container (docs/DEPLOYMENT_PLAN.md).
services:
  app:
    build: .
    image: perinexa-app
    restart: unless-stopped
    init: true
    env_file: server/.env
    expose: ["4000"]              # reachable from Caddy only, never published on the host
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 2g
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "5" }
  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [app]
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "5" }
volumes:
  caddy_data:
  caddy_config:
```

`Caddyfile` (replace the hostname and the email; Caddy gets and renews the certificate itself, redirects HTTP to
HTTPS; helmet already sends the security headers):

```
{
	email ops@example.in
}

app.example.in {
	encode zstd gzip
	request_body {
		max_size 32MB
	}
	reverse_proxy app:4000
}
```

Notes: `env_file` puts `server/.env` into the container's environment – the file itself is not in the image
(`.dockerignore`), and `config.js`'s `dotenv` quietly finds no file. `init: true` makes Node receive the stop signal.
The memory limit stops a leak from taking the instance down. Pin `caddy:2` to an exact version once you have tested
one.

## 7. Go-live checklist (with the owner's handover plan)

- Health check done; findings fixed or accepted in writing by the owner.
- DRAFT clinical content reviewed by the owner (handover section 10).
- Each hospital signs a contract that covers data processing. Under the DPDP Act 2023 the hospital is the Data
  Fiduciary and the company running Perinexa its Data Processor; a lawyer drafts it, together with the privacy notice
  patients see at registration, a breach procedure (who tells the hospital, how fast), and retention and erasure
  rules. This plan is not legal advice.
- Outside services stay in practice mode until each is ready: ABDM sandbox then NHA certification; WhatsApp templates
  approved by Meta; Twilio with DLT registration; OpenAI only after the data agreement (`docs/AI_PROVIDERS.md`).
- Super admin and hospital admin accounts in real people's names with strong passwords; no shared logins.
- The production database starts empty: only `seed.js`, never `seed:demo`. If demo data was ever loaded for a trial,
  drop the database and seed again before the first real patient.
- Restore proven (step 9); alerts tested (step 10); the owner knows whom to call and how fast the answer comes.
- Real patient data only after all of the above – and never on a developer's computer, in a test, or in a Claude
  chat.

## 8. What it costs (approximate list prices, 20 Oct 2026, before 18 % GST)

| Item | US$ a month |
| --- | --- |
| Lightsail 2 vCPU / 4 GB instance (4 TB transfer included) | 24 |
| Lightsail daily snapshots | about 2 |
| Static IP while attached | 0 |
| MongoDB Atlas M10, Mumbai | about 58 |
| Atlas backup storage | 3 to 5 |
| Route 53 health check | about 1 |
| Total | about 90 (≈ ₹7,700, ≈ ₹9,100 with GST) |

Plus the domain, about ₹800 to 1,500 a year. Confirm on the AWS and Atlas pricing pages; the owner's budget alert is
set at ₹12,000.

## 9. Never on the production server

- `npm run dev`, `npm test`, `npm run seed:demo`, or any test file: the `pre` steps start a local `mongod`, and a
  test run once dropped the development database (`docs/HANDOVER.md` section 4).
- A second copy of the app container (handover section 7).
- Atlas network access open to the world, or a database user with rights beyond the `perinexa` database.
- `server/.env` in git, in the Docker image, or in a chat.
- Real patient data copied anywhere: `npm run export:hospital` runs on the server only, into an encrypted disk, and
  the folder is deleted after use.
- The AWS root login for daily work.
