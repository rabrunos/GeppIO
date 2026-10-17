import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { CONSTRAINTS, constraintsFor, DEFAULT_FREEFORM, EXPANSION_KEY, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'
import { validLayout } from '../src/shared/freeform/geometry.ts'
import { DEFAULT_LAYOUT } from '../src/shared/layout-defaults.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { DEFAULT_HORIZONTAL, HORIZONTAL_KEY, serializeHorizontal } from '../src/shared/grid/horizontal.ts'
import { DIRECTIONS } from '../src/shared/freeform/types.ts'
import { projectRegion } from '../src/shared/freeform/projection.ts'
import type { Snapshot } from '../src/shared/freeform/types.ts'

const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click()
  await page.getByTestId('plugin-settings').waitFor()
}
export async function expansion(page: Page, enabled: boolean) {
  await settings(page)
  await page.getByRole('checkbox', { name: 'Ativar expansão horizontal', exact: true }).setChecked(enabled)
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await settle(page)
}
export async function preview(page: Page, snapshot: Snapshot) {
  if (await page.getByTestId('cancel-layout').count()) await page.getByTestId('cancel-layout').click()
  await settings(page)
  await page.locator('input[type="file"]').setInputFiles({ name: 'freeform.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) })
  await page.getByTestId('cancel-layout').waitFor(); await settle(page)
}
export async function rect(page: Page, id: string) {
  return page.locator(`[data-widget="${id}"]`).evaluate(e => {
    const p = (e as HTMLElement).dataset, r = e.getBoundingClientRect()
    return { x: Number(p.x), y: Number(p.y), width: Number(p.w), height: Number(p.h), left: r.left, top: r.top, right: r.right, bottom: r.bottom, region: p.ownerRegion }
  })
}
const near = (actual: number, expected: number, label = '') => assert.ok(Math.abs(actual - expected) < .06, `${label}: ${actual} ≠ ${expected}`)
export async function drag(page: Page, id: string, direction: string, dx: number, dy: number, cancel = false, steps = 3) {
  const element = page.locator(`[data-widget="${id}"] ${direction === 'move' ? '.widget-grip' : `[data-resize="${direction}"]`}`)
  const r = await element.boundingBox(); assert.ok(r)
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  assert.ok(await element.evaluate(e => e.hasPointerCapture(1)), `${id} ${direction}: real pointer capture required: ` + JSON.stringify(await page.evaluate(({ x, y }) => ({
    point: [x, y], hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 200), viewport: [innerWidth, innerHeight],
    scroll: [document.querySelector('.freeform-layer')?.scrollLeft, document.querySelector('.freeform-layer')?.scrollTop],
    feedback: document.querySelector('.workspace-feedback')?.textContent,
    regions: [...document.querySelectorAll<HTMLElement>('[data-surface]')].map(e => ({ ...e.dataset }))
  }), { x, y })))
  await page.mouse.move(x + dx, y + dy, { steps }); await settle(page)
  if (cancel) await page.keyboard.press('Escape')
  else await page.mouse.up()
  if (cancel) await page.mouse.up()
  await settle(page)
}
export async function resizeRegion(page: Page, kind: 'sidebar' | 'bottom', value: number) {
  const splitter = page.getByRole('separator', { name: kind === 'sidebar' ? 'Largura da Sidebar' : 'Altura da Bottom' })
  const old = Number(await splitter.getAttribute('aria-valuenow')), box = await splitter.boundingBox(); assert.ok(box)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + (kind === 'sidebar' ? value - old : 0), y - (kind === 'bottom' ? value - old : 0), { steps: 3 })
  await page.mouse.up(); await settle(page)
}
async function transferSelected(page: Page, id: string, region: string) {
  await page.locator(`[data-widget="${id}"] .widget-grip`).click()
  await page.getByRole('combobox', { name: 'Região do widget selecionado', exact: true }).selectOption(region)
  await settle(page)
}
export async function dimensions(page: Page) {
  return page.locator('[data-surface="main"]').evaluate(e => ({ width: (e as HTMLElement).clientWidth, height: (e as HTMLElement).clientHeight }))
}
async function assertBottomNoScroll(page: Page) {
  const result = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-region="bottom"], [data-surface="bottom"], [data-owner-region="bottom"] .widget-content')].map(e => {
    e.scrollTo(10000, 10000); e.scrollLeft = 10000; e.scrollTop = 10000
    return { x: e.scrollLeft, y: e.scrollTop, width: e.clientWidth, height: e.clientHeight, worldWidth: e.scrollWidth, worldHeight: e.scrollHeight }
  }))
  for (const r of result) {
    assert.equal(r.x, 0); assert.equal(r.y, 0)
    assert.ok(r.worldWidth <= r.width + 1 && r.worldHeight <= r.height + 1, JSON.stringify(r))
  }
}
async function assertGeometry(page: Page) {
  const evidence = await page.evaluate(() => {
    const main = document.querySelector('[data-region="main"]')!.getBoundingClientRect(), port = document.querySelector<HTMLElement>('[data-surface="main"]')!, r = port.getBoundingClientRect()
    return { inset: [r.left - main.left, r.top - main.top, main.right - r.right, main.bottom - r.bottom], width: port.clientWidth, height: port.clientHeight,
      scrollWidth: port.scrollWidth, scrollHeight: port.scrollHeight, status: document.querySelector('.fixed-status-bar')!.getBoundingClientRect().toJSON(), innerHeight,
      viewportBottom: document.querySelector('.workbench')!.getBoundingClientRect().bottom,
      dpr: devicePixelRatio,
      regions: ['sidebar', 'bottom'].map(kind => {
        const region = document.querySelector(`[data-region="${kind}"]`)!.getBoundingClientRect(), divider = document.querySelector(`[aria-label="${kind === 'sidebar' ? 'Largura da Sidebar' : 'Altura da Bottom'}"]`)!
        return { kind, width: region.width, height: region.height, min: Number(divider.getAttribute('aria-valuemin')), max: Number(divider.getAttribute('aria-valuemax')), now: Number(divider.getAttribute('aria-valuenow')) }
      }),
      statusStyle: { border: getComputedStyle(document.querySelector('.fixed-status-bar')!).borderTopWidth,
        background: getComputedStyle(document.querySelector('.fixed-status-bar')!).backgroundColor, bottomBackground: getComputedStyle(document.querySelector('[data-region="bottom"]')!).backgroundColor },
      widgets: [...document.querySelectorAll<HTMLElement>('[data-widget]')].map(e => ({ id: e.dataset.widget!, x: Number(e.dataset.x), y: Number(e.dataset.y), width: Number(e.dataset.w), height: Number(e.dataset.h) })) }
  })
  evidence.inset.forEach(n => near(n, 15, 'single region inset'))
  near(evidence.status.height as number, 15); near(evidence.status.bottom as number, evidence.viewportBottom)
  assert.ok(Number.parseFloat(evidence.statusStyle.border) > 0 && Number.parseFloat(evidence.statusStyle.border) <= 1)
  assert.notEqual(evidence.statusStyle.background, evidence.statusStyle.bottomBackground)
  for (const r of evidence.regions) { near(r.kind === 'sidebar' ? r.width : r.height, r.now); near(r.min, Math.min(r.kind === 'sidebar' ? 230 : 120, r.max)); assert.ok(r.now >= r.min && r.now <= r.max) }
  assert.ok(Math.abs(evidence.viewportBottom - evidence.innerHeight) < 1, 'integer innerHeight can round a fractional CSS viewport at DPR 1.25')
  assert.equal(evidence.scrollWidth, evidence.width); assert.equal(evidence.scrollHeight, evidence.height)
  await assertBottomNoScroll(page)
  for (const [i, p] of evidence.widgets.entries()) {
    const c = CONSTRAINTS[p.id]!
    assert.ok(p.width >= c.min.width && p.height >= c.min.height)
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.width <= evidence.width + .01 && p.y + p.height <= evidence.height + .01)
    for (const q of evidence.widgets.slice(i + 1)) {
      const x = Math.min(p.x + p.width, q.x + q.width) - Math.max(p.x, q.x)
      const y = Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y)
      if (x > .01) assert.ok(y <= -9.99)
      if (y > .01) assert.ok(x <= -9.99)
    }
  }
  return evidence
}

