import * as monaco from 'monaco-editor/editor'
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/javascript/register'
import 'monaco-editor/languages/definitions/typescript/register'
import 'monaco-editor/languages/definitions/html/register'
import 'monaco-editor/languages/definitions/css/register'
import 'monaco-editor/languages/definitions/markdown/register'
import 'monaco-editor/languages/features/json/register'
import 'monaco-editor/languages/features/typescript/register'
import 'monaco-editor/languages/features/html/register'
import 'monaco-editor/languages/features/css/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, editorText } from '../../../shared/documents.ts'
import { documentLanguage } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import type { EditorSession } from './session.ts'
import { applyDocumentChanges, DOCUMENT_HISTORY_LIMITS, DocumentHistoryBudget } from '../../../shared/document-edits.ts'

const workers = new Set<Worker>()
globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    const worker = label === 'json' ? new JsonWorker() : label === 'typescript' || label === 'javascript' ? new TypeScriptWorker()
      : ['html', 'handlebars', 'razor'].includes(label) ? new HtmlWorker() : ['css', 'scss', 'less'].includes(label) ? new CssWorker() : new EditorWorker()
    workers.add(worker)
    return worker
  }
}
const languages: Record<DocumentLanguage, string> = { 'Texto simples': 'plaintext', JSON: 'json', TypeScript: 'typescript', JavaScript: 'javascript', HTML: 'html', CSS: 'css', Markdown: 'markdown' }
const owners = new WeakMap<EditorSession, MonacoPresentation>()
/** Internal DOM association for built-runtime inspection; no global/preload/plugin API. */
export interface MonacoHost extends HTMLDivElement { readonly monacoEditor?: monaco.editor.IStandaloneCodeEditor }
export interface GitDiffHost extends HTMLDivElement { readonly monacoDiffEditor?: monaco.editor.IStandaloneDiffEditor }

