import type { GitBridge, GitComparison, GitError, GitStatus } from '../../../shared/git.ts'
import type { ExplorerSession } from '../files-editor/explorer-session.ts'

interface State { root: string | null; status: GitStatus | null; comparison: GitComparison | null; busy: boolean; interactive: boolean; error: string | null; code: GitError | null }
/** One memory-only owner, independent of document, layout, terminal and plugin state. */
export class GitSession {
  private state: State = { root: null, status: null, comparison: null, busy: false, interactive: false, error: null, code: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private unsubscribe: (() => void) | null = null
  private isLocked = false
  private running = false
  private pending = false
  private requiresRefresh = false
  get locked() { return this.isLocked }
  set locked(value: boolean) { const changed = value !== this.isLocked; this.isLocked = value; if (changed && !value) queueMicrotask(() => { void this.drain() }) }
  private bridge: GitBridge
  private explorer: ExplorerSession
  constructor(bridge: GitBridge, explorer: ExplorerSession) { this.bridge = bridge; this.explorer = explorer }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  connect() {
    if (this.unsubscribe) return
    let treeVersion = this.explorer.snapshot().diskVersion, documentVersion = this.explorer.editor.snapshot().diskVersion
    const sync = () => {
      const root = this.explorer.snapshot().root?.id ?? null
      const tree = this.explorer.snapshot().diskVersion, document = this.explorer.editor.snapshot().diskVersion
      if (root !== this.state.root || tree !== treeVersion || document !== documentVersion) {
        if (root !== this.state.root) this.requiresRefresh = false
        treeVersion = tree; documentVersion = document
        this.generation++; this.pending = !!root
        this.update({ root, status: null, comparison: null, busy: this.running, ...(!this.requiresRefresh ? { error: null, code: null } : {}) })
      }
      void this.drain()
    }
    const tree = this.explorer.subscribe(sync), editor = this.explorer.editor.subscribe(sync)
    this.unsubscribe = () => { tree(); editor() }; sync()
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; this.pending = false; this.generation++ }
  async refresh() {
    if (!this.state.root || this.locked) return
    this.requiresRefresh = false
    this.generation++; this.pending = true
    this.update({ status: null, comparison: null, error: null, code: null })
    await this.drain()
  }
  async compare(id: string) { await this.query(id) }
  async mutate(operation: 'stage' | 'unstage', id: string) { await this.query(id, operation) }
  close() { this.update({ comparison: null }) }
  private async drain() {
    if (!this.pending || this.running || this.locked || this.requiresRefresh || this.explorer.snapshot().busy || this.explorer.editor.snapshot().busy) return
    this.pending = false
    await this.query()
  }
  private async query(id?: string, operation?: 'stage' | 'unstage') {
    const root = this.state.root
    if (!root || this.running || this.locked || this.requiresRefresh) return
    const generation = this.generation
    let confirmed = false
    this.running = true
    this.update({ busy: true, interactive: !!id, error: null, code: null, comparison: null, ...(!id ? { status: null } : {}) })
    try {
      const result = id ? await (operation ? this.bridge[operation](root, id) : this.bridge.compare(root, id)) : await this.bridge.status(root)
      if (root !== this.state.root || generation !== this.generation && !operation) return
      // Saves/Explorer refreshes can supersede a snapshot, never the outcome of
      // an explicit same-root index write. Uncertainty needs a user refresh.
      if (!result.ok) {
        if (result.code === 'uncertain') { this.requiresRefresh = true; this.pending = false }
        this.update({ error: result.error, code: result.code, ...(['stale', 'uncertain'].includes(result.code) ? { status: null } : {}) })
      } else if (generation === this.generation) this.update({ ...(result.status ? { status: result.status } : {}), comparison: result.comparison ?? null })
      if (result.ok && result.mutated) {
        confirmed = true
        this.update({ status: null })
        const refreshed = await this.bridge.status(root)
        if (generation !== this.generation || root !== this.state.root) return
        if (refreshed.ok) this.update({ status: refreshed.status ?? null })
        else { this.requiresRefresh = true; this.pending = false; this.update({ code: refreshed.code, error: 'Índice atualizado; a nova consulta falhou. Atualize para conferir. ' + refreshed.error }) }
      }
    } catch {
      if (root === this.state.root && (generation === this.generation || operation)) {
        if (operation) { this.requiresRefresh = true; this.pending = false }
        this.update({ ...(operation ? { status: null } : {}), code: operation && !confirmed ? 'uncertain' : 'unavailable', error: confirmed ? 'Índice atualizado; não foi possível consultar o novo estado. Atualize para conferir.' : operation ? 'A comunicação foi interrompida e o índice pode ter mudado. Atualize para conferir antes de outra ação.' : 'Não foi possível comunicar com o Git. Tente novamente.' })
      }
    }
    finally { this.running = false; this.update({ busy: false, interactive: false }); await this.drain() }
  }
}
