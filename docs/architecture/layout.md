# Bounded square-cell Main grid

## Experimental horizontal engine — Issue #28

Alpha.11 starts each session with **Horizontal — 10 linhas**; Settings > Development selects
**Responsivo atual** independently. Neither experiment has final owner acceptance. The responsive
engine described below retains alpha.10 projection, permanent centering, constraints and v2 codec.
The selector refuses switches while editing (including import/recovery previews), with Save/Cancel
guidance. Both transactions remain alive. Widget frames share one stable parent and identity across
modes, retaining uncontrolled form/React state. `usePlugins()` remains App-owned; no visibility or
layout operation enters Worker activation/disposal.

`horizontal.ts` owns the separate geometry and codec. For whole measured Main height H, cell side is
`(H - 30 - 9*10)/10`, pitch is cell+10. The horizontal scrollport alone owns `inset:15px`; world/widget
coordinates start at zero, with no alpha.10 inset, outside gutter or world-end padding. Width changes
only the visible range. Ten rows and logical coordinates remain unchanged by native/region resizing.
Native scrollbars are hidden on both axes, leaving no reservation; an accessible native range control
has a 4px track/thumb inside the bottom 15px interaction area. Touchpad/horizontal wheel and native
focus reveal remain available; Shift+vertical wheel scrolls Main, ordinary vertical wheel is untouched.
The port supports arrows, PageUp/PageDown, Home/End. Native integer scroll extents are mapped to the
exact fractional CSS range with a subpixel world translation; the terminal occupied edge meets the
right inner frame exactly, without rounding padding. Pointer mapping uses that same effective offset.

World width is max(visible interior width, furthest occupied right edge). No empty-column DOM exists.
The ten-row domain allows 4096 columns and spans up to 24×10, seven known fixture IDs in storage,
64 KiB UTF-8 and a 1,000,000px browser-world ceiling. Pitch is capped to maintain that ceiling at
extreme heights; below 120px Main height, gutters decrease to keep nonnegative cells. Very short,
narrow or extremely tall Main shows a warning and may be unusably small: no automatic row change is
introduced. Physical pathological-size UX remains a later owner decision.

The original reflow entry still uses original rectangle/layout validation and exhaustive bounded
slots. `horizontal-reflow.ts` injects horizontal validation plus sparse fallback slots within 24 units
of the displaced/active rectangles and occupied edges. Push, compression, ranking, state/probe budgets
and snapshot reversal are shared. Empty horizontal distance does not allocate candidate arrays or
scan thousands of columns. Fallback is conservative, not a guaranteed global packer. Pointer deltas
include current minus gesture-start scrollLeft; edge animation recomputes against the stable snapshot.
Temporary extent is limited to twelve columns beyond occupancy and cleared on end/cancellation.
Keyboard moves reveal the edited widget. Height/width changes cancel an active gesture without moving
the stored composition. Scrolling never writes placements.

The persisted **horizontal** representation is `{schemaVersion:1,engine:'horizontal',rows:10,placements}`
under `geppio:layout:horizontal:v1`. Renderer transactions use an internal grid-shaped view, never a
serialized v2 migration. Exact known identities, integers, minima/maxima, preferences and overlap are
validated and canonicalized. Loading does not read/migrate/write old layout keys. Only explicit Save
writes horizontal bytes; import/reset are previews, corruption blocks rendering recoverably, and Save
compares observed bytes before replacement under a same-origin Web Lock. Queued Save is invalidated
by Cancel; uncooperative external writes still require recovery, rather than a database guarantee.
Shared theme uses `geppio:theme:v1`, falling back to responsive
theme; horizontal theme changes do not write either composition. Plugin preferences remain native.

`content-visibility:auto` on explicitly sized mounted horizontal frames skips unnecessary offscreen
paint/layout while retaining contents, focus reveal and background functionality. Static fixture
content is memoized. Plugin contributions remain in a separate stationary overlay strip inside Main,
without reducing the ten-row height; they can overlap fixture visuals, a limitation of this bounded
experiment rather than full plugin grid integration. The synthetic test panel also overlays in this
mode; responsive Docked behavior remains available. No plugin authority or capability changes.