export async function freeformSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>, dev = false) {
  assert.equal(await page.getByTestId('layout-canvas').getAttribute('data-engine'), 'freeform')
  assert.equal(await page.getByTestId('layout-canvas').getAttribute('data-expanded'), 'false')
  const evidence: unknown[] = []
  await page.evaluate(() => {
    const test = window as unknown as { layoutWrites: string[]; originalSet: typeof Storage.prototype.setItem }
    test.layoutWrites = []; test.originalSet = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) { if (/layout:(freeform|grid|horizontal):|layout:v1/.test(key)) test.layoutWrites.push(key); test.originalSet.call(this, key, value) }
  })
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema' }).click()
    for (const [width, height] of [[1280, 900], [1000, 720], [1800, 980], [0, 0], [1280, 900]]) {
      await resizeWindow(width!, height!); await settle(page); evidence.push({ theme, windowWidth: width, windowHeight: height, ...await assertGeometry(page) })
    }
    await page.screenshot({ path: `.local/diagnostics/freeform-chrome-${theme}-${await page.evaluate(() => devicePixelRatio)}.png` })
  }
  // Preserve the existing session-only panel presentations on all four edges.
  const undocked = await dimensions(page)
  for (const presentation of ['overlay', 'docked']) for (const anchor of ['left', 'right', 'top', 'bottom']) {
    await settings(page)
    await page.getByRole('combobox', { name: 'Apresentação do painel', exact: true }).selectOption(presentation)
    await page.getByRole('combobox', { name: 'Borda do painel', exact: true }).selectOption(anchor)
    await page.getByRole('button', { name: 'Abrir painel', exact: true }).click(); await settle(page)
    const withPanel = await dimensions(page)
    if (presentation === 'overlay') assert.deepEqual(withPanel, undocked)
    else if (['left', 'right'].includes(anchor)) assert.ok(withPanel.width < undocked.width)
    else assert.ok(withPanel.height < undocked.height)
    await page.getByRole('button', { name: 'Recolher painel', exact: true }).click(); await settle(page)
    assert.deepEqual(await dimensions(page), undocked)
  }
  const initial = await rect(page, 'chart')
  await page.getByTestId('edit-layout').click(); await drag(page, 'chart', 'move', 13.25, -7.125, true)
  const cancelled = await rect(page, 'chart'); near(cancelled.x, initial.x); near(cancelled.y, initial.y)
  await page.getByTestId('cancel-layout').click()
  // Splitter mouse collapse/reopen restores requested size; keyboard Escape restores a series.
  await resizeRegion(page, 'sidebar', 0)
  await page.getByRole('button', { name: 'Reabrir Sidebar', exact: true }).waitFor()
  assert.equal(await page.locator('[data-region="sidebar"]').isVisible(), false)
  await page.getByRole('button', { name: 'Reabrir Sidebar', exact: true }).click(); await settle(page)
  near(Number(await page.getByRole('separator', { name: 'Largura da Sidebar' }).getAttribute('aria-valuenow')), 230)
  const separator = page.getByRole('separator', { name: 'Altura da Bottom' })
  await separator.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape')
  near(Number(await separator.getAttribute('aria-valuenow')), 120)
  const cancelDivider = await separator.boundingBox(); assert.ok(cancelDivider)
  await page.mouse.move(cancelDivider.x + cancelDivider.width / 2, cancelDivider.y + cancelDivider.height / 2); await page.mouse.down()
  await page.mouse.move(cancelDivider.x + cancelDivider.width / 2, cancelDivider.y + cancelDivider.height / 2 - 20); await settle(page)
  await separator.evaluate(e => { if (!e.hasPointerCapture(1)) throw new Error('Expected divider capture'); e.releasePointerCapture(1) })
  await page.mouse.up(); await settle(page); near(Number(await separator.getAttribute('aria-valuenow')), 120, 'lost divider capture restores size')
  const beforeViewportGesture = await rect(page, 'chart')
  await page.getByTestId('edit-layout').click()
  const viewportGrip = await page.locator('[data-widget="chart"] .widget-grip').boundingBox(); assert.ok(viewportGrip)
  await page.mouse.move(viewportGrip.x + 40, viewportGrip.y + 16); await page.mouse.down()
  await page.mouse.move(viewportGrip.x + 53.25, viewportGrip.y + 16)
  await resizeWindow(1300, 900); await page.mouse.up(); await resizeWindow(1280, 900); await settle(page)
  near((await rect(page, 'chart')).x, beforeViewportGesture.x, 'viewport cancels capture')
  await page.getByTestId('cancel-layout').click()
  await resizeRegion(page, 'bottom', 0)
  near(await page.locator('.fixed-status-bar').evaluate(e => e.getBoundingClientRect().height), 15)
  assert.equal(await page.locator('.fixed-status-bar').evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.width / 2, r.top + 7) === e }), true)
  await page.getByRole('button', { name: 'Reabrir Bottom', exact: true }).click(); await settle(page)
  near(Number(await separator.getAttribute('aria-valuenow')), 120)
  assert.deepEqual(await page.evaluate(() => (window as unknown as { layoutWrites: string[] }).layoutWrites), [])
  await page.evaluate(() => { const t = window as unknown as { originalSet: typeof Storage.prototype.setItem }; Storage.prototype.setItem = t.originalSet })
  await expansion(page, true)
  await page.getByTestId('edit-layout').click()
  const beforeFirstOverflow = await rect(page, 'chart')
  await drag(page, 'chart', 'move', 1100, 0)
  assert.ok((await rect(page, 'chart')).x >= beforeFirstOverflow.x + 1099, 'Adding the first Main scrollbar must not cancel a live gesture')
  await page.getByTestId('cancel-layout').click()
  const sparse = structuredClone(DEFAULT_FREEFORM); sparse.reference.main = await dimensions(page)
  sparse.placements = sparse.placements.map((p, i) => ({ ...p, x: 600 + i * 350, y: 0, width: 260, height: 200, preferred: { width: 260, height: 200 } }))
  sparse.placements[6] = { ...sparse.placements[6]!, x: 137.25, y: 83.125, width: 327.75, height: 246.5, preferred: { width: 327.75, height: 246.5 } }
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema' }).click()
    await preview(page, sparse)
    for (const direction of DIRECTIONS) {
      const before = await rect(page, 'chart')
      const dx = /w/.test(direction) ? -13.25 : /e/.test(direction) ? 13.25 : 0
      const dy = /n/.test(direction) ? -11.125 : /s/.test(direction) ? 11.125 : 0
      await drag(page, 'chart', direction, dx, dy)
      const after = await rect(page, 'chart')
      if (/w/.test(direction)) near(after.x + after.width, before.x + before.width, direction)
      else near(after.x, before.x, direction)
      if (/n/.test(direction)) near(after.y + after.height, before.y + before.height, direction)
      else near(after.y, before.y, direction)
      assert.ok(after.width !== before.width || after.height !== before.height, direction)
      await preview(page, sparse)
    }
  }
  // Live collision parity against the baseline semantics: same-axis local compression,
  // fixed far edge, stable snapshot reversal and cancellation before pointer-up.
  sparse.reference.main = await dimensions(page)
  const stack = structuredClone(sparse), stackHeight = stack.reference.main.height
  stack.placements[6] = { ...stack.placements[6]!, x: 0, y: 0, width: 220, height: 200, preferred: { width: 220, height: 200 } }
  stack.placements[0] = { ...stack.placements[0]!, x: 0, y: 210, width: 220, height: stackHeight - 210, preferred: { width: 220, height: stackHeight - 210 } }
  await preview(page, stack)
  const active = page.locator('[data-widget="chart"] [data-resize="s"]'), handle = await active.boundingBox(); assert.ok(handle)
  const hx = handle.x + handle.width / 2, hy = handle.y + handle.height / 2
  await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx, hy + 37.375); await settle(page)
  const compressed = await rect(page, 'summary')
  near(compressed.y, 247.375); near(compressed.y + compressed.height, stackHeight); near(compressed.width, 220)
  await page.mouse.move(hx, hy); await settle(page)
  near((await rect(page, 'summary')).y, 210); near((await rect(page, 'summary')).height, stackHeight - 210)
  await page.mouse.move(hx, hy + 37.375); await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
  near((await rect(page, 'summary')).y, 210)
  await drag(page, 'chart', 's', 0, 37.375)
  await drag(page, 'chart', 's', 0, -37.375)
  near((await rect(page, 'summary')).height, compressed.height, 'completed compression stays settled')
  const beforeBlocked = await rect(page, 'chart')
  await drag(page, 'chart', 'se', 5000, stackHeight, false, 1)
  near((await rect(page, 'chart')).width, beforeBlocked.width)
  near((await rect(page, 'chart')).height, beforeBlocked.height)
  await page.locator('.workspace-feedback').filter({ hasText: 'Sem espaço' }).waitFor()
  for (const width of [164, 320]) {
    const fixture = structuredClone(sparse), size = await dimensions(page), surface = { ...size, region: 'main' as const, expanded: true }
    fixture.reference.main = size
    fixture.placements = fixture.placements.map((p, i) => p.id === 'queue' ? { ...p, x: 0, y: 0, width: 600, height: 200, preferred: { width: 600, height: 200 } }
      : p.id === 'summary' ? { ...p, x: 0, y: 210, width, height: 112, preferred: { width, height: 220 } } : { ...p, x: 1200 + i * 350, y: 0 })
    const targetHeight = size.height - 100
    const witness = fixture.placements.map(p => p.id === 'queue' ? { ...p, height: targetHeight } : p.id === 'summary' ? { ...p, x: 610 } : p)
    assert.ok(validLayout(witness, surface, constraintsFor(surface)), 'Independent narrow/wide feasible destination')
    await preview(page, fixture); await drag(page, 'queue', 's', 0, targetHeight - 200)
    const relocated = await rect(page, 'summary')
    near(relocated.x, 610); near(relocated.y, 210); near(relocated.width, width); near(relocated.height, 112)
    if (width === 164) await page.screenshot({ path: `.local/diagnostics/freeform-narrow-relocation-${await page.evaluate(() => devicePixelRatio)}.png` })
  }
  await preview(page, sparse)
  // A burst faster than one display frame is coalesced, and pointer-up flushes exactly
  // one final solution synchronously. No delayed jump may follow the release.
  const burst = await page.locator('[data-widget="chart"] .widget-grip').boundingBox(); assert.ok(burst)
  const bx = burst.x + 40, by = burst.y + 16
  await page.mouse.move(bx, by); await page.mouse.down()
  assert.ok(await page.locator('[data-widget="chart"] .widget-grip').evaluate(e => e.hasPointerCapture(1)), 'Burst requires actual pointer capture')
  const invocations = await page.evaluate(({ x, y }) => new Promise<{ delivered: number; pending: number }>(resolve => {
    performance.mark('geppio:profile'); let count = 0
    const observer = new PerformanceObserver(list => { count += list.getEntries().filter(e => e.name === 'geppio:reflow').length })
    observer.observe({ entryTypes: ['measure'] })
    const grip = document.querySelector('[data-widget="chart"] .widget-grip')!
    for (let i = 1; i <= 100; i++) grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: x + i / 8, clientY: y }))
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: x + 12.5, clientY: y }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Observer notification is a separate browser task and may lag these RAFs.
      // Drain queued records before disconnect rather than dropping measured solves.
      const pending = observer.takeRecords().filter(e => e.name === 'geppio:reflow').length
      observer.disconnect(); performance.clearMarks('geppio:profile'); resolve({ delivered: count, pending })
    }))
  }), { x: bx, y: by })
  await writeFile(`.local/diagnostics/freeform-coalescing-${dev ? 'dev' : 'production'}-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(invocations))
  assert.equal(invocations.delivered + invocations.pending, 1); near((await rect(page, 'chart')).x, sparse.placements[6]!.x + 12.5)
  await page.mouse.up(); await settle(page); near((await rect(page, 'chart')).x, sparse.placements[6]!.x + 12.5)
  await preview(page, sparse)
  await drag(page, 'chart', 'move', 13.25, 11.5)
  let exact = await rect(page, 'chart'); near(exact.x, 150.5); near(exact.y, 94.625)
  if (dev) { await page.locator('[data-widget="chart"] .widget-grip').focus(); await page.keyboard.press('ArrowRight') }
  else await drag(page, 'chart', 'move', 1, 0)
  exact = await rect(page, 'chart'); near(exact.x, 151.5)
  await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const saved = await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY); assert.ok(saved)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  const restored = await rect(page, 'chart'); near(restored.x, exact.x); near(restored.y, exact.y); near(restored.width, exact.width); near(restored.height, exact.height)
  assert.equal(await page.getByTestId('layout-canvas').getAttribute('data-expanded'), 'true')
  // Occupied content only; no world-end padding and scroll-aware movement/reversal.
  const world = await page.locator('[data-surface="main"] .placement-world').evaluate(e => (e as HTMLElement).style.width)
  near(Number.parseFloat(world), Math.max(...sparse.placements.map(p => p.id === 'chart' ? exact.x + exact.width : p.x + p.width)))
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = 600 }); await settle(page)
  await page.getByTestId('edit-layout').click()
  const form = page.getByRole('textbox', { name: 'Nome de exemplo', exact: true })
  // Form can be offscreen; set the existing DOM field and retain its identity through region/visibility changes.
  await form.evaluate(e => { (e as HTMLInputElement).value = 'estado não salvo'; e.setAttribute('data-mounted-proof', 'same') })
  const queue = await rect(page, 'queue')
  const scrollGrip = page.locator('[data-widget="queue"] .widget-grip'), scrollBox = await scrollGrip.boundingBox(); assert.ok(scrollBox)
  await page.mouse.move(scrollBox.x + 50, scrollBox.y + 16); await page.mouse.down()
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft += 20 })
  await page.mouse.move(scrollBox.x + 67.25, scrollBox.y + 16); await settle(page)
  near((await rect(page, 'queue')).x, queue.x + 37.25, 'scrollLeft participates in pointer delta')
  await scrollGrip.evaluate(e => { assertCapture(e); function assertCapture(element: Element) { if (!element.hasPointerCapture(1)) throw new Error('Expected mouse capture'); element.releasePointerCapture(1) } })
  await page.mouse.up(); await settle(page)
  near((await rect(page, 'queue')).x, queue.x)
  await page.getByTestId('cancel-layout').click()
  await expansion(page, false); assert.equal(await form.inputValue(), 'estado não salvo')
  await expansion(page, true); assert.equal(await form.getAttribute('data-mounted-proof'), 'same')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), saved)
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = e.scrollWidth }); await settle(page)
  await page.getByTestId('edit-layout').click()
  const extentBefore = Number.parseFloat(await page.locator('[data-surface="main"] .placement-world').evaluate(e => (e as HTMLElement).style.width))
  await drag(page, 'properties', 'move', -57.25, 0)
  const extentAfter = Number.parseFloat(await page.locator('[data-surface="main"] .placement-world').evaluate(e => (e as HTMLElement).style.width))
  near(extentBefore - extentAfter, 57.25, 'world contraction')
  const range = await page.locator('[data-surface="main"]').evaluate(e => ({ x: e.scrollLeft, max: e.scrollWidth - e.clientWidth }))
  assert.ok(range.x <= range.max)
  await page.getByTestId('cancel-layout').click()
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = e.scrollWidth }); await settle(page)
  await page.getByTestId('edit-layout').click()
  const edgeGrip = page.locator('[data-widget="properties"] .widget-grip'), edgeBox = await edgeGrip.boundingBox(), edgePort = await page.locator('[data-surface="main"]').boundingBox()
  assert.ok(edgeBox && edgePort)
  const edgeOriginal = await rect(page, 'properties')
  await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + 16); await page.mouse.down()
  await page.mouse.move(edgePort.x + edgePort.width - 5, edgeBox.y + 16); await settle(page)
  const edgeFirst = await rect(page, 'properties')
  await page.evaluate(() => new Promise<void>(resolve => { let frames = 6; function frame() { if (--frames === 0) resolve(); else requestAnimationFrame(frame) } requestAnimationFrame(frame) }))
  assert.ok((await rect(page, 'properties')).x > edgeFirst.x + 20, 'edge auto-scroll advances concrete active intention')
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
  near((await rect(page, 'properties')).x, edgeOriginal.x, 'edge extension cancellation')
  await page.getByTestId('cancel-layout').click()
  // Genuine placement in both peer regions, without lowering Bottom minima or its 180px cap.
  await expansion(page, false); await preview(page, DEFAULT_FREEFORM); await resizeWindow(1800, 980); await resizeRegion(page, 'sidebar', 290)
  await transferSelected(page, 'properties', 'sidebar')
  assert.equal((await rect(page, 'properties')).region, 'sidebar'); near((await rect(page, 'properties')).width, await page.locator('[data-surface="sidebar"]').evaluate(e => e.clientWidth))
  assert.equal(await form.getAttribute('data-mounted-proof'), 'same')
  const sideBefore = await rect(page, 'properties')
  await drag(page, 'properties', 's', 0, 13.25); near((await rect(page, 'properties')).height, sideBefore.height + 13.25)
  await drag(page, 'properties', 'move', 50, 13.125)
  near((await rect(page, 'properties')).x, 0); near((await rect(page, 'properties')).y, 13.125)
  await resizeRegion(page, 'sidebar', 280); near((await rect(page, 'properties')).width, await page.locator('[data-surface="sidebar"]').evaluate(e => e.clientWidth))
  // One Sidebar scroll owner includes navigation and content; no horizontal range.
  await page.locator('[data-region="sidebar"]').evaluate(e => { e.scrollTop = e.scrollHeight; e.scrollLeft = 10000 }); await settle(page)
  const sidebarScroll = await page.locator('[data-region="sidebar"]').evaluate(e => ({ x: e.scrollLeft, y: e.scrollTop, width: e.clientWidth, world: e.scrollWidth }))
  assert.equal(sidebarScroll.x, 0); assert.equal(sidebarScroll.width, sidebarScroll.world); assert.ok(sidebarScroll.y > 0)
  await transferSelected(page, 'chart', 'bottom')
  assert.equal((await rect(page, 'chart')).region, 'main', 'small Bottom rejects')
  await resizeRegion(page, 'bottom', 180); await transferSelected(page, 'chart', 'bottom')
  assert.equal((await rect(page, 'chart')).region, 'bottom')
  const bottom = await rect(page, 'chart'), bottomPort = await page.locator('[data-surface="bottom"]').evaluate(e => e.clientHeight)
  near(bottom.height, bottomPort)
  evidence.push({ scenario: 'placed-regions', sidebar: await rect(page, 'properties'), bottom,
    bottomRegionHeight: Number(await separator.getAttribute('aria-valuenow')), bottomContentHeight: bottomPort,
    dpr: await page.evaluate(() => devicePixelRatio) })
  await assertBottomNoScroll(page)
  await drag(page, 'chart', 'e', 17.375, 0); near((await rect(page, 'chart')).width, bottom.width + 17.375)
  await drag(page, 'chart', 'move', 13.25, 20); near((await rect(page, 'chart')).y, 0)
  await resizeRegion(page, 'bottom', 175)
  near((await rect(page, 'chart')).height, await page.locator('[data-surface="bottom"]').evaluate(e => e.clientHeight))
  await expansion(page, true)
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true', 'Main expansion never changes Bottom measurements')
  await assertBottomNoScroll(page)
  await page.locator('[data-widget="chart"] .widget-grip').focus()
  await page.keyboard.press('End'); await page.keyboard.press('PageDown'); await settle(page); await assertBottomNoScroll(page)
  await page.locator('[data-surface="bottom"]').hover(); await page.mouse.wheel(1000, 1000); await settle(page); await assertBottomNoScroll(page)
  await resizeRegion(page, 'bottom', 180)
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true')
  await drag(page, 'chart', 'move', 1600, 0)
  const finiteBottom = await rect(page, 'chart')
  assert.ok(finiteBottom.x + finiteBottom.width <= await page.locator('[data-surface="bottom"]').evaluate(e => e.clientWidth) + .01)
  near(Number.parseFloat(await page.locator('[data-surface="bottom"] .placement-world').evaluate(e => (e as HTMLElement).style.width)), await page.locator('[data-surface="bottom"]').evaluate(e => e.clientWidth))
  await expansion(page, false)
  // A real pointer transfer uses the target content origin and preserves content identity.
  const dropFrom = await page.locator('[data-widget="chart"] .widget-grip').boundingBox(), dropTo = await page.locator('[data-surface="main"]').boundingBox()
  assert.ok(dropFrom && dropTo)
  await page.mouse.move(dropFrom.x + 40, dropFrom.y + 16); await page.mouse.down()
  await page.mouse.move(dropTo.x + dropTo.width * .5, dropTo.y + dropTo.height * .7, { steps: 4 }); await page.mouse.up(); await settle(page)
  assert.equal((await rect(page, 'chart')).region, 'main')
  await transferSelected(page, 'chart', 'bottom'); assert.equal((await rect(page, 'chart')).region, 'bottom')
  await transferSelected(page, 'queue', 'sidebar'); assert.equal((await rect(page, 'queue')).region, 'main')
  await resizeRegion(page, 'sidebar', 0); await page.getByRole('button', { name: 'Reabrir Sidebar' }).click(); await settle(page)
  assert.equal(await form.inputValue(), 'estado não salvo'); assert.equal((await rect(page, 'properties')).region, 'sidebar')
  await resizeRegion(page, 'bottom', 0); await page.getByRole('button', { name: 'Reabrir Bottom' }).click(); await settle(page)
  near(Number(await separator.getAttribute('aria-valuenow')), 180)
  await page.screenshot({ path: `.local/diagnostics/freeform-regions-${await page.evaluate(() => devicePixelRatio)}.png` })
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), saved, 'viewport/region/toggle/scroll and unsaved edits do not adopt a composition')
  await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor()
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  assert.equal((await rect(page, 'properties')).region, 'sidebar'); assert.equal((await rect(page, 'chart')).region, 'bottom')
  // Restart restores composition even if session-only region sizes initially cannot fit it.
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'false')
  await page.getByTestId('bottom-recovery').waitFor(); await assertBottomNoScroll(page)
  await expansion(page, true); await assertBottomNoScroll(page); await expansion(page, false)
  const recoveryBytes = await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY)
  await page.getByRole('button', { name: 'Ampliar Bottom', exact: true }).click(); await settle(page)
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), recoveryBytes)
  await resizeRegion(page, 'sidebar', 290); await resizeRegion(page, 'bottom', 180)
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true')
  const farSidebar = structuredClone(DEFAULT_FREEFORM), sideWidth = await page.locator('[data-surface="sidebar"]').evaluate(e => e.clientWidth)
  farSidebar.reference.sidebar = { width: sideWidth, height: 1210.125 }
  farSidebar.placements = farSidebar.placements.map(p => p.id === 'properties' ? { ...p, region: 'sidebar', x: 0, y: 900.125, width: sideWidth, height: 310 } : p)
  await preview(page, farSidebar)
  await page.locator('[data-region="sidebar"]').evaluate(e => { e.scrollTop = e.scrollHeight }); await settle(page)
  await drag(page, 'properties', 'move', 0, -57.25)
  near((await rect(page, 'properties')).y, 842.875, 'Sidebar contraction cannot feed scroll clamping back into pointer delta')
  await preview(page, DEFAULT_FREEFORM); await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor()
  // Cooperative Save queue + Cancel, quota failure and byte-CAS conflicts.
  const stable = await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY)
  await page.getByTestId('edit-layout').click()
  await page.evaluate(key => {
    const test = window as unknown as { releaseLayoutLock: () => void; layoutLockAcquired: boolean; layoutLockFinished: boolean }
    void navigator.locks.request(key, async () => { test.layoutLockAcquired = true; await new Promise<void>(resolve => { test.releaseLayoutLock = resolve }) }).then(() => { test.layoutLockFinished = true })
  }, FREEFORM_KEY)
  await page.waitForFunction(() => (window as unknown as { layoutLockAcquired: boolean }).layoutLockAcquired)
  await page.getByTestId('save-layout').click(); await page.getByTestId('cancel-layout').click()
  await page.evaluate(() => (window as unknown as { releaseLayoutLock: () => void }).releaseLayoutLock())
  await page.waitForFunction(() => (window as unknown as { layoutLockFinished: boolean }).layoutLockFinished); await settle(page)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), stable)
  await page.getByTestId('edit-layout').click()
  await page.evaluate(() => { const test = window as unknown as { quotaSet: typeof Storage.prototype.setItem }; test.quotaSet = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await page.getByTestId('save-layout').click(); await page.locator('.workspace-feedback').filter({ hasText: 'Não foi possível salvar.' }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), stable)
  await page.evaluate(() => { Storage.prototype.setItem = (window as unknown as { quotaSet: typeof Storage.prototype.setItem }).quotaSet })
  await page.getByTestId('cancel-layout').click(); await page.getByTestId('edit-layout').click()
  await page.evaluate(key => localStorage.setItem(key, 'external update'), FREEFORM_KEY)
  await page.getByTestId('save-layout').click(); await page.locator('.workspace-feedback').filter({ hasText: 'mudou em outra sessão' }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), 'external update')
  await page.getByTestId('cancel-layout').click()
  const legacyKeys = ['geppio:layout:v1', GRID_KEY, HORIZONTAL_KEY]
  const originals = [JSON.stringify(DEFAULT_LAYOUT), JSON.stringify(DEFAULT_GRID), serializeHorizontal(DEFAULT_HORIZONTAL)]
  await page.evaluate(({ keys, values, key }) => { localStorage.removeItem(key); keys.forEach((k, i) => localStorage.setItem(k, values[i]!)) }, { keys: legacyKeys, values: originals, key: FREEFORM_KEY })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.equal(await page.getByTestId('edit-layout').isDisabled(), true)
  for (const label of ['Fracionário v1', 'Responsivo v2', 'Horizontal v1']) {
    await settings(page); await page.getByRole('button', { name: 'Prévia: ' + label, exact: true }).click()
    await page.getByTestId('cancel-layout').waitFor(); await page.getByTestId('cancel-layout').click()
    assert.deepEqual(await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), legacyKeys), originals)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), null)
  }
  for (const raw of ['{broken', '{"schemaVersion":999}', ' '.repeat(65537)]) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: FREEFORM_KEY, raw }); await page.reload(); await page.getByTestId('edit-layout').waitFor()
    assert.equal(await page.getByTestId('edit-layout').isDisabled(), true)
    await settings(page); await page.getByRole('button', { name: 'Prévia da composição inicial', exact: true }).click()
    await page.getByTestId('cancel-layout').click(); assert.equal(await page.evaluate(key => localStorage.getItem(key), FREEFORM_KEY), raw)
  }
  await page.evaluate(keys => keys.forEach(k => localStorage.removeItem(k)), [...legacyKeys, FREEFORM_KEY, EXPANSION_KEY, 'geppio:theme:v1'])
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await resizeWindow(1280, 900); await settle(page)
  await page.screenshot({ path: `.local/diagnostics/freeform-after-${await page.evaluate(() => devicePixelRatio)}.png` })
  await writeFile(`.local/diagnostics/freeform-geometry-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(evidence, null, 2))
  console.log('PASS freeform: CSS pixels/eight directions, exact reload, both themes/windows, single insets/status, collapse/reopen, real Sidebar/Bottom placement, minima, state, legacy/CAS/quota/queued Cancel')
}

