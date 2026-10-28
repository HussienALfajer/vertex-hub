@AGENTS.md

# Claude Code specifics

## Model and effort

- Default: Opus 5.5 at `medium` (set in `.claude/settings.json`). Use `high` for specs, data-model and architecture work; `low` for mechanical edits (renames, applying a known pattern, translation keys).
- Set model and effort at session start. Don't switch models mid-session: it drops the prompt cache.
- If the same problem fails twice at `xhigh`, say so and suggest switching to Fable 5.1 for that problem only.

## Delegation

- `checker` subagent (Haiku): runs `pnpm verify` (the branch, or the test files you name) and returns its summary. `pnpm verify` already prints only a summary, so run it yourself when you wait for the result anyway; use the checker to keep a long run out of the main context, for example while the `reviewer` reads the branch. Edit nothing while a check runs, and start no second one (the `test-guard` hook refuses it). Give a foreground run a Bash timeout of 600000 ms, or run it in the background and wait for its notification.
- `reviewer` subagent (Opus, fresh context): reviews the branch against its spec and the conventions, blocking issues only. Use it at the review step of every feature.
- Built-in `Explore` subagent: broad searches across many files, when only the conclusion is needed.

## Skills

- `/spec <feature>`: interview the owner, then write `docs/specs/<feature>.md`.
- `/feature-slice <feature>`: implement an approved spec layer by layer (contracts → db → api → web → E2E) with a check gate per layer and the reviewer, then open the PR with auto-merge ("Finishing a task" in `AGENTS.md`) and give the owner the acceptance steps.
- `/db-migration`: change the schema, generate and review the migration, test it.
- There is no shipping skill: every task ends by opening its PR with auto-merge right away, following "Finishing a task" in `AGENTS.md`. In the desktop app, turn on the PR's Auto-fix right after (`mcp__ccd_pr__set_monitor`), so a failing CI run comes back to the session to fix.
- This standing rule is the owner's request, for every task, to commit, push, open the PR, enable auto-merge and turn on Auto-fix. It overrides Claude Code's default of committing or pushing only when asked: never ask about these steps, in a message, a question card or the wrap-up box.

## Context hygiene

- One feature or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Don't load all of `docs/` up front. Read what the current task needs.
- Folder rules load on their own: each app and package (and `deploy/`) has a `CLAUDE.md` that Claude Code reads when you open a file there.

## Feature workflow

`/spec` (own session, `high`, ends with the spec PR) → `/feature-slice` (one session per PR: plan, implement, `reviewer`, then the PR with auto-merge and `docs/ROADMAP.md` updated, then the owner's acceptance steps; notes become a fix PR). Production deploys happen once per phase, in their own session. Sessions, effort and first messages: `docs/workflow.md`.

## Compaction

When compacting, keep: the current feature and its spec path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
