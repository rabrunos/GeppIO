/** Independent rendered-geometry checks on the desktop caller's disposable profile only. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { DEFAULT_GRID, GRID_KEY, constraintsFor } from '../src/shared/grid/policy.ts'
import { moveRect, resizeRect } from '../src/shared/grid/geometry.ts'
import { reflow } from '../src/shared/grid/reflow.ts'
import { parseGrid } from '../src/shared/grid/schema.ts'
import type { GridSnapshot } from '../src/shared/grid/types.ts'
import { COMPOSITIONS } from '../tests/fixtures/grid-compositions.ts'
import { assertContinuous, assertSafe, changes, rectangles } from '../tests/helpers/projection-oracle.ts'
import type { ProjectionSample } from '../tests/helpers/projection-oracle.ts'

async function frame(page: Page) { await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))) }
async function sample(page: Page, source: GridSnapshot): Promise<ProjectionSample> {
  await frame(page)
  const observed = await page.getByTestId('layout-canvas').evaluate(e => {
    const main = e as HTMLElement, d = main.dataset, origin = main.getBoundingClientRect()
    return { width: Number(d.usableWidth), height: Number(d.usableHeight), columns: Number(d.columns), rows: Number(d.rows),
      metrics: { cell: Number(d.cell), gutter: Number(d.gutter), pitch: Number(d.pitch), width: Number(d.gridWidth), height: Number(d.gridHeight), left: Number(d.gridLeft) - 9, top: Number(d.gridTop) - 9 },
      placements: [...main.querySelectorAll<HTMLElement>('[data-widget]')].map(w => {
        const p = w.dataset, r = w.getBoundingClientRect()
        return { id: p.widget!, x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h),
          pixels: { x: r.x - origin.x - 9, y: r.y - origin.y - 9, width: r.width, height: r.height } }
      }) }
  })
  const result = { ...observed, snapshot: { ...source, columns: observed.columns, rows: observed.rows,
    placements: observed.placements.map(p => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, preferred: { ...source.placements.find(q => q.id === p.id)!.preferred } })) } }
  assertSafe(source, result)
  for (const p of rectangles(result)) {
    const actual = observed.placements.find(q => q.id === p.id)!.pixels
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(actual[key] - p[key]) < .05, `rendered ${p.id}/${key}`)
  }
  return { width: result.width, height: result.height, snapshot: result.snapshot, metrics: result.metrics }
}
async function observeWrites(page: Page) {
  await page.evaluate(key => {
    const original = Storage.prototype.setItem
    document.documentElement.dataset.layoutWrites = '0'
    Storage.prototype.setItem = function (name, value) {
      if (name === key) document.documentElement.dataset.layoutWrites = String(Number(document.documentElement.dataset.layoutWrites) + 1)
      return original.call(this, name, value)
    }
  }, GRID_KEY)
}
async function noWrites(page: Page, bytes: string | null) {
  assert.equal(await page.locator('html').getAttribute('data-layout-writes'), '0', 'viewport adaptation must never write layout storage')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), bytes)
}
export async function compositionSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>,
  importDraft: (page: Page, source: GridSnapshot) => Promise<void>) {
  const evidence: unknown[] = [], suffix = `${process.argv.includes('--dev') ? '-dev' : ''}${process.argv.includes('--scale125') ? '-125' : ''}`
  for (const [name, fixture] of Object.entries(COMPOSITIONS)) for (const theme of ['dark', 'light'] as const) {
    const source = { ...structuredClone(fixture), theme }, draft = theme === 'light'
    await resizeWindow(1480, 980)
    // Seed only this smoke's disposable profile. Draft mode has a different committed composition.
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: GRID_KEY, value: JSON.stringify(draft ? { ...DEFAULT_GRID, theme } : source) })
    await page.reload(); await page.getByTestId('edit-layout').waitFor()
    if (draft) await importDraft(page, source)
    const bytes = await page.evaluate(key => localStorage.getItem(key), GRID_KEY)
    await observeWrites(page)
    const initial = await sample(page, source), samples = [initial]
    for (const [w, h] of [[1150, 795], [1151, 795], [1152, 795], [1340, 916], [1340, 917], [1340, 918], [1800, 720], [0, 0], [1480, 980]]) {
      await resizeWindow(w!, h!); const next = await sample(page, source), previous = samples.at(-1)!
      if (Math.max(Math.abs(previous.width - next.width), Math.abs(previous.height - next.height)) <= 2) assertContinuous(previous, next)
      samples.push(next); await noWrites(page, bytes)
    }
    assert.deepEqual(samples.at(-1), initial, 'native/maximize A→B→A without drift')
    for (const [name, direction] of [['Largura da Sidebar', -1], ['Altura da Bottom', -1]] as const) {
      const separator = page.getByRole('separator', { name }), box = await separator.boundingBox(); assert.ok(box)
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, before = await sample(page, source)
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      let previous = before
      for (const offset of [1, 2, 3, 4, 3, 2, 1, 0]) {
        await page.mouse.move(point.x + (name === 'Largura da Sidebar' ? direction * offset : 0), point.y + (name === 'Altura da Bottom' ? direction * offset : 0))
        const next = await sample(page, source); assertContinuous(previous, next); samples.push(next); previous = next
      }
      await page.mouse.up(); assert.deepEqual(await sample(page, source), before, 'splitter reversal without drift'); await noWrites(page, bytes)
    }
    if (name === 'left') await page.screenshot({ path: `.local/diagnostics/composition-${theme}${suffix}.png` })
    evidence.push({ name, theme, mode: draft ? 'active draft' : 'saved', sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
      devicePixelRatio: await page.evaluate(() => devicePixelRatio), source, samples: samples.map(s => ({ ...s, pixels: rectangles(s) })),
      adjacentChanges: samples.slice(1).map((s, i) => changes(samples[i]!, s)), layoutWrites: 0 })
    if (draft) {
      await page.getByTestId('cancel-layout').click(); await sample(page, { ...DEFAULT_GRID, theme }); await noWrites(page, bytes)
    } else {
      await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.deepEqual(await sample(page, source), initial, 'cold render equals warm renderer')
    }
  }
  // At wide/short bounds, direct reflow can relax a chain minimum. It must not reproject itself.
  await resizeWindow(1800, 720); await importDraft(page, COMPOSITIONS.left)
  const plane = await sample(page, COMPOSITIONS.left), p = plane.snapshot.placements.find(q => q.id === 'summary')!, cs = constraintsFor(plane.snapshot)
  const direct = reflow(plane.snapshot.placements, p.id, resizeRect(p, 0, 1, 's', plane.snapshot, cs[p.id]!), plane.snapshot, cs, 's')
  assert.equal(direct.status, 'valid')
  const south = page.locator('[data-widget="summary"] [data-resize="s"]'), handle = await south.boundingBox(); assert.ok(handle)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + plane.metrics.pitch); await frame(page)
  const directSource = { ...plane.snapshot, placements: direct.placements }
  assert.deepEqual((await sample(page, directSource)).snapshot, directSource, 'gesture cannot change its own row count')
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.deepEqual(await sample(page, COMPOSITIONS.left), plane, 'cancel restores source and its reference measurement')
  await south.focus(); await page.keyboard.press('ArrowDown'); await frame(page)
  assert.deepEqual((await sample(page, directSource)).snapshot, directSource, 'keyboard has the same direct plane')
  const directSamples = [await sample(page, directSource)]
  for (const w of [1801, 1802, 1801, 1800]) {
    await resizeWindow(w, 720); const next = await sample(page, directSource)
    assertContinuous(directSamples.at(-1)!, next); directSamples.push(next)
  }
  evidence.push({ name: 'recent constrained direct resize', source: directSource,
    sourceHash: createHash('sha256').update(JSON.stringify(directSource)).digest('hex'),
    reference: { width: plane.width, height: plane.height, pitch: plane.metrics.pitch },
    samples: directSamples.map(s => ({ ...s, pixels: rectangles(s) })) })
  await observeWrites(page); const planeBytes = await page.evaluate(key => localStorage.getItem(key), GRID_KEY)
  await resizeWindow(1280, 740); await sample(page, directSource); await resizeWindow(1800, 720)
  assert.deepEqual((await sample(page, directSource)).snapshot, directSource); await noWrites(page, planeBytes)
  await page.getByTestId('save-layout').click()
  const storedPlane = await page.evaluate(key => localStorage.getItem(key), GRID_KEY); assert.ok(storedPlane)
  assert.deepEqual(parseGrid(storedPlane).placements, directSource.placements, 'Save commits visible direct coordinates, not a different projection')
  assert.deepEqual(Object.keys(JSON.parse(storedPlane)).sort(), ['columns', 'placements', 'rows', 'schemaVersion', 'theme'], 'no edit reference enters v2 storage')
  const committed = await sample(page, directSource)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.deepEqual(await sample(page, directSource), committed, 'saved source has identical cold/warm adaptation')
  // Recent deliberate edits become the stable source; expectations use the unchanged direct solver.
  await resizeWindow(1480, 980); await importDraft(page, COMPOSITIONS.edited)
  let source = (await sample(page, COMPOSITIONS.edited)).snapshot
  await observeWrites(page); const raw = await page.evaluate(key => localStorage.getItem(key), GRID_KEY)
  for (const kind of ['move', 'e'] as const) {
    const p = source.placements.find(q => q.id === 'library')!, cs = constraintsFor(source)
    const candidate = kind === 'move' ? moveRect(p, 1, 0, source) : resizeRect(p, 1, 0, kind, source, cs[p.id]!)
    const expected = reflow(source.placements, p.id, candidate, source, cs, kind); assert.equal(expected.status, 'valid')
    const target = page.locator(`[data-widget="library"] ${kind === 'move' ? '.widget-grip' : '[data-resize="e"]'}`)
    await target.focus(); await page.keyboard.press('ArrowRight'); await frame(page)
    if (expected.status !== 'valid') throw new Error('Expected valid direct edit')
    source = { ...source, placements: expected.placements }
    assert.deepEqual((await sample(page, source)).snapshot, source, 'direct edit remains exactly the approved reflow result')
  }
  const edited = await sample(page, source)
  await resizeWindow(1150, 795); await sample(page, source); await resizeWindow(1480, 980)
  assert.deepEqual(await sample(page, source), edited); await noWrites(page, raw)
  // Native resize while captured cancels to the recent source, without storing the transient frame.
  const grip = page.locator('[data-widget="library"] .widget-grip'), box = await grip.boundingBox(); assert.ok(box)
  await grip.evaluate(e => e.addEventListener('pointerdown', event => { (e as HTMLElement).dataset.captured = String((event as PointerEvent).pointerId) }, { once: true }))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
  assert.ok(await grip.evaluate(e => e.hasPointerCapture(Number((e as HTMLElement).dataset.captured))))
  await page.mouse.move(box.x + box.width / 2 + edited.metrics.pitch, box.y + box.height / 2); await frame(page)
  await resizeWindow(1280, 740); await sample(page, source)
  assert.equal(await grip.evaluate(e => e.hasPointerCapture(Number((e as HTMLElement).dataset.captured))), false)
  await page.mouse.up(); await resizeWindow(1480, 980); assert.deepEqual(await sample(page, source), edited); await noWrites(page, raw)
  await page.getByTestId('save-layout').click()
  const saved = await page.evaluate(key => localStorage.getItem(key), GRID_KEY); assert.ok(saved)
  assert.deepEqual(parseGrid(saved).placements, source.placements)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.deepEqual((await sample(page, source)).snapshot.placements, source.placements)
  await writeFile(`.local/diagnostics/composition-smoke${suffix}.json`, JSON.stringify(evidence, null, 2))
  // Restore the expected fixture for the existing plugin/security/restart smoke that follows.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: GRID_KEY, value: JSON.stringify(DEFAULT_GRID) })
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  console.log(JSON.stringify({ result: 'passed', subsystem: 'composition continuity', cases: evidence.length, devicePixelRatio: await page.evaluate(() => devicePixelRatio),
    checks: ['independent rendered rectangles/order/gaps/minima/centering', 'saved and draft/both themes', 'native fine steps/maximize/restore', 'splitter one-pixel forward/back', 'zero layout writes', 'cold/warm', 'recent direct edits unchanged', 'native resize during capture', 'Save/reload'] }))
}
