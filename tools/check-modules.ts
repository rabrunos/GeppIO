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

/** Native crate directions (#73): app → GeppUI and app → core; GeppUI and core stay independent. */
const nativeDirections: Record<string, string[]> = {
  geppui: ['gpui'],
  'geppio-core': ['serde', 'serde_json'],
  geppio: ['geppui', 'geppio-core', 'gpui', 'gpui_platform', 'serde', 'serde_json'],
  'geppui-consumer': ['geppui', 'gpui', 'gpui_platform']
}
/** The single approved git source: GPUI at Zed v1.30.2, pinned by full SHA. */
export const GPUI_SOURCE = { git: 'https://github.com/zed-industries/zed', rev: '610ea4b8de1c6e887f03563f067278002f41256e' }
const gpuiCrates = new Set(['gpui', 'gpui_platform'])
/** The only first-party file allowed to contain `unsafe` code or FFI declarations. */
export const NATIVE_FFI_FILE = 'native/crates/geppio/src/platform.rs'
/** Manifest tables the native workspace may use; anything else (table-form dependencies,
 * `target.*`, `patch`, `replace`, quoted headers) fails closed. */
const allowedTables = new Set(['', 'package', 'dependencies', 'dev-dependencies', 'build-dependencies', 'lints', 'bin', 'workspace',
  'workspace.package', 'workspace.dependencies', 'workspace.lints.rust', 'workspace.lints.clippy', 'profile.dev', 'profile.release'])
const dependencyTables = new Set(['dependencies', 'dev-dependencies', 'build-dependencies', 'workspace.dependencies'])
const dependencyKeys = new Set(['workspace', 'git', 'rev', 'version', 'path', 'features', 'default-features'])

interface TomlEntry { key: string; value: string; line: number }
interface TomlTable { name: string; entries: TomlEntry[] }

/** Removes a `#` comment that is outside a string. */
function stripComment(line: string): string {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote) { if (ch === '\\' && quote === '"') i++; else if (ch === quote) quote = '' }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '#') return line.slice(0, i)
  }
  return line
}

/** Reads the strict TOML subset of the native manifests: `[table]` headers with bare dotted
 * names, `[[bin]]`, and `bare.key = value` pairs (multi-line arrays allowed). */
export function readToml(source: string, errors: Set<string>, path: string): TomlTable[] {
  const tables: TomlTable[] = [{ name: '', entries: [] }]
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]!).trim()
    if (!line) continue
    const header = /^\[(\[)?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\](\])?$/.exec(line)
    if (header) {
      if (Boolean(header[1]) !== Boolean(header[3])) { errors.add(`Unrecognized native manifest line ${path}:${i + 1}`); continue }
      tables.push({ name: header[2]!, entries: [] }); continue
    }
    const pair = /^([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\s*=\s*(.+)$/.exec(line)
    if (!pair) { errors.add(`Unrecognized native manifest line ${path}:${i + 1}`); continue }
    let value = pair[2]!
    // Multi-line arrays (workspace members, features) continue until the bracket closes.
    while (value.startsWith('[') && (value.match(/\[/g)?.length ?? 0) > (value.match(/]/g)?.length ?? 0) && i + 1 < lines.length)
      value += ' ' + stripComment(lines[++i]!).trim()
    tables.at(-1)!.entries.push({ key: pair[1]!, value: value.trim(), line: i + 1 })
  }
  return tables
}

/** Parses `{ a = "x", b = true, c = ["y"] }` into raw values; unknown syntax returns null. */
export function inlineTable(value: string): Map<string, string> | null {
  const body = /^\{(.*)\}$/.exec(value.trim())?.[1]
  if (body === undefined) return null
  const fields = new Map<string, string>()
  let depth = 0, quote = '', start = 0
  const parts: string[] = []
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i]
    if (i === body.length || (!quote && depth === 0 && ch === ',')) { parts.push(body.slice(start, i)); start = i + 1; continue }
    if (quote) { if (ch === '\\' && quote === '"') i++; else if (ch === quote) quote = '' }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[') depth++
    else if (ch === ']') depth--
  }
  for (const part of parts.map(p => p.trim()).filter(Boolean)) {
    const field = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(part)
    if (!field || fields.has(field[1]!)) return null
    fields.set(field[1]!, field[2]!.trim())
  }
  return fields
}

const stringValue = (value: string | undefined) => value === undefined ? undefined : /^"([^"\\]*)"$/.exec(value)?.[1]

