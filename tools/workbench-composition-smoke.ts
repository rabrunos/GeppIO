import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { initialWorkbench, WORKBENCH_KEY } from '../src/shared/workbench/model.ts'
import type { Composition, WorkbenchSnapshot } from '../src/shared/workbench/model.ts'
import { parseWorkbench } from '../src/shared/workbench/codec.ts'
import { widgetRegistry } from '../src/shared/workbench/model.ts'
import { settle } from './freeform-smoke.ts'
import { dropDriver, near } from './workbench-drop-smoke.ts'

/** Extends the corrections controller, using its disposable native window and
 * the same real-pointer/landing sampler as the approved Main regressions.
 */
export async function workbenchCompositionSmoke(page: Page, reset: (snapshot?: WorkbenchSnapshot, theme?: string) => Promise<void>, observations: unknown[]) {
  const { hold, sampleRelease } = dropDriver(page, observations)
  const stored = async () => parseWorkbench((await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY))!, widgetRegistry())
  const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const geometry = () => page.locator('[data-widget]').evaluateAll(nodes => nodes.map(node => {
    const p = (node as HTMLElement).dataset
    return { id: p.widget!, region: p.ownerRegion!, x: Number(p.x), y: Number(p.y), width: Number(p.w), height: Number(p.h) }
  }))
  const slots = () => page.locator('.host-format-slot[data-owner-region="bottom"]')
  async function edit() { await page.getByTestId('edit-layout').click(); await settle(page); await page.getByRole('tab', { name: 'Composições', exact: true }).click() }
  async function openSave() {
    await page.getByRole('button', { name: 'Salvar atual', exact: true }).click()
    const pending = page.getByRole('dialog', { name: 'Salvar a edição primeiro?', exact: true })
    if (await pending.count()) await pending.getByRole('button', { name: 'Salvar edição e continuar', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Salvar nova composição', exact: true }); await dialog.waitFor(); return dialog
  }
  async function save(name: string, main: boolean, bottom: boolean, width: boolean) {
    const dialog = await openSave()
    assert.equal(await dialog.getByRole('radio').count(), 0)
    await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill(name)
    for (const [label, checked] of [['Área principal', main], ['Barra inferior', bottom], ['Largura da barra lateral', width]] as const) {
      const input = dialog.getByRole('checkbox', { name: label, exact: true }); assert.equal(await input.isEnabled(), true); await input.setChecked(checked)
    }
    assert.equal(await dialog.locator('.thumbnail-sidebar').count() > 0, width)
    assert.equal(await dialog.locator('.thumbnail-bottom').count() > 0, bottom)
    const expected = (await geometry()).filter(p => p.region === 'main' ? main : p.region === 'bottom' && bottom)
    await dialog.getByRole('button', { name: 'Salvar composição', exact: true }).click(); await dialog.waitFor({ state: 'detached' })
    const item = (await stored()).organization.compositions.at(-1)!
    assert.deepEqual(item.placements.map(({ id, region, x, y, width, height }) => ({ id, region, x, y, width, height })).sort((a, b) => a.id.localeCompare(b.id)), expected.sort((a, b) => a.id.localeCompare(b.id)))
    return item
  }
  async function checkpoint() {
    await page.getByTestId('save-layout').click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="save-layout"]')?.hasAttribute('disabled'))
    await settle(page)
  }
  async function restore(item: Composition, action: 'format' | 'widgets') {
    await page.getByRole('tab', { name: 'Composições', exact: true }).click()
    await page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click()
    const card = page.locator(`[data-composition-id="${item.id}"]`); await card.hover()
    await card.getByRole('button', { name: `${action === 'format' ? 'Aplicar formato' : 'Restaurar widgets'} de ${item.name}`, exact: true }).last().click(); await settle(page)
  }
  for (const sidebar of [false, true]) for (const bottom of [false, true]) {
    const state = initialWorkbench(); state.organization.chrome.sidebar.visible = sidebar; state.organization.chrome.bottom.visible = bottom
    await reset(state); await edit()
    if (!sidebar && !bottom) {
      for (const label of ['Largura da Sidebar', 'Altura da Bottom']) {
        const divider = page.getByRole('separator', { name: label, exact: true }); await divider.press('End'); await divider.press('Tab'); await settle(page)
      }
    }
    const dialog = await openSave(), before = await raw()
    assert.equal(await dialog.getByRole('checkbox', { name: 'Área principal', exact: true }).isChecked(), true)
    for (const [label, checked] of [['Barra inferior', bottom], ['Largura da barra lateral', sidebar]] as const) {
      const input = dialog.getByRole('checkbox', { name: label, exact: true }); assert.equal(await input.isChecked(), checked); assert.equal(await input.isEnabled(), true); await input.check()
    }
    assert.equal(await raw(), before, 'Dialog choices cannot mutate the checkpoint or logical visibility')
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    const item = await save(`Visibilidade ${sidebar}/${bottom} Ω`, true, true, true), saved = await stored()
    assert.equal(item.mode, 'format-widgets'); assert.equal(item.placements.length, 5)
    assert.deepEqual(item.chrome, { sidebar: { size: !sidebar && !bottom ? 430 : 283 }, bottom: { size: !sidebar && !bottom ? 250 : 167 } })
    assert.equal(saved.organization.chrome.sidebar.visible, sidebar); assert.equal(saved.organization.chrome.bottom.visible, bottom)
    await page.getByTestId('cancel-layout').click(); await settle(page)
    assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), bottom ? 'docked' : 'hidden')
    assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), sidebar ? 'docked' : 'hidden')
    observations.push({ kind: 'save-visibility', sidebar, bottom, item })
  }
  // Omitted-region bytes survive both actions, the repeated-format clear,
  // checkpoint and Conclude, including logically collapsed unique presences.
  for (const scope of ['main', 'bottom', 'width'] as const) {
    const state = initialWorkbench(); state.organization.chrome.sidebar.visible = false; state.organization.chrome.bottom.visible = false
    await reset(state); await edit()
    const item = await save(`Scope ${scope}`, scope === 'main', scope === 'bottom', scope === 'width'), before = await stored()
    for (const action of ['widgets', 'format', 'format'] as const) {
      await restore(item, action); await checkpoint()
      const next = await stored()
      for (const region of ['main', 'bottom'] as const) if (region !== scope) {
        assert.deepEqual(next.placements.filter(p => p.region === region), before.placements.filter(p => p.region === region))
        assert.deepEqual(next.reference[region], before.reference[region])
      }
      if (scope !== 'bottom') assert.deepEqual(next.organization.chrome.bottom, before.organization.chrome.bottom)
      else assert.equal(next.organization.chrome.bottom.visible, true)
      assert.deepEqual(next.organization.bars, before.organization.bars); assert.equal(next.organization.chrome.sidebar.visible, false)
    }
    await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    assert.equal(await page.locator('.host-format-slot').count(), 0)
    observations.push({ kind: 'omitted-scope', scope, before, after: await stored() })
  }
  for (const theme of ['light', 'dark']) for (const height of [125, 250]) {
    const state = initialWorkbench(); state.organization.chrome.bottom = { visible: false, size: height }
    state.organization.chrome.sidebar.visible = height === 250
    state.reference.bottom.height = height - 20
    // Leave queue absent so its catalog drag is legal in Main and can reach an
    // incompatible Bottom slot, rather than rejecting a saturated card at pickup.
    state.placements = state.placements.filter(p => p.id !== 'queue').map(p => ['summary', 'chart'].includes(p.id) ? { ...p, region: 'bottom', x: p.id === 'summary' ? 0 : 776.5, y: 0, width: 766.5, height: height - 20, preferred: { width: 766.5, height: height - 20 } } : p)
    await reset(state, theme); await edit()
    const item = await save(`Bottom ${theme} ${height}`, false, true, false)
    assert.equal(item.placements.length, 2); assert.equal(item.chrome!.bottom!.size, height)
    // Alter the captured scene through an ordinary legal transfer first.
    await page.locator('[data-widget="summary"] .widget-content').evaluate(node => node.setAttribute('data-proof', 'bottom-live'))
    const main = (await page.locator('[data-surface="main"]').boundingBox())!
    await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: main.x + main.width * .7, y: main.y + main.height * .8 }); await sampleRelease('summary')
    assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'main')
    const outside = await geometry()
    await restore(item, 'widgets')
    assert.deepEqual(await geometry(), outside, 'Bottom-only Widgets must reject rather than steal unique Panorama from omitted Main')
    assert.ok((await page.locator('.workspace-feedback').textContent())!.includes('Composição incompatível'))
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
    await restore(item, 'widgets')
    const restored = (await geometry()).filter(p => p.region === 'bottom')
    for (const p of item.placements) near(restored.find(q => q.id === p.id)!, p)
    await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: main.x + main.width * .7, y: main.y + main.height * .8 }); await sampleRelease('summary')
    assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'main')
    await restore(item, 'format')
    assert.equal(await page.locator('[data-widget][data-owner-region="bottom"]').count(), 1, 'First Format after Widgets arranges current Bottom content')
    await restore(item, 'format')
    assert.equal(await slots().count(), 2)
    const original = await slots().evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-session-slot'), box: node.getBoundingClientRect().toJSON() })))
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click(); await settle(page)
    const first = slots().first(), firstBox = (await first.boundingBox())!, point = { x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 }
    const colors = (node: Element) => { const css = getComputedStyle(node); return [css.borderColor, css.color, css.backgroundColor] }
    await first.hover(); await settle(page); const normal = await first.evaluate(colors)
    const tile = page.locator('[data-catalog-type="host:chart"]')
    await hold(tile, point); assert.equal(await first.getAttribute('data-drag-hover'), ''); assert.deepEqual(await first.evaluate(colors), normal)
    await page.waitForFunction(() => {
      const zone = document.querySelector('.layout-edit-zone[data-over]')
      return zone && !zone.getAnimations().some(animation => animation.playState === 'running')
    })
    const regional = await page.locator('.layout-edit-zone[data-over]').evaluate(node => getComputedStyle(node).backgroundColor)
    assert.ok(Math.abs(Number(regional.match(/\/\s*([\d.]+)/)?.[1]) - .07) < .001, regional)
    await page.mouse.move(20, 80); await settle(page); assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0)
    await page.mouse.move(point.x, point.y); await settle(page); await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
    assert.equal(await slots().count(), 2); assert.equal(await page.locator('[data-drag-hover]').count(), 0)
    await hold(tile, point); await sampleRelease('chart'); near((await page.locator('[data-widget="chart"]').boundingBox())!, firstBox)
    assert.equal(await slots().count(), 1); assert.equal(await slots().first().getAttribute('data-session-slot'), original[1]!.id)
    near((await slots().first().boundingBox())!, original[1]!.box)
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.equal(await slots().count(), 2)
    await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await slots().count(), 1)
    const remaining = (await slots().first().boundingBox())!
    for (const type of ['host:chart', 'host:queue']) {
      const origin = (await page.locator('[data-widget="chart"]').boundingBox())!
      await hold(page.locator(`[data-catalog-type="${type}"]`), { x: remaining.x + remaining.width / 2, y: remaining.y + remaining.height / 2 })
      assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0, 'Duplicate/incompatible Bottom targets must not look acceptable')
      await page.mouse.up(); await settle(page)
      assert.equal(await slots().count(), 1); near((await page.locator('[data-widget="chart"]').boundingBox())!, origin)
      assert.equal(await page.locator('[data-widget][data-owner-region="bottom"]').count(), 1, 'Rejected Bottom slot cannot fall through to free placement')
    }
    await hold(page.locator('[data-catalog-type="host:summary"]'), { x: remaining.x + remaining.width / 2, y: remaining.y + remaining.height / 2 })
    // Catalog is allowed to move the one existing unique view; cancel retains it.
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
    if (height === 250) { await page.locator('.widget-catalog-toggle').click(); await settle(page) }
    const exact = (await slots().first().boundingBox())!, destination = { x: exact.x + exact.width / 2, y: exact.y + exact.height / 2 }
    if (height === 125) await page.emulateMedia({ reducedMotion: 'reduce' })
    await hold(page.locator('[data-widget="summary"] .widget-grip'), destination)
    assert.equal(await slots().first().getAttribute('data-drag-hover'), '')
    await sampleRelease('summary', height === 125); near((await page.locator('[data-widget="summary"]').boundingBox())!, exact)
    assert.equal(await page.locator('[data-widget="summary"] .widget-content').getAttribute('data-proof'), 'bottom-live')
    assert.equal(await slots().count(), 0)
    assert.equal(await page.locator('.workspace-feedback').filter({ hasText: 'Gesto cancelado' }).count(), 0)
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.equal(await slots().count(), 1)
    assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'main')
    await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await slots().count(), 0)
    await checkpoint(); await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    observations.push({ kind: 'bottom-sequence', theme, height, dock: height === 250 ? 'closed' : 'open', item, after: await stored() })
  }
  // An undersized Bottom target intercepts an otherwise legal regional drop.
  const small = initialWorkbench(); small.placements = small.placements.filter(p => p.id === 'summary'); small.organization.bars[0]!.members = []; small.organization.bars[0]!.positions = {}
  const id = 'composition:bottom-small'
  small.organization.compositions.push({ id, name: 'Bottom small', system: false, scopes: ['bottom'], mode: 'format', reference: small.reference, placements: [], views: [], format: [{ id: 'small', region: 'bottom', x: 0, y: 0, width: 100, height: 147 }] })
  await reset(small); await edit(); await page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click()
  await page.locator(`[data-composition-id="${id}"] [data-composition-reorder]`).click(); await settle(page)
  const smallBox = (await slots().first().boundingBox())!, origin = (await page.locator('[data-widget="summary"]').boundingBox())!
  await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: smallBox.x + 50, y: smallBox.y + 50 })
  assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0)
  await page.mouse.up(); await settle(page); assert.equal(await slots().count(), 1); near((await page.locator('[data-widget="summary"]').boundingBox())!, origin)
  // Ordinary free Bottom space still uses engine placement, leaving the small reservation.
  const surface = (await page.locator('[data-surface="bottom"]').boundingBox())!
  await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: surface.x + surface.width * .7, y: surface.y + surface.height / 2 }); await sampleRelease('summary')
  assert.equal(await slots().count(), 1); assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'bottom')
  await reset()
  await page.evaluate(() => localStorage.setItem('geppio.locale', 'en')); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.getByRole('tab', { name: 'Compositions', exact: true }).click()
  await page.locator('.layout-menu-footer .ui-button-primary').click()
  const pending = page.getByRole('dialog', { name: 'Save your edits first?', exact: true })
  if (await pending.count()) await pending.getByRole('button', { name: 'Save edits and continue', exact: true }).click()
  const english = page.getByRole('dialog', { name: 'Save new composition', exact: true }); await english.waitFor()
  assert.equal(await english.getByRole('radio').count(), 0)
  await english.getByText('Keep the format and widgets of the selected areas.', { exact: true }).waitFor()
  await english.getByRole('textbox', { name: 'Name', exact: true }).fill('Formato literal Ω')
  await english.getByRole('button', { name: 'Save composition', exact: true }).click(); await english.waitFor({ state: 'detached' })
  assert.equal((await stored()).organization.compositions.at(-1)!.name, 'Formato literal Ω')
  await writeFile(`.local/diagnostics/compositions-alpha14/observations-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(observations, null, 2))
  console.log('PASS alpha14 compositions: four logical visibility combinations, opt-in/latest sizes, explicit save scope, omitted-region restoration/checkpoints and native Bottom multi-slot catalog/existing fills in both themes/panel limits/reduced motion')
}
