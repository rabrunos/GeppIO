import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkModules } from '../tools/check-modules.ts'

test('package graph, public entries, platform imports and pure ambient types fail independently', t => {
  const root = mkdtempSync(join(tmpdir(), 'geppio-package-boundaries-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file: string, source: string) => {
    const path = join(root, 'src', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  function manifest(name: string, dependencies: Record<string, string> = {}) {
    write(name + '/package.json', JSON.stringify({
      name: '@geppio/' + name, type: 'module', exports: { '.': './src/index.ts' }, dependencies
    }))
  }
  for (const name of ['application', 'standalone', 'ui', 'editor', 'plugin-sdk', 'runtime']) {
    manifest(name)
    write(name + '/src/index.ts', 'export const kind = "fixture"\n')
  }
  assert.deepEqual(checkModules(root), [])
  manifest('ui', { '@geppio/application': 'workspace:*' })
  manifest('application', { '@geppio/ui': 'workspace:*' })
  write('ui/src/view.ts', "import type { Internal } from '@geppio/application/private'\n")
  write('runtime/src/pure.ts', "export const title = document.title\n")
  write('application/src/renderer/view.ts', "import type { Stats } from 'node:fs'\nimport type { Port } from '../main/ports.ts'\n")
  write('editor/src/view.ts', "export * from '../../application/src/index.ts'\n")
  const failures = checkModules(root).join('\n')
  assert.match(failures, /Disallowed workspace direction: @geppio\/ui -> @geppio\/application/)
  assert.match(failures, /Workspace dependency cycle/)
  assert.match(failures, /Non-public workspace import/)
  assert.match(failures, /Pure API: .*document/)
  assert.match(failures, /Native dependency in @geppio\/application\/src\/renderer\/view.ts/)
  assert.match(failures, /Platform boundary: .*src\/main\/ports.ts/)
  assert.match(failures, /Relative import leaves workspace/)
})
