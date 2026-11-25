import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'

/** Vite emits local ES module workers, including language services and related assets. */
export function createViteWorker(label: string): Worker {
  switch (label) {
    case 'json': return new JsonWorker()
    case 'typescript': case 'javascript': return new TypeScriptWorker()
    case 'html': case 'handlebars': case 'razor': return new HtmlWorker()
    case 'css': case 'scss': case 'less': return new CssWorker()
    default: return new EditorWorker()
  }
}
