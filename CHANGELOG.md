# Changelog

Integrated source changes, not a publication ledger. Version comes from package.json.

## [0.1.0-alpha.100] — 2026-11-26

- **Native host (new, Rust + GPUI):** add the `native/` Cargo workspace approved in #73. It contains:
  - GeppUI, an independent component library: both theme token tables, device-pixel snapping, per-glyph letter spacing, Heroicons, interruptible CSS-style motion with the measured reversal rule, reduced motion, and a button, icon button, popover, menu item, dialog and scroll area.
  - The pure `geppio-core` shell geometry.
  - The first native screen: a frameless window with native Snap, the global and context headers, the concave header/Sidebar corner, the rail, a Sidebar with collapse, interrupted reversal and an animated floating peek (tint-only backdrop), Bottom, splitters, the status bar, the Main area, the theme switch, and the profile menu with the About dialog.
  - Its own preferences profile (`%APPDATA%\geppio-native`); Electron data is never touched.
  - An external GeppUI consumer.
- **Repository and CI (both hosts):**
  - Pin GPUI and `gpui_platform` at Zed v1.30.2 by full SHA, with `Cargo.lock` and `--locked`.
  - Enforce the approved transitive policy with cargo-deny 0.20.2, and check crate directions, sources and pins in `check-modules`.
  - Mirror the version in the Cargo workspace.
  - Add a separate `Windows native` CI job required by the aggregate check, using `actions/cache` pinned by SHA.
  - Add the Heroicons notice in `docs/legal`.
- **Claude Code workflow:** adapt the project skills and the security reviewer to the native host, and add a read-only visual reviewer for side-by-side captures.

## [0.1.0-alpha.99] — 2026-11-26

