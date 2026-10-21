# Deploying Perinexa1 on AWS (one EC2 server in Mumbai)

Written on 21 Oct 2026. **FAKE SAMPLE DATA ONLY** until the developer's health check and the go-live checklist are
complete (`docs/HANDOVER.md`). `docs/DEPLOY.md` is the other way (DigitalOcean App Platform); this one is AWS.

```
 Your PC ──push──▶ GitHub (perinexa1) ──CI: npm test + npm run build (.github/workflows/ci.yml)
                                │
                                │  sudo /opt/perinexa/app/deploy/deploy.sh  (run on the server when CI is green)
                                ▼
 Browser ──HTTPS──▶ Caddy ──▶ Node: Perinexa (127.0.0.1:4000) ──▶ MongoDB Atlas (AWS Mumbai)
                    └──────────── EC2 t3.small, Mumbai, Elastic IP ─────────────┘
```

No Docker, no ECR and no AWS access keys: the server reads the code from GitHub with a read-only deploy key, and CI
needs no secrets.

## 0. From the owner

- A written OK to deploy **perinexa1** with fake data.
- MongoDB Atlas account in the company's name; the developer invited as **Organization Owner**.
- GoDaddy **A record**: Name `app`, Value = the Elastic IP, TTL 600 – and the domain name.
- Company cards and budget alerts on AWS and Atlas.
- OK for GitHub Actions (CI, free minutes of a private repository).

## 1. AWS console

1. **Elastic IPs**: one address, associated with the `perinexa` instance (release any unused one – they are charged).
2. **Security group, inbound**: SSH 22 from **My IP** only (plus `13.233.177.0/29` if EC2 Instance Connect is used);
   HTTP 80 and HTTPS 443 from anywhere. Never 4000 or 27017.
3. **MFA** on every person's AWS login. The app needs no AWS access keys – create none.

## 2. The server, once (EC2 Instance Connect, Ubuntu)

```bash
# 2 GB of swap: a t3.small has 2 GB of memory, the website build needs more
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Node 24 and git
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs git
# Caddy (HTTPS): the "Debian, Ubuntu" steps at caddyserver.com/docs/install
# The app's own user
sudo adduser --system --group --home /opt/perinexa perinexa
```

## 3. The code

```bash
sudo -u perinexa ssh-keygen -t ed25519 -N "" -f /opt/perinexa/.ssh/id_ed25519
sudo cat /opt/perinexa/.ssh/id_ed25519.pub
```
GitHub → `Jayashri1107/perinexa1` → Settings → Deploy keys → Add deploy key: paste it, **write access off**. Then:
```bash
sudo -u perinexa git clone git@github.com:Jayashri1107/perinexa1.git /opt/perinexa/app
cd /opt/perinexa/app && sudo -u perinexa npm ci && sudo -u perinexa npm run build
```

## 4. The database (MongoDB Atlas)

1. Cluster **M0** (testing) on **AWS, Mumbai (ap-south-1)**, named `perinexa`. Before real patients: **M10** or larger
   with continuous backup, and one restore tried.
2. Database Access: user `perinexa`, auto-generated password (into the password manager), role *Read and write to any
   database*.
3. Network Access: the Elastic IP only (`<ip>/32`). Never "allow access from anywhere".
4. Connect → Drivers: the connection string, with `/perinexa` before the `?`.

## 5. Settings: `/opt/perinexa/app/server/.env`

Make two random values on the server (run twice):
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

```
NODE_ENV=production
API_PORT=4000
MONGO_URI=<the Atlas connection string>
JWT_SECRET=<random value 1>
SETUP_CODE=<random value 2>
CLIENT_URL=https://app.<domain>
TRUST_PROXY=1
HOSPITAL_TIME_ZONE=Asia/Kolkata
```
`sudo chmod 600 /opt/perinexa/app/server/.env`. The server refuses to start in production with an `http://` address,
`COOKIE_SECURE=false`, or a `JWT_SECRET` / `SETUP_CODE` that looks typed or copied from an example
(`productionProblems` in `server/src/config.js`). AI, SMS, WhatsApp and ABDM stay off: leave their settings out.

## 6. Keep it running, then HTTPS

```bash
sudo cp /opt/perinexa/app/deploy/perinexa.service /etc/systemd/system/ && sudo systemctl enable --now perinexa
curl -s http://127.0.0.1:4000/api/health          # {"ok":true}; if not: journalctl -u perinexa -n 50
```
When `nslookup app.<domain>` shows the Elastic IP:
```bash
sudo cp /opt/perinexa/app/deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile   # put in the address
sudo systemctl reload caddy
```

## 7. First start

1. Open `https://app.<domain>` straight away: the sign-in page asks for the setup code and creates the first super
   admin.
2. Remove the `SETUP_CODE` line from `.env`, then `sudo systemctl restart perinexa`.
3. `https://app.<domain>/api/health` → `{"ok":true}`; add it to an uptime monitor (e.g. UptimeRobot) with alerts.
4. Set up a demo hospital and staff – fake data only.

## 8. Every change after that

1. Work on a branch; push it and open a pull request. **CI** (`.github/workflows/ci.yml`) runs every test and the
   build. On GitHub → Settings → Branches, a rule for `main` with "Require status checks to pass" (the `test` check)
   keeps a red change out of `main`.
2. Merge into `main` when CI is green and you have read the change.
3. On the server: `sudo /opt/perinexa/app/deploy/deploy.sh` – it fetches `main`, runs `npm ci` and the build,
   restarts, and checks `/api/health` for a minute; if the new version is not healthy it goes back to the one before
   by itself. It refuses to run if files were changed by hand on the server.

Automatic deploys (later, if wanted): GitHub Actions with an **IAM role through OIDC** (no stored keys) that asks AWS
Systems Manager to run `deploy.sh` on the instance. Not an IAM user with access keys, and not SSH from GitHub.

## Before real patients (not done by these steps)

The High items of the health check (a health check of perinexa1 itself is still to be written): a t3.medium (4 GB)
and Atlas M10 with backups and a restore tried, two-step sign-in for staff, the DPDP Act duties (with a lawyer), an
outside security test (VAPT), the owner's approval of the DRAFT clinical content and the PC-PNDT position, and the data
agreements before AI, SMS, WhatsApp or ABDM are switched on.
