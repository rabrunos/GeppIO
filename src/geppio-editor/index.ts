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

export type BasicEditor = monaco.editor.IStandaloneCodeEditor
export type TextModel = monaco.editor.ITextModel
export type EditorViewState = monaco.editor.ICodeEditorViewState
export type ComparisonEditor = monaco.editor.IStandaloneDiffEditor
export type Disposable = monaco.IDisposable
export type WorkerFactory = (label: string) => Worker
export const { KeyCode, Selection, Range } = monaco
export const { ScrollType, setModelLanguage, setTheme } = monaco.editor

interface WorkerPool {
  factory: WorkerFactory
  disposables: Set<Worker>
  clients: number
  environment: NonNullable<typeof globalThis.MonacoEnvironment>
}
let pool: WorkerPool | undefined

/** Monaco dispatches through a page-wide callback. Only the last cooperating client releases it. */
export function acquireWorkers(factory: WorkerFactory): Disposable {
  if (!pool) {
    if (globalThis.MonacoEnvironment) throw new Error('MonacoEnvironment is already managed by this page')
    const disposables = new Set<Worker>()
    const environment = {
      getWorker(_moduleId: string, label: string) {
        if (pool?.environment !== environment) throw new Error('Editor workers were disposed')
        const worker = factory(label)
        disposables.add(worker)
        return worker
      }
    }
    pool = { factory, environment, clients: 0, disposables }
    globalThis.MonacoEnvironment = environment
  }
  if (pool.factory !== factory || pool.environment !== globalThis.MonacoEnvironment) {
    throw new Error('Editor clients must share a worker configuration')
  }
  const owner = pool
  owner.clients++
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (--owner.clients) return
      for (const worker of owner.disposables) worker.terminate()
      owner.disposables.clear()
      if (globalThis.MonacoEnvironment === owner.environment) globalThis.MonacoEnvironment = undefined
      pool = undefined
    }
  }
}

/** An explicit model can outlive any number of editors or React presentations. */
export function createModel(text: string, language = 'plaintext', identity?: { namespace: string; id: string }): TextModel {
  const uri = identity && monaco.Uri.from({ scheme: 'inmemory', authority: identity.namespace, path: '/' + identity.id })
  const model = monaco.editor.createModel(text, language, uri)
  model.setEOL(monaco.editor.EndOfLineSequence.LF)
  return model
}

export function createBasicEditor(host: HTMLElement, options: monaco.editor.IStandaloneEditorConstructionOptions): BasicEditor {
  return monaco.editor.create(host, {
    model: null, theme: 'vs-dark', fontFamily: 'Consolas, monospace', fontSize: 14,
    minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, ...options
  })
}

export const modelCount = () => monaco.editor.getModels().length

/** Owns only its two read-only comparison models and the associated presentation. */
export function createComparison(host: HTMLElement, before: string, after: string) {
  const original = monaco.editor.createModel(before, 'plaintext')
  const modified = monaco.editor.createModel(after, 'plaintext')
  const editor = monaco.editor.createDiffEditor(host, {
    readOnly: true, originalEditable: false, domReadOnly: true, renderSideBySide: true,
    useInlineViewWhenSpaceIsLimited: true, automaticLayout: false, minimap: { enabled: false },
    maxComputationTime: 1000, maxFileSize: 1, renderOverviewRuler: false
  })
  editor.setModel({ original, modified })
  const layout = () => editor.layout({ width: host.clientWidth, height: host.clientHeight })
  const observer = new ResizeObserver(layout)
  observer.observe(host)
  layout()
  return {
    editor,
    dispose() {
      observer.disconnect()
      editor.setModel(null)
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }
}
