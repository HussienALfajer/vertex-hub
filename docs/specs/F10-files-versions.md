# F10 — Files and versions

Status: Approved · Date: 2026-09-30 · Scope: `docs/product/v1-scope.md` §F10 · ADRs: 0007, 0009, 0013, 0014, 0016, 0018, 0019

## Summary
Work files travel through WhatsApp and personal drives today: nobody knows which file is the latest, which one the client approved, or where a client's logo lives. F10 stores files in the system. Each task has **deliverables** (the work, each with its own version chain v1, v2, v3…, where a version is an uploaded file or an external link) and **references** (brief material anyone can add). When a task is approved, the latest version of each deliverable is marked **final** automatically, and reviewers can correct the marker; F09 will later approve exact versions. Clients get uploaded brand files next to the F02 brand links, and clients, projects and retainers get **documents**, which can be marked confidential. The client profile gains a **Files** tab: the library of final deliverables and the documents. Images, PDFs and videos preview in the app.

## In scope / out of scope
- In:
  - A `files` API module that owns every table below, stores content on local disk behind a storage interface, and has nginx serve content after the API authorizes each request (ADR 0009, ADR 0019).
  - Two-step upload: the file is uploaded first (up to 250 MB, owner decision), then attached as a new item or a new version.
  - Task deliverables with version chains; a version is an upload or an external link (owner decision). Task references: single uploads (no versions) that every active user may add (owner decision).
  - The final marker: one final version per deliverable, set automatically when the task becomes `approved`, set or cleared by hand by reviewers (owner decision).
  - Brand files: uploads in the client's brand kit, grouped by the F02 kinds (logo, font, guidelines, other), with versions (replacing a logo adds a version; owner decision).
  - Documents on a client, a project and a retainer, with versions and an optional **confidential** flag (owner decisions).
  - Previews: images (thumbnail and a large preview), PDFs (the browser's viewer), videos (the browser's player). Everything else downloads.
  - The client Files tab (library of final deliverables and all documents of the client); a Files section on the task page; uploaded files in the brand kit tab; a Documents tab on the project page and a Documents section on the retainer page.
  - Storage usage of a client and in total, shown to the General Manager and the Operations manager.
  - A new notification type `task_file_added` for the task's assignee (owner decision).
  - Deploy changes: the files directory, nginx upload size and internal file location, and the files in the daily backup.
- Out (later or never):
  - Client approval of versions through a secure link, the medical review, recording which version the client approved: F09. F09 adds the `client` source of the final marker.
  - Attaching files to content calendar posts: F08.
  - Deleting stored content: every version is kept in V1 (owner decision); a retention policy is decided later from the usage numbers.
  - Resumable or chunked uploads, uploads above 250 MB (use a link version), folders, tags, full-text search inside files.
  - Video thumbnails and transcoding, PDF page thumbnails, previews of design sources (PSD, AI, Figma), office documents or audio.
  - Pinpoint comments on images or videos, side-by-side version comparison (v1-scope: not in V1).
  - Moving F06 task links or F02 brand kit links into files: both stay as they are, next to the uploads.
  - Antivirus scanning of uploads.

## Roles and access

### Permission map
No new permission and no change to `packages/contracts/src/permissions.ts`. A file is read and changed under the permissions of what it belongs to (its **owner**: a task, a client, a project or a retainer). The owning modules decide through the owner policy they register with `files` (ADR 0019).

### Who reads
- Task files: `tasks.read` (every active user).
- Brand files and non-confidential client documents: `clients.read` (every active user).
- Non-confidential project and retainer documents: `projects.read` (every active user).
- **Confidential documents** (owner decision): only the **confidential readers** of the document's client: holders of `clients.manage` covering the client (General Manager, Operations manager, the client's primary account manager) and holders of `invoices.read` covering it (Finance). Everyone else does not see that they exist: they are left out of lists, and their routes answer 404.
- Files of an archived task, client, project or retainer follow that record: hidden and read-only, visible to the scope-all holders who can see the archived record.

### F10 actions
"Manage scope" and "client scope" are F06's terms for `tasks.manage`; "task workers" are the holders of `tasks.work` on the task (the assignee, the managers of its department).

