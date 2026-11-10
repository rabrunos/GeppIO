import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../tests/fixtures/workbench.ts'
import { serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { beginEdit, portugueseFixture, settle } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-edit-lock-'))
const diagnostics = '.local/diagnostics/edit-lock-alpha32'; await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL
env.GEPPIO_TEST_USER_DATA = profile; env.GEPPIO_TEST_DEMO_WIDGETS = '1'; env.NODE_ENV = 'production'
let app: ElectronApplication | undefined, page!: Page
const errors: string[] = [], id = 'geppio.workspace-essentials'
const widget = (name: string) => page.locator(`[data-plugin-widget="${id}:${name}"]`)
const frame = (name: string) => page.locator('.widget-frame').filter({ has: widget(name) })
const group = () => page.locator('.widget-frame[data-group-host]')
const timer = () => page.locator('[data-plugin-widget="geppio.time-tracker:timer"]')
const host = () => page.locator('[data-widget-id="properties"] input[aria-label="Nome de exemplo"]')
const field = (name: string, label: string) => widget(name).getByRole('textbox', { name: label, exact: true, includeHidden: true })
const clock = () => timer().locator('p').textContent()
async function launch() {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(2000, 1400); w.show(); w.focus() }); await settle(page)
}
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function saved(name: string) { await page.waitForFunction(name => { const node = document.querySelector(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`); return node?.querySelector('[role="status"]')?.textContent === 'Salvo.' && !node.textContent?.includes('Alterações pendentes') && !node.textContent?.includes('Falha ao enviar') }, name) }
// Wait for the normal debounced acknowledgement; retain the host's 10-events/s
// guard rather than turning fixture preparation into an immediate-blur burst.
async function fill(name: string, label: string, text: string) { await field(name, label).fill(text); await saved(name) }
async function toggle(checked: boolean) {
  await widget('checklist').getByRole('checkbox', { name: 'Item preservado', exact: true }).click()
  await page.waitForFunction(checked => document.querySelector<HTMLInputElement>('[data-plugin-widget="geppio.workspace-essentials:checklist"] .plugin-check-item input')?.checked === checked, checked)
  await saved('checklist')
}
async function place(plugin: string, name: string, region: string) { await page.locator(`[data-catalog-type="plugin:geppio.${plugin}:${name}"]`).click(); await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page) }
async function move(name: string, region: string) {
  await frame(name).hover({ position: { x: 15, y: 15 } }); await frame(name).locator('.widget-grip').click(); await settle(page)
  await page.locator(`[data-widget-place="${region}"]`).click(); await settle(page)
  if (await page.locator('.widget-catalog-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.widget-catalog-toggle').click()
  await settle(page); assert.equal(await frame(name).getAttribute('data-owner-region'), region)
}
async function data() {
  return page.evaluate(() => {
    const node = (name: string) => document.querySelector<HTMLElement>(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`)
    const reader = (name: string) => { const n = node(name); return { body: n?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? n?.querySelector('.bottom-plugin-preview')?.textContent, entries: n?.querySelectorAll('.plugin-list-choice,select option').length } }
    return { notes: reader('notes'), prompts: reader('prompts'), scratch: node('scratch')?.querySelector<HTMLTextAreaElement>('textarea')?.value,
      checklist: [...(node('checklist')?.querySelectorAll<HTMLInputElement>('.plugin-check-item input') ?? [])].map(input => input.checked),
      host: document.querySelector<HTMLInputElement>('[data-widget-id="properties"] input[aria-label="Nome de exemplo"]')?.value,
      running: [...document.querySelectorAll('[data-plugin-widget="geppio.time-tracker:timer"] button')].some(button => button.textContent === 'Pausar') }
  })
}
async function lockProbe(controls: Locator[], end: 'cancel' | 'conclude', focusCommand = false) {
  const before = await data(), workers = page.workers(), beforeClock = await clock()
  const roots = page.locator('.widget-content,[data-plugin-widget]'), mounts = await roots.count()
  await roots.evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-lock-content-mount', 'retained')))
  if (focusCommand) {
    await field('scratch', 'Texto do rascunho').focus()
    // Host-command activation keeps focus in the body until the common boundary
    // applies inert. Negative content interactions below always use native input.
    await page.getByTestId('edit-layout').evaluate(node => (node as HTMLElement).click())
    await page.getByTestId('save-layout').waitFor()
    assert.equal(await page.getByTestId('save-layout').evaluate(node => node === document.activeElement), true)
    if (await page.locator('.widget-catalog-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.widget-catalog-toggle').click()
    await settle(page)
  } else await beginEdit(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-widget-catalog-open'), 'false', 'The transaction locks content even with its options closed')
  assert.ok(await page.locator('.widget-content').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => (node as HTMLElement).inert && getComputedStyle(node).pointerEvents === 'none')))
  await page.evaluate(() => { Reflect.get(window, 'lockedBodyEvents').length = 0 })
  for (const control of controls) {
    await control.evaluate(node => (node as HTMLElement).focus())
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.widget-content')), false, 'Inert content refuses focus')
    const box = await control.boundingBox(); assert.ok(box && box.width > 0 && box.height > 0)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.widget-content')), false)
    await page.keyboard.insertText('LOCKED PROBE')
    await page.keyboard.press('Control+V')
  }
  for (let i = 0; i < 30; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.widget-content')), false, 'Sequential focus skips all bodies') }
  await page.waitForFunction(previous => document.querySelector('[data-plugin-widget="geppio.time-tracker:timer"] p')?.textContent !== previous, beforeClock)
  assert.deepEqual(await data(), before); assert.deepEqual(page.workers(), workers)
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'lockedBodyEvents')), [])
  assert.equal(await page.locator('[data-lock-content-mount="retained"]').count(), mounts, 'The actual content roots stay mounted')
  assert.ok(await page.locator('[data-edit-mount-proof]').evaluateAll(nodes => nodes.every(node => node.getAttribute('data-edit-mount-proof') === node.getAttribute('data-model-id'))))
  if (end === 'cancel') { await page.getByTestId('cancel-layout').click(); await settle(page) } else await conclude()
  assert.equal(await page.locator('.widget-content[data-content-locked]').count(), 0); assert.deepEqual(page.workers(), workers)
  assert.equal(await page.locator('[data-lock-content-mount="retained"]').count(), mounts)
}
async function groupDrag(name: string) {
  await frame(name).locator('.group-source-handle').hover(); const start = await frame(name).locator('.group-source-handle').boundingBox(); assert.ok(start)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8)
  const target = frame('notes').locator('[data-group-target]'); await target.waitFor(); const box = await target.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 }); await page.mouse.up(); await settle(page)
}
async function transferGroup(region: 'main' | 'sidebar' | 'bottom') {
  await group().hover({ position: { x: 15, y: 15 } }); const handle = group().locator('.widget-grip'); await handle.hover(); const from = await handle.boundingBox(), to = await page.locator(`[data-region="${region}"]`).boundingBox(); assert.ok(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); assert.equal(await handle.evaluate(node => node.hasPointerCapture(1)), true)
  await page.mouse.move(to.x + to.width - 70, to.y + to.height / 2, { steps: 16 })
  await page.locator('[data-group-transfer-going="3"][data-group-transfer-staying="0"][data-group-transfer-allowed="true"]').waitFor()
  await page.mouse.up(); await settle(page); assert.equal(await group().getAttribute('data-owner-region'), region)
}
async function probeGroup(region: 'main' | 'sidebar' | 'bottom') {
  const roots = page.locator('.widget-content,[data-plugin-widget]'), mounts = await roots.count()
  await roots.evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-lock-content-mount', 'retained')))
  await conclude(); const workers = page.workers()
  await beginEdit(page)
  for (const [name, title] of [['notes', 'Anotações'], ['checklist', 'Checklist'], ['prompts', 'Prompts salvos']] as const) {
    await group().getByRole('tab', { name: title, exact: true }).click(); await settle(page)
    const body = frame(name).locator('.widget-content'); assert.equal(await body.evaluate(node => (node as HTMLElement).inert), true)
    const control = region === 'bottom' && name !== 'checklist' ? widget(name).locator('select') : name === 'checklist' ? widget(name).locator('.plugin-check-item input') : field(name!, 'Título')
    const before = await data(), box = await control.boundingBox(); assert.ok(box)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await control.evaluate(node => (node as HTMLElement).focus()); await page.keyboard.insertText('BLOCKED TAB')
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.widget-content')), false); assert.deepEqual(await data(), before)
  }
  assert.deepEqual(page.workers(), workers)
  assert.equal(await page.locator('[data-lock-content-mount="retained"]').count(), mounts); assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'lockedBodyEvents')), [])
  // Header actions stay usable while member content remains locked.
  const left = group().getByRole('button', { name: 'Mover aba para a esquerda', exact: true })
  await (await left.isEnabled() ? left : group().getByRole('button', { name: 'Mover aba para a direita', exact: true })).click(); await settle(page)
}
try {
  await launch()
  const fixture = initialWorkbench(); fixture.placements = [{ id: 'properties', region: 'main', x: 0, y: 0, width: 360, height: 300, preferred: { width: 360, height: 300 } }]
  fixture.organization.bars[0]!.members = []; fixture.organization.bars[0]!.positions = {}
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: WORKBENCH_KEY, value: serializeWorkbench(fixture, widgetRegistry()) }); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click(); const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  for (const name of ['workspace-essentials', 'time-tracker']) {
    await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/' + name))
    await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click(); await manager.locator(`[data-plugin="geppio.${name}"]`).getByRole('switch').click()
    await page.waitForFunction(id => document.querySelector(`[data-plugin="${id}"]`)?.getAttribute('data-status') === 'active', 'geppio.' + name)
  }
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await page.getByTestId('edit-layout').click(); await settle(page)
  for (const [plugin, name, region] of [['workspace-essentials', 'notes', 'main'], ['workspace-essentials', 'scratch', 'main'], ['workspace-essentials', 'checklist', 'sidebar'], ['workspace-essentials', 'prompts', 'main'], ['time-tracker', 'timer', 'sidebar'], ['time-tracker', 'reports', 'bottom']]) await place(plugin!, name!, region!)
  await conclude()
  for (const [name, label, content] of [['notes', 'Nota', 'Anotação confirmada'], ['prompts', 'Prompt', 'Prompt literal <b>preservado</b>']]) {
    for (const suffix of ['A', 'B']) {
      const entries = await widget(name!).locator('.plugin-list-choice').count()
      await widget(name!).getByRole('button', { name: name === 'notes' ? 'Nova anotação' : 'Novo prompt', exact: true }).click()
      await page.waitForFunction(({ name, entries }) => { const node = document.querySelector(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`); return node?.querySelectorAll('.plugin-list-choice').length === entries + 1 && node.querySelector<HTMLInputElement>('input[aria-label="Título"]')?.value === (name === 'notes' ? 'Sem título' : 'Novo prompt') }, { name, entries })
      await fill(name!, 'Título', `${label} ${suffix}`); await fill(name!, name === 'notes' ? 'Texto da anotação' : 'Texto do prompt', suffix === 'A' ? content! : 'Registro alternativo')
    }
    await widget(name!).getByRole('button', { name: `${label} A`, exact: true }).click(); await saved(name!)
    await page.waitForFunction(({ name, content }) => document.querySelector<HTMLTextAreaElement>(`[data-plugin-widget="geppio.workspace-essentials:${name}"] textarea`)?.value === content, { name, content })
  }
  await fill('scratch', 'Texto do rascunho', 'Texto normal confirmado')
  await fill('checklist', 'Novo item', 'Item preservado'); await widget('checklist').getByRole('button', { name: 'Adicionar item', exact: true }).click(); await saved('checklist')
  await toggle(true)
  await beginEdit(page); await move('prompts', 'bottom'); await conclude()
  await host().fill('Modelo normal preservado'); await timer().getByRole('button', { name: 'Iniciar', exact: true }).click(); await timer().getByRole('button', { name: 'Pausar', exact: true }).waitFor()
  await page.locator('.widget-frame').evaluateAll(nodes => nodes.forEach(node => node.setAttribute('data-edit-mount-proof', node.getAttribute('data-model-id')!)))
  await page.evaluate(() => {
    const events: string[] = []; Reflect.set(window, 'lockedBodyEvents', events)
    for (const type of ['click', 'beforeinput', 'input', 'change', 'paste', 'keydown']) document.addEventListener(type, event => {
      if (event.isTrusted && document.querySelector('.workbench')?.hasAttribute('data-layout-editing') && (event.target as Element).closest('.widget-content')) events.push(type)
    }, true)
  })
  // A draft accepted in normal use is allowed to finish saving after Edit starts.
  await field('scratch', 'Texto do rascunho').fill('Rascunho normal pendente preservado')
  await lockProbe([host(), field('scratch', 'Texto do rascunho'), widget('notes').getByRole('button', { name: 'Nota B', exact: true, includeHidden: true }), widget('checklist').locator('.plugin-check-item input'), widget('prompts').locator('select'), timer().getByRole('button', { name: 'Pausar', exact: true, includeHidden: true })], 'cancel', true)
  await saved('scratch'); assert.equal(await field('scratch', 'Texto do rascunho').inputValue(), 'Rascunho normal pendente preservado')
  await toggle(false); await toggle(true)
  await lockProbe([host(), widget('prompts').locator('select')], 'conclude')
  await widget('prompts').getByRole('combobox').selectOption({ label: 'Prompt B' }); await widget('prompts').getByText('Registro alternativo', { exact: true }).waitFor(); await widget('prompts').getByRole('combobox').selectOption({ label: 'Prompt A' }); await widget('prompts').getByText('Prompt literal <b>preservado</b>', { exact: true }).waitFor()
  await beginEdit(page); await frame('scratch').hover({ position: { x: 15, y: 15 } }); await frame('scratch').locator('.layout-widget-remove').click(); await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await settle(page)
  await move('checklist', 'main'); await move('prompts', 'main'); await groupDrag('checklist'); await groupDrag('prompts'); assert.equal(await group().getByRole('tab').count(), 3)
  // Combined mouse flow: alignment outside the grouping target, then maximize,
  // regional transfer/detachment and locked bodies with working tab controls.
  const anchor = await page.locator('[data-widget-id="properties"]').boundingBox(), grouped = await group().boundingBox(); assert.ok(anchor && grouped)
  await group().hover({ position: { x: 15, y: 15 } }); const grip = group().locator('.widget-grip'), gripBox = await grip.boundingBox(); assert.ok(gripBox)
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2); await page.mouse.down()
  await page.mouse.move(gripBox.x + gripBox.width / 2 + anchor.x + anchor.width + 10 - grouped.x, gripBox.y + gripBox.height / 2 + anchor.y + anchor.height + 10 - grouped.y, { steps: 14 })
  await page.locator('[data-alignment-kind="spacing"]').first().waitFor(); await page.mouse.up(); await settle(page)
  await probeGroup('main'); await conclude()
  await page.getByRole('button', { name: 'Maximizar Grupo de widgets', exact: true }).click(); await group().getByRole('tab', { name: 'Anotações', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await settle(page)
  await page.getByRole('button', { name: 'Restaurar Grupo de widgets', exact: true }).click(); await settle(page)
  await beginEdit(page); await transferGroup('sidebar'); await probeGroup('sidebar'); await transferGroup('bottom'); await probeGroup('bottom')
  await group().getByRole('tab', { name: 'Checklist', exact: true }).click(); await group().getByRole('button', { name: 'Separar aba Checklist', exact: true }).click(); await settle(page); await move('checklist', 'sidebar'); await conclude()
  assert.equal(await frame('checklist').getAttribute('data-owner-region'), 'sidebar'); assert.equal(await group().getByRole('tab').count(), 2)
  await timer().getByRole('button', { name: 'Pausar', exact: true }).click(); await timer().getByRole('button', { name: 'Iniciar', exact: true }).waitFor()
  await page.locator('[data-plugin-widget="geppio.time-tracker:reports"]').getByText(/1 sessões/).waitFor()
  await page.screenshot({ path: diagnostics + '/combined.png' }); const persisted = await page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
  await app!.close(); app = undefined; await launch(); assert.equal(await page.evaluate(() => localStorage.getItem('geppio:workbench:v1')), persisted)
  await group().getByRole('tab', { name: 'Anotações', exact: true }).click(); await widget('notes').getByText('Anotação confirmada', { exact: true }).waitFor()
  await group().getByRole('tab', { name: 'Prompts salvos', exact: true }).click(); await widget('prompts').getByText('Prompt literal <b>preservado</b>', { exact: true }).waitFor()
  assert.equal(await widget('checklist').getByRole('checkbox', { name: 'Item preservado', exact: true }).isChecked(), true); assert.deepEqual(errors, [])
  console.log('PASS Edit lock: native mouse/keyboard/Tab/paste focus exclusion, Main/Sidebar/compact Bottom/host/group bodies, closed options, pending normal save, background timer, Conclude/Cancel unlock, stable mounts/Workers; combined align/group/maximize/restore/regional detach/save/restart walkthrough')
} catch (error) { if (app) { console.error('Edit lock feedback', await page.locator('.workspace-feedback').allTextContents()); await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}) }; throw error }
finally { await app?.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); await rm(profile, { recursive: true, force: true }) }
