import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { CONSTRAINTS, DEFAULT_FREEFORM, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'
import { DIRECTIONS } from '../src/shared/freeform/types.ts'
import { validLayout } from '../src/shared/freeform/geometry.ts'
import { constraintsFor } from '../src/shared/freeform/policy.ts'
import type { Placement, Surface } from '../src/shared/freeform/types.ts'
import { dimensions, drag, expansion, preview, rect, resizeRegion } from './freeform-smoke.ts'

const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) <= .06, `${label}: ${a} != ${b}`)
type Frame = { time: number; logical: number[]; dom: number[]; port: number[]; style: string[]; peers: Placement[]; surface: Surface; solve?: unknown }
type TraceWindow = Window & { anchorTrace: { running: boolean; frames: Frame[] } }
async function trace(page: Page, id: string) {
  await page.evaluate(id => {
    performance.clearMeasures('geppio:anchor-solve'); performance.mark('geppio:anchors')
    const state = { running: true, frames: [] as Frame[] }; (window as unknown as TraceWindow).anchorTrace = state
    const frame = (time: number) => {
      const e = document.querySelector<HTMLElement>(`[data-widget="${id}"]`)!, r = e.getBoundingClientRect()
      const port = document.querySelector<HTMLElement>(`[data-surface="${e.dataset.ownerRegion}"]`)!, p = port.getBoundingClientRect()
      const region = e.dataset.ownerRegion as Placement['region']
      const peers = [...document.querySelectorAll<HTMLElement>(`[data-owner-region="${region}"]`)].map(e => ({
        id: e.dataset.widget!, region, x: Number(e.dataset.x), y: Number(e.dataset.y), width: Number(e.dataset.w), height: Number(e.dataset.h),
        preferred: { width: Number(e.dataset.preferredW), height: Number(e.dataset.preferredH) } }))
      state.frames.push({ time, logical: [Number(e.dataset.x), Number(e.dataset.y), Number(e.dataset.w), Number(e.dataset.h)],
        dom: [r.left, r.top, r.right, r.bottom], port: [p.left, p.top, port.clientWidth, port.clientHeight, port.scrollLeft, port.scrollTop],
        peers, surface: { region, width: port.clientWidth, height: port.clientHeight,
          expanded: document.querySelector('[data-testid="layout-canvas"]')!.getAttribute('data-expanded') === 'true' && region === 'main' },
        style: [e.style.left, e.style.top, e.style.width, e.style.height, e.style.clipPath],
        solve: (performance.getEntriesByName('geppio:anchor-solve').at(-1) as PerformanceMeasure | undefined)?.detail })
      if (state.running) requestAnimationFrame(frame)
    }; requestAnimationFrame(frame)
  }, id)
  await settle(page)
}
async function stopTrace(page: Page) {
  return page.evaluate(() => { const state = (window as unknown as TraceWindow).anchorTrace; state.running = false; performance.clearMarks('geppio:anchors'); return state.frames })
}
function anchored(frames: Frame[], direction: string) {
  assert.ok(frames.length >= 4, 'Actual intermediate animation frames are required')
  const edges = (f: Frame) => { const [x, y, w, h] = f.logical as [number, number, number, number]; return [x, y, x + w, y + h] }
  const fixed = [!direction.includes('w'), !direction.includes('n'), !direction.includes('e'), !direction.includes('s')]
  for (const f of frames) assert.ok(validLayout(f.peers, f.surface, constraintsFor(f.surface)), `${direction}: every displayed intermediate layout satisfies constraints`)
  for (const f of frames) fixed.forEach((check, i) => {
    if (!check) return
    near(edges(f)[i]!, edges(frames[0]!)[i]!, `logical ${direction} edge ${i}`)
    // Scrolling moves screen edges intentionally; compare in the scroll owner's coordinate space.
    const axis = i % 2
    near(f.dom[i]! + f.port[4 + axis]! - f.port[axis]!, frames[0]!.dom[i]! + frames[0]!.port[4 + axis]! - frames[0]!.port[axis]!, `DOM ${direction} edge ${i}`)
  })
}
async function layouts(page: Page) {
  return page.locator('[data-widget]').evaluateAll(es => es.map(e => {
    const d = (e as HTMLElement).dataset
    return [d.widget, d.ownerRegion, d.x, d.y, d.w, d.h, d.preferredW, d.preferredH]
  }))
}

