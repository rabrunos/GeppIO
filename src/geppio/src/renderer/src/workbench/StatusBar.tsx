import { useMemo, useSyncExternalStore } from 'react'
import { DOCUMENT_LANGUAGES, documentCursor, documentEOL, documentLanguage } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import { terminalFailed, terminalLabel } from '../../../shared/terminal.ts'
import type { EditorSession } from '../files-editor/session.ts'
import type { TerminalSession } from '../terminal/session.ts'

/** Summaries of existing owners; language is a session-only editor preference. */
export function StatusBar({ editor, terminal, reveal, locked }: { editor: EditorSession; terminal: TerminalSession; reveal(): void; locked: boolean }) {
  const document = useSyncExternalStore(editor.subscribe, editor.snapshot), session = useSyncExternalStore(terminal.subscribe, terminal.snapshot)
  const eol = useMemo(() => documentEOL(document.text), [document.text])
  const cursor = documentCursor(document.text, document.cursor), language = document.language ?? documentLanguage(document.document?.name ?? '')
  const status = document.busy ? 'Operação em andamento' : document.error ? document.code === 'conflict' ? 'Conflito no arquivo' : 'Erro no documento' : !document.document ? 'Nenhum documento' : editor.dirty ? 'Não salvo' : 'Salvo'
  return <footer className="status-bar fixed-status-bar" aria-label="Barra de estado">
    <div className="status-left">
      <span className="status-document" data-status-document={document.busy ? 'busy' : document.error ? 'error' : !document.document ? 'none' : editor.dirty ? 'dirty' : 'saved'} title={document.error ?? `${document.document?.name ?? 'Nenhum arquivo aberto'} · ${status}`}>{status}</span>
      <button className="status-terminal" data-status-terminal={session.native.phase} data-failed={terminalFailed(session.native)} disabled={locked} title={`${terminalLabel(session.native)}. Mostrar Terminal. ${session.native.error ?? ''}`} onClick={reveal}>{terminalLabel(session.native)}</button>
    </div>
    <div className="status-right">
      {document.document && <>
        <span className="status-cursor" title="Posição do cursor; coluna em unidades UTF-16">Ln {cursor.line}, Col {cursor.column}</span>
        <span className="status-encoding" title="Codificação do documento">UTF-8{document.document.bom ? ' BOM' : ''}</span>
        <span className="status-eol" title="Finais de linha reais no buffer">{eol}</span>
        <select className="status-language" aria-label="Linguagem do documento" title="Preferência de linguagem nesta sessão; não altera bytes ou realce" value={language} disabled={document.busy || locked} onChange={event => editor.setLanguage(event.target.value as DocumentLanguage)}>{DOCUMENT_LANGUAGES.map(value => <option key={value}>{value}</option>)}</select>
      </>}
      <span className="status-version" title="GeppIO">{window.geppio?.version ?? __APP_VERSION__}</span>
    </div>
  </footer>
}
