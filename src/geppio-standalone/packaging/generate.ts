import { build } from 'vite'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { cp, mkdir, readFile, writeFile, lstat, readdir, copyFile } from 'node:fs/promises'
import type { Definition } from '../src/composition.ts'
import { parseDefinition } from '../src/composition.ts'
import type { SurfacePlugin } from '@geppio/runtime/web'
import type { PreparedSurface } from '@geppio/runtime/node/surfaces'

export interface ExportSurface extends PreparedSurface { plugin: SurfacePlugin }
/** Generate a new portable directory. Only named Electron redistribution
 * files, selected definitions and derived surface documents enter the result. */
export async function generateStandalone(input: Definition, selected: readonly ExportSurface[], output: string, appVersion: string): Promise<string> {
  const definition = parseDefinition(input)
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Standalone generation requires Windows x64')
  if (definition.tiles.filter(t => t.kind === 'surface').length !== selected.length || new Set(selected.map(s => s.plugin.manifest.id)).size !== selected.length)
    throw new Error('Select each required surface exactly once')
  const source = fileURLToPath(new URL('../src/', import.meta.url)), base = resolve(output)
  // Exclusive directory creation preserves every previously generated product.
  await mkdir(base)
  const executable: string = createRequire(import.meta.url)('electron'), dist = dirname(executable)
  const appDir = join(base, 'resources', 'app')
  await mkdir(appDir, { recursive: true })
  const runtimeFiles = ['chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','LICENSE','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll']
  for (const name of runtimeFiles) await copyFile(join(dist, name), join(base, name))
  // Electron retains LICENSE; this separate copy covers the GeppIO engine.
  await copyFile(new URL('../../../LICENSE', import.meta.url), join(base, 'LICENSE-GeppIO'))
  await mkdir(join(base, 'locales'))
  for (const name of await readdir(join(dist, 'locales'))) {
    if (!/^[A-Za-z0-9-]+\.pak$/.test(name) || !(await lstat(join(dist, 'locales', name))).isFile()) throw new Error('Unexpected Electron locale')
    await copyFile(join(dist, 'locales', name), join(base, 'locales', name))
  }
  const sources = selected.map(({ plugin }) => plugin)
  await build({ configFile: false, publicDir: false, logLevel: 'warn', define: {
    __HAS_SURFACES__: JSON.stringify(sources.length > 0), __COMPOSITION__: JSON.stringify(definition), __PLUGINS__: JSON.stringify(sources)
  }, build: { target: 'es2022', outDir: appDir, emptyOutDir: false, lib: { entry: join(source, 'renderer.ts'), name: 'Standalone', formats: ['iife'], fileName: () => 'app.js' },
    rollupOptions: { output: { inlineDynamicImports: true } } } })
  const main = ts.transpileModule(await readFile(join(source, 'main.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  await writeFile(join(appDir, 'main.cjs'), main)
  await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'geppio-export-' + definition.productId, version: appVersion, main: 'main.cjs', private: true }))
  await writeFile(join(appDir, 'composition.json'), JSON.stringify(definition))
  await writeFile(join(appDir, 'resources.json'), JSON.stringify(selected.map(({ plugin, html, csp }) => ({ id: plugin.manifest.id, revision: plugin.revision, html, csp }))))
  await writeFile(join(appDir, 'index.html'), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Aplicativo local</title><link rel="stylesheet" href="style.css"><main></main><script defer src="app.js"></script></html>')
  await cp(new URL('./style.css', import.meta.url), join(appDir, 'style.css'))
  // The launchable executable is written last. A failed generation leaves the
  // exclusive directory for inspection and never replaces an existing install.
  const launcher = join(base, 'geppio-export-' + definition.productId + '.exe')
  await copyFile(executable, launcher)
  return launcher
}