function walkNative(dir: string, base: string, out: { manifests: string[]; sources: string[]; config: string[] }): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target') continue
    const path = join(dir, entry.name), rel = relative(base, path).split(sep).join('/')
    if (entry.name === '.cargo') { out.config.push(rel); continue }
    if (entry.isDirectory()) walkNative(path, base, out)
    else if (entry.name === 'Cargo.toml') out.manifests.push(rel)
    else if (entry.name.endsWith('.rs')) out.sources.push(rel)
  }
}

/** Dependency directions, sources, pins, lockfiles and `unsafe` placement of the native
 * Cargo workspace. Needs no Rust toolchain, so it runs in `check:repo` and the core CI shard. */
export function checkNative(root: string): string[] {
  const nativeRoot = join(root, 'native')
  if (!existsSync(nativeRoot)) return []
  const errors = new Set<string>()
  const found = { manifests: [] as string[], sources: [] as string[], config: [] as string[] }
  walkNative(nativeRoot, root, found)
  for (const config of found.config) errors.add('Native Cargo configuration directories are not allowed: ' + config)
  if (!existsSync(join(root, 'native/Cargo.lock'))) errors.add('Missing native/Cargo.lock')
  else checkLock('native/Cargo.lock', readFileSync(join(root, 'native/Cargo.lock'), 'utf8'), errors)
  const graph = new Map<string, string[]>()
  for (const path of found.manifests) {
    const tables = readToml(readFileSync(join(root, path), 'utf8'), errors, path)
    for (const table of tables) {
      if (!allowedTables.has(table.name)) errors.add(`Native manifest table [${table.name}] is not allowed: ${path}`)
      if (table.name === '' && table.entries.length) errors.add('Native manifest keys before the first table: ' + path)
    }
    if (path === 'native/Cargo.toml') {
      for (const table of tables.filter(t => t.name === 'workspace.dependencies'))
        for (const entry of table.entries) checkDependency(root, path, entry, false, errors)
      continue
    }
    const pkg = stringValue(tables.find(t => t.name === 'package')?.entries.find(e => e.key === 'name')?.value)
    if (!pkg) { errors.add('Native manifest without a package name: ' + path); continue }
    if (!Object.hasOwn(nativeDirections, pkg)) { errors.add('Unknown native crate: ' + pkg + ' (' + path + ')'); continue }
    const external = pkg === 'geppui-consumer'
    if (external) {
      if (!tables.some(t => t.name === 'workspace')) errors.add('The external consumer must be its own workspace: ' + path)
      const lock = dirname(path) + '/Cargo.lock'
      if (!existsSync(join(root, lock))) errors.add('Missing lockfile for the external consumer: ' + path)
      else checkLock(lock, readFileSync(join(root, lock), 'utf8'), errors)
    } else if (!tables.find(t => t.name === 'lints')?.entries.some(e => e.key === 'workspace' && e.value === 'true'))
      errors.add('Native crate must inherit workspace lints: ' + path)
    const edges: string[] = []
    for (const table of tables.filter(t => dependencyTables.has(t.name) && t.name !== 'workspace.dependencies')) {
      for (const entry of table.entries) {
        const name = entry.key.split('.')[0]!
        if (!nativeDirections[pkg]!.includes(name)) errors.add(`Disallowed native dependency: ${pkg} -> ${name}`)
        checkDependency(root, path, entry, !external, errors)
        edges.push(name)
      }
    }
    graph.set(pkg, edges)
  }
  // geppio-core stays pure Rust: neither it nor anything it reaches may pull GPUI.
  const reaches = (from: string, seen = new Set<string>()): Set<string> => {
    for (const next of graph.get(from) ?? []) if (!seen.has(next)) { seen.add(next); reaches(next, seen) }
    return seen
  }
  for (const target of reaches('geppio-core')) if (gpuiCrates.has(target)) errors.add('geppio-core reaches GPUI through ' + target)
  for (const target of reaches('geppui')) if (target === 'geppio-core' || target === 'geppio') errors.add('geppui depends on GeppIO crate ' + target)
  if (reaches('geppio-core').has('geppui')) errors.add('geppio-core depends on geppui')
  for (const source of found.sources) {
    if (source === NATIVE_FFI_FILE) continue
    const text = readFileSync(join(root, source), 'utf8').replace(/forbid\(unsafe_code\)/g, '')
    if (/\bunsafe\b|unsafe_code|#\s*\[\s*link\b|no_mangle|export_name|extern\s+"/.test(text))
      errors.add('unsafe code or FFI outside ' + NATIVE_FFI_FILE + ': ' + source)
  }
  return [...errors]
}

/** Git sources that the pinned GPUI unit resolves only for other platforms (Linux, macOS,
 * web, screen capture). They are locked by revision and never built on Windows; cargo-deny's
 * Windows target filter excludes them. They get their own review when those platforms start
 * (policy point 6 in #73). Any other git source fails. */
export const OTHER_PLATFORM_SOURCES = [
  'https://github.com/gfx-rs/wgpu?rev=cddb2f5d80dc0009b2ef6767635140cacf90a007',
  'https://github.com/zed-industries/oo7?rev=731c1215edb6905876c6137ab300428c7b8d7c13',
  'https://github.com/zed-industries/wasm_thread?rev=0cf96c7708dfb97ccf3da50347e25edcf75d6937',
  'https://github.com/zed-industries/font-kit?rev=94b0f28166665e8fd2f53ff6d268a14955c82269',
  'https://github.com/zed-industries/scap?rev=b5c86ec58dd4b6b7732bf6ac8be03d6b1f190a82'
]

function checkLock(path: string, lock: string, errors: Set<string>): void {
  const allowed = new Set([GPUI_SOURCE.git + '?rev=' + GPUI_SOURCE.rev, ...OTHER_PLATFORM_SOURCES]
    .map(source => 'git+' + source + '#' + source.slice(source.indexOf('?rev=') + 5)))
  for (const [, source] of lock.matchAll(/^source = "([^"]+)"$/gm)) {
    if (source === 'registry+https://github.com/rust-lang/crates.io-index' || allowed.has(source!)) continue
    errors.add(`Unexpected source in ${path}: ${source}`)
  }
}

