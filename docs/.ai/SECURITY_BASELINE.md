# Selected security baseline

The current app is local and has no account, remote content, terminal, database or
secret vault. Issue #21 adds only explicitly trusted local development plugins. Offline does not mean trusted input. JSON layout import, saved layout bytes,
asset URLs and build dependencies are relevant inputs. See the [control map](../architecture/security.md).

The proposed [optional community identity](https://github.com/rabrunos/GeppIO/issues/34) is separate
from local desktop use and per-plugin external service authentication. It is not an implemented
account service or a requirement to sign in before using the local workbench.

Keep the Electron renderer sandboxed and context-isolated with Node integration and webview disabled.
The preload exposes version/platform metadata, eight fixed plugin-management operations, four
fixed activation-bound ordinary-data operations for opt-in API 2, and the
owner-authorized minimize/maximize/close host chrome actions. All operations are validated
in Main against the owning window and its main frame. Installation selects a directory or signed file
in a native dialog; no path or generic channel argument is exposed. The first-party signed-file
pilot authenticates its immutable snapshot using scoped owner-authorized Ed25519 roots before
native confirmation and persistence. See [package trust and recovery](../architecture/plugin-package.md).
Developer Mode gates external-folder load/link/reload in Main. Accepted code generations are
separate from durable installation/data identity; reload and pause revoke stale channels. Original
paths stay local to Main preferences, while only bounded accepted snapshots reach the protocol.
Window actions accept no arguments and
resolve only the sender's own native window. Plugin Workers have no preload/DOM bridge.
See [API 2 data boundaries](../architecture/plugin-data.md) for installation identity, revocation,
limits, retention and recovery. Namespace checks do not isolate hostile shared-origin Workers.
No generic IPC executor, process runner,
filesystem method, remote URL opener or arbitrary script evaluator is allowed in this foundation.
Production loads a bounded custom protocol with a restrictive script CSP and blocks remote requests.
Development allows only the configured loopback server plus script imports from the managed local
protocol. Keep script-src 'self' in production and worker-src 'self'; no eval/blob script allowance.
Deny browser permissions and new windows.

Validate input size, version, shape, identifiers, numbers and geometric invariants before use.
Do not evaluate imported text, install code from a layout file or render raw HTML. A failed read
must not erase a draft. User-initiated saving is separate from initial loading.

Keep secrets and machine/private paths out of source, logs, prompts and diagnostics. Ignore patterns
are not encryption. Preserve least privilege and explicit approvals. Never use a successful check
to infer permission to push, publish or close an Issue.

Before executing third-party plugins, the separate task must define ownership, caller identity,
capability broker, limits, per-plugin storage/session boundaries, inter-plugin APIs, surface scripting
risk and how native process permissions interact with vault isolation. Those controls are not
implemented by this starter. Do not claim QuickJS, isolated worlds or safeStorage solve every boundary.
