# F01 — Users, departments, roles and permissions

Status: Approved · Date: 2026-09-28 · Scope: `docs/product/v1-scope.md` §F01 · ADRs: 0002, 0007, 0013, 0014

## Summary
Today accounts exist only through a server command, every user's role is set by hand, and nothing records who changed what. F01 gives the agency its team: the ten departments with their managers, staff profiles (departments, title, phone, skills), account onboarding through one-time links, roles and department-based permissions, required two-factor sign-in for the people who hold money or user management, and the audit log that every later feature writes to.

## In scope / out of scope
- In:
  - The ten departments, seeded with stable codes; rename and change manager.
  - Staff accounts: create, edit, archive, restore; onboarding and password reset through a one-time link copied by the user manager.
  - Profile: name, email, primary department, secondary departments, title, phone, skills.
  - Effective roles and permissions: assigned roles, derived roles, department capabilities (ADR 0014); the final V1 permission map (resolves Q13).
  - Two-factor sign-in (TOTP + backup codes): required for some users, optional for everyone else.
  - Team directory, department pages, "my account", the audit log module and its screen.
  - Sign-in rate limiting.
- Out (later or never):
  - Profile photos: deferred to F10 (files). Avatars show the name's initials.
  - Sending activation links by email: F14 email, after Q5. Until then the link is copied and sent by hand.
  - Self-service "forgot password": needs email (Q5). Until then the user asks a user manager for a reset link.
  - Adding or archiving departments (the ten are fixed in V1).
  - Field-level custom permissions, attendance, payroll (v1-scope).
  - Daily backups: already running on the server (`docs/deployment.md`); off-server copies are Q4.

## Roles and access

### Effective roles (ADR 0014)
| Role | How a user gets it |
|---|---|
| General Manager | Assigned. Only a General Manager can grant or remove it. |
| Account Manager | Assigned by a user manager to any user (no department restriction). |
| Finance | Assigned by a user manager. |
| Department Manager | Derived: held while the user manages at least one department. Never assigned by hand. |
| Employee | Derived: every active user holds it. Never assigned by hand. |

### Department capabilities (ADR 0014)
Granted by position in a department. Primary and secondary memberships count the same.

| Department | Position | Grants |
|---|---|---|
| Internal Operations | manager | `users.manage`, `audit.read`, `templates.read`, `templates.manage` (all `all`) |
| Medical Consultation | member | `approvals.review_medical` (`all`) |
| General Communication | member | `leads.read`, `leads.manage` (`all`) |
| Marketing | member | `leads.read`, `leads.manage` (`all`) |

"Operations manager" in this spec means the manager of Internal Operations.

### Permission map changes (from the provisional map in `packages/contracts/src/permissions.ts`)
- The `department` scope means the departments the user **manages**.
- `users.read` (`all`) moves to Employee, so every active user sees the team directory. The Department Manager's `users.read: department` grant is removed as redundant.
- Account Manager gains `leads.read` and `leads.manage` with scope `assigned` (leads they own).
- New permission `reports.finance` (financial reports: invoiced vs collected, outstanding amounts, overdue invoices, revenue by client and service). Held by General Manager and Finance, scope `all`. Finance does not hold `reports.read` (operational reports such as department productivity).
- `users.manage`, `audit.read`, `templates.manage`: General Manager and the Operations manager only. Department Managers keep `templates.read` only.
- Every other grant stays as it is until the feature that uses it revisits it in its spec.

### F01 actions
| Action | Permission | Roles and scope |
|---|---|---|
| See the team directory and department pages | `users.read` | Every active user: all |
| Create, edit, archive, restore users; issue links; reset 2FA | `users.manage` | General Manager: all · Operations manager: all users except those holding General Manager |
| Grant or remove General Manager | `users.manage` | General Manager only |
| Rename a department, change its manager | `users.manage` | General Manager · Operations manager |
| Edit own phone and skills, change own password, manage own 2FA | session | Every active user, own account only |
| Read the audit log | `audit.read` | General Manager · Operations manager |

