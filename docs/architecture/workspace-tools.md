# Workspace Tools reports

Put the following UTF-8 JSON in `.geppio/tools.json` at the root of a project:

```json
{
  "schemaVersion": 1,
  "reports": [{
    "id": "quality",
    "title": "Qualidade",
    "blocks": [
      { "kind": "text", "text": "Resumo da validação." },
      { "kind": "list", "items": ["Build concluído"] },
      { "kind": "table", "columns": ["Verificação", "Resultado"], "rows": [["Testes", "12/12"]] }
    ]
  }]
}
```

Selecting or restoring a project triggers one read. Open **Abrir relatórios do projeto** from Code or the Workbench project menu. Select a report inside the window. Use **Atualizar** after changing the file. Git, Search and Tools share the existing window manager and each has one floating instance. Changing experiences and reopening Tools reuse the Core session.

The entire file is limited to 64 KiB. The parser accepts up to eight reports with eight blocks each. Report IDs use the existing safe plugin ID grammar (up to 64 characters) and are unique within the document. Titles can use 80 UTF-16 code units, text blocks 4096, and each list item, header or cell 256. Lists allow 50 items. Tables allow six columns and 50 rows with the same width as the header. The combined count of list items, header cells and data cells across the file is limited to 1000. Unknown and duplicate keys, unsupported versions and malformed UTF-8 invalidate the entire read. React renders values as literal text.

Main derives the two fixed path components from the authorized workspace. The caller must own the exact main frame and present the current opaque root ID. Directory and file identities, handle metadata, byte limits and the grant are checked across the read. The [Explorer filesystem limitations](explorer.md) also apply. Report data stays in memory. Closing or changing the root clears the snapshot and invalidates older replies. A confirmed missing file clears the report list. A read error on the same authorized root leaves the last successful snapshot visible with its timestamp and stale status.

Run `pnpm.cmd test:isolated workspace-tools` for the combined file, presentation, plugin and composition journey. Add `--scale125` for the focused Tools journey at simulated DPR 1.25.
