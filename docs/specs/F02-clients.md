# F02 — Clients (unified client profile)

Status: Approved · Date: 2026-09-28 · Scope: `docs/product/v1-scope.md` §F02 · ADRs: 0007, 0013, 0014

## Summary
Client information is spread across WhatsApp threads and people's memories: who the account manager is, who at the client may approve work, which colors and words the brand uses, who holds the page admin rights, and what was agreed on the last call. F02 gives every client one profile that the whole team can read: basics with the primary account manager and status, contacts with final-approval authority, the brand kit, platform accounts, a healthcare flag that later switches on the medical review, and a hand-written communication log. Projects, retainers, tasks and invoices attach to this profile in their own features.

## In scope / out of scope
- In:
  - Client basics: trade name, sector (free text with suggestions), primary account manager, status (active / paused / ended), healthcare flag.
  - Create, edit, archive (for records entered by mistake) and restore.
  - Contacts: several per client, any number flagged with final-approval authority.
  - Brand kit: colors, font names, tone of voice, forbidden words, links to logo, font and guideline files, liked and disliked references.
  - Platform accounts: platform, link, the agency's access state, and a note on who holds admin access. No passwords.
  - Communication log: notes written by any staff member (date, channel, contact, summary).
  - Client list and client profile screens.
  - Account-manager responsibilities in F01's archive check and on removing the Account Manager role.
- Out (later or never):
  - Uploading brand files into the system: F10. Until then brand files are external links (Drive, Dropbox); F10 adds uploads to the same brand kit.
  - Profile tabs for projects, retainer, open tasks, invoices and balance: added by F05, F06 and F13 to the profile built here.
  - Approvals and client requests in the communication log: added by F09 and F06.
  - Billing details (legal name, billing address, default currency): F13 adds them in its spec.
  - Converting a lead into a client: F03.
  - Notifying the new account manager when a client is assigned: F14.
  - Storing client passwords: never in V1 (v1-scope).

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `clients.read` becomes `all` for Employee, so every active user sees every client, including contacts, brand kit, platform accounts and the communication log (owner decision). Financial data stays behind its own permissions (`invoices.read` and others) when F13 adds it to the profile. The now redundant `clients.read` grants of Department Manager (`department`), Account Manager (`own_clients`) and Finance (`all`) are removed.
- `clients.manage` stays `own_clients` for Account Manager (clients they are primary account manager of) and `all` for General Manager. New department capability: the Internal Operations **manager** gets `clients.manage` (`all`).
- New permission `clients.log` (write in the communication log), held by Employee with scope `all`, so every active user.
- Actions marked **scope all** below need `clients.manage` with scope `all`: `own_clients` is not enough. The service checks the scope; the guard checks the permission.

"Operations manager" means the manager of Internal Operations, as in F01.

### F02 actions
| Action | Permission | Roles and scope |
|---|---|---|
| List clients, open a profile (contacts, brand kit, platform accounts, log) | `clients.read` | Every active user: all |
| Create a client | `clients.manage` (scope all) | General Manager · Operations manager |
| Change the primary account manager | `clients.manage` (scope all) | General Manager · Operations manager |
| Turn the healthcare flag on or off | `clients.manage` (scope all) | General Manager · Operations manager |
| Archive and restore a client; see archived clients | `clients.manage` (scope all) | General Manager · Operations manager |
| Edit trade name, sector, status | `clients.manage` | General Manager, Operations manager: all · Account Manager: own_clients |
| Edit contacts, brand kit, platform accounts | `clients.manage` | General Manager, Operations manager: all · Account Manager: own_clients |
| Add a note to the communication log | `clients.log` | Every active user: all |
| Edit a note | `clients.log` | The note's author only |
| Archive a note | `clients.log` | The note's author · anyone with `clients.manage` scope all |

## Data

Module ownership: the `clients` module owns `clients`, `client_contacts`, `client_platform_accounts` and `client_notes`. It reads users (names, roles, status) only through the `auth` module's exported service.

### `clients` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `trade_name` | text | required, trimmed, runs of inner spaces collapsed to one (migration 0053), 1–120 chars; unique case-insensitively among non-archived clients (unique index on `lower(trade_name)` where `archived_at is null`) |
| `sector` | text | optional, trimmed, 1–60 chars; indexed for the filter; suggestions come from the distinct values in use |
| `account_manager_id` | uuid → `users.id` | required, indexed; the primary account manager |
| `status` | enum `client_status` (`active`, `paused`, `ended`) | required, default `active`, indexed |
| `is_healthcare` | boolean | required, default false |
| `brand_kit` | jsonb | required, default the empty kit; shape `brandKitSchema` (below), validated on write |
| timestamps, `archived_at` | | archived = entered by mistake: hidden from lists and pickers, read-only, visible to scope-all holders only |

