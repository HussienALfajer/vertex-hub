# F01C — Profile photos and logos

Status: Approved · Date: 2026-10-25 · Scope: `docs/product/v2-scope.md` §F01C (and the rules shared by F01C, F06B and F08B) · ADRs: 0013, 0014, 0018, 0019, 0028, 0036, 0037, 0039, 0040

## Summary
Every person, client, project and retainer in the Hub is shown as a coloured initial today, so a list of twenty people or clients reads as a wall of letters. F01C gives each of them a real image: staff upload their own photo from My account (the General Manager and the Operations manager can do it for anyone), a client gets a logo uploaded or cut from its brand files, and a project or retainer gets its own image or shows its client's logo. Images are cropped square in the browser, rendered as small and medium thumbnails in the background, served only to signed-in users, and replace the initial everywhere the app shows these records, on the entrance screen greeting and next to the client's name on every PDF sent to a client. The initial stays the fallback.

## In scope / out of scope
- In:
  - An `images` table in the `files` module (ADR 0040): one current image per user, client, project or retainer; replaced and removed images are archived, never deleted.
  - Setting and removing an image for a user, a client, a project and a retainer, through the F10 upload route and a square crop in the browser that can also zoom out so a whole logo fits (owner, 2026-10-25).
  - A client logo picked from the client's brand files of kind `logo` (F10), cropped like an upload. No logo is taken automatically (owner, 2026-10-25).
  - A project or retainer without its own image shows its client's logo.
  - Small (128 px) and medium (320 px) WebP renditions rendered by the `files.preview` job; the route serving them to signed-in users only.
  - The image in place of the initial on every screen that shows a person, client, project or retainer with an avatar (see "Screens"), through the existing `Avatar` component.
  - The employee's photo in the F17 greeting on the entrance screen and the phone (owner, 2026-10-25).
  - The client's logo beside the client's name on every client-facing PDF: quotes, invoices, draft previews, receipts, statements, retainer contracts and annexes, campaign reports and client reports (owner, 2026-10-25).
  - Notifications when someone else changes or removes an image, to the person responsible for the record (owner, 2026-10-25), and when someone else edits a user's profile (a gap found by the event audit).
  - A quiet prompt: an "Add your photo" card on My account for users without a photo, and a "Without photo" filter on the team list for `users.manage` holders (owner, 2026-10-25). No notification.
- Out (later or never):
  - Images in emails (the digest, notification and client emails): image links that work without a session would break the "signed-in users only" rule (owner, 2026-10-25).
  - Images in push notifications (the notification icon stays the Vertex icon).
  - A history screen of past images or restoring an old one (the archived rows and the audit keep the record).
  - Images for leads, departments, campaigns or posts.
  - Taking a logo automatically from the brand files; face detection or automatic cropping.
  - Server-side cropping of raw uploads: the browser sends the square; the server only centre-crops anything not square (rule 6).

## Roles and access
No new permission. Viewing an image needs only a signed-in, active session: every user already reads users, clients, projects and retainers (F01, F02, F05).

| Action | Permission | Roles and scope |
|---|---|---|
| See images | session | every active user |
| Set or remove one's own photo | session | every active user, on their own account |
| Set or remove another user's photo | `users.manage` | General Manager: all · Operations manager: all users except General Manager holders (F01) |
| Filter the team list by "Without photo" | `users.manage` | as above |
| Set or remove a client's logo | `clients.manage` | General Manager, Operations manager: all · Account Manager: own_clients |
| Set or remove a project's image | `projects.manage` | General Manager, Operations manager: all · Account Manager: own_clients · Project manager: assigned |
| Set or remove a retainer's image | `projects.manage` | General Manager, Operations manager: all · Account Manager: own_clients (retainers have no `assigned` scope, F05) |
| Pick a logo from the brand files | `clients.manage` | as "Set a client's logo"; the brand files are read with F10's rules |

"Operations manager" means the manager of Internal Operations, who is HR in F17. Department managers have no right over their members' photos (scope, 2026-10-25).

## Data

