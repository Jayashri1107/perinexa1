# Runbook – Perinexa on AWS (app.perinexa.com)

What to do when something needs doing or goes wrong on the live server. Written 16 Nov 2026. The full setup is in
`docs/DEPLOY_AWS.md`; the open risks are in `docs/HEALTH_CHECK.md`. Keep this page short and true – change it when the
setup changes.

## The setup in one look

| Part | Where | Notes |
| --- | --- | --- |
| Website and API | EC2 in Mumbai, Ubuntu 26.04, Elastic IP 13.201.142.178 | `/opt/perinexa/app`, user `perinexa`, service `perinexa` (port 4000, 127.0.0.1 only) |
| HTTPS | Caddy on the same server | `/etc/caddy/Caddyfile`; certificate renewed by Caddy (Let's Encrypt) |
| Database | MongoDB Atlas, AWS Mumbai | address in `/opt/perinexa/app/server/.env` (`MONGO_URI`); **M10 (paid) with Atlas backups – the owner checked on 21 Nov 2026 that `MONGO_URI` points at it** |
| Copies of the database | `/opt/perinexa/backups` on the server | made by `deploy.sh` before every deploy, newest 14 kept, root only |
| Code | GitHub `Jayashri1107/perinexa1`, branch `main` | the server pulls with a read-only deploy key |
| Checks | GitHub Actions `test` | must be green on the commit before it is deployed |

Secrets (`server/.env`, the SSH key, Atlas and AWS logins) are in the company password manager – never in git, a chat
or an email.

## Is it up?

```bash
curl -s https://app.perinexa.com/api/health        # {"ok":true}; 503 = the server runs but the database is not reachable
sudo systemctl status perinexa --no-pager          # on the server
journalctl -u perinexa -n 100 --no-pager           # the last 100 log lines
journalctl -u perinexa | grep "Startup steps"      # how long the startup steps took at each start
```

## Deploy a new version

1. On your computer: `npm test` and `npm run build` pass; merge `master` into `main`; push; GitHub's `test` check is
   green on that exact commit.
2. On the server:
   ```bash
   sudo /opt/perinexa/app/deploy/deploy.sh
   ```
   It saves the database first (nothing is deployed if that fails), fetches `main`, installs, builds, restarts and waits
   up to five minutes for `/api/health`. If the new version is not healthy it goes back to the version before by itself.
3. If the change touched `deploy/perinexa.service` or `deploy/Caddyfile`, copy it again (`docs/DEPLOY_AWS.md` section 8).
4. Open the site, sign in, open a patient – a minute of clicking.

Never on the server: `npm test`, `npm run dev`, `npm run seed:demo`, any test file, or editing files by hand
(`deploy.sh` refuses to run after a hand edit).

## Go back to the version before

`deploy.sh` does this by itself when the new version does not start. To do it by hand after a bad but healthy deploy:

```bash
cd /opt/perinexa/app && sudo -u perinexa git log --oneline -5      # find the commit to go back to
sudo -u perinexa git reset --hard <commit>
sudo -u perinexa npm ci --no-audit --no-fund && sudo -u perinexa npm run build && sudo systemctl restart perinexa
```

Then fix the problem on `master`, test, and deploy normally – the next `deploy.sh` brings the server back to `main`.
Going back changes the code only. If the bad version changed records, see the next section.

## Put the database back

**Only when records are wrong or lost, and with the owner when real patients are involved: everything entered after
the copy was saved is lost.**

```bash
sudo ls -lt /opt/perinexa/backups                                            # newest first
sudo /opt/perinexa/app/deploy/restore.sh /opt/perinexa/backups/<file>.archive.gz
```

It asks you to type `restore`, saves the database as it is now first (so a wrong restore can be undone the same way),
stops the site, restores, starts it and checks `/api/health`. Write down what was restored and why.

On Atlas M10: Atlas → the cluster → **Backup** gives daily snapshots and any minute in the last days
(Continuous Cloud Backup). Restore to a *new* cluster first, check it, and only then point `MONGO_URI` at it or restore
over the live one. **How long a restore took when it was last tried: not tried yet** – fill this in after the first try.

## When something goes wrong

| What you see | Likely cause | What to do |
| --- | --- | --- |
| Site does not load at all | server down, Caddy down, DNS | `systemctl status perinexa caddy`; AWS console → instance state; `nslookup app.perinexa.com` |
| `502 Bad Gateway` | the app is not running (restarting, crashed) | `journalctl -u perinexa -n 100`; `sudo systemctl restart perinexa` |
| `/api/health` gives 503 | the database is not reachable | Atlas status page and alerts; Atlas → Network Access still lists 13.201.142.178/32 |
| Every `/api` request gives 500, `/api/health` too, after an Atlas change (tier upgrade, maintenance) | the app kept its old database connection | `sudo systemctl restart perinexa`, then `curl -s http://127.0.0.1:4000/api/health` (seen 17 Nov 2026 after M0 → M10) |
| `deploy.sh`: "mongodump is not installed" | the tools are missing | `docs/DEPLOY_AWS.md` section 2 (Ubuntu 26.04: the `ubuntu2604` .deb) |
| `deploy.sh`: "FAILED to save the database" | Atlas refused or the disk is full | `df -h`; Atlas network access; then deploy again – never `--no-backup` without a reason |
| `deploy.sh`: "Files were changed by hand" | someone edited on the server | `sudo -u perinexa git -C /opt/perinexa/app status`; move the change into git, then `git checkout -- <file>` |
| The server will not start: "Unsafe settings for production" | `server/.env` | the message names the setting (`productionProblems` in `server/src/config.js`) |
| Disk full | logs or old copies | `df -h`; `sudo du -sh /opt/perinexa/backups /var/log/journal`; `sudo journalctl --vacuum-time=30d` |
| Certificate warning | Caddy could not renew | `journalctl -u caddy -n 50`; ports 80 and 443 open in the security group; DNS still points here |
| Many people locked out | wrong passwords (3 tries → 2 minutes) or the login limit | wait 2 minutes; an admin resets a password from the staff screen |
| An admin lost the phone with the authenticator app | two-step sign-in (health check H4) | a recovery code signs in once; otherwise the super admin: Users → the person → Reset two-step sign-in (they set it up again at the next sign-in) |
| Nobody with two-step sign-in can sign in after `JWT_SECRET` was changed | the secrets are encrypted with a key from `JWT_SECRET` | recovery codes still work; or put the old `JWT_SECRET` back; last resort `TWO_STEP_FOR_ADMINS=false` in `server/.env` and restart, then each person resets under My settings |
| Payroll says "This number can't be kept yet" (PF number, ESI number, PAN, bank account) | `PAYROLL_KEY` is not in `/opt/perinexa/app/server/.env` | make one: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`; add the line `PAYROLL_KEY=…` to `server/.env`; `sudo systemctl restart perinexa`; **put the key in the company password manager at once** – never the same value as `JWT_SECRET` |
| Payroll says "This number can no longer be read" | `PAYROLL_KEY` was changed or lost: the kept numbers were sealed with the old key | put the old `PAYROLL_KEY` back and restart; if it is lost for good, the accounts person types the numbers again (each save seals with the present key) – pay, names and everything else are not affected |
| Suspected data leak or break-in | – | do not delete anything; tell the owner at once; see "Data breach" below |

## Data breach (personal data seen or taken by someone who should not have)

1. Tell the owner straight away, with what is known so far. Do not wait to be sure.
2. Stop it if you can without destroying evidence: change the leaked password or key, block the address in the AWS
   security group, take the site offline (`sudo systemctl stop perinexa`) if patients are still exposed.
3. Keep the evidence: do not delete logs or audit entries; note times and what you saw.
4. The owner (with the lawyer) decides whom to tell – the hospitals, and under the DPDP Act the Data Protection Board
   and the people affected. The written breach procedure is still to be made (`docs/DEPLOYMENT_PLAN.md` section 7).

## Regular checks

| How often | What |
| --- | --- |
| Every deploy | the GitHub check is green; the deploy says "Saved: …" and "OK: online and healthy" |
| Weekly | `df -h` (disk); `sudo ls -lt /opt/perinexa/backups` (copies are being made); the uptime monitor shows no outages |
| Monthly | `sudo apt update && sudo apt upgrade` – **check `uname -r` first**: MongoDB 8 does not start on kernels 6.19 to 7.0.13 (matters only if MongoDB ever runs on this server); `npm audit` on your computer |
| Every 3 months (after M10) | restore one Atlas snapshot to a temporary cluster, check it, delete it, write the time here |
| Before every certificate or domain change | read `deploy/Caddyfile` and `docs/DEPLOY_AWS.md` section 6 |

## Who to call

| Role | Name | Phone | When |
| --- | --- | --- | --- |
| Owner | _to be filled in by the owner_ | | anything about patients, data, money or going offline |
| Developer | Jayashri | | the app, the server, deploys |
| AWS account | _owner's admin login_ | | billing, account locked |
| MongoDB Atlas | _organization owner_ | | the database, backups |
| Domain (GoDaddy) | _account holder_ | | DNS, renewal |

Expected answer time when the site is down: _to be agreed with the owner_.
