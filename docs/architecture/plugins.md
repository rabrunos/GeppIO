# Plugin boundary — trusted local v1/v2 and future design

Alpha.40 adds an essential [Terminal](terminal.md) with a Core-owned native session and shared
xterm presentation. Its fixed native calls are app-only and absent from the Worker facade. Neither
trusted installed plugins nor declarative widget data receive a process-spawning capability.
This does not certify hostile shared-origin Workers or same-user native process isolation.

Alpha.39 adds the [Explorer](explorer.md) to the same essential module, sharing navigation between
its explicit Main/Sidebar widget and Editor activity view. This adds no Worker/native grant or SDK.

Alpha.37 [Files & Editor](documents.md) is an essential bundled host-registered first-party module,
with one shared editor/session and no new external Worker/manifest format. Core document authority
is absent from public API 1/2 and imported content. Final essential packaging/distribution remains
provisional; no installability/uninstallability is asserted.

Alpha.36 assigns the existing Main presentation controls to the known Workspace Essentials
Notes widget through host metadata only. This adds no manifest field, SDK method, permission
or lifecycle action. Checklist and Time Tracker retain their prior capabilities. Presentation
and mounting do not own persisted ordinary data or accepted installation/code identities.

## External folder development (alpha.35 / Issue #44)

Developer Mode is per profile and defaults off. Settings always offers signed-file installation;
when enabled it also offers native-directory loading, explicit reload of external registrations,
and exact linking of legacy managed copies. The header manager exposes the same fixed operations.
The three source types are signed snapshot, legacy managed copy, and trusted external folder.
Only reviewed local authoring is supported; this adds no third-party execution authority.

External registrations persist the canonical absolute source path locally, accepted content digest,
validated manifest/widget history, desired enabled preference and a code-generation UUID. They keep
no persistent code copy. The path is absent from renderer inventory, Worker messages, logs and
workbench exports. Main inspects the complete bounded file set into memory and serves accepted
snapshots through the existing managed protocol. Installing starts disabled; placement is explicit.

Reload checks Developer Mode, source type and the same manifest ID. It validates a full candidate,
then atomically replaces state before changing the in-memory snapshot or revoking channels.
A rejected/canceled/precommit-failed operation preserves the running snapshot. No watcher, rebuild,
inventory refresh or re-enable accepts new bytes. Accepted code can fail activation; that is shown
as a runtime failure, distinct from validation rejection. Each accepted reload gets a new generation
while retaining the installation UUID/data namespace. Renderer replaces its Worker once; Main
checks generation on assets, channel opening, queued requests and before data commit.

Mode off revokes external channels and pauses Workers, retaining desired activation/data/layouts.
Mode on and process restart re-inspect the last accepted digest before execution. A missing,
invalid or changed source appears unavailable with an explicit Reload instruction. No fallback to
memory from a previous process or the legacy recovery copy is permitted. Repeated same-mode
requests are idempotent. In-process accepted snapshots remain immutable until an explicit reload;
this is not live disk monitoring or hostile same-user filesystem protection.

Linking requires the same ID and exact complete file/byte digest as the inspected legacy copy.
It keeps installation UUID, preference, data, layout references and the existing managed recovery
copy. The initial generation equals the legacy revision, so an active identical Worker survives.
Later explicit reloads accept changes. Signed adoption remains limited to byte-identical managed
copies; signed files conflict with external registrations. Unregistering external sources never
writes/deletes their files, and retained legacy recovery copies are marked to prevent rediscovery.

Host text fields flush before reload/pause/removal and the runtime waits for bounded event/data
completion. Unsaved pilot models or an unsubmitted checklist item defer the operation with feedback.
Runtime failure preserves field text for copying; deliberate Retry or "Recarregar descartando
rascunhos" may discard activation-local drafts. This is trusted-pilot handling, not a new author
persistence protocol. Missing widget declarations remain separate recoverable host types, hidden
from new placement, without entering the retired demo archive. Their IDs/placements/compositions
remain available for the declaration to return. Historical widget identities are bounded to 64.

State schema remains 1, with optional Developer Mode/external/retained fields; alpha.34 preferences
remain readable. State is bounded to 1 MiB to hold at most 32 bounded manifests/history records.
A state rename is the commit boundary, not a power-loss/fsync durability guarantee.

## Signed first-party file pilot (alpha.34)

Workspace Essentials can use a separately versioned, bounded Ed25519 file envelope. Main verifies
the complete immutable snapshot before native confirmation, installs disabled, or adopts a valid
byte-identical folder installation while preserving its UUID, preference, data and host references.
Production roots must be independently verified and owner-authorized; an embedded key/name cannot
establish trust. The pinned owner key is scoped only to Workspace Essentials. See [wire format, offline packaging,
trust activation and recovery](plugin-package.md). This does not extend manifest schema 1/API 1/2,
Worker authority or author capabilities, and does not enable general replacement/updates.

