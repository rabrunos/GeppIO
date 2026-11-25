# Task policy

## Work identity

GitHub Issues are required for executable tasks after the repository exists. Reuse the relevant
Issue for discovery, implementation, failed smoke, correction and acceptance. Do not create an
Issue for every command or a parallel task/status database. Leave the Issue open while required
acceptance evidence is missing. Bootstrap recipes are retired; use the existing repository and Issues.

Assign a concrete target before tracked changes. One approved contract may span several deliveries
under one Issue. When it delegates target allocation, inspect HEAD, package version and concurrent
reservations, then record the next unused monotonically increasing target and its milestone
in that Issue before the next delivery's first tracked edit.
Read package.json and actual HEAD first. Every newly delivered batch changing application source
must advance the app version monotonically, including bug fixes and corrective continuations of
an unaccepted delivery. Files, local repairs and test iterations within the same delivery share
its target; do not bump per edit or test attempt. A later delivered source correction must not
reuse an already delivered version merely because acceptance is pending. Implementation commit and delivery report preserve the assigned `[TARGET_VERSION]` token.
An optional handoff identifies that target when applicable; no prompt or fixed prompt heading is required. The earlier corrective-target
exception applied through alpha.13; keep that historical evidence unchanged. Documentation-only
work retains the existing independent-root target policy; this source-delivery rule adds no new
documentation-only release requirement. Never reuse an abandoned target for unrelated work or
silently replace accepted/published bytes.
Read-only analysis, machine setup and Issue-only actions do not bump the version.

One canonical version source: package.json. The lockfile carries dependency resolution and required
package mirrors when generated; it is not a second independent version source. Changelog entries
summarize integrated effects, including internal work. Versioning and successful validation never
authorize commit, push, publication or Issue closure by themselves.

## External library and source adoption

