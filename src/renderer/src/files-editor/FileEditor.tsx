import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EditorSession } from './session.ts'
import { editorText } from '../../../shared/documents.ts'
import './files-editor.css'

export function useFileEditor(locked: boolean) {
  const [session] = useState(() => new EditorSession(window.geppio!.documents))
  session.locked = locked
  useEffect(() => session.bridge.onCloseRequested(ticket => { void session.close(ticket) }), [session])
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && session.snapshot().document) { event.preventDefault(); void session.save() }
    }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [session])
  return session
}
/** Both adapters render this same implementation; only the selected adapter mounts it. */
export function FileEditor({ session }: { session: EditorSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (element) { element.setSelectionRange(session.selection.start, session.selection.end); element.scrollTop = session.selection.top; element.scrollLeft = session.selection.left }
  }, [session, state.document?.id])
  const remember = () => { const element = input.current; if (element) session.rememberSelection({ start: element.selectionStart, end: element.selectionEnd, top: element.scrollTop, left: element.scrollLeft }) }
  return <section className="file-editor" aria-label="Arquivos & Editor" data-document-id={state.document?.id} data-document-dirty={session.dirty} data-document-status={state.busy ? 'busy' : state.code ?? (session.dirty ? 'dirty' : 'clean')}>
    <div className="file-editor-toolbar">
      <strong title={state.document?.name}>{state.document?.name ?? 'Nenhum arquivo aberto'}{session.dirty ? ' •' : ''}</strong>
      <button className="ui-button tool-button" disabled={state.busy || session.locked} onClick={() => { void session.open() }}>Abrir arquivo</button>
      <button className="ui-button tool-button" aria-keyshortcuts="Control+S" disabled={!state.document || state.busy || session.locked} onClick={() => { void session.save() }}>Salvar arquivo</button>
      {state.document && <button className="ui-button tool-button" disabled={state.busy || session.locked} onClick={() => { void session.release() }}>Fechar arquivo</button>}
    </div>
    {state.document ? <textarea ref={input} data-file-editor="" aria-label="Conteúdo do arquivo" aria-describedby="file-editor-feedback" value={editorText(state.text)} readOnly={state.busy || session.locked} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" onChange={event => session.edit(event.target.value)} onSelect={remember} onScroll={remember} onBlur={remember} />
      : <div className="file-editor-empty"><h2>Seu primeiro documento</h2><p>Abra um arquivo de texto ou código UTF-8 de até 1 MiB. O mesmo documento fica disponível no widget Editor de arquivo.</p><p>O rascunho fica apenas nesta sessão. Salve antes de sair.</p></div>}
    <div className="file-editor-feedback" id="file-editor-feedback" role="status" aria-live="polite">
      <span>{state.busy ? 'Operação de arquivo em andamento…' : state.error ?? (state.document ? session.dirty ? 'Alterações não salvas' : 'Salvo · UTF-8' + (state.document.bom ? ' com BOM' : '') : 'Seleção individual por diálogo nativo')}</span>
      {state.error && state.document && <button className="ui-button tool-button" onClick={() => { void navigator.clipboard.writeText(state.text).then(() => session.feedback('Rascunho copiado. Você pode reabrir o arquivo e decidir quais alterações manter.'), () => session.feedback('Não foi possível copiar. Selecione o texto e use Ctrl+C antes de reabrir.')) }}>Copiar rascunho</button>}
    </div>
    <p className="file-editor-limit">Piloto para arquivos comuns em pasta privada. Salvar substitui o arquivo: permissões específicas e metadados adicionais do Windows não são preservados.</p>
  </section>
}
export function EditorModeSwitch({ mode, disabled, change }: { mode: 'editor' | 'widgets'; disabled: boolean; change(mode: 'editor' | 'widgets'): void }) {
  return <div className="file-mode-switch" role="group" aria-label="Modo de trabalho">
    {(['editor', 'widgets'] as const).map(value => <button key={value} className="ui-button tool-button" aria-pressed={mode === value} disabled={disabled} title={disabled ? 'Conclua ou cancele a edição do layout antes de trocar de modo.' : undefined} onClick={() => change(value)}>{value === 'editor' ? 'Editor' : 'Widgets'}</button>)}
  </div>
}
