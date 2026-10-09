/** Region interactions run only in the caller's disposable Electron profile. */
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { GRID_KEY } from '../src/shared/grid/policy.ts'
import { IDENTITY } from '../src/shared/identity.ts'

const names = { sidebar: 'Largura da Sidebar', bottom: 'Altura da Bottom' } as const
type Kind = keyof typeof names
async function frame(page: Page) { await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))) }
function separator(page: Page, kind: Kind) { return page.getByRole('separator', { name: names[kind] }) }
async function now(page: Page, kind: Kind) { return Number(await separator(page, kind).getAttribute('aria-valuenow')) }
async function bounds(page: Page) {
  await frame(page)
  const area = await page.locator('.work-area').boundingBox(); assert.ok(area)
  for (const kind of ['sidebar', 'bottom'] as const) {
    const sep = separator(page, kind), extent = kind === 'sidebar' ? area.width : area.height
    const max = Math.max(0, Math.min(kind === 'sidebar' ? 300 : 180, extent * (kind === 'sidebar' ? .2 : .25), extent - 165))
    const min = Math.min(kind === 'sidebar' ? 160 : 43, max), value = await now(page, kind)
    assert.ok(Math.abs(Number(await sep.getAttribute('aria-valuemax')) - max) < .02)
    assert.ok(Math.abs(Number(await sep.getAttribute('aria-valuemin')) - min) < .02)
    assert.ok(Number.isFinite(value) && value >= min && value <= max)
    const region = await page.locator(`[data-region="${kind}"]`).boundingBox(); assert.ok(region)
    assert.ok(Math.abs((kind === 'sidebar' ? region.width : region.height) - value) < .02, `${kind} rendered size matches ARIA`)
  }
  const main = await page.getByTestId('layout-canvas').boundingBox(); assert.ok(main)
  if (area.width >= 165 && area.height >= 165) assert.ok(main.width >= 159.98 && main.height >= 159.98)
}
async function begin(page: Page, kind: Kind) {
  const sep = separator(page, kind), box = await sep.boundingBox(); assert.ok(box)
  await sep.evaluate(e => e.addEventListener('pointerdown', event => { (e as HTMLElement).dataset.testPointer = String((event as PointerEvent).pointerId) }, { once: true }))
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(point.x, point.y); await page.mouse.down()
  assert.ok(await sep.evaluate(e => e.hasPointerCapture(Number((e as HTMLElement).dataset.testPointer))))
  return point
}
async function move(page: Page, kind: Kind, point: { x: number; y: number }, delta: number) {
  await page.mouse.move(point.x + (kind === 'sidebar' ? delta : 0), point.y - (kind === 'bottom' ? delta : 0)); await frame(page)
}
async function dragTo(page: Page, kind: Kind, value: number) {
  const original = await now(page, kind), point = await begin(page, kind)
  await move(page, kind, point, value - original); await page.mouse.up(); await frame(page)
}
async function storage(page: Page) { return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [GRID_KEY, IDENTITY.layoutStorageKey]) }

