# Security and access audit

- Date: 2026-09-30 · Commit: 9463f9f
- Scope covered: every controller and route in `apps/api/src` (access declaration and permission checked against `packages/contracts/src/permissions.ts`, ADR 0014 and the actions tables of F01, F02, F05, F06, F07, F14); object-level access helpers and services (`client-access.ts`, `project-access.ts`, `retainer-access.ts`, `task-access.ts`, users, departments, notes, contacts, platform accounts, milestones, retainer cycles, extra work, template runs, comments, checklist and links, notifications); Better Auth configuration (`auth.config.ts`: disabled paths, hooks, 2FA, sessions, rate limits, trusted origins, IP header), the global `PermissionsGuard`, activation/reset links, the `user:create` and `user:reset-two-factor` CLIs, the SSE notifications stream (API and web client), CORS, headers (nginx CSP snippet), error bodies, pino logging and redaction, input validation (params, bodies, URLs), `deploy/` (nginx site and snippets, provision, deploy, backup, health check, PM2, systemd, logrotate), `docs/deployment.md`, CI secret scanning, git history for committed secrets, dependency advisories.
- Not covered: the Better Auth, `@thallesp/nestjs-better-auth` and `better-call` sources (their `dist/` folders are blocked by the permission rules), so cookie defaults (SameSite, Secure), the body parsers the Nest module registers, and how `disabledPaths` treats trailing slashes were not read and are marked `Likely` where they matter. `.env.example` is blocked too; its keys were read from `git log -p` with values masked. Server-side files referenced by the nginx config but not in the repository (`snippets/security-headers.conf`, the `general` and `perip` zones, fail2ban jails) and the server itself were not inspected (no production access). No tests were run (area 5 runs them).
- Checks run: `pnpm audit --prod` → 1 moderate (esbuild ≤0.24.2, dev server only); `pnpm audit` → same single moderate; targeted `git log --all -p` greps for passwords, auth secrets, connection strings with passwords, private keys, cloud and GitHub tokens → nothing committed except CI-only and placeholder values; `git ls-files` for env, key and certificate files → only `.env.example`.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| SEC-01 | High | Backups stay on the same server, and each one bundles the database dump with the production secrets | `deploy/bin/vertexhub-backup:3` |
| SEC-02 | Medium | Deploy snapshot and restore commands put the database password in process arguments | `deploy/deploy.sh:91` |
| SEC-03 | Medium | API routes outside `/api/auth` have no Origin/CSRF check and rely on SameSite cookies alone | `apps/api/src/modules/auth/auth.module.ts:32` |
| SEC-04 | Medium | Anonymous link redemption hashes the password before checking the token, with no rate limit | `apps/api/src/modules/auth/user-links.service.ts:66` |
| SEC-05 | Low | Environment validation fails open: production safety depends on `NODE_ENV` and `APP_URL` being set by hand | `apps/api/src/core/config/env.ts:6` |
| SEC-06 | Low | All brute-force and connection limits are per IP, which the whole office shares | `apps/api/src/modules/auth/auth.config.ts:104` |
| SEC-07 | Low | An open notification stream outlives the revocation of its session for up to 15 minutes | `apps/api/src/modules/notifications/notifications.controller.ts:109` |
| SEC-08 | Low | The archived-user check at sign-in answers before any password hashing (timing oracle) | `apps/api/src/modules/auth/auth.config.ts:141` |
| SEC-09 | Low | A user who must enrol in 2FA can be pre-empted by anyone who knows their password | `apps/api/src/modules/auth/auth.config.ts:169` |
| SEC-10 | Low | CI actions are referenced by mutable tags | `.github/workflows/ci.yml:38` |
| SEC-11 | Info | `users.manage` holders can take over any non-GM account and grant themselves Finance (by spec) | `apps/api/src/modules/auth/users.service.ts:240` |
| SEC-12 | Info | One moderate advisory, build-time only (esbuild via drizzle-kit) | `pnpm audit` |
| SEC-13 | Info | Security-relevant nginx pieces live outside the repository | `deploy/nginx/vertexhub-headers.conf:6` |

