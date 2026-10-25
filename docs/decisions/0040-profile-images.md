# 0040 — Profile images: one current image per record, cropped in the browser, served by immutable id

Status: Accepted · Date: 2026-10-25

## Context
F01C (`docs/specs/F01C-profile-photos-logos.md`) gives users, clients, projects and retainers an image that replaces their initial everywhere they appear, on the entrance screen and on client-facing PDFs. The owner decided (2026-10-25): a square crop on upload that can also fit a whole logo, small and medium thumbnails, images served only to signed-in users, a client logo picked from the brand files only by hand, and a project or retainer falling back to its client's logo. Images appear in nearly every list, so reading them must not add a cross-module query to each of them. F10 files (ADR 0019) are versioned work files with owner policies, limits and a library: a profile image is none of these.

## Decision
- **Its own table, in `files`.** An `images` row belongs to exactly one user, client, project or retainer; at most one is current per record (partial unique index), and replacing or removing an image archives it. `files` owns storage, so it owns the table, writes the bytes through `FileStorage` and renders the renditions; images are not `file_items`.
- **A column on each record.** `users`, `clients`, `projects` and `retainers` carry `image_id`, set by their own module in its own transaction through `ImagesService`. Every reference the API already builds from its own table therefore carries `imageId` without reading `images`; projects and retainers resolve their client's logo through the existing client directory.
- **Cropped in the browser, rendered in the background.** The browser decodes, crops and downsizes to a square of at most 1024 px (so HEIC and huge photos work wherever the browser opens them) and uploads it through the F10 upload route. The `files.preview` job renders 128 px and 320 px WebP renditions with sharp; until then the uploaded square itself is served, so a new image shows at once.
- **Served by an immutable id.** `GET /api/images/:id/:size` needs only a session. An image never changes, so ready renditions are cached as `immutable` and a change is a new id; archived and failed images answer 404 and the UI falls back to the initial.
- **Outside the session** images travel as data: the entrance screen greeting and the PDF payloads carry the rendition itself, never a public link. Emails and push notifications carry no images.

## Consequences
- Every contract reference rendered with an avatar gains `imageId`; the person and client references duplicated across contract files become one shared schema each.
- Replaced images stay on disk, like F10 versions; they are small (a 1024 px square and two renditions) and are covered by the files backup.
- A new kind of record with an image adds an enum value, a column on its table and a check-constraint branch.
- The Better Auth `users.image` column stays unused.
