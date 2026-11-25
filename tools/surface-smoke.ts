import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { electron } from './test-electron.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { PluginStore } from '../src/geppio/src/main/plugins.ts'

const root = await mkdtemp(join(tmpdir(), 'geppio-smoke-api3-')), source = join(root,'sources'), profile = join(root,'profile')
await mkdir(profile)
await cp('examples/standalone/plugins',source,{ recursive: true })
const store = new PluginStore(join(profile,'geppio','plugins'))
await store.setDeveloperMode(true)
for (const dir of ['board','stamp']) { await store.loadExternal(join(source, dir)); await store.setEnabled('sample.' + dir, true) }
const env = Object.fromEntries(Object.entries(process.env).filter((p): p is [string,string] => typeof p[1] === 'string'))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: ['.'], env: { ...env, GEPPIO_TEST_USER_DATA: profile } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('pageerror', e => console.log('Surface smoke page error:', e.message))
  page.on('console', e => { if (e.type() === 'error') console.log('Console:', e.text().slice(0,300)) })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  const settings = async () => {
    await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
    await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
  }
  const close = () => page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  const record = (name: string) => page.locator('[data-plugin="sample.' + name + '"]')
  await settings()
  await record('stamp').locator('[type=checkbox]').first().waitFor()
  await close(); await page.getByTestId('edit-layout').click(); await settle(page)
  for (const dir of ['board','stamp']) {
    await page.locator('[data-catalog-type="plugin:sample.' + dir + ':panel"]').click()
    await page.locator('.widget-browser-destination [data-widget-place="main"]').click()
    await settle(page)
  }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const widget = (dir: string) => page.locator('[data-plugin-widget="sample.' + dir + ':panel"]')
  const stamp = widget('stamp').frameLocator('iframe').first()
  await stamp.getByRole('button').click(); await stamp.getByText('denied', { exact: true }).waitFor()
  await settings()
  for (const box of await record('stamp').getByRole('checkbox').all()) await box.check()
  await close()
  const guest = widget('board').frameLocator('iframe[title="sample.stamp"]')
  await guest.getByRole('button').click()
  await guest.getByText('sample.stamp · 0').waitFor()
  const guestFrame = page.frames().find(frame => frame.url().includes('/sample.stamp/') && frame.parentFrame())
  assert.ok(guestFrame)
  const authority = await guestFrame.evaluate(() => {
    let parentDenied = false, storageDenied = false
    try { void parent.document } catch { parentDenied = true }
    try { void localStorage.length } catch { storageDenied = true }
    return [parentDenied, storageDenied, typeof window.geppio, typeof process, typeof require]
  })
  assert.deepEqual(authority,[true,true,'undefined','undefined','undefined'])
  await widget('board').frameLocator('iframe[title="sample.board"]').getByRole('button').click()
  await guest.getByText('Atualizado', { exact: true }).waitFor()
  await settings()
  const before = await page.evaluate(async () => {
    const result = await window.geppio!.plugins.list()
    if (!result.ok) throw new Error(result.error)
    return result.value.plugins.find(p => p.manifest.id === 'sample.stamp')!
  })
  const entry = join(source,'stamp','entry.ts'), code = await readFile(entry,'utf8')
  await writeFile(entry, 'const =')
  const reload = record('stamp').getByRole('button', { name: 'Atualizar', exact: true })
  await reload.click()
  await page.getByText('Sintaxe inválida na entrada da superfície.', { exact: true }).waitFor()
  assert.ok(!guestFrame.isDetached())
  await writeFile(entry,code)
  const panel = join(source,'stamp','panel.html'); await writeFile(panel,(await readFile(panel,'utf8')).replace('Consultar quadro','Consultar atualizado'))
  const start = performance.now()
  await reload.click()
  // Settings overlays the workspace. Wait for the real updated view to finish
  // its script and serve a live SDK request without including a dialog close.
  const refreshed = await stamp.getByRole('button', { name: 'Consultar atualizado' }).elementHandle()
  assert.ok(refreshed)
  await refreshed.evaluate(button => (button as HTMLButtonElement).click())
  await stamp.getByText('denied',{ exact: true }).waitFor({ state: 'attached' })
  const elapsed = Math.round(performance.now() - start)
  assert.ok(elapsed <= 10000,'Atualizar exceeded ten seconds: ' + elapsed)
  const after = await page.evaluate(async () => {
    const result = await window.geppio!.plugins.list()
    if (!result.ok) throw new Error(result.error)
    return result.value.plugins.find(p => p.manifest.id === 'sample.stamp')!
  })
  assert.equal(after.revision,before.revision); assert.notEqual(after.generation,before.generation)
  assert.equal(await record('stamp').getByRole('checkbox').first().isChecked(), false)
  assert.ok(guestFrame.isDetached())
  console.log('API 3: original folder Atualizar to working updated view',elapsed,'ms. Slot caller, event, sandbox, grant revocation and rejected candidate passed.')
} finally { await app.close(); await rm(root,{ recursive: true,force: true }) }