| Action | Permission | Roles and scope |
|---|---|---|
| Upload a file (step 1; not attached to anything yet) | session | every active user |
| See and download files, previews, version history | as "Who reads" | as "Who reads" |
| Add a deliverable, add a version to it, rename it | `tasks.work` or `tasks.manage` | task workers · manage scope (department manager, account manager of the client, project manager, General Manager, Operations manager) |
| Remove a deliverable, or one of its non-final versions | `tasks.work` or `tasks.manage` | the version's uploader · manage scope |
| Add a reference | `tasks.read` | every active user (owner decision) |
| Remove a reference | `tasks.read` | its uploader · manage scope |
| Set or clear the final marker by hand | `tasks.manage` | manage scope |
| Add, version, rename, remove brand files | `clients.manage` | General Manager, Operations manager: all · Account Manager: own_clients |
| Add, version, rename, remove client documents | `clients.manage` | as above |
| Add, version, rename, remove project documents | `projects.manage` | General Manager, Operations manager: all · Account Manager: own_clients · the project manager (assigned) |
| Add, version, rename, remove retainer documents | `projects.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Mark a document confidential or not | the document's manage right above, and a confidential reader of its client | General Manager, Operations manager, the client's account manager (a project manager alone cannot) |
| Restore a removed item or version; see removed ones | scope `all` of the owner's manage permission | General Manager, Operations manager |
| See storage usage | `clients.manage` scope all | General Manager, Operations manager |

"Operations manager" means the manager of Internal Operations, as in F01, F02, F05 and F06.

## Data

Module ownership: a new `files` module owns `file_items`, `file_versions` and `file_uploads`. It reads users through `auth`'s `UserDirectory` and emits notifications through `notifications`' `NotificationCenter`. It never imports `tasks`, `clients` or `projects`: those modules import `files` and register an **owner policy** for their owner type in `files`' `FileOwnerRegistry` (the pattern of `ResponsibilityRegistry` and `WorkProgress`). A policy answers, for an owner id and a user: whether the owner exists and is visible, its client id, whether it is archived or closed, the user's rights (read, add deliverable, add reference, manage final, manage documents, confidential reader, scope all), and a display label (task title, project or retainer name) for the library and the audit screen. `tasks` also calls `files`' exported `FileVersions` service inside its own transactions: to mark finals when a task becomes `approved` (rule 9) and to update the client of its files when the task's client changes (rule 4).

Content lives under `FILES_ROOT` (production: `/srv/hub.vertexmedia.pro/shared/files/`, outside the releases; development: `./.data/files`, git-ignored). A stored object's key is `objects/<yyyy>/<mm>/<uuid>`; previews sit next to it as `<key>.preview.webp` and `<key>.thumb.webp`. Original file names never reach the disk.

### `file_items` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `owner_type` | enum `file_owner_type` (`task`, `client`, `project`, `retainer`) | required |
| `task_id` / `project_id` / `retainer_id` | uuid → `tasks.id` / `projects.id` / `retainers.id` | set to match `owner_type`, the others null (check constraint); each indexed |
| `client_id` | uuid → `clients.id` | the owner's client: required unless `owner_type` is `task` (a task without a client has none); for `client` it is the owner; indexed |
| `role` | enum `file_role` (`deliverable`, `reference`, `brand`, `document`) | required; `deliverable` and `reference` only on tasks, `brand` only on clients, `document` only on clients, projects and retainers (check constraint) |
| `name` | text | required, trimmed, 1–120 chars; defaults to the first version's file name without its extension (or the link's label or host). Unique case-insensitively among non-archived items of the same owner and role, except references |
| `brand_kind` | enum `brand_file_kind` (`logo`, `font`, `guidelines`, `other`) | required for `brand`, null otherwise (check constraint); the same kinds as the F02 brand links |
| `confidential` | boolean | required, default false; true only for `document` (check constraint) |
| `created_by_id` | uuid → `users.id` | required, indexed |
| timestamps, `archived_at` | | archived = removed: hidden from lists, kept on disk, restorable by scope all |

Index on `(client_id, role)` for the library. Limits among non-archived items: 30 deliverables and 30 references per task, 30 brand files per client, 100 documents per owner (`LIMIT_REACHED`).

### `file_versions` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `file_item_id` | uuid → `file_items.id` | required, indexed |
| `number` | integer | required, ≥ 1; unique per item `(file_item_id, number)`; the next number is the highest ever used on the item + 1, removed versions included, so a number is never reused |
| `kind` | enum `file_version_kind` (`upload`, `link`) | required; references are always `upload` |
| `storage_key` | text | required for `upload`, null for `link` (check constraint) |
| `original_name` | text | `upload`: the uploaded file name, ≤ 255 chars, kept for display and download |
| `mime_type` | text | `upload`: detected from the content (magic bytes), falling back to the extension |
| `size_bytes` | bigint (`mode: 'number'`) | `upload`: > 0 and ≤ 262 144 000 (250 MB) |
| `sha256` | text | `upload`: hex digest of the content |
| `preview_status` | enum `file_preview_status` (`pending`, `ready`, `none`, `failed`) | `upload` of a previewable image: `pending` until the job runs; others `none` |
| `width` / `height` | integer | images, when known |
| `url` | text | required for `link`: http(s), ≤ 2048 chars |
| `link_label` | text | `link`: optional, ≤ 120 chars |
| `note` | text | optional, ≤ 500 chars ("what changed") |
| `uploaded_by_id` | uuid → `users.id` | required, indexed |
| `is_final` | boolean | required, default false; only on deliverables; at most one non-archived final version per item (partial unique index on `file_item_id` where `is_final` and `archived_at is null`) |
| `final_source` | enum `file_final_source` (`auto`, `manual`) | set with `is_final`; F09 adds `client` |
| `final_marked_by_id` | uuid → `users.id` | set with `is_final` when manual; null for `auto`; indexed |
| `final_marked_at` | timestamptz | set with `is_final` |
| timestamps, `archived_at` | | archived = removed; a final version cannot be removed |

At most 100 non-archived versions per item (`LIMIT_REACHED`). A version's content, kind and number never change after creation.

### `file_uploads` (not a business table: temporary, listed as an exception in `packages/db/src/conventions.test.ts`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `user_id` | uuid → `users.id` | required, indexed; only this user can attach it |
| `storage_key`, `original_name`, `mime_type`, `size_bytes`, `sha256`, `width`, `height` | | as in `file_versions` |
| `created_at` | timestamptz | required |

A row is deleted when its upload is attached (in the attaching transaction). Unattached uploads older than 24 hours are purged with their content by the `files.purge-uploads` job.

## States and rules

### Upload and attach
1. **Upload.** `POST /api/files/uploads` streams one file (multipart field `file`) straight to its final object key and computes its SHA-256 on the way; nothing is buffered in memory. Refused: empty (`FILE_EMPTY`), above 250 MB (`FILE_TOO_LARGE`, 413; nginx refuses the same limit first), a blocked type (`FILE_TYPE_BLOCKED`: executables and scripts by extension or detected type: `exe`, `msi`, `bat`, `cmd`, `com`, `scr`, `ps1`, `vbs`, `sh`, `jar`, `apk`, `dll`, `app`, `dmg`), or less than 5 GB free on the files disk after the write (`STORAGE_FULL`, 507). The response carries an `uploadId`.
2. **Attach.** Creating an item or a version takes `source: { uploadId }` or `source: { url, label? }`. An upload is attached once, only by the user who uploaded it (`UPLOAD_NOT_FOUND` otherwise, and after the purge). Link sources are allowed for deliverables, brand files and documents, and refused for references (`LINK_NOT_ALLOWED`: references are uploads; F06 task links stay for linked material).
3. **Numbering.** A new item starts at v1. A new version locks the item row (`select … for update`) and takes the next number (data table), so two people adding a version at once get v3 and v4, never two v3. References have exactly one version (`NOT_VERSIONED` on adding another).
4. **Client of task files.** A task's files carry the task's client. When F06 changes or removes the task's client, `tasks` calls `FileVersions` in the same transaction and every file item of the task follows; the library shows them under the new client (or nowhere, without a client).

### What can change when
5. **Task state.** Files can be added, versioned, renamed and removed while the task is open (`new` … `approved`, F06). A `delivered` or `cancelled` task is read-only for files (`TASK_CLOSED`): changing its work means reopening it first (owner decision), which F06 counts as a revision when the client caused it. The final marker can still be set or cleared on a `delivered` task (rule 10). An archived task refuses everything (`TASK_ARCHIVED`).
6. **Other owners.** Brand files and client documents follow F02: nothing is added to or changed on an archived client (`CLIENT_ARCHIVED`); `paused` and `ended` clients accept files. Project documents: any status, not archived (`PROJECT_ARCHIVED`). Retainer documents: any status, not archived (`RETAINER_ARCHIVED`). Documents after a project is completed (a handover, a signed acceptance) are expected.
7. **Removing.** Removing a version archives it; removing the last non-archived version of an item is refused (`LAST_VERSION`: remove the item instead). A final version cannot be removed (`VERSION_FINAL`: clear the marker first). Removing an item archives the item, and its versions stay as they are; a removed item with a final version leaves the library. Nothing is ever deleted from the disk in V1 (owner decision).
8. **Restore.** Scope-all holders see removed items and versions ("Show removed") and restore them. Restoring an item whose name is now taken is refused (`FILE_NAME_TAKEN`: rename the other first); restoring beyond a limit is refused (`LIMIT_REACHED`).

### Final marker
9. **Automatic** (owner decision). When a task becomes `approved` (F06: internal approval of a task that needs no client approval, or the client's approval recorded), in the same transaction, the latest non-archived version of every non-archived deliverable of the task becomes final (`final_source` `auto`), and a previous final version of that deliverable loses the marker. A deliverable whose latest version is already final is unchanged. A task without deliverables changes nothing.
10. **By hand.** Manage-scope users set the marker on any non-archived version of a deliverable when the task is `approved` or `delivered` (`TASK_NOT_APPROVED` otherwise), which moves it from the previous final version (`final_source` `manual`); they clear it on any open or delivered task. There is at most one final version per deliverable.
11. **Reopening.** A task sent back from `approved` or `delivered` to `revisions` keeps its final markers until it is approved again; rule 9 then moves them to the new latest versions.
12. **F09 hook (later).** F09 records the exact versions it sends and, on the client's approval, marks those versions final with source `client` instead of rule 9's "latest version".

### Library and confidentiality
13. **Library.** A client's library is the final versions of non-archived deliverables of non-archived, non-cancelled tasks whose client is that client, newest `final_marked_at` first. Filters: type (`image`, `video`, `pdf`, `link`, `other`), month of the final marker, and a search on the file name or task title.
14. **Documents list.** The client Files tab lists the non-archived documents of the client, of its non-archived projects and of its non-archived retainers, each with its owner label, newest first; confidential ones only for confidential readers.
15. **Confidential.** Only a confidential reader may set or clear the flag, on create or later (`NOT_CONFIDENTIAL_READER`, 403). A confidential document is invisible to everyone else: absent from lists and counts, 404 on its routes and its content. A project manager who is not a confidential reader cannot upload a confidential document.

### Content, previews and downloads
16. **Serving.** `GET /api/files/versions/:id/content` checks read access, then answers with `X-Accel-Redirect` to nginx's internal location for the object key, which serves the bytes with range support (video seeking). In development, where there is no nginx, the API streams the file itself through the same storage interface. Download names are `<client trade name> - <item name> - v<n>.<ext>` (RFC 5987 `filename*`), without the client for internal tasks.
17. **Inline or attachment.** Content is served inline only for safe preview types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`, `application/pdf`, `video/mp4`, `video/webm`, `video/quicktime`. Everything else, SVG and HTML included, is served as `application/octet-stream` with `Content-Disposition: attachment`. Every response carries `X-Content-Type-Options: nosniff`.
18. **Previews.** For JPEG, PNG, WebP, GIF (first frame), AVIF, TIFF and SVG uploads, a `files.preview` job renders with sharp a thumbnail (400 px on the long side) and a preview (1600 px), both WebP, then sets `ready` (or `failed`: the file still downloads, the UI shows an icon). SVGs are only ever shown as these rendered previews. PDFs open in the browser's PDF viewer; videos in the `<video>` player from the content route. Other types show a type icon and download.
19. **Storage usage.** For scope-all holders: bytes used by a client (all its uploads, removed ones included, since they stay on disk) and in total, with the free space of the files disk.

