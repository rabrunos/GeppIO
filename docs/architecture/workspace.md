# Local single-root Workspace — alpha.47 / Issue #54

## Identity and transitions

`WorkspaceOwner` coordinates the existing Main-owned `DirectoryStore`, independent
`DocumentStore` grants and `GitStore`. There is one selected root per window. Native folder
selection creates/replaces that grant; cancel leaves it unchanged. Root switch/close revoke
old Explorer nodes, Git snapshots and action IDs, while retaining every open file draft and
the existing PTY. No implicit Save, Discard, `cd`, process restart or project command occurs.
An unavailable unchanged root uses home for a newly started terminal, with visible feedback.
A root generation change during asynchronous Start refuses that start before native spawn.
The displayed terminal directory describes startup, not subsequent user-issued `cd` commands.

The existing context bar displays the actual root and current Git state, and opens a top-layer
project menu. Illustrative workbench names remain layout metadata; renaming a layout cannot
rename a native folder. The direct Editor/Explorer are revealed without creating widget placements
or rewriting saved layout bytes. Project-relative documents show `No projeto`; other held grants
show `Arquivo avulso`. Opening an outside file never implicitly adds it to the selected root.
The explicit standalone picker closes project context only after successful file authorization.
Picker cancellation leaves the project and all drafts intact. Tab close and native window close
retain the existing per-file/all-drafts Save/Discard/Cancel protections.

## Remembered metadata and explicit restoration

The local `Lembrar projeto e abas salvas` preference defaults on. Its UI explains that only
project/tab metadata is stored. Disable it or choose `Esquecer recuperação local` to remove
remembered identity/view data without closing files, killing the terminal or touching the project.
App-owned `workspace-session.v1.json` is limited to 512 KiB: version, preference, Main-only
absolute root/ancestor identity, at most eight validated relative file names, confirmed SHA-256
fingerprints, active index, dirty flags, language and bounded primary selection/scroll coordinates.
The optional tab arrangement records two bounded lists of file indices, their selected indices,
the focused group and pinned indices. Older records without this field restore one group.
Explicit restoration maps file indices to freshly authorized documents. If a file is unavailable,
its prior metadata remains eligible for a later restoration. If keeping both available and missing
files exceeds eight entries, the previous record stays on disk and the close dialog reports the
incomplete metadata save. Disabling or forgetting recovery removes the retained missing entries.
Source, drafts, undo stacks, opaque grants, terminal output/processes and credentials are absent.
Absolute paths are private local plaintext metadata, not a credential vault or encrypted storage.
Only root basename/tab counts and ordinary bounded document DTOs reach the renderer.

First launch has no project. Restart offers the remembered project instead of opening it
automatically. A native dialog shows the exact path and requests permission again. Main validates
the complete unchanged root/ancestor chain before and after consent, then traverses through the
existing bounded Explorer checks and creates fresh file/root IDs and revisions. Old session IDs
cannot save or stage. An existing selected root or explicit open file prevents recovery from
replacing current work. No recovery path is accepted from the renderer or a Worker.

Changed bytes require a native `Abrir atual` / `Ignorar` / `Cancelar` decision (Cancel by default).
Current opens the validated disk version without writing it; selection/language are restored only
for unchanged clean files. Cancel revokes all newly created restoration grants and preserves the
remembered history. Missing/unsupported individual files are skipped with visible counts. A moved,
replaced or unavailable root is refused; the user can explicitly select its new location. Recovery
never searches the disk, follows links or broadens an existing grant. Native file/grant budgets remain.

**Unsaved source remains memory-only.** Normal project transitions retain it; native window close
protects all tabs. The dirty marker in metadata is a warning, not a durable draft copy. After a crash
only saved disk content can return, with an explicit warning. There is no complete unsaved-draft,
undo, multi-cursor, process or task recovery. In-session Monaco views/undo remain richer than the
bounded primary selection/scroll metadata restored across restart.

## Persistence and native boundary

Six fixed exact-owner/main-frame/URL operations (`read`, `restore`, `standalone`, `configure`,
`forget`, `remember`) join the existing broker. Requests contain only boolean preference or bounded
ID/revision/view metadata, never paths, source, cwd, shell arguments or generic FS commands.
Main validates a complete current document set before remembering it. Updates coalesce with one
renderer and one Main request in flight, and native close flushes even an empty project tab registry.
Rootless startup does not erase offered history. Standalone files are excluded from project recovery.
Project roots containing the app profile are refused to preserve the no-project-state-write rule.

Reads are bounded descriptor reads with identity/time/size checks. Fixed app-owned regular
single-link metadata and its ancestors are checked before/after IO. One exclusive fixed staging
slot bounds abandoned recovery files; write/sync/close precede same-directory rename and exact
readback. Corruption, future schemas, external changes, links and failed IO preserve the existing
file and show an error. Explicit Forget can reset an oversized ordinary file using stat-only
witnesses; it never reads unbounded bytes or follows linked metadata. Stale-frame/root queued
writes are canceled. No app state is written into an authorized project.

This remains path-based Node IO with TOCTOU exposure to same-user native processes. Flush/rename
is not verified power-loss durability, a cross-process transaction, encryption or a backup.
Multiple independently launched instances sharing a profile have no coordinated recovery writer;
failures are reported rather than claiming cross-window consistency. Native window routing remains
separate work. Windows x64 is the tested application platform; Linux and unusual/remote storage
are not certified. Existing document replacement ACL/ADS/metadata limits still apply.

## Issue #37 journeys and deferred scope

| Journey | Bounded behavior delivered here |
| --- | --- |
| Normal launch, app closed | Offer last project; empty first use; explicit native consent and unavailable-root feedback |
| Manual standalone switch | Native picker, direct Editor, preserve held drafts and live PTY, close project after successful authorization |
| Deliberate second launch | Deferred: no new multi-window/process routing promise |
| File while project active | Internal document tab; independent outside-file grant, no implicit project expansion |
| Direct standalone file | In-app picker reveals direct Editor without widget setup or OS fullscreen; OS association/CLI delivery deferred |
| Explicit requested file precedence | An already opened file blocks restoration; startup/OS file request routing remains deferred |

No multi-root, watcher, project task runner, LSP, cloud/account/backend, database, public plugin
capability or library was added. Existing installed Workers and saved host compositions are
independent. Cold launch timing in smoke is diagnostic only, not a numeric performance guarantee.

See [documents](documents.md), [Explorer](explorer.md), [Git](git.md), [Terminal](terminal.md)
and [validation](../development/testing.md). Owner physical picker/DPI/visual acceptance remains separate.
