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

Continuous fractions and boundary clamping; touching edges versus overlaps; all eight directional resizes with opposite-edge anchors, minima/maxima and allowed axes; deterministic bounded collision chains and constrained adaptive shrinking; mixed fixed-size/eligible widgets, impossible compositions, pointer reversal, stable ordering and immutable inputs; optional guide snapping; full known-widget layout serialization; malformed/oversized/unknown schema and data rejection; duplicate/out-of-range/unknown IDs; corrupt local data preserved; storage write failures reported; asset traversal and untrusted development URL rejection; pure label reconciliation idempotence and unrelated-label preservation.

Fixtures are synthetic. Tests must not read personal projects or credentials. Negative inputs are data, never executable instructions.

## Desktop smoke

Build first. The smoke launcher allocates its own `geppio-smoke-*` directory under the OS temporary root and passes a restricted test override. Never point it at the owner's actual userData. Only that generated test directory is removed afterward. Screenshot output goes to ignored `.local/diagnostics/`.

The automation checks the three regions, seven Main widgets, absence of renderer Node globals,
the fixed bridge shape, edit cancel/save, the sample panel, theme persistence after reload and a
real process-metrics sample. It must report launch or renderer failures; a screenshot alone cannot
replace the assertions.

For alpha.6 / Issue #16, `tools/layout-smoke.ts` adds real pointer assertions before plugin smoke,
using validated imported fixture compositions in the same disposable profile. It exercises all eight
resize zones in both themes (outward/inward drags, anchored opposite edges, cursors/labels), keyboard
move/resize, live displacement and adaptive resizing before pointer-up, reversal, Escape, pointer
cancel/lost capture, Save/Cancel/reload, v1 compatibility, invalid import, corrupt-byte preservation
and normal-mode form/scroll interactions. Cancellation events include a synthetic pointercancel and
actual capture release; physical mouse interruption and Windows DPI/UX remain owner acceptance.
The launcher records observed `devicePixelRatio`; do not infer a second display-scale test from it.
After a build, `node --experimental-strip-types tools/desktop-smoke.ts --scale125` repeats the
interaction and plugin assertions with Chromium's explicit 1.25 device-scale override. This is
automated scale coverage, not proof of the physical Windows display setting or owner mouse UX.

The alpha.6 corrective continuation adds projection-based 10 CSS-pixel separation at several canvas
sizes, same-axis fixed-opposite neighbour compression even when lateral space exists, local forward
chains/order, fixed-axis fallbacks, deterministic reversal, resize edge/centre/size/clearance snap
and old v1 loading/preview normalization without writes. Desktop assertions test resize guides on
all eight zones in both themes with Alt and the checkbox disabled, actual gap-valid geometry during
gestures, South/East neighbour priority, touching legacy Save/Cancel and recoverable impossible-gap
warning/Save rejection. These assertions distinguish a technically working control from the owner's
required layout response. Motion polish remains deferred and is not a success criterion here.

For alpha.2, build the independent examples first with `pnpm plugins:build` (`pnpm check` includes
this). Desktop smoke also installs through Settings/native directory selection in its disposable
profile, exercises the counter and zero-widget pulse, repeated activate/dispose, malformed/duplicate
packages, missing/import-failing modules, plugin exceptions and activation hangs. It restarts the
full Electron process with that same test profile to verify installation, enable/disable and removal
persistence. The worker/renderer checks assert no Node globals or Worker management bridge. None of
these tests touch the owner's installed packages. Unit tests cover bounded package validation,
corrupt state preservation, immutable snapshots, rollback, lifecycle timeout and message floods.
`pnpm test:desktop:dev` repeats this smoke with built Main/preload and a Vite renderer loaded from
the project configuration on the exact loopback origin, validating local protocol module imports
and development CSP/CORS. It does not certify every HMR or electron-vite launcher behavior.

## Owner plugin smoke (Issue #21)

Issue #6 adds a preceding Chromium identity-migration smoke to both desktop commands. It seeds
only disposable old/new profiles, checks layout/theme transfer, retained plugin IDs/revisions/
enabled flags, unchanged original/backup bytes, repeat launches, existing/corrupt destination
preservation and rejected legacy/recovery URLs. See [identity recovery](renaming.md) for backup,
rollback and migration-specific Windows acceptance. #6 does not accept #21 or #1.

