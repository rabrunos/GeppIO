import assert from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { initialWorkbench } from '../tests/fixtures/workbench.ts'
import type { WorkbenchSnapshot } from '../tests/fixtures/workbench.ts'
import type { Region } from '../src/shared/freeform/types.ts'
import { settle } from './freeform-smoke.ts'

type Box = { x: number; y: number; width: number; height: number }
type Sample = { time: number; image: Box | null; live: Box | null; opacity: string; animations: number; scale: number[]; target: Box | null; duration: number | string | null; easing: string | null; clip: string | null }
type Probe = Window & { dropSamples?: Sample[]; dropSampling?: boolean }
const keys = ['x', 'y', 'width', 'height'] as const
export function near(actual: Box, expected: Box, tolerance = .15) { for (const key of keys) assert.ok(Math.abs(actual[key] - expected[key]) < tolerance, `${key}: ${JSON.stringify({ actual, expected })}`) }

/** Uses the existing corrections launch/reset controller and disposable profile. */
export function dropDriver(page: Page, observations: unknown[]) {
  async function hold(source: Locator, to: { x: number; y: number }) {
    // Let Playwright wait for the real hit target to be visible/stable and scroll
    // it into view before reading coordinates. Never synthesize capture.
    if (await source.evaluate(node => node.classList.contains('widget-grip'))) await source.locator('..').hover({ position: { x: 40, y: 12 } })
    await source.hover()
    const box = await source.boundingBox(); assert.ok(box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    assert.ok(await source.evaluate(node => node.hasPointerCapture(1)), 'The actual native pointer must be captured')
    await page.mouse.move(to.x, to.y, { steps: 8 }); await settle(page)
    assert.ok(await source.evaluate(node => node.hasPointerCapture(1)), 'Native capture must survive through the held destination before release')
  }
  async function sampleRelease(id: string, reduced = false) {
    await page.evaluate(id => {
      const host = window as Probe; host.dropSamples = []; host.dropSampling = true
      const started = performance.now()
      function sample() {
        const picture = document.querySelector<HTMLElement>('.drag-picture-flight'), live = document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(id)}"]`)
        const effect = picture?.getAnimations().map(animation => animation.effect as KeyframeEffect).find(effect => effect.getKeyframes().at(-1)?.transform), final = effect?.getKeyframes().at(-1), timing = effect?.getTiming()
        const matrix = picture ? new DOMMatrixReadOnly(getComputedStyle(picture).transform) : null
        const targetMatrix = final ? new DOMMatrixReadOnly(String(final.transform)) : null
        host.dropSamples!.push({ time: performance.now() - started, image: picture?.getBoundingClientRect().toJSON() ?? null, live: live?.getBoundingClientRect().toJSON() ?? null,
          opacity: live ? getComputedStyle(live).opacity : '', animations: live?.getAnimations().length ?? 0, scale: matrix ? [matrix.a, matrix.d] : [],
          target: final && targetMatrix ? { x: targetMatrix.e, y: targetMatrix.f, width: parseFloat(String(final.width)), height: parseFloat(String(final.height)) } : null,
          duration: typeof timing?.duration === 'number' ? timing.duration : timing ? String(timing.duration) : null, easing: timing?.easing ?? null,
          clip: (picture?.firstElementChild?.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes().at(-1)?.clipPath as string ?? null })
        if (performance.now() - started < 420) requestAnimationFrame(sample); else host.dropSampling = false
      }
      requestAnimationFrame(sample)
    }, id)
    await page.mouse.up(); await page.waitForFunction(() => !(window as Probe).dropSampling)
    const samples = await page.evaluate(() => (window as Probe).dropSamples!)
    await writeFile('.local/diagnostics/corrections-alpha13/latest-flight.json', JSON.stringify(samples, null, 2))
    const final = await page.locator(`[data-widget-id="${id}"]`).boundingBox(); assert.ok(final)
    const flying = samples.filter(sample => sample.image && sample.target)
    if (reduced) assert.equal(flying.length, 0, 'Reduced motion reveals final geometry without a flight')
    else {
      assert.ok(flying.length >= 3, `Measure actual start/intermediate/end geometry, not just the existence of an animation: ${JSON.stringify({ id, final, samples: samples.length, images: samples.filter(s => s.image).length })}`)
      for (const sample of flying) {
        near(sample.target!, final)
        near(sample.live!, final)
        assert.equal(sample.opacity, '0'); assert.equal(sample.animations, 0, 'The active live frame must not compete with its flight')
        assert.deepEqual(sample.scale, [1, 1], 'Text/icons must never acquire a nonuniform transform')
        assert.equal(sample.duration, 240); assert.equal(sample.easing, 'cubic-bezier(0.2, 0.8, 0.2, 1)')
      }
      near(flying.at(-1)!.image!, final, 1)
      const distance = (box: Box) => keys.reduce((sum, key) => sum + Math.abs(box[key] - final[key]), 0)
      for (let i = 1; i < flying.length; i++) assert.ok(distance(flying[i]!.image!) <= distance(flying[i - 1]!.image!) + .15, 'Position and size must converge without reversing or jumping at reveal')
      // Sampling starts before pointer-up. A dormant, display:none catalog view
      // can have opacity:1 and a zero rectangle before the transaction; only the
      // first visible frame after the measured flight is its reveal.
      const revealed = samples.find(sample => sample.time > flying.at(-1)!.time && !sample.image && sample.opacity === '1' && sample.live && sample.live.width > 0 && sample.live.height > 0)
      assert.ok(revealed); near(revealed.live!, final)
      assert.equal(flying.at(-1)!.clip, await page.locator(`[data-widget-id="${id}"]`).evaluate(node => getComputedStyle(node).clipPath))
    }
    assert.equal(await page.locator('[data-drag-hover]').count(), 0)
    observations.push({ kind: 'landing', id, reduced, samples, final })
    return final
  }
  return { hold, sampleRelease }
}
export async function workbenchDropSmoke(page: Page, reset: (snapshot?: WorkbenchSnapshot, theme?: string) => Promise<void>, observations: unknown[]) {
  const { hold, sampleRelease } = dropDriver(page, observations)
  async function edit(close = true) { await page.getByTestId('edit-layout').click(); await settle(page); if (close) { await page.locator('.widget-catalog-toggle').click(); await settle(page) } }
  const empty = () => {
    const state = initialWorkbench(); state.placements = state.placements.filter(p => p.id === 'summary')
    state.organization.bars[0]!.members = []; state.organization.bars[0]!.positions = {}
    state.organization.bars.push({ id: 'bar:drop', name: 'Drop review', userNamed: true, icon: 'widgets', archived: false, members: [], positions: {} })
    state.organization.activeBar = 'bar:drop'; return state
  }
  for (const theme of ['light', 'dark']) {
    await reset(empty(), theme); await edit()
    await page.locator('[data-widget="summary"]').evaluate(node => node.setAttribute('data-proof', 'live-view'))
    // Six legal directions use exactly the engine's chosen destination dimensions.
    for (const region of ['sidebar', 'bottom', 'main', 'bottom', 'sidebar', 'main'] as Region[]) {
      const target = await page.locator(`[data-surface="${region}"]`).boundingBox(); assert.ok(target)
      await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: target.x + Math.min(120, target.width / 2), y: target.y + Math.min(130, target.height / 2) })
      await sampleRelease('summary')
      assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), region)
      assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-proof'), 'live-view')
    }
    // A real scrolled custom bar exercises a partially clipped destination as well.
    const scrolled = empty(); scrolled.placements.push({ id: 'notes', region: 'sidebar', x: 0, y: 0, width: 253, height: 1100, preferred: { width: 253, height: 1100 } })
    scrolled.organization.bars[1]!.members = ['host:notes']; scrolled.organization.bars[1]!.positions = { 'host:notes': 0 }
    await reset(scrolled, theme); await edit()
    await page.locator('[data-region="sidebar"]').evaluate(node => { node.scrollTop = 220 })
    await settle(page)
    assert.ok(await page.locator('[data-region="sidebar"]').evaluate(node => node.scrollTop > 100))
    const sidebar = (await page.locator('[data-region="sidebar"]').boundingBox())!
    await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: sidebar.x + 100, y: sidebar.y + sidebar.height / 2 })
    await sampleRelease('summary')
    assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'sidebar')

    // Existing click-to-fill stays in the broader corrections smoke. Here no slot
    // is clicked or selected: hit-testing must work beneath native pointer capture.
    await reset(undefined, theme); await edit(false)
    await page.getByRole('tab', { name: 'Composições', exact: true }).click()
    const focus = page.locator('[data-composition-id="system:focus"] [data-composition-reorder]')
    await focus.click(); await settle(page); await focus.click(); await settle(page)
    await page.getByRole('tab', { name: 'Widgets', exact: true }).click(); await settle(page)
    const slots = page.locator('.host-format-slot'), first = slots.first(), last = slots.last()
    assert.equal(await slots.count(), 2)
    const selectedTab = await page.locator('.editor-panel-tab[aria-selected="true"]').textContent(), other = (await last.boundingBox())!, to = (await first.boundingBox())!
    const colors = (node: Element) => { const css = getComputedStyle(node); return [css.borderColor, css.color, css.backgroundColor] }
    await first.hover(); await settle(page); const normalHover = await first.evaluate(colors)
    const tile = page.locator('[data-catalog-type="host:notes"]'), point = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
    await hold(tile, point)
    assert.deepEqual(await first.evaluate(colors), normalHover)
    assert.equal(await first.getAttribute('data-drag-hover'), ''); assert.equal(await first.getAttribute('aria-pressed'), 'false')
    assert.equal(await page.locator('.editor-panel-tab[aria-selected="true"]').textContent(), selectedTab)
    const zone = page.locator('.layout-edit-zone[data-over]')
    assert.equal(await zone.count(), 1)
    await page.waitForFunction(() => {
      const node = document.querySelector('.layout-edit-zone[data-over]')
      return node && !node.getAnimations().some(animation => animation.playState === 'running')
    })
    const zoneColor = await zone.evaluate(node => getComputedStyle(node).backgroundColor)
    const alpha = Number(zoneColor.match(/\/\s*([\d.]+)/)?.[1])
    assert.ok(Math.abs(alpha - .07) < .001, `The stronger whole-region orange is retained over a reservation: ${zoneColor}`)
    await page.screenshot({ path: `.local/diagnostics/corrections-alpha13/drop-hover-${theme}-${await page.evaluate(() => devicePixelRatio)}.png` })
    await page.mouse.move(20, 80); await settle(page); assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0)
    await page.mouse.move(point.x, point.y); await settle(page)
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
    assert.equal(await slots.count(), 2); assert.equal(await page.locator('[data-drag-hover]').count(), 0)
    await hold(tile, point); await sampleRelease('host:notes:view:main')
    assert.equal(await slots.count(), 1); near((await page.locator('[data-widget="host:notes:view:main"]').boundingBox())!, to)
    near((await slots.first().boundingBox())!, other)
    assert.equal(await page.locator('[data-widget="notes"]').getAttribute('data-owner-region'), 'sidebar', 'Catalog insertion preserves the other-area view')
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
    assert.equal(await slots.count(), 2); assert.equal(await page.locator('[data-widget="host:notes:view:main"]').count(), 0)
    await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await slots.count(), 1)
    // The same type already in Main makes this existing Sidebar move invalid.
    const origin = (await page.locator('[data-widget="notes"]').boundingBox())!, remaining = (await slots.first().boundingBox())!
    await hold(page.locator('[data-widget="notes"] .widget-grip'), { x: remaining.x + remaining.width / 2, y: remaining.y + remaining.height / 2 })
    assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0)
    await page.mouse.up(); await settle(page)
    assert.equal(await slots.count(), 1); near((await page.locator('[data-widget="notes"]').boundingBox())!, origin)
    // Remove the Main presence, then an existing Sidebar view can fill exactly.
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
    const exact = (await slots.first().boundingBox())!
    await page.locator('[data-widget="notes"] .widget-content').evaluate(node => node.setAttribute('data-proof', 'same-content'))
    await hold(page.locator('[data-widget="notes"] .widget-grip'), { x: exact.x + exact.width / 2, y: exact.y + exact.height / 2 })
    assert.equal(await slots.first().getAttribute('data-drag-hover'), '')
    await sampleRelease('notes')
    near((await page.locator('[data-widget="notes"]').boundingBox())!, exact)
    assert.equal(await page.locator('[data-widget="notes"] .widget-content').getAttribute('data-proof'), 'same-content')
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
    assert.equal(await slots.count(), 2); assert.equal(await page.locator('[data-widget="notes"]').getAttribute('data-owner-region'), 'sidebar')
    await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await slots.count(), 1)
    await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await slots.count(), 1)
    await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); assert.equal(await slots.count(), 0)
    // Invalid reservations intercept release instead of falling through to the
    // otherwise legal ordinary region destination. They never receive slot hover.
    for (const region of ['main', 'bottom'] as const) {
      const state = empty(); state.placements = []
      const id = 'composition:drop-negative'
      state.organization.compositions.push({ id, name: 'Drop negative', system: false, scopes: [region], reference: state.reference, placements: [], views: [], mode: 'format',
        format: [{ id: 'negative', region, x: 0, y: 0, width: region === 'main' ? 100 : state.reference.bottom.width, height: region === 'main' ? 300 : state.reference.bottom.height }] })
      state.organization.favorites.push(id)
      await reset(state, theme); await edit(false)
      await page.getByRole('tab', { name: 'Composições', exact: true }).click()
      await page.locator(`[data-composition-id="${id}"] [data-composition-reorder]`).click(); await settle(page)
      assert.equal(await slots.count(), 1)
      await page.getByRole('tab', { name: 'Widgets', exact: true }).click(); await settle(page)
      const invalid = (await slots.first().boundingBox())!, type = region === 'main' ? 'host:notes' : 'host:queue'
      const originTile = page.locator(`[data-catalog-type="${type}"]`)
      await hold(originTile, { x: invalid.x + invalid.width / 2, y: invalid.y + invalid.height / 2 })
      assert.equal(await page.locator('.host-format-slot[data-drag-hover]').count(), 0)
      await page.mouse.up(); await settle(page)
      assert.equal(await slots.count(), 1); assert.equal(await page.locator('[data-widget]').count(), 0)
      if (region === 'main') {
        const main = (await page.locator('[data-surface="main"]').boundingBox())!
        await hold(originTile, { x: main.x + main.width * .65, y: main.y + main.height * .6 })
        await sampleRelease('notes')
        assert.equal(await slots.count(), 1, 'Free-space drop keeps the unrelated reservation')
        assert.equal(await page.locator('[data-widget="notes"]').getAttribute('data-w'), '230')
        await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page)
        assert.equal(await page.locator('[data-widget]').count(), 0); assert.equal(await slots.count(), 1)
      }
    }
    // Representative reduced-motion transfer preserves the same destination.
    await page.emulateMedia({ reducedMotion: 'reduce' }); await reset(empty(), theme); await edit()
    const bottom = (await page.locator('[data-surface="bottom"]').boundingBox())!
    await hold(page.locator('[data-widget="summary"] .widget-grip'), { x: bottom.x + 120, y: bottom.y + 50 })
    await sampleRelease('summary', true); assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'bottom')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }
  await writeFile(`.local/diagnostics/corrections-alpha13/drop-samples-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(observations, null, 2))
}