## API
Schemas live in `packages/contracts/src/files.ts`, reusing the shared list and error schemas. Every route uses the session guard (`RequireSession`); the service checks the owner's rights through the registered policy (the table above) and answers 404 for anything the caller cannot read, including confidential documents. Item responses carry `permissions` flags (`canAddVersion`, `canRename`, `canRemove`, `canSetFinal`, `canSetConfidential`, `canRestore`) computed for the caller, and each version its own `canRemove`.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/files/uploads` | session | multipart: `file` | `fileUploadSchema`: uploadId, name, sizeBytes, mimeType | `FILE_EMPTY`, `FILE_TOO_LARGE` (413), `FILE_TYPE_BLOCKED`, `STORAGE_FULL` (507) |
| `GET /api/files/items` | session + owner read | `fileItemListQuerySchema`: ownerType, ownerId, role (optional), includeArchived (scope all) | `fileItemListSchema`: items with all their versions (newest first), owner rights (`canAddDeliverable`, `canAddReference`, `canManageDocuments`) | 404 |
| `POST /api/files/items` | session + owner rights | `createFileItemSchema`: ownerType, ownerId, role, name (optional), brandKind (brand), confidential (document), note, source (`{ uploadId }` or `{ url, label? }`) | `fileItemSchema` | 403, 404, `UPLOAD_NOT_FOUND`, `LINK_NOT_ALLOWED`, `FILE_NAME_TAKEN`, `LIMIT_REACHED`, `TASK_CLOSED`, `TASK_ARCHIVED`, `CLIENT_ARCHIVED`, `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED`, `NOT_CONFIDENTIAL_READER` |
| `PATCH /api/files/items/:id` | session + owner rights | `updateFileItemSchema`: name, brandKind, confidential (all optional) | `fileItemSchema` | 403, 404, `FILE_NAME_TAKEN`, `TASK_CLOSED`, owner archived codes, `NOT_CONFIDENTIAL_READER` |
| `POST /api/files/items/:id/versions` | session + owner rights | `createFileVersionSchema`: note, source | `fileItemSchema` | 403, 404, `NOT_VERSIONED`, `UPLOAD_NOT_FOUND`, `LIMIT_REACHED`, `TASK_CLOSED`, owner archived codes |
| `POST /api/files/items/:id/archive` · `…/restore` | session + owner rights (restore: scope all) | — | 204 · `fileItemSchema` | 403, 404, `TASK_CLOSED`, `FILE_NAME_TAKEN`, `LIMIT_REACHED` |
| `POST /api/files/versions/:id/archive` · `…/restore` | session + owner rights (restore: scope all) | — | `fileItemSchema` | 403, 404, `VERSION_FINAL`, `LAST_VERSION`, `TASK_CLOSED`, `LIMIT_REACHED` |
| `POST /api/files/versions/:id/final` | session + `tasks.manage` on the task | `setFinalSchema`: `{ final: boolean }` | `fileItemSchema` | 403, 404, `NOT_DELIVERABLE`, `TASK_NOT_APPROVED`, `TASK_CLOSED` (cancelled), `TASK_ARCHIVED` |
| `GET /api/files/versions/:id/content` | session + owner read | `?download=1` forces attachment | the bytes (via `X-Accel-Redirect` in production) | 404 (also for link versions) |
| `GET /api/files/versions/:id/thumbnail` · `…/preview` | session + owner read | — | WebP image | 404 (not `ready`) |
| `GET /api/files/library` | session + `clients.read` | `fileLibraryQuerySchema`: clientId, type, month (`YYYY-MM`), q, page, pageSize | `fileLibraryPageSchema`: final version, item name, task (id, title), marked at and by | 404 |
| `GET /api/files/documents` | session + `clients.read` | `clientDocumentsQuerySchema`: clientId, page, pageSize | `fileItemPageSchema` with owner (type, id, label) | 404 |
| `GET /api/files/usage` | `clients.manage` (scope all) | `fileUsageQuerySchema`: clientId (optional) | `fileUsageSchema`: clientBytes, totalBytes, freeBytes | 403 |