Counts: Critical 0 · High 1 · Medium 3 · Low 6 · Info 3

## Findings

### SEC-01 — Backups stay on the same server, and each one bundles the database dump with the production secrets

- **Severity:** High
- **Confidence:** Confirmed
- **Location:** `deploy/bin/vertexhub-backup:3-4` (`deploy/bin/vertexhub-backup:19-21`, `docs/deployment.md:98`, `deploy/deploy.sh:91`)
- **Evidence:** The script says so itself: `# ... Off-server copies need a destination (open question Q4) and are required before launch.` The runbook repeats it: "Backups stay on the server until an off-server destination is chosen (Q4). That is required before launch." Every backup directory holds `database.dump` next to `cp "/srv/$SITE/shared/.env" "$target/environment"`, i.e. `BETTER_AUTH_SECRET` (which also encrypts the TOTP secrets in `two_factors`, `packages/db/src/schema/auth.ts:105`) and the database password. Session tokens are stored in clear in `sessions.token` (`packages/db/src/schema/auth.ts:46`), so they are in every dump too. The pre-migration snapshots (`deploy/deploy.sh:91`) are on the same disk as well.
- **Impact:** A disk failure, a provider incident, a mistaken `rm`, or ransomware on the VPS loses the database and every backup together: clients, projects, tasks, audit log. When copies are later shipped off-server as they are today, whoever reads one copy gets live sessions, the auth secret and the database password at once.
- **Suggested fix:** Before launch, answer Q4 and add an off-server copy step to `vertexhub-backup` (for example `restic` or `age`-encrypted upload), with the encryption key kept off the server. Keep `.env` out of the database backup set or encrypt it separately; it changes rarely and can be stored once in the owner's password manager. Add a restore drill to `docs/deployment.md` and log the off-server upload result under `vertexhub-backup` so the health check can alert on a missed day.

### SEC-02 — Deploy snapshot and restore commands put the database password in process arguments

- **Severity:** Medium
- **Confidence:** Likely (depends on whether `/proc` is mounted with `hidepid` on the server, not checked)
- **Location:** `deploy/deploy.sh:91` (`docs/deployment.md:67`)
- **Evidence:** `(umask 077 && pg_dump --format=custom --file="$snapshot" "$DATABASE_URL")`, where `DATABASE_URL=postgres://vertex_hub:<password>@127.0.0.1:5432/vertex_hub` (`deploy/provision.sh:99`). The runbook's restore does the same: `pg_restore ... -d "$(grep ^DATABASE_URL= .../shared/.env | cut -d= -f2-)"`. `provision.sh:83` states the rule this breaks: `# Through stdin, not argv: other users on the server can read process arguments.`
- **Impact:** The VPS hosts other sites, each with its own system user (ADR 0009). While `pg_dump` runs on every deploy, any local user or compromised neighbour site can read the full connection string, password included, from `ps`/`/proc/<pid>/cmdline`, and then connect to the Vertex Hub database on loopback.
- **Suggested fix:** Pass the credentials through the environment or a password file, not argv: in `deploy.sh`, split `DATABASE_URL` into `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` (the environment of a process is readable only by its owner and root) and call `pg_dump --format=custom --file="$snapshot"` with no connection argument; or have `provision.sh` write `/home/vertexhub/.pgpass` (600). Change the restore line in `docs/deployment.md` the same way. Re-check with `bash -n`.

### SEC-03 — API routes outside `/api/auth` have no Origin/CSRF check and rely on SameSite cookies alone

