import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import { EXPANSION_KEY } from '../src/shared/freeform/policy.ts'
import { settle, portugueseFixture } from './freeform-smoke.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-presentations-'))
const directory = `.local/diagnostics/presentations-alpha18-${process.argv.includes('--scale125') ? '1.25' : '1'}`
await mkdir(directory, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let application: ElectronApplication | undefined
let page!: Page
const errors: string[] = [], evidence: unknown[] = []
const frame = () => page.locator('[data-widget-id="properties"]')
const selector = () => page.getByRole('button', { name: 'Apresentação de Propriedades', exact: true })
const edge = () => page.getByRole('separator', { name: 'Altura de Propriedades', exact: true })
const input = () => frame().locator('input[aria-label="Nome de exemplo"]')
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
const stored = async () => JSON.parse((await raw())!) as { schemaVersion: number; layout: unknown; organization: { presentations?: { entries: { presentation: string; open: boolean; preferred: { height: number } }[] }; chrome: unknown } }
const selected = () => frame().getAttribute('data-presentation')
async function launch(width = 2000, height = 1200) {
  application = await electron.launch({ args: ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(size.width, size.height); window.show(); window.focus() }, { width, height })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await page.bringToFront(); await settle(page)
}
async function restart(width = 2000, height = 1200) { await application!.close(); application = undefined; await launch(width, height) }
async function resize(width: number, height: number) {
  await application!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height }); await settle(page)
}
async function begin() { if (await page.getByTestId('edit-layout').count()) { await page.getByTestId('edit-layout').click(); await settle(page) } }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function reveal() {
  await frame().hover(); await page.waitForTimeout(150); await settle(page)
  await frame().hover(); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'true')
}
async function select(value: 'normal' | 'docked' | 'overlay', persist = true) {
  await begin()
  if (await selected() === 'overlay') await reveal()
  if (await selected() === 'docked' && await frame().getAttribute('data-panel-open') === 'false') { await edge().click(); await settle(page) }
  await frame().hover(); await selector().click()
  const current = await selected(), labels = { normal: 'Normal', docked: 'Encaixado', overlay: 'Flutuante' }
  assert.equal(await selector().innerText(), labels[current as keyof typeof labels])
  const popup = await page.getByRole('menu', { name: 'Apresentação de Propriedades', exact: true }).boundingBox(); assert.ok(popup)
  assert.ok(popup.width <= 150 && popup.height <= 100, 'Compact presentation menu')
  assert.equal(await page.getByRole('menuitemradio', { name: labels[current as keyof typeof labels], exact: true }).getAttribute('aria-checked'), 'true')
  // Move through the actual gap into the native top-layer popup.
  const option = page.getByRole('menuitemradio', { name: labels[value], exact: true })
  await option.hover(); await page.waitForTimeout(400)
  await page.screenshot({ path: `${directory}/menu-${await page.locator('.workbench').getAttribute('data-theme')}-${current}.png` })
  if (current === 'overlay') assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await option.click(); await settle(page)
  if (persist) await conclude()
  assert.equal(await selected(), value)
}
async function dockToggle() { await edge().click(); await settle(page) }
async function height(value: number, cancel?: 'escape' | 'pointercancel' | 'lostcapture') {
  const box = await edge().boundingBox(); assert.ok(box)
  const before = await raw(), now = Number(await frame().getAttribute('data-h'))
  if (!cancel && Math.abs(now - value) < 1) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + now - value, { steps: 12 })
  assert.equal(await raw(), before, 'No resize preview writes')
  if (cancel === 'escape') await page.keyboard.press('Escape')
  if (cancel === 'pointercancel') await edge().dispatchEvent('pointercancel', { pointerId: 1 })
  if (cancel === 'lostcapture') await edge().evaluate(node => { if (node.hasPointerCapture(1)) node.releasePointerCapture(1) })
  await page.mouse.up(); await settle(page)
  if (cancel) assert.equal(await raw(), before, 'Canceled gestures preserve saved bytes')
  else assert.ok(Math.abs(Number(await frame().getAttribute('data-h')) - value) < 1)
}
async function bounds() {
  return page.evaluate(() => {
    const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    return { panel: rect('[data-widget-id="properties"]'), main: rect('[data-region="main"]'), bottom: rect('[data-region="bottom"]'), port: rect('[data-surface="main"]'),
      reservation: Number(document.querySelector('[data-region="main"]')!.getAttribute('data-panel-reservation')), adapted: document.querySelector('[data-region="main"]')!.getAttribute('data-panel-adapted'), dpr: devicePixelRatio }
  })
}
async function assertPanel() {
  const g = await bounds()
  assert.ok(g.panel.x >= g.main.x && g.panel.right <= g.main.right + .1, JSON.stringify(g))
  if (await selected() !== 'normal') assert.ok(Math.abs(g.panel.width - g.port.width) < 1, 'Both panel modes follow full usable Main width')
  assert.ok(g.panel.y >= g.main.y && g.panel.bottom <= g.main.bottom + .1 && g.panel.bottom <= g.bottom.y)
  if (await selected() === 'docked') assert.ok(g.port.bottom + 8 <= g.panel.y, JSON.stringify(g))
  assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true')
  return g
}
async function seedLegacy(presentation: string, open: boolean, version = 2) {
  await page.evaluate(({ key, presentation, open, version }) => {
    const document = JSON.parse(localStorage.getItem(key)!)
    document.schemaVersion = version
    if (version === 1) delete document.organization.presentations
    else document.organization.presentations = { version: 1, entries: [{ viewId: 'properties', typeId: 'host:properties', modelId: 'model:host:properties', owner: 'host', anchor: 'bottom', presentation, open, preferred: { width: 720, height: 340 } }] }
    localStorage.setItem(key, JSON.stringify(document))
  }, { key: WORKBENCH_KEY, presentation, open, version })
  const before = await raw(); await restart(); assert.equal(await raw(), before)
}
try {
  await launch(); assert.equal(await selected(), 'normal')
  assert.equal(await selector().count(), 0)
  assert.equal(await page.locator('.widget-presentations').count(), 0)
  await begin()
  assert.equal(await page.locator('[data-widget-id="queue"] .widget-presentation-control').count(), 0)
  await frame().hover()
  const alignment = await frame().evaluate(node => {
    const a = node.querySelector('.widget-presentation-control')!.getBoundingClientRect(), b = node.querySelector('.layout-widget-remove')!.getBoundingClientRect()
    return { a: { y: a.y, width: a.width, height: a.height, right: a.right }, b: { y: b.y, width: b.width, height: b.height, x: b.x } }
  })
  assert.ok(Math.abs(alignment.a.height - alignment.b.height) < .1); assert.ok(Math.abs(alignment.a.y - alignment.b.y) < .1); assert.ok(Math.abs(alignment.b.x - alignment.a.right - 4) < .1)
  await conclude()
  // Both themes: same content tree, popup reachability and independent Bottom.
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) { await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); await settle(page) }
    await select('normal')
    await input().fill('identity-' + theme); await input().evaluate(node => { node.dataset.identityProof = 'same' })
    const initial = await bounds()
    await select('overlay'); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
    await page.screenshot({ path: `${directory}/${theme}-overlay-collapsed.png` })
    const hoverBytes = await raw(), base = await stored(); await reveal()
    assert.equal(await input().getAttribute('data-identity-proof'), 'same'); assert.equal(await input().inputValue(), 'identity-' + theme)
    assert.equal((await bounds()).reservation, 0); assert.deepEqual((await bounds()).port, initial.port); assert.deepEqual((await bounds()).bottom, initial.bottom)
    await assertPanel()
    await input().focus(); await page.mouse.move(10, 10); await page.waitForTimeout(600)
    assert.equal(await frame().getAttribute('data-panel-open'), 'true', 'Sidebar-style focus retention')
    await page.getByRole('button', { name: 'Alternar tema', exact: true }).focus(); await page.waitForTimeout(650)
    assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), hoverBytes)
    await restart(); assert.equal(await selected(), 'overlay'); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
    await reveal(); assert.equal(await raw(), hoverBytes)
    await begin(); const undoBeforeHover = await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled()
    await reveal(); assert.equal(await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled(), undoBeforeHover)
    await page.screenshot({ path: `${directory}/${theme}-overlay-edit.png` })
    await select('normal', false); await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await selected(), 'overlay')
    await select('docked'); await height(340)
    const docked = await stored(); assert.deepEqual(docked.layout, base.layout); assert.deepEqual(docked.organization.chrome, base.organization.chrome)
    await assertPanel(); await height(380, 'escape'); await height(380, 'pointercancel'); await height(380, 'lostcapture')
    // Real Bottom's handle still collapses independently and preserves panel intent.
    const bottom = page.getByRole('separator', { name: 'Altura da Bottom', exact: true })
    await bottom.click(); await settle(page); assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), 'hidden')
    assert.equal(await frame().getAttribute('data-panel-open'), 'true'); await bottom.click(); await settle(page)
    await input().evaluate(node => { node.dataset.collapseProof = 'mounted' })
    await dockToggle(); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal((await bounds()).reservation, 40)
    await page.screenshot({ path: `${directory}/${theme}-docked-collapsed.png` })
    assert.equal(await input().getAttribute('data-collapse-proof'), 'mounted'); assert.equal(Number(await frame().getAttribute('data-h')), 31); assert.ok(await frame().locator('.widget-heading').isVisible())
    await restart(); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal((await stored()).organization.presentations!.entries[0]!.open, false)
    await dockToggle(); assert.equal(Number(await frame().getAttribute('data-h')), 340)
    await restart(); assert.equal(await selected(), 'docked'); assert.equal(Number(await frame().getAttribute('data-h')), 340)
    await begin(); await frame().hover(); await page.waitForTimeout(180); await page.screenshot({ path: `${directory}/${theme}-docked-edit.png` }); await conclude()
    evidence.push({ theme, alignment, geometry: await assertPanel(), restarts: ['floating hidden', 'docked collapsed', 'docked open'] })
  }
  await height(420)
  const preferred = await raw()
  await input().focus()
  await page.evaluate(() => {
    const target = window as unknown as { presentationWrites: number }; target.presentationWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) { if (key === 'geppio:workbench:v1') target.presentationWrites++; original.call(this, key, value) }
  })
  for (const [width, h] of [[2000, 960], [1000, 720], [2000, 1200]]) {
    await resize(width!, h!); const effective = await bounds(); evidence.push({ resize: [width, h], effective })
    assert.equal(await raw(), preferred); assert.equal(await page.evaluate(() => (window as unknown as { presentationWrites: number }).presentationWrites), 0)
    if (width === 1000) {
      assert.equal(effective.adapted, 'true'); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(effective.reservation, 40)
      assert.equal(await edge().getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-controls')), 'properties-presentation')
    } else { await assertPanel(); if (h === 1200) assert.equal(Number(await frame().getAttribute('data-h')), 420) }
  }
  await restart(1000, 720); assert.equal(await raw(), preferred); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  await begin(); await frame().hover(); await selector().click(); await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click(); await settle(page)
  assert.equal(await selected(), 'normal'); await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), preferred)
  await restart(); assert.equal(Number(await frame().getAttribute('data-h')), 420)
  await dockToggle(); const closed = await raw(); await resize(1000, 720); await resize(2000, 1200)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), closed); await dockToggle()
  // Existing expansion/scrollbar fit remains pure at fractional DPR.
  await page.evaluate(key => localStorage.setItem(key, 'true'), EXPANSION_KEY); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await resize(1000, 960)
  assert.equal(await raw(), preferred); assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true')
  if (await frame().getAttribute('data-panel-open') === 'true') await assertPanel()
  await resize(2000, 1200); assert.equal(Number(await frame().getAttribute('data-h')), 420)
  await page.evaluate(key => localStorage.setItem(key, 'false'), EXPANSION_KEY); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  // Save advances the Cancel checkpoint; Conclude exits; draft mode changes never write.
  await select('overlay', false); assert.equal(await raw(), preferred)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.equal(await selected(), 'docked')
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await selected(), 'overlay')
  await page.getByTestId('save-layout').click(); await settle(page); const checkpoint = await raw(); assert.notEqual(checkpoint, preferred)
  await select('normal', false); await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await selected(), 'overlay'); assert.equal(await raw(), checkpoint)
  await begin(); await conclude(); await restart(); assert.equal(await selected(), 'overlay'); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  await page.emulateMedia({ reducedMotion: 'reduce' }); await reveal(); await page.mouse.move(10, 10); await page.waitForTimeout(400)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false'); await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Alpha.17 closed Normal/Overlay entries and alpha.16 v1 stay readable without read-time writes.
  await seedLegacy('normal', false); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await seedLegacy('overlay', false); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); await reveal()
  await begin(); const beforeTiny = await raw()
  await page.locator('.work-area').evaluate(node => { node.style.maxHeight = '200px' }); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), beforeTiny)
  await frame().hover(); await selector().click(); await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click(); await settle(page); assert.equal(await selected(), 'normal')
  await page.locator('.work-area').evaluate(node => { node.style.maxHeight = '' }); await page.getByTestId('cancel-layout').click(); await settle(page)
  await select('normal'); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await seedLegacy('normal', true, 1); assert.equal(await selected(), 'normal'); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  // The same local menu follows the existing English locale route.
  const beforeLocale = await raw()
  await page.evaluate(() => localStorage.setItem('geppio.locale', 'en')); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  await begin(); await frame().hover(); await page.getByRole('button', { name: 'Properties presentation', exact: true }).click()
  for (const name of ['Normal', 'Docked', 'Floating']) assert.equal(await page.getByRole('menuitemradio', { name, exact: true }).count(), 1)
  await page.keyboard.press('Escape'); await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), beforeLocale)
  await page.evaluate(() => localStorage.setItem('geppio.locale', 'pt-BR')); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  // Existing guarded Save refuses quota/CAS writes without replacing the saved bytes.
  await select('docked'); const safe = await raw()
  await begin(); await select('overlay', false)
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as unknown as { restorePresentationStorage(): void }).restorePresentationStorage = () => { Storage.prototype.setItem = original }; Storage.prototype.setItem = function(key, value) { if (key === 'geppio:workbench:v1') throw new DOMException('Fixture quota', 'QuotaExceededError'); original.call(this, key, value) } })
  await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), safe)
  await page.locator('[role="status"]').filter({ hasText: 'Não foi possível salvar' }).waitFor()
  await page.evaluate(() => (window as unknown as { restorePresentationStorage(): void }).restorePresentationStorage())
  await page.getByTestId('cancel-layout').click(); await settle(page)
  await begin(); await select('overlay', false)
  await page.evaluate(key => localStorage.setItem(key, localStorage.getItem(key)! + ' '), WORKBENCH_KEY)
  const concurrent = await raw(); await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), concurrent)
  await page.locator('[role="status"]').filter({ hasText: 'mudou em outra sessão' }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(`${directory}/evidence.json`, JSON.stringify({ evidence, errors, physicalWindows125: 'not_observed' }, null, 2))
  console.log('Presentation smoke passed: local Edit selector, mouse click/drag/cancel, floating hover/menu, real restarts, compatibility, pure adaptation, checkpoints and guarded writes in both themes.')
} catch (error) {
  if (page!) { await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {}); await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), evidence, errors }, null, 2)) }
  throw error
} finally {
  if (application) await application.close()
  assert.ok(profile.startsWith(join(tmpdir(), 'geppio-smoke-presentations-')))
  await rm(profile, { recursive: true, force: true })
}
