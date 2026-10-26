# TASKS — F08B Content 2.0

Spec: `docs/specs/F08B-content-2.md` (Approved 2026-10-26) · ADR 0042 (and 0013, 0014, 0019, 0020, 0021, 0037, 0040, 0041). Four PRs, as the spec's "Delivery parts"; each leaves `main` whole. Each API PR carries the `ar.json` keys for its error codes, audit values and notification types, and the regenerated OpenAPI client.

## PR 1 — Captions, slides, checks and the pack API (Part A)
- [x] contracts: `CAPTION_GROUPS`, `captionGroupOf`, `PLATFORM_TEXT_LIMITS`, `PLATFORM_MEDIA_RULES`, `postChecks` with unit tests; caption and layout schemas; post create/update without `caption`/`hashtags` (+ `captions[]`); detail `captions`, `mediaLayout`, `checks`, `permissions.canDownloadPack`; post limit 20; `mediaInfo` on uploads, `durationMs` on versions; approvals post items `captions[]` and `slides[]`; error codes `CAPTION_TOO_LONG`, `INVALID_CAPTION_GROUP`; audit `post.layout_changed`, `post.pack_downloaded`
- [x] db (`/db-migration`, expand only): `caption_group` enum, `post_captions` (backfilled per group from each post), `content_posts.media_layout`, `post_reviews.captions` and `slide_captions`, `file_uploads`/`file_versions.duration_ms`; conventions exception for `post_captions`
- [x] api: captions on create/update/duplicate (rule A1, A2 and `POST_LOCKED`), `PUT /posts/:id/layout`, checks on detail and `CAPTION_TOO_LONG` on submit and pass, content token and snapshots over captions, layout and slide captions, approvals post items and the public page (old snapshots fallback, client logo), `mediaInfo` on uploads, `GET /posts/:id/pack` (zip stream); `test/content-captions.test.ts` + changed `content-posts`, `approvals-public` suites
- [x] bridge: `pnpm build`, `openapi:export`, `api:generate`; the post form and fixtures adapted to `captions[]` (the single caption field edits the first group until PR 3)
- [x] wiring: error codes, audit actions and field labels in `ar.json` (captions and slides shown as lengths in the audit view), `content.captionGroups`, `docs/architecture.md`, the spec where PR 1 settled details (media info as query parameters, the layout as the order of `media`, the client image route, pack file names)
- [x] found on the way: adding `archiver` was refused here, so `files` writes the pack with its own store-only ZIP writer (`zip-stream.ts`, ZIP64 offsets)
- [x] checks: full `pnpm verify` (lint, drift green; only out-of-memory typechecks, which fail on `main` here too and pass with a 6 GB heap, and load timeouts, each failing file passing on its own), reviewer (1 finding fixed: the client image on the link is never cached and goes through the public file location)
- [ ] acceptance (owner), PR with auto-merge

## PR 2 — Creation, move and planning API (Parts B, C, D)
- [ ] contracts: `content.suggest` permission and grant (+ test); `PILLAR_COLORS`, `OCCASION_CATEGORIES`, `SNIPPET_KINDS`; `suggestPublishTimes`, `occasionDates`, `planningIssues` with unit tests; wizard create schema (files, layout, linkTaskIds, tasks, ideaId, pillarId, occasionId), move preview/move, settings, pillars, occasions, snippets, ideas, planning, grid schemas; error codes `INVALID_TARGETS`, `IDEA_USED` (`NAME_TAKEN` reused); audit actions and entity types `content_pillar`, `content_occasion`, `content_settings`, `content_snippet`, `content_idea`, `post.moved`; notification types `post_unassigned`, `post_changed`, `post_moved`, `post_at_risk`, `content_week_check`, `content_idea_added`, `content_idea_used` (messages + `ar.json`), changes to `post_task_ready` and `post_publish_shortly`
- [ ] db (`/db-migration`, expand only): `content_posts.pillar_id`, `occasion_id`; `content_pillars` (four seeded), `content_occasions` (starting list), `content_occasion_dates`, `content_planning_settings` (agency row with default windows), `content_snippets`, `content_ideas`; enums
- [ ] api: one-transaction creation with files, layout, new tasks (`PostTasks.create` with the F06B payload) and links, idea used (`details.part`/`index`); move preview and move with `PostTasks.shiftDueDates` (clamp, subtasks under parent, `post_moved`); pillars, settings (agency, client, skips), occasions and confirmed dates, snippets, ideas; calendar `occasions[]`/`issues[]` and `pillarId`; `GET /content/planning`, `GET /content/grid`; notifications (`post_unassigned`, `post_changed`, `post_moved` before `task_changed`, ideas) and `notifications.daily` sources `post_at_risk`, `content_week_check`; `post_publish_shortly` approved only; `test/content-creation`, `content-move`, `content-planning`, `content-ideas` + changed suites
- [ ] bridge: `openapi:export`, `api:generate`; fixtures adapted
- [ ] wiring: permission, error codes, audit values, notification types (catalog, first-match order, messages, `ar.json`, resolutions), job sources, test cleanup of the new tables, `TABLE_OWNERS`, `docs/architecture.md`
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 3 — Wizard, captions, slides and previews (web)
- [ ] ui: components the previews need (if missing) on the design-system page
- [ ] web: `/content/new` wizard (five steps, local draft, "Create now", held uploads with paste, tasks with subtasks, review with checks, readiness and planning notes, suggested times), platform previews, caption editor (counters, Copy from, snippets); post page (caption tabs, Slides, Checks, Preview, Move dialog, Publishing pack, pillar and occasion); client approval page with platform tabs and slides; reviewers' summaries; `ar.json`
- [ ] web unit tests (draft storage, preview caption cut)
- [ ] e2e: mocks, wizard and post page flows, screens (each wizard step phone and desktop, previews, post page, move dialog, client page phone) in both themes
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 4 — Calendar, planning, grid, ideas and settings (web)
- [ ] web: day click and drag with the move dialog, occasion strip, gap and too-close marks, pillar filter and dots, ideas panel (drag onto a day), Planning check tab, My posts "At risk", client tab month bar (pillar balance, planned / committed), Grid view, client settings and snippets dialogs, `/content/settings`, quick idea in the top bar; `ar.json`
- [ ] e2e: the full F08B flow (`f08b.spec.ts`), screens (calendar with occasions, gaps and ideas, Planning check, Grid, settings, quick idea) in both themes
- [ ] checks, reviewer, acceptance, PR with auto-merge; `docs/ROADMAP.md` F08B done
