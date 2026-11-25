# Direct development workflow

Codex is the primary workspace for `rabrunos/GeppIO` investigation, planning, implementation and validation.
ChatGPT can provide research, design discussion, review or a requested handoff. The owner can
choose another available environment for an authorized task; the same scope and validation apply.

## From request to delivery

1. Establish the requested outcome and intent. Discussion, plan-only and record-only requests do
   not launch implementation. An explicit implementation request already authorizes its stated
   scope; do not add a mandatory approval of a plan or require a separate ChatGPT conversation.
2. Read PROJECT_GUIDE, applicable AGENTS and the relevant Issue. Inspect the actual checkout,
   branch, HEAD, status, diffs and version before edits. Route additional files through
   [CONTEXT_INDEX](CONTEXT_INDEX.md); GitHub code is remote evidence, not a substitute for local state.
3. Use a proportionate plan when ambiguity or multiple boundaries warrant one. Plan mode can
   support that discussion in Codex. Resolve ordinary engineering choices; ask the owner only
   for consequential product decisions, missing authority or evidence that cannot be recovered.
4. Keep the working agreement in the Issue: goal, scope, assigned target, acceptance, validation
   and authority. An existing approved contract is sufficient. Allocate targets under
   [TASK_POLICY](TASK_POLICY.md) before tracked changes; retain one Issue across its deliveries.
5. Implement and validate the authorized outcome. Use relevant skills and bounded auxiliary roles
   where independent work helps. Review actual behavior and the intended diff. Fix relevant
   failures and continue through intermediate milestones without asking for the same authority again.
6. Automatically commit and push completed, validated in-scope changes unless the owner explicitly
   says not to. Apply the canonical repository and remote checks in TASK_POLICY; record the exact
   SHA, checks and CI outcome. An actual technical or integration blocker is reported with the
   remaining work. Integration does not establish manual acceptance or authorize Issue closure.

## Context and continuity

Use local source for code discovery, and remote reads for Issues, decisions and synchronization.
Reuse verified session evidence while it remains relevant; refresh on changed files, a different
checkout, new remote commits or conflicting information. Pre-edit and pre-integration Git checks
remain necessary. Avoid making two assistants independently read the same entire repository.

Keep durable rules in AGENTS, domain facts in their technical documents and repeatable procedures
in skills. Load only relevant skills/references. Search narrowly first, expand when evidence needs it,
and return concise findings with file/symbol references. Delegate bounded questions rather than a
second complete audit. Select checks for the changed behavior and required gates; do not repeat
successful checks without a changed input, failure hypothesis or required delivery gate.

Before a context reset or session transfer, update the authorized Issue with decisions, completed
work, actual checks, pending work and the current version/SHA. Record uncommitted work as such;
do not imply it is backed up remotely. On resumption, verify the checkout and recover the remaining
scope. Compaction or a new conversation does not cancel the owner's explicit Git opt-out or other
constraints. Do not create a tracked STATUS, ROADMAP, checkpoint or last-report copy of Issue state.

## Optional transfer

Generate a prompt when the owner asks for one or an actual transfer requires it. Include enough
context to act: the goal, Issue link, assigned target if applicable, observed basis, pending work,
material constraints and authorized actions. Link canonical rules instead of repeating them.
There is no required template, fixed heading or extra prompt artifact. Reading or discussing an
Issue does not by itself authorize edits. Repository guidance and ChatGPT Project Instructions
are separate configuration surfaces.

## Fresh-conversation acceptance

Observe behavior in a fresh task and record the environment and actual outcome in the Issue.
These scenarios are a specification, not proof that a particular client has executed them.

| Owner request | Expected behavior |
| --- | --- |
| Continue an existing task | Inspect current checkout/Issue and recover remaining scope and authority. |
| Plan or discuss only | Investigate and explain the approach without implementing or writing remote records outside that request. |
| Implement a defined change | Proceed in the available authorized environment without mandatory external planning or a handoff prompt. |
| Finish a validated delivery | Commit and push automatically within standing authority, unless an explicit opt-out or real blocker applies. |
| Implement but do not commit/push | Preserve that opt-out through continuations and report the local-only result. |
| Request a prompt for another session | Produce a concise usable transfer based on current evidence. |

Static checks prove file/configuration consistency, not model behavior, effective permissions or
physical Windows UX. Keep those evidence categories separate. Report results to the owner in pt-BR;
technical repository guidance is English. No new model API calls, background agent, hooks or
publishing service are part of this workflow.

## Reference principles

[Codex best practices](https://learn.chatgpt.com/guides/best-practices) and
[Claude Code best practices](https://code.claude.com/docs/en/best-practices) support concise durable
instructions, task-specific context and observable validation. These are design references;
GeppIO uses its existing Codex settings and tools, not another framework or client configuration.
