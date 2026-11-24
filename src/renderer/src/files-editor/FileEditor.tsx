import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorSession } from './session.ts'
import { oppositeGroup } from './editor-groups.ts'
import type { GroupIndex } from './editor-groups.ts'
import { monacoPresentation } from './monaco.ts'
import { ArrowPathIcon, DocumentArrowDownIcon, DocumentDuplicateIcon, DocumentPlusIcon, FolderOpenIcon, PencilSquareIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Popover } from '../workbench/Primitives.tsx'
import './files-editor.css'

const tabMoves = [{ key: 'ArrowLeft', offset: -1 }, { key: 'ArrowRight', offset: 1 }]
const reorderShortcuts = tabMoves.map(move => 'Alt+Shift+' + move.key).join(' ')

function GroupPane({ session, side }: { session: EditorSession; side: GroupIndex }) {
  const state = session.snapshot(), group = session.groups.sides[side], selected = group.selected
  const tabs = useRef<HTMLDivElement>(null), input = useRef<HTMLDivElement>(null)
  const dragged = useRef<string | null>(null)
  const panelId = side === 0 ? 'file-editor-document-panel' : 'file-editor-second-panel'
  const tabId = (id: string) => 'document-tab-' + (side === 0 ? '' : 'right-') + id
  const hasDocument = !!selected
  useLayoutEffect(() => {
    if (input.current) return monacoPresentation(session).attach(input.current, side)
  }, [session, side, hasDocument])
  async function focusTab(id: string) {
    if (session.groups.active === side && session.snapshot().document?.id === id && !session.focusUnconfirmed) return
    if (!await session.focusGroup(side, id)) {
      const active = session.snapshot().document?.id
      if (active) document.querySelector<HTMLElement>(`[data-editor-group="${session.groups.active}"] [data-document-tab="${active}"]`)?.focus()
    }
  }
  async function tabKey(event: ReactKeyboardEvent, index: number) {
    if (state.busy || session.locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const move = tabMoves.find(candidate => candidate.key === event.key)
    if (event.altKey && event.shiftKey && move) {
      session.reorderTab(side, group.tabs[index]!, index + move.offset); return
    }
    if (event.key === 'Delete') await session.closeOccurrence(side, group.tabs[index]!)
    else {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? group.tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + group.tabs.length) % group.tabs.length
      await session.focusGroup(side, group.tabs[next]!)
    }
    const id = session.groups.sides[side].selected
    if (id) tabs.current?.querySelector<HTMLElement>(`[data-document-tab="${id}"]`)?.focus()
  }
  return <section className="file-editor-group" aria-label={side === 0 ? 'Grupo esquerdo' : 'Grupo direito'} data-editor-group={side} data-focused={session.groups.active === side}>
    {group.tabs.length > 0 && <div ref={tabs} className="file-editor-tabs ui-scrollbar" role="tablist" aria-label={session.groups.split ? 'Arquivos do grupo ' + (side + 1) : 'Arquivos abertos'}>
      {group.tabs.map((id, index) => { const tab = session.documentState(id)!, active = selected === id, dirty = tab.text !== tab.document.text; return <div key={id} className="file-editor-tab" data-pinned={session.groups.pinned.has(id)}
        onDragOver={event => { if (dragged.current && !state.busy && !session.locked) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => { if (dragged.current) { event.preventDefault(); session.reorderTab(side, dragged.current, index); dragged.current = null } }}>
        <button role="tab" draggable={!state.busy && !session.locked} onDragStart={event => { dragged.current = id; event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { dragged.current = null }}
          aria-keyshortcuts={reorderShortcuts} aria-description={session.groups.pinned.has(id) ? 'Aba fixada' : undefined} id={tabId(id)} data-document-tab={id} aria-controls={panelId} aria-selected={active} tabIndex={active ? 0 : -1} disabled={state.busy || session.locked} title={(tab.document.location?.names.join('/') ?? tab.document.label ?? tab.document.name) + (tab.error ? ' — ' + tab.error : '')} className="ui-button" onFocus={() => { if (selected === id && session.groups.active !== side) void focusTab(id) }} onClick={() => { void focusTab(id) }} onKeyDown={event => { void tabKey(event, index) }}><span>{tab.document.name}</span>{session.groups.pinned.has(id) && <span aria-hidden="true" className="tab-pin">◆</span>}{dirty && <span className="file-editor-dirty" aria-label="Alterações não salvas">●</span>}</button>
        <button className="ui-button file-editor-tab-close" aria-label={'Fechar aba ' + tab.document.name} tabIndex={active ? 0 : -1} disabled={state.busy || session.locked} onClick={() => { void session.closeOccurrence(side, id) }}><XMarkIcon className="icon" /></button>
      </div> })}
    </div>}
    {selected ? <div ref={input} className="monaco-host" id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} data-file-editor="" data-active-group={session.groups.active === side} aria-describedby="file-editor-feedback" />
      : session.groups.split ? <div className="file-editor-empty"><p>Este grupo está vazio.</p><button className="ui-button" disabled={state.busy || session.locked} onClick={async () => { if (await session.focusGroup(side, null)) await session.open() }}>Abrir arquivo neste grupo</button>
      <button className="ui-button" disabled={state.busy || session.locked || state.tabs.length >= 8} onClick={async () => { if (await session.focusGroup(side, null)) await session.create() }}>Novo documento neste grupo</button></div>
      : <div className="file-editor-empty"><h2>Seu primeiro documento</h2><p>Abra um arquivo de texto ou código UTF-8 de até 1 MiB. O mesmo documento fica disponível no widget Editor de arquivo.</p><p>O rascunho fica apenas nesta sessão. Salve antes de sair.</p></div>}
  </section>
}

function TabActions({ session }: { session: EditorSession }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null)
  const groups = session.groups, side = groups.active, current = groups.sides[side].selected, tabs = groups.sides[side].tabs
  const busy = session.locked || session.snapshot().busy, index = current ? tabs.indexOf(current) : -1
  const perform = (action: () => unknown) => { setOpen(false); void action() }
  function item(label: string, allowed: boolean, reason: string, action: () => unknown) {
    return <button role="menuitem" className="ui-button workspace-command" disabled={busy || !allowed} title={busy ? 'Aguarde a operação em andamento.' : allowed ? label : reason} onClick={() => perform(action)}>{label}</button>
  }
  const unpinned = (id: string) => !groups.pinned.has(id)
  return <><button ref={anchor} className="ui-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>Organizar abas</button>
    {open && <Popover bare title="Organizar abas" open close={() => setOpen(false)} anchor={anchor} className="workspace-popover workspace-project-menu">
      {item('Mover aba para a esquerda', index > 0, 'A aba já está no início do grupo.', () => current && session.reorderTab(side, current, index - 1))}
      {item('Mover aba para a direita', index >= 0 && index < tabs.length - 1, 'A aba já está no fim do grupo.', () => current && session.reorderTab(side, current, index + 1))}
      {item(current && groups.pinned.has(current) ? 'Desafixar aba' : 'Fixar aba', !!current, 'Selecione uma aba.', () => current && session.togglePin(current))}
      {item('Fechar outras abas', tabs.some(id => id !== current && unpinned(id)), 'As demais abas estão fixadas ou o grupo tem apenas uma aba.', () => session.closeTabs('others'))}
      {item('Fechar grupo', tabs.some(unpinned), 'O grupo está vazio ou só contém abas fixadas.', () => session.closeTabs('group'))}
      {item('Fechar todas as abas', groups.sides.some(g => g.tabs.some(unpinned)), 'Há apenas abas fixadas ou nenhum documento aberto.', () => session.closeTabs('all'))}
    </Popover>}</>
}

