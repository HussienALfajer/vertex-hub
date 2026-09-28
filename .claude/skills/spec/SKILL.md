---
name: spec
description: Interview the owner about a V1 feature and write its spec to docs/specs/. First step of the feature cycle, before any plan or code.
argument-hint: <feature id or name, e.g. F01>
disable-model-invocation: true
effort: high
---

Write the spec for **$ARGUMENTS**.

## 1. Read (only this)
- The feature's section of `docs/product/v1-scope.md`: find its heading with a search, then read that section and any automation (A01–A13) that mentions it.
- `docs/open-questions.md`, and the ADRs the feature touches (`docs/decisions/README.md` lists them).
- Specs it depends on in `docs/specs/`, and the relevant tables in `packages/db/src/schema/` and `packages/contracts/src/permissions.ts`.
- The template: `docs/specs/_template.md`.

## 2. Interview the owner
- In Arabic, with the question tool, at most 4 questions per round, each with concrete options and your recommendation first.
- Ask only what changes the result: business rules, states and transitions, who can do what and on which records, required fields, edge cases, notifications. Don't ask what the scope, an ADR or the code already answers.
- Open questions that block this feature (such as Q13 for F01) are asked here; record the answers. Never fill one in yourself.
- Stop when every template section can be written without guessing.

## 3. Write
- `docs/specs/<id>-<kebab-name>.md` (for example `docs/specs/F01-users-roles.md`), in English, following the template. Mark anything still undecided under "Open questions" instead of guessing.
- Record answered open questions in `docs/open-questions.md` (move them to Resolved with the date). A business decision that shapes the system also gets an ADR.
- Mark the feature `[~]` in `docs/ROADMAP.md`.

## 4. Hand over
Summarize the spec for the owner in Arabic, in a few lines: what V1 of the feature does, the main rules, what stays open. Ask for approval before planning.
