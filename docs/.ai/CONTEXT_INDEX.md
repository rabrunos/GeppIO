# Context routing

Read only the rows needed for the active Issue. This is a route map, not task state.

| Question | Source |
| --- | --- |
| What is the owner building? What remains provisional? | [Product requirements](../product/requirements.md) |
| Which code owns a responsibility? | [Architecture](../architecture/overview.md) |
| Integer grid policy, responsive projection, geometry, occupancy, reflow and persistence | [Layout](../architecture/layout.md), `src/shared/grid/`, `tests/grid-*.test.ts` |
| Grid presentation, pointer/keyboard capture and edit transactions | `src/renderer/src/grid/`, `tools/grid-smoke.ts` |
| Workbench composition, pixel splitters and Development controls | `src/renderer/src/workbench/`, `src/renderer/src/settings/`, `src/renderer/src/App.tsx` |
| Legacy fractional v1 validation and identity recovery | `src/shared/layout.ts`, `src/shared/layout-defaults.ts`, `src/shared/layout-migration.ts`, `src/main/layout-migration.ts` |
| Future plugins, APIs, slots and scripts | [Plugin design boundaries](../architecture/plugins.md) |
| Native boundary or untrusted input | [Security baseline](SECURITY_BASELINE.md), [control map](../architecture/security.md) |
| Task version, effort, scope or approval | [Task policy](TASK_POLICY.md) |
| New machine or GitHub binding | [Local setup](../development/local.md), [GitHub](../development/github.md) |
| What validation proves | [Testing](../development/testing.md) |
| Product identity and legacy profile recovery | [Identity recovery](../development/renaming.md) |
| Main/Scout/Worker settings | [Execution profiles](execution.md), `.codex/` |

The normalized [project profile](project-profile.json) contains stable policy, not progress.
Active progress, evidence, acceptance and continuations remain in the actual GitHub Issue.
