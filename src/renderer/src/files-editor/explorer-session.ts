import type { ExplorerBridge, ExplorerNode } from '../../../shared/explorer.ts'
import type { EditorSession } from './session.ts'

export interface ExplorerState {
  root: ExplorerNode | null; children: ReadonlyMap<string, ExplorerNode[]>; expanded: ReadonlySet<string>
  errors: ReadonlyMap<string, string>; busy: boolean; error: string | null; active: string | null; document: string | null
}
/** One navigation owner for the activity view and the explicitly placed official widget. */
export class ExplorerSession {
  private state: ExplorerState = { root: null, children: new Map(), expanded: new Set(), errors: new Map(), busy: false, error: null, active: null, document: null }
  private listeners = new Set<() => void>()
  scroll = 0
  focus: string | null = null
  locked = false
  readonly bridge: ExplorerBridge
  readonly editor: EditorSession
  constructor(bridge: ExplorerBridge, editor: EditorSession) { this.bridge = bridge; this.editor = editor }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<ExplorerState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  async select() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy) return
    this.update({ busy: true, error: null })
    try {
      const result = await this.bridge.select()
      if (!result.ok) this.update({ error: result.error })
      else if (!result.canceled) {
        this.scroll = 0; this.focus = result.root?.id ?? null
        this.update({ root: result.root, children: new Map(), expanded: new Set(), errors: new Map(), active: null, document: null })
        if (result.root) { await this.load(result.root.id); this.update({ expanded: new Set([result.root.id]) }) }
      }
    } catch { this.update({ error: 'Não foi possível comunicar com o Explorador. Tente novamente.' }) }
    finally { this.update({ busy: false }) }
  }
  private async load(id: string) {
    const root = this.state.root
    if (!root) return
    const result = await this.bridge.list(root.id, id), errors = new Map(this.state.errors)
    if (!result.ok) { errors.set(id, result.error); this.update({ errors }); return }
    errors.delete(id)
    const children = new Map(this.state.children); children.set(id, result.children ?? [])
    this.update({ children, errors })
  }
  async toggle(node: ExplorerNode) {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || node.kind !== 'directory') return
    const expanded = new Set(this.state.expanded)
    if (expanded.has(node.id)) { expanded.delete(node.id); this.update({ expanded }); return }
    this.update({ busy: true })
    try { if (!this.state.children.has(node.id) || this.state.errors.has(node.id)) await this.load(node.id); expanded.add(node.id); this.update({ expanded }) }
    catch { this.update({ error: 'Não foi possível ler a pasta. Tente novamente.' }) }
    finally { this.update({ busy: false }) }
  }
  async refresh() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || !this.state.root) return
    this.update({ busy: true, error: null })
    try {
      const visit = async (id: string) => {
        await this.load(id)
        if (this.state.errors.has(id)) return
        for (const child of this.state.children.get(id) ?? []) if (child.kind === 'directory' && this.state.expanded.has(child.id)) await visit(child.id)
      }
      await visit(this.state.root.id)
      // Remove cached detached subtrees, keeping memory bounded like the native grant.
      const reachable = new Set<string>()
      const walk = (id: string) => { reachable.add(id); for (const node of this.state.children.get(id) ?? []) if (!reachable.has(node.id)) walk(node.id) }
      walk(this.state.root.id)
      this.update({ children: new Map([...this.state.children].filter(([id]) => reachable.has(id))), expanded: new Set([...this.state.expanded].filter(id => reachable.has(id))), errors: new Map([...this.state.errors].filter(([id]) => reachable.has(id))), active: this.state.active && reachable.has(this.state.active) ? this.state.active : null })
    } catch { this.update({ error: 'Não foi possível atualizar a árvore. Tente novamente.' }) }
    finally { this.update({ busy: false }) }
  }
  async release() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || !this.state.root) return
    this.update({ busy: true, error: null })
    try {
      const result = await this.bridge.release(this.state.root.id)
      if (!result.ok) this.update({ error: result.error })
      else { this.scroll = 0; this.focus = null; this.update({ root: null, children: new Map(), expanded: new Set(), errors: new Map(), active: null, document: null }) }
    } catch { this.update({ error: 'Não foi possível liberar a pasta. Tente novamente.' }) }
    finally { this.update({ busy: false }) }
  }
  async open(node: ExplorerNode) {
    if (this.state.busy || this.locked || node.kind !== 'file' || !this.state.root) return
    const root = this.state.root.id
    this.update({ busy: true, error: null })
    try {
      const opened = await this.editor.openAuthorized(draft => this.bridge.open(root, node.id, draft))
      if (opened) this.update({ active: node.id, document: this.editor.snapshot().document?.id ?? null })
      else this.update({ error: this.editor.snapshot().error })
    } finally { this.update({ busy: false }) }
  }
}