### `images` (owned by `files`, ADR 0040)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid v7 | |
| `subject_type` | enum `image_subject_type` (`user`, `client`, `project`, `retainer`) | required |
| `user_id`, `client_id`, `project_id`, `retainer_id` | uuid FK, null | exactly the one matching `subject_type` is set (check constraint, as `file_items`) |
| `source` | enum `image_source` (`upload`, `brand_file`) | required; `brand_file` only for `client` (check) |
| `source_version_id` | uuid FK `file_versions`, null | required for `brand_file`, null otherwise (check): the brand logo version the crop was cut from |
| `storage_key` | text | the square image as uploaded, under `FILES_ROOT` (`objects/<yyyy>/<mm>/<uuid>`, F10); renditions sit beside it as `<key>.sm.webp` and `<key>.md.webp` |
| `mime_type` | text | `image/png`, `image/jpeg` or `image/webp`, detected from the content |
| `size_bytes` | integer | > 0 and ≤ 10 485 760 (10 MB) |
| `width`, `height` | integer, null | from the upload's header; set from the full image by the job |
| `status` | enum `image_status` (`pending`, `ready`, `failed`) | `pending` until the job renders the renditions |
| `attempts` | smallint | render attempts, default 0 |
| `created_by_id` | uuid FK `users` | |
| `created_at`, `updated_at` | timestamptz | |
| `archived_at` | timestamptz, null | set when the image is replaced or removed |
| `archived_by_id` | uuid FK `users`, null | |

Indexes: a partial unique index per subject column where `archived_at is null` (one current image per subject); an index on `status` where `status = 'pending'` for the job. Archived means replaced or removed: the row and its files stay on disk, the route answers 404 for it.

### Columns on the records (owned by their modules)
`users.image_id`, `clients.image_id`, `projects.image_id`, `retainers.image_id`: uuid FK `images`, null; the current image, set and cleared in the same transaction as the `images` row through the `files` module's exported `ImagesService`. The modules that build references read their own column, so no module reads `images` (module boundaries, AGENTS.md). The Better Auth `users.image` column stays unused and null.

### Contracts
- `packages/contracts/src/images.ts`: `IMAGE_SUBJECT_TYPES`, `IMAGE_SIZES` (`sm` 128, `md` 320), `IMAGE_MAX_BYTES`, `IMAGE_MIN_SIDE` (128), `IMAGE_UPLOAD_SIDE` (1024), the accepted types, `setImageSchema` (`source: { uploadId, brandVersionId? }`), `imageSchema` (`id`, `status`), `imagePath(id, size)`.
- Every reference to a person, client, project or retainer that a screen renders with an avatar gains `imageId: uuid | null`. The person references duplicated across contract files (`const personSchema = { id, name }` in a dozen files) are replaced by one shared `personSchema` with `imageId`, and the client references (`{ id, name }`) by one shared `clientRefSchema`. Project and retainer references carry the effective image: their own, else their client's logo (rule 3). The existing nullable `image` string fields (session user, devices, audiences, announcement receipts; always null today) become `imageId`.
- `attendanceGreetingSchema` gains `photo: string | null`, a `data:image/webp;base64` URL of the medium rendition (rule 15).
- PDF job payloads of client-facing documents gain `clientLogoKey: string | null` (rule 14).

## States and rules
An image is `pending` → `ready`, or `pending` → `failed`; any state → archived when replaced or removed.

