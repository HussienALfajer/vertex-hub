# Working method

How Vertex Hub is built with Claude Code (Opus 5.5). Based on Anthropic's guidance for Opus 5.5 and Claude Code best practices. `AGENTS.md` holds the rules agents follow; this file explains the method for the owner and for agents that need detail.

## Why it works this way

- **Context is the scarcest resource.** Every turn resends the whole conversation, and model quality drops as context fills.
- **Cost ≈ turns × context size.** The prompt cache makes re-reading cheap (cache reads cost 1/20 of fresh input) as long as it stays warm.
- **Output is ~100× the price of a cache read.** Effort level mainly controls output (thinking), so it is the main cost lever.
- **Verification enables autonomy.** With a check it can run, the agent iterates until the check passes, without supervision.
- **Knowledge lives in files, not chat.** Sessions, accounts and tools change; the repository stays.

## The feature cycle

A feature runs through separate sessions. Each session ends with a merged PR (or a finished deploy) and `/clear`, so the next one starts from files and git, not from a long conversation. Set the model and effort before the first message of each session.

| # | Session | Model and effort | First message | The owner | Ends with |
|---|---|---|---|---|---|
| 1 | Spec | Opus 5.5, `high` | `/spec <id>` | Answers the interview; approves the spec | `/ship` of the spec as a `docs/<id>-spec` PR |
| 2 | Backend PR | Opus 5.5, `high` when it adds or changes core tables, else `medium` | `/feature-slice <id>` | Approves the PR split and `TASKS.md`; may try the endpoints at `/api/docs` | `/ship` of PR 1 (contracts, db, api) |
| 3 | Web PR | Opus 5.5, `medium` | `/feature-slice <id>` | Runs the acceptance steps in the browser, in each role the spec names | `/ship` of PR 2 (web, E2E); `docs/ROADMAP.md` marks the feature done |
| 4 | Phase deploy (once per phase) | Opus 5.5, `low` | `Deploy phase <n> to production` | Approves the deploy; checks the live site | Deploy done, the phase's deploy item ticked in `docs/ROADMAP.md` |

- A small feature (about one table and one screen) does sessions 2 and 3 in one session and one PR.
- `/feature-slice` reads `TASKS.md` and continues from the first open PR, so a session can stop between PRs and a new one picks up.
- After each merge the owner runs the cleanup line from the report, then `/clear`.
- **Deploys happen at the end of a phase, not after each feature.** Merging to `main` does not deploy; the phase-deploy session runs `vertexhub-deploy` on the server after the owner approves it (`docs/deployment.md`). A hotfix for a bug in production is the exception, deployed when the owner asks.
- Inside session 2 or 3, use `/compact` between layers if the context grows, never in the middle of one.
- The "Next step" of every report names the next session: whether it needs `/clear`, its model and effort from this table, and its exact first message (`AGENTS.md`, Reporting).

Steps inside a session:

1. **Spec** (`/spec`): the agent interviews the owner about the feature from `v1-scope.md` and writes `docs/specs/<feature>.md` from `docs/specs/_template.md`: roles, data, states, API, screens, edge cases, and an end-to-end acceptance check.
2. **Plan** (`/feature-slice`, first step): the agent splits the feature into PRs and writes `TASKS.md`; the owner approves before any code.
3. **Implement** (`/feature-slice`): one layer at a time, contracts → db → api → OpenAPI → web → E2E, each followed by a check gate through the `checker` subagent. The new-module wiring checklist and the F01 files to copy from are in `.claude/skills/feature-slice/wiring.md`.
4. **Review:** the `reviewer` subagent (fresh context) checks the branch against the spec and the rules and reports blocking issues only.
5. **Accept and close:** the owner tries it in the browser, `/ship` runs the checks, opens the PR with auto-merge and updates `docs/ROADMAP.md`.

## How the instructions are layered

Each rule lives in one place and loads only when it is needed, so every turn carries the least context.

