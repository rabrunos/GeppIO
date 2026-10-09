/** Independent DOM oracle and real input, only in the caller's disposable Electron profile. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { DEFAULT_HORIZONTAL, HORIZONTAL_KEY, serializeHorizontal } from '../src/shared/grid/horizontal.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { DEFAULT_LAYOUT } from '../src/shared/layout-defaults.ts'
import { DIRECTIONS } from '../src/shared/grid/types.ts'
import type { GridSnapshot } from '../src/shared/grid/types.ts'
import { selectLayoutMode } from './layout-mode-smoke.ts'

const legacyKey = 'geppio:layout:v1'
const frame = (page: Page) => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
async function settings(page: Page) { await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click() }
async function draft(page: Page, snapshot: GridSnapshot, save = true) {
  if (await page.getByTestId('cancel-layout').count()) await page.getByTestId('cancel-layout').click()
  await settings(page)
  await page.locator('input[type="file"]').setInputFiles({ name: 'horizontal.json', mimeType: 'application/json', buffer: Buffer.from(serializeHorizontal(snapshot)) })
  await page.getByTestId('save-layout').waitFor(); await frame(page)
  if (save) { await page.getByTestId('save-layout').click(); await page.getByTestId('edit-layout').waitFor(); await frame(page) }
}
async function scrollTo(page: Page, x: number) {
  await page.locator('.main-scrollport').evaluate((e, x) => { e.scrollLeft = x }, x); await frame(page)
}
async function geometry(page: Page) {
  await frame(page)
  const value = await page.getByTestId('layout-canvas').evaluate(e => {
    const main = e as HTMLElement, r = main.getBoundingClientRect(), port = main.querySelector<HTMLElement>('.main-scrollport')!, p = port.getBoundingClientRect()
    const bar = main.querySelector<HTMLInputElement>('.horizontal-scrollbar'), b = bar?.getBoundingClientRect()
    return { main: { width: r.width, height: r.height }, port: { left: p.left - r.left, top: p.top - r.top, width: p.width, height: p.height,
      clientWidth: port.clientWidth, clientHeight: port.clientHeight, scrollWidth: port.scrollWidth, scrollHeight: port.scrollHeight, scrollLeft: port.scrollLeft },
      rows: Number(main.dataset.rows), cell: Number(main.dataset.cell), pitch: Number(main.dataset.pitch), gutter: Number(main.dataset.gutter),
      bar: b ? { left: b.left - r.left, top: b.top - r.top, width: b.width, height: b.height } : null,
      widgets: [...main.querySelectorAll<HTMLElement>('[data-widget]')].map(w => { const v = w.getBoundingClientRect(); return { id: w.dataset.widget!, x: Number(w.dataset.x), y: Number(w.dataset.y),
        w: Number(w.dataset.w), h: Number(w.dataset.h), left: v.left - r.left, top: v.top - r.top, width: v.width, height: v.height } }) }
  })
  const near = (a: number, b: number, label: string, tolerance = .06) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} versus ${b}`)
  assert.equal(value.rows, 10)
  near(value.cell, (value.main.height - 30 - 90) / 10, 'height-only cell')
  near(value.pitch, value.cell + 10, 'pitch'); assert.equal(value.gutter, 10)
  near(value.port.left, 15, 'left frame'); near(value.port.top, 15, 'top frame')
  near(value.main.width - value.port.left - value.port.width, 15, 'right frame')
  near(value.main.height - value.port.top - value.port.height, 15, 'bottom frame')
  near(value.port.clientWidth, value.port.width, 'zero vertical scrollbar reservation', .51)
  near(value.port.clientHeight, value.port.height, 'zero horizontal scrollbar reservation', .51)
  assert.ok(value.port.scrollHeight <= value.port.clientHeight + 1)
  const nativeRange = value.port.scrollWidth - value.port.clientWidth
  const exactRange = Math.max(0, Math.max(...value.widgets.map(w => (w.x + w.w) * value.pitch - 10)) - value.port.width)
  const effectiveScroll = nativeRange > 0 ? value.port.scrollLeft * exactRange / nativeRange : 0
  for (const w of value.widgets) {
    near(w.left, 15 + w.x * value.pitch - effectiveScroll, 'world x')
    near(w.top, 15 + w.y * value.pitch, 'world y')
    near(w.width, w.w * value.pitch - 10, 'widget width'); near(w.height, w.h * value.pitch - 10, 'widget height')
    if (w.w === w.h) near(w.width, w.height, 'square spans')
    if (w.y + w.h === 10) near(w.top + w.height, value.main.height - 15, 'last row meets inner frame')
  }
  if (value.bar) { near(value.bar.top, value.main.height - 15, 'overlay wholly in bottom frame'); near(value.bar.height, 15, 'bar interaction height') }
  return value
}
function topology(g: Awaited<ReturnType<typeof geometry>>) { return g.widgets.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) }

export async function horizontalSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>) {
  assert.equal(await page.getByTestId('layout-canvas').getAttribute('data-engine'), 'horizontal', 'new session defaults horizontal')
  const old = [JSON.stringify(DEFAULT_LAYOUT, null, 2), JSON.stringify(DEFAULT_GRID, null, 2)]
  await page.evaluate(({ old, legacyKey, GRID_KEY }) => { localStorage.setItem(legacyKey, old[0]!); localStorage.setItem(GRID_KEY, old[1]!) }, { old, legacyKey, GRID_KEY })
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  const evidence: unknown[] = []
  async function preserved() {
    assert.deepEqual(await page.evaluate(keys => keys.map(k => localStorage.getItem(k)), [legacyKey, GRID_KEY]), old)
  }
  await resizeWindow(1920, 1080)
  await selectLayoutMode(page, 'responsive'); await page.screenshot({ path: '.local/diagnostics/horizontal-before-responsive.png' })
  await selectLayoutMode(page, 'horizontal')
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    const fit = await geometry(page); assert.equal(fit.bar, null); assert.equal(fit.port.scrollLeft, 0)
    const origin = fit.widgets.find(w => w.id === 'summary')!; assert.equal(origin.left, 15); assert.equal(origin.top, 15)
    evidence.push({ theme, stage: 'fits', ...fit })
    await page.screenshot({ path: `.local/diagnostics/horizontal-${theme}-fullhd.png` })
    const far = { ...structuredClone(DEFAULT_HORIZONTAL), placements: DEFAULT_HORIZONTAL.placements.map(p => p.id === 'properties' ? { ...p, x: 100 } : structuredClone(p)) }
    await draft(page, far)
    const expanded = await geometry(page); assert.ok(expanded.bar); assert.ok(expanded.port.scrollWidth > fit.port.scrollWidth)
    assert.equal(expanded.cell, fit.cell); assert.equal(expanded.pitch, fit.pitch)
    assert.deepEqual({ ...expanded.port, scrollWidth: 0 }, { ...fit.port, scrollWidth: 0 }, 'scrollbar reserves zero space')
    await page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }).fill('rascunho local sem salvar')
    const end = await geometry(page), last = end.widgets.find(w => w.id === 'properties')!
    assert.ok(end.port.scrollLeft > 0, 'focus/input reveals offscreen widget')
    await scrollTo(page, 1e9)
    const terminal = await geometry(page), rightmost = terminal.widgets.find(w => w.id === 'properties')!
    assert.ok(Math.abs(rightmost.left + rightmost.width - (terminal.main.width - 15)) <= .06, 'occupied world ends at exact inner right frame')
    assert.equal(last.x, 100)
    await scrollTo(page, 0); assert.equal(await page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }).inputValue(), 'rascunho local sem salvar')
    await page.locator('.main-scrollport').focus(); await page.keyboard.press('End'); await frame(page)
    assert.ok((await geometry(page)).port.scrollLeft > 0)
    await page.keyboard.press('Home'); await frame(page); assert.equal((await geometry(page)).port.scrollLeft, 0)
    const interior = await page.locator('.main-scrollport').boundingBox(); assert.ok(interior)
    await page.mouse.move(interior.x + interior.width - 60, interior.y + interior.height / 2)
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 180); await page.keyboard.up('Shift'); await frame(page)
    assert.ok((await geometry(page)).port.scrollLeft > 0, 'Shift+wheel scrolls Main')
    await scrollTo(page, 0)
    const activity = page.locator('[data-widget="activity"] .widget-content'), area = await activity.boundingBox(); assert.ok(area)
    const top = await activity.evaluate(e => e.scrollTop)
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.wheel(0, 240); await frame(page)
    assert.ok(await activity.evaluate(e => e.scrollTop) > top, 'normal vertical wheel remains inside widget')
    assert.equal((await geometry(page)).port.scrollLeft, 0)
    await page.mouse.move(interior.x + interior.width - 60, interior.y + interior.height / 2)
    await page.mouse.wheel(180, 0); await frame(page); assert.ok((await geometry(page)).port.scrollLeft > 0)
    const bar = page.getByRole('slider', { name: 'Rolagem horizontal da Main', exact: true }), box = await bar.boundingBox(); assert.ok(box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 4 }); await page.mouse.up()
    assert.ok((await geometry(page)).port.scrollLeft > 0); evidence.push({ theme, stage: 'terminal', ...terminal })
    await page.screenshot({ path: `.local/diagnostics/horizontal-${theme}-scrolled.png` })
    await selectLayoutMode(page, 'responsive'); await selectLayoutMode(page, 'horizontal')
    assert.equal(await page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }).inputValue(), 'rascunho local sem salvar', 'mode switch retains mounted form')
    await preserved()
    // Move the furthest widget back with actual keyboard edits; extent contracts immediately.
    await page.getByTestId('edit-layout').click()
    const grip = page.locator('[data-widget="properties"] .widget-grip'); await grip.focus()
    for (let i = 0; i < 49; i++) await page.keyboard.press('Shift+ArrowLeft')
    await frame(page); const contracted = await geometry(page)
    assert.ok(contracted.port.scrollWidth < terminal.port.scrollWidth); assert.ok(contracted.port.scrollLeft <= contracted.port.scrollWidth - contracted.port.clientWidth)
    await page.getByTestId('cancel-layout').click(); await frame(page)
    await draft(page, DEFAULT_HORIZONTAL); const back = await geometry(page); assert.equal(back.bar, null); assert.equal(back.port.scrollLeft, 0)
    assert.equal(back.pitch, fit.pitch); await preserved()
  }
  // Isolated widget at nonzero scroll for all eight pointer resize directions and stable reversal.
  const isolated = { ...structuredClone(DEFAULT_HORIZONTAL), placements: DEFAULT_HORIZONTAL.placements.map(p => p.id === 'summary'
    ? { ...p, x: 30, y: 3, w: 5, h: 4, preferred: { w: 5, h: 4 } } : p.id === 'chart' ? { ...p, x: 50 } : structuredClone(p)) }
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const direction of DIRECTIONS) {
      await draft(page, isolated, false)
      await page.locator(`[data-widget="summary"] [data-resize="${direction}"]`).focus(); await frame(page)
      const centered = await geometry(page)
      await scrollTo(page, 32.5 * centered.pitch - centered.port.width / 2)
      const before = await geometry(page); assert.ok(before.port.scrollLeft > 0)
      const target = page.locator(`[data-widget="summary"] [data-resize="${direction}"]`), b = await target.boundingBox(); assert.ok(b)
      await target.evaluate(element => element.addEventListener('pointerdown', event => { (element as HTMLElement).dataset.horizontalPointer = String((event as PointerEvent).pointerId) }, { once: true }))
      const x = b.x + b.width / 2, y = b.y + b.height / 2, dx = direction.includes('e') ? 1 : direction.includes('w') ? -1 : 0, dy = direction.includes('s') ? 1 : direction.includes('n') ? -1 : 0
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx * before.pitch, y + dy * before.pitch); await frame(page)
      const after = await geometry(page), a = after.widgets.find(w => w.id === 'summary')!, p = before.widgets.find(w => w.id === 'summary')!
      assert.equal(a.w, p.w + Math.abs(dx), `${theme} ${direction} width`); assert.equal(a.h, p.h + Math.abs(dy), `${theme} ${direction} height`)
      if (direction.includes('w')) assert.equal(a.x + a.w, p.x + p.w)
      if (direction.includes('n')) assert.equal(a.y + a.h, p.y + p.h)
      await page.mouse.move(x, y); await frame(page); assert.deepEqual(topology(await geometry(page)), topology(before), 'pointer reversal restores snapshot')
      await page.mouse.move(x + dx * before.pitch, y + dy * before.pitch); await frame(page)
      const captured = await target.evaluate(element => element.hasPointerCapture(Number((element as HTMLElement).dataset.horizontalPointer)))
      evidence.push({ stage: 'capture cancellation', theme, direction, captured })
      // If Windows already interrupted capture, verify its rollback instead of sending a second
      // Escape (which intentionally cancels the entire editing transaction).
      if (captured) {
        if (direction === 'e') await target.evaluate(element => element.releasePointerCapture(Number((element as HTMLElement).dataset.horizontalPointer)))
        else if (direction === 's') await target.dispatchEvent('pointercancel', { pointerId: Number(await target.getAttribute('data-horizontal-pointer')) })
        else await page.keyboard.press('Escape')
      }
      await page.mouse.up(); assert.deepEqual(topology(await geometry(page)), topology(before), `${theme}/${direction}: Escape/capture cancellation restores the full gesture`)
      await page.getByTestId('cancel-layout').click()
    }
  }
  await draft(page, isolated, false)
  await page.locator('[data-widget="summary"] .widget-grip').focus(); await frame(page)
  const centered = await geometry(page); await scrollTo(page, 32.5 * centered.pitch - centered.port.width / 2)
  const start = await geometry(page), grip = page.locator('[data-widget="summary"] .widget-grip'), b = await grip.boundingBox(); assert.ok(b)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + start.pitch, b.y + b.height / 2); await frame(page)
  assert.equal((await geometry(page)).widgets.find(w => w.id === 'summary')!.x, 31, 'drag maps scroll-adjusted world coordinates')
  const port = await page.locator('.main-scrollport').boundingBox(); assert.ok(port)
  await page.mouse.move(port.x + port.width - 2, b.y + b.height / 2)
  await page.waitForFunction(initial => document.querySelector('.main-scrollport')!.scrollLeft > initial + 100, start.port.scrollLeft)
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.deepEqual(topology(await geometry(page)), topology(start), 'autoscroll cancellation restores full snapshot')
  await settings(page); await page.getByRole('combobox', { name: 'Layout experimental', exact: true }).selectOption('responsive')
  assert.equal(await page.getByRole('combobox', { name: 'Layout experimental', exact: true }).inputValue(), 'horizontal')
  await page.getByTestId('plugin-settings').getByText('Salve ou cancele a edição antes de trocar o layout experimental.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await page.getByTestId('cancel-layout').click()
  // Window/regions never change horizontal logical placement or either saved engine.
  await draft(page, isolated)
  const saved = await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), logical = topology(await geometry(page))
  await page.evaluate(keys => {
    const state = window as unknown as { horizontalWrites: number }; state.horizontalWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, raw) { if (keys.includes(key)) state.horizontalWrites++; original.call(this, key, raw) }
  }, [HORIZONTAL_KEY, GRID_KEY, legacyKey])
  await scrollTo(page, 1e9); await scrollTo(page, 0)
  await selectLayoutMode(page, 'responsive'); await selectLayoutMode(page, 'horizontal')
  for (const [width, height] of [[1000, 720], [1920, 1080], [0, 0], [1480, 980]]) {
    await resizeWindow(width!, height!); evidence.push({ stage: 'window', requested: [width, height], ...await geometry(page) })
    assert.deepEqual(topology(await geometry(page)), logical)
  }
  for (const name of ['Largura da Sidebar', 'Altura da Bottom']) {
    const separator = page.getByRole('separator', { name }); await separator.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await frame(page)
    assert.deepEqual(topology(await geometry(page)), logical)
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), saved); await preserved()
  const widthReference = await geometry(page)
  await resizeWindow(1700, 980); const widthChanged = await geometry(page)
  assert.equal(widthChanged.main.height, widthReference.main.height); assert.equal(widthChanged.pitch, widthReference.pitch, 'width-only resize never scales cells')
  assert.equal(await page.evaluate(() => (window as unknown as { horizontalWrites: number }).horizontalWrites), 0, 'scroll/mode/viewport/regions make zero layout storage calls')
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.deepEqual(topology(await geometry(page)), logical)
  // A Save queued behind another same-origin writer cannot survive Cancel.
  await page.evaluate(key => {
    const state = window as unknown as { releaseHorizontalLock: () => void; horizontalLockHeld: boolean; horizontalLockFinished: boolean }
    state.horizontalLockHeld = false; state.horizontalLockFinished = false
    void navigator.locks.request(key, async () => {
      await new Promise<void>(resolve => { state.releaseHorizontalLock = resolve; state.horizontalLockHeld = true })
    }).then(() => { state.horizontalLockFinished = true })
  }, HORIZONTAL_KEY)
  await page.waitForFunction(() => (window as unknown as { horizontalLockHeld: boolean }).horizontalLockHeld)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  await page.getByTestId('cancel-layout').click()
  await page.evaluate(() => (window as unknown as { releaseHorizontalLock: () => void }).releaseHorizontalLock())
  await page.waitForFunction(() => (window as unknown as { horizontalLockFinished: boolean }).horizontalLockFinished)
  await frame(page); assert.equal(await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), saved)
  // Failed writes leave the draft available; restore only the disposable test prototype.
  await page.getByTestId('edit-layout').click()
  await page.evaluate(() => {
    const state = window as unknown as { originalHorizontalSet: typeof Storage.prototype.setItem }
    state.originalHorizontalSet = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') }
  })
  await page.getByTestId('save-layout').click()
  await page.getByText('Não foi possível salvar o layout horizontal. A prévia e os dados anteriores foram preservados.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), saved)
  await page.evaluate(() => { Storage.prototype.setItem = (window as unknown as { originalHorizontalSet: typeof Storage.prototype.setItem }).originalHorizontalSet })
  await page.getByTestId('cancel-layout').click()
  // Concurrent Save and corrupt/unsupported/oversized input retain exact original bytes.
  await page.getByTestId('edit-layout').click()
  const concurrent = serializeHorizontal(DEFAULT_HORIZONTAL)
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: HORIZONTAL_KEY, raw: concurrent })
  await page.getByTestId('save-layout').click(); await page.getByTestId('cancel-layout').waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), concurrent)
  await page.getByTestId('cancel-layout').click()
  // Even a withheld corrupt alternative must not unmount the other mode's unsaved form state.
  await page.evaluate(key => localStorage.setItem(key, '{corrupt responsive'), GRID_KEY)
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  await page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }).fill('campo preservado durante recuperação')
  await selectLayoutMode(page, 'responsive'); assert.equal(await page.locator('[data-widget]').count(), 0)
  await selectLayoutMode(page, 'horizontal')
  assert.equal(await page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }).inputValue(), 'campo preservado durante recuperação')
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: GRID_KEY, raw: old[1]! })
  for (const raw of ['{broken', '{"schemaVersion":999}', ' '.repeat(65537)]) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: HORIZONTAL_KEY, raw }); await page.reload(); await page.getByTestId('edit-layout').waitFor()
    assert.equal(await page.locator('[data-widget]').count(), 0); assert.equal(await page.evaluate(key => localStorage.getItem(key), HORIZONTAL_KEY), raw)
    await settings(page); await page.getByRole('button', { name: 'Prévia da composição inicial', exact: true }).click()
    await page.getByTestId('cancel-layout').click(); assert.equal(await page.locator('[data-widget]').count(), 0); await preserved()
  }
  await page.evaluate(keys => keys.forEach(k => localStorage.removeItem(k)), [HORIZONTAL_KEY, GRID_KEY, legacyKey, 'geppio:theme:v1'])
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  await writeFile(`.local/diagnostics/horizontal-geometry-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify(evidence, null, 2))
  console.log('PASS horizontal DOM geometry, overlay/no reservation, expansion/contraction, eight directions, scroll-aware drag, auto-scroll, form, modes, persistence and recovery')
}

/** Run after the existing Counter/Pulse activation, before any deliberate lifecycle changes. */
export async function horizontalPluginSmoke(page: Page) {
  const workers = [...page.workers()]
  assert.equal(workers.length, 2)
  await selectLayoutMode(page, 'horizontal')
  await draft(page, { ...DEFAULT_HORIZONTAL, placements: DEFAULT_HORIZONTAL.placements.map(p => p.id === 'properties' ? { ...p, x: 200 } : p) })
  await scrollTo(page, 1e9); await selectLayoutMode(page, 'responsive'); await selectLayoutMode(page, 'horizontal')
  assert.deepEqual(page.workers(), workers, 'scroll and mode changes do not restart/dispose Workers')
  await page.getByText('Cliques nesta ativação: 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 2', { exact: true }).waitFor()
  await settings(page)
  const pulse = page.locator('[data-plugin="local.pulse"] p[role="status"]'), before = await pulse.textContent()
  await page.waitForFunction(before => document.querySelector('[data-plugin="local.pulse"] p[role="status"]')?.textContent !== before, before)
  assert.equal(await page.locator('[data-plugin="local.counter"]').getAttribute('data-status'), 'active')
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const beforeMetrics = await session.send('Performance.getMetrics')
  const stress = await page.evaluate(() => {
    const world = document.querySelector('.main-world')!, start = performance.now()
    // Paint workload only: these mounted synthetic surfaces have no plugin/native authority.
    for (let i = 0; i < 120; i++) {
      const e = document.createElement('section'); e.className = 'widget-frame synthetic-offscreen'
      Object.assign(e.style, { left: `${10000 + i * 600}px`, top: '0px', width: '500px', height: '400px' })
      for (let j = 0; j < 100; j++) { const child = document.createElement('p'); child.textContent = `Synthetic ${i}:${j}`; e.append(child) }
      world.append(e)
    }
    const surfaces = [...world.querySelectorAll<HTMLElement>('.synthetic-offscreen')]
    const skipped = surfaces.filter(e => !e.firstElementChild!.checkVisibility({ contentVisibilityAuto: true })).length
    return { surfaces: surfaces.length, descendants: surfaces.length * 100, skipped, constructionMs: performance.now() - start,
      nodes: document.querySelectorAll('*').length, optimization: getComputedStyle(surfaces[0]!).contentVisibility }
  })
  await frame(page)
  const afterMetrics = await session.send('Performance.getMetrics')
  const observation = await page.evaluate(() => {
    const surfaces = [...document.querySelectorAll<HTMLElement>('.synthetic-offscreen')]
    const skipped = surfaces.filter(e => !e.firstElementChild!.checkVisibility({ contentVisibilityAuto: true })).length
    const boxesVisible = surfaces.filter(e => e.checkVisibility({ contentVisibilityAuto: true })).length
    surfaces.forEach(e => e.remove()); return { skipped, boxesVisible }
  })
  await writeFile(`.local/diagnostics/horizontal-performance-${await page.evaluate(() => devicePixelRatio)}.json`, JSON.stringify({ stress, observation, beforeMetrics, afterMetrics,
    limits: 'Single synthetic DOM/paint workload; construction is intentionally measured, not a generalized React/CPU/plugin benchmark.' }, null, 2))
  assert.ok(observation.skipped >= 100, JSON.stringify({ stress, observation })); assert.deepEqual(page.workers(), workers)
  await session.detach()
  await selectLayoutMode(page, 'responsive')
  await page.getByRole('button', { name: 'Incrementar', exact: true }).click(); await page.getByText('Cliques nesta ativação: 3', { exact: true }).waitFor()
  assert.deepEqual(page.workers(), workers)
  console.log('PASS mounted offscreen paint workload and unchanged Counter/Pulse Workers/state across scrolling and mode switches')
}
