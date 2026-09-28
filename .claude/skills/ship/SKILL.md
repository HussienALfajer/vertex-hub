---
name: ship
description: Finish a change — full checks, docs, commit, push, pull request with auto-merge, and the final report.
argument-hint: [short summary of the change]
disable-model-invocation: true
---

Ship the current branch. Stop and report at the first step that fails.

1. **Branch:** never ship from `main`. If on `main`, create a branch named by type (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`). `TASKS.md` has no open items for this change.
2. **Checks** through the `checker` subagent: lint, typecheck, test and build; add E2E when `apps/web` or `packages/ui` changed, and migration drift when `packages/db` changed. Everything must pass. Fix root causes, then run the failing check again.
3. **Review:** for a feature, the `reviewer` subagent has run and its blocking findings are fixed.
4. **Docs:** update `docs/ROADMAP.md` when a feature or roadmap item is done, and any doc the change made stale (`docs/architecture.md`, a folder `CLAUDE.md`, `docs/open-questions.md`).
5. **Commit:** stage the intended files only (`git status` first: no `.env`, no reports, no stray files). Conventional Commit subject; body says what and why. End the message with the session's attribution line.
6. **Pull request:** `git push -u origin <branch>`, then `gh pr create --base main` with a body of `## Summary` (what and why, in bullets) and `## Test plan` (the checks run, as ticked boxes), ending with the session's attribution line. Then `gh pr merge <number> --auto --merge`, never squash or rebase.
7. **Report** in the format from `AGENTS.md`, in Arabic. Put the PR link under Changed, and end "Needs from you" with the cleanup line:
   `cd D:\vertex-hub; git switch main; git pull --ff-only; git branch -d <branch>`
   End with "Next step" as `AGENTS.md` requires: whether the next session needs `/clear`, its model and effort (`docs/workflow.md`), and its exact first message in a code block.

$ARGUMENTS