## Data

### `departments` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `code` | enum `department_code` | required, unique; one of `DEPARTMENT_CODES` in contracts |
| `name` | text | required, 1–60 chars, unique; editable display name |
| `manager_id` | uuid → `users.id` | nullable, indexed; must be an active member of the department |
| timestamps, `archived_at` | | `archived_at` stays null in V1 (departments are not archived) |

Seeded by a custom migration with these codes and names:
`general_management` الإدارة العامة · `internal_operations` العمليات الداخلية · `public_relations` العلاقات العامة · `marketing` التسويق · `design` التصميم · `photography` التصوير · `content_management` إدارة المحتوى · `development` التطوير · `general_communication` التواصل العام · `medical_consultation` الاستشارات الطبية

### `department_members` (link table; listed as an exception in `packages/db/src/conventions.test.ts`)
| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid → `users.id` | required, indexed |
| `department_id` | uuid → `departments.id` | required, indexed |
| `is_primary` | boolean | required |
| `created_at` | timestamptz | |

Primary key (`user_id`, `department_id`). Partial unique index: one `is_primary = true` row per user. Memberships are added or removed, never archived.

### `users` (Better Auth table, extended)
New columns:
| Field | Type | Rules |
|---|---|---|
| `title` | text | optional, ≤ 80 chars |
| `phone` | text | optional; stored normalized as `+` and digits, 8–15 digits |
| `skills` | text[] | default empty; each 1–40 chars, trimmed, unique per user case-insensitively, at most 20 |
| `archived_at` | timestamptz | null while the account is usable |

`name`: required, 1–100 chars. `email`: required, unique, stored lower-case. The existing `image` column stays unused until F10.

Derived status: `invited` (no password set yet), `active`, `archived`.

### `user_roles` (existing)
Holds assigned roles only: `general_manager`, `account_manager`, `finance`. The migration deletes existing `employee` and `department_manager` rows (both are derived now). The `role` enum keeps all five values, since effective roles use them.

### Two-factor data
The tables and columns Better Auth's two-factor plugin requires (TOTP secret and hashed backup codes, a `two_factor_enabled` flag on `users`). Secrets are never returned by the API or written to the audit log.

### `audit_entries` (append-only; listed as an exception in `packages/db/src/conventions.test.ts`)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` (UUIDv7, so time-ordered) |
| `occurred_at` | timestamptz | required, default now |
| `actor_id` | uuid → `users.id` | nullable (null: system or CLI), indexed |
| `action` | text | required, `<entity>.<verb>`, e.g. `user.archived` |
| `entity_type` | text | required, e.g. `user`, `department` |
| `entity_id` | uuid | required |
| `before` | jsonb | nullable; the changed fields before the change |
| `after` | jsonb | nullable; the changed fields after the change |

Indexes: (`entity_type`, `entity_id`), `actor_id`, `occurred_at`. Rows are never updated or deleted, and kept indefinitely. Owned by the `audit` module, which exports the writer every module uses inside its own transaction (ADR 0013).

Module ownership of the new tables (`users` vs `auth` module) is settled in the plan; it must not create a circular dependency between modules.

## States and rules

### User status
```
(create) → invited ──(sets password through link)──→ active
invited | active ──(archive)──→ archived ──(restore)──→ invited
```

