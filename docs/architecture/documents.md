# Essential Files & Editor — alpha.46–47

Alpha.47 coordinates these independent grants through a [single-root Workspace](workspace.md).
Project transitions retain drafts, while clean project tabs and bounded primary views can be
offered after restart with fresh native authorization. Unsaved source/undo remains memory-only.

## Multiple documents — alpha.46 / Issue #53

DocumentStore now retains up to eight independent native file grants, each with its own
opaque ID/revision, validated file/ancestor identity and confirmed bytes. EditorSession
retains one exact draft per grant, and one active-document facade for existing Status Bar,
Explorer and Git subscribers. Opening another file never saves or replaces a held draft;
opening the same canonical path activates its existing grant, including a conflicted draft.
Close and reopen explicitly to reread a changed target. No force-save or merge is implied.

Compact internal tabs select by click or ArrowLeft/ArrowRight/Home/End; Delete or the close
button requests native Save/Discard/Cancel. Active close selects the preceding tab, otherwise
the next tab. Closing an inactive tab preserves the current model. Every open tab has its
own stable Monaco model, language override, undo/redo and saved multi-selection/scroll view.
Switching Editor/Widgets reattaches the same editor DOM and leaves all models alive. Only
confirmed close disposes the corresponding model and subscriptions; final teardown releases all.

The source cap remains 1 MiB including BOM per file, eight files and 8 MiB aggregate exact
source. Retained edit text/EOL metadata has a conservative 96 MiB session budget: 64 MiB
reserved in advance for initial EOL patterns and one corrective refusal recovery per slot,
plus a 32 MiB accepted edit/EOL ledger, with at most 20,000 accepted versions per model.
A corrective recovery or exhausted ledger makes that model read-only for new typing; retained
undo/redo, copying, saving and explicit close remain available. Feedback explains close/reopen
to continue. No silent history/model eviction occurs. This bounds retained text bookkeeping,
not total Electron/Monaco heap, transient clipboard input or language-service overhead.

Native window close receives the complete unique ID/revision/draft set under a one-use ticket.
Main validates every draft and its byte cap before any dialog/write, then resolves dirty files
sequentially. Cancel or failed/conflicted Save leaves every grant and draft open. Earlier
explicitly saved files remain saved and their acknowledged revisions are returned, so a later
Cancel does not incorrectly mark them dirty. Draft text stays renderer-owned until saved.

Explorer root select/release preserves independent file grants and drafts. A safe Main-derived
root-relative association lets Explorer follow the active tab through lazy ancestors; files
outside the current root clear the highlight. Root failure clears stale tree/Git state while
retaining file drafts. Renderer DTOs contain bounded basenames/parent labels or validated
relative names, never absolute paths. Only the native unsaved-changes dialog shows the full
path for disambiguation. The original alpha.46 batch did not add Workspace persistence or cwd;
the alpha.47 coordinator adds them without changing independent file authority.

## Monaco integration — alpha.42 / Issue #49

The official FileEditor now attaches a session-owned Monaco presentation from
`renderer/src/files-editor/monaco.ts`. It uses public ESM editor/model/worker APIs only.
EditorSession remains the single owner of exact editable drafts and functional document identities;
DocumentStore still owns native paths, revisions, confirmed bytes and file authority.
The LF Monaco model is an editing projection, not a second file service. It uses an opaque
`inmemory://geppio/<document UUID>` URI without a native path or basename.

One editor instance and its DOM are reattached between the direct Main and explicit widget
containers, like the existing Terminal presentation. No model/editor is created per mode.
Monaco owns its undo/redo stack, multi-selections, focus and scroll state during detachment.
The existing shared host viewport remains authoritative; ResizeObserver lays out Monaco inside
its actual container. Themes select stock `vs`/`vs-dark`. Monaco-specific code stays in this
small adapter; native document service and public plugin SDK do not import Monaco.

On confirmed document release the adapter disposes only that model and its format history.
Inactive open models remain alive. Save keeps the same model,
URI and undo history while EditorSession receives the confirmed revision. Canceled/failed
operations retain the draft and model. Final app teardown disposes observers, subscriptions,
editor/model and locally created Workers; React StrictMode effect replay does not dispose an
owner reconnected in the same turn. Language Workers are reused across mode changes and may
remain idle while no file is open until Monaco's worker lifecycle or app teardown ends them.

`shared/document-edits.ts` applies simultaneous LF-model change intervals to the exact draft,
preserving original CRLF/LF/CR bytes outside changed intervals. Inserted newlines use the first
existing draft convention, falling back to the confirmed file convention through native delete/insert
replacement events with a temporarily empty draft, otherwise LF. Monaco undo-version metadata retains newline-token sequences
so undo/redo can restore deleted mixed EOLs without retaining a second editable text buffer.
EditorSession validates every exact proposal against Unicode and the 1 MiB cap including BOM.
Rejected model edits are undone using public APIs and the accepted draft is reconciled if
Monaco grouped the refusal with preceding typing. Unchanged displayed content restores exact
confirmed bytes. No view/language/mode operation saves or normalizes the file on disk.

