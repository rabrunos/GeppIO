# Changelog

Integrated source changes, not a publication ledger. Version comes from package.json.

## [0.1.0-alpha.23] — 2026-11-09

- Synchronize the archived-bar desktop smoke with the stable popup grip before measuring pointer coordinates. Assert actual hit target, pointer capture and rail drop admission while preserving same-ID and ordering checks; no product behavior changes.

## [0.1.0-alpha.22] — 2026-11-09

- Stack Sidebar widgets from the existing top inset in Home and custom bars, preserving individual heights, usable width, normal gaps and vertical scrolling.
- Preview drag insertion and commit stable per-bar ordering on release; keep additions, removals, resizing and eligible moves packed within the existing Edit/checkpoint/history transactions.
- Derive older Sidebar ordering from saved vertical positions without startup writes, retaining the existing guarded layout save and recovery format.
- Enable host-owned Main/Sidebar eligibility for installed Workspace Essentials notes, checklist and prompts, with responsive text controls; scratch remains Main-only. No plugin API, installation identity or clipboard changes.

## [0.1.0-alpha.21] — 2026-11-09

- Add the independently built first-party Workspace Essentials trusted-local package: titled notes, scratchpad, ordered checklist and saved prompts, explicitly placed in Main through the existing plugin flow.
- Opt in to API 2 literal text fields/lists/actions, validated owning-widget events and user-initiated host clipboard writes. Keep the exact API 1 facade and Counter/Pulse behavior.
- Persist bounded, versioned ordinary plugin data separately from layout/preferences using installation-bound, revocable activation channels, serialized revision-checked writes and atomic replacement. Preserve malformed bytes, confirmed data and pending text on failure.
- Retain recoverable data on view removal, disable and uninstall; fresh installations cannot inherit it by claiming a manifest ID. Add focused boundary/failure tests and an independent disposable-profile pilot smoke before the existing desktop chain.

## [0.1.0-alpha.20] — 2026-11-09

- Retire the seven synthetic host widgets from normal startup, widget selection and built-in composition restoration. Keep empty regions and installed-plugin placement available.
- Validate older layouts before retiring demo references into a bounded, typed recovery archive; preserve plugins, custom bars, saved compositions and original bytes until explicit confirmation. Saved widget associations cannot reactivate demos.
- Isolate synthetic geometry fixtures in disposable test profiles, retaining four-edge Docked and Floating coverage. Add fresh/alpha.19 upgrade, restart, composition and reset regressions.

## [0.1.0-alpha.19] — 2026-11-09