New error codes: `FILE_EMPTY`, `FILE_TOO_LARGE`, `FILE_TYPE_BLOCKED`, `STORAGE_FULL`, `UPLOAD_NOT_FOUND`, `LINK_NOT_ALLOWED`, `NOT_VERSIONED`, `NOT_DELIVERABLE`, `FILE_NAME_TAKEN`, `VERSION_FINAL`, `LAST_VERSION`, `TASK_CLOSED`, `TASK_NOT_APPROVED`, `NOT_CONFIDENTIAL_READER` (`RETAINER_ARCHIVED` already exists).

### Changes to earlier features
- **F06** `tasks`: registers the `task` owner policy; calls `FileVersions.markLatestFinal(tx, taskId)` on every transition to `approved` (rule 9) and `FileVersions.moveTaskClient(tx, taskId, clientId)` when the task's client changes (rule 4). `taskDetailSchema` gains `fileCounts` (deliverables, references) for the task page header. The task list does not change.
- **F02** `clients`: registers the `client` owner policy (brand files, client documents, confidential readers). The brand kit's `files` links stay as they are.
- **F05** `projects`: registers the `project` and `retainer` owner policies.
- **F14** `notifications`: new type `task_file_added` (below).

## Screens
All screens are RTL with logical CSS, use `packages/ui` components, and put every string through i18next. File names and sizes are shown with Latin digits (`ar-u-nu-latn`); sizes as KB, MB, GB.

