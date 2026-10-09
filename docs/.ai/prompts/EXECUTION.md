# Execution contract template

Load this template before preparing an approved implementation handoff. Replace every placeholder
with task-specific content; do not deliver this instruction sheet as the contract. Keep detail
proportional to the task and inherit canonical policies instead of reproducing them.
Use one root contract per Target Version, including for separately sequenced work.

```text
# [TARGET_VERSION] Bounded task title

Repository: canonical owner/name and stable ID.
Issue: real Issue URL. Target Version: assigned version; identify an unaccepted continuation if applicable.
Observed basis: package version and repository-basis SHA, or explicitly unavailable evidence.
Execution: E-class / requested Main effort, risk, discovery and consumption; report effective client settings separately.

Goal: exact intended outcome.
Scope: relevant files/behaviors and task-specific implementation steps.
Non-goals: explicit exclusions and boundaries to preserve.

Context and preflight: read PROJECT_GUIDE.md, AGENTS.md, the active Issue and docs/.ai/TASK_POLICY.md;
route only needed context through docs/.ai/CONTEXT_INDEX.md. List additional task-specific sources.
Verify actual local branch/HEAD/status/diffs/version and unfinished work before edits; preserve unrelated work.
The observed remote basis is evidence, not a claim about the checkout. Do not restart intake.

Acceptance: concrete observable criteria for this task.
Validation: exact relevant commands, disposable-profile desktop checks where applicable, and any manual smoke.
Include profile/schema/document consistency when relevant, diff --check, intended staged-diff and secret reviews.
Report passed/failed/blocked/not_run and the limits of each result; specify unresolved questions or “none”.

Authority: inherit standing GeppIO Git authorization and technical approval boundaries from TASK_POLICY;
state explicit task overrides, including any do-not-commit/do-not-push instruction.
Issue actions: list authorized comments/metadata/closure actions; unspecified actions have no new authorization.
No force push, unrelated repository work, deployment, publication or Issue closure without separate authority.

Delivery: implement and validate the bounded scope, apply authorized Git actions after required checks,
and record actual Git/CI evidence in the Issue when comments are authorized. Report in pt-BR with an H1
beginning # [TARGET_VERSION], changes, actual checks, commit/push/CI results, remaining uncertainties and
requested versus effective Codex settings. Integration does not replace owner/manual acceptance.
```

## Pre-delivery completeness review

Before sending, verify that the contract has a populated versioned H1, repository/Issue/basis,
execution settings, goal, bounded actions/non-goals, context/preflight, observable acceptance,
exact validation, Git/Issue authority and delivery requirements. Explicitly label unavailable
evidence and nonblocking uncertainty; resolve or report blocking gaps before executor launch.
No unexplained placeholders, guessed receipts or summary-only handoff are acceptable.
Confirm that inherited policies are available in the target repository, versions are independently
identified, and the contract reflects the owner's actual approval, including explicit restrictions.

Follow [orchestration](../orchestration.md) for delivery: if no direct executor call is available,
automatically give the owner the entire populated contract in a copy-ready fenced text block.
Writing an Issue, providing a link or offering the prompt later does not complete the handoff.
