import { validExplorerBasename } from '../../../shared/explorer.ts'
import type { ExplorerBridge, ExplorerMutation, ExplorerMutationResult, ExplorerNode } from '../../../shared/explorer.ts'
import type { EditorDocument, EditorSession } from './session.ts'
import { documentLanguage } from '../../../shared/document-status.ts'
import type { WorkspaceBridge, WorkspaceResult, WorkspaceStatus } from '../../../shared/workspace.ts'

/** Display association only; native open/save still validate exact grants. */
export function findExplorerChild(nodes: readonly ExplorerNode[], name: string, caseInsensitive = false): ExplorerNode | undefined {
  const exact = nodes.find(node => node.name === name)
  if (exact || !caseInsensitive) return exact
  const matches = nodes.filter(node => node.name.toLowerCase() === name.toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}

export interface ExplorerState {
  root: ExplorerNode | null; children: ReadonlyMap<string, ExplorerNode[]>; expanded: ReadonlySet<string>; diskVersion: number
  errors: ReadonlyMap<string, string>; busy: boolean; error: string | null; active: string | null; document: string | null
  workspace: WorkspaceStatus | null; mutationVersion: number; mutationNotice: string | null
}
/** One navigation owner for the activity view and the explicitly placed official widget. */
export class ExplorerSession {
  private state: ExplorerState = { root: null, children: new Map(), expanded: new Set(), diskVersion: 0, errors: new Map(), busy: false, error: null, active: null, document: null, workspace: null, mutationVersion: 0, mutationNotice: null }
  private listeners = new Set<() => void>()
  private stop: (() => void) | null = null
  private generation = 0
  private followKey: string | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private rememberTimer: ReturnType<typeof setTimeout> | null = null
  private remembering = false
  private rememberWork: Promise<void> | null = null
  private remembered = ''
  scroll = 0
  focus: string | null = null
  locked = false
  readonly bridge: ExplorerBridge
  readonly editor: EditorSession
  readonly workspace?: WorkspaceBridge
  constructor(bridge: ExplorerBridge, editor: EditorSession, workspace?: WorkspaceBridge) { this.bridge = bridge; this.editor = editor; this.workspace = workspace }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<ExplorerState>) { this.state = { ...this.state, ...('root' in patch ? { mutationNotice: null } : {}), ...patch }; if (patch.busy !== undefined) this.editor.setNavigationBusy(patch.busy); if ('root' in patch) this.editor.setProjectRoot(patch.root?.id ?? null); for (const listener of this.listeners) listener() }
  connect() {
    if (this.stop) return
    let reload = this.editor.snapshot().reloadWitness
    const sync = () => {
      const editor = this.editor.snapshot(), document = editor.document, location = document?.location, root = this.state.root
      const invalid = root && editor.invalidRoot === root.id
      const key = [root?.id, document?.id, location?.root, location?.names.join('/'), location?.caseInsensitive, invalid].join('|')
      const witness = editor.reloadWitness
      if (witness !== reload) {
        reload = witness
        if (root && witness?.root === root.id) {
          // The receipt may also supply this tab's first project association.
          // Do not implicitly follow that path until the owner refreshes or navigates.
          if (!invalid) this.followKey = key
          const children = new Map(this.state.children)
          let parent = root.id
          let removed: string | null = null
          for (const [index, name] of witness.names.entries()) {
            const siblings = children.get(parent) ?? [], child = findExplorerChild(siblings, name, witness.caseInsensitive)
            if (!child) break
            if (index === witness.names.length - 1) {
              removed = child.id
              if (siblings.length === 1) children.delete(parent)
              else children.set(parent, siblings.filter(item => item.id !== child.id))
            } else parent = child.id
          }
          if (removed && this.focus === removed) this.focus = parent
          this.update({ children, active: this.state.active === removed ? null : this.state.active,
            mutationVersion: this.state.mutationVersion + 1, mutationNotice: 'Atualize a árvore para conferir o arquivo no disco.' })
        }
      }
      if (this.state.busy || this.editor.snapshot().busy || this.locked) return
      if (key === this.followKey) return
      this.followKey = key
      if (invalid) { this.update({ active: null, document: document?.id ?? null, error: 'A pasta mudou ou ficou indisponível. Abra a pasta novamente; as abas foram mantidas.' }); return }
      if (!root || !document || location?.root !== root.id) { this.update({ active: null, document: document?.id ?? null }); return }
      void this.follow(document.id, location.names, location.caseInsensitive)
    }
    const editor = this.editor.subscribe(() => { sync(); this.scheduleRemember() }), tree = this.subscribe(sync)
    const flush = async () => {
      await this.rememberWork
      if (!this.workspace) return
      try { const result = await this.workspace.remember(this.editor.workspaceState()); if (result.ok) this.update({ workspace: result.value }) }
      catch { /* Native close still protects every source draft separately. */ }
    }
    if (this.workspace) this.editor.beforeClose = flush
    this.stop = () => { editor(); tree(); if (this.editor.beforeClose === flush) this.editor.beforeClose = null }; sync()
    if (this.workspace) this.interval = setInterval(() => this.scheduleRemember(), 1500)
  }
  dispose() { this.stop?.(); this.stop = null; this.generation++; this.editor.setNavigationBusy(false); if (this.interval) clearInterval(this.interval); if (this.rememberTimer) clearTimeout(this.rememberTimer); this.interval = null; this.rememberTimer = null }
  async initialize() {
    if (!this.workspace) return
    const generation = this.generation
    try { const result = await this.workspace.read(); if (generation === this.generation) { if (result.ok) await this.adoptWorkspace(result.value); else this.update({ error: result.error }) } }
    catch { if (generation === this.generation) this.update({ error: 'Não foi possível ler a sessão de projeto. Arquivos avulsos continuam disponíveis.' }) }
  }
  private async adoptWorkspace(workspace: WorkspaceStatus) {
    this.update({ workspace })
    if (workspace.root?.id === this.state.root?.id) return
    this.generation++; this.followKey = null; this.remembered = ''; this.scroll = 0; this.focus = workspace.root?.id ?? null
    this.update({ root: workspace.root, children: new Map(), expanded: new Set(), errors: new Map(), active: null, document: null })
    if (workspace.root) { await this.load(workspace.root.id); this.update({ expanded: new Set([workspace.root.id]) }) }
  }
  private scheduleRemember() {
    if (!this.workspace || !this.stop || !this.state.root || !this.state.workspace?.remember || this.state.busy || this.editor.snapshot().busy || this.remembering) return
    if (this.rememberTimer) clearTimeout(this.rememberTimer)
    this.rememberTimer = setTimeout(() => { this.rememberTimer = null; const work = this.remember(); this.rememberWork = work; void work.finally(() => { if (this.rememberWork === work) this.rememberWork = null }) }, 600)
  }
  private async remember() {
    if (!this.workspace || this.remembering || this.state.busy || this.editor.snapshot().busy || !this.stop) return
    const state = this.editor.workspaceState(), signature = JSON.stringify(state), generation = this.generation
    if (signature === this.remembered) return
    this.remembering = true
    try {
      const result = await this.workspace.remember(state)
      if (generation === this.generation && result.ok) { this.remembered = signature; this.update({ workspace: result.value }) }
    } catch { /* A later bounded metadata update retries; no source text is sent. */ }
    finally { this.remembering = false }
  }
  async workspaceAction(action: 'restore' | 'standalone' | 'forget' | boolean): Promise<boolean> {
    if (!this.workspace || this.state.busy || this.editor.snapshot().busy || this.locked) return false
    this.update({ busy: true, error: null })
    let completed = false
    try {
      const invoke = () => typeof action === 'boolean' ? this.workspace!.configure(action) : this.workspace![action]()
      const receive = async (): Promise<WorkspaceResult> => {
        const result = await invoke()
        if (result.ok) { await this.adoptWorkspace(result.value); if (result.views) this.editor.restoreViews(result.views) }
        else { if (result.value) await this.adoptWorkspace(result.value); this.update({ error: result.error }) }
        completed = result.ok && !result.canceled
        return result
      }
      if (action === 'restore' || action === 'standalone') await this.editor.openAuthorized(async () => {
        const result = await receive()
        return result.ok ? result.documents ?? { ok: true, document: null, canceled: true } : { ok: false, code: 'unavailable', error: result.error }
      })
      else await receive()
      this.remembered = ''
    } catch { this.update({ error: 'Não foi possível concluir a operação de projeto. As abas foram mantidas.' }) }
    finally { this.update({ busy: false }) }
    return completed
  }
  private async follow(document: string, names: string[], caseInsensitive = false) {
    const root = this.state.root, generation = this.generation
    if (!root) return
    const current = () => generation === this.generation && this.state.root?.id === root.id && this.editor.snapshot().document?.id === document
    this.update({ busy: true })
    try {
      let parent = root.id
      const expanded = new Set(this.state.expanded)
      for (let index = 0; index < names.length; index++) {
        if (!this.state.children.has(parent) || this.state.errors.has(parent)) await this.load(parent, current)
        if (!current()) return
        let child = findExplorerChild(this.state.children.get(parent) ?? [], names[index]!, caseInsensitive)
        if (!child && !this.state.errors.has(parent)) {
          await this.load(parent, current)
          if (!current()) return
          child = findExplorerChild(this.state.children.get(parent) ?? [], names[index]!, caseInsensitive)
        }
        if (!child) { this.update({ active: null, document }); return }
        expanded.add(parent)
        if (index === names.length - 1) { this.update({ expanded, active: child.kind === 'file' ? child.id : null, document }); return }
        if (child.kind !== 'directory') { this.update({ active: null, document }); return }
        parent = child.id
      }
    } catch { if (current()) this.update({ active: null, document, error: 'Não foi possível localizar a aba na árvore. Atualize o Explorador.', diskVersion: this.state.diskVersion + 1 }) }
    finally { if (generation === this.generation) this.update({ busy: false }) }
  }
  async select() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy) return
    this.update({ busy: true, error: null })
    try {
      const result = await this.bridge.select()
      if (!result.ok) this.update({ error: result.error })
      else if (!result.canceled) {
        this.generation++; this.followKey = null
        this.scroll = 0; this.focus = result.root?.id ?? null
        this.update({ root: result.root, children: new Map(), expanded: new Set(), errors: new Map(), active: null, document: null })
        if (result.root) { await this.load(result.root.id); this.update({ expanded: new Set([result.root.id]) }) }
      }
    } catch { this.update({ error: 'Não foi possível comunicar com o Explorador. Tente novamente.' }) }
    finally {
      this.update({ busy: false })
      if (this.workspace) await this.initialize()
      const id = this.editor.snapshot().document?.id
      if (id && !this.editor.snapshot().busy) await this.editor.activate(id)
    }
  }
  private async load(id: string, current = () => true) {
    const root = this.state.root
    if (!root) return
    const result = await this.bridge.list(root.id, id), errors = new Map(this.state.errors)
    if (!current() || this.state.root?.id !== root.id) return
    if (!result.ok) { errors.set(id, result.error); this.update({ errors, diskVersion: this.state.diskVersion + 1 }); return }
    errors.delete(id)
    const children = new Map(this.state.children); children.set(id, result.children ?? [])
    this.update({ children, errors })
    this.prune()
  }
  private prune() {
    if (!this.state.root) return
    const reachable = new Set<string>()
    const walk = (id: string) => { reachable.add(id); for (const node of this.state.children.get(id) ?? []) if (!reachable.has(node.id)) walk(node.id) }
    walk(this.state.root.id)
    this.update({ children: new Map([...this.state.children].filter(([id]) => reachable.has(id))), expanded: new Set([...this.state.expanded].filter(id => reachable.has(id))), errors: new Map([...this.state.errors].filter(([id]) => reachable.has(id))), active: this.state.active && reachable.has(this.state.active) ? this.state.active : null })
  }
  async toggle(node: ExplorerNode) {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || node.kind !== 'directory') return
    const expanded = new Set(this.state.expanded)
    if (expanded.has(node.id)) { expanded.delete(node.id); this.update({ expanded }); return }
    this.update({ busy: true })
    try { if (!this.state.children.has(node.id) || this.state.errors.has(node.id)) await this.load(node.id); expanded.add(node.id); this.update({ expanded }) }
    catch { this.update({ error: 'Não foi possível ler a pasta. Tente novamente.', diskVersion: this.state.diskVersion + 1 }) }
    finally { this.update({ busy: false }) }
  }
  async refresh() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || !this.state.root) return
    this.update({ busy: true, error: null, mutationNotice: null, diskVersion: this.state.diskVersion + 1 })
    try {
      const visit = async (id: string) => {
        await this.load(id)
        if (this.state.errors.has(id)) return
        for (const child of this.state.children.get(id) ?? []) if (child.kind === 'directory' && this.state.expanded.has(child.id)) await visit(child.id)
      }
      await visit(this.state.root.id)
      // Remove cached detached subtrees, keeping memory bounded like the native grant.
      this.prune()
    } catch { this.update({ error: 'Não foi possível atualizar a árvore. Tente novamente.' }) }
    finally { this.followKey = null; this.update({ busy: false }) }
  }
  async release() {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || !this.state.root) return
    this.update({ busy: true, error: null })
    try {
      const result = await this.bridge.release(this.state.root.id)
      if (!result.ok) this.update({ error: result.error })
      else { this.generation++; this.followKey = null; this.scroll = 0; this.focus = null; this.update({ root: null, children: new Map(), expanded: new Set(), errors: new Map(), active: null, document: null }) }
    } catch { this.update({ error: 'Não foi possível liberar a pasta. Tente novamente.' }) }
    finally { this.update({ busy: false }); if (this.workspace) await this.initialize() }
  }
  openFileNodes() {
    const root = this.state.root, nodes = new Map<string, EditorDocument>()
    if (!root) return nodes
    for (const tab of this.editor.snapshot().tabs) {
      const { document } = tab
      if (this.state.active && this.state.document === document.id) nodes.set(this.state.active, tab)
      const location = document.location
      if (location?.root !== root.id) continue
      let node: ExplorerNode | undefined = root
      for (const name of location.names) node = node && findExplorerChild(this.state.children.get(node.id) ?? [], name, location.caseInsensitive)
      if (node) nodes.set(node.id, tab)
    }
    return nodes
  }
  async mutate(operation: ExplorerMutation, root: string, node: ExplorerNode, parent: string | null, name: string,
    expected: Pick<EditorDocument['document'], 'id' | 'revision'> | null = this.openFileNodes().get(node.id)?.document ?? null) {
    const generation = this.generation
    const current = () => generation === this.generation && this.state.root?.id === root && this.editor.snapshot().invalidRoot !== root && !this.locked
    const target = node.id === this.state.root?.id ? this.state.root : parent && this.state.children.get(parent)?.find(child => child.id === node.id)
    if (!current() || this.state.busy || this.editor.snapshot().busy) return
    const rename = operation === 'rename-file'
    const open = rename ? this.openFileNodes().get(node.id) : undefined
    if (!validExplorerBasename(name) || !target || target.kind !== (rename ? 'file' : 'directory') ||
        rename && (!parent || open?.unresolved || expected?.id !== open?.document.id || expected?.revision !== open?.document.revision || target.name.toLowerCase() === name.toLowerCase())) {
      this.update({ mutationNotice: 'Confira o nome e o vínculo atual do arquivo antes de renomear.' }); return
    }
    const directory = rename ? parent! : node.id
    this.update({ busy: true, error: null, mutationNotice: null })
    let receipt: ExplorerMutationResult
    try {
      try {
        const method = { 'create-file': 'createFile', 'create-directory': 'createDirectory', 'rename-file': 'renameFile' } as const
        receipt = rename && open && expected ? await this.bridge.renameFile(root, node.id, name, { id: expected.id, revision: expected.revision,
          dirty: open.text !== open.document.text, language: open.language ?? documentLanguage(open.document.name), selection: { ...open.selection } }) :
          await this.bridge[method[operation]](root, node.id, name)
      } catch { receipt = { outcome: 'unconfirmed', message: 'O resultado não foi confirmado. Confira a pasta antes de repetir a operação.' } }
      if (rename && expected && receipt.outcome !== 'refused') this.editor.renamed(expected.id, expected.revision, receipt.outcome === 'confirmed' ? receipt.renamed : undefined)
      if (root !== this.state.root?.id) { this.update({ mutationNotice: 'Projeto anterior: ' + receipt.message }); return }
      this.update({ mutationNotice: receipt.message })
      if (receipt.outcome === 'refused') return
      this.update({ mutationVersion: this.state.mutationVersion + 1, diskVersion: this.state.diskVersion + 1 })
      if (!current()) { this.update({ mutationNotice: receipt.message + ' A árvore não foi atualizada porque o contexto mudou.' }); return }
      try { await this.load(directory, current) }
      catch { if (current()) this.update({ mutationNotice: receipt.message + ' Não foi possível atualizar a árvore.' }); return }
      if (!current()) return
      if (this.state.errors.has(directory)) { this.update({ mutationNotice: receipt.message + ' Não foi possível atualizar a árvore.' }); return }
      this.update({ expanded: new Set([...this.state.expanded, directory]) })
      if (receipt.outcome !== 'confirmed') return
      const child = findExplorerChild(this.state.children.get(directory) ?? [], name)
      if (operation !== 'create-file') { this.focus = child?.id ?? directory; return }
      if (!child || child.kind !== 'file' || child.id !== receipt.createdNode || this.editor.snapshot().busy || this.openFileNodes().has(child.id)) {
        this.update({ mutationNotice: receipt.message + ' O arquivo não foi aberto. Confira a entrada na árvore.' }); return
      }
      const before = this.editor.snapshot()
      const opened = await this.editor.openAuthorized(async draft => {
        const result = await this.bridge.open(root, child.id, draft)
        return !current() || result.invalidRoot === root ? this.editor.reconcileObsoleteOpen(result, before) : result
      })
      if (!current()) return
      if (opened) { this.focus = child.id; this.update({ active: child.id, document: this.editor.snapshot().document?.id ?? null }) }
      else this.update({ mutationNotice: receipt.message + ' O arquivo não foi aberto. ' + (this.editor.snapshot().notice ?? 'Confira a árvore.') })
    } finally { this.update({ busy: false }) }
  }
  async open(node: ExplorerNode) {
    if (this.state.busy || this.locked || this.editor.snapshot().busy || node.kind !== 'file' || !this.state.root) return
    const root = this.state.root.id
    this.update({ busy: true, error: null })
    try {
      const opened = await this.editor.openAuthorized(draft => this.bridge.open(root, node.id, draft))
      if (opened) this.update({ active: node.id, document: this.editor.snapshot().document?.id ?? null })
      else this.update({ error: this.editor.snapshot().error, diskVersion: this.state.diskVersion + 1 })
    } finally { this.update({ busy: false }) }
  }
}
