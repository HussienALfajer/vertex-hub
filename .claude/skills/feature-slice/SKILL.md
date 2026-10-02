---
name: feature-slice
description: Implement an approved feature spec end to end, layer by layer (contracts → db → api → OpenAPI → web → E2E), with a check gate after each layer, the reviewer, and the owner's acceptance steps. The implement step of the feature cycle, between /spec and /ship.
argument-hint: <feature id or spec path, e.g. F02>
disable-model-invocation: true
effort: medium
---

Implement **$ARGUMENTS**. This skill orders the work and names the gates; the rules for each folder stay in its `CLAUDE.md` and in ADR 0013. The new-module wiring and the files to copy from are in [wiring.md](wiring.md): read it before the first layer.

## 0. Preconditions (stop and tell the owner if one fails)
- The spec (`docs/specs/<id>-*.md`) says `Status: Approved`, and its "Open questions" block nothing this work touches. Never answer an open question yourself.
- The branch is not `main`. Name it `feat/<id>-<slice>`, e.g. `feat/f02-clients-api`.
- The working tree is clean, and `main` is pulled.

## 1. Plan (no code)
- Read only: the spec, the ADRs it lists, `wiring.md`, and the `CLAUDE.md` of each folder you will touch. Open reference files by range, when you write the layer that needs them.
- If `TASKS.md` already holds this feature, continue from its first open PR instead of planning again. Check that the earlier PRs are merged into `main`.
- Split the feature into PRs. Default: PR 1 is contracts, db and api with their tests; PR 2 is web and E2E. Use a single PR when the whole feature is small (about one table and one screen). A PR never leaves `main` broken or half-wired.
- Write `TASKS.md` for this feature (replace the previous feature's file): a heading per PR, one item per layer below, the wiring items from `wiring.md` that apply, and "checks, reviewer, acceptance, /ship" at the end of each PR.
- Show the owner the PR split and the task list in a few lines, in Arabic, then **stop and wait for approval**.

## 2. Build, one layer at a time
Finish a layer, run its gate through the `checker` subagent, fix root causes, tick the item in `TASKS.md`, then start the next layer. Never start a layer while the previous gate fails.

| # | Layer | Build | Gate |
|---|---|---|---|
| 1 | contracts | Schemas and types, list query and page schemas, permissions and grants, error codes, audit actions and entity types; unit tests for pure rules | `contracts` test, root `typecheck` |
| 2 | db | Run `/db-migration`: schema, generated migration, SQL review | `db` test, migration drift |
| 3 | api | Module, controller, service: scopes as `where` filters, audit in the change's transaction, archive instead of delete, coded errors; `test/<module>.test.ts` | `api` test file of the module, `test/architecture.test.ts`, `api` typecheck |
| 4 | bridge | `pnpm build`, then `openapi:export` and `api:generate` (commands in `AGENTS.md`) | `web` typecheck |
| 5 | web | `features/<module>/`: queries, pages, forms; thin routes; navigation; `ar.json` keys (feature, errors, audit); loading, empty and error states | `web` typecheck, lint, `web` test |
| 6 | e2e | Mocks in `e2e/fixtures.ts`, the feature's flow spec, RTL screenshots in both themes in `e2e/screens.spec.ts` | `pnpm test:e2e`; open the new screenshots and look at them |

Layers a PR does not include are skipped. Helpers that ADR 0013 says arrive with their first use (sorting, money columns, new list or error shapes) are written in the layer that first needs them, in the shared place ADR 0013 names.

## 3. Close each PR
1. Walk the wiring checklist in `wiring.md` against the diff (`git diff main...HEAD --stat`).
2. Full checks once, through `checker`: lint, typecheck, test, build; add E2E when web changed and migration drift when db changed. `checker` records the passes against the exact working tree, and `/ship` reuses them while no file changes; any later fix (reviewer, owner) invalidates the record, so the last full run after the last fix is the one `/ship` reuses.
3. Run the `reviewer` subagent with the spec path. Fix every blocking finding, then re-run the affected gates.
4. Owner acceptance, in Arabic:
   - PR with screens: turn the spec's "Acceptance" section into numbered browser steps for the owner (`pnpm dev`, which roles to sign in as, what to click, what they should see). Ask before `pnpm db:migrate` on the dev database.
   - PR without screens: summarize the endpoints and their rules; the owner may try them at `http://127.0.0.1:3000/api/docs`.
   Fix what the owner reports in the same session, then repeat steps 2–3 for what changed.
5. Tick the PR's items in `TASKS.md` and hand over to `/ship`. Do not commit, push or open the PR from this skill.

## Stop and ask when
- The spec is ambiguous in a way that changes the result, or the work needs an answer from `docs/open-questions.md`.
- The migration review in `/db-migration` finds a destructive or non-backward-compatible change.
- A command changes the owner's data (`pnpm db:migrate`) or leaves the machine (`git push`, `ssh`).
- The work would go beyond the spec. Record the idea as a follow-up instead.

## Keep this skill true
If a step here or in `wiring.md` was missing, wrong or out of date, fix the file in the same PR and say so in the report under "Found".
