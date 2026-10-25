# TASKS — F01C Profile photos and logos

Spec: `docs/specs/F01C-profile-photos-logos.md` (Approved 2026-10-25) · ADR 0040 (and 0013, 0014, 0018, 0019, 0028, 0036, 0037, 0039).
Three PRs, each accepted by the owner before the next starts. One session per PR.

## PR A1 — images core: contracts, db, api
- [x] contracts: `images.ts` (`IMAGE_SUBJECT_TYPES`, `IMAGE_SIZES`, `IMAGE_MAX_BYTES`, `IMAGE_MIN_SIDE`, `IMAGE_UPLOAD_SIDE`, accepted types, `setImageSchema`, `imageSchema`, `imagePath`); error codes `IMAGE_TYPE_NOT_ALLOWED`, `IMAGE_TOO_LARGE`, `IMAGE_TOO_SMALL`, `BRAND_FILE_NOT_FOUND` (and any missing `*_ARCHIVED`); audit actions `<user|client|project|retainer>.image_set` / `.image_removed`; notification types `profile_changed`, `client_logo_changed`, `project_image_changed`, `retainer_image_changed` (texts in `messages`); `userListQuerySchema.hasImage`, user list items and the session user gain `imageId`; unit tests; `ar.json` keys
- [x] db (`/db-migration`): `images` (enums, checks, partial unique indexes, pending index); `image_id` on `users`, `clients`, `projects`, `retainers`; `TABLE_OWNERS`
- [x] api: `files` `ImagesService` (set, remove, brand version check) and `GET /api/images/:id/:size` (pending `no-store`, ready `immutable`, 404 otherwise, `X-Accel-Redirect`); `files.preview` renders pending images (rule 10); `PUT`/`DELETE …/:id/image` on users, clients, projects, retainers with scopes, archived refusals, audit, notifications (rule 18); `profile_changed` on profile edits by another person (rule 19); `hasImage` filter; `test/images.test.ts`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`, owner 2026-10-25), PR with auto-merge

## PR A2 — references, greeting and PDFs: contracts, api, worker
- [ ] contracts: one shared `personSchema` and `clientRefSchema` with `imageId` replacing the duplicated ones; project and retainer references with the effective image (rule 3); the `image` string fields become `imageId`; `attendanceGreetingSchema.photo`; `clientLogoKey` on client-facing PDF payloads
- [ ] api: every reference builder fills `imageId` (projects and retainers fall back to the client's logo through the client directory); greeting photo as a data URL (rule 15); PDF payloads carry `clientLogoKey` (rule 14); tests
- [ ] worker: client block logo tile in each client-facing template, missing file logged; tests with and without the key
- [ ] bridge; `e2e/fixtures.ts` adapted to the new shapes
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR A3 — web and E2E
- [ ] `Avatar` takes `src` (white surface, initial while loading and on error); `imageSrc(imageId, size)` helper; `features/images/` dialog (choose, brand files tab, crop with fill/fit zoom, preview sizes, upload progress, errors) with crop-maths unit tests
- [ ] My account (photo, "Add your photo" card), team profile and list ("Without photo" filter), client, project and retainer headers; `imageId` passed to every avatar (spec Screens 6); entrance screen photo; offline cache-first for image routes
- [ ] audit screen: `imageId` and `brandVersionId` as reference fields (not shown as raw ids), `source` labelled for images
- [ ] E2E: `f01c.spec.ts`, screenshots in both themes; mocks in `fixtures.ts`
- [ ] checks, reviewer, acceptance (spec steps 1–8), PR with auto-merge, `docs/ROADMAP.md`
