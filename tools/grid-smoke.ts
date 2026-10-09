/** Real renderer interaction on the caller's disposable Electron profile. */
import assert from 'node:assert/strict'
import type { Page } from 'playwright'
import { DIRECTIONS } from '../src/shared/grid/types.ts'
import type { Direction, GridPlacement, GridSnapshot } from '../src/shared/grid/types.ts'
import { DEFAULT_GRID, GRID_KEY } from '../src/shared/grid/policy.ts'
import { parseGrid } from '../src/shared/grid/schema.ts'
import { projectGrid } from '../src/shared/grid/projection.ts'
import { fitGrid } from '../src/shared/grid/geometry.ts'
import { DEFAULT_LAYOUT } from '../src/shared/layout-defaults.ts'
import { IDENTITY } from '../src/shared/identity.ts'

async function frame(page: Page) { await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))) }
async function placements(page: Page) {
  return page.locator('[data-widget]').evaluateAll(elements => elements.map(e => { const p = (e as HTMLElement).dataset; return { id: p.widget!, x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) } }))
}
const view = (ps: GridPlacement[]) => ps.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))
async function projected(page: Page, source: GridSnapshot) {
  const main = page.getByTestId('layout-canvas')
  return view(projectGrid(source, Number(await main.getAttribute('data-usable-width')), Number(await main.getAttribute('data-usable-height'))).snapshot.placements)
}
async function settings(page: Page) { await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click(); await page.getByTestId('plugin-settings').waitFor() }
async function importDraft(page: Page, snapshot: GridSnapshot = DEFAULT_GRID) {
  if (await page.getByTestId('cancel-layout').count()) await page.getByTestId('cancel-layout').click()
  await settings(page)
  await page.locator('input[type="file"]').setInputFiles({ name: 'grid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) })
  await page.getByTestId('save-layout').waitFor(); await frame(page)
}
async function start(page: Page, id: string, direction?: Direction) {
  const target = page.locator(`[data-widget="${id}"] ${direction ? `[data-resize="${direction}"]` : '.widget-grip'}`)
  await target.evaluate(element => element.addEventListener('pointerdown', event => { (element as HTMLElement).dataset.testPointer = String((event as PointerEvent).pointerId) }, { once: true }))
  const box = await target.boundingBox(); assert.ok(box)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); return { x, y }
}
async function drag(page: Page, point: { x: number; y: number }, dx: number, dy: number) {
  const pitch = Number(await page.getByTestId('layout-canvas').getAttribute('data-pitch'))
  await page.mouse.move(point.x + dx * pitch, point.y + dy * pitch, { steps: 3 }); await frame(page)
}
async function blockViaKeyboard(page: Page) {
  for (let i = 0; i < 24; i++) for (const key of ['Shift+ArrowRight', 'Shift+ArrowDown']) {
    await page.keyboard.press(key); await frame(page)
    if (await page.locator('[data-widget="summary"].invalid').count()) return
  }
  assert.fail('Expected bounded keyboard growth to block')
}
async function fit(page: Page) {
  await frame(page)
  const info = await page.getByTestId('layout-canvas').evaluate(e => {
    const main = e as HTMLElement, d = main.dataset, rect = main.getBoundingClientRect()
    const dock = main.querySelector('.test-panel.docked'), style = getComputedStyle(main)
    const originX = 9 + (dock?.classList.contains('edge-left') ? parseFloat(style.getPropertyValue('--dock-width')) : 0)
    const originY = 9 + (main.querySelector('.plugin-tray')?.getBoundingClientRect().height ?? 0)
      + (dock?.classList.contains('edge-top') ? parseFloat(style.getPropertyValue('--dock-height')) : 0)
    return { width: rect.width, height: rect.height, scrollWidth: main.scrollWidth, scrollHeight: main.scrollHeight,
      usableWidth: Number(d.usableWidth), usableHeight: Number(d.usableHeight), originX, originY,
      overflow: getComputedStyle(main).overflow, cell: Number(d.cell), gutter: Number(d.gutter), pitch: Number(d.pitch),
      gridWidth: Number(d.gridWidth), gridHeight: Number(d.gridHeight), left: Number(d.gridLeft), top: Number(d.gridTop),
      widgets: [...main.querySelectorAll<HTMLElement>('[data-widget]')].map(w => { const r = w.getBoundingClientRect(); return { w: Number(w.dataset.w), h: Number(w.dataset.h), width: r.width, height: r.height, left: r.left - rect.left, top: r.top - rect.top } }) }
  })
  assert.equal(info.overflow, 'hidden'); assert.ok(info.scrollWidth <= info.width + 1 && info.scrollHeight <= info.height + 1)
  assert.ok(info.gridWidth <= info.width - 18 + .02 && info.gridHeight <= info.height - 18 + .02)
  assert.ok(Math.abs(info.left - info.originX - (info.usableWidth - info.gridWidth) / 2) < .02, 'Main grid stays horizontally centered')
  assert.ok(Math.abs(info.top - info.originY - (info.usableHeight - info.gridHeight) / 2) < .02, 'Main grid stays vertically centered')
  for (const p of info.widgets) {
    assert.ok(Math.abs((p.width + info.gutter) / p.w - info.pitch) < .02)
    assert.ok(Math.abs((p.height + info.gutter) / p.h - info.pitch) < .02)
    assert.ok(p.left >= 8.98 && p.top >= 8.98 && p.left + p.width <= info.width - 8.98 && p.top + p.height <= info.height - 8.98)
    if (p.w === p.h) assert.ok(Math.abs(p.width - p.height) < .02)
  }
  return info
}
export async function gridSmoke(page: Page, resizeWindow: (width: number, height: number) => Promise<void>) {
  await fit(page)
  // Windows can constrain the launch bounds to the display under forced DPR; establish A explicitly.
  await resizeWindow(1480, 980)
  assert.equal(await page.locator('main h1, main .workspace-toolbar, main .presentation-options, main .canvas-viewport, main .layout-canvas').count(), 0)
  const initialFit = await fit(page), initial = await placements(page)
  assert.ok(Math.abs(initialFit.left - (initialFit.width - initialFit.gridWidth) / 2) < .02)
  assert.ok(Math.abs(initialFit.top - (initialFit.height - initialFit.gridHeight) / 2) < .02)
  for (const theme of ['light', 'dark']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    const themeBytes = await page.evaluate(key => localStorage.getItem(key), GRID_KEY)
    await settings(page)
    assert.equal(await page.getByRole('checkbox', { name: /Centralizar grade/ }).count(), 0)
    await page.keyboard.press('Escape'); await fit(page)
    assert.deepEqual(await placements(page), initial)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), themeBytes)
  }
  const bytes = await page.evaluate(key => localStorage.getItem(key), GRID_KEY)
  assert.deepEqual(parseGrid(bytes!), DEFAULT_GRID)
  const measurements: unknown[] = []
  for (const [width, height] of [[1800, 720], [1280, 740], [1000, 1100], [1000, 720], [1480, 980]] as const) {
    await resizeWindow(width, height); const info = await fit(page)
    assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID))
    const usableWidth = info.width - 18, usableHeight = info.height - 18, old = fitGrid(usableWidth, usableHeight, DEFAULT_GRID)
    assert.ok(info.gridWidth / usableWidth >= .95 && info.gridHeight / usableHeight >= .95)
    if (Math.min(old.width / usableWidth, old.height / usableHeight) < .9) assert.ok(info.gridWidth * info.gridHeight > old.width * old.height)
    else assert.ok(info.gridWidth * info.gridHeight >= old.width * old.height * .95)
    measurements.push({ width, height, columns: await page.getByTestId('layout-canvas').getAttribute('data-columns'), rows: await page.getByTestId('layout-canvas').getAttribute('data-rows'), horizontalMargin: usableWidth - info.gridWidth, verticalMargin: usableHeight - info.gridHeight, oldHorizontalMargin: usableWidth - old.width, oldVerticalMargin: usableHeight - old.height })
    await page.screenshot({ path: `.local/diagnostics/grid-${width}x${height}${process.argv.includes('--dev') ? '-dev' : ''}${process.argv.includes('--scale125') ? '-125' : ''}.png` })
  }
  assert.deepEqual(await placements(page), initial)
  console.log(JSON.stringify({ subsystem: 'responsive coverage', measurements }))
  // Free native resize sweeps cross aspect bands; every projection uses the same stable source.
  for (let i = 0; i <= 12; i++) { await resizeWindow(1000 + i * 55, 720 + i * 17); await fit(page); assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID)) }
  await resizeWindow(1480, 980); await frame(page); assert.deepEqual(await placements(page), initial)
  await resizeWindow(0, 0); await fit(page); assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID))
  await resizeWindow(1480, 980); await fit(page); assert.deepEqual(await placements(page), initial)
  // Independently resize in non-cell CSS-pixel increments, preserving source bytes.
  const regionStarts = new Map<string, number>()
  for (const [name, dx, dy] of [['Largura da Sidebar', 37, 0], ['Altura da Bottom', 0, -53]] as const) {
    const separator = page.getByRole('separator', { name }), box = await separator.boundingBox(); assert.ok(box)
    const before = Number(await separator.getAttribute('aria-valuenow'))
    regionStarts.set(name, before)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy); await page.mouse.up(); await frame(page)
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), before + Math.abs(dx || dy))
    assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID)); await fit(page)
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), bytes)
  // Docked alters usable dimensions; Overlay leaves the complete projection alone.
  for (const presentation of ['overlay', 'docked']) for (const anchor of ['left', 'right', 'top', 'bottom']) {
    const before = await placements(page)
    await settings(page); await page.getByLabel('Apresentação do painel').selectOption(presentation); await page.getByLabel('Borda do painel').selectOption(anchor)
    await page.getByRole('button', { name: 'Abrir painel', exact: true }).click(); const info = await fit(page)
    const main = page.getByTestId('layout-canvas'), w = Number(await main.getAttribute('data-usable-width')), h = Number(await main.getAttribute('data-usable-height'))
    assert.ok(info.gridWidth / w >= .95 && info.gridHeight / h >= .95)
    assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID))
    if (presentation === 'overlay') assert.deepEqual(await placements(page), before)
    await page.getByRole('button', { name: 'Recolher painel', exact: true }).click(); await frame(page); assert.deepEqual(await placements(page), before)
  }
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), bytes)
  // Normal content interaction: title cannot move; forms and internal scrolling remain usable.
  const normal = await placements(page), point = await start(page, 'summary'); await drag(page, point, 1, 1); await page.mouse.up(); assert.deepEqual(await placements(page), normal)
  const input = page.locator('[data-widget="properties"] input:not([type="checkbox"])').first(); await input.fill('Teste de interação normal'); assert.equal(await input.inputValue(), 'Teste de interação normal')
  const scroll = page.locator('[data-widget="activity"] .widget-content')
  assert.ok(await scroll.evaluate(e => { e.scrollTop = e.scrollHeight; return e.scrollTop > 0 }))
  // Live collision preview, automatic compression, reversal and preferred-size persistence.
  await importDraft(page); const collisionStart = await placements(page), east = await start(page, 'summary', 'e')
  await drag(page, east, 1, 0)
  const collision = await placements(page); assert.equal(collision[0]!.w, 4)
  assert.equal(collision[1]!.h, collisionStart[1]!.h)
  await drag(page, east, 0, 0); assert.deepEqual(await placements(page), collisionStart)
  await drag(page, east, 1, 0); await page.mouse.up(); await page.getByTestId('save-layout').click()
  const compressed = parseGrid((await page.evaluate(key => localStorage.getItem(key), GRID_KEY))!)
  assert.equal(compressed.placements[1]!.preferred.w, DEFAULT_GRID.placements[1]!.w)
  // An impossible bounded resize retains the last valid snapshot and all seven widgets.
  const dense: GridSnapshot = { ...structuredClone(DEFAULT_GRID), columns: 9, rows: 6,
    placements: DEFAULT_GRID.placements.map((p, i) => ({ ...p, x: (i % 3) * 3, y: Math.floor(i / 3) * 2, w: 3, h: 2, preferred: { w: 3, h: 2 } })) }
  await importDraft(page, dense); const denseStart = await placements(page), corner = await start(page, 'summary', 'se')
  const pitch = Number(await page.getByTestId('layout-canvas').getAttribute('data-pitch'))
  await page.mouse.move(corner.x + 24 * pitch, corner.y + 24 * pitch); await frame(page)
  assert.deepEqual(await placements(page), denseStart); assert.ok((await page.locator('[data-widget="summary"]').getAttribute('class'))?.includes('invalid'))
  await page.getByRole('status').filter({ hasText: 'Sem espaço' }).waitFor(); await page.mouse.up()
  const keyboardCorner = page.locator('[data-widget="summary"] [data-resize="se"]'); await keyboardCorner.focus()
  await blockViaKeyboard(page)
  await page.getByRole('status').filter({ hasText: 'Sem espaço' }).waitFor()
  assert.ok((await page.locator('[data-widget="summary"]').getAttribute('class'))?.includes('invalid'))
  await page.getByTestId('cancel-layout').click()
  assert.equal(await page.locator('[data-widget].invalid').count(), 0)
  await importDraft(page, dense); await page.locator('[data-widget="summary"] [data-resize="se"]').focus()
  await blockViaKeyboard(page)
  await page.getByRole('status').filter({ hasText: 'Sem espaço' }).waitFor()
  await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-widget].invalid').count(), 0)
  await page.getByTestId('edit-layout').click(); assert.equal(await page.locator('[data-widget].invalid').count(), 0); await page.getByTestId('cancel-layout').click()
  // The eight-direction fixture requires a free ring. Restore region dimensions before testing it;
  // a compressed responsive topology may correctly reject corner growth at its packing limit.
  for (const [name, original] of regionStarts) {
    const separator = page.getByRole('separator', { name }), box = await separator.boundingBox(); assert.ok(box)
    const delta = original - Number(await separator.getAttribute('aria-valuenow'))
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + (name === 'Largura da Sidebar' ? delta : 0), box.y + box.height / 2 - (name === 'Altura da Bottom' ? delta : 0)); await page.mouse.up(); await frame(page)
    assert.equal(Number(await separator.getAttribute('aria-valuenow')), original)
  }
  // Eight directional zones with real outward/inward gestures in both themes.
  const loose: GridSnapshot = { ...structuredClone(DEFAULT_GRID), placements: [
    { id: 'summary', x: 4, y: 2, w: 4, h: 3 }, { id: 'queue', x: 0, y: 0, w: 3, h: 2 },
    { id: 'library', x: 9, y: 0, w: 3, h: 2 }, { id: 'notes', x: 0, y: 3, w: 3, h: 2 },
    { id: 'activity', x: 9, y: 3, w: 3, h: 2 }, { id: 'properties', x: 0, y: 6, w: 3, h: 2 },
    { id: 'chart', x: 9, y: 6, w: 3, h: 2 }
  ].map(p => ({ ...p, preferred: { w: p.w, h: p.h } })) }
  for (const theme of ['dark', 'light']) {
    if (await page.locator('.workbench').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const direction of DIRECTIONS) {
      await importDraft(page, loose); await fit(page); const old = await placements(page), original = old[0]!
      assert.equal(await page.locator(`[data-widget="summary"] [data-resize="${direction}"]`).getAttribute('aria-label'), 'Redimensionar Panorama: ' + ({ n: 'borda superior', s: 'borda inferior', e: 'borda direita', w: 'borda esquerda', ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo' })[direction])
      const target = await start(page, 'summary', direction), dx = direction.includes('w') ? -1 : direction.includes('e') ? 1 : 0, dy = direction.includes('n') ? -1 : direction.includes('s') ? 1 : 0
      await drag(page, target, dx, dy); const next = (await placements(page))[0]!
      assert.equal(next.w, original.w + (dx ? 1 : 0), direction); assert.equal(next.h, original.h + (dy ? 1 : 0), direction)
      if (direction.includes('w')) assert.equal(next.x + next.w, original.x + original.w); else assert.equal(next.x, original.x)
      if (direction.includes('n')) assert.equal(next.y + next.h, original.y + original.h); else assert.equal(next.y, original.y)
      await drag(page, target, 0, 0); assert.deepEqual(await placements(page), old)
      await drag(page, target, -dx, -dy); const inward = (await placements(page))[0]!
      assert.equal(inward.w, original.w - (dx ? 1 : 0)); assert.equal(inward.h, original.h - (dy ? 1 : 0))
      await page.keyboard.press('Escape'); assert.deepEqual(await placements(page), old); await page.mouse.up()
    }
    await page.screenshot({ path: `.local/diagnostics/grid-${theme}${process.argv.includes('--dev') ? '-dev' : ''}${process.argv.includes('--scale125') ? '-125' : ''}.png` })
  }
  await importDraft(page, loose)
  await importDraft(page, { ...loose, placements: loose.placements.map(p => p.id === 'summary' ? { ...p, w: 3, preferred: { w: 3, h: 3 } } : p) })
  for (const [w, h] of [[1800, 720], [1000, 1100], [1480, 980]]) {
    await resizeWindow(w!, h!); await fit(page); const square = (await placements(page))[0]!
    assert.equal(square.w, 3); assert.equal(square.h, 3)
  }
  await importDraft(page, loose)
  const keyboardStart = await placements(page)
  await page.getByRole('button', { name: 'Mover Panorama', exact: true }).focus(); await page.keyboard.press('ArrowDown')
  assert.equal((await placements(page))[0]!.y, keyboardStart[0]!.y + 1)
  const old = await placements(page), resize = page.locator('[data-widget="summary"] [data-resize="e"]'); await resize.focus(); await page.keyboard.press('ArrowRight')
  assert.equal((await placements(page))[0]!.w, old[0]!.w + 1)
  // Cancel/capture loss and pixel resize during capture restore the entire gesture snapshot.
  for (const cancel of ['pointercancel', 'lostpointercapture', 'region']) {
    const before = await placements(page), a = await start(page, 'summary'); await drag(page, a, 0, 1)
    if (cancel === 'region') { await page.getByRole('separator', { name: 'Largura da Sidebar' }).focus(); await page.keyboard.press('ArrowLeft') }
    else await page.locator('[data-widget="summary"] .widget-grip').evaluate((e, kind) => {
      const element = e as HTMLElement
      const pointerId = Number(element.dataset.testPointer)
      if (kind === 'pointercancel') element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }))
      else { assertCapture(); element.addEventListener('lostpointercapture', () => { element.dataset.testLost = 'true' }, { once: true }); element.releasePointerCapture(pointerId) }
      function assertCapture() { if (!element.hasPointerCapture(pointerId)) throw new Error('Expected real pointer capture before release') }
    }, cancel)
    // Chromium processes a pending capture release on the next pointer event.
    if (cancel === 'lostpointercapture') {
      await page.mouse.move(a.x + 1, a.y + Number(await page.getByTestId('layout-canvas').getAttribute('data-pitch')))
      assert.equal(await page.locator('[data-widget="summary"] .widget-grip').getAttribute('data-test-lost'), 'true')
    }
    await frame(page)
    if (cancel === 'region') {
      await page.getByRole('separator', { name: 'Largura da Sidebar' }).press('ArrowRight'); await frame(page)
      assert.deepEqual(await placements(page), before, 'region A→B→A cancels gesture without draft loss')
    }
    else assert.deepEqual(await placements(page), before, cancel)
    await page.mouse.up()
  }
  await page.getByTestId('cancel-layout').click(); assert.deepEqual(await placements(page), await projected(page, compressed))
  await importDraft(page, loose); await page.getByTestId('save-layout').click()
  const saved = await page.evaluate(key => localStorage.getItem(key), GRID_KEY); assert.ok(saved); parseGrid(saved)
  const savedView = await placements(page)
  await resizeWindow(1800, 720); await fit(page); assert.deepEqual(await placements(page), await projected(page, parseGrid(saved)))
  await resizeWindow(1480, 980); await fit(page)
  assert.deepEqual(await placements(page), savedView); assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), saved)
  await page.getByTestId('edit-layout').click(); await resizeWindow(1280, 740); await fit(page); await page.getByTestId('cancel-layout').click()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), saved)
  await resizeWindow(1480, 980); await fit(page)
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await frame(page); assert.deepEqual(await placements(page), await projected(page, parseGrid(saved))); await fit(page)
  // Storage failures and concurrent drafts leave edit active, never claim a successful Save.
  await page.getByTestId('edit-layout').click()
  const concurrent = JSON.stringify({ ...parseGrid(saved), theme: parseGrid(saved).theme === 'light' ? 'dark' : 'light' })
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: GRID_KEY, raw: concurrent })
  await page.getByTestId('save-layout').click(); assert.equal(await page.getByTestId('save-layout').count(), 1)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), concurrent)
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: GRID_KEY, raw: saved }); await page.getByTestId('cancel-layout').click()
  await page.getByTestId('edit-layout').click()
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError') } })
  await page.getByTestId('save-layout').click(); assert.equal(await page.getByTestId('save-layout').count(), 1)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), saved)
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  // Original fractional bytes survive conversion, Cancel, theme, explicit Save and reload.
  const legacy = JSON.stringify({ ...DEFAULT_LAYOUT, theme: 'dark' }, null, 2)
  await page.evaluate(({ key, legacy, oldKey }) => { localStorage.removeItem(key); localStorage.setItem(oldKey, legacy) }, { key: GRID_KEY, legacy, oldKey: IDENTITY.layoutStorageKey })
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), null)
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), null)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('cancel-layout').click()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacy)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey), legacy)
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  // Corrupt v2 is preserved and blocks composition until an explicit valid recovery preview.
  await page.evaluate(key => localStorage.setItem(key, '{corrupt grid'), GRID_KEY); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  assert.equal(await page.locator('[data-widget]').count(), 0); assert.equal(await page.getByTestId('edit-layout').isDisabled(), true)
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), '{corrupt grid')
  await settings(page); await page.getByRole('button', { name: 'Prévia da composição inicial', exact: true }).click(); await page.getByTestId('cancel-layout').click()
  assert.equal(await page.locator('[data-widget]').count(), 0); assert.equal(await page.evaluate(key => localStorage.getItem(key), GRID_KEY), '{corrupt grid')
  await importDraft(page); await page.getByTestId('save-layout').click()
  await settings(page); await page.locator('input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') })
  await page.getByRole('status').filter({ hasText: 'Arquivo inválido' }).waitFor(); assert.deepEqual(await placements(page), await projected(page, DEFAULT_GRID))
  if (await page.locator('.workbench').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  console.log(JSON.stringify({ result: 'passed', subsystem: 'integer grid', devicePixelRatio: await page.evaluate(() => devicePixelRatio), checks: ['square fit/no Main scroll', 'native 1000x720/1280x740/1480x980 resize', 'clean Main', 'mandatory centering/no alignment control in both themes', 'independent pixel splitters', 'normal forms/scroll', 'live collisions/compression/preferred persistence', 'impossible growth blocks', '8 directions both themes', 'live reversal/opposite anchors', 'keyboard', 'capture/Escape/region resize cancellation', 'Save/Cancel/reload', 'quota failure', 'read-only v1/theme migration', 'corrupt v2 recovery', 'invalid import'] }))
}