1. **Upload control** (shared component in `features/files/`) — a button and a drop zone that accept several files at once; each file shows name, size, a progress bar and a cancel button, and its error in place (too large, blocked type, storage full, network). A file is attached as soon as its upload finishes. For deliverables, brand files and documents a second tab, "Link", takes a URL and an optional label.
2. **Task page** `/tasks/$taskId` (F06) — new **Files** section after the brief, with two groups:
   - **Deliverables:** one card per deliverable: thumbnail or type icon of the latest version, name, version badge ("v3"), final badge ("Final" on the final version, with "v2 is final" when the final one is not the latest), note, uploader and date, size or the link's host. Actions: preview, download, "New version" (upload or link, with an optional note), rename, remove. "Versions" expands the history: every version with its number, note, uploader, date, final badge and source ("automatic on approval", "by <name>"), with preview, download, "Mark final" / "Clear final" (manage scope, rule 10) and remove. "Add deliverable" (task workers and manage scope, open tasks).
   - **References:** a grid of thumbnails or icons with name, uploader and date; preview, download, remove (uploader, manage scope). "Add references" for every user on an open task.
   - Delivered or cancelled tasks show the files without add, version or remove actions, and the hint "reopen the task to change its files". Empty: "No deliverables yet" / "No references yet". Loading: skeleton cards. Error: inline with retry.
