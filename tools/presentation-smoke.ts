import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../tests/fixtures/workbench.ts'
import { changePresentation, EDGES } from '../src/shared/workbench/presentations.ts'
import type { Edge, Presentation } from '../src/shared/workbench/presentations.ts'
import { serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { EXPANSION_KEY } from '../src/shared/freeform/policy.ts'
import { settle, portugueseFixture } from './freeform-smoke.ts'

const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-presentations-'))
const directory = `.local/diagnostics/presentations-alpha19-${process.argv.includes('--scale125') ? '1.25' : '1'}`
await mkdir(directory, { recursive: true })
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
env.GEPPIO_TEST_DEMO_WIDGETS = '1'
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
let application: ElectronApplication | undefined, page!: Page
const errors: string[] = [], evidence: unknown[] = [], registry = widgetRegistry()
const ids = ['summary', 'queue', 'properties', 'activity'] as const
const titles = { summary: 'Panorama', queue: 'Fila de trabalho', properties: 'Propriedades', activity: 'Atividade' }
type Id = typeof ids[number]
const frame = (id: Id = 'properties') => page.locator(`[data-widget-id="${id}"]`)
const selector = (id: Id = 'properties') => page.getByRole('button', { name: 'Apresentação de ' + titles[id], exact: true })
const edge = (id: Id, anchor: Edge) => page.getByRole('separator', { name: (anchor === 'top' || anchor === 'bottom' ? 'Altura de ' : 'Largura de ') + titles[id], exact: true })
const raw = () => page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
const stored = async () => JSON.parse((await raw())!) as { layout: unknown; organization: { chrome: unknown; presentations: { entries: { viewId: string; presentation: Presentation; anchor: Edge | null; open: boolean; preferred: { width: number; height: number }; position: { x: number; y: number } }[] } } }
const selected = (id: Id = 'properties') => frame(id).getAttribute('data-presentation')
async function launch(width = 2000, height = 1400) {
  application = await electron.launch({ args: ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])], env })
  page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  const installPanelEvidence = () => {
    const trace: unknown[] = []; Object.assign(window, { panelGestureEvidence: trace })
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'blur', 'focus', 'resize']) window.addEventListener(type, event => {
      const pointer = event as PointerEvent, target = event.target instanceof Element ? event.target : null
      if (type === 'pointermove' && pointer.buttons !== 1) return
      trace.push({ time: performance.now(), type, target: target?.outerHTML.slice(0, 220) ?? 'document', point: [pointer.clientX, pointer.clientY], buttons: pointer.buttons,
        focused: document.hasFocus(), viewport: [innerWidth, innerHeight],
        capture: [...document.querySelectorAll<HTMLElement>('.presentation-splitter')].filter(node => node.hasPointerCapture(pointer.pointerId)).map(node => node.getAttribute('aria-label')) })
      if (trace.length > 60) trace.shift()
    }, true)
  }
  await page.addInitScript(installPanelEvidence); await page.evaluate(installPanelEvidence)
  await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]!; window.setContentSize(size.width, size.height); window.show(); window.focus() }, { width, height })
  await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await page.bringToFront(); await settle(page)
}
async function restart(width = 2000, height = 1400) { await application!.close(); application = undefined; await launch(width, height) }
async function resize(width: number, height: number) {
  await application!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height }); await settle(page)
}
async function seed(snapshot = initialWorkbench(), theme = 'dark') {
  await page.evaluate(({ key, raw, theme, expansion }) => { localStorage.setItem(key, raw); localStorage.setItem('geppio:theme:v1', theme); localStorage.setItem(expansion, 'false') },
    { key: WORKBENCH_KEY, raw: serializeWorkbench(snapshot, registry), theme, expansion: EXPANSION_KEY })
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page); await settle(page)
}
async function begin() { if (await page.getByTestId('edit-layout').count()) { await page.getByTestId('edit-layout').click(); await settle(page) } }
async function conclude() { await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); await settle(page) }
async function hoverHeading(id: Id = 'properties') {
  const heading = frame(id).locator('.widget-heading'), box = await heading.boundingBox(); assert.ok(box)
  await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + (box.width <= 32 ? Math.min(40, box.height / 2) : box.height / 2))
}
async function reveal(id: Id = 'properties') {
  await page.evaluate(() => {
    const host = window as Window & { presentationPointerEvents?: unknown[] }
    if (host.presentationPointerEvents) return
    const events = host.presentationPointerEvents = [] as unknown[]
    const record = (value: object) => { events.push({ time: performance.now(), ...value }); if (events.length > 40) events.shift() }
    for (const type of ['focus', 'blur']) window.addEventListener(type, () => record({ type, focused: document.hasFocus() }))
    for (const type of ['pointerover', 'pointerout']) document.addEventListener(type, event => {
      const frame = (event.target as Element).closest<HTMLElement>('[data-widget-id]')
      if (frame) record({ type, id: frame.dataset.widgetId, open: frame.dataset.panelOpen, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY })
    }, true)
    const area = document.querySelector('[data-surface="main"]')
    if (area) new ResizeObserver(() => { const r = area.getBoundingClientRect(); record({ type: 'main-size', width: r.width, height: r.height }) }).observe(area)
  })
  // Restart can leave the native pointer at the trigger's previous position.
  // Enter from outside and wait for the actual reveal, retaining native hover.
  await page.mouse.move(10, 65)
  const box = await frame(id).boundingBox(); assert.ok(box)
  const point = { x: box.x + Math.min(40, box.width / 2), y: box.y + Math.min(40, box.height / 2) }
  assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId, point), id)
  // A fixed point in the trigger stays inside its expanded panel. Locator hover
  // can relocate toward the moving header while it expands, leaving the panel.
  await page.evaluate(point => Reflect.get(window, 'presentationPointerEvents').push({ time: performance.now(), type: 'driver-hover-intent', ...point }), point)
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(id => document.querySelector(`[data-widget-id="${id}"]`)?.getAttribute('data-panel-open') === 'true', id)
  await settle(page)
  assert.equal(await frame(id).getAttribute('data-panel-open'), 'true')
}
async function openPresentationMenu(id: Id = 'properties') {
  // Reveal the hover controls at the header's actual hit area before moving to
  // the selector; a center hover can be lost as Edit changes the panel budget.
  await hoverHeading(id)
  await page.waitForFunction(id => {
    const controls = document.querySelector(`[data-widget-id="${id}"] .widget-local-controls`)
    return controls && getComputedStyle(controls).pointerEvents === 'auto'
  }, id)
  // Keep the already revealed, keyboard-reachable controls focused while the
  // native pointer relocates from the header to the menu button.
  await selector(id).focus()
  await selector(id).click()
}
async function select(id: Id, mode: Presentation, anchor: Edge | null = 'bottom', persist = true, refusal = false) {
  await begin()
  if (await selected(id) === 'overlay') await reveal(id)
  await openPresentationMenu(id)
  const labels = { normal: 'Normal', docked: 'Encaixado', overlay: 'Flutuante' }, anchors = { top: 'Topo', bottom: 'Embaixo', left: 'Esquerda', right: 'Direita' }
  assert.equal(await page.getByRole('menuitemradio', { name: labels[(await selected(id)) as Presentation], exact: true }).getAttribute('aria-checked'), 'true')
  await page.getByRole('menuitemradio', { name: labels[mode], exact: true }).click()
  if (mode !== 'normal') {
    const before = await selected(id)
    const option = page.getByRole('menuitemradio', { name: anchor ? anchors[anchor] : 'Sem âncora', exact: true })
    await option.hover(); await page.waitForTimeout(320)
    assert.equal(await selected(id), before, 'Choosing a mode alone creates no intention')
    if (await selected(id) === 'overlay') assert.equal(await frame(id).getAttribute('data-panel-open'), 'true', 'Menu gap retains hover')
    await option.click()
  }
  await settle(page)
  if (refusal) { await page.mouse.click(10, 65); return }
  assert.equal(await selected(id), mode)
  if (persist) await conclude()
}
async function bounds() {
  return page.evaluate(() => {
    const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
    const main = document.querySelector('[data-region="main"]')!, style = getComputedStyle(main), r = main.getBoundingClientRect()
    const origin = { x: r.x + parseFloat(style.paddingLeft), y: r.y + parseFloat(style.paddingTop) }
    return { main: rect(main), port: rect(document.querySelector('[data-surface="main"]')!), bottom: rect(document.querySelector('[data-region="bottom"]')!), sidebar: rect(document.querySelector('[data-region="sidebar"]')!),
      usable: { width: r.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: r.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) },
      expanded: main.getAttribute('data-expanded') === 'true', adapted: main.getAttribute('data-panel-adapted'), reservations: JSON.parse(main.getAttribute('data-panel-reservations')!), dpr: devicePixelRatio, origin,
      panels: Object.fromEntries([...document.querySelectorAll<HTMLElement>('.widget-frame[data-owner-region="main"]')].map(node => [node.dataset.widgetId!, { ...rect(node), open: node.dataset.panelOpen, anchor: node.dataset.panelAnchor, mode: node.dataset.presentation }])) }
  })
}
async function assertBounds() {
  const g = await bounds()
  for (const [id, r] of Object.entries(g.panels)) {
    assert.ok(r.x >= g.origin.x - .1 && r.y >= g.origin.y - .1 && ((g.expanded && r.mode === 'normal') || r.right <= g.main.right + .1) && r.bottom <= g.main.bottom + .1, id + ' ' + JSON.stringify(g))
  }
  assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true')
  return g
}
async function assertRailDivider(theme: string, state: 'docked' | 'collapsed' | 'hover') {
  const result = await page.evaluate(() => {
    const panel = document.querySelector('.host-rail-panel')!, box = panel.getBoundingClientRect(), line = getComputedStyle(panel, '::after')
    return { top: parseFloat(line.top), bottom: parseFloat(line.bottom), left: parseFloat(line.left), width: parseFloat(line.width),
      opacity: line.opacity, background: line.backgroundColor, border: getComputedStyle(panel).getPropertyValue('--color-border').trim(),
      mask: line.maskImage, pointer: line.pointerEvents, display: line.display, clip: line.clipPath,
      start: box.top + parseFloat(line.top), end: box.bottom - parseFloat(line.bottom), panelTop: box.top, panelBottom: box.bottom,
      mode: document.querySelector('.workbench')!.getAttribute('data-sidebar-mode') }
  })
  assert.equal(result.top, 12); assert.equal(result.bottom, 12); assert.equal(result.left, 48); assert.equal(result.width, 1)
  assert.equal(result.start - result.panelTop, 12); assert.equal(result.panelBottom - result.end, 12)
  assert.equal(result.opacity, '0.5'); assert.equal(result.pointer, 'none'); assert.match(result.mask, /6px/)
  if (state === 'hover') { assert.equal(result.mode, 'peek'); assert.equal(result.display, 'none') }
  else { assert.equal(result.display, 'block'); if (state === 'collapsed') { assert.equal(result.mode, 'hidden'); assert.match(result.clip, /1px/) } }
  await page.screenshot({ path: `${directory}/${theme}-sidebar-${state}.png` })
  evidence.push({ theme, sidebar: state, divider: result })
}
async function sampleSidebar(theme: string, direction: 'collapse' | 'reopen') {
  // The preceding overlap probe can leave a real hover reveal pending. Establish
  // the compact-strip precondition before sampling the Sidebar transition, so
  // this geometry assertion never mistakes a legitimate 260px reveal for 31px.
  await page.mouse.move(500, 80)
  await page.waitForFunction(() => ['properties', 'activity'].every(id => document.querySelector(`[data-widget-id="${id}"]`)?.getAttribute('data-panel-open') === 'false'))
  await settle(page)
  await page.evaluate(() => {
    const host = window as Window & { stripPointerEvidence?: unknown[] }
    if (!host.stripPointerEvidence) {
      const trace = host.stripPointerEvidence = [] as unknown[]
      for (const type of ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin']) document.addEventListener(type, event => {
        const target = (event.target as Element).closest<HTMLElement>('[data-widget-id],[data-bar-id],.host-sidebar-content')
        trace.push({ time: performance.now(), type, target: target?.dataset.widgetId ?? target?.dataset.barId ?? target?.className, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY })
        if (trace.length > 60) trace.shift()
      }, true)
    }
    const state = window as unknown as { sidebarSamples: unknown[]; samplingSidebar: boolean }
    state.sidebarSamples = []; state.samplingSidebar = true
    const start = performance.now()
    function sample() {
        const main = document.querySelector('[data-region="main"]')!, b = main.getBoundingClientRect(), style = getComputedStyle(main)
        const port = document.querySelector<HTMLElement>('[data-surface="main"]')!, c = port.getBoundingClientRect()
        const rect = (id: string) => { const node = document.querySelector<HTMLElement>(`[data-widget-id="${id}"]`)!, r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
          sourceX: Number(node.dataset.x), sourceY: Number(node.dataset.y), sourceWidth: Number(node.dataset.w), inlineLeft: node.style.left, inlineTop: node.style.top, clip: node.style.clipPath, z: getComputedStyle(node).zIndex } }
        state.sidebarSamples.push({ time: performance.now() - start, main: { left: b.left + parseFloat(style.paddingLeft), top: b.top + parseFloat(style.paddingTop),
          width: b.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: b.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) },
          port: { x: c.x, y: c.y, width: c.width, height: c.height, measuredWidth: Number(port.dataset.usableWidth), scroll: port.scrollLeft },
          normal: rect('summary'), docked: rect('properties'), floating: rect('activity'),
          input: { pointer: host.stripPointerEvidence!.slice(-15), focus: document.activeElement?.outerHTML.slice(0, 180), overlayOpen: document.querySelector('[data-widget-id="activity"]')?.getAttribute('data-panel-open') } })
    }
    // Observe the same native layout frame after the host observer has committed
    // its shared measurements, before paint. A timer can force next-frame style
    // between layout and ResizeObserver delivery, comparing two different frames.
    const observer = new ResizeObserver(sample)
    observer.observe(document.querySelector('[data-surface="main"]')!)
    const root = document.querySelector<HTMLElement>('.workbench')!, initialMode = root.dataset.sidebarMode
    let settled = 0
    // Native click delivery may follow installation of the observer. Keep the
    // actual transition frames, ending after its mode change and animation,
    // rather than spending a fixed 600ms window before the click arrives.
    function finish() {
      const moving = root.getAnimations().some(animation => animation.playState === 'running' || animation.pending)
      settled = root.dataset.sidebarMode !== initialMode && !moving ? settled + 1 : 0
      if (settled >= 2 || performance.now() - start >= 15000) { observer.disconnect(); state.samplingSidebar = false }
      else requestAnimationFrame(finish)
    }
    requestAnimationFrame(finish)
  })
  await page.locator('[data-bar-id="home"]').click(); await page.mouse.move(500, 80)
  await page.waitForFunction(() => !(window as unknown as { samplingSidebar: boolean }).samplingSidebar)
  const samples = await page.evaluate(() => (window as unknown as { sidebarSamples: { time: number; main: { left: number; top: number; width: number; height: number }; port: { x: number; y: number; width: number; measuredWidth: number; scroll: number }; normal: { x: number; y: number; sourceX: number; sourceY: number }; docked: { x: number; y: number; width: number; height: number }; floating: { x: number; y: number; width: number; height: number } }[] }).sidebarSamples)
  assert.ok(samples.length >= 8, 'Intermediate native CSS transition frames were sampled')
  assert.ok(Math.max(...samples.map(s => s.main.left)) - Math.min(...samples.map(s => s.main.left)) > 100, 'Sidebar transition changed the actual Main inset')
  for (const s of samples) {
    const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < .08, `${direction}/${theme}: ${a} vs ${b}; ${JSON.stringify(s)}`)
    near(s.normal.x, s.port.x + s.normal.sourceX - s.port.scroll); near(s.normal.y, s.port.y + s.normal.sourceY)
    near(s.port.width, s.port.measuredWidth)
    near(s.docked.x, s.main.left); near(s.docked.y, s.main.top + 41); near(s.docked.width, 31); near(s.docked.height, s.main.height - 41)
    near(s.floating.x, s.main.left); near(s.floating.y, s.main.top); near(s.floating.width, s.main.width); near(s.floating.height, 31)
  }
  evidence.push({ theme, sidebarTransition: direction, samples })
}
async function sharedStripScene(theme: string) {
  const source = changePresentation(changePresentation(initialWorkbench(), { presentation: 'docked', anchor: 'left', open: false }),
    { presentation: 'overlay', anchor: 'top' }, registry, 'activity')
  await seed(source, theme)
  for (const id of ['properties', 'activity'] as const) {
    const initial = (await bounds()).panels[id]!, bytes = await raw(), box = await frame(id).locator('.widget-heading').boundingBox(); assert.ok(box)
    assert.equal(await frame(id).locator('.resize-zone,.layout-widget-grip').count(), 0)
    if (id === 'properties') assert.equal(await edge(id, 'left').count(), 0, 'Collapsed Docked has no resize edge')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 24, { steps: 8 }); await page.mouse.up()
    await page.mouse.move(500, 80); await page.waitForTimeout(650); await settle(page)
    const after = (await bounds()).panels[id]!
    for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(initial[axis] - after[axis]) < .03, `Fixed strip ${id}/${axis}`)
    assert.equal(await raw(), bytes)
  }
  await sampleSidebar(theme, 'collapse')
  const closed = await bounds()
  await page.locator('[data-bar-id="home"]').hover()
  await page.waitForFunction(() => document.querySelector('.workbench')?.getAttribute('data-sidebar-mode') === 'peek')
  await settle(page)
  for (const id of ['properties', 'activity'] as const) {
    const r = closed.panels[id]!, point = { x: r.x + (id === 'properties' ? 15 : 55), y: r.y + (id === 'properties' ? 80 : 15) }
    const hit = await page.evaluate(point => {
      const node = document.elementFromPoint(point.x, point.y)
      return { sidebar: !!node?.closest('.host-sidebar-content,[data-owner-region="sidebar"]'), main: !!node?.closest('[data-owner-region="main"]') }
    }, point)
    assert.equal(hit.sidebar, true, 'Floating Sidebar paints over both Main strip types'); assert.equal(hit.main, false)
    await page.evaluate(() => { const state = window as unknown as { stripOverlapHit?: string }; state.stripOverlapHit = undefined
      document.addEventListener('pointerdown', event => { const target = event.target as Element; state.stripOverlapHit = target.closest('[data-owner-region]')?.getAttribute('data-owner-region') ?? (target.closest('.host-sidebar-content') ? 'sidebar' : 'other') }, { once: true, capture: true }) })
    await page.mouse.click(point.x, point.y)
    assert.equal(await page.evaluate(() => (window as unknown as { stripOverlapHit?: string }).stripOverlapHit), 'sidebar', 'Overlapping Sidebar receives the pointer')
    assert.equal(await frame(id).getAttribute('data-panel-open'), 'false')
  }
  await sampleSidebar(theme, 'reopen')
  const before = await bounds(), bytes = await raw()
  await reveal('activity'); const revealed = await bounds()
  assert.deepEqual(revealed.port, before.port); assert.deepEqual(revealed.panels.summary, before.panels.summary); assert.deepEqual(revealed.panels.properties, before.panels.properties)
  assert.equal(await raw(), bytes, 'Floating reveal keeps its strip reservation and peer geometry')
  await page.mouse.move(500, 80); await page.waitForTimeout(650); await settle(page)
  await toggle('properties', 'left'); const docked = await bounds()
  assert.ok(docked.port.width < before.port.width - 100, 'Expanded Docked replaces the compact reservation')
  await toggle('properties', 'left')
  evidence.push({ theme, sharedStrips: true, floatingSidebarHit: true, mixedReservations: before.reservations })
}
async function toggle(id: Id, anchor: Edge) {
  if (await frame(id).getAttribute('data-panel-open') === 'false') await frame(id).locator('.widget-heading').click()
  else await edge(id, anchor).click()
  await settle(page)
}
async function drag(id: Id, anchor: Edge, delta: number, cancel?: 'escape' | 'pointercancel' | 'lostcapture') {
  // Normal-mode presentation changes use the existing Web Lock. A following
  // gesture must start after that command and native splitter movement settle.
  await page.evaluate(async key => { await navigator.locks.request(key, () => {}) }, WORKBENCH_KEY)
  await settle(page)
  const handle = edge(id, anchor), measured = await handle.boundingBox(); assert.ok(measured)
  await handle.hover(); const box = await handle.boundingBox(); assert.ok(box)
  if (JSON.stringify(measured) !== JSON.stringify(box)) console.log('Splitter actionability corrected bounds', { id, anchor, measured, box })
  const before = await raw(), h = anchor === 'top' || anchor === 'bottom'
  const sign = anchor === 'bottom' || anchor === 'right' ? -1 : 1
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.presentation-splitter'), { x, y }), true, 'The real splitter receives pointer-down')
  assert.ok(await handle.evaluate(node => node.hasPointerCapture(1)), `Native capture ${id}/${anchor}: ` + JSON.stringify(await page.evaluate(() => Reflect.get(window, 'panelGestureEvidence'))))
  await page.mouse.move(x + (h ? 0 : sign * delta), y + (h ? sign * delta : 0), { steps: 12 })
  assert.equal(await raw(), before, 'No resize-preview writes')
  if (cancel === 'escape') await page.keyboard.press('Escape')
  if (cancel === 'pointercancel') await edge(id, anchor).dispatchEvent('pointercancel', { pointerId: 1 })
  if (cancel === 'lostcapture') await edge(id, anchor).evaluate(node => { if (node.hasPointerCapture(1)) node.releasePointerCapture(1) })
  await page.mouse.up()
  await page.evaluate(async key => { await navigator.locks.request(key, () => {}) }, WORKBENCH_KEY)
  await settle(page)
  if (cancel) assert.equal(await raw(), before, 'Canceled gesture preserves bytes')
}
function onlyProperties() { const s = initialWorkbench(); s.placements = s.placements.filter(p => p.region !== 'main' || p.id === 'properties'); return s }
try {
  await launch(); await seed()
  assert.equal(await selector().count(), 0)
  await begin()
  for (const id of ids) { await frame(id).hover(); assert.equal(await selector(id).count(), 1); assert.equal(await selector(id).innerText(), 'Normal') }
  const alignment = await frame().evaluate(node => { const a = node.querySelector('.widget-presentation-control')!.getBoundingClientRect(), b = node.querySelector('.layout-widget-remove')!.getBoundingClientRect(); return { deltaY: a.y - b.y, deltaH: a.height - b.height, gap: b.x - a.right } })
  assert.ok(Math.abs(alignment.deltaY) < .1 && Math.abs(alignment.deltaH) < .1 && Math.abs(alignment.gap - 4) < .1)
  await conclude()
  for (const theme of ['dark', 'light']) {
    await seed(initialWorkbench(), theme)
    await assertRailDivider(theme, 'docked')
    await page.locator('[data-bar-id="home"]').click(); await page.mouse.move(500, 80); await page.waitForTimeout(450); await settle(page)
    await assertRailDivider(theme, 'collapsed')
    await page.locator('.sidebar-rail-primary').hover(); await page.waitForTimeout(180); await settle(page)
    await assertRailDivider(theme, 'hover')
    await page.locator('[data-bar-id="home"]').click(); await page.mouse.move(500, 80); await settle(page)
    await sharedStripScene(theme)
    await seed(initialWorkbench(), theme)
    // Configure the approved scenes through the actual two-step local menu.
    for (const [i, id] of ids.entries()) { await select(id, 'docked', EDGES[i]!); await toggle(id, EDGES[i]!) }
    let g = await assertBounds()
    for (const id of ['summary', 'queue'] as const) assert.ok(Math.abs(g.panels[id]!.width - g.usable.width) < 1)
    assert.ok(Math.abs(g.panels.properties!.y - (g.origin.y + 41)) < 1)
    await page.screenshot({ path: `${directory}/${theme}-four-collapsed.png` })
    await toggle('summary', 'top'); g = await assertBounds()
    assert.ok(Math.abs(g.panels.properties!.y - (g.panels.summary!.bottom + 10)) < 1)
    await page.screenshot({ path: `${directory}/${theme}-top-open.png` })
    for (const [i, id] of ids.entries()) if (id !== 'summary') await toggle(id, EDGES[i]!)
    g = await assertBounds(); for (const id of ids) assert.equal(g.panels[id]!.open, 'true')
    assert.ok(Math.abs(g.panels.properties!.bottom - (g.panels.queue!.y - 10)) < 1)
    await page.screenshot({ path: `${directory}/${theme}-four-open.png` })
    await begin(); await openPresentationMenu('properties'); await page.getByRole('menuitemradio', { name: 'Encaixado', exact: true }).click()
    assert.equal(await page.getByRole('menuitemradio', { name: 'Topo · Ocupado', exact: true }).isDisabled(), true)
    await page.mouse.click(10, 65); await conclude()
    const sidebarIntent = (await stored()).organization.presentations
    await page.locator('[data-bar-id="home"]').click(); await page.mouse.move(500, 80); await page.waitForTimeout(450); await settle(page)
    const sidebarClosed = await assertBounds()
    await page.locator('.sidebar-rail-primary').hover(); await page.waitForTimeout(180); await settle(page)
    assert.deepEqual((await bounds()).port, sidebarClosed.port, 'Sidebar peek does not reflow Main or its Docked reservations')
    await page.locator('[data-bar-id="home"]').click(); await page.mouse.move(500, 80); await settle(page)
    assert.deepEqual((await stored()).organization.presentations, sidebarIntent)
    const independent = await bounds()
    await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).click(); await settle(page)
    assert.equal(await selected(), 'docked'); assert.equal((await stored()).organization.presentations.entries.length, 4)
    await page.getByRole('separator', { name: 'Altura da Bottom', exact: true }).click(); await settle(page)
    const beforeViewport = await raw()
    await resize(1000, 720); const narrow = await assertBounds(); assert.equal(narrow.adapted, 'true')
    await begin()
    for (const id of ids) { await frame(id).hover(); assert.ok(await selector(id).isVisible()) }
    await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), beforeViewport)
    await restart(1000, 720); assert.equal(await raw(), beforeViewport)
    await resize(2000, 1400); g = await assertBounds(); for (const id of ids) assert.equal(g.panels[id]!.open, 'true')
    assert.equal(await raw(), beforeViewport)
    for (const [i, id] of ids.entries()) {
      const before = await bounds(), axis = i < 2 ? 'height' : 'width'
      await drag(id, EDGES[i]!, 32)
      const after = await bounds(); assert.ok(after.panels[id]![axis] > before.panels[id]![axis] + 20, `${id}/${axis}: ${before.panels[id]![axis]} -> ${after.panels[id]![axis]}`)
      for (const cancel of ['escape', 'pointercancel', 'lostcapture'] as const) await drag(id, EDGES[i]!, 22, cancel)
    }
    // Return order lets full-width horizontal rectangles remain legal with sides.
    for (const id of ['properties', 'activity', 'summary', 'queue'] as const) {
      await begin()
      const before = (await bounds()).panels[id]!
      await select(id, 'normal', null, false)
      const after = (await bounds()).panels[id]!
      for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(before[axis] - after[axis]) < .03, `${id}/${axis}: ${before[axis]} -> ${after[axis]}`)
      await conclude()
    }
    assert.equal(await selected(), 'normal')
    evidence.push({ theme, independent, narrow, fourEdges: true, exactReturns: true })
    // Floating anchored to all four edges above one independent Docked reservation.
    for (const anchor of EDGES) {
      const source = changePresentation(initialWorkbench(), { presentation: 'docked', anchor: anchor === 'top' ? 'bottom' : 'top', open: false }, registry, 'summary')
      await seed(source, theme)
      await select('properties', 'overlay', anchor)
      await page.mouse.move(10, 65); await page.waitForTimeout(650); await settle(page)
      assert.equal(await frame().getAttribute('data-panel-open'), 'false')
      const closed = await bounds(), hoverBytes = await raw()
      const input = frame().locator('input[aria-label="Nome de exemplo"]')
      await reveal(); await input.fill('identity-' + theme); await input.evaluate(node => { node.dataset.identityProof = 'mounted' })
      const shown = await assertBounds(); assert.deepEqual(shown.port, closed.port); assert.deepEqual(shown.reservations, closed.reservations)
      await input.focus(); await page.mouse.move(10, 65); await page.waitForTimeout(650)
      assert.equal(await frame().getAttribute('data-panel-open'), 'true', 'Focus retains panel')
      await begin(); await reveal(); await openPresentationMenu(); await page.getByRole('menuitemradio', { name: 'Flutuante', exact: true }).click()
      await page.getByRole('menuitemradio', { name: 'Sem âncora', exact: true }).hover(); await page.waitForTimeout(420)
      assert.equal(await frame().getAttribute('data-panel-open'), 'true', 'Top-layer menu retains panel')
      assert.equal(await input.getAttribute('data-identity-proof'), 'mounted')
      await page.mouse.click(10, 65); await page.getByTestId('cancel-layout').click(); await settle(page)
      await page.mouse.move(10, 65); await page.waitForTimeout(650); await settle(page)
      assert.equal(await raw(), hoverBytes)
      await restart(); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), hoverBytes)
      await reveal(); await page.screenshot({ path: `${directory}/${theme}-floating-${anchor}.png` })
    }
    // Free trigger drag, cancellation, hover path, history and restart.
    await seed(onlyProperties(), theme); await select('properties', 'overlay', null)
    await page.mouse.move(10, 65); await page.waitForTimeout(650); await settle(page)
    const freeBefore = await bounds(); assert.ok(freeBefore.panels.properties!.width <= 209)
    await begin(); const trigger = frame().locator('.widget-heading'), box = await trigger.boundingBox(); assert.ok(box)
    const savedBefore = await raw()
    await page.mouse.move(box.x + 22, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + 212, box.y + 82, { steps: 14 })
    assert.equal(await raw(), savedBefore); await page.mouse.up(); await settle(page)
    const freePosition = Number(await frame().getAttribute('data-x')); assert.ok(freePosition > 100)
    await conclude(); const freeSaved = await raw()
    await restart(); assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), freeSaved)
    await reveal(); const freeOpen = await bounds(); assert.ok(freeOpen.panels.properties!.width < freeOpen.port.width - 100)
    await frame().locator('input[aria-label="Nome de exemplo"]').evaluate(node => { node.dataset.returnProof = 'mounted' })
    await begin(); const header = await frame().locator('.widget-heading').boundingBox(); assert.ok(header)
    await page.mouse.move(header.x + 22, header.y + 12); await page.mouse.down(); await page.mouse.move(header.x + 90, header.y + 80, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
    assert.equal(await raw(), freeSaved); assert.ok(Math.abs(Number(await frame().getAttribute('data-x')) - freePosition) < 1)
    await reveal()
    const normalBefore = (await bounds()).panels.properties!
    await select('properties', 'normal', null, false)
    let normalAfter = (await bounds()).panels.properties!
    for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(normalBefore[axis] - normalAfter[axis]) < .03, `free/${axis}`)
    assert.equal(await frame().locator('input[aria-label="Nome de exemplo"]').getAttribute('data-return-proof'), 'mounted')
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.equal(await selected(), 'overlay')
    await page.getByRole('button', { name: 'Refazer', exact: true }).click(); await settle(page); assert.equal(await selected(), 'normal')
    // Ordinary resize is available after conversion.
    const resizeHandle = frame().locator('[data-resize="e"]'), resizeBox = await resizeHandle.boundingBox(); assert.ok(resizeBox)
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2); await page.mouse.down(); await page.mouse.move(resizeBox.x + 35, resizeBox.y + resizeBox.height / 2, { steps: 8 }); await page.mouse.up(); await settle(page)
    normalAfter = (await bounds()).panels.properties!; assert.ok(normalAfter.width > normalBefore.width + 15)
    await page.getByTestId('save-layout').click(); await settle(page)
    const checkpoint = await raw(); await select('properties', 'docked', 'bottom', false)
    await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), checkpoint); assert.equal(await selected(), 'normal')
    await page.screenshot({ path: `${directory}/${theme}-free-return-normal.png` })
  }
  // Zero/one/two horizontal reservations in the DOM; side spans react live.
  for (const count of [0, 1, 2]) {
    let source = changePresentation(changePresentation(initialWorkbench(), { presentation: 'docked', anchor: 'left' }), { presentation: 'docked', anchor: 'right' }, registry, 'activity')
    if (count > 0) source = changePresentation(source, { presentation: 'docked', anchor: 'top' }, registry, 'summary')
    if (count > 1) source = changePresentation(source, { presentation: 'docked', anchor: 'bottom' }, registry, 'queue')
    await seed(source); const g = await assertBounds(), side = g.panels.properties!
    assert.ok(Math.abs(side.y - (g.origin.y + g.reservations.top)) < 1)
    assert.ok(Math.abs(side.bottom - (g.origin.y + g.usable.height - g.reservations.bottom)) < 1)
    evidence.push({ horizontalReservations: count, geometry: g })
  }
  // Collapsed legal returns use the hypothetical expanded rectangle at each edge.
  for (const anchor of EDGES) {
    await seed(changePresentation(onlyProperties(), { presentation: 'docked', anchor, open: true }))
    await begin()
    const expanded = (await bounds()).panels.properties!
    await toggle('properties', anchor); await conclude(); const collapsedBytes = await raw(); await restart()
    assert.equal(await frame().getAttribute('data-panel-open'), 'false'); assert.equal(await raw(), collapsedBytes)
    await select('properties', 'normal', null, false); const normal = (await bounds()).panels.properties!
    for (const axis of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(normal[axis] - expanded[axis]) < .03, `collapsed/${anchor}/${axis}`)
    await conclude()
  }
  let freePeers = initialWorkbench()
  for (const id of ids) freePeers = changePresentation(freePeers, { presentation: 'overlay', anchor: null, position: { x: 10000, y: 10000 } }, registry, id)
  await seed(freePeers); const freePeerBytes = await raw(); await resize(1000, 720); await begin()
  for (const id of ids) {
    await page.mouse.move(500, 80); await page.waitForTimeout(450); await openPresentationMenu(id)
    assert.ok(await page.getByRole('menuitemradio', { name: 'Flutuante', exact: true }).isVisible())
    await page.mouse.click(500, 80)
  }
  await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await raw(), freePeerBytes)
  await resize(2000, 1400)
  // Exact return conflict: no mode, geometry, history or saved-byte mutation.
  await seed(changePresentation(initialWorkbench(), { presentation: 'overlay', anchor: null })); await begin(); await reveal()
  const conflictBytes = await raw(), conflictRect = (await bounds()).panels.properties!
  const undoDisabled = await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled()
  await select('properties', 'normal', null, false, true)
  assert.equal(await selected(), 'overlay'); assert.equal(await raw(), conflictBytes)
  await reveal(); const conflictAfter = (await bounds()).panels.properties!
  for (const axis of ['x', 'y', 'width', 'height'] as const) assert.equal(conflictRect[axis], conflictAfter[axis])
  assert.equal(await page.getByRole('button', { name: 'Desfazer', exact: true }).isDisabled(), undoDisabled)
  assert.match(await page.locator('.workspace-feedback').innerText(), /Libere o local/)
  await page.getByTestId('cancel-layout').click(); await settle(page)
  // Legacy raw documents: read without rewriting, Floating waits for hover.
  for (const mode of ['normal', 'docked', 'overlay'] as const) for (const open of [false, true]) {
    await seed()
    await page.evaluate(({ key, mode, open }) => { const doc = JSON.parse(localStorage.getItem(key)!); doc.organization.presentations = { version: 1, entries: [{ viewId: 'properties', typeId: 'host:properties', modelId: 'model:host:properties', owner: 'host', presentation: mode, anchor: 'bottom', preferred: { width: 720, height: 340 }, open }] }; localStorage.setItem(key, JSON.stringify(doc)) }, { key: WORKBENCH_KEY, mode, open })
    const bytes = await raw(); await restart(); assert.equal(await raw(), bytes); assert.equal(await selected(), mode)
    assert.equal(await frame().getAttribute('data-panel-open'), String(mode === 'normal' || mode === 'docked' && open))
  }
  await seed(); await page.evaluate(key => { const doc = JSON.parse(localStorage.getItem(key)!); doc.schemaVersion = 1; delete doc.organization.presentations; localStorage.setItem(key, JSON.stringify(doc)) }, WORKBENCH_KEY)
  const old = await raw(); await restart(); assert.equal(await selected(), 'normal'); assert.equal(await raw(), old)
  // Viewport and scrollbar rounding at fractional DPR never writes preferences.
  await seed(changePresentation(initialWorkbench(), { presentation: 'docked', anchor: 'bottom', preferred: { width: 720, height: 420 } }))
  await page.evaluate(key => localStorage.setItem(key, 'true'), EXPANSION_KEY); await page.reload(); await settle(page)
  const expansionBytes = await raw(); await resize(1000, 720); await assertBounds(); await resize(2000, 1400); await assertBounds(); assert.equal(await raw(), expansionBytes)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle('properties', 'bottom'); await toggle('properties', 'bottom'); await assertBounds()
  // Derive the CSS budget from the actual native viewport: forced DPR can round
  // minimum-window dimensions outward. Recovery must not retain old scrollbars.
  const boundary = changePresentation(initialWorkbench(), { presentation: 'docked', anchor: 'bottom', open: false })
  await resize(1000, 740); const boundaryViewport = await bounds()
  boundary.organization.chrome.bottom.size = boundaryViewport.usable.height + boundaryViewport.bottom.height - 41 - 326.125
  await seed(boundary)
  assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'false')
  const boundaryBytes = await raw(); await resize(1000, 744)
  assert.equal(await page.locator('[data-surface="main"]').getAttribute('data-feasible'), 'true', 'The recovered Main minimum does not inherit previous scrollbars')
  const minimumPort = (await bounds()).port
  assert.ok(minimumPort.height >= 330 && minimumPort.height < 331, 'Recovery is tested within one CSS pixel of the exact peer minimum')
  assert.equal(await raw(), boundaryBytes)
  await resize(2000, 1400)
  // Guarded storage failures retain the preview and original bytes.
  await seed(); await select('properties', 'docked', 'bottom', false); const validBytes = await raw()
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException('Fixture quota', 'QuotaExceededError'); return original.call(this, k, value) } }, WORKBENCH_KEY)
  await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), validBytes); assert.equal(await selected(), 'docked')
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  await select('properties', 'docked', 'right', false)
  await page.evaluate(key => { const doc = JSON.parse(localStorage.getItem(key)!); doc.organization.chrome.bottom.size += 1; localStorage.setItem(key, JSON.stringify(doc)) }, WORKBENCH_KEY)
  const external = await raw(); await page.getByTestId('save-layout').click(); await settle(page); assert.equal(await raw(), external)
  await writeFile(`${directory}/evidence.json`, JSON.stringify({ platform: process.platform, scale: process.argv.includes('--scale125') ? 1.25 : 1, simulatedDPR: true, evidence, errors }, null, 2))
  assert.deepEqual(errors, [])
  console.log(`Presentation smoke passed: four edges, free/anchored Floating, exact returns/refusal, restart, history, guards and both themes (${directory})`)
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {}); await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), errors, geometry: await bounds().catch(() => null), pointer: await page.evaluate(() => ({ focused: document.hasFocus(), events: (window as Window & { presentationPointerEvents?: unknown[] }).presentationPointerEvents,
    gestures: Reflect.get(window, 'panelGestureEvidence'), sidebarSamples: Reflect.get(window, 'sidebarSamples'), frames: [...document.querySelectorAll<HTMLElement>('[data-widget-id]')].map(frame => ({ id: frame.dataset.widgetId, hovered: frame.matches(':hover'), open: frame.dataset.panelOpen, controls: frame.querySelector('.widget-local-controls') ? getComputedStyle(frame.querySelector('.widget-local-controls')!).pointerEvents : null })) })) }, null, 2)) }
  throw error
} finally { if (application) await application.close(); await rm(profile, { recursive: true, force: true }) }
