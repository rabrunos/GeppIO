import assert from 'node:assert/strict'
import type { ElectronApplication, Page } from 'playwright'
import { settle } from './freeform-smoke.ts'

/** Exercise real Chromium pointer capture in a window that fits the hosted desktop.
 * The final release crosses the threshold without an intervening pointermove. */
export async function sidebarResistance(app: ElectronApplication, page: Page, key: string) {
  const separator = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true })
  const mode = () => page.locator('.workbench').getAttribute('data-sidebar-mode')
  const stored = () => page.evaluate(key => localStorage.getItem(key), key)
  const before = await stored()
  const frame = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const original = win.getBounds(), area = screen.getDisplayMatching(original).workArea
    win.setBounds({ x: area.x, y: area.y, width: Math.min(1024, area.width), height: Math.min(768, area.height) })
    win.focus(); win.webContents.focus()
    const bounds = win.getContentBounds(), zoom = win.webContents.getZoomFactor()
    return { original, bounds, area, zoom }
  })
  const input = await page.context().newCDPSession(page)
  try {
    await page.bringToFront()
    await page.waitForFunction(({ bounds, zoom }) => document.hasFocus() && document.visibilityState === 'visible'
      && Math.abs(innerWidth * zoom - bounds.width) <= 1 && Math.abs(innerHeight * zoom - bounds.height) <= 1, frame)
    await settle(page)
    const initial = Number(await separator.getAttribute('aria-valuenow'))
    const minimum = Number(await separator.getAttribute('aria-valuemin'))
    assert.ok(initial >= minimum && minimum > 48)
    const mouse = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) =>
      input.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, force: type === 'mouseReleased' ? 0 : .5, clickCount: type === 'mouseMoved' ? 0 : 1 })
    const capture = async () => {
      await settle(page)
      const box = await separator.boundingBox()
      assert.ok(box && box.height > 32)
      const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + 32)
      const limit = x + minimum - initial
      const { area, bounds, zoom } = frame
      assert.ok(bounds.x + (limit - 50) * zoom >= area.x && bounds.x + x * zoom < area.x + area.width &&
        bounds.y + y * zoom >= area.y && bounds.y + y * zoom < area.y + area.height, JSON.stringify({ frame, x, limit, y }))
      await separator.hover({ position: { x: x - box.x, y: y - box.y } })
      const trace = await separator.evaluateHandle(node => {
        const state = { pointer: -1, target: false, trusted: false, button: -1, buttons: -1, x: -1, y: -1 }
        document.addEventListener('pointerdown', event => {
          Object.assign(state, { pointer: event.pointerId, target: event.target === node, trusted: event.isTrusted,
            button: event.button, buttons: event.buttons, x: event.clientX, y: event.clientY })
        }, { once: true, capture: true })
        return state
      })
      try {
        await mouse('mousePressed', x, y)
        const state = await separator.evaluate((node, observed) => ({ ...observed, captured: node.hasPointerCapture(observed.pointer),
          focused: document.hasFocus(), hit: document.elementFromPoint(observed.x, observed.y)?.className }), trace)
        assert.ok(state.trusted && state.target && state.button === 0 && state.buttons === 1 && state.captured &&
          state.x === x && state.y === y, JSON.stringify({ frame, box, x, y, state }))
      } finally { await trace.dispose() }
      return { x, y, limit }
    }
    for (const preference of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion: preference })
      const { x, y, limit } = await capture()
      for (let step = 1; step <= 14; step++) await mouse('mouseMoved', x + (limit - 47 - x) * step / 14, y)
      await page.waitForFunction(min => document.querySelector('.sidebar-splitter')?.getAttribute('aria-valuenow') === String(min), minimum, { timeout: 3000 })
      assert.equal(await mode(), 'docked')
      assert.equal(Number(await separator.getAttribute('aria-valuenow')), minimum)
      await mouse('mouseMoved', limit - 50, y)
      await page.waitForSelector('.workbench[data-sidebar-mode="hidden"]')
      await mouse('mouseMoved', limit - 4, y)
      assert.equal(await mode(), 'hidden', 'Remain collapsed until reversing to the minimum')
      await mouse('mouseMoved', limit + 1, y)
      await page.waitForSelector('.workbench[data-sidebar-mode="docked"]')
      await page.keyboard.press('Escape')
      await mouse('mouseReleased', limit + 1, y)
      assert.equal(Number(await separator.getAttribute('aria-valuenow')), initial)
      assert.equal(await stored(), before, 'Preview and cancellation preserve saved bytes')
    }
    const { limit, y } = await capture()
    await mouse('mouseMoved', limit - 47, y)
    await mouse('mouseReleased', limit - 50, y)
    await page.waitForSelector('.workbench[data-sidebar-mode="hidden"]')
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? '{}').organization?.chrome?.sidebar?.visible === false, key, { timeout: 10000 })
    await page.evaluate(({ key, before }) => { if (before === null) localStorage.removeItem(key); else localStorage.setItem(key, before) }, { key, before })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.reload()
    await page.getByTestId('edit-layout').waitFor()
    assert.equal(await mode(), 'docked')
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), initial)
    console.log('Sidebar resistance passed', JSON.stringify({ contentWidth: frame.bounds.width, contentHeight: frame.bounds.height, zoom: frame.zoom }))
  } finally {
    await input.detach()
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]!.setBounds(bounds), frame.original)
    await settle(page)
  }
}
