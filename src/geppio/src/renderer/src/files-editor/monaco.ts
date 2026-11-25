import {
  acquireWorkers, createBasicEditor, createComparison, createModel, KeyCode, modelCount,
  Range, ScrollType, Selection, setModelLanguage, setTheme
} from '@geppio/editor'
import type { BasicEditor, ComparisonEditor, Disposable, EditorViewState, TextModel } from '@geppio/editor'
import { createViteWorker } from '@geppio/editor/vite-workers'
import '@geppio/editor/styles.css'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, editorText } from '@geppio/runtime/documents'
import { documentLanguage } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import type { EditorSession } from './session.ts'
import type { GroupIndex } from './editor-groups.ts'
import { applyDocumentChanges, DOCUMENT_HISTORY_LIMITS, DocumentHistoryBudget } from '@geppio/runtime/document-edits'
import { modelEndings, applyModelEndings } from './model-eols.ts'

const languages: Record<DocumentLanguage, string> = { 'Texto simples': 'plaintext', JSON: 'json', TypeScript: 'typescript', JavaScript: 'javascript', HTML: 'html', CSS: 'css', Markdown: 'markdown' }
const owners = new WeakMap<EditorSession, MonacoPresentation>()
/** Internal DOM association for built-runtime inspection; no global/preload/plugin API. */
export interface MonacoHost extends HTMLDivElement { readonly monacoEditor?: BasicEditor }
export interface GitDiffHost extends HTMLDivElement { readonly monacoDiffEditor?: ComparisonEditor }

interface ModelOwner { model: TextModel; eols: Map<number, string>; subscription: Disposable; limited: boolean; historyVersion: number; revision: string }

/** Cursor, scrolling and view state belong to each occurrence of a shared model. */
class EditorPane {
  private element = document.createElement('div')
  readonly editor: BasicEditor
  host: MonacoHost | null = null
  id: string | null = null
  private views = new Map<string, EditorViewState>()
  private reloadSelection?: { start: number; end: number }[]
  private reloadScroll?: { scrollTop: number; scrollLeft: number }
  private observer: ResizeObserver
  private subscriptions: Disposable[] = []
  constructor(private session: EditorSession, private side: GroupIndex, private owner: MonacoPresentation) {
    this.element.className = 'monaco-instance'
    this.editor = createBasicEditor(this.element, { automaticLayout: false, ariaLabel: 'Conteúdo do arquivo', fixedOverflowWidgets: false, readOnly: true })
    this.subscriptions.push(this.editor.onDidChangeCursorSelection(() => this.remember()), this.editor.onDidScrollChange(() => this.remember()),
      this.editor.onDidFocusEditorText(() => {
        if (this.id && (this.session.groups.active !== this.side || this.session.focusUnconfirmed)) void this.session.focusGroup(this.side, this.id).then(ok => { if (ok) this.remember(); else this.owner.focusActive() })
        else this.remember()
      }),
      this.editor.onKeyDown(event => {
        const model = this.editor.getModel()
        if (!this.id || !model || !this.owner.limited(this.id) || this.session.editingLocked(this.id) || !(event.ctrlKey || event.metaKey)) return
        if (![KeyCode.KeyZ, KeyCode.KeyY].includes(event.keyCode)) return
        event.preventDefault(); event.stopPropagation()
        if (event.keyCode === KeyCode.KeyY || event.shiftKey) void model.redo()
        else void model.undo()
      }))
    this.observer = new ResizeObserver(() => this.layout())
  }
  remember() {
    const model = this.editor.getModel()
    if (this.owner.changing || !model || !this.id) return
    const selection = this.editor.getSelection()
    if (selection) this.session.rememberSelection({ start: model.getOffsetAt(selection.getSelectionStart()), end: model.getOffsetAt(selection.getPosition()), top: this.editor.getScrollTop(), left: this.editor.getScrollLeft() }, this.side, this.id)
  }
  forget(id: string) {
    if (this.id === id) { this.id = null; this.editor.setModel(null) }
    this.views.delete(id)
  }
  beforeReload(id: string) {
    this.views.delete(id)
    const model = this.editor.getModel()
    if (this.id === id && model) {
      this.reloadSelection = this.editor.getSelections()?.map(s => ({ start: model.getOffsetAt(s.getSelectionStart()), end: model.getOffsetAt(s.getPosition()) }))
      this.reloadScroll = { scrollTop: this.editor.getScrollTop(), scrollLeft: this.editor.getScrollLeft() }
    }
  }
  show(id: string | null, owner?: ModelOwner) {
    const model = owner?.model ?? null, switched = id !== this.id
    if (switched) {
      const oldView = this.id && this.editor.saveViewState()
      if (this.id && oldView) this.views.set(this.id, oldView)
      this.id = id; this.editor.setModel(model)
    }
    if (id && model && (switched || this.reloadSelection)) {
      const saved = this.views.get(id), fallback = this.session.documentState(id)!.selection
      if (saved && !this.reloadSelection) this.editor.restoreViewState(saved)
      else {
        this.editor.setSelections((this.reloadSelection?.length ? this.reloadSelection : [fallback]).map(s => {
          const start = model.getPositionAt(s.start), end = model.getPositionAt(s.end)
          return new Selection(start.lineNumber, start.column, end.lineNumber, end.column)
        }))
        this.editor.setScrollPosition(this.reloadScroll ?? { scrollTop: fallback.top, scrollLeft: fallback.left }, ScrollType.Immediate)
      }
    }
    this.reloadSelection = undefined
    this.reloadScroll = undefined
    this.editor.updateOptions({ readOnly: !id || this.side !== this.session.groups.active || this.session.editingLocked(id) || !!owner?.limited })
    this.diagnostics()
  }
  private diagnostics() {
    if (!this.host) return
    const model = this.editor.getModel()
    this.host.dataset.monacoModel = model?.uri.toString() ?? ''
    this.host.dataset.monacoLanguage = model?.getLanguageId() ?? ''
    this.host.dataset.monacoModels = String(modelCount())
  }
  private layout() { if (this.host) { this.editor.layout({ width: this.host.clientWidth, height: this.host.clientHeight }); this.diagnostics() } }
  attach(host: MonacoHost) {
    this.host = host; host.append(this.element)
    Object.defineProperty(host, 'monacoEditor', { configurable: true, value: this.editor })
    this.observer.observe(host); this.owner.refresh(); this.layout()
    return () => {
      if (this.host !== host) return
      this.remember(); this.observer.unobserve(host); delete (host as { monacoEditor?: unknown }).monacoEditor
      this.element.remove(); this.host = null
    }
  }
  dispose() { this.observer.disconnect(); this.subscriptions.forEach(item => item.dispose()); this.editor.dispose(); this.views.clear(); this.element.remove() }
}

