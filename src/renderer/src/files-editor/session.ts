import { applyEditorText, DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, wellFormedText } from '../../../shared/documents.ts'
import type { DocumentBridge, DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot, SaveEntry } from '../../../shared/documents.ts'
import { DOCUMENT_LANGUAGES, documentLanguage } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import { editorText } from '../../../shared/documents.ts'
import type { WorkspaceEditor, WorkspaceSelection } from '../../../shared/workspace.ts'

export interface EditorSelection { start: number; end: number; top: number; left: number }
export interface EditorDocument { document: DocumentSnapshot; text: string; cursor: number; language: DocumentLanguage | null; selection: EditorSelection; error: string | null; code: DocumentError | null; bytes: number; unresolved: boolean; renameUncertain?: boolean; destinationUncertain?: boolean; historyVersion: number }
export interface EditorState { document: DocumentSnapshot | null; text: string; busy: boolean; reloading: string | null; error: string | null; code: DocumentError | null; cursor: number; language: DocumentLanguage | null; diskVersion: number; tabs: readonly EditorDocument[]; notice: string | null; invalidRoot: string | null; projectRoot: string | null; reloadWitness: DocumentSnapshot['location'] }
const emptySelection = (): EditorSelection => ({ start: 0, end: 0, top: 0, left: 0 })
type EditorOperation = 'open' | 'save' | 'saveAs' | 'saveAll' | 'release' | 'close' | 'activate'
/** One bounded registry of drafts, each backed by its own native grant/revision. */
export class EditorSession {
  private state: EditorState = { document: null, text: '', busy: false, reloading: null, error: null, code: null, cursor: 0, language: null, diskVersion: 0, tabs: [], notice: null, invalidRoot: null, projectRoot: null, reloadWitness: undefined }
  private entries = new Map<string, EditorDocument>()
  private initialViews = new Map<string, { language: DocumentLanguage | null; selection: WorkspaceSelection }>()
  private navigationBusy = false
  private navigationWaiters = new Set<() => void>()
  private listeners = new Set<() => void>()
  readonly bridge: DocumentBridge
  beforeClose: (() => Promise<void>) | null = null
  locked = false
  get selection(): EditorSelection { return this.state.document ? this.entries.get(this.state.document.id)?.selection ?? emptySelection() : emptySelection() }
  constructor(bridge: DocumentBridge) { this.bridge = bridge }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<EditorState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  private view(id = this.state.document?.id, patch: Partial<EditorState> = {}) {
    const entry = id ? this.entries.get(id) : undefined
    this.update({ document: entry?.document ?? null, text: entry?.text ?? '', cursor: entry?.cursor ?? 0, language: entry?.language ?? null, error: entry?.error ?? null, code: entry?.code ?? null, tabs: [...this.entries.values()], ...patch })
  }
  private change(id: string, patch: Partial<EditorDocument>) { const entry = this.entries.get(id); if (entry) this.entries.set(id, { ...entry, ...patch }) }
  rememberSelection(value: typeof this.selection) {
    if (!this.state.document) return
    this.change(this.state.document.id, { selection: value, cursor: value.end })
    if (value.end !== this.state.cursor) this.view()
  }
  setLanguage(language: DocumentLanguage) { if (this.state.document && DOCUMENT_LANGUAGES.includes(language)) { this.change(this.state.document.id, { language }); this.view() } }
  setProjectRoot(root: string | null) { if (root !== this.state.projectRoot) this.update({ projectRoot: root }) }
  get dirty() { return !!this.state.document && this.state.text !== this.state.document.text }
  documentState(id: string): Readonly<EditorDocument> | undefined { return this.entries.get(id) }
  editingLocked(id: string) { return this.locked || this.state.busy && (!this.state.reloading || this.state.reloading === id) }
  workspaceState(): WorkspaceEditor { return { active: this.state.document?.id ?? null, tabs: [...this.entries.values()].map(entry => ({ id: entry.document.id, revision: entry.document.revision, dirty: entry.text !== entry.document.text, language: entry.language, selection: { ...entry.selection } })) } }
  restoreViews(views: { id: string; language: DocumentLanguage | null; selection: WorkspaceSelection }[]) { this.initialViews = new Map(views.map(view => [view.id, view])) }
  setNavigationBusy(value: boolean) {
    this.navigationBusy = value
    if (!value) { for (const resolve of this.navigationWaiters) resolve(); this.navigationWaiters.clear() }
  }
  private draft(): DocumentDraft | null { return this.state.document ? { id: this.state.document.id, revision: this.state.document.revision, text: this.state.text } : null }
  private closingDraft(entry: EditorDocument): DocumentDraft {
    return { id: entry.document.id, revision: entry.document.revision, text: entry.text, ...(entry.renameUncertain || entry.destinationUncertain ? { discardOnly: true } : {}) }
  }
  drafts(): DocumentDraft[] { return [...this.entries.values()].map(entry => this.closingDraft(entry)) }
  edit(value: string) {
    return this.accept(applyEditorText(this.state.text, value))
  }
  editExact(value: string, id = this.state.document?.id) {
    const entry = id ? this.entries.get(id) : undefined
    if (!entry) return false
    const text = editorText(value) === editorText(entry.document.text) ? entry.document.text : value
    return this.accept(text, id)
  }
  private accept(text: string, id = this.state.document?.id) {
    const target = id ? this.entries.get(id) : undefined
    if (!target || this.editingLocked(target.document.id)) return false
    const bytes = new TextEncoder().encode(text).length + (target.document.bom ? 3 : 0)
    if (!wellFormedText(text) || bytes > DOCUMENT_LIMIT || [...this.entries.values()].reduce((sum, entry) => sum + (entry.document.id === id ? bytes : entry.bytes), 0) > DOCUMENT_SESSION_LIMITS.bytes) {
      this.change(target.document.id, { error: 'Edição recusada: Unicode inválido ou limite de 1 MiB por arquivo / 8 MiB na sessão. O rascunho anterior foi mantido.', code: 'oversized' }); this.view(); return false
    }
    this.change(target.document.id, { text, bytes }); this.view()
    return true
  }
  feedback(notice: string) { this.update({ notice }) }
  renamed(id: string, revision: string, document?: DocumentSnapshot) {
    const entry = this.entries.get(id)
    if (!entry || entry.document.revision !== revision) return
    if (document?.id === id && document.revision !== revision) {
      this.change(id, { document, language: entry.language ?? documentLanguage(entry.document.name), error: null, code: null })
    } else {
      this.change(id, { unresolved: true, renameUncertain: true, code: 'unconfirmed',
        error: 'Renomeação não confirmada. Copie o rascunho desejado e use Recarregar do disco para conferir o vínculo antes de salvar.' })
    }
    this.view()
  }
  private merge(document: DocumentSnapshot, saved = false) {
    const previous = this.entries.get(document.id)
    // Ordinary inventory/activation can describe a reload whose reply was lost.
    // Metadata may move with the project, but only explicit reconciliation adopts the base.
    if (previous?.unresolved && !saved) document = previous.destinationUncertain ? previous.document : { ...document, revision: previous.document.revision, bom: previous.document.bom, text: previous.document.text }
    const initial = this.initialViews.get(document.id), length = editorText(document.text).length
    const selection = initial ? { ...initial.selection, start: Math.min(initial.selection.start, length), end: Math.min(initial.selection.end, length) } : emptySelection()
    this.entries.set(document.id, previous ? { ...previous, document, ...(previous.document.revision !== document.revision ? { error: null, code: null } : {}) } : { document, text: document.text, cursor: selection.end, language: initial?.language ?? null, selection, error: null, code: null, bytes: new TextEncoder().encode(document.text).length + (document.bom ? 3 : 0), unresolved: false, historyVersion: 0 })
    this.initialViews.delete(document.id)
  }
  private saveSummary(saves: SaveEntry[]) {
    const labels = { saved: 'salvo', clean: 'sem alterações', canceled: 'cancelado', failed: 'falhou', unconfirmed: 'não confirmado', pending: 'pendente' }
    return saves.map(entry => (this.entries.get(entry.id)?.document.name ?? 'Documento') + ' — ' + labels[entry.status]).join(' · ')
  }
  private markPossibleWrites(kind: EditorOperation, target: string | undefined, error: string, code: DocumentError = 'unconfirmed') {
    for (const [id, entry] of this.entries) {
      const affected = kind === 'saveAll' ? entry.document.untitled || entry.text !== entry.document.text
        : kind === 'close' ? entry.text !== entry.document.text : id === target
      if (affected) this.change(id, { error, code, unresolved: true,
        ...(entry.document.untitled || kind === 'saveAs' ? { destinationUncertain: true } : {}) })
    }
  }
  private async run(action: () => Promise<DocumentResult>, kind: EditorOperation, target = this.state.document?.id, ownsNavigation = false): Promise<boolean> {
    if (this.state.busy) return false
    const before = new Map([...this.entries].map(([id, entry]) => [id, entry.document.revision])), active = this.state.document?.id
    this.update({ busy: true, notice: null })
    try {
      if (this.navigationBusy && !ownsNavigation) await new Promise<void>(resolve => this.navigationWaiters.add(resolve))
      const entry = target && this.entries.get(target)
      if (entry && (kind === 'save' && entry.destinationUncertain || (kind === 'save' || kind === 'saveAs') && entry.renameUncertain)) return false
      const result = await action()
      const snapshots = result.documents ?? (result.ok ? result.document ? [result.document] : [] : result.confirmed ? [result.confirmed] : [])
      for (const document of snapshots) {
        const saved = (kind === 'save' || kind === 'saveAs') && target === document.id && result.ok && !result.canceled ||
          result.saves?.some(entry => entry.id === document.id && entry.status === 'saved') === true
        this.merge(document, saved)
        if (saved) this.change(document.id, { error: null, code: null, unresolved: false, destinationUncertain: false })
      }
      // Failed/revoked responses never silently remove a recoverable local draft.
      if (result.ok && !result.canceled) {
        if (result.documents) for (const id of this.entries.keys()) { if (!snapshots.some(value => value.id === id)) this.entries.delete(id) }
        else if (kind === 'release' && !result.document && target) this.entries.delete(target)
        else if (kind === 'close' && !result.document) this.entries.clear()
      }
      const diskChanged = !result.ok && result.code === 'unconfirmed' || snapshots.some(value => before.has(value.id) && before.get(value.id) !== value.revision)
      const diskVersion = this.state.diskVersion + (diskChanged || result.invalidRoot || result.ok && !result.canceled && ['save', 'release', 'close'].includes(kind) ? 1 : 0), invalidRoot = result.invalidRoot ?? null
      if (!result.ok) {
        if (result.code === 'unconfirmed' && !result.failed && !result.saves && (kind === 'saveAll' || kind === 'close')) this.markPossibleWrites(kind, target, result.error)
        const failed = result.failed ?? (['save', 'saveAs', 'release', 'activate'].includes(kind) ? target : undefined)
        if (failed) this.change(failed, { error: result.error, code: result.code, ...(result.code === 'unconfirmed' ? { unresolved: true,
          ...(kind === 'saveAs' || this.entries.get(failed)?.document.untitled ? { destinationUncertain: true } : {}) } : {}) })
        const affected = failed && failed !== active ? this.entries.get(failed)?.document : undefined
        this.view(active, { diskVersion, invalidRoot, notice: affected ? (affected.label ?? affected.name) + ' — ' + result.error : result.error })
      } else this.view(result.canceled ? active : result.document?.id, { diskVersion, invalidRoot, notice: invalidRoot ? 'A pasta do Explorador mudou. Reabra a pasta; as abas foram mantidas.' : null })
      if (result.saves) this.feedback([this.saveSummary(result.saves), !result.ok && result.error].filter(Boolean).join('. '))
      return result.ok && !result.canceled
    } catch {
      const mayHaveSaved = ['save', 'saveAs', 'saveAll', 'release', 'close'].includes(kind)
      const error = mayHaveSaved
        ? 'A resposta do Core não chegou. Mantenha os rascunhos abertos. Copie o texto que deseja guardar e use Recarregar do disco para conferir o arquivo.'
        : 'A comunicação com o Core falhou. Mantenha as abas abertas e copie os rascunhos.'
      if (mayHaveSaved) this.markPossibleWrites(kind, target, error, kind === 'saveAll' ? 'unconfirmed' : 'unavailable')
      else if (target) this.change(target, { error, code: 'unavailable' })
      this.view(active, { notice: error, diskVersion: this.state.diskVersion + (mayHaveSaved ? 1 : 0) }); return false
    }
    finally { this.update({ busy: false }) }
  }
  open = () => this.locked ? Promise.resolve() : this.run(() => this.bridge.open(this.draft()), 'open')
  create = () => this.locked ? Promise.resolve(false) : this.run(() => this.bridge.create(), 'open')
  saveAs = () => this.locked || !this.state.document ? Promise.resolve(false) :
    this.run(() => this.bridge.saveAs(this.draft()!, !!this.entries.get(this.state.document!.id)?.unresolved), 'saveAs')
  saveAll = () => this.locked || !this.entries.size ? Promise.resolve(false) : this.run(() => this.bridge.saveAll(this.drafts()), 'saveAll')
  openAuthorized = (action: (draft: DocumentDraft | null) => Promise<DocumentResult>) => this.locked ? Promise.resolve(false) : this.run(() => action(this.draft()), 'open', this.state.document?.id, true)
  /** Called inside openAuthorized if a project grant expires while its open is in flight. */
  async reconcileObsoleteOpen(result: DocumentResult, before: EditorState): Promise<DocumentResult> {
    const ignored = { ok: true, canceled: true, document: null, invalidRoot: result.invalidRoot } as const
    if (!result.ok || result.canceled || !result.document) return ignored
    const receipt = result.document, active = before.document?.id
    if (active === receipt.id) return ignored
    try {
      if (active) {
        const restored = await this.bridge.activate(active)
        return restored.ok ? { ...ignored, documents: result.documents ?? [receipt] } :
          { ...restored, documents: restored.documents ?? result.documents ?? [receipt], invalidRoot: result.invalidRoot }
      }
      // Only a sole, freshly committed grant, still undisclosed to the renderer model, can be released here.
      const sole = result.documents?.length === 1 ? result.documents[0] : null
      if (!before.tabs.length && !this.documentState(receipt.id) && sole?.id === receipt.id && sole.revision === receipt.revision && sole.text === receipt.text) {
        const released = await this.bridge.release({ id: receipt.id, revision: receipt.revision, text: receipt.text })
        return { ...released, invalidRoot: result.invalidRoot }
      }
      return { ...ignored, documents: result.documents ?? [receipt] }
    } catch { return { ok: false, code: 'unavailable', error: 'A pasta mudou e a aba ativa não pôde ser confirmada. Confira as abas abertas.',
      invalidRoot: result.invalidRoot, documents: result.documents ?? [receipt] } }
  }
  activate = (id: string) => this.locked || this.state.busy || !this.entries.has(id) ? Promise.resolve(false) : this.run(() => this.bridge.activate(id), 'activate', id)
  save = () => this.locked || !this.state.document ? Promise.resolve() : this.run(() => this.bridge.save(this.draft()!), 'save')
  reload = async (): Promise<boolean> => {
    const draft = this.draft(), entry = draft && this.entries.get(draft.id)
    if (!draft || !entry || this.locked || this.state.busy) return false
    if (this.navigationBusy) { this.feedback('Aguarde a operação do Explorador antes de recarregar.'); return false }
    const current = () => this.state.document?.id === draft.id && this.entries.get(draft.id)?.document.revision === draft.revision && this.entries.get(draft.id)?.text === draft.text
    const witness = (document = entry.document) => {
      const location = document.location ?? entry.document.location
      return location && location.root === this.state.projectRoot ? { reloadWitness: { ...location } } : {}
    }
    const lost = () => {
      const error = 'A recarga não pôde ser confirmada. O rascunho foi mantido. Use Recarregar do disco para conferir.'
      this.change(draft.id, { error, code: 'unavailable', unresolved: true })
      this.view(this.state.document?.id, { notice: error, ...witness() })
      return false
    }
    this.update({ busy: true, reloading: draft.id, notice: null })
    try {
      const result = await this.bridge.reload(draft, entry.unresolved)
      if (!result.ok) {
        this.change(draft.id, { error: result.error, code: result.code })
        this.view(this.state.document?.id, { notice: result.error, invalidRoot: result.invalidRoot ?? this.state.invalidRoot })
        return false
      }
      if (result.canceled) return false
      const document = result.document
      if (!current() || !document || document.id !== draft.id || this.locked) return lost()
      const previous = this.entries.get(draft.id)!, length = editorText(document.text).length
      const selection = { ...previous.selection, start: Math.min(previous.selection.start, length), end: Math.min(previous.selection.end, length) }
      this.change(draft.id, { document, renameUncertain: false, destinationUncertain: false, text: document.text, bytes: new TextEncoder().encode(document.text).length + (document.bom ? 3 : 0),
        selection, cursor: selection.end, historyVersion: previous.historyVersion + (editorText(previous.text) === editorText(document.text) ? 0 : 1), error: null, code: null, unresolved: false })
      this.view(draft.id, { notice: 'Arquivo recarregado do disco.', invalidRoot: result.invalidRoot ?? this.state.invalidRoot, ...witness(document) })
      return true
    } catch { return lost() }
    finally { this.update({ busy: false, reloading: null }) }
  }
  release = (id = this.state.document?.id) => {
    const entry = id ? this.entries.get(id) : undefined
    return this.locked || !entry ? Promise.resolve() : this.run(() => this.bridge.release(this.closingDraft(this.entries.get(entry.document.id)!)), 'release', id)
  }
  close = async (ticket: string): Promise<void> => {
    if (this.state.busy) await new Promise<void>(resolve => { const stop = this.subscribe(() => { if (!this.state.busy) { stop(); resolve() } }) })
    await this.run(async () => { await this.beforeClose?.(); return this.bridge.close(ticket, this.drafts()) }, 'close')
  }
}
