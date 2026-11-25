# Git and GitHub

GeppIO uses `rabrunos/GeppIO`, stable GitHub repository ID `1409287329`. Verify the canonical name,
ID and both origin URLs before synchronization. Use an existing clone or clone this repository on
a new machine; the foundation, Issues and lockfile already exist. Original bootstrap material is
available in Git history and Issue #1, and is not an active setup procedure.

## Automatic synchronization

For completed, validated changes within an owner-approved GeppIO task, commit and push to
verified `origin/main` automatically. The owner's standing authorization applies even when the
request does not mention Git. Do not ask again or stop after a local edit merely to offer a commit.
An explicit do-not-commit/do-not-push instruction overrides the default until the owner changes it.
Read-only work creates no empty commit.

Before integration, inspect branch, HEAD, status and relevant diffs; preserve unrelated work.
Run the required scoped checks, review secrets and the intended stage, and include the exact
assigned `[TARGET_VERSION]` in the commit subject. Verify fetch/push URLs, stable repository ID,
local `main` and expected remote ancestry before `git push origin main`. Inspect divergence or
an unknown result before continuing; never force push, discard work or blindly retry. Follow
[TASK_POLICY](../.ai/TASK_POLICY.md) for versioned intermediate deliveries under one contract.

Task authority and technical access are separate. The project retains workspace-write,
on-request automatic review and sandbox network defaults. Use bounded technical approvals when
required by the actual client; do not change global settings or bypass a rejected operation.
Record actual commit/push and exact-SHA CI evidence in the active Issue. Explain any blocker or
explicit opt-out that leaves work local. Manual acceptance, Issue closure, metadata writes,
publication and deployment require their applicable authority. No automatic Git hook is installed.

## Issues and metadata

Issues own active tasks, decisions, acceptance and evidence. Continue the relevant Issue instead
of creating a new record for each command. A compact agreement contains goal, scope, target,
acceptance, checks and authority. Planning can happen directly in Codex; see
[the workflow](../.ai/orchestration.md). No handoff template is required.

The six Issue forms remain available for Epic, Feature, Task, Bug, Investigation and Refactor.
`.github/labels.json` defines desired labels. For authorized metadata maintenance, inspect live
state, update only the requested records and preserve unrelated labels/history. Check the result
before retrying an uncertain write. No foundation-Issue creation helper or seed is needed.

## CI and acceptance

The Windows workflow installs the committed graph with `--frozen-lockfile`, runs full checks and
built Electron journeys in disposable profiles. A separate Ubuntu job checks whitespace/history
with a checksum-verified secret scanner; it does not validate the Linux desktop application.
CI does not publish packages or close Issues. Read results for the actual commit/run/jobs.

Required unobserved manual journeys remain explicit in the relevant Issue. Preserve earlier scoped
owner acceptance without expanding it to untested changes. Use related-Issue links in commits/PRs;
avoid auto-closing an unaccepted task merely because implementation was integrated.
