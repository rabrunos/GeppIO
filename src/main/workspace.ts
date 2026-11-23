import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { DirectoryStore, inspectExplorerPath, safeExplorerName } from './explorer.ts'
import { DocumentStore } from './documents.ts'
import { WorkspaceRecovery, WorkspaceRecoveryCanceled, emptyWorkspaceRecord } from './workspace-recovery.ts'
import type { WorkspaceRecord } from './workspace-recovery.ts'
import { mapTabArrangement } from '../shared/workspace.ts'
import type { TabArrangement, WorkspaceEditor, WorkspaceResult, WorkspaceStatus, WorkspaceView } from '../shared/workspace.ts'
import { DOCUMENT_SESSION_LIMITS } from '../shared/documents.ts'

/** One project identity, reusing the window's existing directory and file owners. */
export class WorkspaceOwner {
  private views = new Map<string, WorkspaceView>()
  private arrangement?: TabArrangement<string>
  private missingFiles?: { source: WorkspaceRecord; indices: Set<number> }
  private message: string | null = null
  private transition = false
  private epoch = 0
  readonly directories: DirectoryStore
  readonly documents: DocumentStore
  readonly recovery: WorkspaceRecovery
  private changed: () => void
  constructor(directories: DirectoryStore, documents: DocumentStore, recovery: WorkspaceRecovery, changed: () => void) { this.directories = directories; this.documents = documents; this.recovery = recovery; this.changed = changed }
  revoke() { this.epoch++; this.views.clear(); this.arrangement = undefined; this.missingFiles = undefined; this.message = null; this.transition = false }
  guard() { const epoch = this.epoch; return () => epoch === this.epoch }
  rememberRenamedView(view: WorkspaceView, revision: string) { this.views.set(view.id, { ...structuredClone(view), revision }) }
  hasFileBinding(path: string) {
    if (this.documents.hasFileAt(path)) return true
    const { project, files } = this.recovery.snapshot.record
    return !!project && files.some(file => relative(join(project.path, ...file.names), path) === '')
  }
  async read(): Promise<WorkspaceStatus> { await this.recovery.load(); return this.status() }
  status(): WorkspaceStatus {
    const { record, error } = this.recovery.snapshot
    return { root: this.transition ? null : this.directories.snapshot, remember: record.remember, recovery: record.project ? { name: basename(record.project.path).slice(0, 255) || 'Projeto', tabs: record.files.length, unsaved: record.files.filter(file => file.dirty).length } : null, error, notice: this.message }
  }
  private record(clean = false, remember = this.recovery.snapshot.record.remember, exclude?: string): WorkspaceRecord {
    const project = this.directories.descriptor
    if (!remember || !project) return emptyWorkspaceRecord(remember)
    const files: WorkspaceRecord['files'] = [], indices = new Map<string, number>(); let active = -1
    for (const document of this.documents.snapshots) {
      if (document.id === exclude) continue
      const path = this.documents.filePath(document.id), inside = path ? relative(project.path, path) : ''
      const names = inside.split(sep), hash = this.documents.fingerprint(document.id)
      if (!inside || isAbsolute(inside) || names.length > 32 || !names.every(name => safeExplorerName(name) && name.toLowerCase() !== '.git') || !hash) continue
      const view = this.views.get(document.id)
      indices.set(document.id, files.length)
      if (document.id === this.documents.snapshot?.id) active = files.length
      files.push({ names, hash, dirty: clean ? false : view?.dirty ?? false, language: view?.language ?? null, selection: view?.selection ?? { start: 0, end: 0, top: 0, left: 0 } })
    }
    const arrangement = this.arrangement && mapTabArrangement(this.arrangement, indices, [...indices.values()])
    const candidate: WorkspaceRecord = { schemaVersion: 1, remember, project, files, active, ...(arrangement ? { arrangement } : {}) }
    this.retainMissing(candidate)
    return candidate
  }
  private retainMissing(candidate: WorkspaceRecord) {
    const pending = this.missingFiles
    if (!pending || !candidate.project || pending.source.project?.chain !== candidate.project.chain || pending.source.project.path !== candidate.project.path) return
    const pathKey = (names: string[]) => process.platform === 'win32' ? names.join('/').toLowerCase() : names.join('/')
    const live = new Map(candidate.files.map((file, index) => [pathKey(file.names), index]))
    const historical = new Map<number, number>(), missing = new Set<number>()
    for (const [index, file] of pending.source.files.entries()) {
      const slot = live.get(pathKey(file.names))
      if (slot !== undefined) { historical.set(index, slot); pending.indices.delete(index) }
      else if (pending.indices.has(index)) {
        if (candidate.files.length >= DOCUMENT_SESSION_LIMITS.count) throw new Error('A lembrança anterior foi preservada porque inclui arquivos indisponíveis e atingiu o limite de abas.')
        missing.add(index); historical.set(index, candidate.files.length); candidate.files.push(structuredClone(file))
      }
    }
    const layout = candidate.arrangement
    if (!layout) return
    const saved = pending.source.arrangement
    for (const side of [0, 1] as const) {
      const before = saved?.sides[side] ?? (side === 0 ? [...pending.source.files.keys()] : [])
      const group = layout.split ? side : 0, tabs = layout.sides[group]
      for (const [position, index] of before.entries()) if (missing.has(index)) {
        const slot = historical.get(index)!
        if (!tabs.includes(slot)) {
          const following = before.slice(position + 1).map(i => historical.get(i)).find(i => i !== undefined && tabs.includes(i))
          tabs.splice(following === undefined ? tabs.length : tabs.indexOf(following), 0, slot)
        }
        if (saved?.pinned.includes(index) && !layout.pinned.includes(slot)) layout.pinned.push(slot)
      }
      layout.selected[group] ??= tabs[0] ?? null
    }
  }
  async persist(current: () => boolean, clean = false, exclude?: string) {
    await this.recovery.load()
    // An unselected startup/standalone context must not erase offered history.
    if (!this.recovery.snapshot.record.remember || !this.directories.snapshot) return true
    const directoryCurrent = this.directories.guard()
    try { await this.recovery.save(this.record(clean, true, exclude), () => current() && directoryCurrent()); this.message = null; return true }
    catch (error) { if (!(error instanceof WorkspaceRecoveryCanceled)) this.message = 'A sessão não foi lembrada. Os arquivos e rascunhos abertos foram mantidos.'; return false }
  }
  async opened(path: string, current: () => boolean) {
    await this.recovery.load()
    this.validateSeparateStorage(path)
    await this.directories.select(path, current); this.changed(); this.message = null
    await this.persist(current)
    return this.status()
  }
  private validateSeparateStorage(project: string) {
    const profile = this.recovery.directoryPath
    if (!profile) throw new Error('Diretório local de recuperação indisponível.')
    const inside = relative(project, profile)
    if (!inside || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) throw new Error('Escolha uma pasta de projeto que não contenha os dados locais do GeppIO.')
  }
  async close(root: string, current: () => boolean, standalone?: string) {
    if (root !== this.directories.snapshot?.id) throw new Error('Projeto expirado.')
    await this.persist(current, false, standalone)
    if (!current()) throw new Error('Projeto expirado.')
    this.directories.release(root); this.changed()
    this.message = 'Projeto fechado. As abas abertas e o Terminal continuam nesta sessão.'
    return this.status()
  }
  async configure(remember: boolean, current: () => boolean) {
    await this.recovery.load(); await this.recovery.save(this.record(false, remember), current)
    if (!remember) this.missingFiles = undefined
    return this.status()
  }
  async forget(current: () => boolean) { await this.recovery.forget(current); this.missingFiles = undefined; this.message = 'Recuperação local removida. As abas e o Terminal continuam abertos.'; return this.status() }
  async remember(editor: WorkspaceEditor, current: () => boolean) {
    const held = this.documents.snapshots
    if (editor.tabs.length !== held.length || editor.tabs.some(view => !held.some(document => document.id === view.id && document.revision === view.revision))) throw new Error('A sessão de arquivos mudou; a lembrança será atualizada após a operação.')
    this.views = new Map(editor.tabs.map(view => [view.id, structuredClone(view)]))
    this.arrangement = editor.arrangement && structuredClone(editor.arrangement)
    await this.persist(current)
    return this.status()
  }
  async restore(current: () => boolean, confirm: (name: string, path: string, unsaved: number) => Promise<boolean>, decideChanged: (name: string) => Promise<'current' | 'skip' | 'cancel'>): Promise<WorkspaceResult> {
    await this.recovery.load()
    const { record, error } = this.recovery.snapshot
    if (error || !record.project) throw new Error(error ?? 'Nenhum projeto anterior disponível.')
    if (this.documents.snapshots.length || this.directories.snapshot) throw new Error('Já há trabalho aberto. Abra o projeto explicitamente para manter as abas atuais.')
    const expected = record.project, root = await inspectExplorerPath(expected.path, 'directory')
    this.validateSeparateStorage(expected.path)
    if (!current() || root.chain !== expected.chain) throw new Error('O projeto anterior mudou ou foi movido. Selecione a pasta novamente. A lembrança foi mantida.')
    if (!await confirm(basename(expected.path), expected.path, record.files.filter(file => file.dirty).length)) return { ok: true, value: this.status(), canceled: true }
    if (!current()) throw new Error('Restauração expirada.')
    this.transition = true
    const views: NonNullable<Extract<WorkspaceResult, { ok: true }>['views']> = [], restored = new Map<number, string>()
    const missingIndices = new Set<number>()
    let committed = false, missing = 0, changed = 0
    try {
      // The dialog never makes an old authority valid again.
      const actual = await inspectExplorerPath(expected.path, 'directory')
      if (!current() || actual.chain !== expected.chain) throw new Error('O projeto mudou durante a confirmação. Selecione a pasta novamente.')
      await this.directories.select(expected.path, current); this.changed()
      const selected = this.directories.snapshot!
      for (const [index, file] of record.files.entries()) {
        if (!current()) throw new Error('Restauração expirada.')
        let id: string | null = null
        try {
          const path = await this.directories.resolveFile(selected.id, file.names, current)
          const result = await this.documents.select(path, null, async () => 'cancel', current, async () => { await this.directories.resolveFile(selected.id, file.names, current) })
          if (!result.ok || !result.document) throw new Error('Arquivo indisponível.')
          id = result.document.id
          const different = this.documents.fingerprint(id) !== file.hash
          if (different) {
            const decision = await decideChanged(file.names.join('/'))
            if (!current()) throw new Error('Restauração expirada.')
            if (decision === 'cancel') return { ok: true, value: { ...this.status(), root: null }, canceled: true }
            if (decision === 'skip') { await this.documents.release({ id, revision: result.document.revision, text: result.document.text }, async () => 'discard', current); continue }
          }
          await this.documents.validate(id, current)
          if (different) changed++
          restored.set(index, id)
          if (!different && !file.dirty) views.push({ id, language: file.language, selection: file.selection })
        } catch {
          if (!current()) throw new Error('Restauração expirada.')
          if (id) { const document = this.documents.snapshots.find(value => value.id === id); if (document) await this.documents.release({ id, revision: document.revision, text: document.text }, async () => 'discard', current) }
          missing++; missingIndices.add(index)
        }
      }
      this.views.clear()
      this.missingFiles = missing ? { source: record, indices: missingIndices } : undefined
      this.arrangement = record.arrangement && mapTabArrangement(record.arrangement, restored, [...restored.values()])
      if (this.arrangement && this.arrangement.selected[this.arrangement.active] === null) {
        const other = this.arrangement.active === 0 ? 1 : 0
        if (this.arrangement.selected[other] !== null) this.arrangement.active = other
      }
      const active = (this.arrangement && this.arrangement.selected[this.arrangement.active]) ?? restored.get(record.active) ?? restored.values().next().value
      if (active) this.documents.activate(active)
      this.message = [missing ? `${missing} aba(s) indisponível(is) não foram abertas.` : '', changed ? `${changed} arquivo(s) alterado(s) foram abertos pela decisão explícita.` : '', record.files.some(file => file.dirty) ? 'Rascunhos não salvos não foram recuperados; apenas o conteúdo atual do disco foi aberto.' : 'Projeto e arquivos salvos restaurados. Undo e processos não são restaurados.'].filter(Boolean).join(' ')
      committed = true
      return { ok: true, value: { ...this.status(), root: this.directories.snapshot }, documents: this.documents.result(), views, ...(this.arrangement ? { arrangement: structuredClone(this.arrangement) } : {}) }
    } finally {
      this.transition = false
      if (!committed) { this.documents.revoke(); this.directories.revoke(); this.changed() }
    }
  }
  /** Captured at explicit Start, checked again after every asynchronous boundary. */
  startupDirectory() {
    const stable = !this.transition, root = this.directories.snapshot, directoryCurrent = this.directories.guard(), ownerCurrent = this.guard()
    const current = () => stable && !this.transition && ownerCurrent() && directoryCurrent() && this.directories.snapshot?.id === root?.id
    return { current, resolve: async () => {
      if (!current()) throw new Error('Projeto mudou durante a inicialização.')
      if (!root) return { path: homedir(), note: null }
      try { return { path: await this.directories.folder(root.id, current), note: null } }
      catch {
        if (!current()) throw new Error('Projeto mudou durante a inicialização.')
        return { path: homedir(), note: 'Pasta do projeto indisponível; esta sessão iniciou na pasta pessoal. Reabra o projeto antes de iniciar outro Terminal.' }
      }
    } }
  }
}
