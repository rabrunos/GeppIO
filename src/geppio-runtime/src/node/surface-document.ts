import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { initializeSurface } from '@geppio/plugin-sdk/surface'
import type { SurfaceContract } from '@geppio/plugin-sdk'

export const surfaceExtensions = ['.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.png', '.json']
export interface PreparedSurface { html: string; csp: string }
const loadDependency = createRequire(import.meta.url)
const decoder = new TextDecoder('utf-8', { fatal: true })
const hash = (source: string) => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'"

/** Source files and digests remain immutable. Derived output cannot import a
 * file from disk or execute an author build hook. The document has no URL
 * subresources. Local PNGs may be referenced as gpp-image:<package-path>. */
export function prepareSurface(manifest: { entry: string; surface?: SurfaceContract }, files: ReadonlyMap<string, Uint8Array>): PreparedSurface {
  const contract = manifest.surface!
  const read = (path: string) => {
    const bytes = files.get(path)
    if (!bytes) throw new Error('Recurso de superfície ausente: ' + path)
    return decoder.decode(bytes).replace(/\r\n?/g, '\n')
  }
  const ts = loadDependency('typescript') as typeof import('typescript')
  function hasImportExpression(node: import('typescript').Node): boolean {
    return node.kind === ts.SyntaxKind.ImportKeyword || Boolean(ts.forEachChild(node, child => hasImportExpression(child) || undefined))
  }
  const transformed = ts.transpileModule(read(manifest.entry), { fileName: manifest.entry, reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Preserve, jsx: ts.JsxEmit.React, jsxFactory: 'geppioElement',
    allowJs: true, moduleDetection: ts.ModuleDetectionKind.Legacy
  } })
  if (transformed.diagnostics?.some(issue => issue.category === ts.DiagnosticCategory.Error)) throw new Error('Sintaxe inválida na entrada da superfície.')
  const parsed = ts.createSourceFile('entry.js', transformed.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  if (ts.isExternalModule(parsed) || hasImportExpression(parsed)) throw new Error('Forneça uma entrada autônoma sem importações em tempo de execução.')
  const markup = read(contract.html), stylesheet = read(contract.css)
  if (/<\/style/i.test(stylesheet) || /<\/script/i.test(transformed.outputText)) throw new Error('Terminador HTML inválido no recurso.')
  const jsx = 'function geppioElement(tag, attrs, ...children) { const el = document.createElement(tag); for (const [name, value] of Object.entries(attrs || {})) el.setAttribute(name, String(value)); el.append(...children.flat(Infinity)); return el }'
  const scripts = ['(' + initializeSurface.toString() + ')()', jsx + '\n' + transformed.outputText]
  const render = (html: string, css: string) => '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style><script>' + scripts[0] + '</script></head><body>' + html + '<script>' + scripts[1] + '</script></body></html>'
  const maxBytes = 4 * 1024 * 1024
  let outputBytes = Buffer.byteLength(render('', '')) + Buffer.byteLength(markup) + Buffer.byteLength(stylesheet)
  const overflow = () => new Error('A superfície preparada excede o limite de 4 MiB.')
  if (outputBytes > maxBytes) throw overflow()
  const images = new Map<string, string>()
  const prefix = 'data:image/png;base64,'
  const embed = (source: string) => source.replace(/gpp-image:([a-zA-Z0-9_./-]+\.png)/g, (match, path: string) => {
    const bytes = files.get(path)
    if (!bytes) throw new Error('Imagem da superfície ausente.')
    outputBytes += prefix.length + 4 * Math.ceil(bytes.length / 3) - match.length
    if (outputBytes > maxBytes) throw overflow()
    let image = images.get(path)
    if (image === undefined) {
      image = prefix + Buffer.from(bytes).toString('base64')
      images.set(path, image)
    }
    return image
  })
  const html = embed(markup), css = embed(stylesheet)
  const csp = "default-src 'none'; sandbox allow-scripts; script-src " + scripts.map(hash).join(' ') + "; style-src " + hash(css)
    + "; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  return { html: render(html, css), csp }
}
