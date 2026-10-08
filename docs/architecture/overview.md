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

The renderer owns visual state. `src/shared/layout.ts` owns normalized geometry and layout parsing without Electron/React/DOM dependencies. `src/shared/storage.ts` accepts an injected storage interface for tests and returns explicit failures. `src/shared/identity.ts` centralizes runtime identity.

| Responsibility | Files |
| --- | --- |
| Native window, production assets, session restrictions | `src/main/index.ts`, `src/main/security.ts` |
| Metadata and fixed plugin-management bridge | `src/preload/index.ts` |
| Managed package snapshots and installation preferences | `src/main/plugins.ts` |
| Plugin lifecycle, Worker adapter and Settings/widgets | `plugin-runtime.ts`, `plugin-worker.ts`, `Plugins.tsx` in `src/renderer/src/` |
| Versioned plugin contract and validators | `src/shared/plugins.ts`, `sdk/plugin.d.ts` |
| App composition and interaction | `src/renderer/src/App.tsx` |
| Synthetic widget content and registry | `WidgetContent.tsx`, `fixtures.ts` in `src/renderer/src/` |
| Visual tokens and CSS/Tailwind | `src/renderer/src/styles.css` |
| Geometry, input validation, storage | `src/shared/` |
| Project checks and GitHub metadata reconciliation | `tools/` |

## Intentional simplifications

No Core Utility Process or third-party Plugin Host is started merely to imitate the former prototype. There is no work requiring them yet. Do not load sqlite, node-pty, an interpreter, an updater or a plugin SDK before the corresponding Issue defines a real need and boundary.

Sidebar/Main/Bottom are sibling logical regions in a single CSS grid. Region layouts need not share the same algorithm. The Main canvas is a continuous rectangular surface, not a nested docking tree. A test panel can reserve space or float within Main. The underlying layout engine does not know about this panel's text/content.

React fixture components are trusted source in the application renderer. They are not isolated plugins. Do not infer that third-party React components can safely be loaded here.

## Build and runtime

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `geppio://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.

Before adding plugin-owned native UI surfaces, perform a separately scoped WebContentsView experiment
and define its z-order, clipping, focus, animation and lifecycle behavior. The trusted Worker runtime
does not implement or certify those surfaces; the declarative contribution contract is separate from
the logic lifecycle so they can be introduced later.
