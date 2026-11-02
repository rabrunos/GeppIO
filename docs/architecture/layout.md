# Region-aware continuous widget geometry

## Current host workbench — Issue #2 / alpha.13 and alpha.14

The host keeps the continuous solver below. `shared/workbench/model.ts` separates immutable
widget types, owner-qualified models, mounted views, placements and user bars. Manifest-v1
contributions normalize in the host to Main-only, single-view cards. Registry metadata comes
from bundled declarations and validated native inventory, never imported layout declarations.

`geppio:workbench:v1` stores one bounded validated envelope independently of all legacy keys.
Bar membership and vertical positions are independent; a shared Sidebar view can belong to
multiple bars without another model or Worker. Empty format slots and selection/filter/dock
state belong to the editing session. Save editing advances its Cancel checkpoint; Conclude
validates and writes the slot-free document before clearing transient UI. History records one
gesture/action, not solver frames; its stack of at most 256 intentions is session memory, not persisted
history. The normal-mode paired-divider command validates two adjacent rectangles against the
confirmed baseline without adopting another draft or migration. It is an explicit exception to
individual Edit-only geometry: accepted normal pairs have their own guarded commit; Edit pairs
use draft/history. Pair and region splitters retain keyboard operation in production.
Every bar member must resolve to its actual shared Sidebar view. A single-view type still
used by another bar cannot move/swap out of Sidebar and leave that bar dangling; multiple-area
types retain the shared Sidebar view and use an eligible view of the same model elsewhere.

Viewport projection follows continuous source proportions up to each declared maximum,
including growth when chrome releases space. Gesture preferences remain solver recovery
metadata, not a viewport-growth ceiling. This presentation rule replaces the alpha.12
ceiling without changing source bytes, gesture settlement, clearance or A/B/A reversibility.
The interval DAG reserves its functional gaps before fitting the remaining continuous extent,
so releasing chrome does not enlarge a coupled divider's clearance.

Confirmed chrome sizes/visibility are validated organization state. Held/keyboard previews,
peek and temporary Edit visibility remain separate until an accepted user intention. A normal
chrome update does not save projected widget geometry. Session slots carry their own reference
size and project directly to the current viewport; neither resizing nor a checkpoint serializes
them. Both the codec and serializer explicitly exclude session state.

`DragLayer` holds only an inert, identity-stripped visual picture in the native top layer.
Actual frames/inputs stay mounted in the shared geometry layer. Pickup follows the live pointer
for 220ms; return uses uniform scale for 220ms, and accepted flight interpolates translation and
dimensions for 240ms without nonuniform scaling. History uses 240ms and composition changes
380ms, with the approved easing. No animation owns layout storage or plugin execution. A parked
pointer sleeps after pickup. Dividers between horizontally adjacent widgets optionally snap at center with the
approved 7px entry/14px exit hysteresis; individual solver gestures remain fractional.
This is 50-percent width equalization of a horizontally adjacent pair, not the historical
general edge/center/size guides or Alt bypass. Earlier guide wishes in #3/#10 remain for
scope conciliation; their absence here is not automatically regression or approved cancellation.

The active picture suppresses only its ghosted view's FLIP through landing/return, so the
measured client rectangle is the final engine projection. Other views retain their normal
motion. Destination clipping and responsive content also converge before the live view is
revealed. Native pointer capture does not own hit-testing: visible, clipped session reservations
resolve before a general region, including invalid reservations that must reject without a
free-space fallback. Click and drop share current-identity exact-slot validation. Sidebar
reservations belong to their originating session bar; transient hover never selects a slot,
opens a panel or enters saved state. Eligibility is probed on hover-target/context changes,
then revalidated on release; hover never runs the packing solver.

`useCatalogAvailability` caches real command feasibility for visible catalog cards and inline
destinations. Geometry probes pause during a held gesture; bar, runtime and surface changes
still refresh eligibility. Drop uses the same command again against its current destination.