interface ModelOwner { model: monaco.editor.ITextModel; eols: Map<number, string>; view: monaco.editor.ICodeEditorViewState | null; subscription: monaco.IDisposable; limited: boolean }
/** One editor, one stable model/undo history per native document grant. */
class MonacoPresentation {
  private element = document.createElement('div')
  private editor: monaco.editor.IStandaloneCodeEditor
  private model: monaco.editor.ITextModel | null = null
  private id: string | undefined
  private host: MonacoHost | null = null
  private changing = false
  private models = new Map<string, ModelOwner>()
  // Reserve every slot in advance: up to 2 MiB initial EOL tokens and 4 MiB
  // for one full-document refusal repair plus 2 MiB corrective EOL metadata.
  // Accepted history shares the remaining 32 MiB; later tabs retain reserves.
  private history = new DocumentHistoryBudget(DOCUMENT_HISTORY_LIMITS.bytes - DOCUMENT_SESSION_LIMITS.count * DOCUMENT_LIMIT * 8)
  private stopped = false
  private stop: () => void
  private observer: ResizeObserver
  private themeObserver: MutationObserver
  private subscriptions: monaco.IDisposable[] = []
  constructor(private session: EditorSession) {
    this.element.className = 'monaco-instance'
    this.editor = monaco.editor.create(this.element, { model: null, automaticLayout: false, ariaLabel: 'Conteúdo do arquivo', theme: 'vs-dark', fontFamily: 'Consolas, monospace', fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, fixedOverflowWidgets: false, readOnly: true })
    this.subscriptions.push(this.editor.onDidChangeCursorSelection(() => this.remember()), this.editor.onDidScrollChange(() => this.remember()))
    this.subscriptions.push(this.editor.onKeyDown(event => {
      // At a history limit, keep ordinary typing read-only while still allowing
      // the user to inspect/undo/redo the retained history before saving/closing.
      if (!this.id || !this.models.get(this.id)?.limited || this.session.snapshot().busy || this.session.locked || !(event.ctrlKey || event.metaKey)) return
      if (![monaco.KeyCode.KeyZ, monaco.KeyCode.KeyY].includes(event.keyCode)) return
      event.preventDefault(); event.stopPropagation()
      if (event.keyCode === monaco.KeyCode.KeyY || event.shiftKey) void this.model?.redo()
      else void this.model?.undo()
    }))
    this.observer = new ResizeObserver(() => this.layout())
    this.themeObserver = new MutationObserver(() => this.theme())
    const root = document.querySelector('.workbench')
    if (root) this.themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    this.stop = session.subscribe(() => this.sync())
    this.sync(); this.theme()
  }
  connect() { this.stopped = false }
  refresh() { this.sync() }
  dispose() {
    this.stopped = true
    // React StrictMode replays effects in the same turn; only final teardown destroys ownership.
    queueMicrotask(() => {
      if (!this.stopped) return
      this.stop(); this.observer.disconnect(); this.themeObserver.disconnect()
      this.subscriptions.forEach(item => item.dispose()); this.editor.dispose()
      for (const [id, owner] of this.models) { owner.subscription.dispose(); owner.model.dispose(); this.history.release(id) }
      this.models.clear()
      workers.forEach(worker => worker.terminate()); workers.clear()
      this.element.remove(); owners.delete(this.session)
    })
  }
  private sync() {
    const state = this.session.snapshot()
    this.changing = true
    try {
      for (const [id, owner] of this.models) if (!state.tabs.some(tab => tab.document.id === id)) {
        if (this.model === owner.model) { this.editor.setModel(null); this.model = null }
        owner.subscription.dispose(); owner.model.dispose(); this.models.delete(id); this.history.release(id)
      }
      for (const tab of state.tabs) if (!this.models.has(tab.document.id)) {
        const id = tab.document.id, model = monaco.editor.createModel(editorText(tab.text), languages[tab.language ?? documentLanguage(tab.document.name)], monaco.Uri.from({ scheme: 'inmemory', authority: 'geppio', path: '/' + id }))
        model.setEOL(monaco.editor.EndOfLineSequence.LF)
        const eols = new Map([[model.getAlternativeVersionId(), this.eolPattern(tab.text)]])
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
          if ((event.isUndoing || event.isRedoing) && pattern !== undefined) {
            let i = 0
            candidate = normalized.replaceAll('\n', () => ({ C: '\r\n', R: '\r', L: '\n' })[pattern[i++]!] ?? '\n')
          }
          const nextPattern = this.eolPattern(candidate), cost = nextPattern.length * 2 + event.changes.reduce((sum, change) => sum + 128 + (change.rangeLength + change.text.length) * 2, 0)
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
                eols.set(model.getAlternativeVersionId(), this.eolPattern(exact))
                this.session.feedback('Edição recusada; o rascunho foi recuperado com o histórico preservado. Salve ou copie e feche/reabra esta aba para continuar editando. Desfazer/refazer continua disponível.')
              }
              model.pushStackElement()
            } finally { this.changing = false }
          } else { if (!known) this.history.retain(id, cost); eols.set(version, this.eolPattern(this.session.documentState(id)!.text)) }
          this.sync()
          this.remember()
        })
        this.models.set(id, { model, eols, subscription, view: null, limited: false })
      }
      if (this.id !== state.document?.id) {
        const previous = this.id ? this.models.get(this.id) : undefined
        if (previous && this.editor.getModel() === previous.model) previous.view = this.editor.saveViewState()
        this.id = state.document?.id
        const owner = this.id ? this.models.get(this.id) : undefined
        this.model = owner?.model ?? null; this.editor.setModel(this.model)
        if (owner?.view) this.editor.restoreViewState(owner.view)
        else if (this.model) {
          const selection = this.session.selection, start = this.model.getPositionAt(selection.start), end = this.model.getPositionAt(selection.end)
          this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column))
          this.editor.setScrollPosition({ scrollTop: selection.top, scrollLeft: selection.left })
        }
      }
    } finally { this.changing = false }
    if (this.model && state.document) {
      const language = languages[state.language ?? documentLanguage(state.document.name)]
      if (this.model.getLanguageId() !== language) monaco.editor.setModelLanguage(this.model, language)
    }
    this.editor.updateOptions({ readOnly: state.busy || this.session.locked || !!(this.id && this.models.get(this.id)?.limited) })
    this.diagnostics()
    if (this.id && this.models.get(this.id)?.limited && !state.busy && !state.notice && !state.error) this.session.feedback('Esta aba atingiu um limite de histórico ou precisou recuperar uma edição recusada. Desfaça/refaça, salve ou copie; feche e reabra a aba para continuar editando.')
  }
  private eolPattern(text: string) { return (text.match(/\r\n|\r|\n/g) ?? []).map(eol => eol === '\r\n' ? 'C' : eol === '\r' ? 'R' : 'L').join('') }
  private diagnostics() {
    if (!this.host) return
    this.host.dataset.monacoModel = this.model?.uri.toString() ?? ''
    this.host.dataset.monacoLanguage = this.model?.getLanguageId() ?? ''
    this.host.dataset.monacoModels = String(monaco.editor.getModels().length)
  }
  private remember() {
    if (this.changing || !this.model || this.id !== this.session.snapshot().document?.id) return
    const selection = this.editor.getSelection(), position = this.editor.getPosition()
    if (selection && position) this.session.rememberSelection({ start: this.model.getOffsetAt({ lineNumber: selection.selectionStartLineNumber, column: selection.selectionStartColumn }), end: this.model.getOffsetAt(position), top: this.editor.getScrollTop(), left: this.editor.getScrollLeft() })
  }
  private theme() { monaco.editor.setTheme(document.querySelector('.workbench')?.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark') }
  private layout() { if (this.host) { this.editor.layout({ width: this.host.clientWidth, height: this.host.clientHeight }); this.diagnostics() } }
  attach(host: MonacoHost) {
    this.host = host; host.append(this.element)
    Object.defineProperty(host, 'monacoEditor', { configurable: true, value: this.editor })
    this.observer.observe(host); this.sync(); this.theme(); this.layout()
    return () => {
      if (this.host !== host) return
      this.remember(); this.observer.unobserve(host); delete (host as { monacoEditor?: unknown }).monacoEditor
      this.element.remove(); this.host = null
    }
  }
}
export function monacoPresentation(session: EditorSession) {
  let owner = owners.get(session)
  if (!owner) { owner = new MonacoPresentation(session); owners.set(session, owner) }
  return owner
}

/** Disposable public Diff Editor; never observes or updates the editable session/model. */
export function createGitDiff(host: GitDiffHost, comparison: import('../../../shared/git.ts').GitComparison): () => void {
  const original = monaco.editor.createModel(comparison.original, 'plaintext')
  const modified = monaco.editor.createModel(comparison.modified, 'plaintext')
  const editor = monaco.editor.createDiffEditor(host, { readOnly: true, originalEditable: false, domReadOnly: true, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true, automaticLayout: false, minimap: { enabled: false }, maxComputationTime: 1000, maxFileSize: 1, renderOverviewRuler: false })
  editor.setModel({ original, modified })
  const observer = new ResizeObserver(() => editor.layout({ width: host.clientWidth, height: host.clientHeight }))
  observer.observe(host); editor.layout({ width: host.clientWidth, height: host.clientHeight })
  host.dataset.gitDiffModels = '2'
  Object.defineProperty(host, 'monacoDiffEditor', { configurable: true, value: editor })
  return () => { observer.disconnect(); editor.setModel(null); editor.dispose(); original.dispose(); modified.dispose(); delete host.dataset.gitDiffModels; delete (host as { monacoDiffEditor?: unknown }).monacoDiffEditor }
}
