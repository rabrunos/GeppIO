import { applyEditorText, DOCUMENT_LIMIT, wellFormedText } from '../../../shared/documents.ts'
import type { DocumentBridge, DocumentDraft, DocumentError, DocumentResult, DocumentSnapshot } from '../../../shared/documents.ts'
import { DOCUMENT_LANGUAGES } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'

export interface EditorState { document: DocumentSnapshot | null; text: string; busy: boolean; error: string | null; code: DocumentError | null; cursor: number; language: DocumentLanguage | null }
/** One editable buffer, independent of views, layout, plugin storage and Worker lifecycle. */
export class EditorSession {
  private state: EditorState = { document: null, text: '', busy: false, error: null, code: null, cursor: 0, language: null }
  private listeners = new Set<() => void>()
  readonly bridge: DocumentBridge
  locked = false
  selection = { start: 0, end: 0, top: 0, left: 0 }
  constructor(bridge: DocumentBridge) { this.bridge = bridge }
  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<EditorState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  rememberSelection(value: typeof this.selection) {
    this.selection = value
    if (value.end !== this.state.cursor) this.update({ cursor: value.end })
  }
  setLanguage(language: DocumentLanguage) { if (this.state.document && DOCUMENT_LANGUAGES.includes(language)) this.update({ language }) }
  get dirty() { return !!this.state.document && this.state.text !== this.state.document.text }
  private draft(): DocumentDraft | null { return this.state.document ? { id: this.state.document.id, revision: this.state.document.revision, text: this.state.text } : null }
  edit(value: string) {
    if (!this.state.document || this.state.busy || this.locked) return
    const text = applyEditorText(this.state.text, value)
    if (!wellFormedText(text) || new TextEncoder().encode(text).length + (this.state.document.bom ? 3 : 0) > DOCUMENT_LIMIT) { this.feedback('Edição recusada: limite de 1 MiB em UTF-8. O rascunho anterior foi mantido.'); return }
    this.update({ text })
  }
  feedback(error: string) { this.update({ error }) }
  private async run(action: () => Promise<DocumentResult>): Promise<boolean> {
    if (this.state.busy) return false
    this.update({ busy: true, error: null, code: null })
    try {
      const result = await action()
      if (!result.ok) {
        this.update({ error: result.error, code: result.code, ...(result.confirmed?.id === this.state.document?.id ? { document: result.confirmed } : {}) })
      } else if (result.canceled) {
        if (result.document?.id === this.state.document?.id) this.update({ document: result.document })
      } else {
        if (result.document?.id !== this.state.document?.id) { this.selection = { start: 0, end: 0, top: 0, left: 0 }; this.update({ cursor: 0, language: null }) }
        this.update({ document: result.document, text: result.document?.text ?? '' })
      }
      return result.ok && !result.canceled
    } catch { this.update({ error: 'A comunicação com o Core falhou. Mantenha o rascunho aberto e copie seu conteúdo.', code: 'unavailable' }); return false }
    finally { this.update({ busy: false }) }
  }
  open = () => this.locked ? Promise.resolve() : this.run(() => this.bridge.open(this.draft()))
  openAuthorized = (action: (draft: DocumentDraft | null) => Promise<DocumentResult>) => this.locked ? Promise.resolve(false) : this.run(() => action(this.draft()))
  save = () => this.locked || !this.state.document ? Promise.resolve() : this.run(() => this.bridge.save(this.draft()!))
  release = () => this.locked || !this.state.document ? Promise.resolve() : this.run(() => this.bridge.release(this.draft()!))
  close = async (ticket: string): Promise<void> => {
    if (this.state.busy) await new Promise<void>(resolve => { const stop = this.subscribe(() => { if (!this.state.busy) { stop(); resolve() } }) })
    await this.run(() => this.bridge.close(ticket, this.draft()))
  }
}
