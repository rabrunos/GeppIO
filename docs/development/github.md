# Git and GitHub handoff

This archive is source for a new repository. It includes no `.git`, remote, credentials, commits, live labels or Issue IDs. The owner creates/binds the actual repository. Public/private visibility and permanent repository name remain owner choices.

## Local history

Extract into an empty directory, validate/install the real dependency graph first, then initialize:

```powershell
git init -b main
git status --short
```

Inspect files, generated `pnpm-lock.yaml` and validation before staging. A suitable first commit subject is `[0.1.0-alpha.1] Materialize semnome foundation`. For the materialized Geptor checkout, apply the standing synchronization policy below and any explicit task override. No tool in this package creates the remote or authorizes publication.

Create an empty repository through the owner's preferred GitHub interface. Bind its exact URL as origin. Do not assume that the final remote must literally be `semnome` or owned by a particular account; use the actual identity. Keep unknown remote details out of tracked fake configuration.

## Standing synchronization (Geptor only)

The owner authorizes commit and push by default after an approved Geptor implementation is complete
and its required in-scope checks pass. Explicit do-not-commit/do-not-push instructions override this
decision. Inspect and preserve local work, review secrets and the intended stage, and retain the
assigned `[TARGET_VERSION]` in the commit subject. Verify both origin fetch/push URLs resolve to
`rabrunos/Geptor`, the local branch is `main`, and remote `main` is the expected ancestor before
`git push origin main`. Stop to inspect divergence or an unknown result; never force push or blindly
retry. Do not modify or perform Git operations in BootCrate or another repository.

This is task-level authorization, not a sandbox exception: workspace-write/on-request automatic
review and sandbox network enabled are the project defaults. Routine workspace work needs no extra
prompt; protected `.git` writes or network restrictions still imposed by the client may require
bounded technical approval. A project setting is not proof of the current runtime's network policy.
Record actual commit/push and CI evidence in the active Issue when comments are authorized. Manual
acceptance, Issue closure, metadata writes, publication and deployment remain separate permissions.
No hook, background Git automation, runtime dependency or global Codex setting is added.

## Reconcile metadata deliberately

`.github/labels.json` is the single desired-label definition. JSON is used instead of upstream YAML so this project's Node tool can read it without an extra parser dependency. Unrelated live labels are preserved.

Preview the intended operation without any GitHub API calls:

```powershell
node --experimental-strip-types tools/github-prepare.ts --repo OWNER/REPOSITORY
```

Direct Node invocation avoids pnpm 11's automatic dependency-install preflight. After reviewing the plan, authenticating GitHub CLI through its own credential mechanism and verifying origin, authorize these metadata writes:

```powershell
node --experimental-strip-types tools/github-prepare.ts --repo OWNER/REPOSITORY --apply
```

This reconciles selected labels and creates one marked foundation-validation Issue if absent. The tool checks origin and remote identity, validates label results and searches open/closed Issues for the marker. It does not create a repository, change protection/visibility, push, close Issues or publish. Ambiguous/failed remote outcomes require inspection before retrying; never infer failure means no write happened. The dry run is a local plan, not proof of the live state.

The seed under `.github/seed/` is an immutable creation recipe, not another backlog or progress store. Once the actual Issue exists, keep continuations, evidence, pending Windows smoke and acceptance there. Do not update the seed to simulate Issue status.

## Issue forms and task contract

Epic, Feature, Task, Bug, Investigation and Refactor forms are included. No release form/publisher is needed for the present local-only product. Task also covers tooling; do not create a new workflow type for each capability.

A changing task has a Target Version and relevant Issue. A small task needs only resolved goal, scope, version, checks and authorized actions. A complex trust-boundary change needs deeper evidence and review. Use [orchestration](../.ai/orchestration.md) and [task policy](../.ai/TASK_POLICY.md); do not fill every optional section merely to satisfy bureaucracy.

## CI and acceptance

The Windows workflow performs frozen-lock installation, full checks and an isolated Electron smoke. A separate read-only secret scan uses a checksum-verified scanner. It does not publish packages, close Issues or spend model API credits. The lockfile must be generated/committed before this CI can pass.

CI files in a ZIP are not a passed run. Required manual journeys (DPI, real drag/drop responsiveness, appearance and owner acceptance) stay open in the Issue until actually observed. Use related-Issue links in PRs; avoid auto-closing an unaccepted task just because a PR merged.
