import { Terminal } from '@xterm/xterm'
import { emptyTerminal, TERMINAL_INPUT_LIMIT, TERMINAL_OUTPUT_LIMIT, TERMINAL_PAGE_LIMIT } from '../../../shared/terminal.ts'
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
  private reading: Promise<void> | null = null
  private discover = true
  private retryDiscovery = true
  private drainPending = false
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
  private cancelTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null }
  private scheduleRead(delay: number) {
    this.cancelTimer()
    if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; this.poll() }, delay)
  }
  private get live() { return ['starting', 'running', 'closing'].includes(this.state.native.phase) }
  connect() {
    this.stopped = false; this.retryDiscovery = true; this.cancelTimer()
    // Effect replay can reuse an initial discovery already in flight.
    if (!this.reading || this.state.native.id !== null) this.discover = true
    this.poll()
  }
  dispose() {
    this.stopped = true; this.cancelTimer()
    // React development effect replay reconnects in the same turn. Final teardown still disposes.
    queueMicrotask(() => { if (this.stopped) { this.emulator?.dispose(); this.element?.remove(); this.emulator = null; this.element = null; this.cursor = 0 } })
  }
  private accept(result: TerminalResult): result is Extract<TerminalResult, { ok: true }> {
    if (!result.ok) { this.update({ feedback: result.error }); return false }
    const native = result.value.state, previous = this.state.native
    const newGeneration = native.id !== previous.id
    if (newGeneration) { this.cursor = 0; this.pendingInput = ''; this.emulator?.reset(); this.update({ feedback: null }) }
    this.update({ native })
    if (this.emulator) this.emulator.options.disableStdin = native.phase !== 'running'
    // Startup can fit the emulator before the native PTY can be resized.
    if (native.phase === 'running' && (newGeneration || previous.phase !== 'running')) void this.fit()
    return true
  }
  private async readPage(): Promise<boolean> {
    const previous = this.state.native.id, after = this.cursor
    const id = this.discover ? null : previous
    this.discover = false
    try {
      const result = await this.bridge.read(id, after)
      if (this.stopped) return false
      if (!this.accept(result)) { this.discover = true; return false }
      // A discovery may have asked for an offset belonging to the old PTY.
      if (previous !== result.value.state.id && after > 0) { this.drainPending = true; return true }
      if (result.value.dropped) { this.emulator?.reset(); this.feedback('O limite de saída foi atingido; o trecho mais antigo foi descartado.') }
      const { data, next } = result.value
      if (data) {
        const emulator = this.terminal()
        await new Promise<void>(resolve => emulator.write(data, resolve))
        if (emulator !== this.emulator) return false
      }
      this.cursor = next; this.drainPending = data.length > 0
      return true
    } catch { this.feedback('A comunicação com o Terminal falhou.'); this.discover = true; return false }
  }
  private poll() {
    if (this.stopped || this.reading || this.actionBusy) return
    this.reading = this.readPage().then(ok => {
      this.reading = null
      if (this.stopped || this.actionBusy) return
      if (!this.live && !this.drainPending) {
        // One retry can discover an existing PTY after a failed handshake. A
        // persistently unavailable bridge waits for an explicit reconnect/start.
        if (!this.discover || (!ok && !this.retryDiscovery)) return
        this.retryDiscovery = false
      }
      this.scheduleRead(ok && this.drainPending ? 0 : 60)
    })
  }
  private async action(operation: () => Promise<TerminalResult>) {
    if (this.stopped || this.actionBusy) return
    this.actionBusy = true; this.cancelTimer()
    try {
      await this.reading
      // A restart replaces the prior ring. An exited PTY has at most one retained
      // ring to drain, including the final empty read and a split surrogate pair.
      const maxPages = Math.ceil(TERMINAL_OUTPUT_LIMIT / (TERMINAL_PAGE_LIMIT - 1)) + 1
      for (let page = 0; !this.stopped && !this.live && this.drainPending; page++) {
        if (page >= maxPages || !await this.readPage()) return
      }
      if (this.stopped) return
      const result = await operation()
      if (!this.stopped && this.accept(result)) this.drainPending = true
    } catch { this.feedback('A comunicação com o Terminal falhou.') }
    finally { this.actionBusy = false; this.discover = true; this.retryDiscovery = true; this.scheduleRead(0) }
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
    if (this.stopped) return
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
      try {
        const result = await this.bridge.resize(native.id, cols, rows)
        if (!result.ok) this.feedback(result.error)
        else {
          const current = this.state.native, confirmed = result.value.state
          // Apply only the size acknowledgement before processing a coalesced fit.
          if (!this.stopped && current.phase === 'running' && current.id === native.id && confirmed.id === native.id)
            this.update({ native: { ...current, cols: confirmed.cols, rows: confirmed.rows } })
        }
      }
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
