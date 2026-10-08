# Layout contract and prototype choices

## Representation

A Main placement contains `{id, x, y, width, height}` in normalized units relative to the logical canvas. The valid extent is `[0,1]`; arbitrary finite fractions are allowed. This is not a hidden fixed-column grid. Persisted schema 1 includes `theme` and all seven known Main placements. The entire payload is limited to 64 KiB.

The parser rejects malformed JSON, unsupported versions/themes, invalid numbers, missing/duplicate/unknown widget IDs, too-small rectangles, out-of-bounds geometry and overlaps. Extra unknown properties are not executable and are discarded. Exact fixture-count validation is intentional for this prototype, not a generic plugin layout format.

Local storage key: `geppio:layout:v1`, on the current renderer origin. Vite development and custom-protocol preview have separate drafts. Issue #6 provides bounded legacy profile/origin recovery described in [identity recovery](../development/renaming.md); it preserves destination values and keeps schema v1. Other browser/session/profile moves are not automatically supported. Malformed stored values remain untouched until the user explicitly saves a replacement.

## Edit transaction

Normal mode disables the movement/resize handlers. Entering Edit starts from the committed layout and attempts non-persistent spacing normalization. Legacy v1 geometry still loads with touching edges; decoding/storage recovery retain their old overlap-only validation. New edit previews require a provisional 10 CSS-pixel separation between widgets. If normalization cannot fit, the old draft remains visible with a recoverable warning; the user can reduce/move widgets or Cancel. Save validates both the old schema and current spacing before writing. No normalization is persisted until explicit Save, and Cancel restores the exact committed geometry.

Each pointer gesture records a stable snapshot of the entire draft. Every frame solves against that snapshot, including neighbour movement and adaptive resizing; reversing the pointer cannot accumulate shrink or drift. Only fully valid results become the draft. A blocked candidate highlights the active widget and reports missing space while retaining the last valid preview. Pointer-up keeps that preview; pointer cancel, lost capture or Escape restore the entire gesture snapshot. Escape outside a gesture and Cancel return to the committed layout. A storage failure leaves the error visible rather than claiming durable persistence. Theme changes persist the committed placement set, not an unfinished edit. While editing, a logical-canvas size change cancels an active gesture and rechecks spacing as an edit preview; normal mode leaves legacy geometry untouched.

JSON import is bounded and validated before showing a draft. Imported placements do not silently replace the theme. Import is not a plugin/package loader. The baseline has no layout-export UI; do not describe it as a full portable layout manager.

## Drag, snap and constraints

Movement uses pointer capture and canvas-relative coordinates. Neighbour/region edges and centres from the gesture-start snapshot can produce guides within a 7 CSS-pixel tolerance normalized against measured canvas dimensions. Move and all eight directional resizes support optional snap. Resize targets include the moving edge/centre, another widget's width/height even across different rows/columns, and gap-offset neighbour edges. Opposite anchors and min/max/axis permissions remain fixed during snap. A checkbox disables snap; Alt bypasses it temporarily, preserving precise freeform fractions. Guide kinds distinguish alignment, clearance and equal size. Header arrow keys provide movement during editing; Shift moves farther. Eight transparent edge/corner buttons offer directional cursors and accessible labels only in Edit. Focus a resize zone and use arrows to move its edges; Shift increases the step. Corners control both axes and win their hit zones; the move grip remains separate. There are no resize icons.

Persisted legacy rectangles may touch but never overlap. New editor geometry uses `tooClose` / `canPlaceWithGap`: if interiors overlap on one axis, their separating axis must have at least 10 logical CSS px. A diagonal-only pair with no projected interior overlap, including corner contact, does not require extra diagonal clearance. No canvas-edge margins are invented. `canvasGap` converts independently to `10 / measuredWidth` and `10 / measuredHeight`, including the minimum/scrolling canvas. It never uses physical monitor pixels or CSS margins. The trial spacing is provisional and needs owner visual acceptance.

