import { _electron as electron } from 'playwright'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { WORKBENCH_KEY } from '../tests/fixtures/workbench.ts'
import { settle as settleDesktop } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-alpha13-functional-'))
await mkdir('.local/diagnostics', { recursive: true })
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), GEPPIO_TEST_USER_DATA: profile, NODE_ENV: 'production' }
env.GEPPIO_TEST_DEMO_WIDGETS = '1'
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: ['.'], env })
const appProcess = app.process()
const errors: string[] = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080))
  await page.getByTestId('edit-layout').waitFor()
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.show(); window.focus() })
  await page.bringToFront()
  await page.evaluate(() => localStorage.setItem('geppio.locale', 'pt-BR')); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  const settle = () => settleDesktop(page)
  const input = page.getByRole('textbox', { name: 'Nome de exemplo', exact: true })
  await input.fill('estado preservado'); await input.evaluate(e => e.setAttribute('data-proof', 'same'))
  await page.getByTestId('edit-layout').click(); await settle()
  await page.locator('.widget-catalog-toggle').click(); await settle()
  await page.evaluate(() => {
    const host = window as unknown as { dragMeasureCount: number; restoreDragMeasure(): void }, original = Element.prototype.getBoundingClientRect
    host.dragMeasureCount = 0
    host.restoreDragMeasure = () => { Element.prototype.getBoundingClientRect = original }
    Element.prototype.getBoundingClientRect = function() { if (this.matches('.placement-port,.layout-drag-label,.layout-drag-node')) host.dragMeasureCount++; return original.call(this) }
  })
  try {
    const move = await page.locator('[data-widget="properties"] .widget-grip').boundingBox(), main = await page.locator('[data-surface="main"]').boundingBox(); assert.ok(move && main)
    const pointer = { x: main.x + main.width / 2, y: main.y + main.height / 2 }
    await page.locator('[data-widget="properties"]').hover()
    await page.locator('[data-widget="properties"] .widget-grip').hover(); await page.mouse.down()
    assert.ok(await page.locator('[data-widget="properties"] .widget-grip').evaluate(node => node.hasPointerCapture(1)), 'Pickup requires native grip capture')
    await page.mouse.move(pointer.x, pointer.y)
    await page.waitForFunction(pointer => { const rect = document.querySelector('.layout-drag-node')?.getBoundingClientRect(); return rect && Math.abs(rect.left - pointer.x + 4) < .06 && Math.abs(rect.top - pointer.y + 4) < .06 }, pointer)
    // Quantized DOM coordinates can reach the tolerance just before the 220ms
    // clock finishes. Drain its last frame and the resulting layout notification.
    await settle()
    const idleReads = await page.evaluate(async () => {
      const host = window as unknown as { dragMeasureCount: number }, before = host.dragMeasureCount
      await new Promise<void>(resolve => { let frames = 10; const tick = () => { if (--frames) requestAnimationFrame(tick); else resolve() }; requestAnimationFrame(tick) })
      return host.dragMeasureCount - before
    })
    assert.equal(idleReads, 0, 'A parked pointer sleeps after pickup; no repeated target/label measurement loop')
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
  } finally { await page.evaluate(() => (window as unknown as { restoreDragMeasure(): void }).restoreDragMeasure()) }
  const sidebarOwner = page.locator('[data-region="sidebar"]')
  const notesEdge = await page.locator('[data-widget="notes"] [data-resize="s"]').boundingBox(); assert.ok(notesEdge)
  await page.mouse.move(notesEdge.x + notesEdge.width / 2, notesEdge.y + notesEdge.height / 2); await page.mouse.down()
  assert.ok(await page.locator('[data-widget="notes"] [data-resize="s"]').evaluate(node => node.hasPointerCapture(1)), 'Sidebar resize requires actual edge capture')
  await page.mouse.move(notesEdge.x + notesEdge.width / 2, notesEdge.y + notesEdge.height / 2 + 500, { steps: 8 }); await settle(); await page.mouse.up(); await settle()
  assert.ok(await sidebarOwner.evaluate(node => node.scrollHeight > node.clientHeight), JSON.stringify({ reason: 'The real Sidebar fixture must overflow vertically', edge: notesEdge, notes: await page.locator('[data-widget="notes"]').getAttribute('data-h'), owner: await sidebarOwner.evaluate(node => ({ height: node.clientHeight, scroll: node.scrollHeight })) }))
  const moving = await page.locator('[data-widget="properties"] .widget-grip').boundingBox(), sidebarBox = await sidebarOwner.boundingBox(); assert.ok(moving && sidebarBox)
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2); await page.mouse.down()
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, sidebarBox.y + sidebarBox.height - 12)
  await page.waitForFunction(() => document.querySelector('[data-region="sidebar"]')!.scrollTop > 14)
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, sidebarBox.y + 12)
  await page.waitForFunction(() => document.querySelector('[data-region="sidebar"]')!.scrollTop < 1)
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle()
  assert.equal(await page.locator('[data-widget="notes"]').getAttribute('data-h'), '300', 'Edge scrolling and a canceled drag add no extra history intention')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), null, 'Edge scrolling never saves a viewport change')
  await page.getByTestId('save-layout').click()
  await page.waitForFunction(key => localStorage.getItem(key) !== null, WORKBENCH_KEY)
  assert.equal(await page.getByTestId('cancel-layout').count(), 1)
  assert.equal(await input.inputValue(), 'estado preservado')
  const before = await page.locator('[data-widget="summary"]').getAttribute('data-h')
  const handle = await page.locator('[data-widget="summary"] [data-resize="s"]').boundingBox(); assert.ok(handle)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y + 23.25, { steps: 4 }); await page.mouse.up()
  assert.notEqual(await page.locator('[data-widget="summary"]').getAttribute('data-h'), before)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle()
  assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-h'), before)
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle()
  assert.notEqual(await page.locator('[data-widget="summary"]').getAttribute('data-h'), before)
  await page.getByTestId('save-layout').click(); await settle()
  const saved = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await page.locator('[data-widget="notes"]').hover()
  await page.getByRole('button', { name: 'Remover Ideias em aberto', exact: true }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await settle()
  assert.equal(await page.locator('[data-widget="notes"]').count(), 0)
  await page.getByTestId('cancel-layout').click(); await settle()
  assert.equal(await page.locator('[data-widget="notes"]').count(), 1)
  assert.equal(await input.getAttribute('data-proof'), 'same'); assert.equal(await input.inputValue(), 'estado preservado')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), saved)
  // Normal-mode pairs commit only their accepted bilateral intention.
  const normalBefore = JSON.parse(saved!)
  const pair = await page.locator('[data-pair-first="properties"][data-pair-second="activity"][data-pair-axis="x"]').boundingBox(); assert.ok(pair)
  await page.mouse.move(pair.x + pair.width / 2, pair.y + pair.height / 2); await page.mouse.down()
  assert.ok(await page.locator('[data-pair-first="properties"][data-pair-second="activity"][data-pair-axis="x"]').evaluate(node => node.hasPointerCapture(1)), 'Normal resizePair requires actual pointer capture')
  await page.mouse.move(pair.x + pair.width / 2 + 12.25, pair.y + pair.height / 2); await settle(); await page.mouse.up()
  await page.waitForFunction(({ key, saved }) => localStorage.getItem(key) !== saved, { key: WORKBENCH_KEY, saved })
  const normalAfter = JSON.parse((await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY))!)
  assert.deepEqual(normalAfter.organization, normalBefore.organization)
  assert.deepEqual(normalAfter.layout.placements.filter((p: { id: string }) => !['properties', 'activity'].includes(p.id)), normalBefore.layout.placements.filter((p: { id: string }) => !['properties', 'activity'].includes(p.id)))
  const pairBytes = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), pairWidth = await page.locator('[data-widget="properties"]').getAttribute('data-w')
  const canceledPair = await page.locator('[data-pair-first="properties"][data-pair-second="activity"][data-pair-axis="x"]').boundingBox(); assert.ok(canceledPair)
  await page.mouse.move(canceledPair.x + canceledPair.width / 2, canceledPair.y + canceledPair.height / 2); await page.mouse.down()
  await page.mouse.move(canceledPair.x + canceledPair.width / 2 + 18.5, canceledPair.y + canceledPair.height / 2); await settle()
  assert.notEqual(await page.locator('[data-widget="properties"]').getAttribute('data-w'), pairWidth)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), pairBytes, 'A held normal pair remains only a preview')
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
  assert.equal(await page.locator('[data-widget="properties"]').getAttribute('data-w'), pairWidth)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), pairBytes, 'Escape cancels only the pair without a write')
  await page.locator('[data-bar-id="home"]').click(); await settle()
  await page.mouse.move(700, 500)
  await page.locator('[data-bar-id="home"]').hover()
  await page.waitForFunction(() => document.querySelector('.workbench')!.getAttribute('data-sidebar-mode') === 'peek')
  await settle()
  assert.equal(await page.evaluate(() => {
    const floating = document.querySelector('.sidebar-floating')!.getBoundingClientRect(), divider = document.querySelector('[data-pair-first="summary"][data-pair-second="properties"][data-pair-axis="y"]')!.getBoundingClientRect()
    return !!document.elementFromPoint(floating.left + floating.width / 2, divider.top + divider.height / 2)?.closest('.host-pair-divider')
  }), false, 'Main dividers never intercept the floating Sidebar above the peek backdrop')
  await page.mouse.move(700, 500)
  await page.waitForFunction(() => document.querySelector('.workbench')!.getAttribute('data-sidebar-mode') === 'hidden')
  await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).click(); await settle()
  assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'hidden')
  assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), 'hidden')
  await page.getByTestId('edit-layout').click(); await settle()
  await page.locator('.widget-catalog-toggle').click(); await settle()
  assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'docked')
  assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), 'docked')
  await page.getByTestId('save-layout').click(); await settle()
  const forced = JSON.parse((await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY))!).organization.chrome
  assert.equal(forced.sidebar.visible, false, 'Temporary edit visibility must never be confirmed by Save')
  assert.equal(forced.bottom.visible, false)
  await page.locator('[data-widget="summary"] .widget-heading').click({ modifiers: ['Control'] })
  await page.locator('[data-widget="notes"] .widget-heading').click({ modifiers: ['Control'] })
  const swap = await page.locator('[data-widget="summary"] .widget-swap-control').boundingBox(), notes = await page.locator('[data-widget="notes"]').boundingBox(); assert.ok(swap && notes)
  await page.mouse.move(swap.x + swap.width / 2, swap.y + swap.height / 2); await page.mouse.down()
  await page.mouse.move(notes.x + notes.width / 2, notes.y + notes.height / 2, { steps: 5 }); await page.mouse.up(); await settle()
  assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'sidebar')
  assert.equal(await page.locator('[data-widget="notes"]').getAttribute('data-owner-region'), 'main')
  assert.equal(await page.locator('.widget-frame[data-swap-selected]').count(), 2, 'A successful swap preserves selection for another swap')
  assert.equal(await input.getAttribute('data-proof'), 'same')
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle()
  assert.equal(await page.locator('[data-widget="summary"]').getAttribute('data-owner-region'), 'main')
  const sidebar = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true }), width = Number(await sidebar.getAttribute('aria-valuenow')), divider = await sidebar.boundingBox(); assert.ok(divider)
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2); await page.mouse.down()
  assert.ok(await sidebar.evaluate(node => node.hasPointerCapture(1)), 'Sidebar splitter requires native pointer capture')
  await page.mouse.move(divider.x + divider.width / 2 + 24, divider.y + divider.height / 2)
  await page.waitForFunction(width => Number(document.querySelector('[aria-label="Largura da Sidebar"]')!.getAttribute('aria-valuenow')) === width + 24, width)
  await page.mouse.up(); await settle()
  assert.equal(Number(await sidebar.getAttribute('aria-valuenow')), width + 24)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle()
  assert.equal(Number(await sidebar.getAttribute('aria-valuenow')), width, 'One region gesture is one history intention')
  await page.locator('.widget-catalog-toggle').click(); await settle()
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  await page.locator('[data-composition-id="system:default"]').hover()
  await page.locator('[data-composition-id="system:default"] .composition-restore-button').first().click(); await settle()
  await page.locator('[data-composition-id="system:default"]').hover()
  await page.locator('[data-composition-id="system:default"] .composition-restore-button').first().click(); await settle()
  const slots = await page.locator('.host-format-slot').count()
  assert.ok(slots > 0, 'An applied format with fewer widgets must keep temporary empty slots')
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Buscar widgets ou plugins', exact: true })
  await search.fill('Panorama')
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  await page.locator('.host-format-slot').first().click(); await settle()
  assert.equal(await search.inputValue(), '', 'Slot choice temporarily resets filters')
  assert.equal(await page.getByRole('tab', { name: 'Widgets', exact: true }).getAttribute('aria-selected'), 'true')
  await page.locator('.host-format-slot').last().click(); await settle()
  assert.equal(await page.locator('.catalog-slot-context').isVisible(), true)
  await page.getByRole('button', { name: 'Cancelar seleção de widget', exact: true }).click(); await settle()
  assert.equal(await page.getByRole('tab', { name: 'Composições', exact: true }).getAttribute('aria-selected'), 'true', 'Retargeting preserves the original tab')
  await page.getByRole('tab', { name: 'Widgets', exact: true }).click()
  assert.equal(await search.inputValue(), 'Panorama', 'Leaving slot choice restores the previous filters')
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  const slotBefore = await page.locator('.host-format-slot').first().boundingBox(); assert.ok(slotBefore)
  const beforeViewportBytes = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 900)); await settle()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080)); await settle()
  const slotAfter = await page.locator('.host-format-slot').first().boundingBox(); assert.ok(slotAfter)
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(slotAfter[key] - slotBefore[key]) < .06, 'Session slots return to their original reference after viewport A/B/A')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), beforeViewportBytes, 'Slot viewport projections never save')
  await page.getByTestId('save-layout').click(); await settle()
  assert.equal(await page.locator('.host-format-slot').count(), slots, 'Save editing retains temporary slots')
  const checkpoint = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  await page.evaluate(key => {
    const original = Storage.prototype.setItem
    ;(window as unknown as { restoreWorkbenchStorage(): void }).restoreWorkbenchStorage = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function(k, value) { if (k === key) throw new Error('Disposable quota failure'); original.call(this, k, value) }
  }, WORKBENCH_KEY)
  await page.getByTestId('conclude-layout').click()
  await page.locator('.workspace-feedback').filter({ hasText: 'Não foi possível salvar.' }).waitFor()
  assert.equal(await page.locator('.host-format-slot').count(), slots, 'Failed Conclude retains slot UI')
  assert.equal(await page.getByTestId('cancel-layout').count(), 1, 'Failed Conclude keeps editing')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), checkpoint)
  await page.evaluate(() => (window as unknown as { restoreWorkbenchStorage(): void }).restoreWorkbenchStorage())
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle()
  assert.equal(await page.locator('.host-format-slot').count(), 0, 'Only successful Conclude clears slots')
  await page.getByRole('button', { name: 'Minimizar', exact: true }).click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized()), true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.restore())
  await page.getByRole('button', { name: 'Maximizar', exact: true }).click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()), true)
  await page.getByRole('button', { name: 'Maximizar', exact: true }).click()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()), false)
  assert.deepEqual(errors, [])
  const processClosed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native Close did not terminate the disposable app')), 10000)
    appProcess.once('exit', () => { clearTimeout(timer); resolve() })
  })
  const closeClick = page.getByRole('button', { name: 'Fechar', exact: true }).click().catch(async error => {
    // Native Close can destroy CDP before its click acknowledgement arrives.
    // Accept only that specific acknowledgement race after proving clean exit.
    if (!(error instanceof Error) || !error.message.includes('Target page, context or browser has been closed')) throw error
    await processClosed
    assert.equal(page.isClosed(), true); assert.equal(appProcess.exitCode, 0)
  })
  await Promise.all([processClosed, page.waitForEvent('close'), closeClick])
  assert.equal(appProcess.exitCode, 0, 'Native Close exits the actual disposable process successfully')
  console.log('PASS alpha13 functional: checkpoint/history/remove/cancel/form identity, normal pair, cross-region drag swap/undo, slots/failed Conclude and all three native window controls')
} catch (error) {
  console.error('Renderer errors:', errors)
  console.error('Functional smoke failure:', error)
  try {
  const page = await app.firstWindow()
  await page.screenshot({ path: '.local/diagnostics/workbench-failure.png' })
  await writeFile('.local/diagnostics/workbench-failure.json', JSON.stringify(await page.evaluate(() => ({ focused: document.hasFocus(), viewport: [innerWidth, innerHeight],
    hovered: [...document.querySelectorAll(':hover')].map(node => node.tagName + '.' + node.className),
    controls: [...document.querySelectorAll<HTMLElement>('.layout-widget-remove,.composition-restore-button')].map(node => ({ name: node.getAttribute('aria-label') ?? node.textContent, opacity: getComputedStyle(node).opacity, pointer: getComputedStyle(node).pointerEvents, rect: node.getBoundingClientRect().toJSON() })) })), null, 2))
  } catch (diagnosticError) { console.error('Failure capture unavailable:', String(diagnosticError)) }
  throw error
}
finally { if (appProcess.exitCode === null) await app.close(); await rm(profile, { recursive: true, force: true }) }