Generate the examples and build/preview the app. In Settings > Plugins install each generated folder;
confirm disabled status and no widget before activation. Activate the counter, close Settings and
click Incrementar twice. Activate pulse and confirm advancing status/events with zero widgets.
Disable/re-enable both repeatedly: counter resets, widgets disappear on disable, and pulse records
timer cleanup. Restart the same app origin/profile with one disabled; confirm preferences and only
the enabled contribution. Remove both and restart; confirm no installation/widgets remain. Check
Settings keyboard/Escape/focus, scrolling and both themes at the usual Windows DPI. Use disposable
test packages for duplicate IDs, malformed manifests and exceptions; never install unknown code.
Record owner acceptance in #21; automated Windows smoke does not substitute that UX acceptance.

## Owner Windows smoke

Use the actual Windows setup, including the usual display scaling. Confirm text is legible in both themes and the fixed header/Bottom remain correctly separated. In normal mode try dragging a widget header and using its form/scroll content: no accidental layout movement should occur.

Enter Edit, move and resize a widget into empty space, move near an edge/centre guide, disable guides, and try Alt bypass. In alpha.6, move into a neighbour and watch it move during the drag; make a chain, then reverse the pointer to verify that positions/sizes return without accumulated drift. Grow a widget into a crowded area: eligible neighbours may shrink within their minima. An impossible attempt must show a warning while keeping a valid preview, with no overlap, hidden widget or canvas growth. Cancel restores the entire saved composition; repeat, Save, then restart the same runtime origin/profile and verify it persists. Try invalid JSON import and verify the prior usable layout remains. The original alpha.1 collision-rejection behavior and its historical Issue #1 evidence remain historical; alpha.6 changes the intended collision behavior under #16/#10.

Test all four borders and four corners: contextual cursors only in Edit, no resize icon, opposite
edges anchored, side-only gestures changing only one dimension, corners winning their hit zones,
limits enforced and the grip unaffected. Tab to an edge/corner, use arrows and Shift+arrows, then
focus the title to verify arrow movement remains distinct. During a colliding gesture press Escape
or interrupt pointer capture: the entire prior draft must return while Edit remains available.
Escape afterward cancels Edit. Repeat in both themes at 100% and the usual non-100% Windows display
scale, including a small window with reachable scrolling and form typing/selection in normal mode.
Use a disposable test profile; never substitute the owner's saved composition as test data. Record
physical display scale, mouse observations and owner visual acceptance in Issue #16; automated
Electron assertions do not supply that acceptance.

For the corrective retest, use two vertically stacked widgets with shrink slack and free lateral
space. Grow the upper widget downward: the lower widget must keep its column/width and bottom while
its top moves downward and its height reduces. Repeat upward/left/right and with corners; at minima,
local push or a clear blocked result is acceptable. During a move, paired/stacked neighbours should
push nearby without exchanging distant rows or columns. Verify the provisional 10 CSS-pixel interval
on shared horizontal/vertical projections, including canvas boundaries; corner-only contact is the
documented diagonal exception. Match the size of a widget in another column/row using resize guides,
then disable guides or hold Alt and verify continuous unsnapped size changes and fixed opposite edges.
Load an old touching-edge layout: normal mode must preserve it. Edit may normalize spacing only in
the preview; Cancel must restore the old composition/bytes, and Save may persist only a spaced layout.
If normalization cannot fit, the warning and blocked Save must be recoverable by reducing widgets
or Cancel. Repeat in both themes, 100%/usual physical scale and a small scrolling window. The prior
7/7 functional checklist is not visual acceptance; the owner rejected alpha.6 and must retest.

Open the sample panel on all four sides in both Overlay and Docked. Overlay should leave underlying geometry unchanged; Docked should reserve viewport space (the minimum canvas may scroll). Test floating Overlay and the persistent reopen button. Resize the native window and verify overflow remains reachable rather than hiding widgets permanently.

Measure memory/CPU during representative interaction and repeated opens/closes; record environment
and workload. Alpha.2 has real Workers for trusted test logic, but no web embeddings or terminal
processes. A fixture/sample result cannot certify future plugin costs or OS resource isolation.

## Completion standard

Report pass/fail/blocked/not_run for each relevant layer. A missing package graph, failed compiler or unobserved Windows smoke is not a success. Do not use `--no-sandbox`, disabled webSecurity, removed type rules or skipped assertions as fixes. Continuations of the unaccepted baseline retain `0.1.0-alpha.1`; new accepted work receives a new Target Version.
