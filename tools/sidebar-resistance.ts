import assert from 'node:assert/strict'
import type { Page } from 'playwright'

/** Use a real captured pointer. Release at a different coordinate to exercise
 * the final event even when no intervening pointermove has been painted. */
export async function sidebarResistance(page: Page, key: string) {
  const separator = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true })
  const mode = () => page.locator('.workbench').getAttribute('data-sidebar-mode')
  const stored = () => page.evaluate(key => localStorage.getItem(key), key)
  const before = await stored()
  const initial = Number(await separator.getAttribute('aria-valuenow'))
  const minimum = Number(await separator.getAttribute('aria-valuemin'))
  assert.ok(initial >= minimum && minimum > 48)
  await page.bringToFront()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const box = await separator.boundingBox()
  assert.ok(box)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  const limit = x + minimum - initial
  const capture = async () => {
    await separator.evaluate(node => node.addEventListener('pointerdown', event => { (node as HTMLElement).dataset.testPointer = String((event as PointerEvent).pointerId) }, { once: true }))
    await page.mouse.move(x, y)
    await page.mouse.down()
    const state = await separator.evaluate((node, point) => ({ captured: node.hasPointerCapture(Number((node as HTMLElement).dataset.testPointer)), focused: document.hasFocus(), hit: document.elementFromPoint(point.x, point.y)?.className }), { x, y })
    assert.ok(state.captured, JSON.stringify({ box, state }))
  }
  for (const preference of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: preference })
    await capture()
    await page.mouse.move(limit - 47, y, { steps: 14 })
    assert.equal(await mode(), 'docked')
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum)
    await page.mouse.move(limit - 50, y)
    await page.waitForSelector('.workbench[data-sidebar-mode="hidden"]')
    await page.mouse.move(limit - 4, y)
    assert.equal(await mode(), 'hidden', 'Remain collapsed until reversing to the minimum')
    await page.mouse.move(limit + 1, y)
    await page.waitForSelector('.workbench[data-sidebar-mode="docked"]')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), initial)
    assert.equal(await stored(), before, 'Preview and cancellation preserve saved bytes')
  }
  await capture()
  await page.mouse.move(limit - 47, y)
  const input = await page.context().newCDPSession(page)
  try {
    await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: limit - 50, y, button: 'left', buttons: 0, clickCount: 1 })
  } finally { await input.detach() }
  await page.waitForSelector('.workbench[data-sidebar-mode="hidden"]')
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{}').organization?.chrome?.sidebar?.visible === false, key, { timeout: 10000 })
  // Explicitly restore the exact initial disposable profile for later journeys.
  await page.evaluate(({ key, before }) => { if (before === null) localStorage.removeItem(key); else localStorage.setItem(key, before) }, { key, before })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload()
  await page.getByTestId('edit-layout').waitFor()
  assert.equal(await mode(), 'docked')
  assert.equal(Number(await separator.getAttribute('aria-valuenow')), initial)
}
