import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowPathIcon, ChevronRightIcon, DocumentIcon, FolderIcon, FolderOpenIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { ExplorerNode } from '../../../shared/explorer.ts'
import type { ExplorerSession } from './explorer-session.ts'
import './explorer.css'

export function Explorer({ session }: { session: ExplorerSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), editor = useSyncExternalStore(session.editor.subscribe, session.editor.snapshot)
  const viewport = useRef<HTMLDivElement>(null), tree = useRef<HTMLDivElement>(null)
  const [, renderFocus] = useState(0)
  const disabled = state.busy || editor.busy || session.locked
  const rows: { node: ExplorerNode; level: number; parent: string | null; position: number; count: number }[] = []
  function append(nodes: ExplorerNode[], level: number, parent: string | null) {
    nodes.forEach((node, i) => { rows.push({ node, level, parent, position: i + 1, count: nodes.length }); if (state.expanded.has(node.id)) append(state.children.get(node.id) ?? [], level + 1, node.id) })
  }
  if (state.root) append([state.root], 1, null)
  const focused = rows.some(row => row.node.id === session.focus) ? session.focus : rows[0]?.node.id
  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = session.scroll }, [session])
  function focus(id: string | undefined) { if (id) { session.focus = id; tree.current?.querySelector<HTMLElement>(`[data-explorer-node="${id}"]`)?.focus() } }
  function key(event: KeyboardEvent, index: number) {
    const row = rows[index]!, node = row.node
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
  return <section className="file-explorer" aria-label="Explorador de arquivos" aria-busy={state.busy}>
    <header className="explorer-toolbar"><strong title={state.root?.name}>{state.root?.name ?? 'Nenhuma pasta aberta'}</strong>
      <button className="ui-button ui-icon-button" title="Abrir pasta" aria-label="Abrir pasta" disabled={disabled} onClick={() => { void session.select() }}><FolderOpenIcon className="icon" /></button>
      {state.root && <><button className="ui-button ui-icon-button" title="Atualizar árvore" aria-label="Atualizar árvore" disabled={disabled} onClick={() => { void session.refresh() }}><ArrowPathIcon className="icon" /></button><button className="ui-button ui-icon-button" title="Fechar pasta" aria-label="Fechar pasta" disabled={disabled} onClick={() => { void session.release() }}><XMarkIcon className="icon" /></button></>}
    </header>
    {!state.root && <div className="explorer-empty"><p>Escolha uma pasta local para navegar pelos arquivos.</p><button className="ui-button tool-button" disabled={disabled} onClick={() => { void session.select() }}>Abrir pasta</button></div>}
    <div ref={viewport} className="explorer-scroll ui-scrollbar" onScroll={event => { session.scroll = event.currentTarget.scrollTop }}>
      {state.root && <div ref={tree} role="tree" aria-label="Arquivos da pasta">{rows.map(({ node, level, position, count }, index) => <div key={node.id}>
        <div role="treeitem" data-explorer-node={node.id} aria-label={node.name} title={node.name + (node.kind === 'blocked' ? ' — item não suportado' : '')} aria-level={level} aria-posinset={position} aria-setsize={count}
          aria-expanded={node.kind === 'directory' ? state.expanded.has(node.id) : undefined} aria-selected={state.active === node.id && state.document === editor.document?.id} aria-disabled={node.kind === 'blocked' || disabled}
          tabIndex={focused === node.id ? 0 : -1} className="explorer-row" style={{ paddingLeft: `min(${6 + (level - 1) * 12}px, max(6px, calc(100% - 70px)))` }} onFocus={() => { session.focus = node.id; renderFocus(value => value + 1) }}
          onKeyDown={event => key(event, index)} onClick={() => { focus(node.id); if (node.kind === 'directory') void session.toggle(node); else void session.open(node) }}>
          {node.kind === 'directory' ? <><ChevronRightIcon className={'explorer-chevron ' + (state.expanded.has(node.id) ? 'is-open' : '')} /><FolderIcon className="explorer-node-icon" /></> : <><span className="explorer-chevron" /><DocumentIcon className="explorer-node-icon" /></>}<span className="explorer-name">{node.name}</span>
        </div>
        {state.expanded.has(node.id) && state.errors.has(node.id) && <p className="explorer-inline-error" role="alert">{state.errors.get(node.id)} <button className="ui-button" disabled={disabled} onClick={() => { void session.refresh() }}>Tentar novamente</button></p>}
        {node.kind === 'directory' && state.expanded.has(node.id) && state.children.get(node.id)?.length === 0 && <p className="explorer-directory-empty">Pasta vazia</p>}
      </div>)}</div>}
    </div>
    <div className="explorer-feedback" role="status">{state.busy ? 'Carregando…' : state.error}</div>
  </section>
}
