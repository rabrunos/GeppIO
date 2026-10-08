# Changelog

Integrated source changes, not a publication ledger. Version comes from package.json.

## [0.1.0-alpha.7] — 2026-10-08

- Replace the continuous Main editor with an original GeppIO-owned, bounded integer grid: centrally configured 12 columns, 8 initial rows, square cells fit to both viewport dimensions, symmetric provisional gutters and no Main scroll (Issue #24 amendment).
- Center the grid by default; move laboratory/import/presentation controls into Settings/Development, retain a session-only alignment debug switch and independently resize Sidebar/Bottom in CSS pixels.
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
