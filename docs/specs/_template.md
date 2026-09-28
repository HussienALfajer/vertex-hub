# <ID> — <Feature name>

Status: Draft | Approved · Date: YYYY-MM-DD · Scope: `docs/product/v1-scope.md` §<ID> · ADRs: <list>

## Summary
Two or three sentences: the problem this solves for the agency and what V1 of the feature does.

## In scope / out of scope
- In: …
- Out (later or never): …

## Roles and access
| Action | Permission | Roles and scope |
|---|---|---|
| List clients | `clients.read` | General Manager: all · Account Manager: own_clients · … |

## Data
For each entity: table, fields (name, type, required, constraints), relations, indexes, and what "archived" means for it. Money fields name their currency (ADR 0006).

## States and rules
States and allowed transitions (who, when, what happens). Business rules as numbered, testable statements.

## API
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/clients` | `clients.read` | `clientListQuerySchema` | `clientPageSchema` | — |

## Screens
For each screen: route, purpose, content and actions, and its loading, empty and error states. Note what each role sees differently.

## Audit, notifications and jobs
Which changes write audit entries; which events notify whom (F14); scheduled or slow work for the worker.

## Edge cases
Numbered list: concurrent edits, archived references, permission changes mid-session, empty data, limits.

## Open questions
Anything not yet decided, with a recommendation. Nothing here may be guessed during implementation.

## Acceptance
- End-to-end check the owner runs in the browser, step by step.
- Tests: API (success, 401, 403, out of scope per endpoint), unit (rules), E2E and RTL screenshots (screens).
