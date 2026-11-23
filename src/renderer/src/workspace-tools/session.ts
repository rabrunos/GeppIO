import type { WorkspaceToolReport } from '../../../shared/workspace-tools.ts'
import type { WorkspaceBridge } from '../../../shared/workspace.ts'

interface State {
  root: string | null
  reports: readonly WorkspaceToolReport[]
  selected: string | null
  status: 'idle' | 'ready' | 'missing' | 'error' | 'stale'
  reading: boolean
  lastRead: number | null
  error: string | null
}
const empty: State = { root: null, reports: [], selected: null, status: 'idle', reading: false, lastRead: null, error: null }
interface Source<T> { snapshot(): T; subscribe(listener: () => void): () => void }
type RootSource = Source<{ root: { id: string } | null }> & { editor: Source<{ invalidRoot: string | null }> }

/** One discovery per authorized root. Presentation lifetimes never schedule reads. */
export class WorkspaceToolsSession {
  private readonly bridge: Pick<WorkspaceBridge, 'readTools'>
  private readonly explorer: RootSource
  private readonly now: () => number
  private state: State = empty
  private listeners = new Set<() => void>()
  private stop: (() => void) | null = null
  private generation = 0
  private revoked: string | null = null
  constructor(bridge: Pick<WorkspaceBridge, 'readTools'>, explorer: RootSource, now = Date.now) {
    this.bridge = bridge; this.explorer = explorer; this.now = now
  }
  snapshot = () => this.state
  subscribe = (listen: () => void) => { this.listeners.add(listen); return () => { this.listeners.delete(listen) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  connect() {
    if (this.stop) return
    const sync = () => {
      const selected = this.explorer.snapshot().root?.id ?? null
      if (selected !== this.revoked) this.revoked = null
      if (selected && this.explorer.editor.snapshot().invalidRoot === selected) this.revoked = selected
      const root = this.revoked ? null : selected
      if (root === this.state.root) return
      this.generation++
      this.update({ ...empty, root })
      if (root) void this.refresh()
    }
    const tree = this.explorer.subscribe(sync), editor = this.explorer.editor.subscribe(sync)
    this.stop = () => { tree(); editor() }; sync()
  }
  dispose() {
    this.stop?.(); this.stop = null
    // React replays the owner's effects synchronously in development. Keep
    // the same read/snapshot through that replay, then release on true teardown.
    queueMicrotask(() => { if (!this.stop) { this.generation++; this.state = empty; this.revoked = null } })
  }
  select(id: string) {
    if (id !== this.state.selected && this.state.reports.some(report => report.id === id)) this.update({ selected: id })
  }
  async refresh() {
    const { root, reading } = this.state, generation = this.generation
    if (!root || !this.stop || reading) return
    const current = () => !!this.stop && generation === this.generation && this.state.root === root
    this.update({ reading: true })
    try {
      const result = await this.bridge.readTools(root)
      if (!current()) return
      if (!result.ok) {
        if (result.expired) this.update({ ...empty, root, status: 'error', error: result.error })
        else this.failed(result.error)
      } else if (result.root !== root) {
        this.update({ ...empty, root, status: 'error', error: 'A leitura não corresponde ao projeto atual.' })
      } else if (result.status === 'missing') {
        this.update({ ...empty, root, status: 'missing' })
      } else {
        const reports = result.reports, selected = reports.some(report => report.id === this.state.selected) ? this.state.selected : reports[0]?.id ?? null
        this.update({ reports, selected, reading: false, status: 'ready', error: null, lastRead: this.now() })
      }
    } catch { if (current()) this.failed('Não foi possível receber os relatórios do projeto.') }
  }
  private failed(error: string) {
    this.update({ error, reading: false, status: this.state.lastRead === null ? 'error' : 'stale' })
  }
}