/** Both adapters render this same implementation; only the selected adapter mounts it. */
export function FileEditor({ session }: { session: EditorSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), area = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0), [, renderRatio] = useState(0)
  const groups = session.groups, split = groups.split, narrow = width < 468
  const usable = Math.max(1, width - 8), first = Math.max(230, Math.min(usable - 230, usable * groups.ratio))
  const setRatio = (ratio: number) => { groups.ratio = Math.min(0.85, Math.max(0.15, ratio)); renderRatio(groups.ratio) }
  const unresolved = state.document && session.documentState(state.document.id)?.unresolved
  const active = state.document && session.documentState(state.document.id)
  const writeBlocked = active?.renameUncertain || active?.destinationUncertain || active?.replacementUncertain || active?.detached || session.focusUnconfirmed
  const canReload = !!state.document && !state.document.untitled && !active?.destinationUncertain && !active?.detached && !session.focusUnconfirmed
  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure(); const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => { monacoPresentation(session).refresh() }, [session, state.busy, session.locked])
  const scope = state.document?.untitled ? 'Sem destino' : state.document?.location?.root === state.projectRoot && state.projectRoot ? 'No projeto' : 'Arquivo avulso'
  return <section className="file-editor" aria-label="Arquivos & Editor" data-document-id={state.document?.id} data-document-scope={state.document ? scope : undefined} data-document-dirty={session.dirty} data-document-status={state.busy ? 'busy' : state.code ?? (unresolved ? 'unconfirmed' : session.dirty ? 'dirty' : 'clean')}>
    <div className="file-editor-toolbar">
      <strong title={state.document ? state.document.name + ' · ' + scope : undefined}>{state.document?.name ?? 'Nenhum arquivo aberto'}{session.dirty ? ' •' : ''}{state.document && <small> · {scope}</small>}</strong>
      <button className="ui-button tool-button" aria-label="Novo documento" title={state.tabs.length >= 8 ? 'Feche uma aba para criar outro documento.' : 'Novo documento'} disabled={state.busy || session.locked || state.tabs.length >= 8} onClick={() => { void session.create() }}><DocumentPlusIcon className="icon" /><span>Novo documento</span></button>
      <button className="ui-button tool-button" aria-label="Abrir arquivo" title="Abrir arquivo" disabled={state.busy || session.locked} onClick={() => { void session.open() }}><FolderOpenIcon className="icon" /><span>Abrir arquivo</span></button>
      <button className="ui-button tool-button" aria-label="Salvar arquivo" title={writeBlocked ? 'Confira o vínculo no disco antes de salvar.' : 'Salvar arquivo'} aria-keyshortcuts="Control+S" disabled={!state.document || state.busy || session.locked || writeBlocked} onClick={() => { void session.save() }}><DocumentArrowDownIcon className="icon" /><span>Salvar arquivo</span></button>
      <button className="ui-button tool-button" aria-label="Salvar como" title={active?.renameUncertain ? 'Confira a renomeação antes de escolher outro destino.' : state.document ? 'Salvar como' : 'Abra ou crie um documento.'} disabled={!state.document || state.busy || session.locked || active?.renameUncertain || active?.detached || session.focusUnconfirmed} onClick={() => { void session.saveAs() }}><PencilSquareIcon className="icon" /><span>Salvar como</span></button>
      <button className="ui-button tool-button" aria-label="Salvar todos" title={state.tabs.length ? 'Salvar documentos em ordem de abertura' : 'Abra ou crie um documento.'} disabled={!state.tabs.length || state.busy || session.locked} onClick={() => { void session.saveAll() }}><DocumentDuplicateIcon className="icon" /><span>Salvar todos</span></button>
      {state.document && <button className="ui-button tool-button" aria-label="Recarregar do disco" title={active?.destinationUncertain ? 'Confira o destino e use Salvar como.' : canReload ? 'Recarregar do disco' : 'O documento ainda não tem destino.'} disabled={!canReload || state.busy || session.locked} onClick={() => { void session.reload() }}><ArrowPathIcon className="icon" /><span>Recarregar do disco</span></button>}
      {state.document && <button className="ui-button tool-button" aria-label="Fechar arquivo" title="Fechar arquivo" disabled={state.busy || session.locked} onClick={() => { void session.closeOccurrence(groups.active) }}><XMarkIcon className="icon" /><span>Fechar arquivo</span></button>}
    </div>
    <div className="file-editor-group-tools" aria-label="Grupos do editor">
      <TabActions session={session} />
      <button className="ui-button" disabled={state.busy || session.locked} onClick={() => { if (split) void session.mergeGroups(); else session.sendToOtherGroup() }}>{split ? 'Unir grupos' : 'Dividir editor'}</button>
      {split && <><button className="ui-button" disabled={!active || state.busy || session.locked} title={active ? 'Abrir a aba atual no outro grupo' : 'Selecione um documento.'} onClick={() => session.sendToOtherGroup()}>Abrir no outro grupo</button>
      <button className="ui-button" disabled={!active || state.busy || session.locked} title={active ? 'Mover a aba atual para o outro grupo' : 'Selecione um documento.'} onClick={() => session.sendToOtherGroup(true)}>Mover para o outro grupo</button>
      {narrow && <button className="ui-button" disabled={state.busy || session.locked} onClick={() => { void session.focusGroup(oppositeGroup(groups.active)) }}>Mostrar outro grupo</button>}</>}
    </div>
    <div ref={area} className="file-editor-groups" data-split={split} data-collapsed={split && narrow} style={split && !narrow ? { gridTemplateColumns: first + 'px 8px minmax(0, 1fr)' } : undefined}>
      {(!split || !narrow || groups.active === 0) && <GroupPane key="left" session={session} side={0} />}
      {split && !narrow && <div className="file-editor-divider" role="separator" aria-label="Largura do grupo esquerdo" aria-orientation="vertical" tabIndex={0} aria-valuemin={Math.round(230 / usable * 100)} aria-valuemax={Math.round((usable - 230) / usable * 100)} aria-valuenow={Math.round(first / usable * 100)}
        onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus() } }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && area.current) setRatio((event.clientX - area.current.getBoundingClientRect().left - 4) / usable) }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault(); event.stopPropagation()
          setRatio((event.key === 'Home' ? 230 : event.key === 'End' ? usable - 230 : first + (event.key === 'ArrowLeft' ? -16 : 16)) / usable)
        }} />}
      {split && (!narrow || groups.active === 1) && <GroupPane key="right" session={session} side={1} />}
    </div>
    <div className="file-editor-feedback" id="file-editor-feedback" role="status" aria-live="polite">
      <span>{state.busy ? 'Operação de arquivo em andamento…' : state.notice ?? state.error ?? (unresolved ? 'O estado no disco ainda precisa ser confirmado.' : state.document ? session.dirty ? 'Alterações não salvas' : state.document.untitled ? 'Documento sem destino · UTF-8' : 'Salvo · UTF-8' + (state.document.bom ? ' com BOM' : '') : 'Seleção por diálogo nativo')}</span>
      {active?.detached && <button className="ui-button" onClick={() => { if (window.confirm('Descartar definitivamente o rascunho local desta aba?')) void session.discardDetached(active.document.id) }}>Descartar rascunho local</button>}
      {active?.destinationUncertain && <span>Confira o destino no disco. Para manter o rascunho, use Salvar como.</span>}
      {state.error && state.document && <button className="ui-button tool-button" onClick={() => { void navigator.clipboard.writeText(state.text).then(() => session.feedback('Rascunho copiado.'), () => session.feedback('Não foi possível copiar. Selecione o texto e use Ctrl+C para guardar o rascunho.')) }}>Copiar rascunho</button>}
    </div>
    <p className="file-editor-limit">Piloto para arquivos comuns em pasta privada. Salvar substitui o arquivo: permissões específicas e metadados adicionais do Windows não são preservados.</p>
  </section>
}
