# Plugin boundary — trusted local v1 and future design

## Implemented experimental runtime (Issue #21)

Only owner-authored/reviewed trusted local development packages are supported. Main copies a selected
directory to `userData/plugins/packages/<id>` and atomically persists installation preferences in
`userData/plugins/state.json`. New installs are disabled. Discovery validates the actual installed
files, not a static fixture registry. The protocol serves immutable inspected JS snapshots only
for enabled IDs/revisions. Source edits do not mutate installed packages; remove/reinstall to update.
Invalid installed packages appear as recoverable inventory errors; corrupt preference bytes are
preserved and management is blocked. No package is executed in Main/preload.

`plugin.json` has exactly `schemaVersion: 1`, `apiVersion: 1`, `id`, `name`, SemVer `version`,
relative `.js` `entry`, and `widgets: [{ id, title, surface: 'declarative' }]` (zero to eight).
IDs and relative paths are bounded; traversal, links/junctions, unknown manifest fields, duplicate
widget IDs and unsupported file types are rejected. Limits: 32 installations, 64 package entries,
512 KiB/file, 2 MiB/package and 16 KiB/manifest. The native bridge offers only list/install (native
directory picker)/setEnabled/remove. Main validates the sending window, main frame and exact app URL.

Every activation creates a module Web Worker and imports the independently compiled external entry.
The entry exports `activate(context)` and returns `{ dispose(), onAction?(widgetId, actionId) }`.
The compile-time experimental facade is [plugin.d.ts](../../sdk/plugin.d.ts).
`context.pluginId` is host assigned; `publishWidget(widgetId, { text, action?: { id, label } })`
must match the manifest. `reportStatus(text)` exposes bounded lifecycle/background evidence in
Settings. The host binds identity to the Worker callback, renders text literally and routes only
published actions back to that Worker. No DOM, HTML, arbitrary CSS, FS/process/native API or
inter-plugin API is supplied. Widgets appear in a separate strip inside Main; cross-region placement,
freeform layout persistence and custom isolated surfaces are deferred. Widget surface descriptions
are separate from activate/dispose, allowing future UI adapters without replacing the logic runtime.

Activation, actions and disposal have a 3-second timeout. Exceptions, invalid messages, undeclared
widgets and more than 60 messages/second fail that plugin and terminate its Worker. Disposal clears
widgets immediately, attempts the hook and terminates the Worker even on failure; no widgets or
timers are retained on disable/remove. Reload/process exit forcibly terminates Workers; dispose is
best effort during explicit disable/remove, not guaranteed on process exit. Enabled preference
survives a runtime failure; retry is explicit in Settings, or occurs on restart. Sessions retain
only eight recent events and widget state is reset on activation. Package revision changes invalidate
old asset URLs. Manifest/API compatibility is exact v1; no upgrades or dependency resolver are present.

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
