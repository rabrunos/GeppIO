/** Editor interaction assertions in the caller's disposable Electron profile. */
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { canPlaceWithGap, canvasGap, decodeLayout, RESIZE_DIRECTIONS, tooClose } from '../src/shared/layout.ts'
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
const close = (a: number, b: number, label = '') => assert.ok(Math.abs(a - b) < .00001, `${label} ${a} != ${b}`)
function same(actual: Placement[], expected: Placement[]) {
  assert.deepEqual(actual.map(p => p.id), expected.map(p => p.id))
  actual.forEach((p, i) => { for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(p[key] - expected[i]![key]) < 1e-9, `${p.id}.${key}: ${p[key]} != ${expected[i]![key]}`) })
}
function valid(ps: Placement[]) { decodeLayout(JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: ps }), DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS) }
async function movePointer(page: Page, x: number, y: number, options?: { steps?: number }) {
  await page.mouse.move(x, y, options)
  // Pointer dispatch completion does not guarantee React has committed its frame.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function spaced(page: Page, ps: Placement[]) {
  const bounds = await page.getByTestId('layout-canvas').boundingBox(); assert.ok(bounds)
  // Chromium serializes inline percentages to limited precision (e.g. 9.99987 px
  // for an exact 10 px model gap). Allow only 0.001 CSS px in this DOM assertion;
  // model and persisted-data assertions keep the full 10 px requirement.
  const gap = canvasGap(bounds, 10 - .001)
  const conflicts = ps.flatMap((p, i) => ps.slice(i + 1).filter(q => tooClose(p, q, gap)).map(q => ({ p, q })))
  assert.ok(ps.every(p => canPlaceWithGap(p, ps, gap)), `All seven draft rectangles must maintain 10 logical CSS px clearance: ${JSON.stringify({ bounds, conflicts })}`)
}
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
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-widget]')).every(e => getComputedStyle(e).transform === 'none'))
  await target.click({ trial: true })
  const box = await target.boundingBox(); assert.ok(box)
  const canvas = await page.getByTestId('layout-canvas').boundingBox(); assert.ok(canvas)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  if (await page.getByTestId('save-layout').count()) assert.ok(await target.evaluate(e => Array.from({ length: 10 }, (_, i) => i).some(i => e.hasPointerCapture(i))), 'Gesture must capture the pointer on the intended control')
  return { x, y, width: canvas.width, height: canvas.height, target }
}
export async function layoutSmoke(page: Page) {
  const baseline = await rectangles(page)
  assert.equal(await page.locator('[data-resize]').count(), 0)
  const input = page.getByRole('textbox', { name: 'Nome de exemplo' })
  await input.fill('Teste de formulário'); await input.press('ArrowLeft')
  same(await rectangles(page), baseline)
  const normal = await startPointer(page, 'summary')
  await movePointer(page, normal.x + 25, normal.y + 25); await page.mouse.up()
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
      await movePointer(page, pointer.x + dx * pointer.width, pointer.y + dy * pointer.height, { steps: 3 })
      const next = (await rectangles(page))[0]!; valid(await rectangles(page))
      await spaced(page, await rectangles(page))
      const response = `${theme}/${direction}: ${await page.locator('.workspace-feedback').textContent()}`
      close(next.width, direction.includes('w') || direction.includes('e') ? .23 : .2, response)
      close(next.height, direction.includes('n') || direction.includes('s') ? .23 : .2, response)
      close(next.x + (direction.includes('w') ? next.width : 0), direction.includes('w') ? .5 : .3)
      close(next.y + (direction.includes('n') ? next.height : 0), direction.includes('n') ? .5 : .3)
      // Reverse within the same capture: both geometry and neighbours come from the start snapshot.
      await movePointer(page, pointer.x, pointer.y); same(await rectangles(page), sparse)
      await movePointer(page, pointer.x - dx * pointer.width, pointer.y - dy * pointer.height)
      const inward = (await rectangles(page))[0]!
      close(inward.width, dx ? .17 : .2); close(inward.height, dy ? .18 : .2)
      await page.mouse.up(); await page.getByTestId('cancel-layout').click()
      same(await rectangles(page), baseline)

      // Guides must work on resize too; equal-size targets may be in a different row/column.
      await importDraft(page, sparse)
      await page.getByRole('checkbox', { name: 'Guias e snap' }).check()
      const guidedResize = await startPointer(page, 'summary', direction)
      await movePointer(page, guidedResize.x + Math.sign(dx) * .003 * guidedResize.width, guidedResize.y + Math.sign(dy) * .003 * guidedResize.height)
      same(await rectangles(page), sparse)
      assert.ok(await page.locator('.smart-guide[data-guide-kind="size"]').count() > 0)
      await page.keyboard.down('Alt')
      await movePointer(page, guidedResize.x + Math.sign(dx) * .004123 * guidedResize.width, guidedResize.y + Math.sign(dy) * .004123 * guidedResize.height)
      assert.equal(await page.locator('.smart-guide').count(), 0)
      const freeResize = (await rectangles(page))[0]!
      close(freeResize.width, dx ? .204123 : .2); close(freeResize.height, dy ? .204123 : .2)
      await spaced(page, await rectangles(page))
      await page.keyboard.up('Alt'); await page.mouse.up(); await page.getByTestId('cancel-layout').click()
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
  await movePointer(page, guided.x + .159 * guided.width, guided.y)
  assert.ok(await page.locator('.smart-guide').count() > 0); close((await rectangles(page))[0]!.x, .46)
  await page.keyboard.down('Alt')
  await movePointer(page, guided.x + .157123 * guided.width, guided.y)
  assert.equal(await page.locator('.smart-guide').count(), 0); close((await rectangles(page))[0]!.x, .457123)
  await page.keyboard.up('Alt'); await page.mouse.up(); await page.getByTestId('cancel-layout').click()

  // A fully occupied row forces adaptive resizing when one widget grows horizontally.
  const crowded = DEFAULT_LAYOUT.placements.map((p, i) => ({ id: p.id,
    x: i === 0 ? 0 : i === 1 ? .4 : i === 2 ? .8 : (i - 3) * .25,
    y: i <= 2 ? 0 : .82, width: i <= 1 ? .4 : .2, height: i <= 2 ? .8 : .18 }))
  valid(crowded)
  await importDraft(page, crowded)
  const crowdedPreview = await rectangles(page)
  await spaced(page, crowdedPreview)
  const adaptive = await startPointer(page, 'summary', 'e')
  await movePointer(page, adaptive.x + .15 * adaptive.width, adaptive.y, { steps: 5 })
  const changed = await rectangles(page); valid(changed)
  close(changed[0]!.width, .55)
  assert.ok(changed[1]!.width < crowdedPreview[1]!.width, 'Adjacent widget must compress, despite lateral alternatives')
  close(changed[1]!.y, crowdedPreview[1]!.y); close(changed[1]!.height, crowdedPreview[1]!.height)
  close(changed[1]!.x + changed[1]!.width, crowdedPreview[1]!.x + crowdedPreview[1]!.width)
  await spaced(page, changed)
  await movePointer(page, adaptive.x, adaptive.y); same(await rectangles(page), crowdedPreview)
  await movePointer(page, adaptive.x + .15 * adaptive.width, adaptive.y)
  await page.keyboard.press('Escape'); await page.mouse.up()
  same(await rectangles(page), crowdedPreview); assert.equal(await page.getByTestId('save-layout').count(), 1)

  for (const cancellation of ['pointercancel', 'lostpointercapture'] as const) {
    const pointer = await startPointer(page, 'summary', 'e')
    await movePointer(page, pointer.x + .1 * pointer.width, pointer.y)
    await pointer.target.evaluate((e, type) => {
      const id = Array.from({ length: 10 }, (_, i) => i).find(i => e.hasPointerCapture(i))
      if (id === undefined) throw new Error('No captured pointer')
      if (type === 'lostpointercapture') e.releasePointerCapture(id)
      else e.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id }))
    }, cancellation)
    // Chromium processes a pending capture-release notification before the next pointer event.
    await movePointer(page, pointer.x + .11 * pointer.width, pointer.y)
    await page.mouse.up(); same(await rectangles(page), crowdedPreview)
  }

  const impossible = await startPointer(page, 'summary', 'e')
  await movePointer(page, impossible.x + .7 * impossible.width, impossible.y)
  same(await rectangles(page), crowdedPreview)
  await page.getByRole('status').filter({ hasText: 'Sem espaço' }).waitFor()
  assert.match(await page.locator('[data-widget="summary"]').getAttribute('class') ?? '', /invalid/)
  await page.mouse.up(); valid(await rectangles(page))

  await importDraft(page, sparse)
  const push = await startPointer(page, 'summary')
  await movePointer(page, push.x, push.y - .25 * push.height, { steps: 5 })
  const pushed = await rectangles(page); valid(pushed)
  await spaced(page, pushed)
  assert.ok(pushed.slice(1).some((p, i) => p.x !== sparse[i + 1]!.x || p.y !== sparse[i + 1]!.y), 'Neighbours must move during the pointer gesture')
  await page.mouse.up(); await page.getByTestId('save-layout').click()
  const stored = await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey)
  assert.ok(stored); valid(JSON.parse(stored).placements as Placement[])
  const saved = JSON.parse(stored).placements as Placement[]
  const savedCanvas = await page.getByTestId('layout-canvas').boundingBox(); assert.ok(savedCanvas)
  assert.ok(saved.every(p => canPlaceWithGap(p, saved, canvasGap(savedCanvas))), 'Persisted model must retain the exact 10 px gap')
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), pushed)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('cancel-layout').click()
  same(await rectangles(page), pushed)

  // South growth with an open lateral area must preserve the lower widget's column and bottom.
  const stacked = DEFAULT_LAYOUT.placements.map((p, i) => ({ id: p.id,
    x: i <= 1 ? .05 : .52 + ((i - 2) % 2) * .24,
    y: i === 0 ? .05 : i === 1 ? .33 : Math.floor((i - 2) / 2) * .3,
    width: i <= 1 ? .3 : .2, height: i === 0 ? .22 : i === 1 ? .4 : .22 }))
  await importDraft(page, stacked)
  const lowerBefore = (await rectangles(page))[1]!
  const south = await startPointer(page, 'summary', 's')
  await movePointer(page, south.x, south.y + .1 * south.height, { steps: 4 })
  const lowerAfter = (await rectangles(page))[1]!
  assert.ok(lowerAfter.height < lowerBefore.height, 'Owner priority: lower neighbour must shrink before moving sideways')
  close(lowerAfter.x, lowerBefore.x); close(lowerAfter.width, lowerBefore.width)
  close(lowerAfter.y + lowerAfter.height, lowerBefore.y + lowerBefore.height)
  await spaced(page, await rectangles(page))
  await movePointer(page, south.x, south.y); same(await rectangles(page), stacked)
  await page.mouse.up(); await page.getByTestId('cancel-layout').click()

  // A persisted touching-edge v1 is loaded verbatim, then normalized only inside Edit.
  const legacy = JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: crowded })
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: IDENTITY.layoutStorageKey, raw: legacy })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), crowded)
  await page.getByTestId('edit-layout').click(); await spaced(page, await rectangles(page))
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacy)
  await page.getByTestId('cancel-layout').click(); same(await rectangles(page), crowded)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacy)
  await page.getByTestId('edit-layout').click(); const normalized = await rectangles(page)
  await page.getByTestId('save-layout').click(); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  same(await rectangles(page), normalized); await spaced(page, normalized)
  assert.notEqual(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacy)

  const tight = DEFAULT_LAYOUT.placements.map((p, i) => i === 0 ? { id: p.id, x: 0, y: 0, width: 1, height: .64 }
    : { id: p.id, x: ((i - 1) % 5) * .17, y: i <= 5 ? .64 : .82, width: .17, height: .18 })
  valid(tight)
  const tightRaw = JSON.stringify({ schemaVersion: 1, theme: 'dark', placements: tight })
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: IDENTITY.layoutStorageKey, raw: tightRaw })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), tight)
  await page.getByTestId('edit-layout').click()
  await page.getByRole('status').filter({ hasText: 'Este layout antigo não comporta 10 px' }).waitFor()
  await page.getByTestId('save-layout').click()
  await page.getByRole('status').filter({ hasText: 'Mantenha pelo menos 10 px' }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), tightRaw)
  await page.getByTestId('cancel-layout').click(); same(await rectangles(page), tight)
  await page.locator('input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await page.getByRole('status').filter({ hasText: 'Arquivo de layout inválido' }).waitFor()
  same(await rectangles(page), tight)

  // Corrupt data is intentionally retained until an explicit Save in this disposable profile.
  await page.evaluate(key => localStorage.setItem(key, '{corrupt'), IDENTITY.layoutStorageKey)
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  same(await rectangles(page), DEFAULT_LAYOUT.placements)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), '{corrupt')
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  // Existing alpha.5 schema-v1 composition remains accepted on reload.
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); same(await rectangles(page), DEFAULT_LAYOUT.placements)
  console.log(JSON.stringify({ layoutEditor: 'passed', themes: ['dark', 'light'], devicePixelRatio: await page.evaluate(() => devicePixelRatio), checks: ['normal mode form/scroll', 'eight edge/corner pointer zones and cursors', 'keyboard move/resize', 'move and resize Smart Guides/Alt/size matching', 'live 10 CSS px gaps', 'live local displacement', 'same-axis fixed-opposite neighbour compression', 'blocked candidate preserves preview', 'pointer reversal', 'Escape/pointercancel/lost capture', 'Save/Cancel/reload', 'touching v1 normalization without writes until Save', 'impossible legacy gap warns and blocks Save', 'invalid import', 'corrupt bytes preserved'] }))
}
