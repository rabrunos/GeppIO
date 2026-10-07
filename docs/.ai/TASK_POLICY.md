# Task policy

## Work identity

GitHub Issues are required for executable tasks after the repository exists. Reuse the relevant
Issue for discovery, implementation, failed smoke, correction and acceptance. Do not create an
Issue for every command or a parallel task/status database. The seed file is a one-time creation
recipe, not a status record. Leave the Issue open while required acceptance evidence is missing.

Every independent root mutation of tracked files receives an orchestrator-assigned target version.
Read package.json and actual HEAD first. Use `# [0.1.0-alpha.1] Title` for the initial unaccepted
foundation; prompt, implementation commit and report preserve that token. Corrective continuations
keep it. Later accepted changes receive a new SemVer target assigned by the orchestrator. Never
reuse an abandoned target for unrelated work or silently replace accepted/published bytes.
Read-only analysis, machine setup and Issue-only actions do not bump the version.

One canonical version source: package.json. The lockfile carries dependency resolution and required
package mirrors when generated; it is not a second independent version source. Changelog entries
summarize integrated effects, including internal work. Versioning and successful validation never
authorize commit, push, publication or Issue closure by themselves.

## Effort, discovery, risk and consumption are separate

| Class | Normal execution | Escalation |
| --- | --- | --- |
| E0 — deterministic command | Canonical tool; bounded Worker only when useful | Main if judgment is required |
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
explicit task override → ignored local override → project profile → standard. Report requested
and effective client settings; never invent a model option or spend API credits to enforce a tier.

Technical execution defaults to `protected_auto`: workspace-write, on-request approvals, network
enabled in the sandbox and `approvals_reviewer = "auto_review"`. Keep these defaults; do not switch to Full
Access/`never` or modify global Codex settings. Routine work inside the permitted workspace needs
no extra approval. Request bounded technical elevation for protected paths or network operations
when necessary; standing Git authorization does not remove that boundary. Verify and report the
actual client settings separately from project TOML. Do not weaken security to make a check pass.
Network access permits in-sandbox connectivity, not operations outside the writable workspace or
new task authority. Automatic review applies only to eligible technical approvals; a denial must
be reported, not bypassed. Protected path writes and other boundary crossings may still need elevation.

## Standing Git authorization — Geptor only

The owner authorizes automatic commit and push for completed, validated implementation in an
approved `rabrunos/Geptor` Issue. This standing decision supplies task-level Git authority; do not
ask for it again on each task. An explicit do-not-commit/do-not-push instruction overrides it.
An Issue or successful check alone does not create authority outside this standing scope.

Before committing, inspect branch/HEAD/status/diff, pass the required in-scope checks, review
secrets and the staged diff, and stage only approved files. Preserve unrelated work. Verify that
both origin fetch and push URLs identify `rabrunos/Geptor`, the branch is `main`, and the observed
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
ChatGPT is the normal planner. Owner-directed E0/eligible E1 work may go directly to Codex when
scope and deterministic acceptance are already resolved. Unexpected ambiguity returns to planning.

Default to no subagents. Scout reads and explains scoped evidence; Worker does bounded mechanical
work. Main integrates. No recursive fan-out, permanent reviewer or duplicate Main roles.

Use temporary roots for tests. Report commands, environment and pass/fail/blocked/not_run honestly.
Keep manual Windows smoke in its Issue until observed. Apply the standing Geptor Git authorization
and any explicit task override; report the actual result. Unknown remote outcomes block blind retries.
No deployment/upload tooling is enabled in this local prototype. No tracked last report, checkpoint
or work-state file.
