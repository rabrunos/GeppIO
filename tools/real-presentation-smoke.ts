import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { enableDeveloperMode } from './plugin-dev-support.ts'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { IDENTITY } from '../src/shared/identity.ts'
import type { Edge, Presentation } from '../src/shared/workbench/presentations.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-real-presentations-'))
const scale125 = process.argv.includes('--scale125'), directory = `.local/diagnostics/real-presentations-alpha36-${scale125 ? '1.25' : '1'}`
await mkdir(directory, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], essentials = 'geppio.workspace-essentials'
const content = (name: string) => page.locator(`[data-plugin-widget="${essentials}:${name}"]`)
const frame = (name = 'notes') => page.locator('.widget-frame').filter({ has: content(name) })
const selector = () => page.getByRole('button', { name: 'Apresentação de Anotações', exact: true })
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
const stored = async () => JSON.parse((await raw())!)
async function launch() {
  app = await electron.launch({ args: ['.', ...(scale125 ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(2000, 1400); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
  assert.equal(await page.evaluate(() => devicePixelRatio), scale125 ? 1.25 : 1)
}
async function restart() { await app!.close(); app = undefined; await launch() }
async function begin() { if (await page.getByTestId('edit-layout').count()) { await page.getByTestId('edit-layout').click(); await settle(page) } }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function reveal() {
  await page.mouse.click(1000, 65); await page.mouse.move(1000, 65)
  await page.waitForFunction(() => document.querySelector('[data-plugin-widget="geppio.workspace-essentials:notes"]')?.closest('.widget-frame')?.getAttribute('data-panel-open') === 'false')
  await settle(page)
  const box = await frame().boundingBox(); assert.ok(box)
  const point = { x: box.x + Math.min(15, box.width / 2), y: box.y + Math.min(15, box.height / 2) }
  assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('.widget-frame')?.getAttribute('data-presentation'), point), 'overlay')
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(() => document.querySelector('[data-plugin-widget="geppio.workspace-essentials:notes"]')?.closest('.widget-frame')?.getAttribute('data-panel-open') === 'true')
  await settle(page)
}
async function choose(mode: Presentation, anchor: Edge | null = 'bottom') {
  await begin()
  if (await frame().getAttribute('data-presentation') === 'overlay') await reveal()
  const heading = frame().locator('.widget-heading'), box = await heading.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + Math.min(15, box.width / 2), box.y + Math.min(15, box.height / 2))
  await selector().focus(); await selector().press('Enter')
  await page.getByRole('menuitemradio', { name: { normal: 'Normal', docked: 'Encaixado', overlay: 'Flutuante' }[mode], exact: true }).click()
  if (mode !== 'normal') await page.getByRole('menuitemradio', { name: anchor ? { top: 'Topo', bottom: 'Embaixo', left: 'Esquerda', right: 'Direita' }[anchor] : 'Sem âncora', exact: true }).click()
  await settle(page)
  assert.equal(await frame().getAttribute('data-presentation'), mode)
}
async function saved(name: string) { await content(name).getByRole('status', { includeHidden: true }).filter({ hasText: /^Salvo\.$/ }).waitFor({ state: 'attached' }) }
async function fill(name: string, label: string, value: string) {
  await content(name).getByRole('textbox', { name: label, exact: true }).fill(value)
  await content(name).getByRole('textbox', { name: label, exact: true }).blur()
  await page.waitForFunction(({ name, value }) => {
    const node = document.querySelector(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`)
    return node?.querySelector('[role="status"]')?.textContent === 'Salvo.' && [...node.querySelectorAll('input,textarea')].some(input => (input as HTMLInputElement).value === value)
  }, { name, value })
}
async function data() {
  const root = join(profile, IDENTITY.directory, 'plugin-data')
  const files = await readdir(root)
  for (const file of files) { const text = await readFile(join(root, file), 'utf8'); if (JSON.parse(text).pluginId === essentials) return text }
  throw new Error('Missing confirmed Essentials data')
}
async function mark() { await page.locator('.widget-content,[data-plugin-widget]').evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-pilot-mount', 'retained'))) }
async function retained(workers: ReturnType<Page['workers']>, count: number) {
  assert.deepEqual(page.workers(), workers, 'Presentation preserves accepted Worker instances')
  assert.equal(await page.locator('[data-pilot-mount="retained"]').count(), count, 'Content roots remain mounted')
}
try {
  await launch(); await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await enableDeveloperMode(manager)
  await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/workspace-essentials'))
  await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click()
  await manager.locator(`[data-plugin="${essentials}"]`).getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.workspace-essentials"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await begin()
  for (const name of ['notes', 'checklist']) { await page.locator(`[data-catalog-type="plugin:${essentials}:${name}"]`).click(); await page.locator('[data-widget-place="main"]').click(); await settle(page) }
  await conclude()
  assert.equal(await frame().getAttribute('data-presentation'), 'normal')
  await content('notes').getByRole('button', { name: 'Nova anotação', exact: true }).click()
  await content('notes').getByRole('textbox', { name: 'Título', exact: true }).waitFor()
  await fill('notes', 'Título', 'Piloto real'); await fill('notes', 'Texto da anotação', 'Conteúdo preservado alpha.36')
  await fill('checklist', 'Novo item', 'Controle Normal'); await content('checklist').getByRole('button', { name: 'Adicionar item', exact: true }).click()
  await content('checklist').getByRole('checkbox', { name: 'Controle Normal', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === true); await saved('checklist')
  const confirmed = await data(), initial = await stored(), identity = await frame().getAttribute('data-model-id')
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => localStorage.setItem('geppio:theme:v1', theme), theme); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    await mark(); const count = await page.locator('[data-pilot-mount]').count(), workers = page.workers()
    for (const mode of ['docked', 'overlay'] as const) for (const anchor of ['top', 'bottom', 'left', 'right', null] as const) {
      if (mode === 'docked' && anchor === null) continue
      await choose(mode, anchor); await conclude()
      const panel = await stored(); assert.deepEqual(panel.layout, initial.layout, 'Mode/anchor never rewrites Normal geometry')
      if (mode === 'overlay') {
        await page.mouse.click(1000, 65); await settle(page)
        const before = await frame('checklist').boundingBox(); await reveal()
        assert.deepEqual(await frame('checklist').boundingBox(), before, 'Reveal never changes the underlying Normal projection')
      }
      await retained(workers, count); assert.equal(await data(), confirmed)
      await choose('normal'); await conclude(); await retained(workers, count)
      assert.deepEqual((await stored()).layout, initial.layout)
      assert.equal(await frame().getAttribute('data-model-id'), identity)
    }
    await page.screenshot({ path: `${directory}/${theme}.png` })
    console.log(`PASS real Notes matrix: ${theme}`)
  }
  await choose('docked', 'bottom'); await conclude()
  const lifecycleLayout = await raw(), lifecycleData = await data()
  const installed = () => page.evaluate(async () => {
    const result = await window.geppio!.plugins.list(); if (!result.ok) throw new Error(result.error)
    const plugin = result.value.plugins.find(p => p.manifest.id === 'geppio.workspace-essentials')!
    return { revision: plugin.revision, generation: plugin.generation }
  })
  const originalInstallation = await installed()
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const entry = page.getByRole('dialog', { name: 'Plugins', exact: true }).locator(`[data-plugin="${essentials}"]`)
  await entry.getByRole('switch').click(); await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.workspace-essentials"]')?.getAttribute('data-status') === 'disabled')
  assert.equal(await raw(), lifecycleLayout); assert.equal(await data(), lifecycleData)
  await entry.getByRole('switch').click(); await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.workspace-essentials"]')?.getAttribute('data-status') === 'active')
  assert.deepEqual(await installed(), originalInstallation)
  await page.getByRole('dialog', { name: 'Plugins', exact: true }).getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Configurações', exact: true })
  await settings.getByRole('button', { name: 'Desenvolvimento e recuperação', exact: true }).click()
  let recreated = 0; const created = () => { recreated++ }; page.on('worker', created)
  const replacement = page.waitForEvent('worker')
  await settings.locator(`[data-plugin="${essentials}"]`).getByRole('button', { name: 'Recarregar', exact: true }).click()
  await replacement
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.workspace-essentials"]')?.getAttribute('data-status') === 'active')
  page.off('worker', created); assert.equal(recreated, 1, 'An explicit accepted reload replaces the Worker exactly once')
  const reloaded = await installed(); assert.equal(reloaded.revision, originalInstallation.revision); assert.notEqual(reloaded.generation, originalInstallation.generation)
  await settings.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await settle(page)
  assert.equal(await raw(), lifecycleLayout); assert.equal(await data(), lifecycleData)
  const splitter = () => page.getByRole('separator', { name: 'Altura de Anotações', exact: true })
  const preferredBefore = (await stored()).organization.presentations.entries[0].preferred.height as number
  await splitter().hover(); const edge = await splitter().boundingBox(); assert.ok(edge)
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down()
  assert.equal(await splitter().evaluate(node => node.hasPointerCapture(1)), true)
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 - 32, { steps: 8 })
  assert.equal(await raw(), lifecycleLayout, 'A resize preview does not write preferences')
  await page.mouse.up()
  await page.waitForFunction(({ key, height }) => JSON.parse(localStorage.getItem(key)!).organization.presentations.entries[0].preferred.height > height + 25, { key: WORKBENCH_KEY, height: preferredBefore })
  const preferred = (await stored()).organization.presentations.entries[0].preferred
  assert.deepEqual((await stored()).layout, initial.layout); await settle(page)
  await splitter().press('Enter'); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  const collapsed = await raw(); await restart(); assert.equal(await raw(), collapsed); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  assert.deepEqual((await stored()).organization.presentations.entries[0].preferred, preferred)
  await frame().locator('.widget-heading').press('Enter'); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  const wide = await raw()
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 580)); await settle(page)
  assert.equal(await raw(), wide)
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(2000, 1400)); await settle(page)
  assert.equal(await raw(), wide); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' }); await splitter().press('Space'); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  await frame().locator('.widget-heading').press('Space'); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'true'); await page.emulateMedia({ reducedMotion: 'no-preference' })
  await restart(); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await choose('overlay', null)
  await page.mouse.click(1000, 65); await settle(page)
  const header = await frame().locator('.widget-heading').boundingBox(); assert.ok(header)
  const positionBefore = Number(await frame().getAttribute('data-x')), beforeDrag = await raw()
  await page.mouse.move(header.x + 22, header.y + 12); await page.mouse.down(); await page.mouse.move(header.x + 142, header.y + 72, { steps: 12 })
  assert.equal(await raw(), beforeDrag); await page.mouse.up(); await settle(page)
  assert.ok(Number(await frame().getAttribute('data-x')) > positionBefore + 50)
  await conclude(); const overlay = await raw(); await restart(); assert.equal(await raw(), overlay); await reveal()
  await choose('normal'); await page.getByTestId('save-layout').click(); await settle(page)
  const checkpoint = await raw(); await choose('docked', 'left')
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.equal(await frame().getAttribute('data-presentation'), 'normal')
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await frame().getAttribute('data-presentation'), 'docked')
  await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), checkpoint)
  assert.equal(await data(), confirmed); assert.equal(await content('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), 'Conteúdo preservado alpha.36')
  await content('checklist').getByRole('checkbox', { name: 'Controle Normal', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === false); await saved('checklist')
  await begin()
  assert.equal(await page.getByRole('button', { name: 'Apresentação de Checklist', exact: true }).count(), 0)
  await frame('checklist').locator('.group-source-handle').click(); await frame().locator('[data-group-target]').click(); await settle(page)
  const group = page.locator('[data-group-host="true"]'); assert.equal(await group.getByRole('tab').count(), 2)
  const groupedBytes = await raw(), undoBefore = await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled()
  await selector().focus(); await selector().press('Enter'); await page.getByRole('menuitemradio', { name: 'Encaixado', exact: true }).click(); await page.getByRole('menuitemradio', { name: 'Topo', exact: true }).click(); await settle(page)
  assert.equal(await frame().getAttribute('data-presentation'), 'normal'); assert.equal(await group.getByRole('tab').count(), 2)
  assert.equal(await raw(), groupedBytes); assert.equal(await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled(), undoBefore)
  assert.match(await page.locator('.workspace-feedback').innerText(), /Separe a aba/)
  await page.keyboard.press('Escape'); await page.getByTestId('cancel-layout').click(); await settle(page)
  await choose('docked', 'right'); const valid = await raw()
  await page.evaluate(key => {
    const original = Storage.prototype.setItem
    Reflect.set(window, 'restorePilotStorage', () => { Storage.prototype.setItem = original })
    Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException('Pilot quota', 'QuotaExceededError'); original.call(this, k, value) }
  }, WORKBENCH_KEY)
  try { await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), valid); assert.match(await page.locator('.workspace-feedback').innerText(), /armazenamento|salvar|espaço/i) }
  finally { await page.evaluate(() => { Reflect.get(window, 'restorePilotStorage')(); Reflect.deleteProperty(window, 'restorePilotStorage') }) }
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: WORKBENCH_KEY, value: valid + '\n' })
  await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), valid + '\n')
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: WORKBENCH_KEY, value: valid! })
  await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.deepEqual(errors, [])
  console.log(`PASS real Notes: four Docked/five Overlay choices, keyboard selector/collapse/reopen, reduced motion, both themes, DPR ${scale125 ? '1.25 simulated' : '1'}, unchanged Normal geometry/data/identity/Workers/mounts, hover peer bounds, free movement, restart/adaptation/history, pause/reactivation/reload, group/quota/CAS refusal; Checklist control`)
} catch (error) { await page?.screenshot({ path: `${directory}/failure.png` }).catch(() => {}); throw error }
finally { await app?.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); assert.ok(profile.includes('geppio-smoke-real-presentations-')); await rm(profile, { recursive: true, force: true }) }
