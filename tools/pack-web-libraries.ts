import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const libraries = ['geppui', 'geppio-editor'] as const
// Git Bash puts GNU tar first on PATH, which reads "C:" as a remote host; use the system bsdtar.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

/** Emit ordinary JS/types and only the declared browser package's styles and notices. */
export async function packWebLibraries() {
  const output = resolve(root, '.local/web-packages')
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(join(output, 'build-'))
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
  const archives: string[] = []
  for (const library of libraries) {
    const source = join(root, 'src', library)
    const staging = join(directory, library, 'package')
    await mkdir(staging, { recursive: true })
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
      name: string; exports: Record<string, string | Record<string, string>>; version: string
    }
    const sources = (await readdir(source)).filter(name => /\.tsx?$/.test(name)).map(name => join(source, name))
    const program = ts.createProgram(sources, {
      rootDir: source, outDir: staging, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023,
      jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler, declaration: true,
      strict: true, skipLibCheck: true, types: ['vite/client'], rewriteRelativeImportExtensions: true
    })
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics]
    if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n'
    }))
    for (const [entry, target] of Object.entries(manifest.exports)) if (typeof target === 'string' && /\.tsx?$/.test(target)) {
      manifest.exports[entry] = { types: target.replace(/\.tsx?$/, '.d.ts'), import: target.replace(/\.tsx?$/, '.js') }
    }
    manifest.version = version
    await writeFile(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    await cp(join(source, 'README.md'), join(staging, 'README.md'))
    await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'))
    if (library === 'geppui') await cp(join(source, 'styles'), join(staging, 'styles'), { recursive: true })
    else {
      await cp(join(source, 'styles.css'), join(staging, 'styles.css'))
      const notices = join(staging, 'legal')
      await mkdir(notices)
      for (const name of (await readdir(join(root, 'docs/legal'))).filter(name => /^(monaco-|dompurify-|marked-|trusted-types-)/.test(name))) {
        await cp(join(root, 'docs/legal', name), join(notices, name))
      }
    }
    const archive = join(directory, manifest.name.slice(1).replace('/', '-') + '-' + version + '.tgz')
    const pack = spawnSync(tar, ['-czf', archive, '-C', dirname(staging), basename(staging)], { windowsHide: true, stdio: 'inherit' })
    if (pack.error || pack.status !== 0) throw pack.error ?? new Error('Package archive creation failed for ' + library)
    archives.push(archive)
  }
  return archives
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  for (const archive of await packWebLibraries()) console.log(archive)
}
