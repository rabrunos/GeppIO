# Context routing

Read only the rows needed for the active Issue. This is a route map, not task state.

| Question | Source |
| --- | --- |
| What is the owner building? What remains provisional? | [Product requirements](../product/requirements.md) |
| Which code owns a responsibility? | [Architecture](../architecture/overview.md) |
| Portable Windows products and selected runtime activation | [Standalone](../../src/geppio-standalone/README.md), `src/geppio-runtime/src/capabilities.ts`, `tools/standalone-smoke.ts` |
| Public web UI and basic Monaco editor in external consumers | [GeppUI](../../src/geppui/README.md), [Editor](../../src/geppio-editor/README.md), `tools/pack-web-libraries.ts`, `tools/external-libraries-smoke.ts` |
| First-party Explorer, document authority and shared Editor/Widgets navigation | [Explorer](../architecture/explorer.md), [Documents](../architecture/documents.md), `src/geppio/src/main/explorer.ts`, `src/geppio/src/renderer/src/files-editor/` |
| Single-root project, remembered clean tabs and trusted Terminal startup directory | [Workspace](../architecture/workspace.md), `src/geppio/src/main/workspace.ts`, `src/geppio/src/main/workspace-recovery.ts`, `src/geppio/src/shared/workspace.ts`, `tests/workspace.test.ts`, `tools/workspace-smoke.ts` |
| Passive fixed-file project reports and the shared Tools window | [Workspace Tools](../architecture/workspace-tools.md), `src/geppio/src/main/workspace-tools.ts`, `src/geppio/src/shared/workspace-tools.ts`, `src/geppio/src/renderer/src/workspace-tools/`, `tests/workspace-tools.test.ts`, `tools/workspace-tools-smoke.ts` |
| Search saved project text and open a verified match | [Search](../architecture/search.md), `src/geppio/src/main/search.ts`, `src/geppio/src/renderer/src/search/`, `tests/search.test.ts`, `tools/search-smoke.ts` |
| First-party Git status/diff, explicit per-file index actions, exact Explorer grant and independent Monaco comparison | [Git pilot](../architecture/git.md), `src/geppio/src/main/git.ts`, `src/geppio/src/renderer/src/git/`, `tests/git.test.ts`, `tools/git-smoke.ts` |
| Active continuous geometry, region constraints, stable projection, collision and persistence | [Layout](../architecture/layout.md), `src/geppio-runtime/src/layout/`, `src/geppio/src/shared/freeform/`, `tests/freeform-*.test.ts` |
| Freeform presentation, stable mounted content, pointer/keyboard capture and transactions | `src/geppio/src/renderer/src/freeform/`, `tools/freeform-smoke.ts` |
| Historical grid codecs, migration and algorithms (inactive placement) | `src/geppio/src/shared/grid/`, `tests/grid-*.test.ts`, `src/geppio/src/renderer/src/grid/` |
| Workbench composition, pixel splitters and Development controls | `src/geppio/src/renderer/src/workbench/`, `src/geppio/src/renderer/src/settings/`, `src/geppio/src/renderer/src/App.tsx` |
| Host widget identities, bars, compositions, workbench codec and intention history | `src/geppio/src/shared/workbench/`, `tests/workbench-model.test.ts`, `src/geppio/src/renderer/src/workbench/` |
| Fixed native window chrome (not plugin SDK) | `src/geppio/src/shared/window-controls.ts`, `src/geppio/src/main/index.ts`, `src/geppio/src/preload/index.ts`, `tests/window-controls.test.ts` |
| Legacy fractional v1 validation and identity recovery | `src/geppio/src/shared/layout.ts`, `src/geppio/src/shared/layout-defaults.ts`, `src/geppio/src/shared/layout-migration.ts`, `src/geppio/src/main/layout-migration.ts` |
| Trusted API 1/2 Worker contracts and ordinary data | [Plugin boundaries](../architecture/plugins.md) |
| API 3 custom surfaces, endpoint grants, development and isolation | [Web surfaces](../architecture/plugin-surfaces.md) |
| External folder Developer Mode, accepted generations and explicit reload/link | [Plugin boundaries](../architecture/plugins.md), `src/geppio/src/main/plugins.ts`, `tests/plugin-dev.test.ts`, `tools/plugin-dev-smoke.ts` |
| First-party signed package, offline signing, exact adoption and recovery | [Plugin package](../architecture/plugin-package.md), `src/geppio/src/main/plugin-package.ts`, `src/geppio/src/main/plugin-trust.ts`, `tests/plugin-package.test.ts`, `tools/plugin-package-smoke.ts` |
| API 2 trusted-local text surfaces, durable ordinary data and retention | [Plugin data](../architecture/plugin-data.md), `src/geppio/src/main/plugin-data.ts`, `tests/plugin-data.test.ts`, `tools/workspace-essentials-smoke.ts` |
| Native boundary or untrusted input | [Security baseline](SECURITY_BASELINE.md), [control map](../architecture/security.md) |
| Direct Codex work, context budget, continuation and optional handoff | [Workflow](orchestration.md) |
| Task version, effort, scope or approval | [Task policy](TASK_POLICY.md) |
| External code approval and UI component preference | [Task policy](TASK_POLICY.md#external-library-and-source-adoption), Issues #19 and #8 |
| New machine or GitHub binding | [Local setup](../development/local.md), [GitHub](../development/github.md) |
| What validation proves | [Testing](../development/testing.md) |
| Product identity and legacy profile recovery | [Identity recovery](../development/renaming.md) |
| Project skills, bounded auxiliary roles and technical permissions | [Execution profiles](execution.md), `.codex/` |

The normalized [project profile](project-profile.json) contains stable policy, not progress.
Active progress, evidence, acceptance and continuations remain in the actual GitHub Issue.
