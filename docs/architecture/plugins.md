# Future plugin boundary — design intent, no runtime yet

## One developer experience

The desired output is one approachable SDK. Public functions/commands, context-aware UI slots and generic surface contributions can live behind the same facade. They do not need independent registration bureaucracy, but retain different semantics and authorizations. Prefer extending a small core facade after a real example proves the need.

A plugin can have zero or multiple widgets and background services. The trusted fixture registry is not that SDK. No installation, manifest loader, JavaScript sandbox, permission dialog, broker, network grant, vault or content-injection function is present in this version.

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
