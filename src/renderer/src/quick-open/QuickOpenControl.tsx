import { useEffect, useRef, useSyncExternalStore } from 'react'
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { QUICK_OPEN_LIMITS } from '../../../shared/quick-open.ts'
import type { MonacoHost } from '../files-editor/monaco.ts'
import { Dialog, IconButton } from '../workbench/Primitives.tsx'
import type { QuickOpenSession } from './session.ts'
import './quick-open.css'

export const QUICK_OPEN_LABEL = 'Abrir arquivo do projeto...'
export function QuickOpenControl({ session, blocked, interactiveBusy }: { session: QuickOpenSession; blocked(): boolean; interactiveBusy: boolean }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const guard = useRef(blocked); guard.current = blocked
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null)
  const trigger = useRef<HTMLElement | null>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || !event.ctrlKey || event.metaKey || event.altKey ||
          event.shiftKey || event.key.toLowerCase() !== 'p' || guard.current() || document.querySelector('dialog:modal, [popover]:popover-open')) return
      const target = event.target
      if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest('.terminal-view, .xterm, .monaco-editor, input, textarea, select, [role="textbox"], [role="dialog"]')) return
      if (session.show()) { trigger.current = target; event.preventDefault() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); session.detach() }
  }, [session])
  function dismiss() {
    if (session.snapshot().opening) return
    session.dismiss()
    const opener = trigger.current
    requestAnimationFrame(() => {
      if (!session.snapshot().visible && !document.querySelector('dialog:modal')) {
        const destination = opener?.isConnected && opener !== document.body ? opener : button.current
        destination?.focus()
      }
    })
  }
  async function open(id: string) {
    if (!await session.open(id)) return
    requestAnimationFrame(() => {
      if (!session.snapshot().visible && !document.querySelector('dialog:modal')) document.querySelector<MonacoHost>('.direct-file-editor .monaco-host')?.monacoEditor?.focus()
    })
  }
  const page = state.page
  const count = page ? page.items.length + (page.items.length === 1 ? ' arquivo' : ' arquivos') : ''
  return <><IconButton ref={button} label={QUICK_OPEN_LABEL} literalLabel className="sidebar-rail-button" aria-haspopup="dialog"
    disabled={!state.root || state.busy || interactiveBusy || session.locked} onClick={event => {
      if (!guard.current() && !document.querySelector('dialog:modal') && session.show()) trigger.current = event.currentTarget
    }}><DocumentMagnifyingGlassIcon className="icon" /></IconButton>
    {state.visible && <Dialog title="Abrir arquivo do projeto" className="quick-open-dialog" closeDisabled={state.opening} close={dismiss}>
      <label className="quick-open-field">Nome ou caminho relativo<input ref={input} data-initial-focus className="ui-input" autoComplete="off" spellCheck={false}
        value={state.query} maxLength={QUICK_OPEN_LIMITS.query} disabled={state.busy} onChange={event => session.setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || !page?.items.length || state.busy) return
          if (event.key === 'Enter') { event.preventDefault(); void open(page.items[0]!.id) }
          if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector('button')?.focus() }
        }} /></label>
      <p role="status">{state.opening ? 'Abrindo arquivo…' : state.error ?? (!state.query ? 'Digite parte do nome ou do caminho do arquivo.' : !page || page.status === 'running' ? 'Procurando arquivos…' :
        page.status === 'failed' ? 'Não foi possível concluir a listagem.' : page.status === 'partial' ? 'Listagem parcial · ' + count :
        page.items.length ? count : 'Nenhum arquivo encontrado.')}
        {page?.truncated && ' · Exibindo os primeiros ' + QUICK_OPEN_LIMITS.results + ' resultados.'}</p>
      <ul ref={list} aria-label="Arquivos encontrados" className="quick-open-results ui-scrollbar" onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const buttons = [...(list.current?.querySelectorAll('button') ?? [])], i = buttons.indexOf(event.target as HTMLButtonElement)
        if (i < 0) return
        event.preventDefault()
        if (event.key === 'ArrowUp' && i === 0) input.current?.focus()
        else buttons[Math.min(buttons.length - 1, i + (event.key === 'ArrowUp' ? -1 : 1))]?.focus()
      }}>{page?.items.map(item => <li key={item.id}><button type="button" className="ui-button workspace-command" disabled={state.busy}
        onClick={() => { void open(item.id) }}>{item.file}</button></li>)}</ul>
    </Dialog>}</>
}