| Layer | Files | Loaded |
|---|---|---|
| Project rules | `AGENTS.md` (shared with Codex), `CLAUDE.md` (Claude-specific, imports `AGENTS.md`) | Every session |
| Folder rules | `<app or package>/CLAUDE.md`; the root `AGENTS.md` points other agents to them | When the agent reads a file in that folder |
| Decisions and specs | `docs/decisions/`, `docs/specs/`, `docs/product/v1-scope.md` | On demand, the parts the task needs |
| Workflows | `.claude/skills/`: `spec`, `feature-slice`, `db-migration`, `ship` | When invoked (`db-migration` also when a schema change is detected) |
| Subagents | `.claude/agents/`: `checker` (Haiku, runs checks and returns failures only), `reviewer` (Opus, fresh-context review) | In their own context; only their summary returns |
| Enforcement | Biome hook on every edit (`.claude/hooks/`), architecture and conventions tests, CI | Always, without costing context |
| Guard rails | `.claude/settings.json`: model and effort, permissions, reads of generated files denied | Always |

A rule that a machine can check belongs in a test or lint rule, not in prose (ADR 0013). A rule that only applies to one folder belongs in that folder's `CLAUDE.md`, not the root.

Folder rules are plain `CLAUDE.md` files rather than `AGENTS.md` files imported with `@AGENTS.md`: Claude Code reads a subfolder's `AGENTS.md` only when the owner's personal settings ask for it, and an `@` import inside a subfolder file was not expanded in practice. Codex reaches the same files through the pointer in the root `AGENTS.md`.

## Anatomy of a good request

- **Goal:** what to build.
- **Reference:** which spec file.
- **Scope:** what may change and what must not.
- **Finish line:** a checkable condition (e.g. "typecheck, lint and tests pass; RTL screenshot of the page attached").
- **Stop conditions:** only for owner decisions or destructive actions.

Don't write "think hard" or "step by step": Opus 5.5 decides how much to think; effort controls depth. Don't ask the agent to write out its internal reasoning in the reply.

## Effort and model by task

| Task | Model | Effort |
|---|---|---|
| Data model and architecture (the core schema) | Opus 5.5 | `high`, `xhigh` for the core data model |
| Spec interviews | Opus 5.5 | `high` |
| Implementing a clearly specified feature | Opus 5.5 | `medium` (`high` for a PR that adds core tables) |
| Production deploy at the end of a phase | Opus 5.5 | `low` |
| Mechanical edits (renames, translation keys, applying a pattern) | Opus 5.5 | `low` |
| Searching code, reading logs and test output | Subagent on Haiku or Sonnet | — |
| A problem that failed twice at `xhigh` | Fable 5.1, for that problem only | — |

Avoid `max` unless a gain is measured. Agent teams (~7× tokens), fast mode (2× price) and `opusplan` are not used by default.

## Session habits

1. Set model, effort and connectors at session start; don't change them mid-session.
2. Avoid pauses longer than the cache lifetime (1 hour on a subscription). Finish or wrap up a task before a long break.
3. `/clear` between unrelated tasks (`/rename` first if you may come back).
4. `/compact <what to keep>` at natural breaks; `/rewind` to abandon a failed path.
5. After two failed corrections on the same issue, `/clear` and start again with a better request.
6. Side questions: `/btw`, so they don't enter the context.
7. Disconnect connectors (MCP servers) and plugins the project does not need: each adds tool and skill descriptions to every turn. The project turns off the `ui-ux-pro-max` plugin (the visual identity is fixed in `brand/identity.md`); switch off unrelated connectors (Canva, Remotion, Hostinger) for this project in the app, and turn Hostinger DNS on only for DNS work.
8. Let the `checker` subagent run long checks, so their output never enters the main context.
9. Check `/usage` after each feature: cache share should be high; output should be small relative to the change.

## Accounts and tools

- Several Claude Pro accounts: switch accounts **between** tasks, not in the middle of one; the prompt cache does not carry over.
- Codex reads `AGENTS.md` directly and can continue work when Claude limits are reached.
- Everything needed to resume lives in `docs/`, `TASKS.md` and git history.

## References

- Getting the most out of Opus 5.5 — https://claude.dev/blog/getting-the-most-out-of-opus-5-5/
- What a task costs on Opus 5.5 — https://claude.dev/blog/what-a-task-costs-on-opus-5-5/
- Prompting Claude Opus 5.5 — https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- Claude Code memory (CLAUDE.md, AGENTS.md) — https://code.claude.com/docs/en/memory
- Claude Code costs — https://code.claude.com/docs/en/costs
