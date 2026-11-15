# First-party Git pilot — alpha.43/44 / Issues #50/51

The bundled `host:git-changes` widget is explicit, single-view and eligible in Main/Sidebar.
Editor mode adds a second activity to the existing rail and measured Sidebar viewport. No
placement, composition, workspace, document or plugin state is created by selecting Git.
`GitSession` is one memory-only renderer owner; `GitStore` is one Main owner bound to the
existing `DirectoryStore` grant. Two fixed inspection and two explicit index calls accept opaque root/change UUIDs.
Main checks the owning WebContents, main frame, exact URL, shape and root identity.
Selection/release/navigation/destruction abort native work and invalidate results. Nothing
is added to the public plugin SDK or Worker facade.

## Read-only inspections: execution and nonmutation

The Windows pilot resolves only the canonical machine installation `Git/cmd/git.exe` under
Program Files, never PATH, a selected folder or a renderer-supplied executable. The installation
and its native ancestors must be ordinary canonical paths; installed Git launcher hardlinks
are allowed only here, never for repository data. Git 2.40+ is required. The OS-installed
executable remains trusted native code, not a bundled or independently sandboxed dependency.

Only an exact selected normal top-level `.git` directory is supported. Bare/nested roots,
linked worktrees/submodules, shallow/alternate object stores, replace directories, grafts,
extensions, filters, external attributes/excludes paths and unsupported names/storage fail
closed. The bounded working tree is checked before inspection, refusing links/hardlinks and
nested repositories. The metadata copier validates canonical ancestor/file identities and
bounded descriptor reads, refuses object redirects during copying and never follows links.

Each request creates a disposable private metadata directory under the OS temporary root.
Host temporary aliases are canonicalized; a temporary root inside the selected working tree
is refused before creating any scratch file, preserving the no-working-tree-write contract.
Only HEAD/index/refs/packed-refs, loose objects, pack/idx pairs and bounded info/exclude/attributes data are copied;
optional object accelerators (multi-pack-index, commit-graph, bitmap and promisor data) are omitted;
original config is copied as non-active data and parsed using `config --file --no-includes`.
Only validated local boolean filemode/ignorecase/symlinks and autocrlf/eol values are reconstructed.
All other config, includes and global/system settings are ignored. No original hooks, aliases,
fsmonitor, credentials, diff/textconv drivers, filters or network settings are activated.

Builtin operations are fixed: version, explicit config parsing, ls-files, porcelain NUL status,
ls-tree and raw cat-file blob. No shell, interactive stdin, inherited PATH/Git/Node/loader
environment or generic command IPC is used. The environment disables optional locks, system
attributes, replace objects, prompts and all network protocols. Git's git-dir is always the
disposable copy, with work-tree explicitly bound to the authorized folder. Even incidental
index/metadata updates can only affect the temporary copy. Cleanup removes that exact new
temporary; authority is revalidated after cleanup before a response is delivered.

This deliberately trades repository size and speed for a smaller execution boundary. Budgets:
15-second operation deadline checked between IO steps and passed as the remaining subprocess
timeout; 20,000 combined tree/metadata entries, depth 32, 64 MiB copied metadata, 512 KiB command
output, 512 changed files and 256 KiB per comparison side. Native filesystem syscalls/cleanup
are asynchronous but cannot be recalled at the deadline. Excesses reject the entire query,
never silently report a partial clean state. There are no watchers or background polling.

## Truthful comparisons and limits

Status preserves the porcelain index/working columns and NUL rename ordering. Conflicts and
untracked files are explicit. Ignore/attribute rules within the selected tree and info files
apply, with the safe local core options above. Global excludes/EOL settings and config includes
are intentionally absent, so status may differ from a separately configured Git client; the UI
discloses configuration isolation. Refresh is an explicit fresh snapshot. Concurrent same-user
native edits can still race path-based IO or produce an outdated snapshot; refresh after them.
This retains the Explorer's TOCTOU/reparse-tag limitations and private-local-folder restriction.

Selecting a tracked ordinary UTF-8 change compares **HEAD to saved disk bytes**, including an
empty side for an addition/deletion. Rename uses the original HEAD name. It does not compare
staged and unstaged layers separately or represent the unsaved Editor draft. Conflicted,
untracked, binary, oversized and unsupported content produce fixed path-free messages.

The public Monaco Diff Editor creates two separate read-only plaintext models and a bounded
diff computation. Closing/replacing the dialog disposes editor/models/observer; the editable
FileEditor model, undo history, selection and scroll are untouched. EOL/BOM are display
projections only. The existing Monaco/DOMPurify advisory acceptance is unchanged; this is not
a clean audit, Linux application validation, untrusted-plugin boundary or owner UX acceptance.

