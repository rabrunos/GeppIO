import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { parseDefinition } from '@geppio/standalone/composition'
import { generateStandalone } from '@geppio/standalone/generate'
import type { ExportSurface } from '@geppio/standalone/generate'
import { inspectPackage, packageDigest } from '../src/geppio/src/main/plugins.ts'

export async function exportDefinition(file: string, output: string) {
  const path = await realpath(file), stat = await lstat(path)
  if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid standalone definition file')
  const definition = parseDefinition(JSON.parse(await readFile(path, 'utf8')))
  const selected: ExportSurface[] = []
  for (const tile of definition.tiles) {
    if (tile.kind !== 'surface') continue
    const directory = join(dirname(path), 'plugins', tile.source!)
    if (await realpath(directory) !== directory) throw new Error('Redirected plugin source')
    const pkg = await inspectPackage(directory)
    if (pkg.manifest.apiVersion !== 3 || !pkg.prepared || !pkg.manifest.surface) throw new Error('Standalone surface requires API 3')
    const fingerprint = packageDigest(pkg).slice(0,32)
    const revision = [fingerprint.slice(0,8), fingerprint.slice(8,12), fingerprint.slice(12,16), fingerprint.slice(16,20), fingerprint.slice(20)].join('-')
    selected.push({ ...pkg.prepared, plugin: { manifest: { id: pkg.manifest.id, surface: pkg.manifest.surface }, revision } })
  }
  const { version } = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }
  return generateStandalone(definition, selected, output, version)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [definition, output, ...extra] = process.argv.slice(2)
  if (!definition || !output || extra.length) throw new Error('Usage: pnpm standalone:generate <definition.json> <new-output-directory>')
  console.log(await exportDefinition(definition, output))
}
