import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { parseManifest } from '../src/geppio/src/shared/plugins.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'
import type { WorkbenchSnapshot } from '../src/geppio/src/shared/workbench/model.ts'
import { parsePortableText } from '../src/geppio/src/shared/workbench/portable.ts'
import { beginEdit, settle } from './freeform-smoke.ts'

const captured = 'Grupo de revisão', imported = 'Grupo portátil de revisão', personal = 'Meu modelo de revisão'
const providerId = 'local.composition-templates', essentials = 'geppio.workspace-essentials'
const group = (page: Page) => page.locator('.widget-frame[data-group-host]')
const frame = (page: Page, widget: string) => page.locator('.widget-frame').filter({ has: page.locator('[data-plugin-widget="' + essentials + ':' + widget + '"]') })
const card = (page: Page, name: string) => page.locator('[data-composition-card]').filter({ has: page.getByText(name, { exact: true }) })
const bytes = (page: Page) => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
async function snapshot(page: Page) {
  const raw = await bytes(page); assert.ok(raw)
  return JSON.parse(raw) as { schemaVersion: number; layout: unknown; organization: WorkbenchSnapshot['organization'] }
}
async function catalog(page: Page, open: boolean) {
  const toggle = page.locator('.widget-catalog-toggle')
  if ((await toggle.getAttribute('aria-expanded') === 'true') !== open) { await toggle.click(); await settle(page) }
}
async function library(page: Page) {
  await catalog(page, true)
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
}
async function conclude(page: Page) {
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
}
const savedTab = (page: Page) => page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click()
const titles = (page: Page) => group(page).getByRole('tab').allTextContents()
async function chooseFile(app: ElectronApplication, path: string, saving: boolean) {
  await app.evaluate(({ dialog }, { path, saving }) => {
    if (saving) {
      const original = dialog.showSaveDialog
      dialog.showSaveDialog = async () => { dialog.showSaveDialog = original; return { canceled: false, filePath: path } }
    } else {
      const original = dialog.showOpenDialog
      dialog.showOpenDialog = async () => { dialog.showOpenDialog = original; return { canceled: false, filePaths: [path] } }
    }
  }, { path, saving })
}

