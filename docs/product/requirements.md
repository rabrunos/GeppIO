# Product requirements

## Purpose and scope

**GeppIO** is a Windows-first local desktop workbench, with its product identity approved in Issue #6 and technical namespace `geppio`. The owner wants to compose useful workspaces from widgets and, later, community plugins. This is a new codebase, not an adoption of the old Electron prototype or of the review HTML application. There is no application account, backend, subscription integration or cloud sync in this foundation.

The initial product goal is to validate the workbench with approximately ten synthetic widget formats before building real ChatGPT, Codex, Git or terminal integrations. Existing prototype screenshots are visual inspiration, not a specification of every header action. The fixed header's final content is intentionally deferred to owner experimentation.

## Decision provenance and interpretation

The owner supplied an architectural review exported on 2026-10-07 at 18:03:05 UTC and then requested this local materialization. It covered 58 items: 56 agreements and two requests for discussion, with 19 item comments and two category notes. Agreements with comments are conditional requirements, not unconditional approval of every example. Historical `contextStatus` labels do not override the explicit responses.

This document normalizes the resulting product knowledge; it is not a second progress/decision-index database. The raw review, screenshots with unrelated context, old source ZIPs and BootCrate intake are intentionally not shipped. Active task state and acceptance belong in GitHub Issues once the repository exists.

Two discussion items remain significant:

- Item 12: the owner proposed `Workbench -> Fixed Header + Work Area -> Sidebar / Main / Bottom` without a conceptual Content Area owning Bottom. The prototype uses that sibling model as a reversible implementation of the proposal. Do not label the open discussion as definitively accepted.
- Item 16: the owner asked what a reusable Region meant. Use small shared concepts and explicit responsibilities, not a universal region/plugin framework. Differences between regions are allowed. Broader abstractions remain a design discussion.

The request to begin implementation authorizes a bounded foundation with provisional choices. It does not silently settle the two discussions or authorize all future plugin capabilities now.

## Platform and visual stack

Electron, TypeScript, React, Tailwind CSS, Heroicons and Motion are the selected direction. TypeScript is mandatory for product and project tooling code. Runtime validation is still required at data/native boundaries; erased TypeScript types are not validation of untrusted JSON.

Windows is the first supported operating-system target. A successful Linux geometry test does not prove Windows installation, desktop behavior or Codex permission enforcement. Six or seven simultaneously visible widgets and background activity must eventually be measured with real representative content. No RAM budget or performance guarantee is inferred from using Electron or React. A fake chart is not telemetry.

The visual system should be elegant, coherent and reusable by widgets. Themes are intended to change broad visual identity, not functionality. Begin with design tokens and dark/light examples. Future theme packages must not gain script or native permissions merely because they are called themes. Permission identity and scope must remain legible and trustworthy.

Motion is intended for structural transitions, while CSS handles simple states. Respect reduced motion. During active drag/resize, response to input matters more than decorative animation. Do not assume animations of React DOM nodes also animate future native WebContentsView surfaces.

## Workbench and regions

The fixed header belongs to the workbench but not to the movable widget canvas. Sidebar, Main and Bottom are visually distinct regions coordinated by the workbench. The Sidebar extends alongside Main and Bottom; Bottom occupies the lower area to the right of Sidebar. Bottom remains useful as a persistent region and a boundary outside Main.

Main supports two-dimensional rectangular compositions, not just equal columns. An edge panel scoped to Main uses Main's bounds and appears above Bottom without knowing what Bottom contains. Region placement, available space and z-order must have clear owners. Region is a lightweight shared concept, not a requirement for arbitrary new regions in this version.

## Layout and interaction requirements

**Intentional editing.** Normal use must not accidentally move or resize widgets. The user explicitly enters layout editing, enabling title movement and eight-direction resize with integer grid snapping. Core content remains usable in normal mode. Issue #24 retains explicit Save/Cancel and accessible keyboard controls.