/** One dependency entry: `name = "=x.y.z"`, `name = { ... }` or `name.workspace = true`. */
function checkDependency(root: string, path: string, entry: TomlEntry, member: boolean, errors: Set<string>): void {
  const dot = entry.key.indexOf('.')
  const name = dot < 0 ? entry.key : entry.key.slice(0, dot)
  const fields = dot < 0 ? (entry.value.startsWith('{') ? inlineTable(entry.value) : new Map([['version', entry.value]]))
    : entry.key.slice(dot + 1).includes('.') ? null : new Map([[entry.key.slice(dot + 1), entry.value]])
  if (!fields) { errors.add(`Unrecognized native dependency syntax: ${path}:${entry.line}`); return }
  for (const key of fields.keys()) if (!dependencyKeys.has(key)) errors.add(`Native dependency key "${key}" is not allowed: ${path} -> ${name}`)
  if (fields.has('workspace')) {
    if (fields.get('workspace') !== 'true' || [...fields.keys()].some(k => k !== 'workspace' && k !== 'features')) errors.add(`Workspace dependency must only add features: ${path} -> ${name}`)
    return
  }
  if (member) errors.add(`Native dependency must come from [workspace.dependencies]: ${path} -> ${name}`)
  const git = stringValue(fields.get('git')), rev = stringValue(fields.get('rev')), local = stringValue(fields.get('path')), version = stringValue(fields.get('version'))
  if (fields.has('git')) {
    if (git !== GPUI_SOURCE.git || rev !== GPUI_SOURCE.rev || !gpuiCrates.has(name) || fields.has('version') || fields.has('path'))
      errors.add(`Native git source must be ${GPUI_SOURCE.git}@${GPUI_SOURCE.rev} for gpui crates: ${path} -> ${name}`)
    return
  }
  if (fields.has('path')) {
    const target = local === undefined ? undefined : relative(join(root, 'native'), resolve(root, dirname(path), local))
    if (target === undefined || target.startsWith('..') || isAbsolute(target) || !existsSync(join(root, 'native', target, 'Cargo.toml')))
      errors.add(`Native path dependency must stay inside native/: ${path} -> ${name}`)
    return
  }
  if (!version || !/^=\d+\.\d+\.\d+$/.test(version)) errors.add(`Native registry dependency must be pinned with =x.y.z: ${path} -> ${name}`)
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
  const errors = [...checkModules(process.cwd()), ...checkNative(process.cwd())]
  for (const message of errors) console.error(message)
  if (errors.length) process.exitCode = 1
  else console.log('PASS  Workspace dependencies, public imports, platform boundaries, pure Runtime/SDK compilation and native crate directions')
}