export async function regionSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>, validMain: () => Promise<unknown>) {
  await resizeWindow(1480, 980)
  const initial = { sidebar: await now(page, 'sidebar'), bottom: await now(page, 'bottom') }
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    const saved = await storage(page)
    await page.evaluate(keys => {
      const original = Storage.prototype.setItem
      const state = window as unknown as { regionStorage: { writes: number; restore(): void } }
      state.regionStorage = { writes: 0, restore() { Storage.prototype.setItem = original } }
      Storage.prototype.setItem = function(key, value) { if (keys.includes(key)) state.regionStorage.writes++; original.call(this, key, value) }
    }, [GRID_KEY, IDENTITY.layoutStorageKey])
    for (const [width, height] of [[1000, 720], [1280, 740], [1480, 980], [1800, 720]]) {
      await resizeWindow(width!, height!); await bounds(page); await validMain()
      for (const kind of ['sidebar', 'bottom'] as const) {
        const sep = separator(page, kind), other = kind === 'sidebar' ? 'bottom' : 'sidebar', peer = await now(page, other)
        const min = Number(await sep.getAttribute('aria-valuemin')), max = Number(await sep.getAttribute('aria-valuemax'))
        await dragTo(page, kind, max + 600); assert.equal(await now(page, kind), max)
        await dragTo(page, kind, min - 600); assert.equal(await now(page, kind), min)
        const increase = kind === 'sidebar' ? 'ArrowRight' : 'ArrowUp', decrease = kind === 'sidebar' ? 'ArrowLeft' : 'ArrowDown'
        await sep.press(increase); assert.equal(await now(page, kind), Math.min(max, min + 10))
        const beforeShift = await now(page, kind)
        await sep.press('Shift+' + increase); assert.equal(await now(page, kind), Math.min(max, beforeShift + 30))
        for (let i = 0; i < 10; i++) await sep.press('Shift+' + increase)
        assert.equal(await now(page, kind), max)
        for (let i = 0; i < 10; i++) await sep.press('Shift+' + decrease)
        assert.equal(await now(page, kind), min); assert.equal(await now(page, other), peer)
        await bounds(page); await validMain()
      }
      // Sidebar scroll remains independent from Main's no-scroll geometry.
      assert.equal(await page.locator('[data-region="sidebar"]').evaluate(e => getComputedStyle(e).overflowY), 'auto')
    }
    await resizeWindow(1480, 980)
    for (const kind of ['sidebar', 'bottom'] as const) {
      await dragTo(page, kind, initial[kind])
      const original = await now(page, kind), sep = separator(page, kind)
      for (const cancellation of ['Escape', 'pointercancel', 'lostcapture', 'viewport']) {
        const point = await begin(page, kind); await move(page, kind, point, 20)
        assert.ok(await now(page, kind) > original)
        if (cancellation === 'Escape') await page.keyboard.press('Escape')
        else if (cancellation === 'viewport') await resizeWindow(1000, 720)
        else await sep.evaluate((e, mode) => {
          const pointerId = Number((e as HTMLElement).dataset.testPointer)
          if (mode === 'pointercancel') e.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }))
          else e.releasePointerCapture(pointerId)
        }, cancellation)
        await frame(page)
        assert.equal(await sep.evaluate(e => e.hasPointerCapture(Number((e as HTMLElement).dataset.testPointer))), false)
        await page.mouse.up(); await resizeWindow(1480, 980); await frame(page)
        assert.equal(await now(page, kind), original)
        // A fresh gesture works after every cancellation.
        await dragTo(page, kind, original + 10); assert.equal(await now(page, kind), original + 10)
        await dragTo(page, kind, original)
      }
    }
    // Preserve above-cap requests through repeated viewport changes without drift or storage writes.
    await dragTo(page, 'sidebar', 285); await dragTo(page, 'bottom', 170)
    const large = { sidebar: await now(page, 'sidebar'), bottom: await now(page, 'bottom') }
    for (let i = 0; i < 3; i++) {
      await resizeWindow(1000, 720); await bounds(page); await validMain()
      await resizeWindow(1480, 980); await bounds(page); await validMain()
      assert.equal(await now(page, 'sidebar'), large.sidebar); assert.equal(await now(page, 'bottom'), large.bottom)
    }
    // Synthetic small Work Areas exercise relaxed minima below Electron's native minimum window.
    for (const [width, height] of [[600, 300], [200, 200]]) {
      await page.locator('.work-area').evaluate((e, size) => { const style = (e as HTMLElement).style; style.flex = 'none'; style.width = size.width + 'px'; style.height = size.height + 'px' }, { width: width!, height: height! })
      await bounds(page); await validMain()
      const sidebar = page.locator('[data-region="sidebar"]')
      assert.ok(await sidebar.evaluate(e => { e.scrollTop = e.scrollHeight; return e.scrollTop > 0 }))
    }
    await page.locator('.work-area').evaluate(e => { const style = (e as HTMLElement).style; style.removeProperty('flex'); style.removeProperty('width'); style.removeProperty('height') })
    await bounds(page); await validMain()
    assert.equal(await now(page, 'sidebar'), large.sidebar); assert.equal(await now(page, 'bottom'), large.bottom)
    for (const kind of ['sidebar', 'bottom'] as const) await dragTo(page, kind, initial[kind])
    assert.deepEqual(await storage(page), saved)
    assert.equal(await page.evaluate(() => {
      const state = window as unknown as { regionStorage: { writes: number; restore(): void } }
      state.regionStorage.restore(); return state.regionStorage.writes
    }), 0, 'region/window resizing never writes layout storage')
  }
  console.log(JSON.stringify({ result: 'passed', subsystem: 'region bounds', checks: ['live proportional/absolute/Main caps', 'rendered/ARIA bounds', 'mouse/keyboard/Shift', 'independent peers', 'Escape/cancel/lost capture/viewport cancellation', 'fresh capture after cancellation', 'request A-B-A restoration', 'synthetic 600x300/200x200 relaxed minima', 'Sidebar scroll', 'centered square Main', 'unchanged v1/v2 bytes', 'both themes'] }))
}
