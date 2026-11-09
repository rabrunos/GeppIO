import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { portugueseFixture, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { IDENTITY } from '../src/shared/identity.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-sidebar-'))
const diagnostics = '.local/diagnostics/sidebar-stack-alpha22'
await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: Record<string, string> = {}
const plugin = 'geppio.workspace-essentials', names = ['notes', 'checklist', 'prompts']
const content = (name: string) => page.locator(`[data-plugin-widget="${plugin}:${name}"]`)
const frame = (name: string) => page.locator('.widget-frame').filter({ has: content(name) })
async function launch() {
  app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(1920, 1080); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function edit() { await page.getByTestId('edit-layout').click(); await settle(page) }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function stored() { return (await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY))! }
async function order(expected?: string[]) {
  const data = await page.locator('.widget-frame[data-owner-region="sidebar"]:not([hidden]):not([inert])').evaluateAll(nodes => nodes.map(n => ({
    id: n.querySelector<HTMLElement>('[data-plugin-widget]')!.dataset.pluginWidget!.split(':').at(-1)!,
    y: Number(n.getAttribute('data-y')), h: Number(n.getAttribute('data-h')), w: Number(n.getAttribute('data-w'))
  })).sort((a, b) => a.y - b.y))
  let y = 0
  for (const p of data) { assert.ok(Math.abs(p.y - y) < .1, JSON.stringify(data)); y += p.h + 10 }
  if (expected) assert.deepEqual(data.map(p => p.id), expected)
  return data
}
async function scroll(top = 0) { await page.locator('[data-region="sidebar"]').evaluate((n, top) => { n.scrollTop = top }, top); await settle(page) }
async function drag(name: string, y: number) {
  const grip = await frame(name).locator('.widget-grip').boundingBox(); assert.ok(grip)
  const side = await page.locator('[data-region="sidebar"]').boundingBox(); assert.ok(side)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
  await page.mouse.move(side.x + side.width / 2, side.y + (y === Infinity ? side.height - 12 : y), { steps: 15 })
  await page.locator('[data-sidebar-insertion]').waitFor()
  if (y === Infinity) await page.waitForFunction(() => { const n = document.querySelector('[data-region="sidebar"]')!; return n.scrollTop >= n.scrollHeight - n.clientHeight - 1 })
  await page.mouse.up(); await settle(page)
}
async function place(name: string, region = 'sidebar') {
  await page.locator(`[data-catalog-type="plugin:${plugin}:${name}"]`).click()
  await page.locator(`.widget-browser-destination [data-widget-place="${region}"]`).click(); await settle(page)
}
async function dragToBar(name: string, bar: string) {
  await scroll(10000)
  await frame(name).hover({ position: { x: 40, y: 12 } })
  const grip = await frame(name).locator('.widget-grip').boundingBox(), rail = await page.locator(`[data-bar-id="${bar}"]`).boundingBox()
  assert.ok(grip && rail)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 12 })
  await page.locator(`[data-bar-id="${bar}"][aria-current="true"]`).waitFor()
  await scroll(0)
  const side = await page.locator('[data-region="sidebar"]').boundingBox(); assert.ok(side)
  await page.mouse.move(side.x + side.width / 2, side.y + side.height - 45, { steps: 12 })
  await page.locator('[data-sidebar-insertion]').waitFor()
  await page.mouse.up(); await settle(page)
}
try {
  await launch()
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/workspace-essentials'))
  await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click()
  const entry = manager.locator(`[data-plugin="${plugin}"]`)
  await entry.getByRole('switch').click()
  await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', plugin)
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click()
  await edit()
  for (const name of names) await place(name)
  await order(names); await conclude()
  await content('notes').getByRole('button', { name: 'Nova anotação', exact: true }).click()
  const literal = 'Conteúdo Sidebar á <literal> preservado'
  await content('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).fill(literal)
  await content('notes').getByRole('textbox', { name: 'Título', exact: true }).click()
  await page.waitForFunction(value => {
    const c = document.querySelector('[data-plugin-widget="geppio.workspace-essentials:notes"]')
    return c?.querySelector('p')?.textContent === 'Salvo.' && c.querySelector('textarea')?.value === value
  }, literal)
  // The preceding New acknowledgement can still say Saved while the local
  // field draft is being delivered. Reload only after this exact body is durable.
  const dataRoot = join(profile, IDENTITY.directory, 'plugin-data')
  const dataFile = join(dataRoot, (await readdir(dataRoot)).find(name => name.endsWith('.json'))!)
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-plugin-widget="geppio.workspace-essentials:notes"] small[role="status"]')].some(node => node.textContent?.includes('Alterações pendentes')))
  const confirmedNote = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.equal(confirmedNote.document.value.notes[0].body, literal, 'The exact note must be acknowledged on disk before the read-only reload scenario')
  evidence.installAndContent = 'passed'

  // An older saved envelope is read with gaps in both bars. No writer runs on load.
  const raw = JSON.parse(await stored()), bar = raw.organization.bars[0]
  bar.positions = Object.fromEntries(names.map((name, i) => [`plugin:${plugin}:${name}`, [1600, 100, 850][i]]))
  for (const placement of raw.layout.placements) {
    const view = raw.organization.views.find((view: { id: string; typeId: string }) => view.id === placement.id)
    if (placement.region === 'sidebar') placement.y = bar.positions[view.typeId]
  }
  raw.layout.reference.sidebar.height = 2200
  raw.organization.bars.push({ ...structuredClone(bar), id: 'custom', name: 'Teste Sidebar', userNamed: true,
    positions: Object.fromEntries(names.map((name, i) => [`plugin:${plugin}:${name}`, i * 900])) })
  const older = JSON.stringify(raw)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: WORKBENCH_KEY, value: older })
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem
    Object.defineProperty(window, 'sidebarWrites', { value: [] })
    Storage.prototype.setItem = function(key, value) {
      if (key === 'geppio:workbench:v1') (window as Window & { sidebarWrites?: string[] }).sidebarWrites!.push(value)
      return write.call(this, key, value)
    }
  })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  await order(['checklist', 'prompts', 'notes']); assert.equal(await stored(), older)
  assert.deepEqual(await page.evaluate(() => (window as Window & { sidebarWrites?: string[] }).sidebarWrites), [])
  evidence.olderReadOnly = 'passed'
  await edit(); await scroll(0)
  await drag('prompts', 35); await order(['prompts', 'checklist', 'notes'])
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); await order(['checklist', 'prompts', 'notes'])
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); await order(['prompts', 'checklist', 'notes'])
  await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await stored(), older)
  await order(['checklist', 'prompts', 'notes'])
  evidence.homeReorderHistoryCancel = 'passed'

  await edit(); await scroll(0)
  await drag('checklist', Infinity); await order(['prompts', 'notes', 'checklist'])
  await page.getByTestId('save-layout').click(); await settle(page)
  const checkpoint = await stored()
  await scroll(0); await drag('notes', 35); await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.equal(await stored(), checkpoint); await order(['prompts', 'notes', 'checklist'])
  await page.locator('[data-bar-id="custom"]').click(); await settle(page); await order(names)
  await edit(); await scroll(0); await drag('checklist', 35); await order(['checklist', 'notes', 'prompts'])
  const resize = await frame('checklist').locator('[data-resize="s"]').boundingBox(); assert.ok(resize)
  const h = Number(await frame('checklist').getAttribute('data-h'))
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down()
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2 + 55, { steps: 10 }); await page.mouse.up(); await settle(page)
  assert.equal(Number(await frame('checklist').getAttribute('data-h')), h + 55); await order(['checklist', 'notes', 'prompts'])
  const pair = page.locator('.host-pair-divider[data-owner-region="sidebar"]').first(), box = await pair.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 6 }); await page.mouse.up(); await settle(page)
  assert.equal(Number(await frame('checklist').getAttribute('data-h')), h + 75); await order(['checklist', 'notes', 'prompts'])
  await conclude(); evidence.customResizePairSave = 'passed'

  const divider = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true })
  await divider.focus(); await page.keyboard.press('Home'); await divider.blur(); await settle(page)
  assert.ok((await order())[0]!.w >= 150)
  for (const name of names) assert.equal(await content(name).evaluate(n => n.scrollWidth <= n.clientWidth + 1), true, name + ' has no horizontal content overflow')
  await page.locator('[data-region="sidebar"]').evaluate(n => { n.scrollTop = n.scrollHeight }); await settle(page)
  assert.ok(await page.locator('[data-region="sidebar"]').evaluate(n => n.scrollTop > 0))
  await scroll(0); await page.screenshot({ path: diagnostics + '/narrow.png' }); evidence.narrowScroll = 'passed'
  // Use actual controls at the supported minimum, not only their rectangles.
  await content('checklist').getByRole('textbox', { name: 'Novo item', exact: true }).fill('Item estreito preservado')
  await content('checklist').getByRole('button', { name: 'Adicionar item', exact: true }).click()
  await content('checklist').getByRole('checkbox', { name: 'Item estreito preservado', exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === true
    && document.querySelector('[data-plugin-widget="geppio.workspace-essentials:checklist"] p')?.textContent === 'Salvo.')
  await scroll(10000)
  await content('prompts').getByRole('button', { name: 'Novo prompt', exact: true }).click()
  await content('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true }).fill('Prompt estreito preservado')
  await content('prompts').getByRole('textbox', { name: 'Título', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-plugin-widget="geppio.workspace-essentials:prompts"] p')?.textContent === 'Salvo.'
    && document.querySelector<HTMLTextAreaElement>('[data-plugin-widget="geppio.workspace-essentials:prompts"] textarea')?.value === 'Prompt estreito preservado')
  await scroll(0)
  await edit(); await frame('checklist').hover({ position: { x: 40, y: 12 } }); await frame('checklist').locator('.layout-widget-remove').click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await settle(page); await order(['notes', 'prompts'])
  await conclude()
  await page.locator('[data-bar-id="home"]').click(); await settle(page); await order(['prompts', 'notes', 'checklist'])
  // The checklist is no longer shared with custom, so its Main transfer is valid.
  await edit(); await scroll(10000)
  await frame('checklist').hover({ position: { x: 40, y: 12 } }); await frame('checklist').locator('.widget-grip').click(); await settle(page)
  await page.locator('[data-widget-place="main"]').click(); await settle(page)
  assert.equal(await frame('checklist').getAttribute('data-owner-region'), 'main'); await order(['prompts', 'notes'])
  await frame('checklist').hover({ position: { x: 40, y: 12 } }); await frame('checklist').locator('.widget-grip').click(); await settle(page)
  assert.equal(await page.locator('[data-widget-place="bottom"]').isEnabled(), true)
  await page.locator('[data-widget-place="sidebar"]').click(); await settle(page); await order(['prompts', 'notes', 'checklist'])
  await dragToBar('checklist', 'custom'); await order(['notes', 'prompts', 'checklist'])
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
  await order(['prompts', 'notes', 'checklist'])
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page)
  await order(['notes', 'prompts', 'checklist'])
  await dragToBar('checklist', 'home'); await order(['prompts', 'notes', 'checklist'])
  await conclude(); evidence.removeRegionBarMoves = 'passed'
  // Normal-mode paired resizing keeps its own guarded save.
  await scroll(0)
  const normalPair = page.locator('.host-pair-divider[data-owner-region="sidebar"]').first(), normalBox = await normalPair.boundingBox(); assert.ok(normalBox)
  const normalBefore = await order(), normalRaw = await stored()
  await page.mouse.move(normalBox.x + normalBox.width / 2, normalBox.y + normalBox.height / 2); await page.mouse.down()
  await page.mouse.move(normalBox.x + normalBox.width / 2, normalBox.y + normalBox.height / 2 + 12, { steps: 6 }); await page.mouse.up()
  await page.waitForFunction(({ key, before }) => localStorage.getItem(key) !== before, { key: WORKBENCH_KEY, before: normalRaw }); await settle(page)
  const normalAfter = await order()
  assert.ok(normalAfter[0]!.h > normalBefore[0]!.h)
  assert.ok(Math.abs(normalAfter[0]!.h + normalAfter[1]!.h - normalBefore[0]!.h - normalBefore[1]!.h) < .1)
  evidence.normalPair = 'passed'

  await app!.close(); app = undefined; await launch(); await order(['prompts', 'notes', 'checklist'])
  await scroll(400)
  assert.equal(await content('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), literal)
  assert.equal(await content('checklist').getByRole('checkbox', { name: 'Item estreito preservado', exact: true }).isChecked(), true)
  assert.equal(await content('prompts').getByRole('textbox', { name: 'Texto do prompt', exact: true }).inputValue(), 'Prompt estreito preservado')
  await page.locator('[data-bar-id="custom"]').click(); await settle(page); await order(['notes', 'prompts'])
  assert.equal(await content('notes').getByRole('textbox', { name: 'Texto da anotação', exact: true }).inputValue(), literal)
  assert.deepEqual(errors, []); evidence.restartContent = 'passed'
  await writeFile(diagnostics + '/evidence.json', JSON.stringify(evidence, null, 2))
  console.log('PASS Sidebar stack', JSON.stringify(evidence))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {})
  await writeFile(diagnostics + '/evidence.json', JSON.stringify({ ...evidence, errors, failure: String(error) }, null, 2))
  throw error
} finally {
  await app?.close()
  assert.ok(isAbsolute(profile) && profile.startsWith(join(tmpdir(), 'geppio-smoke-sidebar-')))
  await rm(profile, { recursive: true, force: true })
}