**Current Main grid ([Issue #24 composition contract](https://github.com/rabrunos/GeppIO/issues/24#issuecomment-6080536542)).** The owner superseded the alpha.1–alpha.6 continuous editor and fixed 12×8 viewport geometry with a GeppIO-owned responsive integer grid. Both columns and rows adapt to usable Main dimensions from one stable saved/edit source, with square cells and no Main scrolling. 12×8 remains a reference composition. Preserve sides/corners, meaningful separation/order, neighborhood, intentional gaps and no gravity. Adapt positions and actual spans together within declared constraints before displacing neighbours; viewport-only adaptation must never freely pack widgets across Main or reverse their spatial relationships. Continuous pixel density and coherent integer quantization take priority over unchanged preferred spans or marginal coverage. Preserve preferred-size intent separately. Viewport projections are reversible and never overwrite saved v1/v2 bytes; explicit Save commits the projected draft and its bounds, Cancel restores the prior source. Always center in both axes; there is no alignment preference or Development switch. Retain approved direct eight-direction resize/collision behavior separately. Constrained projections retain composition and warn about larger margins instead of lowering minima or hiding widgets.

**Constraints and collisions.** Typed per-widget grid constraints separate min/default/max size and allowed axes from content and plugin authority. Under Issue #24, Main has no gravity or hidden row growth. Move/resize uses local push, boundary compression, original preferred-size relocation and bounded minimal rearrangement; impossible attempts keep the last valid snapshot. The symmetric provisional gutter and initial row policy remain subject to owner visual acceptance.

**Window changes (Issue #24 composition refinement).** Derive responsive columns, rows, positions and dimensions from the current saved/edit composition, including recent deliberate edits; never accumulate automatic projections. Fit square pixel cells using both available dimensions, reducing symmetric gutters safely in extremely small viewports. Fine-step rendered geometry, order and cold/warm consistency matter in addition to A→B→A equality. Centering itself changes only pixel offsets, not logical units or saved bytes. Internal widget scrolling is allowed; Main scrolling and hidden row growth are not. Independently resize Sidebar width and Bottom height in pixels under Issue #26's unchanged provisional live bounds. Persisted input is validated/versioned and invalid data must not silently overwrite usable state. Integer-cell size steps and constrained-space legibility remain subject to owner visual evaluation; animation polish is deferred.

The [alpha.10 margin correction](https://github.com/rabrunos/GeppIO/issues/24#issuecomment-6082287645)
requires both topology axes to follow the actual feasible square-cell size. A constraint on one
axis must not leave an avoidable band on the other. Retain intentional empty cells within the
composition; distinguish unavoidable margins under declared limits from unused space that a
valid, composition-preserving topology can recover. Identical source, edit reference and Main
measurements must agree across maximize/restore, repeated Edit/Cancel and cold rendering.

**Presentation.** Normal widgets participate in their region. Docked panels consume region space. Overlays cover content without resizing it. Top/right/bottom/left anchors are separate from presentation. An overlay can be unanchored/floating. Collapsibility is separate from presentation and from resize capability; a permanent widget is possible. A collapsed widget must have an obvious way to reopen. Hiding UI must not be confused with stopping its future background activity.

**First fixtures.** Cards, lists, a table, a grid, a long scroll area, a form, text, toolbar-like navigation, status and a presentation panel exercise different needs. The initial registry has ten fixture definitions; seven are on Main and three cover Sidebar, Bottom and the presentation panel. They are trusted local test components, not third-party plugins.

## Implemented trusted experimental local plugins (Issue #21)

Separate from the bundled fixtures, the application already installs owner-authored/reviewed local
packages with versioned manifests into a managed directory. Settings supports install, enable/disable
and removal; new installs are disabled. Independently built examples include a counter widget and a
zero-widget background pulse. Activation/disposal runs in disposable module Web Workers, with bounded
declarative text/actions, lifecycle timeouts and message validation. No package executes in Main/preload,
and no Node, filesystem, process or generic IPC authority is supplied to plugins or the renderer.

This runtime is for trusted test plugins, not a secure community sandbox: Workers share browser
origin/storage authority, and per-plugin permission/storage/session isolation and OS resource quotas
are absent. See [plugin boundaries](../architecture/plugins.md) for implemented limits and future gates.
The following model remains future design intent, not shipped capability or approval to expand authority.

## Future secure untrusted-plugin model (not implemented)

A plugin may provide zero or many widgets, background functionality, a public interface, commands, UI extension points and generic surface modifications. Plugins without widgets are valid. Community extensions must be able to improve another plugin, including substantial layout/behavior changes where authorized.

Prefer one approachable SDK and documentation route, not separate bureaucratic systems. Public APIs, commands and UI slots have different semantics but may share the same SDK. A command may expose an existing function; an extension point identifies a place and its available context. Do not require authors to repeat the same integration contract in several places.

Use the least invasive sufficient integration: public API/command, prepared UI slot, contextual/declarative surface contribution, generic modification, and explicitly privileged scripting where genuinely needed. This is not an automatic low-to-high risk guarantee: a destructive API can be more consequential than a small visual change.

A button inserted by B into A routes to B. B may subsequently invoke C only with independent authorization. No implicit permission comes from the button's location. B may also interact with A from its own widget/background; physical insertion into A is not a prerequisite.

The Core mediates identities and grants. Grant descriptions must explain actual powers and exact targets; the author also supplies a short purpose. “Add a button” must not conceal permission to read the whole page. New privileges on update require fresh authorization. Revocation stops future operations, not retention of data already delivered.

HTML and CSS are not risk-free. Declarative controls, scoped styles and sanitized injected HTML are useful default paths, but must not prohibit ordinary interactive widgets in their own isolated environment. A sanitized inserted button can dispatch a registered action through a bridge rather than including inline executable HTML. Broad style modification and script execution need accurate distinct scopes.

A Core-supplied contextual value can be limited to a selected code block. A JavaScript isolated world separates JS variables but does not itself restrict scripts to one DOM subtree. Generic isolated scripts and Main World scripts therefore need truthful broader permissions. Performance equivalence between modes is not assumed. Main World remains a deliberate powerful escape hatch, never an automatic Electron/Node/filesystem grant.

## Authentication, secrets and native authority

External-service authentication belongs to the relevant plugin, not a global app login. A future secret facility should avoid each plugin inventing a plain-text token file. Secret ownership is exclusive; there is no ordinary permission for another plugin to read the owner's stored credential. An authorized operation may use a credential inside its owner and return only the allowed result.

Windows OS-backed encryption alone is not complete isolation from other code running as the same OS user. A secret exposed into a moddable DOM/runtime is already outside the vault's protection. Unrestricted filesystem or process execution can invalidate stronger isolation claims. The design must reconcile native authority with exclusive-secret promises before allowing untrusted native-capable plugins. No such vault, PTY, arbitrary process bridge or script injection engine exists. The trusted experimental local plugin loader above does not supply those powers or establish secure untrusted-plugin isolation.

## Community and iterative implementation

The platform should support ideas its original author did not anticipate. Successful community experiments may later become stable APIs/slots. That goal does not mean allowing every plugin to access every resource by default.

The owner wants to refine unresolved details while developing the prototype. Discuss collision behavior, resize rules, overflow, header contents, collapse affordances and SDK ergonomics using concrete tests. Do not force a redesign of the agreed stack without evidence. Do not treat future capabilities in this document as shipped or as authorization to implement them in unrelated tasks.
