import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { EditorSession } from './session.ts'
import { monacoPresentation } from './monaco.ts'
import { ArrowPathIcon, DocumentArrowDownIcon, FolderOpenIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import './files-editor.css'

/** Both adapters render this same implementation; only the selected adapter mounts it. */
export function FileEditor({ session }: { session: EditorSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), input = useRef<HTMLDivElement>(null), tabs = useRef<HTMLDivElement>(null)
  const hasDocument = !!state.document
  const unresolved = state.document && session.documentState(state.document.id)?.unresolved
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
  const scope = state.document?.location?.root === state.projectRoot && state.projectRoot ? 'No projeto' : 'Arquivo avulso'
  return <section className="file-editor" aria-label="Arquivos & Editor" data-document-id={state.document?.id} data-document-scope={state.document ? scope : undefined} data-document-dirty={session.dirty} data-document-status={state.busy ? 'busy' : state.code ?? (unresolved ? 'unconfirmed' : session.dirty ? 'dirty' : 'clean')}>
    <div className="file-editor-toolbar">
      <strong title={state.document ? state.document.name + ' · ' + scope : undefined}>{state.document?.name ?? 'Nenhum arquivo aberto'}{session.dirty ? ' •' : ''}{state.document && <small> · {scope}</small>}</strong>
      <button className="ui-button tool-button" aria-label="Abrir arquivo" title="Abrir arquivo" disabled={state.busy || session.locked} onClick={() => { void session.open() }}><FolderOpenIcon className="icon" /><span>Abrir arquivo</span></button>
      <button className="ui-button tool-button" aria-label="Salvar arquivo" title="Salvar arquivo" aria-keyshortcuts="Control+S" disabled={!state.document || state.busy || session.locked} onClick={() => { void session.save() }}><DocumentArrowDownIcon className="icon" /><span>Salvar arquivo</span></button>
      {state.document && <button className="ui-button tool-button" aria-label="Recarregar do disco" title="Recarregar do disco" disabled={state.busy || session.locked} onClick={() => { void session.reload() }}><ArrowPathIcon className="icon" /><span>Recarregar do disco</span></button>}
      {state.document && <button className="ui-button tool-button" aria-label="Fechar arquivo" title="Fechar arquivo" disabled={state.busy || session.locked} onClick={() => { void session.release() }}><XMarkIcon className="icon" /><span>Fechar arquivo</span></button>}
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
      <span>{state.busy ? 'Operação de arquivo em andamento…' : state.notice ?? state.error ?? (unresolved ? 'O estado no disco ainda precisa ser confirmado.' : state.document ? session.dirty ? 'Alterações não salvas' : 'Salvo · UTF-8' + (state.document.bom ? ' com BOM' : '') : 'Seleção por diálogo nativo')}</span>
      {state.error && state.document && <button className="ui-button tool-button" onClick={() => { void navigator.clipboard.writeText(state.text).then(() => session.feedback('Rascunho copiado. Use Recarregar do disco para ler o arquivo novamente.'), () => session.feedback('Não foi possível copiar. Selecione o texto e use Ctrl+C para guardar o rascunho.')) }}>Copiar rascunho</button>}
    </div>
    <p className="file-editor-limit">Piloto para arquivos comuns em pasta privada. Salvar substitui o arquivo: permissões específicas e metadados adicionais do Windows não são preservados.</p>
  </section>
}
