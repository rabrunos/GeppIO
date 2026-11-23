import { GIT_HISTORY_LIMITS, GIT_LIMITS } from '../../../shared/git.ts'
import type { GitBridge, GitComparison, GitError, GitHistoryCommit, GitHistoryPage, GitResult, GitStatus } from '../../../shared/git.ts'
import type { ExplorerSession } from '../files-editor/explorer-session.ts'

type Mode = 'changes' | 'history'
interface State { root: string | null; status: GitStatus | null; comparison: GitComparison | null; busy: boolean; interactive: boolean; error: string | null; code: GitError | null
  mode: Mode; history: GitHistoryPage | null; commit: GitHistoryCommit | null; historyError: string | null }
const emptyHistory = { history: null, commit: null, historyError: null }
const utf8 = new TextEncoder()
const payloadBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).length
/** One memory-only owner, independent of document, layout, terminal and plugin state. */
export class GitSession {
  private state: State = { root: null, status: null, comparison: null, busy: false, interactive: false, error: null, code: null, mode: 'changes', ...emptyHistory }
  private listeners = new Set<() => void>()
  private generation = 0
  private unsubscribe: (() => void) | null = null
  private isLocked = false
  private running = false
  private pending = false
  private historyGeneration = 0
  private pendingHistory = false
  private readingHistory = false
  private expiredRoot: string | null = null
  private requiresRefresh = false
  get indexNeedsRefresh() { return this.requiresRefresh }
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
    let reload = this.explorer.editor.snapshot().reloadWitness, mutation = this.explorer.snapshot().mutationVersion
    const sync = () => {
      const explorer = this.explorer.snapshot(), root = explorer.root?.id ?? null
      const editor = this.explorer.editor.snapshot(), witness = editor.reloadWitness
      if (root !== this.expiredRoot) this.expiredRoot = null
      const expired = root && editor.invalidRoot === root && this.expiredRoot !== root
      if (expired) this.expiredRoot = root
      if (expired || this.state.root !== root || explorer.mutationVersion !== mutation || reload !== witness && witness?.root === root) {
        mutation = explorer.mutationVersion
        this.historyGeneration++; this.pendingHistory = false
        this.update({ ...emptyHistory, ...(this.expiredRoot ? { historyError: 'A pasta mudou. Abra o projeto novamente para consultar o histórico.' } : {}),
          ...(this.state.mode === 'history' ? { comparison: null } : {}) })
      }
      if (reload !== witness) {
        reload = witness
        if (root && witness?.root === root) {
          this.generation++; this.pending = false
          this.update({ status: null, comparison: null, ...(!this.requiresRefresh ? { error: 'Atualize o Git para consultar o estado no disco.', code: null } : {}) })
        }
      }
      const tree = this.explorer.snapshot().diskVersion, document = this.explorer.editor.snapshot().diskVersion
      if (root !== this.state.root || tree !== treeVersion || document !== documentVersion) {
        if (root !== this.state.root) this.requiresRefresh = false
        treeVersion = tree; documentVersion = document
        this.generation++; this.pending = !!root
        this.update({ root, status: null, ...(this.state.mode === 'changes' ? { comparison: null } : {}), busy: this.running, ...(!this.requiresRefresh ? { error: null, code: null } : {}) })
      }
      void this.drain()
    }
    const tree = this.explorer.subscribe(sync), editor = this.explorer.editor.subscribe(sync)
    this.unsubscribe = () => { tree(); editor() }; sync()
  }
  dispose() { this.unsubscribe?.(); this.unsubscribe = null; this.pending = false; this.pendingHistory = false; this.generation++; this.historyGeneration++ }
  async refresh() {
    if (!this.state.root || this.locked) return
    this.requiresRefresh = false
    this.generation++; this.pending = true
    this.update({ status: null, comparison: null, error: null, code: null })
    await this.drain()
  }
  async compare(id: string) {
    if (this.state.mode === 'changes') { await this.query(id); return }
    const { root, history, commit } = this.state
    if (!root || !history || !commit?.files.some(file => file.id === id)) return
    await this.historyRead(() => this.bridge.historyCompare(root, history.snapshot, commit.id, id), result => {
      const comparison = result.comparison
      if (!comparison) throw new Error('Missing historical comparison')
      if ([comparison.original, comparison.modified].some(text => text.length > GIT_LIMITS.text || utf8.encode(text).length > GIT_LIMITS.text) ||
          payloadBytes(comparison) + payloadBytes(commit) + payloadBytes(history) > GIT_HISTORY_LIMITS.retainedBytes) {
        this.update({ historyError: 'A comparação excede o limite de texto ou de retenção do histórico.' }); return
      }
      this.update({ comparison })
    }, true)
  }
  async mutate(operation: 'stage' | 'unstage', id: string) {
    if (this.state.mode === 'changes' && !this.state.commit?.files.some(file => file.id === id) &&
      !this.state.history?.commits.some(commit => commit.id === id)) await this.query(id, operation)
  }
  close() { this.update({ comparison: null }); void this.drain() }
  async setMode(mode: Mode) {
    if (this.state.mode === mode || this.locked || this.state.interactive || this.state.comparison) return
    this.update({ mode })
    if (mode === 'history' && !this.state.history && !this.state.historyError && !this.readingHistory) this.pendingHistory = true
    else if (mode === 'changes') this.pendingHistory = false
    await this.drain()
  }
  async refreshHistory() {
    if (!this.state.root || this.state.root === this.expiredRoot || this.state.mode !== 'history' || this.locked || this.state.busy) return
    this.historyGeneration++; this.pendingHistory = true
    this.update(emptyHistory); await this.drain()
  }
  async moreHistory() {
    const { root, history } = this.state
    if (!root || !history?.cursor) return
    const cursor = history.cursor
    await this.historyRead(() => this.bridge.historyPage(root, history.snapshot, cursor), result => this.acceptPage(result.history, history))
  }
  async selectCommit(id: string) {
    const { root, history } = this.state
    if (!root || !history?.commits.some(commit => commit.id === id) || this.state.busy || this.locked || this.state.mode !== 'history') return
    this.update({ commit: null })
    await this.historyRead(() => this.bridge.historyCommit(root, history.snapshot, id), result => {
      const commit = result.commit
      if (!commit || commit.id !== id) throw new Error('Unexpected history commit')
      if (commit.files.length > GIT_HISTORY_LIMITS.files || payloadBytes(commit) + payloadBytes(history) > GIT_HISTORY_LIMITS.retainedBytes) {
        this.update({ historyError: 'O detalhe do commit excede o limite de histórico.' }); return
      }
      this.update({ commit })
    })
  }
  private acceptPage(page: GitHistoryPage | undefined, previous?: GitHistoryPage) {
    if (!page || previous && page.snapshot !== previous.snapshot) {
      this.update({ ...emptyHistory, historyError: 'O histórico mudou. Atualize para consultar o HEAD atual.' }); return
    }
    if (page.commits.length > GIT_HISTORY_LIMITS.page || payloadBytes(page) > GIT_HISTORY_LIMITS.pageBytes) {
      this.update({ historyError: 'A página excede o limite de histórico.' }); return
    }
    const commits = [...(previous?.commits ?? []), ...page.commits]
    if ((!page.unborn && !commits.length) || new Set(commits.map(commit => commit.id)).size !== commits.length) {
      this.update({ ...emptyHistory, historyError: 'A página de commits é inconsistente. Atualize o histórico.' }); return
    }
    const history = { ...page, commits }
    if (commits.length > GIT_HISTORY_LIMITS.commits || payloadBytes(history) + payloadBytes(this.state.commit) > GIT_HISTORY_LIMITS.retainedBytes) {
      this.update({ historyError: 'O histórico atingiu o limite de retenção.', history: previous ? { ...previous, cursor: null, limited: true } : null }); return
    }
    this.update({ history })
  }
  private async historyRead(request: () => Promise<GitResult>, accept: (result: Extract<GitResult, { ok: true }>) => void, comparison = false) {
    const { root, mode } = this.state
    if (!root || root === this.expiredRoot || mode !== 'history' || this.running || this.locked) return
    const generation = this.historyGeneration
    this.running = true; this.readingHistory = true
    this.update({ busy: true, interactive: comparison, historyError: null })
    try {
      const result = await request()
      if (generation !== this.historyGeneration || root !== this.state.root || this.locked) return
      if (result.ok) accept(result)
      else this.update({ ...(result.code === 'stale' ? emptyHistory : {}), historyError: result.error })
    } catch {
      if (generation === this.historyGeneration && root === this.state.root) this.update({ historyError: 'Não foi possível consultar o histórico Git. Tente novamente.' })
    } finally {
      this.running = false; this.readingHistory = false; this.update({ busy: false, interactive: false }); await this.drain()
    }
  }
  private async drain() {
    if (this.running || this.locked || this.state.comparison || this.explorer.snapshot().busy || this.explorer.editor.snapshot().busy) return
    const root = this.state.root
    if (root && this.pendingHistory && this.state.mode === 'history') {
      this.pendingHistory = false
      await this.historyRead(() => this.bridge.history(root), result => this.acceptPage(result.history))
      return
    }
    if (!this.pending || this.requiresRefresh) return
    this.pending = false
    await this.query()
  }
  private async query(id?: string, operation?: 'stage' | 'unstage') {
    const root = this.state.root
    if (!root || this.running || this.locked || this.requiresRefresh) return
    const generation = this.generation
    const reload = this.explorer.editor.snapshot().reloadWitness
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
        if (reload !== this.explorer.editor.snapshot().reloadWitness) return
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
