# Selected security baseline

Issue #55 separates [read-only Git worktree compatibility](../architecture/git.md) from the
unchanged index mutation gate. Installed Git supplies ignore semantics in bounded immediate-child
batches; ignored untracked trees are pruned, tracked ancestors remain validated, and rules and
directory witnesses bracket status. Strict metadata/configuration isolation and alpha.47's index
timestamp fix remain. Unsafe visible redirects, linked rules and special-index writes still fail
closed. No new IPC or Worker authority is introduced; same-user path TOCTOU remains.

Issue #54 adds the [single-root Workspace coordinator](../architecture/workspace.md), reusing
native directory/document ownership. Six exact-window/frame/URL calls offer explicit native
reauthorization and fresh grants after restart. Bounded app-owned metadata stores Main-only
paths and clean view/fingerprint data, never draft source or old grant IDs. Corruption/external
changes fail closed until explicit Forget. New-terminal cwd derives only from the validated
Main root, with generation checks immediately before spawn; existing PTYs remain independent.
No Worker capability, renderer path/cwd argument or project startup command is added. Same-user
TOCTOU, plaintext local path metadata, no durable unsaved source recovery and unverified
power-loss/cross-instance durability remain disclosed limitations.

Issue #51 adds two explicit per-file index operations to the [Git boundary](../architecture/git.md).
Read-only snapshots remain isolated. The separate write path uses a Main-generated one-file
binary patch, Git's native cached-apply index lock and exact blob preimage check, strict ordinary
index/object validation, saved-file/metadata witnesses and conservative uncertain outcomes.
Native working files/refs/config are never write targets; no provider or plugin capability is added.
Residual same-user path/HEAD races are documented, not claimed as whole-index/HEAD atomic CAS.

Issue #50 adds the first-party [read-only Git boundary](../architecture/git.md): exact Explorer
root grant, two fixed caller-bound operations and a disposable bounded metadata copy. Installed
Git builtins never load the original executable configuration or write the selected repository.
Global settings are ignored; unsupported roots/storage/config fail closed. Separate read-only
Monaco comparison models never replace the editable draft. Existing native TOCTOU and trusted
same-user limitations remain; no Worker capability or generalized executor is introduced.

Issue #49 adds the app-owned [Monaco ESM/model/asset boundary](../architecture/monaco.md),
including the owner's explicit known-advisory exception for pinned Monaco 0.57.0/DOMPurify 3.4.15.
Local bundled language Workers receive no native bridge or private filesystem URI. Production
CSP remains unchanged; only local `.ttf` font MIME support is added. This is not a clean audit
or an untrusted editor/plugin platform. Future patched stable upgrades require scoped validation.

Issue #47 adds the first-party [Terminal/ConPTY boundary](../architecture/terminal.md): five fixed
window/main-frame-bound calls, generation IDs, bounded input/output/dimensions and native cleanup.
Commands run with the real OS user's privileges. No Worker process grant or generalized executor
is exposed; existing sandbox/context isolation/CSP/navigation controls remain. This local trusted
pilot is not hostile-plugin/process isolation. [Status Bar](../architecture/status-bar.md) consumes
existing document/session state and never interprets arbitrary output as project diagnostics.

Issue #46 adds four fixed app-only [Explorer navigation operations](../architecture/explorer.md) for one
native-selected folder. Main holds bounded revocable node/root grants, checks full ancestor
identities and canonical containment, refuses ordinary links/junctions and special paths, and
opens through the existing document service. There is no renderer path input or Worker grant.
Path-based IO retains TOCTOU; arbitrary Windows reparse-tag/special-storage protection is unverified.

Alpha.65 adds three exact-caller Explorer write operations. Main derives the parent and
destination from existing grants and one validated basename, checks live document and recovery
bindings, excludes the app profile and refuses .git and special names along the path. File
and folder creation are exclusive. Same-parent file rename uses the system Windows PowerShell
with a fixed noninteractive command, isolated module lookup and two-argument .NET File.Move.
A possible native write with a lost acknowledgment or failed postcondition yields an
uncertain outcome. Search, Quick Open and Git results expire after confirmed or uncertain
mutations. The same-user path race still applies.

The current app is local and has no account, remote content, database or
secret vault. Issue #21 adds only explicitly trusted local development plugins. Offline does not mean trusted input. JSON layout import, saved layout bytes,
asset URLs and build dependencies are relevant inputs. See the [control map](../architecture/security.md).

Issue #53 extends this boundary to eight independent native grants and one fixed ID-only activate
operation. Complete unique ID/revision/draft sets are validated before close decisions or writes;
partial saves acknowledge revisions without dropping later canceled/failed drafts. Explorer root
changes do not expand or revoke independent file grants. Relative display associations never
expose native paths; full paths remain Main-only, including native confirmation dialogs. Source,
retained history and model lifecycles remain bounded; no generic path or Worker capability is added.

Issue #45 introduced four fixed app-owned document operations and a close-request event, limited to one
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
The first-party Quick Open bridge accepts four fixed operations on opaque IDs,
bound to the owning window, main frame, exact URL and current root. Its
cancelable inventory stores at most 1 MiB of names and identity metadata.
Only explicit selection may read a document through the existing grant checks.
The two portable-composition picker operations require the primary window, current main
frame and exact application URL. Main obtains the filename from its native dialog and
revalidates the owner after asynchronous boundaries. Export validates the recipe before
selection and uses exclusive creation. An error after creation leaves the selected output
for inspection and reports uncertainty. The usual same-user filesystem race limitation applies.
Do not evaluate imported text, install code from a layout file or render raw HTML. A failed read
must not erase a draft. User-initiated saving is separate from initial loading.

Keep secrets and machine/private paths out of source, logs, prompts and diagnostics. Ignore patterns
are not encryption. Preserve least privilege and explicit approvals. Never use a successful check
to infer permission to push, publish or close an Issue.

Before executing third-party plugins, the separate task must define ownership, caller identity,
capability broker, limits, per-plugin storage/session boundaries, inter-plugin APIs, surface scripting
risk and how native process permissions interact with vault isolation. Those controls are not
implemented by this starter. Do not claim QuickJS, isolated worlds or safeStorage solve every boundary.
