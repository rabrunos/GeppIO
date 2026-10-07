# Architecture

## Implemented boundaries

```text
Electron Main                           React renderer
  native window                           fixed header
  local asset protocol                    Work Area
  permissions denied                       Sidebar / Main / Bottom
  external navigation denied               trusted fixture widgets
          |                                edit transaction + presentation demo
          | static preload metadata                     |
          +---------------------------------------------+
                                             pure layout / storage adapters
```

Main owns the native window and a bounded local asset protocol. The preload exposes only immutable `name`, `version`, `platform` metadata. There is no generic IPC entry point, filesystem/terminal function or remote-content embedding.

The renderer owns visual state. `src/shared/layout.ts` owns normalized geometry and layout parsing without Electron/React/DOM dependencies. `src/shared/storage.ts` accepts an injected storage interface for tests and returns explicit failures. `src/shared/identity.ts` centralizes runtime identity.

| Responsibility | Files |
| --- | --- |
| Native window, production assets, session restrictions | `src/main/index.ts`, `src/main/security.ts` |
| Metadata-only bridge | `src/preload/index.ts` |
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

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `semnome://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.

Before real plugins, perform a separately scoped WebContentsView experiment and define its z-order, clipping, focus, animation and lifecycle behavior. A working DOM demo is not evidence that native web surfaces satisfy those requirements.
