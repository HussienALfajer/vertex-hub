# 0019 — Files: versioned items on local disk, attached through owner policies, served by nginx

Status: Accepted · Date: 2026-09-30

## Context
F10 (`docs/specs/F10-files-versions.md`) stores work files, brand files and documents in the system. F09 will approve exact file versions and F08 will attach files to posts, so the shape chosen now carries Phase 2. ADR 0009 already puts uploads on the VPS's local disk behind a storage interface, with nginx serving files after the API authorizes them. The owner decided: a version chain per file; deliverables and references kept apart on tasks; a version may be an upload or an external link; uploads up to 250 MB; the final marker set automatically when a task is approved and correctable by reviewers; every version kept on disk in V1; documents on clients, projects and retainers with an optional confidential flag.

## Decision
- **Items and versions.** A `file_items` row is a named file of one owner (task, client, project, retainer) with a role (`deliverable`, `reference`, `brand`, `document`); `file_versions` holds its immutable versions, numbered per item and never reused. A version is an `upload` (stored object) or a `link` (URL). Only deliverables carry the final marker; at most one final version per item is enforced by a partial unique index. Later features refer to a version by its id.
- **Two-step upload.** The client first uploads the bytes to `POST /api/files/uploads`, which streams them to their final object key and records a temporary `file_uploads` row; creating an item or a version then attaches it by id in a normal JSON request, validated by the contract schemas. Attaching deletes the temporary row in the same transaction, so there is no file move and no orphan on rollback; a daily job purges uploads left unattached for 24 hours.
- **Owner policies instead of imports.** The `files` module never imports the owning modules. `tasks`, `clients` and `projects` register an owner policy in `files`' `FileOwnerRegistry` that answers visibility, rights, client, closed state and a display label for their owner type; `tasks` calls `files` inside its own transactions for the automatic final marker and for client changes. New owner types (F08 posts) register a policy and add an enum value.
- **Storage.** Objects live under `FILES_ROOT` at `objects/<yyyy>/<mm>/<uuid>`, outside the releases, with generated WebP previews beside them; original names are kept in the database only. A `FileStorage` interface has one local-disk adapter; object storage later means a new adapter.
- **Serving.** The API checks access and answers with `X-Accel-Redirect` to an `internal` nginx location, which serves the bytes with range requests; in development the API streams through the same interface. Only a fixed list of safe types (raster images, PDF, MP4/WebM/QuickTime video) is served inline; everything else, SVG and HTML included, is an `application/octet-stream` attachment with `nosniff`.
- **Previews** for raster images and SVG are rendered with sharp by a `files.preview` job (scheduled by the worker, worked by the API, as ADR 0018). No video or PDF thumbnails in V1.
- **Access** follows the owner's existing permissions; no new permission. Confidential documents are visible only to the client's confidential readers (`clients.manage` or `invoices.read` covering the client) and are indistinguishable from missing for everyone else.
- **Backups** copy the files directory into each daily backup as hard-linked snapshots.

## Consequences
- Disk use grows with every version, since nothing is deleted in V1; the usage figure shown to the General Manager and the Operations manager is the input for a later retention decision, and Q4 (off-server backups) matters more.
- The production nginx site gains the internal files location and a 250 MB body limit on the upload route; `provision.sh` creates the files directory.
- `file_uploads` is listed as an exception to the business-table conventions.
- The architecture test forbids `files` from importing `tasks`, `clients` and `projects`.
