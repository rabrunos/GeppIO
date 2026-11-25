# GeppIO — Project Guide

GeppIO is a modular Electron workbench, Windows first. The repository is
`rabrunos/GeppIO`, stable GitHub ID `1409287329`.

## Start with the task

Codex is the primary environment for discussion, investigation, planning, implementation and
validation. ChatGPT remains optional support for research, design, review and requested handoffs.
Work directly from the owner's request and the relevant Issue; no external planning stage or
prompt template is required. Discussion, plan-only and record-only requests retain their scope.

Read [AGENTS.md](AGENTS.md) for durable working rules and the relevant Issue for the active
goal, assigned target and remaining acceptance. Route further reading through
[CONTEXT_INDEX](docs/.ai/CONTEXT_INDEX.md). Reuse relevant evidence already checked in the session;
refresh it when the checkout, remote state or task changes. Verify the actual local checkout before edits.

| Need | Source |
| --- | --- |
| Direct work, planning, context budget and optional transfers | [Workflow](docs/.ai/orchestration.md) |
| Versions, execution authority and external adoption | [Task policy](docs/.ai/TASK_POLICY.md) |
| Product requirements and unresolved design | [Requirements](docs/product/requirements.md) |
| Module ownership and public boundaries | [Architecture](docs/architecture/overview.md) |
| Commands, setup and validation | [Local development](docs/development/local.md), [testing](docs/development/testing.md) |
| Skills, auxiliary roles and requested client settings | [Execution](docs/.ai/execution.md) |
| Trust-boundary changes | [Security baseline](docs/.ai/SECURITY_BASELINE.md) |

## Delivery and continuity

Issues own active scope, decisions, acceptance and evidence. A continuation retrieves the same
Issue and unfinished work; an intermediate delivery does not end the approved contract.
`package.json` is the canonical version source; `CHANGELOG.md` is integrated history. Follow
TASK_POLICY for concrete target allocation, local iterations and subsequent deliveries.

Completed, validated in-scope changes are committed and pushed automatically to verified
`origin/main` under the owner's standing authorization, unless the owner explicitly opts out.
Report any actual integration blocker. Publication and Issue closure require separate authority.

The owner prefers project-owned UI components. Proposed external libraries or adapted source
follow the individual approval gate in TASK_POLICY and Issue #19; Issue #8 retains the visual history.
Repository guidance does not update ChatGPT Project Instructions or prove effective client settings.

The repository and its foundation already exist. Bootstrap and mandatory handoff templates are
retired; original foundation provenance remains in Git history and [Issue #1](https://github.com/rabrunos/GeppIO/issues/1).
