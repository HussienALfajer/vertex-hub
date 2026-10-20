# TASKS — F16 Notifications 2.0, installable app and announcements

Spec: `docs/specs/F16-notifications-app-announcements.md` (Approved 2026-10-20) · ADRs 0036, 0037, 0038.
PR order fixed by the spec's "Delivery" (owner, 2026-10-20); each part is deployed when done. One session per PR.

## PR A1 — push: contracts, db, api, worker (branch `feat/f16-a1-push-api`)
- [x] contracts: `notificationPrioritySchema`, `channelModeSchema`; `NOTIFICATION_CATALOG` gains `priority`, `push`, `email` defaults (`emailByDefault` goes); `push_device_lost` type; push schemas (config, subscription, delivery, delivery page), `PUSH_LIMITS`; `notifications.policy` permission and grants (delivery log); error codes `PUSH_UNAVAILABLE`, `NO_SUBSCRIPTION`; queues `push.send`, `push.result` in `jobs.ts`; effective push channel (rule B3 without policies yet) and unit tests; `ar.json` keys (type label, errors)
- [x] db (`/db-migration`): `push_subscriptions`, `push_deliveries`; `notifications.priority` (backfilled from the catalog); `notification_settings.push_overrides`, `email_overrides` (backfilled from `email_types`, which stays unused until the contract release drops it); conventions exceptions; `TABLE_OWNERS`
- [x] messages: push texts without amounts (`ad_budget_low`, `retainer_amendment_pending`; the payment types arrive with C1) + test that no push text holds an amount; 140-char cut, payload < 3 KB
- [x] api auth: sessions 30 days (`expiresIn`, `updateAge`); `GET /api/me/sessions` push state per device
- [x] api notifications: `GET /me/push/config`, `PUT`/`DELETE /me/push/subscription`, `POST /me/push/test` (1/min), `POST /me/push/deliveries/:id/click`; `notify` queues `push.send` in the transaction when push is on (close list, unread count); `push.result` handler (gone → delete + `push_device_lost`, 10 failures → delete); `GET /api/push-deliveries` (`notifications.policy`); settings `push` per type; purge of `push_deliveries` after 30 days; `test/` cases (success, 401, 403, own rows)
- [x] worker: `push.send` with `web-push` (VAPID, urgency/TTL by priority, retry 3) and the `log` transport to `.data/push/`; tests against a fake push service (201, 404, 410, 500)
- [x] env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_TRANSPORT` in config validation and `docs/deployment.md`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [ ] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge

## PR A2 — the app: web and E2E
- [ ] `.env.example`: the push lines (A1's session could not edit `.env*` files): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_TRANSPORT` as placeholders; local VAPID keys in `.env` for manual testing (`npx web-push generate-vapid-keys`)
- [ ] manifest, icons from `brand/logo` (new square PNGs), service worker (push, notificationclick, "remind me" action later in B), no `/api/` caching
- [ ] install card, `/install` guide, update banner, icon badge, offline cache (IndexedDB, 7 days, no financial data) and banner
- [ ] device rows: push state, test push, turn off; settings push column; re-subscribe after sign-in
- [ ] E2E + RTL screenshots (desktop and phone, both themes); SW registration and a push via the `log` transport
- [ ] checks, reviewer, acceptance (owner steps A1–A4), PR with auto-merge

## PR B1 — engine: contracts, db, api
- [ ] box, resolution, snooze, escalation columns; `notification_policies`, `record_followers`, `timed_reminders`; `morning_push`
- [ ] contract step of A1: drop `notification_settings.email_types` (no release reads it after A1 is deployed)
- [ ] `resolve`, inboxes and counts, snooze, grouping, policy API, followers API, escalation chain, minute job, morning push, critical email
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR B2 — engine: web
- [ ] bell inboxes and snooze, notifications page tabs, settings (policy locks, morning push), policy page + delivery log tab, follow button, SW "remind me" action
- [ ] E2E, checks, reviewer, acceptance (owner steps B5–B6), PR with auto-merge

## PR C1 (+ C1b if large) — catalog: api per module
- [ ] new types, recipient changes, `resolve` calls per module; `approval_requests.first_opened_at`; daily sources; security copies
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR C2 — catalog: web texts and links
- [ ] `ar.json` / `packages/messages` texts and links; E2E; checks, reviewer, acceptance (owner step C7), PR with auto-merge

## PR D1 — announcements and audiences: contracts, db, api
- [ ] `announcements*` tables, polls, templates, F10 owner type; `AudienceResolver`; announcement API; reminders in the daily job, scheduling in the minute job
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR D2 — announcements: web
- [ ] `AudiencePicker`, rich-text editor, list, page, receipts, poll, templates, home pin, critical dialog
- [ ] E2E, checks, reviewer, acceptance (owner step D8), PR with auto-merge, ROADMAP F16 done
