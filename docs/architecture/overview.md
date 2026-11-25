# Architecture

## Workspace ownership

The root package owns the application version, lockfile and verification commands. Each product composes its own capabilities and data identity. Importing the Runtime catalog constructs no services. Window and product teardown release capabilities in reverse dependency order.

| Workspace | Public responsibility |
| --- | --- |
| `src/geppio` | Full Electron product, native authorization in Main, fixed preload, renderer navigation, workbench and application session composition. |
| `src/geppio-runtime` | Continuous geometry, document ports and edit/history rules, capability activation and versioned peer mediation. Web frame supervision and Node surface preparation have separate exports. |
| `src/geppui` | Web primitives, design tokens, dialogs, scroll, floating layout and motion. See [GeppUI](../../src/geppui/README.md). |
| `src/geppio-editor` | Basic Monaco editor/model, comparisons, workers and styling. File authority, tabs and recovery belong to the product. See [Editor](../../src/geppio-editor/README.md). |
| `src/plugin-sdk` | Supported v1/v2 author types and the API 3 surface client, endpoint contracts and wire validation. See [plugin surfaces](plugin-surfaces.md). |
| `src/geppio-standalone` | Selected composition, independent Electron entry and portable Windows distribution. |

Runtime does not create a background process. A full window activates the editor, Explorer and the first-party IDE services. A generated product starts the capabilities selected by its definition. An API 3 activation owns its controller independently of its widget presentations. The renderer's document session retains exact draft text and talks to Main's native document store through a port. Monaco models project these drafts and keep presentation history across tab and widget changes.

## Implemented boundaries

Alpha.44 adds explicit per-file [Git index actions](git.md) through the same first-party
owner. Native Git locks/applies one generated binary patch to the real index with isolated
configuration; status/diff retain their disposable-copy path. Hosting services are independent.

Alpha.43 adds the [read-only Git pilot](git.md) using the exact Explorer grant, disposable
metadata and isolated installed Git builtins. One session serves Main/Sidebar widgets and
the second Editor activity; independent Monaco Diff Editor models compare HEAD to saved disk.

Alpha.40 adds the essential [interactive Terminal](terminal.md) and [contextual Status Bar](status-bar.md).
Main owns one persistent PTY; the renderer session owns one bounded xterm emulator across Editor
Bottom and explicit Main/Bottom widget presentations. Five fixed caller-bound operations do not
extend the Worker SDK. Document status derives from the existing editable session.

Alpha.39 adds the [bounded Explorer](explorer.md) to Files & Editor: one native folder grant,
lazy shared tree, explicit Main/Sidebar widget and existing-host Editor activity presentation.
Directory access remains in Main and opens through the same document store/session.

Alpha.37 adds [essential Files & Editor and Core document service](documents.md): one native-selected
file/session shared by direct Editor and an explicitly placed Main widget. This first-party host
module preserves workbench storage/plugin lifetimes and does not extend public Worker API 1/2.

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
identity/command attributes removed; they never create models or execute plugin code. Host display-name changes affect local metadata. Native project selection, file operations and Git
are implemented by the separate [Workspace](workspace.md), [Explorer](explorer.md) and
[Git](git.md) services; host composition controls do not grant their native authority. Both composition orders are host metadata; provisional
pointer order enters history only after an accepted drop. A Sidebar swap preserves other bars'
memberships through another eligible view of the same model, subject to the existing view cap.
New compositions capture format plus widget associations for explicit Main/Bottom scopes;
Sidebar contributes optional width only. Restoration preserves omitted canonical regions,
including when Edit temporarily reveals them. Repeated Format may produce session reservations;
exact-slot admission is shared by click/catalog/move and does not serialize those reservations.

Main owns the native window, a bounded local asset protocol and the trusted local package store.
The preload exposes immutable metadata plus fixed list/install/setEnabled/remove operations and
the owner-authorized minimize/maximize/close controls for the application's main frame.
There is no generic IPC entry point, arbitrary filesystem/process function
or remote-content embedding. API 1/2 packages run in trusted renderer Web Workers;
validated declarative contributions are rendered by the host. API 3 packages use opaque-origin
sandboxed frames and generation-bound brokered communication, described in [web surfaces](plugin-surfaces.md).
Do not apply the Worker trust assumptions to API 3 or infer that all packages share one execution family.
Manifest/API v1 maps them to Main-only, single-view cards in the host catalog. Host metadata
for category, appearance, regions or multi-area presence does not imply matching author-facing
manifest fields. Likewise, compact-rail actions, widget tab groups and general presentations
are not available SDK contributions. Hiding/removing a view does not dispose its Worker;
disabling the package does, and reactivation restarts its state. Managed package/enabled
preferences persist independently of layout. Alpha.21 adds opt-in API 2 ordinary plugin data under
Issue #23; see [the data/surface contract](plugin-data.md). The native data bridge is fixed and
activation-bound; API 1 keeps its exact facade and reset behavior.

