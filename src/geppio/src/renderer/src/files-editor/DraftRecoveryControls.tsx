import { useRef, useState, useSyncExternalStore } from 'react'
import type { EditorRecovery } from './draft-recovery.ts'
import { Popover } from '../workbench/Primitives.tsx'

export function DraftRecoveryNotice({ recovery, blocked, open }: { recovery: EditorRecovery; blocked: boolean; open: () => void }) {
  const { status } = useSyncExternalStore(recovery.subscribe, recovery.view)
  if (!status?.choices.length) return null
  return <button className="ui-button tool-button" disabled={blocked} title={blocked ? 'Conclua a edição do layout.' : 'Consultar cópias no GeppIO Code'}
    onClick={open}>Ver rascunhos no Code ({status.choices.length})</button>
}

export function DraftRecoveryControls({ recovery, blocked, full }: { recovery: EditorRecovery; blocked: boolean; full: boolean }) {
  const { status, busy, phase, message } = useSyncExternalStore(recovery.subscribe, recovery.view)
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null)
  const count = status?.choices.length ?? 0, disabled = blocked || busy || !status
  const label = phase === 'loading' ? 'Carregando cópias' : phase === 'failed' ? 'Falha na cópia local' :
    !status?.enabled ? 'Recuperação desativada' : phase === 'pending' ? 'Cópia pendente' : count ? `${count} para recuperar` :
      phase === 'confirmed' ? 'Cópia confirmada' : 'Recuperação ativa'
  return <><button ref={anchor} className="ui-button" aria-expanded={open} data-draft-state={phase} onClick={() => setOpen(!open)}>
    {label}{status?.enabled ? ' · texto simples' : ''}</button>
    {open && <Popover bare title="Cópias de rascunhos" open close={() => setOpen(false)} anchor={anchor} className="workspace-popover workspace-project-menu">
      <p>O editor guarda cópias em texto simples neste perfil. Uma interrupção pode perder as últimas teclas. Desfazer e processos valem só para a sessão atual.</p>
      {message && <p role="status">{message}</p>}
      {count > 0 && <p>Abra a cópia como documento sem destino. Salvar como permite escolher o arquivo.</p>}
      {status?.choices.map(item => <button key={item.key} className="ui-button" disabled={disabled || full}
        title={full ? 'Feche uma aba para recuperar.' : disabled ? 'Aguarde a operação em andamento.' : item.name}
        onClick={() => { void recovery.restore(item.key) }}>Recuperar {item.name}</button>)}
      {!!count && <button className="ui-button" onClick={() => setOpen(false)}>Deixar para depois</button>}
      <button disabled={disabled} title={disabled ? 'Aguarde a leitura ou operação em andamento.' : undefined} className="ui-button" onClick={() => void recovery.configure('toggle')}>{status?.enabled ? 'Desativar recuperação' : 'Ativar recuperação'}</button>
      <button disabled={disabled} title={disabled ? 'Aguarde a leitura ou operação em andamento.' : undefined} className="ui-button" onClick={() => void recovery.configure('clear')}>Limpar cópias locais</button>
      {phase === 'failed' && <button className="ui-button" disabled={busy || blocked} onClick={() => void recovery.retry()}>Conferir cópias</button>}
    </Popover>}</>
}
