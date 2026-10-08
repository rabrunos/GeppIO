import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { rendererAsset, validatedDevURL, PRODUCTION_CSP } from '../src/main/security.ts'
const root = resolve('out/renderer')
test('custom protocol resolves only known renderer file types within root', () => {
  assert.equal(rendererAsset(root, 'geppio://app/')?.path, resolve(root, 'index.html'))
  assert.equal(rendererAsset(root, 'geppio://app/assets/app.js')?.mime, 'text/javascript; charset=utf-8')
  for (const value of ['file:///private/file.js', 'geppio://other/index.html', 'geppio://user:pass@app/index.html', 'geppio://app:99/index.html', 'geppio://app/%2e%2e%2fprivate.js', 'geppio://app/%5cprivate.js', 'geppio://app/%00file.js', 'geppio://app/.env', 'geppio://app/assets/app.js.map', 'invalid']) assert.equal(rendererAsset(root, value), null, value)
})
test('development URL accepts only the configured loopback origin', () => {
  assert.equal(validatedDevURL('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/')
  for (const value of ['https://example.com', 'http://localhost:5173/', 'http://127.0.0.1:6000', 'http://evil@127.0.0.1:5173']) assert.throws(() => validatedDevURL(value))
})
test('production script CSP is not the development inline-script policy', () => {
  assert.match(PRODUCTION_CSP, /script-src 'self';/)
  assert.match(PRODUCTION_CSP, /connect-src 'none'/)
  assert.ok(!PRODUCTION_CSP.includes('unsafe-eval'))
})
test('static security regression: renderer has only a fixed plugin-management bridge', () => {
  const preload = readFileSync('src/preload/index.ts', 'utf8'), main = readFileSync('src/main/index.ts', 'utf8')
  assert.ok(!/child_process|node:fs|sendSync|\.send\(/.test(preload))
  assert.deepEqual([...preload.matchAll(/ipcRenderer.invoke\('([^']+)'/g)].map(match => match[1]), ['plugins:list', 'plugins:install', 'plugins:set-enabled', 'plugins:remove'])
  assert.match(main, /event.senderFrame !== event.sender.mainFrame/)
  assert.match(main, /sandbox: true/); assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/); assert.match(main, /webviewTag: false/)
  assert.match(main, /nodeIntegrationInWorker: false/)
  assert.match(PRODUCTION_CSP, /worker-src 'self'/)
})