## API 2 pilot (alpha.21)

Workspace Essentials opts in through `apiVersion: 2` to bounded literal text fields/lists/actions
and installation-bound ordinary data. The exact v1 facade below stays supported. See
[API 2 data/surface contract and recovery](plugin-data.md) for limits, revocation, replacement,
retention and shared-origin trust limitations. No generic filesystem, credentials, community
execution or general SDK expansion follows from this first-party trusted-local pilot.

## Implemented experimental runtime (Issue #21)

Only owner-authored/reviewed trusted local development packages are supported. Existing legacy
installations keep their managed directory at `userData/plugins/packages/<id>` and preferences in
`userData/plugins/state.json`. New installs are disabled. Discovery validates the actual installed
files, not a static fixture registry. The protocol serves immutable inspected JS snapshots only
for enabled IDs/revisions. Legacy copies are independent of their original folder; link it
explicitly to adopt the external reload workflow.
Invalid installed packages appear as recoverable inventory errors; corrupt preference bytes are
preserved and management is blocked. No package is executed in Main/preload.

For API 1, `plugin.json` has exactly `schemaVersion: 1`, `apiVersion: 1`, `id`, `name`, SemVer `version`,
relative `.js` `entry`, and `widgets: [{ id, title, surface: 'declarative' }]` (zero to eight).
IDs and relative paths are bounded; traversal, links/junctions, unknown manifest fields, duplicate
widget IDs and unsupported file types are rejected. Limits: 32 installations, 64 package entries,
512 KiB/file, 2 MiB/package and 16 KiB/manifest. The fixed native bridge offers list/install
(development-only native directory picker), installFile (native signed-file picker),
setDeveloperMode/reload/link/setEnabled/remove. No renderer paths are accepted. Main validates the
sending window, main frame and exact app URL.

Every activation creates a module Web Worker and imports the independently compiled external entry.
The entry exports `activate(context)` and returns `{ dispose(), onAction?(widgetId, actionId) }`.
The compile-time experimental facade is [plugin.d.ts](../../sdk/plugin.d.ts).
`context.pluginId` is host assigned; `publishWidget(widgetId, { text, action?: { id, label } })`
must match the manifest. `reportStatus(text)` exposes bounded lifecycle/background evidence in
Settings. The host binds identity to the Worker callback, renders text literally and routes only
published actions back to that Worker. No DOM, HTML, arbitrary CSS, FS/process/native API or
inter-plugin API is supplied. The alpha.13 host catalog normalizes legacy contributions to
qualified Main-only, single-view cards in the `Plugins` category using the existing publication/action
route. Category, region eligibility, appearance and presence are host adapter values, not fields
available to authors in manifest v1. Sidebar/Bottom permissions and custom surface declarations
are not added to that manifest. Issue #29 originally added regional
placement for bundled fixtures only; the host adapter does not change runtime authority. Widget surface descriptions
are separate from activate/dispose, allowing future UI adapters without replacing the logic runtime.

