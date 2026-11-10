import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { portugueseFixture, settle, beginEdit } from './freeform-smoke.ts'
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-alignment-')), scale = process.argv.includes('--scale125') ? 1.25 : 1
const diagnostics = `.local/diagnostics/alignment-alpha27-${scale}`; await mkdir(diagnostics, { recursive: true })
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
  for (const name of ['notes', 'checklist', 'prompts']) { await page.locator(`[data-catalog-type="plugin:geppio.workspace-essentials:${name}"]`).click(); await page.locator('[data-widget-place="main"]').click(); await settle(page) }
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
  console.log(`PASS alignment: real Main mouse enter/release/cancel/drop, both themes, undo/redo and restart; automated DPR ${scale}`)
} catch (error) { const page = await app.firstWindow(); console.error('Alignment gesture evidence', JSON.stringify(await page.evaluate(() => performance.getEntriesByName('geppio:anchor-solve').map(entry => (entry as PerformanceMeasure).detail)))); await page.screenshot({ path: diagnostics + '/failure.png' }).catch(() => {}); throw error }
finally { await app.close(); assert.equal(dirname(resolve(profile)), resolve(tmpdir())); await rm(profile, { recursive: true, force: true }) }
