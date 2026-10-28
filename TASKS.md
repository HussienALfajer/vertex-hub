# TASKS — Repository audit and handover between sessions

Owner request (2026-10-28): check that every branch is merged into `main`, the local checkout matches it and production runs it; make `TASKS.md` and everything else needed to continue a feature available to a cloud session. One PR.

- Branch: `docs/cloud-handoff`
- Stopped at: done; PR open with auto-merge

## PR 1 — Handover rules and audit notes (`docs/cloud-handoff`)
- [x] Audit: one local branch (`main`) equal to `origin/main`, no remote branches, open PRs, stashes or extra worktrees; production on `11dc9e6`, and later commits change only tests, CI and docs
- [x] `TASKS.md` as the handover note (branch, "Stopped at"), pushed after the approved plan, after each layer and before a session ends unfinished (`AGENTS.md`, `docs/workflow.md` "Continuing in another session", `/feature-slice`)
- [x] Facts only in the agent's local memory moved into the repository: release ownership and production data start (`docs/deployment.md`), the paper contract's personal data (F05C spec)
- [x] `docs/ROADMAP.md`: the 2026-10-28 deploy
- [x] documentation only, CI runs the checks; PR with auto-merge
