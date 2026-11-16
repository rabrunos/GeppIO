import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EditorSession } from './session.ts'
import { monacoPresentation } from './monaco.ts'
import { XMarkIcon } from '@heroicons/react/24/outline'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import './files-editor.css'

export function useFileEditor(locked: boolean) {
  const [session] = useState(() => new EditorSession(window.geppio!.documents))
  session.locked = locked
  useEffect(() => { const presentation = monacoPresentation(session); presentation.connect(); return () => presentation.dispose() }, [session])
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
  const state = useSyncExternalStore(session.subscribe, session.snapshot), input = useRef<HTMLDivElement>(null), tabs = useRef<HTMLDivElement>(null)
  const hasDocument = !!state.document
  useLayoutEffect(() => {
    const element = input.current
    if (element) return monacoPresentation(session).attach(element)
  }, [session, hasDocument])
  useLayoutEffect(() => { monacoPresentation(session).refresh() }, [session, state.busy, session.locked])
  async function tabKey(event: ReactKeyboardEvent, index: number) {
    if (state.busy || session.locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Delete') await session.release(state.tabs[index]!.document.id)
    else {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + state.tabs.length) % state.tabs.length
      await session.activate(state.tabs[next]!.document.id)
    }
    const id = session.snapshot().document?.id
    if (id) tabs.current?.querySelector<HTMLElement>(`[data-document-tab="${id}"]`)?.focus()
  }
  return <section className="file-editor" aria-label="Arquivos & Editor" data-document-id={state.document?.id} data-document-dirty={session.dirty} data-document-status={state.busy ? 'busy' : state.code ?? (session.dirty ? 'dirty' : 'clean')}>
    <div className="file-editor-toolbar">
      <strong title={state.document?.name}>{state.document?.name ?? 'Nenhum arquivo aberto'}{session.dirty ? ' •' : ''}</strong>
      <button className="ui-button tool-button" disabled={state.busy || session.locked} onClick={() => { void session.open() }}>Abrir arquivo</button>
      <button className="ui-button tool-button" aria-keyshortcuts="Control+S" disabled={!state.document || state.busy || session.locked} onClick={() => { void session.save() }}>Salvar arquivo</button>
      {state.document && <button className="ui-button tool-button" disabled={state.busy || session.locked} onClick={() => { void session.release() }}>Fechar arquivo</button>}
    </div>
    {state.tabs.length > 0 && <div ref={tabs} className="file-editor-tabs ui-scrollbar" role="tablist" aria-label="Arquivos abertos">
      {state.tabs.map((tab, index) => { const id = tab.document.id, active = state.document?.id === id, dirty = tab.text !== tab.document.text; return <div key={id} className="file-editor-tab">
        <button role="tab" id={'document-tab-' + id} data-document-tab={id} aria-controls="file-editor-document-panel" aria-selected={active} tabIndex={active ? 0 : -1} disabled={state.busy || session.locked} title={(tab.document.location?.names.join('/') ?? tab.document.label ?? tab.document.name) + (tab.error ? ' — ' + tab.error : '')} className="ui-button" onClick={() => { void session.activate(id) }} onKeyDown={event => { void tabKey(event, index) }}><span>{tab.document.name}</span>{dirty && <span className="file-editor-dirty" aria-label="Alterações não salvas">●</span>}</button>
        <button className="ui-button file-editor-tab-close" aria-label={'Fechar aba ' + tab.document.name} tabIndex={active ? 0 : -1} disabled={state.busy || session.locked} onClick={() => { void session.release(id) }}><XMarkIcon className="icon" /></button>
      </div> })}
    </div>}
    {state.document ? <div ref={input} className="monaco-host" id="file-editor-document-panel" role="tabpanel" aria-labelledby={'document-tab-' + state.document.id} data-file-editor="" aria-describedby="file-editor-feedback" />
      : <div className="file-editor-empty"><h2>Seu primeiro documento</h2><p>Abra um arquivo de texto ou código UTF-8 de até 1 MiB. O mesmo documento fica disponível no widget Editor de arquivo.</p><p>O rascunho fica apenas nesta sessão. Salve antes de sair.</p></div>}
    <div className="file-editor-feedback" id="file-editor-feedback" role="status" aria-live="polite">
      <span>{state.busy ? 'Operação de arquivo em andamento…' : state.notice ?? state.error ?? (state.document ? session.dirty ? 'Alterações não salvas' : 'Salvo · UTF-8' + (state.document.bom ? ' com BOM' : '') : 'Seleção por diálogo nativo')}</span>
      {state.error && state.document && <button className="ui-button tool-button" onClick={() => { void navigator.clipboard.writeText(state.text).then(() => session.feedback('Rascunho copiado. Feche a aba e reabra o arquivo para decidir quais alterações manter.'), () => session.feedback('Não foi possível copiar. Selecione o texto e use Ctrl+C antes de reabrir.')) }}>Copiar rascunho</button>}
    </div>
    <p className="file-editor-limit">Piloto para arquivos comuns em pasta privada. Salvar substitui o arquivo: permissões específicas e metadados adicionais do Windows não são preservados.</p>
  </section>
}
export function EditorModeSwitch({ mode, disabled, change }: { mode: 'editor' | 'widgets'; disabled: boolean; change(mode: 'editor' | 'widgets'): void }) {
  return <div className="file-mode-switch" role="group" aria-label="Modo de trabalho">
    {(['editor', 'widgets'] as const).map(value => <button key={value} className="ui-button tool-button" aria-pressed={mode === value} disabled={disabled} title={disabled ? 'Conclua ou cancele a edição do layout antes de trocar de modo.' : undefined} onClick={() => change(value)}>{value === 'editor' ? 'Editor' : 'Widgets'}</button>)}
  </div>
}