### Rules
1. Every active or invited user has exactly one primary department. Secondary departments are optional and never include the primary one.
2. Effective roles = assigned roles + Employee (every non-archived user) + Department Manager (while managing at least one department).
3. Effective permissions = the union of role grants and department capability grants (tables above). When the same permission comes from several sources, all its scopes apply.
4. Permissions are computed on every request, so role, department and manager changes apply to open sessions immediately.
5. Only a General Manager can grant or remove the General Manager role. A user manager who is not a General Manager cannot edit, archive, restore, issue links for, or reset 2FA of a user who holds it (`GENERAL_MANAGER_ONLY`).
6. The last active General Manager cannot lose the role or be archived (`LAST_GENERAL_MANAGER`).
7. A user cannot archive themselves (`CANNOT_ARCHIVE_SELF`).
8. A department has at most one manager; one user can manage several departments. The manager must be an active member (primary or secondary) of the department (`MANAGER_NOT_MEMBER`). A user cannot be removed from a department they manage until the manager changes (`MANAGER_MEMBERSHIP_REQUIRED`).
9. Archiving is refused while the user has responsibilities (`USER_HAS_RESPONSIBILITIES`, listing each one): F01 checks "manages a department"; F02 adds "primary account manager of an active client"; F06 adds "assigned open tasks".
10. Archiving revokes all the user's sessions and pending links. An archived user cannot sign in; the sign-in error is the same generic one as for a wrong password.
11. Restoring sets the status to `invited` and issues a new activation link. The user keeps their profile, assigned roles and departments. Their email stays reserved while archived.
12. Archived users cannot be edited except by restoring them (`USER_ARCHIVED`).
13. Activation and reset links are single-use and expire after 72 hours. Issuing a new link invalidates the user's earlier links. Setting a password through a link revokes the user's other sessions. The password rule is the existing one (at least 12 characters).
14. A link issued to an `invited` user is an activation link; to an `active` user, a password reset link. Same mechanism and page.
15. Two-factor sign-in is required for users holding General Manager or Finance, and for the Operations manager. A required user without 2FA enabled can use only `GET /api/me`, the 2FA setup endpoints and sign-out until they enable it (`TWO_FACTOR_REQUIRED`); the web app sends them to the setup page. A required user cannot disable 2FA.
16. 2FA is TOTP (authenticator app) with 10 single-use backup codes shown once at setup. No "trust this device". Verification is asked at every sign-in.
17. Resetting a user's 2FA (lost phone) disables it; if it is required, the user sets it up again at the next request.
18. Sign-in and 2FA verification are limited to 5 attempts per minute per client IP.
19. A user edits only their own phone and skills (plus password and 2FA). Name, email, departments, title and roles are edited by user managers.
20. Email changes by a user manager keep the user's sessions and password.
21. Department names are unique; codes never change.
22. Every change in this feature writes an audit entry in the same transaction (see below). Password hashes, tokens, links and 2FA secrets are never written to the audit log.

## API

