# Project text search

GeppIO Code searches saved UTF-8 files beneath the selected Workspace. Enter or
**Buscar** starts a scan. The Core session keeps the query, options, progress and
results across panel switches. A replacement search invalidates the previous
job. Cancel retains the matches already found. An OS read already in flight can
finish before the scanner starts new work.

Code and the Workbench project menu can open the same Search View in an
internal window. The shell allows one Git window and one Search window. Each
presentation subscribes to its existing Core session. Closing, raising and
moving a window leave queries, jobs, editor history and saved layouts intact.
The Move control accepts arrows in CSS pixels and Shift for ten-pixel steps.
Enter confirms, Escape restores the position and Tab leaves movement mode.

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
retention. In the disposable fixture, background Git status enumerates the
same directory first. The test holds only the Search request's directory
handle, sends Enter after switching back to Code, and verifies the canceled
handle closes before iteration. Run it with `pnpm.cmd test:isolated search`, also with
`--scale125` or `--dev`.

## Filtered replacement

A path filter is a literal, case-sensitive relative file name, or a directory prefix ending in
`/`. Empty filters include all eligible paths. A path has at most 512 UTF-16 units and 32 segments.
Empty internal segments, traversal components, backslashes, controls and Windows-reserved punctuation
are rejected. The separate extension field accepts up to 12 comma-separated ASCII suffixes, without
dots, matched case-insensitively. Filtering precedes source reads and keeps the traversal exclusions.

After a scan, the user selects occurrences and enters a literal single-line replacement (empty text
deletes a match). The preview binds the job and its root, the selected spans, saved file witnesses,
the replacement and the IDs/revisions of eligible open tabs. Limits are 100 files, 1,000 matches,
1,024 replacement UTF-16 units and 1 MiB per output including its BOM. Partial scans remain labeled.
Main checks ancestors, file identity and bytes again when applying each reviewed file. It uses the
document writer's flushed sibling replacement and its documented same-user race limitations.
Each file holds the editor transaction through adoption. Other open drafts can still change between
writes. If a cursor or tab metadata update is already in flight, the confirmed file waits in its
transaction and revalidates the preview, caller, root and disk evidence before writing. A changed
clean tab resets its Monaco undo history. Pending drafts, uncertain bindings and
the app profile are ineligible. Confirmed changes to earlier files survive interruption. An uncertain
receipt requires disk inspection and a fresh review before another batch. No batch writes run on scan,
filter changes or preview alone.

## Quick Open

In Code, **Abrir arquivo do projeto...** opens a filename dialog. Ctrl+P opens
it from the Code shell. Terminal, Monaco, editable controls and modal surfaces
keep their own keyboard input. Typing the first valid term starts one inventory
after a short debounce. Further terms filter the same inventory. The ordering
is basename prefix, basename substring, then relative-path substring, with
lexical ties resolved by folded and original spelling. Matching preserves
accents and treats punctuation literally.

Each window can run one filename inventory alongside one content search. Each
uses the traversal limits and exclusions above. The inventory records names
and identity metadata, with a 1 MiB serialized budget including the private
witnesses. Each reply contains up to 200 relative names and opaque IDs. The
dialog labels incomplete coverage. Closing the dialog revokes the inventory,
and replacing the root revokes both jobs. Nothing is indexed on disk.

Selecting a result revalidates its identity and opens it through the regular
document transaction. An existing document keeps its model and undo history.
Enumeration and filtering never read source bytes. The disposable
`quick-open` journey covers focus, keyboard activation, an edited tab,
Terminal, a plugin Worker and existing Git/Search windows at DPR 1 and 1.25.