References: [Git status](https://git-scm.com/docs/git-status),
[Git configuration](https://git-scm.com/docs/git-config),
[Git environment](https://git-scm.com/docs/git).

## Explicit index actions — alpha.44 / Issue #51

Two additional fixed calls, `stage(rootUUID, changeUUID)` and `unstage(rootUUID, changeUUID)`,
are first-party only. No path, executable, option or provider input crosses IPC. Each explicit
UI action resolves the most recent Main snapshot; no watcher or refresh can trigger a write.
Stage uses bounded saved disk bytes with the existing isolated local core options and Git's
builtin attribute/EOL conversion. Undefined attribute filter names have no driver; any local
filter configuration is rejected, and global/system/include settings remain inactive. Hashing
uses `-C` at the exact validated root for truthful attribute resolution and writes only to the
private object copy. The active Monaco model is never passed to this service.

Main witnesses HEAD, the complete refs namespace, packed-refs, config, index and info rules,
plus the selected file's canonical identity, timestamps and digest and ancestor working
`.gitignore`/`.gitattributes` rules. It rechecks them and fresh selected porcelain status before
writing and expires IDs after an attempt. A replaced root, saved-file/index/config change or
preexisting native index.lock fails before mutation. Initial/unborn HEAD is supported: Unstage
removes only the selected initial entry, retaining the saved file.

The write gate accepts checksummed, ordered ordinary SHA-1 index v2/v3 entries with no special
flags and only the TREE cache extension. Split/sparse/v4/assume-unchanged/skip-worktree/intent-to-add,
conflicts, renames, deliberate mode changes and unsupported content/storage fail closed. Every
real object path is checked; unlike inspection's copier, writes reject accelerators, promisor
files, alternates and nonempty objects/info too. This can reject a repository after ordinary
maintenance even when read-only inspection still works. Per-side/blob size is 256 KiB; original
index blob and converted target are bounded before diff generation. Existing overall budgets apply.

Git prepares two private trees differing in one exact literal path. A private `* -diff` attribute
forces a full-OID binary patch via diff-tree, with external diff/textconv/renames disabled. A
single generated patch is required; non-binary patches are rejected except proven empty-file
creation/deletion. Existing-file unchanged modes are omitted so Git preserves the mode it reads
under lock. Explicit mode changes are unsupported. Native `apply --cached --binary --whitespace=nowarn`
then uses the private git-dir/config/hooks with only Main-validated GIT_INDEX_FILE and
GIT_OBJECT_DIRECTORY pointing to the real authorized index/objects. No real configuration/hooks
are loaded. There is no working-file, ref, configuration or remote write command.

Git takes index.lock before reading the real index, verifies the complete binary blob preimage
under that lock, preserves other entries and atomically replaces the index using its own lock
protocol. It stores needed blob objects itself. Main never rewrites/renames index bytes or deletes
an owner's lock. Postflight checks exact semantic index entries, working-file witness and fixed
metadata. A racing selected-blob change is rejected by Git; racing mode/other-entry changes are
preserved and detected postflight. This is not an atomic compare-and-swap of all index flags,
HEAD, working files or paths. Same-user native writes can still race revalidation; the inherited
private-local-folder, path-based IO and unverified reparse/special-storage limitations remain.

Any error, abort, deadline, cleanup or grant failure after the real write starts reports an
**uncertain outcome**, clears the snapshot and requires explicit Refresh. Git may have already
committed the index or stored an unused blob, and a forcibly terminated Git may leave its lock.
There is no automatic retry, rollback, lock deletion or draft save. Confirmed success refreshes
real status through the unchanged read-only path. An error during that refresh reports that the
index succeeded but the display needs refreshing. Power-loss durability is not certified.

This is offline, provider-neutral local Git. GitHub/GitLab/other hosting, remote authentication,
commits, whole-repository/hunk staging and working-file discard remain separate future scopes.
No dependency, plugin SDK grant or Monaco version is added. The Monaco/DOMPurify advisory
exception and physical owner acceptance remain separate from automated evidence.

Write references: [Git apply](https://git-scm.com/docs/git-apply),
[Git hash-object](https://git-scm.com/docs/git-hash-object),
[Git index format](https://git-scm.com/docs/index-format),
[Git for Windows native lock/preimage implementation](https://github.com/git-for-windows/git/blob/v2.53.0.windows.2/apply.c).