class MonacoPresentation {
  changing = false
  private workers = acquireWorkers(createViteWorker)
  private panes = new Map<GroupIndex, EditorPane>()
  private models = new Map<string, ModelOwner>()
  // Reserve every slot in advance: up to 2 MiB initial EOL tokens and 4 MiB
  // for one full-document refusal repair plus 2 MiB corrective EOL metadata.
  // Accepted history shares the remaining 32 MiB; later tabs retain reserves.
  private history = new DocumentHistoryBudget(DOCUMENT_HISTORY_LIMITS.bytes - DOCUMENT_SESSION_LIMITS.count * DOCUMENT_LIMIT * 8)
  private stopped = false
  private stop: () => void
  private themeObserver: MutationObserver
  constructor(private session: EditorSession) {
    this.themeObserver = new MutationObserver(() => this.theme())
    const root = document.querySelector('.workbench')
    if (root) this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    this.stop = session.subscribe(() => this.sync())
    this.sync(); this.theme()
  }
  connect() { this.stopped = false }
  refresh() { this.sync(); this.theme() }
  limited(id: string) { return !!this.models.get(id)?.limited }
  focusActive() { this.panes.get(this.session.groups.active)?.editor.focus() }
  revealMatch(id: string, line: number, column: number, length: number) {
    const pane = this.panes.get(this.session.groups.active), model = pane?.editor.getModel(), state = this.session.snapshot()
    if (this.stopped || !pane || !model || pane.id !== id || state.document?.id !== id || state.text !== state.document.text || model.getValue() !== editorText(state.text) ||
        line < 1 || line > model.getLineCount() || column < 1 || length < 1 || column + length > model.getLineMaxColumn(line)) return false
    const range = new Range(line, column, line, column + length)
    pane.editor.setSelection(range)
    pane.editor.revealRangeInCenterIfOutsideViewport(range)
    if (pane.host?.isConnected && pane.host.getClientRects().length) pane.editor.focus()
    return true
  }
  dispose() {
    this.stopped = true
    queueMicrotask(() => {
      if (!this.stopped) return
      this.stop(); this.themeObserver.disconnect()
      for (const pane of this.panes.values()) pane.dispose()
      for (const [id, owner] of this.models) { owner.subscription.dispose(); owner.model.dispose(); this.history.release(id) }
      this.models.clear(); this.panes.clear()
      this.workers.dispose(); owners.delete(this.session)
    })
  }
  private sync() {
    if (this.changing) return
    const state = this.session.snapshot()
    this.changing = true
    try {
      for (const [id, owner] of this.models) if (!state.tabs.some(tab => tab.document.id === id)) {
        for (const pane of this.panes.values()) pane.forget(id)
        owner.subscription.dispose(); owner.model.dispose(); this.models.delete(id); this.history.release(id)
      }
      for (const tab of state.tabs) if (!this.models.has(tab.document.id)) {
        const id = tab.document.id, model = createModel(editorText(tab.text), languages[tab.language ?? documentLanguage(tab.document.name)], { namespace: 'geppio', id })
        const eols = new Map([[model.getAlternativeVersionId(), modelEndings(tab.text)]])
        const subscription = model.onDidChangeContent(event => {
          if (this.changing) return
          const document = this.session.documentState(id)
          if (!document) return
          const exact = document.text, before = editorText(exact), normalized = model.getValue()
          const version = model.getAlternativeVersionId(), pattern = eols.get(version)
          // Native selection replacement may arrive as delete then insert. Retain the file's
          // convention through the temporary empty draft instead of accidentally switching to LF.
          const newline = document.document.text.match(/\r\n|\r|\n/)?.[0] ?? '\n'
          let candidate = applyDocumentChanges(exact, event.changes, newline)
          if ((event.isUndoing || event.isRedoing) && pattern !== undefined) candidate = applyModelEndings(normalized, pattern)
          const nextPattern = modelEndings(candidate), cost = nextPattern.length * 2 + event.changes.reduce((sum, change) => sum + 128 + (change.rangeLength + change.text.length) * 2, 0)
          const known = pattern !== undefined && (event.isUndoing || event.isRedoing)
          const capacity = known || !this.models.get(id)?.limited && this.history.fits(id, cost)
          if (!capacity) {
            this.models.get(id)!.limited = true
            this.session.feedback('Limite de histórico atingido (96 MiB reservados na sessão ou 20.000 versões por aba). Desfaça/refaça, copie ou salve; feche e reabra a aba para continuar editando. Nenhum rascunho foi descartado.')
          }
          if (!capacity || !this.session.editExact(candidate, id)) {
            this.changing = true
            try {
              // Undo the refused edit with public APIs; a grouped edit may include accepted typing.
              model.undo()
              if (model.getValue() !== before) {
                model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: before }], () => null)
                // Spend this model's reserved repair once, then block new typing.
                // Undo/redo of retained versions remain available. Record the
                // corrective version's exact EOLs as well as its bounded text.
                this.models.get(id)!.limited = true
                eols.set(model.getAlternativeVersionId(), modelEndings(exact))
                this.session.feedback('Edição recusada; o rascunho foi recuperado com o histórico preservado. Salve ou copie e feche/reabra esta aba para continuar editando. Desfazer/refazer continua disponível.')
              }
              model.pushStackElement()
            } finally { this.changing = false }
          } else { if (!known) this.history.retain(id, cost); eols.set(version, modelEndings(this.session.documentState(id)!.text)) }
          this.sync()
          this.panes.get(this.session.groups.active)?.remember()
        })
        this.models.set(id, { model, eols, subscription, limited: false, historyVersion: tab.historyVersion, revision: tab.document.revision })
      }
      for (const tab of state.tabs) {
        const id = tab.document.id, owner = this.models.get(id)!
        if (owner.historyVersion !== tab.historyVersion) {
          for (const pane of this.panes.values()) pane.beforeReload(id)
          owner.model.setValue(editorText(tab.text)); this.history.release(id)
          owner.eols.clear(); owner.limited = false; owner.historyVersion = tab.historyVersion
        }
        if (owner.revision !== tab.document.revision) owner.eols.set(owner.model.getAlternativeVersionId(), modelEndings(tab.text))
        owner.revision = tab.document.revision
        const language = languages[tab.language ?? documentLanguage(tab.document.name)]
        if (owner.model.getLanguageId() !== language) setModelLanguage(owner.model, language)
      }
      for (const [side, pane] of this.panes) {
        const id = this.session.groups.sides[side].selected
        pane.show(id, id ? this.models.get(id) : undefined)
      }
    } finally { this.changing = false }
    const id = state.document?.id
    if (id && this.limited(id) && !state.busy && !state.notice && !state.error) this.session.feedback('Esta aba atingiu um limite de histórico ou precisou recuperar uma edição recusada. Desfaça/refaça, salve ou copie; feche e reabra a aba para continuar editando.')
  }
  private theme() { setTheme(document.querySelector('.workbench')?.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark') }
  attach(host: MonacoHost, side: GroupIndex = 0) {
    let pane = this.panes.get(side)
    if (!pane) { pane = new EditorPane(this.session, side, this); this.panes.set(side, pane) }
    return pane.attach(host)
  }
}
export function monacoPresentation(session: EditorSession) {
  let owner = owners.get(session)
  if (!owner) { owner = new MonacoPresentation(session); owners.set(session, owner) }
  return owner
}

/** Disposable public Diff Editor; never observes or updates the editable session/model. */
export function createGitDiff(host: GitDiffHost, comparison: import('../../../shared/git.ts').GitComparison): () => void {
  const workers = acquireWorkers(createViteWorker)
  const diff = createComparison(host, comparison.original, comparison.modified)
  host.dataset.gitDiffModels = '2'
  Object.defineProperty(host, 'monacoDiffEditor', { configurable: true, value: diff.editor })
  return () => {
    diff.dispose()
    workers.dispose()
    delete host.dataset.gitDiffModels
    delete (host as { monacoDiffEditor?: unknown }).monacoDiffEditor
  }
}
