# 0039 — HR: one module, attendance proved by a rotating code, a passkey and the office network, leave as a ledger

Status: Proposed · Date: 2026-10-21

## Context
F17 (`docs/specs/F17-hr-files-attendance-leave.md`) adds employee files, attendance and leave. The owner decided (2026-10-20, 2026-10-21):
- at the office, the employee scans a QR code that changes about every 20 seconds on an entrance screen and confirms with a passkey on their own phone;
- deductions apply only after the General Manager approves them, and the General Manager decides every request;
- salaries are visible to the General Manager and Finance only.

The owner also raised that a code can be passed on by photo or video call, and chose to refuse any office check-in that does not come from the office network. Salaries need F19 later, so attendance must hand over stable monthly figures. ADR 0017 counts work days without holidays.

## Decision
- **One `hr` module** owns employee files, salary changes, schedules, holidays, settings, passkeys, entrance screens, punches, days, items, requests, the leave ledger and months. Privacy is enforced by permissions inside it (`employees.*`, `salaries.*`, `payouts.manage`, `hr.read`, `hr.manage`, `hr.approve`), with tests that no salary leaves without `salaries.read`. It reads tasks, shoots and meetings through their exported services, archives users through `auth`'s exported service, and registers the `employee` and `hr_request` owner policies in F10. `tasks` and `calendar` ask an exported `LeaveDirectory` for the leave warnings and the calendar; neither imports the module's tables.
- **Attendance passkeys are the module's own WebAuthn credentials** (SimpleWebAuthn on the server, platform authenticator, user verification required), not Better Auth's passkey plugin, because they must never sign anyone in. One active passkey per user; a replacement waits for the General Manager.
- **Entrance screens are paired devices without a user session.** A pairing code sets a long-lived `HttpOnly` kiosk cookie. The QR code is `kioskId.window.HMAC(secret, kioskId, window)` with a 20-second window, accepted for its window and the previous one. The screen receives the per-window values over an SSE stream (ADR 0018), so the secret stays on the server and the screen's clock does not matter.
- **The office network is the place check.** An office punch is accepted only from an address the paired screen used in the last 10 minutes (IPv4 equal, IPv6 the same /64). The code proves the screen, the network proves the place, the passkey proves the person. GPS is recorded at the office but not required; field punches require it.
- **Days freeze their expectations** from the schedule when created and are recomputed from punches, leave, shoots and holidays by one pure function until their month closes. Lateness, early leave, absence, missing check-outs and overtime become **items**; deductions are fractions of a day decided by the General Manager. F19 reads only the frozen monthly summaries written when a month closes.
- **Leave balances are a signed ledger** (opening, accrual, grant, carry-over, expiry, taken, restored, overtime credit, adjustment), with unique keys that keep the daily job idempotent.
- **Public holidays are work-day input.** `isWorkDay(date, holidays)` replaces the holiday-less check of ADR 0017 for new template runs and F08 reminders; generated tasks keep their dates.

## Consequences
- The office's Wi‑Fi becomes part of attendance: a phone on mobile data cannot check in at the office, and if the domain has IPv6, the /64 rule must be checked on site before Part C ships.
- A check-in costs two requests (options, then the signed assertion) and needs the installed app with a passkey; an employee without one uses correction requests.
- A new dependency, SimpleWebAuthn, and a QR decoder in the web app where `BarcodeDetector` is missing.
- Closing a month is the boundary for payroll: F19 adds the rule that blocks reopening a month whose payroll is approved.
- ADR 0017 stays valid except that work days now skip public holidays.
