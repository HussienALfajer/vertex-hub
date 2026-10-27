# F08B — Content 2.0

Status: Approved · Date: 2026-10-26 · Scope: `docs/product/v2-scope.md` §F08B (and the rules shared by F01C, F06B and F08B) · ADRs: 0013, 0014, 0019, 0020, 0021, 0037, 0040, 0041, 0042

## Summary
F08 made the post the unit of content, but a post still has one caption for every platform, its media and tasks are added one by one after it exists, and planning happens in people's heads: nobody sees that next Tuesday has no post, that Eid has nothing planned, or that a client's month is all promotion.

F08B gives each post **a caption per platform** (Facebook and Instagram share one) with the platform's limits enforced before review, **carousel slides** in a chosen order with an optional caption each, and **creation in one step-by-step wizard** that takes the captions, media, and new or existing linked tasks with their subtasks (F06B) in one save. The calendar becomes the planning surface: **click a day** to start a post there, **drag a post** to another day (shifting its tasks' due dates when asked), **occasions**, **gaps**, **content pillars** with a target mix per client, **best publishing times**, an **Instagram grid**, and an **ideas bank** anyone can add to. **Previews** show the post as it will look on each platform, for the team and for the client on the approval page, and a **publishing pack** gives the captions to copy and the media to download, since publishing stays manual.

## In scope / out of scope
- In:
  - **Part A, captions and media.**
    - A caption per caption group (Facebook and Instagram together, every other platform alone), each with its own hashtags; YouTube has a title and a description.
    - Character counters at each platform's limit; over a limit is a warning while editing and blocks the submission for review (`CAPTION_TOO_LONG`, owner, 2026-10-26).
    - "Copy from another caption", saved hashtag sets and caption snippets per client and for the agency.
    - Carousel slides: the order of all the post's media (its own files and its linked tasks' finals) and an optional caption per slide, seen by the client (owner, 2026-10-26). A post holds up to 20 files of its own (was 10).
    - Platform checks: video length, aspect ratio and slide count per platform and type, empty captions and YouTube titles (warnings), caption and hashtag limits (block at submit).
    - The review snapshot, the content token, the client approval page and Duplicate carry the captions per platform and the slides.
    - Previews of the post on each platform, in the wizard, on the post page and on the client approval page (owner, 2026-10-26).
    - The publishing pack: copy each platform's caption, download the media named in slide order.
  - **Part B, creation and the calendar.**
    - The creation wizard `/content/new` (basics → captions → media → tasks → review) with "Create now" from the first step and a local draft (owner, 2026-10-26).
    - Media at creation (drag, drop, paste), held and attached on save (F10).
    - Linked tasks at creation: existing tasks to link, and new tasks with subtasks, run mode and stages (F06B), assigned to a person or a department's queue.
    - Clicking a calendar day (today or later, `content.manage` holders) opens the wizard on that date, with the client filled in on a client's calendar.
    - Dragging a post to another day, with "shift the linked tasks' due dates" asked on drop (owner, 2026-10-26); a "Move" action where dragging is not possible.
  - **Part C, planning aids.**
    - Content pillars: an agency list (four to start, up to 10), one optional pillar per post, an optional target mix per client and the month's balance against it (owner, 2026-10-26).
    - Best publishing times: agency defaults per platform, overridden per client, suggested at creation (owner, 2026-10-26).
    - Occasions: a starting list (Hijri dates computed and confirmed by hand), general or by category, enabled per client, shown on the calendar with "no post for this occasion" hints (owner, 2026-10-26).
    - The planning check: gaps longer than the client's rhythm, posts too close together on a platform, fewer planned posts than the retainer commits, occasions without a post and an unbalanced pillar mix; shown on the calendar and sent weekly to Content Management (owner, 2026-10-26).
    - The Instagram grid view of a client's month.
    - The ideas bank: any employee adds an idea in one line from anywhere; the content team turns it into a post or drops it (owner, 2026-10-26).
  - **Part D, notifications.** The new types and the changes below, including the reminder for a post still not approved two work days before its date (owner, 2026-10-26).
- Out (later or never):
  - Automatic publishing and statistics from the platforms; best times learned from engagement (v2-scope "Later").
  - An AI assistant for captions and hashtags (v2-scope "Later").
  - A caption per platform group other than Facebook with Instagram (decided); a separate client decision per platform (one decision per post stays, F08).
  - Occasions on the company calendar (F11); a notification to confirm a Hijri date (the manager sees it on the occasions list).
  - Reordering the Instagram grid by drag (it is read-only).
  - Timed slots in the week view (posts still sit on days).

### Delivery parts
- **PR 1** (contracts, db, api): captions per group, slides and the media layout, platform checks and media info on uploads, snapshots, the content token, approvals and the client page API, Duplicate, the publishing pack.
- **PR 2** (api): creation in one transaction with files, tasks and links; the move with the task shift; pillars, settings and best times, occasions, snippets, ideas, the planning check and the grid; notifications and the job sources.
- **PR 3** (web): the wizard with previews and checks, the caption editor with snippets, the post page (captions, slides, checks, move, pack), the client approval page with previews.
- **PR 4** (web): calendar click and drag, overlays (occasions, gaps, pillars, commitments), the Planning check tab, the Instagram grid, the ideas bank and quick add, the content settings screens; the full F08B E2E pass.

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
- New permission **`content.suggest`** (add ideas to the ideas bank): Employee role `all`.
- No other change. Agency-wide content settings (pillars, occasions, default best times, agency snippets) use `content.review` with scope `all` (Content Management manager, General Manager, Operations manager), as F08's archive does. A client's content settings and snippets use `content.manage` covering the client.

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| See posts, captions, previews, the grid, occasions, pillars, settings, snippets, ideas and the planning check | `content.read` | Every active user: all |
| Create posts in the wizard, edit captions and slides, move posts | `content.manage` | edit scope (F08) |
| Create linked tasks and subtasks at creation | `content.manage` + F06B's create rules | assigning to a person needs the creator's `tasks.assign` scope there; otherwise the task goes to the department's queue (F06) |
| Shift linked tasks' due dates when moving a post | `content.manage` (edit scope on the post) | the shift is done by the system for the post, whatever the mover's task scope (rule B9) |
| Edit a client's content settings (pillar targets, best times, rhythm, occasion categories and exclusions, X long posts) and its snippets | `content.manage` | covering the client |
| Edit agency pillars, occasions and their dates, default best times, agency snippets | `content.review` | scope all |
| Add an idea | `content.suggest` | every active user |
| Edit or drop one's own open idea | `content.suggest` | the author |
| Turn an idea into a post, edit or drop any idea, restore a dropped idea | `content.manage` | covering the idea's client; an idea without a client is covered by every holder |
| Download the publishing pack | `content.manage` | edit scope; the post `approved`, `scheduled` or `published` |
| See previews and slide captions on the client page | the link's token | the holder of the link (F09) |

