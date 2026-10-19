# F01B — Signed-in devices

Status: Approved · Date: 2026-10-19 · Scope: `docs/product/v1-scope.md` §F01 · ADRs: 0002, 0014, 0028, 0032

## Summary
Staff sign in from office PCs, laptops and phones, and some PCs are shared. Today nobody can see where their account is open or close a forgotten session. F01B adds a **Signed-in devices** section to My account. It lists every open session of the user with its browser and system, where it signed in from (city and country from a local GeoIP database) and its IP address, and when it was last active. It names the colleagues signed in on the same device, in the same browser or in another one. The user can sign out any other device, or all devices with or without this one, each after a confirmation.

## In scope / out of scope
- In: the list of the user's open sessions; location from a local GeoIP database (no IP leaves the server); a browser key (a long-lived device cookie) and a hardware key (signals the browser reports) on every session; "also signed in on this device" with the colleague's name and department; signing out one device, all other devices, or all devices with this one; audit entries and a security notice email; last activity kept up to date.
- Out: viewing or closing another user's sessions (archiving a user already closes them all, F01 rule 10); a "trusted devices" list (F01 rule 16 stays); any change to the new-device email (F14 email rule 15 keeps `user_devices`); map views; exact street-level location (GeoIP is city level at best).

## Roles and access
| Action | Permission | Roles and scope |
|---|---|---|
| List own signed-in devices | session | Every active user, own account only |
| Report the hardware of the current session | session | Every active user, current session only |
| Sign out one of own other devices | session | Every active user, own sessions only |
| Sign out all own devices (with or without this one) | session | Every active user, own sessions only |

A user who must still set up two-factor sign-in (F01 rule 15) cannot use these endpoints; they can sign out as today.

## Data
Changes to `sessions` (owned by `auth`, a Better Auth table; ADR 0002):

| Column | Type | Rules |
|---|---|---|
| `browser_key` | text, null | SHA-256 (hex) of the `vh_device` cookie value of the browser that holds the session. Null only until the session's next request (rule 3). Indexed. |
| `hardware_key` | text, null | HMAC-SHA-256 (hex, key `BETTER_AUTH_SECRET`) of the normalized hardware signals (rule 5). Null until the web app reports them. Indexed. |
| `last_active_at` | timestamptz, not null, default now | Last request made with the session (rule 4). |
| `last_ip_address` | text, null | Client address of that last request. `ip_address` stays the sign-in address. |

- The cookie value and the raw hardware signals are never stored and never logged.
- Location is not stored: it is looked up from the IP address when the list is read (rule 7).
- Sessions are not archived; signing out deletes the session row, as Better Auth does. The audit entry is the record (rule 12).

## States and rules
A session is **open** while its row exists and `expires_at` is in the future. Only open sessions are listed or matched.

**Identifying the browser and the device**
1. **Browser key.** Each browser gets a `vh_device` cookie: 32 random bytes, base64url, `HttpOnly`, `Secure` outside development, `SameSite=Lax`, `Path=/api`, `Max-Age` 400 days (the longest browsers keep). It is set by the API on the first sign-in request that lacks it and kept on later sign-ins and sign-outs, so it outlives every session in that browser. Each profile and private window of a browser is a separate browser.
2. A new session records the browser key of the request that created it, including the session made by the two-factor step.
3. A session without a browser key (sessions open before F01B, or a browser that dropped the cookie) gets the cookie, if needed, and its key on its next request.
4. **Last activity.** Each authenticated API request updates `last_active_at` and `last_ip_address` when `last_active_at` is more than 5 minutes old, so the write costs at most one update per session every 5 minutes. A failed update never fails the request.
5. **Hardware key.** After sign-in, and on every app load whose session has no hardware key, the web app reports the signals that the same machine gives alike in every browser: system family, CPU core count (`navigator.hardwareConcurrency`), time zone, the screen's long and short edge in device pixels, and the GPU model from WebGL, normalized (lowercase; the ANGLE wrapper, PCI ids and Direct3D suffixes removed). The API keys them with HMAC and stores the key on the current session. A signal the browser hides is reported as unknown. If fewer than three signals are known, no hardware key is stored. The implementation fixes the exact normalization with unit tests from real Chrome, Edge and Firefox strings.
6. **Same device.** Another user's open session is on **this device** when:
   - it has the same browser key (**same browser**: certain), or
   - it has the same hardware key and its last or sign-in IP address equals this session's last or sign-in IP address (**another browser on this device**: probable).

   A web app cannot read an identity that the machine shares across browsers. Two identical PCs with the same screen on the same office network give the same hardware key, so the second case is always shown as "probably". The IP condition keeps machines in different places apart.

