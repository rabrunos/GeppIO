# Essential Files & Editor Explorer — alpha.39 / Issue #46

The bundled first-party module in `shared/files-editor.ts` owns editor and Explorer.
`DirectoryStore` in Main owns one memory-only navigation grant. `ExplorerSession` owns shared
renderer navigation, metadata, expansion, focus, scroll and confirmed active-file state.
Both presentations render the same `Explorer`. No manifest, Worker, dependency or public SDK
change is involved. Packaging and future third-party activity contributions remain provisional.
A selected folder is a navigation scope, not a Workspace or automatic session restore.

## Presentation and storage

Widgets mode retains Home, custom bars and catalog. Explicit Main/Sidebar placement uses ordinary
host constraints (180 × 160 minimum, 300 × 400 default), Sidebar width adaptation and Edit-only
individual gestures. Nothing is inserted automatically. The Explorer has a single widget view,
independent of the Main-only editor widget.

Editor mode has one actual activity, Explorer. Its panel fills the existing Sidebar content area
and is not a saved placement. The active button toggles the Sidebar. Original rail, width constraints,
reveal/peek and collapse remain in use. Editor Sidebar size/visibility are session-only and separate
from confirmed Widgets chrome. Explicit Bottom changes retain existing host behavior. Mode changes
write no bar/layout bytes. Sidebar widget DOM/Workers remain mounted but hidden/inert in Editor.
Main's alpha.38 `regionViewport` stays authoritative.

The shared tree restores scroll/focus on presentation remount. Roving tree focus supports Up/Down,
Left/Right, Home/End and Enter/Space; accessible levels/positions and active-document selection are
explicit. Names truncate with native title inspection. Errors are visible/retryable. Refresh revisits
only expanded directories and prunes detached cached metadata. Unopened directories are never scanned.

## Native authorization

App preload exposes four fixed `explorer` calls: zero-argument `select`, opaque-root/node `list`,
opaque-root/node plus validated document draft `open`, and opaque-root `release`. The per-window
document broker validates exact WebContents/main-frame/app URL, argument count/shape/UUIDs, and
serializes directory operations with document operations and native close. Only Main receives the
picker path. Cancellation/failed selection preserves the previous grant. Replacement, release,
navigation, renderer loss and destruction revoke references and queued guards. Paths never appear
in metadata, failures, logs or Worker messages.

Every accessed target and lexical ancestor through the volume root is checked with `lstat`/`realpath`.
Device/inode/birthtime chains detect replaced roots, ancestors and targets. IDs belong to this
per-window store; unchanged refreshed identities retain IDs. Containment uses `relative` rather than
only a string prefix. Ordinary symlinks/junctions, hardlinked files, special files, UNC/device/ADS
paths, DOS reserved names, trailing dot/space and 8.3-style aliases are refused. Unsupported links
may appear as disabled metadata rows but cannot be traversed/opened. Noncanonical ancestors above
the root are also refused. An unsupported name refuses the whole listing rather than hiding entries.

Budgets: 512 immediate entries, 32 levels, 255 UTF-16 units per name, 256 KiB serialized children,
8,192 units per native path and 4,096 retained metadata nodes including root and blocked entries.
These conservative pilot limits bound UI/native work, not a performance SLA. `opendir` uses
32-entry buffers, stops at the first excess entry and closes on error. Failed listings never partially
commit grant metadata. IO is asynchronous. No watchers, background scans or directory writes exist.

`open` delegates to `DocumentStore.select` with a final grant-identity callback after the dirty
Save/Discard/Cancel decision and byte revalidation. `EditorSession` preserves the old document/draft
on refusal or cancellation. Active file changes only on confirmed open. Folder replacement/release
leaves an open document intact. BOM/EOL, 1 MiB UTF-8, conflict, save and close controls retain the
[document contract](documents.md). Atomic Save changes file identity: refresh before opening an old
tree reference again. Refresh never silently reopens or discards a document.

## Limits and remaining risks

Path-based Node IO is not handle-relative Windows traversal. Hostile same-user native processes
can race validation; a submitted syscall cannot be recalled. Pre/post checks reduce replacement
errors without eliminating TOCTOU. `lstat` and canonical equality reject ordinary redirecting
links/junctions; this is not a native allowlist for every Windows reparse tag. Only ordinary local
files/private folders are supported. Cloud placeholders, custom reparse storage, network, device
and special storage are unsupported/unverified. Existing Windows save ACL/ADS/metadata and crash
limitations remain. This is not an untrusted-plugin isolation platform.

No create/rename/move/copy/delete, filesystem drag/drop, multiple roots, project management,
restore, watchers, tabs/splits, Git, search, terminal, highlighting, LSP or public panel SDK.

`tests/explorer.test.ts` and `pnpm test:explorer` use disposable directories and the actual registered
Electron bridge. Native dialog responses are controlled by tests, not mocked React actions. This
proves handler integration, not physical picker/mouse acceptance. Platform references:
[Node filesystem](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-main),
[sender validation](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).