`brandKitSchema` (in `packages/contracts/src/clients.ts`); the kit is read and replaced as a whole:
| Field | Type | Rules |
|---|---|---|
| `colors` | `{ name?: string; hex: string }[]` | ≤ 20; `hex` is `#RRGGBB`, stored upper-case, a repeated `hex` kept once; `name` 1–40 chars |
| `fonts` | string[] | ≤ 10; each 1–60 chars, trimmed, unique case-insensitively |
| `toneOfVoice` | string | optional, ≤ 2000 chars |
| `forbiddenWords` | string[] | ≤ 100; each 1–60 chars, trimmed, unique case-insensitively |
| `files` | `{ kind: 'logo' \| 'font' \| 'guidelines' \| 'other'; label: string; url: string }[]` | ≤ 30; `label` 1–80 chars; `url` http(s), ≤ 2048 chars, a repeated `url` kept once |
| `references` | `{ kind: 'liked' \| 'disliked'; url: string; note?: string }[]` | ≤ 50; `url` http(s), ≤ 2048 chars, a repeated `url` kept once; `note` ≤ 300 chars |

Brand files are links in V1; F10 adds uploaded files to the kit.

### `client_contacts` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `name` | text | required, trimmed, 1–100 chars |
| `job_title` | text | optional, ≤ 80 chars |
| `phone` | text | optional; normalized like user phones in F01 (`+` and 8–15 digits) |
| `email` | text | optional, valid email, stored lower-case |
| `has_final_approval` | boolean | required, default false |
| `notes` | text | optional, ≤ 500 chars |
| timestamps, `archived_at` | | archived = removed from the client; hidden, kept for the log and (later) approvals that reference it |

At most 50 non-archived contacts per client.

### `client_platform_accounts` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `platform` | enum `client_platform` (`instagram`, `facebook`, `tiktok`, `x`, `linkedin`, `youtube`, `snapchat`, `google_business`, `website`, `other`) | required |
| `label` | text | optional, 1–60 chars; required when `platform` is `other` |
| `url` | text | required, http(s), ≤ 2048 chars |
| `agency_access` | enum `platform_access` (`granted`, `pending`, `none`) | required, default `none`. `granted`: the agency has admin or editor access through its business account; `pending`: requested, not yet granted |
| `admin_note` | text | optional, ≤ 300 chars: who holds admin access on the client's side |
| timestamps, `archived_at` | | archived = removed from the client |

Several accounts per platform are allowed (two Instagram pages). At most 50 non-archived accounts per client.

### `client_notes` (business table; the communication log)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `author_id` | uuid → `users.id` | required, indexed; set from the session |
| `occurred_at` | timestamptz | required, default now; not in the future (5 minutes of clock skew allowed); indexed with `client_id` |
| `channel` | enum `note_channel` (`call`, `meeting`, `whatsapp`, `email`, `other`) | required |
| `contact_id` | uuid → `client_contacts.id` | optional; a contact of the same client |
| `summary` | text | required, trimmed, 1–2000 chars |
| timestamps, `archived_at` | | archived = withdrawn: hidden from the log |

## States and rules

### Client status
```
active ⇄ paused ⇄ ended ⇄ active     (any change, by anyone with clients.manage on the client)
(any status) ──(archive, scope all)──→ archived ──(restore, scope all)──→ same status as before
```
Status is the business state. Archiving is separate and only for records entered by mistake; `archived_at` does not change the status.