- Update existing pins: Electron 44.11.6 and Vite 7.3.8 (patch releases), ESLint 10.15.0, typescript-eslint 8.73.0 and Monaco 0.58.0 (minor; bundles DOMPurify 3.4.17 and Microsoft's MIT `@vscode/diff` backend, whose notice is retained). Refresh transitive undici 7.30.2 and minimatch 11.0.9, which adds `@isaacs/nonrecursive-glob-match` to the lint chain. The complete locked graph audits clean, retiring the Monaco 0.57.0 advisory exception.
- Pack the web libraries with the Windows system tar so the packaging smoke also runs from Git Bash.
- Keep `.local/` development diagnostics readable for Claude Code and its reviewer; only `.local/private/` is denied.

## [0.1.0-alpha.98] — 2026-11-26

- Separate widget catalog and composition views, plugin presentation and activation, Sidebar bar controls and host Git responsibilities while preserving the Electron reference.
- Replace client-specific workflow policy and its fixtures with shared project guidance, repository integrity checks and project-local Claude Code discovery. Retire the Codex and `.agents` adapters.
- Document observable behavior and unresolved trust boundaries for the future Rust/GPUI host and independent GeppUI library.

## [0.1.0-alpha.97] — 2026-11-25

- Adopt Apache License 2.0 for GeppIO-owned repository material, with the canonical license at the root, consistent first-party package metadata and concise licensing guidance.
- Include the license in generated GeppUI and Editor archives and as LICENSE-GeppIO in Standalone distributions, preserving the existing Electron and other third-party notices.

## [0.1.0-alpha.96] — 2026-11-25

- Translate the public root README into English and align its durable language rule, retaining pt-BR owner communication and application UI.
- Replace the previous SVG header with a cover combining the owner's mascot artwork and the requested moving-widget illustration. Preserve the concise navigation and documented capability boundaries.

## [0.1.0-alpha.95] — 2026-11-25

- Replace the long public README with an original illustrated header, concise pt-BR product introduction, supported quick start and links to the six modules and canonical guides.
- Correct obsolete presentation claims, preserve the local-widget walkthrough in a focused usage guide, and make alpha/Windows and pending-license scope visible. No application behavior or dependency changes.

## [0.1.0-alpha.94] — 2026-11-25

- Make direct Codex investigation, planning, implementation and validation the normal workflow, with optional ChatGPT support and requested handoffs. Keep automatic commit/push for validated in-scope work unless the owner explicitly opts out.
- Align the v5 project profile, schema, checks, skills, guidance and Issue forms. Preserve repository identity, protected settings, version discipline and negative policy tests. Retire the mandatory prompt templates and one-time foundation bootstrap helper and its obsolete tests.
- Correct stale architecture summaries and reconcile active planning records after the modular Electron delivery. The interrupted alpha.79–93 targets remain historical and undelivered; this independent workflow delivery uses alpha.94 without changing product functionality.

## [0.1.0-alpha.78] — 2026-11-25

- Exercise Sidebar collapse resistance in a window inside the Windows work area. Verify the Chromium pointer event, target, capture and release coordinates before checking the resulting layout and saved state.

## [0.1.0-alpha.77] — 2026-11-25

- Pass the disposable identity-migration fixture its profile and origin independently of the Electron launcher arguments. Attest short-lived Windows recovery windows at creation and check each process's receipts at shutdown.
- Restore the signed package preview's access disclosure for API 1/2 plugins. The API 3 preview describes its explicit communication grants.

## [0.1.0-alpha.76] — 2026-11-25

- Organize the Electron application, Runtime, GeppUI, Monaco Editor, plugin SDK and Standalone into six workspaces. Extract continuous geometry, document contracts, capability lifecycles, web presentation and editor APIs. Replace the Tailwind reset and Motion effects with project-owned CSS and interactions.
- Add API 3 opaque-origin HTML/CSS/JavaScript surfaces, optional TypeScript/JSX preparation, versioned peer endpoints and explicit session grants. Keep API 1/2 Workers, development-folder snapshots and signed publisher pins. Permit compatible disabled API 3 signed updates.
- Generate independent portable Windows applications from selected definitions. Add packed-library consumer and product/surface isolation checks. Route the work through the unified contract, project skills and scoped roles.

## [0.1.0-alpha.75] — 2026-11-24

- Offer explicit recovery of unsaved UTF-8 text from a bounded plaintext profile store. Recovered documents use fresh untitled identities and Save As to choose a destination.

## [0.1.0-alpha.74.1] — 2026-11-24

- Keep a reviewed replacement pending while earlier cursor and tab metadata finishes saving. Revalidate the pending file before writing and preserve per-file outcomes if the batch stops.

## [0.1.0-alpha.74] — 2026-11-24

- Filter project text search by literal relative path and extension. Review selected matches before replacing them, see exclusions for changed documents, and track each file's outcome.

## [0.1.0-alpha.73.1] — 2026-11-23

- Derive the editor tabs' accessible reorder shortcuts from the supported arrow keys. Record the verified historical false positive for the literal shortcut in Alpha.73.

## [0.1.0-alpha.73] — 2026-11-23

- Reorder and pin document tabs, close unpinned tabs by group or across both groups, and restore their arrangement through explicit project recovery.

## [0.1.0-alpha.72.1] — 2026-11-23

- Synchronize the Workspace Tools desktop journey with the completed project close and the visible project menu before reopening it.

## [0.1.0-alpha.72] — 2026-11-23

- Open or move tabs between two editor groups. Both groups can edit one shared model with independent reading positions, an adjustable divider and a recoverable narrow layout.

## [0.1.0-alpha.71] — 2026-11-23

- Create untitled documents, choose a native Save As destination and save all open documents in order. A canceled or failed save reports the completed prefix and preserves the remaining drafts.

## [0.1.0-alpha.70] — 2026-11-23

- Rename an open file from the Explorer or with F2. The editor keeps its draft, undo history, language and view. Save uses the confirmed new name. An uncertain move requires reconciliation.

## [0.1.0-alpha.69.1] — 2026-11-23

- Preserve the Windows temporary directory spelling when launching the Workspace Tools smoke with a disposable profile.

## [0.1.0-alpha.69] — 2026-11-23

- Read passive text, list and table reports from the selected workspace. Open the shared Tools window from Code or Workbench and refresh explicitly after external changes.

## [0.1.0-alpha.68] — 2026-11-23

- Preview composition templates from installed plugins and save a personal copy, including while the provider is disabled.

## [0.1.0-alpha.67] — 2026-11-23

- Browse the first-parent history of the selected Git root and compare committed file contents in the shared read-only diff editor.

## [0.1.0-alpha.66] — 2026-11-23

- Reload the active text file from disk. An explicit discard decision protects dirty or unresolved drafts, and other tabs retain their models and undo histories.

## [0.1.0-alpha.65] — 2026-11-23

- Create an empty file or folder in the project Explorer and rename a closed file in the same directory on Windows. Existing destinations keep their contents.

## [0.1.0-alpha.64] — 2026-11-22

- Find and open files by name within the selected project. Quick Open reuses the editor's existing tabs and preserves drafts and undo history.

## [0.1.0-alpha.63.1] — 2026-11-22

- Verify the portable composition bridge and its two picker methods in the desktop smoke.

## [0.1.0-alpha.63] — 2026-11-22

- Export one saved composition to a new file and preview portable layouts before importing a separate library item. Apply geometry or resolve existing destination widgets explicitly.

## [0.1.0-alpha.62.1] — 2026-11-22

- Make the keyboard cancellation check hold the Search directory handle even when background Git status visits the same folder first.

## [0.1.0-alpha.62] — 2026-11-22

- Open Git and Search together in internal windows. Each reuses its Core session, supports keyboard movement and restores focus on close.

## [0.1.0-alpha.61] — 2026-11-22

- Search saved workspace text from GeppIO Code. Explicit search, cancellation, bounded results and checked navigation preserve open file drafts.

## [0.1.0-alpha.60] — 2026-11-22

- Stop periodic Terminal reads after empty synchronization and final output drain. Resume reads on explicit session actions and reconnection.

## [0.1.0-alpha.59] — 2026-11-22

- Include widget group frames and ordered tab membership in the pending layout check. Selecting a tab continues to use the existing navigation flow.

## [0.1.0-alpha.58] — 2026-11-22

- Revalidate the window owner before publishing plugin management changes, restore managed packages after a refused removal and reconcile an uncertain preferences write before reporting its outcome.

## [0.1.0-alpha.57] — 2026-11-22

- Protect plugin management using reported local drafts and host-owned write attempts. Reconcile a rejected write against its stored content and retain buffered edits until recovery or explicit discard.

## [0.1.0-alpha.56] — 2026-11-22

- Distinguish refused document saves from unconfirmed replacements. Preserve the affected draft, undo history and earlier confirmed saves when a multi-document close stops.

## [0.1.0-alpha.55] — 2026-11-22

- Workspace Essentials 1.0.1 reconciles ambiguous writes against the last confirmed and attempted documents, keeping later edits and refusing to overwrite divergent storage.

## [0.1.0-alpha.54] — 2026-11-18

- Register Git Changes as a shared host View and open it directly in one movable, non-blocking internal window from GeppIO Code or the Workbench project menu.
- Share the Core Git session with the existing sidebar and widget while keeping window geometry in memory and the blocking Git comparison above the floating presentation.

## [0.1.0-alpha.53] — 2026-11-18

- Synchronize the native PTY with xterm when a Terminal session starts or restarts, preserving keyboard focus and the shared Terminal across GeppIO Code and the Workbench.

## [0.1.0-alpha.52] — 2026-11-18

- Add the official App Host and GeppIO Code with Explorer, Git activity, tabbed Monaco, Terminal and contextual status alongside the independent Workbench.
- Keep native sessions, Monaco history, plugin Workers and saved Workbench layouts across guarded, window-local experience changes.

## [0.1.0-alpha.51] — 2026-11-18

- Preserve the exact fractional rectangle when a widget resize returns to its pointer origin, restoring neighboring geometry and releasing the previous alignment guide.
- Add focused geometry and snap-lock regressions and verify neighboring geometry in the existing eight-handle Electron journey.

## [0.1.0-alpha.50] — 2026-11-16

- Added an opt-in local isolated Electron smoke runner using an inactive Windows desktop and a disposable first-party Win32 bridge, with owned process jobs and fail-closed launch/cleanup.
- Routed test launches through one shared guard; local visible debugging requires explicit opt-in, while the existing hosted Windows CI groups and assertions remain intact.
- Refused shared-clipboard/paste suites in desktop-only isolation and added a distinct real application ConPTY probe without claiming replacement coverage for the complete Terminal gate.
- Corrected the desktop resize test's integer-only measurement oracle to preserve the existing fractional CSS-pixel surface contract and tolerance at DPR 1.25.

## [0.1.0-alpha.49] — 2026-11-16

- Split required Windows CI into three independent runners, preserving the aggregate windows status and unchanged Secrets gate.
- Run all Node suites once and reuse each runner's own validated builds; preserve every existing Electron production/development/DPR journey and public focused command.
- Add exact CI coverage/failure-propagation regressions, per-suite timings and a three-level local validation guide without changing application behavior or dependencies.

## [0.1.0-alpha.48] — 2026-11-16

- Replaced eager whole-worktree Git validation with bounded Git-native ignore queries, pruning ignored untracked dependency trees while retaining tracked paths and ancestors.
- Separated read-only status compatibility from existing single-file compare/index-action gates; retained strict metadata/configuration isolation, racy-index timestamp checks and native write integrity.
- Added path-free refusal categories for unsupported layouts, metadata, configuration and visible redirects. No new engine, dependency, Worker grant or automatic repository repair was introduced.

## [0.1.0-alpha.47] — 2026-11-16

- Added a single-root local Workspace with explicit open/close and bounded restoration of project file tabs and clean view state after native reauthorization.
- Preserved the private Git index timestamp conservatively so fast same-size edits cannot be hidden by copying metadata; added a deterministic actual-Git nonmutation regression.
- Kept standalone drafts and running terminals independent from project transitions; unsaved source, undo history and processes are not persisted.
- Started new terminals in the revalidated project root, with home fallback and explicit startup-directory information. No renderer-supplied cwd, automatic project command or new dependency was added.

## [0.1.0-alpha.46] — 2026-11-16

- Added bounded native document ownership and internal Editor tabs, with independent drafts, save targets, revisions, Monaco models, undo, language and view state.
- Protected inactive dirty documents during tab/window close; canceled or failed saves retain drafts. Existing file grants survive Explorer root changes.
- Kept one shared Editor presentation across modes, with active-document Status Bar/Explorer association and saved-disk Git refresh. No dependency or public plugin capability was added.

## [0.1.0-alpha.45] — 2026-11-15

- Added compact Explorer Git letters and unique ancestor counts from the existing bounded snapshot, preserving index/working-tree layers, untracked and conflict semantics with Portuguese descriptions.
- Excluded only `.git` metadata from native Explorer navigation before visible listing budgets; retained unrelated dotfiles and unchanged native authority checks.
- Exposed Git recognition, clean state and path-free failure diagnostics in Explorer. Distinguished missing root metadata, unsupported linked metadata and unsupported installed Git versions without parent discovery or relaxed configuration rules.
- Connected saved-document and Explorer refresh invalidations to one coalesced, generation-aware Git query; uncertainty from index writes still requires an explicit Git refresh. No watcher, dependency or plugin capability was added.

## [0.1.0-alpha.44] — 2026-11-15

- Added explicit per-file Stage/Unstage in the existing Git Changes activity and Main/Sidebar widget, using saved disk content and preserving dirty Monaco sessions.
- Kept read-only status/diff on disposable metadata. The separate real-index write uses an isolated-config, one-file binary patch and Git's native cached-apply lock/preimage checks; no shell, provider service, remote authentication or plugin grant is added.
- Added stale-snapshot/index/HEAD/file checks, strict ordinary-index/object-storage validation and conservative uncertain-outcome handling for native interruption. Renames, conflicts, special indices, unsupported accelerators and mode-only changes remain outside the write pilot.
- Extended disposable real-Git and Windows Electron coverage for index transitions, saved-versus-draft bytes, non-target preservation, executable-config rejection and concurrency/interruption. Existing Monaco/DOMPurify advisory exception remains; no dependency changed.

## [0.1.0-alpha.43] — 2026-11-15

- Added first-party read-only Git Changes in the ordinary Main/Sidebar catalog and the existing Editor activity rail, sharing one ephemeral state owner and the exact Explorer folder grant.
- Inspections use a bounded disposable metadata copy and fixed installed Git builtins with isolated configuration/environment. No Git operation writes selected repository data; unsupported roots, filters, extensions, links and budgets fail explicitly.
- Added independent disposable Monaco Diff Editor models for bounded HEAD-to-saved-disk UTF-8 comparisons, preserving the active document draft, undo history and native authority. Global Git settings are deliberately ignored; this is not staged/unstaged layer comparison.
- Added disposable-repository and real Windows Electron security, nonmutation and presentation coverage. Existing Monaco/DOMPurify advisory acceptance remains in force; no dependency or public plugin capability was added.

## [0.1.0-alpha.42] — 2026-11-14

- Replaced the official file textarea with stock Monaco 0.57.0: local syntax/language modes, find/replace, multiple cursors, folding, indentation and ordinary editor shortcuts in both presentations.
- One session-owned Monaco model/editor retains undo/redo, selections and viewport across Editor/Widgets switches. EditorSession remains the exact draft owner; DocumentStore retains native authority, explicit saves and conflict/close protection. Simultaneous model edits preserve untouched mixed EOL tokens and BOM.
- Connected actual Monaco cursor/language state to the existing Status Bar, retaining Explorer, Terminal and host geometry. Added local ESM language Workers and bundled font MIME support without weakening CSP.
- Added pure and actual Electron Monaco tests for production/development, themes, resizing and simulated DPR 1.25, plus existing document/workbench regressions. Physical owner acceptance remains separate.
- Pinned the individually approved Monaco package with its upstream notices. The owner explicitly accepted the documented bundled DOMPurify 3.4.15 advisory risk for this local, non-distributed prototype; this is not a clean dependency audit or an automatic future upgrade.

## [0.1.0-alpha.41] — 2026-11-14

- Editor Explorer and Terminal now fill the same measured usable Sidebar/Bottom rectangles as host widget presentations, including regional insets, scrollbar reservation, clipping and resizing. Removed the separate Explorer flow and guessed Terminal insets.
- Preserved Sidebar reveal/peek keyboard interaction, the Explorer's inner tree scroll, Terminal internal scrollback and the existing shared document/native-terminal sessions. Main geometry, saved placements, bars and Worker lifecycle remain unchanged.
- Extended built Windows Electron coverage for measured regional parity across themes, sizes, dock/collapse/peek, resizing and DPR 1/1.25; physical owner acceptance remains separate.

## [0.1.0-alpha.40] — 2026-11-14

- Added a genuine persistent PowerShell/ConPTY Terminal using approved xterm 6.0.0 and node-pty 1.1.0, with input, ANSI/Unicode, interrupt, bounded history, resize, actual exit/restart, explicit termination and native-owner cleanup.
- One Core session and one session-owned emulator serve the official Main/Bottom widget and Editor's existing Bottom presentation; mode switches retain shell state, output, document drafts and unrelated Workers without automatically placing widgets.
- Connected the fixed 25px Status Bar to actual document dirty/busy/error/saved, UTF-8/BOM, EOL, cursor and session-only language state, plus real terminal phase/exit failure and reveal/focus routing. Removed unsupported decorative indicators.
- Added focused pure and Windows built-Electron native Terminal/Status Bar coverage, Windows CI and scoped lifecycle/build/security documentation. Windows Node-API prebuilds work with Electron 44.6.0 without another rebuild package. Physical owner acceptance remains separate.

## [0.1.0-alpha.39] — 2026-11-14

- Added the official Files & Editor Explorer: native-selected navigation root, bounded lazy tree, keyboard navigation, refresh/retry, and shared state between the Editor activity panel and explicitly placed Main/Sidebar widget.
- Editor mode uses Explorer instead of user bars; collapse/peek/resize reuses host chrome with session-only Sidebar preferences. Widgets bars, layout bytes and plugin lifecycles remain independent.
- Main holds revocable opaque directory/node grants, validates full ancestor identities and canonical targets, refuses links/special paths and oversized listings, and opens files through the existing document/draft/close service. No Worker or public SDK authority was added.
- Added pure/native Electron Explorer regressions and Windows CI. Path-based TOCTOU, special Windows storage/reparse tags and existing atomic-save metadata limitations remain disclosed; owner Windows acceptance is separate.

## [0.1.0-alpha.38] — 2026-11-14

- Match direct Editor mode to the host-measured usable Main rectangle used by maximized widgets, including expansion, viewport/region resizing and fractional DPR.
- Share the ordinary card border, radius and clipping without invoking widget maximize or persisting an editor placement; retain the official editor and shared document session.
- Add measured Electron comparisons against real maximized Notes in both themes, narrow/wide windows, Sidebar/Bottom states and Main expansion, with dirty-buffer, exact save/layout bytes and maximize/restore regressions.

## [0.1.0-alpha.37] — 2026-11-13

- Introduce essential first-party Files & Editor with one selected UTF-8 file, shared editable session, direct Editor mode and explicitly placed Main editor widget; no public SDK or dependency changes.
- Add fixed window/main-frame-bound native selection, save and release with revocable opaque handles, 1 MiB bounds, exact content/identity checks and BOM/newline preservation.
- Retain drafts on conflicts and failures; coordinate replacement/native close with Save/Discard/Cancel. Document sibling-replacement Windows ACL/metadata limits and deferred unsaved crash recovery.
- Preserve workbench/plugin lifetimes and layout bytes across modes; add pure/native-boundary and Electron document smoke to Windows CI.

## [0.1.0-alpha.36] — 2026-11-13

- Enable the host-assigned experimental Main presentation pilot for real Workspace Essentials Notes, reusing four-edge Docked/Overlay, free floating, compact strips, sizing and constrained-window adaptation.
- Restore Notes' saved Normal geometry independently of panel preferences and plugin data. Refuse grouped presentation changes and require explicit Normal before regional transfer, retaining atomic transactions and existing persistence formats.
- Keep presentation-only Edit confirmations from adopting viewport/catalog projection; support Enter/Space on existing compact panel and splitter controls.
- Add installed-package presentation smoke in both themes at DPR 1 and simulated 1.25 to the presentation/desktop CI chain; retain Essentials and timestamp-based Time Tracker continuity controls.

## [0.1.0-alpha.35] — 2026-11-13

- Add per-profile Developer Mode, disabled by default, with native-folder loading from the original built source and explicit reload through bounded in-memory snapshots.
- Keep installation/data UUIDs distinct from accepted code generations; atomically accept reloads, revoke stale channels, replace Workers once, and preserve confirmed data and workbench/recovery identities.
- Pause external sources when Developer Mode is off, verify accepted content on resume/restart without recovery-copy fallback, and retain source files on unregister.
- Link byte-identical alpha.34 managed copies to their original folders while retaining their recovery copy; preserve scoped signed-file verification/adoption and legacy compatibility.
- Flush host input drafts before lifecycle changes, defer unsaved pilot edits, and offer deliberate recovery after activation failure. Add focused unit, interruption and Windows Electron scenarios.

## [0.1.0-alpha.34] — 2026-11-13

- Add a bounded, domain-separated Ed25519 file envelope and offline signing tools for the first-party Workspace Essentials pilot, without dependencies or manifest/API changes.
- Verify a native-selected immutable snapshot before confirmation; install disabled or adopt a byte-identical legacy installation with its UUID, enabled preference, ordinary data and workbench references preserved.
- Atomically commit a managed signed-snapshot reference, reverify trust/content on startup, retain recoverable failures without legacy fallback, and preserve installation-bound data revocation.
- Pin the independently verified owner-authorized Ed25519 public key only for Workspace Essentials. Keep disposable roots in injected test instances/a separate test build, and support an owner-signed package smoke against the normal production build.

## [0.1.0-alpha.33] — 2026-11-10

- Synchronize the native group smoke with actual selected-tab state before reading inert content or comparing persisted groups after restart.
- Exercise pending preference writes under a controlled Web Lock; preserve exact active-tab, identity, order and restart assertions without changing runtime behavior.

## [0.1.0-alpha.32] — 2026-11-10

- Keep every widget body visible and mounted but inert to mouse/keyboard input throughout Edit layout, including full/compact plugin surfaces, host fixtures and grouped members in all regions.
- Route body focus to a usable layout control while keeping headers, tabs, grouping, navigation and transaction controls available even when the options panel is closed.
- Preserve accepted normal drafts/saves, local identities, Workers and background timing; restore content interaction after Conclude or Cancel without remounting.

## [0.1.0-alpha.31] — 2026-11-10

- Animate the existing compatible widget/group frame between its projected normal rectangle and usable Main using shared frame motion and theme timing.
- Keep Main peers visible behind a sharp raised frame with a subtle Main-only transition blur and input guard. Preserve mounted content, tabs and Workers.
- Reverse interrupted transitions from their actual on-screen rectangle, follow viewport changes, clear on Edit/unavailability and respect reduced motion without persisting presentation geometry.
- Add bounded native window/viewport conversion diagnostics and an isolated resize probe while retaining the complete desktop path and original tolerance.

## [0.1.0-alpha.30] — 2026-11-10

- Extend compatible Normal tab groups to Sidebar Home/custom bars and Bottom with regional aggregate minima, stable content identities and ordinary placement.
- Partition group transfers by destination eligibility in one atomic layout intention. Preview moving/staying counts, retain relative order and active tabs, select compatible frame hosts, and refuse illegal partitions or insufficient room.
- Preserve regional groups through history, restart and included Bottom compositions. Keep Sidebar composition scope width-only and older Main group snapshots readable without startup writes.
- Synchronize native drop/composition probes with settled host tracks and the observed flight/reveal lifecycle, retaining strict capture, duration and geometry assertions; retain bounded activation and presentation diagnostics.

## [0.1.0-alpha.29] — 2026-11-10

- Extend shared alignment to active individual resize edges and corners, holding opposite edges fixed. Add policy-clearance spacing candidates on both axes, including diagonally separated widgets, with distinguishable measured gap guides.
- Retain deterministic 7px/14px hysteresis, regional axes and the existing bounded reflow/settlement fallback. Pair dividers and region splitters retain their independent behavior.

## [0.1.0-alpha.28] — 2026-11-09

- Group the three compatible Workspace Essentials Main widgets into a single bounded frame with independent host/member eligibility. Dedicated header targets support drag or click/focus selection; Edit supports reorder, atomic detach, history and checkpoints.
- Persist nested versioned membership, order and active tab through the existing layout/composition codec. Preserve each actual view, content DOM and plugin Worker across tab switching; maximize the shared frame transiently with its tabs intact.
- Keep aggregate member minima in the existing freeform solver. Too-small targets and detach without room refuse atomically; convert grouped frames to empty format reservations only after explicit separation. Older layouts remain readable without startup writes.
- Establish the compact-panel precondition before the presentation smoke samples Sidebar transitions. Native pointer evidence shows the preceding overlap probe can enter the Floating strip; preserve geometry assertions and hover behavior rather than treating an intended reveal as a sizing failure. Synchronize splitter probes with the preceding storage command and native target actionability, retaining capture assertions and bounded evidence.

## [0.1.0-alpha.27] — 2026-11-09

- Show edge/center alignment guides during Normal Main drag in Edit, with 7 CSS-pixel entry, 14px release and deterministic ties. Resolve candidates and snap validation together in the shared freeform engine, retaining the ordinary solver result and operation budget when snapping fails.
- Keep guide paint/pointer integration in the renderer and clear feedback at invalidation/cancel/drop. Preserve resize, Sidebar insertion, Bottom, settlement, history and saved-layout paths.
- Wait for initial workbench readiness before the maximize smoke's first resize/settlement, correcting the alpha.26 Windows CI driver precondition without changing maximize behavior or assertions.

## [0.1.0-alpha.26] — 2026-11-09

- Add optional host-owned Main maximize/restore to Workspace Essentials Normal surfaces. One transient surface fills usable Main through the shared viewport frame projection; peer content/Workers stay mounted, Sidebar/Bottom/window chrome stay accessible.
- Preserve saved geometry bytes, normal viewport projection and Docked/Floating behavior. Restore on entering Edit or target unavailability; controls support ordinary focus and keyboard activation.

## [0.1.0-alpha.25] — 2026-11-09

- Add an independently installable trusted-local Time Tracker with one timestamp-based timer and a shared local report of daily totals and paginated sessions. Explicit placement supports Main, Sidebar and Bottom; compact summaries retain start/pause controls.
- Persist running start and stable completed interval identities through existing revisioned API 2 data. Reconcile lost acknowledgements on retry without duplicating intervals or replacing divergent/corrupt data; retain activation-local pending changes on failure.

## [0.1.0-alpha.24] — 2026-11-09

- Enable existing Workspace Essentials notes, checklist and saved prompts in Bottom through host placement policy, with compact selection/read-only text previews and checklist toggles at the useful 105px minimum. Keep full editors in Main/Sidebar and scratch Main-only.
- Reuse the installation, view/model identity, existing API 2 publications and revisioned data; no reinstall, manifest migration or additional plugin authority.
- Adapt compact Bottom heights to the Sidebar minimum on ordinary transfers while retaining exact-slot validation. Require the focused Sidebar smoke to observe the exact confirmed note on disk before reloading, rather than a preceding New acknowledgement plus a pending local draft.

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