3. **Preview dialog** — full-screen dialog with the file name, version and final badge: images show the rendered preview with "Open original"; PDFs open inline in the dialog; videos play with controls; links show the URL with "Open link" (new tab, `rel="noopener noreferrer"`); other types show the icon, type and size with "Download". Previous/next moves through the versions of the same item (deliverables) or through the group (references). Keyboard: Escape closes, arrows move (mirrored for RTL).
4. **Client profile** `/clients/$clientId` (F02) — new **Files** tab (kept in the URL like the other tabs):
   - **Final files:** grid of the library (rule 13) with thumbnail, name, version, task title (link), final date; filters type, month and search, in the URL; paged 50. Empty: "No final files yet: they appear here when tasks are approved".
   - **Documents:** list of the client's, its projects' and retainers' documents (rule 14) with owner label (link), latest version, lock icon for confidential ones, and actions per `permissions`; "Upload document" adds a client document (client managers). Empty: "No documents yet".
   - For scope-all users, a line "This client uses 1.2 GB · all files 18.4 GB · 150 GB free".
   The **Brand kit** tab gains "Uploaded files" grouped by kind next to the existing links, with upload (kind picker), new version, rename, remove for client managers.
5. **Project page** `/projects/$projectId` (F05) — new **Documents** tab: the project's documents with versions, confidential lock, upload for project managers and client-scope users. **Retainer page** `/retainers/$retainerId` — a **Documents** tab with the same list for client-scope users.
6. **Notification settings** — the new type appears under Tasks as mutable.

What roles see differently: everyone sees task files, brand files and non-confidential documents; actions follow the actions table; confidential documents appear only to confidential readers; usage and "Show removed" only to scope-all users.