### Rules
1. Every client has exactly one primary account manager.
2. When a client is created, or its account manager is changed, the account manager must be a non-archived user who holds the Account Manager role (`INVALID_ACCOUNT_MANAGER`). An `invited` user qualifies.
3. Moving a client from `ended` to `active` or `paused`, or restoring a client that is `active` or `paused`, also requires a valid account manager (rule 2) (`INVALID_ACCOUNT_MANAGER`). Other edits of an ended client whose account manager has since been archived or lost the role are allowed.
4. An Account Manager's `own_clients` scope covers the non-archived clients whose `account_manager_id` is them. A change of account manager applies to the old and new manager on their next request.
5. Only scope-all holders create clients, change the account manager, change the healthcare flag, archive and restore (403 for everyone else, including the client's own account manager).
6. Trade names are unique case-insensitively among non-archived clients (`CLIENT_NAME_TAKEN`), checked on create, rename and restore. Spaces inside a name count once: "Cafe   One" is stored as "Cafe One", and searches collapse them the same way.
7. An archived client cannot be edited, and nothing can be added to it (contacts, platform accounts, notes, brand kit) (`CLIENT_ARCHIVED`). Restoring is the only change.
8. A user who is primary account manager of an `active` or `paused` non-archived client cannot be archived or lose the Account Manager role until each such client gets another account manager (`USER_HAS_RESPONSIBILITIES`, listing the clients). This extends F01 rule 9 ("an active client" there means `active` or `paused`). Ended clients do not block.
9. Any number of contacts may have final-approval authority, including none. A non-archived client without such a contact shows a warning on its profile and in the list. F09 refuses to send an approval link for a client without one.
10. A note's `contact_id`, when set, must be a non-archived contact of the same client at the time it is set (`UNKNOWN_CONTACT`). Archiving the contact later keeps the reference.
11. Only the author edits a note (`NOT_NOTE_AUTHOR`). The author, or a scope-all holder, archives it. Archived notes cannot be edited.
12. A contact or platform account belongs to its client for life; it is never moved to another client.
13. Every change in this feature writes an audit entry in the same transaction (see below).
14. Changing a client's account manager and archiving a user or removing their Account Manager role are serialized with F01's access-change lock, so rule 8 holds under concurrent requests.

## API

Request and response schemas live in `packages/contracts/src/clients.ts`, reusing the shared list and error schemas. Lists take `page` and `pageSize` and return `{ items, total, page, pageSize }`. `:id` is a client id; a client outside the caller's read access (archived, for callers without scope all) is a 404.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/clients` | `clients.read` | `clientListQuerySchema`: `search` (trade name), `status[]` (default `active`, `paused`), `accountManagerId`, `sector`, `healthcare`, `archived` (scope all only), `sort` (`tradeName` default, `createdAt`), `order` | `clientPageSchema`: id, trade name, sector, status, healthcare, account manager (id, name, archived), `hasApprovalContact` | — |
| `GET /api/clients/sectors` | `clients.read` | — | sectors in use by non-archived clients, sorted | — |
| `GET /api/clients/:id` | `clients.read` | — | `clientDetailSchema`: the list fields plus brand kit, non-archived contacts, non-archived platform accounts, `archivedAt`, and `canManage` (the caller may edit) | 404 |
| `POST /api/clients` | `clients.manage` (scope all) | `createClientSchema`: tradeName, sector, accountManagerId, status (default `active`), isHealthcare | `clientDetailSchema` | 403, `CLIENT_NAME_TAKEN`, `INVALID_ACCOUNT_MANAGER` |
| `PATCH /api/clients/:id` | `clients.manage` | `updateClientSchema`: tradeName, sector, status, accountManagerId and isHealthcare (last two scope all), all optional | `clientDetailSchema` | 403, 404, `CLIENT_ARCHIVED`, `CLIENT_NAME_TAKEN`, `INVALID_ACCOUNT_MANAGER` |
| `POST /api/clients/:id/archive` | `clients.manage` (scope all) | — | `clientDetailSchema` | 403, 404, `CLIENT_ARCHIVED` |
| `POST /api/clients/:id/restore` | `clients.manage` (scope all) | — | `clientDetailSchema` | 403, 404, `CLIENT_NOT_ARCHIVED`, `CLIENT_NAME_TAKEN`, `INVALID_ACCOUNT_MANAGER` |
| `PUT /api/clients/:id/brand-kit` | `clients.manage` | `brandKitSchema` | `brandKitSchema` | 403, 404, `CLIENT_ARCHIVED` |
| `POST /api/clients/:id/contacts` | `clients.manage` | `createContactSchema` | `contactSchema` | 403, 404, `CLIENT_ARCHIVED`, `LIMIT_REACHED` |
| `PATCH /api/clients/:id/contacts/:contactId` | `clients.manage` | `updateContactSchema` | `contactSchema` | 403, 404, `CLIENT_ARCHIVED` |
| `POST /api/clients/:id/contacts/:contactId/archive` | `clients.manage` | — | 204 | 403, 404, `CLIENT_ARCHIVED` |
| `POST /api/clients/:id/platform-accounts` | `clients.manage` | `createPlatformAccountSchema` | `platformAccountSchema` | 403, 404, `CLIENT_ARCHIVED`, `LIMIT_REACHED` |
| `PATCH /api/clients/:id/platform-accounts/:accountId` | `clients.manage` | `updatePlatformAccountSchema` | `platformAccountSchema` | 403, 404, `CLIENT_ARCHIVED` |
| `POST /api/clients/:id/platform-accounts/:accountId/archive` | `clients.manage` | — | 204 | 403, 404, `CLIENT_ARCHIVED` |
| `GET /api/clients/:id/notes` | `clients.read` | `noteListQuerySchema`: `channel`, `contactId`, `authorId` | `notePageSchema`, newest `occurredAt` first: author (id, name), contact (id, name, archived), `canEdit`, `canArchive` | 404 |
| `POST /api/clients/:id/notes` | `clients.log` | `createNoteSchema`: occurredAt, channel, contactId, summary | `noteSchema` | 404, `CLIENT_ARCHIVED`, `UNKNOWN_CONTACT` |
| `PATCH /api/clients/:id/notes/:noteId` | `clients.log` | `updateNoteSchema` (same fields, optional) | `noteSchema` | 404, `NOT_NOTE_AUTHOR`, `CLIENT_ARCHIVED`, `NOTE_ARCHIVED`, `UNKNOWN_CONTACT` |
| `POST /api/clients/:id/notes/:noteId/archive` | `clients.log` | — | 204 | 404, `NOT_NOTE_AUTHOR` (neither author nor scope all), `CLIENT_ARCHIVED`, `NOTE_ARCHIVED` |

Changes to F01 endpoints:
- `POST /api/users/:id/archive` and `PATCH /api/users/:id` (removing `account_manager` from roles) return `USER_HAS_RESPONSIBILITIES` with `{ type: 'account_manager_of_client', id, name }` items (rule 8). `responsibilitySchema` gains that type.
- The account manager picker uses the existing `GET /api/users?role=account_manager`.

Module wiring: the `auth` module needs the clients a user is account manager of (rule 8) and `clients` needs users from `auth` (rule 2). The implementation avoids a module import cycle, for example with a responsibility-check registry exported by `auth` that `clients` registers into; the plan picks the mechanism.

## Screens

All screens: Arabic RTL, strings through i18next (`clients.*`), loading, empty and error states. Navigation shows "Clients" to every user.

1. **Client list** `/clients` — table: trade name, sector, account manager (initials avatar and name; "archived" badge if so), status badge, healthcare badge, a warning icon when there is no approval contact. Search, filters (status, default active + paused; account manager; sector; healthcare). Account managers get a "My clients" toggle (filter on themselves). Scope-all holders: "New client" button and an "Archived" filter. Empty: "no clients match" (or "no clients yet" with the "New client" button for scope-all holders).
2. **New client** `/clients/new` (scope all) — trade name, sector (suggests sectors in use), account manager (picker of non-archived users with the Account Manager role), status, healthcare flag. On success, opens the profile.
3. **Client profile** `/clients/$clientId` — header: trade name, status, healthcare badge, sector, account manager; the "no approval contact" warning. Actions by permission: edit basics (dialog; account manager and healthcare fields only for scope all), change status, archive (confirmation) / restore. An archived client shows an "archived" banner and no edit actions. Tabs (the selected tab is kept in the URL):
   - **Contacts** — cards or rows: name, job title, phone (tap to call, WhatsApp link), email, "final approval" badge, notes. Add, edit, remove (confirmation). Empty: "no contacts yet".
   - **Brand kit** — color swatches with hex and a copy button, font names, tone of voice, forbidden words as chips, file links grouped by kind, liked and disliked references as link cards. One edit form for the whole kit. Empty: "brand kit not filled in yet".
   - **Platforms** — platform icon and name or label, link (opens in a new tab), access badge (granted / pending / none), admin note. Add, edit, remove.
   - **Communication** — the log, newest first: date and time (Asia/Damascus), channel icon, contact, author, summary. "Add note" for everyone (date and time default to now). Edit and archive on notes the user may change. Filters: channel, contact. Empty: "no communication logged yet".
   F05, F06 and F13 add their tabs (projects, retainer, open tasks, invoices and balance) here.

What roles see differently: everyone sees the same profile; edit actions appear per the actions table; F13's financial tab will be hidden without `invoices.read`.

## Audit, notifications and jobs
- Audit actions (entity `client` unless noted): `client.created`, `client.updated` (trade name, sector), `client.status_changed`, `client.account_manager_changed`, `client.healthcare_changed`, `client.archived`, `client.restored`, `client.brand_kit_updated` (before/after of the changed kit keys), `client_contact.created` / `updated` / `archived` (entity `client_contact`), `client_platform_account.created` / `updated` / `archived` (entity `client_platform_account`), `client_note.created` / `updated` / `archived` (entity `client_note`). One PATCH that changes several kinds of fields writes one entry per action.
- The audit log screen links `client` entries to the profile, and contact, platform account and note entries to their client's profile (the entry's `after` or `before` carries `clientId`).
- Notifications: none (F14 is not built). F14 decides whether a newly assigned account manager is notified.
- Jobs: none.

