# Product requirements

## Purpose and scope

**GeppIO** is a Windows-first local desktop workbench, with its product identity approved in Issue #6 and technical namespace `geppio`. Windows and Linux are the product direction; current Windows evidence does not establish Linux runtime or distribution support. The owner wants to compose useful workspaces from widgets and, later, community plugins. This is a new codebase, not an adoption of the old Electron prototype or of the review HTML application. No application account, backend, subscription integration or cloud sync is implemented.

The original foundation explored approximately ten synthetic formats. The current host registry has seven demonstration widget types, initially placed as four in Main, two in Sidebar and one in Bottom. The alpha.13/alpha.14 workbench integrates the approved external V1.141 presentation with real host organization and editing features. Its illustrative content does not implement ChatGPT, Codex, Git, an editor, a terminal or a filesystem-connected project. Product decisions and scoped acceptance remain in the relevant Issues, especially #2, rather than being inferred from screenshots or a successful CI run.

## Decision provenance and interpretation

The owner supplied an architectural review exported on 2026-10-07 at 18:03:05 UTC and then requested this local materialization. It covered 58 items: 56 agreements and two requests for discussion, with 19 item comments and two category notes. Agreements with comments are conditional requirements, not unconditional approval of every example. Historical `contextStatus` labels do not override the explicit responses.

This document normalizes the resulting product knowledge; it is not a second progress/decision-index database. The raw review, screenshots with unrelated context, old source ZIPs and BootCrate intake are intentionally not shipped. Active task state and acceptance belong in GitHub Issues once the repository exists.

Two discussion items remain significant:

- Item 12: the owner proposed `Workbench -> Fixed Header + Work Area -> Sidebar / Main / Bottom` without a conceptual Content Area owning Bottom. The prototype uses that sibling model as a reversible implementation of the proposal. Do not label the open discussion as definitively accepted.
- Item 16: the owner asked what a reusable Region meant. Use small shared concepts and explicit responsibilities, not a universal region/plugin framework. Differences between regions are allowed. Broader abstractions remain a design discussion.

The request to begin implementation authorizes a bounded foundation with provisional choices. It does not silently settle the two discussions or authorize all future plugin capabilities now.

## Platform and visual stack

Electron, TypeScript, React, Tailwind CSS, Heroicons and Motion are the implemented stack. Issue #8 additionally selects shadcn/ui as the source for reusable React components in future authorized work: prefer suitable existing local components, then adopt only the needed selected component while preserving GeppIO tokens and visuals. Source selection does not prove prior integration, approve unrelated registries/dependencies, replace the layout engine or expand native/plugin authority. Issue #19 requires individual owner approval before deliberate adoption of a new external library or copied/adapted implementation; its exceptions for the existing selected stack and normal transitive-dependency review remain. Check compatibility, licenses and required notices for each actual integration. TypeScript is mandatory for product and project tooling code. Runtime validation is still required at data/native boundaries; erased TypeScript types are not validation of untrusted JSON.

Windows is the initial runtime validation target. Linux remains a product target without a demonstrated application smoke or distribution in the examined baseline; pure geometry checks on Linux do not prove desktop installation, UX or Codex permission enforcement on either platform. Six or seven simultaneously visible widgets and background activity must eventually be measured with real representative content. No RAM budget or performance guarantee is inferred from using Electron or React. A fake chart is not telemetry.

The visual system should be elegant, coherent and reusable by widgets. Themes are intended to change broad visual identity, not functionality. Begin with design tokens and dark/light examples. Future theme packages must not gain script or native permissions merely because they are called themes. Permission identity and scope must remain legible and trustworthy.

Motion is intended for structural transitions, while CSS handles simple states. Respect reduced motion. During active drag/resize, response to input matters more than decorative animation. Do not assume animations of React DOM nodes also animate future native WebContentsView surfaces.

## Workbench and regions

The fixed header belongs to the workbench but not to the movable widget canvas. Sidebar, Main and Bottom are visually distinct regions coordinated by the workbench. The Sidebar extends alongside Main and Bottom; Bottom occupies the lower area to the right of Sidebar. Bottom remains useful as a persistent region and a boundary outside Main.

Main supports two-dimensional rectangular compositions, not just equal columns. An edge panel scoped to Main uses Main's bounds and appears above Bottom without knowing what Bottom contains. Region placement, available space and z-order must have clear owners. Region is a lightweight shared concept, not a requirement for arbitrary new regions in this version.