- **Severity:** Medium
- **Confidence:** Likely (Better Auth's default `SameSite=Lax` and the parsers added by the Nest module were not read, see "Not covered")
- **Location:** `apps/api/src/modules/auth/auth.module.ts:32` (`apps/api/src/modules/auth/auth.config.ts:81`, `apps/api/src/modules/auth/permissions.guard.ts:41-75`)
- **Evidence:** Better Auth checks the request Origin against `trustedOrigins: [env.APP_URL]` only for its own endpoints under `/api/auth`. The Nest routes are authenticated by the session cookie alone: `PermissionsGuard.canActivate` reads the session from the request headers and checks permissions, with no Origin, `Sec-Fetch-Site` or custom-header check, and there is no other middleware or guard for it (`grep` for csrf/origin in `apps/api/src` finds only the Better Auth option). Several state changes need no body at all, so a plain HTML form can trigger them: `POST /api/users/:id/archive`, `/restore`, `/link` and `/two-factor/reset` (`users.controller.ts:97-151`), `POST /api/tasks/:id/archive`, `POST /api/clients/:id/archive`, `POST /api/me/notifications/read-all`, milestone `complete`/`reopen`/`archive`.
- **Impact:** SameSite=Lax blocks cross-site requests, but not same-site ones: any page on another `*.vertexmedia.pro` host (the agency's public site, or another site on the same VPS if it uses that domain) that is compromised or allows user HTML can make a signed-in General Manager or Operations manager archive users and clients, reset someone's 2FA, or reopen work, without their knowledge. The responses cannot be read cross-origin, so links are not leaked, but the changes happen.
- **Suggested fix:** Add a global guard (or middleware in `app.setup.ts`) that refuses non-GET/HEAD/OPTIONS requests unless `Origin` (or, when missing, `Referer`) equals `APP_URL`, or `Sec-Fetch-Site` is `same-origin`; apply it to every route including `@AllowAnonymous` ones. Cover it with an integration test in `test/auth.test.ts`: a POST with a foreign `Origin` and a valid cookie answers 403.

### SEC-04 — Anonymous link redemption hashes the password before checking the token, with no rate limit

- **Severity:** Medium
- **Confidence:** Confirmed (code); the size of the effect on the server is not measured
- **Location:** `apps/api/src/modules/auth/user-links.service.ts:66` (`apps/api/src/modules/auth/password-links.controller.ts:13-15`, `deploy/nginx/hub.vertexmedia.pro:48-58`)
- **Evidence:** `async redeem({ token, password }) { const passwordHash = await hashPassword(password); await this.db.transaction(...` : the scrypt hash runs for every request, before the token lookup. The route is `@AllowAnonymous()`. Better Auth's rate limiter covers only `/api/auth/*`, the API has no throttler, and nginx gives this path only the site-wide `limit_req zone=general burst=50` (zone rate defined outside the repository); the tight `vhsignin` zone is applied to `/api/auth/sign-in/email` only.
- **Impact:** Anyone on the internet can post random tokens with 128-character passwords and make the single API process (`deploy/ecosystem.config.cjs:9`, `instances: 1`) spend CPU on scrypt for each request, slowing or stalling the app for all staff. Token guessing itself is not a risk (32 random bytes, stored as SHA-256).
- **Suggested fix:** Look up the link first (`select ... for update` on the hashed token) and hash the new password only when it is valid; move `hashPassword` inside the transaction after the check. Add `location = /api/password-links/redeem { limit_req zone=vhsignin burst=5 nodelay; ... }` in the nginx site. Test: a request with an unknown token answers `LINK_INVALID` without calling `hashPassword` (spy in a unit test of `UserLinksService`).

### SEC-05 — Environment validation fails open: production safety depends on `NODE_ENV` and `APP_URL` being set by hand

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/src/core/config/env.ts:6` (`env.ts:14`, `env.ts:21-33`, `apps/api/src/app.setup.ts:16`, `deploy/ecosystem.config.cjs:6-19`)
- **Evidence:** `NODE_ENV: z.enum([...]).default('development')`; `APP_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:5173')`; the auth secret is required only `env.NODE_ENV !== 'production' || env.BETTER_AUTH_SECRET`, otherwise it falls back to `createHash('sha256').update(\`vertex-hub-dev-auth:${env.DATABASE_URL}\`)`; Swagger is mounted `if (env.NODE_ENV !== 'production')`. The PM2 ecosystem sets no `env`, so the values come only from `shared/.env`. `provision.sh:93-97` writes them today, so the current setup is correct.
- **Impact:** If `NODE_ENV` or `APP_URL` is ever lost from `.env` (hand edit, restore of an older file, new server), the API starts without error but signs sessions with a secret derived from the database URL, serves `/api/docs` (nginx hides it only on the public path), and with an `http` `APP_URL` issues cookies without `Secure` and trusts the wrong origin.
- **Suggested fix:** Set `env: { NODE_ENV: 'production' }` for both apps in `deploy/ecosystem.config.cjs`, and in `envSchema` refuse `production` with an `APP_URL` that is not `https`. Unit-test `parseEnv` for both refusals.

### SEC-06 — All brute-force and connection limits are per IP, which the whole office shares

- **Severity:** Low
- **Confidence:** Confirmed (configuration); office traffic volume not measured
- **Location:** `apps/api/src/modules/auth/auth.config.ts:104-114` (`auth.config.ts:215`, `deploy/nginx/vertexhub-limits.conf:4-8`, `deploy/nginx/hub.vertexmedia.pro:54-65`)
- **Evidence:** `'/sign-in/email': { window: 60, max: 5 }`, `'/two-factor/verify-totp': { window: 60, max: 5 }`, keyed on `ipAddressHeaders: ['x-forwarded-for']`; nginx adds `limit_req_zone $binary_remote_addr zone=vhsignin:10m rate=10r/m` and `limit_conn vhstream 60`. The nginx comment notes "an office shares one public IP". There is no per-account counter. The API trusts `X-Forwarded-For` from any caller; only its loopback binding keeps that safe.
- **Impact:** Availability: a handful of staff signing in (plus typos) in the same minute at the office locks everyone there out for a minute; more than 60 open tabs across the office lose the live stream. Security: guessing is limited per address only, so an attacker spreading attempts over many addresses is not slowed per account; any local process on the VPS can reach `127.0.0.1:3050` directly and set its own `X-Forwarded-For`.
- **Suggested fix:** Keep F01 rule 18, and add a per-account limit on failed sign-in and 2FA attempts (for example a counter keyed on the email in the `before` hook, or Better Auth `customRules` with a key function if the version supports it). Raise the per-IP limit for the office address or allow-list it in nginx, and confirm the stream connection cap against the office size. Decision needed (see Open questions).

### SEC-07 — An open notification stream outlives the revocation of its session for up to 15 minutes

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/notifications/notifications.controller.ts:109-114` (`apps/api/src/modules/notifications/notification-stream.ts:42-50`)
- **Evidence:** The session is checked once, by the guard, when the stream opens; then `this.stream.subscribe(current.id, ...)` and `setTimeout(close, NOTIFICATION_STREAM_LIFETIME_MS)` (15 minutes). Nothing closes a user's streams when their sessions are deleted: `redeem` deletes sessions (`user-links.service.ts:106`), archiving deletes sessions (`users.service.ts:258`), and `change-password` with `revokeOtherSessions` revokes the others.
- **Impact:** After a password reset or "sign out other sessions" (the usual response to a stolen session), the attacker's open stream keeps receiving the user's new notifications (task titles, comment excerpts, client names) for up to 15 minutes. Archived users receive no new notifications, so archiving is not affected.
- **Suggested fix:** Add `NotificationStream.closeUser(userId)` and call it after the transactions that delete a user's sessions (redeem, archive) and from the Better Auth `after` hook for `/change-password`, `/revoke-sessions` and `/revoke-other-sessions`; or re-check the session on each ping and close when it is gone. Test: open a stream, redeem a link for that user, expect the stream to end.

### SEC-08 — The archived-user check at sign-in answers before any password hashing (timing oracle)

- **Severity:** Low
- **Confidence:** Likely (assumes Better Auth hashes or verifies a password on the unknown-user and wrong-password paths, which was not read)
- **Location:** `apps/api/src/modules/auth/auth.config.ts:141-152`
- **Evidence:** `if (ctx.path === '/sign-in/email') { ... select archivedAt ... if (user?.archivedAt) { throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD); } }`: the error body is the same as for a wrong password (F01 rule 10), but it returns after one indexed query, while a wrong password costs a scrypt verification.
- **Impact:** Someone probing sign-in can tell archived staff emails (former employees) from unknown or active ones by response time. Low value, but it undoes the intent of rule 10.
- **Suggested fix:** Remove the pre-check and rely on the `databaseHooks.session.create.before` check (`auth.config.ts:126-134`), which already refuses archived users after the password step with the same error; or run a dummy `hashPassword` before throwing.

### SEC-09 — A user who must enrol in 2FA can be pre-empted by anyone who knows their password

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/auth/auth.config.ts:169-175` (`auth.config.ts:54`, `docs/deployment.md:72-75`)
- **Evidence:** A required user without 2FA gets a full session after the password step and may call every path starting with `/two-factor/` (`OPEN_WHILE_TWO_FACTOR_PENDING`), including enable, which asks only for the password. The first General Manager is created with a printed password and "2FA setup is asked at the first sign-in"; a user who becomes Finance or Operations manager is in the same state until they enrol (F01 edge cases 3 and 4).
- **Impact:** During that window, whoever has the password (shoulder-surfed, reused elsewhere, seen in a terminal scrollback) can enrol their own authenticator first and lock the owner out of a General Manager or Finance account. The `user.two_factor_enabled` audit entry records it, but nobody is alerted.
- **Suggested fix:** Accepted-risk candidate. Cheap mitigations: notify the user managers (F14 `NotificationCenter`) when a required user enables 2FA; tell the owner to sign in and enrol immediately after `user:create`, in `docs/deployment.md`.

### SEC-10 — CI actions are referenced by mutable tags

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `.github/workflows/ci.yml:38-40` (`ci.yml:65-67`, `ci.yml:74`, `ci.yml:88-94`)
- **Evidence:** `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `gitleaks/gitleaks-action@v3` (given `GITHUB_TOKEN`). The workflow's token is read-only (`permissions: contents: read`), which limits the damage.
- **Impact:** A compromised or re-tagged third-party action runs in CI with the repository checkout and token; main merges are gated on these checks, so a tampered action could also turn a check green.
- **Suggested fix:** Pin each action to a full commit SHA with the version in a comment, and let Dependabot (`github-actions` ecosystem) propose updates.

### SEC-11 — `users.manage` holders can take over any non-GM account and grant themselves Finance (by spec)

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/auth/users.service.ts:240-245` (`users.service.ts:297-303`, `users.service.ts:445-446`, `apps/api/src/modules/auth/user-links.service.ts:47-49`, `apps/api/src/modules/auth/departments.service.ts:122-126`)
- **Evidence:** The reset link URL is returned to the manager who issues it (F01 rule 13), `resetTwoFactor` needs only `users.manage`, and `changeRoles` restricts only `general_manager` (`if (touchesGeneralManager && !isGeneralManager(actor))`), so the Operations manager can add `finance` to their own account (gaining `invoices.manage`, `payments.manage`, `reports.finance`) or appoint any member as manager of any department. All of this matches the F01 actions table and every step is audited.
- **Impact:** No defect against the spec. It means the Operations manager account is nearly as powerful as a General Manager's, including over money once F13 ships; separation of duties rests on the audit log alone.
- **Suggested fix:** Owner decision: consider making `finance` (like `general_manager`) GM-only to grant, and refusing role changes on one's own account. Until then, have a General Manager review `user.roles_changed`, `user.link_issued` and `user.two_factor_reset` entries in `/audit`.

### SEC-12 — One moderate advisory, build-time only (esbuild via drizzle-kit)

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `pnpm audit --prod` output
- **Evidence:** `moderate │ esbuild enables any website to send any requests to the development server and read the response` (GHSA-67mh-4wv8-2f99), `esbuild <=0.24.2`, path `apps__api>better-auth>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild`. `1 vulnerabilities found`.
- **Impact:** None in production: the vulnerable code is esbuild's dev server, which the API never starts. It shows up under `--prod` only because `better-auth` declares `drizzle-kit` as a dependency.
- **Suggested fix:** No action before deploy. Re-run `pnpm audit --prod` in CI (non-blocking) or add a `pnpm.overrides` for `esbuild` once better-auth drops the old loader.

### SEC-13 — Security-relevant nginx pieces live outside the repository

- **Severity:** Info
- **Confidence:** Likely (the files exist on the server per the comments; not checked)
- **Location:** `deploy/nginx/vertexhub-headers.conf:6` (`deploy/nginx/hub.vertexmedia.pro:38-39`, `deploy/provision.sh:142-148`)
- **Evidence:** `include snippets/security-headers.conf;` (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy), `limit_conn perip 100;` and `limit_req zone=general burst=50 nodelay;` refer to zones and a snippet that `provision.sh` does not install, and the fail2ban jails are only reloaded.
- **Impact:** The site's HSTS and the general request limit depend on server state that this repository neither reviews nor reproduces; a new server or a change to the shared snippet silently changes Vertex Hub's headers and limits.
- **Suggested fix:** Either vendor a Vertex Hub copy of the headers and zones into `deploy/nginx/` (installed by `provision.sh`), or have `provision.sh` check that `snippets/security-headers.conf` exists and contains `Strict-Transport-Security`, and that the `general` and `perip` zones are defined (`nginx -T | grep`), failing otherwise.

## Strengths

- Every route declares its access, and the architecture test enforces it. The guard recomputes roles, department capabilities and the 2FA requirement on every request, so role and department changes apply immediately.
- Object-level access is centralised and consistent: `readableClient`/`manageableClient`, `readableProject`/`workableProject`, `readableRetainer`/`workableRetainer`, `readableTask` + `taskRights`, and "scope all" checks in the services. Every child record (contacts, notes, platform accounts, milestones, cycle lines, extra work, comments, checklist items, links, notifications) is looked up by both its own id and its parent id, so no cross-record IDOR was found. Archived records answer 404 outside scope all.
- Money fields are gated by `seesMoney`, and response schemas drop anything not declared (`StandardSchemaSerializerInterceptor`), so list endpoints cannot leak them.
- Activation/reset tokens are 32 random bytes, stored only as SHA-256, single-use, 72 h, carried in the URL fragment, and redeeming them revokes sessions. The audit log never stores tokens, links or secrets.
- Better Auth is locked down: self sign-up and unused endpoints disabled, trusted devices refused, archived users refused at session creation, 2FA required users held back in both the Better Auth hook and the API guard, and a required user cannot disable 2FA.
- User-supplied URLs are limited to `http(s)` (`httpUrlSchema`), React renders all text (no `dangerouslySetInnerHTML`), and the CSP is strict (hashed inline script, `frame-ancestors 'none'`, `connect-src 'self'`).
- No CORS, one origin; the API listens on loopback and nginx overwrites `X-Forwarded-For`. pino redacts cookies, authorization and `set-cookie`. Swagger is off in production and blocked in nginx.
- Deploy hygiene: secrets generated on the server and never printed, `shared/` 700 and `.env` 600, the DB role created through stdin, a dedicated no-sudo user, a snapshot before each migration, automatic rollback on a failed health check, and gitleaks scanning the full history in CI. No secrets were found in the git history.

## Open questions

- **Off-server backups (Q4 in `docs/open-questions.md`):** where encrypted copies go, and who holds the key. Blocks SEC-01.
- **Rate limits with a shared office IP (SEC-06):** keep F01 rule 18's 5 attempts per minute per IP, allow-list the office address, or add per-account limits? The owner knows the office's public IP setup.
- **Other `vertexmedia.pro` subdomains (SEC-03):** which hosts share the registrable domain and who controls their content. This decides how urgent the Origin check is.
- **Separation of duties (SEC-11):** should granting Finance, or changing one's own roles, be limited to General Managers?
