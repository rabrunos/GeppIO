# Architecture

## Implemented boundaries

The alpha.13/alpha.14 host presentation is rooted in `App`, `Header`, `Sidebar`, `WidgetFrame`,
`useRegions`, `useSurfaces`, `useInteraction` and `useTransaction`. Approved design sections
remain in their original cascade order under `workbench/design/`; `host.css` adapts DOM owners
to continuous geometry. `shared/workbench/` owns host identity, bar membership/positions,
composition commands, versioned validation and whole-intention history. It does not extend
manifest v1 or execute a plugin per view. `Locale` binds app-owned strings; plugin publications
and user-supplied names remain literal.

The `geppio:workbench:v1` envelope is independent of all legacy layout keys. A legacy preview
is explicitly adopted through the same lock/CAS path; viewport projection does not write it.
Slots belong to the editing session, not the plugin registry or permanent widget document.
Save editing advances the Cancel checkpoint without leaving Edit; Conclude validates/writes
the slot-free document before exiting. Undo/redo retains up to 256 complete intentions in
session memory, not a persisted event log. Theme, display name, snap and host Properties state
participate in reversible host edits through their separate stores; this is not an atomic
multi-key envelope or storage for plugin-owned data.
New presentation helpers (`EditorPanel`, `PairDividers`, `PluginManager`, `CompositionThumbnail`,
`useSwap`, `useCompositionReorder`, `DragLayer` and `ProjectMenu`) compose those existing owners.
Static library-card previews use cached proportions. Drag pictures are inert snapshots with
identity/command attributes removed; they never create models or execute plugin code. Project
rename changes only local display metadata. Project filesystem/Git actions remain explicit
demonstrations; the existing host download denial is retained. No project filesystem/Git/account
authority is implied. Both composition orders are host metadata; provisional
pointer order enters history only after an accepted drop. A Sidebar swap preserves other bars'
memberships through another eligible view of the same model, subject to the existing view cap.
New compositions capture format plus widget associations for explicit Main/Bottom scopes;
Sidebar contributes optional width only. Restoration preserves omitted canonical regions,
including when Edit temporarily reveals them. Repeated Format may produce session reservations;
exact-slot admission is shared by click/catalog/move and does not serialize those reservations.

Main owns the native window, a bounded local asset protocol and the trusted local package store.
The preload exposes immutable metadata plus fixed list/install/setEnabled/remove operations and
the owner-authorized minimize/maximize/close controls for the application's main frame.
There is no generic IPC entry point, filesystem/terminal function
or remote-content embedding. Each enabled external package runs in a renderer Web Worker;
validated declarative contributions are rendered by React in the Main region.
Manifest/API v1 maps them to Main-only, single-view cards in the host catalog. Host metadata
for category, appearance, regions or multi-area presence does not imply matching author-facing
manifest fields. Likewise, compact-rail actions, widget tab groups and general presentations
are not available SDK contributions. Hiding/removing a view does not dispose its Worker;
disabling the package does, and reactivation restarts its state. Managed package/enabled
preferences persist independently of layout. Alpha.21 adds opt-in API 2 ordinary plugin data under
Issue #23; see [the data/surface contract](plugin-data.md). The native data bridge is fixed and
activation-bound; API 1 keeps its exact facade and reset behavior.

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
| Synthetic content, host types/models/views and current initial composition | `src/renderer/src/WidgetContent.tsx`, `src/shared/workbench/model.ts`; legacy fixtures in `src/renderer/src/fixtures.ts` |
| Visual tokens, fixtures and domain styles | `styles.css`, `fixtures.css`, `freeform/freeform.css`, `workbench/design/`, `workbench/host.css`, `settings/settings.css` |
| Continuous geometry, constraints, projection, collisions, transfer, conversion and storage | `src/shared/freeform/` |
| Historical integer codecs and regression/reference algorithms | `src/shared/grid/` |
| Project checks and GitHub metadata reconciliation | `tools/` |

## Intentional simplifications

No Core Utility Process or third-party Plugin Host is started merely to imitate the former prototype. There is no work requiring them yet. Do not add SQLite, node-pty, an interpreter, an updater or production SDK authority before the corresponding Issue defines a real need and boundary. The existing bounded local SDK is experimental, not evidence of these capabilities.

Sidebar/Main/Bottom are peer regions in a CSS workbench grid; that structural CSS grid is unrelated
to widget positioning. Sidebar width and Bottom height retain independent bounded pixel splitters,
collapse and accessible reopening. Collapsed Sidebar keeps a separate 48px rail with host/user-bar
buttons and an optional floating peek; it does not vanish or become a fourth widget region.
Sidebar content is 180–430px (initial 283px), Bottom 125–250px (initial 167px), with viewport
clamping. The current host region minima adapt bundled content to 150px Sidebar width and
105px Bottom height; legacy/Main constraints remain unchanged. An independent 25px status bar
reserves window space. Measured inner content uses the approved chrome spacing and borders,
not the superseded universal 15px inset.
Main edits continuous rectangles in both axes; Sidebar binds width and Bottom binds height. Native
and declared contribution frames share a stable React parent; per-frame clipping maps each rectangle into its region's
ordinary scrollport. Region transfer, scrolling, collapse and expansion do not remount content.
Viewport/region changes derive presentation from a canonical reference and never write layouts.
Plugin contributions use the host catalog and placement layer; App owns Worker lifetimes. Neither geometry nor
widget constraints add native/plugin authority. The synthetic panel remains a session-only demo.
Individual widget gestures require Edit, with DEV-only experimental individual keyboard controls.
Paired dividers are a deliberate normal-mode exception: their typed bilateral command validates
the confirmed baseline and has an independent guarded commit path; Edit uses the draft/history.
Region and pair splitters retain production keyboard operation. The current optional pair-center
snap does not implement or cancel the old general-guide wishes in #3/#10.

React fixture components are trusted source in the application renderer. They are not isolated plugins. Do not infer that third-party React components can safely be loaded here.
The current host has seven synthetic types, initially four Main/two Sidebar/one Bottom.
All registered types use card appearance; seamless type/CSS support is infrastructure without
an active fixture or manifest-v1 author option. A native window maximize action does not
implement Main-scoped widget maximization (#25), and a visual project name is not a native folder.

## Build and runtime

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `geppio://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.
Windows and Linux are product targets, with Windows first. The recorded desktop evidence is
Windows; Linux application smoke, installers and published distribution are not established by
this architecture or by pure geometry tests. A successful preview/build is not an installer release.
The selected shadcn/ui source (#8) and individual external-adoption policy (#19) are described
in [requirements](../product/requirements.md); they do not imply prior component adoption.

Before adding plugin-owned native UI surfaces, perform a separately scoped WebContentsView experiment
and define its z-order, clipping, focus, animation and lifecycle behavior. The trusted Worker runtime
does not implement or certify those surfaces; the declarative contribution contract is separate from
the logic lifecycle so they can be introduced later.
The real modular IDE (#32), LAN companion (#30), community/forum/account (#34), widget tabs
(#18), generalized presentations (#11), widget maximize (#25) and provisional catalog (#35)
remain separate future scopes. Their presence in planning does not create implementation
priority, a native bridge or an approved roadmap.
