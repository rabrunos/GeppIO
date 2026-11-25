# GeppIO — Project Guide

GeppIO is a local Electron workbench. Read the [requirements](docs/product/requirements.md)
and the [project profile](docs/.ai/project-profile.json) for product scope and supported targets.

## Read in this order

Read the current repository and relevant GitHub Issue. Read [orchestration](docs/.ai/orchestration.md)
and route only necessary product/code context through [CONTEXT_INDEX](docs/.ai/CONTEXT_INDEX.md).
Use [TASK_POLICY](docs/.ai/TASK_POLICY.md) for target versions, effort and authorization.
Use [SECURITY_BASELINE](docs/.ai/SECURITY_BASELINE.md) when a trust boundary changes.
`AGENTS.md` addresses implementation agents; it is not a ChatGPT Project instruction dump.

When the owner approves implementation, follow [orchestration](docs/.ai/orchestration.md):
load the applicable prompt template before preparing the handoff. For ordinary implementation,
use [EXECUTION](docs/.ai/prompts/EXECUTION.md) and automatically deliver a complete, copy-ready
Codex contract when no direct executor call is available. An Issue or task summary does not replace
that handoff. Discussion-only and record-only requests do not launch implementation.
These repository instructions do not update ChatGPT website Project Instructions; that is a
separate configuration surface.

## Durable project facts

The product name is **GeppIO**, technical namespace `geppio` (Issue #6).
The full Windows x64 workbench integrates native Terminal, Git, Explorer and Monaco.
Use [architecture](docs/architecture/overview.md) for module ownership, [layout](docs/architecture/layout.md)
for region and projection rules, and [plugins](docs/architecture/plugins.md) for native and
plugin trust boundaries. Historical fixture behavior, optional community identity and Linux
direction are documented in [requirements](docs/product/requirements.md).

The owner prefers project-owned UI components. Issue #8 records the earlier selection of
shadcn/ui and the later review of that decision. Any proposed use of shadcn/ui or other
new external code needs individual owner approval under Issue #19 and
[TASK_POLICY](docs/.ai/TASK_POLICY.md).

`package.json` is the canonical version source; `CHANGELOG.md` is integrated product history.
Each delivered application-source batch advances the version, including corrections pending
acceptance. Local repair/test iterations share the batch target. Machine setup does not bump it.

## Remote identity and one-time packaging exception

The existing repository is `rabrunos/GeppIO`, ID `1409287329`. On continuation, recover unfinished scope and the assigned target from the same Issue.

The owner explicitly requested a ZIP **before creating the new repository**. This was the only
pre-repository materialization exception. There is no fabricated repository URL, HEAD, Issue,
push receipt or release in that original handoff. Repository binding and materialization are
now complete; do not run `tools/github-prepare.ts` or the first-run template merely to resume work.
New executable project work requires an actual Issue; an unavailable shared record is a
blocker to report, not permission to maintain a local imitation of GitHub.

## Method provenance

The original foundation drew on the owner's [BootCrate v0.9 source](https://github.com/rabrunos/BootCrate/tree/693679c5a2461f092537ce1bb220c7ec8c8c4957). The active GeppIO contract, project skills and bounded roles are maintained in this repository.
