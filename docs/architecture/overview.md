# Architecture

## Implemented boundaries

The alpha.13 host presentation is rooted in `App`, `Header`, `Sidebar`, `WidgetFrame`,
`useRegions`, `useSurfaces`, `useInteraction` and `useTransaction`. Approved design sections
remain in their original cascade order under `workbench/design/`; `host.css` adapts DOM owners
to continuous geometry. `shared/workbench/` owns host identity, bar membership/positions,
composition commands, versioned validation and whole-intention history. It does not extend
manifest v1 or execute a plugin per view. `Locale` binds app-owned strings; plugin publications
and user-supplied names remain literal.

The `geppio:workbench:v1` envelope is independent of all legacy layout keys. A legacy preview
is explicitly adopted through the same lock/CAS path; viewport projection does not write it.
Slots belong to the editing session, not the plugin registry or permanent widget document.
New presentation helpers (`EditorPanel`, `PairDividers`, `PluginManager`, `CompositionThumbnail`,
`useSwap`, `useCompositionReorder`, `DragLayer` and `ProjectMenu`) compose those existing owners.
Static library-card previews use cached proportions. Drag pictures are inert snapshots with
identity/command attributes removed; they never create models or execute plugin code. Project
rename changes only local display metadata. Project filesystem/Git actions remain explicit
demonstrations; the existing host download denial is retained. No project filesystem/Git/account
authority is implied. Both composition orders are host metadata; provisional
pointer order enters history only after an accepted drop. A Sidebar swap preserves other bars'
memberships through another eligible view of the same model, subject to the existing view cap.

```text
Electron Main                           React renderer
  native window                           fixed header
  local asset protocol                    Work Area
  permissions denied                       Sidebar / Main / Bottom
  external navigation denied               trusted fixture widgets
          |                                edit transaction + presentation demo
          | preload metadata + fixed plugin/window actions |
          +---------------------------------------------+
                                             pure layout / storage adapters
```

Main owns the native window, a bounded local asset protocol and the trusted local package store.
The preload exposes immutable metadata plus fixed list/install/setEnabled/remove operations and
the owner-authorized minimize/maximize/close controls for the application's main frame.
There is no generic IPC entry point, filesystem/terminal function
or remote-content embedding. Each enabled external package runs in a renderer Web Worker;
validated declarative contributions are rendered by React in the Main region.

The renderer owns visual state. Pure modules in `src/shared/freeform/` own continuous CSS-pixel
geometry, region constraints, bounded contact reflow, reversible interval projection and independent
versioned persistence without Electron/React/DOM. `src/shared/grid/` remains historical codec and
regression context, not active placement. `src/shared/layout.ts` supplies fractional v1 validation
and the reused projection-based clearance predicate;
native identity recovery still uses its v1 contract. `src/shared/identity.ts` centralizes identity.

| Responsibility | Files |
| --- | --- |
| Native window, production assets, session restrictions | `src/main/index.ts`, `src/main/security.ts` |
| Metadata, fixed plugin management and owner-authorized window controls | `src/preload/index.ts`, `src/shared/window-controls.ts` |
| Managed package snapshots and installation preferences | `src/main/plugins.ts` |
| Plugin lifecycle, Worker adapter and Settings/widgets | `plugin-runtime.ts`, `plugin-worker.ts`, `Plugins.tsx` in `src/renderer/src/` |
| Versioned plugin contract and validators | `src/shared/plugins.ts`, `sdk/plugin.d.ts` |
| Workbench composition, header/sidebar and pixel region splitters | `App.tsx`, `workbench/` in `src/renderer/src/` |
| Freeform rendering, stable fixture frames, pointer/keyboard capture and edit transaction | `src/renderer/src/freeform/` |
| Modal and Development controls, independently composed plugin settings | `src/renderer/src/settings/`, `Plugins.tsx` |
| Synthetic widget content and registry | `WidgetContent.tsx`, `fixtures.ts` in `src/renderer/src/` |
| Visual tokens, fixtures and domain styles | `styles.css`, `fixtures.css`, `freeform/freeform.css`, `workbench/design/`, `workbench/host.css`, `settings/settings.css` |
| Continuous geometry, constraints, projection, collisions, transfer, conversion and storage | `src/shared/freeform/` |
| Historical integer codecs and regression/reference algorithms | `src/shared/grid/` |
| Project checks and GitHub metadata reconciliation | `tools/` |

## Intentional simplifications

No Core Utility Process or third-party Plugin Host is started merely to imitate the former prototype. There is no work requiring them yet. Do not load sqlite, node-pty, an interpreter, an updater or a plugin SDK before the corresponding Issue defines a real need and boundary.

Sidebar/Main/Bottom are peer regions in a CSS workbench grid; that structural CSS grid is unrelated
to widget positioning. Sidebar width and Bottom height retain independent bounded pixel splitters,
complete collapse and accessible reopening. An independent 25px status strip reserves window space.
Main edits continuous rectangles in both axes; Sidebar binds width and Bottom binds height. Native
and declared contribution frames share a stable React parent; per-frame clipping maps each rectangle into its region's
ordinary scrollport. Region transfer, scrolling, collapse and expansion do not remount content.
Viewport/region changes derive presentation from a canonical reference and never write layouts.
Plugin contributions use the host catalog and placement layer; App owns Worker lifetimes. Neither geometry nor
widget constraints add native/plugin authority. The synthetic panel remains a session-only demo.

React fixture components are trusted source in the application renderer. They are not isolated plugins. Do not infer that third-party React components can safely be loaded here.

## Build and runtime

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `geppio://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.

Before adding plugin-owned native UI surfaces, perform a separately scoped WebContentsView experiment
and define its z-order, clipping, focus, animation and lifecycle behavior. The trusted Worker runtime
does not implement or certify those surfaces; the declarative contribution contract is separate from
the logic lifecycle so they can be introduced later.
