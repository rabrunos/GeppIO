import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { settle } from './freeform-smoke.ts'

const plugin = 'geppio.workspace-essentials'
const text = 'Dado confirmado no percurso combinado'
const widget = (page: Page) => page.locator('[data-plugin-widget="geppio.workspace-essentials:scratch"]')
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
}
const closeSettings = (page: Page) => page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
async function installed(page: Page) {
  const result = await page.evaluate(() => window.geppio!.plugins.list())
  assert.ok(result.ok)
  const record = result.value.plugins.find(p => p.manifest.id === plugin)
  assert.ok(record)
  return record
}
export async function placeScratch(page: Page) {
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-catalog-type="plugin:geppio.workspace-essentials:scratch"]').click()
  await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  await widget(page).getByRole('textbox').waitFor()
}
export async function exercisePluginRecovery(app: ElectronApplication, page: Page, source: string) {
  const first = await installed(page)
  assert.ok(first.enabled && first.source === 'external')
  // Only the disposable process loses the reply. The real Main write has already returned success.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<{ok: boolean}>> })._invokeHandlers
    const write = handlers.get('plugin-data:write')!
    handlers.set('plugin-data:write', async (...args) => {
      const result = await write(...args)
      if (!result.ok) return result
      handlers.set('plugin-data:write', write)
      return { ok: false, error: 'Recibo indisponível no teste' }
    })
  })
  const scratch = widget(page)
  await scratch.getByRole('textbox').fill(text)
  await scratch.getByRole('status').filter({ hasText: /^Falha ao salvar\./ }).waitFor()
  await settings(page)
  const row = page.locator('[data-plugin="geppio.workspace-essentials"]')
  await row.getByRole('button', { name: 'Recarregar', exact: true }).click()
  await page.getByText(/Há edições pendentes ou falha ao salvar/).waitFor()
  assert.equal((await installed(page)).generation, first.generation)
  await closeSettings(page)
  assert.equal(await scratch.getByRole('textbox').inputValue(), text)
  await scratch.getByRole('button', { name: 'Tentar salvar novamente', exact: true }).press('Enter')
  await scratch.getByRole('status').filter({ hasText: /^Salvo\.$/ }).waitFor()
  const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8')) as { entry: string }
  await appendFile(join(source, manifest.entry), '\n// Disposable rebuild.\n')
  await settings(page)
  await row.getByRole('button', { name: 'Recarregar', exact: true }).click()
  await page.waitForFunction(async original => {
    const result = await window.geppio!.plugins.list()
    return result.ok && result.value.plugins.some(p => p.manifest.id === 'geppio.workspace-essentials' && p.generation !== original)
  }, first.generation)
  assert.equal((await installed(page)).revision, first.revision)
  await closeSettings(page)
  await checkConfirmedPlugin(page)
  await settings(page)
  await row.getByRole('button', { name: 'Desativar', exact: true }).click()
  await page.locator('[data-plugin="geppio.workspace-essentials"][data-status="disabled"]').waitFor()
  assert.equal((await installed(page)).revision, first.revision)
  await row.getByRole('button', { name: 'Ativar', exact: true }).click()
  await page.locator('[data-plugin="geppio.workspace-essentials"][data-status="active"]').waitFor()
  await closeSettings(page)
  await checkConfirmedPlugin(page)
}
export async function checkConfirmedPlugin(page: Page) {
  await page.waitForFunction(value => {
    const scratch = document.querySelector('[data-plugin-widget="geppio.workspace-essentials:scratch"]')
    return scratch?.querySelector('textarea')?.value === value && scratch.querySelector('[role="status"]')?.textContent === 'Salvo.'
  }, text)
}
