import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative } from 'node:path'
import ts from 'typescript'
import { packWebLibraries } from './pack-web-libraries.ts'
import { electron } from './test-electron.ts'

const root = await realpath('.')
const temp = await realpath(tmpdir())
const project = await mkdtemp(join(temp, 'geppio-web-consumer-'))
const local = relative(root, project)
if (!isAbsolute(local) && !local.startsWith('..')) throw new Error('External consumer must be outside the workspace')
const [ui, editor] = await packWebLibraries()
const dir = (name: string) => join(project, name)
const pins = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const manifest = {
  name: 'local-web-consumer', version: '1.0.0', private: true, type: 'module', packageManager: pins.packageManager,
  dependencies: { '@geppio/ui': 'file:./ui.tgz', '@geppio/editor': 'file:./editor.tgz', react: pins.dependencies.react, 'react-dom': pins.dependencies['react-dom'] },
  devDependencies: { vite: pins.devDependencies.vite, typescript: pins.dependencies.typescript ?? pins.devDependencies.typescript,
    '@types/react': pins.devDependencies['@types/react'], '@types/react-dom': pins.devDependencies['@types/react-dom'] }
}
function command(exe: string, args: string[]) {
  const result = spawnSync(exe, args, { cwd: project, windowsHide: true, stdio: 'inherit', timeout: 240000,
    env: { ...process.env, PATH: join(root, '.local/toolchain') + delimiter + process.env.PATH } })
  if (result.error || result.status !== 0) throw result.error ?? new Error(basename(exe) + ' returned ' + result.status)
}
async function removeConsumer() {
  const actual = await realpath(project)
  if (dirname(actual) !== temp || actual !== project || !basename(actual).startsWith('geppio-web-consumer-')) throw new Error('Unexpected disposable consumer path')
  await rm(project, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
}
try {
  await cp(ui!, dir('ui.tgz'))
  await cp(editor!, dir('editor.tgz'))
  await cp(join(root, 'tools/fixtures/external-libraries/app.tsx'), dir('app.tsx'))
  await writeFile(dir('package.json'), JSON.stringify(manifest))
  await cp(join(root, 'pnpm-lock.yaml'), dir('pnpm-lock.yaml'))
  await cp(join(root, 'pnpm-workspace.yaml'), dir('pnpm-workspace.yaml'))
  // Reuse the lock and store; registry metadata may still be required by pnpm's supply-chain checks.
  if (process.platform === 'win32') command('cmd.exe', ['/d', '/c', 'pnpm.cmd install --prefer-offline --no-frozen-lockfile --ignore-scripts'])
  else command('pnpm', ['install', '--prefer-offline', '--no-frozen-lockfile', '--ignore-scripts'])
  for (const dependency of ['@geppio/ui', '@geppio/editor', 'vite', 'react', 'react-dom']) {
    const path = await realpath(dir('node_modules/' + dependency))
    const inside = relative(project, path)
    assert.ok(!inside.startsWith('..') && !isAbsolute(inside), dependency + ' must resolve inside the disposable consumer')
  }
  await writeFile(dir('tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, jsx: 'react-jsx', types: ['vite/client']
  }, include: ['app.tsx'] }))
  command(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'])
  await writeFile(dir('index.html'), '<!doctype html><html lang="pt-BR"><meta charset="UTF-8"><title>Consumidor local</title><div id="root"></div><script type="module" src="/app.tsx"></script></html>')
  await writeFile(dir('vite.config.ts'), "export default { worker: { format: 'es' }, build: { minify: false } }")
  command(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'])
  const dist = dir('dist'), files = new Map<string, string>()
  for (const ent of await readdir(dist, { recursive: true, withFileTypes: true })) if (ent.isFile()) {
    const file = join(ent.parentPath, ent.name)
    files.set('/' + relative(dist, file).replaceAll('\\', '/'), file)
  }
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }
  const server = createServer(async (req, res) => {
    const file = files.get(req.url === '/' ? '/index.html' : req.url ?? '')
    if (!file) { res.writeHead(404).end(); return }
    try { res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)) }
    catch { res.destroy() }
  })
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
  try {
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
    const main = ts.transpileModule(`
      import { app, BrowserWindow } from 'electron'
      void app.whenReady().then(async () => {
        const window = new BrowserWindow({ width: 820, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
        await window.loadURL(${JSON.stringify(origin)})
      })
    `, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
    await writeFile(dir('main.cjs'), main)
    const app = await electron.launch({ args: ['--user-data-dir=' + dir('profile'), dir('main.cjs')], timeout: 30000 })
    try {
      const page = await app.firstWindow({ timeout: 30000 })
      page.setDefaultTimeout(30000)
      page.on('pageerror', error => console.error('Consumer runtime:', error.message))
      await page.waitForSelector('#right .monaco-editor')
      const help = page.getByRole('button', { name: 'Ajuda' })
      const size = await help.boundingBox()
      assert.equal(size?.width, 32)
      assert.equal(size?.height, 32)
      await help.click()
      assert.equal(await page.getByRole('dialog', { name: 'Ajuda local' }).isVisible(), true)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.body.dataset.jsonWorker === 'responded')
      assert.equal(await page.evaluate(() => 'geppio' in window), false)
      assert.equal(await page.locator('#draft').innerText(), '{"word":"olá 😀"}')
      await page.locator('#left .view-lines').click()
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('é')
      await page.waitForFunction(() => document.getElementById('draft')?.textContent?.endsWith('é'))
      assert.match(await page.locator('#right .view-lines').innerText(), /é/)
      await page.getByRole('button', { name: 'Desfazer' }).click()
      await page.waitForFunction(() => document.getElementById('draft')?.textContent?.endsWith('}'))
      await page.getByRole('button', { name: 'Refazer' }).click()
      await page.waitForFunction(() => document.getElementById('draft')?.textContent?.endsWith('é'))
      await page.getByRole('button', { name: 'Encerrar' }).click()
      assert.equal(await page.locator('body').getAttribute('data-disposed'), 'true')
      console.log('Packed external consumer passed React controls, focus, Monaco JSON worker, shared editing, undo/redo and disposal.')
    } finally { await app.close() }
  } finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())) }
} finally { await removeConsumer() }