The renderer owns visual state. The Runtime owns pure continuous geometry, contact reflow and alignment. The application supplies region constraints, reversible interval projection and versioned persistence under `src/geppio/src/shared/freeform/`. `src/geppio/src/shared/grid/` remains historical codec and
regression context, not active placement. `src/geppio/src/shared/layout.ts` supplies fractional v1 validation
and the reused projection-based clearance predicate;
native identity recovery still uses its v1 contract. `src/geppio/src/shared/identity.ts` centralizes identity.

| Responsibility | Files |
| --- | --- |
| Native window, production assets, session restrictions | `src/geppio/src/main/index.ts`, `src/geppio/src/main/security.ts` |
| Metadata, fixed plugin management and owner-authorized window controls | `src/geppio/src/preload/index.ts`, `src/geppio/src/shared/window-controls.ts` |
| Managed package snapshots and installation preferences | `src/geppio/src/main/plugins.ts` |
| Plugin lifecycle, Worker adapter and Settings/widgets | `plugin-runtime.ts`, `plugin-worker.ts`, `Plugins.tsx` in `src/geppio/src/renderer/src/` |
| Versioned plugin contract and validators | `src/geppio/src/shared/plugins.ts`, `src/plugin-sdk/src/plugin.d.ts` |
| Renderer shell, experience-independent document, Workspace/Explorer, Git and Terminal sessions | `App.tsx`, `core/useCoreSessions.ts` in `src/geppio/src/renderer/src/` |
| Official App identity, experience selection and GeppIO Code presentation | `src/geppio/src/renderer/src/apps/` |
| Workbench composition, header/sidebar and pixel region splitters | `src/geppio/src/renderer/src/workbench/`, `App.tsx` |
| Freeform rendering, stable fixture frames, pointer/keyboard capture and edit transaction | `src/geppio/src/renderer/src/freeform/` |
| Modal and Development controls, independently composed plugin settings | `src/geppio/src/renderer/src/settings/`, `Plugins.tsx` |
| Synthetic content, host types/models/views and current initial composition | `src/geppio/src/renderer/src/WidgetContent.tsx`, `src/geppio/src/shared/workbench/model.ts`; legacy fixtures in `src/geppio/src/renderer/src/fixtures.ts` |
| Visual tokens, fixtures and domain styles | `styles.css`, `fixtures.css`, `freeform/freeform.css`, `workbench/design/`, `workbench/host.css`, `settings/settings.css` |
| Pure continuous geometry, alignment, collision and reflow | `src/geppio-runtime/src/layout/` |
| Host constraints, projection, transfer, conversion and storage | `src/geppio/src/shared/freeform/` |
| Historical integer codecs and regression/reference algorithms | `src/geppio/src/shared/grid/` |
| Repository checks, builds and validation | `tools/` |

## Intentional simplifications

No Core Utility Process or third-party Plugin Host is started merely to imitate the former prototype. There is no work requiring them yet. Do not add SQLite, an interpreter, an updater or production SDK authority before the corresponding Issue defines a real need and boundary. The existing bounded local SDK is experimental, not evidence of these capabilities.

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
Plugin contributions use the host catalog and placement layer; the application owns each execution family's controller/Worker lifetime independently of its presentations. Neither geometry nor
widget constraints add native/plugin authority. The synthetic panel remains a session-only demo.
Individual widget gestures require Edit, with DEV-only experimental individual keyboard controls.
Paired dividers are a deliberate normal-mode exception: their typed bilateral command validates
the confirmed baseline and has an independent guarded commit path; Edit uses the draft/history.
Region and pair splitters retain production keyboard operation. The current optional pair-center
snap does not implement or cancel the old general-guide wishes in #3/#10.

React fixture components are trusted source in the application renderer. They are not isolated plugins. Do not infer that third-party React components can safely be loaded here.
Historical synthetic fixtures remain separate from the current official and installed-plugin catalog.
The host implements [presentations and Main maximize](layout.md) and widget tab groups; these
features do not implicitly add public manifest-v1 capabilities. Native window maximize and
Main-scoped widget maximize have different owners and lifecycles.

## Build and runtime

`electron-vite` builds Main/preload to explicit CJS outputs and the renderer to bundled static assets. Production-preview content is served from `geppio://app/`; development content is a validated loopback Vite server. Node is used to build/run project tools, not exposed to the renderer. Runtime version display comes from `package.json` via the build define/preload.
Windows and Linux are product targets, with Windows first. The recorded desktop evidence is
Windows; Linux application smoke, installers and published distribution are not established by
this architecture or by pure geometry tests. A successful preview/build is not an installer release.
The owner prefers project-owned UI components (#8). Proposed external components go through
individual adoption review (#19). See [requirements](../product/requirements.md).

Before adding plugin-owned native UI surfaces, perform a separately scoped WebContentsView experiment
and define its z-order, clipping, focus, animation and lifecycle behavior. The trusted Worker runtime
does not implement or certify those surfaces; the declarative contribution contract is separate from
the logic lifecycle so they can be introduced later.
GeppIO Code, native Explorer/Git/Terminal, host presentations, widget tabs and Main maximize have
implemented scopes. Issues #32, #11, #18 and #25 retain their exact requirements and acceptance.
LAN companion (#30), community/forum/account (#34) and further catalog capabilities (#35) remain
separate future scopes. Planning does not itself grant a new native bridge or implementation authority.
