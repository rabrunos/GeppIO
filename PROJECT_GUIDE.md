# GeppIO — Project Guide

Stable entry point for ChatGPT and repository-aware planners. This is a **materialized new
product**, not the BootCrate template. The owner's discovery/review is already normalized in
[requirements](docs/product/requirements.md) and the [profile](docs/.ai/project-profile.json).
Do not launch an intake or a setup/console application. Do not rebuild the old prototype.

## Read in this order

Read the current repository and relevant GitHub Issue. Read [orchestration](docs/.ai/orchestration.md)
and route only necessary product/code context through [CONTEXT_INDEX](docs/.ai/CONTEXT_INDEX.md).
Use [TASK_POLICY](docs/.ai/TASK_POLICY.md) for target versions, effort and authorization.
Use [SECURITY_BASELINE](docs/.ai/SECURITY_BASELINE.md) when a trust boundary changes.
`AGENTS.md` addresses implementation agents; it is not a ChatGPT Project instruction dump.

## Durable project facts

The product name is **GeppIO**, with lowercase technical namespace `geppio` (Issue #6). The canonical GitHub repository is `rabrunos/GeppIO` (GitHub repository ID `1409287329`), following the owner-initiated rename on 2026-10-08. Verify both origin URLs and the same repository identity before synchronization. The initial target is Windows and the stack is Electron,
TypeScript, React, Tailwind, Heroicons and Motion. The alpha.1 foundation has static fixtures;
alpha.2 adds an explicitly trusted local plugin runtime (Issue #21).
The fixed header is outside the widget layout. Regions are logically peers. Product choices
not explicitly closed by the owner remain labelled provisional in the specification.

`package.json` is the canonical version source; `CHANGELOG.md` is integrated product history.
The initial source baseline is `0.1.0-alpha.1`; its owner acceptance remains in Issue #1.
Issue #21 assigns the independent plugin increment `0.1.0-alpha.2`. Repairs retain their active
unaccepted target; machine setup does not itself justify a new release.

## Remote identity and one-time packaging exception

The existing repository is `rabrunos/GeppIO`; intake and GitHub binding are complete. Do not repeat them. The following paragraph describes the original pre-repository handoff only.

The owner explicitly requested a ZIP **before creating the new repository**. This is the only
pre-repository materialization exception. There is no fabricated repository URL, HEAD, Issue,
push receipt or release. After the owner creates the repository, prepare the metadata with
`tools/github-prepare.ts` under explicit authorization and use its real foundation Issue.
New executable project work requires an actual Issue; an unavailable shared record is a
blocker to report, not permission to maintain a local imitation of GitHub.

## Method provenance

The selected workflow is adapted from the owner's [BootCrate repository](https://github.com/rabrunos/BootCrate)
at commit `693679c5a2461f092537ce1bb220c7ec8c8c4957` (BootCrate v0.9), consulted on 2026-10-07.
Retained: stable entry point, normalized profile, scoped context, orchestrator/executor contracts,
Main/Scout/Worker conventions, selected skills, native versioning, GitHub forms/labels and
project-specific safety checks. Removed/not copied: Setup, Console, bootstrap question library,
raw intake, upstream product code/history, Claude adapter, publication tooling and maintenance CI.
This is a selective adaptation, not a claim of complete BootCrate certification.
