# Deployment

Production runs at **https://hub.vertexmedia.pro** on the owner's VPS (`ssh vertex`), following the server's conventions (ADR 0009, `/root/SERVER.md` on the server). Everything on the server comes from `deploy/` in this repository: never edit files there by hand.

Server work needs the owner's explicit approval in the current conversation (AGENTS.md).

## Layout

| What | Where |
|---|---|
| System user | `vertexhub` (no sudo), PM2 under `pm2-vertexhub.service` |
| Processes | `vertexhub-api` (127.0.0.1:3050), `vertexhub-worker` (no port) |
| Releases | `/srv/hub.vertexmedia.pro/releases/<UTC time>-<sha>`; `current` links to the active one |
| Repository mirror | `/srv/hub.vertexmedia.pro/repo.git` (public repo over HTTPS, no credentials) |
| Environment | `/srv/hub.vertexmedia.pro/shared/.env` (600), linked into each release as `.env` |
| Uploaded files (F10) | `/srv/hub.vertexmedia.pro/shared/files/` (`FILES_ROOT`; 2750 `vertexhub:www-data`, outside the releases). nginx serves them only through its internal `/_files/` location after the API answers `X-Accel-Redirect`; `shared/` is 710 so nginx can pass through it without listing it |
| Pre-migration DB snapshots | `/srv/hub.vertexmedia.pro/shared/db-snapshots/` (last 10) |
| Madani font files | `/srv/hub.vertexmedia.pro/fonts/madani/` (ADR 0011; empty until Q11). The web build loads them only when they are there, so copy them in, then deploy again |
| App logs | `/var/log/hub.vertexmedia.pro/{api,worker}.{out,err}.log` (14 days) |
| nginx logs | `/var/log/nginx/hub.vertexmedia.pro.{access,error}.log` |
| nginx site | `/etc/nginx/sites-available/hub.vertexmedia.pro` + `snippets/vertexhub-*.conf` (headers, CSP, proxy) + `conf.d/vertexhub-limits.conf` |
| Database | PostgreSQL 17, role and database `vertex_hub`, `CONNECT` revoked from `PUBLIC` |
| Daily backups | `/var/backups/hub.vertexmedia.pro/` (700, root), 03:35, 14 days |
| Health check | `vertexhub-health.timer`, every 2 minutes, restarts with a 10-minute cooldown |

| Repository file | Installed as |
|---|---|
| `deploy/provision.sh` | run once (idempotent) to set up everything below |
| `deploy/deploy.sh` | run by `/usr/local/bin/vertexhub-deploy`, always the copy on `origin/main` |
| `deploy/ecosystem.config.cjs` | PM2 process file, read from the current release |
| `deploy/bin/*` | `/usr/local/bin/vertexhub-{deploy,healthcheck}`, `/usr/local/sbin/vertexhub-backup` |
| `deploy/systemd/*` | `/etc/systemd/system/` |
| `deploy/nginx/*`, `deploy/logrotate/*` | `/etc/nginx/…`, `/etc/logrotate.d/hub.vertexmedia.pro` |

## Deploy

Merge to `main` (CI green), then:

```bash
ssh vertex vertexhub-deploy
```

What it does, in order, stopping at the first failure:
1. Fetch `origin/main` and extract it into a new release directory.
2. `pnpm install --frozen-lockfile` and `pnpm build` inside the release.
3. Snapshot the database (`pg_dump`), then apply migrations.
4. Switch `current` atomically and reload PM2.
5. Poll `/api/health` for 60 s and check that the worker is online in PM2. If PM2 fails to start the release, or it is unhealthy, switch back to the previous one.
6. Keep the last 5 releases.

The running site is untouched until step 4. A failed build or migration leaves the previous release serving. The API restarts in about two seconds during step 4.

Deploy another ref: `ssh vertex "vertexhub-deploy <sha-or-origin/branch>"`.

### Migrations must stay backward compatible

The previous release keeps running until the switch, and a rollback runs old code against the migrated database. Write migrations as expand then contract: add columns and tables first, and remove old ones in a later release once no deployed code uses them.

## Roll back

```bash
ssh vertex "vertexhub-deploy rollback"
```

Switches to the previous release. Migrations are not reverted. To restore the database as it was before a deploy, restore the snapshot named after that release (the database password reaches `pg_restore` through its environment, never its arguments):

```bash
ssh vertex "vertexhub-deploy restore <release>"
```

## Accounts

Self sign-up is disabled. User managers create accounts in the app and hand over an activation link (F01). Only the first General Manager is created on the server; the generated password is printed once, to whoever runs the command, and 2FA setup is asked at the first sign-in. Sign in and set up 2FA right away: until then, anyone who learns the password could enrol their own authenticator first. The `user.two_factor_enabled` entry in `/audit` shows who enrolled and when:

```bash
ssh -t vertex "cd /srv/hub.vertexmedia.pro/current && sudo -u vertexhub node apps/api/dist/cli/create-user.js --email <email> --name '<name>' --department general_management --role general_manager"
```

A user who lost their authenticator and backup codes gets 2FA reset the same way, with `node apps/api/dist/cli/reset-two-factor.js --email <email>`.

Before staff start working, give every department a manager (`/departments`). Unassigned work in a department goes to its managers (requests, template tasks waiting to be assigned, overdue reminders and escalations, F14 edge case 13): in a department without one, nobody is told.

## Operate

```bash
ssh vertex "sudo -u vertexhub PM2_HOME=/home/vertexhub/.pm2 pm2 list"
ssh vertex "sudo -u vertexhub PM2_HOME=/home/vertexhub/.pm2 pm2 logs vertexhub-api --lines 100"
ssh vertex "journalctl -t vertexhub-health -n 50"
ssh vertex "journalctl -t vertexhub-backup -n 20"
ssh vertex "cat /srv/hub.vertexmedia.pro/current/REVISION"      # deployed commit
```

## Backups and restore

`vertexhub-backup` writes the database dump, its table of contents, the environment, the nginx site, the deployed revision and the uploaded files. Files are a hard-linked snapshot of the previous backup (`rsync --link-dest`): a stored file never changes, so unchanged files take no extra space. Restore the database from a daily backup:

```bash
ssh vertex "runuser -u postgres -- pg_restore --clean --if-exists --no-owner --role=vertex_hub -d vertex_hub /var/backups/hub.vertexmedia.pro/<time>/database.dump"
```

Restore the files the same way (they belong to the same moment as the dump):

```bash
ssh vertex "rsync -a /var/backups/hub.vertexmedia.pro/<time>/files/ /srv/hub.vertexmedia.pro/shared/files/ && chown -R vertexhub:www-data /srv/hub.vertexmedia.pro/shared/files"
```

Backups stay on the server until an off-server destination is chosen (Q4). That is required before launch, and more pressing since files are stored (F10).

## First-time setup

Done once on 2026-09-28. To reproduce it (for example on a new server), point the DNS record at the server, then from a checkout:

```bash
ssh vertex 'bash -s' < deploy/provision.sh
ssh vertex vertexhub-deploy
ssh vertex "systemctl enable --now vertexhub-health.timer"
```

`provision.sh` generates the database password and `BETTER_AUTH_SECRET` into `shared/.env` and never prints them. It issues the certificate through a temporary HTTP-only site, so a missing certificate can never break nginx for the other sites. Re-running it reinstalls the configuration files from `origin/main` (pass another ref as an argument) and leaves the database and secrets alone.

## Changing configuration

- nginx, systemd, logrotate or scripts: change `deploy/`, merge, then re-run `provision.sh`.
- F10 (files): the first deploy that contains it needs `provision.sh` re-run first, for the files directory, `FILES_ROOT` in `shared/.env`, the upload route and the internal files location in nginx. The API refuses to start in production without an absolute `FILES_ROOT`.
- F09 (approval links): the first deploy that contains it needs `provision.sh` re-run first, for the `vhapproval` rate limit (60 requests a minute per address, burst 30) on `/api/public/`, the `/a/` location of the client page (`Referrer-Policy: no-referrer`, `noindex`, not logged), the internal `/_public_files/` location, the access log format that masks link tokens and the CSP snippet both header sets include. The worker schedules the hourly `approvals.reminders` job on its next start.
- F04 PR 3 (quote PDFs): each deploy now downloads Playwright's Chromium for the worker as `vertexhub` (`~/.cache/ms-playwright`). Its system libraries need root: after the first deploy that contains it, re-run `provision.sh` (step "Chromium libraries", `playwright install-deps chromium` from the current release). Until then the quote PDF renders fail and show "Render again"; nothing else is affected. The worker writes the PDFs under the same `FILES_ROOT` as the API (read from `shared/.env`). Rendering starts one Chromium per PDF, so Q7 (swap) matters before quotes are used in production.
- The inline theme script in `apps/web/index.html`: its hash is in the CSP in `deploy/nginx/vertexhub-csp.conf`, and `apps/web/src/csp.test.ts` fails until both match.
- Secrets: edit `shared/.env` on the server as `vertexhub`, then `pm2 reload all --update-env`. Rotating `BETTER_AUTH_SECRET` signs everyone out.