## Edge cases
1. Two people edit the same client, brand kit, contact or note: last write wins; each change writes its own audit entry.
2. The account manager is changed while the old one has the profile open: their next edit returns 403 and the web app refreshes the profile, which then shows no edit actions.
3. The account manager is archived or loses the role: refused while they manage an active or paused client (rule 8). An ended client may keep an archived account manager, shown with an "archived" badge; reactivating it requires a new one (rule 3).
4. A user loses the Account Manager role through a department change: not possible, since the role is assigned, never derived (ADR 0014).
5. Restoring a client whose trade name was reused meanwhile: `CLIENT_NAME_TAKEN`; rename the other client first.
6. All final-approval contacts are removed: the warning comes back (rule 9).
7. A note references a contact that is later removed: the note keeps it and shows the name with "removed".
8. The healthcare flag is turned off while content is in medical review: F09 defines what happens to work in progress; F02 only records the change.
9. A note dated in the future: rejected by validation; a note dated in the past is allowed (logging an earlier call).
10. Sectors with different case or spaces ("Restaurants", " restaurants "): suggestions are grouped case-insensitively; the filter matches case-insensitively.
11. Duplicate platform link or contact on the same client: allowed; no uniqueness is enforced.
12. Brand kit arrays at their limits: validation errors name the field; the form shows them inline.
13. ~20 clients and a few hundred notes need no special limits; list `pageSize` rules from ADR 0013 apply.

