# Context routing

Read only the rows needed for the active Issue. This is a route map, not task state.

| Question | Source |
| --- | --- |
| What is the owner building? What remains provisional? | [Product requirements](../product/requirements.md) |
| Which code owns a responsibility? | [Architecture](../architecture/overview.md) |
| Active continuous geometry, region constraints, stable projection, collision and persistence | [Layout](../architecture/layout.md), `src/shared/freeform/`, `tests/freeform-*.test.ts` |
| Freeform presentation, stable mounted content, pointer/keyboard capture and transactions | `src/renderer/src/freeform/`, `tools/freeform-smoke.ts` |
| Historical grid codecs, migration and algorithms (inactive placement) | `src/shared/grid/`, `tests/grid-*.test.ts`, `src/renderer/src/grid/` |
| Workbench composition, pixel splitters and Development controls | `src/renderer/src/workbench/`, `src/renderer/src/settings/`, `src/renderer/src/App.tsx` |
| Host widget identities, bars, compositions, workbench codec and intention history | `src/shared/workbench/`, `tests/workbench-model.test.ts`, `src/renderer/src/workbench/` |
| Fixed native window chrome (not plugin SDK) | `src/shared/window-controls.ts`, `src/main/index.ts`, `src/preload/index.ts`, `tests/window-controls.test.ts` |
| Legacy fractional v1 validation and identity recovery | `src/shared/layout.ts`, `src/shared/layout-defaults.ts`, `src/shared/layout-migration.ts`, `src/main/layout-migration.ts` |
| Future plugins, APIs, slots and scripts | [Plugin design boundaries](../architecture/plugins.md) |
| External folder Developer Mode, accepted generations and explicit reload/link | [Plugin boundaries](../architecture/plugins.md), `src/main/plugins.ts`, `tests/plugin-dev.test.ts`, `tools/plugin-dev-smoke.ts` |
| First-party signed package, offline signing, exact adoption and recovery | [Plugin package](../architecture/plugin-package.md), `src/main/plugin-package.ts`, `src/main/plugin-trust.ts`, `tests/plugin-package.test.ts`, `tools/plugin-package-smoke.ts` |
| API 2 trusted-local text surfaces, durable ordinary data and retention | [Plugin data](../architecture/plugin-data.md), `src/main/plugin-data.ts`, `tests/plugin-data.test.ts`, `tools/workspace-essentials-smoke.ts` |
| Native boundary or untrusted input | [Security baseline](SECURITY_BASELINE.md), [control map](../architecture/security.md) |
| Task version, effort, scope or approval | [Task policy](TASK_POLICY.md) |
| New library/copied external code approval; selected shadcn/ui source | [Task policy](TASK_POLICY.md#external-library-and-source-adoption), Issues #19 and #8 |
| New machine or GitHub binding | [Local setup](../development/local.md), [GitHub](../development/github.md) |
| What validation proves | [Testing](../development/testing.md) |
| Product identity and legacy profile recovery | [Identity recovery](../development/renaming.md) |
| Main/Scout/Worker settings | [Execution profiles](execution.md), `.codex/` |

The normalized [project profile](project-profile.json) contains stable policy, not progress.
Active progress, evidence, acceptance and continuations remain in the actual GitHub Issue.
