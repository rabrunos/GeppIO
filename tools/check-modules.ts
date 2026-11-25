import { isBuiltin } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

interface Manifest {
  name: string
  exports: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const directions: Record<string, string[]> = {
  '@geppio/application': ['@geppio/runtime', '@geppio/editor', '@geppio/plugin-sdk', '@geppio/ui'],
  '@geppio/standalone': ['@geppio/runtime', '@geppio/editor', '@geppio/plugin-sdk', '@geppio/ui'],
  '@geppio/runtime': ['@geppio/plugin-sdk'],
  '@geppio/plugin-sdk': [],
  '@geppio/editor': [],
  '@geppio/ui': []
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?[jt]sx?|css)$/.test(entry.name) ? [path] : []
  })
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)].map(m => m[1]!)
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const refs = ast.typeReferenceDirectives.map(ref => ref.fileName)
  const visit = (node: ts.Node): void => {
    let specifier: ts.Node | undefined
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal
    else if (ts.isExternalModuleReference(node)) specifier = node.expression
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0]
    if (specifier && ts.isStringLiteralLike(specifier)) refs.push(specifier.text)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return refs
}

function environment(name: string, path: string): 'pure' | 'native' | 'web' {
  if (name === '@geppio/runtime') {
    if (path.startsWith('src/node/')) return 'native'
    return path.startsWith('src/web/') ? 'web' : 'pure'
  }
  if (name === '@geppio/standalone') return path.startsWith('packaging/') || path === 'src/main.ts' ? 'native' : 'web'
  if (name === '@geppio/application') return /^src\/(main|preload)\//.test(path) ? 'native' : 'web'
  if (name === '@geppio/plugin-sdk') return path === 'src/client.ts' ? 'web' : 'pure'
  return 'web'
}

function publicPath(exports: Manifest['exports'], subpath: string): string | undefined {
  if (Object.hasOwn(exports, subpath)) return exports[subpath]
  for (const [pattern, target] of Object.entries(exports)) {
    const [prefix, suffix] = pattern.split('*')
    if (suffix !== undefined && subpath.startsWith(prefix!) && subpath.endsWith(suffix)) {
      const match = subpath.slice(prefix!.length, subpath.length - suffix.length)
      if (match && !match.includes('..')) return target.replace('*', match)
    }
  }
}

export function checkModules(root: string): string[] {
  const packages = new Map<string, { dir: string; manifest: Manifest }>()
  const errors = new Set<string>()
  for (const entry of readdirSync(join(root, 'src'), { withFileTypes: true })) {
    const dir = join(root, 'src', entry.name)
    const path = join(dir, 'package.json')
    if (!entry.isDirectory() || !existsSync(path)) continue
    const manifest: Manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (packages.has(manifest.name)) errors.add('Duplicate workspace: ' + manifest.name)
    packages.set(manifest.name, { dir, manifest })
  }
  const graph = new Map<string, string[]>()
  const pureFiles: string[] = []
  const normalized = (dir: string, path: string) => relative(dir, path).split(sep).join('/')
  for (const expected of Object.keys(directions)) if (!packages.has(expected)) errors.add('Missing workspace: ' + expected)
  for (const [name, { manifest, dir }] of packages) {
    const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
    const edges = Object.keys(dependencies).filter(id => packages.has(id))
    graph.set(name, edges)
    for (const edge of edges) {
      if (!directions[name]?.includes(edge)) errors.add('Disallowed workspace direction: ' + name + ' -> ' + edge)
      if (dependencies[edge] !== 'workspace:*') errors.add('Local dependency must use workspace:*: ' + name + ' -> ' + edge)
    }
    for (const target of Object.values(manifest.exports ?? {})) {
      if (!target.startsWith('./') || target.includes('..')) errors.add('Invalid export path: ' + name + ' -> ' + target)
      else if (!target.includes('*') && !existsSync(join(dir, target))) errors.add('Absent export: ' + name + ' -> ' + target)
    }
    for (const file of sourceFiles(dir)) {
      const path = normalized(dir, file), area = environment(name, path)
      if (area === 'pure') pureFiles.push(file)
      const checkTarget = (pkg: string, target: string) => {
        const layer = environment(pkg, target)
        if (area !== 'native' && layer === 'native' || area === 'pure' && layer !== 'pure')
          errors.add('Platform boundary: ' + name + '/' + path + ' -> ' + pkg + '/' + target)
      }
      for (const spec of imports(file)) {
        if (spec.startsWith('.') || isAbsolute(spec)) {
          const target = normalized(dir, resolve(dirname(file), spec))
          if (target.startsWith('../') || isAbsolute(target)) errors.add('Relative import leaves workspace: ' + path + ' -> ' + spec)
          else checkTarget(name, target)
          continue
        }
        const id = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')
        if (area !== 'native' && (isBuiltin(spec) || id === 'electron' || id === 'node-pty' || id === 'typescript'))
          errors.add('Native dependency in ' + name + '/' + path + ': ' + spec)
        if (isBuiltin(spec)) continue
        if (!Object.hasOwn(dependencies, id) && name !== id) errors.add('Undeclared dependency: ' + name + '/' + path + ' -> ' + id)
        const other = packages.get(id)
        if (!other) {
          if (area === 'pure' && ['react', 'react-dom', 'monaco-editor'].includes(id))
            errors.add('Presentation dependency in pure API: ' + name + '/' + path + ' -> ' + id)
          continue
        }
        const target = publicPath(other.manifest.exports, '.' + spec.slice(id.length))
        if (!target || !existsSync(join(other.dir, target))) errors.add('Non-public workspace import: ' + name + '/' + path + ' -> ' + spec)
        else checkTarget(id, normalized(other.dir, resolve(other.dir, target)))
      }
    }
  }
  const done = new Set<string>(), visiting = new Set<string>()
  const checkCycle = (id: string): void => {
    if (visiting.has(id)) { errors.add('Workspace dependency cycle at ' + id); return }
    if (done.has(id)) return
    visiting.add(id)
    for (const dep of graph.get(id) ?? []) checkCycle(dep)
    visiting.delete(id); done.add(id)
  }
  for (const id of packages.keys()) checkCycle(id)
  // A separate compilation catches ambient globals and types even with no import declaration.
  const program = ts.createProgram(pureFiles, {
    target: ts.ScriptTarget.ES2023, lib: ['lib.es2023.d.ts'], types: [], strict: true,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true, noEmit: true
  })
  for (const file of program.getSourceFiles()) {
    if (/(?:^|[/\\])lib\.(?:dom|webworker)[.\w-]*\.d\.ts$|[/\\]@types[/\\]node[/\\]/.test(file.fileName))
      errors.add('Platform declarations included in pure API: ' + normalized(root, file.fileName))
  }
  for (const issue of ts.getPreEmitDiagnostics(program)) {
    const file = issue.file ? normalized(root, issue.file.fileName) : 'compiler'
    errors.add('Pure API: ' + file + ': ' + ts.flattenDiagnosticMessageText(issue.messageText, ' '))
  }
  return [...errors]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = checkModules(process.cwd())
  for (const message of errors) console.error(message)
  if (errors.length) process.exitCode = 1
  else console.log('PASS  Workspace dependencies, public imports, platform boundaries and pure Runtime/SDK compilation')
}
