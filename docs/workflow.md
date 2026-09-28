# Working method

How Vertex Hub is built with Claude Code (Opus 5.5). Based on Anthropic's guidance for Opus 5.5 and Claude Code best practices. `AGENTS.md` holds the rules agents follow; this file explains the method for the owner and for agents that need detail.

## Why it works this way

- **Context is the scarcest resource.** Every turn resends the whole conversation, and model quality drops as context fills.
- **Cost ≈ turns × context size.** The prompt cache makes re-reading cheap (cache reads cost 1/20 of fresh input) as long as it stays warm.
- **Output is ~100× the price of a cache read.** Effort level mainly controls output (thinking), so it is the main cost lever.
- **Verification enables autonomy.** With a check it can run, the agent iterates until the check passes, without supervision.
- **Knowledge lives in files, not chat.** Sessions, accounts and tools change; the repository stays.

## The feature cycle

1. **Spec** (new session, effort `high`): the agent interviews the owner about the feature from `v1-scope.md` and writes `docs/specs/<feature>.md`: screens, fields, states, rules, out of scope, and an end-to-end verification step.
2. **Plan** (new session, plan mode): the agent reads the spec and the relevant ADRs and proposes a plan; the owner reviews it. Skip for changes describable in one sentence.
3. **Implement** (same session, effort `medium`): one complete request with a clear finish line; the agent keeps `TASKS.md` updated.
4. **Review:** a fresh-context subagent (or `/code-review`) checks the diff against the spec and reports blocking issues only.
5. **Close:** the owner tries it in the browser, the PR is merged after CI passes, `docs/ROADMAP.md` is updated, then `/clear`.

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
| Implementing a clearly specified feature | Opus 5.5 | `medium` |
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
7. Disconnect connectors (MCP servers) the project does not need.
8. Check `/usage` after each feature: cache share should be high; output should be small relative to the change.

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
