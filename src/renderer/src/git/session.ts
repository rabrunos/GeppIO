import type { GitBridge, GitComparison, GitStatus } from '../../../shared/git.ts'
import type { ExplorerSession } from '../files-editor/explorer-session.ts'

interface State { root: string | null; status: GitStatus | null; comparison: GitComparison | null; busy: boolean; error: string | null }
/** One memory-only owner, independent of document, layout, terminal and plugin state. */
export class GitSession {
  private state: State = { root: null, status: null, comparison: null, busy: false, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private unsubscribe: (() => void) | null = null
  locked = false
  private bridge: GitBridge
  private explorer: ExplorerSession
  constructor(bridge: GitBridge, explorer: ExplorerSession) { this.bridge = bridge; this.explorer = explorer }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  connect() {
    if (this.unsubscribe) return
    const sync = () => {
      const root = this.explorer.snapshot().root?.id ?? null
      if (root === this.state.root) return
      this.generation++; this.update({ root, status: null, comparison: null, busy: false, error: null })
      if (root) void this.refresh()
    }
    this.unsubscribe = this.explorer.subscribe(sync); sync()
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; this.generation++ }
  async refresh() { await this.query() }
  async compare(id: string) { await this.query(id) }
  async mutate(operation: 'stage' | 'unstage', id: string) { await this.query(id, operation) }
  close() { this.update({ comparison: null }) }
  private async query(id?: string, operation?: 'stage' | 'unstage') {
    const root = this.state.root
    if (!root || this.state.busy || this.locked) return
    const generation = ++this.generation
    let confirmed = false
    this.update({ busy: true, error: null, comparison: null, ...(!id ? { status: null } : {}) })
    try {
      const result = id ? await (operation ? this.bridge[operation](root, id) : this.bridge.compare(root, id)) : await this.bridge.status(root)
      if (generation !== this.generation || root !== this.state.root) return
      if (!result.ok) this.update({ error: result.error, ...(['stale', 'uncertain'].includes(result.code) ? { status: null } : {}) })
      else this.update({ ...(result.status ? { status: result.status } : {}), comparison: result.comparison ?? null })
      if (result.ok && result.mutated) {
        confirmed = true
        this.update({ status: null })
        const refreshed = await this.bridge.status(root)
        if (generation !== this.generation || root !== this.state.root) return
        if (refreshed.ok) this.update({ status: refreshed.status ?? null })
        else this.update({ error: 'Índice atualizado; a nova consulta falhou. Atualize para conferir. ' + refreshed.error })
      }
    } catch { if (generation === this.generation) this.update({ ...(operation ? { status: null } : {}), error: confirmed ? 'Índice atualizado; não foi possível consultar o novo estado. Atualize para conferir.' : operation ? 'A comunicação foi interrompida e o índice pode ter mudado. Atualize para conferir antes de outra ação.' : 'Não foi possível comunicar com o Git. Tente novamente.' }) }
    finally { if (generation === this.generation) this.update({ busy: false }) }
  }
}
