# 0036 — Installable app and Web Push: a service worker, one subscription per session, sent by the worker

Status: Proposed · Date: 2026-10-20

## Context
F16 (`docs/specs/F16-notifications-app-announcements.md`) makes the Hub installable on Android, iPhone and computers. Notifications must arrive with the app closed and the phone locked. The owner tested Web Push from Syria and it works (2026-10-20). External channels (WhatsApp, Telegram) are excluded (owner). A signed-in device is a Better Auth session (ADR 0032), and signing a device out must stop its pushes. The worker already sends email from a full payload and reports back (ADR 0028). On iPhone, push works only for an app added to the home screen, on iOS 16.4 or later.

## Decision
- **The app.**
  - A web app manifest and a service worker built with the web app. The worker precaches the app shell, never caches `/api/`, and handles `push` and `notificationclick`.
  - App icons are generated into `brand/logo/app/` and copied by the build.
  - Offline reading persists the TanStack Query cache in IndexedDB for 7 days, per user. Financial queries are never persisted. The cache is erased on sign-out and on a refused session.
- **Web Push with VAPID.** The `web-push` library in the worker sends standard Web Push to the browsers' push services. The public key goes to the web app through the API; the private key stays with the worker. The keys live in the server's `.env`, and `PUSH_TRANSPORT=log` writes payloads to files outside production.
- **One subscription per session.** `push_subscriptions.session_id` is unique and cascades from `sessions`. Signing a device out, or its session ending, removes its push with no extra code. Sessions last 30 days, renewed on use (owner), so an idle phone keeps receiving for a month.
- **Stored first, pushed by the worker.** `NotificationCenter.notify` queues `push.send` in the change's transaction, as `Mailer.queue` does. The job carries the rendered texts (`packages/messages`), so the worker reads no business table. Outcomes come back as `push.result`. Gone subscriptions (404/410) are deleted, and the user is told.
- **Always pushed (owner, 2026-10-20).** A push is sent whether or not the user is active in the app. Duplicates are softened by a tag per subject and type, which replaces the older notice on the screen. Each payload also carries a short list of tags the user has read elsewhere, and the service worker closes them; the app does the same when it opens.
- **No amounts on the lock screen.** Push texts omit money amounts (owner).

## Consequences
- The API gains a dependency on the push services being reachable from the server (outbound HTTPS only). Without VAPID keys, push is reported unavailable and the app hides it.
- iPhone users must install the app to get push; the install guide is part of the feature.
- A notification already shown by the platform cannot be withdrawn silently: platforms forbid silent pushes. Clearing is best-effort, at the next push or when the app opens.
- Sessions of 30 days lengthen the window of a stolen session; two-factor rules and the device list (ADR 0032) stay the mitigation.
- `push_subscriptions`, `push_deliveries` and `timed_reminders` are conventions exceptions: technical, not business records.