## Audit, notifications and jobs
- **Audit** (entity `file_item`; `after` carries `ownerType`, `ownerId`, `clientId` and the item's `role`, so the audit screen links the entry to its owner and to the tab that shows it; link versions keep the host only, never the full URL, as in F06): `file_item.created` (role, name, v1), `file_item.renamed`, `file_item.confidential_changed`, `file_item.archived`, `file_item.restored`, `file_version.created` (number, kind, size, note), `file_version.archived`, `file_version.restored`, `file_version.final_set` (number, source, the previous final number), `file_version.final_cleared`. Automatic finals (rule 9) are written in the task's approval transaction with the approving actor. Uploads that are never attached are not audited.
- **Notifications** (F14): new type `task_file_added`, category tasks, mutable (owner decision): someone other than the assignee adds a deliverable, a version or a reference to a task that has an assignee → the assignee. It merges like `task_commented`: an unread `task_file_added` on the same task gets `count + 1` and the latest actor and file name. Order: after `task_commented`. Nobody else is notified: reviewers learn of new work from the status change to `internal_review`.
- **Jobs** (`packages/contracts/src/jobs.ts`, scheduled by `apps/worker`, worked by the API like `notifications.daily`, ADR 0008 and 0018):
  - `files.preview`: queued in the attaching transaction for previewable images; renders the thumbnail and preview (rule 18); retried 3 times, then `failed`.
  - `files.purge-uploads`: daily at 03:00 Asia/Damascus; deletes unattached uploads older than 24 hours and their content.
- **Deploy** (`deploy/`, shipped with the next production deploy; server changes need the owner's approval then):
  - `FILES_ROOT` in the environment and `.env.example`; `shared/files/` created by `provision.sh`, owned by the site user, not web-readable except through the internal location.
  - nginx: `client_max_body_size 250m` on `/api/files/uploads` only (the site default stays); an `internal` location that serves `FILES_ROOT` for `X-Accel-Redirect` with its own header set (`nosniff`, HSTS, `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` so the PDF preview can be framed), and the upload route's timeouts sized for slow links.
  - `vertexhub-backup`: copies `shared/files/` into each daily backup as a hard-linked snapshot (`rsync --link-dest` of the previous backup), so unchanged files take no extra space. Off-server copies still wait on Q4.

## Edge cases
1. **Two people add a version at the same time:** they get consecutive numbers (rule 3); both are audited; the later one is the latest.
2. **A version is added while the task is `awaiting_client`:** allowed; the client decision recorded later marks the latest version final (rule 9). F09 will pin the version it sent.
3. **The upload finishes but attaching fails** (name taken, the task was delivered meanwhile, permission changed): the upload stays for 24 hours; the UI keeps the file in the queue with the error and lets the user retry with another name or discard it.
4. **The same content uploaded twice:** stored twice; `sha256` is kept but not used for deduplication in V1.
5. **Task deleted from under the files:** tasks are archived, never deleted; their files follow rule 5.
6. **Task moved to another client or its client removed:** its files follow (rule 4); the old client's library no longer shows them.
7. **Client archived:** its brand files, documents, and the library tab are hidden with the client (F02, F05 G2); task files stay visible on their tasks, which follow F06.
8. **Confidential reader loses access** (account manager changed): the next request answers 404 for the confidential documents; a cached download link in the browser has expired with it (content responses are `Cache-Control: private, no-store` for confidential documents).
9. **A removed final version:** impossible (rule 7). A removed deliverable with a final version leaves the library; restoring it brings it back.
10. **A link version whose target is gone or private:** the system does not check links; the preview shows the host and "Open link".
11. **Upload of a large video on a slow line:** no resume in V1; a failed upload is retried from the start. The owner's rule: raw and long footage goes in as a link version.
12. **HEIC photos and design sources (PSD, AI):** stored and downloaded; no preview (icon).
13. **Disk nearly full:** uploads stop at 5 GB free (`STORAGE_FULL`); the usage line shows the free space.
14. **Permissions change mid-session:** each request is checked again; the page refreshes its `permissions` flags on the next load.
15. **A file named with only an extension or unusual characters:** the default item name falls back to "File"; download names replace characters that are unsafe in file names.
16. **Library of a client with many files:** paged by 50; thumbnails are 400 px WebP served with `Cache-Control: private, max-age=86400` (a version's content never changes).

## Implementation notes
Details settled while building PR 1 (API), within the rules above:
- **Previews (rule 18).** The `pending` status is the queue: attaching sets it in the attaching transaction, and the `files.preview` job is sent after commit as a nudge. Each run renders up to 20 pending images, trying each up to 3 times before `failed`, and sends itself again while some are left; the daily `files.purge-uploads` run nudges it too, so a preview queued just before a restart is not lost.
- **Large images.** Images above 50 MB (`FILE_PREVIEW_MAX_BYTES`) are not rendered: `preview_status` `none`, the type icon, and they still preview in the browser when their type is served inline. Rendering reads the image into memory, which stays bounded on the shared server. An upload's width and height come from the first 512 KB kept while streaming (null when the header is not there); the preview job sets them from the full image.
- **Status codes.** `UPLOAD_NOT_FOUND`, `LINK_NOT_ALLOWED`, `NOT_DELIVERABLE`, `FILE_EMPTY` and `FILE_TYPE_BLOCKED` answer 400; `NOT_CONFIDENTIAL_READER` 403; `FILE_TOO_LARGE` 413; `STORAGE_FULL` 507; the others 409.
- **Removed items.** A removed (archived) item accepts only restore; any other change answers 404. Removing a whole deliverable is for manage scope or its creator while they are a task worker; removing a version, for manage scope or its uploader while they are a task worker.
- **Serving.** `FILES_X_ACCEL` (default on in production) switches content to `X-Accel-Redirect` to nginx's internal `/_files/` location; development streams with single-range support. The API refuses to start in production without an absolute `FILES_ROOT`.
- **Removed documents on the client Files tab.** The documents list (rule 14) holds live documents only; "Show removed" there adds the client's own removed documents and the removed versions of its live ones. Removed project and retainer documents and versions are restored from their project or retainer page.
- **Deploy.** `shared/` becomes 710 `vertexhub:www-data` so nginx can pass through it to `shared/files/` (2750, setgid); `.env` stays 600.

## Open questions
- None block F10. The owner decided every question of the interview on 2026-09-30.
- Q4 (off-server backups) becomes more pressing: files are backed up only on the same server until it is answered.
- A retention policy for old non-final versions is deferred until usage numbers exist (owner decision); the usage line is there to decide it.

## Acceptance
- Owner check in the browser (a designer D, the Design department manager M, the client's account manager A, and the Operations manager O):
  1. As A, open a task for D and add two references (an image and a PDF); D gets one "files added" notification with the count 2. Open each in the preview dialog.
  2. As D, add a deliverable "Launch poster" (an image) and a deliverable "Launch video" as a Drive link; the image shows its thumbnail after a moment. Add v2 of the poster with a note. Try uploading an `.exe` → blocked; a 300 MB file → too large.
  3. As D, send the task to internal review; as M, approve it without client approval (or send to the client, then as A record the approval) → poster v2 and the video link v1 show "Final (automatic)".
  4. As M, mark poster v1 final by hand → v1 is final, v2 is not; mark v2 again.
  5. As D, try to remove v2 → refused while final. Deliver the task → the Files section is read-only.
  6. As A, open the client's Files tab: the poster v2 and the video link are in the library; filter by type image. Upload a contract as a client document and mark it confidential; as D, the contract is not listed and its link answers "not found"; as O, it is.
  7. As A, upload the client's logo in the brand kit; upload a new logo → v2; both versions are in the history.
  8. As the project manager of one of the client's projects, add a project document; try to mark it confidential → not allowed.
  9. As O, see the usage line; remove and restore a document; open the audit log and follow a file entry to its task.
- Tests:
  - API (`apps/api/test/files.test.ts`): every route: success, 401, 403 without the owner right, 404 outside read access (a confidential document for a non-reader, an archived owner for a non-scope-all user). Upload limits (empty, too large, blocked type by extension and by content), attach once and only by the uploader, numbering under concurrent version creation, name uniqueness, limits, removal rules (`LAST_VERSION`, `VERSION_FINAL`), closed and archived owners, restore.
  - Final marker (integration with `tasks`): internal approval and recorded client approval mark the latest versions in the same transaction; a rollback leaves no marker; manual set moves the marker; one final per deliverable enforced by the database; reopening keeps the markers.
  - Client move: changing a task's client moves its files in the library.
  - Content route: `X-Accel-Redirect` in production mode with the right headers; streamed bytes in development; inline only for the safe types; SVG and HTML as attachment; download names.
  - Jobs: `files.preview` renders thumbnails and sets `ready`, sets `failed` on a broken image; `files.purge-uploads` removes only unattached uploads older than 24 hours and their content.
  - Notifications: `task_file_added` reaches the assignee only, not when the assignee is the actor, and merges.
  - Unit (contracts): schemas (sources, name rules, confidential only on documents, brand kind only on brand files), type classification for the library filter, safe inline types, blocked types.
  - Architecture test: `files` does not import `tasks`, `clients` or `projects`.
  - E2E with RTL screenshots (`apps/web/e2e/screens.spec.ts`): task Files section (deliverables with history expanded, references), preview dialog (image and PDF), client Files tab (library and documents), brand kit uploaded files, project Documents tab, the upload control with a progress bar and an error.
