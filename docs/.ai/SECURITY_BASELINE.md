# Selected security baseline

The current app is local and has no account, remote content, terminal, database or
secret vault. Issue #21 adds only explicitly trusted local development plugins. Offline does not mean trusted input. JSON layout import, saved layout bytes,
asset URLs and build dependencies are relevant inputs. See the [control map](../architecture/security.md).

Keep the Electron renderer sandboxed and context-isolated with Node integration and webview disabled.
The preload exposes version/platform metadata and four fixed plugin-management operations, validated
in Main against the owning window and its main frame. Installation selects a directory in a native
dialog; no path or generic channel argument is exposed. Plugin Workers have no preload/DOM bridge.
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