/** Real pointer captures and per-RAF DOM evidence; all state belongs to the disposable profile. */
export async function freeformCorrectionSmoke(page: Page, dev: boolean, resizeWindow: (w: number, h: number) => Promise<void>) {
  let requestedWidth = 1600, requestedHeight = 1100
  for (let i = 0; i < 5; i++) {
    await resizeWindow(requestedWidth, requestedHeight); await settle(page)
    const available = await dimensions(page)
    if (Math.abs(available.width - 960) <= 1 && Math.abs(available.height - 620) <= 1) break
    requestedWidth += 960 - available.width; requestedHeight += 620 - available.height
  }
  const evidence: unknown[] = [], size = await dimensions(page)
  assert.ok(Math.abs(size.width - 960) <= 1 && Math.abs(size.height - 620) <= 1, 'Owner-like tight default composition')
  const source = structuredClone(DEFAULT_FREEFORM); source.reference.main = size
  const errors: string[] = []
  // Default Properties/Queue/Library/Activity composition; near-contact intermediate
  // widths used to trigger projection even at its exact reference dimensions.
  for (const direction of DIRECTIONS) {
    await preview(page, source)
    const before = await rect(page, 'properties')
    const handle = page.locator(`[data-widget="properties"] [data-resize="${direction}"]`), box = await handle.boundingBox(); assert.ok(box)
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y); await page.mouse.down(); await trace(page, 'properties')
    for (const delta of [1, 4.25, 9.125, 30.5, 80, 5000, 9.125, 0]) {
      await page.mouse.move(x + (/w/.test(direction) ? -delta : /e/.test(direction) ? delta : 0), y + (/n/.test(direction) ? -delta : /s/.test(direction) ? delta : 0))
      await settle(page)
    }
    await page.mouse.up(); await settle(page)
    const frames = await stopTrace(page)
    evidence.push({ direction, before, frames })
    await writeFile(`.local/diagnostics/freeform-anchor-${direction}-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify({ before, frames }, null, 2))
    try { anchored(frames, direction) } catch (error) { errors.push(String(error)) }
    const after = await rect(page, 'properties'); near(after.x, before.x, 'reversal x'); near(after.y, before.y, 'reversal y')
    near(after.width, before.width, 'reversal width'); near(after.height, before.height, 'reversal height')
    // A released resize followed by a separate gesture must retain the anchored origin.
    await drag(page, 'properties', direction, /w/.test(direction) ? -4.25 : /e/.test(direction) ? 4.25 : 0, /n/.test(direction) ? -4.25 : /s/.test(direction) ? 4.25 : 0)
  }
  await writeFile(`.local/diagnostics/freeform-anchor-trace-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify({ toleranceCSSPixels: .06, evidence, errors }, null, 2))
  assert.deepEqual(errors, [], 'Anchors must hold on every intermediate RAF')

  await expansion(page, true)
  const transition = structuredClone(DEFAULT_FREEFORM); transition.reference.main = await dimensions(page)
  let rowX = 0
  transition.placements = transition.placements.map(p => {
    if (p.id === 'properties') return { ...p, x: 137.25, y: 83.125, width: 300, height: 200, preferred: { width: 300, height: 200 } }
    if (p.id === 'queue') return { ...p, x: 447.25, y: 83.125, width: transition.reference.main.width - 447.25, height: 200, preferred: { width: transition.reference.main.width - 447.25, height: 200 } }
    const width = CONSTRAINTS[p.id]!.min.width, q = { ...p, x: rowX, y: 410, width, height: 200, preferred: { width, height: 200 } }
    rowX += width + 10; return q
  })
  await preview(page, transition)
  const east = await page.locator('[data-widget="properties"] [data-resize="e"]').boundingBox(); assert.ok(east)
  const ex = east.x + east.width / 2, ey = east.y + east.height / 2
  await page.mouse.move(ex, ey); await page.mouse.down(); await trace(page, 'properties')
  for (const delta of [1, 9.125, 40, 200, 500, 9.125, 0]) { await page.mouse.move(ex + delta, ey); await settle(page) }
  await page.mouse.up(); await settle(page)
  const transitionFrames = await stopTrace(page)
  await writeFile(`.local/diagnostics/freeform-scroll-anchor-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(transitionFrames, null, 2))
  anchored(transitionFrames, 'e')
  assert.ok(new Set(transitionFrames.map(f => f.port[3])).size > 1, 'Real native horizontal scrollbar transition')
  await drag(page, 'properties', 'e', 400, 0)
  await trace(page, 'properties')
  await drag(page, 'properties', 'e', -400, 0)
  const releaseFrames = await stopTrace(page)
  await writeFile(`.local/diagnostics/freeform-scroll-release-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(releaseFrames, null, 2))
  anchored(releaseFrames, 'e')
  await resizeWindow(1600, 1100); await settle(page)
  const contraction = structuredClone(transition); contraction.reference.main = await dimensions(page)
  rowX = 0
  contraction.placements = contraction.placements.map(p => {
    if (p.id === 'properties') return p
    const width = CONSTRAINTS[p.id]!.min.width, q = { ...p, x: rowX, y: 400, width, height: 200, preferred: { width, height: 200 } }
    rowX += width + 10; return q
  })
  await preview(page, contraction)
  await trace(page, 'properties')
  await drag(page, 'properties', 'e', 1800, 0)
  const growthFrames = await stopTrace(page); anchored(growthFrames, 'e')
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = e.scrollWidth }); await settle(page)
  await trace(page, 'properties'); await drag(page, 'properties', 'e', -1800, 0)
  const contractionFrames = await stopTrace(page)
  await writeFile(`.local/diagnostics/freeform-scroll-contraction-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(contractionFrames, null, 2))
  anchored(contractionFrames, 'e')
  assert.ok(new Set(contractionFrames.map(f => f.port[3])).size > 1, 'Pointerup actually removes scrollbar')
  const stack = structuredClone(source), height = (await dimensions(page)).height
  stack.reference.main = await dimensions(page)
  stack.placements = stack.placements.map((p, i) => ({ ...p, x: 1500 + i * 450, y: 0 }))
  stack.placements[6] = { ...stack.placements[6]!, x: 0, y: 0, width: 220, height: 200, preferred: { width: 220, height: 200 } }
  stack.placements[0] = { ...stack.placements[0]!, x: 0, y: 210, width: 220, height: height - 210, preferred: { width: 220, height: height - 210 } }
  for (const kind of ['move', 's'] as const) {
    await preview(page, stack)
    const original = await layouts(page), bytes = await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY)
    const grip = page.locator(`[data-widget="chart"] ${kind === 'move' ? '.widget-grip' : '[data-resize="s"]'}`), b = await grip.boundingBox(); assert.ok(b)
    const x = b.x + b.width / 2, y = b.y + b.height / 2
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 37.375); await settle(page)
    assert.ok((await rect(page, 'summary')).height < height - 210)
    await page.mouse.move(x, y); await settle(page)
    assert.deepEqual((await layouts(page)).map(p => p.slice(0, 6)), original.map(p => p.slice(0, 6)), 'Held reversal restores all actual geometry; projected preferences use the current baseline')
    await page.mouse.move(x, y + 37.375); await page.mouse.up(); await settle(page)
    const completed = await layouts(page), compressed = await rect(page, 'summary')
    await drag(page, 'chart', kind, 0, -37.375)
    near((await rect(page, 'summary')).height, compressed.height, 'Second gesture retains settled compression')
    near((await rect(page, 'summary')).y, compressed.y, 'Second gesture retains settled displacement')
    const second = await layouts(page)
    await drag(page, 'chart', kind, 0, 10, true); assert.deepEqual(await layouts(page), second, 'Escape cancels only third gesture')
    const now = await grip.boundingBox(); assert.ok(now)
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2); await page.mouse.down()
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2 + 10); await settle(page)
    await grip.evaluate(e => { if (!e.hasPointerCapture(1)) throw new Error('No capture'); e.releasePointerCapture(1) })
    await page.mouse.up(); await settle(page); assert.deepEqual(await layouts(page), second, 'Lost capture retains completed gestures')
    const cancelBox = await grip.boundingBox(); assert.ok(cancelBox)
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2); await page.mouse.down()
    await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2 + 10); await settle(page)
    await grip.evaluate(e => e.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })))
    await page.mouse.up(); await settle(page); assert.deepEqual(await layouts(page), second, 'Pointercancel retains completed gestures')
    assert.notDeepEqual(completed, original)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), bytes, 'Pointer release never persists')
    await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor()
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
    near((await rect(page, 'summary')).height, compressed.height, 'Save/reload keeps settled size')
  }
  // Existing v1 preferred != actual must remain readable but cannot revive stale size.
  const legacy = structuredClone(stack); legacy.reference.main = await dimensions(page)
  legacy.placements[0]!.height = legacy.reference.main.height - 250; legacy.placements[0]!.y = 250
  await page.getByTestId('edit-layout').waitFor()
  await page.evaluate(({ key, source }) => localStorage.setItem(key, JSON.stringify(source)), { key: FREEFORM_KEY, source: legacy })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await page.getByTestId('edit-layout').click()
  const legacyBaseline = await layouts(page), oldSize = await rect(page, 'summary'); await drag(page, 'chart', 'move', 30, 0)
  near((await rect(page, 'summary')).height, oldSize.height, 'Legacy preference cannot revive')
  await page.getByTestId('cancel-layout').click()
  assert.deepEqual(await layouts(page), legacyBaseline, 'Global Cancel restores persisted composition after independent actions')

  await preview(page, stack)
  const controls = page.locator('.widget-grip, .resize-zone')
  assert.ok((await controls.evaluateAll(es => es.map(e => (e as HTMLElement).tabIndex))).every(n => n === (dev ? 0 : -1)))
  const chartGrip = page.locator('[data-widget="chart"] .widget-grip'), beforeKeyboard = await rect(page, 'chart')
  await chartGrip.focus(); await page.keyboard.press('ArrowRight'); await settle(page)
  near((await rect(page, 'chart')).x, beforeKeyboard.x + (dev ? 1 : 0), 'Verified renderer keyboard capability')
  await preview(page, stack)
  const handle = page.locator('[data-widget="chart"] [data-resize="s"]')
  const keyboardNeighbor = await rect(page, 'summary')
  await handle.focus(); await page.keyboard.press('Shift+ArrowDown'); await settle(page)
  const compressedKeyboard = await rect(page, 'summary')
  await writeFile(`.local/diagnostics/freeform-keyboard-${dev ? 'dev' : 'production'}.json`, JSON.stringify({ height, beforeKeyboard, keyboardNeighbor, compressedKeyboard,
    chart: await rect(page, 'chart'), feedback: await page.locator('.workspace-feedback').textContent(), focused: await page.evaluate(() => document.activeElement?.outerHTML) }, null, 2))
  await page.keyboard.press('Shift+ArrowUp'); await settle(page)
  near((await rect(page, 'summary')).height, compressedKeyboard.height, 'Discrete dev actions settle')
  if (dev) assert.ok(compressedKeyboard.height < keyboardNeighbor.height)
  if (!dev) assert.equal(await handle.evaluate(e => getComputedStyle(e).outlineStyle), 'none')
  const keyboardSource = structuredClone(source); keyboardSource.reference.main = await dimensions(page)
  for (const direction of DIRECTIONS) {
    await preview(page, keyboardSource)
    const handle = page.locator(`[data-widget="properties"] [data-resize="${direction}"]`), before = await rect(page, 'properties')
    await page.keyboard.press('Tab')
    await handle.focus()
    assert.equal(await handle.evaluate(e => getComputedStyle(e).outlineStyle !== 'none'), dev, 'Focus indicator follows build capability')
    for (const key of [/w/.test(direction) ? 'ArrowLeft' : /e/.test(direction) ? 'ArrowRight' : null, /n/.test(direction) ? 'ArrowUp' : /s/.test(direction) ? 'ArrowDown' : null]) {
      if (key) await page.keyboard.press('Shift+' + key)
    }
    const after = await rect(page, 'properties')
    near(after.width, before.width + (dev && /[ew]/.test(direction) ? 10 : 0), `${direction} keyboard width`)
    near(after.height, before.height + (dev && /[ns]/.test(direction) ? 10 : 0), `${direction} keyboard height`)
  }
  if (dev) {
    await preview(page, source)
    const grip = page.locator('[data-widget="properties"] .widget-grip'), before = await rect(page, 'properties')
    await grip.evaluate(e => {
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    near((await rect(page, 'properties')).x, before.x + 2, 'Batched discrete keyboard actions use successive drafts')
  }
  // Real inputs and normal tabbing retain native focus/typing in both builds.
  await preview(page, source)
  const input = page.getByRole('textbox', { name: 'Nome de exemplo', exact: true })
  await input.focus(); await page.keyboard.type('normal'); await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.matches('.widget-grip, .resize-zone')), dev)
  await input.focus(); await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT')
  // The same boundaries apply to the axes allowed in the peer regions.
  await resizeRegion(page, 'sidebar', 290); await resizeRegion(page, 'bottom', 180)
  for (const region of ['sidebar', 'bottom'] as const) for (const kind of region === 'sidebar' ? ['move', 'n', 's'] : ['move', 'w', 'e']) {
    const available = await page.locator(`[data-surface="${region}"]`).evaluate(e => ({ width: e.clientWidth, height: e.clientHeight }))
    const fixture = structuredClone(DEFAULT_FREEFORM); fixture.reference.main = await dimensions(page)
    const vertical = region === 'sidebar', negative = kind === 'n' || kind === 'w'
    fixture.reference[region] = { ...available, height: vertical ? Math.max(available.height, 650) : available.height }
    fixture.placements = fixture.placements.map(p => {
      if (!['summary', 'chart'].includes(p.id)) return p
      const active = p.id === 'chart', at = negative ? active ? 410 : 0 : active ? 0 : 210
      const span = active ? 200 : negative ? 400 : vertical ? 400 : available.width - 210
      return { ...p, region, x: vertical ? 0 : at, y: vertical ? at : 0,
        width: vertical ? available.width : span, height: vertical ? span : available.height,
        preferred: { width: vertical ? available.width : span, height: vertical ? span : available.height } }
    })
    await preview(page, fixture)
    if (vertical) {
      await page.evaluate(kind => {
        const owner = document.querySelector<HTMLElement>('[data-region="sidebar"]')!, port = document.querySelector('[data-surface="sidebar"]')!
        const active = document.querySelector<HTMLElement>('[data-widget="chart"]')!, y = Number(active.dataset.y), h = Number(active.dataset.h)
        owner.scrollTop += port.getBoundingClientRect().top + y + (kind === 'n' ? 0 : kind === 's' ? h : 16) - owner.getBoundingClientRect().top - owner.clientHeight / 2
      }, kind)
      await settle(page); await settle(page)
    }
    const old = await rect(page, 'chart')
    if (kind !== 'move') await trace(page, 'chart')
    const delta = negative ? -30 : 30
    await drag(page, 'chart', kind, vertical ? 0 : delta, vertical ? delta : 0)
    const changed = await rect(page, 'chart')
    assert.ok((['x', 'y', 'width', 'height'] as const).some(key => changed[key] !== old[key]), `${region} ${kind}: active geometry must change`)
    if (kind !== 'move') {
      const frames = await stopTrace(page)
      await writeFile(`.local/diagnostics/freeform-region-${region}-${kind}-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(frames, null, 2))
      anchored(frames, kind)
    }
    const neighbor = await rect(page, 'summary')
    await drag(page, 'chart', kind, vertical ? 0 : -delta, vertical ? -delta : 0)
    const after = await rect(page, 'summary')
    near(after.x, neighbor.x, `${region} ${kind} settled x`); near(after.y, neighbor.y, `${region} ${kind} settled y`)
    near(after.width, neighbor.width, `${region} ${kind} settled width`); near(after.height, neighbor.height, `${region} ${kind} settled height`)
    const active = await rect(page, 'chart')
    near(vertical ? active.width : active.height, vertical ? old.width : old.height, `${region} cross axis`)
  }
  await page.getByTestId('cancel-layout').click(); await expansion(page, false)
  await preview(page, DEFAULT_FREEFORM); await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor()
  await resizeRegion(page, 'sidebar', 230); await resizeRegion(page, 'bottom', 120)
  console.log(`PASS correction: per-RAF eight anchors, gesture settlement/cancellation/reload, ${dev ? 'development keyboard' : 'production pointer/native focus'}`)
}
