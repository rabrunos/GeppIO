import { CapabilityRuntime } from '@geppio/runtime'
import { useEffect, useState } from 'react'
import { ExplorerSession } from '../files-editor/explorer-session.ts'
import { monacoPresentation } from '../files-editor/monaco.ts'
import { EditorSession } from '../files-editor/session.ts'
import { GitSession } from '../git/session.ts'
import { TerminalSession } from '../terminal/session.ts'
import { SearchSession } from '../search/session.ts'
import { QuickOpenSession } from '../quick-open/session.ts'
import { WorkspaceToolsSession } from '../workspace-tools/session.ts'

/** One owner per renderer window. Presentation adapters only borrow these sessions. */
export function useCoreSessions(layoutEditing: boolean) {
  const [editor] = useState(() => new EditorSession(window.geppio!.documents, window.geppio!.draftRecovery))
  const [explorer] = useState(() => new ExplorerSession(window.geppio!.explorer, editor, window.geppio!.workspace))
  const [git] = useState(() => new GitSession(window.geppio!.git, explorer))
  const [search] = useState(() => new SearchSession(window.geppio!.search, explorer,
    (id, match) => monacoPresentation(editor).revealMatch(id, match.line, match.column, match.length)))
  const [terminal] = useState(() => new TerminalSession(window.geppio!.terminal))
  const [quickOpen] = useState(() => new QuickOpenSession(window.geppio!.quickOpen, explorer))
  const [tools] = useState(() => new WorkspaceToolsSession(window.geppio!.workspace, explorer))
  editor.locked = layoutEditing
  explorer.locked = layoutEditing
  git.locked = layoutEditing
  search.locked = layoutEditing
  quickOpen.locked = layoutEditing

  useEffect(() => editor.bridge.onCloseRequested(ticket => { void editor.close(ticket) }), [editor])
  useEffect(() => editor.recovery?.connect(), [editor])
  useEffect(() => {
    function save(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editor.snapshot().document) {
        event.preventDefault()
        const group = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-editor-group]') : null
        if (group && group.dataset.focused !== 'true') return
        void editor.save()
      }
    }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [editor])
  useEffect(() => {
    const connect = (session: { connect(): void; dispose(): void }) => {
      session.connect()
      return () => session.dispose()
    }
    const runtime = new CapabilityRuntime({
      editor: { start: () => connect(monacoPresentation(editor)) },
      explorer: { requires: ['editor'], start: () => {
        const dispose = connect(explorer)
        void explorer.initialize()
        return dispose
      } },
      git: { requires: ['explorer'], start: () => connect(git) },
      search: { requires: ['explorer'], start: () => connect(search) },
      quickOpen: { requires: ['explorer'], start: () => connect(quickOpen) },
      workspaceTools: { requires: ['explorer'], start: () => connect(tools) },
      terminal: { start: () => connect(terminal) }
    })
    runtime.activate(['editor', 'explorer', 'git', 'search', 'quickOpen', 'workspaceTools', 'terminal'])
    return () => runtime.dispose()
  }, [editor, explorer, git, search, quickOpen, tools, terminal])

  return { editor, explorer, git, search, terminal, quickOpen, tools }
}
export type CoreSessions = ReturnType<typeof useCoreSessions>