Workbench movement and visibility changes preserve mounted view identities. Removing a widget's
presence or changing bar membership does not dispose an enabled plugin or create another Worker;
placing the widget again can reuse its current publication. The
[workbench plugin smoke](../../tools/workbench-plugins-smoke.ts) distinguishes this from disabling
the plugin. Host view/layout persistence is not plugin-owned data persistence: API v1 has no
generic state storage, and Counter initializes its count inside each activation (Issue #23).

Activation, actions and disposal have a 3-second timeout. Exceptions, invalid messages, undeclared
widgets and more than 60 messages/second fail that plugin and terminate its Worker. Disposal clears
runtime widget publications immediately, attempts the hook and terminates the Worker even on failure;
the Worker and its timers are not retained on plugin disable/remove. Disabling does not delete the
existing workbench presence or position: it remains visible with a paused/awaiting-publication message.
Reactivation creates a new Worker and resets the example's activation-local state. The earlier #21
manual acceptance describes the UI of that historical delivery, not removal of current saved placements.
Reload/process exit forcibly terminates Workers; dispose is
best effort during explicit disable/remove, not guaranteed on process exit. Enabled preference
survives a runtime failure; retry is explicit in Settings, or occurs on restart. Sessions retain
only eight recent events and widget state is reset on activation. Package revision changes invalidate
old asset URLs. API 1 compatibility stays exact; API 2 is opt-in. No upgrades or dependency resolver are present.

This is not a community sandbox: Workers share browser origin/storage authority, installed scripts
can reference other enabled local modules, and there are no per-plugin sessions/storage grants,
OS CPU/memory quotas or defense against hostile same-user disk races/resource exhaustion. Main
serializes management and validates bounded snapshots, but copying trusted local code is not a
signature/supply-chain trust guarantee. Production blocks remote network requests and connect-src;
development retains the existing loopback/HMR authority. CORS is enabled for the local custom scheme;
only plugin-script responses in development permit the exact configured loopback origin. Independent
inventory reads are queued even while a management operation/dialog is pending; concurrent mutations
are rejected. Plugin-owned UI, independent security
review and broker/vault/storage/session boundaries remain gates before any untrusted distribution.

Build examples with `pnpm plugins:build`; this compiles each `examples/plugins/*/src` independently
to ignored `.local/plugin-packages/*` using the existing TypeScript dependency. Install that output
through Settings; the core build never imports it. Adding another ready package needs no core edit
or rebuild. The counter contributes a working button; pulse runs a disposable timer with zero widgets.

## Future design intent

External service authentication belongs to its corresponding plugin. The proposed optional
[community identity in Issue #34](https://github.com/rabrunos/GeppIO/issues/34) does not make an
account mandatory for local desktop work or replace service-specific authentication. No community
account, OAuth service, broker or vault is implemented by this runtime.

## One developer experience

The desired output is one approachable SDK. Public functions/commands, context-aware UI slots and generic surface contributions can live behind the same facade. They do not need independent registration bureaucracy, but retain different semantics and authorizations. Prefer extending a small core facade after a real example proves the need.

A plugin can have zero or multiple widgets and background services. The trusted fixture registry is
not that SDK. The experimental runtime above covers local packaging and lifecycle only; no untrusted
JavaScript sandbox, permission dialog, broker, network grant, vault or content-injection API exists.

## Example: a button in another surface

B asks to insert an action into A. On invocation, the action routes to B. If B then calls C, the broker checks an independent B-to-C grant. The Core identifies B from the bound execution channel; it must not trust a payload claiming another identity. B's location in A does not imply access to A's secrets, all data, or C.

With a stable slot, the host/plugin may supply a contextual code block. Without a slot, a generic surface adapter may be necessary. A selector supplied by B is not proof that the requested data is harmless or limited: matching and allowable roots/context must be enforced by a trusted component. No arbitrary `parent()` chain or unrestricted query capability may be marketed as a narrow context grant.

## Capability design

A permission describes actual effect, target, lifetime and data access. The Core supplies the meaning; the author supplies a short purpose. New powers require renewed consent. Deny/revoke must be handled without crashing the whole app. Data already delivered cannot be unlearned by revoking access.

Public API is not synonymous with low risk: file deletion or sending a prompt may matter more than a style tweak. Security warnings must reflect authority, not only the integration mechanism. Consent screens need identity and risk information that an ordinary theme/content extension cannot silently hide or counterfeit.

## Surface modifications

Scoped/declarative UI is a convenient default, not a ban on developer creativity. Sanitization of HTML strings inserted into A must be distinct from ordinary React/event code in B's own isolated UI. The Core can create a button and bind an action reference; a plugin should not need executable inline HTML simply to handle clicks.

Custom CSS can conceal controls or load resources; custom HTML can execute through numerous contexts unless constrained. Shadow DOM/style scoping is not a complete security boundary. Input sanitization, CSP, origin/frame policy and resource restrictions must be designed together with negative tests.

An isolated JS world separates JavaScript global environments, not document confidentiality. A script with normal DOM access is not automatically restricted to one subtree. A Main World script can interfere with reachable page state and behavior. Neither should gain Node/Electron privileges by inheritance. If the page exposes powerful bridges, those bridges can invalidate this claim and must be reviewed.

## Secrets and native access

The desired vault has exclusive plugin ownership and operations mediated using non-spoofable caller identity. A cross-plugin API may perform an action without releasing credentials. Never expose secrets into an extensible renderer to make integration convenient.

Windows encryption at rest does not by itself protect secrets from every program running as the same OS user. A future permission granting arbitrary native code, unrestricted process execution or owner-readable filesystem access conflicts with strong isolation guarantees unless a stronger OS boundary exists. Resolve that threat model before shipping a third-party native-capable plugin feature.

## Validation gate before implementation

For each plugin capability, define the execution context, identity source, allowed data, scope enforcement, resource/time limits, teardown/revocation behavior, extension conflict behavior, upgrade compatibility and negative tests. Begin with a small representative integration; do not build every mechanism in the same task. Independent review is appropriate for consequential boundary changes. A valid manifest or stronger model effort is not proof of security.
