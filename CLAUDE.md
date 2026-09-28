@AGENTS.md

# Claude Code specifics

## Model and effort

- Default: Opus 5.5 at `medium`. Use `high` for specs, data-model and architecture work; `low` for mechanical edits (renames, applying a known pattern, translation keys).
- Set model and effort at session start. Don't switch models mid-session: it drops the prompt cache.
- If the same problem fails twice at `xhigh`, say so and suggest switching to Fable 5.1 for that problem only.

## Context hygiene

- One feature or task per session. Suggest `/clear` when the owner moves to unrelated work.
- Delegate broad searches, log reading and test-output digging to a subagent on Haiku or Sonnet; keep only its summary.
- Don't load all of `docs/` up front. Read what the current task needs.

## Feature workflow

Spec (interview → `docs/specs/<feature>.md`) → plan (plan mode) → implement → review (fresh-context subagent against the spec, blocking issues only) → owner verifies → PR → update `docs/ROADMAP.md`. Details in `docs/workflow.md`.

## Compaction

When compacting, keep: the current feature and its spec path, files changed, failing checks with their exact commands, open decisions, and the state of `TASKS.md`.
