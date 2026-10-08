# Layout contract and prototype choices

## Representation

A Main placement contains `{id, x, y, width, height}` in normalized units relative to the logical canvas. The valid extent is `[0,1]`; arbitrary finite fractions are allowed. This is not a hidden fixed-column grid. Persisted schema 1 includes `theme` and all seven known Main placements. The entire payload is limited to 64 KiB.

The parser rejects malformed JSON, unsupported versions/themes, invalid numbers, missing/duplicate/unknown widget IDs, too-small rectangles, out-of-bounds geometry and overlaps. Extra unknown properties are not executable and are discarded. Exact fixture-count validation is intentional for this prototype, not a generic plugin layout format.

Local storage key: `geppio:layout:v1`, on the current renderer origin. Vite development and custom-protocol preview have separate drafts. Issue #6 provides bounded legacy profile/origin recovery described in [identity recovery](../development/renaming.md); it preserves destination values and keeps schema v1. Other browser/session/profile moves are not automatically supported. Malformed stored values remain untouched until the user explicitly saves a replacement.

## Edit transaction

Normal mode disables the movement/resize handlers. Entering Edit starts from the committed layout. Pointer movement operates on a draft; valid drops keep that draft, invalid drops revert the particular move. Save writes a validated snapshot. Cancel returns to the committed layout. A storage failure leaves the error visible rather than claiming durable persistence. Theme changes persist the committed placement set, not an unfinished edit.

JSON import is bounded and validated before showing a draft. Imported placements do not silently replace the theme. Import is not a plugin/package loader. The baseline has no layout-export UI; do not describe it as a full portable layout manager.

## Drag, snap and constraints

Movement uses pointer capture and canvas-relative coordinates. Neighbour/region edges and centres can produce guides within a small screen-space tolerance normalized against canvas dimensions. A checkbox disables snap; Alt bypasses it temporarily. The prototype does not snap resize handles or enforce equal spacing. Header arrow keys provide movement during editing; Shift moves farther.

Normal rectangles may touch but not overlap. No automatic repacking, displacement of unrelated widgets or general constraint solver is implemented. The bottom-right handle resizes with fixture minima. Multiple resize axes/handles, custom minima by content and keyboard resizing can be extended in a separate task. Current minimums are logical fixture values, not a final plugin min-size API.

## Regions and presentation

The fixed header is outside Work Area. Sidebar/Main/Bottom are peers; CSS controls their visual relationship. The Main presentation demo supports Docked/Overlay, four edges and floating Overlay. Docked changes available viewport space; Overlay is layered inside Main. Bottom remains outside Main, so a bottom panel cannot cover it by default. Closing the demo leaves a persistent reopen control in Bottom.

The demo's content is synthetic. No terminal shell runs. Panel mode, anchor and visibility are session-only demonstration state; only the Main placements/theme are persisted. A future widget capability schema must separate presentation, anchor, collapsibility, visibility and allowed resize axes.

## Small windows and animation

The canvas has a provisional minimum logical display extent of 960 by 620 CSS pixels and can scroll; the native window also has a minimum size. This avoids pretending proportional geometry can satisfy every content minimum. It is a fallback to evaluate, not final responsive behavior. Docking may cause scrolling rather than shrinking widgets below that minimum.

Motion animates settled React layout transitions; continuous pointer response bypasses layout tweening. Reduced-motion preferences are respected. No performance result, collision solver quality or native web-surface animation guarantee follows merely from including Motion.

## Open design questions

Resolve required gap/overlap policy, adaptive smaller-window composition, region resizing, reorder/move across regions, richer guide types, resize keyboard access, persistence of presentation and eventual widget constraints using Issues and observed prototype behavior. These are not hidden requirements already implemented by this version.
