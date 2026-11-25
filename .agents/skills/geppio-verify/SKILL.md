---
name: geppio-verify
description: Select and execute scoped GeppIO checks with disposable profiles, diagnose failures and report acceptance evidence.
---

Map changed behavior to focused unit tests, typecheck, build and the appropriate desktop journey in docs/development/testing.md. Build the assets under test. On Windows use the isolated runner where supported. Serialize runs sharing desktop, native dialogs or clipboard.

Record command, arguments, platform, exit status, cleanup and what the evidence covers. Distinguish failures from unavailable prerequisites. Investigate the first failing assertion before rerunning. Keep machine diagnostics bounded and private under ignored .local/.

For integration, inspect the intended staged diff, validated branch and remote base. Report actual Git and CI results against the delivered SHA under the Issue's authority. Automatically commit and push completed, validated in-scope changes under standing authority unless the owner explicitly opts out; report an actual blocker instead of merely offering integration. Leave unobserved physical/manual acceptance pending. Implementation delivery reports use pt-BR and the exact assigned [TARGET_VERSION]. Read-only analysis reports the examined version/SHA without inventing a new target or an empty commit.
