import { Terminal } from '@xterm/xterm'
import { emptyTerminal, TERMINAL_INPUT_LIMIT } from '../../../shared/terminal.ts'
import type { TerminalBridge, TerminalResult, TerminalState } from '../../../shared/terminal.ts'

export interface TerminalViewState { native: TerminalState; feedback: string | null }
/** Owns one emulator, DOM and bounded write pipeline even with no mounted presentation. */
export class TerminalSession {
  private state: TerminalViewState = { native: emptyTerminal(), feedback: null }
  private listeners = new Set<() => void>()
  private emulator: Terminal | null = null
  private element: HTMLDivElement | null = null
  private cursor = 0
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingInput = ''
  private sending = false
  private actionBusy = false
  private reading = false
  private fitting = false
  private fitAgain = false
  constructor(private bridge: TerminalBridge) {}
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<TerminalViewState>) {
    const next = { ...this.state, ...patch }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next; for (const listener of this.listeners) listener()
  }
  feedback = (feedback: string) => this.update({ feedback })
  private terminal() {
    if (!this.emulator) {
      this.emulator = new Terminal({ fontSize: 13, fontFamily: 'Consolas, monospace', scrollback: 2000, allowProposedApi: false, allowTransparency: false, disableStdin: true })
      this.emulator.onData(data => this.input(data))
      // Clipboard escape sequences must not read/write the owner's clipboard.
      this.emulator.parser.registerOscHandler(52, () => true)
      this.emulator.attachCustomKeyEventHandler(event => {
        if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyC') { this.copy(); return false }
        return true
      })
    }
    return this.emulator
  }
  connect() { this.stopped = false; if (this.timer) clearTimeout(this.timer); void this.poll() }
  dispose() {
    this.stopped = true; if (this.timer) clearTimeout(this.timer)
    // React development effect replay reconnects in the same turn. Final teardown still disposes.
    queueMicrotask(() => { if (this.stopped) { this.emulator?.dispose(); this.element?.remove(); this.emulator = null; this.element = null } })
  }
  private accept(result: TerminalResult) {
    if (!result.ok) { this.update({ feedback: result.error }); return false }
    const native = result.value.state
    if (native.id !== this.state.native.id) { this.cursor = 0; this.pendingInput = ''; this.emulator?.reset(); this.update({ feedback: null }) }
    this.update({ native })
    if (this.emulator) this.emulator.options.disableStdin = native.phase !== 'running'
    return true
  }
  private async poll() {
    if (this.stopped || this.reading) return
    if (this.actionBusy) { this.timer = setTimeout(() => { void this.poll() }, 60); return }
    this.reading = true
    let more = false
    try {
      const result = await this.bridge.read(this.state.native.id, this.cursor)
      if (this.stopped) return
      if (this.accept(result) && result.ok) {
        if (result.value.dropped) { this.emulator?.reset(); this.feedback('O limite de saída foi atingido; o trecho mais antigo foi descartado.') }
        const { data, next } = result.value
        if (data) await new Promise<void>(resolve => this.terminal().write(data, resolve))
        this.cursor = next; more = data.length > 0
      }
    } catch { this.feedback('A comunicação com o Terminal falhou.') }
    finally {
      this.reading = false
      if (!this.stopped) this.timer = setTimeout(() => { void this.poll() }, more ? 0 : 60)
    }
  }
  private async action(operation: () => Promise<TerminalResult>) {
    if (this.actionBusy) return
    this.actionBusy = true
    try {
      // Drain the previous generation before reset/restart; never replay stale output afterward.
      while (this.reading && !this.stopped) await new Promise(resolve => setTimeout(resolve, 10))
      if (!this.stopped) this.accept(await operation())
    } catch { this.feedback('A comunicação com o Terminal falhou.') }
    finally { this.actionBusy = false }
  }
  start = async () => { await this.action(() => this.bridge.start()); this.focus() }
  close = () => { const id = this.state.native.id; if (id) void this.action(() => this.bridge.close(id)) }
  input(data: string) {
    if (this.state.native.phase !== 'running') return
    if (data.length + this.pendingInput.length > TERMINAL_INPUT_LIMIT) { this.feedback('Entrada limitada a 8192 caracteres por vez. Cole em partes menores.'); return }
    this.pendingInput += data
    void this.flushInput()
  }
  private async flushInput() {
    if (this.sending) return
    this.sending = true
    try {
      while (this.pendingInput && this.state.native.id && this.state.native.phase === 'running') {
        const data = this.pendingInput, id = this.state.native.id; this.pendingInput = ''
        const result = await this.bridge.input(id, data)
        if (!result.ok) { this.feedback(result.error); this.pendingInput = ''; break }
      }
    } catch { this.pendingInput = ''; this.feedback('Não foi possível enviar a entrada ao Terminal.') }
    finally { this.sending = false }
  }
  attach(target: HTMLDivElement, theme: 'light' | 'dark') {
    const terminal = this.terminal()
    if (!this.element) { this.element = document.createElement('div'); this.element.className = 'terminal-emulator'; target.append(this.element); terminal.open(this.element) }
    else target.append(this.element)
    this.theme(theme)
    this.fit()
    return () => { if (this.element?.parentElement === target) this.element.remove() }
  }
  theme(theme: 'light' | 'dark') {
    if (this.emulator) this.emulator.options.theme = theme === 'light' ? { background: '#ffffff', foreground: '#202838', cursor: '#202838', selectionBackground: '#709ad866' } : { background: '#141922', foreground: '#e2e8f0', cursor: '#e2e8f0', selectionBackground: '#709ad866' }
  }
  fit = async () => {
    if (this.fitting) { this.fitAgain = true; return }
    const terminal = this.emulator, parent = this.element?.parentElement, native = this.state.native
    if (!terminal || !parent || !parent.getClientRects().length || parent.closest('[inert]')) return
    const screen = this.element!.querySelector<HTMLElement>('.xterm-screen'), box = parent.getBoundingClientRect(), cell = screen?.getBoundingClientRect()
    if (!cell || cell.width <= 0 || cell.height <= 0 || box.width < 20 || box.height < 10) return
    const cols = Math.max(2, Math.min(500, Math.floor((box.width - 16) / (cell.width / terminal.cols))))
    const rows = Math.max(1, Math.min(200, Math.floor(box.height / (cell.height / terminal.rows))))
    terminal.resize(cols, rows)
    if (native.id && native.phase === 'running' && (cols !== native.cols || rows !== native.rows)) {
      this.fitting = true
      try { const result = await this.bridge.resize(native.id, cols, rows); if (!result.ok) this.feedback(result.error) }
      catch { this.feedback('Não foi possível redimensionar o Terminal.') }
      finally { this.fitting = false; if (this.fitAgain) { this.fitAgain = false; void this.fit() } }
    }
  }
  focus = () => { this.emulator?.focus(); void this.fit() }
  copy = () => {
    const selection = this.emulator?.getSelection()
    if (!selection) return
    // Native user copy event works under the existing denied browser-permission policy.
    // Keep the text local to this synchronous gesture; never grant general clipboard access.
    const copy = (event: ClipboardEvent) => { event.clipboardData?.setData('text/plain', selection); event.preventDefault() }
    document.addEventListener('copy', copy)
    let copied: boolean
    try { copied = document.execCommand('copy') } catch { copied = false } finally { document.removeEventListener('copy', copy) }
    if (copied) this.update({ feedback: null })
    else this.feedback('Não foi possível copiar a seleção. Tente Ctrl+Shift+C com o Terminal em foco.')
  }
}
