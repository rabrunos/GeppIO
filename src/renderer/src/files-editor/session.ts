import { applyEditorText, DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, wellFormedText } from '../../../shared/documents.ts'
import type { DocumentBridge, DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot } from '../../../shared/documents.ts'
import { DOCUMENT_LANGUAGES } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import { editorText } from '../../../shared/documents.ts'
import type { WorkspaceEditor, WorkspaceSelection } from '../../../shared/workspace.ts'

export interface EditorSelection { start: number; end: number; top: number; left: number }
export interface EditorDocument { document: DocumentSnapshot; text: string; cursor: number; language: DocumentLanguage | null; selection: EditorSelection; error: string | null; code: DocumentError | null; bytes: number }
export interface EditorState { document: DocumentSnapshot | null; text: string; busy: boolean; error: string | null; code: DocumentError | null; cursor: number; language: DocumentLanguage | null; diskVersion: number; tabs: readonly EditorDocument[]; notice: string | null; invalidRoot: string | null; projectRoot: string | null }
const emptySelection = (): EditorSelection => ({ start: 0, end: 0, top: 0, left: 0 })
/** One bounded registry of drafts, each backed by its own native grant/revision. */
export class EditorSession {
  private state: EditorState = { document: null, text: '', busy: false, error: null, code: null, cursor: 0, language: null, diskVersion: 0, tabs: [], notice: null, invalidRoot: null, projectRoot: null }
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
  workspaceState(): WorkspaceEditor { return { active: this.state.document?.id ?? null, tabs: [...this.entries.values()].map(entry => ({ id: entry.document.id, revision: entry.document.revision, dirty: entry.text !== entry.document.text, language: entry.language, selection: { ...entry.selection } })) } }
  restoreViews(views: { id: string; language: DocumentLanguage | null; selection: WorkspaceSelection }[]) { this.initialViews = new Map(views.map(view => [view.id, view])) }
  setNavigationBusy(value: boolean) {
    this.navigationBusy = value
    if (!value) { for (const resolve of this.navigationWaiters) resolve(); this.navigationWaiters.clear() }
  }
  private draft(): DocumentDraft | null { return this.state.document ? { id: this.state.document.id, revision: this.state.document.revision, text: this.state.text } : null }
  drafts(): DocumentDraft[] { return [...this.entries.values()].map(value => ({ id: value.document.id, revision: value.document.revision, text: value.text })) }
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
    if (!target || this.state.busy || this.locked) return false
    const bytes = new TextEncoder().encode(text).length + (target.document.bom ? 3 : 0)
    if (!wellFormedText(text) || bytes > DOCUMENT_LIMIT || [...this.entries.values()].reduce((sum, entry) => sum + (entry.document.id === id ? bytes : entry.bytes), 0) > DOCUMENT_SESSION_LIMITS.bytes) {
      this.change(target.document.id, { error: 'Edição recusada: Unicode inválido ou limite de 1 MiB por arquivo / 8 MiB na sessão. O rascunho anterior foi mantido.', code: 'oversized' }); this.view(); return false
    }
    this.change(target.document.id, { text, bytes }); this.view()
    return true
  }
  feedback(notice: string) { this.update({ notice }) }
  private merge(document: DocumentSnapshot) {
    const previous = this.entries.get(document.id)
    const initial = this.initialViews.get(document.id), length = editorText(document.text).length
    const selection = initial ? { ...initial.selection, start: Math.min(initial.selection.start, length), end: Math.min(initial.selection.end, length) } : emptySelection()
    this.entries.set(document.id, previous ? { ...previous, document, ...(previous.document.revision !== document.revision ? { error: null, code: null } : {}) } : { document, text: document.text, cursor: selection.end, language: initial?.language ?? null, selection, error: null, code: null, bytes: new TextEncoder().encode(document.text).length + (document.bom ? 3 : 0) })
    this.initialViews.delete(document.id)
  }
  private async run(action: () => Promise<DocumentResult>, kind: 'open' | 'save' | 'release' | 'close' | 'activate', target = this.state.document?.id, ownsNavigation = false): Promise<boolean> {
    if (this.state.busy) return false
    const before = new Map([...this.entries].map(([id, entry]) => [id, entry.document.revision])), active = this.state.document?.id
    this.update({ busy: true, notice: null })
    try {
      if (this.navigationBusy && !ownsNavigation) await new Promise<void>(resolve => this.navigationWaiters.add(resolve))
      const result = await action()
      const snapshots = result.documents ?? (result.ok ? result.document ? [result.document] : [] : result.confirmed ? [result.confirmed] : [])
      for (const document of snapshots) this.merge(document)
      // Failed/revoked responses never silently remove a recoverable local draft.
      if (result.ok && !result.canceled) {
        if (result.documents) for (const id of this.entries.keys()) { if (!snapshots.some(value => value.id === id)) this.entries.delete(id) }
        else if (kind === 'release' && !result.document && target) this.entries.delete(target)
        else if (kind === 'close' && !result.document) this.entries.clear()
        if (kind === 'save' && target) this.change(target, { error: null, code: null })
      }
      const diskChanged = !result.ok && result.code === 'unconfirmed' || snapshots.some(value => before.has(value.id) && before.get(value.id) !== value.revision)
      const diskVersion = this.state.diskVersion + (diskChanged || result.invalidRoot || result.ok && !result.canceled && ['save', 'release', 'close'].includes(kind) ? 1 : 0), invalidRoot = result.invalidRoot ?? null
      if (!result.ok) {
        const failed = result.failed ?? (['save', 'release', 'activate'].includes(kind) ? target : undefined)
        if (failed) this.change(failed, { error: result.error, code: result.code })
        const affected = failed && failed !== active ? this.entries.get(failed)?.document : undefined
        this.view(active, { diskVersion, invalidRoot, notice: affected ? (affected.label ?? affected.name) + ' — ' + result.error : result.error })
      } else this.view(result.canceled ? active : result.document?.id, { diskVersion, invalidRoot, notice: invalidRoot ? 'A pasta do Explorador mudou. Reabra a pasta; as abas foram mantidas.' : null })
      return result.ok && !result.canceled
    } catch {
      const mayHaveSaved = kind === 'save' || kind === 'release' || kind === 'close'
      const error = mayHaveSaved
        ? 'A resposta do Core não chegou. Mantenha os rascunhos abertos, copie o texto e confira o arquivo no disco antes de salvar novamente.'
        : 'A comunicação com o Core falhou. Mantenha as abas abertas e copie os rascunhos.'
      if (target) this.change(target, { error, code: 'unavailable' })
      this.view(active, { notice: error, diskVersion: this.state.diskVersion + (mayHaveSaved ? 1 : 0) }); return false
    }
    finally { this.update({ busy: false }) }
  }
  open = () => this.locked ? Promise.resolve() : this.run(() => this.bridge.open(this.draft()), 'open')
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
  release = (id = this.state.document?.id) => {
    const entry = id ? this.entries.get(id) : undefined
    return this.locked || !entry ? Promise.resolve() : this.run(() => this.bridge.release({ id: entry.document.id, revision: entry.document.revision, text: entry.text }), 'release', id)
  }
  close = async (ticket: string): Promise<void> => {
    if (this.state.busy) await new Promise<void>(resolve => { const stop = this.subscribe(() => { if (!this.state.busy) { stop(); resolve() } }) })
    await this.run(async () => { await this.beforeClose?.(); return this.bridge.close(ticket, this.drafts()) }, 'close')
  }
}
