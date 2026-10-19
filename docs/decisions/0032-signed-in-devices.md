# 0032 — Signed-in devices: a browser cookie, a hardware key and a local GeoIP database

Status: Accepted · Date: 2026-10-19

## Context
F01B (`docs/specs/F01B-signed-in-devices.md`) lists each user's open sessions with where they signed in from, and names the colleagues signed in on the same device, even from another browser (owner, 2026-10-19). Better Auth stores only the sign-in IP address and the user agent of each session. Two facts shape the design. First, the office reaches the internet through one public address, so the IP address alone makes every office PC look like one device. Second, a web app cannot read an identity that a machine shares across its browsers. The owner also chose to keep IP addresses on the server: no third-party location service.

## Decision
- **Browser key.** A `vh_device` cookie (random, `HttpOnly`, 400 days) identifies a browser across its sessions. Each session stores its SHA-256. Same key means the same browser, with certainty.
- **Hardware key.** The web app reports signals that the same machine gives alike in Chrome, Edge and Firefox: system family, CPU cores, time zone, screen size in device pixels and the normalized GPU model. The API stores only their HMAC, keyed with `BETTER_AUTH_SECRET`, on the session. Same hardware key plus the same public IP address means **probably** the same device, and the screen always says "probably". Identical PCs on one network can match, and the design accepts that; it is not presented as certain.
- **Location.** The API reads the DB-IP "IP to City Lite" MMDB (CC BY 4.0) from `GEOIP_DB_PATH` into memory with a small MMDB reader, and reloads it when the file changes. A monthly crontab script on the server refreshes the file. Locations are looked up when the list is read, not stored. The screen credits DB-IP as the license requires.
- **Sign-outs go through the API.** Better Auth's session list and revoke endpoints are disabled. The `auth` module deletes sessions itself, so every sign-out of a device is audited and sends a security notice in the same transaction.

## Consequences
- Signals are fingerprinting-style data about staff machines. Only an HMAC is stored, and it is used for this list only.
- A user who clears cookies or uses a private window appears as a new browser; the hardware key may still match it.
- The API gains an optional dependency on a file outside the repo. Without it, locations show as unknown and nothing fails, so development and CI need no download.
- Last activity costs at most one `sessions` update per session every 5 minutes.