## Layout and interaction requirements

**Current host and geometry — Issues #2 and #29.** The active renderer uses continuous
CSS-pixel coordinates, not mandatory square cells or a fixed row/column count. Types declare
min/default/max dimensions, allowed axes and eligible regions. Main edits both axes; Sidebar
fixes x and follows inner width while editing y/height; Bottom fixes y and follows inner height
while editing x/width. Placement is bounded by default, with optional content-bounded horizontal
expansion in Main. Sidebar has one vertical scroll owner and no horizontal scrolling. Bottom
never scrolls, including by focus or programmatic access. Region transfer and scrolling preserve
mounted content and do not start or stop the App-owned plugin Workers.

The current chrome has a separate 48px persistent rail; Sidebar content ranges from 180 to
430px, initially 283px, excluding that rail. Bottom ranges from 125 to 250px, initially 167px.
Effective bounds still clamp to available viewport space. Collapsing Sidebar preserves the rail
and supports a 238px floating peek; it does not create a fourth widget region. Main/Bottom use
the approved 11px horizontal and 9px vertical spacing, and Sidebar content has 15px per side.
Measured content space, borders and scrollbar reservation determine the actual inner coordinates;
these insets are distinct from the geometric 10px widget clearance. The status bar is 25px high,
contains host information and remains outside widget collision/scroll geometry. Some status and
project/Git indicators are illustrative, not measurements of a connected project.

Bundled host constraints specialize Sidebar minimum width to 150px and eligible Bottom minimum
height to 105px, so their content fits the approved 180px/125px chrome minima. Main and historical
codec minima are unchanged. If source relationships/minima cannot fit, preserve the composition,
warn and reject invalid commits instead of overlap, deletion or illegal shrinking. Infeasible
Bottom content remains mounted but withheld with explicit recovery; a normally feasible 125px
Bottom is not automatically a recovery case. Window/region changes project a stable source and
do not write projected positions. Main expansion is initially OFF and remembered separately;
its world grows only to occupied content within finite limits, without a trailing world margin.

Individual move/resize begins only in Edit composition. Eight edge/corner zones respect axes
and anchor opposite edges. Production retains pointer editing; experimental individual handle
Tab stops/arrows/focus outlines are Vite-development-only. Forms, buttons, dialogs and region
splitters keep their keyboard behavior. **The shared paired divider is a deliberate exception:**
it works in Edit and normal use. In Edit it changes the draft as one history intention; in normal
use it validates only its bilateral resize against the confirmed baseline and commits that
accepted intention through its own guarded transaction. It cannot adopt another draft or recovery.
Normal bar/chrome organization also has explicit persistence commands; “only Save writes anything”
is not the current contract.

The solver uses local push, constrained compression, bounded rearrangement and non-destructive
failure, without gravity. Each held gesture resolves from its complete starting snapshot; reversal
within that gesture restores its original arrangement. Pointerup accepts actual rectangles and
size preferences as the next in-memory action baseline, without an individual gesture automatically
saving an Edit draft. Independent later gestures must not revive older compression metadata.
Escape/capture cancellation restores that gesture; Cancel editing restores the last confirmed
checkpoint. Save editing validates/writes and advances that checkpoint while keeping Edit open;
Conclude validates/writes the slot-free document and exits. Undo/redo is bounded session history
of complete intentions, not persistent history of plugin data or every solver frame.

The current optional guide/snap equalizes a horizontally adjacent pair at 50 percent, using
7px entry/14px exit hysteresis. It is distinct from the older general edge/center/size guides
and Alt bypass. Those earlier wishes need scope conciliation in #3/#10; their absence from the
current path is not automatic proof of regression or approved cancellation.

Host types, owner-qualified models, views and placements are separate. Home is protected;
custom bars have independent membership/vertical positions, archive/restore and library behavior.
New activations permit fourteen custom bars plus Home; documents with up to twenty active legacy
custom bars remain readable without silent truncation. The host catalog has search, filters,
presence and actual geometric feasibility, with compatible transfers, swaps and exact reservation
filling. These host capabilities do not make every descriptor field a plugin SDK API.

