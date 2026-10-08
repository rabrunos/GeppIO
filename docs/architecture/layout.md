# Layout contract and prototype choices

## Representation

A Main placement contains `{id, x, y, width, height}` in normalized units relative to the logical canvas. The valid extent is `[0,1]`; arbitrary finite fractions are allowed. This is not a hidden fixed-column grid. Persisted schema 1 includes `theme` and all seven known Main placements. The entire payload is limited to 64 KiB.

The parser rejects malformed JSON, unsupported versions/themes, invalid numbers, missing/duplicate/unknown widget IDs, too-small rectangles, out-of-bounds geometry and overlaps. Extra unknown properties are not executable and are discarded. Exact fixture-count validation is intentional for this prototype, not a generic plugin layout format.

Local storage key: `geppio:layout:v1`, on the current renderer origin. Vite development and custom-protocol preview have separate drafts. Issue #6 provides bounded legacy profile/origin recovery described in [identity recovery](../development/renaming.md); it preserves destination values and keeps schema v1. Other browser/session/profile moves are not automatically supported. Malformed stored values remain untouched until the user explicitly saves a replacement.

## Edit transaction

Normal mode disables the movement/resize handlers. Entering Edit starts from the committed layout. Each pointer gesture records a stable snapshot of the entire draft. Every frame solves against that snapshot, including neighbour movement and adaptive resizing; reversing the pointer cannot accumulate shrink or drift. Only fully valid results become the draft. A blocked candidate highlights the active widget and reports missing space while retaining the last valid preview. Pointer-up keeps that preview; pointer cancel, lost capture or Escape restore the entire gesture snapshot. Escape outside a gesture and Cancel return to the committed layout. Save validates and writes the entire composition. A storage failure leaves the error visible rather than claiming durable persistence. Theme changes persist the committed placement set, not an unfinished edit.

JSON import is bounded and validated before showing a draft. Imported placements do not silently replace the theme. Import is not a plugin/package loader. The baseline has no layout-export UI; do not describe it as a full portable layout manager.

## Drag, snap and constraints

Movement uses pointer capture and canvas-relative coordinates. Neighbour/region edges and centres from the gesture-start snapshot can produce guides within a small screen-space tolerance normalized against canvas dimensions. A checkbox disables snap; Alt bypasses it temporarily. The prototype does not snap resize handles or enforce equal spacing. Header arrow keys provide movement during editing; Shift moves farther. Eight transparent edge/corner buttons offer directional cursors and accessible labels only in Edit. Focus a resize zone and use arrows to move its edges; Shift increases the step. The opposite edge stays anchored; corners control both axes. Corner targets have precedence over side targets and the move grip remains separate. There are no resize icons.

Rectangles may touch but never overlap. GeppIO owns the pure continuous `reflow` and `resizeDirectional` functions in shared layout code. GridStack.js and React Grid Layout are conceptual references only, with no runtime dependency or copied code. The small geometry constraint type separates min/max dimensions and allowed resize axes from content, region, presentation and plugin authority. All seven existing Main fixtures currently allow both axes with their retained v1 minima and canvas-sized maxima; fixed-size/one-axis constraints are covered by tests without changing old layout compatibility.

The heuristic locks the requested active rectangle, then recursively relocates impacted neighbours using contact coordinates and stable ID tie-breakers. A complete displacement-only attempt precedes adaptive shrinking of affected resize-eligible widgets. Candidates prefer less shrink/travel and avoid reverse travel where possible. Every returned composition is verified for finite bounds, minima/maxima, allowed axes and no overlap. Unaffected widgets retain their geometry. Work is capped at 16 rectangles, 2048 search states per phase (4096 total), 65536 candidate probes per phase and at most one recursion level per impacted widget. Search cannot expand the logical extent beyond `[0,1]`; it can conservatively reject feasible but difficult packing. Diagnostics distinguish invalid input, unavailable space and exhausted search. This is a bounded prototype heuristic, not a globally optimal or exhaustive packing claim.

Solver diagnostics and intermediate placements are session-only and never added to schema v1 or the storage key. Main fixtures are the only layout-engine participants; trusted Counter/Pulse contributions keep their existing separate rendering and lifecycle. Cross-region drag/drop, dock/overlay capability schemas and third-party layout authority remain separately scoped.

## Regions and presentation

The fixed header is outside Work Area. Sidebar/Main/Bottom are peers; CSS controls their visual relationship. The Main presentation demo supports Docked/Overlay, four edges and floating Overlay. Docked changes available viewport space; Overlay is layered inside Main. Bottom remains outside Main, so a bottom panel cannot cover it by default. Closing the demo leaves a persistent reopen control in Bottom.

The demo's content is synthetic. No terminal shell runs. Panel mode, anchor and visibility are session-only demonstration state; only the Main placements/theme are persisted. A future widget capability schema must separate presentation, anchor, collapsibility, visibility and allowed resize axes.

## Small windows and animation

The canvas has a provisional minimum logical display extent of 960 by 620 CSS pixels and can scroll; the native window also has a minimum size. This avoids pretending proportional geometry can satisfy every content minimum. It is a fallback to evaluate, not final responsive behavior. Docking may cause scrolling rather than shrinking widgets below that minimum.

Motion animates settled React layout transitions; continuous pointer response bypasses layout tweening. Reduced-motion preferences are respected. No performance result, collision solver quality or native web-surface animation guarantee follows merely from including Motion.

## Open design questions

Resolve required gaps, adaptive smaller-window composition, region resizing, reorder/move across regions, richer guide types, persistence of presentation and eventual plugin widget constraints using Issues and observed prototype behavior. These are not hidden requirements already implemented by this version. The finite Main heuristic and eight-direction resizing belong to Issue #16 / alpha.6, with algorithm investigation in #10; owner visual acceptance remains separate.
