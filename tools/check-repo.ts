/** Offline source and licensing checks. Runtime behavior and remote identity have separate gates. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

interface Manifest {
  name: string
  license: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/
const notices = ['dompurify-LICENSE-MPL.txt', 'dompurify-LICENSE.txt', 'heroicons-LICENSE.txt', 'marked-LICENSE.txt',
  'monaco-LICENSE.txt', 'monaco-ThirdPartyNotices.txt', 'terminal-dependencies.txt', 'trusted-types-LICENSE.txt']
const generated = new Set(['node_modules', '.pnpm-store', 'out', 'dist', 'coverage', 'test-results', 'playwright-report', 'target'])
const sourceRoots = new Set(['docs', 'src', 'tools', 'tests', 'examples', 'native', '.github', '.claude', '.vscode'])

export function repositoryErrors(root: string): string[] {
  const errors: string[] = []
  const files = new Set<string>()
  function walk(dir: string) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? dir + '/' + entry.name : entry.name
      if (generated.has(entry.name)) continue
      if (entry.isSymbolicLink()) errors.push('Source symlink: ' + path)
      else if (entry.isFile()) files.add(path)
      else if (entry.isDirectory() && (dir || sourceRoots.has(entry.name))) walk(path)
    }
  }
  walk('')
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const required = ['AGENTS.md', 'CHANGELOG.md', 'LICENSE', 'package.json', 'pnpm-lock.yaml',
    '.github/workflows/checks.yml', ...notices.map(name => 'docs/legal/' + name)]
  for (const path of required) if (!files.has(path)) errors.push('Missing required file: ' + path)
  if (errors.length) return errors

  const licenseHash = createHash('sha256').update(read('LICENSE').replaceAll('\r\n', '\n')).digest('hex')
  if (licenseHash !== 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30')
    errors.push('Root LICENSE must contain the adopted Apache-2.0 text')
  const rules = read('AGENTS.md')
  const grant = rules.split(/\r?\n\s*\r?\n/).find(paragraph => paragraph.includes('https://github.com/rabrunos/GeppIO/issues/22'))
  if (!grant || !['`origin/main`', '`rabrunos/GeppIO`', '`1409287329`'].every(value => grant.includes(value)))
    errors.push('Missing scoped Git authority reference or stable repository ID')

  const manifests = [...files].filter(path => path === 'package.json' || /^src\/[^/]+\/package\.json$/.test(path))
    .map(path => JSON.parse(read(path)) as Manifest)
  const workspaces = new Set(manifests.filter(pkg => pkg.name !== 'geppio').map(pkg => pkg.name))
  for (const pkg of manifests) {
    if (pkg.license !== 'Apache-2.0') errors.push('Unexpected package license: ' + pkg.name)
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
      if (!versionPattern.test(version) && !(version === 'workspace:*' && workspaces.has(name)))
        errors.push('Unpinned or unknown dependency: ' + pkg.name + ' -> ' + name)
    }
  }
  const pkg = JSON.parse(read('package.json')) as Manifest
  const releases = [...read('CHANGELOG.md').matchAll(/^## \[([^\]]+)\]/gm)].map(match => match[1])
  if (!versionPattern.test(pkg.version ?? '') || releases[0] !== pkg.version || releases.length !== new Set(releases).size)
    errors.push('Package version must head the changelog with unique releases')
  if (files.has('native/Cargo.toml')) {
    // One 0.1.0-alpha.N line (#73): the Cargo workspace mirrors package.json.
    const workspaceVersion = /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/.exec(read('native/Cargo.toml'))?.[1]
    if (workspaceVersion !== pkg.version) errors.push('native/Cargo.toml [workspace.package] version must equal package.json')
    if (!files.has('native/Cargo.lock')) errors.push('Missing native/Cargo.lock')
  }
  for (const script of Object.values(pkg.scripts ?? {})) {
    for (const [target] of script.matchAll(/\btools\/[\w./-]+\.ts\b/g))
      if (!files.has(target)) errors.push('Missing script target: ' + target)
  }
  for (const path of files) {
    if (!path.endsWith('.md')) continue
    for (const [, target] of read(path).matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      if (!target || target.startsWith('#') || /^[a-zA-Z][\w+.-]*:/.test(target)) continue
      let decoded: string
      try { decoded = decodeURIComponent(target.split(/[?#]/, 1)[0]!) }
      catch { errors.push('Invalid link encoding: ' + path); continue }
      const resolved = resolve(root, dirname(path), decoded)
      const fromRoot = relative(root, resolved)
      if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('..' + sep) || !existsSync(resolved))
        errors.push('Broken or external local link: ' + path + ' -> ' + target)
    }
  }
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = repositoryErrors(process.cwd())
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log('PASS  Repository version, licenses, package pins, local links and script targets')
}
