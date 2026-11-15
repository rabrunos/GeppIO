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
import { editorText } from '../../../shared/documents.ts'
import { documentLanguage } from '../../../shared/document-status.ts'
import type { DocumentLanguage } from '../../../shared/document-status.ts'
import type { EditorSession } from './session.ts'
import { applyDocumentChanges } from '../../../shared/document-edits.ts'

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

/** One session-owned editor/model. Presentations only attach/detach its existing DOM. */
class MonacoPresentation {
  private element = document.createElement('div')
  private editor: monaco.editor.IStandaloneCodeEditor
  private model: monaco.editor.ITextModel | null = null
  private id: string | undefined
  private host: MonacoHost | null = null
  private changing = false
  // Only newline metadata is retained by Monaco undo version; editable content stays in EditorSession.
  private eols = new Map<number, string>()
  private stopped = false
  private stop: () => void
  private observer: ResizeObserver
  private themeObserver: MutationObserver
  private subscriptions: monaco.IDisposable[] = []
  constructor(private session: EditorSession) {
    this.element.className = 'monaco-instance'
    this.editor = monaco.editor.create(this.element, { model: null, automaticLayout: false, ariaLabel: 'Conteúdo do arquivo', theme: 'vs-dark', fontFamily: 'Consolas, monospace', fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, fixedOverflowWidgets: false, readOnly: true })
    this.subscriptions.push(this.editor.onDidChangeCursorSelection(() => this.remember()), this.editor.onDidScrollChange(() => this.remember()))
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
      this.subscriptions.forEach(item => item.dispose()); this.editor.dispose(); this.model?.dispose()
      workers.forEach(worker => worker.terminate()); workers.clear()
      this.element.remove(); owners.delete(this.session)
    })
  }
  private sync() {
    const state = this.session.snapshot()
    if (this.id !== state.document?.id) {
      this.editor.setModel(null); this.model?.dispose(); this.model = null; this.id = state.document?.id
      this.eols.clear()
      if (state.document) {
        this.model = monaco.editor.createModel(editorText(state.text), languages[state.language ?? documentLanguage(state.document.name)], monaco.Uri.from({ scheme: 'inmemory', authority: 'geppio', path: '/' + state.document.id }))
        this.model.setEOL(monaco.editor.EndOfLineSequence.LF)
        this.eols.set(this.model.getAlternativeVersionId(), this.eolPattern(state.text))
        this.model.onDidChangeContent(event => {
          if (this.changing || !this.model) return
          const exact = this.session.snapshot().text, before = editorText(exact), normalized = this.model.getValue()
          const version = this.model.getAlternativeVersionId(), pattern = this.eols.get(version)
          // Native selection replacement may arrive as delete then insert. Retain the file's
          // convention through the temporary empty draft instead of accidentally switching to LF.
          const newline = this.session.snapshot().document?.text.match(/\r\n|\r|\n/)?.[0] ?? '\n'
          let candidate = applyDocumentChanges(exact, event.changes, newline)
          if ((event.isUndoing || event.isRedoing) && pattern !== undefined) {
            let i = 0
            candidate = normalized.replaceAll('\n', () => ({ C: '\r\n', R: '\r', L: '\n' })[pattern[i++]!] ?? '\n')
          }
          if (!this.session.editExact(candidate)) {
            this.changing = true
            try {
              // Undo the refused edit with public APIs; a grouped edit may include accepted typing.
              this.model.undo()
              if (this.model.getValue() !== before) this.model.pushEditOperations(null, [{ range: this.model.getFullModelRange(), text: before }], () => null)
              this.model.pushStackElement()
            } finally { this.changing = false }
          } else this.eols.set(version, this.eolPattern(this.session.snapshot().text))
          this.remember()
        })
        this.editor.setModel(this.model)
      }
    }
    if (this.model && state.document) {
      const language = languages[state.language ?? documentLanguage(state.document.name)]
      if (this.model.getLanguageId() !== language) monaco.editor.setModelLanguage(this.model, language)
    }
    this.editor.updateOptions({ readOnly: state.busy || this.session.locked })
    this.diagnostics()
  }
  private eolPattern(text: string) { return (text.match(/\r\n|\r|\n/g) ?? []).map(eol => eol === '\r\n' ? 'C' : eol === '\r' ? 'R' : 'L').join('') }
  private diagnostics() {
    if (!this.host) return
    this.host.dataset.monacoModel = this.model?.uri.toString() ?? ''
    this.host.dataset.monacoLanguage = this.model?.getLanguageId() ?? ''
    this.host.dataset.monacoModels = String(monaco.editor.getModels().length)
  }
  private remember() {
    if (!this.model) return
    const selection = this.editor.getSelection(), position = this.editor.getPosition()
    if (selection && position) this.session.rememberSelection({ start: this.model.getOffsetAt(selection.getStartPosition()), end: this.model.getOffsetAt(position), top: this.editor.getScrollTop(), left: this.editor.getScrollLeft() })
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
