import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { GitSession } from './session.ts'
import type { GitChange } from '../../../shared/git.ts'
import { createGitDiff } from '../files-editor/monaco.ts'
import { Dialog } from '../workbench/Primitives.tsx'
import './git.css'

const labels: Record<string, string> = { M: 'Modificado', A: 'Adicionado', D: 'Excluído', R: 'Renomeado', C: 'Copiado', U: 'Conflito', T: 'Tipo alterado' }
export type CompareGit = (id: string, trigger: HTMLButtonElement) => void
export function GitChanges({ session, compare, headerAction }: { session: GitSession; compare: CompareGit; headerAction?: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const changes = state.status?.changes ?? []
  const group = (title: string, entries: GitChange[], layer: 'index' | 'working') => entries.length > 0 && <section className="git-group"><h3>{title} ({entries.length})</h3><ul>{entries.map(change => {
    const operation = layer === 'index' ? 'unstage' : 'stage', label = operation === 'stage' ? 'Preparar' : 'Despreparar'
    return <li key={change.id}><button className="ui-button git-file" disabled={state.busy || session.locked} onClick={event => compare(change.id, event.currentTarget)} title={(change.previous ? change.previous + ' → ' : '') + change.name}><span>{change.name}</span><small>{change.conflict ? 'Conflito' : change.untracked ? 'Novo' : labels[change[layer]] ?? change[layer]}</small></button><button className="ui-button git-action" aria-label={label + ' ' + change.name} title={change.actionReason ?? (operation === 'stage' ? 'Preparar o arquivo salvo no disco; não salva o rascunho.' : 'Retirar este arquivo do índice; mantém o disco.')} disabled={state.busy || session.locked || !change[operation]} onClick={() => { void session.mutate(operation, change.id) }}>{label}</button></li>
  })}</ul></section>
  return <section className="git-changes" aria-label="Alterações Git" data-git-root={state.root ?? ''}>
    <header><strong title={state.status?.name}>{state.status?.name ?? 'Git'}</strong><button className="ui-button tool-button" disabled={!state.root || state.busy || session.locked} onClick={() => { void session.refresh() }}>Atualizar Git</button>{headerAction}</header>
    {!state.root && <p>Abra uma pasta no Explorador para consultar sua raiz Git.</p>}
    {state.busy && <p role="status">Consultando Git…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.status && <><p className="git-branch">{state.status.branch}</p><p className="git-policy">Preparar usa o arquivo salvo no disco, sem salvar rascunhos. Configuração global ignorada; filtros não suportados. Comparação: HEAD → disco.</p><div className="git-list ui-scrollbar">
      {changes.length === 0 && <p>Árvore de trabalho limpa.</p>}
      {group('Conflitos', changes.filter(c => c.conflict), 'working')}
      {group('Preparadas (índice)', changes.filter(c => !c.conflict && !c.untracked && c.index !== ' '), 'index')}
      {group('Não preparadas', changes.filter(c => !c.conflict && !c.untracked && c.working !== ' '), 'working')}
      {group('Não rastreados', changes.filter(c => c.untracked), 'working')}
    </div></>}
  </section>
}
export function GitComparisonDialog({ session, close }: { session: GitSession; close(): void }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!state.comparison) return
    // The app's document shortcut must not save a hidden draft while this read-only
    // modal owns focus, including its heading/close button rather than only Monaco.
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [state.comparison])
  useLayoutEffect(() => {
    if (host.current && state.comparison) return createGitDiff(host.current, state.comparison)
  }, [state.comparison])
  return state.comparison && <Dialog title={'Comparação Git · ' + state.comparison.name} close={close} className="git-dialog">
    <p className="git-basis">{state.comparison.basis} Somente leitura. EOL/BOM podem ser projetados pelo Monaco.</p>
    <div ref={host} className="git-diff" aria-label="Comparação Git somente leitura" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation() } }} />
  </Dialog>
}
