# Context routing

Read only the rows needed for the active Issue. This is a route map, not task state.

| Question | Source |
| --- | --- |
| What is the owner building? What remains provisional? | [Product requirements](../product/requirements.md) |
| Which code owns a responsibility? | [Architecture](../architecture/overview.md) |
| Continuous placement, constraints and persistence | [Layout](../architecture/layout.md), `src/shared/layout.ts`, `src/shared/storage.ts` |
| Future plugins, APIs, slots and scripts | [Plugin design boundaries](../architecture/plugins.md) |
| Native boundary or untrusted input | [Security baseline](SECURITY_BASELINE.md), [control map](../architecture/security.md) |
| Task version, effort, scope or approval | [Task policy](TASK_POLICY.md) |
| New machine or GitHub binding | [Local setup](../development/local.md), [GitHub](../development/github.md) |
| What validation proves | [Testing](../development/testing.md) |
| Rename provisional identity | [Renaming](../development/renaming.md) |
| Main/Scout/Worker settings | [Execution profiles](execution.md), `.codex/` |

The normalized [project profile](project-profile.json) contains stable policy, not progress.
Active progress, evidence, acceptance and continuations remain in the actual GitHub Issue.
