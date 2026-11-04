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
const directory = `.local/diagnostics/presentations-alpha17-${process.argv.includes('--scale125') ? '1.25' : '1'}`
await mkdir(directory, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let application: ElectronApplication | undefined
let page!: Page
const errors: string[] = [], evidence: unknown[] = []
async function launch(width = 2000, height = 1200) {
  application = await electron.launch({ args: ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(size.width, size.height); window.show(); window.focus() }, { width, height })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await page.bringToFront(); await settle(page)
}
async function restart(width = 2000, height = 1200) { await application!.close(); application = undefined; await launch(width, height) }
const frame = () => page.locator('[data-widget-id="properties"]')
const mode = () => page.getByLabel('Apresentação de Propriedades', { exact: true })
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
const stored = async () => JSON.parse((await raw())!) as { layout: unknown; organization: { presentations: { entries: { presentation: string; open: boolean; preferred: { height: number } }[] }; chrome: unknown } }
async function select(value: string) { await mode().selectOption(value); await settle(page); await page.waitForFunction(() => !document.querySelector('[data-testid="presentation-controls"] select:disabled')) }
async function toggle(open: boolean) { await page.getByRole('button', { name: open ? 'Abrir painel' : 'Recolher painel', exact: true }).click(); await settle(page) }
async function bounds() {
  return page.evaluate(() => {
    const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    return { panel: rect('[data-widget-id="properties"]'), main: rect('[data-region="main"]'), bottom: rect('[data-region="bottom"]'), port: rect('[data-surface="main"]'),
      reservation: Number(document.querySelector('[data-region="main"]')!.getAttribute('data-panel-reservation')), adapted: document.querySelector('[data-region="main"]')!.getAttribute('data-panel-adapted'), dpr: devicePixelRatio }
  })
}
async function assertPanel() {
  const geometry = await bounds()
  assert.ok(geometry.panel.x >= geometry.main.x && geometry.panel.right <= geometry.main.right + .1, JSON.stringify(geometry))
  assert.ok(geometry.panel.y >= geometry.main.y && geometry.panel.bottom <= geometry.main.bottom + .1 && geometry.panel.bottom <= geometry.bottom.y)
  if (await frame().getAttribute('data-presentation') === 'docked') assert.ok(geometry.port.bottom + 8 <= geometry.panel.y, JSON.stringify(geometry))
  assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true')
  return geometry
}
try {
  await launch()
  await toggle(false); await toggle(true)
  const layout = (await stored()).layout, chrome = (await stored()).organization.chrome
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) { await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); await settle(page) }
    for (const presentation of ['normal', 'overlay', 'docked']) {
      const beforeSwitch = frame().locator('input[aria-label="Nome de exemplo"]')
      await beforeSwitch.fill('switch identity'); await beforeSwitch.evaluate(node => { node.dataset.switchProof = 'same' })
      await select(presentation)
      const input = frame().locator('input[aria-label="Nome de exemplo"]')
      assert.equal(await input.getAttribute('data-switch-proof'), 'same'); assert.equal(await input.inputValue(), 'switch identity')
      await input.fill(`content-${theme}-${presentation}`); await input.evaluate(node => { node.dataset.identityProof = 'same' })
      if (presentation !== 'normal') {
        await page.getByLabel('Altura preferida do painel', { exact: true }).selectOption('340'); await settle(page)
        evidence.push({ theme, presentation, open: true, geometry: await assertPanel() })
      }
      assert.deepEqual((await stored()).layout, layout); assert.deepEqual((await stored()).organization.chrome, chrome)
      await toggle(false)
      assert.equal(await frame().getAttribute('data-panel-open'), 'false')
      assert.equal(await input.getAttribute('data-identity-proof'), 'same')
      assert.equal(await input.inputValue(), `content-${theme}-${presentation}`)
      await restart()
      assert.equal(await mode().inputValue(), presentation); assert.equal(await frame().getAttribute('data-panel-open'), 'false')
      assert.equal((await stored()).organization.presentations.entries[0]!.open, false)
      await toggle(true); await restart()
      assert.equal(await mode().inputValue(), presentation); assert.equal(await frame().getAttribute('data-panel-open'), 'true')
      if (presentation !== 'normal') { assert.equal(Number(await frame().getAttribute('data-h')), 340); await assertPanel() }
      assert.deepEqual((await stored()).layout, layout)
      evidence.push({ theme, presentation, realRestarts: ['collapsed', 'open'], geometry: await bounds() })
      await page.screenshot({ path: `${directory}/${theme}-${presentation}.png` })
    }
  }
  // Pure viewport adaptation has zero storage calls, including on restart in a small window.
  await select('docked'); await page.getByLabel('Altura preferida do painel', { exact: true }).selectOption('420'); await settle(page)
  const preferred = await raw()
  await frame().locator('input[aria-label="Nome de exemplo"]').focus()
  await page.evaluate(() => {
    const target = window as unknown as { presentationWrites: number }; target.presentationWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) { if (key === 'geppio:workbench:v1') target.presentationWrites++; original.call(this, key, value) }
  })
  for (const [width, height] of [[2000, 960], [1000, 720], [2000, 1200]]) {
    await application!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width!, size.height!), { width, height }); await settle(page)
    const effective = await bounds(); evidence.push({ resize: [width, height], effective })
    await page.screenshot({ path: `${directory}/resize-${width}-${height}.png` })
    assert.equal(await raw(), preferred)
    assert.equal(await page.evaluate(() => (window as unknown as { presentationWrites: number }).presentationWrites), 0)
    if (width === 1000) {
      assert.equal(effective.adapted, 'true'); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(effective.reservation, 0)
      await page.locator('.workspace-feedback').filter({ hasText: 'Painel recolhido temporariamente' }).waitFor()
      assert.equal(await page.locator('[aria-controls="properties-presentation"]').getAttribute('aria-expanded'), 'false')
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-controls')), 'properties-presentation')
    }
    else { assert.equal(await frame().getAttribute('data-panel-open'), 'true'); await assertPanel(); if (height === 1200) assert.equal(Number(await frame().getAttribute('data-h')), 420) }
  }
  await restart(1000, 720)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal((await stored()).organization.presentations.entries[0]!.open, true); assert.equal(await raw(), preferred)
  await restart(); assert.equal(Number(await frame().getAttribute('data-h')), 420)
  // Horizontal expansion has its own preference and real native scrollbar budget.
  await page.evaluate(key => localStorage.setItem(key, 'true'), EXPANSION_KEY); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 960)); await settle(page)
  assert.equal(await raw(), preferred); assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true')
  if (await frame().getAttribute('data-panel-open') === 'true') await assertPanel()
  else assert.equal(await page.getByTestId('layout-canvas').getAttribute('data-panel-adapted'), 'true')
  evidence.push({ horizontalExpansion: true, geometry: await bounds() })
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(2000, 1200)); await settle(page)
  assert.equal(Number(await frame().getAttribute('data-h')), 420); assert.equal(await raw(), preferred)
  await page.evaluate(key => localStorage.setItem(key, 'false'), EXPANSION_KEY); await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  // Edit intentions cancel/undo/redo/checkpoint without leaking unconfirmed choices.
  await page.getByTestId('edit-layout').click(); await settle(page)
  await select('overlay'); await toggle(false)
  assert.equal(await raw(), preferred)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'true')
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page)
  assert.equal(await frame().getAttribute('data-panel-open'), 'false')
  await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.equal(await mode().inputValue(), 'docked'); assert.equal(await frame().getAttribute('data-panel-open'), 'true'); assert.equal(await raw(), preferred)
  await page.getByTestId('edit-layout').click(); await settle(page); await select('overlay')
  await page.getByTestId('save-layout').click(); await settle(page)
  const checkpoint = await raw(); assert.notEqual(checkpoint, preferred)
  await select('normal'); await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.equal(await mode().inputValue(), 'overlay'); assert.equal(await raw(), checkpoint)
  await page.getByTestId('edit-layout').click(); await settle(page); await select('overlay')
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal(await raw(), checkpoint); await restart(); assert.equal(await mode().inputValue(), 'overlay')
  await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle(false); await toggle(true)
  assert.equal(await frame().getAttribute('data-panel-open'), 'true'); await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Quota and stale normal-use commits refuse atomically, with visible feedback.
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as unknown as { restorePresentationStorage(): void }).restorePresentationStorage = () => { Storage.prototype.setItem = original }; Storage.prototype.setItem = function(key, value) { if (key === 'geppio:workbench:v1') throw new DOMException('Fixture quota', 'QuotaExceededError'); original.call(this, key, value) } })
  await mode().selectOption('docked'); await settle(page)
  assert.equal(await mode().inputValue(), 'overlay'); assert.equal(await raw(), checkpoint)
  await page.locator('[role="status"]').filter({ hasText: 'Não foi possível salvar' }).waitFor()
  await page.evaluate(() => (window as unknown as { restorePresentationStorage(): void }).restorePresentationStorage())
  await page.evaluate(key => { const raw = localStorage.getItem(key)!; localStorage.setItem(key, raw + ' ') }, WORKBENCH_KEY)
  const concurrent = await raw(); await mode().selectOption('docked'); await settle(page)
  assert.equal(await mode().inputValue(), 'overlay'); assert.equal(await raw(), concurrent)
  await page.locator('[role="status"]').filter({ hasText: 'mudou em outra sessão' }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(`${directory}/evidence.json`, JSON.stringify({ evidence, errors, physicalWindows125: 'not_observed' }, null, 2))
  console.log('Presentation smoke passed: real restarts, mouse collapse/reopen, identity, bounded adaptation, Edit checkpoints, quota/stale refusal, themes and canonical geometry.')
} catch (error) {
  if (page!) { await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {}); await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), evidence, errors }, null, 2)) }
  throw error
} finally {
  if (application) await application.close()
  assert.ok(profile.startsWith(join(tmpdir(), 'geppio-smoke-presentations-')))
  await rm(profile, { recursive: true, force: true })
}
