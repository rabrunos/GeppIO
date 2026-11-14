import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { expansion, settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/shared/workbench/model.ts'

/** Runs inside the real installed-widget maximize smoke, with its disposable profile. */
export async function editorGeometry(app: ElectronApplication, page: Page, profile: string, diagnostics: string, scale: number) {
  const file = join(await realpath(profile), 'editor-geometry.json'), original = '{"estado":"original"}\r\n'
  const draft = '{"estado":"não salvo 😀"}\n', saved = '{"estado":"não salvo 😀"}\r\n'
  await writeFile(file, original)
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
  const root = page.locator('.workbench'), editor = page.locator('.direct-file-editor')
  const notes = page.locator('[data-plugin-widget="geppio.workspace-essentials:notes"]').locator('xpath=ancestor::section[contains(@class,"widget-frame")]')
  const text = page.getByRole('textbox', { name: 'Conteúdo do arquivo', exact: true })
  const mode = async (name: 'Editor' | 'Widgets') => { await page.locator('.file-mode-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const raw = () => page.evaluate(async key => navigator.locks.request(key, () => localStorage.getItem(key)), WORKBENCH_KEY)
  const resize = async (width: number, height: number) => {
    await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, height), { width, height }); await settle(page)
  }
  const measure = async (selector: string) => page.locator(selector).evaluate(node => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node)
    const main = document.querySelector('[data-region="main"]')!, region = main.getBoundingClientRect(), style = getComputedStyle(main)
    const bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    const expected = { left: region.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      top: region.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      right: region.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      bottom: region.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom) }
    const frame = { radius: css.borderRadius, border: css.border, overflow: css.overflow, background: css.backgroundColor }
    const insets = { left: rect.left - region.left, top: rect.top - region.top, right: region.right - rect.right, bottom: region.bottom - rect.bottom }
    return { bounds, expected, frame, insets, dpr: devicePixelRatio }
  })
  type Sample = Awaited<ReturnType<typeof measure>>
  const near = (a: Sample['bounds'], b: Sample['bounds'], label: string) => {
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) assert.ok(Math.abs(a[edge] - b[edge]) < .06, `${label} ${edge}: ${a[edge]} != ${b[edge]}`)
  }
  const geometry = () => notes.evaluate(node => ['data-x', 'data-y', 'data-w', 'data-h'].map(key => node.getAttribute(key)))
  const initialTheme = await root.getAttribute('data-theme'), workers = page.workers()
  await mode('Editor'); await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
  await text.waitFor(); await text.fill(draft)
  const id = await page.locator('.file-editor').getAttribute('data-document-id')
  const samples: { theme: string; expanded: boolean; sidebar: boolean; bottom: boolean; width: number; height: number; scrollLeft: number; direct: Sample; maximized: Sample }[] = []
  for (const theme of ['light', 'dark']) {
    if (await root.getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const expanded of [false, true]) {
      await expansion(page, expanded)
      assert.equal(await page.locator('[data-region="main"]').getAttribute('data-expanded'), String(expanded))
      for (const [sidebar, bottom] of [[true, true], [false, true], [false, false], [true, false]]) {
        if ((await root.getAttribute('data-sidebar-mode') === 'docked') !== sidebar) { await page.getByRole('button', { name: 'Ferramentas', exact: true }).click(); await settle(page) }
        if ((await root.getAttribute('data-bottom-mode') === 'docked') !== bottom) { await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page) }
        assert.equal(await root.getAttribute('data-sidebar-mode'), sidebar ? 'docked' : 'hidden')
        assert.equal(await root.getAttribute('data-bottom-mode'), bottom ? 'docked' : 'hidden')
        for (const [width, height] of [[1920, 1080], [1024, 768]]) {
          // Resize the actual native window while Editor is visible, then compare
          // with the real maximized Notes frame at precisely the same chrome state.
          await resize(width!, height!)
          assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [width, height])
          const scrollLeft = await page.locator('[data-surface="main"]').evaluate((node, expanded) => { node.scrollLeft = expanded ? node.scrollWidth : 0; return node.scrollLeft }, expanded)
          await settle(page)
          const before = await raw(), direct = await measure('.direct-file-editor')
          near(direct.bounds, direct.expected, 'Editor usable Main'); assert.ok(Math.abs(direct.dpr - scale) < .01)
          const content = await editor.evaluate(node => {
            const css = getComputedStyle(node), r = node.getBoundingClientRect(), inner = { left: r.left + parseFloat(css.borderLeftWidth), top: r.top + parseFloat(css.borderTopWidth), right: r.right - parseFloat(css.borderRightWidth), bottom: r.bottom - parseFloat(css.borderBottomWidth) }
            const rows = [...node.querySelectorAll<HTMLElement>('.file-editor > *')].map(child => child.getBoundingClientRect())
            const contained = rows.every(row => row.left >= inner.left - .06 && row.right <= inner.right + .06 && row.top >= inner.top - .06 && row.bottom <= inner.bottom + .06)
            const ordered = rows.every((row, index) => index === 0 || row.top >= rows[index - 1]!.bottom - .06)
            const reachable = [...node.querySelectorAll('button,textarea')].every(child => { const box = child.getBoundingClientRect(); return child.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })
            const clippedCorners = [[r.left + .5, r.top + .5], [r.right - .5, r.top + .5], [r.left + .5, r.bottom - .5], [r.right - .5, r.bottom - .5]].every(([x, y]) => !node.contains(document.elementFromPoint(x!, y!)))
            return { contained, ordered, reachable, clippedCorners, overflow: node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight }
          })
          assert.deepEqual(content, { contained: true, ordered: true, reachable: true, clippedCorners: true, overflow: true })
          assert.equal(await text.inputValue(), draft); assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), id)
          assert.equal(await root.getAttribute('data-maximized-surface'), null)
          await mode('Widgets')
          await page.locator('[data-surface="main"]').evaluate(node => { node.scrollLeft = 0 }); await settle(page)
          const normal = await geometry()
          await notes.getByRole('button', { name: 'Maximizar Anotações', exact: true }).click()
          await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-maximize-phase') === 'expanded'); await settle(page)
          const selector = '.widget-frame[data-widget-id="' + await notes.getAttribute('data-widget-id') + '"]'
          const maximized = await measure(selector)
          near(maximized.bounds, maximized.expected, 'Maximized usable Main'); near(direct.bounds, maximized.bounds, 'Editor = maximized Notes')
          assert.deepEqual(direct.frame, maximized.frame); assert.deepEqual(direct.insets, maximized.insets)
          if (sidebar && bottom && width === 1920) await page.screenshot({ path: join(diagnostics, `notes-${theme}-${expanded}.png`) })
          await notes.getByRole('button', { name: 'Restaurar Anotações', exact: true }).click(); await settle(page)
          assert.deepEqual(await geometry(), normal)
          await mode('Editor'); assert.equal(await text.inputValue(), draft); assert.equal(await page.locator('.file-editor').getAttribute('data-document-dirty'), 'true')
          assert.equal(await raw(), before); assert.deepEqual(page.workers(), workers)
          assert.equal(await readFile(file, 'utf8'), original)
          if (sidebar && bottom && width === 1920) await page.screenshot({ path: join(diagnostics, `editor-${theme}-${expanded}.png`) })
          samples.push({ theme, expanded, sidebar: sidebar!, bottom: bottom!, width: width!, height: height!, scrollLeft, direct, maximized })
        }
      }
    }
  }
  assert.ok(samples.some(sample => sample.expanded && sample.scrollLeft > 0), 'Expanded Main is exercised with an actual horizontally scrolled world')
  // Keyboard splitter resizing while Editor remains mounted must follow the same host rectangle.
  if (await root.getAttribute('data-bottom-mode') !== 'docked') { await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).press('Enter'); await settle(page) }
  for (const [name, key] of [['Largura da Sidebar', 'ArrowRight'], ['Altura da Bottom', 'ArrowUp']]) {
    const separator = page.getByRole('separator', { name, exact: true }); await separator.press(key!); await text.focus(); await settle(page)
    const result = await measure('.direct-file-editor'); near(result.bounds, result.expected, 'Editor resized region')
  }
  const beforeSave = await raw(); await text.press('Control+s')
  await page.waitForFunction(() => document.querySelector('.file-editor')?.getAttribute('data-document-dirty') === 'false')
  assert.equal(await readFile(file, 'utf8'), saved); assert.equal(await raw(), beforeSave)
  await page.getByRole('button', { name: 'Fechar arquivo', exact: true }).click()
  await mode('Widgets'); await expansion(page, false); await resize(1920, 1080)
  if (await root.getAttribute('data-theme') !== initialTheme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  await writeFile(join(diagnostics, 'editor-geometry.json'), JSON.stringify(samples, null, 2))
  console.log(`PASS Editor geometry: ${samples.length} measured Notes comparisons at DPR ${scale}; both themes, narrow/wide, Sidebar/Bottom, expansion, region resizing, clipped corners/controls, dirty session, exact disk/layout bytes and Workers`)
}
