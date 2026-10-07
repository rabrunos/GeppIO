import ts from 'typescript'
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { parseManifest } from '../src/shared/plugins.ts'

/** Build each package independently. Never imports sample code into the application bundle. */
const outputRoot = resolve('.local/plugin-packages')
for (const name of (await readdir('examples/plugins')).sort()) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Unexpected example directory')
  const source = resolve('examples/plugins', name, 'src')
  const manifestText = await readFile(join(source, '..', 'plugin.json'), 'utf8')
  const manifest = parseManifest(manifestText)
  const destination = resolve(outputRoot, name), rel = relative(outputRoot, destination)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe example output path')
  await mkdir(outputRoot, { recursive: true })
  const program = ts.createProgram(ts.sys.readDirectory(source, ['.ts']), {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmitOnError: true,
    skipLibCheck: true, types: [], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'], rootDir: source, outDir: destination
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: path => path, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }))
  // Only generated, verified .local output is replaced, never source or installed owner packages.
  await rm(destination, { recursive: true, force: true }); await mkdir(destination)
  const result = program.emit()
  if (result.emitSkipped) throw new Error('Plugin emit failed')
  await writeFile(join(destination, 'plugin.json'), manifestText)
  if (!ts.sys.fileExists(join(destination, manifest.entry))) throw new Error('Manifest entry was not produced')
  console.log(`Built independent trusted package: ${manifest.id} -> .local/plugin-packages/${name}`)
}
