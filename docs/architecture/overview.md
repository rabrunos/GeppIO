# Architecture

## Implemented boundaries

```text
Electron Main                           React renderer
  native window                           fixed header
  local asset protocol                    Work Area
  permissions denied                       Sidebar / Main / Bottom
  external navigation denied               trusted fixture widgets
          |                                edit transaction + presentation demo
          | preload metadata + fixed plugin management  |
          +---------------------------------------------+
                                             pure layout / storage adapters
```

Main owns the native window, a bounded local asset protocol and the trusted local package store.
The preload exposes immutable metadata plus fixed list/install/setEnabled/remove operations for
the application's main frame. There is no generic IPC entry point, filesystem/terminal function
or remote-content embedding. Each enabled external package runs in a renderer Web Worker;
validated declarative contributions are rendered by React in the Main region.

The renderer owns visual state. Pure grid modules in `src/shared/grid/` own integer geometry,
policy, occupancy, bounded reflow and versioned validation/storage without Electron/React/DOM.
Legacy `src/shared/layout.ts` remains the fractional v1 validator and historical solver;
native identity recovery still uses its v1 contract. `src/shared/identity.ts` centralizes identity.

| Responsibility | Files |
| --- | --- |
| Native window, production assets, session restrictions | `src/main/index.ts`, `src/main/security.ts` |
| Metadata and fixed plugin-management bridge | `src/preload/index.ts` |
| Managed package snapshots and installation preferences | `src/main/plugins.ts` |
| Plugin lifecycle, Worker adapter and Settings/widgets | `plugin-runtime.ts`, `plugin-worker.ts`, `Plugins.tsx` in `src/renderer/src/` |
| Versioned plugin contract and validators | `src/shared/plugins.ts`, `sdk/plugin.d.ts` |
| Workbench composition, header/sidebar and pixel region splitters | `App.tsx`, `workbench/` in `src/renderer/src/` |
| Grid rendering, fixture frame, pointer/keyboard capture and edit transaction | `src/renderer/src/grid/` |
| Modal and Development controls, independently composed plugin settings | `src/renderer/src/settings/`, `Plugins.tsx` |
| Synthetic widget content and registry | `WidgetContent.tsx`, `fixtures.ts` in `src/renderer/src/` |
| Visual tokens, fixtures and domain styles | `styles.css`, `fixtures.css`, `grid/grid.css`, `workbench/workbench.css`, `settings/settings.css` |
| Grid geometry, policy, collisions, reflow, conversion and storage | `src/shared/grid/` |
| Project checks and GitHub metadata reconciliation | `tools/` |

## Intentional simplifications

No Core Utility Process or third-party Plugin Host is started merely to imitate the former prototype. There is no work requiring them yet. Do not load sqlite, node-pty, an interpreter, an updater or a plugin SDK before the corresponding Issue defines a real need and boundary.

Sidebar/Main/Bottom are peer regions in a CSS grid. Sidebar width and Bottom height are independent
CSS-pixel dimensions, with accessible pointer/keyboard splitters. Main directly contains the seven
grid fixture frames, without an inner visible canvas/title/toolbar. Measured Main space determines
square pixel cells; physical window/region changes never rewrite integer placements or saved rows.
The synthetic panel remains session-only, controlled outside Main, and can reserve space or overlay.
Trusted plugin contributions retain a separate internally scrollable strip in Main. Neither panel nor
plugins acquire grid/native authority. The grid solver knows only typed integer geometry.

React fixture components are trusted source in the application renderer. They are not isolated plugins. Do not infer that third-party React components can safely be loaded here.

## Build and runtime

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `geppio://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.

Before adding plugin-owned native UI surfaces, perform a separately scoped WebContentsView experiment
and define its z-order, clipping, focus, animation and lifecycle behavior. The trusted Worker runtime
does not implement or certify those surfaces; the declarative contribution contract is separate from
the logic lifecycle so they can be introduced later.