All request and response schemas live in `packages/contracts` (`users.ts`, `departments.ts`, `audit.ts`; list and error schemas are added with their first use, ADR 0013). Lists take `page`, `pageSize` and return `{ items, total, page, pageSize }`.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/me` | session | — | `meResponseSchema` (extended: effective roles, departments with `isPrimary` and `isManager`, permissions with scopes, `twoFactor: { enabled, required }`) | — |
| `PATCH /api/me/profile` | session | `updateOwnProfileSchema` (phone, skills) | `userDetailSchema` | — |
| `GET /api/users` | `users.read` | `userListQuerySchema` (search on name/email, `departmentId`, `role`, `skill`, `status`; `status` other than `active` needs `users.manage`) | `userPageSchema` | — |
| `GET /api/users/skills` | `users.read` | — | skills in use, sorted | — |
| `GET /api/users/:id` | `users.read` | — | `userDetailSchema` (roles, status, 2FA state and email of archived users only with `users.manage`) | 404 |
| `POST /api/users` | `users.manage` | `createUserSchema` (name, email, primaryDepartmentId, secondaryDepartmentIds, title, phone, skills, roles ⊆ assignable roles) | `{ user, link: { url, expiresAt } }` | `EMAIL_TAKEN`, `GENERAL_MANAGER_ONLY` |
| `PATCH /api/users/:id` | `users.manage` | `updateUserSchema` (same fields, all optional) | `userDetailSchema` | `EMAIL_TAKEN`, `USER_ARCHIVED`, `GENERAL_MANAGER_ONLY`, `LAST_GENERAL_MANAGER`, `MANAGER_MEMBERSHIP_REQUIRED` |
| `POST /api/users/:id/link` | `users.manage` | — | `{ url, expiresAt, kind: 'activation' \| 'reset' }` | `USER_ARCHIVED`, `GENERAL_MANAGER_ONLY` |
| `POST /api/users/:id/archive` | `users.manage` | — | `userDetailSchema` | `USER_HAS_RESPONSIBILITIES`, `CANNOT_ARCHIVE_SELF`, `LAST_GENERAL_MANAGER`, `GENERAL_MANAGER_ONLY` |
| `POST /api/users/:id/restore` | `users.manage` | — | `{ user, link }` | `GENERAL_MANAGER_ONLY` |
| `POST /api/users/:id/two-factor/reset` | `users.manage` | — | `userDetailSchema` | `USER_ARCHIVED`, `GENERAL_MANAGER_ONLY` |
| `GET /api/departments` | `users.read` | — | departments with manager and member count | — |
| `GET /api/departments/:id` | `users.read` | — | department with members | 404 |
| `PATCH /api/departments/:id` | `users.manage` | `updateDepartmentSchema` (name, managerId nullable) | department | `DEPARTMENT_NAME_TAKEN`, `MANAGER_NOT_MEMBER` |
| `GET /api/audit` | `audit.read` | `auditListQuerySchema` (`entityType`, `entityId`, `actorId`, `action`, `from`, `to`) | `auditPageSchema` (newest first, actor name included) | — |
| Better Auth: `POST /api/auth/reset-password` | anonymous | token + new password | — | invalid or expired token |
| Better Auth: change password, two-factor enable / verify / disable, sign-in | session or anonymous as Better Auth defines | — | — | `TWO_FACTOR_REQUIRED` on disable when required |

`users.read` without `users.manage` returns directory fields only: name, email, departments, title, phone, skills, whether the user manages a department.

The `user:create` CLI stays for bootstrapping the first General Manager: it gains a required `--department <code>`, accepts assignable roles only, and writes an audit entry with a null actor.

## Screens

All screens: Arabic RTL, strings through i18next (`users.*`, `departments.*`, `account.*`, `audit.*`), loading, empty and error states. Navigation shows "Team" and "Departments" to everyone, "Audit log" to holders of `audit.read`.

1. **Team directory** `/team` — table: initials avatar, name, primary department (secondary as chips), title, phone, skills. Search, filters by department and skill. With `users.manage`: status filter (active / invited / archived), roles and 2FA columns, "New user" button. Empty: "no users match".
2. **New user** `/team/new` (`users.manage`) — form with the fields of `createUserSchema`; skills input suggests skills in use; General Manager role checkbox shown only to General Managers. On success, a dialog shows the activation link with a copy button and its expiry, and explains it must be sent by hand.
3. **User profile** `/team/$userId` — everyone: directory fields and the departments they manage. With `users.manage`: edit form, status, roles, 2FA state, and actions "Copy activation/reset link", "Reset 2FA", "Archive" (confirmation; on `USER_HAS_RESPONSIBILITIES` lists what must be moved first, with links), "Restore".
4. **Departments** `/departments` — the ten departments: name, manager, member count. **Department** `/departments/$departmentId` — members (primary first), manager. With `users.manage`: rename, change manager (picker lists active members only).
5. **My account** `/account` — own profile (read-only fields), edit phone and skills, change password, enable 2FA or disable it (hidden when required), regenerate backup codes.
6. **Activate / reset password** `/activate?token=…` (public) — new password twice, then redirect to sign-in. Invalid or expired token: explanation and "ask your manager for a new link".
7. **Set up 2FA** `/setup-two-factor` — QR code and manual key, code confirmation, backup codes shown once with copy. Required users are redirected here until done.
8. **Sign-in** `/login` — adds the 2FA code step (code or backup code).
9. **Audit log** `/audit` (`audit.read`) — newest first: time (Asia/Damascus), actor, action (translated), entity (linked where a page exists). Filters: entity type, actor, action, date range. Row expands to show the before/after of changed fields.

## Audit, notifications and jobs
- Audit actions: `user.created`, `user.updated` (profile fields), `user.roles_changed`, `user.departments_changed`, `user.archived`, `user.restored`, `user.link_issued` (kind only), `user.password_set` (through a link; actor = the user), `user.password_changed`, `user.two_factor_enabled`, `user.two_factor_disabled`, `user.two_factor_reset`, `user.profile_updated` (own phone and skills), `department.updated`.
- Sign-ins are not audited; sessions are recorded in `sessions`.
- Notifications: none in F01 (F14 is not built). When F14 email exists, links are also emailed (depends on Q5).
- Jobs: none.

## Edge cases
1. Two user managers edit the same user: last write wins; each change writes its own audit entry.
2. A user's roles or departments change while they are signed in: the next request uses the new permissions (rule 4); the web app refreshes `/api/me` on focus and on 403.
3. A user becomes Finance or the Operations manager while signed in: the next request returns `TWO_FACTOR_REQUIRED` until they set up 2FA.
4. The Operations manager is changed: the old manager loses the capabilities at once; the new one must set up 2FA.
5. The only General Manager loses their 2FA device and backup codes: reset through a server CLI command (`user:reset-two-factor --email <email>`, audited with a null actor), since the Operations manager cannot reset a General Manager.
6. Existing accounts created before F01 have no department: they stay usable; the directory flags them, and saving their profile requires a primary department.
7. An activation link is opened after the user was archived: rejected as invalid (rule 10).
8. Two links issued in a row: only the newest works (rule 13).
9. Changing a department's manager to "none": allowed; the former manager loses Department Manager if they manage no other department.
10. A secondary membership in Medical Consultation, General Communication or Marketing grants the department's capabilities (rule 3).
11. Removing the last General Manager's role or archiving them: refused (rule 6).
12. Skills with different case or spaces ("Photoshop", " photoshop "): stored once per user; suggestions are case-insensitive.
13. Lists at ~20 users need no special limits; `pageSize` rules from ADR 0013 apply.

## Open questions
- **Q14 (needed before F06):** should the Operations manager see and reassign tasks across all departments ("workload distribution" in v1-scope §2)? Recommendation: yes, `tasks.read` and `tasks.manage` with scope `all`, plus `reports.read` `all`. Not granted in F01.
- **Q5:** email provider. Until it is decided, links are copied by hand and there is no self-service password reset.

## Acceptance
- Owner check in the browser:
  1. Sign in as the General Manager, set up 2FA when asked, and save the backup codes.
  2. Open Departments; rename one and set its manager (the picker shows members only).
  3. Create a user in Design with Account Manager; copy the activation link.
  4. In a private window, open the link, set a password, sign in; check the team directory is visible and "Audit log" is not in the menu.
  5. As the General Manager, make that user the manager of Internal Operations (add the department first); in the private window, the next action asks for 2FA setup; after setup, "Audit log" and "New user" appear.
  6. Try to archive that user: refused, listing "manages Internal Operations". Change the manager, archive again: succeeds, and the private window is signed out.
  7. Open the audit log and find each of the changes above with before/after values.
- Tests:
  - Unit: effective roles and permission resolution (roles + department capabilities, scopes), the 2FA-required rule, contract schemas (skills normalization, phone format, secondary ≠ primary).
  - API (`apps/api/test/users.test.ts`, `departments.test.ts`, `audit.test.ts`): each endpoint for success, 401, 403, and out of scope; each error code above; rules 5–13 and 15; audit entries written in the same transaction; archived users cannot sign in.
  - E2E: activation link → set password → sign in; 2FA setup and sign-in with a code; archive blocked then allowed.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): team directory, user profile (manager view), new user with link dialog, departments, my account, activation, 2FA setup, audit log.
