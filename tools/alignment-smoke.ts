import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle, beginEdit } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-alignment-')), scale = process.argv.includes('--scale125') ? 1.25 : 1
const diagnostics = `.local/diagnostics/alignment-alpha29-${scale}`; await mkdir(diagnostics, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL; delete env.GEPPIO_TEST_DEMO_WIDGETS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
const app = await electron.launch({ args: ['.', ...(scale === 1.25 ? ['--force-device-scale-factor=1.25'] : [])], env, timeout: 30000 })
try {
  const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setContentSize(2000, 1200); w.show(); w.focus() })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); assert.equal(await page.evaluate(() => devicePixelRatio), scale)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click(); const manager = page.getByRole('dialog', { name: 'Plugins', exact: true })
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, resolve('.local/plugin-packages/workspace-essentials'))
  await manager.getByRole('button', { name: 'Instalar pasta local', exact: true }).click(); await manager.locator('[data-plugin="geppio.workspace-essentials"]').getByRole('switch').click()
  await page.waitForFunction(() => document.querySelector('[data-plugin="geppio.workspace-essentials"]')?.getAttribute('data-status') === 'active')
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click(); await page.getByTestId('edit-layout').click(); await settle(page)
  for (const name of ['notes', 'prompts']) { await page.locator(`[data-catalog-type="plugin:geppio.workspace-essentials:${name}"]`).click(); await page.locator('[data-widget-place="main"]').click(); await settle(page) }
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await beginEdit(page)
  const frame = (name: string) => page.locator('.widget-frame').filter({ has: page.locator(`[data-plugin-widget="geppio.workspace-essentials:${name}"]`) })
  const rect = (name: string) => frame(name).evaluate(node => ({ x: Number(node.getAttribute('data-x')), y: Number(node.getAttribute('data-y')), width: Number(node.getAttribute('data-w')), height: Number(node.getAttribute('data-h')) }))
  const original = await rect('notes'), peer = await rect('prompts')
  console.log('Alignment fixture', JSON.stringify({ original, peer }))
  await page.evaluate(() => performance.mark('geppio:anchors'))
  async function drag(cancel: boolean, theme: string) {
    const grip = frame('notes').locator('.widget-grip'); await frame('notes').hover({ position: { x: 40, y: 12 } }); const box = await grip.boundingBox(); assert.ok(box)
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(start.x, start.y); await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-plugin-widget="geppio.workspace-essentials:notes"]')!.closest('.widget-frame')!.querySelector('.widget-grip')!).pointerEvents === 'auto'); await page.mouse.down()
    const targetX = peer.x + (peer.width - original.width) / 2, targetY = peer.y + peer.height + 10
    assert.ok(await page.locator('[data-surface="main"]').evaluate((node, extent) => extent <= Number(node.getAttribute('data-usable-height')), targetY + original.height), 'The alignment fixture must fit below its chosen peer')
    await page.mouse.move(start.x + targetX - original.x + 4, start.y + targetY - original.y, { steps: 15 })
    await page.locator('[data-alignment-axis="x"]').waitFor(); assert.ok(Math.abs((await rect('notes')).x - targetX) < .1)
    await page.mouse.move(start.x + targetX - original.x + 20, start.y + targetY - original.y); await page.waitForFunction(() => !document.querySelector('[data-alignment-axis="x"]'))
    await page.mouse.move(start.x + targetX - original.x + 4, start.y + targetY - original.y); await page.locator('[data-alignment-axis="x"]').waitFor()
    await page.screenshot({ path: diagnostics + `/guide-${theme}.png` })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up(); await settle(page); assert.equal(await page.locator('[data-alignment-axis]').count(), 0)
  }
  await drag(true, 'dark'); assert.deepEqual(await rect('notes'), original)
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click(); await settle(page)
  await drag(false, 'light'); const accepted = await rect('notes')
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.deepEqual(await rect('notes'), original)
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.deepEqual(await rect('notes'), accepted)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); const saved = await page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page); assert.equal(await page.evaluate(() => localStorage.getItem('geppio:workbench:v1')), saved)
  await beginEdit(page); assert.deepEqual(await rect('notes'), accepted); assert.deepEqual(errors, [])
  await page.getByTestId('cancel-layout').click(); await settle(page)
  const seed = await page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
  async function separated() {
    await page.evaluate(raw => {
      const doc = JSON.parse(raw!), port = document.querySelector<HTMLElement>('[data-surface="main"]')!
      doc.layout.reference.main = { width: Number(port.dataset.usableWidth), height: Number(port.dataset.usableHeight) }
      for (const p of doc.layout.placements) {
        const view = doc.organization.views.find((view: { id: string }) => view.id === p.id), peer = view.typeId.endsWith(':notes')
        Object.assign(p, { x: peer ? 200 : 450, y: peer ? 0 : 300, width: 200, height: 180, preferred: { width: 200, height: 180 } })
      }
      localStorage.setItem('geppio:workbench:v1', JSON.stringify(doc))
    }, seed)
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page); await beginEdit(page); await page.bringToFront(); await settle(page)
    await page.evaluate(() => {
      performance.mark('geppio:anchors')
      const trace: unknown[] = []; Object.assign(window, { alignmentPointerEvidence: trace })
      for (const type of ['pointerdown', 'pointerup', 'gotpointercapture', 'lostpointercapture', 'pointercancel']) document.addEventListener(type, event => { const e = event as PointerEvent, node = event.target as Element; trace.push({ type, x: e.clientX, y: e.clientY, buttons: e.buttons, target: node.outerHTML?.slice(0, 150), focused: document.hasFocus() }); if (trace.length > 30) trace.shift() }, true)
    })
  }
  async function resize(direction: string, dx: number, dy: number, cancel = false) {
    const handle = frame('prompts').locator(`[data-resize="${direction}"]`); await handle.hover(); const box = await handle.boundingBox(); assert.ok(box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); assert.equal(await handle.evaluate(node => node.hasPointerCapture(1)), true)
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 }); await settle(page)
    assert.equal(await handle.evaluate(node => node.hasPointerCapture(1)), true, JSON.stringify(await page.evaluate(() => ({ events: Reflect.get(window, 'alignmentPointerEvidence'), feedback: document.querySelector('.workspace-feedback')?.textContent }))))
    const after = await rect('prompts'); assert.equal(after.x + after.width, 650)
    for (const axis of direction === 'nw' ? ['x', 'y'] : ['x']) {
      const guide = page.locator(`[data-alignment-axis="${axis}"]`); await guide.waitFor()
      if (dx !== -146) { assert.equal(await guide.getAttribute('data-alignment-kind'), 'spacing'); assert.equal(await guide.getAttribute('data-alignment-gap'), '10'); assert.equal(Number(await guide.getAttribute('data-alignment-line')) - Number(await guide.getAttribute('data-alignment-peer-line')), 10) }
    }
    await page.screenshot({ path: diagnostics + `/resize-${direction}-${cancel}.png` })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up(); await settle(page); assert.equal(await page.locator('[data-alignment-axis]').count(), 0)
    return after
  }
  await separated(); const lower = await rect('prompts'), upper = await rect('notes')
  await resize('w', -36, 0, true); assert.deepEqual(await rect('prompts'), lower)
  const spaced = await resize('w', -36, 0); assert.equal(spaced.x, 410); assert.equal(spaced.x - upper.x - upper.width, 10)
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.deepEqual(await rect('prompts'), lower)
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.deepEqual(await rect('prompts'), spaced)
  const move = frame('prompts').locator('.widget-grip'); await frame('prompts').hover({ position: { x: 25, y: 12 } }); await move.hover(); const gripBox = await move.boundingBox(); assert.ok(gripBox)
  await page.mouse.down(); await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 - 300, { steps: 12 }); await page.mouse.up(); await settle(page)
  assert.deepEqual(await rect('notes'), upper); assert.equal((await rect('prompts')).y, 0); assert.equal((await rect('prompts')).x, 410)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); const gapSaved = await page.evaluate(() => localStorage.getItem('geppio:workbench:v1'))
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem('geppio:workbench:v1')), gapSaved)
  await separated(); const corner = await resize('nw', -36, -106); assert.deepEqual([corner.x, corner.y, corner.x + corner.width, corner.y + corner.height], [410, 190, 650, 480])
  await page.getByTestId('cancel-layout').click(); await settle(page); await separated(); const centered = await resize('w', -146, 0); assert.equal(centered.x, 300)
  assert.deepEqual(errors, [])
  console.log(`PASS alignment: real move/resize/corner/center, settled 400/410 spacing and upward move, opposite anchors, cancel/history/restart, both themes; automated DPR ${scale}`)
} catch (error) { const page = await app.firstWindow(); console.error('Alignment gesture evidence', JSON.stringify(await page.evaluate(() => performance.getEntriesByName('geppio:anchor-solve').map(entry => (entry as PerformanceMeasure).detail)))); await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}); throw error }
finally { await app.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); await rm(profile, { recursive: true, force: true }) }
