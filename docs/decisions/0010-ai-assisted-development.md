# 0010 — Claude Code (Opus 5.5) as the primary developer; AGENTS.md shared with Codex

Status: Accepted · Date: 2026-09-28

## Context
The system is built by the owner working with Claude Code (Opus 5.5) in the desktop app, across several Pro accounts, with Codex available as a fallback. Knowledge must survive session resets, account switches and tool switches.

## Decision
- **`AGENTS.md`** holds all shared project instructions (read directly by Codex).
- **`CLAUDE.md`** imports it with `@AGENTS.md` and adds Claude-specific guidance only. An import is used instead of a symlink because symlinks are unreliable on Windows and in git.
- Project knowledge lives in files (`docs/`), not in chat history.
- Deterministic rules are enforced with hooks and CI; `AGENTS.md`/`CLAUDE.md` hold guidance; repeatable workflows become skills.
- Work follows the feature cycle in `docs/workflow.md`.

## Consequences
- `AGENTS.md` and `CLAUDE.md` stay short (target under 200 lines combined) and are pruned when behavior shows a rule is not needed.
- Switching accounts or tools happens between tasks, not mid-task, because the prompt cache does not carry over.