[Issue #19](https://github.com/rabrunos/GeppIO/issues/19) requires individual owner approval
before deliberately adopting a new external library or copied/adapted repository implementation,
including free, nonvisual or attribution-free code. Compare existing project tools, a
no-dependency approach and suitable maintained candidates in proportion to the active task.
For visual options, present public demos and the expected behavior before adoption; for
nonvisual options, explain value, alternatives, effort saved and meaningful risks.
Check provenance, license/distribution/attribution obligations, costs/credits, telemetry and
supply-chain implications. Research/reference reading is allowed before approval; it does not
authorize copying source, installing a candidate or executing its scripts. A selected candidate
still needs a scoped implementation contract and relevant validation.

Existing chosen foundation stack is not retroactively unapproved. Transitive dependencies
receive normal lockfile/license/supply-chain review without individual approval for every node.
The owner prefers project-owned components. The earlier selection of the canonical shadcn/ui
source is historical. A proposal to incorporate a specific component follows the individual
approval process above. Preserve the scope of prior approvals when reviewing existing
dependencies. [Issue #8](https://github.com/rabrunos/GeppIO/issues/8)

## Effort, discovery, risk and consumption are separate

| Class | Normal execution | Escalation |
| --- | --- | --- |
| E0 — deterministic command | Canonical tool or a bounded validation runner | Primary if judgment is required |
| E1 — narrow resolved change | Medium only if every gate below holds; otherwise High | High on new ambiguity |
| E2 — normal implementation | Main High | XHigh for complex unresolved interactions |
| E3 — architecture, complex debugging/security | XHigh or highest verified supported equivalent | Owner input when reasoning cannot supply missing evidence |

Medium requires resolved scope/acceptance, understood stack and boundaries, reversible work,
no new architecture/service/dependency boundary, no sensitive security/secret/native-authority
change, and focused deterministic tests. File count or task length is not eligibility.
Security changes have a High minimum; consequential security design needs independent review.

Local discovery is `none`, `targeted` or `deep` and answers only blocking local questions.
Risk is `normal` or `elevated`; it does not change authorization. More reasoning is not proof.

Consumption `standard` is the project default. `economy` reduces optional delegation, redundant
research and unnecessary context, not effort eligibility, tests or controls. Precedence is
explicit task override → ignored local override → project profile → standard. Report material requested/effective client discrepancies; do not repeat configuration inventories
in every answer. Never invent a model option or spend API credits to enforce a tier.

Technical execution defaults to `protected_auto`: workspace-write, on-request approvals, network
enabled in the sandbox and `approvals_reviewer = "auto_review"`. Keep these defaults; do not switch to Full
Access/`never` or modify global Codex settings. Routine work inside the permitted workspace needs
no extra approval. Request bounded technical elevation for protected paths or network operations
when necessary; standing Git authorization does not remove that boundary. Verify and report the
actual client settings separately from project TOML. Do not weaken security to make a check pass.
Network access permits in-sandbox connectivity, not operations outside the writable workspace or
new task authority. Automatic review applies only to eligible technical approvals; a denial must
be reported, not bypassed. Protected path writes and other boundary crossings may still need elevation.

## Standing Git authorization — `rabrunos/GeppIO` only

The original standing authorization is recorded in [Issue #22](https://github.com/rabrunos/GeppIO/issues/22). Issue #6 aligns it after the owner-initiated rename to the exact same GitHub repository ID `1409287329`; it does not expand the owner, repository, branch or project scope. Verify that ID, the canonical name and both origin URLs before commit/push; an old-name redirect is insufficient.

Historical repository name: `rabrunos/Geptor` was the name used by the 2026-10-07 decision in Issue #22. That dated decision remains historical evidence; its security settings must not override current owner-approved settings.

Automatically commit and push completed, validated in-scope changes in an
approved `rabrunos/GeppIO` Issue. This standing owner instruction applies even when the request
does not mention Git; do not ask again or stop at an offer to integrate. An explicit
do-not-commit/do-not-push instruction overrides it and remains in force through continuations.
Read-only work needs no commit. Report an actual blocker that prevents synchronization.
An Issue or successful check alone does not create authority outside this standing scope.

Before committing, inspect branch/HEAD/status/diff, pass the required in-scope checks, review
secrets and the staged diff, and stage only approved files. Preserve unrelated work. Verify that
both origin fetch and push URLs identify `rabrunos/GeppIO`, the branch is `main`, and the observed
remote `main` is the expected ancestor before a normal push. Divergence or an unknown remote
outcome requires inspection, never force push or a blind retry. Do not operate on other repositories.

Commit/push integrates implementation; it does not grant owner acceptance. Keep required manual
smoke and review pending in the Issue when unobserved. Record actual checks, commit SHA, push
receipt and CI outcome in the active Issue when comments are authorized. Changes to Issue scope,
closure, publication, deployment, provisioning, purchases and unrelated actions need separate
owner authorization. No autonomous Git runner, hook, service or credential storage is introduced.

## Contracts and acceptance

Use the smallest sufficient contract: Issue, target, basis SHA when known, goal, scope/non-goals,
checks and authorized actions. Add threat boundaries/local questions only when relevant.
Codex is the primary environment for investigation, planning and implementation at any complexity.
ChatGPT remains optional support. The relevant Issue can hold the complete working agreement;
no separate prompt, fixed template or external planning stage is required. An explicit request to
implement authorizes its scope without an additional mandatory plan-approval step. Plan-only,
discussion-only and record-only requests do not authorize implementation. Resolve new questions
in the current conversation, involving the owner for consequential decisions or missing authority.
Continue through intermediate deliveries until the approved outcome is complete or genuinely blocked.

Select a bounded [project role](execution.md) for an independent task where useful. One
primary integrates. No recursive fan-out, permanent reviewer or duplicate primary roles.

Use temporary roots for tests. Report commands, environment and pass/fail/blocked/not_run honestly.
Keep manual Windows smoke in its Issue until observed. Apply the standing GeppIO Git authorization
and any explicit task override; report the actual result. Unknown remote outcomes block blind retries.
No deployment/upload tooling is enabled in this local prototype. No tracked last report, checkpoint
or work-state file. Before a transfer or context reset, record current decisions, evidence and
remaining work in the authorized Issue; preserve explicit opt-outs and distinguish local work from pushed commits.