**Location**
7. The API looks addresses up in the DB-IP "IP to City Lite" database (MMDB, CC BY 4.0) at `GEOIP_DB_PATH`, read into memory, and reloads it when the file changes (checked hourly). It returns the country code and the city name. A private, loopback or link-local address is "Local network". An unknown address, a missing file or a failed lookup gives no location: the list still loads.
8. The screen names the country in Arabic (`Intl.DisplayNames('ar')`) and the city as the database spells it (DB-IP Lite has no Arabic names). It shows the attribution "IP location by DB-IP" with its link, as the license requires.

**Signing out**
9. **One device.** The user signs out one of their other open sessions by id. Its row is deleted, so its next request is refused (401) and the web app goes to the sign-in page. Its open notification stream closes at its next ping (F14 rule 4). The current session cannot be signed out this way: it has no button, and the API refuses it (`CURRENT_SESSION`).
10. **All other devices.** Deletes every open session of the user except the current one.
11. **All devices with this one.** Deletes every open session of the user, the current one included, clears the session cookie in the response, and the web app goes to the sign-in page. The `vh_device` cookie stays.
12. Each sign-out writes one audit entry on the user (`user.session_signed_out` with the device label, sign-in IP and location; `user.sessions_signed_out` with the count and whether this device was included), and queues one security notice email to the user (F14 email; new changes `device_signed_out` and `all_devices_signed_out`), both in the same transaction as the delete.
13. Better Auth's own session endpoints (`/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`) are disabled, so every sign-out of a device goes through rules 9–12. `/sign-out` stays as it is.

**The list**
14. The list holds the user's open sessions: the current one first, then by `last_active_at`, newest first. Each shows the browser and system (`deviceOf`, as the new-device email names it), the sign-in location and IP address, the last activity, the last IP and its location when they differ from the sign-in ones, and the sign-in time.
15. Each session lists the other users signed in on that device (rule 6): name, picture, primary department, the match (same browser or probably another browser) and their last activity. A user is listed once per session, with the stronger match. Every employee sees these names (owner, 2026-10-19). Archived users have no sessions (F01 rule 10), so they never appear.
16. Activity in the last 5 minutes shows as "Active now".