Normal stock features include text/JSON/JS/TS/HTML/CSS/Markdown modes, line numbers, selections,
multiple cursors, undo/redo, find/replace, indentation and folding. No project-wide LSP,
debugger, extension host or additional native capability is implied. The internal host DOM has
a read-only editor association for real built-runtime inspection, not a window/preload/plugin SDK.
See [Monaco dependency/asset boundary](monaco.md) for the explicit advisory exception and upgrades.

Issue #45 introduced one real selected file; Issue #53 extends it to bounded tabs. The essential official module
comprises `shared/files-editor.ts` (host registration) and renderer `files-editor/` (session/UI).
The Core owns `main/documents.ts` and `main/document-bridge.ts`. Final essential-plugin packaging
is provisional: this bundled module is not installable/uninstallable and has no Worker or manifest.
Public API 1/2 is unchanged.

## Ownership and presentation

The [Status Bar](status-bar.md) subscribes to this same EditorSession for actual dirty/busy/
error, BOM/EOL and Monaco cursor state. Its language override is session-only and changes the
model language without editing document bytes. [Terminal](terminal.md) has a separate functional
owner and survives mode changes alongside the existing unsaved draft.

`DocumentStore` owns the absolute path, file/ancestor identities, exact confirmed bytes and opaque
UUID/revision per file. Only bounded text, display labels, relative association, BOM flag, ID and revision reach the renderer.
`EditorSession` owns per-file editable buffers and dirty/error state outside layout/plugin storage.
Main accepts a frozen draft only for an explicit operation, not another independently editable copy.
Both adapters render the same `FileEditor`, only one at a time, attaching the same Monaco DOM;
selection/scroll, undo/redo, shared draft, confirmed bytes and document identity survive.
Editor covers Main's usable presentation while the workbench, Sidebar/Bottom and Workers remain mounted.
Since alpha.38, `regionViewport` in `freeform/frame-layout.ts` supplies the same measured Main
rectangle to direct Editor, maximized widget projection and the maximize backdrop. The direct
container is a work-area sibling of Main in those shared coordinates, with the ordinary host card
border, radius and clipping. Host padding/borders (including the unpadded expanded right edge)
remain authoritative; content scrolling and Docked reservations do not shrink this rectangle.
This presentation does not invoke maximize or create a placement. Its internal content can later
be subdivided without changing region geometry ownership; no split view is implemented.
Switching modes writes no layout bytes and is blocked during layout edits/gestures. Mode is
session-only. The Main-only single-view widget is catalogued but never automatically inserted.

## Native boundary

Five fixed calls (`open`, `activate`, `save`, `release`, `close`) and one close-request subscription exist only
in app preload. No renderer path/channel/directory argument or Worker facade exists. Main checks
exact WebContents/main-frame/app URL, argument count, fields, types and bounds. Native selection
authorizes one ordinary regular file. Release revokes that grant; navigation/renderer loss/destruction
revoke all handles and queued guards. Calls are serialized; closing cannot race an accepted operation.

The cap is 1,048,576 bytes including BOM. Fatal UTF-8 decoding and control-character rejection
refuse unsupported/binary inputs regardless of extension. Empty and ordinary TXT/JS/TS/JSON/other
UTF-8 files work. Unchanged spans preserve exact CRLF/LF/CR bytes; new lines use the first existing
convention, otherwise LF, with the empty-replacement fallback described above. Monaco supplies
selection, undo/redo and clipboard; the existing application shortcut retains explicit Ctrl+S.
No text is executed, parsed as HTML, sent to plugins or logged.

Bounded descriptor reads check before/after identity/size/time/mode. Save compares full confirmed
bytes and file/ancestor identities, detecting same-size edits and identical-byte replacements.
Links/junction ancestors, multiple hardlinks, special files, Windows UNC/device/alternate-stream
paths and read-only writes are refused. OS errors map to fixed bounded messages without paths.
Selection must already use a canonical path: a native dialog returning an 8.3 short-path alias
is refused too. Select the long canonical path explicitly; alias compatibility is not implemented.

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
Unsaved buffers are memory-only, with no source crash recovery. Alpha.47's explicit clean-session
restoration never writes a remembered draft over a disk file.

Native/app close request all drafts with a one-use ticket, then Main presents Save/Discard/Cancel
for each dirty target. Cancel/failed Save keeps the app and drafts. Opening another file never
prompts to save the existing tab; picker cancellation changes nothing. Conflict recovery is
explicit: copy the draft, close its tab and reopen. No force-save or merge tool exists.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[Node 24 filesystem](https://nodejs.org/docs/latest-v24.x/api/fs.html),
[Windows MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw),
[ReplaceFile metadata semantics](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
These platform references do not replace application tests or owner acceptance.

## Deferred

Alpha.39 adds the [bounded first-party Explorer](explorer.md) through this same store/session.
Its directory grant is independent from the open document and adds no Worker authority.

Splits, search, LSP/debug/build, OS associations/CLI
routing, second windows, automatic unsaved restoration, crash recovery, metadata-preserving native writes,
public rich UI/grants, marketplace/distribution and layout portability remain separate scopes.
