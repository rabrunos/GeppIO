import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validEndpoint } from '@geppio/plugin-sdk'
import { prepareSurface } from '@geppio/runtime/node/surfaces'

test('surface authors can import SDK types while executable module imports fail during preparation', () => {
  const manifest = { entry: 'entry.ts', surface: { html: 'view.html', css: 'view.css', uses: [], offers: [] } }
  const files = new Map([['view.html', Buffer.from('<p>View</p>')], ['view.css', Buffer.from('')]])
  files.set('entry.ts', Buffer.from("import type { SurfaceAPI } from '@geppio/plugin-sdk/surface'; window.geppioSurface.then((api: SurfaceAPI) => api.ready())"))
  const result = prepareSurface(manifest, files)
  assert.ok(result.html.includes('api.ready()'))
  assert.ok(!result.html.includes('export {};'))
  for (const source of ["import './palette.js'", "async function load() { return import('./palette.js') }"]) {
    files.set('entry.ts', Buffer.from(source))
    assert.throws(() => prepareSurface(manifest, files), /sem importações/)
  }
})

test('endpoint kinds accept declared strings only and reject other structured values without coercion', () => {
  const endpoint = { name: 'format', version: 1, kind: 'command' }
  assert.equal(validEndpoint(endpoint), true)
  for (const kind of [null, ['command'], { toString: null }, 1]) {
    assert.equal(validEndpoint({ ...endpoint, kind }), false)
  }
})

test('preparation accounts for UTF-8 and repeated resources across HTML and CSS before retaining output', () => {
  const manifest = { entry: 'entry.ts', surface: { html: 'tile.html', css: 'tile.css', uses: [], offers: [] } }
  const files = new Map<string, Uint8Array>([
    ['entry.ts', Buffer.from('const title: string = "ação"')],
    ['tile.html', Buffer.from('<p>dição</p><img src="gpp-image:tile.png">')],
    ['tile.css', Buffer.from('p {background-image: url(gpp-image:tile.png)}')],
    ['tile.png', Uint8Array.of(0, 1, 2)]
  ])
  const { html } = prepareSurface(manifest, files)
  assert.equal(html.includes('<p>dição</p>'), true)
  assert.equal(html.split('data:image/png;base64,AAEC').length, 3)
  files.set('tile.png', new Uint8Array(512 * 1024))
  files.set('tile.html', Buffer.from('<img src="gpp-image:tile.png">'.repeat(5)))
  assert.throws(() => prepareSurface(manifest, files), /limite de 4 MiB/)
})