### Setting and removing
1. **Set.** `PUT …/:id/image` takes an `uploadId` from `POST /api/files/uploads` (F10 rule 1; the uploader only, attached once, `UPLOAD_NOT_FOUND` otherwise). In one transaction, with the record's row locked: the previous current image is archived, a new `images` row is created as `pending`, the record's `image_id` points to it, the upload row is deleted (F10's attach), the audit entry and the notification are written; the `files.preview` job is nudged after commit.
2. **Accepted uploads.** PNG, JPEG or WebP by content (`IMAGE_TYPE_NOT_ALLOWED`), at most 10 MB (`IMAGE_TOO_LARGE`), at least 128 px on each side when the header gives the size (`IMAGE_TOO_SMALL`). The browser normally sends a 1024 × 1024 WebP (PNG when it cannot encode WebP), or the crop's own size when smaller.
3. **Project and retainer fallback.** A project or retainer shows its own current image, else its client's current logo, else its initial. Removing a project's image returns it to the client's logo. A change of the client's logo shows at once on every project and retainer without its own image.
4. **Remove.** `DELETE …/:id/image` archives the current image and clears `image_id`; the record shows its initial (or the client's logo, rule 3). Removing when there is no image is a no-op (204, no audit).
5. **Archived records.** A user, client, project or retainer that is archived keeps showing its image; setting or removing is refused (`USER_ARCHIVED`, `CLIENT_ARCHIVED`, `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED`). Archived users cannot sign in, so they never change their own.

### Brand logos
6. **Picking from the brand files.** The picker lists the client's non-archived brand files of kind `logo` whose latest version is an upload with a `ready` preview (F10 rule 18, which covers SVG). The browser loads that version's 1600 px preview, crops it like an upload and uploads the result; the set request carries `brandVersionId`, which must be a version of a non-archived `logo` brand file of the same client (`BRAND_FILE_NOT_FOUND`). The image is then `source: brand_file`. A later new version of that brand file does not change the logo: the client's logo is the crop that was saved.
7. **No automatic logo.** A client with logo brand files but no logo shows its initial; its page offers "Choose logo" with the brand logos first (owner, 2026-10-25).

### Cropping (browser)
8. **The crop dialog** shows a square frame (round for people, square for clients, projects and retainers, as the `Avatar` shapes) over the image, with drag to move and a zoom slider. The zoom goes from "fill the square" up to 4× and, for clients, projects and retainers, down to "the whole image fits", so a wide logo can sit whole in the square; the space around it stays transparent (owner, 2026-10-25). Mobile: pinch to zoom, drag to move; the file input accepts the camera.
9. **Decoding** happens in the browser, so formats the browser opens (HEIC on iPhone Safari) work; a file the browser cannot open shows "This image cannot be opened" without uploading.

### Renditions and serving
10. **Rendering.** The `files.preview` job (F10 rule 18, worked by the API with sharp, ADR 0019) also renders pending images: it reads the stored square, centre-crops it if it is not square, and writes `sm` (128 px) and `md` (320 px) WebP renditions with transparency kept, then sets `ready` with the width and height. Each run takes up to 20 pending images, each tried up to 3 times, then `failed`. The F10 nudges (after commit, the daily purge) cover images too.
11. **Serving.** `GET /api/images/:id/:size` (`sm` or `md`) serves a current image to any signed-in active user, through `X-Accel-Redirect` in production as F10 does. A `ready` image is served from its rendition with `Cache-Control: private, max-age=31536000, immutable` (an image never changes; a new image has a new id). A `pending` image is served from the uploaded square itself with `Cache-Control: no-store`, so the new photo shows at once. A `failed`, archived or unknown image is 404, and the `Avatar` shows the initial. Every response carries `X-Content-Type-Options: nosniff` and is served inline (all three types are on F10's safe list).
12. **Display.** The `Avatar` shows the medium rendition for sizes `lg` and `xl` and the small one below. An image sits on a white surface from the design tokens, so a transparent logo reads on it; the initial shows while the image loads and if it fails.
13. **Offline (F16).** The app's offline cache keeps image routes cache-first, so the last loaded images show without a connection.

### Beyond the app screens
14. **Client-facing PDFs.** When a quote, invoice, draft preview, receipt, statement, retainer contract or annex, campaign report or client report is rendered, its frozen job payload carries `clientLogoKey`: the storage key of the client's current logo (`md` when `ready`, the uploaded square when `pending`, null without a logo or when `failed`). The worker reads it from `FILES_ROOT` and embeds it as a data URL in a 12 mm square tile beside the client's name in the client block; the Vertex logo stays in its place in the header (owner, 2026-10-25). A missing file renders the name alone and is logged, never failing the PDF. PDFs already rendered keep the logo they were rendered with; a new render (a new version, a re-issue, a new statement) takes the current one. Internal PDFs are unchanged. The key is read when the job is queued and stays outside the render hash: a draft preview or a statement reused because its content is unchanged keeps the logo it was rendered with (implementation, 2026-10-25).
15. **Entrance screen and phone greeting (F17 rule C20).** The greeting carries the employee's `md` photo as a data URL (about 20 KB), so the entrance screen, which has no user session, shows the photo of the person who just punched without a new image route. Without a ready or pending photo, `photo` is null and the screen shows the initial. The kiosk notification carries the image id, not the photo (PostgreSQL's notifications hold under 8000 bytes): the API process holding the screen's stream reads the photo before sending the greeting (implementation, 2026-10-25).

### Prompt and filter
16. **"Add your photo".** My account shows a card "Add your photo" with the upload button while the user has no photo. "Not now" hides it in that browser (local storage); it never notifies.
17. **"Without photo".** The team list (`/team`) gains a filter "Without photo" for `users.manage` holders (`GET /api/users?hasImage=false`), counting active users only.

### Notifications
18. **Changed by someone else.** Setting or removing an image notifies the person responsible for the record, unless they made the change: a user's photo → that user; a client's logo → the client's primary account manager; a project's image → its project manager; a retainer's image → the client's primary account manager (owner, 2026-10-25). Nobody is notified when the responsible person is the actor or there is none.
19. **Profile edited by someone else.** Changes by another person to a user's name, title, phone or skills (F01 `PATCH /api/users/:id`) notify the user, with the fields that changed. Role and archive changes keep their F01 security notice.

## API
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `PUT /api/users/:id/image` | session (self) or `users.manage` in scope | `setImageSchema` (no `brandVersionId`) | `imageSchema` | 403, 404, `UPLOAD_NOT_FOUND`, `IMAGE_TYPE_NOT_ALLOWED`, `IMAGE_TOO_LARGE`, `IMAGE_TOO_SMALL`, `USER_ARCHIVED` |
| `DELETE /api/users/:id/image` | as above | — | 204 | 403, 404, `USER_ARCHIVED` |
| `PUT /api/clients/:id/image` | `clients.manage` in scope | `setImageSchema` | `imageSchema` | 403, 404, the upload codes, `BRAND_FILE_NOT_FOUND`, `CLIENT_ARCHIVED` |
| `DELETE /api/clients/:id/image` | `clients.manage` in scope | — | 204 | 403, 404, `CLIENT_ARCHIVED` |
| `PUT /api/projects/:id/image` | `projects.manage` in scope | `setImageSchema` (no `brandVersionId`) | `imageSchema` | 403, 404, the upload codes, `PROJECT_ARCHIVED` |
| `DELETE /api/projects/:id/image` | `projects.manage` in scope | — | 204 | 403, 404, `PROJECT_ARCHIVED` |
| `PUT /api/retainers/:id/image` | `projects.manage` in scope | `setImageSchema` (no `brandVersionId`) | `imageSchema` | 403, 404, the upload codes, `RETAINER_ARCHIVED` |
| `DELETE /api/retainers/:id/image` | `projects.manage` in scope | — | 204 | 403, 404, `RETAINER_ARCHIVED` |
| `GET /api/images/:id/:size` | session | `size`: `sm` or `md` | WebP, PNG or JPEG bytes | 404 |
| `GET /api/users` (F01, extended) | `users.read` | adds `hasImage` (boolean) | unchanged, items gain `imageId` | `hasImage` without `users.manage`: 403 |

Out of scope requests: a user outside the actor's scope answers 403 when readable, 404 when not readable (F01, F02, F05 rules). The `PUT` routes are owned by the record's module (`auth`, `clients`, `projects`) and call `ImagesService.set` / `remove` inside their own transaction; `GET /api/images` is owned by `files`. `brandVersionId` is checked by `files` against its own tables.

## Screens
All RTL with logical CSS, `packages/ui` components, every string through i18next.

1. **Image dialog** (shared component in `features/images/`): opened from "Change photo", "Change logo" or "Change image". Steps: choose (upload a file or take a photo; for clients also the "From brand files" tab with the logo brand files as thumbnails) → crop (rule 8) with a live preview at the three avatar sizes → save (upload with progress, then set). "Remove" when there is an image, with a confirm. States: decoding, uploading (progress, cancel), saving, errors in place (type, too large, too small, cannot open, network, storage full). For clients without logo brand files the tab shows "No logos in the brand files" and a link to the Brand kit tab.
2. **My account** (`/account`): the photo in the header (size `xl`) with "Change photo" and "Remove"; the "Add your photo" card (rule 16).
3. **Team profile** (`/team/:userId`): the photo in the header; "Change photo" and "Remove" for `users.manage` in scope. **Team list** (`/team`): photos in the rows; the "Without photo" filter (rule 17).
4. **Client page** (`/clients/:clientId`): the logo in the header (square, `xl`) with "Change logo" for `clients.manage` in scope; "Choose logo" in place of the initial when the client has no logo and the actor can manage it (rule 7).
5. **Project page** and **retainer page**: the image in the header with "Change image"; when showing the client's logo, a caption "Client's logo" and "Use its own image"; "Remove" returns to the client's logo.
6. **Everywhere else** an `Avatar` shows a person, client, project or retainer, it receives `imageId`: the app shell header, team and department pages, HR people and the employee file, HR requests, items and approvals, task lists, the board, task rows, workload, assignee pickers, comments and actions, approvals, audit, notification items (the actor), announcement receipts, the audience picker, signed-in devices, leads (owner and client), clients, projects and retainers lists and pickers, project badges, content posts, templates and generation, the calendar's people. A web helper builds the `src` from `imageId` and the size; components without an `imageId` today get it from their contract.
7. **Entrance screen** (`/kiosk`) and the phone greeting: the photo large beside the greeting (rule 15).

What roles see differently: everyone sees every image; the change and remove actions and the "Without photo" filter follow the access table.

## Audit, notifications and jobs
- **Audit** (on the record, so the audit screen links it): `user.image_set`, `user.image_removed`, `client.image_set`, `client.image_removed`, `project.image_set`, `project.image_removed`, `retainer.image_set`, `retainer.image_removed`; `after` carries `imageId`, `source` and `brandVersionId` (for brand picks); `before` carries the replaced `imageId`. The F01 profile update already audits its fields. Renders and failures are not audited.
- **Notifications** (F16 engine, the shared rules of v2-scope §4):

| Type | Event | Recipients | Pri. | Box | Push | Email | Resolves when / notes |
|---|---|---|---|---|---|---|---|
| `profile_changed` | another person sets or removes the user's photo, or edits their name, title, phone or skills (rules 18, 19) | the user | informational | I | off | — | merges per user and day (mutable), names the actor and what changed; category `account`, subject `user` |
| `client_logo_changed` | another person sets or removes a client's logo | the client's primary account manager | informational | I | off | — | merges per client and day; category `clients_projects`, subject `client` |
| `project_image_changed` | another person sets or removes a project's image | the project manager | informational | I | off | — | merges per project and day; subject `project` |
| `retainer_image_changed` | another person sets or removes a retainer's image | the client's primary account manager | informational | I | off | — | merges per retainer and day; subject `retainer` |

  None needs an action, so none self-resolves, reminds or escalates; followers are not added. Users may turn each off within the F16 channel policy.
- **Event audit of the touched modules** (users, clients, projects, retainers): every state change in them already has a catalog type (assignment, status, archive, security changes, account manager and project manager changes, terms, cycles, amendments, contracts) except the profile edits by another person, added above as `profile_changed`.
- **Jobs:** `files.preview` renders pending images (rule 10); no new job or schedule. The PDF jobs embed the logo (rule 14).
- **Deploy:** none beyond the release; images live under the existing `FILES_ROOT` and backup, behind the existing internal nginx location.

## Edge cases
1. **Two changes at once** (the user and HR): the record row is locked; the second waits and replaces the first; both are audited and the last one shows.
2. **A list loaded before a change** holds the old `imageId`: the old id now answers 404 and the `Avatar` shows the initial until the list reloads; nothing breaks.
3. **The job is down:** a `pending` image is served from the uploaded square (rule 11), so the photo shows; it is rendered on the next run.
4. **A broken or disguised image** (valid magic bytes, undecodable): `failed` after 3 attempts; the record shows its initial; the dialog of the next visit shows "The last image could not be processed" with "Choose another". The failed image stays current until replaced or removed, so its audit entry stays truthful.
5. **A brand logo version archived after the pick:** the client's logo is unaffected (it is its own stored crop).
6. **A client is archived** with projects that show its logo: they keep showing it (rule 5); a project's client never changes (F05), so the fallback never moves to another client.
7. **The account manager is changed** after a logo change: the notification already sent stays with the previous one; later changes notify the new one.
8. **A user loses `users.manage`** with the dialog open: the save answers 403 and the dialog says so.
9. **A General Manager's photo** can be changed by the General Manager themself or another General Manager, never by the Operations manager (F01 scope).
10. **SVG, PDF or AI logos** in the brand files: SVG has a rendered preview and can be picked; PDF and AI have no preview and are not listed (an image can be uploaded instead).
11. **Very large source images** (a 40 MP phone photo): the browser crops and downsizes before upload, so the 10 MB limit applies to the 1024 px result; a browser out of memory shows "This image cannot be opened".
12. **Storage full:** the upload is refused with `STORAGE_FULL` (F10) and the dialog says so.
13. **Archived subject's image** is still served while it is current (rule 5): history lists show archived people with their photo.
14. **The entrance screen offline** (F17): the greeting is shown by the phone, which already has the photo in its cache.
15. **A PDF re-rendered after the logo was removed** (a statement): the new render has no logo; earlier files keep theirs.

## Open questions
None. Every decision above was taken by the owner on 2026-10-25 or follows from the scope, F10, F16 and F17.

## Acceptance
- Owner, step by step in the browser (two browsers: A as General Manager, B as an employee):
  1. As B, open My account: the "Add your photo" card shows. Upload a portrait photo from the phone, move and zoom it in the round frame, save: the photo shows at once in the header and on My account. "Not now" on another browser hides the card there.
  2. As A, open the team list: B's photo shows in the row; filter "Without photo": B is gone from the list. Change B's photo from B's profile: B gets "Your profile was changed" naming A, in "For your information", no push.
  3. As A, edit B's title: B's notification for the day now names the photo and the title.
  4. As A, open a client with a logo in its brand files: the header shows the initial and "Choose logo". Pick the brand logo, zoom out until the whole logo fits, save: the logo shows on a white square in the header, in the clients list, on the client's projects and retainers without their own image, and in the task list's client column. The client's account manager gets "Client logo changed".
  5. Give a project its own image, then remove it: it returns to the client's logo.
  6. Render a new quote PDF and a statement for that client: the logo sits beside the client's name; the Vertex logo is unchanged. An older invoice PDF has no logo.
  7. As B, check in at the entrance screen: the greeting shows B's photo.
  8. Try uploading a 15 MB image: refused as too large; a GIF: refused as not allowed.
- Tests:
  - API (`apps/api/test/images.test.ts`): every route: success, 401, 403 (another user's photo without `users.manage`; the Operations manager on a General Manager; a client, project or retainer outside scope), 404 (unknown, archived and failed images on the serving route; records the actor cannot read). Upload once and only by the uploader, type, size and minimum side, `BRAND_FILE_NOT_FOUND` (another client's logo, a non-logo brand file), archived records, replacement archives the old row and keeps one current image under concurrent sets, remove as a no-op, the project and retainer fallback in references, `hasImage` filter, pending served with `no-store` and ready with `immutable`, the notifications (recipient, never the actor, merging) and audit entries.
  - Jobs: `files.preview` renders `sm` and `md` for a pending image, centre-crops a non-square one, keeps transparency, sets `failed` on a broken image after 3 attempts.
  - Worker: each client-facing PDF template with and without `clientLogoKey`, and with a missing file (renders, logs).
  - Unit (contracts): `setImageSchema`, `imagePath`, the shared `personSchema` and `clientRefSchema`; the greeting with `photo`.
  - Web unit: the crop maths (fill, fit with transparent padding, output size).
  - E2E with RTL screenshots (`apps/web/e2e/screens.spec.ts`): the image dialog (choose, crop a portrait, crop a logo zoomed out, brand files tab, an error), My account with the card, the team list with photos and the filter, the client page header with a logo and with "Choose logo", a project page showing the client's logo, a task list with photos, the entrance screen greeting with a photo.
