# Validation guide

This file defines repeatable checks and the meaning of their evidence. It is not a last-report/status file. Record the actual environment, commands, output/failures and pending manual checks in the active GitHub Issue or delivery response.

## Layers

| Layer | Command | What it does not prove |
| --- | --- | --- |
| Project structure | `pnpm check:repo` | Effective Codex config, installed graph or runtime security |
| Core behavior/negative paths | `pnpm test` | React rendering, Electron launch or Windows graphics |
| Full type analysis/lint | `pnpm typecheck`, `pnpm lint` | Correct product behavior on their own |
| Bundling | `pnpm build` | A signed/installed product or successful GUI launch |
| Automated built desktop | `pnpm test:desktop` | All pointer/DPI/native integrations, subjective UX or production readiness |
| Owner smoke | Steps below | Comprehensive performance/security certification |

The dependency-free test command may run in a constrained source-inspection environment using Node's type stripping. Report the actual Node version there; that is narrower than the supported Node24 + resolved TS6/Electron toolchain. Never call a TS syntax/transpile check a full semantic typecheck.

## Core cases

Continuous fractions and boundary clamping; touching edges versus overlaps; minimum-size resize; optional guide snapping; full known-widget layout serialization; malformed/oversized/unknown schema and data rejection; duplicate/out-of-range/unknown IDs; corrupt local data preserved; storage write failures reported; asset traversal and untrusted development URL rejection; pure label reconciliation idempotence and unrelated-label preservation.

Fixtures are synthetic. Tests must not read personal projects or credentials. Negative inputs are data, never executable instructions.

## Desktop smoke

Build first. The smoke launcher allocates its own `semnome-smoke-*` directory under the OS temporary root and passes a restricted test override. Never point it at the owner's actual userData. Only that generated test directory is removed afterward. Screenshot output goes to ignored `.local/diagnostics/`.

The automation checks the three regions, seven Main widgets, absence of a Node/native renderer bridge, edit cancel/save, the sample panel, theme persistence after reload and a real process-metrics sample. It must report launch or renderer failures; a screenshot alone cannot replace the assertions.

## Owner Windows smoke

Use the actual Windows setup, including the usual display scaling. Confirm text is legible in both themes and the fixed header/Bottom remain correctly separated. In normal mode try dragging a widget header and using its form/scroll content: no accidental layout movement should occur.

Enter Edit, move and resize a widget into empty space, move near an edge/centre guide, disable guides, and try Alt bypass. Try dropping over another widget: the moved widget should return, not displace unrelated ones. Cancel and verify the prior composition; repeat, Save, then restart the same runtime origin/profile and verify it persists. Try invalid JSON import and verify the prior usable layout remains.

Open the sample panel on all four sides in both Overlay and Docked. Overlay should leave underlying geometry unchanged; Docked should reserve viewport space (the minimum canvas may scroll). Test floating Overlay and the persistent reopen button. Resize the native window and verify overflow remains reachable rather than hiding widgets permanently.

Measure memory/CPU during representative interaction and repeated opens/closes; record environment and workload. There are no real web embeddings, terminal processes or plugin background workers here, so the fixture result cannot certify their future cost.

## Completion standard

Report pass/fail/blocked/not_run for each relevant layer. A missing package graph, failed compiler or unobserved Windows smoke is not a success. Do not use `--no-sandbox`, disabled webSecurity, removed type rules or skipped assertions as fixes. Continuations of the unaccepted baseline retain `0.1.0-alpha.1`; new accepted work receives a new Target Version.
