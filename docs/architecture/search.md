# Project text search

GeppIO Code searches saved UTF-8 files beneath the selected Workspace. Enter or
**Buscar** starts a scan. The Core session keeps the query, options, progress and
results across panel switches. A replacement search invalidates the previous
job. Cancel retains the matches already found. An OS read already in flight can
finish before the scanner starts new work.

Main owns traversal, opaque job and match IDs, and file witnesses. Only the
owning main frame at its expected URL may start, read, cancel or open a match.
Changing or losing the root revokes the results. Scanning runs independently
of document transactions. Opening a match uses the document transaction,
rechecks its identity and content, and respects the session's eight-tab limit.
If the final document response detects a changed root after opening a file, the
independent file grant survives and the editor drops the old search range.
An existing tab keeps its model, edits and undo history. The editor selects a
range only when both its saved snapshot and displayed text match the search.

Matching uses literal single-line text, with optional case sensitivity.
The default uses Unicode simple case folding and preserves accents and source
normalization. Columns count UTF-16 units starting at one. CR, LF and CRLF each
end a line. A UTF-8 BOM precedes the searchable text.

| Budget | Maximum |
| --- | --- |
| Query | 256 UTF-16 units |
| Traversal | 32 levels, 512 non-excluded children per directory, 4,096 visited entries |
| Source reads | 1 MiB per file, 32 MiB per scan |
| Results | 1,000 matches, 1 MiB serialized match data |
| Snippet | 240 UTF-16 units |
| Response | 100 matches, 128 KiB |
| Work | One scanner per window, 30 seconds |

Search refuses roots at or beneath `.git`. Traversal excludes `.git` in
any letter case and skips directories named
`node_modules`, `vendor`, `.venv`, `venv`, `dist`, `build`, `out` or
`coverage` case-insensitively. Other dotfiles remain eligible. Ignore files
do not change traversal. Links, multiply linked files, unsupported text and
unavailable entries produce skipped or incomplete coverage. The panel reports
partial, canceled and failed searches. Identity checks bracket asynchronous
reads. The [Explorer's filesystem race limitations](explorer.md) also apply.

The native and session tests exercise controlled reads, revocation, stale
content and budget limits. The `search` Electron journey covers an explicit
scan in Code, Save and Cancel during directory I/O, match selection and draft
retention. Run it with `pnpm.cmd test:isolated search`, also with
`--scale125` or `--dev`.