`tools/horizontal-smoke.ts` independently measures DOM geometry, scrollbar reservation, terminal
rounding, input/form/mode continuity, expansion/contraction, real gestures and recovery in disposable
profiles. It observes Counter/Pulse Worker identity/state across scroll/mode changes and a bounded
120-surface/12,000-child synthetic paint workload. This is not a generalized CPU/plugin performance
guarantee. Physical Windows UX, gutter choice and owner visual comparison remain required.

The responsive contract is [Issue #24's alpha.10 margin correction](https://github.com/rabrunos/GeppIO/issues/24#issuecomment-6082287645),
continuing its [composition refinement](https://github.com/rabrunos/GeppIO/issues/24#issuecomment-6080536542).
It supersedes fixed 12×8 viewport geometry and the alpha.6 continuous editor/minimum scrolling canvas.
This is a reversible prototype with bounded adaptive limits, subject to owner acceptance. Earlier context remains in
[#3](https://github.com/rabrunos/GeppIO/issues/3), [#10](https://github.com/rabrunos/GeppIO/issues/10),
[#16](https://github.com/rabrunos/GeppIO/issues/16) and [#17](https://github.com/rabrunos/GeppIO/issues/17).

## Policy and measured rendering

`src/shared/grid/policy.ts` centralizes the 12×8 reference composition, provisional 10 CSS-pixel symmetric
gutters and 9px Main inset. Placements are integer `{id,x,y,w,h,preferred:{w,h}}`, independent of pixel
size, content, presentation and plugin authority. Fixture minima are 3 columns × 2 rows (the nearest
safe grid minima covering the retained normalized v1 minimums); maxima use the stored bounds. Each
fixture allows both resize axes. Typed constraints also support fixed/one-axis widgets.

For usable measured Main W/H, `fitGrid` calculates cell side
`min((W-(columns-1)*g)/columns, (H-(rows-1)*g)/rows)`. In tiny spaces, g decreases to at most
`min(W/(2*columns),H/(2*rows))`, so cells remain nonnegative. Unit n occupies `n*(cell+g)-g` pixels.
Responsive fitting additionally caps pitch at the continuous density described below. The same formula
on both axes makes equal logical spans square; a preferred 3×3 may temporarily render as 3×2 within
declared constraints. Leftover space is always centered in both axes;
there is no user-facing alignment preference, including in Settings > Development. Centering is pixel
presentation and never alters grid units, saved rows, placements or bytes. Main directly holds fixture frames, without a visible inner canvas,
heading or toolbar, and has no scrollbar. Fixture content and the separate plugin strip may scroll.

Sidebar width and Bottom height use independent pointer/keyboard CSS-pixel splitters. Issue #26's
trial policy lives in `workbench/region-policy.ts`: requested initial sizes 215px/43px, normal minima
160px/43px, maxima `min(300px, 20% Work Area width, width - 165px)` and
`min(180px, 25% Work Area height, height - 165px)`, clamped nonnegative. The 165px reserve retains
160px for Main plus the 5px splitter. Effective minima shrink to the maximum in tiny areas; ARIA
values use these actual effective bounds. Sidebar keeps independent content scrolling.
Sizes are session-only, never grid-snapped. Viewport clamping preserves requested sizes for return
to a larger viewport. Pointer capture starts from the effective size; Escape, pointercancel, lost
capture or Work Area resize cancels the gesture and restores its original request. Arrows adjust
10px (Shift 30px). The trial caps remain subject to owner visual evaluation, with no user cap mode.
Window/region changes remeasure Main, cancel an active widget gesture and derive a reversible projection.
The fixed header remains outside the work area; Sidebar spans the height alongside Main and Bottom.
Synthetic Docked/Overlay panel controls are in Development, with a persistent reopen button in Bottom.
Docked reduces usable measured space; Overlay leaves grid geometry alone. Neither controls native work.

## Responsive topology and stable sources

`projection.ts` derives one continuous reference pitch:
`max(sqrt((W+g)*(H+g)/192), (W+g)/24, (H+g)/24)`, with
`g = min(10, W/48, H/48)`. `projection-topology.ts` jointly resolves both counts and the actual
feasible pitch. Each axis accommodates its composition minimum and preferred-size metadata,
retaining unchanged v2 validation. If a minimum reduces pitch, recompute the opposite count using
that reduced pitch, bounded by 24. Keeping counts from the old reference would create avoidable bands.
Simply rounding that opposite capacity upward would jump density. Instead, a continuous one-cell
coverage phase approaches the next count, completing at 80% of the fractional capacity band; its
strength fades in across one missing unit when the constraint activates. Counts floor dimensions
at the resulting pitch, and `fitGrid` enforces the measured bounds. Residual space is less than one
pitch per uncapped axis, always centered. This does not promise a globally optimal packing or scale.

`projection-axis.ts` fits source intervals independently on each axis. Every source left/right or
above/below separation is mandatory, strict gaps retain at least one logical unit, and outer-edge
affinity stays exact. These acyclic relationships provide earliest/latest feasible positions.
Actual spans scale with the target extent, rounded and clamped between declared minima and preferred
sizes. If they do not fit, eligible intervals shrink one unit at a time, preferring reductions of
the required extent and then least normalized distortion. Positions use source free-space anchors
within those feasible bounds. There is no whole-Main slot search, gravity, permutation or viewport
write-back. Work is bounded by widget count (16), extent (24) and unit compression; the conservative
probe ceiling is `2 * 16⁴ * 24` (unit reductions × candidates × separation pairs on two axes).
This is a local composition fit, not a general constraint framework.

A valid source itself proves a feasible bounded arrangement at its declared minima. If its required
extent exceeds the ideal viewport topology, retain that extent and reduce square-cell pitch instead
of reversing relationships or violating minima. Coverage below 85% on either axis shows a recoverable
warning explaining larger margins. Narrow/extreme spaces can make content small; internal scrolling
remains available. Integer span restoration can still produce a one-cell size step, especially visible
on a two-row widget. No animation or physical smoothness is claimed.

`useMainMetrics` memoizes only the exact stable source, its explicit edit reference and measured CSS
width/height. Cold and warm results agree for identical inputs regardless of resize history. Deliberate
edits use visible bounds, exact CSS measurement and measured pitch as their new source/reference.
The same interval fit starts at that source's bounds/scale, with pitch initially scaled by the square
root of the measured area change. Joint feasible-pitch resolution determines both axis extents.
At the reference it reproduces the direct result. After a direct edit relaxes a minimum, the old
reference scale can otherwise leave avoidable margins at the 24-cell cap. Recover the minimum
feasible coverage pitch continuously over one reference cell of viewport travel (maximum absolute
width/height difference), preserving the direct result at zero travel. Every changed pixel adapts;
neither a stale projection nor resize history controls the result. This reference
belongs only to the active transaction, never saved metadata
or an automatically promoted projection. Cancelled gestures restore both snapshot and reference.
Save commits the visible coordinates/bounds, then clears the edit reference; the committed source
uses the same normal projection on warm render and restart. This can normalize its responsive view
when a deliberate edit changed the minimum feasible topology. A→B→A reproduces A without accumulated
displacement/compression; fine-step tests additionally check the transitions, not just endpoints.
Permanent centering only determines pixel offsets. The direct manipulation solver remains separate.

## Transactions and interaction

Normal mode has no active move/resize behavior; forms, text selection and internal scrolling remain
usable. Edit enables the title grip and eight transparent edge/corner zones with accessible labels,
directional cursors and keyboard arrows (one cell; Shift two). Opposite resize edges stay anchored.
Integer snapping is mandatory for this schema; the former fractional snap/Alt controls are retired.

Every pointer gesture records a stable complete draft and pitch. Every pointer frame solves against
that start, avoiding accumulated shrinking/drift on reversal. Only valid results become previews.
Blocked attempts retain the last valid draft and show an error. Pointer-up keeps the preview;
Escape, pointercancel, lost capture or physical geometry changes restore the entire gesture start.
Edit starts from the valid visible projection. Cancel restores the committed source projected into
the current viewport. Save validates and writes the visible arrangement and its actual bounds before leaving Edit; quota/read
failure keeps Edit and prior committed bytes. Concurrent stored byte changes reject replacement.
Theme changes use committed geometry, never unsaved placements. Pending migration/recovery cannot be
confirmed by a theme toggle. Imports are bounded, validated and preview-only; they retain current theme.

## Original bounded reflow

`geometry.ts`, `occupancy.ts` and `reflow.ts` contain GeppIO-owned framework-independent algorithms.
The [React Grid Layout documentation](https://github.com/react-grid-layout/react-grid-layout/blob/main/README.md)
was consulted only for architectural separation of pure algorithms, React interaction and explicit
configuration. No dependency, upstream source or algorithm was incorporated.

The requested active rectangle stays locked. Search first pushes impacted neighbours forward on the
movement/resize axes. At boundaries it allows eligible same-axis compression, retaining orthogonal
position/size and the far edge when possible. If axis-local solutions fail at minima, it searches
direct unoccupied slots for neighbours' original preferred sizes, then bounded multi-widget
rearrangements. Complete solutions rank by fewest changed neighbours, Manhattan proximity, retained
relative order and least preferred-size change, with stable fixture/coordinate ordering. Unaffected
widgets are never automatically compacted upward; empty lower/middle placements remain valid.

Automatic compression changes actual w/h but retains preferred w/h. Explicit resize updates the
user preference only on its requested axes. Save commits actual compressed geometry **and** its
original preference. Reversal within a gesture restores the original snapshot; later impacted-widget
direct-slot fallback tries that persisted preference. Responsive projection can restore feasible
preferred sizes in another topology without changing the canonical source. Only an explicit Save
commits that projection. No gravity pass moves widgets towards the top.

Work is bounded to 16 widgets, 4096 visited states per phase (four phases), 131072 candidate probes
total and recursion depth no greater than widget count. Search is deterministic but conservative,
not a globally optimal/exhaustive packer. Invalid input, unavailable space and exhausted budget are
explicit blocked results. No result permits overlap, hidden row growth, widget loss or caller mutation.

## Versioned persistence and recoverable conversion

Schema 2 uses `geppio:layout:grid:v2`, with columns, rows, theme, all seven placements and preferred
sizes. Parsing rejects unsupported versions, oversized UTF-8 input (64 KiB), missing/unknown/duplicate
IDs, invalid theme/bounds/numbers/min/max/preferences, overlaps and out-of-bounds rectangles. It
discards non-contract properties and restores canonical fixture order before rendering/writing.
Stored columns/rows remain canonical and unchanged by viewport resize. The compatible v2 schema
already supports varying integer bounds; no new storage key/schema or destructive migration is needed.

If v2 is absent, v1 `geppio:layout:v1` is validated read-only. Nearest-unit conversion respects minima,
keeps all known widgets and their rounded requested sizes, and deterministically relocates collisions
without shrinking. A largest-first nearest-slot search is capped at 32768 probes. Conversion remains
a preview until explicit Save. The original v1 key/bytes, identity migration backup and plugin state
remain intact. Development and production origins retain separate storage identities.

If conversion cannot fit or v1/v2 is corrupt/unsupported, show a recoverable warning and withhold the
composition instead of silently substituting a wrong default. Settings allows valid import or an
explicit initial-composition preview. Cancel returns to the blocker; Save confirms only the new grid
key. An existing v2 value always wins, including corruption: do not fall back silently to v1. Recover
v1 using the original bytes in a disposable profile/import workflow; no database/backup service or
privileged renderer bridge is added. [Identity recovery](../development/renaming.md) remains unchanged
at the native v1 transfer boundary.

## Module ownership and pending acceptance

Shared grid files separate policy/types, geometry, responsive projection, occupancy, reflow, schema/migration and storage.
Renderer `grid/` separates measured projection, view/source transaction adapter, widget frames and gesture capture;
`workbench/` owns shell/header/sidebar/splitters/panel, and `settings/` owns modal/Development controls.
Plugin UI/runtime and native security remain in their existing isolated modules. No renderer Node,
filesystem, process, generic IPC or plugin permission expansion is introduced.

Tests are routed by [the validation guide](../development/testing.md). Owner physical Windows DPI,
mouse/legibility/UX, provisional gutters/rows and performance acceptance remain in Issue #24. No
animation smoothness, subjective approval, plugin cost or native-surface guarantee is inferred.