The UI hides what the user cannot do; the API enforces every row.

## Data

Module ownership: `content` owns every new table below. It reads work days through `hr`'s `HolidayCalendar` (as F08), creates linked tasks through `tasks`' `PostTasks` (extended to F06B's creation), attaches held uploads through `files`' `FileAttachments`, and reads cycle lines through `projects`' `EngagementDirectory`. No module imports `content` that did not before.

Dates without a time are calendar days in Asia/Damascus; weeks start on Saturday; work days skip Fridays and public holidays (F17 rule B1).

### Contracts (`packages/contracts/src/post-values.ts`, `content.ts`)
- `CAPTION_GROUPS`: `facebook_instagram`, `tiktok`, `x`, `linkedin`, `youtube`, `snapchat`, `google_business`; `captionGroupOf(platform)`; the groups of a post are those of its platforms, in that order.
- `PLATFORM_TEXT_LIMITS` per platform, counted in Unicode code points over caption, a blank line and hashtags together, as published: Instagram 2200 and 30 hashtags; Facebook 5000 (the storage cap; its own limit is higher); TikTok 4000; X 280, or 5000 when the client's settings mark X long posts; LinkedIn 3000; YouTube title 100 and description 5000; Snapchat 250; Google Business 1500. A group's limit is the lowest of its chosen platforms (Facebook with Instagram: Instagram's).
- `PLATFORM_MEDIA_RULES` per platform and post type: the longest video, the recommended aspect ratios and the most slides. Values as of 2026-10: Instagram reel 3 min, 9:16; story 60 s, 9:16; feed post and carousel 4:5, 1:1 or 1.91:1, up to 20 slides; Facebook reel 90 s, 9:16, post up to 20 slides; TikTok video 10 min, 9:16, photo posts up to 35; X video 140 s, up to 4 images; LinkedIn video 10 min, up to 20 images; YouTube reel (Short) 3 min, 9:16, post (video) 16:9; Snapchat 60 s, 9:16; Google Business 30 s, one image or video. These come from the platforms' published help pages and were not checked live in this session: they are one constant, edited in code when a platform changes.
- The pure function `postChecks(draft, media, settings)` returns `{ code, group?, platform?, mediaIndex?, limit?, actual?, blocking }[]`, used by the wizard, the post page and the API alike (rules A3–A5).
- `PILLAR_COLORS` (eight design-system chart tokens), `OCCASION_CATEGORIES` (`general`, `healthcare`, `education`, `food`, `retail`, `tourism`, `beauty`, `real_estate`), `SNIPPET_KINDS` (`hashtags`, `caption`).
- The pure functions `suggestPublishTimes(settings, defaults, date, platforms)`, `occasionDates(occasion, year, confirmed)` (Hijri through `Intl.DateTimeFormat` with the `islamic-umalqura` calendar) and `planningIssues(...)` (rule C10), with unit tests.

### `content_posts` (changed)
| Field | Type | Rules |
|---|---|---|
| `caption`, `hashtags` | text | kept as the plain extract of the first caption group of the post (search, notification texts, the previous release); written from `post_captions`, never edited directly |
| `media_layout` | jsonb | `{ fileItemId, caption? }[]`, at most 40 entries: the slide order of the post's media and each slide's caption (≤ 300 chars, plain text); media not listed follow in F08 rule 5's order; entries whose file is no longer media are ignored on read and dropped on the next write |
| `pillar_id` | uuid → `content_pillars.id` | optional, indexed |
| `occasion_id` | uuid → `content_occasions.id` | optional, indexed: the occasion this post is for |

### `post_captions` (owned by `content`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `post_id` | uuid → `content_posts.id` | required |
| `group` | enum `caption_group` | required; unique with `post_id` |
| `caption` | text | optional, ≤ 5000 chars, plain text with line breaks |
| `hashtags` | text | optional, ≤ 1000 chars |
| `title` | text | `youtube` only, optional, ≤ 100 chars (check constraint) |
| timestamps | | no `archived_at`: rows are never deleted. A row whose group leaves the post's platforms is kept and ignored, and comes back if the platform does (an exception in `packages/db/src/conventions.test.ts`, like `task_reviews`) |

The migration writes, for every existing post, one row per group of its platforms with the post's `caption` and `hashtags` (decided: existing posts keep their caption on every platform they had).

### `post_reviews` (changed)
| Field | Type | Rules |
|---|---|---|
| `captions` | jsonb | `passed`: `{ group, caption, hashtags, title }[]` for the groups of the snapshot's platforms; null on rows written before F08B, read as the single `caption` and `hashtags` for every group |
| `slide_captions` | jsonb | `passed`: `(string \| null)[]` aligned with `version_ids`; null on earlier rows |

`caption` and `hashtags` stay, written with the first group's text.

### `content_pillars` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `name` | text | required, trimmed, 1–40 chars, unique among non-archived (case-insensitive) |
| `color` | enum of `PILLAR_COLORS` | required |
| `position` | integer | dense from 1 |
| timestamps, `archived_at` | | archived = no longer offered; posts keep it, shown muted; targets on it are ignored |

At most 10 non-archived. Names are data, not i18next keys: the migration inserts توعية، ترويج، ترفيه and خلف الكواليس (awareness, promotion, entertainment, behind the scenes).

### `content_occasions` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `name` | text | required, 1–80 chars |
| `category` | enum `occasion_category` | required |
| `client_id` | uuid → `clients.id` | optional, indexed: an occasion of one client only (an anniversary, a launch); its category is ignored |
| `calendar` | enum `occasion_calendar` (`gregorian`, `hijri`, `once`) | required |
| `month`, `day` | integer | `gregorian` and `hijri`: required (Hijri months 1–12, days 1–30) |
| `date` | date | `once`: required |
| `duration_days` | integer | required, 1–31, default 1 (Ramadan 30, Eid al-Fitr 3, Eid al-Adha 4) |
| `lead_days` | integer | required, 0–30, default 7: how early the calendar hints that no post is planned |
| `created_by_id`, timestamps, `archived_at` | | archived = no longer shown |

### `content_occasion_dates` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `occasion_id` | uuid → `content_occasions.id` | required; unique with `year` |
| `year` | integer | the Gregorian year the start falls in |
| `start_date` | date | required: the confirmed start, replacing the computed one (a Hijri date after the moon sighting) |
| `confirmed_by_id`, timestamps, `archived_at` | | archived = back to the computed date |

The starting list (inserted by the migration, edited by the Content Management manager afterwards):
- **General, Hijri:** Ramadan (9/1, 30 days, lead 14), Eid al-Fitr (10/1, 3 days), Eid al-Adha (12/10, 4 days), Islamic New Year (1/1), the Prophet's Birthday (3/12).
- **General, Gregorian:** New Year (1/1), International Women's Day (3/8), Mother's Day (3/21), Independence Day (4/17), Labour Day (5/1), World Children's Day (11/20), Arabic Language Day (12/18), Christmas (12/25).
- **Healthcare:** World Cancer Day (2/4), World Health Day (4/7), World Heart Day (9/29), Breast Cancer Awareness Month (10/1, 31 days), World Diabetes Day (11/14).
- **Education:** International Teachers' Day (10/5). **Food:** International Coffee Day (10/1), World Food Day (10/16). **Tourism:** World Tourism Day (9/27).

### `content_planning_settings` (business table)
One row for the agency (`client_id` null, a partial unique index) and at most one per client.
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | optional, unique |
| `posting_times` | jsonb | `{ platform, weekdays: (0–6)[], from: "HH:MM", to: "HH:MM" }[]`, at most 4 windows per platform; on a client row, a platform listed replaces the agency's windows for that platform |
| `pillar_targets` | jsonb | client rows only: `{ pillarId, percent }[]`, integers summing to 100, or empty |
| `max_gap_days` | integer | client rows only: 1–14, default 3: the longest run of days without a post before the check flags it |
| `occasion_categories` | `occasion_category[]` | client rows only: the categories that apply; `general` always applies; a healthcare client also gets `healthcare` by default |
| `excluded_occasion_ids` | uuid[] | client rows only: occasions that never apply to the client |
| `skipped_occasions` | jsonb | client rows only: `{ occasionId, year }[]`: "no post this year", which silences the hint |
| `x_long_posts` | boolean | client rows only, default false: the client's X account publishes long posts (limit 5000) |
| timestamps | | no `archived_at` (settings, an exception in the conventions test) |

The migration writes the agency row with default windows: Instagram and Facebook Saturday–Thursday 12:00–14:00 and 19:00–22:00; TikTok every day 18:00–23:00; X and LinkedIn Sunday–Thursday 09:00–11:00; YouTube Thursday and Friday 17:00–21:00; Snapchat every day 20:00–23:00; Google Business Saturday–Thursday 10:00–12:00. They are starting values for the manager to correct.

### `content_snippets` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | optional, indexed: null for the agency |
| `kind` | enum `snippet_kind` | required |
| `name` | text | required, 1–60 chars |
| `body` | text | required: `hashtags` ≤ 1000, `caption` ≤ 2000 chars |
| `created_by_id`, timestamps, `archived_at` | | archived = removed from the pickers |

At most 50 non-archived per client (or agency) and kind.

### `content_ideas` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `text` | text | required, trimmed, 1–300 chars |
| `client_id` | uuid → `clients.id` | optional, indexed |
| `pillar_id` | uuid → `content_pillars.id` | optional |
| `occasion_id` | uuid → `content_occasions.id` | optional |
| `post_id` | uuid → `content_posts.id` | set once when the idea becomes a post, indexed; never changes after |
| `drop_reason` | text | optional, ≤ 300 chars, with `archived_at` |
| `created_by_id`, timestamps, `archived_at` | | archived = dropped |

State: **open** (no post, not archived), **used** (`post_id`), **dropped** (archived). A used idea is never dropped.

### Changes to other modules
- **`files` (F10):** the post owner policy allows 20 items (was 10). `file_uploads` and `file_versions` gain `duration_ms` (integer, optional). For a video, `POST /api/files/uploads` accepts the `mediaInfo` the browser read as query parameters (`?width=&height=&durationMs=`; settled in PR 1: the multipart body takes the file only), stored on the upload and copied to the version; it is used only for warnings. Image width and height stay those `sharp` reads.
- **`tasks` (F06, F06B):** `PostTasks.create` takes F06B's creation payload (brief, estimate, assignee or queue, run mode, stages, subtasks, files) and links the new task in the same transaction; `PostTasks.shiftDueDates(postId, taskIds, workDays, actorId)` moves the due dates of linked tasks and their subtasks (rule B9) with reason `post_moved`.
- **`notifications` (F16):** the types below; the weekly check is a source of `notifications.daily`.

## States and rules
The F08 post statuses and transitions do not change. F08 rules hold unless changed here.

### Part A — Captions and media
1. **Caption groups.** A post has one caption per group of its platforms (`facebook_instagram` covers either or both). Editing a caption, its hashtags, a YouTube title, the media layout or a slide caption is content editing: allowed in `idea` and `in_production` only (`POST_LOCKED`, F08 rule 3).
2. **Platforms after approval** (F08 rule 3 keeps them free in any open status): removing a platform is free; adding one whose group already has a caption is free (Facebook beside Instagram); adding one of a new group is content editing (`POST_LOCKED` outside `idea` and `in_production`; "Reopen content" first).
3. **Limits.** `postChecks` flags a caption group whose text is over its limit, Instagram hashtags over 30, and a YouTube title over 100. Saving is allowed; **submitting for review is refused while any of these remains** (`CAPTION_TOO_LONG`, listing them; owner, 2026-10-26). An internal pass re-checks them.
4. **Warnings** (never block): an empty caption of a group (except stories), a YouTube video without a title, a reel or story without a video, a video longer than a platform's limit, an aspect ratio other than the recommended ones (within 2%), more slides than a platform takes, slides of different ratios in a carousel. Media without measured dimensions or duration (links, old files) are not checked.
5. **Where checks show:** the wizard's review step, the post page's Content and Media sections, and the reviewer's view. The API returns `checks` on the post detail and refuses the submit for blocking ones.
6. **Media layout.** "Slides" orders all of the post's media by drag (own files and linked tasks' finals together) and takes a caption per slide. New media join at the end. Unlinking a task or removing a file removes its slides.
7. **Content token** (F08 rule 11) covers the captions of the post's groups, the YouTube title, the media in layout order and the slide captions. A pass snapshots them in `post_reviews.captions` and `slide_captions`.
8. **What the client sees** (F08 rule 27 extended): per post item, tabs per caption group (or one text when all groups are the same), each with its preview, the slides in order with their captions, the publish date and time. One decision per post (F08).
9. **Duplicate** copies the captions per group and the pillar; not the media, slides, occasion or idea.
10. **Snippets and copy.** In any caption field: "Copy from" another group's caption and hashtags; "Insert" a snippet of the client or the agency (hashtag sets append to the hashtags, caption snippets insert at the cursor).
11. **Publishing pack.** For an `approved`, `scheduled` or `published` post, edit-scope users copy each platform's caption with its hashtags (and the YouTube title) and download a zip of the media in slide order, named `<client>-<publish date>-<nn>.<ext>`, with a `captions-<group>.txt` per group (the YouTube title, the caption, a blank line, the hashtags) and a `links.txt` for link versions (`<nn> <url>`, numbered with the slides). The pack reads the approved snapshot when there is one (`cleared_review_id`), else the current content.

### Part B — Creation and the calendar
1. **The wizard** (`/content/new`, owner, 2026-10-26) has five steps:
   - **Basics:** client, title, type, platforms (the client's platform accounts first), publish date and time with suggested times (rule C3), pillar, occasion, responsible, needs client approval, counting line, notes, and "Start from an idea". "Create now" saves an `idea` post from this step.
   - **Captions:** one field per group with counters, hashtags, YouTube title, "Copy from", snippets, and the live preview.
   - **Media:** drag and drop, paste and choose; each file held as an upload (F10 rule 1), shown with progress, warnings and a slide caption; ordered by drag.
   - **Tasks:** link existing tasks (F08 rule 6's list) and add new ones, each with department, assignee or "department queue", title, brief, estimate, due date (default 2 work days before the publish date, F08 rule 9), files, and its subtasks with run mode and stages as F06B's subtasks step. At most 5 linked tasks in total (F08).
   - **Review:** previews per platform, the checks, the planning notes for the date (rule C10: another post close by, a gap filled, an occasion matched), F06B's readiness warnings for new tasks, and Save.
   The draft stays in the browser (local storage, per user and preset client and date, as F06B rule C1); "Start over" discards it.
2. **One transaction.** Saving creates the post, its captions, its files and layout, the new tasks with their subtasks, files and dependencies, the links of existing tasks, and marks the idea used. Every part is validated first; one failure saves nothing, and the error names the part (`details: { part: 'captions' | 'files' | 'tasks' | 'links', index }`). A post with a linked or new task starts `in_production` (F08). Notifications go after commit.
3. **Who may assign.** A new task goes to a person only where the creator may assign (F06); otherwise to the department's queue as a request, and its subtasks follow F06B rule A2.
4. **Day click.** On a calendar day of today or later (Asia/Damascus), `content.manage` holders open the wizard with that date; on a client's calendar the client is filled in. Past days are read-only.
5. **Ideas onto days.** Dragging an idea from the ideas panel onto a day of today or later opens the wizard from that idea on that date.
6. **Drag to move.** An open, non-archived post the user may edit moves by drag to a day of today or later, keeping its time. Published, cancelled and archived posts do not move; other users see no drag handle. On phones and in the agenda the post page and the card menu offer **Move** with a date picker.
7. **On drop** a confirmation shows the new date and, when the post has open linked tasks, "Shift the linked tasks' due dates by the same number of work days", ticked when any open linked task or subtask would be due after the new publish date, unticked otherwise (owner, 2026-10-26). It lists each task with its current and new due date.
8. **Move rules.** The move is F08's date edit (any open status, no re-approval, audited), so a post with the client keeps its snapshot date on the client page and the account manager is told (`post_moved`). A move to a day in another month keeps the counting line (F08 edge case 4).
9. **The shift** moves, by the work days between the old and new publish dates, the due date of each linked task that is not `approved`, `delivered` or `cancelled`, and of its open subtasks; a date that would fall before today becomes today, and a subtask stays not after its parent (F06B). It is done through `PostTasks` in the move's transaction, audited on each task with reason `post_moved`.

### Part C — Planning aids
1. **Pillars.** A post has at most one pillar from the non-archived list. A client's target mix is optional; when set it sums to 100.
2. **Pillar balance.** For a client and calendar month: the share of each pillar among the month's non-cancelled, non-archived posts, "no pillar" counted apart, against the targets. A pillar is off balance when it differs from its target by 15 points or more and the month has at least 4 posts.
3. **Best times.** For a date and the chosen platforms, the windows of that weekday (the client's for a platform it sets, else the agency's) are offered as chips under the time field; picking one fills its start time. Nothing is filled without a click.
4. **Occasions apply to a client** when they are not archived and are the client's own, or `general`, or of a category the client enabled; and not excluded or skipped for that year.
5. **Occasion dates.** A Gregorian occasion starts on its day each year; a Hijri one on the Umm al-Qura date computed for the year, until a manager confirms another start in `content_occasion_dates`; `once` on its date. It lasts `duration_days`.
6. **An occasion is covered** for a client, in a year, when a non-cancelled, non-archived post of that client published that year carries it (the year of the occurrence's start, the year "No post this year" names; owner, 2026-10-26): a yearly occasion needs a post each year. "No post for this occasion" shows from `lead_days` before the start until its end when it applies and is not covered; "No post this year" skips it.
7. **Gaps.** For a client, a run of more than `max_gap_days` consecutive days without a non-cancelled, non-archived post.
8. **Too close.** Two such posts of a client sharing a platform less than 3 hours apart, or on the same day when either has no time.
9. **Commitments.** For each open retainer cycle of the client, planned posts in the cycle's period against its committed lines: reels against `reel` lines, stories against `story` lines, posts and carousels against `post` and `design` lines. Flagged when fewer are planned than committed.
10. **The planning check** (`planningIssues`) applies rules C2 and C6–C9 to clients with an open cycle that has a `post`, `reel`, `story` or `design` line, or with content settings saved. The calendar shows its marks for any period viewed; the weekly notice covers the next 14 days from the week's first work day.
11. **Instagram grid.** For a client: its non-cancelled, non-archived posts on Instagram of type `post`, `carousel` or `reel`, from the month shown and the two months before, newest first, three columns, each tile its first slide (or the type icon), with its status; published posts plain, planned ones marked.
12. **Ideas.** Any active user adds an idea (text; client, pillar and occasion optional) from the quick-add button in the top bar or the ideas panel. Its author edits or drops it while open; edit-scope holders of its client (any `content.manage` holder for an idea without a client) edit, drop, restore and use it. "Use" opens the wizard prefilled (title from the text, client, pillar, occasion); saving the post marks the idea used in the same transaction (`IDEA_USED` if it was used meanwhile).

### Part D — Notifications, audit and permissions
- Every event above goes through the F16 engine (decided); the table under "Audit, notifications and jobs" lists each type.
- Every state change writes an audit entry in the same transaction (AGENTS.md).

## API
Schemas live in `packages/contracts/src/content.ts` (and `post-values.ts` for the lists, `post-checks.ts` for the limits, media rules and `postChecks`). The post detail gains `captions[]`, `pillar`, `occasion`, `checks[]`, `permissions.canDownloadPack`, and its `media` follows the layout, each medium with its `slideCaption`, `width`, `height` and `durationMs` (settled in PR 1: the layout is the order of `media`, not a second list); list and calendar items gain `pillar` and `occasionId`.

### Posts
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/content/posts` (changed) | `content.manage` | F08's fields without `caption` and `hashtags`, + `captions[]` (`group`, `caption?`, `hashtags?`, `title?`), `pillarId?`, `occasionId?`, `ideaId?`, `files[]` (`uploadId`, `name?`, `slideCaption?`; settled in PR 2: the files' order is the slide order, with no separate `layout`, which is set later on the post page), `linkTaskIds[]`, `tasks[]` (F06B's create payload: department, assigneeId?, title, briefDoc?, estimateMinutes?, dueDate, runMode?, stages[], subtasks[], files[]), `acceptLeave` | `postDetailSchema` | F08's + `INVALID_CAPTION_GROUP`, `UPLOAD_NOT_FOUND`, `FILE_TYPE_BLOCKED`, `LIMIT_REACHED`, `TASK_ALREADY_LINKED`, `TASK_NOT_LINKABLE`, `POST_COUNTED_BY_TASK`, `ASSIGNEE_ON_LEAVE`, `IDEA_USED`, `INVALID_LINK` (pillar, occasion or idea archived or of another client); `details.part` and `index` |
| `PATCH /api/content/posts/:id` (changed) | `content.manage` | + `captions[]`, `pillarId`, `occasionId`; `caption` and `hashtags` removed | `postDetailSchema` | F08's + `INVALID_CAPTION_GROUP` |
| `PUT /api/content/posts/:id/layout` | `content.manage` | `{ items: [{ fileItemId, caption? }] }` (every current medium once) | `postDetailSchema` | 403, 404, `POST_LOCKED`, `INVALID_ORDER` |
| `GET /api/content/posts/:id/move-preview` | `content.manage` | `publishDate` | `{ tasks: [{ id, title, parentId, dueDate, newDueDate, clamped }], suggestShift }` | 403, 404, `INVALID_DATES` |
| `POST /api/content/posts/:id/move` | `content.manage` | `{ publishDate, shiftTasks }` | `postDetailSchema` + `shiftedTaskIds` | 403, 404, `INVALID_DATES` (past), `POST_LOCKED` (published, cancelled), `POST_ARCHIVED` |
| `POST /api/content/posts/:id/status` (changed) | as F08 | as F08 | `postDetailSchema` | F08's + `CAPTION_TOO_LONG` (`details.checks`) |
| `GET /api/content/posts/:id/pack` | `content.manage` | — | `application/zip`, streamed | 403, 404, `INVALID_TRANSITION` (status) |
| `POST /api/content/posts/:id/duplicate` (changed) | as F08 | as F08 | copies captions and pillar | as F08 |

### Calendar, grid and planning
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/content/calendar` (changed) | `content.read` | + `pillarId` | + `occasions[]` (name, dates, category, client, covered per client when `clientId`), `issues[]` (rule C10, per day and client) | — |
| `GET /api/content/planning` | `content.read` | `from`, `to` (≤ 45 days), `clientId?` | per client: `issues[]`, `pillarBalance` (month of `from`), `commitments[]` | — |
| `GET /api/content/grid` | `content.read` | `clientId`, `month` | grid tiles (rule C11) | 404 |

### Settings, pillars, occasions, snippets
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/content/settings` · `PUT` | `content.read` · `content.review` (all) | — · `{ postingTimes }` | agency settings | 403 |
| `GET /api/content/clients/:clientId/settings` · `PUT` | `content.read` · `content.manage` (client) | — · client settings fields | client settings with the agency defaults resolved | 403, 404, `INVALID_LINK` (archived pillar), `INVALID_TARGETS` (sum ≠ 100) |
| `POST /api/content/clients/:clientId/occasion-skips` · `DELETE …/:occasionId/:year` | `content.manage` (client) | `{ occasionId, year }` | client settings | 403, 404 |
| `GET /api/content/pillars` · `POST` · `PATCH /:id` · `PUT /order` · `POST /:id/archive` · `/restore` | `content.read` · `content.review` (all) | name, color, position | pillar(s) | 403, 404, `LIMIT_REACHED`, `NAME_TAKEN`, `INVALID_ORDER` |
| `GET /api/content/occasions` | `content.read` | `from`, `to`, `clientId?`, `includeArchived?` | occasions with resolved dates (rule C5) and whether each date is confirmed | — |
| `POST /api/content/occasions` · `PATCH /:id` · `POST /:id/archive` · `/restore` | `content.review` (all); a client's own occasion also `content.manage` (client) | occasion fields | occasion | 403, 404, `INVALID_DATES` |
| `PUT /api/content/occasions/:id/dates/:year` · `DELETE` | `content.review` (all) | `{ startDate }` | occasion | 403, 404, `INVALID_DATES` |
| `GET /api/content/snippets` · `POST` · `PATCH /:id` · `POST /:id/archive` | `content.read` · per Roles | `clientId?`, `kind` · name, body | snippet(s) | 403, 404, `LIMIT_REACHED` |

### Ideas
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/content/ideas` | `content.read` | `status` (`open` default, `used`, `dropped`), `clientId?`, `mine?`, `q?`, page | `ideaPageSchema` | — |
| `POST /api/content/ideas` | `content.suggest` | `{ text, clientId?, pillarId?, occasionId? }` | idea | `CLIENT_ARCHIVED`, `INVALID_LINK` |
| `PATCH /api/content/ideas/:id` | per rule C12 | the same fields | idea | 403, 404, `IDEA_USED` |
| `POST /api/content/ideas/:id/drop` · `/restore` | per rule C12 | `{ reason? }` · — | idea | 403, 404, `IDEA_USED` |

### Changes to other modules
- **`approvals` (F09):** post items and the public page carry `captions[]` per group (from the snapshot, with the fallback for earlier rows), each post file its `slideCaption` (the files are the slides, in order), and the client's name and logo for the previews: `clientImage` says whether the client has one, served to the link holder at its small size by `GET /api/public/approvals/:token/client-image` (settled in PR 1: images need a session, so the link needs its own route).
- **`files` (F10):** `mediaInfo` on uploads; `durationMs` on version responses; the post limit of 20.
- **`tasks` (F06B):** `PostTasks.create` with the F06B payload, `PostTasks.shiftDueDates`.

New error codes: `CAPTION_TOO_LONG`, `INVALID_CAPTION_GROUP`, `INVALID_TARGETS`, `IDEA_USED`. `NAME_TAKEN` is reused where it exists, else added.

## Screens
All Arabic RTL with logical CSS, `packages/ui` components and tokens, strings through i18next (`content.*`), dates in Asia/Damascus with Latin digits, weeks from Saturday; loading, empty and error states on each. Platform previews and pillar colours use design-system tokens only.

1. **New post wizard** `/content/new` (from "New post", a calendar day, an idea, or a client's Content tab, with those preset).
   - A step bar: Basics, Captions, Media, Tasks, Review; on a phone one step per screen.
   - The **preview panel** beside the steps (below them on a phone): a tab per platform of the post, each a frame close to the platform's layout (profile name and logo of the client, the media at the type's ratio, the slides to swipe, the caption cut where the platform cuts it with "more", the hashtags).
   - Counters turn to the warning tone over a limit; the checks list sits on the Review step with "Go to" links.
2. **Content** `/content` (changed).
   - **Calendar:** day cells open the wizard on click (today and later, edit-scope users); posts drag between days (desktop); an occasion strip on its days, with "No post planned" on a client's calendar when it applies; dotted marks for gap days and a mark on posts too close; a filter by pillar; pillar colour dots on cards.
   - **Ideas panel:** a toggle beside the calendar listing open ideas (filter by client, mine), each draggable onto a day, with Use and Drop.
   - **Planning check** tab: per client, the next 14 days' issues with links to the days, and the month's pillar balance and commitments.
   - **My posts:** unchanged, plus "At risk" (posts of mine not approved within two work days).
3. **Client Content tab** (changed): the calendar as above fixed to the client; the month bar gains the pillar balance (bars against targets) and "planned / committed" per kind; a **Grid** view beside Month and Week; a **Settings** dialog for edit-scope users (pillar targets, rhythm, best times, occasion categories and exclusions, X long posts) and **Snippets**.
4. **Post page** `/content/posts/$postId` (changed): Content shows a tab per caption group with counters, "Copy from" and snippets; **Slides** replaces the media list (drag to order, slide captions, warnings per medium); **Checks** at the top while any applies; **Preview** per platform; **Move** in the header menu; **Publishing pack** (copy per platform, download) on approved, scheduled and published posts; pillar and occasion in Schedule.
5. **Move dialog**: the new date, the shift option and the task list with current and new dates (rule B7).
6. **Content settings** `/content/settings` (`content.review` all; others read): Pillars (add, rename, colour, order, archive), Occasions (list by next date, add, edit, archive, confirm a Hijri date for this year), Default best times per platform, Agency snippets.
7. **Quick idea**: a button in the top bar for every user, opening a one-line form (text, optional client and pillar).
8. **Client page** `/a/$token` (F09, changed): each post item shows platform tabs with the preview and its caption, the slides with their captions, then Approve and Request changes; phone width first.
9. **Reviewers' views** (medical queue, the request dialog, the request page): the caption groups and slide count in the post summary.

Settled in PR 3: the previews cut a caption where the platforms fold it on a phone (approximate values in `apps/web/src/features/content/post-preview.ts`, never checked against the platforms); pillar colours are the design system's `chart-1..8` tokens; on the post page "Move" sits in the header menu (the calendar drag arrives with PR 4); the wizard keeps new tasks' held files with each task and sends them in the create request.

What roles see differently: everyone reads every calendar, preview, idea and setting; edit-scope users get clicks, drags, the wizard, captions, slides, the pack and the client's settings; `content.review` scope-all holders edit the agency settings; every user adds ideas.

## Audit, notifications and jobs
- **Audit** (entity `post` unless noted):
  - `post.created` (with caption group count, file count, task ids and the idea id), `post.updated` (changed fields; captions as lengths per group before and after, not the text), `post.layout_changed` (order and slide caption lengths), `post.moved` (from, to, `shiftedTaskIds`);
  - tasks write F06's `task.updated` for each shifted due date with reason `post_moved`, and F06B's creation entries for tasks made in the wizard;
  - `content_pillar.*`, `content_occasion.*` (created, updated, archived, restored, `date_confirmed`), `content_settings.updated` (agency or client), `content_snippet.*`, `content_idea.created`, `content_idea.updated`, `content_idea.dropped`, `content_idea.restored`, `content_idea.used` (post id);
  - downloading the pack writes `post.pack_downloaded`.
- **Notifications** (F16 engine, the shared rules of v2-scope §4; subject `post` unless noted; the actor never notifies themselves):

| Type | Event | Recipients | Pri. | Box | Push | Email | Resolves when / notes |
|---|---|---|---|---|---|---|---|
| `post_assigned` (existing) | the responsible is set at creation or changed | new responsible | important | A | on | — | as F16 |
| `post_unassigned` | the responsible changes away from a person | the previous responsible | informational | I | — | — | replaces F16's `responsibility_moved` for posts (settled in PR 2) |
| `post_changed` | captions, slides, platforms, type or title changed by someone other than the responsible | the responsible + followers | normal | I | on | — | merges per post and day · gap found by the event audit |
| `post_moved` | the publish date changes (drag, Move or edit) | the responsible + assignees of open linked tasks and subtasks + the AM when the post is `awaiting_client` or later | normal | I | on | — | merges per post and day; carries old and new dates and the shifted tasks; the shifted tasks' assignees get this instead of `task_changed` |
| `post_task_ready` ✏️ (existing) | a linked task becomes `approved`, **or a subtask of a linked task is delivered** | the responsible | normal | I | on | — | merges per post and day |
| `post_publish_shortly` ✏️ (existing) | 2 h before the publish time of an `approved` post **not yet scheduled** (scheduled posts no longer get it) | the responsible | important | A | on | — | scheduled, published, re-dated, cancelled |
| `post_at_risk` | daily job: an open post not yet approved (`idea` to `awaiting_client`) whose publish date is within two work days | the responsible + the AM | important | A | on | — | approved, re-dated beyond two work days, cancelled or archived · once per post and publish date; carries what it waits on (tasks by name, internal or medical review, the client since a date) |
| `content_week_check` (subject `content_week`: the week's Saturday) | weekly, the week's first work day 09:00: clients with planning issues in the next 14 days (rule C10) | every member of Content Management (owner, 2026-10-26) | normal | I | on | digest | replaced by the next week's · one per recipient, listing the clients with their counts and linking to the Planning check |
| `content_idea_added` (subject `content_ideas`: the day) | an idea is added | Content Management members | informational | I | — | — | merges per day |
| `content_idea_used` (subject the post the idea became) | an idea becomes a post | its author | informational | I | — | — | |
| `post_*` of F08 and F16 | as before | | | | | | unchanged |

  New types go under Content in the settings (category `content`). Settled in PR 2: the synthetic subjects `content_week` (the weekly check) and `content_ideas` (the ideas added on a day) take ids derived from the date, and `content_idea_used` links to the post the idea became (`contentWeekSubjectId`, `contentIdeasSubjectId`); `post_moved` is listed in the F08B block of the type order, and the shifted tasks' assignees get it instead of `task_changed` because the content module sends only `post_moved` for a move (the two have different subjects, so the order alone could not pick one).
- **Event audit of the touched modules** (content, files, tasks): three gaps are added: content edits by someone other than the responsible (`post_changed`), a previous responsible taken off a post (`post_unassigned`), and a post still not approved close to its date (`post_at_risk`, owner, 2026-10-26). Moves notified nobody and get `post_moved`. Settings, pillars, occasions and snippets need no notification. Every other content, file and task change already has a type.
- **Jobs:**
  - `notifications.daily` gains `post_at_risk` and, on the week's first work day (Saturday, or the next work day when it is a holiday), `content_week_check`;
  - `notifications.timed` keeps `post_publish_shortly`, now for `approved` posts only;
  - `files.purge-uploads` purges wizard uploads left unsaved (F10); the wizard warns after 20 hours (F06B);
  - the pack is streamed by the api on request; no new job or schedule.
- **Deploy:** migrations only (expand: `post_captions` filled from the posts, `caption` and `hashtags` kept). Nothing changes on the server.

## Edge cases
1. **Snapshots before F08B** have no `captions`: the client page and the post history show their single caption under every group. A request sent before the deploy keeps working.
2. **A platform removed after approval**: its caption row stays hidden; the client page shows the snapshot as approved; the pack shows only the post's current platforms.
3. **Facebook alone, then Instagram added**: the same group, so the caption carries over; the limit drops to 2200 and a longer caption then blocks the next submission.
4. **X long posts turned off** with a long X caption in review: the check applies at the next submit or pass; an approved post is not reopened.
5. **A linked task's new final** after the layout was set joins at the end; a medium whose task is unlinked leaves the layout and its slide caption is lost (audited in `post.layout_changed`).
6. **Two people move the same post**: the last move wins; both are audited and the responsible is told of each. The shift of the second move counts from the date the first one left.
7. **Shift with a task due before today**: its new date becomes today and the dialog marks it "clamped"; a subtask is never moved after its parent.
8. **A post moved while its tasks wait on the client approval of the post**: the tasks are `approved` and do not shift.
9. **The wizard fails on one part** (a held upload expired, a task assignee no longer allowed): nothing is saved and the step named in the error opens; held uploads older than 24 hours are gone (F10) and must be added again.
10. **An idea used by two people at once**: the second save answers `IDEA_USED` and keeps its wizard draft, so the post can still be saved without the idea.
11. **An occasion archived** with posts on it: the posts keep it, shown muted; it no longer appears on the calendar or in checks.
12. **Ramadan's start confirmed a day later**: the confirmed date replaces the computed one for that year; posts are not moved.
13. **A pillar archived** while in a client's targets: the target is ignored and the settings dialog asks to redistribute.
14. **A client without a retainer and without settings**: no planning check; occasions still show on its calendar.
15. **More than 40 media on one post** (20 own files and many finals): the layout takes the first 40; the rest follow in F08 rule 5's order and a check warns.
16. **A video uploaded from a browser that cannot read its metadata**: no `mediaInfo`, so no length or ratio warning.

## Open questions
- None block F08B. The owner decided the interview's questions on 2026-10-26 and approved the spec, including the two derived rules (A2: adding a platform of a new caption group after approval needs "Reopen content"; A3: more than 30 Instagram hashtags blocks the submission) (ADR 0042).
- Not asked, chosen as the simplest reading and easy to change before implementation: the 15-point pillar tolerance with at least 4 posts; "too close" at 3 hours; the default rhythm of 3 days; the starting occasions, best times and media rules (starting values the Content Management manager or a code change corrects); Instagram's 30-hashtag cap blocking like the character limits; the pack only for approved, scheduled and published posts; a client-less idea covered by every `content.manage` holder.
- Could not confirm: the platform limits in `PLATFORM_TEXT_LIMITS` and `PLATFORM_MEDIA_RULES` were taken from the platforms' help pages as known in 2026-10, not checked live in this session.

## Acceptance
- Owner check in the browser (content writer W and manager CM of Content Management, designer D and Design manager M, account manager A, an employee E of another department; a client C with an active retainer whose open cycle has lines post 8 and reel 2):
  1. As E, add an idea for C from the top bar; CM is notified. As W, open the ideas panel on C's Content tab and drag the idea onto a day next week: the wizard opens on that date with the idea.
  2. In the wizard pick Instagram, Facebook, X and YouTube: three caption fields appear (Facebook with Instagram, X, YouTube with a title). Write an X caption over 280: the counter warns. Insert a hashtag set, "Copy from" the Instagram caption into LinkedIn after adding it.
  3. Drop three images and paste a screenshot; order them as slides with a caption on the second; the Instagram preview shows the swipeable slides and the cut caption.
  4. On Tasks, add a Design task to D with two subtasks in sequence, and link the cycle's "Reel 1"; Review lists the checks and readiness; Save: the post is in production with both tasks, the idea is used and E is told.
  5. Submit: refused with `CAPTION_TOO_LONG` for X. Shorten it and submit after the tasks are approved; CM passes; A sends the month. Open the link at phone width: the platform tabs, previews and slide captions show; approve.
  6. On the calendar, drag the post two days earlier: the dialog offers to shift the tasks, ticked; confirm; the task dates moved and D got `post_moved`. Click a past day: nothing opens; click tomorrow: the wizard opens.
  7. Download the publishing pack: the zip has the slides named in order and the captions per platform.
  8. In C's settings set targets 40/30/20/10 and best times for Instagram; create a post on a Saturday: the time chips follow the client's windows. The month bar shows the pillar balance and "planned / committed".
  9. In content settings, confirm Ramadan's start for this year; on C's calendar its strip shows "No post planned" until a post carries it. Run the daily job on the week's first work day: CM members get one weekly check listing C's gaps.
  10. Leave a post in production with its date in two work days and run the daily job: W and A get `post_at_risk` once. View C's Grid.
- Tests:
  - Unit (contracts): caption groups, `PLATFORM_TEXT_LIMITS` counting (code points, hashtags), `postChecks` per rule A3–A4, `suggestPublishTimes`, `occasionDates` (Hijri years, confirmed overrides, durations across years), `planningIssues` (gaps, too close, commitments, occasions, pillar balance), schemas (layout, targets summing to 100, snippets, ideas), the permission map (`content.suggest`).
  - API (`apps/api/test/content-captions.test.ts`, `content-creation.test.ts`, `content-move.test.ts`, `content-planning.test.ts`, `content-ideas.test.ts`, extensions of `content-posts.test.ts` and `approvals-public.test.ts`): each route for success, 401, 403 and out of scope (an AM on another client's settings, a member of Design editing captions, a plain employee editing another's idea, a non-manager editing pillars); each error code; the migration of existing captions; the content token over captions, layout and slide captions; creation in one transaction (a failing part saves nothing); the move and shift with clamping and subtasks; old snapshots on the client page; audit entries in the same transaction.
  - Jobs: `post_at_risk` once per post and date, Friday and holiday handling; `content_week_check` on the first work day only, one per recipient; `post_publish_shortly` skips scheduled posts.
  - Notifications: recipients of each new type; `post_moved` replacing `task_changed` for shifted tasks.
  - Architecture test: unchanged boundaries (`tasks`, `files`, `clients`, `projects` do not import `content`).
  - E2E: idea → wizard with captions, slides and a task with subtasks → submit refused then passed → month link with previews → approve → drag with shift → pack.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): the wizard (each step, phone and desktop, the preview panel per platform), the calendar with occasions, gaps and the ideas panel, the move dialog, the Planning check, the Grid, the client settings dialog, content settings, the post page (captions, slides, checks, pack), the client page with platform tabs (phone width), the quick idea.
