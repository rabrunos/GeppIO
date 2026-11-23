import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowPathIcon, ChevronRightIcon, DocumentIcon, DocumentPlusIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, PencilSquareIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { validExplorerBasename } from '../../../shared/explorer.ts'
import type { ExplorerMutation, ExplorerNode, RenameBinding } from '../../../shared/explorer.ts'
import type { ExplorerSession } from './explorer-session.ts'
import type { GitSession } from '../git/session.ts'
import { gitDecorations } from '../git/decorations.ts'
import { Dialog, IconButton } from '../workbench/Primitives.tsx'
import './explorer.css'

export function Explorer({ session, git }: { session: ExplorerSession; git: GitSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), editor = useSyncExternalStore(session.editor.subscribe, session.editor.snapshot)
  const gitState = useSyncExternalStore(git.subscribe, git.snapshot)
  const status = gitState.status?.root === state.root?.id ? gitState.status : null
  const decorations = useMemo(() => gitDecorations(status), [status])
  const viewport = useRef<HTMLDivElement>(null), tree = useRef<HTMLDivElement>(null)
  const [, renderFocus] = useState(0)
  const [form, setForm] = useState<{ root: string; node: ExplorerNode; parent: string | null; path: string; operation: ExplorerMutation; binding: RenameBinding | null } | null>(null)
  const [name, setName] = useState('')
  const submitting = useRef(false)
  const disabled = state.busy || editor.busy || session.locked
  const rows: { node: ExplorerNode; path: string; level: number; parent: string | null; position: number; count: number }[] = []
  function append(nodes: ExplorerNode[], level: number, parent: string | null, prefix = '') {
    nodes.forEach((node, i) => { const path = level === 1 ? '' : prefix ? prefix + '/' + node.name : node.name; rows.push({ node, path, level, parent, position: i + 1, count: nodes.length }); if (state.expanded.has(node.id)) append(state.children.get(node.id) ?? [], level + 1, node.id, path) })
  }
  if (state.root) append([state.root], 1, null)
  const focused = rows.some(row => row.node.id === session.focus) ? session.focus : rows[0]?.node.id
  const selected = rows.find(row => row.node.id === focused)
  const openFiles = session.openFileNodes()
  const renameReason = (node?: ExplorerNode) => disabled ? 'Aguarde a operação em andamento ou conclua a edição do layout.' :
    node?.kind !== 'file' ? 'Selecione um arquivo para renomear.' : openFiles.get(node.id)?.unresolved ? 'Confira o vínculo usando Recarregar do disco.' : ''
  function prompt(operation: ExplorerMutation, row = selected) {
    if (!state.root || !row || disabled || submitting.current || (operation === 'rename-file'
      ? !!renameReason(row.node) : row.node.kind !== 'directory')) return
    setName(operation === 'rename-file' ? row.node.name : '')
    const doc = openFiles.get(row.node.id)?.document
    setForm({ root: state.root.id, node: row.node, parent: row.parent, path: row.path || state.root.name, operation, binding: doc ? { id: doc.id, revision: doc.revision } : null })
  }
  const validName = validExplorerBasename(name) && (form?.operation !== 'rename-file' || name.toLowerCase() !== form.node.name.toLowerCase())
  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = session.scroll }, [session])
  function focus(id: string | undefined) { if (id) { session.focus = id; tree.current?.querySelector<HTMLElement>(`[data-explorer-node="${id}"]`)?.focus() } }
  function key(event: KeyboardEvent, index: number) {
    const row = rows[index]!, node = row.node
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); prompt('rename-file', row); return }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'ArrowDown') focus(rows[Math.min(index + 1, rows.length - 1)]?.node.id)
    if (event.key === 'ArrowUp') focus(rows[Math.max(0, index - 1)]?.node.id)
    if (event.key === 'Home') focus(rows[0]?.node.id)
    if (event.key === 'End') focus(rows.at(-1)?.node.id)
    if (event.key === 'ArrowLeft') { if (node.kind === 'directory' && state.expanded.has(node.id)) void session.toggle(node); else focus(row.parent ?? undefined) }
    if (event.key === 'ArrowRight' && node.kind === 'directory') { if (!state.expanded.has(node.id)) void session.toggle(node); else focus(state.children.get(node.id)?.[0]?.id) }
    if (event.key === 'Enter' || event.key === ' ') { if (node.kind === 'directory') void session.toggle(node); else void session.open(node) }
  }
  return <section className="file-explorer" aria-label="Explorador de arquivos" aria-busy={state.busy} onKeyDownCapture={event => {
    if (form && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && event.target instanceof Element && event.target.closest('dialog')) {
      event.preventDefault(); event.stopPropagation()
    }
  }}>
    <header className="explorer-toolbar"><strong title={state.root?.name}>{state.root?.name ?? 'Nenhuma pasta aberta'}</strong>
      <button className="ui-button ui-icon-button" title="Abrir pasta" aria-label="Abrir pasta" disabled={disabled} onClick={() => { void session.select() }}><FolderOpenIcon className="icon" /></button>
      {state.root && <><button className="ui-button ui-icon-button" title="Atualizar árvore" aria-label="Atualizar árvore" disabled={disabled} onClick={() => { void session.refresh() }}><ArrowPathIcon className="icon" /></button><button className="ui-button ui-icon-button" title="Fechar pasta" aria-label="Fechar pasta" disabled={disabled} onClick={() => { void session.release() }}><XMarkIcon className="icon" /></button></>}
    </header>
    {state.root && <div className="explorer-write-actions" role="group" aria-label="Ações do item selecionado">
      <span title={selected?.path || state.root.name}>{selected?.node.name}</span>
      <IconButton literalLabel label="Novo arquivo" disabled={disabled || selected?.node.kind !== 'directory'} onClick={() => prompt('create-file')}><DocumentPlusIcon className="icon" /></IconButton>
      <IconButton literalLabel label="Nova pasta" disabled={disabled || selected?.node.kind !== 'directory'} onClick={() => prompt('create-directory')}><FolderPlusIcon className="icon" /></IconButton>
      <button type="button" className="ui-button" aria-label="Renomear arquivo" aria-keyshortcuts="F2"
        title={renameReason(selected?.node) || 'Renomear arquivo (F2)'} disabled={!!renameReason(selected?.node)} onClick={() => prompt('rename-file')}>Renomear</button>
    </div>}
    {state.root && <div className="explorer-git-status" role="status" title={gitState.error ?? 'Git usa o disco salvo; configuração global ignorada. Selecione a raiz exata de um repositório local comum.'}>
      {gitState.busy ? 'Git: consultando…' : gitState.error ? 'Git: ' + gitState.error : status ? `Git · ${status.branch} · ${status.changes.length ? status.changes.length + ' arquivo(s) com alterações' : 'árvore limpa'}` : 'Git: aguardando consulta'}
      <button className="ui-button" disabled={gitState.busy || disabled} onClick={() => { void git.refresh() }} aria-label="Atualizar Git no Explorador">Atualizar</button>
    </div>}
    {!state.root && <div className="explorer-empty"><p>Escolha uma pasta local para navegar pelos arquivos.</p><button className="ui-button tool-button" disabled={disabled} onClick={() => { void session.select() }}>Abrir pasta</button></div>}
    <div ref={viewport} className="explorer-scroll ui-scrollbar" onScroll={event => { session.scroll = event.currentTarget.scrollTop }}>
      {state.root && <div ref={tree} role="tree" aria-label="Arquivos da pasta">{rows.map(({ node, path, level, position, count }, index) => { const decoration = node.kind === 'directory' ? decorations.folders.get(path) : node.kind === 'file' ? decorations.files.get(path) : undefined; return <div key={node.id}>
        <div role="treeitem" data-explorer-node={node.id} aria-label={node.name} aria-description={decoration?.description} title={node.name + (node.kind === 'blocked' ? ' — item não suportado' : decoration ? ' — ' + decoration.description : '')} aria-level={level} aria-posinset={position} aria-setsize={count}
          aria-expanded={node.kind === 'directory' ? state.expanded.has(node.id) : undefined} aria-selected={state.active === node.id && state.document === editor.document?.id} aria-disabled={node.kind === 'blocked' || disabled}
          tabIndex={focused === node.id ? 0 : -1} className="explorer-row" style={{ paddingLeft: `min(${6 + (level - 1) * 12}px, max(6px, calc(100% - 70px)))` }} onFocus={() => { session.focus = node.id; renderFocus(value => value + 1) }}
          onKeyDown={event => key(event, index)} onClick={() => { focus(node.id); if (node.kind === 'directory') void session.toggle(node); else void session.open(node) }}>
          {node.kind === 'directory' ? <><ChevronRightIcon className={'explorer-chevron ' + (state.expanded.has(node.id) ? 'is-open' : '')} /><FolderIcon className="explorer-node-icon" /></> : <><span className="explorer-chevron" /><DocumentIcon className="explorer-node-icon" /></>}<span className="explorer-name">{node.name}</span>
          {decoration && <span className="explorer-git-badge" aria-label={decoration.description} title={decoration.description}>{decoration.badge}</span>}
          {node.kind === 'file' && <button className="ui-button explorer-row-rename" type="button" tabIndex={-1} title={renameReason(node) || 'Renomear ' + node.name} aria-label={'Renomear ' + node.name}
            disabled={!!renameReason(node)} onKeyDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); focus(node.id); prompt('rename-file', rows[index]) }}><PencilSquareIcon className="icon" /></button>}
        </div>
        {state.expanded.has(node.id) && state.errors.has(node.id) && <p className="explorer-inline-error" role="alert">{state.errors.get(node.id)} <button className="ui-button" disabled={disabled} onClick={() => { void session.refresh() }}>Tentar novamente</button></p>}
        {node.kind === 'directory' && state.expanded.has(node.id) && state.children.get(node.id)?.length === 0 && <p className="explorer-directory-empty">Pasta vazia</p>}
      </div> })}</div>}
    </div>
    <div className="explorer-feedback" role="status">{state.busy ? 'Carregando…' : state.error}</div>
    {state.mutationNotice && <p className="explorer-feedback" role="status" data-explorer-write-feedback>{state.mutationNotice}</p>}
    {form && form.root === state.root?.id && <Dialog title={form.operation === 'create-file' ? 'Criar arquivo' : form.operation === 'create-directory' ? 'Criar pasta' : 'Renomear arquivo'}
      closeDisabled={submitting.current} close={() => { if (!submitting.current) setForm(null) }}>
      <form className="explorer-name-form" onSubmit={async event => {
        event.preventDefault()
        if (!validName || disabled || submitting.current) return
        submitting.current = true
        try { await session.mutate(form.operation, form.root, form.node, form.parent, name, form.binding) }
        finally { submitting.current = false; setForm(null) }
      }}>
        <p>{form.operation === 'rename-file' ? 'Arquivo: ' : 'Pasta de destino: '}{form.path}</p>
        <label>{form.operation === 'rename-file' ? 'Novo nome' : form.operation === 'create-file' ? 'Nome do arquivo' : 'Nome da pasta'}
          <input className="ui-input" required data-initial-focus autoComplete="off" spellCheck={false} value={name}
            disabled={submitting.current} onChange={event => setName(event.target.value)} /></label>
        {name && !validName && <p role="status">{form.operation === 'rename-file' && name.toLowerCase() === form.node.name.toLowerCase() ? 'Escolha outro nome. Alterar apenas maiúsculas e minúsculas não é permitido.' : 'Informe um único nome de arquivo ou pasta permitido.'}</p>}
        <footer className="workspace-dialog-actions"><button type="button" className="ui-button workspace-secondary" disabled={submitting.current} onClick={() => setForm(null)}>Cancelar</button>
          <button className="ui-button workspace-primary" disabled={disabled || !validName}>{form.operation === 'rename-file' ? 'Renomear' : 'Criar'}</button></footer>
      </form></Dialog>}
  </section>
}