- Extend host Main presentation capabilities to Panorama, Fila de trabalho, Propriedades and Atividade. Select mode and edge as one Edit intention, with anchored edge occupancy guarded at selection, restoration and persistence boundaries (Issue #11).
- Arrange four simultaneous anchored edges with full-width horizontal corner ownership and immediate side-span updates. Both compact strip types reserve fixed thickness plus clearance; only expanded Docked replaces its reservation and offers resizing. Fit reservations together, clamp preferred extents and temporarily collapse in reverse top/bottom/left/right priority without saving adaptation.
- Add four-edge Floating hover reveal and a movable free trigger with bounded panel geometry, focus/menu retention and transient pointer previews. Keep compact edge strips fixed and preserve mounted view/model identity and independent Sidebar/Bottom behavior.
- Route every widget through shared regional measurement, frame projection, clipping and motion. Follow native Sidebar CSS-track frames before paint without competing panel position transitions, and keep Main frames/strips below the floating Sidebar for paint and pointer hit testing.
- Return to Normal at the exact current expanded rectangle, freezing legal visible Normal peers before releasing space; refuse conflicts atomically. Keep mode, geometry, checkpoints and undo/redo together.
- Read legacy bottom-only and absent presentation data, write nested presentation v2 in the existing guarded envelope v2, and cover migration, geometry, rejection and disposable-profile desktop interaction. Physical Windows and owner visual acceptance remain pending.
- Restore the decorative Sidebar rail divider's 12px top inset from the approved V1.141 reference; preserve its bottom inset, theme opacity/fade, clipping, visibility and pointer behavior in docked/collapsed/hover states.

## [0.1.0-alpha.18] — 2026-11-08

- Move the Properties presentation selector into the widget's Edit controls beside remove, showing the selected name in a compact dropdown with localized Normal/Encaixado/Flutuante options and host region capabilities (Issue #11).
- Give Docked an independent Bottom-style click/drag edge, guarded height confirmation and reversible constrained-window adaptation; keep preferred height and explicit collapse durable, leaving a visible collapsed bar above the independent Bottom.
- Reveal full-Main-width Floating through a persistent full-width 31px collapsed bar in lower Main with Sidebar timing and popup retention. Keep hover transient, legacy Normal visible and all content mounted through presentation changes.
- Update disposable-profile presentation smoke for local controls, gestures, restart, compatibility, English labels and both themes. Synchronize pointer tests with completed drag pictures and preserve bounded diagnostics across reloads without masking original failures. Physical mouse/DPI and owner visual acceptance remain pending.

## [0.1.0-alpha.17] — 2026-11-04

- Give the host Properties view visible mouse controls for Normal, bottom Docked and bottom Overlay, explicit collapse/reopen and preferred panel height. Keep its content mounted and its Normal slot recoverable; no terminal process or plugin capability is added (Issue #11).
- Persist identity-bound presentation preferences in the existing guarded workbench key using envelope v2; read alpha.16 v1 documents with Normal/open defaults. Preserve expected-byte/lock, quota and recovery safeguards and integrate intentions with Edit checkpoints/history without extending composition records.
- Temporarily reduce Docked height, then collapse when panel and Main minima cannot fit; restore the explicit open preference and preferred size when space returns. Keep Overlay layout-neutral and Bottom/Sidebar independent. Main geometry editing resumes in Normal, preserving the reserved Normal scene during panel previews.
- Add codec, failure, composition and geometry tests plus disposable-profile Electron restart/mouse coverage for presentations, both themes and simulated DPR 1.25. Physical owner assessment remains separate.

## [0.1.0-alpha.16] — 2026-11-02

- Compare the native About-dialog version with canonical package.json in the existing correction smoke instead of the hardcoded alpha.14 expectation exposed by alpha.15 CI (Issue #36). Retain strict equality and the complete smoke; no runtime behavior or dependencies change.

## [0.1.0-alpha.15] — 2026-11-02

- Reconcile current product, architecture, development and validation documentation with the integrated workbench, continuous geometry, current chrome, scoped composition restoration and normal-mode paired resize; retain historical migration contracts and acceptance boundaries (Issue #36).
- Distinguish host metadata from the restricted local plugin SDK, layout persistence from plugin-owned data, and synthetic UI from functional IDE/account/native tools.
- Carry the selected shadcn/ui source and individual external-code adoption gate into minimal stable guidance, and separate the recorded Windows/Linux direction from current Windows validation and absent distribution.
- This is an independent documentation/version-metadata increment. No application runtime, dependency graph, permission boundary, CI configuration or product feature changes.

## [0.1.0-alpha.14] — 2026-11-01

- Save new compositions as format plus widget associations, with explicit Main/Bottom scope and optional Sidebar width only. Allow opting into logically collapsed panels using their remembered or checkpointed dimensions; retain legacy format-only records and checkpoint/storage safeguards.
- Restrict restoration and preset chrome patches to included components, preserve omitted regions and Sidebar visibility/navigation, and restore included Bottom height and visibility atomically.
- Report accepted reserved-slot moves as successful instead of retaining the internal gesture rollback message. Extend shared Bottom reservation and native pointer regressions while preserving the approved landing motion and regional highlight.
- Advance the app version for each newly delivered application-source batch, including corrections pending acceptance, while keeping local iterations within one target and historical versions unchanged.

## [0.1.0-alpha.13] — 2026-10-30

- Replace the old shell with React workbench presentation sourced from the approved V1.141 design packet, retaining the continuous placement engine and App-owned plugin runtime. Add the context bar, user rail, editor dock, real plugin inventory manager and host composition/catalog surfaces.
- Introduce a separate bounded host workbench envelope with qualified type/model/view identities, independent bar memberships/positions, saved compositions and explicit legacy adoption. Keep historical layout bytes read-only and retain Web Locks, byte CAS and epoch cancellation.
- Add editing checkpoints, Conclude, whole-intention session history and a distinct bilateral resizePair command. Keep transient format slots outside persisted executable identities.
- Fit released viewport space continuously without changing saved preferences; preserve fixed clearance and expose real geometric feasibility consistently in catalog destinations and drag targets.
- Add only the owner-authorized fixed minimize/maximize/close bridge, guarded by the exact main-frame origin and argument validation, with no plugin SDK expansion.
- Apply the owner-approved correction packet: responsive native content at 180px Sidebar/125px Bottom, fourteen custom active bars with preserved legacy twenty-bar documents, short-click rail selection, scoped icons, divider, shared scroll state, nested menus, dialogs and composition thumbnails/markers.
- Fill reserved slots with exact validated geometry, distinguish catalog moves from new presences, preserve swap selection and include reversible host metadata/models in session history. Keep library-only actions outside format pending state and retain transaction/CAS failure recovery.
- Correct drag landing by giving the top-layer picture sole motion ownership of its active view through the 240ms position/size flight. Resolve visible composition reservations before ordinary region drops, sharing exact-slot validation with click-to-fill, preserving source associations/history and reusing normal slot hover alongside the existing region highlight.
- Supply bounded in-memory notifications from native plugin lifecycle events, with read/filter/dismiss/clear states, and extend disposable Windows Electron coverage. Project location stays explicitly unavailable until an authorized native project state exists.

## [0.1.0-alpha.12] — 2026-10-16

- Settle actual widget geometry and size preferences after each completed pointer gesture and discrete development keyboard action. Keep held-pointer reversal, per-gesture cancellation, global Cancel and explicit-only persistence; accept existing freeform v1 files without reviving stale compression preferences.
- Preserve exact active resize anchors through direct-preview projection, native scrollbar entry/removal and scroll clamping. Measure native scrollbar reservation, share the existing solver budget across transition passes, and add per-frame logical/DOM traces at DPR 1/1.25.
- Restrict experimental widget-layout Tab stops, arrow shortcuts and focus outlines to the actual Vite development renderer. Preserve production pointer editing and native form/control/splitter navigation with mode-specific desktop regressions.
- Correct live multi-widget reflow with contact pruning, deterministic constrained-first fallback, reduced finite search budgets and frame-coalesced pointer updates. Allow minimum-size narrow widgets to reach adjacent free space without distant-hole search.
- Make horizontal expansion Main-only and content-dependent. Use one vertical Sidebar scroll owner; enforce finite, non-scrolling Bottom with explicit infeasibility recovery and compact eligible fixtures retaining all text.
- Set provisional requested/minimum Sidebar width to 230px and Bottom height to 120px, preserving maximum caps, safe viewport clamps and collapse restoration. Distinguish the existing 15px status strip with a subtle border and tone.

- Replace active cell-grid placement with one CSS-pixel freeform engine in Main, Sidebar and Bottom (Issue #29). Preserve continuous pointer input, local pushing, boundary compression, preferred-size recovery and bounded contact rearrangement; retain grid codecs/tests as historical recovery.
- Add typed pixel minima/defaults/maxima, region eligibility and axis constraints. Main edits both axes, Sidebar follows inner width and Bottom follows inner height. Eligible fixture transfers retain mounted content; insufficient minima reject safely.
- Default to bounded, reversible source-derived viewport projection. Persist optional horizontal expansion independently; occupied content owns its finite extent with no right-world padding. Use one 15px inset and 10px inter-widget clearance, ordinary accessible region scrolling and no stationary frame/overlay scrollbar.
- Add complete Sidebar/Bottom collapse with accessible reopening, requested-size restoration and keyboard/capture cancellation; retain sizing caps and reserve an independent empty 15px status strip.
- Introduce independently validated freeform v1 persistence, historical preview choices, explicit Save/Cancel, byte-conflict detection and same-origin Save serialization. Never rewrite historical keys or layout positions on viewport/region/configuration changes. Keep App-owned trusted Workers and stateful offscreen fixtures mounted.
- Add continuous geometry/projection/negative-storage tests and disposable Windows interaction/region/migration/plugin smoke with DPR 1/1.25 coverage. Physical DPI and final owner visual acceptance remain separate.

## [0.1.0-alpha.11] — 2026-10-09

- Add the default experimental Horizontal — 10 linhas engine beside the independently selectable alpha.10 responsive engine (Issue #28). Size square cells from complete Main height, with a single fixed 15px viewport frame and a non-reserving 4px scrollbar inside its bottom edge.
- Bound horizontal extent by occupied widgets, support finite coordinates beyond column 24, contract unused space and add scroll-aware pointer/keyboard edits with bounded edge extension. Reuse collision push/compression/ranking through an isolated domain adapter; preserve responsive projection and validation.
- Isolate versioned horizontal persistence and explicit Save/Cancel/recovery/concurrent-write checks from old v1/v2 bytes. Keep mode selection session-only, reject switches during editing and retain shared theme preferences independently.
- Keep fixture components mounted across scroll/mode changes, skip offscreen painting with content-visibility and preserve the separate Counter/Pulse runtime. Add independent geometry, scrolling, persistence, interaction and synthetic paint evidence in disposable profiles; both engines remain pending owner visual comparison.

## [0.1.0-alpha.10] — 2026-10-09

- Correct avoidable Main bands in this unaccepted target (Issue #24): jointly resolve feasible square-cell pitch and both topology axes, with continuous coverage recovery for constrained and recently edited sources. Add independent 1480×740 coverage witnesses, unchanged one-pixel budgets and repeated disposable maximize/Edit/Save/region/edge-placement journeys; retain warned mathematically constrained margins and pending owner evaluation.
- Preserve spatial composition during native window and region resizing (Issue #24): fit source-derived intervals with mandatory separation, intentional gaps and edge affinity; compress eligible spans before moving neighbours, without viewport-only free-slot packing.
- Replace aspect-ranked density jumps and history-dependent caching with continuous pixel pitch and deterministic exact-measurement projection. Preserve square cells, permanent centering, declared minima, preferred-size metadata and unchanged explicit Save/Cancel/storage semantics; constrained compositions may retain larger warned margins.
- Add sanitized left/mirrored/dense/gap/recent-edit reproductions, independent one-pixel continuity/order oracles, before/after geometry evidence tooling and disposable saved/draft desktop resize coverage. Keep the approved direct collision solver, region caps, plugin authority and Electron boundaries unchanged. Owner visual acceptance remains separate.

## [0.1.0-alpha.9] — 2026-10-09

- Require current template loading, completeness review and automatic delivery of a full copy-ready Codex contract when no direct executor call is available (Issue #27). Identify one root contract per Target Version, respect discussion/record-only requests and inherit canonical policies with proportional task detail.
- Route approved implementation from PROJECT_GUIDE and add a fresh-conversation acceptance specification, explicitly distinct from an executed model-behavior test or changes to ChatGPT website Project Instructions.
- Reconcile agent, profile and product guidance with the responsive integer square-cell Main grid, permanent centering and existing trusted experimental local plugin runtime; retain historical context, future untrusted-plugin gates and standing Git/security boundaries. No application behavior changes.

## [0.1.0-alpha.8] — 2026-10-09

- Bound session-only Sidebar/Bottom resizing by live Work Area measurements: trial caps of min(300px, 20% width) and min(180px, 25% height), further reserving existing Main space (Issue #26). Keep requested initial sizes 215px/43px and normal minima 160px/43px; relax minima safely when necessary.
- Centralize sizing and keyboard steps, expose effective ARIA bounds, retain requests across temporary viewport reductions and restore the original request/capture state on cancelled gestures or Work Area resize. Preserve independent splitters, Sidebar overflow, centered square-cell Main projection, persistence and Electron/plugin boundaries.
- Add policy and disposable desktop regression coverage for bounds, keyboard/Shift, pointer cancellation/capture, narrow windows and reversible viewport/region changes in both themes and DPR 1.25. Trial dimensions remain pending owner visual evaluation.

## [0.1.0-alpha.7] — 2026-10-08

- Replace the continuous Main editor with an original GeppIO-owned, bounded integer grid: 12×8 reference composition, responsive columns AND rows, square cells, symmetric provisional gutters and no Main scroll (Issue #24 corrective contract).
- Redistribute widgets from stable saved/edit sources using relative anchors and feasible bounded packing; preserve preferred sizes before temporary compression. Aspect bands and projection caching stabilize free window/splitter resizing. Viewport changes preserve v1/v2 bytes; explicit Save commits the visible arrangement and bounds, while Cancel restores the saved source.
- Always center the Main grid; remove the user-facing alignment debug switch and its state (Issue #24 corrective continuation). Keep laboratory/import/presentation controls in Settings/Development and independently resize Sidebar/Bottom in CSS pixels.
- Add deterministic push, boundary compression, preferred-size relocation and bounded multi-widget search with no gravity, eight resize directions, stable gesture reversal and Save/Cancel.
- Introduce validated grid schema v2 in a separate key. Convert v1 read-only, preserve its original bytes, block failed conversion recoverably and require explicit recovery preview/Save; retain profile migration, plugins and native protections.
- Separate workbench, grid rendering/gestures/transactions, pure geometry/occupancy/reflow/schema/storage, Settings and styles by responsibility. Add integer geometry, persistence and disposable Windows interaction coverage.

## [0.1.0-alpha.6] — 2026-10-08

- Add GeppIO-owned bounded continuous Main reflow: live collision chains, displacement before constrained adaptive shrinking, deterministic bounded search and non-destructive rejection (Issue #16; investigation #10).
- Replace the bottom-right resize icon with eight transparent directional edge/corner zones, anchored opposite edges and keyboard resizing; roll back the entire gesture on Escape, cancellation or lost capture.
- Preserve schema v1, Smart Guides, Save/Cancel, trusted fixtures/plugins and Electron boundaries; add geometry and disposable Windows desktop interaction coverage. Cross-region movement remains separate.
- Correct the unaccepted alpha.6 Windows layout UX under Issue #16: provisional 10 CSS-pixel geometry gaps, gesture-aware local reflow with same-axis neighbour compression before lateral resize escape, and resize alignment/size/clearance guides. Normalize touching legacy v1 only in a reversible edit preview, block insufficient-gap Save, and retain the target/security/plugin boundaries; Motion polish remains deferred.

## [0.1.0-alpha.5] — 2026-10-08

- Align active repository references and standing Git synchronization policies with the owner-renamed rabrunos/GeppIO repository (stable GitHub ID 1409287329), retaining the original Issue #22 authorization scope and safeguards.
- Update documentation and future metadata command examples; preserve accepted alpha.4 history, runtime identity, profile recovery and existing security protections.
- Add a focused repository-reference gate and negative regression cases without new dependencies or application behavior changes.

## [0.1.0-alpha.4] — 2026-10-08

- Adopt GeppIO display identity and geppio package, protocol, bridge, environment and developer automation namespaces (Issue #6); retain rabrunos/Geptor as the GitHub repository.
- Copy bounded legacy profile storage and installed plugin packages/preferences only into an absent destination, retaining the original and a local-storage backup.
- Transfer validated layouts/themes between Chromium origins in hidden sandboxed recovery windows; preserve existing destination and corrupt bytes, without expanding the renderer bridge.
- Add disposable profile, origin-transfer, repeat-launch, corruption and security tests in production and development desktop smoke.

## [0.1.0-alpha.3] — 2026-10-07

- Apply the owner's standing commit/push authorization to completed, validated Geptor Issues, with explicit task overrides and reviewed origin/main synchronization.
- Keep workspace-write/on-request, select automatic approval review and enable sandbox network access under the owner's updated project preference; preserve technical boundary approvals.
- Strengthen repository checks and negative tests for active sandbox, approval, reviewer and network defaults; no runtime or global settings changes.

## [0.1.0-alpha.2] — 2026-10-07

- Add workspace VS Code launch/validation tasks and recommended Task Buttons shortcuts, with watched development and build-before-preview behavior.
- Load independently built trusted local plugin packages through a bounded managed directory and versioned manifests.
- Add Settings > Plugins with directory installation, persistent enable/disable, removal and explicit runtime failures.
- Run plugin logic in disposable Web Workers with activate/dispose, declarative widget messages and lifecycle timeouts.
- Add independent counter-widget and background-pulse examples and plugin boundary/lifecycle/desktop tests.
- Preserve bundled fixtures and the Electron security baseline; no untrusted-plugin isolation or advanced UI/permission broker is claimed.

## [0.1.0-alpha.1] — 2026-10-07

- Start a new Windows-first Electron/TypeScript/React workbench from scratch.
- Add fixed header, peer regions, ten synthetic widget fixtures and a continuous Main layout laboratory.
- Add explicit edit/apply/cancel, optional alignment guides, provisional collision rejection and local layout persistence.
- Demonstrate docked/overlay presentation and visual theme tokens without loading plugins.
- Materialize the selected BootCrate method for ChatGPT, GitHub Issues and local Codex.
- Add bounded native surface, pure negative tests, local validation commands and Windows CI configuration.
- Migrate strict dependency and version-scoped build-script policies to pnpm 11 settings and include the initial registry-resolved lockfile.
- Fix desktop-smoke environment types and browser-global shadowing; clarify direct Node setup commands and project doctor invocation.

This is a source foundation, not a public release or a declaration of Windows smoke acceptance.