Compositions preserve explicit Main/Bottom scopes; Sidebar contributes only optional width.
New saves contain format plus widget associations. Collapsed panels begin unselected but can
be included; temporary Edit visibility does not change their canonical visibility. Omitted regions
remain intact when restoring or confirming. Format and Widgets are separate restore actions;
repeating Format can create transient reservations. Reservations retain exact-slot validation,
identity and history, but do not become executable persisted widgets.

The current versioned envelope is `geppio:workbench:v1`, validated independently of old layout keys.
Import/adoption is a preview until explicit confirmation; quota, stale bytes, unsupported schema
or incompatible widget identity preserve the prior bytes. Same-origin Web Locks and byte comparison
coordinate cooperative writers, not hostile same-origin code or every OS failure. Theme, project
display name, snap and host Properties state have separate stores/session behavior, not one atomic
multi-key transaction. Layout persistence does not persist plugin notes, tasks or chat sessions (#23).

**Historical geometry.** Fractional v1, responsive square-cell v2, horizontal ten-row v1 and the
alpha.12 freeform source remain recovery/reference inputs. Issues #24/#28 no longer define active
placement. Their modules, codecs and tests still support explicit conversion and must not be
removed as unused merely because their renderer is inactive. Original bytes are not overwritten
by adoption. The [layout architecture](../architecture/layout.md) distinguishes current rules
from the preserved historical contracts.

**Presentations and tabs.** The single synthetic TestPanel demonstrates Overlay on four edges or
floating, and Docked on four edges. It is not a terminal or a general per-widget presentation API.
General presentations/collapse (#11), workbench widget tab groups (#18) and transient Main-scoped
widget maximization (#25) remain future scopes. Window maximize is already a real native action
and is a different feature. Internal document tabs of a future editor are also distinct from
workbench widget tab groups.

The recorded general-presentation intent remains: Docked consumes region space, Overlay covers
without resizing underlying widgets, and optional top/right/bottom/left anchors are independent
from presentation, resize permissions and collapsibility. Floating/unanchored overlays and
permanent widgets are possible; a collapsed tool needs a discoverable re-entry control. Hiding
its UI must not implicitly stop a background service. These are future design boundaries,
not a claim that the single test panel exposes a reusable SDK.

**Current demonstrators.** Panorama, Fila de trabalho, Biblioteca, Ideias em aberto, Atividade,
Propriedades and Ritmo are seven synthetic types in the host, not production plugins for those
names. Initial placement is Main four / Sidebar two / Bottom one. Host `appearance` includes card
and seamless rendering infrastructure, but every currently registered type is card and manifest v1
does not expose appearance. A visual profile is not a real account; a renamed project is only local
display metadata. Real project/IDE journeys remain in #32.

## Implemented trusted experimental local plugins (Issue #21)

Separate from the bundled fixtures, the application already installs owner-authored/reviewed local
packages with versioned manifests into a managed directory. Settings supports install, enable/disable
and removal; new installs are disabled. Independently built examples include a counter widget and a
zero-widget background pulse. Activation/disposal runs in disposable module Web Workers, with bounded
declarative text/actions, lifecycle timeouts and message validation. No package executes in Main/preload,
and no Node, filesystem, process or generic IPC authority is supplied to plugins or the renderer.
Manifest/API v1 contributions now enter the host catalog and movable Main layout as single-view
cards. The manifest does not publish the host's category, region, appearance, multi-area, rail-action
or tab policies to plugin authors. Hiding/removing a view preserves its Worker; disabling the plugin
disposes it and reactivation restarts its own state. Package installation/enabled preferences persist,
but no generic plugin-owned data-storage API is implemented (#23).

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

## Separately recorded future initiatives

Issue #32 investigates a real modular IDE and standalone file versus Workspace journeys; no
filesystem project, editor, global search, Git or PTY is implied by the current shell. Issue #30
records an optional authenticated LAN mobile companion, not an implemented server or permission
to expose the development server. Issue #31 has a real compact host rail, but optional plugin
rail-action contributions remain future SDK work. Issue #34 records an optional community account,
forum and public profiles; it does not make account/login mandatory for local desktop use or
replace per-service plugin authentication.

Issue #35 preserves the complete provisional plugin/widget catalog. Its names, categories,
regions, distribution tiers, dependencies and stages are revisable ideas, not shipped capabilities,
assigned versions or an approved roadmap. This specification does not select an implementation
order. Physical/visual owner acceptance remains scoped to each recorded delivery; historical
functional acceptance or the conversation-only alpha.14 approval is not global application approval.
