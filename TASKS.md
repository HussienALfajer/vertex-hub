# TASKS — F16 Notifications 2.0, installable app and announcements

Spec: `docs/specs/F16-notifications-app-announcements.md` (Approved 2026-10-20) · ADRs 0036, 0037, 0038.
PR order fixed by the spec's "Delivery" (owner, 2026-10-20). F16 is deployed to production once, after all parts (A–D) are merged, not part by part (owner, 2026-10-20). One session per PR.

## PR A1 — push: contracts, db, api, worker (branch `feat/f16-a1-push-api`)
- [x] contracts: `notificationPrioritySchema`, `channelModeSchema`; `NOTIFICATION_CATALOG` gains `priority`, `push`, `email` defaults (`emailByDefault` goes); `push_device_lost` type; push schemas (config, subscription, delivery, delivery page), `PUSH_LIMITS`; `notifications.policy` permission and grants (delivery log); error codes `PUSH_UNAVAILABLE`, `NO_SUBSCRIPTION`; queues `push.send`, `push.result` in `jobs.ts`; effective push channel (rule B3 without policies yet) and unit tests; `ar.json` keys (type label, errors)
- [x] db (`/db-migration`): `push_subscriptions`, `push_deliveries`; `notifications.priority` (backfilled from the catalog); `notification_settings.push_overrides`, `email_overrides` (backfilled from `email_types`, which stays unused until the contract release drops it); conventions exceptions; `TABLE_OWNERS`
- [x] messages: push texts without amounts (`ad_budget_low`, `retainer_amendment_pending`; the payment types arrive with C1) + test that no push text holds an amount; 140-char cut, payload < 3 KB
- [x] api auth: sessions 30 days (`expiresIn`, `updateAge`); `GET /api/me/sessions` push state per device
- [x] api notifications: `GET /me/push/config`, `PUT`/`DELETE /me/push/subscription`, `POST /me/push/test` (1/min), `POST /me/push/deliveries/:id/click`; `notify` queues `push.send` in the transaction when push is on (close list, unread count); `push.result` handler (gone → delete + `push_device_lost`, 10 failures → delete); `GET /api/push-deliveries` (`notifications.policy`); settings `push` per type; purge of `push_deliveries` after 30 days; `test/` cases (success, 401, 403, own rows)
- [x] worker: `push.send` with `web-push` (VAPID, urgency/TTL by priority, retry 3) and the `log` transport to `.data/push/`; tests against a fake push service (201, 404, 410, 500)
- [x] env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_TRANSPORT` in config validation and `docs/deployment.md`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge (#139, merged)

## PR A2 — the app: web and E2E (branch `feat/f16-a2-push-web`)
- [x] `.env.example`: the push lines as placeholders (owner); local VAPID keys in `.env` (owner)
- [x] icons in `brand/logo/app/` (192, 512, maskable 512, badge 96) and square `png/icon-192.png`, `png/apple-touch-icon.png`, from `vertex-mark.svg`; `publicDir` copies them
- [x] manifest and service worker (vite-plugin-pwa 2.0 `injectManifest`, `src/service-worker/`): precache, app-shell navigation, `push`, `notificationclick`, no `/api/` caching; own `tsconfig.sw.json`
- [x] install card (home), user-menu item, `/install` guide, update banner, icon badge
- [x] offline: query cache in IndexedDB for 7 days (allowlist without money), cleared on sign-out, refusal and another user; banner, read-only shell, "Not available offline" in `LoadError`
- [x] device push: card (settings, home invite), device rows (state, test, turn off), settings push column with priority chips and policy locks, silent re-subscribe after sign-in, closing read pushes on open and focus
- [x] E2E: `f16.spec.ts`, `f16-push.spec.ts` (service worker push via CDP), screenshots (install card and guide, offline, desktop and phone, both themes); mocks for the push endpoints; Playwright blocks service workers elsewhere
- [x] checks, reviewer, acceptance (owner: computer steps in Chrome; phone steps A1–A4 after the F16 deploy), PR with auto-merge

## PR B1 — engine: contracts, db, api (branch `claude/zen-goodall-q35u6l`)
- [x] contracts: catalog `box`, `opened`, `merges`, `escalation` per type; `action_reminder`, `action_escalated`, `action_escalated_top`; inboxes, resolutions, snooze options; policy-aware channel modes; policy, following, snooze and settings (`morningPush`) schemas; `unreadCount.needsYou`; `ALREADY_RESOLVED`; `notification_policy.updated`; `escalation_1..3` reminder kinds; `notifications.timed` job; unit tests
- [x] messages: texts and links of the escalation steps (original's text, who it waits on); morning push text; no amount in a step's push
- [x] db (`/db-migration`): `notifications` box, resolution columns, `snoozed_until` and indexes; `notification_settings.morning_push`; `notification_policies`, `record_followers`; backfill of `box` and `resolution_type`
- [x] api: `NotificationCenter.resolve`, box and resolution type on insert, grouping (`merges`, unresolved rows), "opened" types resolve on read; inbox list and counts (critical first); snooze and unsnooze; policy API with audit, settings and `notify` read the policy; followers API on tasks and posts; escalation chain in the daily job; `notifications.timed` (snooze wake-ups) worked by the API, scheduled by the worker; morning push with the digest; critical email at any hour; purge of resolved rows; `test/` cases
- [x] bridge: `ar.json` keys (types, errors, audit), `openapi:export`, `api:generate`, fixtures; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge

## PR B2 — engine: web (branch `claude/busy-gauss-n0tl8z`)
- [x] bell inboxes and snooze, notifications page tabs, settings (policy locks, morning push, "turn all on or off" per category and channel), policy page + delivery log tab, follow button, SW action buttons "Open" and "Remind me in an hour" (rule A11); critical toasts stay until closed (B10)
- [x] E2E (`f16-engine.spec.ts`, F14 bell test on the tabs, screenshots: inboxes, snooze, Done and Snoozed, policy, delivery log, follow button, desktop and phone, both themes); mocks for inboxes, snooze, policy, deliveries and following
- [x] checks, reviewer, PR with auto-merge (the owner tests B5 after the merge, at their request; B6's "Handled by" needs the C1 `resolve` calls)
- [x] owner acceptance after the merge: all B5 steps pass (owner, 2026-10-20)

## PR C1 — catalog: workflow modules api (branch `claude/vigilant-hamilton-t49k8y`)
Split from C1b because the catalog touches twelve modules: C1 holds tasks, content, approvals, calendar and files, with the engine pieces they need.
- [x] contracts: new types `task_reopened`, `task_delivered`, `task_revision_decided`, `task_progressed`, `task_due_shortly`, `post_published`, `post_cancelled`, `post_file_added`, `post_progressed`, `post_publish_shortly`, `approval_opened`, `approval_completed`, `shoot_starting`, `meeting_starting`, `shoot_completed` (catalog, order, snapshots); `timed_reminders` kinds; task and post resolution rules (pure, unit tests); messages texts and links; `ar.json` type labels
- [x] db (`/db-migration`): enum values, `timed_reminders`, `approval_requests.first_opened_at`; `TABLE_OWNERS`, conventions exception
- [x] api engine: rows resolved in the transaction that created them send no push or toast (edge case 9); automatic following and follower recipients with read access (rule B12)
- [x] api tasks: `resolve` on every status, assignee and due change, mention reply, revision decision; new task types; followers on create, assign, comment, mention, file
- [x] api content and files: `resolve` on post changes; new post types; post followers (creator, responsible, file adders)
- [x] api approvals: `first_opened_at` + `approval_opened`, `approval_completed`, resolves (included in a request, responses, reissue, revoke)
- [x] api calendar: `shoot_completed`, `shoot_not_closed` resolve
- [x] timed sources in the minute job (`task_due_shortly`, `post_publish_shortly`, `shoot_starting`, `meeting_starting`) with `timed_reminders` and its purge
- [x] bridge: `openapi:export`, `api:generate`, fixtures; web typecheck
- [x] checks, reviewer, acceptance (owner, 2026-10-20), PR with auto-merge

## PR C1b — catalog: business modules api
- [ ] ask the owner: should archiving a scheduled shoot void `shoot_not_closed`? (the spec names closing and cancelling only; found in C1)
- [ ] clients, leads, quotes, projects, campaigns, invoices, auth, templates (`tasks_generated`), email: new types, recipient changes (`quote_accepted` + Finance, `lead_won` + GMs), `resolve` calls; `responsibility_moved`; daily sources (`quote_expiring`, `invoice_due_soon`, `campaign_end_passed`, `member_archived_open_work` resolution); security copies
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR C2 — catalog: web texts and links
- [ ] `ar.json` / `packages/messages` texts and links; E2E; checks, reviewer, acceptance (owner step C7), PR with auto-merge

## PR D1 — announcements and audiences: contracts, db, api
- [ ] `announcements*` tables, polls, templates, F10 owner type; `AudienceResolver`; announcement API; reminders in the daily job, scheduling in the minute job
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR D2 — announcements: web
- [ ] `AudiencePicker`, rich-text editor, list, page, receipts, poll, templates, home pin, critical dialog; manifest shortcut "New announcement" (`apps/web/vite.config.ts`)
- [ ] E2E, checks, reviewer, acceptance (owner step D8), PR with auto-merge, ROADMAP F16 done

## After the F16 deploy — contract release
- [ ] drop `notification_settings.email_types` (expand, then contract: only once production runs a release that no longer reads it, so the single F16 deploy cannot drop it)