## API
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/me/sessions` | session | — | `signedInDeviceListSchema`: `{ items: SignedInDevice[] }` | — |
| `PUT /api/me/sessions/current/hardware` | session | `hardwareSignalsSchema` | 204 | — |
| `DELETE /api/me/sessions/:id` | session | — | 204 | `NOT_FOUND` (not one of the user's open sessions), `CURRENT_SESSION` |
| `POST /api/me/sessions/sign-out-all` | session | `{ includeCurrent: boolean }` | `{ signedOut: number }` (clears the session cookie when `includeCurrent`) | — |

`SignedInDevice`: `id`, `current`, `device` (`browser`, `system`, `label`), `signIn` (`at`, `ip`, `location`), `lastActive` (`at`, `ip`, `location`), `sharedWith[]` (`user` (`id`, `name`, `image`), `department` (code and name, or null), `match`: `same_browser` | `same_device`, `lastActiveAt`). `location` is `{ countryCode, city | null }`, `{ local: true }`, or null. The session token is never returned. Another user's session id answers `NOT_FOUND`, never `FORBIDDEN`.

`hardwareSignalsSchema`: `cores` (int 1–512 or null), `timeZone` (IANA name ≤ 64 or null), `screen` (`long`, `short`: int 1–20000, or null), `gpu` (string ≤ 200 or null). The system family is taken from the session's user agent, not from the request.

## Screens
**My account → Signed-in devices** (`/account`, a new card below Two-factor sign-in)
- Header: "Signed-in devices" and a short hint ("Where your account is open now. Sign out any device you don't recognize.").
- One row per session: a computer or phone icon from the system; "Chrome · Windows"; a "This device" badge on the current one; a line "Damascus، سوريا · 185.12.34.56" (IP in an LTR span); "Signed in <date and time>"; "Active now" or "Last active <relative time>"; "from <IP> · <place>" when the last IP differs. Other rows have a "Sign out" button (outline, small).
- Shared device, under the row, in a muted box with the users icon: "Also signed in on this device: **Ahmad Saleh** (Design), in this same browser", or "…probably in another browser on this device" with a hint tooltip explaining "probably". Several users are listed one per line.
- Footer: "Sign out of all devices" (destructive outline) and the DB-IP attribution in small muted text.
- **Sign out one device** confirmation (AlertDialog): title "Sign out of Chrome · Windows?"; body names the place, IP and last activity, and says the device must sign in again; "Sign out" (destructive) and "Cancel". On success: a toast, the row leaves the list.
- **Sign out of all devices** confirmation (AlertDialog): title "Sign out of all devices"; body says how many other devices are open; two choices as radio cards:
  - "All devices except this one" (default; disabled with the hint "No other devices" when there are none),
  - "All devices, including this one" (you will be signed out here too).
  "Sign out" (destructive) and "Cancel". Without this device: a toast and the list shows the current session only. With this device: the session cache is cleared and the app goes to `/login`, which shows "You were signed out of all devices."
- Buttons show a pending state; a second click is ignored while one is pending.
- Loading: three skeleton rows. Error: `LoadError` with retry. The list refetches on window focus and every 60 seconds while the page is open.
- A `NOT_FOUND` on sign-out (the device signed out meanwhile) shows "This device was already signed out" and refetches.
- Phone width: each row stacks (device, then place, then times), the button goes full width under the row, and the footer buttons stack.
- When the web app's own session is refused (signed out from elsewhere), it goes to `/login` with "You were signed out from another device."

All texts go through i18next; physical left and right are never used (RTL).

## Audit, notifications and jobs
- Audit: `user.session_signed_out` and `user.sessions_signed_out` (rule 12), with Arabic labels in the audit log screen.
- Email: a security notice to the user for each sign-out action (rule 12; texts in `packages/messages`, the account email layout of F14).
- No in-app notification and no job. Updating the GeoIP database is a server task: `deploy/geoip-update.sh`, run monthly by the site user's crontab, downloads the current DB-IP Lite MMDB to a temporary file, checks it opens, and moves it into place. The API picks it up within an hour (rule 7). `docs/deployment.md` documents it.

## Edge cases
1. Two tabs of the same browser share one session: one row.
2. Signing in as user B in a browser where user A's session is still open (A did not sign out): A's session stays open until it expires, and both lists show the other as "same browser". That is the correct warning.
3. Two clicks or two tabs signing out the same device: the second gets `NOT_FOUND` (edge case message) and no second audit entry.
4. "All except this one" while another device signs in at the same moment: the new session is not deleted. The list refetch shows it.
5. The current session expires while the page is open: the next request is refused and the app goes to sign-in.
6. Behind nginx the client address comes from `X-Forwarded-For`, which nginx overwrites (as today). In development it is `127.0.0.1`: "Local network".
7. An IPv6 address shows in full, in an LTR span that may wrap.
8. A browser that blocks WebGL or reports no cores: fewer signals; with fewer than three, no hardware key and no "another browser" matches for that session (rule 5).
9. A user resizes or changes the monitor: the hardware key is fixed when first reported in a session, so matches change only at the next sign-in.
10. A missing or corrupt GeoIP file: locations show as unknown, an error is logged once per reload, the list works.
11. Signing out all devices including this one with other tabs open: those tabs are refused at their next request and go to sign-in.
12. Many sessions (a user who never signs out): every open session is listed; sessions last 7 days, so the list stays short.

## Open questions
None.

## Acceptance
- Owner, in the browser:
  1. Sign in as user A in Chrome and in Edge on the same PC, and on a phone. My account lists three devices with the right browsers, places and IPs; the Chrome row says "This device".
  2. In Chrome, sign out of A without signing out, sign in as user B. B's list shows "Also signed in on this device: A, in this same browser". In Edge, A's list shows B "probably in another browser on this device".
  3. As A in Edge, sign out the phone: confirmation, the row leaves, the phone goes to sign-in at its next action, and A gets a security notice email.
  4. Sign out of all devices except this one: only Edge remains. Then sign out of all devices including this one: Edge goes to the sign-in page with the message.
  5. The audit log shows the three sign-outs.
- Tests: API (list with matches and locations, hardware report, sign-out one / all / all with current; 401 for each; `NOT_FOUND` for another user's session; `CURRENT_SESSION`; disabled Better Auth paths answer 404; audit and email rows written in the transaction); unit (hardware normalization from real browser strings, match rules, GeoIP lookup with a fixture MMDB including private addresses, last-activity throttle); E2E with two browser contexts (list, shared-device line, sign out one, sign out all with and without this device) and RTL screenshots of the card and both dialogs at desktop and phone width.
- Delivery: PR 1 contracts, db, API, GeoIP reader and the update script; PR 2 the web card, the dialogs, the hardware report and E2E.
