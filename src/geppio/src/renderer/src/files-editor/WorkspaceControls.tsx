import { useRef, useState, useSyncExternalStore } from 'react'
import type { ExplorerSession } from './explorer-session.ts'
import { Popover } from '../workbench/Primitives.tsx'
import './workspace.css'

/** Real filesystem project actions, separate from workbench display metadata. */
export function WorkspaceControls({ session, editing, edited }: { session: ExplorerSession; editing: boolean; edited(): void }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), editor = useSyncExternalStore(session.editor.subscribe, session.editor.snapshot)
  const anchor = useRef<HTMLButtonElement>(null), [openMenu, setOpenMenu] = useState(false)
  const workspace = state.workspace, disabled = editing || state.busy || editor.busy
  const done = () => { setOpenMenu(false); edited() }
  const standalone = async () => { if (await session.workspaceAction('standalone')) done() }
  const restore = async () => { if (await session.workspaceAction('restore')) done() }
  const open = async () => { const root = session.snapshot().root?.id; await session.select(); if (session.snapshot().root?.id !== root) done() }
  return <div className="workspace-controls" aria-busy={state.busy || editor.busy} data-workspace-root={state.root?.id ?? ''}>
    <button ref={anchor} className="ui-button tool-button" aria-label="Projeto local" aria-expanded={openMenu} aria-haspopup="dialog" title={workspace?.recovery?.name} onClick={() => setOpenMenu(!openMenu)}>{state.root ? 'Projeto · ' + state.root.name : workspace?.recovery ? 'Retomar · ' + workspace.recovery.name : 'Projeto / arquivo avulso'}</button>
    <Popover title="Projeto local e recuperação" open={openMenu} close={() => setOpenMenu(false)} anchor={anchor} className="workspace-session-popover">
    <section aria-label="Projeto local e recuperação" className="workspace-actions">
      <strong>{state.root?.name ?? 'Sem projeto aberto'}</strong>
      <button className="ui-button tool-button" disabled={disabled} onClick={() => { void open() }}>{state.root ? 'Trocar projeto' : 'Abrir projeto'}</button>
      {state.root && <button className="ui-button tool-button" disabled={disabled} onClick={() => { void session.release() }}>Fechar projeto</button>}
      <button className="ui-button tool-button" disabled={disabled} onClick={() => { void standalone() }}>Abrir arquivo avulso</button>
      <p>Trocar ou fechar projeto mantém as abas e o Terminal abertos. Salve os rascunhos antes de sair.</p>
      <label><input type="checkbox" checked={workspace?.remember ?? true} disabled={disabled || !workspace} onChange={event => { void session.workspaceAction(event.currentTarget.checked) }} /> Lembrar projeto e abas salvas</label>
      <p>A lembrança do projeto guarda a pasta, os nomes e a visualização. Consulte as cópias locais de rascunhos no editor.</p>
      {workspace?.recovery && !state.root && <div className="workspace-recovery">
        <span>Último projeto: {workspace.recovery.name} · {workspace.recovery.tabs} aba(s)</span>
        {!!workspace.recovery.unsaved && <p>Havia rascunhos não salvos. Consulte as cópias no editor. Restaurar o projeto abre os arquivos do disco.</p>}
        <button className="ui-button tool-button" disabled={disabled || !!editor.tabs.length} onClick={() => { void restore() }}>Restaurar projeto anterior</button>
        {!!editor.tabs.length && <p>A recuperação não substitui os arquivos já abertos. Abra uma pasta explicitamente para continuar com essas abas.</p>}
      </div>}
      {(workspace?.recovery || workspace?.error || workspace?.remember === false) && <button className="ui-button tool-button" disabled={disabled} onClick={() => { void session.workspaceAction('forget') }}>Esquecer recuperação local</button>}
      {(state.error || workspace?.error || workspace?.notice) && <p role="status">{state.error ?? workspace?.error ?? workspace?.notice}</p>}
    </section>
    </Popover>
  </div>
}