GeppIO owns the pure continuous solver and resize/snap math in shared layout code. GridStack.js and React Grid Layout are conceptual references only, with no runtime dependency or copied code. The small geometry constraint type separates min/max dimensions and allowed resize axes from content, region, presentation and plugin authority. All seven existing Main fixtures currently allow both axes with their retained v1 minima and canvas-sized maxima; fixed-size/one-axis constraints are covered by tests without changing old layout compatibility.

Planning context separates movement, directional resize and spacing normalization and supplies current logical canvas dimensions. The heuristic locks the requested active rectangle and searches nearby contacts with stable ID tie-breakers. Resize first compresses affected neighbours on the gesture axes, keeping their orthogonal row/column and far edge where feasible. With insufficient slack it can reduce to the permitted minimum and push locally; only after axis-local search fails does it consider lateral adjustments. Movement searches dominant-axis forward pushing, then other local displacement, then adaptive local options. Normalization trims/pushes tight neighbours in the draft.

Candidate ranking penalizes reverse travel, crossing previous neighbour order, distance and collateral shrink. Contact travel is bounded to the maximum of each neighbour's dimension on that axis and 0.15, plus its clearance; this is an engineering locality heuristic, not a product distance guarantee. There is no global search over remote holes or canvas corners. Final fallback combines nearby contacts. Unaffected widgets retain their geometry except when an old tight pair itself requires explicit spacing normalization. Work is capped at 16 rectangles, three phases of 1024 search states (3072 total), 65536 candidate probes per phase and a recursion depth bounded by the widgets. Every returned composition satisfies finite bounds, constraints, spacing and no overlap. Search can conservatively reject feasible packing; diagnostics distinguish invalid input, unavailable space and exhausted search. This is not a globally optimal or exhaustive packing claim. Calls without editor context retain the zero-gap geometry helper convention; application edit callers always supply measured context.

Solver diagnostics and intermediate placements are session-only and never added to schema v1 or the storage key. Main fixtures are the only layout-engine participants; trusted Counter/Pulse contributions keep their existing separate rendering and lifecycle. Cross-region drag/drop, dock/overlay capability schemas and third-party layout authority remain separately scoped.

## Regions and presentation

The fixed header is outside Work Area. Sidebar/Main/Bottom are peers; CSS controls their visual relationship. The Main presentation demo supports Docked/Overlay, four edges and floating Overlay. Docked changes available viewport space; Overlay is layered inside Main. Bottom remains outside Main, so a bottom panel cannot cover it by default. Closing the demo leaves a persistent reopen control in Bottom.

The demo's content is synthetic. No terminal shell runs. Panel mode, anchor and visibility are session-only demonstration state; only the Main placements/theme are persisted. A future widget capability schema must separate presentation, anchor, collapsibility, visibility and allowed resize axes.

## Small windows and animation

The canvas has a provisional minimum logical display extent of 960 by 620 CSS pixels and can scroll; the native window also has a minimum size. This avoids pretending proportional geometry can satisfy every content minimum. It is a fallback to evaluate, not final responsive behavior. Docking may cause scrolling rather than shrinking widgets below that minimum.

Motion animates settled React layout transitions; continuous pointer response bypasses layout tweening. Reduced-motion preferences are respected. No performance result, collision solver quality or native web-surface animation guarantee follows merely from including Motion.

Neighbour animation polish remains deferred after the owner's alpha.6 UX rejection. This corrective continuation changes geometry/priority/spacing/guides, not Motion behavior or dependencies. Cursor-owned rectangles continue to respond without interpolation delay.

## Open design questions

Resolve required gaps, adaptive smaller-window composition, region resizing, reorder/move across regions, richer guide types, persistence of presentation and eventual plugin widget constraints using Issues and observed prototype behavior. These are not hidden requirements already implemented by this version. The finite Main heuristic and eight-direction resizing belong to Issue #16 / alpha.6, with algorithm investigation in #10; owner visual acceptance remains separate.
