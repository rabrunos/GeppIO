import type { QuickOpenBridge, QuickOpenPage, QuickOpenResult } from '../../../shared/quick-open.ts'
import { QUICK_OPEN_LIMITS, validQuickOpenQuery } from '../../../shared/quick-open.ts'
import type { ExplorerSession } from '../files-editor/explorer-session.ts'

interface State {
  root: string | null; visible: boolean; busy: boolean; opening: boolean; query: string; page: QuickOpenPage | null; error: string | null
}
const closed = { visible: false, query: '', page: null, error: null }
/** A dialog owns a single inventory. Filtering can supersede a response without
 * superseding the inventory itself; closing revokes even a completed job. */
export class QuickOpenSession {
  private state: State = { ...closed, root: null, busy: false, opening: false }
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  private invalidRoot: string | null = null
  private job: string | null = null
  private pending = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  locked = false
  private readonly bridge: QuickOpenBridge
  private readonly explorer: ExplorerSession
  constructor(bridge: QuickOpenBridge, explorer: ExplorerSession) { this.bridge = bridge; this.explorer = explorer }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null }
  private release(job: string) { void this.bridge.cancel(job).catch(() => {}) }
  private reset() {
    this.generation++; this.clearTimer(); this.pending = false
    if (this.job !== null) this.release(this.job)
    this.job = null
  }
  connect() {
    if (this.unsubscribe) return
    let version = this.explorer.snapshot().mutationVersion
    const sync = () => {
      const explorer = this.explorer.snapshot(), editor = this.explorer.editor.snapshot(), selected = explorer.root?.id ?? null
      const changed = version !== explorer.mutationVersion; version = explorer.mutationVersion
      if (this.invalidRoot !== selected) this.invalidRoot = null
      if (selected && editor.invalidRoot === selected) this.invalidRoot = selected
      const root = this.invalidRoot ? null : selected, busy = explorer.busy || editor.busy
      if (root !== this.state.root || changed) { this.reset(); this.update({ ...closed, root, busy }) }
      else if (busy !== this.state.busy) this.update({ busy })
    }
    const stopExplorer = this.explorer.subscribe(sync), stopEditor = this.explorer.editor.subscribe(sync)
    this.unsubscribe = () => { stopExplorer(); stopEditor() }; sync()
  }
  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null
    this.detach()
    if (!this.state.opening) this.update({ root: null })
  }
  show() {
    if (!this.unsubscribe || !this.state.root || this.locked || this.state.busy || this.state.opening || this.state.visible) return false
    this.update({ visible: true }); return true
  }
  dismiss() { if (this.state.visible && !this.state.opening) { this.reset(); this.update(closed) } }
  detach() {
    if (this.state.opening) { this.clearTimer(); this.update({ visible: false }) }
    else this.dismiss()
  }
  setQuery(query: string) {
    if (!this.state.visible || this.state.opening || this.locked || query === this.state.query || query.length > QUICK_OPEN_LIMITS.query) return
    const valid = validQuickOpenQuery(query)
    this.clearTimer(); this.update({ query, page: null, error: query && !valid ? 'Informe um nome sem quebras de linha ou caracteres de controle.' : null })
    if (valid && !this.pending) this.schedule(150)
  }
  private schedule(delay: number) {
    this.clearTimer()
    this.timer = setTimeout(() => { this.timer = null; void this.fetch() }, delay)
  }
  private async fetch() {
    const { query, root, visible } = this.state
    if (!root || !validQuickOpenQuery(query) || !visible || this.pending || this.state.opening || this.locked) return
    const generation = this.generation, job = this.job
    this.pending = true
    let result: QuickOpenResult
    try { result = await (job ? this.bridge.read(job, query) : this.bridge.start(root, query)) }
    catch { result = { ok: false, error: 'Falha na comunicação com a abertura rápida.' } }
    if (generation !== this.generation) {
      if (!job && result.ok) this.release(result.value.job)
      return
    }
    this.pending = false
    if (!result.ok) {
      if (result.expired) { this.reset(); this.update({ error: result.error, page: null }); return }
      if (query === this.state.query) { this.update({ error: result.error, page: null }); return }
    } else this.job = result.value.job
    if (query !== this.state.query) { if (validQuickOpenQuery(this.state.query)) this.schedule(0); return }
    if (!result.ok) return
    this.update({ page: result.value, error: null })
    if (result.value.status === 'running' && this.state.visible && !this.state.opening) this.schedule(100)
  }
  async open(id: string) {
    const { page, busy, visible, opening, root } = this.state, generation = this.generation, editor = this.explorer.editor
    if (!page || !visible || busy || opening || this.locked || !page.items.some(item => item.id === id)) return false
    const before = editor.snapshot()
    this.clearTimer(); this.update({ opening: true })
    const opened = await editor.openAuthorized(async () => {
      const result = await this.bridge.open(page.job, id)
      if (generation !== this.generation || root !== this.explorer.snapshot().root?.id || root === result.invalidRoot) {
        return editor.reconcileObsoleteOpen(result, before)
      }
      if (!result.ok && result.expired) { this.reset(); this.update({ page: null, error: result.error }) }
      return result
    })
    this.update({ opening: false })
    if (!this.state.visible) { this.reset(); this.update(closed); return false }
    if (generation !== this.generation) return false
    if (!opened) {
      this.update({ error: editor.snapshot().notice ?? 'Não foi possível abrir o arquivo.' })
      if (this.state.page?.status === 'running' && !this.pending) this.schedule(100)
      return false
    }
    this.dismiss(); return true
  }
}
