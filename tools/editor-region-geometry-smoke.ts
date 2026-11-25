import { fileEditor, pluginWorkers } from './monaco-support.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { settle } from './freeform-smoke.ts'
import { WORKBENCH_KEY } from '../src/geppio/src/shared/workbench/model.ts'

/** Real DOM owner/port oracle, exercised by the live PowerShell/document smoke at both DPRs. */
export async function editorRegionGeometry(app: ElectronApplication, page: Page, diagnostics: string, scale: number) {
  const root = page.locator('.workbench'), workers = pluginWorkers(page)
  const editor = fileEditor(page)
  const draft = await editor.inputValue(), doc = await page.locator('.file-editor').getAttribute('data-document-id')
  const native = await page.evaluate(() => window.geppio!.terminal.read(null, 0))
  assert.ok(native.ok)
  const emulator = await page.locator('.terminal-emulator').elementHandle()
  const navigation = () => page.locator('[data-explorer-node]').evaluateAll(nodes => nodes.map(n => [n.getAttribute('data-explorer-node'), n.getAttribute('aria-expanded'), n.getAttribute('aria-selected')]))
  const nav = await navigation()
  const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const mode = async (name: 'GeppIO Code' | 'Bancada de Trabalho') => { await page.locator('.experience-switch').getByRole('button', { name, exact: true }).click(); await settle(page) }
  const samples = []
  async function configure(name: 'GeppIO Code' | 'Bancada de Trabalho', size: 'Home' | 'End', sidebar: 'docked' | 'hidden' | 'peek', bottom: boolean) {
    await mode(name)
    await page.mouse.move(850, 100)
    if (await root.getAttribute('data-sidebar-mode') !== 'docked') { await page.locator('.sidebar-rail-header button').click(); await settle(page) }
    await page.mouse.move(850, 100)
    const key = async (region: 'Sidebar' | 'Bottom', value: string) => {
      await page.getByRole('separator', { name: region === 'Sidebar' ? 'Largura da Sidebar' : 'Altura da Bottom', exact: true }).press(value)
      // Finish each real keyboard transaction before starting the next; its guarded persistence is asynchronous.
      await page.locator('.experience-switch').getByRole('button', { name, exact: true }).focus(); await settle(page)
    }
    await key('Sidebar', size); await key('Bottom', size)
    if (!bottom) await key('Bottom', 'Enter')
    if (sidebar !== 'docked') {
      // The rail's explicit collapse resets the floating presentation as well as visibility.
      await page.locator('.sidebar-rail-header button').click(); await page.mouse.move(850, 100); await settle(page)
    }
    if (sidebar === 'peek') {
      await page.mouse.move(850, 100)
      await page.locator('.sidebar-rail-header button').hover()
      await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-sidebar-mode') === 'peek', undefined, { timeout: 10000 })
      await settle(page)
    }
    // Generic widget settle does not include the host Sidebar's own reveal transition.
    await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.host-sidebar-content,.editor-explorer-panel')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => undefined))) })
    await settle(page)
    assert.equal(await root.getAttribute('data-sidebar-mode'), sidebar)
    assert.equal(await root.getAttribute('data-bottom-mode'), bottom ? 'docked' : 'hidden')
  }
  async function measure() {
    return page.evaluate(() => {
      const rect = (n: Element) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
      const side = document.querySelector<HTMLElement>('[data-region="sidebar"]')!, port = side.querySelector<HTMLElement>('[data-surface="sidebar"]')!
      const shell = side.closest('.host-sidebar-content')!, bottom = document.querySelector<HTMLElement>('[data-region="bottom"]')!, bp = bottom.querySelector<HTMLElement>('[data-surface="bottom"]')!
      const sr = rect(side), pr = rect(port), clip = rect(shell), br = rect(bp), visibleBottom = rect(bottom), ss = getComputedStyle(side)
      const bounds = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height })
      // client extents are the host engine's native scrollbar/rounding budget, not guessed nominal insets.
      const sidebar = bounds(pr.left, sr.top + side.clientTop + parseFloat(ss.paddingTop), Math.max(0, Math.min(port.clientWidth, clip.right - pr.left - parseFloat(ss.paddingRight))), Math.max(0, side.clientHeight - parseFloat(ss.paddingTop) - parseFloat(ss.paddingBottom)))
      const lower = bounds(br.left, br.top, bp.clientWidth, Math.max(0, Math.min(bp.clientHeight, visibleBottom.bottom - br.top)))
      const panels = ['.editor-explorer-panel', '.direct-terminal'].map(selector => {
        const panel = document.querySelector<HTMLElement>(selector)
        if (!panel) return null
        const r = rect(panel), css = getComputedStyle(panel), hidden = !!panel.inert || r.width === 0 || r.height === 0
        const hit = (x: number, y: number) => panel.contains(document.elementFromPoint(x, y))
        const behindPeek = selector === '.direct-terminal' && document.querySelector('.workbench')?.getAttribute('data-sidebar-mode') === 'peek'
        const leftHit = behindPeek ? Math.max(r.left + 12, clip.right + 12) : r.left + 12
        return { bounds: r, hidden, overflow: css.overflow, within: panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight,
          center: hit(r.left + r.width / 2, r.top + r.height / 2),
          edges: hidden || [[leftHit, r.top + 12], [r.right - 12, r.bottom - 12]].every(([x, y]) => hit(x!, y!)),
          corners: hidden || !hit(r.left + .2, r.top + .2),
          outside: !hit(r.left - 1, r.top + r.height / 2) && !hit(r.right + 1, r.top + r.height / 2) }
      })
      return { sidebar, bottom: lower, panels, dpr: devicePixelRatio,
        sidebarHost: sr, sidebarClip: clip, sidebarHeader: rect(document.querySelector('.sidebar-header')!), rail: rect(document.querySelector('.sidebar-rail')!),
        bottomHost: visibleBottom, bottomSurface: rect(document.querySelector('.bottom-surface')!), status: rect(document.querySelector('.status-bar')!),
        portRounding: { sidebar: pr.width - port.clientWidth, bottomWidth: br.width - bp.clientWidth, bottomHeight: br.height - bp.clientHeight },
        outerScroll: { sidebar: getComputedStyle(side).overflowY, bottom: getComputedStyle(bottom).overflowY, port: getComputedStyle(bp).overflowY },
        treeScroll: document.querySelector('.explorer-scroll') ? getComputedStyle(document.querySelector('.explorer-scroll')!).overflowY : null,
        terminalViewport: (() => {
          const host = document.querySelector('.direct-terminal .terminal-host'), screen = host?.querySelector('.xterm-screen')
          if (!host || !screen) return null
          const h = rect(host), s = rect(screen)
          return { host: h, screen: s, rows: document.querySelector('.xterm-rows')?.childElementCount }
        })() }
    })
  }
  type Bounds = Awaited<ReturnType<typeof measure>>['sidebar']
  const equal = (a: Bounds, b: Bounds, label: string) => {
    for (const edge of ['left', 'top', 'right', 'bottom', 'width', 'height'] as const) assert.ok(Math.abs(a[edge] - b[edge]) < .06, `${label} ${edge}: ${a[edge]} != ${b[edge]}`)
  }
  for (const theme of ['dark', 'light']) {
    if (await root.getAttribute('data-theme') !== theme) await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
    for (const [width, height] of [[1920, 1080], [1024, 768]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!), [width!, height!]); await settle(page)
      for (const size of ['Home', 'End'] as const) for (const sidebar of ['docked', 'hidden', 'peek'] as const) for (const bottom of [true, false]) {
        await configure('Bancada de Trabalho', size, sidebar, bottom)
        const widgets = await measure(), before = await raw()
        await configure('GeppIO Code', size, sidebar, bottom)
        const direct = await measure()
        await writeFile(join(diagnostics, 'editor-region-latest.json'), JSON.stringify({ theme, width, height, size, sidebar, bottom, widgets, direct }, null, 2))
        assert.ok(Math.abs(direct.dpr - scale) < .01)
        equal(direct.sidebar, widgets.sidebar, 'Sidebar host mode parity'); equal(direct.bottom, widgets.bottom, 'Bottom host mode parity')
        for (const [i, expected, visible] of [[0, direct.sidebar, sidebar !== 'hidden'], [1, direct.bottom, bottom]] as const) {
          const panel = direct.panels[i]!
          // A hidden floating panel retains its reveal transform; it must have no hit target.
          if (visible) equal(panel.bounds, expected, `direct ${i} = measured host`)
          else assert.equal(panel.center, false, 'hidden region cannot intercept input')
          assert.equal(panel.overflow, 'hidden'); assert.equal(panel.outside, true)
          if (visible) { assert.equal(panel.within, true, `panel ${i} content containment`); assert.equal(panel.center, true); assert.equal(panel.edges, true); assert.equal(panel.corners, true) }
        }
        assert.equal(direct.outerScroll.sidebar, 'hidden'); assert.equal(direct.treeScroll, 'auto')
        assert.ok(['clip', 'hidden'].includes(direct.outerScroll.bottom)); assert.equal(direct.outerScroll.port, 'clip')
        assert.ok(direct.sidebar.left >= direct.rail.right)
        assert.ok(direct.sidebar.top >= direct.sidebarHeader.bottom)
        if (bottom) assert.ok(direct.bottom.bottom <= direct.status.top + .5, 'Bottom never enters fixed Status Bar')
        if (bottom) {
          const viewport = direct.terminalViewport!
          assert.ok(viewport.screen.height <= viewport.host.height + .06, 'xterm rows fit resized Bottom')
          assert.ok(viewport.screen.width <= viewport.host.width + .06, 'xterm columns fit resized Bottom')
        }
        assert.equal(await editor.inputValue(), draft); assert.equal(await page.locator('.file-editor').getAttribute('data-document-id'), doc)
        assert.deepEqual(await navigation(), nav); assert.deepEqual(pluginWorkers(page), workers)
        assert.equal(await raw(), before, 'Editor mode/sizing does not rewrite saved Widgets placements/bars')
        const current = await page.evaluate(() => window.geppio!.terminal.read(null, 0)); assert.ok(current.ok)
        assert.equal(current.value.state.id, native.value.state.id)
        if (bottom) assert.equal(current.value.state.rows, direct.terminalViewport!.rows, 'native rows follow rendered xterm viewport')
        assert.equal(await emulator!.evaluate(n => n === document.querySelector('.terminal-emulator')), true)
        if (size === 'End' && sidebar === 'docked' && bottom) await page.screenshot({ path: join(diagnostics, `editor-regions-${theme}-${width}.png`) })
        samples.push({ theme, width, height, size, sidebar, bottom, widgets, direct })
      }
    }
  }
  await configure('GeppIO Code', 'End', 'docked', true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1000)); await settle(page)
  await writeFile(join(diagnostics, 'editor-region-geometry.json'), JSON.stringify(samples, null, 2))
  console.log(`PASS shared Editor Sidebar/Bottom: ${samples.length} actual owner/port comparisons at DPR ${scale}, both themes/sizes, dock/hidden/peek, min/max resizing, clipping/hits, one emulator/native session/draft/navigation and unchanged layout/Workers`)
}
