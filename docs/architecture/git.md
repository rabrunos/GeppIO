# Read-only Git pilot — alpha.43 / Issue #50

The bundled `host:git-changes` widget is explicit, single-view and eligible in Main/Sidebar.
Editor mode adds a second activity to the existing rail and measured Sidebar viewport. No
placement, composition, workspace, document or plugin state is created by selecting Git.
`GitSession` is one memory-only renderer owner; `GitStore` is one Main owner bound to the
existing `DirectoryStore` grant. Two fixed app-only calls accept opaque root/change UUIDs.
Main checks the owning WebContents, main frame, exact URL, shape and root identity.
Selection/release/navigation/destruction abort native work and invalidate results. Nothing
is added to the public plugin SDK or Worker facade.

## Native execution and nonmutation

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
