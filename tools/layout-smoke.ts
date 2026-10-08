/** Editor interaction assertions in the caller's disposable Electron profile. */
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { decodeLayout, RESIZE_DIRECTIONS } from '../src/shared/layout.ts'
import type { Placement, ResizeDirection } from '../src/shared/layout.ts'
import { DEFAULT_LAYOUT, MINIMUMS } from '../src/shared/layout-defaults.ts'
import { IDENTITY } from '../src/shared/identity.ts'

async function rectangles(page: Page): Promise<Placement[]> {
  return page.locator('[data-widget]').evaluateAll(elements => elements.map(element => {
    const e = element as HTMLElement
    return { id: e.dataset.widget!, x: parseFloat(e.style.left) / 100, y: parseFloat(e.style.top) / 100,
      width: parseFloat(e.style.width) / 100, height: parseFloat(e.style.height) / 100 }
  }))
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .00001, `${a} != ${b}`)
function same(actual: Placement[], expected: Placement[]) {
  assert.deepEqual(actual.map(p => p.id), expected.map(p => p.id))
  actual.forEach((p, i) => { for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(p[key] - expected[i]![key]) < 1e-9, `${p.id}.${key}: ${p[key]} != ${expected[i]![key]}`) })
}
function valid(ps: Placement[]) { decodeLayout(JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: ps }), DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS) }
async function importDraft(page: Page, ps: Placement[]) {
  if (await page.getByTestId('cancel-layout').count()) await page.getByTestId('cancel-layout').click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: ps })) })
  await page.getByTestId('save-layout').waitFor()
  await page.getByRole('checkbox', { name: 'Guias e snap' }).uncheck()
}
async function startPointer(page: Page, id: string, direction?: ResizeDirection) {
  const target = page.locator(`[data-widget="${id}"] ${direction ? `[data-resize="${direction}"]` : '.widget-grip'}`)
  await target.scrollIntoViewIfNeeded()
  // Settled Motion transitions must not shift the target during the pointer-down.
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running'))
  const box = await target.boundingBox(); assert.ok(box)
  const canvas = await page.getByTestId('layout-canvas').boundingBox(); assert.ok(canvas)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  return { x, y, width: canvas.width, height: canvas.height, target }
}
export async function layoutSmoke(page: Page) {
  const baseline = await rectangles(page)
  assert.equal(await page.locator('[data-resize]').count(), 0)
  const input = page.getByRole('textbox', { name: 'Nome de exemplo' })
  await input.fill('Teste de formulário'); await input.press('ArrowLeft')
  same(await rectangles(page), baseline)
  const normal = await startPointer(page, 'summary')
  await page.mouse.move(normal.x + 25, normal.y + 25); await page.mouse.up()
  same(await rectangles(page), baseline)
  await page.locator('[data-widget="activity"] .widget-content').evaluate(e => { e.scrollTop = 120 })
  assert.ok(await page.locator('[data-widget="activity"] .widget-content').evaluate(e => e.scrollTop > 0))

  const sparse = DEFAULT_LAYOUT.placements.map((p, i) => ({ id: p.id,
    x: i === 0 ? .3 : i <= 4 ? (i - 1) * .23 : (i - 5) * .25,
    y: i === 0 ? .3 : i <= 4 ? 0 : .75, width: .2, height: .2 }))
  valid(sparse)
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const direction of RESIZE_DIRECTIONS) {
      await importDraft(page, sparse)
      assert.equal(await page.locator('[data-resize]').count(), 56)
      assert.equal(await page.locator('.resize-handle, [data-resize] svg').count(), 0)
      const pointer = await startPointer(page, 'summary', direction)
      assert.match(await pointer.target.getAttribute('aria-label') ?? '', /^Redimensionar Panorama:/)
      const cursor = await pointer.target.evaluate(e => getComputedStyle(e).cursor)
      assert.equal(cursor, direction.length === 1 ? (/[ns]/.test(direction) ? 'ns-resize' : 'ew-resize') : (['ne', 'sw'].includes(direction) ? 'nesw-resize' : 'nwse-resize'))
      const dx = direction.includes('w') ? -.03 : direction.includes('e') ? .03 : 0
      const dy = direction.includes('n') ? -.03 : direction.includes('s') ? .03 : 0
      await page.mouse.move(pointer.x + dx * pointer.width, pointer.y + dy * pointer.height, { steps: 3 })
      const next = (await rectangles(page))[0]!; valid(await rectangles(page))
      close(next.width, direction.includes('w') || direction.includes('e') ? .23 : .2)
      close(next.height, direction.includes('n') || direction.includes('s') ? .23 : .2)
      close(next.x + (direction.includes('w') ? next.width : 0), direction.includes('w') ? .5 : .3)
      close(next.y + (direction.includes('n') ? next.height : 0), direction.includes('n') ? .5 : .3)
      // Reverse within the same capture: both geometry and neighbours come from the start snapshot.
      await page.mouse.move(pointer.x, pointer.y); same(await rectangles(page), sparse)
      await page.mouse.move(pointer.x - dx * pointer.width, pointer.y - dy * pointer.height)
      const inward = (await rectangles(page))[0]!
      close(inward.width, dx ? .17 : .2); close(inward.height, dy ? .18 : .2)
      await page.mouse.up(); await page.getByTestId('cancel-layout').click()
      same(await rectangles(page), baseline)
    }
  }
  await importDraft(page, sparse)
  const east = page.locator('[data-widget="summary"] [data-resize="e"]')
  await east.focus(); await page.keyboard.press('ArrowRight'); close((await rectangles(page))[0]!.width, .205)
  const grip = page.getByRole('button', { name: 'Mover Panorama', exact: true })
  await grip.focus(); await page.keyboard.press('ArrowRight'); close((await rectangles(page))[0]!.x, .305)
  await page.getByTestId('cancel-layout').click()

  await importDraft(page, sparse)
  await page.getByRole('checkbox', { name: 'Guias e snap' }).check()
  const guided = await startPointer(page, 'summary')
  await page.mouse.move(guided.x + .159 * guided.width, guided.y)
  assert.ok(await page.locator('.smart-guide').count() > 0); close((await rectangles(page))[0]!.x, .46)
  await page.keyboard.down('Alt')
  await page.mouse.move(guided.x + .157123 * guided.width, guided.y)
  assert.equal(await page.locator('.smart-guide').count(), 0); close((await rectangles(page))[0]!.x, .457123)
  await page.keyboard.up('Alt'); await page.mouse.up(); await page.getByTestId('cancel-layout').click()

  // A fully occupied row forces adaptive resizing when one widget grows horizontally.
  const crowded = DEFAULT_LAYOUT.placements.map((p, i) => ({ id: p.id,
    x: i === 0 ? 0 : i === 1 ? .4 : i === 2 ? .8 : (i - 3) * .25,
    y: i <= 2 ? 0 : .82, width: i <= 1 ? .4 : .2, height: i <= 2 ? .8 : .18 }))
  valid(crowded)
  await importDraft(page, crowded)
  const adaptive = await startPointer(page, 'summary', 'e')
  await page.mouse.move(adaptive.x + .15 * adaptive.width, adaptive.y, { steps: 5 })
  const changed = await rectangles(page); valid(changed)
  close(changed[0]!.width, .55)
  assert.ok(changed.slice(1).some((p, i) => p.width < crowded[i + 1]!.width || p.height < crowded[i + 1]!.height), 'Live adaptive resize must be observable before pointer-up')
  await page.mouse.move(adaptive.x, adaptive.y); same(await rectangles(page), crowded)
  await page.mouse.move(adaptive.x + .15 * adaptive.width, adaptive.y)
  await page.keyboard.press('Escape'); await page.mouse.up()
  same(await rectangles(page), crowded); assert.equal(await page.getByTestId('save-layout').count(), 1)

  for (const cancellation of ['pointercancel', 'lostpointercapture'] as const) {
    const pointer = await startPointer(page, 'summary', 'e')
    await page.mouse.move(pointer.x + .1 * pointer.width, pointer.y)
    await pointer.target.evaluate((e, type) => {
      const id = Array.from({ length: 10 }, (_, i) => i).find(i => e.hasPointerCapture(i))
      if (id === undefined) throw new Error('No captured pointer')
      if (type === 'lostpointercapture') e.releasePointerCapture(id)
      else e.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id }))
    }, cancellation)
    // Chromium processes a pending capture-release notification before the next pointer event.
    await page.mouse.move(pointer.x + .11 * pointer.width, pointer.y)
    await page.mouse.up(); same(await rectangles(page), crowded)
  }

  const impossible = await startPointer(page, 'summary', 'e')
  await page.mouse.move(impossible.x + .7 * impossible.width, impossible.y)
  same(await rectangles(page), crowded)
  await page.getByRole('status').filter({ hasText: 'Sem espaço' }).waitFor()
  assert.match(await page.locator('[data-widget="summary"]').getAttribute('class') ?? '', /invalid/)
  await page.mouse.up(); valid(await rectangles(page))

  await importDraft(page, sparse)
  const push = await startPointer(page, 'summary')
  await page.mouse.move(push.x, push.y - .25 * push.height, { steps: 5 })
  const pushed = await rectangles(page); valid(pushed)
  assert.ok(pushed.slice(1).some((p, i) => p.x !== sparse[i + 1]!.x || p.y !== sparse[i + 1]!.y), 'Neighbours must move during the pointer gesture')
  await page.mouse.up(); await page.getByTestId('save-layout').click()
  const stored = await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey)
  assert.ok(stored); valid(JSON.parse(stored).placements as Placement[])
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), pushed)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('cancel-layout').click()
  same(await rectangles(page), pushed)
  await page.locator('input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await page.getByRole('status').filter({ hasText: 'Arquivo de layout inválido' }).waitFor()
  same(await rectangles(page), pushed)

  // Corrupt data is intentionally retained until an explicit Save in this disposable profile.
  await page.evaluate(key => localStorage.setItem(key, '{corrupt'), IDENTITY.layoutStorageKey)
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  same(await rectangles(page), DEFAULT_LAYOUT.placements)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), '{corrupt')
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  // Existing alpha.5 schema-v1 composition remains accepted on reload.
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), DEFAULT_LAYOUT.placements)
  console.log(JSON.stringify({ layoutEditor: 'passed', themes: ['dark', 'light'], devicePixelRatio: await page.evaluate(() => devicePixelRatio), checks: ['normal mode form/scroll', 'eight edge/corner pointer zones and cursors', 'keyboard move/resize', 'Smart Guides/Alt', 'live displacement', 'live adaptive resize', 'blocked candidate preserves preview', 'pointer reversal', 'Escape/pointercancel/lost capture', 'Save/Cancel/reload', 'v1 compatibility', 'invalid import', 'corrupt bytes preserved'] }))
}
