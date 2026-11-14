# Contextual Status Bar — alpha.40 / Issue #47

The host-owned fixed 25 CSS-pixel footer remains outside widget geometry. `StatusBar.tsx` subscribes
to the existing `EditorSession` and `TerminalSession`, never another editable buffer or native store.
No plugin contribution SDK or task-launching toolbar is added. Decorative ready/cloud/clock/bell/TS
placeholders are removed. The version still comes from package.json/preload. Compact items truncate,
carry descriptive titles and use native keyboard-accessible buttons/selects in both themes.

## Document data

`EditorSession` remains the only editable source. Busy, fixed error/conflict feedback, dirty comparison
and confirmed document determine the summary, in that priority. No document is explicit. UTF-8/BOM
comes from `DocumentSnapshot`; EOL comes from exact current-buffer CRLF/LF/CR tokens, including mixed
and no-newline states. It is not inferred from textarea-normalized text. Cursor line/column uses the
actual textarea selection end (UTF-16 units, one-based), with CRLF/CR normalized for display only.
Selection/scroll already retained by the session now notifies the status subscriber on cursor changes.

`shared/document-status.ts` derives extension-based language labels. The chooser updates a session-only
language preference in EditorSession; it resets on replacement/release, survives mode changes and Save,
and never edits bytes, encoding or EOL. This is a language label/preference, not syntax highlighting,
parsing, validation or language services. Monaco remains the separately planned later migration in #32.
Existing document authority, atomic-write/conflict/dirty-close and crash limitations are unchanged.

## Terminal data

The footer reflects native phases: no session, starting, running, closing, user-closed, natural exit
with actual code, or startup failure. Only startup failure or an observed nonzero shell exit marks
failure. Arbitrary terminal text, PowerShell command errors and `$LASTEXITCODE` are not diagnostics.
Clicking the contextual item reveals/focuses the same Terminal, including retained screen and explicit
Restart after failure; it does not execute a command or start another session. Layout Edit blocks this
presentation switch. Full startup/error feedback stays in Terminal; full file feedback stays in Editor.
No unsupported warning/error counts, Git state, clock notifications or cloud status are displayed.