export async function freeformPluginSmoke(page: Page) {
  const workers = [...page.workers()]; assert.equal(workers.length, 2)
  await expansion(page, true)
  const source = structuredClone(DEFAULT_FREEFORM); source.reference.main = await dimensions(page)
  source.placements = projectRegion(DEFAULT_FREEFORM, 'main', source.reference.main, false).placements
  source.placements = source.placements.map(p => p.id === 'properties' ? { ...p, x: 14000.125 } : p)
  await preview(page, source)
  const form = page.getByRole('textbox', { name: 'Nome de exemplo', exact: true })
  await form.evaluate(e => { (e as HTMLInputElement).value = 'formulário fora da tela' })
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = e.scrollWidth }); await settle(page)
  await expansion(page, false); await expansion(page, true)
  assert.equal(await form.inputValue(), 'formulário fora da tela'); assert.deepEqual(page.workers(), workers)
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 2', { exact: true }).waitFor()
  await settings(page)
  const pulse = page.locator('[data-plugin="local.pulse"] p[role="status"]'), before = await pulse.textContent()
  await page.waitForFunction(before => document.querySelector('[data-plugin="local.pulse"] p[role="status"]')?.textContent !== before, before)
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  assert.deepEqual(page.workers(), workers)
  await page.locator('[data-surface="main"]').evaluate(e => { e.scrollLeft = 0 }); await settle(page)
  await transferSelected(page, 'chart', 'sidebar')
  assert.equal((await rect(page, 'chart')).region, 'sidebar')
  assert.deepEqual(page.workers(), workers, 'eligible region transfer does not restart Workers')
  assert.equal(await form.inputValue(), 'formulário fora da tela')
  await page.getByTestId('cancel-layout').click(); await expansion(page, false)
  await writeFile(`.local/diagnostics/freeform-performance-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length, frames: document.querySelectorAll('[data-widget]').length, worlds: document.querySelectorAll('.placement-world').length,
    optimization: getComputedStyle(document.querySelector('[data-widget]')!).contentVisibility,
    limits: 'Seven real mounted fixtures, three constant-size world elements; Worker identity/actions and pulse continuity tested. No general CPU/memory guarantee.'
  })), null, 2))
  console.log('PASS mounted offscreen form and unchanged Counter/Pulse Workers/actions/background updates across expansion and scrolling')
}
