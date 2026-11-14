import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IPty } from 'node-pty'
import { emptyTerminal, TerminalOutput } from '../shared/terminal.ts'
import type { TerminalRead, TerminalState } from '../shared/terminal.ts'

/** Native session belongs to Core, never to a presentation. One process per app window. */
export class TerminalService {
  private process: IPty | null = null
  private output = new TerminalOutput()
  private state: TerminalState = emptyTerminal()
  private disposed = false
  private inputBudget = 0
  private budgetSince = 0
  read(id: string | null, after: number): TerminalRead {
    if (id !== null && id !== this.state.id) throw new Error('Sessão de terminal expirada.')
    return { state: { ...this.state }, ...this.output.read(after) }
  }
  start(): TerminalRead {
    if (this.disposed) throw new Error('Terminal indisponível nesta janela.')
    if (['starting', 'running', 'closing'].includes(this.state.phase)) return this.read(null, 0)
    const id = randomUUID()
    this.output = new TerminalOutput(); this.inputBudget = 0
    this.state = { ...emptyTerminal(), id, phase: 'starting' }
    // Yield once so the starting phase is observable; cancellation revokes this generation.
    setImmediate(() => {
      if (this.disposed || this.state.id !== id || this.state.phase !== 'starting') return
      try {
        const shell = process.platform === 'win32' ? [
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        ].find(path => existsSync(path)) : '/bin/bash'
        if (!shell) throw new Error('shell unavailable')
        const env = { ...process.env }
        for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'GEPPIO_TEST_USER_DATA', 'GEPPIO_TEST_DEMO_WIDGETS']) delete env[key]
        if (process.platform !== 'win32') env.HISTFILE = '/dev/null'
        // Load lazily: a missing native binary produces terminal feedback, not app startup failure.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pty = require('node-pty') as typeof import('node-pty')
        // Fixed launch configuration only: no profile, project command or persistent PSReadLine history.
        // NUL also prevents loading the owner's existing command-history file before the first prompt.
        const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command',
          "try { if (Get-Module -ListAvailable -Name PSReadLine) { Import-Module PSReadLine -ErrorAction Stop; Set-PSReadLineOption -HistorySaveStyle SaveNothing -HistorySavePath 'NUL' -ErrorAction Stop } } catch { Write-Error 'Falha ao desativar o historico do shell.'; exit 1 }"] : ['--noprofile', '--norc']
        const child = pty.spawn(shell, args, {
          name: 'xterm-256color', cols: this.state.cols, rows: this.state.rows, cwd: homedir(), env,
          useConpty: true, useConptyDll: false
        })
        this.process = child
        this.state = { ...this.state, phase: 'running', shell: process.platform === 'win32' ? shell.endsWith('pwsh.exe') ? 'PowerShell 7' : 'Windows PowerShell' : 'bash', cwd: homedir() }
        child.onData(data => { if (this.state.id === id && !this.disposed) this.output.append(data) })
        child.onExit(({ exitCode }) => {
          if (this.state.id !== id) return
          this.process = null
          this.state = { ...this.state, phase: this.state.phase === 'closing' ? 'closed' : 'exited', exitCode }
        })
      } catch {
        this.process = null
        this.state = { ...this.state, phase: 'failed', error: 'Não foi possível iniciar PowerShell/ConPTY. Verifique a instalação nativa e a disponibilidade do shell.' }
      }
    })
    return this.read(null, 0)
  }
  private running(id: string) {
    if (id !== this.state.id || this.disposed || this.state.phase !== 'running' || !this.process) throw new Error('A sessão não está em execução. Reinicie explicitamente.')
    return this.process
  }
  input(id: string, data: string): TerminalRead {
    const child = this.running(id), now = Date.now()
    if (now - this.budgetSince >= 1000) { this.budgetSince = now; this.inputBudget = 0 }
    if (this.inputBudget + data.length > 65536) throw new Error('Entrada muito rápida. Aguarde antes de colar novamente.')
    this.inputBudget += data.length; child.write(data)
    return this.metadata()
  }
  resize(id: string, cols: number, rows: number): TerminalRead {
    const child = this.running(id)
    if (cols !== this.state.cols || rows !== this.state.rows) { child.resize(cols, rows); this.state = { ...this.state, cols, rows } }
    return this.metadata()
  }
  close(id: string): TerminalRead {
    if (id !== this.state.id || this.disposed) throw new Error('Sessão de terminal expirada.')
    if (this.state.phase === 'starting') this.state = { ...this.state, phase: 'closed' }
    else if (this.process && this.state.phase === 'running') { this.state = { ...this.state, phase: 'closing' }; this.process.kill() }
    return this.metadata()
  }
  private metadata(): TerminalRead { return { state: { ...this.state }, data: '', next: 0, dropped: false } }
  dispose() { this.disposed = true; const child = this.process; this.process = null; if (child) { try { child.kill() } catch { /* Process already exited. */ } } }
}