The approved chrome uses 11px horizontal/9px vertical spacing, a separate 48px rail,
180–430px Sidebar content (initial 283px), a 238px peek, 125–250px Bottom (initial 167px),
480px editor and 25px status bar with host content. Sidebar dimensions exclude the rail.
Sidebar's inner content uses 15px per side. `useSurfaces` centralizes measured origins, native
scrollbar reservation and actual region space; collapse clipping is separate from frozen logical width. The old
15px-all-sides and 15px-status contract is preserved below as historical alpha.12 chrome.
Effective bounds clamp to the viewport; Sidebar reserves rail plus minimum Main space.
Collapsing Sidebar preserves its rail and user-bar actions; optional plugin-authored rail
actions are a future SDK scope (#31), not inferred from Sidebar region eligibility.
Current region pointer resize uses capture and a 4px activation threshold; collapse distance
is 48px beyond the effective minimum. Escape/cancel/lost capture/region resize restore the
gesture request. Keyboard steps are 10px (Shift 40px), Home/End select bounds, and Enter/Space
toggle visibility; keyboard confirmation publishes on blur. These are the current
`workbench/region-policy.ts` and `useRegions.ts` rules, distinct from the historical ones below.

## Approved alpha.13 correction adapters

Host declarations may specialize `regionMin` by region: Sidebar width 150px and
eligible Bottom height 105px match the measured content at 180/125px chrome minima.
Main and legacy constraints retain their original minima. Projection, codec, transfer,
bar configuration and exact slot filling resolve the same declaration; the solver's
move-size invariant and collision/clearance checks are unchanged. Responsive container
styles adapt bundled content without scaling it or replacing it with recovery UI.

New activations allow fourteen custom bars plus protected Home; up to 100 custom bars may be
saved in addition to Home. The codec still accepts up to twenty active legacy custom bars, preserving their
order, identities and positions. Editing/reduction is allowed above fourteen, but any
count-increasing activation is rejected. Incompatible historical Sidebar memberships
still enter existing recovery without modifying original bytes; no silent repair is added.

Format pending state compares canonical layout/views/bars/chrome/slots, excluding active
bar visits and library metadata. Intention history additionally captures typed reversible
host state (project display name, theme, snap and native Properties model); locale and
external plugin actions/publications remain outside it. Those local preferences retain
their existing separate keys, not a new atomic storage envelope. Cancel and checkpoint
restore the host stores; preference write failure is reported while keeping session state.

Scroll direction flags use coalesced local scroll/content/resize observation, never a global
polling loop. Notification state is a bounded twenty-item in-memory reducer, initially empty,
fed by real native inventory changes/errors; it does not create a backend or persisted news.

## Composition capture and restoration — alpha.14

New saves use format plus widget associations. Main and Bottom have explicit scopes;
Sidebar contributes optional width only, never its bars, widgets or pin state. Logical
visibility supplies defaults: collapsed panels begin unchecked but remain eligible to include.
Opening/changing the capture dialog does not itself confirm temporary Edit chrome.

Restoration filters even historical chrome patches by that component contract. An included
Bottom may restore its height and inclusion; omitted regions retain canonical placements,
references and visibility through checkpoint/Conclude. Widgets cannot take a single-view
presence from an omitted region. Format first arranges the current included widgets; repeating
Format can replace them with session reservations. Click, catalog and existing-view moves share
current-identity exact-slot admission, reject invalid slots without free-space fallback and
record accepted filling/removal as one reversible intention. Reservations are never executable
persisted widgets. See `src/shared/workbench/compositions.ts`, `src/shared/workbench/slots.ts`
and `src/renderer/src/workbench/EditorPanel.tsx`.

## Current continuous solver — Issue #29 with host adapters from Issue #2

The continuous algorithms originated in alpha.12. Current host declarations, projection,
organization and transaction rules above take precedence over the historical delivery
contracts preserved later; no mandatory cell engine has been reintroduced.

Mandatory cell placement is superseded. The only active renderer is App → freeform/; no grid
metrics, cell rounding, square requirement, row count or column count participates in placement.
The workbench still uses structural CSS grid to arrange peer regions, independently of widgets.
Pure TypeScript in src/shared/freeform owns rectangles in CSS pixels (including fractional pixels),
region ownership, constraints, collision, projection, transfers, codecs and storage adapters.

### Coordinates, constraints and regions

Coordinates start at the measured inner content origin. Current Main/Bottom chrome uses 11px
horizontal/9px vertical spacing; Sidebar content has 15px per side. Borders and native scrollbar
reservation are measured separately rather than assuming a universal 15px inset.
Bounded Main retains its chrome insets; expanded Main omits the right inset and uses a native
thin horizontal scrollbar only when content overflows. Its normal reservation is measured.
Sidebar has one vertical scroll owner containing navigation and the occupied placement world;
width follows its inner content area, including native scrollbar reservation. Bottom and its
placement port use overflow:clip, which prevents even programmatic/focus scrolling. Its eligible
summary/chart fixtures adapt to the available height without internal scrolling or removing text.
No overlay border/mask, duplicate 9px inset, range-input scrollbar or phantom world-end margin exists.
The clearance predicate reuses the project's legacy continuous tooClose: 10px on a separating axis
whose orthogonal interiors intersect, with the historical diagonal-only exception. Exterior margins
are independent of widget clearance.

Constraint records declare min/default/max CSS-pixel dimensions, resize axes, eligible regions,
overflow and region-responsive behavior. constraintVersion:1 binds saved geometry to this bundled
contract; imported JSON cannot grant permissions or override minima. Actual geometry and preferred
dimensions are separate. Main supports both axes/eight handles. Sidebar fixes x=0 and follows inner
width, editing y/height; Bottom fixes y=0 and follows inner height, editing x/width. Navigation and
toolbar remain structural. Summary/chart are eligible in all regions; queue is Main-only; other
fixtures support Main/Sidebar. The host registry specializes Sidebar width minima to 150px and
eligible Bottom height minima to 105px; the base/legacy Summary/chart minimum remains 112px.
Thus approved Bottom 125px chrome can show its native content instead of mandatory recovery.
A collapsed or genuinely too-small region retains the composition with explicit recovery.

The minimal transfer route uses the same solver, accepts only eligible feasible targets and rejects
atomically. Pointer drops and host catalog/destination controls share the same eligibility rules.
All fixture frames have one stable React parent. Per-frame CSS clipping maps their region origin and
scroll offsets into Work Area coordinates; moving between regions does not change component keys or
portal roots. Offscreen frames remain mounted with content-visibility:auto and inert focus handling.
There are three constant-size scroll worlds, not empty cells. The host has seven synthetic types,
initially four Main/two Sidebar/one Bottom. Plugin widgets are integrated through the host
catalog/placement layer as Main-only single-view cards; `usePlugins` remains App-owned and
geometry never manages Workers. Host types include card/seamless appearance infrastructure,
but current registered types are card and manifest/API v1 does not expose appearance, regions,
category, multi-area presence or rail contributions to authors.

### Direct manipulation and bounded search

The newer project-owned grid solver supplies the operational phases/ranking, adapted to continuous
contact edges: forward local push; impacted-axis boundary compression; preferred-size nearby contact
slots; bounded multi-widget rearrangement. Each complete solution ranks affected widget count,
Manhattan travel, spatial-order changes and preference error. Contact combinations replace integer
slot enumeration. Forward candidates come only from actual locked contacts; duplicate coordinates,
out-of-bounds axes and collisions with locked neighbors are pruned before sorting. Broad fallback
settles tall constrained victims first and explores branches recruiting fewer neighbors first.
Complete-solution ranking remains authoritative. Local travel uses twice the affected widget's
largest dimension plus gap, enlarged only by its directly blocking rectangle to allow thin widgets
to reach that adjacent contact edge; all broad travel is capped at 1024px. Current-size direct
slots accompany preferred slots. There are at most 512 states per phase and 8192 probes per operation
(including rejected probes). This is conservative bounded
search, not a complete global packer. Failure keeps the last valid preview and reports the constraint.
No gravity or compulsory compaction exists. A pointer gesture solves every intention from its complete
starting snapshot, so reversing while held restores the entire initial geometry. Pointerup accepts all
actual positions and sizes in memory: settlement replaces compressed preferred dimensions with actual
dimensions, preserving unchanged records. The next gesture cannot resurrect older geometry. Legacy v1
preferences remain decodable; load/import/edit entry normalize them in memory without changing bytes.
Widget defaults remain independent registry values. Explicit Edit checkpoint/Conclude writes
settled geometry and preferences; the normal paired-divider path is the separate exception above.

Catalog/transfer insertion first reuses a vacant seed. When none exists, a distinct `insert`
intention validates every existing peer, adds only the new active rectangle and runs the same
bounded push/compression/rearrangement phases. The complete result must satisfy ordinary
geometry validation; failure never enters the transaction. Seed attempts and fallback share
the 8192-probe/2048-state budget. This is continuous insertion, not prototype row/column math.

Pointer gestures coalesce intentions once per animation frame and flush the final intention on
release; they derive every update from their original snapshot, include scrollLeft/scrollTop and
keep real CSS-pixel deltas without rounding or snapping. Opposite resize edges stay anchored. Edge
auto-scroll advances concrete active intention; only successful occupied rectangles grow the world.
Escape, pointercancel, lost capture or changed region measurements restore the gesture source.
Physical frame measurements distinguish a real region resize from native scrollbar reservation.
A transient hidden native probe measures the actual horizontal scrollbar reservation. If a solution
would introduce that scrollbar, neighbor fitting and reflow use the future client height before commit,
sharing the original 8192-probe/2048-state operation budget. Resize candidates retain the stable active
rectangle's opposite edges, even when neighbors need responsive fitting. Direct previews bypass a second
projection while ResizeObserver catches up. Releasing a held extent refreshes native scroll mapping
before paint; removing a scrollbar rebases the reference without changing the accepted rectangles.
Blocked intentions retain the last valid anchored preview. Cancellation restores only that gesture's
source, including its reference. Cancel editing restores its last confirmed checkpoint.

Experimental widget grip/resize keyboard controls exist only when Vite's build-time import.meta.env.DEV
is true. Development retains handle Tab stops, focused outlines and 1px arrows (Shift:10px). Each key
action settles independently from the synchronous live draft. Production removes these handle Tab stops,
ignores their arrow shortcuts and suppresses their focus outlines, retaining all pointer handles. There
is no production opt-in. Normal forms, buttons, Settings, dialogs, region splitters and Tab navigation
retain their native keyboard behavior in both builds; paired dividers also retain production
keyboard operation. No native security setting or bridge changes.

### Stable projection, expansion and recovery

Horizontal expansion defaults OFF, remembered independently under geppio:layout:expansion:v1.
Both settings use the same rectangles/solver. Expanded Main preserves horizontal coordinates
and dimensions across width changes; world width is max(visible width, furthest occupied right edge),
without trailing padding. Browser integer scrollWidth may round its final subpixel (under one CSS px).
During pointer capture only, hold Main's starting occupied width or Sidebar's occupied height so
contraction-induced native scroll clamping cannot feed back into the gesture's delta. Release
contracts immediately to current occupancy.
Sidebar never acquires arbitrary horizontal placement. Its y coordinates and heights are preserved
across viewport changes; occupied bottom edges define finite vertical extent. Navigation and widgets
share one scroll owner, and renderer mapping includes the navigation offset. Bottom ignores Main's
expansion option and always solves/projects into actual finite dimensions. Coordinates/worlds are capped at 100000px,
individual dimensions at 4096px and input at 64 KiB. Legacy freeform documents require seven
known fixture identities; current workbench documents validate dynamic qualified views against
their host registry, within the same 16-view engine cap.
No pixel/cell-count-dependent arrays are allocated.

Bounded presentation projects from one stable canonical/edit source and each region's recorded inner
reference size. Continuous interval fitting retains source separation DAGs in each axis, preserves
edge affinity and intentional normalized gaps where feasible, and scales/compresses dimensions down
to declared pixel minima. Binary fitting replaces integer steps. Equal source/reference/measurements
produce equal results; A→B→A never accumulates drift. At an unchanged reference, validated direct geometry
passes through exactly: two-dimensional diagonal clearance must not be replaced with stricter per-axis
gap constraints that move anchored edges. Empty spaces do not attract widgets. Sidebar
width/Bottom height track the measured cross axis. If the source relationships/minima cannot fit,
retain source rectangles and warn rather than overlap/delete/shrink below minima. Main can use a
finite recovery scroll area. Bottom retains its finite world, keeps infeasible content mounted but
withheld, and exposes enlargement plus edit-only transfers to Main. Restore region space to recover.
Save is blocked while an occupied region is infeasible. Surface measurements run on resize/scroll,
not every React commit; size-only projection memoization avoids work on pure scroll/selection updates.
Scrolling, window/region resizing, collapse and preference toggles never write layout positions.

### Current persistence and historical data

`geppio:workbench:v1` is the active host envelope. It stores validated layout plus typed
organization (views, bars, compositions, favorites/order/default and confirmed chrome), not
session slots, selection, previews or history. Registry declarations remain authoritative;
imported metadata cannot grant capabilities or invent executable widget types. Unknown or
incompatible plugin/view associations preserve bytes and enter explicit recovery; the existing
incompatible-membership recovery does not promise selector removal (#2 P19).

The transaction adapter validates, acquires a same-origin Web Lock, compares observed bytes and
uses generation tokens to cancel stale queued writes. Quota, unavailable storage and conflicts
preserve the draft and prior bytes. This coordinates cooperative writers, not malicious code
sharing origin authority or every OS failure mode. Save editing advances Cancel's checkpoint
without leaving Edit; Conclude writes a slot-free document and exits. Normal bar/chrome updates
and accepted bilateral pair commands have guarded paths without adopting an unrelated draft.
Theme/display name/snap/Properties remain separate local stores or session state, not one atomic
multi-key transaction. None of these persists a plugin's own notes or chat sessions (#23).

`geppio:layout:freeform:v1` is the preserved alpha.12 source and stores {schemaVersion:1,engine:'freeform',constraintVersion:1,reference,
placements}. reference records CSS-pixel inner sizes for Main/Sidebar/Bottom; each placement records
id, region, x/y/width/height and preferred width/height. Validation enforces exact registry membership,
ownership/eligibility, finite coordinate/document limits, minima/maxima, cross-axis rules and clearance.
Corrupt/unknown future schemas are withheld recoverably, with unchanged original bytes. Unknown or
missing widgets reject the document rather than silently dropping content. Themes stay independent.

The active workbench does not write old fractional v1, responsive grid v2, horizontal v1 or
freeform v1 keys. Settings exposes separate historical/freeform preview choices rather than
silently selecting among saved customizations. Conversion is a read-only preview; only explicit
confirmation adopts it into the workbench envelope without changing the originals.
v1 uses its documented 960×620 reference. Since grid/horizontal schemas never stored CSS viewport
sizes, conversion visibly uses documented stable pitches (70px responsive, 62px horizontal), removes
the historical 10px trailing cell gutter and never rounds to a grid. Current content minima/clearance
are enforced; impossible conversions reject with originals intact. Import accepts freeform or one
explicitly selected historical JSON copy; stored historical keys also have separate preview buttons.
Cancel abandons adoption. Full process restart reads the validated workbench envelope and its
confirmed chrome; old alpha.12 session-only sizing is not the current persistence contract.
Installed package/enabled preferences are separate native state, and the SDK still supplies no
generic persistence for plugin-owned content.

### Historical alpha.12 workbench chrome

The following record describes the alpha.12 delivery only. The current chrome, region-specific
host minima, persistent rail, 25px status bar and confirmed organization state above supersede it;
these earlier values must not be restored as fixes to the current application.

The alpha.12 renderer used a 15px inset on each region (omitting Main's right inset when
expanded), seven built-in fixtures and a separate trusted-plugin tray. Its independent
`geppio:layout:freeform:v1` source and session-only chrome predated the workbench envelope,
catalog-integrated plugin views and guarded normal-mode pair commands. Those delivery facts
are history, not missing work to recreate in the current host.

Open Sidebar/Bottom request initial/minimum sizes of 230px/120px and keep the established maximum
bounds (including 300px/20% and 180px/25% caps,
Main reserve and safe relaxed minima in tiny viewports). Dragging 20px past the functional minimum
collapses completely; header controls reopen the prior requested size, clamped for the viewport.
Arrow steps, Shift, Home collapse and Escape/capture cancellation are supported. A separate empty
15px status strip spans the window below Work Area and cannot enter widget collision/scroll geometry.
Its subtle border and raised tone distinguish it in both themes without increasing its 15px total.
Its contents are an extension point, not invented indicators. The test panel retains Overlay/Docked.

## Historical alpha.7–alpha.11 engines (inactive placement)

The following records describe superseded experiments and their retained codecs/tests. They are
historical evidence, not active product requirements. Their old renderer modules are isolated from
App/Settings and remain reference code; old UI smoke is not invoked against the freeform app.


### Historical horizontal engine — Issue #28

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
