import { enableDeveloperMode } from './plugin-dev-support.ts'
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle, beginEdit } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-groups-')), scale = process.argv.includes('--scale125') ? 1.25 : 1
const diagnostics = `.local/diagnostics/groups-alpha30-${scale}`; await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], id = 'geppio.workspace-essentials'
const widget = (name: string) => page.locator(`[data-plugin-widget="${id}:${name}"]`)
const frame = (name: string) => page.locator('.widget-frame').filter({ has: widget(name) })
const raw = () => page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
const group = () => page.locator('.widget-frame[data-group-host]')
const titles = () => group().getByRole('tab').allTextContents()
async function launch() {
  app = await electron.launch({ args: ['.', ...(scale === 1.25 ? ['--force-device-scale-factor=1.25'] : [])], env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message))
  await page.getByTestId('edit-layout').waitFor()
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(2000, 1200); w.show(); w.focus() })
  await portugueseFixture(page); await settle(page); assert.equal(await page.evaluate(() => devicePixelRatio), scale)
}
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function undo() { await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page) }
async function redo() { await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page) }
async function fill(name: string, label: string, text: string) {
  await widget(name).getByRole('textbox', { name: label, exact: true }).fill(text); await widget(name).getByRole('textbox', { name: label, exact: true }).blur()
  await page.waitForFunction(({ name, text }) => { const node = document.querySelector(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`); return node && !node.textContent?.includes('Alterações pendentes') && node.querySelector('[role="status"]')?.textContent === 'Salvo.' && [...node.querySelectorAll('input,textarea')].some(field => (field as HTMLInputElement).value === text) }, { name, text })
}
async function groupDrag(source: string, destination: string, cancel = false, allowed = true) {
  const handle = frame(source).locator('.group-source-handle'); await handle.hover(); const box = await handle.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); assert.equal(await handle.evaluate(node => node.hasPointerCapture(1)), true)
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8)
  const target = frame(destination).locator('[data-group-target]'); await target.waitFor(); assert.equal(await target.getAttribute('data-group-allowed'), String(allowed))
  const hit = await target.boundingBox(); assert.ok(hit); await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2, { steps: 10 }); await page.waitForFunction(() => !!document.querySelector('[data-group-over]'))
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up(); await settle(page); assert.equal(await page.locator('.group-drag-hint,[data-group-target]').count(), 0)
}
async function selected(title: string) {
  const tab = group().getByRole('tab', { name: title, exact: true }), id = await tab.getAttribute('id'); assert.ok(id)
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-selected') === 'true', id)
}
async function selectTab(title: string) { await group().getByRole('tab', { name: title, exact: true }).click(); await selected(title) }
async function compare() {
  await selectTab('Anotações'); assert.equal(await widget('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true, includeHidden: true }).inputValue(), 'Conteúdo real preservado nas abas á')
  await selectTab('Checklist'); assert.equal(await widget('checklist').getByRole('checkbox', { name: 'Conferir grupo', exact: true, includeHidden: true }).isChecked(), true)
  await selectTab('Prompts salvos'); assert.equal(await widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true, includeHidden: true }).inputValue(), 'Prompt literal <b>sem HTML</b>')
}
async function pendingSelectionProbe() {
  await selectTab('Checklist'); const before = await raw()
  await page.evaluate(() => new Promise<void>(acquired => {
    void navigator.locks.request('geppio:workbench:v1', async () => {
      acquired(); await new Promise<void>(release => { Reflect.set(window, 'releaseGroupSaveProbe', release) })
    })
  }))
  try {
    await group().getByRole('tab', { name: 'Anotações', exact: true }).click()
    // The old includeHidden read succeeds before this pending native selection
    // has committed. It is content evidence, never a selection acknowledgement.
    assert.equal(await widget('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true, includeHidden: true }).inputValue(), 'Prompt literal <b>sem HTML</b>')
    assert.equal(await group().getByRole('tab', { name: 'Checklist', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await raw(), before)
  } finally { await page.evaluate(() => { Reflect.get(window, 'releaseGroupSaveProbe')(); Reflect.deleteProperty(window, 'releaseGroupSaveProbe') }) }
  await selected('Anotações')
  const confirmed = JSON.parse((await raw())!); assert.equal(confirmed.organization.groups.entries[0].active, await frame('notes').getAttribute('data-widget-id'))
  await selectTab('Prompts salvos')
  console.log('PASS group selection synchronization: hidden content precedes a held preference write; native selected state and saved active ID agree after release')
}
async function transfer(region: 'main' | 'sidebar' | 'bottom', cancel = false) {
  await page.bringToFront()
  const before = await titles(), identity = await group().getAttribute('data-widget-id')
  await group().hover({ position: { x: 15, y: 15 } })
  const handle = group().locator('.widget-grip'); await handle.hover(); const start = await handle.boundingBox(); assert.ok(start)
  const port = await page.locator(`[data-region="${region}"]`).boundingBox(); assert.ok(port)
  const end = { x: region === 'sidebar' ? port.x + port.width - 45 : port.x + port.width - 80, y: port.y + port.height / 2 }
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down()
  assert.equal(await handle.evaluate(node => node.hasPointerCapture(1)), true)
  await page.mouse.move(end.x, end.y, { steps: 18 })
  const preview = page.locator('[data-group-transfer-going]'); await preview.waitFor()
  assert.equal(await preview.getAttribute('data-group-transfer-going'), '3'); assert.equal(await preview.getAttribute('data-group-transfer-staying'), '0'); assert.equal(await preview.getAttribute('data-group-transfer-allowed'), 'true')
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up(); await settle(page); assert.equal(await preview.count(), 0)
  if (!cancel) assert.equal(await group().getAttribute('data-owner-region'), region)
  assert.equal(await group().getAttribute('data-widget-id'), identity); assert.deepEqual(await titles(), before)
}
async function compactCompare() {
  await selectTab('Anotações'); await widget('notes').getByText('Conteúdo real preservado nas abas á', { exact: true }).waitFor()
  await selectTab('Checklist'); assert.equal(await widget('checklist').getByRole('checkbox', { name: 'Conferir grupo', exact: true, includeHidden: true }).isChecked(), true)
  await selectTab('Prompts salvos'); await widget('prompts').getByText('Prompt literal <b>sem HTML</b>', { exact: true }).waitFor()
}
try {
  await launch()
  await page.getByRole('button', { name: 'Plugins', exact: true }).click(); const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  for (const name of ['workspace-essentials', 'time-tracker']) {
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/' + name))
    await enableDeveloperMode(manager)
    await manager.getByRole('button', { name: 'Carregar pasta local', exact: true }).click(); await manager.locator(`[data-plugin="geppio.${name}"]`).getByRole('switch').click()
    const card = manager.locator(`[data-plugin="geppio.${name}"]`)
    await page.waitForFunction(id => ['active', 'error'].includes(document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') ?? ''), 'geppio.' + name)
    assert.equal(await card.getAttribute('data-status'), 'active', 'Real plugin activation: ' + await card.innerText())
  }
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await page.getByTestId('edit-layout').click(); await settle(page)
  for (const [plugin, name, region] of [['workspace-essentials', 'notes', 'main'], ['workspace-essentials', 'checklist', 'main'], ['workspace-essentials', 'prompts', 'main'], ['time-tracker', 'timer', 'sidebar'], ['time-tracker', 'reports', 'bottom']]) {
    await page.locator(`[data-catalog-type="plugin:geppio.${plugin}:${name}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
  }
  await conclude()
  // Old envelopes have no nested groups, remain readable and are never rewritten on load.
  const older = await raw(); assert.equal(JSON.parse(older!).organization.groups, undefined); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page); assert.equal(await raw(), older)
  await widget('notes').getByRole('button', { name: 'Nova anotação', exact: true }).click(); await widget('notes').getByRole('textbox', { name: 'Título', exact: true }).waitFor()
  await fill('notes', 'Título', 'Nota do grupo'); await fill('notes', 'Texto da anotação', 'Conteúdo real preservado nas abas á')
  await fill('checklist', 'Novo item', 'Conferir grupo'); await widget('checklist').getByRole('button', { name: 'Adicionar item', exact: true }).click(); await widget('checklist').getByRole('checkbox', { name: 'Conferir grupo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] input[type="checkbox"]')?.checked === true && document.querySelector('[data-plugin-widget="geppio.workspace-essentials:checklist"] p')?.textContent === 'Salvo.')
  await widget('prompts').getByRole('button', { name: 'Novo prompt', exact: true }).click(); await widget('prompts').getByRole('textbox', { name: 'Título', exact: true }).waitFor()
  await fill('prompts', 'Título', 'Prompt do grupo'); await fill('prompts', 'Texto do prompt', 'Prompt literal <b>sem HTML</b>')
  for (const name of ['notes', 'checklist', 'prompts']) await widget(name).evaluate((node, name) => node.setAttribute('data-mount-proof', name), name)
  const workers = page.workers()
  await beginEdit(page)
  // A real ordinary Main drag still aligns outside the dedicated grouping target.
  const rect = (name: string) => frame(name).evaluate(node => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')), width: Number(node.getAttribute('data-w')), height: Number(node.getAttribute('data-h')) }))
  const original = await rect('notes'), peer = await rect('prompts'), grip = frame('notes').locator('.widget-grip'); await frame('notes').hover({ position: { x: 40, y: 12 } }); const box = await grip.boundingBox(); assert.ok(box)
  const targetX = peer.x + (peer.width - original.width) / 2, targetY = peer.y + peer.height + 10
  assert.ok(await page.locator('[data-surface="main"]').evaluate((node, extent) => extent <= Number(node.getAttribute('data-usable-height')), targetY + original.height))
  await grip.hover(); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + targetX - original.x + 4, box.y + box.height / 2 + targetY - original.y, { steps: 15 }); await page.locator('[data-alignment-axis="x"]').waitFor(); await page.mouse.up(); await settle(page)
  await groupDrag('checklist', 'notes', true); assert.equal(await group().count(), 0)
  const beforeRejected = await rect('notes'), lowerEdge = frame('notes').locator('[data-resize="s"]'), edgeBox = await lowerEdge.boundingBox(); assert.ok(edgeBox)
  await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2); await page.mouse.down(); await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2 - beforeRejected.height + 112, { steps: 6 }); await page.mouse.up(); await settle(page)
  const tooSmall = await rect('notes'), movingBeforeRefusal = await rect('checklist'); assert.ok(tooSmall.height < 144)
  await groupDrag('checklist', 'notes', false, false); assert.equal(await group().count(), 0); assert.deepEqual(await rect('notes'), tooSmall); assert.deepEqual(await rect('checklist'), movingBeforeRefusal)
  await undo(); assert.deepEqual(await rect('notes'), beforeRejected)
  await groupDrag('checklist', 'notes'); assert.deepEqual(await titles(), ['Anotações', 'Checklist']); await undo(); assert.equal(await group().count(), 0); await redo(); assert.deepEqual(await titles(), ['Anotações', 'Checklist'])
  await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await group().count(), 0)
  await beginEdit(page); await groupDrag('checklist', 'notes')
  // A short click exposes the same header targets and focuses a valid destination.
  await frame('prompts').locator('.group-source-handle').click()
  await page.waitForFunction(() => document.activeElement?.matches('[data-group-target][data-group-allowed="true"]'))
  await page.keyboard.press('Space'); await settle(page); assert.deepEqual(await titles(), ['Anotações', 'Checklist', 'Prompts salvos'])
  await group().getByRole('button', { name: 'Mover aba para a esquerda', exact: true }).click(); assert.deepEqual(await titles(), ['Anotações', 'Prompts salvos', 'Checklist'])
  await group().getByRole('button', { name: 'Separar aba Prompts salvos', exact: true }).click(); await settle(page); assert.deepEqual(await titles(), ['Anotações', 'Checklist']); assert.equal(await frame('prompts').getAttribute('data-group-member'), null)
  await undo(); assert.deepEqual(await titles(), ['Anotações', 'Prompts salvos', 'Checklist']); await redo(); assert.deepEqual(await titles(), ['Anotações', 'Checklist']); await undo()
  const promptTab = group().getByRole('tab', { name: 'Prompts salvos', exact: true }); await promptTab.focus(); await page.keyboard.press('Alt+ArrowLeft'); assert.deepEqual(await titles(), ['Prompts salvos', 'Anotações', 'Checklist'])
  const groupBeforeResize = await rect('notes'), resize = group().locator('[data-resize="se"]'); const resizeBox = await resize.boundingBox(); assert.ok(resizeBox)
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2); await page.mouse.down(); assert.equal(await resize.evaluate(node => node.hasPointerCapture(1)), true)
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 25, resizeBox.y + resizeBox.height / 2 + 25, { steps: 5 }); await page.mouse.up(); await settle(page)
  assert.ok((await rect('notes')).height > groupBeforeResize.height + 20); assert.equal((await rect('prompts')).width, (await rect('notes')).width)
  await undo(); assert.deepEqual(await rect('notes'), groupBeforeResize)
  await page.getByTestId('save-layout').click(); await settle(page)
  await group().getByRole('button', { name: 'Mover aba para a direita', exact: true }).click(); await page.getByTestId('cancel-layout').click(); await settle(page); assert.deepEqual(await titles(), ['Prompts salvos', 'Anotações', 'Checklist'])
  await compare()
  const selectedTab = group().getByRole('tab', { name: 'Prompts salvos', exact: true }); await selectedTab.focus(); await page.keyboard.press('ArrowLeft')
  await selected('Checklist')
  assert.equal(await group().getByRole('tab', { name: 'Checklist', exact: true }).evaluate(node => node === document.activeElement && node.getAttribute('aria-selected') === 'true'), true)
  await compare(); await pendingSelectionProbe()
  for (const name of ['notes', 'checklist', 'prompts']) assert.equal(await widget(name).getAttribute('data-mount-proof'), name)
  assert.deepEqual(page.workers(), workers)
  const beforeMax = JSON.parse((await raw())!), geometry = beforeMax.layout, membership = beforeMax.organization.groups.entries.map((g: { frameId: string; members: string[] }) => ({ frameId: g.frameId, members: g.members }))
  await page.getByRole('button', { name: 'Maximizar Grupo de widgets', exact: true }).click()
  await group().getByRole('tab', { name: 'Prompts salvos', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await selected('Anotações')
  await settle(page); await compare()
  const maxBox = await group().boundingBox(), mainBox = await page.locator('[data-region="main"]').boundingBox(); assert.ok(maxBox && mainBox && maxBox.width > mainBox.width - 30)
  const timer = page.locator('[data-plugin-widget="geppio.time-tracker:timer"]'); await timer.getByRole('button', { name: 'Iniciar', exact: true }).click(); await timer.getByRole('button', { name: 'Pausar', exact: true }).click(); await page.locator('[data-plugin-widget="geppio.time-tracker:reports"]').getByText(/1 sessões/).waitFor()
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); await settle(page); await page.screenshot({ path: diagnostics + '/maximized-light.png' })
  await page.getByRole('button', { name: 'Restaurar Grupo de widgets', exact: true }).click(); await settle(page)
  assert.deepEqual(JSON.parse((await raw())!).layout, geometry); assert.deepEqual(JSON.parse((await raw())!).organization.groups.entries.map((g: { frameId: string; members: string[] }) => ({ frameId: g.frameId, members: g.members })), membership)
  await beginEdit(page)
  // Capture and restore the actual grouped composition through the existing library.
  await page.locator('.widget-catalog-toggle').click(); await settle(page)
  await page.getByRole('tab', { name: 'Composições', exact: true }).click(); await page.getByRole('button', { name: 'Salvar atual', exact: true }).click()
  const pending = page.getByRole('dialog', { name: 'Salvar a edição primeiro?', exact: true }); if (await pending.count()) await pending.getByRole('button', { name: 'Salvar edição e continuar', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Salvar nova composição', exact: true }); await save.waitFor(); await save.getByRole('textbox', { name: 'Nome', exact: true }).fill('Grupo piloto'); await save.getByRole('button', { name: 'Salvar composição', exact: true }).click(); await save.waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click(); const card = page.locator('[data-composition-id^="composition:"]'); await card.hover(); await card.getByRole('button', { name: 'Restaurar widgets de Grupo piloto', exact: true }).click(); await settle(page)
  await conclude(); await compare(); const saved = JSON.parse((await raw())!)
  await page.screenshot({ path: diagnostics + '/restored-light.png' }); await app!.close(); app = undefined; await launch(); await compare()
  const reopened = JSON.parse((await raw())!); assert.deepEqual(reopened.layout, saved.layout); assert.deepEqual(reopened.organization.groups.entries.map((g: { frameId: string; members: string[] }) => ({ frameId: g.frameId, members: g.members })), membership)
  assert.equal(await page.locator('[data-plugin-widget="geppio.time-tracker:timer"]').getByRole('button', { name: 'Iniciar', exact: true }).count(), 1)
  await beginEdit(page)
  await page.getByRole('button', { name: 'Nova barra', exact: true }).click()
  const barDialog = page.getByRole('dialog', { name: 'Nova barra', exact: true }); await barDialog.getByRole('textbox', { name: 'Nome', exact: true }).fill('Abas regionais')
  await barDialog.getByRole('button', { name: 'Criar barra', exact: true }).click(); await barDialog.waitFor({ state: 'detached' }); await settle(page)
  const custom = page.locator('[data-sidebar-custom]').filter({ hasText: '' }).last(), customId = await custom.getAttribute('data-bar-id'); assert.ok(customId)
  await custom.click(); await settle(page)
  const regionalWorkers = page.workers(), stableViews = JSON.parse((await raw())!).organization.views
  await transfer('sidebar', true); assert.equal(await group().getAttribute('data-owner-region'), 'main')
  await transfer('sidebar'); await undo(); assert.equal(await group().getAttribute('data-owner-region'), 'main'); await redo(); assert.equal(await group().getAttribute('data-owner-region'), 'sidebar'); await compare()
  await group().getByRole('tab', { name: 'Prompts salvos', exact: true }).click(); await group().getByRole('button', { name: 'Separar aba Prompts salvos', exact: true }).click(); await settle(page)
  assert.equal(await frame('prompts').getAttribute('data-owner-region'), 'sidebar'); await groupDrag('prompts', 'notes'); await compare()
  await transfer('bottom'); await compactCompare()
  await group().getByRole('button', { name: 'Separar aba Prompts salvos', exact: true }).click(); await settle(page); assert.equal(await frame('prompts').getAttribute('data-owner-region'), 'bottom')
  await groupDrag('prompts', 'notes'); await compactCompare()
  await page.getByTestId('save-layout').click(); await settle(page)
  // Bottom-only composition preserves the unrelated Sidebar Home timer.
  await page.locator('.widget-catalog-toggle').click(); await settle(page); await page.getByRole('tab', { name: 'Composições', exact: true }).click(); await page.getByRole('button', { name: 'Salvar atual', exact: true }).click()
  const regionalSave = page.getByRole('dialog', { name: 'Salvar nova composição', exact: true }); await regionalSave.waitFor(); await regionalSave.getByRole('textbox', { name: 'Nome', exact: true }).fill('Abas Bottom')
  await regionalSave.getByRole('checkbox', { name: 'Área principal', exact: true }).uncheck()
  await regionalSave.getByRole('button', { name: 'Salvar composição', exact: true }).click(); await regionalSave.waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click(); const bottomCard = page.locator('[data-composition-id^="composition:"]').filter({ hasText: 'Abas Bottom' }); await bottomCard.hover(); await bottomCard.getByRole('button', { name: 'Restaurar widgets de Abas Bottom', exact: true }).click(); await settle(page); await compactCompare()
  await page.locator('[data-bar-id="home"]').click(); await settle(page)
  await transfer('sidebar'); await compare(); await transfer('main'); await compare()
  assert.deepEqual(page.workers(), regionalWorkers)
  await conclude(); const regionalSaved = JSON.parse((await raw())!); assert.deepEqual(regionalSaved.organization.views, stableViews)
  assert.deepEqual(regionalSaved.organization.bars.find((b: { id: string }) => b.id === customId).members, [])
  await app!.close(); app = undefined; await launch(); await compare(); const regionalReopened = JSON.parse((await raw())!)
  assert.deepEqual(regionalReopened.layout, regionalSaved.layout); assert.deepEqual(regionalReopened.organization.groups, regionalSaved.organization.groups); assert.deepEqual(regionalReopened.organization.bars, regionalSaved.organization.bars); assert.deepEqual(errors, [])
  console.log(`PASS groups: real align/group/cancel/undo/redo/reorder/detach, regional count preview/transfers/Home/custom/Bottom composition, stable member DOM/Workers/content, maximized tabs and peer regions, older layout and process restart; automated DPR ${scale}`)
} catch (error) { if (app) { console.error('Group UI', { feedback: await page.locator('.workspace-feedback').allTextContents(), plugins: await page.locator('[data-plugin][data-status]').allTextContents(), errors }); await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}) }; throw error }
finally { await app?.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); await rm(profile, { recursive: true, force: true }) }
