# Essential Files & Editor — alpha.37

Issue #45 authorizes one real selected file, not a complete IDE. The essential official module
comprises `shared/files-editor.ts` (host registration) and renderer `files-editor/` (session/UI).
The Core owns `main/documents.ts` and `main/document-bridge.ts`. Final essential-plugin packaging
is provisional: this bundled module is not installable/uninstallable and has no Worker or manifest.
Public API 1/2 is unchanged.

## Ownership and presentation

`DocumentStore` owns the absolute path, file/ancestor identities, exact confirmed bytes and opaque
UUID/revision. Only bounded text, basename, BOM flag, ID and revision reach the renderer.
`EditorSession` owns one editable buffer and dirty/busy/error state outside layout/plugin storage.
Main accepts a frozen draft only for an explicit operation, not another independently editable copy.
Both adapters render the same `FileEditor`, only one at a time; selection/scroll and draft survive.
The textarea's native undo history belongs to its mounted surface and resets on presentation change;
the shared draft, confirmed bytes and document identity do not reset.
Editor covers Main's presentation while the workbench, Sidebar/Bottom and Workers remain mounted.
Switching modes writes no layout bytes and is blocked during layout edits/gestures. Mode is
session-only. The Main-only single-view widget is catalogued but never automatically inserted.

## Native boundary

Four fixed calls (`open`, `save`, `release`, `close`) and one close-request subscription exist only
in app preload. No renderer path/channel/directory argument or Worker facade exists. Main checks
exact WebContents/main-frame/app URL, argument count, fields, types and bounds. Native selection
authorizes one ordinary regular file. Replacement/release/navigation/renderer loss/destruction
revoke handles and queued guards. Calls are serialized; closing cannot race an accepted operation.

The cap is 1,048,576 bytes including BOM. Fatal UTF-8 decoding and control-character rejection
refuse unsupported/binary inputs regardless of extension. Empty and ordinary TXT/JS/TS/JSON/other
UTF-8 files work. Unchanged spans preserve exact CRLF/LF/CR bytes; new lines use the first existing
convention, otherwise LF. Textarea supplies selection, native undo/redo, clipboard and Ctrl+S.
No text is executed, parsed as HTML, sent to plugins or logged.

Bounded descriptor reads check before/after identity/size/time/mode. Save compares full confirmed
bytes and file/ancestor identities, detecting same-size edits and identical-byte replacements.
Links/junction ancestors, multiple hardlinks, special files, Windows UNC/device/alternate-stream
paths and read-only writes are refused. OS errors map to fixed bounded messages without paths.

## Save integrity and Windows limitations

The original is never truncated. A random exclusive sibling temporary receives complete new bytes,
is flushed and closed; identity/content are checked again immediately before same-directory rename.
Validation/staging/rename failure retains the draft without deliberately deleting original bytes.
Cleanup removes only this operation's new temporary. No backup is created or automatically deleted.
A failure after replacement but before acknowledgment is unconfirmed: retain the draft and inspect/
reopen before retrying. A process failure can leave a temporary; no automatic recovery cleanup exists.

**Use ordinary local text files in a user-private folder.** This is a disclosed usage restriction,
not technical ACL detection. On Windows, replacement uses the temporary's directory-inherited ACL;
custom file ACLs, alternate streams, special metadata and former file identity are not preserved.
The UI states this beside the editor. Mode bits do not preserve Windows DACLs. Files needing those
guarantees are outside this pilot. No library/native helper is adopted to imply otherwise.

TOCTOU remains between validation and rename; a submitted syscall cannot be recalled by later
revocation. This is not protection against hostile same-user native processes. Temporary flush is
not complete directory/OS crash durability. Remote/cloud-synchronized storage is not certified.
Unsaved buffers are memory-only, with no crash recovery or automatic session restoration.

Native/app close both request the current draft with a one-use ticket, then Main presents
Save/Discard/Cancel. Cancel/failed Save keeps the app and draft. Opening another file uses the same
decision after candidate validation; picker cancellation changes nothing. Conflict recovery is
explicit: copy the draft, reopen and decide what to retain. No force-save or merge tool exists.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Node 24 filesystem](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Windows MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw),
[ReplaceFile metadata semantics](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
These platform references do not replace application tests or owner acceptance.

## Deferred

Explorer/project roots, tabs/splits, search, terminal/PTY, Git, LSP/debug/build, OS associations/CLI
routing, second windows, automatic restoration, crash recovery, metadata-preserving native writes,
public rich UI/grants, marketplace/distribution and layout portability remain separate scopes.
