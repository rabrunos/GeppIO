/** Fixed first-party operations. Deliberately absent from the plugin/Worker SDK. */
export const TERMINAL_INPUT_LIMIT = 8192
export const TERMINAL_OUTPUT_LIMIT = 262144
export const TERMINAL_PAGE_LIMIT = 32768
export type TerminalPhase = 'none' | 'starting' | 'running' | 'closing' | 'closed' | 'exited' | 'failed'
export interface TerminalState { id: string | null; phase: TerminalPhase; shell: string; cwd: string; exitCode: number | null; error: string | null; cols: number; rows: number }
export interface TerminalRead { state: TerminalState; data: string; next: number; dropped: boolean }
export type TerminalResult = { ok: true; value: TerminalRead } | { ok: false; error: string }
export interface TerminalBridge {
  read(id: string | null, after: number): Promise<TerminalResult>
  start(): Promise<TerminalResult>
  input(id: string, data: string): Promise<TerminalResult>
  resize(id: string, cols: number, rows: number): Promise<TerminalResult>
  close(id: string): Promise<TerminalResult>
}
export const emptyTerminal = (): TerminalState => ({ id: null, phase: 'none', shell: '', cwd: '', exitCode: null, error: null, cols: 80, rows: 24 })
const token = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
export const validTerminalSize = (cols: unknown, rows: unknown) => Number.isInteger(cols) && Number.isInteger(rows) && (cols as number) >= 2 && (cols as number) <= 500 && (rows as number) >= 1 && (rows as number) <= 200
export function validTerminalRequest(operation: string, args: readonly unknown[]): boolean {
  if (operation === 'start') return args.length === 0
  if (operation === 'read') return args.length === 2 && (args[0] === null || token(args[0])) && Number.isSafeInteger(args[1]) && (args[1] as number) >= 0
  if (!token(args[0])) return false
  if (operation === 'input') return args.length === 2 && typeof args[1] === 'string' && args[1].length > 0 && args[1].length <= TERMINAL_INPUT_LIMIT
  if (operation === 'resize') return args.length === 3 && validTerminalSize(args[1], args[2])
  return operation === 'close' && args.length === 1
}
/** Cursor is a UTF-16 offset. Polling bounds both retained history and transport queues. */
export class TerminalOutput {
  private chunks: string[] = []
  private length = 0
  private end = 0
  append(data: string) {
    if (!data) return
    this.end += data.length
    this.chunks.push(data); this.length += data.length
    while (this.length > TERMINAL_OUTPUT_LIMIT && this.chunks.length) {
      const first = this.chunks.shift()!, excess = this.length - TERMINAL_OUTPUT_LIMIT
      if (first.length > excess) { this.chunks.unshift(first.slice(excess)); this.length -= excess } else this.length -= first.length
    }
  }
  read(after: number) {
    const beginning = this.end - this.length, start = Math.max(beginning, Math.min(after, this.end))
    if (start === this.end) return { data: '', next: start, dropped: after < beginning || after > this.end }
    let data = this.chunks.join('').slice(start - beginning, start - beginning + TERMINAL_PAGE_LIMIT)
    // Do not cut a surrogate pair at a transport boundary.
    if (/[\ud800-\udbff]$/.test(data)) data = data.slice(0, -1)
    return { data, next: start + data.length, dropped: after < beginning || after > this.end }
  }
}
export function terminalLabel(state: TerminalState): string {
  switch (state.phase) {
    case 'none': return 'Terminal: sem sessão'
    case 'starting': return 'Terminal: iniciando…'
    case 'running': return 'Terminal: em execução'
    case 'closing': return 'Terminal: encerrando…'
    case 'closed': return 'Terminal: encerrado pelo usuário' + (state.exitCode === null ? '' : ` (${state.exitCode})`)
    case 'failed': return 'Terminal: falha ao iniciar'
    case 'exited': return `Terminal: ${state.exitCode === 0 ? 'finalizado' : 'falha'} (${state.exitCode ?? '?'})`
  }
}
export const terminalFailed = (state: TerminalState) => state.phase === 'failed' || state.phase === 'exited' && state.exitCode !== 0
