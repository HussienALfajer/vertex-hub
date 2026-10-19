# TASKS — F01B Signed-in devices

Spec: `docs/specs/F01B-signed-in-devices.md` · ADRs 0002, 0014, 0028, 0032.

PR split (from the spec, "Delivery"): PR 1 contracts, db, API, GeoIP reader and the update script · PR 2 the web card, the dialogs, the hardware report and E2E.

## PR 1 — devices API (branch `feat/f01b-devices-api`)

### 1. contracts
- [x] `devices.ts`: `signedInDeviceSchema`, `signedInDeviceListSchema`, `hardwareSignalsSchema`, sign-out-all input and result (with `.meta({ id })`); hardware normalization (system family, GPU string cleanup, at least three known signals) as pure functions with unit tests from real Chrome, Edge and Firefox strings
- [x] Error code `CURRENT_SESSION`; audit actions `user.session_signed_out`, `user.sessions_signed_out`; account email changes `device_signed_out`, `all_devices_signed_out`
- [x] `ar.json` keys: `errors.CURRENT_SESSION`, the two audit actions, audit field labels (`device`, `ipAddress`, `count`, `includedCurrent`)
- [x] Gate: `contracts` test, root `typecheck` (web typecheck passed after the bridge regenerated the client)

### 2. db (`/db-migration`, expand only)
- [x] `sessions.browser_key`, `hardware_key` (indexed), `last_active_at` (not null, default now), `last_ip_address`
- [x] Gate: `db` test (12 passed), drift: none

### 3. api
- [x] `vh_device` cookie on sign-in requests and on sessions without a browser key (rules 1–3); browser key stored on new sessions, including the two-factor step
- [x] Last activity throttle (rule 4), never failing the request
- [x] GeoIP reader: MMDB in memory from `GEOIP_DB_PATH`, hourly reload on change, private/loopback/link-local as local, failures give null (rule 7); `GEOIP_DB_PATH` in config (`.env.example` lists no optional paths); unit test with a fixture MMDB
- [x] `GET /api/me/sessions` with matches (rules 6, 14, 15), `PUT /api/me/sessions/current/hardware` (rule 5), `DELETE /api/me/sessions/:id` (rule 9), `POST /api/me/sessions/sign-out-all` (rules 10, 11)
- [x] Audit entries and security notice emails in the delete transaction (rule 12); email texts in `packages/messages`
- [x] Better Auth session list and revoke endpoints disabled (rule 13)
- [x] Tests: list with matches and locations, hardware report, the three sign-outs, 401 each, `NOT_FOUND` for another user's session, `CURRENT_SESSION`, disabled paths 404, audit and email rows; last-activity throttle
- [x] Gate: `signed-in-devices` (26), `ip-locations`, `auth`, `account-emails`, `users`, `env`, `architecture` (96 passed), `api` typecheck

### 4. server
- [x] `deploy/geoip-update.sh` (download to a temp file, check it opens, move into place), installed with the `vertexhub` crontab, `geoip/` and `GEOIP_DB_PATH` by `provision.sh`; `docs/deployment.md`

### 5. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`; gate: `web` typecheck

### Close
- [x] Reviewer: 4 blocking findings fixed (activity throttle keyed to the stored time, a stable `vh_device` value for a session's parallel requests, isolated test addresses, 403 tests on every endpoint) plus `PATH` in the crontab
- [x] Wiring checklist, full checks, owner acceptance (endpoints at `/api/docs`), PR with auto-merge

## PR 2 — devices screen (branch `feat/f01b-devices-web`)
- [x] audit log: show the `location` object of `user.session_signed_out` as a place (country in Arabic, city), not raw JSON; IP left to right
- [x] ui: `RadioGroup` and `RadioCard` in `packages/ui` (the sign-out-all choice), on the design-system page
- [x] web: card on `/account`, the two dialogs, hardware report after sign-in and on app load, `/login` messages, refetch every 60 s and on focus, `ar.json`, DB-IP attribution; unit tests for the place text and screen edges
- [x] e2e: mocks in `fixtures.ts` (a shared session list across pages), `f01b.spec.ts` (two browser contexts: list, shared-device line, sign out one, sign out all with and without this device), RTL screenshots of the card and both dialogs at desktop and phone width, both themes
- [x] Close: reviewer (2 blocking findings fixed: sign-out-all choice reset on each opening, focus after a row leaves), owner acceptance, full checks, ROADMAP, PR with auto-merge
