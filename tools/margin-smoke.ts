import { reloadResponsive } from './layout-mode-smoke.ts'
/** Coverage and operation-history checks on the desktop caller's disposable profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { DEFAULT_GRID, GRID_KEY, constraintsFor } from '../src/shared/grid/policy.ts'
import { moveRect } from '../src/shared/grid/geometry.ts'
import { projectGrid } from '../src/shared/grid/projection.ts'
import type { GridViewport } from '../src/shared/grid/projection.ts'
import { reflow } from '../src/shared/grid/reflow.ts'
import { parseGrid } from '../src/shared/grid/schema.ts'
import { COMPOSITIONS } from '../tests/fixtures/grid-compositions.ts'
import { rectangles } from '../tests/helpers/projection-oracle.ts'
import type { ProjectionSample } from '../tests/helpers/projection-oracle.ts'
import { noWrites, observeWrites, sample } from './composition-smoke.ts'

export async function marginSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>) {
  const evidence: unknown[] = [], suffix = `${process.argv.includes('--dev') ? '-dev' : ''}${process.argv.includes('--scale125') ? '-125' : ''}`
  for (const name of ['left', 'mirrored', 'dense', 'gaps'] as const) for (const theme of ['dark', 'light'] as const) {
    let source = { ...structuredClone(COMPOSITIONS[name]), theme }, reference: GridViewport | null = null
    let bytes = JSON.stringify(source)
    const seen = new Map<string, ProjectionSample>()
    await resizeWindow(1480, 980)
    await page.evaluate(({ key, value, theme }) => { localStorage.setItem(key, value); localStorage.setItem('geppio:theme:v1', theme) }, { key: GRID_KEY, value: bytes, theme })
    await reloadResponsive(page); await observeWrites(page)
    async function read(label: string) {
      const s = await sample(page, source), m = s.metrics
      const diagnostics = await page.getByTestId('layout-canvas').evaluate(e => {
        const d = (e as HTMLElement).dataset
        return { requestedPitch: Number(d.requestedPitch), reference: d.editWidth
          ? { width: Number(d.editWidth), height: Number(d.editHeight), pitch: Number(d.editPitch) } : null }
      })
      assert.deepEqual(diagnostics.reference, reference)
      // Independent coverage bound, in addition to source order/minima/pixel checks in sample().
      // A count cap can make larger margins unavoidable; the explicit 22x11 witness is tested purely.
      if (s.snapshot.columns < 24) assert.ok(s.width - m.width < m.pitch + .05, 'avoidable side band')
      if (s.snapshot.rows < 24) assert.ok(s.height - m.height < m.pitch + .05, 'avoidable vertical band')
      const cold = projectGrid(structuredClone(source), s.width, s.height, reference && { ...reference })
      assert.deepEqual(s.snapshot, cold.snapshot, 'identical source/reference/dimensions must agree with cold geometry')
      for (const k of Object.keys(m) as (keyof typeof m)[]) assert.ok(Math.abs(m[k] - cold.metrics[k]) < 1e-8, `cold ${k}`)
      const sourceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex')
      const key = JSON.stringify([sourceHash, reference, s.width, s.height])
      if (seen.has(key)) assert.deepEqual(s, seen.get(key), 'repeated window/Edit journey must not accumulate margins')
      else seen.set(key, s)
      evidence.push({ name, theme, label, sourceHash, source, reference, width: s.width, height: s.height,
        columns: s.snapshot.columns, rows: s.snapshot.rows, requestedPitch: diagnostics.requestedPitch, renderedPitch: m.pitch,
        gridWidth: m.width, gridHeight: m.height, margins: { left: m.left, right: s.width - m.width - m.left, top: m.top, bottom: s.height - m.height - m.top },
        logical: s.snapshot.placements, pixels: rectangles(s), layoutWrites: 0 })
      await noWrites(page, bytes)
      return s
    }
    async function journey(label: string) {
      for (const [w, h, state] of [[1480, 980, 'restored'], [0, 0, 'maximized'], [1480, 980, 'restored again'],
        [1700, 980, 'horizontal resize'], [0, 0, 'resized then maximized'], [1700, 980, 'restore resized'], [1480, 980, 'original']] as const) {
        await resizeWindow(w, h); await read(`${label}/${state}`)
      }
    }
    const original = await read('saved initial')
    await journey('saved cycle 1'); await journey('saved cycle 2')
    await page.getByTestId('edit-layout').click()
    source = original.snapshot; reference = { width: original.width, height: original.height, pitch: original.metrics.pitch }
    await read('Edit entry'); await journey('Edit cycle 1'); await journey('Edit cycle 2')
    if (name === 'left') await page.screenshot({ path: `.local/diagnostics/margins-edit-${theme}${suffix}.png` })
    await page.getByTestId('cancel-layout').click(); source = { ...structuredClone(COMPOSITIONS[name]), theme }; reference = null
    assert.deepEqual(await read('Cancel'), original)
    // Different legal region requests change measured Main independently of native window bounds.
    for (const [separator, grow, shrink] of [['Largura da Sidebar', 'Shift+ArrowRight', 'Shift+ArrowLeft'], ['Altura da Bottom', 'Shift+ArrowUp', 'Shift+ArrowDown']]) {
      await page.getByRole('separator', { name: separator }).focus(); await page.keyboard.press(grow!)
      await read(`region ${separator}`); await journey(`region ${separator}`)
      await page.getByRole('separator', { name: separator }).focus(); await page.keyboard.press(shrink!); await read(`region ${separator} restore`)
    }
    if (name === 'left') {
      // Place a widget at the logical right edge using the unchanged pointer solver; left edge is occupied.
      const plane = await read('before edge placement')
      await page.getByTestId('edit-layout').click(); source = plane.snapshot
      reference = { width: plane.width, height: plane.height, pitch: plane.metrics.pitch }
      const p = source.placements.find(q => q.id === 'chart')!, cs = constraintsFor(source)
      const expected = reflow(source.placements, p.id, moveRect(p, source.columns, 0, source), source, cs, 'move')
      assert.equal(expected.status, 'valid')
      const grip = page.locator('[data-widget="chart"] .widget-grip'), box = await grip.boundingBox(); assert.ok(box)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + source.columns * plane.metrics.pitch, box.y + box.height / 2); await page.mouse.up()
      source = { ...source, placements: expected.placements }
      const edge = await read('pointer at logical edge')
      assert.deepEqual(edge.snapshot, source, 'approved direct reflow remains the pointer result')
      const chart = rectangles(edge).find(q => q.id === 'chart')!, library = rectangles(edge).find(q => q.id === 'library')!
      assert.ok(Math.abs(chart.x + chart.width - edge.metrics.left - edge.metrics.width) < .05)
      assert.ok(Math.abs(library.x - edge.metrics.left) < .05)
      await page.screenshot({ path: `.local/diagnostics/margins-edges-${theme}${suffix}.png` })
      await journey('recent deliberate edit'); await page.getByTestId('cancel-layout').click()
      source = { ...structuredClone(COMPOSITIONS[name]), theme }; reference = null; await read('deliberate edit Cancel')
      // Repeat a deliberate edit, Save only the visible arrangement, then compare restart/cold geometry.
      const savedPlane = await read('before explicit Save'); await page.getByTestId('edit-layout').click()
      source = savedPlane.snapshot; reference = { width: savedPlane.width, height: savedPlane.height, pitch: savedPlane.metrics.pitch }
      const q = source.placements.find(p => p.id === 'chart')!, limits = constraintsFor(source)
      const moved = reflow(source.placements, q.id, moveRect(q, 1, 0, source), source, limits, 'move')
      assert.equal(moved.status, 'valid')
      await grip.focus(); await page.keyboard.press('ArrowRight'); source = { ...source, placements: moved.placements }
      const visible = await read('keyboard before Save'); assert.deepEqual(visible.snapshot, source)
      await page.getByTestId('save-layout').click(); bytes = (await page.evaluate(key => localStorage.getItem(key), GRID_KEY))!
      assert.deepEqual(parseGrid(bytes), visible.snapshot)
      source = parseGrid(bytes); reference = null; await observeWrites(page)
      const committed = await read('explicit Save'); await journey('after Save')
      await reloadResponsive(page); await observeWrites(page)
      assert.deepEqual(await read('saved reload'), committed)
    }
    await page.screenshot({ path: `.local/diagnostics/margins-${name}-${theme}${suffix}.png` })
  }
  await writeFile(`.local/diagnostics/margin-smoke${suffix}.json`, JSON.stringify({ devicePixelRatio: await page.evaluate(() => devicePixelRatio), samples: evidence }, null, 2))
  await resizeWindow(1480, 980)
  await page.evaluate(({ key, value }) => { localStorage.setItem(key, value); localStorage.setItem('geppio:theme:v1', 'dark') }, { key: GRID_KEY, value: JSON.stringify(DEFAULT_GRID) })
  await reloadResponsive(page)
  console.log(JSON.stringify({ result: 'passed', subsystem: 'Main margin journeys', samples: evidence.length,
    checks: ['saved/Edit source and reference', 'repeated maximize/restore/horizontal resize', 'legal region sizes', 'independent coverage/order/bounds/pixels', 'cold/warm equality', 'zero viewport writes', 'logical edge placement', 'unchanged pointer/keyboard reflow', 'Cancel/Save/reload', 'both themes'] }))
}