export async function exerciseCompositions(app: ElectronApplication, page: Page, temp: string) {
  await beginEdit(page); await catalog(page, true)
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click()
  for (const widget of ['notes', 'checklist']) {
    await page.locator('[data-catalog-type="plugin:' + essentials + ':' + widget + '"]').click()
    await page.locator('.widget-browser-destination [data-widget-place="main"]').click(); await settle(page)
  }
  await catalog(page, false)
  await frame(page, 'checklist').locator('.group-source-handle').click()
  await frame(page, 'notes').locator('[data-group-target][data-group-allowed=true]').click()
  await group(page).getByRole('tab', { name: 'Checklist', exact: true }).waitFor()
  await conclude(page)
  const beforeGroup = await bytes(page), initialOrder = await titles(page)
  assert.deepEqual(initialOrder, ['Anotações', 'Checklist'])
  const reorder = async () => {
    await group(page).getByRole('tab', { name: 'Anotações', exact: true }).click()
    await group(page).getByRole('button', { name: 'Mover aba para a direita', exact: true }).click()
    assert.deepEqual(await titles(page), ['Checklist', 'Anotações'])
  }
  const saveCurrent = page.getByRole('button', { name: 'Salvar atual', exact: true })
  const confirm = page.getByRole('dialog', { name: 'Salvar a edição primeiro?', exact: true })
  await beginEdit(page); await reorder(); await library(page); await saveCurrent.click(); await confirm.waitFor()
  await confirm.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.getByTestId('cancel-layout').click(); await page.getByTestId('edit-layout').waitFor()
  assert.deepEqual(await titles(page), initialOrder); assert.equal(await bytes(page), beforeGroup)
  await beginEdit(page); await reorder(); await library(page); await saveCurrent.click()
  await confirm.getByRole('button', { name: 'Salvar edição e continuar', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Salvar nova composição' })
  await form.getByRole('textbox', { name: 'Nome' }).fill(captured)
  await form.getByRole('checkbox', { name: 'Área principal' }).check()
  await form.getByRole('button', { name: 'Salvar composição', exact: true }).click(); await form.waitFor({ state: 'detached' })
  await savedTab(page)
  const source = card(page, captured), portable = join(temp, 'percurso.geppio-layout.json')
  await source.hover(); await source.getByRole('button', { name: 'Opções de ' + captured }).click()
  await chooseFile(app, portable, true); await page.getByRole('menuitem', { name: /Exportar composição/ }).click()
  await page.waitForFunction(() => document.body.textContent?.includes('Composição exportada.'))
  const recipe = parsePortableText(await readFile(portable, 'utf8')); assert.equal(recipe.groups.length, 1)
  const beforeImport = await snapshot(page), originalGroup = beforeImport.organization.groups!.entries[0]!
  const startBytes = await bytes(page)
  await chooseFile(app, portable, false)
  await page.getByRole('button', { name: /Importar composição…/ }).click()
  const preview = page.getByRole('dialog', { name: 'Importar composição', exact: true })
  await preview.waitFor(); assert.equal(await bytes(page), startBytes)
  await preview.getByRole('textbox', { name: 'Nome da composição' }).fill(imported)
  await preview.getByRole('button', { name: 'Importar como nova composição' }).click()
  await preview.waitFor({ state: 'detached' }); await card(page, imported).waitFor()
  const afterImport = await snapshot(page), copy = afterImport.organization.compositions.find(item => item.name === imported)!
  assert.deepEqual(copy.portable, recipe)
  assert.equal(beforeImport.schemaVersion, 2)
  assert.deepEqual(afterImport, { ...beforeImport, schemaVersion: 3, organization: { ...beforeImport.organization, compositions: [...beforeImport.organization.compositions, copy] } })
  const provider = async () => {
    const result = await page.evaluate(() => window.geppio!.plugins.list()); assert.ok(result.ok)
    const found = result.value.plugins.find(item => item.manifest.id === providerId)
    assert.ok(found && !found.enabled && !found.unavailable && found.source === 'external')
    return found
  }
  const first = await provider(), accepted = first.manifest.compositionTemplates![0]!
  await page.getByRole('button', { name: 'Modelos de plugins', exact: true }).click()
  await page.locator('[data-composition-template-provider="' + providerId + '"][data-composition-template-id="' + accepted.id + '"]').click()
  const template = page.getByRole('dialog', { name: 'Prévia do modelo', exact: true })
  await template.waitFor(); assert.deepEqual(await snapshot(page), afterImport)
  await template.getByRole('textbox', { name: 'Nome da composição' }).fill(personal)
  await template.getByRole('button', { name: 'Adicionar cópia', exact: true }).click()
  await template.waitFor({ state: 'detached' })
  const mine = card(page, personal); await mine.hover()
  await mine.getByRole('button', { name: 'Adicionar ' + personal + ' aos favoritos', exact: true }).click()
  await conclude(page)
  const customized = await snapshot(page), userCopy = customized.organization.compositions.find(item => item.name === personal)!
  assert.deepEqual(userCopy.portable, accepted.composition); assert.ok(customized.organization.favorites.includes(userCopy.id))
  const manifestPath = join(temp, 'provider', 'plugin.json')
  const manifest = parseManifest(await readFile(manifestPath, 'utf8'))
  manifest.version = '1.1.0'; manifest.compositionTemplates![0]!.composition.name = 'Modelo revisado no percurso'
  await writeFile(manifestPath, JSON.stringify(manifest))
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
  const row = page.getByTestId('plugin-settings').locator('[data-plugin="' + providerId + '"]')
  await row.getByRole('button', { name: 'Recarregar', exact: true }).click()
  await row.getByText(/1\.1\.0/).waitFor()
  assert.equal(await row.getAttribute('data-status'), 'disabled')
  const updated = await provider(); assert.notEqual(updated.generation, first.generation); assert.equal(updated.revision, first.revision)
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  assert.deepEqual((await snapshot(page)).organization.compositions, customized.organization.compositions)
  // Leave a visibly different destination while retaining the exact local models
  // so the post-restart application has a concrete effect to verify.
  await beginEdit(page)
  await group(page).getByRole('tab', { name: 'Checklist', exact: true }).click()
  await group(page).getByRole('button', { name: 'Separar aba Checklist', exact: true }).click(); await settle(page)
  await conclude(page)
  const destination = await snapshot(page)
  assert.equal(destination.organization.groups?.entries.length ?? 0, 0)
  assert.ok(originalGroup.members.every(id => destination.organization.views.some(view => view.id === id)))
  assert.ok(destination.organization.favorites.includes(userCopy.id))
}

export async function applyAfterRestart(page: Page) {
  const before = await snapshot(page), mine = before.organization.compositions.find(item => item.name === personal)
  assert.ok(mine && before.organization.favorites.includes(mine.id)); assert.equal(before.organization.groups?.entries.length ?? 0, 0)
  const local = before.organization.compositions.find(item => item.name === captured)!, originalGroup = local.groups!.entries[0]!
  assert.ok(originalGroup.members.every(id => before.organization.views.some(view => view.id === id)))
  await beginEdit(page); await library(page); await savedTab(page)
  const importedCard = card(page, imported); await importedCard.hover()
  await importedCard.getByRole('button', { name: 'Restaurar widgets de ' + imported, exact: true }).click()
  await group(page).getByRole('tab', { name: 'Checklist', exact: true }).waitFor()
  assert.deepEqual(await titles(page), ['Checklist', 'Anotações'])
  await conclude(page)
  const after = await snapshot(page)
  assert.deepEqual(after.organization.groups!.entries[0]!.members, originalGroup.members)
  assert.deepEqual(after.organization.views, before.organization.views)
  assert.deepEqual(after.organization.compositions, before.organization.compositions)
}
