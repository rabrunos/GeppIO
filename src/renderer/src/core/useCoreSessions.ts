import { useEffect, useState } from 'react'
import { ExplorerSession } from '../files-editor/explorer-session.ts'
import { monacoPresentation } from '../files-editor/monaco.ts'
import { EditorSession } from '../files-editor/session.ts'
import { GitSession } from '../git/session.ts'
import { TerminalSession } from '../terminal/session.ts'

/** One owner per renderer window. Presentation adapters only borrow these sessions. */
export function useCoreSessions(layoutEditing: boolean) {
  const [editor] = useState(() => new EditorSession(window.geppio!.documents))
  const [explorer] = useState(() => new ExplorerSession(window.geppio!.explorer, editor, window.geppio!.workspace))
  const [git] = useState(() => new GitSession(window.geppio!.git, explorer))
  const [terminal] = useState(() => new TerminalSession(window.geppio!.terminal))
  editor.locked = layoutEditing
  explorer.locked = layoutEditing
  git.locked = layoutEditing

  useEffect(() => {
    const presentation = monacoPresentation(editor)
    presentation.connect()
    return () => presentation.dispose()
  }, [editor])
  useEffect(() => editor.bridge.onCloseRequested(ticket => { void editor.close(ticket) }), [editor])
  useEffect(() => {
    function save(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editor.snapshot().document) {
        event.preventDefault()
        void editor.save()
      }
    }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [editor])
  useEffect(() => { explorer.connect(); void explorer.initialize(); return () => explorer.dispose() }, [explorer])
  useEffect(() => { git.connect(); return () => git.dispose() }, [git])
  useEffect(() => { terminal.connect(); return () => terminal.dispose() }, [terminal])

  return { editor, explorer, git, terminal }
}
export type CoreSessions = ReturnType<typeof useCoreSessions>
