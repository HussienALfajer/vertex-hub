# 0014 — Permissions from roles and department capabilities

Status: Accepted · Date: 2026-09-28

## Context
ADR 0007 defined five roles and one permission map keyed by role. The owner's answers to Q13 (F01 spec, `docs/specs/F01-users-roles.md`) tie several permissions to a person's place in a department rather than to a role: the Internal Operations manager manages users, templates and the audit log; members of Medical Consultation perform the medical review; members of General Communication and Marketing work leads. Staff can belong to a primary department and secondary ones, and one person can manage several departments. Some roles are also facts about the organization (a department manager manages a department; every staff member is an employee) and would drift if set by hand.

## Decision
- **Departments are fixed configuration.** The ten departments are seeded with stable codes (`DEPARTMENT_CODES` in `packages/contracts`); names and managers are editable, codes never change, and none are added or archived in V1.
- **Effective roles** = assigned roles (`general_manager`, `account_manager`, `finance`, stored in `user_roles`) + derived roles: `employee` for every active user, `department_manager` while the user manages at least one department.
- **Department capabilities**: a second map in `packages/contracts`, keyed by department code and position (`member` or `manager`), grants permissions with scopes the same way roles do. Primary and secondary memberships count the same.
- **Effective permissions** are the union of role grants and department capability grants, computed on every request.
- The `department` scope means the departments the user manages.
- **Two-factor sign-in** is required for General Managers, Finance and the Internal Operations manager, and optional for everyone else.
- Only a General Manager grants or removes the General Manager role.

## Consequences
- `permissionScopes()` and `hasPermission()` take the user's access (roles and department positions), not a role list; the guard and `/api/me` load both.
- Moving a person between departments or changing a manager changes their permissions at once, with no separate role edit.
- Adding a department, or a capability for one, is a code change reviewed like any permission change.
- ADR 0007 stays valid; this record adds how its roles combine with departments.
