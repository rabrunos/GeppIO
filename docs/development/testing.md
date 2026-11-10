# Validation guide

## Current baseline and evidence boundaries

This guide describes repeatable checks and their scope, not current task status or an execution
receipt. The workbench behavior integrated in alpha.13/alpha.14 uses continuous geometry, a host
catalog and Main-only manifest-v1 contributions. Read [package.json](../../package.json) for the
current version/command chain and [layout](../architecture/layout.md) for current contracts.
An independent documentation increment does not imply new application behavior or fresh UX acceptance.

The fixed baseline [fcb9eef](https://github.com/rabrunos/GeppIO/commit/fcb9eefa20e1f509fc8dddcd3ed7d29941edb5eb)
(alpha.14) has [CI 41348463299](https://github.com/rabrunos/GeppIO/actions/runs/41348463299) success:
Windows ran frozen installation, structure/types/lint, 166 core tests, examples/build and the built
desktop chain; the Ubuntu secrets job ran whitespace/Gitleaks, not the Linux application.
The 166 count belongs to that SHA's core tests and is not a total of desktop scenarios or a claim
that checks were rerun for the documentation task. Read later task/commit CI separately.
Local DEV/scale125 reports and intermediate failures are documented in
[Issue 2's alpha.14 receipt](https://github.com/rabrunos/GeppIO/issues/2#issuecomment-6563687364),
including focused final runs and an extra 125% attempt without a successful drop. Do not describe
all observations as one entirely clean final extra scale125 run or infer an unconfirmed root cause.

Normal alpha.20 profiles start with empty Main/Sidebar/Bottom and offer installed-plugin widgets.
`tools/demo-retirement-smoke.ts` exercises normal fresh startup, an alpha.19 envelope with an
installed Counter, unchanged startup bytes, restart, saved-composition restoration and explicit
reset while retaining plugins/custom bars/compositions. It is part of `pnpm test:desktop`.
The geometry suites explicitly opt into `GEPPIO_TEST_DEMO_WIDGETS=1`, which Main passes as a
read-only preload flag only for an unpackaged app with a validated disposable test profile.
Neither normal storage nor a packaged app enables these fixtures. Shared test factories live
under `tests/fixtures/`. Four-edge Docked and anchored/free Floating coverage remains in the
presentation suites at both scales. These test contexts retain seven synthetic types in
four Main/two Sidebar/one Bottom placements. They are not
an editor, filesystem project, Git, terminal or telemetry. Native window maximize is not widget
maximize; a visual project name/profile is not a native project/account. Normal individual movement
is protected, but paired dividers have a dedicated normal-mode transaction. Save editing advances a
checkpoint; Cancel restores it and Conclude validates/commits/exits. History is session memory,
not a durable backup. Plugin-owned data is separate from layout/installation state.

`pnpm test:essentials` also exercises the real notes/checklist/prompts in Bottom:
selection, selectable previews, checklist writes, region transfer with identical
view/model IDs, scratch refusal, restart, both themes, narrow width and minimum
height. For a mouse walkthrough, enter Edit, click an existing widget's move grip,
choose Inferior and Conclude. Select a saved note/prompt or mark a checklist item.
Use the same grip to return to Principal/Lateral for text editing. Shrink Bottom
with its splitter and switch themes; use existing recovery when width is infeasible.

The owner's alpha.14 Aprovado response is conversation-only acceptance of that specific delivery,
not a new physical test checklist or global acceptance. Historical scoped owner reports in
Issues 1, 6 and 21 remain valid within their recorded scope. Do not ask for them automatically again.
P12 paused appearance and M07 post-drop outline remain review items; P19's incompatible membership
is preserved in recovery but not removable in that selector state, as recorded. M09 seamless and
native paused-plugin Bottom scenarios cannot be certified with the existing card/Main-only fixtures.
Evidence and remaining decisions belong in the live Issues, not a tracked last-report file.

## Layers

`pnpm test:alignment` and `pnpm test:alignment --scale125` exercise real Main
mouse drag, snap entry/release, cancel/drop clearing, both themes and undo/restart
with installed Workspace Essentials. Core alignment cases cover edges/centers,
hysteresis/ties, dimensions, clearance, rejected snap fallback and narrow bounds.
Mouse walkthrough: enter Edit, drag a Main move grip toward a peer edge or center,
observe the guide, move more than 14 CSS pixels away to release it, then drop and
Save/Conclude. Cancel/Escape removes the guide and restores the gesture baseline.

`pnpm test:maximize` (also in desktop) checks real Workspace Essentials with a
disposable Windows profile: exact saved layout bytes and same-viewport geometry,
retained mounted content/Workers, native resize during maximize, automatic Edit
restore, ineligible timer/regions, collapse/reopen of peer regions and owner
unavailability. `pnpm test:maximize --scale125` explicitly repeats at automated
DPR 1.25; physical Windows DPI and owner acceptance remain separate.
Alpha.31 also observes intermediate native frame dimensions and Main-only blur
through RAF samples tied to the presentation phase, checking reverse restore,
sharp content, visible/inert peers, both themes, reduced motion and fast keyboard
interruption. The observer waits for the actual expanded/restored state rather
than a screenshot delay. Layout bytes, mount proofs and Worker identities remain
independent assertions.

`node --experimental-strip-types tools/desktop-smoke.ts --native-resize-only`
isolates the existing real window-size/maximize/restore conversion checks in a
disposable profile. The ordinary desktop path still runs every scenario. A
conversion failure records requested sizes, before/after native content sizes,
actual CSS viewport/DPR, native scale/zoom and window state in ignored diagnostics;
it does not relax the original conversion tolerance or alter product behavior.
Mouse walkthrough: in normal use click the outward-arrows action on Rascunho in
Principal. The frame grows above Main peers; use Sidebar/Bottom normally. Click inward arrows
to restore, or enter Edit to restore first. The same action is keyboard-focusable
and activates with Space/Enter.

`pnpm test:time-tracker` is the focused disposable-profile Windows check, also in
`pnpm test:desktop`. Build packages/application first. It installs both real
packages and checks eligible type counts Main/Sidebar/Bottom = 6/5/5, explicit
placement, both tracker views in every region, shared Workers, visibility changes,
restart while running, native save failure/retry with one stable interval,
totals/history and corrupt-data recovery. Core tests cover timestamp rollback,
local midnight splitting, duplicate pause/start and lost-acknowledgement retry.

Mouse walkthrough: Plugins → Instalar pasta local → generated `time-tracker`
folder → Ativar. Enter Edit and choose Cronômetro and Relatórios de tempo, then
their desired region; Conclude. Click Iniciar, hide/reopen a region or restart the
app, then Pausar and wait for Salvo. Read daily totals/sessions in Principal;
Lateral/Inferior show summaries. A failed save keeps a retry action and confirmed
history. This is local ordinary data, not an account or a background OS service.

Archived-bar pointer restore in `tools/workbench-organization-smoke.ts` waits for
the filtered library grip's actionability before sampling coordinates. Filtering
can change popup height and reanchor it on the ResizeObserver frame. The smoke
checks the actual hit target, body pointer capture and admitted rail destination
before retaining the exact same-ID/order assertion. A missed pointer start must
fail as a driver precondition, rather than be reported as a completed restore.

The current four-edge slice uses `tests/workbench-presentations.test.ts` for identity,
Main-only capabilities, nested v1/v2 migration, occupied-edge rejection/reactivation,
corner ownership, joint fit, exact Normal returns/refusal, storage guards and history.
`pnpm test:presentations` runs disposable-profile Electron checks in both themes:
four collapsed, top open, all open, zero/one/two horizontal reservations, all-axis
expanded Docked click/drag/cancel, fixed compact strip drag refusal, independent Bottom,
narrow restart/recovery, anchored/free Floating,
menu/focus continuity, free-trigger drag, geometry-preserving Normal conversion and
atomic conflict refusal. The desktop chain includes default scale; explicitly run
`pnpm test:presentations --scale125` for simulated DPR 1.25. Diagnostics remain ignored
under `.local/diagnostics/presentations-alpha19-*`. Simulated DPR and screenshots do
not establish physical mouse/DPI or owner visual acceptance.

Owner mouse check: in Edit, use each Main widget's local menu beside X. Choose
Encaixado then a different edge for each widget. Click its fixed compact strip to
open; use the expanded inner edge to collapse or drag it inward/outward to resize.
Compact strips have no move or resize gesture. Top/bottom span the width and shorten the
sides immediately. Try a busy edge: the existing panel must stay in place. For
Floating choose each edge, hover its strip, enter content/menu, then leave. Choose
Sem âncora, drag its compact header in Edit, leave and return: the trigger remembers
the location. To compare a return to Normal, keep the Edit catalog in the same state;
the expanded rectangle must match exactly. For four open panels, return left/right
before top/bottom; a conflicting return must keep the original mode with feedback.
Narrow the native window, restart and enlarge; explicit open intent returns when
feasible, while explicit collapse stays collapsed. Repeat both themes at physical
Windows scale. The historical alpha.18 coverage description follows for provenance.

The current smoke also samples Main, an ordinary Main widget and Docked/Floating
compact strips throughout Sidebar collapse/reopen, including intermediate native CSS
frames. Compare native Main insets, shared measurement values and frame endpoints;
verify paint and pointer delivery to a floating Sidebar overlapping either strip.
Mixed anchored reservations count each strip once. Floating reveal must leave peer
rectangles unchanged; expanded Docked must change its reservation and peer viewport.
`tests/widget-frame-layout.test.ts` exercises their common fractional projection and
clipping path. Keep physical Windows smoothness/visual acceptance separate.

The alpha.18 presentation pilot used `tests/workbench-presentations.test.ts` for old defaults,
v2 roundtrips, identity/capability/region gates, invalid dimensions, CAS/quota/recovery,
bounded Docked fit, layout-neutral Floating and history/composition behavior.
`pnpm test:presentations` runs `tools/presentation-smoke.ts` with a disposable Electron
profile and is included in `pnpm test:desktop`. Alpha.18 covers local Edit selection,
Normal-only controls, button alignment, both themes, content identity, popup reachability,
Docked click/drag/cancellation and independent Bottom, real open/collapsed restarts,
Floating hover and hidden restart, alpha.17 closed Normal/Floating compatibility, v1
reading, wide/narrow/wide recovery, expansion/scrollbar bounds, Edit checkpoints and
rejected Save bytes. Hover/adaptation/resize previews and canceled gestures must not write.
Run `pnpm test:presentations --scale125` after building for explicit Chromium DPR 1.25.
Artifacts go under ignored `.local/diagnostics/presentations-alpha18-*`.
This does not establish physical Windows DPI, mouse fluency or owner visual acceptance.

Owner mouse check: enter Edit, hover Properties and open the selected-mode button immediately left of X.
Choose Normal, Encaixado and Flutuante; Save advances the Cancel checkpoint and Conclude
exits. Type a sample name before switching and verify retained content. In Encaixado click
the outer top edge to collapse/reopen, drag it vertically and restart both open and collapsed.
For recovery start in a wide window (e.g. 2000×1200 content), drag to about 420px and Conclude.
Reduce to the native minimum (1000×720 content), restart there, then maximize: the temporarily
hidden panel must reopen at the preferred height when it fits. Repeat after an explicit
collapse: it must stay collapsed. In narrow Edit, the selector on the collapsed bar still offers Normal.
For Flutuante hover the full-width collapsed Properties bar above Bottom, move into
the panel and its Edit menu, then away; restart must await hover. See the exact provisional
bar dimensions in [layout](../architecture/layout.md). Repeat in both themes and usual
physical scale; assess legibility, controls, motion and pointer reachability.

| Layer | Command | What it does not prove |
| --- | --- | --- |
| Project structure | `pnpm check:repo` or direct Node invocation of `tools/check-repo.ts` | Effective Codex config, installed graph or runtime security |
| Core behavior/negative paths | `pnpm test` | React rendering, Electron launch or Windows graphics |
| Full type analysis/lint | `pnpm typecheck`, `pnpm lint` | Correct product behavior on their own |
| Bundling | `pnpm build` | A signed/installed product or successful GUI launch |
| Automated built desktop | `pnpm test:desktop` including `test:workbench` | All pointer/DPI/native integrations, subjective UX or production readiness |
| Owner smoke | Applicable current scenarios below | Comprehensive performance/security certification |

For documentation-only work, use the dependency-free source check and focused policy tests required
by the active contract; full graph installation/build/desktop are not automatic checklist steps.
`pnpm test:desktop:dev` covers identity/desktop with a Vite renderer and is a different chain from
`test:workbench`. Focused built matrices can use
`node --experimental-strip-types tools/workbench-corrections-smoke.ts --compositions-only` or
`--drops-only`, with `--scale125` when relevant. Prepare the matching build/examples first.

The dependency-free test command may run in a constrained source-inspection environment using Node's type stripping. Report the actual Node version there; that is narrower than the supported Node24 + resolved TS6/Electron toolchain. Never call a TS syntax/transpile check a full semantic typecheck.

## Current workbench coverage — Issue #2 / alpha.13 and alpha.14

Alpha.14 extends the same corrections controller with `workbench-composition-smoke.ts`.
Use `workbench-corrections-smoke.ts --compositions-only` (also `--scale125`) for the focused
native suite: all four logical visibility defaults, enabled collapsed-panel opt-in, checkpointed
dimensions, one save mode, literal names/PT/EN, scoped restore/checkpoint/Conclude and Bottom
multi-slot catalog/existing drops at 125/250px in both themes. It reuses the Main pointer/landing
sampler, including position and dimensions throughout the flight, normal/drag hover, cancellation,
invalid Bottom interception and ordinary free-space placement. Source tests additionally cover
paused admission; current manifest-v1 plugins cannot contribute a native Bottom widget. These
sequences do not certify an unobserved owner-specific scene or physical visual acceptance.

For runtime work, select the applicable checks above with Node24/pnpm11. `tests/workbench-model.test.ts`
adds dynamic ownership/model validation, host-only v1 normalization, explicit legacy adoption,
unchanged original bytes, CAS/quota failures, independent membership, atomic bilateral resizing
and session-history branching. `tests/window-controls.test.ts` rejects subframes, wrong URLs
and every argument-bearing host chrome request. A source test is not an Electron IPC test.

`pnpm test:workbench` launches a disposable built Electron profile and checks native window
controls, checkpoints/history, form DOM/value identity, presence removal/Cancel, temporary
slots, a normal-mode pair, cross-region swap/undo and quota-failed Conclude preserving both slots and editing. It supplements the broader
desktop suites; it cannot establish full A01–A12 parity or physical visual acceptance.

It also checks slot retargeting/filter restoration and viewport A/B/A with unchanged saved
bytes. `workbench-organization-smoke.ts` exercises independent bars, pointer reorder/invalid
drop, hover-switch during a drag with whole-intention undo, same-ID archive/restore,
delete/cancel returning to the filtered library, shared form/model identity, composition
checkpoint/save/default/favorites, independent library orders and literal user names across PT/EN. Settings navigation uses the profile menu and
its Development and recovery surface; these tests never edit owner profiles.
`workbench-plugins-smoke.ts` exercises the actual header manager with native Counter/Pulse
installation, inventory filters/sort, zero-widget catalog exclusion, presence removal without
Worker disposal, intentional disable/reset, retry/removal errors and a narrow window. Its
temporary 50-card DOM fixture checks only CSS scrolling/chrome; it is never native inventory
and does not change the 32-installation service cap.

The focused workbench smoke also observes a parked catalog drag after pickup and asserts no
additional DOM-rectangle reads over ten animation frames. Sidebar edge scrolling wakes frames
only while its native scroll offset changes. Catalog admission shares the sixteen-view cap
with commands and permits reuse of a compatible existing view at that cap.

`workbench-corrections-smoke.ts` covers the approved correction packet with disposable built
Windows Electron profiles: 180/125px chrome minima in both themes at 1920×1080,
1912×907 DPR1, 1920×1025 and 1000×720; exact slot filling/reopening; short rail clicks,
jitter, reorder/undo; fourteen-bar activation and editable legacy twenty-bar loading;
nested library dismissal, empty filters/scroll reset; modal focus/backdrop, stable picker
controls; local metadata/model history and checkpoint; format-pending scope; catalog
origin distinctions and whole-card reduced-motion rejection. Incompatible association
and post-toast outline observations are test/report evidence, not automatic acceptance.
The plugin smoke additionally exercises real lifecycle notifications, the paused widget
placeholder and its deliberate runtime reset. No fixture adds manifest-v1 capabilities.

The host currently declares no seamless bundled widget, and manifest-v1 contributions
normalize to card appearance. A seamless flight cannot be certified from those fixtures;
keep that limitation distinct from a visual choice or approval. Native project folder
state is likewise unavailable; the subtitle explicitly reports that absence.

The approved V1.141 package is a separate design verifier; its passing npm verify does not
validate React or Electron. Compare the built app at 1920×1080 in both themes and record
intermediate animation states, actual timing/easing, narrow/maximized/normal windows and DPR1.25.
Keep A01–A12 evidence in Issue #2; screenshots do not replace desktop interaction, plugin
lifecycle, storage failure, stable form/Worker identity or physical Windows acceptance.
At a narrow window, an open editor can make Main infeasible for the native fixture minima.
The desktop launcher checks Conclude rejection with unchanged bytes, closes the dock to
restore usable space, then checks the successful atomic commit; it never lowers those minima.
The alpha.12 geometry/security/lifecycle assertions below remain regression requirements;
update only superseded chrome dimensions, labels and intentional storage-adoption paths.

`tools/workbench-corrections-smoke.ts` extends its existing disposable Electron controller with
`workbench-drop-smoke.ts`. `--drops-only` runs the focused native-capture landing/reservation
matrix; `--scale125` also applies the explicit Chromium 1.25 override. Both themes cover six
region-transfer directions, a scrolled custom Sidebar, start/intermediate/end position and
dimensions, live-view suppression/reveal, clipping, exact catalog/existing-view reservation
drops, ordinary space, rejection, hover/cancellation/history and reduced motion. Raw samples
and captures remain in ignored diagnostics. Automated scale/native capture is separate from
the owner's physical Windows DPI and visual acceptance.

## Current continuous geometry coverage — Issue #29 basis and workbench adapters

For approved geometry changes, the usual runtime gates are pnpm check, pnpm test:desktop,
pnpm test:desktop:dev, the desktop launcher with --scale125 and git diff --check.
Choose any additional focused matrix from the actual changed behavior. On Windows with a blocked PowerShell script shim, pnpm.cmd invokes the same
scripts without weakening ExecutionPolicy. All Electron runs allocate disposable profiles; never
use owner userData. Actual outcomes/CI/Git evidence belong in the active Issue, with #29/#2 cross-references as applicable, not this guide.

tests/freeform-geometry.test.ts exercises arbitrary fractional pixels, eight anchored directions,
region axes, direct local push chains, far-edge compression, preferred recovery, bounded rearrangement,
impossible rejection, stable reversal, solver budgets, representative fixture sweeps and transfers.
tests/freeform-projection.test.ts sweeps one-pixel widths at several heights, checks minima/clearance,
source immutability and A→B→A, finite warned fallback, occupied expanded extent and region cross axes.
tests/freeform-storage.test.ts covers exact pixel serialization, ownership/eligibility/count/version/
finite/minimum/document failures, all historical choices without original-key writes, quota and byte
conflicts. Retain the older grid/fractional tests unchanged as codec/migration/algorithm regressions.

tools/freeform-smoke.ts is called by the production/development/scale launchers. It measures actual
DOM rectangles in both themes/restored/narrow/maximized windows; checks the approved 11px/9px Main inset and
independent 25px status strip, pixel-exact arbitrary movement/resize/reload, eight handles, keyboard,
live compression/held reversal/settled independent actions, occupied scrolling/contraction, form identity and actual
Sidebar/Bottom placement. Exercise region collapse/reopen, size restoration and impossible small
Bottom/incompatible transfers. Validate no viewport-only writes, Save/Cancel, historical choices,
corrupt/future/oversized data, quota, concurrent bytes and queued Save followed by Cancel. Plugin
smoke retains real Counter/Pulse Worker identities/actions/background updates across offscreen
scrolling and expansion; existing lifecycle/identity/negative-Electron tests remain mandatory.

tools/freeform-correction-smoke.ts runs in all three desktop modes. It records every animation frame's
logical rectangle, DOM edges, inline clipping, port origin/client size/scroll offsets and opt-in solver
source/candidate/result/reference under .local/diagnostics. The documented tolerance is 0.06 CSS px
(above Chromium's 1/64px layout quantization, independent of DPR); compare screen edges after explicit
scroll translation. Tight Properties/Queue/default fixtures exercise every edge/corner, bounds, blocked
last intentions, reversal, subsequent gestures, actual native scrollbar introduction and removal on
release. Move/resize chains test settled neighbors, Escape/lost capture, no pointerup storage writes,
Save/reload, old saved preferences and Sidebar/Bottom permitted axes. Production asserts no custom
handle Tab stops/arrow behavior/outlines and uses real pointer equivalents; development keeps all eight
keyboard resize paths, 1px/Shift actions and batched successive steps. Both test native form tabbing and
region splitters. These automated DOM/forced-DPR observations do not replace owner visual acceptance.

Corrective region assertions include Sidebar vertical content extent with a single navigation/widget
scroll owner, no horizontal range, and Bottom zero ranges on both axes in normal/expanded/recovery
states. Attempt programmatic scrolling, focus, keyboard and wheel input. Compact eligible Bottom
content must fit without an internal scroll owner or omitted text. Check nominal chrome minima
of Sidebar 180/Bottom 125, adapted useful minima 150/105, and the independent 25px status bar against
DOM/DPR and coherent ARIA/collapse bounds. Use measured insets rather than adding the old 15px
frame again; Main retains its own declared minima. Check border/tone in both themes. Main's first automatic scrollbar must not cancel a gesture.

`node --experimental-strip-types tools/freeform-performance.ts` measures the built Electron renderer
using a disposable profile and the default seven-widget dense composition near 960×620 CSS pixels.
Repeat with `--scale125`. Four move/resize paths include fast movement, two reversals and up to several
affected neighbors. Opt-in browser Performance measures report per-call solver duration, states,
probes, candidates and affected widgets; the tool records pointer intervals, RAF frame intervals,
solver-start to geometry DOM mutation delivery and solver-start to the subsequent RAF
as distributions and raw samples under `.local/diagnostics`. `--baseline` labels measurements only;
it does not select or restore older source. Baseline measurements require the actual older build.
Mutation delivery observes DOM commit completion, not React component render duration; RAF intervals
are frame scheduling evidence, not GPU presentation or a measured paint duration.
Compare fixtures, viewport/DPR and environment before attributing differences. The deterministic
budget is 512 states per phase and 8192 total probes; no universal timing guarantee is asserted.
Narrow/wide relocation tests independently validate the destination rectangle before calling reflow.

Representative before/after captures, numeric geometry and bounded DOM observations live in ignored
.local/diagnostics. No empty cells or large synthetic world arrays are required. Observed resource
samples do not certify arbitrary third-party plugin performance. Forced Chromium DPR 1.25 is automated
CSS/device-scale coverage; it does not establish the owner's physical display DPI or subjective UX.

Owner physical checks: both themes, normal/maximized/narrow windows and usual Windows DPI; smooth
push/compression/no teleport/no gravity, all eight handles, cancellation/focus, normal content scrolling,
Sidebar/Bottom cross-axis behavior and collapse/reopen, infeasible Bottom rejection with native content fitting at the approved 125px chrome minimum,
reversible fallback, historical adoption/rollback and no form/Worker loss. Record only unobserved
or newly changed scenarios in the relevant Issue; do not demand a repeat of an already evidenced
scoped acceptance. The alpha.14 conversation approval does not accept all of #29 or the app.

## Current desktop plugin and identity coverage

Build the app and independent examples before the applicable desktop commands. Launchers allocate
restricted `geppio-smoke-*` roots under the OS temporary directory; never point the override at owner
userData. Only generated disposable roots are removed. Captures/raw diagnostics remain in ignored
`.local/diagnostics/`. Renderer errors, launch failures and observations must be reported, not hidden
by a screenshot. The desktop launcher also records a process-metrics sample; a point sample is not
representative multi-plugin CPU/RAM coverage.

`pnpm test:desktop` runs identity, desktop and the four workbench controllers. The desktop path
calls current freeform/correction and trusted-plugin checks. Identity seeds disposable old/new
Chromium profiles and covers origin/layout/theme transfer, retained IDs/revisions/enabled flags,
unchanged original/backup bytes, restart/idempotence, destination preservation and rejected legacy
URLs. DEV uses built Main/preload plus the exact loopback Vite origin; it is not proof of every HMR
or Task Buttons/launcher behavior. See [identity recovery](renaming.md) for the separate owner procedure.

For a new or changed plugin lifecycle scenario, install reviewed generated Counter/Pulse folders
through the header Plugins manager or Settings > Development and recovery. Confirm disabled installs;
activate Counter and place its contribution from the catalog into Main, then exercise its action.
Activate Pulse and observe advancing real status with zero widgets. Removing a widget presence must
retain its Worker. Disabling ends execution/publications; an existing host placement remains as a
paused placeholder. Re-enable starts fresh Counter state. Restart with one disabled and verify
installation/enabled preferences, then test removal/restart in the disposable profile. Existing
5/5 owner acceptance in Issue 21 is historical evidence; do not assume the old disappear-on-disable
presentation is the current host rule or require its automatic repetition.

Negative package/lifecycle cases include duplicate or malformed manifests, missing/import-failing
modules, exceptions, hangs, message floods and corrupt preference preservation. No owner profile,
unknown package or credential is used. Assertions about no Node globals/narrow bridge and bounded
Workers are narrower than untrusted-plugin isolation. Keep keyboard/Escape/focus, scrolling and
both themes tied to the actual changed scenario and usual physical Windows DPI when owner review
is needed. Linux application behavior remains unobserved; Linux core tests/secret scan do not prove it.

## Historical contracts retained for recovery and regression

The sections below describe earlier UI/engines and their tests. Their cell counts, chrome values,
Save/Cancel flows, guide/Alt behavior and owner checklists do not override the current workbench
above. Retained grid/fractional codecs and pure tests still protect recovery; old DOM smoke tools
are reference material, outside the active freeform command chain. Execute a historical comparison
only under an explicit task with the corresponding source/build; no old acceptance is reset here.

### Historical alpha.11 horizontal comparison / Issue #28

`tests/grid-horizontal.test.ts` covers height-only ten-row geometry, bounded extent, the independent
codec, hostile/corrupt/oversized input, unchanged old keys, quota/concurrent-save rejection and reflow
beyond column 24. Responsive schema/projection/reflow tests retain their existing assertions.
The alpha.11 desktop responsive suites selected **Responsivo atual** after reload, because its session default was horizontal; selection went through Development, not a persisted/test-only bypass.

The historical desktop launchers executed `tools/horizontal-smoke.ts`: independent actual DOM rectangles,
single 15px frame, no reserving scrollbar, occupied-world bounds, focus/keyboard/wheel/slider, nonzero
scroll pointer movement and eight resize directions, reversal/auto-scroll/Escape, Save/Cancel/reload,
switch rejection, form retention and corrupt/unsupported/oversized/concurrent state in disposable
profiles. Native dimensions, both themes and explicit DPR 1.25 are recorded under ignored diagnostics.
Counter/Pulse checks retain Worker identities and published/action/background state across scrolling
and mode changes. A bounded 120-surface/12,000-child synthetic workload measures DOM construction,
skipped surfaces and Chromium performance counters. This does not establish generalized CPU or plugin
budgets. Comparison captures use the preserved alpha.10 engine and horizontal engine in the same
executable; physical owner acceptance remains separate.

### Historical alpha.10 grid / Issue #24

`tests/grid-geometry.test.ts`, `grid-projection.test.ts`, `grid-reflow.test.ts` and `grid-storage.test.ts` exercise square-cell
fit in both dimensions (including tiny viewports), mandatory centered coordinates, eight anchored
directions, integers, no gravity, push chains, boundary compression, preferred-size relocation,
bounded rearrangements and rejection, deterministic reversal and immutable input. Storage cases
cover read-only v1 conversion, original bytes, a valid but unconvertible composition, v2 validation,
corruption/version mismatch, write failure and concurrent byte changes. Legacy continuous tests
remain regression evidence for v1 parsing/recovery and historical algorithms, not the active editor.

Projection cases reproduce wide/short Main, compare coverage against fixed 12×8, assert edge affinity,
retain 3×3 preferences while allowing temporary constrained spans, preserve intentional gaps/immutable
sources, repeat A→B→A, exercise bounded feasibility/extreme-ratio warnings and round-trip explicit
responsive Save through unchanged v2. `grid-projection-continuity.test.ts` sweeps sanitized left-Library,
mirrored, dense, intentional-gap and recent-edit sources at one CSS-pixel increments (W 650–1700 at
H 650, H 400–1000 at W 1100). Its independent oracle checks separation/order, edges, IDs, minima,
overlap/clipping, cold/warm equality and rendered-scale continuity without calling projection helpers.

Quantization budgets are defined in `tests/helpers/projection-oracle.ts`: density change ≤0.5% per
CSS px; edge movement ≤0.75 pitch plus twice the viewport delta; normalized edge movement ≤0.08 plus
twice the delta/minimum viewport dimension. Adjacent area change permits one cell per dimension plus
continuous viewport motion; a three-sample grow/shrink excursion cannot exceed one cell's area strip.
These are integer-geometry tolerances, not a smoothness certification. Small-span widgets may show
large percentage area steps when restoring one cell; report absolute geometry and pitch too.
`grid-coverage.test.ts` adds an independent feasible 22×11 witness at usable Main 1480×740,
including neighbouring pixels, minimum-row/column coupling, capped extreme ratios and a recent
direct edit whose reference scale previously retained avoidable bands. Saved and rebased Edit
fixtures additionally sweep W 800–2200 at H 740 and H 400–1100 at W 1480 in one-pixel steps,
using the same unrelaxed safety/continuity/spike budgets. Coverage requires less than one pitch
of residual space on each uncapped axis; the explicit witness requires full width and ≤5px total
vertical residual. Count caps and mandatory minima can still make large bands unavoidable.
`node --experimental-strip-types tools/margin-evidence.ts` records reference/rendered pitch,
both counts, grid dimensions, four margins, source hashes and logical/pixel rectangles. Its
`--before` option must only be run on the baseline algorithm, before implementation.
`node --experimental-strip-types tools/projection-evidence.ts` writes exact source hashes, dimensions,
topologies, pitch, logical/pixel rectangles, transitions and maxima to ignored `.local/diagnostics/`.
`--before` labels a baseline run and disables acceptance assertions; run it only against baseline code.

`tools/grid-smoke.ts` was called by the historical desktop launchers and replaced the then-current
fractional editor smoke. It is not in the active freeform launcher chain. It asserts clean Main, square rendering/no Main scroll, permanent centering across window/region/panel
changes and both themes, absence of an alignment control in Settings, unchanged units/bytes,
independent pixel splitters, normal form/scroll interaction, real eight-direction gestures in both
themes, native wide/medium/narrow/portrait resize, a free-size sweep, maximize/restore, numeric margins
against fixed 12×8, Docked/Overlay on four edges, 3×3 preferred-size retention, live collision/preferred-size persistence,
impossible-growth rejection, opposite anchors, reversal, keyboard, Escape/capture/region-change cancellation, Save/Cancel/
reload, responsive Save/resize/Cancel, quota and concurrent Save rejection, v1 conversion/theme behavior, corrupt-v2 recovery and invalid import. Plugin and
identity smokes remain mandatory. `--scale125` covers an explicit Chromium 1.25 override only.

`tools/composition-smoke.ts` supplements projector comparisons with independent actual DOM rectangles,
source separation/edge/gap assertions and the same continuity budgets. Both themes cover saved and
active-draft custom compositions, bounded native one-pixel samples, maximize/restore, both splitters
forward/back in one-pixel steps, zero storage calls/byte changes, cold reload, recent edits compared
with the unchanged direct reflow solver, native resize during capture and explicit Save/reload.
Its measurements and representative captures remain under ignored `.local/diagnostics/`. A wide/short
direct resize that relaxes the minimum row count additionally checks exact solver geometry during
pointer/keyboard edits, cancellation of the reference, one-pixel crossings immediately afterward,
visible-coordinate Save, absence of reference metadata in v2 and identical saved cold/warm views.

`tools/margin-smoke.ts` adds repeated restored/maximized/restored and horizontal-resize/maximize
journeys for left, mirrored, dense and intentional-gap sources in both themes. It repeats after
Edit entry/Cancel, region changes, deliberate pointer/keyboard edits and explicit Save/reload.
Read-only renderer datasets expose requested pitch and the active edit reference for diagnostics;
they add no settings, persistence fields or privileged bridge. The independent DOM oracle checks
coverage as well as centering, safe rectangles and preserved source relationships. Identical
source/reference/measurements must reproduce geometry throughout the journey and on cold projection.
Storage spies exclude the explicit Save and require zero viewport writes. A direct pointer move
places a widget at the logical right edge while the left edge remains occupied. Measurements and
representative captures are ignored diagnostics, not owner visual acceptance.

Owner physical Windows acceptance remains separate: both themes, usual DPI, legibility as cells
shrink, mouse splitter/resize behavior, compressed neighbours/preferred-size recovery, small window
with no Main scrollbar, lower/middle empty cells, explicit recovery preview and original v1 rollback.
Use disposable profiles. Do not claim subjective UX, physical DPI or owner acceptance from automation.

### Historical alpha.8 region sizing / Issue #26

`tests/region-policy.test.ts` checks live proportional/absolute/Main-space caps, requested defaults,
fractional/tiny/invalid measurements, nonnegative coherent bounds and reversible request clamping.
`tools/region-smoke.ts`, called by the grid smoke, compares rendered dimensions with effective ARIA
bounds at native 1000×720, 1280×740, 1480×980 and 1800×720 windows in both themes. It exercises mouse
and keyboard/Shift limits, independent peers, Escape/pointercancel/real capture loss, viewport resize
during capture, fresh gestures after cancellation, repeated request A→B→A restoration and zero layout
storage writes. Synthetic 600×300 and 200×200 Work Areas test relaxed minima below Electron's retained
1000×720 native minimum, usable Main fit and independent Sidebar scrolling. Existing Save/Cancel/restart,
Counter/Pulse, security and DPR 1.25 smokes still apply. Synthetic Work Areas and forced Chromium DPR
do not establish physical Windows DPI or subjective acceptance of the trial caps.

### Historical alpha.1–alpha.6 coverage

Continuous fractions and boundary clamping; touching edges versus overlaps; all eight directional resizes with opposite-edge anchors, minima/maxima and allowed axes; deterministic bounded collision chains and constrained adaptive shrinking; mixed fixed-size/eligible widgets, impossible compositions, pointer reversal, stable ordering and immutable inputs; optional guide snapping; full known-widget layout serialization; malformed/oversized/unknown schema and data rejection; duplicate/out-of-range/unknown IDs; corrupt local data preserved; storage write failures reported; asset traversal and untrusted development URL rejection; pure label reconciliation idempotence and unrelated-label preservation.

Fixtures are synthetic. Tests must not read personal projects or credentials. Negative inputs are data, never executable instructions.

### Historical alpha.1 to alpha.6 desktop contracts

Build first. The smoke launcher allocates its own `geppio-smoke-*` directory under the OS temporary root and passes a restricted test override. Never point it at the owner's actual userData. Only that generated test directory is removed afterward. Screenshot output goes to ignored `.local/diagnostics/`.

The foundation-era automation checked three regions and seven Main fixtures, absence of renderer Node globals,
the fixed bridge shape, edit cancel/save, the sample panel, theme persistence after reload and a
real process-metrics sample. It must report launch or renderer failures; a screenshot alone cannot
replace the assertions.

For alpha.6 / Issue #16, the former `tools/layout-smoke.ts` added pointer assertions before plugin smoke.
That file is absent from the current tree; this is historical provenance, not a command to run.
The current routes are `tools/freeform-smoke.ts`, `tools/freeform-correction-smoke.ts` and the
workbench smokes described above. The old contract used validated imported fixture compositions
in the same disposable profile and exercised all eight
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
At that stage, `pnpm test:desktop:dev` repeated this smoke with built Main/preload and a Vite renderer loaded from
the project configuration on the exact loopback origin, validating local protocol module imports
and development CSP/CORS. It does not certify every HMR or electron-vite launcher behavior.

### Historical owner Windows smoke contracts

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
or Cancel. Repeat in both themes, 100%/usual physical scale and a small scrolling window. The then-reported
7/7 functional checklist was not visual acceptance: the owner rejected alpha.6 UX and the
corrective retest was still pending in that historical record. Later delivered behavior and
scoped acceptances must be read separately; this paragraph does not request a new repeat.

Open the sample panel on all four sides in both Overlay and Docked. Overlay should leave underlying geometry unchanged; Docked should reserve viewport space (the minimum canvas may scroll). Test floating Overlay and the persistent reopen button. Resize the native window and verify overflow remains reachable rather than hiding widgets permanently.

Measure memory/CPU during representative interaction and repeated opens/closes; record environment
and workload. Alpha.2 has real Workers for trusted test logic, but no web embeddings or terminal
processes. A fixture/sample result cannot certify future plugin costs or OS resource isolation.

## Workspace Essentials pilot (alpha.21)

Alpha.22 adds `pnpm test:sidebar`, an independent built-Electron disposable-profile smoke
with the real installed Workspace Essentials package. It covers packed Home/custom bars,
insertion feedback/reorder/end insertion, resize/pairs, removal, scrolling, narrow widths,
eligible and rejected moves, checkpoints, Cancel, undo/redo and process restart/content
retention. An older gapped envelope is loaded with storage spies and byte comparison.
Run it separately from `pnpm test:desktop` so an archived-bar restore failure is reported
independently. Pure stack/eligibility/legacy/negative/history coverage lives in
`tests/sidebar-stack.test.ts`. Automation does not establish owner mouse/DPI acceptance.

`pnpm test:essentials` is an independent built-Electron smoke with its own disposable profile.
It runs first in `pnpm test:desktop` so its result is recorded before any archived-bar assertion.
It uses real native package install/enable, explicit Main placement of all four widgets, literal
edits, clipboard verification (including immediate edit/copy), process restart/value comparison,
disable/re-enable, removal/reopening of a view, native storage failure with retained text/retry,
and unchanged API 1 Counter/Pulse. Diagnostics stay in ignored `.local/diagnostics/`.
The archived-bar assertion is preserved; report its actual result separately from this pilot.

`tests/plugin-data.test.ts` covers identity/owner/channel binding, reinstall retention separation,
stale navigation/queued activations, bounded/invalid documents, corrupt/unsupported bytes,
concurrent CAS writes, disk replacement failure and rollback. Runtime tests cover owning controls,
queue/rate bounds, stale data responses, revocation and API 1 refusal. These tests do not certify
hostile-code isolation, power-loss durability, physical Windows UX or Linux application support.

## Completion standard

`pnpm test:edit-lock` (`node --experimental-strip-types tools/edit-lock-smoke.ts`)
is part of the desktop chain. Its disposable Windows profile uses real installed
Essentials/Time Tracker widgets and an explicit existing host fixture. Native
body clicks, focus attempts, typing, paste-key activation and sequential Tab
navigation verify the common Edit lock with the options panel closed. Read-only
inspection of inert content uses DOM access or includeHidden; content actions are
seeded and exercised in normal mode. Accepted pending drafts, background timing,
mount proofs and Worker identities are retained through Cancel/Conclude. The
combined mouse flow aligns, groups, switches tabs, maximizes/restores, transfers
and detaches a tab across regions, then saves/restarts. Real widgets all share
regional eligibility; mixed five-member partitions remain controlled pure tests.
Physical mouse/motion and display-DPI owner acceptance remain separate.

`pnpm test:groups` (`node --experimental-strip-types tools/groups-smoke.ts`) checks
real installed Essentials members and peer Time Tracker widgets in a disposable
Windows profile. It exercises mouse align/group, cancel/history, tab reorder and
detach, checkpoint/composition recovery, old-envelope load, stable DOM/Workers,
shared-frame maximize, both themes and full process restart. Use
`pnpm test:groups --scale125` for automated DPR 1.25. The default scenario is also
part of `pnpm test:desktop`; pure eligibility/codec/minimum/atomic refusal and
omitted-region composition cases live in `tests/workbench-groups.test.ts`.
Neither automation scale establishes owner acceptance at physical display DPI.

Alpha.30 extends the real-widget groups smoke to regional transfers, preview counts,
Sidebar Home/custom ownership, Bottom compact bodies and composition recovery.
`tests/workbench-regional-groups.test.ts` uses five controlled declarations only in
pure tests for 3/2, 4/1, 1/4, all/none eligible, carrier promotion, hostless subsets,
room refusal, reverse transfers and old-snapshot reads without writes. Real plugin
eligibility is unchanged; these synthetic partition cases are not five real native
widgets. The renderer consumes the same partition plan for its count preview.

Drop-flight sampling follows the actual flight and visible live-frame reveal.
The bounded deadline is a failure ceiling, not a fixed sample duration: native
pointer-up/transaction delivery can precede the existing 240ms flight by enough
time to outlast a 420ms wall-clock sample. Duration, easing, convergence, final
geometry, clipping and no-competing-animation assertions remain unchanged.

The presentation smoke records native pointer/focus targets with its per-frame
Sidebar measurements. Its compact-strip sample first moves outside the preceding
overlap probe and waits for the actual compact panels. Alpha.27 CI observed a
260px Floating reveal against a 31px compact-only assertion; local instrumentation
also observed pointerover/up on Activity after the Sidebar overlap click. Local
success alone does not prove the exact historical CI event sequence. Keep all
per-frame geometry assertions and the independent real hover/reveal tests.
Presentation resize probes also queue behind the existing workbench Web Lock and
use native splitter hover actionability before measuring coordinates. They assert
the actual hit target and pointer capture; bounded native pointer evidence is
retained on failure. This synchronization does not write data or retry a gesture.

Report passed/failed/blocked/not_run for each selected layer, the actual command/environment and
its limits in the active Issue. Link CI to the exact commit and distinguish global result, job,
step and tested scope. A passed source check is not a semantic TypeScript build, effective model
setting, physical mouse/DPI acceptance, Linux support or secure community-plugin boundary.
Do not use --no-sandbox, disabled webSecurity, weakened type rules or skipped assertions as fixes.
Preserve original bytes and security/solver/storage assertions when updating superseded chrome.
Apply the current Target Version and authorization policy; integration/CI never authorizes closure,
publication or acceptance of unrelated Issues. Representative CPU/RAM and native-surface workloads
remain separate measurements, not inferred from synthetic charts, solver timings or fixture counts.
