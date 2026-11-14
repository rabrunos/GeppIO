# Selected security baseline

Issue #47 adds the first-party [Terminal/ConPTY boundary](../architecture/terminal.md): five fixed
window/main-frame-bound calls, generation IDs, bounded input/output/dimensions and native cleanup.
Commands run with the real OS user's privileges. No Worker process grant or generalized executor
is exposed; existing sandbox/context isolation/CSP/navigation controls remain. This local trusted
pilot is not hostile-plugin/process isolation. [Status Bar](../architecture/status-bar.md) consumes
existing document/session state and never interprets arbitrary output as project diagnostics.

Issue #46 adds four fixed app-only [Explorer operations](../architecture/explorer.md) for one
native-selected folder. Main holds bounded revocable node/root grants, checks full ancestor
identities and canonical containment, refuses ordinary links/junctions and special paths, and
opens through the existing document service. There is no renderer path input or Worker grant.
Path-based IO retains TOCTOU; arbitrary Windows reparse-tag/special-storage protection is unverified.

The current app is local and has no account, remote content, database or
secret vault. Issue #21 adds only explicitly trusted local development plugins. Offline does not mean trusted input. JSON layout import, saved layout bytes,
asset URLs and build dependencies are relevant inputs. See the [control map](../architecture/security.md).

Issue #45 adds four fixed app-owned document operations and a close-request event, limited to one
native-selected UTF-8 file (1 MiB), exact owner/main frame and revocable opaque handle. No renderer
path or plugin file grant exists. Follow the [document boundary](../architecture/documents.md) for
byte/identity checks, failure retention and explicit Windows ACL/metadata/crash limitations.

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
No generic IPC executor or plugin process runner,
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
