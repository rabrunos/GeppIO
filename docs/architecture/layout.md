# Bounded square-cell Main grid

The current contract is [Issue #24's responsive correction](https://github.com/rabrunos/GeppIO/issues/24#issuecomment-6072025821).
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
The same formula on both axes makes 1×1 and 3×3 square. Leftover space is always centered in both axes;
there is no user-facing alignment preference, including in Settings > Development. Centering is pixel
presentation and never alters grid units, saved rows, placements or bytes. Main directly holds fixture frames, without a visible inner canvas,
heading or toolbar, and has no scrollbar. Fixture content and the separate plugin strip may scroll.

Sidebar width and Bottom height use independent pointer/keyboard pixel splitters with provisional
160px/43px minima and 160px space reserved for Main. They are session-only, never grid-snapped.
Window/region changes remeasure Main, cancel an active widget gesture and derive a reversible projection.
The fixed header remains outside the work area; Sidebar spans the height alongside Main and Bottom.
Synthetic Docked/Overlay panel controls are in Development, with a persistent reopen button in Bottom.
Docked reduces usable measured space; Overlay leaves grid geometry alone. Neither controls native work.

## Responsive topology and stable sources

`projection.ts` selects both columns and rows from the usable `(W+g)/(H+g)` aspect ratio, quantized
into 1/64 bands. Selection does not depend on resize history. Candidates rank by aspect match, then
a small reference-area penalty to avoid unnecessarily tiny cells. Integer bounds remain at most
24×24. Candidate area is capped at 192 cells unless the source area/preferences require more;
each axis accommodates persisted preferences, so v2 validation never needs reinterpretation.

Up to 24 candidate topologies are considered. Prefer an anchor-preserving arrangement with about
95% coverage in each dimension over gratuitous repacking. Positions scale within available free
space: `targetX = round(sourceX/(sourceColumns-sourceW)*(targetColumns-targetW))`, with the analogous
vertical formula. Left/right/top/bottom anchors and intentional gaps survive when feasible. Widgets
use their preferred logical dimensions, rather than stretching to fill new columns. The rightmost
widgets therefore approach the right edge of a wider grid instead of staying in its first 12 columns.

If direct projection collides, deterministic bounded packing visits widgets in logical reading
order and slots by Manhattan distance from projected anchors, with stable coordinate tie-breaks.
Try preferred sizes across candidate topologies before retained actual sizes, then conservative
axis compression towards 3×2 minima. No gravity/top-edge objective or unlimited rows is used.
Search is conservative, not globally optimal: 4096 states and 8192 probes per packing attempt,
131072 probes overall with budget reserved for later compression phases. If no candidate fits,
fit the unchanged valid source with square cells. Coverage below 85% or failed packing produces
a recoverable warning explaining residual margins; all widgets/preferences and stored bytes survive.

`useMainMetrics` caches packing per stable source/aspect band; pixel changes still update metrics
live. Once a projected draft is edited, its bounds stay fixed within that band, so intentional
resize/reflow cannot trigger a topology switch during its own gesture. A changed band projects
from the same saved/edit source, never the previous transient viewport result. Gesture cancellation
restores the full source snapshot before painting the new projection. A→B→A reproduces A without
accumulated displacement/compression. Permanent centering only determines pixel offsets.

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
