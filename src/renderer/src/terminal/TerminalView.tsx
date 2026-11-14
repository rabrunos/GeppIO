import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { terminalLabel } from '../../../shared/terminal.ts'
import type { TerminalSession } from './session.ts'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

export function TerminalView({ session, theme, focusRequest = 0 }: { session: TerminalSession; theme: 'light' | 'dark'; focusRequest?: number }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot), host = useRef<HTMLDivElement>(null)
  const phase = state.native.phase, running = phase === 'running'
  useLayoutEffect(() => { if (host.current) return session.attach(host.current, theme) }, [session])
  useEffect(() => { session.theme(theme) }, [session, theme])
  useEffect(() => {
    const element = host.current; if (!element) return
    const observer = new ResizeObserver(() => { void session.fit() }); observer.observe(element)
    void document.fonts.ready.then(() => session.fit())
    return () => observer.disconnect()
  }, [session])
  useEffect(() => { if (focusRequest || running) session.focus() }, [session, focusRequest, running])
  return <section className="terminal-view" aria-label="Terminal interativo" data-terminal-id={state.native.id} data-terminal-phase={phase}>
    <div className="terminal-toolbar">
      <strong title={state.native.cwd ? 'Diretório inicial: ' + state.native.cwd : undefined}>{state.native.shell || 'Terminal'}</strong>
      <span className="terminal-phase" title={terminalLabel(state.native)}>{terminalLabel(state.native)}</span>
      <button className="ui-button tool-button" disabled={['starting', 'running', 'closing'].includes(phase)} onClick={() => { void session.start() }}>{phase === 'none' ? 'Iniciar terminal' : 'Reiniciar terminal'}</button>
      <button className="ui-button tool-button" title="Copiar seleção (Ctrl+Shift+C). Cole com Ctrl+V." onClick={session.copy}>Copiar</button>
      <button className="ui-button tool-button" disabled={!running} title="Interromper (Ctrl+C)" onClick={() => { session.input('\u0003'); session.focus() }}>Interromper</button>
      <button className="ui-button tool-button" disabled={!['running', 'starting'].includes(phase)} onClick={session.close}>Encerrar</button>
    </div>
    <div className="terminal-host" ref={host} />
    {(state.native.error || state.feedback) && <p className="terminal-feedback" role="status">{state.native.error ?? state.feedback}</p>}
  </section>
}
