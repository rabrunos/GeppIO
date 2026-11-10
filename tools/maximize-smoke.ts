import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-maximize-')), scale = process.argv.includes('--scale125') ? 1.25 : 1
const diagnostics = `.local/diagnostics/maximize-alpha26-${scale}`; await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
const app = await electron.launch({ args: ['.', ...(scale === 1.25 ? ['--force-device-scale-factor=1.25'] : [])], env, timeout: 30000 })
try {
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const resize = async (width: number, height: number) => { await app.evaluate(({ BrowserWindow }, { width, height }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(width, height); w.show(); w.focus() }, { width, height }); await settle(page) }
  await resize(1920, 1080); await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click(); const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  for (const name of ['workspace-essentials', 'time-tracker']) {
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/' + name))
    await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click()
    await manager.locator(`[data-plugin="geppio.${name}"]`).getByRole('switch').click()
    await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', 'geppio.' + name)
  }
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByTestId('edit-layout').click(); await settle(page)
  for (const [plugin, name, region] of [['workspace-essentials', 'scratch', 'main'], ['workspace-essentials', 'notes', 'main'], ['workspace-essentials', 'checklist', 'sidebar'], ['workspace-essentials', 'prompts', 'bottom'], ['time-tracker', 'timer', 'main']]) {
    await page.locator(`[data-catalog-type="plugin:geppio.${plugin}:${name}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
  }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const scratch = page.locator('[data-plugin-widget="geppio.workspace-essentials:scratch"]'), notes = page.locator('[data-plugin-widget="geppio.workspace-essentials:notes"]')
  const frame = scratch.locator('xpath=ancestor::section[contains(@class,"widget-frame")]')
  const text = 'Rascunho confirmado antes de maximizar'
  await scratch.getByRole('textbox').fill(text); await scratch.getByRole('textbox').blur()
  await page.waitForFunction(() => !document.querySelector('[data-plugin-widget="geppio.workspace-essentials:scratch"]')?.textContent?.includes('Alterações pendentes'))
  await scratch.evaluate(node => node.setAttribute('data-mount-proof', 'scratch')); await notes.evaluate(node => node.setAttribute('data-mount-proof', 'peer'))
  const workers = page.workers(), raw = () => page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
  const geometry = () => page.locator('.widget-frame[data-owner-region="main"]').evaluateAll(nodes => nodes.map(node => ['data-widget-id', 'data-x', 'data-y', 'data-w', 'data-h'].map(key => node.getAttribute(key))))
  const before = await raw(), rects = await geometry()
  const timer = page.locator('[data-plugin-widget="geppio.time-tracker:timer"]')
  await timer.getByRole('button', { name: 'Iniciar', exact: true }).click(); await timer.getByRole('button', { name: 'Pausar', exact: true }).waitFor()
  const clockBefore = await timer.locator('p').textContent()
  assert.equal(await page.getByRole('button', { name: 'Maximizar Cronômetro', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Maximizar Checklist', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Maximizar Rascunho', exact: true }).click(); await settle(page)
  assert.equal(await notes.locator('xpath=ancestor::section').isVisible(), false)
  assert.equal(await page.locator('.widget-frame[data-owner-region="main"]:visible').count(), 1)
  await page.waitForFunction(before => document.querySelector('[data-plugin-widget="geppio.time-tracker:timer"] p')?.textContent !== before, clockBefore)
  const box = await frame.boundingBox(), owner = await page.locator('[data-region="main"]').boundingBox(); assert.ok(box && owner && box.width > owner.width - 30 && box.height > owner.height - 30)
  assert.equal(await raw(), before); assert.equal(await scratch.getByRole('textbox').inputValue(), text)
  await page.getByRole('button', { name: 'Restaurar Rascunho', exact: true }).click(); await settle(page)
  assert.deepEqual(await geometry(), rects); assert.equal(await raw(), before)
  const maximize = page.getByRole('button', { name: 'Maximizar Rascunho', exact: true }); await maximize.focus(); await page.keyboard.press('Space'); await settle(page)
  assert.equal(await page.getByRole('button', { name: 'Restaurar Rascunho', exact: true }).evaluate(node => node === document.activeElement), true)
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
  assert.equal(await page.getByRole('button', { name: 'Restaurar Rascunho', exact: true }).evaluate(node => node === document.activeElement), true, 'Restore participates in ordinary sequential focus navigation')
  await resize(1200, 800); await page.keyboard.press('Space'); await settle(page); await resize(1920, 1080)
  assert.equal(await raw(), before); assert.deepEqual(await geometry(), rects)
  await maximize.click(); await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page); await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page)
  const bottom = page.getByRole('separator', { name: 'Altura da Bottom', exact: true }); await bottom.click(); await settle(page); await bottom.click(); await settle(page)
  await page.getByTestId('edit-layout').click(); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-maximized-surface'), null)
  await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.equal(await scratch.getAttribute('data-mount-proof'), 'scratch'); assert.equal(await notes.getAttribute('data-mount-proof'), 'peer'); assert.deepEqual(page.workers(), workers)
  await maximize.click(); await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await manager.locator('[data-plugin="geppio.workspace-essentials"]').getByRole('switch').click(); await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-maximized-surface'), null)
  assert.deepEqual(errors, []); await page.screenshot({ path: diagnostics + '/restored.png' })
  console.log(`PASS maximize: exact bytes/geometry, mouse/focus, mounted peers/content/Workers, resized projection, Edit, eligibility, peer regions and target unavailability; automated DPR ${scale}`)
} catch (error) { await (await app.firstWindow()).screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}); throw error }
finally { await app.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); await rm(profile, { recursive: true, force: true }) }
