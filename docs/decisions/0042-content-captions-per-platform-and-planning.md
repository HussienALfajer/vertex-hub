# 0042 — Content: captions per platform group, a media layout on the post, and planning data owned by content
Status: Proposed · Date: 2026-10-26

## Context
F08B (Content 2.0, `docs/specs/F08B-content-2.md`) changes the F08 post (ADR 0021) in three ways. A post gets a caption per platform instead of one. Its media becomes an ordered set of slides with captions. The content calendar gains planning data: pillars, occasions, best publishing times, snippets and ideas. Today a post's caption and hashtags are two columns. Its media order is computed (own files, then linked tasks' finals), and the snapshot a client approves copies that caption and those versions.

## Decision
- **Captions are rows per caption group.** `post_captions` holds one row per `(post, group)`. Facebook and Instagram share the group `facebook_instagram`, and every other platform is its own group (decided, v2-scope §F08B). A group's limit is the lowest of its chosen platforms. Rows are never deleted: a group whose platforms leave the post is hidden and returns with them. `content_posts.caption` and `hashtags` stay as the first group's plain extract, so the previous release and search keep working (expand only).
- **The client approves the whole post once**, with every group's caption (F08's single decision stays). The review snapshot stores the captions per group (`post_reviews.captions`) and the slide captions (`slide_captions`). The content token covers them, the media order and the YouTube title. Snapshots written before F08B are read as one caption for every group.
- **Caption limits block the submission for review**, never the save (owner, 2026-10-26). One pure function in `packages/contracts` (`postChecks`) computes limits and media warnings for the web and the api alike. Media warnings (length, ratio, slide count) never block. They use the dimensions `files` measures for images and, for videos, the browser's reading at upload.
- **The media layout is a list on the post** (`media_layout`: file item ids with an optional caption each). It covers the post's own files and its linked tasks' finals together. Media not listed follow F08's order, so a new final appears without a write. The client sees the slide captions (owner, 2026-10-26).
- **Planning data belongs to `content`.** It owns pillars, occasions with confirmed dates, planning settings (one agency row and one per client), snippets and ideas. Occasions are rules (a Gregorian day, a Hijri day computed with the Umm al-Qura calendar, or one date) with a confirmed start per year that overrides the computation after a moon sighting. The planning check is computed on read by a pure function and sent weekly to Content Management by a source of `notifications.daily` (owner, 2026-10-26). There is no new job.
- **A post's tasks are created through `tasks`.** The wizard saves the post, its captions, held files, new linked tasks with their subtasks (F06B, through `PostTasks`) and links in one transaction. Moving a post shifts its open linked tasks' due dates by work days through `PostTasks`, only when the mover ticks it (owner, 2026-10-26).
- **Ideas are a table, not posts without a date.** Any employee adds one (new permission `content.suggest`). An idea becomes a post once, in the post's transaction.

## Consequences
- Every reader of a post's caption (the client page, Duplicate, the pack, notification texts) reads groups, with the single-caption fallback for old snapshots.
- The limits live in two constants (`PLATFORM_TEXT_LIMITS`, `PLATFORM_MEDIA_RULES`). When a platform changes them, one code change updates the web and the api.
- `content` stays a leaf: `tasks`, `files`, `clients` and `projects` still never import it. The new tables add no cross-module reads beyond `PostTasks`, `FileAttachments`, `EngagementDirectory` and `HolidayCalendar`.
- Settings rows and caption rows have no `archived_at`. They are exceptions in the conventions test, like the append-only review tables.