## Open questions
None block F02. F14 decides whether a newly assigned account manager is notified; F09 decides what turning off the healthcare flag does to content in review.

## Acceptance
- Owner check in the browser:
  1. Sign in as the General Manager. Give a user the Account Manager role if none has it.
  2. Open Clients, create a client: trade name, a new sector, that account manager, healthcare on. The profile opens with the "no approval contact" warning.
  3. Add two contacts, one with final approval: the warning disappears.
  4. Fill the brand kit: two colors, a font, tone of voice, three forbidden words, a logo link, a liked reference. Add an Instagram account with access "pending" and an admin note.
  5. Sign in as the account manager in a private window: the client is editable, but the account manager and healthcare fields are not offered, and there is no "New client" button. Change the status to "paused".
  6. Sign in as an ordinary employee: the client and its full profile are visible, with no edit actions except "Add note". Add a note; edit it; confirm the account manager cannot edit it but the General Manager can archive it.
  7. As the General Manager, try to archive the account manager's user: refused, listing the client. Change the client's account manager; archive again: succeeds.
  8. Archive the client: it disappears from the list and appears under the "Archived" filter; restore it.
  9. Open the audit log and find each change above.
- Tests:
  - Unit: contract schemas (brand kit limits and hex normalization, URL rules, phone and email normalization, `label` required for `other`, note date not in the future); permission map changes (`clients.read` all for every user, `clients.manage` all for the Operations manager, `clients.log`).
  - API (`apps/api/test/clients.test.ts`, `client-contacts.test.ts`, `client-platform-accounts.test.ts`, `client-notes.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; an employee on manage endpoints; own_clients on scope-all actions); each error code above; rules 2–11; archived clients hidden from non-scope-all callers; audit entries written in the same transaction. `users.test.ts`: rule 8 on archive and on role removal.
  - E2E: create a client, add a contact with final approval, add a note as another user.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): client list, new client, profile with each tab (contacts, brand kit, platforms, communication), account-manager view.
