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
| Pre-migration DB snapshots | `/srv/hub.vertexmedia.pro/shared/db-snapshots/` (last 10) |
| Madani font files | `/srv/hub.vertexmedia.pro/fonts/madani/` (ADR 0011; empty until Q11) |
| App logs | `/var/log/hub.vertexmedia.pro/{api,worker}.{out,err}.log` (14 days) |
| nginx logs | `/var/log/nginx/hub.vertexmedia.pro.{access,error}.log` |
| nginx site | `/etc/nginx/sites-available/hub.vertexmedia.pro` + `snippets/vertexhub-*.conf` + `conf.d/vertexhub-limits.conf` |
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
5. Poll `/api/health` for 60 s. If the release is unhealthy, switch back to the previous one.
6. Keep the last 5 releases.

The running site is untouched until step 4. A failed build or migration leaves the previous release serving. The API restarts in about two seconds during step 4.

Deploy another ref: `ssh vertex "vertexhub-deploy <sha-or-origin/branch>"`.

### Migrations must stay backward compatible

The previous release keeps running until the switch, and a rollback runs old code against the migrated database. Write migrations as expand then contract: add columns and tables first, and remove old ones in a later release once no deployed code uses them.

## Roll back

```bash
ssh vertex "vertexhub-deploy rollback"
```

Switches to the previous release. Migrations are not reverted. To restore the database as it was before a deploy, use the snapshot named after that release:

```bash
ssh vertex "sudo -u vertexhub pg_restore --clean --if-exists --no-owner -d \"\$(grep ^DATABASE_URL= /srv/hub.vertexmedia.pro/shared/.env | cut -d= -f2-)\" /srv/hub.vertexmedia.pro/shared/db-snapshots/<release>.dump"
```

## Accounts

Self sign-up is disabled. User managers create accounts in the app and hand over an activation link (F01). Only the first General Manager is created on the server; the generated password is printed once, to whoever runs the command, and 2FA setup is asked at the first sign-in:

```bash
ssh -t vertex "cd /srv/hub.vertexmedia.pro/current && sudo -u vertexhub node apps/api/dist/cli/create-user.js --email <email> --name '<name>' --department general_management --role general_manager"
```

A user who lost their authenticator and backup codes gets 2FA reset the same way, with `node apps/api/dist/cli/reset-two-factor.js --email <email>`.

## Operate

```bash
ssh vertex "sudo -u vertexhub PM2_HOME=/home/vertexhub/.pm2 pm2 list"
ssh vertex "sudo -u vertexhub PM2_HOME=/home/vertexhub/.pm2 pm2 logs vertexhub-api --lines 100"
ssh vertex "journalctl -t vertexhub-health -n 50"
ssh vertex "journalctl -t vertexhub-backup -n 20"
ssh vertex "cat /srv/hub.vertexmedia.pro/current/REVISION"      # deployed commit
```

## Backups and restore

`vertexhub-backup` writes the database dump, its table of contents, the environment, the nginx site and the deployed revision. Restore the database from a daily backup:

```bash
ssh vertex "runuser -u postgres -- pg_restore --clean --if-exists --no-owner --role=vertex_hub -d vertex_hub /var/backups/hub.vertexmedia.pro/<time>/database.dump"
```

Backups stay on the server until an off-server destination is chosen (Q4). That is required before launch.

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
- The inline theme script in `apps/web/index.html`: its hash is in the CSP in `deploy/nginx/vertexhub-headers.conf`, and `apps/web/src/csp.test.ts` fails until both match.
- Secrets: edit `shared/.env` on the server as `vertexhub`, then `pm2 reload all --update-env`. Rotating `BETTER_AUTH_SECRET` signs everyone out.
